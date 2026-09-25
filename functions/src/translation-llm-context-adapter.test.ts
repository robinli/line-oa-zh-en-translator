import {it, expect, vi} from "vitest";
import {TranslationLlmTranslator, type TranslationLlmRequest} from "./translation-llm-translator.js";
const parent = "projects/test-project/locations/us-central1";
const options = {projectId: "test-project", location: "us-central1", glossaryZhEn: parent + "/glossaries/zh-en", glossaryEnZh: parent + "/glossaries/en-zh"};
it("translates the full Chinese message with visible weights and keeps all paragraph separators", async () => {
  const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
    expect(request.contents).toHaveLength(1);
    expect(request.contents[0]).toContain("20公斤");
    expect(request.contents[0]).toContain("600公斤");
    return [{glossaryTranslations: [{translatedText: '<div id="p0">Prefer 20 kg small bags.</div><div id="p1"></div><div id="p2">Use 600 kg FIBC bags if the small bags are unavailable.</div>'}]}];
  });
  const result = await new TranslationLlmTranslator(options, {translateText}).translate("優先20公斤小袋。\r\n\r\n小袋不可得時使用600公斤 FIBC大袋。", "zh-TW", "en");
  expect(result).toBe("Prefer 20kg small bags.\r\n\r\nUse 600kg FIBC bags if the small bags are unavailable.");
});
it.each([
  ['<div id="p0">使用20 kg個袋子。</div>', "quantity_relationship_changed"],
  ['<div id="p0">使用20 lb的袋子。</div>', "quantity_unit_or_content_changed"],
  ['<div id="p0">使用20 kg及20 kg袋子。</div>', "quantity_unit_or_content_changed"],
  ['使用20 kg的袋子。', "paragraph_structure_changed"],
])("rejects invalid public adapter output and emits only finite private metrics", async (output, reason) => {
  const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
    const span = request.contents[0]!.match(/<span\b[^>]*>20 kg<\/span>/u)?.[0];
    return [{glossaryTranslations: [{translatedText: span && output.includes("<div") ? output.replace("20 kg", span) : output}]}];
  });
  const onMetric = vi.fn();
  await expect(new TranslationLlmTranslator({...options, onMetric}, {translateText}).translate("Use 20 kg bags.", "en", "zh-TW")).rejects.toThrow(reason);
  expect(translateText).toHaveBeenCalledTimes(2);
  expect(onMetric.mock.calls.map(([m]) => m.reason)).toEqual([reason, reason]);
  for (const [metric] of onMetric.mock.calls) expect(Object.keys(metric).sort()).toEqual(["attempt", "direction", "elapsedMs", "engine", "inputCharacters", "outcome", "outputCharacters", "reason"]);
  expect(JSON.stringify(onMetric.mock.calls)).not.toContain("Use");
});
it("accepts a correct prohibition through the real public API", async () => {
  const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: '<div id="p0">總量600 公斤，使用20 公斤袋裝。請保留數值，不要計算袋數。</div>'}]}]);
  await expect(new TranslationLlmTranslator(options, {translateText}).translate("The total is 600 kg, packed in 20 kg bags. Keep these figures; do not calculate the number of bags.", "en", "zh-TW"))
    .resolves.toBe("總量600 kg，使用20 kg袋裝。請保留數值，不要計算袋數。");
});
it("rejects paragraph merging through the real adapter", async () => {
  const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: '<div id="p0">使用20 kg小袋和600 kg大袋。</div>'}]}]);
  await expect(new TranslationLlmTranslator(options, {translateText}).translate("Use 20 kg bags.\n\nUse 600 kg bags.", "en", "zh-TW")).rejects.toThrow("paragraph_structure_changed");
});
it("preserves literal nested entities and never exposes identity mappings", async () => {
  const source = "@A<&amp; 請確認 &amp;amp;";
  const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
    expect(JSON.stringify(request)).not.toContain("sourceStart");
    expect(JSON.stringify(request)).not.toContain("userId");
    return [{glossaryTranslations: [{translatedText: request.contents[0]!.replace("請確認", "Please confirm") }]}];
  });
  const result = await new TranslationLlmTranslator(options, {translateText}).translateWithRanges(source, "zh-TW", "en", {protectedRanges: [{start: 0, length: 8}]});
  expect(result.text).toBe("@A<&amp; Please confirm &amp;amp;");
  expect(result.ranges).toEqual([{sourceStart: 0, start: 0, length: 8}]);
});

it("changes financial structure only after evidence of price role misalignment", async () => {
  const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
    const html = request.contents[0]!;
    const values = [...html.matchAll(/<span\b[^>]*>[^<>]*<\/span>/gu)].map(m => m[0]);
    return [{glossaryTranslations: [{translatedText: values.length ? '<div id="p0">請勿以' + values[0] + '的成本價取代' + values[1] + '的出廠價。</div>' : '<div id="p0">請勿以CAD 542的成本價取代CAD 566的出廠價。</div>'}]}];
  });
  await expect(new TranslationLlmTranslator(options, {translateText}).translate("Do not replace the ex-factory price of CAD 566 with the cost price of CAD 542.", "en", "zh-TW")).resolves.toBe("請勿以CAD 542的成本價取代CAD 566的出廠價。");
  expect(translateText).toHaveBeenCalledTimes(2);
  expect(translateText.mock.calls[1]![0].contents[0]).not.toContain("<span");
});
it("retains financial spans when retrying a missing weight rather than a price role", async () => {
  let attempts = 0;
  const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
    let html = request.contents[0]!.replace("Please retain", "請保留");
    if (++attempts === 1) html = html.replace("3.25 MT", "MT");
    else {expect(html).toMatch(/<span[^>]+>USD 1,045.70<\/span>/u); expect(html).toMatch(/<span[^>]+>3.25 MT<\/span>/u);}
    return [{glossaryTranslations: [{translatedText: html}]}];
  });
  await expect(new TranslationLlmTranslator(options, {translateText}).translate("Please retain USD 1,045.70 and 3.25 MT.", "en", "zh-TW")).resolves.toBe("請保留 USD 1,045.70 and 3.25 MT.");
  expect(translateText).toHaveBeenCalledTimes(2);
});
