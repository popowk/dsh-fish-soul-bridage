// DSH FishSoul v6.9.14: guarded JSON/YAML pnpm virtualStoreDir alias repair.
// Only modifies node_modules/.modules.yaml when the old and new store paths
// are confirmed by native realpath to refer to the SAME physical directory.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const [, , mode, transactionPath] = process.argv;
const fail = (s) => { console.error(s); process.exit(2); };
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const normalize = (s) => path.win32.normalize(s).replace(/\\+$/,'').toLowerCase();
const native = (s) => normalize(fs.realpathSync.native(s));
const local = process.env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData','Local');
const backupDir = path.win32.join(local,'DSH-FishSoul-Gateway','backups');
function doApply() {
  if (process.platform !== 'win32') fail('Windows-only safety repair');
  const user = process.env.USERPROFILE;
  if (!user) fail('USERPROFILE not found');
  const oldStore = path.win32.join(user,'.dsh','profiles','desktop','node_modules','.pnpm');
  const newStore = 'C:\\dsh\\.dsh\\profiles\\desktop\\node_modules\\.pnpm';
  const oldModulesDir = path.win32.dirname(oldStore);
  const newModulesDir = path.win32.dirname(newStore);
  const metaPath = path.win32.join(newModulesDir,'.modules.yaml');
  try {
    if (!fs.statSync(oldStore).isDirectory() || !fs.statSync(newStore).isDirectory()) fail('A virtual store directory is missing');
    if (native(oldStore) !== native(newStore)) fail('Two .pnpm paths are DIFFERENT directories; refusing to modify metadata');
    if (native(oldModulesDir) !== native(newModulesDir)) fail('Two node_modules paths are DIFFERENT directories');
  } catch (e) { fail('Path identity verification failed: '+e.message); }
  if (!fs.existsSync(metaPath)) fail('pnpm metadata .modules.yaml is missing at '+metaPath);
  let raw = fs.readFileSync(metaPath);
  // Keep original newline encoding and other metadata intact.
  const text = raw.toString('utf8');
  // pnpm metadata is YAML, but recent DSH builds write this file using
  // JSON-compatible YAML syntax: "virtualStoreDir": "C:\\...\\.pnpm".
  // Support BOTH formats, preserving surrounding bytes and formatting.
  const jsonField = /^([ \t]*"virtualStoreDir"[ \t]*:[ \t]*)("(?:\\.|[^"\\])*")/m.exec(text);
  const yamlField = /^([ \t]*virtualStoreDir[ \t]*:[ \t]*)([^\r\n]*)/m.exec(text);
  const match = jsonField || yamlField;
  if (!match) fail('virtualStoreDir not found in '+metaPath+' (JSON/YAML detection failed); refusing edit');
  let recorded;
  try {
    if (jsonField) recorded = JSON.parse(match[2]);
    else recorded = match[2].trim().replace(/^['"]|['"]$/g,'').replace(/\\\\/g,'\\');
  } catch(e) { fail('Cannot parse virtualStoreDir: '+e.message); }
  if (typeof recorded !== 'string' || !recorded) fail('virtualStoreDir is empty or invalid');
  if (!path.win32.isAbsolute(recorded)) {
    recorded = path.win32.resolve(newModulesDir, recorded);
  }
  try {
    if (native(recorded) !== native(newStore)) fail('Recorded virtualStoreDir points elsewhere; refusing to change');
  } catch (e) { fail('Metadata store identity check failed: '+e.message); }
  if (normalize(recorded) === normalize(newStore)) {
    console.log(JSON.stringify({action:'already-compatible'})); return;
  }
  // Preserve existing format. For JSON-in-YAML, escape backslashes with
  // JSON.stringify; for plain YAML, quote forward slash path as a scalar.
  const newScalar = jsonField ? JSON.stringify(newStore) : "'"+newStore.replace(/\\/g,'/')+"'";
  const updated = text.slice(0,match.index) + match[1] + newScalar + text.slice(match.index+match[0].length);
  fs.mkdirSync(backupDir,{recursive:true});
  const id = crypto.randomBytes(8).toString('hex');
  const backup = path.win32.join(backupDir,`pnpm-metadata-v6914-${id}.bak`);
  const transaction = path.win32.join(backupDir,`pnpm-metadata-v6914-${id}.json`);
  fs.writeFileSync(backup,raw,{flag:'wx'});
  const obj={schema:1,file:metaPath,backup,originalHash:hash(raw),patchedHash:hash(Buffer.from(updated,'utf8'))};
  fs.writeFileSync(transaction,JSON.stringify(obj,null,2),{flag:'wx'});
  try {
    fs.writeFileSync(metaPath,updated,'utf8');
    if (hash(fs.readFileSync(metaPath))!==obj.patchedHash) throw new Error('verification mismatch');
    console.log(JSON.stringify({action:'patched',transaction}));
  } catch(e) {
    fs.writeFileSync(metaPath,raw);
    fail('Metadata edit failed and was restored: '+e.message);
  }
}
function doEnd(rollback){
  if (!transactionPath || !fs.existsSync(transactionPath)) fail('Transaction file missing');
  const obj=JSON.parse(fs.readFileSync(transactionPath,'utf8'));
  if(obj.schema!==1 || !obj.file || !obj.backup || !obj.patchedHash) fail('Invalid transaction schema');
  const fileNow=fs.readFileSync(obj.file);
  if(rollback){
    if(hash(fileNow)===obj.patchedHash){
      const original=fs.readFileSync(obj.backup);
      if(hash(original)!==obj.originalHash) fail('Backup hash mismatch; not restoring');
      fs.writeFileSync(obj.file,original);
      console.log(JSON.stringify({action:'restored'}));
    } else {
      // pnpm might have written its own metadata: do not overwrite changes.
      console.log(JSON.stringify({action:'not-restored-modified-by-another-process'}));
    }
  } else console.log(JSON.stringify({action:'kept-current-metadata',backup:obj.backup}));
  fs.unlinkSync(transactionPath);
}
if (mode==='apply') doApply();
else if (mode==='rollback') doEnd(true);
else if (mode==='commit') doEnd(false);
else fail('Usage: node pnpm-store-alias.mjs apply|rollback <transaction.json>');
