import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createContract,sha,options,ranges} from './nmt-evaluation-contract.mjs';
import {glossarySpecs} from './nmt-glossary-spec.mjs';
import {initialNmtLedger} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT as project,NMT_TEST_PROJECT_NUMBER as number,NMT_TEST_ACCOUNT as account,NMT_RUNTIME_ACCOUNT as runtime,NMT_TEST_BILLING as billing} from '../lib/nmt-isolation.js';
import {createEvaluationPlan,validateEvaluationPlan,batchContract,preflightBudget,executionLock,assertBatchOwnership,replayRow,readReference,save,mergeEvaluationPlan,validateMergedEvidence,loadPlanExecutions} from './nmt-evaluation-plan.mjs';
import {validateNmtContract} from './nmt-evidence.mjs';
import {NmtGlossaryTranslator} from '../lib/nmt-glossary-translator.js';
import {collectNmtJobs} from './nmt-evaluation-runner.mjs';
const fixtureIdentity={projectId:project,projectNumber:number,principal:account,billingAccount:'billingAccounts/'+billing,billingEnabled:true,runtimeAccount:runtime};
const clone=structuredClone;
const rehash=c=>{const{contractHash,summary,...payload}=c;c.contractHash=sha(JSON.stringify(payload));return c;};
const lock=()=>({project,records:glossarySpecs.map(s=>({direction:s.direction,sha256:sha(readFileSync(new URL('../glossaries/'+s.file,import.meta.url))),resource:{name:'projects/'+project+'/locations/us-central1/glossaries/'+s.id,entryCount:s.count,languagePair:{sourceLanguageCode:s.source,targetLanguageCode:s.target},inputConfig:{gcsSource:{inputUri:'gs://'+project+'-nmt-glossaries/'+s.file}}}}))});
async function fixture(){
 const directory=mkdtempSync(resolve(tmpdir(),'nmt-plan-unit-'));const candidate=await createContract();candidate.glossaryResources=lock();rehash(candidate);
 const contract=clone(candidate);contract.version='nmt-glossary-v1';contract.artifactHashes['src/unit-producer.ts']='a'.repeat(64);
 const results=[];
 for(const [i,job]of contract.jobs.entries()){
  const keep=['short-price-confirmation','code-only'].includes(job.sample.id);
  if(!keep&&job.request){job.request.contents=['<div id="p0">'+job.sample.source.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</div>'];job.characters=[...job.request.contents[0]].length;}
  if(i>=40&&!keep)continue;
  const response={glossaryTranslations:[{translatedText:'<div id="p0">Please check the quotation for this sample batch first, then tell me the result.</div>'}]};
  results.push({key:job.key,id:job.sample.id,aliases:job.sample.aliases,source:job.sample.source,sourceLanguage:job.sample.sourceLanguage,targetLanguage:job.sample.targetLanguage,round:job.round,status:!job.request?'skipped':keep?'output':'rejected',...(!job.request?job.skippedOutput:keep?{text:response.glossaryTranslations[0].translatedText.replace(/<[^>]+>/g,''),ranges:[]}:{reason:'offline-unit-fixture'}),attempts:job.request?[{request:clone(job.request),callOptions:clone(job.callOptions),response}]:[]});
 }
 contract.summary.characters=contract.jobs.reduce((n,j)=>n+j.characters,0);rehash(contract);
 const recording={kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT FIXTURE, NOT LIVE EVIDENCE',identity:fixtureIdentity,contract,contractHash:contract.contractHash,results};
 const recordingPath=resolve(directory,'recording.json'),reviewPath=resolve(directory,'review.json');save(recordingPath,recording);
 const reviews=results.map(r=>({key:r.key,evidenceHash:sha(JSON.stringify({source:r.source,text:r.text,status:r.status,reason:r.reason,attempts:r.attempts})),verdict:['output','skipped'].includes(r.status)?'usable':'defect',reason:'offline unit fixture',issues:[]}));
 save(reviewPath,{resultsSha256:sha(readFileSync(recordingPath)),reviewer:'offline-unit-fixture',reviews});
 return{directory,candidate,recording,recordingPath,reviewPath,async plan(){return createEvaluationPlan({candidate,recording:recordingPath,review:reviewPath,ledger:initialNmtLedger(project)});},cleanup(){rmSync(directory,{recursive:true,force:true});}};
}
test('frozen plan preserves all 336 keys/27 core rounds, source producers and immutable original failures',async()=>{
 const f=await fixture();try{const before=readFileSync(f.recordingPath);const plan=await f.plan();await validateEvaluationPlan(plan);assert.equal(plan.entries.length,336);assert.equal(plan.entries.filter(e=>e.mode==='reuse').length,2);assert.ok(plan.entries.filter(e=>e.category==='retest').every(e=>e.predecessor));assert.ok(plan.entries.filter(e=>e.category==='regression').every(e=>!e.predecessor));assert.deepEqual(readFileSync(f.recordingPath),before);
 const retest=plan.entries.filter(e=>e.category==='retest'),batch=batchContract(plan,retest.slice(0,3).map(e=>e.key));await validateNmtContract(batch);assert.equal(batch.jobs.length,3);assert.equal(batch.evaluationPlanHash,plan.planHash);
 assert.throws(()=>batchContract(plan,[retest[0].key,retest[0].key]));assert.throws(()=>batchContract(plan,[plan.entries.find(e=>e.mode==='reuse').key]));assert.throws(()=>batchContract(plan,[retest[0].key,plan.entries.find(e=>e.category==='regression').key]));
 for(const mutate of [p=>p.entries.pop(),p=>p.entries.find(e=>e.category==='retest').category='regression',p=>p.entries.find(e=>e.mode==='reuse').predecessor.key='other:2',p=>p.candidate.jobs[0].request.model='other']){const bad=clone(plan);mutate(bad);const{planHash,...payload}=bad;bad.planHash=sha(JSON.stringify(payload));await assert.rejects(validateEvaluationPlan(bad));}
 writeFileSync(f.recordingPath,Buffer.concat([before,Buffer.from(' ')]));assert.throws(()=>readReference(plan.source.recording),/changed/);
 }finally{f.cleanup();}
});
test('aggregate completeness cannot bypass execution category caps',async()=>{
 const f=await fixture();try{assert.ok(f.candidate.summary.characters>55000);await assert.rejects(validateNmtContract(f.candidate));await validateNmtContract(f.candidate,{aggregate:true});const short=clone(f.candidate);short.jobs.pop();rehash(short);await assert.rejects(validateNmtContract(short,{aggregate:true}));
 const ledger=initialNmtLedger(project);assert.equal(preflightBudget(ledger,{regression:55000,retest:10000}).used,65000);assert.equal(ledger.used,0);assert.throws(()=>preflightBudget(ledger,{regression:55001}));assert.throws(()=>preflightBudget({...ledger,used:1},{retest:1}));assert.throws(()=>preflightBudget(ledger,{other:1}));
 }finally{f.cleanup();}
});
test('canonical checkout lock excludes another process and never expires automatically',()=>{
 const directory=mkdtempSync(resolve(tmpdir(),'nmt-lock-unit-')),path=resolve(directory,'exclusive.lock');try{const release=executionLock(path);assert.throws(()=>executionLock(path),/lock exists/);
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import{openSync}from'node:fs';try{openSync(process.argv[1],'wx');process.exit(5)}catch(e){if(e.code!=='EEXIST')process.exit(6)}",path],{encoding:'utf8',windowsHide:true});assert.equal(child.status,0);release();const next=executionLock(path);next();
 writeFileSync(path,'crashed-process');assert.throws(()=>executionLock(path),/lock exists/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('unknown/failed attempts and overlapping batches never dispatch again',()=>{
 const batch={contractHash:'one',jobs:[{key:'k:2'}]};for(const status of ['pending','service_error'])assert.throws(()=>assertBatchOwnership(batch,{rows:new Map([['k:2',{evidence:{contractHash:'one'},row:{status}}]])}),/no automatic retry/);
 assert.throws(()=>assertBatchOwnership(batch,{rows:new Map([['k:2',{evidence:{contractHash:'two'},row:{status:'output'}}]])}),/another execution batch/);
 assert.doesNotThrow(()=>assertBatchOwnership(batch,{rows:new Map([['k:2',{evidence:{contractHash:'one'},row:{status:'output'}}]])}));
});
test('collector checkpoints intent/request/raw independently, stops on service error and skips completed keys',async()=>{
 const f=await fixture();try{const job=f.candidate.jobs.find(j=>j.sample.id==='short-price-confirmation'),contract={jobs:[job,{...job,key:job.key+':unit'}]},results=[],events=[];let calls=0;
 await collectNmtJobs({contract,results,checkCandidate(){},save(){events.push(clone(results));},client:{async translateText(){calls++;throw Error('offline simulated service failure');}}});assert.equal(calls,1);assert.equal(results.length,1);assert.equal(events[0][0].attempts.length,0);assert.equal(events[1][0].attempts.length,1);assert.equal(results[0].status,'service_error');
 const success=[],snapshots=[];calls=0;await collectNmtJobs({contract:{jobs:[job]},results:success,checkCandidate(){},save(){snapshots.push(clone(success));},client:{async translateText(){calls++;return[{glossaryTranslations:[{translatedText:'<div id="p0">Please check the quotation for this sample batch first, then tell me the result.</div>'}]}];}}});assert.equal(calls,1);assert.ok(snapshots.some(s=>s[0].status==='pending'&&s[0].attempts[0]?.response));assert.equal(success[0].status,'output');
 await collectNmtJobs({contract:{jobs:[job]},results:success,checkCandidate(){},save(){},client:{async translateText(){throw Error('must not repeat');}}});assert.equal(success.length,1);
 for(const change of [r=>r.attempts=[],r=>delete r.attempts[0].response,r=>r.attempts[0].request.model='foreign',r=>r.attempts[0].callOptions.timeout=1,r=>r.status='pending']){const bad=clone(success[0]);change(bad);await assert.rejects(replayRow(job,bad));}
 }finally{f.cleanup();}
});

test('complete mixed-producer assembly binds each original round/raw and rejects tampering or missing attempts',async()=>{
 const f=await fixture();try{const plan=await f.plan(),directory=resolve(f.directory,'executions');
 await assert.rejects(mergeEvaluationPlan(plan,{directory}),/missing execution key/);
 for(const category of ['regression','retest']){
  const keys=plan.entries.filter(e=>e.category===category).map(e=>e.key),contract=batchContract(plan,keys),results=[];
  for(const job of contract.jobs){const attempts=[];let output,failure;try{output=await new NmtGlossaryTranslator(options,{async translateText(request,callOptions){const response={glossaryTranslations:request.contents.map(translatedText=>({translatedText}))};attempts.push({request,callOptions,response});return[response];}}).translateWithRanges(job.sample.source,job.sample.sourceLanguage,job.sample.targetLanguage,{protectedRanges:ranges(job.sample)});}catch(error){failure=error;}
   assert.ok(output||failure?.reason);results.push({key:job.key,id:job.sample.id,aliases:job.sample.aliases,source:job.sample.source,sourceLanguage:job.sample.sourceLanguage,targetLanguage:job.sample.targetLanguage,round:job.round,status:output?'output':'rejected',attempts,...(output??{reason:failure.reason})});
  }
  save(resolve(directory,contract.contractHash+'.json'),{kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT FIXTURE; NEVER LIVE QUALITY EVIDENCE',contract,contractHash:contract.contractHash,identity:fixtureIdentity,results});
 }
 const merged=await mergeEvaluationPlan(plan,{directory});assert.equal(merged.results.length,336);assert.equal(merged.provenance.filter(p=>p.mode==='reuse').length,2);await validateMergedEvidence(merged,{directory});
 const altered=clone(merged);altered.provenance[0].producerContractHash='0'.repeat(64);await assert.rejects(validateMergedEvidence(altered,{directory}),/mismatch/);
 const executions=await loadPlanExecutions(plan,directory),batch=executions.batches[0],path=batch.reference.path,original=readFileSync(path),bad=clone(batch.evidence);bad.results[0].attempts[0].response.glossaryTranslations[0].translatedText+='tamper';save(path,bad);await assert.rejects(validateMergedEvidence(merged,{directory}));writeFileSync(path,original);
 const missing=clone(batch.evidence);missing.results[0].status='pending';delete missing.results[0].attempts[0].response;save(path,missing);await assert.rejects(mergeEvaluationPlan(plan,{directory}),/Complete recorded provider response/);writeFileSync(path,original);
 const doubled=clone(batch.evidence);doubled.results.push(clone(doubled.results[0]));save(path,doubled);await assert.rejects(loadPlanExecutions(plan,directory),/duplicate/);
 }finally{f.cleanup();}
});
