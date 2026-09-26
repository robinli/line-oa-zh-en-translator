import {expect, it, vi} from "vitest";
import type {Firestore} from "firebase-admin/firestore";
import {FirestoreTranslationQualityStore, QUALITY_CONFIG_PATH, QUALITY_MESSAGES_COLLECTION, QUALITY_CASES_COLLECTION, QUALITY_SESSIONS_COLLECTION, qualityMessageId, qualityDate, parseQualityConfig, normalizeQualityKeyword, type QualityOriginal, type QualityCompletion, type ReportTransition} from "./translation-quality-store.js";
import {processTranslationReport, parseReportDates} from "./translation-report.js";
import {NMT_TEST_PROJECT} from "./nmt-isolation.js";
const groups = [1, 2, 3, 4].map(n => ({id: "C" + String(n).repeat(32), name: `群組${n}`}));
const now = new Date("2026-09-25T10:00:00Z");
const config = {enabled: true as const, groups, startedAt: now};
const original: QualityOriginal = {groupId: groups[0]!.id, groupName: groups[0]!.name, senderUserId: "sender", webhookEventId: "event", messageId: "message", messageType: "text", eventTime: now, recordedAt: now, sourceText: "原文"};
const completion: QualityCompletion = {translatedText: "Original", replyText: "Original", outcome: "translated", deliveryStatus: "sent", completedAt: now};
// Transactional in-memory Firestore double: staged writes commit atomically, with serialized concurrent transactions.
class MemoryFirestore {
  documents = new Map<string, Record<string, any>>(); failCommit = false; limits: number[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  doc(path: string): any {return {path, get: async () => this.snapshot(path), collection: (name: string) => this.collection(`${path}/${name}`)};}
  snapshot(path: string): any {const value = structuredClone(this.documents.get(path)); return {id: path.split("/").at(-1), exists: value !== undefined, data: () => value, get: (key: string) => value?.[key]};}
  collection(path: string): any {
    const filters: Array<[string, string, any]> = []; let after: [Date, string] | undefined; let limit = Infinity;
    const query: any = {doc: (id: string) => this.doc(`${path}/${id}`), where: (field: string, op: string, value: any) => {filters.push([field, op, value]); return query;}, orderBy: () => query,
      startAfter: (date: Date, id: string) => {after = [date, id]; return query;}, limit: (value: number) => {limit = value; this.limits.push(value); return query;},
      get: async () => {
        const docs = [...this.documents.keys()].filter(key => key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/")).map(key => this.snapshot(key))
          .filter(doc => filters.every(([field, op, value]) => op === ">=" ? doc.get(field) >= value : doc.get(field) <= value))
          .sort((a, b) => (b.get("eventTime")?.getTime() ?? 0) - (a.get("eventTime")?.getTime() ?? 0) || b.id.localeCompare(a.id))
          .filter(doc => !after || doc.get("eventTime") < after[0] || (+doc.get("eventTime") === +after[0] && doc.id < after[1])).slice(0, limit);
        return {docs, size: docs.length};
      }}; return query;
  }
  runTransaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {
      const changes: Array<() => void> = [];
      const transaction = {get: async (ref: any) => this.snapshot(ref.path), getAll: async (...refs: any[]) => refs.map(ref => this.snapshot(ref.path)),
        create: (ref: any, data: any) => {if (this.documents.has(ref.path)) throw new Error("already_exists"); changes.push(() => this.documents.set(ref.path, structuredClone(data)));},
        set: (ref: any, data: any, options?: any) => changes.push(() => this.documents.set(ref.path, structuredClone(options?.merge ? {...this.documents.get(ref.path), ...data} : data))),
        delete: (ref: any) => changes.push(() => this.documents.delete(ref.path))};
      const result = await callback(transaction);
      if (this.failCommit) throw new Error("storage_failed");
      for (const change of changes) change();
      return result;
    });
    this.tail = task.catch(() => {}); return task;
  }
}
function setup() {const db = new MemoryFirestore(); db.documents.set(QUALITY_CONFIG_PATH, config); let clock = now;
  const store = new FirestoreTranslationQualityStore(db as unknown as Firestore, {projectId: NMT_TEST_PROJECT, revision: "revision", now: () => clock});
  let sequence = 0;
  const report = (text: string, id = `event-${++sequence}`, owner = "owner") => processTranslationReport({type: "message", webhookEventId: id, replyToken: "secret", source: {type: "user", userId: owner}, message: {type: "text", text}}, "owner", store, config, clock);
  const docs = (collection: string) => [...db.documents].filter(([path]) => path.startsWith(collection + "/") && !path.slice(collection.length + 1).includes("/")).map(([, value]) => value);
  return {db, store, report, docs, advance: (ms: number) => {clock = new Date(clock.getTime() + ms);}};
}
it("recording defaults on, persists per group and keeps translation settings intact", async () => {
  const t = setup(); const id = groups[0]!.id;
  t.db.documents.set(`lineTranslationGroups/${id}`, {translationMode: "zh-vi", textTranslationEnabled: false, audioTranscriptionEnabled: true});
  expect(await t.store.getRecordingEnabled(id)).toBe(true);
  expect(await t.store.setRecordingEnabled(id, false, "owner", "off", +now)).toEqual({enabled: false, applied: true});
  expect(await t.store.getRecordingEnabled(id)).toBe(false);
  expect(await t.store.getRecordingEnabled(groups[1]!.id)).toBe(true);
  expect(t.db.documents.get(`lineTranslationGroups/${id}`)).toMatchObject({translationMode: "zh-vi", textTranslationEnabled: false, audioTranscriptionEnabled: true, recordingEnabled: false});
  await t.store.setRecordingEnabled(id, true, "owner", "on", +now + 1);
  expect(await t.store.getRecordingEnabled(id)).toBe(true);
});
it("duplicate, stale and equal-time recording commands never undo the newer setting", async () => {
  const t = setup(), id = groups[0]!.id;
  await t.store.setRecordingEnabled(id, true, "owner", "old-on", +now);
  await Promise.all(Array.from({length: 6}, () => t.store.setRecordingEnabled(id, false, "owner", "new-off", +now + 2)));
  for (const [event, time] of [["old-on", +now], ["stale", +now + 1], ["same-time", +now + 2]] as const) {
    expect(await t.store.setRecordingEnabled(id, true, "owner", event, time)).toEqual({enabled: false, applied: false});
  }
  expect(await t.store.getRecordingEnabled(id)).toBe(false);
  expect([...t.db.documents.keys()].filter(k => k.includes("recordingCommands/"))).toHaveLength(4);
});
it("failed setting transaction does not commit a flag or a receipt", async () => {
  const t = setup(); t.db.failCommit = true;
  await expect(t.store.setRecordingEnabled(groups[0]!.id, false, "owner", "off", +now)).rejects.toThrow();
  expect(await t.store.getRecordingEnabled(groups[0]!.id)).toBe(true);
  expect(t.db.documents.size).toBe(1);
});
it("disabled groups remain discoverable and their historical records searchable", async () => {
  const t = setup(), id = "C" + "f".repeat(32);
  await t.store.saveOriginal({...original, groupId: id, groupName: "T1-測試 Auto Translate"});
  await t.store.setRecordingEnabled(id, false, "owner", "off", +now);
  expect((await t.store.getConfig())?.groups).toContainEqual({id, name: "T1-測試 Auto Translate"});
  const result = await t.store.search({groupIds: [id], start: new Date(0), end: now, keyword: "原文"});
  expect(result.messages).toHaveLength(1);
});
it("group selection pages beyond nine and stays stable when groups change", async () => {
  const t = setup(); const many = Array.from({length: 24}, (_, i) => ({id: "C" + (i + 1).toString(16).padStart(32, "0"), name: `測試群 ${i + 1}`}));
  let sequence = 0;
  const call = (text: string, listed = many) => processTranslationReport({type: "message", source: {type: "user", userId: "owner"}, replyToken: "token", webhookEventId: `page-${++sequence}`, message: {type: "text", text}}, "owner", t.store, {...config, groups: listed}, now);
  await call("/翻譯錯誤"); expect(await call("2")).toContain("10 測試群 10");
  expect(await call("下一頁", many.slice().reverse())).toContain("11 測試群 11");
  expect(await call("上一頁")).toContain("1 測試群 1");
  await call("12", many.slice().reverse());
  expect(t.docs(QUALITY_SESSIONS_COLLECTION)[0]!.draft.groupId).toBe(many[11]!.id);
});
it("validates unique seed groups and start timestamp while accepting any group count and T1", () => {
  expect(parseQualityConfig(config)).toEqual(config);
  expect(parseQualityConfig({...config, groups: []})).not.toBeNull();
  expect(parseQualityConfig({...config, groups: [{...groups[0], name: "T1"}]})).not.toBeNull();
  for (const invalid of [{...config, enabled: false}, {...config, groups: [groups[0], groups[0], groups[2], groups[3]]}, {...config, startedAt: "date"}]) expect(parseQualityConfig(invalid)).toBeNull();
  expect(qualityDate({toDate: () => now})).toEqual(now); expect(normalizeQualityKeyword(" ＰＲＩＣＥ\n  Check ")).toBe("price check");
});
it("gates all storage on the dev project", async () => {
  const test = setup(); const store = new FirestoreTranslationQualityStore(test.db as unknown as Firestore, {projectId: "production"});
  expect(await store.getConfig()).toBeNull(); await store.saveOriginal(original); await store.complete(original, completion); expect(test.docs(QUALITY_MESSAGES_COLLECTION)).toHaveLength(0);
  expect(await store.transitionReport("owner", "event", vi.fn())).toBeNull();
});
it("preserves first original and first completion during concurrent duplicate writes", async () => {
  const test = setup(); await Promise.all([test.store.saveOriginal(original), test.store.saveOriginal({...original, sourceText: "changed", recordedAt: new Date(0)})]);
  await Promise.all([test.store.complete(original, completion), test.store.complete({...original, sourceText: "changed"}, {...completion, translatedText: "changed"})]);
  const rows = test.docs(QUALITY_MESSAGES_COLLECTION); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({sourceText: "原文", translatedText: "Original", recordedAt: now, revision: "revision"});
});
it("completion can recover a missing initial write and safely projects nontext metadata", async () => {
  const test = setup(); await test.store.complete({...original, sourceText: "private", messageType: "image", replyToken: "token", attachment: "url"} as QualityOriginal, completion);
  const row = test.docs(QUALITY_MESSAGES_COLLECTION)[0]!; expect(row.sourceText).toBeNull(); expect(row).not.toHaveProperty("replyToken"); expect(row).not.toHaveProperty("attachment");
});
it("audio completion attaches only the first transcript", async () => {
  const test = setup(); const audio = {...original, messageType: "audio", sourceText: null}; await test.store.saveOriginal(audio); await test.store.complete(audio, {...completion, sourceText: "逐字稿"}); await test.store.complete(audio, {...completion, sourceText: "overwrite"});
  expect(test.docs(QUALITY_MESSAGES_COLLECTION)[0]!.sourceText).toBe("逐字稿");
});
it("uses event IDs first and group/message IDs as the stable fallback", () => {
  expect(qualityMessageId(original)).toBe(qualityMessageId({...original, messageId: "different"}));
  expect(qualityMessageId({...original, webhookEventId: null})).not.toBe(qualityMessageId({...original, webhookEventId: null, groupId: groups[1]!.id}));
});
it("search normalizes source and accepted translation, pages five without omissions", async () => {
  const test = setup(); for (let i = 0; i < 12; i++) await test.store.complete({...original, webhookEventId: `${i}`, sourceText: i % 2 ? "not matching" : "ＰＲＩＣＥ   Check"}, {...completion, translatedText: i % 2 ? "price\ncheck" : "other"});
  const query = {groupIds: [groups[0]!.id], start: new Date(0), end: now, keyword: "price check"};
  const first = await test.store.search(query); const second = await test.store.search({...query, cursor: first.cursor!}); const third = await test.store.search({...query, cursor: second.cursor!});
  expect([first.messages.length, second.messages.length, third.messages.length]).toEqual([5, 5, 2]); expect(third.cursor).toBeNull(); expect(new Set([...first.messages, ...second.messages, ...third.messages].map(row => row.id)).size).toBe(12); expect(test.db.limits).toEqual([200, 200, 200]);
});
it("stops an empty search at 200 records and continues via cursor; excludes removed groups", async () => {
  const test = setup(); for (let i = 0; i < 201; i++) test.db.documents.set(`${QUALITY_MESSAGES_COLLECTION}/${String(i).padStart(3, "0")}`, {...original, translatedText: "none"});
  const query = {groupIds: [groups[0]!.id], start: new Date(0), end: now, keyword: "missing"};
  const first = await test.store.search(query); expect(first).toMatchObject({messages: [], scanned: 200}); expect(first.cursor).not.toBeNull(); expect((await test.store.search({...query, cursor: first.cursor!})).scanned).toBe(1);
  expect((await test.store.search({...query, groupIds: ["excluded"]})).messages).toEqual([]);
});
it("unrelated and unauthorized private content never becomes a session or receipt", async () => {
  const test = setup(); expect(await test.report("private text")).toBeNull(); expect(await test.report("/翻譯錯誤", "unauthorized", "other")).toBeNull(); expect(test.db.documents.size).toBe(1);
});
it("manual workflow requires issue, previews and creates exactly one pending case", async () => {
  const test = setup(); for (const text of ["/翻譯錯誤", "2", "0", "1", "原文", "無"]) await test.report(text);
  expect(await test.report("   ")).toContain("1～2000"); expect(test.docs(QUALITY_CASES_COLLECTION)).toHaveLength(0);
  await test.report("金額不對"); expect(await test.report("略過")).toContain("回報預覽");
  expect(test.docs(QUALITY_CASES_COLLECTION)).toHaveLength(0); const replies = await Promise.all([test.report("確認", "confirm"), test.report("確認", "confirm")]);
  expect(replies[0]).toBe(replies[1]); expect(replies[0]).toContain("Q-"); expect(test.docs(QUALITY_CASES_COLLECTION)).toHaveLength(1);
  expect(test.docs(QUALITY_CASES_COLLECTION)[0]).toMatchObject({groupId: null, ownerUserId: "owner", status: "pending_analysis", draft: {kind: "manual", translatedText: null, issue: "金額不對", suggestion: null}});
  expect(await test.report("確認")).toContain("Q-"); expect(test.docs(QUALITY_CASES_COLLECTION)).toHaveLength(1);
});
it("transaction failure retains the draft and retry succeeds once", async () => {
  const test = setup(); for (const text of ["/翻譯錯誤", "2", "1", "1", "原文", "錯誤翻譯", "問題", "建議"]) await test.report(text);
  const before = structuredClone(test.docs(QUALITY_SESSIONS_COLLECTION)); test.db.failCommit = true;
  await expect(test.report("確認", "confirmation")).rejects.toThrow("storage_failed"); expect(test.docs(QUALITY_SESSIONS_COLLECTION)).toEqual(before); expect(test.docs(QUALITY_CASES_COLLECTION)).toHaveLength(0);
  test.db.failCommit = false; expect(await test.report("確認", "confirmation")).toContain("已建立"); expect(test.docs(QUALITY_CASES_COLLECTION)).toHaveLength(1);
});
it("redelivered inputs cannot advance the workflow twice or recreate a canceled draft", async () => {
  const test = setup(); await test.report("/翻譯錯誤", "start"); await test.report("2", "choose"); const first = await test.report("1", "group"); expect(await test.report("1", "group")).toBe(first);
  expect(test.docs(QUALITY_SESSIONS_COLLECTION)[0]!.stage).toBe("manualDirection"); await test.report("/取消"); await test.report("/翻譯錯誤", "start"); expect(test.docs(QUALITY_SESSIONS_COLLECTION)).toHaveLength(0);
});
it("sessions expire at 30 minutes and back/cancel are safe", async () => {
  const test = setup(); await test.report("/翻譯錯誤"); await test.report("2"); expect(await test.report("/返回")).toContain("1 搜尋");
  test.advance(30 * 60 * 1000); expect(await test.report("確認")).toContain("沒有有效"); expect(test.docs(QUALITY_CASES_COLLECTION)).toHaveLength(0);
  await test.report("/翻譯錯誤"); expect(await test.report("/取消")).toBe("已取消回報。"); expect(test.docs(QUALITY_SESSIONS_COLLECTION)).toHaveLength(0);
});
it("search workflow uses all groups/default dates, full selection and immutable case snapshot", async () => {
  const test = setup(); await test.store.complete(original, completion);
  for (const text of ["/翻譯錯誤", "1", "0", "7"]) await test.report(text);
  expect(await test.report("original")).toContain("1. 群組1"); expect(await test.report("1")).toContain("系統譯文：\nOriginal");
  await test.report("術語錯誤"); await test.report("建議譯文"); await test.report("確認");
  expect(test.docs(QUALITY_CASES_COLLECTION)[0]).toMatchObject({groupId: original.groupId, draft: {issue: "術語錯誤", message: {sourceText: "原文", translatedText: "Original", eventTime: now}}});
});
it("full selection handles long accepted replies in successive Unicode-safe pages", async () => {
  const test = setup(); await test.store.complete(original, {...completion, translatedText: "😀".repeat(10000), replyText: "😀".repeat(10000)});
  for (const text of ["/翻譯錯誤", "1", "1", "7", "*"]) await test.report(text);
  const first = await test.report("1"); expect(first).toContain("下一段"); expect(first!.length).toBeLessThan(24000);
  const second = await test.report("下一段"); expect(second).toContain("下一段"); const third = await test.report("下一段"); expect(third).toContain("請說明哪裡翻錯");
});
it("date parsing rejects rollover dates and includes full Taiwan calendar days", () => {
  expect(parseReportDates("2026-02-30 2026-03-01")).toBeNull(); expect(parseReportDates("2026-09-26 2026-09-25")).toBeNull();
  expect(parseReportDates("2026-09-25 2026-09-25")).toEqual({start: Date.parse("2026-09-24T16:00:00Z"), end: Date.parse("2026-09-25T15:59:59.999Z")});
});
it("reuses a search result if the session transaction retries", async () => {
  const test = setup(); let session: any = {id: "session", stage: "searchKeyword", expiresAt: +now + 10000, draft: {kind: "search"}, search: {groupIds: [groups[0]!.id], start: 0, end: +now, keyword: ""}};
  vi.spyOn(test.store, "transitionReport").mockImplementation(async (_owner, _event, transition) => {await transition(session); const result: ReportTransition = await transition(session); return result.reply;});
  const search = vi.spyOn(test.store, "search"); await test.report("keyword"); expect(search).toHaveBeenCalledOnce();
});

