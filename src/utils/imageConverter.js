/**
 * imageConverter — Client-side HEIC/HEIF and TIFF to JPEG conversion
 *
 * iOS defaults to HEIC format for photos. Desktop browsers (Chrome, Firefox, Edge)
 * can't render .heic files in <img> or Canvas, breaking thumbnails and export.
 * Similarly, TIFF files (.tif/.tiff) are not natively renderable in most browsers.
 *
 * Uses heic2any (lazy-loaded ~300KB WASM) for HEIC and utif2 (~80KB) for TIFF,
 * converting at upload time to JPEG.
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
 * Check if a file is TIFF format.
 */
export const isTiffFile = (file) => {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type === 'image/tiff') return true;
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.tif') || name.endsWith('.tiff');
};

/**
 * Check if a file needs conversion (HEIC or TIFF).
 */
export const needsConversion = (file) => isHeicFile(file) || isTiffFile(file);

/**
 * Convert a TIFF file to JPEG using utif2.
 * @param {File} file — TIFF input file
 * @returns {Promise<File>} — converted JPEG file
 */
const convertTiff = async (file) => {
  const UTIF = await import('utif2');
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  UTIF.decodeImage(buffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const { width, height } = ifds[0];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  const newName = file.name.replace(/\.tiff?$/i, '.jpg');
  return new File([blob], newName, { type: 'image/jpeg' });
};

/**
 * Convert a HEIC/HEIF file to JPEG using heic2any.
 * @param {File} file — HEIC input file
 * @returns {Promise<File>} — converted JPEG file
 */
const convertHeic = async (file) => {
  const heic2any = (await import('heic2any')).default;
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const resultBlob = Array.isArray(blob) ? blob[0] : blob;
  const newName = file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
  return new File([resultBlob], newName, { type: 'image/jpeg' });
};

/**
 * Convert a HEIC/HEIF or TIFF file to JPEG. Other files pass through unchanged.
 * @param {File} file — input file
 * @returns {Promise<File>} — converted JPEG file, or original if no conversion needed
 */
export const convertImageIfNeeded = async (file) => {
  if (isHeicFile(file)) return convertHeic(file);
  if (isTiffFile(file)) return convertTiff(file);
  return file;
};

/**
 * Batch convert an array of files, converting any HEIC/HEIF/TIFF to JPEG.
 * Uses concurrency of 3 for parallel conversion.
 * @param {File[]} files — input files array
 * @returns {Promise<File[]>} — array with converted files
 */
export const convertImageFilesIfNeeded = async (files) => {
  const { runPool } = await import('./uploadPool');
  const { results } = await runPool(files, convertImageIfNeeded, { concurrency: 3 });
  return results.map((r, i) => r || files[i]); // fallback to original on error
};

// Backward-compatible re-exports for existing code
export const convertHeicIfNeeded = convertImageIfNeeded;
export const convertHeicFilesIfNeeded = convertImageFilesIfNeeded;
