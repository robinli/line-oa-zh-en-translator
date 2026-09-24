import {describe, expect, it} from "vitest";
import {prepareTranslationLlmText} from "./translation-llm-protection.js";
import {validateLlmMentionSubjects} from "./translation-llm-subjects.js";

function prepare(text: string) {
  return prepareTranslationLlmText(text, [], [...text.matchAll(/@[A-Za-z]+/gu)].map(m => ({start: m.index, length: m[0].length})));
}
describe("Translation LLM mention subjects", () => {
  it.each([" Shipment has not yet been committed.", ", we have not committed to shipping.", " has committed to shipping.", " has not received the shipment."])("rejects an erased, reassigned or changed subject status: %s", tail => {
    const p = prepare("@Eric 尚未承諾出貨。");
    expect(() => validateLlmMentionSubjects(p, p.rangeTokens[0]!.token + tail, "zh-TW", "en"))
      .toThrow("mention_subject_changed");
  });
  it.each([" has not yet committed to shipping.", " hasn't promised to ship.", " has not promised shipment."])("accepts the same subject and negative predicate: %s", tail => {
    const p = prepare("@Eric 尚未承諾出貨。");
    expect(() => validateLlmMentionSubjects(p, p.rangeTokens[0]!.token + tail, "zh-TW", "en")).not.toThrow();
  });
  it("retains same-name status identities even when clauses reorder", () => {
    const p = prepare("@Alex 尚未核准；@Alex 已核准。");
    const [a, b] = p.rangeTokens.map(x => x.token);
    expect(() => validateLlmMentionSubjects(p, b + " has approved; " + a + " has not approved.", "zh-TW", "en")).not.toThrow();
    expect(() => validateLlmMentionSubjects(p, b + " has not approved; " + a + " has approved.", "zh-TW", "en"))
      .toThrow("mention_subject_changed");
  });
  it("does not impose declarative subjects on an address or request", () => {
    const p = prepare("@Alex 請向 @Eric 確認。@Mira：尚未承諾。");
    const [a, b, c] = p.rangeTokens.map(x => x.token);
    expect(() => validateLlmMentionSubjects(p, a + ", please confirm with " + b + ". " + c + ": No commitment yet.", "zh-TW", "en"))
      .not.toThrow();
  });
  it("checks the reverse direction and preserves negation", () => {
    const p = prepare("@Alex has not approved. @Mira has already paid.");
    const [a, b] = p.rangeTokens.map(x => x.token);
    expect(() => validateLlmMentionSubjects(p, a + " 尚未核准。" + b + " 已付款。", "en", "zh-TW")).not.toThrow();
    expect(() => validateLlmMentionSubjects(p, a + " 已核准。" + b + " 尚未付款。", "en", "zh-TW"))
      .toThrow("mention_subject_changed");
  });
});


it("does not confuse a negative imperative with an already unapproved status", () => {
  const p = prepare("@Alex do not approve this quote.");
  expect(() => validateLlmMentionSubjects(p, p.rangeTokens[0]!.token + " 不要核准這個報價。", "en", "zh-TW")).not.toThrow();
});
it("accepts normal Chinese perfective and negative variants", () => {
  const p = prepare("@Alex has agreed. @Mira has not replied.");
  const [a, b] = p.rangeTokens.map(x => x.token);
  expect(() => validateLlmMentionSubjects(p, a + " 同意了。" + b + " 還沒有回覆。", "en", "zh-TW")).not.toThrow();
});


it("accepts made-payment and made-commitment wording without losing subjects", () => {
  const p = prepare("@Kumar 尚未付款；@Mira 尚未承諾。");
  const [a, b] = p.rangeTokens.map(x => x.token);
  expect(() => validateLlmMentionSubjects(p, a + " has not made the payment; " + b + " has not yet made a commitment.", "zh-TW", "en"))
    .not.toThrow();
});
it("rejects a prohibition turning into an unfulfilled status", () => {
  const p = prepare("@Eric do not promise shipment.");
  expect(() => validateLlmMentionSubjects(p, p.rangeTokens[0]!.token + " 未承諾出貨。", "en", "zh-TW"))
    .toThrow("mention_command_changed");
});
it("rejects assigning an omitted continuation subject to a new we", () => {
  const p = prepare("@Mira 尚未接受報價，但可以請 @Eric 再問買方。");
  const [a,b] = p.rangeTokens.map(x => x.token);
  expect(() => validateLlmMentionSubjects(p, a + " has not accepted the offer, but we can ask " + b + " to ask again.", "zh-TW", "en"))
    .toThrow("mention_subject_changed");
  expect(() => validateLlmMentionSubjects(p, a + " has not accepted the offer, but can ask " + b + " to ask again.", "zh-TW", "en"))
    .not.toThrow();
});


it("accepts a temporal adverb in a prohibition without accepting a negative status", () => {
  const p = prepare("@Mira Do not make payment yet.");
  for (const tail of ["先不要付款。", "請暫時不要付款。", "暫勿付款。"]) {
    expect(() => validateLlmMentionSubjects(p, p.rangeTokens[0]!.token + tail, "en", "zh-TW")).not.toThrow();
  }
  expect(() => validateLlmMentionSubjects(p, p.rangeTokens[0]!.token + "還沒付款。", "en", "zh-TW")).toThrow("mention_command_changed");
});


it("accepts a limiting adverb with an affirmative status without losing a separate negation", () => {
  const p = prepare("@Eric has not confirmed the address. @Mira has confirmed only the invoice.");
  const [a,b] = p.rangeTokens.map(x => x.token);
  expect(() => validateLlmMentionSubjects(p, a + "尚未確認地址。" + b + "僅確認了發票。", "en", "zh-TW")).not.toThrow();
  expect(() => validateLlmMentionSubjects(p, a + "僅確認地址。" + b + "僅確認了發票。", "en", "zh-TW")).toThrow("mention_subject_changed");
});
