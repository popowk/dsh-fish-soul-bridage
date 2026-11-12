#!/usr/bin/env python3
"""Assemble full Windows bundle from pinned complete SnowLuma 2.4.2 and VMO overlay ZIPs."""
from pathlib import Path, PurePosixPath
import hashlib, json, shutil, subprocess, sys, zipfile

root=Path.cwd()
out=root/'dist'/'dsh-fish-soul-bridage'
snow=out/'components'/'snowluma'
sha=lambda x: hashlib.sha256(x).hexdigest()
old='3323d2c04fbf033ee83ae25162b0ee724e5c6a1f2eca7a80106bc13ee76beb9d'
css='82bf3cbd28ac8960a867bb62977b658e2e086d1027a4c90780cdb2f9b39b90a1'
final='57ecf95309bb83b577fd9efe84f401cd1d5d9deaa6306b3954330d2cbdf0dc21'
helper="""
// VMO overlay: keep dynamically loaded CSS under the same app prefix as this module.
// Do not rewrite global /assets or intercept fetch; that would mix tenants.
const __vmoRouteStyleTasks=new Map();
function __vmoRoutePreload(load,deps){
  if(typeof document==='undefined'||!Array.isArray(deps))return load();
  const styles=[];
  for(const dep of deps){
    if(typeof dep!=='string'||!/^assets\/[A-Za-z0-9_.-]+\.css$/.test(dep))continue;
    // From /apps/VMID/snowluma/assets/router...js to
    // /apps/VMID/snowluma/assets/overview-page...css, never /assets/...
    const href=new URL('./'+dep.slice(7),import.meta.url).href;
    let task=__vmoRouteStyleTasks.get(href);
    if(!task){
      const existing=Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .find(link=>link.href===href);
      if(existing){task=Promise.resolve();}
      else {
        task=new Promise((resolve,reject)=>{
          const link=document.createElement('link');
          link.rel='stylesheet';
          link.href=href;
          link.onload=()=>resolve();
          link.onerror=()=>{
            link.remove();
            __vmoRouteStyleTasks.delete(href);
            reject(new Error('Unable to preload CSS for '+href));
          };
          document.head.appendChild(link);
        });
      }
      __vmoRouteStyleTasks.set(href,task);
    }
    styles.push(task);
  }
  // Native import() fetches JS chunks from the router module's location.
  // Skipping speculative JS modulepreload is a small performance tradeoff
  // that avoids the Vite helper's root-relative resource URL behavior.
  return Promise.all(styles).then(()=>load());
}
"""
def unpack(zip_path, overlay=False):
    with zipfile.ZipFile(zip_path) as z:
        if z.testzip() is not None: raise RuntimeError('Corrupt ZIP')
        count=0
        total=0
        for info in z.infolist():
            if info.is_dir(): continue
            parts=PurePosixPath(info.filename.replace('\\','/')).parts
            if overlay:
                if not parts or parts[0]!='SnowLuma-v2.4.2-win-x64-BasePath-Overlay':
                    raise RuntimeError('Unexpected overlay layout')
                parts=parts[1:]
            if not parts or any(p in ('.','..') for p in parts):
                raise RuntimeError('Unsafe ZIP path')
            rel='/'.join(parts)
            if rel in ('launcher.bat','Start.cmd','Start.bat'): continue
            if not (rel in ('node.exe','index.mjs','release.json','package.json','check-node-version.cjs','PRIVACY.md')
                    or rel.startswith(('client/','native/'))): continue
            if overlay and rel not in ('index.mjs','client/index.html') and not rel.startswith('client/assets/'):
                continue
            if info.file_size>125000000: raise RuntimeError('Unexpected oversized member')
            total+=info.file_size
            if total>450000000: raise RuntimeError('Excessive unzip size')
            target=snow.joinpath(*parts)
            target.parent.mkdir(parents=True,exist_ok=True)
            with z.open(info) as inp,target.open('wb') as dest:
                shutil.copyfileobj(inp,dest,1<<20)
            count+=1
    return count
def main():
    if len(sys.argv)!=3:
        raise SystemExit('Usage: python scripts/Assemble-Windows.py complete.zip overlay.zip')
    if out.exists(): shutil.rmtree(out)
    tracked=subprocess.check_output(['git','ls-files','-z']).split(b'\0')
    for b in tracked:
        if not b: continue
        name=b.decode('utf-8')
        if name.startswith(('.git','tests/','dist/')): continue
        source=root/name
        if not source.is_file() or source.is_symlink(): continue
        target=out/name
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,target)
    count_base=unpack(Path(sys.argv[1]),False)
    count_overlay=unpack(Path(sys.argv[2]),True)
    if count_base<60 or count_overlay<4: raise RuntimeError('Incomplete SnowLuma archives')
    if json.loads((snow/'release.json').read_text('utf8'))['version']!='2.4.2':
        raise RuntimeError('SnowLuma version mismatch')
    for rel in ['node.exe','index.mjs','client/index.html','client/logo.png',
                'client/assets/overview-page-Bm3ks5zC.css',
                'native/snowluma-win32-x64.node','client/assets/router-_TYMdJui.vmo.js']:
        if not (snow/rel).is_file(): raise RuntimeError('Missing required asset: '+rel)
    router=snow/'client/assets/router-_TYMdJui.vmo.js'
    data=router.read_bytes()
    if sha(data)==old:
        text=data.decode('utf8')
        if text.count('function H(e)')!=1 or text.count('mt(()=>import(')!=6:
            raise RuntimeError('Unrecognized router markers')
        text=text.replace('function H(e)',helper+'function H(e)',1)
        text=text.replace('mt(()=>import(','__vmoRoutePreload(()=>import(')
        if sha(text.encode('utf8'))!=css: raise RuntimeError('CSS patch checksum mismatch')
        router.write_text(text,encoding='utf8')
    elif sha(data) not in (css,final):
        raise RuntimeError('Unknown router build')
    subprocess.run(['node',str(out/'scripts/Patch-SnowLuma-VMO.mjs'),str(snow)],check=True)
    if sha(router.read_bytes())!=final: raise RuntimeError('Final router checksum mismatch')
    for js in ['index-DolPqBYW.vmo.js','router-_TYMdJui.vmo.js','settings-page-C7mrOgzU.vmo.js']:
        subprocess.run(['node','--check',str(snow/'client/assets'/js)],check=True)
    for rel in ['Start.cmd','VERSION','components/gateway/deploy.ps1','components/ayu/bridge.mjs']:
        if not (out/rel).is_file(): raise RuntimeError('Missing combined project file: '+rel)
    for file in out.rglob('*'):
        if file.is_file() and file.name in ('.credentials.yaml','fish-soul-config.json','sessions.json'):
            raise RuntimeError('Secret-like user state must not be included')
    print('Assembled SnowLuma base',count_base,'overlay',count_overlay,'files; ready for Windows ZIP.')
if __name__=='__main__': main()
