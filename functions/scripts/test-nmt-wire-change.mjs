import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {resolve} from 'node:path';
import {createContract,sha} from './nmt-evaluation-contract.mjs';
import {initialNmtLedger,trackingOnlyMigration} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT as project,NMT_TEST_PROJECT_NUMBER as number,NMT_TEST_ACCOUNT as account,NMT_RUNTIME_ACCOUNT as runtime,NMT_TEST_BILLING as billing} from '../lib/nmt-isolation.js';
import {fileReference,deriveEntries,totals,save,batchContract,planDirectory,validateEvaluationPlan,rowHash,archivedOutputRow} from './nmt-evaluation-plan.mjs';
import {createSuccessorPlan,wireChangeApprovalTemplate,claimSuccessor,assertExecutionLineage} from './nmt-successor-plan.mjs';
const identity={projectId:project,projectNumber:number,principal:account,billingAccount:'billingAccounts/'+billing,billingEnabled:true,runtimeAccount:runtime};
const ledger=()=>trackingOnlyMigration(initialNmtLedger(project),project,'2026-09-25T00:00:00.000Z').ledger;
const hashPlan=p=>({...p,planHash:sha(JSON.stringify(p))});
async function fixture(inherited=false){
 const directory=mkdtempSync(resolve(tmpdir(),'nmt-wire-change-unit-')),journals=[];
 try{
 const candidate=await createContract({budgetMode:'tracking-only'}),old=structuredClone(candidate);old.version='nmt-glossary-v20';old.artifactHashes['unit-fixture']=sha(directory);
 for(const job of old.jobs)if(job.request?.sourceLanguageCode==='en'){job.request.contents=job.request.contents.map(s=>s.replace(/<span class="notranslate"(?= translate="no" id="o\d+">(?:Alex|Mira|Wei|Kumar|Kumaran|Shan|Niranjan|Eric|Kash)<\/span>)/gu,'<span').replace('confirm what is covered by it','confirm what it covers'));job.characters=job.request.contents.reduce((n,s)=>n+[...s].length,0);}
 old.summary.characters=old.jobs.reduce((n,j)=>n+j.characters,0);const{contractHash,summary,...payload}=old;old.contractHash=sha(JSON.stringify(payload));
 const master=resolve(directory,'master.json'),review=resolve(directory,'master-review.json');save(master,{kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT ONLY',identity,contract:old,contractHash:old.contractHash,results:[]});save(review,{resultsSha256:fileReference(master).sha256,reviewer:'OFFLINE UNIT',reviews:[]});
 const source={recording:fileReference(master),review:fileReference(review)},entries=await deriveEntries(old,source,{replayOutputs:false});let parent=hashPlan({kind:'NMT-evaluation-plan',version:1,candidate:old,source,baselineLedger:ledger(),entries,costs:totals(entries)});
 const firstPlan=resolve(directory,'parent-v1.json');save(firstPlan,parent);await validateEvaluationPlan(parent,{currentCandidate:false});
 const key=old.jobs.find(j=>j.sample.id==='sales-account-owner').key,batch=batchContract(parent,[key]),job=batch.jobs[0];
 const text='Mira是該客戶的客戶業務負責人。Alex是業務代表；Mira必須核准報價。';
 const translatedText='<div id="p0"><span translate="no" id="o0">Mira</span>是該客戶的客戶業務負責人。<span translate="no" id="o1">Alex</span>是業務代表；<span translate="no" id="o2">Mira</span>必須核准報價。</div>';
 const row={key,id:job.sample.id,aliases:job.sample.aliases,source:job.sample.source,sourceLanguage:job.sample.sourceLanguage,targetLanguage:job.sample.targetLanguage,round:job.round,status:'output',text,ranges:[],attempts:[{request:job.request,callOptions:job.callOptions,response:{glossaryTranslations:[{translatedText}]}}]};
 const journal=resolve(planDirectory(parent),batch.contractHash+'.json');journals.push(planDirectory(parent));save(journal,{kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT ONLY',identity,contract:batch,contractHash:batch.contractHash,results:[row]});
 const parentReview=resolve(directory,'parent-review.json');save(parentReview,{resultsSha256:fileReference(journal).sha256,reviewer:'OFFLINE UNIT',reviews:[{key,evidenceHash:sha(JSON.stringify({source:row.source,text:row.text,status:row.status,reason:row.reason,attempts:row.attempts})),verdict:'usable',reason:'OFFLINE UNIT explicit correct roles',issues:[]}]});
 const replacements=resolve(directory,'replacements.json');save(replacements,[]);let parentPlan=firstPlan,reviews=[parentReview];
 if(inherited){
  const producer={recording:fileReference(journal),contractHash:batch.contractHash,key,rowSha256:rowHash(row),review:fileReference(parentReview)};
  const childEntries=structuredClone(entries),position=childEntries.findIndex(e=>e.key===key),base=childEntries[position];childEntries[position]={key,mode:'reuse',characters:job.characters,predecessor:base.predecessor,checkedHash:rowHash(archivedOutputRow(row)),producer,history:[{kind:'parent-attempt',...producer,originalStatus:'output',originalVerdict:'usable'}]};
  parent=hashPlan({kind:'NMT-evaluation-plan',version:2,candidate:old,source,parent:{plan:fileReference(firstPlan),executions:[fileReference(journal)],reviews:[fileReference(parentReview)]},replacements:fileReference(replacements),adjudication:null,baselineLedger:ledger(),entries:childEntries,costs:totals(childEntries),pendingAdjudication:[]});
  parentPlan=resolve(directory,'parent-v2.json');save(parentPlan,parent);await validateEvaluationPlan(parent,{currentCandidate:false});reviews=[];
 }
 const template=await wireChangeApprovalTemplate({parentPlan,reviews,candidate});for(const item of template.changes)item.reason='OFFLINE UNIT explicit person HTML protection or neutral passive change';
 const wireChanges=resolve(directory,'wire-changes.json');save(wireChanges,template);
 return{directory,parent,key,row,journal,parentReview,template,wireChanges,args:{parentPlan,reviews,replacements,wireChanges,ledger:ledger(),candidate},cleanup(){rmSync(directory,{recursive:true,force:true});for(const p of journals)rmSync(p,{recursive:true,force:true});}};
 }catch(e){rmSync(directory,{recursive:true,force:true});for(const p of journals)rmSync(p,{recursive:true,force:true});throw e;}
}
for(const inherited of [false,true])test('wire invalidation retains '+(inherited?'inherited':'direct')+' usable producer and explicit not-started keys',async()=>{
 const f=await fixture(inherited);try{
 const bytes=readFileSync(f.journal),preview=await createSuccessorPlan({...f.args,preview:true});assert.ok(preview.pendingWireApproval.length>1);await assert.rejects(createSuccessorPlan(f.args),/explicit wire change approval/);await assert.rejects(validateEvaluationPlan(preview),/hash\/kind/);
 const record=f.template.changes.find(r=>r.key===f.key);assert.equal(record.prior.state,'recorded');assert.equal(record.prior.originalVerdict,'usable');assert.equal(record.prior.producer.rowSha256,rowHash(f.row));assert.ok(f.template.changes.some(r=>r.prior.state==='not-started'));
 const entry=preview.entries.find(e=>e.key===f.key);assert.equal(entry.mode,'execute');assert.equal(entry.category,inherited?'retest':'regression');assert.equal(entry.history.at(-1).originalVerdict,'usable');if(inherited)assert.equal(entry.history[0].kind,'parent-attempt');assert.equal(preview.entries.length,336);
 const approved=structuredClone(f.template);for(const row of approved.changes){row.approval='approved';row.approvedBy='OFFLINE UNIT APPROVAL';}save(f.wireChanges,approved);
 const actual=await createSuccessorPlan(f.args);await validateEvaluationPlan(actual);assert.deepEqual(actual.pendingWireApproval,[]);assert.deepEqual(readFileSync(f.journal),bytes);
 const claims=resolve(f.directory,'claims');if(inherited)claimSuccessor(f.parent,claims);claimSuccessor(actual,claims);assertExecutionLineage(actual,claims);assert.throws(()=>assertExecutionLineage(f.parent,claims),/ancestor execution/);
 const manifestBytes=readFileSync(f.wireChanges);writeFileSync(f.wireChanges,Buffer.concat([manifestBytes,Buffer.from(' ')]));await assert.rejects(validateEvaluationPlan(actual),/evidence changed/);writeFileSync(f.wireChanges,manifestBytes);
 }finally{f.cleanup();}
});
test('wire-change evidence cannot omit approvals, rebind source/options/producer or manufacture unstarted history',async()=>{
 const f=await fixture();try{
 for(const mutate of [m=>m.changes[0].previousRequestHash='a'.repeat(64),m=>m.changes[0].candidateRequestHash='b'.repeat(64),m=>m.changes[0].sampleHash='c'.repeat(64),m=>m.changes[0].round=2,m=>m.changes[0].reason='',m=>m.changes.push(m.changes[0]),m=>m.parentPlan.sha256='d'.repeat(64),m=>m.changes.find(r=>r.key===f.key).prior={state:'not-started'},m=>m.changes.find(r=>r.prior.state==='not-started').prior={state:'recorded'},m=>m.changes[0].key='absent:1']){
 const changed=structuredClone(f.template);mutate(changed);save(f.wireChanges,changed);await assert.rejects(createSuccessorPlan({...f.args,preview:true}));}
 save(f.wireChanges,f.template);await assert.rejects(createSuccessorPlan({...f.args,wireChanges:undefined,preview:true}));
 const unchanged=f.args.candidate.jobs.find(j=>!f.template.changes.some(r=>r.key===j.key)&&j.request);const fake=structuredClone(f.template);fake.changes.push({...fake.changes[0],key:unchanged.key});save(f.wireChanges,fake);await assert.rejects(createSuccessorPlan({...f.args,preview:true}),/changed full request/);
 }finally{f.cleanup();}
});