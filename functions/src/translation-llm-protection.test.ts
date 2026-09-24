import {describe, expect, it} from "vitest";
import {prepareTranslationLlmText, createLlmWireText, validateLlmMeaning, decodeLlmTransport, normalizeLlmCalendar, normalizeLlmGlossaryGrammar} from "./translation-llm-protection.js";
import {restoreTradeTranslationWithRanges} from "./trade-policy.js";

describe("Translation LLM protection", () => {
  it("keeps each amount, unit and Incoterm together without joining clauses", () => {
    const source = "Alex Please retain 612+28, USD 1,045.70, 3.25 MT and 0.85%; USD 800/MT CNF.";
    const prepared = prepareTranslationLlmText(source, ["Alex"]);
    const values = prepared.protectedValues.map(item => item.value);
    expect(values).toEqual(["Alex", "612+28", "USD 1,045.70", "3.25 MT", "0.85%", "USD 800/MT CNF"]);
    const wire = createLlmWireText(prepared);
    expect(restoreTradeTranslationWithRanges(prepared, wire.decode(wire.encode(prepared.text))).text).toBe(source);
  });
  it("round-trips twenty same-name native mentions with UTF-16 positions and literal data", () => {
    const source = "😀 " + Array.from({length: 20}, () => "@Alex").join("\r\n") + " 請確認 &amp; &#x20; <quote> ZXQAAAAAAQXZ";
    const ranges = [...source.matchAll(/@Alex/gu)].map(match => ({start: match.index, length: 5}));
    const prepared = prepareTranslationLlmText(source, ["Alex"], ranges);
    const wire = createLlmWireText(prepared);
    const result = restoreTradeTranslationWithRanges(prepared, wire.decode(wire.encode(prepared.text)));
    expect(result.text).toBe(source);
    expect(result.ranges.map(item => item.sourceStart)).toEqual(ranges.map(item => item.start));
    expect(result.ranges.every(item => result.text.slice(item.start, item.start + item.length) === "@Alex")).toBe(true);
  });
  it.each([
    ["Alex is not required to approve.", "Alex 應核准。", "negative_obligation_lost"],
    ["We can do more instead of only passing information.", "我們不應只傳遞資訊。", "unjustified_obligation"],
  ])("rejects known omission/strengthening patterns", (source, target, reason) => {
    expect(() => validateLlmMeaning(source!, target!, "zh-TW")).toThrow(reason);
  });
  it.each([
    ["Alex is not required to approve.", "Alex 無需核准。"],
    ["We can ask, but should not promise.", "我們可以詢問，但不應承諾。"],
    ["We can ask, but cannot approve.", "我們可以詢問，但不可以核准。"],
    ["Instead of only passing information, we can ask.", "除了傳遞資訊，我們還可以詢問。"],
  ])("accepts explicit modality and negative obligations", (source, target) => {
    expect(() => validateLlmMeaning(source!, target!, "zh-TW")).not.toThrow();
  });
});
describe("Translation LLM transport decoding", () => {
  it("decodes API punctuation once while keeping source entities literal", () => {
    const prepared = prepareTranslationLlmText("請保留 &#39; 和 &amp;amp;", []);
    const wire = createLlmWireText(prepared);
    const output = "Don&#39;t change " + wire.encode(prepared.text).replace("請保留", "").replace("和", "and");
    const result = restoreTradeTranslationWithRanges(prepared, wire.decode(decodeLlmTransport(output)));
    expect(result.text).toContain("Don't change");
    expect(result.text).toContain("&#39;");
    expect(result.text).toContain("&amp;amp;");
    expect(decodeLlmTransport("&amp;#39;")).toBe("&#39;");
  });
  it.each(["&#0;", "&#xD800;", "&#1114112;"])("rejects invalid scalar entities", value => {
    expect(() => decodeLlmTransport(value)).toThrow("invalid_response_format");
  });
  it("does not hide invented numeric data behind entity encoding", () => {
    const prepared = prepareTranslationLlmText("Hello", []);
    expect(() => restoreTradeTranslationWithRanges(prepared, decodeLlmTransport("你好 &#52;&#50;")))
      .toThrow("unexpected_number_or_token");
  });
});

