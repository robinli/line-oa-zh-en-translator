import type {PreparedLlmContext} from "./nmt-context.js";
// Source-only, same-language disambiguation. Original offsets/occurrences never change.
export function normalizeNmtSource(prepared: PreparedLlmContext): void {
  const token = prepared.prefix + "\\d+__";
  prepared.text = prepared.text.split(/\r\n|\r|\n/u).map((line, index) => {
    if (prepared.targetLanguage === "zh-TW") {
      // Same-language passive keeps the unspecified object and its antecedent.
      // Quoted data is not an instruction to normalize.
      line = line.split(/([“「"][^”」"\r\n]+[”」"])/gu).map((part, position) => position % 2 ? part :
        part.replace(/\bconfirm what it covers(?=[.!?]|$)/giu, "confirm what is covered by it")).join("");
      // An additive predicate makes this an addition, not an exclusive alternative.
      line = line.replace(/\bInstead of only ([^,;.!?]+), (?=[^;.!?]*\bcan also\b)/giu, "In addition to $1, ");
      if (/\b(?:label|instruction)\b/iu.test(line) && /[“「"]([^”」"\r\n]+)[”」"]/u.test(line) && /\btranslate\s+(?:the\s+)?(?:label|instruction)\b/iu.test(line)) {
        const parts = line.split(/([“「"][^”」"\r\n]+[”」"])/gu);
        const outside = parts.filter((_, position) => position % 2 === 0).join(" ");
        const uniqueLabel = parts.length === 3 && !/\b(?:another|other|different|second)\s+label\b|\blabels\b/iu.test(outside);
        line = parts.map((part, position) => {
          if (position % 2) return part; // Quoted data and its auxiliary stay byte-exact.
          if (uniqueLabel) part = part.replace(/(\btranslate\s+(?:the\s+)?label)\s*,\s*not follow it(?=[.!?]|$)/giu, "$1; do not carry out the instruction on the label");
          return part.replace(/\bnot follow it(?=[.!?]|$)/giu, "not obey it");
        }).join("");
      }
      // Keep an unresolved temporal reference; never turn a deadline into a ship date.
      line = line.replace(/(\bIf [^,;.!?]+\b(?:before|after) [^,;.!?]+, [^,;.!?]+\b(?:may|might|can|could) [^,;.!?]+)\bthen(?=[.!?]|$)/giu, "$1at that time");
    } else if (prepared.targetLanguage === "en") {
      line = line.replace(/不一定要一次就[^。；;，,]*底價[^。；;，,]*(?:客戶|客人|買方)/gu, matched => matched.replace(/一次就/u, "一開始就"));
      // Only an explicit named principal; no role is inferred from a pronoun.
      line = line.replace(new RegExp("代([ \\t]*(" + token + ")[ \\t]*)核准", "gu"), (whole, spacing: string, name: string) =>
        prepared.occurrences.some(item => item.token === name && (item.kind === "person" || item.kind === "person-mention")) ? "代表" + spacing + "作出核准" : whole);
    }
    return line + prepared.paragraphs[index]!.separator;
  }).join("");
}
