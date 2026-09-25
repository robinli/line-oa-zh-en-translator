import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {validateNmtEvidence} from './nmt-evidence.mjs';
import {NmtGlossaryTranslator} from '../lib/nmt-glossary-translator.js';
import {options,ranges,sha,artifactHashes,callOptions} from './nmt-evaluation-contract.mjs';
const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
const sourcePath=arg('recording');if(!sourcePath)throw Error('--recording is required');
const bytes=readFileSync(sourcePath),recording=JSON.parse(bytes);const legacy=process.argv.includes('--legacy-tllm');
if(legacy&&!String(recording.adapterVersion).startsWith('candidate-context-quantity'))throw Error('Unexpected legacy provenance');
if(!legacy)await validateNmtEvidence(recording,{freeze:recording.contract,allowIncomplete:true,currentCandidate:false,replayOutputs:false});
const results=[];
for(const recorded of recording.results){
 const sample={...recorded,mentions:recorded.mentions??recording.contract?.jobs.find(j=>j.key===recorded.key)?.sample.mentions};
 const first=recorded.attempts?.[0];if(!first?.response){results.push({id:recorded.id,round:recorded.round,status:'no-recorded-response'});continue;}
 let matched=false;
 const client={async translateText(request,opts){
  const compatible=legacy?{...first.request,parent:request.parent,model:request.model,glossaryConfig:request.glossaryConfig}:first.request;
  if(JSON.stringify(compatible)!==JSON.stringify(request)||JSON.stringify(first.callOptions??callOptions)!==JSON.stringify(opts))throw Error('recorded_request_mismatch');
  matched=true;return[structuredClone(first.response)];
 }};
 try{const result=await new NmtGlossaryTranslator(options,client).translateWithRanges(sample.source,sample.sourceLanguage,sample.targetLanguage,{protectedRanges:ranges(sample)});results.push({id:sample.id,round:recorded.round,status:'output',...result});}
 catch(error){results.push({id:sample.id,round:recorded.round,status:matched?'rejected':'incompatible_request',reason:error.reason??'recorded_request_mismatch'});}
}
const result={kind:legacy?'old-TLLM-response-offline-check-NOT-NMT-quality-evidence':'NMT-recorded-response-replay',source:{path:resolve(sourcePath),sha256:sha(bytes),adapterVersion:recording.adapterVersion??recording.contract?.version,producerContract:recording.contract,hashes:recording.hashes,datasetHashes:recording.datasetHashes,options:recording.options,contractHash:recording.contractHash},currentArtifactHashes:artifactHashes(),requestCompatibility:legacy?'Only target project/model/glossary intentionally differ. All content, language, HTML and call options must match first recorded request; no second-attempt replay.':'Complete request and call options exact',results,summary:Object.fromEntries(['output','rejected','incompatible_request','no-recorded-response'].map(status=>[status,results.filter(r=>r.status===status).length]))};
const output=arg('output');if(!output)throw Error('--output is required');mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2).replace(/\n/g,'\r\n')+'\r\n');console.log(JSON.stringify({path:output,kind:result.kind,...result.summary}));
