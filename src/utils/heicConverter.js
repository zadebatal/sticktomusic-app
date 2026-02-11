/**
 * heicConverter — Client-side HEIC/HEIF to JPEG conversion
 *
 * iOS defaults to HEIC format for photos. iOS Safari auto-converts via file inputs,
 * but desktop browsers (Chrome, Firefox, Edge) pass raw .heic files unchanged.
 * These can't be drawn on HTML Canvas, breaking thumbnail generation and export.
 *
 * Uses heic2any (lazy-loaded ~300KB WASM) to convert at upload time.
 */

/**
 * Check if a file is HEIC/HEIF format.
 * Some browsers report empty MIME type for .heic files, so we check extension too.
 */
export const isHeicFile = (file) => {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return true;
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
};

/**
 * Convert a HEIC/HEIF file to JPEG. Non-HEIC files pass through unchanged.
 * @param {File} file — input file
 * @returns {Promise<File>} — converted JPEG file, or original if not HEIC
 */
export const convertHeicIfNeeded = async (file) => {
  if (!isHeicFile(file)) return file;

  const heic2any = (await import('heic2any')).default;
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const resultBlob = Array.isArray(blob) ? blob[0] : blob;
  const newName = file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
  return new File([resultBlob], newName, { type: 'image/jpeg' });
};

/**
 * Batch convert an array of files, converting any HEIC/HEIF to JPEG.
 * @param {File[]} files — input files array
 * @returns {Promise<File[]>} — array with HEIC files converted to JPEG
 */
export const convertHeicFilesIfNeeded = async (files) => {
  const results = [];
  for (const file of files) {
    results.push(await convertHeicIfNeeded(file));
  }
  return results;
};
