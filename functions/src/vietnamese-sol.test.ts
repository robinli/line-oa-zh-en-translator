import {expect, it, vi} from "vitest";
import {createVietnameseTranslator} from "./translator-factory.js";
import {createVietnameseLiteralManifest} from "./vietnamese-literal-policy.js";
import {NmtTranslationError, VietnameseNmtOutputRejected, VietnameseNmtTranslator} from "./vietnamese-nmt-translator.js";
import type {SolClient} from "./sol-responses-client.js";
import type {SolReviewRecord, SolVerdict} from "./sol-review-types.js";
import {SolServiceError} from "./sol-review-types.js";
import {NMT_TEST_PROJECT} from "./nmt-isolation.js";
const usage = {inputTokens: 30, outputTokens: 20, cachedInputTokens: 0, reasoningTokens: 0};
const intoChinese = (text: string) => text.replaceAll("Vui lòng kiểm tra", "請確認").replaceAll("Cảm ơn", "謝謝");
function setup(verdict: SolVerdict = "OK") {
  const send = vi.fn(async ({contents}: {contents: string[]}) => [{translations: contents.map(text => ({translatedText: intoChinese(text)}))}] as [{translations: {translatedText: string}[]}]);
  const sol: SolClient = {review: vi.fn(async () => ({verdict, reason: "語意判定", usage})),
    rewrite: vi.fn(async (_original: string, carrier: string) => ({translation: intoChinese(carrier), usage}))};
  const stages = {begin: vi.fn(async () => {}), finish: vi.fn(async () => {})};
  let record: SolReviewRecord | undefined;
  const translator = createVietnameseTranslator({projectId: NMT_TEST_PROJECT, client: {translateText: send},
    solReview: {client: sol, stages, onRecord: value => {record = structuredClone(value);}}});
  return {translator, send, sol, stages, record: () => record!};
}
const source = "Vui lòng kiểm tra mít  color AB-123.\r\n\r\nCảm ơn.";

