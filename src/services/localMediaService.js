/**
 * Local Media Service — manages media files on the user's local drive.
 *
 * Only active in Electron (window.electronAPI?.isElectron).
 * Provides save/read/resolve functions that map to IPC handlers in electron/main.js.
 *
 * Folder structure on drive (flat per artist):
 *   {mediaFolder}/StickToMusic/{artistName}/media/{filename}
 */

import log from '../utils/logger';

// Evaluate lazily on every call instead of at module-load time. If this module
// were captured statically (the original behavior), then a renderer that loaded
// the bundle BEFORE preload's contextBridge had a chance to inject electronAPI
// would have `isElectron === false` for the entire session — silently breaking
// every desktop feature gated on this check. Lazy is safer and free.
function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

/** Sanitize a name for filesystem use */
function safeName(name) {
  return (name || 'Unknown').replace(/[/\\:*?"<>|]/g, '_').trim();
}

/**
 * Build the relative path for a media file on the local drive.
 * New flat structure: StickToMusic/{artist}/media/{filename}
 */
function buildRelativePath(artistName, filename) {
  return `StickToMusic/${safeName(artistName)}/media/${filename}`;
}

/**
 * Legacy path builder for migration fallback.
 * Old structure: StickToMusic/{artist}/{mediaType}/{filename}
 */
function buildRelativePathLegacy(artistName, mediaType, filename) {
  return `StickToMusic/${safeName(artistName)}/${mediaType}/${filename}`;
}

/**
 * Map media type string to legacy folder name.
 */
function typeToFolder(type) {
  if (type === 'video') return 'videos';
  if (type === 'audio') return 'audio';
  if (type === 'image') return 'images';
  return 'other';
}

/**
 * Ensure the artist's media folder exists.
 * Creates StickToMusic/{artist}/media/ by writing a placeholder.
 */
export async function ensureArtistMediaFolder(artistName) {
  if (!isElectron()) return;
  try {
    const keepPath = buildRelativePath(artistName, '.stm-keep');
    const exists = await window.electronAPI.checkFileExists(keepPath);
    if (!exists) {
      await window.electronAPI.saveFileLocally(new ArrayBuffer(0), keepPath);
      log(`[LocalMedia] Created media folder for ${artistName}`);
    }
  } catch (err) {
    log.warn(`[LocalMedia] Failed to create media folder: ${err.message}`);
  }
}

/**
 * Save a file to the local media drive.
 * @param {File|Blob} file - The file to save
 * @param {string} artistName - Artist name for folder structure
 * @param {string} mediaType - 'video' | 'audio' | 'image'
 * @param {string} [filename] - Override filename (defaults to file.name)
 * @returns {Promise<string|null>} Full local path, or null if not in Electron
 */
export async function saveMediaLocally(file, artistName, mediaType, filename) {
  if (!isElectron()) return null;
  try {
    const name = filename || file.name || `media_${Date.now()}`;
    const relativePath = buildRelativePath(artistName, name);
    const arrayBuffer = await file.arrayBuffer();
    const fullPath = await window.electronAPI.saveFileLocally(arrayBuffer, relativePath);
    log(`[LocalMedia] Saved: ${relativePath}`);
    return fullPath;
  } catch (err) {
    log.warn(`[LocalMedia] Save failed: ${err.message}`);
    return null;
  }
}

/**
 * Get the file:// URL for a local media file (if it exists).
 * @param {string} artistName
 * @param {string} mediaType - 'video' | 'audio' | 'image'
 * @param {string} filename
 * @returns {Promise<string|null>} file:// URL or null
 */
export async function getLocalMediaUrl(artistName, mediaType, filename) {
  if (!isElectron()) return null;
  try {
    // Try new flat path first
    const relativePath = buildRelativePath(artistName, filename);
    const exists = await window.electronAPI.checkFileExists(relativePath);
    if (exists) return window.electronAPI.getLocalFileUrl(relativePath);

    // Fallback to legacy path
    const legacyPath = buildRelativePathLegacy(artistName, typeToFolder(mediaType), filename);
    const legacyExists = await window.electronAPI.checkFileExists(legacyPath);
    if (legacyExists) return window.electronAPI.getLocalFileUrl(legacyPath);

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the best URL for a media item — prefers local file, falls back to cloud.
 * @param {{ url: string, name: string, type: string }} item - Library item
 * @param {string} artistName
 * @returns {Promise<string>} Best available URL
 */
export async function resolveMediaUrl(item, artistName) {
  if (isElectron() && item.name) {
    const localUrl = await getLocalMediaUrl(artistName, item.type, item.name);
    if (localUrl) return localUrl;
  }
  return item.url;
}

/**
 * Check if the configured media drive is connected.
 * @returns {Promise<boolean>}
 */
export async function isDriveConnected() {
  if (!isElectron()) return false;
  try {
    return await window.electronAPI.isDriveConnected();
  } catch {
    return false;
  }
}

/**
 * Get the configured media folder path.
 * @returns {Promise<string|null>}
 */
export async function getMediaFolder() {
  if (!isElectron()) return null;
  try {
    return await window.electronAPI.getMediaFolder();
  } catch {
    return null;
  }
}

/**
 * Open folder picker dialog and set the media folder.
 * @returns {Promise<string|null>} Selected path or null if cancelled
 */
export async function selectMediaFolder() {
  if (!isElectron()) return null;
  try {
    return await window.electronAPI.selectMediaFolder();
  } catch {
    return null;
  }
}

/**
 * Check if we're running in Electron.
 * @returns {boolean}
 */
export function isElectronApp() {
  return isElectron();
}

/**
 * Push a local-only library item to Firebase Storage. Updates the item with
 * `url`, `storagePath`, `syncStatus: 'synced'`. Idempotent — returns early if
 * already cloud or synced.
 *
 * @param {Object} db - Firestore
 * @param {string} artistId
 * @param {string} artistName
 * @param {Object} item - Library item (must have type, name, localPath or localUrl)
 * @returns {Promise<Object|null>} Updated item or null on failure
 */
export async function uploadLocalItemToCloud(db, artistId, artistName, item, quotaCtx = {}) {
  if (!item || !item.id) return null;
  if (item.url && item.syncStatus !== 'local') return item; // already cloud
  if (!isElectron() || !item.name) return null;

  const { uploadFileWithQuota } = await import('./firebaseStorage');
  const { updateLibraryItemAsync } = await import('./libraryService');

  try {
    // Read the local file as a Blob
    const localUrl = await getLocalMediaUrl(artistName, item.type, item.name);
    if (!localUrl) {
      log.warn(`[uploadLocalItemToCloud] No local URL for ${item.name}`);
      return null;
    }
    const response = await fetch(localUrl);
    if (!response.ok) throw new Error(`Failed to read local file: HTTP ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], item.name, { type: blob.type || 'application/octet-stream' });

    // Upload to Firebase Storage with quota enforcement
    const folder = item.type === 'video' ? 'videos' : item.type === 'audio' ? 'audio' : 'images';
    const { url, path } = await uploadFileWithQuota(file, folder, null, {}, quotaCtx);

    // Update the library item with cloud info
    const updates = {
      url,
      storagePath: path,
      syncStatus: 'synced', // both local + cloud now
    };
    await updateLibraryItemAsync(db, artistId, item.id, updates);
    log(`[uploadLocalItemToCloud] Uploaded: ${item.name}`);
    return { ...item, ...updates };
  } catch (err) {
    log.warn(`[uploadLocalItemToCloud] Failed for ${item.name}: ${err.message}`);
    return null;
  }
}

/**
 * Relocate offline files by scanning the drive for matching filenames.
 * DaVinci Resolve-style "Comprehensive Search".
 *
 * @param {Array<{ name: string, type: string }>} offlineItems - Items to relocate
 * @returns {Promise<{ found: number, notFound: number, matches: Object }>}
 */
export async function relocateOfflineFiles(offlineItems) {
  if (!isElectron()) return { found: 0, notFound: 0, matches: {} };
  try {
    const root = await window.electronAPI.getMediaFolder();
    if (!root) return { found: 0, notFound: 0, matches: {} };

    // Recursively scan drive for all files
    const fileIndex = await window.electronAPI.recursiveScan(root);

    let found = 0;
    let notFound = 0;
    const matches = {};

    for (const item of offlineItems) {
      const match = fileIndex[item.name];
      if (match) {
        matches[item.name] = match;
        found++;
      } else {
        notFound++;
      }
    }

    return { found, notFound, total: offlineItems.length, matches };
  } catch (err) {
    log.warn(`[Relocate] Scan failed: ${err.message}`);
    return { found: 0, notFound: 0, matches: {} };
  }
}

/**
 * Get disk usage info for the media folder.
 * @returns {Promise<{ used: number, free: number } | null>}
 */
export async function getDiskUsage() {
  if (!isElectron()) return null;
  try {
    return await window.electronAPI.getDiskUsage();
  } catch {
    return null;
  }
}

/**
 * Open a file's location in Finder.
 * @param {string} filePath - Full path to the file
 */
export async function openInFinder(filePath) {
  if (!isElectron()) return;
  try {
    await window.electronAPI.openInFinder(filePath);
  } catch {
    // ignore
  }
}

/**
 * Start watching a folder for file changes.
 * @param {string} folderPath - Full path to watch
 */
export async function startWatching(folderPath) {
  if (!isElectron()) return;
  try {
    await window.electronAPI.startWatching(folderPath);
  } catch {
    // ignore
  }
}

/**
 * Stop watching a folder.
 * @param {string} folderPath
 */
export async function stopWatching(folderPath) {
  if (!isElectron()) return;
  try {
    await window.electronAPI.stopWatching(folderPath);
  } catch {
    // ignore
  }
}

/**
 * Register a callback for file change events.
 * @param {(data: { folder: string, filename: string, eventType: string }) => void} cb
 */
export function onFileChanged(cb) {
  if (!isElectron()) return;
  window.electronAPI.onFileChanged(cb);
}

/**
 * Check onboarding completion status.
 * @returns {Promise<boolean>}
 */
export async function isOnboardingComplete() {
  if (!isElectron()) return true; // web app doesn't need onboarding
  try {
    return await window.electronAPI.isOnboardingComplete();
  } catch {
    return true;
  }
}

/**
 * Mark onboarding as complete.
 * @param {boolean} value
 */
export async function setOnboardingComplete(value) {
  if (!isElectron()) return;
  try {
    await window.electronAPI.setOnboardingComplete(value);
  } catch {
    // ignore
  }
}
