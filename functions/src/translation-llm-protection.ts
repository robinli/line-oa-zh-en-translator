import {randomBytes} from "node:crypto";
import {prepareTradeText, TranslationQualityError, type PreparedTradeText} from "./trade-policy.js";

export function prepareTranslationLlmText(text: string, names: readonly string[],
  ranges: ReadonlyArray<{start: number; length: number}> = [], targetLanguage?: string): PreparedTradeText {
  const original = prepareTradeText(text, names, ranges, true);
  const values = new Map(original.protectedValues.map(item => [item.token, item]));
  const spans: Array<{start: number; end: number; kind: string; value: string}> = [];
  let delta = 0;
  for (const match of original.text.matchAll(new RegExp(original.prefix + "\\d+__", "gu"))) {
    const item = values.get(match[0])!;
    const start = match.index + delta;
    spans.push({start, end: start + item.value.length, kind: item.kind, value: item.value});
    delta += item.value.length - match[0].length;
  }
  const financial = new Set(["currency", "number", "unit", "trade-term", "formula-or-date", "quantity"]);
  const groups: typeof spans = [];
  for (const span of spans) {
    const previous = groups.at(-1);
    // Preserve the entire adjacent quotation/quantity. Never merge across commas or clauses.
    if (previous && financial.has(previous.kind) && financial.has(span.kind) &&
        /^[ \t/]*$/u.test(text.slice(previous.end, span.start))) {
      previous.end = span.end;
      previous.value = text.slice(previous.start, span.end);
      previous.kind = "quantity";
    } else {
      groups.push({...span});
    }
  }
  const prepared: PreparedTradeText = {original: text, text: "", prefix: original.prefix,
    protectedValues: [], rangeTokens: []};
  let cursor = 0;
  for (const span of groups) {
    const token = prepared.prefix + prepared.protectedValues.length + "__";
    prepared.protectedValues.push({token, kind: span.kind, value: span.value});
    if (span.kind === "person-mention") prepared.rangeTokens.push({token, sourceStart: span.start});
    prepared.text += text.slice(cursor, span.start) + token;
    cursor = span.end;
  }
  prepared.text += text.slice(cursor);
  if (targetLanguage === "zh-TW") {
    const first = prepared.protectedValues[0];
    if (first?.kind === "person") {
      prepared.text = prepared.text.replace(new RegExp("^(\\s*" + first.token + ")[ \t]+(?:brother|bro)(?=\\s*[,，:：])", "iu"), "$1");
    }
  }
  return prepared;
}
function alphabetic(value: number): string {
  return String.fromCharCode(65 + Math.floor(value / 676), 65 + Math.floor(value / 26) % 26, 65 + value % 26);
}
export function createLlmWireText(prepared: PreparedTradeText, maskNames = false) {
  let prefix: string;
  do {
    prefix = [...randomBytes(3)].map(value => String.fromCharCode(65 + value % 26)).join("");
  } while (prepared.original.includes(prefix));
  const currencyPrefixes: Array<[RegExp, string]> = [
    [/^(?:USD|US\$)/iu, "US$"], [/^\$/u, "$"], [/^(?:EUR|€)/iu, "€"], [/^(?:GBP|£)/iu, "£"],
    [/^(?:TWD|NTD|NT\$)/iu, "NT$"], [/^(?:HKD|HK\$)/iu, "HK$"],
    [/^(?:SGD|S\$)/iu, "S$"], [/^(?:AUD)/iu, "A$"], [/^(?:CAD)/iu, "C$"],
    [/^(?:JPY|CNY|RMB|¥)/iu, "¥"], [/^(?:VND|₫)/iu, "₫"], [/^(?:INR|₹)/iu, "₹"], [/^CHF/iu, "CHF$"],
  ];
  const markerType = (item: PreparedTradeText["protectedValues"][number]) => {
    if (item.kind === "person-mention") return "@";
    if (item.kind === "person") return item.value + "_";
    if (item.kind === "formula-or-date") return "Formula";
    if (item.kind === "quantity" && /\p{N}/u.test(item.value)) {
      const currency = currencyPrefixes.find(([pattern]) => pattern.test(item.value));
      if (currency) return currency[1];
      return "Quantity";
    }
    if (item.kind === "contact") return item.value.startsWith("http") ? "https://" : "mail";
    if (item.kind === "product-code") return "CODE-";
    return "Value";
  };
  const literalFormula = (item: PreparedTradeText["protectedValues"][number]) =>
    item.kind === "formula-or-date" && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/u.test(item.value) && !/[\r\n]/u.test(item.value);
  const entries = prepared.protectedValues.map((item, index) => ({item,
    wire: literalFormula(item) || (item.kind === "person" && !maskNames) ? item.value : markerType(item) + prefix + alphabetic(index) + "QX" +
      (item.kind === "contact" ? (item.value.startsWith("http") ? ".invalid" : "@example.invalid") : "")}));
  const reverse = new Map(entries.map(({wire, item}) => [item.token, wire]));
  const aliases = new Map<string, typeof prepared.protectedValues>();
  const formulaAliases = new Map<string, typeof prepared.protectedValues>();
  const formulaPatterns = new Map<string, string>();
  const canonicalFormula = (value: string) => value.replace(/[ \t]/gu, "");
  const escape = (value: string) => value.replace(/[.*+?^$()|[\]\\]/gu, "\\$&");
  for (const {wire, item} of entries) {
    if (literalFormula(item)) {
      const key = canonicalFormula(wire);
      formulaAliases.set(key, [...formulaAliases.get(key) ?? [], item]);
      const parts = wire.match(/\d+(?:[,.]\d+)*|[+＋=×÷*/−-]/gu);
      if (!parts || parts.join("") !== key) throw new TranslationQualityError("protected_value_changed");
      formulaPatterns.set(key, parts.map(escape).join("[ \\t]*"));
    }
    const variants = [wire];
    if (wire.startsWith("Quantity") && !literalFormula(item)) {
      const id = wire.slice("Quantity".length);
      variants.push("數量 " + id, "數量" + id, "数量 " + id, "数量" + id);
    }
    for (const variant of variants) aliases.set(variant, [...aliases.get(variant) ?? [], item]);
  }
  const encode = (text: string) => text.replace(new RegExp(prepared.prefix + "\\d+__", "gu"), token => reverse.get(token)!);
  const alternatives = [...aliases.keys()].filter(key => !formulaPatterns.has(canonicalFormula(key)))
    .map(key => ({length: key.length, pattern: escape(key)}));
  alternatives.push(...[...formulaPatterns].map(([key, pattern]) => ({length: key.length, pattern})));
  const pattern = new RegExp(alternatives.sort((a, b) => b.length - a.length).map(item => item.pattern).join("|") || "(?!)", "gu");
  const decode = (text: string) => {
    const seen = new Map<string, number>();
    const decoded = text.replace(pattern, (marker, offset: number) => {
      const formulaKey = canonicalFormula(marker);
      const isFormula = formulaAliases.has(formulaKey);
      const candidates = isFormula ? formulaAliases.get(formulaKey)! : aliases.get(marker)!;
      const seenKey = isFormula ? "formula:" + formulaKey : marker;
      const count = seen.get(seenKey) ?? 0;
      const item = candidates[count];
      if (!item) throw new TranslationQualityError("protected_value_changed");
      if (item.kind === "person" && /[A-Za-z]/u.test((text[offset - 1] ?? "") + (text[offset + marker.length] ?? ""))) {
        throw new TranslationQualityError("protected_value_changed");
      }
      if (literalFormula(item)) {
        const position = prepared.text.indexOf(item.token);
        const neighbors = (value: string, start: number, length: number) => [
          value.slice(0, start).replace(/[ \t]+$/u, "").at(-1) ?? "",
          value.slice(start + length).replace(/^[ \t]+/u, "")[0] ?? "",
        ];
        const originalNeighbors = neighbors(prepared.text, position, item.token.length);
        const outputNeighbors = neighbors(text, offset, marker.length);
        for (let side = 0; side < 2; side++) {
          const original = originalNeighbors[side]!, output = outputNeighbors[side]!;
          if (/[0-9+＋=＝%％×÷−*/\-]/u.test(original + output) && original !== output) {
            throw new TranslationQualityError("protected_value_changed");
          }
        }
      }
      seen.set(seenKey, count + 1);
      return item.token;
    });
    if (decoded.replace(new RegExp(prepared.prefix + "\\d+__", "gu"), "").includes(prefix)) throw new TranslationQualityError("protected_value_changed");
    return decoded;
  };
  return {encode, decode};
}

