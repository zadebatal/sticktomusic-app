/**
 * Artist Service - Multi-artist management
 *
 * Handles:
 * - CRUD operations for artists (Firestore)
 * - Artist context management
 * - Namespaced data storage per artist
 * - Migration of existing data
 */

import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot
} from 'firebase/firestore';

// Storage keys
const LAST_ARTIST_KEY = 'stm_last_artist_id';
const CATEGORIES_PREFIX = 'stm_categories_';
const ANALYTICS_PREFIX = 'stm_analytics_';
const LATE_CONFIG_PREFIX = 'stm_late_config_';

// Legacy keys (for migration)
const LEGACY_CATEGORIES_KEY = 'stm_video_studio_categories';
const LEGACY_ANALYTICS_KEY = 'stm_analytics';

/**
 * Get the last selected artist ID
 */
export const getLastArtistId = () => {
  return localStorage.getItem(LAST_ARTIST_KEY);
};

/**
 * Set the last selected artist ID
 */
export const setLastArtistId = (artistId) => {
  localStorage.setItem(LAST_ARTIST_KEY, artistId);
};

/**
 * Get all artists from Firestore
 * @param {Object} db - Firestore database instance
 * @param {Function} callback - Real-time updates callback
 */
export const subscribeToArtists = (db, callback) => {
  const artistsRef = collection(db, 'artists');
  const q = query(artistsRef, orderBy('createdAt', 'desc'));

  return onSnapshot(q, (snapshot) => {
    const artists = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(artists);
  }, (error) => {
    console.error('Error subscribing to artists:', error);
    callback([]);
  });
};

/**
 * Get all artists (one-time fetch)
 * @param {Object} db - Firestore database instance
 */
export const getArtists = async (db) => {
  try {
    const artistsRef = collection(db, 'artists');
    const q = query(artistsRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error getting artists:', error);
    return [];
  }
};

/**
 * Get a single artist by ID
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 */
export const getArtist = async (db, artistId) => {
  try {
    const artistRef = doc(db, 'artists', artistId);
    const snapshot = await getDoc(artistRef);

    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() };
    }
    return null;
  } catch (error) {
    console.error('Error getting artist:', error);
    return null;
  }
};

/**
 * Create a new artist
 * @param {Object} db - Firestore database instance
 * @param {Object} artistData - Artist data
 */
export const createArtist = async (db, artistData) => {
  try {
    const artistsRef = collection(db, 'artists');

    const newArtist = {
      name: artistData.name,
      tier: artistData.tier || 'Scale',
      cdTier: artistData.cdTier || 'CD Lite',
      status: 'active',
      activeSince: new Date().toISOString().split('T')[0].replace(/-/g, '/').replace(/\/(\d{4})/, ' $1').replace(/^(\d+)\//, (m, p1) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[parseInt(p1) - 1] + ' ';
      }),
      totalPages: 0,
      lateConnected: false,
      lateApiKey: artistData.lateApiKey || '',
      lateAccountIds: artistData.lateAccountIds || {},
      metrics: { views: 0, engagement: 0, rate: 0 },
      ownerOperatorId: artistData.ownerOperatorId || null, // Which operator owns this artist (null = conductor only)
      createdAt: new Date().toISOString()
    };

    const docRef = await addDoc(artistsRef, newArtist);

    // Initialize empty data stores for this artist
    initializeArtistData(docRef.id);

    return { id: docRef.id, ...newArtist };
  } catch (error) {
    console.error('Error creating artist:', error);
    throw error;
  }
};

/**
 * Update an artist
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 * @param {Object} updates - Fields to update
 */
