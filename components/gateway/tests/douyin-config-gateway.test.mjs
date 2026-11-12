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
test('authenticated HTTPS VMO origin can save Douyin settings all the way to a mock DSH plugin; unsafe routes remain blocked', {timeout:30000},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'dsh-bridge-926-'));
 let child,upserver;
 try{
  const upPort=await port(),gatewayPort=await port();
  const lib=join(temp,'pkg','lib');await mkdir(lib,{recursive:true});
  await writeFile(join(temp,'pkg','package.json'),JSON.stringify({name:'dsh-fish-soul',version:'0.15.31'}));
  await writeFile(join(lib,'client.js'),'/* mock public client */\n'+'a'.repeat(1500));
  const m=await getManifest(lib);
  const approval=join(temp,'approval.json');
  await writeFile(approval,JSON.stringify({schema:2,source:'npm-integrity-verified',version:m.version,hash:m.hash,files:m.files,integrity:'sha512-'+Buffer.alloc(64).toString('base64'),verifiedAt:new Date().toISOString()}));
  const seen=[];
  upserver=http.createServer(async(req,res)=>{
   if(req.url==='/?token=TEST-OWNER-TOKEN'){
    res.writeHead(302,{'location':'/','set-cookie':'owner_test=valid; Path=/; HttpOnly'});res.end();return;
   }
   if(req.url==='/' && req.headers.cookie?.includes('owner_test=valid')){
    res.writeHead(200,{'content-type':'text/html'});res.end('<html>DSH</html>');return;
   }
   if(req.url==='/api/plugins/fish-soul/channels/douyin-config' && req.method==='POST'){
    let body='';for await(const b of req)body+=b;
    seen.push({body:JSON.parse(body),cookie:req.headers.cookie,origin:req.headers.origin});
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));return;
   }
   res.writeHead(404,{'content-type':'application/json'});res.end('{"ok":false}');
  });
  await new Promise((ok,no)=>{upserver.once('error',no);upserver.listen(upPort,'127.0.0.1',ok);});
  child=spawn(process.execPath,[join(root,'server.mjs')],{
   cwd:root,env:{...process.env,FS_GATEWAY_PORT:String(gatewayPort),FS_LAN_BIND_IP:'',
    FS_ACCESS_CODE:'SYNTHETIC-TEST-CODE',FS_AUTO_AUTH_ONLY:'1',FS_CUSTOMER_DOUYIN_CONFIG:'1',
    FS_VMO_PROXY_ORIGINS:'https://host.tmd.pet',FS_PLUGIN_DIR:lib,FS_APPROVAL_FILE:approval,
    DSH_WEB_URL:`http://127.0.0.1:${upPort}/?token=TEST-OWNER-TOKEN`,
    VMO_REPORT_TRANSPORT:'python',VMO_PYTHON:'/no/python',VMO_REPORT_SCRIPT:'/no/reporter'},stdio:'ignore'});
  const base=`http://127.0.0.1:${gatewayPort}`;
  let ready=false;
  for(let i=0;i<80;i++){
   try{
    const r=await fetch(base+'/__bridge/health',{signal:AbortSignal.timeout(400)});const j=await r.json();
    if(j.upstreamReady && j.pluginLocated){ready=true;break;}
   }catch{}
   if(child.exitCode!==null)break;
   await sleep(100);
  }
  assert.ok(ready,'gateway must reach mock DSH and detect approved installed native plugin');
  const login=await fetch(base+'/__bridge/unlock',{
   method:'POST',headers:{'content-type':'application/json',origin:'https://host.tmd.pet'},body:JSON.stringify({code:'SYNTHETIC-TEST-CODE'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const request=async(path,body,origin='https://host.tmd.pet')=>fetch(base+path,{
   method:'POST',headers:{'content-type':'application/json',cookie,origin,'sec-fetch-site':'same-origin'},
   body:JSON.stringify(body)});
  const payload={enabled:true,autoReply:false,masterName:'苏苏',browser:{kind:'edge',customPath:''},
    browse:{enabled:false,perDay:3,videosPerSession:3,mode:'http'},post:{enabled:false,perDay:1}};
  const save=await request('/api/plugins/fish-soul/channels/douyin-config',payload);
  assert.equal(save.status,200,await save.text());
  assert.equal(seen.length,1);
  assert.deepEqual(seen[0].body,payload);
  assert.equal(seen[0].origin,`http://127.0.0.1:${upPort}`,'upstream uses DSH origin, not website origin');
  assert.equal(seen[0].cookie,'owner_test=valid','owner cookie only goes to DSH backend');
  const bad=await request('/api/plugins/fish-soul/channels/douyin-config',{browser:{customPath:'C:\\Users\\Public\\evil.exe'}});
  assert.equal(bad.status,400);
  assert.equal(seen.length,1,'bad payload was not forwarded');
  const dangerous=await request('/api/plugins/fish-soul/sessions/workspace',{});
  assert.equal(dangerous.status,403);
  const csrf=await request('/api/plugins/fish-soul/channels/douyin-config',{enabled:true},'https://malicious.example');
  assert.equal(csrf.status,403);
  const status=await fetch(base+'/__bridge/report',{headers:{cookie}});assert.equal(status.status,200);
  const log=await status.json();
  assert.equal(log.operations.some(x=>x.endpoint==='/channels/douyin-config'&&x.status===200&&x.ok),true);
  assert.equal(JSON.stringify(log).includes('TEST-OWNER-TOKEN'),false);
 }finally{
  if(child){child.kill();await sleep(100);}
  if(upserver)await new Promise(r=>upserver.close(r));
  await rm(temp,{recursive:true,force:true});
 }
});
