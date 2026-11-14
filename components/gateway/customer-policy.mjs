/**
 * V6.9.29 per-VM customer policy (fish-soul 0.15.55).
 * Enable the upstream fish-soul business workflows, including destructive
 * actions. Explicitly prevent operations that can execute system commands,
 * select arbitrary local workspaces, fetch arbitrary network targets, or
 * expose privileged debug/private files. NOT a substitute for VM isolation.
 */
import {ALLOW} from './routes.mjs';

// Private debug and raw-file downloads are not safe behind an owner-cookie
// adapter even if later releases accidentally include them in the inventory.
const blockedGet = new Set(['/diagnose']);
export const CUSTOMER_GET = new Set([...ALLOW.GET].filter(x=>!blockedGet.has(x)));

// Only verified exact endpoints in routes.mjs can pass. There is never a
// catch-all API proxy, DSH Host RPC, or shell interface for customers.
export const BLOCKED_CUSTOMER_POST = new Set([
 '/sessions/workspace', // arbitrary workspace location selection
 '/sessions/migrate',   // workspace migration may traverse privileged files
 '/web/test',           // unrestricted web fetch / SSRF into local services
 '/memory/debug'        // privileged inspection, potential internal disclosure
]);
export const CUSTOMER_POST = new Set([...ALLOW.POST].filter(x=>!BLOCKED_CUSTOMER_POST.has(x)));

const SOCIAL_CONFIG=new Set(['/channels/qq-config','/channels/bili-config']);
const BILI_AUTH=new Set(['/bili/qr/start','/bili/qr/poll','/bili/cookie','/bili/logout']);
const DOUYIN_BROWSER = new Set(['/douyin/browser/start','/douyin/browser/close','/douyin/screenshot','/douyin/click','/douyin/self-check']);
const DOUYIN_IDENTITY = new Set(['/douyin/uin-candidates','/douyin/uin-confirm','/douyin/uin-dismiss']);
export function allowedEndpoint(method,endpoint,options={}){
 if(endpoint==='/models/config'&&options.modelConfig===false)return false;
 if((endpoint==='/channels/douyin-config'||DOUYIN_IDENTITY.has(endpoint))&&options.douyinConfig===false)return false;
 if(SOCIAL_CONFIG.has(endpoint)&&options.socialConfig===false)return false;
 if(BILI_AUTH.has(endpoint)&&options.biliAuth===false)return false;
 if(DOUYIN_BROWSER.has(endpoint)&&options.douyinBrowser===false)return false;
 if(method==='GET')return CUSTOMER_GET.has(endpoint);
 return method==='POST'&&CUSTOMER_POST.has(endpoint);
}

