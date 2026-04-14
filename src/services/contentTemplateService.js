/**
 * Content Template Service - Reusable caption & hashtag templates
 *
 * Handles:
 * - CRUD operations for content templates (Firestore)
 * - Per-artist template storage
 * - Niche/category-based organization
 * - Default templates for quick start
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import log from '../utils/logger';

// Collection name
const TEMPLATES_COLLECTION = 'contentTemplates';

// Default templates for new artists
export const DEFAULT_TEMPLATES = {
  Fashion: {
    hashtags: {
      always: ['#fashion', '#style', '#aesthetic'],
      pool: [
        '#ootd',
        '#archive',
        '#vibes',
        '#mood',
        '#runway',
        '#designer',
        '#vintage',
        '#y2k',
        '#grunge',
        '#minimalist',
        '#streetwear',
        '#haute',
      ],
    },
    captions: {
      always: [],
      pool: [
        'mood',
        'vibe',
        'forever',
        'dreaming',
        '✨',
        'archive',
        'aesthetic',
        'core',
        'obsessed',
        'iconic',
        'serving',
        'the blueprint',
      ],
    },
  },
  EDM: {
    hashtags: {
      always: ['#edm', '#music', '#electronic'],
      pool: [
        '#rave',
        '#bass',
        '#dubstep',
        '#house',
        '#techno',
        '#festival',
        '#dj',
        '#beats',
        '#wub',
        '#plur',
        '#underground',
      ],
    },
    captions: {
      always: [],
      pool: [
        'wub',
        'wub wub',
        '<3',
        'dancedancedance',
        'bass drop',
        'feel it',
        '🖤',
        'lost in sound',
        'the drop',
        'vibrations',
      ],
    },
  },
  Runway: {
    hashtags: {
      always: ['#runway', '#fashion', '#couture'],
      pool: [
        '#highfashion',
        '#model',
        '#designer',
        '#fashionweek',
        '#avantgarde',
        '#editorial',
        '#vogue',
        '#luxury',
        '#catwalk',
        '#style',
      ],
    },
    captions: {
      always: [],
      pool: [
        'walk',
        'serve',
        'iconic',
        'the moment',
        'couture',
        'editorial',
        'pretty',
        'elegance',
        'grace',
        'timeless',
      ],
    },
  },
  'Romantic/Soft': {
    hashtags: {
      always: ['#aesthetic', '#dreamy', '#soft'],
      pool: [
        '#romantic',
        '#ethereal',
        '#gentle',
        '#pastel',
        '#love',
        '#tender',
        '#serene',
        '#delicate',
        '#whimsical',
      ],
    },
    captions: {
      always: [],
      pool: [
        'dreaming',
        'soft',
        'gentle',
        '🤍',
        'floating',
        'whisper',
        'tender',
        'in bloom',
        'softly',
        'daydream',
      ],
    },
  },
  'Ethereal/Dreamy': {
    hashtags: {
      always: ['#ethereal', '#dreamy', '#aesthetic'],
      pool: [
        '#celestial',
        '#mystical',
        '#fairycore',
        '#angelic',
        '#heavenly',
        '#magical',
        '#otherworldly',
        '#fantasy',
      ],
    },
    captions: {
      always: [],
      pool: [
        'floating',
        'celestial',
        'otherworldly',
        '✧',
        'dreamscape',
        'beyond',
        'transcend',
        'ethereal',
        'magic',
      ],
    },
  },
  'Hip-Hop/Urban': {
    hashtags: {
      always: ['#hiphop', '#rap', '#music'],
      pool: [
        '#urban',
        '#street',
        '#bars',
        '#flow',
        '#beats',
        '#culture',
        '#real',
        '#vibes',
        '#grind',
        '#lifestyle',
      ],
    },
    captions: {
      always: [],
      pool: [
        'real ones know',
        'on repeat',
        '🔥',
        'different',
        'no cap',
        'facts',
        'energy',
        'mood',
        'lifestyle',
        'certified',
      ],
    },
  },
  'Indie/Alternative': {
    hashtags: {
      always: ['#indie', '#alternative', '#music'],
      pool: [
        '#indiemusic',
        '#newmusic',
        '#underground',
        '#dreampop',
        '#lofi',
        '#bedroom',
        '#diy',
        '#authentic',
        '#raw',
      ],
    },
    captions: {
      always: [],
      pool: [
        'feeling this',
        'late nights',
        '~',
        'somewhere else',
        'in my head',
        'lost in it',
        'idk',
        'whatever',
        'anyway',
      ],
    },
  },
  'Pop/Mainstream': {
    hashtags: {
      always: ['#pop', '#music', '#newmusic'],
      pool: [
        '#viral',
        '#trending',
        '#fyp',
        '#foryou',
        '#catchy',
        '#banger',
        '#summer',
        '#dance',
        '#party',
        '#hit',
      ],
    },
    captions: {
      always: [],
      pool: [
        'obsessed',
        'on repeat',
        '💕',
        'this song',
        'literally me',
        'slay',
        'iconic',
        'main character',
        'ate',
        'period',
      ],
    },
  },
};

/**
 * Get templates for an artist (real-time subscription)
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 * @param {Function} callback - Real-time updates callback
 */
