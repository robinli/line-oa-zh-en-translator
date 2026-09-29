import {describe, expect, it, vi} from "vitest";
import {findLiteralCodeRanges} from "./literal-codes.js";
import {prepareLlmContext} from "./nmt-context.js";
import {createContextLlmHtml} from "./nmt-context-html.js";
import {prepareLlmContext as prepareLegacy} from "./translation-llm-context.js";
import {createContextLlmHtml as legacyHtml} from "./translation-llm-context-html.js";
import {NmtGlossaryTranslator, type NmtGlossaryRequest} from "./nmt-glossary-translator.js";
import {TranslationLlmTranslator} from "./translation-llm-translator.js";
import {VietnameseNmtTranslator} from "./vietnamese-nmt-translator.js";
import {DEFAULT_PROTECTED_NAMES, restoreTradeTranslationWithRanges} from "./trade-policy.js";

const values = (text: string) => findLiteralCodeRanges(text).map(range => text.slice(range.start, range.start + range.length));
describe("user literal code rule", () => {
  it.each(["-", "/", "$", "%", "*", "+", "=", ".", "~", "^", "!"])("preserves internal %s in mixed-case codes", symbol => {
    expect(values("請確認 aB" + symbol + "cD。 Hello!" )).toEqual(["aB" + symbol + "cD"]);
  });
  it.each(["PP-BK", "abc/def", "A+B=C", "28/09/26", "30%", "$50", "-50", "1.25", "C++", "３０％", "ＡＢ／ＣＤ"])("finds %s without consuming sentence punctuation", code => {
    expect(values("Please check " + code + ". Hello!")).toEqual([code]);
  });
  it.each(["Hello!", "Follow up.", "Mr. Shan", "CHECK WIRE", "123", "- / $ % * + = . ~ ^ !", "A + B"])("does not classify %s as a code", text => {
    expect(values(text)).toEqual([]);
  });
});

