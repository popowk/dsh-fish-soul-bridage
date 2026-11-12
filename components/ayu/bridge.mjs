import { createServer } from 'node:http';

/**
 * Ayu BreezeBlue bridge v1.4
 * dsh-fish-soul provides the BreezeBlue API key, model and voice for EACH request.
 * No local credentials, no DSH_HOME access, no configuration files.
 */
const PORT = Number(process.env.BRIDGE_PORT || '8765');
const MAX_CHARS = 60;
const MAX_BODY_BYTES = 8192;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_REQUESTS_PER_DAY = 30;
const UPSTREAM_TIMEOUT_MS = 17000;
const INSTRUCTIONS = '声音清亮自然，像元气满满的年轻女孩在和朋友聊天。语气灵动、亲切，开心时稍微雀跃，不要夸张做作。';

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error('Invalid BRIDGE_PORT (1024-65535).');
}

// This override exists ONLY for unit tests and only accepts a loopback address.
let upstreamBase = 'https://api.breeze.blue/v1';
if (process.env.BRIDGE_TEST_MODE === '1') {
  const url = new URL(process.env.BRIDGE_TEST_ORIGIN || 'http://127.0.0.1:9999/v1');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Test upstream must be on loopback.');
  }
  upstreamBase = url.href.replace(/\/+$/, '');
}

let requestDay = new Date().toISOString().slice(0, 10);
let dailyCount = 0;
let busy = false;

function json(res, code, obj) {
  if (res.headersSent) return;
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(obj));
}

function extractBreezeKey(req) {
  // dsh-fish-soul sends voice.ttsApiKey as Authorization: Bearer <key>.
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(brz_[A-Za-z0-9_\-]{4,250})$/i.exec(header.trim());
  return match ? match[1] : null;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Body too large'), { code: 413 });
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path === '/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, name: 'ayu-breezeblue-bridge', version: '1.4', credentialSource: 'fish-soul' });
  }
  if (path !== '/v1/audio/speech' || req.method !== 'POST') {
    return json(res, 404, { error: 'Not Found' });
  }

  const apiKey = extractBreezeKey(req);
  if (!apiKey) {
    return json(res, 401, { error: 'Set the BreezeBlue brz_ API key in dsh-fish-soul TTS API Key. No local key is used.' });
  }
  if (busy) return json(res, 429, { error: 'Speech request already running. Retry shortly.' });

  const today = new Date().toISOString().slice(0, 10);
  if (today !== requestDay) {
    requestDay = today;
    dailyCount = 0;
  }
  if (dailyCount >= MAX_REQUESTS_PER_DAY) {
    return json(res, 429, { error: 'Bridge daily limit reached (30 attempts).' });
  }

  let body;
  try { body = await readJson(req); }
  catch (error) { return json(res, error?.code || 400, { error: 'Invalid JSON or oversized request.' }); }

  const input = typeof body?.input === 'string' ? body.input.trim() : '';
  const characters = [...input].length;
  const model = body?.model;
  const voice = body?.voice;
  if (characters < 1 || characters > MAX_CHARS ||
      typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/.test(model) ||
      typeof voice !== 'string' || !/^voc_[A-Za-z0-9_-]{3,100}$/.test(voice)) {
    return json(res, 400, { error: 'Set a valid TTS model and voc_ voice in fish-soul. Text must be 1-60 characters.' });
  }
  if (body?.response_format && body.response_format !== 'mp3') {
    return json(res, 400, { error: 'Only response_format=mp3 is supported.' });
  }

  busy = true;
  dailyCount += 1;
  try {
    const url = `${upstreamBase}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3&delivery=sync`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'audio/mpeg',
        'user-agent': 'ayu-breezeblue-bridge/1.4',
      },
      body: JSON.stringify({
        text: input,
        model_id: model,
        language_code: 'zh',
        instructions: INSTRUCTIONS,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[upstream] BreezeBlue HTTP ${response.status}`);
      return json(res, 502, { error: `BreezeBlue HTTP ${response.status}; check TTS API key, credit, model and voice.` });
    }
    const hint = Number(response.headers.get('content-length') || 0);
    if (hint > MAX_AUDIO_BYTES) return json(res, 502, { error: 'Audio response too large.' });
    if (!response.body) return json(res, 502, { error: 'BreezeBlue returned an empty body.' });
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > MAX_AUDIO_BYTES) throw new Error('Audio response too large.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const validMp3 = bytes.subarray(0, 3).toString('latin1') === 'ID3' ||
      (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    if (!validMp3) return json(res, 502, { error: 'BreezeBlue did not return MP3 audio.' });
    res.writeHead(200, {
      'content-type': 'audio/mpeg',
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(bytes);
    console.log(`[tts] success model=${model} voice=${voice} chars=${characters} bytes=${bytes.length}`);
  } catch (error) {
    console.error(`[tts] failed: ${error?.name || 'Error'} (details suppressed)`);
    json(res, 502, { error: 'TTS request failed or timed out.' });
  } finally {
    busy = false;
  }
});
server.headersTimeout = 15000;
server.requestTimeout = 20000;
server.listen(PORT, '127.0.0.1', () => {
  console.log('====== Ayu BreezeBlue Bridge v1.4 ======');
  console.log(`Ready: http://127.0.0.1:${PORT}/v1`);
  console.log('Model, voice and API key are controlled by dsh-fish-soul.');
  console.log('No local keys or DSH directory are accessed.');
  console.log('Keep this window open; press Ctrl+C to stop.');
});
server.on('error', (err) => {
  console.error(`Could not start bridge: ${err.message}`);
  process.exitCode = 1;
});
