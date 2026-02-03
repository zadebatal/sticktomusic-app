/**
 * roles.js - Role/Permission Utilities
 *
 * INVARIANT: Server-side gates for privileged operations.
 * INVARIANT: UI never shows operator actions to artists.
 *
 * @see docs/DOMAIN_INVARIANTS.md Section C
 */

/**
 * Operator emails - MUST match App.jsx OPERATOR_EMAILS
 * In production, this should come from environment or server
 */
const OPERATOR_EMAILS = Object.freeze([
  'zade@sticktomusic.com',
  'zadebatal@gmail.com',
]);

/**
 * Role constants
 */
export const ROLES = Object.freeze({
  OPERATOR: 'operator',
  ARTIST: 'artist',
});

/**
 * Check if email belongs to an operator
 * @param {string} email
 * @returns {boolean}
 */
export function isOperator(email) {
  if (!email || typeof email !== 'string') return false;
  return OPERATOR_EMAILS.includes(email.toLowerCase());
}

/**
 * Check if user object has operator role
 * @param {Object} user - User object with email and/or role
 * @returns {boolean}
 */
export function isUserOperator(user) {
  if (!user) return false;
  // Check explicit role first
  if (user.role === ROLES.OPERATOR) return true;
  // Fallback to email check
  return isOperator(user.email);
}

/**
 * Get role for email (for initial role assignment)
 * @param {string} email
 * @returns {string}
 */
export function getRoleForEmail(email) {
  return isOperator(email) ? ROLES.OPERATOR : ROLES.ARTIST;
}

/**
 * Assert user is operator - throws if not
 * Use this before privileged operations
 * @param {Object} user
 * @param {string} operation - Description of what's being attempted
 * @throws {Error} If user is not operator
 */
export function assertOperator(user, operation = 'this operation') {
  if (!isUserOperator(user)) {
    const msg = `Permission denied: ${operation} requires operator access`;
    if (process.env.NODE_ENV === 'development') {
      console.error('[ROLE VIOLATION]', msg, { user });
    }
    throw new Error(msg);
  }
}

/**
 * Check if user can access a specific artist's content
 * Operators can access all; artists only their own
 * @param {Object} user
 * @param {string} artistId
 * @returns {boolean}
 */
export function canAccessArtist(user, artistId) {
  if (!user) return false;
  if (isUserOperator(user)) return true;
  // Artists can only access their own content
  return user.artistId === artistId || user.id === artistId;
}

/**
 * Check if user can perform operator-only actions
 * @param {Object} user
 * @param {string} action - Action being attempted
 * @returns {boolean}
 */
export function canPerformAction(user, action) {
  const operatorOnlyActions = [
    'approve_video',
    'reject_video',
    'post_to_late',
    'view_all_artists',
    'manage_applications',
    'view_analytics',
  ];

  if (operatorOnlyActions.includes(action)) {
    return isUserOperator(user);
  }

  // Default: allow
  return true;
}

/**
 * Filter items based on user's role access
 * @param {Array} items - Items with artistId property
 * @param {Object} user
 * @returns {Array} - Filtered items
 */
export function filterForRole(items, user) {
  if (!Array.isArray(items)) return [];
  if (!user) return [];

  if (isUserOperator(user)) {
    return items; // Operators see everything
  }

  // Artists only see their own content
  return items.filter(item =>
    item.artistId === user.artistId ||
    item.artistId === user.id ||
    item.createdBy === user.id
  );
}

/**
 * Development helper: log role check
 * @param {Object} user
 * @param {string} action
 * @param {boolean} allowed
 */
export function logRoleCheck(user, action, allowed) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[ROLE CHECK] ${action}: ${allowed ? 'ALLOWED' : 'DENIED'}`, {
      email: user?.email,
      role: user?.role,
    });
  }
}

export default {
  ROLES,
  isOperator,
  isUserOperator,
  getRoleForEmail,
  assertOperator,
  canAccessArtist,
  canPerformAction,
  filterForRole,
};
