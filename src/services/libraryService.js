/**
 * Library Service - Single source of truth for all media
 *
 * Architecture:
 * - Library: All uploaded media (videos, images, audio)
 * - Collections: User-curated subsets (like playlists)
 * - Smart Collections: Auto-generated based on criteria
 * - Created Content: Finished videos/slideshows
 *
 * Storage: Firestore (primary) with localStorage fallback
 * Data syncs across devices via Firestore
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import log from '../utils/logger';

export {
  addCreatedSlideshow,
  addCreatedSlideshowAsync,
  addCreatedSlideshowsBatch,
  addCreatedSlideshowsBatchAsync,
  addCreatedVideo,
  createCreatedSlideshow,
  createCreatedVideo,
  deleteCreatedSlideshow,
  deleteCreatedSlideshowAsync,
  deleteCreatedVideo,
  getAndClearLocallyDeletedContent,
  getCreatedContent,
  getDeletedContentAsync,
  loadCreatedContentAsync,
  markContentScheduled,
  markContentScheduledAsync,
  permanentlyDeleteContentAsync,
  restoreCreatedContentAsync,
  saveCreatedContent,
  saveCreatedContentAsync,
  softDeleteCreatedVideoAsync,
  subscribeToCreatedContent,
  unmarkContentScheduled,
  unmarkContentScheduledAsync,
  updateCreatedSlideshow,
  updateCreatedSlideshowAsync,
  updateCreatedVideo,
} from './createdContentService';
// ── Re-exports from extracted services ──
// Consumers continue to import from libraryService; these delegate to domain modules.
export {
  addLyrics,
  addLyricsAsync,
  createLyricsEntry,
  deleteLyrics,
  deleteLyricsAsync,
  getLyrics,
  saveLyrics,
  subscribeToLyrics,
  updateLyrics,
  updateLyricsAsync,
} from './lyricsService';

// Internal imports needed by project/niche functions
import {
  getCreatedContent,
  saveCreatedContent,
  saveCreatedContentAsync,
} from './createdContentService';

// ============================================================================
// PENDING DELETION TRACKING (prevents subscription race conditions)
// Persisted to localStorage so deleted items don't come back on page refresh.
// Items are auto-cleaned after 5 minutes (Firestore should have caught up by then).
// ============================================================================
const PENDING_DELETION_KEY = 'stm_pending_deletions';
// No TTL — pending deletions persist until Firestore confirms the doc is gone.
// Cleanup happens in subscribeToCollections when we see the doc is absent from a snapshot.

// Hydrate from localStorage on module load
const _loadPendingDeletions = () => {
  try {
    const raw = localStorage.getItem(PENDING_DELETION_KEY);
    if (!raw) return new Map();
    const entries = JSON.parse(raw);
    return new Map(entries);
  } catch {
    return new Map();
  }
};

const pendingDeletionMap = _loadPendingDeletions();
// Compat wrapper: expose as Set-like for existing code
const pendingDeletionIds = {
  has: (id) => pendingDeletionMap.has(id),
  add: () => {}, // no-op, use markCollectionPendingDeletion
  delete: () => {}, // no-op, use clearPendingDeletion
};

export const markCollectionPendingDeletion = (id) => {
  pendingDeletionMap.set(id, Date.now());
  try {
    localStorage.setItem(PENDING_DELETION_KEY, JSON.stringify([...pendingDeletionMap]));
  } catch {}
};
export const clearPendingDeletion = (id) => {
  pendingDeletionMap.delete(id);
  try {
    localStorage.setItem(PENDING_DELETION_KEY, JSON.stringify([...pendingDeletionMap]));
  } catch {}
};
export const isCollectionPendingDeletion = (id) => pendingDeletionMap.has(id);

/**
 * Returns a snapshot of all currently-pending-deletion collection IDs across
 * artists. Used by ProjectLanding's self-heal effect (QA-95-07): if a delete
 * was issued in a previous session but didn't actually land in Firestore, the
 * pending ID is still in the map. On next mount we re-fire the Firestore
 * delete for any pending IDs that show up in the live snapshot — this makes
 * failed deletes self-recover instead of zombie-resurrecting.
 */
export const getPendingDeletionIds = () => [...pendingDeletionMap.keys()];

// ============================================================================
// DELETION TOMBSTONES — persistent markers that survive pending-deletion cleanup
// When a collection is deleted, a tombstone is written to localStorage so the
// resurrection path (subscribeToCollections empty-Firestore branch) never
// re-uploads it. Tombstones auto-expire after 30 days.
// ============================================================================
const TOMBSTONE_PREFIX = 'stm_deleted_collections_';
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const markCollectionDeleted = (artistId, collectionId) => {
  if (!artistId || !collectionId) return;
  const key = TOMBSTONE_PREFIX + artistId;
  try {
    const raw = localStorage.getItem(key);
    const tombstones = raw ? JSON.parse(raw) : {};
    tombstones[collectionId] = Date.now();
    localStorage.setItem(key, JSON.stringify(tombstones));
  } catch {}
};

export const getDeletedCollectionIds = (artistId) => {
  if (!artistId) return new Set();
  const key = TOMBSTONE_PREFIX + artistId;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const tombstones = JSON.parse(raw);
    const now = Date.now();
    const live = {};
    for (const [id, ts] of Object.entries(tombstones)) {
      if (now - ts < TOMBSTONE_TTL_MS) live[id] = ts;
    }
    // Prune expired tombstones on read
    if (Object.keys(live).length !== Object.keys(tombstones).length) {
      localStorage.setItem(key, JSON.stringify(live));
    }
    return new Set(Object.keys(live));
  } catch {
    return new Set();
  }
};

// ============================================================================
// RECENT COLLECTION WRITES (protects against subscription overwriting fresh data)
// The subscription handler reads Firestore + localStorage, but the Firestore data
// may be stale. If addToCollection/assignToBank wrote to localStorage between
// Firestore sync and subscription fire, the subscription may overwrite the fresh
// localStorage with stale merged data. This map tracks recent writes so guards
// can always recover the data.
// ============================================================================
const recentCollectionSnapshots = new Map(); // collectionId -> { mediaIds, banks, updatedAt, ts }
export const getRecentCollectionSnapshots = () => recentCollectionSnapshots;
export const trackCollectionWrite = (collectionId, collection) => {
  const ts = Date.now();
  recentCollectionSnapshots.set(collectionId, {
    mediaIds: [...(collection.mediaIds || [])],
    banks: (collection.banks || []).map((b) => [...(b || [])]),
    updatedAt: collection.updatedAt || new Date().toISOString(),
    ts,
  });
  // Auto-expire after 60 seconds
  setTimeout(() => {
    const entry = recentCollectionSnapshots.get(collectionId);
    if (entry && entry.ts === ts) recentCollectionSnapshots.delete(collectionId);
  }, 60000);
};

// Track recent REMOVALS so subscription guards don't re-add deleted items
const recentCollectionRemovals = new Map(); // collectionId -> { removedIds: Set, ts }
export const getRecentCollectionRemovals = () => recentCollectionRemovals;
const trackCollectionRemoval = (collectionId, removedMediaIds) => {
  const ts = Date.now();
  const existing = recentCollectionRemovals.get(collectionId);
  const removedIds = new Set([...(existing?.removedIds || []), ...removedMediaIds]);
  recentCollectionRemovals.set(collectionId, { removedIds, ts });
  setTimeout(() => {
    const entry = recentCollectionRemovals.get(collectionId);
    if (entry && entry.ts === ts) recentCollectionRemovals.delete(collectionId);
  }, 60000);
};

// ============================================================================
// CONSTANTS
// ============================================================================

export const MEDIA_TYPES = {
  VIDEO: 'video',
  IMAGE: 'image',
  AUDIO: 'audio',
};

export const COLLECTION_TYPES = {
  USER: 'user',
  SMART: 'smart',
  TEMPLATE: 'template',
};

export const SMART_COLLECTION_IDS = {
  RECENT: 'smart_recent',
  FAVORITES: 'smart_favorites',
  HAS_AUDIO: 'smart_has_audio',
  MOST_USED: 'smart_most_used',
  UNUSED: 'smart_unused',
  AUDIO_ALL: 'smart_audio_all',
};

// Starter templates for onboarding
export const STARTER_TEMPLATES = {
  MUSIC_ARTIST: {
    id: 'template_music_artist',
    name: 'Music Artist',
    description: 'Perfect for musicians, bands, and music producers',
    icon: '🎵',
    collections: [
      { name: 'Performances', description: 'Live shows, concerts, studio sessions' },
      { name: 'Behind the Scenes', description: 'Studio footage, rehearsals, creative process' },
      { name: 'Lyrics & Visuals', description: 'Lyric videos, visualizers, album art' },
      { name: 'Press & Promo', description: 'Interviews, press photos, promotional content' },
      { name: 'Music Videos', description: 'Official music video clips and teasers' },
    ],
  },
  FASHION_CREATOR: {
    id: 'template_fashion_creator',
    name: 'Fashion Creator',
    description: 'For fashion influencers and style content creators',
    icon: '👗',
    collections: [
      { name: 'OOTD', description: 'Outfit of the day looks' },
      { name: 'Hauls', description: 'Shopping hauls and unboxings' },
      { name: 'Brand Collabs', description: 'Sponsored content and partnerships' },
      { name: 'Aesthetics', description: 'Mood boards, color palettes, vibes' },
      { name: 'Runway & Events', description: 'Fashion shows, events, parties' },
    ],
  },
  LIFESTYLE: {
    id: 'template_lifestyle',
    name: 'Lifestyle',
    description: 'For daily vloggers and lifestyle content creators',
    icon: '✨',
    collections: [
      { name: 'Daily Vlogs', description: 'Day-in-the-life content' },
      { name: 'Routines', description: 'Morning, night, workout routines' },
      { name: 'Reviews', description: 'Product reviews and recommendations' },
      { name: 'Travel', description: 'Travel content and adventures' },
      { name: 'Food & Cooking', description: 'Recipes, restaurants, food content' },
    ],
  },
  BUSINESS_BRAND: {
    id: 'template_business_brand',
    name: 'Business / Brand',
    description: 'For businesses, entrepreneurs, and brand accounts',
    icon: '💼',
    collections: [
      { name: 'Products', description: 'Product showcases and demos' },
      { name: 'Testimonials', description: 'Customer reviews and success stories' },
      { name: 'Team', description: 'Behind the scenes, team content' },
      { name: 'Events', description: 'Launches, conferences, meetups' },
      { name: 'Educational', description: 'Tips, tutorials, how-tos' },
    ],
  },
  CUSTOM: {
    id: 'template_custom',
    name: 'Start Fresh',
    description: 'Create your own organization system',
    icon: '🎨',
    collections: [],
  },
};

// ============================================================================
// STORAGE KEYS
// ============================================================================

const getLibraryKey = (artistId) => `stm_library_${artistId}`;
const getCollectionsKey = (artistId) => `stm_collections_${artistId}`;
const getOnboardingKey = (artistId) => `stm_onboarding_${artistId}`;
const getUsageStatsKey = (artistId) => `stm_usage_stats_${artistId}`;

// ============================================================================
// FIRESTORE IN-MEMORY CACHE
// When localStorage quota is exceeded, these provide fallback data from the
// last Firestore subscription snapshot. Populated by subscribeToLibrary and
// subscribeToCollections automatically.
// ============================================================================
const _firestoreLibraryCache = new Map(); // artistId → media items[]
const _firestoreCollectionsCache = new Map(); // artistId → collections[]

// ============================================================================
// MEDIA ITEM SCHEMA
// ============================================================================

/**
 * Creates a new media item for the library
 * @param {Object} params - Media parameters
 * @returns {Object} Media item
 */
export const createMediaItem = ({
  type,
  name,
  url = null,
  thumbnailUrl = null,
  storagePath = null,
  localPath = null,
  localUrl = null,
  syncStatus = null,
  collectionIds = [],
  duration = null,
  width = null,
  height = null,
  hasEmbeddedAudio = false,
  thumbnail = null,
  metadata = {},
}) => {
  const now = new Date().toISOString();
  // Default syncStatus by what we actually have:
  //   localPath only → 'local'
  //   url only → 'cloud'
  //   both → 'synced'
  //   neither → 'cloud' (legacy default)
  const computedSyncStatus =
    syncStatus || (localPath && url ? 'synced' : localPath ? 'local' : 'cloud');
  return {
    id: `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type, // video | image | audio
    name,
    // Use null (NOT undefined) when missing — Firestore rejects undefined values.
    url: url || null, // Firebase Storage URL (permanent, full-res)
    thumbnailUrl: thumbnailUrl || null, // Firebase Storage URL (small ~300px version for grids)
    // Prefer explicit localUrl, then file:// from localPath, then fall back to cloud url.
    localUrl: localUrl || url || null,
    storagePath: storagePath || null, // Path in Firebase Storage
    duration, // For video/audio
    width, // For video/image
    height, // For video/image
    aspectRatio: width && height ? width / height : null,
    hasEmbeddedAudio, // For video clips
    thumbnail: null, // Never persist base64 thumbnails

    // Audio trim points (for audio type)
    trimStart: metadata.trimStart ?? null,
    trimEnd: metadata.trimEnd ?? null,

    // Linked lyrics (for audio type)
    linkedLyricsId: metadata.linkedLyricsId ?? null,

    // Organization
    collectionIds, // Which collections this belongs to
    tags: [], // User-defined tags
    isFavorite: false,

    // Usage tracking
    useCount: 0,
    lastUsedAt: null,
    lastPostedAt: null,

    // Metadata
    metadata: {
      ...metadata,
      originalName: name,
      fileSize: metadata.fileSize || null,
      mimeType: metadata.mimeType || null,
    },

    // Local drive (Electron desktop)
    syncStatus: computedSyncStatus, // 'cloud' | 'local' | 'synced' | 'offline'
    localPath: localPath || null, // relative path on drive (e.g. 'StickToMusic/Artist/media/clip.mp4')

    // Timestamps
    createdAt: now,
    updatedAt: now,
  };
};

// ============================================================================
// COLLECTION SCHEMA
// ============================================================================

/**
 * Creates a new collection
 * @param {Object} params - Collection parameters
 * @returns {Object} Collection
 */
export const createCollection = ({
  name,
  description = '',
  type = COLLECTION_TYPES.USER,
  parentId = null,
  icon = null,
  color = null,
}) => {
  const now = new Date().toISOString();
  return {
    id: `collection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name,
    description,
    type, // user | smart | template
    parentId, // For nested collections
    icon,
    color,

    // For user collections - explicit media list
    mediaIds: [],

    // For smart collections - query criteria
    smartCriteria: null,

    // Per-collection caption and hashtag banks for scheduling
    captionBank: { always: [], pool: [] },
    hashtagBank: { always: [], pool: [] },

    // Timestamps
    createdAt: now,
    updatedAt: now,
  };
};

/**
 * Creates smart collection definitions
 * @returns {Object[]} Smart collections
 */
