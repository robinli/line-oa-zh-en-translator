import {createHmac} from "node:crypto";
import {expect, it, vi} from "vitest";
import {DevEventSession, initialOperation, operationData, operationIdentity, type DevEventOperation, type DevEventOperationStore, type OperationOwner, type OperationTelemetry} from "./dev-event-operation.js";
import {assertOperationOwner, completionTelemetry} from "./dev-event-operation-store.js";
import {projectNmtOutputContents} from "./nmt-content-capture.js";
import {ControlledNmtClient, type NmtResponse, type NmtCallOptions} from "./nmt-controlled-client.js";
import {VietnameseNmtTranslator} from "./vietnamese-nmt-translator.js";
import {NmtDirectTranslator} from "./nmt-direct-translator.js";
import {initialNmtLedger, reserveNmtLedger} from "./nmt-budget.js";
import {NMT_TEST_PROJECT as projectId, NMT_TEST_ACCOUNT, NMT_RUNTIME_ACCOUNT, NMT_TEST_BILLING} from "./nmt-isolation.js";
import {processLineWebhook, type WebhookDependencies} from "./webhook.js";
import type {ControlledNmtRequest} from "./nmt-isolation.js";
import type {QualityOriginal, QualityCompletion, TranslationQualityStore} from "./translation-quality-store.js";

