import {glossarySpecs} from './nmt-glossary-spec.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {root,assertIsolatedEnvironment,assertGcloudConfiguration,assertFirebaseStore,assertDeploySession,localPaths,verifyLocalTarget,verifyGlossaries} from './nmt-local-guard.mjs';
import {createContract as buildContract,sha,options,ranges,callOptions} from './nmt-evaluation-contract.mjs';
import {validateNmtEvidence,validateNmtContract} from './nmt-evidence.mjs';
import {NmtGlossaryTranslator} from '../lib/nmt-glossary-translator.js';
import {NMT_TEST_PROJECT as project,NMT_TEST_PROJECT_NUMBER as number,NMT_TEST_ACCOUNT as account,NMT_RUNTIME_ACCOUNT as runtime,NMT_TEST_BILLING as billing,canonicalNmtResourceName} from '../lib/nmt-isolation.js';
const config={core:{account,project}},store={user:{email:account},tokens:{refresh_token:'unit-test-placeholder'},activeAccounts:{'/unit':account}};
const identity={projectId:project,projectNumber:number,principal:account,billingAccount:'billingAccounts/'+billing,billingEnabled:true,runtimeAccount:runtime};
const clone=structuredClone;
test('F01 effective gcloud config and environment reject credential and endpoint overrides',()=>{
 assert.doesNotThrow(()=>assertIsolatedEnvironment({CLOUDSDK_CONFIG:'isolated'}));assert.doesNotThrow(()=>assertGcloudConfiguration(config));
 for(const key of ['CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_API_ENDPOINT_OVERRIDES_CLOUDRESOURCEMANAGER','FIREBASE_TOKEN','FIREBASE_AUTH_EMULATOR_HOST'])assert.throws(()=>assertIsolatedEnvironment({[key]:'foreign'}),key);
 for(const key of ['impersonate_service_account','credential_file_override','access_token_file','login_config_file'])assert.throws(()=>assertGcloudConfiguration({...config,auth:{[key]:'foreign'}}),key);
 for(const extra of [{auth:{disable_credentials:true}},{auth:{token_host:'https://foreign.test'}},{api_endpoint_overrides:{cloudresourcemanager:'https://foreign.test'}},{core:{...config.core,account:'foreign@example.test'}},{core:{...config.core,project:'line-auto-translate-bot-b81bd'}}])assert.throws(()=>assertGcloudConfiguration({...config,...extra}));
});
function dependencies(foreign){return{localPaths(){},command(_exe,args){switch(args[0]){case'config':return config;case'auth':return'CLI';case'projects':return{projectId:project,projectNumber:number,lifecycleState:'ACTIVE'};case'billing':return{billingEnabled:true,billingAccountName:'billingAccounts/'+billing};case'iam':return{email:runtime};default:throw Error('Unexpected command');}},adc:{async getAccessToken(){return'ADC';}},async firebaseToken(){return'Firebase';},async fetch(url){const token=new URL(url).searchParams.get('access_token');return{ok:true,async json(){return{email:token===foreign?'foreign@example.test':account};}};}};}
test('F01/F02 actual CLI, ADC and Firebase token principals are independently verified',async()=>{
 assert.deepEqual((await verifyLocalTarget({firebaseRequired:true},dependencies())).projectNumber,number);
 for(const principal of ['CLI','ADC','Firebase'])await assert.rejects(verifyLocalTarget({firebaseRequired:true},dependencies(principal)),new RegExp(principal+' effective principal mismatch'));
 const deps=dependencies();const run=deps.command;deps.command=(e,args)=>args[0]==='projects'?{projectId:project,projectNumber:'886015407043',lifecycleState:'ACTIVE'}:run(e,args);await assert.rejects(verifyLocalTarget({},deps),/project/);
});
test('F02 Firebase must use isolated exclusive account and nonce-bound guarded deploy',()=>{
 assert.equal(assertFirebaseStore(store).user.email,account);
 for(const bad of [{...store,user:{email:'foreign'}},{...store,additionalAccounts:[store]},{...store,activeAccounts:{'/unit':'foreign'}},{user:store.user}])assert.throws(()=>assertFirebaseStore(bad));
 const env={CLOUDSDK_CONFIG:resolve(root,'.local/nmt-auth/gcloud'),GOOGLE_APPLICATION_CREDENTIALS:resolve(root,'.local/nmt-auth/gcloud/application_default_credentials.json'),XDG_CONFIG_HOME:resolve(root,'.local/nmt-auth/firebase')};
 const deps={env,realpath:x=>x,read:()=>JSON.stringify({type:'authorized_user',quota_project_id:project})};assert.doesNotThrow(()=>localPaths(deps));assert.throws(()=>localPaths({...deps,env:{...env,XDG_CONFIG_HOME:'foreign'}}));assert.throws(()=>localPaths({...deps,env:{...env,XDG_CONFIG_HOME:undefined}}));
 const session={nonce:'unit-test-nonce',project,account,createdAt:1000};assert.doesNotThrow(()=>assertDeploySession(session,session.nonce,1001));
 for(const [s,n,now]of [[session,undefined,1001],[session,'other',1001],[{...session,account:'foreign'},session.nonce,1001],[session,session.nonce,601001]])assert.throws(()=>assertDeploySession(s,n,now));
 const run=spawnSync(process.execPath,[fileURLToPath(new URL('./nmt-admin.mjs',import.meta.url)),'deploy-check','--project='+project],{encoding:'utf8',windowsHide:true,env:{...process.env,NMT_DEPLOY_SESSION:''}});assert.notEqual(run.status,0);assert.match(run.stderr,/Direct Firebase deploy prohibited/);
 const admin=readFileSync(new URL('./nmt-admin.mjs',import.meta.url),'utf8');assert.match(admin,/'--account='\+account/);assert.match(admin,/NMT_DEPLOY_SESSION:session.nonce/);
});
test('F03 provision custom role only uses valid narrow identity permissions',()=>{
 const source=readFileSync(new URL('./nmt-admin.mjs',import.meta.url),'utf8');const permissions=[...source.match(/includedPermissions:\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);assert.deepEqual(permissions,['iam.serviceAccounts.get','resourcemanager.projects.get','serviceusage.services.use']);assert.ok(!source.includes('billing.resourceAssociations.list'));assert.ok(!source.includes('roles/billing.'));
});
function glossaryLock(){return{project,records:glossarySpecs.map(({direction,source:sourceLanguageCode,target:targetLanguageCode,count:entryCount,file,id})=>({direction,sha256:sha(readFileSync(new URL('../glossaries/'+file,import.meta.url))),resource:{name:'projects/'+number+'/locations/us-central1/glossaries/'+id,entryCount,languagePair:{sourceLanguageCode,targetLanguageCode},inputConfig:{gcsSource:{inputUri:'gs://'+project+'-nmt-glossaries/'+file}},submitTime:{seconds:'123'}}}))};}
// Explicit in-memory unit resource fixture; never write it as provisioned cloud evidence.
async function createContract(args){const contract=await buildContract(args);if(!contract.glossaryResources){contract.glossaryResources=glossaryLock();const{contractHash,summary,...payload}=contract;contract.contractHash=sha(JSON.stringify(payload));}return contract;}

const glossaryClient=lock=>({async getGlossary({name},opts){assert.deepEqual(opts,{retry:{retryCodes:[]}});return[clone(lock.records.find(r=>canonicalNmtResourceName(r.resource.name)===name).resource)];}});
test('F08 canonical glossary accepts only verified test ID/number and preserves all resource evidence',async()=>{
 const lock=glossaryLock();await verifyGlossaries(lock,glossaryClient(lock));const asId=clone(lock);for(const r of asId.records)r.resource.name=canonicalNmtResourceName(r.resource.name);await verifyGlossaries(lock,glossaryClient(asId));
 for(const foreign of ['line-auto-translate-bot','886015407043','123456789','line-auto-translate-bot-b81bd'])assert.throws(()=>canonicalNmtResourceName('projects/'+foreign+'/locations/us-central1/glossaries/x'));
 for(const mutate of [r=>r.resource.name=r.resource.name.replace(number,'886015407043'),r=>r.sha256='0'.repeat(64),r=>r.resource.entryCount++,r=>r.resource.languagePair.targetLanguageCode='vi',r=>r.resource.inputConfig.gcsSource.inputUri='gs://foreign/object']){const bad=clone(lock);mutate(bad.records[0]);await assert.rejects(verifyGlossaries(bad,glossaryClient(lock)));}
 const changed=clone(lock);changed.records[0].resource.submitTime.seconds='124';await assert.rejects(verifyGlossaries(lock,glossaryClient(changed)),/changed/);
});
async function evidenceFor(contract,text='<div id="p0">Please check the quotation for this sample batch first, then tell me the result.</div>'){
 const results=[];for(const job of contract.jobs){const attempts=[];const output=await new NmtGlossaryTranslator(options,{async translateText(request,opts){const response={glossaryTranslations:[{translatedText:text}]};attempts.push({request,callOptions:opts,response});return[response];}}).translateWithRanges(job.sample.source,job.sample.sourceLanguage,job.sample.targetLanguage,{protectedRanges:ranges(job.sample)});results.push({key:job.key,id:job.sample.id,aliases:job.sample.aliases,source:job.sample.source,sourceLanguage:job.sample.sourceLanguage,targetLanguage:job.sample.targetLanguage,round:job.round,status:job.request?'output':'skipped',attempts,...output});}
 return{kind:'NMT-live-synthetic',qualification:'Unit fixture generated offline; zero API calls; never quality evidence',contractHash:contract.contractHash,contract,identity,results};
}
function rehash(contract){const {contractHash,summary,...payload}=contract;contract.contractHash=sha(JSON.stringify(payload));return contract;}
test('F07 full request/response/source/config evidence required, valid provider and code-only outcomes accepted',async()=>{
 const contract=await createContract({category:'smoke',ids:['short-price-confirmation','code-only']});const evidence=await evidenceFor(contract);await validateNmtEvidence(evidence,{freeze:contract});
 const output=e=>e.results.find(r=>r.status==='output');
 for(const mutate of [e=>e.fixtureOnly=true,e=>output(e).attempts=[],e=>delete output(e).attempts[0].response,e=>output(e).attempts[0].request.model='general/translation-llm',e=>output(e).attempts[0].request.contents[0]+='changed',e=>output(e).attempts[0].callOptions.timeout=1,e=>output(e).source+='changed',e=>output(e).text+='changed',e=>output(e).round=2,e=>e.contractHash='0'.repeat(64),e=>e.results.find(r=>r.status==='skipped').text='wrong',e=>e.identity.principal='foreign',e=>e.results.push(e.results[0])]){const bad=clone(evidence);mutate(bad);await assert.rejects(validateNmtEvidence(bad,{freeze:contract}));}
 const missing=clone(evidence);delete missing.contract.artifactHashes;rehash(missing.contract);missing.contractHash=missing.contract.contractHash;await assert.rejects(validateNmtEvidence(missing,{freeze:missing.contract}));
 const prior=clone(evidence);prior.contract.version='nmt-glossary-v1';prior.contract.artifactHashes['src/nmt-context-meaning.ts']='1'.repeat(64);rehash(prior.contract);prior.contractHash=prior.contract.contractHash;await assert.rejects(validateNmtEvidence(prior,{freeze:prior.contract}));await validateNmtEvidence(prior,{freeze:prior.contract,currentCandidate:false}); // same complete wire contract; old producer/new checker, never relabel live
 const pending=clone(evidence);const pendingRow=output(pending);pendingRow.status='pending';pendingRow.attempts=[];await validateNmtEvidence(pending,{freeze:contract,allowIncomplete:true});await assert.rejects(validateNmtEvidence(pending,{freeze:contract}));
});
test('F07 review gate accepts complete offline injected fixture then rejects review drift and missing attempt',async()=>{
 const directory=mkdtempSync(resolve(tmpdir(),'nmt-evidence-unit-'));const paths={};for(const name of ['fixture','freeze','results','review','gate'])paths[name]=resolve(directory,name+'.json');
 const save=(name,value)=>writeFileSync(paths[name],JSON.stringify(value));
 try{
  // These punctuation variants exercise tooling only, never the independent verification fixture.
  save('fixture',Array.from({length:20},(_,i)=>({id:'unit-'+i,source:'Please confirm the packaging'+'.'.repeat(i+1),sourceLanguage:'en',targetLanguage:'zh-TW'})));
  const contract=await createContract({category:'verification',fixture:paths.fixture});const evidence=await evidenceFor(contract,'<div id="p0">請確認包裝。</div>');save('freeze',contract);save('results',evidence);
  const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL('./review-nmt-results.mjs',import.meta.url)),'--results='+paths.results,'--freeze='+paths.freeze,...args],{encoding:'utf8',windowsHide:true});
  let out=run(['--template','--output='+paths.review]);assert.equal(out.status,0,out.stderr);const review=JSON.parse(readFileSync(paths.review));review.reviewer='offline-unit-test';for(const row of review.reviews){row.verdict='usable';row.reason='Tooling unit fixture only';}save('review',review);
  out=run(['--review='+paths.review,'--output='+paths.gate]);assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(readFileSync(paths.gate)).passed,true);
  review.reviews[0].verdict='safe_rejection';save('review',review);assert.equal(run(['--review='+paths.review,'--output='+paths.gate]).status,1);
  evidence.results[0].attempts=[];save('results',evidence);assert.match(run(['--template','--output='+paths.review]).stderr,/one complete provider attempt/);
 }finally{for(const path of Object.values(paths))try{unlinkSync(path);}catch{}rmdirSync(directory);}
});

