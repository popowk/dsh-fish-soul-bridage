import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES} from '../routes.mjs';
import {allowedEndpoint,validateBody,BLOCKED_CUSTOMER_POST} from '../customer-policy.mjs';

const opts={douyinBrowser:true,douyinConfig:true,modelConfig:true,socialConfig:true,biliAuth:true};
test('all enumerated native business POST endpoints are allowed except privileged unsafe operations',()=>{
 for(const path of ROUTES.POST){
  assert.equal(allowedEndpoint('POST',path,opts),!BLOCKED_CUSTOMER_POST.has(path),path);
 }
 for(const p of ['/sessions/workspace','/sessions/migrate','/web/test','/memory/debug']){
  assert.equal(BLOCKED_CUSTOMER_POST.has(p),true,p);
 }
});
test('destructive business actions accept native empty JSON while unsafe values are refused',()=>{
 for(const e of ['/backup/now','/backup/restore','/storage/delete','/storage/snapshot','/inspector/forget','/bili/post-now','/douyin/post-now','/chat-archive/delete']){
  assert.equal(validateBody(e,{},false).ok,true,e);
  assert.equal(validateBody(e,{cmd:'powershell.exe'},true).ok,false,e);
  assert.equal(validateBody(e,{url:'http://169.254.169.254'},true).ok,false,e);
 }
});
test('unlisted paths, privileged RPC and arbitrary file downloads are always denied',()=>{
 for(const path of ['/api/core/exec','/exec','/core/owner','/admin/tokens','/users','/settings']){
  assert.equal(allowedEndpoint('POST',path,opts),false,path);
  assert.equal(allowedEndpoint('GET',path,opts),false,path);
 }
 for(const e of ['/diagnose','/stickers/file'])assert.equal(allowedEndpoint('GET',e,opts),false,e);
});
