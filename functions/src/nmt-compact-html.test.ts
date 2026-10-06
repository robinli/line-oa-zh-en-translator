import {describe, expect, it} from "vitest";
import {createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";

const wire = (source: string) => createNmtTransport(createLiteralManifest(source));

describe("compact HTML transport with source-owned blank rows", () => {
  it("keeps original row and literal IDs while omitting redundant attributes and blank rows", () => {
    const source = "\r\nShan confirmed CNF.\r\n\t \u00a0\r\nWei confirmed 50%.\r\n";
    const transport = wire(source);
    expect(transport.mimeType).toBe("text/html");
    expect(transport.contents).toHaveLength(1);
    expect(transport.contents[0]).not.toContain("notranslate");
    expect(transport.contents[0]).toContain('<div id="p1">');
    expect(transport.contents[0]).toContain('<div id="p3">');
    expect(transport.contents[0]).not.toMatch(/<div id="p(?:0|2|4)">/u);
    expect(transport.contents[0]).toContain('<span translate="no" id="l0">Shan</span>');
  });
  it.each(["\r\n", "\n", "\r", "\u2028", "\u2029"])("restores leading, consecutive and trailing blank rows with %j", separator => {
    const source = ["\t", "Shan confirmed.", "", "\u00a0", "Wei agreed.", ""].join(separator);
    const compact = '<div id="p1">Shan確認。</div><div id="p4">Wei同意。</div>';
    expect(wire(source).decode(compact).text).toBe(["\t", "Shan確認。", "", "\u00a0", "Wei同意。", ""].join(separator));
  });
  it.each([
    '<div>Shan確認。</div><div>Wei同意。</div>',
    '<div></div><div>Shan確認。</div><div> </div><div>Wei同意。</div><div></div>',
    '<div id="p0"></div><div id="p1">Shan確認。</div><div id="p2"> </div><div id="p3">Wei同意。</div><div id="p4"></div>',
  ])("accepts complete compact and legacy source sequences %s", response => {
    expect(wire("\nShan confirmed.\n\t\nWei agreed.\n").decode(response).text).toBe("\nShan確認。\n\t\nWei同意。\n");
  });
  it("recovers a sole transmitted paragraph when its wrapper is missing", () => {
    expect(wire("\n\t\nShan confirmed.\n").decode("Shan確認。").text).toBe("\n\t\nShan確認。\n");
  });
  it.each([
    '<div id="p1">Shan確認。</div>',
    '<div id="p1">Shan確認。</div><div></div><div id="p3">Wei同意。</div>',
    '<div id="p3">Wei同意。</div><div id="p1">Shan確認。</div>',
    '<div id="p1">Shan確認。</div><div id="p1">Wei同意。</div>',
    '<div id="p0">新增內容</div><div id="p1">Shan確認。</div><div id="p2"></div><div id="p3">Wei同意。</div><div id="p4"></div>',
    '<div id="p0">&#10;</div><div id="p1">Shan確認。</div><div id="p2"></div><div id="p3">Wei同意。</div><div id="p4"></div>',
    '<div id="p1">Shan確認。</div><div id="p3">Wei同意。</div>extra',
    "Shan確認。\nWei同意。",
  ])("rejects partial sequences, conflicting ownership and injected blank-row content %s", response => {
    expect(() => wire("\nShan confirmed.\n\t\nWei agreed.\n").decode(response)).toThrow("paragraph_structure_changed");
  });
  it.each([
    '<div id="p1">Wei確認。</div><div id="p3">Shan同意。</div>',
    '<div id="p1">Shan Shan確認。</div><div id="p3">Wei同意。</div>',
    '<div id="p1">Shannon確認。</div><div id="p3">Wei同意。</div>',
  ])("keeps changed, duplicated and cross-row ordinary names rejected %s", response => {
    expect(() => wire("\nShan confirmed.\n\t\nWei agreed.\n").decode(response)).toThrow("exact_occurrence_changed");
  });
  it("restores different same-name native identities and UTF-16 positions after blank rows", () => {
    const source = "\r\n😀 @Alex confirmed.\r\n\t\r\n@Alex declined.\r\n";
    const starts = [source.indexOf("@Alex"), source.lastIndexOf("@Alex")];
    const transport = createNmtTransport(createLiteralManifest(source, [], {protectedRanges: starts.map(start => ({start, length: 5}))}));
    const response = '<div id="p1">😀 <span id="l0">@Alex</span>確認。</div><div id="p3"><span id="l1">@Alex</span>拒絕。</div>';
    const result = transport.decode(response);
    expect(result.text).toBe("\r\n😀 @Alex確認。\r\n\t\r\n@Alex拒絕。\r\n");
    expect(result.ranges).toEqual(starts.map((sourceStart, index) => ({sourceStart, start: index ? result.text.lastIndexOf("@Alex") : result.text.indexOf("@Alex"), length: 5})));
    expect(() => transport.decode(response.replace('id="l1"', 'id="l0"'))).toThrow("exact_occurrence_changed");
    expect(() => transport.decode(response.replace(' id="l1"', ""))).toThrow("exact_occurrence_changed");
  });
  it("retains protected horizontal whitespace as a transmitted occurrence", () => {
    const source = "Shan confirmed.\n\t \nWei agreed.";
    const transport = createNmtTransport(createLiteralManifest(source, [], {copyExactRanges: [{start: source.indexOf("\t"), length: 2}]}));
    expect(transport.contents[0]).toContain('<div id="p1"><span translate="no"');
    expect(transport.decode(transport.contents[0]!).text).toBe(source);
  });
  it("preserves exact blank glyphs without applying output presentation to them", () => {
    const source = "Shan confirmed.\n\u00a0\nWei agreed.";
    expect(wire(source).decode('<div id="p0">Shan確認。</div><div id="p2">Wei同意。</div>', body => body.replaceAll("\u00a0", "CHANGED")).text)
      .toBe("Shan確認。\n\u00a0\nWei同意。");
  });
  it("does not change the plain input or the all-protected short circuit", () => {
    expect(wire("Please confirm.\r\n\t\r\nPlease load.").contents).toEqual(["Please confirm.\r\n\t\r\nPlease load."]);
    expect(wire("Shan\n\nCNF\n\n50%").hasTranslatableBody).toBe(false);
  });
});
