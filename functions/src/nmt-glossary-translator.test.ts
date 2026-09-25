import {it, expect, vi} from "vitest";
import {NmtGlossaryTranslator, type NmtGlossaryRequest} from "./nmt-glossary-translator.js";
const parent = "projects/test-project/locations/us-central1";
const options = {projectId: "test-project", location: "us-central1", glossaryZhEn: parent + "/glossaries/zh-en", glossaryEnZh: parent + "/glossaries/en-zh"};
it("translates the full Chinese message with visible weights and keeps all paragraph separators", async () => {
  const translateText = vi.fn().mockImplementation(async (request: NmtGlossaryRequest) => {
    expect(request.contents).toHaveLength(1);
    expect(request.contents[0]).toContain("20公斤");
    expect(request.contents[0]).toContain("600公斤");
    return [{glossaryTranslations: [{translatedText: '<div id="p0">Prefer 20 kg small bags.</div><div id="p1"></div><div id="p2">Use 600 kg FIBC bags if the small bags are unavailable.</div>'}]}];
  });
  const result = await new NmtGlossaryTranslator(options, {translateText}).translate("優先20公斤小袋。\r\n\r\n小袋不可得時使用600公斤 FIBC大袋。", "zh-TW", "en");
  expect(result).toBe("Prefer 20kg small bags.\r\n\r\nUse 600kg FIBC bags if the small bags are unavailable.");
});
it.each([
  ['<div id="p0">使用20 kg個袋子。</div>', "quantity_relationship_changed"],
  ['<div id="p0">使用20 lb的袋子。</div>', "quantity_unit_or_content_changed"],
  ['<div id="p0">使用20 kg及20 kg袋子。</div>', "quantity_unit_or_content_changed"],
  ['使用20 kg的袋子。', "paragraph_structure_changed"],
])("rejects invalid public adapter output and emits only finite private metrics", async (output, reason) => {
  const translateText = vi.fn().mockImplementation(async (request: NmtGlossaryRequest) => {
    const span = request.contents[0]!.match(/<span\b[^>]*>20 kg<\/span>/u)?.[0];
    return [{glossaryTranslations: [{translatedText: span && output.includes("<div") ? output.replace("20 kg", span) : output}]}];
  });
  const onMetric = vi.fn();
  await expect(new NmtGlossaryTranslator({...options, onMetric}, {translateText}).translate("Use 20 kg bags.", "en", "zh-TW")).rejects.toThrow(reason);
  expect(translateText).toHaveBeenCalledTimes(1);
  expect(onMetric.mock.calls.map(([m]) => m.reason)).toEqual([reason]);
  for (const [metric] of onMetric.mock.calls) expect(Object.keys(metric).sort()).toEqual(["attempt", "direction", "elapsedMs", "engine", "inputCharacters", "outcome", "outputCharacters", "reason"]);
  expect(JSON.stringify(onMetric.mock.calls)).not.toContain("Use");
});
it("accepts a correct prohibition through the real public API", async () => {
  const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: '<div id="p0">總量600 公斤，使用20 公斤袋裝。請保留數值，不要計算袋數。</div>'}]}]);
  await expect(new NmtGlossaryTranslator(options, {translateText}).translate("The total is 600 kg, packed in 20 kg bags. Keep these figures; do not calculate the number of bags.", "en", "zh-TW"))
    .resolves.toBe("總量600 kg，使用20 kg袋裝。請保留數值，不要計算袋數。");
});
it("rejects paragraph merging through the real adapter", async () => {
  const translateText = vi.fn().mockResolvedValue([{glossaryTranslations: [{translatedText: '<div id="p0">使用20 kg小袋和600 kg大袋。</div>'}]}]);
  await expect(new NmtGlossaryTranslator(options, {translateText}).translate("Use 20 kg bags.\n\nUse 600 kg bags.", "en", "zh-TW")).rejects.toThrow("paragraph_structure_changed");
});
it("preserves literal nested entities and never exposes identity mappings", async () => {
  const source = "@A<&amp; 請確認 &amp;amp;";
  const translateText = vi.fn().mockImplementation(async (request: NmtGlossaryRequest) => {
    expect(JSON.stringify(request)).not.toContain("sourceStart");
    expect(JSON.stringify(request)).not.toContain("userId");
    return [{glossaryTranslations: [{translatedText: request.contents[0]!.replace("請確認", "Please confirm") }]}];
  });
  const result = await new NmtGlossaryTranslator(options, {translateText}).translateWithRanges(source, "zh-TW", "en", {protectedRanges: [{start: 0, length: 8}]});
  expect(result.text).toBe("@A<&amp; Please confirm &amp;amp;");
  expect(result.ranges).toEqual([{sourceStart: 0, start: 0, length: 8}]);
});


