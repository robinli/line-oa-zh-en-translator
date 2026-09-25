import {expect, it, vi} from "vitest";
import {FirestoreTranslationFailureStore, translationFailureId, type TranslationFailureRecord} from "./translation-failure-store.js";
const record: TranslationFailureRecord = {groupId: "group", webhookEventId: "event", messageId: "message", messageType: "text", sourceText: "保留原文\n😀", translationMode: "zh-en", stage: "translation", reason: "translation_service_error"};
it("uses event identity, then group/message identity, never content for deduplication", () => {
  expect(translationFailureId(record)).toBe(translationFailureId({...record, sourceText: "changed"}));
  const noEvent = {...record, webhookEventId: undefined};
  expect(translationFailureId(noEvent)).toBe(translationFailureId(noEvent));
  expect(translationFailureId(noEvent)).not.toBe(translationFailureId({...noEvent, groupId: "other"}));
  const noIds = {...noEvent, messageId: undefined};
  expect(translationFailureId(noIds)).not.toBe(translationFailureId(noIds));
  expect(translationFailureId({...record, webhookEventId: "path/with/slash"})).toMatch(/^[a-f0-9]{64}$/);
});
it("stores original text and safe metadata, never incidental sensitive fields", async () => {
  const create = vi.fn().mockResolvedValue(undefined), doc = vi.fn(() => ({create})), collection = vi.fn(() => ({doc}));
  await new FirestoreTranslationFailureStore({collection}).save({...record, replyToken: "secret", userId: "sender", error: "SDK body", translatedText: "bad"} as TranslationFailureRecord);
  expect(collection).toHaveBeenCalledWith("lineTranslationFailures");
  expect(create).toHaveBeenCalledWith({...record, schemaVersion: 1, recordedAt: expect.any(Date)});
  expect(JSON.stringify(create.mock.calls)).not.toMatch(/secret|sender|SDK body|translatedText/);
});
it("atomically retains the first record during concurrent redelivery and propagates other failures", async () => {
  const saved = new Map<string, unknown>();
  const collection = () => ({doc: (id: string) => ({create: async (data: unknown) => {if(saved.has(id)) throw {code: 6}; saved.set(id, data);}})});
  const store = new FirestoreTranslationFailureStore({collection});
  await Promise.all([store.save(record),store.save({...record, sourceText: "later"})]);
  expect(saved.size).toBe(1); expect([...saved.values()][0]).toMatchObject({sourceText: record.sourceText});
  const failing = new FirestoreTranslationFailureStore({collection: () => ({doc: () => ({create: async () => {throw {code: 7};}})})});
  await expect(failing.save(record)).rejects.toEqual({code: 7});
});
it("stores null for unavailable transcripts and omits unavailable optional fields", async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  await new FirestoreTranslationFailureStore({collection: () => ({doc: () => ({create})})}).save({...record, sourceText: null, messageType: "audio", webhookEventId: undefined});
  expect(create.mock.calls[0]![0]).toMatchObject({sourceText: null, messageType: "audio"});
  expect(create.mock.calls[0]![0]).not.toHaveProperty("webhookEventId");
});
