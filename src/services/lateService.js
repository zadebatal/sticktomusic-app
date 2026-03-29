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
import log from '../utils/logger';

// Use our authenticated proxy instead of direct Late API
const LATE_PROXY = '/api/late';

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
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url.toString(), options);
  } catch (networkErr) {
    throw new Error('Network error — check your internet connection and try again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    const errorMsg = error.error || `API Error: ${response.status}`;

    // Provide user-friendly error messages based on status
    if (response.status === 400 && errorMsg.includes('No Late API key')) {
      throw new Error(
        'Late API key not configured for this artist. Go to Settings to add your key.',
      );
    } else if (response.status === 401) {
      throw new Error('Authentication expired. Please refresh the page and try again.');
    } else if (response.status === 403) {
      throw new Error("You don't have permission to access this artist's Late account.");
    } else if (response.status === 500) {
      throw new Error(
        `Late sync error: ${errorMsg}. The Late.co service may be temporarily unavailable.`,
      );
    } else if (response.status === 502 || response.status === 504) {
      throw new Error('Late.co is not responding. Please try again in a few minutes.');
    }
    throw new Error(errorMsg);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Late API proxy not available (non-JSON response). Are you running on Vercel?');
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
    log.error('[LATE SERVICE]', msg);
    throw new Error(msg);
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
    headers: { Authorization: `Bearer ${token}` },
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
    // Expected in dev (no serverless proxy) — don't spam console
    if (!error.message?.includes('Late API proxy not available')) {
      log.error('Failed to check Late key status:', error);
    }
    return { configured: false, updatedAt: null };
  }
}

// ============================================
// LATE API FUNCTIONS (now accept artistId)
// ============================================

export async function fetchLateAccounts(artistId = null) {
  // BUG-026: Operator check for Late account enumeration
  const auth = getAuth();
  assertLateAccess(auth.currentUser, 'fetchLateAccounts');

  try {
    const data = await proxyRequest('accounts', 'GET', null, artistId);
    const accounts = (data.accounts || data.data || []).map((account) => ({
      id: account.id || account.account_id,
      platform: (account.platform || account.type || '').toLowerCase(),
      username: account.username || account.handle || account.name,
      profileImage: account.profile_image || account.avatar,
      name: account.display_name || account.name,
      isActive: account.is_active !== false,
    }));

    return accounts.filter((a) => a.isActive);
  } catch (error) {
    log.error('Failed to fetch Late accounts:', error);
    throw error;
  }
}

// ============================================
// LATE OAUTH CONNECT (profile + account linking)
// ============================================

/**
 * List Late profiles for an artist
 * @param {string} artistId - Artist ID
 * @returns {Promise<{profiles: Array}>}
 */
export async function getLateProfiles(artistId) {
  if (!artistId) throw new Error('artistId required');
  return proxyRequest('profiles', 'GET', null, artistId);
}

/**
 * Create a Late profile for an artist
 * @param {string} artistId - Artist ID
 * @param {string} name - Profile name
 * @returns {Promise<{profile: Object}>}
 */
export async function createLateProfile(artistId, name) {
  if (!artistId) throw new Error('artistId required');
  return proxyRequest('createProfile', 'POST', { name }, artistId);
}

/**
 * Get OAuth connect URL for a platform
 * Opens in new tab — Late handles the OAuth flow and redirects back
 * @param {string} artistId - Artist ID
 * @param {string} platform - Platform (tiktok, instagram, facebook, youtube)
 * @param {string} profileId - Late profile ID
 * @param {string} redirectUrl - URL to redirect to after OAuth completes
 * @returns {Promise<{authUrl: string, state: string}>}
 */
export async function getConnectUrl(artistId, platform, profileId, redirectUrl) {
  if (!artistId || !platform || !profileId)
    throw new Error('artistId, platform, and profileId required');

  const token = await getFirebaseToken();
  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', 'connectUrl');
  url.searchParams.set('artistId', artistId);
  url.searchParams.set('platform', platform);
  url.searchParams.set('profileId', profileId);
  if (redirectUrl) url.searchParams.set('redirectUrl', redirectUrl);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `Failed to get connect URL: ${response.status}`);
  }

  return response.json();
}

export async function schedulePost({
  videoUrl,
  caption,
  accountIds,
  scheduledTime,
  user,
  artistId,
}) {
  // Operator check at API boundary (defense-in-depth)
  assertLateAccess(user, 'schedulePost');

  const payload = {
    media_url: videoUrl,
    caption,
    account_ids: accountIds,
  };
  if (scheduledTime) {
    payload.scheduled_at = new Date(scheduledTime).toISOString();
  }

  return proxyRequest('posts', 'POST', payload, artistId);
}

export async function updatePost(postId, updates, user, artistId = null) {
  assertLateAccess(user, 'updatePost');

  const token = await getFirebaseToken();
  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', 'updatePost');
  url.searchParams.set('postId', postId);
  if (artistId) {
    url.searchParams.set('artistId', artistId);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update post on Late.co');
  }

  return response.json();
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
      Authorization: `Bearer ${token}`,
    },
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
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch scheduled posts');
  }

  return response.json();
}
