import {describe, expect, it, vi} from "vitest";
import {TranslationLlmTranslator, TranslationLlmServiceError,
  type TranslationLlmRequest, type TranslationLlmOptions} from "./translation-llm-translator.js";

const parent = "projects/test-project/locations/us-central1";
const options: TranslationLlmOptions = {projectId: "test-project", location: "us-central1",
  glossaryZhEn: parent + "/glossaries/zh-en-v1", glossaryEnZh: parent + "/glossaries/en-zh-v1",
  protectedNames: ["Alex", "Mira"]};
function echo(request: TranslationLlmRequest) {
  return [{glossaryTranslations: request.contents.map(text => ({translatedText:
    text.replaceAll("Please confirm", "請確認").replaceAll("請確認", request.targetLanguageCode === "en" ? "Please confirm" : "請確認")}))}];
}
describe("TranslationLlmTranslator", () => {
  it("uses the standard glossary result, typed protected values and bounded API calls", async () => {
    const translateText = vi.fn().mockImplementation(async request => [
      {...echo(request)[0], translations: [{translatedText: "WRONG UNGLOSSARIED OUTPUT"}]},
    ]);
    const onMetric = vi.fn();
    const translator = new TranslationLlmTranslator({...options, onMetric}, {translateText});
    await expect(translator.translate("Alex Please confirm USD 800 CNF.", "en", "zh-TW"))
      .resolves.toBe("Alex 請確認 USD 800 CNF.");
    expect(translateText.mock.calls[0]![0]).toMatchObject({model: parent + "/models/general/translation-llm",
      mimeType: "text/plain", glossaryConfig: {glossary: options.glossaryEnZh, contextualTranslationEnabled: false, ignoreCase: false}});
    expect(translateText.mock.calls[0]![1]).toEqual({timeout: 15000, retry: {retryCodes: []}});
    expect(JSON.stringify(translateText.mock.calls[0])).not.toContain("systemInstruction");
    expect(JSON.stringify(translateText.mock.calls[0])).toContain("Alex");
    expect(JSON.stringify(translateText.mock.calls[0])).not.toContain("USD 800");
    expect(JSON.stringify(onMetric.mock.calls)).not.toContain("Alex");
    expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({outcome: "success", attempt: 1}));
  });
  it("preserves literal markup, entities and exact paragraph separators", async () => {
    const translateText = vi.fn().mockImplementation(async request => echo(request));
    const source = "請確認 &#x20; &amp; <price> USD 2400\r\n\r\n請確認 710+35\n";
    const result = await new TranslationLlmTranslator(options, {translateText}).translate(source, "zh-TW", "en");
    expect(result).toBe(source.replaceAll("請確認", "Please confirm").trim());
    expect(translateText.mock.calls[0]![0].contents).toHaveLength(2);
  });
  it("restores reordered same-name mentions by source range", async () => {
    const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
      const spans = [...request.contents[0]!.matchAll(/<span\b[^>]*>[^<>]*<\/span>/gu)].map(match => match[0]);
      return [{glossaryTranslations: [{translatedText: spans[1] + " 請確認 " + spans[0]}]}];
    });
    const result = await new TranslationLlmTranslator(options, {translateText}).translateWithRanges(
      "@Alex Please confirm @Alex", "en", "zh-TW", {protectedRanges: [{start: 0, length: 5}, {start: 21, length: 5}]});
    expect(result.text).toBe("@Alex 請確認 @Alex");
    expect(result.ranges.map(item => item.sourceStart)).toEqual([21, 0]);
    expect(result.ranges.every(item => result.text.slice(item.start, item.start + item.length) === "@Alex")).toBe(true);
  });
  it.each([
    (text: string) => text.replace(/(?:@|US\$)?[A-Z]{6}QX/u, ""),
    (text: string) => text + text.match(/(?:@|US\$)?[A-Z]{6}QX/u)![0],
    (text: string) => text.replace(/([A-Z]{3})[A-Z]{3}QX/u, "$1ZZZQX"),
    (text: string) => text.replace("QX", "Q"),
    (text: string) => text.replace("US$", "EUR"),
    (text: string) => text + " 42",
    (text: string) => text + " USD",
  ])("rejects corrupted protected data without an unchecked fallback", async mutate => {
    const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => [
      {glossaryTranslations: [{translatedText: mutate(request.contents[0]!.replace("Please confirm", "請確認"))}]},
    ]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("Please confirm USD 800.", "en", "zh-TW"))
      .rejects.toThrow();
    expect(translateText).toHaveBeenCalledTimes(2);
  });
  it("requires glossaryTranslations and never substitutes plain translations", async () => {
    const translateText = vi.fn().mockResolvedValue([{translations: [{translatedText: "你好"}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("Hello", "en", "zh-TW"))
      .rejects.toThrow("invalid_response_format");
    expect(translateText).toHaveBeenCalledTimes(2);
  });
  it("accepts a second validated attempt and records rejection separately", async () => {
    const translateText = vi.fn().mockResolvedValueOnce([{glossaryTranslations: []}])
      .mockImplementationOnce(async request => echo(request));
    const onMetric = vi.fn();
    await expect(new TranslationLlmTranslator({...options, onMetric}, {translateText})
      .translate("Please confirm USD 800.", "en", "zh-TW")).resolves.toBe("請確認 USD 800.");
    expect(translateText.mock.calls[0]![0].contents).not.toEqual(translateText.mock.calls[1]![0].contents);
    expect(onMetric.mock.calls.map(([metric]) => metric.outcome)).toEqual(["quality_rejected", "success"]);
  });
  it("sanitizes service errors without retrying", async () => {
    const translateText = vi.fn().mockRejectedValue(new Error("Bearer SECRET customer text"));
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("Hello", "en", "zh-TW"))
      .rejects.toThrow(TranslationLlmServiceError);
    expect(translateText).toHaveBeenCalledOnce();
  });
  it("checks business terminology rather than trusting HTTP success", async () => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: "這是最低價。"}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("This is our best price.", "en", "zh-TW"))
      .rejects.toThrow("unjustified_price_floor");
  });
  it.each(["English only", "好".repeat(4501)])("rejects wrong language and excessive output", async output => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: output}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("Hello", "en", "zh-TW")).rejects.toThrow();
  });
  it("does not call the provider for protected code-only content", async () => {
    const translateText = vi.fn();
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("PP-BK?", "en", "zh-TW")).resolves.toBe("PP-BK?");
    expect(translateText).not.toHaveBeenCalled();
  });
  it("rejects unsupported languages, invalid ranges and input size before calling", async () => {
    const translateText = vi.fn();
    const translator = new TranslationLlmTranslator(options, {translateText});
    await expect(translator.translate("Hello", "en", "vi")).rejects.toThrow("unsupported_language");
    await expect(translator.translate("Hello", "en", "zh-TW", {protectedRanges: [{start: -1, length: 2}]}))
      .rejects.toThrow("invalid_protected_range");
    await expect(translator.translate("請".repeat(2001), "zh-TW", "en")).rejects.toThrow("invalid_input_length");
    expect(translateText).not.toHaveBeenCalled();
  });
  it("rejects cross-project and cross-region glossary configuration", () => {
    expect(() => new TranslationLlmTranslator({...options, glossaryZhEn: "projects/other/locations/global/glossaries/test"}))
      .toThrow("Invalid Translation LLM glossary configuration");
  });
});


