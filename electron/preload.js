/**
 * StickToMusic — Electron preload script.
 *
 * Exposes safe APIs to the renderer via contextBridge.
 * The renderer accesses these via window.electronAPI.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Platform info ──
  isElectron: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // ── Auto-Update ──
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('update-available', (_event, version) => cb(version));
  },
  onUpdateProgress: (cb) => {
    ipcRenderer.on('update-progress', (_event, percent) => cb(percent));
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.on('update-downloaded', () => cb());
  },

  // ── Local Drive Storage ──
  selectMediaFolder: () => ipcRenderer.invoke('select-media-folder'),
  getMediaFolder: () => ipcRenderer.invoke('get-media-folder'),
  setMediaFolder: (path) => ipcRenderer.invoke('set-media-folder', path),
  saveFileLocally: (arrayBuffer, relativePath) =>
    ipcRenderer.invoke('save-file-locally', arrayBuffer, relativePath),
  readLocalFile: (relativePath) => ipcRenderer.invoke('read-local-file', relativePath),
  checkFileExists: (relativePath) => ipcRenderer.invoke('check-file-exists', relativePath),
  isDriveConnected: () => ipcRenderer.invoke('is-drive-connected'),
  getLocalFileUrl: (relativePath) => ipcRenderer.invoke('get-local-file-url', relativePath),
  probeDurations: (urls) => ipcRenderer.invoke('probe-durations', urls),

  // ── Relocate (DaVinci Comprehensive Search) ──
  recursiveScan: (rootPath) => ipcRenderer.invoke('recursive-scan', rootPath),

  // ── Drive Info ──
  getDiskUsage: () => ipcRenderer.invoke('disk-usage'),
  openInFinder: (filePath) => ipcRenderer.invoke('open-in-finder', filePath),

  // ── Folder Watcher ──
  startWatching: (folderPath) => ipcRenderer.invoke('start-watching', folderPath),
  stopWatching: (folderPath) => ipcRenderer.invoke('stop-watching', folderPath),
  onFileChanged: (cb) => {
    ipcRenderer.on('file-changed', (_event, data) => cb(data));
  },

  // ── Local File Management ──
  trashFile: (filePath) => ipcRenderer.invoke('trash-file', filePath),
  restoreFromTrash: (filename, destPath) =>
    ipcRenderer.invoke('restore-from-trash', filename, destPath),
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
  generateLocalThumbnail: (videoPath, outputPath) =>
    ipcRenderer.invoke('generate-local-thumbnail', videoPath, outputPath),
  renamePath: (oldPath, newPath) =>
    ipcRenderer.invoke('rename-path', oldPath, newPath),
  trimVideoDestructive: (fullPath, trimStart, trimEnd) =>
    ipcRenderer.invoke('trim-video-destructive', fullPath, trimStart, trimEnd),

  // ── CLIP Semantic Search ──
  clipIndexMedia: (artistId, mediaItem) =>
    ipcRenderer.invoke('clip-index-media', { artistId, mediaItem }),
  clipSearch: (artistId, query, options = {}) =>
    ipcRenderer.invoke('clip-search', { artistId, query, ...options }),
  clipIndexStatus: (artistId) =>
    ipcRenderer.invoke('clip-index-status', { artistId }),
  clipReindexAll: (artistId, mediaItems) =>
    ipcRenderer.invoke('clip-reindex-all', { artistId, mediaItems }),
  onClipReindexProgress: (cb) => {
    ipcRenderer.on('clip-reindex-progress', (_event, data) => cb(data));
  },

  // ── Remotion Rendering ──
  remotionRender: (params) => ipcRenderer.invoke('remotion-render', params),
  onRemotionProgress: (cb) => {
    ipcRenderer.on('remotion-progress', (_event, progress) => cb(progress));
  },

  // ── Onboarding ──
  isOnboardingComplete: () => ipcRenderer.invoke('is-onboarding-complete'),
  setOnboardingComplete: (value) => ipcRenderer.invoke('set-onboarding-complete', value),

  // ── Local yt-dlp Download ──
  ytdlpAvailable: () => ipcRenderer.invoke('ytdlp-available'),
  ytdlpDownload: (url, outputDir, options) => ipcRenderer.invoke('ytdlp-download', url, outputDir, options),
  ytdlpInfo: (url) => ipcRenderer.invoke('ytdlp-info', url),
  onYtdlpProgress: (cb) => {
    ipcRenderer.on('ytdlp-progress', (_event, data) => cb(data));
  },

  // ── Command Palette (Cmd+K from native menu) ──
  onToggleCommandPalette: (cb) => {
    ipcRenderer.on('toggle-command-palette', () => cb());
  },

  // ── Local Montage Rip (yt-dlp + FFmpeg scene detect) ──
  ffmpegAvailable: () => ipcRenderer.invoke('ffmpeg-available'),
  localRip: (urls, outputDir, options) => ipcRenderer.invoke('local-rip', urls, outputDir, options),
  onLocalRipProgress: (cb) => {
    ipcRenderer.on('local-rip-progress', (_event, data) => cb(data));
  },
});
