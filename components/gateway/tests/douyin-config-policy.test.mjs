import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedEndpoint,validateBody} from '../customer-policy.mjs';
import {createLanAccess} from '../lan-access.mjs';
const endpoint='/channels/douyin-config';
const payload={
 enabled:true,autoReply:false,masterName:'苏苏',allowList:['用户A'],replyAll:false,
 links:['用户A=123456789'],groups:['群A'],groupReply:true,callNames:['肥鱼'],
 browser:{kind:'edge',customPath:''},window:'background',
 browse:{enabled:false,perDay:3,videosPerSession:3,like:false,likeApi:false,collect:false,frames:true,framesPerDay:6,mode:'http',share:true,shareInDm:false},
 post:{enabled:false,perDay:1},comments:{enabled:false,perHour:4,emoji:false}
};
test('Douyin settings can be explicitly disabled; ordinary per-VM business actions are allowed',()=>{
 assert.equal(allowedEndpoint('POST',endpoint,{douyinConfig:false}),false);
 assert.equal(allowedEndpoint('POST',endpoint,{douyinConfig:true}),true);
 for(const route of ['/douyin/post-now','/douyin/comments-now','/douyin/browse-now','/backup/restore','/storage/restore']){
  assert.equal(allowedEndpoint('POST',route,{douyinConfig:true}),true,route);
 }
 for(const route of ['/sessions/workspace','/web/test','/core/owner']){
  assert.equal(allowedEndpoint('POST',route,{douyinConfig:true}),false,route);
 }
 assert.equal(allowedEndpoint('GET',endpoint,{douyinConfig:true}),false);
});
test('Official Douyin channel configuration passes strict canonical JSON validation',()=>{
 assert.deepEqual(validateBody(endpoint,payload,true),{ok:true,value:payload});
 assert.equal(validateBody(endpoint,{enabled:false},true).ok,true);
 assert.equal(validateBody(endpoint,{browser:{kind:'edge',customPath:''}},true).ok,true);
 assert.equal(validateBody(endpoint,{post:{enabled:true,perDay:2}},true).ok,true);
});
test('Unexpected or dangerous Douyin settings are rejected, never forwarded',()=>{
 const bad=[{}, {cmd:'whoami'}, {browser:{customPath:'C:\\Users\\Public\\evil.exe'}},
  {browser:{customPath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'}},
  {browser:{kind:'edge',customPath:'',args:['--no-sandbox']}}, {browse:{perDay:100}}, {browse:{mode:'ssh'}}, {browse:{framesPerDay:50}},
  {browse:{enabled:'yes'}}, {post:{perDay:'3'}}, {groups:['A'.repeat(41)]},
  {links:['not-a-qq-number']}, {masterName:'A'.repeat(41)},
  {window:'hidden'}, {autoReply:'true'}, {credentials:{token:'secret'}},
  {enabled:true, constructor:{}}];
 for(const item of bad)assert.equal(validateBody(endpoint,item,true).ok,false,JSON.stringify(item));
 assert.equal(validateBody(endpoint,{},false).ok,false);
 assert.equal(validateBody(endpoint,['wrong'],true).ok,false);
});
test('No customer can set any custom executable browser path even with a caller opt-in',()=>{
 const path='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
 assert.equal(validateBody(endpoint,{browser:{customPath:path}},true,{allowCustomBrowser:true}).ok,false);
 for(const customPath of ['C:\\Users\\me\\chrome.exe','C:\\Program Files\\Test\\..\\evil.exe','\\\\example.org\\share\\chrome.exe','C:\\Program Files\\Tools\\powershell.exe']){
  assert.equal(validateBody(endpoint,{browser:{customPath}},true,{allowCustomBrowser:true}).ok,false,customPath);
 }
});
test('VMO exact public HTTPS origin and legacy management origin allowed, arbitrary website not',()=>{
 const prev=process.env.FS_VMO_PROXY_ORIGINS;
 process.env.FS_VMO_PROXY_ORIGINS='http://192.168.2.99:8766,https://192.168.2.99:8766,https://host.tmd.pet';
 try{
  const lan=createLanAccess({port:56781});
  const req={headers:{host:'127.0.0.1:56781',origin:'https://host.tmd.pet'},socket:{localAddress:'127.0.0.1',remoteAddress:'127.0.0.1'}};
  assert.equal(lan.validOrigin(req),true);
  req.headers.origin='https://host.tmd.pet.evil.example';assert.equal(lan.validOrigin(req),false);
  req.headers.origin='http://host.tmd.pet';assert.equal(lan.validOrigin(req),false);
  req.headers.origin='http://192.168.2.99:8766';assert.equal(lan.validOrigin(req),true);
  req.headers.origin='https://evil.example';assert.equal(lan.validOrigin(req),false);
 }finally{if(prev===undefined)delete process.env.FS_VMO_PROXY_ORIGINS;else process.env.FS_VMO_PROXY_ORIGINS=prev;}
});
