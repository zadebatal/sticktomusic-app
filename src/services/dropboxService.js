/**
 * Dropbox Service — OAuth2 PKCE + file import/export
 *
 * Handles:
 * - Dropbox OAuth2 PKCE authentication via popup flow
 * - File listing and browsing in Dropbox
 * - File download (Dropbox → app library)
 * - File upload (app library → Dropbox)
 * - Auto-create StickToMusic folder structure
 *
 * Settings stored in Firestore at:
 *   artists/{artistId}/settings/dropbox
 *
 * @see googleDriveService.js for parallel Google Drive integration
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import log from '../utils/logger';

// ── Constants ──

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API_URL = 'https://api.dropboxapi.com/2';
const CONTENT_URL = 'https://content.dropboxapi.com/2';

let appKey = null;
let accessToken = null;
let refreshToken = null;

// ── Initialization ──

/**
 * Initialize Dropbox with app key
 * @param {string} key - Dropbox App Key from console
 */
export function initDropbox(key) {
  appKey = key;
  log('[Dropbox] Initialized with app key');
}

// ── OAuth2 PKCE Authentication ──

/**
 * Generate a random code verifier for PKCE
 */
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate code challenge from verifier (S256)
 */
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Authenticate with Dropbox via OAuth2 PKCE popup
 * Returns the access token
 */
export async function authenticate() {
  if (!appKey) {
    throw new Error('Dropbox not initialized. Call initDropbox() first.');
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const redirectUri = `${window.location.origin}/dropbox-callback`;
  const state = crypto.randomUUID();

  const authUrl = `${AUTH_URL}?` + new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    state,
    token_access_type: 'offline'
  }).toString();

  return new Promise((resolve, reject) => {
    const width = 500;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    const popup = window.open(
      authUrl, 'dropbox-auth',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        if (popup.closed) {
          clearInterval(pollInterval);
          reject(new Error('Authentication cancelled'));
          return;
        }

        const popupUrl = popup.location.href;
        if (popupUrl.includes('code=')) {
          clearInterval(pollInterval);
          popup.close();

          const url = new URL(popupUrl);
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');

          if (returnedState !== state) {
            reject(new Error('State mismatch — possible CSRF attack'));
            return;
          }

          // Exchange code for token
          const tokenResp = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              grant_type: 'authorization_code',
              client_id: appKey,
              redirect_uri: redirectUri,
              code_verifier: codeVerifier
            })
          });

          if (!tokenResp.ok) {
            const err = await tokenResp.text();
            reject(new Error(`Token exchange failed: ${err}`));
            return;
          }

          const tokenData = await tokenResp.json();
          accessToken = tokenData.access_token;
          refreshToken = tokenData.refresh_token || null;
          log('[Dropbox] Authenticated');
          resolve(accessToken);
        }
      } catch {
        // Cross-origin — popup hasn't redirected back yet, keep polling
      }
    }, 500);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      if (!popup.closed) popup.close();
      reject(new Error('Authentication timed out'));
    }, 300000);
  });
}

/**
 * Check if currently authenticated
 */
export function isAuthenticated() {
  return !!accessToken;
}

/**
 * Clear the access token
 */
