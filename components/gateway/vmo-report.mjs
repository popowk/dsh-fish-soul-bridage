/**
 * VMO Guest Agent local application reporting (V6.9.22).
 * Two independent app_id registrations. Credentials only live in memory and
 * are transmitted to the loopback Guest Agent, never in argv/logs/files.
 *
 * The actual 18767 HTTP route is not known. Default transport 'auto' first
 * tries configured 127.0.0.1:18767 route; on a missing/unavailable endpoint,
 * falls back to the official installed Report-App-JSON.py via stdin (which
 * registers locally for the Guest Agent V2 service to pick up). Never send
 * sensitive authorization to guessed paths or an external host.
 * A successful local helper registration is NOT proof that the browser
 * reverse proxy / WSS relay is ready; diagnose these independently.
 */
import {spawn} from 'node:child_process';
import {access,mkdir,appendFile,stat,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';

const DEFAULT_PYTHON = 'C:\\Program Files\\Python314\\python.exe';
const DEFAULT_SCRIPT = 'C:\\Program Files\\VM-Orchestrator\\GuestAgent\\Report-App-JSON.py';
const DEFAULT_URL = 'http://127.0.0.1:18767/apps/report';
export const RETRY_DELAYS_MS=Object.freeze([10_000,30_000,60_000]);
// VMO currently accepts 'token' for the gateway's bearer-style login CODE.
// It is NOT a DSH Host owner/admin token.
export const APP_AUTH_KINDS=Object.freeze({'dsh-fish-soul':'token','snowluma':'random_password'});

export function buildReport({appId,port,version,online,kind,accessCode}){
  if(!Object.hasOwn(APP_AUTH_KINDS,appId))throw Error('Unsupported app_id');
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local port');
  if(kind!==APP_AUTH_KINDS[appId])throw Error('Invalid auth kind');
  const v=String(version||'unknown').slice(0,40);
  const code=typeof accessCode==='string'&&accessCode.length?accessCode:null;
  if(code!==null&&(code.length>512||/[\r\n\x00]/.test(code)))throw Error('Invalid credential');
  return {app_id:appId,url:`http://127.0.0.1:${port}/`,version:v,online:Boolean(online),auth:{kind,access_code:online?code:null}};
}

/**
 * The actual login credential used by POST /__bridge/unlock on the 56781
 * customer gateway.  Never use dshToken (a distinct Host admin credential).
 * Keeping this as a dedicated factory makes accidental token substitution
 * visible during code reviews and contract tests.
 */
export function buildGatewayReport({port,version,online,gatewayCode}){
  return buildReport({appId:'dsh-fish-soul',port,version,online,
    kind:'token',accessCode:gatewayCode});
}

export function localReportUrl(value=process.env.VMO_REPORT_LOCAL_URL||DEFAULT_URL){
  let u;
  try{u=new URL(value);}catch{throw Error('Invalid VMO_REPORT_LOCAL_URL');}
  // No sending credentials to remote addresses, non-HTTP, embedded userinfo or redirects.
  const port=process.env.VMO_REPORT_TEST_ALLOW_PORT==='1'?u.port:'18767';
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.port!==port||u.username||u.password||u.search||u.hash||u.pathname==='/')throw Error('VMO report URL must be localhost / explicit path');
  return u;
}

async function postLocal(report,{timeoutMs=5000,url}={}){
  let u;
  try{u=localReportUrl(url);}catch{return {ok:false,reason:'invalid-local-report-url'};}
  try{
    const response=await fetch(u,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(report),redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});
    // No redirects are accepted: may lead to a remote credential disclosure.
    if(response.status<200||response.status>=300){await response.body?.cancel();return {ok:false,reason:`local-http-${response.status}`};}
    // Some services reply with JSON ok:false even when HTTP status is 200.
    const type=response.headers.get('content-type')||'';
    if(!type.includes('application/json')){
      await response.body?.cancel();
      return {ok:false,reason:'local-response-unverified'};
    }
    const data=await response.json().catch(()=>null);
    if(data?.ok===false||data?.accepted===false)return {ok:false,reason:'local-report-rejected'};
    if(data?.ok!==true&&data?.accepted!==true)return {ok:false,reason:'local-response-unverified'};
    return {ok:true,transport:'http'};
  }catch(e){
    return {ok:false,reason:e?.name==='TimeoutError'?'local-timeout':'local-transport-error'};
  }
}

async function viaInstalledReporter(report,{timeoutMs=15000,python,script}={}){
  const py=python||process.env.VMO_PYTHON||DEFAULT_PYTHON;
  const file=script||process.env.VMO_REPORT_SCRIPT||DEFAULT_SCRIPT;
  try{await Promise.all([access(py),access(file)]);}catch{return {ok:false,reason:'installed-reporter-not-found'};}
  return await new Promise(resolve=>{
    let done=false,timer,child;
    const finish=value=>{if(!done){done=true;clearTimeout(timer);resolve(value);}};
    try{child=spawn(py,[file],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}
    catch{return finish({ok:false,reason:'reporter-launch-failed'});}
    // Even trusted reporter subprocess output is NOT reflected in application logs.
    child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
    timer=setTimeout(()=>{child.kill();finish({ok:false,reason:'reporter-timeout'});},timeoutMs);
    child.on('error',()=>finish({ok:false,reason:'reporter-launch-failed'}));
    child.on('close',code=>finish(code===0?{ok:true,transport:'python'}:{ok:false,reason:'reporter-nonzero-exit'}));
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(report)+'\n','utf8');
  });
}

