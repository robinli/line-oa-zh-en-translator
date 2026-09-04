import {Readable} from "node:stream";
import {describe, expect, it, vi} from "vitest";
import {
  FirestoreGroupActivationStore,
  GoogleCloudSpeechTranscriber,
  GoogleCloudTranslator,
  LineMessagingApiContentLoader,
  LineMessagingApiReplier,
} from "./services.js";

describe("FirestoreGroupActivationStore", () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])("maps the stored value %s to %s", async (storedValue, expected) => {
    const get = vi.fn().mockResolvedValue({get: vi.fn().mockReturnValue(storedValue)});
    const doc = vi.fn().mockReturnValue({get, set: vi.fn()});
    const collection = vi.fn().mockReturnValue({doc});
    const store = new FirestoreGroupActivationStore({collection});

    await expect(store.isEnabled("group-id")).resolves.toBe(expected);
    expect(collection).toHaveBeenCalledWith("lineTranslationGroups");
    expect(doc).toHaveBeenCalledWith("group-id");
  });

  it("stores the activation state and audit fields", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const doc = vi.fn().mockReturnValue({get: vi.fn(), set});
    const store = new FirestoreGroupActivationStore({
      collection: vi.fn().mockReturnValue({doc}),
    });

    await store.setEnabled("group-id", true, "owner-user-id");

    expect(set).toHaveBeenCalledWith(
      {
        enabled: true,
        changedBy: "owner-user-id",
        changedAt: expect.any(Date),
      },
      {merge: true},
    );
  });
});

describe("GoogleCloudTranslator", () => {
  it("calls Translation API v3 with the expected language pair", async () => {
    const translateText = vi.fn().mockResolvedValue([
      {translations: [{translatedText: " Meeting tomorrow. "}]},
    ]);
    const client = {translateText};
    const translator = new GoogleCloudTranslator(
      "test-project",
      client,
    );

    await expect(
      translator.translateTraditionalChineseToEnglish("明天開會。"),
    ).resolves.toBe("Meeting tomorrow.");
    expect(translateText).toHaveBeenCalledWith({
      parent: "projects/test-project/locations/global",
      contents: ["明天開會。"],
      mimeType: "text/plain",
      sourceLanguageCode: "zh-TW",
      targetLanguageCode: "en",
    });
  });

  it("rejects an empty translation response", async () => {
    const client = {translateText: vi.fn().mockResolvedValue([{translations: []}])};
    const translator = new GoogleCloudTranslator("test-project", client);

    await expect(
      translator.translateTraditionalChineseToEnglish("你好"),
    ).rejects.toThrow("empty translation");
  });
});

describe("GoogleCloudSpeechTranscriber", () => {
  it("uses Speech-to-Text v2 with automatic decoding and Chinese/English detection", async () => {
    const recognize = vi.fn().mockResolvedValue([
      {
        results: [
          {alternatives: [{transcript: " 明天下午三點開會。 "}]},
          {alternatives: [{transcript: "請準時出席。"}]},
        ],
      },
    ]);
    const transcriber = new GoogleCloudSpeechTranscriber("test-project", {recognize});
    const audioContent = Buffer.from("audio");

    await expect(transcriber.transcribe(audioContent)).resolves.toBe(
      "明天下午三點開會。\n請準時出席。",
    );
    expect(recognize).toHaveBeenCalledWith({
      recognizer: "projects/test-project/locations/global/recognizers/_",
      config: {
        autoDecodingConfig: {},
        languageCodes: ["cmn-Hant-TW", "en-US"],
        model: "long",
        features: {
          enableAutomaticPunctuation: true,
        },
      },
      content: audioContent,
    });
  });

  it("rejects an empty transcription response", async () => {
    const client = {recognize: vi.fn().mockResolvedValue([{results: []}])};
    const transcriber = new GoogleCloudSpeechTranscriber("test-project", client);

    await expect(transcriber.transcribe(Buffer.from("audio"))).rejects.toThrow(
      "empty transcript",
    );
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
    const getMessageContent = vi.fn().mockResolvedValue(Readable.from([]));
    const loader = new LineMessagingApiContentLoader("unused-test-token", {
      getMessageContent,
    });

    await expect(loader.getMessageContent("message-id", 100)).rejects.toThrow(
      "empty audio content",
    );
  });
});

describe("LineMessagingApiReplier", () => {
  it("sends one text message with the original reply token", async () => {
    const replyMessage = vi.fn().mockResolvedValue({});
    const client = {replyMessage};
    const replier = new LineMessagingApiReplier("unused-test-token", client);

    await replier.replyText("reply-token", "Hello");

    expect(replyMessage).toHaveBeenCalledWith({
      replyToken: "reply-token",
      messages: [{type: "text", text: "Hello"}],
    });
  });
});

