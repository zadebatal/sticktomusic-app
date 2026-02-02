/**
 * StorageService - Centralized localStorage persistence for StickToMusic
 * Handles categories, presets, lyric templates, videos, and settings
 */

const STORAGE_KEYS = {
  CATEGORIES: 'stm_categories',
  PRESETS: 'stm_presets',
  LYRIC_TEMPLATES: 'stm_lyric_templates',
  CREATED_VIDEOS: 'stm_created_videos',
  SETTINGS: 'stm_settings',
  API_KEYS: 'stm_api_keys'
};

// Helper functions
function saveToStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error(`Failed to save ${key}:`, err);
    return false;
  }
}

function loadFromStorage(key, defaultValue = null) {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.error(`Failed to load ${key}:`, err);
  }
  return defaultValue;
}

// Generate a unique key for audio files (by name + size)
function getAudioKey(audioFile) {
  if (!audioFile) return null;
  const name = audioFile.name || audioFile.file_name || 'unknown';
  const size = audioFile.size || 0;
  return `${name}_${size}`;
}

// ==================== CATEGORIES ====================

export function saveCategories(categories) {
  // Strip out blob URLs (they don't persist) but keep metadata
  const cleanCategories = categories.map(cat => ({
    ...cat,
    videos: cat.videos?.map(v => ({
      ...v,
      url: null, // Blob URLs don't persist
      file: null
    })) || [],
    audio: cat.audio?.map(a => ({
      ...a,
      url: null,
      file: null
    })) || [],
    createdVideos: cat.createdVideos?.map(cv => ({
      ...cv,
      // Keep created video data but strip blobs
      audio: cv.audio ? { ...cv.audio, url: null, file: null } : null,
      clips: cv.clips?.map(c => ({ ...c, url: null })) || []
    })) || []
  }));
  return saveToStorage(STORAGE_KEYS.CATEGORIES, cleanCategories);
}

export function loadCategories() {
  return loadFromStorage(STORAGE_KEYS.CATEGORIES, []);
}

export function addCategory(category) {
  const categories = loadCategories();
  const newCategory = {
    id: `cat_${Date.now()}`,
    videos: [],
    audio: [],
    createdVideos: [],
    ...category,
    createdAt: new Date().toISOString()
  };
  categories.push(newCategory);
  saveCategories(categories);
  return newCategory;
}

export function updateCategory(categoryId, updates) {
  const categories = loadCategories();
  const index = categories.findIndex(c => c.id === categoryId);
  if (index >= 0) {
    categories[index] = { ...categories[index], ...updates, updatedAt: new Date().toISOString() };
    saveCategories(categories);
    return categories[index];
  }
  return null;
}

export function deleteCategory(categoryId) {
  const categories = loadCategories();
  const filtered = categories.filter(c => c.id !== categoryId);
  saveCategories(filtered);
  return filtered;
}

// ==================== PRESETS ====================

export function savePresets(presets) {
  return saveToStorage(STORAGE_KEYS.PRESETS, presets);
}

export function loadPresets() {
  return loadFromStorage(STORAGE_KEYS.PRESETS, []);
}

export function addPreset(preset) {
  const presets = loadPresets();
  const newPreset = {
    id: `preset_${Date.now()}`,
    ...preset,
    createdAt: new Date().toISOString()
  };
  presets.push(newPreset);
  savePresets(presets);
  return newPreset;
}

export function deletePreset(presetId) {
  const presets = loadPresets();
  const filtered = presets.filter(p => p.id !== presetId);
  savePresets(filtered);
  return filtered;
}

// ==================== LYRIC TEMPLATES ====================

export function saveLyricTemplate(audioFile, lyrics, words) {
  const key = getAudioKey(audioFile);
  if (!key) return false;

  const templates = loadFromStorage(STORAGE_KEYS.LYRIC_TEMPLATES, {});
  templates[key] = {
    lyrics,
    words,
    audioName: audioFile.name || audioFile.file_name,
    audioSize: audioFile.size,
    createdAt: new Date().toISOString()
  };
  return saveToStorage(STORAGE_KEYS.LYRIC_TEMPLATES, templates);
}

