/**
 * Voice Bridge for Claude Code
 *
 * Listens to your mic with VAD (voice activity detection),
 * transcribes speech with Whisper, types it into Claude Code's terminal,
 * and reads back conversational responses via TTS.
 *
 * Usage: node index.js
 *
 * Requires:
 *   - sox installed (brew install sox)
 *   - OPENAI_API_KEY in env or .env
 *   - Claude Code running in another terminal
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  // Wake word — only process speech that starts with this phrase
  wakeWord: 'hey computer',
  wakeAliases: ['hey computer', 'a computer', 'hey, computer', 'hay computer', 'hey comput', 'hey, comput', 'hey computa', 'hey compiter', 'hey komputer'],

  // VAD thresholds
  silenceThreshold: 0.01,      // RMS below this = silence
  speechThreshold: 0.015,      // RMS above this = speech started
  silenceDuration: 1.2,        // Seconds of silence before processing (end of utterance)
  minSpeechDuration: 0.5,      // Minimum speech duration to process (avoid clicks/bumps)
  maxRecordingDuration: 30,    // Max seconds per utterance

  // Audio
  sampleRate: 16000,
  channels: 1,

  // Paths
  tempAudio: path.join(__dirname, '.temp-recording.wav'),
  ttsLock: path.join(__dirname, '.tts-playing'),
};

// ── Load env ────────────────────────────────────────────────────────────────
function loadEnv() {
  // Check voice-bridge/.env first, then project root .env.local
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env'),
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
}
loadEnv();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── State ───────────────────────────────────────────────────────────────────
let isListening = false;
let isProcessing = false;
let isMuted = false;
let recording = null;
let audioChunks = [];
let speechStartTime = null;
let lastSpeechTime = null;
let silenceCheckInterval = null;
let awaitingCommand = false;       // true after wake word heard with no command
let awaitingCommandTimeout = null; // auto-cancel after 8s
let cooldownUntil = 0;             // timestamp — ignore mic until this time (TTS playback guard)

// ── Terminal colors ─────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

function log(msg) { console.log(`${c.dim}[voice]${c.reset} ${msg}`); }
function logSpeech(msg) { console.log(`${c.green}[speech]${c.reset} ${msg}`); }
// TTS is handled by the Claude Code Stop hook (tts-hook.js)

// ── VAD: Record with sox, analyze RMS for voice activity ────────────────────
function startListening() {
  if (isListening) return;
  isListening = true;
  audioChunks = [];
  speechStartTime = null;
  lastSpeechTime = null;

  log(`${c.cyan}Listening...${c.reset} (speak to Claude Code)`);

  // sox records raw PCM, we analyze in real-time for VAD
  recording = spawn('sox', [
    '-d',                    // default input device
    '-t', 'wav',             // output format
    '-r', String(CONFIG.sampleRate),
    '-c', String(CONFIG.channels),
    '-b', '16',              // 16-bit
    '-e', 'signed-integer',
    CONFIG.tempAudio,
    // sox silence detection as backup
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  // Also run a parallel sox process just for real-time RMS analysis
  const monitor = spawn('sox', [
    '-d',                    // default input device
    '-t', 'raw',
    '-r', String(CONFIG.sampleRate),
    '-c', '1',
    '-b', '16',
    '-e', 'signed-integer',
    '-',                     // pipe to stdout
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let isSpeaking = false;
  let speechBuffer = Buffer.alloc(0);

  monitor.stdout.on('data', (chunk) => {
    if (isProcessing || isMuted || isTTSPlaying() || Date.now() < cooldownUntil) return;

    // Calculate RMS of this chunk
    const samples = new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.length / 2));
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const normalized = samples[i] / 32768;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / samples.length);

    const now = Date.now();

    if (rms > CONFIG.speechThreshold) {
      if (!isSpeaking) {
        isSpeaking = true;
        speechStartTime = now;
        killTTS(); // Stop any playing TTS immediately
        log(`${c.yellow}Speech detected${c.reset} (RMS: ${rms.toFixed(4)})`);
      }
      lastSpeechTime = now;
    }

    if (isSpeaking) {
      speechBuffer = Buffer.concat([speechBuffer, chunk]);

      // Check for end of utterance (silence after speech)
      const silenceMs = now - (lastSpeechTime || now);
      const speechMs = now - (speechStartTime || now);

      if (silenceMs > CONFIG.silenceDuration * 1000 && speechMs > CONFIG.minSpeechDuration * 1000) {
        // End of utterance detected
        isSpeaking = false;
        const duration = speechMs / 1000;
        log(`${c.yellow}Utterance complete${c.reset} (${duration.toFixed(1)}s)`);

        // Stop the recorder, process the audio
        monitor.kill('SIGTERM');
        recording.kill('SIGTERM');
        isListening = false;
        processUtterance();
        return;
      }

      // Max duration guard
      if (speechMs > CONFIG.maxRecordingDuration * 1000) {
        isSpeaking = false;
        monitor.kill('SIGTERM');
        recording.kill('SIGTERM');
        isListening = false;
        log(`${c.yellow}Max duration reached${c.reset}`);
        processUtterance();
        return;
      }
    }
  });

  monitor.stderr.on('data', () => {}); // suppress sox stderr
  recording.stderr.on('data', () => {}); // suppress sox stderr

  monitor.on('error', (err) => {
    if (err.code !== 'ABORT_ERR') log(`${c.red}Monitor error: ${err.message}${c.reset}`);
  });
  recording.on('error', (err) => {
    if (err.code !== 'ABORT_ERR') log(`${c.red}Recording error: ${err.message}${c.reset}`);
  });
}

// ── Process recorded utterance ──────────────────────────────────────────────
async function processUtterance() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Wait a moment for the file to be written
    await sleep(300);

    if (!fs.existsSync(CONFIG.tempAudio)) {
      log(`${c.red}No audio file found${c.reset}`);
      isProcessing = false;
      startListening();
      return;
    }

    const stats = fs.statSync(CONFIG.tempAudio);
    if (stats.size < 5000) {
      log(`${c.dim}Audio too short, skipping${c.reset}`);
      cleanup();
      isProcessing = false;
      startListening();
      return;
    }

    // Transcribe with Whisper
    log('Transcribing...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(CONFIG.tempAudio),
      model: 'whisper-1',
      language: 'en',
    });

    const text = transcription.text?.trim();
    if (!text || text.length < 2) {
      log(`${c.dim}Empty transcription, skipping${c.reset}`);
      cleanup();
      isProcessing = false;
      startListening();
      return;
    }

    logSpeech(`"${text}"`);

    // If we're awaiting a command (wake word was said previously), use this utterance as the command
    if (awaitingCommand) {
      awaitingCommand = false;
      if (awaitingCommandTimeout) { clearTimeout(awaitingCommandTimeout); awaitingCommandTimeout = null; }

      let command = text.trim();
      if (!command || command.length < 2) {
        log(`${c.dim}Empty command, ignoring${c.reset}`);
        cleanup();
        isProcessing = false;
        startListening();
        return;
      }

      // Strip wake word if they repeated it
      const lowerCmd = command.toLowerCase();
      for (const w of CONFIG.wakeAliases) {
        if (lowerCmd.startsWith(w)) {
          command = command.substring(w.length).replace(/^[\s,.:;!?]+/, '').trim();
          break;
        }
      }

      if (!command) {
        log(`${c.dim}Wake word only again, still waiting...${c.reset}`);
        awaitingCommand = true;
        awaitingCommandTimeout = setTimeout(() => { awaitingCommand = false; log(`${c.dim}Command wait timed out${c.reset}`); }, 8000);
        cleanup();
        isProcessing = false;
        startListening();
        return;
      }

      command = command.charAt(0).toUpperCase() + command.slice(1);
      log(`${c.cyan}Command: "${command}"${c.reset}`);
      await typeIntoClaude(command);
      // Cooldown: ignore mic for 15s to let Claude respond + TTS play
      cooldownUntil = Date.now() + 15000;
      log(`${c.dim}Cooldown 15s (waiting for response + TTS)${c.reset}`);
      cleanup();
      isProcessing = false;
      startListening();
      return;
    }

    // Wake word check — find it anywhere in the transcription
    const lower = text.toLowerCase();
    let wakeIndex = -1;
    let matchedWake = null;
    for (const w of CONFIG.wakeAliases) {
      const idx = lower.indexOf(w);
      if (idx !== -1 && (wakeIndex === -1 || idx < wakeIndex)) {
        wakeIndex = idx;
        matchedWake = w;
      }
    }
    if (wakeIndex === -1) {
      log(`${c.dim}No wake word, ignoring${c.reset}`);
      cleanup();
      isProcessing = false;
      startListening();
      return;
    }

    // Extract everything after the wake word
    let command = text.substring(wakeIndex + matchedWake.length).replace(/^[\s,.:;!?]+/, '').trim();
    if (!command) {
      // Wake word only — enter awaiting mode, play a chime sound
      log(`${c.magenta}Wake word heard! Listening for command...${c.reset}`);
      awaitingCommand = true;
      awaitingCommandTimeout = setTimeout(() => {
        awaitingCommand = false;
        log(`${c.dim}Command wait timed out${c.reset}`);
      }, 8000);
      // Play a quick chime so user knows they were heard
      spawn('afplay', ['/System/Library/Sounds/Tink.aiff'], { stdio: 'ignore' });
      cleanup();
      isProcessing = false;
      startListening();
      return;
    }

    // Capitalize first letter
    command = command.charAt(0).toUpperCase() + command.slice(1);
    log(`${c.cyan}Command: "${command}"${c.reset}`);

    // Send to Claude Code via TRON voice server
    await typeIntoClaude(command);

    // Cooldown: ignore mic for 15s to let Claude respond + TTS play
    cooldownUntil = Date.now() + 15000;
    log(`${c.dim}Cooldown 15s (waiting for response + TTS)${c.reset}`);

  } catch (err) {
    log(`${c.red}Error: ${err.message}${c.reset}`);
  }

  cleanup();
  isProcessing = false;
  startListening();
}

// ── Send text to Claude Code's terminal via TRON's voice input server ───────
const TRON_VOICE_PORT = process.env.TRON_VOICE_PORT || '7799';
const TRON_TARGET_TAB = parseInt(process.env.VOICE_TARGET_TAB || '0'); // 0 = Main Shell

async function typeIntoClaude(text) {
  try {
    // Step 1: Type the text into the input box
    const res = await fetch(`http://127.0.0.1:${TRON_VOICE_PORT}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabIndex: TRON_TARGET_TAB, text }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      log(`${c.red}TRON rejected: ${err.error || res.status}${c.reset}`);
      return;
    }

    // Step 2: Send carriage return separately to submit
    await sleep(100);
    await fetch(`http://127.0.0.1:${TRON_VOICE_PORT}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabIndex: TRON_TARGET_TAB, text: '\r' }),
    });

    log(`${c.green}Sent to Claude Code (tab ${TRON_TARGET_TAB})${c.reset}`);
  } catch (err) {
    log(`${c.red}Could not reach TRON (port ${TRON_VOICE_PORT}): ${err.message}${c.reset}`);
    log(`${c.dim}Make sure TRON Terminal is running${c.reset}`);
  }
}

// ── TTS is handled by Claude Code hook (voice-bridge/tts-hook.js) ───────────
// No need to monitor terminal output — the hook fires after each response.

// ── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function killTTS() {
  try {
    spawn('killall', ['afplay'], { stdio: 'ignore' });
    // Also remove lock file since we're killing TTS
    if (fs.existsSync(CONFIG.ttsLock)) fs.unlinkSync(CONFIG.ttsLock);
  } catch {}
}

function isTTSPlaying() {
  try { return fs.existsSync(CONFIG.ttsLock); } catch { return false; }
}

function cleanup() {
  try {
    if (fs.existsSync(CONFIG.tempAudio)) fs.unlinkSync(CONFIG.tempAudio);
  } catch {}
}

// ── Keyboard controls ───────────────────────────────────────────────────────
function setupKeyboard() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key) => {
      // Ctrl+C = quit
      if (key === '\u0003') {
        log('Shutting down...');
        cleanup();
        process.exit(0);
      }

      // 'm' = toggle mute
      if (key === 'm') {
        isMuted = !isMuted;
        log(isMuted ? `${c.red}MUTED${c.reset} (press m to unmute)` : `${c.green}UNMUTED${c.reset} — listening`);
      }

      // 'q' = quit
      if (key === 'q') {
        log('Shutting down...');
        cleanup();
        process.exit(0);
      }
    });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log(`
${c.bold}${c.cyan}Voice Bridge for Claude Code${c.reset}
${c.dim}────────────────────────────${c.reset}
${c.dim}Wake word:${c.reset} ${c.yellow}"Hey Computer"${c.reset} + your command
${c.dim}Example:${c.reset}  "Hey Computer, the waveform in the solo clip editor is bugged"

${c.dim}Controls:${c.reset}
  ${c.yellow}m${c.reset} = mute/unmute mic
  ${c.yellow}q${c.reset} = quit
  ${c.yellow}Ctrl+C${c.reset} = quit

${c.dim}Input:${c.reset}  TRON voice server (port ${TRON_VOICE_PORT}) → tab ${TRON_TARGET_TAB}
${c.dim}Output:${c.reset} Claude Code Stop hook → TTS (${process.env.TTS_VOICE || 'nova'})
${c.dim}VAD:${c.reset}    Always listening — only processes speech after wake word
`);

if (!process.env.OPENAI_API_KEY) {
  console.error(`${c.red}Error: OPENAI_API_KEY not found${c.reset}`);
  console.error(`Set it in voice-bridge/.env or export it in your shell`);
  process.exit(1);
}

setupKeyboard();
startListening();

// Cleanup on exit
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
