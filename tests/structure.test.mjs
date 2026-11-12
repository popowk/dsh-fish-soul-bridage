import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
test('single launcher and VERSION',async()=>{
 assert.equal((await readFile(join(root,'VERSION'),'utf8')).trim(),JSON.parse(await readFile(join(root,'package.json'),'utf8')).version);
 assert.match(await readFile(join(root,'Start.cmd'),'utf8'),/scripts\\Start-All.ps1/);
 const p=await readFile(join(root,'scripts','Start-All.ps1'),'utf8');
 assert.match(p,/Patch-SnowLuma-VMO.mjs/);assert.match(p,/Start-Ayu/);assert.match(p,/components\\gateway/);assert.match(p,/SNOWLUMA_DIR/);
 for(const dir of ['gateway','ayu','snowluma'])await access(join(root,'components',dir));
});
test('no old component startup scripts',async()=>{
 const paths=[join(root,'components','ayu'),join(root,'components','snowluma'),join(root,'components','gateway')];
 for(const p of paths){const files=await readdir(p);assert.equal(files.some(f=>/^Start\.(bat|cmd)$/i.test(f)||/^launcher\.bat$/i.test(f)),false);}
});
