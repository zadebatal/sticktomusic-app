/**
 * Storage Quota Service
 * Tracks per-user storage usage and enforces quota limits.
 *
 * Firestore fields on allowedUsers/{email}:
 *   storageQuotaBytes  — null = unlimited (legacy), number = quota in bytes
 *   storageUsedBytes   — running counter of bytes used
 */

import { doc, getDoc, updateDoc, getDocs, collection, increment } from 'firebase/firestore';
import log from '../utils/logger';

// 300 GB default quota for new users
export const DEFAULT_QUOTA_BYTES = 300 * 1024 * 1024 * 1024; // 300 GB

/**
 * Check whether an upload is allowed under the user's quota.
 * @param {object} userData - The user object (must have email, storageQuotaBytes, storageUsedBytes)
 * @param {number} fileSize - Size of the file to upload in bytes
 * @returns {{ allowed: boolean, message: string|null }}
 */
export function checkQuotaBeforeUpload(userData, fileSize) {
  if (!userData) return { allowed: false, message: 'User data not available.' };

  const quota = userData.storageQuotaBytes;
  const used = userData.storageUsedBytes || 0;

  // null = unlimited (legacy/existing users)
  if (quota === null || quota === undefined) {
    return { allowed: true, message: null };
  }

  if (used + fileSize > quota) {
    const remaining = Math.max(0, quota - used);
    return {
      allowed: false,
      message: `Storage full. ${formatStorageSize(remaining)} remaining of ${formatStorageSize(quota)}. Upgrade or delete files to free space.`,
    };
  }

  return { allowed: true, message: null };
}

/**
 * Increment the user's storage usage counter after a successful upload.
 * @param {object} db - Firestore instance
 * @param {string} userEmail - User email (document ID in allowedUsers)
 * @param {number} bytes - Number of bytes to add
 */
export async function incrementStorageUsed(db, userEmail, bytes) {
  if (!db || !userEmail || !bytes || bytes <= 0) return;
  try {
    const userRef = doc(db, 'allowedUsers', userEmail.toLowerCase());
    await updateDoc(userRef, { storageUsedBytes: increment(bytes) });
  } catch (err) {
    log.error('[StorageQuota] Failed to increment usage:', err);
  }
}

/**
 * Decrement the user's storage usage counter after a file deletion.
 * Floors at 0 to prevent negative values.
 * @param {object} db - Firestore instance
 * @param {string} userEmail - User email (document ID in allowedUsers)
 * @param {number} bytes - Number of bytes to subtract
 */
export async function decrementStorageUsed(db, userEmail, bytes) {
  if (!db || !userEmail || !bytes || bytes <= 0) return;
  try {
    const userRef = doc(db, 'allowedUsers', userEmail.toLowerCase());
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const current = snap.data().storageUsedBytes || 0;
    const newValue = Math.max(0, current - bytes);
    await updateDoc(userRef, { storageUsedBytes: newValue });
  } catch (err) {
    log.error('[StorageQuota] Failed to decrement usage:', err);
  }
}

/**
 * Format bytes to a human-readable string.
 * @param {number} bytes
 * @returns {string} e.g. "47.2 GB", "128 MB", "3.1 KB"
 */
export function formatStorageSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '0 B';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  // Show 1 decimal for GB+, 0 for smaller
  const decimals = i >= 3 ? 1 : i >= 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/**
 * One-time migration: set storageQuotaBytes = null (unlimited) and
 * storageUsedBytes = 0 on all existing users that are missing these fields.
 * Safe to call multiple times — only writes to users without the fields.
 * @param {object} db - Firestore instance
 */
export async function migrateExistingUsersQuota(db) {
  if (!db) return;
  try {
    const snapshot = await getDocs(collection(db, 'allowedUsers'));
    let migrated = 0;
    const promises = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      // Only migrate users that don't have storageQuotaBytes set yet
      if (!('storageQuotaBytes' in data)) {
        promises.push(
          updateDoc(doc(db, 'allowedUsers', docSnap.id), {
            storageQuotaBytes: null, // unlimited for existing users
            storageUsedBytes: data.storageUsedBytes || 0,
          }).then(() => {
            migrated++;
          }),
        );
      }
    });

    if (promises.length > 0) {
      await Promise.all(promises);
      log(`[StorageQuota] Migrated ${migrated} existing users to quota system`);
    }
  } catch (err) {
    log.error('[StorageQuota] Migration failed:', err);
  }
}

/**
 * Admin repair tool: recalculate storageUsedBytes by summing all media items.
 * NOT used in normal flow — only for fixing counter drift.
 * @param {object} db - Firestore instance
 * @param {string} userEmail - User email
 * @param {number} actualBytes - Recalculated total bytes
 */
export async function recalculateStorageUsed(db, userEmail, actualBytes) {
  if (!db || !userEmail) return;
  try {
    const userRef = doc(db, 'allowedUsers', userEmail.toLowerCase());
    await updateDoc(userRef, { storageUsedBytes: actualBytes });
    log(`[StorageQuota] Reset ${userEmail} usage to ${formatStorageSize(actualBytes)}`);
  } catch (err) {
    log.error('[StorageQuota] Recalculate failed:', err);
  }
}
