// Assessment only: fixed synthetic data; no LINE clients, settings writes, or production routing.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TranslationLlmTranslator,TRANSLATION_LLM_ADAPTER_VERSION} from '../lib/translation-llm-translator.js';
import {decodeLlmTransport} from '../lib/translation-llm-protection.js';
import {Converter} from 'opencc-js/cn2t';

const casesFile=new URL('../evaluation/synthetic-direct-comparison-cases.json',import.meta.url);
const dataset=readFileSync(casesFile,'utf8');
const cases=JSON.parse(dataset);
if(cases.length!==30||new Set(cases.map(c=>c.id)).size!==30||cases.some(c=>typeof c.source!=='string'||c.source.length>2000||!['en','zh-TW'].includes(c.sourceLanguage)||!['en','zh-TW'].includes(c.targetLanguage)))throw Error('Invalid fixed synthetic dataset');
const wholeMessage=process.argv.includes('--whole-message');
const selectedCases=wholeMessage?cases.filter(c=>/[\r\n]/u.test(c.source)):cases;
const inputShape=wholeMessage?'whole-message':'paragraph-contents';
const variants=wholeMessage?['direct-tllm','direct-nmt']:['current','direct-tllm','direct-nmt'];
const rounds=3;
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourceFiles=['translation-llm-translator','translation-llm-protection','translation-llm-html','translation-llm-subjects','trade-policy'];
const hashes=Object.fromEntries(sourceFiles.map(name=>[name,{
  source:sha(readFileSync(new URL('../src/'+name+'.ts',import.meta.url))),
  compiled:sha(readFileSync(new URL('../lib/'+name+'.js',import.meta.url))),
}]));
if(process.argv.includes('--dry-run')){
 console.log(JSON.stringify({cases:selectedCases.length,inputShape,variants,rounds,plannedResults:selectedCases.length*variants.length*rounds,datasetSha256:sha(dataset),adapterVersion:TRANSLATION_LLM_ADAPTER_VERSION}));
 process.exit(0);
}
const projectId=process.env.GOOGLE_CLOUD_PROJECT,token=process.env.TRADE_EVAL_TOKEN;
if(!projectId||!/^[a-z][a-z0-9-]{4,62}$/u.test(projectId)||!token)throw Error('Set project and temporary TRADE_EVAL_TOKEN.');
const location='us-central1',parent=`projects/${projectId}/locations/${location}`;
const options={projectId,location,glossaryZhEn:parent+'/glossaries/trade-zh-en-v8',glossaryEnZh:parent+'/glossaries/trade-en-zh-v8'};
const traditional=Converter({from:'cn',to:'tw'});
const startedAt=new Date().toISOString();
const directory=new URL('../../.local/direct-translation-comparison/',import.meta.url);
mkdirSync(directory,{recursive:true});
const filename=startedAt.replaceAll(':','-').replaceAll('.','-')+'.json';
const outputFile=new URL(filename,directory);
const results=[];
function checkpoint(){writeFileSync(outputFile,JSON.stringify({startedAt,nodeVersion:process.version,adapterVersion:TRANSLATION_LLM_ADAPTER_VERSION,options,inputShape,datasetSha256:sha(dataset),hashes,cases:selectedCases,variants,rounds,results},null,2).replace(/\n/g,'\r\n')+'\r\n');}
function ranges(sample){return(sample.mentions??[]).map(m=>{let start=-1;for(let i=0;i<=m.occurrence;i++)start=sample.source.indexOf(m.text,start+1);if(start<0)throw Error('Invalid synthetic mention');return{start,length:m.text.length};});}
async function request(req,calls){
 const started=performance.now();
 const item={request:req};calls.push(item);
 try{
  const response=await fetch('https://translation.googleapis.com/v3/'+req.parent+':translateText',{
   method:'POST',headers:{'content-type':'application/json','x-goog-user-project':projectId,Authorization:'Bearer '+token},
   body:JSON.stringify({...req,parent:undefined}),signal:AbortSignal.timeout(15000),
  });
  item.httpStatus=response.status;item.elapsedMs=Math.round(performance.now()-started);
  if(!response.ok){const error=new Error('API request failed');error.reason='http_'+response.status;throw error;}
  item.response=await response.json();return[item.response];
 }catch(error){item.elapsedMs=Math.round(performance.now()-started);item.error=error.reason??(error.name==='TimeoutError'?'timeout':'request_failed');throw error;}
}
async function evaluate(sample,variant,round){
 const calls=[],metrics=[];const start=performance.now();
 const record={id:sample.id,category:sample.category,variant,round,calls,metrics};
 try{
  if(variant==='current'){
   const translator=new TranslationLlmTranslator({...options,onMetric:m=>metrics.push(m)},{translateText:req=>request(req,calls)});
   const output=await translator.translateWithRanges(sample.source,sample.sourceLanguage,sample.targetLanguage,{protectedRanges:ranges(sample)});
   record.text=output.text;record.ranges=output.ranges;record.status='output';
  }else{
   // Keep the production paragraph boundaries, but expose original numbers and units.
   const parts=wholeMessage?[{text:sample.source,translate:true}]:sample.source.split(/(\r\n|\r|\n)/u).map((text,index)=>({text,translate:index%2===0&&/\p{L}/u.test(text)}));
   const apiParent=variant==='direct-tllm'?parent:`projects/${projectId}/locations/global`;
   const req={parent:apiParent,model:apiParent+'/models/general/'+(variant==='direct-tllm'?'translation-llm':'nmt'),contents:parts.filter(p=>p.translate).map(p=>p.text),mimeType:'text/plain',sourceLanguageCode:sample.sourceLanguage,targetLanguageCode:sample.targetLanguage};
   if(variant==='direct-tllm')req.glossaryConfig={glossary:sample.sourceLanguage==='en'?options.glossaryEnZh:options.glossaryZhEn,ignoreCase:false,contextualTranslationEnabled:false};
   const [response]=await request(req,calls);
   const translations=variant==='direct-tllm'?response.glossaryTranslations:response.translations;
   if(translations?.length!==req.contents.length||translations.some(t=>typeof t.translatedText!=='string'||!t.translatedText.trim()))throw Error('Invalid response');
   let i=0;record.text=parts.map(p=>p.translate?decodeLlmTransport(translations[i++].translatedText):p.text).join('');
   if(sample.targetLanguage==='zh-TW')record.text=traditional(record.text);
   record.ranges=[];record.status='output';
  }
 }catch(error){record.status=calls.some(c=>c.error)?'service_error':'rejected';record.reason=error.reason??'invalid_response';}
 record.elapsedMs=Math.round(performance.now()-start);
 record.inputCharacters=calls.reduce((n,c)=>n+c.request.contents.reduce((sum,s)=>sum+[...s].length,0),0);
 record.outputCharacters=calls.reduce((n,c)=>n+(c.response?.glossaryTranslations??c.response?.translations??[]).reduce((sum,t)=>sum+[...(t.translatedText??'')].length,0),0);
 if(ranges(sample).length&&variant!=='current')record.limitation='No native mention occurrence mapping in this raw candidate';
 return record;
}
const jobs=[];
for(let round=1;round<=rounds;round++)for(const sample of selectedCases)for(let i=0;i<variants.length;i++)jobs.push({sample,variant:variants[(i+round-1)%variants.length],round});
let cursor=0,authFailure=false;
async function worker(){while(cursor<jobs.length&&!authFailure){const {sample,variant,round}=jobs[cursor++];const record=await evaluate(sample,variant,round);results.push(record);if(record.calls.some(c=>[401,403].includes(c.httpStatus)))authFailure=true;if(results.length%15===0){checkpoint();console.log(JSON.stringify({completed:results.length,total:jobs.length}));}}}
await Promise.all([worker(),worker()]);
checkpoint();
const summary=variants.map(variant=>{const records=results.filter(r=>r.variant===variant);return{variant,total:records.length,output:records.filter(r=>r.status==='output').length,rejected:records.filter(r=>r.status==='rejected').length,serviceError:records.filter(r=>r.status==='service_error').length,apiCalls:records.reduce((n,r)=>n+r.calls.length,0),inputCharacters:records.reduce((n,r)=>n+r.inputCharacters,0),outputCharacters:records.reduce((n,r)=>n+r.outputCharacters,0)};});
console.log(JSON.stringify({outputFile:outputFile.pathname,summary,complete:results.length===jobs.length}));
if(results.length!==jobs.length)process.exitCode=1;