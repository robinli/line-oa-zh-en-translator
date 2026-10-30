import fs from 'node:fs';
import path from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {ARCHIVE_CONFIG,ARCHIVE_VERSION,ARCHIVE_EVENTS,ARCHIVE_JOBS,ARCHIVE_MESSAGES} from '../lib/conversation-archive.js';
const args=Object.fromEntries(process.argv.slice(2).map(value=>{const index=value.indexOf('=');return [value.slice(0,index),value.slice(index+1)];}));
const project=args['--project'],mode=args['--mode']??'check',credentials=args['--credentials'];
if(!['line-auto-translate-bot','line-auto-translate-bot-dev'].includes(project)||!credentials||!['prepare','check'].includes(mode))throw Error('Explicit supported project, isolated credentials and mode are required');
if(mode==='prepare'&&project!=='line-auto-translate-bot-dev')throw Error('PRD preparation is not authorized by this development tool');
const adc=JSON.parse(fs.readFileSync(credentials,'utf8'));
if(adc.type!=='authorized_user'||adc.quota_project_id!==project||process.env.FIRESTORE_EMULATOR_HOST)throw Error('Isolated credential/environment mismatch');
const db=new Firestore({projectId:project,keyFilename:path.resolve(credentials)});
try{
 const groups=await db.collection('lineTranslationGroups').select('recordingEnabled').get();
 let migrated=0;
 if(mode==='prepare'){
  for(const doc of groups.docs){if(!/^C[0-9a-f]{32}$/i.test(doc.id))continue;
   const applied=await db.runTransaction(async tx=>{const current=await tx.get(doc.ref);if(current.get('recordingEnabled')!==undefined)return false;tx.set(doc.ref,{recordingEnabled:true},{merge:true});return true;});if(applied)migrated++;
  }
  await db.runTransaction(async tx=>{const ref=db.doc(ARCHIVE_CONFIG),config=await tx.get(ref);if(config.exists){if(config.get('version')!==ARCHIVE_VERSION||config.get('enabled')!==true)throw Error('Existing archive configuration mismatch');return;}tx.create(ref,{version:ARCHIVE_VERSION,enabled:true,startedAt:new Date(),historyBackfill:false});});
 }
 const [events,jobs,messages,configuration,currentGroups]=await Promise.all([db.collection(ARCHIVE_EVENTS).count().get(),db.collection(ARCHIVE_JOBS).select('status','kind','reason').get(),db.collection(ARCHIVE_MESSAGES).select('attachmentStatus','redacted').get(),db.doc(ARCHIVE_CONFIG).get(),db.collection('lineTranslationGroups').select('recordingEnabled').get()]);
 const countBy=(rows,field)=>rows.docs.reduce((result,row)=>{const key=row.get(field)??'unknown';result[key]=(result[key]??0)+1;return result;},{});
 console.log(JSON.stringify({project,mode,checkedAt:new Date().toISOString(),migratedGroups:migrated,enabledGroups:currentGroups.docs.filter(doc=>/^C[0-9a-f]{32}$/i.test(doc.id)&&doc.get('recordingEnabled')===true).length,archiveEnabled:configuration.get('enabled')===true,archiveVersion:configuration.get('version')??null,eventCount:events.data().count,messageCount:messages.size,jobCounts:countBy(jobs,'status'),attachmentCounts:countBy(messages,'attachmentStatus'),redactedMessages:messages.docs.filter(doc=>doc.get('redacted')===true).length,qualification:'Stored counts do not prove platform delivery; compare safe archive diagnostics. No message bodies are printed.'},null,2));
}catch(error){console.error('Archive administration failed; provider error bodies and credentials are omitted.');process.exitCode=1;}finally{await db.terminate();}
