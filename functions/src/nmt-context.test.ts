import {describe, it, expect} from "vitest";
import {prepareLlmContext, sourceParagraphs} from "./nmt-context.js";

describe("TLLM context occurrence contract", () => {
  it("retains every original UTF-16 paragraph boundary, including blank and protected-only lines", () => {
    const source = "😀\r\n\r\nPP-BK\r20kg\n";
    const rows = sourceParagraphs(source);
    expect(rows.map(p => p.text + p.separator).join("")).toBe(source);
    expect(rows.map(p => p.start)).toEqual([0, 4, 6, 12, 17]);
    expect(rows.map(p => p.separator)).toEqual(["\r\n", "\r\n", "\r", "\n", ""]);
  });
  it("records repeated quantities, precision, signs, unit groups and denominators without deduplication", () => {
    const source = "20kg; 600 kg; 20公斤; 600公斤; 2.5 kg; 0.6 MT; 20 lb; -0.60; +2.5%; USD 800/MT; 20kg; net 600 kg; gross 603 kg";
    const p = prepareLlmContext(source, []);
    const q = p.occurrences.filter(v => v.kind === "quantity");
    expect(q.map(v => v.value)).toEqual(["20kg", "600 kg", "20公斤", "600公斤", "2.5 kg", "0.6 MT", "20 lb", "-0.60", "+2.5%", "USD 800/MT", "20kg", "600 kg", "603 kg"]);
    expect(q[7]).toMatchObject({number: "-0.60", sign: "-", precision: 2});
    expect(q[8]).toMatchObject({percent: "%"});
    expect(q[9]).toMatchObject({currency: "USD", denominator: "MT"});
    expect(q[2]).toMatchObject({unitGroup: "kg"});
    expect(q.every(v => source.slice(v.start, v.end) === v.value)).toBe(true);
    expect(new Set(q.map(v => v.token)).size).toBe(q.length);
  });
  it("keeps names, native occurrences, formulas, literal data and contacts distinct", () => {
    const source = "😀 @Alex 請保留 -612+28%; CNF PP-BK &amp;amp; https://example.org/?a=1&amp;b=2 @Alex";
    const ranges = [...source.matchAll(/@Alex/gu)].map(m => ({start: m.index, length: 5}));
    const p = prepareLlmContext(source, ["Alex"], ranges);
    expect(p.rangeTokens.map(t => t.sourceStart)).toEqual(ranges.map(r => r.start));
    expect(p.occurrences.filter(v => v.kind === "formula-or-date").map(v => v.value)).toEqual(["-612+28%"]);
    expect(p.occurrences.filter(v => v.kind === "literal-markup").map(v => v.value)).toEqual(["&amp;amp;"]);
    expect(p.occurrences.filter(v => v.kind === "contact")).toHaveLength(1);
  });
});
