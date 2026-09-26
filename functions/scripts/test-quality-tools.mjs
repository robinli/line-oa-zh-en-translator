import test from 'node:test';
import assert from 'node:assert/strict';
import {exportOptions,jsonValue,summarize,exportGroups,selectExportRows} from './export-translation-quality.mjs';
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
