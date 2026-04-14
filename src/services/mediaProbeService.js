/**
 * mediaProbeService — read missing metadata (duration, dimensions) from
 * media files using the browser's native HTML5 media element.
 *
 * Used by AllMediaContent / VideoNicheContent to backfill the "Unknown
 * Duration" bucket: items that were imported without their duration field
 * set get probed in the background and the result is written back to the
 * library via updateLibraryItemAsync.
 *
 * The probe is fast (just metadata, no full download) and degrades
 * gracefully — if the file is offline, gone, or wrong codec, the probe
 * resolves null and the item stays in the unknown bucket.
 */

import log from '../utils/logger';
import { updateLibraryItemAsync } from './libraryService';

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v|ogv)(\?|$)/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|opus|flac)(\?|$)/i;

/**
 * Probe a single media file's duration via the browser's native metadata
 * loader. Resolves to a number (seconds) or null on failure/timeout.
 *
 * Notes:
 * - We do NOT set crossOrigin="anonymous". The metadata read works fine
 *   on Firebase Storage URLs without CORS preflights, and setting it was
 *   causing every Boon clip to silently fail in v1.7.5.
 * - 15s timeout (was 8s) — some HLS / large-mp4 metadata reads take a
 *   beat over slow connections.
 */
export function probeMediaDuration(url, { timeoutMs = 15000, isVideo = null } = {}) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    let detectedVideo = isVideo;
    if (detectedVideo === null) {
      if (VIDEO_EXT.test(url)) detectedVideo = true;
      else if (AUDIO_EXT.test(url)) detectedVideo = false;
      else detectedVideo = true; // default: assume video
    }
    let el;
    try {
      el = detectedVideo ? document.createElement('video') : document.createElement('audio');
    } catch {
      return resolve(null);
    }
    el.preload = 'metadata';
    el.muted = true;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try {
        el.removeAttribute('src');
        el.load();
      } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    el.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      const dur = el.duration;
      if (dur && isFinite(dur) && dur > 0) finish(dur);
      else finish(null);
    });
    el.addEventListener('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    try {
      el.src = url;
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Backfill missing duration fields for a list of library items.
 * Probes up to `concurrency` items at a time, writes results back via
 * updateLibraryItemAsync. Skips items with syncStatus='offline', items
 * already having a duration, and items with no playable URL.
 *
 * Returns a Promise<{ probed, updated, skipped }> for diagnostics.
 *
 * Designed to be called from a useEffect with the items list as a
 * dependency. The caller should gate against running on every render
 * (use a ref or stable id-set hash to detect when there's actually
 * something new to probe).
 */
export async function backfillMissingDurations(
  items,
  { db, artistId, concurrency = 3, onItemUpdated } = {},
) {
  if (!Array.isArray(items) || items.length === 0) {
    return { probed: 0, updated: 0, skipped: 0 };
  }

  const candidates = items.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (item.duration && isFinite(item.duration) && item.duration > 0) return false;
    if (item.syncStatus === 'offline') return false;
    if (item.type !== 'video' && item.type !== 'audio') return false;
    const url = item.localUrl || item.url;
    if (!url) return false;
    return true;
  });

  if (candidates.length === 0) {
    return { probed: 0, updated: 0, skipped: items.length };
  }

  // Use console.log directly so it shows up in DevTools without depending
  // on the logger's filter level. Helps the user verify the probe is
  // actually running when they crack open the inspector.
  console.log(
    `[mediaProbe] starting backfill for ${candidates.length} items (concurrency=${concurrency})`,
  );

  let probed = 0;
  let updated = 0;
  let failed = 0;
  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const url = item.localUrl || item.url;
      try {
        const duration = await probeMediaDuration(url, {
          isVideo: item.type === 'video',
        });
        probed++;
        if (duration && isFinite(duration) && duration > 0) {
          if (artistId) {
            try {
              await updateLibraryItemAsync(db, artistId, item.id, { duration });
              updated++;
              onItemUpdated?.(item.id, duration);
            } catch (err) {
              failed++;
              log.warn('[mediaProbe] persist failed for', item.id, err?.message || err);
            }
          } else {
            updated++;
            onItemUpdated?.(item.id, duration);
          }
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        log.warn('[mediaProbe] probe failed for', item.id, err?.message || err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, worker);
  await Promise.all(workers);

  console.log(
    `[mediaProbe] backfill done: ${updated} updated / ${probed} probed / ${failed} failed`,
  );
  return { probed, updated, failed, skipped: items.length - candidates.length };
}
