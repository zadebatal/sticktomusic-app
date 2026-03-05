// Shared constants and utilities for all editors
// Extracted from 5 editor files to eliminate duplication

export const AVAILABLE_FONTS = [
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
  { name: 'TikTok Sans', value: "'TikTok Sans', sans-serif" },
];

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
  setAll(prev => {
    const current = prev[activeIndex];
    if (!current) return prev;
    const copy = [...prev];
    copy[activeIndex] = {
      ...current,
      [field]: typeof updater === 'function' ? updater(current[field] ?? fallback) : updater
    };
    return copy;
  });
};
