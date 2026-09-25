import "./nmt-legacy-guard.mjs";
// Fixed synthetic regression only; no LINE clients, production settings or deployment.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TranslationLlmTranslator,TRANSLATION_LLM_ADAPTER_VERSION} from '../lib/translation-llm-translator.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const files=['synthetic-trade-cases.json','synthetic-alternative-cases.json','synthetic-tllm-holdout.json','synthetic-tllm-v2-holdout.json','synthetic-tllm-v4-holdout.json','synthetic-tllm-v6-holdout.json','synthetic-tllm-v8-holdout.json','synthetic-tllm-v9-regression.json','synthetic-tllm-v10-holdout.json','synthetic-tllm-v11-holdout.json','synthetic-tllm-v12-holdout.json'];
const locks=JSON.parse(readFileSync(new URL('../evaluation/context-quantity-dataset-lock.json',import.meta.url),'utf8'));
locks.push({file:'synthetic-context-quantity-verifier-holdout.json',sha256:'8554f3bd491706f8f11af74b6574ee2c1c30c6cf044478064edd75663a6d83bd'}, {file:'synthetic-context-quantity-repair-controls.json',sha256:'d762c4257d270dd805fde0d7e9398a6277296c0dac39410c3595688e7caba9e9'});
locks.push({file:'synthetic-context-quantity-verifier-fresh-v11.json',sha256:'38d27bae3694abdaa0698d9191009aa267908478f534c4f7dd8535bd6e628fa4'});
const datasetHashes={},cases=[];
function load(name,set,rounds){const bytes=readFileSync(new URL('../evaluation/'+name,import.meta.url));const hash=sha(bytes);if(locks.find(l=>l.file===name)?.sha256!==hash)throw Error('Dataset changed: '+name);datasetHashes[name]=hash;for(const c of JSON.parse(bytes))if(c.sourceLanguage!=='vi'&&c.targetLanguage!=='vi')cases.push({...c,set,rounds});}
for(const file of files)load(file,'regression',1);
if(cases.length!==280)throw Error('Expected 280 regression cases');
load('synthetic-direct-comparison-cases.json','comparison',3);
load('synthetic-tllm-v13-holdout.json','v13',3);
if(process.argv.includes('--include-verifier')) load('synthetic-context-quantity-verifier-holdout.json','verifier-regression',3);
if(process.argv.includes('--include-controls')) load('synthetic-context-quantity-repair-controls.json','repair-controls',3);
if(process.argv.includes('--include-v11-fresh')) load('synthetic-context-quantity-verifier-fresh-v11.json','verifier-v11-regression',3);
const filter=process.argv.find(x=>x.startsWith('--set='))?.slice(6);
const only=process.argv.find(x=>x.startsWith('--ids='))?.slice(6).split(',');
const selected=cases.filter(c=>(!filter||c.set===filter)&&(!only||only.includes(c.id)));
const sources=['translation-llm-translator','translation-llm-context','translation-llm-context-html','translation-llm-context-meaning','translation-llm-protection','translation-llm-subjects','trade-policy'];
const hashes=Object.fromEntries(sources.map(n=>[n,{source:sha(readFileSync(new URL('../src/'+n+'.ts',import.meta.url))),compiled:sha(readFileSync(new URL('../lib/'+n+'.js',import.meta.url)))}]));
const resumePath=process.argv.find(x=>x.startsWith('--resume='))?.slice(9);
const resume=resumePath?JSON.parse(readFileSync(resumePath,'utf8')):undefined;
if(resume&&(JSON.stringify(resume.hashes)!==JSON.stringify(hashes)||JSON.stringify(resume.datasetHashes)!==JSON.stringify(datasetHashes)))throw Error('Resume candidate/dataset mismatch');
const key=(sample,round)=>sample.set+':'+sample.id+':'+round;
const completed=new Set((resume?.results??[]).filter(r=>r.status!=='service_error').map(r=>key(r,r.round)));
const jobs=selected.flatMap(c=>Array.from({length:c.rounds},(_,i)=>({sample:c,round:i+1}))).filter(j=>!completed.has(key(j.sample,j.round)));
const resumedFrom=resumePath?{file:resumePath,sha256:sha(readFileSync(resumePath)),retainedResults:completed.size}:undefined;
if(process.argv.includes('--dry-run')){console.log(JSON.stringify({adapterVersion:TRANSLATION_LLM_ADAPTER_VERSION,cases:selected.length,results:jobs.length,datasetHashes,hashes}));process.exit(0);}
const project=process.env.GOOGLE_CLOUD_PROJECT,token=process.env.TRADE_EVAL_TOKEN;if(!project||!token)throw Error('Temporary credentials required');
const parent=`projects/${project}/locations/us-central1`,options={projectId:project,location:'us-central1',glossaryZhEn:parent+'/glossaries/trade-zh-en-v8',glossaryEnZh:parent+'/glossaries/trade-en-zh-v8',protectedNames:['Alex','Mira','Wei','Kumar','Kumaran','Shan','Niranjan','Eric','Kash']};
const directory=new URL('../../.local/tllm-context-quantity/',import.meta.url);mkdirSync(directory,{recursive:true});
const startedAt=new Date().toISOString(),output=new URL('regression-'+startedAt.replace(/[:.]/g,'-')+'.json',directory),results=[];
function save(){writeFileSync(output,JSON.stringify({startedAt,syntheticOnly:true,nodeVersion:process.version,adapterVersion:TRANSLATION_LLM_ADAPTER_VERSION,hashes,datasetHashes,options,resumedFrom,expected:jobs.length,results},null,2).replace(/\n/g,'\r\n')+'\r\n');}
let cursor=0,authFailure=false,nextCallAt=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function worker(){while(cursor<jobs.length&&!authFailure){const {sample,round}=jobs[cursor++],attempts=[],metrics=[];
 const ranges=(sample.mentions??[]).map(m=>{let start=m.start??-1;if(m.start===undefined)for(let i=0;i<=m.occurrence;i++)start=sample.source.indexOf(m.text,start+1);if(start<0)throw Error('Bad synthetic mention');return{start,length:m.text.length};});
 const r={...sample,round,attempts,metrics};
 const client={async translateText(req,{timeout}){const call={request:req};attempts.push(call);try{await pause(Math.max(0,nextCallAt-Date.now()));nextCallAt=Date.now()+2500;const response=await fetch('https://translation.googleapis.com/v3/'+req.parent+':translateText',{method:'POST',headers:{'content-type':'application/json','x-goog-user-project':project,Authorization:'Bearer '+token},body:JSON.stringify({...req,parent:undefined}),signal:AbortSignal.timeout(timeout)});call.status=response.status;if([401,403].includes(response.status))authFailure=true;if(!response.ok){const detail=await response.json().catch(()=>({}));call.serviceDiagnostic={status:detail.error?.status,retryAfter:response.headers.get('retry-after'),quotaReasons:(detail.error?.details??[]).flatMap(d=>(d.violations??[]).map(v=>v.description))};if(response.status===429)nextCallAt=Math.max(nextCallAt,Date.now()+60000);throw Error('service_error');}call.response=await response.json();return[call.response];}catch{call.error='service_error';throw Error('service_error');}}};
 const start=Date.now();try{const result=await new TranslationLlmTranslator({...options,onMetric:m=>metrics.push(m)},client).translateWithRanges(sample.source,sample.sourceLanguage,sample.targetLanguage,{protectedRanges:ranges});Object.assign(r,result,{status:'output'});r.mentionsPreserved=ranges.every(range=>result.ranges.filter(t=>t.sourceStart===range.start&&result.text.slice(t.start,t.start+t.length)===sample.source.slice(range.start,range.start+range.length)).length===1);const compare=result.text.toLowerCase().replaceAll('？','?');r.fragmentWarnings=[...(sample.required??[]).filter(v=>!compare.includes(v.toLowerCase())).map(v=>'missing:'+v),...(sample.forbidden??[]).filter(v=>compare.includes(v.toLowerCase())).map(v=>'forbidden:'+v)];}catch(e){r.status=metrics.some(m=>m.outcome==='service_error')?'service_error':'rejected';r.reason=e.reason??'service_error';}r.elapsedMs=Date.now()-start;results.push(r);save();if(results.length%20===0)console.log(JSON.stringify({done:results.length,total:jobs.length,output:results.filter(r=>r.status==='output').length,rejected:results.filter(r=>r.status==='rejected').length}));}}
await worker();
for(const name of sources){if(hashes[name].source!==sha(readFileSync(new URL('../src/'+name+'.ts',import.meta.url)))||hashes[name].compiled!==sha(readFileSync(new URL('../lib/'+name+'.js',import.meta.url))))throw Error('Frozen candidate changed during evaluation');}
save();console.log(JSON.stringify({output:output.pathname,complete:results.length===jobs.length,summary:['regression','comparison','v13','verifier-regression','repair-controls','verifier-v11-regression'].map(set=>({set,total:results.filter(r=>r.set===set).length,output:results.filter(r=>r.set===set&&r.status==='output').length,rejected:results.filter(r=>r.set===set&&r.status==='rejected').length,serviceError:results.filter(r=>r.set===set&&r.status==='service_error').length}))}));
