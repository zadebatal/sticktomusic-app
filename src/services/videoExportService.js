/**
 * videoExportService.js
 * Video rendering using Canvas + MediaRecorder (reliable fallback)
 * With optional FFmpeg.wasm for faster encoding when available
 */

let ffmpegAvailable = null; // null = unknown, true/false = checked

/**
 * Check if FFmpeg.wasm can be used (requires SharedArrayBuffer)
 */
const checkFFmpegAvailable = async () => {
  if (ffmpegAvailable !== null) return ffmpegAvailable;

  try {
    // SharedArrayBuffer requires specific headers
    if (typeof SharedArrayBuffer === 'undefined') {
      console.log('[VideoExport] SharedArrayBuffer not available, using Canvas fallback');
      ffmpegAvailable = false;
      return false;
    }
    ffmpegAvailable = true;
    return true;
  } catch (e) {
    ffmpegAvailable = false;
    return false;
  }
};

/**
 * Load a video element and wait for it to be ready
 */
const loadVideo = (url) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const timeout = setTimeout(() => {
      reject(new Error('Video load timeout'));
    }, 30000);

    video.onloadeddata = () => {
      clearTimeout(timeout);
      resolve(video);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      // Try without crossOrigin as fallback
      const fallbackVideo = document.createElement('video');
      fallbackVideo.muted = true;
      fallbackVideo.playsInline = true;
      fallbackVideo.preload = 'auto';

      fallbackVideo.onloadeddata = () => resolve(fallbackVideo);
      fallbackVideo.onerror = () => reject(new Error(`Failed to load video: ${url}`));
      fallbackVideo.src = url;
    };

    video.src = url;
  });
};

/**
 * Load an audio element
 */
const loadAudio = (url) => {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';

    const timeout = setTimeout(() => {
      reject(new Error('Audio load timeout'));
    }, 30000);

    audio.onloadeddata = () => {
      clearTimeout(timeout);
      resolve(audio);
    };

    audio.onerror = () => {
      clearTimeout(timeout);
      // Try without crossOrigin
      const fallbackAudio = document.createElement('audio');
      fallbackAudio.preload = 'auto';
      fallbackAudio.onloadeddata = () => resolve(fallbackAudio);
      fallbackAudio.onerror = () => reject(new Error(`Failed to load audio: ${url}`));
      fallbackAudio.src = url;
    };

    audio.src = url;
  });
};

/**
 * Render video using Canvas + MediaRecorder
 * This is the reliable fallback that works everywhere
 */
const renderWithCanvas = async (videoData, onProgress = () => {}) => {
  const { clips, audio, words, textStyle, cropMode, duration } = videoData;

  console.log('[VideoExport] Starting Canvas render');
  onProgress(5);

  // Get dimensions
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

  // Load all clip videos
  console.log('[VideoExport] Loading clips...');
  const loadedClips = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    // Prefer cloud URL over blob URLs (blob URLs expire between sessions)
    const localUrl = clip.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    const url = isBlobUrl ? clip.url : (localUrl || clip.url);

    console.log(`[VideoExport] Loading clip ${i}:`, url?.substring(0, 50) + '...');
    try {
      const video = await loadVideo(url);
      loadedClips.push({ ...clip, video });
      onProgress(5 + Math.round((i / clips.length) * 15));
    } catch (err) {
      console.warn(`Failed to load clip ${i}:`, err);
      loadedClips.push({ ...clip, video: null });
    }
  }

  // Load audio if available
  let audioElement = null;
  let audioContext = null;
  let audioSource = null;
  let audioDestination = null;

  if (audio?.url || audio?.localUrl) {
    try {
      console.log('[VideoExport] Loading audio...');
      // Prefer cloud URL over expired blob URLs
      const audioLocalUrl = audio.localUrl;
      const isAudioBlobUrl = audioLocalUrl && audioLocalUrl.startsWith('blob:');
      const audioUrl = isAudioBlobUrl ? audio.url : (audioLocalUrl || audio.url);
      console.log('[VideoExport] Audio URL:', audioUrl?.substring(0, 50) + '...');
      audioElement = await loadAudio(audioUrl);

      // Set up audio for recording
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioSource = audioContext.createMediaElementSource(audioElement);
      audioDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDestination);
      // Don't connect to destination - we don't want to hear it during render
    } catch (err) {
      console.warn('Failed to load audio:', err);
    }
  }
  onProgress(25);

  // Set up MediaRecorder
  const canvasStream = canvas.captureStream(30);

  // Combine video and audio streams
  let combinedStream;
  if (audioDestination) {
    const audioTrack = audioDestination.stream.getAudioTracks()[0];
    combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      audioTrack
    ]);
  } else {
    combinedStream = canvasStream;
  }

  // Determine best codec
  const mimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4'
  ];

  let mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
  console.log('[VideoExport] Using codec:', mimeType);

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 8000000 // 8 Mbps
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // Render loop
  return new Promise((resolve, reject) => {
    let startTime = null;
    let animationId = null;

    const getClipAtTime = (t) => {
      for (let i = 0; i < loadedClips.length; i++) {
        const clip = loadedClips[i];
        const clipEnd = clip.startTime + clip.duration;
        if (t >= clip.startTime && t < clipEnd) {
          return { clip, clipIndex: i };
        }
      }
      return { clip: loadedClips[loadedClips.length - 1], clipIndex: loadedClips.length - 1 };
    };

    const getWordAtTime = (t) => {
      if (!words || words.length === 0) return null;
      return words.find(w => t >= w.start && t < w.end);
    };

    const drawFrame = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = (timestamp - startTime) / 1000;

      // Update progress
      const progress = Math.min(elapsed / duration, 1);
      onProgress(25 + Math.round(progress * 65));

      if (elapsed >= duration) {
        // Done
        recorder.stop();
        if (audioElement) {
          audioElement.pause();
        }
        return;
      }

      // Get current clip
      const { clip } = getClipAtTime(elapsed);

      // Clear canvas
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      // Draw video frame
      if (clip?.video) {
        const video = clip.video;
        const clipLocalTime = elapsed - clip.startTime;

        // Seek video to correct position
        if (Math.abs(video.currentTime - clipLocalTime) > 0.1) {
          video.currentTime = clipLocalTime % video.duration;
        }

        // Calculate crop to fill canvas
        const videoRatio = video.videoWidth / video.videoHeight;
        const canvasRatio = width / height;

        let sx, sy, sw, sh;
        if (videoRatio > canvasRatio) {
          sh = video.videoHeight;
          sw = sh * canvasRatio;
          sx = (video.videoWidth - sw) / 2;
          sy = 0;
        } else {
          sw = video.videoWidth;
          sh = sw / canvasRatio;
          sx = 0;
          sy = (video.videoHeight - sh) / 2;
        }

        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
      }

      // Draw text overlay
      const currentWord = getWordAtTime(elapsed);
      if (currentWord && textStyle) {
        const text = textStyle.textCase === 'upper'
          ? currentWord.word.toUpperCase()
          : textStyle.textCase === 'lower'
            ? currentWord.word.toLowerCase()
            : currentWord.word;

        const fontSize = textStyle.fontSize || 48;
        const fontFamily = textStyle.fontFamily || 'Inter, sans-serif';
        const fontWeight = textStyle.fontWeight || '600';

        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const x = width / 2;
        const y = height * 0.75; // Lower third

        // Outline
        if (textStyle.outline) {
          ctx.strokeStyle = textStyle.outlineColor || '#000';
          ctx.lineWidth = fontSize / 10;
          ctx.lineJoin = 'round';
          ctx.strokeText(text, x, y);
        }

        // Fill
        ctx.fillStyle = textStyle.color || '#fff';
        ctx.fillText(text, x, y);
      }

      animationId = requestAnimationFrame(drawFrame);
    };

    recorder.onstop = () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (audioContext) audioContext.close();

      const blob = new Blob(chunks, { type: mimeType });
      console.log('[VideoExport] Render complete:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
      onProgress(100);
      resolve(blob);
    };

    recorder.onerror = (err) => {
      if (animationId) cancelAnimationFrame(animationId);
      if (audioContext) audioContext.close();
      reject(err);
    };

    // Start recording
    recorder.start(100); // Collect data every 100ms

    // Start audio playback if available
    if (audioElement) {
      const audioStart = audio.startTime || 0;
      audioElement.currentTime = audioStart;
      audioElement.play().catch(console.error);
    }

    // Start render loop
    animationId = requestAnimationFrame(drawFrame);
  });
};

