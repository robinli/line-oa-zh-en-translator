import {validateMergedEvidence} from './nmt-evaluation-plan.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateNmtEvidence} from './nmt-evidence.mjs';
import {coreIds,rubric} from './nmt-evaluation-contract.mjs';
const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
const sha=x=>createHash('sha256').update(x).digest('hex');
const input=arg('results'),output=arg('output');if(!input||!output)throw Error('--results and --output required');
const bytes=readFileSync(input),evidence=JSON.parse(bytes);
const freezePath=arg('freeze');if(!freezePath)throw Error('--freeze is required for the independent request contract');
const freeze=JSON.parse(readFileSync(freezePath,'utf8'));
if(evidence.kind==='NMT-multi-producer-offline-checked'){if(JSON.stringify(freeze)!==JSON.stringify(evidence.plan))throw Error('Independent plan freeze mismatch');await validateMergedEvidence(evidence);}else await validateNmtEvidence(evidence,{freeze});
const evidenceHash=r=>sha(JSON.stringify({source:r.source,text:r.text,status:r.status,reason:r.reason,attempts:r.attempts}));
if(process.argv.includes('--template')){
 writeFileSync(output,JSON.stringify({resultsSha256:sha(bytes),reviewer:'',reviews:evidence.results.map(r=>({key:r.key,evidenceHash:evidenceHash(r),verdict:'pending',reason:'',issues:[]}))},null,2).replace(/\n/g,'\r\n')+'\r\n');
}else{
 const review=JSON.parse(readFileSync(arg('review'),'utf8'));
 if(review.resultsSha256!==sha(bytes)||!review.reviewer||review.reviews.length!==evidence.results.length||new Set(review.reviews.map(r=>r.key)).size!==review.reviews.length)throw Error('Review provenance/completeness mismatch');
 const expected=evidence.contract.jobs;const problems=[];
 if(evidence.results.length!==expected.length||new Set(evidence.results.map(r=>r.key)).size!==expected.length)problems.push('incomplete-results');
 const verdicts=new Map();
 for(const result of evidence.results){
  const job=expected.find(j=>j.key===result.key),item=review.reviews.find(r=>r.key===result.key);
  if(!job||!item||item.evidenceHash!==evidenceHash(result)||!['usable','safe_rejection','defect'].includes(item.verdict)||!item.reason)throw Error('Every exact full output requires an explicit review');
  if(item.verdict==='defect'||item.issues.some(i=>['Blocking','High','Medium'].includes(i.severity)))problems.push(result.key+':quality-finding');
  if(item.verdict==='usable'&&!['output','skipped'].includes(result.status))problems.push(result.key+':not-usable-output');
  if(result.status==='skipped'&&(job.request||result.text!==job.skippedOutput?.text))problems.push(result.key+':incorrect-skip');
  if(item.verdict==='safe_rejection'){
   if(result.status!=='rejected'||!result.reason)problems.push(result.key+':not-quality-rejection');
   if(!(job.sample.aliases??[]).length||job.sample.aliases.some(a=>!(rubric[a.set]?.allowedRejections??[]).includes(a.id)))problems.push(result.key+':unapproved-rejection');
  }
  verdicts.set(result.key,item.verdict);
 }
 const usable=jobs=>jobs.filter(j=>verdicts.get(j.key)==='usable').length;const groups={};
 const full=evidence.contract.category==='regression'&&expected.length===336;
 if(full){
  for(const set of ['main','comparison','oldHoldout']){const jobs=expected.filter(j=>j.round===1&&j.sample.aliases.some(a=>a.set===set));groups[set]={total:jobs.length,usable:usable(jobs),required:rubric[set].minimumUsable};}
  const unique=expected.filter(j=>j.round===1),core=expected.filter(j=>j.sample.aliases.some(a=>coreIds.includes(a.id)));
  groups.unique={total:unique.length,usable:usable(unique),required:309};groups.core={total:core.length,usable:usable(core),required:27};
 }else if(evidence.contract.category==='verification'){groups.verification={total:expected.length,usable:usable(expected),required:20};}
 else problems.push('partial-scope-cannot-pass-full-regression');
 for(const [name,group]of Object.entries(groups))if(group.usable<group.required)problems.push(name+':below-threshold');
 const result={kind:'NMT-reviewed-quality-gate',resultsSha256:sha(bytes),reviewSha256:sha(readFileSync(arg('review'))),contractHash:evidence.contractHash,reviewer:review.reviewer,groups,problems,passed:problems.length===0,independentVerification:'not-asserted-by-this-tool'};
 writeFileSync(output,JSON.stringify(result,null,2).replace(/\n/g,'\r\n')+'\r\n');console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
