export interface TextRange {
  start: number;
  length: number;
}

export interface RestoredTextRange extends TextRange {
  sourceStart: number;
}

export function getMentionRanges(message: {text: string; mention?: unknown}): TextRange[] {
  const mention = message.mention;
  if (!mention || typeof mention !== "object" ||
      !("mentionees" in mention) || !Array.isArray(mention.mentionees)) return [];
  const ranges: TextRange[] = [];
  for (const item of mention.mentionees) {
    if (!item || typeof item !== "object") continue;
    const {index, length} = item as Record<string, unknown>;
    if (typeof index !== "number" || typeof length !== "number" ||
        !Number.isSafeInteger(index) || !Number.isSafeInteger(length) ||
        index < 0 || length <= 0 || index + length > message.text.length ||
        message.text[index] !== "@") continue;
    ranges.push({start: index, length});
  }
  const accepted: TextRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || b.length - a.length)) {
    const previous = accepted[accepted.length - 1];
    if (!previous || range.start >= previous.start + previous.length) accepted.push(range);
  }
  return accepted;
}

export function excludeTextRanges(text: string, ranges: readonly TextRange[]): string {
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += text.slice(cursor, range.start) + " ";
    cursor = range.start + range.length;
  }
  return result + text.slice(cursor);
}

