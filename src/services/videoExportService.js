/**
 * videoExportService.js
 * Video rendering using Canvas + MediaRecorder (reliable fallback)
 * With FFmpeg.wasm for WebM to MP4 conversion (TikTok compatibility)
 */

import log from '../utils/logger';

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

/**
 * Safely clamp progress to 0-100 range
 * Handles NaN, Infinity, and negative values
 */
const safeProgress = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

/**
 * Load FFmpeg.wasm instance (lazy loading, Promise-based singleton)
 * Uses a shared promise so concurrent callers wait on the same load operation
 * instead of a busy-wait loop. If loading fails, the promise is cleared so
 * the next caller retries instead of returning null.
 */
const loadFFmpeg = async (onProgress = () => {}) => {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (ffmpegLoadPromise) {
    // Another call is already loading — wait on the same promise
    return ffmpegLoadPromise;
  }

  ffmpegLoadPromise = (async () => {
    try {
      log('[VideoExport] Loading FFmpeg.wasm...');
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();

      ffmpeg.on('progress', ({ progress }) => {
        onProgress(safeProgress(progress * 100));
      });

      // Load FFmpeg with CDN URLs
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      log('[VideoExport] FFmpeg.wasm loaded successfully');
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    } catch (error) {
      log.error('[VideoExport] Failed to load FFmpeg:', error);
      ffmpegLoadPromise = null; // Clear so next call retries instead of returning stale failure
      throw error;
    }
  })();

  return ffmpegLoadPromise;
};

/**
 * Process video: add audio and convert to MP4 if needed
 * @param {Blob} videoBlob - The video blob (WebM or MP4)
 * @param {Function} onProgress - Progress callback
 * @param {Object} audioInfo - Optional audio info { buffer, startTime }
 * @param {boolean} isNativeMP4 - Whether the input is already MP4
 */
