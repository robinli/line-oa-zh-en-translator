import {requestTimeout, remainingTimeout, withinTime, DeadlineScope, assertDeadlineActive} from "./translation-deadline.js";
import {ArchivePersistenceError, ArchiveRedactedError, type ConversationArchiveStore, type ArchiveEvent} from "./conversation-archive.js";
import {archiveEventDependencies} from "./conversation-archive-runtime.js";
import {SolServiceError, type QuoteContext} from "./sol-review-types.js";
import {copyNmtOutputContents, type NmtContentObserver} from "./nmt-content-capture.js";
import {TranslationQualityError} from "./trade-policy.js";
import type {DevEventOperationStore, DevEventSession} from "./dev-event-operation.js";
import {createHash} from "node:crypto";
import {captureQualityOriginal, qualityOperation, traceQualityDependencies, type QualityTrace} from "./translation-quality.js";
import {processTranslationReport, REPORT_COMMAND} from "./translation-report.js";
import type {TranslationQualityStore} from "./translation-quality-store.js";
import {buildReplyMessages} from "./line-messages.js";
import {ContentLimitError, failureReason, UNCHANGED_TRANSLATION_REPLY, TRANSLATION_FAILURE_REPLY, type FailureStage} from "./translation-failures.js";
import type {TranslationFailureStore, TranslationFailureRecord} from "./translation-failure-store.js";
import {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_AUDIO_DURATION_MS,
  DEFAULT_MAX_MESSAGE_LENGTH,
  containsChinese,
  containsLatin,
  isGroupAudioMessageEvent,
  isGroupTextMessageEvent,
  isGroupJoinEvent,
  isUserTextMessageEvent,
  type GroupAudioMessageEvent,
  type GroupTextMessageEvent,
  type LineWebhookBody,
  type TranslationMode,
} from "./domain.js";
import type {TranslationProgram} from "./translation-program.js";
import {verifyLineSignature} from "./signature.js";
import {getMentionRanges, excludeTextRanges} from "./message-text.js";
import {findUserMentions, restoreUserMentions, type MentionAlias, type UserMention} from "./mentions.js";
import type {
  AudioContentLoader,
  AudioTranscriber,
  ConversationSettings,
  ConversationSettingsStore,
  LineReplier,
  Translator,
  TranslationContext,
} from "./services.js";

export const ENABLE_TEXT_COMMAND = "/啟用文字翻譯";
export const DISABLE_TEXT_COMMAND = "/停用文字翻譯";
export const ENABLE_AUDIO_COMMAND = "/啟用語音轉文字";
export const DISABLE_AUDIO_COMMAND = "/停用語音轉文字";
export const TRANSLATION_SETTINGS_COMMAND = "/翻譯設定";
export const ENABLE_RECORDING_COMMAND = "/開啟記錄";
export const DISABLE_RECORDING_COMMAND = "/關閉記錄";
const RECORDING_COMMANDS = [ENABLE_RECORDING_COMMAND, DISABLE_RECORDING_COMMAND];
export const CHINESE_TO_ENGLISH_COMMAND = "/中翻英";
export const ENGLISH_TO_CHINESE_COMMAND = "/英翻中";
export const CHINESE_ENGLISH_COMMAND = "/中英翻譯";
export const CHINESE_VIETNAMESE_COMMAND = "/中越翻譯";
export const MY_LINE_USER_ID_COMMAND = "/我的ID";

const MODE_COMMANDS: Readonly<Record<string, TranslationMode>> = {
  [CHINESE_TO_ENGLISH_COMMAND]: "zh-to-en",
  [ENGLISH_TO_CHINESE_COMMAND]: "en-to-zh",
  [CHINESE_ENGLISH_COMMAND]: "zh-en",
  [CHINESE_VIETNAMESE_COMMAND]: "zh-vi",
};
const RETIRED_COMMANDS = new Set(["/啟用翻譯", "/停用翻譯", "/翻譯狀態"]);
const MAIN_COMMANDS = [
  ...Object.keys(MODE_COMMANDS),
  ENABLE_TEXT_COMMAND, DISABLE_TEXT_COMMAND, ENABLE_AUDIO_COMMAND, DISABLE_AUDIO_COMMAND,
  MY_LINE_USER_ID_COMMAND,
].join("\n");
const JOIN_MESSAGE =
  `翻譯目前尚未啟用。請由授權者選擇翻譯模式。\n\n可用指令：\n${MAIN_COMMANDS}`;
const UNAUTHORIZED_MESSAGE = "你沒有權限變更翻譯設定。";

export interface WebhookRequest {
  method: string;
  rawBody: Buffer;
  signature?: string;
}

export interface WebhookResponse {
  status: number;
  body: {
    ok: boolean;
    processed?: number;
    ignored?: number;
    failed?: number;
    error?: string;
  };
}

