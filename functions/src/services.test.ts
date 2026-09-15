import {Readable} from "node:stream";
import {describe, expect, it, vi} from "vitest";
import {
  FirestoreConversationSettingsStore,
  GoogleCloudSpeechTranscriber,
  GoogleCloudTranslator,
  LineMessagingApiContentLoader,
  LineMessagingApiReplier,
} from "./services.js";


describe("FirestoreConversationSettingsStore", () => {
  function setup(values: Record<string, unknown> = {}) {
    const set = vi.fn().mockImplementation(async (updates: Record<string, unknown>) => {
      Object.assign(values, updates);
    });
    const get = vi.fn().mockResolvedValue({get: (field: string) => values[field]});
    const doc = vi.fn().mockReturnValue({get, set});
    const collection = vi.fn().mockReturnValue({doc});
    return {store: new FirestoreConversationSettingsStore({collection}), set, doc};
  }

  it.each(["zh-to-en", "en-to-zh", "zh-en", "zh-vi"] as const)("reads and writes %s", async (mode) => {
    const {store, set, doc} = setup({enabled: true, translationMode: mode});
    await expect(store.getSettings("group-id")).resolves.toEqual({
      textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: mode,
    });
    await store.setModeAndEnabled("group-id", mode, "owner-id");
    expect(set).toHaveBeenCalledWith({
      textTranslationEnabled: true, translationMode: mode,
      changedBy: "owner-id", changedAt: expect.any(Date),
    }, {merge: true});
    expect(doc).toHaveBeenCalledWith("group-id");
  });

  it.each([
    [{}, false, false],
    [{enabled: true}, true, true],
    [{enabled: false}, false, false],
    [{enabled: true, textTranslationEnabled: false}, false, true],
    [{enabled: true, audioTranscriptionEnabled: false}, true, false],
    [{enabled: false, textTranslationEnabled: true, audioTranscriptionEnabled: true}, true, true],
    [{enabled: true, textTranslationEnabled: "false"}, true, true],
  ] as const)("reads legacy and explicit flags %j", async (values, text, audio) => {
    const {store} = setup({...values});
    await expect(store.getSettings("group-id")).resolves.toEqual({
      textTranslationEnabled: text, audioTranscriptionEnabled: audio, translationMode: "zh-en",
    });
  });

  it.each([undefined, "invalid"])("defaults unknown mode %s to Chinese-English", async (mode) => {
    const {store} = setup({translationMode: mode});
    expect((await store.getSettings("group-id")).translationMode).toBe("zh-en");
  });

  it("updates text and mode without altering legacy audio state", async () => {
    const {store, set} = setup({enabled: true, translationMode: "zh-vi"});
    await store.setTextTranslationEnabled("group-id", false, "owner-id");
    await expect(store.getSettings("group-id")).resolves.toEqual({
      textTranslationEnabled: false, audioTranscriptionEnabled: true, translationMode: "zh-vi",
    });
    expect(set).toHaveBeenLastCalledWith({
      textTranslationEnabled: false, changedBy: "owner-id", changedAt: expect.any(Date),
    }, {merge: true});
    await store.setModeAndEnabled("group-id", "zh-to-en", "owner-id");
    await expect(store.getSettings("group-id")).resolves.toEqual({
      textTranslationEnabled: true, audioTranscriptionEnabled: true, translationMode: "zh-to-en",
    });
  });

  it("updates audio independently and preserves explicit false when changing mode", async () => {
    const {store, set} = setup({enabled: true, translationMode: "zh-en"});
    await store.setAudioTranscriptionEnabled("group-id", false, "owner-id");
    expect(set).toHaveBeenLastCalledWith({
      audioTranscriptionEnabled: false, changedBy: "owner-id", changedAt: expect.any(Date),
    }, {merge: true});
    await store.setModeAndEnabled("group-id", "en-to-zh", "owner-id");
    await expect(store.getSettings("group-id")).resolves.toEqual({
      textTranslationEnabled: true, audioTranscriptionEnabled: false, translationMode: "en-to-zh",
    });
  });

  it("does not enable audio in a new conversation when choosing a mode", async () => {
    const {store, doc} = setup();
    await store.setModeAndEnabled("user:private-id", "zh-to-en", "private-id");
    await expect(store.getSettings("user:private-id")).resolves.toEqual({
      textTranslationEnabled: true, audioTranscriptionEnabled: false, translationMode: "zh-to-en",
    });
    expect(doc).toHaveBeenCalledWith("user:private-id");
  });
});

