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
import {validateBody,validateQuery,validateVoiceConfig,allowedEndpoint} from '../customer-policy.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){
 const s=net.createServer();
 await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});
 const port=s.address().port;
 await new Promise(ok=>s.close(ok));
 return port;
}
const ws='C:\\dsh\\profiles\\desktop';
const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01,0x02]);

test('0.15.55 model, voice, Douyin changes: accept only exact safe config',()=>{
 for(const cfg of [
  {enabled:true,ttsProvider:'minimax',sttProvider:'dashscope',ttsBaseURL:'https://tts.example/v1',timeoutSec:300},
  {ttsProvider:'minimax',sttProvider:'minimax'},
  {ttsProvider:'volcengine',sttProvider:'openai'}
 ]) assert.equal(validateVoiceConfig(cfg),null);
 assert.equal(validateVoiceConfig({sttProvider:'file:///evil'}),'voice-stt-provider');
 assert.equal(validateVoiceConfig({ttsProvider:'command'}),'voice-provider');
 const uid='7702399256389125169'; // 19 digits: never coerce to JS Number
 const cfg={masterUid:uid,masterName:'主人',shareCard:true,replyWindowMinutes:120};
 const value=validateBody('/channels/douyin-config',cfg,true);
 assert.equal(value.ok,true);
 assert.equal(value.value.masterUid,uid);
 assert.equal(validateBody('/channels/douyin-config',{masterUid:'douyin:'+uid},true).ok,true);
 for(const invalid of [{masterUid:'javascript:alert(1)'},{masterUid:123456789},
   {shareCard:'yes'},{replyWindowMinutes:0},{replyWindowMinutes:1441},{cmd:'run'}]){
  assert.equal(validateBody('/channels/douyin-config',invalid,true).ok,false,JSON.stringify(invalid));
 }
});
test('0.15.55 exact routes preserve file boundaries and diagnostics protections',()=>{
 for(const endpoint of ['/diag-log','/stickers/file']){
  assert.equal(allowedEndpoint('GET',endpoint),true,endpoint);
 }
 for(const endpoint of ['/diag-log/clear','/stickers/tags','/douyin/inbox-dismiss-all']){
  assert.equal(allowedEndpoint('POST',endpoint),true,endpoint);
 }
 assert.equal(allowedEndpoint('POST','/web/test'),false);
 assert.equal(allowedEndpoint('GET','/diagnose'),false);
 assert.equal(allowedEndpoint('POST','/internal/shell'),false);
 assert.equal(validateBody('/diag-log/clear',{},true).ok,true);
 assert.equal(validateBody('/diag-log/clear',{anything:1},true).ok,false);
 assert.equal(validateBody('/douyin/inbox-gap-ack',{},true).ok,true);
 assert.equal(validateBody('/douyin/inbox-dismiss-all',{},true).ok,true);
 assert.equal(validateBody('/stickers/tags',{file:'猫.png',workspacePath:ws,tags:'开心、猫'},true).ok,true);
 assert.equal(validateBody('/stickers/rename',{file:'猫.png',workspacePath:ws,name:'笑脸'},true).ok,true);
 assert.equal(validateBody('/stickers/delete',{file:'猫.png',workspacePath:ws},true).ok,true);
 assert.equal(validateBody('/stickers/tags',{file:'..\\secret.png',workspacePath:ws,tags:'a'},true).ok,false);
 assert.equal(validateBody('/stickers/tags',{file:'猫.png',workspacePath:'\\\\attacker\\share',tags:'a'},true).ok,false);
 assert.deepEqual(validateQuery('/stickers/import','?name='+encodeURIComponent('小猫')),{ok:true});
 assert.deepEqual(validateQuery('/stickers/import',''),{ok:true}); // legacy JSON client
 assert.equal(validateQuery('/stickers/import','?name=..%5Csystem').ok,false);
 assert.equal(validateQuery('/stickers/import','?name=http%3A%2F%2Fevil').ok,false);
 const ok='?file='+encodeURIComponent('猫.png')+'&ws='+encodeURIComponent(ws);
 assert.equal(validateQuery('/stickers/file',ok).ok,true);
 assert.equal(validateQuery('/stickers/file','?file=..%2Fpasswords.png&ws='+encodeURIComponent(ws)).ok,false);
 assert.equal(validateQuery('/stickers/file','?file=猫.png&ws='+encodeURIComponent('\\\\host\\share')).ok,false);
});

