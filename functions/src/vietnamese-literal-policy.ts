import type {LiteralManifest, LiteralOccurrence, LiteralParagraph} from "./nmt-literal-policy.js";
import type {TranslationContext} from "./services.js";
import type {TextRange} from "./message-text.js";
import {findLiteralCodeRanges} from "./literal-codes.js";
import {findPreservedTermRanges} from "./preserved-terms.js";

// Chinese/Vietnamese protects only native mentions, literal codes and explicit
// preserved phrases. No English trade names, trade terms or directive inference.
export function createVietnameseLiteralManifest(text: string, context?: TranslationContext): LiteralManifest {
  const paragraphs: LiteralParagraph[] = []; let start = 0;
  for (const match of text.matchAll(/\r\n|\r|\n|\u2028|\u2029/gu)) {
    paragraphs.push({start, text: text.slice(start, match.index), separator: match[0]});
    start = match.index + match[0].length;
  }
  paragraphs.push({start, text: text.slice(start), separator: ""});
  const paragraphOf = (range: TextRange) => paragraphs.findIndex(item => range.start >= item.start && range.start + range.length <= item.start + item.text.length);
  const boundary = (index: number) => !(index > 0 && index < text.length && /[\uD800-\uDBFF]/u.test(text[index - 1]!) && /[\uDC00-\uDFFF]/u.test(text[index]!));
  const native = [...context?.protectedRanges ?? []].map(range => ({...range})).sort((a, b) => a.start - b.start);
  if (native.length > 20) throw new Error("Invalid Vietnamese protected range");
  let end = 0;
  for (const range of native) {
    const next = range.start + range.length;
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.length) || range.start < end || range.length <= 0 ||
        next > text.length || !boundary(range.start) || !boundary(next) || paragraphOf(range) < 0) throw new Error("Invalid Vietnamese protected range");
    end = next;
  }
  const overlaps = (a: TextRange, b: TextRange) => a.start < b.start + b.length && a.start + a.length > b.start;
  const codes = findLiteralCodeRanges(text), terms = findPreservedTermRanges(text);
  const ordinary: TextRange[] = [];
  for (const range of [...codes, ...terms].filter(range => !native.some(item => overlaps(range, item))).sort((a, b) => a.start - b.start || b.length - a.length)) {
    const last = ordinary.at(-1);
    if (last && overlaps(last, range)) last.length = Math.max(last.start + last.length, range.start + range.length) - last.start;
    else ordinary.push({...range});
  }
  const occurrences: LiteralOccurrence[] = [...native.map(range => ({...range, native: true})), ...ordinary.map(range => ({...range, native: false}))]
    .sort((a, b) => a.start - b.start).map((range, index) => {
      const paragraph = paragraphOf(range);
      if (paragraph < 0) throw new Error("Invalid Vietnamese protected range");
      return {start: range.start, length: range.length, id: "l" + index, value: text.slice(range.start, range.start + range.length), paragraph,
        nativeRanges: range.native ? [{start: range.start, length: range.length}] : [],
        reasons: range.native ? ["native-mention"] : [...(codes.some(item => overlaps(range, item)) ? ["literal-code"] : []), ...(terms.some(item => overlaps(range, item)) ? ["registered-term"] : [])]};
    });
  return {original: text, paragraphs, occurrences, directives: []};
}