it("reviews Chinese/Vietnamese NMT and accepts OK without rewriting", async () => {
  const t = setup();
  expect(await t.translator.translate(source, "vi", "zh-TW")).toBe("請確認 mít  color AB-123.\r\n\r\n謝謝.");
  expect(t.send).toHaveBeenCalledOnce(); expect(t.sol.review).toHaveBeenCalledOnce(); expect(t.sol.rewrite).not.toHaveBeenCalled();
  expect(t.record()).toMatchObject({nmtCheck: "passed", verdict: "OK", finalSource: "nmt", sourceLanguageCode: "vi", targetLanguageCode: "zh-TW"});
});
it.each(["NOT_GOOD", "UNCERTAIN"] as const)("rewrites the original once for %s, retaining carrier and quote", async verdict => {
  const t = setup(verdict);
  const result = await t.translator.translate(source, "vi", "zh-TW", {quoteContext: {status: "known", text: "之前的已保存原文"}});
  expect(result).toContain("mít  color AB-123"); expect(result).toContain("\r\n\r\n");
  expect(t.sol.review).toHaveBeenCalledOnce(); expect(t.sol.rewrite).toHaveBeenCalledOnce();
  expect(t.sol.rewrite).toHaveBeenCalledWith(source, expect.stringContaining('id="l0">mít  color</span>'), "text/html", "vi", "zh-TW", {status: "known", text: "之前的已保存原文"}, expect.any(Number));
  expect(t.record()).toMatchObject({finalSource: "gpt", semanticEvaluation: "not_evaluated"});
});
it("retains native source positions in a Vietnamese rewrite", async () => {
  const t = setup("NOT_GOOD"), text = "@測試 Vui lòng kiểm tra mít color.";
  const result = await t.translator.translateWithRanges!(text, "vi", "zh-TW", {protectedRanges: [{start: 0, length: 3}]});
  expect(result.ranges).toEqual([{sourceStart: 0, start: 0, length: 3}]);
  expect(result.text).toBe("@測試 請確認 mít color.");
});
it("rescues a complete nonempty NMT literal rejection without reviewing it", async () => {
  const t = setup(); t.send.mockImplementation(async ({contents}) => [{translations: contents.map(text => ({translatedText: text.replace(/<span[^>]*>mít  color<\/span>/u, "")}))}]);
  expect(await t.translator.translate(source, "vi", "zh-TW")).toContain("mít  color");
  expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).toHaveBeenCalledOnce();
  expect(t.record()).toMatchObject({nmtCheck: "rejected", nmtReason: "nmt_output_validation", finalSource: "gpt"});
});
it("separates provider failures from recoverable returned content", async () => {
  const t = setup(); t.send.mockRejectedValue(new Error("private provider detail"));
  await expect(t.translator.translate(source, "vi", "zh-TW")).rejects.toThrow(NmtTranslationError);
  expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).not.toHaveBeenCalled();
});
it.each([[], [{translatedText: ""}], [{translatedText: "one"}]].map(translations => ({translations})))("does not rescue missing, empty or truncated response arrays", async ({translations}) => {
  const t = setup(); t.send.mockResolvedValue([{translations}]);
  await expect(t.translator.translate(source, "vi", "zh-TW")).rejects.toThrow(NmtTranslationError);
  expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).not.toHaveBeenCalled();
});
it("skips NMT and Sol when only protected text remains", async () => {
  const t = setup(); expect(await t.translator.translate("mít color", "vi", "zh-TW")).toBe("mít color");
  expect(t.send).not.toHaveBeenCalled(); expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).not.toHaveBeenCalled();
  expect(t.record()).toMatchObject({nmtCheck: "local", finalSource: "local"});
});
it("does not send after deadline expiry or a failed stage admission", async () => {
  const t = setup();
  await expect(t.translator.translate(source, "vi", "zh-TW", {deadlineAtMs: Date.now() + 9999})).rejects.toThrow();
  expect(t.send).not.toHaveBeenCalled();
  t.stages.begin.mockRejectedValue(new Error("ack unknown"));
  await expect(t.translator.translate(source, "vi", "zh-TW")).rejects.toThrow(SolServiceError);
  expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).not.toHaveBeenCalled();
});
it("fails closed after Sol or rewritten literal failure", async () => {
  const t = setup("NOT_GOOD"); vi.mocked(t.sol.rewrite).mockResolvedValue({translation: "changed content", usage});
  await expect(t.translator.translate(source, "vi", "zh-TW")).rejects.toThrow();
  expect(t.record()).toMatchObject({rewrite: {status: "rejected"}, finalSource: null});
  const failed = setup(); vi.mocked(failed.sol.review).mockRejectedValue(new SolServiceError("review", "sol_unavailable"));
  await expect(failed.translator.translate(source, "vi", "zh-TW")).rejects.toThrow(SolServiceError);
  expect(failed.sol.rewrite).not.toHaveBeenCalled();
});
it("keeps the Chinese to Vietnamese direction and presentation", async () => {
  const t = setup("NOT_GOOD"); vi.mocked(t.sol.rewrite).mockImplementation(async (_text, carrier) => ({translation: carrier.replace("請確認", "Vui lòng kiểm tra"), usage}));
  expect(await t.translator.translate("請確認 mít color。", "zh-TW", "vi")).toBe("Vui lòng kiểm tra mít color。");
  expect(t.sol.review).toHaveBeenCalledWith("請確認 mít color。", expect.any(String), "zh-TW", "vi", {status: "not_quoted"}, expect.any(Number));
});
it("uses the original Vietnamese translator when the Sol switch is off", () => {
  expect(createVietnameseTranslator({projectId: NMT_TEST_PROJECT, client: {translateText: vi.fn()}})).toBeInstanceOf(VietnameseNmtTranslator);
});
it("does not load English business-name or directive policy in a Vietnamese carrier", () => {
  const manifest = createVietnameseLiteralManifest('Alex CNF "不要翻譯" mít color 20/box');
  expect(manifest.directives).toEqual([]);
  expect(manifest.occurrences.map(item => item.value)).toEqual(["mít color", "20/box"]);
  expect(() => createVietnameseLiteralManifest("A\nB", {protectedRanges: [{start: 0, length: 3}]})).toThrow();
});
it("identifies only complete nonempty content as recoverable", async () => {
  const rejected = new VietnameseNmtTranslator(NMT_TEST_PROJECT, {translateText: async () => [{translations: [{translatedText: "<b>bad</b>"}]}]});
  await expect(rejected.translateCandidate("mít color 請確認", "zh-TW", "vi")).rejects.toThrow(VietnameseNmtOutputRejected);
});
it.each(["native-move", "code-copy", "native-copy", "lf", "cr", "crlf", "ls", "ps", "entity-lf", "entity-cr", "entity-ls", "entity-ps"])(
  "uses the full source manifest before review and rescues %s once", async fault => {
    const t = setup(), text = "@測試 Vui lòng kiểm tra AB-123.\nCảm ơn.";
    t.send.mockImplementation(async ({contents}) => {
      const translated = contents.map(intoChinese);
      const span = translated[0]!.match(/<span[^>]*>@測試<\/span>/u)![0];
      if (fault === "native-move") {translated[0] = translated[0]!.replace(span, ""); translated[1] += span;}
      else if (fault === "code-copy") translated[0] += " AB-123";
      else if (fault === "native-copy") translated[0] += " @測試";
      else translated[0] = translated[0]! + ({lf: "\n", cr: "\r", crlf: "\r\n", ls: "\u2028", ps: "\u2029", "entity-lf": "&#10;", "entity-cr": "&#13;", "entity-ls": "&#x2028;", "entity-ps": "&#8233;"} as Record<string, string>)[fault]!;
      return [{translations: translated.map(translatedText => ({translatedText}))}];
    });
    const result = await t.translator.translateWithRanges!(text, "vi", "zh-TW", {protectedRanges: [{start: 0, length: 3}]});
    expect(result.text).toBe("@測試 請確認 AB-123.\n謝謝.");
    expect(result.ranges).toEqual([{sourceStart: 0, start: 0, length: 3}]);
    expect(t.sol.review).not.toHaveBeenCalled(); expect(t.sol.rewrite).toHaveBeenCalledOnce();
    expect(t.record()).toMatchObject({nmtCheck: "rejected", finalSource: "gpt"});
  });
it("accepts faithful repeated codes, same-name native offsets, emoji, blank paragraphs and reordering", async () => {
  const t = setup(), text = "😀 @測試 Vui lòng kiểm tra AB-123 AB-123.\r\n\r\n@測試 Cảm ơn.";
  t.send.mockImplementation(async ({contents}) => [{translations: contents.map(value => ({translatedText: value.includes("Vui lòng kiểm tra") ? intoChinese(value).replace("請確認 ", "").replace(/<\/span>\.$/u, "</span> 請確認.") : intoChinese(value)}))}]);
  const result = await t.translator.translateWithRanges!(text, "vi", "zh-TW", {protectedRanges: [{start: 3, length: 3}, {start: text.lastIndexOf("@"), length: 3}]});
  expect(result.text).toBe("😀 @測試 AB-123 AB-123 請確認.\r\n\r\n@測試 謝謝.");
  expect(result.ranges.map(range => range.sourceStart)).toEqual([3, text.lastIndexOf("@")]);
  expect(t.sol.review).toHaveBeenCalledOnce(); expect(t.sol.rewrite).not.toHaveBeenCalled();
});
