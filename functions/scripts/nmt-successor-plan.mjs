import {root} from './nmt-local-guard.mjs';
import {nmtBudgetMode,normalizeNmtBudgetMode} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT} from '../lib/nmt-isolation.js';
import {saveImmutable} from './nmt-output-safety.mjs';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createContract,sha} from './nmt-evaluation-contract.mjs';
import {validateNmtContract,validateNmtEvidence} from './nmt-evidence.mjs';
import {equal,fileReference,readReference,rowHash,replayRow,archivedOutputRow,deriveEntries,loadSources,validateEvaluationPlan,loadPlanExecutions,planDirectory,totals,preflightBudget} from './nmt-evaluation-plan.mjs';
const fail=message=>{throw Error('NMT successor: '+message);};
export const MAX_PLAN_GENERATIONS=16;
const referenceList=directory=>existsSync(directory)?readdirSync(directory).filter(name=>name.endsWith('.json')).sort().map(name=>fileReference(resolve(directory,name))):[];
export function planAncestry(plan){
 const chain=[],seen=new Set();
 for(let current=plan;;current=readReference(current.parent.plan)){
  if(!current||![1,2].includes(current.version)||seen.has(current.planHash)||chain.length>=MAX_PLAN_GENERATIONS)fail('invalid, cyclic or excessive plan ancestry');
  seen.add(current.planHash);chain.push(current);if(current.version===1)return chain;
 }
}
export function assertParentManifest(plan){
 for(const current of planAncestry(plan)){
  if(current.version!==2)continue;
  const parent=readReference(current.parent.plan),actual=referenceList(planDirectory(parent));
  if(!equal(actual,current.parent.executions))fail('parent execution manifest changed, missing or added journal');
  for(const ref of current.parent.reviews)readReference(ref);
  if(current.adjudication)readReference(current.adjudication);
  if(current.replacements)readReference(current.replacements);
  if(current.wireChanges)readReference(current.wireChanges);
 }
}
async function parentRows(parent,{ancestry=[]}={}){
 const previous=readReference(parent.plan);
 await validateEvaluationPlan(previous,{currentCandidate:false,ancestry});
 assertParentManifest({version:2,planHash:'manifest-check',parent});
 const executions=await loadPlanExecutions(previous,undefined,{currentCandidate:false,replayOutputs:false});
 const reviewHashes=new Set(),rows=new Map();
 for(const batch of executions.batches){
  await validateNmtEvidence(batch.evidence,{freeze:batch.evidence.contract,currentCandidate:false,replayOutputs:false});
  const matches=parent.reviews.filter(ref=>readReference(ref).resultsSha256===batch.reference.sha256);
  if(matches.length!==1)fail('exactly one original review required for each complete parent journal');
  const reviewRef=matches[0];reviewHashes.add(reviewRef.sha256);
  const{review}=await loadSources({recording:batch.reference,review:reviewRef});
  for(const row of batch.evidence.results){if(rows.has(row.key))fail('duplicate parent key');rows.set(row.key,{row,job:batch.evidence.contract.jobs.find(j=>j.key===row.key),recording:batch.reference,contractHash:batch.evidence.contractHash,review:reviewRef,verdict:review.reviews.find(r=>r.key===row.key)});}
 }
 if(reviewHashes.size!==parent.reviews.length)fail('unused/duplicate parent review');
 return{previous,rows};
}
const producerRef=entry=>({recording:entry.recording,contractHash:entry.contractHash,key:entry.row.key,rowSha256:rowHash(entry.row),review:entry.review});
async function inheritedRecord(producer){
 const{recording,review}=await loadSources(producer);
 const row=recording.results.find(r=>r.key===producer.key),job=recording.contract.jobs.find(j=>j.key===producer.key);
 if(!row||!job||recording.contractHash!==producer.contractHash||rowHash(row)!==producer.rowSha256)fail('inherited producer binding mismatch');
 return{row,job,recording:producer.recording,contractHash:producer.contractHash,review:producer.review,verdict:review.reviews.find(r=>r.key===producer.key)};
}
export const requestHash=job=>sha(JSON.stringify({request:job.request,callOptions:job.callOptions}));
async function masterRecord(previous,key,loaded){
 const{recording,review}=loaded??await loadSources(previous.source),row=recording.results.find(r=>r.key===key);
 return row?{row,job:recording.contract.jobs.find(j=>j.key===key),recording:previous.source.recording,contractHash:recording.contractHash,review:previous.source.review,verdict:review.reviews.find(r=>r.key===key)}:null;
}
const wireBinding=(previous,job,priorJob,record)=>({key:job.key,sampleHash:sha(JSON.stringify(job.sample)),round:job.round,previousRequestHash:requestHash(priorJob),candidateRequestHash:requestHash(job),prior:record?{state:'recorded',producer:producerRef(record),originalStatus:record.row.status,originalVerdict:record.verdict.verdict}:{state:'not-started'}});
export async function wireChangeApprovalTemplate({parentPlan,reviews,candidate}){
 const ref=fileReference(parentPlan),previous=readReference(ref),parent={plan:ref,executions:referenceList(planDirectory(previous)),reviews:reviews.map(fileReference)};
 const{rows}=await parentRows(parent),master=await loadSources(previous.source),changes=[];
 for(const job of candidate.jobs){const priorJob=previous.candidate.jobs.find(j=>j.key===job.key),prior=previous.entries.find(e=>e.key===job.key);if(!priorJob||!prior||!equal(priorJob.sample,job.sample)||priorJob.round!==job.round)fail('wire change source/round mismatch');if(requestHash(priorJob)===requestHash(job))continue;
 const record=rows.get(job.key)??(prior.producer?await inheritedRecord(prior.producer):await masterRecord(previous,job.key,master));
 changes.push({...wireBinding(previous,job,priorJob,record),reason:'',approval:'pending',approvedBy:''});}
 return{kind:'NMT-wire-change-approval',parentPlan:ref,changes};
}
async function deriveSuccessor(plan,{preview=false,currentCandidate=true,ancestry=[]}={}){
 const{previous,rows}=await parentRows(plan.parent,{ancestry});
 if(!equal(plan.source,previous.source))fail('master source must remain unchanged');
 const base=await deriveEntries(plan.candidate,plan.source,{replayOutputs:currentCandidate}),replacements=readReference(plan.replacements);
 if(!Array.isArray(replacements)||new Set(replacements.map(r=>r.key)).size!==replacements.length)fail('unique approved replacement keys required');
 const adjudication=plan.adjudication?readReference(plan.adjudication):null;
 const wireChanges=plan.wireChanges?readReference(plan.wireChanges):null,master=wireChanges?await loadSources(previous.source):null;
 if(wireChanges&&(wireChanges.kind!=='NMT-wire-change-approval'||!equal(wireChanges.parentPlan,plan.parent.plan)||!Array.isArray(wireChanges.changes)||new Set(wireChanges.changes.map(r=>r.key)).size!==wireChanges.changes.length))fail('wire change manifest parent/keys mismatch');
 const usedWireChanges=new Set(),pendingWireApproval=[],usedReplacements=new Set(),recoveries=[],entries=[];
 for(const entry of base){
  const job=plan.candidate.jobs.find(j=>j.key===entry.key),prior=previous.entries.find(e=>e.key===entry.key),priorJob=previous.candidate.jobs.find(j=>j.key===entry.key);
  if(!prior||!priorJob)fail('parent fixed key missing');
  const direct=rows.get(entry.key),record=direct??(prior.producer?await inheritedRecord(prior.producer):null);
  const wireChange=wireChanges?.changes.find(r=>r.key===entry.key);
  if(wireChange){
   const original=record??await masterRecord(previous,entry.key,master);
   if(!equal(job.sample,priorJob.sample)||job.round!==priorJob.round||requestHash(job)===requestHash(priorJob)||!job.request||!priorJob.request)fail('wire change requires same source/round and changed full request');
   const{reason,approval,approvedBy,...binding}=wireChange;
   if(!equal(binding,wireBinding(previous,job,priorJob,original))||typeof reason!=='string'||!reason.trim()||!['pending','approved'].includes(approval)||typeof approvedBy!=='string')fail('wire change evidence/hash/reason mismatch');
   if(approval!=='approved'||!approvedBy.trim()){if(!preview)fail('explicit wire change approval required');pendingWireApproval.push(entry.key);}
   if(replacements.some(r=>r.key===entry.key))fail('duplicate wire replacement mechanisms');
   if(direct&&prior.mode!=='execute'||!direct&&record&&prior.mode!=='reuse')fail('parent journal attempted an inherited key');
   const history=[...(prior.history??[]),{kind:'wire-invalidation',manifest:plan.wireChanges,...(original?{...producerRef(original),originalStatus:original.row.status,originalVerdict:original.verdict.verdict}:{state:'not-started'}),previousRequestHash:requestHash(priorJob),candidateRequestHash:requestHash(job)}];
   const next={...entry,mode:'execute',category:prior.mode==='execute'?prior.category:'retest',characters:job.characters,reason,wireChange:{manifest:plan.wireChanges,key:entry.key},history};
   const adjudicationHistory=[...(prior.adjudicationHistory??[]),...(prior.recovery?[prior.recovery.adjudication]:[])];if(adjudicationHistory.length)next.adjudicationHistory=adjudicationHistory;
   entries.push(next);usedWireChanges.add(entry.key);continue;
  }
  if(!record){
   if(prior.mode==='execute'){
    if(!equal(job,priorJob))fail('unexecuted parent full request changed without approval');
    entries.push(structuredClone(prior));
   }else{if(!equal(entry,prior))fail('master-reused parent entry changed without approval');entries.push(entry);}
   continue;
  }
  if(direct&&prior.mode!=='execute'||!direct&&prior.mode!=='reuse')fail('parent journal attempted an inherited key');
  const producer=producerRef(record),history=[...(prior.history??[]),...(direct?[{kind:'parent-attempt',...producer,originalStatus:record.row.status,originalVerdict:record.verdict.verdict}]:[])],replacement=replacements.find(r=>r.key===entry.key);
  if(replacement){
   if(!direct||record.verdict.verdict!=='defect'||replacement.rowSha256!==producer.rowSha256||replacement.producerContractHash!==producer.contractHash||typeof replacement.reason!=='string'||!replacement.reason.trim()||equal(job.request,record.job.request)&&equal(job.callOptions,record.job.callOptions))fail('replacement must bind reviewed failed raw and a changed request');
   usedReplacements.add(entry.key);entries.push({...entry,mode:'execute',category:prior.category,characters:job.characters,reason:replacement.reason,replacement:{...replacement,recording:record.recording},history});continue;
  }
  if(!equal(job.sample,record.job.sample)||job.round!==record.job.round||!equal(job.request,record.job.request)||!equal(job.callOptions,record.job.callOptions))fail('parent response requires identical source/round/full wire/options');
  // Archive validation checks the original producer/review and signed checker result.
  // It must not pretend that the current checker is the archived executable.
  let checked;
  if(currentCandidate)checked=await replayRow(job,record.row);
  else if(record.row.status==='output')checked=archivedOutputRow(record.row);
  else{
   const signed=adjudication?.reviews?.find(r=>r.key===entry.key);
   if(!signed)fail('archived checker recovery requires its original adjudication');
   checked=archivedOutputRow(record.row,signed.checkedText,signed.checkedRanges);
  }
  if(checked.status!=='output')fail('parent response is not usable under the current checker; approved replacement required');
  let recovery;
  if(record.verdict.verdict==='usable'){
   if(record.row.status!=='output'||record.row.text!==checked.text||!equal(record.row.ranges,checked.ranges))fail('usable parent output changed');
  }else{
   if(record.verdict.verdict!=='defect'||record.row.status!=='rejected')fail('only reviewed checker rejections can be adjudicated');
   recovery={key:entry.key,producer,checkedHash:rowHash(checked),checkedText:checked.text,checkedRanges:checked.ranges};recoveries.push(recovery);
  }
  const inherited={key:entry.key,mode:'reuse',characters:job.characters,predecessor:entry.predecessor,checkedHash:rowHash(checked),producer,history};
  if(prior.recovery)inherited.adjudicationHistory=[...(prior.adjudicationHistory??[]),prior.recovery.adjudication];
  else if(prior.adjudicationHistory)inherited.adjudicationHistory=prior.adjudicationHistory;
  if(recovery)inherited.recovery={adjudication:plan.adjudication??null,checkedHash:recovery.checkedHash};entries.push(inherited);
 }
 if(wireChanges&&usedWireChanges.size!==wireChanges.changes.length)fail('unused wire change key');
 if(usedReplacements.size!==replacements.length)fail('unused/unapproved replacement key');
 if(recoveries.length){
  if(!adjudication){if(!preview)fail('independent checker-recovery adjudication required');}
  else{
   if(adjudication.kind!=='NMT-checker-recovery-adjudication'||typeof adjudication.reviewer!=='string'||!adjudication.reviewer.trim()||!equal(adjudication.parentPlan,plan.parent.plan)||!equal(adjudication.checkerArtifacts,plan.candidate.artifactHashes)||!Array.isArray(adjudication.reviews)||adjudication.reviews.length!==recoveries.length)fail('adjudication provenance/checker mismatch');
   const expectedKeys=recoveries.map(r=>r.key).sort();if(!equal(adjudication.reviews.map(r=>r.key).sort(),expectedKeys))fail('adjudication keys missing/duplicate');
   for(const expected of recoveries){const review=adjudication.reviews.find(r=>r.key===expected.key);const{verdict,reason,...bound}=review;if(verdict!=='usable'||typeof reason!=='string'||!reason.trim()||!equal(bound,expected))fail('adjudication raw/result binding or verdict mismatch');}
  }
 }else if(adjudication)fail('unnecessary adjudication');
 return{entries,recoveries,pendingWireApproval};
}
export async function createSuccessorPlan({parentPlan,reviews,replacements,wireChanges,adjudication,ledger,candidate,preview=false}){
 candidate??=await createContract({category:'regression',budgetMode:nmtBudgetMode(ledger,NMT_TEST_PROJECT)});await validateNmtContract(candidate,{aggregate:true});
 const parentRef=fileReference(parentPlan),previous=readReference(parentRef);
 const parent={plan:parentRef,executions:referenceList(planDirectory(previous)),reviews:reviews.map(fileReference)};
 const payload={kind:preview?'NMT-evaluation-preview-NOT-executable':'NMT-evaluation-plan',version:2,candidate,source:previous.source,parent,replacements:fileReference(replacements),...(wireChanges?{wireChanges:fileReference(wireChanges)}:{}),adjudication:adjudication?fileReference(adjudication):null,baselineLedger:ledger};
 const{entries,recoveries,pendingWireApproval}=await deriveSuccessor(payload,{preview});if(wireChanges)payload.pendingWireApproval=pendingWireApproval;payload.entries=entries;payload.costs=totals(entries);payload.pendingAdjudication=recoveries.length&&!adjudication?recoveries.map(r=>r.key):[];preflightBudget(ledger,payload.costs,normalizeNmtBudgetMode(candidate.budgetMode));
 return{...payload,planHash:sha(JSON.stringify(payload))};
}
export async function validateSuccessorPlan(plan,{preview=false,currentCandidate=true,ancestry=[]}={}){
 if(ancestry.includes(plan.planHash)||ancestry.length>=MAX_PLAN_GENERATIONS)fail('cyclic or excessive plan ancestry');
 const{planHash,...payload}=plan;
 if(plan.version!==2||plan.kind!==(preview?'NMT-evaluation-preview-NOT-executable':'NMT-evaluation-plan')||sha(JSON.stringify(payload))!==planHash)fail('successor plan hash/kind mismatch');
 await validateNmtContract(plan.candidate,{aggregate:true,currentCandidate});assertParentManifest(plan);
 const{entries,recoveries,pendingWireApproval}=await deriveSuccessor(plan,{preview,currentCandidate,ancestry:[...ancestry,plan.planHash]});
 if(plan.wireChanges&&!equal(plan.pendingWireApproval,pendingWireApproval))fail('wire change pending approval mismatch');
 if(!equal(entries,plan.entries)||!equal(totals(entries),plan.costs)||!equal(plan.pendingAdjudication,recoveries.length&&!plan.adjudication?recoveries.map(r=>r.key):[]))fail('successor selections/categories/recovery mismatch');
 preflightBudget(plan.baselineLedger,plan.costs,normalizeNmtBudgetMode(plan.candidate.budgetMode));return plan;
}
export async function recoveryAdjudicationTemplate(preview){
 await validateSuccessorPlan(preview,{preview:true});const{recoveries}=await deriveSuccessor(preview,{preview:true});
 return{kind:'NMT-checker-recovery-adjudication',reviewer:'',parentPlan:preview.parent.plan,checkerArtifacts:preview.candidate.artifactHashes,reviews:recoveries.map(row=>({...row,verdict:'pending',reason:''})),note:'Independent reviewer must inspect the original raw/source and current exact-request replay. Original defect review and rejected row remain unchanged; this is not a new provider response.'};
}

