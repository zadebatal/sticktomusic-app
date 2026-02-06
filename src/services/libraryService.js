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
  audioEndTime = null
}) => {
  const now = new Date().toISOString();
  return {
    id: `lyrics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    title,
    content, // Raw lyrics text
    words, // Timed words array (LOCAL TIME)

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
    console.error('Error saving library:', error);
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

    // Always include smart collections
    const smartCollections = createSmartCollections();

    return [...smartCollections, ...userCollections];
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

/**
 * Assign media to Bank A or Bank B within a collection
 * @param {string} artistId
 * @param {string} collectionId
 * @param {string|string[]} mediaIds
 * @param {'A'|'B'} bank - Which bank to assign to
 */
export const assignToBank = (artistId, collectionId, mediaIds, bank) => {
  const idsToAssign = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const bankKey = bank === 'A' ? 'bankA' : 'bankB';
  const otherBankKey = bank === 'A' ? 'bankB' : 'bankA';

  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;

  // Ensure media is in this collection first
  collection.mediaIds = [...new Set([...collection.mediaIds, ...idsToAssign])];

  // Add to target bank (allow same image in both banks)
  collection[bankKey] = [...new Set([...(collection[bankKey] || []), ...idsToAssign])];
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

  collection.bankA = (collection.bankA || []).filter(id => !idsToRemove.includes(id));
  collection.bankB = (collection.bankB || []).filter(id => !idsToRemove.includes(id));
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Add text to a text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {string} text
 */
export const addToTextBank = (artistId, collectionId, bankNum, text) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const key = `textBank${bankNum}`;
  collection[key] = [...(collection[key] || []), text];
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Remove text from a text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {number} index
 */
export const removeFromTextBank = (artistId, collectionId, bankNum, index) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  const key = `textBank${bankNum}`;
  collection[key] = (collection[key] || []).filter((_, i) => i !== index);
  collection.updatedAt = new Date().toISOString();
  saveCollections(artistId, collections);
};

/**
 * Update entire text bank
 * @param {string} artistId
 * @param {string} collectionId
 * @param {number} bankNum - 1 or 2
 * @param {string[]} texts
 */
export const updateTextBank = (artistId, collectionId, bankNum, texts) => {
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return;
  collection[`textBank${bankNum}`] = texts;
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
 * Get collection media split by bank assignment
 * @param {string} artistId
 * @param {string} collectionId
 * @returns {{ bankA: Object[], bankB: Object[], unassigned: Object[] }}
 */
export const getCollectionBanks = (artistId, collectionId) => {
  const library = getLibrary(artistId);
  const collections = getUserCollections(artistId);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return { bankA: [], bankB: [], unassigned: [] };

  const allMedia = library.filter(item => collection.mediaIds.includes(item.id));
  const bankAIds = collection.bankA || [];
  const bankBIds = collection.bankB || [];

  return {
    bankA: allMedia.filter(item => bankAIds.includes(item.id)),
    bankB: allMedia.filter(item => bankBIds.includes(item.id)),
    unassigned: allMedia.filter(item => !bankAIds.includes(item.id) && !bankBIds.includes(item.id))
  };
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
    return data ? JSON.parse(data) : { videos: [], slideshows: [] };
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
  content.slideshows.push(newSlideshow);
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
    console.log('[Library] Created content saved to Firestore');
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
        console.log('[Library] Loaded from Firestore:', items.length, 'items');
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
      console.log('[Library] Real-time update:', items.length, 'items');

      // If Firestore returns empty, check localStorage as fallback
      // This handles the case where Firestore writes failed but localStorage has data
      if (items.length === 0) {
        const localItems = getLibrary(artistId);
        if (localItems.length > 0) {
          console.log('[Library] Firestore empty, using localStorage fallback:', localItems.length, 'items');
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

  // Validate duration for audio
  if (newItem.type === MEDIA_TYPES.AUDIO && (!newItem.duration || newItem.duration <= 0)) {
    console.warn('[Library] Audio item has invalid duration:', newItem.duration);
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
      console.log('[Library] Saved to Firestore:', newItem.id);
    } catch (error) {
      console.error('[Library] Firestore write failed:', error.message);
      // localStorage already has the data, so we're okay
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
      console.log('[Library] Batch saved to Firestore:', newItems.length, 'items');
    } catch (error) {
      console.error('[Library] Firestore batch write failed:', error.message);
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
      console.log('[Library] Updated in Firestore:', mediaId);
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
      console.log('[Library] Removed from Firestore:', mediaId);
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
              textBank1: localCol.textBank1 || col.textBank1 || [],
              textBank2: localCol.textBank2 || col.textBank2 || [],
              textTemplates: localCol.textTemplates || col.textTemplates || [],
            };
          }
          return col;
        });
        // Always include smart collections (computed client-side)
        const smartCollections = createSmartCollections();
        console.log('[Library] Collections from Firestore:', mergedCollections.length, '(with localStorage bank merge)');
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
      const firestoreCollections = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      if (firestoreCollections.length > 0) {
        // Firestore has data — use it as the source of truth
        // Save to localStorage for offline access
        try {
          localStorage.setItem(getCollectionsKey(artistId), JSON.stringify(firestoreCollections));
        } catch (e) {}

        const smartCollections = createSmartCollections();
        callback([...smartCollections, ...firestoreCollections]);
      } else {
        // Firestore empty — check localStorage and upload if data exists
        const localCollections = getCollections(artistId);
        const userCollections = localCollections.filter(c => c.type !== 'smart' && !c.id?.startsWith('smart_'));

        if (userCollections.length > 0) {
          // Upload local collections to Firestore
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
      console.log('[Library] Collection saved to Firestore:', localResult.id);
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
        console.log('[Library] Onboarding status from Firestore');
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
      console.log('[Library] Onboarding saved to Firestore');

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
        console.log('[Library] Template collections saved to Firestore');
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
      console.log('[Migration] Migrated media items:', library.length);
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
      console.log('[Migration] Migrated collections:', collections.length);
    }

    // Migrate onboarding status
    const onboarding = getOnboardingStatus(artistId);
    if (onboarding.completed) {
      const docRef = doc(db, 'artists', artistId, 'library', 'onboarding');
      await setDoc(docRef, onboarding);
      result.migrated.onboarding = true;
      console.log('[Migration] Migrated onboarding status');
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
      console.log('[Migration] Migrated created content:', result.migrated.createdContent);
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
      console.log('[Migration] Migrated lyrics:', lyrics.length);
    }

    console.log('[Migration] Complete for artist:', artistId, result.migrated);

  } catch (error) {
    console.error('[Migration] Failed:', error);
    result.success = false;
    result.errors.push(error.message);
  }

  return result;
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
  migrateToFirestore
};
