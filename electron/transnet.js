/**
 * TransNetV2 scene detection via ONNX Runtime.
 *
 * Input: video path → extracts frames via FFmpeg → runs TransNetV2 inference
 * Output: array of timestamps (seconds) where scene cuts occur
 *
 * Model: TransNetV2 (https://github.com/soCzech/TransNetV2)
 * - Input: [1, 100, 27, 48, 3] float32 (batch of 100 frames at 27×48 RGB)
 * - Output: per-frame sigmoid probabilities [0,1] — >0.5 = scene boundary
 * - Processes in overlapping 100-frame windows, advancing 50 frames
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ort = null;
let session = null;

const MODEL_PATH = path.join(__dirname, 'models', 'transnetv2.onnx');
const FRAME_WIDTH = 48;
const FRAME_HEIGHT = 27;
const WINDOW_SIZE = 100;  // TransNetV2 expects 100 frames per batch
const STRIDE = 50;        // Advance 50 frames (overlap 50)
const THRESHOLD = 0.5;    // Scene boundary threshold

/**
 * Initialize ONNX Runtime and load the TransNetV2 model.
 * Called once, cached for subsequent calls.
 */
async function initModel() {
  if (session) return session;

  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error(`TransNetV2 model not found at ${MODEL_PATH}`);
  }

  ort = require('onnxruntime-node');
  session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'], // CoreML could be added for Apple Silicon
    graphOptimizationLevel: 'all',
  });

  console.log(`[transnet] Model loaded: ${MODEL_PATH}`);
  console.log(`[transnet] Input names: ${session.inputNames}, Output names: ${session.outputNames}`);
  return session;
}

/**
 * Extract all frames from a video as raw RGB pixels at 48×27 resolution.
 * Uses FFmpeg to decode and resize in one pass.
 *
 * @param {string} videoPath - Path to video file
 * @param {string} ffmpegPath - Path to FFmpeg binary
 * @returns {{ frames: Buffer, count: number, fps: number }}
 */
function extractFrames(videoPath, ffmpegPath) {
  // Get video FPS first
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

  // Extract all frames as raw RGB at 48×27
  const rawOutput = execSync(
    `"${ffmpegPath}" -v error -i "${videoPath}" -vf "scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=bilinear" -pix_fmt rgb24 -f rawvideo pipe:1`,
    { maxBuffer: 500 * 1024 * 1024, timeout: 120000 } // 500MB buffer, 2min timeout
  );

  const bytesPerFrame = FRAME_WIDTH * FRAME_HEIGHT * 3;
  const frameCount = Math.floor(rawOutput.length / bytesPerFrame);

  console.log(`[transnet] Extracted ${frameCount} frames at ${FRAME_WIDTH}x${FRAME_HEIGHT} (${fps.toFixed(1)} fps)`);
  return { frames: rawOutput, count: frameCount, fps };
}

/**
 * Run TransNetV2 inference on extracted frames.
 * Returns per-frame scene boundary probabilities.
 *
 * @param {Buffer} frameBuffer - Raw RGB pixel data
 * @param {number} frameCount - Total number of frames
 * @returns {Promise<Float32Array>} - Per-frame probabilities [0,1]
 */
