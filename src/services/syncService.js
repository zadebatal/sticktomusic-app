/**
 * Sync Service — scan Firebase libraries and download media to local drive.
 *
 * Used by DesktopOnboarding (first launch) and SyncModal (Settings re-sync).
 * Performs delta sync: only downloads files not already on the local drive.
 */

import log from '../utils/logger';
import { getLibraryAsync } from './libraryService';

// Lazy — see localMediaService.js for rationale.
function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

/**
 * Map media type to folder name on drive.
 */
function typeToFolder(type) {
  if (type === 'video') return 'videos';
  if (type === 'audio') return 'audio';
  if (type === 'image') return 'images';
  return 'other';
}

/**
 * Sanitize artist name for filesystem paths.
 */
function safeName(name) {
  return (name || 'Unknown').replace(/[/\\:*?"<>|]/g, '_').trim();
}

/**
 * Scan all artists' libraries and compare with local drive.
 * Returns per-artist summary for the sync UI.
 *
 * @param {object} db - Firestore instance
 * @param {Array<{ id: string, name: string }>} artists - Artists to scan
 * @returns {Promise<Array<{ artistId, artistName, files, byType, totalSize, totalCount, localCount, needsSync }>>}
 */
export async function scanForSync(db, artists) {
  if (!isElectron()) return [];

  const results = [];

  for (const artist of artists) {
    const library = await getLibraryAsync(db, artist.id);
    // Only files with real Firebase URLs (not blob URLs or empty)
    const files = (library || []).filter(
      (item) => item.url && !item.url.startsWith('blob:') && item.name,
    );

    // Check which files already exist locally (try new flat path, then legacy)
    let localCount = 0;
    for (const file of files) {
      const newPath = `StickToMusic/${safeName(artist.name)}/media/${file.name}`;
      const legacyPath = `StickToMusic/${safeName(artist.name)}/${typeToFolder(file.type)}/${file.name}`;
      try {
        const exists =
          (await window.electronAPI.checkFileExists(newPath)) ||
          (await window.electronAPI.checkFileExists(legacyPath));
        if (exists) localCount++;
      } catch {
        // ignore check errors
      }
    }

    const totalSize = files.reduce((sum, f) => sum + (f.metadata?.fileSize || 0), 0);

    results.push({
      artistId: artist.id,
      artistName: artist.name,
      files,
      byType: {
        video: files.filter((f) => f.type === 'video').length,
        image: files.filter((f) => f.type === 'image').length,
        audio: files.filter((f) => f.type === 'audio').length,
      },
      totalSize,
      totalCount: files.length,
      localCount,
      needsSync: files.length - localCount,
    });
  }

  return results;
}

/**
 * Download missing files for one artist to the local drive.
 * Performs delta sync — skips files that already exist locally.
 *
 * @param {object} db - Firestore instance
 * @param {{ id: string, name: string }} artist
 * @param {(artistId: string, current: number, total: number, fileName: string) => void} onProgress
 * @returns {Promise<{ synced: number, failed: number, skipped: number }>}
 */
export async function syncArtistMedia(db, artist, onProgress) {
  if (!isElectron()) return { synced: 0, failed: 0, skipped: 0 };

  const library = await getLibraryAsync(db, artist.id);
  const files = (library || []).filter(
    (item) => item.url && !item.url.startsWith('blob:') && item.name,
  );

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const artistFolder = safeName(artist.name);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Save to new flat path
    const relativePath = `StickToMusic/${artistFolder}/media/${file.name}`;
    const legacyPath = `StickToMusic/${artistFolder}/${typeToFolder(file.type)}/${file.name}`;

    // Skip if already exists locally (check both paths)
    try {
      const exists =
        (await window.electronAPI.checkFileExists(relativePath)) ||
        (await window.electronAPI.checkFileExists(legacyPath));
      if (exists) {
        skipped++;
        onProgress?.(artist.id, i + 1, files.length, file.name);
        continue;
      }
    } catch {
      // continue with download attempt
    }

    try {
      // Download from Firebase Storage URL → save to new flat path
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      await window.electronAPI.saveFileLocally(arrayBuffer, relativePath);
      synced++;
    } catch (err) {
      log.warn(`[Sync] Failed: ${file.name} — ${err.message}`);
      failed++;
    }

    onProgress?.(artist.id, i + 1, files.length, file.name);
  }

  log(`[Sync] ${artist.name}: ${synced} synced, ${failed} failed, ${skipped} skipped`);
  return { synced, failed, skipped };
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}