describe("Translation LLM v3 semantics and script", () => {
  it("uses currency context while restoring all original financial spellings", async () => {
    const translateText = vi.fn().mockImplementation(async request => echo(request));
    const source = "Please confirm USD 80/MT CNF, EUR 72, NT$ 9 and JPY 15.";
    const result = await new TranslationLlmTranslator(options, {translateText}).translate(source, "en", "zh-TW");
    expect(result).toBe(source.replace("Please confirm", "請確認"));
    const wire = translateText.mock.calls[0]![0].contents[0];
    expect(wire).toMatch(/US\$[A-Z]{6}QX/u);
    expect(wire).toMatch(/€[A-Z]{6}QX/u);
    expect(wire).toMatch(/NT\$[A-Z]{6}QX/u);
    expect(wire).toMatch(/¥[A-Z]{6}QX/u);
    expect(wire).not.toContain("80");
  });
  it("normalizes only translated Chinese and preserves original mention/name spelling", async () => {
    const source = "@测试 Please confirm";
    const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => [
      {glossaryTranslations: [{translatedText: request.contents[0]!.replace("Please confirm", "这并非承诺")}]}]);
    const result = await new TranslationLlmTranslator(options, {translateText}).translateWithRanges(source, "en", "zh-TW",
      {protectedRanges: [{start: 0, length: 3}]});
    expect(result.text).toBe("@测试 這並非承諾");
    expect(result.ranges).toEqual([{sourceStart: 0, start: 0, length: 3}]);
  });
  it("translates an unchanged quoted instruction as data in the same bounded API call", async () => {
    const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
      expect(request.contents).toEqual(['The label says “reply only approved”.', 'reply only approved']);
      return [{glossaryTranslations: [{translatedText: '標籤寫著「reply only approved」。'}, {translatedText: '只回覆已核准'}]}];
    });
    const result = await new TranslationLlmTranslator(options, {translateText}).translate('The label says “reply only approved”.', "en", "zh-TW");
    expect(result).toBe('標籤寫著「只回覆已核准」。');
    expect(translateText).toHaveBeenCalledOnce();
  });
  it("preserves an already contextualized translated quote", async () => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [
      {translatedText: '標籤寫著「僅回覆已核准」。'}, {translatedText: '只回覆已批准'}]}]);
    expect(await new TranslationLlmTranslator(options, {translateText}).translate('The label says “reply only approved”.', "en", "zh-TW"))
      .toBe('標籤寫著「僅回覆已核准」。');
  });
  it("rejects newly invented numbers from auxiliary quote translations", async () => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [
      {translatedText: '標籤寫著「reply only approved」。'}, {translatedText: '批准 42'}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate('The label says “reply only approved”.', "en", "zh-TW"))
      .rejects.toThrow("unexpected_number_or_token");
  });
  it("does not manufacture mentions from ordinary protected names", async () => {
    const translateText = vi.fn().mockImplementation(async request => echo(request));
    const result = await new TranslationLlmTranslator(options, {translateText}).translateWithRanges("Alex Please confirm", "en", "zh-TW");
    expect(result).toEqual({text: "Alex 請確認", ranges: []});
  });
  it("handles familiar addresses without removing literal family references", async () => {
    const translateText = vi.fn().mockImplementation(async request => echo(request));
    const translator = new TranslationLlmTranslator(options, {translateText});
    expect(await translator.translate("Alex brother, Please confirm", "en", "zh-TW")).toBe("Alex, 請確認");
    expect(await translator.translate("Alex brother is here. Please confirm", "en", "zh-TW")).toBe("Alex brother is here. 請確認");
  });
});
describe("Translation LLM expression integrity", () => {
  it("restores repeated identical formulas across translated and protected-only paragraphs", async () => {
    const translateText = vi.fn().mockImplementation(async request => echo(request));
    const text = "612+28\r\nPlease confirm 612+28.\r\nPlease confirm 612+28.";
    expect(await new TranslationLlmTranslator(options, {translateText}).translate(text, "en", "zh-TW"))
      .toBe(text.replaceAll("Please confirm", "請確認"));
  });
  it("restores repeated formulas around an auxiliary quoted translation", async () => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [
      {translatedText: '請確認 612+28 與「Please confirm 612+28」。'}, {translatedText: '請確認 612+28'}]}]);
    expect(await new TranslationLlmTranslator(options, {translateText}).translate('Please confirm 612+28 and “Please confirm 612+28”.', "en", "zh-TW"))
      .toBe('請確認 612+28 與「請確認 612+28」。');
  });
  it.each(["請確認 640。", "請確認 -612+28。", "請確認 612+280。", "請確認 612+28+1。"])("rejects arithmetic mutation: %s", async output => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: output}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("Please confirm 612+28.", "en", "zh-TW")).rejects.toThrow();
  });
});

