/**
 * Start/observe SnowLuma and send its current boot credential to VMO via
 * the Guest Agent loopback receiver on 127.0.0.1:18767. No password files, no password console output.
 * Usage: node snowluma-supervisor.mjs [--observe]
 */
import {spawn} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {join,basename} from 'node:path';
import net from 'node:net';
import {buildReport,createAppReporter} from './vmo-report.mjs';
import {parseBootstrapPassword} from './snowluma-log-parser.mjs';
import {startSnowLumaLanRelay} from './snowluma-lan-relay.mjs';

const root=process.env.SNOWLUMA_DIR || 'C:\\dsh\\SnowLuma';
const entry=join(root,'index.mjs');
const observing=process.argv.includes('--observe');
const nodeExe=process.execPath;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let child=null, secret=null, port=null, online=false, ended=false;
let startupFailed=false, lastLogPort=null, version='unknown';
const streamBuffers={stdout:'',stderr:''};
let firstOfflineReported=false;
let lanRelay=null,relayPort=null;
const relayIP=process.env.SNOWLUMA_LAN_BIND_IP||'';
const requestedHost=process.env.SNOWLUMA_WEBUI_HOST==='0.0.0.0'?'0.0.0.0':'127.0.0.1';
async function ensureLanRelay(p){
 if(!relayIP||process.env.SNOWLUMA_LAN_RELAY!=='1')return;
 if(lanRelay&&relayPort===p)return;
 if(lanRelay){await lanRelay.shutdown();lanRelay=null;}
 try{
  const x=await startSnowLumaLanRelay({listenIP:relayIP,port:p});
  lanRelay=x;relayPort=p;
  console.log(`[SnowLuma] Scoped LAN WebUI relay enabled: ${relayIP}:${p} (only 192.168.2.99); SnowLuma remains loopback-bound.`);
 }catch(e){console.warn(`[SnowLuma] Scoped LAN relay unavailable (${e.code||e.name}); local/VMO WSS access is unaffected.`);}
}
async function stopLanRelay(){if(lanRelay){const s=lanRelay;lanRelay=null;relayPort=null;await s.shutdown();}}
const LISTEN_RE=/(?:https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):|WebUI[^\n]{0,80}?\bport\s*[=:]\s*)(\d{2,5})/i;