// Narrow omission/strengthening guards; these do not claim full semantic validation.
export function validateLlmMeaning(source: string, target: string, targetLanguage: string, names: readonly string[] = [], amounts: readonly string[] = []): void {
  if (targetLanguage === "en" && /客戶(?:的)?業務負責人/u.test(source) &&
      !/\baccount\s+owner\b|\b(?:person|individual)\s+(?:responsible\s+for|in\s+charge\s+of)\s+(?:(?:this|the|that)\s+)?(?:client|customer|account)\b/iu.test(target)) {
    throw new TranslationQualityError("customer_role_changed");
  }
  if (targetLanguage === "en" && names.length) {
    const escape = (value: string) => value.replace(/[.*+?^$()|[\]\\]/gu, "\\$&");
    const choices = [...new Set(names)].sort((a, b) => b.length - a.length).map(escape).join("|");
    const requests = new RegExp("(" + choices + ")(?![A-Za-z])[ \t]*(?:可以|能夠|可|能)[ \t]*請[ \t]*(" + choices + ")(?![A-Za-z])", "gu");
    for (const request of source.matchAll(requests)) {
      const passive = new RegExp(escape(request[1]!) + "\\s+(?:can|could|may|might)\\s+(?:also\\s+)?(?:ask\\s+)?be\\s+(?:reviewed|checked|verified|approved|confirmed)\\s+by\\s+" + escape(request[2]!) + "(?![A-Za-z])", "iu");
      if (passive.test(target)) throw new TranslationQualityError("actor_role_changed");
    }
  }
  const quotePattern = (value: string) => value.replace(/[.*+?^$()|[\]\\]/gu, "\\$&");
  for (const amount of amounts) {
    if (!/[$€£¥₹₫]|\b(?:USD|EUR|GBP|TWD|NTD|HKD|SGD|AUD|CAD|JPY|CNY|RMB|VND|INR|CHF)\b/iu.test(amount)) continue;
    const escaped = quotePattern(amount);
    if (targetLanguage === "en" && new RegExp(escaped + "\\s*(?:還|尚|仍)?(?:不含|未含|不包含|未包含)\\s*運費", "u").test(source) &&
        new RegExp(escaped + "\\s+(?:freight|shipping\\s+(?:costs?|charges?))\\b", "iu").test(target)) {
      throw new TranslationQualityError("freight_inclusion_changed");
    }
    if (targetLanguage === "zh-TW" && new RegExp("\\bAt\\s+" + escaped, "iu").test(source) &&
        new RegExp("在\\s*" + escaped + "\\s*處", "u").test(target)) {
      throw new TranslationQualityError("price_location_changed");
    }
  }
  // These guards reject observed scope changes; they never rewrite a disputed fact.
  if (targetLanguage === "en" && /[「“"]只回答[^」”"\r\n]+[」”"]/u.test(source) &&
      /\b(?:respond|reply|answer)\s+only\s+to\b/iu.test(target)) {
    throw new TranslationQualityError("quoted_response_scope_changed");
  }
  if (targetLanguage !== "zh-TW") return;
  // "Without doing X" restricts the action; "not required to do X" does not.
  // Match bounded operation clauses so an unrelated no-obligation clause remains valid.
  for (const clause of source.matchAll(/\bwithout\s+([^.,;!?\r\n]+?)(?=\b(?:but|although|whereas)\b|[.,;!?\r\n]|$)/giu)) {
    const actions = [
      {en: /\b(?:calculating|computing)\b/iu, zh: "(?:計算|運算)"},
      {en: /\b(?:changing|altering|modifying)\b/iu, zh: "(?:變更|更改|改動|修改)"},
      {en: /\bconverting\b/iu, zh: "(?:換算|轉換)"},
    ];
    for (const action of actions) {
      if (action.en.test(clause[1]!) && new RegExp("(?:無需|無須|不必|不需要|不用|毋須)(?:進行|再|去)?" + action.zh, "u").test(target)) {
        throw new TranslationQualityError("action_restriction_weakened");
      }
    }
  }

  if (/\bgoods\s+(?:(?:were|are|have\s+been|had\s+been)\s+)?received\b/iu.test(source) &&
      !/\b(?:deliver(?:y|ed)?|arriv(?:e|ed|al)|ship(?:ped|ment)?|sen[dt])\b/iu.test(source) && /(?:貨物|貨品|貨件|貨)\s*(?:已經|已)?送達/u.test(target)) {
    throw new TranslationQualityError("receipt_delivery_changed");
  }
  // Preserve uncertainty: permission/entitlement must be explicit in the source.
  if (/\b(?:may|might|could)\s+cancel\b/iu.test(source) &&
      !/\b(?:right|entitled|permitted|allowed|authorized|authorised)\b/iu.test(source) && /有權|有權利|獲准|獲授權/u.test(target)) {
    throw new TranslationQualityError("unjustified_cancellation_right");
  }
  if (/\b(?:offered|proposed|quoted)\s+neither\s+(?:amount|price)\b/iu.test(source) && /未達|低於|高於|超過/u.test(target)) {
    throw new TranslationQualityError("unjustified_price_comparison");
  }
  if (/\bnot (?:required|obliged|obligated) to\b/iu.test(source) &&
      !/無需|無須|不必|不需要|不須|毋須|不用|沒有必要|無義務|沒有義務/u.test(target)) {
    throw new TranslationQualityError("negative_obligation_lost");
  }
  if (/\bcan\b/iu.test(source) && !/\b(?:should not|shouldn't|must not|mustn't|ought not|cannot|can't)\b/iu.test(source) &&
      /不應|不該|不可以/u.test(target)) {
    throw new TranslationQualityError("unjustified_obligation");
  }
}


// Real plain-text API responses can still escape punctuation. Decode transport once,
// before restoring protected source values, so literal source entities are never decoded.
export function decodeLlmTransport(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/giu, entity => {
    const known: Record<string, string> = {"&amp;": "&", "&lt;": "<", "&gt;": ">",
      "&quot;": '"', "&apos;": "'", "&nbsp;": "\u00a0"};
    if (known[entity.toLowerCase()]) return known[entity.toLowerCase()]!;
    const hex = entity[2]?.toLowerCase() === "x";
    const value = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    if (!Number.isSafeInteger(value) || value <= 0 || value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff)) throw new TranslationQualityError("invalid_response_format");
    return String.fromCodePoint(value);
  });
}

