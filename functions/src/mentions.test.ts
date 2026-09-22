import {describe, expect, it, vi} from "vitest";
import {findUserMentions, parseMentionAliases, restoreUserMentions, LineGroupMemberVerifier} from "./mentions.js";

const userId = "U" + "1".repeat(32);
const otherId = "U" + "2".repeat(32);
const groupId = "C" + "3".repeat(32);
const aliases = [{alias: "Wei bro", userId}, {alias: "Wei brother", userId}];

describe("explicit mention identities", () => {
  it.each(["Wei bro", "Wei brother", "WEI BROTHER", "Wei\tbro", "@Wei bro"])(
    "matches the configured address %s", (name) => {
      const text = "😀 " + name + ", please confirm.";
      expect(findUserMentions({text}, aliases)).toEqual([{start: 3, length: name.length, userId}]);
    });
  it.each(["Wei", "Wei Brotherhood", "XWei bro", "Wei brother2",
    "https://example.com/Wei bro", "Wei.bro@example.com", "@@Wei bro"])(
    "does not guess an identity from %s", (text) => {
      expect(findUserMentions({text}, aliases)).toEqual([]);
    });
  it("retains native identity rather than replacing it with an alias identity", () => {
    const text = "@Wei brother, confirm.";
    expect(findUserMentions({text, mention: {mentionees: [
      {index: 0, length: 12, type: "user", userId: otherId},
    ]}}, aliases)).toEqual([{start: 0, length: 12, userId: otherId}]);
  });
  it.each([
    {type: "all"}, {type: "user"}, {type: "user", userId: "invalid"},
    {type: "user", userId, isSelf: true},
  ])("does not turn an unsupported native mention into an alias mention", (item) => {
    expect(findUserMentions({text: "@Wei brother confirm.", mention: {
      mentionees: [{index: 0, length: 12, ...item}],
    }}, aliases)).toEqual([]);
  });
  it("rejects conflicting native identities for the same text range", () => {
    expect(findUserMentions({text: "@甲 confirm.", mention: {mentionees: [
      {index: 0, length: 2, type: "user", userId},
      {index: 0, length: 2, type: "user", userId: otherId},
    ]}}, [])).toEqual([]);
  });
  it("caps processing of a repeated address at twenty mentions", () => {
    expect(findUserMentions({text: "Wei bro, ".repeat(21)}, aliases)).toHaveLength(20);
  });
  it("parses explicit aliases and deduplicates equivalent configuration", () => {
    expect(parseMentionAliases(JSON.stringify([...aliases, {alias: "WEI  BRO", userId}]))).toHaveLength(2);
  });
  it.each(["not json", "{}", '[{"alias":"Wei bro","userId":"bad"}]',
    JSON.stringify([{alias: "Wei bro", userId}, {alias: "wei bro", userId: otherId}]),
    JSON.stringify([{alias: ".*", userId}])])("rejects malformed or ambiguous configuration without echoing it", (json) => {
      expect(() => parseMentionAliases(json)).toThrow("Invalid LINE mention alias configuration.");
    });
  it("uses source occurrence mappings, never a translated display-name search", () => {
    const source = "@甲 asked @甲";
    const translated = "😀 @甲 先問 @甲";
    const candidates = [{start: 0, length: 2, userId}, {start: 9, length: 2, userId: otherId}];
    expect(restoreUserMentions(source, translated, candidates, [
      {sourceStart: 9, start: 3, length: 2}, {sourceStart: 0, start: 9, length: 2},
    ])).toEqual([{start: 3, length: 2, userId: otherId}, {start: 9, length: 2, userId}]);
  });
  it.each([
    [], [{sourceStart: 0, start: 0, length: 2}], [{sourceStart: 0, start: -1, length: 2}],
    [{sourceStart: 0, start: 2, length: 2}, {sourceStart: 0, start: 2, length: 2}],
  ].map((ranges) => ({ranges})))("does not invent a mention when restoration is missing or ambiguous", ({ranges}) => {
    expect(restoreUserMentions("@甲", "請問@甲", [{start: 0, length: 2, userId}], ranges)).toEqual([]);
  });
});

describe("LINE group membership checks", () => {
  it("checks the exact group and accepts only the matching returned user ID", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({userId})));
    expect(await new LineGroupMemberVerifier("token", request).isMember(groupId, userId)).toBe(true);
    expect(request).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/group/" + groupId + "/member/" + userId,
      expect.objectContaining({signal: expect.any(AbortSignal)}));
  });
  it.each([403, 404, 429, 500])("returns false for HTTP %s without attempting to notify anyone", async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", {status}));
    expect(await new LineGroupMemberVerifier("token", request).isMember(groupId, userId)).toBe(false);
    expect(request).toHaveBeenCalledOnce();
  });
  it("fails closed for mismatched identity, malformed JSON and network errors", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({userId: otherId})))
      .mockResolvedValueOnce(new Response("not json"))
      .mockRejectedValueOnce(new Error("secret request URL"));
    const verifier = new LineGroupMemberVerifier("token", request);
    for (let i = 0; i < 3; i++) expect(await verifier.isMember(groupId, userId)).toBe(false);
  });
  it("does not query arbitrary paths or private-chat IDs", async () => {
    const request = vi.fn<typeof fetch>();
    const verifier = new LineGroupMemberVerifier("token", request);
    expect(await verifier.isMember("../invalid", userId)).toBe(false);
    expect(await verifier.isMember(groupId, "../invalid")).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
