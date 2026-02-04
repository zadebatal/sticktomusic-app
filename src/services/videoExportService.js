/**
 * videoExportService.js
 * Fast video rendering using FFmpeg.wasm
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;
let ffmpegLoaded = false;

/**
 * Initialize FFmpeg (lazy load)
 */
const initFFmpeg = async (onProgress) => {
  if (ffmpegLoaded && ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(Math.round(progress * 100));
    }
  });

  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);
  });

  // Load FFmpeg core from CDN
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  ffmpegLoaded = true;
  return ffmpeg;
};

/**
 * Render a video from clips and audio using FFmpeg
 * Much faster than real-time Canvas + MediaRecorder approach
 */
export const renderVideo = async (videoData, onProgress = () => {}) => {
  const { clips, audio, words, textStyle, cropMode, duration } = videoData;

  if (!clips || clips.length === 0) {
    throw new Error('No clips to render');
  }

  // Validate clip URLs
  const invalidClips = clips.filter(clip => !clip.localUrl && !clip.url);
  if (invalidClips.length > 0) {
    throw new Error(`${invalidClips.length} clip(s) missing URLs. Re-upload or re-select the clips.`);
  }

  console.log(`[VideoExport] Starting FFmpeg render: ${clips.length} clips, ${duration}s duration`);
  onProgress(5); // Show initial progress

  try {
    // Initialize FFmpeg
    console.log('[VideoExport] Loading FFmpeg...');
    const ffmpegInstance = await initFFmpeg((p) => {
      // FFmpeg progress is 0-100, map to 20-90 range
      onProgress(20 + Math.round(p * 0.7));
    });
    onProgress(10);

    // Get dimensions based on crop mode
    const dimensions = {
      '9:16': { width: 1080, height: 1920 },
      '4:3': { width: 1080, height: 1440 },
      '1:1': { width: 1080, height: 1080 }
    };
    const { width, height } = dimensions[cropMode] || dimensions['9:16'];

    // Download and write clip files to FFmpeg filesystem
    console.log('[VideoExport] Loading clips...');
    const clipFiles = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const url = clip.localUrl || clip.url;
      const filename = `clip${i}.mp4`;

      console.log(`[VideoExport] Fetching clip ${i + 1}/${clips.length}`);
      const clipData = await fetchFile(url);
      await ffmpegInstance.writeFile(filename, clipData);
      clipFiles.push({
        filename,
        duration: clip.duration || 2,
        startTime: clip.startTime || 0
      });
      onProgress(10 + Math.round((i / clips.length) * 10));
    }

    // Download and write audio if available
    let hasAudio = false;
    if (audio?.url || audio?.localUrl) {
      console.log('[VideoExport] Loading audio...');
      const audioUrl = audio.localUrl || audio.url;
      const audioData = await fetchFile(audioUrl);
      await ffmpegInstance.writeFile('audio.mp3', audioData);
      hasAudio = true;
    }
    onProgress(20);

    // Create concat file for clips
    // Each clip plays for its duration, looping if needed
    let concatContent = '';
    let currentTime = 0;

    for (let i = 0; i < clipFiles.length; i++) {
      const clip = clipFiles[i];
      const clipDuration = clip.duration;
      concatContent += `file '${clip.filename}'\n`;
      concatContent += `duration ${clipDuration}\n`;
      currentTime += clipDuration;
    }

    await ffmpegInstance.writeFile('concat.txt', concatContent);

    // Build FFmpeg command
    console.log('[VideoExport] Rendering video...');

    // Step 1: Concat clips with scaling
    const filterComplex = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v]`;

    if (hasAudio) {
      // With audio: trim audio to video duration and mix
      await ffmpegInstance.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
        '-i', 'audio.mp3',
        '-filter_complex', filterComplex,
        '-map', '[v]',
        '-map', '1:a',
        '-t', String(duration),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-y',
        'output.mp4'
      ]);
    } else {
      // No audio
      await ffmpegInstance.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
        '-filter_complex', filterComplex,
        '-map', '[v]',
        '-t', String(duration),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-y',
        'output.mp4'
      ]);
    }

    onProgress(90);

    // Read output file
    console.log('[VideoExport] Reading output...');
    const data = await ffmpegInstance.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });

    // Cleanup
    for (const clip of clipFiles) {
      await ffmpegInstance.deleteFile(clip.filename).catch(() => {});
    }
    await ffmpegInstance.deleteFile('concat.txt').catch(() => {});
    await ffmpegInstance.deleteFile('output.mp4').catch(() => {});
    if (hasAudio) {
      await ffmpegInstance.deleteFile('audio.mp3').catch(() => {});
    }

    onProgress(100);
    console.log('[VideoExport] Done!');

    return blob;
  } catch (error) {
    console.error('[VideoExport] FFmpeg error:', error);
    throw new Error(`Video rendering failed: ${error.message}`);
  }
};

/**
 * Simple preview export - just returns first frame as image
 */
export const exportAsPreview = async (videoData) => {
  const { clips } = videoData;

  if (!clips || clips.length === 0) {
    throw new Error('No clips to export');
  }

  // Load first clip and capture a frame
  const url = clips[0].localUrl || clips[0].url;

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d');

      // Draw video frame
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = canvas.width / canvas.height;

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

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    };

    video.onerror = () => reject(new Error('Failed to load video for preview'));
    video.src = url;
    video.load();
  });
};

export default {
  renderVideo,
  exportAsPreview
};
