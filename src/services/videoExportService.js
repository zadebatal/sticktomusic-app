/**
 * videoExportService.js
 * Video rendering using Canvas + MediaRecorder (reliable fallback)
 * With FFmpeg.wasm for WebM to MP4 conversion (TikTok compatibility)
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance = null;
let ffmpegLoading = false;

/**
 * Safely clamp progress to 0-100 range
 * Handles NaN, Infinity, and negative values
 */
const safeProgress = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

/**
 * Load FFmpeg.wasm instance (lazy loading)
 */
const loadFFmpeg = async (onProgress = () => {}) => {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (ffmpegLoading) {
    // Wait for existing load to complete
    while (ffmpegLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return ffmpegInstance;
  }

  ffmpegLoading = true;

  try {
    console.log('[VideoExport] Loading FFmpeg.wasm...');
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

    console.log('[VideoExport] FFmpeg.wasm loaded successfully');
    ffmpegInstance = ffmpeg;
    ffmpegLoading = false;
    return ffmpeg;
  } catch (error) {
    console.error('[VideoExport] Failed to load FFmpeg:', error);
    ffmpegLoading = false;
    throw error;
  }
};

/**
 * Convert WebM blob to MP4 using FFmpeg.wasm
 * @param {Blob} webmBlob - The WebM video blob
 * @param {Function} onProgress - Progress callback
 * @param {Object} audioInfo - Optional audio info { buffer, startTime }
 */
const convertToMP4 = async (webmBlob, onProgress = () => {}, audioInfo = null) => {
  console.log('[VideoExport] Converting WebM to MP4...');

  try {
    const ffmpeg = await loadFFmpeg(onProgress);

    // Write input video file
    const inputName = 'input.webm';
    const audioName = 'audio.mp3';
    const outputName = 'output.mp4';

    await ffmpeg.writeFile(inputName, await fetchFile(webmBlob));

    // Build FFmpeg command
    let ffmpegArgs = ['-i', inputName];
    let hasAudio = false;

    // Add audio input if buffer was pre-fetched
    if (audioInfo?.buffer) {
      try {
        console.log('[VideoExport] Adding pre-fetched audio track...');
        await ffmpeg.writeFile(audioName, new Uint8Array(audioInfo.buffer));

        const audioStart = audioInfo.startTime || 0;
        ffmpegArgs.push('-ss', String(audioStart), '-i', audioName);
        hasAudio = true;
      } catch (audioErr) {
        console.warn('[VideoExport] Failed to add audio, continuing without:', audioErr);
      }
    }

    // Add encoding parameters
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      '-crf', '26',
      '-pix_fmt', 'yuv420p',
      '-threads', '0'
    );

    // Add audio encoding if we have audio - use faster settings
    if (hasAudio) {
      ffmpegArgs.push(
        '-c:a', 'aac',
        '-b:a', '96k', // Lower bitrate for faster encoding (still good for social media)
        '-ac', '2',    // Stereo
        '-ar', '44100', // Standard sample rate
        '-shortest'    // End when shortest input ends
      );
    }

    ffmpegArgs.push('-movflags', '+faststart', outputName);

    await ffmpeg.exec(ffmpegArgs);

    // Read output file
    const data = await ffmpeg.readFile(outputName);
    const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });

    // Clean up
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
    if (hasAudio) {
      try { await ffmpeg.deleteFile(audioName); } catch (e) { /* ignore */ }
    }

    console.log('[VideoExport] MP4 conversion complete:', (mp4Blob.size / 1024 / 1024).toFixed(2), 'MB');
    return mp4Blob;
  } catch (error) {
    console.error('[VideoExport] MP4 conversion failed:', error);
    throw error;
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

  // Validate duration to prevent NaN/Infinity in progress calculations
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 30;

  console.log('[VideoExport] Starting Canvas render');
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
  console.log('[VideoExport] Loading clips in parallel...');
  const clipPromises = clips.map(async (clip, i) => {
    // Prefer cloud URL over blob URLs (blob URLs expire between sessions)
    const localUrl = clip.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    const url = isBlobUrl ? clip.url : (localUrl || clip.url);

    console.log(`[VideoExport] Loading clip ${i}:`, url?.substring(0, 50) + '...');
    try {
      const video = await loadVideo(url);
      return { ...clip, video, index: i };
    } catch (err) {
      console.warn(`Failed to load clip ${i}:`, err);
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

  // Determine best codec - prefer VP8 for faster encoding
  const mimeTypes = [
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm',
    'video/mp4'
  ];

  let mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
  console.log('[VideoExport] Using codec:', mimeType);

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 6000000 // 6 Mbps - slightly lower for faster encoding
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // Render configuration
  const FPS = 24; // 24fps is standard for video, faster than 30fps
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
      console.log('[VideoExport] Render complete:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
      onProgress(safeProgress(100));
      resolve(blob);
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

      // Draw the frame
      drawFrameAtTime(currentTime);
      currentFrame++;

      // Process next frame immediately (faster than requestAnimationFrame)
      // Using setTimeout(0) allows the browser to process events but runs ASAP
      setTimeout(processNextFrame, 0);
    };

    // Start the fast render loop
    console.log(`[VideoExport] Rendering ${totalFrames} frames at ${FPS}fps...`);
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
  const { convertToMP4: shouldConvert = true } = options;

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
    // Pre-fetch audio in parallel with canvas rendering for speed
    let audioBufferPromise = null;
    let audioInfo = null;

    if (audio?.url || audio?.localUrl) {
      const audioLocalUrl = audio.localUrl;
      const isAudioBlobUrl = audioLocalUrl && audioLocalUrl.startsWith('blob:');
      const audioUrl = isAudioBlobUrl ? audio.url : (audioLocalUrl || audio.url);

      if (audioUrl) {
        console.log('[VideoExport] Pre-fetching audio in parallel...');
        audioBufferPromise = fetch(audioUrl)
          .then(res => res.arrayBuffer())
          .catch(err => {
            console.warn('[VideoExport] Audio pre-fetch failed:', err);
            return null;
          });

        audioInfo = {
          startTime: audio.startTime || 0
        };
      }
    }

    // Phase 1: Render WebM (0-70%) - runs in parallel with audio fetch
    const webmProgress = (p) => onProgress(safeProgress(p * 0.7));
    const webmBlob = await renderWithCanvas(videoData, webmProgress);

    // Phase 2: Convert to MP4 if requested (70-100%)
    if (shouldConvert) {
      onProgress(safeProgress(70));
      console.log('[VideoExport] Converting to MP4 for TikTok compatibility...');

      // Get pre-fetched audio buffer (should already be ready)
      if (audioBufferPromise) {
        const audioBuffer = await audioBufferPromise;
        if (audioBuffer) {
          audioInfo.buffer = audioBuffer;
        }
      }

      try {
        const mp4Progress = (p) => onProgress(safeProgress(70 + p * 0.3));
        const mp4Blob = await convertToMP4(webmBlob, mp4Progress, audioInfo);
        onProgress(safeProgress(100));
        return mp4Blob;
      } catch (conversionError) {
        console.warn('[VideoExport] MP4 conversion failed, returning WebM:', conversionError);
        // Fall back to WebM if conversion fails
        onProgress(safeProgress(100));
        return webmBlob;
      }
    }

    onProgress(safeProgress(100));
    return webmBlob;
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
