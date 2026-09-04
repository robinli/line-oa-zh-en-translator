import {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_AUDIO_DURATION_MS,
  DEFAULT_MAX_MESSAGE_LENGTH,
  containsChinese,
  isGroupAudioMessageEvent,
  isGroupJoinEvent,
  isGroupTextMessageEvent,
  isUserAudioMessageEvent,
  isUserTextMessageEvent,
  type GroupAudioMessageEvent,
  type GroupTextMessageEvent,
  type LineWebhookBody,
  type UserAudioMessageEvent,
} from "./domain.js";
import {verifyLineSignature} from "./signature.js";
import type {
  AudioContentLoader,
  AudioTranscriber,
  GroupActivationStore,
  LineReplier,
  Translator,
} from "./services.js";

export const ENABLE_TRANSLATION_COMMAND = "/啟用翻譯";
export const DISABLE_TRANSLATION_COMMAND = "/停用翻譯";
export const TRANSLATION_STATUS_COMMAND = "/翻譯狀態";
export const MY_LINE_USER_ID_COMMAND = "/我的ID";

const JOIN_MESSAGE = `翻譯目前尚未啟用。請由授權者輸入 ${ENABLE_TRANSLATION_COMMAND}。`;
const ENABLED_MESSAGE = `已啟用中文翻譯。如需停用，請輸入 ${DISABLE_TRANSLATION_COMMAND}。`;
const DISABLED_MESSAGE = `已停用中文翻譯。如需重新啟用，請輸入 ${ENABLE_TRANSLATION_COMMAND}。`;
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
  activationStore: GroupActivationStore;
  ownerUserId: string;
  logger: WebhookLogger;
  maxMessageLength?: number;
  maxAudioDurationMs?: number;
  maxAudioBytes?: number;
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
    if (isUserTextMessageEvent(event)) {
      if (event.message.text.trim() !== MY_LINE_USER_ID_COMMAND) {
        ignored += 1;
        continue;
      }

      try {
        await dependencies.replier.replyText(
          event.replyToken,
          `你的 LINE userId：\n${event.source.userId}`,
        );
        processed += 1;
      } catch (error: unknown) {
        failed += 1;
        logEventFailure("Failed to reply with a LINE user ID.", event.webhookEventId, error, dependencies);
      }
      continue;
    }

    if (isUserAudioMessageEvent(event)) {
      try {
        await processAudioMessage(
          event,
          maxMessageLength,
          maxAudioDurationMs,
          maxAudioBytes,
          dependencies,
        );
        processed += 1;
      } catch (error: unknown) {
        failed += 1;
        logEventFailure(
          "Failed to process a LINE one-to-one audio message.",
          event.webhookEventId,
          error,
          dependencies,
        );
      }
      continue;
    }

    if (isGroupJoinEvent(event)) {
      try {
        const enabled = await dependencies.activationStore.isEnabled(event.source.groupId);
        await dependencies.replier.replyText(
          event.replyToken,
          enabled ? "中文翻譯目前已啟用。" : JOIN_MESSAGE,
        );
        processed += 1;
      } catch (error: unknown) {
        failed += 1;
        logEventFailure("Failed to initialize joined LINE group.", event.webhookEventId, error, dependencies);
      }
      continue;
    }

    if (isGroupAudioMessageEvent(event)) {
      try {
        const outcome = await processGroupAudioMessage(
          event,
          maxMessageLength,
          maxAudioDurationMs,
          maxAudioBytes,
          dependencies,
        );
        if (outcome === "processed") {
          processed += 1;
        } else {
          ignored += 1;
        }
      } catch (error: unknown) {
        failed += 1;
        logEventFailure(
          "Failed to process a LINE group audio message.",
          event.webhookEventId,
          error,
          dependencies,
        );
      }
      continue;
    }

    if (!isGroupTextMessageEvent(event)) {
      ignored += 1;
      continue;
    }

    try {
      const outcome = await processGroupTextMessage(event, maxMessageLength, dependencies);
      if (outcome === "processed") {
        processed += 1;
      } else {
        ignored += 1;
      }
    } catch (error: unknown) {
      failed += 1;
      logEventFailure("Failed to process a LINE group message.", event.webhookEventId, error, dependencies);
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

async function processGroupAudioMessage(
  event: GroupAudioMessageEvent,
  maxMessageLength: number,
  maxAudioDurationMs: number,
  maxAudioBytes: number,
  dependencies: WebhookDependencies,
): Promise<"processed" | "ignored"> {
  if (!(await dependencies.activationStore.isEnabled(event.source.groupId))) {
    return "ignored";
  }

  await processAudioMessage(
    event,
    maxMessageLength,
    maxAudioDurationMs,
    maxAudioBytes,
    dependencies,
  );
  return "processed";
}

async function processAudioMessage(
  event: GroupAudioMessageEvent | UserAudioMessageEvent,
  maxMessageLength: number,
  maxAudioDurationMs: number,
  maxAudioBytes: number,
  dependencies: WebhookDependencies,
): Promise<void> {
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
    return;
  }

  const audioContent = await dependencies.audioContentLoader.getMessageContent(
    event.message.id,
    maxAudioBytes,
  );
  const transcript = await dependencies.transcriber.transcribe(audioContent);

  if (transcript.length > maxMessageLength) {
    dependencies.logger.warn("Ignored LINE audio transcript that exceeds the length limit.", {
      webhookEventId: event.webhookEventId,
      transcriptLength: transcript.length,
      maxMessageLength,
    });
    await dependencies.replier.replyText(
      event.replyToken,
      "語音辨識結果過長，目前無法透過 LINE 回覆。",
    );
    return;
  }

  if (!containsChinese(transcript)) {
    await dependencies.replier.replyText(
      event.replyToken,
      `語音轉文字：\n${transcript}`,
    );
    return;
  }

  const translatedText =
    await dependencies.translator.translateTraditionalChineseToEnglish(transcript);
  await dependencies.replier.replyText(
    event.replyToken,
    `中文：\n${transcript}\n\n英文：\n${translatedText}`,
  );
}

