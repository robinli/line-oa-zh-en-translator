import {createHash} from "node:crypto";
import {FieldPath, type Firestore} from "firebase-admin/firestore";
import {NMT_TEST_PROJECT} from "./nmt-isolation.js";

export const QUALITY_MESSAGES_COLLECTION = "lineTranslationMessages";
export const QUALITY_CASES_COLLECTION = "lineTranslationErrorCases";
export const QUALITY_SESSIONS_COLLECTION = "lineTranslationReportSessions";
export const QUALITY_CONFIG_PATH = "lineTranslationQualityConfig/current";
export const REPORT_SESSION_MS = 30 * 60 * 1000;
export interface QualityGroup {id: string; name: string}
export interface QualityConfig {enabled: true; groups: QualityGroup[]; startedAt: Date}
export interface QualityOriginal {
  groupId: string; groupName: string; senderUserId: string | null;
  webhookEventId: string | null; messageId: string | null; messageType: string; quotedMessageId?: string | null;
  eventTime: Date; recordedAt: Date; sourceText: string | null;
}
export interface QualityCompletion {
  sourceText?: string | null; translatedText?: string | null; replyText?: string | null;
  translationMode?: string | null; sourceLanguageCode?: string | null; targetLanguageCode?: string | null;
  engine?: string | null; glossary?: string | null; revision?: string | null;
  outcome: string; deliveryStatus: "not_attempted" | "sent" | "failed";
  reason?: string | null; completedAt: Date;
}
export type QualityMessage = QualityOriginal & Partial<QualityCompletion> & {id: string};
export interface SearchCursor {eventTime: number; id: string}
export interface QualitySearch {groupIds: string[]; start: Date; end: Date; keyword: string; cursor?: SearchCursor}
export interface QualitySearchResult {messages: QualityMessage[]; cursor: SearchCursor | null; scanned: number}
export interface ReportDraft {
  kind: "search" | "manual"; groupId?: string | null; groupName?: string;
  direction?: string; sourceText?: string; translatedText?: string | null;
  issue?: string; suggestion?: string | null; message?: QualityMessage;
}
export interface ReportSession {
  id: string; stage: string; expiresAt: number; draft: ReportDraft;
  search?: {groupIds: string[]; start: number; end: number; keyword: string; cursor?: SearchCursor};
  results?: QualityMessage[]; nextCursor?: SearchCursor | null; viewOffset?: number;
}
export interface QualityCase {id: string; ownerUserId: string; status: "pending_analysis"; createdAt: Date; draft: ReportDraft}
export interface ReportTransition {session: ReportSession | null; reply: string | null; errorCase?: QualityCase}
export interface TranslationQualityStore {
  getConfig(): Promise<QualityConfig | null>;
  saveOriginal(record: QualityOriginal): Promise<void>;
  complete(record: QualityOriginal, completion: QualityCompletion): Promise<void>;
  search(query: QualitySearch): Promise<QualitySearchResult>;
  transitionReport(ownerId: string, eventId: string,
    transition: (session: ReportSession | null) => Promise<ReportTransition>): Promise<string | null>;
}
export function qualityMessageId(record: QualityOriginal): string {
  return hash(record.webhookEventId ? ["event", record.webhookEventId] : ["message", record.groupId, record.messageId]);
}
export function qualityCaseId(ownerId: string, draftId: string): string {return "Q-" + hash([ownerId, draftId]).slice(0, 24);}
function hash(parts: unknown[]): string {return createHash("sha256").update(JSON.stringify(parts)).digest("hex");}
export function qualityDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function" ? value.toDate() : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}
export function normalizeQualityKeyword(value: string): string {return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();}
export function parseQualityConfig(value: unknown): QualityConfig | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.enabled !== true || !Array.isArray(data.groups) || data.groups.length !== 4) return null;
  const groups: QualityGroup[] = [];
  for (const group of data.groups) {
    if (!group || typeof group !== "object" || typeof group.id !== "string" || !/^C[0-9a-f]{32}$/iu.test(group.id) ||
      typeof group.name !== "string" || !group.name.trim() || group.name.length > 100 || /\bT1\b/iu.test(group.name) || groups.some(item => item.id === group.id)) return null;
    groups.push({id: group.id, name: group.name});
  }
  const startedAt = qualityDate(data.startedAt);
  return startedAt ? {enabled: true, groups, startedAt} : null;
}
// Allowlist projection deliberately excludes tokens, attachments, arbitrary errors and rejected outputs.
function originalData(record: QualityOriginal): Record<string, unknown> {
  return {schemaVersion: 1, groupId: record.groupId, groupName: record.groupName,
    senderUserId: record.senderUserId, webhookEventId: record.webhookEventId, messageId: record.messageId,
    quotedMessageId: record.quotedMessageId ?? null, messageType: record.messageType, eventTime: record.eventTime, recordedAt: record.recordedAt,
    sourceText: record.messageType === "text" ? record.sourceText : null};
}
function completionData(completion: QualityCompletion): Record<string, unknown> {
  const data: Record<string, unknown> = {outcome: completion.outcome, deliveryStatus: completion.deliveryStatus, completedAt: completion.completedAt};
  for (const key of ["translatedText", "replyText", "translationMode", "sourceLanguageCode", "targetLanguageCode", "engine", "glossary", "revision", "reason"] as const) data[key] = completion[key] ?? null;
  return data;
}
export class FirestoreTranslationQualityStore implements TranslationQualityStore {
  private readonly now: () => Date;
  constructor(private readonly firestore: Firestore, private readonly options: {projectId: string; revision?: string; now?: () => Date}) {this.now = options.now ?? (() => new Date());}
  async getConfig(): Promise<QualityConfig | null> {
    if (this.options.projectId !== NMT_TEST_PROJECT) return null;
    return parseQualityConfig((await this.firestore.doc(QUALITY_CONFIG_PATH).get()).data());
  }
  async saveOriginal(record: QualityOriginal): Promise<void> {await this.persist(record);}
  async complete(record: QualityOriginal, completion: QualityCompletion): Promise<void> {await this.persist(record, completion);}
  private async persist(record: QualityOriginal, completion?: QualityCompletion): Promise<void> {
    if (this.options.projectId !== NMT_TEST_PROJECT) return;
    const ref = this.firestore.collection(QUALITY_MESSAGES_COLLECTION).doc(qualityMessageId(record));
    await this.firestore.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      if (!existing.exists) transaction.create(ref, originalData(record));
      if (completion && !existing.get("completedAt")) {
        const data = completionData(completion);
        data.revision = completion.revision ?? this.options.revision ?? null;
        if (record.messageType === "audio") data.sourceText = completion.sourceText ?? null;
        transaction.set(ref, data, {merge: true});
      }
    }, {maxAttempts: 2});
  }
  async search(input: QualitySearch): Promise<QualitySearchResult> {
    const config = await this.getConfig();
    if (!config) throw new Error("quality_unavailable");
    const groupIds = input.groupIds.filter(id => config.groups.some(group => group.id === id));
    if (!groupIds.length) return {messages: [], cursor: null, scanned: 0};
    let query = this.firestore.collection(QUALITY_MESSAGES_COLLECTION)
      .where("eventTime", ">=", input.start).where("eventTime", "<=", input.end)
      .orderBy("eventTime", "desc").orderBy(FieldPath.documentId(), "desc").limit(200);
    if (input.cursor) query = query.startAfter(new Date(input.cursor.eventTime), input.cursor.id);
    const snapshot = await query.get();
    const keyword = normalizeQualityKeyword(input.keyword);
    const messages: QualityMessage[] = [];
    let cursor: SearchCursor | null = null;
    let scanned = 0;
    for (const doc of snapshot.docs) {
      scanned++;
      const data = doc.data();
      const eventTime = qualityDate(data.eventTime)!;
      cursor = {eventTime: eventTime.getTime(), id: doc.id};
      if (groupIds.includes(data.groupId) && [data.sourceText, data.translatedText].some(text => typeof text === "string" && normalizeQualityKeyword(text).includes(keyword))) {
        messages.push({...data, id: doc.id, eventTime, recordedAt: qualityDate(data.recordedAt)!,
          ...(data.completedAt ? {completedAt: qualityDate(data.completedAt)!} : {})} as QualityMessage);
      }
      if (messages.length === 5) break;
    }
    if (scanned === snapshot.size && snapshot.size < 200) cursor = null;
    return {messages, cursor, scanned};
  }
  async transitionReport(ownerId: string, eventId: string, transition: (session: ReportSession | null) => Promise<ReportTransition>): Promise<string | null> {
    if (this.options.projectId !== NMT_TEST_PROJECT) return null;
    const sessionRef = this.firestore.collection(QUALITY_SESSIONS_COLLECTION).doc(hash([ownerId]));
    const receiptRef = sessionRef.collection("events").doc(hash([eventId]));
    return this.firestore.runTransaction(async transaction => {
      const documents = await transaction.getAll(sessionRef, receiptRef);
      const sessionDoc = documents[0]!; const receiptDoc = documents[1]!;
      const now = this.now();
      if (receiptDoc.exists) return qualityDate(receiptDoc.get("expiresAt"))!.getTime() > now.getTime() ? receiptDoc.get("reply") as string | null : "回報操作已過期，請輸入 /翻譯錯誤 重新開始。";
      const stored = hydrateDates(sessionDoc.data()) as Record<string, unknown> | undefined;
      const session = stored && qualityDate(stored.expiresAt)!.getTime() > now.getTime() ? {...stored, expiresAt: qualityDate(stored.expiresAt)!.getTime()} as ReportSession : null;
      const result = await transition(session);
      if (result.errorCase) {
        const caseRef = this.firestore.collection(QUALITY_CASES_COLLECTION).doc(result.errorCase.id);
        const existing = await transaction.get(caseRef);
        if (!existing.exists) transaction.create(caseRef, {...result.errorCase, groupId: result.errorCase.draft.groupId ?? null, schemaVersion: 1});
      }
      if (result.session) transaction.set(sessionRef, {...result.session, ownerUserId: ownerId, expiresAt: new Date(result.session.expiresAt)});
      else if (sessionDoc.exists) transaction.delete(sessionRef);
      // Unrelated owner DMs must not be collected when there is no active workflow.
      if (result.reply !== null) transaction.create(receiptRef, {reply: result.reply, expiresAt: new Date(now.getTime() + REPORT_SESSION_MS)});
      return result.reply;
    }, {maxAttempts: 2});
  }
}

// Firestore nested timestamps must survive session cloning and subsequent transactional writes.
function hydrateDates(value: unknown): unknown {
  const date = qualityDate(value);
  if (date) return date;
  if (Array.isArray(value)) return value.map(hydrateDates);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrateDates(item)]));
  return value;
}