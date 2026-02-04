/**
 * StorageService - localStorage persistence for StickToMusic
 *
 * Handles saving and loading of:
 * - Categories (with video/audio metadata pointing to Firebase URLs)
 * - Presets
 * - API Keys
 * - Settings
 *
 * INVARIANT: Persisted items NEVER contain blob: URLs
 * @see docs/DOMAIN_INVARIANTS.md Section B
 */

import { findBlobUrls } from '../utils/assets';

const STORAGE_KEYS = {
  CATEGORIES: 'stm_categories',
  PRESETS: 'stm_presets',
  SETTINGS: 'stm_settings',
  API_KEYS: 'stm_api_keys',
  LYRIC_TEMPLATES: 'stm_lyric_templates'
};

/**
 * Save data to localStorage with error handling
 */
function saveToStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error(`Failed to save ${key}:`, error);
    if (error.name === 'QuotaExceededError') {
      console.warn('Storage quota exceeded');
    }
    return false;
  }
}

/**
 * Load data from localStorage with error handling
 */
function loadFromStorage(key, defaultValue = null) {
  try {
    const data = localStorage.getItem(key);
    if (!data) return defaultValue;
    return JSON.parse(data);
  } catch (error) {
    console.error(`Failed to load ${key}:`, error);
    return defaultValue;
  }
}

// ==================== CATEGORIES ====================

/**
 * Save all categories
 * Strips thumbnails and blob URLs to avoid quota exceeded errors
 *
 * INVARIANT: No blob URLs after cleaning
 */
export function saveCategories(categories) {
  // Filter out blob URLs and strip thumbnails (they're huge base64 strings)
  const cleanedCategories = categories.map(cat => ({
    ...cat,
    // Clean videos - remove thumbnails and blob URLs
    videos: (cat.videos || [])
      .filter(v => v.url && !v.url.startsWith('blob:'))
      .map(v => ({
        ...v,
        thumbnail: null // Don't store base64 thumbnails - they fill localStorage
      })),
    // Clean audio - remove blob URLs
    audio: (cat.audio || [])
      .filter(a => a.url && !a.url.startsWith('blob:')),
    // Clean created videos - strip clip thumbnails too
    createdVideos: (cat.createdVideos || []).map(video => ({
      ...video,
      clips: (video.clips || []).map(clip => ({
        ...clip,
        thumbnail: null // Strip clip thumbnails too
      }))
    }))
  }));

  // INVARIANT CHECK: Verify no blob URLs remain after cleaning
  if (process.env.NODE_ENV === 'development') {
    const blobViolations = findBlobUrls(cleanedCategories);
    if (blobViolations.length > 0) {
      console.error('[STORAGE VIOLATION] Blob URLs found after cleaning:', blobViolations);
    }
  }

  return saveToStorage(STORAGE_KEYS.CATEGORIES, cleanedCategories);
}

/**
 * Load all categories
 */
export function loadCategories() {
  return loadFromStorage(STORAGE_KEYS.CATEGORIES, []);
}

// ==================== PRESETS ====================

/**
 * Save all presets
 */
export function savePresets(presets) {
  return saveToStorage(STORAGE_KEYS.PRESETS, presets);
}

/**
 * Load all presets
 */
export function loadPresets() {
  return loadFromStorage(STORAGE_KEYS.PRESETS, []);
}

// ==================== API KEYS ====================

/**
 * Save API key for a service
 */
export function saveApiKey(service, key) {
  const keys = loadFromStorage(STORAGE_KEYS.API_KEYS, {});
  keys[service] = key;
  return saveToStorage(STORAGE_KEYS.API_KEYS, keys);
}

/**
 * Load API key for a service
 */
export function loadApiKey(service) {
  const keys = loadFromStorage(STORAGE_KEYS.API_KEYS, {});
  return keys[service] || null;
}

/**
 * Clear API key for a service
 */
export function clearApiKey(service) {
  const keys = loadFromStorage(STORAGE_KEYS.API_KEYS, {});
  delete keys[service];
  return saveToStorage(STORAGE_KEYS.API_KEYS, keys);
}

// ==================== SETTINGS ====================

/**
 * Save user settings
 */
export function saveSettings(settings) {
  return saveToStorage(STORAGE_KEYS.SETTINGS, settings);
}

/**
 * Load user settings
 */
export function loadSettings() {
  return loadFromStorage(STORAGE_KEYS.SETTINGS, {
    autoCensor: true,
    defaultCropMode: '9:16',
    showSafeZones: true
  });
}

// ==================== LYRIC TEMPLATES ====================

/**
 * Save lyric template for an audio source
 * Used by LyricAnalyzer to cache transcription results
 */
export function saveLyricTemplate(audioSource, template) {
  const templates = loadFromStorage(STORAGE_KEYS.LYRIC_TEMPLATES, {});
  templates[audioSource] = template;
  return saveToStorage(STORAGE_KEYS.LYRIC_TEMPLATES, templates);
}

/**
 * Load lyric template for an audio source
 */
export function loadLyricTemplate(audioSource) {
  const templates = loadFromStorage(STORAGE_KEYS.LYRIC_TEMPLATES, {});
  return templates[audioSource] || null;
}

// ==================== UTILITY ====================

/**
 * Clear all stored data
 */
export function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(key => {
    localStorage.removeItem(key);
  });
}

/**
 * Get storage usage info
 */
export function getStorageInfo() {
  let totalSize = 0;
  const breakdown = {};

  for (const key of Object.keys(localStorage)) {
    const size = (localStorage.getItem(key) || '').length * 2; // UTF-16
    totalSize += size;
    breakdown[key] = (size / 1024).toFixed(2) + ' KB';
  }

  return {
    total: (totalSize / 1024 / 1024).toFixed(2) + ' MB',
    breakdown,
    isNearLimit: totalSize > 4 * 1024 * 1024 // Warn if over 4MB (limit is ~5MB)
  };
}

/**
 * Clean up storage by removing thumbnails from existing data
 * Call this if quota is exceeded
 */
export function cleanupStorage() {
  try {
    const categories = loadCategories();
    if (categories.length > 0) {
      // Re-save with thumbnails stripped
      saveCategories(categories);
      console.log('Storage cleanup complete');
      return true;
    }
  } catch (error) {
    console.error('Storage cleanup failed:', error);
  }
  return false;
}

export default {
  saveCategories,
  loadCategories,
  savePresets,
  loadPresets,
  saveApiKey,
  loadApiKey,
  clearApiKey,
  saveSettings,
  loadSettings,
  saveLyricTemplate,
  loadLyricTemplate,
  clearAllData,
  getStorageInfo,
  cleanupStorage
};
