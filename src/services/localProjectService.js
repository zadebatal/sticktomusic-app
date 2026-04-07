/**
 * Local Project Service — manages project/niche folder structure on disk.
 *
 * DaVinci Resolve-style workflow: media lives on disk, the app manages folder structure.
 * Only active in Electron (window.electronAPI?.isElectron).
 *
 * Folder structure:
 *   {mediaFolder}/StickToMusic/
 *     └── {artistName}/
 *         └── {projectName}/
 *             ├── {nicheName}/
 *             │   ├── videos/
 *             │   ├── images/
 *             │   ├── audio/
 *             │   └── .thumbnails/
 *             └── exports/
 */

import log from '../utils/logger';

// Evaluate lazily — module-load capture is unsafe if preload's contextBridge
// hasn't injected `window.electronAPI` by the time the bundle parses this.
function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

// Cached media folder path (set on first call to getRoot)
let _cachedMediaFolder = null;

/**
 * Sanitize a name for safe use as a filesystem directory/file name.
 * Replaces path separators, colons, and other dangerous chars with underscores.
 * Trims leading/trailing whitespace and dots (hidden files on Unix).
 * @param {string} name
 * @returns {string}
 */
function safeName(name) {
  if (!name) return 'Untitled';
  return (
    name
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/^\.+/, '')
      .trim() || 'Untitled'
  );
}

/**
 * Get the root path: {mediaFolder}/StickToMusic
 * Caches after first successful call.
 * @returns {Promise<string|null>}
 */
async function getRoot() {
  if (!isElectron()) return null;
  if (_cachedMediaFolder) return _cachedMediaFolder;
  try {
    const mediaFolder = await window.electronAPI.getMediaFolder();
    if (!mediaFolder) return null;
    _cachedMediaFolder = `${mediaFolder}/StickToMusic`;
    return _cachedMediaFolder;
  } catch {
    return null;
  }
}

/**
 * Ensure a directory exists by saving a placeholder and letting the IPC
 * handler create intermediate directories. Uses saveFileLocally which
 * calls fs.mkdirSync with { recursive: true }.
 * @param {string} relativePath - Path relative to mediaFolder root
 */
async function ensureDir(relativePath) {
  // Save a tiny placeholder file to force directory creation, then
  // the directory structure is in place. We use a dotfile so it's hidden.
  const placeholderPath = `${relativePath}/.stm-keep`;
  try {
    const exists = await window.electronAPI.checkFileExists(placeholderPath);
    if (!exists) {
      const empty = new Uint8Array(0).buffer;
      await window.electronAPI.saveFileLocally(empty, placeholderPath);
    }
  } catch (err) {
    log.warn(`[LocalProject] ensureDir failed for ${relativePath}: ${err.message}`);
  }
}

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Create the project folder structure when a project is created.
 * Creates: {root}/{artistName}/{projectName}/exports/
 *
 * @param {string} artistName - Artist display name
 * @param {string} projectName - Project name
 * @returns {Promise<string|null>} Full path to the project folder, or null
 */
export async function createProjectFolder(artistName, projectName) {
  if (!isElectron()) return null;
  try {
    const root = await getRoot();
    if (!root) return null;
    const artist = safeName(artistName);
    const project = safeName(projectName);
    const projectPath = `StickToMusic/${artist}/${project}`;

    // Create project root + exports subfolder
    await ensureDir(`${projectPath}/exports`);

    log(`[LocalProject] Created project folder: ${artist}/${project}`);
    return `${root}/${artist}/${project}`;
  } catch (err) {
    log.warn(`[LocalProject] createProjectFolder failed: ${err.message}`);
    return null;
  }
}

/**
 * Create the niche folder structure when a niche is created.
 * Creates: {root}/{artistName}/{projectName}/{nicheName}/{videos,images,audio,.thumbnails}
 *
 * @param {string} artistName - Artist display name
 * @param {string} projectName - Project name
 * @param {string} nicheName - Niche name
 * @returns {Promise<string|null>} Full path to the niche folder, or null
 */