class Operations implements DevEventOperationStore {
  rows = new Map<string, DevEventOperation>(); ledger = initialNmtLedger(projectId);
  fail: "reserve" | "finish" | "delivery" | undefined;
  async claim(event: unknown) {
    const record = initialOperation(event); if (this.rows.has(record.operationId)) return null;
    this.rows.set(record.operationId, operationData(record)); return new DevEventSession(this, record, record);
  }
  async reserveProvider(owner: OperationOwner, category: "manual", characters: number, telemetry: OperationTelemetry) {
    if (this.fail === "reserve") throw Error("store unavailable");
    const row = assertOperationOwner(this.rows.get(owner.operationId), owner);
    if (row.providerStatus !== "not_started") throw Error("already started");
    this.ledger = reserveNmtLedger(this.ledger, projectId, category, characters);
    this.rows.set(owner.operationId, operationData({...row, providerStatus: "provider_started", telemetry}));
  }
  async update(owner: OperationOwner, patch: Parameters<DevEventOperationStore["update"]>[1], telemetry: OperationTelemetry) {
    if (this.fail === "finish" && patch.providerStatus === "provider_succeeded" || this.fail === "delivery" && patch.deliveryStatus === "sent") throw Error("store unavailable");
    const row = assertOperationOwner(this.rows.get(owner.operationId), owner);
    this.rows.set(owner.operationId, operationData({...row, ...patch, telemetry: completionTelemetry(row, telemetry)}));
  }
}
function setup() {
  const store = new Operations(), send = vi.fn(async (_request: ControlledNmtRequest, _options: NmtCallOptions) => [{translations: [{translatedText: "Loading is scheduled for 1 p.m. next Wednesday."}]}] as [NmtResponse]);
  const complete = vi.fn(async (_original: QualityOriginal, _completion: QualityCompletion) => {});
  const deps: WebhookDependencies = {
    channelSecret: "synthetic", ownerUserId: "owner", eventOperationStore: store,
    createEventTranslationProgram: (session, observer) => mode => ({mentionAliases: [], translator: mode === "zh-vi" ? new VietnameseNmtTranslator(projectId, new ControlledNmtClient({translateText: async (request, options) => {observer?.onInput([...request.contents]); const result = await send(request, options); observer?.onOutput(projectNmtOutputContents(result[0])); return result;}}, {reserve: async () => {throw Error("must reserve via session");}}, "manual", async () => ({projectId, principal: NMT_TEST_ACCOUNT, runtimeAccount: NMT_RUNTIME_ACCOUNT, billingAccount: "billingAccounts/" + NMT_TEST_BILLING, billingEnabled: true}), false, session)) : new NmtDirectTranslator({projectId, profile: "nmt-direct-v1",
      onMetric: metric => {
        Object.assign(session.telemetry, {engine: metric.engine, adapterVersion: metric.adapterVersion, protectionVersion: metric.protectionVersion,
          requestProfile: metric.profile, validationScope: metric.validationScope, semanticEvaluation: metric.semanticEvaluation, protectedCounts: metric.protectedCounts});
        if (metric.apiCalled === false) {session.telemetry.apiCalled = false; session.telemetry.outputCharacters = metric.outputCharacters;}
        if (metric.reason) {session.telemetry.reason = metric.reason; session.telemetry.failureStage = "validation";}
      }}, new ControlledNmtClient({translateText: async (request, options) => {observer?.onInput([...request.contents]); const result = await send(request, options); observer?.onOutput(projectNmtOutputContents(result[0])); return result;}}, {reserve: async () => {throw Error("must use operation atomic reservation");}}, "manual", async () => ({projectId, principal: NMT_TEST_ACCOUNT, runtimeAccount: NMT_RUNTIME_ACCOUNT,
      billingAccount: "billingAccounts/" + NMT_TEST_BILLING, billingEnabled: true}), false, session, "nmt-direct-v1"))}),
    replier: {replyText: vi.fn(async () => {})}, failureStore: {save: vi.fn(async () => {})}, logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn()},
    settingsStore: {getSettings: vi.fn(async () => ({textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: "zh-en" as const})), setModeAndEnabled: vi.fn(), setTextTranslationEnabled: vi.fn(), setAudioTranscriptionEnabled: vi.fn()},
    transcriber: {transcribe: vi.fn(async () => ({text: "下週三下午一點裝櫃。"}))}, audioContentLoader: {getMessageContent: vi.fn(async () => Buffer.from("synthetic audio"))},
    qualityStore: {getConfig: vi.fn(async () => ({enabled: true, groups: [], startedAt: new Date()})), getRecordingEnabled: vi.fn(async () => true), saveOriginal: vi.fn(async () => {}), complete} as unknown as TranslationQualityStore,
    qualityMetadata: () => ({engine: "nmt-direct", glossary: null, revision: "synthetic"}),
  };
  const event = (id: string, text = "下週三下午一點裝櫃。") => ({webhookEventId: id, type: "message", replyToken: "PRIVATE", timestamp: 1000, source: {type: "group", groupId: "C" + "a".repeat(32), userId: "PRIVATE"}, message: {type: "text", id, text}});
  const call = (events: unknown[]) => {
    const rawBody = Buffer.from(JSON.stringify({events}));
    return processLineWebhook({method: "POST", rawBody, signature: createHmac("sha256", "synthetic").update(rawBody).digest("base64")}, deps);
  };
  return {store, send, deps, complete, event, call, row: (id: string) => store.rows.get(operationIdentity(event(id)).operationId)!};
}
it("runs new plain translation through webhook and persists its limited scope, separately from delivery", async () => {
  const s = setup(); await s.call([s.event("one")]);
  expect(s.row("one")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "validated", deliveryStatus: "sent",
    telemetry: {engine: "nmt-direct", requestProfile: "nmt-direct-v1", validationScope: "literal-integrity", semanticEvaluation: "not_evaluated", auxiliaryWire: 0, primaryMarkup: 0}});
  expect(s.complete.mock.calls[0]?.[1]).toMatchObject({outcome: "translated", deliveryStatus: "sent", validationScope: "literal-integrity", semanticEvaluation: "not_evaluated", requestProfile: "nmt-direct-v1"});
  expect(JSON.stringify(s.row("one"))).not.toContain("PRIVATE");
});
it("deduplicates concurrent requests and keeps distinct same-text events separate", async () => {
  const s = setup(); await Promise.all([s.call([s.event("one")]), s.call([s.event("one")])]);
  await s.call([s.event("one"), s.event("two")]);
  expect(s.send).toHaveBeenCalledTimes(2); expect(s.store.ledger.reservations).toBe(2); expect(s.deps.replier.replyText).toHaveBeenCalledTimes(2);
});
it("does not bypass control when recording is off", async () => {
  const s = setup(); vi.mocked(s.deps.qualityStore!.getRecordingEnabled).mockResolvedValue(false);
  await s.call([s.event("one")]); await s.call([s.event("one")]); expect(s.send).toHaveBeenCalledTimes(1); expect(s.complete).not.toHaveBeenCalled();
});
it("blocks provider after failed reservation", async () => {
  const s = setup(); s.store.fail = "reserve"; await s.call([s.event("one")]);
  expect(s.send).not.toHaveBeenCalled(); expect(s.store.ledger.reservations).toBe(0); expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE", "🚧");
});
it("preserves uncertainty and never repeats a timed-out direct request", async () => {
  const s = setup(); s.send.mockRejectedValue({code: "ETIMEDOUT", message: "PRIVATE CONTENT"});
  await s.call([s.event("one")]); await s.call([s.event("one")]);
  expect(s.send).toHaveBeenCalledTimes(1); expect(s.row("one")).toMatchObject({providerStatus: "provider_unknown", telemetry: {apiCalled: "unknown"}});
  expect(JSON.stringify(s.row("one"))).not.toContain("PRIVATE CONTENT");
});
it("does not send a returned translation when provider completion persistence failed", async () => {
  const s = setup(); s.store.fail = "finish"; await s.call([s.event("one")]); await s.call([s.event("one")]);
  expect(s.send).toHaveBeenCalledTimes(1); expect(s.row("one").telemetry.apiCalled).toBe(true); expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE", "🚧");
});
it("does not compensate or repeat an accepted LINE reply after completion persistence failed", async () => {
  const s = setup(); s.store.fail = "delivery"; await s.call([s.event("one")]); await s.call([s.event("one")]);
  expect(s.deps.replier.replyText).toHaveBeenCalledTimes(1); expect(s.row("one").deliveryStatus).toBe("delivery_started");
});
it.each(["OK", "123", "/翻譯狀態"])("keeps existing zero-provider product rule %s", async text => {
  const s = setup(); await s.call([s.event("one", text)]); expect(s.send).not.toHaveBeenCalled();
});
it("uses the same direct contract for a speech transcript", async () => {
  const s = setup(); const event = {...s.event("audio"), message: {id: "audio", type: "audio", duration: 1000, contentProvider: {type: "line"}}};
  await s.call([event]); expect(s.send).toHaveBeenCalledTimes(1); expect(s.send.mock.calls[0]?.[0]).toMatchObject({mimeType: "text/plain", contents: ["下週三下午一點裝櫃。"]});
  expect(s.deps.replier.replyText).toHaveBeenCalledTimes(1);
});
it("delivers a preserved configured name after provider markup loss and never retranslates redelivery", async () => {
  const s = setup(), source = "Shan requested bulk bags. Please confirm the packaging requirements.", translatedText = "Shan 要求使用大袋。請確認包裝要求。";
  s.send.mockResolvedValue([{translations: [{translatedText}]}]);
  await s.call([s.event("name", source)]); await s.call([s.event("name", source)]);
  expect(s.send).toHaveBeenCalledTimes(1); expect(s.store.ledger.reservations).toBe(1);
  expect(s.send.mock.calls[0]?.[0]).toMatchObject({mimeType: "text/html"});
  expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE", translatedText);
  expect(s.deps.failureStore!.save).not.toHaveBeenCalled();
  expect(s.row("name")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "validated", deliveryStatus: "sent",
    telemetry: {adapterVersion: "nmt-direct-v1.4", protectedCounts: {"configured-name": 1}, semanticEvaluation: "not_evaluated"}});
});
it("keeps a changed configured name rejected and records only the safe reason", async () => {
  const s = setup(), source = "Shan requested bulk bags. Please confirm the packaging requirements.";
  s.send.mockResolvedValue([{translations: [{translatedText: "山要求使用大袋。請確認包裝要求。"}]}]);
  await s.call([s.event("name", source)]); await s.call([s.event("name", source)]);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE", "🚧");
  expect(s.row("name")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "quality_rejected", deliveryStatus: "sent",
    telemetry: {reason: "exact_occurrence_changed", failureStage: "validation"}});
  expect(JSON.stringify(s.row("name"))).not.toContain("山要求");
});