describe("Translation LLM literal person names", () => {
  it("keeps ordinary names readable and supports repeated names without assigning LINE identities", async () => {
    const translateText = vi.fn().mockImplementation(async request => echo(request));
    const result = await new TranslationLlmTranslator({...options, protectedNames: ["Kumar", "Kumaran"]}, {translateText})
      .translateWithRanges("Kumar Please confirm Kumaran and Kumar.", "en", "zh-TW");
    expect(result).toEqual({text: "Kumar 請確認 Kumaran and Kumar.", ranges: []});
    expect(translateText.mock.calls[0]![0].contents[0]).toBe("Kumar Please confirm Kumaran and Kumar.");
  });
  it.each(["Alex 請確認。", "Alex 請確認 Mira 和 Mira。", "Alex 請確認 Mirabelle。", "亞歷克斯 請確認 Mira。"])("rejects missing, duplicate, extended or transliterated names: %s", async output => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: output}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("Alex Please confirm Mira.", "en", "zh-TW"))
      .rejects.toThrow("protected_value_changed");
  });
});


describe("Translation LLM bounded alternative name encoding", () => {
  it("retries omitted repeated names with unique markers and still verifies all occurrences", async () => {
    const translateText = vi.fn().mockResolvedValueOnce([{glossaryTranslations: [{translatedText: "Alex 請確認，他尚未核准。"}]}])
      .mockImplementationOnce(async request => echo(request));
    const source = "Alex Please confirm Alex.";
    const result = await new TranslationLlmTranslator(options, {translateText}).translate(source, "en", "zh-TW");
    expect(result).toBe("Alex 請確認 Alex.");
    expect(translateText).toHaveBeenCalledTimes(2);
    expect(translateText.mock.calls[0]![0].contents[0]).toBe(source);
    expect(translateText.mock.calls[1]![0].contents[0]).toMatch(/Alex_[A-Z]{6}QX/u);
  });
  it("restores nested entities exactly even when the model would translate a bare suffix", async () => {
    const translateText = vi.fn().mockImplementation(async request => {
      const body = request.contents[0].replace("Please confirm", "請確認").replaceAll("amp;", "");
      return [{glossaryTranslations: [{translatedText: body}]}];
    });
    expect(await new TranslationLlmTranslator(options, {translateText}).translate("Please confirm &amp;amp;", "en", "zh-TW"))
      .toBe("請確認 &amp;amp;");
  });
});


