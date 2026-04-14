/**
 * autoClipService.js — Song Recognition + Auto-Clip Grouping
 *
 * Takes an array of source media (video/audio), runs song recognition
 * on each, groups them by detected song, and optionally creates niches
 * per song with clips auto-assigned to media banks.
 */

import log from '../utils/logger';
import { addMediaBank, assignToMediaBank, createNiche } from './libraryService';
import { recognizeSong } from './lyricsLookupService';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RecognitionResult
 * @property {string} mediaId - ID of the source media item
 * @property {string} mediaName - Name of the source file
 * @property {string} mediaUrl - URL for playback/recognition
 * @property {boolean} found - Whether a song was detected
 * @property {string} [artist] - Detected artist name
 * @property {string} [title] - Detected song title
 * @property {string} [album] - Detected album
 * @property {string} [error] - Error message if recognition failed
 */

/**
 * @typedef {Object} SongGroup
 * @property {string} key - Unique key (artist + title, lowercased)
 * @property {string} artist - Artist name
 * @property {string} title - Song title
 * @property {string[]} mediaIds - Media IDs in this group
 * @property {string[]} mediaNames - Filenames for display
 */

// ─── Recognition ────────────────────────────────────────────────────────────

/**
 * Run song recognition on multiple media items.
 * @param {Array<{ id: string, name: string, url: string, localUrl?: string }>} mediaItems
 * @param {Function} [onProgress] - Called with (completed, total, currentItem)
 * @returns {Promise<RecognitionResult[]>}
 */
export async function recognizeAll(mediaItems, onProgress) {
  const results = [];

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    const audioSource = item.localUrl || item.url;
    onProgress?.(i, mediaItems.length, item.name);

    try {
      if (!audioSource || audioSource.startsWith('blob:')) {
        results.push({
          mediaId: item.id,
          mediaName: item.name,
          mediaUrl: audioSource,
          found: false,
          error: 'No valid URL for recognition',
        });
        continue;
      }

      const result = await recognizeSong(audioSource);
      results.push({
        mediaId: item.id,
        mediaName: item.name,
        mediaUrl: audioSource,
        found: result.found,
        artist: result.artist || null,
        title: result.title || null,
        album: result.album || null,
      });
    } catch (err) {
      log.warn(`[AutoClip] Recognition failed for ${item.name}:`, err.message);
      results.push({
        mediaId: item.id,
        mediaName: item.name,
        mediaUrl: audioSource,
        found: false,
        error: err.message,
      });
    }
  }

  onProgress?.(mediaItems.length, mediaItems.length, null);
  return results;
}

// ─── Grouping ───────────────────────────────────────────────────────────────

/**
 * Group recognition results by detected song.
 * @param {RecognitionResult[]} results
 * @returns {{ groups: SongGroup[], unmatched: RecognitionResult[] }}
 */
export function groupBySong(results) {
  const songMap = new Map();
  const unmatched = [];

  for (const result of results) {
    if (!result.found || !result.artist || !result.title) {
      unmatched.push(result);
      continue;
    }

    const key = `${result.artist.toLowerCase().trim()}|${result.title.toLowerCase().trim()}`;

    if (!songMap.has(key)) {
      songMap.set(key, {
        key,
        artist: result.artist,
        title: result.title,
        mediaIds: [],
        mediaNames: [],
      });
    }

    const group = songMap.get(key);
    group.mediaIds.push(result.mediaId);
    group.mediaNames.push(result.mediaName);
  }

  return {
    groups: Array.from(songMap.values()),
    unmatched,
  };
}

// ─── Niche Creation ─────────────────────────────────────────────────────────

/**
 * Auto-create niches from song groups. Creates one video niche per song,
 * assigns clips to the niche's media banks.
 *
 * @param {string} artistId
 * @param {string} projectId - Parent project ID
 * @param {SongGroup[]} songGroups - From groupBySong()
 * @param {Object} [db] - Firestore instance for persistence
 * @returns {{ niches: Object[], assignments: Map<string, string[]> }}
 */
export function createNichesFromGroups(artistId, projectId, songGroups, db = null) {
  const niches = [];
  const assignments = new Map();

  for (const group of songGroups) {
    const nicheName = `${group.title} — ${group.artist}`;
    const format = { id: 'video', name: 'Video', contentType: 'video' };

    const niche = createNiche(artistId, { projectId, format, name: nicheName }, db);

    // Create a default media bank and assign clips
    const bankName = 'Clips';
    addMediaBank(artistId, niche.id, bankName, db);

    // Re-read the niche to get the bank ID
    const bankId = niche.mediaBanks?.[0]?.id || 'bank_0';
    if (group.mediaIds.length > 0) {
      assignToMediaBank(artistId, niche.id, group.mediaIds, bankId, db);
    }

    niches.push(niche);
    assignments.set(niche.id, group.mediaIds);

    log.info(`[AutoClip] Created niche "${nicheName}" with ${group.mediaIds.length} clips`);
  }

  return { niches, assignments };
}

// ─── Full Pipeline ──────────────────────────────────────────────────────────

/**
 * Full auto-clip pipeline: recognize → group → create niches.
 *
 * @param {string} artistId
 * @param {string} projectId
 * @param {Array<{ id: string, name: string, url: string, localUrl?: string }>} mediaItems
 * @param {Object} [db] - Firestore instance
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<{ results: RecognitionResult[], groups: SongGroup[], unmatched: RecognitionResult[], niches: Object[] }>}
 */
export async function autoClipPipeline(artistId, projectId, mediaItems, db = null, onProgress) {
  log.info(`[AutoClip] Starting pipeline: ${mediaItems.length} items`);

  // Step 1: Recognize all
  onProgress?.('recognizing', 0, mediaItems.length);
  const results = await recognizeAll(mediaItems, (done, total, name) => {
    onProgress?.('recognizing', done, total, name);
  });

  // Step 2: Group by song
  const { groups, unmatched } = groupBySong(results);
  log.info(`[AutoClip] ${groups.length} songs found, ${unmatched.length} unmatched`);

  // Step 3: Create niches
  onProgress?.('creating', groups.length, groups.length);
  const { niches } =
    groups.length > 0 ? createNichesFromGroups(artistId, projectId, groups, db) : { niches: [] };

  onProgress?.('done', groups.length, mediaItems.length);
  return { results, groups, unmatched, niches };
}
