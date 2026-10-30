import {describe, expect, it, vi} from "vitest";
import {VietnameseNmtTranslator, NmtTranslationError} from "./vietnamese-nmt-translator.js";

describe("independent Vietnamese NMT", () => {
  it("keeps the approved phrase exact in NMT, including source whitespace", async () => {
    const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => [{
      translations: contents.map(html => ({translatedText: html.replace("Vui lòng kiểm tra", "請確認")})),
    }]);
    const source = "Vui lòng kiểm tra mít  color.\r\n\r\nmít color";
    const result = await new VietnameseNmtTranslator("test-project", {translateText}).translate(source, "vi", "zh-TW");
    expect(result).toBe("請確認 mít  color.\r\n\r\nmít color");
    expect(translateText.mock.calls[0]![0].contents).toEqual([
      'Vui lòng kiểm tra <span translate="no" class="notranslate" id="m0">mít  color</span>.',
    ]);
  });
  it("does not call NMT for a message consisting only of the approved phrase", async () => {
    const translateText = vi.fn();
    expect(await new VietnameseNmtTranslator("test-project", {translateText}).translate("mít color", "vi", "zh-TW")).toBe("mít color");
    expect(translateText).not.toHaveBeenCalled();
  });
  it("restores source whitespace when NMT collapses only an approved phrase span", async () => {
    const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => [{
      translations: contents.map(html => ({translatedText: html.replace("mít  color", "mít color").replace("Kiểm tra", "請確認")})),
    }]);
    expect(await new VietnameseNmtTranslator("test-project", {translateText}).translate("Kiểm tra mít  color.", "vi", "zh-TW"))
      .toBe("請確認 mít  color.");
    await expect(new VietnameseNmtTranslator("test-project", {translateText}).translate("mít  color Kiểm tra", "vi", "zh-TW", {protectedRanges: [{start: 0, length: 10}]}))
      .rejects.toThrow(NmtTranslationError);
  });
  it("unions a protected term with an overlapping literal code", async () => {
    const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => [{
      translations: contents.map(html => ({translatedText: html.replace("Kiểm tra", "請確認")})),
    }]);
    expect(await new VietnameseNmtTranslator("test-project", {translateText}).translate("Kiểm tra mít color-AB.", "vi", "zh-TW"))
      .toBe("請確認 mít color-AB.");
    expect(translateText.mock.calls[0]![0].contents[0]).toContain('id="m0">mít color-AB</span>');
  });
  it("does not interpret ordinary jackfruit as the protected label", async () => {
    const translateText = vi.fn().mockResolvedValue([{translations: [{translatedText: "我買了菠蘿蜜。"}]}]);
    expect(await new VietnameseNmtTranslator("test-project", {translateText}).translate("Tôi mua mít.", "vi", "zh-TW"))
      .toBe("我買了菠蘿蜜。");
    expect(translateText.mock.calls[0]![0].contents).toEqual(["Tôi mua mít."]);
  });
  it("lets a native mention take precedence over the protected phrase", async () => {
    const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => [{
      translations: contents.map(html => ({translatedText: html.replace("請確認", "Vui lòng kiểm tra")})),
    }]);
    const result = await new VietnameseNmtTranslator("test-project", {translateText})
      .translateWithRanges("@mít color 請確認", "zh-TW", "vi", {protectedRanges: [{start: 0, length: 10}]});
    expect(result.ranges).toEqual([{sourceStart: 0, start: 0, length: 10}]);
    expect(translateText.mock.calls[0]![0].contents[0].match(/<span/gu)).toHaveLength(1);
  });
  it.each(["replace", "drop", "duplicate", "move"])("rejects NMT that would %s the protected phrase", async corruption => {
    const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => {
      const first = contents[0]!, second = contents[1]!;
      const span = first.match(/<span[^>]*>.*?<\/span>/u)![0];
      return [{translations: [
        {translatedText: corruption === "replace" ? first.replace("mít color", "菠蘿蜜") :
          corruption === "drop" || corruption === "move" ? first.replace(span, "") : first + span},
        {translatedText: corruption === "move" ? second + span : second},
      ]}];
    });
    await expect(new VietnameseNmtTranslator("test-project", {translateText}).translate("Kiểm tra mít color.\nCảm ơn.", "vi", "zh-TW"))
      .rejects.toThrow(NmtTranslationError);
  });
  it.each(["mít color", "mít  color", "MÍT\tCOLOR"])("rejects an extra ordinary copy of the approved label: %s", extra => {
    const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => [{
      translations: contents.map(html => ({translatedText: html.replace("</span>", "</span> " + extra)})),
    }]);
    return expect(new VietnameseNmtTranslator("test-project", {translateText}).translate("A mít  color B.\nC.", "vi", "zh-TW"))
      .rejects.toThrow(NmtTranslationError);
  });
  it.each(['id="m0" id="unknown"', 'id="m0" ID="m0"', 'id="m0" bogus="x"', 'id="m0" broken', 'id="m00"'])(
    "rejects ambiguous or incomplete protected attributes: %s", attrs => {
      const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => [{
        translations: contents.map(html => ({translatedText: html.replace('id="m0"', attrs)})),
      }]);
      return expect(new VietnameseNmtTranslator("test-project", {translateText}).translate("A mít color B.", "vi", "zh-TW"))
        .rejects.toThrow(NmtTranslationError);
    });
  it.each([["zh-TW", "vi", "你好", "Xin chào"], ["vi", "zh-TW", "Xin chào", "你好"]])(
    "uses explicit NMT for %s to %s", async (source, target, input, output) => {
      const translateText = vi.fn().mockResolvedValue([{translations: [{translatedText: output}]}]);
      const translator = new VietnameseNmtTranslator("test-project", {translateText});
      expect(await translator.translate(input!, source!, target!)).toBe(output);
      expect(translateText).toHaveBeenCalledWith({
        parent: "projects/test-project/locations/global", model: "projects/test-project/locations/global/models/general/nmt",
        contents: [input], mimeType: "text/html", sourceLanguageCode: source, targetLanguageCode: target,
      }, {timeout: 15000, retry: {retryCodes: []}});
    });
  it("preserves repeated native names and UTF-16 positions in a complete paragraph", async () => {
    const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => [{
      translations: contents.map(html => ({translatedText: html.replace("你好", "Xin chào").replace("謝謝", "Cảm ơn")})),
    }]);
    const text = "😀 @小明 你好 @小明 謝謝";
    const starts = [text.indexOf("@"), text.lastIndexOf("@")];
    const translator = new VietnameseNmtTranslator("test-project", {translateText});
    const result = await translator.translateWithRanges(text, "zh-TW", "vi", {
      protectedRanges: starts.map(start => ({start, length: 3})),
    });
    expect(result.text).toBe("😀 @小明 Xin chào @小明 Cảm ơn");
    expect(translateText.mock.calls[0]![0].contents).toHaveLength(1);
    expect(translateText.mock.calls[0]![0].contents[0]).toContain('class="notranslate"');
    expect(result.ranges).toEqual([
      {sourceStart: starts[0], start: result.text.indexOf("@"), length: 3},
      {sourceStart: starts[1], start: result.text.lastIndexOf("@"), length: 3},
    ]);
  });
  it("separates Vietnamese words from mentions when NMT collapses HTML whitespace", async () => {
    const translateText = vi.fn().mockResolvedValue([{translations: [{
      translatedText: '<span id="m0">@小林</span>Vui lòng liên hệ với <span id="m1">@小林</span>trước.',
    }]}]);
    const source = "@小林 請先聯絡 @小林。";
    const result = await new VietnameseNmtTranslator("test-project", {translateText})
      .translateWithRanges(source, "zh-TW", "vi", {protectedRanges: [
        {start: 0, length: 3}, {start: source.lastIndexOf("@"), length: 3},
      ]});
    expect(result.text).toBe("@小林 Vui lòng liên hệ với @小林 trước.");
    for (const range of result.ranges) expect(result.text.slice(range.start, range.start + range.length)).toBe("@小林");
  });
  it("has no trade validation, prompt or opaque placeholder", async () => {
    const translateText = vi.fn().mockResolvedValue([{translations: [{translatedText: "giá cơ bản"}]}]);
    expect(await new VietnameseNmtTranslator("test-project", {translateText})
      .translate("底價", "zh-TW", "vi")).toBe("giá cơ bản");
    expect(JSON.stringify(translateText.mock.calls)).not.toMatch(/__TRADE_|systemInstruction/u);
  });
  it.each([["zh-TW", "en"], ["en", "zh-TW"], ["vi", "en"], ["vi", "vi"]])(
    "never sends unsupported pair %s/%s", async (source, target) => {
      const translateText = vi.fn();
      await expect(new VietnameseNmtTranslator("test-project", {translateText})
        .translate("hello", source!, target!)).rejects.toThrow("only supports");
      expect(translateText).not.toHaveBeenCalled();
    });
  it.each([[], [{translatedText: ""}], [{translatedText: "a"}, {translatedText: "b"}],
    [{translatedText: "a".repeat(4501)}]].map(translations => ({translations})))
  ("rejects malformed NMT result", async ({translations}) => {
    const translateText = vi.fn().mockResolvedValue([{translations}]);
    await expect(new VietnameseNmtTranslator("test-project", {translateText})
      .translate("你好", "zh-TW", "vi")).rejects.toThrow(NmtTranslationError);
  });
  it("sanitizes provider failures and does not retry", async () => {
    const translateText = vi.fn().mockRejectedValue(new Error("SECRET private message"));
    await expect(new VietnameseNmtTranslator("test-project", {translateText})
      .translate("你好", "zh-TW", "vi")).rejects.toThrow("Vietnamese translation service is unavailable.");
    expect(translateText).toHaveBeenCalledOnce();
  });
  it("preserves paragraph separators and literal HTML entities exactly once", async () => {
    const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => [{
      translations: contents.map(html => ({translatedText: html.replace("你好", "Xin chào").replace("謝謝", "Cảm ơn")})),
    }]);
    const source = "你好 &#x20; <b>\r\n\r\n謝謝 &";
    expect(await new VietnameseNmtTranslator("test-project", {translateText}).translate(source, "zh-TW", "vi"))
      .toBe("Xin chào &#x20; <b>\r\n\r\nCảm ơn &");
    expect(translateText.mock.calls[0]![0].contents).toEqual(["你好 &amp;#x20; &lt;b&gt;", "謝謝 &amp;"]);
  });
  it.each(["missing", "duplicate", "renamed", "unknown", "extra-tag"])(
    "rejects %s mention markup", async corruption => {
      const translateText = vi.fn().mockImplementation(async ({contents}: {contents: string[]}) => {
        let html = contents[0]!.replace("你好", "Xin chào");
        if (corruption === "missing") html = html.replace(/<span[^>]*>.*?<\/span>/u, "");
        if (corruption === "duplicate") html += html;
        if (corruption === "renamed") html = html.replace("@小林", "@別人");
        if (corruption === "unknown") html = html.replace('id="m0"', 'id="m9"');
        if (corruption === "extra-tag") html += "<b>extra</b>";
        return [{translations: [{translatedText: html}]}];
      });
      await expect(new VietnameseNmtTranslator("test-project", {translateText})
        .translate("@小林 你好", "zh-TW", "vi", {protectedRanges: [{start: 0, length: 3}]}))
        .rejects.toThrow(NmtTranslationError);
    });
  it("rejects overlapping ranges before API access", async () => {
    const translateText = vi.fn();
    await expect(new VietnameseNmtTranslator("test-project", {translateText})
      .translate("你好朋友", "zh-TW", "vi", {protectedRanges: [{start: 0, length: 3}, {start: 2, length: 2}]}))
      .rejects.toThrow(NmtTranslationError);
    expect(translateText).not.toHaveBeenCalled();
  });
});
