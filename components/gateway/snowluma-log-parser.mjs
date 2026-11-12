/**
 * Parse SnowLuma's one-time bootstrap WebUI password from real launch output.
 * Never log or persist raw lines; the caller keeps the result in memory.
 * No credential can be recovered if SnowLuma does not emit one at this boot.
 */
const ANSI_ESCAPE=/\x1b\[[0-9;]*[A-Za-z]/g;
const BOOTSTRAP_PATTERNS=[
  /initial credentials:\s*user=\S+\s+password=([^\s]+)/i,
  /(?:临时密码|初始密码)\s*[:：]\s*([^\s]+)/i,
];
export function parseBootstrapPassword(line){
  const clean=String(line||'').replace(ANSI_ESCAPE,'');
  for(const pattern of BOOTSTRAP_PATTERNS){
    const match=pattern.exec(clean);
    if(!match)continue;
    const value=match[1];
    if(!value || value.length>512 || /[\x00-\x1f\x7f]/.test(value) || /^\*+$/.test(value))return null;
    return value;
  }
  return null;
}
