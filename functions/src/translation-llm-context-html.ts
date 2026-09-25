import {TranslationQualityError, type PreparedTradeText} from "./trade-policy.js";
import {createLlmWireText, decodeLlmTransport, normalizeLlmCalendar} from "./translation-llm-protection.js";
import {externalPricingDenominator, pricingDenominatorKey, prepareLlmContext, quantityUnitGroup, sourceParagraphs, type PreparedLlmContext, type LlmOccurrence} from "./translation-llm-context.js";
const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const escapePattern = (text: string) => text.replace(/[.*+?^$()|[\]\\]/gu, "\\$&");
function validateValue(item: LlmOccurrence, value: string): void {
  if ((item.kind === "quantity" || item.kind === "unit") && (item.unit || item.kind === "unit") && !item.currency) {
    const unit = item.unit ?? item.value, group = quantityUnitGroup(unit);
    const alternatives: Record<string, string> = {kg: "(?:kg|kgs|kilograms?|公斤)", MT: "(?:MT|metric[ \\t]+tons?|公噸)", lb: "(?:lb|lbs|pounds?|磅)"};
    if (alternatives[group]) {
      const at = item.value.indexOf(unit);
      const expected = "^" + escapePattern(item.value.slice(0, at).trimEnd()) + "[ \\t]*" + alternatives[group] + escapePattern(item.value.slice(at + unit.length)) + "$";
      if (!new RegExp(expected, "iu").test(value)) throw new TranslationQualityError("quantity_unit_or_content_changed");
      return;
    }
  }
  if (value !== item.value) throw new TranslationQualityError(item.kind === "quantity" ? "quantity_content_changed" : "exact_occurrence_changed");
}
function restoredValue(item: LlmOccurrence, prepared: PreparedLlmContext): string {
  if (prepared.exactQuantities && item.externalDenominator) return item.value + prepared.original.slice(item.end).match(/^[ \t]*\/[ \t]*/u)![0] + item.externalDenominator;
  if (prepared.targetLanguage !== "en" || prepared.exactQuantities) return item.value;
  return item.kind === "quantity" || item.kind === "unit" ? item.value.replace(/公斤|公噸|磅/gu, unit => ({公斤: "kg", 公噸: "MT", 磅: "lb"})[unit]!) : item.value;
}
interface ReturnedPriceDenominator {value: string; start: number; end: number; side: "before" | "after"}
function returnedPriceDenominator(text: string, index: number, length: number): ReturnedPriceDenominator {
  const before = text.slice(0, index), tail = text.slice(index + length);
  const candidates: ReturnedPriceDenominator[] = [];
  const slash = externalPricingDenominator(tail);
  if (slash) candidates.push({value: slash, start: index + length, end: index + length + tail.indexOf(slash) + slash.length, side: "after"});
  // Only adjacent, finite pricing phrases may move around this exact amount token.
  const prefix = before.match(/每[ \t]*(?:個[ \t]*)?(紙箱|纸箱|箱|袋子|袋)[ \t]*$/u);
  if (prefix) candidates.push({value: prefix[1]!, start: prefix.index!, end: index, side: "before"});
  const per = tail.match(/^[ \t]+per[ \t]+(bags?|cartons?|box(?:es)?)(?=[ \t]*(?:[.。；;，,!?]|$))/iu);
  if (per) candidates.push({value: per[1]!, start: index + length, end: index + length + per[0].length, side: "after"});
  if (candidates.length !== 1 || prefix && /每[ \t]*(?:個[ \t]*)?(?:紙箱|纸箱|箱|袋子|袋)[ \t]*$/u.test(before.slice(0, prefix.index))) throw new TranslationQualityError("price_denominator_changed");
  return candidates[0]!;
}
export function createContextLlmHtml(prepared: PreparedLlmContext, maskNames = false, rawFinancial = false) {
  const tokens = new Map(prepared.occurrences.map(item => [item.token, item]));
  const tokenPattern = new RegExp(prepared.prefix + "\\d+__", "gu");
  const wire = createLlmWireText(prepared, maskNames);
  const visible = (item: LlmOccurrence) => item.kind === "quantity" && (Boolean(item.unit) && !item.currency && !maskNames || Boolean(item.currency) && maskNames && (prepared.targetLanguage === "en" || rawFinancial)) || item.kind === "unit" || item.kind === "packaging-code" || item.kind === "trade-term";
  const financialCodes = new Map(prepared.occurrences.filter(item => maskNames && prepared.targetLanguage === "en" && item.currency && item.kind === "quantity").map(item => {
    let letters = "", index = item.id + 1;
    while (index) {index--; letters = String.fromCharCode(65 + index % 26) + letters; index = Math.floor(index / 26);}
    return [item.value.replace(/[ \t]/gu, "") + "_CQ" + letters + "QX", item] as const;
  }));
  const inlineSpan = (item: LlmOccurrence) => item.kind === "person-mention" || item.kind === "quantity" && !visible(item);
  const encodeInline = (text: string) => escapeHtml(text).replace(tokenPattern, token => {
    const item = tokens.get(token)!;
    if (visible(item)) return escapeHtml([...financialCodes].find(([, value]) => value.id === item.id)?.[0] ?? item.value);
    return inlineSpan(item) ? '<span class="notranslate" translate="no" id="o' + item.id + '">' + escapeHtml(item.value) + '</span>' : escapeHtml(wire.encode(token));
  });
  const encode = () => prepared.text.split(/\r\n|\r|\n/u).map((text, id) => '<div id="p' + id + '">' + encodeInline(text) + '</div>').join("");
  function decode(html: string): {masked: string; restoration: PreparedTradeText} {
    const paragraphs = [...html.matchAll(/<div\s+id\s*=\s*(["'])p(\d+)\1\s*>([\s\S]*?)<\/div>/giu)];
    if (paragraphs.length !== prepared.paragraphs.length) throw new TranslationQualityError("paragraph_structure_changed");
    let offset = 0;
    for (const [index, match] of paragraphs.entries()) {
      if (html.slice(offset, match.index).trim() || match[2] !== String(index)) throw new TranslationQualityError("paragraph_structure_changed");
      offset = match.index + match[0].length;
    }
    if (html.slice(offset).trim()) throw new TranslationQualityError("paragraph_structure_changed");
    const seen = new Set<number>();
    let masked = paragraphs.map((paragraph, index) => {
      const body = paragraph[3]!; let text = "", cursor = 0;
      const append = (value: string) => {
        if (/[<>]/u.test(value)) throw new TranslationQualityError("paragraph_structure_changed");
        const decoded = decodeLlmTransport(value);
        if (/[<>]|[\r\n]/u.test(decoded)) throw new TranslationQualityError("paragraph_structure_changed");
        text += decoded;
      };
      for (const match of body.matchAll(/<span\b([^>]*)>([^<>]*)<\/span>/giu)) {
        append(body.slice(cursor, match.index)); const attrs = match[1]!;
        const ids = [...attrs.matchAll(/(?:^|\s)id\s*=\s*(["'])o(\d+)\1/giu)];
        if (ids.length !== 1 || [...attrs.matchAll(/(?:^|\s)id\s*=/giu)].length !== 1) throw new TranslationQualityError("exact_occurrence_changed");
        const id = Number(ids[0]![2]), item = prepared.occurrences[id];
        if (ids[0]![2] !== String(id)) throw new TranslationQualityError("exact_occurrence_changed");
        if (!item || !inlineSpan(item) || seen.has(id)) throw new TranslationQualityError("exact_occurrence_changed");
        const sourceParagraph = prepared.paragraphs[index]!;
        if (item.kind === "quantity" && (item.start < sourceParagraph.start || item.end > sourceParagraph.start + sourceParagraph.text.length)) throw new TranslationQualityError("quantity_paragraph_changed");
        if (attrs.replace(/\s*(?:id|class|translate)\s*=\s*(?:"[^"]*"|'[^']*')/giu, "").trim()) throw new TranslationQualityError("exact_occurrence_changed");
        validateValue(item, decodeLlmTransport(match[2]!)); seen.add(id); text += item.token; cursor = match.index + match[0].length;
      }
      append(body.slice(cursor)); return text + prepared.paragraphs[index]!.separator;
    }).join("");
    // Ordinary names and exact literals retain v12's bounded reversible wire. Only native
    // mentions retain inline IDs. Retry money remains visible, with exact suffixes when needed.
    try {masked = wire.decode(masked);} catch {throw new TranslationQualityError("exact_occurrence_changed");}
    masked = normalizeLlmCalendar(prepared.original, masked, prepared.targetLanguage ?? "");
    masked = sourceParagraphs(masked).map((paragraph, index) => {
      let body = paragraph.text;
      for (const [code, item] of financialCodes) {
        if (!body.includes(code)) continue;
        const sourceParagraph = prepared.paragraphs[index]!;
        if (seen.has(item.id) || body.split(code).length !== 2 || item.start < sourceParagraph.start || item.end > sourceParagraph.start + sourceParagraph.text.length) throw new TranslationQualityError("exact_occurrence_changed");
        seen.add(item.id); body = body.replace(code, () => item.token);
      }
      if (/_CQ[A-Za-z]*/u.test(body)) throw new TranslationQualityError("quantity_content_changed");
      const scan = body.replace(tokenPattern, token => " ".repeat(token.length));
      const returned = prepareLlmContext(scan, []).occurrences;
      let rebuilt = "", cursor = 0;
      for (const output of returned) {
        const sourceParagraph = prepared.paragraphs[index]!;
        const candidates = prepared.occurrences.filter(item => visible(item) && !seen.has(item.id) && item.start >= sourceParagraph.start && item.end <= sourceParagraph.start + sourceParagraph.text.length);
        const matches = candidates.filter(item => {try {validateValue(item, output.value); return true;} catch {return false;}});
        if (!matches.length) throw new TranslationQualityError("quantity_unit_or_content_changed");
        const item = matches.find(item => item.role && item.role === output.role) ?? matches[0]!;
        seen.add(item.id); rebuilt += body.slice(cursor, output.start) + item.token; cursor = output.end;
      }
      return rebuilt + body.slice(cursor) + paragraph.separator;
    }).join("");
    for (const item of prepared.occurrences) {
      if (masked.split(item.token).length !== 2) throw new TranslationQualityError("exact_occurrence_changed");
      let index = masked.indexOf(item.token);
      if (item.externalDenominator) {
        const returned = returnedPriceDenominator(masked, index, item.token.length);
        const same = pricingDenominatorKey(returned.value) === pricingDenominatorKey(item.externalDenominator);
        // User-confirmed Chinese rendering of carton; this does not equate English box/carton.
        const acceptedCarton = pricingDenominatorKey(item.externalDenominator) === "carton" && returned.value === "箱";
        if (!same && !acceptedCarton) throw new TranslationQualityError("price_denominator_changed");
        if (prepared.exactQuantities) {
          if (returned.side === "before") {
            masked = masked.slice(0, returned.start) + item.token + masked.slice(index + item.token.length);
          } else {
            masked = masked.slice(0, index + item.token.length) + masked.slice(returned.end);
          }
          index = masked.indexOf(item.token);
        }
      }
      if (item.kind === "person" && /[A-Za-z]/u.test((masked[index - 1] ?? "") + (masked[index + item.token.length] ?? ""))) throw new TranslationQualityError("exact_occurrence_changed");
      if (item.kind === "formula-or-date" || item.kind === "quantity") {
        const neighbors = (text: string, start: number, length: number) => [text.slice(0, start).trimEnd().at(-1) ?? "", text.slice(start + length).trimStart()[0] ?? ""];
        const before = neighbors(prepared.text, prepared.text.indexOf(item.token), item.token.length), after = neighbors(masked, index, item.token.length);
        for (let side = 0; side < 2; side++) {
          if (side === 1 && item.externalDenominator && before[side] === "/" && !/[0-9+＋=＝%％×÷−*\/\-]/u.test(after[side]!)) continue;
          if (/[0-9+＋=＝%％×÷−*/\-]/u.test(before[side]! + after[side]!) && before[side] !== after[side]) throw new TranslationQualityError("exact_occurrence_changed");
        }
      }
    }
    return {masked, restoration: {...prepared, protectedValues: prepared.protectedValues.map(item => ({...item, value: restoredValue(tokens.get(item.token)!, prepared)}))}};
  }
  return {encode, encodeInline, decode};
}
