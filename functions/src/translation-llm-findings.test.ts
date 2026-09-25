import {it, expect} from "vitest";
import {TranslationLlmTranslator, type TranslationLlmRequest, type TranslationLlmClient} from "./translation-llm-translator.js";
import {prepareLlmContext} from "./translation-llm-context.js";
import {createContextLlmHtml} from "./translation-llm-context-html.js";
const parent = "projects/test-project/locations/us-central1";
const options = {projectId: "test-project", location: "us-central1", glossaryZhEn: parent + "/glossaries/zh-en", glossaryEnZh: parent + "/glossaries/en-zh"};
const atom = (r: TranslationLlmRequest, value: string, index = 0) => [...r.contents[0]!.matchAll(/<span\b[^>]*>([^<>]*)<\/span>/gu)].filter(m => m[1] === value)[index]?.[0] ?? value;
const div = (s: string) => '<div id="p0">' + s + '</div>';
async function translate(source: string, output: (r: TranslationLlmRequest) => string, target = "zh-TW") {
  let calls = 0;
  const client: TranslationLlmClient = {async translateText(request: TranslationLlmRequest) {calls++; return [{glossaryTranslations: [{translatedText: output(request)}]}];}};
  const ranges = [...source.matchAll(/@Nora/gu)].map(m => ({start: m.index, length: 5}));
  const result = await new TranslationLlmTranslator(options, client).translateWithRanges(source, target === "en" ? "zh-TW" : "en", target, {protectedRanges: ranges});
  return {...result, calls};
}
it.each([false, true])("binds repeated native mentions to their quantity objects, retry=%s", async retry => {
  const source = "@Nora has confirmed 15 kg; @Nora has not confirmed 45 kg.";
  let call = 0;
  const output = (r: TranslationLlmRequest) => ++call === 1 && retry ? "invalid" : div(atom(r, "@Nora", 0) + "已確認" + atom(r, "45 kg") + "；" + atom(r, "@Nora", 1) + "尚未確認" + atom(r, "15 kg") + "。");
  await expect(translate(source, output)).rejects.toThrow("mention_quantity_changed");
});
it.each(["45 kg", "15 kg"])("allows intact status clauses to reorder with %s", async second => {
  const source = "@Nora has confirmed 15 kg; @Nora has not confirmed " + second + ".";
  const result = await translate(source, r => div(atom(r, "@Nora", 1) + "尚未確認" + atom(r, second, second === "15 kg" ? 1 : 0) + "；" + atom(r, "@Nora", 0) + "已確認" + atom(r, "15 kg", 0) + "。"));
  expect(result.ranges.map(r => r.sourceStart)).toEqual([27, 0]);
});
it.each(["不拒絕", "尚未拒絕", "沒有拒收", "並非不接受"])("rejects condition reversal %s", async condition => {
  await expect(translate("Use 600 kg FIBC bags only if the buyer rejects the 20 kg bags. Otherwise, keep the 20 kg bags.",
    r => div("只有買方" + condition + atom(r, "20 kg", 0) + "袋子時才使用" + atom(r, "600 kg") + " FIBC袋；否則保留" + atom(r, "20 kg", 1) + "袋。"))).rejects.toThrow("packaging_condition_changed");
});
it.each(["拒絕", "拒收", "不接受"])("accepts positive rejection predicate %s", async condition => {
  await expect(translate("Use 600 kg FIBC bags only if the buyer rejects the 20 kg bags. Otherwise, keep the 20 kg bags.",
    r => div("只有買方" + condition + atom(r, "20 kg", 0) + "袋子時才使用" + atom(r, "600 kg") + " FIBC袋；否則保留" + atom(r, "20 kg", 1) + "袋。"))).resolves.toHaveProperty("calls", 1);
});
it.each(["請換算單位", "換算單位", "無需換算單位", "單位保持清楚"])("requires the explicit prohibition, rejects %s", async clause => {
  await expect(translate("Do not convert the units; you do not need to calculate the number of bags.", () => div(clause + "；無需計算袋數。"))).rejects.toThrow("action_restriction_weakened");
});
it.each(["不要換算單位", "禁止換算單位", "不得轉換單位"])("retains prohibition and unrelated no obligation %s", async clause => {
  await expect(translate("Do not convert the units; you do not need to calculate the number of bags.", () => div(clause + "；無需計算袋數。"))).resolves.toHaveProperty("calls", 1);
});
it.each([false, true])("retains quantity paragraph ownership on both wire attempts %s", retry => {
  const p = prepareLlmContext("The first order uses 17 kg bags.\nThe second order uses 680 kg bags.", [], [], "zh-TW"), wire = createContextLlmHtml(p, retry);
  const request = {contents: [wire.encode()]} as TranslationLlmRequest;
  expect(() => wire.decode('<div id="p0">首筆訂單使用' + atom(request, "680 kg") + '袋。</div><div id="p1">第二筆訂單使用' + atom(request, "17 kg") + '袋。</div>')).toThrow();
  expect(() => wire.decode('<div id="p0">首筆訂單使用' + atom(request, "17 kg") + '袋。</div><div id="p1">第二筆訂單使用' + atom(request, "680 kg") + '袋。</div>')).not.toThrow();
});
it.each([["bag", "袋", true], ["bag", "箱", false], ["bag", "紙箱", false], ["box", "箱", true], ["box", "袋", false], ["carton", "紙箱", true], ["carton", "箱", true], ["crate", "crate", true], ["crate", "箱", false], ["crate", "crates", false]])("checks external price denominator %s → %s", async (from, to, accepted) => {
  const promise = translate("The packaging charge is USD 8/" + from + ".", r => div("包裝費為" + atom(r, "USD 8") + "/" + to + "。"));
  if (accepted) await expect(promise).resolves.toHaveProperty("calls", 1);
  else await expect(promise).rejects.toThrow("price_denominator_changed");
});
it.each(["", "/box"])("rejects removed or changed pricing denominator %s", async tail => {
  await expect(translate("The price is USD 8/bag.", r => div("價格為" + atom(r, "USD 8") + tail + "。"))).rejects.toThrow();
});
it("resolves only an explicit packaging fallback at the source and rejects invented registration", async () => {
  const source = "請保留小袋方案。\n備案是560公斤 FIBC 大袋。";
  const p = prepareLlmContext(source, [], [], "en"), wire = createContextLlmHtml(p);
  expect(wire.encode()).toContain("替代方案是560公斤");
  const output = (label: string) => (r: TranslationLlmRequest) => '<div id="p0">Please keep the small bag plan.</div><div id="p1">The ' + label + ' is ' + atom(r, "560公斤") + ' FIBC bulk bags.</div>';
  await expect(translate(source, output("registered specification"), "en")).rejects.toThrow("packaging_fallback_changed");
  await expect(translate(source, output("fallback"), "en")).resolves.toHaveProperty("calls", 1);
});
it.each(["登記的規格是560公斤 FIBC 大袋。", "小袋規格需要備案登記。", "備案是登記560公斤 FIBC 大袋。", "備案是560公斤的原料。"])("leaves registration and non-packaging source untouched: %s", source => {
  const p = prepareLlmContext(source, [], [], "en");
  expect(createContextLlmHtml(p).encode()).not.toContain("替代方案");
});
it("accepts real registration without changing facts", async () => {
  await expect(translate("登記的規格是560公斤 FIBC 大袋。", r => div("The registered specification is " + atom(r, "560公斤") + " FIBC bulk bags."), "en")).resolves.toHaveProperty("calls", 1);
});

