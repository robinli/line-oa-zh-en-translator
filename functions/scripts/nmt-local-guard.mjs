import {glossarySpecs,legacyGlossarySpecs,priorGlossarySpecs} from './nmt-glossary-spec.mjs';
import {realpathSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {v3} from '@google-cloud/translate';
import {GoogleAuth} from 'google-auth-library';
import {NMT_TEST_PROJECT,NMT_TEST_PROJECT_NUMBER,NMT_TEST_ACCOUNT,NMT_TEST_BILLING,NMT_RUNTIME_ACCOUNT,canonicalNmtResourceName} from '../lib/nmt-isolation.js';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export function command(executable,args,json=false,env=process.env){
 const result=spawnSync(executable,args,{cwd:root,encoding:'utf8',shell:process.platform==='win32',windowsHide:true,env});
 if(result.status!==0)throw Error('Command failed: '+executable+' '+args.slice(0,3).join(' '));
 return json?JSON.parse(result.stdout):result.stdout.trim();
}
export function assertIsolatedEnvironment(env){
 for(const [name,value]of Object.entries(env))if(value&&(/^(?:CLOUDSDK_AUTH_|CLOUDSDK_API_ENDPOINT_OVERRIDES_)/.test(name)||/^(?:FIREBASE_.*(?:URL|HOST|TOKEN|CLIENT_ID|CLIENT_SECRET)|GOOGLE_OAUTH_ACCESS_TOKEN|TRADE_EVAL_TOKEN|TRANSLATION_EVAL_TOKEN|FIRESTORE_EMULATOR_HOST|GCE_METADATA_HOST|GCE_METADATA_IP|GOOGLE_API_USE_MTLS_ENDPOINT|GOOGLE_CLOUD_UNIVERSE_DOMAIN|CLOUDSDK_CORE_UNIVERSE_DOMAIN|CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE|CLOUDSDK_CORE_DISABLE_SSL_VALIDATION)$/u.test(name)))throw Error('Conflicting credential/endpoint: '+name);
}
export function localPaths({env=process.env,realpath=realpathSync,read=readFileSync}={}){
 assertIsolatedEnvironment(env);
 const sdk=resolve(root,'.local/nmt-auth/gcloud'),adc=resolve(sdk,'application_default_credentials.json'),firebase=resolve(root,'.local/nmt-auth/firebase');
 const equal=(a,b)=>realpath(a).toLowerCase()===realpath(b).toLowerCase();
 if(!env.CLOUDSDK_CONFIG||!env.GOOGLE_APPLICATION_CREDENTIALS||!env.XDG_CONFIG_HOME||!equal(env.CLOUDSDK_CONFIG,sdk)||!equal(env.GOOGLE_APPLICATION_CREDENTIALS,adc)||!equal(env.XDG_CONFIG_HOME,firebase))throw Error('Explicit isolated CLI, ADC and Firebase paths required');
 const credentials=JSON.parse(read(adc,'utf8'));
 if(credentials.type!=='authorized_user'||credentials.quota_project_id!==NMT_TEST_PROJECT)throw Error('Isolated user ADC quota project required');
 return{sdk,adc,firebase};
}
const set=value=>value!==undefined&&value!==null&&value!==''&&value!=='(unset)';
export function assertGcloudConfiguration(config){
 if(config.core?.account!==NMT_TEST_ACCOUNT||config.core?.project!==NMT_TEST_PROJECT)throw Error('CLI effective account/project mismatch');
 for(const key of ['impersonate_service_account','credential_file_override','access_token_file','login_config_file'])if(set(config.auth?.[key]))throw Error('CLI credential override prohibited');
 if(config.auth?.disable_credentials===true||config.auth?.disable_credentials==='true'||config.core?.disable_ssl_validation===true||config.core?.disable_ssl_validation==='true'||set(config.core?.custom_ca_certs_file))throw Error('CLI credential/TLS override prohibited');
 for(const [key,expected]of Object.entries({auth_host:'https://accounts.google.com/o/oauth2/auth',token_host:'https://oauth2.googleapis.com/token',mtls_token_host:'https://oauth2.mtls.googleapis.com/token'}))if(set(config.auth?.[key])&&config.auth[key]!==expected)throw Error('CLI authentication endpoint override prohibited');
 if(set(config.core?.universe_domain)&&config.core.universe_domain!=='googleapis.com')throw Error('CLI universe override prohibited');
 if(Object.values(config.api_endpoint_overrides??{}).some(set))throw Error('CLI API endpoint override prohibited');
}
export function assertFirebaseStore(store){
 const all=[...(store.user&&store.tokens?[{user:store.user,tokens:store.tokens}]:[]),...(store.additionalAccounts??[])];
 if(all.length!==1||all[0].user?.email!==NMT_TEST_ACCOUNT||!all[0].tokens?.refresh_token||Object.values(store.activeAccounts??{}).some(email=>email!==NMT_TEST_ACCOUNT))throw Error('Firebase effective account is not exclusively the isolated test principal');
 return all[0];
}
export function assertDeploySession(session,nonce,now=Date.now()){
 if(!nonce||session?.nonce!==nonce||session.project!==NMT_TEST_PROJECT||session.account!==NMT_TEST_ACCOUNT||!Number.isSafeInteger(session.createdAt)||now<session.createdAt||now-session.createdAt>600000)throw Error('Direct Firebase deploy prohibited; use nmt-admin deploy');
}
export function requireDeploySession(){
 const nonce=process.env.NMT_DEPLOY_SESSION;if(!nonce)throw Error('Direct Firebase deploy prohibited; use nmt-admin deploy');
 assertDeploySession(JSON.parse(readFileSync(resolve(root,'.local/nmt-auth/deploy-session.json'),'utf8')),nonce);
}
async function firebaseToken(){
 const store=JSON.parse(readFileSync(resolve(root,'.local/nmt-auth/firebase/configstore/firebase-tools.json'),'utf8'));
 const selected=assertFirebaseStore(store);
 const library=resolve(command('npm',['root','-g']),'firebase-tools/lib/auth.js');
 const auth=await import(pathToFileURL(library).href);
 const token=await auth.getAccessToken(selected.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/userinfo.email']);
 return token.access_token;
}
export async function verifyLocalTarget({runtimeRequired=true,firebaseRequired=false}={},deps={}){
 (deps.localPaths??localPaths)();const run=deps.command??command,request=deps.fetch??fetch;
 assertGcloudConfiguration(run('gcloud',['config','list','--all','--format=json'],true));
 const principal=async(token,label)=>{if(!token)throw Error(label+' token unavailable');const r=await request('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token='+encodeURIComponent(token),{signal:AbortSignal.timeout(15000)});if(!r.ok||(await r.json()).email!==NMT_TEST_ACCOUNT)throw Error(label+' effective principal mismatch');};
 // Verify the token gcloud actually uses, not merely its login inventory.
 await principal(run('gcloud',['auth','print-access-token']),'CLI');
 const auth=deps.adc??new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/userinfo.email']});
 await principal(await auth.getAccessToken(),'ADC');
 if(firebaseRequired)await principal(await(deps.firebaseToken??firebaseToken)(),'Firebase');
 const project=run('gcloud',['projects','describe',NMT_TEST_PROJECT,'--format=json'],true);
 const billing=run('gcloud',['billing','projects','describe',NMT_TEST_PROJECT,'--format=json'],true);
 if(project.projectId!==NMT_TEST_PROJECT||String(project.projectNumber)!==NMT_TEST_PROJECT_NUMBER||project.lifecycleState!=='ACTIVE'||billing.billingEnabled!==true||billing.billingAccountName!=='billingAccounts/'+NMT_TEST_BILLING)throw Error('Live project/billing mismatch');
 if(runtimeRequired){const sa=run('gcloud',['iam','service-accounts','describe',NMT_RUNTIME_ACCOUNT,'--project='+NMT_TEST_PROJECT,'--format=json'],true);if(sa.email!==NMT_RUNTIME_ACCOUNT||sa.disabled)throw Error('Runtime service account mismatch');}
 return{projectId:NMT_TEST_PROJECT,projectNumber:NMT_TEST_PROJECT_NUMBER,principal:NMT_TEST_ACCOUNT,billingAccount:billing.billingAccountName,billingEnabled:true,runtimeAccount:NMT_RUNTIME_ACCOUNT,checkedAt:new Date().toISOString()};
}
export function requireProjectArgument(){if(!process.argv.includes('--project='+NMT_TEST_PROJECT))throw Error('Explicit --project='+NMT_TEST_PROJECT+' is required');}
export function canonicalGlossary(resource){return{...resource,name:canonicalNmtResourceName(resource.name)};}
export function validateGlossaryRecords(lock,{legacy=false,prior=false}={}){
 if(lock?.project!==NMT_TEST_PROJECT||!Array.isArray(lock.records)||lock.records.length!==2)throw Error('Both provisioned glossary resource records required');
 for(const {direction,id,file,source,target,count}of (legacy?legacyGlossarySpecs:prior?priorGlossarySpecs:glossarySpecs)){
  const record=lock.records.find(r=>r.direction===direction),name='projects/'+NMT_TEST_PROJECT+'/locations/us-central1/glossaries/'+id;
  const hash=createHash('sha256').update(readFileSync(resolve(root,'functions/glossaries/'+file))).digest('hex');
  if(!record||record.sha256!==hash||canonicalNmtResourceName(record.resource.name)!==name||record.resource.entryCount!==count||record.resource.languagePair?.sourceLanguageCode!==source||record.resource.languagePair?.targetLanguageCode!==target||record.resource.inputConfig?.gcsSource?.inputUri!=='gs://'+NMT_TEST_PROJECT+'-nmt-glossaries/'+file)throw Error('Frozen glossary source/config mismatch');
 }
 return lock.records;
}
export async function verifyGlossaries(lock,providedClient){
 const records=validateGlossaryRecords(lock),client=providedClient??new v3.TranslationServiceClient({projectId:NMT_TEST_PROJECT});
 try{for(const record of records){
  const name=canonicalNmtResourceName(record.resource.name);
  const[live]=await client.getGlossary({name},{retry:{retryCodes:[]}});if(JSON.stringify(canonicalGlossary(live))!==JSON.stringify(canonicalGlossary(record.resource)))throw Error('Live glossary resource changed');
 }}finally{if(!providedClient)await client.close();}
}
