import {readFileSync,writeFileSync,mkdirSync,renameSync,openSync,closeSync,unlinkSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {root} from './nmt-local-guard.mjs';
import {createContract,sha,options,ranges,artifactHashes} from './nmt-evaluation-contract.mjs';
import {validateNmtEvidence,validateNmtContract} from './nmt-evidence.mjs';
import {NmtGlossaryTranslator} from '../lib/nmt-glossary-translator.js';
import {reserveNmtLedger,NMT_LIMITS,validateNmtLedger,nmtBudgetMode,normalizeNmtBudgetMode} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT} from '../lib/nmt-isolation.js';
export const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const save=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(value,null,2).replace(/\n/g,'\r\n')+'\r\n');renameSync(path+'.tmp',path);};
export function executionLock(path=resolve(root,'.local/nmt-execution.lock')){
 mkdirSync(dirname(path),{recursive:true});let fd;try{fd=openSync(path,'wx');}catch{throw Error('NMT execution lock exists; do not clear without reconciling any pending reservation');}
 writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));let released=false;
 return()=>{if(!released){closeSync(fd);unlinkSync(path);released=true;}};
}
export function requireCandidate(contract){if(!equal(artifactHashes(),contract.artifactHashes))throw Error('Candidate changed during execution');}
export function totals(entries){const out={regression:0,retest:0};for(const e of entries)if(e.mode==='execute')out[e.category]+=e.characters;return out;}
export function preflightBudget(ledger,costs,requiredMode){
 validateNmtLedger(ledger,NMT_TEST_PROJECT);
 if(requiredMode!==undefined&&nmtBudgetMode(ledger,NMT_TEST_PROJECT)!==normalizeNmtBudgetMode(requiredMode))throw Error('Frozen budget mode does not match fresh ledger');
 let projected=structuredClone(ledger);for(const [category,cost]of Object.entries(costs)){if(!Object.hasOwn(NMT_LIMITS,category)||!Number.isSafeInteger(cost)||cost<0)throw Error('Invalid planned category cost');if(cost)projected=reserveNmtLedger(projected,NMT_TEST_PROJECT,category,cost);}return projected;
}
export function fileReference(path){const absolute=resolve(path),bytes=readFileSync(absolute);return{path:absolute,sha256:sha(bytes)};}
export function readReference(ref){if(!ref||typeof ref.path!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256))throw Error('Missing immutable evidence reference');const bytes=readFileSync(ref.path);if(sha(bytes)!==ref.sha256)throw Error('Referenced evidence changed');return JSON.parse(bytes);}
export const rowHash=row=>sha(JSON.stringify(row));
export function archivedOutputRow(row,text=row.text,ranges=row.ranges){
 const checked={...structuredClone(row),status:"output"};delete checked.reason;delete checked.text;delete checked.ranges;Object.assign(checked,{text,ranges});return checked;
}
export async function replayRow(job,row){
 if(!job.request){if(row.status!=='skipped'||row.text!==job.skippedOutput?.text||!equal(row.ranges,job.skippedOutput?.ranges)||row.attempts.length)throw Error('Invalid skipped provenance');return structuredClone(row);}
 if(row.attempts?.length!==1||!row.attempts[0].response||row.attempts[0].error||!['output','rejected'].includes(row.status))throw Error('Complete recorded provider response required');
 const attempt=row.attempts[0];if(!equal(attempt.request,job.request)||!equal(attempt.callOptions,job.callOptions))throw Error('Complete producer wire/options mismatch');
 let output,failure;try{output=await new NmtGlossaryTranslator(options,{async translateText(request,opts){if(!equal(request,attempt.request)||!equal(opts,attempt.callOptions))throw Error('Replay request mismatch');return[structuredClone(attempt.response)];}}).translateWithRanges(job.sample.source,job.sample.sourceLanguage,job.sample.targetLanguage,{protectedRanges:ranges(job.sample)});}catch(error){failure=error;}
 if(!output&&!failure?.reason)throw failure??Error('Replay failed');
 const checked={...structuredClone(row),status:output?'output':'rejected'};delete checked.reason;delete checked.text;delete checked.ranges;
 if(output)Object.assign(checked,output);else checked.reason=failure.reason;return checked;
}
export async function loadSources(source){
 const recording=readReference(source.recording),review=readReference(source.review);
 await validateNmtEvidence(recording,{freeze:recording.contract,allowIncomplete:true,currentCandidate:false,replayOutputs:false});
 if(review.resultsSha256!==source.recording.sha256||!review.reviewer||review.reviews.length!==recording.results.length||new Set(review.reviews.map(r=>r.key)).size!==review.reviews.length)throw Error('Original review provenance mismatch');
 for(const row of recording.results){const item=review.reviews.find(r=>r.key===row.key);const digest=sha(JSON.stringify({source:row.source,text:row.text,status:row.status,reason:row.reason,attempts:row.attempts}));if(!item||item.evidenceHash!==digest||!['usable','defect','pending','safe_rejection'].includes(item.verdict)||!item.reason)throw Error('Original row review mismatch');}
 return{recording,review};
}
export async function deriveEntries(candidate,source,{replayOutputs=true}={}){
 const{recording,review}=await loadSources(source);const entries=[];
 for(const job of candidate.jobs){const row=recording.results.find(r=>r.key===job.key),verdict=review.reviews.find(r=>r.key===job.key);const producer=recording.contract.jobs.find(j=>j.key===job.key);if(!producer||!equal(producer.sample,job.sample)||producer.round!==job.round)throw Error('Master dataset/round mismatch');
 const predecessor=row?{sourceSha256:source.recording.sha256,key:row.key,rowSha256:rowHash(row),producerContractHash:recording.contractHash}:null;
 if(row&&verdict.verdict==='usable'&&equal(producer.request,job.request)&&equal(producer.callOptions,job.callOptions)){
   const checked=replayOutputs?await replayRow(job,row):(row.status==='skipped'?structuredClone(row):archivedOutputRow(row));if(!['output','skipped'].includes(checked.status)||checked.text!==row.text||!equal(checked.ranges,row.ranges))throw Error('Previously usable output no longer passes current checker');
   entries.push({key:job.key,mode:'reuse',characters:job.characters,predecessor,checkedHash:rowHash(checked)});
 }else entries.push({key:job.key,mode:'execute',category:row?'retest':'regression',characters:job.characters,predecessor,reason:row?(verdict.verdict==='usable'?'changed-request':'replace-reviewed-failure-or-unknown'):'not-started'});
 }
 return entries;
}
export async function createEvaluationPlan({recording,review,ledger,candidate,preview=false}){
 candidate??=await createContract({category:'regression',budgetMode:nmtBudgetMode(ledger,NMT_TEST_PROJECT)});
 if(!preview)await validateNmtContract(candidate,{aggregate:true});
 const source={recording:fileReference(recording),review:fileReference(review)};
 const entries=await deriveEntries(candidate,source),costs=totals(entries);preflightBudget(ledger,costs,normalizeNmtBudgetMode(candidate.budgetMode));
 const payload={kind:preview?'NMT-evaluation-preview-NOT-executable':'NMT-evaluation-plan',version:1,candidate,source,baselineLedger:ledger,entries,costs};return{...payload,planHash:sha(JSON.stringify(payload))};
}
export async function validateEvaluationPlan(plan,{currentCandidate=true,ancestry=[]}={}){
 if(plan.version===2)return(await import("./nmt-successor-plan.mjs")).validateSuccessorPlan(plan,{currentCandidate,ancestry});
 const{planHash,...payload}=plan;if(plan.kind!=='NMT-evaluation-plan'||plan.version!==1||sha(JSON.stringify(payload))!==planHash)throw Error('Frozen evaluation plan mismatch');
 await validateNmtContract(plan.candidate,{aggregate:true,currentCandidate});const expected=await deriveEntries(plan.candidate,plan.source,{replayOutputs:currentCandidate});
 if(!equal(expected,plan.entries)||!equal(totals(expected),plan.costs))throw Error('Plan selections/categories/provenance mismatch');preflightBudget(plan.baselineLedger,plan.costs,normalizeNmtBudgetMode(plan.candidate.budgetMode));return plan;
}
export function batchContract(plan,keys){
 if(!Array.isArray(keys)||!keys.length||new Set(keys).size!==keys.length)throw Error('Explicit unique batch keys required');
 const entries=keys.map(key=>plan.entries.find(e=>e.key===key));if(entries.some(e=>!e||e.mode!=='execute')||new Set(entries.map(e=>e.category)).size!==1)throw Error('Batch keys/category not authorized by plan');
 const jobs=plan.candidate.jobs.filter(j=>keys.includes(j.key));const category=entries[0].category;
 const{contractHash:oldHash,summary:oldSummary,...base}=plan.candidate;const payload={...base,category,jobs,evaluationPlanHash:plan.planHash};
 const summary={logicalCases:330,uniqueCases:318,selectedCases:jobs.filter(j=>j.round===1).length,results:jobs.length,requests:jobs.filter(j=>j.request).length,characters:jobs.reduce((sum,j)=>sum+j.characters,0),skipped:jobs.filter(j=>!j.request).length};
 if(normalizeNmtBudgetMode(plan.candidate.budgetMode)==='capped'&&summary.characters>NMT_LIMITS[category])throw Error('Batch exceeds category limit');return{...payload,contractHash:sha(JSON.stringify(payload)),summary};
}
export const planDirectory=plan=>resolve(root,'.local/nmt-plan-executions',plan.planHash);
export async function loadPlanExecutions(plan,directory=planDirectory(plan),{currentCandidate=true,replayOutputs=true}={}){
 const batches=[];if(existsSync(directory))for(const name of readdirSync(directory).filter(n=>n.endsWith('.json'))){const path=resolve(directory,name),evidence=JSON.parse(readFileSync(path,'utf8'));const expected=batchContract(plan,evidence.contract.jobs.map(j=>j.key));if(!equal(expected,evidence.contract)||name!==expected.contractHash+'.json')throw Error('Execution journal does not match approved plan');await validateNmtEvidence(evidence,{freeze:expected,allowIncomplete:true,currentCandidate,replayOutputs});batches.push({reference:fileReference(path),evidence});}
 const rows=new Map();for(const batch of batches)for(const row of batch.evidence.results){if(rows.has(row.key))throw Error('Key attempted in more than one execution batch');rows.set(row.key,{...batch,row});}return{batches,rows};
}
export function assertBatchOwnership(batch,executions){for(const job of batch.jobs){const prior=executions.rows.get(job.key);if(prior&&prior.evidence.contractHash!==batch.contractHash)throw Error('Key already belongs to another execution batch');if(prior&&['pending','service_error'].includes(prior.row.status))throw Error('Unknown/failed attempt requires a separately approved replacement plan; no automatic retry');}}
export async function mergeEvaluationPlan(plan,{directory}={}){
 await validateEvaluationPlan(plan);const{recording}=await loadSources(plan.source),executions=await loadPlanExecutions(plan,directory);const results=[],provenance=[];
 for(const entry of plan.entries){const job=plan.candidate.jobs.find(j=>j.key===entry.key);let original,ref;
 if(entry.mode==='reuse'&&entry.producer){const producer=readReference(entry.producer.recording);original=producer.results.find(r=>r.key===entry.key);ref=entry.producer.recording;}else if(entry.mode==='reuse'){original=recording.results.find(r=>r.key===entry.key);ref=plan.source.recording;}else{const saved=executions.rows.get(entry.key);if(!saved)throw Error('Incomplete plan: missing execution key');original=saved.row;ref=saved.reference;}
 const checked=await replayRow(job,original);if(!['output','rejected','skipped'].includes(checked.status))throw Error('Incomplete provider outcome');results.push(checked);provenance.push({key:entry.key,mode:entry.mode,source:ref,producerContractHash:entry.mode==='reuse'?(entry.producer?.contractHash??recording.contractHash):executions.rows.get(entry.key).evidence.contractHash,rowSha256:rowHash(original),checkedHash:rowHash(checked),predecessor:entry.predecessor,...(entry.history?{history:entry.history}:{}),...(entry.recovery?{recovery:entry.recovery}:{} ),...(entry.adjudicationHistory?{adjudicationHistory:entry.adjudicationHistory}:{})});
 }
 return{kind:'NMT-multi-producer-offline-checked',plan,planHash:plan.planHash,contract:plan.candidate,contractHash:plan.candidate.contractHash,provenance,results,reviewStatus:'pending-full-text-review',note:'Original producer files remain immutable. Current checker replay is not a new model response.'};
}
export async function validateMergedEvidence(value,dependencies){const rebuilt=await mergeEvaluationPlan(value.plan,dependencies);if(!equal(value,rebuilt))throw Error('Merged evidence/provenance mismatch');return value;}
