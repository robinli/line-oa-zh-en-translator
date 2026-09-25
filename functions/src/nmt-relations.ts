import {TranslationQualityError} from "./trade-policy.js";
import type {PreparedLlmContext} from "./nmt-context.js";
const escape = (value: string) => value.replace(/[.*+?^$()|[\]\\]/gu, "\\$&");
const actions = [
  {en: "(?:calculate|compute|calculating|computing)", zh: "(?:計算|運算)"},
  {en: "(?:convert|converting)", zh: "(?:換算|轉換)"},
  {en: "(?:change|alter|modify|changing|altering|modifying)", zh: "(?:變更|更改|改動|修改|改變|改為|改成|改)"},
];
const objects = [
  {key: "bag-count", en: /number\s+of\s+bags|bag\s+count/iu, zh: /袋數|袋子?的?數量/u},
  {key: "formula", en: /formula|expression/iu, zh: /算式|公式/u},
  {key: "units", en: /\bunits?\b/iu, zh: /單位/u},
  {key: "currency", en: /currenc/iu, zh: /幣別|貨幣/u},
];
// One-to-one bounded clauses prevent an intact first prohibition validating a later reversal.
export function validateNmtProhibitions(source: string, target: string): void {
  for (const action of actions) {
    const pattern = new RegExp("\\b(?:do\\s+not|don['’]t|must\\s+not)\\s+" + action.en + "\\b([^.;!?\\r\\n]*?)(?=\\b(?:and|but)\\s+(?:do\\s+not|don['’]t|must\\s+not)\\b|[.;!?\\r\\n]|$)", "giu");
    const originals = [...source.matchAll(pattern)].flatMap(match => {
      const found = objects.filter(item => item.en.test(match[1]!)).map(item => item.key);
      return found.length ? found : ["unknown"];
    });
    if (!originals.length) continue;
    const bridge = "(?:進行|再|去|自行|擅自|任意|重新)?(?:(?:把|將)[^。；;，,!?！？\\r\\n]{1,60}?)?(?:單位|袋數|算式|公式|幣別|貨幣)?";
    const preserved = new RegExp("(?:不要|不得|請勿|勿|不可|不可以|禁止|不|(?:^|[ \t]|也|請|都|千萬|務必|切記|記得)別)" + bridge + action.zh, "u");
    const denied = new RegExp("(?:(?:不是|並非|不)(?:禁止|不得|不可|不可以)|(?:不是|並非)(?:(?:要|叫|請)(?:你|您)?)?(?:也|請|都)?別)" + bridge + action.zh, "u");
    const candidates = target.split(/[。；;，,!?！？\r\n]|(?:而且|並且|但是|但|且)/u).flatMap(clause => {
      if (!preserved.test(clause) || denied.test(clause)) return [];
      const found = objects.filter(item => item.zh.test(clause)).map(item => item.key);
      return found.length ? found : ["unknown"];
    });
    for (const object of originals.sort((a,b) => Number(a === "unknown") - Number(b === "unknown"))) {
      const index = object === "unknown" ? candidates.length - 1 : candidates.indexOf(object);
      if (index < 0) throw new TranslationQualityError("action_restriction_weakened");
      candidates.splice(index, 1);
    }
  }
}
function packagingSignature(text: string, prepared: PreparedLlmContext): string {
  const attributes: string[] = [];
  for (const [key,pattern] of [
    ["red", /\bred\b|紅(?:色)?/iu], ["blue", /\bblue\b|藍(?:色)?/iu],
    ["green", /\bgreen\b|綠(?:色)?/iu], ["yellow", /\byellow\b|黃(?:色)?/iu],
    ["small", /\bsmall\b|小袋/iu], ["large", /\b(?:large|bulk)\b|大袋/iu], ["fibc", /\bFIBCs?\b/iu],
  ] as const) if (pattern.test(text)) attributes.push(key);
  if (attributes.includes("fibc") && attributes.includes("large")) attributes.splice(attributes.indexOf("large"), 1);
  for (const item of prepared.occurrences) if (item.kind === "quantity" && item.unitGroup && text.includes(item.token)) attributes.push(JSON.stringify([item.number,item.unitGroup]));
  return JSON.stringify(attributes.sort());
}
const actor = (text: string) => /\bbuyer\b|買方/iu.test(text) ? "buyer" : /\bseller\b|賣方/iu.test(text) ? "seller" : /\b(?:customer|client)\b|客戶/iu.test(text) ? "customer" : "";
// Explicit only-if reject relations: selected and rejected objects travel as a pair.
export function validateNmtRejectConditions(prepared: PreparedLlmContext, source: string, target: string): void {
  const originals: string[] = [];
  for (const clause of source.split(/[;!?\r\n]|(?<!\d)\.(?!\d)|\band\s+(?=(?:use|keep|retain)\b)/iu)) {
    const match = clause.match(/^(.*?)\bonly\s+(?:if|when)\b(.*?)\breject(?:s|ed)?\b(.*)$/iu);
    if (!match) continue;
    let selected = match[1]!, rejected = match[3]!;
    const following = rejected.match(/^(.*?)(?:,[ \t]*|\bthen[ \t]+)(?:use|keep|retain)\b(.*)$/iu);
    if (following) {rejected = following[1]!; selected = following[2]!;}
    const negative = /(?:\bnot|\bnever|n['’]t)\s*$/iu.test(match[2]!);
    originals.push(JSON.stringify([negative,actor(match[2]!),packagingSignature(selected,prepared),packagingSignature(rejected,prepared)]));
  }
  if (!originals.length) return;
  const candidates: string[] = [];
  for (const clause of target.split(/[。；;!?！？\r\n]/u)) {
    const match = clause.match(/^(.*?)(?:只有|僅當|僅在|唯有|僅限)(.*?)(拒絕|拒收|不接受)(.*)$/u);
    if (!match) continue;
    let selected = match[1]!, rejected = match[4]!;
    const following = rejected.match(/^(.*?)(?:才|方可|時(?=使用|採用|保留))(.*)$/u);
    if (following) {rejected = following[1]!; selected = following[2]!;}
    const negative = /(?:不|未|沒|沒有|並非|尚未)[ \t]*(?:(?:會|再|曾|曾經|願意|予以)[ \t]*)?(?:拒絕|拒收)|(?:並非|不是|沒有)[ \t]*不接受/u.test(match[2]! + match[3]);
    candidates.push(JSON.stringify([negative,actor(match[2]!),packagingSignature(selected,prepared),packagingSignature(rejected,prepared)]));
  }
  for (const relation of originals) {
    const index = candidates.indexOf(relation);
    if (index < 0) throw new TranslationQualityError("packaging_condition_changed");
    candidates.splice(index, 1);
  }
  if (/\botherwise\b/iu.test(source) && !/否則|不然/u.test(target)) throw new TranslationQualityError("packaging_condition_changed");
}
export function validateNmtNamedRequests(source: string, target: string, names: readonly string[]): void {
  if (!names.length) return;
  const choices = [...new Set(names)].sort((a,b) => b.length-a.length).map(escape).join("|");
  const name = "(?<![A-Za-z])(" + choices + ")(?![A-Za-z])";
  const original = new RegExp(name + "\\s+(?:(?:will|would|can|could|may|might)\\s+)?(?:ask|asks|asked|request|requests|requested)\\s+" + name + "\\s+to\\s+(?:check|review|verify|inspect|confirm)\\b", "giu");
  const requests = [...source.matchAll(original)].map(m => JSON.stringify([m[1],m[2]]));
  if (!requests.length) return;
  const active = new RegExp(name + "[ \\t]*(?:會|將|將會|可以|可|能夠|能|打算)?[ \\t]*(?:請|要求|請求|拜託)[ \\t]*" + name + "[ \\t]*(?:幫忙|協助|去|進行)?[ \\t]*(?:檢查|檢視|核對|查核|確認|審查|覆核|審核|審閱)", "gu");
  const passive = new RegExp(name + "[ \\t]*(?:會|將|將會)?[ \\t]*應[ \\t]*" + name + "[ \\t]*(?:的|之)(?:要求|請求)[ \\t]*(?:檢查|檢視|核對|查核|確認|審查|覆核|審核|審閱)", "gu");
  const candidates = [...target.matchAll(active)].map(m => JSON.stringify([m[1],m[2]]));
  candidates.push(...[...target.matchAll(passive)].map(m => JSON.stringify([m[2],m[1]])));
  for (const pair of requests) {const index = candidates.indexOf(pair); if (index < 0) throw new TranslationQualityError("actor_role_changed"); candidates.splice(index,1);}
}

// An unavailable preferred bag must not become an inability to pack into the fallback bag.
export function validateNmtUnavailableFallback(source: string, target: string): void {
  const match = /\bif\s+(?:(?:these|those)(?:\s+bags)?\s+are\s+unavailable|can['’]t\s+make|cannot\s+make|not\s+possible)\b/iu.exec(source);
  if (!match || !/\bbags?\b/iu.test(source.slice(0, match.index)) || !/\bFIBC\b/iu.test(source.slice(match.index))) return;
  if (/can['’]t\s+make|cannot\s+make/iu.test(match[0]) && [...source.slice(0, match.index).matchAll(/\bbags?\b/giu)].length !== 1) throw new TranslationQualityError("packaging_condition_changed");
  const conditions = [...target.matchAll(/(?:如果|倘若|若|如)([^。；;\r\n]*?)(?=[，,]|(?:則|就|便)(?:改|使|用|採|放|裝)|[。；;\r\n]|$)/gu)];
  const inability = /無法|不能(?:夠)?|做不到|辦不到|不可行|無貨|沒貨|不可得|買不到|買不著|缺貨|沒(?:有)?辦法|沒有(?:現貨|貨|供應|能力|這種袋子?)/u;
  const negative = conditions.map(m => m[1]!).filter(clause => {
    const predicate = inability.exec(clause);
    if (!predicate) return false;
    // Classify the complete predicate: denying/qualifying inability is not inability.
    const before = clause.slice(0, predicate.index);
    const complement = clause.slice(predicate.index + predicate[0].length).trimStart();
    const denied = /不是|並非|并非|並不|并不|不再|未必|不一定|不見得|談不上|沒有說|並沒有|并没有|不存在|是否/u.test(before) || /(?:沒(?:有)?|不|未)(?:真的|確實)?[ \t]*$/u.test(before) || /(?:不是|並非)(?:問題|事實|條件)|與否/u.test(complement) || /^(?:說|認為|斷言|證明)/u.test(complement);
    if (denied || /^(?:不|未|沒(?:有)?)(?:再|去|繼續)?(?:做|製作|生產|提供|供應|取得|購買|採用|使用)/u.test(complement)) throw new TranslationQualityError("packaging_condition_changed");
    return true;
  });
  if (!negative.length) throw new TranslationQualityError("packaging_condition_changed");
  if (!/\bFIBC\b/iu.test(source.slice(0, match.index)) && negative.some(clause => /FIBC|噸袋|吨袋|集裝袋|集装袋|貨櫃|货柜/iu.test(clause))) throw new TranslationQualityError("packaging_condition_changed");
}
// Inspect action polarity separately from the object signature in each branch.
function branchActionPolarity(clause: string, language: "en" | "zh"): string | undefined {
  const action = language === "en" ? /\b(?:use|uses|used|using|adopt(?:ed|ing)?|choose|choosing|chosen|select(?:ed|ing)?|prioriti[sz](?:e|es|ed|ing)|give\s+priority\s+to|prefer(?:red|ring)?|opt\s+for|pack\s+in)\b/giu : /使用|改用|採用|選用|選擇|首選|優先/gu;
  const matches = [...clause.matchAll(action)];
  const polarities = matches.map(match => {
    const before = clause.slice(0, match.index).replaceAll("’", "'");
    const denied = language === "en"
      ? /\b(?:not|never|no\s+longer|no\s+need|needn't|cannot|can't|mustn't|shouldn't|don't|doesn't|won't|wouldn't|avoid(?:ing)?|refus(?:e|ing)|declin(?:e|ing)|fail(?:ing)?|prevent(?:ing)?|prohibit(?:ing)?|forbid(?:ding)?|disallow(?:ing)?|reject(?:ing)?|without|refrain(?:ing)?\s+from|stop(?:ping)?|cease)(?:\s+(?:to|be|been|being|have|need|want|ever|really|actually|necessarily|simply|just))*\s*$/iu.test(before)
      : /(?:不要|不得|不可|不能|不必|無需|不用|不應(?:該)?|避免|不再|勿|別)[ \t]*$/u.test(before);
    // A prohibition can govern an infinitive before the action or predicate a
    // gerund/passive after it. Keep its complement local, rather than treating
    // the separate "if not" condition or affirmative permission as a ban.
    const prohibition = /\b(?:(?:is|are|was|were|be|been|being)\s+(?:(?:strictly|explicitly|expressly|absolutely)\s+)*(?:prohibited|forbidden|disallowed|banned|(?:not|never)\s+(?:(?:strictly|explicitly|expressly|ever)\s+)*(?:allowed|permitted|authorized))|(?:isn't|aren't|wasn't|weren't)\s+(?:(?:explicitly|expressly|ever)\s+)*(?:allowed|permitted|authorized))\b/giu;
    const prohibited = language === "en" && (
      [...before.matchAll(prohibition)].some(predicate => /^(?:\s+for\s+[\p{L}]+(?:\s+[\p{L}]+){0,3})?\s+(?:to|from)(?:\s+(?:be|been|being|ever|really|actually|simply|just))*\s*$/iu.test(before.slice(predicate.index + predicate[0].length))) ||
      [...clause.slice(match.index).replaceAll("’", "'").matchAll(prohibition)].length > 0
    );
    return denied || prohibited ? "negative" : "affirmative";
  });
  if (!matches.length && (language === "en" ? /\b(?:avoid|refrain\s+from)\b/iu : /避免/u).test(clause)) return "negative";
  return polarities.length && new Set(polarities).size === 1 ? polarities[0] : undefined;
}
// Accept 'if not' only with its adjacent, explicit feasibility antecedent and intact branches.
export function validateNmtEllipticalFeasibility(prepared: PreparedLlmContext, source: string, target: string): boolean {
  const original = source.match(/(?:若|如果)可行[，,]?([^。；;\r\n]+)[。；;][ \t]*(?:若|如果)做不到[，,]?([^。；;\r\n]+)/u);
  if (!original) return false;
  const translated = target.match(/\bif\s+(?:feasible|possible)[ \t]*,?[ \t]*([^.;\r\n]+)[.;][ \t]*if\s+not[ \t]*,[ \t]*([^.;\r\n]+)/iu);
  if (!translated) return false;
  const signature = (clause: string) => {
    const keys = JSON.parse(packagingSignature(clause, prepared)) as string[];
    const quantified = prepared.occurrences.some(item => item.unitGroup && clause.includes(item.token));
    return JSON.stringify(quantified ? keys.filter(key => !["small", "large"].includes(key)) : keys);
  };
  for (const branch of [1,2]) {
    const sourceAction = branchActionPolarity(original[branch]!, "zh"), outputAction = branchActionPolarity(translated[branch]!, "en");
    if (!sourceAction || sourceAction !== outputAction) throw new TranslationQualityError("packaging_condition_changed");
  }
  if (signature(original[1]!) !== signature(translated[1]!) || signature(original[2]!) !== signature(translated[2]!)) throw new TranslationQualityError("packaging_condition_changed");
  return true;
}