export function loadLyricTemplate(audioFile) {
  const key = getAudioKey(audioFile);
  if (!key) return null;

  const templates = loadFromStorage(STORAGE_KEYS.LYRIC_TEMPLATES, {});
  return templates[key] || null;
}

export function deleteLyricTemplate(audioFile) {
  const key = getAudioKey(audioFile);
  if (!key) return false;

  const templates = loadFromStorage(STORAGE_KEYS.LYRIC_TEMPLATES, {});
  delete templates[key];
  return saveToStorage(STORAGE_KEYS.LYRIC_TEMPLATES, templates);
}

export function getAllLyricTemplates() {
  return loadFromStorage(STORAGE_KEYS.LYRIC_TEMPLATES, {});
}

// ==================== CREATED VIDEOS ====================

export function saveCreatedVideo(categoryId, videoData) {
  const categories = loadCategories();
  const catIndex = categories.findIndex(c => c.id === categoryId);

  if (catIndex < 0) return null;

  const cat = categories[catIndex];
  const existingIndex = cat.createdVideos.findIndex(v => v.id === videoData.id);

  if (existingIndex >= 0) {
    // Update existing video
    cat.createdVideos[existingIndex] = {
      ...cat.createdVideos[existingIndex],
      ...videoData,
      updatedAt: new Date().toISOString()
    };
  } else {
    // Add new video
    cat.createdVideos.push({
      ...videoData,
      id: videoData.id || `video_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'draft'
    });
  }

  categories[catIndex] = cat;
  saveCategories(categories);
  return cat.createdVideos[existingIndex >= 0 ? existingIndex : cat.createdVideos.length - 1];
}

export function deleteCreatedVideo(categoryId, videoId) {
  const categories = loadCategories();
  const catIndex = categories.findIndex(c => c.id === categoryId);

  if (catIndex >= 0) {
    categories[catIndex].createdVideos = categories[catIndex].createdVideos.filter(v => v.id !== videoId);
    saveCategories(categories);
  }
  return categories;
}

// ==================== SETTINGS ====================

export function saveSettings(settings) {
  return saveToStorage(STORAGE_KEYS.SETTINGS, settings);
}

export function loadSettings() {
  return loadFromStorage(STORAGE_KEYS.SETTINGS, {
    defaultCropMode: '9:16',
    defaultFontSize: 48,
    defaultFontFamily: 'Inter, sans-serif',
    autoCensor: true,
    autoSave: true
  });
}

// ==================== API KEYS ====================

export function saveApiKey(service, key) {
  const keys = loadFromStorage(STORAGE_KEYS.API_KEYS, {});
  keys[service] = key;
  return saveToStorage(STORAGE_KEYS.API_KEYS, keys);
}

export function loadApiKey(service) {
  const keys = loadFromStorage(STORAGE_KEYS.API_KEYS, {});
  return keys[service] || null;
}

// ==================== UTILITY ====================

export function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(key => {
    localStorage.removeItem(key);
  });
}

export function exportData() {
  const data = {};
  Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
    data[name] = loadFromStorage(key);
  });
  return data;
}

export function importData(data) {
  Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
    if (data[name]) {
      saveToStorage(key, data[name]);
    }
  });
}

export default {
  // Categories
  saveCategories,
  loadCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  // Presets
  savePresets,
  loadPresets,
  addPreset,
  deletePreset,
  // Lyric Templates
  saveLyricTemplate,
  loadLyricTemplate,
  deleteLyricTemplate,
  getAllLyricTemplates,
  // Created Videos
  saveCreatedVideo,
  deleteCreatedVideo,
  // Settings
  saveSettings,
  loadSettings,
  // API Keys
  saveApiKey,
  loadApiKey,
  // Utility
  clearAllData,
  exportData,
  importData
};
