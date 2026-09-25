import {readFileSync,writeFileSync,existsSync,mkdirSync,realpathSync,statSync,lstatSync,openSync,closeSync,unlinkSync,renameSync,fsyncSync} from 'node:fs';
import {resolve,dirname,basename,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {root} from './nmt-local-guard.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=value=>JSON.stringify(value,null,2).replace(/\n/g,'\r\n')+'\r\n';
export const journalRoot=resolve(root,'.local/nmt-plan-executions');
export function canonicalPath(path){
 const absolute=resolve(path);
 // Win32 aliases (ADS, stripped suffixes and device names) are not output names.
 if(process.platform==='win32'&&absolute.slice(3).split(/[\\/]/u).some(part=>/[ .]$|:/u.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)))throw Error('Ambiguous Windows output path');
 let ancestor=absolute;const suffix=[];
 while(!existsSync(ancestor)){if(lstatSync(ancestor,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Unresolved output alias');const parent=dirname(ancestor);if(parent===ancestor)throw Error('Output has no existing ancestor');suffix.unshift(basename(ancestor));ancestor=parent;}
 const result=resolve(realpathSync.native(ancestor),...suffix);return process.platform==='win32'?result.toLowerCase():result;
}
const inside=(path,parent)=>path===parent||path.startsWith(parent+sep);
export function assertOutputLocation(path,protectedPaths=[]){
 const target=canonicalPath(path);if(inside(target,canonicalPath(journalRoot)))throw Error('Output cannot target an execution journal');
 if(protectedPaths.filter(Boolean).some(input=>canonicalPath(input)===target))throw Error('Output collides with protected input');return target;
}
export function assertNewOutput(path,protectedPaths=[]){assertOutputLocation(path,protectedPaths);if(existsSync(path))throw Error('Immutable output already exists');}
export function saveImmutable(path,value,protectedPaths=[]){assertNewOutput(path,protectedPaths);mkdirSync(dirname(resolve(path)),{recursive:true});const fd=openSync(path,'wx');try{writeFileSync(fd,bytes(value));fsyncSync(fd);}finally{closeSync(fd);}}
const snapshot=path=>{const stat=statSync(path);if(!stat.isFile()||stat.nlink!==1)throw Error('Checkpoint must be a singly owned regular file');return{dev:stat.dev,ino:stat.ino,sha256:hash(readFileSync(path))};};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.sha256===b.sha256;
// Invoked under the checkout execution lock, before any cloud operation.
export function assertCheckpointOutput({canonical,mirror,planHash,contractHash,protectedPaths=[]}){
 canonical=resolve(canonical);mirror=resolve(mirror);
 const canonicalKey=canonicalPath(canonical),mirrorKey=assertOutputLocation(mirror,protectedPaths);
 if(!inside(canonicalKey,canonicalPath(journalRoot))||basename(canonical)!==contractHash+'.json'||basename(dirname(canonical))!==planHash)throw Error('Unowned canonical journal');
 canonical=canonicalKey;mirror=mirrorKey;
 const ownership={version:1,planHash,contractHash,canonical:canonicalKey,mirror:mirrorKey};
 let initial=null;
 if(existsSync(canonical)){
  initial=JSON.parse(readFileSync(canonical,'utf8'));
  if(JSON.stringify(initial.checkpointOwnership)!==JSON.stringify(ownership)||!existsSync(mirror)||!readFileSync(canonical).equals(readFileSync(mirror)))throw Error('Checkpoint mirror ownership mismatch');
  for(const path of [canonical,mirror])snapshot(path);

 }else assertNewOutput(mirror,protectedPaths);
 return{canonical,mirror,ownership,initial};
}
export function createCheckpointStore(args){
 const{canonical,mirror,ownership,initial}=assertCheckpointOutput(args),records=[];
 if(initial){records.push(...[canonical,mirror].map(path=>({path,state:snapshot(path),reserved:false}))); }else{
  try{for(const path of [canonical,mirror]){mkdirSync(dirname(path),{recursive:true});const fd=openSync(path,'wx');closeSync(fd);records.push({path,state:snapshot(path),reserved:true});}}
  catch(error){for(const record of records)if(same(snapshot(record.path),record.state))unlinkSync(record.path);throw error;}
 }
 const check=()=>{for(const record of records)if(!same(snapshot(record.path),record.state))throw Error('Checkpoint changed outside its owner');};
 return{initial,ownership,checkpoint(value){
  check();const content=bytes({...value,checkpointOwnership:ownership});
  for(const record of records){
   const temporary=record.path+'.'+randomUUID()+'.tmp';let fd;
   try{fd=openSync(temporary,'wx');writeFileSync(fd,content);fsyncSync(fd);closeSync(fd);fd=undefined;check();renameSync(temporary,record.path);record.state=snapshot(record.path);record.reserved=false;}
   finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
  }
 },close(){for(const record of records)if(record.reserved&&existsSync(record.path)&&same(snapshot(record.path),record.state))unlinkSync(record.path);}};
}
