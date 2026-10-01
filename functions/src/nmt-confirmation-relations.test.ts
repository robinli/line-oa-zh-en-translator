import {describe, expect, it} from "vitest";
import {checkConfirmationRelations, extractConfirmationRelations} from "./nmt-confirmation-relations.js";

describe("finite English to Chinese confirmation relations candidate", () => {
  it.each([
    ["We must confirm what it covers.", "我們必須確認其涵蓋範圍。"],
    ["We need not confirm what it covers.", "我們不必確認其涵蓋範圍。"],
    ["We must not confirm the quantity.", "我們不得確認數量。"],
    ["Please confirm the color.", "請確認顏色。"],
    ["We confirm the delivery date.", "我們確認交期。"],
    ["We must confirm the quantity, but need not confirm the color.", "我們必須確認數量，但不必確認顏色。"],
    ["We must confirm the quantity, but need not confirm the color.", "我們不必確認顏色，但必須確認數量。"],
    ["We must confirm what it covers, and must confirm the delivery date.", "我們必須確認涵蓋範圍，並必須確認交期。"],
    ["We must confirm what it covers, and must confirm the delivery date.", "我們必須確認交期，並必須確認涵蓋範圍。"],
    ["Please confirm what it covers. Please confirm the delivery date too.", "請確認涵蓋範圍。請確認交期。"],
    ["Please confirm what it covers. Please confirm the delivery date too.", "請確認交期。請確認涵蓋範圍。"],
    ["We must confirm what services it covers.", "我們必須確認涵蓋哪些服務。"],
    ["We must confirm whether it only covers service fees.", "我們必須確認是否僅涵蓋服務費。"],
    ["We must confirm what it covers. Service fees are charged separately.", "我們必須確認涵蓋範圍。服務費另計。"],
    ["We must confirm what it covers. Freight is billed separately.", "我們必須確認涵蓋範圍。運費另行收取。"],
    ["We must confirm what it covers. Service fees and freight are listed separately.", "我們必須確認涵蓋範圍。服務費與運費分開計費。"],
  ])("accepts recognized relation controls: %s / %s", (source, target) => {
    expect(checkConfirmationRelations(source, target).status).toBe("consistent");
  });

  it.each([
    ["We must confirm what it covers.", "我們不必確認涵蓋範圍。", "confirmation_modality_changed"],
    ["We need not confirm the delivery date.", "我們必須確認交期。", "confirmation_modality_changed"],
    ["We must not confirm the quantity.", "我們不必確認數量。", "confirmation_modality_changed"],
    ["Please confirm the color.", "你必須確認顏色。", "confirmation_modality_changed"],
    ["We must confirm the quantity, but need not confirm the color.", "我們不必確認數量，但必須確認顏色。", "confirmation_modality_changed"],
    ["We must confirm what it covers.", "我們必須確認涵蓋範圍，僅服務費。", "coverage_restriction_added"],
    ["We must confirm what it covers.", "我們必須確認涵蓋範圍。只包含運費。", "coverage_restriction_added"],
    ["We must confirm what it covers.", "我們必須確認僅涵蓋服務費。", "coverage_restriction_added"],
    ["We must confirm what it covers, and must confirm the delivery date.", "我們必須確認涵蓋範圍，並必須確認交期。只含運費。", "coverage_restriction_added"],
    ["We must confirm what services it covers.", "我們必須確認涵蓋範圍。", "coverage_restriction_removed"],
    ["We must confirm whether it only covers service fees.", "我們必須確認是否涵蓋服務費。", "coverage_restriction_removed"],
    ["We must confirm what it covers. Service fees are charged separately.", "我們必須確認涵蓋範圍。", "independent_cost_relation_changed"],
    ["We must confirm what it covers. Service fees are charged separately.", "我們必須確認涵蓋範圍。服務費另計。服務費另計。", "independent_cost_relation_changed"],
    ["We must confirm the color.", "我們必須確認數量。", "confirmation_object_changed"],
    ["We must confirm the delivery date.", "你必須確認交期。", "confirmation_actor_changed"],
  ])("rejects a recognized changed relation: %s / %s", (source, target, reason) => {
    const result = checkConfirmationRelations(source, target);
    expect(result.status).toBe("violation");
    expect(result.reasons).toContain(reason);
  });

  it.each([
    ["If we must confirm the quantity, contact us.", "如果我們必須確認數量，請聯絡我們。"],
    ['We said "confirm the quantity".', "我們說「確認數量」。"],
    ["We would confirm the color.", "我們會確認顏色。"],
    ["We must confirm it.", "我們必須確認它。"],
    ["The manager must confirm the color.", "經理必須確認顏色。"],
    ["We must confirm the quantity and color.", "我們必須確認數量與顏色。"],
    ["We must confirm the color. You must confirm the quantity.", "我們必須確認顏色。你必須確認數量。"],
    ["We must confirm the quantity.", "數量必須由我們確認。"],
    ["We must confirm the color.", "我們必須核對顏色。"],
    ["We must confirm the quantity.", "我們不是不需要確認數量。"],
    ["We must confirm what it covers. Service fees are payable.", "我們必須確認涵蓋範圍。服務費應付。"],
    ["We must confirm the coverage twice, and must confirm the coverage.", "我們必須確認範圍兩次，並必須確認範圍。"],
    ["We must confirm the delivery date.", "我們必須確認交期及付款。"],
    ["We must confirm what it covers.", "我們必須確認涵蓋的佣金。"],
    ["We must confirm what it covers.", "我們必須確認涵蓋範圍，不必付款。"],
    ["We must confirm what it covers and must notify you.", "我們必須確認涵蓋範圍。"],
    ["We must confirm what it covers. Service fees include support.", "我們必須確認涵蓋服務費。"],
  ])("keeps unsupported parsing explicit: %s / %s", (source, target) => {
    const result = checkConfirmationRelations(source, target);
    expect(result.status).toBe("unknown");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it.each([
    ["We must confirm the quantity.", "我們必須確認數量。", "zh-TW", "en"],
    ["We must confirm the quantity.", "chúng tôi xác nhận", "en", "vi"],
    ["Check the quantity.", "核對數量。", "en", "zh-TW"],
  ])("does not apply outside the candidate direction and action", (source, target, from, to) => {
    expect(checkConfirmationRelations(source, target, from, to).status).toBe("not_applicable");
  });

  it("exposes recognized actor/action/object/modality and source spans without a general quality claim", () => {
    const text = "We must confirm the quantity, but need not confirm the color.";
    const result = extractConfirmationRelations(text, "en");
    expect(result.unknown).toEqual([]);
    expect(result.relations.map(({actor, action, object, modality}) => ({actor, action, object, modality}))).toEqual([
      {actor: "we", action: "confirm", object: "quantity", modality: "required"},
      {actor: "we", action: "confirm", object: "color", modality: "not_required"},
    ]);
    for (const relation of result.relations) expect(text.slice(relation.span.start, relation.span.end)).toContain("confirm");
    expect(checkConfirmationRelations(text, "我們必須確認數量，但不必確認顏色。").scope).toBe("explicit_en_zh_confirmation_object_modality_coverage");
  });
});