export interface WebhookLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface WebhookDependencies {
  archiveStore?: ConversationArchiveStore;
  beginTranslationRecord?: () => Promise<void>;
  solReviewEnabled?: boolean;
  receivedAtMs?: number;
  deadlineAtMs?: number;
  eventOperationStore?: DevEventOperationStore;
  eventSession?: DevEventSession;
  createEventTranslationProgram?: (session: DevEventSession, observer?: NmtContentObserver) => (mode: TranslationMode) => TranslationProgram;
  qualityStore?: TranslationQualityStore;
  qualityTrace?: QualityTrace;
  qualityMetadata?: (mode: TranslationMode, sourceLanguageCode?: string) => {engine: string; glossary: string | null; revision: string | null};
  channelSecret: string;
  translator?: Translator;
  getTranslationProgram?: (mode: TranslationMode) => TranslationProgram;
  transcriber: AudioTranscriber;
  audioContentLoader: AudioContentLoader;
  replier: LineReplier;
  settingsStore: ConversationSettingsStore;
  failureStore: TranslationFailureStore;
  ownerUserId: string;
  logger: WebhookLogger;
  mentionAliases?: readonly MentionAlias[];
  maxMessageLength?: number;
  maxAudioDurationMs?: number;
  maxAudioBytes?: number;
}

interface LanguagePair {
  sourceLanguageCode: string;
  targetLanguageCode: string;
}

