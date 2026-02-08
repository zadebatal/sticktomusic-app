/**
 * slideshowExportService.js
 *
 * Exports slideshow slides as individual JPEG images for Instagram/TikTok carousels.
 * Renders each slide to canvas with text overlays, then uploads to Firebase.
 */

import { uploadFile } from './firebaseStorage';
import log from '../utils/logger';

// Canvas dimensions based on aspect ratio
const DIMENSIONS = {
  '4:5': { width: 1080, height: 1350 },  // Instagram carousel (standard)
  '1:1': { width: 1080, height: 1080 },  // Square
  '9:16': { width: 1080, height: 1920 }, // Story/TikTok
  '4:3': { width: 1080, height: 1440 }   // Legacy
};

/**
 * Load an image and return as HTMLImageElement
 */
const loadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
};

/**
 * Draw text with proper styling on canvas
 */
const drawTextOverlay = (ctx, overlay, dimensions) => {
  const { text, style, position } = overlay;

  // Calculate actual position from percentages
  const x = (position.x / 100) * dimensions.width;
  const y = (position.y / 100) * dimensions.height;

  // Set font
  ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  ctx.textAlign = style.textAlign || 'center';
  ctx.textBaseline = 'middle';

  // Draw outline/shadow if enabled
  if (style.outline) {
    ctx.strokeStyle = style.outlineColor || 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(style.fontSize / 12, 2);
    ctx.lineJoin = 'round';

    // Split text into lines
    const lines = text.split('\n');
    const lineHeight = style.fontSize * 1.2;

    lines.forEach((line, i) => {
      const lineY = y + (i - (lines.length - 1) / 2) * lineHeight;
      ctx.strokeText(line, x, lineY);
    });
  }

  // Draw fill text
  ctx.fillStyle = style.color || '#ffffff';

  const lines = text.split('\n');
  const lineHeight = style.fontSize * 1.2;

  lines.forEach((line, i) => {
    const lineY = y + (i - (lines.length - 1) / 2) * lineHeight;
    ctx.fillText(line, x, lineY);
  });
};

/**
 * Render a single slide to a canvas and return as blob
 */
const renderSlideToCanvas = async (slide, dimensions) => {
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const ctx = canvas.getContext('2d');

  // Fill background with black first
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw background image if present
  if (slide.backgroundImage) {
    try {
      const img = await loadImage(slide.backgroundImage);
      const transform = slide.imageTransform || { scale: 1, offsetX: 0, offsetY: 0 };

      // Calculate scaling to cover the canvas (similar to object-fit: cover)
      const imgAspect = img.width / img.height;
      const canvasAspect = dimensions.width / dimensions.height;

      let drawWidth, drawHeight, offsetX, offsetY;

      if (imgAspect > canvasAspect) {
        drawHeight = dimensions.height;
        drawWidth = drawHeight * imgAspect;
        offsetX = (dimensions.width - drawWidth) / 2;
        offsetY = 0;
      } else {
        drawWidth = dimensions.width;
        drawHeight = drawWidth / imgAspect;
        offsetX = 0;
        offsetY = (dimensions.height - drawHeight) / 2;
      }

      // Apply user transform (scale + pan) — scale from center, then offset
      // The preview canvas is 270x480 (previewScale=0.25), export is 1080x1920
      // offsetX/Y are in preview pixels, scale to export dimensions
      const exportScale = dimensions.width / 270; // 1080/270 = 4
      const userScale = transform.scale;
      const userOffsetX = (transform.offsetX || 0) * exportScale;
      const userOffsetY = (transform.offsetY || 0) * exportScale;

      ctx.save();
      ctx.translate(dimensions.width / 2, dimensions.height / 2);
      ctx.scale(userScale, userScale);
      ctx.translate(-dimensions.width / 2 + userOffsetX, -dimensions.height / 2 + userOffsetY);
      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      ctx.restore();
    } catch (err) {
      console.warn('Failed to draw background image:', err);
    }
  }

  // Draw text overlays
  if (slide.textOverlays && slide.textOverlays.length > 0) {
    slide.textOverlays.forEach(overlay => {
      drawTextOverlay(ctx, overlay, dimensions);
    });
  }

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create image blob'));
        }
      },
      'image/jpeg',
      0.85 // 85% quality
    );
  });
};

/**
 * Export all slides as individual images
 *
 * @param {Object} slideshow - The slideshow data
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<Array>} Array of { url, path } for each exported image
 */
export const exportSlideshowAsImages = async (slideshow, onProgress = () => {}) => {
  const { slides, aspectRatio = '9:16', name } = slideshow;
  const dimensions = DIMENSIONS[aspectRatio] || DIMENSIONS['9:16'];
  const totalSlides = slides.length;
  const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

  // Phase 1: Render all slides to blobs (canvas work, ~fast)
  onProgress(10);
  const blobs = [];
  for (let i = 0; i < totalSlides; i++) {
    try {
      blobs.push(await renderSlideToCanvas(slides[i], dimensions));
    } catch (err) {
      throw new Error(`Failed to render slide ${i + 1}: ${err.message}`);
    }
  }
  onProgress(30);

  // Phase 2: Upload all blobs to Firebase in parallel (~slow, now parallel)
  const uploadPromises = blobs.map((blob, i) => {
    const filename = `${safeName}_slide_${i + 1}.jpg`;
    return uploadFile(
      new File([blob], filename, { type: 'image/jpeg' }),
      'slideshows'
    ).then(({ url, path }) => {
      log(`[Export] Slide ${i + 1}/${totalSlides} exported:`, filename);
      return { url, path, slideIndex: i, filename };
    });
  });

  const exportedImages = await Promise.all(uploadPromises);
  onProgress(100);

  // Sort by slide index to maintain order
  exportedImages.sort((a, b) => a.slideIndex - b.slideIndex);
  return exportedImages;
};

/**
 * Generate a preview thumbnail for a slide (smaller size for UI)
 */
export const generateSlideThumbnail = async (slide, aspectRatio = '9:16') => {
  const fullDimensions = DIMENSIONS[aspectRatio] || DIMENSIONS['9:16'];

  // Use smaller dimensions for thumbnail
  const thumbnailDimensions = {
    width: Math.round(fullDimensions.width * 0.2),
    height: Math.round(fullDimensions.height * 0.2)
  };

  const canvas = document.createElement('canvas');
  canvas.width = thumbnailDimensions.width;
  canvas.height = thumbnailDimensions.height;
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw background image if present
  if (slide.backgroundImage) {
    try {
      const img = await loadImage(slide.backgroundImage);

      // Cover scaling
      const imgAspect = img.width / img.height;
      const canvasAspect = thumbnailDimensions.width / thumbnailDimensions.height;

      let drawWidth, drawHeight, offsetX, offsetY;

      if (imgAspect > canvasAspect) {
        drawHeight = thumbnailDimensions.height;
        drawWidth = drawHeight * imgAspect;
        offsetX = (thumbnailDimensions.width - drawWidth) / 2;
        offsetY = 0;
      } else {
        drawWidth = thumbnailDimensions.width;
        drawHeight = drawWidth / imgAspect;
        offsetX = 0;
        offsetY = (thumbnailDimensions.height - drawHeight) / 2;
      }

      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
    } catch (err) {
      console.warn('Failed to draw thumbnail background:', err);
    }
  }

  return canvas.toDataURL('image/jpeg', 0.7);
};

export default {
  exportSlideshowAsImages,
  generateSlideThumbnail
};
