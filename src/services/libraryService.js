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
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import log from '../utils/logger';

// ============================================================================
// PENDING DELETION TRACKING (prevents subscription race conditions)
// ============================================================================
const pendingDeletionIds = new Set();
export const markCollectionPendingDeletion = (id) => pendingDeletionIds.add(id);
export const clearPendingDeletion = (id) => pendingDeletionIds.delete(id);
export const isCollectionPendingDeletion = (id) => pendingDeletionIds.has(id);

// ============================================================================
// RECENT COLLECTION WRITES (protects against subscription overwriting fresh data)
// The subscription handler reads Firestore + localStorage, but the Firestore data
// may be stale. If addToCollection/assignToBank wrote to localStorage between
// Firestore sync and subscription fire, the subscription may overwrite the fresh
// localStorage with stale merged data. This map tracks recent writes so guards
// can always recover the data.
// ============================================================================
const recentCollectionSnapshots = new Map(); // collectionId -> { mediaIds, banks, ts }
export const getRecentCollectionSnapshots = () => recentCollectionSnapshots;
const trackCollectionWrite = (collectionId, collection) => {
  const ts = Date.now();
  recentCollectionSnapshots.set(collectionId, {
    mediaIds: [...(collection.mediaIds || [])],
    banks: (collection.banks || []).map(b => [...(b || [])]),
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
  AUDIO: 'audio'
};

export const COLLECTION_TYPES = {
  USER: 'user',
  SMART: 'smart',
  TEMPLATE: 'template'
};

export const SMART_COLLECTION_IDS = {
  RECENT: 'smart_recent',
  FAVORITES: 'smart_favorites',
  HAS_AUDIO: 'smart_has_audio',
  MOST_USED: 'smart_most_used',
  UNUSED: 'smart_unused',
  AUDIO_ALL: 'smart_audio_all'
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
      { name: 'Music Videos', description: 'Official music video clips and teasers' }
    ]
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
      { name: 'Runway & Events', description: 'Fashion shows, events, parties' }
    ]
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
      { name: 'Food & Cooking', description: 'Recipes, restaurants, food content' }
    ]
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
      { name: 'Educational', description: 'Tips, tutorials, how-tos' }
    ]
  },
  CUSTOM: {
    id: 'template_custom',
    name: 'Start Fresh',
    description: 'Create your own organization system',
    icon: '🎨',
    collections: []
  }
};

// ============================================================================
// STORAGE KEYS
// ============================================================================

const getLibraryKey = (artistId) => `stm_library_${artistId}`;
const getCollectionsKey = (artistId) => `stm_collections_${artistId}`;
const getCreatedContentKey = (artistId) => `stm_created_content_${artistId}`;
const getLyricsKey = (artistId) => `stm_lyrics_${artistId}`;
const getOnboardingKey = (artistId) => `stm_onboarding_${artistId}`;
const getUsageStatsKey = (artistId) => `stm_usage_stats_${artistId}`;

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
  url,
  thumbnailUrl = null,
  storagePath = null,
  duration = null,
  width = null,
  height = null,
  hasEmbeddedAudio = false,
  thumbnail = null,
  metadata = {}
}) => {
  const now = new Date().toISOString();
  return {
    id: `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type, // video | image | audio
    name,
    url, // Firebase Storage URL (permanent, full-res)
    thumbnailUrl, // Firebase Storage URL (small ~300px version for grids)
    localUrl: url, // Alias for components that expect localUrl
    storagePath, // Path in Firebase Storage
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
    collectionIds: [], // Which collections this belongs to
    tags: [], // User-defined tags
    isFavorite: false,

    // Usage tracking
    useCount: 0,
    lastUsedAt: null,

    // Metadata
    metadata: {
      ...metadata,
      originalName: name,
      fileSize: metadata.fileSize || null,
      mimeType: metadata.mimeType || null
    },

    // Timestamps
    createdAt: now,
    updatedAt: now
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
  color = null
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
    updatedAt: now
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
      createdAt: now
    },
    {
      id: SMART_COLLECTION_IDS.FAVORITES,
      name: 'Favorites',
      description: 'Your starred items',
      type: COLLECTION_TYPES.SMART,
      icon: '⭐',
      smartCriteria: { type: 'favorites' },
      createdAt: now
    },
    {
      id: SMART_COLLECTION_IDS.HAS_AUDIO,
      name: 'Has Audio',
      description: 'Video clips with embedded audio',
      type: COLLECTION_TYPES.SMART,
      icon: '🔊',
      smartCriteria: { type: 'hasAudio' },
      createdAt: now
    },
    {
      id: SMART_COLLECTION_IDS.MOST_USED,
      name: 'Most Used',
      description: 'Your go-to content',
      type: COLLECTION_TYPES.SMART,
      icon: '🔥',
      smartCriteria: { type: 'mostUsed', minUses: 2 },
      createdAt: now
    },
    {
      id: SMART_COLLECTION_IDS.UNUSED,
      name: 'Unused',
      description: 'Content you haven\'t used yet',
      type: COLLECTION_TYPES.SMART,
      icon: '💤',
      smartCriteria: { type: 'unused' },
      createdAt: now
    },
    {
      id: SMART_COLLECTION_IDS.AUDIO_ALL,
      name: 'All Audio',
      description: 'All audio clips in your library',
      type: COLLECTION_TYPES.SMART,
      icon: '🎵',
      smartCriteria: { type: 'audio' },
      createdAt: now
    }
  ];
};

// ============================================================================
// CREATED CONTENT SCHEMA (Videos & Slideshows)
// ============================================================================

/**
 * Creates a new created video record
 * @param {Object} params - Video parameters
 * @returns {Object} Created video
 */
export const createCreatedVideo = ({
  name,
  audio,
  clips = [],
  words = [],
  lyrics = '',
  textStyle = {},
  cropMode = 'cover',
  duration = 0,
  bpm = null,
  collectionId = null
}) => {
  const now = new Date().toISOString();
  return {
    id: `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'video',
    name,

    // Content
    audio, // { id, url, duration, startTime, endTime }
    clips, // Array of clip objects with timing
    words, // Array of word objects with timing (LOCAL TIME)
    lyrics, // Raw lyrics text

    // Style
    textStyle,
    cropMode,

    // Metadata
    duration,
    bpm,
    collectionId, // Which collection this was created from

    // Export status
    status: 'draft', // draft | rendering | ready | posted
    cloudUrl: null, // Firebase URL of rendered video
    thumbnailUrl: null,

    // Posting info
    postedTo: [], // Array of { platform, accountId, postId, postedAt }

    // Scheduling link
    scheduledPostId: null, // ID of linked scheduled post (null = unscheduled)

    // Timestamps
    createdAt: now,
    updatedAt: now
  };
};

/**
 * Creates a new slideshow record
 * @param {Object} params - Slideshow parameters
 * @returns {Object} Created slideshow
 */
export const createCreatedSlideshow = ({
  name,
  slides = [],
  audio = null,
  cropMode = '9:16',
  collectionId = null
}) => {
  // Validation
  if (!slides || slides.length === 0) {
    throw new Error('Slideshow must have at least one slide');
  }
  if (slides.some(s => !s.backgroundImage)) {
    log.warn('[Library] Some slides missing background images');
  }

  const now = new Date().toISOString();
  return {
    id: `slideshow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'slideshow',
    name,

    // Content
    slides, // Array of { imageId, imageUrl, text, textStyle }
    audio, // Optional background audio

    // Style
    cropMode, // 9:16 | 4:3

    // Metadata
    duration: slides.length * 3, // Rough estimate
    collectionId,

    // Export status
    status: 'draft',
    exportedImages: [], // Array of exported image URLs

    // Posting info
    postedTo: [],

    // Scheduling link
    scheduledPostId: null, // ID of linked scheduled post (null = unscheduled)

    // Timestamps
    createdAt: now,
    updatedAt: now
  };
};

// ============================================================================
// LYRICS BANK SCHEMA
// ============================================================================

/**
 * Creates a new lyrics entry
 * @param {Object} params - Lyrics parameters
 * @returns {Object} Lyrics entry
 */
export const createLyricsEntry = ({
  title,
  content,
  words = [],
  audioId = null,
  audioStartTime = null,
  audioEndTime = null,
  collectionIds = []
}) => {
  const now = new Date().toISOString();
  return {
    id: `lyrics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    title,
    content, // Raw lyrics text
    words, // Timed words array (LOCAL TIME)
    collectionIds, // Which collections this lyric belongs to

    // Associated audio (optional)
    audioId,
    audioStartTime, // Trim start when these words were synced
    audioEndTime, // Trim end when these words were synced

    // Timestamps
    createdAt: now,
    updatedAt: now
  };
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
    return data ? JSON.parse(data) : [];
  } catch (error) {
    log.error('Error loading library:', error);
    return [];
  }
};

/**
 * Save the full library for an artist
 * @param {string} artistId
 * @param {Object[]} library
 */
