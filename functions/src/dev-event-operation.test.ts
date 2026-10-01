import {createHmac} from "node:crypto";
import {expect, it, vi} from "vitest";
import {initialOperation, operationIdentity, operationData, DevEventSession, type DevEventOperation, type DevEventOperationStore, type OperationOwner, type OperationTelemetry} from "./dev-event-operation.js";
import {LineMessagingApiReplier} from "./services.js";
import {assertOperationOwner, completionTelemetry} from "./dev-event-operation-store.js";
import {initialNmtLedger, reserveNmtLedger} from "./nmt-budget.js";
import {ControlledNmtClient, type NmtResponse} from "./nmt-controlled-client.js";
import {NMT_TEST_PROJECT as projectId, NMT_TEST_ACCOUNT, NMT_RUNTIME_ACCOUNT, NMT_TEST_BILLING} from "./nmt-isolation.js";
import {NmtGlossaryTranslator} from "./nmt-glossary-translator.js";
import {VietnameseNmtTranslator} from "./vietnamese-nmt-translator.js";
import {createTranslationProgramRouter} from "./translation-program.js";
import type {TranslationQualityStore} from "./translation-quality-store.js";
import {processLineWebhook, type WebhookDependencies} from "./webhook.js";

class MemoryOperations implements DevEventOperationStore {
  public rows = new Map<string, DevEventOperation>();
  public ledger = initialNmtLedger(projectId);
  public fail: "claim" | "reserve" | "delivery_start" | "sent" | "complete" | "provider_finish_before" | "provider_finish_after" | undefined;
  private providerFinishFailures = 0;
  public async claim(event: unknown) {
    if (this.fail === "claim") throw Error("offline");
    const record = initialOperation(event);
    if (this.rows.has(record.operationId)) return null;
    this.rows.set(record.operationId, operationData(record));
    return new DevEventSession(this, record, record);
  }
  public async reserveProvider(owner: OperationOwner, category: "manual", characters: number, telemetry: OperationTelemetry) {
    if (this.fail === "reserve") throw Error("offline");
    const record = assertOperationOwner(this.rows.get(owner.operationId), owner);
    if (record.providerStatus !== "not_started") throw Error("started");
    this.ledger = reserveNmtLedger(this.ledger, projectId, category, characters);
    this.rows.set(owner.operationId, operationData({...record, providerStatus: "provider_started", telemetry}));
  }
  public async update(owner: OperationOwner, patch: Parameters<DevEventOperationStore["update"]>[1], telemetry: OperationTelemetry) {
    if (this.fail === "delivery_start" && patch.deliveryStatus === "delivery_started" || this.fail === "sent" && patch.deliveryStatus === "sent" || this.fail === "complete" && patch.completedAt) throw Error("offline");
    const record = assertOperationOwner(this.rows.get(owner.operationId), owner);
    const loseProviderFinish = patch.providerStatus === "provider_succeeded" && this.providerFinishFailures === 0 && (this.fail === "provider_finish_before" || this.fail === "provider_finish_after");
    if (loseProviderFinish) this.providerFinishFailures++;
    if (loseProviderFinish && this.fail === "provider_finish_before") throw Error("synthetic control failure");
    if (patch.deliveryStatus === "delivery_started" && record.deliveryStatus !== "not_attempted") throw Error("already sent");
    this.rows.set(owner.operationId, operationData({...record, ...patch, telemetry: completionTelemetry(record, telemetry)}));
    if (loseProviderFinish && this.fail === "provider_finish_after") throw Error("synthetic acknowledgement lost");
  }
}
const event = (id: string, text = "你好") => ({webhookEventId: id, type: "message", replyToken: "PRIVATE TOKEN", timestamp: 1000, source: {type: "group", groupId: "C" + "a".repeat(32), userId: "PRIVATE USER"}, message: {type: "text", id: "message-" + id, text}});
function setup(mode: "zh-en" | "zh-vi" = "zh-en") {
  const store = new MemoryOperations();
  const send = vi.fn(async (request: {contents: string[]; targetLanguageCode: string}) => [request.targetLanguageCode === "vi" ? {translations: [{translatedText: "Xin chào"}]} : {glossaryTranslations: [{translatedText: '<div id="p0">Hello</div>'}]}] as [NmtResponse]);
  const reserve = vi.fn();
  const deps: WebhookDependencies = {eventOperationStore: store, channelSecret: "synthetic", ownerUserId: "owner",
    transcriber: {transcribe: vi.fn()}, audioContentLoader: {getMessageContent: vi.fn()}, failureStore: {save: vi.fn()}, replier: {replyText: vi.fn(async () => {})},
    settingsStore: {getSettings: vi.fn(async () => ({textTranslationEnabled: true, audioTranscriptionEnabled: false, translationMode: mode})), setModeAndEnabled: vi.fn(), setTextTranslationEnabled: vi.fn(), setAudioTranscriptionEnabled: vi.fn()}, logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn()},
    createEventTranslationProgram: session => {
      const client = new ControlledNmtClient({translateText: send}, {reserve}, "manual", async () => ({projectId, principal: NMT_TEST_ACCOUNT, runtimeAccount: NMT_RUNTIME_ACCOUNT, billingAccount: "billingAccounts/" + NMT_TEST_BILLING, billingEnabled: true}), false, session);
      const parent = "projects/" + projectId + "/locations/us-central1";
      return createTranslationProgramRouter(() => ({translator: new NmtGlossaryTranslator({projectId, location: "us-central1", glossaryZhEn: parent + "/glossaries/nmt-trade-zh-en-v12", glossaryEnZh: parent + "/glossaries/nmt-trade-en-zh-v9", onMetric: metric => {session.telemetry.adapterVersion = metric.adapterVersion ?? null; if (metric.apiCalled === false) {session.telemetry.apiCalled = false; session.telemetry.outputCharacters = metric.outputCharacters;} if (metric.reason) {session.telemetry.reason = metric.reason; session.telemetry.failureStage = "validation";}}}, client), mentionAliases: []}), () => new VietnameseNmtTranslator(projectId, client));
    }};
  const call = (events: unknown[]) => {const rawBody = Buffer.from(JSON.stringify({events}));return processLineWebhook({method: "POST", rawBody, signature: createHmac("sha256", "synthetic").update(rawBody).digest("base64")}, deps);};
  return {store, send, reserve, deps, call, row: (id: string) => store.rows.get(operationIdentity(event(id)).operationId)!};
}
it("prioritizes event ID, falls back to group+message, and marks unavailable keys", () => {
  expect(operationIdentity(event("one")).operationId).toBe(operationIdentity({...event("one"), message: {id: "different"}}).operationId);
  const fallback = {...event("one"), webhookEventId: undefined};
  expect(operationIdentity(fallback).operationId).toBe(operationIdentity(fallback).operationId);
  expect(operationIdentity({...fallback, source: {type: "group", groupId: "other"}}).operationId).not.toBe(operationIdentity(fallback).operationId);
  expect(operationIdentity({}).deduplication).toBe("unavailable");
  expect(operationIdentity({}).operationId).not.toBe(operationIdentity({}).operationId);
});
it.each(["zh-en", "zh-vi"] as const)("deduplicates concurrent same event with recording off for %s", async mode => {
  const s = setup(mode);s.deps.qualityStore = {getConfig: vi.fn(async () => ({enabled: true, groups: [], startedAt: new Date()})), getRecordingEnabled: vi.fn(async () => false), saveOriginal: vi.fn(), complete: vi.fn()} as unknown as TranslationQualityStore;
  await Promise.all([s.call([event("one")]), s.call([event("one")])]);
  expect(s.send).toHaveBeenCalledTimes(1);expect(s.reserve).not.toHaveBeenCalled();expect(s.deps.replier.replyText).toHaveBeenCalledTimes(1);expect(s.deps.qualityStore!.saveOriginal).not.toHaveBeenCalled();
  expect(s.row("one")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "validated", deliveryStatus: "sent", telemetry: {apiCalled: true}});
  const telemetry = s.row("one").telemetry;expect(telemetry.primaryTextWire + telemetry.primaryMarkup + telemetry.auxiliaryWire).toBe(telemetry.wireCharacters);
  const stored = JSON.stringify([...s.store.rows.values()]);for (const secret of ["你好", "Hello", "Xin chào", "PRIVATE TOKEN", "PRIVATE USER"]) expect(stored).not.toContain(secret);
});
it("keeps distinct same-text events and multiple events isolated", async () => {
  const s = setup();await s.call([event("one"), event("two"), event("one")]);expect(s.send).toHaveBeenCalledTimes(2);expect(s.deps.replier.replyText).toHaveBeenCalledTimes(2);expect(s.store.ledger.reservations).toBe(2);
});
it.each(["OK", "123", "PP-BK?", "/翻譯設定", "/翻譯狀態"])("records zero-provider path %s", async text => {
  const s = setup();await s.call([event("local", text)]);expect(s.send).not.toHaveBeenCalled();expect(s.row("local").telemetry.apiCalled).toBe(false);expect(s.row("local").telemetry.reservedCharacters).toBe(0);expect(s.store.ledger.used).toBe(0);expect(s.row("local").completedAt).toBeTruthy();
});
it("claim failure blocks commands, reads, capture, download, provider and LINE", async () => {
  const s = setup();s.store.fail = "claim";s.deps.qualityStore = {getConfig: vi.fn()} as unknown as TranslationQualityStore;
  const result = await s.call([event("one", "/中翻英")]);expect(result.body.failed).toBe(1);expect(s.deps.settingsStore.getSettings).not.toHaveBeenCalled();expect(s.deps.settingsStore.setModeAndEnabled).not.toHaveBeenCalled();expect(s.deps.qualityStore!.getConfig).not.toHaveBeenCalled();expect(s.send).not.toHaveBeenCalled();expect(s.deps.replier.replyText).not.toHaveBeenCalled();
});
it("reservation failure sends no provider and remains zero-call", async () => {
  const s = setup();s.store.fail = "reserve";await s.call([event("one")]);expect(s.send).not.toHaveBeenCalled();expect(s.row("one").telemetry.apiCalled).toBe(false);expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE TOKEN", "🚧");
});
it("provider timeout is unknown and redelivery never repeats the provider", async () => {
  const s = setup();s.send.mockRejectedValue({code: "ETIMEDOUT", message: "PRIVATE ERROR"});await s.call([event("one")]);await s.call([event("one")]);expect(s.send).toHaveBeenCalledTimes(1);expect(s.row("one")).toMatchObject({providerStatus: "provider_unknown", telemetry: {apiCalled: "unknown", reason: "ETIMEDOUT", failureStage: "provider"}});expect(JSON.stringify(s.row("one"))).not.toContain("PRIVATE ERROR");
});
it("definitive provider HTTP failure differs from unknown", async () => {
  const s = setup();s.send.mockRejectedValue({status: 403});await s.call([event("one")]);expect(s.row("one")).toMatchObject({providerStatus: "service_error", telemetry: {apiCalled: true}});
});
it("preserves fine quality rejection without saving rejected output", async () => {
  const s = setup();s.send.mockResolvedValue([{glossaryTranslations: [{translatedText: "PRIVATE CANDIDATE"}]}]);await s.call([event("one")]);expect(s.row("one")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "quality_rejected", telemetry: {apiCalled: true, failureStage: "validation"}});expect(s.row("one").telemetry.reason).toBeTruthy();expect(JSON.stringify(s.row("one"))).not.toContain("PRIVATE CANDIDATE");
});
it("persisting delivery_started failure sends nothing while validated summary survives", async () => {
  const s = setup();s.store.fail = "delivery_start";await s.call([event("one")]);expect(s.deps.replier.replyText).not.toHaveBeenCalled();expect(s.row("one").translationStatus).toBe("validated");expect(s.row("one").deliveryStatus).toBe("not_attempted");expect(s.deps.failureStore.save).not.toHaveBeenCalled();
});
it("LINE timeout retains validated result separately and never compensates or resends", async () => {
  const s = setup();vi.mocked(s.deps.replier.replyText).mockRejectedValue(Error("PRIVATE LINE"));await s.call([event("one")]);await s.call([event("one")]);expect(s.deps.replier.replyText).toHaveBeenCalledTimes(1);expect(s.row("one")).toMatchObject({translationStatus: "validated", deliveryStatus: "delivery_unknown"});expect(s.deps.failureStore.save).not.toHaveBeenCalled();
});
it("accepted LINE followed by failed sent write cannot trigger an error reply", async () => {
  const s = setup();s.store.fail = "sent";await s.call([event("one")]);await s.call([event("one")]);expect(s.deps.replier.replyText).toHaveBeenCalledTimes(1);expect(s.row("one")).toMatchObject({translationStatus: "validated", deliveryStatus: "delivery_started"});expect(s.deps.failureStore.save).not.toHaveBeenCalled();
});
it("wrong owner and repeated provider reservation are rejected", async () => {
  const store = new MemoryOperations(), session = (await store.claim(event("one")))!;
  await expect(store.update({...session.owner, ownerAttempt: "other"}, {}, session.telemetry)).rejects.toThrow();
  await session.reserveProvider("manual", 2);await expect(session.reserveProvider("manual", 2)).rejects.toThrow();expect(store.ledger.used).toBe(2);
});
it("advisory English and Vietnamese callbacks cannot reject accepted output", async () => {
  const parent = "projects/" + projectId + "/locations/us-central1";
  const english = new NmtGlossaryTranslator({projectId, location: "us-central1", glossaryZhEn: parent + "/glossaries/nmt-trade-zh-en-v12", glossaryEnZh: parent + "/glossaries/nmt-trade-en-zh-v9", onMetric: () => {throw Error("metric");}}, {async translateText() {return [{glossaryTranslations: [{translatedText: '<div id="p0">Hello</div>'}]}];}});
  expect(await english.translate("你好", "zh-TW", "en")).toBe("Hello");
  const vietnamese = new VietnameseNmtTranslator(projectId, {async translateText() {return [{translations: [{translatedText: "Xin chào"}]}];}}, () => {throw Error("metric");});
  expect(await vietnamese.translate("你好", "zh-TW", "vi")).toBe("Xin chào");
});

