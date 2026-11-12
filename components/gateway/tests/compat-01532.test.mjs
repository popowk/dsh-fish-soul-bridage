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
import {validateVoiceConfig,validateBody,allowedEndpoint} from '../customer-policy.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();await new Promise((yes,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',yes);});const n=s.address().port;await new Promise(yes=>s.close(yes));return n;}

test('0.15.32 TTS provider config: valid Volc V3/V1 fields and secret fields accepted, unsafe targets rejected',()=>{
 assert.equal(validateVoiceConfig({enabled:true,ttsProvider:'volcengine',ttsApiKey:'SYNTHETIC-NOT-A-KEY',ttsModel:'doubao-tts',ttsVoice:'zh_female_test',ttsBaseURL:'https://openspeech.bytedance.com',volcAppId:'',volcCluster:'volcano_tts',volcResourceId:'seed-tts-2.0',volcEndpoint:'https://openspeech.bytedance.com/api/v3/tts/unidirectional',timeoutSec:300}),null);
 assert.equal(validateVoiceConfig({enabled:true,ttsProvider:'openai',ttsBaseURL:'http://127.0.0.1:8000/v1',ttsApiKey:'••••'}),null);
 assert.equal(validateVoiceConfig({ttsBaseURL:'http://192.168.2.99:18767'}),'voice-url-insecure');
 assert.equal(validateVoiceConfig({ttsBaseURL:'file:///etc/passwd'}),'voice-url');
 assert.equal(validateVoiceConfig({script:'run evil'}),'voice-field');
 assert.equal(validateBody('/voice/config',{ttsProvider:'volcengine',ttsApiKey:'DUMMY'},true).ok,true);
 assert.equal(validateBody('/voice/test',{text:'试音'},true).ok,true);
 assert.equal(allowedEndpoint('POST','/voice/config'),true);
});
test('0.15.32 Douyin browser screenshot and new endpoints match native UI schemas',()=>{
 assert.equal(validateBody('/douyin/screenshot',{checkLogin:true},true).ok,true);
 assert.equal(validateBody('/douyin/screenshot',{},true).ok,true);
 assert.equal(validateBody('/douyin/screenshot',{checkLogin:'yes'},true).ok,false);
 assert.equal(validateBody('/douyin/screenshot',{cmd:'powershell'},true).ok,false);
 for(const p of ['/douyin/inbox-gap-ack','/douyin/inbox-resolve','/douyin/post-resolve','/inspector/person/delete','/sessions/reply-target'])assert.equal(allowedEndpoint('POST',p),true,p);
 assert.equal(validateBody('/douyin/inbox-gap-ack',{id:123},true).ok,true);
 assert.equal(validateBody('/douyin/inbox-resolve',{id:123,action:'retry'},true).ok,true);
 assert.equal(validateBody('/douyin/post-resolve',{jobId:2,outcome:'not_published'},true).ok,true);
 assert.equal(validateBody('/douyin/post-resolve',{jobId:3,outcome:'published'},true).ok,true);
 assert.equal(validateBody('/inspector/person/delete',{ownerId:'user:qq:1234'},true).ok,true);
 assert.equal(validateBody('/sessions/reply-target',{replyTarget:'source'},true).ok,true);
});
test('Gateway forwards real 0.15.32 voice/test JSON audio and Douyin screenshot, reports masked diagnostics', {timeout:30000},async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'fish-01532-'));let gateway,up;
 try{
  const hostPort=await freePort(),gwPort=await freePort();
  const lib=join(tmp,'pkg','lib');await mkdir(lib,{recursive:true});
  await writeFile(join(tmp,'pkg','package.json'),JSON.stringify({name:'dsh-fish-soul',version:'0.15.32'}));
  await writeFile(join(lib,'client.js'),'/* synthetic 0.15.32 */\n'+'q'.repeat(1500));
  const m=await getManifest(lib),approval=join(tmp,'approval.json');
  await writeFile(approval,JSON.stringify({schema:2,source:'npm-integrity-verified',version:m.version,hash:m.hash,files:m.files,integrity:'sha512-'+Buffer.alloc(64).toString('base64'),verifiedAt:new Date().toISOString()}));
  const called=[];
  up=http.createServer(async(req,res)=>{
   if(req.url==='/?token=SYNTHETIC-TOKEN') {res.writeHead(302,{location:'/', 'set-cookie':'test_owner_session=ok; Path=/; HttpOnly'});res.end();return;}
   if(req.url==='/'&&req.headers.cookie?.includes('test_owner_session=ok')){res.writeHead(200,{'content-type':'text/html'});res.end('ok');return;}
   const route=req.url?.replace('/api/plugins/fish-soul','');
   if(!route || !req.headers.cookie?.includes('test_owner_session=ok')){res.writeHead(403);res.end();return;}
   let b='';for await(const chunk of req)b+=chunk;
   called.push({method:req.method,path:route,body:b?JSON.parse(b):{},origin:req.headers.origin});
   const payload=route==='/voice/test'?{ok:true,mediaType:'audio/mpeg',base64:'SUQzAAAA'}:
     route==='/voice/state'?{ok:true,enabled:true,tts:{hasKey:true,keyFrom:'own',effectiveBaseURL:'https://test.example'},ttsVoice:'anna',ttsModel:'a'}:
     route==='/channels/state'?{ok:true,douyin:{enabled:true,window:'visible',host:{state:'error',lastError:'Browser not found; C:\\Sensitive\\Path',browsers:[{name:'Edge',path:'C:\\Sensitive\\Browser'}]}}}:
     route==='/douyin/screenshot'?{ok:true,image:'data:image/jpeg;base64,/9j/4A==',loggedIn:false}:
     {ok:true};
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(payload));
  });
  await new Promise((yes,no)=>{up.once('error',no);up.listen(hostPort,'127.0.0.1',yes);});
  gateway=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,FS_GATEWAY_PORT:String(gwPort),FS_LAN_BIND_IP:'',FS_ACCESS_CODE:'SYNTHETIC-CODE',FS_AUTO_AUTH_ONLY:'1',FS_PLUGIN_DIR:lib,FS_APPROVAL_FILE:approval,DSH_WEB_URL:`http://127.0.0.1:${hostPort}/?token=SYNTHETIC-TOKEN`,FS_VMO_PROXY_ORIGINS:'https://host.tmd.pet',VMO_REPORT_TRANSPORT:'python',VMO_PYTHON:'/invalid/python',VMO_REPORT_SCRIPT:'/invalid/reporter'},stdio:'ignore'});
  const base=`http://127.0.0.1:${gwPort}`;
  let ready=false;
  for(let i=0;i<90;i++){try{const resp=await fetch(base+'/__bridge/health',{signal:AbortSignal.timeout(400)});const x=await resp.json();if(x.upstreamReady&&x.pluginLocated){ready=true;break;}}catch{}await sleep(90);}
  assert.ok(ready,'Mock upstream connected');
  const login=await fetch(base+'/__bridge/unlock',{method:'POST',headers:{'content-type':'application/json',origin:'https://host.tmd.pet'},body:JSON.stringify({code:'SYNTHETIC-CODE'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];
  const post=async(path,body)=>{
   const r=await fetch(base+'/api/plugins/fish-soul'+path,{method:'POST',headers:{'content-type':'application/json',origin:'https://host.tmd.pet','sec-fetch-site':'same-origin',cookie},body:JSON.stringify(body)});
   return {status:r.status,value:await r.json()};
  };
  const cfg=await post('/voice/config',{enabled:true,ttsProvider:'volcengine',ttsApiKey:'SYNTHETIC-NOT-REAL',ttsBaseURL:'https://openspeech.bytedance.com',volcResourceId:'seed-tts-2.0',timeoutSec:300});
  assert.equal(cfg.status,200,JSON.stringify(cfg.value));
  const tts=await post('/voice/test',{text:'hello test'});
  assert.equal(tts.status,200);assert.deepEqual(tts.value,{ok:true,mediaType:'audio/mpeg',base64:'SUQzAAAA'});
  const browser=await post('/douyin/browser/start',{});assert.equal(browser.status,200,JSON.stringify(browser.value));
  const screenshot=await post('/douyin/screenshot',{checkLogin:true});assert.equal(screenshot.status,200,JSON.stringify(screenshot.value));
  assert.match(screenshot.value.image,/^data:image\/jpeg;base64/);
  const invalid=await post('/voice/config',{cmd:'powershell'});assert.equal(invalid.status,400);
  const info=await fetch(base+'/__bridge/media-health',{headers:{cookie}});assert.equal(info.status,200);
  const state=await info.json();assert.equal(state.plugin,'0.15.32');
  assert.equal(state.voice.tts.hasKey,true);assert.equal(state.douyin.failureCategory,'browser-not-found');
  assert.doesNotMatch(JSON.stringify(state),/Sensitive|SYNTHETIC-NOT-REAL|Browser not found/);
  assert.ok(called.some(v=>v.path==='/douyin/screenshot'&&v.body.checkLogin===true));
  assert.ok(called.some(v=>v.path==='/voice/config'&&v.body.ttsProvider==='volcengine'));
 }finally{if(gateway){gateway.kill();await sleep(120);}if(up)await new Promise(resolve=>up.close(resolve));await rm(tmp,{recursive:true,force:true});}
});