export const saveLibrary = (artistId, library) => {
  try {
    // Clean before saving - remove blob URLs and base64 thumbnails
    const cleanedLibrary = library.map(item => ({
      ...item,
      thumbnail: null, // Never persist thumbnails
      url: item.url?.startsWith('blob:') ? null : item.url // Remove blob URLs
    })).filter(item => item.url); // Only keep items with valid URLs

    localStorage.setItem(getLibraryKey(artistId), JSON.stringify(cleanedLibrary));
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      log.warn('[Library] localStorage quota exceeded, attempting cleanup...');
      try {
        // Remove old session/temp data to free space
        const keysToClean = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith('stm_session_') || key?.startsWith('stm_temp_') || key?.startsWith('stm_draft_')) {
            keysToClean.push(key);
          }
        }
        keysToClean.forEach(k => localStorage.removeItem(k));
        log('[Library] Cleaned', keysToClean.length, 'temp keys, retrying save...');
        // Retry save after cleanup
        const cleanedLibrary = library.map(item => ({
          ...item, thumbnail: null,
          url: item.url?.startsWith('blob:') ? null : item.url
        })).filter(item => item.url);
        localStorage.setItem(getLibraryKey(artistId), JSON.stringify(cleanedLibrary));
      } catch (retryError) {
        log.error('[Library] Save failed even after cleanup. Storage is full:', retryError.message);
      }
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
  const newItems = mediaItems.map(item => item.id ? item : createMediaItem(item));
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
  const index = library.findIndex(item => item.id === mediaId);
  if (index === -1) return null;

  library[index] = {
    ...library[index],
    ...updates,
    updatedAt: new Date().toISOString()
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
  const filtered = library.filter(item => item.id !== mediaId);
  if (filtered.length === library.length) return false;

  saveLibrary(artistId, filtered);

  // Also remove from all collections
  const collections = getCollections(artistId);
  const changedCollections = [];
  collections.forEach(collection => {
    if (collection.mediaIds?.includes(mediaId)) {
      collection.mediaIds = collection.mediaIds.filter(id => id !== mediaId);
      changedCollections.push(collection);
    }
  });
  // Also remove from project pools
  collections.filter(c => c.isProjectRoot && c.mediaIds?.includes(mediaId)).forEach(project => {
    project.mediaIds = project.mediaIds.filter(id => id !== mediaId);
    changedCollections.push(project);
  });
  saveCollections(artistId, collections);
  if (db) {
    changedCollections.forEach(col => saveCollectionToFirestore(db, artistId, col).catch(log.error));
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
  return getLibrary(artistId).filter(item => item.type === type);
};

/**
 * Toggle favorite status
 * @param {string} artistId
 * @param {string} mediaId
 * @returns {boolean} New favorite status
 */
export const toggleFavorite = (artistId, mediaId) => {
  const library = getLibrary(artistId);
  const item = library.find(i => i.id === mediaId);
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
  const item = library.find(i => i.id === mediaId);
  if (item) {
    item.useCount = (item.useCount || 0) + 1;
    item.lastUsedAt = new Date().toISOString();
    saveLibrary(artistId, library);
  }
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
  try {
    const data = localStorage.getItem(getCollectionsKey(artistId));
    const userCollections = data ? JSON.parse(data) : [];

    // Deduplicate user collections by id (migration may have created duplicates)
    const seen = new Set();
    const dedupedCollections = userCollections.filter(col => {
      if (seen.has(col.id)) return false;
      seen.add(col.id);
      return true;
    });

    // Always include smart collections
    const smartCollections = createSmartCollections();

    return [...smartCollections, ...dedupedCollections];
  } catch (error) {
    log.error('Error loading collections:', error);
    return createSmartCollections();
  }
};

/**
 * Get only user-created collections
 * @param {string} artistId
 * @returns {Object[]} User collections
 */
export const getUserCollections = (artistId) => {
  try {
    const data = localStorage.getItem(getCollectionsKey(artistId));
    return data ? JSON.parse(data) : [];
  } catch (error) {
    log.error('Error loading user collections:', error);
    return [];
  }
};

/**
 * Save user collections (not smart collections)
 * @param {string} artistId
 * @param {Object[]} collections
 */
export const saveCollections = (artistId, collections) => {
  try {
    // Filter out smart collections before saving
    const userCollections = collections.filter(c => c.type !== COLLECTION_TYPES.SMART);

    // SAFETY GUARD: Never lose collections. If existing localStorage has collections
    // that are missing from the new data (and aren't pending deletion), preserve them.
    const existing = getUserCollections(artistId);
    if (existing.length > 0) {
      const newIds = new Set(userCollections.map(c => c.id));
      const lost = existing.filter(e => !newIds.has(e.id) && !pendingDeletionIds.has(e.id));
      if (lost.length > 0) {
        log.warn('[saveCollections] Would lose', lost.length, 'collections, preserving:',
          lost.map(c => `${c.name}(${c.id})`));
        userCollections.push(...lost);
      }
    }

    localStorage.setItem(getCollectionsKey(artistId), JSON.stringify(userCollections));
  } catch (error) {
    log.error('Error saving collections:', error);
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
  const index = collections.findIndex(c => c.id === collectionId);
  if (index === -1) return null;

  collections[index] = {
    ...collections[index],
    ...updates,
    updatedAt: new Date().toISOString()
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
  const filtered = collections.filter(c => c.id !== collectionId);
  if (filtered.length === collections.length) return false;

  // Also remove collection reference from library items
  const library = getLibrary(artistId);
  library.forEach(item => {
    if (item.collectionIds?.includes(collectionId)) {
      item.collectionIds = item.collectionIds.filter(id => id !== collectionId);
    }
  });
  saveLibrary(artistId, library);

  saveCollections(artistId, filtered);
  if (db) deleteCollectionFromFirestore(db, artistId, collectionId).catch(log.error);
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
  const collection = collections.find(c => c.id === collectionId);
  if (collection) {
    const beforeCount = collection.mediaIds?.length || 0;
    collection.mediaIds = [...new Set([...(collection.mediaIds || []), ...idsToAdd])];
    collection.updatedAt = new Date().toISOString();
    log('[addToCollection]', collection.name, '| before:', beforeCount, '→ after:', collection.mediaIds.length, '| added:', idsToAdd);
    saveCollections(artistId, collections);
    trackCollectionWrite(collectionId, collection);
    if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
  } else {
    log.warn('[addToCollection] Collection not found:', collectionId);
  }

  // Update library items' collectionIds
  const library = getLibrary(artistId);
  library.forEach(item => {
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
  { primary: '#6366f1', light: '#a5b4fc', bg: 'rgba(99,102,241,0.06)', border: 'rgba(99,102,241,0.6)' },
  { primary: '#22c55e', light: '#86efac', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.6)' },
  { primary: '#a855f7', light: '#d8b4fe', bg: 'rgba(168,85,247,0.06)', border: 'rgba(168,85,247,0.6)' },
  { primary: '#f43f5e', light: '#fda4af', bg: 'rgba(244,63,94,0.06)', border: 'rgba(244,63,94,0.6)' },
  { primary: '#f59e0b', light: '#fcd34d', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.6)' },
  { primary: '#06b6d4', light: '#67e8f9', bg: 'rgba(6,182,212,0.06)', border: 'rgba(6,182,212,0.6)' },
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
  const collection = collections.find(c => c.id === collectionId);
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
  const collection = collections.find(c => c.id === collectionId);
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
  const collection = collections.find(c => c.id === collectionId);
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
  library.forEach(item => {
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
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;

  // Auto-migrate if needed
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);

  // Remove from all banks dynamically
  collection.banks = collection.banks.map(bank =>
    bank.filter(id => !idsToRemove.includes(id))
  );
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Extract plain text from a text bank entry (string or { text, style } object)
 */
export const getTextBankText = (entry) =>
  typeof entry === 'string' ? entry : entry?.text || '';

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
  if (collection.mediaBanks) return collection;
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
  collection.mediaBanks.forEach(bank => (bank.mediaIds || []).forEach(id => allIds.add(id)));
  // Preserve any audio IDs that are in mediaIds but not in any media bank
  (collection.mediaIds || []).forEach(id => {
    // Keep IDs not in any bank (they could be audio or other non-bank items)
    const inBank = collection.mediaBanks.some(b => (b.mediaIds || []).includes(id));
    if (!inBank) allIds.add(id);
  });
  collection.mediaIds = [...allIds];
};

/**
 * Add a named media bank to a video niche
 */
export const addMediaBank = (artistId, collectionId, name, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  if ((collection.mediaBanks || []).length >= MAX_MEDIA_BANKS) return;
  collection.mediaBanks.push({
    id: Date.now().toString(36),
    name: name || `Bank ${collection.mediaBanks.length + 1}`,
    mediaIds: [],
  });
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Remove a named media bank. Moves its media to the first remaining bank.
 */
export const removeMediaBank = (artistId, collectionId, bankId, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  if (!collection.mediaBanks) return;
  if (collection.mediaBanks.length <= 1) return; // Must keep at least 1
  const idx = collection.mediaBanks.findIndex(b => b.id === bankId);
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
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  const bank = collection.mediaBanks.find(b => b.id === bankId);
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
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  const bank = collection.mediaBanks.find(b => b.id === bankId);
  if (!bank) return;
  bank.mediaIds = [...new Set([...(bank.mediaIds || []), ...ids])];
  // Ensure all items are in the flat mediaIds too
  collection.mediaIds = [...new Set([...(collection.mediaIds || []), ...ids])];
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Remove media IDs from a specific named media bank + sync niche.mediaIds
 */
export const removeFromMediaBank = (artistId, collectionId, mediaIds, bankId, db = null, alsoRemoveFromNiche = false) => {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateToMediaBanks(collection);
  Object.assign(collection, migrated);
  if (!collection.mediaBanks) return;
  const bank = collection.mediaBanks.find(b => b.id === bankId);
  if (!bank) return;
  bank.mediaIds = (bank.mediaIds || []).filter(id => !ids.includes(id));
  // Also remove from niche entirely (mediaIds + all banks) in one atomic write
  if (alsoRemoveFromNiche) {
    collection.mediaBanks.forEach(b => {
      b.mediaIds = (b.mediaIds || []).filter(id => !ids.includes(id));
    });
    collection.mediaIds = (collection.mediaIds || []).filter(id => !ids.includes(id));
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
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
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
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
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
  const collection = collections.find(c => c.id === collectionId);
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
 * Update entire text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1-based slide position
 * @param {string[]} texts
 */
export const updateTextBank = (artistId, collectionId, bankNum, texts, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
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
  const collection = collections.find(c => c.id === collectionId);
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
  const collection = collections.find(c => c.id === collectionId);
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
  const collection = collections.find(c => c.id === collectionId);
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
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  collection.textTemplates = templates;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
};

/**
 * Get collection media split by bank assignment (dynamic)
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {{ banks: Object[][], unassigned: Object[] }}
 */
export const getCollectionBanks = (artistId, collectionId) => {
  const library = getLibrary(artistId);
  const collections = getUserCollections(artistId);
  let collection = collections.find(c => c.id === collectionId);
  if (!collection) return { banks: [[], []], unassigned: [] };

  collection = migrateCollectionBanks(collection);
  const allMedia = library.filter(item => (collection.mediaIds || []).includes(item.id));
  const allAssigned = new Set();
  const banks = collection.banks.map(bankIds => {
    (bankIds || []).forEach(id => allAssigned.add(id));
    return allMedia.filter(item => (bankIds || []).includes(item.id));
  });

  return {
    banks,
    unassigned: allMedia.filter(item => !allAssigned.has(item.id))
  };
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
  const collection = collections.find(c => c.id === collectionId);
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
  const collection = collections.find(c => c.id === collectionId);
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
      always = always.filter(t => !excluded.has(t));
      pool = pool.filter(t => !excluded.has(t));
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
  const collection = collections.find(c => c.id === collectionId);

  const emptyCB = { always: [], pool: [] };
  const emptyHB = { always: [], pool: [] };

  const cb = collection ? getCollectionCaptionBank(collection) : emptyCB;
  const hb = collection ? getCollectionHashtagBank(collection) : emptyHB;

  // Handle flat array legacy formats
  const alwaysCaptions = Array.isArray(cb) ? cb : (cb.always || []);
  const poolCaptions = Array.isArray(cb) ? [] : (cb.pool || []);
  const alwaysHashtags = Array.isArray(hb) ? hb : (hb.always || []);
  const poolHashtags = Array.isArray(hb) ? [] : (hb.pool || []);

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
export const updateCollectionPlatformHashtags = (artistId, collectionId, platformOnly, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
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
export const updateCollectionPlatformExcludes = (artistId, collectionId, platformExclude, db = null) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
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
  { id: 'hook_lyrics', name: '2 Slide', slideCount: 2, slideLabels: ['Hook', 'Lyrics'], type: 'slideshow' },
  { id: 'carousel', name: '3 Slide', slideCount: 3, slideLabels: ['Slide 1', 'Slide 2', 'Slide 3'], type: 'slideshow' },
  { id: 'four_slide', name: '4 Slide', slideCount: 4, slideLabels: ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4'], type: 'slideshow' },
  { id: 'hook_vibes_lyrics', name: '5 Slide', slideCount: 5, slideLabels: ['Hook', 'Text', 'Text', 'Text', 'Lyrics'], type: 'slideshow' },
  { id: 'six_slide', name: '6 Slide', slideCount: 6, slideLabels: ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4', 'Slide 5', 'Slide 6'], type: 'slideshow' },
  { id: 'seven_slide', name: '7 Slide', slideCount: 7, slideLabels: ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4', 'Slide 5', 'Slide 6', 'Slide 7'], type: 'slideshow' },
  { id: 'montage', name: 'Montage', slideCount: 0, slideLabels: [], type: 'video', description: 'Combine clips on a timeline, cut to beat' },
  { id: 'solo_clip', name: 'Solo Clip', slideCount: 0, slideLabels: [], type: 'video', description: 'One clip per video, batch generate' },
  { id: 'multi_clip', name: 'Multi Clip', slideCount: 0, slideLabels: [], type: 'video', description: 'Multiple clips on timeline' },
  { id: 'photo_montage', name: 'Photo Montage', slideCount: 0, slideLabels: [], type: 'video', description: 'Turn photos into video with transitions' },
  { id: 'finished_media', name: 'Finished Media', slideCount: 0, slideLabels: [], type: 'video', description: 'Upload ready-to-post videos & images' },
  { id: 'clipper', name: 'Clipper', slideCount: 0, slideLabels: [], type: 'video', description: 'Split a video into multiple clips' },
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
  color = null
}) => {
  const base = createCollection({ name, description, color });
  const activeFormat = formats.find(f => f.id === activeFormatId) || formats[0];
  const isVideoFormat = activeFormat?.type === 'video';
  const slideCount = isVideoFormat ? 0 : (activeFormat?.slideCount || 2);

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
    formats: formats.map(f => ({ ...f })),
    activeFormatId: activeFormat?.id || null,
    pipelineColor: color || PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
    banks,
    textBanks,
  };
};


/**
 * Get a bank label using the pipeline's active format labels instead of "Slide N"
 * Falls back to getBankLabel for non-pipeline collections or out-of-range indices
 */
export const getPipelineBankLabel = (pipeline, index) => {
  if (!pipeline?.isPipeline || !pipeline.formats) return getBankLabel(index);
  const activeFormat = pipeline.formats.find(f => f.id === pipeline.activeFormatId) || pipeline.formats[0];
  if (activeFormat?.slideLabels && index < activeFormat.slideLabels.length) {
    return activeFormat.slideLabels[index];
  }
  return getBankLabel(index);
};


// ============================================================================
// PAGE-CENTRIC WORKSPACE SYSTEM
// ============================================================================

/**
 * Create or get a workspace (collection) for a page + format combination.
 * If one already exists, returns it. Otherwise creates a new one.
 * @param {string} artistId
 * @param {Object} page - { handle, platform, id, profileImage, lateAccountId }
 * @param {Object} format - FORMAT_TEMPLATE entry
 * @returns {Object} The workspace collection
 */
export const getOrCreatePageWorkspace = (artistId, page, format, db = null) => {
  const collections = getUserCollections(artistId);
  // Look for existing workspace matching this page+format
  const existing = collections.find(c =>
    c.pageId === page.id && c.formatId === format.id
  );
  if (existing) return migrateCollectionBanks(existing);

  // Create new workspace
  const base = createCollection({
    name: `${page.handle} · ${format.name}`,
    description: '',
  });
  const slideCount = format.slideCount || 2;
  const banks = [];
  const textBanks = [];
  for (let i = 0; i < Math.max(slideCount, MIN_BANKS); i++) {
    banks.push([]);
    textBanks.push([]);
  }

  const workspace = {
    ...base,
    isPipeline: true, // backwards compat — workspace IS a pipeline internally
    pageId: page.id,
    formatId: format.id,
    pageHandle: page.handle,
    pagePlatform: page.platform,
    pageProfileImage: page.profileImage || null,
    linkedPage: { handle: page.handle, platform: page.platform, accountId: page.lateAccountId },
    formats: [{ ...format }],
    activeFormatId: format.id,
    pipelineColor: PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
    banks,
    textBanks,
  };

  collections.push(workspace);
  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, workspace).catch(log.error);
  return workspace;
};

/**
 * Get all workspaces for a specific page
 * @param {string} artistId
 * @param {string} pageId
 * @returns {Object[]} Array of workspace collections
 */
export const getPageWorkspaces = (artistId, pageId) => {
  const collections = getUserCollections(artistId);
  return collections.filter(c => c.pageId === pageId);
};

/**
 * Get all unlinked collections (not assigned to any page)
 * These are legacy collections that existed before the page system
 */
export const getUnlinkedCollections = (artistId) => {
  const collections = getUserCollections(artistId);
  return collections.filter(c => !c.pageId);
};

/**
 * Link an existing collection to a page + format
 * Used for migrating old collections into the page system
 */
export const linkCollectionToPage = (artistId, collectionId, page, format, db = null) => {
  const collections = getUserCollections(artistId);
  const col = collections.find(c => c.id === collectionId);
  if (!col) return null;

  col.pageId = page.id;
  col.formatId = format.id;
  col.pageHandle = page.handle;
  col.pagePlatform = page.platform;
  col.pageProfileImage = page.profileImage || null;
  col.linkedPage = { handle: page.handle, platform: page.platform, accountId: page.lateAccountId };
  col.isPipeline = true;
  col.formats = [{ ...format }];
  col.activeFormatId = format.id;
  col.updatedAt = new Date().toISOString();

  // Tag all media in banks with pageId
  const library = getLibrary(artistId);
  const mediaIdsInBanks = new Set();
  (col.banks || []).forEach(bank => (bank || []).forEach(id => mediaIdsInBanks.add(id)));
  (col.mediaIds || []).forEach(id => mediaIdsInBanks.add(id));

  let changed = false;
  library.forEach(item => {
    if (mediaIdsInBanks.has(item.id) && item.pageId !== page.id) {
      item.pageId = page.id;
      changed = true;
    }
  });
  if (changed) saveLibrary(artistId, library);

  saveCollections(artistId, collections);
  if (db) saveCollectionToFirestore(db, artistId, col).catch(log.error);
  return col;
};

/**
 * Tag media items with a pageId (used when uploading within a page workspace)
 */
export const tagMediaWithPage = (artistId, mediaIds, pageId) => {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const library = getLibrary(artistId);
  let changed = false;
  library.forEach(item => {
    if (ids.includes(item.id) && item.pageId !== pageId) {
      item.pageId = pageId;
      changed = true;
    }
  });
  if (changed) saveLibrary(artistId, library);
};

/**
 * Get media pool for a specific page (all media tagged with this pageId)
 */
export const getPageMedia = (artistId, pageId) => {
  const library = getLibrary(artistId);
  return library.filter(item => item.pageId === pageId);
};

/**
 * Get workspace bank label using format's slide labels
 */
export const getWorkspaceBankLabel = (workspace, index) => {
  if (!workspace?.formats) return getBankLabel(index);
  const fmt = workspace.formats.find(f => f.id === workspace.activeFormatId) || workspace.formats[0];
  if (fmt?.slideLabels && index < fmt.slideLabels.length) return fmt.slideLabels[index];
  return getBankLabel(index);
};

/**
 * Get workspace readiness (all banks have at least one image)
 */
export const getWorkspaceStatus = (workspace, library) => {
  if (!workspace) return { ready: false, label: 'No workspace' };
  const migrated = migrateCollectionBanks(workspace);
  const fmt = migrated.formats?.find(f => f.id === migrated.activeFormatId) || migrated.formats?.[0];
  const slideCount = fmt?.slideCount || migrated.banks?.length || 2;
  for (let i = 0; i < slideCount; i++) {
    if (!migrated.banks[i] || migrated.banks[i].length === 0) {
      return { ready: false, label: 'Needs media' };
    }
  }
  return { ready: true, label: 'Ready' };
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
  const collection = collections.find(c => c.id === collectionId);
  if (collection) {
    collection.mediaIds = collection.mediaIds.filter(id => !idsToRemove.includes(id));
    collection.updatedAt = new Date().toISOString();
    saveCollections(artistId, collections);
    if (db) saveCollectionToFirestore(db, artistId, collection).catch(log.error);
  }

  // Update library items' collectionIds
  const library = getLibrary(artistId);
  library.forEach(item => {
    if (idsToRemove.includes(item.id)) {
      item.collectionIds = (item.collectionIds || []).filter(id => id !== collectionId);
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
  return collections.filter(c => c.isProjectRoot === true);
};

/**
 * Get a specific project by ID
 */
export const getProjectById = (artistId, projectId) => {
  const collections = getUserCollections(artistId);
  return collections.find(c => c.id === projectId && c.isProjectRoot === true) || null;
};

/**
 * Get all niches (pipelines) in a project
 */
export const getProjectNiches = (artistId, projectId) => {
  const collections = getUserCollections(artistId);
  return collections.filter(c => c.projectId === projectId && c.isPipeline === true);
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
  const project = collections.find(c => c.id === projectId && c.isProjectRoot);
  if (!project) return;
  const existing = new Set(project.mediaIds || []);
  const newIds = ids.filter(id => !existing.has(id));
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
  const project = collections.find(c => c.id === projectId && c.isProjectRoot);
  if (!project || !project.mediaIds) return;
  const removeSet = new Set(ids);
  project.mediaIds = project.mediaIds.filter(id => !removeSet.has(id));
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
  const niches = collections.filter(c => c.projectId === projectId && c.isPipeline);
  const project = collections.find(c => c.id === projectId && c.isProjectRoot);
  const content = getCreatedContent(artistId);
  const nicheIds = new Set(niches.map(n => n.id));
  const draftCount = [
    ...(content.slideshows || []).filter(s => !s.isTemplate && nicheIds.has(s.collectionId)),
    ...(content.videos || []).filter(v => nicheIds.has(v.collectionId)),
  ].length;
  // Build niche format descriptions (e.g. "Hook + Lyrics", "Photo Montage")
  const nicheFormats = niches.map(n => {
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
  const idx = cols.findIndex(c => c.id === nicheId);
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
  const idx = cols.findIndex(c => c.id === nicheId);
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
  const idx = cols.findIndex(c => c.id === projectId && c.isProjectRoot);
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
  const idx = cols.findIndex(c => c.id === projectId && c.isProjectRoot);
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
  const idx = cols.findIndex(c => c.id === nicheId);
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
  const idx = cols.findIndex(c => c.id === nicheId);
  if (idx === -1) return;
  cols[idx].mediaIds = orderedIds;
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Update trim points on a media item stored in a niche
 */
export const updateMediaTrimPoints = (artistId, nicheId, mediaId, trimStart, trimEnd, db = null) => {
  const cols = getUserCollections(artistId);
  const colIdx = cols.findIndex(c => c.id === nicheId);
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
  const idx = cols.findIndex(c => c.id === nicheId);
  if (idx === -1) return null;
  const sessions = [...(cols[idx].clipperSessions || [])];
  const existingIdx = sessions.findIndex(s => s.id === session.id);
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
  const idx = cols.findIndex(c => c.id === nicheId);
  if (idx === -1) return;
  cols[idx].clipperSessions = (cols[idx].clipperSessions || []).filter(s => s.id !== sessionId);
  cols[idx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) saveCollectionToFirestore(db, artistId, cols[idx]).catch(log.error);
};

/**
 * Move a caption or hashtag entry from one niche to another
 */
export const moveNicheBankEntry = (artistId, fromNicheId, toNicheId, entry, bankType, db = null) => {
  const cols = getUserCollections(artistId);
  const fromIdx = cols.findIndex(c => c.id === fromNicheId);
  const toIdx = cols.findIndex(c => c.id === toNicheId);
  if (fromIdx === -1 || toIdx === -1) return;
  const field = bankType === 'caption' ? 'captionBank' : 'hashtagBank';
  const fromBank = [...(cols[fromIdx][field] || [])];
  const toBank = [...(cols[toIdx][field] || [])];
  const entryIdx = fromBank.indexOf(entry);
  if (entryIdx === -1) return;
  fromBank.splice(entryIdx, 1);
  toBank.push(entry);
  cols[fromIdx][field] = fromBank;
  cols[toIdx][field] = toBank;
  cols[fromIdx].updatedAt = new Date().toISOString();
  cols[toIdx].updatedAt = new Date().toISOString();
  saveCollections(artistId, cols);
  if (db) {
    saveCollectionToFirestore(db, artistId, cols[fromIdx]).catch(log.error);
    saveCollectionToFirestore(db, artistId, cols[toIdx]).catch(log.error);
  }
};

/**
 * Get a structured tree of all projects' banks for cross-pollination.
 * Returns: [{ project, niches: [{ niche, format, banks: [{ label, images: [{id,url,thumbnailUrl}] }], captions, hashtags }] }]
 * Excludes the specified project.
 */
export const getProjectBankTree = (artistId, excludeProjectId = null) => {
  const collections = getUserCollections(artistId);
  const lib = getLibrary(artistId);
  const projects = collections.filter(c => c.isProjectRoot === true && c.id !== excludeProjectId);

  return projects.map(project => {
    const niches = collections.filter(c => c.projectId === project.id && c.isPipeline === true);
    return {
      project: { id: project.id, name: project.name, color: project.projectColor },
      niches: niches.map(niche => {
        const format = niche.formats?.[0] || null;
        const slideCount = format?.slideCount || 0;
        const banks = Array.from({ length: slideCount }).map((_, bankIdx) => {
          const label = getPipelineBankLabel(niche, bankIdx);
          const images = (niche.banks?.[bankIdx] || [])
            .map(id => lib.find(m => m.id === id))
            .filter(Boolean)
            .map(m => ({ id: m.id, url: m.url, thumbnailUrl: m.thumbnailUrl, name: m.name }));
          const textEntries = (niche.textBanks?.[bankIdx] || []).map(e => getTextBankText(e));
          return { label, images, textEntries };
        });
        return {
          niche: { id: niche.id, name: niche.name },
          format,
          banks,
          captions: Array.isArray(niche.captionBank) ? niche.captionBank : [...(niche.captionBank?.always || []), ...(niche.captionBank?.pool || [])],
          hashtags: Array.isArray(niche.hashtagBank) ? niche.hashtagBank : [...(niche.hashtagBank?.always || []), ...(niche.hashtagBank?.pool || [])],
        };
      }),
    };
  }).filter(p => p.niches.length > 0);
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
  collections.filter(c => c.isProjectRoot).forEach(p => {
    if (p.name && p.name.startsWith('@@')) {
      p.name = p.name.slice(1);
      needsSave = true;
    }
  });

  // Dedup project roots by linkedPage.handle (or name for unlinked)
  const projectRoots = collections.filter(c => c.isProjectRoot);
  if (projectRoots.length > 0) {
    const seenKeys = new Set();
    const dupeIds = new Set();
    projectRoots.forEach(p => {
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
      const survivors = projectRoots.filter(p => !dupeIds.has(p.id));
      dupeIds.forEach(dupeId => {
        const dupe = collections.find(c => c.id === dupeId);
        if (!dupe) return;
        const rawKey = dupe.linkedPage?.handle || dupe.name || dupe.id;
        const key = rawKey.replace(/^@+/, '');
        const survivor = survivors.find(s => {
          const sk = (s.linkedPage?.handle || s.name || s.id).replace(/^@+/, '');
          return sk === key;
        });
        if (survivor) {
          collections.filter(c => c.projectId === dupeId).forEach(n => { n.projectId = survivor.id; });
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
  const existingRoots = collections.filter(c => c.isProjectRoot);
  const orphanNiches = collections.filter(c => c.isPipeline && !c.projectId && !c.isProjectRoot);
  if (existingRoots.length > 0 && orphanNiches.length > 0) {
    orphanNiches.forEach(niche => {
      const nicheHandle = niche.linkedPage?.handle;
      const matchingRoot = nicheHandle
        ? existingRoots.find(r => r.linkedPage?.handle === nicheHandle)
        : null;
      if (matchingRoot) {
        niche.projectId = matchingRoot.id;
        const poolIds = new Set(matchingRoot.mediaIds || []);
        (niche.mediaIds || []).forEach(id => poolIds.add(id));
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
        firestoreDeleteIds.forEach(id => {
          const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', id);
          deleteDoc(docRef).catch(() => {});
        });
        log('[libraryService] Deleting', firestoreDeleteIds.length, 'duplicate docs from Firestore');
      }
      // Save surviving roots + reassigned niches to Firestore
      const modified = collections.filter(c => c.isProjectRoot || c.projectId);
      Promise.all(modified.map(col => saveCollectionToFirestore(db, artistId, col))).catch(log.error);
    }
  }

  // ── Phase 2: Create new projects (guarded — once per artist) ──
  if (localStorage.getItem(flagKey)) return;

  const unmigrated = collections.filter(c => c.isPipeline && !c.projectId && !c.isProjectRoot);
  if (unmigrated.length === 0) {
    localStorage.setItem(flagKey, Date.now().toString());
    return;
  }

  const groups = {};
  unmigrated.forEach(pipeline => {
    const key = pipeline.linkedPage?.handle || `standalone_${pipeline.id}`;
    if (!groups[key]) groups[key] = { linkedPage: pipeline.linkedPage || null, niches: [] };
    groups[key].niches.push(pipeline);
  });

  const newProjects = [];
  Object.entries(groups).forEach(([key, group]) => {
    const handle = group.linkedPage?.handle || '';
    const projectName = group.linkedPage
      ? (handle.startsWith('@') ? handle : `@${handle}`)
      : (group.niches.length === 1 ? group.niches[0].name : key);
    const base = createCollection({ name: projectName, description: '' });
    const project = {
      ...base,
      isProjectRoot: true,
      linkedPage: group.linkedPage,
      projectColor: group.niches[0]?.pipelineColor || PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
    };

    const allMediaIds = new Set();
    group.niches.forEach(niche => {
      (niche.mediaIds || []).forEach(id => allMediaIds.add(id));
    });
    project.mediaIds = Array.from(allMediaIds);

    // Migrate caption/hashtag banks from old collection format to flat arrays
    group.niches.forEach(niche => {
      niche.projectId = project.id;
      if (niche.captionBank && typeof niche.captionBank === 'object' && !Array.isArray(niche.captionBank)) {
        const { always = [], pool = [] } = niche.captionBank;
        niche.captionBank = [...always, ...pool];
      }
      if (niche.hashtagBank && typeof niche.hashtagBank === 'object' && !Array.isArray(niche.hashtagBank)) {
        const { always = [], pool = [] } = niche.hashtagBank;
        niche.hashtagBank = [...always, ...pool];
      }
    });
    collections.push(project);
    newProjects.push(project);
  });

  saveCollections(artistId, collections);
  localStorage.setItem(flagKey, Date.now().toString());
  log('[libraryService] Migrated', unmigrated.length, 'pipelines into', newProjects.length, 'projects');

  if (db) {
    try {
      const toSave = [...newProjects, ...unmigrated];
      await Promise.all(toSave.map(col => saveCollectionToFirestore(db, artistId, col)));
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
    if (library.length > 0 && (!existingProject.mediaIds || existingProject.mediaIds.length === 0)) {
      existingProject.mediaIds = library.map(item => item.id);
      const cols = getUserCollections(artistId);
      const idx = cols.findIndex(c => c.id === existingProject.id);
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
    niches.forEach(niche => {
      const nicheDrafts = (content.slideshows || []).filter(s => s.collectionId === niche.id && !s.isTemplate);
      if (nicheDrafts.length === 0) return;
      const imageIds = new Set(niche.mediaIds || []);
      const beforeSize = imageIds.size;
      // Ensure banks array exists
      if (!niche.banks) niche.banks = [];
      const bankSets = niche.banks.map(b => new Set(b || []));
      let banksDirty = false;
      // Also build text bank sets from draft text overlays
      if (!niche.textBanks) niche.textBanks = [];
      const textBankSets = niche.textBanks.map(tb => new Set((tb || []).map(e => typeof e === 'string' ? e : e?.text).filter(Boolean)));
      let textDirty = false;
      nicheDrafts.forEach(draft => {
        (draft.slides || []).forEach((slide, slideIdx) => {
          // Resolve image ID from sourceImageId, or match by backgroundImage URL
          let imgId = slide.sourceImageId || slide.imageId;
          if (!imgId && slide.backgroundImage) {
            const match = lib.find(m => m.url === slide.backgroundImage);
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
          (slide.textOverlays || []).forEach(overlay => {
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
        niche.banks = bankSets.map(s => Array.from(s));
        if (textDirty) {
          niche.textBanks = textBankSets.map(s => Array.from(s));
        }
        const cols2 = getUserCollections(artistId);
        const nIdx = cols2.findIndex(c => c.id === niche.id);
        if (nIdx !== -1) { cols2[nIdx] = niche; nichesDirty = true; }
        saveCollections(artistId, cols2);
      }
    });
    if (nichesDirty && db) {
      Promise.all(niches.filter(n => n.mediaIds?.length > 0).map(n => saveCollectionToFirestore(db, artistId, n))).catch(log.error);
      log('[libraryService] Populated niche media pools + banks from draft images');
    }

    // Always patch stale niche format labels & names to match current FORMAT_TEMPLATES
    const allNiches = getProjectNiches(artistId, existingProject.id);
    let labelsDirty = false;
    allNiches.forEach(niche => {
      if (!niche.formats?.length) return;
      niche.formats.forEach(fmt => {
        const template = FORMAT_TEMPLATES.find(t => t.id === fmt.id);
        if (!template) return;
        const needsLabelFix = JSON.stringify(fmt.slideLabels) !== JSON.stringify(template.slideLabels);
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
        'Carousel': '3 Slide',
      };
      if (OLD_NAME_MAP[niche.name]) {
        niche.name = OLD_NAME_MAP[niche.name];
        labelsDirty = true;
      }
    });
    if (labelsDirty) {
      const cols3 = getUserCollections(artistId);
      allNiches.forEach(n => {
        const nIdx = cols3.findIndex(c => c.id === n.id);
        if (nIdx !== -1) cols3[nIdx] = n;
      });
      saveCollections(artistId, cols3);
      if (db) Promise.all(allNiches.map(n => saveCollectionToFirestore(db, artistId, n))).catch(log.error);
      log('[libraryService] Patched niche format labels to match current templates');
    }
  }

  const flagKey = `stm_drafts_migrated_${artistId}`;
  if (localStorage.getItem(flagKey)) return;

  const content = getCreatedContent(artistId);
  const unassigned = (content.slideshows || []).filter(s => !s.isTemplate && !s.collectionId);
  if (unassigned.length === 0) {
    localStorage.setItem(flagKey, Date.now().toString());
    return;
  }

  // Map slide counts to format template IDs
  const SLIDE_FORMAT_MAP = { 1: 'single', 2: 'hook_lyrics', 3: 'carousel', 5: 'hook_vibes_lyrics' };
  const groups = {};
  unassigned.forEach(s => {
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
      project.mediaIds = library.map(item => item.id);
      const cols = getUserCollections(artistId);
      const idx = cols.findIndex(c => c.id === project.id);
      if (idx !== -1) cols[idx] = project;
      saveCollections(artistId, cols);
    }
    if (db) await saveCollectionToFirestore(db, artistId, project);
  }

  // For each format group, ensure a niche exists and assign drafts
  for (const [formatId, drafts] of Object.entries(groups)) {
    const format = FORMAT_TEMPLATES.find(f => f.id === formatId);
    if (!format) continue;

    // Check if niche already exists for this format under this project
    const collections = getUserCollections(artistId);
    let niche = collections.find(c =>
      c.projectId === project.id && c.isPipeline && c.formats?.[0]?.id === formatId
    );

    if (!niche) {
      niche = createNiche(artistId, { projectId: project.id, format });
      if (db) await saveCollectionToFirestore(db, artistId, niche);
    }

    // Assign drafts + extract image IDs into niche mediaIds + banks
    const nicheImageIds = new Set(niche.mediaIds || []);
    if (!niche.banks) niche.banks = [];
    const bankSets = niche.banks.map(b => new Set(b || []));
    drafts.forEach(draft => {
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
    niche.banks = bankSets.map(s => Array.from(s));
    if (nicheImageIds.size > (niche.mediaIds || []).length) {
      niche.mediaIds = Array.from(nicheImageIds);
      const cols2 = getUserCollections(artistId);
      const nIdx = cols2.findIndex(c => c.id === niche.id);
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
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return [];

  return library.filter(item => collection.mediaIds.includes(item.id));
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
        .filter(item => new Date(item.createdAt) >= thirtyDaysAgo)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    case SMART_COLLECTION_IDS.FAVORITES:
      return library.filter(item => item.isFavorite);

    case SMART_COLLECTION_IDS.VERTICAL:
      return library.filter(item =>
        (item.type === MEDIA_TYPES.VIDEO || item.type === MEDIA_TYPES.IMAGE) &&
        item.aspectRatio && item.aspectRatio < 1
      );

    case SMART_COLLECTION_IDS.HAS_AUDIO:
      return library.filter(item =>
        item.type === MEDIA_TYPES.VIDEO && item.hasEmbeddedAudio
      );

    case SMART_COLLECTION_IDS.MOST_USED:
      return library
        .filter(item => item.useCount >= 2)
        .sort((a, b) => b.useCount - a.useCount);

    case SMART_COLLECTION_IDS.UNUSED:
      return library.filter(item => !item.useCount || item.useCount === 0);

    case SMART_COLLECTION_IDS.AUDIO_ALL:
      return library.filter(item => item.type === MEDIA_TYPES.AUDIO);

    default:
      return [];
  }
};

// ============================================================================
// CREATED CONTENT OPERATIONS
// ============================================================================

/**
 * Get all created content for an artist
 * @param {string} artistId
 * @returns {Object} { videos: [], slideshows: [] }
 */
export const getCreatedContent = (artistId) => {
  try {
    const data = localStorage.getItem(getCreatedContentKey(artistId));
    const content = data ? JSON.parse(data) : { videos: [], slideshows: [] };
    // Deduplicate slideshows by ID (keep the latest version)
    if (content.slideshows?.length > 0) {
      const seen = new Map();
      content.slideshows.forEach(s => {
        if (!seen.has(s.id) || (s.updatedAt && s.updatedAt > (seen.get(s.id).updatedAt || ''))) {
          seen.set(s.id, s);
        }
      });
      if (seen.size < content.slideshows.length) {
        content.slideshows = Array.from(seen.values());
        localStorage.setItem(getCreatedContentKey(artistId), JSON.stringify(content));
      }
    }
    return content;
  } catch (error) {
    log.error('Error loading created content:', error);
    return { videos: [], slideshows: [] };
  }
};

/**
 * Save created content
 * @param {string} artistId
 * @param {Object} content
 */
export const saveCreatedContent = (artistId, content) => {
  try {
    // Clean data to reduce size and remove non-serializable fields
    const cleanedContent = {
      videos: (content.videos || []).map(v => ({
        ...v,
        thumbnail: v.thumbnail?.startsWith('blob:') ? null : (v.thumbnail || null),
        clips: (v.clips || []).map(c => ({
          ...c,
          file: undefined,
          localUrl: undefined,
          url: c.url?.startsWith('blob:') ? null : c.url,
          thumbnail: c.thumbnail?.startsWith('blob:') ? null : (c.thumbnail || null),
          thumbnailUrl: c.thumbnailUrl || null
        })).filter(c => c.url)
      })),
      slideshows: (content.slideshows || []).map(s => ({
        ...s,
        thumbnail: s.thumbnail?.startsWith('blob:') ? null : (s.thumbnail || null),
        audio: s.audio ? {
          ...s.audio,
          file: undefined,
          localUrl: undefined,
          url: s.audio.url?.startsWith('blob:') ? null : s.audio.url
        } : null,
        slides: (s.slides || []).map(slide => ({
          ...slide,
          // Keep backgroundImage URLs (Firebase Storage), remove blob URLs
          backgroundImage: slide.backgroundImage?.startsWith('blob:') ? null : slide.backgroundImage
        }))
      }))
    };

    localStorage.setItem(getCreatedContentKey(artistId), JSON.stringify(cleanedContent));
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      log.warn('[CreatedContent] localStorage quota exceeded, attempting cleanup...');
      try {
        // Remove old session/temp data to free space
        const keysToClean = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith('stm_session_') || key?.startsWith('stm_temp_') || key?.startsWith('stm_draft_')) {
            keysToClean.push(key);
          }
        }
        keysToClean.forEach(k => localStorage.removeItem(k));
        log('[CreatedContent] Cleaned', keysToClean.length, 'temp keys, retrying save...');

        // Retry save after cleanup with even more aggressive cleaning
        const minimalContent = {
          videos: (content.videos || []).map(v => ({
            id: v.id,
            name: v.name,
            url: v.url?.startsWith('blob:') ? null : v.url,
            exportedImages: v.exportedImages || [],
            status: v.status,
            createdAt: v.createdAt,
            updatedAt: v.updatedAt,
            aspectRatio: v.aspectRatio,
            duration: v.duration
          })).filter(v => v.url),
          slideshows: (content.slideshows || []).map(s => ({
            id: s.id,
            name: s.name,
            aspectRatio: s.aspectRatio,
            slides: (s.slides || []).map(slide => ({
              backgroundImage: slide.backgroundImage?.startsWith('blob:') ? null : slide.backgroundImage,
              textOverlays: slide.textOverlays || [],
              imageTransform: slide.imageTransform
            })).filter(slide => slide.backgroundImage),
            audio: s.audio ? {
              id: s.audio.id,
              name: s.audio.name,
              url: s.audio.url?.startsWith('blob:') ? null : s.audio.url,
              duration: s.audio.duration
            } : null,
            audioStartTime: s.audioStartTime,
            audioEndTime: s.audioEndTime,
            exportedImages: s.exportedImages || [],
            status: s.status,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            collectionId: s.collectionId,
            collectionName: s.collectionName
          }))
        };

        localStorage.setItem(getCreatedContentKey(artistId), JSON.stringify(minimalContent));
        log('[CreatedContent] Saved with minimal data after cleanup');
      } catch (retryError) {
        log.error('[CreatedContent] Save failed even after cleanup. Storage is full:', retryError.message);
        // Last resort: try to keep only most recent 20 items
        try {
          const recentContent = {
            videos: (content.videos || []).slice(-10).map(v => ({ id: v.id, name: v.name, url: v.url, status: v.status })),
            slideshows: (content.slideshows || []).slice(-10).map(s => ({ id: s.id, name: s.name, status: s.status }))
          };
          localStorage.setItem(getCreatedContentKey(artistId), JSON.stringify(recentContent));
          log.warn('[CreatedContent] Saved only most recent 20 items due to quota');
        } catch (finalError) {
          log.error('[CreatedContent] CRITICAL: Cannot save to localStorage at all:', finalError.message);
        }
      }
    } else {
      log.error('Error saving created content:', error);
    }
  }
};

/**
 * Add a created video
 * @param {string} artistId
 * @param {Object} videoData
 * @returns {Object} Created video
 */
export const addCreatedVideo = (artistId, videoData) => {
  const content = getCreatedContent(artistId);
  const newVideo = videoData.id ? { type: 'video', ...videoData } : createCreatedVideo(videoData);
  content.videos.push(newVideo);
  saveCreatedContent(artistId, content);
  return newVideo;
};

/**
 * Update a created video
 * @param {string} artistId
 * @param {string} videoId
 * @param {Object} updates
 * @returns {Object|null} Updated video
 */
export const updateCreatedVideo = (artistId, videoId, updates) => {
  const content = getCreatedContent(artistId);
  const index = content.videos.findIndex(v => v.id === videoId);
  if (index === -1) return null;

  content.videos[index] = {
    ...content.videos[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveCreatedContent(artistId, content);
  return content.videos[index];
};

// Track IDs deleted locally so Firestore subscription can reconcile
const getLocallyDeletedKey = (artistId) => `stm_deleted_content_${artistId}`;

const trackLocallyDeletedContent = (artistId, itemId) => {
  try {
    const key = getLocallyDeletedKey(artistId);
    const ids = JSON.parse(localStorage.getItem(key) || '[]');
    if (!ids.includes(itemId)) ids.push(itemId);
    localStorage.setItem(key, JSON.stringify(ids));
  } catch (e) { /* ignore */ }
};

export const getAndClearLocallyDeletedContent = (artistId) => {
  try {
    const key = getLocallyDeletedKey(artistId);
    const ids = JSON.parse(localStorage.getItem(key) || '[]');
    if (ids.length > 0) localStorage.removeItem(key);
    return ids;
  } catch (e) { return []; }
};

/**
 * Delete a created video
 * @param {string} artistId
 * @param {string} videoId
 * @returns {boolean} Success
 */
export const deleteCreatedVideo = (artistId, videoId) => {
  const content = getCreatedContent(artistId);
  const filtered = content.videos.filter(v => v.id !== videoId);
  if (filtered.length === content.videos.length) return false;

  content.videos = filtered;
  saveCreatedContent(artistId, content);
  // Track locally-deleted ID so Firestore subscription can reconcile
  trackLocallyDeletedContent(artistId, videoId);
  return true;
};

/**
 * Add a created slideshow
 * @param {string} artistId
 * @param {Object} slideshowData
 * @returns {Object} Created slideshow
 */
export const addCreatedSlideshow = (artistId, slideshowData) => {
  const content = getCreatedContent(artistId);
  const newSlideshow = slideshowData.id ? { type: 'slideshow', ...slideshowData } : createCreatedSlideshow(slideshowData);
  // Upsert: update if same ID exists, otherwise add new
  const existingIndex = content.slideshows.findIndex(s => s.id === newSlideshow.id);
  if (existingIndex >= 0) {
    content.slideshows[existingIndex] = { ...content.slideshows[existingIndex], ...newSlideshow, updatedAt: new Date().toISOString() };
  } else {
    content.slideshows.push(newSlideshow);
  }
  saveCreatedContent(artistId, content);
  return newSlideshow;
};

/**
 * Add multiple created slideshows at once (batch operation)
 * @param {string} artistId
 * @param {Array<Object>} slideshowsData
 * @returns {Array<Object>} Created slideshows
 */
export const addCreatedSlideshowsBatch = (artistId, slideshowsData) => {
  const content = getCreatedContent(artistId);
  const newSlideshows = slideshowsData.map(data =>
    data.id ? { type: 'slideshow', ...data } : createCreatedSlideshow(data)
  );

  // Upsert all slideshows
  newSlideshows.forEach(newSlideshow => {
    const existingIndex = content.slideshows.findIndex(s => s.id === newSlideshow.id);
    if (existingIndex >= 0) {
      content.slideshows[existingIndex] = { ...content.slideshows[existingIndex], ...newSlideshow, updatedAt: new Date().toISOString() };
    } else {
      content.slideshows.push(newSlideshow);
    }
  });

  // Save once to localStorage
  saveCreatedContent(artistId, content);
  return newSlideshows;
};

/**
 * Update a created slideshow
 * @param {string} artistId
 * @param {string} slideshowId
 * @param {Object} updates
 * @returns {Object|null} Updated slideshow
 */
export const updateCreatedSlideshow = (artistId, slideshowId, updates) => {
  const content = getCreatedContent(artistId);
  const index = content.slideshows.findIndex(s => s.id === slideshowId);
  if (index === -1) return null;

  content.slideshows[index] = {
    ...content.slideshows[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveCreatedContent(artistId, content);
  return content.slideshows[index];
};

/**
 * Delete a created slideshow
 * @param {string} artistId
 * @param {string} slideshowId
 * @returns {boolean} Success
 */
export const deleteCreatedSlideshow = (artistId, slideshowId) => {
  const content = getCreatedContent(artistId);
  const filtered = content.slideshows.filter(s => s.id !== slideshowId);
  if (filtered.length === content.slideshows.length) return false;

  content.slideshows = filtered;
  saveCreatedContent(artistId, content);
  // Track locally-deleted ID so Firestore subscription can reconcile
  trackLocallyDeletedContent(artistId, slideshowId);
  return true;
};

// ============================================================================
// CREATED CONTENT - FIRESTORE ASYNC OPERATIONS
// ============================================================================

/**
 * Save created content to Firestore (async backup)
 * Stores slideshows and videos individually in artists/{artistId}/library/data/createdContent/{id}
 */
export const saveCreatedContentAsync = async (db, artistId, content) => {
  if (!db || !artistId) return;
  try {
    // New structure: save each video/slideshow as its own document
    const batch = writeBatch(db);

    // Save videos (strip thumbnails and blob URLs)
    (content.videos || []).forEach(video => {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', video.id);

      // Clean clips (remove non-serializable fields)
      const cleanedClips = (video.clips || []).map(c => {
        const { file, localUrl, ...clipData } = c;
        const cleaned = {
          ...clipData,
          url: c.url?.startsWith('blob:') ? null : c.url,
          thumbnail: c.thumbnail?.startsWith('blob:') ? null : (c.thumbnail || null),
          thumbnailUrl: c.thumbnailUrl || null
        };
        // Remove undefined fields
        Object.keys(cleaned).forEach(key => {
          if (cleaned[key] === undefined) delete cleaned[key];
        });
        return cleaned;
      }).filter(c => c.url);

      batch.set(docRef, {
        ...video,
        type: 'video',
        thumbnail: video.thumbnail?.startsWith('blob:') ? null : (video.thumbnail || null),
        clips: cleanedClips,
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    // Save slideshows (strip thumbnails and blob URLs)
    (content.slideshows || []).forEach(slideshow => {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', slideshow.id);

      // Clean audio object (remove non-serializable fields)
      let cleanedAudio = null;
      if (slideshow.audio) {
        const { file, localUrl, ...audioData } = slideshow.audio;
        cleanedAudio = {
          ...audioData,
          url: slideshow.audio.url?.startsWith('blob:') ? null : slideshow.audio.url
        };
        // Remove undefined fields
        Object.keys(cleanedAudio).forEach(key => {
          if (cleanedAudio[key] === undefined) delete cleanedAudio[key];
        });
        // Don't save if no valid URL
        if (!cleanedAudio.url) cleanedAudio = null;
      }

      batch.set(docRef, {
        ...slideshow,
        type: 'slideshow',
        thumbnail: slideshow.thumbnail?.startsWith('blob:') ? null : (slideshow.thumbnail || null),
        audio: cleanedAudio,
        slides: (slideshow.slides || []).map(slide => ({
          ...slide,
          backgroundImage: slide.backgroundImage?.startsWith('blob:') ? null : slide.backgroundImage
        })),
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    await batch.commit();
    log('[Library] Created content saved to Firestore:',
      `${content.videos?.length || 0} videos, ${content.slideshows?.length || 0} slideshows`);
  } catch (error) {
    log.error('[Library] Firestore save created content failed:', error.message);
  }
};

/**
 * Load created content from Firestore
 * Falls back to localStorage if Firestore is unavailable
 * MIGRATION: Checks old path first and migrates to new structure if needed
 */
export const loadCreatedContentAsync = async (db, artistId) => {
  if (!db || !artistId) return getCreatedContent(artistId);
  try {
    // First, check if we need to migrate from old path
    const oldDocRef = doc(db, 'artists', artistId, 'studio', 'createdContent');
    const oldDoc = await getDoc(oldDocRef);

    if (oldDoc.exists()) {
      // Migrate from old structure to new
      const oldData = oldDoc.data();
      const content = {
        videos: oldData.videos || [],
        slideshows: oldData.slideshows || []
      };

      log('[Library] Migrating created content from old path to new structure...');
      await saveCreatedContentAsync(db, artistId, content);

      // Delete old document after successful migration
      try {
        await deleteDoc(oldDocRef);
        log('[Library] Migration complete, old document deleted');
      } catch (err) {
        log.warn('[Library] Could not delete old document:', err.message);
      }

      saveCreatedContent(artistId, content);
      return content;
    }

    // Query new structure
    const collectionRef = collection(db, 'artists', artistId, 'library', 'data', 'createdContent');
    const snapshot = await getDocs(collectionRef);

    const videos = [];
    const slideshows = [];

    // Reconcile: soft-delete any items tracked as locally deleted
    const pendingDeletes = new Set(getAndClearLocallyDeletedContent(artistId));
    if (pendingDeletes.size > 0) {
      snapshot.docs.forEach(d => {
        if (pendingDeletes.has(d.id) && !d.data().deletedAt) {
          updateDoc(d.ref, { deletedAt: serverTimestamp() }).catch(err =>
            log.error('[Library] Reconcile soft-delete in load:', err)
          );
        }
      });
    }

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.deletedAt || pendingDeletes.has(doc.id)) return; // Skip soft-deleted items
      // Infer type from data shape if type field is missing (backwards compat)
      const type = data.type || (data.slides ? 'slideshow' : data.clips ? 'video' : null);
      if (type === 'video') {
        videos.push({ ...data, type: 'video' });
      } else if (type === 'slideshow') {
        slideshows.push({ ...data, type: 'slideshow' });
      }
    });

    const content = { videos, slideshows };

    // If Firestore is empty but localStorage has data, migrate from localStorage
    if (videos.length === 0 && slideshows.length === 0) {
      const localContent = getCreatedContent(artistId);
      if (localContent.videos.length > 0 || localContent.slideshows.length > 0) {
        log('[Library] Migrating created content from localStorage to Firestore...');
        await saveCreatedContentAsync(db, artistId, localContent);
        return localContent;
      }
    }

    // Also update localStorage for offline access
    saveCreatedContent(artistId, content);
    return content;
  } catch (error) {
    log.error('[Library] Firestore load created content failed:', error.message);
  }
  // Fallback to localStorage
  return getCreatedContent(artistId);
};

/**
 * Subscribe to created content changes in real-time
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Function} callback - Called with updated content { videos: [], slideshows: [] }
 * @returns {Function} Unsubscribe function
 */
export const subscribeToCreatedContent = (db, artistId, callback) => {
  if (!db || !artistId) return () => {};

  // Helper to clean data loaded from Firestore (remove undefined fields)
  const cleanLoadedData = (data) => {
    const cleaned = { ...data };

    // Clean audio object if present
    if (cleaned.audio) {
      const { file, localUrl, ...audioData } = cleaned.audio;
      cleaned.audio = audioData;
      // Remove undefined fields from audio
      Object.keys(cleaned.audio).forEach(key => {
        if (cleaned.audio[key] === undefined) delete cleaned.audio[key];
      });
      if (!cleaned.audio.url) cleaned.audio = null;
    }

    // Clean clips if present (for videos)
    if (cleaned.clips) {
      cleaned.clips = cleaned.clips.map(clip => {
        const { file, localUrl, thumbnail, ...clipData } = clip;
        const cleanedClip = clipData;
        Object.keys(cleanedClip).forEach(key => {
          if (cleanedClip[key] === undefined) delete cleanedClip[key];
        });
        return cleanedClip;
      }).filter(c => c.url);
    }

    // Remove any undefined fields at top level
    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === undefined) delete cleaned[key];
    });

    return cleaned;
  };

  // Run migration first, then subscribe
  let unsubscribeSnapshot = null;
  let cancelled = false;
  loadCreatedContentAsync(db, artistId).then(() => {
    if (cancelled) return; // Component unmounted before load finished
    const collectionRef = collection(db, 'artists', artistId, 'library', 'data', 'createdContent');
    unsubscribeSnapshot = onSnapshot(collectionRef, (snapshot) => {
      // Reconcile: soft-delete items in Firestore that were deleted locally
      const pendingDeletes = new Set(getAndClearLocallyDeletedContent(artistId));

      // Also apply any tracked local deletes
      if (pendingDeletes.size > 0) {
        snapshot.docs.forEach(d => {
          if (pendingDeletes.has(d.id) && !d.data().deletedAt) {
            updateDoc(d.ref, { deletedAt: serverTimestamp() }).catch(err =>
              log.error('[Library] Reconcile soft-delete failed:', err)
            );
          }
        });
      }

      // Soft-delete all reconciled items in Firestore
      if (pendingDeletes.size > 0) {
        snapshot.docs.forEach(d => {
          if (pendingDeletes.has(d.id) && !d.data().deletedAt) {
            updateDoc(d.ref, { deletedAt: serverTimestamp() }).catch(err =>
              log.error('[Library] Reconcile soft-delete failed:', err)
            );
          }
        });
      }

      const videos = [];
      const slideshows = [];

      snapshot.docs.forEach(doc => {
        const data = cleanLoadedData(doc.data());
        if (data.deletedAt || pendingDeletes.has(doc.id)) return; // Skip soft-deleted items
        // Infer type from data shape if type field is missing (backwards compat)
        const type = data.type || (data.slides ? 'slideshow' : data.clips ? 'video' : null);
        if (type === 'video') {
          videos.push({ ...data, type: 'video' });
        } else if (type === 'slideshow') {
          slideshows.push({ ...data, type: 'slideshow' });
        }
      });

      const content = { videos, slideshows };

      // Always save to localStorage (reconciliation ensures only valid items remain)
      saveCreatedContent(artistId, content);

      callback(content);
    }, (error) => {
      log.error('[Library] Created content subscription error:', error);
    });
  });

  return () => { cancelled = true; if (unsubscribeSnapshot) unsubscribeSnapshot(); };
};

/**
 * Add a created slideshow (with Firestore sync)
 */
export const addCreatedSlideshowAsync = async (db, artistId, slideshowData) => {
  const result = addCreatedSlideshow(artistId, slideshowData);
  const content = getCreatedContent(artistId);
  try {
    await saveCreatedContentAsync(db, artistId, content);
  } catch (error) {
    log.error('[Library] Failed to sync slideshow to Firestore:', error);
    // Data still saved to localStorage, mark as unsynced
  }
  return result;
};

/**
 * Update a created slideshow (with Firestore sync)
 */
export const updateCreatedSlideshowAsync = async (db, artistId, slideshowId, updates) => {
  const result = updateCreatedSlideshow(artistId, slideshowId, updates);
  const content = getCreatedContent(artistId);
  try {
    await saveCreatedContentAsync(db, artistId, content);
  } catch (error) {
    log.error('[Library] Failed to sync slideshow update to Firestore:', error);
    // Data still saved to localStorage, mark as unsynced
  }
  return result;
};

/**
 * Delete a created slideshow (with Firestore soft-delete)
 * Marks with deletedAt in Firestore instead of deleting. Removes from localStorage for immediate UI update.
 */
export const deleteCreatedSlideshowAsync = async (db, artistId, slideshowId) => {
  const result = deleteCreatedSlideshow(artistId, slideshowId);
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', slideshowId);
    await updateDoc(docRef, { deletedAt: serverTimestamp() });
    log('[Library] Soft-deleted slideshow:', slideshowId);
  } catch (error) {
    log.error('[Library] Failed to soft-delete slideshow from Firestore:', error);
  }
  return result;
};

/**
 * Soft-delete a created video in Firestore
 * Marks with deletedAt instead of deleting. Removes from localStorage for immediate UI update.
 */
export const softDeleteCreatedVideoAsync = async (db, artistId, videoId) => {
  const result = deleteCreatedVideo(artistId, videoId);
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', videoId);
    await updateDoc(docRef, { deletedAt: serverTimestamp() });
    log('[Library] Soft-deleted video:', videoId);
  } catch (error) {
    log.error('[Library] Failed to soft-delete video from Firestore:', error);
  }
  return result;
};

/**
 * Restore a soft-deleted content item from Firestore
 * Removes deletedAt field and re-adds to localStorage
 */
export const restoreCreatedContentAsync = async (db, artistId, itemId) => {
  if (!db || !artistId || !itemId) return false;
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', itemId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return false;

    // Remove deletedAt field
    await updateDoc(docRef, { deletedAt: null });

    // Re-add to localStorage
    const data = docSnap.data();
    const { deletedAt, ...cleanData } = data;
    const type = cleanData.type || (cleanData.clips ? 'video' : 'slideshow');
    const content = getCreatedContent(artistId);

    if (type === 'video') {
      if (!content.videos.find(v => v.id === itemId)) {
        content.videos.push({ ...cleanData, type: 'video' });
      }
    } else {
      if (!content.slideshows.find(s => s.id === itemId)) {
        content.slideshows.push({ ...cleanData, type: 'slideshow' });
      }
    }
    saveCreatedContent(artistId, content);
    log('[Library] Restored content:', itemId);
    return true;
  } catch (error) {
    log.error('[Library] Failed to restore content from Firestore:', error);
    return false;
  }
};

/**
 * Get all soft-deleted content from Firestore (trash)
 */
export const getDeletedContentAsync = async (db, artistId) => {
  if (!db || !artistId) return { videos: [], slideshows: [] };
  try {
    const collectionRef = collection(db, 'artists', artistId, 'library', 'data', 'createdContent');
    const snapshot = await getDocs(collectionRef);

    const videos = [];
    const slideshows = [];

    snapshot.docs.forEach(d => {
      const data = d.data();
      if (!data.deletedAt) return; // Only include deleted items
      const type = data.type || (data.clips ? 'video' : 'slideshow');
      if (type === 'video') {
        videos.push({ ...data, type: 'video' });
      } else {
        slideshows.push({ ...data, type: 'slideshow' });
      }
    });

    return { videos, slideshows };
  } catch (error) {
    log.error('[Library] Failed to load deleted content:', error);
    return { videos: [], slideshows: [] };
  }
};

/**
 * Permanently delete a content item from Firestore (empty from trash)
 */
export const permanentlyDeleteContentAsync = async (db, artistId, itemId) => {
  if (!db || !artistId || !itemId) return false;
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', itemId);
    await deleteDoc(docRef);
    log('[Library] Permanently deleted content:', itemId);
    return true;
  } catch (error) {
    log.error('[Library] Failed to permanently delete content:', error);
    return false;
  }
};

/**
 * Add multiple created slideshows at once (with single Firestore sync)
 * More efficient than calling addCreatedSlideshowAsync in a loop
 */
export const addCreatedSlideshowsBatchAsync = async (db, artistId, slideshowsData) => {
  // Save all to localStorage in one operation
  const results = addCreatedSlideshowsBatch(artistId, slideshowsData);

  // Then sync to Firestore once
  const content = getCreatedContent(artistId);
  try {
    await saveCreatedContentAsync(db, artistId, content);
  } catch (error) {
    log.error('[Library] Failed to sync batch slideshows to Firestore:', error);
    // Data still saved to localStorage, mark as unsynced
  }

  return results;
};

// ============================================================================
// SCHEDULING LINK HELPERS
// ============================================================================

/**
 * Mark a draft as scheduled by linking it to a scheduled post
 * @param {string} artistId
 * @param {string} contentId - Video or slideshow ID
 * @param {string} scheduledPostId - The scheduled post this content is linked to
 */
export const markContentScheduled = (artistId, contentId, scheduledPostId) => {
  const content = getCreatedContent(artistId);
  // Check videos
  const videoIdx = content.videos.findIndex(v => v.id === contentId);
  if (videoIdx >= 0) {
    content.videos[videoIdx] = { ...content.videos[videoIdx], scheduledPostId, updatedAt: new Date().toISOString() };
    saveCreatedContent(artistId, content);
    return true;
  }
  // Check slideshows
  const slideshowIdx = content.slideshows.findIndex(s => s.id === contentId);
  if (slideshowIdx >= 0) {
    content.slideshows[slideshowIdx] = { ...content.slideshows[slideshowIdx], scheduledPostId, updatedAt: new Date().toISOString() };
    saveCreatedContent(artistId, content);
    return true;
  }
  return false;
};

/**
 * Mark a draft as scheduled + sync to Firestore
 */
export const markContentScheduledAsync = async (db, artistId, contentId, scheduledPostId) => {
  const result = markContentScheduled(artistId, contentId, scheduledPostId);
  if (result && db) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', contentId);
      await updateDoc(docRef, { scheduledPostId, updatedAt: serverTimestamp() });
    } catch (error) {
      log.warn('[Library] Failed to sync scheduledPostId to Firestore:', error.message);
    }
  }
  return result;
};

/**
 * Clear the scheduling link from a draft
 * @param {string} artistId
 * @param {string} contentId - Video or slideshow ID
 */
export const unmarkContentScheduled = (artistId, contentId) => {
  return markContentScheduled(artistId, contentId, null);
};

/**
 * Clear the scheduling link from a draft + sync to Firestore
 */
export const unmarkContentScheduledAsync = async (db, artistId, contentId) => {
  return markContentScheduledAsync(db, artistId, contentId, null);
};

// ============================================================================
// LYRICS OPERATIONS
// ============================================================================

/**
 * Get all lyrics for an artist
 * @param {string} artistId
 * @returns {Object[]} Lyrics entries
 */
export const getLyrics = (artistId) => {
  try {
    const data = localStorage.getItem(getLyricsKey(artistId));
    return data ? JSON.parse(data) : [];
  } catch (error) {
    log.error('Error loading lyrics:', error);
    return [];
  }
};

/**
 * Save lyrics
 * @param {string} artistId
 * @param {Object[]} lyrics
 */
export const saveLyrics = (artistId, lyrics) => {
  try {
    localStorage.setItem(getLyricsKey(artistId), JSON.stringify(lyrics));
  } catch (error) {
    log.error('Error saving lyrics:', error);
  }
};

/**
 * Add lyrics entry
 * @param {string} artistId
 * @param {Object} lyricsData
 * @returns {Object} Created lyrics
 */
export const addLyrics = (artistId, lyricsData) => {
  const lyrics = getLyrics(artistId);
  const newLyrics = lyricsData.id ? lyricsData : createLyricsEntry(lyricsData);
  lyrics.push(newLyrics);
  saveLyrics(artistId, lyrics);
  return newLyrics;
};

/**
 * Update lyrics entry
 * @param {string} artistId
 * @param {string} lyricsId
 * @param {Object} updates
 * @returns {Object|null} Updated lyrics
 */
export const updateLyrics = (artistId, lyricsId, updates) => {
  const lyrics = getLyrics(artistId);
  const index = lyrics.findIndex(l => l.id === lyricsId);
  if (index === -1) return null;

  lyrics[index] = {
    ...lyrics[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveLyrics(artistId, lyrics);
  return lyrics[index];
};

/**
 * Delete lyrics entry
 * @param {string} artistId
 * @param {string} lyricsId
 * @returns {boolean} Success
 */
export const deleteLyrics = (artistId, lyricsId) => {
  const lyrics = getLyrics(artistId);
  const filtered = lyrics.filter(l => l.id !== lyricsId);
  if (filtered.length === lyrics.length) return false;

  saveLyrics(artistId, filtered);
  return true;
};

// ============================================================================
// LYRICS — FIRESTORE REAL-TIME SYNC
// ============================================================================

/**
 * Subscribe to lyrics in real-time via Firestore onSnapshot.
 * Falls back to localStorage if Firestore is empty or errors.
 *
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Function} callback - (lyrics[]) => void
 * @returns {Function} Unsubscribe function
 */
export const subscribeToLyrics = (db, artistId, callback) => {
  if (!db || !artistId) {
    log('[Lyrics] No db/artistId — falling back to localStorage');
    callback(getLyrics(artistId));
    return () => {};
  }

  const lyricsRef = collection(db, 'artists', artistId, 'library', 'data', 'lyrics');
  const q = query(lyricsRef, orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      log('[Lyrics] Real-time update:', items.length, 'items');

      // If Firestore empty, check localStorage fallback
      if (items.length === 0) {
        const local = getLyrics(artistId);
        if (local.length > 0) {
          log('[Lyrics] Firestore empty, using localStorage fallback:', local.length, 'items');
          // Migrate local lyrics to Firestore
          migrateLyricsToFirestore(db, artistId, local);
          callback(local);
          return;
        }
      }

      // Sync Firestore data back to localStorage as cache
      saveLyrics(artistId, items);
      callback(items);
    },
    (error) => {
      log.error('[Lyrics] Subscription error:', error);
      callback(getLyrics(artistId));
    }
  );
};

/**
 * Add lyrics entry (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Object} lyricsData
 * @returns {Promise<Object>} Created lyrics entry
 */
export const addLyricsAsync = async (db, artistId, lyricsData) => {
  const newEntry = lyricsData.id ? lyricsData : createLyricsEntry(lyricsData);

  // Save to localStorage immediately
  const local = addLyrics(artistId, newEntry);

  // Then persist to Firestore
  if (db && artistId) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', newEntry.id);
      await setDoc(docRef, {
        ...newEntry,
        updatedAt: serverTimestamp()
      });
      log('[Lyrics] Saved to Firestore:', newEntry.id);
    } catch (error) {
      log.error('[Lyrics] Firestore write failed:', error.message);
    }
  }

  return newEntry;
};

/**
 * Update lyrics entry (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} lyricsId
 * @param {Object} updates
 * @returns {Promise<Object|null>} Updated lyrics entry
 */
export const updateLyricsAsync = async (db, artistId, lyricsId, updates) => {
  // Update localStorage immediately
  const updated = updateLyrics(artistId, lyricsId, updates);

  // Then update Firestore
  if (db && artistId && updated) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyricsId);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
      log('[Lyrics] Updated in Firestore:', lyricsId);
    } catch (error) {
      log.error('[Lyrics] Firestore update failed:', error.message);
      // If doc doesn't exist yet, create it
      if (error.code === 'not-found' && updated) {
        try {
          const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyricsId);
          await setDoc(docRef, { ...updated, updatedAt: serverTimestamp() });
          log('[Lyrics] Created missing doc in Firestore:', lyricsId);
        } catch (e2) {
          log.error('[Lyrics] Firestore fallback create failed:', e2.message);
        }
      }
    }
  }

  return updated;
};

/**
 * Delete lyrics entry (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} lyricsId
 * @returns {Promise<boolean>} Success
 */
export const deleteLyricsAsync = async (db, artistId, lyricsId) => {
  // Delete from localStorage immediately
  const success = deleteLyrics(artistId, lyricsId);

  // Then delete from Firestore
  if (db && artistId) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyricsId);
      await deleteDoc(docRef);
      log('[Lyrics] Deleted from Firestore:', lyricsId);
    } catch (error) {
      log.error('[Lyrics] Firestore delete failed:', error.message);
    }
  }

  return success;
};

/**
 * Migrate localStorage lyrics to Firestore (one-time, idempotent)
 * Called automatically when subscribeToLyrics finds Firestore empty but localStorage has data.
 * @param {Object} db
 * @param {string} artistId
 * @param {Object[]} lyrics
 */
const migrateLyricsToFirestore = async (db, artistId, lyrics) => {
  if (!db || !artistId || !lyrics.length) return;

  try {
    const batch = writeBatch(db);
    lyrics.forEach(lyric => {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyric.id);
      batch.set(docRef, { ...lyric, updatedAt: serverTimestamp() });
    });
    await batch.commit();
    log('[Lyrics] Migrated', lyrics.length, 'entries from localStorage to Firestore');
  } catch (error) {
    log.error('[Lyrics] Migration failed:', error.message);
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
  const template = STARTER_TEMPLATES[Object.keys(STARTER_TEMPLATES).find(
    key => STARTER_TEMPLATES[key].id === templateId
  )];

  if (template && template.collections.length > 0) {
    // Create collections from template
    const collections = getUserCollections(artistId);
    const newCols = [];
    template.collections.forEach(col => {
      const newCol = createCollection({
        name: col.name,
        description: col.description,
        type: COLLECTION_TYPES.TEMPLATE
      });
      collections.push(newCol);
      newCols.push(newCol);
    });
    saveCollections(artistId, collections);
    if (db) newCols.forEach(col => saveCollectionToFirestore(db, artistId, col).catch(log.error));
  }

  // Mark onboarding complete
  localStorage.setItem(getOnboardingKey(artistId), JSON.stringify({
    completed: true,
    templateId,
    completedAt: new Date().toISOString()
  }));
};

/**
 * Skip onboarding
 * @param {string} artistId
 */
export const skipOnboarding = (artistId) => {
  localStorage.setItem(getOnboardingKey(artistId), JSON.stringify({
    completed: true,
    templateId: null,
    skipped: true,
    completedAt: new Date().toISOString()
  }));
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
    results = results.filter(item =>
      item.name.toLowerCase().includes(lowerQuery) ||
      item.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  // Type filter
  if (filters.type) {
    results = results.filter(item => item.type === filters.type);
  }

  // Collection filter
  if (filters.collectionId) {
    if (filters.collectionId.startsWith('smart_')) {
      results = resolveSmartCollection(results, filters.collectionId);
    } else {
      results = results.filter(item =>
        item.collectionIds?.includes(filters.collectionId)
      );
    }
  }

  // Favorites filter
  if (filters.favoritesOnly) {
    results = results.filter(item => item.isFavorite);
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
      const snapshot = await getDocs(mediaRef);
      if (!snapshot.empty) {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

  return onSnapshot(
    mediaRef,
    (snapshot) => {
      const firestoreItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const localItems = getLibrary(artistId);

      // Merge: start with localStorage items, overlay Firestore items (Firestore wins per-item).
      // This prevents data loss when Firestore has fewer items than localStorage
      // (e.g., writes that haven't synced yet, or items added before Firestore sync existed).
      const merged = new Map();
      for (const item of localItems) merged.set(item.id, item);
      for (const item of firestoreItems) merged.set(item.id, item);
      const result = [...merged.values()];

      log('[Library] Real-time merge:', firestoreItems.length, 'Firestore +', localItems.length, 'local →', result.length, 'merged');

      // Save merged result to localStorage so future reads are consistent
      if (result.length > localItems.length) {
        try { saveLibrary(artistId, result); } catch (_) { /* best-effort */ }
      }

      callback(result);
    },
    (error) => {
      log.error('[Library] Subscription error:', error);
      // Fallback to localStorage on error
      callback(getLibrary(artistId));
    }
  );
};

/**
 * Add item to library (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Object} mediaItem
 * @returns {Promise<Object>} Added item
 */
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
      await setDoc(docRef, {
        ...newItem,
        updatedAt: serverTimestamp()
      });
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
  const newItems = mediaItems.map(item => item.id ? item : createMediaItem(item));

  // Always save to localStorage first
  const localResult = addManyToLibrary(artistId, newItems);

  // Then batch save to Firestore (split into chunks of 500 to avoid batch size limit)
  if (db && artistId && newItems.length > 0) {
    try {
      for (let i = 0; i < newItems.length; i += 500) {
        const chunk = newItems.slice(i, i + 500);
        const batch = writeBatch(db);

        chunk.forEach(item => {
          const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', item.id);
          batch.set(docRef, {
            ...item,
            updatedAt: serverTimestamp()
          });
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

  // Then update Firestore
  if (db && artistId && localResult) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', mediaId);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
      log('[Library] Updated in Firestore:', mediaId);
    } catch (error) {
      log.error('[Library] Firestore update failed:', error.message);
    }
  }

  return localResult;
};

/**
 * Remove item from library (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} mediaId
 * @returns {Promise<boolean>} Success
 */
export const removeFromLibraryAsync = async (db, artistId, mediaId) => {
  // Remove from localStorage first
  const localResult = removeFromLibrary(artistId, mediaId);

  // Then remove from Firestore
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
      const snapshot = await getDocs(collectionsRef);
      if (!snapshot.empty) {
        const userCollections = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Merge localStorage bankA/bankB onto Firestore results
        // (banks are saved to localStorage by assignToBank and may not yet be in Firestore)
        const localCollections = getUserCollections(artistId);
        const mergedCollections = userCollections.map(col => {
          const localCol = localCollections.find(lc => lc.id === col.id);
          if (localCol) {
            return {
              ...col,
              bankA: localCol.bankA || col.bankA || [],
              bankB: localCol.bankB || col.bankB || [],
              bankC: localCol.bankC || col.bankC || [],
              bankD: localCol.bankD || col.bankD || [],
              textBank1: localCol.textBank1 || col.textBank1 || [],
              textBank2: localCol.textBank2 || col.textBank2 || [],
              textBank3: localCol.textBank3 || col.textBank3 || [],
              textBank4: localCol.textBank4 || col.textBank4 || [],
              videoTextBank1: localCol.videoTextBank1 || col.videoTextBank1 || [],
              videoTextBank2: localCol.videoTextBank2 || col.videoTextBank2 || [],
              textTemplates: localCol.textTemplates || col.textTemplates || [],
            };
          }
          return col;
        });
        // Always include smart collections (computed client-side)
        const smartCollections = createSmartCollections();
        log('[Library] Collections from Firestore:', mergedCollections.length, '(with localStorage bank merge)');
        return [...smartCollections, ...mergedCollections];
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

  return onSnapshot(
    collectionsRef,
    (snapshot) => {
      const rawFirestoreCollections = snapshot.docs.map(doc => {
        const data = doc.data();
        // Deserialize banks/textBanks (stored as JSON strings to avoid Firestore nested array restriction)
        if (typeof data.banks === 'string') try { data.banks = JSON.parse(data.banks); } catch { data.banks = []; }
        if (typeof data.textBanks === 'string') try { data.textBanks = JSON.parse(data.textBanks); } catch { data.textBanks = []; }
        if (typeof data.clipperSessions === 'string') try { data.clipperSessions = JSON.parse(data.clipperSessions); } catch { data.clipperSessions = []; }
        if (typeof data.mediaBanks === 'string') try { data.mediaBanks = JSON.parse(data.mediaBanks); } catch { data.mediaBanks = null; }
        return { id: doc.id, ...data };
      });

      // Deduplicate project roots by normalized name (migration may have created duplicates)
      // NOTE: Only dedup project roots by name. Niches are NOT deduped by name because
      // multiple niches can legitimately share the same name (e.g., two "Montage" niches
      // in different projects). Deduping niches by name causes data loss.
      const seenProjectNames = new Set();
      const firestoreCollections = rawFirestoreCollections.filter(col => {
        if (col.isProjectRoot) {
          const key = (col.name || col.id).replace(/^@+/, '');
          if (seenProjectNames.has(key)) return false;
          seenProjectNames.add(key);
        }
        return true;
      });

      if (firestoreCollections.length > 0) {
        // Merge localStorage bank data onto Firestore results
        // Banks (bankA, bankB, textBank1, textBank2, textTemplates) may only exist in
        // localStorage if they haven't been synced to Firestore yet
        const localCollections = getUserCollections(artistId);
        const mergedCollections = firestoreCollections.map(col => {
          const localCol = localCollections.find(lc => lc.id === col.id);
          if (localCol) {
            // Migrate both sources to new format, then merge
            const migratedCol = migrateCollectionBanks(col);
            const migratedLocal = migrateCollectionBanks(localCol);
            // Merge banks: union Firestore + local to prevent race condition data loss
            const mergedBanks = (migratedCol.banks || []).map((fsBank, i) => {
              const localBank = (migratedLocal.banks || [])[i] || [];
              return [...new Set([...(fsBank || []), ...localBank])];
            });
            // If local has more banks than Firestore, append them
            if ((migratedLocal.banks || []).length > mergedBanks.length) {
              for (let i = mergedBanks.length; i < migratedLocal.banks.length; i++) {
                mergedBanks.push(migratedLocal.banks[i] || []);
              }
            }
            const mergedTextBanks = (migratedCol.textBanks || []).map((fsBank, i) => {
              const localBank = (migratedLocal.textBanks || [])[i] || [];
              return (fsBank?.length > 0 ? fsBank : localBank);
            });
            if ((migratedLocal.textBanks || []).length > mergedTextBanks.length) {
              for (let i = mergedTextBanks.length; i < migratedLocal.textBanks.length; i++) {
                mergedTextBanks.push(migratedLocal.textBanks[i] || []);
              }
            }
            return {
              ...col,
              // Preserve project fields from localStorage if Firestore hasn't caught up yet
              ...(localCol.projectId && !col.projectId ? { projectId: localCol.projectId } : {}),
              ...(localCol.isProjectRoot && !col.isProjectRoot ? { isProjectRoot: localCol.isProjectRoot, projectColor: localCol.projectColor, linkedPage: localCol.linkedPage } : {}),
              banks: mergedBanks,
              textBanks: mergedTextBanks,
              captionBank: col.captionBank || localCol.captionBank || [],
              hashtagBank: col.hashtagBank || localCol.hashtagBank || [],
              videoTextBank1: (col.videoTextBank1?.length > 0 ? col.videoTextBank1 : localCol.videoTextBank1) || [],
              videoTextBank2: (col.videoTextBank2?.length > 0 ? col.videoTextBank2 : localCol.videoTextBank2) || [],
              textTemplates: (col.textTemplates?.length > 0 ? col.textTemplates : localCol.textTemplates) || [],
              mediaIds: (() => {
                let ids = [...new Set([...(col.mediaIds || []), ...(localCol.mediaIds || [])])];
                const removed = recentCollectionRemovals.get(col.id)?.removedIds;
                if (removed?.size > 0) ids = ids.filter(id => !removed.has(id));
                return ids;
              })(),
            };
          }
          return migrateCollectionBanks(col);
        });

        // Include localStorage-only collections not yet in Firestore (in-flight writes)
        // Also dedup by name for project roots to prevent migration dupes from re-appearing
        const firestoreIds = new Set(firestoreCollections.map(c => c.id));
        const mergedNames = new Set(mergedCollections.filter(c => c.isProjectRoot).map(c => (c.name || '').replace(/^@+/, '')));
        const localOnlyCollections = localCollections.filter(lc => {
          if (firestoreIds.has(lc.id)) return false;
          // Dedup project roots by normalized name
          if (lc.isProjectRoot) {
            const normName = (lc.name || '').replace(/^@+/, '');
            if (mergedNames.has(normName)) return false;
            mergedNames.add(normName);
          }
          return true;
        });
        let allMerged = [...mergedCollections, ...localOnlyCollections]
          .filter(c => !pendingDeletionIds.has(c.id));

        // SAFETY GUARD: Never lose collections during merge.
        // If a collection exists in localStorage but NOT in the merge result
        // (and isn't pending deletion), preserve it to prevent data loss.
        const mergedIds = new Set(allMerged.map(c => c.id));
        const lostCollections = localCollections.filter(lc =>
          !mergedIds.has(lc.id) && !pendingDeletionIds.has(lc.id)
        );
        if (lostCollections.length > 0) {
          log.warn('[Collections] Subscription merge would lose', lostCollections.length,
            'collections, preserving:', lostCollections.map(c => `${c.name}(${c.id})`));
          allMerged = [...allMerged, ...lostCollections];
        }

        // SAFETY GUARD: Never reduce a collection's mediaIds count during merge
        // UNLESS the reduction is from an intentional removal (tracked in recentCollectionRemovals).
        for (const merged of allMerged) {
          const local = localCollections.find(lc => lc.id === merged.id);
          if (local && local.mediaIds?.length > 0 && (!merged.mediaIds || merged.mediaIds.length < local.mediaIds.length)) {
            const removed = recentCollectionRemovals.get(merged.id)?.removedIds;
            if (removed?.size > 0) {
              // Intentional removal — don't re-add removed items
              continue;
            }
            const union = [...new Set([...(merged.mediaIds || []), ...local.mediaIds])];
            if (union.length > merged.mediaIds?.length) {
              log.warn('[Collections] Subscription merge would reduce mediaIds for',
                merged.name, 'from', local.mediaIds.length, 'to', merged.mediaIds?.length,
                '- preserving union of', union.length);
              merged.mediaIds = union;
            }
          }
        }

        // Log merge results for debugging
        const pipelines = allMerged.filter(c => c.isPipeline);
        log('[subscribeToCollections] Merge result:', pipelines.length, 'niches →',
          pipelines.map(c => `${c.name}(${c.mediaIds?.length || 0}media)`).join(', '));

        // Save merged data to localStorage for offline access
        try {
          localStorage.setItem(getCollectionsKey(artistId), JSON.stringify(allMerged));
        } catch (e) {}

        const smartCollections = createSmartCollections();
        callback([...smartCollections, ...allMerged]);
      } else {
        // Firestore empty — check localStorage and upload if data exists
        const localCollections = getCollections(artistId);
        const userCollections = localCollections.filter(c => c.type !== 'smart' && !c.id?.startsWith('smart_'));

        if (userCollections.length > 0) {
          // Upload local collections to Firestore (including banks)
          userCollections.forEach(col => {
            const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', col.id);
            setDoc(docRef, { ...col, updatedAt: serverTimestamp() }).catch(log.error);
          });
        }

        callback(localCollections);
      }
    },
    (error) => {
      log.error('[Collections] Firestore subscription error:', error);
      callback(getCollections(artistId));
    }
  );
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
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', collectionData.id);
    // Firestore doesn't support nested arrays. Serialize banks/textBanks as JSON strings.
    const data = { ...collectionData, updatedAt: serverTimestamp() };
    if (Array.isArray(data.banks)) data.banks = JSON.stringify(data.banks);
    if (Array.isArray(data.textBanks)) data.textBanks = JSON.stringify(data.textBanks);
    if (Array.isArray(data.clipperSessions)) data.clipperSessions = JSON.stringify(data.clipperSessions);
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
    const col = collections.find(c => c.id === collectionId);
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
    const col = collections.find(c => c.id === collectionId);
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
    const col = collections.find(c => c.id === collectionId);
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
  // Delete from localStorage
  const result = deleteCollection(artistId, collectionId);

  // Delete from Firestore
  let syncedToCloud = false;
  if (db && artistId && result) {
    syncedToCloud = await deleteCollectionFromFirestore(db, artistId, collectionId);
  }

  return { success: !!result, syncedToCloud };
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
        updatedAt: serverTimestamp()
      });
      log('[Library] Collection saved to Firestore:', localResult.id);
    } catch (error) {
      log.error('[Library] Firestore collection write failed:', error.message);
    }
  }

  return localResult;
};

/**
 * Get onboarding status from Firestore with localStorage fallback
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @returns {Promise<Object>} Onboarding status
 */
export const getOnboardingStatusAsync = async (db, artistId) => {
  if (db && artistId) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'onboarding');
      const snapshot = await getDoc(docRef);
      if (snapshot.exists()) {
        log('[Library] Onboarding status from Firestore');
        return snapshot.data();
      }
    } catch (error) {
      log.warn('[Library] Firestore onboarding read failed:', error.message);
    }
  }
  return getOnboardingStatus(artistId);
};

/**
 * Complete onboarding (Firestore + localStorage)
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} templateId
 */
export const completeOnboardingAsync = async (db, artistId, templateId) => {
  // Complete in localStorage first
  completeOnboarding(artistId, templateId);

  // Then save to Firestore
  if (db && artistId) {
    try {
      const docRef = doc(db, 'artists', artistId, 'library', 'onboarding');
      await setDoc(docRef, {
        completed: true,
        templateId,
        completedAt: serverTimestamp()
      });
      log('[Library] Onboarding saved to Firestore');

      // Also save the template collections to Firestore
      const template = STARTER_TEMPLATES[Object.keys(STARTER_TEMPLATES).find(
        key => STARTER_TEMPLATES[key].id === templateId
      )];

      if (template && template.collections.length > 0) {
        const batch = writeBatch(db);
        template.collections.forEach(col => {
          const newCollection = createCollection({
            name: col.name,
            description: col.description,
            type: COLLECTION_TYPES.TEMPLATE
          });
          const colRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', newCollection.id);
          batch.set(colRef, newCollection);
        });
        await batch.commit();
        log('[Library] Template collections saved to Firestore');
      }
    } catch (error) {
      log.error('[Library] Firestore onboarding write failed:', error.message);
    }
  }
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

  const result = {
    success: true,
    migrated: {
      mediaItems: 0,
      collections: 0,
      createdContent: 0,
      lyrics: 0,
      onboarding: false
    },
    errors: []
  };

  try {
    // Migrate media items
    const library = getLibrary(artistId);
    if (library.length > 0) {
      const batch = writeBatch(db);
      library.forEach(item => {
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
      collections.forEach(col => {
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
      createdContent.videos.forEach(video => {
        const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', video.id);
        batch.set(docRef, video);
      });
      createdContent.slideshows.forEach(slideshow => {
        const docRef = doc(db, 'artists', artistId, 'library', 'data', 'createdContent', slideshow.id);
        batch.set(docRef, slideshow);
      });
      await batch.commit();
      result.migrated.createdContent = createdContent.videos.length + createdContent.slideshows.length;
      log('[Migration] Migrated created content:', result.migrated.createdContent);
    }

    // Migrate lyrics
    const lyrics = getLyrics(artistId);
    if (lyrics.length > 0) {
      const batch = writeBatch(db);
      lyrics.forEach(lyric => {
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

  return result;
};

// ============================================================================
// THUMBNAIL MIGRATION — backfill thumbnails for existing images
// ============================================================================

/**
 * Load an image from a URL, handling CORS gracefully.
 * Tries fetch-as-blob first (CORS-safe for canvas), then falls back
 * to Image element with crossOrigin attribute.
 */
const loadImageForCanvas = (url) => {
  return new Promise(async (resolve, reject) => {
    // Attempt 1: fetch as blob (avoids CORS canvas tainting)
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { resolve({ img, cleanup: () => URL.revokeObjectURL(blobUrl) }); };
        img.onerror = () => { URL.revokeObjectURL(blobUrl); tryImgDirect(); };
        img.src = blobUrl;
        return;
      }
    } catch (e) { /* fetch failed, try fallback */ }

    // Attempt 2: load Image with crossOrigin
    tryImgDirect();
    function tryImgDirect() {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ img, cleanup: () => {} });
      img.onerror = () => reject(new Error('Could not load image (CORS)'));
      img.src = url;
    }
  });
};

/**
 * Generate thumbnails for images in the library.
 * Processes all images (re-generates if thumbnail already exists).
 * Runs in the background, one image at a time.
 * @param {Object|null} db - Firestore instance (optional)
 * @param {string} artistId
 * @param {Array} libraryItems - current library array from state
 * @param {Function} uploadFileFn - uploadFile from firebaseStorage
 * @param {Function} onProgress - callback(done, total, generated)
 * @returns {Promise<{generated: number, failed: number}>}
 */
export const THUMB_VERSION = 3; // v1 = 50px/20%, v2 = 200px/40%, v3 = 400px/65%
export const THUMB_MAX_SIZE = 400;
export const THUMB_QUALITY = 0.65;

export const migrateThumbnails = async (db, artistId, libraryItems, uploadFileFn, onProgress) => {
  const images = (libraryItems || []).filter(item =>
    item.type === MEDIA_TYPES.IMAGE && item.url && (!item.thumbnailUrl || item.thumbVersion !== THUMB_VERSION)
  );

  if (images.length === 0) return { generated: 0, failed: 0 };

  log(`[ThumbnailMigration] Starting — ${images.length} images need thumbnails (v${THUMB_VERSION})`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    try {
      const { img, cleanup } = await loadImageForCanvas(item.url);

      const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      cleanup();

      const thumbBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY));
      if (!thumbBlob) throw new Error('Canvas toBlob returned null');

      const thumbFile = new File([thumbBlob], `thumb_${item.name}`, { type: 'image/jpeg' });
      const { url: thumbnailUrl } = await uploadFileFn(thumbFile, 'thumbnails');

      await updateLibraryItemAsync(db, artistId, item.id, { thumbnailUrl, thumbVersion: THUMB_VERSION });

      generated++;
      if (generated % 20 === 0) log(`[ThumbnailMigration] ${generated}/${images.length} done`);
    } catch (err) {
      failed++;
      log.warn(`[ThumbnailMigration] ✗ ${item.name}:`, err.message);
    }

    if (onProgress) onProgress(i + 1, images.length, generated);
  }

  log(`[ThumbnailMigration] Complete: ${generated} generated, ${failed} failed`);
  return { generated, failed };
};

/**
 * Background-migrate video thumbnails for existing video items that lack thumbnailUrl.
 * Seeks to 1s (or 25% of duration) and captures a frame as JPEG.
 * @param {Object|null} db - Firestore instance (optional)
 * @param {string} artistId
 * @param {Array} libraryItems - current library array from state
 * @param {Function} uploadFileFn - uploadFile from firebaseStorage
 * @param {Function} onProgress - callback(done, total, generated)
 * @returns {Promise<{generated: number, failed: number}>}
 */
export const migrateVideoThumbnails = async (db, artistId, libraryItems, uploadFileFn, onProgress) => {
  const videos = (libraryItems || []).filter(item =>
    item.type === MEDIA_TYPES.VIDEO && item.url && (!item.thumbnailUrl || item.thumbVersion !== THUMB_VERSION)
  );

  if (videos.length === 0) return { generated: 0, failed: 0 };

  log(`[VideoThumbMigration] Starting — ${videos.length} videos need thumbnails`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < videos.length; i++) {
    const item = videos[i];
    try {
      // Load video and seek to a representative frame
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'auto';

      // Try fetch-as-blob first for CORS safety (same pattern as image migration)
      let videoUrl = item.url;
      try {
        const response = await fetch(item.url, { mode: 'cors' });
        const blob = await response.blob();
        videoUrl = URL.createObjectURL(blob);
      } catch (fetchErr) {
        // Fallback to direct URL
      }

      video.src = videoUrl;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
        setTimeout(resolve, 8000); // 8s timeout
      });

      // Seek to 1s or 25% of duration
      const seekTime = Math.min(1, (video.duration || 2) * 0.25);
      video.currentTime = seekTime;
      await new Promise((resolve) => {
        video.onseeked = resolve;
        setTimeout(resolve, 3000); // 3s seek timeout
      });

      // Draw frame to canvas
      const maxSize = 400;
      const vw = video.videoWidth || 320;
      const vh = video.videoHeight || 180;
      const scale = Math.min(1, maxSize / Math.max(vw, vh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Clean up blob URL if we created one
      if (videoUrl !== item.url) URL.revokeObjectURL(videoUrl);

      // Convert to JPEG
      const thumbBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
      if (!thumbBlob) throw new Error('Canvas toBlob returned null');

      // Upload
      const thumbFile = new File([thumbBlob], `thumb_${item.name}.jpg`, { type: 'image/jpeg' });
      const { url: thumbnailUrl } = await uploadFileFn(thumbFile, 'thumbnails');

      // Update record
      await updateLibraryItemAsync(db, artistId, item.id, { thumbnailUrl, thumbVersion: THUMB_VERSION });

      generated++;
      log(`[VideoThumbMigration] ✓ ${i + 1}/${videos.length} — ${item.name}`);
    } catch (err) {
      failed++;
      log.warn(`[VideoThumbMigration] ✗ ${i + 1}/${videos.length} — ${item.name}:`, err.message);
    }

    if (onProgress) onProgress(i + 1, videos.length, generated);
  }

  log(`[VideoThumbMigration] Complete: ${generated} generated, ${failed} failed`);
  return { generated, failed };
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
  createCreatedVideo,
  createCreatedSlideshow,
  createLyricsEntry,

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

  // Created Content
  getCreatedContent,
  saveCreatedContent,
  subscribeToCreatedContent,
  addCreatedVideo,
  updateCreatedVideo,
  deleteCreatedVideo,
  addCreatedSlideshow,
  updateCreatedSlideshow,
  deleteCreatedSlideshow,

  // Lyrics
  getLyrics,
  saveLyrics,
  addLyrics,
  updateLyrics,
  deleteLyrics,

  // Onboarding (localStorage)
  getOnboardingStatus,
  completeOnboarding,
  skipOnboarding,

  // Onboarding (Firestore async)
  getOnboardingStatusAsync,
  completeOnboardingAsync,

  // Search
  searchLibrary,

  // Migration
  migrateToFirestore,
  migrateThumbnails,
  migrateVideoThumbnails
};
