// Shared constants and utilities for all editors
// Extracted from 5 editor files to eliminate duplication

export const BUILT_IN_FONTS = [
  { name: 'TikTok Sans', value: "'TikTok Sans', sans-serif" },
  { name: 'Inter', value: "'Inter', sans-serif" },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Arial Narrow', value: "'Arial Narrow', Arial, sans-serif" },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Times New Roman', value: "'Times New Roman', serif" },
  { name: 'Courier New', value: "'Courier New', monospace" },
  { name: 'Impact', value: 'Impact, sans-serif' },
  { name: 'Comic Sans', value: "'Comic Sans MS', cursive" },
  { name: 'Trebuchet', value: "'Trebuchet MS', sans-serif" },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
  { name: 'Palatino', value: "'Palatino Linotype', serif" },
];

// Custom fonts stored in localStorage
const CUSTOM_FONTS_KEY = 'stm_custom_fonts';

export function getCustomFonts() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_FONTS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveCustomFont(name, dataUrl) {
  const customs = getCustomFonts();
  if (customs.some((f) => f.name === name)) return; // already exists
  customs.push({ name, value: `'${name}', sans-serif`, dataUrl });
  localStorage.setItem(CUSTOM_FONTS_KEY, JSON.stringify(customs));
  // Register with CSS
  registerCustomFont(name, dataUrl);
}

export function registerCustomFont(name, dataUrl) {
  const font = new FontFace(name, `url(${dataUrl})`);
  font
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
    })
    .catch((err) => {
      console.warn(`[Font] Failed to load "${name}":`, err.message);
    });
}

// Register all saved custom fonts on load
export function initCustomFonts() {
  getCustomFonts().forEach((f) => registerCustomFont(f.name, f.dataUrl));
}

// Combined list: built-in + custom
export function getAvailableFonts() {
  return [...BUILT_IN_FONTS, ...getCustomFonts()];
}

// Backward compat
export const AVAILABLE_FONTS = BUILT_IN_FONTS;

// Duration auto-bucketing for media banks
export const DURATION_BUCKETS = [
  { min: 0, max: 2, label: '0-2s', key: 'micro' },
  { min: 2, max: 5, label: '2-5s', key: 'short' },
  { min: 5, max: 10, label: '5-10s', key: 'medium' },
  { min: 10, max: Infinity, label: '10s+', key: 'long' },
];

export function bucketByDuration(mediaItems) {
  const buckets = DURATION_BUCKETS.map((b) => ({
    ...b,
    items: [],
  }));
  const unknown = [];
  mediaItems.forEach((item) => {
    const dur = item.duration;
    if (!dur && dur !== 0) {
      unknown.push(item);
      return;
    }
    const bucket = buckets.find((b) => dur >= b.min && dur < b.max);
    if (bucket) bucket.items.push(item);
    else unknown.push(item);
  });
  return { buckets: buckets.filter((b) => b.items.length > 0), unknown };
}

export const parseStroke = (str) => {
  if (!str) return { width: 0.5, color: '#000000' };
  const match = str.match(/([\d.]+)px\s+(.*)/);
  if (!match) return { width: 0.5, color: '#000000' };
  return { width: parseFloat(match[1]) || 0.5, color: match[2] || '#000000' };
};

export const buildStroke = (width, color) => `${width}px ${color}`;

/**
 * Creates a setter function that updates a specific field on the active item
 * in a multi-draft state array. Used by all editors for routing state updates
 * through the allVideos/allSlideshows array.
 *
 * @param {Function} setAll - The setState function for the array (e.g. setAllVideos)
 * @param {number} activeIndex - Current active item index
 * @param {string} field - Field name to update on the active item
 * @param {*} fallback - Fallback value when field is undefined (e.g. [] or {})
 * @returns {Function} A setter that accepts a value or updater function
 */
export const makeFieldSetter = (setAll, activeIndex, field, fallback) => (updater) => {
  setAll((prev) => {
    const current = prev[activeIndex];
    if (!current) return prev;
    const copy = [...prev];
    copy[activeIndex] = {
      ...current,
      [field]: typeof updater === 'function' ? updater(current[field] ?? fallback) : updater,
    };
    return copy;
  });
};
