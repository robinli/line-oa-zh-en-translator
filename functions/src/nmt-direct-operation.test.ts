import {createHmac} from "node:crypto";
import {expect, it, vi} from "vitest";
import {DevEventSession, initialOperation, operationData, operationIdentity, type DevEventOperation, type DevEventOperationStore, type OperationOwner, type OperationTelemetry} from "./dev-event-operation.js";
import {assertOperationOwner, completionTelemetry} from "./dev-event-operation-store.js";
import {ControlledNmtClient, type NmtResponse, type NmtCallOptions} from "./nmt-controlled-client.js";
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
    createEventTranslationProgram: session => () => ({mentionAliases: [], translator: new NmtDirectTranslator({projectId, profile: "nmt-direct-v1",
      onMetric: metric => {
        Object.assign(session.telemetry, {engine: metric.engine, adapterVersion: metric.adapterVersion, protectionVersion: metric.protectionVersion,
          requestProfile: metric.profile, validationScope: metric.validationScope, semanticEvaluation: metric.semanticEvaluation, protectedCounts: metric.protectedCounts});
        if (metric.apiCalled === false) {session.telemetry.apiCalled = false; session.telemetry.outputCharacters = metric.outputCharacters;}
        if (metric.reason) {session.telemetry.reason = metric.reason; session.telemetry.failureStage = "validation";}
      }}, new ControlledNmtClient({translateText: send}, {reserve: async () => {throw Error("must use operation atomic reservation");}}, "manual", async () => ({projectId, principal: NMT_TEST_ACCOUNT, runtimeAccount: NMT_RUNTIME_ACCOUNT,
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
    telemetry: {adapterVersion: "nmt-direct-v1.1", protectedCounts: {"configured-name": 1}, semanticEvaluation: "not_evaluated"}});
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