const processVideo = async (videoBlob, onProgress = () => {}, audioInfo = null, isNativeMP4 = false) => {
  const hasAudio = !!audioInfo?.buffer;

  // Always process through FFmpeg to ensure correct frame rate metadata (TikTok requires 23-60 FPS)
  // Previously returned native MP4 as-is, but captureStream(0) can produce broken frame rate metadata

  // If native MP4 with audio, just mux audio (fast)
  // If WebM, need to convert to MP4 (slower but necessary)
  const needsVideoConversion = !isNativeMP4;

  log('[VideoExport] Processing video:', {
    needsVideoConversion,
    hasAudio,
    inputSize: (videoBlob.size / 1024 / 1024).toFixed(2) + 'MB'
  });

  try {
    const ffmpeg = await loadFFmpeg(onProgress);

    const inputExt = isNativeMP4 ? 'mp4' : 'webm';
    const inputName = `input.${inputExt}`;
    const audioName = 'audio.mp3';
    const outputName = 'output.mp4';

    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob));

    // Build FFmpeg command
    let ffmpegArgs = ['-i', inputName];

    // Add audio input if available
    if (hasAudio) {
      await ffmpeg.writeFile(audioName, new Uint8Array(audioInfo.buffer));
      const audioStart = audioInfo.startTime || 0;
      ffmpegArgs.push('-ss', String(audioStart), '-i', audioName);
    }

    // Video encoding — always set output frame rate to 30fps for TikTok compatibility
    if (needsVideoConversion) {
      // Need to re-encode WebM to H.264
      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',           // Higher CRF = faster, slightly lower quality
        '-pix_fmt', 'yuv420p',
        '-r', '30'              // Force 30fps output for TikTok (requires 23-60)
      );
    } else {
      // Native MP4 — re-encode to fix frame rate metadata from captureStream(0)
      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',           // Better quality since input is already MP4
        '-pix_fmt', 'yuv420p',
        '-r', '30'              // Force 30fps output for TikTok (requires 23-60)
      );
    }

    // Audio encoding
    if (hasAudio) {
      ffmpegArgs.push(
        '-c:a', 'aac',
        '-b:a', '96k',
        '-shortest'
      );
    }

    ffmpegArgs.push('-movflags', '+faststart', outputName);

    log('[VideoExport] FFmpeg args:', ffmpegArgs.join(' '));
    await ffmpeg.exec(ffmpegArgs);

    const data = await ffmpeg.readFile(outputName);
    const outputBlob = new Blob([data.buffer], { type: 'video/mp4' });

    // Clean up
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
    if (hasAudio) {
      try { await ffmpeg.deleteFile(audioName); } catch (e) { /* ignore */ }
    }

    log('[VideoExport] Processing complete:', (outputBlob.size / 1024 / 1024).toFixed(2), 'MB');
    return outputBlob;
  } catch (error) {
    log.error('[VideoExport] Processing failed:', error);
    // Return original blob as fallback
    return videoBlob;
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

      const fallbackTimeout = setTimeout(() => {
        reject(new Error(`Video fallback load timeout: ${url}`));
      }, 30000);

      fallbackVideo.onloadeddata = () => {
        clearTimeout(fallbackTimeout);
        resolve(fallbackVideo);
      };
      fallbackVideo.onerror = () => {
        clearTimeout(fallbackTimeout);
        reject(new Error(`Failed to load video: ${url}`));
      };
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


      const fallbackTimeout = setTimeout(() => {
        reject(new Error(`Audio fallback load timeout: ${url}`));
      }, 30000);

      fallbackAudio.onloadeddata = () => {
        clearTimeout(fallbackTimeout);
        resolve(fallbackAudio);
      };
      fallbackAudio.onerror = () => {
        clearTimeout(fallbackTimeout);
        reject(new Error(`Failed to load audio: ${url}`));
      };
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

  // Validate duration to prevent NaN/Infinity in progress calculations
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 30;

  log('[VideoExport] Starting Canvas render');
  onProgress(safeProgress(5));

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

  // Load all clip videos in parallel for faster loading
  log('[VideoExport] Loading clips in parallel...');
  const clipPromises = clips.map(async (clip, i) => {
    // Prefer cloud URL over blob URLs (blob URLs expire between sessions)
    const localUrl = clip.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    const url = isBlobUrl ? clip.url : (localUrl || clip.url);

    log(`[VideoExport] Loading clip ${i}:`, url?.substring(0, 50) + '...');
    try {
      const video = await loadVideo(url);
      return { ...clip, video, index: i };
    } catch (err) {
      log.warn(`Failed to load clip ${i}:`, err);
      return { ...clip, video: null, index: i };
    }
  });

  const results = await Promise.all(clipPromises);
  // Sort by original index to maintain order
  const loadedClips = results.sort((a, b) => a.index - b.index);
  onProgress(safeProgress(20));

  // Note: Audio is handled during FFmpeg conversion, not during fast canvas rendering
  // This allows us to render frames faster than real-time
  onProgress(safeProgress(25));

  // Set up MediaRecorder with manual frame control for faster-than-real-time rendering
  // Using captureStream(0) allows us to manually trigger frame capture
  const canvasStream = canvas.captureStream(0);
  const videoTrack = canvasStream.getVideoTracks()[0];
  const combinedStream = canvasStream;

  // Prefer MP4/H.264 if browser supports it (Chrome, Edge) - avoids FFmpeg conversion!
  // Fall back to WebM which will need FFmpeg conversion later
  const mimeTypes = [
    'video/mp4;codecs=avc1',    // H.264 in MP4 - best for TikTok
    'video/mp4;codecs=h264',    // Alternative H.264
    'video/mp4',                 // Generic MP4
    'video/webm;codecs=vp8',    // WebM fallback
    'video/webm;codecs=vp9',
    'video/webm'
  ];

  let mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
  const isMP4Native = mimeType.includes('mp4');
  log('[VideoExport] Using codec:', mimeType, isMP4Native ? '(native MP4!)' : '(will need conversion)');

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 6000000 // 6 Mbps - slightly lower for faster encoding
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // Render configuration
  const FPS = 30; // 30fps — standard for social media, within TikTok's 23-60 FPS requirement
  const frameInterval = 1 / FPS;
  const totalFrames = Math.ceil(safeDuration * FPS);

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

  // Draw a single frame at the given time
  const drawFrameAtTime = (currentTime) => {
    const { clip } = getClipAtTime(currentTime);

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Draw video frame
    if (clip?.video) {
      const video = clip.video;
      const clipLocalTime = currentTime - clip.startTime;
      video.currentTime = clipLocalTime % video.duration;

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
    const currentWord = getWordAtTime(currentTime);
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
      const y = height * 0.75;

      if (textStyle.outline) {
        ctx.strokeStyle = textStyle.outlineColor || '#000';
        ctx.lineWidth = fontSize / 10;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, x, y);
      }

      if (textStyle.textStroke) {
        const match = textStyle.textStroke.match(/([\d.]+)px\s+(.*)/);
        if (match) {
          ctx.strokeStyle = match[2] || '#000000';
          ctx.lineWidth = parseFloat(match[1]);
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          for (let layer = 0; layer < 3; layer++) ctx.strokeText(text, x, y);
        }
      }

      ctx.fillStyle = textStyle.color || '#fff';
      ctx.fillText(text, x, y);
    }

    // Manually trigger frame capture
    if (videoTrack.requestFrame) {
      videoTrack.requestFrame();
    }
  };

  // Fast render loop - processes frames as fast as possible
  return new Promise((resolve, reject) => {
    let currentFrame = 0;
    let isRunning = true;

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      log('[VideoExport] Render complete:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
      onProgress(safeProgress(100));
      // Return blob and whether it's native MP4
      resolve({ blob, isNativeMP4: isMP4Native });
    };

    recorder.onerror = (err) => {
      isRunning = false;
      reject(err);
    };

    // Start recording
    recorder.start(100);

    // Fast frame processing loop using setTimeout(0) for faster-than-real-time
    const processNextFrame = () => {
      if (!isRunning) return;

      const currentTime = currentFrame * frameInterval;

      // Update progress
      const progress = currentFrame / totalFrames;
      onProgress(safeProgress(25 + progress * 65));

      if (currentFrame >= totalFrames) {
        // Done with all frames
        isRunning = false;
        recorder.stop();
        return;
      }

      // Draw the frame and explicitly request capture
      drawFrameAtTime(currentTime);
      if (videoTrack.requestFrame) videoTrack.requestFrame();
      currentFrame++;

      // Process next frame immediately (faster than requestAnimationFrame)
      // Using setTimeout(0) allows the browser to process events but runs ASAP
      setTimeout(processNextFrame, 0);
    };

    // Start the fast render loop
    log(`[VideoExport] Rendering ${totalFrames} frames at ${FPS}fps...`);
    processNextFrame();
  });
};

