import {prepareTradeText, type PreparedTradeText, TranslationQualityError} from "./trade-policy.js";

export interface LlmParagraph {id: number; start: number; text: string; separator: string}
export interface LlmOccurrence {
  id: number; token: string; start: number; end: number; value: string; kind: string;
  number?: string; sign?: string; precision?: number; unit?: string; unitGroup?: string;
  currency?: string; denominator?: string; externalDenominator?: string; percent?: string; role?: string;
}
export interface PreparedLlmContext extends PreparedTradeText {
  paragraphs: LlmParagraph[]; occurrences: LlmOccurrence[]; exactQuantities: boolean; targetLanguage?: string;
}
const unitSource = "(?:metric[ \\t]+tons?|kilograms?|pounds?|kgs?|lbs?|MT|CBM|PCS|TEU|FEU|公斤|公噸|磅)(?![A-Za-z])";
const currencySource = "(?:US\\$|NT\\$|HK\\$|S\\$|USD|TWD|NTD|HKD|SGD|EUR|GBP|JPY|CNY|RMB|VND|AUD|CAD|CHF|INR|[$€£¥₹₫])";
const numericSource = "[+\\-−]?\\p{N}+(?:[,.，．]\\p{N}+)*";
const quantityPattern = new RegExp("(?:" + currencySource + "[ \\t]*)?" + numericSource + "[%％]?(?:[ \\t]*" + unitSource + ")?(?:[ \\t]*/[ \\t]*(?:" + unitSource + "|" + currencySource + "))?", "giu");
export function quantityUnitGroup(unit: string): string {
  if (/^(?:kg|kgs|kilograms?|公斤)$/iu.test(unit)) return "kg";
  if (/^(?:MT|metric[ \t]+tons?|公噸)$/iu.test(unit)) return "MT";
  if (/^(?:lb|lbs|pounds?|磅)$/iu.test(unit)) return "lb";
  return unit;
}
function quantityDetails(value: string) {
  const number = value.match(new RegExp(numericSource, "u"))?.[0];
  const unit = value.match(new RegExp(unitSource, "iu"))?.[0];
  return {number, sign: number?.match(/^[+\-−]/u)?.[0] ?? "", precision: number?.includes(".") ? number.split(".").at(-1)!.length : 0,
    unit, unitGroup: unit ? quantityUnitGroup(unit) : undefined,
    currency: value.match(new RegExp(currencySource, "iu"))?.[0],
    denominator: value.match(/\/[ \t]*(.+)$/u)?.[1], percent: value.match(/[%％]/u)?.[0]};
}
// Pricing denominators are separate from weight spelling; unknown names remain exact.
export function pricingDenominatorKey(value: string): string {
  if (/^(?:bags?|袋|袋子)$/iu.test(value)) return "bag";
  if (/^(?:cartons?|紙箱|纸箱)$/iu.test(value)) return "carton";
  if (/^(?:box(?:es)?|箱)$/iu.test(value)) return "box";
  return value;
}
export function externalPricingDenominator(tail: string): string | undefined {
  // An unparsed rate suffix is opaque through its clause boundary, not a guessed unit.
  // This deliberately fails closed when an unknown multiword denominator is paraphrased.
  return tail.match(/^[ \t]*\/[ \t]*([^。；;，,!?\r\n]+?)(?=\.(?:[ \t\r\n]|$)|[。；;，,!?\r\n]|$)/u)?.[1]?.trimEnd();
}
export function isPackagingFallback(paragraph: string, source: string): boolean {
  return /^[ \t]*備案[ \t]*(?:是|為|[:：])/u.test(paragraph) &&
    /(?:FIBC|袋)/iu.test(paragraph) && /小袋方案|包裝方案/u.test(source) &&
    !/登記|註冊|备案登记|備案登記/u.test(paragraph);
}
export function sourceParagraphs(text: string): LlmParagraph[] {
  const result: LlmParagraph[] = []; let start = 0;
  for (const match of text.matchAll(/\r\n|\r|\n/gu)) {
    result.push({id: result.length, start, text: text.slice(start, match.index), separator: match[0]});
    start = match.index + match[0].length;
  }
  result.push({id: result.length, start, text: text.slice(start), separator: ""});
  return result;
}
export function prepareLlmContext(text: string, names: readonly string[], ranges: ReadonlyArray<{start: number; length: number}> = [], targetLanguage?: string): PreparedLlmContext {
  if (ranges.length > 20) throw new TranslationQualityError("invalid_protected_range");
  const original = prepareTradeText(text, names, ranges, true);
  const values = new Map(original.protectedValues.map(item => [item.token, item]));
  const spans: Array<{start: number; end: number; kind: string; value: string}> = [];
  let delta = 0;
  for (const match of original.text.matchAll(new RegExp(original.prefix + "\\d+__", "gu"))) {
    const item = values.get(match[0])!, start = match.index + delta;
    if (!["number", "currency", "unit", "formula-or-date"].includes(item.kind)) spans.push({start, end: start + item.value.length, kind: item.kind, value: item.value});
    delta += item.value.length - match[0].length;
  }
  const collect = (pattern: RegExp, kind: string) => {
    for (const match of text.matchAll(pattern)) {
      const start = match.index, end = start + match[0].length;
      if (!spans.some(span => start < span.end && end > span.start)) spans.push({start, end, kind, value: match[0]});
    }
  };
  collect(/[+\-−]?\d+(?:[,.]\d+)*(?:[ \t]*[+＋=×÷*/−-][ \t]*\d+(?:[,.]\d+)*)+[%％]?/gu, "formula-or-date");
  collect(quantityPattern, "quantity");
  collect(new RegExp(unitSource, "giu"), "unit");
  collect(new RegExp(currencySource, "giu"), "currency");
  collect(/\bFIBC(?=s?\b)/gu, "packaging-code");
  spans.sort((a, b) => a.start - b.start);
  const prepared: PreparedLlmContext = {original: text, text: "", prefix: original.prefix, protectedValues: [], rangeTokens: [],
    occurrences: [], paragraphs: sourceParagraphs(text), exactQuantities: /保持原樣|原樣保留|不要改單位|不(?:要)?(?:更改|改變)單位|copy\s+exactly|do\s+not\s+(?:change|convert)\s+(?:the\s+)?units/iu.test(text), targetLanguage};
  let cursor = 0;
  for (const span of spans) {
    const id = prepared.occurrences.length, token = prepared.prefix + id + "__";
    const details: Partial<LlmOccurrence> = span.kind === "quantity" ? quantityDetails(span.value) : {};
    const externalDenominator = details.currency && !details.denominator ? externalPricingDenominator(text.slice(span.end)) : undefined;
    const before = text.slice(Math.max(0, span.start - 40), span.start).split(/[;；,，.。\r\n]/u).at(-1)!;
    const after = text.slice(span.end, span.end + 35).split(/[;；,，.。\r\n]/u)[0]!;
    const role = /(?:net(?: weight)?|淨重)[ :：]*$/iu.test(before) || /^[ \t]*(?:net\b|淨重)/iu.test(after) ? "net" :
      /(?:gross(?: weight)?|毛重)[ :：]*$/iu.test(before) || /^[ \t]*(?:gross\b|毛重)/iu.test(after) ? "gross" :
      /(?:empty bag|空袋)[^;；,，.。]*$/iu.test(before) ? "empty-bag" :
      /(?:FIBC|bulk bags?|大袋)[^;；,，.。]*$/iu.test(before) || /^[ \t]*(?:FIBC|bulk bags?|大袋)/iu.test(after) ? "bulk-bag" :
      /(?:small|sample|red|blue|小|樣品)[^;；,，.。]*$/iu.test(before) ? "small-or-sample-bag" : undefined;
    prepared.occurrences.push({...span, id, token, ...details, externalDenominator, role});
    prepared.protectedValues.push({token, value: span.value, kind: span.kind});
    if (span.kind === "person-mention") prepared.rangeTokens.push({token, sourceStart: span.start});
    prepared.text += text.slice(cursor, span.start) + token; cursor = span.end;
  }
  prepared.text += text.slice(cursor);
  // Resolve an explicitly named alternative packaging plan before translation.
  prepared.text = prepared.text.split(/\r\n|\r|\n/u).map((paragraph, index) =>
    (isPackagingFallback(prepared.paragraphs[index]!.text, text) ? paragraph.replace(/^([ \t]*)備案/u, "$1替代方案") : paragraph) + prepared.paragraphs[index]!.separator).join("");
  const first = prepared.occurrences[0];
  if (targetLanguage === "zh-TW" && first?.kind === "person") prepared.text = prepared.text.replace(new RegExp("^(\\s*" + first.token + ")[ \t]+(?:brother|bro)(?=\\s*[,，:：])", "iu"), "$1");
  return prepared;
}
