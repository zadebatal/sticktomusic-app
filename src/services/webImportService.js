/**
 * Web Import Service — client-side interface for importing media from web URLs.
 *
 * Desktop app: uses local yt-dlp for direct download to disk (instant).
 * Web app (fallback): routes through Vercel proxy → Railway backend.
 */

import { getAuth } from 'firebase/auth';
import log from '../utils/logger';

// Lazy — see localMediaService.js for rationale.
function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

const PROXY_URL = '/api/web-import';

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

/**
 * Get Firebase auth token for proxy calls.
 */
async function getToken() {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated. Please sign in first.');
  return token;
}

/**
 * Analyze a URL — returns metadata without downloading.
 * @param {string} url
 * @returns {Promise<{ type: 'video'|'gallery', platform: string, title: string, thumbnail: string|null, itemCount: number, duration?: number, estimatedSize?: number }>}
 */
export async function analyzeUrl(url) {
  const token = await getToken();
  const resp = await fetch(`${PROXY_URL}?action=analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Analysis failed (${resp.status})`);
  return data;
}

/**
 * Start a download job — returns jobId for polling.
 * @param {string} url
 * @param {string} artistId
 * @param {number} [maxItems] - Max items to download for galleries (default: 100)
 * @returns {Promise<{ jobId: string }>}
 */
export async function startDownload(
  url,
  artistId,
  maxItems,
  audioOnly = false,
  playlist = false,
  selectedUrls = null,
) {
  const token = await getToken();
  const body = {
    url,
    artistId,
    uploadPath: `artists/${artistId}/web-imports`,
  };
  if (maxItems) body.maxItems = maxItems;
  if (audioOnly) body.audioOnly = true;
  if (playlist) body.playlist = true;
  if (selectedUrls && selectedUrls.length > 0) body.urls = selectedUrls;
  const resp = await fetch(`${PROXY_URL}?action=download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Download start failed (${resp.status})`);
  return data;
}

/**
 * Start a montage rip job — scene detect, classify, dedup.
 * @param {string} artistId
 * @param {string[]} selectedUrls - URLs of montage videos to rip
 * @param {number} [sceneThreshold=0.3] - Scene detection sensitivity (0-1)
 * @returns {Promise<{ jobId: string }>}
 */
export async function startRip(artistId, selectedUrls, sceneThreshold = 0.3) {
  const token = await getToken();
  const body = {
    urls: selectedUrls,
    artistId,
    uploadPath: `artists/${artistId}/web-imports`,
    sceneThreshold,
  };
  const resp = await fetch(`${PROXY_URL}?action=rip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Rip start failed (${resp.status})`);
  return data;
}

/**
 * Check status of a download job.
 * @param {string} jobId
 * @returns {Promise<{ status: 'pending'|'downloading'|'uploading'|'complete'|'error', progress: number, files?: Array, error?: string }>}
 */
export async function checkStatus(jobId) {
  const token = await getToken();
  const resp = await fetch(`${PROXY_URL}?action=status&jobId=${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Status check failed (${resp.status})`);
  return data;
}

/**
 * Poll a job until completion. Calls onProgress with each status update.
 * Resolves with the files array on success, rejects on error.
 *
 * @param {string} jobId
 * @param {(status: { status: string, progress: number }) => void} onProgress
 * @param {number} intervalMs - polling interval (default 3000ms)
 * @returns {Promise<Array<{ name: string, url: string, storagePath: string, type: string, size: number }>>}
 */
export function pollUntilComplete(jobId, onProgress, intervalMs = 3000) {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const status = await checkStatus(jobId);
        onProgress?.(status);

        if (status.status === 'complete') {
          resolve(status.files || []);
          return;
        }
        if (status.status === 'error') {
          reject(new Error(status.error || 'Import failed'));
          return;
        }

        setTimeout(poll, intervalMs);
      } catch (err) {
        log.error('Poll error:', err);
        reject(err);
      }
    };

    poll();
  });
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
  return {
    type: 'video',
    platform: detectPlatform(url)?.name || 'Unknown',
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
