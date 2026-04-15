/**
 * StickToMusic — Electron main process.
 *
 * Features:
 * - Dev mode: loads localhost:3000 | Prod mode: loads build/index.html
 * - Auto-updater (DaVinci-style: notify, don't force)
 * - Local drive storage via IPC (save/read/check files on SSD/external drive)
 * - Google OAuth popup handling for Firebase Auth
 */

const { app, BrowserWindow, ipcMain, dialog, session, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const express = require('express');
const transnet = require('./transnet');
const scenedetect = require('./scenedetect');

// electron-updater is optional in dev (not installed in root devDeps initially)
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch {
  // Not available in dev — that's fine
}

// electron-store for persistent config (v10+ is ESM-only, must use dynamic import)
let store = null;
const _storeReady = (async () => {
  try {
    const { default: Store } = await import('electron-store');
    store = new Store();
    console.log(`[config] electron-store loaded. Path: ${store.path}`);
    console.log(`[config] Persisted config:`, JSON.stringify(store.store));
  } catch (err) {
    console.warn(`[config] electron-store failed (${err.message}), using in-memory fallback`);
    const _mem = {};
    store = {
      get: (k, d) => (k in _mem ? _mem[k] : d),
      set: (k, v) => { _mem[k] = v; },
    };
  }
})();

const isDev = !app.isPackaged;
let mainWindow = null;

function createWindow() {
  // Restore saved window bounds, or use external display if available
  const { screen } = require('electron');
  const savedBounds = store.get('windowBounds', null);
  let windowOptions = { width: 1440, height: 900 };

  if (savedBounds) {
    windowOptions = { ...windowOptions, x: savedBounds.x, y: savedBounds.y, width: savedBounds.width, height: savedBounds.height };
  } else {
    // Default to external display if one exists
    const displays = screen.getAllDisplays();
    const external = displays.find(d => d.id !== screen.getPrimaryDisplay().id);
    if (external) {
      windowOptions.x = external.bounds.x + 50;
      windowOptions.y = external.bounds.y + 50;
    }
  }

  mainWindow = new BrowserWindow({
    ...windowOptions,
    title: 'StickToMusic',
    titleBarStyle: 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Show window only when ready (prevents blank/unresponsive flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });


  // Save window position on move/resize
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };
  mainWindow.on('moved', saveBounds);
  mainWindow.on('resized', saveBounds);

  // Allow Google sign-in popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.includes('accounts.google.com') ||
      url.includes('firebaseapp.com') ||
      url.includes('googleapis.com')
    ) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });

  // Handle new window for OAuth — refresh parent after OAuth completes
  mainWindow.webContents.on('did-create-window', (childWindow) => {
    childWindow.once('closed', () => {
      mainWindow.webContents.reload();
    });
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // Production: load from embedded server (handles API proxy + static files)
    mainWindow.loadURL(`http://localhost:${serverPort}`);
  }

  console.log(`[electron] Window opened — ${isDev ? 'dev server' : 'production build'}`);
}

// ── App Menu ──
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: () => {
            if (autoUpdater) autoUpdater.checkForUpdates();
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    {
      label: 'Go',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('toggle-command-palette');
            }
          },
        },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Auto-Updater (DaVinci-style) ──
function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Public repo — no token needed for release checks/downloads
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'zadebatal',
    repo: 'sticktomusic-app',
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: ${info.version}`);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info.version);
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-progress', Math.round(progress.percent));
    }
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('[updater] Update downloaded, ready to install');
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded');
    }
  });

  autoUpdater.on('error', (err) => {
    console.warn('[updater] Error:', err.message);
  });
}

// ── IPC: Auto-Update ──
ipcMain.handle('check-for-updates', () => {
  if (autoUpdater) return autoUpdater.checkForUpdates();
  return null;
});

ipcMain.handle('download-update', () => {
  if (autoUpdater) return autoUpdater.downloadUpdate();
  return null;
});

ipcMain.handle('install-update', () => {
  if (autoUpdater) {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      console.error('[updater] quitAndInstall failed:', err.message);
      // Fallback: relaunch the app manually
      app.relaunch();
      app.exit(0);
    }
  } else {
    // No updater — just relaunch
    app.relaunch();
    app.exit(0);
  }
});

// ── IPC: Local Drive Storage ──
ipcMain.handle('select-media-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Media Library Folder',
    message: 'Choose a folder on your drive for StickToMusic media files',
  });
  if (!result.canceled && result.filePaths[0]) {
    const folderPath = result.filePaths[0];
    store.set('mediaFolder', folderPath);
    // Create base folder structure
    const stmRoot = path.join(folderPath, 'StickToMusic');
    fs.mkdirSync(stmRoot, { recursive: true });
    console.log(`[storage] Media folder set: ${folderPath}`);
    return folderPath;
  }
  return null;
});

ipcMain.handle('get-media-folder', () => {
  return store.get('mediaFolder', null);
});

ipcMain.handle('set-media-folder', (_event, folderPath) => {
  store.set('mediaFolder', folderPath);
  const stmRoot = path.join(folderPath, 'StickToMusic');
  fs.mkdirSync(stmRoot, { recursive: true });
  console.log(`[storage] Media folder set programmatically: ${folderPath}`);
  return folderPath;
});

// ── Path validation helper ──
// Reject absolute paths, null bytes, and any path that escapes the media folder
// after resolution. Returns the resolved absolute path on success, throws otherwise.
function resolveSafeMediaPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('Invalid relative path');
  }
  if (relativePath.includes('\0')) {
    throw new Error('Invalid path (null byte)');
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error('Absolute paths are not allowed');
  }
  const fullPath = path.resolve(root, relativePath);
  const rel = path.relative(root, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes media folder');
  }
  return fullPath;
}

ipcMain.handle('save-file-locally', async (_event, arrayBuffer, relativePath) => {
  const root = store.get('mediaFolder');
  if (!root) throw new Error('No media folder configured');
  const fullPath = resolveSafeMediaPath(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  // Atomic write: write to a temp file in the same dir, then rename.
  // Prevents leaving a half-written file on crash / power loss.
  const tmpPath = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, Buffer.from(arrayBuffer));
    fs.renameSync(tmpPath, fullPath);
  } catch (err) {
    // Best-effort cleanup of partial temp file
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
  console.log(`[storage] Saved: ${relativePath}`);
  return fullPath;
});

ipcMain.handle('read-local-file', async (_event, relativePath) => {
  const root = store.get('mediaFolder');
  if (!root) throw new Error('No media folder configured');
  const fullPath = resolveSafeMediaPath(root, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('File not found');
  return fs.readFileSync(fullPath);
});

ipcMain.handle('check-file-exists', async (_event, relativePath) => {
  const root = store.get('mediaFolder');
  if (!root) return false;
  try {
    const fullPath = resolveSafeMediaPath(root, relativePath);
    return fs.existsSync(fullPath);
  } catch {
    return false;
  }
});

ipcMain.handle('is-drive-connected', () => {
  const root = store.get('mediaFolder');
  if (!root) return false;
  return fs.existsSync(root);
});

ipcMain.handle('get-local-file-url', (_event, relativePath) => {
  const root = store.get('mediaFolder');
  if (!root) return null;
  // Serve via embedded Express to avoid CORS issues with file:// protocol
  return `http://localhost:${serverPort}/local-media/${encodeURIComponent(relativePath).replace(/%2F/g, '/')}`;
});

