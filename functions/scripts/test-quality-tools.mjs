import test from 'node:test';
import assert from 'node:assert/strict';
import {exportOptions,jsonValue,summarize,summarizeValidation,exportGroups,selectExportRows} from './export-translation-quality.mjs';
const root='E:/workspace';
const args=['--project=line-auto-translate-bot-dev','--from=2026-09-25','--to=2026-10-01'];
test('dynamic export includes new and disabled groups and preserves historical rows',()=>{
 const a='C'+'1'.repeat(32),b='C'+'2'.repeat(32),c='C'+'3'.repeat(32);
 const messages=[{groupId:a},{groupId:b},{groupId:c,groupName:'Historical'}],cases=[{groupId:b},{groupId:null}];
 const groups=exportGroups({groups:[{id:a,name:'Original'}]},[{id:b,groupName:'T1',recordingEnabled:false}],messages,cases);
 assert.equal(groups.length,3);assert.deepEqual(selectExportRows(groups,'all',messages,cases),{messages,cases});
 assert.deepEqual(selectExportRows(groups,'T1',messages,cases),{messages:[messages[1]],cases:[cases[0]]});
 assert.throws(()=>selectExportRows(groups,'missing',messages,cases));
 assert.deepEqual(selectExportRows([],'all',[],[]),{messages:[],cases:[]});
});
test('export date bounds cover inclusive Taipei days',()=>{
 const result=exportOptions(args,root);assert.equal(result.start.toISOString(),'2026-09-24T16:00:00.000Z');assert.equal(result.end.toISOString(),'2026-10-01T16:00:00.000Z');assert.equal(result.group,'all');
});
test('export cannot target production, invalid dates or tracked output',()=>{
 for(const change of [['--project=line-auto-translate-bot'],['--from=2026-02-30'],['--to=2026-09-23'],['--out=docs/output'],['--out=.local/../leak'],['--out=.local']])assert.throws(()=>exportOptions([...args,...change],root));
});
test('Unicode and Firestore timestamps survive JSONL conversion',()=>{
 const value=jsonValue({sourceText:'這是原文\n😀',timestamp:{toDate:()=>new Date('2026-09-25T00:00:00Z')},array:[new Date('2026-09-25T01:00:00Z')]});assert.deepEqual(value,{sourceText:'這是原文\n😀',timestamp:'2026-09-25T00:00:00.000Z',array:['2026-09-25T01:00:00.000Z']});assert.equal(JSON.parse(JSON.stringify(value)).sourceText,'這是原文\n😀');
});
test('summary separates translation, delivery and incomplete records',()=>{
 const base={groupId:'synthetic',eventTime:'2026-09-24T16:00:00Z'};
 const result=summarize([{...base,outcome:'translated',deliveryStatus:'failed',completedAt:'yes'},{...base,outcome:'skipped',completedAt:'yes'},{...base,outcome:'failed'},{...base,groupId:'other',outcome:'ignored',completedAt:'yes'}],[{}],{available:false,failedWriteAttempts:null});
 assert.equal(result.byGroupAndDay[0].day,'2026-09-25');assert.deepEqual(result.byGroupAndDay[0],{day:'2026-09-25',groupId:'synthetic',received:3,translated:1,skipped:1,failed:1,deliveryFailed:1,incomplete:1});assert.equal(result.storageDiagnostics.failedWriteAttempts,null);assert.equal(result.messageCount,4);
});

// New operation reconciliation remains independent of message recording and never guesses old costs.
test('operation reconciliation preserves unknown started states and unlinked history', async () => {
 const {summarizeOperations}=await import('./export-translation-quality.mjs');
 const result=summarizeOperations([
  {operationId:'one',claimedAt:'2026-09-30T01:00:00Z',providerStatus:'provider_succeeded',deliveryStatus:'sent',telemetry:{apiCalled:true,reservedCharacters:10,wireCharacters:10,outputCharacters:4}},
  {operationId:'two',claimedAt:'2026-09-30T01:00:00Z',providerStatus:'provider_started',deliveryStatus:'delivery_started',telemetry:{apiCalled:'unknown',reservedCharacters:12,wireCharacters:12}},
  {operationId:'three',claimedAt:'2026-09-30T01:00:00Z',providerStatus:'not_started',deliveryStatus:'not_attempted',telemetry:{apiCalled:false,reservedCharacters:0,wireCharacters:0}}
 ],[{operationId:'one'},{sourceText:'historical'},{operationId:'missing'}]);
 assert.equal(result.operationCount,3);assert.equal(result.historicalUnknown,1);assert.equal(result.qualityRowsLinked,1);assert.equal(result.unmatchedOperationReferences,1);
 assert.deepEqual(result.byDay[0],{period:'2026-09-30',operations:3,apiCalledTrue:1,apiCalledFalse:1,apiCalledUnknown:1,reservedCharacters:22,knownWireCharacters:10,unknownWireCharacters:12,outputCharacters:4,deliveryUnknown:1});
 assert.equal(result.byMonth[0].period,'2026-09');
});

test('known provider response remains known when provider completion persistence failed', async () => {
 const {summarizeOperations}=await import('./export-translation-quality.mjs');
 const result=summarizeOperations([{operationId:'known-return',claimedAt:'2026-09-30T01:00:00Z',providerStatus:'provider_started',deliveryStatus:'sent',telemetry:{apiCalled:true,reservedCharacters:10,wireCharacters:10,outputCharacters:4,failureStage:'provider_completion'}}]);
 assert.equal(result.byDay[0].apiCalledTrue,1);assert.equal(result.byDay[0].apiCalledUnknown,0);assert.equal(result.byDay[0].knownWireCharacters,10);assert.equal(result.byDay[0].outputCharacters,4);
});

test('validation summaries keep old rows unknown and never promote delivery success to semantic correctness', () => {
 const rows=[
  {outcome:'translated',deliveryStatus:'sent'},
  {requestProfile:'nmt-direct-v1',validationScope:'literal-integrity',semanticEvaluation:'not_evaluated'},
  {telemetry:{requestProfile:'nmt-direct-glossary-v1',validationScope:'literal-integrity',semanticEvaluation:'not_evaluated'}},
  {telemetry:{requestProfile:'unrecognized',validationScope:'invented',semanticEvaluation:'passed'}},
 ];
 const result=summarizeValidation(rows);
 assert.deepEqual(result.validationScopes,{'literal-integrity':2,unknown:2});
 assert.deepEqual(result.semanticEvaluation,{not_evaluated:2,unknown:2});
 assert.deepEqual(result.profiles,{unknown:2,'nmt-direct-v1':1,'nmt-direct-glossary-v1':1});
 assert.match(result.qualification,/does not certify semantic correctness/);
});

test('JSONL preserves raw NMT contents and keeps historical absence distinct from null', () => {
 const historical={sourceText:'old'};
 const raw={sourceText:'請確認 PP-BK。',nmtInputContents:['<div>請確認 <span translate="no">PP-BK</span></div>\r\n','😀'],nmtOutputContents:{translations:['raw first',null,''],glossaryTranslations:['raw glossary']},translatedText:null,replyText:'🚧'};
 const rows=[historical,raw,{nmtInputContents:null,nmtOutputContents:null}].map(row=>JSON.parse(JSON.stringify(jsonValue(row))));
 assert.deepEqual(rows[1],raw);assert.equal(Object.hasOwn(rows[0],'nmtInputContents'),false);assert.deepEqual(rows[2],{nmtInputContents:null,nmtOutputContents:null});
});