export async function createNicheFolder(artistName, projectName, nicheName) {
  if (!isElectron()) return null;
  try {
    const root = await getRoot();
    if (!root) return null;
    const artist = safeName(artistName);
    const project = safeName(projectName);
    const niche = safeName(nicheName);
    const nichePath = `StickToMusic/${artist}/${project}/${niche}`;

    // Create all media subfolders in parallel
    await Promise.all([
      ensureDir(`${nichePath}/videos`),
      ensureDir(`${nichePath}/images`),
      ensureDir(`${nichePath}/audio`),
      ensureDir(`${nichePath}/.thumbnails`),
    ]);

    log(`[LocalProject] Created niche folder: ${artist}/${project}/${niche}`);
    return `${root}/${artist}/${project}/${niche}`;
  } catch (err) {
    log.warn(`[LocalProject] createNicheFolder failed: ${err.message}`);
    return null;
  }
}

/**
 * Get the full local path for saving a media file into the correct niche folder.
 *
 * @param {string} artistName - Artist display name
 * @param {string} projectName - Project name
 * @param {string} nicheName - Niche name
 * @param {'video'|'audio'|'image'} mediaType - Type of media
 * @param {string} filename - File name with extension
 * @returns {Promise<string|null>} Full path, or null if not in Electron / no media folder
 */
export async function getMediaPath(artistName, projectName, nicheName, mediaType, filename) {
  if (!isElectron()) return null;
  try {
    const root = await getRoot();
    if (!root) return null;
    const artist = safeName(artistName);
    const project = safeName(projectName);
    const niche = safeName(nicheName);
    const folder = mediaType === 'video' ? 'videos' : mediaType === 'audio' ? 'audio' : 'images';
    return `${root}/${artist}/${project}/${niche}/${folder}/${filename}`;
  } catch {
    return null;
  }
}

/**
 * Generate and cache a thumbnail for a video file.
 * Uses FFmpeg via IPC to extract a frame at 1 second.
 *
 * @param {string} mediaPath - Full path to the source video
 * @param {string} outputDir - Directory for the thumbnail (typically .thumbnails/)
 * @returns {Promise<string|null>} Path to generated thumbnail, or null on failure
 */
export async function generateLocalThumbnail(mediaPath, outputDir) {
  if (!isElectron()) return null;
  try {
    // Build output filename from source
    const basename =
      mediaPath
        .split('/')
        .pop()
        .replace(/\.[^.]+$/, '') + '.jpg';
    const outputPath = `${outputDir}/${basename}`;
    const result = await window.electronAPI.generateLocalThumbnail(mediaPath, outputPath);
    if (result) {
      log(`[LocalProject] Thumbnail generated: ${basename}`);
    }
    return result;
  } catch (err) {
    log.warn(`[LocalProject] Thumbnail generation failed: ${err.message}`);
    return null;
  }
}

/**
 * Move a file to the recoverable trash folder.
 * Moves to: {mediaFolder}/StickToMusic/.trash/{filename}
 *
 * @param {string} filePath - Full path to the file to trash
 * @returns {Promise<string|null>} Path in trash, or null on failure
 */
export async function trashMedia(filePath) {
  if (!isElectron()) return null;
  try {
    const dest = await window.electronAPI.trashFile(filePath);
    log(`[LocalProject] Trashed: ${filePath}`);
    return dest;
  } catch (err) {
    log.warn(`[LocalProject] Trash failed: ${err.message}`);
    return null;
  }
}

/**
 * Restore a file from the trash folder.
 *
 * @param {string} filename - Name of the file in .trash/
 * @param {string} destinationPath - Full path to restore to
 * @returns {Promise<string|null>} Restored path, or null on failure
 */