/**
 * Convert an absolute file path to an http://localhost URL served by the embedded Express server.
 * Falls back to file:// if the path isn't under the media folder.
 */
function toLocalUrl(fullPath) {
  const root = store.get('mediaFolder');
  if (root && fullPath.startsWith(root)) {
    const rel = fullPath.slice(root.length).replace(/^\//, '');
    return `http://localhost:${serverPort}/local-media/${encodeURIComponent(rel).replace(/%2F/g, '/')}`;
  }
  return `file://${encodeURI(fullPath).replace(/#/g, '%23')}`;
}

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Batch probe video durations using ffprobe (fast, reliable)
ipcMain.handle('probe-durations', async (_event, urls) => {
  const root = store.get('mediaFolder');
  const results = {};
  for (const url of urls) {
    try {
      // Extract file path from localhost URL
      let filePath = null;
      if (url.includes('/local-media/') && root) {
        const rel = decodeURIComponent(url.split('/local-media/')[1] || '');
        filePath = path.join(root, rel);
      }
      if (filePath && fs.existsSync(filePath)) {
        const dur = getVideoDuration(filePath);
        if (dur > 0) results[url] = dur;
      }
    } catch {}
  }
  return results;
});

// ── IPC: Recursive Scan (DaVinci-style Relocate) ──
ipcMain.handle('recursive-scan', async (_event, rootPath) => {
  const index = {};
  function walk(dir) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue; // skip hidden files
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else index[entry.name] = full;
      }
    } catch { /* permission denied, skip */ }
  }
  walk(rootPath);
  return index;
});

// ── IPC: Disk Usage ──
ipcMain.handle('disk-usage', async () => {
  const root = store.get('mediaFolder');
  if (!root) return null;

  let totalSize = 0;
  function walk(dir) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else totalSize += fs.statSync(full).size;
      }
    } catch { /* skip */ }
  }
  const stmRoot = path.join(root, 'StickToMusic');
  if (fs.existsSync(stmRoot)) walk(stmRoot);

  let freeBytes = 0;
  try {
    const df = execSync(`df -k "${root}"`).toString();
    const parts = df.split('\n')[1]?.split(/\s+/);
    if (parts) freeBytes = parseInt(parts[3]) * 1024;
  } catch { /* fallback: unknown */ }

  return { used: totalSize, free: freeBytes };
});

// ── IPC: Open in Finder ──
ipcMain.handle('open-in-finder', (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

// ── IPC: Folder Watcher ──
const _watchers = new Map();

ipcMain.handle('start-watching', (_event, folderPath) => {
  if (_watchers.has(folderPath)) return; // already watching
  try {
    const watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
      if (!filename || filename.startsWith('.')) return;
      if (mainWindow) {
        mainWindow.webContents.send('file-changed', { folder: folderPath, filename, eventType });
      }
    });
    _watchers.set(folderPath, watcher);
    console.log(`[watch] Watching: ${folderPath}`);
  } catch (err) {
    console.warn(`[watch] Failed to watch ${folderPath}: ${err.message}`);
  }
});

ipcMain.handle('stop-watching', (_event, folderPath) => {
  const watcher = _watchers.get(folderPath);
  if (watcher) {
    watcher.close();
    _watchers.delete(folderPath);
  }
});

// ── IPC: Local File Management (project/niche folder structure) ──

// Trash a file (move to .trash/ folder)
ipcMain.handle('trash-file', async (_event, filePath) => {
  const root = store.get('mediaFolder');
  if (!root) throw new Error('No media folder');
  const trashDir = path.join(root, 'StickToMusic', '.trash');
  fs.mkdirSync(trashDir, { recursive: true });
  const dest = path.join(trashDir, path.basename(filePath));
  fs.renameSync(filePath, dest);
  return dest;
});

// Restore from trash
ipcMain.handle('restore-from-trash', async (_event, filename, destPath) => {
  const root = store.get('mediaFolder');
  if (!root) throw new Error('No media folder');
  const trashPath = path.join(root, 'StickToMusic', '.trash', filename);
  if (!fs.existsSync(trashPath)) throw new Error('File not found in trash');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.renameSync(trashPath, destPath);
  return destPath;
});

// List files in a directory
ipcMain.handle('list-directory', async (_event, dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(dirPath, e.name),
    }));
});