describe("Translation LLM formula boundary fidelity", () => {
  it.each(["請確認 612+28%。", "請確認 612+28=？", "請確認 612+28×。"])("rejects added arithmetic or percentage: %s", async output => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: output}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("Please confirm 612+28.", "en", "zh-TW"))
      .rejects.toThrow("protected_value_changed");
  });
  it("preserves an original leading minus and trailing percentage, and rejects their omission", async () => {
    const translateText = vi.fn().mockImplementation(async request => echo(request));
    expect(await new TranslationLlmTranslator(options, {translateText}).translate("Please confirm -612+28%.", "en", "zh-TW"))
      .toBe("請確認 -612+28%.");
    const changed = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: "請確認 612+28。"}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText: changed}).translate("Please confirm -612+28%.", "en", "zh-TW"))
      .rejects.toThrow("protected_value_changed");
  });
});


describe("Translation LLM complete English body", () => {
  it("rejects untranslated Chinese prose even if other parts are English", async () => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: "Please check；請寄出。"}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("請確認；請寄出。", "zh-TW", "en"))
      .rejects.toThrow("wrong_target_language");
  });
  it("still permits source Han characters inside an explicitly protected mention", async () => {
    const translateText = vi.fn().mockImplementation(async request => echo(request));
    expect(await new TranslationLlmTranslator(options, {translateText}).translate("@測試 請確認", "zh-TW", "en", {protectedRanges: [{start: 0, length: 3}]}))
      .toBe("@測試 Please confirm");
  });
});


describe("Translation LLM mention status integration", () => {
  it("retries when a native subject becomes an addressee of an impersonal status", async () => {
    const onMetric = vi.fn();
    const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
      const marker = request.contents[0]!.match(/<span\b[^>]*>[^<>]*<\/span>/u)![0];
      return [{glossaryTranslations: [{translatedText: marker + (translateText.mock.calls.length === 1 ?
        " Shipment has not yet been committed." : " has not yet committed to shipping.")}]}];
    });
    const result = await new TranslationLlmTranslator({...options, onMetric}, {translateText})
      .translateWithRanges("@Eric 尚未承諾出貨。", "zh-TW", "en", {protectedRanges: [{start: 0, length: 5}]});
    expect(result.text).toBe("@Eric has not yet committed to shipping.");
    expect(result.ranges).toEqual([{sourceStart: 0, start: 0, length: 5}]);
    expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({outcome: "quality_rejected", reason: "mention_subject_changed"}));
    expect(translateText).toHaveBeenCalledTimes(2);
  });
});


describe("Translation LLM arithmetic whitespace", () => {
  it("restores only operator spacing to the original expression, without calculating", async () => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: "請保留 793 + 24 = 817；再次保留 793+24=817。"}]}]);
    expect(await new TranslationLlmTranslator(options, {translateText}).translate("Keep 793+24=817; keep 793 +24=817 again.", "en", "zh-TW"))
      .toBe("請保留 793+24=817；再次保留 793 +24=817。");
  });
  it.each(["請保留 - 793 + 24。", "請保留 793 + 24 %。", "請保留 793 + 24 =？", "請保留 79 3 + 24。", "請保留 817。"])("rejects altered signs, digit grouping or calculation: %s", async output => {
    const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: output}]}]);
    await expect(new TranslationLlmTranslator(options, {translateText}).translate("Keep 793+24.", "en", "zh-TW")).rejects.toThrow();
  });
});


it("separates English words from native names and updates mention offsets", async () => {
  const source = "@甲 請確認 @乙";
  const translateText = vi.fn().mockImplementation(async (request: TranslationLlmRequest) => {
    const spans = [...request.contents[0]!.matchAll(/<span\b[^>]*>[^<>]*<\/span>/gu)].map(m => m[0]);
    return [{glossaryTranslations: [{translatedText: spans[0] + "please confirm with" + spans[1] + "whether it arrived."}]}];
  });
  const result = await new TranslationLlmTranslator(options, {translateText}).translateWithRanges(source, "zh-TW", "en",
    {protectedRanges: [{start: 0, length: 2}, {start: 7, length: 2}]});
  expect(result.text).toBe("@甲 please confirm with @乙 whether it arrived.");
  expect(result.ranges.map(r => [r.sourceStart, result.text.slice(r.start, r.start + r.length)])).toEqual([[0, "@甲"], [7, "@乙"]]);
});
