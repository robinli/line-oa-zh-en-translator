import {describe, expect, it, vi} from "vitest";
import {createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";
import {NmtDirectTranslator} from "./nmt-direct-translator.js";
import type {NmtResponse} from "./nmt-controlled-client.js";
import {NMT_TEST_PROJECT as projectId} from "./nmt-isolation.js";

const request = "Shan requested bulk bags. Please confirm the packaging requirements.";
const translation = "Shan 要求使用大袋。請確認包裝要求。";
const wire = (text = request) => createNmtTransport(createLiteralManifest(text));

describe("content integrity independently of incidental HTML metadata", () => {
  it.each([
    '<div id="p0"><span id="l0">Shan</span> 要求使用大袋。請確認包裝要求。</div>',
    '<div id="p0"><span id="l0">Shan </span>要求使用大袋。請確認包裝要求。</div>',
    '<div id="p0"><span translate="no" class="notranslate">Shan</span> 要求使用大袋。請確認包裝要求。</div>',
    '<div id="p0">Shan 要求使用大袋。請確認包裝要求。</div>',
    '<div><span>Shan</span> 要求使用大袋。請確認包裝要求。</div>',
    '<span>Shan</span> 要求使用大袋。請確認包裝要求。',
    translation,
  ])("accepts unchanged literal content with provider presentation %s", response => {
    expect(wire().decode(response)).toEqual({text: translation, ranges: []});
  });
  it("preserves provider whitespace outside the exact span value", () => {
    expect(wire().decode('<div><span id="l0"> \tShan\u00a0</span>請確認。</div>').text).toBe(" \tShan\u00a0請確認。");
  });
  it.each([
    '<div id="p0"><span id="l0">山</span> 要求使用大袋。</div>',
    '<div id="p0"><span id="l0">Shan哥</span> 要求使用大袋。</div>',
    '<div id="p0"><span id="l0">shan</span> 要求使用大袋。</div>',
    '<div>山 要求使用大袋。</div>',
    '<div>Shannon 要求使用大袋。</div>',
    '<div>Shan Shan 要求使用大袋。</div>',
    '<div><span id="l0">Shan</span><span id="l0">Shan</span>請確認。</div>',
    '<div><span id="l99">Shan</span>請確認。</div>',
    '<div><span id="l0" id="l0">Shan</span>請確認。</div>',
  ])("rejects changed, missing, duplicated or contradictory literal evidence %s", response => {
    expect(() => wire().decode(response)).toThrow();
  });
  it.each([
    '<div><span onclick="evil()">Shan</span>請確認。</div>',
    '<div><script>Shan</script>請確認。</div>',
    '<div><span>Shan<br>請確認。</span></div>',
    '<div id="p1">Shan請確認。</div>',
    '<div>Shan請確認。</div>extra',
    '<div>Shan&#10;請確認。</div>',
    '<div><span id="l0">Shan&#10;</span>請確認。</div>',
  ])("rejects unsupported markup, extra text and paragraph damage %s", response => {
    expect(() => wire().decode(response)).toThrow();
  });
  it.each(["&#11;", "&#12;", "&#xB;", "&#xC;", "\v", "\f", "&#xFEFF;"])("rejects non-horizontal whitespace at a known literal span edge %s", edge => {
    expect(() => wire().decode('<div><span id="l0">Shan' + edge + '</span>請確認。</div>')).toThrow("exact_occurrence_changed");
    expect(() => wire().decode('<div><span id="l0">' + edge + 'Shan</span>請確認。</div>')).toThrow("exact_occurrence_changed");
  });
  it("keeps exact contents, MIME and timeout unchanged through the public adapter", async () => {
    const contents = wire().contents;
    const send = vi.fn(async () => [{translations: [{translatedText: '<div>Shan 要求使用大袋。請確認包裝要求。</div>'}]}] as [NmtResponse]);
    const translator = new NmtDirectTranslator({projectId, profile: "nmt-direct-v1"}, {translateText: send});
    expect(await translator.translate(request, "en", "zh-TW")).toBe(translation);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({contents, mimeType: "text/html", sourceLanguageCode: "en", targetLanguageCode: "zh-TW"}), {timeout: 15000, retry: {retryCodes: []}});
    const pronoun = request.replace("Shan", "She"), plain = createNmtTransport(createLiteralManifest(pronoun));
    expect(plain.mimeType).toBe("text/plain"); expect(plain.contents).toEqual([pronoun]);
  });
  it("accepts reordered distinct ordinary names and repeated names without inventing identity", () => {
    const w = wire("Shan and Wei asked Shan to confirm.");
    expect(w.decode("Wei 請 Shan 向 Shan 確認。").text).toBe("Wei 請 Shan 向 Shan 確認。");
    expect(() => w.decode("Wei 請 Shan 確認。")).toThrow("exact_occurrence_changed");
  });
  it("keeps literals in their original paragraph with missing optional IDs", () => {
    const w = wire("Shan requested bags.\r\n\r\nWei requested labels.");
    expect(w.decode('<div>Shan要求大袋。</div><div></div><div>Wei要求標籤。</div>').text).toBe("Shan要求大袋。\r\n\r\nWei要求標籤。");
    expect(() => w.decode('<div>Wei要求大袋。</div><div></div><div>Shan要求標籤。</div>')).toThrow("exact_occurrence_changed");
    expect(() => w.decode("Shan要求大袋。\n\nWei要求標籤。")).toThrow("paragraph_structure_changed");
  });
  it("checks codes and Incoterms even without literal span wrappers", () => {
    const w = wire("Shan confirmed PH-BK on CNF terms.");
    expect(w.decode("Shan 確認 PH-BK 採 CNF 條件。").text).toBe("Shan 確認 PH-BK 採 CNF 條件。");
    expect(() => w.decode("Shan 確認 PP-BK 採 CNF 條件。")).toThrow("exact_occurrence_changed");
    expect(() => w.decode("Shan 確認 PH-BK 採 CIF 條件。")).toThrow("exact_occurrence_changed");
  });
  it("preserves protected glyphs and decodes source entities exactly once", () => {
    const text = "Check 简体公司 and &amp; <b>.";
    const w = createNmtTransport(createLiteralManifest(text, [], {copyExactRanges: [{start: 6, length: 4}]}));
    const result = w.decode("检查 简体公司和 &amp;amp; &lt;b&gt;。", value => value.replaceAll("检查", "檢查").replaceAll("简体", "簡體"));
    expect(result.text).toBe("檢查 简体公司和 &amp; <b>。");
  });
  it("does not normalize internal whitespace of a copy-exact literal", () => {
    const text = "Please keep A  B.";
    const w = createNmtTransport(createLiteralManifest(text, [], {copyExactRanges: [{start: 12, length: 4}]}));
    expect(w.decode('<div><span id="l0"> A  B </span>請確認。</div>').text).toBe(" A  B 請確認。");
    expect(() => w.decode('<div><span id="l0">A B</span>請確認。</div>')).toThrow("exact_occurrence_changed");
  });
  it("does not resurrect ordinary hyphen verb translation by this repair", () => {
    const w = wire("Shan will double-check the bags.");
    expect(() => w.decode("Shan 將再次確認大袋。")).toThrow("exact_occurrence_changed");
  });
});