// Claims are immutable and checked under the shared checkout execution lock.
// A child takes over remaining keys; no ancestor may dispatch after that claim.
const claimsDirectory=()=>resolve(root,'.local/nmt-plan-successors');
function assertClaims(plan,directory,{allowUnclaimedParent=false}={}){
 const chain=planAncestry(plan);
 if(existsSync(resolve(directory,plan.planHash+'.json')))fail('plan has a successor; ancestor execution is forbidden');
 for(let i=1;i<chain.length;i++){
  const parent=chain[i],child=chain[i-1],path=resolve(directory,parent.planHash+'.json');
  const expected={version:1,parentPlanHash:parent.planHash,successorPlanHash:child.planHash};
  if(!existsSync(path)){if(i===1&&allowUnclaimedParent)continue;fail('ancestor successor claim missing');}
  if(!equal(JSON.parse(readFileSync(path,'utf8')),expected))fail('parent already belongs to another successor execution');
 }
}
export function claimSuccessor(plan,directory=claimsDirectory()){
 assertClaims(plan,directory,{allowUnclaimedParent:true});if(plan.version!==2)return;
 const parent=readReference(plan.parent.plan),path=resolve(directory,parent.planHash+'.json');
 const claim={version:1,parentPlanHash:parent.planHash,successorPlanHash:plan.planHash};
 if(!existsSync(path))saveImmutable(path,claim);return path;
}
export function assertExecutionLineage(plan,directory=claimsDirectory()){
 assertParentManifest(plan);assertClaims(plan,directory);
}
