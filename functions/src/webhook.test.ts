import {createHmac} from "node:crypto";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {
  AudioContentLoader,
  AudioTranscriber,
  GroupActivationStore,
  LineReplier,
  Translator,
} from "./services.js";
import {processLineWebhook, type WebhookLogger} from "./webhook.js";

const channelSecret = "test-channel-secret";
const ownerUserId = "owner-user-id";

describe("processLineWebhook", () => {
  let translator: Translator;
  let transcriber: AudioTranscriber;
  let audioContentLoader: AudioContentLoader;
  let replier: LineReplier;
  let activationStore: GroupActivationStore;
  let logger: WebhookLogger;

  beforeEach(() => {
    translator = {translateTraditionalChineseToEnglish: vi.fn().mockResolvedValue("Hello")};
    transcriber = {transcribe: vi.fn().mockResolvedValue("明天下午三點開會")};
    audioContentLoader = {
      getMessageContent: vi.fn().mockResolvedValue(Buffer.from("audio")),
    };
    replier = {replyText: vi.fn().mockResolvedValue(undefined)};
    activationStore = {
      isEnabled: vi.fn().mockResolvedValue(true),
      setEnabled: vi.fn().mockResolvedValue(undefined),
    };
    logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()};
  });

  it("returns 200 for LINE webhook URL verification", async () => {
    const result = await callWebhook({destination: "destination", events: []});

    expect(result).toEqual({status: 200, body: {ok: true, processed: 0, ignored: 0, failed: 0}});
  });

  it("rejects non-POST requests without calling external APIs", async () => {
    const rawBody = Buffer.from('{"events":[]}');
    const result = await processLineWebhook(
      {method: "GET", rawBody},
      {
        channelSecret,
        translator,
        transcriber,
        audioContentLoader,
        replier,
        activationStore,
        ownerUserId,
        logger,
      },
    );

    expect(result).toEqual({status: 405, body: {ok: false, error: "Method not allowed"}});
    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
    expect(replier.replyText).not.toHaveBeenCalled();
  });

  it("rejects a signed body without an events array", async () => {
    const result = await callWebhook({destination: "destination"});

    expect(result).toEqual({status: 400, body: {ok: false, error: "Invalid webhook body"}});
  });

  it("translates Chinese group text and replies in English", async () => {
    const result = await callWebhook({
      events: [groupTextEvent("明天下午三點開會")],
    });

    expect(translator.translateTraditionalChineseToEnglish).toHaveBeenCalledWith("明天下午三點開會");
    expect(activationStore.isEnabled).toHaveBeenCalledWith("group-id");
    expect(replier.replyText).toHaveBeenCalledWith("reply-token", "Hello");
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("transcribes Chinese group audio and replies with Chinese and English", async () => {
    const result = await callWebhook({
      events: [groupAudioEvent()],
    });

    expect(audioContentLoader.getMessageContent).toHaveBeenCalledWith(
      "audio-message-id",
      10_000_000,
    );
    expect(transcriber.transcribe).toHaveBeenCalledWith(Buffer.from("audio"));
    expect(translator.translateTraditionalChineseToEnglish).toHaveBeenCalledWith(
      "明天下午三點開會",
    );
    expect(replier.replyText).toHaveBeenCalledWith(
      "audio-reply-token",
      "中文：\n明天下午三點開會\n\n英文：\nHello",
    );
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("replies with only the transcript when group audio is not Chinese", async () => {
    vi.mocked(transcriber.transcribe).mockResolvedValue("Meeting at three tomorrow.");

    const result = await callWebhook({events: [groupAudioEvent()]});

    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith(
      "audio-reply-token",
      "語音轉文字：\nMeeting at three tomorrow.",
    );
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("does not download group audio before the group is enabled", async () => {
    vi.mocked(activationStore.isEnabled).mockResolvedValue(false);

    const result = await callWebhook({events: [groupAudioEvent()]});

    expect(audioContentLoader.getMessageContent).not.toHaveBeenCalled();
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 1, failed: 0});
  });

  it("rejects group audio above the synchronous recognition duration limit", async () => {
    const result = await callWebhook({
      events: [groupAudioEvent(60_000)],
    });

    expect(audioContentLoader.getMessageContent).not.toHaveBeenCalled();
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith(
      "audio-reply-token",
      expect.stringContaining("59 秒"),
    );
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("returns the sender user ID only for the private ID command", async () => {
    const result = await callWebhook({events: [userTextEvent(" /我的ID ")]});

    expect(replier.replyText).toHaveBeenCalledWith(
      "user-reply-token",
      "你的 LINE userId：\nprivate-user-id",
    );
    expect(activationStore.isEnabled).not.toHaveBeenCalled();
    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("transcribes one-to-one Chinese audio without group activation", async () => {
    const result = await callWebhook({events: [userAudioEvent()]});

    expect(activationStore.isEnabled).not.toHaveBeenCalled();
    expect(audioContentLoader.getMessageContent).toHaveBeenCalledWith(
      "user-audio-message-id",
      10_000_000,
    );
    expect(transcriber.transcribe).toHaveBeenCalledWith(Buffer.from("audio"));
    expect(translator.translateTraditionalChineseToEnglish).toHaveBeenCalledWith(
      "明天下午三點開會",
    );
    expect(replier.replyText).toHaveBeenCalledWith(
      "user-audio-reply-token",
      "中文：\n明天下午三點開會\n\n英文：\nHello",
    );
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("ignores other one-to-one messages", async () => {
    const result = await callWebhook({events: [userTextEvent("你好")]});

    expect(replier.replyText).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 1, failed: 0});
  });

  it("does not translate Chinese text before the group is enabled", async () => {
    vi.mocked(activationStore.isEnabled).mockResolvedValue(false);

    const result = await callWebhook({events: [groupTextEvent("你好")]});

    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 1, failed: 0});
  });

  it("explains how to enable translation when joining a new disabled group", async () => {
    vi.mocked(activationStore.isEnabled).mockResolvedValue(false);

    const result = await callWebhook({events: [groupJoinEvent()]});

    expect(activationStore.isEnabled).toHaveBeenCalledWith("group-id");
    expect(activationStore.setEnabled).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith(
      "join-reply-token",
      expect.stringContaining("/啟用翻譯"),
    );
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("preserves an existing enabled state when the bot rejoins a group", async () => {
    vi.mocked(activationStore.isEnabled).mockResolvedValue(true);

    await callWebhook({events: [groupJoinEvent()]});

    expect(activationStore.setEnabled).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith(
      "join-reply-token",
      expect.stringContaining("已啟用"),
    );
  });

  it("lets the configured owner enable translation", async () => {
    const result = await callWebhook({events: [groupTextEvent(" /啟用翻譯 ")]});

    expect(activationStore.setEnabled).toHaveBeenCalledWith("group-id", true, ownerUserId);
    expect(replier.replyText).toHaveBeenCalledWith("reply-token", expect.stringContaining("已啟用"));
    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("lets the configured owner disable translation", async () => {
    const result = await callWebhook({events: [groupTextEvent("/停用翻譯")]});

    expect(activationStore.setEnabled).toHaveBeenCalledWith("group-id", false, ownerUserId);
    expect(replier.replyText).toHaveBeenCalledWith("reply-token", expect.stringContaining("已停用"));
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("rejects activation commands from other group members", async () => {
    const event = groupTextEvent("/啟用翻譯");
    event.source.userId = "another-user-id";

    const result = await callWebhook({events: [event]});

    expect(activationStore.setEnabled).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith("reply-token", expect.stringContaining("沒有權限"));
    expect(result.body).toMatchObject({processed: 1, ignored: 0, failed: 0});
  });

  it("rejects activation commands when LINE omits the sender user ID", async () => {
    const event = {
      ...groupTextEvent("/啟用翻譯"),
      source: {type: "group", groupId: "group-id"},
    };

    await callWebhook({events: [event]});

    expect(activationStore.setEnabled).not.toHaveBeenCalled();
    expect(replier.replyText).toHaveBeenCalledWith("reply-token", expect.stringContaining("沒有權限"));
  });

  it.each([
    [true, "已啟用"],
    [false, "未啟用"],
  ])("reports the current translation status when enabled is %s", async (enabled, expectedText) => {
    vi.mocked(activationStore.isEnabled).mockResolvedValue(enabled);

    await callWebhook({events: [groupTextEvent("/翻譯狀態")]});

    expect(replier.replyText).toHaveBeenCalledWith("reply-token", expect.stringContaining(expectedText));
    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
  });

  it("ignores English, non-text, and one-to-one messages", async () => {
    const result = await callWebhook({
      events: [
        groupTextEvent("English only"),
        {...groupTextEvent("你好"), message: {type: "image", id: "image-id"}},
        {...groupTextEvent("你好"), source: {type: "user", userId: "user-id"}},
      ],
    });

    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 3, failed: 0});
  });

  it("ignores messages above the configured length limit", async () => {
    const result = await callWebhook({events: [groupTextEvent("中文太長")]}, 3);

    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({processed: 0, ignored: 1, failed: 0});
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("rejects an invalid signature before parsing or calling APIs", async () => {
    const rawBody = Buffer.from('{"events":[]}');
    const result = await processLineWebhook(
      {method: "POST", rawBody, signature: "invalid"},
      {
        channelSecret,
        translator,
        transcriber,
        audioContentLoader,
        replier,
        activationStore,
        ownerUserId,
        logger,
      },
    );

    expect(result.status).toBe(401);
    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with a valid signature", async () => {
    const rawBody = Buffer.from("not-json");
    const result = await processLineWebhook(
      {method: "POST", rawBody, signature: sign(rawBody)},
      {
        channelSecret,
        translator,
        transcriber,
        audioContentLoader,
        replier,
        activationStore,
        ownerUserId,
        logger,
      },
    );

    expect(result.status).toBe(400);
  });

  it("logs API errors without returning a non-2xx response that triggers redelivery", async () => {
    vi.mocked(translator.translateTraditionalChineseToEnglish).mockRejectedValue(new Error("API unavailable"));

    const result = await callWebhook({events: [groupTextEvent("你好")]});

    expect(result).toEqual({status: 200, body: {ok: true, processed: 0, ignored: 0, failed: 1}});
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to process a LINE group message.",
      expect.objectContaining({webhookEventId: "webhook-event-id", error: "API unavailable"}),
    );
  });

  it("records a LINE reply failure without retrying the reply", async () => {
    vi.mocked(replier.replyText).mockRejectedValue(new Error("Reply token expired"));

    const result = await callWebhook({events: [groupTextEvent("你好")]});

    expect(translator.translateTraditionalChineseToEnglish).toHaveBeenCalledOnce();
    expect(replier.replyText).toHaveBeenCalledOnce();
    expect(result.body).toMatchObject({processed: 0, ignored: 0, failed: 1});
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to process a LINE group message.",
      expect.objectContaining({error: "Reply token expired"}),
    );
  });

  it("records an activation store failure without translating or replying", async () => {
    vi.mocked(activationStore.isEnabled).mockRejectedValue(new Error("Firestore unavailable"));

    const result = await callWebhook({events: [groupTextEvent("你好")]});

    expect(result.body).toMatchObject({processed: 0, ignored: 0, failed: 1});
    expect(translator.translateTraditionalChineseToEnglish).not.toHaveBeenCalled();
    expect(replier.replyText).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to process a LINE group message.",
      expect.objectContaining({error: "Firestore unavailable"}),
    );
  });

  async function callWebhook(body: object, maxMessageLength?: number) {
    const rawBody = Buffer.from(JSON.stringify(body));
    return processLineWebhook(
      {method: "POST", rawBody, signature: sign(rawBody)},
      {
        channelSecret,
        translator,
        transcriber,
        audioContentLoader,
        replier,
        activationStore,
        ownerUserId,
        logger,
        maxMessageLength,
      },
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
    deliveryContext: {isRedelivery: false},
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
    deliveryContext: {isRedelivery: false},
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