test('archived producer with a changed wire may replay as incompatible, never as new-provider evidence',async()=>{
 const contract=await createContract({category:'smoke',ids:['short-price-confirmation']});const original=await evidenceFor(contract);const archived=clone(original);archived.contract.version='nmt-glossary-v3';const job=archived.contract.jobs[0];job.request.contents[0]+=' ';job.characters++;archived.contract.summary.characters++;archived.results[0].attempts[0].request=clone(job.request);rehash(archived.contract);archived.contractHash=archived.contract.contractHash;
 await validateNmtEvidence(archived,{freeze:archived.contract,currentCandidate:false,replayOutputs:false});await assert.rejects(validateNmtEvidence(archived,{freeze:archived.contract}));
 const directory=mkdtempSync(resolve(tmpdir(),'nmt-archived-wire-unit-')),recording=resolve(directory,'recording.json'),output=resolve(directory,'replay.json');try{
  writeFileSync(recording,JSON.stringify(archived));const run=spawnSync(process.execPath,[fileURLToPath(new URL('./replay-nmt.mjs',import.meta.url)),'--recording='+recording,'--output='+output],{encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr);const replay=JSON.parse(readFileSync(output));assert.equal(replay.kind,'NMT-recorded-response-replay');assert.equal(replay.summary.incompatible_request,1);assert.equal(replay.summary.output,0);assert.equal(replay.source.adapterVersion,'nmt-glossary-v3');assert.deepEqual(replay.source.producerContract,JSON.parse(JSON.stringify(archived.contract)));
 }finally{for(const file of [recording,output])try{unlinkSync(file);}catch{}rmdirSync(directory);}
});
