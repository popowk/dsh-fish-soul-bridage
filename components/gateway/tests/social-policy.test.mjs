import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedEndpoint,validateBody} from '../customer-policy.mjs';
import {allowedPeer,startSnowLumaLanRelay} from '../snowluma-lan-relay.mjs';

test('QQ/Bili settings and Bili QR workflow are separately gated',()=>{
 for(const e of ['/channels/qq-config','/channels/bili-config']){
  assert.equal(allowedEndpoint('POST',e,{socialConfig:true}),true);
  assert.equal(allowedEndpoint('POST',e,{socialConfig:false}),false);
 }
 for(const e of ['/bili/qr/start','/bili/qr/poll','/bili/cookie','/bili/logout']){
  assert.equal(allowedEndpoint('POST',e,{biliAuth:true}),true);
  assert.equal(allowedEndpoint('POST',e,{biliAuth:false}),false);
 }
 for(const e of ['/sessions/workspace','/sessions/migrate','/web/test','/memory/debug']){
  assert.equal(allowedEndpoint('POST',e,{socialConfig:true,biliAuth:true,douyinConfig:true}),false,e);
 }
 for(const e of ['/storage/restore','/chat-archive/delete','/bili/post-now','/bili/browse-now','/backup/restore','/douyin/post-now','/inspector/forget']){
  assert.equal(allowedEndpoint('POST',e,{socialConfig:true,biliAuth:true,douyinConfig:true}),true,e);
 }
});
test('per-VM channel configuration accepts safe QQ local WS and Bili settings',()=>{
 const qq={enabled:true,wsUrl:'ws://127.0.0.1:3001',httpUrl:'http://localhost:3000',accessToken:'SECRET-FAKE',private:true,groups:['12345'],replyAll:false};
 assert.deepEqual(validateBody('/channels/qq-config',qq,true),{ok:true,value:qq});
 const bili={enabled:true,autoReply:false,browse:{enabled:true,perDay:1},cookie:'TEST-ONLY-COOKIE'};
 assert.equal(validateBody('/channels/bili-config',bili,true).ok,true);
 for(const bad of [{wsUrl:'http://169.254.169.254/latest/meta-data'}, {wsUrl:'https://host.tmd.pet/proxy'}, {cmd:'rm'}, {webhook:'https://example.org'}, {cookie:'a\rb'}]){
  assert.equal(validateBody('/channels/qq-config',bad,true).ok,false,JSON.stringify(bad));
 }
});
test('Bili QR/login body supports empty QR start, id polling, bounded cookie, rejects URL and unexpected fields',()=>{
 assert.equal(validateBody('/bili/qr/start',{},false).ok,true);
 assert.equal(validateBody('/bili/qr/start',{target:'fish',allowSameAsOwner:true},true).ok,true);
 assert.equal(validateBody('/bili/qr/poll',{id:'A123-key'},true).ok,true);
 assert.equal(validateBody('/bili/logout',{},true).ok,true);
 assert.equal(validateBody('/bili/cookie',{cookie:'SESSDATA=FAKE; bili_jct=FAKE'},true).ok,true);
 for(const e of ['/bili/qr/start','/bili/qr/poll','/bili/logout']){
  assert.equal(validateBody(e,{url:'http://127.0.0.1:4444'},true).ok,false,e);
 }
 assert.equal(validateBody('/bili/cookie',{cookie:'A\nB'},true).ok,false);
});
test('SnowLuma scoped relay allows only the VMO management host, never domain/broad subnet',()=>{
 assert.equal(allowedPeer('192.168.2.99'),true);
 assert.equal(allowedPeer('::ffff:192.168.2.99'),true);
 for(const ip of ['192.168.2.100','127.0.0.1','10.0.0.1','192.168.50.2','host.tmd.pet'])assert.equal(allowedPeer(ip),false,ip);
 assert.throws(()=>startSnowLumaLanRelay({listenIP:'0.0.0.0',port:5099}),/Invalid/);
 assert.throws(()=>startSnowLumaLanRelay({listenIP:'192.168.2.99',port:5099}),/Invalid/);
});