export async function processLineWebhook(
  request: WebhookRequest,
  dependencies: WebhookDependencies,
): Promise<WebhookResponse> {
  const deadlineAtMs = (dependencies.receivedAtMs ?? Date.now()) + 50000;
  dependencies = {...dependencies, deadlineAtMs};
  if (dependencies.solReviewEnabled) dependencies = scopedWebhookDependencies(dependencies);
  if (request.method !== "POST") {
    return {status: 405, body: {ok: false, error: "Method not allowed"}};
  }

  if (
    !request.signature ||
    !verifyLineSignature(request.rawBody, dependencies.channelSecret, request.signature)
  ) {
    dependencies.logger.warn("Rejected LINE webhook with an invalid signature.");
    return {status: 401, body: {ok: false, error: "Invalid signature"}};
  }

  let webhookBody: LineWebhookBody;
  try {
    webhookBody = JSON.parse(request.rawBody.toString("utf8")) as LineWebhookBody;
  } catch {
    dependencies.logger.warn("Rejected LINE webhook with invalid JSON.");
    return {status: 400, body: {ok: false, error: "Invalid JSON"}};
  }

  if (!Array.isArray(webhookBody.events)) {
    return {status: 400, body: {ok: false, error: "Invalid webhook body"}};
  }

  const maxMessageLength = dependencies.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
  const maxAudioDurationMs = Math.max(
    0,
    Math.min(
      dependencies.maxAudioDurationMs ?? DEFAULT_MAX_AUDIO_DURATION_MS,
      DEFAULT_MAX_AUDIO_DURATION_MS,
    ),
  );
  const maxAudioBytes = Math.max(
    0,
    Math.min(
      dependencies.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES,
      DEFAULT_MAX_AUDIO_BYTES,
    ),
  );
  let ignored = 0;
  let processed = 0;
  let failed = 0;

  let qualityConfig: Awaited<ReturnType<TranslationQualityStore["getConfig"]>> | undefined;
  let qualityConfigRead = false;
  let archiveFailures = 0;
  for (const event of webhookBody.events) {
    const counts = {processed: 0, ignored: 0, failed: 0};
    const archiveErrorIgnored = (error: unknown): boolean => {
      if (error instanceof ArchivePersistenceError) archiveFailures++;
      if (error instanceof ArchiveRedactedError) {counts.ignored++; return true;}
      return false;
    };
    const runEvent = async () => {
    let archiveRecord: ArchiveEvent | null = null;
    if (dependencies.archiveStore) {
      try {archiveRecord = await withinTime(() => dependencies.archiveStore!.capture(event, dependencies.ownerUserId), remainingTimeout(deadlineAtMs, 2000));}
      catch {archiveFailures++; counts.failed++; dependencies.logger.error("Conversation admission failed.", {reason: "archive_store_error"}); return;}
      if (archiveRecord) dependencies.logger.info("Conversation event received.", {reason: "archive_received", archiveEventId: archiveRecord.id, eventType: archiveRecord.eventType});
      if (archiveRecord?.redacted && archiveRecord.eventType !== "unsend") {counts.ignored++; return;}
    }
    let session: DevEventSession | undefined;
    const eventStarted = Date.now();
    if (dependencies.eventOperationStore) {
      try {
        session = (await (dependencies.solReviewEnabled ?
          withinTime(() => dependencies.eventOperationStore!.claim(event), remainingTimeout(deadlineAtMs, 2000)) :
          dependencies.eventOperationStore.claim(event))) ?? undefined;
        if (session && dependencies.solReviewEnabled) session.setDeadline(deadlineAtMs);
        if (!session) {counts.ignored++; return;}
      } catch {
        counts.failed++;
        dependencies.logger.error("DEV event claim unavailable.", {reason: "operation_claim_error"});
        return;
      }
    }
    const captureStarted = Date.now();
    session?.duration("claim", captureStarted - eventStarted);
    // Claim precedes quality capture, commands, settings, transcription and replies.
    if (!qualityConfigRead) {
      qualityConfig = dependencies.qualityStore ? await qualityOperation(() => dependencies.qualityStore!.getConfig(), dependencies) ?? null : null;
      qualityConfigRead = true;
    }
    const recordingCommand = isGroupTextMessageEvent(event) && RECORDING_COMMANDS.includes(event.message.text.trim());
    const captureConfig = dependencies.archiveStore ? archiveRecord ? {enabled: true as const, groups: [{id: archiveRecord.groupId, name: archiveRecord.groupName}], startedAt: new Date()} : null : qualityConfig;
    const candidate = captureConfig && !recordingCommand ? captureQualityOriginal(event, captureConfig, new Date(), groupId => dependencies.logger.error("Translation quality event has no stable ID.", {reason: "quality_event_id_missing", groupKey: createHash("sha256").update(groupId).digest("hex")})) : null;
    const recordingEnabled = dependencies.archiveStore ? Boolean(archiveRecord) : candidate ? await qualityOperation(() => dependencies.qualityStore!.getRecordingEnabled(candidate.groupId), dependencies, candidate.webhookEventId ?? undefined) : false;
    const original = recordingEnabled === true ? candidate : null;
    if (original && session) original.operationId = session.operationId;
    const trace: QualityTrace = {outcome: "ignored", deliveryStatus: "not_attempted", completedAt: new Date(), ...(session ? {operationId: session.operationId} : {})};
    let eventDependencies = original || session || archiveRecord ? traceQualityDependencies(dependencies, trace) : dependencies;
    let translationRecordStarted = false;
    if (dependencies.archiveStore && original) eventDependencies = {...eventDependencies, beginTranslationRecord: async () => {
      if (translationRecordStarted) return;
      try {await withinTime(() => dependencies.qualityStore!.saveOriginal({...structuredClone(original), archiveEventId: archiveRecord?.id ?? null}), remainingTimeout(deadlineAtMs, 2000)); translationRecordStarted = true;}
      catch (error) {if (error instanceof ArchiveRedactedError) throw error; throw new ArchivePersistenceError();}
    }};
    if (session) {
      session.duration("settings_capture", Date.now() - captureStarted);
      const captured = eventDependencies;
      const eventSession = session;
      eventDependencies = {...captured, eventSession,
        ...(dependencies.createEventTranslationProgram ? {getTranslationProgram: dependencies.createEventTranslationProgram(eventSession, original ? {
          onInput: contents => {assertDeadlineActive(); trace.nmtInputContents = [...contents];},
          onOutput: contents => {assertDeadlineActive(); trace.nmtOutputContents = copyNmtOutputContents(contents);},
        } : undefined)} : {}),
        settingsStore: {
          getSettings: id => eventSession.timed("settings", () => dependencies.solReviewEnabled ?
            withinTime(() => captured.settingsStore.getSettings(id), remainingTimeout(deadlineAtMs, 2000)) : captured.settingsStore.getSettings(id)),
          setModeAndEnabled: (...args) => eventSession.timed("settings", () => captured.settingsStore.setModeAndEnabled(...args)),
          setTextTranslationEnabled: (...args) => eventSession.timed("settings", () => captured.settingsStore.setTextTranslationEnabled(...args)),
          setAudioTranscriptionEnabled: (...args) => eventSession.timed("settings", () => captured.settingsStore.setAudioTranscriptionEnabled(...args)),
        },
        replier: {supportsReplyObserver: captured.replier.supportsReplyObserver, replyText: async (token, text, context, _deadline, observer) => {
          const translationStatus = trace.outcome === "translated" ? "validated" : trace.outcome === "failed" ?
            eventSession.providerStatus === "provider_succeeded" && eventSession.telemetry.failureStage === "validation" ? "quality_rejected" : "service_error" : "skipped";
          if (trace.reason && !eventSession.telemetry.reason) eventSession.telemetry.reason = trace.reason;
          await eventSession.translation(translationStatus);
          await eventSession.deliver(() => observer ? captured.replier.replyText(token, text, context, dependencies.solReviewEnabled ? deadlineAtMs : undefined, observer) : dependencies.solReviewEnabled ?
            captured.replier.replyText(token, text, context, deadlineAtMs) :
            context ? captured.replier.replyText(token, text, context) : captured.replier.replyText(token, text));
        }},
      };
    }
    const failedBefore = counts.failed;
    if (original) dependencies.logger.info("Translation quality event received.", {reason: "quality_received", groupKey: createHash("sha256").update(original.groupId).digest("hex"), webhookEventId: original.webhookEventId, messageId: original.messageId});
    if (original && !dependencies.archiveStore) await qualityOperation(() => eventDependencies.qualityStore!.saveOriginal(structuredClone(original)), eventDependencies, original.webhookEventId ?? undefined);
    if (archiveRecord) eventDependencies = archiveEventDependencies(eventDependencies, archiveRecord);
    try {
    if (
      isUserTextMessageEvent(event) &&
      event.message.text.trim() === MY_LINE_USER_ID_COMMAND
    ) {
      try {
        await eventDependencies.replier.replyText(
          event.replyToken,
          `你的 LINE userId：\n${event.source.userId}`,
        );
        counts.processed += 1;
      } catch (error: unknown) {
        if (archiveErrorIgnored(error)) return;
        counts.failed += 1;
        logEventFailure(
          "Failed to reply with a LINE user ID.",
          event.webhookEventId,
          error,
          eventDependencies,
        );
      }
      return;
    }

    if (isUserTextMessageEvent(event) && eventDependencies.qualityStore && eventDependencies.ownerUserId && event.source.userId === eventDependencies.ownerUserId) {
      let reply: string | null | undefined;
      let knownActiveReport = false;
      const explicitReportControl = [REPORT_COMMAND, "/返回", "/取消", "確認", "下一頁", "下一段"].includes(event.message.text.trim());
      if (qualityConfig) reply = await qualityOperation(() => processTranslationReport(event, eventDependencies.ownerUserId, eventDependencies.qualityStore!, qualityConfig!, new Date(), () => {knownActiveReport = true;}), eventDependencies, event.webhookEventId);
      if (reply === undefined && qualityConfig && (explicitReportControl || knownActiveReport)) reply = "目前無法確認回報操作結果，請稍後重試；重複確認不會重複建案。";
      if (!qualityConfig && event.message.text.trim() === REPORT_COMMAND) reply = "翻譯錯誤回報目前無法使用，請稍後再試。";
      if (reply) {
        try {await eventDependencies.replier.replyText(event.replyToken, reply); counts.processed++;}
        catch (error) {if (archiveErrorIgnored(error)) return; counts.failed++; logEventFailure("Failed to reply to translation report.", event.webhookEventId, error, eventDependencies);}
        return;
      }
    }

    if (isGroupJoinEvent(event)) {
      try {
        const settings = await eventDependencies.settingsStore.getSettings(event.source.groupId);
        await eventDependencies.replier.replyText(
          event.replyToken,
          (settings.textTranslationEnabled || settings.audioTranscriptionEnabled) ?
            formatStatus(settings, Boolean(eventDependencies.qualityStore)) : JOIN_MESSAGE,
        );
        counts.processed += 1;
      } catch (error: unknown) {
        if (archiveErrorIgnored(error)) return;
        counts.failed += 1;
        logEventFailure(
          "Failed to initialize joined LINE group.",
          event.webhookEventId,
          error,
          eventDependencies,
        );
      }
      return;
    }

    // Private chats only support the ID command above; translation is group-only.
    if (isGroupAudioMessageEvent(event)) {
      try {
        const outcome = await processGroupAudioMessage(
          event,
          maxMessageLength,
          maxAudioDurationMs,
          maxAudioBytes,
          eventDependencies,
        );
        if (outcome === "processed") counts.processed += 1;
        else if (outcome === "failed") counts.failed += 1;
        else counts.ignored += 1;
      } catch (error: unknown) {
        if (archiveErrorIgnored(error)) return;
        counts.failed += 1;
        logEventFailure(
          "Failed to process a LINE chat audio message.",
          event.webhookEventId,
          error,
          eventDependencies,
        );
      }
      return;
    }

    if (!isGroupTextMessageEvent(event)) {
      if (original?.messageType === "audio") trace.reason = "unsupported_audio_provider";
      counts.ignored += 1;
      return;
    }

    try {
      const outcome = await processGroupTextMessage(event, maxMessageLength, eventDependencies);
      if (outcome === "processed") counts.processed += 1;
      else if (outcome === "failed") counts.failed += 1;
      else counts.ignored += 1;
    } catch (error: unknown) {
      if (archiveErrorIgnored(error)) return;
      counts.failed += 1;
      logEventFailure(
        "Failed to process a LINE chat message.",
        event.webhookEventId,
        error,
        eventDependencies,
      );
    }
    } finally {
      try {assertDeadlineActive();} catch {return;}
      if (session) {
        if (trace.translationMode && dependencies.qualityMetadata) {
          const metadata = dependencies.qualityMetadata(trace.translationMode as TranslationMode, trace.sourceLanguageCode ?? undefined);
          session.telemetry.engine ??= metadata.engine;
          session.telemetry.glossary ??= metadata.glossary;
          session.telemetry.revision ??= metadata.revision;
        }
        session.telemetry.sourceLanguageCode ??= trace.sourceLanguageCode ?? null;
        session.telemetry.targetLanguageCode ??= trace.targetLanguageCode ?? null;
        session.telemetry.reason ??= trace.reason ?? null;
        try {
          if (session.translationStatus === "pending") await session.translation(counts.failed > failedBefore ? "service_error" : "skipped");
          await session.complete();
        } catch {dependencies.logger.error("DEV event completion unavailable.", {reason: "operation_completion_error", operationId: session.operationId});}
      }
      if (original && (!dependencies.archiveStore || translationRecordStarted)) {
        if (counts.failed > failedBefore && trace.deliveryStatus !== "failed") {trace.outcome = "failed"; trace.reason ??= "event_processing_error";}
        trace.completedAt = new Date();
        if (trace.translationMode && dependencies.qualityMetadata) Object.assign(trace, dependencies.qualityMetadata(trace.translationMode as TranslationMode, trace.sourceLanguageCode ?? undefined));
        if (session) Object.assign(trace, {adapterVersion: session.telemetry.adapterVersion, protectionVersion: session.telemetry.protectionVersion,
          requestProfile: session.telemetry.requestProfile ?? null, validationScope: session.telemetry.validationScope ?? null,
          semanticEvaluation: session.telemetry.semanticEvaluation ?? null,
          ...(session.telemetry.solReview ? {solReview: session.telemetry.solReview} : {})});
        const saved = await qualityOperation(async () => {await dependencies.qualityStore!.complete(structuredClone(original), structuredClone(trace)); return true;}, dependencies, original.webhookEventId ?? undefined);
        if (saved) dependencies.logger.info("Translation quality capture completed.", {reason: "quality_capture", webhookEventId: original.webhookEventId, outcome: trace.outcome, deliveryStatus: trace.deliveryStatus});
      }
      if (archiveRecord) {
        trace.completedAt = new Date();
        await qualityOperation(() => dependencies.archiveStore!.finish(archiveRecord!, structuredClone(trace)), eventDependencies, archiveRecord.webhookEventId ?? undefined);
      }
    }
    };
    try {
      if (dependencies.solReviewEnabled || dependencies.archiveStore) await new DeadlineScope(deadlineAtMs).run(runEvent);
      else await runEvent();
    } catch {if (!counts.processed && !counts.ignored) counts.failed = 1;}
    processed += counts.processed; ignored += counts.ignored; failed += counts.failed;
  }
  dependencies.logger.info("LINE webhook processed.", {
    eventCount: webhookBody.events.length,
    processed,
    ignored,
    failed,
  });

  return {status: archiveFailures ? 503 : 200, body: {ok: !archiveFailures, processed, ignored, failed}};
}

