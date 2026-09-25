import {nmtFailure} from '../lib/nmt-diagnostics.js';
import {NmtGlossaryTranslator} from '../lib/nmt-glossary-translator.js';
import {options,ranges} from './nmt-evaluation-contract.mjs';
// Checkpoint before dispatch and immediately after receiving a response. Never retry.
export async function collectNmtJobs({contract,results,client,save,checkCandidate}){
 const completed=new Set(results.map(row=>row.key));
 for(const job of contract.jobs){if(completed.has(job.key))continue;checkCandidate();
  const record={key:job.key,id:job.sample.id,aliases:job.sample.aliases,source:job.sample.source,sourceLanguage:job.sample.sourceLanguage,targetLanguage:job.sample.targetLanguage,round:job.round,status:'pending',attempts:[],metrics:[]};results.push(record);save();
  const recordingClient={async translateText(request,callOptions){
   if(JSON.stringify(request)!==JSON.stringify(job.request)||JSON.stringify(callOptions)!==JSON.stringify(job.callOptions))throw Error('Actual request differs from freeze');
   const attempt={request,callOptions};record.attempts.push(attempt);save();
   try{const[response]=await client.translateText(request,callOptions);attempt.response=response;save();return[response];}
   catch(error){const failure=nmtFailure(error,'provider');attempt.error='service_or_guard_error';attempt.diagnostic=failure.diagnostic;save();throw failure;}
  }};
  try{const result=await new NmtGlossaryTranslator({...options,onMetric:metric=>record.metrics.push(metric)},recordingClient).translateWithRanges(job.sample.source,job.sample.sourceLanguage,job.sample.targetLanguage,{protectedRanges:ranges(job.sample)});Object.assign(record,result,{status:job.request?'output':'skipped',review:'pending'});}
  catch(error){record.status=record.metrics.some(m=>m.outcome==='service_error')?'service_error':'rejected';record.reason=error.reason??'service_or_guard_error';}
  save();if(record.status==='service_error')break;
 }
}
