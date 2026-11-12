/**
 * Strict LAN request admission. The public listener is bound to ONE configured
 * private IPv4 address, never a wildcard. A separate loopback listener remains
 * available. Do not trust X-Forwarded-For or Origin to identify clients.
 */
import {isIP} from 'node:net';

export function ipv4(value){
  const x=String(value||'');
  const candidate=x.startsWith('::ffff:')?x.slice(7):x;
  return isIP(candidate)===4?candidate:null;
}
function numberOf(ip){return ip.split('.').reduce((v,p)=>(v*256+Number(p))>>>0,0);}
export function isPrivateIPv4(ip){
  const s=ipv4(ip);if(!s)return false;
  const n=s.split('.').map(Number);
  return n[0]===10 || (n[0]===172&&n[1]>=16&&n[1]<=31) || (n[0]===192&&n[1]===168);
}
export function parseCidr(text){
  const s=String(text||'').trim();const match=/^([0-9.]+)\/(\d{1,2})$/.exec(s);
  if(!match||!ipv4(match[1]))throw Error('Invalid IPv4 CIDR: '+s);
  const prefix=Number(match[2]);
  if(prefix<16||prefix>32)throw Error('Client CIDR prefix must be /16 through /32: '+s);
  const mask=prefix===0?0:((0xffffffff << (32-prefix))>>>0);
  const network=(numberOf(match[1])&mask)>>>0;
  // Ensure the whole allowed range stays inside RFC1918 ranges.
  const first=[network>>>24,(network>>>16)&255,(network>>>8)&255,network&255].join('.');
  const end=(network|(~mask>>>0))>>>0;
  const last=[end>>>24,(end>>>16)&255,(end>>>8)&255,end&255].join('.');
  if(!isPrivateIPv4(first)||!isPrivateIPv4(last))throw Error('Client CIDR must be private RFC1918: '+s);
  return {input:s,network,mask,prefix};
}
export function contains(range,ip){const s=ipv4(ip);return !!s&&((numberOf(s)&range.mask)>>>0)===range.network;}
export function createLanAccess({port,lanIp='',allowedCidrs=''}){
  const bind=String(lanIp||'').trim();const enabled=!!bind;
  if(enabled&&!isPrivateIPv4(bind))throw Error('FS_LAN_BIND_IP must be a single RFC1918 private IPv4 address (no wildcard)');
  const raw=Array.isArray(allowedCidrs)?allowedCidrs:String(allowedCidrs||'').split(',');
  const ranges=raw.map(s=>String(s).trim()).filter(Boolean).map(parseCidr);
  if(enabled&&!ranges.length)throw Error('FS_LAN_ALLOWED_CIDRS is required for LAN mode');
  if(!enabled&&ranges.length)throw Error('Client CIDRs set without a LAN bind IP');
  const portText=String(port);
  function isLoopback(req){return ipv4(req.socket?.localAddress)==='127.0.0.1'&&ipv4(req.socket?.remoteAddress)==='127.0.0.1';}
  function allowsClient(req){
    if(isLoopback(req))return true;
    if(!enabled||ipv4(req.socket?.localAddress)!==bind)return false;
    return ranges.some(r=>contains(r,req.socket?.remoteAddress));
  }
  function hostAuthority(req){
    const host=String(req.headers?.host||'').toLowerCase();
    if(isLoopback(req)&&[ `127.0.0.1:${portText}`,`localhost:${portText}`].includes(host))return host;
    if(enabled&&ipv4(req.socket?.localAddress)===bind&&host===`${bind}:${portText}`)return host;
    return null;
  }
  function validHost(req){return !!hostAuthority(req);}
  function validOrigin(req){
    const authority=hostAuthority(req);
    if(!authority)return false;
    try{
      const incoming = new URL(String(req.headers?.origin||''));
      if(incoming.origin===`http://${authority}`)return true;
      // Browser requests through the authenticated VMO application relay
      // carry the console Origin, not 127.0.0.1:56781. Trust only an exact,
      // administrator-configured console origin. Never trust X-Forwarded-Host
      // or accept arbitrary wildcard origins or hosts.
      const candidates=String(process.env.FS_VMO_PROXY_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
      for(const value of candidates){
        let expected;
        try {expected=new URL(value);} catch {continue;}
        if(!['http:','https:'].includes(expected.protocol) || expected.username || expected.password || expected.pathname!=='/' || expected.search || expected.hash)continue;
        // This feature is limited to the configured VMO management server;
        // the source IP is separately restricted by allowsClient(req).
        if(!((expected.hostname==='192.168.2.99')||(expected.hostname==='host.tmd.pet'&&expected.protocol==='https:'&&expected.port==='')))continue;
        if(incoming.origin===expected.origin)return true;
      }
      return false;
    }catch{return false;}
  }
  return {enabled,bind,ranges:ranges.map(r=>r.input),allowsClient,validHost,validOrigin};
}