export async function reportApp(report,options={}){
  const transport=options.transport||process.env.VMO_REPORT_TRANSPORT||'auto';
  if(transport==='python')return viaInstalledReporter(report,options);
  if(transport==='http')return postLocal(report,options);
  if(transport!=='auto')return {ok:false,reason:'unknown-transport'};
  const httpResult=await postLocal(report,options);
  if(httpResult.ok)return httpResult;
  // 401/403 or explicit app rejection MUST NOT be bypassed by alternate IPC.
  // Missing endpoints, 5xx and unavailable loopback may fall back to the
  // trusted local registration helper; credentials still never leave this VM.
  const fallbackAllowed=/^(local-http-(404|405|5\d\d)|local-timeout|local-transport-error|local-response-unverified)$/.test(httpResult.reason);
  if(!fallbackAllowed)return httpResult;
  const helperResult=await viaInstalledReporter(report,options);
  if(helperResult.ok)return helperResult;
  return {ok:false,reason:httpResult.reason+'__'+helperResult.reason};
}

async function recordReporterStatus(report,result){
  try{
    const root=process.env.LOCALAPPDATA||join(homedir(),'AppData','Local');
    const file=join(root,'DSH-FishSoul-Gateway','logs','vmo-report-status.log');
    await mkdir(dirname(file),{recursive:true});
    const st=await stat(file).catch(()=>null);
    if(st?.size>1024*1024)await rename(file,file+'.1').catch(()=>{});
    const outcome=result.ok?(result.transport==='python'?'registered-by-local-helper':'accepted-by-local-http'):String(result.reason||'report-failed').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100);
    const credential=report.auth.access_code?'present':'missing';
    const line=`[${new Date().toISOString()}] app_id=${report.app_id} url=${report.url} version=${report.version} online=${report.online} auth.kind=${report.auth.kind} credential=${credential} status=${outcome}\n`;
    await appendFile(file,line,{encoding:'utf8',mode:0o600});
  }catch{}
}

/**
 * A self-running, change-driven retry queue per app. update() is non-blocking.
 * Immediate first attempt; on failure waits 10s, 30s, 60s, 60s ... until
 * acknowledged. A new port or authorization resets backoff and sends ASAP.
 * Successful reports are refreshed every two minutes after Agent restart.
 */
export function createAppReporter({appId,transport,submit=reportApp,heartbeatMs=120000,delays=RETRY_DELAYS_MS,onResult}={}){
  if(!Object.hasOwn(APP_AUTH_KINDS,appId))throw Error('Unsupported app_id');
  let desired=null,signature='',revision=0,timer=null,running=false,stopped=false,failures=0;
  let lastResult=null;
  const schedule=(ms)=>{clearTimeout(timer);if(stopped)return;timer=setTimeout(()=>{void attempt();},ms);timer.unref?.();};
  async function attempt(){
    if(stopped||running||!desired)return;
    running=true;
    const report=desired,startedRevision=revision;
    let result;
    try{result=await submit(report,{transport});}
    catch{result={ok:false,reason:'report-submit-failed'};}
    running=false;
    lastResult=result;
    await recordReporterStatus(report,result);
    onResult?.({appId,report,result});
    if(stopped)return;
    if(revision!==startedRevision){failures=0;schedule(0);return;}
    if(result.ok){failures=0;schedule(heartbeatMs);}
    else{const delay=delays[Math.min(failures,delays.length-1)];failures++;schedule(delay);}
  }
  return {
    update(report){
      if(stopped)throw Error('Reporter stopped');
      if(report.app_id!==appId)throw Error('Report does not belong to this app');
      const next=JSON.stringify(report); // In-memory only, never logged or persisted.
      if(next===signature)return false;
      desired=report;signature=next;revision++;failures=0;schedule(0);return true;
    },
    stop(){stopped=true;clearTimeout(timer);},
    getStatus(){return {lastResult,hasReport:!!desired,failures};},
  };
}

// Compatibility helper for external callers; prefer createAppReporter for
// indefinite retries and reactive credential/port changes.
export async function reportWithRetry(report,{attempts=4,delays=RETRY_DELAYS_MS,...opts}={}){
  let result={ok:false,reason:'not-attempted'};
  for(let i=0;i<attempts;i++){
    result=await reportApp(report,opts);
    if(result.ok)break;
    if(i<attempts-1)await new Promise(r=>setTimeout(r,delays[Math.min(i,delays.length-1)]));
  }
  await recordReporterStatus(report,result);
  return result;
}
