import {describe, expect, it, vi} from "vitest";
import {NmtDirectTranslator, NmtDirectServiceError, type NmtDirectMetric} from "./nmt-direct-translator.js";
import {createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";
import {assertNmtProfileRequest, resolveNmtRuntimeProfile, type DirectNmtProfile} from "./nmt-request-profile.js";
import {ControlledNmtClient, type NmtResponse} from "./nmt-controlled-client.js";
import {NMT_TEST_PROJECT as projectId, NMT_TEST_ACCOUNT, NMT_TEST_BILLING, NMT_RUNTIME_ACCOUNT} from "./nmt-isolation.js";
import {createTranslator} from "./translator-factory.js";
import {createTranslationProgramRouter} from "./translation-program.js";
import type {ControlledNmtRequest} from "./nmt-isolation.js";

const source = "這次裝櫃已確認，下週三下午一點開始裝櫃。";
const parent = "projects/" + projectId + "/locations/us-central1";
const identity = () => Promise.resolve({projectId, principal: NMT_TEST_ACCOUNT, billingAccount: "billingAccounts/" + NMT_TEST_BILLING, billingEnabled: true, runtimeAccount: NMT_RUNTIME_ACCOUNT});
function adapter(translate: (request: ControlledNmtRequest) => string, profile: DirectNmtProfile = "nmt-direct-v1", names?: string[]) {
  const metrics: NmtDirectMetric[] = [];
  const send = vi.fn(async (request: ControlledNmtRequest) => [{[request.glossaryConfig ? "glossaryTranslations" : "translations"]: [{translatedText: translate(request)}]}] as [NmtResponse]);
  return {send, metrics, translator: new NmtDirectTranslator({projectId, profile, protectedNames: names, onMetric: metric => metrics.push(metric)}, {translateText: send})};
}

describe("direct NMT public adapter contract", () => {
  it.each(["Loading is scheduled for 1 p.m. next Wednesday.", "Loading is scheduled for 1:00 p.m. next Wednesday.", "Loading is scheduled for 13:00 next Wednesday.", "One container will be loaded next Wednesday at one in the afternoon."])("accepts faithful natural time %s using original plain input", async output => {
    const s = adapter(() => output); expect(await s.translator.translate(source, "zh-TW", "en")).toBe(output);
    expect(s.send).toHaveBeenCalledExactlyOnceWith({parent, model: parent + "/models/general/nmt", contents: [source], mimeType: "text/plain", sourceLanguageCode: "zh-TW", targetLanguageCode: "en"}, {timeout: 15000, retry: {retryCodes: []}});
    expect(s.metrics[0]).toMatchObject({outcome: "success", attempt: 1, apiCalled: true, validationScope: "literal-integrity", semanticEvaluation: "not_evaluated", profile: "nmt-direct-v1"});
  });
  it.each(["Loading is scheduled for 2 p.m. next Wednesday.", "Loading is scheduled for 1 p.m. next Thursday.", "Loading will cost $100."])("leaves semantic error as unreviewed, never claims to detect %s", async output => {
    const s = adapter(() => output); expect(await s.translator.translate(source, "zh-TW", "en")).toBe(output);
    expect(s.metrics[0]?.semanticEvaluation).toBe("not_evaluated");
  });
  it("does not rewrite grammatical ellipsis, roles or packaging before NMT", async () => {
    const original = "If you can make 25 kg bags is better. If can't make put in FIBC.";
    const s = adapter(request => request.contents[0]!.replace("If you can make", "如果可以做").replace("bags is better", "袋會更好").replace("If can&#39;t make put in", "如果不能做就放入"));
    const output = await s.translator.translate(original, "en", "zh-TW");
    expect(s.send.mock.calls[0]![0].contents[0]).toContain("If can&#39;t make put in");
    expect(output).toContain("FIBC");
  });
  it("retains only the narrow Fine local rule", async () => {
    const s = adapter(() => "我很好");
    expect(await s.translator.translate("Fine!", "en", "zh-TW")).toBe("好的。"); expect(s.send).not.toHaveBeenCalled();
    await s.translator.translate("Fine?", "en", "zh-TW"); expect(s.send).toHaveBeenCalledTimes(1);
  });
  it("does not call the provider for an exact-only body", async () => {
    const s = adapter(() => {throw Error("unexpected");});
    expect(await s.translator.translate("PH-BK / 30%", "en", "zh-TW")).toBe("PH-BK / 30%"); expect(s.send).not.toHaveBeenCalled();
  });
  it("requests only the selected glossary response, with no auxiliary quotes", async () => {
    const s = adapter(() => "請確認。", "nmt-direct-glossary-v1");
    expect(await s.translator.translate('Please confirm "loading".', "en", "zh-TW")).toBe("請確認。");
    expect(s.send.mock.calls[0]![0]).toMatchObject({contents: ['Please confirm "loading".'], mimeType: "text/plain", glossaryConfig: {glossary: parent + "/glossaries/nmt-trade-en-zh-v9"}});
  });
  it("converts ordinary text to Traditional Chinese while preserving literal glyphs", async () => {
    const s = adapter(request => request.contents[0]!.replace("Check", "检查"));
    expect(await s.translator.translate("Check 简体公司.", "en", "zh-TW", {copyExactRanges: [{start: 6, length: 4}]})).toBe("檢查 简体公司.");
  });
  it.each([{}, {translations: []}, {translations: [{translatedText: ""}]}, {translations: [{translatedText: "a"}, {translatedText: "b"}]}, {glossaryTranslations: [{translatedText: "Hello"}]}])("rejects unusable/mismatched response without retry: %j", async response => {
    const send = vi.fn(async () => [response] as [NmtResponse]);
    const t = new NmtDirectTranslator({projectId, profile: "nmt-direct-v1"}, {translateText: send});
    await expect(t.translate(source, "zh-TW", "en")).rejects.toMatchObject({reason: "invalid_response_format"}); expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not retry provider failure or expose its error payload", async () => {
    const send = vi.fn(async () => {throw Error("PRIVATE PROVIDER CONTENT");});
    const t = new NmtDirectTranslator({projectId, profile: "nmt-direct-v1"}, {translateText: send});
    await expect(t.translate(source, "zh-TW", "en")).rejects.toBeInstanceOf(NmtDirectServiceError); expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects unusable lengths and unsupported languages before calling", async () => {
    const s = adapter(() => "hello");
    for (const text of ["", " ".repeat(3), "中".repeat(2001)]) await expect(s.translator.translate(text, "zh-TW", "en")).rejects.toMatchObject({reason: "invalid_input_length"});
    await expect(s.translator.translate(source, "zh-TW", "vi")).rejects.toMatchObject({reason: "unsupported_language"}); expect(s.send).not.toHaveBeenCalled();
    const long = adapter(() => "a".repeat(4501)); await expect(long.translator.translate(source, "zh-TW", "en")).rejects.toMatchObject({reason: "output_too_long"});
  });
});

describe("literal manifest and transport integrity", () => {
  it("freezes tight prices, registered terms, names and contacts without freezing ordinary quantities", () => {
    const m = createLiteralManifest("Wei says USD 8/carton, 30%, CNF. Please load two containers, 2 kg, tomorrow. Email a@example.com.");
    expect(m.occurrences.map(x => x.value)).toEqual(["Wei", "USD 8/carton", "30%", "CNF", "a@example.com"]);
    expect(createLiteralManifest(source).occurrences).toEqual([]);
  });
  // This previously accepted unquoted syntax is deliberately withdrawn, even when delimited.
  it.each(["USD 8 / 袋-XL", "USD 9 / 袋 XL-A", "20公斤"])("rejects withdrawn unquoted bounded rate/unit %s", async value => {
    const s = adapter(() => "unexpected");
    await expect(s.translator.translate("保持原樣 " + value + "。", "zh-TW", "en")).rejects.toMatchObject({reason: "ambiguous_copy_exact"});
    expect(s.send).not.toHaveBeenCalled();
  });
  it("supports quoted and trusted explicit scopes while failing ambiguous instructions before service", () => {
    expect(createLiteralManifest('Copy exactly 「Alex Logistics」 please.').occurrences.map(x => x.value)).toEqual(["Alex Logistics"]);
    expect(() => createLiteralManifest("保持原樣 整個自然句子沒有指定片段。")).toThrow("ambiguous_copy_exact");
  });
  it("handles repeated native names, UTF-16 and reordering by occurrence instead of searching names", () => {
    const text = "😀 @Alex 請聯絡 @Alex。";
    const m = createLiteralManifest(text, ["Alex"], {protectedRanges: [{start: 3, length: 5}, {start: 13, length: 5}]});
    const w = createNmtTransport(m);
    const output = '<div id="p0">Ask <span id="l1"> @Alex</span> and <span id="l0">@Alex</span>.</div>'.replace("> @Alex", ">@Alex");
    const r = w.decode(output);
    expect(r.text).toBe("Ask @Alex and @Alex.");
    expect(r.ranges).toEqual([{sourceStart: 13, start: 4, length: 5}, {sourceStart: 3, start: 14, length: 5}]);
  });
  it.each([{start: 1, length: 2}, {start: -1, length: 1}, {start: 2, length: 0}, {start: 0, length: 99}])("rejects invalid or split-surrogate native range %j", range => {
    expect(() => createLiteralManifest("😀 @Alex", [], {protectedRanges: [range]})).toThrow("invalid_protected_range");
  });
  it("merges literal overlap and preserves the native offset within an explicitly exact union", () => {
    const m = createLiteralManifest("Hello @Alex.", ["Alex"], {protectedRanges: [{start: 6, length: 5}], copyExactRanges: [{start: 0, length: 11}]});
    const r = createNmtTransport(m).decode(createNmtTransport(m).contents[0]!);
    expect(r.ranges).toEqual([{sourceStart: 6, start: 6, length: 5}]);
  });
  it("decodes one transport layer and preserves source entity/markup and full-width spelling", () => {
    const text = "Check &amp;amp; <b> ＰＨ－ＢＫ and ３０％.";
    const w = createNmtTransport(createLiteralManifest(text));
    expect(w.decode(w.contents[0]!.replace("Check", "檢查")).text).toBe(text.replace("Check", "檢查"));
  });
  it("preserves empty paragraphs and source CRLF; harmless attribute order, quotes and casing are accepted", () => {
    const text = "Check PH-BK.\r\n\r\nThen 30%.";
    const w = createNmtTransport(createLiteralManifest(text));
    const out = w.contents[0]!.replace('translate="no" id="l0"', "ID='l0' CLASS='notranslate' TRANSLATE='no'").replace("Check", "Confirm");
    expect(w.decode(out).text).toBe(text.replace("Check", "Confirm"));
  });
  it.each([
    (s: string) => s.replace("PH-BK", "PP-BK"),
    (s: string) => s.replace(/<span[^>]*>PH-BK<\/span>/u, ""),
    (s: string) => s.replace(/(<span[^>]*>PH-BK<\/span>)/u, "$1$1"),
    (s: string) => s.replace("</div>", " PH-BK</div>"),
    (s: string) => s.replace('id="l0"', 'id="l99"'),
    (s: string) => s.replace('id="l0"', 'id="l0" id="l0"'),
    (s: string) => s.replace("</div>", "<script>evil()</script></div>"),
    (s: string) => s.replace('translate="no"', 'onclick="evil()"'),
  ])("rejects corruption without restoring a changed source literal", mutate => {
    const w = createNmtTransport(createLiteralManifest("Check PH-BK."));
    const corrupted = mutate(w.contents[0]!);
    expect(corrupted).not.toBe(w.contents[0]);
    expect(() => w.decode(corrupted)).toThrow();
  });
  it("rejects cross-paragraph literal movement and missing/plain paragraph structure", () => {
    const w = createNmtTransport(createLiteralManifest("Check PH-BK.\nThen 30%."));
    const out = w.contents[0]!.replace('id="l0"', 'id="TMP"').replace('id="l1"', 'id="l0"').replace('id="TMP"', 'id="l1"').replace("PH-BK", "30%").replace("Then 30%", "Then PH-BK");
    expect(() => w.decode(out)).toThrow();
    expect(() => createNmtTransport(createLiteralManifest("你好\n再見")).decode("Hello, goodbye")).toThrow("paragraph_structure_changed");
  });
});

describe("trusted profile and controlled-client boundaries", () => {
  const raw = (): ControlledNmtRequest => ({parent, model: parent + "/models/general/nmt", contents: [source], mimeType: "text/plain", sourceLanguageCode: "zh-TW", targetLanguageCode: "en"});
  it("keeps the default legacy whitelist closed to plain/no glossary", async () => {
    const send = vi.fn(), reserve = vi.fn();
    const c = new ControlledNmtClient({translateText: send}, {reserve}, "manual", identity);
    await expect(c.translateText(raw(), {timeout: 15000, retry: {retryCodes: []}})).rejects.toThrow(); expect(reserve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it("reserves once before the direct provider and sends a snapshot despite caller mutation", async () => {
    const calls: string[] = [], request = raw();
    const send = vi.fn(async (frozen: ControlledNmtRequest) => {calls.push("send"); expect(frozen.contents[0]).toBe(source); return [{translations: [{translatedText: "Loading at 1 p.m."}]}] as [NmtResponse];});
    const reserve = vi.fn(async () => {calls.push("reserve");});
    const c = new ControlledNmtClient({translateText: send}, {reserve}, "manual", async () => {request.contents[0] = "changed"; return identity();}, false, undefined, "nmt-direct-v1");
    await c.translateText(request, {timeout: 15000, retry: {retryCodes: []}});
    expect(calls).toEqual(["reserve", "send"]); expect(reserve).toHaveBeenCalledExactlyOnceWith("manual", [...source].length);
  });
  it.each([
    (r: ControlledNmtRequest) => ({...r, parent: "projects/other/locations/us-central1"}),
    (r: ControlledNmtRequest) => ({...r, model: parent + "/models/general/translation-llm"}),
    (r: ControlledNmtRequest) => ({...r, mimeType: "application/json"}),
    (r: ControlledNmtRequest) => ({...r, contents: [source, source]}),
    (r: ControlledNmtRequest) => ({...r, glossaryConfig: {glossary: parent + "/glossaries/foreign", ignoreCase: false as const, contextualTranslationEnabled: false as const}}),
    (r: ControlledNmtRequest) => ({...r, userId: "PRIVATE ID"}),
  ])("rejects foreign/unsupported direct request before reservation", mutate => {
    expect(() => assertNmtProfileRequest(mutate(raw()), "nmt-direct-v1")).toThrow();
  });
  it("cannot expand Vietnamese controls through an English direct profile", () => {
    const viRequest = {...raw(), parent: "projects/" + projectId + "/locations/global", model: "projects/" + projectId + "/locations/global/models/general/nmt", targetLanguageCode: "vi"};
    expect(() => assertNmtProfileRequest(viRequest, "nmt-direct-v1")).toThrow();
    expect(() => assertNmtProfileRequest({...viRequest, mimeType: "text/html"}, "nmt-direct-v1")).not.toThrow();
  });
  it("fails closed for engine/profile mismatches and wires the candidate independently", async () => {
    expect(resolveNmtRuntimeProfile("nmt-glossary", "legacy-glossary")).toBe("legacy-glossary");
    for (const [engine, profile] of [["google", "nmt-direct-v1"], ["nmt-direct", "legacy-glossary"], ["nmt-glossary", "nmt-direct-v1"]]) expect(() => resolveNmtRuntimeProfile(engine!, profile!)).toThrow();
    const send = vi.fn(async () => [{translations: [{translatedText: "Loading at 1 p.m."}]}] as [NmtResponse]);
    const translator = createTranslator({engine: "nmt-direct", projectId, location: "global", model: "ignored", protectedNames: "", nmtDirect: {profile: "nmt-direct-v1", client: {translateText: send}}});
    expect(translator).toBeInstanceOf(NmtDirectTranslator);
    const viTranslator = {translate: vi.fn(async () => "越南文")};
    const router = createTranslationProgramRouter(() => ({translator, mentionAliases: []}), () => viTranslator);
    expect(router("zh-vi").translator).toBe(viTranslator);
    expect(await router("zh-en").translator.translate(source, "zh-TW", "en")).toBe("Loading at 1 p.m.");
  });
});

describe("first independent review contract repairs", () => {
  it.each(["ZX-Q7", "Wei", "USD 7/carton"])("rejects an added declared literal in a different paragraph: %s", value => {
    const w = createNmtTransport(createLiteralManifest("Check " + value + ".\nDeliver tomorrow."));
    const changed = w.contents[0]!.replace("Deliver tomorrow.", "Deliver tomorrow with " + value + ".");
    expect(() => w.decode(changed)).toThrow("exact_occurrence_changed");
  });
  it("accepts legitimate same-valued literals in multiple paragraphs", () => {
    const source = "Check ZX-Q7.\nDeliver ZX-Q7.";
    const w = createNmtTransport(createLiteralManifest(source));
    expect(w.decode(w.contents[0]!).text).toBe(source);
  });
  it.each(["&#10;", "&#xA;", "&#13;", "&#x2028;", "&#x2029;"])("rejects a paragraph separator created by one transport decode: %s", entity => {
    const w = createNmtTransport(createLiteralManifest("Check ZX-Q7."));
    expect(() => w.decode(w.contents[0]!.replace("Check ", "Check" + entity))).toThrow("paragraph_structure_changed");
  });
  it("preserves literal encoded newline data and Unicode source separators exactly", () => {
    const source = "Check &#10; and ZX-Q7.\u2028\u2029Confirm tomorrow.";
    const w = createNmtTransport(createLiteralManifest(source));
    expect(w.decode(w.contents[0]!).text).toBe(source);
    const plain = createNmtTransport(createLiteralManifest("你好\u2028再見"));
    expect(plain.decode("Hello\nGoodbye").text).toBe("Hello\u2028Goodbye");
  });
  it.each(["USD 7 / 袋", "USD 7 / bag", "USD 7 / 袋 XL-A"])("freezes one immediate quoted rate, leaving the following clause translatable: %s", price => {
    const source = "保持原樣「" + price + "」，並在明天下午完成交貨。";
    const m = createLiteralManifest(source), w = createNmtTransport(m);
    expect(m.occurrences.map(item => item.value)).toContain(price);
    expect(m.occurrences.some(item => item.value.includes("明天下午"))).toBe(false);
    const output = w.contents[0]!.replace("保持原樣", "Keep").replace("並在明天下午完成交貨", "and deliver tomorrow afternoon").replace("。", ".");
    expect(w.decode(output).text).toBe("Keep「" + price + "」，and deliver tomorrow afternoon.");
  });
  it.each(["USD 7 / 袋並在明天下午完成交貨", "USD 7 / unknown multiword unit", "USD 7 / bagsExtra", "USD 11 /袋 XL", "USD 11 /bags Extra Large", "USD 7 / 袋 並在明天下午完成交貨", "20公斤 再裝櫃"])("refuses an ambiguous unquoted exact scope before provider use: %s", value => {
    expect(() => createLiteralManifest("保持原樣 " + value + "。")).toThrow("ambiguous_copy_exact");
  });
  // Straight/single delimiter syntax is explicitly withdrawn; these original positive inputs are now rejected.
  it.each(['"USD 7 / unknown multiword unit"', "'USD 7 / unknown multiword unit'"])("rejects withdrawn symmetric exact operand %s", async quote => {
    const s = adapter(() => "unexpected");
    await expect(s.translator.translate("Copy exactly " + quote + ". Deliver tomorrow.", "en", "zh-TW")).rejects.toMatchObject({reason: "ambiguous_copy_exact"});
    expect(s.send).not.toHaveBeenCalled();
  });
});

describe("bounded operands and anchored native multiplicity", () => {
  it.each(["USD 11 /袋 XL", "USD 11 /bags Extra Large"])("rejects a prefix-only unquoted operand before provider: %s", async value => {
    const s = adapter(() => "unexpected");
    await expect(s.translator.translate("保持原樣 " + value + "。", "zh-TW", "en")).rejects.toMatchObject({reason: "ambiguous_copy_exact"});
    expect(s.send).not.toHaveBeenCalled();
  });
  it.each(["USD 11 /袋 XL", "USD 11 /bags Extra Large"])("preserves the complete quoted operand: %s", value => {
    const m = createLiteralManifest("保持原樣「" + value + "」。明天交貨。");
    const w = createNmtTransport(m);
    expect(m.occurrences.map(item => item.value)).toContain(value);
    expect(w.decode(w.contents[0]!.replace("明天交貨", "Deliver tomorrow")).text).toContain(value);
    expect(() => w.decode(w.contents[0]!.replace("XL", "XS").replace("Large", "Small"))).toThrow();
  });
  it.each([" ", "\n"])("allows an unrelated native name prefix to change across %j", separator => {
    const source = "請通知 @Wei。" + separator + "@Weisheng 明天出貨。";
    const m = createLiteralManifest(source, [], {protectedRanges: [{start: 4, length: 4}]});
    const w = createNmtTransport(m);
    const output = w.contents[0]!.replace("@Weisheng", "Weisheng");
    expect(w.decode(output).text).toBe(source.replace("@Weisheng", "Weisheng"));
    expect(() => w.decode(output.replace('</div>', ' @Wei</div>'))).toThrow("exact_occurrence_changed");
  });
  it("anchors a native name touching translated letters using restored UTF-16 positions", () => {
    const source = "😀A@WeiB";
    const m = createLiteralManifest(source, [], {protectedRanges: [{start: 3, length: 4}]});
    const w = createNmtTransport(m);
    const out = w.contents[0]!.replace("😀A", "Long").replace(/B<\/div>/u, "Name</div>");
    const restored = w.decode(out);
    expect(restored.text).toBe("Long@WeiName");
    expect(restored.ranges).toEqual([{sourceStart: 3, start: 4, length: 4}]);
  });
  it("preserves a trusted union and its native identity beside unrelated prefixes", () => {
    const source = "Hello @Wei.\n@Weisheng";
    const m = createLiteralManifest(source, [], {protectedRanges: [{start: 6, length: 4}], copyExactRanges: [{start: 0, length: 10}]});
    const w = createNmtTransport(m);
    // An opaque explicit union has its own count, not a search for the nested native value.
    const result = w.decode(w.contents[0]!.replace("@Weisheng", "Weisheng"));
    expect(result.ranges).toEqual([{sourceStart: 6, start: 6, length: 4}]);
    expect(result.text).toBe(source.replace("@Weisheng", "Weisheng"));
  });
});

describe("explicit directive coverage after withdrawing unquoted inference", () => {
  it.each([
    "保持原樣 20 kg Extra Large，請確認 ZX-Q7。",
    "保持原樣 20 kg Extra Large，另有 30 kg。",
    '保持原樣 20 kg Extra Large，另有 "good"。',
    '保持原樣 20 kg Extra Large；保持原樣 "30 kg"。',
    '保持原樣 "30 kg"；保持原樣 20 kg Extra Large。',
    'Copy exactly unknown operand, see ZX-Q7 and "later quote".',
    "保持原樣 USD 8/carton，請通知 Wei。",
    "保持原樣 請联系 a@example.com。",
    'Copy exactly: "" and ZX-Q7.',
    'Copy exactly: "unclosed',
    "保持原樣「outer「inner」」",
    '保持原樣\n"20 kg"',
  ])("rejects each unresolved directive before provider regardless of other scopes: %s", async text => {
    const s = adapter(() => "unexpected");
    await expect(s.translator.translate(text, "zh-TW", "en")).rejects.toMatchObject({reason: "ambiguous_copy_exact"});
    expect(s.send).not.toHaveBeenCalled();
    expect(s.metrics[0]).toMatchObject({attempt: 0, apiCalled: false, protectionVersion: "nmt-literal-explicit-v1"});
  });
  it.each([
    '保持原樣「USD 11 /袋 XL」。明天交貨。',
    "原樣保留「20 kg Extra Large」。明天交貨。",
    "不要改單位：“20公斤”。明天交貨。",
    "不更改單位「20 kg Extra Large」。明天交貨。",
    'Copy exactly: “20 kg Extra Large”. Deliver tomorrow.',
    'Do not convert the units 「20 kg Extra Large」. Deliver tomorrow.',
  ])("preserves a complete immediate explicit scope and translates following body: %s", text => {
    const m = createLiteralManifest(text), w = createNmtTransport(m);
    expect(m.directives).toHaveLength(1);
    expect(m.directives[0]).toMatchObject({state: "resolved", evidence: "quoted"});
    const output = w.contents[0]!.replace("明天交貨", "Deliver tomorrow");
    expect(w.decode(output).text).toBe(text.replace("明天交貨", "Deliver tomorrow"));
    expect(() => w.decode(output.replace(/11|20/u, "99"))).toThrow("exact_occurrence_changed");
  });
  it("tracks every directive instead of a paragraph-wide found flag", () => {
    const source = '保持原樣「20 kg Extra Large」；Copy exactly 「USD 8 / 袋 XL」。\r\n原樣保留「ZX-Q7」。';
    const m = createLiteralManifest(source);
    expect(m.directives.map(d => [d.id, d.paragraph, d.state])).toEqual([["d0", 0, "resolved"], ["d1", 0, "resolved"], ["d2", 1, "resolved"]]);
    for (const d of m.directives) expect(source.slice(d.operand!.start, d.operand!.start + d.operand!.length)).not.toContain("保持原樣");
    const w = createNmtTransport(m); expect(w.decode(w.contents[0]!).text).toBe(source);
  });
  it("does not turn a cue inside an exact quoted operand into another instruction", () => {
    const source = 'Copy exactly 「保持原樣 20 kg Extra Large」. Deliver tomorrow.';
    const m = createLiteralManifest(source);
    expect(m.directives).toHaveLength(1);
    expect(m.occurrences.map(x => x.value)).toContain("保持原樣 20 kg Extra Large");
  });
  it("resolves only a trusted range starting at the immediate operand", async () => {
    const text = "保持原樣 20 kg Extra Large，請確認 ZX-Q7。";
    const start = text.indexOf("20 kg"), length = "20 kg Extra Large".length;
    const m = createLiteralManifest(text, [], {copyExactRanges: [{start, length}]});
    expect(m.directives[0]).toMatchObject({state: "resolved", evidence: "trusted", operand: {start, length}});
    const w = createNmtTransport(m); expect(w.decode(w.contents[0]!).text).toBe(text);
    expect(() => w.decode(w.contents[0]!.replace("20 kg", "19 kg"))).toThrow();
    const s = adapter(() => "unexpected");
    await expect(s.translator.translate(text, "zh-TW", "en", {copyExactRanges: [{start: text.indexOf("ZX-Q7"), length: 5}]})).rejects.toMatchObject({reason: "ambiguous_copy_exact"});
    expect(s.send).not.toHaveBeenCalled();
  });
  it("treats a fully trusted cue as opaque data and retains UTF-16 native offsets", () => {
    const source = '😀 保持原樣「@Alex 20 kg Extra Large」。';
    const native = {start: source.indexOf("@Alex"), length: 5};
    const m = createLiteralManifest(source, [], {protectedRanges: [native]});
    const w = createNmtTransport(m), r = w.decode(w.contents[0]!.replace("保持原樣", "Keep"));
    expect(r.ranges).toHaveLength(1);
    expect(r.text.slice(r.ranges[0]!.start, r.ranges[0]!.start + 5)).toBe("@Alex");
    expect(r.ranges[0]!.sourceStart).toBe(native.start);
    const opaque = createLiteralManifest("Copy exactly unknown operand", [], {copyExactRanges: [{start: 0, length: 28}]});
    expect(opaque.directives).toEqual([]);
  });
  it("does not associate a trusted declaration with a different directive", () => {
    const source = "保持原樣 first operand；保持原樣 second operand。";
    const context = {copyExactRanges: [{start: source.indexOf("second operand"), length: "second operand".length}]};
    expect(() => createLiteralManifest(source, [], context)).toThrow("ambiguous_copy_exact");
  });
  it("keeps automatic literals independent when no explicit directive is present", async () => {
    const text = "請確認 20 kg Extra Large，明天交貨。";
    const s = adapter(() => "Confirm 20 kg Extra Large and deliver tomorrow.");
    expect(await s.translator.translate(text, "zh-TW", "en")).toBe("Confirm 20 kg Extra Large and deliver tomorrow.");
    expect(s.send.mock.calls[0]![0].contents).toEqual([text]);
    expect(createLiteralManifest("copy exactlyness units").directives).toEqual([]);
  });
});

describe("typographic/trusted declaration after symmetric delimiter withdrawal", () => {
  it.each([
    'Copy exactly "outer "inner" outer". Deliver tomorrow.',
    "Copy exactly 'O'Reilly Logistics'. Deliver tomorrow.",
    'Copy exactly "ordinary". Deliver tomorrow.',
    "Copy exactly 'ordinary'. Deliver tomorrow.",
    '保持原樣 "20 kg"；保持原樣「good」，請確認 ZX-Q7。',
    "保持原樣 'O'Reilly'，請聯絡 Wei。",
  ])("rejects withdrawn symmetric syntax before provider without prefix truncation: %s", async text => {
    const s = adapter(() => "unexpected");
    await expect(s.translator.translate(text, "en", "zh-TW")).rejects.toMatchObject({reason: "ambiguous_copy_exact"});
    expect(s.send).not.toHaveBeenCalled();
  });
  it.each(["O'Reilly Logistics", 'outer "inner" outer', "USD 11 /袋 XL"])("preserves apostrophes and ASCII quotes as typographic operand data: %s", value => {
    const source = "Copy exactly 「" + value + "」. Deliver tomorrow.";
    const m = createLiteralManifest(source), w = createNmtTransport(m);
    expect(m.directives).toHaveLength(1);
    expect(m.occurrences.map(x => x.value)).toContain(value);
    expect(w.decode(w.contents[0]!).text).toBe(source);
    const bad = w.contents[0]!.replace("Reilly", "Changed").replace("inner", "changed").replace("11", "99");
    expect(() => w.decode(bad)).toThrow("exact_occurrence_changed");
  });
  it("accepts arbitrary symmetric text only when a trusted range explicitly owns the full operand", () => {
    const operand = "'O'Reilly Logistics'", source = "Copy exactly " + operand + ". Deliver tomorrow.";
    const context = {copyExactRanges: [{start: source.indexOf(operand), length: operand.length}]};
    const m = createLiteralManifest(source, [], context), w = createNmtTransport(m);
    expect(m.directives[0]?.evidence).toBe("trusted");
    expect(w.decode(w.contents[0]!).text).toBe(source);
    expect(() => w.decode(w.contents[0]!.replace("Reilly", "Changed"))).toThrow();
  });
});
