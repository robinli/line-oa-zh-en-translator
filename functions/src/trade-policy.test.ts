import {describe, expect, it} from "vitest";
import {
  prepareTradeText, restoreTradeTranslation, validateTradeTerminology,
} from "./trade-policy.js";

describe("trade data protection", () => {
  it("preserves CNF, names, product codes, prices and arithmetic without changing their values", () => {
    const source = "Wei brother, Shan quoted US$1060/MT CNF for PH-BK. 1260+100; 1195+100?";
    const prepared = prepareTradeText(source);
    expect(prepared.text).not.toContain("Shan");
    expect(prepared.text).not.toContain("CNF");
    expect(prepared.protectedValues.map((item) => item.value)).toEqual([
      "Wei", "Shan", "US$", "1060", "MT", "CNF", "PH-BK", "1260+100", "1195+100",
    ]);
    expect(restoreTradeTranslation(prepared, prepared.text)).toBe(source);
  });

  it("preserves every occurrence independently and permits grammatical reordering", () => {
    const prepared = prepareTradeText("Shan told Wei that Shan would confirm USD 800.");
    const tokens = prepared.protectedValues.map((item) => item.token);
    const translated = tokens[1] + "，" + tokens[0] + "說" + tokens[2] + "會確認" +
      tokens[3] + " " + tokens[4] + "。";
    expect(restoreTradeTranslation(prepared, translated)).toBe("Wei，Shan說Shan會確認USD 800。");
  });

  it.each(["missing", "duplicate", "new-number", "term-expansion", "name-duplicate"])(
    "rejects %s corruption instead of returning an unsafe quote", (kind) => {
      const prepared = prepareTradeText("Shan quoted USD 800 CNF.");
      const token = prepared.protectedValues[0]!.token;
      const candidates: Record<string, string> = {
        missing: prepared.text.replace(token, "你"),
        duplicate: prepared.text + token,
        "new-number": prepared.text + " 850",
        "term-expansion": prepared.text + " CIF",
        "name-duplicate": prepared.text + " Shan",
      };
      expect(() => restoreTradeTranslation(prepared, candidates[kind]!)).toThrow();
    },
  );

  it("does not match parts of other names or rewrite ambiguous uppercase English", () => {
    const prepared = prepareTradeText("Shannon and Ericson said CHECK-IN and WIRE.");
    expect(prepared.protectedValues).toEqual([]);
  });

  it("preserves lowercase currency codes as written in informal trade chat", () => {
    const prepared = prepareTradeText("Add 50 usd to the CNF price.");
    expect(prepared.protectedValues.map((item) => item.value)).toContain("usd");
    expect(restoreTradeTranslation(prepared, prepared.text)).toBe("Add 50 usd to the CNF price.");
  });

  it("preserves Kumar and Kumaran as distinct written names without inferring identity", () => {
    const prepared = prepareTradeText("Kumar should discuss with Kumaran.");
    expect(prepared.protectedValues.map((item) => item.value)).toEqual(["Kumar", "Kumaran"]);
    expect(restoreTradeTranslation(prepared, prepared.text)).toBe("Kumar should discuss with Kumaran.");
  });

  it("preserves full-width prices, percentages and negative amounts", () => {
    const source = "價格１２，３４５．６７，折扣５％，調整 -50。";
    const prepared = prepareTradeText(source);
    expect(restoreTradeTranslation(prepared, prepared.text)).toBe(source);
  });

  it("keeps native mention display text literal, including Chinese and emoji", () => {
    const mention = "@Niranjan Prakash @B5-海屏 Eric胡哲榮";
    const text = mention + "\nPlease confirm USD 800.";
    const prepared = prepareTradeText(text, undefined, [{start: 0, length: mention.length}]);
    expect(prepared.protectedValues[0]).toMatchObject({kind: "person-mention", value: mention});
    expect(restoreTradeTranslation(prepared, prepared.text)).toBe(text);
  });

  it("does not decode HTML entities in source text or expose literal token syntax", () => {
    const source = "A&amp;B quote __TRADE_abc_7__ is 500.";
    const prepared = prepareTradeText(source);
    expect(restoreTradeTranslation(prepared, prepared.text)).toBe(source);
  });

  it.each([
    ["不一定要一次就把我們的底價給客戶", "Do not give our lowest acceptable price all at once.", "en"],
    ["USD 780 is our best price.", "USD 780是我們的底價。", "zh-TW"],
  ])("rejects a changed commercial implication for %s", (source, target, language) => {
    expect(() => validateTradeTerminology(source, target, language)).toThrow();
  });

  it.each([
    ["底價", "Our base price is firm.", "en"],
    ["出廠價", "Our cost price is firm.", "en"],
    ["成本價", "Our quoted price is firm.", "en"],
    ["底價", "giá cơ sở", "vi"],
  ])("rejects conflation of %s", (source, target, language) => {
    expect(() => validateTradeTerminology(source, target, language)).toThrow("pricing_terminology");
  });

  it.each([
    ["底價", "Our lowest acceptable price is firm.", "en"],
    ["出廠價", "Our ex-factory price excludes freight.", "en"],
    ["成本價", "This is our cost price.", "en"],
    ["出廠價", "giá xuất xưởng", "vi"],
    ["The bottom line is we need a decision.", "重點是我們需要一個決定。", "zh-TW"],
  ])("accepts the appropriate meaning of %s", (source, target, language) => {
    expect(() => validateTradeTerminology(source, target, language)).not.toThrow();
  });
});
