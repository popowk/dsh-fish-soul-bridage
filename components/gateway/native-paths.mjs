import {stat,lstat,readFile,readdir} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';

// Only top-level client*.js modules from the installed fish-soul plugin.
// No arbitrary paths, extensions, directories, or DSH core bundle proxy.
const NATIVE_NAME=/^client(?:\.[a-z0-9][a-z0-9_-]{0,63})?\.js$/;
export async function nativeFiles(dir){
 if(!dir)return [];
 const items=await readdir(dir,{withFileTypes:true});
 const result=[];
 for(const item of items){
  if(!NATIVE_NAME.test(item.name)||!item.isFile())continue;
  const s=await lstat(join(dir,item.name));
  if(s.size>0&&s.size<=4*1024*1024)result.push(item.name);
 }
 return result.sort();
}
export async function resolveNativeFile(dir,name){
 if(!dir||!NATIVE_NAME.test(name))return null;
 const f=join(dir,name);
 try{const info=await lstat(f);if(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=4*1024*1024)return f;}catch{}
 return null;
}
export function candidates(profile='desktop') {
 const home=process.env.USERPROFILE||homedir();
 const root=join(home,'.dsh','profiles',profile,'node_modules','dsh-fish-soul');
 const override=process.env.FS_PLUGIN_DIR;
 return [override,root,join(root,'lib')].filter(Boolean);
}
export async function locatePlugin() {
 for(const location of candidates(process.env.FS_PROFILE||'desktop')){
  const dir=basename(location).toLowerCase()==='lib'?resolve(location):resolve(location,'lib');
  try{
   const st=await stat(join(dir,'client.js'));
   if(st.isFile()&&st.size>1024&&st.size<2*1024*1024)return dir;
  }catch{}
 }
 return null;
}
export async function getManifest(dir) {
 if(!dir)return {installed:false, reason:'fish-soul client.js was not found in desktop profile'};
 const files={};
 for(const file of await nativeFiles(dir)){
  try{
   const src=await readFile(join(dir,file));
   if(src.length<4*1024*1024)files[file]=createHash('sha256').update(src).digest('hex').slice(0,16);
  }catch{}
 }
 const hash=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,20);
 let version='unknown';
 try{const pkg=JSON.parse(await readFile(join(dir,'..','package.json'),'utf8'));version=String(pkg.version||'unknown').slice(0,60);}catch{}
 return {installed:true,version,hash,files:Object.keys(files)};
}
