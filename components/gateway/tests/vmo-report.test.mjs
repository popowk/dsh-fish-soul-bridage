import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildReport,buildGatewayReport,reportApp,createAppReporter,localReportUrl,RETRY_DELAYS_MS} from '../vmo-report.mjs';
import {parseBootstrapPassword} from '../snowluma-log-parser.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('two app payloads are independent and preserve actual login credentials',()=>{
  const snow=buildReport({appId:'snowluma',port:5099,version:'2.4.2',online:true,kind:'random_password',accessCode:'REAL-BOOT-PASSWORD'});
  const dsh=buildGatewayReport({port:56781,version:'0.15.5',online:true,gatewayCode:'REAL-GATEWAY-CODE'});
  assert.equal(snow.url,'http://127.0.0.1:5099/');
  assert.equal(snow.auth.access_code,'REAL-BOOT-PASSWORD');
  assert.equal(dsh.auth.access_code,'REAL-GATEWAY-CODE');
  assert.equal(dsh.auth.kind,'token');
  assert.notEqual(snow.app_id,dsh.app_id);
  assert.equal(buildReport({appId:'snowluma',port:5099,online:false,kind:'random_password',accessCode:'REAL'}).auth.access_code,null);
  assert.throws(()=>buildReport({appId:'not-allowed',port:1234,online:true,kind:'token'}));
  assert.deepEqual(RETRY_DELAYS_MS,[10000,30000,60000]);
});

test('loopback URL rejects off-box endpoints, query strings and wrong port',()=>{
  assert.equal(localReportUrl('http://127.0.0.1:18767/apps/report').pathname,'/apps/report');
  assert.throws(()=>localReportUrl('http://192.168.2.99:18767/apps/report'));
  assert.throws(()=>localReportUrl('http://127.0.0.1:8766/apps/report'));
  assert.throws(()=>localReportUrl('http://127.0.0.1:18767/apps/report?token=x'));
});