it("allows a vocative comma without detaching its quantity object", async () => {
  const source = "@Nora請確認14公斤小袋。";
  await expect(translate(source, r => div(atom(r, "@Nora") + ", please confirm the 14 kg small bags."), "en")).resolves.toHaveProperty("calls", 1);
});

it.each([["crate-pack", "crate-box", false], ["crate-pack", "crate-pack", true], ["bag-XL", "bag-XS", false], ["bag-XL", "bag-XL", true], ["crate/day", "crate/week", false], ["crate/day", "crate/day", true]])("keeps complete unknown pricing denominator %s → %s", async (from, to, accepted) => {
  const promise = translate("The packaging charge is USD 8/" + from + ".", r => div("包裝費為" + atom(r, "USD 8") + "/" + to + "。"));
  if (accepted) await expect(promise).resolves.toHaveProperty("calls", 1);
  else await expect(promise).rejects.toThrow();
});
it.each(["不會拒絕", "未曾拒絕", "不願意拒絕"])("rejects local negative rejection %s", async condition => {
  await expect(translate("Use the large bags only if the buyer rejects the small bags.", () => div("只有買方" + condition + "小袋才使用大袋。"))).rejects.toThrow("packaging_condition_changed");
});
it.each([["不拒絕", true], ["拒絕", false]])("retains an explicitly negative source condition %s", async (condition, accepted) => {
  const promise = translate("Use the large bags only if the buyer does not reject the small bags.", () => div("只有買方" + condition + "小袋才使用大袋。"));
  if (accepted) await expect(promise).resolves.toHaveProperty("calls", 1);
  else await expect(promise).rejects.toThrow("packaging_condition_changed");
});
it.each(["不是禁止換算單位", "並非禁止換算單位", "不禁止換算單位"])("does not mistake denied prohibition for prohibition: %s", async clause => {
  await expect(translate("Do not convert the units; you do not need to calculate the number of bags.", () => div(clause + "；無需計算袋數。"))).rejects.toThrow("action_restriction_weakened");
});

