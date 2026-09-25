import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createContract,caseKey,ranges,loadFixedCases} from './nmt-evaluation-contract.mjs';
import {localPaths,verifyGlossaries,requireProjectArgument} from './nmt-local-guard.mjs';
test('all fixed aliases deduplicate only exact direction, complete source, UTF16 ranges',()=>{
 const result=loadFixedCases();assert.equal(result.logical.length,330);assert.equal(result.cases.length,318);
 const a={sourceLanguage:'en',targetLanguage:'zh-TW',source:'😀 @A @A',mentions:[{start:3,length:2}]};
 assert.notEqual(caseKey(a),caseKey({...a,mentions:[{start:6,length:2}]}));assert.notEqual(caseKey(a),caseKey({...a,source:a.source+' '}));assert.deepEqual(ranges(a),[{start:3,length:2}]);
});
test('dry-run uses final encoded main and auxiliary contents with fixed core rounds',async()=>{
 const contract=await createContract();assert.deepEqual(contract.summary,{logicalCases:330,uniqueCases:318,selectedCases:318,results:336,requests:335,characters:58291,skipped:1});
 const label=contract.jobs.find(j=>j.sample.id==='v2h15');assert.equal(label.characters,176);assert.equal(label.request.contents.reduce((n,s)=>n+[...s].length,0),176);
 const again=await createContract();assert.equal(contract.contractHash,again.contractHash);
 assert.equal(contract.jobs.filter(j=>j.round>1).length,18);assert.equal(contract.jobs.find(j=>!j.request).sample.source,'PP-BK?');
});
test('local entry refuses absent credentials and unspecified/production project before any service',()=>{
 const prior=process.env.CLOUDSDK_CONFIG;delete process.env.CLOUDSDK_CONFIG;assert.throws(()=>localPaths());if(prior)process.env.CLOUDSDK_CONFIG=prior;
 assert.throws(()=>requireProjectArgument());
});
test('live evaluator refuses a changed freeze before checking credentials or sending',()=>{
 const path=new URL('../../.local/evidence/test-stale-freeze.json',import.meta.url);mkdirSync(new URL('.',path),{recursive:true});writeFileSync(path,'{"contractHash":"changed"}');
 const run=spawnSync(process.execPath,[fileURLToPath(new URL('./evaluate-nmt.mjs',import.meta.url)),'--execute','--category=smoke','--ids=short-price-confirmation','--freeze='+fileURLToPath(path)],{encoding:'utf8',windowsHide:true});
 assert.notEqual(run.status,0);assert.ok(run.stderr.includes('Frozen request/candidate/rubric contract mismatch'));
});

test('all 39 historical paid entry points stop before credentials or provider calls',()=>{
 const inventory={files:readdirSync(new URL('./',import.meta.url)).filter(f=>/^(evaluate-|provision-|smoke-tllm-context-quantity\.mjs$)/.test(f)&&!f.includes('nmt'))};
 assert.equal(inventory.files.length,39);
 for(const name of inventory.files){const path=fileURLToPath(new URL('./'+name,import.meta.url));assert.match(readFileSync(path,'utf8'),/^import "\.\/nmt-legacy-guard\.mjs";/);const run=spawnSync(process.execPath,[path],{encoding:'utf8',windowsHide:true});assert.notEqual(run.status,0,name);assert.ok(run.stderr.includes('Legacy paid entry disabled in isolated NMT checkout'),name);}
});

test('absent or partial glossary provisioning provenance blocks live use before a provider request',async()=>{await assert.rejects(verifyGlossaries(null),/Both provisioned/);await assert.rejects(verifyGlossaries({project:'line-auto-translate-bot-dev',records:[]}),/Both provisioned/);});


test('standalone evaluator cannot bypass planned regression/retest categories',async()=>{
 const path=new URL('../../.local/evidence/test-plan-only-freeze.json',import.meta.url);
 for(const category of ['regression','retest']){const contract=await createContract({category,ids:['short-price-confirmation']});writeFileSync(path,JSON.stringify(contract));const run=spawnSync(process.execPath,[fileURLToPath(new URL('./evaluate-nmt.mjs',import.meta.url)),'--execute','--category='+category,'--ids=short-price-confirmation','--freeze='+fileURLToPath(path)],{encoding:'utf8',windowsHide:true});assert.notEqual(run.status,0);assert.match(run.stderr,/requires the approved key plan/);}
 unlinkSync(path);
});
