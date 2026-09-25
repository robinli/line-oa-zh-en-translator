import {validateGlossaryRecords} from './nmt-local-guard.mjs';
import {artifactHashes,caseKey,encodeJob,loadFixedCases,options,callOptions,ranges,rubric,sha,coreIds} from './nmt-evaluation-contract.mjs';
import {NmtGlossaryTranslator,NMT_GLOSSARY_ADAPTER_VERSION} from '../lib/nmt-glossary-translator.js';
import {assertNmtRequest,assertNmtIdentity} from '../lib/nmt-isolation.js';
import {countNmtCharacters,NMT_LIMITS,normalizeNmtBudgetMode} from '../lib/nmt-budget.js';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=reason=>{throw Error('NMT evidence provenance: '+reason);};
const digestMap=value=>value&&Object.keys(value).length>0&&Object.values(value).every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x));
export async function validateNmtContract(contract,{currentCandidate=true,aggregate=false}={}){
 if(!contract||!Array.isArray(contract.jobs)||!contract.jobs.length||!Object.hasOwn(NMT_LIMITS,contract.category)||contract.category==='manual')fail('invalid contract schema');
 const budgetMode=normalizeNmtBudgetMode(contract.budgetMode);
 if(currentCandidate&&!Object.hasOwn(contract,"budgetMode"))fail("current contract requires frozen budget mode");
 const {contractHash,summary,...payload}=contract;
 const legacyGlossary=!currentCandidate&&contract.options?.glossaryEnZh===options.glossaryEnZh.replace(/-v9$/u,'-v8');
 const priorGlossary=!currentCandidate&&contract.options?.glossaryZhEn===options.glossaryZhEn.replace(/-v12$/u,'-v8');
 const expectedOptions={...options,...(priorGlossary?{glossaryZhEn:options.glossaryZhEn.replace(/-v12$/u,'-v8')}:{}),...(legacyGlossary?{glossaryEnZh:options.glossaryEnZh.replace(/-v9$/u,'-v8')}:{} )};
 if(!/^[a-f0-9]{64}$/.test(contractHash)||sha(JSON.stringify(payload))!==contractHash)fail('contract hash mismatch');
 if(!/^nmt-glossary-v[0-9]+$/.test(contract.version)||currentCandidate&&contract.version!==NMT_GLOSSARY_ADAPTER_VERSION||!equal(contract.options,expectedOptions)||!equal(contract.callOptions,callOptions)||!equal(contract.rubric,rubric))fail('candidate/config/rubric mismatch');
 if(!digestMap(contract.artifactHashes)||!digestMap(contract.datasetHashes)||!contract.glossaryResources)fail('missing frozen artifacts/resources');
 validateGlossaryRecords(contract.glossaryResources,{legacy:legacyGlossary,prior:priorGlossary});
 if(currentCandidate&&!equal(contract.artifactHashes,artifactHashes()))fail('candidate artifact mismatch');
 const fixed=loadFixedCases();for(const[file,hash]of Object.entries(fixed.hashes))if(contract.datasetHashes[file]!==hash)fail('fixed dataset mismatch');
 const expectedKeys=new Set(),firstKeys=new Set();
 for(const job of contract.jobs){
  if(!job.sample||!Number.isSafeInteger(job.round)||job.round<1||job.round>3||job.key!==sha(caseKey(job.sample))+':'+job.round||expectedKeys.has(job.key))fail('invalid source/direction/job');
  expectedKeys.add(job.key);if(job.round===1)firstKeys.add(caseKey(job.sample));
  if(!equal(job.callOptions,callOptions))fail('job options mismatch');
  if(Object.keys(job).some(k=>!['key','sample','round','request','callOptions','characters','skippedOutput'].includes(k)))fail('unknown job field');
  // Current candidates must reproduce their source encoding. Archived producer contracts
  // keep their exact original wire: replay compares it to the new checker per job below.
  if(currentCandidate||!job.request){const encoded=await encodeJob(job.sample,job.round);if(!equal(job,encoded))fail('job request does not encode its source exactly');}
  if(job.request){assertNmtRequest(job.request,legacyGlossary,priorGlossary);if(job.request.glossaryConfig?.glossary!==(job.sample.sourceLanguage==='en'?contract.options.glossaryEnZh:contract.options.glossaryZhEn))fail('producer glossary does not match frozen options');if(job.request.sourceLanguageCode!==job.sample.sourceLanguage||job.request.targetLanguageCode!==job.sample.targetLanguage||countNmtCharacters(job.request.contents)!==job.characters)fail('producer source direction/character mismatch');}
  if(contract.category!=='verification'){
   const sample=fixed.cases.find(s=>caseKey(s)===caseKey(job.sample));if(!sample||!equal(sample,job.sample))fail('fixed fixture/aliases changed');
  }else if(fixed.cases.some(s=>caseKey(s)===caseKey(job.sample)))fail('verification case overlaps fixed fixtures');
 }
 if(contract.category==='verification'&&(contract.jobs.length!==20||firstKeys.size!==20||!contract.datasetHashes['verification-fixture']))fail('verification fixture scope mismatch');
 const counts={logicalCases:330,uniqueCases:318,selectedCases:firstKeys.size,results:contract.jobs.length,requests:contract.jobs.filter(j=>j.request).length,characters:contract.jobs.reduce((n,j)=>n+(j.request?countNmtCharacters(j.request.contents):0),0),skipped:contract.jobs.filter(j=>!j.request).length};
 if(aggregate){const expected=fixed.cases.flatMap(sample=>[1,...(sample.aliases.some(a=>coreIds.includes(a.id))?[2,3]:[])].map(round=>sha(caseKey(sample))+':'+round));if(contract.category!=='regression'||!equal([...expectedKeys].sort(),expected.sort()))fail('aggregate requires all fixed keys and rounds');}
 if(!equal(summary,counts)||!aggregate&&budgetMode==='capped'&&counts.characters>NMT_LIMITS[contract.category])fail('encoded summary/budget mismatch');
 return contract;
}
export async function validateNmtEvidence(evidence,{freeze,allowIncomplete=false,currentCandidate=true,replayOutputs=true}={}){
 if(evidence?.kind!=='NMT-live-synthetic'||evidence.fixtureOnly||!Array.isArray(evidence.results))fail('live evidence required; fixture-only artifacts prohibited');
 await validateNmtContract(evidence.contract,{currentCandidate});
 if(!freeze||!equal(freeze,evidence.contract)||evidence.contractHash!==freeze.contractHash)fail('independent freeze mismatch');
 assertNmtIdentity(evidence.identity);
 const jobs=new Map(freeze.jobs.map(j=>[j.key,j])),seen=new Set();
 if(!allowIncomplete&&evidence.results.length!==jobs.size)fail('incomplete result set');
 for(const result of evidence.results){
  const job=jobs.get(result.key);if(!job||seen.has(result.key))fail('missing/duplicate result job');seen.add(result.key);
  if(result.source!==job.sample.source||result.sourceLanguage!==job.sample.sourceLanguage||result.targetLanguage!==job.sample.targetLanguage||result.id!==job.sample.id||result.round!==job.round||!equal(result.aliases,job.sample.aliases)||!Array.isArray(result.attempts))fail('result source/direction/identity mismatch');
  const attempts=result.attempts;
  if(!job.request){
   if(result.status!=='skipped'||attempts.length||result.text!==job.skippedOutput?.text||!equal(result.ranges,job.skippedOutput?.ranges))fail('unverified code-only skip');
   continue;
  }
  if(allowIncomplete&&result.status==='pending'&&attempts.length===0)continue;
  if(attempts.length!==1)fail('one complete provider attempt required');
  const attempt=attempts[0];assertNmtRequest(attempt.request,!currentCandidate&&freeze.options.glossaryEnZh.endsWith('-v8'),!currentCandidate&&freeze.options.glossaryZhEn.endsWith('-v8'));
  if(!equal(attempt.request,job.request)||!equal(attempt.callOptions,job.callOptions))fail('recorded request/options/model mismatch');
  if(allowIncomplete&&['pending','service_error'].includes(result.status)){if(result.status==='service_error'&&!attempt.error)fail('service failure diagnostic missing');continue;}
  if(!['output','rejected'].includes(result.status)||!attempt.response||typeof attempt.response!=='object'||Array.isArray(attempt.response)||attempt.error)fail('recorded response/status missing');
  if(result.status==='output'&&(!Array.isArray(attempt.response.glossaryTranslations)||attempt.response.glossaryTranslations.length!==job.request.contents.length||attempt.response.glossaryTranslations.some(t=>typeof t?.translatedText!=='string'||!t.translatedText.trim())))fail('valid glossary response required');
  if(!replayOutputs)continue;
  let output,failure;try{output=await new NmtGlossaryTranslator(options,{async translateText(request,opts){if(!equal(request,attempt.request)||!equal(opts,attempt.callOptions))fail('replay request mismatch');return[structuredClone(attempt.response)];}}).translateWithRanges(result.source,result.sourceLanguage,result.targetLanguage,{protectedRanges:ranges(job.sample)});}catch(error){failure=error;}
  if(result.status==='output'&&(!output||result.text!==output.text||!equal(result.ranges,output.ranges))||result.status==='rejected'&&(!failure?.reason||failure.reason!==result.reason))fail('stored output does not reproduce recorded response');
 }
 return evidence;
}