export function disconnect() {
  if (accessToken) {
    // Revoke token
    fetch(`${API_URL}/auth/token/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    }).catch(() => {});
    accessToken = null;
    refreshToken = null;
    log('[Dropbox] Disconnected');
  }
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken() {
  if (!refreshToken || !appKey) return false;

  try {
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey
      })
    });

    if (!resp.ok) return false;

    const data = await resp.json();
    accessToken = data.access_token;
    log('[Dropbox] Token refreshed');
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure we have a valid access token
 */
async function ensureAuth() {
  if (!accessToken) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      await authenticate();
    }
  }
}

// ── File Operations ──

/**
 * Make an API call to Dropbox with automatic retry on 401
 */
async function apiCall(url, options = {}) {
  const makeRequest = () => fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers
    }
  });

  let response = await makeRequest();

  // Retry once on 401 with token refresh
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await makeRequest();
    } else {
      await authenticate();
      response = await makeRequest();
    }
  }

  return response;
}

/**
 * List files in a Dropbox folder
 * @param {string} path - Folder path ('' for root)
 * @param {Object} options - { limit, cursor }
 * @returns {{ entries: Array, cursor: string, hasMore: boolean }}
 */
export async function listFiles(path = '', options = {}) {
  await ensureAuth();

  const { limit = 50, cursor } = options;

  const endpoint = cursor
    ? `${API_URL}/files/list_folder/continue`
    : `${API_URL}/files/list_folder`;

  const body = cursor
    ? { cursor }
    : { path: path || '', limit, include_media_info: true };

  const response = await apiCall(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`List failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    entries: (data.entries || []).map(entry => ({
      id: entry.id,
      name: entry.name,
      path: entry.path_display,
      isFolder: entry['.tag'] === 'folder',
      size: entry.size,
      modifiedAt: entry.client_modified || entry.server_modified,
      mediaInfo: entry.media_info
    })),
    cursor: data.cursor,
    hasMore: data.has_more
  };
}

/**
 * Search files in Dropbox
 * @param {string} query - Search query
 * @param {Object} options - { path, maxResults, fileExtensions }
 * @returns {{ matches: Array }}
 */
export async function searchFiles(query, options = {}) {
  await ensureAuth();

  const { path, maxResults = 20, fileExtensions } = options;

  const body = {
    query,
    options: {
      max_results: maxResults,
      path: path || '',
      file_status: 'active'
    }
  };

  if (fileExtensions) {
    body.options.file_extensions = fileExtensions;
  }

  const response = await apiCall(`${API_URL}/files/search_v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    matches: (data.matches || []).map(m => {
      const entry = m.metadata?.metadata || m.metadata;
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path_display,
        isFolder: entry['.tag'] === 'folder',
        size: entry.size,
        modifiedAt: entry.client_modified || entry.server_modified
      };
    })
  };
}

/**
 * Download a file from Dropbox as a Blob
 * @param {string} path - File path in Dropbox
 * @returns {Blob}
 */
export async function downloadFile(path) {
  await ensureAuth();

  const response = await apiCall(`${CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: {
      'Dropbox-API-Arg': JSON.stringify({ path })
    }
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  return response.blob();
}

/**
 * Upload a file to Dropbox
 * @param {Blob|File} file - File to upload
 * @param {string} path - Destination path in Dropbox (e.g., '/StickToMusic/Artist/file.mp4')
 * @param {string} mode - 'add' (no overwrite) or 'overwrite'
 * @returns {Object} - File metadata
 */
export async function uploadFile(file, path, mode = 'add') {
  await ensureAuth();

  const response = await apiCall(`${CONTENT_URL}/files/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode,
        autorename: true,
        mute: false
      })
    },
    body: file
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  log('[Dropbox] Uploaded:', result.name);
  return {
    id: result.id,
    name: result.name,
    path: result.path_display,
    size: result.size
  };
}

/**
 * Create a folder in Dropbox
 * @param {string} path - Full folder path (e.g., '/StickToMusic/ArtistName')
 * @returns {Object} - Folder metadata
 */
export async function createFolder(path) {
  await ensureAuth();

  const response = await apiCall(`${API_URL}/files/create_folder_v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, autorename: false })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    // Folder already exists — not an error
    if (body?.error?.['.tag'] === 'path' && body?.error?.path?.['.tag'] === 'conflict') {
      log('[Dropbox] Folder already exists:', path);
      return { path, name: path.split('/').pop() };
    }
    throw new Error(`Create folder failed: ${response.status}`);
  }

  const data = await response.json();
  const metadata = data.metadata;
  log('[Dropbox] Created folder:', metadata.path_display);
  return {
    id: metadata.id,
    name: metadata.name,
    path: metadata.path_display
  };
}

/**
 * Find or create StickToMusic folder structure
 * Creates /StickToMusic/{artistName}/ if not exists
 * @param {string} artistName
 * @returns {{ rootPath: string, artistPath: string }}
 */
export async function ensureAppFolder(artistName) {
  await ensureAuth();

  const rootPath = '/StickToMusic';
  const artistPath = `${rootPath}/${artistName}`;

  // Create both folders (create_folder_v2 is idempotent via conflict handling)
  await createFolder(rootPath);
  await createFolder(artistPath);

  return { rootPath, artistPath };
}

/**
 * Get a temporary download link for a file
 * @param {string} path - File path
 * @returns {string} - Temporary download URL (valid for 4 hours)
 */
export async function getTemporaryLink(path) {
  await ensureAuth();

  const response = await apiCall(`${API_URL}/files/get_temporary_link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });

  if (!response.ok) {
    throw new Error(`Get link failed: ${response.status}`);
  }

  const data = await response.json();
  return data.link;
}

// ── Settings (Firestore) ──

/**
 * Get Dropbox settings for an artist
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @returns {Object}
 */
export async function getDropboxSettings(db, artistId) {
  try {
    const docRef = doc(db, 'artists', artistId, 'settings', 'dropbox');
    const snap = await getDoc(docRef);
    if (snap.exists()) return snap.data();
    return { connected: false, defaultFolderPath: null, autoSync: false, lastSyncAt: null };
  } catch (error) {
    log('[Dropbox] Settings load failed:', error);
    return { connected: false, defaultFolderPath: null, autoSync: false, lastSyncAt: null };
  }
}

/**
 * Save Dropbox settings for an artist
 * @param {Object} db
 * @param {string} artistId
 * @param {Object} settings
 */
export async function saveDropboxSettings(db, artistId, settings) {
  try {
    const docRef = doc(db, 'artists', artistId, 'settings', 'dropbox');
    await setDoc(docRef, {
      ...settings,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    log('[Dropbox] Settings saved');
  } catch (error) {
    log('[Dropbox] Settings save failed:', error);
  }
}

// ── MIME type helpers ──

export const DROPBOX_EXTENSIONS = {
  VIDEO: ['mp4', 'mov', 'webm', 'avi'],
  AUDIO: ['mp3', 'wav', 'ogg', 'aac', 'm4a'],
  IMAGE: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff'],
  ALL_MEDIA: ['mp4', 'mov', 'webm', 'mp3', 'wav', 'ogg', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff']
};

/**
 * Detect media type from file name
 * @param {string} name - File name
 * @returns {'image'|'video'|'audio'|null}
 */
export function detectMediaType(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (DROPBOX_EXTENSIONS.IMAGE.includes(ext)) return 'image';
  if (DROPBOX_EXTENSIONS.VIDEO.includes(ext)) return 'video';
  if (DROPBOX_EXTENSIONS.AUDIO.includes(ext)) return 'audio';
  return null;
}

export default {
  initDropbox,
  authenticate,
  isAuthenticated,
  disconnect,
  listFiles,
  searchFiles,
  downloadFile,
  uploadFile,
  createFolder,
  ensureAppFolder,
  getTemporaryLink,
  getDropboxSettings,
  saveDropboxSettings,
  detectMediaType,
  DROPBOX_EXTENSIONS
};
