import {describe, it, expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {createContextLlmHtml} from "./nmt-context-html.js";
import {validateNmtTradeRelations} from "./nmt-trade-relations.js";
import {NmtGlossaryTranslator} from "./nmt-glossary-translator.js";
const names = ["Alex", "Mira", "Kumar", "Kumaran"];
const prepare = (source: string) => prepareLlmContext(source, names, [], "zh-TW");
const html = (source: string) => createContextLlmHtml(prepare(source));
const source = "The USD 50 is not an agreed commission. Alex must confirm what it covers.";
const check = (target: string, original = source) => validateNmtTradeRelations(prepare(original), target);
describe("v21 person protection and unknown coverage", () => {
  it("marks every visible person, preserving IDs and full same-message context", () => {
    const h = html("Mira is the account owner. Alex is the sales representative; Mira must approve. CNF.");
    const wire = h.encode();
    expect([...wire.matchAll(/class="notranslate" translate="no" id="o\d+">(?:Alex|Mira)/gu)]).toHaveLength(3);
    expect(wire).toContain('id="o0">Mira</span> is the account owner.');
    expect(wire).toContain('<span translate="no" id="o3">CNF</span>');
    expect(() => h.decode(wire)).not.toThrow();
    for (const bad of [wire.replace('>Alex</span>', '>Mira</span>'), wire.replace('>Alex</span>', '>Alex</span> Alex'), wire.replace(/<span[^>]+>Alex<\/span>/u, "Alex"), wire.replace('id="o2"', 'id="o0"')]) expect(() => h.decode(bad)).toThrow();
    const split = html("Alex must approve.\nMira asks.");
    expect(() => split.decode(split.encode().replace('id="o0"', 'id="o99"'))).toThrow();
  });
  it("keeps quoted auxiliaries visible in the same one request", async () => {
    const parent = "projects/test-project/locations/us-central1"; let calls = 0;
    const t = new NmtGlossaryTranslator({projectId:"test-project",location:"us-central1",glossaryZhEn:parent+"/glossaries/zh-en",glossaryEnZh:parent+"/glossaries/en-zh",protectedNames:names},{async translateText(request, options) {
      calls++; expect(request.contents).toHaveLength(2); expect(options).toEqual({timeout:15000,retry:{retryCodes:[]}});
      for (const body of request.contents) expect(body).toContain('class="notranslate" translate="no" id="o0">Mira</span>');
      return [{glossaryTranslations:request.contents.map(body => ({translatedText:body.replace('Please translate ', '請翻譯').replace(' agreed', '同意了')}))}];
    }});
    await expect(t.translate('Please translate “Mira agreed”.', 'en', 'zh-TW')).resolves.toBe('請翻譯“Mira同意了”.'); expect(calls).toBe(1);
  });
  it("preserves direction, native mentions and terms", () => {
    expect(createContextLlmHtml(prepareLlmContext("Alex 說。", names, [], "en")).encode()).toBe('<div id="p0">Alex 說。</div>');
    const mention = createContextLlmHtml(prepareLlmContext("@Alex must approve.", names, [{start:0,length:5}], "zh-TW"));
    expect(mention.encode()).toContain('class="notranslate" translate="no" id="o0">@Alex</span>');
    expect(() => mention.decode(mention.encode())).not.toThrow();
  });
  it("uses only an equivalent terminal passive; quotes, referents and negation remain", () => {
    expect(html(source).encode()).toContain('must confirm what is covered by it.');
    expect(html("Do not confirm what it covers.").encode()).toContain('Do not confirm what is covered by it.');
    expect(html('The note says “confirm what it covers”.').encode()).toContain('confirm what it covers');
    expect(html("Alex must confirm what services it covers.").encode()).toContain('what services it covers');
    expect(html("Alex must confirm what it covers and when.").encode()).toContain('what it covers and when');
  });
  it.each(["Alex 必須確認它涵蓋什麼。", "Alex 需要確認包含哪些內容。", "Alex 須確認其所涵蓋的範圍。", "Alex 必須查明這筆款項的用途。", "Alex 需要核實涵蓋的項目。", "Alex 必須確認它涵蓋的是什麼。", "Alex 必須確認這筆款項涵蓋的具體內容。"])("accepts neutral unknown coverage: %s", output => expect(() => check(output)).not.toThrow());
  it.each(["Alex 需要確認包含哪些服務。", "Alex 必須確認包含哪些運費。", "Alex 需要確認涵蓋哪些佣金。", "Alex 必須確認包含哪些內容和服務。", "Alex 必須確認服務的範圍。", "Alex 必須確認它涵蓋什麼服務。"])("rejects invented category: %s", output => expect(() => check(output)).toThrow("unspecified_coverage_object_changed"));
  it("allows a specifically sourced service object and ignores quoted data", () => {
    expect(() => check("Alex 必須確認包含哪些服務。", "Alex must confirm what services it covers.")).not.toThrow();
    expect(() => check("標籤写著「確認包含哪些服務」。", 'The label says “confirm what it covers”.')).not.toThrow();
    expect(() => check("我們提供服務。Alex 必須確認包含哪些服務。", "We provide services. Alex must confirm what it covers.")).toThrow();
  });
});