import type {PreparedLlmContext} from "./nmt-context.js";
import {TranslationQualityError} from "./trade-policy.js";
const escape = (value: string) => value.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&");
const fail = (reason: string): never => {throw new TranslationQualityError(reason);};
// Finite explicit source relations. No target words are supplied by these checks.
export function validateNmtTradeRelations(prepared: PreparedLlmContext, result: string): void {
  const source = prepared.original;
  if (prepared.targetLanguage === "zh-TW") {
    const outsideQuote = source.replace(/[“「"][^”」"\r\n]+[”」"]/gu, "");
    const unknownCoverage = [...outsideQuote.matchAll(/\bconfirm what it covers(?=[.!?]|$)/giu)];
    if (unknownCoverage.length) {
      // A terminal unknown complement cannot become a specified fee category.
      // Cover the complete complement, so neutral words cannot hide an addition.
      const clauses = [...result.replace(/[“「"][^”」"\r\n]+[”」"]/gu, "").matchAll(/(?:確認|核實|查明)([^，,。；;!?！？\r\n]*)/gu)];
      const referent = "(?:(?:它|其|這筆(?:款項|金額|費用)|該(?:款項|金額|費用)|這個金額)(?:所)?)?";
      const cover = "(?:涵蓋|包括|包含|支付|負擔)";
      const neutral = new RegExp("^" + referent + "(?:" + cover + "(?:了|的是)?(?:什麼|甚麼|哪些(?:內容|項目|部分)?|的(?:具體|實際)?(?:內容|範圍|項目))|(?:所)?" + cover + "(?:的)?(?:內容|範圍)|(?:的)?(?:內容|範圍|用途))(?:是什麼|為何)?$", "u");
      if (clauses.length !== unknownCoverage.length || clauses.some(clause => !neutral.test(clause[1]!.replace(/\s/gu, "")))) fail("unspecified_coverage_object_changed");
    }
    if (/\b(?:tax|taxes|duties)\s+(?:is|are)\s+not\s+included\b/iu.test(source)) {
      if (/(?:不是|並非|不能說|不代表)[^。；;]{0,4}(?:不|未)(?:含|包含|包括)稅/u.test(result)) fail("unjustified_tax_inclusion");
      const claims = [...result.matchAll(/(?:不|未|尚未|並非|不是|已|已經)?(?:包含|包括|含)(?:了)?(?:稅|税)/gu)].map(match => match[0]);
      if (claims.some(claim => !/^(?:不|未|尚未|並非|不是)/u.test(claim)) || !claims.some(claim => /^(?:不|未|尚未|並非|不是)/u.test(claim)) && !/未稅|稅(?:費|金)?[^。；;，,]{0,12}(?:不|未)(?:包含|包括|含)|稅(?:費|金)?另計/u.test(result)) fail("unjustified_tax_inclusion");
    }
    if (/\bInstead of only\s+(?:sending|passing(?:\s+on)?|providing)\s+(?:documents|information)\s*,[^.!?]*\bcan also\b/iu.test(source)) {
      const object = /\bdocuments\b/iu.test(source) ? "(?:文件|文檔|文档|單據)" : "(?:資料|訊息|信息|資訊)";
      if (!new RegExp("(?:傳遞|傳送|發送|寄送|寄出|提供|轉達|轉交|傳達|傳輸)[^。；;]{0,12}" + object, "u").test(result)) fail("additive_action_omitted");
    }
    if (/\b(?:label|instruction)\b/iu.test(source) && /[“「"][^”」"\r\n]+[”」"]/u.test(source) && /\btranslate\s+(?:the\s+)?(?:label|instruction)\s*,?\s*not\s+(?:follow|obey)\s+it\b/iu.test(source)) {
      // The source has an unconditional prohibition. Recognize complete grammatical
      // predicates, not an arbitrary modifier gap or a growing adverb denylist.
      let instruction = result.replace(/[“「"][^”」"\r\n]+[”」"]/gu, "").replace(/[^\S\r\n]+/gu, "");
      const noun = "(?:指令|指示|說明|说明|內容|内容)";
      const label = "(?:(?:該|该|此|這個|这个|這|这|樣品)?(?:標籤|标签)(?:本身|(?:上|中|內|内|裡|里)?(?:所寫)?的?" + noun + ")?)";
      const object = "(?:" + label + "|(?:其中|其|它|上面)(?:的?" + noun + ")?|" + noun + ")";
      const negative = "(?:不要|不應(?:該)?|不该|不該|不可(?:以)?|不得|不能|別|别|禁止|不准|切勿|勿|而不是|而非|並非)";
      const verb = "(?:遵從|遵循|遵守|服從|執行|聽從)";
      const particle = "(?:去|來|加以|予以)?";
      const active = negative + particle + "(?:" + verb + object + "?|照做|(?:按照|依照|按|照著|照)" + object + "(?:去)?(?:做|行事|執行))";
      const preposed = negative + "(?:把|將|對)" + object + particle + "(?:" + verb + "|照做)";
      const passive = object + negative + "(?:被|由(?:你|您))?" + particle + verb;
      const predicate = new RegExp("^(?:請|请)?(?:你|您)?(?:" + active + "|" + preposed + "|" + passive + ")$", "u");
      const translationPrefix = new RegExp("^(?:請|请)?(?:翻譯|翻译)" + object, "u");
      const report = new RegExp("^" + label + "(?:上)?(?:寫著|寫着|寫道|寫有|顯示|內容為)$", "u");
      // Exclude an independent condition only by matching its complete source event
      // AND consequence, including the notification recipient and one occurrence.
      // A condition alone, punctuation or absence of a label-action is no evidence
      // of independence. Unknown extra text stays in the coverage check below.
      const sourceOutsideQuote = source.replace(/[“「"][^”」"\r\n]+[”」"]/gu, "");
      const hasSourceReport = /\b(?:label|instruction)\s+(?:says|reads|states)\b/iu.test(sourceOutsideQuote);
      const events: Record<string, string> = {
        goods: "(?:貨物|貨品)", shipment: "(?:貨物|貨件)",
        documents: "(?:文件|單據)", payment: "(?:付款|款項|貨款)", funds: "(?:款項|資金)",
      };
      const recipients: Record<string, string> = {us: "我們", me: "我", them: "他們", you: "(?:你|您)"};
      for (const independent of sourceOutsideQuote.split(/[.!?;\r\n]+/u)) {
        const mapped = independent.trim().match(/^If (?:the )?(goods|shipment|documents|payment|funds) arrives?,\s*(?:please )?(?:notify|inform|tell) (us|me|them|you)$/iu);
        if (!mapped) continue;
        const event = events[mapped[1]!.toLowerCase()]!, recipient = recipients[mapped[2]!.toLowerCase()]!;
        const fullRelation = new RegExp("(?:如果|若|假如|倘若)" + event + "(?:抵達|到達)[，,。.;；!?！？\\r\\n]*(?:則|就|便)?(?:請)?(?:通知|告知)" + recipient + "(?=$|[，,。.;；!?！？\\r\\n])", "u");
        const occurrence = fullRelation.exec(instruction) ?? fail("quoted_instruction_action_changed");
        instruction = instruction.slice(0, occurrence.index) + instruction.slice(occurrence.index + occurrence[0].length);
      }
      let sameObjectNegative = false;
      // Cover ALL outside-quote fragments. Only a source-mapped complete relation
      // above, label report, translation or finite negative action can be omitted.
      // Sentence punctuation never makes an otherwise unmatched fragment harmless.
      for (const raw of instruction.split(/[，,。.;；!?！？\r\n]+|(?:而且|但是|但|並且|並(?!非)|且)/u)) {
        const clause = raw.replace(translationPrefix, "");
        if (!clause || hasSourceReport && report.test(clause)) continue;
        if (!predicate.test(clause)) fail("quoted_instruction_action_changed");
        sameObjectNegative = true;
      }
      if (!sameObjectNegative || /(?:不要|不應|不可|別)[^。；;]{0,8}(?:複製|拷貝|抄寫)/u.test(instruction)) fail("quoted_instruction_action_changed");
    }
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const chineseMonths = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
    const conditionalTime = source.match(new RegExp("\\bIf ([^,;.!?]+)\\b(before|after) (" + months.join("|") + "), [^,;.!?]+\\b(?:may|might|can|could) (?:ship|dispatch|deliver) then\\b", "iu"));
    if (conditionalTime && /\b(?:payment|funds|money)\b/iu.test(conditionalTime[1]!)) {
      const expectedMonth = months.findIndex(month => month.toLowerCase() === conditionalTime[3]!.toLowerCase()) + 1;
      const expectedRelation = conditionalTime[2]!.toLowerCase() === "before" ? "前" : "後";
      const monthPattern = new RegExp(months.join("|") + "|(?:十二|十一|十|[一二三四五六七八九]|1[0-2]|0?[1-9])月", "giu");
      let conditions = 0;
      // Validate the payment event and its exact temporal relation before separating
      // it from the unresolved shipment consequence. A comma is not required.
      const consequence = result.replace(/(?:如果|假如|倘若|若)([^，,。；;!?\r\n]*)/gu, (whole: string, segment: string) => {
        const payment = /(?:款項|付款|貨款|款)/u, arrival = /(?:到[帳賬]|入[帳賬]|抵達|到達|收(?:到|妥))/u;
        // A connector such as 就 can belong to the payment clause itself. It starts
        // the consequence only after a complete dated payment-arrival predicate.
        const boundary = [...segment.matchAll(/便|則|就|那麼|屆時|到時/gu)].find(match => {
          const prefix = segment.slice(0, match.index);
          return payment.test(prefix) && arrival.test(prefix) && [...prefix.matchAll(monthPattern)].length > 0;
        })?.index ?? segment.length;
        const condition = segment.slice(0, boundary);
        conditions++;
        const dates = [...condition.matchAll(monthPattern)];
        if (dates.length !== 1 || !payment.test(condition) || !arrival.test(condition) || /(?:出貨|發貨|裝運|運送|交貨|未|沒|不|並非)/u.test(condition)) fail("unresolved_shipping_time_changed");
        const date = dates[0]!, value = date[0];
        const englishMonth = months.findIndex(month => month.toLowerCase() === value.toLowerCase()) + 1;
        const literal = value.replace(/月$/u, "");
        const actualMonth = englishMonth || (chineseMonths.indexOf(literal) + 1) || Number(literal);
        const before = condition.slice(0, date.index), after = condition.slice(date.index! + value.length);
        const suffix = after.match(/^(?:份)?(?:之|以)?(前|後|后)(?![前後后])/u)?.[1];
        const prefix = before.match(/(?:早於|早于|晚於|晚于)$/u)?.[0];
        const relation = suffix?.replace("后", "後") ?? (prefix?.startsWith("早") ? "前" : prefix ? "後" : undefined);
        if (actualMonth !== expectedMonth || relation !== expectedRelation) fail("unresolved_shipping_time_changed");
        return segment.slice(boundary);
      });
      if (conditions !== 1 || monthPattern.test(consequence) || !/(?:那時|那個時候|屆時|到時|當時|彼時|到那時)/u.test(result)) fail("unresolved_shipping_time_changed");
    }
  } else if (prepared.targetLanguage === "en") {
    const names = [...new Set(prepared.occurrences.filter(item => ["person", "person-mention"].includes(item.kind)).map(item => item.value))];
    for (const principal of names) {
      const delegate = source.match(new RegExp("(不需要|無須|毋須|不能|不得|不可以)?代[ \\t]*" + escape(principal) + "[ \\t]*核准", "u"));
      if (delegate) {
        const behalf = new RegExp("(?:on|in)\\s+" + escape(principal) + "['’]s\\s+behalf|on\\s+behalf\\s+of\\s+" + escape(principal) + "\\b", "iu");
        const clauses = result.split(/[.;!?\r\n]|\b(?:but|and|yet|however)\b/iu).filter(clause => behalf.test(clause));
        if (clauses.length !== 1) fail("delegated_approval_changed");
        const clause = clauses[0]!;
        const sourcePrefix = source.slice(0, delegate.index);
        const sourceActors = names.filter(name => sourcePrefix.includes(name));
        const actor = sourceActors.length === 1 ? sourceActors[0] : undefined;
        if (actor) {
          const predicate = clause.replace(behalf, "");
          for (const person of names.filter(name => name !== actor)) {
            if (new RegExp("\\b" + escape(person) + "\\s+(?:does?|need|must|can|cannot|is|isn['’]t)\\b|\\b(?:from|for|by)\\s+" + escape(person) + "\\b", "iu").test(predicate)) fail("delegated_approval_changed");
          }
        }
        if (/\bnot\s+(?:(?:actually|necessarily)\s+)?(?:not|unnecessary|unneeded|optional)\b|\b(?:not|isn['’]t|aren['’]t)\s+(?:true|correct|unnecessary|unneeded|optional)\b|\b(?:false|untrue|incorrect)\s+that\b/iu.test(clause)) fail("delegated_approval_changed");
        if (!/\bapprov(?:e|es|ed|ing|al)\b/iu.test(clause) || /\b(?:get|obtain|seek|receive|request)(?:s|ed|ing)?\b[^.;]{0,40}\bapproval\b/iu.test(clause)) fail("delegated_approval_changed");
        if (delegate[1] && /^(?:不需要|無須|毋須)$/u.test(delegate[1])) {
          const approve = "(?:approve|(?:give|make)\\s+(?:an\\s+)?approval)";
          const subject = "(?:her|him|them|me|you|us|" + names.map(escape).join("|") + ")";
          const active = new RegExp("(?:\\b(?:does?\\s+not|does?n['’]t)\\s+(?:need|have)\\s+to|\\bneed\\s+not|\\bneedn['’]t|\\b(?:not|isn['’]t|aren['’]t)\\s+(?:required|needed|necessary|obliged|obligated)(?:\\s+for\\s+" + subject + ")?\\s+to|\\bno\\s+(?:need|obligation)(?:\\s+for\\s+" + subject + ")?\\s+to|\\bunnecessary(?:\\s+for\\s+" + subject + ")?\\s+to)\\s+(?:personally\\s+)?" + approve + "\\b", "iu");
          const nominal = clause.replace(behalf, " ");
          const passive = new RegExp("\\b(?:approval|approving|giving\\s+approval|to\\s+approve)(?:\\s+(?:by|from|for)\\s+" + subject + ")?\\s+(?:(?:is|would\\s+be)\\s+(?:unnecessary|unneeded|not\\s+(?:required|needed|necessary))|(?:isn['’]t|wouldn['’]t\\s+be)\\s+(?:required|needed|necessary))\\b", "iu");
          if (!active.test(clause) && !passive.test(nominal)) fail("delegated_approval_changed");
        }
        if (delegate[1] && /^(?:不能|不得|不可以)$/u.test(delegate[1]) && /\b(?:not|isn['’]t|aren['’]t)\s+(?:forbidden|prohibited)\b/iu.test(clause)) fail("delegated_approval_changed");
        if (delegate[1] && /^(?:不能|不得|不可以)$/u.test(delegate[1]) && !/\b(?:cannot|can['’]t|must\s+not|may\s+not|not\s+(?:allowed|permitted)|forbidden|prohibited)\b/iu.test(clause)) fail("delegated_approval_changed");
      }
      if (new RegExp(escape(principal) + "[ \\t]*已(?:經)?拒絕[ \\t]*(?=[；;。]|$)", "u").test(source)) {
        const people = "(?:her|him|them|me|you|us|she|he|they|I|we|" + names.map(escape).join("|") + ")";
        if (new RegExp("\\b(?:reject(?:s|ed|ing)?|declin(?:e|es|ed|ing)|refus(?:e|es|ed|ing)|turn(?:ed)?\\s+down)\\s+" + people + "\\b|\\bturn(?:ed)?\\s+" + people + "\\s+down\\b|\\b" + people + "\\b[^.;]{0,20}\\b(?:was|were|been|is|are)\\s+(?:rejected|refused|declined|turned\\s+down)\\s+by\\s+" + escape(principal) + "\\b", "iu").test(result)) fail("unspecified_rejection_object_changed");
      }
    }
  }
}
