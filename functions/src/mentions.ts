import {getMentionRanges, type TextRange, type RestoredTextRange} from "./message-text.js";

export interface MentionAlias {alias: string; userId: string}
export interface UserMention extends TextRange {userId: string}
export interface MentionReplyContext {groupId: string; mentions: readonly UserMention[]}
export interface GroupMemberVerifier {isMember(groupId: string, userId: string): Promise<boolean>}

export function isLineUserId(value: unknown): value is string {
  return typeof value === "string" && /^U[0-9a-f]{32}$/u.test(value);
}

export function parseMentionAliases(json: string): MentionAlias[] {
  const invalid = () => new Error("Invalid LINE mention alias configuration.");
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw invalid(); }
  if (!Array.isArray(data) || data.length > 100) throw invalid();
  const aliases = new Map<string, MentionAlias>();
  for (const item of data) {
    if (!item || typeof item !== "object" || typeof item.alias !== "string" ||
        !isLineUserId(item.userId)) throw invalid();
    const alias = item.alias.trim().replace(/[ \t]+/gu, " ");
    // Configuration contains literal names, never regex, commands, IDs or network addresses.
    if (!/^[\p{L}][\p{L}\p{M} .'-]{1,79}$/u.test(alias)) throw invalid();
    const key = alias.toLowerCase();
    if (aliases.has(key) && aliases.get(key)!.userId !== item.userId) throw invalid();
    aliases.set(key, {alias, userId: item.userId});
  }
  return [...aliases.values()];
}

export function findUserMentions(
  message: {text: string; mention?: unknown}, aliases: readonly MentionAlias[],
): UserMention[] {
  const nativeRanges = getMentionRanges(message);
  const candidates: UserMention[] = [];
  const raw = message.mention as {mentionees?: unknown[]} | undefined;
  const items = Array.isArray(raw?.mentionees) ? raw.mentionees : [];
  for (const range of nativeRanges) {
    const matches = items.filter((item): item is Record<string, unknown> =>
      !!item && typeof item === "object" &&
      (item as Record<string, unknown>).index === range.start &&
      (item as Record<string, unknown>).length === range.length);
    if (matches.length && matches.every((item) => item.type === "user" &&
        item.isSelf !== true && isLineUserId(item.userId) &&
        item.userId === matches[0]!.userId)) {
      candidates.push({...range, userId: matches[0]!.userId as string});
    }
  }
  const blocked = [...nativeRanges];
  for (const match of message.text.matchAll(/https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu)) {
    blocked.push({start: match.index, length: match[0].length});
  }
  for (const item of [...aliases].sort((a, b) => b.alias.length - a.alias.length)) {
    const escaped = item.alias.replace(/[.*+?^$()|[\]\\]/gu, "\\$&").replace(/ +/gu, "[ \\t]+");
    const pattern = new RegExp("(?<![\\p{Script=Latin}\\p{N}_@])@?" + escaped +
      "(?![\\p{Script=Latin}\\p{N}_])", "giu");
    for (const match of message.text.matchAll(pattern)) {
      const range = {start: match.index, length: match[0].length};
      if (![...blocked, ...candidates].some((other) => overlaps(range, other))) {
        candidates.push({...range, userId: item.userId});
      }
    }
  }
  return candidates.sort((a, b) => a.start - b.start).slice(0, 20);
}

export function restoreUserMentions(source: string, translated: string,
  candidates: readonly UserMention[], ranges: readonly RestoredTextRange[]): UserMention[] {
  const mentions: UserMention[] = [];
  for (const candidate of candidates) {
    const matches = ranges.filter((range) => range.sourceStart === candidate.start);
    if (matches.length !== 1) continue;
    const range = matches[0]!;
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.length) ||
        range.start < 0 || range.length !== candidate.length ||
        range.start + range.length > translated.length ||
        translated.slice(range.start, range.start + range.length) !==
          source.slice(candidate.start, candidate.start + candidate.length)) continue;
    mentions.push({start: range.start, length: range.length, userId: candidate.userId});
  }
  return mentions.sort((a, b) => a.start - b.start);
}

function overlaps(a: TextRange, b: TextRange): boolean {
  return a.start < b.start + b.length && b.start < a.start + a.length;
}

// Membership is checked for this group on every reply; no global identity inference or profile storage.
export class LineGroupMemberVerifier implements GroupMemberVerifier {
  public constructor(private readonly channelAccessToken: string,
    private readonly request: typeof fetch = fetch) {}

  public async isMember(groupId: string, userId: string): Promise<boolean> {
    if (!/^C[0-9a-f]{32}$/u.test(groupId) || !isLineUserId(userId)) return false;
    try {
      const response = await this.request("https://api.line.me/v2/bot/group/" + groupId +
        "/member/" + userId, {headers: {Authorization: "Bearer " + this.channelAccessToken},
        signal: AbortSignal.timeout(3000)});
      if (!response.ok) return false;
      const profile: unknown = await response.json();
      return !!profile && typeof profile === "object" &&
        "userId" in profile && profile.userId === userId;
    } catch {
      return false;
    }
  }
}