async function runInference(frameBuffer, frameCount) {
  const sess = await initModel();
  const bytesPerFrame = FRAME_WIDTH * FRAME_HEIGHT * 3;

  // Pad frames at start and end (TransNetV2 needs context)
  const padSize = WINDOW_SIZE / 2; // 50 frames padding
  const paddedCount = frameCount + padSize * 2;

  // Build padded float32 array
  const paddedData = new Float32Array(paddedCount * FRAME_HEIGHT * FRAME_WIDTH * 3);

  // Pad start: repeat first frame
  for (let i = 0; i < padSize; i++) {
    const srcOffset = 0; // first frame
    for (let j = 0; j < bytesPerFrame; j++) {
      paddedData[i * bytesPerFrame + j] = frameBuffer[srcOffset + j];
    }
  }

  // Copy actual frames
  for (let i = 0; i < frameCount; i++) {
    const srcOffset = i * bytesPerFrame;
    const dstOffset = (i + padSize) * bytesPerFrame;
    for (let j = 0; j < bytesPerFrame; j++) {
      paddedData[dstOffset + j] = frameBuffer[srcOffset + j];
    }
  }

  // Pad end: repeat last frame
  const lastFrameOffset = (frameCount - 1) * bytesPerFrame;
  for (let i = 0; i < padSize; i++) {
    const dstOffset = (frameCount + padSize + i) * bytesPerFrame;
    for (let j = 0; j < bytesPerFrame; j++) {
      paddedData[dstOffset + j] = frameBuffer[lastFrameOffset + j];
    }
  }

  // Process in overlapping windows
  const allPredictions = new Float32Array(frameCount);
  const windowPixels = WINDOW_SIZE * FRAME_HEIGHT * FRAME_WIDTH * 3;

  for (let start = 0; start + WINDOW_SIZE <= paddedCount; start += STRIDE) {
    // Extract window
    const windowData = new Float32Array(windowPixels);
    const srcStart = start * bytesPerFrame;
    for (let i = 0; i < windowPixels; i++) {
      windowData[i] = paddedData[srcStart + i];
    }

    // Create tensor: [1, 100, 27, 48, 3]
    const tensor = new ort.Tensor('float32', windowData, [1, WINDOW_SIZE, FRAME_HEIGHT, FRAME_WIDTH, 3]);
    const inputName = sess.inputNames[0];
    const feeds = { [inputName]: tensor };

    // Run inference
    const results = await sess.run(feeds);

    // Get predictions (first output = single-frame predictions)
    const outputName = sess.outputNames[0];
    const rawPreds = results[outputName].data;

    // Apply sigmoid: 1 / (1 + exp(-x))
    const preds = new Float32Array(WINDOW_SIZE);
    for (let i = 0; i < WINDOW_SIZE; i++) {
      preds[i] = 1.0 / (1.0 + Math.exp(-rawPreds[i]));
    }

    // Only keep middle STRIDE predictions (avoid edge artifacts)
    const keepStart = start === 0 ? 0 : STRIDE / 2;
    const keepEnd = start + WINDOW_SIZE >= paddedCount ? WINDOW_SIZE : STRIDE / 2 + STRIDE;

    for (let i = keepStart; i < keepEnd; i++) {
      const frameIdx = start + i - padSize;
      if (frameIdx >= 0 && frameIdx < frameCount) {
        allPredictions[frameIdx] = preds[i];
      }
    }
  }

  return allPredictions;
}

/**
 * Detect scene boundaries in a video using TransNetV2.
 *
 * @param {string} videoPath - Path to video file
 * @param {string} ffmpegPath - Path to FFmpeg binary
 * @param {number} [threshold=0.5] - Detection threshold (0-1)
 * @returns {Promise<number[]>} - Array of timestamps (seconds) where cuts occur
 */
async function detectScenes(videoPath, ffmpegPath, threshold = THRESHOLD) {
  const { frames, count, fps } = extractFrames(videoPath, ffmpegPath);

  if (count < 2) {
    console.log(`[transnet] Video too short (${count} frames), skipping`);
    return [];
  }

  console.log(`[transnet] Running inference on ${count} frames...`);
  const predictions = await runInference(frames, count);

  // Find frames where prediction exceeds threshold
  const cutFrames = [];
  for (let i = 1; i < predictions.length; i++) {
    if (predictions[i] > threshold) {
      cutFrames.push(i);
    }
  }

  if (cutFrames.length === 0) {
    console.log(`[transnet] No scene cuts detected above threshold ${threshold}`);
    return [];
  }

  // Merge adjacent cut frames (keep only the peak of each group)
  const mergedCuts = [];
  let group = [cutFrames[0]];
  for (let i = 1; i < cutFrames.length; i++) {
    if (cutFrames[i] - cutFrames[i - 1] <= 2) {
      group.push(cutFrames[i]);
    } else {
      if (group.length > 0) {
        // Pick the frame with highest probability in the group
        let bestFrame = group[0];
        let bestProb = predictions[group[0]];
        for (const f of group) {
          if (predictions[f] > bestProb) {
            bestProb = predictions[f];
            bestFrame = f;
          }
        }
        mergedCuts.push(bestFrame);
      }
      group = [cutFrames[i]];
    }
  }
  // Don't forget the last group
  if (group.length > 0 && group[0] !== undefined) {
    let bestFrame = group[0];
    let bestProb = predictions[group[0]];
    for (const f of group) {
      if (predictions[f] > bestProb) {
        bestProb = predictions[f];
        bestFrame = f;
      }
    }
    mergedCuts.push(bestFrame);
  }

  // Convert frame indices to timestamps
  // +1 frame offset: the detected frame is the last of the old scene, cut starts at next frame
  const cutTimes = mergedCuts.map((f) => (f + 1) / fps);

  console.log(`[transnet] Detected ${cutTimes.length} scene cuts (threshold=${threshold})`);
  return cutTimes;
}

/**
 * Check if TransNetV2 model AND ONNX runtime are available.
 */
function isAvailable() {
  if (!fs.existsSync(MODEL_PATH)) {
    console.warn(`[transnet] Model not found at ${MODEL_PATH}`);
    return false;
  }
  try {
    require('onnxruntime-node');
    return true;
  } catch (err) {
    console.warn(`[transnet] ONNX Runtime not available: ${err.message}`);
    return false;
  }
}

module.exports = { detectScenes, isAvailable, initModel };
