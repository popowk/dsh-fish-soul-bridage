import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bridge.mjs');
const fakeMp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0x55]);
const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(() => resolve(p)); });
  socket.on('error', reject);
});
const upstreamPort = await freePort();
let lastRequest = null;
const upstream = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  lastRequest = { url: req.url, key: req.headers['xi-api-key'], body: JSON.parse(raw) };
  res.writeHead(200, { 'content-type': 'audio/mpeg' });
  res.end(fakeMp3);
});
await new Promise(resolve => upstream.listen(upstreamPort, '127.0.0.1', resolve));
const bridgePort = await freePort();
const child = spawn(process.execPath, [bridge], {
  env: {
    PATH: process.env.PATH,
    BRIDGE_TEST_MODE: '1',
    BRIDGE_TEST_ORIGIN: `http://127.0.0.1:${upstreamPort}/v1`,
    BRIDGE_PORT: String(bridgePort),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
child.stdout.on('data', c => stdout += c.toString());
child.stderr.on('data', c => stdout += c.toString());
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 60));
    try {
      const res = await fetch(`http://127.0.0.1:${bridgePort}/health`);
      if (res.ok) { ready = true; break; }
    } catch {}
  }
  assert.ok(ready, `Bridge did not start: ${stdout}`);
  const body = (voice, model, input='阿鱼你好') => JSON.stringify({model,voice,input,response_format:'mp3'});
  const post = (key, reqbody) => fetch(`http://127.0.0.1:${bridgePort}/v1/audio/speech`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: reqbody,
  });
  assert.equal((await post('sk_old_local_token', body('voc_rm489h83rcvs', 'breeze-tts-2'))).status, 401);
  assert.equal((await post('brz_liveABC123', body('voc_rm489h83rcvs', 'breeze-tts-2', ''))).status, 400);
  const first = await post('brz_firstKey123', body('voc_rm489h83rcvs', 'breeze-tts-2'));
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal(Buffer.compare(Buffer.from(await first.arrayBuffer()), fakeMp3), 0);
  assert.equal(lastRequest.key, 'brz_firstKey123');
  assert.equal(lastRequest.body.text, '阿鱼你好');
  assert.equal(lastRequest.body.model_id, 'breeze-tts-2');
  assert.ok(lastRequest.url.includes('/text-to-speech/voc_rm489h83rcvs?'));
  const second = await post('brz_secondKey456', body('voc_ANOTHER123', 'breeze-tts-3'));
  assert.equal(second.status, 200);
  assert.equal(lastRequest.key, 'brz_secondKey456');
  assert.equal(lastRequest.body.model_id, 'breeze-tts-3');
  assert.ok(lastRequest.url.includes('/text-to-speech/voc_ANOTHER123?'));
  assert.ok(!stdout.includes('brz_firstKey123'));
  assert.ok(!stdout.includes('brz_secondKey456'));
  console.log('PASS: no local config; fish-soul key/model/voice dynamically forwarded; invalid key rejected; MP3 returned; keys not logged.');
} finally {
  child.kill('SIGTERM');
  upstream.close();
}