export const subscribeToTemplates = (db, artistId, callback) => {
  if (!artistId) {
    callback({});
    return () => {};
  }

  const docRef = doc(db, TEMPLATES_COLLECTION, artistId);

  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data().templates || {});
      } else {
        // Return defaults if no custom templates exist
        callback(DEFAULT_TEMPLATES);
      }
    },
    (error) => {
      log.error('Error subscribing to templates:', error);
      callback(DEFAULT_TEMPLATES);
    },
  );
};

/**
 * Get templates for an artist (one-time fetch)
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 */
export const getTemplates = async (db, artistId) => {
  if (!artistId) return DEFAULT_TEMPLATES;

  try {
    const docRef = doc(db, TEMPLATES_COLLECTION, artistId);
    const snapshot = await getDoc(docRef);

    if (snapshot.exists()) {
      return snapshot.data().templates || DEFAULT_TEMPLATES;
    }
    return DEFAULT_TEMPLATES;
  } catch (error) {
    log.error('Error getting templates:', error);
    return DEFAULT_TEMPLATES;
  }
};

/**
 * Save all templates for an artist
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 * @param {Object} templates - Templates object keyed by category
 */
export const saveTemplates = async (db, artistId, templates) => {
  if (!artistId) throw new Error('Artist ID required');

  const docRef = doc(db, TEMPLATES_COLLECTION, artistId);
  await setDoc(
    docRef,
    {
      templates,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return templates;
};

/**
 * Add or update a single category template
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 * @param {string} category - Category name (e.g., "Fashion")
 * @param {Object} template - Template with hashtags and captions
 */
export const saveCategory = async (db, artistId, category, template) => {
  if (!artistId) throw new Error('Artist ID required');
  if (!category) throw new Error('Category name required');

  const templates = await getTemplates(db, artistId);
  templates[category] = template;

  return saveTemplates(db, artistId, templates);
};

/**
 * Delete a category template
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 * @param {string} category - Category name to delete
 */
export const deleteCategory = async (db, artistId, category) => {
  if (!artistId) throw new Error('Artist ID required');
  if (!category) throw new Error('Category name required');

  const templates = await getTemplates(db, artistId);
  delete templates[category];

  return saveTemplates(db, artistId, templates);
};

/**
 * Reset templates to defaults for an artist
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 */
export const resetToDefaults = async (db, artistId) => {
  return saveTemplates(db, artistId, { ...DEFAULT_TEMPLATES });
};

/**
 * Generate caption and hashtags from a template
 * @param {Object} template - Template with hashtags and captions
 * @param {string} platform - Platform ('tiktok', 'instagram', etc.)
 * @param {Object} options - Generation options
 */
export const generateFromTemplate = (template, platform = 'tiktok', options = {}) => {
  if (!template) return { caption: '', hashtags: '' };

  const { hashtagCount = 4, captionCount = 1 } = options;

  // Platform-specific limits
  const maxHashtags = platform === 'instagram' ? 10 : platform === 'youtube' ? 15 : 5;
  const actualHashtagCount = Math.min(hashtagCount, maxHashtags);

  // Get always hashtags
  const alwaysHashtags = template.hashtags?.always || [];

  // Randomly select from pool
  const poolHashtags = template.hashtags?.pool || [];
  const shuffledPool = [...poolHashtags].sort(() => Math.random() - 0.5);
  const selectedPool = shuffledPool.slice(
    0,
    Math.max(0, actualHashtagCount - alwaysHashtags.length),
  );

  // Combine hashtags
  const allHashtags = [...alwaysHashtags, ...selectedPool];
  const hashtagsString = allHashtags.join(' ');

  // Get caption words
  const alwaysCaptions = template.captions?.always || [];
  const poolCaptions = template.captions?.pool || [];
  const shuffledCaptions = [...poolCaptions].sort(() => Math.random() - 0.5);
  const selectedCaptions = shuffledCaptions.slice(
    0,
    Math.max(0, captionCount - alwaysCaptions.length),
  );

  // Combine caption parts
  const allCaptions = [...alwaysCaptions, ...selectedCaptions];
  const captionString = allCaptions.join(' ');

  return {
    caption: captionString,
    hashtags: hashtagsString,
    combined: captionString ? `${captionString}\n\n${hashtagsString}` : hashtagsString,
  };
};

/**
 * Get all category names from templates
 * @param {Object} templates - Templates object
 */
export const getCategoryNames = (templates) => {
  return Object.keys(templates || {});
};

/**
 * Duplicate a category template with a new name
 * @param {Object} db - Firestore database instance
 * @param {string} artistId - Artist ID
 * @param {string} sourceCategory - Category to duplicate
 * @param {string} newCategory - New category name
 */
export const duplicateCategory = async (db, artistId, sourceCategory, newCategory) => {
  const templates = await getTemplates(db, artistId);

  if (!templates[sourceCategory]) {
    throw new Error(`Source category "${sourceCategory}" not found`);
  }

  if (templates[newCategory]) {
    throw new Error(`Category "${newCategory}" already exists`);
  }

  // Deep copy the template
  templates[newCategory] = JSON.parse(JSON.stringify(templates[sourceCategory]));

  return saveTemplates(db, artistId, templates);
};
