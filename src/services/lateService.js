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
 */
async function proxyRequest(action, method = 'GET', body = null) {
  const token = await getFirebaseToken();

  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', action);

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

export async function fetchLateAccounts() {
  if (!isLateConnected()) return [];

  try {
    const data = await proxyRequest('accounts');
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
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      clearLateToken();
    }
    throw error;
  }
}

export async function validateLateToken(token) {
  // Token validation now happens server-side
  // This just checks if we can successfully call the proxy
  try {
    await proxyRequest('accounts');
    return true;
  } catch {
    return false;
  }
}

export async function connectLate(token) {
  // Note: The actual Late API key should be set in Vercel environment variables
  // This function now just marks the connection as active after verifying
  const isValid = await validateLateToken(token);
  if (!isValid) {
    throw new Error('Invalid Late API configuration');
  }
  storeLateConnection(true);
  const accounts = await fetchLateAccounts();
  return { success: true, accounts };
}

export function disconnectLate() {
  clearLateToken();
  return { success: true };
}

export async function schedulePost({ videoUrl, caption, accountIds, scheduledTime, user }) {
  if (!isLateConnected()) throw new Error('Not connected to Late');

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

  return proxyRequest('posts', 'POST', payload);
}

export async function deletePost(postId, user) {
  if (!isLateConnected()) throw new Error('Not connected to Late');
  assertLateAccess(user, 'deletePost');

  const token = await getFirebaseToken();
  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', 'delete');
  url.searchParams.set('postId', postId);

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

export async function fetchScheduledPosts(page = 1) {
  if (!isLateConnected()) return { posts: [], total: 0 };

  const token = await getFirebaseToken();
  const url = new URL(LATE_PROXY, window.location.origin);
  url.searchParams.set('action', 'posts');
  url.searchParams.set('page', page.toString());

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