type MessageOutcome = "processed" | "ignored" | "failed";

async function processGroupAudioMessage(
  event: GroupAudioMessageEvent,
  maxMessageLength: number,
  maxAudioDurationMs: number,
  maxAudioBytes: number,
  dependencies: WebhookDependencies,
): Promise<MessageOutcome> {
  const settings = await dependencies.settingsStore.getSettings(event.source.groupId);
  if (!settings.audioTranscriptionEnabled) {
    if (dependencies.qualityTrace) dependencies.qualityTrace.reason = "audio_disabled";
    return replySkippedMessage(event.replyToken, dependencies);
  }
  let sourceText: string | null = null;
  let languagePair: LanguagePair | undefined;
  let replyText: string;
  let stage: FailureStage = "input";
  try {
    if (event.message.duration !== undefined && event.message.duration > maxAudioDurationMs) {
      throw new ContentLimitError("audio_too_long");
    }
    stage = "audio_download";
    const boundAudio = dependencies.solReviewEnabled;
    const audioDeadline = dependencies.deadlineAtMs! - 10000;
    const audioContent = boundAudio ? await withinTime(() => dependencies.audioContentLoader.getMessageContent(event.message.id, maxAudioBytes, audioDeadline),
      remainingTimeout(audioDeadline)) : await dependencies.audioContentLoader.getMessageContent(event.message.id, maxAudioBytes);
    stage = "transcription";
    const transcribe = () => boundAudio ?
      dependencies.transcriber.transcribe(audioContent, getSpeechLanguageCodes(settings.translationMode), audioDeadline) :
      dependencies.transcriber.transcribe(audioContent, getSpeechLanguageCodes(settings.translationMode));
    const transcription = boundAudio ? await withinTime(transcribe, remainingTimeout(audioDeadline)) : await transcribe();
    sourceText = transcription.text;
    if (dependencies.eventSession) dependencies.eventSession.telemetry.sourceCharacters = [...sourceText].length;
    if (dependencies.qualityTrace) dependencies.qualityTrace.sourceText = sourceText;
    if (!sourceText.trim()) throw new Error("Empty transcript");
    languagePair = settings.textTranslationEnabled ? getTextLanguagePair(sourceText, settings.translationMode) : undefined;
    stage = "input";
    if (sourceText.length > maxMessageLength) throw new ContentLimitError("transcript_too_long");
    replyText = sourceText;
    let acceptedTranslation: string | null = null;
    if (languagePair) {
      await dependencies.beginTranslationRecord?.();
      stage = "translation_setup";
      if (dependencies.qualityTrace) Object.assign(dependencies.qualityTrace, languagePair);
      const {translator} = resolveTranslationProgram(dependencies, settings.translationMode);
      stage = "translation";
      const context = await reviewContext(event, settings.translationMode, dependencies);
      const translatedText = context ? await translator.translate(sourceText, languagePair.sourceLanguageCode, languagePair.targetLanguageCode, context)
        : await translator.translate(sourceText, languagePair.sourceLanguageCode, languagePair.targetLanguageCode);
      if (!translatedText.trim()) throw new Error("Empty translation");
      replyText = sourceText + "\n\n" + translatedText;
      acceptedTranslation = translatedText;
    }
    stage = "reply_validation";
    buildReplyMessages(replyText);
    if (dependencies.qualityTrace) Object.assign(dependencies.qualityTrace, languagePair, {translatedText: acceptedTranslation, outcome: acceptedTranslation === null ? "skipped" : "translated"});
  } catch (error: unknown) {
    if (error instanceof ArchivePersistenceError || error instanceof ArchiveRedactedError) throw error;
    return reportTranslationFailure(event, settings.translationMode, sourceText, languagePair, stage, error, dependencies);
  }
  // Delivery errors must not trigger another reply or be saved as translation failures.
  await dependencies.replier.replyText(event.replyToken, replyText);
  return "processed";
}

