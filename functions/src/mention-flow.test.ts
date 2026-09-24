import {createHmac} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import {BusinessTranslator, type GenerationRequest} from "./business-translator.js";
import {LineMessagingApiReplier, type ConversationSettingsStore} from "./services.js";
import {processLineWebhook, type WebhookDependencies} from "./webhook.js";

const userId = "U" + "1".repeat(32);
const otherId = "U" + "2".repeat(32);
const groupId = "C" + "3".repeat(32);
const aliases = [{alias: "Wei bro", userId}, {alias: "Wei brother", userId}];

function setup() {
  const generate = vi.fn().mockImplementation((request: GenerationRequest) => {
    const input = JSON.parse(request.input) as {text: string};
    return JSON.stringify({translation: input.text.replace("Please confirm.", "請確認。")});
  });
  const replyMessage = vi.fn().mockResolvedValue({});
  const isMember = vi.fn().mockResolvedValue(true);
  const dependencies: WebhookDependencies = {
    channelSecret: "secret", ownerUserId: "owner",
    translator: new BusinessTranslator({generate}),
    transcriber: {transcribe: vi.fn()}, audioContentLoader: {getMessageContent: vi.fn()},
    replier: new LineMessagingApiReplier("unused", {replyMessage}, {isMember}),
    mentionAliases: aliases,
    settingsStore: {getSettings: vi.fn().mockResolvedValue({
      textTranslationEnabled: true, audioTranscriptionEnabled: false, translationMode: "zh-en",
    })} as unknown as ConversationSettingsStore,
    logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn()},
  };
  const call = async (text: string, mention?: unknown, privateChat = false) => {
    const body = Buffer.from(JSON.stringify({events: [{
      type: "message", replyToken: "reply",
      source: privateChat ? {type: "user", userId} : {type: "group", groupId},
      message: {type: "text", text, mention},
    }]}));
    return processLineWebhook({method: "POST", rawBody: body,
      signature: createHmac("sha256", "secret").update(body).digest("base64")}, dependencies);
  };
  return {dependencies, generate, replyMessage, isMember, call};
}

describe("translation to native mention integration", () => {
  it.each(["Wei bro", "Wei brother"])("turns %s into the same verified recipient after translation", async (alias) => {
    const {call, replyMessage, generate} = setup();
    expect((await call(alias + ", Please confirm.")).body).toMatchObject({processed: 1, failed: 0});
    expect(replyMessage.mock.calls[0]![0].messages).toEqual([{
      type: "textV2", text: "{m0}, 請確認。",
      substitution: {m0: {type: "mention", mentionee: {type: "user", userId}}},
    }]);
    const modelInput = generate.mock.calls[0]![0].input as string;
    expect(modelInput).not.toContain(userId);
    expect(modelInput).not.toContain("userId");
    expect(modelInput).not.toContain("rangeTokens");
  });
  it("preserves distinct IDs for identical names when the model reorders mentions", async () => {
    const {call, generate, replyMessage} = setup();
    generate.mockImplementation((request: GenerationRequest) => {
      const data = JSON.parse(request.input) as {protectedValues: Array<{token: string}>};
      return JSON.stringify({translation: "😀 " + data.protectedValues[1]!.token +
        " 請通知 " + data.protectedValues[0]!.token + "。"});
    });
    await call("@甲 asked @甲 to confirm.", {mentionees: [
      {index: 0, length: 2, type: "user", userId},
      {index: 9, length: 2, type: "user", userId: otherId},
    ]});
    expect(replyMessage.mock.calls[0]![0].messages).toEqual([{
      type: "textV2", text: "😀 {m0} 請通知 {m1}。",
      substitution: {
        m0: {type: "mention", mentionee: {type: "user", userId: otherId}},
        m1: {type: "mention", mentionee: {type: "user", userId}},
      },
    }]);
    expect(generate.mock.calls[0]![0].input).not.toContain(userId);
  });
  it("still ignores unchanged translations instead of replying only to add a mention", async () => {
    const {call, replyMessage, isMember, generate} = setup();
    expect((await call("Wei brother?")).body).toMatchObject({ignored: 1, failed: 0});
    expect(generate).toHaveBeenCalledOnce();
    expect(replyMessage).not.toHaveBeenCalled();
    expect(isMember).not.toHaveBeenCalled();
  });
  it("does not guess an ID from a plain name", async () => {
    const {call, replyMessage, isMember} = setup();
    await call("Wei, Please confirm.");
    expect(replyMessage.mock.calls[0]![0].messages).toEqual([{type: "text", text: "Wei, 請確認。"}]);
    expect(isMember).not.toHaveBeenCalled();
  });
  it("ignores private text without translating, replying or checking members", async () => {
    const {call, replyMessage, isMember, generate} = setup();
    expect((await call("Wei brother, Please confirm.", undefined, true)).body)
      .toMatchObject({processed: 0, ignored: 1, failed: 0});
    expect(replyMessage).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(isMember).not.toHaveBeenCalled();
  });
  it("keeps single-direction English ignore behavior with Chinese native names", async () => {
    const {call, generate, replyMessage, dependencies} = setup();
    vi.mocked(dependencies.settingsStore.getSettings).mockResolvedValue({
      textTranslationEnabled: true, audioTranscriptionEnabled: false, translationMode: "zh-to-en",
    });
    expect((await call("@甲 Please confirm.", {mentionees: [
      {index: 0, length: 2, type: "user", userId},
    ]})).body).toMatchObject({ignored: 1});
    expect(generate).not.toHaveBeenCalled();
    expect(replyMessage).not.toHaveBeenCalled();
  });
  it("does not attempt mentions when using an engine without reliable range restoration", async () => {
    const {call, dependencies, replyMessage, isMember} = setup();
    dependencies.translator = {translate: vi.fn().mockResolvedValue("Wei 哥，請確認。")};
    await call("Wei bro, Please confirm.");
    expect(replyMessage.mock.calls[0]![0].messages[0].type).toBe("text");
    expect(isMember).not.toHaveBeenCalled();
  });
});
