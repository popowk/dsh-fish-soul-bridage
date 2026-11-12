document.getElementById('form').addEventListener('submit',async e=>{
 e.preventDefault();
 const button=document.querySelector('button'),message=document.getElementById('message');
 button.disabled=true;message.textContent='';
 try{
  const r=await fetch(new URL('__bridge/unlock',document.baseURI),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})});
  if(r.ok){location.replace(new URL('./',document.baseURI).href);return;}
  // Distinguish real bad credentials from VMO proxy/Origin failures.
  const msg={
    401:'访问码不正确。请核对管理端最新上报时间及本次 CODE。',
    403:'代理来源未获网关允许（HTTP 403）。请检查 VMO 的 Origin/Host 转发配置。',
    404:'登录接口未被管理平台正确转发（HTTP 404）。请检查 VMO 应用代理路径。',
    405:'登录请求方法未被代理支持（HTTP 405）。',
    415:'登录请求格式错误（HTTP 415）。',
    429:'连续尝试过多，网关临时锁定 120 秒；请稍后再试。',
    502:'管理端无法连接网关（HTTP 502）。',
    503:'网关尚未就绪（HTTP 503）。'
  };
  message.textContent=msg[r.status]||'登录失败（HTTP '+r.status+'）。请查看网络请求状态。';
 }catch{message.textContent='请求未能到达登录接口：请检查浏览器代理路径和网络状态。';}
 finally{button.disabled=false;}
});