async function processGroupTextMessage(
  event: GroupTextMessageEvent,
  maxMessageLength: number,
  dependencies: WebhookDependencies,
): Promise<MessageOutcome> {
  const text = event.message.text;
  const command = text.trim();
  const conversationId = event.source.groupId;

  if (RECORDING_COMMANDS.includes(command)) {
    if (!dependencies.qualityStore) return "ignored";
    if (!dependencies.ownerUserId || !canChangeSettings(event, dependencies.ownerUserId)) {
      await dependencies.replier.replyText(event.replyToken, UNAUTHORIZED_MESSAGE);
      return "processed";
    }
    const result = await qualityOperation(() => dependencies.qualityStore!.setRecordingEnabled(
      conversationId, command === ENABLE_RECORDING_COMMAND, event.source.userId!,
      event.webhookEventId ?? (event.message.id ? `message:${event.message.id}` : ""), event.timestamp!), dependencies, event.webhookEventId);
    await dependencies.replier.replyText(event.replyToken, result ?
      `${result.applied ? "已更新本群設定。" : "此指令已處理或已過期，未變更設定。"}\n交談記錄：${result.enabled ? "已開啟" : "已關閉"}` :
      "目前無法確認記錄設定是否更新，請用 /翻譯設定 確認後再試。");
    return "processed";
  }

  if (RETIRED_COMMANDS.has(command) || command === MY_LINE_USER_ID_COMMAND) {
    return "ignored";
  }

  if (isSettingsChangeCommand(command)) {
    if (!canChangeSettings(event, dependencies.ownerUserId)) {
      await dependencies.replier.replyText(event.replyToken, UNAUTHORIZED_MESSAGE);
      return "processed";
    }

    const changedBy = event.source.userId;
    if (!changedBy) {
      await dependencies.replier.replyText(event.replyToken, UNAUTHORIZED_MESSAGE);
      return "processed";
    }

    const translationMode = getCommandMode(command);
    if (translationMode) {
      await dependencies.settingsStore.setModeAndEnabled(
        conversationId,
        translationMode,
        changedBy,
      );
      await dependencies.replier.replyText(
        event.replyToken,
        formatModeEnabledMessage(translationMode),
      );
      return "processed";
    }

    const settings = await dependencies.settingsStore.getSettings(conversationId);
    const isAudioCommand = command === ENABLE_AUDIO_COMMAND || command === DISABLE_AUDIO_COMMAND;
    const enabled = command === ENABLE_TEXT_COMMAND ||
      command === ENABLE_AUDIO_COMMAND;
    if (isAudioCommand) {
      await dependencies.settingsStore.setAudioTranscriptionEnabled(conversationId, enabled, changedBy);
      await dependencies.replier.replyText(event.replyToken,
        enabled ? "已啟用語音轉文字。逐字稿將依文字翻譯設定決定是否附上翻譯。" : "已停用語音轉文字。");
      return "processed";
    }
    await dependencies.settingsStore.setTextTranslationEnabled(conversationId, enabled, changedBy);
    await dependencies.replier.replyText(
      event.replyToken,
      enabled ?
        formatModeEnabledMessage(settings.translationMode) :
        "已停用文字翻譯。語音轉文字設定維持不變。",
    );
    return "processed";
  }

  if (command === TRANSLATION_SETTINGS_COMMAND) {
    const settings = await dependencies.settingsStore.getSettings(conversationId);
    const response = `${formatStatus(settings, Boolean(dependencies.qualityStore))}\n\n可用指令：\n${MAIN_COMMANDS}${dependencies.qualityStore ? "\n" + RECORDING_COMMANDS.join("\n") : ""}`;
    await dependencies.replier.replyText(event.replyToken, response);
    return "processed";
  }

  const settings = await dependencies.settingsStore.getSettings(conversationId);
  if (!settings.textTranslationEnabled) return replySkippedMessage(event.replyToken, dependencies);
  if (text.length > maxMessageLength) {
    return reportTranslationFailure(event, settings.translationMode, text, undefined, "input",
      new ContentLimitError("text_too_long"), dependencies);
  }

  // Only standalone acknowledgements; keep longer business messages translatable.
  if (/^(?:ok|yes|no)[\s.!?,。！？，…]*$/iu.test(text.normalize("NFKC").trim())) {
    return replySkippedMessage(event.replyToken, dependencies);
  }

  const mentionRanges = getMentionRanges(event.message);
  const languageText = excludeTextRanges(text, mentionRanges);
  const languagePair = getTextLanguagePair(languageText, settings.translationMode);
  if (!languagePair) {
    return replySkippedMessage(event.replyToken, dependencies);
  }

  let translatedText: string;
  let acceptedTranslation: string;
  let translatedMentions: UserMention[] = [];
  let stage: FailureStage = "translation_setup";
  try {
    await dependencies.beginTranslationRecord?.();
    if (dependencies.qualityTrace) Object.assign(dependencies.qualityTrace, languagePair);
    const {translator, mentionAliases} = resolveTranslationProgram(dependencies, settings.translationMode);
    const translationArgs: [string, string, string, TranslationContext?] = [
      text, languagePair.sourceLanguageCode, languagePair.targetLanguageCode,
    ];
    const candidates = translator.translateWithRanges ?
      findUserMentions(event.message, mentionAliases) : [];
    const protectedRanges = [...mentionRanges];
    for (const {start, length} of candidates) {
      if (!protectedRanges.some((range) => range.start === start && range.length === length)) {
        protectedRanges.push({start, length});
      }
    }
    const context = await reviewContext(event, settings.translationMode, dependencies);
    if (protectedRanges.length || context) translationArgs.push({...context, ...(protectedRanges.length ? {protectedRanges} : {})});
    stage = "translation";
    if (candidates.length && translator.translateWithRanges) {
      const result = await translator.translateWithRanges(...translationArgs);
      translatedText = result.text;
      translatedMentions = restoreUserMentions(text, result.text, candidates, result.ranges);
    } else {
      translatedText = await translator.translate(...translationArgs);
    }
    if (!translatedText.trim()) throw new Error("Empty translation");
    acceptedTranslation = translatedText;
    if (normalizeTranslationText(text) === normalizeTranslationText(translatedText)) {
      translatedText = UNCHANGED_TRANSLATION_REPLY;
      translatedMentions = [];
    }
    stage = "reply_validation";
    buildReplyMessages(translatedText, translatedMentions.slice(0, 20));
    if (dependencies.qualityTrace) Object.assign(dependencies.qualityTrace, languagePair, {translatedText: acceptedTranslation, outcome: "translated"});
  } catch (error: unknown) {
    if (error instanceof ArchivePersistenceError || error instanceof ArchiveRedactedError) throw error;
    return reportTranslationFailure(event, settings.translationMode, text, languagePair, stage, error, dependencies);
  }

  if (translatedMentions.length) {
    await dependencies.replier.replyText(event.replyToken, translatedText,
      {groupId: event.source.groupId, mentions: translatedMentions});
  } else {
    await dependencies.replier.replyText(event.replyToken, translatedText);
  }
  return "processed";
}

