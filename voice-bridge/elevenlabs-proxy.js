/**
 * ElevenLabs TTS Proxy — OpenAI-compatible endpoint
 *
 * Accepts requests in OpenAI /v1/audio/speech format,
 * translates to ElevenLabs API, returns audio.
 *
 * Usage: node elevenlabs-proxy.js
 * Then set VOICEMODE_TTS_BASE_URLS=http://127.0.0.1:8891/v1
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env
const envPaths = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env.local'),
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'kmSVBPu7loj4ayNinwWM';
const PORT = parseInt(process.env.ELEVENLABS_PROXY_PORT || '8891');

if (!ELEVENLABS_KEY) {
  console.error('ELEVENLABS_API_KEY not set in .env');
  process.exit(1);
}

// Always fetch PCM from ElevenLabs, return as WAV with proper headers
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function createWavHeader(dataSize) {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // OpenAI-compatible /v1/audio/speech endpoint
  if (req.method === 'POST' && req.url === '/v1/audio/speech') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const text = data.input || '';
        const speed = data.speed || 1.0;

        console.log(`[proxy] TTS request: "${text.substring(0, 50)}..."`);

        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No input text provided' }));
          return;
        }

        // Call ElevenLabs — always get PCM, we wrap in WAV
        const elUrl = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=pcm_24000`;
        const elRes = await fetch(elUrl, {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              speed,
            },
          }),
        });

        if (!elRes.ok) {
          const err = await elRes.text();
          console.error(`[proxy] ElevenLabs error ${elRes.status}: ${err}`);
          res.writeHead(elRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `ElevenLabs: ${err}` }));
          return;
        }

        // Stream raw PCM back — voicemode expects 24kHz 16-bit mono
        console.log(`[proxy] ElevenLabs OK, streaming raw PCM 24kHz`);

        res.writeHead(200, { 'Content-Type': 'audio/pcm' });

        const reader = elRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (err) {
        console.error('[proxy] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', provider: 'elevenlabs', voice_id: VOICE_ID }));
    return;
  }

  // Catch-all for unknown routes (log them for debugging)
  console.log(`[proxy] Unknown request: ${req.method} ${req.url}`);
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] ElevenLabs TTS proxy on http://127.0.0.1:${PORT}`);
  console.log(`[proxy] Voice: ${VOICE_ID}`);
});
