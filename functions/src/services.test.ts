import {describe, expect, it, vi} from "vitest";
import {
  FirestoreGroupActivationStore,
  GoogleCloudTranslator,
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

