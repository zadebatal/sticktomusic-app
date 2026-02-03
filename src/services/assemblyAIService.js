/**
 * AssemblyAI Service - Transcribes audio with word-level timestamps
 * Supports files up to 5GB - much better for full songs!
 *
 * IMPORTANT: By default, returns words in GLOBAL time (full audio timeline).
 * Pass trimStart/trimEnd options to get words in LOCAL time (normalized to trim range).
 *
 * @example
 * // Full audio (GLOBAL time):
 * const result = await transcribeAudio(file, apiKey);
 *
 * // Trimmed audio (LOCAL time, 0 = trimStart):
 * const result = await transcribeAudio(file, apiKey, onProgress, { trimStart: 30, trimEnd: 50 });
 */

import { normalizeWordsToTrimRange } from '../utils/timelineNormalization';

const UPLOAD_URL = 'https://api.assemblyai.com/v2/upload';
const TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';

/**
 * Upload audio file to AssemblyAI
 */
async function uploadAudio(audioFile, apiKey, onProgress) {
  onProgress?.('Uploading audio file...');

  const response = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: audioFile,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Upload failed: ${response.status}`);
  }

  const data = await response.json();
  return data.upload_url;
}

/**
 * Submit transcription request
 */
async function submitTranscription(audioUrl, apiKey) {
  const response = await fetch(TRANSCRIPT_URL, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      // Enable word-level timestamps
      word_boost: [],
      punctuate: true,
      format_text: true,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Transcription request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Poll for transcription completion
 */
async function pollTranscription(transcriptId, apiKey, onProgress) {
  const pollUrl = `${TRANSCRIPT_URL}/${transcriptId}`;

  while (true) {
    const response = await fetch(pollUrl, {
      headers: { 'Authorization': apiKey },
    });

    if (!response.ok) {
      throw new Error(`Polling failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'completed') {
      return data;
    } else if (data.status === 'error') {
      throw new Error(data.error || 'Transcription failed');
    }

    onProgress?.(`Processing... (${data.status})`);

    // Wait 2 seconds before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/**
 * Main transcription function
 * @param {File|string} audioFileOrUrl - File object or public URL string
 * @param {string} apiKey - AssemblyAI API key
 * @param {Function} onProgress - Progress callback
 * @param {Object} options - Optional settings
 * @param {number} options.trimStart - Trim start in seconds (for LOCAL time output)
 * @param {number} options.trimEnd - Trim end in seconds (for LOCAL time output)
 * @returns {Object} - { text, words, confidence, duration, isTrimmed }
 */
export async function transcribeAudio(audioFileOrUrl, apiKey, onProgress, options = {}) {
  if (!apiKey) throw new Error('AssemblyAI API key is required');
  if (!audioFileOrUrl) throw new Error('Audio file or URL is required');

  const { trimStart = 0, trimEnd = null } = options;
  const isTrimmed = trimStart > 0 || trimEnd !== null;

  let audioUrl;

  // Check if input is a URL string or a File object
  if (typeof audioFileOrUrl === 'string') {
    // It's a URL - use directly (AssemblyAI fetches server-side, avoids CORS)
    audioUrl = audioFileOrUrl;
    onProgress?.('Using audio URL directly...');
  } else {
    // It's a File - upload first
    audioUrl = await uploadAudio(audioFileOrUrl, apiKey, onProgress);
    onProgress?.('Audio uploaded, starting transcription...');
  }

  // Step 2: Submit transcription
  const transcript = await submitTranscription(audioUrl, apiKey);
  onProgress?.('Transcription queued, processing...');

  // Step 3: Poll for completion
  const result = await pollTranscription(transcript.id, apiKey, onProgress);
  onProgress?.('Transcription complete!');

  // Transform to our word format (GLOBAL time from API)
  const globalWords = (result.words || []).map((word, index) => ({
    id: `word_${Date.now()}_${index}`,
    text: word.text,
    start: word.start,  // Keep in ms for normalization
    end: word.end,
    startTime: word.start / 1000, // Also provide seconds
    duration: (word.end - word.start) / 1000,
  }));

  // If trim boundaries provided, normalize to LOCAL time
  let words = globalWords;
  let text = result.text;
  let effectiveDuration = result.audio_duration;

  if (isTrimmed) {
    // Use the normalization utility - it expects ms input with inputInMs option
    words = normalizeWordsToTrimRange(globalWords, trimStart, trimEnd, { inputInMs: false });

    // Rebuild text from filtered words
    text = words.map(w => w.text).join(' ');

    // Calculate trimmed duration
    effectiveDuration = (trimEnd || result.audio_duration) - trimStart;

    onProgress?.(`Filtered to ${words.length} words in trim range`);
  }

  return {
    text,
    words,
    confidence: result.confidence,
    duration: effectiveDuration,
    fullDuration: result.audio_duration,
    isTrimmed,
  };
}

export function getStoredApiKey() {
  try { return localStorage.getItem('assemblyai_api_key'); } catch { return null; }
}

export function storeApiKey(apiKey) {
  try { localStorage.setItem('assemblyai_api_key', apiKey); } catch {}
}

export async function validateApiKey(apiKey) {
  try {
    // AssemblyAI doesn't have a dedicated validation endpoint,
    // so we just check if the key format looks valid
    return apiKey && apiKey.length > 20;
  } catch { return false; }
}
