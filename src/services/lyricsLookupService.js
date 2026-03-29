/**
 * Lyrics Lookup Service — Song recognition + synced lyrics fetching
 *
 * Flow: recognizeSong (AudD via proxy) → fetchSyncedLyrics (LRCLIB, free)
 *       → parseLRC → lrcToWordTimeline → same format as Whisper output
 */

import { getAuth } from 'firebase/auth';
import { extractAudioSnippet } from '../utils/audioSnippet';
import log from '../utils/logger';

const SONG_RECOGNIZE_URL = '/api/song-recognize';

/**
 * Recognize a song by sending a 15-second snippet to AudD via server proxy.
 * @param {File|Blob|string} audioSource - Audio file, blob, or HTTPS URL
 * @returns {{ found: boolean, artist?: string, title?: string, album?: string }}
 */
export async function recognizeSong(audioSource) {
  // Extract a 15-second snippet from the middle (seconds 10-25)
  const snippet = await extractAudioSnippet(audioSource, 10, 25);

  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not authenticated. Please sign in first.');

  const baseUrl =
    window.location.hostname === 'localhost' ? `http://localhost:${window.location.port}` : '';

  const response = await fetch(`${baseUrl}${SONG_RECOGNIZE_URL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: snippet,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Recognition failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch synced lyrics from LRCLIB (free, no API key needed).
 * @param {string} artist
 * @param {string} title
 * @returns {{ syncedLyrics: string|null, plainLyrics: string|null }} or null if not found
 */
export async function fetchSyncedLyrics(artist, title) {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
  });

  try {
    const response = await fetch(`https://lrclib.net/api/search?${params}`);
    if (!response.ok) {
      log.warn('LRCLIB search failed:', response.status);
      return null;
    }

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    // Prefer result with synced lyrics
    const withSynced = results.find((r) => r.syncedLyrics);
    if (withSynced) {
      return {
        syncedLyrics: withSynced.syncedLyrics,
        plainLyrics: withSynced.plainLyrics || null,
      };
    }

    // Fall back to plain lyrics
    const withPlain = results.find((r) => r.plainLyrics);
    if (withPlain) {
      return {
        syncedLyrics: null,
        plainLyrics: withPlain.plainLyrics,
      };
    }

    return null;
  } catch (err) {
    log.warn('LRCLIB fetch error:', err.message);
    return null;
  }
}

/**
 * Parse LRC format string into timestamped lines.
 * LRC format: [MM:SS.CS] Line text
 * @param {string} lrcString
 * @returns {{ lines: Array<{ startTime: number, text: string, endTime: number }> }}
 */
export function parseLRC(lrcString) {
  if (!lrcString) return { lines: [] };

  const lineRegex = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/;
  const rawLines = lrcString.split('\n');
  const parsed = [];

  for (const line of rawLines) {
    const match = line.trim().match(lineRegex);
    if (!match) continue;

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    // Handle both 2-digit (centiseconds) and 3-digit (milliseconds) formats
    const frac =
      match[3].length === 2 ? parseInt(match[3], 10) / 100 : parseInt(match[3], 10) / 1000;
    const startTime = minutes * 60 + seconds + frac;
    const text = match[4].trim();

    // Skip empty lines (instrumental sections)
    if (!text) continue;

    parsed.push({ startTime, text });
  }

  // Sort by time and compute endTime as start of next line
  parsed.sort((a, b) => a.startTime - b.startTime);
  const lines = parsed.map((line, i) => ({
    startTime: line.startTime,
    text: line.text,
    endTime: i < parsed.length - 1 ? parsed[i + 1].startTime : line.startTime + 5,
  }));

  return { lines };
}

/**
 * Convert line-level LRC timestamps to word-level format matching Whisper output.
 * Distributes time evenly across words within each line.
 *
 * @param {Array<{ startTime: number, text: string, endTime: number }>} lines
 * @param {number} fullDuration - Total audio duration in seconds
 * @returns {{ text: string, words: Array<{ id: string, text: string, startTime: number, duration: number }> }}
 */
export function lrcToWordTimeline(lines, fullDuration) {
  if (!lines || lines.length === 0) {
    return { text: '', words: [], lines: [] };
  }

  // Adjust last line endTime to full duration if available
  const adjustedLines = lines.map((line, i) => ({
    ...line,
    endTime:
      i === lines.length - 1 && fullDuration ? Math.min(line.endTime, fullDuration) : line.endTime,
  }));

  const allWords = [];
  const now = Date.now();

  for (const line of adjustedLines) {
    const words = line.text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;

    const lineDuration = Math.max(line.endTime - line.startTime, 0.1);
    const wordDuration = lineDuration / words.length;

    for (let i = 0; i < words.length; i++) {
      allWords.push({
        id: `word_${now}_${allWords.length}`,
        text: words[i],
        startTime: line.startTime + i * wordDuration,
        duration: wordDuration,
      });
    }
  }

  const text = allWords.map((w) => w.text).join(' ');
  return { text, words: allWords, lines: adjustedLines };
}