// Generate thumbnail from video using FFmpeg
ipcMain.handle('generate-local-thumbnail', async (_event, videoPath, outputPath) => {
  const cmd = [
    'ffmpeg', '-y', '-i', videoPath,
    '-ss', '00:00:01', '-vframes', '1',
    '-vf', 'scale=480:-1', '-q:v', '3',
    outputPath
  ];
  try {
    const { execFileSync } = require('child_process');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    execFileSync(cmd[0], cmd.slice(1), { timeout: 15000 });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return outputPath;
  } catch {}
  return null;
});

// Destructive video trim — overwrites original file with trimmed version
ipcMain.handle('trim-video-destructive', async (_event, fullPath, trimStart, trimEnd) => {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) throw new Error('FFmpeg not found');
  if (!fs.existsSync(fullPath)) throw new Error('File not found: ' + fullPath);

  const duration = trimEnd - trimStart;
  if (duration <= 0) throw new Error('Invalid trim range');

  const tmpPath = fullPath + '.trim-tmp.mp4';
  const { execFileSync } = require('child_process');

  try {
    execFileSync(ffmpeg, [
      '-y', '-i', fullPath,
      '-ss', String(trimStart),
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      tmpPath,
    ], { timeout: 300000 }); // 5 min timeout

    // Verify output exists and has content
    if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
      throw new Error('FFmpeg produced empty output');
    }

    // Replace original with trimmed version
    fs.unlinkSync(fullPath);
    fs.renameSync(tmpPath, fullPath);

    console.log(`[trim] Trimmed ${path.basename(fullPath)}: ${trimStart.toFixed(2)}s-${trimEnd.toFixed(2)}s (${duration.toFixed(2)}s)`);
    return { success: true, newDuration: duration };
  } catch (err) {
    // Cleanup temp file on failure
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    throw new Error('Trim failed: ' + err.message);
  }
});

// ── IPC: CLIP Semantic Media Search ──
const clip = require('./clip');
const clipIndex = require('./clipIndex');

// Index a single media item (extract keyframes → CLIP encode → store)
ipcMain.handle('clip-index-media', async (_event, { artistId, mediaItem }) => {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) throw new Error('FFmpeg not found');

  await clip.ensureLoaded();

  const filePath = mediaItem.localPath || mediaItem.localUrl || mediaItem.url;
  if (!filePath) throw new Error('No file path for media item');

  // Skip if already indexed
  if (clipIndex.isIndexed(artistId, mediaItem.id)) {
    return { status: 'already_indexed' };
  }

  const tmpDir = path.join(app.getPath('temp'), 'stm-clip-frames');
  fs.mkdirSync(tmpDir, { recursive: true });

  let vectors = [];

  if (mediaItem.type === 'video') {
    // Extract 5 keyframes at equal intervals, scaled to 224x224
    const framePattern = path.join(tmpDir, `${mediaItem.id}_%03d.jpg`);
    const { execFileSync } = require('child_process');
    try {
      execFileSync(ffmpeg, [
        '-y', '-i', filePath,
        '-vf', 'fps=1,scale=224:224:force_original_aspect_ratio=decrease,pad=224:224:(ow-iw)/2:(oh-ih)/2',
        '-frames:v', '5',
        '-q:v', '2',
        framePattern,
      ], { timeout: 30000 });

      // Encode each frame
      for (let i = 1; i <= 5; i++) {
        const framePath = path.join(tmpDir, `${mediaItem.id}_${String(i).padStart(3, '0')}.jpg`);
        if (fs.existsSync(framePath)) {
          try {
            const vec = await clip.encodeImage(framePath);
            vectors.push(vec);
          } catch (err) {
            console.warn(`[clip] Failed to encode frame ${i}:`, err.message);
          }
          // Cleanup frame
          try { fs.unlinkSync(framePath); } catch {}
        }
      }
    } catch (err) {
      console.warn('[clip] FFmpeg frame extraction failed:', err.message);
    }
  } else if (mediaItem.type === 'image') {
    // Encode image directly
    try {
      const vec = await clip.encodeImage(filePath);
      vectors.push(vec);
    } catch (err) {
      console.warn('[clip] Image encode failed:', err.message);
    }
  }

  if (vectors.length === 0) {
    return { status: 'no_vectors' };
  }

  // Mean pool all frame vectors → single embedding
  const dim = vectors[0].length;
  const meanVector = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) meanVector[i] += vec[i];
  }
  for (let i = 0; i < dim; i++) meanVector[i] /= vectors.length;

  // Normalize
  const norm = Math.sqrt(meanVector.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < dim; i++) meanVector[i] /= norm;

  // Store in index
  const totalIndexed = clipIndex.addToIndex(artistId, {
    mediaId: mediaItem.id,
    vector: meanVector,
    collectionIds: mediaItem.collectionIds || [],
    type: mediaItem.type,
    name: mediaItem.name || '',
    duration: mediaItem.duration || null,
    indexedAt: new Date().toISOString(),
  });

  console.log(`[clip] Indexed ${mediaItem.name || mediaItem.id} (${vectors.length} frames, total: ${totalIndexed})`);
  return { status: 'indexed', totalIndexed };
});

// Search media by text query
ipcMain.handle('clip-search', async (_event, { artistId, query, collectionIds, limit }) => {
  await clip.ensureLoaded();
  const queryVector = await clip.encodeText(query);
  const results = clipIndex.searchIndex(artistId, queryVector, { collectionIds, limit });
  return results;
});

// Get index stats
ipcMain.handle('clip-index-status', async (_event, { artistId }) => {
  return clipIndex.getStats(artistId);
});

// Reindex all unindexed media for an artist (background job)
ipcMain.handle('clip-reindex-all', async (_event, { artistId, mediaItems }) => {
  await clip.ensureLoaded();
  let indexed = 0;
  let skipped = 0;

  for (const item of mediaItems) {
    if (clipIndex.isIndexed(artistId, item.id)) {
      skipped++;
      continue;
    }
    try {
      // Trigger the index handler for each item
      await ipcMain.emit('clip-index-media', null, { artistId, mediaItem: item });
      indexed++;
    } catch (err) {
      console.warn(`[clip] Reindex failed for ${item.id}:`, err.message);
    }

    // Send progress
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clip-reindex-progress', {
        indexed,
        skipped,
        total: mediaItems.length,
      });
    }
  }

  return { indexed, skipped, total: mediaItems.length };
});

