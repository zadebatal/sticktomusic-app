/**
 * StorageService - localStorage persistence for StickToMusic
 *
 * Handles saving and loading of:
 * - Categories (with video/audio metadata pointing to Firebase URLs)
 * - Presets
 * - API Keys
 * - Settings
 */

const STORAGE_KEYS = {
  CATEGORIES: 'stm_categories',
  PRESETS: 'stm_presets',
  SETTINGS: 'stm_settings',
  API_KEYS: 'stm_api_keys'
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
 */
export function saveCategories(categories) {
  // Filter out any blob URLs before saving - they won't work after reload
  const cleanedCategories = categories.map(cat => ({
    ...cat,
    videos: cat.videos.filter(v => v.url && !v.url.startsWith('blob:')),
    audio: cat.audio.filter(a => a.url && !a.url.startsWith('blob:'))
  }));
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

// ==================== UTILITY ====================

/**
 * Clear all stored data
 */
export function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(key => {
    localStorage.removeItem(key);
  });
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
  clearAllData
};