describe("native identity remains occurrence based", () => {
  const text = "😀 @Alex 請聯絡 @Alex。";
  const manifest = createLiteralManifest(text, [], {protectedRanges: [{start: 3, length: 5}, {start: 13, length: 5}]});
  const w = createNmtTransport(manifest);
  it("retains different same-name identities with reordered IDs and edge whitespace", () => {
    const result = w.decode('<div>Ask <span id="l1">@Alex </span>then <span id="l0"> @Alex</span>.</div>');
    expect(result).toEqual({text: "Ask @Alex then  @Alex.", ranges: [{sourceStart: 13, start: 4, length: 5}, {sourceStart: 3, start: 16, length: 5}]});
  });
  it.each([
    "Ask @Alex then @Alex.",
    '<div>Ask <span>@Alex</span> then <span>@Alex</span>.</div>',
    '<div>Ask <span id="l1">@Alex</span> then @Alex.</div>',
  ])("rejects missing native identity even when literal counts are correct %s", response => {
    expect(() => w.decode(response)).toThrow("exact_occurrence_changed");
  });
  it("allows an ordinary unmarked name alongside an identified native mention", () => {
    const m = createLiteralManifest("Notify @Alex and Shan.", [], {protectedRanges: [{start: 7, length: 5}]});
    // Shan is an ordinary configured name; the mention still carries its source ID.
    const named = createLiteralManifest(m.original, ["Shan"], {protectedRanges: [{start: 7, length: 5}]});
    expect(createNmtTransport(named).decode('<div>通知 Shan 和 <span id="l0">@Alex</span>。</div>')).toEqual({text: "通知 Shan 和 @Alex。", ranges: [{sourceStart: 7, start: 10, length: 5}]});
  });
});
