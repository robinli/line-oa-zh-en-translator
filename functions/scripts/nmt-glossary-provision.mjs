import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {glossarySpecs} from './nmt-glossary-spec.mjs';
import {NMT_TEST_PROJECT as project} from '../lib/nmt-isolation.js';
import {canonicalGlossary,validateGlossaryRecords,verifyGlossaries} from './nmt-local-guard.mjs';
export async function provisionNmtGlossaries({legacy,prior,selected,client,upload,save}){
 if(selected&&selected!=='zh-en')throw Error('Only the new zh-en direction may be provisioned separately');
 validateGlossaryRecords(legacy,{prior:true});
 if(prior&&prior.project!==project)throw Error('Glossary resource record project mismatch');
 if(prior)validateGlossaryRecords(prior);
 const records=structuredClone(prior?.records??[legacy.records.find(r=>r.direction==='en-zh')]);
 const parent='projects/'+project+'/locations/us-central1';
 for(const {direction,id,file,count,source:sourceLanguageCode,target:targetLanguageCode}of glossarySpecs){
  if(selected&&direction!==selected)continue;
  const path=new URL('../glossaries/'+file,import.meta.url),bytes=readFileSync(path),hash=createHash('sha256').update(bytes).digest('hex');
  if(bytes.toString('utf8').trim().split(/\r?\n/u).length!==count)throw Error('Glossary row count mismatch');
  const name=parent+'/glossaries/'+id,uri='gs://'+project+'-nmt-glossaries/'+file;
  let current;try{[current]=await client.getGlossary({name},{retry:{retryCodes:[]}});}catch(error){if(error.code!==5)throw error;}
  const recorded=records.find(r=>r.direction===direction);
  if(current){if(!recorded||recorded.sha256!==hash||JSON.stringify(canonicalGlossary(current))!==JSON.stringify(canonicalGlossary(recorded.resource)))throw Error('Existing glossary lacks matching provenance; no overwrite');continue;}
  if(recorded)throw Error('Previously provisioned glossary missing; no recreation');
  await upload(path,uri);
  const[operation]=await client.createGlossary({parent,glossary:{name,languagePair:{sourceLanguageCode,targetLanguageCode},inputConfig:{gcsSource:{inputUri:uri}}}},{retry:{retryCodes:[]}});
  const[created]=await operation.promise();if(created.entryCount!==count)throw Error('Created glossary count mismatch');
  const[resource]=await client.getGlossary({name},{retry:{retryCodes:[]}});
  records.push({direction,sha256:hash,resource:JSON.parse(JSON.stringify(resource))});
  validateGlossaryRecords({project,records});await save({project,records});
 }
 await verifyGlossaries({project,records},client);
 return{project,records};
}