export const createSmartCollections = () => {
  const now = new Date().toISOString();

  return [
    {
      id: SMART_COLLECTION_IDS.RECENT,
      name: 'Recent',
      description: 'Uploads from the last 30 days',
      type: COLLECTION_TYPES.SMART,
      icon: '🕐',
      smartCriteria: { type: 'recent', days: 30 },
      createdAt: now,
    },
    {
      id: SMART_COLLECTION_IDS.FAVORITES,
      name: 'Favorites',
      description: 'Your starred items',
      type: COLLECTION_TYPES.SMART,
      icon: '⭐',
      smartCriteria: { type: 'favorites' },
      createdAt: now,
    },
    {
      id: SMART_COLLECTION_IDS.HAS_AUDIO,
      name: 'Has Audio',
      description: 'Video clips with embedded audio',
      type: COLLECTION_TYPES.SMART,
      icon: '🔊',
      smartCriteria: { type: 'hasAudio' },
      createdAt: now,
    },
    {
      id: SMART_COLLECTION_IDS.MOST_USED,
      name: 'Most Used',
      description: 'Your go-to content',
      type: COLLECTION_TYPES.SMART,
      icon: '🔥',
      smartCriteria: { type: 'mostUsed', minUses: 2 },
      createdAt: now,
    },
    {
      id: SMART_COLLECTION_IDS.UNUSED,
      name: 'Unused',
      description: "Content you haven't used yet",
      type: COLLECTION_TYPES.SMART,
      icon: '💤',
      smartCriteria: { type: 'unused' },
      createdAt: now,
    },
    {
      id: SMART_COLLECTION_IDS.AUDIO_ALL,
      name: 'All Audio',
      description: 'All audio clips in your library',
      type: COLLECTION_TYPES.SMART,
      icon: '🎵',
      smartCriteria: { type: 'audio' },
      createdAt: now,
    },
  ];
};

// ============================================================================
// LIBRARY OPERATIONS
// ============================================================================

/**
 * Get the full library for an artist
 * @param {string} artistId
 * @returns {Object[]} Array of media items
 */
export const getLibrary = (artistId) => {
  try {
    const data = localStorage.getItem(getLibraryKey(artistId));
    if (data) return JSON.parse(data);
  } catch (error) {
    log.error('Error loading library:', error);
  }
  // Fallback: Firestore in-memory cache (survives localStorage quota exceeded)
  return _firestoreLibraryCache.get(artistId) || [];
};

/**
 * Save the full library for an artist
 * @param {string} artistId
 * @param {Object[]} library
 */
export const saveLibrary = (artistId, library) => {
  try {
    // Clean before saving - remove blob URLs and base64 thumbnails
    const cleanedLibrary = library
      .map((item) => ({
        ...item,
        thumbnail: null, // Never persist thumbnails
        url: item.url?.startsWith('blob:') ? null : item.url, // Remove blob URLs
      }))
      // Keep items that have EITHER a public url OR a local reference (local-first items)
      .filter((item) => item.url || item.localPath || item.localUrl);

    localStorage.setItem(getLibraryKey(artistId), JSON.stringify(cleanedLibrary));
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      // Library is too large for localStorage — don't delete it.
      // Firestore subscription + in-memory cache provide the data.
      log.warn('[Library] localStorage quota exceeded — using Firestore cache as fallback');
    } else {
      log.error('Error saving library:', error);
    }
  }
};

/**
 * Add a media item to the library
 * @param {string} artistId
 * @param {Object} mediaItem
 * @returns {Object} The added item with ID
 */
export const addToLibrary = (artistId, mediaItem) => {
  // BUG-027: Validate audio duration > 0
  if (mediaItem.type === 'audio' && mediaItem.duration !== undefined && mediaItem.duration <= 0) {
    log.warn('[Library] Rejected audio item with invalid duration:', mediaItem.duration);
    return null;
  }
  const library = getLibrary(artistId);
  const newItem = mediaItem.id ? mediaItem : createMediaItem(mediaItem);
  library.push(newItem);
  saveLibrary(artistId, library);
  return newItem;
};

/**
 * Add multiple media items to the library
 * @param {string} artistId
 * @param {Object[]} mediaItems
 * @returns {Object[]} The added items
 */
export const addManyToLibrary = (artistId, mediaItems) => {
  const library = getLibrary(artistId);
  const newItems = mediaItems.map((item) => (item.id ? item : createMediaItem(item)));
  library.push(...newItems);
  saveLibrary(artistId, library);
  return newItems;
};

/**
 * Update a media item in the library
 * @param {string} artistId
 * @param {string} mediaId
 * @param {Object} updates
 * @returns {Object|null} Updated item or null
 */
