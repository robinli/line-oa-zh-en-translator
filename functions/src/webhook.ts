import {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_AUDIO_DURATION_MS,
  DEFAULT_MAX_MESSAGE_LENGTH,
  containsChinese,
  containsLatin,
  isChatAudioMessageEvent,
  isChatTextMessageEvent,
  isGroupJoinEvent,
  isUserTextMessageEvent,
  type ChatAudioMessageEvent,
  type ChatTextMessageEvent,
  type LineWebhookBody,
  type TranslationMode,
} from "./domain.js";
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
export const ENABLE_TRANSLATION_COMMAND = "/啟用翻譯";
export const DISABLE_TRANSLATION_COMMAND = "/停用翻譯";
export const TRANSLATION_STATUS_COMMAND = "/翻譯狀態";
export const TRANSLATION_SETTINGS_COMMAND = "/翻譯設定";
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
const MAIN_COMMANDS = [
  ...Object.keys(MODE_COMMANDS), DISABLE_TRANSLATION_COMMAND,
  ENABLE_TEXT_COMMAND, DISABLE_TEXT_COMMAND, ENABLE_AUDIO_COMMAND, DISABLE_AUDIO_COMMAND,
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
  channelSecret: string;
  translator: Translator;
  transcriber: AudioTranscriber;
  audioContentLoader: AudioContentLoader;
  replier: LineReplier;
  settingsStore: ConversationSettingsStore;
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

  for (const event of webhookBody.events) {
    if (
      isUserTextMessageEvent(event) &&
      event.message.text.trim() === MY_LINE_USER_ID_COMMAND
    ) {
      try {
        await dependencies.replier.replyText(
          event.replyToken,
          `你的 LINE userId：\n${event.source.userId}`,
        );
        processed += 1;
      } catch (error: unknown) {
        failed += 1;
        logEventFailure(
          "Failed to reply with a LINE user ID.",
          event.webhookEventId,
          error,
          dependencies,
        );
      }
      continue;
    }

    if (isGroupJoinEvent(event)) {
      try {
        const settings = await dependencies.settingsStore.getSettings(event.source.groupId);
        await dependencies.replier.replyText(
          event.replyToken,
          (settings.textTranslationEnabled || settings.audioTranscriptionEnabled) ?
            formatStatus(settings) : JOIN_MESSAGE,
        );
        processed += 1;
      } catch (error: unknown) {
        failed += 1;
        logEventFailure(
          "Failed to initialize joined LINE group.",
          event.webhookEventId,
          error,
          dependencies,
        );
      }
      continue;
    }

    if (isChatAudioMessageEvent(event)) {
      try {
        const outcome = await processChatAudioMessage(
          event,
          maxMessageLength,
          maxAudioDurationMs,
          maxAudioBytes,
          dependencies,
        );
        outcome === "processed" ? processed += 1 : ignored += 1;
      } catch (error: unknown) {
        failed += 1;
        logEventFailure(
          "Failed to process a LINE chat audio message.",
          event.webhookEventId,
          error,
          dependencies,
        );
      }
      continue;
    }

    if (!isChatTextMessageEvent(event)) {
      ignored += 1;
      continue;
    }

    try {
      const outcome = await processChatTextMessage(event, maxMessageLength, dependencies);
      outcome === "processed" ? processed += 1 : ignored += 1;
    } catch (error: unknown) {
      failed += 1;
      logEventFailure(
        "Failed to process a LINE chat message.",
        event.webhookEventId,
        error,
        dependencies,
      );
    }
  }

  dependencies.logger.info("LINE webhook processed.", {
    eventCount: webhookBody.events.length,
    processed,
    ignored,
    failed,
  });

  return {status: 200, body: {ok: true, processed, ignored, failed}};
}

async function processChatAudioMessage(
  event: ChatAudioMessageEvent,
  maxMessageLength: number,
  maxAudioDurationMs: number,
  maxAudioBytes: number,
  dependencies: WebhookDependencies,
): Promise<"processed" | "ignored"> {
  const settings = await dependencies.settingsStore.getSettings(getConversationId(event));
  if (!settings.audioTranscriptionEnabled) {
    return "ignored";
  }

  if (
    event.message.duration !== undefined &&
    event.message.duration > maxAudioDurationMs
  ) {
    dependencies.logger.warn("Ignored LINE audio that exceeds the duration limit.", {
      webhookEventId: event.webhookEventId,
      audioDurationMs: event.message.duration,
      maxAudioDurationMs,
    });
    await dependencies.replier.replyText(
      event.replyToken,
      `語音長度超過 ${Math.floor(maxAudioDurationMs / 1_000)} 秒，目前無法轉為文字。`,
    );
    return "processed";
  }

  const audioContent = await dependencies.audioContentLoader.getMessageContent(
    event.message.id,
    maxAudioBytes,
  );
  const transcription = await dependencies.transcriber.transcribe(
    audioContent,
    getSpeechLanguageCodes(settings.translationMode),
  );

  const languagePair = settings.textTranslationEnabled ?
    getTextLanguagePair(transcription.text, settings.translationMode) : undefined;

  if (transcription.text.length > maxMessageLength) {
    dependencies.logger.warn("Ignored LINE audio transcript that exceeds the length limit.", {
      webhookEventId: event.webhookEventId,
      transcriptLength: transcription.text.length,
      maxMessageLength,
    });
    await dependencies.replier.replyText(
      event.replyToken,
      "語音辨識結果過長，目前無法透過 LINE 回覆。",
    );
    return "processed";
  }

  if (!languagePair) {
    await dependencies.replier.replyText(event.replyToken, transcription.text);
    return "processed";
  }

  const translatedText = await dependencies.translator.translate(
    transcription.text,
    languagePair.sourceLanguageCode,
    languagePair.targetLanguageCode,
  );
  await dependencies.replier.replyText(
    event.replyToken,
    `${transcription.text}\n\n${translatedText}`,
  );
  return "processed";
}

