/**
 * qcService.js — Auto-QC for exported content
 *
 * Pure functions that analyze rendered exports for quality issues
 * before they enter the scheduling pipeline.
 */

import log from '../utils/logger';

// ─── Constants ──────────────────────────────────────────────────────────────

const BLACK_FRAME_THRESHOLD = 15; // Average pixel brightness below this = black frame
const SILENCE_RMS_THRESHOLD = 0.005; // RMS below this = silence
const SILENCE_GAP_MAX_MS = 2000; // Max acceptable silence gap (ms)
const MIN_RESOLUTION = 720; // Minimum height (px) for quality
const SAMPLE_INTERVAL_S = 0.5; // Sample every 0.5s for black frame check

// ─── Black Frame Detection ──────────────────────────────────────────────────

/**
 * Sample video frames at intervals and check for black frames.
 * @param {HTMLVideoElement} video — loaded video element
 * @param {number} duration — video duration in seconds
 * @returns {Promise<string[]>} issues found
 */
async function checkBlackFrames(video, duration) {
  const issues = [];
  const canvas = document.createElement('canvas');
  canvas.width = 160; // Small sample is enough
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  let blackCount = 0;
  let totalSamples = 0;

  for (let t = 0.1; t < duration - 0.1; t += SAMPLE_INTERVAL_S) {
    try {
      video.currentTime = t;
      await new Promise((resolve, reject) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        const onError = () => {
          video.removeEventListener('error', onError);
          reject();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onError, { once: true });
      });

      ctx.drawImage(video, 0, 0, 160, 90);
      const imageData = ctx.getImageData(0, 0, 160, 90);
      const pixels = imageData.data;

      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      }
      const avgBrightness = sum / (pixels.length / 4);
      totalSamples++;

      if (avgBrightness < BLACK_FRAME_THRESHOLD) {
        blackCount++;
      }
    } catch {
      // Skip frames that fail to seek
    }
  }

  if (blackCount > 0) {
    const pct = Math.round((blackCount / totalSamples) * 100);
    issues.push(
      `${blackCount} black frame${blackCount > 1 ? 's' : ''} detected (${pct}% of video)`,
    );
  }

  return issues;
}

// ─── Silent Audio Detection ─────────────────────────────────────────────────

/**
 * Analyze audio for silence gaps.
 * @param {AudioBuffer} audioBuffer — decoded audio
 * @returns {string[]} issues found
 */
function checkSilenceGaps(audioBuffer) {
  const issues = [];
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows

  let silenceStart = null;
  let longestGap = 0;
  let gapCount = 0;

  for (let i = 0; i < channelData.length; i += windowSize) {
    const end = Math.min(i + windowSize, channelData.length);
    let sumSq = 0;
    for (let j = i; j < end; j++) {
      sumSq += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sumSq / (end - i));

    if (rms < SILENCE_RMS_THRESHOLD) {
      if (silenceStart === null) silenceStart = i;
    } else if (silenceStart !== null) {
      const gapMs = ((i - silenceStart) / sampleRate) * 1000;
      if (gapMs > SILENCE_GAP_MAX_MS) {
        gapCount++;
        longestGap = Math.max(longestGap, gapMs);
      }
      silenceStart = null;
    }
  }

  // Check trailing silence
  if (silenceStart !== null) {
    const gapMs = ((channelData.length - silenceStart) / sampleRate) * 1000;
    if (gapMs > SILENCE_GAP_MAX_MS) {
      gapCount++;
      longestGap = Math.max(longestGap, gapMs);
    }
  }

  if (gapCount > 0) {
    issues.push(
      `${gapCount} silence gap${gapCount > 1 ? 's' : ''} detected (longest: ${(longestGap / 1000).toFixed(1)}s)`,
    );
  }

  return issues;
}

// ─── Resolution Check ───────────────────────────────────────────────────────

/**
 * Check if video meets minimum resolution.
 * @param {number} width
 * @param {number} height
 * @returns {string[]} issues found
 */
function checkResolution(width, height) {
  const issues = [];
  if (height < MIN_RESOLUTION && width < MIN_RESOLUTION) {
    issues.push(`Low resolution: ${width}x${height} (minimum ${MIN_RESOLUTION}p recommended)`);
  }
  return issues;
}

// ─── Duration Check ─────────────────────────────────────────────────────────

/**
 * Check if actual duration matches expected.
 * @param {number} actual — actual duration (s)
 * @param {number} expected — expected duration (s)
 * @param {number} tolerance — allowed difference (s), default 1s
 * @returns {string[]} issues found
 */
function checkDuration(actual, expected, tolerance = 1) {
  const issues = [];
  if (expected && Math.abs(actual - expected) > tolerance) {
    issues.push(
      `Duration mismatch: ${actual.toFixed(1)}s actual vs ${expected.toFixed(1)}s expected`,
    );
  }
  return issues;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Quick QC check using metadata only (no media decoding).
 * Use this for instant validation before full analysis.
 *
 * @param {{ width: number, height: number, duration: number }} meta
 * @param {{ expectedDuration?: number }} options
 * @returns {{ passed: boolean, issues: string[] }}
 */
export function quickQC(meta, { expectedDuration } = {}) {
  const issues = [
    ...checkResolution(meta.width || 0, meta.height || 0),
    ...checkDuration(meta.duration || 0, expectedDuration),
  ];

  return { passed: issues.length === 0, issues };
}

/**
 * Full QC analysis on an export blob. Decodes video + audio.
 *
 * @param {Blob} blob — the exported video blob
 * @param {{ expectedDuration?: number }} options
 * @returns {Promise<{ passed: boolean, issues: string[] }>}
 */
export async function analyzeExport(blob, { expectedDuration } = {}) {
  const issues = [];

  try {
    const url = URL.createObjectURL(blob);

    // Load video
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Failed to load video for QC'));
      setTimeout(() => reject(new Error('Video load timeout')), 15000);
    });

    const duration = video.duration;
    const width = video.videoWidth;
    const height = video.videoHeight;

    // Resolution check
    issues.push(...checkResolution(width, height));

    // Duration check
    issues.push(...checkDuration(duration, expectedDuration));

    // Black frame check
    try {
      const blackIssues = await checkBlackFrames(video, duration);
      issues.push(...blackIssues);
    } catch (e) {
      log.warn('[QC] Black frame check failed:', e.message);
    }

    // Audio silence check
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      issues.push(...checkSilenceGaps(audioBuffer));
      await audioCtx.close();
    } catch (e) {
      log.warn('[QC] Audio analysis failed:', e.message);
    }

    URL.revokeObjectURL(url);

    log.info(
      `[QC] Analysis complete: ${issues.length === 0 ? 'PASSED' : `${issues.length} issue(s) found`}`,
    );
    return { passed: issues.length === 0, issues };
  } catch (e) {
    log.error('[QC] Analysis failed:', e.message);
    return { passed: false, issues: [`QC analysis failed: ${e.message}`] };
  }
}
