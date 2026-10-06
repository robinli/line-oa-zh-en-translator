import {afterEach, expect, it, vi} from "vitest";
import type {Firestore} from "firebase-admin/firestore";
import {FirestoreDevEventOperationStore} from "./dev-event-operation-store.js";
import {ProductionNmtClient} from "./production-nmt-client.js";
import {PRODUCTION_PROJECT as project, PRODUCTION_RUNTIME_ACCOUNT as runtime, PRODUCTION_OPERATIONS_COLLECTION as collection} from "./production-target.js";
import {assertNmtProfileRequest} from "./nmt-request-profile.js";
import {NmtDirectTranslator} from "./nmt-direct-translator.js";
import {FirestoreTranslationQualityStore, QUALITY_CONFIG_PATH, QUALITY_MESSAGES_COLLECTION} from "./translation-quality-store.js";
import {DEV_OPERATIONS_COLLECTION, type DevEventSession} from "./dev-event-operation.js";
class MemoryDb {
  rows = new Map<string, any>(); reads: string[] = []; fail = false; tail: Promise<unknown> = Promise.resolve();
  doc(path: string): any {return {path, get: async () => this.snapshot(path), collection: (name: string) => this.collection(path + "/" + name)};}
  snapshot(path: string): any {this.reads.push(path); const value = structuredClone(this.rows.get(path)); return {exists: value !== undefined, data: () => value, get: (key: string) => value?.[key], id: path.split("/").at(-1)};}
  collection(path: string): any {return {doc: (id: string) => this.doc(path + "/" + id), get: async () => ({docs: [...this.rows.keys()].filter(p => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/")).map(p => this.snapshot(p))})};}
  runTransaction<T>(run: (tx: any) => Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {const writes: Array<() => void> = [];
      const tx = {get: async (ref: any) => this.snapshot(ref.path), getAll: async (...refs: any[]) => refs.map(r => this.snapshot(r.path)),
        set: (ref: any, data: any, options?: any) => writes.push(() => this.rows.set(ref.path, structuredClone(options?.merge ? {...this.rows.get(ref.path), ...data} : data))),
        create: (ref: any, data: any) => {if (this.rows.has(ref.path)) throw Error("exists"); writes.push(() => this.rows.set(ref.path, structuredClone(data)));}};
      const result = await run(tx); if (this.fail) throw Error("commit_failed"); writes.forEach(w => w()); return result;});
    this.tail = task.catch(() => {}); return task;
  }
}
const request = (id = project) => {const parent = "projects/" + id + "/locations/us-central1"; return {parent, model: parent + "/models/general/nmt", contents: ["Please confirm loading."], mimeType: "text/plain", sourceLanguageCode: "en", targetLanguageCode: "zh-TW"};};
const options = {timeout: 15000, retry: {retryCodes: []}};
const auth = (id = project, email = runtime) => ({getProjectId: async () => id, getCredentials: async () => ({client_email: email}), getAccessToken: async () => "PRIVATE"});
async function fixture() {const db = new MemoryDb(), store = new FirestoreDevEventOperationStore(db as unknown as Firestore, project);
 const event = {webhookEventId: "synthetic-id", source: {type: "group", groupId: "C" + "1".repeat(32)}, message: {text: "PRIVATE SOURCE"}};
 const session = (await store.claim(event))!; return {db, store, event, session, record: () => db.rows.get(collection + "/" + session.operationId)};}
afterEach(() => vi.unstubAllGlobals());
it("only allows PRD plain-profile and Vietnamese NMT; DEV defaults never accept PRD", () => {
 expect(() => assertNmtProfileRequest(request(), "nmt-direct-v1")).toThrow();
 expect(() => assertNmtProfileRequest(request(), "nmt-direct-v1", project)).not.toThrow();
 expect(() => assertNmtProfileRequest(request("foreign-project"), "nmt-direct-v1", project)).toThrow();
 expect(() => new NmtDirectTranslator({projectId: project, profile: "nmt-direct-glossary-v1"}, {translateText: vi.fn()})).toThrow();
 const parent = "projects/" + project + "/locations/global", viRequest = {...request(), parent, model: parent + "/models/general/nmt", mimeType: "text/html", sourceLanguageCode: "zh-TW", targetLanguageCode: "vi"};
 expect(() => assertNmtProfileRequest(viRequest, "legacy-glossary", project)).not.toThrow();
 expect(() => assertNmtProfileRequest({...viRequest, glossaryConfig: {} as any}, "legacy-glossary", project)).toThrow();
});
it("PRD atomically claims and reserves once without DEV budget or collection access", async () => {
 const f = await fixture(); expect(await f.store.claim(f.event)).toBeNull();
 await f.session.reserveProvider("manual", 22); expect(f.record().providerStatus).toBe("provider_started");
 await expect(f.session.reserveProvider("manual", 22)).rejects.toThrow();
 expect(f.db.reads.some(p => p.startsWith("nmtEvaluationBudget/") || p.startsWith(DEV_OPERATIONS_COLLECTION))).toBe(false);
 expect(JSON.stringify(f.record())).not.toContain("PRIVATE SOURCE");
});
it("guards both PRD project and runtime principal before reserving or fetching", async () => {
 for (const credentials of [auth("line-auto-translate-bot-dev"), auth(project, "foreign@example.com")]) {
  const f = await fixture(), send = vi.fn(); vi.stubGlobal("fetch", send);
  await expect(new ProductionNmtClient(f.session, "nmt-direct-v1", undefined, credentials).translateText(request(), options)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled(); expect(f.record().providerStatus).toBe("not_started");
 }
});
it("uses PRD parent and consumer, saves raw capture and prevents repeat provider calls", async () => {
 const f = await fixture(), input = vi.fn(), output = vi.fn();
 const send = vi.fn(async (url: string, init: any) => {expect(f.record().providerStatus).toBe("provider_started"); expect(url).toContain("projects/" + project + "/"); expect(init.headers["x-goog-user-project"]).toBe(project); return {ok: true, json: async () => ({translations: [{translatedText: "請確認裝貨。"}]})};});
 vi.stubGlobal("fetch", send); const client = new ProductionNmtClient(f.session, "nmt-direct-v1", {onInput: input, onOutput: output}, auth());
 const translator = new NmtDirectTranslator({projectId: project, profile: "nmt-direct-v1"}, client);
 expect(await translator.translate("Please confirm loading.", "en", "zh-TW")).toBe("請確認裝貨。");
 expect(f.record().providerStatus).toBe("provider_succeeded"); expect(input).toHaveBeenCalledWith(["Please confirm loading."]); expect(output).toHaveBeenCalled();
 await expect(client.translateText(request(), options)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
});
it("keeps provider uncertainty after timeout and does not refund or retry", async () => {
 const f = await fixture(), send = vi.fn(async () => {throw Object.assign(Error("PRIVATE BODY"), {name: "TimeoutError"});}); vi.stubGlobal("fetch", send);
 const client = new ProductionNmtClient(f.session, "nmt-direct-v1", undefined, auth());
 await expect(client.translateText(request(), options)).rejects.toThrow("provider");
 expect(f.record().providerStatus).toBe("provider_unknown"); expect(f.record().telemetry.reservedCharacters).toBe(23);
 await expect(client.translateText(request(), options)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1); expect(JSON.stringify(f.record())).not.toContain("PRIVATE BODY");
});
it("never starts provider if the durable reservation commit fails", async () => {
 const f = await fixture(), send = vi.fn(); vi.stubGlobal("fetch", send); f.db.fail = true;
 await expect(new ProductionNmtClient(f.session, "nmt-direct-v1", undefined, auth()).translateText(request(), options)).rejects.toThrow("reservation"); expect(send).not.toHaveBeenCalled();
});
it("PRD capture supports defaults, controls and raw output without overwriting group settings", async () => {
 const f = await fixture(), id = "C" + "1".repeat(32), now = new Date();
 f.db.rows.set(QUALITY_CONFIG_PATH, {enabled: true, groups: [], startedAt: now}); f.db.rows.set("lineTranslationGroups/" + id, {translationMode: "zh-vi", textTranslationEnabled: true, audioTranscriptionEnabled: false});
 const store = new FirestoreTranslationQualityStore(f.db as unknown as Firestore, {projectId: project});
 expect((await store.getConfig())?.groups).toHaveLength(1); expect(await store.getRecordingEnabled(id)).toBe(true);
 await store.setRecordingEnabled(id, false, "owner", "toggle", +now); expect(await store.getRecordingEnabled(id)).toBe(false);
 expect(f.db.rows.get("lineTranslationGroups/" + id)).toMatchObject({translationMode: "zh-vi", textTranslationEnabled: true, audioTranscriptionEnabled: false});
 const record = {groupId: id, groupName: "Synthetic", senderUserId: "synthetic", webhookEventId: "capture", messageId: "capture", messageType: "text", eventTime: now, recordedAt: now, sourceText: "Test"};
 await store.complete(record, {outcome: "translated", deliveryStatus: "sent", completedAt: now, translatedText: "測試", nmtInputContents: ["Test"], nmtOutputContents: {translations: ["測試"], glossaryTranslations: null}});
 expect([...f.db.rows].find(([p]) => p.startsWith(QUALITY_MESSAGES_COLLECTION + "/"))?.[1]).toMatchObject({sourceText: "Test", translatedText: "測試", nmtInputContents: ["Test"]});
});