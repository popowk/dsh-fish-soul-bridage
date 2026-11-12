import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const base='https://host.tmd.pet/apps/StableCustomerRoute01/dsh-fish-soul/';

test('native HTML, images and scripts are truly relative to the app mount',async()=>{
 for(const name of ['login.html','index.html','diagnose.html','approval-required.html']){
  const html=await readFile(join(root,'public',name),'utf8');
  assert.doesNotMatch(html,/(?:src|href)=["']\/(?:__bridge|__vendor|__native)/);
 }
 const html=await readFile(join(root,'public','index.html'),'utf8');
 assert.match(html,/__bridge\/scoped-plugin\.js/);
 assert.ok(new URL('__bridge/login.js',base).href.startsWith(base));
 assert.ok(new URL('__native/client.js',base).href.startsWith(base));
});

test('successful and failed unlock use ONLY the mounted URL, not console root',async()=>{
 const script=await readFile(join(root,'public','login.js'),'utf8');
 const calls=[],form={addEventListener(_name,cb){this.cb=cb}};
 const button={disabled:false},message={textContent:''};
 const context={URL,document:{baseURI:base,
  getElementById(id){return id==='form'?form:id==='message'?message:{value:'TEST-CODE'}},
  querySelector(){return button}},
  location:{replace(u){calls.push(['navigate',u])}},
  fetch:async(u,init)=>{calls.push(['post',String(u),init.method]);return {ok:true,status:200}}};
 vm.runInNewContext(script,context);
 await form.cb({preventDefault(){}});
 assert.deepEqual(calls,[['post',base+'__bridge/unlock','POST'],['navigate',base]]);
 assert.equal(button.disabled,false);
 const denied=[];
 context.fetch=async(u)=>{denied.push(String(u));return {ok:false,status:401}};
 vm.runInNewContext(script,context);await form.cb({preventDefault(){}});
 assert.deepEqual(denied,[base+'__bridge/unlock']);
 assert.match(message.textContent,/访问码不正确/);
});

test('native plugin adapter scopes ONLY fish-soul API; other apps and external origins untouched',async()=>{
 const js=await readFile(join(root,'public','scoped-plugin.js'),'utf8');
 const sent=[];
 class MockXHR{open(method,url){sent.push(url)}}
 const context={URL,document:{baseURI:base},Request:class {},XMLHttpRequest:MockXHR,
  window:{fetch:(u)=>{sent.push(u);return Promise.resolve()}}};
 vm.runInNewContext(js,context);
 await context.window.fetch('/api/plugins/fish-soul/status');
 await context.window.fetch('/api/other/endpoint');
 await context.window.fetch('https://example.org/api/plugins/fish-soul/status');
 new MockXHR().open('GET','/api/plugins/fish-soul/sessions');
 assert.deepEqual(sent,[base+'api/plugins/fish-soul/status', '/api/other/endpoint',
  'https://example.org/api/plugins/fish-soul/status',base+'api/plugins/fish-soul/sessions']);
});