async function replySkippedMessage(replyToken: string, dependencies: WebhookDependencies): Promise<"processed"> {
  await dependencies.replier.replyText(replyToken, UNCHANGED_TRANSLATION_REPLY);
  return "processed";
}

async function reportTranslationFailure(
  event: GroupTextMessageEvent | GroupAudioMessageEvent,
  translationMode: TranslationMode,
  sourceText: string | null,
  languagePair: LanguagePair | undefined,
  stage: FailureStage,
  error: unknown,
  dependencies: WebhookDependencies,
): Promise<"failed"> {
  assertDeadlineActive();
  if (event.message.type === "text" || languagePair) await dependencies.beginTranslationRecord?.();
  const reason = failureReason(error, stage);
  if (dependencies.eventSession) {
    if (error instanceof SolServiceError) {
      dependencies.eventSession.telemetry.reason = reason;
      dependencies.eventSession.telemetry.failureStage = error.stage;
    } else if (error instanceof TranslationQualityError) {
      dependencies.eventSession.telemetry.reason = error.reason;
      dependencies.eventSession.telemetry.failureStage = "validation";
    } else {
      dependencies.eventSession.telemetry.reason ??= reason;
      dependencies.eventSession.telemetry.failureStage ??= stage;
    }
  }
  if (dependencies.qualityTrace) Object.assign(dependencies.qualityTrace, languagePair, {outcome: "failed", reason, translatedText: null});
  const record: TranslationFailureRecord = {
    groupId: event.source.groupId, webhookEventId: event.webhookEventId,
    messageId: event.message.id, messageType: event.message.type,
    sourceText, translationMode, ...languagePair, stage, reason,
  };
  dependencies.logger.error("LINE message processing failed.", {webhookEventId: event.webhookEventId, stage, reason});
  // Start independently so a slow/unavailable database cannot postpone the LINE reply.
  assertDeadlineActive();
  const results = await Promise.allSettled([
    dependencies.solReviewEnabled ? withinTime(() => dependencies.failureStore.save(structuredClone(record)), remainingTimeout(dependencies.deadlineAtMs, 2000)) : Promise.resolve().then(() => dependencies.failureStore.save(record)),
    Promise.resolve().then(() => dependencies.replier.replyText(event.replyToken, TRANSLATION_FAILURE_REPLY)),
  ]);
  if (results[1].status === "rejected" && (results[1].reason instanceof ArchivePersistenceError || results[1].reason instanceof ArchiveRedactedError)) throw results[1].reason;
  if (results[0].status === "rejected") dependencies.logger.error("Failed to save translation failure.", {webhookEventId: event.webhookEventId, reason: "failure_store_error"});
  if (results[1].status === "rejected") dependencies.logger.error("Failed to deliver translation failure symbol.", {webhookEventId: event.webhookEventId, reason: "line_reply_error"});
  return "failed";
}

