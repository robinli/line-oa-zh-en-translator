import {it,expect,vi} from "vitest";
import {NmtGlossaryTranslator,type NmtGlossaryRequest} from "./nmt-glossary-translator.js";
const parent="projects/test-project/locations/us-central1";
const options={projectId:"test-project",location:"us-central1",glossaryZhEn:parent+"/glossaries/zh-en",glossaryEnZh:parent+"/glossaries/en-zh"};
const translate=async(source:string,output:string)=>{const call=vi.fn(async(request:NmtGlossaryRequest)=>{const spans=[...request.contents[0]!.matchAll(/<span(?: class="notranslate")? translate="no" id="o\d+">([^<>]+)<\/span>/gu)];const byValue=new Map(spans.map(m=>[m[1]!,m[0]]));const marked=output.replace(/\b[A-Za-z]+\b/gu,value=>byValue.get(value)??value);return [{glossaryTranslations:[{translatedText:'<div id="p0">'+marked+'</div>'}]}] as [{glossaryTranslations:Array<{translatedText:string}>}];});try{return await new NmtGlossaryTranslator(options,{translateText:call}).translate(source,'en','zh-TW');}finally{expect(call).toHaveBeenCalledTimes(1);}};
it.each([
 ['Do not convert the units; do not convert the currency.','不要換算單位；請換算貨幣。'],
 ['Do not convert the units; do not convert the currency.','請換算單位；不要換算貨幣。'],
 ['Do not convert the units; do not convert the currency.','不要換算單位；無需換算貨幣。'],
 ['Do not convert the units; do not convert the currency.','不要換算單位；不是禁止換算貨幣。'],
 ["Don't convert the units and don't convert the currency.",'不要換算單位。'],
 ['Do not calculate the number of bags; do not calculate the formula.','不要計算袋數；請計算公式。'],
])('F04 rejects a changed or missing repeated prohibition: %s',async(source,output)=>{await expect(translate(source,output)).rejects.toThrow('action_restriction_weakened');});
it.each([
 ['Do not convert the units; do not convert the currency.','不要換算單位；不要換算貨幣。'],
 ['Do not convert the units; do not convert the currency.','禁止換算貨幣；不得轉換單位。'],
 ['Do not convert the units; do not convert the currency.','不得換算單位或貨幣。'],
 ["Don't convert the units and don't convert the currency.",'不要換算貨幣；請勿換算單位。'],
 ['Do not convert the units; you do not need to convert the currency.','不要換算單位；無需換算貨幣。'],
 ['Do not calculate the number of bags; do not calculate the formula.','不要計算公式；不要計算袋數。'],
])('F04 accepts correct reordered restrictions and unrelated optional clauses: %s',async(source,output)=>{await expect(translate(source,output)).resolves.toBe(output);});
const two='Use red bags only if the buyer rejects blue bags; use green bags only if the buyer rejects yellow bags.';
it.each([
 [two,'只有買方拒絕藍袋才使用紅袋；只有買方不拒絕黃袋才使用綠袋。'],
 [two,'只有買方拒絕藍袋才使用紅袋。'],
 [two,'只有買方拒絕黃袋才使用紅袋；只有買方拒絕藍袋才使用綠袋。'],
 ['Use red bags only if the buyer rejects blue bags.','只有買方拒絕紅袋才使用藍袋。'],
 ['Use red bags only if the buyer rejects blue bags.','只有賣方拒絕藍袋才使用紅袋。'],
 ['Use red bags only if the buyer does not reject blue bags.','只有買方拒絕藍袋才使用紅袋。'],
])('F05 rejects condition, role or selected/rejected object swap: %s',async(source,output)=>{await expect(translate(source,output)).rejects.toThrow('packaging_condition_changed');});
it.each([
 [two,'只有買方拒絕藍袋才使用紅袋；只有買方拒絕黃袋才使用綠袋。'],
 [two,'只有買方拒收黃袋才使用綠袋；唯有買方不接受藍袋才使用紅袋。'],
 ['Use red bags only if the buyer does not reject blue bags.','只有買方不拒絕藍袋才使用紅袋。'],
 ['Only if the buyer rejects blue bags, use red bags.','只有買方拒絕藍袋才使用紅袋。'],
 ['Use red bags only if the buyer rejects blue bags.','使用紅袋，僅當買方拒絕藍袋。'],
])('F05 accepts intact condition relationships and order variations: %s',async(source,output)=>{await expect(translate(source,output)).resolves.toBe(output);});
it.each(['Kumaran會請Kumar檢查包裝。','Kumar會檢查Kumaran的包裝。','Kumaran將應Kumar以外的要求檢查包裝。'])('F06 rejects requester/requestee reversal or loss: %s',async output=>{await expect(translate('Kumar will ask Kumaran to check the packaging.',output)).rejects.toThrow('actor_role_changed');});
it.each(['Kumar會請Kumaran檢查包裝。','Kumar將要求Kumaran核對包裝。','Kumaran將應Kumar的要求檢查包裝。'])('F06 accepts bounded active/passive equivalents: %s',async output=>{await expect(translate('Kumar will ask Kumaran to check the packaging.',output)).resolves.toBe(output);});
it('F06 matches every named request, including reordered correct clauses',async()=>{
 const source='Kumar will ask Kumaran to check the packaging; Eric will ask Wei to check the bags.';
 await expect(translate(source,'Eric會請Wei檢查袋子；Kumar會請Kumaran檢查包裝。')).resolves.toBe('Eric會請Wei檢查袋子；Kumar會請Kumaran檢查包裝。');
 await expect(translate(source,'Wei會請Eric檢查袋子；Kumar會請Kumaran檢查包裝。')).rejects.toThrow('actor_role_changed');
});

it.each([
 ['Mira can ask Kumar to verify the details.','Mira 可以請 Kumar 進行查核。'],
 ['Mira can ask Alex to review the quotation.','Mira 可以請 Alex 審核報價。'],
 ['Alex can ask Mira to review this proposal.','Alex 可以請 Mira 審閱這項提案。'],
])('F06 retains natural request wording with current occurrence spans: %s',async(source,output)=>{await expect(translate(source,output)).resolves.toBe(output);});

it.each([
 '不要換算單位；也別換算貨幣。',
 '別換算單位；請別換算貨幣。',
 '請別換算單位；千萬別換算貨幣。',
 '單位和幣別都不要換算。',
 '單位和貨幣都別換算。',
])('F04 accepts natural imperative 別 and shared-object prohibition: %s',async output=>{await expect(translate('Do not convert the units; do not convert the currency.',output)).resolves.toBe(output);});
it.each([
 '不要換算單位；也請換算貨幣。',
 '不要換算單位；也不必換算貨幣。',
 '不要換算單位；不是要你也別換算貨幣。',
 '不要換算單位；並非叫你別換算貨幣。',
 '不要換算單位；請特別換算貨幣。',
 '不要換算單位；請分別換算貨幣。',
])('F04 does not interpret affirmative/no-obligation/denied or lexical 別 as prohibition: %s',async output=>{await expect(translate('Do not convert the units; do not convert the currency.',output)).rejects.toThrow('action_restriction_weakened');});
