/**
 * photoMontageExportService.js
 * Renders a photo montage video from a sequence of images with Ken Burns effects.
 * Uses Canvas + MediaRecorder for capture, FFmpeg.wasm for MP4 conversion.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import log from '../utils/logger';
import { KB_EFFECTS } from '../components/VideoEditor/shared/kenBurnsPresets';

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

const safeProgress = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const loadFFmpeg = async () => {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    try {
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    } catch (error) {
      ffmpegLoadPromise = null;
      throw error;
    }
  })();
  return ffmpegLoadPromise;
};

/**
 * Load an image and return an HTMLImageElement
 */
const loadImage = (url) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      // Retry without crossOrigin for same-origin images
      const img2 = new Image();
      img2.onload = () => resolve(img2);
      img2.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img2.src = url;
    };
    img.src = url;
  });
};

/**
 * Get canvas dimensions for an aspect ratio
 */
const getCanvasSize = (aspectRatio) => {
  switch (aspectRatio) {
    case '1:1': return { width: 1080, height: 1080 };
    case '4:5': return { width: 1080, height: 1350 };
    case '16:9': return { width: 1920, height: 1080 };
    default: return { width: 1080, height: 1920 }; // 9:16
  }
};

/**
 * Draw a photo onto the canvas with Ken Burns transform
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} img
 * @param {number} progress - 0 to 1 (how far through this photo's display time)
 * @param {Object} effect - Ken Burns effect params
 * @param {number} canvasW - Canvas width
 * @param {number} canvasH - Canvas height
 */
const drawPhotoWithKenBurns = (ctx, img, progress, effect, canvasW, canvasH) => {
  const t = progress;
  const scale = effect.startScale + (effect.endScale - effect.startScale) * t;
  const offsetX = (effect.startX + (effect.endX - effect.startX) * t) * canvasW;
  const offsetY = (effect.startY + (effect.endY - effect.startY) * t) * canvasH;

  // Center-crop the image to fill canvas
  const imgAspect = img.width / img.height;
  const canvasAspect = canvasW / canvasH;

  let sx, sy, sw, sh;
  if (imgAspect > canvasAspect) {
    // Image is wider — crop sides
    sh = img.height;
    sw = sh * canvasAspect;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    // Image is taller — crop top/bottom
    sw = img.width;
    sh = sw / canvasAspect;
    sx = 0;
    sy = (img.height - sh) / 2;
  }

  ctx.save();
  ctx.translate(canvasW / 2 + offsetX, canvasH / 2 + offsetY);
  ctx.scale(scale, scale);
  ctx.drawImage(img, sx, sy, sw, sh, -canvasW / 2, -canvasH / 2, canvasW, canvasH);
  ctx.restore();
};

/**
 * Draw crossfade between two photos
 */
const drawCrossfade = (ctx, imgA, imgB, fadeProgress, effectA, effectB, progressA, progressB, canvasW, canvasH) => {
  // Draw photo A
  ctx.globalAlpha = 1 - fadeProgress;
  drawPhotoWithKenBurns(ctx, imgA, progressA, effectA, canvasW, canvasH);
  // Draw photo B on top
  ctx.globalAlpha = fadeProgress;
  drawPhotoWithKenBurns(ctx, imgB, progressB, effectB, canvasW, canvasH);
  ctx.globalAlpha = 1;
};

/**
 * Render a photo montage to a video Blob
 * @param {Object} params
 * @param {Array<{url: string, duration: number}>} params.photos - Photos with URLs and durations
 * @param {string} params.aspectRatio - '9:16', '1:1', '4:5', '16:9'
 * @param {string} params.transition - 'cut' or 'crossfade'
 * @param {boolean} params.kenBurns - Enable Ken Burns effects
 * @param {Object|null} params.audio - Optional audio { url, startTime, endTime }
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<Blob>} Final MP4 video blob
 */
