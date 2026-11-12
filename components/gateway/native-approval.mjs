/**
 * V6.9.3 verified native-frontend loader.
 * Release versions and client chunk names are DISCOVERED from the installed
 * package and checked against the exact npm tarball + SHA512 SRI. No hardcoded
 * fish-soul release list or six-chunk assumption. A prior verified snapshot
 * can keep the UI available if the next release cannot be verified yet.
 * IMPORTANT: npm integrity proves artifact consistency, not code safety.
 */
import {readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash,timingSafeEqual,randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {getManifest} from './native-paths.mjs';

const PACKAGE='dsh-fish-soul';
const REGISTRY='https://registry.npmjs.org';
const RELEASE_VERSION=/^\d{1,4}\.\d{1,4}\.\d{1,5}$/;
const JS_NAME=/^client(?:\.[a-z0-9][a-z0-9_-]{0,63})?\.js$/;
export const EXPECTED_FILES=Object.freeze(['client.behavior.js','client.douyin.js','client.js','client.models.js','client.persona.js','client.soul.js']); // legacy TEST fixture only
export const DEFAULT_APPROVAL_FILE=join(process.env.LOCALAPPDATA||join(process.env.USERPROFILE||process.cwd(),'AppData','Local'),'DSH-fish-soul-bridge','verified-native-v693.json');
const MAX_ARCHIVE=12*1024*1024, MAX_EXTRACTED=45*1024*1024;
const digest=(buf,algorithm='sha256')=>createHash(algorithm).update(buf).digest();
const same=(a,b)=>a.length===b.length&&timingSafeEqual(a,b);
const validFiles=files=>Array.isArray(files)&&files.length>=1&&files.length<=32&&files.includes('client.js')&&new Set(files).size===files.length&&files.every(n=>JS_NAME.test(n));
const recordMatches=(m,r)=>Boolean(m?.installed&&r?.schema===2&&r?.source==='npm-integrity-verified'&&r.version===m.version&&r.hash===m.hash&&validFiles(m.files)&&validFiles(r.files)&&m.files.length===r.files.length&&m.files.every(n=>r.files.includes(n))&&/^sha512-[A-Za-z0-9+/]{86}==$/.test(r.integrity||''));
async function readJSON(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
async function atomicJSON(file,value){
 await mkdir(dirname(file),{recursive:true});
 const tmp=file+'.tmp-'+process.pid+'-'+randomBytes(5).toString('hex');
 try{await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await rename(tmp,file);}catch(e){await rm(tmp,{force:true}).catch(()=>{});throw e;}
}
function tarFiles(tar){
 const files=new Map();let cursor=0;
 while(cursor+512<=tar.length){
  const h=tar.subarray(cursor,cursor+512);if(h.every(b=>b===0))break;
  const str=(start,length)=>h.subarray(start,start+length).toString('utf8').split('\0')[0];
  const name=(str(345,155)?str(345,155)+'/':'')+str(0,100),octal=str(124,12).trim();
  if(!/^[0-7]+$/.test(octal))throw Error('invalid-tar-header');
  const size=Number.parseInt(octal,8),type=h[156],start=cursor+512,end=start+size;
  if(!Number.isSafeInteger(size)||size<0||end>tar.length)throw Error('invalid-tar-size');
  if(type===0||type===48){
   if(name==='package/package.json'||/^package\/lib\/client(?:\.[a-z0-9_-]+)?\.js$/.test(name)){
    if(files.has(name))throw Error('duplicate-tar-entry');files.set(name,tar.subarray(start,end));
   }
  }
  cursor=start+Math.ceil(size/512)*512;
 }
 return files;
}
async function receiveLimited(url,fetcher,maxBytes,timeoutMs){
 const resp=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json,application/octet-stream'}});
 if(!resp.ok)throw Error('npm-http-'+resp.status);
 const len=Number(resp.headers.get('content-length'));
 if(Number.isFinite(len)&&len>maxBytes)throw Error('npm-package-too-large');
 const reader=resp.body?.getReader();if(!reader)throw Error('npm-no-body');
 const parts=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;
  if(size>maxBytes){await reader.cancel();throw Error('npm-package-too-large');}
  parts.push(Buffer.from(value));
 }
 return Buffer.concat(parts);
}
export async function verifyPublishedClient(dir,manifest,{fetcher=fetch}={}){
 if(!manifest?.installed||!RELEASE_VERSION.test(manifest.version))throw Error('invalid-release-version');
 if(!validFiles(manifest.files))throw Error('unexpected-client-modules');
 const localPkg=await readJSON(join(dir,'..','package.json'));
 if(localPkg?.name!==PACKAGE||localPkg.version!==manifest.version)throw Error('local-package-mismatch');
 const ver=manifest.version;
 const metaUrl=`${REGISTRY}/${PACKAGE}/${ver}`;
 const metadata=JSON.parse((await receiveLimited(metaUrl,fetcher,250_000,12000)).toString('utf8'));
 const tgz=`${REGISTRY}/${PACKAGE}/-/${PACKAGE}-${ver}.tgz`;
 if(metadata?.name!==PACKAGE||metadata?.version!==ver||metadata?.dist?.tarball!==tgz)throw Error('npm-metadata-mismatch');
 const sri=String(metadata?.dist?.integrity||'');
 if(!/^sha512-[A-Za-z0-9+/]{86}==$/.test(sri))throw Error('npm-integrity-missing');
 const archive=await receiveLimited(tgz,fetcher,MAX_ARCHIVE,25000);
 if(!same(Buffer.from(sri.slice(7),'base64'),digest(archive,'sha512')))throw Error('npm-integrity-failed');
 const entries=tarFiles(gunzipSync(archive,{maxOutputLength:MAX_EXTRACTED}));
 let pkg;try{pkg=JSON.parse(entries.get('package/package.json')?.toString('utf8')||'');}catch{throw Error('npm-package-json-invalid');}
 if(pkg.name!==PACKAGE||pkg.version!==ver)throw Error('npm-package-version-mismatch');
 const remoteFiles=[...entries.keys()].filter(k=>/^package\/lib\/client(?:\.[a-z0-9_-]+)?\.js$/.test(k)).map(k=>k.slice('package/lib/'.length)).sort();
 if(!validFiles(remoteFiles)||remoteFiles.length!==manifest.files.length||!remoteFiles.every(n=>manifest.files.includes(n)))throw Error('npm-client-modules-changed');
 for(const file of remoteFiles){
  const local=await readFile(join(dir,file));const published=entries.get('package/lib/'+file);
  if(local.length>4*1024*1024||!published||!same(digest(local),digest(published)))throw Error('installed-file-mismatch:'+file);
 }
 return {integrity:sri,registry:REGISTRY};
}
const snapshotParent=file=>join(dirname(file),'verified-native-snapshots');
async function snapshotFor(file,record){
 if(!recordMatches({installed:true,version:record?.version,hash:record?.hash,files:record?.files},record))return null;
 const dir=join(snapshotParent(file),record.hash,'lib');
 const m=await getManifest(dir).catch(()=>null);
 return recordMatches(m,record)?dir:null;
}
async function writeSnapshot(dir,file,record){
 // A previously verified archive is kept as the last-known-good UI. Snapshots
 // are content-addressed and rehashed before serving. No executable npm scripts.
 const parent=snapshotParent(file);await mkdir(parent,{recursive:true});
 const target=join(parent,record.hash),current=await snapshotFor(file,record);
 if(current)return current;
 const tmp=join(parent,'.tmp-'+randomBytes(8).toString('hex'));
 try{
  await mkdir(join(tmp,'lib'),{recursive:true});
  for(const n of record.files)await writeFile(join(tmp,'lib',n),await readFile(join(dir,n)),{mode:0o600});
  await writeFile(join(tmp,'package.json'),JSON.stringify({name:PACKAGE,version:record.version}),{mode:0o600});
  if(!(await getManifest(join(tmp,'lib'))).hash||!(await snapshotForTmp(tmp,record)))throw Error('snapshot-mismatch');
  try{await rename(tmp,target);}catch(e){if(!(await snapshotFor(file,record)))throw e;}
 }finally{await rm(tmp,{force:true,recursive:true}).catch(()=>{});}
 return snapshotFor(file,record);
}
async function snapshotForTmp(root,record){return recordMatches(await getManifest(join(root,'lib')),record);}
async function previousRecord(file){
 const current=await readJSON(file);
 const previous=await readJSON(file+'.previous');
 for(const record of [current,previous]){
  if(!record)continue;
  const dir=await snapshotFor(file,record);
  if(dir)return {dir,record};
 }
 return null;
}
export async function verifiedSnapshotByHash(hash,file=DEFAULT_APPROVAL_FILE){
 if(!/^[0-9a-f]{20}$/.test(String(hash||'')))return null;
 for(const path of [file,file+'.previous']){
  const record=await readJSON(path);
  if(record?.hash!==hash)continue;
  const dir=await snapshotFor(file,record);
  if(dir)return {dir,record};
 }
 return null;
}
export async function approvalStatus(dir,file=DEFAULT_APPROVAL_FILE){
 const current=await getManifest(dir),record=await readJSON(file);
 if(recordMatches(current,record))return {ok:true,mode:'current',version:current.version,hash:current.hash,files:current.files,activeDir:(await snapshotFor(file,record))||dir,reason:'npm-verified'};
 const prior=await previousRecord(file);
 if(prior)return {ok:true,mode:'fallback',version:prior.record.version,hash:prior.record.hash,files:prior.record.files,activeDir:prior.dir,installedVersion:current.version,installedHash:current.hash,reason:'last-verified-snapshot'};
 return {ok:false,mode:'unavailable',version:current.version,hash:current.hash,files:current.files,reason:!current.installed?'plugin-not-found':!RELEASE_VERSION.test(current.version)?'invalid-release-version':!validFiles(current.files)?'unexpected-client-modules':'verification-required'};
}
export async function approveVerified(dir,file=DEFAULT_APPROVAL_FILE,options={}){
 const m=await getManifest(dir);
 const published=await verifyPublishedClient(dir,m,options);
 const after=await getManifest(dir);
 if(m.hash!==after.hash||m.version!==after.version)throw Error('changed-during-verification');
 const record={schema:2,source:'npm-integrity-verified',version:m.version,hash:m.hash,files:m.files,integrity:published.integrity,verifiedAt:new Date().toISOString()};
 // Snapshot before switching the approval record. Earlier snapshots are kept.
 const snapshot=await writeSnapshot(dir,file,record);if(!snapshot)throw Error('snapshot-write-failed');
 const old=await readJSON(file);
 if(old&&recordMatches({installed:true,version:old.version,hash:old.hash,files:old.files},old)&&old.hash!==record.hash&&await snapshotFor(file,old))await atomicJSON(file+'.previous',old);
 await atomicJSON(file,record);
 return record;
}
let inflight=null,lastFail=null;
export async function ensureNativeApproval(dir,file=DEFAULT_APPROVAL_FILE,options={}){
 const current=await getManifest(dir);
 const status=await approvalStatus(dir,file);
 if(status.mode==='current'||!dir||!RELEASE_VERSION.test(current.version)||!validFiles(current.files))return status;
 const key=[dir,file,current.version,current.hash].join('|');
 if(lastFail?.key===key&&Date.now()-lastFail.at<45_000&&options.fetcher===undefined)return {...status,verificationError:lastFail.reason};
 if(inflight?.key===key){if(status.mode==='fallback')return {...status,verification:'in-progress'};return inflight.promise;}
 const promise=(async()=>{
  try{await approveVerified(dir,file,options);lastFail=null;return approvalStatus(dir,file);}
  catch(e){const reason=String(e?.message||'verification-failed').slice(0,100);lastFail={key,at:Date.now(),reason};return {...await approvalStatus(dir,file),verificationError:reason};}
  finally{inflight=null;}
 })();inflight={key,promise};
 // If an earlier verified UI exists, serve it immediately while the new npm
 // artifact is checked in the background (the only async work is in-process).
 if(status.mode==='fallback')return {...status,verification:'in-progress'};
 return promise;
}
