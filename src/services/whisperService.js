/**
 * Whisper API Service - Transcribes audio and returns word-level timestamps
 * Uses OpenAI's Whisper API for accurate lyric detection
 *
 * IMPORTANT: By default, returns words in GLOBAL time (full audio timeline).
 * Pass trimStart/trimEnd options to get words in LOCAL time (normalized to trim range).
 */

import { normalizeWordsToTrimRange } from '../utils/timelineNormalization';

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Transcribe audio file and get word-level timestamps
 * @param {File} audioFile - Audio file to transcribe
 * @param {string} apiKey - OpenAI API key
 * @param {Function} onProgress - Progress callback
 * @param {Object} options - Optional settings
 * @param {number} options.trimStart - Trim start in seconds (for LOCAL time output)
 * @param {number} options.trimEnd - Trim end in seconds (for LOCAL time output)
 * @returns {Object} - { text, words, language, duration, isTrimmed }
 */
export async function transcribeAudio(audioFile, apiKey, onProgress, options = {}) {
  if (!apiKey) throw new Error('OpenAI API key is required');
  if (!audioFile) throw new Error('Audio file is required');

  const { trimStart = 0, trimEnd = null } = options;
  const isTrimmed = trimStart > 0 || trimEnd !== null;

  onProgress?.('Preparing audio file...');

  const formData = new FormData();
  formData.append('file', audioFile);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  onProgress?.('Uploading to Whisper API...');

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API error: ${response.status}`);
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