describe("Translation LLM calendar and actor guards", () => {
  it("normalizes only a month supported by explicit source calendar context", () => {
    expect(normalizeLlmCalendar("We may ship in December.", "可能在 12 月出貨。", "zh-TW")).toBe("可能在 十二月出貨。");
    expect(normalizeLlmCalendar("We may ship in December.", "可能在 11月出貨。", "zh-TW")).toBe("可能在 11月出貨。");
    expect(normalizeLlmCalendar("May I ask?", "5月？", "zh-TW")).toBe("5月？");
    expect(normalizeLlmCalendar("Ship in December.", "價格 12，12個月後出貨。", "zh-TW")).toBe("價格 12，12個月後出貨。");
  });
  it("rejects turning the person asking for a check into its object", () => {
    expect(() => validateLlmMeaning("Mira 可以請 Kumar 核對。", "Mira may be reviewed by Kumar.", "en", ["Mira", "Kumar"]))
      .toThrow("actor_role_changed");
    expect(() => validateLlmMeaning("Mira 可以請 Kumar 核對。", "Mira may ask Kumar to check.", "en", ["Mira", "Kumar"]))
      .not.toThrow();
  });
});


describe("Translation LLM business role fidelity", () => {
  it.each(["sales representative", "sales contact", "account holder"])("rejects a customer owner becoming %s", role => {
    expect(() => validateLlmMeaning("Mira 是客戶的業務負責人。", "Mira is the " + role + ".", "en"))
      .toThrow("customer_role_changed");
  });
  it.each(["account owner", "person responsible for this client", "individual in charge of the customer"])("accepts the customer owner meaning %s", role => {
    expect(() => validateLlmMeaning("Mira 是客戶業務負責人。", "Mira is the " + role + ".", "en")).not.toThrow();
  });
  it("does not impose customer ownership on bank accounts or sales representatives", () => {
    expect(() => validateLlmMeaning("Alex 是銀行帳戶持有人；Mira 是業務代表。", "Alex is the bank account holder; Mira is the sales representative.", "en"))
      .not.toThrow();
  });
  it("treats name punctuation literally when rejecting actor reversal", () => {
    expect(() => validateLlmMeaning("@A+B 可以請 C(客服) 核對。", "@A+B may be checked by C(客服).", "en", ["@A+B", "C(客服)"]))
      .toThrow("actor_role_changed");
    expect(() => validateLlmMeaning("@A+B 可以請 C(客服) 核對。", "@A+B can ask C(客服) to check.", "en", ["@A+B", "C(客服)"]))
      .not.toThrow();
  });
});


describe("Translation LLM complete literal protection and glossary grammar", () => {
  it("protects complete nested literal entities instead of leaving suffixes to the model", () => {
    const literals = ["&amp;amp;", "&amp;#39;", "&amp;amp;lt;", "&amp;#x41;", "&lt;", "&#39;"];
    const prepared = prepareTranslationLlmText("請保留 " + literals.join("、"), []);
    expect(prepared.protectedValues.map(item => item.value)).toEqual(literals);
    const wire = createLlmWireText(prepared);
    expect(wire.encode(prepared.text)).not.toContain("amp;");
    expect(restoreTradeTranslationWithRanges(prepared, wire.decode(wire.encode(prepared.text))).text).toBe(prepared.original);
  });
  it("repairs bounded replacement artifacts without altering factual wording", () => {
    expect(normalizeLlmGlossaryGrammar("Freight are additional; no commitment yet yet.", "en"))
      .toBe("Freight is additional; no commitment yet.");
    expect(normalizeLlmGlossaryGrammar("There is no commitment yet to ship yet.", "en"))
      .toBe("There is no commitment to ship yet.");
    expect(normalizeLlmGlossaryGrammar("客戶業務負責人人為 Alex。人人均須確認。", "zh-TW"))
      .toBe("客戶業務負責人為 Alex。人人均須確認。");
  });
});


