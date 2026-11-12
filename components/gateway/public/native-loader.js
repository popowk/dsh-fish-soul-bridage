/* Minimal fish-soul-only Cordis-style client loader. No DSH management UI,
   no /api/remote.mux and no owner cookie in browser storage. */
(()=>{
 'use strict';
 const MODULE='dsh-fish-soul';
 const chunks=Object.create(null), pending=Object.create(null), factories=Object.create(null);
 const allowedChunks=new Set(['client.soul.js','client.models.js','client.persona.js','client.douyin.js','client.behavior.js']);
 let discovery=null;
 async function loadNativeManifest(){
  discovery??=fetch(new URL('__bridge/version',document.baseURI),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('native manifest unavailable');return r.json();}).then(v=>{
   for(const file of v.files||[]){if(/^client\.[a-z0-9][a-z0-9_-]{0,63}\.js$/.test(file))allowedChunks.add(file);}
  }).catch(()=>{});
  await discovery;
 }
 const root=document.getElementById('root');
 const diag=(phase,error)=>{
  const p=document.createElement('section');p.className='native-error';
  const h=document.createElement('h2');h.textContent='原版组件尚未成功挂载';p.appendChild(h);
  const text=document.createElement('p');text.textContent=phase+'：'+String(error?.message||error).slice(0,450);p.appendChild(text);
  const link=document.createElement('a');link.href=new URL('__bridge/diagnose',document.baseURI).href;link.textContent='查看本机诊断报告';p.appendChild(link);
  root.replaceChildren(p);
  fetch(new URL('__bridge/client-error',document.baseURI),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phase,error:String(error?.message||error).slice(0,250)})}).catch(()=>{});
 };
 const session={react:null,ReactDOM:null};
 function requireDep(name){
  if(name==='react')return session.react;
  if(name==='@deepseek-ai/dsh-client-ui-primitives')throw new Error('DSH-specific primitives are not injected in the standalone shell; fish-soul must use its internal fallback');
  throw new Error('Unsupported plugin dependency: '+name);
 }
 requireDep.async=async spec=>{
  const name=String(spec).replace(/^\.\//,'');
  await loadNativeManifest();
  if(!allowedChunks.has(name))throw new Error('Unapproved chunk: '+name);
  if(chunks[name])return chunks[name];
  if(pending[name])return pending[name];
  pending[name]=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=new URL('__native/'+name,document.baseURI).href;
   script.onload=()=>{
    try{
     const factory=factories[name];if(typeof factory!=='function')throw new Error('Chunk not registered: '+name);
     chunks[name]=factory(requireDep);resolve(chunks[name]);
    }catch(e){delete pending[name];reject(e);}finally{script.remove()}
   };
   script.onerror=()=>{delete pending[name];reject(new Error('Cannot load plugin chunk: '+name));};
   document.head.append(script);
  });
  return pending[name];
 };
 function runEffect(x){
  if(x&&typeof x.next==='function'){
   let step=x.next(),count=0;while(!step.done&&count++<20)step=x.next();
  }
 }
 let page=null,started=false;
 const slots={
  register(meta,comp){
   if(meta?.name==='main'&&meta.key===MODULE&&typeof comp==='function')page=comp;
   return ()=>{};
  },
  inject(_slot,handler){
   try{runEffect(handler());}catch(e){throw new Error('slot registration: '+e.message);}
   return ()=>{};
  }
 };
 const ctx={slots,effect:fn=>{const result=fn();runEffect(result);return ()=>{};},get:()=>null};
 function mount(){
  if(started)return;
  try{
   session.react=window.React;session.ReactDOM=window.ReactDOM;
   if(!session.react?.useState||!session.ReactDOM?.createRoot)throw new Error('React 18 UMD is missing; run 准备React运行环境.cmd');
   if(typeof factories.main!=='function')throw new Error('Installed fish-soul client.js did not register its module');
   const plugin=factories.main(requireDep);
   if(typeof plugin?.apply!=='function')throw new Error('fish-soul module does not export apply');
   plugin.apply(ctx);
   if(!page)throw new Error('fish-soul did not register main slot; check plugin version');
   started=true;
   const errorBoundary=class extends session.react.Component{
    constructor(props){super(props);this.state={error:null};}
    static getDerivedStateFromError(error){return {error};}
    render(){if(this.state.error)return session.react.createElement('div',{className:'native-error'},'React 页面错误：'+String(this.state.error?.message||this.state.error));return this.props.children;}
   };
   session.ReactDOM.createRoot(root).render(session.react.createElement(errorBoundary,null,session.react.createElement(page)));
   document.documentElement.dataset.nativeMounted='1';
  }catch(e){diag('启动阶段',e);}
 }
 window.__ModuleLoader__={
  load(info){
   if(info?.id!==MODULE||typeof info.factory!=='function')return;
   if(info.chunk){if(/^client\.[a-z0-9][a-z0-9_-]{0,63}\.js$/.test(info.chunk))factories[info.chunk]=info.factory;return;}
   factories.main=info.factory;
   if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  }
 };
 window.addEventListener('error',event=>{
  if(!started)diag('脚本加载阶段',event.message||event.error||'unknown');
 });
 const notice=document.getElementById('notice');
 fetch(new URL('__bridge/version',document.baseURI)).then(r=>r.json()).then(v=>{
  document.getElementById('version').textContent=(v.version||'')+' · 原生资源';
  const known=v.hash;
  if(v.mode==='fallback'){
   notice.hidden=false;
   notice.textContent='已安装 '+(v.installedVersion||'新版')+'，当前临时使用上一次校验通过的 '+(v.version||'旧版')+' 界面。新版本验证通过后可刷新；为避免参数不兼容，旧版回退时暂不允许修改设置。';
  }
  setInterval(async()=>{
   try{
    const r=await fetch(new URL('__bridge/version',document.baseURI),{cache:'no-store'}),a=await r.json();
    if((a.latestVerifiedHash||a.hash)&&(a.latestVerifiedHash||a.hash)!==known){notice.hidden=false;notice.replaceChildren();notice.append('检测到 fish-soul 更新。保存当前编辑后刷新，即可加载原版新页面。 ');const b=document.createElement('button');b.textContent='刷新';b.onclick=()=>location.reload();notice.append(b);}
   }catch{}
  },20000);
 }).catch(()=>{});
})();
