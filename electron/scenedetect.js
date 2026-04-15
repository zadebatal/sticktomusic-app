/**
 * Scene detection using histogram difference (HSV color histogram comparison).
 * This is the same approach as PySceneDetect's ContentDetector — proven and reliable.
 *
 * How it works:
 * 1. Extract all frames as small RGB images via FFmpeg
 * 2. Convert each frame to an HSV histogram (hue + saturation + value)
 * 3. Compare consecutive histograms using chi-squared distance
 * 4. Frames where distance > adaptive threshold = scene cut
 *
 * No ML model needed. Works on any video. Fast (~1s for a 30s TikTok clip).
 */

const path = require('path');
const { execSync } = require('child_process');

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 36;
const HIST_BINS = 16; // bins per channel (H, S, V)

/**
 * Convert RGB to HSV.
 * @returns {[number, number, number]} H (0-179), S (0-255), V (0-255)
 */
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 30); // 0-179 range
    if (h < 0) h += 180;
  }
  const s = max > 0 ? Math.round((d / max) * 255) : 0;
  const v = Math.round(max * 255);
  return [h, s, v];
}

/**
 * Compute an HSV histogram for a frame.
 * @param {Buffer} frameData - Raw RGB bytes for one frame
 * @returns {Float32Array} Normalized histogram (3 * HIST_BINS values)
 */
function computeHistogram(frameData) {
  const hist = new Float32Array(3 * HIST_BINS);
  const totalPixels = frameData.length / 3;

  for (let i = 0; i < frameData.length; i += 3) {
    const [h, s, v] = rgbToHsv(frameData[i], frameData[i + 1], frameData[i + 2]);
    // Bin each channel
    const hBin = Math.min(Math.floor(h / (180 / HIST_BINS)), HIST_BINS - 1);
    const sBin = Math.min(Math.floor(s / (256 / HIST_BINS)), HIST_BINS - 1);
    const vBin = Math.min(Math.floor(v / (256 / HIST_BINS)), HIST_BINS - 1);
    hist[hBin]++;
    hist[HIST_BINS + sBin]++;
    hist[2 * HIST_BINS + vBin]++;
  }

  // Normalize
  for (let i = 0; i < hist.length; i++) {
    hist[i] /= totalPixels;
  }
  return hist;
}

/**
 * Chi-squared distance between two histograms.
 */
function chiSquaredDistance(h1, h2) {
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const sum = h1[i] + h2[i];
    if (sum > 0) {
      dist += ((h1[i] - h2[i]) ** 2) / sum;
    }
  }
  return dist;
}

/**
 * Detect scene boundaries using histogram comparison.
 *
 * @param {string} videoPath - Path to video file
 * @param {string} ffmpegPath - Path to FFmpeg binary
 * @param {Object} [options] - { threshold: number (0-1, default 0.3), minSceneDuration: number (seconds, default 0.3) }
 * @returns {number[]} Array of timestamps (seconds) where cuts occur
 */
function detectScenes(videoPath, ffmpegPath, options = {}) {
  const threshold = options.threshold || 0.3;
  const minSceneDuration = options.minSceneDuration || 0.3; // minimum seconds between cuts

  // Get FPS
  let fps = 30;
  try {
    const probeCmd = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
    const fpsStr = execSync(
      `"${probeCmd}" -v error -select_streams v -of csv=p=0 -show_entries stream=r_frame_rate "${videoPath}"`,
      { timeout: 10000 }
    ).toString().trim();
    const parts = fpsStr.split('/');
    if (parts.length === 2) fps = parseInt(parts[0]) / parseInt(parts[1]);
    else fps = parseFloat(fpsStr) || 30;
  } catch {}

  // Extract all frames as raw RGB
  const raw = execSync(
    `"${ffmpegPath}" -v error -i "${videoPath}" -vf "scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=bilinear" -pix_fmt rgb24 -f rawvideo pipe:1`,
    { maxBuffer: 500 * 1024 * 1024, timeout: 120000 }
  );

  const bytesPerFrame = FRAME_WIDTH * FRAME_HEIGHT * 3;
  const frameCount = Math.floor(raw.length / bytesPerFrame);

  if (frameCount < 2) return [];

  // Compute histograms
  const histograms = [];
  for (let i = 0; i < frameCount; i++) {
    const start = i * bytesPerFrame;
    const frameData = raw.slice(start, start + bytesPerFrame);
    histograms.push(computeHistogram(frameData));
  }

  // Compute distances between consecutive frames
  const distances = [];
  for (let i = 1; i < histograms.length; i++) {
    distances.push(chiSquaredDistance(histograms[i - 1], histograms[i]));
  }

  // Absolute threshold on chi-squared distance.
  // Real scene cuts (completely different content) score 1.0+
  // Within-scene motion (same clip, camera movement) scores <0.1
  // Using 0.5 as the cutoff cleanly separates real cuts from noise.
  const absThreshold = threshold || 0.5;

  // Find candidate cut frames
  const minFrameGap = Math.round(minSceneDuration * fps);
  const candidates = [];
  let lastCut = -minFrameGap;

  for (let i = 0; i < distances.length; i++) {
    if (distances[i] > absThreshold && (i - lastCut) >= minFrameGap) {
      candidates.push(i);
      lastCut = i;
    }
  }

  // ── Flash suppression ──
  // A camera flash spikes the histogram then returns to the same scene within
  // a few frames. A real cut changes the histogram permanently.
  // For each candidate cut, compare the histogram BEFORE the cut (frame i-1)
  // with histograms 3-6 frames AFTER. If they're similar (distance < threshold),
  // the scene returned to normal → flash, not a real cut.
  const FLASH_LOOKAHEAD = Math.min(6, Math.round(fps * 0.2)); // ~200ms or 6 frames
  const FLASH_SIMILARITY = absThreshold * 0.6; // must be well below cut threshold
  const cuts = [];
  let flashesRemoved = 0;

  for (const i of candidates) {
    const preFlashFrame = i; // frame before the spike (distances[i] = diff between frame i and i+1)
    let isFlash = false;

    // Check if the scene "returns" within FLASH_LOOKAHEAD frames
    for (let look = 2; look <= FLASH_LOOKAHEAD; look++) {
      const checkFrame = i + look;
      if (checkFrame >= histograms.length) break;
      const recovery = chiSquaredDistance(histograms[preFlashFrame], histograms[checkFrame]);
      if (recovery < FLASH_SIMILARITY) {
        isFlash = true;
        break;
      }
    }

    if (isFlash) {
      flashesRemoved++;
    } else {
      cuts.push((i + 1) / fps);
    }
  }

  const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
  const maxDist = Math.max(...distances);
  console.log(`[scenedetect] ${path.basename(videoPath)}: ${frameCount} frames, ${cuts.length} cuts, ${flashesRemoved} flashes suppressed (threshold=${absThreshold}, mean=${mean.toFixed(3)}, max=${maxDist.toFixed(3)})`);
  return cuts;
}

module.exports = { detectScenes };