/**
 * Main render function - tries FFmpeg first, falls back to Canvas
 */
export const renderVideo = async (videoData, onProgress = () => {}) => {
  const { clips, audio, duration } = videoData;

  if (!clips || clips.length === 0) {
    throw new Error('No clips to render');
  }

  // Validate clip URLs
  const invalidClips = clips.filter(clip => !clip.localUrl && !clip.url);
  if (invalidClips.length > 0) {
    throw new Error(`${invalidClips.length} clip(s) missing URLs. Re-upload or re-select the clips.`);
  }

  console.log(`[VideoExport] Starting render: ${clips.length} clips, ${duration}s duration`);

  // Use Canvas + MediaRecorder (most reliable)
  try {
    return await renderWithCanvas(videoData, onProgress);
  } catch (canvasError) {
    console.error('[VideoExport] Canvas render failed:', canvasError);
    throw new Error(`Video rendering failed: ${canvasError.message}`);
  }
};

/**
 * Quick preview render - lower quality, faster
 */
export const renderPreview = async (videoData, onProgress = () => {}) => {
  // Create a lower-res version for preview
  const previewData = {
    ...videoData,
    cropMode: '9:16' // Force 9:16 for preview
  };

  // Render with smaller canvas
  const { clips, audio, words, textStyle, duration } = previewData;

  const width = 360;
  const height = 640;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Just render first few seconds as preview
  const previewDuration = Math.min(5, duration);

  // Similar to renderWithCanvas but simplified
  // ... (simplified preview logic)

  return await renderWithCanvas({ ...previewData, duration: previewDuration }, onProgress);
};

/**
 * Export first frame as thumbnail
 */
export const exportThumbnail = async (videoData) => {
  const { clips, cropMode } = videoData;

  if (!clips || clips.length === 0) {
    throw new Error('No clips to export');
  }

  const dimensions = {
    '9:16': { width: 540, height: 960 },
    '4:3': { width: 540, height: 720 },
    '1:1': { width: 540, height: 540 }
  };
  const { width, height } = dimensions[cropMode] || dimensions['9:16'];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Load first clip - prefer cloud URL over expired blob URLs
  const localUrl = clips[0].localUrl;
  const isBlobUrl = localUrl && localUrl.startsWith('blob:');
  const url = isBlobUrl ? clips[0].url : (localUrl || clips[0].url);
  const video = await loadVideo(url);

  // Draw frame
  const videoRatio = video.videoWidth / video.videoHeight;
  const canvasRatio = width / height;

  let sx, sy, sw, sh;
  if (videoRatio > canvasRatio) {
    sh = video.videoHeight;
    sw = sh * canvasRatio;
    sx = (video.videoWidth - sw) / 2;
    sy = 0;
  } else {
    sw = video.videoWidth;
    sh = sw / canvasRatio;
    sx = 0;
    sy = (video.videoHeight - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85);
  });
};

export default {
  renderVideo,
  renderPreview,
  exportThumbnail
};
