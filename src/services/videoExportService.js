/**
 * videoExportService.js
 * Service for rendering and exporting videos with canvas + MediaRecorder
 */

/**
 * Render a video from clips, audio, and text overlays
 * Uses Canvas + MediaRecorder to create a WebM video file
 *
 * @param {Object} videoData - The video configuration
 * @param {Array} videoData.clips - Array of video clips with url, startTime, duration
 * @param {Object} videoData.audio - Audio object with url
 * @param {Array} videoData.words - Array of words with text, startTime, duration
 * @param {Object} videoData.textStyle - Text styling options
 * @param {string} videoData.cropMode - Crop mode (9:16, 4:3, 1:1)
 * @param {number} videoData.duration - Total duration in seconds
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<Blob>} - The rendered video as a Blob
 */
export const renderVideo = async (videoData, onProgress = () => {}) => {
  const { clips, audio, words, textStyle, cropMode, duration } = videoData;

  if (!clips || clips.length === 0) {
    throw new Error('No clips to render');
  }

  // Set up canvas dimensions based on crop mode
  const dimensions = {
    '9:16': { width: 1080, height: 1920 },
    '4:3': { width: 1080, height: 1440 },
    '1:1': { width: 1080, height: 1080 }
  };
  const { width, height } = dimensions[cropMode] || dimensions['9:16'];

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Create video elements for each clip (prefer localUrl to avoid CORS)
  const videoElements = await Promise.all(
    clips.map(clip => loadVideoElement(clip.localUrl || clip.url))
  );

  // Create audio element (prefer localUrl to avoid CORS)
  let audioElement = null;
  if (audio?.url || audio?.localUrl) {
    audioElement = await loadAudioElement(audio.localUrl || audio.url);
  }

  // Set up MediaRecorder
  const stream = canvas.captureStream(30);

  // Add audio track if available
  if (audioElement) {
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(audioElement);
    const destination = audioCtx.createMediaStreamDestination();
    source.connect(destination);
    // NOTE: Do NOT connect to audioCtx.destination - that plays through speakers during rendering

    destination.stream.getAudioTracks().forEach(track => {
      stream.addTrack(track);
    });
  }

  const mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 5000000
  });

  const chunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  return new Promise((resolve, reject) => {
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(blob);
    };

    mediaRecorder.onerror = reject;
    mediaRecorder.start();

    // Start rendering
    let startTime = performance.now();
    let currentTime = 0;
    const frameRate = 30;
    const frameDuration = 1000 / frameRate;

    // Start audio
    if (audioElement) {
      audioElement.play().catch(console.error);
    }

    const renderFrame = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      currentTime = elapsed;

      if (currentTime >= duration) {
        // Done rendering
        if (audioElement) {
          audioElement.pause();
        }
        mediaRecorder.stop();
        onProgress(100);
        return;
      }

      // Update progress
      onProgress(Math.floor((currentTime / duration) * 100));

      // Find current clip
      const currentClipIndex = clips.findIndex((clip, i) => {
        const nextClip = clips[i + 1];
        if (!nextClip) return currentTime >= clip.startTime;
        return currentTime >= clip.startTime && currentTime < nextClip.startTime;
      });

      const currentClip = clips[currentClipIndex] || clips[0];
      const videoElement = videoElements[currentClipIndex] || videoElements[0];

      // Draw video frame
      if (videoElement && videoElement.readyState >= 2) {
        // Calculate position within clip
        const clipStartTime = currentClip.startTime || 0;
        const clipDuration = currentClip.duration || 2;
        const positionInClip = (currentTime - clipStartTime) % clipDuration;
        videoElement.currentTime = positionInClip;

        // Draw video to canvas (center-crop to fit)
        drawCenteredCrop(ctx, videoElement, width, height);
      } else {
        // Draw placeholder if video not ready
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
      }

      // Draw text overlay
      const currentWord = words?.find(w =>
        currentTime >= w.startTime && currentTime < w.startTime + (w.duration || 0.5)
      );

      if (currentWord) {
        drawTextOverlay(ctx, currentWord.text, textStyle, width, height);
      }

      // Schedule next frame
      requestAnimationFrame(renderFrame);
    };

    renderFrame();
  });
};

/**
 * Load a video element and wait for it to be ready
 */
const loadVideoElement = (url) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    video.onloadeddata = () => resolve(video);
    video.onerror = reject;
    video.src = url;
    video.load();
  });
};

/**
 * Load an audio element and wait for it to be ready
 */
const loadAudioElement = (url) => {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';

    audio.onloadeddata = () => resolve(audio);
    audio.onerror = reject;
    audio.src = url;
    audio.load();
  });
};

/**
 * Draw a video element to canvas with center crop
 */
const drawCenteredCrop = (ctx, video, canvasWidth, canvasHeight) => {
  const videoRatio = video.videoWidth / video.videoHeight;
  const canvasRatio = canvasWidth / canvasHeight;

  let sx, sy, sw, sh;

  if (videoRatio > canvasRatio) {
    // Video is wider - crop sides
    sh = video.videoHeight;
    sw = sh * canvasRatio;
    sx = (video.videoWidth - sw) / 2;
    sy = 0;
  } else {
    // Video is taller - crop top/bottom
    sw = video.videoWidth;
    sh = sw / canvasRatio;
    sx = 0;
    sy = (video.videoHeight - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
};

/**
 * Draw text overlay on canvas
 */
const drawTextOverlay = (ctx, text, style, canvasWidth, canvasHeight) => {
  const fontSize = (style?.fontSize || 48) * 2; // Scale up for high res
  const fontFamily = style?.fontFamily || 'Inter, sans-serif';
  const fontWeight = style?.fontWeight || '600';
  const color = style?.color || '#ffffff';
  const outline = style?.outline !== false;
  const outlineColor = style?.outlineColor || '#000000';
  const textCase = style?.textCase || 'default';

  // Apply text case
  let displayText = text;
  if (textCase === 'upper') displayText = text.toUpperCase();
  if (textCase === 'lower') displayText = text.toLowerCase();

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const x = canvasWidth / 2;
  const y = canvasHeight / 2;

  // Draw outline
  if (outline) {
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = fontSize / 10;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(displayText, x, y);
  }

  // Draw fill
  ctx.fillStyle = color;
  ctx.fillText(displayText, x, y);
};

/**
 * Simpler export method - exports individual clip thumbnails as a preview
 * For actual video rendering, use renderVideo
 */
export const exportAsPreview = async (videoData) => {
  const { clips, words, textStyle } = videoData;

  if (!clips || clips.length === 0) {
    throw new Error('No clips to export');
  }

  // Just generate a preview image from first clip (prefer localUrl to avoid CORS)
  const video = await loadVideoElement(clips[0].localUrl || clips[0].url);

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');

  // Draw video
  drawCenteredCrop(ctx, video, 1080, 1920);

  // Draw first word
  if (words && words.length > 0) {
    drawTextOverlay(ctx, words[0].text, textStyle, 1080, 1920);
  }

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.9);
  });
};

export default {
  renderVideo,
  exportAsPreview
};
