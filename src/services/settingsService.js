/**
 * Settings Service - Firestore-backed user preferences (BUG-010)
 *
 * Persists user settings to Firestore at:
 *   artists/{artistId}/settings/{userId}
 *
 * Falls back to localStorage when Firestore is unavailable.
 * Settings are scoped per-artist so each operator sees their own prefs per artist.
 *
 * Schema:
 *   editorPreferences: { activeTab, zoom, ... }
 *   contentViewPreferences: { contentView, filter, ... }
 *   onboarding: { completed, completedAt }
 *   ui: { sidebarCollapsed, theme }
 *   lastSession: { updatedAt }
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import log from '../utils/logger';

// In-memory cache to avoid redundant reads
const cache = new Map();

function getCacheKey(artistId, userId) {
  return `${artistId}__${userId}`;
}

/**
 * Load settings for the current user + artist from Firestore.
 * Returns merged settings (Firestore + localStorage fallback).
 */
export async function loadSettings(db, artistId) {
  if (!db || !artistId) {
    log('[SettingsService] No db or artistId, using localStorage');
    return loadLocalSettings();
  }

  const auth = getAuth();
  const userId = auth.currentUser?.uid;
  if (!userId) {
    log('[SettingsService] No authenticated user, using localStorage');
    return loadLocalSettings();
  }

  const cacheKey = getCacheKey(artistId, userId);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const ref = doc(db, 'artists', artistId, 'settings', userId);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const data = snap.data();
      cache.set(cacheKey, data);
      log('[SettingsService] Loaded from Firestore:', artistId);
      return data;
    }

    // First time: migrate from localStorage
    const local = loadLocalSettings();
    if (Object.keys(local).length > 0) {
      await setDoc(ref, { ...local, lastSession: { updatedAt: serverTimestamp() } });
      cache.set(cacheKey, local);
      log('[SettingsService] Migrated localStorage → Firestore');
    }
    return local;
  } catch (err) {
    log.error('[SettingsService] Load failed, falling back to localStorage:', err.message);
    return loadLocalSettings();
  }
}

/**
 * Save a partial settings update (merges with existing).
 */
export async function saveSettings(db, artistId, patch) {
  if (!db || !artistId || !patch) return;

  const auth = getAuth();
  const userId = auth.currentUser?.uid;
  if (!userId) return;

  const cacheKey = getCacheKey(artistId, userId);

  // Update cache immediately
  const current = cache.get(cacheKey) || {};
  const updated = deepMerge(current, patch);
  cache.set(cacheKey, updated);

  // Also save to localStorage as fallback
  saveLocalSettings(updated);

  try {
    const ref = doc(db, 'artists', artistId, 'settings', userId);
    await setDoc(ref, {
      ...patch,
      lastSession: { updatedAt: serverTimestamp() }
    }, { merge: true });
    log('[SettingsService] Saved to Firestore');
  } catch (err) {
    log.error('[SettingsService] Save failed (localStorage still updated):', err.message);
  }
}

/**
 * Save a specific preference (convenience wrapper).
 */
export async function savePref(db, artistId, category, key, value) {
  return saveSettings(db, artistId, { [category]: { [key]: value } });
}

/**
 * Clear cache for an artist (call on artist switch).
 */
export function clearSettingsCache(artistId) {
  for (const key of cache.keys()) {
    if (key.startsWith(artistId + '__')) {
      cache.delete(key);
    }
  }
}

// ─── Local storage fallback ──────────────────────────────

function loadLocalSettings() {
  try {
    const editorTab = localStorage.getItem('stm_editor_tab') || 'caption';
    const zoom = localStorage.getItem('stm_wordtimeline_zoom');
    const onboarding = localStorage.getItem('stm_onboarding_complete');

    return {
      editorPreferences: {
        activeTab: editorTab,
        ...(zoom ? { zoom: parseFloat(zoom) } : {})
      },
      onboarding: {
        completed: onboarding === 'true',
        ...(onboarding ? { completedAt: onboarding } : {})
      }
    };
  } catch {
    return {};
  }
}

function saveLocalSettings(settings) {
  try {
    if (settings?.editorPreferences?.activeTab) {
      localStorage.setItem('stm_editor_tab', settings.editorPreferences.activeTab);
    }
    if (settings?.editorPreferences?.zoom != null) {
      localStorage.setItem('stm_wordtimeline_zoom', String(settings.editorPreferences.zoom));
    }
    if (settings?.onboarding?.completed != null) {
      localStorage.setItem('stm_onboarding_complete', String(settings.onboarding.completed));
    }
  } catch {
    // localStorage may be full or unavailable
  }
}

// ─── Helpers ──────────────────────────────

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
