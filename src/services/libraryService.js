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
    console.error('Error loading library:', error);
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
      console.warn('[Library] localStorage quota exceeded, attempting cleanup...');
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
        console.error('[Library] Save failed even after cleanup. Storage is full:', retryError.message);
      }
    } else {
      console.error('Error saving library:', error);
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
export const removeFromLibrary = (artistId, mediaId) => {
  const library = getLibrary(artistId);
  const filtered = library.filter(item => item.id !== mediaId);
  if (filtered.length === library.length) return false;

  saveLibrary(artistId, filtered);

  // Also remove from all collections
  const collections = getCollections(artistId);
  collections.forEach(collection => {
    if (collection.mediaIds?.includes(mediaId)) {
      collection.mediaIds = collection.mediaIds.filter(id => id !== mediaId);
    }
  });
  saveCollections(artistId, collections);

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
    console.error('Error loading collections:', error);
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
    console.error('Error loading user collections:', error);
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
    localStorage.setItem(getCollectionsKey(artistId), JSON.stringify(userCollections));
  } catch (error) {
    console.error('Error saving collections:', error);
  }
};

/**
 * Create a new collection
 * @param {string} artistId
 * @param {Object} collectionData
 * @returns {Object} Created collection
 */
export const createNewCollection = (artistId, collectionData) => {
  const collections = getUserCollections(artistId);
  const newCollection = createCollection(collectionData);
  collections.push(newCollection);
  saveCollections(artistId, collections);
  return newCollection;
};

/**
 * Update a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {Object} updates
 * @returns {Object|null} Updated collection
 */
