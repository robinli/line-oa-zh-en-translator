import {describe, it, expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {createContextLlmHtml} from "./nmt-context-html.js";
import {validateContextLlmMeaning} from "./nmt-context-meaning.js";
import {restoreTradeTranslationWithRanges} from "./trade-policy.js";
function validate(source: string, output: string, target = "zh-TW") {
  const p = prepareLlmContext(source, [], [], target), wire = createContextLlmHtml(p);
  const decoded = wire.decode('<div id="p0">' + output + '</div>');
  const result = restoreTradeTranslationWithRanges(decoded.restoration, decoded.masked);
  validateContextLlmMeaning(p, decoded.masked, result.text, target);
}
describe("TLLM bounded packaging relations", () => {
  it.each([
    ["Use 20 kg small bags and 600 kg FIBC bags.", "使用600 kg小袋和20 kg FIBC袋。"],
    ["Use 20 kg bags; use 600 kg FIBC bags as the alternative.", "使用20 kg FIBC小袋；備案使用600 kg袋。"],
    ["Use 20 kg bags.", "使用20 kg個袋子。"],
    ["Use 20 kg bags.", "使用20 kg數量的袋子。"],
    ["Net weight is 600 kg; gross weight is 603 kg.", "淨重603 kg；毛重600 kg。"],
    ["The red bag holds 20 kg; the blue bag holds 20 lb.", "紅袋20 lb；藍袋20 kg。"],
    ["Each FIBC bag holds 600 kg net. The empty bag weighs 3 kg; its weight is not included in the net weight.", "每個FIBC袋淨重600 kg。空袋重3 kg；其重量包含在淨重內。"],
    ["Use 600 kg FIBC bags only if the buyer rejects the 20 kg bags. Otherwise, keep the 20 kg bags.", "如果買方接受20 kg袋子就使用600 kg FIBC袋；否則使用20 kg袋。"],
  ])("rejects an observed relation change: %s", (source, output) => {
    expect(() => validate(source, output)).toThrow();
  });
  it.each([
    ["Use 20 kg small bags; use 600 kg FIBC bags as the alternative.", "使用20 kg小袋；备案使用600 kg FIBC袋。"],
    ["Use 20 kg bags.", "使用20 kg的袋子。"],
    ["Net weight is 600 kg; gross weight is 603 kg.", "淨重600 kg；毛重603 kg。"],
    ["The red bag holds 20 kg; the blue bag holds 20 lb.", "紅袋20 kg；藍袋20 lb。"],
    ["Each FIBC bag holds 600 kg net. The empty bag weighs 3 kg; its weight is not included in the net weight.", "每個FIBC袋淨重600 kg。空袋重3 kg；其重量不計入淨重。"],
    ["Use 600 kg FIBC bags only if the buyer rejects the 20 kg bags. Otherwise, keep the 20 kg bags.", "只有買方拒絕20 kg袋子時才使用600 kg FIBC袋；否則使用20 kg袋。"],
  ])("accepts preserved weight and conditional relations: %s", (source, output) => {
    expect(() => validate(source, output)).not.toThrow();
  });
  it.each([
    ["Do not calculate the number of bags.", "無需計算袋數。"],
    ["Don't convert the units.", "不必轉換單位。"],
    ["Do not change the unit, but there is no need to calculate a total.", "不需要更改單位，但無需計算總額。"],
  ])("rejects weakened prohibition without matching unrelated clauses", (source, output) => {
    const p = prepareLlmContext(source, []);
    expect(() => validateContextLlmMeaning(p, output, output, "zh-TW")).toThrow("action_restriction_weakened");
  });
  it.each([
    ["Do not calculate the number of bags.", "不要計算袋數。"],
    ["Do not change the unit, but there is no need to calculate a total.", "不要更改單位，但無需計算總額。"],
    ["You are not required to calculate the number of bags.", "你無需計算袋數。"],
    ["You do not need to convert the units.", "你不必轉換單位。"],
  ])("accepts prohibition and actual lack of obligation", (source, output) => {
    const p = prepareLlmContext(source, []);
    expect(() => validateContextLlmMeaning(p, output, output, "zh-TW")).not.toThrow();
  });
});

it("keeps prohibition objects distinct when another clause uses the same operation", () => {
  const source = "Do not calculate the number of bags; you do not need to calculate the total weight.";
  const p = prepareLlmContext(source, []);
  expect(() => validateContextLlmMeaning(p, "", "無需計算袋數；不要計算總重量。", "zh-TW")).toThrow("action_restriction_weakened");
  expect(() => validateContextLlmMeaning(p, "", "不要計算袋數；無需計算總重量。", "zh-TW")).not.toThrow();
});
it.each([
  ["We have not confirmed availability or promised to use the bags.", "我們已確認供應狀況並承諾使用袋子。", "我們尚未確認供應狀況，也未承諾使用袋子。"],
  ["The quote is CNF.", "此報價為CNF，已含稅。", "此報價為CNF。"],
  ["The red bag is 20 kg, and the blue bag is 20 kg. Only the red bag needs a label.", "紅袋20 kg，藍袋20 kg。只有藍色袋子需標籤。", "紅袋20 kg，藍袋20 kg。只有紅色袋子需標籤。"],
])("retains explicit commitment, tax and repeated-value object constraints", (source, bad, good) => {
  const p = prepareLlmContext(source, []);
  expect(() => validateContextLlmMeaning(p, p.text, bad, "zh-TW")).toThrow();
  expect(() => validateContextLlmMeaning(p, p.text, good, "zh-TW")).not.toThrow();
});

it.each([
  ["Do not replace the ex-factory price of CAD 566 with the cost price of CAD 542.", "請勿以CAD 566的成本價取代CAD 542的出廠價。", "請勿以CAD 542的成本價取代CAD 566的出廠價。"],
  ["The cost price is EUR 127; the floor price is EUR 132.", "成本價為EUR 132；底價為EUR 127。", "成本價EUR 127；底價EUR 132。"],
])("keeps a price's label attached to its occurrence across reordering", (source, bad, good) => {
  const p = prepareLlmContext(source, [], [], "zh-TW");
  const mask = (value: string) => p.occurrences.reduce((text, item) => text.replace(item.value, () => item.token), value);
  expect(() => validateContextLlmMeaning(p, mask(bad), bad, "zh-TW")).toThrow("price_relationship_changed");
  expect(() => validateContextLlmMeaning(p, mask(good), good, "zh-TW")).not.toThrow();
});
it.each([
  ["買方", "buyer", "seller"], ["賣方", "seller", "buyer"],
])("requires the explicit freight payer and payment action", (zh, en, other) => {
  const p = prepareLlmContext("運費由" + zh + "另付。", []);
  for (const bad of ["The freight is to be freight separately by the " + en + ".", "The freight is paid separately by the " + other + "."]) expect(() => validateContextLlmMeaning(p, bad, bad, "en")).toThrow("freight_payer_changed");
  for (const good of ["The freight is paid separately by the " + en + ".", "The " + en + " pays the freight separately."]) expect(() => validateContextLlmMeaning(p, good, good, "en")).not.toThrow();
});