async function reviewContext(event: GroupTextMessageEvent | GroupAudioMessageEvent, mode: TranslationMode,
  dependencies: WebhookDependencies): Promise<TranslationContext | undefined> {
  if (!dependencies.solReviewEnabled) return undefined;
  requestTimeout(dependencies.deadlineAtMs);
  const quoted = (event.message as {quotedMessageId?: unknown}).quotedMessageId;
  let quoteContext: QuoteContext = {status: typeof quoted === "string" && quoted ? "unknown" : "not_quoted"};
  if (typeof quoted === "string" && quoted && dependencies.qualityStore?.getQuotedOriginal) {
    try {
      const value = await withinTime(() => dependencies.qualityStore!.getQuotedOriginal!(event.source.groupId, quoted),
        requestTimeout(dependencies.deadlineAtMs, 2000));
      // Never accept an oversized, malformed or truncated context from a port.
      if (value.status === "known" && typeof value.text === "string" && value.text.trim() && value.text.length <= 2000) quoteContext = {status: "known", text: value.text};
    } catch { /* Unknown is deliberately usable, without fabricated context. */ }
  }
  requestTimeout(dependencies.deadlineAtMs);
  return {deadlineAtMs: dependencies.deadlineAtMs, quoteContext};
}

function normalizeTranslationText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").replace(/\s*([?？!！,，.。:：;；()（）])\s*/gu, "$1");
}

function getTextLanguagePair(
  text: string,
  translationMode: TranslationMode,
): LanguagePair | undefined {
  const secondaryLanguageCode = getSecondaryLanguageCode(translationMode);
  if (containsChinese(text)) {
    if (translationMode === "en-to-zh") return undefined;
    return {
      sourceLanguageCode: "zh-TW",
      targetLanguageCode: secondaryLanguageCode,
    };
  }
  if (containsLatin(text)) {
    if (translationMode === "zh-to-en") return undefined;
    return {
      sourceLanguageCode: secondaryLanguageCode,
      targetLanguageCode: "zh-TW",
    };
  }
  return undefined;
}

