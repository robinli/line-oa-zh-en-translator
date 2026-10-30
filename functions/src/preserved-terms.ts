import type {TextRange} from "./message-text.js";

// Explicit user-approved copy-exact phrase. Horizontal source whitespace and case
// are retained; ordinary Vietnamese "mít" and longer Latin words are unaffected.
export function findPreservedTermRanges(text: string): TextRange[] {
  const phrase = /(?<![\p{Script=Latin}\p{M}\p{N}_])mít[\t\p{Zs}]+color(?![\p{Script=Latin}\p{M}\p{N}_])/giu;
  return [...text.matchAll(phrase)].map(match => ({start: match.index, length: match[0].length}));
}

// A uniquely identified ordinary span may normalize horizontal whitespace.
// Restore its original surface only when every non-whitespace character agrees.
export function matchesPreservedTermWhitespace(original: string, candidate: string): boolean {
  const ranges = findPreservedTermRanges(original);
  return ranges.length === 1 && ranges[0]!.start === 0 && ranges[0]!.length === original.length &&
    original.replace(/[\t\p{Zs}]+/gu, " ") === candidate.replace(/[\t\p{Zs}]+/gu, " ");
}

export function hasSamePreservedTermCounts(original: string, candidate: string): boolean {
  if (!findPreservedTermRanges(original).length) return true;
  const sourceParagraphs = original.split(/\r\n|\r|\n|\u2028|\u2029/u);
  const targetParagraphs = candidate.split(/\r\n|\r|\n|\u2028|\u2029/u);
  if (sourceParagraphs.length !== targetParagraphs.length) return false;
  const counts = (text: string) => {
    const result = new Map<string, number>();
    for (const range of findPreservedTermRanges(text)) {
      const key = text.slice(range.start, range.start + range.length).replace(/[\t\p{Zs}]+/gu, " ").toLowerCase();
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  return sourceParagraphs.every((paragraph, index) => {
    const expected = counts(paragraph), actual = counts(targetParagraphs[index]!);
    return expected.size === actual.size && [...expected].every(([term, count]) => actual.get(term) === count);
  });
}
