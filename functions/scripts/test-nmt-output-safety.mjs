import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,linkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {canonicalPath,assertNewOutput,saveImmutable,createCheckpointStore,journalRoot} from './nmt-output-safety.mjs';
const temp=()=>mkdtempSync(resolve(tmpdir(),'nmt-output-unit-'));
const bytes=p=>readFileSync(p,'utf8');
test('all immutable plan outputs refuse existing sources, case variants, aliases, and journals',()=>{
 const dir=temp();try{
  for(const kind of ['recording','review','ledger','plan','freeze','resources','another-journal']){
   const path=resolve(dir,kind+'.json');writeFileSync(path,'original '+kind);const before=bytes(path);
   assert.throws(()=>saveImmutable(path,{changed:true}),/already exists/);assert.equal(bytes(path),before);
   if(process.platform==='win32')assert.throws(()=>saveImmutable(path.toUpperCase(),{}),/already exists/);
   const alias=resolve(dir,kind+'-link.json');linkSync(path,alias);assert.throws(()=>saveImmutable(alias,{}),/already exists/);assert.equal(bytes(path),before);
  }
  const fresh=resolve(dir,'new.json');saveImmutable(fresh,{ok:true});assert.deepEqual(JSON.parse(bytes(fresh)),{ok:true});assert.throws(()=>saveImmutable(fresh,{}),/already exists/);
  assert.throws(()=>assertNewOutput(resolve(journalRoot,'absent','new.json')),/journal/);
  const junction=resolve(dir,'journal-alias');symlinkSync(journalRoot,junction,'junction');assert.throws(()=>assertNewOutput(resolve(junction,'absent','new.json')),/journal|alias/);
  if(process.platform==='win32')for(const suffix of ['file.json.','file.json ','file.json:stream','nul.json'])assert.throws(()=>assertNewOutput(resolve(dir,suffix)),/Ambiguous/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('plan CLI collision rejects before reading invalid inputs or performing cloud operations',()=>{
 const dir=temp();try{for(const action of ['prepare','prepare-successor','adjudication-template','batch','merge','execute']){
  const input=resolve(dir,action+'.json');writeFileSync(input,'immutable non-JSON sentinel');const before=bytes(input);
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./plan-nmt.mjs',import.meta.url)),action,'--execute','--recording='+input,'--review='+input,'--ledger='+input,'--plan='+input,'--freeze='+input,'--output='+input],{encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Output collides with protected input/);assert.equal(bytes(input),before);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
test('checkpoint writes only owned canonical journal and approved mirror; resume binds both',()=>{
 const planHash=randomBytes(32).toString('hex'),contractHash=randomBytes(32).toString('hex');const dir=resolve(journalRoot,planHash),outside=temp(),canonical=resolve(dir,contractHash+'.json'),mirror=resolve(outside,'mirror.json');
 try{
  const store=createCheckpointStore({canonical,mirror,planHash,contractHash});assert.equal(store.initial,null);store.checkpoint({results:[{key:'one'}]});store.checkpoint({results:[{key:'one'},{key:'two'}]});store.close();assert.equal(bytes(canonical),bytes(mirror));
  const resumed=createCheckpointStore({canonical,mirror,planHash,contractHash});assert.equal(resumed.initial.results.length,2);resumed.checkpoint({...resumed.initial,complete:true});resumed.close();
  assert.throws(()=>createCheckpointStore({canonical,mirror:resolve(outside,'new-output.json'),planHash,contractHash}),/ownership mismatch/);
  assert.throws(()=>createCheckpointStore({canonical,mirror:canonical,planHash,contractHash}),/journal/);
  writeFileSync(mirror,'foreign replacement');assert.throws(()=>createCheckpointStore({canonical,mirror,planHash,contractHash}),/ownership mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test('new mirror collision is refused before creating a journal; external edits stop checkpoint',()=>{
 const planHash=randomBytes(32).toString('hex'),contractHash=randomBytes(32).toString('hex');const dir=resolve(journalRoot,planHash),outside=temp(),canonical=resolve(dir,contractHash+'.json'),mirror=resolve(outside,'mirror.json');
 try{
  writeFileSync(mirror,'preserved');assert.throws(()=>createCheckpointStore({canonical,mirror,planHash,contractHash}),/already exists/);assert.equal(existsSync(canonical),false);assert.equal(bytes(mirror),'preserved');
  const fresh=resolve(outside,'fresh.json'),store=createCheckpointStore({canonical,mirror:fresh,planHash,contractHash});store.checkpoint({results:[]});const prior=bytes(canonical);writeFileSync(fresh,'changed');assert.throws(()=>store.checkpoint({results:[1]}),/outside its owner/);assert.equal(bytes(canonical),prior);store.close();
 }finally{rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test('failed preflight cleans only its empty reservations and does not clear foreign data',()=>{
 const planHash=randomBytes(32).toString('hex'),contractHash=randomBytes(32).toString('hex');const dir=resolve(journalRoot,planHash),outside=temp(),canonical=resolve(dir,contractHash+'.json'),mirror=resolve(outside,'mirror.json');
 try{
  const store=createCheckpointStore({canonical,mirror,planHash,contractHash});store.close();assert.equal(existsSync(canonical),false);assert.equal(existsSync(mirror),false);
  const next=createCheckpointStore({canonical,mirror,planHash,contractHash});writeFileSync(mirror,'foreign');next.close();assert.equal(existsSync(canonical),false);assert.equal(bytes(mirror),'foreign');
 }finally{rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
