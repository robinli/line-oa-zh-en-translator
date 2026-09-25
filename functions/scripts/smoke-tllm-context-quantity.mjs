import "./nmt-legacy-guard.mjs";
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareLlmContext} from '../lib/translation-llm-context.js';
import {createContextLlmHtml} from '../lib/translation-llm-context-html.js';
import {restoreTradeTranslationWithRanges} from '../lib/trade-policy.js';
const all=JSON.parse(readFileSync(new URL('../evaluation/synthetic-direct-comparison-cases.json',import.meta.url),'utf8'));
const business=process.argv.includes('--business');
const samples=business?[...JSON.parse(readFileSync(new URL('../evaluation/synthetic-trade-cases.json',import.meta.url),'utf8')), ...all]:all;
const businessIds=['price-inclusion','negated-commission','best-price-not-floor','name-and-party','numeric-fidelity','pack-rough-packaging','pack-zh-packaging','literal-entities'];
const cases=business?samples.filter(c=>businessIds.includes(c.id)&&c.sourceLanguage!=='vi'&&c.targetLanguage!=='vi').filter((c,i,a)=>a.findIndex(t=>t.id===c.id)===i):all.filter(c=>['pack-rough-packaging','pack-split-paragraphs','pack-zh-packaging','same-name-mentions','literal-entities','pack-decimal-units','pack-net-gross'].includes(c.id));
if(cases.length>8)throw Error('Smoke limit');
const project=process.env.GOOGLE_CLOUD_PROJECT,token=process.env.TRADE_EVAL_TOKEN;
if(!token||!project)throw Error('Temporary credentials required');
const parent=`projects/${project}/locations/us-central1`,results=[];
for(const sample of cases){
 const ranges=(sample.mentions??[]).map(m=>{let start=-1;for(let i=0;i<=m.occurrence;i++)start=sample.source.indexOf(m.text,start+1);return{start,length:m.text.length};});
 const p=prepareLlmContext(sample.source,['Alex','Mira','Wei','Shan','Eric','Kash','Kumar','Kumaran','Niranjan'],ranges,sample.targetLanguage),wire=createContextLlmHtml(p,process.argv.includes('--mask-names'));
 const req={contents:[wire.encode()],mimeType:'text/html',model:parent+'/models/general/translation-llm',sourceLanguageCode:sample.sourceLanguage,targetLanguageCode:sample.targetLanguage,glossaryConfig:{glossary:parent+'/glossaries/trade-'+(sample.sourceLanguage==='en'?'en-zh':'zh-en')+'-v8',ignoreCase:false,contextualTranslationEnabled:false}};
 const r={id:sample.id,source:sample.source,request:req};
 try{const response=await fetch('https://translation.googleapis.com/v3/'+parent+':translateText',{method:'POST',headers:{'content-type':'application/json','x-goog-user-project':project,Authorization:'Bearer '+token},body:JSON.stringify(req),signal:AbortSignal.timeout(15000)});r.http=response.status;if(!response.ok)throw Error('http_'+response.status);r.response=await response.json();const decoded=wire.decode(r.response.glossaryTranslations[0].translatedText);r.result=restoreTradeTranslationWithRanges(decoded.restoration,decoded.masked);r.status='output';}catch(e){r.status='rejected';r.reason=e.reason??e.message;}results.push(r);console.log(JSON.stringify({id:r.id,status:r.status,reason:r.reason,text:r.result?.text}));
}
const dir=new URL('../../.local/tllm-context-quantity/',import.meta.url);mkdirSync(dir,{recursive:true});
const file=new URL('smoke-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',dir);
const sha=x=>createHash('sha256').update(x).digest('hex');
const hashes=Object.fromEntries(['translation-llm-context','translation-llm-context-html'].map(n=>[n,{source:sha(readFileSync(new URL('../src/'+n+'.ts',import.meta.url))),compiled:sha(readFileSync(new URL('../lib/'+n+'.js',import.meta.url)))}]));
writeFileSync(file,JSON.stringify({syntheticOnly:true,nodeVersion:process.version,hashes,results},null,2).replace(/\n/g,'\r\n')+'\r\n');console.log(file.pathname);