export async function restoreFromTrash(filename, destinationPath) {
  if (!isElectron()) return null;
  try {
    const result = await window.electronAPI.restoreFromTrash(filename, destinationPath);
    log(`[LocalProject] Restored: ${filename} → ${destinationPath}`);
    return result;
  } catch (err) {
    log.warn(`[LocalProject] Restore failed: ${err.message}`);
    return null;
  }
}

/**
 * List all files in a niche folder, grouped by type.
 *
 * @param {string} artistName
 * @param {string} projectName
 * @param {string} nicheName
 * @returns {Promise<{ videos: Array, images: Array, audio: Array } | null>}
 */
export async function listNicheFiles(artistName, projectName, nicheName) {
  if (!isElectron()) return null;
  try {
    const root = await getRoot();
    if (!root) return null;
    const artist = safeName(artistName);
    const project = safeName(projectName);
    const niche = safeName(nicheName);
    const basePath = `${root}/${artist}/${project}/${niche}`;

    const [videos, images, audio] = await Promise.all([
      window.electronAPI.listDirectory(`${basePath}/videos`).catch(() => []),
      window.electronAPI.listDirectory(`${basePath}/images`).catch(() => []),
      window.electronAPI.listDirectory(`${basePath}/audio`).catch(() => []),
    ]);

    return {
      videos: videos.filter((f) => !f.isDirectory),
      images: images.filter((f) => !f.isDirectory),
      audio: audio.filter((f) => !f.isDirectory),
    };
  } catch (err) {
    log.warn(`[LocalProject] listNicheFiles failed: ${err.message}`);
    return null;
  }
}

/**
 * Rename a project folder on disk.
 *
 * @param {string} artistName
 * @param {string} oldName - Current project name
 * @param {string} newName - New project name
 * @returns {Promise<string|null>} New path, or null on failure
 */
export async function renameProjectFolder(artistName, oldName, newName) {
  if (!isElectron()) return null;
  try {
    const root = await getRoot();
    if (!root) return null;
    const artist = safeName(artistName);
    const oldPath = `${root}/${artist}/${safeName(oldName)}`;
    const newPath = `${root}/${artist}/${safeName(newName)}`;
    const result = await window.electronAPI.renamePath(oldPath, newPath);
    log(`[LocalProject] Renamed project: ${safeName(oldName)} → ${safeName(newName)}`);
    return result;
  } catch (err) {
    log.warn(`[LocalProject] renameProjectFolder failed: ${err.message}`);
    return null;
  }
}

/**
 * Rename a niche folder on disk.
 *
 * @param {string} artistName
 * @param {string} projectName
 * @param {string} oldName - Current niche name
 * @param {string} newName - New niche name
 * @returns {Promise<string|null>} New path, or null on failure
 */
export async function renameNicheFolder(artistName, projectName, oldName, newName) {
  if (!isElectron()) return null;
  try {
    const root = await getRoot();
    if (!root) return null;
    const artist = safeName(artistName);
    const project = safeName(projectName);
    const oldPath = `${root}/${artist}/${project}/${safeName(oldName)}`;
    const newPath = `${root}/${artist}/${project}/${safeName(newName)}`;
    const result = await window.electronAPI.renamePath(oldPath, newPath);
    log(`[LocalProject] Renamed niche: ${safeName(oldName)} → ${safeName(newName)}`);
    return result;
  } catch (err) {
    log.warn(`[LocalProject] renameNicheFolder failed: ${err.message}`);
    return null;
  }
}

/**
 * Check if the media folder is configured (synchronous from cache).
 * Call getRoot() at least once before relying on this.
 *
 * @returns {boolean}
 */
export function isMediaFolderConfigured() {
  return !!_cachedMediaFolder;
}

/**
 * Force refresh the cached media folder path.
 * Useful after the user selects a new media folder.
 * @returns {Promise<string|null>}
 */
export async function refreshMediaFolder() {
  _cachedMediaFolder = null;
  return getRoot();
}