it("records input/raw output separately from accepted translation and LINE reply", async () => {
  const s = setup(); await s.call([s.event("raw")]); const completion = s.complete.mock.calls[0]![1];
  expect(completion.nmtInputContents).toEqual(s.send.mock.calls[0]![0].contents);
  expect(completion.nmtOutputContents).toEqual({translations: ["Loading is scheduled for 1 p.m. next Wednesday."]});
  expect(completion.translatedText).toBe("Loading is scheduled for 1 p.m. next Wednesday."); expect(completion.replyText).toBe(completion.translatedText);
});
it("retains rejected raw output and attempted input on timeout without promoting them to translatedText", async () => {
  const s = setup(); s.send.mockResolvedValue([{translations: [{translatedText: "Missing required code"}]}]);
  await s.call([s.event("rejected", "請確認 PP-BK。")]); const rejected = s.complete.mock.calls[0]![1];
  expect(rejected.nmtOutputContents).toEqual({translations: ["Missing required code"]}); expect(rejected.translatedText).toBeNull(); expect(rejected.replyText).toBe("🚧");
  s.send.mockRejectedValue(Error("timeout")); await s.call([s.event("timeout")]); const timeout = s.complete.mock.calls[1]![1];
  expect(timeout.nmtInputContents).toEqual(["下週三下午一點裝櫃。"]); expect(timeout.nmtOutputContents).toBeUndefined();
});
it("keeps captured output even when the following provider completion write fails", async () => {
  const s = setup(); s.store.fail = "finish"; await s.call([s.event("finish")]); const completion = s.complete.mock.calls[0]![1];
  expect(completion.nmtOutputContents).toEqual({translations: ["Loading is scheduled for 1 p.m. next Wednesday."]}); expect(completion.translatedText).toBeNull(); expect(completion.replyText).toBe("🚧");
});
it("captures available audio transcript translation without another recognition call", async () => {
  const s = setup(); const event = {...s.event("audio"), message: {type: "audio", id: "audio", duration: 1000, contentProvider: {type: "line"}}};
  await s.call([event]); const completion = s.complete.mock.calls[0]![1]; expect(completion.sourceText).toBe("下週三下午一點裝櫃。"); expect(completion.nmtInputContents).toEqual([completion.sourceText]); expect(completion.nmtOutputContents).toBeTruthy(); expect(s.deps.transcriber.transcribe).toHaveBeenCalledTimes(1);
});
it("gates the raw observer on recording, and never invents NMT content for local replies", async () => {
  const s = setup(); const factory = vi.spyOn(s.deps, "createEventTranslationProgram"); vi.mocked(s.deps.qualityStore!.getRecordingEnabled).mockResolvedValue(false);
  await s.call([s.event("off")]); expect(factory.mock.calls[0]![1]).toBeUndefined(); expect(s.complete).not.toHaveBeenCalled();
  vi.mocked(s.deps.qualityStore!.getRecordingEnabled).mockResolvedValue(true); await s.call([s.event("skip", "OK")]); const completion = s.complete.mock.calls[0]![1]; expect(completion.nmtInputContents).toBeUndefined(); expect(completion.nmtOutputContents).toBeUndefined();
});
it("isolates captures across concurrent events and preserves completion on duplicate delivery", async () => {
  const s = setup(); s.send.mockImplementation(async request => [{translations: [{translatedText: request.contents[0]!.includes("甲") ? "First shipment." : "Second shipment."}]}]);
  await Promise.all([s.call([s.event("first", "甲批貨物。")]), s.call([s.event("second", "乙批貨物。")])]); await s.call([s.event("first", "changed")]);
  const rows = new Map(s.complete.mock.calls.map(([original, completion]) => [original.webhookEventId, completion])); expect(rows.get("first")!.nmtInputContents).toEqual(["甲批貨物。"]); expect(rows.get("first")!.nmtOutputContents).toEqual({translations: ["First shipment."]}); expect(rows.get("second")!.nmtOutputContents).toEqual({translations: ["Second shipment."]}); expect(s.send).toHaveBeenCalledTimes(2);
});

