import {createHmac} from "node:crypto";
import {Readable} from "node:stream";
import type {Firestore} from "firebase-admin/firestore";
import {describe, it, expect, vi} from "vitest";
import {ARCHIVE_EVENTS, ARCHIVE_MESSAGES, ARCHIVE_JOBS, ARCHIVE_CONFIG, ARCHIVE_VERSION, archiveMessageKey, captureArchiveEvent, ArchivePersistenceError, type ConversationArchiveStore} from "./conversation-archive.js";
import {FirestoreConversationArchiveStore} from "./conversation-archive-store.js";
import {processArchiveJob, ArchiveContentUnavailable, LineArchiveContentSource, type ArchiveObjectStore} from "./conversation-archive-worker.js";
import {FirestoreTranslationQualityStore, QUALITY_MESSAGES_COLLECTION, QUALITY_CONFIG_PATH} from "./translation-quality-store.js";
import {processLineWebhook, type WebhookDependencies} from "./webhook.js";
import {LineMessagingApiReplier} from "./services.js";
import {FirestoreDevEventOperationStore} from "./dev-event-operation-store.js";

class ArchiveDb {
  rows = new Map<string, any>(); fail = false; private tail: Promise<unknown> = Promise.resolve();
  snapshot(path: string): any {const data = structuredClone(this.rows.get(path)); return {id: path.split("/").at(-1), ref: this.doc(path), exists: data !== undefined, data: () => data, get: (key: string) => data?.[key]};}
  doc(path: string): any {return {path, get: async () => this.snapshot(path), set: async (value: any, options?: any) => {this.rows.set(path, options?.merge ? {...this.rows.get(path), ...structuredClone(value)} : structuredClone(value));}, collection: (name: string) => this.collection(path + "/" + name)};}
  collection(path: string): any {
    const filters: Array<[string, string, any]> = []; let max = Infinity;
    const query: any = {doc: (id: string) => this.doc(path + "/" + id), where: (field: string, op: string, value: any) => {filters.push([field, op, value]); return query;}, orderBy: () => query, limit: (value: number) => {max = value; return query;},
      listDocuments: async () => [...new Set([...this.rows.keys()].filter(key => key.startsWith(path + "/")).map(key => key.slice(0, path.length + 1) + key.slice(path.length + 1).split("/")[0]))].map(key => this.doc(key)),
      get: async () => {const docs = [...this.rows.keys()].filter(key => key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/")).map(key => this.snapshot(key)).filter(doc => filters.every(([field, op, value]) => op === "==" ? doc.get(field) === value : op === "array-contains" ? doc.get(field)?.includes(value) : op === ">=" ? doc.get(field) >= value : doc.get(field) <= value)).slice(0, max); return {docs, size: docs.length};}};
    return query;
  }
  runTransaction<T>(run: (tx: any) => Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {const writes: Array<() => void> = []; let wrote = false;
      const tx = {get: async (ref: any) => {if (wrote) throw Error("read after write"); return this.snapshot(ref.path);},
        getAll: async (...refs: any[]) => {if (wrote) throw Error("read after write"); return refs.map(ref => this.snapshot(ref.path));},
        create: (ref: any, data: any) => {wrote = true; if (this.rows.has(ref.path)) throw Error("already exists"); const value = structuredClone(data); writes.push(() => this.rows.set(ref.path, value));},
        set: (ref: any, data: any, options?: any) => {wrote = true; const value = structuredClone(data); writes.push(() => this.rows.set(ref.path, options?.merge ? {...this.rows.get(ref.path), ...value} : value));},
        delete: (ref: any) => {wrote = true; writes.push(() => this.rows.delete(ref.path));}};
      const result = await run(tx); if (this.fail) throw Error("db unavailable"); writes.forEach(write => write()); return result;});
    this.tail = task.catch(() => {}); return task;
  }
}
const group = "C" + "a".repeat(32), other = "C" + "b".repeat(32);
const event = (text = "請確認", id = "one", groupId = group): any => ({type: "message", webhookEventId: id, timestamp: 1791945000000, replyToken: "do-not-store", source: {type: "group", groupId, userId: "member"}, message: {type: "text", id: "m-" + id, text, quoteToken: "secret-quote"}});
function setup() {
  const db = new ArchiveDb(); db.rows.set(ARCHIVE_CONFIG, {enabled: true, version: ARCHIVE_VERSION, startedAt: new Date(0)});
  db.rows.set("lineTranslationGroups/" + group, {recordingEnabled: true});
  db.rows.set(QUALITY_CONFIG_PATH, {enabled: true, startedAt: new Date(0), groups: []});
  let now = new Date("2026-10-14T01:00:00Z");
  const store = new FirestoreConversationArchiveStore(db as unknown as Firestore, "line-auto-translate-bot-dev", () => now);
  return {db, store, advance: (ms: number) => {now = new Date(+now + ms);}, docs: (collection: string) => [...db.rows].filter(([key]) => key.startsWith(collection + "/") && !key.slice(collection.length + 1).includes("/")).map(([,data]) => data)};
}
const unsend = (messageId: string, id = "unsend"): any => ({type: "unsend", webhookEventId: id, timestamp: 1791945001000, source: {type: "group", groupId: group}, unsend: {messageId}});

describe("conversation storage", () => {
  it("projects message metadata without tokens, including all supported types", async () => {
    for (const type of ["text", "image", "audio", "video", "file", "sticker", "location"]) {
      const input = event(); input.message.type = type; input.message.mention = {mentionees: [{userId: "member", index: 0, length: 2}]};
      const captured = captureArchiveEvent(input)!; expect(captured.messageType).toBe(type); expect(captured.metadata.mention).toBeDefined();
      expect(JSON.stringify(captured)).not.toContain("do-not-store"); expect(JSON.stringify(captured)).not.toContain("secret-quote");
      expect(captured.sourceText).toBe(type === "text" ? "請確認" : null);
    }
  });
  it.each(["join", "leave", "memberJoined", "memberLeft", "postback", "futureEvent"])("saves group event %s", async type => {
    const t = setup(); const input = {...event(), type, joined: {members: [{type: "user", userId: "new-member"}]}};
    const result = await t.store.capture(input, "owner"); expect(result?.eventType).toBe(type); expect(t.docs(ARCHIVE_EVENTS)).toHaveLength(1);
  });
  it("excludes private chats and rooms, and requires stable identifiers", () => {
    expect(captureArchiveEvent({...event(), source: {type: "user", userId: "member"}})).toBeNull();
    expect(captureArchiveEvent({...event(), source: {type: "room", roomId: "room"}})).toBeNull();
    expect(() => captureArchiveEvent({...event(), webhookEventId: undefined, message: {type: "text", text: "x"}})).toThrow(ArchivePersistenceError);
  });
  it("keeps text entered in message stickers", () => {
    const input = event(); input.message.type = "sticker";
    expect(captureArchiveEvent(input)?.metadata.text).toBe("請確認");
  });
  it("new groups default off; only the owner can archive an enabling command while off", async () => {
    const t = setup(); expect(await t.store.capture(event("x", "off", other), "owner")).toBeNull();
    expect(await t.store.capture(event("/開啟記錄", "bad", other), "owner")).toBeNull();
    const input = event("/開啟記錄", "good", other); input.source.userId = "owner";
    expect(await t.store.capture(input, "owner")).not.toBeNull(); expect(t.docs(ARCHIVE_JOBS)).toHaveLength(0);
  });
  it("preserves the first event and updates edited text according to event time", async () => {
    const t = setup(), input = event();
    await Promise.all([t.store.capture(input, "owner"), t.store.capture(input, "owner")]);
    await t.store.capture({...input, type: "messageEdited", webhookEventId: "edit-new", timestamp: input.timestamp + 10, message: {...input.message, text: "新版"}}, "owner");
    await t.store.capture({...input, type: "messageEdited", webhookEventId: "edit-old", timestamp: input.timestamp + 5, message: {...input.message, text: "舊版"}}, "owner");
    expect(t.docs(ARCHIVE_EVENTS)).toHaveLength(3); expect(t.docs(ARCHIVE_MESSAGES)[0].sourceText).toBe("新版");
    expect(await t.store.getQuotedOriginal(group, input.message.id)).toEqual({status: "known", text: "新版"});
  });
  it("unsend tombstones stop late originals, translations, replies and quotes", async () => {
    const t = setup(); const input = event();
    await t.store.capture(unsend(input.message.id), "owner"); const record = (await t.store.capture(input, "owner"))!;
    expect(record.redacted).toBe(true); expect(record.sourceText).toBeNull();
    await t.store.finish(record, {sourceText: "late transcript", outcome: "translated", deliveryStatus: "sent", completedAt: new Date()});
    await expect(t.store.prepareReply(record, 0, [{type: "text", text: "late"}])).rejects.toThrow("unsent");
    expect(await t.store.getQuotedOriginal(group, input.message.id)).toEqual({status: "unknown"});
    const quality = new FirestoreTranslationQualityStore(t.db as unknown as Firestore, {projectId: "line-auto-translate-bot-dev"});
    await expect(quality.saveOriginal({groupId: group, groupName: "test", senderUserId: "member", webhookEventId: "one", messageId: input.message.id, messageType: "text", sourceText: "late", eventTime: new Date(), recordedAt: new Date()})).rejects.toThrow("unsent");
    expect(t.docs(QUALITY_MESSAGES_COLLECTION)).toHaveLength(0);
  });
  it("still accepts unsend after recording is switched off and purges all linked text", async () => {
    const t = setup(); const record = (await t.store.capture(event(), "owner"))!;
    await t.store.prepareReply(record, 0, [{type: "text", text: "reply"}]);
    t.db.rows.set("lineTranslationGroups/" + group, {recordingEnabled: false});
    await t.store.capture(unsend(record.messageId!), "owner");
    const job = await t.store.claimJob(t.docs(ARCHIVE_JOBS)[0].id); await t.store.purgeContent(job!);
    expect(t.docs(ARCHIVE_EVENTS).every(row => row.redacted && row.sourceText == null && (!row.messages || row.messages.length === 0))).toBe(true);
  });
});

describe("archive media worker", () => {
  async function media() {const t = setup(); const input = event(); input.message = {type: "image", id: "image", contentProvider: {type: "line"}}; await t.store.capture(input, "owner"); return {...t, id: t.docs(ARCHIVE_JOBS)[0].id};}
  const objects = (): ArchiveObjectStore => ({save: vi.fn(async job => ({objectPath: job.messageKey, bytes: 3, sha256: "digest", contentType: "image/png"})), remove: vi.fn(async () => {})});
  const source = () => ({load: vi.fn(async () => ({stream: Readable.from([Buffer.from("raw")]), contentType: "image/png"}))});
  it("saves original content once and records its object metadata", async () => {
    const t = await media(), storage = objects(), content = source(); await processArchiveJob(t.id, t.store, content, storage); await processArchiveJob(t.id, t.store, content, storage);
    expect(content.load).toHaveBeenCalledOnce(); expect(t.docs(ARCHIVE_MESSAGES)[0]).toMatchObject({attachmentStatus: "saved", bytes: 3, sha256: "digest"});
  });
  it("marks permanent unavailable content missing without a false success", async () => {
    const t = await media(), content = source(); content.load.mockRejectedValue(new ArchiveContentUnavailable(true, "expired"));
    await processArchiveJob(t.id, t.store, content, objects()); expect(t.docs(ARCHIVE_MESSAGES)[0].attachmentStatus).toBe("missing");
  });
  it("temporary download failure can retry, but stops after eight actual attempts", async () => {
    const t = await media(), content = source(); content.load.mockRejectedValue(new Error("offline"));
    for (let i = 0; i < 7; i++) await expect(processArchiveJob(t.id, t.store, content, objects())).rejects.toThrow("retry");
    await processArchiveJob(t.id, t.store, content, objects()); await processArchiveJob(t.id, t.store, content, objects()); expect(content.load).toHaveBeenCalledTimes(8);
    expect(t.docs(ARCHIVE_JOBS)[0].status).toBe("missing");
  });
  it("removes an upload that races an unsend", async () => {
    const t = await media(), storage = objects(); vi.mocked(storage.save).mockImplementation(async job => {await t.store.capture(unsend("image"), "owner"); return {objectPath: job.messageKey, bytes: 3, sha256: "hash", contentType: "image/png"};});
    await processArchiveJob(t.id, t.store, source(), storage); expect(storage.remove).toHaveBeenCalledOnce(); expect(t.docs(ARCHIVE_MESSAGES)[0].redacted).toBe(true);
  });
  it("late-object deletion failure at attempt eight remains a purge retry", async () => {
    const t = await media(), storage = objects(); t.db.rows.get(ARCHIVE_JOBS + "/" + t.id).attempts = 7;
    vi.mocked(storage.save).mockImplementation(async job => {await t.store.capture(unsend("image"), "owner"); return {objectPath: job.messageKey, bytes: 3, sha256: "hash", contentType: "image/png"};});
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("temporary delete error"));
    await expect(processArchiveJob(t.id, t.store, source(), storage)).rejects.toThrow("retry");
    expect(t.db.rows.get(ARCHIVE_JOBS + "/" + t.id)).toMatchObject({kind: "purge", status: "pending", attempts: 8});
    await processArchiveJob(t.id, t.store, source(), storage);
    expect(t.db.rows.get(ARCHIVE_JOBS + "/" + t.id)).toMatchObject({kind: "purge", status: "complete", attempts: 9});
  });
  it("clears receipts whose session parent was deleted without a collection-group index", async () => {
    const t = await media(); await t.store.capture(unsend("image"), "owner");
    const job = await t.store.claimJob(t.docs(ARCHIVE_JOBS).find(row => row.kind === "purge").id);
    const key = "lineTranslationReportSessions/deleted/events/receipt";
    t.db.rows.set(key, {messageKeys: [job!.messageKey], reply: "private copied source"});
    await t.store.purgeContent(job!); expect(t.db.rows.get(key).reply).toBe("相關訊息已收回。");
  });
  it("does not translate, transcribe or fetch a recalled attachment", async () => {
    const t = await media(), content = source(); await t.store.capture(unsend("image"), "owner"); await processArchiveJob(t.id, t.store, content, objects()); expect(content.load).not.toHaveBeenCalled();
  });
  it("LINE transient preparation and expired content are classified without body leakage", async () => {
    const pending = new LineArchiveContentSource("secret", vi.fn(async () => new Response(null, {status: 202})) as typeof fetch);
    await expect(pending.load("id", AbortSignal.timeout(1000))).rejects.toMatchObject({permanent: false, reason: "content_preparing"});
    const expired = new LineArchiveContentSource("secret", vi.fn(async () => new Response("private response", {status: 404})) as typeof fetch);
    await expect(expired.load("id", AbortSignal.timeout(1000))).rejects.toMatchObject({permanent: true, reason: "content_expired_or_unsent"});
  });
});

describe("archive-first webhook", () => {
  function webhook() {
    const t = setup(); const quality = new FirestoreTranslationQualityStore(t.db as unknown as Firestore, {projectId: "line-auto-translate-bot-dev"});
    const translator = {translate: vi.fn(async () => {expect(t.docs(ARCHIVE_EVENTS).some(row => row.eventType === "message")).toBe(true); expect(t.docs(QUALITY_MESSAGES_COLLECTION)).toHaveLength(1); return "Please confirm.";})};
    const dependencies: WebhookDependencies = {archiveStore: t.store, channelSecret: "sign", ownerUserId: "owner", qualityStore: quality, translator,
      transcriber: {transcribe: vi.fn()}, audioContentLoader: {getMessageContent: vi.fn()}, replier: {replyText: vi.fn(async () => {})},
      settingsStore: {getSettings: vi.fn(async () => ({recordingEnabled: true, textTranslationEnabled: true, audioTranscriptionEnabled: false, translationMode: "zh-en" as const})), setModeAndEnabled: vi.fn(), setAudioTranscriptionEnabled: vi.fn(), setTextTranslationEnabled: vi.fn()}, failureStore: {save: vi.fn()}, logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn()}};
    const call = async (events: unknown[]) => {const rawBody = Buffer.from(JSON.stringify({events})); return processLineWebhook({method: "POST", rawBody, signature: createHmac("sha256", "sign").update(rawBody).digest("base64")}, dependencies);};
    return {...t, dependencies, translator, call};
  }
  it("writes all text to history, but only translatable text to translation records", async () => {
    const t = webhook(); await t.call([event("OK", "skip"), event("123", "digits"), event("請確認", "translate")]);
    expect(t.docs(ARCHIVE_EVENTS).filter(row => row.eventType === "message")).toHaveLength(3); expect(t.docs(QUALITY_MESSAGES_COLLECTION)).toHaveLength(1); expect(t.translator.translate).toHaveBeenCalledOnce();
    expect(t.docs(ARCHIVE_EVENTS).filter(row => row.eventType === "botReply")).toHaveLength(3);
  });
  it("failed source admission returns 503 without translation or LINE calls", async () => {
    const t = webhook(); t.db.fail = true; expect((await t.call([event()])).status).toBe(503); expect(t.translator.translate).not.toHaveBeenCalled(); expect(t.dependencies.replier.replyText).not.toHaveBeenCalled();
  });
  it("audio translation-original save failure uses the same 503 classification as text", async () => {
    const t = webhook(); vi.mocked(t.dependencies.settingsStore.getSettings).mockResolvedValue({recordingEnabled: true, textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: "zh-en"});
    vi.mocked(t.dependencies.audioContentLoader.getMessageContent).mockResolvedValue(Buffer.from("synthetic")); vi.mocked(t.dependencies.transcriber.transcribe).mockResolvedValue({text: "請確認標籤。"});
    vi.spyOn(t.dependencies.qualityStore!, "saveOriginal").mockRejectedValue(new Error("synthetic original write failure"));
    const input = event(); input.message = {type: "audio", id: "audio", contentProvider: {type: "line"}};
    expect((await t.call([input])).status).toBe(503); expect(t.translator.translate).not.toHaveBeenCalled(); expect(t.dependencies.replier.replyText).not.toHaveBeenCalled();
  });
  it("join reply preparation fails closed with 503 before LINE is called", async () => {
    const t = webhook(); vi.spyOn(t.store, "prepareReply").mockRejectedValue(new ArchivePersistenceError());
    expect((await t.call([{...event(), type: "join"}])).status).toBe(503); expect(t.dependencies.replier.replyText).not.toHaveBeenCalled();
  });
  it("Sol deadline and operation wrappers preserve the native reply observer and message IDs", async () => {
    const t = webhook(); t.dependencies.solReviewEnabled = true;
    t.dependencies.eventOperationStore = new FirestoreDevEventOperationStore(t.db as unknown as Firestore, "line-auto-translate-bot-dev");
    const replyMessage = vi.fn(async () => ({sentMessages: [{id: "native-observer-result"}]}));
    t.dependencies.replier = new LineMessagingApiReplier("synthetic-no-line", {replyMessage});
    expect((await t.call([event()])).status).toBe(200);
    expect(t.docs(ARCHIVE_EVENTS).find(row => row.eventType === "botReply")).toMatchObject({status: "accepted", messageIds: ["native-observer-result"]});
    expect(replyMessage).toHaveBeenCalledOnce();
  });
  it("archives media metadata and durable jobs without fetching attachments in the webhook", async () => {
    const t = webhook(), input = event(); input.message = {type: "file", id: "file", fileName: "proof.pdf", fileSize: 100};
    await t.call([input]); expect(t.docs(ARCHIVE_JOBS)).toHaveLength(1); expect(t.docs(QUALITY_MESSAGES_COLLECTION)).toHaveLength(0); expect(t.dependencies.audioContentLoader.getMessageContent).not.toHaveBeenCalled();
  });
  it("failed translations still have a linked translation record and safe reply", async () => {
    const t = webhook(); t.translator.translate.mockRejectedValue(new Error("engine failed")); await t.call([event()]);
    expect(t.docs(QUALITY_MESSAGES_COLLECTION)[0]).toMatchObject({outcome: "failed", translatedText: null, archiveEventId: expect.any(String)});
    expect(t.dependencies.replier.replyText).toHaveBeenCalledWith("do-not-store", "🚧");
  });
  it("invalid signatures are rejected before any archive writes", async () => {
    const t = webhook(); const capture = vi.spyOn(t.store, "capture");
    await processLineWebhook({method: "POST", rawBody: Buffer.from("{}"), signature: "invalid"}, t.dependencies); expect(capture).not.toHaveBeenCalled();
  });
});
