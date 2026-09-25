import {createHmac} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import {processLineWebhook, type WebhookDependencies} from "./webhook.js";
import {captureQualityOriginal, qualityOperation} from "./translation-quality.js";
import {type QualityCompletion, type QualityConfig, type QualityOriginal, type TranslationQualityStore} from "./translation-quality-store.js";
import {TranslationQualityError} from "./trade-policy.js";

const groups = [1, 2, 3, 4].map(n => ({id: "C" + String(n).repeat(32), name: `群組${n}`}));
const config: QualityConfig = {enabled: true, groups, startedAt: new Date("2026-09-25T00:00:00Z")};
const event = (text = "請確認報價", id = "event1") => ({type: "message", webhookEventId: id, timestamp: 1790300000000, replyToken: "secret-token", source: {type: "group", groupId: groups[0]!.id, userId: "raw-sender"}, message: {id: `message-${id}`, type: "text", text}});
function setup() {
  const originals: QualityOriginal[] = []; const completions: QualityCompletion[] = [];
  const store: TranslationQualityStore = {getConfig: vi.fn(async () => config), saveOriginal: vi.fn(async record => {originals.push(structuredClone(record));}), complete: vi.fn(async (_, completion) => {completions.push(structuredClone(completion));}), search: vi.fn(), transitionReport: vi.fn(async () => null)};
  const dependencies: WebhookDependencies = {channelSecret: "secret", ownerUserId: "owner", qualityStore: store,
    qualityMetadata: () => ({engine: "nmt-glossary", glossary: "glossary-v1", revision: "revision1"}),
    translator: {translate: vi.fn(async () => "Please confirm the price.")}, transcriber: {transcribe: vi.fn(async () => ({text: "請確認報價"}))},
    audioContentLoader: {getMessageContent: vi.fn(async () => Buffer.from("audio"))}, replier: {replyText: vi.fn(async () => {})},
    settingsStore: {getSettings: vi.fn(async () => ({textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: "zh-en" as const})), setModeAndEnabled: vi.fn(), setAudioTranscriptionEnabled: vi.fn(), setTextTranslationEnabled: vi.fn()},
    failureStore: {save: vi.fn(async () => {})}, logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn()}};
  const call = (events: unknown[]) => {const rawBody = Buffer.from(JSON.stringify({events})); return processLineWebhook({method: "POST", rawBody, signature: createHmac("sha256", "secret").update(rawBody).digest("base64")}, dependencies);};
  return {dependencies, store, originals, completions, call};
}
describe("quality capture integration", () => {
  it("saves original before translation, accepted output and actual reply separately", async () => {
    const test = setup(); vi.mocked(test.dependencies.translator!.translate).mockImplementation(async () => {expect(test.originals).toHaveLength(1); return "Please confirm the price.";});
    expect((await test.call([event()])).body.processed).toBe(1);
    expect(test.originals[0]).toMatchObject({senderUserId: "raw-sender", messageId: "message-event1", sourceText: "請確認報價", eventTime: new Date(1790300000000)});
    expect(test.completions[0]).toMatchObject({translatedText: "Please confirm the price.", replyText: "Please confirm the price.", outcome: "translated", deliveryStatus: "sent", sourceLanguageCode: "zh-TW", targetLanguageCode: "en", engine: "nmt-glossary", revision: "revision1"});
    expect(JSON.stringify(test.originals)).not.toContain("secret-token");
  });
  it("retains accepted unchanged output before the symbol replacement", async () => {
    const test = setup(); vi.mocked(test.dependencies.translator!.translate).mockResolvedValue("PP-BK ?"); await test.call([event("PP-BK?")]);
    expect(test.completions[0]).toMatchObject({translatedText: "PP-BK ?", replyText: "👆", outcome: "translated"});
  });
  it.each(["OK", "123", "/翻譯設定", "/我的ID", "/啟用翻譯"])("captures skipped and management text %s", async text => {
    const test = setup(); await test.call([event(text)]); expect(test.originals[0]?.sourceText).toBe(text); expect(test.completions).toHaveLength(1); expect(test.dependencies.translator!.translate).not.toHaveBeenCalled();
  });
  it("captures disabled and nontext metadata without loading attachments", async () => {
    const test = setup(); vi.mocked(test.dependencies.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled: false, audioTranscriptionEnabled: false, translationMode: "zh-en"});
    const image = {...event(), webhookEventId: "image", message: {type: "image", id: "image-id", contentProvider: {originalContentUrl: "private-url"}, text: "not-text"}};
    await test.call([event(), image]); expect(test.completions.map(item => item.outcome)).toEqual(["skipped", "ignored"]);
    expect(test.originals[1]).toMatchObject({messageType: "image", sourceText: null}); expect(JSON.stringify(test.originals)).not.toContain("private-url");
    expect(test.dependencies.audioContentLoader.getMessageContent).not.toHaveBeenCalled();
  });
  it("captures transcript and accepted audio translation but no audio bytes", async () => {
    const test = setup(); const audio = {...event(), message: {type: "audio", id: "audio-id", contentProvider: {type: "line"}}}; await test.call([audio]);
    expect(test.originals[0]?.sourceText).toBeNull(); expect(test.completions[0]).toMatchObject({sourceText: "請確認報價", translatedText: "Please confirm the price.", replyText: "請確認報價\n\nPlease confirm the price."});
  });
  it("keeps rejection safe and preserves the existing failure store", async () => {
    const test = setup(); vi.mocked(test.dependencies.translator!.translate).mockRejectedValue(new TranslationQualityError("private-rejected-output")); await test.call([event()]);
    expect(test.completions[0]).toMatchObject({translatedText: null, replyText: "🚧", outcome: "failed", reason: "quality_rejected"}); expect(test.dependencies.failureStore.save).toHaveBeenCalledOnce();
    expect(JSON.stringify(test.completions)).not.toContain("private-rejected-output");
  });
  it("does not save an output rejected by LINE format validation", async () => {
    const test = setup(); vi.mocked(test.dependencies.translator!.translate).mockResolvedValue("x".repeat(24001)); await test.call([event()]);
    expect(test.completions[0]).toMatchObject({translatedText: null, reason: "reply_format_rejected"});
  });
  it("delivery failure retains accepted translation and records failed delivery", async () => {
    const test = setup(); vi.mocked(test.dependencies.replier.replyText).mockRejectedValue(new Error("secret-response")); expect((await test.call([event()])).body.failed).toBe(1);
    expect(test.completions[0]).toMatchObject({outcome: "translated", deliveryStatus: "failed", translatedText: "Please confirm the price.", reason: "line_reply_error"}); expect(test.dependencies.failureStore.save).not.toHaveBeenCalled();
  });
  it("initial write failure still translates and retries recording via completion", async () => {
    const test = setup(); vi.mocked(test.store.saveOriginal).mockRejectedValue(new Error("private-db-error")); await test.call([event()]);
    expect(test.completions).toHaveLength(1); expect(test.dependencies.replier.replyText).toHaveBeenCalledOnce();
    expect(test.dependencies.logger.error).toHaveBeenCalledWith(expect.any(String), {reason: "quality_store_error", webhookEventId: "event1"});
    expect(JSON.stringify(vi.mocked(test.dependencies.logger.error).mock.calls)).not.toContain("private-db-error");
  });
  it("config errors and completion errors do not change translation behavior", async () => {
    const test = setup(); vi.mocked(test.store.getConfig).mockRejectedValueOnce(new Error("secret")); await test.call([event()]); expect(test.originals).toHaveLength(0); expect(test.dependencies.translator!.translate).toHaveBeenCalledOnce();
    vi.mocked(test.store.complete).mockRejectedValueOnce(new Error("secret")); expect((await test.call([event()])).body.processed).toBe(1);
  });
  it("excludes nonallowlisted groups, rooms and unauthorized/private content", async () => {
    const test = setup(); const outside = {...event(), source: {type: "group", groupId: "T1"}}; const room = {...event(), source: {type: "room", roomId: "room"}}; const privateEvent = {...event("/翻譯錯誤"), source: {type: "user", userId: "other"}};
    await test.call([outside, room, privateEvent]); expect(test.originals).toHaveLength(0); expect(test.store.transitionReport).not.toHaveBeenCalled();
  });
  it("preserves owner ID command and handles unavailable report without translation", async () => {
    const test = setup(); vi.mocked(test.store.getConfig).mockResolvedValue(null);
    await test.call([{...event("/我的ID"), source: {type: "user", userId: "owner"}}, {...event("/翻譯錯誤"), source: {type: "user", userId: "owner"}}]);
    expect(test.dependencies.replier.replyText).toHaveBeenCalledWith("secret-token", "你的 LINE userId：\nowner"); expect(test.dependencies.replier.replyText).toHaveBeenCalledWith("secret-token", expect.stringContaining("目前無法使用")); expect(test.dependencies.translator!.translate).not.toHaveBeenCalled();
  });
  it("bounds unavailable database latency", async () => {
    vi.useFakeTimers(); try {const test = setup(); const pending = qualityOperation(() => new Promise(() => {}), test.dependencies, "e"); await vi.advanceTimersByTimeAsync(1500); expect(await pending).toBeUndefined();} finally {vi.useRealTimers();}
  });
  it("requires stable IDs and ignores arbitrary event properties", () => {
    const raw = event(); delete (raw as {webhookEventId?: string}).webhookEventId; delete (raw.message as {id?: string}).id;
    expect(captureQualityOriginal(raw, config)).toBeNull(); expect(captureQualityOriginal(null, config)).toBeNull();
  });
});

