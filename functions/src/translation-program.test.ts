import {createHmac} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import {createTranslationProgramRouter} from "./translation-program.js";
import {FirestoreConversationSettingsStore} from "./services.js";
import {processLineWebhook, type WebhookDependencies} from "./webhook.js";
import type {TranslationMode} from "./domain.js";

function setup(initial: Record<string, unknown> = {}, englishBroken = false) {
  const values = new Map<string, Record<string, unknown>>([["group", initial]]);
  const writes = vi.fn();
  const collection = vi.fn(() => ({doc: (id: string) => ({
    get: async () => ({get: (field: string) => values.get(id)?.[field]}),
    set: async (data: Record<string, unknown>) => {
      writes(id, data);
      values.set(id, {...values.get(id), ...data});
    },
  })}));
  const settingsStore = new FirestoreConversationSettingsStore({collection});
  const english = {translate: vi.fn().mockResolvedValue("English output"),
    translateWithRanges: vi.fn().mockResolvedValue({text: "English output", ranges: []})};
  const vietnamese = {translate: vi.fn().mockResolvedValue("Vietnamese output"),
    translateWithRanges: vi.fn().mockResolvedValue({text: "Vietnamese output", ranges: []})};
  const createEnglish = vi.fn(() => {
    if (englishBroken) throw new Error("Invalid English configuration.");
    return {translator: english, mentionAliases: [{alias: "Alex brother", userId: "U" + "1".repeat(32)}]};
  });
  const createVietnamese = vi.fn(() => vietnamese);
  const router = createTranslationProgramRouter(createEnglish, createVietnamese);
  const dependencies: WebhookDependencies = {
    failureStore: {save: vi.fn().mockResolvedValue(undefined)},
    settingsStore, channelSecret: "test", ownerUserId: "owner", getTranslationProgram: router,
    transcriber: {transcribe: vi.fn().mockResolvedValue({text: "你好"})},
    audioContentLoader: {getMessageContent: vi.fn().mockResolvedValue(Buffer.from("audio"))},
    replier: {replyText: vi.fn().mockResolvedValue(undefined)},
    logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn()},
  };
  function event(text: string, groupId = "group") {
    return {type: "message", replyToken: "reply-" + groupId,
      source: {type: "group", groupId, userId: "owner"}, message: {type: "text", text}};
  }
  async function send(events: unknown[]) {
    const rawBody = Buffer.from(JSON.stringify({events}));
    return processLineWebhook({method: "POST", rawBody,
      signature: createHmac("sha256", "test").update(rawBody).digest("base64")}, dependencies);
  }
  return {values, writes, collection, settingsStore, english, vietnamese, createEnglish,
    createVietnamese, router, dependencies, event, send};
}
describe("single webhook translation routing", () => {
  it("defaults off without initializing either translation branch", async () => {
    const t = setup();
    expect(await t.settingsStore.getSettings("group")).toEqual({
      translationMode: "zh-en", textTranslationEnabled: false, audioTranscriptionEnabled: false});
    await t.send([t.event("你好"), t.event("/翻譯設定")]);
    expect(t.collection).toHaveBeenCalledWith("lineTranslationGroups");
    expect(t.createEnglish).not.toHaveBeenCalled();
    expect(t.createVietnamese).not.toHaveBeenCalled();
    expect(t.writes).not.toHaveBeenCalled();
    expect(t.dependencies.replier.replyText).toHaveBeenCalledWith("reply-group",
      expect.stringContaining("/中越翻譯"));
  });
  it.each([
    ["zh-en", "你好", "zh-TW", "en"], ["zh-to-en", "你好", "zh-TW", "en"],
    ["en-to-zh", "Hello", "en", "zh-TW"], ["zh-vi", "你好", "zh-TW", "vi"],
    ["zh-vi", "Xin chào", "vi", "zh-TW"],
  ] as const)("routes stored %s mode lazily", async (mode, text, source, target) => {
    const t = setup({translationMode: mode, enabled: true});
    expect((await t.send([t.event(text)])).body.processed).toBe(1);
    const active = mode === "zh-vi" ? t.vietnamese : t.english;
    expect(active.translate).toHaveBeenCalledWith(text, source, target);
    expect(mode === "zh-vi" ? t.createEnglish : t.createVietnamese).not.toHaveBeenCalled();
    expect(t.writes).not.toHaveBeenCalled();
  });
  it("switches the same chat across languages without resetting audio or another chat", async () => {
    const t = setup({translationMode: "zh-en", textTranslationEnabled: false, audioTranscriptionEnabled: true});
    t.values.set("other", {translationMode: "en-to-zh", enabled: true});
    await t.send([t.event("/中越翻譯"), t.event("你好"), t.event("/中英翻譯"), t.event("你好")]);
    expect(t.vietnamese.translate).toHaveBeenCalledWith("你好", "zh-TW", "vi");
    expect(t.english.translate).toHaveBeenCalledWith("你好", "zh-TW", "en");
    expect((await t.settingsStore.getSettings("group")).audioTranscriptionEnabled).toBe(true);
    expect(t.values.get("other")).toEqual({translationMode: "en-to-zh", enabled: true});
    expect(t.writes.mock.calls.every(([, data]) => !Object.hasOwn(data, "audioTranscriptionEnabled"))).toBe(true);
  });
  it("uses each conversation mode within the same webhook batch", async () => {
    const t = setup({translationMode: "zh-en", enabled: true});
    t.values.set("other", {translationMode: "zh-vi", enabled: true});
    await t.send([t.event("你好"), t.event("你好", "other")]);
    expect(t.english.translate).toHaveBeenCalledOnce();
    expect(t.vietnamese.translate).toHaveBeenCalledOnce();
  });
  it("isolates failed English initialization from Vietnamese and settings", async () => {
    const t = setup({translationMode: "zh-en", enabled: true}, true);
    t.values.set("other", {translationMode: "zh-vi", enabled: true});
    const result = await t.send([t.event("你好"), t.event("你好", "other"), t.event("/翻譯設定")]);
    expect(result.body).toMatchObject({processed: 2, failed: 1});
    expect(t.vietnamese.translate).toHaveBeenCalledOnce();
    expect(t.dependencies.replier.replyText).toHaveBeenCalledTimes(3);
    expect(t.dependencies.replier.replyText).toHaveBeenNthCalledWith(1, expect.any(String), "🚧");
    expect(t.dependencies.failureStore.save).toHaveBeenCalledWith(expect.objectContaining({stage: "translation_setup"}));
  });
  it("does not initialize on ignored acknowledgements, one-way text or invalid signatures", async () => {
    const t = setup({translationMode: "zh-to-en", enabled: true});
    await t.send([t.event("OK"), t.event("Hello"), t.event("123")]);
    await processLineWebhook({method: "POST", rawBody: Buffer.from("{}"), signature: "bad"}, t.dependencies);
    expect(t.createEnglish).not.toHaveBeenCalled();
    expect(t.createVietnamese).not.toHaveBeenCalled();
  });
  it("retains group permissions and ignores private mode changes", async () => {
    const t = setup();
    const group = t.event("/中越翻譯");
    group.source.userId = "stranger";
    await t.send([group, {type: "message", replyToken: "private", source: {type: "user", userId: "stranger"},
      message: {type: "text", text: "/中越翻譯"}}]);
    expect(t.values.get("group")).toEqual({});
    expect(t.values.has("user:stranger")).toBe(false);
    expect(t.writes).not.toHaveBeenCalled();
    expect(t.dependencies.replier.replyText).toHaveBeenCalledOnce();
  });
  it("never initializes translators or accesses stored private settings except to reply with ID", async () => {
    const t = setup({}, true);
    const saved = {translationMode: "zh-vi", textTranslationEnabled: true, audioTranscriptionEnabled: true};
    t.values.set("user:owner", saved);
    const event = {type: "message", replyToken: "private", source: {type: "user", userId: "owner"}};
    const result = await t.send([
      ...["你好", "/中越翻譯", "/翻譯設定"].map(text => ({...event, message: {type: "text", text}})),
      {...event, message: {type: "audio", id: "private-audio", duration: 1000, contentProvider: {type: "line"}}},
      {...event, message: {type: "text", text: "/我的ID"}},
    ]);
    expect(result.body).toMatchObject({processed: 1, ignored: 4, failed: 0});
    expect(t.collection).not.toHaveBeenCalled();
    expect(t.writes).not.toHaveBeenCalled();
    expect(t.values.get("user:owner")).toEqual(saved);
    expect(t.createEnglish).not.toHaveBeenCalled();
    expect(t.createVietnamese).not.toHaveBeenCalled();
    expect(t.dependencies.audioContentLoader.getMessageContent).not.toHaveBeenCalled();
    expect(t.dependencies.replier.replyText).toHaveBeenCalledExactlyOnceWith("private", "你的 LINE userId：\nowner");
  });
  it("routes audio translation while keeping speech-only independent of English failures", async () => {
    const t = setup({translationMode: "zh-vi", textTranslationEnabled: true, audioTranscriptionEnabled: true}, true);
    const audio = {type: "message", replyToken: "audio", source: {type: "group", groupId: "group"},
      message: {type: "audio", id: "audio", duration: 1000, contentProvider: {type: "line"}}};
    await t.send([audio]);
    expect(t.dependencies.transcriber.transcribe).toHaveBeenCalledWith(Buffer.from("audio"), ["cmn-Hant-TW", "vi-VN"]);
    expect(t.vietnamese.translate).toHaveBeenCalledWith("你好", "zh-TW", "vi");
    t.values.set("group", {translationMode: "zh-en", textTranslationEnabled: false, audioTranscriptionEnabled: true});
    await t.send([audio]);
    expect(t.createEnglish).not.toHaveBeenCalled();
  });
  it("keeps English aliases out of Vietnamese but preserves native mention metadata", async () => {
    const t = setup({translationMode: "zh-vi", enabled: true});
    await t.send([t.event("Alex brother 請確認")]);
    expect(t.vietnamese.translateWithRanges).not.toHaveBeenCalled();
    const message = t.event("@Alex 請確認");
    Object.assign(message.message, {mention: {mentionees: [{index: 0, length: 5, type: "user", userId: "U" + "2".repeat(32)}]}});
    t.vietnamese.translateWithRanges.mockResolvedValueOnce({
      text: "@Alex Xin xác nhận", ranges: [{sourceStart: 0, start: 0, length: 5}]});
    await t.send([message]);
    expect(t.vietnamese.translateWithRanges).toHaveBeenCalledWith("@Alex 請確認", "zh-TW", "vi",
      {protectedRanges: [{start: 0, length: 5}]});
    expect(t.dependencies.replier.replyText).toHaveBeenLastCalledWith("reply-group", "@Alex Xin xác nhận",
      expect.objectContaining({groupId: "group"}));
  });
  it("caches successful branches across modes", () => {
    const t = setup();
    for (const mode of ["zh-en", "zh-to-en", "en-to-zh", "zh-en", "zh-vi", "zh-vi"] as TranslationMode[]) t.router(mode);
    expect(t.createEnglish).toHaveBeenCalledOnce();
    expect(t.createVietnamese).toHaveBeenCalledOnce();
  });
});

