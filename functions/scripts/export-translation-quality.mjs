import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Firestore,Timestamp} from 'firebase-admin/firestore';
import {GoogleAuth} from 'google-auth-library';
import {NMT_TEST_PROJECT,NMT_TEST_ACCOUNT} from '../lib/nmt-isolation.js';

export function exportOptions(args,root=resolve(fileURLToPath(new URL('../..',import.meta.url)))) {
 const values=Object.fromEntries(args.map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 if(values['--project']!==NMT_TEST_PROJECT)throw Error('Explicit DEV project is required');
 const parse=(value)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value??''))throw Error('Dates must be YYYY-MM-DD');const date=new Date(value+'T00:00:00+08:00');if(!Number.isFinite(date.valueOf())||new Date(date.valueOf()+28800000).toISOString().slice(0,10)!==value)throw Error('Invalid date');return date;};
 const start=parse(values['--from']),end=new Date(parse(values['--to']).valueOf()+86400000);
 if(end<=start)throw Error('Date range is reversed');
 const base=resolve(root,'.local'),output=resolve(root,values['--out']??'.local/quality-export/'+values['--from']+'_'+values['--to']);
 const rel=relative(base,output);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Output must be a subdirectory of .local');
 const group=values['--group']??'all';
 return {start,end,output,group};
}
export function jsonValue(value) {
 if(value instanceof Date)return value.toISOString();
 if(value&&typeof value.toDate==='function')return value.toDate().toISOString();
 if(Array.isArray(value))return value.map(jsonValue);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,jsonValue(v)]));
 return value;
}
export function summarize(messages,cases,storageDiagnostics) {
 const days={};
 for(const row of messages){
  const time=new Date(row.eventTime??row.recordedAt),day=Number.isFinite(time.valueOf())?new Date(time.valueOf()+28800000).toISOString().slice(0,10):'unknown';
  const key=day+'|'+row.groupId;
  const item=days[key]??={day,groupId:row.groupId,received:0,translated:0,skipped:0,failed:0,deliveryFailed:0,incomplete:0};
  item.received++;if(row.outcome==='translated')item.translated++;if(row.outcome==='skipped'||row.outcome==='ignored')item.skipped++;if(row.outcome==='failed')item.failed++;if(row.deliveryStatus==='failed')item.deliveryFailed++;if(!row.completedAt)item.incomplete++;
 }
 return {messageCount:messages.length,caseCount:cases.length,byGroupAndDay:Object.values(days),storageDiagnostics,completeness:'Compare stored rows with webhook logs; stored row counts alone cannot prove complete reception.'};
}
async function allPages(collection,field,start,end) {
 let cursor;const rows=[];
 for(;;){let q=collection.where(field,'>=',Timestamp.fromDate(start)).where(field,'<',Timestamp.fromDate(end)).orderBy(field).limit(200);if(cursor)q=q.startAfter(cursor);const batch=await q.get();rows.push(...batch.docs.map(d=>({id:d.id,...jsonValue(d.data())})));if(batch.size<200)break;cursor=batch.docs.at(-1);}
 return rows;
}
async function storageLogs(auth,start,end,groups) {
 try{
  const client=await auth.getClient();let pageToken;let count=0;let receivedAttempts=0;let unidentifiedReceipts=0;const receivedIds=new Set();const perGroup={};const names=new Map(groups.map(g=>[createHash('sha256').update(g.id).digest('hex'),g.name]));
  do{const response=await client.request({url:'https://logging.googleapis.com/v2/entries:list',method:'POST',data:{resourceNames:['projects/'+NMT_TEST_PROJECT],filter:'resource.type="cloud_run_revision" AND resource.labels.service_name="linewebhook" AND (jsonPayload.reason="quality_store_error" OR jsonPayload.reason="quality_received") AND timestamp>="'+start.toISOString()+'" AND timestamp<"'+end.toISOString()+'"',pageSize:1000,...(pageToken?{pageToken}:{})}});for(const entry of response.data.entries??[]){const payload=entry.jsonPayload??{};if(payload.reason==='quality_store_error'){count++;continue;}receivedAttempts++;if(!payload.webhookEventId){unidentifiedReceipts++;continue;}const key=payload.webhookEventId;if(receivedIds.has(key))continue;receivedIds.add(key);const groupName=names.get(payload.groupKey)??'unknown';perGroup[groupName]=(perGroup[groupName]??0)+1;}pageToken=response.data.nextPageToken;}while(pageToken);
  return {available:true,failedWriteAttempts:count,receivedAttempts,uniqueIdentifiedReceipts:receivedIds.size,unidentifiedReceipts,receiptsByGroup:perGroup,scope:'All configured groups; Logging receipt time, not message event time.',note:'Diagnostic attempts can include retries; this is not an exact missing-message count.'};
 }catch{return {available:false,failedWriteAttempts:null,note:'Cloud Logging read unavailable; do not interpret as zero failures.'};}
}
export async function runExport(args) {
 const options=exportOptions(args);
 const credentialPath=process.env.GOOGLE_APPLICATION_CREDENTIALS;if(!credentialPath)throw Error('Isolated DEV credentials required');
 const credential=JSON.parse(readFileSync(credentialPath,'utf8'));if(credential.type!=='authorized_user'||credential.quota_project_id!==NMT_TEST_PROJECT)throw Error('Isolated DEV credential mismatch');
 if(process.env.FIRESTORE_EMULATOR_HOST)throw Error('Live export cannot use emulator');
 const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/userinfo.email']});
 const token=await auth.getAccessToken();const principal=await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token='+encodeURIComponent(token),{signal:AbortSignal.timeout(15000)});
 if(!principal.ok||(await principal.json()).email!==NMT_TEST_ACCOUNT)throw Error('Unexpected DEV principal');
 const db=new Firestore({projectId:NMT_TEST_PROJECT,databaseId:'(default)'});
 try{
  const config=(await db.doc('lineTranslationQualityConfig/current').get()).data();
  if(!config||!Array.isArray(config.groups)||config.groups.length!==4)throw Error('Four-group collection configuration required');
  const allowed=new Set(config.groups.filter(g=>options.group==='all'||g.id===options.group||g.name===options.group).map(g=>g.id));if(!allowed.size)throw Error('Group is outside the collection configuration');
  const messages=(await allPages(db.collection('lineTranslationMessages'),'eventTime',options.start,options.end)).filter(r=>allowed.has(r.groupId));
  const cases=(await allPages(db.collection('lineTranslationErrorCases'),'createdAt',options.start,options.end)).filter(r=>allowed.has(r.groupId)||(options.group==='all'&&!r.groupId));
  const diagnostics=await storageLogs(auth,options.start,options.end,config.groups),summary={project:NMT_TEST_PROJECT,exportedAt:new Date().toISOString(),from:options.start.toISOString(),untilExclusive:options.end.toISOString(),collectionStartedAt:jsonValue(config.startedAt),...summarize(messages,cases,diagnostics)};
  mkdirSync(options.output,{recursive:true});
  for(const [name,rows]of [['messages',messages],['error-cases',cases]])writeFileSync(resolve(options.output,name+'.jsonl'),rows.map(x=>JSON.stringify(x)).join('\r\n')+(rows.length?'\r\n':''),'utf8');
  writeFileSync(resolve(options.output,'summary.json'),JSON.stringify(summary,null,2).replace(/\n/g,'\r\n')+'\r\n','utf8');
  console.log(JSON.stringify({output:options.output,messages:messages.length,cases:cases.length,storageDiagnosticsAvailable:diagnostics.available}));
 }finally{await db.terminate();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runExport(process.argv.slice(2)).catch(()=>{console.error('Quality export failed. Check DEV identity, dates, configuration, and access. No sensitive details are printed.');process.exitCode=1;});
