/**
 * mediaSearchService.js — Client-side wrapper for CLIP semantic media search.
 * Calls Electron IPC for indexing and searching. No-ops gracefully in web browser.
 */

import log from '../utils/logger';

/**
 * Check if semantic search is available (Electron desktop only).
 */
export function isSearchAvailable() {
  return !!window.electronAPI?.clipSearch;
}

/**
 * Index a media item for semantic search (background, non-blocking).
 * Call this after uploading/ripping media.
 * @param {string} artistId
 * @param {Object} mediaItem — { id, type, name, url, localUrl, localPath, duration, collectionIds }
 */
export async function indexMedia(artistId, mediaItem) {
  if (!isSearchAvailable()) return null;
  if (!mediaItem || !artistId) return null;
  if (mediaItem.type !== 'video' && mediaItem.type !== 'image') return null;

  try {
    const result = await window.electronAPI.clipIndexMedia(artistId, {
      id: mediaItem.id,
      type: mediaItem.type,
      name: mediaItem.name || '',
      url: mediaItem.url,
      localUrl: mediaItem.localUrl,
      localPath: mediaItem.localPath,
      duration: mediaItem.duration || null,
      collectionIds: mediaItem.collectionIds || [],
    });
    if (result.status === 'indexed') {
      log(`[Search] Indexed "${mediaItem.name || mediaItem.id}" (total: ${result.totalIndexed})`);
    }
    return result;
  } catch (err) {
    // Surface the failure with full context so triage can identify which item
    // and which artist failed. Caller still gets a structured error object so
    // it can decide whether to mark the item as `searchIndexed: false` and
    // retry later. Returning `null` (the previous behavior) silently swallowed
    // CLIP service outages — newly added videos would be visible in the
    // library but invisible to search with no observable warning.
    log.error(
      `[Search] Index failed for "${mediaItem.name || mediaItem.id}" (artist=${artistId}):`,
      err.message,
    );
    return { status: 'failed', error: err.message, mediaId: mediaItem.id };
  }
}

/**
 * Search media semantically by text query.
 * @param {string} artistId
 * @param {string} query — natural language search (e.g., "dance moves")
 * @param {Object} [options]
 * @param {string[]} [options.collectionIds] — scope to specific collections
 * @param {number} [options.limit=50] — max results
 * @returns {Promise<Array<{ mediaId, score, name, type, duration }>>}
 */
export async function searchMedia(artistId, query, options = {}) {
  if (!isSearchAvailable()) return [];
  if (!query || !query.trim() || !artistId) return [];

  try {
    const results = await window.electronAPI.clipSearch(artistId, query.trim(), {
      collectionIds: options.collectionIds || undefined,
      limit: options.limit || 50,
    });
    return results;
  } catch (err) {
    log.warn('[Search] Search failed:', err.message);
    return [];
  }
}

/**
 * Get index stats for an artist.
 * @returns {Promise<{ totalIndexed, types: { video, image } }>}
 */
export async function getIndexStats(artistId) {
  if (!isSearchAvailable()) return { totalIndexed: 0, types: { video: 0, image: 0 } };
  try {
    return await window.electronAPI.clipIndexStatus(artistId);
  } catch {
    return { totalIndexed: 0, types: { video: 0, image: 0 } };
  }
}

/**
 * Reindex all unindexed media for an artist (background).
 * @param {string} artistId
 * @param {Object[]} mediaItems — full media library items
 * @param {Function} [onProgress] — callback({ indexed, skipped, total })
 */
export async function reindexAll(artistId, mediaItems, onProgress) {
  if (!isSearchAvailable()) return;

  // Filter to only video/image items
  const indexable = mediaItems.filter((m) => m.type === 'video' || m.type === 'image');

  if (onProgress && window.electronAPI.onClipReindexProgress) {
    window.electronAPI.onClipReindexProgress(onProgress);
  }

  try {
    return await window.electronAPI.clipReindexAll(artistId, indexable);
  } catch (err) {
    log.warn('[Search] Reindex failed:', err.message);
    return null;
  }
}