export const updateLibraryItem = (artistId, mediaId, updates) => {
  const library = getLibrary(artistId);
  const index = library.findIndex((item) => item.id === mediaId);
  if (index === -1) return null;

  library[index] = {
    ...library[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  saveLibrary(artistId, library);
  return library[index];
};

/**
 * Remove a media item from the library
 * @param {string} artistId
 * @param {string} mediaId
 * @returns {boolean} Success
 */
export const removeFromLibrary = (artistId, mediaId, db = null) => {
  const library = getLibrary(artistId);
  const filtered = library.filter((item) => item.id !== mediaId);
  if (filtered.length === library.length) return false;

  saveLibrary(artistId, filtered);

  // Remove from ALL collection references: mediaIds, banks, mediaBanks
  const collections = getCollections(artistId);
  const changedCollections = new Set();
  collections.forEach((col) => {
    let changed = false;
    // Remove from mediaIds
    if (col.mediaIds?.includes(mediaId)) {
      col.mediaIds = col.mediaIds.filter((id) => id !== mediaId);
      changed = true;
    }
    // Remove from slide banks (array of arrays)
    if (Array.isArray(col.banks)) {
      col.banks = col.banks.map((bank) => {
        if (Array.isArray(bank) && bank.includes(mediaId)) {
          changed = true;
          return bank.filter((id) => id !== mediaId);
        }
        return bank;
      });
    }
    // Remove from named media banks
    if (Array.isArray(col.mediaBanks)) {
      col.mediaBanks = col.mediaBanks.map((bank) => {
        if (bank && Array.isArray(bank.mediaIds) && bank.mediaIds.includes(mediaId)) {
          changed = true;
          return { ...bank, mediaIds: bank.mediaIds.filter((id) => id !== mediaId) };
        }
        return bank;
      });
    }
    if (changed) changedCollections.add(col);
  });

  saveCollections(artistId, collections);
  if (db) {
    changedCollections.forEach((col) =>
      saveCollectionToFirestore(db, artistId, col).catch(log.error),
    );
  }

  return true;
};

/**
 * Get library items by type
 * @param {string} artistId
 * @param {string} type - video | image | audio
 * @returns {Object[]} Filtered items
 */
export const getLibraryByType = (artistId, type) => {
  return getLibrary(artistId).filter((item) => item.type === type);
};

/**
 * Toggle favorite status
 * @param {string} artistId
 * @param {string} mediaId
 * @returns {boolean} New favorite status
 */
export const toggleFavorite = (artistId, mediaId) => {
  const library = getLibrary(artistId);
  const item = library.find((i) => i.id === mediaId);
  if (!item) return false;

  item.isFavorite = !item.isFavorite;
  item.updatedAt = new Date().toISOString();
  saveLibrary(artistId, library);
  return item.isFavorite;
};

/**
 * Increment use count for a media item
 * @param {string} artistId
 * @param {string} mediaId
 */
export const incrementUseCount = (artistId, mediaId) => {
  const library = getLibrary(artistId);
  const item = library.find((i) => i.id === mediaId);
  if (item) {
    item.useCount = (item.useCount || 0) + 1;
    item.lastUsedAt = new Date().toISOString();
    saveLibrary(artistId, library);
  }
};

/**
 * Mark a media item as posted (updates lastPostedAt timestamp).
 * Called when a scheduled post goes live via Late.co.
 * @param {string} artistId
 * @param {string} mediaId
 */
export const markMediaPosted = (artistId, mediaId) => {
  const library = getLibrary(artistId);
  const item = library.find((i) => i.id === mediaId);
  if (item) {
    item.lastPostedAt = new Date().toISOString();
    saveLibrary(artistId, library);
  }
};

/**
 * Get media items from a niche that have never been used in generation.
 * Useful for clip recycling — prioritize fresh footage.
 * @param {string} artistId
 * @param {string} nicheId — collection ID of the niche
 * @returns {Object[]} unused media items, newest first
 */
export const getUnusedMedia = (artistId, nicheId) => {
  const library = getLibrary(artistId);
  const collections = getCollections(artistId);
  const niche = collections.find((c) => c.id === nicheId);
  if (!niche) return [];

  // Gather all media IDs in this niche (from banks or mediaBanks)
  const nicheMediaIds = new Set();
  if (niche.mediaBanks) {
    niche.mediaBanks.forEach((bank) =>
      (bank.mediaIds || []).forEach((id) => nicheMediaIds.add(id)),
    );
  }
  if (niche.banks) {
    niche.banks.forEach((bank) => (bank || []).forEach((id) => nicheMediaIds.add(id)));
  }

  return library
    .filter((item) => nicheMediaIds.has(item.id) && (!item.useCount || item.useCount === 0))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

/**
 * Get media items from a niche sorted by freshness (least recently used first).
 * Items never used come first, then sorted by lastUsedAt ascending.
 * @param {string} artistId
 * @param {string} nicheId — collection ID of the niche
 * @returns {Object[]} media items, freshest first
 */
export const getFreshestMedia = (artistId, nicheId) => {
  const library = getLibrary(artistId);
  const collections = getCollections(artistId);
  const niche = collections.find((c) => c.id === nicheId);
  if (!niche) return [];

  // Gather all media IDs in this niche
  const nicheMediaIds = new Set();
  if (niche.mediaBanks) {
    niche.mediaBanks.forEach((bank) =>
      (bank.mediaIds || []).forEach((id) => nicheMediaIds.add(id)),
    );
  }
  if (niche.banks) {
    niche.banks.forEach((bank) => (bank || []).forEach((id) => nicheMediaIds.add(id)));
  }

  return library
    .filter((item) => nicheMediaIds.has(item.id))
    .sort((a, b) => {
      // Never-used items first
      if (!a.useCount && b.useCount) return -1;
      if (a.useCount && !b.useCount) return 1;
      // Then by lastUsedAt ascending (oldest use = freshest for reuse)
      const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
      const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
      return aTime - bTime;
    });
};

// ============================================================================
// COLLECTION OPERATIONS
// ============================================================================

/**
 * Get all collections for an artist (includes smart collections)
 * @param {string} artistId
 * @returns {Object[]} Array of collections
 */
export const getCollections = (artistId) => {
  let userCollections = [];
  try {
    const data = localStorage.getItem(getCollectionsKey(artistId));
    if (data) userCollections = JSON.parse(data);
  } catch (error) {
    log.error('Error loading collections:', error);
  }

  // Fallback: Firestore in-memory cache (survives localStorage quota exceeded)
  if (userCollections.length === 0) {
    const cached = _firestoreCollectionsCache.get(artistId);
    if (cached?.length > 0) userCollections = cached;
  }

  // Deduplicate and filter out pending deletions
  const seen = new Set();
  const dedupedCollections = userCollections.filter((col) => {
    if (seen.has(col.id)) return false;
    if (pendingDeletionIds.has(col.id)) return false;
    seen.add(col.id);
    return true;
  });

  // Always include smart collections
  const smartCollections = createSmartCollections();

  return [...smartCollections, ...dedupedCollections];
};

/**
 * Get only user-created collections
 * @param {string} artistId
 * @returns {Object[]} User collections
 */
export const getUserCollections = (artistId) => {
  try {
    const data = localStorage.getItem(getCollectionsKey(artistId));
    if (data) return JSON.parse(data);
  } catch (error) {
    log.error('Error loading user collections:', error);
  }
  // Fallback: Firestore in-memory cache (survives localStorage quota exceeded)
  return _firestoreCollectionsCache.get(artistId) || [];
};

/**
 * Save user collections (not smart collections)
 * @param {string} artistId
 * @param {Object[]} collections
 */
export const saveCollections = (artistId, collections) => {
  try {
    // Filter out smart collections before saving
    const userCollections = collections.filter((c) => c.type !== COLLECTION_TYPES.SMART);
    localStorage.setItem(getCollectionsKey(artistId), JSON.stringify(userCollections));
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      log.warn('[saveCollections] localStorage quota exceeded — Firestore is source of truth');
    } else {
      log.error('Error saving collections:', error);
    }
  }
};

/**
 * Create a new collection
 * @param {string} artistId
 * @param {Object} collectionData
 * @returns {Object} Created collection
 */
export const createNewCollection = (artistId, collectionData, db = null) => {
  const collections = getUserCollections(artistId);
  const newCollection = createCollection(collectionData);
  collections.push(newCollection);
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, newCollection).catch(log.error);
  return newCollection;
};

/**
 * Update a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {Object} updates
 * @returns {Object|null} Updated collection
 */
export const updateCollection = (artistId, collectionId, updates, db = null) => {
  const collections = getUserCollections(artistId);
  const index = collections.findIndex((c) => c.id === collectionId);
  if (index === -1) return null;

  collections[index] = {
    ...collections[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collections[index]).catch(log.error);
  return collections[index];
};

/**
 * Delete a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {boolean} Success
 */
export const deleteCollection = (artistId, collectionId, db = null) => {
  const collections = getUserCollections(artistId);
  const filtered = collections.filter((c) => c.id !== collectionId);
  if (filtered.length === collections.length) return false;

  // Also remove collection reference from library items
  const library = getLibrary(artistId);
  library.forEach((item) => {
    if (item.collectionIds?.includes(collectionId)) {
      item.collectionIds = item.collectionIds.filter((id) => id !== collectionId);
    }
  });
  saveLibrary(artistId, library);

  saveCollections(artistId, filtered);
  markCollectionDeleted(artistId, collectionId);
  if (db) {
    deleteCollectionFromFirestore(db, artistId, collectionId).catch(log.error);
    // Cascade-delete any scheduled posts that referenced this collection/niche.
    // Lazy-import to avoid a service-layer circular dep.
    import('./scheduledPostsService')
      .then(({ deletePostsByCollectionId }) =>
        deletePostsByCollectionId(db, artistId, collectionId),
      )
      .catch(log.error);
  }
  return true;
};

/**
 * Add media to a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 */
export const addToCollection = (artistId, collectionId, mediaIds, db = null) => {
  const idsToAdd = Array.isArray(mediaIds) ? mediaIds : [mediaIds];

  // Update collection's mediaIds
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (collection) {
    const beforeCount = collection.mediaIds?.length || 0;
    collection.mediaIds = [...new Set([...(collection.mediaIds || []), ...idsToAdd])];
    collection.updatedAt = new Date().toISOString();
    log(
      '[addToCollection]',
      collection.name,
      '| before:',
      beforeCount,
      '→ after:',
      collection.mediaIds.length,
      '| added:',
      idsToAdd,
    );
    saveCollections(artistId, collections);
    trackCollectionWrite(collectionId, collection);
    if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
  } else {
    log.warn('[addToCollection] Collection not found:', collectionId);
  }

  // Update library items' collectionIds
  const library = getLibrary(artistId);
  library.forEach((item) => {
    if (idsToAdd.includes(item.id)) {
      item.collectionIds = [...new Set([...(item.collectionIds || []), collectionId])];
      item.updatedAt = new Date().toISOString();
    }
  });
  saveLibrary(artistId, library);
};

// ── Dynamic Slide Bank System ──
// Banks are stored as arrays: collection.banks = [[], [], ...] (image IDs per slide position)
// Text banks: collection.textBanks = [[], [], ...] (text strings per slide position)
// Minimum 2 banks always. Users can add more via "+ Add Slide Bank".

export const BANK_COLORS = [
  {
    primary: '#6366f1',
    light: '#a5b4fc',
    bg: 'rgba(99,102,241,0.06)',
    border: 'rgba(99,102,241,0.6)',
  },
  {
    primary: '#22c55e',
    light: '#86efac',
    bg: 'rgba(34,197,94,0.06)',
    border: 'rgba(34,197,94,0.6)',
  },
  {
    primary: '#a855f7',
    light: '#d8b4fe',
    bg: 'rgba(168,85,247,0.06)',
    border: 'rgba(168,85,247,0.6)',
  },
  {
    primary: '#f43f5e',
    light: '#fda4af',
    bg: 'rgba(244,63,94,0.06)',
    border: 'rgba(244,63,94,0.6)',
  },
  {
    primary: '#f59e0b',
    light: '#fcd34d',
    bg: 'rgba(245,158,11,0.06)',
    border: 'rgba(245,158,11,0.6)',
  },
  {
    primary: '#06b6d4',
    light: '#67e8f9',
    bg: 'rgba(6,182,212,0.06)',
    border: 'rgba(6,182,212,0.6)',
  },
];
export const MIN_BANKS = 2;
export const MAX_BANKS = 10;
export const getBankColor = (index) => BANK_COLORS[index % BANK_COLORS.length];
export const getBankLabel = (index) => `Slide ${index + 1}`;

/**
 * Migrate a collection from legacy bankA/B/C/D format to dynamic banks[] array.
 * Safe to call multiple times — no-op if already migrated.
 */
export const migrateCollectionBanks = (collection) => {
  if (!collection) return collection;
  if (collection.banks) return collection; // Already migrated

  const banks = [];
  // Pull from legacy letter-keyed properties
  ['bankA', 'bankB', 'bankC', 'bankD'].forEach((key, i) => {
    if (collection[key]?.length > 0) banks[i] = [...collection[key]];
  });
  // Ensure minimum 2 banks, fill sparse gaps
  while (banks.length < MIN_BANKS) banks.push([]);
  for (let i = 0; i < banks.length; i++) if (!banks[i]) banks[i] = [];

  const textBanks = [];
  ['textBank1', 'textBank2', 'textBank3', 'textBank4'].forEach((key, i) => {
    if (collection[key]?.length > 0) textBanks[i] = [...collection[key]];
  });
  while (textBanks.length < MIN_BANKS) textBanks.push([]);
  for (let i = 0; i < textBanks.length; i++) if (!textBanks[i]) textBanks[i] = [];

  // Delete legacy bank keys after migration
  const migrated = { ...collection, banks, textBanks };
  delete migrated.bankA;
  delete migrated.bankB;
  delete migrated.bankC;
  delete migrated.bankD;
  delete migrated.textBank1;
  delete migrated.textBank2;
  delete migrated.textBank3;
  delete migrated.textBank4;

  return migrated;
};

/**
 * Add a new slide bank to a collection (both image + text)
 */
export const addBankToCollection = (artistId, collectionId, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  if (collection.banks.length >= MAX_BANKS) return;
  collection.banks.push([]);
  collection.textBanks = collection.textBanks || [];
  collection.textBanks.push([]);
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Remove a slide bank from a collection (must keep minimum 2)
 */
export const removeBankFromCollection = (artistId, collectionId, bankIndex, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  if (collection.banks.length <= MIN_BANKS) return;
  collection.banks.splice(bankIndex, 1);
  if (collection.textBanks?.[bankIndex] !== undefined) collection.textBanks.splice(bankIndex, 1);
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Assign media to a slide bank within a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 * @param {number|string} bank - 0-based index OR legacy letter ('A','B','C','D')
 */
export const assignToBank = (artistId, collectionId, mediaIds, bank, db = null) => {
  const idsToAssign = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  // Support both legacy letters and new numeric index
  let bankIndex;
  if (typeof bank === 'number') {
    bankIndex = bank;
  } else {
    const legacyMap = { A: 0, B: 1, C: 2, D: 3 };
    bankIndex = legacyMap[bank] !== undefined ? legacyMap[bank] : parseInt(bank, 10) || 0;
  }

  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;

  // Auto-migrate if needed
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);

  // Ensure media is in this collection first
  collection.mediaIds = [...new Set([...collection.mediaIds, ...idsToAssign])];

  // Extend banks array if needed
  while (collection.banks.length <= bankIndex) collection.banks.push([]);

  // Add to target bank
  collection.banks[bankIndex] = [...new Set([...collection.banks[bankIndex], ...idsToAssign])];
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  trackCollectionWrite(collectionId, collection);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);

  // Also update library items' collectionIds
  const library = getLibrary(artistId);
  library.forEach((item) => {
    if (idsToAssign.includes(item.id)) {
      item.collectionIds = [...new Set([...(item.collectionIds || []), collectionId])];
      item.updatedAt = new Date().toISOString();
    }
  });
  saveLibrary(artistId, library);
};

/**
 * Remove media from a bank (unassign — keeps it in the collection)
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 */
export const removeFromBank = (artistId, collectionId, mediaIds, db = null) => {
  const idsToRemove = Array.isArray(mediaIds) ? mediaIds : [mediaIds];

  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;

  // Auto-migrate if needed
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);

  // Remove from all banks dynamically
  collection.banks = collection.banks.map((bank) => bank.filter((id) => !idsToRemove.includes(id)));
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Extract plain text from a text bank entry (string or { text, style } object)
 */
export const getTextBankText = (entry) => (typeof entry === 'string' ? entry : entry?.text || '');

/**
 * Extract style from a text bank entry, or null if plain string
 */
export const getTextBankStyle = (entry) =>
  typeof entry === 'object' && entry?.style ? entry.style : null;

// ── Named Media Banks (for video niches) ──────────────────────────────────────

export const MAX_MEDIA_BANKS = 6;

/**
 * Migrate a video niche from flat mediaIds to named mediaBanks.
 * No-op if mediaBanks already present. Safe to call multiple times.
 */
export const migrateToMediaBanks = (collection) => {
  if (!collection) return collection;
  // Deserialize mediaBanks if it's a JSON string (from Firestore serialization)
  if (typeof collection.mediaBanks === 'string') {
    try {
      collection.mediaBanks = JSON.parse(collection.mediaBanks);
    } catch {
      collection.mediaBanks = null;
    }
  }
  if (Array.isArray(collection.mediaBanks) && collection.mediaBanks.length > 0) return collection;
  // Use deterministic ID derived from collection ID so React keys stay stable across re-renders
  const defaultBank = {
    id: 'mb_' + (collection.id || 'default').slice(0, 12),
    name: 'All Media',
    mediaIds: [...(collection.mediaIds || [])],
  };
  return { ...collection, mediaBanks: [defaultBank] };
};

/**
 * Sync niche.mediaIds to be the union of all mediaBanks' mediaIds
 */
const syncMediaBankIds = (collection) => {
  if (!collection.mediaBanks) return;
  const allIds = new Set();
  collection.mediaBanks.forEach((bank) => (bank.mediaIds || []).forEach((id) => allIds.add(id)));
  // Preserve any audio IDs that are in mediaIds but not in any media bank
  (collection.mediaIds || []).forEach((id) => {
    // Keep IDs not in any bank (they could be audio or other non-bank items)
    const inBank = collection.mediaBanks.some((b) => (b.mediaIds || []).includes(id));
    if (!inBank) allIds.add(id);
  });
  collection.mediaIds = [...allIds];
};

/**
 * Add a named media bank to a video niche
 */
export const addMediaBank = (artistId, collectionId, name, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return null;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  if ((collection.mediaBanks || []).length >= MAX_MEDIA_BANKS) return null;
  const newBank = {
    id: Date.now().toString(36),
    name: name || `Bank ${collection.mediaBanks.length + 1}`,
    mediaIds: [],
  };
  collection.mediaBanks.push(newBank);
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
  return newBank;
};

/**
 * Remove a named media bank. Moves its media to the first remaining bank.
 */
export const removeMediaBank = (artistId, collectionId, bankId, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  if (!collection.mediaBanks) return;
  if (collection.mediaBanks.length <= 1) return; // Must keep at least 1
  const idx = collection.mediaBanks.findIndex((b) => b.id === bankId);
  if (idx === -1) return;
  const removed = collection.mediaBanks.splice(idx, 1)[0];
  // Move orphaned media to first remaining bank
  if (removed.mediaIds?.length > 0) {
    const target = collection.mediaBanks[0];
    target.mediaIds = [...new Set([...(target.mediaIds || []), ...removed.mediaIds])];
  }
  syncMediaBankIds(collection);
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Rename a named media bank
 */
export const renameMediaBank = (artistId, collectionId, bankId, newName, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  const bank = collection.mediaBanks.find((b) => b.id === bankId);
  if (!bank) return;
  bank.name = newName;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Add media IDs to a specific named media bank + sync niche.mediaIds
 */
export const assignToMediaBank = (artistId, collectionId, mediaIds, bankId, db = null) => {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  const bank = collection.mediaBanks.find((b) => b.id === bankId);
  if (!bank) return;
  bank.mediaIds = [...new Set([...(bank.mediaIds || []), ...ids])];
  // Ensure all items are in the flat mediaIds too
  collection.mediaIds = [...new Set([...(collection.mediaIds || []), ...ids])];
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Move media IDs from one named bank to another (remove from source, add to target)
 */
export const moveMediaBetweenBanks = (
  artistId,
  collectionId,
  mediaIds,
  fromBankId,
  toBankId,
  db = null,
) => {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  if (!Array.isArray(collection.mediaBanks)) return;
  const fromBank = collection.mediaBanks.find((b) => b.id === fromBankId);
  const toBank = collection.mediaBanks.find((b) => b.id === toBankId);
  if (!fromBank || !toBank) return;
  // Remove from source
  fromBank.mediaIds = (fromBank.mediaIds || []).filter((id) => !ids.includes(id));
  // Add to target (dedupe)
  toBank.mediaIds = [...new Set([...(toBank.mediaIds || []), ...ids])];
  syncMediaBankIds(collection);
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Remove media IDs from a specific named media bank + sync niche.mediaIds
 */
export const removeFromMediaBank = (
  artistId,
  collectionId,
  mediaIds,
  bankId,
  db = null,
  alsoRemoveFromNiche = false,
) => {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  if (!collection.mediaBanks) return;
  const bank = collection.mediaBanks.find((b) => b.id === bankId);
  if (!bank) return;
  bank.mediaIds = (bank.mediaIds || []).filter((id) => !ids.includes(id));
  // Also remove from niche entirely (mediaIds + all banks) in one atomic write
  if (alsoRemoveFromNiche) {
    trackCollectionRemoval(collectionId, ids);
    collection.mediaBanks.forEach((b) => {
      b.mediaIds = (b.mediaIds || []).filter((id) => !ids.includes(id));
    });
    collection.mediaIds = (collection.mediaIds || []).filter((id) => !ids.includes(id));
  } else {
    syncMediaBankIds(collection);
  }
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Add text to a text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1-based slide position (1 = Slide 1, etc.)
 * @param {string|object} text - plain string or { text, style } object
 */
export const addToTextBank = (artistId, collectionId, bankNum, text, db = null) => {
  const collections = getUserCollections(artistId);
  let collection = collections.find((c) => c.id === collectionId);
  const foundInLocal = !!collection;
  if (!collection) {
    // localStorage may be stale/full — build a minimal collection object for Firestore write
    log.warn(
      '[addToTextBank] Collection not in localStorage, writing directly to Firestore:',
      collectionId,
    );
    collection = { id: collectionId, textBanks: [], banks: [] };
  }
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  // bankNum can be 0-based or 1-based depending on caller — normalize
  const idx = bankNum >= 0 ? bankNum : 0;
  if (!collection.textBanks) collection.textBanks = [];
  while (collection.textBanks.length <= idx) collection.textBanks.push([]);
  // Ensure slot is a valid array (might be null/undefined from Firestore)
  if (!Array.isArray(collection.textBanks[idx])) collection.textBanks[idx] = [];
  collection.textBanks[idx] = [...collection.textBanks[idx], text];
  collection.updatedAt = new Date().toISOString();
  if (foundInLocal) {
    saveCollections(artistId, collections);
  }
  if (db) {
    // When collection wasn't in localStorage, use a transaction to atomically
    // read + merge + write the textBanks. This prevents the lost-update race
    // when two devices add to the same bank concurrently.
    if (!foundInLocal) {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', collectionId);
      runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists()) {
          const data = snap.data();
          let existingTB = data.textBanks || [];
          if (typeof existingTB === 'string')
            try {
              existingTB = JSON.parse(existingTB);
            } catch {
              existingTB = [];
            }
          while (existingTB.length <= idx) existingTB.push([]);
          if (!Array.isArray(existingTB[idx])) existingTB[idx] = [];
          existingTB[idx] = [...existingTB[idx], text];
          tx.set(
            docRef,
            { ...data, textBanks: existingTB, updatedAt: new Date().toISOString() },
            { merge: true },
          );
        } else {
          tx.set(docRef, collection, { merge: true });
        }
      }).catch((err) => log.error('[addToTextBank] Firestore txn ERROR:', err));
    } else {
      saveCollectionToFirestore(db, artistId, collection).catch(log.error);
    }
  }
};

/**
 * Remove text from a text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1-based slide position
 * @param {number} index
 */
export const removeFromTextBank = (artistId, collectionId, bankNum, index, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  const idx = bankNum >= 0 ? bankNum : 0;
  if (!collection.textBanks) collection.textBanks = [];
  if (Array.isArray(collection.textBanks[idx])) {
    collection.textBanks[idx] = collection.textBanks[idx].filter((_, i) => i !== index);
  }
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Update a single text entry in a text bank (edit in place)
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 0-based slide position
 * @param {number} index - entry index within the bank
 * @param {string} newText - updated text value
 */
export const updateTextBankEntry = (artistId, collectionId, bankNum, index, newText, db = null) => {
  const collections = getUserCollections(artistId);
  let collection = collections.find((c) => c.id === collectionId);
  const foundInLocal = !!collection;
  if (!collection) {
    log.warn(
      '[updateTextBankEntry] Collection not in localStorage, writing directly to Firestore:',
      collectionId,
    );
    collection = { id: collectionId, textBanks: [], banks: [] };
  }
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  const idx = bankNum >= 0 ? bankNum : 0;
  if (!collection.textBanks) collection.textBanks = [];

  const applyUpdate = (tb) => {
    if (Array.isArray(tb[idx]) && index >= 0 && index < tb[idx].length) {
      const existing = tb[idx][index];
      if (typeof existing === 'object' && existing !== null && existing.text !== undefined) {
        tb[idx][index] = { ...existing, text: newText };
      } else {
        tb[idx][index] = newText;
      }
    }
  };

  applyUpdate(collection.textBanks);
  collection.updatedAt = new Date().toISOString();
  if (foundInLocal) {
    saveCollections(artistId, collections);
    if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
  } else if (db) {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', collectionId);
    runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      if (snap.exists()) {
        const data = snap.data();
        let existingTB = data.textBanks || [];
        if (typeof existingTB === 'string')
          try {
            existingTB = JSON.parse(existingTB);
          } catch {
            existingTB = [];
          }
        applyUpdate(existingTB);
        tx.set(
          docRef,
          { ...data, textBanks: existingTB, updatedAt: new Date().toISOString() },
          { merge: true },
        );
      }
    }).catch((err) => log.error('[updateTextBankEntry] Firestore txn ERROR:', err));
  }
};

/**
 * Update entire text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1-based slide position
 * @param {string[]} texts
 */
export const updateTextBank = (artistId, collectionId, bankNum, texts, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  const idx = bankNum >= 0 ? bankNum : 0;
  if (!collection.textBanks) collection.textBanks = [];
  while (collection.textBanks.length <= idx) collection.textBanks.push([]);
  collection.textBanks[idx] = texts;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Add text to a video text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {string} text
 */
export const addToVideoTextBank = (artistId, collectionId, bankNum, text, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const key = `videoTextBank${bankNum}`;
  collection[key] = [...(collection[key] || []), text];
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Remove text from a video text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {number} index
 */
export const removeFromVideoTextBank = (artistId, collectionId, bankNum, index, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  const key = `videoTextBank${bankNum}`;
  collection[key] = (collection[key] || []).filter((_, i) => i !== index);
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Update entire video text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {string[]} texts
 */
export const updateVideoTextBank = (artistId, collectionId, bankNum, texts, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  collection[`videoTextBank${bankNum}`] = texts;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Save text style templates for a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {Object[]} templates
 */
export const saveTextTemplates = (artistId, collectionId, templates, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  collection.textTemplates = templates;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

// ============================================================================
// COLLECTION CAPTION & HASHTAG BANKS
// ============================================================================

/**
 * Get a collection's caption bank (with fallback for older collections)
 * @param {Object} collection
 * @returns {{ always: string[], pool: string[] }}
 */
export const getCollectionCaptionBank = (collection) => {
  return collection?.captionBank || { always: [], pool: [] };
};

/**
 * Get a collection's hashtag bank (with fallback for older collections)
 * @param {Object} collection
 * @returns {{ always: string[], pool: string[] }}
 */
export const getCollectionHashtagBank = (collection) => {
  return collection?.hashtagBank || { always: [], pool: [] };
};

/**
 * Update a collection's caption bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {{ always: string[], pool: string[] }} captionBank
 */
export const updateCollectionCaptionBank = (artistId, collectionId, captionBank, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  collection.captionBank = captionBank;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Update a collection's hashtag bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {{ always: string[], pool: string[] }} hashtagBank
 */
export const updateCollectionHashtagBank = (artistId, collectionId, hashtagBank, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;
  collection.hashtagBank = hashtagBank;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

// ============================================================================
// PER-PLATFORM HASHTAG RESOLUTION
// ============================================================================

/**
 * Resolve effective always/pool hashtag lists for a given platform.
 * Merges global always/pool with platformOnly additions and filters platformExclude.
 * Handles backward-compatible formats (flat array, { always, pool } without platform fields).
 *
 * @param {Object|Array} hashtagBank — bank data (flat array, or { always, pool, platformOnly?, platformExclude? })
 * @param {string|null} platform — 'tiktok' | 'instagram' | 'youtube' | 'facebook' | null (null = no platform filtering)
 * @returns {{ always: string[], pool: string[] }}
 */
export const getEffectiveHashtags = (hashtagBank, platform = null) => {
  // Handle flat array (legacy format)
  if (Array.isArray(hashtagBank)) {
    return { always: hashtagBank, pool: [] };
  }
  if (!hashtagBank || typeof hashtagBank !== 'object') {
    return { always: [], pool: [] };
  }

  let always = [...(hashtagBank.always || [])];
  let pool = [...(hashtagBank.pool || [])];

  if (platform) {
    // Add platform-specific tags
    const platformTags = hashtagBank.platformOnly?.[platform] || [];
    always = [...always, ...platformTags];

    // Remove excluded tags
    const excluded = new Set(hashtagBank.platformExclude?.[platform] || []);
    if (excluded.size > 0) {
      always = always.filter((t) => !excluded.has(t));
      pool = pool.filter((t) => !excluded.has(t));
    }
  }

  return { always, pool };
};

/**
 * One-call resolution of caption + hashtag banks for a collection/niche.
 * Returns merged bank data ready for scheduling.
 *
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {{ caption: string, alwaysHashtags: string[], poolHashtags: string[], alwaysCaptions: string[], poolCaptions: string[], platformOnly: Object, platformExclude: Object }}
 */
export const resolveCollectionBanks = (artistId, collectionId) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);

  const emptyCB = { always: [], pool: [] };
  const emptyHB = { always: [], pool: [] };

  const cb = collection ? getCollectionCaptionBank(collection) : emptyCB;
  const hb = collection ? getCollectionHashtagBank(collection) : emptyHB;

  // Handle flat array legacy formats
  const alwaysCaptions = Array.isArray(cb) ? cb : cb.always || [];
  const poolCaptions = Array.isArray(cb) ? [] : cb.pool || [];
  const alwaysHashtags = Array.isArray(hb) ? hb : hb.always || [];
  const poolHashtags = Array.isArray(hb) ? [] : hb.pool || [];

  const rawBank = collection?.hashtagBank || {};
  const platformOnly = (!Array.isArray(rawBank) && rawBank.platformOnly) || {};
  const platformExclude = (!Array.isArray(rawBank) && rawBank.platformExclude) || {};

  return {
    caption: alwaysCaptions[0] || '',
    alwaysHashtags,
    poolHashtags,
    alwaysCaptions,
    poolCaptions,
    platformOnly,
    platformExclude,
  };
};

/**
 * Save platform-specific hashtag additions for a collection.
 * @param {string} artistId
 * @param {string} collectionId
 * @param {Object} platformOnly — e.g. { tiktok: ['#fyp'], instagram: ['#reels'] }
 * @param {Object|null} db
 */
export const updateCollectionPlatformHashtags = (
  artistId,
  collectionId,
  platformOnly,
  db = null,
) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;

  // Ensure hashtagBank is object format
  if (Array.isArray(collection.hashtagBank)) {
    collection.hashtagBank = { always: collection.hashtagBank, pool: [] };
  }
  if (!collection.hashtagBank) {
    collection.hashtagBank = { always: [], pool: [] };
  }

  collection.hashtagBank.platformOnly = platformOnly;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Save platform exclusion rules for a collection.
 * @param {string} artistId
 * @param {string} collectionId
 * @param {Object} platformExclude — e.g. { instagram: ['#fyp'], facebook: ['#fyp'] }
 * @param {Object|null} db
 */
export const updateCollectionPlatformExcludes = (
  artistId,
  collectionId,
  platformExclude,
  db = null,
) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return;

  // Ensure hashtagBank is object format
  if (Array.isArray(collection.hashtagBank)) {
    collection.hashtagBank = { always: collection.hashtagBank, pool: [] };
  }
  if (!collection.hashtagBank) {
    collection.hashtagBank = { always: [], pool: [] };
  }

  collection.hashtagBank.platformExclude = platformExclude;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

// ============================================================================
// PIPELINE SYSTEM — Extended collections with formats & linked pages
// ============================================================================

/**
 * Pre-defined content format templates
 */
export const FORMAT_TEMPLATES = [
  { id: 'single', name: '1 Slide', slideCount: 1, slideLabels: ['Image'], type: 'slideshow' },
  {
    id: 'hook_lyrics',
    name: '2 Slide',
    slideCount: 2,
    slideLabels: ['Hook', 'Lyrics'],
    type: 'slideshow',
  },
  {
    id: 'carousel',
    name: '3 Slide',
    slideCount: 3,
    slideLabels: ['Slide 1', 'Slide 2', 'Slide 3'],
    type: 'slideshow',
  },
  {
    id: 'four_slide',
    name: '4 Slide',
    slideCount: 4,
    slideLabels: ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4'],
    type: 'slideshow',
  },
  {
    id: 'hook_vibes_lyrics',
    name: '5 Slide',
    slideCount: 5,
    slideLabels: ['Hook', 'Text', 'Text', 'Text', 'Lyrics'],
    type: 'slideshow',
  },
  {
    id: 'six_slide',
    name: '6 Slide',
    slideCount: 6,
    slideLabels: ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4', 'Slide 5', 'Slide 6'],
    type: 'slideshow',
  },
  {
    id: 'seven_slide',
    name: '7 Slide',
    slideCount: 7,
    slideLabels: ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4', 'Slide 5', 'Slide 6', 'Slide 7'],
    type: 'slideshow',
  },
  {
    id: 'montage',
    name: 'Montage',
    slideCount: 0,
    slideLabels: [],
    type: 'video',
    description: 'Combine clips on a timeline, cut to beat',
  },
  {
    id: 'solo_clip',
    name: 'Solo Clip',
    slideCount: 0,
    slideLabels: [],
    type: 'video',
    description: 'One clip per video, batch generate',
  },
  {
    id: 'multi_clip',
    name: 'Multi Clip',
    slideCount: 0,
    slideLabels: [],
    type: 'video',
    description: 'Multiple clips on timeline',
  },
  {
    id: 'photo_montage',
    name: 'Photo Montage',
    slideCount: 0,
    slideLabels: [],
    type: 'video',
    description: 'Turn photos into video with transitions',
  },
  {
    id: 'finished_media',
    name: 'Finished Media',
    slideCount: 0,
    slideLabels: [],
    type: 'video',
    description: 'Upload ready-to-post videos & images',
  },
  {
    id: 'clipper',
    name: 'Clipper',
    slideCount: 0,
    slideLabels: [],
    type: 'video',
    description: 'Split a video into multiple clips',
  },
];

/**
 * Accent colors for pipeline listing cards
 */
export const PIPELINE_COLORS = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#a855f7', // purple
  '#f43f5e', // rose
  '#f59e0b', // amber
  '#06b6d4', // cyan
];

/**
 * Create a pipeline (an extended collection with format + linked page)
 * @param {Object} params
 * @param {string} params.name
 * @param {Object} [params.linkedPage] - { handle, platform, accountId }
 * @param {Object[]} [params.formats] - Array of format objects with slideLabels
 * @param {string} [params.activeFormatId]
 * @param {string} [params.description]
 * @param {string} [params.color] - Accent color
 * @returns {Object} Pipeline collection object
 */
export const createPipeline = ({
  name,
  linkedPage = null,
  formats = [FORMAT_TEMPLATES[1]], // Default: 2 Slide
  activeFormatId = null,
  description = '',
  color = null,
  projectId = null,
}) => {
  const base = createCollection({ name, description, color });
  const activeFormat = formats.find((f) => f.id === activeFormatId) || formats[0];
  const isVideoFormat = activeFormat?.type === 'video';
  const slideCount = isVideoFormat ? 0 : activeFormat?.slideCount || 2;

  // Pre-allocate banks to match active format's slide count (skip for video formats)
  const banks = [];
  const textBanks = [];
  if (!isVideoFormat) {
    for (let i = 0; i < Math.max(slideCount, MIN_BANKS); i++) {
      banks.push([]);
      textBanks.push([]);
    }
  }

  return {
    ...base,
    isPipeline: true,
    linkedPage,
    formats: formats.map((f) => ({ ...f })),
    activeFormatId: activeFormat?.id || null,
    pipelineColor: color || PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
    banks,
    textBanks,
    ...(projectId ? { projectId } : {}),
  };
};

/**
 * Get a bank label using the pipeline's active format labels instead of "Slide N"
 * Falls back to getBankLabel for non-pipeline collections or out-of-range indices
 */
export const getPipelineBankLabel = (pipeline, index) => {
  if (!pipeline?.isPipeline || !pipeline.formats) return getBankLabel(index);
  const activeFormat =
    pipeline.formats.find((f) => f.id === pipeline.activeFormatId) || pipeline.formats[0];
  if (activeFormat?.slideLabels && index < activeFormat.slideLabels.length) {
    return activeFormat.slideLabels[index];
  }
  // Video formats (clipper, multi_clip, etc.) use "Bucket N" not "Slide N"
  if (activeFormat?.type === 'video') return `Bucket ${index + 1}`;
  return getBankLabel(index);
};

/**
 * Remove media from a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 */
export const removeFromCollection = (artistId, collectionId, mediaIds, db = null) => {
  const idsToRemove = Array.isArray(mediaIds) ? mediaIds : [mediaIds];

  // Track removal so subscription guards don't re-add these items
  trackCollectionRemoval(collectionId, idsToRemove);

  // Update collection's mediaIds
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (collection) {
    collection.mediaIds = collection.mediaIds.filter((id) => !idsToRemove.includes(id));
    collection.updatedAt = new Date().toISOString();
    saveCollections(artistId, collections);
    if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
  }

  // Update library items' collectionIds
  const library = getLibrary(artistId);
  library.forEach((item) => {
    if (idsToRemove.includes(item.id)) {
      item.collectionIds = (item.collectionIds || []).filter((id) => id !== collectionId);
      item.updatedAt = new Date().toISOString();
    }
  });
  saveLibrary(artistId, library);
};

// ============================================================================
// PROJECT SYSTEM — "One Screen to Rule Them All"
// Projects group niches (pipelines) under a shared media pool.
// A Project Root is a collection with isProjectRoot: true.
// A Niche is a pipeline with projectId pointing to a project root.
// ============================================================================

/**
 * Create a project root collection
 * @param {string} artistId
 * @param {Object} params
 * @param {string} params.name
 * @param {Object|null} params.linkedPage - { handle, platform, accountId }
 * @param {string} params.color - Accent color from PIPELINE_COLORS
 * @returns {Object} Project root collection
 */
export const createProject = (artistId, { name, linkedPage = null, color = null }, db = null) => {
  const base = createCollection({ name, description: '' });
  const project = {
    ...base,
    isProjectRoot: true,
    linkedPage,
    projectColor: color || PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
  };
  const collections = getUserCollections(artistId);
  collections.push(project);
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, project).catch(log.error);
  return project;
};

/**
 * Get all project roots for an artist
 */
export const getProjects = (artistId) => {
  const collections = getUserCollections(artistId);
  return collections.filter((c) => c.isProjectRoot === true);
};

/**
 * Get a specific project by ID
 */
export const getProjectById = (artistId, projectId) => {
  const collections = getUserCollections(artistId);
  return collections.find((c) => c.id === projectId && c.isProjectRoot === true) || null;
};

/**
 * Get all niches (pipelines) in a project
 */
export const getProjectNiches = (artistId, projectId) => {
  const collections = getUserCollections(artistId);
  return collections.filter((c) => c.projectId === projectId && c.isPipeline === true);
};

/**
 * Create a niche (pipeline) linked to a project
 * @param {string} artistId
 * @param {Object} params
 * @param {string} params.projectId - ID of the parent project root
 * @param {Object} params.format - FORMAT_TEMPLATE entry
 * @param {string} [params.name] - Override name (defaults to format name)
 * @returns {Object} The new niche (pipeline collection)
 */
export const createNiche = (artistId, { projectId, format, name = null }, db = null) => {
  const pipeline = createPipeline({
    name: name || format.name,
    formats: [format],
    activeFormatId: format.id,
  });
  pipeline.projectId = projectId;
  const collections = getUserCollections(artistId);
  collections.push(pipeline);
  // Auto-create first bank so the niche is immediately usable
  const firstBank = {
    id: Date.now().toString(36),
    name: 'Bank 1',
    mediaIds: [],
  };
  pipeline.mediaBanks = [firstBank];
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, pipeline).catch(log.error);
  return pipeline;
};

/**
 * Add media IDs to a project root's shared pool
 */
export const addToProjectPool = (artistId, projectId, mediaIds, db = null) => {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const collections = getUserCollections(artistId);
  const project = collections.find((c) => c.id === projectId && c.isProjectRoot);
  if (!project) return;
  const existing = new Set(project.mediaIds || []);
  const newIds = ids.filter((id) => !existing.has(id));
  if (newIds.length === 0) return;
  project.mediaIds = [...(project.mediaIds || []), ...newIds];
  project.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, project).catch(log.error);
};

/**
 * Remove media IDs from a project root's shared pool
 */
export const removeFromProjectPool = (artistId, projectId, mediaIds, db = null) => {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const collections = getUserCollections(artistId);
  const project = collections.find((c) => c.id === projectId && c.isProjectRoot);
  if (!project || !project.mediaIds) return;
  const removeSet = new Set(ids);
  project.mediaIds = project.mediaIds.filter((id) => !removeSet.has(id));
  project.updatedAt = new Date().toISOString();
  trackCollectionRemoval(projectId, ids);
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, project).catch(log.error);
};

/**
 * Get stats for a project: niche count, draft count, media count
 */
export const getProjectStats = (artistId, projectId) => {
  const collections = getUserCollections(artistId);
  const niches = collections.filter((c) => c.projectId === projectId && c.isPipeline);
  const project = collections.find((c) => c.id === projectId && c.isProjectRoot);
  const content = getCreatedContent(artistId);
  const nicheIds = new Set(niches.map((n) => n.id));
  const draftCount = [
    ...(content.slideshows || []).filter((s) => !s.isTemplate && nicheIds.has(s.collectionId)),
    ...(content.videos || []).filter((v) => nicheIds.has(v.collectionId)),
  ].length;
  // Build niche format descriptions (e.g. "Hook + Lyrics", "Photo Montage")
  const nicheFormats = niches.map((n) => {
    const fmt = n.formats?.[0];
    if (fmt?.name) return fmt.name;
    return n.name || 'Niche';
  });
  return {
    nicheCount: niches.length,
    nicheFormats,
    draftCount,
    mediaCount: (project?.mediaIds || []).length,
  };
};

/**
 * Update caption bank for a niche
 */
export const updateNicheCaptionBank = (artistId, nicheId, captions, db = null) => {
  const cols = getUserCollections(artistId);
  const idx = cols.findIndex((c) => c.id === nicheId);
  if (idx === -1) return;
  cols[idx].captionBank = captions;
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Update hashtag bank for a niche
 */
export const updateNicheHashtagBank = (artistId, nicheId, hashtags, db = null) => {
  const cols = getUserCollections(artistId);
  const idx = cols.findIndex((c) => c.id === nicheId);
  if (idx === -1) return;
  cols[idx].hashtagBank = hashtags;
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Update caption bank for a project root (project-level, not niche-level).
 * Writes to localStorage + Firestore.
 */
export const updateProjectCaptionBank = (artistId, projectId, captions, db = null) => {
  const cols = getUserCollections(artistId);
  const idx = cols.findIndex((c) => c.id === projectId && c.isProjectRoot);
  if (idx === -1) return;
  cols[idx].captionBank = captions;
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Update hashtag bank for a project root (project-level, not niche-level).
 * Writes to localStorage + Firestore.
 */
export const updateProjectHashtagBank = (artistId, projectId, hashtags, db = null) => {
  const cols = getUserCollections(artistId);
  const idx = cols.findIndex((c) => c.id === projectId && c.isProjectRoot);
  if (idx === -1) return;
  cols[idx].hashtagBank = hashtags;
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Update audio ID for a niche
 */
export const updateNicheAudioId = (artistId, nicheId, audioId, db = null) => {
  const cols = getUserCollections(artistId);
  const idx = cols.findIndex((c) => c.id === nicheId);
  if (idx === -1) return;
  cols[idx].audioId = audioId;
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Update media order for a niche (reorder mediaIds array)
 */
export const updateNicheMediaOrder = (artistId, nicheId, orderedIds, db = null) => {
  const cols = getUserCollections(artistId);
  const idx = cols.findIndex((c) => c.id === nicheId);
  if (idx === -1) return;
  cols[idx].mediaIds = orderedIds;
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Update trim points on a media item stored in a niche
 */
export const updateMediaTrimPoints = (
  artistId,
  nicheId,
  mediaId,
  trimStart,
  trimEnd,
  db = null,
) => {
  const cols = getUserCollections(artistId);
  const colIdx = cols.findIndex((c) => c.id === nicheId);
  if (colIdx === -1) return;
  if (!cols[colIdx].trimData) cols[colIdx].trimData = {};
  cols[colIdx].trimData[mediaId] = { trimStart, trimEnd };
  cols[colIdx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[colIdx]).catch(log.error);
};

/**
 * Save (create or update) a clipper session on a niche
 */
export const saveClipperSession = (artistId, nicheId, session, db = null) => {
  const cols = getUserCollections(artistId);
  const idx = cols.findIndex((c) => c.id === nicheId);
  if (idx === -1) return null;
  const sessions = [...(cols[idx].clipperSessions || [])];
  const existingIdx = sessions.findIndex((s) => s.id === session.id);
  const now = new Date().toISOString();
  if (existingIdx !== -1) {
    sessions[existingIdx] = { ...session, updatedAt: now };
  } else {
    sessions.push({ ...session, createdAt: session.createdAt || now, updatedAt: now });
  }
  cols[idx].clipperSessions = sessions;
  cols[idx].updatedAt = now;
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
  return session;
};

/**
 * Delete a clipper session from a niche
 */
export const deleteClipperSession = (artistId, nicheId, sessionId, db = null) => {
  const cols = getUserCollections(artistId);
  const idx = cols.findIndex((c) => c.id === nicheId);
  if (idx === -1) return;
  cols[idx].clipperSessions = (cols[idx].clipperSessions || []).filter((s) => s.id !== sessionId);
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Get a structured tree of all projects' banks for cross-pollination.
 * Returns: [{ project, niches: [{ niche, format, banks: [{ label, images: [{id,url,thumbnailUrl}] }], captions, hashtags }] }]
 * Excludes the specified project.
 */
export const getProjectBankTree = (artistId, excludeProjectId = null) => {
  const collections = getUserCollections(artistId);
  const lib = getLibrary(artistId);
  const projects = collections.filter((c) => c.isProjectRoot === true && c.id !== excludeProjectId);

  return projects
    .map((project) => {
      const niches = collections.filter((c) => c.projectId === project.id && c.isPipeline === true);
      return {
        project: { id: project.id, name: project.name, color: project.projectColor },
        niches: niches.map((niche) => {
          const format = niche.formats?.[0] || null;
          const slideCount = format?.slideCount || 0;
          const banks = Array.from({ length: slideCount }).map((_, bankIdx) => {
            const label = getPipelineBankLabel(niche, bankIdx);
            const images = (niche.banks?.[bankIdx] || [])
              .map((id) => lib.find((m) => m.id === id))
              .filter(Boolean)
              .map((m) => ({ id: m.id, url: m.url, thumbnailUrl: m.thumbnailUrl, name: m.name }));
            const textEntries = (niche.textBanks?.[bankIdx] || []).map((e) => getTextBankText(e));
            return { label, images, textEntries };
          });
          return {
            niche: { id: niche.id, name: niche.name },
            format,
            banks,
            captions: Array.isArray(niche.captionBank)
              ? niche.captionBank
              : [...(niche.captionBank?.always || []), ...(niche.captionBank?.pool || [])],
            hashtags: Array.isArray(niche.hashtagBank)
              ? niche.hashtagBank
              : [...(niche.hashtagBank?.always || []), ...(niche.hashtagBank?.pool || [])],
          };
        }),
      };
    })
    .filter((p) => p.niches.length > 0);
};

/**
 * Idempotent migration: convert existing pipelines into the project system.
 * Phase 1 (always runs): Dedup project roots, fix @@names, re-assign orphans, delete Firestore dupes.
 * Phase 2 (once per artist): Create new project roots from unmigrated pipelines.
 * Saves to both localStorage AND Firestore to survive subscription merges.
 */
export const migrateToProjects = async (artistId, db = null) => {
  const flagKey = `stm_projects_migrated_v2_${artistId}`;
  const collections = getUserCollections(artistId);
  let needsSave = false;
  const firestoreDeleteIds = []; // Track IDs to delete from Firestore

  // ── Phase 1: ALWAYS run cleanup (dedup, @@fix, orphan re-assign) ──

  // Fix double-@ in project names
  collections
    .filter((c) => c.isProjectRoot)
    .forEach((p) => {
      if (p.name && p.name.startsWith('@@')) {
        p.name = p.name.slice(1);
        needsSave = true;
      }
    });

  // Dedup project roots by linkedPage.handle (or name for unlinked)
  const projectRoots = collections.filter((c) => c.isProjectRoot);
  if (projectRoots.length > 0) {
    const seenKeys = new Set();
    const dupeIds = new Set();
    projectRoots.forEach((p) => {
      // Normalize key: strip leading @ for comparison
      const rawKey = p.linkedPage?.handle || p.name || p.id;
      const key = rawKey.replace(/^@+/, '');
      if (seenKeys.has(key)) {
        dupeIds.add(p.id);
      } else {
        seenKeys.add(key);
      }
    });
    if (dupeIds.size > 0) {
      const survivors = projectRoots.filter((p) => !dupeIds.has(p.id));
      dupeIds.forEach((dupeId) => {
        const dupe = collections.find((c) => c.id === dupeId);
        if (!dupe) return;
        const rawKey = dupe.linkedPage?.handle || dupe.name || dupe.id;
        const key = rawKey.replace(/^@+/, '');
        const survivor = survivors.find((s) => {
          const sk = (s.linkedPage?.handle || s.name || s.id).replace(/^@+/, '');
          return sk === key;
        });
        if (survivor) {
          collections
            .filter((c) => c.projectId === dupeId)
            .forEach((n) => {
              n.projectId = survivor.id;
            });
          const merged = new Set([...(survivor.mediaIds || []), ...(dupe.mediaIds || [])]);
          survivor.mediaIds = Array.from(merged);
        }
        firestoreDeleteIds.push(dupeId);
      });
      for (let i = collections.length - 1; i >= 0; i--) {
        if (dupeIds.has(collections[i].id)) collections.splice(i, 1);
      }
      needsSave = true;
      log('[libraryService] Cleaned up', dupeIds.size, 'duplicate project roots');
    }
  }

  // Re-assign orphaned niches (lost projectId from subscription clobber)
  const existingRoots = collections.filter((c) => c.isProjectRoot);
  const orphanNiches = collections.filter((c) => c.isPipeline && !c.projectId && !c.isProjectRoot);
  if (existingRoots.length > 0 && orphanNiches.length > 0) {
    orphanNiches.forEach((niche) => {
      const nicheHandle = niche.linkedPage?.handle;
      const matchingRoot = nicheHandle
        ? existingRoots.find((r) => r.linkedPage?.handle === nicheHandle)
        : null;
      if (matchingRoot) {
        niche.projectId = matchingRoot.id;
        const poolIds = new Set(matchingRoot.mediaIds || []);
        (niche.mediaIds || []).forEach((id) => poolIds.add(id));
        matchingRoot.mediaIds = Array.from(poolIds);
        needsSave = true;
      }
    });
  }

  // Save Phase 1 cleanup + delete Firestore dupes
  if (needsSave) {
    saveCollections(artistId, collections);
    if (db) {
      // Delete duplicate docs from Firestore
      if (firestoreDeleteIds.length > 0) {
        firestoreDeleteIds.forEach((id) => {
          const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', id);
          deleteDoc(docRef).catch(() => {});
        });
        log(
          '[libraryService] Deleting',
          firestoreDeleteIds.length,
          'duplicate docs from Firestore',
        );
      }
      // Save surviving roots + reassigned niches to Firestore
      const modified = collections.filter((c) => c.isProjectRoot || c.projectId);
      Promise.all(modified.map((col) => saveCollectionToFirestore(db, artistId, col))).catch(
        log.error,
      );
    }
  }

  // ── Phase 2: Create new projects (guarded — once per artist) ──
  if (localStorage.getItem(flagKey)) return;

  const unmigrated = collections.filter((c) => c.isPipeline && !c.projectId && !c.isProjectRoot);
  if (unmigrated.length === 0) {
    localStorage.setItem(flagKey, Date.now().toString());
    return;
  }

  const groups = {};
  unmigrated.forEach((pipeline) => {
    const key = pipeline.linkedPage?.handle || `standalone_${pipeline.id}`;
    if (!groups[key]) groups[key] = { linkedPage: pipeline.linkedPage || null, niches: [] };
    groups[key].niches.push(pipeline);
  });

  const newProjects = [];
  Object.entries(groups).forEach(([key, group]) => {
    const handle = group.linkedPage?.handle || '';
    const projectName = group.linkedPage
      ? handle.startsWith('@')
        ? handle
        : `@${handle}`
      : group.niches.length === 1
        ? group.niches[0].name
        : key;
    const base = createCollection({ name: projectName, description: '' });
    const project = {
      ...base,
      isProjectRoot: true,
      linkedPage: group.linkedPage,
      projectColor:
        group.niches[0]?.pipelineColor ||
        PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
    };

    const allMediaIds = new Set();
    group.niches.forEach((niche) => {
      (niche.mediaIds || []).forEach((id) => allMediaIds.add(id));
    });
    project.mediaIds = Array.from(allMediaIds);

    // Migrate caption/hashtag banks from old collection format to flat arrays
    group.niches.forEach((niche) => {
      niche.projectId = project.id;
      if (
        niche.captionBank &&
        typeof niche.captionBank === 'object' &&
        !Array.isArray(niche.captionBank)
      ) {
        const { always = [], pool = [] } = niche.captionBank;
        niche.captionBank = [...always, ...pool];
      }
      if (
        niche.hashtagBank &&
        typeof niche.hashtagBank === 'object' &&
        !Array.isArray(niche.hashtagBank)
      ) {
        const { always = [], pool = [] } = niche.hashtagBank;
        niche.hashtagBank = [...always, ...pool];
      }
    });
    collections.push(project);
    newProjects.push(project);
  });

  saveCollections(artistId, collections);
  localStorage.setItem(flagKey, Date.now().toString());
  log(
    '[libraryService] Migrated',
    unmigrated.length,
    'pipelines into',
    newProjects.length,
    'projects',
  );

  if (db) {
    try {
      const toSave = [...newProjects, ...unmigrated];
      await Promise.all(toSave.map((col) => saveCollectionToFirestore(db, artistId, col)));
      log('[libraryService] Saved', toSave.length, 'migrated collections to Firestore');
    } catch (err) {
      log.error('[libraryService] Firestore migration save failed:', err);
    }
  }
};

/**
 * Migrate unassigned drafts into niches based on slide count.
 * Creates project + niches if they don't exist. Only sets collectionId — no content modified.
 * Safe + idempotent (guarded by localStorage flag, skips already-assigned drafts).
 */
export const migrateDraftsToNiches = async (artistId, db = null) => {
  // Always ensure project media pools are populated (even if draft migration already ran)
  const existingProject = getProjects(artistId)[0];
  if (existingProject) {
    const library = getLibrary(artistId);
    if (
      library.length > 0 &&
      (!existingProject.mediaIds || existingProject.mediaIds.length === 0)
    ) {
      existingProject.mediaIds = library.map((item) => item.id);
      const cols = getUserCollections(artistId);
      const idx = cols.findIndex((c) => c.id === existingProject.id);
      if (idx !== -1) cols[idx] = existingProject;
      saveCollections(artistId, cols);
      if (db) await saveCollectionToFirestore(db, artistId, existingProject);
      log('[libraryService] Populated project media pool with', library.length, 'items');
    }

    // Always populate niche mediaIds + banks from assigned draft slide images
    const niches = getProjectNiches(artistId, existingProject.id);
    const content = getCreatedContent(artistId);
    const lib = getLibrary(artistId);
    let nichesDirty = false;
    niches.forEach((niche) => {
      const nicheDrafts = (content.slideshows || []).filter(
        (s) => s.collectionId === niche.id && !s.isTemplate,
      );
      if (nicheDrafts.length === 0) return;
      const imageIds = new Set(niche.mediaIds || []);
      const beforeSize = imageIds.size;
      // Ensure banks array exists
      if (!niche.banks) niche.banks = [];
      const bankSets = niche.banks.map((b) => new Set(b || []));
      let banksDirty = false;
      // Also build text bank sets from draft text overlays
      if (!niche.textBanks) niche.textBanks = [];
      const textBankSets = niche.textBanks.map(
        (tb) =>
          new Set((tb || []).map((e) => (typeof e === 'string' ? e : e?.text)).filter(Boolean)),
      );
      let textDirty = false;
      nicheDrafts.forEach((draft) => {
        (draft.slides || []).forEach((slide, slideIdx) => {
          // Resolve image ID from sourceImageId, or match by backgroundImage URL
          let imgId = slide.sourceImageId || slide.imageId;
          if (!imgId && slide.backgroundImage) {
            const match = lib.find((m) => m.url === slide.backgroundImage);
            if (match) imgId = match.id;
          }
          if (imgId) {
            imageIds.add(imgId);
            while (bankSets.length <= slideIdx) bankSets.push(new Set());
            if (!bankSets[slideIdx].has(imgId)) {
              bankSets[slideIdx].add(imgId);
              banksDirty = true;
            }
          }
          // Extract text overlays into text banks for this slide position
          (slide.textOverlays || []).forEach((overlay) => {
            if (!overlay.text?.trim()) return;
            while (textBankSets.length <= slideIdx) textBankSets.push(new Set());
            if (!textBankSets[slideIdx].has(overlay.text.trim())) {
              textBankSets[slideIdx].add(overlay.text.trim());
              textDirty = true;
            }
          });
        });
      });
      if (imageIds.size > beforeSize || banksDirty || textDirty) {
        niche.mediaIds = Array.from(imageIds);
        niche.banks = bankSets.map((s) => Array.from(s));
        if (textDirty) {
          niche.textBanks = textBankSets.map((s) => Array.from(s));
        }
        const cols2 = getUserCollections(artistId);
        const nIdx = cols2.findIndex((c) => c.id === niche.id);
        if (nIdx !== -1) {
          cols2[nIdx] = niche;
          nichesDirty = true;
        }
        saveCollections(artistId, cols2);
      }
    });
    if (nichesDirty && db) {
      Promise.all(
        niches
          .filter((n) => n.mediaIds?.length > 0)
          .map((n) => saveCollectionToFirestore(db, artistId, n)),
      ).catch(log.error);
      log('[libraryService] Populated niche media pools + banks from draft images');
    }

    // Always patch stale niche format labels & names to match current FORMAT_TEMPLATES
    const allNiches = getProjectNiches(artistId, existingProject.id);
    let labelsDirty = false;
    allNiches.forEach((niche) => {
      if (!niche.formats?.length) return;
      niche.formats.forEach((fmt) => {
        const template = FORMAT_TEMPLATES.find((t) => t.id === fmt.id);
        if (!template) return;
        const needsLabelFix =
          JSON.stringify(fmt.slideLabels) !== JSON.stringify(template.slideLabels);
        const needsNameFix = fmt.name !== template.name;
        if (needsLabelFix || needsNameFix) {
          fmt.slideLabels = [...template.slideLabels];
          fmt.name = template.name;
          labelsDirty = true;
        }
      });
      // Also update niche name if it matches old format name
      const OLD_NAME_MAP = {
        'Hook + Vibes + Lyrics': '5 Slide',
        'Hook + Text + Lyrics': '5 Slide',
        'Single Image': '1 Slide',
        'Hook + Lyrics': '2 Slide',
        Carousel: '3 Slide',
      };
      if (OLD_NAME_MAP[niche.name]) {
        niche.name = OLD_NAME_MAP[niche.name];
        labelsDirty = true;
      }
    });
    if (labelsDirty) {
      const cols3 = getUserCollections(artistId);
      allNiches.forEach((n) => {
        const nIdx = cols3.findIndex((c) => c.id === n.id);
        if (nIdx !== -1) cols3[nIdx] = n;
      });
      saveCollections(artistId, cols3);
      if (db)
        Promise.all(allNiches.map((n) => saveCollectionToFirestore(db, artistId, n))).catch(
          log.error,
        );
      log('[libraryService] Patched niche format labels to match current templates');
    }
  }

  const flagKey = `stm_drafts_migrated_${artistId}`;
  if (localStorage.getItem(flagKey)) return;

  const content = getCreatedContent(artistId);
  const unassigned = (content.slideshows || []).filter((s) => !s.isTemplate && !s.collectionId);
  if (unassigned.length === 0) {
    localStorage.setItem(flagKey, Date.now().toString());
    return;
  }

  // Map slide counts to format template IDs
  const SLIDE_FORMAT_MAP = { 1: 'single', 2: 'hook_lyrics', 3: 'carousel', 5: 'hook_vibes_lyrics' };
  const groups = {};
  unassigned.forEach((s) => {
    const count = (s.slides || []).length;
    const formatId = SLIDE_FORMAT_MAP[count];
    if (formatId) {
      if (!groups[formatId]) groups[formatId] = [];
      groups[formatId].push(s);
    }
  });

  if (Object.keys(groups).length === 0) {
    localStorage.setItem(flagKey, Date.now().toString());
    return;
  }

  // Ensure a project exists, with all library media in its pool
  // Skip auto-creation if user has explicitly deleted all projects
  const deletedKey = `stm_projects_deleted_${artistId}`;
  let project = existingProject;
  const library = getLibrary(artistId);
  if (!project && !localStorage.getItem(deletedKey)) {
    project = createProject(artistId, { name: 'Content', color: PIPELINE_COLORS[0] });
    if (library.length > 0) {
      project.mediaIds = library.map((item) => item.id);
      const cols = getUserCollections(artistId);
      const idx = cols.findIndex((c) => c.id === project.id);
      if (idx !== -1) cols[idx] = project;
      saveCollections(artistId, cols);
    }
    if (db) await saveCollectionToFirestore(db, artistId, project);
  }

  // For each format group, ensure a niche exists and assign drafts
  for (const [formatId, drafts] of Object.entries(groups)) {
    const format = FORMAT_TEMPLATES.find((f) => f.id === formatId);
    if (!format) continue;

    // Check if niche already exists for this format under this project
    const collections = getUserCollections(artistId);
    let niche = collections.find(
      (c) => c.projectId === project.id && c.isPipeline && c.formats?.[0]?.id === formatId,
    );

    if (!niche) {
      niche = createNiche(artistId, { projectId: project.id, format });
      if (db) await saveCollectionToFirestore(db, artistId, niche);
    }

    // Assign drafts + extract image IDs into niche mediaIds + banks
    const nicheImageIds = new Set(niche.mediaIds || []);
    if (!niche.banks) niche.banks = [];
    const bankSets = niche.banks.map((b) => new Set(b || []));
    drafts.forEach((draft) => {
      draft.collectionId = niche.id;
      draft.updatedAt = new Date().toISOString();
      (draft.slides || []).forEach((slide, slideIdx) => {
        const imgId = slide.sourceImageId || slide.imageId;
        if (!imgId) return;
        nicheImageIds.add(imgId);
        while (bankSets.length <= slideIdx) bankSets.push(new Set());
        bankSets[slideIdx].add(imgId);
      });
    });
    niche.banks = bankSets.map((s) => Array.from(s));
    if (nicheImageIds.size > (niche.mediaIds || []).length) {
      niche.mediaIds = Array.from(nicheImageIds);
      const cols2 = getUserCollections(artistId);
      const nIdx = cols2.findIndex((c) => c.id === niche.id);
      if (nIdx !== -1) cols2[nIdx] = niche;
      saveCollections(artistId, cols2);
      if (db) await saveCollectionToFirestore(db, artistId, niche);
    }

    log('[libraryService] Assigned', drafts.length, formatId, 'drafts to niche', niche.id);
  }

  // Save content to localStorage + Firestore
  saveCreatedContent(artistId, content);
  localStorage.setItem(flagKey, Date.now().toString());
  log('[libraryService] Migrated', unassigned.length, 'drafts to niches for artist', artistId);

  if (db) {
    try {
      await saveCreatedContentAsync(db, artistId, content);
    } catch (err) {
      log.error('[libraryService] Firestore draft migration save failed:', err);
    }
  }
};

/**
 * Get media items in a collection (resolves smart collections)
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {Object[]} Media items
 */
export const getCollectionMedia = (artistId, collectionId) => {
  const library = getLibrary(artistId);

  // Handle smart collections
  if (collectionId.startsWith('smart_')) {
    return resolveSmartCollection(library, collectionId);
  }

  // Handle user collections
  const collections = getUserCollections(artistId);
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return [];

  return library.filter((item) => collection.mediaIds.includes(item.id));
};

/**
 * Resolve smart collection criteria to media items
 * @param {Object[]} library
 * @param {string} smartCollectionId
 * @returns {Object[]} Matching items
 */
const resolveSmartCollection = (library, smartCollectionId) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  switch (smartCollectionId) {
    case SMART_COLLECTION_IDS.RECENT:
      return library
        .filter((item) => new Date(item.createdAt) >= thirtyDaysAgo)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    case SMART_COLLECTION_IDS.FAVORITES:
      return library.filter((item) => item.isFavorite);

    case SMART_COLLECTION_IDS.VERTICAL:
      return library.filter(
        (item) =>
          (item.type === MEDIA_TYPES.VIDEO || item.type === MEDIA_TYPES.IMAGE) &&
          item.aspectRatio &&
          item.aspectRatio < 1,
      );

    case SMART_COLLECTION_IDS.HAS_AUDIO:
      return library.filter((item) => item.type === MEDIA_TYPES.VIDEO && item.hasEmbeddedAudio);

    case SMART_COLLECTION_IDS.MOST_USED:
      return library.filter((item) => item.useCount >= 2).sort((a, b) => b.useCount - a.useCount);

    case SMART_COLLECTION_IDS.UNUSED:
      return library.filter((item) => !item.useCount || item.useCount === 0);

    case SMART_COLLECTION_IDS.AUDIO_ALL:
      return library.filter((item) => item.type === MEDIA_TYPES.AUDIO);

    default:
      return [];
  }
};

// ============================================================================
// ONBOARDING OPERATIONS
// ============================================================================

/**
 * Get onboarding status
 * @param {string} artistId
 * @returns {Object} Onboarding state
 */
export const getOnboardingStatus = (artistId) => {
  try {
    const data = localStorage.getItem(getOnboardingKey(artistId));
    return data ? JSON.parse(data) : { completed: false, templateId: null };
  } catch (error) {
    log.error('Error loading onboarding status:', error);
    return { completed: false, templateId: null };
  }
};

/**
 * Complete onboarding with a template
 * @param {string} artistId
 * @param {string} templateId
 */
export const completeOnboarding = (artistId, templateId, db = null) => {
  const template =
    STARTER_TEMPLATES[
      Object.keys(STARTER_TEMPLATES).find((key) => STARTER_TEMPLATES[key].id === templateId)
    ];

  if (template && template.collections.length > 0) {
    // Create collections from template
    const collections = getUserCollections(artistId);
    const newCols = [];
    template.collections.forEach((col) => {
      const newCol = createCollection({
        name: col.name,
        description: col.description,
        type: COLLECTION_TYPES.TEMPLATE,
      });
      collections.push(newCol);
      newCols.push(newCol);
    });
    saveCollections(artistId, collections);
    if (db) newCols.forEach((col) => saveCollectionToFirestore(db, artistId, col).catch(log.error));
  }

  // Mark onboarding complete
  localStorage.setItem(
    getOnboardingKey(artistId),
    JSON.stringify({
      completed: true,
      templateId,
      completedAt: new Date().toISOString(),
    }),
  );
};

// ============================================================================
// SEARCH & FILTER
// ============================================================================

/**
 * Search library items
 * @param {string} artistId
 * @param {string} query
 * @param {Object} filters
 * @returns {Object[]} Matching items
 */
export const searchLibrary = (artistId, query, filters = {}) => {
  let results = getLibrary(artistId);

  // Text search
  if (query) {
    const lowerQuery = query.toLowerCase();
    results = results.filter(
      (item) =>
        item.name.toLowerCase().includes(lowerQuery) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery)),
    );
  }

  // Type filter
  if (filters.type) {
    results = results.filter((item) => item.type === filters.type);
  }

  // Collection filter
  if (filters.collectionId) {
    if (filters.collectionId.startsWith('smart_')) {
      results = resolveSmartCollection(results, filters.collectionId);
    } else {
      results = results.filter((item) => item.collectionIds?.includes(filters.collectionId));
    }
  }

  // Favorites filter
  if (filters.favoritesOnly) {
    results = results.filter((item) => item.isFavorite);
  }

  // Sort
  if (filters.sortBy) {
    switch (filters.sortBy) {
      case 'newest':
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'oldest':
        results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'name':
        results.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'mostUsed':
        results.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        break;
      default:
        break;
    }
  }

  return results;
};

// ============================================================================
// FIRESTORE OPERATIONS (Cross-device sync)
// ============================================================================

/**
 * Get library from Firestore with localStorage fallback
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @returns {Promise<Object[]>} Array of media items
 */
export const getLibraryAsync = async (db, artistId) => {
  if (db && artistId) {
    try {
      const mediaRef = collection(db, 'artists', artistId, 'library', 'data', 'mediaItems');
      const snapshot = await getDocs(query(mediaRef, orderBy('createdAt', 'desc'), limit(500)));
      if (!snapshot.empty) {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        log('[Library] Loaded from Firestore:', items.length, 'items');
        return items;
      }
    } catch (error) {
      log.warn('[Library] Firestore read failed, using localStorage:', error.message);
    }
  }
  // Fallback to localStorage
  return getLibrary(artistId);
};

/**
 * Subscribe to library changes in real-time
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Function} callback - Called with updated library array
 * @returns {Function} Unsubscribe function
 */
export const subscribeToLibrary = (db, artistId, callback) => {
  if (!db || !artistId) {
    log.warn('[Library] Cannot subscribe: missing db or artistId');
    // Return localStorage data immediately and a no-op unsubscribe
    callback(getLibrary(artistId));
    return () => {};
  }

  const mediaRef = collection(db, 'artists', artistId, 'library', 'data', 'mediaItems');

  // Retry-with-backoff wrapper around onSnapshot. The Firestore SDK auto-
  // reconnects on transient network errors but the error callback fires for
  // permanent errors (permission denied, invalid query, etc.) and after that
  // the listener is dead. Without retry the UI silently freezes on the last
  // localStorage cache forever. We retry a bounded number of times with
  // exponential backoff so transient permission/auth races recover, but
  // permanently broken queries eventually give up.
  let cancelled = false;
  let currentUnsub = () => {};
  let retryCount = 0;
  let retryTimer = null;
  const MAX_RETRIES = 5;

  const start = () => {
    if (cancelled) return;
    currentUnsub = onSnapshot(
      mediaRef,
      (snapshot) => {
        retryCount = 0; // Reset backoff on any successful snapshot
        const firestoreItems = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        if (firestoreItems.length > 0) {
          // Firestore is the single source of truth
          log('[Library] Firestore:', firestoreItems.length, 'items');

          // Always update in-memory cache (survives localStorage quota exceeded)
          _firestoreLibraryCache.set(artistId, firestoreItems);

          // Cache to localStorage for offline/instant loads
          try {
            saveLibrary(artistId, firestoreItems);
          } catch (_) {
            /* best-effort */
          }

          callback(firestoreItems);
        } else {
          // Firestore empty — check localStorage and upload if data exists
          const localItems = getLibrary(artistId);
          if (localItems.length > 0) {
            log('[Library] Uploading', localItems.length, 'local items to Firestore');
            localItems.forEach((item) => {
              const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', item.id);
              setDoc(docRef, { ...item, updatedAt: serverTimestamp() }).catch(log.error);
            });
          }
          callback(localItems);
        }
      },
      (error) => {
        log.error('[Library] Subscription error:', error);
        // Fallback to localStorage on error
        callback(getLibrary(artistId));
        // Tear down the dead listener and schedule a backoff retry
        try {
          currentUnsub();
        } catch (e) {
          console.warn('Silent catch:', e.message || e);
        }
        if (cancelled || retryCount >= MAX_RETRIES) {
          if (!cancelled) {
            log.error(
              `[Library] Subscription gave up after ${MAX_RETRIES} retries — UI will not receive further updates until reload`,
            );
          }
          return;
        }
        const delay = Math.min(30000, 2000 * 2 ** retryCount);
        retryCount += 1;
        log.warn(
          `[Library] Retrying subscription in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`,
        );
        retryTimer = setTimeout(start, delay);
      },
    );
  };

  start();
  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    try {
      currentUnsub();
    } catch (e) {
      console.warn('Silent catch:', e.message || e);
    }
  };
};

/**
 * Add item to library (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Object} mediaItem
 * @returns {Promise<Object>} Added item
 */
// Strip top-level undefined values — Firestore throws "Unsupported field
// value: undefined" otherwise. Local-first items typically have several
// undefined fields (no url, no storagePath, etc.) that need to become null.
function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export const addToLibraryAsync = async (db, artistId, mediaItem) => {
  const newItem = mediaItem.id ? mediaItem : createMediaItem(mediaItem);

  // BUG-027: Validate duration for audio — reject items with missing/zero duration
  if (newItem.type === MEDIA_TYPES.AUDIO && (!newItem.duration || newItem.duration <= 0)) {
    log.error('[Library] Audio item rejected — invalid duration:', newItem.duration);
    throw new Error('Audio must have a valid duration before saving to library');
  }

  // Always save to localStorage first (immediate)
  const localResult = addToLibrary(artistId, newItem);

  // Then save to Firestore (async)
  if (db && artistId) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', newItem.id);
      await setDoc(
        docRef,
        stripUndefined({
          ...newItem,
          updatedAt: serverTimestamp(),
        }),
      );
      log('[Library] Saved to Firestore:', newItem.id);
      localResult.syncedToCloud = true;
    } catch (error) {
      log.error('[Library] Firestore write failed:', error.message);
      localResult.syncedToCloud = false;
    }
  }

  return localResult;
};

/**
 * Add multiple items to library (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Object[]} mediaItems
 * @returns {Promise<Object[]>} Added items
 */
export const addManyToLibraryAsync = async (db, artistId, mediaItems) => {
  const newItems = mediaItems.map((item) => (item.id ? item : createMediaItem(item)));

  // Always save to localStorage first
  const localResult = addManyToLibrary(artistId, newItems);

  // Then batch save to Firestore (split into chunks of 500 to avoid batch size limit)
  if (db && artistId && newItems.length > 0) {
    try {
      for (let i = 0; i < newItems.length; i += 500) {
        const chunk = newItems.slice(i, i + 500);
        const batch = writeBatch(db);

        chunk.forEach((item) => {
          const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', item.id);
          batch.set(
            docRef,
            stripUndefined({
              ...item,
              updatedAt: serverTimestamp(),
            }),
          );
        });

        await batch.commit();
        log('[Library] Batch saved chunk to Firestore:', chunk.length, 'items');
      }
      log('[Library] All items saved to Firestore:', newItems.length, 'total items');
      localResult.syncedToCloud = true;
    } catch (error) {
      log.error('[Library] Firestore batch write failed:', error.message);
      localResult.syncedToCloud = false;
    }
  }

  return localResult;
};

/**
 * Update library item (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} mediaId
 * @param {Object} updates
 * @returns {Promise<Object|null>} Updated item
 */
export const updateLibraryItemAsync = async (db, artistId, mediaId, updates) => {
  // Update localStorage first
  const localResult = updateLibraryItem(artistId, mediaId, updates);

  // Then update Firestore. Use setDoc with merge so local-only items
  // (which never had a Firestore doc) can be updated/created in one call.
  // updateDoc would throw "No document to update" and silently lose the write.
  if (db && artistId && localResult) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', mediaId);
      await setDoc(
        docRef,
        stripUndefined({
          ...localResult, // full item so a fresh doc is well-formed
          ...updates,
          updatedAt: serverTimestamp(),
        }),
        { merge: true },
      );
      log('[Library] Updated in Firestore:', mediaId);
    } catch (error) {
      log.error('[Library] Firestore update failed:', error.message);
    }
  }

  return localResult;
};

/**
 * Scan an artist's library for orphan local items and mark them as offline.
 *
 * The local-first architecture stores file references in Firestore that point
 * at localhost:4321/local-media/... URLs. Those URLs only resolve on the
 * device that originally generated the file. When that device is removed
 * (e.g. Mac Mini returned to Apple), the Firestore metadata becomes orphan
 * broken-link state on every other device. This sweep:
 *
 *   1. Iterates the artist's library
 *   2. For each item with `syncStatus === 'local'` AND a `localUrl` pointing at
 *      `localhost:4321/local-media/`, fires a HEAD request
 *   3. On 404 (or any non-2xx), flips the item to `syncStatus: 'offline'` in
 *      Firestore so the existing `MediaStatusBadge` shows the amber warning,
 *      and so the item no longer counts as "available" anywhere
 *   4. Returns a summary `{ scanned, offline, alreadyMarked, errors }`
 *
 * Designed to be invoked manually from DevTools console:
 *   const { sweepOrphanLocalItems } = await import('./services/libraryService');
 *   await sweepOrphanLocalItems(db, 'artist_id_here');
 *
 * Safe to re-run — already-offline items are skipped. Reversible — items are
 * NOT deleted, just relabeled. User can later bulk-delete via the existing
 * trash UI if they accept the files are gone.
 *
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - Called with `{ scanned, total, name }` per item
 * @returns {Promise<{ scanned: number, offline: number, alreadyMarked: number, errors: number }>}
 */
export const sweepOrphanLocalItems = async (db, artistId, options = {}) => {
  if (!db || !artistId) {
    log.error('[Sweep] Missing db or artistId');
    return { scanned: 0, offline: 0, alreadyMarked: 0, errors: 0 };
  }
  const { onProgress } = options;
  const items = getLibrary(artistId);
  const stats = { scanned: 0, offline: 0, alreadyMarked: 0, errors: 0 };

  log(`[Sweep] Starting orphan scan for ${artistId} — ${items.length} items in library`);

  for (const item of items) {
    stats.scanned += 1;
    if (onProgress) {
      try {
        onProgress({ scanned: stats.scanned, total: items.length, name: item.name });
      } catch (e) {
        console.warn('Silent catch:', e.message || e);
      }
    }

    // Already marked offline — skip
    if (item.syncStatus === 'offline') {
      stats.alreadyMarked += 1;
      continue;
    }

    // Only check items that claim to be local-first AND have a localhost URL
    const candidateUrl = item.localUrl || item.thumbnailUrl;
    const isLocalhost =
      typeof candidateUrl === 'string' &&
      (candidateUrl.startsWith('http://localhost') || candidateUrl.startsWith('https://localhost'));
    if (!isLocalhost) continue;

    // HEAD request — fast, no body transfer. The local Express server returns
    // 404 if the file doesn't exist on disk.
    let isOrphan = false;
    try {
      const resp = await fetch(candidateUrl, { method: 'HEAD' });
      if (!resp.ok) isOrphan = true;
    } catch (err) {
      // Network error, server down, etc. — treat as orphan to be safe.
      isOrphan = true;
    }

    if (!isOrphan) continue;

    // Flip to offline. Use the existing updateLibraryItemAsync helper which
    // already handles setDoc({merge:true}) for items that may not have a
    // Firestore doc yet (which is exactly the local-first orphan case).
    try {
      await updateLibraryItemAsync(db, artistId, item.id, {
        syncStatus: 'offline',
        offlineMarkedAt: new Date().toISOString(),
      });
      stats.offline += 1;
      if (stats.offline % 25 === 0) {
        log(`[Sweep] Progress: ${stats.offline} marked offline of ${stats.scanned} scanned`);
      }
    } catch (err) {
      log.error(`[Sweep] Failed to mark ${item.id} offline:`, err.message);
      stats.errors += 1;
    }
  }

  log(
    `[Sweep] Done — scanned ${stats.scanned}, marked ${stats.offline} offline, ${stats.alreadyMarked} already-offline, ${stats.errors} errors`,
  );
  return stats;
};

/**
 * Remove item from library (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} mediaId
 * @returns {Promise<boolean>} Success
 */
export const removeFromLibraryAsync = async (db, artistId, mediaId) => {
  // Remove from localStorage + update collections locally AND in Firestore
  const localResult = removeFromLibrary(artistId, mediaId, db);

  // Then remove the media document itself from Firestore
  if (db && artistId) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', mediaId);
      await deleteDoc(docRef);
      log('[Library] Removed from Firestore:', mediaId);
    } catch (error) {
      log.error('[Library] Firestore delete failed:', error.message);
    }
  }

  return localResult;
};

