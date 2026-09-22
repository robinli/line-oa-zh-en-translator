import {createHmac} from "node:crypto";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {
  AudioContentLoader,
  AudioTranscriber,
  ConversationSettingsStore,
  LineReplier,
  Translator,
} from "./services.js";
import {TranslationQualityError} from "./trade-policy.js";
import {TranslationServiceError} from "./business-translator.js";
import {processLineWebhook, type WebhookLogger} from "./webhook.js";

const channelSecret = "test-channel-secret";
const ownerUserId = "owner-user-id";

describe("processLineWebhook", () => {
  let translator: Translator;
  let transcriber: AudioTranscriber;
  let audioContentLoader: AudioContentLoader;
  let replier: LineReplier;
  let settingsStore: ConversationSettingsStore;
  let logger: WebhookLogger;

  beforeEach(() => {
    translator = {translate: vi.fn().mockResolvedValue("translated")};
    transcriber = {
      transcribe: vi.fn().mockResolvedValue({
        text: "明天下午三點開會",
        languageCode: "cmn-Hant-TW",
      }),
    };
    audioContentLoader = {
      getMessageContent: vi.fn().mockResolvedValue(Buffer.from("audio")),
    };
    replier = {replyText: vi.fn().mockResolvedValue(undefined)};
    settingsStore = {
      getSettings: vi.fn().mockResolvedValue({
        textTranslationEnabled: true,
        audioTranscriptionEnabled: true,
        translationMode: "zh-en",
      }),
      setAudioTranscriptionEnabled: vi.fn().mockResolvedValue(undefined),
      setTextTranslationEnabled: vi.fn().mockResolvedValue(undefined),
      setModeAndEnabled: vi.fn().mockResolvedValue(undefined),
    };
    logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()};
  });


  it.each([
    ["zh-to-en", "你好", "zh-TW", "en"],
    ["zh-to-en", "Meeting 明天下午三點", "zh-TW", "en"],
    ["en-to-zh", "Hello", "en", "zh-TW"],
    ["zh-en", "Meeting 明天下午三點", "zh-TW", "en"],
    ["zh-vi", "Meeting 明天下午三點", "zh-TW", "vi"],
  ] as const)("routes %s text %s", async (mode, text, source, target) => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true, audioTranscriptionEnabled: false, translationMode: mode,
    });
    await callWebhook({events: [groupTextEvent(text)]});
    expect(translator.translate).toHaveBeenCalledWith(text, source, target);
    expect(replier.replyText).toHaveBeenCalledWith("reply-token", "translated");
  });

  it.each([
    ["zh-to-en", "* Four countries just saved you three sourcing trips.* The China, Germany, Japan, Taiwan Pavilions are coming to electronica India & productronica India 2026. Get a ₹500 Uber coupon: https://u.uber.com/RVSZSPVCKKV"],
    ["en-to-zh", "你好"],
    ["en-to-zh", "Meeting 明天下午三點"],
    ["zh-to-en", "123 😀"],
    ["en-to-zh", "123 😀"],
  ] as const)("silently ignores %s text %s", async (mode, text) => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: mode,
    });
    const result = await callWebhook({events: [groupTextEvent(text)]});
    expect(translator.translate).not.toHaveBeenCalled();
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 1, failed: 0});
  });

  it.each([
    ["zh-to-en", "Hello", true],
    ["en-to-zh", "你好", true],
    ["en-to-zh", "Hello 你好", true],
    ["zh-en", "123 😀", true],
    ["zh-to-en", "你好", false],
    ["zh-en", "Hello", false],
  ] as const)("returns only transcript in %s for %s when translation is %s", async (mode, text, enabled) => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: enabled, audioTranscriptionEnabled: true, translationMode: mode,
    });
    vi.mocked(transcriber.transcribe).mockResolvedValue({text, languageCode: "en-US"});
    const result = await callWebhook({events: [groupAudioEvent()]});
    expect(translator.translate).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith("audio-reply-token", text);
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it.each([
    ["zh-to-en", "你好", "zh-TW", "en"],
    ["en-to-zh", "Hello", "en", "zh-TW"],
    ["zh-to-en", "你好 Hello", "zh-TW", "en"],
    ["zh-en", "Hello", "en", "zh-TW"],
    ["zh-vi", "Xin chào", "vi", "zh-TW"],
  ] as const)("applies text rules to the %s transcript %s", async (mode, text, source, target) => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: mode,
    });
    vi.mocked(transcriber.transcribe).mockResolvedValue({text, languageCode: "en-US"});
    await callWebhook({events: [groupAudioEvent()]});
    expect(translator.translate).toHaveBeenCalledWith(text, source, target);
    expect(replier.replyText).toHaveBeenCalledWith("audio-reply-token", text + "\n\ntranslated");
  });

  it.each([
    [false, false, 0, 0, 0],
    [true, false, 1, 0, 1],
    [false, true, 0, 1, 1],
    [true, true, 2, 1, 2],
  ] as const)("keeps text=%s and audio=%s independent", async (text, audio, translations, downloads, replies) => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: text, audioTranscriptionEnabled: audio, translationMode: "zh-to-en",
    });
    await callWebhook({events: [groupTextEvent("你好"), groupAudioEvent()]});
    expect(translator.translate).toHaveBeenCalledTimes(translations);
    expect(audioContentLoader.getMessageContent).toHaveBeenCalledTimes(downloads);
    expect(transcriber.transcribe).toHaveBeenCalledTimes(downloads);
    expect(replier.replyText).toHaveBeenCalledTimes(replies);
  });

  it.each([
    ["/啟用語音轉文字", true], ["/停用語音轉文字", false],
  ] as const)("handles independent audio command %s", async (command, enabled) => {
    await callWebhook({events: [groupTextEvent(command)]});
    expect(settingsStore.setAudioTranscriptionEnabled).toHaveBeenCalledWith("group-id", enabled, ownerUserId);
    expect(settingsStore.setTextTranslationEnabled).not.toHaveBeenCalled();
    expect(settingsStore.setModeAndEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ["/啟用文字翻譯", true], ["/停用文字翻譯", false],
    ["/啟用翻譯", true], ["/停用翻譯", false],
  ] as const)("handles text command and legacy alias %s", async (command, enabled) => {
    await callWebhook({events: [groupTextEvent(command)]});
    expect(settingsStore.setTextTranslationEnabled).toHaveBeenCalledWith("group-id", enabled, ownerUserId);
    expect(settingsStore.setAudioTranscriptionEnabled).not.toHaveBeenCalled();
  });

  it.each(["zh-to-en", "en-to-zh"] as const)("restores %s without changing audio", async (mode) => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: false, audioTranscriptionEnabled: false, translationMode: mode,
    });
    await callWebhook({events: [groupTextEvent("/啟用翻譯")]});
    expect(settingsStore.setTextTranslationEnabled).toHaveBeenCalledWith("group-id", true, ownerUserId);
    expect(settingsStore.setAudioTranscriptionEnabled).not.toHaveBeenCalled();
    expect(settingsStore.setModeAndEnabled).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith("reply-token",
      expect.stringContaining(mode === "zh-to-en" ? "中翻英" : "英翻中"));
  });

  it("lists translation modes followed by independent switches", async () => {
    await callWebhook({events: [groupTextEvent("/翻譯設定")]});
    expect(replier.replyText).toHaveBeenCalledWith("reply-token",
      "翻譯模式：中英\n文字翻譯：已啟用\n語音轉文字：已啟用\n\n可用指令：\n/中翻英\n/英翻中\n/中英翻譯\n/中越翻譯\n/停用翻譯\n/啟用文字翻譯\n/停用文字翻譯\n/啟用語音轉文字\n/停用語音轉文字");
  });

  it("does not execute settings commands spoken in audio", async () => {
    vi.mocked(transcriber.transcribe).mockResolvedValue({text: "/停用文字翻譯"});
    await callWebhook({events: [groupAudioEvent()]});
    expect(settingsStore.setTextTranslationEnabled).not.toHaveBeenCalled();
    expect(settingsStore.setAudioTranscriptionEnabled).not.toHaveBeenCalled();
    expect(settingsStore.setModeAndEnabled).not.toHaveBeenCalled();
  });

  it("returns 200 for LINE webhook URL verification", async () => {
    const result = await callWebhook({destination: "destination", events: []});

    expect(result).toEqual({
      status: 200,
      body: {ok: true, processed: 0, ignored: 0, failed: 0},
    });
  });

  it("rejects non-POST requests without calling external APIs", async () => {
    const rawBody = Buffer.from('{"events":[]}');
    const result = await processLineWebhook(
      {method: "GET", rawBody},
      dependencies(),
    );

    expect(result).toEqual({
      status: 405,
      body: {ok: false, error: "Method not allowed"},
    });
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("translates Chinese group text to English in Chinese-English mode", async () => {
    await callWebhook({events: [groupTextEvent("明天下午三點開會")]});

    expect(settingsStore.getSettings).toHaveBeenCalledWith("group-id");
    expect(translator.translate).toHaveBeenCalledWith(
      "明天下午三點開會",
      "zh-TW",
      "en",
    );
    expect(replier.replyText).toHaveBeenCalledWith("reply-token", "translated");
  });

  it("translates English group text to Traditional Chinese", async () => {
    await callWebhook({events: [groupTextEvent("Meeting at three tomorrow.")]});

    expect(translator.translate).toHaveBeenCalledWith(
      "Meeting at three tomorrow.",
      "en",
      "zh-TW",
    );
  });

  it("translates Chinese text to Vietnamese in Chinese-Vietnamese mode", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true,
      audioTranscriptionEnabled: true,
      translationMode: "zh-vi",
    });

    await callWebhook({events: [groupTextEvent("你好")]});

    expect(translator.translate).toHaveBeenCalledWith("你好", "zh-TW", "vi");
  });

  it("translates Vietnamese text to Traditional Chinese", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true,
      audioTranscriptionEnabled: true,
      translationMode: "zh-vi",
    });

    await callWebhook({events: [groupTextEvent("Xin chào")]});

    expect(translator.translate).toHaveBeenCalledWith("Xin chào", "vi", "zh-TW");
  });

  it("ignores text without Chinese or Latin characters", async () => {
    const result = await callWebhook({events: [groupTextEvent("123 😀")]});

    expect(translator.translate).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 1, failed: 0});
  });

  it.each([
    ["zh-en", "260921 BGYD", "260921 BGYD", "en", "zh-TW"],
    ["en-to-zh", "260921 BGYD", "260921 BGYD", "en", "zh-TW"],
    ["zh-vi", "260921 BGYD", "260921 BGYD", "vi", "zh-TW"],
    ["zh-en", " \t260921  BGYD\r\n", "260921\nBGYD", "en", "zh-TW"],
    ["zh-to-en", "請檢查批號", "請檢查批號", "zh-TW", "en"],
  ] as const)("skips unchanged group translations in %s for %j", async (mode, text, translation, source, target) => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: mode,
    });
    vi.mocked(translator.translate).mockResolvedValue(translation);

    const result = await callWebhook({events: [groupTextEvent(text)]});

    expect(translator.translate).toHaveBeenCalledWith(text, source, target);
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 200, body: {ok: true, processed: 0, ignored: 1, failed: 0},
    });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "Skipped an unchanged translation for a LINE group text message.",
      {
        webhookEventId: "webhook-event-id",
        sourceLanguageCode: source,
        targetLanguageCode: target,
      },
    );
  });

  it.each([
    ["Wire", "金屬絲"],
    ["WIRE", "金屬絲"],
    ["請檢查 260921 BGYD", "Please check 260921 BGYD"],
    ["BGYD", "bgyd"],
    ["BGYD", "BGYD."],
  ])("still replies when translating %j changes the content", async (text, translation) => {
    vi.mocked(translator.translate).mockResolvedValue(translation);

    const result = await callWebhook({events: [groupTextEvent(text)]});

    expect(translator.translate).toHaveBeenCalledOnce();
    expect(replier.replyText).toHaveBeenCalledExactlyOnceWith("reply-token", translation);
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("preserves unchanged translation replies in one-to-one chats", async () => {
    vi.mocked(translator.translate).mockResolvedValue("260921 BGYD");

    const result = await callWebhook({events: [userTextEvent("260921 BGYD")]});

    expect(replier.replyText).toHaveBeenCalledExactlyOnceWith("user-reply-token", "260921 BGYD");
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("continues processing a batch after an unchanged group translation", async () => {
    vi.mocked(translator.translate)
      .mockResolvedValueOnce("260921 BGYD")
      .mockResolvedValueOnce("金屬絲");

    const result = await callWebhook({
      events: [groupTextEvent("260921 BGYD"), groupTextEvent("Wire")],
    });

    expect(translator.translate).toHaveBeenCalledTimes(2);
    expect(replier.replyText).toHaveBeenCalledExactlyOnceWith("reply-token", "金屬絲");
    expect(result.body).toMatchObject({processed: 1, ignored: 1, failed: 0});
  });

  it("preserves group audio transcription replies when the translation is unchanged", async () => {
    vi.mocked(transcriber.transcribe).mockResolvedValue({text: "260921 BGYD"});
    vi.mocked(translator.translate).mockResolvedValue("260921 BGYD");

    const result = await callWebhook({events: [groupAudioEvent()]});

    expect(replier.replyText).toHaveBeenCalledExactlyOnceWith(
      "audio-reply-token", "260921 BGYD\n\n260921 BGYD",
    );
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("transcribes Chinese group audio with the selected language pair", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true,
      audioTranscriptionEnabled: true,
      translationMode: "zh-vi",
    });

    await callWebhook({events: [groupAudioEvent()]});

    expect(audioContentLoader.getMessageContent).toHaveBeenCalledWith(
      "audio-message-id",
      10_000_000,
    );
    expect(transcriber.transcribe).toHaveBeenCalledWith(
      Buffer.from("audio"),
      ["cmn-Hant-TW", "vi-VN"],
    );
    expect(translator.translate).toHaveBeenCalledWith(
      "明天下午三點開會",
      "zh-TW",
      "vi",
    );
    expect(replier.replyText).toHaveBeenCalledWith(
      "audio-reply-token",
      "明天下午三點開會\n\ntranslated",
    );
  });

  it("translates Vietnamese audio transcripts to Traditional Chinese", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true,
      audioTranscriptionEnabled: true,
      translationMode: "zh-vi",
    });
    vi.mocked(transcriber.transcribe).mockResolvedValue({
      text: "Xin chào",
      languageCode: "vi-VN",
    });

    await callWebhook({events: [groupAudioEvent()]});

    expect(translator.translate).toHaveBeenCalledWith("Xin chào", "vi", "zh-TW");
  });

  it("supports text and audio in a one-to-one conversation", async () => {
    await callWebhook({
      events: [
        userTextEvent("你好"),
        userAudioEvent(),
      ],
    });

    expect(settingsStore.getSettings).toHaveBeenCalledWith("user:private-user-id");
    expect(audioContentLoader.getMessageContent).toHaveBeenCalledWith(
      "user-audio-message-id",
      10_000_000,
    );
    expect(translator.translate).toHaveBeenCalledTimes(2);
  });

  it("does not process text or audio while a conversation is disabled", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: false,
      audioTranscriptionEnabled: false,
      translationMode: "zh-en",
    });

    const result = await callWebhook({
      events: [groupTextEvent("你好"), groupAudioEvent()],
    });

    expect(translator.translate).not.toHaveBeenCalled();
    expect(audioContentLoader.getMessageContent).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 2, failed: 0});
  });

  it("rejects audio above the synchronous recognition duration limit", async () => {
    const result = await callWebhook({events: [groupAudioEvent(60_000)]});

    expect(audioContentLoader.getMessageContent).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith(
      "audio-reply-token",
      expect.stringContaining("59 秒"),
    );
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("returns the sender user ID for the private ID command", async () => {
    await callWebhook({events: [userTextEvent(" /我的ID ")]});

    expect(replier.replyText).toHaveBeenCalledWith(
      "user-reply-token",
      "你的 LINE userId：\nprivate-user-id",
    );
    expect(settingsStore.getSettings).not.toHaveBeenCalled();
  });

  it("does not expose a user ID or translate the ID command in groups", async () => {
    const result = await callWebhook({events: [groupTextEvent("/我的ID")]});

    expect(replier.replyText).not.toHaveBeenCalled();
    expect(translator.translate).not.toHaveBeenCalled();
    expect(settingsStore.getSettings).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 1, failed: 0});
  });

  it("shows setup instructions when joining a disabled group", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: false,
      audioTranscriptionEnabled: false,
      translationMode: "zh-en",
    });

    await callWebhook({events: [groupJoinEvent()]});

    expect(replier.replyText).toHaveBeenCalledWith(
      "join-reply-token",
      expect.stringContaining("/中越翻譯"),
    );
    expect(settingsStore.setTextTranslationEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ["/中翻英", "zh-to-en"],
    ["/英翻中", "en-to-zh"],
    ["/中英翻譯", "zh-en"],
    ["/中越翻譯", "zh-vi"],
  ] as const)("lets the configured owner select and enable %s", async (command, mode) => {
    await callWebhook({events: [groupTextEvent(command)]});

    expect(settingsStore.setModeAndEnabled).toHaveBeenCalledWith(
      "group-id",
      mode,
      ownerUserId,
    );
    expect(replier.replyText).toHaveBeenCalledWith(
      "reply-token",
      expect.stringContaining("已啟用"),
    );
  });

  it.each(["/中翻英", "/英翻中", "/中英翻譯", "/中越翻譯", "/停用翻譯", "/啟用翻譯", "/啟用文字翻譯", "/停用文字翻譯", "/啟用語音轉文字", "/停用語音轉文字"])("rejects unauthorized %s", async (command) => {
    const event = groupTextEvent(command);
    event.source.userId = "another-user-id";

    await callWebhook({events: [event]});

    expect(settingsStore.setModeAndEnabled).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith(
      "reply-token",
      expect.stringContaining("沒有權限"),
    );
  });

  it("lets a private user select their own mode", async () => {
    await callWebhook({events: [userTextEvent("/中越翻譯")]});

    expect(settingsStore.setModeAndEnabled).toHaveBeenCalledWith(
      "user:private-user-id",
      "zh-vi",
      "private-user-id",
    );
  });

  it("disables without clearing the selected mode", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true,
      audioTranscriptionEnabled: true,
      translationMode: "zh-vi",
    });

    await callWebhook({events: [groupTextEvent("/停用翻譯")]});

    expect(settingsStore.setTextTranslationEnabled).toHaveBeenCalledWith(
      "group-id",
      false,
      ownerUserId,
    );
    expect(settingsStore.setModeAndEnabled).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith(
      "reply-token",
      expect.stringContaining("已停用文字翻譯"),
    );
  });

  it("restores the previously selected mode", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: false,
      audioTranscriptionEnabled: false,
      translationMode: "zh-vi",
    });

    await callWebhook({events: [groupTextEvent("/啟用翻譯")]});

    expect(settingsStore.setTextTranslationEnabled).toHaveBeenCalledWith(
      "group-id",
      true,
      ownerUserId,
    );
    expect(replier.replyText).toHaveBeenCalledWith(
      "reply-token",
      expect.stringContaining("中越"),
    );
  });

  it("reports status and lists settings commands", async () => {
    vi.mocked(settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true,
      audioTranscriptionEnabled: true,
      translationMode: "zh-vi",
    });

    await callWebhook({
      events: [
        groupTextEvent("/翻譯狀態"),
        userTextEvent("/翻譯設定"),
      ],
    });

    expect(replier.replyText).toHaveBeenNthCalledWith(
      1,
      "reply-token",
      "翻譯模式：中越\n文字翻譯：已啟用\n語音轉文字：已啟用",
    );
    expect(replier.replyText).toHaveBeenNthCalledWith(
      2,
      "user-reply-token",
      expect.stringContaining("/中英翻譯"),
    );
  });

  it("ignores messages above the configured length limit", async () => {
    const result = await callWebhook({events: [groupTextEvent("中文太長")]}, 3);

    expect(translator.translate).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 1, failed: 0});
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("rejects invalid signatures and invalid JSON", async () => {
    const rawBody = Buffer.from('{"events":[]}');
    const invalidSignatureResult = await processLineWebhook(
      {method: "POST", rawBody, signature: "invalid"},
      dependencies(),
    );
    const invalidJson = Buffer.from("not-json");
    const invalidJsonResult = await processLineWebhook(
      {method: "POST", rawBody: invalidJson, signature: sign(invalidJson)},
      dependencies(),
    );

    expect(invalidSignatureResult.status).toBe(401);
    expect(invalidJsonResult.status).toBe(400);
  });

  it("logs API errors while returning 200 to prevent LINE redelivery", async () => {
    vi.mocked(translator.translate).mockRejectedValue(new Error("API unavailable"));

    const result = await callWebhook({events: [groupTextEvent("你好")]});

    expect(result).toEqual({
      status: 200,
      body: {ok: true, processed: 0, ignored: 0, failed: 1},
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to process a LINE chat message.",
      expect.objectContaining({error: "API unavailable"}),
    );
  });


  it("ignores a translation that changes only punctuation width", async () => {
    vi.mocked(translator.translate).mockResolvedValue("PP-BK？");
    const result = await callWebhook({events: [groupTextEvent("PP-BK?")]});
    expect(translator.translate).toHaveBeenCalledOnce();
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ignored: 1});
  });

  it.each(["PP-BK?", "PH-BK?", "WIRE?"])("does not reply when %s only gains punctuation whitespace", async (text) => {
    vi.mocked(translator.translate).mockResolvedValue(text.replace("?", " ?"));
    const result = await callWebhook({events: [groupTextEvent(text)]});
    expect(translator.translate).toHaveBeenCalledOnce();
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ignored: 1, failed: 0});
  });

  it.each(["zh-en", "en-to-zh", "zh-to-en"] as const)(
    "routes English body with a Chinese mention correctly in %s", async (mode) => {
      const mention = "@Niranjan Prakash @B5-海屏 Eric胡哲榮";
      const text = mention + "\nKumar said that he already gave $1295 to Xmold... Please be aware of it.";
      const event = groupTextEvent(text);
      Object.assign(event.message, {mention: {mentionees: [{index: 0, length: mention.length, type: "user"}]}});
      vi.mocked(settingsStore.getSettings).mockResolvedValue({
        textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: mode,
      });
      await callWebhook({events: [event]});
      if (mode === "zh-to-en") {
        expect(translator.translate).not.toHaveBeenCalled();
        expect(replier.replyText).not.toHaveBeenCalled();
      } else {
        expect(translator.translate).toHaveBeenCalledExactlyOnceWith(text, "en", "zh-TW",
          {protectedRanges: [{start: 0, length: mention.length}]});
      }
    },
  );

  it("still translates the Chinese freight reminder into English", async () => {
    const text = "提醒一下\n現在出印度運價已經漲到2000以上\n十月預計會更高～\n目前我還不清楚你們價格估算方式\n但請注意 運價一直調漲 務必估算進去";
    await callWebhook({events: [groupTextEvent(text)]});
    expect(translator.translate).toHaveBeenCalledExactlyOnceWith(text, "zh-TW", "en");
  });

  it("does not infer language from the name in a mention-only message", async () => {
    const event = groupTextEvent("@海屏 Eric");
    Object.assign(event.message, {mention: {mentionees: [{index: 0, length: event.message.text.length}]}});
    const result = await callWebhook({events: [event]});
    expect(translator.translate).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ignored: 1});
  });

  it("preserves untrimmed native mention offsets", async () => {
    const mention = "@海外業務";
    const text = " 😀 " + mention + " Hello";
    const event = groupTextEvent(text);
    Object.assign(event.message, {mention: {mentionees: [{index: 4, length: mention.length}]}});
    await callWebhook({events: [event]});
    expect(translator.translate).toHaveBeenCalledExactlyOnceWith(text, "en", "zh-TW",
      {protectedRanges: [{start: 4, length: mention.length}]});
  });

  it.each(["group text", "group audio", "private text", "private audio"].flatMap((kind) =>
    ["quality", "service"].map((failure) => ({kind, failure}))))(
    "silently handles $failure failure for $kind", async ({kind, failure}) => {
      vi.mocked(translator.translate).mockRejectedValue(failure === "quality" ?
        new TranslationQualityError("protected_value_changed") : new TranslationServiceError());
      const events = {
        "group text": groupTextEvent("報價800美元"), "group audio": groupAudioEvent(),
        "private text": userTextEvent("報價800美元"), "private audio": userAudioEvent(),
      };
      const result = await callWebhook({events: [events[kind as keyof typeof events]]});
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({failed: 1, processed: 0});
      expect(replier.replyText).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("800");
    },
  );

  it("continues the batch after silently skipping a failed translation", async () => {
    vi.mocked(translator.translate).mockRejectedValueOnce(new TranslationQualityError("pricing_terminology"))
      .mockResolvedValueOnce("Hello");
    const result = await callWebhook({events: [groupTextEvent("底價"), groupTextEvent("你好")]});
    expect(result.body).toMatchObject({failed: 1, processed: 1});
    expect(replier.replyText).toHaveBeenCalledExactlyOnceWith("reply-token", "Hello");
  });

  function dependencies() {
    return {
      channelSecret,
      translator,
      transcriber,
      audioContentLoader,
      replier,
      settingsStore,
      ownerUserId,
      logger,
    };
  }

  async function callWebhook(body: object, maxMessageLength?: number) {
    const rawBody = Buffer.from(JSON.stringify(body));
    return processLineWebhook(
      {method: "POST", rawBody, signature: sign(rawBody)},
      {...dependencies(), maxMessageLength},
    );
  }
});

