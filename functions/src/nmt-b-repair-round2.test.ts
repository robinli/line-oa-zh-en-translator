import {expect, it, vi} from "vitest";
import {checkConfirmationRelations} from "./nmt-confirmation-relations.js";
// Experimental b3 controls only: original sources and expectations retained.
// These fee/coverage capabilities have been withdrawn from runtime.
const confirmEn = "You must confirm the coverage", feeEn = "shipping charges are billed separately";
const confirmZh = "你必須確認涵蓋範圍", feeZh = "運費另外計費";
it.each([
  [confirmEn + "; " + feeEn + ".", confirmZh + "，" + feeZh + "。"],
  [confirmEn + ", and " + feeEn + ".", confirmZh + "；" + feeZh + "。"],
])("retains the original failed fee boundary controls: %s / %s", async (source, output) => {
  expect(checkConfirmationRelations(source, output).status).toBe("consistent");
});
const matrix = [". ", "; ", ", ", ", and ", " and "].flatMap(fromJoin =>
  ["。", "；", "，", "，並", "並"].flatMap(toJoin =>
    [false, true].flatMap(sourceFeeFirst => [false, true].map(targetFeeFirst => ({
      source: (sourceFeeFirst ? feeEn + fromJoin + confirmEn : confirmEn + fromJoin + feeEn) + ".",
      target: (targetFeeFirst ? feeZh + toJoin + confirmZh : confirmZh + toJoin + feeZh) + "。",
    })))));
it.each(matrix)("compares complete fee/confirmation frames across punctuation and order: $source / $target", async ({source, target}) => {
  const check = checkConfirmationRelations(source, target);
  expect(check.status).toBe("consistent");
  expect(check.source.independentFees).toHaveLength(1);expect(check.target.independentFees).toHaveLength(1);
  expect(check.source.relations[0]!.restrictions).toMatchObject({categories: [], only: false});
  expect(check.target.relations[0]!.restrictions).toMatchObject({categories: [], only: false});
  for (const [text, extraction] of [[source, check.source], [target, check.target]] as const) {
    const span = extraction.independentFees[0]!.span;
    expect(text.slice(span.start, span.end)).toContain(text === source ? "billed separately" : "另外計費");
    expect(text.slice(span.start, span.end)).not.toContain(text === source ? "confirm" : "確認");
  }
});
it.each(["，僅服務費。", "。只包含運費。", "；僅涵蓋服務費。"])("does not discard a restriction after a complete fee frame: %s", async suffix => {
  const source = confirmEn + "; " + feeEn + ".", output = confirmZh + "，" + feeZh + suffix;
  const check = checkConfirmationRelations(source, output);
  expect(check.status).toBe("violation");expect(check.reasons).toContain("coverage_restriction_added");
  expect(check.target.independentFees).toHaveLength(1);
});
it.each([
  confirmZh + "，運費不另外計費。",
  confirmZh + "，僅運費另外計費。",
  confirmZh + "，服務費另外計費。",
  confirmZh + "。",
  confirmZh + "，" + feeZh + "，" + feeZh + "。",
])("preserves complete independent fee polarity/only/category/multiplicity across comma: %s", async output => {
  const source = confirmEn + ", and " + feeEn + ".";
  expect(checkConfirmationRelations(source, output).status).toBe("violation");
});
it("keeps a fee category list intact without overlapping extraction at its internal and", async () => {
  const source = confirmEn + ", and service fees and freight are billed separately.";
  const output = confirmZh + "，服務費與運費另外計費。";
  const check = checkConfirmationRelations(source, output);
  expect(check.status).toBe("consistent");expect(check.source.independentFees).toHaveLength(1);expect(check.target.independentFees).toHaveLength(1);
  expect(check.source.independentFees[0]!.categories).toEqual(["service", "freight"]);
  const span = check.source.independentFees[0]!.span;expect(source.slice(span.start, span.end)).toBe("service fees and freight are billed separately");
});
it("rejects removal of one independently billed category from a complete list", async () => {
  const source = confirmEn + ", and service fees and freight are billed separately.", output = confirmZh + "，運費另外計費。";
  expect(checkConfirmationRelations(source, output).status).toBe("violation");
});
it("does not borrow a fee predicate from a coverage object to manufacture an independent relation", async () => {
  const source = "You must confirm whether it only covers shipping charges.", output = "你必須確認是否僅涵蓋運費。";
  const check = checkConfirmationRelations(source, output);expect(check.status).toBe("consistent");
  expect(check.source.independentFees).toEqual([]);expect(check.target.independentFees).toEqual([]);
});
it.each(["運費大概另計。", "運費可另行計費。", "運費另作核算。", "運費另外計費以後再說。"])("keeps the whole unsupported fee candidate unknown without span removal: %s", cost => {
  const source = confirmEn + "; " + feeEn + ".", output = confirmZh + "，" + cost;
  const check = checkConfirmationRelations(source, output);
  expect(check.status).toBe("unknown");expect(check.target.independentFees).toEqual([]);
  expect(check.target.unknown.some(item => output.slice(item.span.start, item.span.end).includes("運費"))).toBe(true);
});
it("does not strip an unsupported source fee before declaring consistency", () => {
  const source = confirmEn + ", and shipping charges may be billed separately.", output = confirmZh + "。";
  const check = checkConfirmationRelations(source, output);expect(check.status).toBe("unknown");expect(check.source.independentFees).toEqual([]);
  expect(check.source.unknown.some(item => source.slice(item.span.start, item.span.end).includes("shipping charges"))).toBe(true);
});
it("rejects a complete fee added to a source that has only neutral coverage", async () => {
  const source = confirmEn + ".", output = confirmZh + "，" + feeZh + "。";
  expect(checkConfirmationRelations(source, output).status).toBe("violation");
});
