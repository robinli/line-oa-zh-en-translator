import {expect, it, vi} from "vitest";
import {NmtDirectTranslator, NmtDirectServiceError} from "./nmt-direct-translator.js";
import {SolReviewedTranslator} from "./sol-reviewed-translator.js";
import {SolServiceError, type SolReviewRecord, type SolStageControl, type SolVerdict} from "./sol-review-types.js";
import {TranslationQualityError} from "./trade-policy.js";
import {NMT_TEST_PROJECT} from "./nmt-isolation.js";
import {createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";
import type {SolClient} from "./sol-responses-client.js";
const usage = {inputTokens: 100, outputTokens: 40, cachedInputTokens: 0, reasoningTokens: 10};
function setup(output = "Please confirm.", verdict: SolVerdict = "OK", rewrite = "Please confirm.") {
  let record: SolReviewRecord | undefined;
  const send = vi.fn(async () => [{translations: [{translatedText: output}]}] as [{translations: {translatedText: string}[]}]);
  const sol: SolClient = {review: vi.fn(async () => ({verdict, reason: "語意判定", usage})), rewrite: vi.fn(async () => ({translation: rewrite, usage}))};
  const stages: SolStageControl = {begin: vi.fn(async () => {}), finish: vi.fn(async () => {})};
  const translator = new SolReviewedTranslator(new NmtDirectTranslator({projectId: NMT_TEST_PROJECT, profile: "nmt-direct-v1", protectedNames: ["Alex"]}, {translateText: send}),
    sol, stages, ["Alex"], value => {record = structuredClone(value);});
  return {translator, send, sol, stages, record: () => record!};
}
it("accepts NMT once after OK and never rewrites", async () => {
  const t = setup(); expect(await t.translator.translate("請確認。", "zh-TW", "en")).toBe("Please confirm.");
  expect(t.send).toHaveBeenCalledOnce(); expect(t.sol.review).toHaveBeenCalledOnce(); expect(t.sol.rewrite).not.toHaveBeenCalled();
  expect(t.record()).toMatchObject({nmtCheck: "passed", verdict: "OK", finalSource: "nmt", semanticEvaluation: "nmt_accepted"});
});
it.each(["NOT_GOOD", "UNCERTAIN"] as const)("retranslates original once for %s without another review", async verdict => {
  const t = setup("BAD PRIVATE NMT", verdict, "Please confirm.");
  expect(await t.translator.translate("請確認。", "zh-TW", "en", {quoteContext: {status: "known", text: "之前的條件"}})).toBe("Please confirm.");
  expect(t.sol.review).toHaveBeenCalledOnce(); expect(t.sol.rewrite).toHaveBeenCalledOnce();
  expect(t.sol.rewrite).toHaveBeenCalledWith("請確認。", "請確認。", "text/plain", "zh-TW", "en", {status: "known", text: "之前的條件"}, expect.any(Number));
  expect(t.record()).toMatchObject({verdict, finalSource: "gpt", semanticEvaluation: "not_evaluated"});
});
it("rescues a rejected NMT literal/paragraph using the same carrier and native occurrence IDs", async () => {
  const source = "@Alex 請 Alex 確認 AB-123 USD 300。\r\n\r\n明天回覆。",
    context = {protectedRanges: [{start: 0, length: 5}]};
  const carrier = createNmtTransport(createLiteralManifest(source, ["Alex"], context)).contents[0]!;
  const rewritten = carrier.replace("請", "Please ask").replace("確認", "to confirm").replace("明天回覆。", "Reply tomorrow.");
  const t = setup("<div>lost spans and lines</div>", "OK", rewritten);
  const result = await t.translator.translateWithRanges(source, "zh-TW", "en", context);
  expect(result.text).toContain("AB-123 USD 300"); expect(result.text).toContain("\r\n\r\n");
  expect(result.ranges).toContainEqual({sourceStart: 0, start: 0, length: 5});
  expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).toHaveBeenCalledOnce();
  expect(t.record()).toMatchObject({nmtCheck: "rejected", finalSource: "gpt", rewrite: {status: "succeeded"}});
});
it("rejects an unsafe GPT output and never exposes it in stage metadata", async () => {
  const t = setup("Alex 請確認", "NOT_GOOD", "PRIVATE REJECTED");
  await expect(t.translator.translate("Alex 請確認。", "zh-TW", "en")).rejects.toThrow(TranslationQualityError);
  expect(t.record()).toMatchObject({finalSource: null, rewrite: {status: "rejected"}});
  expect(JSON.stringify(t.record())).not.toContain("PRIVATE REJECTED");
});
it("does not rescue input errors or NMT API errors", async () => {
  const t = setup(); await expect(t.translator.translate("x".repeat(2001), "en", "zh-TW")).rejects.toThrow(TranslationQualityError);
  expect(t.send).not.toHaveBeenCalled(); expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).not.toHaveBeenCalled();
  t.send.mockRejectedValue(new Error("PRIVATE"));
  await expect(t.translator.translate("請確認。", "zh-TW", "en")).rejects.toThrow(NmtDirectServiceError);
  expect(t.sol.rewrite).not.toHaveBeenCalled();
});
it("does not rewrite or retry after Sol failure or unknown result", async () => {
  const t = setup(); vi.mocked(t.sol.review).mockRejectedValue(new SolServiceError("review", "sol_unavailable"));
  await expect(t.translator.translate("請確認。", "zh-TW", "en")).rejects.toThrow(SolServiceError);
  expect(t.sol.review).toHaveBeenCalledOnce(); expect(t.sol.rewrite).not.toHaveBeenCalled();
  expect(t.record().review.status).toBe("unknown");
});
it("persists started before send and refuses send after failed stage control", async () => {
  const t = setup(); vi.mocked(t.stages.begin).mockRejectedValue(new Error("ack unknown"));
  await expect(t.translator.translate("請確認。", "zh-TW", "en")).rejects.toThrow(SolServiceError);
  expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).not.toHaveBeenCalled();
});
it("shares the deadline and preserves zero calls for local Fine", async () => {
  const t = setup(); await expect(t.translator.translate("請確認。", "zh-TW", "en", {deadlineAtMs: Date.now() + 9999})).rejects.toThrow();
  expect(t.send).not.toHaveBeenCalled(); expect(t.sol.review).not.toHaveBeenCalled();
  expect(await t.translator.translate("Fine!", "en", "zh-TW")).toBe("好的。"); expect(t.sol.review).not.toHaveBeenCalled();
});
it("handles the reverse direction with local Traditional Chinese presentation", async () => {
  const t = setup("请确认。", "NOT_GOOD", "请确认。");
  expect(await t.translator.translate("Please confirm.", "en", "zh-TW")).toBe("請確認。");
});
it("does not call any model again when the durable stage already started", async () => {
  const t = setup(); let started = false;
  vi.mocked(t.stages.begin).mockImplementation(async () => {if (started) throw Error("started"); started = true;});
  await t.translator.translate("請確認。", "zh-TW", "en");
  await expect(t.translator.translate("請確認。", "zh-TW", "en")).rejects.toThrow(SolServiceError);
  expect(t.sol.review).toHaveBeenCalledOnce();
});
