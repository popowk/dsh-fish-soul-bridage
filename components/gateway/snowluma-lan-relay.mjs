/**
 * An extra *scoped* LAN socket for the SnowLuma WebUI.
 * SnowLuma itself stays on 127.0.0.1, and the public VMO domain continues to
 * go through the authenticated Guest Agent relay. Do not bind it to host.tmd.pet
 * (a DNS name outside this VM) or use 0.0.0.0 to approximate an allowlist.
 */
import net,{isIP} from 'node:net';
import {ipv4,isPrivateIPv4} from './lan-access.mjs';

export function allowedPeer(remote,allow='192.168.2.99'){
 return ipv4(remote)===allow && isIP(allow)===4;
}
export function startSnowLumaLanRelay({listenIP,port,allowPeer='192.168.2.99'}){
 if(!isPrivateIPv4(listenIP)||listenIP==='127.0.0.1'||listenIP===allowPeer)
  throw Error('Invalid SnowLuma LAN binding: requires this VM private IPv4');
 if(isIP(allowPeer)!==4||allowPeer!=='192.168.2.99')
  throw Error('SnowLuma allowed management peer must be 192.168.2.99');
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid SnowLuma LAN relay port');
 const sockets=new Set();
 const server=net.createServer({allowHalfOpen:false},client=>{
  sockets.add(client);client.on('close',()=>sockets.delete(client));
  if(!allowedPeer(client.remoteAddress,allowPeer)){client.destroy();return;}
  const backend=net.connect({host:'127.0.0.1',port});
  sockets.add(backend);backend.on('close',()=>sockets.delete(backend));
  backend.on('connect',()=>{client.pipe(backend);backend.pipe(client);});
  backend.on('error',()=>client.destroy());
  client.on('error',()=>backend.destroy());
  client.on('close',()=>backend.destroy());
 });
 const shutdown=async()=>{
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>server.close(resolve));
 };
 return new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen({host:listenIP,port,exclusive:true},()=>{
   server.off('error',reject);
   server.on('error',()=>{}); // Prevent an asynchronous listener error from crashing SnowLuma.
   resolve({server,shutdown,listenIP,port,allowPeer});
  });
 });
}
