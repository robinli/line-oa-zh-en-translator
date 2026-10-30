import type {Firestore, Transaction} from "firebase-admin/firestore";
import {ARCHIVE_MESSAGES, archiveMessageKey} from "./conversation-archive.js";
import {qualityDate} from "./translation-quality-store.js";

export function linkedMessageKeys(value: unknown): string[] {
  const keys = new Set<string>();
  const visit = (input: unknown) => {
    if (Array.isArray(input)) {input.forEach(visit); return;}
    if (!input || typeof input !== "object" || qualityDate(input)) return;
    const row = input as Record<string, unknown>;
    if (typeof row.groupId === "string" && typeof row.messageId === "string") keys.add(archiveMessageKey(row.groupId, row.messageId));
    Object.values(row).forEach(visit);
  };
  visit(value); return [...keys];
}
export async function redactLinkedSnapshots(db: Firestore, tx: Transaction, value: unknown): Promise<{value: unknown; changed: boolean}> {
  const keys = linkedMessageKeys(value), redacted = new Set<string>();
  if (keys.length) {
    const snapshots = await tx.getAll(...keys.map(key => db.collection(ARCHIVE_MESSAGES).doc(key)));
    snapshots.forEach((snapshot, index) => {if (snapshot.get("redacted")) redacted.add(keys[index]!);});
  }
  let changed = false;
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object" || qualityDate(input)) return input;
    const row = input as Record<string, unknown>;
    if (typeof row.groupId === "string" && typeof row.messageId === "string" && redacted.has(archiveMessageKey(row.groupId, row.messageId))) {
      changed = true; return {...row, redacted: true, sourceText: null, translatedText: null, replyText: null, nmtInputContents: null, nmtOutputContents: null};
    }
    const result = Object.fromEntries(Object.entries(row).map(([key, item]) => [key, visit(item)]));
    if ((result.message as {redacted?: boolean} | undefined)?.redacted) {
      changed = true; for (const field of ["sourceText", "translatedText", "issue", "suggestion"]) if (field in result) result[field] = null;
    }
    return result;
  };
  return {value: visit(value), changed};
}
