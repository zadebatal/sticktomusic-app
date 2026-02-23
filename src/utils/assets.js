/**
 * assets.js - Asset Lifecycle Utilities
 *
 * INVARIANT: Persisted library items NEVER contain blob: URLs
 * INVARIANT: Assets must have durable Firebase URL before persistence
 *
 * @see docs/DOMAIN_INVARIANTS.md Section B
 */

import log from './logger';

/**
 * Check if a URL is a blob URL
 * @param {string} url
 * @returns {boolean}
 */
export function isBlobUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('blob:');
}

/**
 * Check if a URL is a valid durable URL (https or http)
 * @param {string} url
 * @returns {boolean}
 */
export function isDurableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('https://') || url.startsWith('http://');
}

/**
 * Check if string is likely a base64 data URL (for thumbnails)
 * @param {string} str
 * @returns {boolean}
 */
export function isBase64DataUrl(str) {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('data:');
}

/**
 * Check if base64 string is too large for localStorage (>50KB)
 * @param {string} str
 * @returns {boolean}
 */
export function isLargeBase64(str) {
  if (!isBase64DataUrl(str)) return false;
  // Base64 strings are roughly 4/3 the size of binary
  // 50KB threshold = ~66KB base64
  return str.length > 66000;
}

/**
 * Recursively check an object for blob URLs
 * @param {any} obj
 * @param {string} path - Current path for error messages
 * @returns {Array<string>} - Array of paths where blob URLs were found
 */
export function findBlobUrls(obj, path = '') {
  const violations = [];

  if (obj === null || obj === undefined) return violations;

  if (typeof obj === 'string' && isBlobUrl(obj)) {
    violations.push(path || 'root');
    return violations;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      violations.push(...findBlobUrls(item, `${path}[${index}]`));
    });
    return violations;
  }

  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      violations.push(...findBlobUrls(obj[key], path ? `${path}.${key}` : key));
    }
  }

  return violations;
}

/**
 * Assert no blob URLs in object - throws if found
 * Use this before persisting to localStorage
 * @param {any} obj
 * @param {string} context - Where the check is happening
 * @throws {Error} If blob URLs found
 */
export function assertNoBlobUrls(obj, context = '') {
  const violations = findBlobUrls(obj);
  if (violations.length > 0) {
    const msg = `Blob URLs found${context ? ` in ${context}` : ''}: ${violations.join(', ')}`;
    // Log in all environments for observability
    log.error('[ASSET VIOLATION]', msg, { violations });

    // Always throw - blob URLs in persistence is a P0 data integrity violation
    throw new Error(msg);
  }
}

/**
 * Check if asset has valid persisted structure
 * @param {Object} asset
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function validatePersistedAsset(asset) {
  const errors = [];

  if (!asset) {
    errors.push('Asset is null/undefined');
    return { valid: false, errors };
  }

  // Must have ID
  if (!asset.id) {
    errors.push('Missing id');
  }

  // URL checks
  if (asset.url && isBlobUrl(asset.url)) {
    errors.push('url is a blob URL (not durable)');
  }

  if (asset.localUrl && !isBlobUrl(asset.localUrl)) {
    // localUrl should be blob if present, but that's just for session use
    // This is a warning, not an error
  }

  // File object check (not serializable)
  if (asset.file instanceof File) {
    errors.push('Contains File object (not serializable)');
  }

  // Large thumbnail check
  if (asset.thumbnail && isLargeBase64(asset.thumbnail)) {
    errors.push('thumbnail is too large for localStorage (>50KB)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Normalize asset for persistence by removing non-serializable fields
 * @param {Object} asset
 * @returns {Object} - Clean asset ready for persistence
 */
export function normalizeAssetForPersistence(asset) {
  if (!asset) return asset;

  const {
    file,         // Remove File object
    localUrl,     // Remove blob URL
    thumbnail,    // May remove if too large
    ...rest
  } = asset;

  // Keep thumbnail only if small enough
  const cleanThumbnail = thumbnail && !isLargeBase64(thumbnail) ? thumbnail : null;

  return {
    ...rest,
    thumbnail: cleanThumbnail,
  };
}

/**
 * Normalize array of assets for persistence
 * @param {Array} assets
 * @returns {Array}
 */
export function normalizeAssetsForPersistence(assets) {
  if (!Array.isArray(assets)) return [];
  return assets
    .filter(asset => asset.url && isDurableUrl(asset.url)) // Only keep assets with durable URLs
    .map(normalizeAssetForPersistence);
}

/**
 * Check if asset is ready for library persistence
 * @param {Object} asset
 * @returns {boolean}
 */
export function isReadyForPersistence(asset) {
  if (!asset) return false;
  return isDurableUrl(asset.url) && !isBlobUrl(asset.url);
}

/**
 * Development helper: warn about blob URLs being used inappropriately
 * @param {Object} asset
 * @param {string} operation
 */
export function warnIfBlobUrl(asset, operation = 'operation') {
  if (process.env.NODE_ENV === 'development') {
    if (asset?.url && isBlobUrl(asset.url)) {
      log.warn(`[ASSET WARNING] blob URL detected during ${operation}. This URL will not persist across sessions.`, {
        url: asset.url,
        id: asset.id,
      });
    }
  }
}

export default {
  isBlobUrl,
  isDurableUrl,
  isBase64DataUrl,
  isLargeBase64,
  findBlobUrls,
  assertNoBlobUrls,
  validatePersistedAsset,
  normalizeAssetForPersistence,
  normalizeAssetsForPersistence,
  isReadyForPersistence,
  warnIfBlobUrl,
};