// ── IPC: Remotion Video Rendering ──
// Renders a video composition using @remotion/renderer (headless Chrome, frame-perfect)
ipcMain.handle('remotion-render', async (_event, params) => {
  const { compositionProps, width, height, fps, durationInFrames } = params;
  const outputDir = path.join(app.getPath('temp'), 'stm-remotion');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `render_${Date.now()}.mp4`);

  try {
    // Dynamic import — @remotion/renderer is a heavy Node.js module
    const { renderMedia, selectComposition } = await import('@remotion/renderer');

    // Remotion needs a bundle URL pointing to the composition entry point.
    // For Electron, we use a minimal inline composition via the serveUrl approach.
    // Since we can't easily bundle Remotion compositions in CRA, we use the
    // programmatic API with an inline component via bundle().
    const { bundle } = await import('@remotion/bundler');

    const bundlePath = path.join(__dirname, '..', 'src', 'remotion', 'index.js');
    let serveUrl;

    // If bundled entry exists, use it; otherwise fall back to a temp bundle
    if (fs.existsSync(bundlePath)) {
      serveUrl = await bundle(bundlePath);
    } else {
      throw new Error('Remotion entry point not found at ' + bundlePath);
    }

    const composition = await selectComposition({
      serveUrl,
      id: 'Montage',
      inputProps: compositionProps,
    });

    await renderMedia({
      composition: {
        ...composition,
        width,
        height,
        fps,
        durationInFrames,
      },
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: compositionProps,
      onProgress: ({ progress }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('remotion-progress', progress);
        }
      },
    });

    console.log(`[remotion] Render complete: ${outputPath}`);
    return { outputPath, success: true };
  } catch (err) {
    console.error('[remotion] Render failed:', err.message);
    // Clean up failed output
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    throw new Error('Remotion render failed: ' + err.message);
  }
});

// Rename a file or directory
ipcMain.handle('rename-path', async (_event, oldPath, newPath) => {
  if (!fs.existsSync(oldPath)) throw new Error('Path not found');
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.renameSync(oldPath, newPath);
  return newPath;
});

// ── IPC: Onboarding complete flag ──
ipcMain.handle('is-onboarding-complete', () => {
  return store.get('onboardingComplete', false);
});

ipcMain.handle('set-onboarding-complete', (_event, value) => {
  store.set('onboardingComplete', !!value);
});

// ── IPC: Local yt-dlp Download ──
//
// yt-dlp resolution priority (handoff §3d):
// 1. Mutable copy in app userData (allows `yt-dlp -U` self-update)
// 2. Bundled binary in electron/bin (immutable inside signed .app)
// 3. System-installed yt-dlp via PATH
//
// On first launch we copy the bundled binary to userData so the user can
// keep it fresh as YouTube rotates bot detection. The bundled copy stays
// as a signed/sealed fallback.
function getUserDataYtdlpPath() {
  try {
    const userBinDir = path.join(app.getPath('userData'), 'bin');
    return path.join(userBinDir, 'yt-dlp');
  } catch {
    return null;
  }
}

function ensureUserDataYtdlp() {
  try {
    const userPath = getUserDataYtdlpPath();
    if (!userPath) return null;
    if (fs.existsSync(userPath)) return userPath;

    // Copy bundled → userData (one-time)
    const bundled = path.join(__dirname, 'bin', 'yt-dlp');
    if (!fs.existsSync(bundled)) return null;

    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    fs.copyFileSync(bundled, userPath);
    fs.chmodSync(userPath, 0o755);
    console.log(`[ytdlp] Copied bundled binary to userData: ${userPath}`);
    return userPath;
  } catch (err) {
    console.warn(`[ytdlp] ensureUserDataYtdlp failed: ${err.message}`);
    return null;
  }
}

function getYtdlpPath() {
  // Prefer userData copy (mutable, can self-update)
  const userPath = ensureUserDataYtdlp();
  if (userPath && fs.existsSync(userPath)) return userPath;

  // Fall back to bundled binary in electron/bin (immutable)
  const bundled = path.join(__dirname, 'bin', 'yt-dlp');
  if (fs.existsSync(bundled)) return bundled;

  // Last resort: system-installed yt-dlp
  try {
    const systemPath = execSync('which yt-dlp').toString().trim();
    if (systemPath) return systemPath;
  } catch {}
  return null;
}

ipcMain.handle('ytdlp-available', () => {
  return getYtdlpPath() !== null;
});

