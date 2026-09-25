import {validateNmtTradeRelations} from "./nmt-trade-relations.js";
import {validateNmtUnavailableFallback, validateNmtEllipticalFeasibility, validateNmtProhibitions, validateNmtRejectConditions, validateNmtNamedRequests} from "./nmt-relations.js";
import {llmMentionHasExplicitStatus} from "./nmt-subjects.js";
import {TranslationQualityError} from "./trade-policy.js";
import {isPackagingFallback, sourceParagraphs, type PreparedLlmContext} from "./nmt-context.js";
const escape = (text: string) => text.replace(/[.*+?^$()|[\]\\]/gu, "\\$&");
// These finite guards compare explicit relations. They do not infer new packaging facts.
export function validateContextLlmMeaning(prepared: PreparedLlmContext, masked: string, result: string, targetLanguage: string): void {
  const source = prepared.original;
  validateNmtTradeRelations(prepared, result);
  const expandCodes = (text: string) => text.replace(new RegExp(prepared.prefix + "\\d+__", "gu"), token => {
    const item = prepared.occurrences.find(v => v.token === token)!;
    return item.kind === "packaging-code" ? item.value : token;
  });
  const sourceMasked = expandCodes(prepared.text), targetMasked = expandCodes(masked);
  const tokenPattern = new RegExp(prepared.prefix + "\\d+__", "gu");
  // Objects belong to a native occurrence, independently of display name or clause order.
  const mentionObjects = (text: string, token: string) => {
    const tail = text.slice(text.indexOf(token) + token.length).replace(/^[ \t,，]+/u, "").split(/[。；;，,!?！？\r\n]|(?<!\d)\.(?!\d)/u)[0]!;
    const nextMention = prepared.rangeTokens.map(v => tail.indexOf(v.token)).filter(index => index >= 0);
    const clause = nextMention.length ? tail.slice(0, Math.min(...nextMention)) : tail;
    return prepared.occurrences.filter(v => v.kind === "quantity" && clause.includes(v.token))
      .map(v => JSON.stringify([v.number, v.unitGroup, v.currency, v.denominator, v.externalDenominator])).sort();
  };
  for (const {token} of prepared.rangeTokens) {
    const tail = sourceMasked.slice(sourceMasked.indexOf(token) + token.length);
    if (!llmMentionHasExplicitStatus(tail, targetLanguage === "zh-TW" ? "en" : "zh-TW")) continue;
    if (JSON.stringify(mentionObjects(sourceMasked, token)) !== JSON.stringify(mentionObjects(targetMasked, token))) throw new TranslationQualityError("mention_quantity_changed");
  }
  function context(text: string, token: string) {
    const index = text.indexOf(token), before = text.slice(0, index), after = text.slice(index + token.length);
    const previous = before.split(/[。；;，,!?！？\r\n]|(?<!\d)\.(?!\d)/u);
    let left = previous.at(-1)!;
    if (!left.trim() && previous.length > 1 && !new RegExp(tokenPattern.source, "u").test(previous.at(-2)!)) left = previous.at(-2)!;
    const right = after.split(/[。；;，,!?！？\r\n]|(?<!\d)\.(?!\d)/u)[0]!;
    return {left: left.split(tokenPattern).at(-1)!.slice(-90), right: right.split(tokenPattern)[0]!.slice(0, 90)};
  }
  function roles(text: string, token: string) {
    const {left, right} = context(text, token);
    const out = new Set<string>();
    if (/(?:net(?: weight)?|淨重)(?:[ \t]+(?:is|of))?[ :：]*$/iu.test(left) || /^[ \t]*(?:net\b|淨重)/iu.test(right)) out.add("net");
    if (/(?:gross(?: weight)?|毛重)(?:[ \t]+(?:is|of))?[ :：]*$/iu.test(left) || /^[ \t]*(?:gross\b|毛重)/iu.test(right)) out.add("gross");
    if (/empty\s+bag|空袋/iu.test(left + right)) out.add("empty");
    if (/\bFIBC(?:s)?\b/iu.test(left + right)) out.add("fibc");
    if (/\b(?:small|sample)\s+bags?|小袋|樣品袋/iu.test(left + right)) out.add("small");
    if (/\bred\b|紅(?:色)?/iu.test(left + right)) out.add("red");
    if (/\bblue\b|藍(?:色)?/iu.test(left + right)) out.add("blue");
    return out;
  }
  for (const item of prepared.occurrences.filter(v => v.kind === "quantity" && v.unitGroup)) {
    const tail = targetMasked.slice(targetMasked.indexOf(item.token) + item.token.length);
    if (/^[ \t]*(?:個|數量[的之]?)[ \t]*(?:袋|包)|^[ \t]*(?:bags?\s+in\s+number|number\s+of\s+bags?)/iu.test(tail)) throw new TranslationQualityError("quantity_relationship_changed");
    const original = roles(sourceMasked, item.token), translated = roles(targetMasked, item.token);
    for (const [a, b] of [["net", "gross"], ["red", "blue"], ["empty", "net"]] as const) {
      if (original.has(a) && !original.has(b) && translated.has(b) && !translated.has(a) || original.has(b) && !original.has(a) && translated.has(a) && !translated.has(b)) throw new TranslationQualityError("quantity_relationship_changed");
    }
    if (!original.has("fibc") && translated.has("fibc") && prepared.occurrences.some(v => v.kind === "packaging-code")) throw new TranslationQualityError("quantity_relationship_changed");
  }
  const priceLabels = [
    {role: "cost", label: "(?:cost\\s+price|成本價)"},
    {role: "factory", label: "(?:ex[ -]factory(?:\\s+price)?|出廠價)"},
    {role: "floor", label: "(?:floor\\s+price|底價)"},
    {role: "quote", label: "(?:quoted\\s+price|報價)"},
  ];
  const priceRoles = (text: string, token: string) => {
    const {left, right} = context(text, token);
    return priceLabels.filter(({label}) => new RegExp(label + "(?:\\s+(?:is|of|at)|為)?[ :：]*$", "iu").test(left) || new RegExp("^[ \\t]*(?:的|為|is[ \\t]+)?" + label, "iu").test(right)).map(v => v.role);
  };
  for (const item of prepared.occurrences.filter(v => v.kind === "quantity" && v.currency)) {
    const original = priceRoles(sourceMasked, item.token), translated = priceRoles(targetMasked, item.token);
    if (original.length === 1 && translated.length === 1 && original[0] !== translated[0]) throw new TranslationQualityError("price_relationship_changed");
  }
  if (targetLanguage === "zh-TW") {
    if (/\bCNF\b|\bCFR\b/iu.test(source) && !/\b(?:tax|dut(?:y|ies))\b/iu.test(source) && /含稅|已含稅|稅費已包含/u.test(result)) throw new TranslationQualityError("unjustified_tax_inclusion");
    if (/\b(?:have|has)\s+not\s+confirmed\s+availability\s+or\s+promised/iu.test(source) && (!/(?:尚未|還未|未|沒有|還沒)[^。；;]{0,12}確認/u.test(result) || !/(?:尚未|還未|未|沒有|還沒)[^。；;]{0,12}承諾/u.test(result))) throw new TranslationQualityError("packaging_commitment_changed");
    for (const [en, zh] of [["red", "紅"], ["blue", "藍"]]) {
      if (new RegExp("\\bOnly\\s+the\\s+" + en + "\\s+bag\\s+needs?\\s+a\\s+label", "iu").test(source) && !new RegExp("(?:只有|僅有|僅|唯有)" + zh + "(?:色)?(?:的)?袋", "u").test(result)) throw new TranslationQualityError("quantity_relationship_changed");
    }
    validateNmtProhibitions(source, result);
    validateNmtUnavailableFallback(source, result);
    if (/\bFIBC(?:\s+bulk)?\s+bags?\b/iu.test(source) && /(?:FIBC[ \t]*(?:貨櫃|集裝箱|集装箱|容器)(?!袋)|(?:貨櫃|集裝箱|集装箱|容器)[ \t]*FIBC)/iu.test(result)) throw new TranslationQualityError("packaging_object_changed");
    validateNmtRejectConditions(prepared, sourceMasked, targetMasked);
    validateNmtNamedRequests(source, result, prepared.protectedValues.filter(item => item.kind === "person").map(item => item.value));
    if (/\bif\s+(?:these\s+are\s+)?(?:unavailable|can['’]t|cannot|not\s+possible)/iu.test(source) && /FIBC/iu.test(source) && !/(?:若|如果|如|倘若).{0,30}(?:無法|不能|做不到|不可行|無貨|無法供應|不可得|沒有|無法提供|無法取得|買不到|買不著|缺貨)/u.test(result)) throw new TranslationQualityError("packaging_condition_changed");
    if (/\b(?:empty\s+bag)[^.!?\r\n]*[.;][^.!?\r\n]*not\s+included\s+in\s+the\s+net\s+weight/iu.test(source) && !/(?:不|未)(?:計入|包括|包含|含|算入|納入).{0,10}淨重/u.test(result)) throw new TranslationQualityError("quantity_relationship_changed");
    if (/\b(?:packing|packaging)\s+charge[^.!?\r\n]*\bnot\s+freight/iu.test(source) && !/(?:不是|並非|非|而非|不屬於)\s*運費/u.test(result)) throw new TranslationQualityError("packing_charge_changed");
  } else if (targetLanguage === "en") {
    for (const paragraph of prepared.paragraphs) {
      if (!isPackagingFallback(paragraph.text, source)) continue;
      const translated = sourceParagraphs(result)[paragraph.id]?.text ?? "";
      if (!/\b(?:alternative|fallback|back[ -]?up)(?:\s+(?:plan|option))?\b/iu.test(translated) || /\b(?:registered|registration)\b/iu.test(translated)) throw new TranslationQualityError("packaging_fallback_changed");
    }
    for (const [zh, en] of [["買方", "buyer"], ["賣方", "seller"]] as const) {
      if (new RegExp("運費由" + zh + "(?:另付|支付|負擔)", "u").test(source)) {
        const payer = new RegExp("(?:freight|shipping(?:\\s+(?:fee|cost|charge))?)[^.;\\r\\n]{0,90}(?:paid|borne|covered|payable)(?:\\s+separately)?\\s+by\\s+(?:the\\s+)?" + en + "\\b|\\b(?:the\\s+)?" + en + "\\s+(?:(?:must|will|shall|has\\s+to)\\s+)?(?:pay(?:s)?|cover(?:s)?|bear(?:s)?)[^.;\\r\\n]{0,45}(?:freight|shipping)", "iu");
        if (!payer.test(result)) throw new TranslationQualityError("freight_payer_changed");
      }
    }
    if (/若做不到|如果做不到/u.test(source) && !validateNmtEllipticalFeasibility(prepared, sourceMasked, targetMasked) && !/\bif\b[^.;\r\n]*(?:not\s+possible|cannot|can['’]t|unavailable|unable|not\s+feasible)/iu.test(result)) throw new TranslationQualityError("packaging_condition_changed");
    if (/若客戶同意|如果客戶同意/u.test(source) && !/\bif\b[^.;\r\n]*(?:buyer|customer|client)\s+(?:agrees?|consents?|approves?)/iu.test(result)) throw new TranslationQualityError("packaging_condition_changed");
  }
}