/**
 * Get collections from Firestore with localStorage fallback
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @returns {Promise<Object[]>} Collections array
 */
export const getCollectionsAsync = async (db, artistId) => {
  if (db && artistId) {
    try {
      const collectionsRef = collection(db, 'artists', artistId, 'library', 'data', 'collections');
      const snapshot = await getDocs(
        query(collectionsRef, orderBy('createdAt', 'desc'), limit(500)),
      );
      if (!snapshot.empty) {
        const collections = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .map((col) => migrateCollectionBanks(col));
        const smartCollections = createSmartCollections();
        log('[Library] Collections from Firestore:', collections.length);
        return [...smartCollections, ...collections];
      }
    } catch (error) {
      log.warn('[Library] Firestore collections read failed:', error.message);
    }
  }
  return getCollections(artistId);
};

/**
 * Subscribe to collections in real-time
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Function} callback - Called with updated collections array (including smart collections)
 * @returns {Function} Unsubscribe function
 */
export const subscribeToCollections = (db, artistId, callback) => {
  if (!db || !artistId) {
    callback(getCollections(artistId));
    return () => {};
  }

  const collectionsRef = collection(db, 'artists', artistId, 'library', 'data', 'collections');

  // Same retry-with-backoff scaffold as subscribeToLibrary — without it, a
  // permission/auth error makes the listener silently dead and the UI freezes
  // on the last localStorage cache.
  let cancelled = false;
  let currentUnsub = () => {};
  let retryCount = 0;
  let retryTimer = null;
  const MAX_RETRIES = 5;

  const start = () => {
    if (cancelled) return;
    currentUnsub = onSnapshot(
      collectionsRef,
      (snapshot) => {
        retryCount = 0; // Reset backoff on any successful snapshot
        const rawFirestoreCollections = snapshot.docs.map((doc) => {
          const data = doc.data();
          // Deserialize banks/textBanks (stored as JSON strings to avoid Firestore nested array restriction)
          if (typeof data.banks === 'string')
            try {
              data.banks = JSON.parse(data.banks);
            } catch {
              data.banks = [];
            }
          if (typeof data.textBanks === 'string')
            try {
              data.textBanks = JSON.parse(data.textBanks);
            } catch {
              data.textBanks = [];
            }
          if (typeof data.clipperSessions === 'string')
            try {
              data.clipperSessions = JSON.parse(data.clipperSessions);
            } catch {
              data.clipperSessions = [];
            }
          if (typeof data.mediaBanks === 'string')
            try {
              data.mediaBanks = JSON.parse(data.mediaBanks);
            } catch {
              data.mediaBanks = null;
            }
          return { id: doc.id, ...data };
        });

        // Deduplicate project roots by normalized name (migration may have created duplicates)
        // NOTE: Only dedup project roots by name. Niches are NOT deduped by name because
        // multiple niches can legitimately share the same name (e.g., two "Montage" niches
        // in different projects). Deduping niches by name causes data loss.
        const seenProjectNames = new Set();
        const firestoreCollections = rawFirestoreCollections.filter((col) => {
          if (col.isProjectRoot) {
            const key = (col.name || col.id).replace(/^@+/, '');
            if (seenProjectNames.has(key)) return false;
            seenProjectNames.add(key);
          }
          return true;
        });

        if (firestoreCollections.length > 0) {
          // Firestore is the single source of truth. Migrate banks and use directly.
          const collections = firestoreCollections
            .filter((c) => !pendingDeletionIds.has(c.id))
            .map((col) => migrateCollectionBanks(col));

          // Cleanup pending deletions: if a pending ID is absent from Firestore,
          // Firestore has confirmed the delete — safe to clear the flag.
          const snapshotIds = new Set(firestoreCollections.map((c) => c.id));
          for (const [pendingId] of pendingDeletionMap) {
            if (!snapshotIds.has(pendingId)) {
              clearPendingDeletion(pendingId);
            }
          }

          // Cleanup: undo bad auto-migration that assigned legacy niches to wrong projects.
          // If a niche's createdAt predates its assigned project by >1 day, clear the projectId.
          const projectRoots = collections.filter((c) => c.isProjectRoot);
          if (projectRoots.length > 0) {
            const projectMap = new Map(projectRoots.map((p) => [p.id, p]));
            for (const niche of collections.filter((c) => c.isPipeline && c.projectId)) {
              const project = projectMap.get(niche.projectId);
              if (!project) continue;
              const nicheDate = new Date(niche.createdAt || 0).getTime();
              const projDate = new Date(project.createdAt || 0).getTime();
              // Niche created >1 day before its project → was mis-assigned by auto-migration
              if (nicheDate > 0 && projDate > 0 && nicheDate < projDate - 86400000) {
                log('[Migration] Clearing mis-assigned projectId on legacy niche', niche.name);
                delete niche.projectId;
                saveCollectionToFirestore(db, artistId, niche).catch(() => {});
              }
            }
          }

          // Log for debugging
          const pipelines = collections.filter((c) => c.isPipeline);
          log(
            '[subscribeToCollections] Firestore:',
            collections.length,
            'collections,',
            pipelines.length,
            'niches →',
            pipelines
              .map(
                (c) =>
                  `${c.name}(${c.mediaIds?.length || 0}media, tb:${c.textBanks?.map((tb) => tb?.length || 0).join('/') || 'none'})`,
              )
              .join(', '),
          );

          const smartCollections = createSmartCollections();

          // Always update in-memory cache (survives localStorage quota exceeded)
          _firestoreCollectionsCache.set(artistId, collections);

          // Call the callback BEFORE caching to localStorage so that safeSetCollections
          // can compare Firestore data against the real local data (not an overwritten copy).
          callback([...smartCollections, ...collections]);

          // Cache to localStorage for offline/instant loads (AFTER callback)
          try {
            localStorage.setItem(getCollectionsKey(artistId), JSON.stringify(collections));
          } catch (e) {
            console.warn('Silent catch:', e.message || e);
          }
        } else {
          // Firestore empty — check localStorage and upload if data exists
          // Filter out tombstoned (previously deleted) collections to prevent resurrection
          const tombstones = getDeletedCollectionIds(artistId);
          const localCollections = getCollections(artistId);
          const userCollections = localCollections.filter(
            (c) => c.type !== 'smart' && !c.id?.startsWith('smart_') && !tombstones.has(c.id),
          );

          if (userCollections.length > 0) {
            // Upload local collections to Firestore (including banks)
            // Must use saveCollectionToFirestore to serialize nested arrays as JSON strings
            log(
              '[Collections] Uploading',
              userCollections.length,
              'local collections to Firestore (skipped',
              tombstones.size,
              'tombstoned)',
            );
            userCollections.forEach((col) => {
              saveCollectionToFirestore(db, artistId, col).catch(log.error);
            });
          }

          callback(localCollections);
        }
      },
      (error) => {
        log.error('[Collections] Firestore subscription error:', error);
        callback(getCollections(artistId));
        try {
          currentUnsub();
        } catch (e) {
          console.warn('Silent catch:', e.message || e);
        }
        if (cancelled || retryCount >= MAX_RETRIES) {
          if (!cancelled) {
            log.error(
              `[Collections] Subscription gave up after ${MAX_RETRIES} retries — UI will not receive further updates until reload`,
            );
          }
          return;
        }
        const delay = Math.min(30000, 2000 * 2 ** retryCount);
        retryCount += 1;
        log.warn(
          `[Collections] Retrying subscription in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`,
        );
        retryTimer = setTimeout(start, delay);
      },
    );
  };

  start();
  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    try {
      currentUnsub();
    } catch (e) {
      console.warn('Silent catch:', e.message || e);
    }
  };
};