// Self-update the userData copy via `yt-dlp -U`. Safe because the userData
// copy isn't part of the code-signed bundle. Returns the new version string
// or throws on failure.
ipcMain.handle('ytdlp-self-update', async () => {
  const userPath = ensureUserDataYtdlp();
  if (!userPath || !fs.existsSync(userPath)) {
    throw new Error('yt-dlp userData copy not available');
  }
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn(userPath, ['-U']);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp -U failed: ${stderr.slice(-300)}`));
      // Get version after update
      try {
        const version = require('child_process').execSync(`"${userPath}" --version`).toString().trim();
        resolve({ version, output: stdout.trim() });
      } catch (err) {
        resolve({ version: 'unknown', output: stdout.trim() });
      }
    });
    proc.on('error', (err) => reject(err));
  });
});

ipcMain.handle('ytdlp-download', async (_event, url, outputDir, options = {}) => {
  const ytdlp = getYtdlpPath();
  if (!ytdlp) throw new Error('yt-dlp not found');

  const mediaFolder = store.get('mediaFolder');
  const targetDir = outputDir || (mediaFolder ? path.join(mediaFolder, 'StickToMusic', 'Downloads') : app.getPath('downloads'));
  fs.mkdirSync(targetDir, { recursive: true });

  const outputTemplate = path.join(targetDir, '%(title).80s.%(ext)s');
  const args = [
    '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--restrict-filenames',
    '--max-filesize', '2G',
    '-o', outputTemplate,
  ];

  if (options.audioOnly) {
    args.splice(0, args.length,
      '-f', 'bestaudio/best',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--no-playlist',
      '-o', outputTemplate,
    );
  }

  args.push(url);

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    // --newline forces yt-dlp to emit one progress line at a time (no \r
    // overwrites) so the parser can pick up every update.
    const proc = spawn(ytdlp, ['--newline', ...args], { cwd: targetDir });
    let stderr = '';

    // yt-dlp writes [download] progress to stdout AND some informational
    // messages to stderr. Parse both for percent so the renderer's progress
    // bar always updates regardless of which stream the line landed on.
    // (Without parsing both, the modal would stay on "Downloading to your
    // drive..." for the entire 5-8 minute HLS fragment download.)
    const parseProgress = (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/(\d+\.?\d*)%/);
        if (match && mainWindow) {
          mainWindow.webContents.send('ytdlp-progress', {
            percent: parseFloat(match[1]),
            line: line.trim(),
          });
        }
      }
    };

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      parseProgress(data);
    });
    proc.stdout.on('data', parseProgress);

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp failed: ${stderr.slice(-300)}`));
      }
      // Find downloaded files
      const files = [];
      try {
        for (const f of fs.readdirSync(targetDir)) {
          const fpath = path.join(targetDir, f);
          const stat = fs.statSync(fpath);
          // Only include files modified in the last 60 seconds (from this download)
          if (stat.isFile() && Date.now() - stat.mtimeMs < 60000) {
            const ext = path.extname(f).toLowerCase();
            const isVideo = ['.mp4', '.webm', '.mkv', '.mov', '.avi'].includes(ext);
            const isAudio = ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.opus'].includes(ext);
            // Generate thumbnail for videos
            let thumbnailUrl = null;
            if (isVideo) {
              const thumbDir = path.join(targetDir, '.thumbnails');
              const thumbPath = path.join(thumbDir, f.replace(/\.\w+$/, '.jpg'));
              try {
                fs.mkdirSync(thumbDir, { recursive: true });
                const ffmpegBin = getFfmpegPath();
                if (ffmpegBin) execSync(`"${ffmpegBin}" -y -i "${fpath}" -ss 1 -vframes 1 -vf "scale=480:-1" -q:v 3 "${thumbPath}"`, { timeout: 10000 });
                if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) thumbnailUrl = toLocalUrl(thumbPath);
              } catch {}
            }
            files.push({
              name: f,
              path: fpath,
              localUrl: toLocalUrl(fpath),
              thumbnailUrl,
              size: stat.size,
              type: isAudio ? 'audio' : isVideo ? 'video' : 'image',
            });
          }
        }
      } catch (err) {
        return reject(new Error('Could not read downloaded files: ' + err.message));
      }
      resolve(files);
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      proc.kill();
      reject(new Error('Download timed out'));
    }, 600000);
  });
});

ipcMain.handle('ytdlp-info', async (_event, url) => {
  const ytdlp = getYtdlpPath();
  if (!ytdlp) throw new Error('yt-dlp not found');

  // Detect profile/channel URLs — limit to first 30 items to avoid timeout
  const isProfile = /tiktok\.com\/@[\w.]+/i.test(url) && !/\/video\//i.test(url)
    || /youtube\.com\/(c\/|channel\/|@|playlist\?)/i.test(url)
    || /instagram\.com\/[\w.]+/i.test(url) && !/\/(p|reel)\//i.test(url);

  const args = ['--dump-json', '--no-download', '--no-warnings'];
  if (isProfile) args.push('--playlist-items', '1:30');
  args.push(url);

  const timeout = isProfile ? 90000 : 30000;

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn(ytdlp, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.slice(-200)));
      try {
        // Profile pages output one JSON object per line (one per video)
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length === 1) {
          resolve(JSON.parse(lines[0]));
        } else {
          // Multiple items — wrap as a playlist-style response
          const items = lines.map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
          resolve({
            _type: 'playlist',
            type: 'playlist',
            title: items[0]?.playlist_title || items[0]?.channel || 'Profile',
            entries: items,
            itemCount: items.length,
          });
        }
      } catch {
        reject(new Error('Failed to parse video info'));
      }
    });

    setTimeout(() => { proc.kill(); reject(new Error('Info fetch timed out')); }, timeout);
  });
});

// ── IPC: Local Montage Rip (yt-dlp + FFmpeg scene detect + split) ──
function getFfmpegPath() {
  // Check common paths
  for (const p of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    if (fs.existsSync(p)) return p;
  }
  try {
    return execSync('which ffmpeg').toString().trim() || null;
  } catch { return null; }
}

function getFfprobePath() {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) return null;
  const probe = ffmpeg.replace(/ffmpeg$/, 'ffprobe');
  return fs.existsSync(probe) ? probe : null;
}

/**
 * Detect scene boundaries using TransNetV2 (AI) or FFmpeg scdet (fallback).
 * Returns array of timestamps (seconds) where cuts occur.
 */
async function detectScenes(videoPath, threshold) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) throw new Error('FFmpeg not found');

  // Primary: histogram-based scene detection (PySceneDetect-style, proven reliable)
  try {
    const cuts = scenedetect.detectScenes(videoPath, ffmpeg, {
      threshold: threshold || 0.3,
      minSceneDuration: 0.15, // allow very short clips (montage-style)
    });
    if (cuts.length > 0) return cuts;
  } catch (err) {
    console.warn(`[scdet] Histogram detector failed: ${err.message}`);
  }

  // Fallback: FFmpeg scdet
  const scdetThreshold = Math.round((threshold || 0.5) * 80);
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const args = ['-v', 'info', '-i', videoPath, '-filter:v', `scdet=threshold=${scdetThreshold}`, '-an', '-f', 'null', '-'];
    let stderr = '';
    const proc = spawn(ffmpeg, args, { timeout: 120000 });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const times = [];
      const regex = /lavfi\.scd\.time:\s*([\d.]+)/g;
      let match;
      while ((match = regex.exec(stderr)) !== null) times.push(parseFloat(match[1]));
      console.log(`[scdet] FFmpeg fallback: ${times.length} cuts in ${path.basename(videoPath)}`);
      resolve(times);
    });
    proc.on('error', reject);
  });
}