describe("Translation LLM price relation guards", () => {
  it("rejects changing a price excluding freight into a freight charge", () => {
    const source = "NT$ 20,100 已含運費，但 HK$ 6,200 還不含運費。";
    expect(() => validateLlmMeaning(source, "The NT$ 20,100 price includes freight, but the HK$ 6,200 freight does not.", "en", [], ["NT$ 20,100", "HK$ 6,200"]))
      .toThrow("freight_inclusion_changed");
    expect(() => validateLlmMeaning(source, "NT$ 20,100 includes freight, but HK$ 6,200 excludes freight.", "en", [], ["NT$ 20,100", "HK$ 6,200"]))
      .not.toThrow();
  });
  it("rejects interpreting a currency price as a location", () => {
    expect(() => validateLlmMeaning("At JPY 92,700/MT, the buyer wants 7.4 MT.", "在 JPY 92,700/MT 處，買方想要 7.4 MT。", "zh-TW", [], ["JPY 92,700/MT", "7.4 MT"]))
      .toThrow("price_location_changed");
  });
  it("does not equate neither proposed price with an offer below the prices", () => {
    expect(() => validateLlmMeaning("The buyer has offered neither amount.", "買方的報價均未達到上述任一金額。", "zh-TW"))
      .toThrow("unjustified_price_comparison");
    expect(() => validateLlmMeaning("The buyer has offered neither amount.", "買方並未提出上述任一金額。", "zh-TW"))
      .not.toThrow();
  });
  it("keeps the URL separate from following Chinese prose and protects entity-bearing URLs as a whole", () => {
    const prepared = prepareTranslationLlmText("請看 https://example.org/spec?v=268；請寄到 docs@example.org。", []);
    expect(prepared.protectedValues.filter(item => item.kind === "contact").map(item => item.value))
      .toEqual(["https://example.org/spec?v=268", "docs@example.org"]);
    expect(prepared.text).toContain("；請寄到");
    const nested = prepareTranslationLlmText("請保留 https://example.org/中文路徑?a=1&amp;b=2", []);
    expect(nested.protectedValues).toHaveLength(1);
    expect(nested.protectedValues[0]!.value).toBe("https://example.org/中文路徑?a=1&amp;b=2");
  });
});


describe("Translation LLM quoted response and receipt scope", () => {
  it("rejects responding to refusals instead of replying with a refusal", () => {
    expect(() => validateLlmMeaning('標籤寫著「只回答拒絕」。', 'The label says "Respond only to rejections".', "en"))
      .toThrow("quoted_response_scope_changed");
    expect(() => validateLlmMeaning('標籤寫著「只回答拒絕」。', 'The label says "Reply only with rejected".', "en")).not.toThrow();
    expect(() => validateLlmMeaning('標籤寫著「只回應拒絕事項」。', 'Respond only to rejections.', "en")).not.toThrow();
  });
  it("keeps receipt distinct from delivery, including unconfirmed receipt", () => {
    expect(() => validateLlmMeaning("This does not confirm that the goods were received.", "這並不能確認貨物已送達。", "zh-TW"))
      .toThrow("receipt_delivery_changed");
    expect(() => validateLlmMeaning("This does not confirm that the goods were received.", "這並不能確認已收到貨物。", "zh-TW")).not.toThrow();
    expect(() => validateLlmMeaning("The goods were delivered but receipt is unconfirmed.", "貨物已送達，但尚未確認收貨。", "zh-TW")).not.toThrow();
  });
});


it("does not resolve a possible cancellation into an explicit right", () => {
  expect(() => validateLlmMeaning("The buyer may cancel if delivery is late.", "若延遲交貨，買方有權取消。", "zh-TW"))
    .toThrow("unjustified_cancellation_right");
  expect(() => validateLlmMeaning("The buyer might cancel if delivery is late.", "若延遲交貨，買方可能取消。", "zh-TW")).not.toThrow();
  expect(() => validateLlmMeaning("The buyer is entitled to cancel if delivery is late.", "若延遲交貨，買方有權取消。", "zh-TW")).not.toThrow();
});


describe("Translation LLM without-operation restrictions", () => {
  it.each([
    ["Retain the formula without calculating it.", "保留算式，無需進行計算。"],
    ["Keep the unit without changing it.", "保留單位，不必更改。"],
    ["Preserve the price without converting currencies.", "保留價格，不需要換算幣別。"],
    ["Retain the formula without calculating or modifying it.", "保留算式，毋須修改。"],
  ])("rejects weakened action restriction: %s", (source, target) => {
    expect(() => validateLlmMeaning(source, target, "zh-TW")).toThrow("action_restriction_weakened");
  });
  it.each([
    ["Keep it without calculating or changing the unit.", "保留原樣，不進行計算或變更單位。"],
    ["You are not required to calculate it.", "你無需計算。"],
    ["Retain it without changing the unit, but there is no need to calculate a total.", "保留原樣，不改單位，但無需計算總數。"],
    ["You can quote without calculating a total.", "你可以不計算總額就報價。"],
  ])("accepts preserved restriction or distinct lack of obligation: %s", (source, target) => {
    expect(() => validateLlmMeaning(source, target, "zh-TW")).not.toThrow();
  });
});