export const renderPhotoMontage = async ({ photos, aspectRatio = '9:16', transition = 'cut', kenBurns = true, audio = null }, onProgress = () => {}) => {
  if (!photos || photos.length === 0) throw new Error('No photos to render');

  const FPS = 30;
  const CROSSFADE_DURATION = 0.3; // seconds
  const { width: canvasW, height: canvasH } = getCanvasSize(aspectRatio);

  // Phase 1: Load all images (0-20%)
  onProgress(safeProgress(5));
  log('[PhotoMontage] Loading', photos.length, 'images...');
  const loadedImages = await Promise.all(
    photos.map(async (photo, i) => {
      const img = await loadImage(photo.url);
      onProgress(safeProgress(5 + (i / photos.length) * 15));
      return img;
    })
  );

  // Assign Ken Burns effects (randomized per photo)
  const effects = photos.map((_, i) => kenBurns ? KB_EFFECTS[i % KB_EFFECTS.length] : { startScale: 1, endScale: 1, startX: 0, startY: 0, endX: 0, endY: 0 });

  // Calculate total duration
  const totalDuration = photos.reduce((sum, p) => sum + (p.duration || 1), 0);
  const totalFrames = Math.ceil(totalDuration * FPS);

  // Build timeline: { photoIndex, startTime, endTime }
  const timeline = [];
  let cumulativeTime = 0;
  photos.forEach((photo, i) => {
    const dur = photo.duration || 1;
    timeline.push({ index: i, startTime: cumulativeTime, endTime: cumulativeTime + dur });
    cumulativeTime += dur;
  });

  // Phase 2: Render frames (20-75%)
  log('[PhotoMontage] Rendering', totalFrames, 'frames...');
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  const stream = canvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0];

  // Pick best mime type
  const mimeTypes = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
  const isNativeMP4 = mimeType.startsWith('video/mp4');

  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const renderPromise = new Promise((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };
    recorder.onerror = reject;
  });

  recorder.start(100);

  // Render each frame
  for (let frame = 0; frame < totalFrames; frame++) {
    const currentTime = frame / FPS;

    // Find current photo
    let currentPhotoIdx = timeline.findIndex(t => currentTime >= t.startTime && currentTime < t.endTime);
    if (currentPhotoIdx === -1) currentPhotoIdx = timeline.length - 1;

    const slot = timeline[currentPhotoIdx];
    const localProgress = (currentTime - slot.startTime) / (slot.endTime - slot.startTime);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (transition === 'crossfade' && currentPhotoIdx < timeline.length - 1) {
      const timeUntilEnd = slot.endTime - currentTime;
      if (timeUntilEnd < CROSSFADE_DURATION) {
        // In crossfade zone
        const fadeProgress = 1 - (timeUntilEnd / CROSSFADE_DURATION);
        const nextIdx = currentPhotoIdx + 1;
        const nextSlot = timeline[nextIdx];
        const nextLocalProgress = 0; // just starting
        drawCrossfade(ctx, loadedImages[currentPhotoIdx], loadedImages[nextIdx], fadeProgress, effects[currentPhotoIdx], effects[nextIdx], localProgress, nextLocalProgress, canvasW, canvasH);
      } else {
        drawPhotoWithKenBurns(ctx, loadedImages[currentPhotoIdx], localProgress, effects[currentPhotoIdx], canvasW, canvasH);
      }
    } else {
      drawPhotoWithKenBurns(ctx, loadedImages[currentPhotoIdx], localProgress, effects[currentPhotoIdx], canvasW, canvasH);
    }

    if (videoTrack.requestFrame) videoTrack.requestFrame();

    // Report progress
    if (frame % 10 === 0) {
      onProgress(safeProgress(20 + (frame / totalFrames) * 55));
    }

    // Yield to browser — faster than real-time but non-blocking
    if (frame % 5 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  recorder.stop();
  const rawBlob = await renderPromise;
  log('[PhotoMontage] Raw video:', (rawBlob.size / 1024 / 1024).toFixed(2), 'MB');

  // Phase 3: FFmpeg MP4 conversion + audio mux (75-100%)
  onProgress(safeProgress(78));
  try {
    const ffmpeg = await loadFFmpeg();
    const inputExt = isNativeMP4 ? 'mp4' : 'webm';
    await ffmpeg.writeFile(`input.${inputExt}`, await fetchFile(rawBlob));

    let ffmpegArgs = ['-i', `input.${inputExt}`];

    // Add audio if present
    const hasAudio = !!(audio?.url);
    if (hasAudio) {
      const audioResp = await fetch(audio.url);
      const audioBuf = await audioResp.arrayBuffer();
      await ffmpeg.writeFile('audio.mp3', new Uint8Array(audioBuf));
      const audioStart = audio.startTime || 0;
      ffmpegArgs.push('-ss', String(audioStart), '-i', 'audio.mp3');
    }

    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-r', '30'
    );

    if (hasAudio) {
      ffmpegArgs.push('-c:a', 'aac', '-b:a', '96k', '-shortest');
    }

    ffmpegArgs.push('-movflags', '+faststart', 'output.mp4');

    onProgress(safeProgress(85));
    await ffmpeg.exec(ffmpegArgs);

    const data = await ffmpeg.readFile('output.mp4');
    const finalBlob = new Blob([data.buffer], { type: 'video/mp4' });

    // Clean up
    await ffmpeg.deleteFile(`input.${inputExt}`);
    await ffmpeg.deleteFile('output.mp4');
    if (hasAudio) { try { await ffmpeg.deleteFile('audio.mp3'); } catch (e) { /* ignore */ } }

    onProgress(100);
    log('[PhotoMontage] Final MP4:', (finalBlob.size / 1024 / 1024).toFixed(2), 'MB');
    return finalBlob;
  } catch (error) {
    log.error('[PhotoMontage] FFmpeg failed, returning raw blob:', error);
    onProgress(100);
    return rawBlob;
  }
};