it("captures every Chinese/Vietnamese paragraph in both directions without joining boundaries", async () => {
  const s = setup(); vi.mocked(s.deps.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: "zh-vi"});
  s.send.mockImplementation(async request => [{translations: request.contents.map(text => ({translatedText: text.replace("請確認", "Vui lòng xác nhận").replace("明天裝櫃", "Đóng hàng ngày mai").replace("Xin xác nhận", "請確認").replace("Giao hàng ngày mai", "明天交貨")}))}]);
  await s.call([s.event("to-vi", "請確認 PP-BK。\r\n明天裝櫃。"), s.event("to-zh", "Xin xác nhận PP-BK.\nGiao hàng ngày mai.")]);
  for (const [index, [, completion]] of s.complete.mock.calls.entries()) {
    expect(completion.outcome).toBe("translated"); expect(completion.nmtInputContents).toEqual(s.send.mock.calls[index]![0].contents); expect(completion.nmtInputContents).toHaveLength(2); expect(completion.nmtOutputContents!.translations).toHaveLength(2); expect(completion.nmtInputContents![0]).toContain('translate="no"');
  }
});
it("raw capture does not block replies when quality storage fails and does not leak into logs", async () => {
  const s = setup(); s.complete.mockRejectedValue(Error("private store failure")); const result = await s.call([s.event("store-fail")]);
  expect(result.body.processed).toBe(1); expect(s.deps.replier.replyText).toHaveBeenCalledTimes(1); expect(s.complete.mock.calls[0]![1].nmtOutputContents).toBeTruthy(); expect(JSON.stringify(vi.mocked(s.deps.logger.error).mock.calls)).not.toContain("Loading is scheduled");
});
it("preserves input and output when LINE rejects the accepted translation", async () => {
  const s = setup(); vi.mocked(s.deps.replier.replyText).mockRejectedValue(Error("private LINE failure")); await s.call([s.event("line-fail")]);
  const completion = s.complete.mock.calls[0]![1]; expect(completion.nmtInputContents).toBeTruthy(); expect(completion.nmtOutputContents).toBeTruthy(); expect(completion.translatedText).toBe("Loading is scheduled for 1 p.m. next Wednesday."); expect(completion.deliveryStatus).toBe("failed");
});

