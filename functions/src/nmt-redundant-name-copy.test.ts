import {describe, expect, it, vi} from "vitest";
import {createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";
import {NmtDirectTranslator} from "./nmt-direct-translator.js";
import {NMT_TEST_PROJECT as projectId} from "./nmt-isolation.js";
import type {NmtResponse} from "./nmt-controlled-client.js";

const source = "Shan requested bags. Please confirm the labels.";
const raw = '<div id="p0">Shan 要求大袋<span translate="no" class="notranslate" id="l0">Shan</span>請確認標籤。</div>';
const wire = () => createNmtTransport(createLiteralManifest(source));

describe("identified redundant configured-name copies", () => {
  it("repairs only the redundant tagged copy, preserving the provider body and input bytes", async () => {
    const before = wire().contents;
    expect(before).toEqual(['<div id="p0"><span translate="no" class="notranslate" id="l0">Shan</span> requested bags. Please confirm the labels.</div>']);
    const send = vi.fn(async () => [{translations: [{translatedText: raw}]}] as [NmtResponse]);
    const translator = new NmtDirectTranslator({projectId, profile: "nmt-direct-v1"}, {translateText: send});
    expect(await translator.translate(source, "en", "zh-TW")).toBe("Shan 要求大袋請確認標籤。");
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({contents: before, mimeType: "text/html"}), {timeout: 15000, retry: {retryCodes: []}});
    expect(raw).toContain('id="l0">Shan</span>');
  });
  it("relocates the preserved literal placement when the tagged copy precedes the body occurrence", () => {
    expect(wire().decode('<div><span id="l0">Shan</span>請確認。Shan 要求大袋。</div>').text).toBe("請確認。Shan 要求大袋。");
  });
  it("converts only ordinary text while preserving a repaired name's original glyphs", () => {
    const w = createNmtTransport(createLiteralManifest("简体公司 requested bags.", ["简体公司"]));
    const output = '<div>简体公司检查大袋<span id="l0">简体公司</span>。</div>';
    expect(w.decode(output, value => value.replaceAll("简体", "簡體").replaceAll("检查", "檢查")).text).toBe("简体公司檢查大袋。");
  });
  it("keeps native mention UTF-16 offsets correct after removing a preceding name copy", () => {
    const text = "Shan requested bags. Notify @Alex.", start = text.indexOf("@Alex");
    const w = createNmtTransport(createLiteralManifest(text, ["Shan"], {protectedRanges: [{start, length: 5}]}));
    const response = '<div>😀 Shan要求大袋<span id="l0">Shan</span>。通知<span id="l1">@Alex</span>。</div>';
    const result = w.decode(response);
    expect(result.text).toBe("😀 Shan要求大袋。通知@Alex。");
    expect(result.ranges).toEqual([{sourceStart: start, start: result.text.indexOf("@Alex"), length: 5}]);
  });
  it.each([
    '<div>Shan Shan 要求大袋。</div>',
    '<div>Shan 要求大袋<span>Shan</span>。</div>',
    '<div><span>Shan</span>要求大袋。Shan請確認。</div>',
    '<div>Shan <span>Shan</span><span id="l0">Shan</span>。</div>',
    '<div>Shan Shan <span id="l0">Shan</span>。</div>',
    '<div>Shan <span id="l0">山</span>。</div>',
    '<div>Shan <span id="l0">shan</span>。</div>',
    '<div>Shan <span id="l0"> Shan </span>。</div>',
    '<div>Shan <span id="l99">Shan</span>。</div>',
    '<div>Shan <span id="l0">Shan</span><span id="l0">Shan</span>。</div>',
  ])("keeps ambiguous, extra, changed or unidentified copies rejected: %s", response => {
    expect(() => wire().decode(response)).toThrow();
  });
  it("does not remove a legitimate repeated source name", () => {
    const w = createNmtTransport(createLiteralManifest("Shan asked Shan to confirm."));
    expect(w.decode('<div><span id="l0">Shan</span>請<span id="l1">Shan</span>確認。</div>').text).toBe("Shan請Shan確認。");
    expect(() => w.decode('<div>Shan <span id="l0">Shan</span>請<span id="l1">Shan</span>確認。</div>')).toThrow("exact_occurrence_changed");
  });
  it("does not repair native identity or explicitly exact names", () => {
    for (const context of [{protectedRanges: [{start: 0, length: 4}]}, {copyExactRanges: [{start: 0, length: 4}]}]) {
      const w = createNmtTransport(createLiteralManifest(source, ["Shan"], context));
      expect(() => w.decode(raw)).toThrow("exact_occurrence_changed");
    }
  });
  it.each(["PH-BK", "CNF", "a@example.com"])("does not repair a duplicated non-name literal %s", value => {
    const w = createNmtTransport(createLiteralManifest("Check " + value + ".", []));
    expect(() => w.decode('<div>檢查 ' + value + ' <span id="l0">' + value + '</span>。</div>')).toThrow("exact_occurrence_changed");
  });
  it("keeps paragraph ownership and rejects a remaining violation after a name repair", () => {
    const w = createNmtTransport(createLiteralManifest("Shan requested bags.\nCheck PH-BK."));
    expect(() => w.decode('<div><span id="l0">Shan</span>要求大袋。</div><div>Shan檢查<span id="l1">PH-BK</span>。</div>')).toThrow("exact_occurrence_changed");
    expect(() => w.decode('<div>Shan要求大袋<span id="l0">Shan</span>。</div><div>檢查<span id="l1">PP-BK</span>。</div>')).toThrow("exact_occurrence_changed");
  });
});
