import {TranslationQualityError} from "./trade-policy.js";
import type {LiteralManifest, LiteralOccurrence} from "./nmt-literal-policy.js";
import type {TextRange} from "./message-text.js";

export interface LiteralPlacement extends TextRange {id: string; paragraph: number}
type Boundary = "opaque" | "configured" | "native";
function literalMatches(text: string, value: string, boundary: Boundary, declared: readonly TextRange[]): TextRange[] {
  const matches: TextRange[] = []; let position = 0;
  while ((position = text.indexOf(value, position)) >= 0) {
    const end = position + value.length;
    const anchored = declared.some(range => position >= range.start && end <= range.start + range.length);
    const before = [...text.slice(0, position)].at(-1) ?? "", after = [...text.slice(end)][0] ?? "";
    const bounded = boundary === "opaque" || (boundary === "configured" ?
      !/[A-Za-z]/u.test(before) && !/[A-Za-z]/u.test(after) :
      (!/^[\p{L}\p{N}]/u.test(value) || !/[\p{L}\p{N}]/u.test(before)) &&
      (!/[\p{L}\p{N}]$/u.test(value) || !/[\p{L}\p{N}]/u.test(after)));
    // Declared UTF-16 ranges are evidence even beside letters. Unprotected name prefixes are not.
    if (anchored || bounded) matches.push({start: position, length: value.length});
    position = end;
  }
  return matches;
}
function boundary(item: LiteralOccurrence): Boundary {
  if (item.nativeRanges.some(range => range.start === item.start && range.length === item.length)) return "native";
  return item.reasons.every(reason => reason === "configured-name" || reason === "registered-term") ? "configured" : "opaque";
}

export function findLiteralMatches(text: string, item: LiteralOccurrence, declared: readonly TextRange[]): TextRange[] {
  return literalMatches(text, item.value, boundary(item), declared);
}
function literalCount(text: string, value: string, kind: Boundary, declared: readonly TextRange[]): number {
  return literalMatches(text, value, kind, declared).length;
}

// Every declared literal retains paragraph ownership and whole-message multiplicity.
// Only manifest literals are counted; there is no scan of ordinary output numbers.
export function assertLiteralIntegrity(manifest: LiteralManifest, paragraphs: readonly string[], placements: readonly LiteralPlacement[] = []): void {
  if (manifest.paragraphs.length !== paragraphs.length) throw new TranslationQualityError("paragraph_structure_changed");
  const output = paragraphs.join("\n"), starts: number[] = []; let offset = 0;
  for (const text of paragraphs) {starts.push(offset); offset += text.length + 1;}
  const sourceRanges = manifest.occurrences.map(item => ({start: item.start, length: item.length}));
  const outputRanges = placements.map(item => ({start: starts[item.paragraph]! + item.start, length: item.length}));
  for (const item of manifest.occurrences) {
    const kind = boundary(item), source = manifest.paragraphs[item.paragraph]!;
    const sourceLocal = manifest.occurrences.filter(value => value.paragraph === item.paragraph).map(value => ({start: value.start - source.start, length: value.length}));
    const outputLocal = placements.filter(value => value.paragraph === item.paragraph);
    if (literalCount(source.text, item.value, kind, sourceLocal) !== literalCount(paragraphs[item.paragraph]!, item.value, kind, outputLocal) ||
        literalCount(manifest.original, item.value, kind, sourceRanges) !== literalCount(output, item.value, kind, outputRanges)) {
      throw new TranslationQualityError("exact_occurrence_changed");
    }
  }
}
