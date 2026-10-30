import {createHash} from "node:crypto";
import {isQualityGroupId, qualityGroupName} from "./translation-quality-store.js";
import type {QualityCompletion} from "./translation-quality-store.js";
import type {QuoteContext} from "./sol-review-types.js";

export const ARCHIVE_EVENTS = "lineConversationEvents";
export const ARCHIVE_MESSAGES = "lineConversationMessages";
export const ARCHIVE_JOBS = "lineConversationArchiveJobs";
export const ARCHIVE_CONFIG = "lineConversationArchiveConfig/current";
export const ARCHIVE_VERSION = "conversation-archive-v1";
export const ARCHIVE_MAX_ATTEMPTS = 8;
export const archiveKey = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const archiveMessageKey = (groupId: string, messageId: string): string => archiveKey([groupId, messageId]);
export class ArchivePersistenceError extends Error {constructor() {super("Conversation archive unavailable."); this.name = "ArchivePersistenceError";}}
export class ArchiveRedactedError extends Error {constructor() {super("Conversation message was unsent."); this.name = "ArchiveRedactedError";}}
export type ReplyArchiveStatus = "prepared" | "accepted" | "rejected" | "unknown";
export interface ArchiveEvent {
  schemaVersion: 1; version: typeof ARCHIVE_VERSION; id: string; groupId: string; groupName: string;
  eventType: string; messageType: string | null; messageId: string | null; messageKey: string | null;
  webhookEventId: string | null; senderUserId: string | null; eventTime: Date; receivedAt: Date;
  sourceText: string | null; metadata: Record<string, unknown>; redacted: boolean;
}
export interface ArchiveJob {
  id: string; kind: "download" | "purge"; groupId: string; messageId: string; messageKey: string;
  status: "pending" | "working" | "complete" | "missing"; attempts: number;
  owner?: string; leaseUntil?: Date; reason?: string | null;
}
export interface ReplyArchiveResult {status: "accepted" | "rejected" | "unknown"; messageIds?: string[]}
export interface ConversationArchiveStore {
  capture(event: unknown, ownerUserId: string): Promise<ArchiveEvent | null>;
  finish(record: ArchiveEvent, completion: QualityCompletion): Promise<void>;
  prepareReply(record: ArchiveEvent, attempt: number, messages: readonly unknown[]): Promise<string>;
  finishReply(id: string, result: ReplyArchiveResult): Promise<void>;
  getQuotedOriginal(groupId: string, messageId: string): Promise<QuoteContext>;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
// Explicit recursive projection excludes tokens, URLs outside the content-provider metadata, and SDK errors.
const fields = new Set(["id", "type", "text", "duration", "fileName", "fileSize", "title", "address", "latitude", "longitude",
  "packageId", "stickerId", "stickerResourceType", "keywords", "quotedMessageId", "index", "length", "productId", "emojiId",
  "emojis", "mention", "mentionees", "userId", "isSelf", "imageSet", "total", "contentProvider", "originalContentUrl", "previewImageUrl",
  "members", "joined", "left", "data", "params", "datetime", "date", "time", "trackingId", "videoPlayComplete"]);
export function archiveMetadata(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || value === null) return value;
  if (Array.isArray(value)) return value.map(item => archiveMetadata(item, depth + 1));
  return Object.fromEntries(Object.entries(object(value)).filter(([key]) => fields.has(key)).map(([key, item]) => [key, archiveMetadata(item, depth + 1)]));
}
export function captureArchiveEvent(event: unknown, now = new Date()): ArchiveEvent | null {
  const value = object(event), source = object(value.source), message = object(value.message);
  const groupId = string(source.groupId);
  if (source.type !== "group" || !groupId || !isQualityGroupId(groupId) || typeof value.type !== "string") return null;
  const eventType = value.type;
  const messageId = eventType === "unsend" ? string(object(value.unsend).messageId) : string(message.id);
  const webhookEventId = string(value.webhookEventId);
  const eventTime = typeof value.timestamp === "number" && Number.isFinite(value.timestamp) && Math.abs(value.timestamp) <= 8640000000000000 ? new Date(value.timestamp) : now;
  if (!webhookEventId && (!messageId || typeof value.timestamp !== "number")) throw new ArchivePersistenceError();
  const metadata = eventType === "unsend" ? {} : archiveMetadata({
    ...message, ...(value.joined ? {joined: value.joined} : {}), ...(value.left ? {left: value.left} : {}),
    ...(value.postback ? {data: object(value.postback).data, params: object(value.postback).params} : {}),
    ...(value.videoPlayComplete ? {videoPlayComplete: value.videoPlayComplete} : {}),
  }) as Record<string, unknown>;
  if (message.type === "text") delete metadata.text;
  return {schemaVersion: 1, version: ARCHIVE_VERSION, id: archiveKey(webhookEventId ? ["event", webhookEventId] : [eventType, groupId, messageId, value.timestamp, metadata, message.text]),
    groupId, groupName: qualityGroupName(groupId), eventType, messageType: string(message.type), messageId,
    messageKey: messageId ? archiveMessageKey(groupId, messageId) : null, webhookEventId, senderUserId: string(source.userId),
    eventTime, receivedAt: now, sourceText: (eventType === "message" || eventType === "messageEdited") && message.type === "text" ? string(message.text) : null,
    metadata, redacted: eventType === "unsend"};
}
export function isArchiveAttachment(record: ArchiveEvent): boolean {
  return record.eventType === "message" && ["image", "audio", "video", "file"].includes(record.messageType ?? "");
}
export function redactArchiveEvent(record: ArchiveEvent): ArchiveEvent {
  return {...record, sourceText: null, metadata: {}, redacted: true};
}
