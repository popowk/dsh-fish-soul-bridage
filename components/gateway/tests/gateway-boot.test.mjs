import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function availablePort(){
 return await new Promise((resolve,reject)=>{
  const s=net.createServer();s.once('error',reject);
  s.listen({port:0,host:'127.0.0.1'},()=>{const p=s.address().port;s.close(()=>resolve(p));});
 });
}
test('56781 style gateway login listens BEFORE a DSH auth handoff exists',async()=>{
  const port=await availablePort();
  const code='TEST-ONLY-AUTH-CODE';
  const child=spawn(process.execPath,[join(dir,'..','server.mjs')],{
    cwd:join(dir,'..'),
    env:{...process.env,FS_GATEWAY_PORT:String(port),FS_AUTO_AUTH_ONLY:'1',FS_LAN_BIND_IP:'',FS_ACCESS_CODE:code,
      FS_VMO_PROXY_ORIGINS:'http://192.168.2.99:8766,https://192.168.2.99:8766',
      VMO_REPORT_TRANSPORT:'python',VMO_PYTHON:'/missing/python',VMO_REPORT_SCRIPT:'/missing/Report-App-JSON.py',
      FS_PLUGIN_DIR:'/nonexistent/fish-soul'},
    stdio:'ignore',windowsHide:true,
  });
  try{
    let ready=false;
    for(let i=0;i<35;i++){
      if(child.exitCode!==null)break;
      try{const r=await fetch(`http://127.0.0.1:${port}/__bridge/health`,{signal:AbortSignal.timeout(500)});
        if(r.status===200){const data=await r.json();
          assert.equal(data.upstreamReady,false);
          ready=true;break;}
      }catch{}
      await wait(120);
    }
    assert.equal(ready,true,'gateway must bind without waiting 90 s for DSH handoff');
    const login=await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(login.status,200);
    assert.match(await login.text(),/html/i);
    const wrong=await fetch(`http://127.0.0.1:${port}/__bridge/unlock`,{
      method:'POST',headers:{'content-type':'application/json',origin:`http://127.0.0.1:${port}`},body:JSON.stringify({code:'OLD-CODE'})});
    assert.equal(wrong.status,401);
    const valid=await fetch(`http://127.0.0.1:${port}/__bridge/unlock`,{
      method:'POST',headers:{'content-type':'application/json',origin:`http://127.0.0.1:${port}`},body:JSON.stringify({code})});
    assert.equal(valid.status,200);
    const proxied=await fetch(`http://127.0.0.1:${port}/__bridge/unlock`,{
      method:'POST',headers:{'content-type':'application/json',origin:'http://192.168.2.99:8766'},body:JSON.stringify({code})});
    assert.equal(proxied.status,200,'VMO app relay should be allowed with exact management origin');
    const malicious=await fetch(`http://127.0.0.1:${port}/__bridge/unlock`,{
      method:'POST',headers:{'content-type':'application/json',origin:'https://malicious.example'},body:JSON.stringify({code})});
    assert.equal(malicious.status,403,'Unknown origins remain blocked');
    const badCode=await fetch(`http://127.0.0.1:${port}/__bridge/unlock`,{
      method:'POST',headers:{'content-type':'application/json',origin:'https://192.168.2.99:8766'},body:JSON.stringify({code:'OUTDATED-CLIENT-CODE'})});
    assert.equal(badCode.status,401,'Known proxy origin with stale credential is a real 401');
  }finally{child.kill();}
});