describe("GoogleCloudTranslator", () => {
  it("calls Translation API v3 with the requested language pair", async () => {
    const translateText = vi.fn().mockResolvedValue([
      {translations: [{translatedText: " Xin chào. "}]},
    ]);
    const translator = new GoogleCloudTranslator("test-project", {translateText});

    await expect(
      translator.translate("你好。", "zh-TW", "vi"),
    ).resolves.toBe("Xin chào.");
    expect(translateText).toHaveBeenCalledWith({
      parent: "projects/test-project/locations/global",
      contents: ["你好。"],
      mimeType: "text/plain",
      sourceLanguageCode: "zh-TW",
      targetLanguageCode: "vi",
    });
  });

  it("rejects an empty translation response", async () => {
    const translator = new GoogleCloudTranslator("test-project", {
      translateText: vi.fn().mockResolvedValue([{translations: []}]),
    });

    await expect(
      translator.translate("你好", "zh-TW", "en"),
    ).rejects.toThrow("empty translation");
  });
});

describe("GoogleCloudSpeechTranscriber", () => {
  it("uses the requested recognition languages and returns the detected language", async () => {
    const recognize = vi.fn().mockResolvedValue([
      {
        results: [
          {
            languageCode: "vi-VN",
            alternatives: [{transcript: " Xin chào. "}],
          },
          {alternatives: [{transcript: "Hẹn gặp lại."}]},
        ],
      },
    ]);
    const transcriber = new GoogleCloudSpeechTranscriber("test-project", {recognize});
    const audioContent = Buffer.from("audio");

    await expect(
      transcriber.transcribe(audioContent, ["cmn-Hant-TW", "vi-VN"]),
    ).resolves.toEqual({
      text: "Xin chào.\nHẹn gặp lại.",
      languageCode: "vi-VN",
    });
    expect(recognize).toHaveBeenCalledWith({
      recognizer: "projects/test-project/locations/global/recognizers/_",
      config: {
        autoDecodingConfig: {},
        languageCodes: ["cmn-Hant-TW", "vi-VN"],
        model: "long",
        features: {
          enableAutomaticPunctuation: true,
        },
      },
      content: audioContent,
    });
  });

  it("rejects an empty transcription response", async () => {
    const transcriber = new GoogleCloudSpeechTranscriber("test-project", {
      recognize: vi.fn().mockResolvedValue([{results: []}]),
    });

    await expect(
      transcriber.transcribe(Buffer.from("audio"), ["cmn-Hant-TW", "en-US"]),
    ).rejects.toThrow("empty transcript");
  });
});

describe("LineMessagingApiContentLoader", () => {
  it("downloads and combines streamed LINE message content", async () => {
    const getMessageContent = vi.fn().mockResolvedValue(
      Readable.from([Buffer.from("first"), Buffer.from("second")]),
    );
    const loader = new LineMessagingApiContentLoader("unused-test-token", {
      getMessageContent,
    });

    await expect(loader.getMessageContent("message-id", 100)).resolves.toEqual(
      Buffer.from("firstsecond"),
    );
    expect(getMessageContent).toHaveBeenCalledWith("message-id");
  });

  it("rejects downloaded LINE message content above the byte limit", async () => {
    const getMessageContent = vi.fn().mockResolvedValue(
      Readable.from([Buffer.from("123"), Buffer.from("456")]),
    );
    const loader = new LineMessagingApiContentLoader("unused-test-token", {
      getMessageContent,
    });

    await expect(loader.getMessageContent("message-id", 5)).rejects.toThrow(
      "5-byte limit",
    );
  });

  it("rejects empty LINE message content", async () => {
    const loader = new LineMessagingApiContentLoader("unused-test-token", {
      getMessageContent: vi.fn().mockResolvedValue(Readable.from([])),
    });

    await expect(loader.getMessageContent("message-id", 100)).rejects.toThrow(
      "empty audio content",
    );
  });
});

describe("LineMessagingApiReplier", () => {
  it("sends one text message with the original reply token", async () => {
    const replyMessage = vi.fn().mockResolvedValue({});
    const replier = new LineMessagingApiReplier("unused-test-token", {replyMessage});

    await replier.replyText("reply-token", "Hello");

    expect(replyMessage).toHaveBeenCalledWith({
      replyToken: "reply-token",
      messages: [{type: "text", text: "Hello"}],
    });
  });
});
