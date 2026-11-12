// Runs inside the user's own local DSH Host. Uses only the official
// connection.authenticatedUrl API; never touches .credentials.yaml.
// Temporary PoC: the token is stored in a restricted same-user LOCALAPPDATA
// directory. Do not install on a shared-user/untrusted Windows host.
import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const name = 'fish-soul-bridge-token';
export const inject = ['connection'];
const dir = join(process.env.LOCALAPPDATA || join(homedir(),'AppData','Local'), 'DSH-fish-soul-bridge');
const dest = join(dir, 'host-auth.json');
function service(ctx,n){return ctx.get?.(n) ?? ctx[n];}
function authenticatedUrl(ctx){
 const app=service(ctx,'webApp'), server=service(ctx,'webServer'), con=service(ctx,'connection');
 let base=app?.getAdvertisedUrl?.() || server?.getOrigin?.();
 if(!base && server?.port && server?.protocol)base=`${server.protocol}//127.0.0.1:${server.port}`;
 if(!base || typeof con?.authenticatedUrl!=='function')return null;
 const root=new URL(base);
 if(!['http:','https:'].includes(root.protocol) || !['127.0.0.1','localhost','[::1]'].includes(root.hostname) || root.username || root.password)return null;
 const result=con.authenticatedUrl(base), u=new URL(result);
 if(u.origin!==root.origin || u.pathname!=='/' || u.searchParams.getAll('token').length!==1 || !u.searchParams.get('token'))return null;
 return u.href;
}
let secured=false;
async function secureDir(){
 await mkdir(dir,{recursive:true});
 if(secured)return;
 if(process.platform==='win32'){
  // Explicit user + SYSTEM ACL. Fail closed if we cannot restrict the directory.
  const output=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
  const sid=output.match(/S-1-5-(?:\d+-)+\d+/)?.[0];
  if(!sid)throw new Error('cannot resolve current Windows SID for secure handoff');
  execFileSync('icacls.exe',[dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'ignore',windowsHide:true});
 }else await chmod(dir,0o700);
 secured=true;
}
export function apply(ctx){
 let disposed=false, busy=false;
 async function tick(){
  if(disposed||busy)return;busy=true;
  try{
   const url=authenticatedUrl(ctx);if(!url)return;
   await secureDir();
   const tmp=dest+'.'+process.pid+'.tmp';
   await writeFile(tmp,JSON.stringify({schema:1,pid:process.pid,updatedAt:Date.now(),url}),{encoding:'utf8',mode:0o600});
   await rename(tmp,dest);if(process.platform!=='win32')await chmod(dest,0o600);
  }catch(e){ // no token or paths in the error message
   ctx.logger?.warn?.('fish-soul bridge auto auth handoff unavailable (check local ACL and Host services)');
  }finally{busy=false;}
 }
 const start=()=>{
  const timer=setInterval(()=>{void tick();},8000);
  void tick();
  return ()=>{disposed=true;clearInterval(timer);void (async()=>{
   try{const file=JSON.parse(await readFile(dest,'utf8'));if(file.pid===process.pid)await unlink(dest);}catch{}
  })();};
 };
 if(typeof ctx.effect==='function')ctx.effect(start,'fish-soul bridge local auth handoff');
 else start();
}
