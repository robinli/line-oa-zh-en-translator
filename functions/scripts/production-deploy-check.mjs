import assert from 'node:assert/strict';
import {readFileSync, readdirSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const project='line-auto-translate-bot',account='ruibbin@gmail.com',runtime='line-translator-runtime@'+project+'.iam.gserviceaccount.com';
export function validateProductionPackage(base=root){
 const manifest=JSON.parse(readFileSync(resolve(base,'prd-package.json'),'utf8'));assert.equal(manifest.project,project);assert.equal(manifest.status,'verified');assert.ok(Object.keys(manifest.files).length>300);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const actual={};const walk=dir=>{for(const item of readdirSync(dir,{withFileTypes:true})){const file=resolve(dir,item.name),key=relative(base,file).replaceAll('\\','/');
  if(['functions/node_modules','.local','prd-package.json','verify.log','deploy.log','firebase-debug.log'].includes(key)||/^firebase-debug\./.test(key))continue;
  assert.ok(!lstatSync(file).isSymbolicLink(),'Unexpected link '+key);if(item.isDirectory())walk(file);else actual[key]=hash(readFileSync(file));}};walk(base);assert.deepEqual(actual,manifest.files,'Frozen PRD package changed');
 const aliases=Object.values(JSON.parse(readFileSync(resolve(base,'.firebaserc'),'utf8')).projects);assert.deepEqual(aliases,[project]);
 const env=readFileSync(resolve(base,'functions/.env.'+project),'utf8');const values={};for(const line of env.split(/\r\n|\n|\r/)){if(!line||line.startsWith('#'))continue;const i=line.indexOf('=');assert.ok(i>0);const key=line.slice(0,i);assert.ok(!Object.hasOwn(values,key));values[key]=line.slice(i+1);}
 assert.equal(values.TRANSLATION_ENGINE,'nmt-direct');assert.equal(values.NMT_REQUEST_PROFILE,'nmt-direct-v1');assert.equal(values.TEST_RUNTIME_SERVICE_ACCOUNT,runtime);
 assert.ok(!readdirSync(resolve(base,'functions')).some(n=>n.startsWith('.env')&&n!=='.env.'+project));
 return {manifest,values};
}
function gcloud(args){const result=spawnSync('gcloud.cmd',args,{encoding:'utf8',shell:true,windowsHide:true});assert.equal(result.status,0,'gcloud check failed');return result.stdout.trim();}
export function verifyProductionDeployment(base=root){
 assert.equal(process.versions.node.split('.')[0],'22');assert.equal(process.env.GCLOUD_PROJECT,project,'Explicit PRD predeploy target required');validateProductionPackage(base);
 assert.equal(gcloud(['auth','list','--filter=status:ACTIVE','--format=value(account)']),account,'Wrong deployment principal');
 const fn=JSON.parse(gcloud(['functions','describe','lineWebhook','--gen2','--region=asia-east1','--project='+project,'--format=json']));assert.equal(fn.name,'projects/'+project+'/locations/asia-east1/functions/lineWebhook');assert.equal(fn.serviceConfig.serviceAccountEmail,runtime);
 const plan=JSON.parse(readFileSync(resolve(base,'.local/prd-before.json'),'utf8'));assert.equal(fn.serviceConfig.revision,plan.revision,'PRD changed during deployment preparation');
 assert.deepEqual(fn.serviceConfig.secretEnvironmentVariables,plan.secretEnvironmentVariables,'PRD secret bindings changed');
 console.log(JSON.stringify({status:'PRD_DEPLOY_CHECK_PASS',project,revision:fn.serviceConfig.revision}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))verifyProductionDeployment();