import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedEndpoint,validateBody} from '../customer-policy.mjs';

test('models/config is opt-out; delete/restore are allowed but raw owner RPC is not',()=>{
  assert.equal(allowedEndpoint('POST','/models/config',{modelConfig:false}),false);
  assert.equal(allowedEndpoint('POST','/models/config',{modelConfig:true}),true);
  assert.equal(allowedEndpoint('POST','/storage/restore',{modelConfig:true}),true);
  assert.equal(allowedEndpoint('POST','/backup/restore',{modelConfig:true}),true);
  assert.equal(allowedEndpoint('POST','/api/remote.mux',{modelConfig:true}),false);
  assert.equal(allowedEndpoint('GET','/models/state',{}),true);
});
test('models/config accepts normal model selection and bounded credentials',()=>{
  assert.equal(validateBody('/models/config',{defaultModel:'test-model',provider:'openai',settings:{apiKey:'test-fake-key',baseUrl:'https://example.com/v1'}},true).ok,true);
  assert.equal(validateBody('/models/config',{provider:'self-hosted',baseUrl:'http://127.0.0.1:12345/v1'},true).ok,true);
  assert.equal(validateBody('/models/config',{auth:{apiKey:'test-key'},authenticationEnabled:true},true).ok,true);
  assert.equal(validateBody('/models/config',{},true).ok,false);
});
test('models/config rejects malicious and malformed values',()=>{
  for(const obj of [
    {exec:'whoami'}, {apiKey:'x\nInjected'}, {baseUrl:'file:///etc/passwd'},
    {baseUrl:'https://alice:password@example.com/v1'}, {nested:{__proto__x:'x',shell:'whoami'}},
    {apiKey:'x'.repeat(6000)}
  ]) assert.equal(validateBody('/models/config',obj,true).ok,false,JSON.stringify(obj).slice(0,70));
});
