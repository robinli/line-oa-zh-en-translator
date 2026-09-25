import {glossaryRecordFile} from './nmt-glossary-spec.mjs';
import {provisionNmtGlossaries} from './nmt-glossary-provision.mjs';
import {fileURLToPath} from 'node:url';
import {AuthenticatedNmtTransport} from '../lib/nmt-controlled-client.js';
import {nmtFailure} from '../lib/nmt-diagnostics.js';
import {assertNmtIdentity} from '../lib/nmt-isolation.js';
import {readFileSync,writeFileSync,existsSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {v3} from '@google-cloud/translate';
import {createHash,randomBytes} from 'node:crypto';
import {NMT_TEST_PROJECT as project,NMT_TEST_ACCOUNT as account,NMT_RUNTIME_ACCOUNT as runtime,NMT_GLOSSARIES} from '../lib/nmt-isolation.js';
import {initialNmtLedger,NMT_LEDGER_PATH,NMT_MIGRATION_PATH,enableTrackingOnlyBudget,validateNmtLedger,validateNmtPolicyHistory} from '../lib/nmt-budget.js';
import {root,command,verifyLocalTarget,verifyGlossaries,validateGlossaryRecords,canonicalGlossary,requireDeploySession,requireProjectArgument} from './nmt-local-guard.mjs';
const action=process.argv[2];requireProjectArgument();
if(!['identity','transport-identity','provision','initialize-ledger','enable-tracking-only','glossaries','deploy','deploy-check'].includes(action))throw Error('Unknown NMT administration action');
const mutating=!['identity','transport-identity','deploy-check'].includes(action);
if(mutating&&!process.argv.includes('--execute'))throw Error('Review action then pass --execute; no resources changed');
if(action==='deploy-check')requireDeploySession();
const identity=await verifyLocalTarget({runtimeRequired:action!=='provision',firebaseRequired:action==='deploy'||action==='deploy-check'});
const g=(...args)=>command('gcloud',[...args,'--project='+project,'--quiet']);
if(action==='identity')console.log(JSON.stringify(identity));
if(action==='transport-identity'){
 try{const actual=await new AuthenticatedNmtTransport().identity();assertNmtIdentity(actual);console.log(JSON.stringify({ok:true,identity:actual,reservation:'not_started',provider:'not_started'}));}
 catch(error){console.log(JSON.stringify({ok:false,diagnostic:nmtFailure(error,'identity.validation').diagnostic}));process.exitCode=1;}
}
if(action==='provision'){
 g('services','enable','translate.googleapis.com','firestore.googleapis.com','iam.googleapis.com','cloudbilling.googleapis.com','secretmanager.googleapis.com','storage.googleapis.com','cloudfunctions.googleapis.com','run.googleapis.com','cloudbuild.googleapis.com','artifactregistry.googleapis.com','speech.googleapis.com');
 const accounts=JSON.parse(g('iam','service-accounts','list','--format=json'));
 if(!accounts.some(a=>a.email===runtime))g('iam','service-accounts','create','nmt-test-runtime','--display-name=NMT-test-runtime');
 const roleId='nmtTestIdentityReader',roleFile=resolve(root,'.local/nmt-identity-role.json');
 mkdirSync(resolve(root,'.local'),{recursive:true});
 writeFileSync(roleFile,JSON.stringify({title:'NMT test identity reader',stage:'GA',includedPermissions:['iam.serviceAccounts.get','resourcemanager.projects.get','serviceusage.services.use']}));
 const roles=JSON.parse(g('iam','roles','list','--format=json'));
 g('iam','roles',roles.some(r=>r.name==='projects/'+project+'/roles/'+roleId)?'update':'create',roleId,'--file="'+roleFile+'"');
 for(const role of ['roles/cloudtranslate.user','roles/datastore.user','roles/speech.client','projects/'+project+'/roles/'+roleId])g('projects','add-iam-policy-binding',project,'--member=serviceAccount:'+runtime,'--role='+role);
 const databases=JSON.parse(g('firestore','databases','list','--format=json'));
 if(!databases.some(d=>d.name.endsWith('/(default)')))g('firestore','databases','create','--database=(default)','--location=asia-east1','--type=firestore-native');
 const secrets=JSON.parse(g('secrets','list','--format=json'));
 for(const name of ['LINE_CHANNEL_SECRET','LINE_CHANNEL_ACCESS_TOKEN','LINE_OWNER_USER_ID']){
  if(!secrets.some(s=>s.name.endsWith('/secrets/'+name)))g('secrets','create',name,'--replication-policy=automatic');
  g('secrets','add-iam-policy-binding',name,'--member=serviceAccount:'+runtime,'--role=roles/secretmanager.secretAccessor');
 }
 const buckets=JSON.parse(g('storage','buckets','list','--format=json'));
 const bucket='gs://'+project+'-nmt-glossaries';
 if(!buckets.some(b=>b.name===bucket||b.name===bucket.slice(5)||b.storage_url===bucket+'/'))g('storage','buckets','create',bucket,'--location=us-central1','--uniform-bucket-level-access');
 console.log('Resources provisioned. Set only new OA secrets separately; then initialize-ledger and glossaries.');
}
if(action==='initialize-ledger'){
 const db=getFirestore(initializeApp({projectId:project}));
 // create precondition refuses overwrite: no reset/resume can lower consumed budget.
 await db.doc(NMT_LEDGER_PATH).create(initialNmtLedger(project));
 await db.terminate();console.log('Ledger created once at '+NMT_LEDGER_PATH);
}
if(action==='enable-tracking-only'){
 const db=getFirestore(initializeApp({projectId:project}));
 try{console.log(JSON.stringify(await enableTrackingOnlyBudget(db,project)));}finally{await db.terminate();}
}
if(action==='glossaries'){
 const evidence=resolve(root,'.local/evidence');mkdirSync(evidence,{recursive:true});
 const recordPath=resolve(evidence,glossaryRecordFile);
 const legacy=JSON.parse(readFileSync(resolve(evidence,'nmt-glossary-resources-v9.json'),'utf8'));
 const prior=existsSync(recordPath)?JSON.parse(readFileSync(recordPath,'utf8')):undefined;
 const selected=process.argv.find(x=>x.startsWith('--direction='))?.slice(12);
 const client=new v3.TranslationServiceClient({projectId:project});
 try{
  const resources=await provisionNmtGlossaries({legacy,prior,selected,client,
   upload:(path,uri)=>g('storage','cp','"'+fileURLToPath(path)+'"',uri),
   save:record=>writeFileSync(recordPath,JSON.stringify(record,null,2).replace(/\n/g,'\r\n')+'\r\n')});
  console.log(JSON.stringify({recordPath,glossaries:resources.records.map(r=>({direction:r.direction,name:r.resource.name,entryCount:r.resource.entryCount}))}));
 }finally{await client.close();}
}
if(action==='deploy'||action==='deploy-check'){
 if(action==='deploy-check'&&process.env.GCLOUD_PROJECT!==project)throw Error('Firebase predeploy project mismatch');
 const envPath=resolve(root,'functions/.env.'+project);
 const env=readFileSync(envPath,'utf8');
 if(!/^TRANSLATION_ENGINE=nmt-glossary\r?$/m.test(env)||!env.includes('TEST_RUNTIME_SERVICE_ACCOUNT='+runtime)||!/^LINE_MENTION_ALIASES_JSON=\[\]\r?$/m.test(env))throw Error('Test runtime configuration mismatch');
 if(existsSync(resolve(root,'functions/.env.line-auto-translate-bot'))||existsSync(resolve(root,'functions/.env')))throw Error('Unscoped/production dotenv prohibited in test deploy');
 const db=getFirestore(initializeApp({projectId:project}));
 try{const ledger=validateNmtLedger((await db.doc(NMT_LEDGER_PATH).get()).data(),project);if(ledger.version===2)validateNmtPolicyHistory((await db.doc(NMT_MIGRATION_PATH).get()).data(),ledger);}finally{await db.terminate();}
 await verifyGlossaries(JSON.parse(readFileSync(resolve(root,'.local/evidence/'+glossaryRecordFile),'utf8')));
 if(action==='deploy'){
  const session={nonce:randomBytes(32).toString('hex'),project,account,createdAt:Date.now()},path=resolve(root,'.local/nmt-auth/deploy-session.json');
  writeFileSync(path,JSON.stringify(session),{flag:'wx'});
  try{command('firebase',['deploy','--only','functions:lineWebhook','--project='+project,'--account='+account,'--non-interactive'],false,{...process.env,NMT_DEPLOY_SESSION:session.nonce});}finally{unlinkSync(path);}
 }
}
