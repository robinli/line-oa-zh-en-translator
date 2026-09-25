import {TranslationQualityError, type PreparedTradeText} from "./trade-policy.js";

const predicates = [
  {zh: "承諾", en: "(?:commit(?:ted)?|promis(?:e|ed)|(?:make|made)\\s+(?:a\\s+)?commitment)", past: "(?:committed|promised|made\\s+(?:a\\s+)?commitment)"},
  {zh: "同意", en: "(?:agree(?:d)?|consent(?:ed)?)", past: "(?:agreed|consented)"},
  {zh: "接受", en: "accept(?:ed)?", past: "accepted"},
  {zh: "(?:核准|批准)", en: "approv(?:e|ed)", past: "approved"},
  {zh: "確認", en: "confirm(?:ed)?", past: "confirmed"},
  {zh: "收到", en: "receiv(?:e|ed)", past: "received"},
  {zh: "回覆", en: "(?:respond(?:ed)?|repl(?:y|ied))", past: "(?:responded|replied)"},
  {zh: "(?:付款|支付)", en: "(?:pay|paid|(?:make|made)\\s+(?:(?:a|the)\\s+)?payment)", past: "(?:paid|made\\s+(?:(?:a|the)\\s+)?payment)"},
];
const negativeZh = "(?:尚未|還未|仍未|未曾|並未|還沒有|仍沒有|沒有|還沒|沒|未)";
const negativeEn = "(?:has|have|had|does|do|did)(?:\\s+not|n['’]t)\\s+(?:yet\\s+)?";
const positiveZh = "(?:已經|已)";
const positiveEn = "(?:(?:has|have|had)\\s+)?(?:already\\s+)?";

function sourceStatusPattern(predicate: typeof predicates[number], language: string, negative: boolean): RegExp {
  return language === "zh-TW" ?
    new RegExp("^[ \\t]*" + (negative ? negativeZh : positiveZh) + predicate.zh, "u") :
    new RegExp("^[ \\t]*" + (negative ? "(?:has|have|had)(?:\\s+not|n['’]t)\\s+(?:yet\\s+)?" : positiveEn) + predicate.past + "\\b", "iu");
}
export function llmMentionHasExplicitStatus(tail: string, language: string): boolean {
  return predicates.some(predicate => [true, false].some(negative => sourceStatusPattern(predicate, language, negative).test(tail)));
}

// Compare unique internal tokens, not restored display names: same-name mentions can
// identify different people. A status with an explicit named subject must retain it.
// This is a conservative guard for finite, direct status predicates, not a general parser.
export function validateLlmMentionSubjects(prepared: PreparedTradeText, translated: string,
  sourceLanguage: string, targetLanguage: string): void {
  if (!((sourceLanguage === "zh-TW" && targetLanguage === "en") ||
        (sourceLanguage === "en" && targetLanguage === "zh-TW"))) return;
  for (const {token} of prepared.rangeTokens) {
    const sourceIndex = prepared.text.indexOf(token);
    const targetIndex = translated.indexOf(token);
    if (sourceIndex < 0 || targetIndex < 0) throw new TranslationQualityError("protected_value_changed");
    const sourceTail = prepared.text.slice(sourceIndex + token.length);
    const targetTail = translated.slice(targetIndex + token.length);
    for (const predicate of predicates) {
      // An explicit prohibition must not turn into a report that the action has not happened.
      const sourceCommand = sourceLanguage === "en" ?
        new RegExp("^[ \\t]*(?:please\\s+)?(?:do\\s+not|don['’]t)\\s+" + predicate.en + "\\b", "iu") :
        new RegExp("^[ \\t]*(?:請)?(?:不要|勿|不得|別)" + predicate.zh, "u");
      if (sourceCommand.test(sourceTail)) {
        const targetCommand = targetLanguage === "zh-TW" ?
          new RegExp("^[ \\t,，]*(?:請)?(?:先|暫時|暫)?(?:不要|勿|不得|別|不可|不可以)" + predicate.zh, "u") :
          new RegExp("^[ \\t,，]*(?:please\\s+)?(?:do\\s+not|don['’]t|must\\s+not)\\s+" + predicate.en + "\\b", "iu");
        if (!targetCommand.test(targetTail)) throw new TranslationQualityError("mention_command_changed");
      }
      for (const negative of [true, false]) {
        const sourcePattern = sourceStatusPattern(predicate, sourceLanguage, negative);
        if (!sourcePattern.test(sourceTail)) continue;
        const targetPattern = targetLanguage === "zh-TW" ?
          new RegExp("^[ \\t]*" + (negative ? negativeZh : "(?:僅|只)?(?:已經|已)?") + predicate.zh, "u") :
          new RegExp("^[ \\t]*" + (negative ? negativeEn : positiveEn) + predicate.en + "\\b", "iu");
        if (!targetPattern.test(targetTail)) throw new TranslationQualityError("mention_subject_changed");
        if (sourceLanguage === "zh-TW" && /^[^。；;\r\n]*[，,]\s*但(?:還|也)?可以請/u.test(sourceTail) &&
            /^[^.\r\n;]*\bbut\s+we\s+(?:can|could|may)\s+ask\b/iu.test(targetTail)) {
          throw new TranslationQualityError("mention_subject_changed");
        }
      }
    }
  }
}
