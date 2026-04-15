/**
 * Web Import Service — client-side interface for importing media from web URLs.
 *
 * Desktop app: uses local yt-dlp for direct download to disk (instant).
 * Web fallback was deleted in v1.7.1 (handoff §4a). The functions that
 * previously routed through `/api/web-import` now throw a "desktop app
 * required" error to surface the regression rather than silently failing.
 */

import log from '../utils/logger';

// Lazy — see localMediaService.js for rationale.
function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

function desktopOnlyError() {
  return new Error('Web import requires the StickToMusic desktop app');
}

// Platform detection (client-side, no network call)
const PLATFORM_PATTERNS = [
  { name: 'YouTube', icon: '▶', pattern: /(?:youtube\.com|youtu\.be)/i },
  { name: 'TikTok', icon: '♪', pattern: /tiktok\.com/i },
  { name: 'Pinterest', icon: '📌', pattern: /(?:pinterest\.com|pin\.it)/i },
  { name: 'Instagram', icon: '📷', pattern: /instagram\.com/i },
  { name: 'Twitter/X', icon: '𝕏', pattern: /(?:twitter\.com|x\.com)/i },
];

/**
 * Detect platform from URL string.
 * @param {string} url
 * @returns {{ name: string, icon: string } | null}
 */
export function detectPlatform(url) {
  if (!url) return null;
  for (const p of PLATFORM_PATTERNS) {
    if (p.pattern.test(url)) return { name: p.name, icon: p.icon };
  }
  return null;
}

/**
 * Check if a URL is supported for import.
 * @param {string} url
 * @returns {boolean}
 */
export function isUrlSupported(url) {
  return detectPlatform(url) !== null;
}

/**
 * Detect if a URL points to a profile/channel page (not a single video).
 * @param {string} url
 * @returns {boolean}
 */
export function isProfileUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  // TikTok profile: tiktok.com/@username (no /video/ in path)
  if (/tiktok\.com\/@[\w.]+\/?$/i.test(lower)) return true;
  // YouTube channel/playlist
  if (/youtube\.com\/(c\/|channel\/|@|playlist\?)/i.test(lower)) return true;
  return false;
}

// ── Web fallback (deleted in v1.7.1) ──
// These functions used to route through the /api/web-import Vercel proxy,
// which has been deleted along with the stm-media-importer Railway backend.
// The desktop app uses local yt-dlp via the Local section below. These
// stubs are kept so legacy callsites (if any) get a clear error rather
// than an undefined-function crash.

export async function analyzeUrl() {
  throw desktopOnlyError();
}

export async function startDownload() {
  throw desktopOnlyError();
}

export async function startRip() {
  throw desktopOnlyError();
}

export async function checkStatus() {
  throw desktopOnlyError();
}

export function pollUntilComplete() {
  return Promise.reject(desktopOnlyError());
}

// ── Local yt-dlp (Desktop App) ──

/**
 * Check if local yt-dlp is available (Electron only).
 * @returns {Promise<boolean>}
 */
export async function isLocalDownloadAvailable() {
  if (!isElectron()) return false;
  try {
    return await window.electronAPI.ytdlpAvailable();
  } catch {
    return false;
  }
}

/**
 * Get video info using local yt-dlp.
 * @param {string} url
 * @returns {Promise<Object>} Video metadata (title, thumbnail, duration, etc.)
 */
export async function getLocalVideoInfo(url) {
  if (!isElectron()) throw new Error('Local download not available');
  const info = await window.electronAPI.ytdlpInfo(url);
  const platform = detectPlatform(url)?.name || 'Unknown';

  // Profile/playlist — IPC returns { _type: 'playlist', entries: [...] }
  if (info._type === 'playlist' && info.entries?.length > 0) {
    return {
      type: 'playlist',
      platform,
      title: info.title || 'Profile',
      itemCount: info.entries.length,
      items: info.entries.map((entry) => ({
        id: entry.id || entry.display_id,
        title: entry.title || 'Untitled',
        thumbnail: entry.thumbnail,
        duration: entry.duration,
        url: entry.webpage_url || entry.original_url,
      })),
    };
  }

  // Single video
  return {
    type: 'video',
    platform,
    title: info.title || 'Untitled',
    thumbnail: info.thumbnail,
    duration: info.duration,
    itemCount: 1,
  };
}

/**
 * Download media using local yt-dlp directly to disk.
 * Returns array of downloaded file objects with local paths.
 *
 * @param {string} url - URL to download
 * @param {Object} [options] - { audioOnly: boolean }
 * @param {Function} [onProgress] - Progress callback: ({ percent, line }) => void
 * @returns {Promise<Array<{ name, path, localUrl, size, type }>>}
 */
export async function downloadLocally(url, options = {}, onProgress) {
  if (!isElectron()) throw new Error('Local download not available');

  if (onProgress) {
    window.electronAPI.onYtdlpProgress(onProgress);
  }

  const files = await window.electronAPI.ytdlpDownload(url, options.outputDir || null, options);
  log(`[LocalDownload] Downloaded ${files.length} files locally`);
  return files;
}

/**
 * Register a callback for yt-dlp download progress.
 * @param {Function} cb - ({ percent, line }) => void
 */
export function onDownloadProgress(cb) {
  if (!isElectron()) return;
  window.electronAPI.onYtdlpProgress(cb);
}

/**
 * Check if local rip pipeline is available (yt-dlp + FFmpeg).
 * @returns {Promise<boolean>}
 */
export async function isLocalRipAvailable() {
  if (!isElectron()) return false;
  try {
    const [ytdlp, ffmpeg] = await Promise.all([
      window.electronAPI.ytdlpAvailable(),
      window.electronAPI.ffmpegAvailable(),
    ]);
    return ytdlp && ffmpeg;
  } catch {
    return false;
  }
}

/**
 * Run the full local rip pipeline: download → scene detect → split.
 * All files go straight to local disk.
 *
 * @param {string[]} urls - Video URLs to download and rip
 * @param {string} [outputDir] - Output directory (defaults to StickToMusic/Downloads)
 * @param {Object} [options] - { sceneThreshold: number }
 * @param {Function} [onProgress] - Progress callback: ({ phase, message, ... }) => void
 * @returns {Promise<Array<{ name, path, localUrl, size, type }>>}
 */
export async function ripLocally(urls, outputDir, options = {}, onProgress) {
  if (!isElectron()) throw new Error('Local rip not available');

  if (onProgress) {
    window.electronAPI.onLocalRipProgress(onProgress);
  }

  const clips = await window.electronAPI.localRip(urls, outputDir, options);
  log(`[LocalRip] Ripped ${clips.length} clips from ${urls.length} videos`);
  return clips;
}
