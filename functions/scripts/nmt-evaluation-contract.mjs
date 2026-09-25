import {glossaryRecordFile} from './nmt-glossary-spec.mjs';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NmtGlossaryTranslator,NMT_GLOSSARY_ADAPTER_VERSION} from '../lib/nmt-glossary-translator.js';
import {countNmtCharacters,normalizeNmtBudgetMode} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT,NMT_GLOSSARIES} from '../lib/nmt-isolation.js';
export const sha=x=>createHash('sha256').update(x).digest('hex');
export const mainFiles=['synthetic-trade-cases.json','synthetic-alternative-cases.json','synthetic-tllm-holdout.json','synthetic-tllm-v2-holdout.json','synthetic-tllm-v4-holdout.json','synthetic-tllm-v6-holdout.json','synthetic-tllm-v8-holdout.json','synthetic-tllm-v9-regression.json','synthetic-tllm-v10-holdout.json','synthetic-tllm-v11-holdout.json','synthetic-tllm-v12-holdout.json'];
export const coreIds=['pack-rough-packaging','pack-clear-packaging','pack-zh-packaging','pack-decimal-units','pack-tentative-packaging','pack-net-gross','pack-zh-negative','pack-zh-net-gross','pack-split-paragraphs'];
export const rubric={main:{total:280,minimumUsable:272,allowedRejections:['v6h16','v8h11','v9h07','v9h28','v10h06','v11h15','v12h14','v12h15']},comparison:{total:30,minimumUsable:29,allowedRejections:['pack-do-not-calculate']},oldHoldout:{total:20,minimumUsable:20},unique:{total:318,minimumUsable:309},core:{total:27,minimumUsable:27},verification:{total:20,minimumUsable:20},review:'Full human review required: output is not a usability verdict; false rejection remains a finding even for allowlisted cases.'};
const parent='projects/'+NMT_TEST_PROJECT+'/locations/us-central1';
export const options={projectId:NMT_TEST_PROJECT,location:'us-central1',glossaryZhEn:parent+'/glossaries/'+NMT_GLOSSARIES.zhEn,glossaryEnZh:parent+'/glossaries/'+NMT_GLOSSARIES.enZh,protectedNames:['Alex','Mira','Wei','Kumar','Kumaran','Shan','Niranjan','Eric','Kash']};
export const callOptions={timeout:15000,retry:{retryCodes:[]}};
export function ranges(sample){return(sample.mentions??[]).map(m=>{let start=m.start??-1;if(m.start===undefined)for(let i=0;i<=(m.occurrence??0);i++)start=sample.source.indexOf(m.text,start+1);const length=m.length??m.text?.length;if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(length)||length<=0||start+length>sample.source.length)throw Error('Invalid UTF16 mention range');return{start,length};});}
export const caseKey=s=>JSON.stringify([s.sourceLanguage,s.targetLanguage,s.source,ranges(s)]);
export function loadFixedCases(){
 const logical=[];const hashes={};
 const load=(file,set)=>{const bytes=readFileSync(new URL('../evaluation/'+file,import.meta.url));hashes[file]=sha(bytes);for(const sample of JSON.parse(bytes))if(sample.sourceLanguage!=='vi'&&sample.targetLanguage!=='vi')logical.push({...sample,set});};
 for(const file of mainFiles)load(file,'main');if(logical.length!==280)throw Error('Expected 280 main cases');
 load('synthetic-direct-comparison-cases.json','comparison');load('synthetic-tllm-v13-holdout.json','oldHoldout');
 if(logical.length!==330)throw Error('Expected 330 logical cases');
 const unique=new Map();for(const sample of logical){const key=caseKey(sample);if(!unique.has(key))unique.set(key,{...sample,aliases:[]});unique.get(key).aliases.push({id:sample.id,set:sample.set});}
 if(unique.size!==318)throw Error('Expected 318 unique direction/text/range cases');
 return{cases:[...unique.values()],hashes,logical};
}
export function artifactHashes(){
 const hashes={};
 for(const directory of ['src','lib','glossaries','scripts','config'])for(const name of readdirSync(new URL('../'+directory+'/',import.meta.url)).sort())if(/\.(ts|js|map|mjs|json|tsv|example)$/u.test(name)){const key=directory+'/'+name;hashes[key]=sha(readFileSync(new URL('../'+key,import.meta.url)));}
 for(const name of ['package.json','package-lock.json','tsconfig.json','tsconfig.build.json'])hashes[name]=sha(readFileSync(new URL('../'+name,import.meta.url)));
 for(const name of ["package.json","firebase.json",".firebaserc"])hashes["root/"+name]=sha(readFileSync(new URL("../../"+name,import.meta.url)));
 return hashes;
}
export async function encodeJob(sample,round){
 let request;const metrics=[];
 const translator=new NmtGlossaryTranslator({...options,onMetric:m=>metrics.push(m)},{async translateText(req){request=req;throw Error('Offline encoding only');}});
 let skippedOutput;
 try{skippedOutput=await translator.translateWithRanges(sample.source,sample.sourceLanguage,sample.targetLanguage,{protectedRanges:ranges(sample)});}catch(error){if(!request)throw error;}
 return{key:sha(caseKey(sample))+':'+round,sample,round,request,callOptions,characters:request?countNmtCharacters(request.contents):0,skippedOutput};
}
export async function createContract({category='regression',ids,fixture,budgetMode='capped'}={}){
 budgetMode=normalizeNmtBudgetMode(budgetMode);
 const fixed=loadFixedCases();let selected=fixed.cases;
 if(fixture){if(category!=='verification')throw Error('External fixture only permitted for verification');const bytes=readFileSync(fixture);fixed.hashes['verification-fixture']=sha(bytes);selected=JSON.parse(bytes);if(selected.length!==20||new Set(selected.map(caseKey)).size!==20||selected.some(s=>fixed.cases.some(c=>caseKey(c)===caseKey(s))))throw Error('Verification requires 20 new unique cases');}
 if(ids){selected=selected.filter(s=>ids.some(id=>s.id===id||s.aliases?.some(a=>a.id===id)));if(!selected.length)throw Error('No selected cases');}
 if(['smoke','retest'].includes(category)&&!ids)throw Error('Smoke/retest requires explicit --ids');
 if(category==='smoke'&&selected.length>10)throw Error('Smoke limited to ten cases');
 if(category==='verification'&&!fixture)throw Error('Verification requires frozen fresh fixture');
 const jobs=[];for(const sample of selected){jobs.push(await encodeJob(sample,1));if(category==='regression'&&!ids&&sample.aliases.some(a=>coreIds.includes(a.id)))for(const round of [2,3])jobs.push(await encodeJob(sample,round));}
 const resourcePath=new URL('../../.local/evidence/'+glossaryRecordFile,import.meta.url);
 const glossaryResources=existsSync(resourcePath)?JSON.parse(readFileSync(resourcePath,'utf8')):null;
 const contract={glossaryResources,version:NMT_GLOSSARY_ADAPTER_VERSION,category,budgetMode,options,callOptions,rubric,datasetHashes:fixed.hashes,artifactHashes:artifactHashes(),jobs};
 return{...contract,contractHash:sha(JSON.stringify(contract)),summary:{logicalCases:fixed.logical.length,uniqueCases:fixed.cases.length,selectedCases:selected.length,results:jobs.length,requests:jobs.filter(j=>j.request).length,characters:jobs.reduce((sum,j)=>sum+j.characters,0),skipped:jobs.filter(j=>!j.request).length}};
}