/**
 * Save collection to Firestore
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Object} collectionData
 * @returns {Promise<void>}
 */
export const saveCollectionToFirestore = async (db, artistId, collectionData) => {
  if (!db || !artistId || !collectionData?.id) return false;
  try {
    const docRef = doc(
      db,
      'artists',
      artistId,
      'library',
      'data',
      'collections',
      collectionData.id,
    );
    // Firestore doesn't support nested arrays. Serialize banks/textBanks as JSON strings.
    const data = { ...collectionData, updatedAt: serverTimestamp() };
    if (Array.isArray(data.banks)) data.banks = JSON.stringify(data.banks);
    if (Array.isArray(data.textBanks)) data.textBanks = JSON.stringify(data.textBanks);
    if (Array.isArray(data.clipperSessions))
      data.clipperSessions = JSON.stringify(data.clipperSessions);
    if (Array.isArray(data.mediaBanks)) data.mediaBanks = JSON.stringify(data.mediaBanks);
    await setDoc(docRef, data);
    return true;
  } catch (error) {
    log.error('[Collections] Failed to save to Firestore:', error);
    return false;
  }
};

/**
 * Add media to a collection (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 * @returns {Promise<void>}
 */
export const addToCollectionAsync = async (db, artistId, collectionId, mediaIds) => {
  // Write to localStorage immediately
  addToCollection(artistId, collectionId, mediaIds);

  // Sync collection to Firestore
  let syncedToCloud = false;
  if (db && artistId) {
    const collections = getUserCollections(artistId);
    const col = collections.find((c) => c.id === collectionId);
    if (col) {
      syncedToCloud = await saveCollectionToFirestore(db, artistId, col);
    }
  }
  return { success: true, syncedToCloud };
};

