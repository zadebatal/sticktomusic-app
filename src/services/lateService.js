/**
 * Late API Service
 * Handles authentication and account management for Late.co posting
 *
 * SECURITY:
 * - All API calls go through our authenticated serverless proxy
 * - Firebase ID token required for all operations
 * - No direct Late API key exposure to client
 *
 * INVARIANT: Late.co posting is an OPERATOR-ONLY action
 * @see docs/DOMAIN_INVARIANTS.md Section C
 */

import { isUserOperator } from '../utils/roles';
import { getAuth } from 'firebase/auth';

// Use our authenticated proxy instead of direct Late API
const LATE_PROXY = '/api/late';
const STORAGE_KEY = 'late_connected'; // Only store connection status, not token

/**
 * Get Firebase ID token for authenticated requests
 */
async function getFirebaseToken() {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user.getIdToken();
}

/**
 * Make authenticated request to our Late API proxy
 * @param {string} action - API action
 * @param {string} method - HTTP method
 * @param {Object} body - Request body
 * @param {string} artistId - Artist ID for per-artist Late API key lookup
 */
async function proxyRequest(action, method = 'GET', body = null, artistId = null) {
  const token = await getFirebaseToken();

  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', action);
  if (artistId) {
    url.searchParams.set('artistId', artistId);
  }

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * Assert user has operator privileges before Late.co operations
 * @param {Object} user - Current user object
 * @param {string} operation - What operation is being attempted
 * @throws {Error} If user is not operator
 */
function assertLateAccess(user, operation = 'Late.co operation') {
  if (user && !isUserOperator(user)) {
    const msg = `Permission denied: ${operation} requires operator access`;
    console.error('[LATE SERVICE]', msg);
    throw new Error(msg);
  }
}

export function storeLateConnection(connected = true) {
  try {
    localStorage.setItem(STORAGE_KEY, connected ? 'true' : 'false');
    return true;
  } catch (error) {
    console.error('Failed to store Late connection status:', error);
    return false;
  }
}

export function getLateToken() {
  // For backward compatibility - check if connected
  return isLateConnected() ? 'connected' : null;
}

export function clearLateToken() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

export function isLateConnected() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

// ============================================
// PER-ARTIST LATE API KEY MANAGEMENT
// Keys are stored securely server-side, never exposed to client
// ============================================

/**
 * Save Late API key for an artist (securely stored server-side)
 * @param {string} artistId - Artist ID
 * @param {string} lateApiKey - Late API key to store
 */
export async function setArtistLateKey(artistId, lateApiKey) {
  if (!artistId || !lateApiKey) {
    throw new Error('artistId and lateApiKey are required');
  }

  return proxyRequest('setKey', 'POST', { artistId, lateApiKey });
}

/**
 * Remove Late API key for an artist
 * @param {string} artistId - Artist ID
 */
export async function removeArtistLateKey(artistId) {
  if (!artistId) {
    throw new Error('artistId is required');
  }

  const token = await getFirebaseToken();
  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', 'removeKey');
  url.searchParams.set('artistId', artistId);

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * Check if Late API key is configured for an artist
 * @param {string} artistId - Artist ID
 * @returns {Promise<{configured: boolean, updatedAt: string|null}>}
 */
export async function getArtistLateKeyStatus(artistId) {
  if (!artistId) {
    return { configured: false, updatedAt: null };
  }

  try {
    return await proxyRequest('keyStatus', 'GET', null, artistId);
  } catch (error) {
    console.error('Failed to check Late key status:', error);
    return { configured: false, updatedAt: null };
  }
}

// ============================================
// LATE API FUNCTIONS (now accept artistId)
// ============================================

export async function fetchLateAccounts(artistId = null) {
  try {
    const data = await proxyRequest('accounts', 'GET', null, artistId);
    const accounts = (data.accounts || data.data || []).map(account => ({
      id: account.id || account.account_id,
      platform: (account.platform || account.type || '').toLowerCase(),
      username: account.username || account.handle || account.name,
      profileImage: account.profile_image || account.avatar,
      name: account.display_name || account.name,
      isActive: account.is_active !== false
    }));

    return accounts.filter(a => a.isActive);
  } catch (error) {
    console.error('Failed to fetch Late accounts:', error);
    throw error;
  }
}

export async function validateLateToken(artistId = null) {
  // Token validation now happens server-side
  // This just checks if we can successfully call the proxy for this artist
  try {
    await proxyRequest('accounts', 'GET', null, artistId);
    return true;
  } catch {
    return false;
  }
}

export async function connectLate(artistId, lateApiKey = null) {
  // If lateApiKey provided, save it securely first
  if (lateApiKey && artistId) {
    await setArtistLateKey(artistId, lateApiKey);
  }

  // Verify connection works
  const isValid = await validateLateToken(artistId);
  if (!isValid) {
    throw new Error('Invalid Late API configuration');
  }

  storeLateConnection(true);
  const accounts = await fetchLateAccounts(artistId);
  return { success: true, accounts };
}

export function disconnectLate() {
  clearLateToken();
  return { success: true };
}

export async function schedulePost({ videoUrl, caption, accountIds, scheduledTime, user, artistId }) {
  // Operator check at API boundary (defense-in-depth)
  assertLateAccess(user, 'schedulePost');

  const payload = {
    media_url: videoUrl,
    caption,
    account_ids: accountIds
  };
  if (scheduledTime) {
    payload.scheduled_at = new Date(scheduledTime).toISOString();
  }

  return proxyRequest('posts', 'POST', payload, artistId);
}

export async function deletePost(postId, user, artistId = null) {
  assertLateAccess(user, 'deletePost');

  const token = await getFirebaseToken();
  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', 'delete');
  url.searchParams.set('postId', postId);
  if (artistId) {
    url.searchParams.set('artistId', artistId);
  }

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to delete post');
  }

  return response.json();
}

export async function fetchScheduledPosts(page = 1, artistId = null) {
  const token = await getFirebaseToken();
  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', 'posts');
  url.searchParams.set('page', page.toString());
  if (artistId) {
    url.searchParams.set('artistId', artistId);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch scheduled posts');
  }

  return response.json();
}
