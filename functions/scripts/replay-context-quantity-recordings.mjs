// Offline diagnostic replay of historical synthetic responses, never fresh API evidence.
import {readFileSync,writeFileSync} from 'node:fs';
import {TranslationLlmTranslator,TRANSLATION_LLM_ADAPTER_VERSION} from '../lib/translation-llm-translator.js';
const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const old=read('functions/evaluation/tllm-context-quantity-review.json');
const options=read('.local/tllm-context-quantity/regression-2026-09-24T05-19-08-739Z.json').options;
const rebind=process.argv.includes('--rebind-wire');
const wirePattern=/(@|Quantity|Value|Formula|CODE-|mail|https:\/\/|[A-Za-z]+_)([A-Z]{3})([A-Z]{3})QX/g;
const results=[];
for(const original of old.results){
 const metrics=[];let calls=0;
 let unaligned=false;
 const client={async translateText(request){const call=original.attempts[Math.min(calls++,original.attempts.length-1)];if(!call?.response)throw Error('Missing recorded response');
 if(!rebind)return[call.response];
 const current=new Map(request.contents.flatMap(text=>[...text.matchAll(wirePattern)].map(m=>[m[1]+m[3],m[0]])));
 const replace=text=>text.replace(wirePattern,(full,kind,nonce,id)=>current.get(kind+id)??full);
 if(JSON.stringify(call.request.contents.map(replace))!==JSON.stringify(request.contents)){unaligned=true;throw Error('Replay wire shape differs');}
 const response=JSON.parse(JSON.stringify(call.response));for(const branch of ['translations','glossaryTranslations'])for(const entry of response[branch]??[])if(entry.translatedText)entry.translatedText=replace(entry.translatedText);
 return[response];}};
 const r={id:original.id,set:original.set,round:original.round,source:original.source,oldStatus:original.status,oldText:original.text,metrics};
 const ranges=(original.mentions??[]).map(m=>{let start=m.start??-1;if(m.start===undefined)for(let i=0;i<=m.occurrence;i++)start=original.source.indexOf(m.text,start+1);return{start,length:m.text.length};});
 try{Object.assign(r,await new TranslationLlmTranslator({...options,onMetric:m=>metrics.push(m)},client).translateWithRanges(original.source,original.sourceLanguage,original.targetLanguage,{protectedRanges:ranges}));r.status='output';}catch(e){r.status='rejected';r.reason=e.reason??e.name;}r.calls=calls;r.unaligned=unaligned;results.push(r);
}
const output={adapterVersion:TRANSLATION_LLM_ADAPTER_VERSION,syntheticOnly:true,offlineOnly:true,wireRewritten:rebind,randomNonceOnly:rebind,sourceEvidence:'functions/evaluation/tllm-context-quantity-review.json',results};
const path=new URL('.local/tllm-context-quantity-repairs/replay-'+TRANSLATION_LLM_ADAPTER_VERSION+(rebind?'-rebound':'')+'.json',root);writeFileSync(path,JSON.stringify(output,null,2).replace(/\n/g,'\r\n')+'\r\n');
console.log(JSON.stringify({total:results.length,newRejected:results.filter(r=>r.oldStatus==='output'&&r.status!=='output').map(r=>({id:r.id,round:r.round,source:r.source,reason:r.reason,firstReason:r.metrics[0]?.reason,unaligned:r.unaligned,oldText:r.oldText})),oldRejectNowOutput:results.filter(r=>r.oldStatus!=='output'&&r.status==='output').map(r=>r.id)}));
