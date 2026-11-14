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
import {allowedEndpoint,validateBody,validateQuery,consumeQuota} from '../customer-policy.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
 const server=net.createServer();
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 const port=server.address().port;
 await new Promise(ok=>server.close(ok));
 return port;
}
const candidate='小青（我的抖音号）';
const ws='C:\\dsh\\.dsh\\profiles\\desktop';

test('0.16.4 exact endpoints retain old security boundaries',()=>{
 for(const path of ['/inspector/self-outdated'])assert.equal(allowedEndpoint('GET',path),true,path);
 for(const path of ['/stickers/backfill','/inspector/dream','/douyin/uin-candidates','/douyin/uin-confirm','/douyin/uin-dismiss']){
  assert.equal(allowedEndpoint('POST',path),true,path);
  assert.equal(allowedEndpoint('GET',path),false,path);
 }
 for(const path of ['/douyin/uin-candidates','/douyin/uin-confirm','/douyin/uin-dismiss']){
  assert.equal(allowedEndpoint('POST',path,{douyinConfig:false}),false,path);
 }
 for(const path of ['/update/apply','/web/test','/memory/debug','/sessions/workspace','/api/remote.mux']){
  assert.equal(allowedEndpoint('POST',path),false,path);
 }
 assert.equal(allowedEndpoint('GET','/diagnose'),false);
});

test('0.16.4 self archive pagination rejects arbitrary query injection and out-of-range values',()=>{
 assert.deepEqual(validateQuery('/inspector/self-outdated',''),{ok:true});
 assert.deepEqual(validateQuery('/inspector/self-outdated','?offset=30'),{ok:true});
 assert.deepEqual(validateQuery('/inspector/self-outdated','?offset=1000000'),{ok:true});
 for(const bad of ['?ownerId=other','?offset=-1','?offset=1000001','?offset=3.14',
   '?offset=1e3','?offset=0&offset=90','?offset=0&file=C%3A%5Csecret','?offset=abc']){
  assert.equal(validateQuery('/inspector/self-outdated',bad).ok,false,bad);
 }
});

test('0.16.4 native contract: candidate confirmation, tag backfill, dream',()=>{
 assert.deepEqual(validateBody('/douyin/uin-candidates',{},true),{ok:true,value:{}});
 assert.equal(validateBody('/douyin/uin-candidates',{cmd:'powershell'},true).ok,false);
 for(const p of ['/douyin/uin-confirm','/douyin/uin-dismiss']){
  assert.equal(validateBody(p,{name:candidate},true).ok,true,p);
  for(const bad of [{},{name:123},{name:'\u0000other'},{name:' file://x'},{name:'ok',cmd:'exec'}]){
   assert.equal(validateBody(p,bad,true).ok,false,JSON.stringify(bad));
  }
 }
 assert.equal(validateBody('/stickers/backfill',{workspacePath:ws},true).ok,true);
 assert.equal(validateBody('/stickers/backfill',{},true).ok,true);
 assert.equal(validateBody('/stickers/backfill',{workspacePath:ws,limit:40},true).ok,true);
 for(const bad of [{workspacePath:'\\\\server\\private'},{workspacePath:'C:\\dsh\\..\\secret'},
   {workspacePath:123},{limit:0},{limit:101},{url:'http://127.0.0.1/secret'},
   {workspacePath:ws,cmd:'powershell'}]){
   assert.equal(validateBody('/stickers/backfill',bad,true).ok,false,JSON.stringify(bad));
 }
 assert.equal(validateBody('/inspector/dream',{ownerId:'user:qq:12345'},true).ok,true);
 for(const bad of [{},{ownerId:'../private'},{ownerId:'a',shell:'cmd'},{ownerId:123}]){
  assert.equal(validateBody('/inspector/dream',bad,true).ok,false,JSON.stringify(bad));
 }
 // Backfill/dream are model-costly; an unauthenticated caller cannot bypass auth,
 // and the existing rate limiter additionally bounds the number of requests.
 assert.equal(consumeQuota('POST','/stickers/backfill',101).ok,true);
 assert.equal(consumeQuota('POST','/stickers/backfill',102).ok,true);
 assert.equal(consumeQuota('POST','/inspector/dream',103).ok,true);
 assert.equal(consumeQuota('POST','/stickers/backfill',104).ok,false);
});

