import {expect, it, vi} from "vitest";
import * as confirmation from "./nmt-confirmation-relations.js";
import {NmtGlossaryTranslator} from "./nmt-glossary-translator.js";
const options = {projectId: "test-project", location: "us-central1", protectedNames: [],
  glossaryZhEn: "projects/test-project/locations/us-central1/glossaries/zh-en",
  glossaryEnZh: "projects/test-project/locations/us-central1/glossaries/en-zh"};
function adapter(output: string) {
  const onMetric = vi.fn(), translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: '<div id="p0">' + output + '</div>'}]}]);
  return {translator: new NmtGlossaryTranslator({...options, onMetric}, {translateText}), translateText, onMetric};
}
it.each([
  ["I must confirm the quantity, and must confirm the quantity.", "你必須確認數量，並必須確認數量。", "confirmation_actor_changed"],
  ["I must confirm the quantity, and must confirm the quantity.", "必須確認數量，並你必須確認數量。", "confirmation_actor_changed"],
  ["I must confirm the quantity, and must confirm the quantity.", "我必須確認數量。", "confirmation_object_changed"],
  ["I must confirm the color, not the quantity.", "我必須確認顏色。", "confirmation_exclusion_changed"],
  ["I must confirm the color, not the quantity.", "我必須確認顏色，而非交期。", "confirmation_exclusion_changed"],
  ["We must confirm the delivery date.", "我們不必確認交期。", "confirmation_modality_changed"],
])("retains the scoped closed core rejection: %s / %s", async (source, output, reason) => {
  expect(confirmation.checkConfirmationCore(source, output)).toMatchObject({status: "violation", reasons: [reason]});
  const s = adapter(output);await expect(s.translator.translate(source, "en", "zh-TW")).rejects.toThrow(reason);
  expect(s.translateText).toHaveBeenCalledTimes(1);
});
it.each([
  ["I must confirm the quantity, and need not confirm the quantity.", "我不必確認數量，並必須確認數量。"],
  ["I must confirm the quantity, and must confirm the quantity.", "必須確認數量，並我必須確認數量。"],
  ["I must confirm the color, not the quantity.", "我必須確認顏色，而非數量。"],
])("retains core positive controls without certifying full semantics: %s", async (source, output) => {
  const check = confirmation.checkConfirmationCore(source, output);
  expect(check.status).not.toBe("violation");expect(check.scope).toBe("confirmation_actor_object_modality_multiplicity_exclusion");
  await expect(adapter(output).translator.translate(source, "en", "zh-TW")).resolves.toBe(output);
});
const feeSource = "You must confirm the coverage, but shipping charges are billed separately.";
it.each(["；運費另外計費。", "，運費另外計費。", "，但運費另外計費。", "，但是運費另外計費。"])("does not use experimental fee/coverage decisions for faithful output: %s", async suffix => {
  const output = "你必須確認涵蓋範圍" + suffix;
  expect(confirmation.checkConfirmationCore(feeSource, output).status).not.toBe("violation");
  await expect(adapter(output).translator.translate(feeSource, "en", "zh-TW")).resolves.toBe(output);
});
it.each([
  "你必須確認涵蓋範圍。", "你必須確認涵蓋範圍；運費另外計費。運費另外計費。",
  "你必須確認涵蓋範圍；運費不另外計費。", "你必須確認涵蓋範圍；僅運費另外計費。",
  "你必須確認涵蓋範圍；服務費另外計費。", "你必須確認涵蓋範圍。只包含運費。",
])("documents withdrawn runtime fee/restriction rejection capability: %s", async output => {
  expect(confirmation.checkConfirmationRelations(feeSource, output).status).toBe("violation");
  await expect(adapter(output).translator.translate(feeSource, "en", "zh-TW")).resolves.toBe(output);
});
it.each(["請確認涵蓋範圍。請確認交期。", "請確認交期。請確認涵蓋範圍。"])("restores the verified A terminal coverage policy even when core is consistent: %s", async output => {
  const source = "Please confirm what it covers. Please confirm the delivery date too.";
  expect(confirmation.checkConfirmationCore(source, output).status).toBe("consistent");
  await expect(adapter(output).translator.translate(source, "en", "zh-TW")).rejects.toThrow("unspecified_coverage_object_changed");
});
it("retains the verified A terminal specified-category rejection", async () => {
  await expect(adapter("請確認包含哪些服務。").translator.translate("Please confirm what it covers.", "en", "zh-TW")).rejects.toThrow("unspecified_coverage_object_changed");
});
it("never calls the experimental decision entry from the public adapter", async () => {
  const spy = vi.spyOn(confirmation, "checkConfirmationRelations").mockImplementation(() => {throw Error("experiment must remain inactive");});
  try {await expect(adapter("你必須確認涵蓋範圍，但運費另外計費。").translator.translate(feeSource, "en", "zh-TW")).resolves.toBe("你必須確認涵蓋範圍，但運費另外計費。");expect(spy).not.toHaveBeenCalled();}
  finally {spy.mockRestore();}
});
it("retains exact Fine local telemetry with zero provider use", async () => {
  const s = adapter("unused");await expect(s.translator.translate("Fine!", "en", "zh-TW")).resolves.toBe("好的。");
  expect(s.translateText).not.toHaveBeenCalled();expect(s.onMetric).toHaveBeenCalledWith(expect.objectContaining({apiCalled: false, inputCharacters: 0, outputCharacters: 3}));
});
