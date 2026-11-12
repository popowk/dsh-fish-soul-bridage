// Defensive display-only redaction; cannot discover secrets embedded in normal prose.
const SENSITIVE_FIELD=/(?:api.?key|secret|password|passphrase|access.?token|refresh.?token|authorization|auth.?cookie|credential|cookie|private.?key|session.?key|tts.?key|stt.?key|bot.?token)/i;
const SENSITIVE_URL=/(?:baseurl|base_url|api.?base|endpoint|proxyurl)/i;
const HAS_FIELD=/^(?:has|is|configured|keyFrom|quota|enabled|status)/i;
function redactText(value){
 return value
  .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi,'Bearer [redacted]')
  .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g,'[redacted-key]')
  .replace(/(?:[?&](?:token|api_key|apiKey|secret|password)=)[^\s&#]+/gi,'[redacted-query]');
}
export function scrubResponse(value,depth=0){
 if(depth>24)return null;
 if(Array.isArray(value))return value.map(x=>scrubResponse(x,depth+1));
 if(value&&typeof value==='object'){
  const out={};
  for(const [key,item] of Object.entries(value)){
   if(SENSITIVE_FIELD.test(key)&&!HAS_FIELD.test(key)){out[key]=typeof item==='boolean'?false:'';continue;}
   if(SENSITIVE_URL.test(key)){out[key]=typeof item==='boolean'?false:'';continue;}
   out[key]=scrubResponse(item,depth+1);
  }
  return out;
 }
 if(typeof value==='string')return redactText(value);
 return value;
}