export const updateCollection = (artistId, collectionId, updates) => {
  const collections = getUserCollections(artistId);
  const index = collections.findIndex(c => c.id === collectionId);
  if (index === -1) return null;

  collections[index] = {
    ...collections[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveCollections(artistId, collections);
  return collections[index];
};

/**
 * Delete a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {boolean} Success
 */
export const deleteCollection = (artistId, collectionId) => {
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
  return true;
};

/**
 * Add media to a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 */
export const addToCollection = (artistId, collectionId, mediaIds) => {
  const idsToAdd = Array.isArray(mediaIds) ? mediaIds : [mediaIds];

  // Update collection's mediaIds
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (collection) {
    collection.mediaIds = [...new Set([...collection.mediaIds, ...idsToAdd])];
    collection.updatedAt = new Date().toISOString();
    saveCollections(artistId, collections);
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

  return { ...collection, banks, textBanks };
};

/**
 * Add a new slide bank to a collection (both image + text)
 */
export const addBankToCollection = (artistId, collectionId) => {
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
};

/**
 * Remove a slide bank from a collection (must keep minimum 2)
 */
export const removeBankFromCollection = (artistId, collectionId, bankIndex) => {
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
};

/**
 * Assign media to a slide bank within a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 * @param {number|string} bank - 0-based index OR legacy letter ('A','B','C','D')
 */
export const assignToBank = (artistId, collectionId, mediaIds, bank) => {
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
export const removeFromBank = (artistId, collectionId, mediaIds) => {
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
};

/**
 * Add text to a text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1-based slide position (1 = Slide 1, etc.)
 * @param {string} text
 */
export const addToTextBank = (artistId, collectionId, bankNum, text) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  const idx = bankNum - 1; // Convert to 0-based
  while (collection.textBanks.length <= idx) collection.textBanks.push([]);
  collection.textBanks[idx] = [...collection.textBanks[idx], text];
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Remove text from a text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1-based slide position
 * @param {number} index
 */
export const removeFromTextBank = (artistId, collectionId, bankNum, index) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  const idx = bankNum - 1;
  if (collection.textBanks[idx]) {
    collection.textBanks[idx] = collection.textBanks[idx].filter((_, i) => i !== index);
  }
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Update entire text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1-based slide position
 * @param {string[]} texts
 */
export const updateTextBank = (artistId, collectionId, bankNum, texts) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const migrated = migrateCollectionBanks(collection);
  Object.assign(collection, migrated);
  const idx = bankNum - 1;
  while (collection.textBanks.length <= idx) collection.textBanks.push([]);
  collection.textBanks[idx] = texts;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Add text to a video text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {string} text
 */
export const addToVideoTextBank = (artistId, collectionId, bankNum, text) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const key = `videoTextBank${bankNum}`;
  collection[key] = [...(collection[key] || []), text];
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Remove text from a video text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {number} index
 */
export const removeFromVideoTextBank = (artistId, collectionId, bankNum, index) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const key = `videoTextBank${bankNum}`;
  collection[key] = (collection[key] || []).filter((_, i) => i !== index);
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Update entire video text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {string[]} texts
 */
export const updateVideoTextBank = (artistId, collectionId, bankNum, texts) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  collection[`videoTextBank${bankNum}`] = texts;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Save text style templates for a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {Object[]} templates
 */
export const saveTextTemplates = (artistId, collectionId, templates) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  collection.textTemplates = templates;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
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
export const updateCollectionCaptionBank = (artistId, collectionId, captionBank) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  collection.captionBank = captionBank;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Update a collection's hashtag bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {{ always: string[], pool: string[] }} hashtagBank
 */
export const updateCollectionHashtagBank = (artistId, collectionId, hashtagBank) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  collection.hashtagBank = hashtagBank;
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Remove media from a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 */
export const removeFromCollection = (artistId, collectionId, mediaIds) => {
  const idsToRemove = Array.isArray(mediaIds) ? mediaIds : [mediaIds];

  // Update collection's mediaIds
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (collection) {
    collection.mediaIds = collection.mediaIds.filter(id => !idsToRemove.includes(id));
    collection.updatedAt = new Date().toISOString();
    saveCollections(artistId, collections);
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
    console.error('Error loading created content:', error);
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
    localStorage.setItem(getCreatedContentKey(artistId), JSON.stringify(content));
  } catch (error) {
    console.error('Error saving created content:', error);
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
  const newVideo = videoData.id ? videoData : createCreatedVideo(videoData);
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
  const newSlideshow = slideshowData.id ? slideshowData : createCreatedSlideshow(slideshowData);
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
  return true;
};

// ============================================================================
// CREATED CONTENT - FIRESTORE ASYNC OPERATIONS
// ============================================================================

/**
 * Save created content to Firestore (async backup)
 * Stores slideshows and videos in artists/{artistId}/studio/createdContent
 */
export const saveCreatedContentAsync = async (db, artistId, content) => {
  if (!db || !artistId) return;
  try {
    const docRef = doc(db, 'artists', artistId, 'studio', 'createdContent');
    await setDoc(docRef, {
      ...content,
      updatedAt: serverTimestamp()
    });
    log('[Library] Created content saved to Firestore');
  } catch (error) {
    console.error('[Library] Firestore save created content failed:', error.message);
  }
};

/**
 * Load created content from Firestore
 * Falls back to localStorage if Firestore is unavailable
 */
export const loadCreatedContentAsync = async (db, artistId) => {
  if (!db || !artistId) return getCreatedContent(artistId);
  try {
    const docRef = doc(db, 'artists', artistId, 'studio', 'createdContent');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      const content = {
        videos: data.videos || [],
        slideshows: data.slideshows || []
      };
      // Also update localStorage for offline access
      saveCreatedContent(artistId, content);
      return content;
    }
  } catch (error) {
    console.error('[Library] Firestore load created content failed:', error.message);
  }
  // Fallback to localStorage
  return getCreatedContent(artistId);
};

/**
 * Add a created slideshow (with Firestore sync)
 */
export const addCreatedSlideshowAsync = async (db, artistId, slideshowData) => {
  const result = addCreatedSlideshow(artistId, slideshowData);
  const content = getCreatedContent(artistId);
  await saveCreatedContentAsync(db, artistId, content);
  return result;
};

/**
 * Update a created slideshow (with Firestore sync)
 */
export const updateCreatedSlideshowAsync = async (db, artistId, slideshowId, updates) => {
  const result = updateCreatedSlideshow(artistId, slideshowId, updates);
  const content = getCreatedContent(artistId);
  await saveCreatedContentAsync(db, artistId, content);
  return result;
};

/**
 * Delete a created slideshow (with Firestore sync)
 */
export const deleteCreatedSlideshowAsync = async (db, artistId, slideshowId) => {
  const result = deleteCreatedSlideshow(artistId, slideshowId);
  const content = getCreatedContent(artistId);
  await saveCreatedContentAsync(db, artistId, content);
  return result;
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
    console.error('Error loading lyrics:', error);
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
    console.error('Error saving lyrics:', error);
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
      console.error('[Lyrics] Subscription error:', error);
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
      console.error('[Lyrics] Firestore write failed:', error.message);
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
      console.error('[Lyrics] Firestore update failed:', error.message);
      // If doc doesn't exist yet, create it
      if (error.code === 'not-found' && updated) {
        try {
          const docRef = doc(db, 'artists', artistId, 'library', 'data', 'lyrics', lyricsId);
          await setDoc(docRef, { ...updated, updatedAt: serverTimestamp() });
          log('[Lyrics] Created missing doc in Firestore:', lyricsId);
        } catch (e2) {
          console.error('[Lyrics] Firestore fallback create failed:', e2.message);
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
      console.error('[Lyrics] Firestore delete failed:', error.message);
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
    console.error('[Lyrics] Migration failed:', error.message);
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
    console.error('Error loading onboarding status:', error);
    return { completed: false, templateId: null };
  }
};

/**
 * Complete onboarding with a template
 * @param {string} artistId
 * @param {string} templateId
 */
export const completeOnboarding = (artistId, templateId) => {
  const template = STARTER_TEMPLATES[Object.keys(STARTER_TEMPLATES).find(
    key => STARTER_TEMPLATES[key].id === templateId
  )];

  if (template && template.collections.length > 0) {
    // Create collections from template
    const collections = getUserCollections(artistId);
    template.collections.forEach(col => {
      collections.push(createCollection({
        name: col.name,
        description: col.description,
        type: COLLECTION_TYPES.TEMPLATE
      }));
    });
    saveCollections(artistId, collections);
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
      console.warn('[Library] Firestore read failed, using localStorage:', error.message);
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
    console.warn('[Library] Cannot subscribe: missing db or artistId');
    // Return localStorage data immediately and a no-op unsubscribe
    callback(getLibrary(artistId));
    return () => {};
  }

  const mediaRef = collection(db, 'artists', artistId, 'library', 'data', 'mediaItems');

  return onSnapshot(
    mediaRef,
    (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      log('[Library] Real-time update:', items.length, 'items');

      // If Firestore returns empty, check localStorage as fallback
      // This handles the case where Firestore writes failed but localStorage has data
      if (items.length === 0) {
        const localItems = getLibrary(artistId);
        if (localItems.length > 0) {
          log('[Library] Firestore empty, using localStorage fallback:', localItems.length, 'items');
          callback(localItems);
          return;
        }
      }

      callback(items);
    },
    (error) => {
      console.error('[Library] Subscription error:', error);
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
    console.error('[Library] Audio item rejected — invalid duration:', newItem.duration);
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
      console.error('[Library] Firestore write failed:', error.message);
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

  // Then batch save to Firestore
  if (db && artistId && newItems.length > 0) {
    try {
      const batch = writeBatch(db);

      newItems.forEach(item => {
        const docRef = doc(db, 'artists', artistId, 'library', 'data', 'mediaItems', item.id);
        batch.set(docRef, {
          ...item,
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
      log('[Library] Batch saved to Firestore:', newItems.length, 'items');
      localResult.syncedToCloud = true;
    } catch (error) {
      console.error('[Library] Firestore batch write failed:', error.message);
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
      console.error('[Library] Firestore update failed:', error.message);
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
      console.error('[Library] Firestore delete failed:', error.message);
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
      console.warn('[Library] Firestore collections read failed:', error.message);
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
      const rawFirestoreCollections = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Deduplicate by name (migration may have created duplicate entries)
      const seenNames = new Set();
      const firestoreCollections = rawFirestoreCollections.filter(col => {
        const key = col.name || col.id;
        if (seenNames.has(key)) return false;
        seenNames.add(key);
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
            // Merge banks: prefer Firestore if it has data, fallback to local
            const mergedBanks = (migratedCol.banks || []).map((fsBank, i) => {
              const localBank = (migratedLocal.banks || [])[i] || [];
              return (fsBank?.length > 0 ? fsBank : localBank);
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
              banks: mergedBanks,
              textBanks: mergedTextBanks,
              videoTextBank1: (col.videoTextBank1?.length > 0 ? col.videoTextBank1 : localCol.videoTextBank1) || [],
              videoTextBank2: (col.videoTextBank2?.length > 0 ? col.videoTextBank2 : localCol.videoTextBank2) || [],
              textTemplates: (col.textTemplates?.length > 0 ? col.textTemplates : localCol.textTemplates) || [],
              mediaIds: (col.mediaIds?.length > 0 ? col.mediaIds : localCol.mediaIds) || [],
            };
          }
          return migrateCollectionBanks(col);
        });

        // Save merged data to localStorage for offline access
        try {
          localStorage.setItem(getCollectionsKey(artistId), JSON.stringify(mergedCollections));
        } catch (e) {}

        const smartCollections = createSmartCollections();
        callback([...smartCollections, ...mergedCollections]);
      } else {
        // Firestore empty — check localStorage and upload if data exists
        const localCollections = getCollections(artistId);
        const userCollections = localCollections.filter(c => c.type !== 'smart' && !c.id?.startsWith('smart_'));

        if (userCollections.length > 0) {
          // Upload local collections to Firestore (including banks)
          userCollections.forEach(col => {
            const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', col.id);
            setDoc(docRef, { ...col, updatedAt: serverTimestamp() }).catch(console.error);
          });
        }

        callback(localCollections);
      }
    },
    (error) => {
      console.error('[Collections] Firestore subscription error:', error);
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
  if (!db || !artistId || !collectionData?.id) return;
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', collectionData.id);
    await setDoc(docRef, { ...collectionData, updatedAt: serverTimestamp() });
  } catch (error) {
    console.error('[Collections] Failed to save to Firestore:', error);
  }
};

/**
 * Delete collection from Firestore
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {Promise<void>}
 */
export const deleteCollectionFromFirestore = async (db, artistId, collectionId) => {
  if (!db || !artistId || !collectionId) return;
  try {
    const docRef = doc(db, 'artists', artistId, 'library', 'data', 'collections', collectionId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('[Collections] Failed to delete from Firestore:', error);
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
      console.error('[Library] Firestore collection write failed:', error.message);
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
      console.warn('[Library] Firestore onboarding read failed:', error.message);
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
      console.error('[Library] Firestore onboarding write failed:', error.message);
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
    console.error('[Migration] Failed:', error);
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
export const migrateThumbnails = async (db, artistId, libraryItems, uploadFileFn, onProgress) => {
  const images = (libraryItems || []).filter(item =>
    item.type === MEDIA_TYPES.IMAGE && item.url
  );

  if (images.length === 0) return { generated: 0, failed: 0 };

  log(`[ThumbnailMigration] Starting — ${images.length} images need thumbnails`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    try {
      // Load image (handles CORS with fallback)
      const { img, cleanup } = await loadImageForCanvas(item.url);

      // Canvas resize to 300px max dimension
      const maxSize = 150;
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      cleanup();

      // Convert to JPEG blob
      const thumbBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.5));
      if (!thumbBlob) throw new Error('Canvas toBlob returned null');

      // Upload thumbnail to Firebase Storage
      const thumbFile = new File([thumbBlob], `thumb_${item.name}`, { type: 'image/jpeg' });
      const { url: thumbnailUrl } = await uploadFileFn(thumbFile, 'thumbnails');

      // Update record in localStorage + Firestore (Firestore update skipped if db is null)
      await updateLibraryItemAsync(db, artistId, item.id, { thumbnailUrl });

      generated++;
      log(`[ThumbnailMigration] ✓ ${i + 1}/${images.length} — ${item.name}`);
    } catch (err) {
      failed++;
      console.warn(`[ThumbnailMigration] ✗ ${i + 1}/${images.length} — ${item.name}:`, err.message);
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
    item.type === MEDIA_TYPES.VIDEO && item.url && !item.thumbnailUrl
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
      const maxSize = 150;
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
      const thumbBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.5));
      if (!thumbBlob) throw new Error('Canvas toBlob returned null');

      // Upload
      const thumbFile = new File([thumbBlob], `thumb_${item.name}.jpg`, { type: 'image/jpeg' });
      const { url: thumbnailUrl } = await uploadFileFn(thumbFile, 'thumbnails');

      // Update record
      await updateLibraryItemAsync(db, artistId, item.id, { thumbnailUrl });

      generated++;
      log(`[VideoThumbMigration] ✓ ${i + 1}/${videos.length} — ${item.name}`);
    } catch (err) {
      failed++;
      console.warn(`[VideoThumbMigration] ✗ ${i + 1}/${videos.length} — ${item.name}:`, err.message);
    }

    if (onProgress) onProgress(i + 1, videos.length, generated);
  }

  log(`[VideoThumbMigration] Complete: ${generated} generated, ${failed} failed`);
  return { generated, failed };
};

// ============================================================================
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

  // Collections (Firestore async)
  getCollectionsAsync,
  subscribeToCollections,
  saveCollectionToFirestore,
  deleteCollectionFromFirestore,
  createNewCollectionAsync,

  // Created Content
  getCreatedContent,
  saveCreatedContent,
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
