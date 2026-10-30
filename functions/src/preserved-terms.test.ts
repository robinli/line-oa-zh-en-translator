import {describe, expect, it} from "vitest";
import {findPreservedTermRanges, matchesPreservedTermWhitespace, hasSamePreservedTermCounts} from "./preserved-terms.js";
import {createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";

describe("explicit untranslated phrase", () => {
  it.each(["mít color", "mít  color", "MÍT\tCOLOR", "mít\u00a0color"])("retains source spelling and spacing: %s", phrase => {
    const text = "😀 (" + phrase + "), " + phrase;
    const ranges = findPreservedTermRanges(text);
    expect(ranges.map(range => text.slice(range.start, range.start + range.length))).toEqual([phrase, phrase]);
    expect(ranges[0]!.start).toBe(4);
  });
  it.each(["mít", "mix color", "premít color", "mít colors", "mít colorway", "mít color_1", "mít\ncolor", "mít\r\ncolor"])(
    "does not expand the approved phrase to %s", text => {
      expect(findPreservedTermRanges(text)).toEqual([]);
    });
  it("matches an inline product label next to Chinese without claiming a larger word", () => {
    const text = "這包mít color重654公斤";
    expect(findPreservedTermRanges(text)).toEqual([{start: 2, length: 9}]);
  });
  it("protects both occurrences through the NMT and Sol rewrite carrier", () => {
    const text = "請確認 mít  color。\r\n\r\n再確認 mít color。";
    const manifest = createLiteralManifest(text, []), wire = createNmtTransport(manifest);
    expect(manifest.occurrences.map(item => item.value)).toEqual(["mít  color", "mít color"]);
    const translated = wire.contents[0]!.replaceAll("請確認", "Vui lòng kiểm tra").replaceAll("再確認", "Kiểm tra lại");
    const result = wire.decode(translated);
    expect(result.text).toContain("mít  color");
    expect(result.text).toContain("\r\n\r\n");
    expect(() => wire.decode(translated.replace("mít  color", "菠蘿蜜"))).toThrow();
    expect(() => wire.decode(translated.replace("mít color", ""))).toThrow();
  });
  it("merges a term inside a native mention without creating a second identity", () => {
    const text = "@mít color 請確認";
    const manifest = createLiteralManifest(text, [], {protectedRanges: [{start: 0, length: 10}]});
    expect(manifest.occurrences).toHaveLength(1);
    const wire = createNmtTransport(manifest), result = wire.decode(wire.contents[0]!.replace("請確認", "Please check"));
    expect(result.ranges).toEqual([{sourceStart: 0, start: 0, length: 10}]);
  });
  it("restores horizontal whitespace only for an approved ordinary span", () => {
    const text = "請確認 mít  color。", wire = createNmtTransport(createLiteralManifest(text, []));
    const collapsed = wire.contents[0]!.replace("mít  color", "mít color");
    expect(wire.decode(collapsed).text).toBe(text);
    expect(matchesPreservedTermWhitespace("mít\tcolor", "mít color")).toBe(true);
    for (const candidate of ["MÍT color", "mít colors", "mix color", "mít\ncolor", "菠蘿蜜"]) {
      expect(matchesPreservedTermWhitespace("mít  color", candidate)).toBe(false);
    }
    expect(matchesPreservedTermWhitespace("Alex  Chen", "Alex Chen")).toBe(false);
    expect(() => wire.decode(collapsed.replace('id="l0"', 'id="l9"'))).toThrow();
  });
  it("does not relax the identity surface of a native mention", () => {
    const text = "mít  color 請確認", wire = createNmtTransport(createLiteralManifest(text, [], {protectedRanges: [{start: 0, length: 10}]}));
    expect(() => wire.decode(wire.contents[0]!.replace("mít  color", "mít color"))).toThrow();
  });
  it("counts all horizontal whitespace variants in their source paragraph", () => {
    expect(hasSamePreservedTermCounts("mít  color.\nC.", "mít  color mít color.\nC.")).toBe(false);
    expect(hasSamePreservedTermCounts("mít color.\nC.", "C.\nmít color.")).toBe(false);
    expect(hasSamePreservedTermCounts("mít  color mít color.\nC.", "mít  color mít color.\nC.")).toBe(true);
    expect(hasSamePreservedTermCounts("@mít color and mít color-AB", "@mít color and mít color-AB")).toBe(true);
  });
  it.each(["mít color", "mít  color", "MÍT\tCOLOR"])("rejects an extra plain copy outside a known span: %s", extra => {
    const transport = createNmtTransport(createLiteralManifest("A mít  color B.\nC.", []));
    expect(() => transport.decode(transport.contents[0]!.replace("</span>", "</span> " + extra))).toThrow();
  });
});