it("preserves raw NMT copies while recording and delivering the repaired configured-name text once", async () => {
  const s = setup(), source = "Shan requested bags. Please confirm the labels.";
  const raw = '<div id="p0">Shan要求大袋<span translate="no" class="notranslate" id="l0">Shan</span>請確認標籤。</div>';
  const translatedText = "Shan要求大袋請確認標籤。";
  s.send.mockResolvedValue([{translations: [{translatedText: raw}]}]);
  await s.call([s.event("name-copy", source)]); await s.call([s.event("name-copy", source)]);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE", translatedText);
  expect(s.complete.mock.calls[0]![1]).toMatchObject({nmtInputContents: s.send.mock.calls[0]![0].contents,
    nmtOutputContents: {translations: [raw]}, translatedText, replyText: translatedText, outcome: "translated"});
  expect(s.row("name-copy")).toMatchObject({providerStatus: "provider_succeeded", translationStatus: "validated", deliveryStatus: "sent"});
});

it("records raw blank variation while delivering the plain source layout once", async () => {
  const s = setup(), source = "Overview\n\nPlease confirm the labels.\nPlease load the crate.";
  const raw = "概述\n\n請確認標籤。\n\n請裝載箱子。", translatedText = "概述\n\n請確認標籤。\n請裝載箱子。";
  s.send.mockResolvedValue([{translations: [{translatedText: raw}]}]);
  await s.call([s.event("plain-blanks", source)]); await s.call([s.event("plain-blanks", source)]);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.send.mock.calls[0]![0]).toMatchObject({mimeType: "text/plain", contents: [source]});
  expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE", translatedText);
  expect(s.complete.mock.calls[0]![1]).toMatchObject({nmtInputContents: [source], nmtOutputContents: {translations: [raw]}, translatedText, replyText: translatedText, outcome: "translated"});
  expect(s.row("plain-blanks")).toMatchObject({translationStatus: "validated", telemetry: {adapterVersion: "nmt-direct-v1.4", semanticEvaluation: "not_evaluated"}});
});
it("retains rejected raw output when a plain content line is missing", async () => {
  const s = setup(), source = "Please confirm the labels.\nPlease load the crate.", raw = "請確認標籤。";
  s.send.mockResolvedValue([{translations: [{translatedText: raw}]}]); await s.call([s.event("plain-missing", source)]);
  expect(s.deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("PRIVATE", "🚧");
  expect(s.complete.mock.calls[0]![1]).toMatchObject({nmtOutputContents: {translations: [raw]}, translatedText: null, replyText: "🚧", reason: "paragraph_structure_changed"});
});
