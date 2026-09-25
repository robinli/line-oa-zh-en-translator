import{mkdtempSync,writeFileSync,rmSync,existsSync}from'node:fs';import{tmpdir}from'node:os';import{resolve}from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';
import {createContract,sha} from './nmt-evaluation-contract.mjs';
import {validateNmtContract} from './nmt-evidence.mjs';
import {batchContract,preflightBudget,equal} from './nmt-evaluation-plan.mjs';
import {initialNmtLedger,trackingOnlyMigration,normalizeNmtBudgetMode} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT as project} from '../lib/nmt-isolation.js';
const tracking=()=>trackingOnlyMigration(initialNmtLedger(project),project,'2026-09-25T00:00:00.000Z').ledger;
const rehash=contract=>{const{contractHash,summary,...payload}=contract;return{...contract,contractHash:sha(JSON.stringify(payload))};};
test('frozen tracking policy changes no provider wire and legacy archived contracts remain valid',async()=>{
 const capped=await createContract(),unlimited=await createContract({budgetMode:'tracking-only'});assert.equal(capped.budgetMode,'capped');assert.equal(unlimited.budgetMode,'tracking-only');assert.deepEqual(capped.jobs,unlimited.jobs);assert.deepEqual(capped.options,unlimited.options);assert.notEqual(capped.contractHash,unlimited.contractHash);await validateNmtContract(unlimited,{aggregate:true});
 const legacy=structuredClone(capped);delete legacy.budgetMode;const archived=rehash(legacy);await validateNmtContract(archived,{aggregate:true,currentCandidate:false});await assert.rejects(validateNmtContract(archived,{aggregate:true}),/frozen budget mode/);
 for(const mode of ['unlimited',null,false]){const bad=rehash({...unlimited,budgetMode:mode});await assert.rejects(validateNmtContract(bad,{aggregate:true}),/mode invalid/);}
 await assert.rejects(validateNmtContract(rehash({...unlimited,options:{...unlimited.options,projectId:'line-auto-translate-bot'}}),{aggregate:true}),/config/);
});
test('tracking removes cumulative/category checks only when fresh ledger matches frozen policy',()=>{
 const capped=initialNmtLedger(project),ledger=tracking();assert.equal(preflightBudget(ledger,{regression:200000,retest:200000},'tracking-only').used,400000);assert.equal(ledger.used,0);
 assert.throws(()=>preflightBudget(capped,{regression:55001},'capped'),/exhausted/);assert.throws(()=>preflightBudget(capped,{regression:1},'tracking-only'),/fresh ledger/);assert.throws(()=>preflightBudget(ledger,{regression:1},'capped'),/fresh ledger/);assert.throws(()=>preflightBudget({...ledger,projectId:'production'},{manual:1},'tracking-only'));
 for(const bad of [undefined,{...ledger,used:1},{...ledger,categoryLimits:{}},{...ledger,version:1}])assert.throws(()=>preflightBudget(bad,{manual:1},'tracking-only'));
 assert.throws(()=>preflightBudget(ledger,{other:1},'tracking-only'));assert.throws(()=>preflightBudget(ledger,{manual:Infinity},'tracking-only'));assert.equal(normalizeNmtBudgetMode(undefined),'capped');
});
test('large encoded batches require explicit tracking mode; old capped batch checks remain',async()=>{
 const candidate=await createContract({budgetMode:'tracking-only'}),keys=candidate.jobs.map(j=>j.key),plan={candidate,planHash:'a'.repeat(64),entries:candidate.jobs.map(j=>({key:j.key,mode:'execute',category:'retest'}))};
 const batch=batchContract(plan,keys);assert.ok(batch.summary.characters>10000);await validateNmtContract(batch);
 assert.throws(()=>batchContract({...plan,candidate:rehash({...candidate,budgetMode:'capped'})},keys),/category limit/);
 const bad=rehash({...batch,budgetMode:'capped'});await assert.rejects(validateNmtContract(bad),/summary\/budget/);assert.ok(equal(batch.jobs,candidate.jobs));
});

test('offline migration preview cannot be mistaken for a live-ledger actual-plan input',()=>{const dir=mkdtempSync(resolve(tmpdir(),'nmt-mode-preview-'));try{const ledger=resolve(dir,'preview.json'),output=resolve(dir,'never.json');writeFileSync(ledger,JSON.stringify({kind:'NMT-ledger-migration-preview',ledger:tracking()}));const r=spawnSync(process.execPath,[fileURLToPath(new URL('./plan-nmt.mjs',import.meta.url)),'prepare-successor','--ledger='+ledger,'--output='+output],{encoding:'utf8',windowsHide:true});assert.notEqual(r.status,0);assert.match(r.stderr,/cannot authorize an actual plan/);assert.equal(existsSync(output),false);}finally{rmSync(dir,{recursive:true,force:true});}});