it("retains committed reservation unknown during completion after acknowledgement loss", async () => {
  const s = setup(), reserveProvider = s.store.reserveProvider.bind(s.store);
  s.store.reserveProvider = async (...args) => {await reserveProvider(...args);throw Error("response lost");};
  await s.call([event("lost")]);await s.call([event("lost")]);expect(s.send).not.toHaveBeenCalled();
  expect(s.row("lost")).toMatchObject({providerStatus: "provider_started", telemetry: {apiCalled: "unknown", reservedCharacters: s.store.ledger.used}});
  expect(s.row("lost").telemetry.reservedCharacters).toBeGreaterThan(0);
});
it("keeps general NMT paragraphs primary and HTML quote auxiliaries exclusive", async () => {
  const store = new MemoryOperations(), session = (await store.claim(event("one")))!;
  session.prepare({parent: "x", model: "x", contents: ["<div>😀</div>", "<div>x</div>"], mimeType: "text/html", sourceLanguageCode: "zh-TW", targetLanguageCode: "vi"});
  expect(session.telemetry).toMatchObject({wireCharacters: 24, primaryTextWire: 2, primaryMarkup: 22, auxiliaryWire: 0});
});
it("allows exactly the existing definite 400 mention downgrade inside one delivery operation", async () => {
  const s = setup(), userId = "U" + "b".repeat(32);
  const replyMessage = vi.fn().mockRejectedValueOnce({status: 400}).mockResolvedValueOnce({});
  s.deps.replier = new LineMessagingApiReplier("synthetic", {replyMessage}, {isMember: async () => true});
  s.deps.createEventTranslationProgram = () => () => ({translator: {translate: async () => "@Alex Hello", translateWithRanges: async () => ({text: "@Alex Hello", ranges: [{sourceStart: 0, start: 0, length: 5}]})}, mentionAliases: []});
  const native = {...event("mention", "@Alex 你好"), message: {...event("mention").message, text: "@Alex 你好", mention: {mentionees: [{index: 0, length: 5, type: "user", userId}]}}};
  await s.call([native]);await s.call([native]);expect(replyMessage).toHaveBeenCalledTimes(2);expect(replyMessage.mock.calls[0]![0].messages[0].type).toBe("textV2");expect(replyMessage.mock.calls[1]![0].messages[0].type).toBe("text");expect(s.row("mention").deliveryStatus).toBe("sent");
});

