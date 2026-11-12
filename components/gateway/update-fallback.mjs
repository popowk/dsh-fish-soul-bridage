// Read-only fallback for the plugin's update checker. Never installs anything.
// Fixed HTTPS destinations only; no request body, DSH cookies or user secrets.
const URLS=Object.freeze([
 {source:'npm',url:'https://registry.npmjs.org/dsh-fish-soul/latest'},
 {source:'github',url:'https://api.github.com/repos/Britneycode/dsh-fish-soul/releases/latest'},
 {source:'npm-mirror',url:'https://registry.npmmirror.com/dsh-fish-soul/latest'}
]);
const VERSION=/^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-[0-9A-Za-z.-]{1,80})?$/;
function nums(v){const m=VERSION.exec(String(v||''));return m&&m.slice(1,4).map(Number);}
export function newer(latest,current){const a=nums(latest),b=nums(current);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
export async function checkFallback({current,fetchImpl=fetch,timeoutMs=4500,urls=URLS}={}){
 const failures=[];
 for(const item of urls){
  try{
   const r=await fetchImpl(item.url,{method:'GET',headers:{accept:'application/json','user-agent':'fish-soul-standalone-check/6.8'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
   if(!r.ok)throw Error('HTTP '+r.status);
   const ctype=(r.headers.get('content-type')||'').toLowerCase();if(!ctype.includes('json'))throw Error('not-json');
   const raw=await r.text();if(raw.length>500000)throw Error('too-large');
   const obj=JSON.parse(raw);
   const latest=String(item.source==='github'?obj.tag_name:obj.version||'').replace(/^v/,'');
   if(!VERSION.test(latest))throw Error('version-unavailable');
   return {ok:true,current,latest,hasUpdate:newer(latest,current),checking:false,checkedAt:Date.now(),source:'standalone-'+item.source,notes:'',notesUrl:'https://github.com/Britneycode/dsh-fish-soul/releases',publishedAt:null,error:'',autoCheck:true,command:newer(latest,current)?`dsh plugin --profile desktop add dsh-fish-soul@${latest}`:'',fallback:true};
  }catch(e){failures.push({source:item.source,category:e?.name==='TimeoutError'?'timeout':String(e?.message||'').startsWith('HTTP ')?'http':'network-or-format'});}
 }
 return {ok:false,current,latest:null,checking:false,source:'standalone-fallback',fallback:true,error:'备用检查也无法访问 npm/GitHub；请检查 Windows 网络或代理',failures};
}
