import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreNmtBudget,initialNmtLedger,NMT_LEDGER_PATH} from '../lib/nmt-budget.js';
const host='127.0.0.1:8189',project='demo-nmt-budget';
process.env.FIRESTORE_EMULATOR_HOST=host;
const directory=new URL('../../.local/evidence/',import.meta.url);mkdirSync(directory,{recursive:true});
const java=process.env.NMT_TEST_JAVA??'C:/Program Files/Eclipse Adoptium/jre-21.0.12.101-hotspot/bin/java.exe';
const jar=process.env.NMT_TEST_EMULATOR_JAR??'C:/Users/Robin/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar';
const child=spawn(java,['-jar',jar,'--host=127.0.0.1','--port=8189','--project_id='+project],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
const databases=[];const database=()=>{const db=new Firestore({projectId:project});databases.push(db);return db;};
try {
 let ready=false;
 for(let i=0;i<100;i++){try{await fetch('http://'+host);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
 if(!ready)throw Error('Emulator did not start');
 const db=database(),ref=db.doc(NMT_LEDGER_PATH);await ref.create(initialNmtLedger(project));
 let callbacks=0;
 const clients=Array.from({length:20},()=>{const db=database();const original=db.runTransaction.bind(db);db.runTransaction=(fn,options)=>original(tx=>{callbacks++;return fn(tx);},options);return new FirestoreNmtBudget(db,project);});
 const reservations=await Promise.allSettled(clients.map(client=>client.reserve('manual',1000)));
 const successful=reservations.filter(r=>r.status==='fulfilled').length;
 let ledger=(await ref.get()).data();assert.equal(successful,10);assert.equal(ledger.used,10000);assert.equal(ledger.reservations,10);assert.ok(callbacks>20,'Concurrent transaction conflict must be retried');
 const restarted=new FirestoreNmtBudget(database(),project);await restarted.reserve('smoke',5000);assert.equal((await ref.get()).get('used'),15000);
 await assert.rejects(restarted.reserve('manual',1));
 for(const [category,amount] of [['regression',55000],['verification',20000],['retest',10000]])await restarted.reserve(category,amount);
 ledger=(await ref.get()).data();assert.equal(ledger.used,100000);await assert.rejects(restarted.reserve('retest',1));
 await ref.update({used:1});await assert.rejects(restarted.reserve('smoke',1));
 await ref.delete();await assert.rejects(restarted.reserve('smoke',1));assert.equal((await ref.get()).exists,false);
 const evidence={node:process.version,emulator:'cloud-firestore-emulator-v1.22.0',project,parallelClients:20,successful,transactionCallbacks:callbacks,checks:['cross-client atomic cap','transaction retries','restart persistence','all category and total limits','corrupt ledger denied','missing ledger not initialized'],finalValidLedger:ledger,passed:true};
 writeFileSync(new URL('nmt-ledger-emulator.json',directory),JSON.stringify(evidence,null,2).replace(/\n/g,'\r\n')+'\r\n');console.log(JSON.stringify(evidence));
} finally {for(const db of databases)await db.terminate();child.kill();writeFileSync(new URL('nmt-ledger-emulator.log',directory),log);}
