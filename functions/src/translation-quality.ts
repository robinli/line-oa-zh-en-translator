import type {WebhookDependencies} from "./webhook.js";
import type {QualityCompletion, QualityConfig, QualityOriginal} from "./translation-quality-store.js";
import {isQualityGroupId, qualityGroupName} from "./translation-quality-store.js";

export interface QualityTrace extends QualityCompletion {}
export async function qualityOperation<T>(operation: () => Promise<T>, dependencies: WebhookDependencies, eventId?: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("quality_deadline")), 1500);
    })]);
  } catch {
    dependencies.logger.error("Translation quality storage unavailable.", {reason: "quality_store_error", webhookEventId: eventId ?? null});
    return undefined;
  } finally {if (timer) clearTimeout(timer);}
}
export function captureQualityOriginal(event: unknown, config: QualityConfig, now = new Date(), onMissingId?: (groupId: string) => void): QualityOriginal | null {
  if (!event || typeof event !== "object") return null;
  const value = event as Record<string, unknown>;
  const source = value.source as Record<string, unknown> | undefined;
  const message = value.message as Record<string, unknown> | undefined;
  if (value.type !== "message" || source?.type !== "group" || typeof source.groupId !== "string" || !message || typeof message.type !== "string") return null;
  if (!isQualityGroupId(source.groupId)) return null;
  const group = config.groups.find(item => item.id === source.groupId) ?? {id: source.groupId, name: qualityGroupName(source.groupId)};
  const eventId = typeof value.webhookEventId === "string" && value.webhookEventId ? value.webhookEventId : null;
  const messageId = typeof message.id === "string" && message.id ? message.id : null;
  if (!eventId && !messageId) {onMissingId?.(group.id); return null;}
  return {groupId: group.id, groupName: group.name, senderUserId: typeof source.userId === "string" ? source.userId : null,
    webhookEventId: eventId, messageId, messageType: message.type, quotedMessageId: typeof message.quotedMessageId === "string" ? message.quotedMessageId : null,
    sourceText: message.type === "text" && typeof message.text === "string" ? message.text : null,
    eventTime: typeof value.timestamp === "number" && Number.isFinite(value.timestamp) && Math.abs(value.timestamp) <= 8640000000000000 ? new Date(value.timestamp) : now, recordedAt: now};
}
export function traceQualityDependencies(dependencies: WebhookDependencies, trace: QualityTrace): WebhookDependencies {
  return {...dependencies, qualityTrace: trace,
    settingsStore: {
      getSettings: async id => {const settings = await dependencies.settingsStore.getSettings(id); trace.translationMode = settings.translationMode; return settings;},
      setModeAndEnabled: async (id, mode, by) => {await dependencies.settingsStore.setModeAndEnabled(id, mode, by); trace.translationMode = mode;},
      setAudioTranscriptionEnabled: (...args) => dependencies.settingsStore.setAudioTranscriptionEnabled(...args),
      setTextTranslationEnabled: (...args) => dependencies.settingsStore.setTextTranslationEnabled(...args),
    },
    replier: {replyText: async (token, text, context) => {
      trace.replyText = text;
      if (trace.outcome === "ignored") trace.outcome = "skipped";
      try {
        // Preserve argument arity for existing repliers and their tests.
        if (context) await dependencies.replier.replyText(token, text, context);
        else await dependencies.replier.replyText(token, text);
        trace.deliveryStatus = "sent";
      } catch (error) {trace.deliveryStatus = "failed"; trace.reason ??= "line_reply_error"; throw error;}
    }},
  };
}
