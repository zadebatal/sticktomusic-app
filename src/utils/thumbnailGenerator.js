/**
 * thumbnailGenerator.js
 * Utility for generating video thumbnails using canvas
 */

/**
 * Generate a thumbnail from a video URL
 * @param {string} videoUrl - The URL of the video
 * @param {number} seekTime - Time in seconds to capture (default: 0.5)
 * @returns {Promise<string>} - Data URL of the thumbnail image
 */
export const generateThumbnailFromUrl = (videoUrl, seekTime = 0.5) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = videoUrl;
    video.muted = true;
    video.preload = 'metadata';

    let hasResolved = false;

    const cleanup = () => {
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.src = '';
      video.load();
    };

    video.onloadeddata = () => {
      // Seek to specified time or 25% of the video, whichever is smaller
      const targetTime = Math.min(seekTime, video.duration * 0.25);
      video.currentTime = targetTime > 0 ? targetTime : 0.1;
    };

    video.onseeked = () => {
      if (hasResolved) return;
      hasResolved = true;

      try {
        const canvas = document.createElement('canvas');
        // Use smaller dimensions for thumbnails
        const maxWidth = 320;
        const maxHeight = 568; // 9:16 ratio

        let width = video.videoWidth;
        let height = video.videoHeight;

        // Scale down if needed
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        cleanup();
        resolve(dataUrl);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    video.onerror = (error) => {
      if (hasResolved) return;
      hasResolved = true;
      cleanup();
      reject(error);
    };

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        cleanup();
        reject(new Error('Thumbnail generation timed out'));
      }
    }, 10000);
  });
};

/**
 * Generate a thumbnail from a video element
 * @param {HTMLVideoElement} videoElement - The video element
 * @returns {string} - Data URL of the thumbnail image
 */
export const generateThumbnailFromElement = (videoElement) => {
  const canvas = document.createElement('canvas');
  const maxWidth = 320;
  const maxHeight = 568;

  let width = videoElement.videoWidth;
  let height = videoElement.videoHeight;

  // Scale down if needed
  if (width > maxWidth) {
    height = (height * maxWidth) / width;
    width = maxWidth;
  }
  if (height > maxHeight) {
    width = (width * maxHeight) / height;
    height = maxHeight;
  }

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', 0.7);
};

/**
 * Generate thumbnails for multiple video files
 * @param {Array} videoFiles - Array of {url, file} objects
 * @returns {Promise<Array>} - Array of {url, thumbnail} objects
 */
export const generateThumbnailsForVideos = async (videos) => {
  const results = await Promise.allSettled(
    videos.map(async (video) => {
      try {
        const thumbnail = await generateThumbnailFromUrl(video.url);
        return { ...video, thumbnail };
      } catch (error) {
        console.warn('Failed to generate thumbnail for', video.name || video.url, error);
        return { ...video, thumbnail: null };
      }
    })
  );

  return results.map((result, index) =>
    result.status === 'fulfilled' ? result.value : { ...videos[index], thumbnail: null }
  );
};

export default {
  generateThumbnailFromUrl,
  generateThumbnailFromElement,
  generateThumbnailsForVideos
};
