// Read-only, deliberately lossy cross-profile diagnostics. Never export
// credentials, plaintext provider endpoints, speech text or session tokens.
const asString=x=>typeof x==='string'?x:'';
function takeVersion(v){
 const c=[v?.currentVersion,v?.installedVersion,v?.version,v?.current,v?.localVersion,v?.pluginVersion,v?.update?.currentVersion,v?.update?.current];
 for(const item of c){if(typeof item==='string'&&/^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(item))return item;}
 return null;
}
export function summarizeVoice(v){
 if(!v||typeof v!=='object')return {available:false};
 const t=v.tts&&typeof v.tts==='object'?v.tts:{};
 const st=v.stt&&typeof v.stt==='object'?v.stt:{};
 const ttsKey=typeof t.hasKey==='boolean'?t.hasKey:(typeof v.ttsHasKey==='boolean'?v.ttsHasKey:null);
 const sttKey=typeof st.hasKey==='boolean'?st.hasKey:(typeof v.sttHasKey==='boolean'?v.sttHasKey:null);
 const error=asString(v.lastError);
 const errorCategory=/HTTP\s*502/i.test(error)?'http-502':/timed?\s*out|超时|timeout/i.test(error)?'timeout':/HTTP\s*401|HTTP\s*403/i.test(error)?'authorization':error?'other':'none';
 return {
  available:true,enabled:v.enabled===true,
  tts:{hasKey:ttsKey,keyFrom:['own','shared','embedding','none'].includes(t.keyFrom)?t.keyFrom:'unknown',model:asString(v.ttsModel).slice(0,100),voiceConfigured:!!asString(v.ttsVoice),baseConfigured:!!asString(t.effectiveBaseURL||t.baseURL),quotaRemaining:Number.isFinite(v.ttsLeft)?v.ttsLeft:null},
  stt:{hasKey:sttKey},
  lastErrorCategory:errorCategory
 };
}
export function summarizeUpdate(v){
 if(!v||typeof v!=='object')return {available:false};
 return {available:true,installedVersion:takeVersion(v),checkOk:v.ok!==false,hasError:!!v.error,source:['npm','github','cache'].includes(v.source)?v.source:null};
}
export function compareLocalUpstream(local,upstream){
 const localVersion=local?.installed&&local.version!=='unknown'?String(local.version):null;
 const upstreamVersion=upstream?.installedVersion||null;
 return {localPluginVersion:localVersion,upstreamReportedVersion:upstreamVersion,
  versionCompared:!!(localVersion&&upstreamVersion),
  versionsMatch:localVersion&&upstreamVersion?localVersion===upstreamVersion:null,
  attention:localVersion&&upstreamVersion&&localVersion!==upstreamVersion?'可能连接到了不同的 DSH Profile/Host；本地原生 JS 与 API 版本不一致':'版本无法从上游接口确认时，不代表已经验证为同一 Profile'};
}
export function summarizeVoiceTestBody(b){
 if(!b||typeof b!=='object'||Array.isArray(b))return {bodyKind:'non-object'};
 return {bodyKind:'object',fields:Object.keys(b).sort().slice(0,20).filter(x=>/^[a-z][a-z0-9_]{0,40}$/i.test(x)),textLength:typeof b.text==='string'?[...b.text].length:null};
}
