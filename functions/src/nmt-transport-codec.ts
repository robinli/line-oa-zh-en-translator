import type {RestoredTextRange, TextRange} from "./message-text.js";
import {assertLiteralIntegrity, findLiteralMatches, type LiteralPlacement} from "./nmt-integrity.js";
import {literalParagraphs, type LiteralManifest} from "./nmt-literal-policy.js";
import {TranslationQualityError} from "./trade-policy.js";

export function escapeNmtHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
export function decodeNmtHtml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/giu, entity => {
    const known: Record<string, string> = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": "\u00a0"};
    if (known[entity.toLowerCase()] !== undefined) return known[entity.toLowerCase()]!;
    const hex = entity[2]?.toLowerCase() === "x", point = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    if (!Number.isSafeInteger(point) || point < 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) throw new TranslationQualityError("invalid_response_format");
    return String.fromCodePoint(point);
  });
}
function attributes(text: string, allowed: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {}; let cursor = 0;
  for (const match of text.matchAll(/\s+([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    if (text.slice(cursor, match.index).trim()) throw new TranslationQualityError("invalid_response_format");
    const name = match[1]!.toLowerCase();
    if (!allowed.includes(name) || Object.hasOwn(result, name)) throw new TranslationQualityError("invalid_response_format");
    result[name] = decodeNmtHtml(match[2] ?? match[3]!); cursor = match.index + match[0].length;
  }
  if (text.slice(cursor).trim()) throw new TranslationQualityError("invalid_response_format");
  return result;
}
const separators = /[\r\n\u2028\u2029]/u;
const overlaps = (a: {start: number; length: number}, b: {start: number; length: number}) => a.start < b.start + b.length && b.start < a.start + a.length;

// Content evidence can recover ordinary literals, but never infer a LINE identity.
function recoverPlacements(manifest: LiteralManifest, paragraph: number, body: string, anchored: LiteralPlacement[]): LiteralPlacement[] {
  const result = [...anchored];
  const missing = manifest.occurrences.filter(item => item.paragraph === paragraph && !anchored.some(place => place.id === item.id));
  if (missing.some(item => item.nativeRanges.length)) throw new TranslationQualityError("exact_occurrence_changed");
  for (const item of missing.sort((a, b) => b.length - a.length || a.start - b.start)) {
    const candidates = findLiteralMatches(body, item, result).filter(match => !result.some(place => overlaps(match, place)));
    const candidate = candidates[0];
    if (!candidate) throw new TranslationQualityError("exact_occurrence_changed");
    result.push({...candidate, id: item.id, paragraph});
  }
  return result.sort((a, b) => a.start - b.start);
}

// Only an identified, exact configured-name span can be a redundant provider copy.
// Keep the ordinary occurrence; native identities and other literal scopes stay strict.
function repairRedundantNameCopies(manifest: LiteralManifest, bodies: readonly string[], placements: readonly LiteralPlacement[], spans: readonly TextRange[][], identified: ReadonlySet<string>) {
  const sourceRanges = manifest.occurrences.map(item => ({start: item.start, length: item.length}));
  const removals: Array<{tagged: LiteralPlacement; ordinary: TextRange}> = [];
  for (const item of manifest.occurrences) {
    if (!identified.has(item.id) || item.nativeRanges.length || item.reasons.length !== 1 || item.reasons[0] !== "configured-name" ||
        findLiteralMatches(manifest.original, item, sourceRanges).length !== 1) continue;
    const tagged = placements.find(place => place.id === item.id);
    if (!tagged || !(spans[item.paragraph] ?? []).some(span => span.start === tagged.start && span.length === tagged.length)) continue;
    const local = placements.filter(place => place.paragraph === item.paragraph);
    const matches = findLiteralMatches(bodies[item.paragraph]!, item, local);
    const ordinary = matches.filter(match => !(spans[item.paragraph] ?? []).some(span => overlaps(match, span)) &&
      !local.some(place => overlaps(match, place)));
    if (matches.length === 2 && ordinary.length === 1) removals.push({tagged, ordinary: ordinary[0]!});
  }
  if (!removals.length) return null;
  const adjustedBodies = bodies.map((body, paragraph) => {
    for (const {tagged} of removals.filter(item => item.tagged.paragraph === paragraph).sort((a, b) => b.tagged.start - a.tagged.start)) {
      body = body.slice(0, tagged.start) + body.slice(tagged.start + tagged.length);
    }
    return body;
  });
  const adjustedPlacements = placements.map(place => {
    const repair = removals.find(item => item.tagged.id === place.id);
    const start = repair?.ordinary.start ?? place.start;
    const removedBefore = removals.filter(item => item.tagged.paragraph === place.paragraph && item.tagged.start + item.tagged.length <= start)
      .reduce((sum, item) => sum + item.tagged.length, 0);
    return {...place, start: start - removedBefore};
  }).sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);
  return {bodies: adjustedBodies, placements: adjustedPlacements};
}

// Plain text has no protected occurrences. Align nonblank lines in order
// and restore the original source layout; blank lines are presentation.
function alignPlainParagraphs(manifest: LiteralManifest, translated: readonly string[]): string[] {
  const blank = (text: string) => /^[\t\p{Zs}]*$/u.test(text);
  const content = translated.filter(text => !blank(text));
  const sourceCount = manifest.paragraphs.filter(paragraph => !blank(paragraph.text)).length;
  if (content.length !== sourceCount) throw new TranslationQualityError("paragraph_structure_changed");
  let cursor = 0;
  return manifest.paragraphs.map(paragraph => blank(paragraph.text) ? paragraph.text : content[cursor++]!);
}
export function createNmtTransport(manifest: LiteralManifest) {
  const mimeType = manifest.occurrences.length ? "text/html" as const : "text/plain" as const;
  const html = manifest.paragraphs.map((paragraph, index) => {
    let body = "", cursor = paragraph.start;
    for (const item of manifest.occurrences.filter(value => value.paragraph === index)) {
      body += escapeNmtHtml(manifest.original.slice(cursor, item.start)) + '<span translate="no" class="notranslate" id="' + item.id + '">' + escapeNmtHtml(item.value) + "</span>";
      cursor = item.start + item.length;
    }
    return '<div id="p' + index + '">' + body + escapeNmtHtml(manifest.original.slice(cursor, paragraph.start + paragraph.text.length)) + "</div>";
  }).join("\n");
  return {
    mimeType, contents: [mimeType === "text/plain" ? manifest.original : html],
    hasTranslatableBody: manifest.paragraphs.some((paragraph, index) => {
      let body = paragraph.text;
      for (const item of manifest.occurrences.filter(value => value.paragraph === index).reverse()) {
        const local = item.start - paragraph.start; body = body.slice(0, local) + body.slice(local + item.length);
      }
      return /\p{L}/u.test(body);
    }),
    decode(response: string, present: (body: string) => string = value => value): {text: string; ranges: RestoredTextRange[]} {
      if (typeof response !== "string" || !response.trim() || response.length > 30000) throw new TranslationQualityError("invalid_response_format");
      if (mimeType === "text/plain") {
        const displayed = literalParagraphs(response).map(paragraph => {
          const text = present(paragraph.text);
          if (separators.test(text)) throw new TranslationQualityError("paragraph_structure_changed");
          return text;
        });
        const paragraphs = alignPlainParagraphs(manifest, displayed);
        assertLiteralIntegrity(manifest, paragraphs);
        const text = paragraphs.map((part, index) => part + manifest.paragraphs[index]!.separator).join("");
        if (text.length > 4500) throw new TranslationQualityError("output_too_long");
        return {text, ranges: []};
      }
      const bodies: string[] = [], rawPlacements: LiteralPlacement[] = [], spanRanges: TextRange[][] = [], seen = new Set<string>();
      const parseBody = (htmlBody: string, index: number) => {
        let part = "", position = 0; const anchored: LiteralPlacement[] = [];
        const append = (raw: string) => {
          if (/[<>]/u.test(raw) || separators.test(raw)) throw new TranslationQualityError("paragraph_structure_changed");
          const decoded = decodeNmtHtml(raw);
          if (separators.test(decoded)) throw new TranslationQualityError("paragraph_structure_changed");
          part += decoded;
        };
        for (const span of htmlBody.matchAll(/<span\b([^>]*)>([^<>]*)<\/span\s*>/giu)) {
          append(htmlBody.slice(position, span.index));
          const data = attributes(span[1]!, ["id", "class", "translate"]);
          if (separators.test(span[2]!)) throw new TranslationQualityError("paragraph_structure_changed");
          const decoded = decodeNmtHtml(span[2]!);
          if (separators.test(decoded)) throw new TranslationQualityError("paragraph_structure_changed");
          (spanRanges[index] ??= []).push({start: part.length, length: decoded.length});
          if (data.id !== undefined) {
            const occurrence = manifest.occurrences.find(item => item.id === data.id);
            if (!occurrence || occurrence.paragraph !== index || seen.has(occurrence.id)) throw new TranslationQualityError("exact_occurrence_changed");
            // Provider whitespace at a span edge is presentation, not a changed literal.
            const start = decoded.indexOf(occurrence.value);
            if (start < 0 || /[^\t\p{Zs}]/u.test(decoded.slice(0, start) + decoded.slice(start + occurrence.length))) throw new TranslationQualityError("exact_occurrence_changed");
            seen.add(occurrence.id);
            anchored.push({id: occurrence.id, paragraph: index, start: part.length + start, length: occurrence.length});
          }
          part += decoded; position = span.index + span[0].length;
        }
        append(htmlBody.slice(position));
        bodies.push(part); rawPlacements.push(...recoverPlacements(manifest, index, part, anchored));
      };
      let cursor = 0;
      const divs = [...response.matchAll(/<div\b([^>]*)>([\s\S]*?)<\/div\s*>/giu)];
      if (!divs.length) {
        // A single paragraph has unambiguous ownership even if its wrapper disappeared.
        if (manifest.paragraphs.length !== 1) throw new TranslationQualityError("paragraph_structure_changed");
        parseBody(response, 0);
      } else {
        for (const div of divs) {
          if (response.slice(cursor, div.index).trim()) throw new TranslationQualityError("paragraph_structure_changed");
          const index = bodies.length, attrs = attributes(div[1]!, ["id"]);
          if (!manifest.paragraphs[index] || attrs.id !== undefined && attrs.id !== "p" + index) throw new TranslationQualityError("paragraph_structure_changed");
          parseBody(div[2]!, index); cursor = div.index + div[0].length;
        }
        if (response.slice(cursor).trim()) throw new TranslationQualityError("paragraph_structure_changed");
      }
      try {assertLiteralIntegrity(manifest, bodies, rawPlacements);}
      catch (error) {
        if (!(error instanceof TranslationQualityError) || error.reason !== "exact_occurrence_changed") throw error;
        const repaired = repairRedundantNameCopies(manifest, bodies, rawPlacements, spanRanges, seen);
        if (!repaired) throw error;
        // Repair is only a candidate: every original literal/paragraph invariant must pass again.
        assertLiteralIntegrity(manifest, repaired.bodies, repaired.placements);
        bodies.splice(0, bodies.length, ...repaired.bodies);
        rawPlacements.splice(0, rawPlacements.length, ...repaired.placements);
      }
      const paragraphs: string[] = [], placements: LiteralPlacement[] = [], ranges: RestoredTextRange[] = []; let text = "";
      for (const [index, body] of bodies.entries()) {
        let part = "", position = 0;
        const append = (value: string) => {
          const displayed = present(value);
          if (separators.test(displayed)) throw new TranslationQualityError("paragraph_structure_changed");
          part += displayed;
        };
        for (const place of rawPlacements.filter(item => item.paragraph === index)) {
          append(body.slice(position, place.start));
          const occurrence = manifest.occurrences.find(item => item.id === place.id)!;
          placements.push({...place, start: part.length});
          for (const native of occurrence.nativeRanges) ranges.push({sourceStart: native.start, start: text.length + part.length + native.start - occurrence.start, length: native.length});
          part += occurrence.value; position = place.start + place.length;
        }
        append(body.slice(position)); paragraphs.push(part);
        text += part + manifest.paragraphs[index]!.separator;
      }
      assertLiteralIntegrity(manifest, paragraphs, placements);
      if (!text.trim() || text.length > 4500) throw new TranslationQualityError("output_too_long");
      return {text, ranges: ranges.sort((a, b) => a.start - b.start)};
    },
  };
}
