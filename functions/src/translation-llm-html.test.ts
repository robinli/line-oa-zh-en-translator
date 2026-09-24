import {describe, expect, it} from "vitest";
import {prepareTranslationLlmText, createLlmWireText} from "./translation-llm-protection.js";
import {createLlmHtmlWireText} from "./translation-llm-html.js";
import {restoreTradeTranslationWithRanges} from "./trade-policy.js";

function setup(source = "@Alex 請確認 @Alex") {
  const ranges = [...source.matchAll(/@Alex/gu)].map(m => ({start: m.index, length: 5}));
  const p = prepareTranslationLlmText(source, [], ranges), wire = createLlmWireText(p);
  return {p, wire, html: createLlmHtmlWireText(p, wire)};
}
describe("Translation LLM visible mention HTML", () => {
  it("retains reordered same-name identities and escapes ordinary source text", () => {
    const {p, wire, html} = setup();
    const spans = [...html.encode(p.text).matchAll(/<span\b[^>]*>[^<>]*<\/span>/gu)].map(m => m[0]);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toContain('id="m0">@Alex</span>');
    const result = restoreTradeTranslationWithRanges(p, wire.decode(html.decodeTransport(spans[1] + " Please confirm " + spans[0])));
    expect(result.text).toBe("@Alex Please confirm @Alex");
    expect(result.ranges.map(r => r.sourceStart)).toEqual([10, 0]);
  });
  it.each([
    (s: string) => s.replace('id="m0"', 'id="m99"'),
    (s: string) => s.replace('id="m0"', 'id="m0" id="m1"'),
    (s: string) => s.replace('>@Alex<', '>@Mira<'),
    (s: string) => s.replace('<span', '<b'),
    (s: string) => s + '<script>x</script>',
    (s: string) => s + '&lt;script&gt;x&lt;/script&gt;',
  ])("rejects spoofed identity, changed names or unexpected markup", mutate => {
    const {p, html} = setup();
    expect(() => html.decodeTransport(mutate(html.encode(p.text)))).toThrow();
  });
  it("rejects missing or duplicated spans through the common final validator", () => {
    const {p, wire, html} = setup();
    const spans = [...html.encode(p.text).matchAll(/<span\b[^>]*>[^<>]*<\/span>/gu)].map(m => m[0]);
    for (const output of [spans[0]!, spans[0]! + spans[0]!]) {
      expect(() => restoreTradeTranslationWithRanges(p, wire.decode(html.decodeTransport(output)))).toThrow();
    }
  });
  it("escapes literal markup inside a display name and never double-decodes source data", () => {
    const source = '@A<&quot; 請保留 &amp;amp;';
    const p = prepareTranslationLlmText(source, [], [{start: 0, length: 9}]);
    const wire = createLlmWireText(p), html = createLlmHtmlWireText(p, wire);
    const input = html.encode(p.text);
    expect(input).toContain('@A&lt;&amp;quot;');
    expect(restoreTradeTranslationWithRanges(p, wire.decode(html.decodeTransport(input))).text).toBe(source);
  });
});
