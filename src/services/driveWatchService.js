/**
 * driveWatchService.js — Local media drive watcher
 *
 * Watches local media folders (via Electron's fs.watch bridge) for new files
 * dropped in via Finder and provides the React layer with change notifications.
 *
 * Safe to import in non-Electron contexts (web app) — all calls no-op gracefully.
 *
 * API:
 *   startDriveWatch(mediaFolder, artistNames)  — begin watching artist subfolders
 *   stopDriveWatch()                           — tear down all watchers
 *   onNewFileDetected(cb)                      — register a callback
 *   offNewFileDetected(cb)                     — unregister a callback
 */

import log from '../utils/logger';

// ── Media extension sets ──

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.aif', '.aiff'];
const IMAGE_EXTS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.bmp',
  '.svg',
];

const ALL_MEDIA_EXTS = new Set([...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS]);

// ── Module state ──

let _callbacks = [];
const _debouncers = new Map(); // filename -> timeoutId
let _removeListener = null; // cleanup fn returned by onFileChanged
let _watching = false;

// ── Helpers ──

/**
 * Return the lowercase file extension including the dot, e.g. '.mp4'.
 * Returns '' for files with no extension.
 */
function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) return '';
  return filename.slice(dot).toLowerCase();
}

/**
 * Determine the media folder type from a file extension.
 * Returns 'video' | 'audio' | 'image' | null.
 */
function mediaTypeFromExt(ext) {
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  return null;
}

/**
 * Parse a full file path to extract the artist name, subfolder, and filename
 * relative to the media root.
 *
 * Expected folder structure:
 *   <mediaFolder>/<artistName>/videos/clip.mp4
 *   <mediaFolder>/<artistName>/audio/track.wav
 *   <mediaFolder>/<artistName>/images/photo.png
 *
 * Returns null if the path doesn't match the expected structure.
 */
function parseFilePath(fullPath, mediaFolder) {
  // Normalise separators and ensure mediaFolder ends without a slash
  const normPath = fullPath.replace(/\\/g, '/');
  const normRoot = mediaFolder.replace(/\\/g, '/').replace(/\/+$/, '');

  if (!normPath.startsWith(normRoot + '/')) return null;

  const relative = normPath.slice(normRoot.length + 1); // e.g. "ArtistName/videos/clip.mp4"
  const parts = relative.split('/');
  if (parts.length < 2) return null;

  const artistName = parts[0];
  const folder = parts.slice(1, -1).join('/'); // e.g. "videos" or nested
  const filename = parts[parts.length - 1];

  return { artistName, folder, filename, fullPath };
}

// ── Public API ──

/**
 * Start watching artist subfolders under `mediaFolder` for new media files.
 *
 * @param {string} mediaFolder  Root folder path, e.g. "/Volumes/Media/STM"
 * @param {string[]} artistNames  Array of artist folder names to watch
 */
export function startDriveWatch(mediaFolder, artistNames) {
  if (typeof window === 'undefined' || !window.electronAPI) {
    log.info('[DriveWatch] No electronAPI available — skipping watch setup');
    return;
  }

  if (_watching) {
    log.info('[DriveWatch] Already watching — call stopDriveWatch() first');
    return;
  }

  const { startWatching, onFileChanged } = window.electronAPI;

  if (typeof startWatching !== 'function' || typeof onFileChanged !== 'function') {
    log.warn('[DriveWatch] electronAPI missing startWatching or onFileChanged');
    return;
  }

  log('[DriveWatch] Starting watch for', artistNames.length, 'artists under', mediaFolder);

  // Start a watcher for each artist subfolder
  for (const name of artistNames) {
    const folderPath = `${mediaFolder.replace(/\/+$/, '')}/${name}`;
    try {
      startWatching(folderPath);
      log('[DriveWatch] Watching:', folderPath);
    } catch (err) {
      log.error('[DriveWatch] Failed to watch', folderPath, err);
    }
  }

  // Register the unified change listener
  _removeListener = onFileChanged((eventType, filePath) => {
    // fs.watch on macOS fires 'rename' for both create and delete
    if (eventType !== 'rename') return;

    const filename = filePath.split('/').pop() || '';

    // Skip hidden files
    if (filename.startsWith('.')) return;

    // Skip non-media files
    const ext = getExt(filename);
    if (!ALL_MEDIA_EXTS.has(ext)) return;

    // Parse out artist/folder info
    const parsed = parseFilePath(filePath, mediaFolder);
    if (!parsed) return;

    // Debounce — fs.watch often fires 2-3 times per file save
    const debounceKey = filePath;
    if (_debouncers.has(debounceKey)) {
      clearTimeout(_debouncers.get(debounceKey));
    }

    _debouncers.set(
      debounceKey,
      setTimeout(() => {
        _debouncers.delete(debounceKey);

        const mediaType = mediaTypeFromExt(ext);
        const info = {
          artistName: parsed.artistName,
          folder: parsed.folder,
          filename: parsed.filename,
          fullPath: parsed.fullPath,
          mediaType,
        };

        log('[DriveWatch] New file detected:', info);

        for (const cb of _callbacks) {
          try {
            cb(info);
          } catch (err) {
            log.error('[DriveWatch] Callback error:', err);
          }
        }
      }, 500),
    );
  });

  _watching = true;
}

/**
 * Stop all drive watchers and clean up.
 */
export function stopDriveWatch() {
  if (!_watching) return;

  log('[DriveWatch] Stopping all watchers');

  // Clear pending debounce timers
  for (const timerId of _debouncers.values()) {
    clearTimeout(timerId);
  }
  _debouncers.clear();

  // Remove the file-changed listener
  if (typeof _removeListener === 'function') {
    _removeListener();
    _removeListener = null;
  }

  _watching = false;
}

/**
 * Register a callback for new file detections.
 * The callback receives: { artistName, folder, filename, fullPath, mediaType }
 *
 * @param {Function} cb
 */
export function onNewFileDetected(cb) {
  if (typeof cb !== 'function') return;
  if (!_callbacks.includes(cb)) {
    _callbacks.push(cb);
  }
}

/**
 * Remove a previously registered callback.
 *
 * @param {Function} cb
 */
export function offNewFileDetected(cb) {
  _callbacks = _callbacks.filter((fn) => fn !== cb);
}