describe.each([
  ["NMT", prepareLlmContext, createContextLlmHtml],
  ["retained LLM", prepareLegacy, legacyHtml],
] as const)("%s exact protection", (_name, prepare, createHtml) => {
  it("protects code/date/percentage inside translated prose and preserves native mention offsets", () => {
    const text = "😀 @甲-乙 Please check PP-BK, 28/09/26 and 30%. Hello!";
    const mention = {start: text.indexOf("@"), length: 4};
    const p = prepare(text, DEFAULT_PROTECTED_NAMES, [mention], "zh-TW");
    const adapter = createHtml(p);
    let wire = adapter.encode();
    for (const value of ["PP-BK", "28/09/26", "30%"]) expect(wire).toContain('>' + value + '</span>');
    expect(wire).toContain('Please check');
    expect(wire).toContain('Hello!');
    wire = wire.replace('Please check', '請確認').replace(' and ', ' 和 ').replace('Hello!', '你好！');
    const decoded = adapter.decode(wire);
    const result = restoreTradeTranslationWithRanges(decoded.restoration, decoded.masked);
    expect(result.text).toBe("😀 @甲-乙 請確認 PP-BK, 28/09/26 和 30%. 你好！");
    expect(result.ranges).toEqual([{sourceStart: mention.start, start: result.text.indexOf('@'), length: mention.length}]);
  });
  it.each(["PP-BK", "28/09/26", "30%"])("rejects changed, missing and duplicate %s", value => {
    const adapter = createHtml(prepare("Please check " + value + ".", [], [], "zh-TW"));
    const encoded = adapter.encode();
    const span = encoded.match(/<span\b[^>]*>[^<]*<\/span>/u)![0];
    for (const corrupted of [encoded.replace(value, 'CHANGED'), encoded.replace(span, ''), encoded.replace(span, span + span)]) {
      expect(() => adapter.decode(corrupted)).toThrow();
    }
  });
  it.each(["AB-CD", "28/09/26"])("rejects %s moved to another paragraph", value => {
    const adapter = createHtml(prepare("Check " + value + ".\nCheck ZZ-AA.", [], [], "zh-TW"));
    const valid = adapter.encode().replaceAll("Check", "確認");
    expect(() => adapter.decode(valid)).not.toThrow();
    const spans = [...valid.matchAll(/<span\b[^>]*>[^<]*<\/span>/gu)].map(match => match[0]);
    const swapped = valid.replace(spans[0]!, "SWAP").replace(spans[1]!, spans[0]!).replace("SWAP", spans[1]!);
    expect(() => adapter.decode(swapped)).toThrow("quantity_paragraph_changed");
  });
  it.each(["袋", "bag-XL", "袋-XL", "袋 XL-A"])("masks every exact denomination segment for language validation: %s", denomination => {
    const adapter = createHtml(prepare("保持原樣 USD 8 / " + denomination + "。", [], [], "en"));
    const valid = adapter.encode().replace("保持原樣", "Keep").replace("。", ".");
    const decoded = adapter.decode(valid);
    expect(decoded.masked).not.toMatch(/\p{Script=Han}/u);
    expect(restoreTradeTranslationWithRanges(decoded.restoration, decoded.masked).text).toBe("Keep USD 8 / " + denomination + ".");
    expect(() => adapter.decode(valid.replace("USD 8", "USD 9"))).toThrow();
    if (denomination.includes("袋")) expect(() => adapter.decode(valid.replace("袋", "箱"))).toThrow("price_denominator_changed");
  });
  it.each(["USD 8/carton", "$9.50/bag", "USD 8/crate-pack", "USD 8/crate pack"])("keeps the literal part of a financial rate and validates the remaining denomination: %s", source => {
    const prepared = prepare("Please check " + source + ".", [], [], "zh-TW");
    const adapter = createHtml(prepared);
    const encoded = adapter.encode();
    expect(encoded).toContain('<span');
    expect(encoded).toContain(source === "USD 8/crate pack" ? '>USD 8/crate</span> pack' : '>' + source + '</span>');
    const decoded = adapter.decode(encoded.replace('Please check','請確認'));
    expect(restoreTradeTranslationWithRanges(decoded.restoration,decoded.masked).text).toBe('請確認 ' + source + '.');
    expect(() => adapter.decode(encoded.replace('8','9').replace('9.50','10.50'))).toThrow();
    if (source.endsWith(' pack')) expect(() => adapter.decode(encoded.replace(' pack',' load'))).toThrow('price_denominator_changed');
  });
  it("keeps an already exact compound denominator through explicit copy-exact restoration", () => {
    const prepared = prepare("Copy exactly USD 8 / bag-XL.", [], [], "zh-TW");
    const adapter = createHtml(prepared);
    const decoded = adapter.decode(adapter.encode().replace('Copy exactly','原樣保留'));
    expect(restoreTradeTranslationWithRanges(decoded.restoration,decoded.masked).text).toBe('原樣保留 USD 8 / bag-XL.');
  });
  it("retains quantity metadata and translatable Chinese units alongside decimal values", () => {
    const p = prepare("報價 $9.50/carton，淨重 2.5 公斤。", [], [], "en");
    const price = p.occurrences.find(item => item.value === '$9.50/carton')!;
    expect(price).toMatchObject({kind:'quantity', number:'9.50', currency:'$', denominator:'carton', literal:true});
    expect(p.occurrences.find(item => item.value === '2.5 公斤')).toMatchObject({kind:'quantity', unitGroup:'kg', number:'2.5'});
    expect(createHtml(p).encode()).toContain('2.5 公斤');
  });
});

