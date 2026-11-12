// React 18.3.1 UMD is downloaded ONCE into vendor/ on the Windows host.
// No CDN is ever contacted by the customer-facing browser.
// The version is pinned to prevent silently taking an unreviewed major update.
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),vendor=join(here,'vendor');
const entries=[
 {file:'react.js',basename:'react',min:6000,max:30000,markers:['useState','useEffect','createElement']},
 {file:'react-dom.js',basename:'react-dom',min:50000,max:200000,markers:['createRoot']}
];
const sources=(basename)=>[
 `https://cdnjs.cloudflare.com/ajax/libs/${basename}/18.3.1/umd/${basename}.production.min.js`,
 `https://cdn.jsdelivr.net/npm/${basename}@18.3.1/umd/${basename}.production.min.js`,
 `https://unpkg.com/${basename}@18.3.1/umd/${basename}.production.min.js`
];
async function verify(bytes,e){
 const s=bytes.toString('utf8');
 if(bytes.length<e.min||bytes.length>e.max||!e.markers.every(marker=>s.includes(marker)))throw Error(`${e.file} unexpected content`);
 return createHash('sha256').update(bytes).digest('hex');
}
await mkdir(vendor,{recursive:true});
for(const e of entries){
 const dst=join(vendor,e.file);
 try{const b=await readFile(dst);const sha=await verify(b,e);console.log(`[OK] ${e.file} exists SHA256 ${sha.slice(0,16)}`);continue;}catch{}
 let last;
 for(const src of sources(e.basename)){
  try{
   console.log(`[下载] ${e.file} <- ${new URL(src).hostname} (React 18.3.1)`);
   const r=await fetch(src,{signal:AbortSignal.timeout(18000),redirect:'follow'});
   if(!r.ok)throw Error('HTTP '+r.status);
   if(new URL(r.url).protocol!=='https:')throw Error('redirect to non-HTTPS');
   const bytes=Buffer.from(await r.arrayBuffer());const hash=await verify(bytes,e);
   const tmp=dst+'.tmp';await writeFile(tmp,bytes);await rename(tmp,dst);
   console.log(`[OK] ${e.file} SHA256=${hash}`);last=null;break;
  }catch(err){last=err;console.warn('  下载源不可用:',String(err.message||err));}
 }
 if(last)throw Error('无法准备 '+e.file+'。请检查 Windows 代理/网络，或把 React 18.3.1 对应 UMD 资源放入 vendor 文件夹：'+last.message);
}
console.log('React 运行环境准备完成。下载资源只提供本机静态服务，不在客户页面联网加载。');
