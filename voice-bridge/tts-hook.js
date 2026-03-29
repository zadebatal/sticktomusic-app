/**
 * TTS Hook — runs after Claude Code finishes responding (Stop event)
 * Reads the response from stdin, checks if conversational, speaks via OpenAI TTS.
 *
 * Called by Claude Code hooks system. Receives JSON on stdin.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TTS_FILE = path.join(__dirname, '.temp-tts-hook.mp3');
const DEBUG_FILE = path.join(__dirname, '.tts-debug.json');
const TTS_LOCK = path.join(__dirname, '.tts-playing');

// Load env
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env.local'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
      for (const match of lines.map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean)) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'lUTamkMw7gOzZbFIwmq4';
const TTS_PROVIDER = process.env.TTS_PROVIDER || 'openai'; // 'openai' or 'elevenlabs'
const TTS_VOICE = process.env.TTS_VOICE || 'onyx';

if (TTS_PROVIDER === 'elevenlabs' && !ELEVENLABS_KEY) process.exit(0);
if (TTS_PROVIDER === 'openai' && !OPENAI_KEY) process.exit(0);

// Read stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(input);

    // Debug: write raw payload for inspection
    try {
      fs.writeFileSync(DEBUG_FILE, JSON.stringify(data, null, 2));
    } catch {}

    // Extract response text — try multiple possible formats
    let text = '';

    // Format 1: data.message.content (content blocks array or string)
    if (data.message?.content) {
      if (typeof data.message.content === 'string') {
        text = data.message.content;
      } else if (Array.isArray(data.message.content)) {
        text = data.message.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n');
      }
    }

    // Format 2: data.response (string or content blocks)
    if (!text && data.response) {
      if (typeof data.response === 'string') {
        text = data.response;
      } else if (Array.isArray(data.response)) {
        text = data.response
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n');
      }
    }

    // Format 3: data.content (string or content blocks)
    if (!text && data.content) {
      if (typeof data.content === 'string') {
        text = data.content;
      } else if (Array.isArray(data.content)) {
        text = data.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n');
      }
    }

    // Format 4: direct text fields
    if (!text && data.last_assistant_message) text = data.last_assistant_message;
    if (!text && data.assistant_message) text = data.assistant_message;
    if (!text && data.text) text = data.text;

    // Format 5: data.output (some versions use this)
    if (!text && data.output) text = typeof data.output === 'string' ? data.output : '';

    if (!text || text.length < 5) process.exit(0);

    // Conversational check
    if (!isConversational(text)) process.exit(0);

    // Truncate for TTS
    const ttsText = text.length > 600 ? text.substring(0, 600) + '...' : text;

    // Call TTS provider
    let res;
    if (TTS_PROVIDER === 'elevenlabs') {
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: ttsText,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });
    } else {
      res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: TTS_VOICE,
          input: ttsText,
          speed: 1.05,
        }),
      });
    }

    if (!res.ok) {
      process.exit(0);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(TTS_FILE, buffer);

    // Kill any TTS already playing
    try { spawn('killall', ['afplay'], { stdio: 'ignore' }); } catch {}
    await new Promise(r => setTimeout(r, 100));

    // Signal voice-bridge to mute mic during playback
    try { fs.writeFileSync(TTS_LOCK, String(Date.now())); } catch {}

    // Play audio
    await new Promise((resolve) => {
      const player = spawn('afplay', [TTS_FILE]);
      player.on('close', resolve);
    });

    // Remove lock so mic resumes
    try { fs.unlinkSync(TTS_LOCK); } catch {}
    try { fs.unlinkSync(TTS_FILE); } catch {}
  } catch {
    // Silent fail — don't break Claude Code
  }
  process.exit(0);
});

// Conversational detection — skip code-heavy responses
function isConversational(text) {
  const codePatterns = [
    /```/,
    /^\s*(import |export |const |let |var |function |class |if \(|for \(|while \()/m,
    /\.(jsx?|tsx?|css|json|py|rs|go)\b/,
    /^\s*[\-+] /m,
    /<\/?[a-z][a-z0-9]*[\s>]/i,
    /\{[\s\S]*:\s*[\s\S]*\}/,
    /=>/,
    /^\s*\|.*\|.*\|/m,
    /file_path|old_string|new_string/,
    /Build pass|Build clean|npm |npx /,
  ];

  for (const pattern of codePatterns) {
    if (pattern.test(text)) return false;
  }

  if (text.length > 800) return false;
  return true;
}
