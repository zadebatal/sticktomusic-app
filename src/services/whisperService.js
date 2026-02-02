/**
 * Whisper API Service - Transcribes audio and returns word-level timestamps
 * Uses OpenAI's Whisper API for accurate lyric detection
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Transcribe audio file and get word-level timestamps
 */
export async function transcribeAudio(audioFile, apiKey, onProgress) {
  if (!apiKey) throw new Error('OpenAI API key is required');
  if (!audioFile) throw new Error('Audio file is required');

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

  const words = (data.words || []).map((word, index) => ({
    id: `word_${Date.now()}_${index}`,
    text: word.word.trim(),
    startTime: word.start,
    duration: word.end - word.start,
  }));

  return { text: data.text, words, language: data.language, duration: data.duration };
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
