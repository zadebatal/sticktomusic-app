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
  saveFileLocally: (arrayBuffer, relativePath) =>
    ipcRenderer.invoke('save-file-locally', arrayBuffer, relativePath),
  readLocalFile: (relativePath) => ipcRenderer.invoke('read-local-file', relativePath),
  checkFileExists: (relativePath) => ipcRenderer.invoke('check-file-exists', relativePath),
  isDriveConnected: () => ipcRenderer.invoke('is-drive-connected'),
  getLocalFileUrl: (relativePath) => ipcRenderer.invoke('get-local-file-url', relativePath),

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

  // ── Onboarding ──
  isOnboardingComplete: () => ipcRenderer.invoke('is-onboarding-complete'),
  setOnboardingComplete: (value) => ipcRenderer.invoke('set-onboarding-complete', value),
});