// Arabic month digits are legitimate translations of explicit English calendar names.
// Normalize these to Chinese month names before the no-new-numbers check; never convert prices.
export function normalizeLlmCalendar(source: string, target: string, language: string): string {
  if (language !== "zh-TW") return target;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const chinese = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
  let result = target;
  for (const [i, month] of months.entries()) {
    const calendarContext = new RegExp("\\b(?:in|by|before|after|until|during|this|next|last|early|late|since|from|through|of)\\s+" + month + "\\b|\\b" + month + "\\s+\\d", "iu");
    if (calendarContext.test(source)) result = result.replace(new RegExp("(?<![0-9])" + (i + 1) + "[ \t]*月", "gu"), chinese[i] + "月");
  }
  return result;
}


// Standard glossaries replace terms after translation and can leave local agreement artifacts.
// Apply only to the model body; protected source strings are restored afterwards.
export function normalizeLlmGlossaryGrammar(text: string, language: string): string {
  if (language === "zh-TW") return text.replaceAll("客戶業務負責人人", "客戶業務負責人");
  return text.replace(/\bfreight are\b/giu, match => match.slice(0, -3) + "is")
    .replace(/\bno commitment yet yet\b/giu, "no commitment yet")
    .replace(/\bno commitment yet to ship yet\b/giu, "no commitment to ship yet");
}
