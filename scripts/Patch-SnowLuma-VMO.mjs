#!/usr/bin/env node
// Patches only verified SnowLuma v2.4.2 VMO overlay JS, never backend/binaries/secrets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
const dir=process.argv[2]&&path.resolve(process.argv[2]);
const checkOnly=process.argv.includes('--check');
if(!dir){console.error('Usage: node Patch-SnowLuma-VMO.mjs <SnowLuma-dir> [--check]');process.exit(2);}
const sha=(x)=>crypto.createHash('sha256').update(x).digest('hex');
const specs=[
  {
    file:'index-DolPqBYW.vmo.js',
    original:'850440adcaacc416f652313b253b95a4806d5c1726e4b1cc5186b3481d9155de',
    patched:'a616f2e83a57f86a67500b851290337ef0700fd4c0b964e92c75966c86ca0489',
    replacements:[
      ['src:\x60/logo.png\x60','src:\x60logo.png\x60'],
      ['i.open(\x60POST\x60,\x60/api/debug/upload?filename=\x60+encodeURIComponent(c))',
       'i.open(\x60POST\x60,__vmoSnowUrl(\x60/api/debug/upload?filename=\x60+encodeURIComponent(c)))']
    ]
  },
  {
    file:'router-_TYMdJui.vmo.js',
    original:'82bf3cbd28ac8960a867bb62977b658e2e086d1027a4c90780cdb2f9b39b90a1',
    patched:'57ecf95309bb83b577fd9efe84f401cd1d5d9deaa6306b3954330d2cbdf0dc21',
    replacements:[['src:\x60/logo.png\x60','src:\x60logo.png\x60']]
  },
  {
    file:'settings-page-C7mrOgzU.vmo.js',
    original:'61b7d533d8b7745ea7c0b9267ac126a11fa5f3da67b03e9d80ac7dee54959bb3',
    patched:'10b9fd5a65bca9ba931bfcd2d1381f1c6e807b59d62fb6c1a23a21afe4377130',
    replacements:[
      ['src:\x60/logo.png\x60','src:\x60logo.png\x60'],
      ['src:\x60/ui-asset/background?v='+ '$' + '{e.background.imageVersion}\x60',
       'src:\x60ui-asset/background?v='+ '$' + '{e.background.imageVersion}\x60']
    ]
  }
];
try{
  const release=JSON.parse(fs.readFileSync(path.join(dir,'release.json'),'utf8'));
  if(release.version!=='2.4.2')throw Error('Unsupported SnowLuma version; expected 2.4.2');
  const assets=path.join(dir,'client','assets');
  for(const relative of ['client/logo.png','client/assets/overview-page-Bm3ks5zC.css']){
    if(!fs.existsSync(path.join(dir,relative)))throw Error('Incomplete WebUI assets: '+relative);
  }
  const plan=specs.map(spec=>{
    const file=path.join(assets,spec.file);
    const original=fs.readFileSync(file),before=sha(original);
    if(before===spec.patched)return {spec,file,state:'already-fixed'};
    if(before!==spec.original)throw Error('Unexpected build SHA256: '+spec.file);
    let result=original.toString('utf8');
    for(const [from,to] of spec.replacements){
      if(result.split(from).length!==2)throw Error('Ambiguous patch marker: '+spec.file);
      result=result.replace(from,to);
    }
    if(sha(Buffer.from(result,'utf8'))!==spec.patched)throw Error('Patched SHA256 mismatch: '+spec.file);
    return {spec,file,state:'pending',original,result};
  });
  if(checkOnly){plan.forEach(p=>console.log(p.spec.file+': '+p.state));process.exit(0);}
  const pending=plan.filter(p=>p.state==='pending');
  const backupDir=path.join(dir,'client','.vmo-backups','v1.0.1');
  if(pending.length)fs.mkdirSync(backupDir,{recursive:true});
  for(const item of pending){
    const backup=path.join(backupDir,item.spec.file);
    if(!fs.existsSync(backup))fs.writeFileSync(backup,item.original,{flag:'wx'});
    else if(sha(fs.readFileSync(backup))!==item.spec.original)throw Error('Backup SHA256 mismatch: '+item.spec.file);
    const temp=item.file+'.vmo-tmp-'+process.pid;
    try{fs.writeFileSync(temp,item.result,'utf8');fs.renameSync(temp,item.file);}
    finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  for(const item of plan){
    if(sha(fs.readFileSync(item.file))!==item.spec.patched)throw Error('Post-write checksum mismatch: '+item.spec.file);
    console.log(item.spec.file+': '+(item.state==='pending'?'patched':'already fixed'));
  }
  console.log('[OK] SnowLuma v2.4.2 VMO Logo/background/debug-upload assets verified.');
}catch(error){
  console.error('[FAIL] SnowLuma VMO patch: '+error.message);
  process.exitCode=1;
}
