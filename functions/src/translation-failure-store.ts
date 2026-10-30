import {deadlineFirestore} from "./translation-deadline.js";
import {createHash, randomUUID} from "node:crypto";
import type {TranslationMode} from "./domain.js";
import type {FailureStage} from "./translation-failures.js";
import type {Firestore} from "firebase-admin/firestore";
import {ARCHIVE_MESSAGES, archiveMessageKey} from "./conversation-archive.js";

export const TRANSLATION_FAILURE_COLLECTION = "lineTranslationFailures";
export interface TranslationFailureRecord {
  groupId: string;
  webhookEventId?: string;
  messageId?: string;
  messageType: "text" | "audio";
  sourceText: string | null;
  translationMode: TranslationMode;
  sourceLanguageCode?: string;
  targetLanguageCode?: string;
  stage: FailureStage;
  reason: string;
}
export interface TranslationFailureStore {
  save(record: TranslationFailureRecord): Promise<void>;
}
interface FailureFirestore {
  collection(path: string): {doc(id: string): {create(data: Record<string, unknown>): Promise<unknown>}};
}
export function translationFailureId(record: TranslationFailureRecord): string {
  const key = record.webhookEventId ? ["event", record.webhookEventId] :
    record.messageId ? ["message", record.groupId, record.messageId] : undefined;
  return key ? createHash("sha256").update(JSON.stringify(key)).digest("hex") : randomUUID();
}
export class FirestoreTranslationFailureStore implements TranslationFailureStore {
  constructor(private readonly firestore: FailureFirestore) {this.firestore = deadlineFirestore(firestore);}
  async save(record: TranslationFailureRecord): Promise<void> {
    // Explicit projection excludes reply tokens, sender IDs, errors, translations and arbitrary extra fields.
    const data: Record<string, unknown> = {
      schemaVersion: 1, groupId: record.groupId, messageType: record.messageType,
      sourceText: record.sourceText, translationMode: record.translationMode,
      stage: record.stage, reason: record.reason, recordedAt: new Date(),
    };
    for (const field of ["webhookEventId", "messageId", "sourceLanguageCode", "targetLanguageCode"] as const) {
      if (record[field] !== undefined) data[field] = record[field];
    }
    try {
      const db = this.firestore as unknown as Firestore;
      if (record.messageId && typeof db.runTransaction === "function") {
        await db.runTransaction(async tx => {
          const state = await tx.get(db.collection(ARCHIVE_MESSAGES).doc(archiveMessageKey(record.groupId, record.messageId!)));
          if (state.get("redacted")) return;
          tx.create(db.collection(TRANSLATION_FAILURE_COLLECTION).doc(translationFailureId(record)), data);
        }, {maxAttempts: 2});
      } else await this.firestore.collection(TRANSLATION_FAILURE_COLLECTION).doc(translationFailureId(record)).create(data);
    } catch (error: unknown) {
      // create is atomic: preserve the first failure, including its content and timestamp, on redelivery.
      if (error && typeof error === "object" && "code" in error && error.code === 6) return;
      throw error;
    }
  }
}
