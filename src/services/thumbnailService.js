/**
 * Thumbnail Migration Service — backfill thumbnails for existing media
 *
 * Extracted from libraryService.js for module separation.
 * Consumers import directly from this file (not re-exported from libraryService).
 */

import log from '../utils/logger';
import { MEDIA_TYPES, updateLibraryItemAsync } from './libraryService';

// ── Image Loading ──

const loadImageForCanvas = (url) => {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          resolve({ img, cleanup: () => URL.revokeObjectURL(blobUrl) });
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          tryImgDirect();
        };
        img.src = blobUrl;
        return;
      }
    } catch (e) {
      /* fetch failed, try fallback */
    }

    tryImgDirect();
    function tryImgDirect() {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ img, cleanup: () => {} });
      img.onerror = () => reject(new Error('Could not load image (CORS)'));
      img.src = url;
    }
  });
};

// ── Constants ──

export const THUMB_VERSION = 5;
export const THUMB_MAX_SIZE = 800;
export const THUMB_QUALITY = 0.82;

// ── Image Thumbnail Migration ──

export const migrateThumbnails = async (db, artistId, libraryItems, uploadFileFn, onProgress) => {
  const images = (libraryItems || []).filter(
    (item) =>
      item.type === MEDIA_TYPES.IMAGE &&
      item.url &&
      (!item.thumbnailUrl || item.thumbVersion !== THUMB_VERSION),
  );

  if (images.length === 0) return { generated: 0, failed: 0 };

  log(
    `[ThumbnailMigration] Starting — ${images.length} images need thumbnails (v${THUMB_VERSION})`,
  );

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    try {
      const { img, cleanup } = await loadImageForCanvas(item.url);

      const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      cleanup();

      const thumbBlob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY),
      );
      if (!thumbBlob) throw new Error('Canvas toBlob returned null');

      const thumbFile = new File([thumbBlob], `thumb_${item.name}`, { type: 'image/jpeg' });
      const { url: thumbnailUrl } = await uploadFileFn(thumbFile, 'thumbnails');

      await updateLibraryItemAsync(db, artistId, item.id, {
        thumbnailUrl,
        thumbVersion: THUMB_VERSION,
      });

      generated++;
      if (generated % 20 === 0) log(`[ThumbnailMigration] ${generated}/${images.length} done`);
    } catch (err) {
      failed++;
      log.warn(`[ThumbnailMigration] ✗ ${item.name}:`, err.message);
    }

    if (onProgress) onProgress(i + 1, images.length, generated);
  }

  log(`[ThumbnailMigration] Complete: ${generated} generated, ${failed} failed`);
  return { generated, failed };
};

// ── Video Thumbnail Migration ──

export const migrateVideoThumbnails = async (
  db,
  artistId,
  libraryItems,
  uploadFileFn,
  onProgress,
) => {
  const videos = (libraryItems || []).filter(
    (item) =>
      item.type === MEDIA_TYPES.VIDEO &&
      item.url &&
      (!item.thumbnailUrl || item.thumbVersion !== THUMB_VERSION),
  );

  if (videos.length === 0) return { generated: 0, failed: 0 };

  log(`[VideoThumbMigration] Starting — ${videos.length} videos need thumbnails`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < videos.length; i++) {
    const item = videos[i];
    try {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'auto';

      let videoUrl = item.url;
      try {
        const response = await fetch(item.url, { mode: 'cors' });
        const blob = await response.blob();
        videoUrl = URL.createObjectURL(blob);
      } catch (fetchErr) {
        // Fallback to direct URL
      }

      video.src = videoUrl;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
        setTimeout(resolve, 8000);
      });

      const seekTime = Math.min(1, (video.duration || 2) * 0.25);
      video.currentTime = seekTime;
      await new Promise((resolve) => {
        video.onseeked = resolve;
        setTimeout(resolve, 3000);
      });

      const vw = video.videoWidth || 320;
      const vh = video.videoHeight || 180;
      const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(vw, vh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (videoUrl !== item.url) URL.revokeObjectURL(videoUrl);

      const thumbBlob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY),
      );
      if (!thumbBlob) throw new Error('Canvas toBlob returned null');

      const thumbFile = new File([thumbBlob], `thumb_${item.name}.jpg`, { type: 'image/jpeg' });
      const { url: thumbnailUrl } = await uploadFileFn(thumbFile, 'thumbnails');

      await updateLibraryItemAsync(db, artistId, item.id, {
        thumbnailUrl,
        thumbVersion: THUMB_VERSION,
      });

      generated++;
      log(`[VideoThumbMigration] ✓ ${i + 1}/${videos.length} — ${item.name}`);
    } catch (err) {
      failed++;
      log.warn(`[VideoThumbMigration] ✗ ${i + 1}/${videos.length} — ${item.name}:`, err.message);
    }

    if (onProgress) onProgress(i + 1, videos.length, generated);
  }

  log(`[VideoThumbMigration] Complete: ${generated} generated, ${failed} failed`);
  return { generated, failed };
};
