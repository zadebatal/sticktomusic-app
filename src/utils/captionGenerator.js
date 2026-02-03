/**
 * captionGenerator.js - Caption and Hashtag Generation from Content Banks
 *
 * Generates random captions and hashtags following bank rules:
 * - "always" items are always included
 * - "pool" items are randomly selected
 *
 * @see docs/DOMAIN_INVARIANTS.md
 */

/**
 * Content Banks - Define hashtags and captions for each category/niche
 * This is the SINGLE SOURCE OF TRUTH for bank data
 */
export const CONTENT_BANKS = Object.freeze({
  Fashion: {
    hashtags: {
      always: ['#fashion', '#style', '#aesthetic'],
      pool: ['#ootd', '#archive', '#vibes', '#mood', '#runway', '#designer', '#vintage', '#y2k', '#grunge', '#minimalist', '#streetwear', '#haute']
    },
    captions: {
      always: [],
      pool: ['mood', 'vibe', 'forever', 'dreaming', '✨', 'archive', 'aesthetic', 'core', 'obsessed', 'iconic', 'serving', 'the blueprint']
    }
  },
  EDM: {
    hashtags: {
      always: ['#edm', '#music', '#electronic'],
      pool: ['#rave', '#bass', '#dubstep', '#house', '#techno', '#festival', '#dj', '#beats', '#wub', '#plur', '#underground']
    },
    captions: {
      always: [],
      pool: ['wub', 'wub wub', '<3', 'dancedancedance', 'bass drop', 'feel it', '🖤', 'lost in sound', 'the drop', 'vibrations']
    }
  },
  Runway: {
    hashtags: {
      always: ['#runway', '#fashion', '#couture'],
      pool: ['#model', '#catwalk', '#highfashion', '#designer', '#fashionweek', '#paris', '#milan', '#vogue', '#editorial']
    },
    captions: {
      always: [],
      pool: ['walk', 'serve', 'the moment', 'iconic', 'haute', 'chic', 'elegance', 'fierce', 'statement']
    }
  },
  'Romantic/Soft': {
    hashtags: {
      always: ['#romantic', '#soft', '#aesthetic'],
      pool: ['#love', '#dreamy', '#ethereal', '#gentle', '#tender', '#pink', '#pastels', '#cottagecore', '#fairytale']
    },
    captions: {
      always: [],
      pool: ['dreaming', 'soft', 'tender', '💕', 'gentle', 'delicate', 'sweet', 'in love', 'fairy tale']
    }
  },
  'Ethereal/Dreamy': {
    hashtags: {
      always: ['#ethereal', '#dreamy', '#aesthetic'],
      pool: ['#mystical', '#otherworldly', '#fantasy', '#magical', '#celestial', '#surreal', '#fairycore', '#angelic']
    },
    captions: {
      always: [],
      pool: ['floating', 'between worlds', '✨', 'celestial', 'transcendent', 'otherworldly', 'lost in dreams']
    }
  }
});

/**
 * Get list of available bank names
 * @returns {string[]}
 */
export function getBankNames() {
  return Object.keys(CONTENT_BANKS);
}

/**
 * Get a specific bank by name
 * @param {string} bankName
 * @returns {Object|null}
 */
export function getBank(bankName) {
  return CONTENT_BANKS[bankName] || null;
}

/**
 * Shuffle array using Fisher-Yates algorithm
 * @param {Array} array
 * @returns {Array}
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate hashtags from a bank
 * @param {string} bankName - Name of the content bank
 * @param {Object} options
 * @param {number} options.poolCount - How many to pick from pool (default 4)
 * @param {string} options.platform - 'tiktok' or 'instagram' (affects limits)
 * @returns {string[]} - Array of hashtags
 */
export function generateHashtags(bankName, options = {}) {
  const bank = getBank(bankName);
  if (!bank) {
    console.warn(`[CaptionGenerator] Bank "${bankName}" not found`);
    return [];
  }

  const { poolCount = 4, platform = 'tiktok' } = options;
  const maxTotal = platform === 'instagram' ? 10 : 5;

  const { always = [], pool = [] } = bank.hashtags;

  // Start with "always" hashtags
  const result = [...always];

  // Add random from pool
  const shuffledPool = shuffleArray(pool);
  const toAdd = Math.min(poolCount, maxTotal - result.length, shuffledPool.length);

  for (let i = 0; i < toAdd; i++) {
    result.push(shuffledPool[i]);
  }

  return result;
}

/**
 * Generate a caption from a bank
 * @param {string} bankName - Name of the content bank
 * @returns {string} - Single caption
 */
export function generateCaption(bankName) {
  const bank = getBank(bankName);
  if (!bank) {
    console.warn(`[CaptionGenerator] Bank "${bankName}" not found`);
    return '';
  }

  const { always = [], pool = [] } = bank.captions;

  // Start with "always" captions
  const parts = [...always];

  // Add one random from pool
  if (pool.length > 0) {
    const randomIndex = Math.floor(Math.random() * pool.length);
    parts.push(pool[randomIndex]);
  }

  return parts.join(' ').trim();
}

/**
 * Generate full post content (caption + hashtags as string)
 * @param {string} bankName
 * @param {Object} options
 * @param {string} options.platform - 'tiktok' or 'instagram'
 * @param {number} options.hashtagCount - How many hashtags from pool
 * @returns {Object} - { caption, hashtags, fullText }
 */
export function generatePostContent(bankName, options = {}) {
  const { platform = 'tiktok', hashtagCount = 4 } = options;

  const caption = generateCaption(bankName);
  const hashtags = generateHashtags(bankName, { poolCount: hashtagCount, platform });
  const hashtagString = hashtags.join(' ');

  return {
    caption,
    hashtags,
    hashtagString,
    fullText: `${caption}\n\n${hashtagString}`.trim()
  };
}

/**
 * Generate post content for multiple videos
 * Each video gets unique random content from the same bank
 * @param {string} bankName
 * @param {number} count - Number of posts to generate
 * @param {Object} options
 * @returns {Array<Object>} - Array of { caption, hashtags, fullText }
 */
export function generateBatchPostContent(bankName, count, options = {}) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(generatePostContent(bankName, options));
  }
  return results;
}

/**
 * Validate that a bank name is valid
 * @param {string} bankName
 * @returns {boolean}
 */
export function isValidBankName(bankName) {
  return bankName in CONTENT_BANKS;
}

/**
 * Assert bank name is valid (for development)
 * @param {string} bankName
 * @param {string} context
 */
export function assertValidBank(bankName, context = '') {
  if (!isValidBankName(bankName)) {
    const msg = `Invalid bank name "${bankName}"${context ? ` in ${context}` : ''}. Valid: ${getBankNames().join(', ')}`;
    console.error('[BANK VIOLATION]', msg);
    if (process.env.NODE_ENV === 'development') {
      throw new Error(msg);
    }
  }
}

export default {
  CONTENT_BANKS,
  getBankNames,
  getBank,
  generateHashtags,
  generateCaption,
  generatePostContent,
  generateBatchPostContent,
  isValidBankName,
  assertValidBank
};
