import {deadlineFirestore} from "./translation-deadline.js";
import {copySolReviewRecord, type SolReviewRecord, type QuoteContext} from "./sol-review-types.js";
import {withinTime} from "./translation-deadline.js";
import {copyNmtOutputContents, type NmtOutputContents} from "./nmt-content-capture.js";
import {createHash} from "node:crypto";
import {FieldPath, type Firestore} from "firebase-admin/firestore";
import {isSupportedRuntimeProject} from "./production-target.js";
import {ARCHIVE_MESSAGES, archiveMessageKey, ArchiveRedactedError} from "./conversation-archive.js";
import {redactLinkedSnapshots, linkedMessageKeys} from "./conversation-archive-redaction.js";

export const QUALITY_MESSAGES_COLLECTION = "lineTranslationMessages";
export const QUALITY_CASES_COLLECTION = "lineTranslationErrorCases";
export const QUALITY_SESSIONS_COLLECTION = "lineTranslationReportSessions";
export const QUALITY_CONFIG_PATH = "lineTranslationQualityConfig/current";
export const REPORT_SESSION_MS = 30 * 60 * 1000;
export const RECORDING_GROUPS_COLLECTION = "lineTranslationGroups";
export function isQualityGroupId(id: string): boolean {return /^C[0-9a-f]{32}$/iu.test(id);}
export function qualityGroupName(id: string): string {return `群組 ${hash([id]).slice(0, 10)}`;}
export interface QualityGroup {id: string; name: string}
export interface QualityConfig {enabled: true; groups: QualityGroup[]; startedAt: Date}
export interface QualityOriginal {
  archiveEventId?: string | null;
  operationId?: string;
  groupId: string; groupName: string; senderUserId: string | null;
  webhookEventId: string | null; messageId: string | null; messageType: string; quotedMessageId?: string | null;
  eventTime: Date; recordedAt: Date; sourceText: string | null;
}
export interface QualityCompletion {
  solReview?: SolReviewRecord;
  nmtInputContents?: string[] | null; nmtOutputContents?: NmtOutputContents | null;
  operationId?: string;
  sourceText?: string | null; translatedText?: string | null; replyText?: string | null;
  translationMode?: string | null; sourceLanguageCode?: string | null; targetLanguageCode?: string | null;
  engine?: string | null; glossary?: string | null; revision?: string | null;
  adapterVersion?: string | null; protectionVersion?: string | null; requestProfile?: string | null;
  validationScope?: "literal-integrity" | null; semanticEvaluation?: "not_evaluated" | null;
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
  groupChoices?: QualityGroup[]; groupPage?: number;
}
export interface QualityCase {id: string; ownerUserId: string; status: "pending_analysis"; createdAt: Date; draft: ReportDraft}
export interface ReportTransition {session: ReportSession | null; reply: string | null; errorCase?: QualityCase}
export interface TranslationQualityStore {
  getQuotedOriginal?(groupId: string, messageId: string): Promise<QuoteContext>;
  getConfig(): Promise<QualityConfig | null>;
  getRecordingEnabled(groupId: string): Promise<boolean>;
  setRecordingEnabled(groupId: string, enabled: boolean, changedBy: string, eventId: string, eventTime: number): Promise<{enabled: boolean; applied: boolean}>;
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
  if (data.enabled !== true || !Array.isArray(data.groups)) return null;
  const groups: QualityGroup[] = [];
  for (const group of data.groups) {
    if (!group || typeof group !== "object" || typeof group.id !== "string" || !/^C[0-9a-f]{32}$/iu.test(group.id) ||
      typeof group.name !== "string" || !group.name.trim() || group.name.length > 100 || groups.some(item => item.id === group.id)) return null;
    groups.push({id: group.id, name: group.name});
  }
  const startedAt = qualityDate(data.startedAt);
  return startedAt ? {enabled: true, groups, startedAt} : null;
}
// Allowlist projection deliberately excludes tokens, attachments and arbitrary errors; raw NMT text is explicitly captured separately.
function originalData(record: QualityOriginal): Record<string, unknown> {
  return {schemaVersion: 1, ...(record.operationId ? {operationId: record.operationId} : {}), ...(record.archiveEventId ? {archiveEventId: record.archiveEventId} : {}), groupId: record.groupId, groupName: record.groupName,
    senderUserId: record.senderUserId, webhookEventId: record.webhookEventId, messageId: record.messageId,
    quotedMessageId: record.quotedMessageId ?? null, messageType: record.messageType, eventTime: record.eventTime, recordedAt: record.recordedAt,
    sourceText: record.messageType === "text" ? record.sourceText : null, nmtInputContents: null, nmtOutputContents: null};
}
function completionData(completion: QualityCompletion): Record<string, unknown> {
  const data: Record<string, unknown> = {...(completion.operationId ? {operationId: completion.operationId} : {}), outcome: completion.outcome, deliveryStatus: completion.deliveryStatus, completedAt: completion.completedAt};
  for (const key of ["translatedText", "replyText", "translationMode", "sourceLanguageCode", "targetLanguageCode", "engine", "glossary", "revision", "adapterVersion", "protectionVersion", "requestProfile", "validationScope", "semanticEvaluation", "reason"] as const) data[key] = completion[key] ?? null;
  if (completion.solReview) data.solReview = copySolReviewRecord(completion.solReview);
  data.nmtInputContents = Array.isArray(completion.nmtInputContents) && completion.nmtInputContents.every(text => typeof text === "string") ? [...completion.nmtInputContents] : null;
  data.nmtOutputContents = completion.nmtOutputContents ? copyNmtOutputContents(completion.nmtOutputContents) : null;
  return data;
}
export class FirestoreTranslationQualityStore implements TranslationQualityStore {
  private readonly now: () => Date;
  constructor(private readonly firestore: Firestore, private readonly options: {projectId: string; revision?: string; now?: () => Date}) {this.firestore = deadlineFirestore(firestore); this.now = options.now ?? (() => new Date());}
  async getQuotedOriginal(groupId: string, messageId: string): Promise<QuoteContext> {
    if (!isSupportedRuntimeProject(this.options.projectId) || !isQualityGroupId(groupId) || !messageId || messageId.length > 200) return {status: "unknown"};
    try {
      const archived = await this.firestore.collection(ARCHIVE_MESSAGES).doc(archiveMessageKey(groupId, messageId)).get();
      if (archived.exists) {
        const text = archived.get("sourceText");
        return archived.get("redacted") !== true && typeof text === "string" && text.trim() && text.length <= 2000 ? {status: "known", text} : {status: "unknown"};
      }
      const snapshot = await withinTime(() => this.firestore.collection(QUALITY_MESSAGES_COLLECTION)
        .where("groupId", "==", groupId).where("messageId", "==", messageId).limit(2).get(), 2000);
      if (snapshot.docs.length !== 1) return {status: "unknown"};
      const doc = snapshot.docs[0]!, text = doc.get("sourceText");
      if (doc.get("groupId") !== groupId || doc.get("messageId") !== messageId || typeof text !== "string" || !text.trim() || text.length > 2000) return {status: "unknown"};
      return {status: "known", text};
    } catch {return {status: "unknown"};}
  }
  async getConfig(): Promise<QualityConfig | null> {
    if (!isSupportedRuntimeProject(this.options.projectId)) return null;
    const config = parseQualityConfig((await this.firestore.doc(QUALITY_CONFIG_PATH).get()).data());
    if (!config) return null;
    const known = new Set(config.groups.map(group => group.id));
    const snapshot = await this.firestore.collection(RECORDING_GROUPS_COLLECTION).get();
    for (const doc of snapshot.docs.sort((a, b) => a.id.localeCompare(b.id))) {
      if (!isQualityGroupId(doc.id) || known.has(doc.id)) continue;
      const name = doc.get("groupName");
      config.groups.push({id: doc.id, name: typeof name === "string" && name.trim() ? name.slice(0, 100) : qualityGroupName(doc.id)});
    }
    return config;
  }
  async getRecordingEnabled(groupId: string): Promise<boolean> {
    if (!isSupportedRuntimeProject(this.options.projectId) || !isQualityGroupId(groupId)) return false;
    const value = (await this.firestore.collection(RECORDING_GROUPS_COLLECTION).doc(groupId).get()).get("recordingEnabled");
    if (value !== undefined && typeof value !== "boolean") throw new Error("invalid_recording_setting");
    return value === true;
  }
  async setRecordingEnabled(groupId: string, enabled: boolean, changedBy: string, eventId: string, eventTime: number): Promise<{enabled: boolean; applied: boolean}> {
    if (!isSupportedRuntimeProject(this.options.projectId) || !isQualityGroupId(groupId) || !changedBy || !eventId || !Number.isFinite(eventTime) || Math.abs(eventTime) > 8640000000000000) throw new Error("invalid_recording_command");
    const ref = this.firestore.collection(RECORDING_GROUPS_COLLECTION).doc(groupId);
    const receipt = ref.collection("recordingCommands").doc(hash([eventId]));
    return this.firestore.runTransaction(async transaction => {
      const [group, previous] = await transaction.getAll(ref, receipt);
      const current = group!.get("recordingEnabled") === true;
      if (previous!.exists) return {enabled: current, applied: false};
      const lastTime = qualityDate(group!.get("recordingCommandAt"));
      const applied = !lastTime || eventTime > lastTime.getTime();
      if (applied) transaction.set(ref, {recordingEnabled: enabled, recordingChangedBy: changedBy, recordingChangedAt: this.now(), recordingCommandAt: new Date(eventTime)}, {merge: true});
      transaction.create(receipt, {enabled, changedBy, eventTime: new Date(eventTime), recordedAt: this.now(), applied});
      return {enabled: applied ? enabled : current, applied};
    }, {maxAttempts: 2});
  }
  async saveOriginal(record: QualityOriginal): Promise<void> {await this.persist(record);}
  async complete(record: QualityOriginal, completion: QualityCompletion): Promise<void> {await this.persist(record, completion);}
  private async persist(record: QualityOriginal, completion?: QualityCompletion): Promise<void> {
    if (!isSupportedRuntimeProject(this.options.projectId)) return;
    const ref = this.firestore.collection(QUALITY_MESSAGES_COLLECTION).doc(qualityMessageId(record));
    await this.firestore.runTransaction(async transaction => {
      const [existing, archived] = await Promise.all([transaction.get(ref), record.messageId ? transaction.get(this.firestore.collection(ARCHIVE_MESSAGES).doc(archiveMessageKey(record.groupId, record.messageId))) : null]);
      if (archived?.get("redacted")) {if (!completion) throw new ArchiveRedactedError(); return;}
      transaction.set(this.firestore.collection(RECORDING_GROUPS_COLLECTION).doc(record.groupId), {groupName: record.groupName}, {merge: true});
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
      if (!data.redacted && groupIds.includes(data.groupId) && [data.sourceText, data.translatedText].some(text => typeof text === "string" && normalizeQualityKeyword(text).includes(keyword))) {
        messages.push({...data, id: doc.id, eventTime, recordedAt: qualityDate(data.recordedAt)!,
          ...(data.completedAt ? {completedAt: qualityDate(data.completedAt)!} : {})} as QualityMessage);
      }
      if (messages.length === 5) break;
    }
    if (scanned === snapshot.size && snapshot.size < 200) cursor = null;
    return {messages, cursor, scanned};
  }
  async transitionReport(ownerId: string, eventId: string, transition: (session: ReportSession | null) => Promise<ReportTransition>): Promise<string | null> {
    if (!isSupportedRuntimeProject(this.options.projectId)) return null;
    const sessionRef = this.firestore.collection(QUALITY_SESSIONS_COLLECTION).doc(hash([ownerId]));
    const receiptRef = sessionRef.collection("events").doc(hash([eventId]));
    return this.firestore.runTransaction(async transaction => {
      const documents = await transaction.getAll(sessionRef, receiptRef);
      const sessionDoc = documents[0]!; const receiptDoc = documents[1]!;
      const now = this.now();
      if (receiptDoc.exists) {
        const keys = receiptDoc.get("messageKeys");
        if (Array.isArray(keys) && keys.length) {
          const states = await transaction.getAll(...keys.map(key => this.firestore.collection(ARCHIVE_MESSAGES).doc(key)));
          if (states.some(state => state.get("redacted"))) return "相關訊息已收回。";
        }
        return qualityDate(receiptDoc.get("expiresAt"))!.getTime() > now.getTime() ? receiptDoc.get("reply") as string | null : "回報操作已過期，請輸入 /翻譯錯誤 重新開始。";
      }
      const safeStored = await redactLinkedSnapshots(this.firestore, transaction, sessionDoc.data());
      const stored = hydrateDates(safeStored.value) as Record<string, unknown> | undefined;
      const session = stored && qualityDate(stored.expiresAt)!.getTime() > now.getTime() ? {...stored, expiresAt: qualityDate(stored.expiresAt)!.getTime()} as ReportSession : null;
      const result = await transition(session);
      const safeResult = await redactLinkedSnapshots(this.firestore, transaction, result);
      const final = safeResult.value as ReportTransition;
      if (safeStored.changed || safeResult.changed) final.reply = "相關訊息已收回，請重新搜尋。";
      const receiptKeys = [...new Set([...linkedMessageKeys(session), ...linkedMessageKeys(final)])];
      if (final.errorCase) {
        const caseRef = this.firestore.collection(QUALITY_CASES_COLLECTION).doc(final.errorCase.id);
        const existing = await transaction.get(caseRef);
        if (!existing.exists) transaction.create(caseRef, {...final.errorCase, groupId: final.errorCase.draft.groupId ?? null, schemaVersion: 1});
      }
      if (final.session) transaction.set(sessionRef, {...final.session, ownerUserId: ownerId, expiresAt: new Date(final.session.expiresAt)});
      else if (sessionDoc.exists) transaction.delete(sessionRef);
      // Unrelated owner DMs must not be collected when there is no active workflow.
      if (final.reply !== null) transaction.create(receiptRef, {reply: final.reply, messageKeys: receiptKeys, expiresAt: new Date(now.getTime() + REPORT_SESSION_MS)});
      return final.reply;
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
