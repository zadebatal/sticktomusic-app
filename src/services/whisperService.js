/**
 * Whisper API Service - Transcribes audio and returns word-level timestamps
 * Uses OpenAI's Whisper API for accurate lyric detection
 *
 * BUG-011: Now uses a server-side proxy (/api/transcribe) by default so the
 * OpenAI API key never reaches the browser. Falls back to direct OpenAI calls
 * only when a personal key is explicitly provided.
 *
 * IMPORTANT: By default, returns words in GLOBAL time (full audio timeline).
 * Pass trimStart/trimEnd options to get words in LOCAL time (normalized to trim range).
 */

import { normalizeWordsToTrimRange } from '../utils/timelineNormalization';
import { getAuth } from 'firebase/auth';

// Server-side proxy (keeps API key secure)
const PROXY_URL = '/api/transcribe';
// Direct API (only used with personal keys)
const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Transcribe audio file and get word-level timestamps.
 *
 * When apiKey is 'team' or falsy, routes through the server proxy
 * which injects the API key server-side. When a personal key is
 * provided, calls OpenAI directly (for backwards compatibility).
 *
 * @param {File|string} audioFileOrUrl - Audio file or URL to transcribe
 * @param {string|null} apiKey - 'team' for proxy, or a personal OpenAI key
 * @param {Function} onProgress - Progress callback
 * @param {Object} options - Optional settings
 * @param {number} options.trimStart - Trim start in seconds (for LOCAL time output)
 * @param {number} options.trimEnd - Trim end in seconds (for LOCAL time output)
 * @returns {Object} - { text, words, language, duration, isTrimmed }
 */
export async function transcribeAudio(audioFileOrUrl, apiKey, onProgress, options = {}) {
  const useProxy = !apiKey || apiKey === 'team';
  if (!useProxy && !apiKey) throw new Error('OpenAI API key is required');
  if (!audioFileOrUrl) throw new Error('Audio file or URL is required');

  const { trimStart = 0, trimEnd = null } = options;
  const isTrimmed = trimStart > 0 || trimEnd !== null;

  onProgress?.('Preparing audio file...');

  // Handle URL input - fetch and convert to File
  let audioFile = audioFileOrUrl;
  if (typeof audioFileOrUrl === 'string') {
    // Reject blob URLs - they expire and can't be fetched reliably
    if (audioFileOrUrl.startsWith('blob:')) {
      throw new Error('Blob URLs are not supported. Please use a direct file upload or a valid HTTP URL.');
    }

    // Must be an HTTP/HTTPS URL
    if (!audioFileOrUrl.startsWith('http://') && !audioFileOrUrl.startsWith('https://')) {
      throw new Error('Invalid audio source. Expected a File object or HTTP URL.');
    }

    onProgress?.('Fetching audio from URL...');
    try {
      const response = await fetch(audioFileOrUrl);
      if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
      const blob = await response.blob();

      // Validate we got actual content
      if (blob.size === 0) {
        throw new Error('Fetched audio is empty');
      }

      // Extract filename from URL or use default
      const filename = audioFileOrUrl.split('/').pop()?.split('?')[0] || 'audio.mp3';
      audioFile = new File([blob], filename, { type: blob.type || 'audio/mpeg' });
    } catch (err) {
      throw new Error(`Failed to fetch audio from URL: ${err.message}`);
    }
  }

  // Validate we have a proper File object
  if (!(audioFile instanceof File) && !(audioFile instanceof Blob)) {
    throw new Error('Invalid audio: expected a File or Blob object');
  }

  if (audioFile.size === 0) {
    throw new Error('Audio file is empty');
  }

  const formData = new FormData();
  formData.append('file', audioFile);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  onProgress?.('Uploading to Whisper API...');

  let response;
  if (useProxy) {
    // BUG-011: Route through server proxy — API key stays server-side
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Not authenticated. Please sign in first.');

    response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${idToken}` },
      body: formData,
    });
  } else {
    // Direct call with personal key (backwards compatible)
    response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || error.error || `API error: ${response.status}`);
  }

  onProgress?.('Processing transcription...');

  const data = await response.json();

  // Transform to our word format (GLOBAL time from API)
  const globalWords = (data.words || []).map((word, index) => ({
    id: `word_${Date.now()}_${index}`,
    text: word.word.trim(),
    startTime: word.start,
    duration: word.end - word.start,
  }));

  // If trim boundaries provided, normalize to LOCAL time
  let words = globalWords;
  let text = data.text;
  let effectiveDuration = data.duration;

  if (isTrimmed) {
    words = normalizeWordsToTrimRange(globalWords, trimStart, trimEnd, { inputInMs: false });
    text = words.map(w => w.text).join(' ');
    effectiveDuration = (trimEnd || data.duration) - trimStart;
    onProgress?.(`Filtered to ${words.length} words in trim range`);
  }

  return {
    text,
    words,
    language: data.language,
    duration: effectiveDuration,
    fullDuration: data.duration,
    isTrimmed
  };
}

export function getStoredApiKey() {
  try { return localStorage.getItem('openai_api_key'); } catch { return null; }
}

export function storeApiKey(apiKey) {
  try { localStorage.setItem('openai_api_key', apiKey); } catch {}
}

export async function validateApiKey(apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok;
  } catch { return false; }
}
