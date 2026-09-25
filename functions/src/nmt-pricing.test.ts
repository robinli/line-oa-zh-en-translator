import {it, expect} from "vitest";
import {NmtGlossaryTranslator, type NmtGlossaryRequest, type NmtGlossaryClient} from "./nmt-glossary-translator.js";
const parent = "projects/test-project/locations/us-central1";
const options = {projectId: "test-project", location: "us-central1", glossaryZhEn: parent + "/glossaries/zh-en", glossaryEnZh: parent + "/glossaries/en-zh"};
const atom = (r: NmtGlossaryRequest, value: string, occurrence = 0) => [...r.contents[0]!.matchAll(/<span\b[^>]*>([^<>]*)<\/span>/gu)].filter(m => m[1] === value)[occurrence]?.[0] ?? value;
const div = (body: string, id = 0) => '<div id="p' + id + '">' + body + '</div>';
async function translate(source: string, output: (r: NmtGlossaryRequest) => string, retry = false, target = "zh-TW") {
  let calls = 0;
  const client: NmtGlossaryClient = {async translateText(request) {calls++; return [{glossaryTranslations: [{translatedText: retry && calls === 1 ? "invalid" : output(request)}]}];}};
  return {text: await new NmtGlossaryTranslator(options, client).translate(source, target === "en" ? "zh-TW" : "en", target), calls};
}
it.each([false])("accepts confirmed per-carton/per-bag natural pricing on attempt two=%s", async retry => {
  const source = "The charge is USD 9.50/carton.\nThe charge is USD 2.40/bag.";
  const r = await translate(source, q => div("費用為每箱 " + atom(q, "USD 9.50") + "。") + div("費用為每袋 " + atom(q, "USD 2.40") + "。", 1), retry);
  expect(r.text).toBe("費用為每箱 USD 9.50。\n費用為每袋 USD 2.40。");
  expect(r.calls).toBe(retry ? 2 : 1);
});
it.each([["carton", "每纸箱", true], ["carton", "每紙箱", true], ["carton", "每箱", true], ["bag", "每袋", true], ["bag", "每個袋子", true], ["box", "每箱", true], ["box", "每紙箱", false], ["carton", "每袋", false], ["bag", "每箱", false], ["bag", "每紙箱", false]])("checks natural denomination %s → %s", async (from, phrase, good) => {
  const result = translate("The charge is USD 9.50/" + from + ".", q => div("費用為" + phrase + atom(q, "USD 9.50") + "。"));
  if (good) await expect(result).resolves.toHaveProperty("calls", 1);
  else await expect(result).rejects.toThrow("price_denominator_changed");
});
it.each(["每紙箱", "每箱"])("binds natural denominations to the original paragraphs: %s", async carton => {
  await expect(translate("The charge is USD 9.50/carton.\nThe charge is USD 2.40/bag.",
    q => div(carton + atom(q, "USD 2.40") + "。") + div("每袋" + atom(q, "USD 9.50") + "。", 1))).rejects.toThrow("quantity_paragraph_changed");
});
it.each([false])("does not allow repeated equal amounts to exchange denominators, retry=%s", async retry => {
  const source = "The charge is USD 9.50/carton; the charge is USD 9.50/bag.";
  await expect(translate(source, q => div("每袋" + atom(q, "USD 9.50", 0) + "；每箱" + atom(q, "USD 9.50", 1) + "。"), retry)).rejects.toThrow("price_denominator_changed");
  const result = await translate(source, q => div("每袋" + atom(q, "USD 9.50", 1) + "；每箱" + atom(q, "USD 9.50", 0) + "。"), retry);
  expect(result.text).toBe("每袋USD 9.50；每箱USD 9.50。");
});
it.each(["USD 9.5", "EUR 9.50", "USD -9.50", "USD 95.0"])("does not restore over changed natural-rate amount %s", async changed => {
  await expect(translate("The charge is USD 9.50/carton.", q => div("每箱" + atom(q, "USD 9.50").replace("USD 9.50", changed) + "。"))).rejects.toThrow("quantity_content_changed");
});
it.each([["每袋", "/袋"], ["每袋", "/箱"], ["每袋每袋", ""], ["每袋", " per bag"], ["每袋", "+"]])("rejects duplicate/contradictory denominators or arithmetic %s %s", async (prefix, suffix) => {
  await expect(translate("The charge is USD 9.50/bag.", q => div(prefix + atom(q, "USD 9.50") + suffix + "。"))).rejects.toThrow();
});
it.each([["bag", "bag", true], ["袋", "bag", true], ["carton", "carton", true], ["箱", "box", true], ["carton", "box", false], ["crate pack", "bag", false], ["bag-XL", "bag", false]])("checks English per rendering %s → %s", async (from, to, good) => {
  const result = translate("費用為USD 9.50/" + from + "。", q => div("The charge is " + atom(q, "USD 9.50") + " per " + to + "."), false, "en");
  if (good) await expect(result).resolves.toHaveProperty("calls", 1);
  else await expect(result).rejects.toThrow("price_denominator_changed");
});
it.each([false])("copy-exact restores one original denominator after natural prefix, retry=%s", async retry => {
  const r = await translate("Copy exactly USD 9.50 / bag.", q => div("原樣保留每袋 " + atom(q, "USD 9.50") + "。"), retry);
  expect(r.text).toBe("原樣保留USD 9.50 / bag。");
  expect(r.text).not.toContain("每");
});
it("copy-exact removes an accepted English per phrase before restoring the source suffix", async () => {
  const r = await translate("保持原樣USD 9.50/袋。", q => div("Keep " + atom(q, "USD 9.50") + " per bag."), false, "en");
  expect(r.text).toBe("Keep USD 9.50/袋.");
  expect(r.text).not.toContain("per");
});
it.each(["crate pack", "crate-pack", "crate/day"])("keeps unknown denominators opaque, %s", async denominator => {
  await expect(translate("The charge is USD 9.50/" + denominator + ".", q => div("每箱" + atom(q, "USD 9.50") + "。"))).rejects.toThrow("price_denominator_changed");
  const r = await translate("The charge is USD 9.50/" + denominator + ".", q => div("費用為" + atom(q, "USD 9.50") + "/" + denominator + "。"));
  expect(r.text).toBe("費用為USD 9.50/" + denominator + "。");
});

it.each([["carton", true], ["bag", false]])("normalizes the known paper-carton glyph without changing denomination %s", async (from, good) => {
  const result = translate("The charge is USD 9.50/" + from + ".", q => div("費用為" + atom(q, "USD 9.50") + "/纸箱。"));
  if (good) await expect(result).resolves.toHaveProperty("text", "費用為USD 9.50/紙箱。");
  else await expect(result).rejects.toThrow("price_denominator_changed");
});