/**
 * Remove media from a collection (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 * @returns {Promise<void>}
 */
export const removeFromCollectionAsync = async (db, artistId, collectionId, mediaIds) => {
  // Write to localStorage immediately
  removeFromCollection(artistId, collectionId, mediaIds);

  // Sync collection to Firestore
  let syncedToCloud = false;
  if (db && artistId) {
    const collections = getUserCollections(artistId);
    const col = collections.find((c) => c.id === collectionId);
    if (col) {
      syncedToCloud = await saveCollectionToFirestore(db, artistId, col);
    }
  }
  return { success: true, syncedToCloud };
};

/**
 * Assign media to a bank within a collection (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 * @param {number|string} bank - 0-based index or legacy letter
 * @returns {Promise<void>}
 */
export const assignToBankAsync = async (db, artistId, collectionId, mediaIds, bank) => {
  // Write to localStorage immediately
  assignToBank(artistId, collectionId, mediaIds, bank);

  // Sync collection to Firestore
  let syncedToCloud = false;
  if (db && artistId) {
    const collections = getUserCollections(artistId);
    const col = collections.find((c) => c.id === collectionId);
    if (col) {
      syncedToCloud = await saveCollectionToFirestore(db, artistId, col);
    }
  }
  return { success: true, syncedToCloud };
};