const QMAP = Object.freeze({
 '/inspector/person':new Set(['id','personId','platform','qq']),
 '/storage/search':new Set(['q','query','page','limit','offset','status','type','source','personId']),
 '/memory/weekly/sources':new Set(['id','weekId']),
 '/chat-archive/list':new Set(['sessionId','page','limit','offset']),
 '/export/memories':new Set(['format','personId','type']),
 '/activity':new Set(['limit','offset','page']),
 '/inspector/overview':new Set(['limit','offset','page','personId','query','q','status','source','type']),
 '/inspector/importance-lock':new Set(['id']),
 '/inspector/self-outdated':new Set(['offset'])
});
// Only named sticker assets from an existing plugin-reported workspace may
// be read. Native fish-soul still checks knownWorkspace() and list membership.
function safeStickerFile(value){
 return typeof value==='string'&&value.length>=5&&value.length<=160&&
  !value.includes('..')&&/^[^\x00-\x1f\\/:*?"<>|]+\.(?:png|jpe?g|gif|webp)$/i.test(value);
}
function safeWorkspace(value){
 return typeof value==='string'&&value.length>3&&value.length<=500&&
  /^[A-Za-z]:[\\/]/.test(value)&&!/[\x00-\x1f]/.test(value)&&
  !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value);
}
function safeStickerQuery(endpoint,raw){
 // Older clients send JSON sticker imports without a filename query.
 if(endpoint==='/stickers/import'&&!raw)return {ok:true};
 if(raw.length>1400)return {ok:false,reason:'sticker-query-length'};
 const params=new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw);
 const entries=[...params];
 if(endpoint==='/stickers/file'){
  if(entries.length!==2||!params.has('file')||!params.has('ws')||
    !safeStickerFile(params.get('file'))||!safeWorkspace(params.get('ws')))return {ok:false,reason:'sticker-file-query'};
  return {ok:true};
 }
 if(entries.length!==1||!params.has('name'))return {ok:false,reason:'sticker-import-query'};
 const name=params.get('name');
 return name&&name.length<=140&&!name.includes('..')&&!/[\\/:*?"<>|\x00-\x1f]/.test(name)
  ?{ok:true}:{ok:false,reason:'sticker-import-name'};
}
export function validateQuery(endpoint,raw){
 if(endpoint==='/stickers/file'||endpoint==='/stickers/import')return safeStickerQuery(endpoint,raw);
 if(endpoint==='/inspector/self-outdated'){
  if(!raw)return {ok:true};
  if(raw.length>30)return {ok:false,reason:'self-outdated-query-length'};
  const params=new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw);
  const values=[...params];
  const offset=values.length===1&&values[0][0]==='offset'?values[0][1]:null;
  return offset!==null&&/^\d{1,7}$/.test(offset)&&Number(offset)<=1000000
   ?{ok:true}:{ok:false,reason:'self-outdated-offset'};
 }
 if(!raw)return {ok:true};
 if(raw.length>1024)return {ok:false,reason:'query-length'};
 const allowed=QMAP[endpoint];if(!allowed)return {ok:false,reason:'query-not-approved'};
 const q=new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw);
 if([...q].length>12)return {ok:false,reason:'query-amount'};
 const seen=new Set();
 for(const [key,value] of q){
  if(!allowed.has(key)||seen.has(key))return {ok:false,reason:'query-field'};
  seen.add(key);
  if(value.length>300||/[\\\x00-\x1f]/.test(value)||/\/{2}|\.{2}|(?:file|javascript|data):/i.test(value))return {ok:false,reason:'query-value'};
 }
 return {ok:true};
}

