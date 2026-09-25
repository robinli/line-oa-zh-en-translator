import {describe, it, expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {createContextLlmHtml} from "./nmt-context-html.js";
import {restoreTradeTranslationWithRanges} from "./trade-policy.js";
function fixture(source: string, target = "zh-TW", ranges: Array<{start: number; length: number}> = []) {
  const p = prepareLlmContext(source, ["Alex"], ranges, target), wire = createContextLlmHtml(p);
  const restore = (html: string) => {const d = wire.decode(html); return restoreTradeTranslationWithRanges(d.restoration, d.masked);};
  return {p, wire, restore};
}
describe("TLLM whole-message structural protocol", () => {
  it("uses one complete message with visible weights, exact separators and no Quantity markers", () => {
    const source = "Use 20kg bags.\r\n\r\nIf unavailable use 600 kg FIBC.\nPP-BK\r";
    const {wire, restore} = fixture(source);
    expect(wire.encode()).toContain('Use 20kg bags.</div><div id="p1"></div><div id="p2">If unavailable use 600 kg ');
    expect(wire.encode()).toMatch(/<span class="notranslate" translate="no" id="o\d+">FIBC<\/span>/u);
    expect(wire.encode()).not.toContain("Quantity");
    expect(restore(wire.encode()).text).toBe(source.trim());
  });
  it.each([
    (s: string) => s.replace('<div id="p1"></div>', ""),
    (s: string) => s.replace('id="p2"', 'id="p9"'),
    (s: string) => s.replace('id="p2"', 'id="p0"'),
    (s: string) => s.replace(/<\/div><div id="p1"><\/div><div id="p2">/u, ""),
    (s: string) => s + '<b>text</b>',
    (s: string) => s.replace('Use', '&lt;script&gt;Use'),
  ])("rejects missing, duplicate, reordered or untrusted paragraph structure", mutate => {
    const {wire, restore} = fixture("Use 20 kg.\n\nUse 600 kg.");
    expect(() => restore(mutate(wire.encode()))).toThrow("paragraph_structure_changed");
  });
  it("maps twenty same-name occurrences and Emoji by UTF-16 source offsets", () => {
    const source = "😀 " + Array.from({length: 20}, () => "@Alex").join(" ");
    const ranges = [...source.matchAll(/@Alex/gu)].map(m => ({start: m.index, length: 5}));
    const {wire, restore} = fixture(source, "en", ranges);
    const spans = [...wire.encode().matchAll(/<span\b[^>]*>[^<>]*<\/span>/gu)].map(m => m[0]);
    const result = restore('<div id="p0">😀 ' + spans.reverse().join(" ") + '</div>');
    expect(result.ranges.map(r => r.sourceStart)).toEqual(ranges.map(r => r.start).reverse());
    expect(result.ranges.every(r => result.text.slice(r.start, r.start + r.length) === "@Alex")).toBe(true);
  });
  it.each([
    (s: string) => s.replace('id="o0"', 'id="o99"'),
    (s: string) => s.replace('id="o0"', 'id="o0" id="o1"'),
    (s: string) => s.replace('>@Alex<', '>@Other<'),
    (s: string) => s.replace(/<span\b[^>]*>[^<>]*<\/span>/u, ""),
    (s: string) => s.replace(/(<span\b[^>]*>[^<>]*<\/span>)/u, "$1$1"),
  ])("rejects changed, missing, duplicated or unknown exact occurrences", mutate => {
    const {wire, restore} = fixture("@Alex Use 20 kg.", "en", [{start: 0, length: 5}]);
    expect(() => restore(mutate(wire.encode()))).toThrow("exact_occurrence_changed");
  });
  it("decodes the HTML transport once and leaves source literal data unchanged", () => {
    const source = "Keep &amp;amp; &#39; <price> __TRADE_123_0__ @A<&quot;";
    const start = source.indexOf("@A");
    const {wire, restore} = fixture(source, "en", [{start, length: source.length - start}]);
    expect(restore(wire.encode()).text).toBe(source);
    expect(() => restore(wire.encode().replace(/Value[A-Z]{6}QX/u, 'changed'))).toThrow("exact_occurrence_changed");
  });
});
describe("TLLM visible quantity fidelity", () => {
  it("allows only explicit weight spelling equivalence and restores fixed source formatting", () => {
    const en = fixture("Use 20kg, 600 kg, 0.60 MT and 20 lb.");
    expect(en.restore(en.wire.encode().replace("20kg", "20 公斤").replace("600 kg", "600 kilograms").replace("0.60 MT", "0.60 公噸").replace("20 lb", "20 磅")).text)
      .toBe("Use 20kg, 600 kg, 0.60 MT and 20 lb.");
    const zh = fixture("使用20公斤，600公噸和20磅。", "en");
    expect(zh.restore(zh.wire.encode().replace("20公斤", "20 kg").replace("600公噸", "600 MT").replace("20磅", "20 lb")).text)
      .toBe("使用20kg，600MT和20lb。");
    const exact = fixture("保持原樣：20公斤。", "en");
    expect(exact.restore(exact.wire.encode().replace("20公斤", "20 kg")).text).toBe("保持原樣：20公斤。");
  });
  it.each([
    ["600 kg", "0.6 MT"], ["600 kg", "600 lb"], ["600 kg", "600 bags"],
    ["0.60 MT", "0.6 MT"], ["-2.5 kg", "+2.5 kg"], ["20 kg; 20 kg", "20 kg"],
    ["20 kg", "20 kg; 20 kg"], ["20 kg", "20 kg and 42 kg"], ["0.6 MT", "0.6 tons"],
  ])("rejects converted, altered, dropped or repeated data: %s → %s", (source, output) => {
    const {wire, restore} = fixture("Keep " + source + ".");
    expect(() => restore(wire.encode().replace(source, output))).toThrow();
  });
  it.each([
    ["USD 800/MT", "USD 800/kg"], ["USD 800/MT", "EUR 800/MT"], ["-0.60", "-0.6"], ["+2.5%", "2.5%"],
    ["793+24", "817"], ["793+24", "793+24%"],
  ])("validates exact financial/formula contents before restoring: %s", (source, output) => {
    const {wire, restore} = fixture("Keep " + source + ".");
    expect(() => restore(wire.encode().replace(source, output))).toThrow();
  });
  it("accepts only formula operator whitespace, without changing the original expression", () => {
    const {wire, restore} = fixture("Keep 793+24 and 793 +24.");
    expect(restore(wire.encode().replace('793+24', '793 + 24')).text).toBe("Keep 793+24 and 793 +24.");
  });
});

it("keeps financial retry values visible and validates their content before restoration", () => {
  const p = prepareLlmContext("成本 EUR 32，運費 EUR 18。", [], [], "en"), wire = createContextLlmHtml(p, true);
  const body = wire.encode();
  expect(body).toContain("EUR32_CQAQX");
  expect(body).toContain("EUR18_CQBQX");
  expect(() => wire.decode(body.replace("EUR32", "EUR33"))).toThrow();
  expect(() => wire.decode(body.replace("EUR32", "USD32"))).toThrow();
  expect(() => wire.decode(body.replace("_CQAQX", "_CQZQX"))).toThrow();
  expect(wire.decode(body).masked).toBe(p.text);
  expect(wire.decode(body.replace("EUR32_CQAQX", "EUR 32").replace("EUR18_CQBQX", "EUR 18")).masked).toBe(p.text);
});