async function processGroupTextMessage(
  event: GroupTextMessageEvent,
  maxMessageLength: number,
  dependencies: WebhookDependencies,
): Promise<"processed" | "ignored"> {
  const text = event.message.text;
  const command = text.trim();

  if (command === ENABLE_TRANSLATION_COMMAND || command === DISABLE_TRANSLATION_COMMAND) {
    if (event.source.userId !== dependencies.ownerUserId) {
      await dependencies.replier.replyText(event.replyToken, UNAUTHORIZED_MESSAGE);
      return "processed";
    }

    const enabled = command === ENABLE_TRANSLATION_COMMAND;
    await dependencies.activationStore.setEnabled(
      event.source.groupId,
      enabled,
      event.source.userId,
    );
    await dependencies.replier.replyText(
      event.replyToken,
      enabled ? ENABLED_MESSAGE : DISABLED_MESSAGE,
    );
    return "processed";
  }

  if (command === TRANSLATION_STATUS_COMMAND) {
    const enabled = await dependencies.activationStore.isEnabled(event.source.groupId);
    await dependencies.replier.replyText(
      event.replyToken,
      enabled ? "中文翻譯目前已啟用。" : "中文翻譯目前未啟用。",
    );
    return "processed";
  }

  if (!containsChinese(text)) {
    return "ignored";
  }

  if (text.length > maxMessageLength) {
    dependencies.logger.warn("Ignored LINE message that exceeds the length limit.", {
      webhookEventId: event.webhookEventId,
      messageLength: text.length,
      maxMessageLength,
    });
    return "ignored";
  }

  if (!(await dependencies.activationStore.isEnabled(event.source.groupId))) {
    return "ignored";
  }

  const translatedText = await dependencies.translator.translateTraditionalChineseToEnglish(text);
  await dependencies.replier.replyText(event.replyToken, translatedText);
  return "processed";
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