const BAD_KEYS=/(^__proto__$|^prototype$|^constructor$|(?:^|_)(?:exec|spawn|shell|cmd|command|script|file(?:name|path)?|directory|dir|cwd|root|vmid|tenantid|profile|webhook|proxy|hostname|socket|bind|listen|port)(?:$|_))/i;
const NETWORK_KEYS=/(?:url|uri|endpoint|baseurl|base_url|apibase|api_base|host|origin)/i;
const CREDENTIAL_KEYS=/(?:api.?key|secret|password|token|cookie|auth|credential|private.?key)/i;
function scanValue(value,depth=0,state={nodes:0}){
 if(++state.nodes>1400||depth>13)return 'complex-body';
 if(Array.isArray(value)){
  if(value.length>250)return 'array-size';
  for(const item of value){const err=scanValue(item,depth+1,state);if(err)return err;}return null;
 }
 if(value&&typeof value==='object'){
  const entries=Object.entries(value);if(entries.length>100)return 'object-keys';
  for(const [key,item] of entries){
   if(key.length>100||BAD_KEYS.test(key)||NETWORK_KEYS.test(key)||CREDENTIAL_KEYS.test(key))return 'sensitive-key';
   const err=scanValue(item,depth+1,state);if(err)return err;
  }return null;
 }
 if(typeof value==='string'&&value.length>12000)return 'string-length';
 if(typeof value==='number'&&!Number.isFinite(value))return 'number';
 if(typeof value==='bigint'||typeof value==='function')return 'type';
 return null;
}
// Dedicated constrained validator for a customer's model settings.
// The normal customer write scanner disallows credential/baseUrl fields; those
// are necessary for configuring one's own model provider in an isolated VM.
// The route is opt-in and still uses the authenticated Bridge/VMO session.
function validateModelSettings(value){
 const state={nodes:0};
 function visit(node,depth=0){
  if(depth>12||++state.nodes>900)return 'complex-body';
  if(Array.isArray(node)){
   if(node.length>160)return 'array-size';
   for(const v of node){const err=visit(v,depth+1);if(err)return err;}
   return null;
  }
  if(node!==null&&typeof node==='object'){
   const entries=Object.entries(node);
   if(entries.length>80)return 'object-keys';
   for(const [k,v] of entries){
    if(k.length>100||BAD_KEYS.test(k)&&k!=='profile')return 'sensitive-key';
    if(CREDENTIAL_KEYS.test(k)){
     if(v!==null){
      if(typeof v==='string'&&(v.length>4096||/[\r\n\0]/.test(v)))return 'credential-format';
      if(typeof v!=='string'&&typeof v!=='boolean'&&typeof v!=='object')return 'credential-format';
     }
    }else if(NETWORK_KEYS.test(k)){
     if(typeof v==='string'&&v){
      let parsed;try{parsed=new URL(v);}catch{return 'invalid-provider-url';}
      if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)return 'invalid-provider-url';
     }else if(v!==null&&v!=='')return 'invalid-provider-url';
    }
    const err=visit(v,depth+1);if(err)return err;
   }
   return null;
  }
  if(typeof node==='string'&&node.length>12000)return 'string-length';
  if(typeof node==='number'&&!Number.isFinite(node))return 'number';
  if(typeof node==='bigint'||typeof node==='function')return 'type';
  return null;
 }
 return visit(value);
}
// fish-soul >=0.15.29 supports multiple TTS providers (including Volc V1/V3).
// The generic JSON scanner intentionally rejects URLs and API keys; voice
// configuration needs a dedicated, exact schema instead of broad permission.
const VOICE_CONFIG_FIELDS = new Set([
 'enabled','sttProvider','baseURL','sttBaseURL','ttsBaseURL','sttModel','ttsModel',
 'ttsVoice','volcAppId','volcCluster','volcResourceId','volcEndpoint',
 'ttsProvider','apiKey','sttApiKey','ttsApiKey','speak','maxChars',
 'ttsPerDay','sttPerDay','timeoutSec'
]);
const VOICE_URL_FIELDS = new Set(['baseURL','sttBaseURL','ttsBaseURL','volcEndpoint']);
const VOICE_KEY_FIELDS = new Set(['apiKey','sttApiKey','ttsApiKey']);
const VOICE_COUNT_RANGES = {
 maxChars:[10,200],ttsPerDay:[0,500],sttPerDay:[0,2000],timeoutSec:[5,300]
};
export function validateVoiceConfig(value) {
 if(!value || typeof value!=='object'||Array.isArray(value)||Object.keys(value).length===0)return 'voice-empty';
 for(const [key,v] of Object.entries(value)){
  if(!VOICE_CONFIG_FIELDS.has(key))return 'voice-field';
  if(key==='enabled'){if(typeof v!=='boolean')return 'voice-enabled';continue;}
  if(Object.hasOwn(VOICE_COUNT_RANGES,key)){
   const [min,max]=VOICE_COUNT_RANGES[key];
   if(!Number.isSafeInteger(v)||v<min||v>max)return 'voice-number';continue;
  }
  if(typeof v!=='string'||v.length>400||/[\r\n\x00]/.test(v))return 'voice-string';
  if(VOICE_KEY_FIELDS.has(key)){
   // A masked value is handled by upstream as "keep existing secret".
   if(v.length>400)return 'voice-key-length';
  } else if(VOICE_URL_FIELDS.has(key)&&v.trim()){
   let u;try{u=new URL(v.trim());}catch{return 'voice-url';}
   if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hash||u.search)return 'voice-url';
   // HTTP only to local TTS servers; remote API keys must use TLS.
   if(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))return 'voice-url-insecure';
  }else if(key==='ttsProvider'&&!['','openai','mimo','volcengine','minimax'].includes(v))return 'voice-provider';
  else if(key==='sttProvider'&&!['','openai','minimax','dashscope'].includes(v))return 'voice-stt-provider';
  else if(key==='speak'&&!['never','mirror','sometimes'].includes(v))return 'voice-speak';
 }
 return null;
}