/**
 * Get video duration using ffprobe.
 */
function getVideoDuration(videoPath) {
  const ffprobe = getFfprobePath();
  if (!ffprobe) return 0;
  try {
    const out = execSync(
      `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { timeout: 10000 }
    ).toString().trim();
    return parseFloat(out) || 0;
  } catch { return 0; }
}

/**
 * Split a video at given timestamps using FFmpeg.
 * Returns array of output file paths.
 */
function splitVideo(videoPath, cutTimes, outputDir) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) throw new Error('FFmpeg not found');
  const duration = getVideoDuration(videoPath);
  const basename = path.basename(videoPath, path.extname(videoPath));

  // Build segments: [0, cut1], [cut1, cut2], ..., [cutN, end]
  const boundaries = [0, ...cutTimes];
  if (duration > 0) boundaries.push(duration);

  const clips = [];
  const promises = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const rawStart = boundaries[i];
    // Offset by 1 frame (~0.033s at 30fps) to avoid grabbing the last frame of the previous scene
    const start = i > 0 ? rawStart + 0.033 : rawStart;
    const end = boundaries[i + 1];
    const clipDur = end - start;
    if (clipDur < 0.03) continue;

    const clipName = `${basename}_clip${String(i + 1).padStart(3, '0')}.mp4`;
    const clipPath = path.join(outputDir, clipName);

    promises.push(new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const args = [
        '-y',
        '-i', videoPath,
        '-ss', String(start), // -ss AFTER -i for frame-accurate seek
        '-t', String(clipDur),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', // re-encode for accuracy
        '-c:a', 'aac', '-b:a', '128k',
        '-avoid_negative_ts', 'make_zero',
        clipPath
      ];
      const proc = spawn(ffmpeg, args, { timeout: 30000 });
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
          // Generate thumbnail
          const thumbName = clipName.replace(/\.mp4$/i, '.jpg');
          const thumbDir = path.join(outputDir, '.thumbnails');
          const thumbPath = path.join(thumbDir, thumbName);
          try {
            fs.mkdirSync(thumbDir, { recursive: true });
            execSync(`"${ffmpeg}" -y -i "${clipPath}" -ss 0 -vframes 1 -vf "scale=480:-1" -q:v 3 "${thumbPath}"`, { timeout: 10000 });
          } catch {}
          const hasThumb = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0;

          clips.push({
            id: `rip_${basename}_clip${String(i + 1).padStart(3, '0')}_${Date.now()}`,
            sourceId: `rip_${basename}_clip${String(i + 1).padStart(3, '0')}`,
            name: clipName,
            path: clipPath,
            localUrl: toLocalUrl(clipPath),
            thumbnailUrl: hasThumb ? toLocalUrl(thumbPath) : null,
            size: fs.statSync(clipPath).size,
            type: 'video',
            clipIndex: i,
            startTime: start,
            duration: clipDur,
          });
        }
        resolve();
      });
      proc.on('error', resolve);
    }));
  }

  return Promise.all(promises).then(() =>
    clips.sort((a, b) => a.clipIndex - b.clipIndex)
  );
}

/**
 * Compute a perceptual hash (aHash) from an 8x8 grayscale frame.
 * Returns a 64-bit hash as a BigInt. Similar images → similar hash.
 */
function perceptualHash(videoPath, ffmpegPath) {
  try {
    // Extract one 8x8 grayscale frame
    const raw = execSync(
      `"${ffmpegPath}" -v error -i "${videoPath}" -vf "scale=8:8,format=gray" -vframes 1 -f rawvideo pipe:1`,
      { maxBuffer: 1024, timeout: 10000 }
    );
    if (raw.length < 64) return null;
    // Average hash: each pixel → 1 if above average, 0 if below
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += raw[i];
    const avg = sum / 64;
    let hash = BigInt(0);
    for (let i = 0; i < 64; i++) {
      if (raw[i] > avg) hash |= BigInt(1) << BigInt(i);
    }
    return hash;
  } catch { return null; }
}

/**
 * Hamming distance between two 64-bit hashes.
 */
function hammingDistance(a, b) {
  let xor = a ^ b;
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

/**
 * Deduplicate clips: group visually similar clips, keep only the longest from each group.
 * Uses perceptual hashing (aHash) on the first frame of each clip.
 *
 * @param {Array} clips - Clip objects with { path, duration, ... }
 * @param {string} ffmpegPath - Path to FFmpeg
 * @param {number} [maxDist=10] - Max hamming distance to consider clips as duplicates
 * @returns {Array} Deduplicated clips (longest kept from each group)
 */
function deduplicateClips(clips, ffmpegPath, maxDist = 3) {
  if (clips.length <= 1) return clips;

  // Compute hashes
  const hashed = clips.map((clip) => ({
    ...clip,
    _hash: perceptualHash(clip.path, ffmpegPath),
  }));

  // Group by similarity
  const used = new Set();
  const groups = [];
  for (let i = 0; i < hashed.length; i++) {
    if (used.has(i) || !hashed[i]._hash) continue;
    const group = [i];
    used.add(i);
    for (let j = i + 1; j < hashed.length; j++) {
      if (used.has(j) || !hashed[j]._hash) continue;
      if (hammingDistance(hashed[i]._hash, hashed[j]._hash) <= maxDist) {
        group.push(j);
        used.add(j);
      }
    }
    groups.push(group);
  }

  // Keep the longest clip from each group
  const kept = [];
  for (const group of groups) {
    let bestIdx = group[0];
    let bestDur = hashed[bestIdx].duration || 0;
    for (const idx of group) {
      const dur = hashed[idx].duration || 0;
      if (dur > bestDur) {
        bestDur = dur;
        bestIdx = idx;
      }
    }
    const clip = { ...hashed[bestIdx] };
    delete clip._hash;
    kept.push(clip);

    // Delete duplicate files from disk
    for (const idx of group) {
      if (idx !== bestIdx) {
        try { fs.unlinkSync(hashed[idx].path); } catch {}
        // Also delete thumbnail if it exists
        const thumbPath = hashed[idx].path.replace(/\.mp4$/i, '.jpg');
        const thumbDir = path.join(path.dirname(hashed[idx].path), '.thumbnails');
        try { fs.unlinkSync(path.join(thumbDir, path.basename(thumbPath))); } catch {}
      }
    }
  }

  // Add any clips that couldn't be hashed (keep them all)
  for (let i = 0; i < hashed.length; i++) {
    if (!hashed[i]._hash && !used.has(i)) {
      const clip = { ...hashed[i] };
      delete clip._hash;
      kept.push(clip);
    }
  }

  const removed = clips.length - kept.length;
  if (removed > 0) {
    console.log(`[dedup] Removed ${removed} duplicates, kept ${kept.length} unique clips`);
  }
  return kept.sort((a, b) => (a.clipIndex || 0) - (b.clipIndex || 0));
}

/**
 * Full local rip pipeline:
 * 1. Download videos via yt-dlp
 * 2. Scene detect via TransNetV2/FFmpeg
 * 3. Split into clips
 * 4. Return clip file info
 */
ipcMain.handle('local-rip', async (_event, urls, outputDir, options = {}) => {
  const ytdlp = getYtdlpPath();
  if (!ytdlp) throw new Error('yt-dlp not found');
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) throw new Error('FFmpeg not found');

  const mediaFolder = store.get('mediaFolder');
  const targetDir = outputDir || (mediaFolder
    ? path.join(mediaFolder, 'StickToMusic', 'Downloads')
    : app.getPath('downloads'));
  fs.mkdirSync(targetDir, { recursive: true });

  const threshold = options.sceneThreshold || 0.5;
  const allClips = [];
  const urlList = Array.isArray(urls) ? urls : [urls];

  for (let vi = 0; vi < urlList.length; vi++) {
    const videoUrl = urlList[vi];

    // ── Step 1: Download via yt-dlp ──
    if (mainWindow) {
      mainWindow.webContents.send('local-rip-progress', {
        phase: 'downloading',
        message: `Downloading ${vi + 1} of ${urlList.length}...`,
        videoIndex: vi,
        totalVideos: urlList.length,
      });
    }

    let videoPath;
    try {
      // --restrict-filenames: replaces #, spaces, unicode with safe ASCII chars
      // --print after_move:filepath: outputs the exact final filepath (no guessing)
      const outputTemplate = path.join(targetDir, `dl_${vi + 1}_%(title).60s.%(ext)s`);
      videoPath = await new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const args = [
          '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
          '--merge-output-format', 'mp4',
          '--no-playlist',
          '--restrict-filenames',
          '--print', 'after_move:filepath',
          '-o', outputTemplate,
          videoUrl,
        ];
        const proc = spawn(ytdlp, args, { cwd: targetDir });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => {
          const line = d.toString();
          stdout += line;
          const match = line.match(/(\d+\.?\d*)%/);
          if (match && mainWindow) {
            mainWindow.webContents.send('local-rip-progress', {
              phase: 'downloading',
              message: `Downloading ${vi + 1}/${urlList.length}... ${Math.round(parseFloat(match[1]))}%`,
              percent: parseFloat(match[1]),
            });
          }
        });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code !== 0) return reject(new Error(`yt-dlp: ${stderr.slice(-200)}`));
          // --print after_move:filepath outputs the final path as the LAST line
          const lines = stdout.trim().split('\n').filter(Boolean);
          const finalPath = lines[lines.length - 1]?.trim();
          if (finalPath && fs.existsSync(finalPath)) {
            resolve(finalPath);
          } else {
            // Fallback: find the dl_{vi+1}_ prefixed file
            const prefix = `dl_${vi + 1}_`;
            const found = fs.readdirSync(targetDir)
              .filter((f) => f.startsWith(prefix) && /\.(mp4|webm|mkv|mov)$/i.test(f))
              .map((f) => path.join(targetDir, f))
              .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
            found ? resolve(found) : reject(new Error('Downloaded file not found'));
          }
        });
        setTimeout(() => { proc.kill(); reject(new Error('Download timed out')); }, 300000);
      });
    } catch (err) {
      console.warn(`[local-rip] Download failed for ${videoUrl}: ${err.message}`);
      continue;
    }

    console.log(`[local-rip] Downloaded: ${path.basename(videoPath)}`);

    // ── Step 2: Scene detect ──
    if (mainWindow) {
      mainWindow.webContents.send('local-rip-progress', {
        phase: 'detecting',
        message: `Detecting scenes in video ${vi + 1}...`,
      });
    }

    const cutTimes = await detectScenes(videoPath, threshold);
    console.log(`[local-rip] ${path.basename(videoPath)}: ${cutTimes.length} scene cuts`);

    if (cutTimes.length === 0) {
      // No scenes — return the whole video as one clip with thumbnail
      const stat = fs.statSync(videoPath);
      const thumbDir = path.join(targetDir, '.thumbnails');
      const thumbName = path.basename(videoPath, path.extname(videoPath)) + '.jpg';
      const thumbPath = path.join(thumbDir, thumbName);
      try {
        fs.mkdirSync(thumbDir, { recursive: true });
        execSync(`"${ffmpeg}" -y -i "${videoPath}" -ss 0 -vframes 1 -vf "scale=480:-1" -q:v 3 "${thumbPath}"`, { timeout: 10000 });
      } catch {}
      const hasThumb = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0;
      allClips.push({
        name: path.basename(videoPath),
        path: videoPath,
        localUrl: toLocalUrl(videoPath),
        thumbnailUrl: hasThumb ? toLocalUrl(thumbPath) : null,
        size: stat.size,
        type: 'video',
        clipIndex: 0,
        startTime: 0,
        duration: getVideoDuration(videoPath),
      });
      continue;
    }

    // ── Step 3: Split ──
    if (mainWindow) {
      mainWindow.webContents.send('local-rip-progress', {
        phase: 'splitting',
        message: `Splitting video ${vi + 1} into ${cutTimes.length + 1} clips...`,
      });
    }

    const clips = await splitVideo(videoPath, cutTimes, targetDir);
    allClips.push(...clips);

    // Remove the original full video after splitting
    if (clips.length > 0) {
      try { fs.unlinkSync(videoPath); } catch {}
    }
  }

  // Dedup disabled — montage clips are intentionally different, 8x8 hash is too coarse
  // to distinguish moody/dark aesthetic clips. Keep all clips the scene detector found.
  if (false && allClips.length > 1) {
    if (mainWindow) {
      mainWindow.webContents.send('local-rip-progress', {
        phase: 'deduplicating',
        message: `Removing duplicates from ${allClips.length} clips...`,
      });
    }
    const ffmpeg = getFfmpegPath();
    const uniqueClips = deduplicateClips(allClips, ffmpeg);
    const removed = allClips.length - uniqueClips.length;
    allClips.length = 0;
    allClips.push(...uniqueClips);
    if (removed > 0) console.log(`[local-rip] Dedup: ${removed} duplicates removed`);
  }

  if (mainWindow) {
    mainWindow.webContents.send('local-rip-progress', {
      phase: 'complete',
      message: `Done! ${allClips.length} unique clips.`,
      totalClips: allClips.length,
    });
  }

  console.log(`[local-rip] Pipeline complete: ${allClips.length} unique clips from ${urls.length} videos`);
  return allClips;
});

ipcMain.handle('ffmpeg-available', () => {
  return getFfmpegPath() !== null;
});

// ── Embedded Server (serves production build + proxies API) ──
const VERCEL_TARGET = 'https://sticktomusic.com';
let serverPort = 3000; // dev default; production picks a random available port

function startEmbeddedServer() {
  return new Promise((resolve) => {
    const server = express();
    server.use(express.json({ limit: '10mb' }));

    // API proxy — forward /api/* to sticktomusic.com
    server.all('/api/*', async (req, res) => {
      const targetUrl = `${VERCEL_TARGET}${req.originalUrl}`;
      try {
        const headers = {
          'Origin': 'https://sticktomusic.com',
          'Referer': 'https://sticktomusic.com/',
          'Accept': 'application/json',
        };
        if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
        if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

        const fetchOptions = { method: req.method, headers };
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
          fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl, fetchOptions);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') return res.status(200).end();

        const contentType = response.headers.get('content-type') || '';
        const body = await response.text();
        res.status(response.status);
        if (contentType.includes('json')) res.setHeader('Content-Type', 'application/json');
        res.send(body);
      } catch (err) {
        console.error(`[proxy] Error: ${req.method} ${req.originalUrl}:`, err.message);
        res.status(502).json({ error: 'Proxy error: ' + err.message });
      }
    });

    // Serve local media files — allows the renderer to load local content without CORS issues
    server.get('/local-media/*', (req, res) => {
      const mediaFolder = store.get('mediaFolder');
      if (!mediaFolder) return res.status(404).send('No media folder');
      // req.params[0] is already URL-decoded by Express
      const relativePath = req.params[0];
      // CORS headers for media playback
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
      // Reject obvious bad inputs before resolving
      if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
        return res.status(400).send('Invalid path');
      }
      // Resolve and verify it stays inside the media folder. `path.join`
      // alone is unsafe — `mediaFolder + "../"` would still satisfy a
      // naive `startsWith` check if a sibling dir shares a prefix.
      const fullPath = path.resolve(mediaFolder, relativePath);
      const rel = path.relative(mediaFolder, fullPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).send('Forbidden');
      }
      if (!fs.existsSync(fullPath)) return res.status(404).send('Not found');
      res.sendFile(fullPath);
    });

    // Serve static build files
    // Dev: build/ at project root. Production: app-build/ (legacy name, copied by build script)
    const buildPath = isDev
      ? path.join(__dirname, '..', 'build')
      : path.join(__dirname, '..', 'app-build');
    server.use(express.static(buildPath));

    // SPA fallback — serve index.html for all non-API, non-static routes
    server.get('*', (req, res) => {
      res.sendFile(path.join(buildPath, 'index.html'));
    });

    // Use fixed port so Firebase Auth can whitelist localhost
    const PROD_PORT = 4321;
    const listener = server.listen(PROD_PORT, () => {
      serverPort = listener.address().port;
      console.log(`[server] Embedded server running on http://localhost:${serverPort}`);
      resolve(serverPort);
    });
    // Fallback to random port if 4321 is taken
    listener.on('error', () => {
      const fallback = server.listen(0, () => {
        serverPort = fallback.address().port;
        console.log(`[server] Embedded server running on http://localhost:${serverPort} (fallback)`);
        resolve(serverPort);
      });
    });
  });
}

// ── App Lifecycle ──
app.whenReady().then(async () => {
  // Wait for electron-store to initialize before anything else
  await _storeReady;

  // Firebase session handling
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.firebaseapp.com/*', '*://*.googleapis.com/*'] },
    (details, callback) => {
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // Start embedded server in ALL modes (serves /local-media/* for desktop file access)
  await startEmbeddedServer();

  buildMenu();
  createWindow();
  setupAutoUpdater();

  // Check for updates 5 seconds after launch (non-blocking)
  if (autoUpdater && !isDev) {
    setTimeout(() => {
      try { autoUpdater.checkForUpdates().catch(() => {}); } catch {}
    }, 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
