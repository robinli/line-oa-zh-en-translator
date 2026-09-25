import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TranslationLlmTranslator,TRANSLATION_LLM_ADAPTER_VERSION} from '../lib/translation-llm-translator.js';
const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const old=read('functions/evaluation/tllm-context-quantity-repair-review.json');
const independent=read('functions/evaluation/context-quantity-independent-reverification-v11.json');
const api=[...old.results,...old.targetedDiagnostics,...independent.fresh.results];
const injections=[...independent.injections.results,...independent.independentRepairControls.results];
const options=read('.local/tllm-context-quantity/regression-2026-09-24T05-38-03-842Z.json').options;
const wirePattern=/(@|Quantity|Value|Formula|CODE-|mail|https:\/\/|[A-Za-z]+_)([A-Z]{3})([A-Z]{3})QX/g;
const results=[];
for(const [kind,rows] of [['recorded-api',api],['public-injection',injections]])for(const original of rows){
 const metrics=[];let calls=0,unaligned=false;
 const client={async translateText(request){const call=original.attempts[Math.min(calls++,original.attempts.length-1)];if(!call)throw Error('Missing recorded attempt');
 const current=new Map(request.contents.flatMap(text=>[...text.matchAll(wirePattern)].map(m=>[m[1]+m[3],m[0]])));
 const replace=text=>text.replace(wirePattern,(full,kind,nonce,id)=>current.get(kind+id)??full);
 if(JSON.stringify(call.request.contents.map(replace))!==JSON.stringify(request.contents)){unaligned=true;throw Error('Replay wire shape differs');}
 const response=call.response?JSON.parse(JSON.stringify(call.response)):{glossaryTranslations:[{translatedText:call.output}]};
 for(const branch of ['translations','glossaryTranslations'])for(const entry of response[branch]??[])if(entry.translatedText)entry.translatedText=replace(entry.translatedText);
 return[response];}};
 const source=original.source;
 const ranges=(original.mentions??[]).map(m=>{let start=m.start??-1;if(m.start===undefined)for(let i=0;i<=m.occurrence;i++)start=source.indexOf(m.text,start+1);return{start,length:m.text.length};});
 // Public recorded spans identify the original synthetic native occurrence ranges.
 if(kind==='public-injection')for(const m of original.attempts[0]?.request.contents[0].matchAll(/<span\b[^>]*>(@[^<>]+)<\/span>/g)??[]){
   const value=m[1].replaceAll('&amp;','&');let start=source.indexOf(value);while(ranges.some(r=>r.start===start))start=source.indexOf(value,start+1);if(start>=0)ranges.push({start,length:value.length});
 }
 const first=original.attempts[0]?.request;
 const localOptions=kind==='public-injection'?{...options,projectId:'test-project',glossaryZhEn:'projects/test-project/locations/us-central1/glossaries/zh-en',glossaryEnZh:'projects/test-project/locations/us-central1/glossaries/en-zh'}:options;
 const expected=kind==='public-injection'?original.expected:original.id==='cqv11f05'?'output':original.status;
 const r={kind,id:original.id,set:original.set,round:original.round,source,oldStatus:original.status,oldText:original.text,expected,metrics};
 try{Object.assign(r,await new TranslationLlmTranslator({...localOptions,onMetric:m=>metrics.push(m)},client).translateWithRanges(source,original.sourceLanguage??first?.sourceLanguageCode,original.targetLanguage??first?.targetLanguageCode,{protectedRanges:ranges}));r.status='output';}catch(e){r.status='rejected';r.reason=e.reason??e.name;}
 r.calls=calls;r.unaligned=unaligned;r.passed=r.status===expected&&!unaligned;results.push(r);
}
const output={at:new Date().toISOString(),adapterVersion:TRANSLATION_LLM_ADAPTER_VERSION,syntheticOnly:true,offlineOnly:true,randomNonceOnly:true,wholeRequestContentsRequired:true,sourceEvidence:['functions/evaluation/tllm-context-quantity-repair-review.json','functions/evaluation/context-quantity-independent-reverification-v11.json'].map(file=>({file,sha256:createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex')})),results};
const dir=new URL('.local/tllm-context-quantity-f07/',root);mkdirSync(dir,{recursive:true});
writeFileSync(new URL('replay-'+TRANSLATION_LLM_ADAPTER_VERSION+'.json',dir),JSON.stringify(output,null,2).replace(/\n/g,'\r\n')+'\r\n');
console.log(JSON.stringify({total:results.length,api:api.length,injections:injections.length,failures:results.filter(r=>!r.passed)}));
if(results.some(r=>!r.passed))process.exitCode=1;