it("keeps skipped outcome separate from failed delivery", async () => {
  const test = setup(); vi.mocked(test.dependencies.replier.replyText).mockRejectedValue(new Error("delivery")); await test.call([event("OK")]);
  expect(test.completions[0]).toMatchObject({outcome: "skipped", deliveryStatus: "failed", reason: "line_reply_error"});
});
it("owner report replies use the workflow without calling translation", async () => {
  const test = setup(); vi.mocked(test.store.transitionReport).mockResolvedValue("翻譯錯誤回報選單");
  await test.call([{...event("/翻譯錯誤"), source: {type: "user", userId: "owner"}}]);
  expect(test.store.transitionReport).toHaveBeenCalledWith("owner", "event1", expect.any(Function)); expect(test.dependencies.replier.replyText).toHaveBeenCalledWith("secret-token", "翻譯錯誤回報選單"); expect(test.dependencies.translator!.translate).not.toHaveBeenCalled();
});
it("records quoted message ID without quote token and logs absent stable IDs safely", async () => {
  const test = setup(); const quoted = {...event(), message: {...event().message, quotedMessageId: "quoted-id", quoteToken: "private-quote-token"}};
  await test.call([quoted]); expect(test.originals[0]!.quotedMessageId).toBe("quoted-id"); expect(JSON.stringify(test.originals)).not.toContain("private-quote-token");
  await test.call([{...event(), webhookEventId: undefined, message: {type: "text", text: "private-source"}}]);
  expect(test.dependencies.logger.error).toHaveBeenCalledWith(expect.any(String), {reason: "quality_event_id_missing", groupKey: expect.stringMatching(/^[a-f0-9]{64}$/u)});
  expect(JSON.stringify(vi.mocked(test.dependencies.logger.error).mock.calls)).not.toContain("private-source");
});
it.each(["reject", "timeout"])("ordinary owner DM with unknown/no active session stays ignored on report-store %s", async failure => {
  const test = setup();
  if (failure === "timeout") vi.useFakeTimers();
  try {
    vi.mocked(test.store.transitionReport).mockImplementation(async () => {
      if (failure === "reject") throw new Error("private DB error");
      return new Promise<string | null>(() => {});
    });
    const pending = test.call([{...event("hello"), source: {type: "user", userId: "owner"}}]);
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(1500);
    expect((await pending).body).toMatchObject({processed: 0, ignored: 1, failed: 0});
    expect(test.dependencies.replier.replyText).not.toHaveBeenCalled(); expect(test.dependencies.translator!.translate).not.toHaveBeenCalled();
    expect(test.dependencies.logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({reason: "quality_store_error"}));
  } finally {if (failure === "timeout") vi.useRealTimers();}
});
it.each(["reject", "timeout"])("positively known active draft reports report-store %s safely", async failure => {
  const test = setup(); if (failure === "timeout") vi.useFakeTimers();
  try {
    vi.mocked(test.store.transitionReport).mockImplementation(async (_owner, _id, transition) => {
      await transition({id: "draft", stage: "manualIssue", expiresAt: Date.now() + 1800000, draft: {kind: "manual", sourceText: "原文"}});
      if (failure === "reject") throw new Error("private DB error");
      return new Promise<string | null>(() => {});
    });
    const pending = test.call([{...event("責任翻錯"), source: {type: "user", userId: "owner"}}]);
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(1500);
    expect((await pending).body.processed).toBe(1); expect(test.dependencies.replier.replyText).toHaveBeenCalledWith("secret-token", expect.stringContaining("無法確認回報操作結果"));
    expect(test.dependencies.translator!.translate).not.toHaveBeenCalled();
  } finally {if (failure === "timeout") vi.useRealTimers();}
});
it.each(["/翻譯錯誤", "/返回", "/取消", "確認", "下一頁", "下一段"])("explicit report control %s gets safe unavailable notice on store failure", async text => {
  const test = setup(); vi.mocked(test.store.transitionReport).mockRejectedValue(new Error("private DB error"));
  await test.call([{...event(text), source: {type: "user", userId: "owner"}}]); expect(test.dependencies.replier.replyText).toHaveBeenCalledWith("secret-token", expect.stringContaining("無法確認回報操作結果"));
});
it("a proven absent session followed by commit failure still leaves ordinary owner DM ignored", async () => {
  const test = setup(); vi.mocked(test.store.transitionReport).mockImplementation(async (_owner, _id, transition) => {await transition(null); throw new Error("commit error");});
  expect((await test.call([{...event("hello"), source: {type: "user", userId: "owner"}}])).body.ignored).toBe(1); expect(test.dependencies.replier.replyText).not.toHaveBeenCalled();
});
it.each(["disabled", "external"])("audio missing a transcript has explicit %s reason without content access", async kind => {
  const test = setup();
  if (kind === "disabled") vi.mocked(test.dependencies.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled: true, audioTranscriptionEnabled: false, translationMode: "zh-en"});
  const audio = {...event(), message: {id: "audio", type: "audio", contentProvider: {type: kind === "external" ? "external" : "line", originalContentUrl: "private-url"}}};
  await test.call([audio]); expect(test.completions[0]).toMatchObject({reason: kind === "disabled" ? "audio_disabled" : "unsupported_audio_provider", outcome: kind === "disabled" ? "skipped" : "ignored"});
  expect(test.originals[0]!.sourceText).toBeNull(); expect(test.completions[0]!.sourceText).toBeUndefined(); expect(test.dependencies.audioContentLoader.getMessageContent).not.toHaveBeenCalled(); expect(test.dependencies.transcriber.transcribe).not.toHaveBeenCalled(); expect(test.dependencies.translator!.translate).not.toHaveBeenCalled();
});
it("audio transcription failures keep the existing explicit failure reason", async () => {
  const test = setup(); vi.mocked(test.dependencies.transcriber.transcribe).mockRejectedValue(new Error("private transcription failure"));
  await test.call([{...event(), message: {id: "audio", type: "audio", contentProvider: {type: "line"}}}]);
  expect(test.completions[0]).toMatchObject({outcome: "failed", reason: "transcription_error", replyText: "🚧"}); expect(test.dependencies.failureStore.save).toHaveBeenCalledWith(expect.objectContaining({reason: "transcription_error", sourceText: null}));
});
it("explicit report start gets a safe notice when the store times out before session state is known", async () => {
  vi.useFakeTimers(); try {
    const test = setup(); vi.mocked(test.store.transitionReport).mockImplementation(async () => new Promise<string | null>(() => {}));
    const pending = test.call([{...event("/翻譯錯誤"), source: {type: "user", userId: "owner"}}]); await vi.advanceTimersByTimeAsync(1500);
    expect((await pending).body.processed).toBe(1); expect(test.dependencies.replier.replyText).toHaveBeenCalledWith("secret-token", expect.stringContaining("無法確認回報操作結果"));
  } finally {vi.useRealTimers();}
});