const parent = 'projects/test-project/locations/us-central1';
const options = {projectId:'test-project',location:'us-central1',glossaryZhEn:parent+'/glossaries/zh-en',glossaryEnZh:parent+'/glossaries/en-zh'};
it("NMT translates the action-plan structure with an exact date and percentage using a fake client", async () => {
  const source = "28/09/26 – Action Plan\r\n\r\nPlease check PP-BK.\r\nFollow up on 30% payment.\r\nHello!";
  const translateText = vi.fn(async (request: NmtGlossaryRequest) => {
    expect(request.contents[0]).toMatch(/<span[^>]+>28\/09\/26<\/span>/u);
    const output = request.contents[0]!.replace('Action Plan','行動計畫').replace('Please check','請確認')
      .replace('Follow up on','追蹤').replace(' payment.',' 的款項。').replace('Hello!','你好！');
    return [{glossaryTranslations:[{translatedText:output}]}] as [{glossaryTranslations:Array<{translatedText:string}>}];
  });
  const result = await new NmtGlossaryTranslator(options,{translateText}).translate(source,'en','zh-TW');
  expect(result).toBe("28/09/26 – 行動計畫\r\n\r\n請確認 PP-BK.\r\n追蹤 30% 的款項。\r\n你好！");
  expect(translateText).toHaveBeenCalledOnce();
});
it("does not call NMT when only protected codes remain", async () => {
  const translateText = vi.fn();
  expect(await new NmtGlossaryTranslator(options,{translateText}).translate('PP-BK 28/09/26 30%','en','zh-TW')).toBe('PP-BK 28/09/26 30%');
  expect(translateText).not.toHaveBeenCalled();
});
it.each([NmtGlossaryTranslator, TranslationLlmTranslator])("%s validates copy-exact mixed denominations and multiple prices through the complete fake-client path", async Translator => {
  const source = "保持原樣 USD 8 / 袋-XL；USD 9 / 袋 XL-A。";
  const translateText = vi.fn(async (request: NmtGlossaryRequest) => [{glossaryTranslations: request.contents.map(html => ({translatedText: html.replace("保持原樣", "Keep").replace("；", ";").replace("。", ".")}))}] as [{glossaryTranslations: Array<{translatedText: string}>}]);
  expect(await new Translator(options, {translateText}).translate(source, "zh-TW", "en")).toBe("Keep USD 8 / 袋-XL;USD 9 / 袋 XL-A.");
});
it("Vietnamese mode preserves literal codes without creating mention identities", async () => {
  const translateText = vi.fn(async ({contents}: {contents:string[]}) => [{translations:contents.map(html=>({translatedText:html.replace('請確認','Vui lòng kiểm tra')}))}] as [{translations:Array<{translatedText:string}>}]);
  const source = '😀 @甲-乙 請確認 PP-BK 28/09/26 30%。';
  const translator = new VietnameseNmtTranslator('test-project',{translateText});
  const result = await translator.translateWithRanges(source,'zh-TW','vi',{protectedRanges:[{start:3,length:4}]});
  expect(result.text).toBe('😀 @甲-乙 Vui lòng kiểm tra PP-BK 28/09/26 30%。');
  expect(result.ranges).toEqual([{sourceStart:3,start:3,length:4}]);
  expect(translateText.mock.calls[0]![0].contents[0]).toContain('>28/09/26</span>');
});
it.each(['changed','missing','duplicate'])("Vietnamese mode rejects %s literal content", async corruption => {
  const translateText = vi.fn(async ({contents}: {contents:string[]}) => {
    let output = contents[0]!.replace('請確認','Kiểm tra');
    const span = output.match(/<span\b[^>]*>[^<]*<\/span>/u)![0];
    output = corruption === 'changed' ? output.replace('PP-BK','PP-BL') : output.replace(span,corruption === 'missing' ? '' : span+span);
    return [{translations:[{translatedText:output}]}] as [{translations:Array<{translatedText:string}>}];
  });
  await expect(new VietnameseNmtTranslator('test-project',{translateText}).translate('請確認 PP-BK','zh-TW','vi')).rejects.toThrow();
});
it.each(["AB-CD", "28/09/26"])("Vietnamese mode rejects %s moved between response paragraphs", async value => {
  const translateText = vi.fn(async ({contents}: {contents:string[]}) => {
    const output = contents.map(html => html.replace("確認", "Check"));
    const spans = output.map(html => html.match(/<span\b[^>]*>[^<]*<\/span>/u)![0]);
    return [{translations: output.map((html, index) => ({translatedText: html.replace(spans[index]!, spans[1 - index]!)}))}] as [{translations: Array<{translatedText: string}>}];
  });
  await expect(new VietnameseNmtTranslator("test-project", {translateText}).translate("確認 " + value + "。\n確認 ZZ-AA。", "zh-TW", "vi")).rejects.toThrow();
});
