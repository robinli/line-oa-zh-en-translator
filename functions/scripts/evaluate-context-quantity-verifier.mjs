import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TranslationLlmTranslator,TRANSLATION_LLM_ADAPTER_VERSION} from '../lib/translation-llm-translator.js';
const root=new URL('../../',import.meta.url),sha=x=>createHash('sha256').update(x).digest('hex');
const fixturePath=new URL('../evaluation/synthetic-context-quantity-verifier-holdout.json',import.meta.url),fixtureBytes=readFileSync(fixturePath),fixtureHash=sha(fixtureBytes);
if(fixtureHash!=='8554f3bd491706f8f11af74b6574ee2c1c30c6cf044478064edd75663a6d83bd')throw Error('Frozen verifier fixture changed');
const cases=JSON.parse(fixtureBytes),reference=JSON.parse(readFileSync(new URL('../evaluation/tllm-context-quantity-review.json',import.meta.url)));
const hashes=Object.fromEntries(Object.keys(reference.hashes).map(n=>[n,{source:sha(readFileSync(new URL('../src/'+n+'.ts',import.meta.url))),compiled:sha(readFileSync(new URL('../lib/'+n+'.js',import.meta.url)))}]));
if(JSON.stringify(hashes)!==JSON.stringify(reference.hashes))throw Error('Candidate differs from reviewed frozen v6');
if(cases.length!==20||cases.filter(c=>c.core).length!==14)throw Error('Fixture contract changed');
const rangeFor=c=>(c.mentions??[]).map(m=>{let start=-1;for(let i=0;i<=m.occurrence;i++)start=c.source.indexOf(m.text,start+1);if(start<0)throw Error('Mention missing');return {start,length:m.text.length};});
if(process.argv.includes('--dry-run')){console.log(JSON.stringify({node:process.version,adapterVersion:TRANSLATION_LLM_ADAPTER_VERSION,fixtureHash,cases:cases.length,core:14,rounds:3,hashes}));process.exit(0);}
const project='line-auto-translate-bot',token=process.env.TRADE_EVAL_TOKEN;if(!token)throw Error('Temporary credential required');
const parent=`projects/${project}/locations/us-central1`,options={projectId:project,location:'us-central1',glossaryZhEn:parent+'/glossaries/trade-zh-en-v8',glossaryEnZh:parent+'/glossaries/trade-en-zh-v8',protectedNames:['Wei','Shan','Eric','Kash','Kumar','Kumaran','Niranjan']};
const dir=new URL('.local/tllm-context-quantity-verifier/',root);mkdirSync(dir,{recursive:true});
const startedAt=new Date().toISOString(),out=new URL('holdout-'+startedAt.replace(/[:.]/g,'-')+'.json',dir),results=[];
const resumeArg=process.argv.find(s=>s.startsWith('--resume='))?.slice(9),resume=resumeArg?JSON.parse(readFileSync(resumeArg)):undefined;
if(resume&&(JSON.stringify(resume.hashes)!==JSON.stringify(hashes)||resume.fixtureHash!==fixtureHash))throw Error('Invalid resume');
const done=new Set((resume?.results??[]).filter(r=>r.status!=='service_error').map(r=>r.id+':'+r.round));
const save=()=>writeFileSync(out,JSON.stringify({startedAt,syntheticOnly:true,fixtureHash,adapterVersion:TRANSLATION_LLM_ADAPTER_VERSION,node:process.version,hashes,options,resumedFrom:resumeArg?{path:resumeArg,sha256:sha(readFileSync(resumeArg))}:undefined,results},null,2).replace(/\n/g,'\r\n')+'\r\n');
let nextAt=0,stop=false;const pause=ms=>new Promise(r=>setTimeout(r,ms));
for(let round=1;round<=3&&!stop;round++)for(const c of cases){if(stop)break;if(done.has(c.id+':'+round))continue;const r={...c,round,attempts:[],metrics:[]};
 const client={async translateText(req,contract){const a={request:req,contract};r.attempts.push(a);await pause(Math.max(0,nextAt-Date.now()));nextAt=Date.now()+2500;try{const res=await fetch('https://translation.googleapis.com/v3/'+req.parent+':translateText',{method:'POST',headers:{'content-type':'application/json','x-goog-user-project':project,Authorization:'Bearer '+token},body:JSON.stringify({...req,parent:undefined}),signal:AbortSignal.timeout(contract.timeout)});a.status=res.status;if([401,403].includes(res.status))stop=true;if(!res.ok){a.error='service_error';if(res.status===429)nextAt=Date.now()+60000;throw Error('service_error');}a.response=await res.json();return[a.response];}catch{a.error='service_error';throw Error('service_error');}}};
 const start=Date.now();try{const result=await new TranslationLlmTranslator({...options,onMetric:m=>r.metrics.push(m)},client).translateWithRanges(c.source,c.sourceLanguage,c.targetLanguage,{protectedRanges:rangeFor(c)});Object.assign(r,result,{status:'output'});}catch(e){r.status=r.metrics.some(m=>m.outcome==='service_error')?'service_error':'rejected';r.reason=e.reason??'service_error';}r.elapsedMs=Date.now()-start;results.push(r);save();console.log(JSON.stringify({id:r.id,round,status:r.status,reason:r.reason}));}
for(const [n,h] of Object.entries(hashes))if(h.source!==sha(readFileSync(new URL('../src/'+n+'.ts',import.meta.url)))||h.compiled!==sha(readFileSync(new URL('../lib/'+n+'.js',import.meta.url))))throw Error('Candidate changed');
save();console.log(JSON.stringify({file:out.pathname,recorded:results.length}));