it("uses only general NMT with ordinary same-region glossary and no retry", async () => {
 const translateText=vi.fn(async(request: NmtGlossaryRequest, callOptions: unknown)=>{
  expect(request.model).toBe(parent+"/models/general/nmt");expect(request.parent).toBe(parent);
  expect(request.glossaryConfig).toEqual({glossary:options.glossaryZhEn,ignoreCase:false,contextualTranslationEnabled:false});
  expect(callOptions).toEqual({timeout:15000,retry:{retryCodes:[]}});
  return [{glossaryTranslations:[{translatedText:request.contents[0]!.replace("請確認", "Please confirm")}]}] as [{glossaryTranslations:Array<{translatedText:string}>}];
 });
 await expect(new NmtGlossaryTranslator(options,{translateText}).translate("請確認。","zh-TW","en")).resolves.toBe("Please confirm。");expect(translateText).toHaveBeenCalledTimes(1);
});
it.each([{translations:[{translatedText:'<div id="p0">Please confirm</div>'}]},{glossaryTranslations:[]},{glossaryTranslations:[{translatedText:null}]},{glossaryTranslations:[{translatedText:'x'},{translatedText:'y'}]}])("rejects missing, empty, or wrong-count glossary output without fallback",async response=>{
 const translateText=vi.fn().mockResolvedValue([response]);await expect(new NmtGlossaryTranslator(options,{translateText}).translate("請確認。","zh-TW","en")).rejects.toThrow('invalid_response_format');expect(translateText).toHaveBeenCalledTimes(1);
});
it("does not retry a service failure or open its own uncontrolled client",async()=>{
 const translateText=vi.fn().mockRejectedValue(Error('timeout'));await expect(new NmtGlossaryTranslator(options,{translateText}).translate('請確認。','zh-TW','en')).rejects.toThrow('unavailable');expect(translateText).toHaveBeenCalledTimes(1);
 await expect(new NmtGlossaryTranslator(options).translate('請確認。','zh-TW','en')).rejects.toThrow('unavailable');
});
it("counts and validates quotes as auxiliaries in the same single request",async()=>{
 const translateText=vi.fn(async(request:NmtGlossaryRequest)=>{
  expect(request.contents).toHaveLength(2);expect(request.contents[0]).toContain('Please say');
  return [{glossaryTranslations:[{translatedText:'<div id="p0">請說「Hello」</div>'},{translatedText:'<div id="a0">你好</div>'}]}] as [{glossaryTranslations:Array<{translatedText:string}>}];
 });
 await expect(new NmtGlossaryTranslator(options,{translateText}).translate('Please say「Hello」','en','zh-TW')).resolves.toBe('請說「你好」');expect(translateText).toHaveBeenCalledTimes(1);
});
it("enforces output UTF16 cap after restoration",async()=>{
 const translateText=vi.fn().mockResolvedValue([{glossaryTranslations:[{translatedText:'<div id="p0">'+ 'a'.repeat(4501)+'</div>'}]}]);await expect(new NmtGlossaryTranslator(options,{translateText}).translate('請確認','zh-TW','en')).rejects.toThrow('output_too_long');expect(translateText).toHaveBeenCalledTimes(1);
});
it("rejects wrong-region and cross-project glossaries before a request",()=>{
 expect(()=>new NmtGlossaryTranslator({...options,location:'global'})).toThrow();expect(()=>new NmtGlossaryTranslator({...options,glossaryZhEn:options.glossaryZhEn.replace('test-project','production-project')})).toThrow();
});
it("skips a pure protected code without consuming a provider request",async()=>{
 const translateText=vi.fn();await expect(new NmtGlossaryTranslator(options,{translateText}).translate('PP-BK?','en','zh-TW')).resolves.toBe('PP-BK?');expect(translateText).not.toHaveBeenCalled();
});
