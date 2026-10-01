import {expect, it, vi} from "vitest";
import {checkConfirmationRelations} from "./nmt-confirmation-relations.js";
import {NmtGlossaryTranslator} from "./nmt-glossary-translator.js";
const options = {projectId: "test-project", location: "us-central1", protectedNames: [],
  glossaryZhEn: "projects/test-project/locations/us-central1/glossaries/zh-en",
  glossaryEnZh: "projects/test-project/locations/us-central1/glossaries/en-zh"};
function adapter(output: string) {
  const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: '<div id="p0">' + output + '</div>'}]}]);
  return {translator: new NmtGlossaryTranslator(options, {translateText}), translateText};
}
it.each([
  ["I must confirm the quantity, and must confirm the quantity.", "我必須確認數量，並必須確認數量。"],
  ["I must confirm the quantity, and need not confirm the quantity.", "我不必確認數量，並必須確認數量。"],
  ["I must confirm the quantity, and must confirm the quantity.", "必須確認數量，並必須確認數量。"],
  ["I must confirm the quantity, and must confirm the quantity.", "必須確認數量，並我必須確認數量。"],
])("preserves complete same-object frame multiplicity and allowed omission: %s / %s", async (source, output) => {
  expect(checkConfirmationRelations(source, output).status).toBe("consistent");
  const s = adapter(output);await expect(s.translator.translate(source, "en", "zh-TW")).resolves.toBe(output);expect(s.translateText).toHaveBeenCalledTimes(1);
});
it.each([
  "你必須確認數量，並必須確認數量。",
  "必須確認數量，並你必須確認數量。",
])("rejects repeated or backward inherited actor change: %s", async output => {
  const source = "I must confirm the quantity, and must confirm the quantity.";
  expect(checkConfirmationRelations(source, output)).toMatchObject({status: "violation", reasons: ["confirmation_actor_changed"]});
  const s = adapter(output);await expect(s.translator.translate(source, "en", "zh-TW")).rejects.toThrow("confirmation_actor_changed");expect(s.translateText).toHaveBeenCalledTimes(1);
});
it("does not reuse one target frame to cover two required source frames", () => {
  expect(checkConfirmationRelations("I must confirm the quantity, and must confirm the quantity.", "我必須確認數量。")).toMatchObject({status: "violation", reasons: ["confirmation_object_changed"]});
});
it.each([
  ["I must confirm the color, not the quantity.", "我必須確認顏色，而非數量。"],
  ["I must confirm the color; not the quantity.", "我必須確認顏色；而不是數量。"],
  ["I must confirm the quantity, not the delivery date.", "我必須確認數量，而非交期。"],
])("retains faithful known excluded object as unsupported compound: %s / %s", async (source, output) => {
  const check = checkConfirmationRelations(source, output);
  expect(check.status).toBe("unknown");expect(check.source.exclusions).toHaveLength(1);expect(check.target.exclusions).toHaveLength(1);
  const s = adapter(output);await expect(s.translator.translate(source, "en", "zh-TW")).resolves.toBe(output);expect(s.translateText).toHaveBeenCalledTimes(1);
});
it.each([
  "我必須確認顏色。",
  "我必須確認顏色，而非交期。",
])("rejects omission or changed known excluded object: %s", async output => {
  const source = "I must confirm the color, not the quantity.";
  expect(checkConfirmationRelations(source, output)).toMatchObject({status: "violation", reasons: ["confirmation_exclusion_changed"]});
  const s = adapter(output);await expect(s.translator.translate(source, "en", "zh-TW")).rejects.toThrow("confirmation_exclusion_changed");expect(s.translateText).toHaveBeenCalledTimes(1);
});
it.each([
  ["I must confirm the color, not the payment.", "我必須確認顏色。"],
  ["I must confirm the color, and the quantity.", "我必須確認顏色與數量。"],
  ["I must confirm the color, not only the quantity.", "我必須確認顏色。"],
])("never certifies unparsed comma compound or general unknown as consistent: %s", (source, output) => {
  expect(checkConfirmationRelations(source, output).status).toBe("unknown");
});
// Experimental fee/coverage assertions retain the first-repair expectations.
it.each(["運費另外計費。", "運費另行計費。", "運費另計。", "運費分開計費。"])("aligns a full independent freight predicate: %s", async cost => {
  const source = "You must confirm the coverage; shipping charges are billed separately.", output = "你必須確認涵蓋範圍；" + cost;
  expect(checkConfirmationRelations(source, output).status).toBe("consistent");
});
it.each([
  "你必須確認涵蓋範圍。",
  "你必須確認涵蓋範圍；運費另外計費。運費另外計費。",
  "你必須確認涵蓋範圍；服務費另外計費。",
  "你必須確認涵蓋範圍；運費不另外計費。",
  "你必須確認涵蓋範圍；只有運費。",
])("rejects independent freight loss, duplication, category/polarity change or narrowing: %s", async output => {
  const source = "You must confirm the coverage; shipping charges are billed separately.";
  expect(checkConfirmationRelations(source, output).status).toBe("violation");
});
it("does not license a new independent fee or coverage narrowing using fee-shaped text", async () => {
  const source = "You must confirm the coverage.";
  for (const output of ["你必須確認涵蓋範圍；運費另外計費。", "你必須確認涵蓋範圍。僅運費。"]) {
    expect(checkConfirmationRelations(source, output).status).toBe("violation");
  }
});
it.each(["運費另作核算。", "運費大概另計。", "運費可另行計費。"])("leaves unsupported separate-fee wording unknown without invented coverage certainty: %s", cost => {
  expect(checkConfirmationRelations("You must confirm the coverage; shipping charges are billed separately.", "你必須確認涵蓋範圍；" + cost).status).toBe("unknown");
});
