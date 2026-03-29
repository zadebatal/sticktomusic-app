/**
 * status.js - Status Enum Mapping
 *
 * INVARIANT: External status strings mapped to internal enum in ONE place.
 * All status comparisons should use these constants, not raw strings.
 *
 * @see docs/DOMAIN_INVARIANTS.md Section D
 */

import log from './logger';

/**
 * Video/Project Status Enum
 * Represents the lifecycle of a created video
 */
export const VIDEO_STATUS = Object.freeze({
  DRAFT: 'draft', // Initial creation, editing in progress
  RENDERING: 'rendering', // Video export in progress
  COMPLETED: 'completed', // Export finished, ready for review
  APPROVED: 'approved', // Operator approved for posting
});

/**
 * Export Stage Enum
 * Represents stages in the export/post flow
 */
export const EXPORT_STAGE = Object.freeze({
  OPTIONS: 'options', // User selecting export options
  RENDERING: 'rendering', // Canvas rendering video
  UPLOADING: 'uploading', // Uploading to Firebase
  READY: 'ready', // Upload complete, ready to post
  POSTING: 'posting', // Posting to Late.co
  DONE: 'done', // All operations complete
});

/**
 * Application Status Enum
 * For artist application workflow
 */
export const APPLICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/**
 * Validate if a status is a valid VIDEO_STATUS
 * @param {string} status
 * @returns {boolean}
 */
export function isValidVideoStatus(status) {
  return Object.values(VIDEO_STATUS).includes(status);
}

/**
 * Validate if a status is a valid EXPORT_STAGE
 * @param {string} stage
 * @returns {boolean}
 */
export function isValidExportStage(stage) {
  return Object.values(EXPORT_STAGE).includes(stage);
}

/**
 * Get human-readable display text for video status
 * @param {string} status
 * @returns {string}
 */
export function getVideoStatusDisplay(status) {
  const displays = {
    [VIDEO_STATUS.DRAFT]: 'Draft',
    [VIDEO_STATUS.RENDERING]: 'Rendering...',
    [VIDEO_STATUS.COMPLETED]: 'Completed',
    [VIDEO_STATUS.APPROVED]: 'Approved',
  };
  return displays[status] || status;
}

/**
 * Get status color for UI
 * @param {string} status
 * @returns {string} - Tailwind color class or hex
 */
export function getVideoStatusColor(status) {
  const colors = {
    [VIDEO_STATUS.DRAFT]: '#6B7280', // gray-500
    [VIDEO_STATUS.RENDERING]: '#F59E0B', // amber-500
    [VIDEO_STATUS.COMPLETED]: '#3B82F6', // blue-500
    [VIDEO_STATUS.APPROVED]: '#10B981', // green-500
  };
  return colors[status] || '#6B7280';
}

/**
 * Check if status transition is valid
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
export function canTransitionTo(fromStatus, toStatus) {
  const validTransitions = {
    [VIDEO_STATUS.DRAFT]: [VIDEO_STATUS.RENDERING],
    [VIDEO_STATUS.RENDERING]: [VIDEO_STATUS.COMPLETED, VIDEO_STATUS.DRAFT], // Can fail back to draft
    [VIDEO_STATUS.COMPLETED]: [VIDEO_STATUS.APPROVED, VIDEO_STATUS.DRAFT], // Can be edited
    [VIDEO_STATUS.APPROVED]: [VIDEO_STATUS.DRAFT], // Can be un-approved
  };
  return validTransitions[fromStatus]?.includes(toStatus) ?? false;
}

/**
 * Assert status is valid
 * @param {string} status
 * @param {string} context - Where the check is happening
 */
export function assertValidVideoStatus(status, context = '') {
  if (!isValidVideoStatus(status)) {
    const msg = `Invalid video status "${status}"${context ? ` in ${context}` : ''}. Valid: ${Object.values(VIDEO_STATUS).join(', ')}`;
    // Log in all environments for observability
    log.error('[STATUS VIOLATION]', msg);

    // In development, throw to catch bugs early
    if (process.env.NODE_ENV === 'development') {
      throw new Error(msg);
    }
  }
}

export default {
  VIDEO_STATUS,
  EXPORT_STAGE,
  APPLICATION_STATUS,
  isValidVideoStatus,
  isValidExportStage,
  getVideoStatusDisplay,
  getVideoStatusColor,
  canTransitionTo,
  assertValidVideoStatus,
};
