import {resolveExactDirectives, type ExactDirective} from "./nmt-exact-directives.js";
import {findLiteralCodeRanges} from "./literal-codes.js";
import type {TextRange} from "./message-text.js";
import type {TranslationContext} from "./services.js";
import {DEFAULT_PROTECTED_NAMES, TranslationQualityError} from "./trade-policy.js";

export const NMT_LITERAL_POLICY_VERSION = "nmt-literal-explicit-v1";
export interface LiteralOccurrence extends TextRange {
  id: string; value: string; paragraph: number; reasons: string[];
  nativeRanges: TextRange[];
}
export interface LiteralParagraph {start: number; text: string; separator: string}
export interface LiteralManifest {original: string; paragraphs: LiteralParagraph[]; occurrences: LiteralOccurrence[]; directives: ExactDirective[]}
type Candidate = TextRange & {reason: string};

export function literalParagraphs(text: string): LiteralParagraph[] {
  const result: LiteralParagraph[] = []; let start = 0;
  for (const match of text.matchAll(/\r\n|\r|\n|\u2028|\u2029/gu)) {
    result.push({start, text: text.slice(start, match.index), separator: match[0]});
    start = match.index + match[0].length;
  }
  result.push({start, text: text.slice(start), separator: ""});
  return result;
}

function boundary(text: string, index: number): boolean {
  return !(index > 0 && index < text.length && /[\uD800-\uDBFF]/u.test(text[index - 1]!) && /[\uDC00-\uDFFF]/u.test(text[index]!));
}
function checkedRanges(text: string, ranges: readonly TextRange[], native: boolean): TextRange[] {
  if (ranges.length > (native ? 20 : 100)) throw new TranslationQualityError("invalid_protected_range");
  const sorted = ranges.map(range => ({...range})).sort((a, b) => a.start - b.start); let end = 0;
  for (const range of sorted) {
    const next = range.start + range.length;
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.length) || range.start < end || range.length <= 0 ||
        next > text.length || !boundary(text, range.start) || !boundary(text, next) ||
        /[\r\n\u2028\u2029]/u.test(text.slice(range.start, next))) throw new TranslationQualityError("invalid_protected_range");
    end = next;
  }
  return sorted;
}

// This policy declares exact literals only; there is no generic number, role or time parser.
export function createLiteralManifest(text: string, names: readonly string[] = DEFAULT_PROTECTED_NAMES, context?: TranslationContext): LiteralManifest {
  const paragraphs = literalParagraphs(text);
  const native = checkedRanges(text, context?.protectedRanges ?? [], true);
  const explicit = checkedRanges(text, context?.copyExactRanges ?? [], false);
  const candidates: Candidate[] = [...native.map(range => ({...range, reason: "native-mention"})),
    ...explicit.map(range => ({...range, reason: "copy-exact"}))];
  const collect = (pattern: RegExp, reason: string) => {
    for (const match of text.matchAll(pattern)) candidates.push({start: match.index, length: match[0].length, reason});
  };
  collect(/https?:\/\/[^\s<>，。；！？、：]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "contact");
  collect(/&amp;(?:amp;)*(?:(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9a-f]+);)?|&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9a-f]+);|<\/?[A-Za-z][^<>\r\n]*>/giu, "source-markup");
  collect(/(?<![A-Za-z])(?:CNF|C&F|CFR|CIF|FOB|EXW|FCA|FAS|CPT|CIP|DAP|DPU|DDP|DDU|FIBC)(?![A-Za-z])/giu, "registered-term");
  for (const name of names.map(value => value.trim()).filter(Boolean)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    collect(new RegExp("(?<![A-Za-z])" + escaped + "(?![A-Za-z])", "giu"), "configured-name");
  }
  candidates.push(...findLiteralCodeRanges(text).map(range => ({...range, reason: "literal-code"})));
  // A tight pricing suffix is explicitly exact under the 9/29 policy.
  collect(/(?<![A-Za-z])(?:US\$|NT\$|HK\$|S\$|USD|TWD|NTD|HKD|SGD|EUR|GBP|JPY|CNY|RMB|VND|AUD|CAD|CHF|INR)[ \t]*[+\-−]?[0-9０-９]+(?:[,.，．][0-9０-９]+)*[／/][A-Za-z0-9Ａ-Ｚａ-ｚ０-９\-－_$%*+=.~^!]+/giu, "tight-price");
  const directives = resolveExactDirectives(text, paragraphs, explicit);
  if (directives.some(item => item.state === "ambiguous")) throw new TranslationQualityError("ambiguous_copy_exact");
  for (const item of directives) {
    if (item.operand) candidates.push({...item.operand, reason: "copy-exact"});
  }
  // Union overlapping exact scopes. Native identity remains a separate offset within that union.
  const merged: Array<TextRange & {reasons: string[]}> = [];
  for (const candidate of candidates.sort((a, b) => a.start - b.start || b.length - a.length)) {
    const last = merged.at(-1);
    if (last && candidate.start < last.start + last.length) {
      last.length = Math.max(last.start + last.length, candidate.start + candidate.length) - last.start;
      if (!last.reasons.includes(candidate.reason)) last.reasons.push(candidate.reason);
    } else merged.push({start: candidate.start, length: candidate.length, reasons: [candidate.reason]});
  }
  const occurrences = merged.map((range, i): LiteralOccurrence => {
    const paragraph = paragraphs.findIndex(item => range.start >= item.start && range.start + range.length <= item.start + item.text.length);
    if (paragraph < 0) throw new TranslationQualityError("invalid_protected_range");
    return {...range, id: "l" + i, value: text.slice(range.start, range.start + range.length), paragraph,
      nativeRanges: native.filter(item => item.start >= range.start && item.start + item.length <= range.start + range.length)};
  });
  return {original: text, paragraphs, occurrences, directives};
}