it("malformed provider response is a known call followed by quality rejection", async () => {
  const s = setup();s.send.mockResolvedValue([{glossaryTranslations: {privateCandidate: "PRIVATE OUTPUT"}}] as never);
  await s.call([event("malformed")]);expect(s.row("malformed")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "quality_rejected", telemetry: {apiCalled: true, outputCharacters: 0, reason: "invalid_response_format", failureStage: "validation"}});
  expect(JSON.stringify(s.row("malformed"))).not.toContain("PRIVATE OUTPUT");
});

it.each(["provider_finish_before", "provider_finish_after"] as const)("preserves known provider success after %s without another provider call", async failure => {
  const s = setup();s.store.fail = failure;
  await s.call([event("finish")]);await s.call([event("finish")]);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.row("finish")).toMatchObject({providerStatus: failure === "provider_finish_before" ? "provider_started" : "provider_succeeded", translationStatus: "service_error", telemetry: {apiCalled: true, failureStage: "provider_completion", reason: "operation_store_error", outputCharacters: 24}});
  expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE TOKEN", "🚧");
});
it("counts null response items safely and rejects them as quality after a known call", async () => {
  const s = setup();s.send.mockResolvedValue([{glossaryTranslations: [null]}] as never);
  await s.call([event("null-part")]);await s.call([event("null-part")]);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.row("null-part")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "quality_rejected", telemetry: {apiCalled: true, outputCharacters: 0, reason: "invalid_response_format", failureStage: "validation"}});
});
it.each(["zh-en", "zh-vi"] as const)("counts obtained audio transcript codepoints with recording off for %s", async mode => {
  const s = setup(mode);vi.mocked(s.deps.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: mode});
  vi.mocked(s.deps.audioContentLoader.getMessageContent).mockResolvedValue(Buffer.from("synthetic"));
  vi.mocked(s.deps.transcriber.transcribe).mockResolvedValue({text: "你好", languageCode: "zh-TW"});
  const audio = {...event("audio"), message: {type: "audio", id: "audio", duration: 1000, contentProvider: {type: "line"}}};
  await s.call([audio]);await s.call([audio]);
  expect(s.send).toHaveBeenCalledTimes(1);expect(s.row("audio")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "validated", telemetry: {apiCalled: true, sourceCharacters: 2}});
  expect(JSON.stringify(s.row("audio"))).not.toContain("你好");
});
it("counts transcript codepoints for a local zero-provider reply and leaves pre-transcription failure at zero", async () => {
  const s = setup();vi.mocked(s.deps.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled: false, audioTranscriptionEnabled: true, translationMode: "zh-en"});
  vi.mocked(s.deps.audioContentLoader.getMessageContent).mockResolvedValue(Buffer.from("synthetic"));
  vi.mocked(s.deps.transcriber.transcribe).mockResolvedValue({text: "你好😀", languageCode: "zh-TW"});
  const audio = {...event("audio-local"), message: {type: "audio", id: "audio-local", duration: 1000, contentProvider: {type: "line"}}};
  await s.call([audio]);expect(s.send).not.toHaveBeenCalled();expect(s.row("audio-local").telemetry).toMatchObject({apiCalled: false, sourceCharacters: 3});
  vi.mocked(s.deps.audioContentLoader.getMessageContent).mockRejectedValue(Error("private failure"));
  await s.call([{...audio, webhookEventId: "audio-before", message: {...audio.message, id: "audio-before"}}]);
  expect(s.row("audio-before").telemetry.sourceCharacters).toBe(0);
});

