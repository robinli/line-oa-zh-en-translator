import {writeFileSync} from 'node:fs';
import {TranslationLlmTranslator} from '../lib/translation-llm-translator.js';
const parent='projects/test-project/locations/us-central1',options={projectId:'test-project',location:'us-central1',glossaryZhEn:parent+'/glossaries/zh-en',glossaryEnZh:parent+'/glossaries/en-zh'};
const span=(r,value)=>[...r.contents[0].matchAll(/<span\b[^>]*>([^<>]*)<\/span>/g)].find(m=>m[1]===value)?.[0]??value;
const div=(s,n=0)=>'<div id="p'+n+'">'+s+'</div>';
const fallback='📦 @Pico請確認14公斤小袋。\r\n\r請保留小袋方案。\n備案是560公斤 FIBC 大袋。';
const fallbackBody=(r,bad)=>div('📦 '+span(r,'@Pico')+' please confirm '+span(r,'14公斤').replace('14公斤','14kg')+' small bags.')+div('',1)+div('Please keep the small-bag plan.',2)+div((bad?'The registered specification is ':'The fallback is ')+span(r,'560公斤').replace('560公斤','560kg')+' FIBC bulk bags.',3);
const cases=[
{id:'F01-original-good',source:fallback,zh:true,ranges:[{start:3,length:5}],expected:'output',body:r=>fallbackBody(r,false)},
{id:'F01-original-bad',source:fallback,zh:true,ranges:[{start:3,length:5}],expected:'rejected',body:r=>fallbackBody(r,true)},
{id:'F01-good-second-attempt',source:fallback,zh:true,ranges:[{start:3,length:5}],expected:'output',forceRetry:true,body:r=>fallbackBody(r,false)},
...['carton','bag'].flatMap((unit,i)=>[
{id:'denominator-'+unit+'-slash-good',source:'The charge is USD 9.50/'+unit+'.',expected:'output',body:r=>div('費用為'+span(r,'USD 9.50')+'/'+(i?'袋':'紙箱')+'。')},
{id:'denominator-'+unit+'-natural-good',source:'The charge is USD 9.50/'+unit+'.',expected:'output',body:r=>div('費用為每'+(i?'袋':'紙箱')+span(r,'USD 9.50')+'。')},
{id:'denominator-'+unit+'-natural-bad',source:'The charge is USD 9.50/'+unit+'.',expected:'rejected',body:r=>div('費用為每'+(i?'紙箱':'袋')+span(r,'USD 9.50')+'。')},
{id:'denominator-'+unit+'-slash-bad',source:'The charge is USD 9.50/'+unit+'.',expected:'rejected',body:r=>div('費用為'+span(r,'USD 9.50')+'/'+(i?'紙箱':'袋')+'。')}
])];
const results=[];for(const c of cases){const r={id:c.id,source:c.source,expected:c.expected,attempts:[],metrics:[]};const client={async translateText(req,contract){const output=c.forceRetry&&r.attempts.length===0?'<div id="p99">invalid</div>':c.body(req);r.attempts.push({request:req,contract,output});return[{glossaryTranslations:[{translatedText:output}]}];}};try{Object.assign(r,await new TranslationLlmTranslator({...options,onMetric:m=>r.metrics.push(m)},client).translateWithRanges(c.source,c.zh?'zh-TW':'en',c.zh?'en':'zh-TW',{protectedRanges:c.ranges??[]}));r.status='output';}catch(e){r.status='rejected';r.reason=e.reason;}r.passed=r.expected===r.status;results.push(r);console.log(JSON.stringify({id:r.id,status:r.status,reason:r.reason,text:r.text,passed:r.passed,calls:r.attempts.length}));}
writeFileSync(new URL('../../.local/tllm-context-quantity-verifier-v11/repair-controls-independent.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),syntheticOnly:true,results},null,2).replace(/\n/g,'\r\n')+'\r\n');
