import {expect, it, vi} from "vitest";
import {NmtDirectTranslator} from "./nmt-direct-translator.js";
import {AuthenticatedNmtTransport, ControlledNmtClient} from "./nmt-controlled-client.js";
import {NMT_TEST_PROJECT, NMT_TEST_ACCOUNT, NMT_TEST_BILLING, NMT_RUNTIME_ACCOUNT} from "./nmt-isolation.js";
import {initialOperation, DevEventSession, type DevEventOperationStore} from "./dev-event-operation.js";
import {processLineWebhook} from "./webhook.js";
import {createHmac} from "node:crypto";
import {LineMessagingApiReplier, GoogleCloudSpeechTranscriber} from "./services.js";
const identity = {projectId: NMT_TEST_PROJECT, principal: NMT_TEST_ACCOUNT, billingAccount: "billingAccounts/" + NMT_TEST_BILLING,
  billingEnabled: true, runtimeAccount: NMT_RUNTIME_ACCOUNT};
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
it.each([0, 120])("never starts NMT after the absolute deadline even when credentials arrive after %sms", async delay => {
  vi.useFakeTimers();
  const send = vi.fn(async () => Response.json({translations: [{translatedText: "Please confirm."}]}));
  vi.stubGlobal("fetch", send);
  try {
    const start = Date.now(), transport = new AuthenticatedNmtTransport({getAccessToken: async () => {await pause(delay); return "synthetic";},
      getCredentials: async () => ({}), getProjectId: async () => NMT_TEST_PROJECT});
    const client = new ControlledNmtClient(transport, {reserve: async () => {}}, "verification", async () => identity, false, undefined, "nmt-direct-v1");
    const translator = new NmtDirectTranslator({projectId: NMT_TEST_PROJECT, profile: "nmt-direct-v1"}, client);
    const operation = translator.translate("請確認。", "zh-TW", "en", {deadlineAtMs: start + 10060}).catch(error => error);
    await vi.advanceTimersByTimeAsync(200);
    const result = await operation;
    if (delay === 0) {expect(result).toBe("Please confirm."); expect(send).toHaveBeenCalledOnce();}
    else {expect(result).toBeInstanceOf(Error); expect(send).not.toHaveBeenCalled();}
  } finally {vi.useRealTimers(); vi.unstubAllGlobals();}
});
it("does not continue background identity calls after credentials outlive the deadline", async () => {
  vi.useFakeTimers(); const send = vi.fn(); vi.stubGlobal("fetch", send);
  try {
    const transport = new AuthenticatedNmtTransport({getAccessToken: async () => {await pause(120); return "synthetic";},
      getCredentials: async () => ({}), getProjectId: async () => NMT_TEST_PROJECT});
    const operation = transport.identity(Date.now() + 60).catch(error => error);
    await vi.advanceTimersByTimeAsync(200); expect(await operation).toBeInstanceOf(Error); expect(send).not.toHaveBeenCalled();
  } finally {vi.useRealTimers(); vi.unstubAllGlobals();}
});
it("refuses an expired webhook before beginning the persistent claim", async () => {
  const event = {type: "message", webhookEventId: "expired", replyToken: "synthetic",
    source: {type: "group", groupId: "C" + "1".repeat(32)}, message: {type: "text", id: "1", text: "請確認。"}};
  const rawBody = Buffer.from(JSON.stringify({events: [event]})), claim = vi.fn();
  const result = await processLineWebhook({method: "POST", rawBody, signature: createHmac("sha256", "synthetic").update(rawBody).digest("base64")},
    {receivedAtMs: Date.now() - 51000, solReviewEnabled: true, channelSecret: "synthetic",
      eventOperationStore: {claim}, logger: {info() {}, warn() {}, error() {}}} as never);
  expect(result.body.failed).toBe(1); expect(claim).not.toHaveBeenCalled();
});
it("bounds a pending claim and blocks later provider or LINE actions when its outcome is unknown", async () => {
  vi.useFakeTimers();
  try {
    const event = {type: "message", webhookEventId: "claim", replyToken: "synthetic",
      source: {type: "group", groupId: "C" + "1".repeat(32)}, message: {type: "text", id: "1", text: "請確認。"}};
    const rawBody = Buffer.from(JSON.stringify({events: [event]})), claim = vi.fn(async () => new Promise<never>(() => {})), reply = vi.fn();
    const operation = processLineWebhook({method: "POST", rawBody, signature: createHmac("sha256", "synthetic").update(rawBody).digest("base64")},
      {receivedAtMs: Date.now(), solReviewEnabled: true, channelSecret: "synthetic", eventOperationStore: {claim},
        replier: {replyText: reply}, logger: {info() {}, warn() {}, error() {}}} as never);
    await vi.advanceTimersByTimeAsync(2100);
    expect((await operation).body.failed).toBe(1); expect(claim).toHaveBeenCalledOnce(); expect(reply).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
it("bounds pre-reply fence persistence without erasing an unknown durable start or invoking LINE", async () => {
  vi.useFakeTimers();
  try {
    const record = initialOperation({webhookEventId: "fence"}), update = vi.fn(async () => new Promise<never>(() => {})), reply = vi.fn();
    const store: DevEventOperationStore = {claim: vi.fn(), reserveProvider: vi.fn(), update};
    const session = new DevEventSession(store, record, record); session.setDeadline(Date.now() + 60);
    const operation = session.deliver(reply).catch(error => error);
    await vi.advanceTimersByTimeAsync(100); expect(await operation).toBeInstanceOf(Error);
    expect(update).toHaveBeenCalledOnce(); expect(reply).not.toHaveBeenCalled();
    await expect(session.complete()).rejects.toThrow(); expect(update).toHaveBeenCalledOnce();
  } finally {vi.useRealTimers();}
});
it("checks the LINE deadline again after member lookup before calling the reply API", async () => {
  vi.useFakeTimers();
  try {
    const reply = vi.fn(), line = new LineMessagingApiReplier("synthetic", {replyMessage: reply},
      {isMember: async () => {await pause(120); return true;}});
    const operation = line.replyText("synthetic", "@Alex Please confirm.",
      {groupId: "C" + "1".repeat(32), mentions: [{start: 0, length: 5, userId: "U" + "1".repeat(32)}]},
      Date.now() + 60).catch(error => error);
    await vi.advanceTimersByTimeAsync(200); expect(await operation).toBeInstanceOf(Error); expect(reply).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
it("checks the speech deadline before starting recognition", async () => {
  const recognize = vi.fn(), speech = new GoogleCloudSpeechTranscriber("synthetic", {recognize});
  await expect(speech.transcribe(Buffer.from("synthetic"), ["en-US"], Date.now() - 1)).rejects.toThrow();
  expect(recognize).not.toHaveBeenCalled();
});

import {DeadlineScope, assertDeadlineActive, deadlineFirestore, withinTime} from "./translation-deadline.js";
import {LineMessagingApiContentLoader} from "./services.js";
const pending = () => new Promise<never>(() => {});
function deadlineFixture() {
  const event = (id: string, text = "請確認。") => ({type: "message", webhookEventId: id, replyToken: "synthetic",
    source: {type: "group", groupId: "C" + "1".repeat(32), userId: "owner"}, message: {type: "text", id, text}});
  const events = [event("first"), event("second")];
  const replies = vi.fn(async () => {}), calls = vi.fn(async () => "Please confirm.");
  const dependencies = {receivedAtMs: Date.now(), solReviewEnabled: true, channelSecret: "synthetic", ownerUserId: "owner",
    settingsStore: {getSettings: vi.fn(async () => ({translationMode: "zh-en", textTranslationEnabled: true, audioTranscriptionEnabled: true})),
      setModeAndEnabled: vi.fn(async () => {}), setTextTranslationEnabled: vi.fn(async () => {}), setAudioTranscriptionEnabled: vi.fn(async () => {})},
    translator: {translate: calls}, replier: {replyText: replies}, failureStore: {save: vi.fn(async () => {})}, logger: {info() {}, warn() {}, error() {}}};
  const run = () => {
    const rawBody = Buffer.from(JSON.stringify({events}));
    return processLineWebhook({method: "POST", rawBody, signature: createHmac("sha256", "synthetic").update(rawBody).digest("base64")}, dependencies as never);
  };
  return {dependencies, events, event, replies, calls, run};
}
it("revokes admission after timeout and prevents a late transaction read from staging writes", async () => {
  vi.useFakeTimers();
  try {
    let writes = 0, attempts: unknown;
    const firestore = deadlineFirestore({runTransaction: async (callback: (tx: object) => Promise<void>, options: unknown) => {
      attempts = options; await callback({get: async () => {await pause(120); return {};}, set: () => {writes++;}});
    }});
    const result = withinTime(() => firestore.runTransaction(async (transaction: object) => {
      const tx = transaction as {get(): Promise<object>; set(ref: object, value: object): void};
      await tx.get(); tx.set({}, {value: true});
    }, {}), 60).catch(error => error);
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toBeInstanceOf(Error); expect(writes).toBe(0); expect(attempts).toEqual({maxAttempts: 1});
  } finally {vi.useRealTimers();}
});
it("snapshots pending Firestore writes before mutable telemetry changes", async () => {
  let captured: unknown;
  const firestore = deadlineFirestore({set: async (value: object) => {await pause(1); captured = value;}});
  const source = {nested: {status: "started"}}, write = firestore.set(source); source.nested.status = "not_started";
  await write; expect(captured).toEqual({nested: {status: "started"}});
});
it("does not invoke an expired callback or resume a revoked continuation", async () => {
  vi.useFakeTimers();
  try {
    const callback = vi.fn(); await expect(new DeadlineScope(Date.now() - 1).run(callback)).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled();
    const continuation = vi.fn(), result = withinTime(async () => {await pause(120); assertDeadlineActive(); continuation();}, 60).catch(error => error);
    await vi.advanceTimersByTimeAsync(200); expect(await result).toBeInstanceOf(Error); expect(continuation).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
it.each([false, true])("failure saving cannot extend the batch deadline (pending=%s)", async slow => {
  vi.useFakeTimers();
  try {
    const fixture = deadlineFixture(); fixture.dependencies.receivedAtMs -= 49940;
    if (slow) fixture.dependencies.failureStore.save = vi.fn(pending);
    const operation = fixture.run();
    await vi.advanceTimersByTimeAsync(80); const result = await operation;
    expect(fixture.replies).toHaveBeenCalledTimes(slow ? 1 : 2); expect(fixture.calls).not.toHaveBeenCalled();
    expect(result.body.failed).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(3000); expect(fixture.replies).toHaveBeenCalledTimes(slow ? 1 : 2);
  } finally {vi.useRealTimers();}
});
it.each(["getConfig", "getRecordingEnabled", "saveOriginal", "complete"])("quality %s cannot extend 50s", async method => {
  vi.useFakeTimers();
  try {
    const fixture = deadlineFixture(); fixture.dependencies.receivedAtMs -= 49940;
    const quality = {getConfig: vi.fn(async () => ({enabled: true, groups: [], startedAt: new Date()})),
      getRecordingEnabled: vi.fn(async () => true), saveOriginal: vi.fn(async () => {}), complete: vi.fn(async () => {})};
    Object.assign(quality, {[method]: vi.fn(pending)}); Object.assign(fixture.dependencies, {qualityStore: quality});
    const operation = fixture.run(); await vi.advanceTimersByTimeAsync(80); await operation;
    expect(fixture.calls).not.toHaveBeenCalled();
    const sends = fixture.replies.mock.calls.length; await vi.advanceTimersByTimeAsync(3000); expect(fixture.replies.mock.calls.length).toBe(sends);
  } finally {vi.useRealTimers();}
});
it.each(["/中英翻譯", "/啟用文字翻譯", "/啟用語音轉文字"])("bounds authorized settings mutation %s without claiming success", async command => {
  vi.useFakeTimers();
  try {
    const fixture = deadlineFixture(); fixture.events.splice(0, 2, fixture.event("command", command));
    fixture.dependencies.settingsStore.setModeAndEnabled = vi.fn(pending);
    fixture.dependencies.settingsStore.setTextTranslationEnabled = vi.fn(pending);
    fixture.dependencies.settingsStore.setAudioTranscriptionEnabled = vi.fn(pending);
    const operation = fixture.run(); await vi.advanceTimersByTimeAsync(2100);
    expect((await operation).body.failed).toBe(1); expect(fixture.replies).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
it("bounds LINE waiting without a persistent session and never retries an unknown result", async () => {
  vi.useFakeTimers();
  try {
    const fixture = deadlineFixture(); fixture.dependencies.receivedAtMs -= 49940;
    fixture.events.splice(0, 2, {...fixture.event("id", "/我的ID"), source: {type: "user", userId: "owner"} as never}); fixture.dependencies.replier.replyText = vi.fn(pending);
    const operation = fixture.run(); await vi.advanceTimersByTimeAsync(80); await operation;
    expect(fixture.dependencies.replier.replyText).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000); expect(fixture.dependencies.replier.replyText).toHaveBeenCalledOnce();
  } finally {vi.useRealTimers();}
});
it("destroys a stream acquired after its admission scope expired", async () => {
  vi.useFakeTimers();
  try {
    const destroy = vi.fn(), stream = {destroy, async *[Symbol.asyncIterator]() {yield Buffer.from("audio");}};
    const loader = new LineMessagingApiContentLoader("synthetic", {getMessageContent: async () => {await pause(120); return stream;}});
    const operation = loader.getMessageContent("id", 100, Date.now() + 60).catch(error => error);
    await vi.advanceTimersByTimeAsync(200); expect(await operation).toBeInstanceOf(Error); expect(destroy).toHaveBeenCalledOnce();
  } finally {vi.useRealTimers();}
});

import {GoogleAuth} from "google-auth-library";
it("does not start scoped speech HTTP after delayed credentials expire", async () => {
  vi.useFakeTimers(); const send = vi.fn(); vi.stubGlobal("fetch", send);
  const token = vi.spyOn(GoogleAuth.prototype, "getAccessToken").mockImplementation(async () => {await pause(120); return "synthetic";});
  try {
    const speech = new GoogleCloudSpeechTranscriber("synthetic");
    const operation = withinTime(() => speech.transcribe(Buffer.from("audio"), ["en-US"], Date.now() + 60), 60).catch(error => error);
    await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(200);
    expect(await operation).toBeInstanceOf(Error); expect(send).not.toHaveBeenCalled();
  } finally {token.mockRestore(); vi.useRealTimers(); vi.unstubAllGlobals();}
});
it.each([400, 503, "unknown"])("scoped LINE downgrades only definite mention rejection (%s)", async status => {
  const send = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => {
    if (send.mock.calls.length === 1) {
      if (status === "unknown") throw new Error("unknown");
      return new Response("{}", {status: status as number});
    }
    return new Response("{}", {status: 200});
  });
  vi.stubGlobal("fetch", send);
  try {
    const line = new LineMessagingApiReplier("synthetic", undefined, {isMember: async () => true});
    const operation = withinTime(() => line.replyText("synthetic", "@Alex Please confirm.",
      {groupId: "C" + "1".repeat(32), mentions: [{start: 0, length: 5, userId: "U" + "1".repeat(32)}]}, Date.now() + 1000), 1000);
    if (status === 400) await operation; else await expect(operation).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(status === 400 ? 2 : 1);
    expect(send.mock.calls[0]?.[0]).toBe("https://api.line.me/v2/bot/message/reply");
  } finally {vi.unstubAllGlobals();}
});
it("refuses both English and Vietnamese engine admission after the shared processing deadline", async () => {
  const fixture = deadlineFixture(); fixture.dependencies.receivedAtMs -= 41000;
  let settingsCalls = 0;
  fixture.dependencies.settingsStore.getSettings = vi.fn(async () => ({
    translationMode: ++settingsCalls === 1 ? "zh-en" : "zh-vi", textTranslationEnabled: true, audioTranscriptionEnabled: false,
  }));
  const result = await fixture.run();
  expect(fixture.calls).not.toHaveBeenCalled(); expect(result.body.processed).toBe(0); expect(result.body.failed).toBe(2);
  expect(fixture.replies).toHaveBeenCalledTimes(2);
});

it("keeps an accepted LINE event successful when quality completion reaches D50", async () => {
  vi.useFakeTimers();
  try {
    const fixture = deadlineFixture(); fixture.dependencies.receivedAtMs -= 39940;
    fixture.events.splice(1);
    fixture.dependencies.settingsStore.getSettings = vi.fn(async () => ({
      translationMode: "zh-vi", textTranslationEnabled: true, audioTranscriptionEnabled: false,
    }));
    fixture.replies.mockImplementation(async () => {await pause(10000);});
    Object.assign(fixture.dependencies, {qualityStore: {
      getConfig: async () => ({enabled: true, groups: [], startedAt: new Date()}),
      getRecordingEnabled: async () => true, saveOriginal: async () => {}, complete: pending,
    }});
    const operation = fixture.run(); await vi.advanceTimersByTimeAsync(10080);
    const result = await operation; expect(result.body.processed).toBe(1); expect(result.body.failed).toBe(0);
    expect(fixture.replies).toHaveBeenCalledOnce();
  } finally {vi.useRealTimers();}
});

import {withinNmtRequest, currentDeadline} from "./translation-deadline.js";
import {ProductionNmtClient} from "./production-nmt-client.js";
import {PRODUCTION_PROJECT, PRODUCTION_RUNTIME_ACCOUNT} from "./production-target.js";
import {VietnameseNmtTranslator} from "./vietnamese-nmt-translator.js";
type NmtDeadlineTest = {credentialsMs?: number; pendingCredentials?: boolean; providerMs?: number; reserveAckMs?: number};
function scopedNmtFixture(kind: "dev" | "prd", mode: "direct" | "vi", config: NmtDeadlineTest = {}) {
  const project = kind === "prd" ? PRODUCTION_PROJECT : NMT_TEST_PROJECT;
  const runtime = kind === "prd" ? PRODUCTION_RUNTIME_ACCOUNT : NMT_RUNTIME_ACCOUNT;
  const event = {type: "message", webhookEventId: "nmt-scope-" + kind + mode, replyToken: "synthetic",
    source: {type: "group", groupId: "C" + "1".repeat(32), userId: "synthetic"},
    message: {type: "text", id: "scope", text: "請確認。"}};
  const record = initialOperation(event);
  let durableStatus = "not_started", reservedCharacters = 0, claimed = false;
  const updates = vi.fn(async () => {}), reserve = vi.fn(async (_owner: unknown, _category: string, characters: number) => {
    durableStatus = "provider_started"; reservedCharacters = characters;
    await pause(config.reserveAckMs ?? 0);
  });
  let session: DevEventSession;
  const store: DevEventOperationStore = {claim: async () => {
    if (claimed) return null; claimed = true; return session;
  }, reserveProvider: reserve, update: updates};
  session = new DevEventSession(store, record, record); session.setDeadline(Date.now() + 50000);
  const credentials = vi.fn(async () => {
    if (config.pendingCredentials) return pending();
    await pause(config.credentialsMs ?? 0); return "synthetic";
  });
  const input = vi.fn(), output = vi.fn();
  const send = vi.fn(async () => ({ok: true, json: async () => {
    await pause(config.providerMs ?? 0);
    return {translations: [{translatedText: mode === "vi" ? "Vui lòng xác nhận." : "Please confirm."}]};
  }}));
  vi.stubGlobal("fetch", send);
  const profile = mode === "vi" ? "legacy-glossary" : "nmt-direct-v1";
  const client = kind === "prd" ? new ProductionNmtClient(session, profile, {onInput: input, onOutput: output}, {
    getProjectId: async () => project, getCredentials: async () => ({client_email: runtime}), getAccessToken: credentials,
  }) : new ControlledNmtClient(new AuthenticatedNmtTransport({
    getAccessToken: async () => "synthetic", getProjectId: async () => project, getCredentials: async () => ({}),
  }, {onInput: input, onOutput: output}), {reserve: async () => {}}, "verification",
  async () => {await credentials(); return identity;}, false, session, profile);
  const translator = mode === "vi" ? new VietnameseNmtTranslator(project, client) :
    new NmtDirectTranslator({projectId: project, profile: "nmt-direct-v1"}, client);
  const run = () => new DeadlineScope(Date.now() + 50000).run(() =>
    translator.translate(event.message.text, "zh-TW", mode === "vi" ? "vi" : "en", {deadlineAtMs: Date.now() + 50000}));
  return {event, translator, session, store, run, credentials, send, reserve, updates, input, output,
    durable: () => ({status: durableStatus, reservedCharacters})};
}
const scopedNmtPaths = [
  ["dev", "direct"], ["dev", "vi"], ["prd", "direct"], ["prd", "vi"],
] as const;
it.each(scopedNmtPaths)("keeps fast %s/%s NMT healthy under the shared lifecycle", async (kind, mode) => {
  vi.useFakeTimers();
  try {
    const f = scopedNmtFixture(kind, mode), operation = f.run();
    await vi.advanceTimersByTimeAsync(10);
    expect(await operation).toBe(mode === "vi" ? "Vui lòng xác nhận." : "Please confirm.");
    expect(f.reserve).toHaveBeenCalledOnce(); expect(f.send).toHaveBeenCalledOnce(); expect(f.output).toHaveBeenCalledOnce();
  } finally {vi.useRealTimers(); vi.unstubAllGlobals();}
});
it.each(scopedNmtPaths)("revokes %s/%s credentials at 15 seconds before any reservation or HTTP", async (kind, mode) => {
  vi.useFakeTimers();
  try {
    const f = scopedNmtFixture(kind, mode, {credentialsMs: 16000}), operation = f.run().catch(error => error);
    await vi.advanceTimersByTimeAsync(15001); expect(await operation).toBeInstanceOf(Error);
    expect(f.reserve).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.reserve).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.updates).not.toHaveBeenCalled();
  } finally {vi.useRealTimers(); vi.unstubAllGlobals();}
});
it.each(["dev", "prd"] as const)("bounds permanently pending %s credentials before 15 seconds", async kind => {
  vi.useFakeTimers();
  try {
    const f = scopedNmtFixture(kind, "vi", {pendingCredentials: true}), operation = f.run().catch(error => error);
    await vi.advanceTimersByTimeAsync(15001); expect(await operation).toBeInstanceOf(Error);
    expect(f.reserve).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  } finally {vi.useRealTimers(); vi.unstubAllGlobals();}
});
it.each(["dev", "prd"] as const)("does not give %s HTTP a fresh 15 seconds after identity", async kind => {
  vi.useFakeTimers();
  try {
    const f = scopedNmtFixture(kind, "vi", {credentialsMs: 10000, providerMs: 8000}), operation = f.run().catch(error => error);
    await vi.advanceTimersByTimeAsync(15001); expect(await operation).toBeInstanceOf(Error);
    expect(f.reserve).toHaveBeenCalledOnce(); expect(f.send).toHaveBeenCalledOnce();
    expect(f.durable().status).toBe("provider_started");
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.output).not.toHaveBeenCalled(); expect(f.updates).not.toHaveBeenCalled();
    expect(f.session.providerStatus).toBe("provider_started");
  } finally {vi.useRealTimers(); vi.unstubAllGlobals();}
});
it.each(["dev", "prd"] as const)("retains %s committed reservation when its acknowledgement arrives after the child deadline", async kind => {
  vi.useFakeTimers();
  try {
    const f = scopedNmtFixture(kind, "vi", {credentialsMs: 14000, reserveAckMs: 2000}), operation = f.run().catch(error => error);
    await vi.advanceTimersByTimeAsync(15001); expect(await operation).toBeInstanceOf(Error);
    expect(f.durable().status).toBe("provider_started"); expect(f.durable().reservedCharacters).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.reserve).toHaveBeenCalledOnce(); expect(f.send).not.toHaveBeenCalled(); expect(f.updates).not.toHaveBeenCalled();
    expect(f.durable().status).toBe("provider_started");
  } finally {vi.useRealTimers(); vi.unstubAllGlobals();}
});
it.each([
  [undefined, 50000, 15000], [6000, undefined, 6000],
  [7000, 5000, 5000], [3000, 8000, 3000],
] as const)("uses the shortest parent %s / explicit %s request deadline", async (parent, explicit, expected) => {
  const startedAt = Date.now();
  const run = () => withinNmtRequest(explicit === undefined ? undefined : startedAt + explicit, async end => {
    expect(end).toBe(startedAt + expected); expect(currentDeadline()).toBe(end);
  });
  vi.spyOn(Date, "now").mockReturnValue(startedAt);
  try {if (parent === undefined) await run(); else await new DeadlineScope(startedAt + parent).run(run);}
  finally {vi.restoreAllMocks();}
});
it("does not enter expired NMT and keeps the unscoped compatibility path", async () => {
  const callback = vi.fn(async () => "unused");
  await expect(withinNmtRequest(Date.now() - 1, callback)).rejects.toThrow(); expect(callback).not.toHaveBeenCalled();
  expect(await withinNmtRequest(undefined, async end => {expect(end).toBeUndefined(); expect(currentDeadline()).toBeUndefined(); return "healthy";})).toBe("healthy");
});
it("revokes a late NMT continuation with a real timer", async () => {
  const late = vi.fn(), operation = withinNmtRequest(Date.now() + 25, async () => {
    await pause(50); assertDeadlineActive(); late();
  }).catch(error => error);
  expect(await operation).toBeInstanceOf(Error); await pause(60); expect(late).not.toHaveBeenCalled();
});
it.each(["direct", "vi"] as const)("public PRD webhook rejects delayed %s credentials once and can still reply under D50", async mode => {
  vi.useFakeTimers();
  try {
    const f = scopedNmtFixture("prd", mode, {credentialsMs: 16000}), replies = vi.fn(async (_token: string, _text: string) => {});
    const rawBody = Buffer.from(JSON.stringify({events: [f.event]}));
    const request = {method: "POST", rawBody, signature: createHmac("sha256", "synthetic").update(rawBody).digest("base64")};
    const deps = {receivedAtMs: Date.now(), solReviewEnabled: true, channelSecret: "synthetic", eventOperationStore: f.store,
      createEventTranslationProgram: () => () => ({translator: f.translator, mentionAliases: []}),
      settingsStore: {getSettings: async () => ({translationMode: mode === "vi" ? "zh-vi" : "zh-en", textTranslationEnabled: true, audioTranscriptionEnabled: false})},
      replier: {replyText: replies}, failureStore: {save: async () => {}}, logger: {info() {}, warn() {}, error() {}}};
    const operation = processLineWebhook(request, deps as never);
    await vi.advanceTimersByTimeAsync(17000); expect((await operation).body.failed).toBe(1);
    expect(f.reserve).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(replies).toHaveBeenCalledOnce(); expect(replies.mock.calls[0]?.[1]).toBe("🚧");
    await processLineWebhook(request, deps as never);
    expect(replies).toHaveBeenCalledOnce(); expect(f.send).not.toHaveBeenCalled();
  } finally {vi.useRealTimers(); vi.unstubAllGlobals();}
});
