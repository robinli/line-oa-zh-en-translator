import type {TextRange} from "./message-text.js";

// Contiguous ASCII/full-width letters, digits and the user-specified symbols.
// A final period/exclamation mark is sentence punctuation, not part of a code.
const RUN = /[A-Za-z0-9Ａ-Ｚａ-ｚ０-９\-－/／$＄%％*＊+＋=＝.．~～^＾!！]+/gu;
export function findLiteralCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  for (const match of text.matchAll(RUN)) {
    const leading = match[0].match(/^[\/／.．!！]+/u)?.[0].length ?? 0;
    const value = match[0].slice(leading).replace(/[.!．！/／]+$/u, "");
    const normalized = value.normalize("NFKC");
    if (!/[A-Za-z0-9]/u.test(normalized) || !/[-/$%*+=.~^!]/u.test(normalized)) continue;
    ranges.push({start: match.index + leading, length: value.length});
  }
  return ranges;
}

export interface LiteralCodeSpan {start: number; end: number; kind: string; value: string; literal?: boolean; sourceDenominator?: string}

// Keep quantity/formula metadata for the existing semantic checks. Mentions,
// contacts and escaped source markup retain priority over automatic code ranges.
export function protectLiteralCodes(text: string, original: LiteralCodeSpan[]): LiteralCodeSpan[] {
  let spans = original.slice();
  for (const range of findLiteralCodeRanges(text)) {
    let start = range.start;
    const end = start + range.length;
    const overlapping = spans.filter(span => start < span.end && end > span.start);
    if (overlapping.some(span => ["person-mention", "contact", "literal-markup"].includes(span.kind))) continue;
    // A number in a larger quantity (e.g. 2.5 公斤) is already checked exactly;
    // preserve its unit semantics rather than splitting the number from the unit.
    if (overlapping.some(span => span.end > end || span.start < start && span.kind !== "quantity")) continue;
    start = Math.min(start, ...overlapping.map(span => span.start));
    const first = overlapping.find(span => span.start === start);
    const kind = first && (first.end === end || first.kind === "quantity" && text.slice(first.end, end).startsWith("/")) ?
      first.kind : "literal-code";
    spans = spans.filter(span => !overlapping.includes(span));
    spans.push({start, end, kind, value: text.slice(start, end), literal: true,
      sourceDenominator: kind === "quantity" ? first?.sourceDenominator : undefined});
  }
  return spans;
}