// Explicit schema mirrored from upstream lib/routes-douyin.js (the config
// handler, not the active posting endpoints). A constrained allow-list is used
// because the regular generic write scanner is deliberately too broad.
const DOUYIN_TOP=new Set(['enabled','autoReply','masterName','masterUid','shareCard','replyWindowMinutes','allowList','replyAll','links','groups','groupReply','callNames','browser','window','browse','post','comments']);
const DOUYIN_BROWSER_KEYS=new Set(['kind','customPath']);
const DOUYIN_BROWSE_KEYS=new Set(['enabled','perDay','videosPerSession','like','likeApi','collect','frames','framesPerDay','share','shareInDm','mode']);
const DOUYIN_POST_KEYS=new Set(['enabled','perDay']);
const DOUYIN_COMMENT_KEYS=new Set(['enabled','perHour','emoji']);
function validateDouyinConfig(value,{allowCustomBrowser=false}={}){
 const nested=(v,allow)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allow.has(k));
 if(!nested(value,DOUYIN_TOP)||Object.keys(value).length===0)return 'douyin-fields';
 for(const key of ['enabled','autoReply','replyAll','groupReply','shareCard']){
  if(Object.hasOwn(value,key)&&typeof value[key]!=='boolean')return 'douyin-boolean';
 }
 if(Object.hasOwn(value,'masterName')&&(typeof value.masterName!=='string'||value.masterName.trim().length>40))return 'douyin-master-name';
 // Keep 19-digit Douyin UIDs as strings: Number() silently corrupts them.
 if(Object.hasOwn(value,'masterUid')&&(typeof value.masterUid!=='string'||
   value.masterUid.length>40||!/^(?:(?:douyin:)?\d{1,22})?$/.test(value.masterUid.trim())))return 'douyin-master-uid';
 if(Object.hasOwn(value,'replyWindowMinutes')&&(!Number.isSafeInteger(value.replyWindowMinutes)||
   value.replyWindowMinutes<1||value.replyWindowMinutes>1440))return 'douyin-reply-window';
 for(const key of ['allowList','groups','callNames','links']){
  if(!Object.hasOwn(value,key))continue;
  const list=value[key];
  if(!Array.isArray(list)||list.length>120||!list.every(x=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=100))return 'douyin-list';
  if(key==='links'){
   if(!list.every(x=>/^.{1,40}?\s*[=＝]\s*\d{5,12}$/.test(x.trim())))return 'douyin-link-format';
  }else if(!list.every(x=>x.trim().length<=40))return 'douyin-name-length';
 }
 if(Object.hasOwn(value,'window')&&!['visible','background'].includes(value.window))return 'douyin-window';
 if(Object.hasOwn(value,'browser')){
  const b=value.browser;
  if(!nested(b,DOUYIN_BROWSER_KEYS))return 'douyin-browser';
  if(Object.hasOwn(b,'kind')&&(typeof b.kind!=='string'||!/^[a-z0-9-]{1,30}$/.test(b.kind)))return 'douyin-browser-kind';
  if(Object.hasOwn(b,'customPath')){
   if(typeof b.customPath!=='string')return 'douyin-browser-path';
   const pathname=b.customPath.trim();
   if(pathname){
    // Custom executable launching is not a normal customer setting. An
    // administrator can explicitly opt in, but only for well-known browsers
    // under Program Files; disallow user-writable locations and traversal.
    if(!allowCustomBrowser||pathname.length>350||pathname.includes('..')||/[\/]{2}/.test(pathname)||
       !/^[A-Za-z]:\\Program Files(?: \(x86\))?\\(?:[^\\/:*?"<>|\x00-\x1f]+\\){1,9}(?:msedge|chrome|brave|firefox)\.exe$/i.test(pathname))return 'douyin-browser-path-restricted';
   }
  }
 }
 const flags=[['browse',DOUYIN_BROWSE_KEYS,{perDay:[0,12],videosPerSession:[1,6],framesPerDay:[0,20]}],['post',DOUYIN_POST_KEYS,{perDay:[0,5]}],['comments',DOUYIN_COMMENT_KEYS,{perHour:[0,30]}]];
 for(const [key,keys,numbers] of flags){
  if(!Object.hasOwn(value,key))continue;
  const nestedValue=value[key];
  if(!nested(nestedValue,keys))return 'douyin-'+key+'-fields';
  for(const [field,v] of Object.entries(nestedValue)){
   if(key==='browse'&&field==='mode'){if(!['browser','http'].includes(v))return 'douyin-browse-mode';continue;}
   if(Object.hasOwn(numbers,field)){
    const [min,max]=numbers[field];
    if(!Number.isInteger(v)||v<min||v>max)return 'douyin-'+key+'-number';
   }else if(typeof v!=='boolean')return 'douyin-'+key+'-boolean';
  }
 }
 return null;
}
// Customer settings can contain SnowLuma local connection details and
// personally supplied channel credentials. Reject executable/filesystem fields,
// non-local network destinations, cyclic/oversized structures and magic keys.
// This deliberately does not authorize arbitrary DSH core or plugin RPCs.
function validateChannelConfig(value){
 let nodes=0;
 function visit(v,depth=0){
  if(++nodes>700||depth>10)return 'channel-complexity';
  if(Array.isArray(v)){
   if(v.length>150)return 'channel-array-size';
   for(const item of v){const e=visit(item,depth+1);if(e)return e;}return null;
  }
  if(v!==null&&typeof v==='object'){
   const entries=Object.entries(v);if(entries.length>70)return 'channel-object-size';
   for(const [k,x] of entries){
    if(k.length>90||BAD_KEYS.test(k)&&k!=='profile')return 'channel-sensitive-key';
    if(NETWORK_KEYS.test(k)&&x!==null&&x!==''){
     if(typeof x!=='string'||x.length>500)return 'channel-network-type';
     // Network settings for the QQ bridge only target the local SnowLuma.
     // host fields may be a simple loopback hostname instead of a URL.
     if(!['localhost','127.0.0.1','::1'].includes(x)){
      let url;try{url=new URL(x);}catch{return 'channel-network-url';}
      if(!['http:','https:','ws:','wss:'].includes(url.protocol)||
          !['localhost','127.0.0.1','[::1]'].includes(url.hostname)||
          url.username||url.password||url.search||url.hash)return 'channel-network-address';
     }
    }
    if(CREDENTIAL_KEYS.test(k)&&x!==null){
      if(typeof x!=='string'||x.length>4096||/[\r\n\x00]/.test(x))return 'channel-credential-format';
    }
    const e=visit(x,depth+1);if(e)return e;
   }return null;
  }
  if(typeof v==='string'&&v.length>8000)return 'channel-string-size';
  if(typeof v==='number'&&!Number.isFinite(v))return 'channel-number';
  if(typeof v==='undefined'||typeof v==='function')return 'channel-value-type';
  return null;
 }
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length===0)return 'channel-empty';
 return visit(value);
}
// Sticker writes are restricted to a filename already present in a known
// native workspace (verified upstream). Never allow arbitrary file operation
// paths, traversal, URI or command fields through the owner-cookie adapter.
function validateStickerAction(endpoint,value){
 const allowed=endpoint==='/stickers/tags'?['file','workspacePath','tags','hash']:
   endpoint==='/stickers/rename'?['file','workspacePath','name']:['file','workspacePath'];
 if(!Object.keys(value).every(k=>allowed.includes(k)))return 'sticker-action-fields';
 if(!safeWorkspace(value.workspacePath)||!safeStickerFile(value.file))return 'sticker-action-target';
 if(endpoint==='/stickers/tags'){
  if(typeof value.tags!=='string'||value.tags.length>500||/[\x00-\x1f]/.test(value.tags))return 'sticker-tags';
  if(Object.hasOwn(value,'hash')&&(!/^[a-f0-9]{40}$/i.test(value.hash)))return 'sticker-hash';
 }
 if(endpoint==='/stickers/rename'&&(typeof value.name!=='string'||!value.name.trim()||
   value.name.length>100||/[\\/:*?"<>|\x00-\x1f]/.test(value.name)||value.name.includes('..')))return 'sticker-name';
 return null;
}
// Identity changes are resolved against native pending candidate registry.
function validDouyinCandidateName(name){
 return typeof name==='string'&&name.trim()===name&&name.length>=1&&
   name.length<=80&&!/[\x00-\x1f\x7f\\\/]/.test(name)&&
   !/^(?:file|https?|javascript|data):/i.test(name);
}
function validateStickerBackfill(value){
 const allowed=['workspacePath','limit'];
 if(Object.keys(value).some(key=>!allowed.includes(key)))return 'sticker-backfill-fields';
 if(Object.hasOwn(value,'workspacePath')&&value.workspacePath!==''&&!safeWorkspace(value.workspacePath))
  return 'sticker-backfill-workspace';
 if(Object.hasOwn(value,'limit')&&(!Number.isSafeInteger(value.limit)||value.limit<1||value.limit>100))
  return 'sticker-backfill-limit';
 return null;
}
function validateBiliLogin(endpoint,value){
 if(value===null||typeof value!=='object'||Array.isArray(value))return 'bili-login-object';
 const serialized=JSON.stringify(value);
 if(serialized.length>12000||Object.keys(value).length>20)return 'bili-login-size';
 if(endpoint==='/bili/logout')return Object.keys(value).length===0?null:'bili-logout-fields';
 if(endpoint==='/bili/qr/start'||endpoint==='/bili/qr/poll'){
  const allowed=new Set(['id','key','qrcode_key','qrcodeKey','target','allowSameAsOwner','account','kind']);
  for(const [k,v] of Object.entries(value)){
   if(!allowed.has(k))return 'bili-qr-fields';
   if(k==='allowSameAsOwner'){if(typeof v!=='boolean')return 'bili-qr-bool';continue;}
   if(typeof v!=='string'||v.length>256||![...v].every(c=>/[a-zA-Z0-9_\-:.]/.test(c)))return 'bili-qr-format';
  }
  return null;
 }
 // User-initiated manual Cookie entry is restricted to simple credential
 // fields. Never forward an arbitrary URL or filesystem path in this route.
 const allowed=new Set(['cookie','cookies','SESSDATA','bili_jct','DedeUserID','DedeUserID__ckMd5','csrf','accessToken']);
 if(Object.keys(value).length===0)return 'bili-cookie-empty';
 for(const [k,v] of Object.entries(value)){
  if(!allowed.has(k)||typeof v!=='string'||v.length>4096||/[\r\n\x00]/.test(v))return 'bili-cookie-fields';
 }
 return null;
}
const objectOnly=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function exactKeys(value,names){return objectOnly(value)&&Object.keys(value).length===names.length&&names.every(x=>Object.hasOwn(value,x));}
export function validateBody(endpoint,value,hasBody,options={}){
 if(!hasBody)value={};
 if(!objectOnly(value))return {ok:false,reason:'body-must-be-object'};
 const empty=Object.keys(value).length===0;
 switch(endpoint){
  case '/channels/douyin-config': {
   if(!hasBody)return {ok:false,reason:'empty-douyin-config'};
   const error=validateDouyinConfig(value,{allowCustomBrowser:false});
   return error?{ok:false,reason:error}:{ok:true,value};
  }
  case '/channels/qq-config':
  case '/channels/bili-config': {
   const error=validateChannelConfig(value);
   return error?{ok:false,reason:error}:{ok:true,value};
  }
  case '/bili/qr/start':
  case '/bili/qr/poll':
  case '/bili/cookie':
  case '/bili/logout': {
   const error=validateBiliLogin(endpoint,value);
   return error?{ok:false,reason:error}:{ok:true,value};
  }
  case '/stickers/backfill': {
   const error=validateStickerBackfill(value);
   return error?{ok:false,reason:error}:{ok:true,value};
  }
  case '/douyin/uin-candidates':
   return empty?{ok:true,value:{}}:{ok:false,reason:'douyin-uin-candidates-fields'};
  case '/douyin/uin-confirm':
  case '/douyin/uin-dismiss':
   return exactKeys(value,['name'])&&validDouyinCandidateName(value.name)
    ?{ok:true,value}:{ok:false,reason:'douyin-uin-candidate-name'};
  case '/inspector/dream':
   return exactKeys(value,['ownerId'])&&typeof value.ownerId==='string'&&
     value.ownerId.length<=150&&/^(?:user:)?[\w:@.-]{1,145}$/.test(value.ownerId)
    ?{ok:true,value}:{ok:false,reason:'inspector-dream-owner'};
  case '/stickers/tags':
  case '/stickers/rename':
  case '/stickers/delete': {
   const error=validateStickerAction(endpoint,value);
   return error?{ok:false,reason:error}:{ok:true,value};
  }
  case '/voice/config': {
   if(!hasBody)return {ok:false,reason:'voice-empty'};
   const error=validateVoiceConfig(value);
   return error?{ok:false,reason:error}:{ok:true,value};
  }
  case '/models/config': {
   if(!hasBody||Object.keys(value).length===0)return {ok:false,reason:'empty-model-config'};
   const error=validateModelSettings(value);
   return error?{ok:false,reason:error}:{ok:true,value};
  }
  case '/update/check':
  case '/douyin/browser/start':
  case '/douyin/browser/close':
  case '/douyin/self-check':
  case '/douyin/inbox-dismiss-all':
  case '/diag-log/clear':
  case '/persona/undo':
   return empty?{ok:true,value:{}}:{ok:false,reason:'extra-fields'};
  case '/update/config':
   return exactKeys(value,['autoCheck'])&&typeof value.autoCheck==='boolean'?{ok:true,value}:{ok:false,reason:'update-fields'};
  case '/voice/test':
   return exactKeys(value,['text'])&&typeof value.text==='string'&&value.text.trim().length>=1&&value.text.length<=250?{ok:true,value}:{ok:false,reason:'tts-text'};
  case '/douyin/screenshot':
   return (empty||(exactKeys(value,['checkLogin'])&&typeof value.checkLogin==='boolean'))
     ?{ok:true,value}:{ok:false,reason:'screenshot-check-login'};
  case '/douyin/inbox-gap-ack':
   return (empty||(exactKeys(value,['id'])&&Number.isSafeInteger(value.id)&&value.id>0))
     ?{ok:true,value}:{ok:false,reason:'douyin-inbox-id'};
  case '/douyin/inbox-resolve':
   return exactKeys(value,['id','action'])&&Number.isSafeInteger(value.id)&&value.id>0&&['retry','dismiss'].includes(value.action)
     ?{ok:true,value}:{ok:false,reason:'douyin-inbox-action'};
  case '/douyin/post-resolve':
   return exactKeys(value,['jobId','outcome'])&&Number.isSafeInteger(value.jobId)&&value.jobId>0
       &&['published','not_published'].includes(value.outcome)
     ?{ok:true,value}:{ok:false,reason:'douyin-post-resolution'};
  case '/inspector/person/delete':
   return exactKeys(value,['ownerId'])&&typeof value.ownerId==='string'&&value.ownerId.length<=150&&/^(?:user:)?[\w:@.-]{1,145}$/.test(value.ownerId)
     ?{ok:true,value}:{ok:false,reason:'person-owner-id'};
  case '/sessions/reply-target':
   return exactKeys(value,['replyTarget'])&&['source','qq'].includes(value.replyTarget)
     ?{ok:true,value}:{ok:false,reason:'reply-target'};
  case '/douyin/click':
   return exactKeys(value,['x','y'])&&['x','y'].every(x=>typeof value[x]==='number'&&Number.isFinite(value[x])&&value[x]>=0&&value[x]<=1)?{ok:true,value}:{ok:false,reason:'coordinates'};
  default: {
   // Empty JSON is a valid trigger for many one-shot business actions.
   // Let the native plugin decide whether this route needs an identifier.
   const error=scanValue(value);
   return error?{ok:false,reason:error}:{ok:true,value};
  }
 }
}

// Fixed time-window limiter; per gateway session (one user / one VM in this PoC).
const WINDOWS=new Map();
export function consumeQuota(method,endpoint,now=Date.now()){
 const category=method==='GET'?'read':
  ['/stickers/backfill','/inspector/dream'].includes(endpoint)?'expensive':
  endpoint==='/voice/test'?'tts':
  endpoint==='/update/check'?'update':
  endpoint==='/douyin/screenshot'?'screenshots':
  endpoint==='/douyin/browser/start'?'browser-start':
  endpoint==='/bili/qr/start'?'qr-start':
  endpoint==='/bili/qr/poll'?'qr-poll':'write';
 const limits={read:[300,60_000],expensive:[3,3600_000],tts:[8,60_000],update:[12,3600_000],screenshots:[90,60_000],'browser-start':[4,60_000],'qr-start':[8,60_000],'qr-poll':[120,60_000],write:[60,60_000]};
 const [max,span]=limits[category],rec=WINDOWS.get(category);
 if(!rec||now-rec.at>=span){WINDOWS.set(category,{at:now,count:1});return {ok:true};}
 if(rec.count>=max)return {ok:false,reason:'rate-limit',retrySeconds:Math.ceil((span-(now-rec.at))/1000)};
 rec.count++;return {ok:true};
}
