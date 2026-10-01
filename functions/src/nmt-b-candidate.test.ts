import {expect, it, vi} from "vitest";
import {NmtGlossaryTranslator, NMT_GLOSSARY_ADAPTER_VERSION, type NmtGlossaryRequest} from "./nmt-glossary-translator.js";
import {checkConfirmationRelations} from "./nmt-confirmation-relations.js";
const options = {projectId: "test-project", location: "us-central1", protectedNames: [],
  glossaryZhEn: "projects/test-project/locations/us-central1/glossaries/zh-en",
  glossaryEnZh: "projects/test-project/locations/us-central1/glossaries/en-zh"};
function adapter(output: string) {
  const onMetric = vi.fn(), translateText = vi.fn(async (_request: NmtGlossaryRequest) =>
    [{glossaryTranslations: [{translatedText: '<div id="p0">' + output + '</div>'}]}] as [{glossaryTranslations: Array<{translatedText: string}>}]);
  return {translator: new NmtGlossaryTranslator({...options, onMetric}, {translateText}), onMetric, translateText};
}
it.each(["Fine", "fine.", " FINE! ", "Fine。", "Fine！"])("returns the exact Fine phrase through the public adapter with zero provider calls: %s", async source => {
  const s = adapter("unused");
  await expect(s.translator.translateWithRanges(source, "en", "zh-TW")).resolves.toEqual({text: "好的。", ranges: []});
  expect(s.translateText).not.toHaveBeenCalled();
  expect(s.onMetric).toHaveBeenCalledWith(expect.objectContaining({apiCalled: false, inputCharacters: 0, outputCharacters: 3, attempt: 0, adapterVersion: NMT_GLOSSARY_ADAPTER_VERSION}));
});
it.each(["Fine?", "a fine", "fine powder", "I'm fine", "Fine @Lee", "Fine 1"])("keeps the adjacent phrase on the public provider path: %s", async source => {
  const translateText = vi.fn(async () => {throw Error("offline capture");});
  await expect(new NmtGlossaryTranslator(options, {translateText}).translate(source, "en", "zh-TW")).rejects.toThrow("unavailable");
  expect(translateText).toHaveBeenCalledTimes(1);
});
it("protects an exact native name occurrence instead of translating it as an affirmative phrase", async () => {
  const s = adapter("unused");
  await expect(s.translator.translateWithRanges("Fine", "en", "zh-TW", {protectedRanges: [{start: 0, length: 4}]})).resolves.toMatchObject({text: "Fine"});
  expect(s.translateText).not.toHaveBeenCalled();
});
it.each([
  ["We must confirm the delivery date.", "我們必須確認交期。"],
  ["We do not need to confirm the delivery date.", "我們不需要確認交期。"],
  ["We must not confirm the quantity.", "我們不得確認數量。"],
  ["We must confirm the quantity, but need not confirm the color.", "我們不必確認顏色，但必須確認數量。"],
  ["Please confirm what it covers, and please confirm the delivery date.", "請確認涵蓋範圍，並請確認交期。"],
  ["We must confirm what services it covers.", "我們必須確認涵蓋哪些服務。"],
  ["We must confirm what it covers. Service fees are charged separately.", "我們必須確認涵蓋範圍。服務費另計。"],
])("accepts finite relation controls through the public adapter: %s", async (source, output) => {
  const s = adapter(output);
  await expect(s.translator.translate(source, "en", "zh-TW")).resolves.toBe(output);
  expect(s.translateText).toHaveBeenCalledTimes(1);
  expect(s.onMetric).toHaveBeenCalledWith(expect.objectContaining({apiCalled: true, outcome: "success"}));
});
it.each([
  ["We must confirm the delivery date.", "我們不必確認交期。", "confirmation_modality_changed"],
  ["We must not confirm the quantity.", "我們不必確認數量。", "confirmation_modality_changed"],
  ["We must confirm the quantity, but need not confirm the color.", "我們不必確認數量，但必須確認顏色。", "confirmation_modality_changed"],
])("rejects finite relation defects without retry through the public adapter: %s", async (source, output, reason) => {
  const s = adapter(output);
  await expect(s.translator.translate(source, "en", "zh-TW")).rejects.toThrow(reason);
  expect(s.translateText).toHaveBeenCalledTimes(1);
  expect(s.onMetric).toHaveBeenCalledWith(expect.objectContaining({apiCalled: true, outcome: "quality_rejected", reason}));
});
it("leaves unsupported general wording to existing policy and reports no finite semantic consistency", async () => {
  const source = "The manager must confirm the delivery date.", output = "經理必須確認交期。";
  expect(checkConfirmationRelations(source, output).status).toBe("unknown");
  await expect(adapter(output).translator.translate(source, "en", "zh-TW")).resolves.toBe(output);
});
it("preserves the existing terminal coverage fallback when the finite actor is unsupported", async () => {
  const source = "The manager must confirm what it covers.", output = "經理必須確認包含哪些服務。";
  expect(checkConfirmationRelations(source, output).status).toBe("unknown");
  await expect(adapter(output).translator.translate(source, "en", "zh-TW")).rejects.toThrow("unspecified_coverage_object_changed");
});

it("preserves configured protected Fine names without invoking the local affirmative helper or provider", async () => {
  const translateText = vi.fn(), onMetric = vi.fn();
  const translator = new NmtGlossaryTranslator({...options, protectedNames: ["Fine"], onMetric}, {translateText});
  await expect(translator.translateWithRanges("Fine", "en", "zh-TW")).resolves.toEqual({text: "Fine", ranges: []});
  expect(translateText).not.toHaveBeenCalled();
  expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({apiCalled: false, protectedCounts: {person: 1}}));
});

it.each([
  ["Please confirm what it covers. Please confirm the delivery date too.", "請確認涵蓋範圍。請確認交期。"],
  ["Please confirm what it covers. Please confirm the delivery date too.", "請確認交期。請確認涵蓋範圍。"],
])("retains experimental adjacent coverage positive expectation: %s", (source, output) => {
  expect(checkConfirmationRelations(source, output).status).toBe("consistent");
});
it.each([
  ["We must confirm what it covers. Service fees are charged separately.", "我們必須確認涵蓋範圍。", "independent_cost_relation_changed"],
  ["We must confirm what it covers. Service fees are charged separately.", "我們必須確認涵蓋範圍。服務費另計。服務費另計。", "independent_cost_relation_changed"],
  ["Please confirm what it covers.", "請確認涵蓋範圍，僅服務費。", "unspecified_coverage_object_changed"],
  ["Please confirm what it covers.", "請確認涵蓋範圍。只包含運費。", "unspecified_coverage_object_changed"],
  ["Please confirm what it covers, and please confirm the delivery date.", "請確認涵蓋範圍，並請確認交期。只含運費。", "unspecified_coverage_object_changed"],
])("retains experimental fee/coverage rejection expectation: %s", (source, output) => {
  expect(checkConfirmationRelations(source, output).status).toBe("violation");
});