export const updateArtist = async (db, artistId, updates) => {
  try {
    const artistRef = doc(db, 'artists', artistId);
    await updateDoc(artistRef, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error updating artist:', error);
    throw error;
  }
};

/**
 * Delete an artist
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 */
export const deleteArtist = async (db, artistId) => {
  try {
    const artistRef = doc(db, 'artists', artistId);
    await deleteDoc(artistRef);

    // Clean up localStorage data
    clearArtistData(artistId);

    return true;
  } catch (error) {
    console.error('Error deleting artist:', error);
    throw error;
  }
};

/**
 * Initialize empty data stores for a new artist
 */
export const initializeArtistData = (artistId) => {
  localStorage.setItem(`${CATEGORIES_PREFIX}${artistId}`, JSON.stringify([]));
  localStorage.setItem(`${ANALYTICS_PREFIX}${artistId}`, JSON.stringify({
    videos: {},
    snapshots: [],
    lastUpdated: null
  }));
  localStorage.setItem(`${LATE_CONFIG_PREFIX}${artistId}`, JSON.stringify({
    apiKey: '',
    accountIds: {}
  }));
};

/**
 * Clear all data for an artist
 */
export const clearArtistData = (artistId) => {
  localStorage.removeItem(`${CATEGORIES_PREFIX}${artistId}`);
  localStorage.removeItem(`${ANALYTICS_PREFIX}${artistId}`);
  localStorage.removeItem(`${LATE_CONFIG_PREFIX}${artistId}`);
};

// ============================================
// Namespaced Data Access
// ============================================

/**
 * Get categories for an artist
 */
export const getArtistCategories = (artistId) => {
  try {
    const data = localStorage.getItem(`${CATEGORIES_PREFIX}${artistId}`);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error getting artist categories:', error);
    return [];
  }
};

/**
 * Save categories for an artist
 */
export const saveArtistCategories = (artistId, categories) => {
  try {
    localStorage.setItem(`${CATEGORIES_PREFIX}${artistId}`, JSON.stringify(categories));
  } catch (error) {
    console.error('Error saving artist categories:', error);
  }
};

/**
 * Get analytics for an artist
 */
export const getArtistAnalytics = (artistId) => {
  try {
    const data = localStorage.getItem(`${ANALYTICS_PREFIX}${artistId}`);
    return data ? JSON.parse(data) : { videos: {}, snapshots: [], lastUpdated: null };
  } catch (error) {
    console.error('Error getting artist analytics:', error);
    return { videos: {}, snapshots: [], lastUpdated: null };
  }
};

/**
 * Save analytics for an artist
 */
export const saveArtistAnalytics = (artistId, analytics) => {
  try {
    localStorage.setItem(`${ANALYTICS_PREFIX}${artistId}`, JSON.stringify({
      ...analytics,
      lastUpdated: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Error saving artist analytics:', error);
  }
};

/**
 * Get Late config for an artist
 */
export const getArtistLateConfig = (artistId) => {
  try {
    const data = localStorage.getItem(`${LATE_CONFIG_PREFIX}${artistId}`);
    return data ? JSON.parse(data) : { apiKey: '', accountIds: {} };
  } catch (error) {
    console.error('Error getting artist Late config:', error);
    return { apiKey: '', accountIds: {} };
  }
};

/**
 * Save Late config for an artist
 */
export const saveArtistLateConfig = (artistId, config) => {
  try {
    localStorage.setItem(`${LATE_CONFIG_PREFIX}${artistId}`, JSON.stringify(config));
  } catch (error) {
    console.error('Error saving artist Late config:', error);
  }
};

// ============================================
// Migration
// ============================================

/**
 * Check if migration is needed
 */
export const needsMigration = () => {
  const legacyCategories = localStorage.getItem(LEGACY_CATEGORIES_KEY);
  const legacyAnalytics = localStorage.getItem(LEGACY_ANALYTICS_KEY);
  return !!(legacyCategories || legacyAnalytics);
};

/**
 * Migrate existing data to Boon's namespace
 * @param {string} boonArtistId - The Firestore ID for Boon
 */
export const migrateExistingData = (boonArtistId) => {
  console.log('[Migration] Starting migration for Boon artist:', boonArtistId);

  // Migrate categories
  const legacyCategories = localStorage.getItem(LEGACY_CATEGORIES_KEY);
  if (legacyCategories) {
    console.log('[Migration] Migrating categories...');
    localStorage.setItem(`${CATEGORIES_PREFIX}${boonArtistId}`, legacyCategories);
    // Don't delete legacy data yet - keep as backup
    // localStorage.removeItem(LEGACY_CATEGORIES_KEY);
    console.log('[Migration] Categories migrated successfully');
  }

  // Migrate analytics
  const legacyAnalytics = localStorage.getItem(LEGACY_ANALYTICS_KEY);
  if (legacyAnalytics) {
    console.log('[Migration] Migrating analytics...');
    localStorage.setItem(`${ANALYTICS_PREFIX}${boonArtistId}`, legacyAnalytics);
    // Don't delete legacy data yet - keep as backup
    // localStorage.removeItem(LEGACY_ANALYTICS_KEY);
    console.log('[Migration] Analytics migrated successfully');
  }

  // Mark migration as complete
  localStorage.setItem('stm_migration_complete', new Date().toISOString());

  console.log('[Migration] Migration complete!');
};

/**
 * Create initial Boon artist in Firestore if not exists
 * @param {Object} db - Firestore database instance
 */
export const ensureBoonArtistExists = async (db) => {
  try {
    // Check if Boon already exists
    const artistsRef = collection(db, 'artists');
    const q = query(artistsRef, where('name', '==', 'Boon'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log('[Migration] Creating Boon artist in Firestore...');

      // Create Boon with existing data
      const boonData = {
        name: 'Boon',
        tier: 'Scale',
        cdTier: 'CD Lite',
        status: 'active',
        activeSince: 'Nov 2024',
        totalPages: 8,
        lateConnected: true,
        lateApiKey: '',
        lateAccountIds: {},
        metrics: { views: 0, engagement: 0, rate: 0 },
        createdAt: new Date().toISOString()
      };

      const docRef = await addDoc(artistsRef, boonData);
      console.log('[Migration] Boon artist created with ID:', docRef.id);

      // Migrate existing data to Boon's namespace
      migrateExistingData(docRef.id);

      // Set as last selected artist
      setLastArtistId(docRef.id);

      return { id: docRef.id, ...boonData };
    } else {
      // Boon exists, check if migration needed
      const boonDoc = snapshot.docs[0];
      const boonId = boonDoc.id;

      // Check if data is migrated
      const migratedCategories = localStorage.getItem(`${CATEGORIES_PREFIX}${boonId}`);
      if (!migratedCategories && needsMigration()) {
        migrateExistingData(boonId);
      }

      return { id: boonId, ...boonDoc.data() };
    }
  } catch (error) {
    console.error('[Migration] Error ensuring Boon artist exists:', error);
    return null;
  }
};

export default {
  getLastArtistId,
  setLastArtistId,
  subscribeToArtists,
  getArtists,
  getArtist,
  createArtist,
  updateArtist,
  deleteArtist,
  initializeArtistData,
  clearArtistData,
  getArtistCategories,
  saveArtistCategories,
  getArtistAnalytics,
  saveArtistAnalytics,
  getArtistLateConfig,
  saveArtistLateConfig,
  needsMigration,
  migrateExistingData,
  ensureBoonArtistExists
};
