import {createSuccessorPlan,recoveryAdjudicationTemplate,assertParentManifest,claimSuccessor,assertExecutionLineage} from './nmt-successor-plan.mjs';
import {assertNewOutput,assertOutputLocation,assertCheckpointOutput,saveImmutable,createCheckpointStore} from './nmt-output-safety.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createEvaluationPlan,validateEvaluationPlan,batchContract,loadPlanExecutions,mergeEvaluationPlan,executionLock,assertBatchOwnership,preflightBudget,totals,planDirectory,requireCandidate,equal} from './nmt-evaluation-plan.mjs';
import {collectNmtJobs} from './nmt-evaluation-runner.mjs';
import {validateNmtContract} from './nmt-evidence.mjs';
import {ControlledNmtClient,AuthenticatedNmtTransport} from '../lib/nmt-controlled-client.js';
import {FirestoreNmtBudget,NMT_LEDGER_PATH,normalizeNmtBudgetMode} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT} from '../lib/nmt-isolation.js';
const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const readLedgerInput=path=>{const value=read(path);if(value.kind==='NMT-ledger-migration-preview'&&!process.argv.includes('--preview'))throw Error('Migration preview ledger cannot authorize an actual plan');return value;};
const action=process.argv[2],output=arg('output');if(!output)throw Error('--output required');
const protectedPaths=['recording','review','ledger','plan','freeze','keys','parent-plan','parent-review','replacements','wire-changes','adjudication'].map(arg).filter(Boolean);
if(action==='execute')assertOutputLocation(output,protectedPaths);else assertNewOutput(output,protectedPaths);
if(action==='prepare-successor'){
 const ledgerRecord=readLedgerInput(arg('ledger'));const reviews=process.argv.filter(x=>x.startsWith('--parent-review=')).map(x=>x.slice('--parent-review='.length));
 const plan=await createSuccessorPlan({parentPlan:arg('parent-plan'),reviews,replacements:arg('replacements'),wireChanges:arg('wire-changes'),adjudication:arg('adjudication'),ledger:ledgerRecord.ledger??ledgerRecord,preview:process.argv.includes('--preview')});saveImmutable(resolve(output),plan);console.log(JSON.stringify({kind:plan.kind,planHash:plan.planHash,costs:plan.costs,reused:plan.entries.filter(e=>e.mode==='reuse').length,pendingAdjudication:plan.pendingAdjudication}));
}else if(action==='adjudication-template'){saveImmutable(resolve(output),await recoveryAdjudicationTemplate(read(arg('plan'))));
}else if(action==='prepare'){
 const ledgerRecord=readLedgerInput(arg('ledger'));const plan=await createEvaluationPlan({recording:arg('recording'),review:arg('review'),ledger:ledgerRecord.ledger??ledgerRecord,preview:process.argv.includes('--preview')});saveImmutable(resolve(output),plan);console.log(JSON.stringify({kind:plan.kind,planHash:plan.planHash,costs:plan.costs,reused:plan.entries.filter(e=>e.mode==='reuse').length,fullCandidate:plan.candidate.summary}));
}else if(['batch','execute','merge'].includes(action)){
 const plan=read(arg('plan'));await validateEvaluationPlan(plan);
 if(action==='merge'){saveImmutable(resolve(output),await mergeEvaluationPlan(plan));}
 else if(action==='batch'){
  const executions=await loadPlanExecutions(plan);let keys;
  if(arg('keys'))keys=read(arg('keys'));else if(process.argv.includes('--remaining')&&['regression','retest'].includes(arg('category')))keys=plan.entries.filter(e=>e.mode==='execute'&&e.category===arg('category')&&!executions.rows.has(e.key)).map(e=>e.key);else throw Error('--keys JSON list or --remaining with explicit --category required');
  const batch=batchContract(plan,keys);assertBatchOwnership(batch,executions);await validateNmtContract(batch);saveImmutable(resolve(output),batch);console.log(JSON.stringify({contractHash:batch.contractHash,category:batch.category,...batch.summary}));
 }else{
  if(!process.argv.includes('--execute'))throw Error('Explicit --execute required');
  const batch=read(arg('freeze'));if(!equal(batch,batchContract(plan,batch.jobs.map(j=>j.key))))throw Error('Frozen batch mismatch');await validateNmtContract(batch);
  const canonical=resolve(planDirectory(plan),batch.contractHash+'.json');
  const checkpointArgs={canonical,mirror:output,planHash:plan.planHash,contractHash:batch.contractHash,protectedPaths:[...protectedPaths,plan.source.recording.path,plan.source.review.path]};
  assertCheckpointOutput(checkpointArgs);
  const release=executionLock();let db,store;
  try{
   assertParentManifest(plan);claimSuccessor(plan);assertExecutionLineage(plan);
   const executions=await loadPlanExecutions(plan);assertBatchOwnership(batch,executions);
   store=createCheckpointStore(checkpointArgs);
   const {requireProjectArgument,verifyLocalTarget,verifyGlossaries}=await import('./nmt-local-guard.mjs');requireProjectArgument();const identity=await verifyLocalTarget();await verifyGlossaries(plan.candidate.glossaryResources);
   const {initializeApp}=await import('firebase-admin/app');const {getFirestore}=await import('firebase-admin/firestore');db=getFirestore(initializeApp({projectId:NMT_TEST_PROJECT}));
   const ledger=(await db.doc(NMT_LEDGER_PATH).get()).data();const remaining=plan.entries.filter(e=>e.mode==='execute'&&!executions.rows.has(e.key));preflightBudget(ledger,totals(remaining),normalizeNmtBudgetMode(batch.budgetMode));preflightBudget(ledger,totals(remaining.filter(e=>batch.jobs.some(j=>j.key===e.key))),normalizeNmtBudgetMode(batch.budgetMode));
   const evidence=store.initial??{kind:'NMT-live-synthetic',startedAt:new Date().toISOString(),contractHash:batch.contractHash,contract:batch,identity,results:[],reviewStatus:'pending-full-text-review'};
   // Canonical journal is mandatory, independent of the user-facing output path.
   const checkpoint=()=>store.checkpoint(evidence);checkpoint();
   const transport=new AuthenticatedNmtTransport(),client=new ControlledNmtClient(transport,new FirestoreNmtBudget(db,NMT_TEST_PROJECT),batch.category,()=>transport.identity());
   await collectNmtJobs({contract:batch,results:evidence.results,client,save:checkpoint,checkCandidate:()=>{requireCandidate(batch);assertExecutionLineage(plan);}});checkpoint();
   console.log(JSON.stringify({output,canonical,completed:evidence.results.length,expected:batch.jobs.length,complete:evidence.results.length===batch.jobs.length&&!evidence.results.some(r=>['pending','service_error'].includes(r.status))}));
  }finally{try{if(db)await db.terminate();}finally{store?.close();release();}}
 }
}else throw Error('Use prepare, prepare-successor, adjudication-template, batch, execute or merge');
