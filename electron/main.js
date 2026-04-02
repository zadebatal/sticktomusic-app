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

// electron-updater is optional in dev (not installed in root devDeps initially)
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch {
  // Not available in dev — that's fine
}

// electron-store for persistent config
let Store = null;
let store = null;
try {
  Store = require('electron-store');
  store = new Store();
} catch {
  // Fallback: in-memory config if electron-store not installed
  const _mem = {};
  store = {
    get: (k, d) => (k in _mem ? _mem[k] : d),
    set: (k, v) => (_mem[k] = v),
  };
}

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
    mainWindow.loadFile(path.join(__dirname, '..', 'build', 'index.html'));
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
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Auto-Updater (DaVinci-style) ──
function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

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
  if (autoUpdater) autoUpdater.quitAndInstall();
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

ipcMain.handle('save-file-locally', async (_event, arrayBuffer, relativePath) => {
  const root = store.get('mediaFolder');
  if (!root) throw new Error('No media folder configured');
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, Buffer.from(arrayBuffer));
  console.log(`[storage] Saved: ${relativePath}`);
  return fullPath;
});

ipcMain.handle('read-local-file', async (_event, relativePath) => {
  const root = store.get('mediaFolder');
  if (!root) throw new Error('No media folder configured');
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('File not found');
  return fs.readFileSync(fullPath);
});

ipcMain.handle('check-file-exists', async (_event, relativePath) => {
  const root = store.get('mediaFolder');
  if (!root) return false;
  return fs.existsSync(path.join(root, relativePath));
});

ipcMain.handle('is-drive-connected', () => {
  const root = store.get('mediaFolder');
  if (!root) return false;
  return fs.existsSync(root);
});

ipcMain.handle('get-local-file-url', (_event, relativePath) => {
  const root = store.get('mediaFolder');
  if (!root) return null;
  const fullPath = path.join(root, relativePath);
  // file:// protocol with proper encoding for spaces and special chars
  return `file://${encodeURI(fullPath).replace(/#/g, '%23')}`;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
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

// ── IPC: Onboarding complete flag ──
ipcMain.handle('is-onboarding-complete', () => {
  return store.get('onboardingComplete', false);
});

ipcMain.handle('set-onboarding-complete', (_event, value) => {
  store.set('onboardingComplete', !!value);
});

// ── App Lifecycle ──
app.whenReady().then(() => {
  // Firebase session handling
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.firebaseapp.com/*', '*://*.googleapis.com/*'] },
    (details, callback) => {
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  buildMenu();
  createWindow();
  setupAutoUpdater();

  // Check for updates 5 seconds after launch (non-blocking)
  if (autoUpdater && !isDev) {
    setTimeout(() => autoUpdater.checkForUpdates(), 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
