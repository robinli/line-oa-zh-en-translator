import {describe, expect, it} from "vitest";
import {createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";
const plain = (source: string) => createNmtTransport(createLiteralManifest(source, []));
describe("plain blank lines as source presentation", () => {
  it("accepts extra list blanks and keeps original wire and source layout", () => {
    const source = "Overview \n\n1) 12 kg reusable cartons \n2) Load the crate \n3) 60 kg extra sample";
    const wire = plain(source), raw = "概述\n\n1) 12公斤紙箱\n\n2) 裝載箱子\n\n3) 額外60公斤樣品";
    expect(wire.mimeType).toBe("text/plain"); expect(wire.contents).toEqual([source]);
    expect(wire.decode(raw)).toEqual({text: "概述\n\n1) 12公斤紙箱\n2) 裝載箱子\n3) 額外60公斤樣品", ranges: []});
  });
  it.each(["標題\n\n第一項\n第二項", "標題\n第一項\n\n第二項", "\n \t\n標題\n\n第一項\n\n第二項\n\n"])("aligns blank-only variation %s", response => {
    expect(plain("Title\n\nFirst item\nSecond item").decode(response).text).toBe("標題\n\n第一項\n第二項");
  });
  it("restores leading/trailing blanks, source horizontal space and mixed separators", () => {
    expect(plain("\r\nTitle\r\n\t \u00a0\r\nFirst item\u2028\u2029Second item\r").decode("標題\n第一項\n\n第二項").text).toBe("\r\n標題\r\n\t \u00a0\r\n第一項\u2028\u2029第二項\r");
  });
  it("retains provider horizontal whitespace in nonblank lines", () => {
    expect(plain("First item\nSecond item").decode("  第一項 \t\n\n\t第二項  ").text).toBe("  第一項 \t\n\t第二項  ");
  });
  it("applies presentation once per provider line without changing source blank layout", () => {
    expect(plain("Please confirm.\n\nPlease load.").decode("确认。\n装载。", text => text.replace("确认", "確認").replace("装载", "裝載")).text).toBe("確認。\n\n裝載。");
  });
  it.each(["第一項及第二項", "第一項\n", "第一項\n第二項\n額外說明", "第一項上半\n第一項下半\n第二項"])("rejects nonblank line loss, split or addition %s", response => {
    expect(() => plain("First item\nSecond item").decode(response)).toThrow("paragraph_structure_changed");
  });
  it("rejects dropped content replaced by a blank even with unchanged total segments", () => {
    expect(() => plain("Title\n\nFirst item\nSecond item").decode("標題\n\n第一項\n")).toThrow("paragraph_structure_changed");
  });
  it.each(["\v", "\f", "\u200b", "\ufeff"])("does not discard non-horizontal content %s", value => {
    expect(() => plain("First item").decode(value + "\n第一項")).toThrow("paragraph_structure_changed");
  });
  it("rejects line breaks created by the presentation callback", () => {
    expect(() => plain("First item").decode("第一項", text => text + "\n")).toThrow("paragraph_structure_changed");
  });
  it("retains protected HTML IDs, empty source paragraphs and ownership", () => {
    const wire = createNmtTransport(createLiteralManifest("Shan requested bags.\n\nWei requested labels."));
    const first = '<div id="p0"><span id="l0">Shan</span>要求袋子。</div>', last = '<div id="p2"><span id="l1">Wei</span>要求標籤。</div>';
    expect(wire.mimeType).toBe("text/html");
    expect(wire.decode(first + '<div id="p1"></div>' + last).text).toBe("Shan要求袋子。\n\nWei要求標籤。");
    expect(wire.decode(first + last).text).toBe("Shan要求袋子。\n\nWei要求標籤。");
    expect(() => wire.decode(first.replace("要求袋子。", "要求袋子。\n\n") + '<div id="p1"></div>' + last)).toThrow("paragraph_structure_changed");
  });
});
