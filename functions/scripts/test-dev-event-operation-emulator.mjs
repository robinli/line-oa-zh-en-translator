import {createHmac} from 'node:crypto';
import {processLineWebhook} from '../lib/webhook.js';
import {createTranslationProgramRouter} from '../lib/translation-program.js';
import {NmtGlossaryTranslator} from '../lib/nmt-glossary-translator.js';
import {VietnameseNmtTranslator} from '../lib/vietnamese-nmt-translator.js';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {Firestore} from 'firebase-admin/firestore';
import assert from 'node:assert/strict';
import {FirestoreDevEventOperationStore} from '../lib/dev-event-operation-store.js';
import {DEV_OPERATIONS_COLLECTION} from '../lib/dev-event-operation.js';
import {ControlledNmtClient} from '../lib/nmt-controlled-client.js';
import {initialNmtLedger,NMT_LEDGER_PATH,NMT_MIGRATION_PATH,enableTrackingOnlyBudget,FirestoreNmtBudget} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT as project,NMT_TEST_ACCOUNT,NMT_RUNTIME_ACCOUNT,NMT_TEST_BILLING} from '../lib/nmt-isolation.js';
const host='127.0.0.1:8194';process.env.FIRESTORE_EMULATOR_HOST=host;
const directory=new URL('../../.local/dev-improvement-20260930/operation-emulator-'+new Date().toISOString().replace(/[:.]/g,'-')+'/',import.meta.url);mkdirSync(directory,{recursive:true});
const child=spawn(process.env.NMT_TEST_JAVA??'C:/Program Files/Eclipse Adoptium/jre-21.0.12.101-hotspot/bin/java.exe',['-jar',process.env.NMT_TEST_EMULATOR_JAR??'C:/Users/Robin/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar','--host=127.0.0.1','--port=8194','--project_id='+project],{windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
const databases=[],database=()=>{const db=new Firestore({projectId:project,host,ssl:false});databases.push(db);return db;};
let stage='startup';
try {
 let ready=false;for(let i=0;i<100;i++){try{await fetch('http://'+host);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}if(!ready)throw Error('Local emulator did not start');
 const db=database(),ledgerRef=db.doc(NMT_LEDGER_PATH);await ledgerRef.create(initialNmtLedger(project));
 const stores=[new FirestoreDevEventOperationStore(database(),project),new FirestoreDevEventOperationStore(database(),project)];
 const event=id=>({webhookEventId:id,source:{type:'group',groupId:'synthetic'},message:{id,text:'PRIVATE BODY'}});
 const parent='projects/'+project+'/locations/global',request={parent,model:parent+'/models/general/nmt',contents:['你好'],mimeType:'text/html',sourceLanguageCode:'zh-TW',targetLanguageCode:'vi'},options={timeout:15000,retry:{retryCodes:[]}};
 const identity=async()=>({projectId:project,principal:NMT_TEST_ACCOUNT,runtimeAccount:NMT_RUNTIME_ACCOUNT,billingAccount:'billingAccounts/'+NMT_TEST_BILLING,billingEnabled:true});
 let calls=0;const transport={async translateText(){calls++;return [{translations:[{translatedText:'Xin chào'}]}];}};
 const client=session=>new ControlledNmtClient(transport,new FirestoreNmtBudget(db,project),'manual',identity,false,session);
 stage='v1-atomic-operation';const v1Session=await stores[0].claim(event('v1'));await client(v1Session).translateText(request,options);assert.equal(calls,1);assert.equal((await ledgerRef.get()).get('used'),2);assert.equal((await db.doc(NMT_MIGRATION_PATH).get()).exists,false);await enableTrackingOnlyBudget(db,project);const history=(await db.doc(NMT_MIGRATION_PATH).get()).data();calls=0;
 stage='independent-client-race';const sessions=await Promise.all(stores.map(store=>store.claim(event('parallel'))));assert.equal(sessions.filter(Boolean).length,1);await Promise.all(sessions.filter(Boolean).map(session=>client(session).translateText(request,options)));assert.equal(calls,1);assert.equal((await ledgerRef.get()).get('used'),4);
 stage='atomic-commit-response-lost';const uncertainDb=database(),run=uncertainDb.runTransaction.bind(uncertainDb);let lose=false;uncertainDb.runTransaction=async(...args)=>{const result=await run(...args);if(lose)throw Error('synthetic response lost');return result;};const uncertain=new FirestoreDevEventOperationStore(uncertainDb,project),session=await uncertain.claim(event('commit-lost'));lose=true;await assert.rejects(client(session).translateText(request,options));assert.equal(calls,1);assert.equal((await ledgerRef.get()).get('used'),6);const row=(await db.collection(DEV_OPERATIONS_COLLECTION).doc(session.operationId).get()).data();assert.equal(row.providerStatus,'provider_started');assert.equal(row.telemetry.apiCalled,'unknown');assert.equal(await stores[1].claim(event('commit-lost')),null);
 stage='started-process-crash';const crashed=await stores[0].claim(event('crash'));crashed.prepare(request);await crashed.reserveProvider('manual',2);assert.equal(await stores[1].claim(event('crash')),null);assert.equal(calls,1);assert.equal((await ledgerRef.get()).get('used'),8);
 stage='owner-fence-and-history';await assert.rejects(stores[1].update({...crashed.owner,ownerAttempt:'other'},{deliveryStatus:'sent'},crashed.telemetry));assert.deepEqual((await db.doc(NMT_MIGRATION_PATH).get()).data(),history);
 const missing=await stores[0].claim(event('missing-history'));await db.doc(NMT_MIGRATION_PATH).delete();await assert.rejects(client(missing).translateText(request,options));assert.equal(calls,1);assert.equal((await ledgerRef.get()).get('used'),8);await db.doc(NMT_MIGRATION_PATH).create(history);

 stage='full-webhook-independent-clients';
 let fullCalls=0,replies=0,capturedBodies=0,mode='zh-en',deliveryFail=false,providerFail=false;
 const fullEvent=id=>({webhookEventId:id,type:'message',timestamp:1000,replyToken:'synthetic-token',source:{type:'group',groupId:'C'+'a'.repeat(32)},message:{type:'text',id,text:'你好'}});
 const fullDeps=store=>({eventOperationStore:store,channelSecret:'synthetic',ownerUserId:'owner',
  qualityStore:{async getConfig(){return {enabled:true,groups:[],startedAt:new Date()};},async getRecordingEnabled(){return false;},async saveOriginal(){capturedBodies++;},async complete(){capturedBodies++;}},
  settingsStore:{async getSettings(){return {textTranslationEnabled:true,audioTranscriptionEnabled:false,translationMode:mode};}},
  replier:{async replyText(){replies++;if(deliveryFail)throw Error('synthetic timeout');}},failureStore:{async save(){}},logger:{info(){},warn(){},error(){}},
  createEventTranslationProgram:session=>{
   const controlled=new ControlledNmtClient({async translateText(req){fullCalls++;if(providerFail)throw {code:'ETIMEDOUT'};return [req.targetLanguageCode==='vi'?{translations:[{translatedText:'Xin chào'}]}:{glossaryTranslations:[{translatedText:'<div id="p0">Hello</div>'}]}];}},new FirestoreNmtBudget(db,project),'manual',identity,false,session);
   const parent='projects/'+project+'/locations/us-central1';
   return createTranslationProgramRouter(()=>({translator:new NmtGlossaryTranslator({projectId:project,location:'us-central1',glossaryZhEn:parent+'/glossaries/nmt-trade-zh-en-v12',glossaryEnZh:parent+'/glossaries/nmt-trade-en-zh-v9'},controlled),mentionAliases:[]}),()=>new VietnameseNmtTranslator(project,controlled));
  }});
 const fullCall=(deps,events)=>{const rawBody=Buffer.from(JSON.stringify({events}));return processLineWebhook({method:'POST',rawBody,signature:createHmac('sha256','synthetic').update(rawBody).digest('base64')},deps);};
 const deps=stores.map(fullDeps);
 await Promise.all(deps.map(d=>fullCall(d,[fullEvent('webhook-race')])));assert.equal(fullCalls,1);assert.equal(replies,1);assert.equal(capturedBodies,0);
 await fullCall(deps[0],[fullEvent('webhook-other'),fullEvent('webhook-race'),{...fullEvent('webhook-local'),message:{type:'text',id:'webhook-local',text:'PP-BK?'}}]);assert.equal(fullCalls,2);assert.equal(replies,3);
 mode='zh-vi';await fullCall(deps[1],[fullEvent('webhook-vi')]);assert.equal(fullCalls,3);assert.equal(replies,4);
 deliveryFail=true;await fullCall(deps[0],[fullEvent('webhook-line-unknown')]);deliveryFail=false;await fullCall(deps[1],[fullEvent('webhook-line-unknown')]);assert.equal(fullCalls,4);assert.equal(replies,5);
 providerFail=true;await fullCall(deps[0],[fullEvent('webhook-provider-unknown')]);providerFail=false;await fullCall(deps[1],[fullEvent('webhook-provider-unknown')]);assert.equal(fullCalls,5);assert.equal(replies,6);
 const fullRows=(await db.collection(DEV_OPERATIONS_COLLECTION).get()).docs.map(d=>d.data());
 assert.equal(fullRows.filter(r=>r.providerStatus==='provider_unknown').length,1);assert.equal(fullRows.filter(r=>r.deliveryStatus==='delivery_unknown').length,1);assert.ok(fullRows.some(r=>r.translationStatus==='validated'&&r.deliveryStatus==='delivery_unknown'));assert.equal(capturedBodies,0);
 for(const row of fullRows){const t=row.telemetry;assert.equal(t.primaryTextWire+t.primaryMarkup+t.auxiliaryWire,t.wireCharacters);}
 const rows=(await db.collection(DEV_OPERATIONS_COLLECTION).get()).docs.map(d=>d.data());assert.ok(!JSON.stringify(rows).includes('PRIVATE BODY'));assert.ok(!JSON.stringify(rows).includes('synthetic-token'));
 writeFileSync(new URL('result.json',directory),JSON.stringify({passed:true,node:process.version,project,scope:'local emulator and mock transport only',providerCalls:calls,v1ProviderCalls:1,fullWebhookProviderCalls:fullCalls,fullWebhookReplies:replies,used:(await ledgerRef.get()).get('used'),checks:['v1-atomic-operation','independent-client-race','atomic-commit-response-lost-no-provider','started-crash-no-takeover','owner-fence','immutable-history','missing-history-fail-closed','no-body','full-webhook-recording-off-cross-client','multiple-event-isolation','zero-provider-local','Vietnamese','LINE-unknown','provider-unknown'],rows},null,2).replace(/\n/g,'\r\n')+'\r\n');console.log(JSON.stringify({passed:true,evidence:new URL('result.json',directory).pathname}));
} catch(error) {writeFileSync(new URL('failure.json',directory),JSON.stringify({stage,code:error.code??null,message:error.message},null,2));throw error;} finally {for(const db of databases)await db.terminate();child.kill();writeFileSync(new URL('emulator.log',directory),log.replace(/\r?\n/g,'\r\n'));}
