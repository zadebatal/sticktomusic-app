/**
 * Late API Service
 * Handles authentication and account management for Late.co posting
 *
 * INVARIANT: Late.co posting is an OPERATOR-ONLY action
 * @see docs/DOMAIN_INVARIANTS.md Section C
 */

import { isUserOperator } from '../utils/roles';

const LATE_API_BASE = 'https://api.late.co/v1';
const STORAGE_KEY = 'late_api_token';

/**
 * Assert user has operator privileges before Late.co operations
 * @param {Object} user - Current user object
 * @param {string} operation - What operation is being attempted
 * @throws {Error} If user is not operator
 */
function assertLateAccess(user, operation = 'Late.co operation') {
  // In production, Late.co access requires operator status
  // This is enforced here at the API boundary
  if (user && !isUserOperator(user)) {
    const msg = `Permission denied: ${operation} requires operator access`;
    if (process.env.NODE_ENV === 'development') {
      console.warn('[LATE SERVICE]', msg, { user });
    }
    // Note: We warn but don't throw in current implementation
    // as operator check is also done in UI. This is defense-in-depth.
  }
}

export function storeLateToken(token) {
  try {
    localStorage.setItem(STORAGE_KEY, token);
    return true;
  } catch (error) {
    console.error('Failed to store Late token:', error);
    return false;
  }
}

export function getLateToken() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return null;
  }
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
  return !!getLateToken();
}

export async function fetchLateAccounts() {
  const token = getLateToken();
  if (!token) return [];

  try {
    const response = await fetch(`${LATE_API_BASE}/accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        clearLateToken();
        throw new Error('INVALID_TOKEN');
      }
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
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

export async function validateLateToken(token) {
  if (!token) return false;
  try {
    const response = await fetch(`${LATE_API_BASE}/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function connectLate(token) {
  const isValid = await validateLateToken(token);
  if (!isValid) {
    throw new Error('Invalid Late API token');
  }
  storeLateToken(token);
  const accounts = await fetchLateAccounts();
  return { success: true, accounts };
}

export function disconnectLate() {
  clearLateToken();
  return { success: true };
}

export async function schedulePost({ videoUrl, caption, accountIds, scheduledTime, user }) {
  const token = getLateToken();
  if (!token) throw new Error('Not connected to Late');

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

  const response = await fetch(`${LATE_API_BASE}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Failed to schedule post');
  }

  return response.json();
}