/**
 * Main render function - renders video and converts to MP4 for TikTok compatibility
 * @param {Object} videoData - Video data including clips, audio, words, etc.
 * @param {Function} onProgress - Progress callback (0-100)
 * @param {Object} options - Render options
 * @param {boolean} options.convertToMP4 - Whether to convert to MP4 (default: true for TikTok compatibility)
 */
export const renderVideo = async (videoData, onProgress = () => {}, options = {}) => {
  const { clips, audio, duration } = videoData;

  if (!clips || clips.length === 0) {
    throw new Error('No clips to render');
  }

  // Validate clip URLs
  const invalidClips = clips.filter(clip => !clip.localUrl && !clip.url);
  if (invalidClips.length > 0) {
    throw new Error(`${invalidClips.length} clip(s) missing URLs. Re-upload or re-select the clips.`);
  }

  log(`[VideoExport] Starting render: ${clips.length} clips, ${duration}s duration`);

  // Use Canvas + MediaRecorder (most reliable)
  try {
    // Pre-fetch audio in parallel with canvas rendering for speed
    let audioBufferPromise = null;
    let audioInfo = null;

    if (audio?.url || audio?.localUrl) {
      const audioLocalUrl = audio.localUrl;
      const isAudioBlobUrl = audioLocalUrl && audioLocalUrl.startsWith('blob:');
      // Prefer non-blob localUrl, then cloud url; skip stale blob URLs entirely
      const audioUrl = isAudioBlobUrl ? audio.url : (audioLocalUrl || audio.url);
      const isBlobUrl = audioUrl && audioUrl.startsWith('blob:');

      if (audioUrl && !isBlobUrl) {
        log('[VideoExport] Pre-fetching audio in parallel...');
        audioBufferPromise = fetch(audioUrl)
          .then(res => res.arrayBuffer())
          .catch(err => {
            log.warn('[VideoExport] Audio pre-fetch failed:', err);
            return null;
          });

        audioInfo = {
          startTime: audio.startTime || 0
        };
      } else if (isBlobUrl) {
        log.warn('[VideoExport] Audio has stale blob URL — skipping audio. Re-add from library to include audio.');
      }
    }

    // Phase 1: Render video (0-70%) - runs in parallel with audio fetch
    const renderProgress = (p) => onProgress(safeProgress(p * 0.7));
    const { blob: videoBlob, isNativeMP4 } = await renderWithCanvas(videoData, renderProgress);

    // Phase 2: Process video - add audio and convert to MP4 if needed (70-100%)
    onProgress(safeProgress(70));

    // Get pre-fetched audio buffer (should already be ready)
    if (audioBufferPromise) {
      const audioBuffer = await audioBufferPromise;
      if (audioBuffer) {
        audioInfo.buffer = audioBuffer;
      }
    }

    // Process: add audio and/or convert to MP4
    const processProgress = (p) => onProgress(safeProgress(70 + p * 0.3));
    const finalBlob = await processVideo(videoBlob, processProgress, audioInfo, isNativeMP4);
    onProgress(safeProgress(100));
    return finalBlob;
  } catch (canvasError) {
    log.error('[VideoExport] Canvas render failed:', canvasError);
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

export default {
  renderVideo,
  renderPreview
};