test('0.15.55 gateway forwards native binary stickers, image fetches, log and safe configs', {timeout:30000},async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'fish-01555-'));
 let gateway,up;
 try {
  const hostPort=await freePort(), gwPort=await freePort();
  const lib=join(tmp,'pkg','lib');
  await mkdir(lib,{recursive:true});
  await writeFile(join(tmp,'pkg','package.json'),JSON.stringify({name:'dsh-fish-soul',version:'0.15.55'}));
  await writeFile(join(lib,'client.js'),'/* synthetic v0.15.55 */\n'+'q'.repeat(1600));
  const m=await getManifest(lib), approval=join(tmp,'approval.json');
  await writeFile(approval,JSON.stringify({schema:2,source:'npm-integrity-verified',version:m.version,hash:m.hash,files:m.files,integrity:'sha512-'+Buffer.alloc(64).toString('base64'),verifiedAt:new Date().toISOString()}));
  const seen=[];
  up=http.createServer(async(req,res)=>{
   if(req.url==='/?token=SYNTHETIC-TOKEN'){res.writeHead(302,{location:'/', 'set-cookie':'test_owner_session=ok; Path=/; HttpOnly'});res.end();return;}
   if(req.url==='/'&&req.headers.cookie?.includes('test_owner_session=ok')){res.writeHead(200,{'content-type':'text/html'});res.end('ok');return;}
   if(!req.headers.cookie?.includes('test_owner_session=ok')){res.writeHead(403);res.end('forbidden');return;}
   const url=new URL(req.url,'http://127.0.0.1');
   const endpoint=url.pathname.replace('/api/plugins/fish-soul','');
   const pieces=[];for await(const chunk of req)pieces.push(chunk);
   const body=Buffer.concat(pieces);
   seen.push({endpoint,search:url.search,method:req.method,type:req.headers['content-type'],body});
   if(endpoint==='/stickers/file'){
    res.writeHead(200,{'content-type':'image/png'});res.end(png);return;
   }
   const payload=endpoint==='/diag-log'?{ok:true,entries:[{key:'douyin-inbox-unknown',message:'Bearer AAAAAAAAAAAAAAAABBBBBBBBBBBB'}]}:{ok:true};
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify(payload));
  });
  await new Promise((ok,no)=>{up.once('error',no);up.listen(hostPort,'127.0.0.1',ok);});
  gateway=spawn(process.execPath,[join(root,'server.mjs')],{
   cwd:root,env:{...process.env,FS_GATEWAY_PORT:String(gwPort),FS_LAN_BIND_IP:'',
    FS_ACCESS_CODE:'SYNTHETIC-CODE',FS_AUTO_AUTH_ONLY:'1',FS_PLUGIN_DIR:lib,
    FS_APPROVAL_FILE:approval,DSH_WEB_URL:'http://127.0.0.1:'+hostPort+'/?token=SYNTHETIC-TOKEN',
    FS_VMO_PROXY_ORIGINS:'https://host.tmd.pet',VMO_REPORT_TRANSPORT:'python',
    VMO_PYTHON:'/invalid/python',VMO_REPORT_SCRIPT:'/invalid/reporter'},stdio:'ignore'
  });
  const base='http://127.0.0.1:'+gwPort;
  let healthy=false;
  for(let i=0;i<90;i++){
   try{const r=await fetch(base+'/__bridge/health',{signal:AbortSignal.timeout(400)});const state=await r.json();if(state.upstreamReady&&state.pluginLocated){healthy=true;break;}}catch{}
   await sleep(90);
  }
  assert.equal(healthy,true,'synthetic upstream must be reachable');
  const login=await fetch(base+'/__bridge/unlock',{method:'POST',headers:{'content-type':'application/json',origin:'https://host.tmd.pet'},body:JSON.stringify({code:'SYNTHETIC-CODE'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  const route='/api/plugins/fish-soul';
  const post=async(p,body,type='application/json')=>{
   const resp=await fetch(base+route+p,{method:'POST',headers:{'content-type':type,origin:'https://host.tmd.pet','sec-fetch-site':'same-origin',cookie},body:type==='application/json'?JSON.stringify(body):body});
   return {status:resp.status,data:await resp.json()};
  };
  assert.equal((await post('/channels/douyin-config',{masterUid:'7702399256389125169',shareCard:true,replyWindowMinutes:120})).status,200);
  assert.equal((await post('/voice/config',{ttsProvider:'minimax',sttProvider:'dashscope',ttsBaseURL:'https://tts.example/v1'})).status,200);
  assert.equal((await post('/stickers/tags',{file:'猫.png',workspacePath:ws,tags:'好玩'})).status,200);
  assert.equal((await post('/diag-log/clear',{})).status,200);
  const photo=await post('/stickers/import?name='+encodeURIComponent('猫咪'),png,'image/png');
  assert.equal(photo.status,200);
  const nativeUpload=seen.find(x=>x.endpoint==='/stickers/import');
  assert.ok(nativeUpload);
  assert.equal(nativeUpload.type,'image/png');
  assert.deepEqual(nativeUpload.body,png);
  assert.equal(new URLSearchParams(nativeUpload.search).get('name'),'猫咪');
  const img=await fetch(base+route+'/stickers/file?file='+encodeURIComponent('猫.png')+'&ws='+encodeURIComponent(ws),{headers:{cookie}});
  assert.equal(img.status,200);assert.equal(img.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()),png);
  const log=await fetch(base+route+'/diag-log',{headers:{cookie}});
  assert.equal(log.status,200);
  const logData=await log.json();
  assert.doesNotMatch(JSON.stringify(logData),/AAAAAAAABBBBBB/);
  assert.equal((await post('/stickers/import?name=cat',Buffer.from('not-an-image'),'image/png')).status,415);
  assert.equal((await post('/voice/config',png,'image/png')).status,415);
  assert.equal((await post('/stickers/import?name=..%5Csecret',png,'image/png')).status,400);
  assert.equal((await post('/channels/douyin-config',{masterUid:'http://evil'})).status,400);
  assert.equal(seen.filter(x=>x.endpoint==='/stickers/import').length,1,'invalid uploads must never reach DSH');
  assert.equal(seen.find(x=>x.endpoint==='/channels/douyin-config').body.includes(Buffer.from('7702399256389125169')),true);
 }finally{
  if(gateway){gateway.kill();await sleep(120);}
  if(up)await new Promise(ok=>up.close(ok));
  await rm(tmp,{recursive:true,force:true});
 }
});
