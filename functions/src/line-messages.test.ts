import {describe, expect, it, vi} from "vitest";
import {HTTPFetchError} from "@line/bot-sdk";
import {buildReplyMessages} from "./line-messages.js";
import {LineMessagingApiReplier} from "./services.js";

const userId = "U" + "1".repeat(32);
const groupId = "C" + "3".repeat(32);
const context = {groupId, mentions: [{start: 0, length: 7, userId}]};

describe("native LINE mention replies", () => {
  it("uses textV2 substitutions and escapes literal braces without changing their content", () => {
    expect(buildReplyMessages("Wei bro, check {m0} and {{x}} 😀", context.mentions)).toEqual([{
      type: "textV2", text: "{m0}, check {{m0}} and {{{{x}}}} 😀",
      substitution: {m0: {type: "mention", mentionee: {type: "user", userId}}},
    }]);
  });
  it("leaves plain text braces untouched when no mention is present", () => {
    expect(buildReplyMessages("check {m0}")).toEqual([{type: "text", text: "check {m0}"}]);
  });
  it("splits before a mention rather than cutting it or an emoji", () => {
    const prefix = "a".repeat(4999) + "😀";
    const messages = buildReplyMessages(prefix + "Wei bro?", [
      {start: prefix.length, length: 7, userId},
    ]);
    expect(messages).toEqual([
      {type: "text", text: "a".repeat(4999)},
      {type: "textV2", text: "😀{m0}?", substitution: {
        m0: {type: "mention", mentionee: {type: "user", userId}},
      }},
    ]);
  });
  it("creates no more than twenty mention substitutions in one message", () => {
    const messages = buildReplyMessages("@a ".repeat(21), Array.from({length: 21}, (_, i) =>
      ({start: i * 3, length: 2, userId})));
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.type === "textV2" ?
      Object.keys(message.substitution!).length : 0)).toEqual([20, 1]);
  });
  it("falls back to complete plain text when escaping would exceed five messages", () => {
    const text = "Wei bro " + "{".repeat(23992);
    const messages = buildReplyMessages(text, context.mentions);
    expect(messages).toHaveLength(5);
    expect(messages.every((message) => message.type === "text")).toBe(true);
    expect(messages.map((message) => message.text).join("")).toBe(text);
  });
  it.each([
    [{start: -1, length: 1, userId}],
    [{start: 1, length: 1, userId}],
    [{start: 0, length: 100, userId}],
    [{start: 0, length: 2, userId}, {start: 0, length: 2, userId}],
    [{start: 0, length: 2, userId: "unknown"}],
  ].map((mentions) => ({mentions})))("rejects invalid or overlapping mention offsets", ({mentions}) => {
    expect(() => buildReplyMessages("😀 sample", mentions)).toThrow("Invalid LINE reply mention ranges.");
  });
  it("checks a repeated person's membership once per reply", async () => {
    const replyMessage = vi.fn().mockResolvedValue({});
    const isMember = vi.fn().mockResolvedValue(true);
    const replier = new LineMessagingApiReplier("token", {replyMessage}, {isMember});
    await replier.replyText("reply", "Wei bro and Wei bro", {groupId, mentions: [
      {start: 0, length: 7, userId}, {start: 12, length: 7, userId},
    ]});
    expect(isMember).toHaveBeenCalledOnce();
    expect(isMember).toHaveBeenCalledWith(groupId, userId);
    expect(replyMessage.mock.calls[0]![0].messages[0].type).toBe("textV2");
  });
  it.each(["not-member", "unavailable"])("sends plain translation when membership is %s", async (condition) => {
    const replyMessage = vi.fn().mockResolvedValue({});
    const isMember = condition === "not-member" ? vi.fn().mockResolvedValue(false) :
      vi.fn().mockRejectedValue(new Error("private request details"));
    await new LineMessagingApiReplier("token", {replyMessage}, {isMember})
      .replyText("reply", "Wei bro，請確認。", context);
    expect(replyMessage).toHaveBeenCalledWith({replyToken: "reply", messages: [
      {type: "text", text: "Wei bro，請確認。"},
    ]});
  });
  it("retries with plain translation after a definite HTTP 400 mention rejection", async () => {
    const replyMessage = vi.fn().mockRejectedValueOnce(new HTTPFetchError("rejected", {
      status: 400, statusText: "Bad Request", headers: new Headers(), body: "private SDK details",
    })).mockResolvedValueOnce({});
    await new LineMessagingApiReplier("token", {replyMessage}, {isMember: async () => true})
      .replyText("reply", "Wei bro，請確認。", context);
    expect(replyMessage).toHaveBeenCalledTimes(2);
    expect(replyMessage.mock.calls[1]![0].messages).toEqual([{type: "text", text: "Wei bro，請確認。"}]);
  });
  it.each([{status: 500}, {status: 429}, new Error("timeout with private payload")])(
    "does not resend after an uncertain delivery failure", async (error) => {
      const replyMessage = vi.fn().mockRejectedValue(error);
      await expect(new LineMessagingApiReplier("token", {replyMessage}, {isMember: async () => true})
        .replyText("reply", "Wei bro，請確認。", context)).rejects.toThrow("LINE reply could not be delivered.");
      expect(replyMessage).toHaveBeenCalledOnce();
    });
});