test('0.16.4 gateway forwards only approved routes, while keeping per-client auth', {timeout:30000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fish-0164-'));
 let upstream,gateway;
 try {
  const upPort=await freePort(),gwPort=await freePort();
  const lib=join(dir,'pkg','lib');
  await mkdir(lib,{recursive:true});
  await writeFile(join(dir,'pkg','package.json'),JSON.stringify({name:'dsh-fish-soul',version:'0.16.4'}));
  await writeFile(join(lib,'client.js'),'/* synthetic 0.16.4 */\n'+'x'.repeat(1600));
  const manifest=await getManifest(lib), approval=join(dir,'approval.json');
  await writeFile(approval,JSON.stringify({schema:2,source:'npm-integrity-verified',
   version:manifest.version,hash:manifest.hash,files:manifest.files,
   integrity:'sha512-'+Buffer.alloc(64).toString('base64'),verifiedAt:new Date().toISOString()}));
  const seen=[];
  upstream=http.createServer(async(req,res)=>{
   if(req.url==='/?token=SYNTHETIC-TOKEN'){
    res.writeHead(302,{location:'/', 'set-cookie':'owner_session=ok; Path=/; HttpOnly'});res.end();return;
   }
   if(req.url==='/'&&req.headers.cookie?.includes('owner_session=ok')){
    res.writeHead(200,{'content-type':'text/html'});res.end('ok');return;
   }
   if(!req.headers.cookie?.includes('owner_session=ok')){res.writeHead(403);res.end('Forbidden');return;}
   let body='';for await(const chunk of req)body+=chunk.toString('utf8');
   const url=new URL(req.url,'http://127.0.0.1');
   seen.push({method:req.method,path:url.pathname.replace('/api/plugins/fish-soul',''),
    search:url.search,body:body?JSON.parse(body):{}});
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify(url.pathname.endsWith('/inspector/self-outdated')
    ?{ok:true,total:0,items:[]}:url.pathname.endsWith('/douyin/uin-candidates')
    ?{ok:true,candidates:[{name:candidate}]}:{ok:true}));
  });
  await new Promise((ok,no)=>{upstream.once('error',no);upstream.listen(upPort,'127.0.0.1',ok);});
  gateway=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,
   env:{...process.env,FS_GATEWAY_PORT:String(gwPort),FS_LAN_BIND_IP:'',
    FS_ACCESS_CODE:'SYNTHETIC-CODE',FS_AUTO_AUTH_ONLY:'1',FS_PLUGIN_DIR:lib,FS_APPROVAL_FILE:approval,
    DSH_WEB_URL:'http://127.0.0.1:'+upPort+'/?token=SYNTHETIC-TOKEN',
    FS_VMO_PROXY_ORIGINS:'https://host.tmd.pet',
    VMO_REPORT_TRANSPORT:'python',VMO_PYTHON:'/invalid/python',VMO_REPORT_SCRIPT:'/invalid/reporter'},
   stdio:'ignore'});
  const base='http://127.0.0.1:'+gwPort;
  let ready=false;
  for(let i=0;i<100;i++){
   try{const resp=await fetch(base+'/__bridge/health',{signal:AbortSignal.timeout(400)});
    const body=await resp.json();if(body.upstreamReady&&body.pluginLocated){ready=true;break;}}
   catch{}
   await sleep(90);
  }
  assert.equal(ready,true);
  const api='/api/plugins/fish-soul';
  const noAuth=await fetch(base+api+'/inspector/self-outdated?offset=0');
  assert.notEqual(noAuth.status,200);
  const unlock=await fetch(base+'/__bridge/unlock',{method:'POST',
   headers:{'content-type':'application/json',origin:'https://host.tmd.pet'},
   body:JSON.stringify({code:'SYNTHETIC-CODE'})});
  assert.equal(unlock.status,200);
  const cookie=unlock.headers.get('set-cookie')?.split(';')[0];
  const post=async(path,body,origin='https://host.tmd.pet')=>{
   const resp=await fetch(base+api+path,{method:'POST',headers:{cookie,origin,
    'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify(body)});
   return {status:resp.status,data:await resp.json()};
  };
  assert.equal((await post('/douyin/uin-candidates',{})).status,200);
  assert.equal((await post('/douyin/uin-confirm',{name:candidate})).status,200);
  assert.equal((await post('/douyin/uin-dismiss',{name:candidate})).status,200);
  assert.equal((await post('/stickers/backfill',{workspacePath:ws,limit:25})).status,200);
  assert.equal((await post('/inspector/dream',{ownerId:'user:qq:12345'})).status,200);
  const archive=await fetch(base+api+'/inspector/self-outdated?offset=30',{headers:{cookie}});
  assert.equal(archive.status,200);
  assert.equal((await archive.json()).ok,true);
  assert.notEqual((await post('/douyin/uin-confirm',{name:candidate},'https://evil.example')).status,200);
  assert.equal((await post('/douyin/uin-confirm',{name:'../secret'})).status,400);
  assert.equal((await post('/stickers/backfill',{workspacePath:'\\\\evil\\share'})).status,400);
  assert.equal((await post('/update/apply',{})).status,403);
  const denied=await fetch(base+api+'/inspector/self-outdated?ownerId=other',{headers:{cookie}});
  assert.equal(denied.status,400);
  assert.equal(seen.filter(x=>x.path==='/douyin/uin-confirm').length,1);
  assert.deepEqual(seen.filter(x=>x.path==='/inspector/self-outdated').map(x=>x.search),['?offset=30']);
 } finally {
  if(gateway){gateway.kill();await sleep(120);}
  if(upstream)await new Promise(ok=>upstream.close(ok));
  await rm(dir,{recursive:true,force:true});
 }
});