it("active steps renew inactivity expiry without accepting an already expired session", async () => {
  const test = setup(); await test.report("/翻譯錯誤"); test.advance(29 * 60 * 1000); await test.report("2");
  expect(test.docs(QUALITY_SESSIONS_COLLECTION)[0]!.expiresAt).toEqual(new Date(+now + 59 * 60 * 1000));
  test.advance(2 * 60 * 1000); expect(await test.report("0")).toContain("選擇翻譯方向");
});
it("cross-request nested Firestore timestamps are hydrated before cloning", async () => {
  const test = setup(); await test.store.complete(original, completion);
  for (const text of ["/翻譯錯誤", "1", "0", "7", "original"]) await test.report(text);
  // SDK snapshots return Timestamp objects, unlike the in-memory map's dates.
  const read = test.db.snapshot.bind(test.db);
  test.db.snapshot = path => {const snapshot = read(path); const data = snapshot.data();
    if (path.startsWith(QUALITY_SESSIONS_COLLECTION + "/") && data?.results) for (const row of data.results) {const time = row.eventTime; row.eventTime = {toDate: () => time};}
    return {...snapshot, data: () => data};};
  expect(await test.report("1")).toContain("2026"); await test.report("問題"); await test.report("略過"); await test.report("確認");
  expect(test.docs(QUALITY_CASES_COLLECTION)[0]!.draft.message.eventTime).toEqual(now);
});
it("a conflicting session retry never performs a second distinct 200-row search", async () => {
  const test = setup(); const session = {id: "session", stage: "searchKeyword", expiresAt: +now + 10000, draft: {kind: "search" as const}, search: {groupIds: [groups[0]!.id], start: 0, end: +now, keyword: ""}};
  vi.spyOn(test.store, "transitionReport").mockImplementation(async (_owner, _event, transition) => {await transition(session); await transition({...session, search: {...session.search, start: 1}}); return null;});
  const search = vi.spyOn(test.store, "search"); await expect(test.report("keyword")).rejects.toThrow("quality_search_conflict"); expect(search).toHaveBeenCalledOnce();
});