/**
 * Update a collection (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} collectionId
 * @param {Object} updates
 * @returns {Promise<Object|null>} Updated collection
 */
export const updateCollectionAsync = async (db, artistId, collectionId, updates) => {
  // Write to localStorage immediately
  const result = updateCollection(artistId, collectionId, updates);

  // Sync to Firestore
  let syncedToCloud = false;
  if (db && artistId && result) {
    syncedToCloud = await saveCollectionToFirestore(db, artistId, result);
  }

  return { success: !!result, data: result, syncedToCloud };
};

/**
 * Delete a collection (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {Promise<boolean>} Success
 */
export const deleteCollectionAsync = async (db, artistId, collectionId) => {
  // Write tombstone FIRST so the resurrection path can never re-upload this
  markCollectionDeleted(artistId, collectionId);

  // Delete from localStorage (may be a no-op if collection isn't cached locally —
  // e.g. when the project was loaded purely via Firestore subscription)
  const localResult = deleteCollection(artistId, collectionId);

  // ALWAYS delete from Firestore — don't gate on local result, otherwise projects
  // that only exist in the Firestore subscription cache (never written to
  // localStorage) cannot be deleted at all.
  //
  // Returns granular result so callers can distinguish:
  //   - localOk: localStorage delete succeeded (or collection wasn't cached)
  //   - cloudOk: Firestore delete confirmed (true), failed (false), or N/A (null when no db)
  //   - success: at least one path succeeded
  // Callers should error-toast when cloudOk === false because that means the
  // delete didn't actually persist and the doc will reappear on next sync.
  let cloudOk = null;
  if (db && artistId) {
    cloudOk = await deleteCollectionFromFirestore(db, artistId, collectionId);
  }

  const success = localResult || cloudOk === true;
  return { success, localOk: !!localResult, cloudOk, syncedToCloud: cloudOk === true };
};

