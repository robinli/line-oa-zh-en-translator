import {randomUUID} from "node:crypto";
import type {Firestore, Transaction} from "firebase-admin/firestore";
import {deadlineFirestore, assertDeadlineActive} from "./translation-deadline.js";
import {isSupportedRuntimeProject} from "./production-target.js";
import {qualityDate, QUALITY_MESSAGES_COLLECTION, QUALITY_CASES_COLLECTION, QUALITY_SESSIONS_COLLECTION, RECORDING_GROUPS_COLLECTION, type QualityCompletion} from "./translation-quality-store.js";
import type {QuoteContext} from "./sol-review-types.js";
import {redactLinkedSnapshots} from "./conversation-archive-redaction.js";
import {ARCHIVE_CONFIG, ARCHIVE_EVENTS, ARCHIVE_MESSAGES, ARCHIVE_JOBS, ARCHIVE_VERSION, ARCHIVE_MAX_ATTEMPTS, archiveKey, archiveMessageKey,
  captureArchiveEvent, isArchiveAttachment, redactArchiveEvent, ArchiveRedactedError, ArchivePersistenceError,
  type ArchiveEvent, type ArchiveJob, type ConversationArchiveStore, type ReplyArchiveResult} from "./conversation-archive.js";

export class FirestoreConversationArchiveStore implements ConversationArchiveStore {
  constructor(private readonly firestore: Firestore, readonly projectId: string, private readonly now = () => new Date()) {
    if (!isSupportedRuntimeProject(projectId)) throw new ArchivePersistenceError();
    this.firestore = deadlineFirestore(firestore);
  }
  async capture(event: unknown, ownerUserId: string): Promise<ArchiveEvent | null> {
    const record = captureArchiveEvent(event, this.now()); if (!record) return null;
    const groupRef = this.firestore.collection(RECORDING_GROUPS_COLLECTION).doc(record.groupId);
    const eventRef = this.firestore.collection(ARCHIVE_EVENTS).doc(record.id);
    const messageRef = record.messageKey ? this.firestore.collection(ARCHIVE_MESSAGES).doc(record.messageKey) : null;
    return this.firestore.runTransaction(async tx => {
      const [config, group, previous, state] = await Promise.all([tx.get(this.firestore.doc(ARCHIVE_CONFIG)), tx.get(groupRef), tx.get(eventRef), messageRef ? tx.get(messageRef) : null]);
      if (config.get("enabled") !== true || config.get("version") !== ARCHIVE_VERSION || !qualityDate(config.get("startedAt"))) throw new ArchivePersistenceError();
      if (previous.exists) return state?.get("redacted") ? redactArchiveEvent(previous.data() as ArchiveEvent) : previous.data() as ArchiveEvent;
      const setting = group.get("recordingEnabled");
      if (setting !== undefined && typeof setting !== "boolean") throw new ArchivePersistenceError();
      const enabling = record.eventType === "message" && record.sourceText?.trim() === "/開啟記錄" && record.senderUserId === ownerUserId;
      const unsend = record.eventType === "unsend" && Boolean(record.messageId);
      const jobRef = record.messageKey && (unsend || isArchiveAttachment(record)) ? this.firestore.collection(ARCHIVE_JOBS).doc(unsend ? `purge-${record.messageKey}-${record.id}` : `download-${record.messageKey}`) : null;
      const existingJob = jobRef ? await tx.get(jobRef) : null;
      // Unsend remains applicable to saved messages after the recording switch is turned off.
      if (setting !== true && !enabling && !(unsend && state?.exists)) return null;
      record.groupName = typeof group.get("groupName") === "string" ? group.get("groupName") : record.groupName;
      const redacted = state?.get("redacted") === true || unsend;
      const saved = redacted ? redactArchiveEvent(record) : record;
      tx.create(eventRef, saved);
      if (messageRef) {
        const priorTime = qualityDate(state?.get("latestEventTime"));
        if (unsend) {
          tx.set(messageRef, {groupId: record.groupId, messageId: record.messageId, redacted: true, sourceText: null, transcript: null,
            metadata: {}, unsentAt: record.eventTime, updatedAt: this.now(), attachmentStatus: "purging"}, {merge: true});
          if (!existingJob?.exists) this.createJob(tx, record, "purge");
        } else if (record.eventType === "message" || record.eventType === "messageEdited") {
          if (!state?.exists || !priorTime || +record.eventTime > +priorTime || +record.eventTime === +priorTime && record.id > (state.get("latestEventId") ?? "")) {
            tx.set(messageRef, {groupId: record.groupId, messageId: record.messageId, latestEventId: record.id, latestEventTime: record.eventTime,
              messageType: record.messageType, sourceText: saved.sourceText, metadata: saved.metadata, redacted, updatedAt: this.now()}, {merge: true});
          }
          if (isArchiveAttachment(record) && !redacted && !existingJob?.exists) this.createJob(tx, record, "download");
        }
      }
      return saved;
    }, {maxAttempts: 2});
  }
  private createJob(tx: Transaction, record: ArchiveEvent, kind: ArchiveJob["kind"]): void {
    const id = `${kind}-${record.messageKey}`;
    // A message has one original media event; a purge may be retriggered using its event ID.
    const jobId = kind === "purge" ? `${id}-${record.id}` : id;
    tx.set(this.firestore.collection(ARCHIVE_JOBS).doc(jobId), {id: jobId, kind, groupId: record.groupId, messageId: record.messageId,
      messageKey: record.messageKey, eventId: record.id, status: "pending", attempts: 0, createdAt: this.now()}, {merge: true});
  }
  async finish(record: ArchiveEvent, completion: QualityCompletion): Promise<void> {
    const eventRef = this.firestore.collection(ARCHIVE_EVENTS).doc(record.id);
    await this.firestore.runTransaction(async tx => {
      const [event, state] = await Promise.all([tx.get(eventRef), record.messageKey ? tx.get(this.firestore.collection(ARCHIVE_MESSAGES).doc(record.messageKey)) : null]);
      if (!event.exists) throw new ArchivePersistenceError();
      if (event.get("redacted") || state?.get("redacted")) {tx.set(eventRef, {outcome: "redacted", completedAt: completion.completedAt}, {merge: true}); return;}
      tx.set(eventRef, {outcome: completion.outcome, deliveryStatus: completion.deliveryStatus, reason: completion.reason ?? null,
        completedAt: completion.completedAt, ...(completion.sourceText ? {transcript: completion.sourceText} : {})}, {merge: true});
      if (record.messageKey && completion.sourceText) tx.set(this.firestore.collection(ARCHIVE_MESSAGES).doc(record.messageKey), {transcript: completion.sourceText}, {merge: true});
    }, {maxAttempts: 2});
  }
  async prepareReply(record: ArchiveEvent, attempt: number, messages: readonly unknown[]): Promise<string> {
    const id = archiveKey(["reply", record.id, attempt]), ref = this.firestore.collection(ARCHIVE_EVENTS).doc(id);
    await this.firestore.runTransaction(async tx => {
      const [prior, state] = await Promise.all([tx.get(ref), record.messageKey ? tx.get(this.firestore.collection(ARCHIVE_MESSAGES).doc(record.messageKey)) : null]);
      if (state?.get("redacted") && record.eventType !== "unsend") throw new ArchiveRedactedError();
      if (!prior.exists) tx.create(ref, {schemaVersion: 1, version: ARCHIVE_VERSION, id, groupId: record.groupId, groupName: record.groupName,
        eventType: "botReply", sourceEventId: record.id, messageKey: record.messageKey, messageId: record.messageId,
        eventTime: this.now(), receivedAt: this.now(), messages: structuredClone(messages), status: "prepared", redacted: false});
    }, {maxAttempts: 2});
    return id;
  }
  async finishReply(id: string, result: ReplyArchiveResult): Promise<void> {
    const ref = this.firestore.collection(ARCHIVE_EVENTS).doc(id);
    await this.firestore.runTransaction(async tx => {
      const event = await tx.get(ref); if (!event.exists) throw new ArchivePersistenceError();
      const key = event.get("messageKey"), state = key ? await tx.get(this.firestore.collection(ARCHIVE_MESSAGES).doc(key)) : null;
      tx.set(ref, {status: result.status, messageIds: result.messageIds ?? [], completedAt: this.now(),
        ...(state?.get("redacted") ? {messages: [], redacted: true} : {})}, {merge: true});
    }, {maxAttempts: 2});
  }
  async getQuotedOriginal(groupId: string, messageId: string): Promise<QuoteContext> {
    const state = await this.firestore.collection(ARCHIVE_MESSAGES).doc(archiveMessageKey(groupId, messageId)).get();
    const text = state.get("sourceText");
    return state.get("redacted") !== true && typeof text === "string" && text.trim() && text.length <= 2000 ? {status: "known", text} : {status: "unknown"};
  }
  async claimJob(id: string): Promise<ArchiveJob | null> {
    const ref = this.firestore.collection(ARCHIVE_JOBS).doc(id), owner = randomUUID();
    return this.firestore.runTransaction(async tx => {
      const snapshot = await tx.get(ref); if (!snapshot.exists) return null;
      let job = snapshot.data() as ArchiveJob;
      if (job.status === "complete" || job.status === "missing") return null;
      if (job.status === "working" && +(qualityDate(job.leaseUntil) ?? new Date(0)) > +this.now()) throw new ArchivePersistenceError();
      if (job.kind === "download" && job.attempts >= ARCHIVE_MAX_ATTEMPTS) {
        const stateRef = this.firestore.collection(ARCHIVE_MESSAGES).doc(job.messageKey), state = await tx.get(stateRef);
        if (state.get("redacted")) job = {...job, kind: "purge"};
        else {
          tx.set(ref, {status: "missing", reason: "attempts_exhausted", completedAt: this.now()}, {merge: true});
          tx.set(stateRef, {attachmentStatus: "missing", reason: "attempts_exhausted"}, {merge: true}); return null;
        }
      }
      const claimed = {...job, owner, attempts: job.attempts + 1, status: "working" as const, leaseUntil: new Date(+this.now() + 570000)};
      tx.set(ref, claimed, {merge: true}); return claimed;
    });
  }
  async jobState(job: ArchiveJob): Promise<Record<string, unknown>> {
    return (await this.firestore.collection(ARCHIVE_MESSAGES).doc(job.messageKey).get()).data() ?? {};
  }
  async completeJob(job: ArchiveJob, status: "complete" | "missing" | "pending", details: Record<string, unknown> = {}): Promise<boolean> {
    const ref = this.firestore.collection(ARCHIVE_JOBS).doc(job.id), stateRef = this.firestore.collection(ARCHIVE_MESSAGES).doc(job.messageKey);
    return this.firestore.runTransaction(async tx => {
      const [current, state] = await Promise.all([tx.get(ref), tx.get(stateRef)]);
      if (current.get("owner") !== job.owner || current.get("status") !== "working") throw new ArchivePersistenceError();
      const redacted = state.get("redacted") === true;
      // Keep ownership until a late object's deletion is acknowledged. A failed deletion becomes
      // a purge retry, even when the download has exhausted its eight-call budget.
      if (job.kind === "download" && redacted && status === "complete" && details.cleanupComplete !== true) return false;
      const cleanupRetry = job.kind === "download" && redacted && status !== "complete";
      tx.set(ref, {status: cleanupRetry ? "pending" : status, ...(cleanupRetry ? {kind: "purge"} : {}),
        reason: details.reason ?? null, leaseUntil: new Date(0), updatedAt: this.now()}, {merge: true});
      if (job.kind === "download" && !redacted) tx.set(stateRef, {...details, attachmentStatus: status === "complete" ? "saved" : status}, {merge: true});
      if (job.kind === "purge" && status === "complete") tx.set(stateRef, {attachmentStatus: "removed", purgeCompletedAt: this.now()}, {merge: true});
      return !redacted;
    });
  }
  async purgeContent(job: ArchiveJob): Promise<void> {
    // Each write rechecks the tombstone. Queries may span pages, but no re-send or translation is performed.
    const rows = await this.firestore.collection(ARCHIVE_EVENTS).where("messageKey", "==", job.messageKey).get();
    for (const row of rows.docs) await row.ref.set({sourceText: null, transcript: null, metadata: {}, messages: [], redacted: true}, {merge: true});
    const translations = await this.firestore.collection(QUALITY_MESSAGES_COLLECTION).where("groupId", "==", job.groupId).where("messageId", "==", job.messageId).get();
    for (const row of translations.docs) await row.ref.set({redacted: true, sourceText: null, translatedText: null, replyText: null, nmtInputContents: null, nmtOutputContents: null}, {merge: true});
    const failures = await this.firestore.collection("lineTranslationFailures").where("groupId", "==", job.groupId).where("messageId", "==", job.messageId).get();
    for (const row of failures.docs) await row.ref.set({redacted: true, sourceText: null}, {merge: true});
    for (const collection of [QUALITY_CASES_COLLECTION, QUALITY_SESSIONS_COLLECTION]) {
      const snapshot = await this.firestore.collection(collection).get();
      for (const row of snapshot.docs) {
        const clean = await this.firestore.runTransaction(async tx => {
          const current = await tx.get(row.ref);
          const result = await redactLinkedSnapshots(this.firestore, tx, current.data());
          if (current.exists && result.changed) tx.set(row.ref, result.value as Record<string, unknown>);
          return result;
        });
        // Report receipts can contain a previously displayed source or translation.
        if (collection === QUALITY_SESSIONS_COLLECTION && clean.changed) {
          const receipts = await row.ref.collection("events").get();
          for (const receipt of receipts.docs) await receipt.ref.set({reply: "相關訊息已收回。"}, {merge: true});
        }
      }
    }
    // Receipts survive deleted session parents; their explicit references make those copies discoverable.
    const sessions = this.firestore.collection(QUALITY_SESSIONS_COLLECTION);
    if (typeof sessions.listDocuments === "function") {
      for (const parent of await sessions.listDocuments()) {
        const receipts = await parent.collection("events").where("messageKeys", "array-contains", job.messageKey).get();
        for (const row of receipts.docs) await row.ref.set({reply: "相關訊息已收回。"}, {merge: true});
      }
    }
    assertDeadlineActive();
  }
}