it.each([["short ton", "short ton", true], ["short ton", "short kg", false], ["crate pack", "crate pack", true], ["crate pack", "crate box", false], ["bag load", "bag load", true], ["bag load", "bag carton", false]])("keeps opaque multiword denominator %s → %s", async (from, to, accepted) => {
  const promise = translate("The price is USD 8/" + from + ".", r => div("價格為" + atom(r, "USD 8") + "/" + to + "。"));
  if (accepted) await expect(promise).resolves.toHaveProperty("calls", 1);
  else await expect(promise).rejects.toThrow();
});

it("validates an equivalent denominator before restoring a copy-exact price", async () => {
  const source = "Copy exactly USD 8/bag.";
  const good = await translate(source, r => div("原樣保留" + atom(r, "USD 8") + "/袋。"));
  expect(good.text).toBe("原樣保留USD 8/bag。");
  await expect(translate(source, r => div("原樣保留" + atom(r, "USD 8") + "/箱。"))).rejects.toThrow("price_denominator_changed");
});

it.each(["請勿將貿易條件由 EXW 改為 CNF。", "不要把 EXW 改成 CNF。", "不要改 EXW 為 CNF。"])("accepts prohibited object-before-verb change: %s", async output => {
  await expect(translate("Do not change EXW into CNF.", () => div(output))).resolves.toHaveProperty("calls", 1);
});
it.each(["請將 EXW 改為 CNF。", "無需把 EXW 改成 CNF。", "不是禁止將 EXW 改為 CNF。"])("rejects positive, optional or denied object-before-verb change: %s", async output => {
  await expect(translate("Do not change EXW into CNF.", () => div(output))).rejects.toThrow("action_restriction_weakened");
});
it.each(["請勿將磅換算為公斤。", "不要把磅轉換為公斤。"])("accepts prohibited unit object before operation: %s", async output => {
  await expect(translate("Do not convert pounds to kilograms.", () => div(output))).resolves.toHaveProperty("calls", 1);
});
it.each(["不要進行單位換算", "不要擅自換算單位", "不要改單位"])("accepts bounded prohibition word order %s", async output => {
  const source = output.includes("改") ? "Do not change the units." : "Do not convert the units.";
  await expect(translate(source, () => div(output + "。"))).resolves.toHaveProperty("calls", 1);
});
it("does not assign a request's object to its addressee by linear position", async () => {
  const source = "@Nora請向@Nora確認25公斤小袋。";
  const result = await translate(source, r => div(atom(r, "@Nora", 0) + ", please confirm the 25 kg small bags with " + atom(r, "@Nora", 1) + "."), "en");
  expect(result.ranges.map(r => r.sourceStart)).toEqual([0, 7]);
});