it("keeps known provider response in telemetry when its completion phase cannot be persisted", async () => {
  const s = setup(), update = s.store.update.bind(s.store);
  s.store.update = async (owner, patch, telemetry) => {if (patch.providerStatus === "provider_succeeded") throw Error("persistent completion write failure"); await update(owner, patch, telemetry);};
  await s.call([event("completion-blocked")]);await s.call([event("completion-blocked")]);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.row("completion-blocked")).toMatchObject({providerStatus: "provider_started", translationStatus: "service_error", telemetry: {apiCalled: true, outputCharacters: 24, failureStage: "provider_completion", reason: "operation_store_error"}});
  expect(s.row("completion-blocked").completedAt).toBeTruthy();
});

it("generates Fine locally through webhook with recording off, zero ledger and durable delivery deduplication", async () => {
  const s = setup();await s.call([event("fine-b", "Fine!")]);await s.call([event("fine-b", "Fine!")]);
  expect(s.send).not.toHaveBeenCalled();expect(s.reserve).not.toHaveBeenCalled();expect(s.store.ledger.used).toBe(0);
  expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE TOKEN", "好的。");
  expect(s.row("fine-b")).toMatchObject({providerStatus: "not_started", translationStatus: "validated", deliveryStatus: "sent",
    telemetry: {apiCalled: false, reservedCharacters: 0, wireCharacters: 0, outputCharacters: 3, adapterVersion: "nmt-glossary-v22"}});
  const stored = JSON.stringify(s.row("fine-b"));expect(stored).not.toContain("Fine!");expect(stored).not.toContain("好的。");
});
it.each([
  ["We must confirm the delivery date.", "我們必須確認交期。", "validated"],
  ["We must confirm the delivery date.", "我們不必確認交期。", "quality_rejected"],
  // Prior experimental candidate: validated; withdrawal restores A rejection.
  ["Please confirm what it covers. Please confirm the delivery date too.", "請確認交期。請確認涵蓋範圍。", "quality_rejected"],
  // Prior experimental candidate: quality_rejected; A standalone suffix gap remains.
  ["Please confirm what it covers.", "請確認涵蓋範圍。只包含運費。", "validated"],
])("keeps scoped core or restored A result and API certainty through webhook: %s / %s", async (source, output, status) => {
  const s = setup();s.send.mockResolvedValue([{glossaryTranslations: [{translatedText: '<div id="p0">' + output + '</div>'}]}]);
  await s.call([event("confirm-b", source)]);await s.call([event("confirm-b", source)]);
  expect(s.send).toHaveBeenCalledTimes(1);expect(s.store.ledger.reservations).toBe(1);
  expect(s.row("confirm-b")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: status, deliveryStatus: "sent", telemetry: {apiCalled: true}});
  expect(s.deps.replier.replyText).toHaveBeenCalledTimes(1);
  if (status === "quality_rejected") expect(s.deps.replier.replyText).toHaveBeenCalledWith("PRIVATE TOKEN", "🚧");
  expect(JSON.stringify(s.row("confirm-b"))).not.toContain(output);
});
