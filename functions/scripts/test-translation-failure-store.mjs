import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreTranslationFailureStore,translationFailureId,TRANSLATION_FAILURE_COLLECTION} from '../lib/translation-failure-store.js';
const host='127.0.0.1:8191',project='demo-translation-failure-store';
process.env.FIRESTORE_EMULATOR_HOST=host;
const directory=new URL('../../.local/oa-response-20260925/',import.meta.url);mkdirSync(directory,{recursive:true});
const java=process.env.NMT_TEST_JAVA??'C:/Program Files/Eclipse Adoptium/jre-21.0.12.101-hotspot/bin/java.exe';
const jar=process.env.NMT_TEST_EMULATOR_JAR??'C:/Users/Robin/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar';
const child=spawn(java,['-jar',jar,'--host=127.0.0.1','--port=8191','--project_id='+project],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='',startupError;child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);child.on('error',e=>{startupError=e;});
const clients=[];const database=()=>{const db=new Firestore({projectId:project});clients.push(db);return db;};
try {
  let ready=false;
  for(let i=0;i<100;i++){if(startupError)throw startupError;if(child.exitCode!==null)throw Error('Emulator exited');try{await fetch('http://'+host);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
  if(!ready)throw Error('Emulator did not start');
  const db=database(),store=new FirestoreTranslationFailureStore(db);
  const record={groupId:'synthetic-group',webhookEventId:'synthetic-event',messageId:'synthetic-message',messageType:'text',sourceText:'完整原文\n😀'.repeat(2000),translationMode:'zh-en',stage:'input',reason:'text_too_long'};
  const ref=db.collection(TRANSLATION_FAILURE_COLLECTION).doc(translationFailureId(record));
  await store.save(record);const first=await ref.get();assert.equal(first.get('sourceText'),record.sourceText);
  await Promise.all(Array.from({length:10},()=>new FirestoreTranslationFailureStore(database()).save({...record,sourceText:'redelivery'})));
  const after=await ref.get();assert.equal(after.get('sourceText'),record.sourceText);assert.ok(first.get('recordedAt').isEqual(after.get('recordedAt')));
  assert.equal((await db.collection(TRANSLATION_FAILURE_COLLECTION).get()).size,1);
  const audio={...record,webhookEventId:undefined,messageId:'audio-message',messageType:'audio',sourceText:null,stage:'transcription',reason:'transcription_error'};
  await new FirestoreTranslationFailureStore(database()).save(audio);
  const saved=(await db.collection(TRANSLATION_FAILURE_COLLECTION).doc(translationFailureId(audio)).get()).data();assert.equal(saved.sourceText,null);assert.equal(Object.hasOwn(saved,'webhookEventId'),false);
  const result={passed:true,node:process.version,project,checks:['real Firestore create','full Unicode oversized source','ten concurrent redeliveries keep first content/time','multiple Firestore clients','missing transcript and optional fields']};
  writeFileSync(new URL('failure-store-emulator.json',directory),JSON.stringify(result,null,2)+'\r\n');console.log(JSON.stringify(result));
} finally {for(const db of clients)await db.terminate();child.kill();writeFileSync(new URL('failure-store-emulator.log',directory),log);}