function getSpeechLanguageCodes(translationMode: TranslationMode): string[] {
  return [
    "cmn-Hant-TW",
    translationMode === "zh-vi" ? "vi-VN" : "en-US",
  ];
}

function getSecondaryLanguageCode(translationMode: TranslationMode): "en" | "vi" {
  return translationMode === "zh-vi" ? "vi" : "en";
}

function canChangeSettings(event: GroupTextMessageEvent, ownerUserId: string): boolean {
  return event.source.userId === ownerUserId;
}

function getCommandMode(command: string): TranslationMode | undefined {
  return Object.hasOwn(MODE_COMMANDS, command) ? MODE_COMMANDS[command] : undefined;
}

function resolveTranslationProgram(dependencies: WebhookDependencies, mode: TranslationMode): TranslationProgram {
  if (dependencies.getTranslationProgram) {
    const program = dependencies.getTranslationProgram(mode);
    return dependencies.solReviewEnabled ? {...program, translator: scopedTranslator(program.translator, mode, dependencies.deadlineAtMs!)} : program;
  }
  if (!dependencies.translator) throw new Error("Translation program is not configured.");
  return {translator: dependencies.solReviewEnabled ? scopedTranslator(dependencies.translator, mode, dependencies.deadlineAtMs!) : dependencies.translator, mentionAliases: mode === "zh-vi" ? [] : dependencies.mentionAliases ?? []};
}

function isSettingsChangeCommand(command: string): boolean {
  return getCommandMode(command) !== undefined ||
    [ENABLE_TEXT_COMMAND,
      DISABLE_TEXT_COMMAND, ENABLE_AUDIO_COMMAND, DISABLE_AUDIO_COMMAND].includes(command);
}

function formatStatus(settings: ConversationSettings, recordingAvailable = false): string {
  return `翻譯模式：${formatModeLabel(settings.translationMode)}\n` +
    `文字翻譯：${settings.textTranslationEnabled ? "已啟用" : "未啟用"}\n` +
    `語音轉文字：${settings.audioTranscriptionEnabled ? "已啟用" : "未啟用"}` +
    (recordingAvailable ? `\n交談記錄：${settings.recordingEnabled !== false ? "已開啟" : "已關閉"}` : "");
}

function formatModeEnabledMessage(translationMode: TranslationMode): string {
  if (translationMode === "zh-to-en") {
    return "已啟用中翻英。僅將中文訊息翻譯為英文，英文文字回覆 👆。語音轉文字設定維持不變。";
  }
  if (translationMode === "en-to-zh") {
    return "已啟用英翻中。僅將英文訊息翻譯為繁體中文，中文文字回覆 👆。語音轉文字設定維持不變。";
  }
  if (translationMode === "zh-vi") {
    return "已啟用中越翻譯。中文訊息將翻譯為越南文，越南文訊息將翻譯為繁體中文。";
  }
  return "已啟用中英翻譯。中文訊息將翻譯為英文，英文訊息將翻譯為繁體中文。";
}

function formatModeLabel(translationMode: TranslationMode): string {
  const labels: Record<TranslationMode, string> = {
    "zh-to-en": "中翻英",
    "en-to-zh": "英翻中",
    "zh-en": "中英",
    "zh-vi": "中越",
  };
  return labels[translationMode];
}

function logEventFailure(
  message: string,
  webhookEventId: string | undefined,
  _error: unknown,
  dependencies: WebhookDependencies,
): void {
  dependencies.logger.error(message, {
    webhookEventId,
    error: "event_processing_error",
  });
}

function scopedTranslator(translator: Translator, mode: TranslationMode, deadline: number): Translator {
  const end = deadline - 10000;
  const run = <T>(operation: () => Promise<T>) => withinTime(operation, remainingTimeout(end, 40000));
  return {translate: (...args) => run(() => translator.translate(...args)),
    ...(translator.translateWithRanges ? {translateWithRanges: (...args: Parameters<NonNullable<Translator["translateWithRanges"]>>) =>
      run(() => translator.translateWithRanges!(...args))} : {})};
}
function scopedWebhookDependencies(dependencies: WebhookDependencies): WebhookDependencies {
  const end = dependencies.deadlineAtMs!;
  const run = <T>(operation: () => Promise<T>, cap = 2000) => withinTime(operation, remainingTimeout(end, cap));
  return {...dependencies,
    settingsStore: {
      getSettings: (...args) => run(() => dependencies.settingsStore.getSettings(...args)),
      setModeAndEnabled: (...args) => run(() => dependencies.settingsStore.setModeAndEnabled(...args)),
      setTextTranslationEnabled: (...args) => run(() => dependencies.settingsStore.setTextTranslationEnabled(...args)),
      setAudioTranscriptionEnabled: (...args) => run(() => dependencies.settingsStore.setAudioTranscriptionEnabled(...args)),
    },
    replier: {supportsReplyObserver: dependencies.replier?.supportsReplyObserver, replyText: (token, text, context, _deadline, observer) =>
      run(() => observer ? dependencies.replier.replyText(token, text, context, end, observer) : dependencies.replier.replyText(token, text, context, end), 15000)},
  };
}