async function processChatTextMessage(
  event: ChatTextMessageEvent,
  maxMessageLength: number,
  dependencies: WebhookDependencies,
): Promise<"processed" | "ignored"> {
  const text = event.message.text;
  const command = text.trim();
  const conversationId = getConversationId(event);

  if (command === MY_LINE_USER_ID_COMMAND) {
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
    const enabled = command === ENABLE_TRANSLATION_COMMAND || command === ENABLE_TEXT_COMMAND ||
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

  if (
    command === TRANSLATION_STATUS_COMMAND ||
    command === TRANSLATION_SETTINGS_COMMAND
  ) {
    const settings = await dependencies.settingsStore.getSettings(conversationId);
    const response = command === TRANSLATION_SETTINGS_COMMAND ?
      `${formatStatus(settings)}\n\n可用指令：\n${MAIN_COMMANDS}` :
      formatStatus(settings);
    await dependencies.replier.replyText(event.replyToken, response);
    return "processed";
  }

  if (text.length > maxMessageLength) {
    dependencies.logger.warn("Ignored LINE message that exceeds the length limit.", {
      webhookEventId: event.webhookEventId,
      messageLength: text.length,
      maxMessageLength,
    });
    return "ignored";
  }

  const settings = await dependencies.settingsStore.getSettings(conversationId);
  if (!settings.textTranslationEnabled) {
    return "ignored";
  }

  const mentionRanges = getMentionRanges(event.message);
  const languageText = excludeTextRanges(text, mentionRanges);
  const languagePair = getTextLanguagePair(languageText, settings.translationMode);
  if (!languagePair) {
    return "ignored";
  }

  const translationArgs: [string, string, string, TranslationContext?] = [
    text, languagePair.sourceLanguageCode, languagePair.targetLanguageCode,
  ];
  const candidates = event.source.type === "group" && dependencies.translator.translateWithRanges ?
    findUserMentions(event.message, dependencies.mentionAliases ?? []) : [];
  const protectedRanges = [...mentionRanges];
  for (const {start, length} of candidates) {
    if (!protectedRanges.some((range) => range.start === start && range.length === length)) {
      protectedRanges.push({start, length});
    }
  }
  if (protectedRanges.length) translationArgs.push({protectedRanges});
  let translatedText: string;
  let translatedMentions: UserMention[] = [];
  if (candidates.length && dependencies.translator.translateWithRanges) {
    const result = await dependencies.translator.translateWithRanges(...translationArgs);
    translatedText = result.text;
    translatedMentions = restoreUserMentions(text, result.text, candidates, result.ranges);
  } else {
    translatedText = await dependencies.translator.translate(...translationArgs);
  }
  if (
    event.source.type === "group" &&
    normalizeTranslationText(text) === normalizeTranslationText(translatedText)
  ) {
    // An unchanged result may also indicate a translation issue; keep a diagnostic without content.
    dependencies.logger.warn("Skipped an unchanged translation for a LINE group text message.", {
      webhookEventId: event.webhookEventId,
      sourceLanguageCode: languagePair.sourceLanguageCode,
      targetLanguageCode: languagePair.targetLanguageCode,
    });
    return "ignored";
  }

  if (translatedMentions.length && event.source.type === "group") {
    await dependencies.replier.replyText(event.replyToken, translatedText,
      {groupId: event.source.groupId, mentions: translatedMentions});
  } else {
    await dependencies.replier.replyText(event.replyToken, translatedText);
  }
  return "processed";
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

function getConversationId(event: ChatTextMessageEvent | ChatAudioMessageEvent): string {
  return event.source.type === "group" ?
    event.source.groupId :
    `user:${event.source.userId}`;
}

function canChangeSettings(event: ChatTextMessageEvent, ownerUserId: string): boolean {
  return event.source.type === "user" || event.source.userId === ownerUserId;
}

function getCommandMode(command: string): TranslationMode | undefined {
  return Object.hasOwn(MODE_COMMANDS, command) ? MODE_COMMANDS[command] : undefined;
}

function isSettingsChangeCommand(command: string): boolean {
  return getCommandMode(command) !== undefined ||
    [ENABLE_TRANSLATION_COMMAND, DISABLE_TRANSLATION_COMMAND, ENABLE_TEXT_COMMAND,
      DISABLE_TEXT_COMMAND, ENABLE_AUDIO_COMMAND, DISABLE_AUDIO_COMMAND].includes(command);
}

function formatStatus(settings: ConversationSettings): string {
  return `翻譯模式：${formatModeLabel(settings.translationMode)}\n` +
    `文字翻譯：${settings.textTranslationEnabled ? "已啟用" : "未啟用"}\n` +
    `語音轉文字：${settings.audioTranscriptionEnabled ? "已啟用" : "未啟用"}`;
}

function formatModeEnabledMessage(translationMode: TranslationMode): string {
  if (translationMode === "zh-to-en") {
    return "已啟用中翻英。僅將中文訊息翻譯為英文，英文文字不回覆。語音轉文字設定維持不變。";
  }
  if (translationMode === "en-to-zh") {
    return "已啟用英翻中。僅將英文訊息翻譯為繁體中文，中文文字不回覆。語音轉文字設定維持不變。";
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
  error: unknown,
  dependencies: WebhookDependencies,
): void {
  dependencies.logger.error(message, {
    webhookEventId,
    error: toSafeErrorMessage(error),
  });
}

function toSafeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
