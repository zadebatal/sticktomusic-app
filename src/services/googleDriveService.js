/**
 * Google Drive Service — OAuth + file import/export (Wave 5)
 *
 * Handles:
 * - Google OAuth2 authentication via popup flow
 * - File listing and browsing in Drive
 * - File download (Drive → app library)
 * - File upload (app library → Drive)
 * - Auto-create StickToMusic folder structure
 *
 * Settings stored in Firestore at:
 *   artists/{artistId}/settings/googleDrive
 *
 * @see docs/DOMAIN_INVARIANTS.md — no sensitive tokens in localStorage
 */

import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import log from '../utils/logger';

// ── Constants ──

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

// These will be set via initGoogleDrive()
let gapiLoaded = false;
let gisLoaded = false;
let tokenClient = null;
let accessToken = null;

// ── Initialization ──

/**
 * Load the Google API client library and Google Identity Services
 * Call this once on app mount (before any Drive operations)
 *
 * @param {string} clientId - Google OAuth2 Client ID
 * @param {string} apiKey - Google API key (for Picker)
 */
export async function initGoogleDrive(clientId, apiKey) {
  if (gapiLoaded && gisLoaded) return;

  // Load GAPI
  await new Promise((resolve, reject) => {
    if (window.gapi) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google API script'));
    document.body.appendChild(script);
  });

  await new Promise((resolve) => {
    window.gapi.load('client:picker', resolve);
  });

  try {
    await window.gapi.client.init({
      apiKey,
      discoveryDocs: [DISCOVERY_DOC]
    });
  } catch (err) {
    console.error('[GoogleDrive] gapi.client.init failed:', err);
    const msg = err?.result?.error?.message || err?.error?.message || err?.message || err?.error || JSON.stringify(err);
    throw new Error('Drive API init failed: ' + msg);
  }

  gapiLoaded = true;
  log('[GoogleDrive] GAPI loaded');

  // Load GIS (Google Identity Services)
  await new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
    document.body.appendChild(script);
  });

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: '' // Will be overridden per-call
  });

  gisLoaded = true;
  log('[GoogleDrive] GIS loaded');
}

// ── Authentication ──

/**
 * Authenticate with Google Drive via OAuth2 popup
 * Returns the access token
 */
export function authenticate() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('Google Drive not initialized. Call initGoogleDrive() first.'));
      return;
    }

    tokenClient.callback = async (response) => {
      if (response.error) {
        console.error('[GoogleDrive] Auth error:', response);
        reject(new Error(response.error_description || response.error));
        return;
      }
      accessToken = response.access_token;
      log('[GoogleDrive] Authenticated');
      resolve(accessToken);
    };

    if (accessToken) {
      // Already have a token, request a new one silently
      tokenClient.requestAccessToken({ prompt: '' });
    } else {
      // First time — show consent popup
      tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  });
}

/**
 * Check if currently authenticated
 */
export function isAuthenticated() {
  return !!accessToken;
}

/**
 * Revoke access token
 */
export function disconnect() {
  if (accessToken) {
    window.google.accounts.oauth2.revoke(accessToken, () => {
      accessToken = null;
      log('[GoogleDrive] Disconnected');
    });
  }
}

// ── File Operations ──

/**
 * List files in a Drive folder
 * @param {string} folderId - Folder ID (or 'root' for root)
 * @param {Object} options - { pageSize, pageToken, mimeType }
 * @returns {{ files: Array, nextPageToken: string }}
 */
export async function listFiles(folderId = 'root', options = {}) {
  await ensureAuth();

  const { pageSize = 20, pageToken, mimeType } = options;
  let query = `'${folderId}' in parents and trashed = false`;
  if (mimeType) {
    query += ` and mimeType = '${mimeType}'`;
  }

  const response = await window.gapi.client.drive.files.list({
    q: query,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, thumbnailLink, webContentLink)',
    pageSize,
    pageToken,
    orderBy: 'modifiedTime desc'
  });

  return {
    files: response.result.files || [],
    nextPageToken: response.result.nextPageToken
  };
}

/**
 * Search files across Drive
 * @param {string} query - Search query
 * @param {Object} options
 * @returns {{ files: Array, nextPageToken: string }}
 */
export async function searchFiles(query, options = {}) {
  await ensureAuth();

  const { pageSize = 20, pageToken, mimeType } = options;
  let q = `name contains '${query}' and trashed = false`;
  if (mimeType) {
    q += ` and mimeType = '${mimeType}'`;
  }

  const response = await window.gapi.client.drive.files.list({
    q,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, thumbnailLink, webContentLink)',
    pageSize,
    pageToken,
    orderBy: 'modifiedTime desc'
  });

  return {
    files: response.result.files || [],
    nextPageToken: response.result.nextPageToken
  };
}

/**
 * Download a file from Drive as a Blob
 * @param {string} fileId - Drive file ID
 * @returns {Blob}
 */
export async function downloadFile(fileId) {
  await ensureAuth();

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  return response.blob();
}