async function getVersion(){
 for (const file of ['package.json','version.json','release.json']){
   try{const data=JSON.parse(await readFile(join(root,file),'utf8'));
    const v=String(data.version||data.appVersion||data.tag||'');
    if(/^v?\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(v))return v.replace(/^v/,'');
   }catch{}
 }
 const m=basename(root).match(/v?(\d+\.\d+\.\d+)(?:-|$)/i);return m?m[1]:'unknown';
}
async function canListen(p){
 return await new Promise(resolve=>{
   const server=net.createServer();
   server.once('error',()=>resolve(false));
   server.listen({port:p,host:'127.0.0.1',exclusive:true},()=>server.close(()=>resolve(true)));
 });
}
async function pickPort(){
 let desired=Number(process.env.SNOWLUMA_WEBUI_PORT||5099);
 try{const j=JSON.parse(await readFile(join(root,'config','runtime.json'),'utf8'));
    if(!process.env.SNOWLUMA_WEBUI_PORT&&Number.isInteger(j.webuiPort))desired=j.webuiPort;
 }catch{}
 if(desired<1024||desired>65535)desired=5099;
 if(await canListen(desired))return {port:desired,changed:false};
 if(requestedHost==='0.0.0.0')throw Error('SnowLuma public bind port occupied; refuse unsafe fallback to unprotected port');
 for(const p of [15099,15100,15101,15102,15103,15104,15105,15106,15107,15108,15109,15110]){
  if(p!==desired&&await canListen(p))return {port:p,changed:true};
 }
 throw Error('SnowLuma 5099 and backup ports are unavailable');
}
async function isWebUI(p,verifyBrand=false){
 try{
   const r=await fetch(`http://127.0.0.1:${p}/`,{signal:AbortSignal.timeout(2000),redirect:'manual'});
   // Listening is confirmed, not authentication success. Never bypass login.
   if(verifyBrand){
     const html=(await r.text()).slice(0,200000);
     return r.status>=200&&r.status<500&&/snowluma/i.test(html);
   }
   await r.body?.cancel();
   return r.status>=200 && r.status<500;
 }catch{return false;}
}
const reporter=createAppReporter({appId:'snowluma',onResult:({report,result})=>{
 if(!result.ok)console.warn('[VMO][snowluma] Local Guest Agent registration failed: '+result.reason);
 else if(report.online&&!report.auth.access_code)console.warn('[VMO][snowluma] WebUI online, but current launch password unavailable; auth is unconfigured. Restart under supervisor to capture it.');
}});
function reportState(connected){
 const payload=buildReport({appId:'snowluma',port:port||5099,version,online:connected,kind:'random_password',accessCode:connected?secret:null});
 if(reporter.update(payload))console.log(`[VMO][snowluma] Queued independent report to 127.0.0.1:18767; url=${payload.url}; online=${connected}; credential=${payload.auth.access_code?'captured':'unavailable'} (never logged).`);
}
function processLine(line){
 const v=line.match(/SnowLuma[^\n]{0,40}?\bv?(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.]+)?)/i);
 if(v)version=v[1];
 const pass=parseBootstrapPassword(line);
 if(pass){
    // Drop sensitive entire line; hold secret only in private process memory.
    secret=pass;
    console.log('[SnowLuma] New bootstrap password intercepted (not printed or stored).');
    if(online)reportState(true);
    return;
 }
 if(/(?:password|token|credential|secret|Authorization|access.code)/i.test(line))return;
 if(/Failed to start WebUI|No available TCP port found near/i.test(line)){
    startupFailed=true;console.warn('[SnowLuma] WebUI could not bind. App is NOT online.');return;
 }
 const m=LISTEN_RE.exec(line);
 if(m){const p=Number(m[1]);if(p>0&&p<65536)lastLogPort=p;}
 // Deliberately do not write third-party output verbatim; it may contain QQ
 // IDs, session information, API keys or other secrets.
}
function feed(stream,text){
 // stdout and stderr may arrive independently and out of order. Never merge
 // incomplete lines from two streams or print their raw contents.
 let pending=streamBuffers[stream]+text;
 if(pending.length>16384)pending=pending.slice(-8192);
 const lines=pending.split(/\r?\n/);
 streamBuffers[stream]=lines.pop()||'';
 for(const line of lines)processLine(line);
}
function flushPending(){
 for(const stream of ['stdout','stderr']){
   if(streamBuffers[stream])processLine(streamBuffers[stream]);
   streamBuffers[stream]='';
 }
}
async function main(){
 version=await getVersion();
 if(!observing)await access(entry);
 if(!observing){
   const selected=await pickPort();port=selected.port;
   console.log(`[SnowLuma] Preparing WebUI at ${requestedHost}:${port}${selected.changed?' (automatic fallback; 5099 unavailable)':''}; firewall must already be installed for 0.0.0.0.`);
   const env={...process.env,SNOWLUMA_WEBUI_PORT:String(port),SNOWLUMA_WEBUI_HOST:requestedHost};
   // Run its real entrypoint so the first-boot password can be intercepted.
   child=spawn(nodeExe,[entry],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
   child.stdout.on('data',c=>feed('stdout',c.toString('utf8')));
   child.stderr.on('data',c=>feed('stderr',c.toString('utf8')));
   child.on('error',e=>{startupFailed=true;ended=true;console.error('[SnowLuma] Launch error: '+e.code);});
   child.on('close',code=>{flushPending();ended=true;console.warn('[SnowLuma] Process exited: '+code);});
 }else{
   // Existing unmanaged process: never guess/recover an old boot password.
   const selected=Number(process.env.SNOWLUMA_WEBUI_PORT||5099);
   port=selected>0&&selected<65536?selected:5099;
   console.log('[SnowLuma] An existing process was detected; observing port only, no password recovery. Host binding cannot be changed until the existing process is restarted.');
 }
 const startupTime=Date.now();
 while(!ended){
   const p=lastLogPort||port;
   const ready=!startupFailed&&await isWebUI(p,observing);
   if(ready&&!online){online=true;port=p;reportState(true);await ensureLanRelay(p);}
   else if(!ready&&online){online=false;reportState(false);await stopLanRelay();}
   else if(ready&&online&&p!==port){port=p;reportState(true);await ensureLanRelay(p);}
   if(startupFailed){reportState(false);break;}
   if(!ready&&!firstOfflineReported&&Date.now()-startupTime>12000){
     firstOfflineReported=true;reportState(false);
   }
   await wait(1500);
 }
 await stopLanRelay();
 if(online)reportState(false);
 if(!online)console.warn('[SnowLuma] Not reported online: WebUI is not available.');
 // Give any queued offline report a short chance to be dispatched before exit.
 await wait(250);
}
main().catch(e=>{console.error('[SnowLuma] Startup/port preflight failed: '+e.message);process.exitCode=1;});
