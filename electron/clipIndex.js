/**
 * clipIndex.js — Local vector index for CLIP embeddings.
 * Stores embeddings as JSON per artist in the local media folder.
 * Supports scoped search by collectionIds (project/niche filtering).
 *
 * Index file: {mediaFolder}/{artistId}/clip-index.json
 * Format: Array of { mediaId, vector, collectionIds, type, name, duration, indexedAt }
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const clip = require('./clip');

// In-memory cache: artistId → { entries: [], dirty: false }
const indexCache = new Map();

/**
 * Get the index file path for an artist.
 */
function getIndexPath(artistId) {
  const dataDir = path.join(app.getPath('userData'), 'clip-indexes');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, `${artistId}.json`);
}

/**
 * Load index from disk into memory cache.
 */
function loadIndex(artistId) {
  if (indexCache.has(artistId)) return indexCache.get(artistId);

  const indexPath = getIndexPath(artistId);
  let entries = [];
  try {
    if (fs.existsSync(indexPath)) {
      entries = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('[clipIndex] Failed to load index:', err.message);
    entries = [];
  }

  const index = { entries, dirty: false };
  indexCache.set(artistId, index);
  return index;
}

/**
 * Save index to disk (only if dirty).
 */
function saveIndex(artistId) {
  const index = indexCache.get(artistId);
  if (!index || !index.dirty) return;

  const indexPath = getIndexPath(artistId);
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index.entries), 'utf-8');
    index.dirty = false;
  } catch (err) {
    console.warn('[clipIndex] Failed to save index:', err.message);
  }
}

/**
 * Add or update an entry in the index.
 */
function addToIndex(artistId, entry) {
  const index = loadIndex(artistId);

  // Replace existing entry for same mediaId
  const existingIdx = index.entries.findIndex((e) => e.mediaId === entry.mediaId);
  if (existingIdx >= 0) {
    index.entries[existingIdx] = entry;
  } else {
    index.entries.push(entry);
  }

  index.dirty = true;
  saveIndex(artistId);
  return index.entries.length;
}

/**
 * Remove an entry from the index.
 */
function removeFromIndex(artistId, mediaId) {
  const index = loadIndex(artistId);
  const before = index.entries.length;
  index.entries = index.entries.filter((e) => e.mediaId !== mediaId);
  if (index.entries.length < before) {
    index.dirty = true;
    saveIndex(artistId);
  }
}

/**
 * Search the index using a pre-computed query vector.
 * @param {string} artistId
 * @param {number[]} queryVector — 512-d unit vector from clip.encodeText()
 * @param {Object} options
 * @param {string[]} [options.collectionIds] — filter to specific collections (project/niche scope)
 * @param {number} [options.limit=50] — max results
 * @param {number} [options.threshold=0.15] — minimum similarity score
 * @returns {Array<{ mediaId, score, name, type, duration }>}
 */
function searchIndex(artistId, queryVector, options = {}) {
  const { collectionIds, limit = 50, threshold = 0.15 } = options;
  const index = loadIndex(artistId);

  let entries = index.entries;

  // Scope filter: only entries that belong to at least one of the requested collections
  if (collectionIds && collectionIds.length > 0) {
    const scopeSet = new Set(collectionIds);
    entries = entries.filter(
      (e) => e.collectionIds && e.collectionIds.some((id) => scopeSet.has(id)),
    );
  }

  // Score and rank
  const results = entries
    .map((entry) => ({
      mediaId: entry.mediaId,
      score: clip.cosineSimilarity(queryVector, entry.vector),
      name: entry.name,
      type: entry.type,
      duration: entry.duration,
    }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

/**
 * Get index stats for an artist.
 */
function getStats(artistId) {
  const index = loadIndex(artistId);
  return {
    totalIndexed: index.entries.length,
    types: {
      video: index.entries.filter((e) => e.type === 'video').length,
      image: index.entries.filter((e) => e.type === 'image').length,
    },
  };
}

/**
 * Check if a media item is already indexed.
 */
function isIndexed(artistId, mediaId) {
  const index = loadIndex(artistId);
  return index.entries.some((e) => e.mediaId === mediaId);
}

module.exports = { addToIndex, removeFromIndex, searchIndex, getStats, isIndexed, loadIndex };
