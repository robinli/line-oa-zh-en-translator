import {llmMentionHasExplicitStatus} from "./translation-llm-subjects.js";
import {TranslationQualityError} from "./trade-policy.js";
import {isPackagingFallback, sourceParagraphs, type PreparedLlmContext} from "./translation-llm-context.js";
const escape = (text: string) => text.replace(/[.*+?^$()|[\]\\]/gu, "\\$&");
const operations = [
  {en: "(?:calculate|compute|calculating|computing)", zh: "(?:計算|運算)"},
  {en: "(?:convert|converting)", zh: "(?:換算|轉換)"},
  {en: "(?:change|alter|modify|changing|altering|modifying)", zh: "(?:變更|更改|改動|修改|改變|改為|改成|改)"},
];
// These finite guards compare explicit relations. They do not infer new packaging facts.
export function validateContextLlmMeaning(prepared: PreparedLlmContext, masked: string, result: string, targetLanguage: string): void {
  const source = prepared.original;
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
    for (const action of operations) {
      const prohibited = new RegExp("\\b(?:do\\s+not|don['’]t|must\\s+not)\\s+" + action.en + "\\b", "iu");
      if (!prohibited.test(source)) continue;
      // Compare the translated action itself; an unrelated no-obligation clause is allowed.
      const bridge = "(?:進行|再|去|自行|擅自|任意|重新)?(?:(?:把|將)[^。；;，,!?！？\\r\\n]{1,60}?)?(?:單位|袋數|算式|公式|幣別|貨幣)?";
      const preserved = new RegExp("(?:不要|不得|請勿|勿|不可|不可以|禁止|不)" + bridge + action.zh, "u");
      const sourceClause = source.match(new RegExp("\\b(?:do\\s+not|don['’]t|must\\s+not)\\s+" + action.en + "\\b([^.;!?\\r\\n]*)(?:[.;!?]|$)", "iu"))?.[1] ?? "";
      const objects = [
        {en: /number\s+of\s+bags|bag\s+count/iu, zh: /袋數|袋子?的?數量/u},
        {en: /formula|expression/iu, zh: /算式|公式/u},
        {en: /units?/iu, zh: /單位/u},
        {en: /currenc/iu, zh: /幣別|貨幣/u},
      ];
      const object = objects.find(item => item.en.test(sourceClause));
      const candidates = object ? result.split(/[。；;，,!?！？\r\n]/u).filter(clause => object.zh.test(clause)).join("；") : result;
      const deniedRestriction = new RegExp("(?:不是|並非|不)(?:禁止|不得|不可|不可以)" + bridge + action.zh, "u");
      if (!preserved.test(candidates) || deniedRestriction.test(candidates)) throw new TranslationQualityError("action_restriction_weakened");
    }
    const onlyIf = source.match(/\b(?:only\s+if|only\s+when)\b([^.!?\r\n]*?)\breject(?:s|ed)?\b/iu);
    if (onlyIf) {
      const sourceNegative = /(?:\bnot|\bnever|n['’]t)\s*$/iu.test(onlyIf[1]!);
      const conditions = result.split(/[。；;!?！？\r\n]/u).filter(clause => /只有|僅當|僅在|唯有|僅限|才/u.test(clause));
      const negativeRejection = /(?:不|未|沒|沒有|並非|尚未)[ \t]*(?:(?:會|再|曾|曾經|願意|予以)[ \t]*)?(?:拒絕|拒收)|(?:並非|不是|沒有)[ \t]*不接受/u;
      const preservedCondition = conditions.some(clause => /(?:拒絕|拒收|不接受)/u.test(clause) && negativeRejection.test(clause) === sourceNegative);
      if (!preservedCondition || /\botherwise\b/iu.test(source) && !/否則|不然/u.test(result)) throw new TranslationQualityError("packaging_condition_changed");
    }
    if (/\bif\s+(?:these\s+are\s+)?(?:unavailable|can['’]t|cannot|not\s+possible)/iu.test(source) && /FIBC/iu.test(source) && !/(?:若|如果|如|倘若).{0,30}(?:無法|不能|做不到|不可行|無貨|無法供應|不可得|沒有|無法提供|無法取得)/u.test(result)) throw new TranslationQualityError("packaging_condition_changed");
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
    if (/若做不到|如果做不到/u.test(source) && !/\bif\b[^.;\r\n]*(?:not\s+possible|cannot|can['’]t|unavailable|unable|not\s+feasible)/iu.test(result)) throw new TranslationQualityError("packaging_condition_changed");
    if (/若客戶同意|如果客戶同意/u.test(source) && !/\bif\b[^.;\r\n]*(?:buyer|customer|client)\s+(?:agrees?|consents?|approves?)/iu.test(result)) throw new TranslationQualityError("packaging_condition_changed");
  }
}