function sign(rawBody: Buffer): string {
  return createHmac("sha256", channelSecret).update(rawBody).digest("base64");
}

function groupTextEvent(text: string) {
  return {
    type: "message",
    replyToken: "reply-token",
    source: {type: "group", groupId: "group-id", userId: ownerUserId},
    message: {type: "text", id: "message-id", text},
    webhookEventId: "webhook-event-id",
  };
}

function groupJoinEvent() {
  return {
    type: "join",
    replyToken: "join-reply-token",
    source: {type: "group", groupId: "group-id"},
    webhookEventId: "join-webhook-event-id",
  };
}

function groupAudioEvent(duration = 12_000) {
  return {
    type: "message",
    replyToken: "audio-reply-token",
    source: {type: "group", groupId: "group-id", userId: ownerUserId},
    message: {
      type: "audio",
      id: "audio-message-id",
      duration,
      contentProvider: {type: "line"},
    },
    webhookEventId: "audio-webhook-event-id",
  };
}

function userTextEvent(text: string) {
  return {
    type: "message",
    replyToken: "user-reply-token",
    source: {type: "user", userId: "private-user-id"},
    message: {type: "text", id: "user-message-id", text},
    webhookEventId: "user-webhook-event-id",
  };
}

function userAudioEvent(duration = 12_000) {
  return {
    type: "message",
    replyToken: "user-audio-reply-token",
    source: {type: "user", userId: "private-user-id"},
    message: {
      type: "audio",
      id: "user-audio-message-id",
      duration,
      contentProvider: {type: "line"},
    },
    webhookEventId: "user-audio-webhook-event-id",
  };
}