test('HTTP POST delivers both payloads to local receiver with actual credential fields',async(t)=>{
  const bodies=[];
  const server=http.createServer(async(req,res)=>{
    let data='';for await(const chunk of req)data+=chunk;
    bodies.push({path:req.url,method:req.method,body:JSON.parse(data)});
    res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18767,'127.0.0.1',resolve);});}
  catch(e){if(e.code==='EADDRINUSE'){t.skip('local port 18767 is occupied');return;}throw e;}
  try{
    const reports=[buildReport({appId:'snowluma',port:5099,online:true,version:'2.4.2',kind:'random_password',accessCode:'random-123'}),buildGatewayReport({port:56781,online:true,version:'0.15.5',gatewayCode:'gateway-login-xyz'})];
    for(const report of reports)assert.deepEqual(await reportApp(report,{url:'http://127.0.0.1:18767/apps/report'}),{ok:true,transport:'http'});
    assert.deepEqual(bodies.map(x=>x.body.app_id),['snowluma','dsh-fish-soul']);
    assert.deepEqual(bodies.map(x=>x.body.auth.access_code),['random-123','gateway-login-xyz']);
    assert.ok(bodies.every(x=>x.path==='/apps/report'&&x.method==='POST'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('retry sequence, immediate change submission, no repeated unchanged state',async()=>{
  const attempts=[];let allow=false;
  const reporter=createAppReporter({appId:'snowluma',delays:[15,30,60],heartbeatMs:5000,
    submit:async r=>{attempts.push({time:Date.now(),access:r.auth.access_code,port:r.url});return allow?{ok:true}:{ok:false,reason:'mock-error'};}});
  try{
    const initial=buildReport({appId:'snowluma',port:5099,online:true,kind:'random_password',accessCode:null});
    assert.equal(reporter.update(initial),true);
    assert.equal(reporter.update(initial),false);
    await wait(75);
    assert.ok(attempts.length>=3,`got ${attempts.length} retries`);
    assert.ok(attempts[1].time-attempts[0].time>=10);
    assert.ok(attempts[2].time-attempts[1].time>=25);
    allow=true;
    reporter.update(buildReport({appId:'snowluma',port:15101,online:true,kind:'random_password',accessCode:'changed-pass'}));
    await wait(20);
    assert.equal(attempts.at(-1).access,'changed-pass');
    assert.equal(attempts.at(-1).port,'http://127.0.0.1:15101/');
    assert.equal(reporter.getStatus().lastResult?.ok,true);
  }finally{reporter.stop();}
});


test('56781 reports the gateway unlock CODE, not a DSH owner token',()=>{
  const gatewayLoginCode='gateway-hex-code',hostOwnerToken='dsh-admin-host-token';
  const report=buildGatewayReport({port:56781,version:'0.15.5',online:true,gatewayCode:gatewayLoginCode});
  assert.equal(report.auth.kind,'token'); // existing VMO schema for bearer-style login codes
  assert.equal(report.auth.access_code,gatewayLoginCode);
  assert.notEqual(report.auth.access_code,hostOwnerToken);
  assert.equal(buildGatewayReport({port:56781,online:false,gatewayCode:gatewayLoginCode}).auth.access_code,null);
  assert.throws(()=>buildGatewayReport({port:56781,online:true,gatewayCode:'bad\ncode'}));
});

test('SnowLuma parser extracts passwords only when launch output supplies them',()=>{
  assert.equal(parseBootstrapPassword('initial credentials: user=admin password=boot-random-ABC'), 'boot-random-ABC');
  assert.equal(parseBootstrapPassword('09:50:47 INFO [WebUI] initial credentials: user=admin password=xyz987'), 'xyz987');
  assert.equal(parseBootstrapPassword('临时密码：中文Abc123'), '中文Abc123');
  assert.equal(parseBootstrapPassword('\x1b[32m[WebUI] initial credentials: user=admin password=boot-PASS\x1b[0m'), 'boot-PASS');
  assert.equal(parseBootstrapPassword('WebUI already initialized; no password printed'),null);
  assert.equal(parseBootstrapPassword('initial credentials: user=admin password=********'),null);
});


test('404 from incorrectly assumed HTTP route falls back to trusted reporter stdin',async(t)=>{
  const temp=await mkdtemp(join(tmpdir(),'vmo-auto-fallback-'));
  const script=join(temp,'registered.mjs');
  await writeFile(script, `let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const r=JSON.parse(raw); if(r.app_id==='dsh-fish-soul'&&r.auth.access_code==='REAL-GATEWAY-CODE')process.exit(0);else process.exit(3);});`);
  const srv=http.createServer((req,res)=>{res.writeHead(404);res.end();});
  try{
    await new Promise((resolve,reject)=>{srv.once('error',reject);srv.listen(18767,'127.0.0.1',resolve);});
  }catch(e){await rm(temp,{recursive:true,force:true});if(e.code==='EADDRINUSE'){t.skip('18767 occupied');return;}throw e;}
  try{
    const result=await reportApp(buildGatewayReport({port:56781,online:true,gatewayCode:'REAL-GATEWAY-CODE'}),
      {transport:'auto',python:process.execPath,script});
    assert.deepEqual(result,{ok:true,transport:'python'});
  }finally{
    await new Promise(resolve=>srv.close(resolve));
    await rm(temp,{recursive:true,force:true});
  }
});

test('HTTP 403 does not bypass explicit authorization rejection',async(t)=>{
  const srv=http.createServer((req,res)=>{res.writeHead(403);res.end();});
  try{await new Promise((resolve,reject)=>{srv.once('error',reject);srv.listen(18767,'127.0.0.1',resolve);});}
  catch(e){if(e.code==='EADDRINUSE'){t.skip('18767 occupied');return;}throw e;}
  try{
    const result=await reportApp(buildGatewayReport({port:56781,online:true,gatewayCode:'CODE'}),{transport:'auto',python:'/nonexistent/python',script:'/nonexistent/helper'});
    assert.deepEqual(result,{ok:false,reason:'local-http-403'});
  }finally{await new Promise(resolve=>srv.close(resolve));}
});