/**
 * Delete collection from Firestore
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {Promise<void>}
 */
export const deleteCollectionFromFirestore = async (db, artistId, collectionId) => {
  if (!db || !artistId || !collectionId) return false;
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', collectionId);
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    log.error('[Collections] Failed to delete from Firestore:', error);
    return false;
  }
};

/**
 * Create collection (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Object} collectionData
 * @returns {Promise<Object>} Created collection
 */
export const createNewCollectionAsync = async (db, artistId, collectionData) => {
  // Create in localStorage first
  const localResult = createNewCollection(artistId, collectionData);

  // Then save to Firestore
  if (db && artistId && localResult) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', localResult.id);
      await setDoc(docRef, {
        ...localResult,
        updatedAt: serverTimestamp(),
      });
      log('[Library] Collection saved to Firestore:', localResult.id);
    } catch (error) {
      log.error('[Library] Firestore collection write failed:', error.message);
    }
  }

  return localResult;
};

/**
 * Migrate localStorage data to Firestore (one-time)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @returns {Promise<Object>} Migration result
 */
export const migrateToFirestore = async (db, artistId) => {
  if (!db || !artistId) {
    return { success: false, error: 'Missing db or artistId' };
  }

  // Idempotency guard — prevent the migration from running twice on the
  // same artist (would overwrite Firestore data with stale localStorage).
  // Both an in-flight lock AND a "completed" marker are checked.
  const lockKey = `stm_migration_lock_${artistId}`;
  const doneKey = `stm_migration_done_${artistId}`;
  if (typeof localStorage !== 'undefined') {
    if (localStorage.getItem(doneKey)) {
      return { success: true, migrated: {}, alreadyMigrated: true };
    }
    const lockedAt = parseInt(localStorage.getItem(lockKey) || '0', 10);
    if (lockedAt && Date.now() - lockedAt < 5 * 60 * 1000) {
      return { success: false, error: 'Migration already in progress' };
    }
    try {
      localStorage.setItem(lockKey, String(Date.now()));
    } catch {
      /* quota issues — proceed without lock */
    }
  }

  const result = {
    success: true,
    migrated: {
      mediaItems: 0,
      collections: 0,
      createdContent: 0,
      lyrics: 0,
      onboarding: false,
    },
    errors: [],
  };

  try {
    // Migrate media items
    const library = getLibrary(artistId);
    if (library.length > 0) {
      const batch = writeBatch(db);
      library.forEach((item) => {
        const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', item.id);
        batch.set(docRef, item);
      });
      await batch.commit();
      result.migrated.mediaItems = library.length;
      log('[Migration] Migrated media items:', library.length);
    }

    // Migrate collections
    const collections = getUserCollections(artistId);
    if (collections.length > 0) {
      const batch = writeBatch(db);
      collections.forEach((col) => {
        const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', col.id);
        batch.set(docRef, col);
      });
      await batch.commit();
      result.migrated.collections = collections.length;
      log('[Migration] Migrated collections:', collections.length);
    }

    // Migrate onboarding status
    const onboarding = getOnboardingStatus(artistId);
    if (onboarding.completed) {
      const docRef = doc(db, 'artists', artistId, 'library', 'onboarding');
      await setDoc(docRef, onboarding);
      result.migrated.onboarding = true;
      log('[Migration] Migrated onboarding status');
    }

    // Migrate created content
    const createdContent = getCreatedContent(artistId);
    if (createdContent.videos.length > 0 || createdContent.slideshows.length > 0) {
      const batch = writeBatch(db);
      createdContent.videos.forEach((video) => {
        const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', video.id);
        batch.set(docRef, video);
      });
      createdContent.slideshows.forEach((slideshow) => {
        const docRef = doc(
          db,
          'artists',
          artistId,
          'library',
          'data',
          'createdContent',
          slideshow.id,
        );
        batch.set(docRef, slideshow);
      });
      await batch.commit();
      result.migrated.createdContent =
        createdContent.videos.length + createdContent.slideshows.length;
      log('[Migration] Migrated created content:', result.migrated.createdContent);
    }

    // Migrate lyrics
    const lyrics = getLyrics(artistId);
    if (lyrics.length > 0) {
      const batch = writeBatch(db);
      lyrics.forEach((lyric) => {
        const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyric.id);
        batch.set(docRef, lyric);
      });
      await batch.commit();
      result.migrated.lyrics = lyrics.length;
      log('[Migration] Migrated lyrics:', lyrics.length);
    }

    log('[Migration] Complete for artist:', artistId, result.migrated);
  } catch (error) {
    log.error('[Migration] Failed:', error);
    result.success = false;
    result.errors.push(error.message);
  }

  // Release the lock and mark complete (only on success — let failures retry)
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(lockKey);
      if (result.success) localStorage.setItem(doneKey, String(Date.now()));
    } catch {
      /* quota issues — non-fatal */
    }
  }

  return result;
};

// EXPORT
// ============================================================================

export default {
  // Constants
  MEDIA_TYPES,
  COLLECTION_TYPES,
  SMART_COLLECTION_IDS,
  STARTER_TEMPLATES,

  // Creators
  createMediaItem,
  createCollection,
  createSmartCollections,

  // Library (localStorage)
  getLibrary,
  saveLibrary,
  addToLibrary,
  addManyToLibrary,
  updateLibraryItem,
  removeFromLibrary,
  getLibraryByType,
  toggleFavorite,
  incrementUseCount,

  // Library (Firestore async)
  getLibraryAsync,
  subscribeToLibrary,
  addToLibraryAsync,
  addManyToLibraryAsync,
  updateLibraryItemAsync,
  removeFromLibraryAsync,
  sweepOrphanLocalItems,

  // Collections (localStorage)
  getCollections,
  getUserCollections,
  saveCollections,
  createNewCollection,
  updateCollection,
  deleteCollection,
  addToCollection,
  removeFromCollection,
  getCollectionMedia,
  addToTextBank,
  removeFromTextBank,
  updateTextBankEntry,
  updateTextBank,
  saveTextTemplates,
  getCollectionCaptionBank,
  getCollectionHashtagBank,
  updateCollectionCaptionBank,
  updateCollectionHashtagBank,
  getEffectiveHashtags,
  resolveCollectionBanks,
  updateCollectionPlatformHashtags,
  updateCollectionPlatformExcludes,

  // Named Media Banks (video niches)
  MAX_MEDIA_BANKS,
  migrateToMediaBanks,
  addMediaBank,
  removeMediaBank,
  renameMediaBank,
  assignToMediaBank,
  removeFromMediaBank,
  moveMediaBetweenBanks,

  // Niche / Format System
  FORMAT_TEMPLATES,
  PIPELINE_COLORS,
  createPipeline,
  getPipelineBankLabel,

  // Collections (Firestore async)
  getCollectionsAsync,
  subscribeToCollections,
  saveCollectionToFirestore,
  deleteCollectionFromFirestore,
  createNewCollectionAsync,

  // Onboarding (localStorage)
  getOnboardingStatus,
  completeOnboarding,

  // Search
  searchLibrary,

  // Migration
  migrateToFirestore,
};
