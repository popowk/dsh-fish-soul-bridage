import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getManifest} from '../native-paths.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
test('authenticated VMO QQ save and Bilibili QR issue/poll round-trip through the isolated gateway', {timeout:30000},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'dsh-social-gateway-'));
 let child,server;
 try{
  const upPort=await port(),gatewayPort=await port();
  const lib=join(temp,'pkg','lib');await mkdir(lib,{recursive:true});
  await writeFile(join(temp,'pkg','package.json'),JSON.stringify({name:'dsh-fish-soul',version:'0.15.31'}));
  await writeFile(join(lib,'client.js'),'/* mock public client */\n'+'a'.repeat(1500));
  const m=await getManifest(lib),approval=join(temp,'approval.json');
  await writeFile(approval,JSON.stringify({schema:2,source:'npm-integrity-verified',version:m.version,hash:m.hash,files:m.files,integrity:'sha512-'+Buffer.alloc(64).toString('base64'),verifiedAt:new Date().toISOString()}));
  const seen=[];
  server=http.createServer(async(req,res)=>{
   if(req.url==='/?token=SYNTHETIC-DSH-OWNER'){
    res.writeHead(302,{location:'/', 'set-cookie':'test_owner_cookie=valid; Path=/; HttpOnly'});res.end();return;
   }
   if(req.url==='/'&&req.headers.cookie?.includes('test_owner_cookie=valid')){
    res.writeHead(200,{'content-type':'text/html'});res.end('<html>DSH</html>');return;
   }
   if(req.url.startsWith('/api/plugins/fish-soul/')&&req.method==='POST'){
    let body='';for await(const c of req)body+=c;
    seen.push({path:req.url,body:body?JSON.parse(body):{},origin:req.headers.origin,cookie:req.headers.cookie});
    let result={ok:true};
    if(req.url.endsWith('/bili/qr/start'))result={ok:true,id:'EXAMPLE-QR-1',image:'data:image/png;base64,YQ=='};
    if(req.url.endsWith('/bili/qr/poll'))result={ok:true,state:'scanned'};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
   }
   res.writeHead(404,{'content-type':'application/json'});res.end('{"ok":false}');
  });
  await new Promise((ok,no)=>{server.once('error',no);server.listen(upPort,'127.0.0.1',ok);});
  child=spawn(process.execPath,[join(root,'server.mjs')],{
    cwd:root,env:{...process.env,FS_GATEWAY_PORT:String(gatewayPort),FS_LAN_BIND_IP:'',
      FS_ACCESS_CODE:'SYNTHETIC-CODE-LOCAL',FS_AUTO_AUTH_ONLY:'1',FS_CUSTOMER_SOCIAL_CONFIG:'1',FS_CUSTOMER_BILI_AUTH:'1',
      FS_VMO_PROXY_ORIGINS:'https://host.tmd.pet',FS_PLUGIN_DIR:lib,FS_APPROVAL_FILE:approval,
      DSH_WEB_URL:`http://127.0.0.1:${upPort}/?token=SYNTHETIC-DSH-OWNER`,
      VMO_REPORT_TRANSPORT:'python',VMO_PYTHON:'/no/python',VMO_REPORT_SCRIPT:'/no/reporter'},stdio:'ignore'});
  const base=`http://127.0.0.1:${gatewayPort}`;
  let ready=false;
  for(let i=0;i<70;i++){
   try{const r=await fetch(base+'/__bridge/health',{signal:AbortSignal.timeout(300)});const j=await r.json();if(j.upstreamReady&&j.pluginLocated){ready=true;break;}}
   catch{}
   if(child.exitCode!==null)break;
   await sleep(100);
  }
  assert.ok(ready,'gateway is listening, DSH cookie verified and plugin approved');
  const login=await fetch(base+'/__bridge/unlock',{method:'POST',headers:{'content-type':'application/json',origin:'https://host.tmd.pet'},body:JSON.stringify({code:'SYNTHETIC-CODE-LOCAL'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const send=async (path,body,origin='https://host.tmd.pet')=>fetch(base+'/api/plugins/fish-soul'+path,{
   method:'POST',headers:{'content-type':'application/json',cookie,origin,'sec-fetch-site':'same-origin'},body:JSON.stringify(body)});
  const qq=await send('/channels/qq-config',{enabled:true,wsUrl:'ws://127.0.0.1:3001',accessToken:'DUMMY-QQ-ACCESS-TOKEN'});
  assert.equal(qq.status,200,await qq.text());
  const config=await send('/channels/bili-config',{enabled:true,browse:{enabled:false}});
  assert.equal(config.status,200,await config.text());
  const qr=await send('/bili/qr/start',{});
  assert.equal(qr.status,200,await qr.text());
  const poll=await send('/bili/qr/poll',{id:'EXAMPLE-QR-1'});
  assert.equal(poll.status,200,await poll.text());
  assert.equal(seen.length,4);
  assert.ok(seen.every(x=>x.cookie==='test_owner_cookie=valid'&&x.origin===`http://127.0.0.1:${upPort}`));
  assert.equal(seen[2].path,'/api/plugins/fish-soul/bili/qr/start');
  const malicious=await send('/channels/qq-config',{url:'http://169.254.169.254/latest'});
  assert.equal(malicious.status,400);
  const oneShot=await send('/bili/post-now',{});assert.equal(oneShot.status,200);
  const unsafe=await send('/web/test',{url:'http://localhost:18767/'});assert.equal(unsafe.status,403);
  const csrf=await send('/bili/qr/start',{},'https://evil.example');assert.equal(csrf.status,403);
  assert.equal(seen.length,5,'business action forwarded, rejected requests stopped before DSH');
  const logRes=await fetch(base+'/__bridge/report',{headers:{cookie}});assert.equal(logRes.status,200);
  const logText=await logRes.text();
  assert.equal(logText.includes('DUMMY-QQ-ACCESS-TOKEN'),false);
  assert.equal(logText.includes('SYNTHETIC-DSH-OWNER'),false);
  assert.equal(logText.includes('SYNTHETIC-CODE-LOCAL'),false);
  assert.ok(logText.includes('/bili/qr/start'));
 }finally{
  if(child){child.kill();await sleep(100);}
  if(server)await new Promise(r=>server.close(r));
  await rm(temp,{recursive:true,force:true});
 }
});
