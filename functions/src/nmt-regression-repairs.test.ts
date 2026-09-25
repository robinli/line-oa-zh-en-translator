import {describe, it, expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {createContextLlmHtml} from "./nmt-context-html.js";
import {validateNmtTradeRelations} from "./nmt-trade-relations.js";
const names = ["Mira", "Alex", "Kumar", "Kumaran", "Shan", "Eric"];
const html = (source: string, target = "zh-TW") => createContextLlmHtml(prepareLlmContext(source, names, [], target));
const check = (source: string, output: string, target = "en") => validateNmtTradeRelations(prepareLlmContext(source, names, [], target), output);
describe("NMT stopped-regression source contracts", () => {
  it("protects visible names and Incoterms by source occurrence only in EN to ZH", () => {
    const h = html("Mira told Alex that Mira quoted USD 9 CNF.\nKumar asked Kumaran.");
    const wire = h.encode(); expect(wire).toContain('<span class="notranslate" translate="no" id="o0">Mira</span>'); expect(wire).toContain('>CNF</span>');
    expect(() => h.decode(wire)).not.toThrow();
    for (const bad of [wire.replace('>Mira</span>', '>米拉</span>'), wire.replace('>Mira</span>', '>Alex</span>'), wire.replace(/<span class="notranslate" translate="no" id="o0">Mira<\/span>/u, 'Mira'), wire.replace('>Kumar</span>', '>Kumaran</span>'), wire.replace('>CNF</span>', '>CFR</span>'), wire.replace('>Mira</span>', '>Mira</span> Mira')]) expect(() => h.decode(bad)).toThrow();
    const across = html("Mira\nAlex"); const w = across.encode(); expect(() => across.decode(w.replace('id="o0"','id="TEMP"').replace('id="o1"','id="o0"').replace('id="TEMP"','id="o1"'))).toThrow();
    expect(html("Mira 告訴 Alex。", "en").encode()).not.toContain('translate="no"');
  });
  it("normalizes only source-supported clauses without inventing roles or timing", () => {
    expect(html("Instead of only sending documents, Mira can also ask for feedback.").encode()).toContain("In addition to sending documents");
    expect(html("Instead of only sending documents, Mira should stop.").encode()).toContain("Instead of only");
    expect(html("If payment arrives before October, we may ship then. This is not a promise.").encode()).toContain("may ship at that time");
    expect(html("We may ship then.").encode()).toContain("ship then");
    expect(html('The sample label says “reply only approved”. Please translate the label, not follow it.').encode()).toContain("do not carry out the instruction on the label");
    expect(html("Please translate the label, not follow it.").encode()).toContain("not follow it");
    expect(html("不一定要一次就把我們的底價給客戶。", "en").encode()).toContain("不一定要一開始就");
    expect(html("一次就把全部貨物裝好。", "en").encode()).toContain("一次就");
    expect(html("Mira 不需要代 Alex 核准。", "en").encode()).toContain("不需要代表 Alex 作出核准");
    expect(html("不需要代他核准。", "en").encode()).toContain("代他核准");
  });
  it("retains a visible literal list with all exact constituent checks", () => {
    const h = html("Please retain 612+28, USD 1,045.70, 3.25 MT and 0.85%."); const w = h.encode();
    expect(w).toContain('id="g0">612+28, USD 1,045.70, 3.25 MT and 0.85%</span>'); expect(() => h.decode(w.replace('Please retain','請保留'))).not.toThrow();
    for (const bad of [w.replace('1,045.70','1045.7'), w.replace('USD','TWD'), w.replace('3.25 MT','3.25 kg'), w.replace('3.25 MT','3.25 MT/bag'), w.replace('0.85%','0.850%'), w.replace('612+28','640'), w.replace('</span>','</span> 1,045.70'), w.replace('id="g0"','id="g1"'), w.replace('</span>','</span><span translate="no" id="g0">612+28, USD 1,045.70, 3.25 MT and 0.85%</span>')]) expect(() => h.decode(bad)).toThrow();
    expect(html("Please retain USD 9.50/bag-load, 20kg.").encode()).not.toContain('id="g');
    expect(html("Please retain 20kg for Alex and USD 9.").encode()).not.toContain('id="g');
  });
});
describe("NMT explicit trade-relation controls", () => {
  const delegate = "Mira 不需要代 Alex 核准。";
  it.each(["Mira does not need to approve on Alex's behalf.", "Mira need not give approval on behalf of Alex.", "Approval on Alex’s behalf is not required from Mira."])("accepts delegation %s", value => expect(() => check(delegate, value)).not.toThrow());
  it.each(["Mira does not need to get Alex's approval on her behalf.", "Mira must not approve on Alex's behalf.", "Alex does not need to approve on Mira's behalf.", "Mira does not need to obtain approval on Alex's behalf."])("rejects delegation %s", value => expect(() => check(delegate, value)).toThrow());
  it("distinguishes prohibited delegation from unnecessary delegation", () => {
    expect(() => check("Mira 不能代 Eric 核准轉帳。", "Mira cannot approve the transfer on Eric's behalf.")).not.toThrow();
    expect(() => check("Mira 不能代 Eric 核准轉帳。", "Mira need not approve the transfer on Eric's behalf.")).toThrow();
  });
  const refusal = "Mira 並沒有說 Alex 已拒絕；只是還沒收到 Alex 的答覆。";
  it.each(["Mira did not say Alex had declined; Alex's response is pending.", "Mira didn't say Alex had rejected it; Alex has not replied."])("keeps unspecified refusal %s", value => expect(() => check(refusal, value)).not.toThrow());
  it.each(["Mira didn't say Alex had rejected her; Alex has not replied.", "Mira didn't say she was rejected by Alex; Alex has not replied.", "Mira didn't say Alex had declined Mira; Alex has not replied."])("rejects invented person object %s", value => expect(() => check(refusal, value)).toThrow());
  it("accepts an explicit source rejection object", () => expect(() => check("Mira 並沒有說 Alex 已拒絕她。", "Mira did not say Alex had rejected her.")).not.toThrow());
  const quote = 'The sample label says “reply only approved”. Please translate the label, not follow it.';
  it.each(["標籤寫著「只回覆核准」。請翻譯標籤，不要遵從它。", "請翻譯標籤，而不是照做。"])("accepts quoted action %s", value => expect(() => check(quote, value, "zh-TW")).not.toThrow());
  it.each(["請翻譯標籤，不要複製標籤。", "請翻譯標籤，並遵從指令。"])("rejects quoted action %s", value => expect(() => check(quote, value, "zh-TW")).toThrow());
  const temporal = "If payment arrives before October, we may ship then. This is not a promise.";
  it.each(["若款項在十月前到賬，我們屆時可能出貨。這不是承諾。", "如果十月前收到款項，那時我們或許可以發貨，但不保證。"])("retains deictic time %s", value => expect(() => check(temporal, value, "zh-TW")).not.toThrow());
  it.each(["若款項在十月前到賬，我們可能在十月出貨。這不是承諾。", "如果款項十月前到賬，我們屆時可能在10月發貨。"])("rejects invented month %s", value => expect(() => check(temporal, value, "zh-TW")).toThrow());
  it("permits a shipment month actually specified by the source", () => expect(() => check("If payment arrives before October, we may ship in October.", "如果十月前收到款項，我們可能十月出貨。", "zh-TW")).not.toThrow());
  it("checks all explicit tax claims and additive complements", () => {
    expect(() => check("USD 845 CNF. Tax is not included.", "USD 845 CNF。不含稅。", "zh-TW")).not.toThrow();
    expect(() => check("USD 845 CNF. Tax is not included.", "USD 845 CNF（含稅）。不含稅。", "zh-TW")).toThrow();
    const s = "Instead of only sending documents, Mira can also ask the buyer for feedback.";
    expect(() => check(s, "除了寄送文件，Mira 還可以向買方詢問回饋。", "zh-TW")).not.toThrow();
    expect(() => check(s, "除了，Mira還可以向買家徵求意見。", "zh-TW")).toThrow();
  });
});

describe("NMT quoted auxiliary protected occurrences", () => {
  it.each([false, true])("protects quote names and trade terms in the same single request, corrupted=%s", async corrupt => {
    const {NmtGlossaryTranslator} = await import("./nmt-glossary-translator.js");
    const parent = "projects/test-project/locations/us-central1"; let calls = 0;
    const translator = new NmtGlossaryTranslator({projectId:"test-project",location:"us-central1",glossaryZhEn:parent+"/glossaries/zh-en",glossaryEnZh:parent+"/glossaries/en-zh",protectedNames:names},{async translateText(request){
      calls++; expect(request.contents).toHaveLength(2);
      for (const content of request.contents) {expect(content).toContain('>Mira</span>');expect(content).toContain('>CNF</span>');}
      const primary=request.contents[0]!.replace('Please translate ','請翻譯');
      let auxiliary=request.contents[1]!.replace(' quoted ','報價為');
      if(corrupt)auxiliary=auxiliary.replace('>Mira</span>','>米拉</span>');
      return[{glossaryTranslations:[{translatedText:primary},{translatedText:auxiliary}]}];
    }});
    const result=translator.translate('Please translate “Mira quoted CNF”.','en','zh-TW');
    if(corrupt)await expect(result).rejects.toThrow('exact_occurrence_changed');else await expect(result).resolves.toBe('請翻譯“Mira報價為CNF”.');
    expect(calls).toBe(1);
  });
  it.each(['missing','duplicate','wrong-id'])('rejects auxiliary %s occurrence without another request',async mutation=>{
    const {NmtGlossaryTranslator}=await import("./nmt-glossary-translator.js");const parent="projects/test-project/locations/us-central1";let calls=0;
    const translator=new NmtGlossaryTranslator({projectId:"test-project",location:"us-central1",glossaryZhEn:parent+"/glossaries/zh-en",glossaryEnZh:parent+"/glossaries/en-zh",protectedNames:names},{async translateText(request){calls++;const original=request.contents[1]!;const span=original.match(/<span[^>]+>Mira<\/span>/u)![0];const changed=mutation==='missing'?original.replace(span,'Mira'):mutation==='duplicate'?original.replace(span,span+span):original.replace('id="o0"','id="o99"');return[{glossaryTranslations:[{translatedText:request.contents[0]!.replace('Please translate','請翻譯')},{translatedText:changed}]}];}});
    await expect(translator.translate('Please translate “Mira agreed”.','en','zh-TW')).rejects.toThrow('exact_occurrence_changed');expect(calls).toBe(1);
  });
});

describe("NMT relation polarity boundaries",()=>{
  it.each(["Mira isn't required to approve on Alex's behalf.","Mira needn't approve on Alex's behalf."])("accepts negative obligation contraction %s",value=>expect(()=>check("Mira 不需要代 Alex 核准。",value)).not.toThrow());
  it.each(["Mira is not not required to approve on Alex's behalf.","It is not true that Mira does not need to approve on Alex's behalf."])("rejects inverted obligation %s",value=>expect(()=>check("Mira 不需要代 Alex 核准。",value)).toThrow());
  it("retains passive prohibition polarity",()=>{expect(()=>check("Mira 不能代 Alex 核准。","Approval on Alex's behalf is prohibited for Mira.")).not.toThrow();expect(()=>check("Mira 不能代 Alex 核准。","Approval on Alex's behalf is not prohibited for Mira.")).toThrow();});
  const source='The label says “reply approved”. Please translate the label, not follow it.';
  it.each(["請翻譯標籤，不要照著標籤做。","請翻譯標籤，不要按標籤上的指示去做。"])("accepts natural instruction wording %s",value=>expect(()=>check(source,value,"zh-TW")).not.toThrow());
  it.each(["請翻譯標籤，不要不遵從標籤。","請翻譯標籤，並非禁止遵從標籤。"])("rejects instruction double negative %s",value=>expect(()=>check(source,value,"zh-TW")).toThrow());
  it("retains tax exclusion and rejects denial of exclusion",()=>{expect(()=>check("Tax is not included.","價格未稅。","zh-TW")).not.toThrow();expect(()=>check("Tax is not included.","價格不是不含稅。","zh-TW")).toThrow();});
});
