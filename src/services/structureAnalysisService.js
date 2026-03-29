/**
 * Song Structure Analysis Service
 *
 * Sends Whisper transcript data to /api/analyze-structure which uses Claude Haiku
 * to identify song sections (verse, chorus, bridge, etc.) with time ranges.
 */

import { getAuth } from 'firebase/auth';

const API_URL = '/api/analyze-structure';

/**
 * Analyze song structure from a Whisper transcription.
 *
 * @param {{ text: string, words: Array<{ text: string, startTime: number, duration: number }> }} transcription
 * @param {number} totalDuration - Total audio duration in seconds
 * @param {Function} onProgress - Optional progress callback
 * @param {string|null} publishedLyrics - Published lyrics with section headers (optional)
 * @returns {Promise<{ sections: Array, confidence: number }>}
 */
export async function analyzeSongStructure(
  transcription,
  totalDuration,
  onProgress,
  publishedLyrics = null,
) {
  if (!transcription?.text || !transcription?.words?.length) {
    throw new Error('No transcription data to analyze');
  }

  onProgress?.('Analyzing song structure...');

  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not authenticated. Please sign in first.');

  const body = {
    transcript: transcription.text,
    words: transcription.words,
    totalDuration,
  };
  if (publishedLyrics) body.publishedLyrics = publishedLyrics;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Structure analysis failed: ${response.status}`);
  }

  const data = await response.json();
  onProgress?.(`Found ${data.sections?.length || 0} sections`);
  return data;
}
