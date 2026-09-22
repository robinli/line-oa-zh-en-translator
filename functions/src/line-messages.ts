import type {messagingApi} from "@line/bot-sdk";
import {isLineUserId, type UserMention} from "./mentions.js";

type ReplyMessage = messagingApi.TextMessage | messagingApi.TextMessageV2;

export function buildReplyMessages(text: string, mentions: readonly UserMention[] = []): ReplyMessage[] {
  if (!text || text.length > 24_000) throw new Error("LINE reply text is empty or too long.");
  if (!mentions.length) return splitPlainText(text);
  const ordered = [...mentions].sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const mention of ordered) {
    if (!Number.isSafeInteger(mention.start) || !Number.isSafeInteger(mention.length) ||
        mention.start < previousEnd || mention.length <= 0 || mention.length > 5000 ||
        mention.start + mention.length > text.length || !isLineUserId(mention.userId) ||
        splitsSurrogate(text, mention.start) || splitsSurrogate(text, mention.start + mention.length)) {
      throw new Error("Invalid LINE reply mention ranges.");
    }
    previousEnd = mention.start + mention.length;
  }
  const messages: ReplyMessage[] = [];
  let plain = "";
  let encoded = "";
  let substitutions: NonNullable<messagingApi.TextMessageV2["substitution"]> = {};
  let count = 0;
  const flush = () => {
    if (!plain) return;
    messages.push(count ? {type: "textV2", text: encoded, substitution: substitutions} :
      {type: "text", text: plain});
    plain = "";
    encoded = "";
    substitutions = {};
    count = 0;
  };
  const appendText = (part: string) => {
    for (const char of part) {
      const escaped = char === "{" ? "{{" : char === "}" ? "}}" : char;
      if (encoded.length + escaped.length > 5000 || plain.length + char.length > 5000) flush();
      plain += char;
      encoded += escaped;
    }
  };
  let cursor = 0;
  for (const mention of ordered) {
    appendText(text.slice(cursor, mention.start));
    // Split before a placeholder, never inside a mention or Unicode pair.
    if (encoded.length + String(count).length + 3 > 5000 ||
        plain.length + mention.length > 5000 || count === 20) flush();
    const actualKey = "m" + count;
    encoded += "{" + actualKey + "}";
    plain += text.slice(mention.start, mention.start + mention.length);
    substitutions[actualKey] = {type: "mention", mentionee: {type: "user", userId: mention.userId}};
    count++;
    cursor = mention.start + mention.length;
  }
  appendText(text.slice(cursor));
  flush();
  if (messages.length > 5) {
    // Escaping or mention boundaries can require extra space; preserve all text as a plain reply.
    return splitPlainText(text);
  }
  return messages;
}

function splitPlainText(text: string): messagingApi.TextMessage[] {
  const messages: messagingApi.TextMessage[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + 5000, text.length);
    if (splitsSurrogate(text, end)) end--;
    messages.push({type: "text", text: text.slice(offset, end)});
    offset = end;
  }
  return messages;
}

function splitsSurrogate(text: string, offset: number): boolean {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]!) &&
    /[\uDC00-\uDFFF]/u.test(text[offset]!);
}