/**
 * Upload a file to Drive
 * @param {Blob|File} file - File to upload
 * @param {string} name - File name
 * @param {string} folderId - Target folder ID
 * @param {string} mimeType - MIME type
 * @returns {Object} - Drive file metadata
 */
export async function uploadFile(file, name, folderId, mimeType) {
  await ensureAuth();

  const metadata = {
    name,
    mimeType,
    parents: folderId ? [folderId] : undefined
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  log('[GoogleDrive] Uploaded:', result.name);
  return result;
}

/**
 * Create a folder in Drive
 * @param {string} name - Folder name
 * @param {string} parentId - Parent folder ID (or null for root)
 * @returns {Object} - Created folder metadata
 */
export async function createFolder(name, parentId = null) {
  await ensureAuth();

  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined
  };

  const response = await window.gapi.client.drive.files.create({
    resource: metadata,
    fields: 'id, name'
  });

  log('[GoogleDrive] Created folder:', response.result.name);
  return response.result;
}

/**
 * Find or create StickToMusic folder structure
 * Creates /StickToMusic/{artistName}/ if not exists
 * @param {string} artistName
 * @returns {{ rootFolderId: string, artistFolderId: string }}
 */
export async function ensureAppFolder(artistName) {
  await ensureAuth();

  // Find or create root /StickToMusic folder
  let rootFolder = await findFolder('StickToMusic', 'root');
  if (!rootFolder) {
    rootFolder = await createFolder('StickToMusic');
  }

  // Find or create artist subfolder
  let artistFolder = await findFolder(artistName, rootFolder.id);
  if (!artistFolder) {
    artistFolder = await createFolder(artistName, rootFolder.id);
  }

  return {
    rootFolderId: rootFolder.id,
    artistFolderId: artistFolder.id
  };
}

/**
 * Find a folder by name within a parent
 */
async function findFolder(name, parentId) {
  const response = await window.gapi.client.drive.files.list({
    q: `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1
  });

  return response.result.files?.[0] || null;
}

// ── Google Picker ──

/**
 * Open Google Picker for file selection
 * @param {string} apiKey - Google API key
 * @param {Object} options - { mimeTypes: string[], multiSelect: boolean }
 * @returns {Array} - Selected files [{ id, name, mimeType, url }]
 */
export function openPicker(apiKey, options = {}) {
  return new Promise((resolve, reject) => {
    if (!accessToken) {
      reject(new Error('Not authenticated'));
      return;
    }

    const { mimeTypes, multiSelect = false } = options;

    const view = new window.google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    if (mimeTypes && mimeTypes.length > 0) {
      view.setMimeTypes(mimeTypes.join(','));
    }

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          resolve(data.docs.map(doc => ({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
            url: doc.url,
            sizeBytes: doc.sizeBytes
          })));
        } else if (data.action === window.google.picker.Action.CANCEL) {
          resolve([]);
        }
      });

    if (multiSelect) {
      picker.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED);
    }

    picker.build().setVisible(true);
  });
}

// ── Settings (Firestore) ──

/**
 * Get Google Drive settings for an artist
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @returns {Object} - { connected, defaultFolderId, autoSync, lastSyncAt }
 */
export async function getDriveSettings(db, artistId) {
  try {
    const docRef = doc(db, 'artists', artistId, 'settings', 'googleDrive');
    const snap = await getDoc(docRef);
    if (snap.exists()) return snap.data();
    return { connected: false, defaultFolderId: null, autoSync: false, lastSyncAt: null };
  } catch (error) {
    log('[GoogleDrive] Settings load failed:', error);
    return { connected: false, defaultFolderId: null, autoSync: false, lastSyncAt: null };
  }
}

/**
 * Save Google Drive settings for an artist
 * @param {Object} db
 * @param {string} artistId
 * @param {Object} settings
 */
export async function saveDriveSettings(db, artistId, settings) {
  try {
    const docRef = doc(db, 'artists', artistId, 'settings', 'googleDrive');
    await setDoc(docRef, {
      ...settings,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    log('[GoogleDrive] Settings saved');
  } catch (error) {
    log('[GoogleDrive] Settings save failed:', error);
  }
}

// ── Helpers ──

/**
 * Ensure we have a valid access token
 */
async function ensureAuth() {
  if (!accessToken) {
    await authenticate();
  }
}

/**
 * Get file metadata by ID
 */
export async function getFileMetadata(fileId) {
  await ensureAuth();

  const response = await window.gapi.client.drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, modifiedTime, thumbnailLink, webContentLink, webViewLink'
  });

  return response.result;
}

/**
 * MIME type helpers for filtering
 */
export const DRIVE_MIME_TYPES = {
  VIDEO: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'],
  AUDIO: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4'],
  IMAGE: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff'],
  ALL_MEDIA: [
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff'
  ]
};

export default {
  initGoogleDrive,
  authenticate,
  isAuthenticated,
  disconnect,
  listFiles,
  searchFiles,
  downloadFile,
  uploadFile,
  createFolder,
  ensureAppFolder,
  openPicker,
  getDriveSettings,
  saveDriveSettings,
  getFileMetadata,
  DRIVE_MIME_TYPES
};
