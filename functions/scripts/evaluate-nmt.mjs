import {executionLock,preflightBudget} from './nmt-evaluation-plan.mjs';
import {nmtFailure} from '../lib/nmt-diagnostics.js';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateNmtEvidence} from './nmt-evidence.mjs';
import {createContract,artifactHashes,options,ranges,sha} from './nmt-evaluation-contract.mjs';
import {NmtGlossaryTranslator} from '../lib/nmt-glossary-translator.js';
import {ControlledNmtClient,AuthenticatedNmtTransport} from '../lib/nmt-controlled-client.js';
import {FirestoreNmtBudget,NMT_LIMITS,NMT_LEDGER_PATH,normalizeNmtBudgetMode} from '../lib/nmt-budget.js';
import {NMT_TEST_PROJECT} from '../lib/nmt-isolation.js';
const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
const category=arg('category')??'regression';if(!Object.hasOwn(NMT_LIMITS,category)||category==='manual')throw Error('Invalid evaluation category');
const contract=await createContract({category,ids:arg('ids')?.split(','),fixture:arg('fixture'),budgetMode:arg('budget-mode')??'capped'});
if(normalizeNmtBudgetMode(contract.budgetMode)==='capped'&&contract.summary.characters>NMT_LIMITS[category])throw Error('Selected encoded input exceeds category budget');
const save=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(value,null,2).replace(/\n/g,'\r\n')+'\r\n');renameSync(path+'.tmp',path);};
const output=resolve(arg('output')??fileURLToPath(new URL('../../.local/evidence/nmt-'+(process.argv.includes('--dry-run')?'dry-run':'results-'+new Date().toISOString().replace(/[:.]/g,'-'))+'.json',import.meta.url)));
if(process.argv.includes('--dry-run')){save(output,contract);console.log(JSON.stringify({output,contractHash:contract.contractHash,...contract.summary}));}
else {
 if(!process.argv.includes('--execute'))throw Error('Live NMT evaluation requires explicit --execute and reviewed --freeze');
 const freeze=JSON.parse(readFileSync(arg('freeze'),'utf8'));if(freeze.contractHash!==contract.contractHash||JSON.stringify(freeze)!==JSON.stringify(contract))throw Error('Frozen request/candidate/rubric contract mismatch');
 if(['regression','retest'].includes(category))throw Error('Regression/retest execution requires the approved key plan; use plan-nmt.mjs');
 const resumed=arg('resume')?JSON.parse(readFileSync(arg('resume'),'utf8')):undefined;
 if(resumed)await validateNmtEvidence(resumed,{freeze:contract,allowIncomplete:true});
 const results=resumed?.results??[];
 const release=executionLock();try {
 const {verifyLocalTarget,verifyGlossaries,requireProjectArgument}=await import('./nmt-local-guard.mjs');requireProjectArgument();const identity=await verifyLocalTarget();await verifyGlossaries(contract.glossaryResources);
 const {initializeApp}=await import('firebase-admin/app');const {getFirestore}=await import('firebase-admin/firestore');
 const db=getFirestore(initializeApp({projectId:NMT_TEST_PROJECT}));const transport=new AuthenticatedNmtTransport();
 const controlled=new ControlledNmtClient(transport,new FirestoreNmtBudget(db,NMT_TEST_PROJECT),category,()=>transport.identity());
 const completed=new Set(results.map(r=>r.key));
 const evidence={kind:'NMT-live-synthetic',startedAt:new Date().toISOString(),contractHash:contract.contractHash,contract,identity,resumedFrom:arg('resume')?{path:arg('resume'),sha256:sha(readFileSync(arg('resume')))}:undefined,results,reviewStatus:'pending-full-text-review'};
 try{
  const ledger=(await db.doc(NMT_LEDGER_PATH).get()).data();preflightBudget(ledger,{[category]:contract.jobs.filter(j=>!completed.has(j.key)).reduce((n,j)=>n+j.characters,0)},normalizeNmtBudgetMode(contract.budgetMode));
  for(const job of contract.jobs){if(completed.has(job.key))continue;
   if(JSON.stringify(artifactHashes())!==JSON.stringify(contract.artifactHashes))throw Error('Candidate changed during evaluation');
   const record={key:job.key,id:job.sample.id,aliases:job.sample.aliases,source:job.sample.source,sourceLanguage:job.sample.sourceLanguage,targetLanguage:job.sample.targetLanguage,round:job.round,status:'pending',attempts:[],metrics:[]};results.push(record);save(output,evidence);
   const client={async translateText(request,callOptions){
    if(JSON.stringify(request)!==JSON.stringify(job.request)||JSON.stringify(callOptions)!==JSON.stringify(job.callOptions))throw Error('Actual request differs from freeze');
    const attempt={request,callOptions};record.attempts.push(attempt);save(output,evidence);
    try{const [response]=await controlled.translateText(request,callOptions);attempt.response=response;save(output,evidence);return[response];}
    catch(error){const failure=nmtFailure(error,'provider');attempt.error='service_or_guard_error';attempt.diagnostic=failure.diagnostic;save(output,evidence);throw failure;}
   }};
   try{const result=await new NmtGlossaryTranslator({...options,onMetric:metric=>record.metrics.push(metric)},client).translateWithRanges(job.sample.source,job.sample.sourceLanguage,job.sample.targetLanguage,{protectedRanges:ranges(job.sample)});Object.assign(record,result,{status:job.request?'output':'skipped',review:'pending'});}
   catch(error){record.status=record.metrics.some(m=>m.outcome==='service_error')?'service_error':'rejected';record.reason=error.reason??'service_or_guard_error';}
   save(output,evidence);
   if(record.status==='service_error')break; // stop, preserve evidence; never automatically retry a paid attempt
  }
 }finally{await db.terminate();save(output,evidence);}
 console.log(JSON.stringify({output,results:results.length,expected:contract.jobs.length,complete:results.length===contract.jobs.length&&!results.some(r=>r.status==='pending'||r.status==='service_error'),reviewStatus:evidence.reviewStatus}));
 } finally {release();}
}
