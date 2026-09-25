import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import{resolve}from'node:path';
import {createContract,sha,options,ranges} from './nmt-evaluation-contract.mjs';
import {initialNmtLedger,reserveNmtLedger} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT as project,NMT_TEST_PROJECT_NUMBER as number,NMT_TEST_ACCOUNT as account,NMT_RUNTIME_ACCOUNT as runtime,NMT_TEST_BILLING as billing} from '../lib/nmt-isolation.js';
import {fileReference,deriveEntries,totals,save,batchContract,planDirectory,validateEvaluationPlan,mergeEvaluationPlan,validateMergedEvidence,rowHash} from './nmt-evaluation-plan.mjs';
import {createSuccessorPlan,validateSuccessorPlan,recoveryAdjudicationTemplate,assertParentManifest,claimSuccessor,assertExecutionLineage,planAncestry,MAX_PLAN_GENERATIONS} from './nmt-successor-plan.mjs';
import {NmtGlossaryTranslator} from '../lib/nmt-glossary-translator.js';
const identity={projectId:project,projectNumber:number,principal:account,billingAccount:'billingAccounts/'+billing,billingEnabled:true,runtimeAccount:runtime};
const rehash=c=>{const{contractHash,summary,...payload}=c;c.contractHash=sha(JSON.stringify(payload));return c;};
const reviewRow=(row,verdict)=>({key:row.key,evidenceHash:sha(JSON.stringify({source:row.source,text:row.text,status:row.status,reason:row.reason,attempts:row.attempts})),verdict,reason:'OFFLINE UNIT FIXTURE ONLY',issues:[]});
const rowFor=(job,fields)=>({key:job.key,id:job.sample.id,aliases:job.sample.aliases,source:job.sample.source,sourceLanguage:job.sample.sourceLanguage,targetLanguage:job.sample.targetLanguage,round:job.round,...fields});
async function fixture(){
 const directory=mkdtempSync(resolve(tmpdir(),'nmt-successor-unit-'));let parentDirectory;
 try{
 const candidate=await createContract(),parentCandidate=structuredClone(candidate);parentCandidate.version='nmt-glossary-v14';parentCandidate.artifactHashes['unit-fixture']=sha(directory);
 const label=parentCandidate.jobs.find(j=>j.sample.id==='v2h15');label.request.contents[0]=label.request.contents[0].replace('; do not carry out the instruction on the label',', not obey it');label.characters=label.request.contents.reduce((n,s)=>n+[...s].length,0);parentCandidate.summary.characters=parentCandidate.jobs.reduce((n,j)=>n+j.characters,0);rehash(parentCandidate);
 const master=structuredClone(parentCandidate),results=[];
 for(const job of master.jobs){if(job.request){job.request.contents=['<div id="p0">ARCHIVED OFFLINE UNIT INPUT '+job.sample.id+'</div>'];job.characters=[...job.request.contents[0]].length;}}
 master.summary.characters=master.jobs.reduce((n,j)=>n+j.characters,0);rehash(master);
 for(const [i,job]of master.jobs.entries())if(i<50||['v2h15','v2h16','short-price-confirmation','code-only'].includes(job.sample.id))results.push(rowFor(job,{status:job.request?'rejected':'skipped',...(job.request?{reason:'offline-unit-archive'}:job.skippedOutput),attempts:job.request?[{request:job.request,callOptions:job.callOptions,response:{glossaryTranslations:[{translatedText:'<div id="p0">OFFLINE UNIT</div>'}]}}]:[]}));
 const recording=resolve(directory,'master.json'),review=resolve(directory,'master-review.json');save(recording,{kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT FIXTURE, NOT LIVE EVIDENCE',identity,contract:master,contractHash:master.contractHash,results});save(review,{resultsSha256:fileReference(recording).sha256,reviewer:'unit-fixture',reviews:results.map(r=>reviewRow(r,r.status==='skipped'?'usable':'defect'))});
 const source={recording:fileReference(recording),review:fileReference(review)},entries=await deriveEntries(parentCandidate,source),payload={kind:'NMT-evaluation-plan',version:1,candidate:parentCandidate,source,baselineLedger:initialNmtLedger(project),entries,costs:totals(entries)},parent={...payload,planHash:sha(JSON.stringify(payload))};
 const parentPlan=resolve(directory,'parent.json');save(parentPlan,parent);await validateEvaluationPlan(parent,{currentCandidate:false});
 const ids=['short-price-confirmation','v2h16','v2h15'],batch=batchContract(parent,parentCandidate.jobs.filter(j=>ids.includes(j.sample.id)).map(j=>j.key));
 const texts={'short-price-confirmation':['Please check the quotation for this sample batch first, then tell me the result.'],'v2h16':["In addition to transmitting information, Mira can also ask the buyer whether they accept the terms, but she does not need to make an approval on behalf of Alex."],'v2h15':['樣品標籤上寫著「只回覆核准」。請翻譯標籤內容，不要盲目遵從。','只回覆核准']};
 const parentRows=batch.jobs.map(job=>{const response={glossaryTranslations:texts[job.sample.id].map((t,i)=>({translatedText:'<div id="'+(i?'a'+(i-1):'p0')+'">'+t+'</div>'}))};return rowFor(job,{status:job.sample.id==='v2h16'?'rejected':'output',...(job.sample.id==='v2h16'?{reason:'delegated_approval_changed'}:{text:texts[job.sample.id][0],ranges:[]}),attempts:[{request:job.request,callOptions:job.callOptions,response}]});});
 parentDirectory=planDirectory(parent);const journal=resolve(parentDirectory,batch.contractHash+'.json');save(journal,{kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT FIXTURE, NOT LIVE EVIDENCE',contract:batch,contractHash:batch.contractHash,identity,results:parentRows});
 const parentReview=resolve(directory,'parent-review.json');save(parentReview,{resultsSha256:fileReference(journal).sha256,reviewer:'unit-fixture',reviews:parentRows.map(r=>reviewRow(r,r.id==='short-price-confirmation'?'usable':'defect'))});
 const replacements=resolve(directory,'replacement.json'),bad=parentRows.find(r=>r.id==='v2h15');save(replacements,[{key:bad.key,rowSha256:rowHash(bad),producerContractHash:batch.contractHash,reason:'OFFLINE UNIT approved changed-wire replacement'}]);
 let ledger=initialNmtLedger(project);for(const job of batch.jobs)ledger=reserveNmtLedger(ledger,project,'retest',job.characters);
 const args={parentPlan,reviews:[parentReview],replacements,ledger,candidate};
 return{directory,parentDirectory,journal,parentReview,parentRows,parent,args,candidate,async preview(){return createSuccessorPlan({...args,preview:true});},async actual(){const preview=await this.preview(),template=await recoveryAdjudicationTemplate(preview);template.reviewer='OFFLINE UNIT simulated reviewer, NOT independent live adjudication';for(const r of template.reviews){r.verdict='usable';r.reason='OFFLINE UNIT confirmed recovered checker result';}const adjudication=resolve(directory,'adjudication.json');save(adjudication,template);return createSuccessorPlan({...args,adjudication});},cleanup(){rmSync(directory,{recursive:true,force:true});if(parentDirectory)rmSync(parentDirectory,{recursive:true,force:true});}};
 }catch(e){rmSync(directory,{recursive:true,force:true});if(parentDirectory)rmSync(parentDirectory,{recursive:true,force:true});throw e;}
}
test('successor preview is not executable; adjudication binds original rejected raw and current exact replay',async()=>{
 const f=await fixture();try{
  const original=readFileSync(f.journal),preview=await f.preview();assert.equal(preview.pendingAdjudication.length,1);assert.equal(preview.entries.filter(e=>e.producer).length,2);await assert.rejects(validateEvaluationPlan(preview),/hash\/kind/);await assert.rejects(createSuccessorPlan(f.args),/adjudication required/);
  const template=await recoveryAdjudicationTemplate(preview),file=resolve(f.directory,'pending.json');save(file,template);await assert.rejects(createSuccessorPlan({...f.args,adjudication:file}),/provenance/);
  const plan=await f.actual();await validateEvaluationPlan(plan);
  const claims=resolve(f.directory,"claims");const claim=claimSuccessor(plan,claims);assert.equal(claimSuccessor(plan,claims),claim);assert.throws(()=>claimSuccessor({...plan,planHash:"a".repeat(64)},claims),/another successor/);assert.equal(plan.entries.length,336);assert.equal(plan.entries.filter(e=>e.replacement).length,1);assert.equal(plan.entries.filter(e=>e.recovery).length,1);assert.deepEqual(readFileSync(f.journal),original);
  const inherited=plan.entries.find(e=>e.recovery);assert.throws(()=>batchContract(plan,[inherited.key]),/not authorized/);
  for(const change of [x=>x.reviews[0].checkedHash='a'.repeat(64),x=>x.reviews[0].producer.rowSha256='b'.repeat(64),x=>x.reviews.push(x.reviews[0]),x=>x.reviews[0].verdict='pending',x=>x.checkerArtifacts.fake='c'.repeat(64)]){const bad=structuredClone(template);bad.reviewer='unit';bad.reviews[0].verdict='usable';bad.reviews[0].reason='unit';change(bad);save(file,bad);await assert.rejects(createSuccessorPlan({...f.args,adjudication:file}));}
 }finally{f.cleanup();}
});
test('parent manifest and approved replacement are immutable, complete and cannot hide duplicate/failed attempts',async()=>{
 const f=await fixture();try{
  const plan=await f.actual(),original=readFileSync(f.journal);writeFileSync(f.journal,Buffer.concat([original,Buffer.from(' ')]));assert.throws(()=>assertParentManifest(plan),/manifest changed/);writeFileSync(f.journal,original);
  const extra=resolve(f.parentDirectory,'extra.json');copyFileSync(f.journal,extra);assert.throws(()=>assertParentManifest(plan),/manifest changed/);rmSync(extra);
  rmSync(f.journal);assert.throws(()=>assertParentManifest(plan),/manifest changed/);writeFileSync(f.journal,original);
  const replacement=JSON.parse(readFileSync(f.args.replacements));for(const mutate of [r=>r.push(r[0]),r=>r[0].rowSha256='a'.repeat(64),r=>r[0].key='absent:1',r=>r.splice(0)]){const bad=structuredClone(replacement);mutate(bad);save(f.args.replacements,bad);await assert.rejects(f.preview());}save(f.args.replacements,replacement);
  for(const mutate of [p=>p.entries.find(e=>e.category==='retest').category='regression',p=>p.entries.pop(),p=>p.parent.executions=[],p=>p.entries.find(e=>e.producer).producer.contractHash='bad']){const bad=structuredClone(plan);mutate(bad);const{planHash,...payload}=bad;bad.planHash=sha(JSON.stringify(payload));await assert.rejects(validateEvaluationPlan(bad));}
 }finally{f.cleanup();}
});
test('successor merge retains master, recovered parent producer and failed replacement lineage without relabeling',async()=>{
 const f=await fixture();try{
  const plan=await f.actual(),directory=resolve(f.directory,'executions');await assert.rejects(mergeEvaluationPlan(plan,{directory}),/missing execution key/);
  for(const category of ['regression','retest']){
   const contract=batchContract(plan,plan.entries.filter(e=>e.mode==='execute'&&e.category===category).map(e=>e.key)),results=[];
   for(const job of contract.jobs){const attempts=[];let output,failure;try{output=await new NmtGlossaryTranslator(options,{async translateText(request,callOptions){const response={glossaryTranslations:request.contents.map(translatedText=>({translatedText}))};attempts.push({request,callOptions,response});return[response];}}).translateWithRanges(job.sample.source,job.sample.sourceLanguage,job.sample.targetLanguage,{protectedRanges:ranges(job.sample)});}catch(e){failure=e;}assert.ok(output||failure?.reason);results.push(rowFor(job,{status:output?'output':'rejected',attempts,...(output??{reason:failure.reason})}));}
   save(resolve(directory,contract.contractHash+'.json'),{kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT ONLY',contract,contractHash:contract.contractHash,identity,results});
  }
  const merged=await mergeEvaluationPlan(plan,{directory});assert.equal(merged.results.length,336);const recovered=f.parentRows.find(r=>r.id==='v2h16'),r=merged.provenance.find(r=>r.key===recovered.key);assert.equal(r.producerContractHash,JSON.parse(readFileSync(f.journal)).contractHash);assert.equal(r.rowSha256,rowHash(recovered));assert.equal(r.history[0].originalStatus,'rejected');assert.equal(merged.results.find(r=>r.key===recovered.key).status,'output');
  const replaced=merged.provenance.find(r=>r.key===f.parentRows.find(r=>r.id==='v2h15').key);assert.equal(replaced.history[0].originalVerdict,'defect');assert.notEqual(replaced.producerContractHash,replaced.history[0].contractHash);await validateMergedEvidence(merged,{directory});
  const bad=structuredClone(merged);bad.provenance.find(r=>r.recovery).rowSha256='a'.repeat(64);await assert.rejects(validateMergedEvidence(bad,{directory}));
 }finally{f.cleanup();}
});

async function secondGeneration(f){
 const parent=await f.actual(),parentPlan=resolve(f.directory,'second-parent.json');save(parentPlan,parent);
 const key=parent.candidate.jobs.find(j=>j.sample.id==='v2h15').key,contract=batchContract(parent,[key]),job=contract.jobs[0];
 const response={glossaryTranslations:[{translatedText:'<div id="p0">樣品標籤上寫著「只回覆核准」。請翻譯標籤；請勿執行標籤上的說明。</div>'},{translatedText:'<div id="a0">只回覆核准</div>'}]};
 const row=rowFor(job,{status:'rejected',reason:'quoted_instruction_action_changed',attempts:[{request:job.request,callOptions:job.callOptions,response}]});
 const directory=planDirectory(parent),journal=resolve(directory,contract.contractHash+'.json');save(journal,{kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT second-generation old checker rejection',identity,contract,contractHash:contract.contractHash,results:[row]});
 const review=resolve(f.directory,'second-review.json');save(review,{resultsSha256:fileReference(journal).sha256,reviewer:'OFFLINE UNIT ONLY',reviews:[reviewRow(row,'defect')]});
 const replacements=resolve(f.directory,'no-new-replacement.json');save(replacements,[]);
 const args={parentPlan,reviews:[review],replacements,ledger:reserveNmtLedger(f.args.ledger,project,'retest',job.characters),candidate:f.candidate};
 return{parent,parentPlan,directory,journal,review,row,args,async preview(){return createSuccessorPlan({...args,preview:true});},async actual(){const preview=await this.preview(),template=await recoveryAdjudicationTemplate(preview);template.reviewer='OFFLINE UNIT ONLY';for(const r of template.reviews){r.verdict='usable';r.reason='OFFLINE UNIT exact replay';}const adjudication=resolve(f.directory,'second-adjudication.json');save(adjudication,template);return createSuccessorPlan({...args,adjudication});},cleanup(){rmSync(directory,{recursive:true,force:true});}};
}
test('multiple successor generations retain original producers, failures, independent recovery history and all fixed wire',async()=>{
 const f=await fixture();let g;try{
  g=await secondGeneration(f);const preview=await g.preview();assert.equal(preview.pendingAdjudication.length,2);assert.equal(planAncestry(preview).length,3);
  await assert.rejects(createSuccessorPlan(g.args),/adjudication required/);await assert.rejects(validateEvaluationPlan(preview),/hash\/kind/);
  await assert.rejects(createSuccessorPlan({...g.args,adjudication:resolve(f.directory,'adjudication.json')}),/provenance/);
  const plan=await g.actual();await validateEvaluationPlan(plan);await validateEvaluationPlan(plan,{currentCandidate:false});
  assert.equal(plan.entries.filter(e=>e.mode==='reuse').length,g.parent.entries.filter(e=>e.mode==='reuse').length+1);
  const label=plan.entries.find(e=>e.key===g.row.key);assert.equal(label.mode,'reuse');assert.equal(label.producer.rowSha256,rowHash(g.row));assert.equal(label.history.length,2);assert.equal(label.history[0].originalStatus,'output');assert.equal(label.history[1].originalStatus,'rejected');
  const approval=plan.entries.find(e=>e.adjudicationHistory);assert.equal(approval.adjudicationHistory.length,1);assert.deepEqual(approval.adjudicationHistory[0],g.parent.entries.find(e=>e.key===approval.key).recovery.adjudication);
  assert.deepEqual(plan.candidate.jobs,g.parent.candidate.jobs);assert.equal(plan.costs.retest,g.parent.costs.retest-g.row.attempts[0].request.contents.reduce((n,s)=>n+[...s].length,0));
  assert.throws(()=>batchContract(plan,[g.row.key]),/not authorized/);
  const mergedDirectory=resolve(f.directory,'second-merge');
  for(const category of ['regression','retest']){
   const contract=batchContract(plan,plan.entries.filter(e=>e.mode==='execute'&&e.category===category).map(e=>e.key)),results=[];
   for(const job of contract.jobs){const attempts=[];let output,failure;try{output=await new NmtGlossaryTranslator(options,{async translateText(request,callOptions){const response={glossaryTranslations:request.contents.map(translatedText=>({translatedText}))};attempts.push({request,callOptions,response});return[response];}}).translateWithRanges(job.sample.source,job.sample.sourceLanguage,job.sample.targetLanguage,{protectedRanges:ranges(job.sample)});}catch(e){failure=e;}assert.ok(output||failure?.reason);results.push(rowFor(job,{status:output?'output':'rejected',attempts,...(output??{reason:failure.reason})}));}
   save(resolve(mergedDirectory,contract.contractHash+'.json'),{kind:'NMT-live-synthetic',qualification:'OFFLINE UNIT ONLY',contract,contractHash:contract.contractHash,identity,results});
  }
  const merged=await mergeEvaluationPlan(plan,{directory:mergedDirectory});assert.equal(merged.results.length,336);assert.deepEqual(merged.provenance.find(r=>r.key===approval.key).adjudicationHistory,approval.adjudicationHistory);assert.equal(merged.provenance.find(r=>r.key===g.row.key).rowSha256,rowHash(g.row));await validateMergedEvidence(merged,{directory:mergedDirectory});

  const changed=structuredClone(plan);changed.candidate.artifactHashes.fake='a'.repeat(64);rehash(changed.candidate);const{planHash,...payload}=changed;changed.planHash=sha(JSON.stringify(payload));await assert.rejects(validateEvaluationPlan(changed),/candidate artifact mismatch/);
 }finally{g?.cleanup();f.cleanup();}
});
test('multi-generation execution claims forbid ancestor continuation, siblings and missing/tampered ancestry',async()=>{
 const f=await fixture();let g;try{
  g=await secondGeneration(f);const child=await g.actual(),claims=resolve(f.directory,'chain-claims');
  assert.throws(()=>claimSuccessor(child,claims),/ancestor successor claim missing/);
  const oldClaim=claimSuccessor(g.parent,claims),oldBytes=readFileSync(oldClaim);assertExecutionLineage(g.parent,claims);
  const claim=claimSuccessor(child,claims);assert.equal(claimSuccessor(child,claims),claim);assertExecutionLineage(child,claims);
  assert.deepEqual(readFileSync(oldClaim),oldBytes);assert.throws(()=>assertExecutionLineage(g.parent,claims),/ancestor execution/);assert.throws(()=>claimSuccessor(g.parent,claims),/ancestor execution/);assert.throws(()=>assertExecutionLineage(f.parent,claims),/ancestor execution/);
  assert.throws(()=>claimSuccessor({...child,planHash:'c'.repeat(64)},claims),/another successor/);
  const bytes=readFileSync(oldClaim);rmSync(oldClaim);assert.throws(()=>assertExecutionLineage(child,claims),/claim missing/);writeFileSync(oldClaim,bytes);
  const wrong=JSON.parse(bytes);wrong.successorPlanHash='b'.repeat(64);save(oldClaim,wrong);assert.throws(()=>assertExecutionLineage(child,claims),/another successor/);writeFileSync(oldClaim,bytes);
 }finally{g?.cleanup();f.cleanup();}
});
test('every ancestor manifest, review, adjudication and producer remains immutable and cannot hide duplicates',async()=>{
 const f=await fixture();let g;try{
  g=await secondGeneration(f);const plan=await g.actual();
  for(const path of [f.journal,f.parentReview,resolve(f.directory,'adjudication.json'),g.parentPlan,g.journal,g.review]){const bytes=readFileSync(path);writeFileSync(path,Buffer.concat([bytes,Buffer.from(' ')]));await assert.rejects(validateEvaluationPlan(plan));writeFileSync(path,bytes);}
  const extra=resolve(f.parentDirectory,'extra.json');copyFileSync(f.journal,extra);await assert.rejects(validateEvaluationPlan(plan),/manifest changed/);rmSync(extra);
  const bytes=readFileSync(g.journal);rmSync(g.journal);await assert.rejects(validateEvaluationPlan(plan),/manifest changed/);writeFileSync(g.journal,bytes);
  for(const mutate of [p=>p.entries.find(e=>e.adjudicationHistory).adjudicationHistory=[],p=>p.entries.find(e=>e.history?.length===2).history.shift(),p=>p.parent.reviews.push(p.parent.reviews[0])]){const bad=structuredClone(plan);mutate(bad);const{planHash,...payload}=bad;bad.planHash=sha(JSON.stringify(payload));await assert.rejects(validateEvaluationPlan(bad));}
 }finally{g?.cleanup();f.cleanup();}
});
test('ancestry walker and validator reject cycles and excessive depth',async()=>{
 const f=await fixture();try{
  assert.throws(()=>planAncestry({version:2,planHash:f.parent.planHash,parent:{plan:fileReference(f.args.parentPlan)}}),/cyclic/);
  let path=f.args.parentPlan;for(let i=0;i<MAX_PLAN_GENERATIONS;i++){const next=resolve(f.directory,'depth-'+i+'.json');save(next,{version:2,planHash:sha('depth-'+i),parent:{plan:fileReference(path)}});path=next;}
  assert.throws(()=>planAncestry(JSON.parse(readFileSync(path))),/excessive/);
  const plan=await f.actual();await assert.rejects(validateSuccessorPlan(plan,{ancestry:[plan.planHash]}),/cyclic/);
 }finally{f.cleanup();}
});
