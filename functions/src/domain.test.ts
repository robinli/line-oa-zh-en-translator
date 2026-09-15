import {describe, expect, it} from "vitest";
import {
  containsChinese,
  containsLatin,
  isGroupAudioMessageEvent,
  isGroupJoinEvent,
  isGroupTextMessageEvent,
  isUserAudioMessageEvent,
  isUserTextMessageEvent,
} from "./domain.js";

describe("containsChinese", () => {
  it.each([
    ["明天下午三點開會", true],
    ["Meeting 明天下午三點", true],
    ["English only", false],
    ["123 😀", false],
  ])("classifies %j", (text, expected) => {
    expect(containsChinese(text)).toBe(expected);
  });
});

describe("containsLatin", () => {
  it.each([
    ["English only", true],
    ["Xin chào Việt Nam", true],
    ["只有中文", false],
    ["123 😀", false],
  ])("classifies %j", (text, expected) => {
    expect(containsLatin(text)).toBe(expected);
  });
});

describe("isGroupAudioMessageEvent", () => {
  it("accepts LINE-hosted group audio", () => {
    expect(
      isGroupAudioMessageEvent({
        type: "message",
        replyToken: "reply-token",
        source: {type: "group", groupId: "group-id"},
        message: {
          type: "audio",
          id: "audio-message-id",
          duration: 12_000,
          contentProvider: {type: "line"},
        },
      }),
    ).toBe(true);
  });

  it.each([
    {
      type: "message",
      replyToken: "token",
      source: {type: "user", userId: "user-id"},
      message: {
        type: "audio",
        id: "audio-id",
        contentProvider: {type: "line"},
      },
    },
    {
      type: "message",
      replyToken: "token",
      source: {type: "group", groupId: "group-id"},
      message: {
        type: "audio",
        id: "audio-id",
        contentProvider: {type: "external"},
      },
    },
    {
      type: "message",
      replyToken: "token",
      source: {type: "group", groupId: "group-id"},
      message: {type: "audio", contentProvider: {type: "line"}},
    },
  ])("rejects unsupported audio event %#", (event) => {
    expect(isGroupAudioMessageEvent(event)).toBe(false);
  });
});

describe("isGroupTextMessageEvent", () => {
  it("accepts a group text message", () => {
    expect(
      isGroupTextMessageEvent({
        type: "message",
        replyToken: "reply-token",
        source: {type: "group", groupId: "group-id"},
        message: {type: "text", id: "message-id", text: "你好"},
      }),
    ).toBe(true);
  });

  it.each([
    {type: "message", replyToken: "token", source: {type: "user"}, message: {type: "text", text: "你好"}},
    {type: "message", replyToken: "token", source: {type: "group"}, message: {type: "text", text: "你好"}},
    {type: "message", replyToken: "token", source: {type: "group", groupId: "group-id"}, message: {type: "image"}},
    {type: "join", replyToken: "token", source: {type: "group"}},
  ])("rejects unsupported event %#", (event) => {
    expect(isGroupTextMessageEvent(event)).toBe(false);
  });
});

describe("isGroupJoinEvent", () => {
  it("accepts a group join event with a group ID", () => {
    expect(
      isGroupJoinEvent({
        type: "join",
        replyToken: "reply-token",
        source: {type: "group", groupId: "group-id"},
      }),
    ).toBe(true);
  });

  it.each([
    {type: "join", replyToken: "token", source: {type: "group"}},
    {type: "join", replyToken: "token", source: {type: "user", userId: "user-id"}},
    {type: "message", replyToken: "token", source: {type: "group", groupId: "group-id"}},
  ])("rejects an invalid join event %#", (event) => {
    expect(isGroupJoinEvent(event)).toBe(false);
  });
});

describe("isUserTextMessageEvent", () => {
  it("accepts a one-to-one text message with a user ID", () => {
    expect(
      isUserTextMessageEvent({
        type: "message",
        replyToken: "reply-token",
        source: {type: "user", userId: "user-id"},
        message: {type: "text", text: "/我的ID"},
      }),
    ).toBe(true);
  });

  it("rejects a one-to-one message without a user ID", () => {
    expect(
      isUserTextMessageEvent({
        type: "message",
        replyToken: "reply-token",
        source: {type: "user"},
        message: {type: "text", text: "/我的ID"},
      }),
    ).toBe(false);
  });
});

describe("isUserAudioMessageEvent", () => {
  it("accepts LINE-hosted one-to-one audio", () => {
    expect(
      isUserAudioMessageEvent({
        type: "message",
        replyToken: "reply-token",
        source: {type: "user", userId: "user-id"},
        message: {
          type: "audio",
          id: "audio-id",
          duration: 12_000,
          contentProvider: {type: "line"},
        },
      }),
    ).toBe(true);
  });
});

