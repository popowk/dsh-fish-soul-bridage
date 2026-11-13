/**
 * V6.9.7 Customer-Restricted Native Gateway: actual installed fish-soul client modules;
 * no DSH SPA, no DSH core RPC, no WebSocket, no owner cookie in browser.
 * Uses server-held owner cookie as an upstream fish-soul API adapter ONLY.
 * This is NOT a non-owner Host transport or production multi-tenant security.
 */
import http from 'node:http';
import {readFile,stat,mkdir,appendFile,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {randomBytes,timingSafeEqual,createHmac} from 'node:crypto';
import {allowedEndpoint,validateBody,validateQuery,consumeQuota,CUSTOMER_POST,CUSTOMER_GET} from './customer-policy.mjs';
import {ensureNativeApproval,verifiedSnapshotByHash} from './native-approval.mjs';
import {scrubResponse} from './response-scrub.mjs';
import {checkFallback} from './update-fallback.mjs';
import {locatePlugin,getManifest,resolveNativeFile} from './native-paths.mjs';
import {summarizeVoice,summarizeUpdate,compareLocalUpstream,summarizeVoiceTestBody} from './runtime-check.mjs';
import {createLanAccess} from './lan-access.mjs';
import {buildGatewayReport,createAppReporter} from './vmo-report.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const HOST='127.0.0.1', PORT=Number(process.env.FS_GATEWAY_PORT||56781), ORIGIN=`http://${HOST}:${PORT}`;
// Only this single LAN source IP is permitted. Do NOT accept FS_LAN_ALLOWED_CIDRS
// or lan-config.json as a wider network allowlist. Loopback remains local-admin.
const LAN_CLIENT_ONLY='192.168.2.99/32';
const LAN=createLanAccess({port:PORT,lanIp:process.env.FS_LAN_BIND_IP||'',allowedCidrs:process.env.FS_LAN_BIND_IP?LAN_CLIENT_ONLY:''});
const PREFIX='/api/plugins/fish-soul', CODE=process.env.FS_ACCESS_CODE||randomBytes(12).toString('hex');
// The independent gateway login secret must be a valid VMO access_code too.
// Fail closed on unsafe injected values rather than silently registering null.
if(!CODE || CODE.length>512 || /[\r\n\x00]/.test(CODE))throw Error('Invalid FS_ACCESS_CODE');
const COOKIE='FS_NATIVE_V69', SESSION=randomBytes(32).toString('hex'), PIN_COOKIE='FS_NATIVE_PIN', PIN_SECRET=randomBytes(32);
const AUTH_FILE=process.env.FS_AUTH_FILE||join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'DSH-fish-soul-bridge','host-auth.json');
const CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':CSP};
const MIME={'.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'};
const MAX_JSON=256*1024;
const MAX_STICKER_UPLOAD=20*1024*1024; // fish-soul >=0.15.46 native binary image limit
function stickerMagic(buf){
 if(buf.length>=8&&buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return 'image/png';
 if(buf.length>=3&&buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)return 'image/jpeg';
 if(buf.length>=6&&['GIF87a','GIF89a'].includes(buf.toString('ascii',0,6)))return 'image/gif';
 if(buf.length>=12&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return '';
}
// Mutating business operations (including imports, deletion, restore, and
// publishing) are permitted on this authenticated per-VM gateway. The
// strict exclusions live in customer-policy.mjs. Host RPC / raw WS / arbitrary
// file and network access are NEVER exposed by the bridge.
// Some state payloads expose configuration. Values of keys/passwords are
// recursively blanked; fields such as hasApiKey remain intact.
const TRACKED=new Set([...CUSTOMER_POST, ...CUSTOMER_GET, '/channels/qq-config','/channels/bili-config','/bili/qr/start','/bili/qr/poll','/bili/logout','/bili/cookie','/channels/douyin-config','/models/config','/voice/test','/update/check','/douyin/browser/start','/douyin/browser/close','/douyin/screenshot']);
const REPORT={version:'1.0.0',startedAt:new Date().toISOString(),mode:'customer-restricted-native-component',stats:{nativeAssets:0,pluginCallsAllowed:0,pluginCallsDenied:0,coreDenied:0,webSocketsDenied:0,uiErrors:0,updateFallbacks:0,policyDenied:0,rateLimited:0,nativeApprovalDenied:0},denied:[],clientErrors:[],operations:[]};
let upstream=null, ownerCookie='', authMode='manual', dshToken=null;let pluginDir=null;
let failures=0,lockedUntil=0;
const CUSTOMER_DOUYIN=process.env.FS_CUSTOMER_DOUYIN_BROWSER!=='0';
// Can be disabled by setting FS_CUSTOMER_MODELS_CONFIG=0 in the VM launcher.
const CUSTOMER_MODELS_CONFIG=process.env.FS_CUSTOMER_MODELS_CONFIG!=='0';
const CUSTOMER_DOUYIN_CONFIG=process.env.FS_CUSTOMER_DOUYIN_CONFIG!=='0';
const CUSTOMER_SOCIAL_CONFIG=process.env.FS_CUSTOMER_SOCIAL_CONFIG!=='0';
const CUSTOMER_BILI_AUTH=process.env.FS_CUSTOMER_BILI_AUTH!=='0';
const CUSTOMER_DOUYIN_CUSTOM_BROWSER=false; // arbitrary executable paths never accepted from a customer
const APPROVAL_FILE=process.env.FS_APPROVAL_FILE||undefined;
const AUDIT_FILE=process.env.FS_AUDIT_FILE||join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'DSH-fish-soul-bridge','denied-v69.jsonl');
let auditQueue=Promise.resolve();
function audit(entry){
 const record=JSON.stringify(entry)+'\n';
 auditQueue=auditQueue.then(async()=>{
  await mkdir(dirname(AUDIT_FILE),{recursive:true});
  let length=0;try{length=(await stat(AUDIT_FILE)).size;}catch{}
  if(length>1024*1024){try{await rename(AUDIT_FILE,AUDIT_FILE+'.1');}catch{}}
  await appendFile(AUDIT_FILE,record,{mode:0o600});
 }).catch(()=>{});
}
async function nativeStatus(){return ensureNativeApproval(pluginDir,APPROVAL_FILE);}
function publicNativeStatus(st){const {activeDir, ...publicStatus}=st;return publicStatus;}
function rawPathSafe(req){const path=String(req.url||'/').split('?')[0];return path.startsWith('/')&&!/%(?:2e|2f|5c|25|00)/i.test(path)&&!/[\\\x00-\x1f]/.test(path)&&!path.includes('//')&&!path.includes('..');}
let updateCache=null;
let lastTtsRequest=null;
function equals(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function cookieValue(req,name){const match=(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(name+'='));return match?.slice(name.length+1)||'';}
function logged(req){return equals(cookieValue(req,COOKIE),SESSION);}
function signedPin(hash){const sig=createHmac('sha256',PIN_SECRET).update(hash).digest('hex');return hash+'.'+sig;}
async function pinnedNative(req){const pin=cookieValue(req,PIN_COOKIE);const match=/^([a-f0-9]{20})\.([a-f0-9]{64})$/.exec(pin);if(!match||!equals(pin,signedPin(match[1])))return null;return verifiedSnapshotByHash(match[1],APPROVAL_FILE);}
function validHost(req){return LAN.validHost(req);}
function validOrigin(req){return LAN.validOrigin(req);}
function send(res,status,data){res.writeHead(status,{...HEADERS,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function text(res,status,value,ct='text/plain; charset=utf-8'){res.writeHead(status,{...HEADERS,'Content-Type':ct});res.end(value);}
function reject(req,res,reason,status=403){
 const p=new URL(req.url||'/',ORIGIN).pathname;
 const summary=p.startsWith(PREFIX+'/')?p:p.startsWith('/api/')?'/api/[core]':p.startsWith('/plugins/')?'/plugins/[core]':'/[unknown]';
 const entry={at:new Date().toISOString(),method:String(req.method).slice(0,8),path:summary,reason};
 REPORT.denied.push(entry);audit(entry);if(REPORT.denied.length>40)REPORT.denied.shift();
 if(reason==='fish-policy'||reason.startsWith('policy-')){REPORT.stats.pluginCallsDenied++;REPORT.stats.policyDenied++;}
 else if(reason==='rate-limit')REPORT.stats.rateLimited++;else if(reason==='unapproved-native')REPORT.stats.nativeApprovalDenied++;else REPORT.stats.coreDenied++;
 send(res,status,{ok:false,error:'该操作未获客户入口授权',reason});
}
function parseDSH(raw){
 let u;try{u=new URL(String(raw||'').trim());}catch{throw Error('授权 URL 无效');}
 if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.searchParams.getAll('token').length!==1||!u.searchParams.get('token'))throw Error('只接受 DSH 本机根路径及单一 token 参数');
 return u;
}
async function authenticate(u){
 const r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(12000)});
 if(![302,303].includes(r.status))throw Error('DSH Token 交换失败：HTTP '+r.status);
 const cookies=(r.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0].trim()).filter(c=>/^[!#$%&'*+.^_`|~\w-]+=/.test(c));
 if(!cookies.length)throw Error('DSH 未发放会话 Cookie');
 const check=await fetch(u.origin+'/',{headers:{cookie:cookies.join('; ')},redirect:'manual',signal:AbortSignal.timeout(12000)});
 if(check.status!==200)throw Error('DSH Cookie 无效：HTTP '+check.status);
 upstream=new URL(u.origin);ownerCookie=cookies.join('; ');dshToken=u.searchParams.get('token');
}
async function currentHandoff(){
 let data;try{data=JSON.parse(await readFile(AUTH_FILE,'utf8'));}catch{return null;}
 if(data.schema!==1||!Number.isInteger(data.pid)||!Number.isInteger(data.updatedAt)||Math.abs(Date.now()-data.updatedAt)>45000)return null;
 try{return parseDSH(data.url);}catch{return null;}
}
async function autoAuth(){
 const url=await currentHandoff();if(!url)return false;
 try{await authenticate(url);authMode='auto';return true;}catch{return false;}
}
// Installation / Desktop updates may rotate the Host token between the
// launcher seeing a fresh handoff and the gateway exchanging it. Retry the
// real cookie exchange against fresh records rather than trusting timestamps.
async function autoAuthWithRetry(){
  const deadline=Date.now()+90000;
  let lastReport=0;
  while(Date.now()<deadline){
    if(await autoAuth())return true;
    if(Date.now()-lastReport>15000){
      console.log('[auth] Waiting for current DSH Host session; refreshing auto-auth handoff...');
      lastReport=Date.now();
    }
    await new Promise(resolve=>setTimeout(resolve,1100));
  }
  return false;
}
async function readBody(req,max=MAX_JSON){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(Error('body too large'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
// Newer fish-soul TTS can wait up to 300s; browser login and posting may
// also exceed the old blanket 30s timeout. The VMO proxy itself may still have
// a shorter timeout and must be checked separately if it returns 502/504.
function boundedTimeout(name,defaultMs,minMs,maxMs){
 const n=Number(process.env[name]);
 return Number.isFinite(n)&&n>=minMs&&n<=maxMs?Math.trunc(n):defaultMs;
}
function upstreamTimeout(endpoint){
 if(endpoint==='/voice/test')return boundedTimeout('FS_TTS_TEST_TIMEOUT_MS',320000,65000,320000);
 if(endpoint==='/douyin/browser/start')return boundedTimeout('FS_DOUYIN_START_TIMEOUT_MS',120000,30000,180000);
 if(['/douyin/post-now','/douyin/comments-now'].includes(endpoint))return 180000;
 if(['/douyin/screenshot','/douyin/self-check','/douyin/browser/rescan'].includes(endpoint))return 60000;
 if(['/channels/douyin-config','/channels/qq-config','/channels/bili-config','/bili/qr/start','/bili/qr/poll','/bili/cookie','/bili/logout'].includes(endpoint))return 15000;
 return 30000;
}

async function fetchPlugin(req,endpoint,search='',body,contentType='application/json'){
 const target=new URL(PREFIX+endpoint+search,upstream);
 return fetch(target,{method:req.method,headers:{cookie:ownerCookie,origin:upstream.origin,referer:upstream.origin+'/',accept:req.headers.accept||'*/*',...(body?{'content-type':contentType}:{})},body,redirect:'manual',signal:AbortSignal.timeout(upstreamTimeout(endpoint))});
}
function safeDetail(v){
 const str=String(v||'').slice(0,300);
 // Keep error categories, never copy provider URLs, keys, token or user text into a report.
 return str.replace(/https?:\/\/[^\s]+/ig,'[url]').replace(/sk-[A-Za-z0-9_-]{6,}/ig,'[secret]').replace(/(?:token|cookie|key|password|authorization)\s*[:=]\s*[^\s,;]+/ig,'[redacted]').slice(0,220);
}
function recordOp(endpoint,{status,ok,error,category,ms,source}){
 if(!TRACKED.has(endpoint))return;
 REPORT.operations.push({at:new Date().toISOString(),endpoint,status,ok,category,ms, ...(source?{source}:{}), ...(error?{error:safeDetail(error)}:{})});
 if(REPORT.operations.length>30)REPORT.operations.shift();
}
async function bridgePlugin(req,res,path,u){
 if(!upstream||!ownerCookie)return send(res,503,{ok:false,error:'DSH 尚未完成授权，网关正在自动重连'});
 const endpoint=path.slice(PREFIX.length),t0=Date.now();
 const ui=await nativeStatus();
 if(!ui.ok)return reject(req,res,'unapproved-native',409);
 // An older verified UI may still be rendered during a new release's npm
 // verification. Don't allow schema-sensitive writes against a newer Host.
 if(ui.mode==='fallback'&&req.method==='POST'&&!new Set(['/voice/test','/update/check','/retrieval/probe']).has(endpoint))
  return reject(req,res,'policy-upgrade-readonly',409);
 if(!allowedEndpoint(req.method,endpoint,{douyinBrowser:CUSTOMER_DOUYIN,douyinConfig:CUSTOMER_DOUYIN_CONFIG,modelConfig:CUSTOMER_MODELS_CONFIG,socialConfig:CUSTOMER_SOCIAL_CONFIG,biliAuth:CUSTOMER_BILI_AUTH}))return reject(req,res,'fish-policy');
 const query=validateQuery(endpoint,u.search);
 if(!query.ok)return reject(req,res,'policy-'+query.reason,400);
 const quota=consumeQuota(req.method,endpoint);
 if(!quota.ok)return reject(req,res,'rate-limit',429);
 let body,contentType='application/json';
 if(req.method==='POST'){
  if(!validOrigin(req)||req.headers['sec-fetch-site']==='cross-site')return reject(req,res,'policy-origin',403);
  const incomingType=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  const rawSticker=endpoint==='/stickers/import'&&
    ['image/png','image/jpeg','image/gif','image/webp','application/octet-stream'].includes(incomingType);
  if(rawSticker){
   // The only binary POST tunnel is the authenticated sticker importer; never
   // widen body/MIME limits for the remaining plugin or DSH endpoints.
   const raw=await readBody(req,MAX_STICKER_UPLOAD);
   const magic=stickerMagic(raw);
   if(!magic||(incomingType!=='application/octet-stream'&&incomingType!==magic))
    return reject(req,res,'policy-sticker-binary-type',415);
   body=raw;contentType=incomingType;
  }else{
   if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))
    return reject(req,res,'policy-json-content-type',415);
   const raw=await readBody(req);
   let parsed;
   try{parsed=raw.length?JSON.parse(raw.toString('utf8')):{};}
   catch{return send(res,400,{ok:false,error:'Invalid JSON body'});}
   const checked=validateBody(endpoint,parsed,raw.length>0,{allowCustomBrowser:CUSTOMER_DOUYIN_CUSTOM_BROWSER});
   if(!checked.ok)return reject(req,res,'policy-'+checked.reason,400);
   // Canonical JSON removes ambiguous whitespace and duplicate property syntax.
   // Empty native POSTs (update/check and several browser controls) stay empty.
   body=raw.length?Buffer.from(JSON.stringify(checked.value)):undefined;
   if(endpoint==='/voice/test')lastTtsRequest=summarizeVoiceTestBody(checked.value);
  }
 }
 let up;
 try{up=await fetchPlugin(req,endpoint,u.search,body,contentType);}
 catch(e){
  const kind=e?.name==='TimeoutError'||e?.name==='AbortError'?'gateway-timeout':'upstream-connection';
  const status=kind==='gateway-timeout'?504:502;
  recordOp(endpoint,{status,ok:false,category:kind,ms:Date.now()-t0});
  return send(res,status,{ok:false,category:kind,error:kind==='gateway-timeout'?'DSH 插件处理超时；配置可能已保存，请先刷新状态后再决定是否重试':'网关无法连接 DSH 插件'});
 }
 if(up.status>=300&&up.status<400){recordOp(endpoint,{status:502,ok:false,category:'upstream-redirect',ms:Date.now()-t0});return send(res,502,{ok:false,category:'upstream-redirect',error:'DSH 上游会话已重定向（可能授权过期），请检查 DSH 授权状态'});}
 const mime=(up.headers.get('content-type')||'application/octet-stream').split(';')[0].toLowerCase();
 if(!['application/json','text/plain','text/css','audio/mpeg','audio/wav','audio/ogg','audio/x-wav','audio/opus','image/png','image/jpeg','image/gif','image/webp'].includes(mime)){recordOp(endpoint,{status:502,ok:false,category:'upstream-content-type',ms:Date.now()-t0});return send(res,502,{ok:false,category:'upstream-content-type',error:'Unexpected plugin response type'});}
 let payload;try{payload=Buffer.from(await up.arrayBuffer());}
 catch{recordOp(endpoint,{status:502,ok:false,category:'upstream-body',ms:Date.now()-t0});return send(res,502,{ok:false,category:'upstream-body',error:'DSH 插件响应读取失败'});}
 if(payload.length>(['/voice/test','/douyin/screenshot'].includes(endpoint)?24:16)*1024*1024){recordOp(endpoint,{status:502,ok:false,category:'upstream-size',ms:Date.now()-t0});return send(res,502,{ok:false,category:'upstream-size',error:'Upstream response too large'});}
 let result=payload,json=null,replyStatus=up.status;
 if(mime==='application/json'){
  try{json=JSON.parse(payload.toString('utf8'));}catch{recordOp(endpoint,{status:502,ok:false,category:'upstream-json',ms:Date.now()-t0});return send(res,502,{ok:false,category:'upstream-json',error:'Invalid upstream JSON'});}
  if(endpoint==='/update/check' && req.method==='POST' && (up.status>=400 || (json?.latest==null && json?.error))){
   const current=(await getManifest(pluginDir)).version;
   const backup=await checkFallback({current});
   REPORT.stats.updateFallbacks++;
   if(backup.ok){json=backup;replyStatus=200;updateCache={at:Date.now(),version:current,value:backup};}
   else if(json&&typeof json==='object'){
    json={...json,fallback:{ok:false,reason:backup.error,sources:backup.failures?.map(x=>({source:x.source,category:x.category}))}};
   }
  }
  if(endpoint==='/update/state' && json?.latest==null && json?.error && updateCache && updateCache.at>Date.now()-10*60_000 && updateCache.version===(await getManifest(pluginDir)).version){
    json={...json,...updateCache.value,autoCheck:json.autoCheck!==false};
  }
  result=Buffer.from(JSON.stringify(scrubResponse(json)));
 }
 const ok=replyStatus<400&&(json?json.ok!==false:true);
 let category=ok?'success':'plugin-or-provider-error';
 if(endpoint==='/voice/test'&&!ok)category='tts-plugin-or-provider';
 if(endpoint==='/update/check'&&!ok)category='update-source-or-plugin';
 const message=(!ok&&json)?json.error||json.lastError||'':'';
 // Diagnostics never include user speech text or local browser paths.
 const reportedError=(endpoint.startsWith('/channels/')||endpoint.startsWith('/bili/'))?(!ok?'channel-or-login-upstream-error':''):
   endpoint==='/voice/test'?(String(message).match(/HTTP\s+[1-5]\d\d/i)?.[0]||(!ok?'tts-plugin-failed':'')):
   endpoint.startsWith('/douyin/')?(!ok?'browser-operation-failed':''):message;
 recordOp(endpoint,{status:replyStatus,ok:replyStatus===200&&(json?json.ok!==false:true),error:reportedError,category,ms:Date.now()-t0,source:endpoint==='/update/check'?json?.source:null});
 REPORT.stats.pluginCallsAllowed++;
 res.writeHead(replyStatus,{...HEADERS,'Content-Type':up.headers.get('content-type')||mime,'Content-Length':result.length});res.end(result);
}
async function serveFile(res,path,mime,max=2*1024*1024,extraHeaders={}){
 const data=await readFile(path);if(data.length>max)return send(res,413,{ok:false,error:'asset size exceeded'});
 res.writeHead(200,{...HEADERS,...extraHeaders,'Content-Type':mime});res.end(data);
}
function browserFailureCategory(message){
 const s=String(message||'');
 if(/session.?0|interactive|desktop|桌面|会话|服务进程/i.test(s))return 'interactive-session';
 if(/edge|chrome|chromium|browser not found|找不到浏览器|路径不存在/i.test(s))return 'browser-not-found';
 if(/timeout|timed out|超时/i.test(s))return 'timeout';
 if(/cdp|debug port|devtools|连接断了|websocket/i.test(s))return 'browser-connection';
 if(/permission|access denied|拒绝访问|权限/i.test(s))return 'permission';
 return s?'other':'none';
}
async function mediaStatus(){
 const out={ok:true,bridgeVersion:'1.0.0',plugin:pluginDir?(await getManifest(pluginDir)).version:'not-installed',upstreamReady:!!upstream,voice:{available:false},douyin:{available:false}};
 if(!upstream||!ownerCookie)return out;
 for(const [endpoint,key] of [['/voice/state','voice'],['/channels/state','douyin']]){
  try{
   const r=await fetchPlugin({method:'GET',headers:{accept:'application/json'}},endpoint);
   if(!r.ok){out[key]={available:false,upstreamStatus:r.status};continue;}
   const value=await r.json();
   if(key==='voice')out.voice=summarizeVoice(value);
   else{
    const d=value?.douyin||{},h=d.host||{};
    out.douyin={available:value?.ok!==false,enabled:d.enabled===true,
     browserState:['running','stopped','starting','checking','closing','paused','error'].includes(h.state)?h.state:'unknown',
     browserCount:Array.isArray(h.browsers)?h.browsers.length:null,loggedIn:h.loggedIn===true,
     failureCategory:browserFailureCategory(h.lastError||d.channel?.lastError),
     windowVisible:d.window==='visible'};
   }
  }catch(e){out[key]={available:false,category:e?.name==='TimeoutError'?'timeout':'connection-failed'};}
 }
 return out;
}

async function view(req,res){
 const path=new URL(req.url||'/',ORIGIN).pathname;
 if(!rawPathSafe(req))return reject(req,res,'policy-unsafe-path',400);
 if(!LAN.allowsClient(req))return reject(req,res,'lan-client-outside-allowlist');
 if(!validHost(req))return reject(req,res,'untrusted-host');
 if(req.method==='GET'&&path==='/__bridge/health')return send(res,200,{ok:true,version:'1.0.0',authenticated:logged(req),pluginLocated:!!pluginDir,upstreamReady:!!upstream});
 if(path==='/__bridge/unlock'&&req.method==='POST'){
  if(!validOrigin(req))return send(res,403,{ok:false,error:'origin-mismatch'});
  if(!/^application\/json/i.test(req.headers['content-type']||''))return send(res,415,{ok:false,error:'content-type'});
  if(Date.now()<lockedUntil)return send(res,429,{ok:false});
  let b;try{b=JSON.parse((await readBody(req,4096)).toString('utf8'));}catch{return send(res,400,{ok:false,error:'Invalid JSON body'});}
  if(!equals(b.code,CODE)){if(++failures>=8){failures=0;lockedUntil=Date.now()+120000;}return send(res,401,{ok:false});}
  failures=0;
  res.writeHead(200,{...HEADERS,'Content-Type':'application/json','Set-Cookie':`${COOKIE}=${SESSION}; HttpOnly; SameSite=Strict; Path=/; Max-Age=21600`});return res.end(JSON.stringify({ok:true}));
 }
 if(!logged(req)){
  if(req.method==='GET'&&path==='/')return serveFile(res,join(HERE,'public','login.html'),'text/html; charset=utf-8');
  if(req.method==='GET'&&path==='/__bridge/login.js')return serveFile(res,join(HERE,'public','login.js'),'application/javascript; charset=utf-8');
  if(req.method==='GET'&&path==='/__bridge/shell.css')return serveFile(res,join(HERE,'public','shell.css'),'text/css; charset=utf-8');
  return send(res,401,{ok:false,error:'请先登录独立工作台'});
 }
 if(req.method==='GET'&&path==='/'){const st=await nativeStatus();
  const headers=st.ok?{'Set-Cookie':`${PIN_COOKIE}=${signedPin(st.hash)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=21600`}:{};
  return serveFile(res,join(HERE,'public',st.ok?'index.html':'approval-required.html'),'text/html; charset=utf-8',2*1024*1024,headers);}
 if(req.method==='GET'&&path==='/__bridge/shell.css')return serveFile(res,join(HERE,'public','shell.css'),'text/css; charset=utf-8');
 if(req.method==='GET'&&path==='/__bridge/native-loader.js')return serveFile(res,join(HERE,'public','native-loader.js'),'application/javascript; charset=utf-8');
 if(req.method==='GET'&&path==='/__bridge/scoped-plugin.js')return serveFile(res,join(HERE,'public','scoped-plugin.js'),'application/javascript; charset=utf-8');
 if(req.method==='GET'&&path==='/__bridge/diagnose.js')return serveFile(res,join(HERE,'public','diagnose.js'),'application/javascript; charset=utf-8');
 if(req.method==='GET'&&path==='/__vendor/react.js'&&!(await nativeStatus()).ok)return reject(req,res,'unapproved-native',409);
 if(req.method==='GET'&&path==='/__vendor/react-dom.js'&&!(await nativeStatus()).ok)return reject(req,res,'unapproved-native',409);
 if(req.method==='GET'&&path==='/__vendor/react.js')return serveFile(res,join(HERE,'vendor','react.js'),'application/javascript; charset=utf-8',200*1024);
 if(req.method==='GET'&&path==='/__vendor/react-dom.js')return serveFile(res,join(HERE,'vendor','react-dom.js'),'application/javascript; charset=utf-8',300*1024);
 if(req.method==='GET'&&path==='/__bridge/version'){const st=await nativeStatus();const pin=await pinnedNative(req);const active=await getManifest(pin?.dir||st.activeDir||pluginDir);return send(res,200,{...active,approved:st.ok,approvalReason:st.reason,mode:st.mode,latestVerifiedHash:st.hash,installedVersion:st.installedVersion||st.version,verificationError:st.verificationError||null});}
 if(req.method==='GET'&&path==='/__bridge/media-health')return send(res,200,await mediaStatus());
 if(req.method==='GET'&&path==='/__bridge/voice-health'){
  try{
   const r=await fetchPlugin({method:'GET',headers:{accept:'application/json'}},'/voice/state');
   if(!r.ok)return send(res,502,{ok:false,source:'DSH-fish-soul',status:r.status});
   return send(res,200,{ok:true,...summarizeVoice(await r.json()),requestShape:lastTtsRequest});
  }catch(e){return send(res,502,{ok:false,source:'DSH-fish-soul',category:e?.name==='TimeoutError'?'timeout':'upstream-unavailable'});}
 }
 if(req.method==='GET'&&path==='/__bridge/runtime-check'){
  const local=await getManifest(pluginDir);
  const details={ok:true,localPlugin:local,connection:{authMode,upstreamKind:'DSH-local-session'},upstream:{voice:null,update:null}};
  for(const [endpoint,name,fn] of [['/voice/state','voice',summarizeVoice],['/update/state','update',summarizeUpdate]]){
   try{
    const r=await fetchPlugin({method:'GET',headers:{accept:'application/json'}},endpoint);
    details.upstream[name]=r.ok?{status:r.status,...fn(await r.json())}:{available:false,status:r.status};
   }catch(e){details.upstream[name]={available:false,category:e?.name==='TimeoutError'?'timeout':'connection-failed'};}
  }
  details.profileComparison=compareLocalUpstream(local,details.upstream.update);
  details.lastVoiceTestRequestShape=lastTtsRequest;
  return send(res,200,details);
 }
 if(req.method==='GET'&&path==='/__bridge/security-status')return send(res,200,{ok:true,version:'1.0.0',mode:'customer',native:publicNativeStatus(await nativeStatus()),permissions:{denyByDefault:true,destructiveBusinessOps:true,coreRpcAllowed:false,ownerCookieToBrowser:false,douyinBrowser:CUSTOMER_DOUYIN,douyinConfig:CUSTOMER_DOUYIN_CONFIG,socialConfig:CUSTOMER_SOCIAL_CONFIG,biliAuth:CUSTOMER_BILI_AUTH,customBrowserPath:CUSTOMER_DOUYIN_CUSTOM_BROWSER,nonOwnerPeerTransport:false},notes:['仅可信局域网/客户专属 VM 内测试','启动与升级时自动核对当前 npm 发行包；可回退至已验证旧版脚本','无法替代虚拟机和网络隔离']});
 if(req.method==='GET'&&path==='/__bridge/diagnose')return serveFile(res,join(HERE,'public','diagnose.html'),'text/html; charset=utf-8');
 if(req.method==='GET'&&path==='/__bridge/report')return send(res,200,{...REPORT,lastVoiceTestRequestShape:lastTtsRequest,plugin:await getManifest(pluginDir),security:{noHostRPC:true,noHostWebsocket:true,noDshRootHtml:true,ownerCookieToBrowser:false,nonOwnerPeerTransport:false,nativeAutoVerification:true,denyUnknownRoutes:true,perVmNetworkIsolationVerified:false},limitations:['Standalone uses a server-side DSH owner session to call approved fish-soul HTTP endpoints; it does not dispatch through a non-owner Peer.','Client-side UI resources come from the npm-verified installed plugin or a verified prior snapshot; npm integrity does not establish safety and the client is not a hardened sandbox.','Authenticated per-VM business operations, including restore/delete/social publishing, are enabled; privileged shell, workspace migration, arbitrary fetch, and raw file access remain blocked.','React vendor runtime is version-pinned and not yet verified against every DSH/plugin release.']});
 if(req.method==='POST'&&path==='/__bridge/client-error'){
  if(!validOrigin(req))return send(res,403,{ok:false});
  const value=JSON.parse((await readBody(req,2048)).toString('utf8'));
  REPORT.stats.uiErrors++;
  REPORT.clientErrors.push({at:new Date().toISOString(),phase:String(value.phase||'').slice(0,64),error:String(value.error||'').replace(/https?:\/\/[^\s]+/ig,'[url]').replace(/sk-[a-z0-9_-]{8,}/ig,'[secret]').replace(/(?:api.?key|authorization|cookie|token|password)\s*[:=]\s*[^\s,;]+/ig,'[redacted]').slice(0,180)});
  if(REPORT.clientErrors.length>15)REPORT.clientErrors.shift();return send(res,200,{ok:true});
 }
 if(req.method==='GET'&&path.startsWith('/__native/')){
  const filename=path.slice('/__native/'.length);
  if(!pluginDir)return send(res,503,{ok:false,error:'本机未找到已安装的 dsh-fish-soul/lib/client.js'});
  const st=await nativeStatus();
  if(!st.ok)return reject(req,res,'unapproved-native',409);
  const pin=await pinnedNative(req);
  const native=await resolveNativeFile(pin?.dir||st.activeDir||pluginDir,filename);
  if(!native)return reject(req,res,'native-resource-denied');
  REPORT.stats.nativeAssets++;
  return serveFile(res,native,'application/javascript; charset=utf-8',4*1024*1024);
 }
 if(path.startsWith(PREFIX+'/'))return bridgePlugin(req,res,path,new URL(req.url,ORIGIN));
 // Exact Host pages, static bundles, plugin graphs, core API, and WS are never proxied.
 return reject(req,res,'core-or-unknown');
}
const handleRequest=(req,res)=>view(req,res).catch(e=>{console.error('[V1.0.0] request error:',String(e?.message||e).replace(/token=[^\s&]+/ig,'token=[redacted]'));if(!res.headersSent)return send(res,e?.code==='ENOENT'?503:e.status||502,{ok:false,error:e.code==='ENOENT'?'文件不存在（检查插件目录或 React 运行库）':'网关读取或上游调用失败'});res.destroy();});
const server=http.createServer(handleRequest);
const lanServer=LAN.enabled?http.createServer(handleRequest):null;
for(const listener of [server,lanServer].filter(Boolean))listener.on('upgrade',(req,socket)=>{REPORT.stats.webSocketsDenied++;socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
async function main(){
 if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw Error('无效端口');
 // Bind the local login page FIRST. Waiting for DSH token exchange used to
 // block this port for up to 90s, then terminate the entire gateway.
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
 let lanAvailable=false;
 if(lanServer){
   try{
     await new Promise((resolve,reject)=>{lanServer.once('error',reject);lanServer.listen(PORT,LAN.bind,resolve);});
     lanAvailable=true;
   }catch(e){
     // A stale/missing NIC binding must not take down localhost:56781.
     console.warn('[Gateway] LAN listener unavailable; localhost login remains available: '+e.code);
   }
 }
 console.log('\n=== DSH fish-soul V1.0.0 网关 ===');
 console.log('本机网页：'+ORIGIN+'/');
 console.log('本机健康检查：'+ORIGIN+'/__bridge/health');
 console.log('网关独立登录 CODE 已生成；只通过受信的 Guest Agent 登记，不打印明文。');
 if(lanAvailable)console.log('LAN '+LAN.bind+':'+PORT+' (source '+LAN.ranges.join(', ')+')');
 else console.log('LAN listener unavailable or disabled; 127.0.0.1 remains reachable.');

 // The login page only depends on this listener, NOT on Host owner auth.
 // The actual gateway CODE is registered immediately on successful listen.
 // Real DSH Host token is never part of the reported payload.
 const reporter=createAppReporter({appId:'dsh-fish-soul',onResult:({result})=>{
   if(!result.ok)console.warn('[VMO][dsh-fish-soul] registration failed: '+result.reason);
   else console.log('[VMO][dsh-fish-soul] gateway CODE registered locally via '+result.transport+' (secret redacted); client relay still requires Guest WSS/8766.');
 }});
 let lastVersion='';
 let reportBusy=false;
 async function refreshReport(){
   if(reportBusy)return;
   reportBusy=true;
   try{
     const installed=await getManifest(pluginDir).catch(()=>({}));
     const v=typeof installed.version==='string'?installed.version:'unknown';
     const changed=reporter.update(buildGatewayReport({port:PORT,version:v,online:server.listening,gatewayCode:CODE}));
     if(changed){lastVersion=v;console.log('[VMO][dsh-fish-soul] queued new gateway login CODE (redacted), port='+PORT);}
   }finally{reportBusy=false;}
 }
 await refreshReport();

 // Never await DSH authentication before binding. Host or helper may start
 // later, or its token can rotate at any time. Retrying stays noninteractive.
 let busy=false,lastVerified=0,lastWarn=0;
 async function refreshAuthorization(){
   if(busy)return;busy=true;
   try{
     const authUrl=process.env.DSH_WEB_URL?parseDSH(process.env.DSH_WEB_URL):await currentHandoff();
     const nextToken=authUrl?.searchParams.get('token');
     const expired=Date.now()-lastVerified>60000;
     if(authUrl && (!upstream||nextToken!==dshToken||expired)){
       const wasReady=!!upstream;
       await authenticate(authUrl);
       authMode=process.env.DSH_WEB_URL?'manual-env':'auto';
       lastVerified=Date.now();
       console.log('[auth] DSH session '+(wasReady?'refreshed':'verified')+'; gateway CODE unchanged.');
     }else if(!authUrl&&!upstream&&Date.now()-lastWarn>30000){
       lastWarn=Date.now();
       console.warn('[auth] DSH handoff not available yet; local 56781 login page is online and auto-retry is active.');
     }
   }catch{
     if(Date.now()-lastWarn>30000){lastWarn=Date.now();console.warn('[auth] DSH session verification failed; retrying, localhost gateway remains online.');}
   }finally{busy=false;}
 }
 void refreshAuthorization();
 setInterval(()=>{void refreshAuthorization();},4000).unref();
 setInterval(()=>{void refreshReport();},5000).unref();

 // Do not block the login page while locating/verifying the installed plugin.
 void (async()=>{
   try{
     pluginDir=await locatePlugin();
     const verify=await nativeStatus();
     console.log('[fish-soul] installed client: '+(pluginDir?'found':'missing')+', verified='+Boolean(verify.ok));
     await refreshReport();
   }catch{console.warn('[fish-soul] plugin discovery/verification unavailable; login page remains accessible.');}
 })();
 const shutdown=()=>{reporter.stop();};
 process.on('SIGINT',shutdown);
 process.on('SIGTERM',shutdown);
}
main().catch(e=>{console.error('启动失败：'+String(e.message||e));process.exitCode=1;});
