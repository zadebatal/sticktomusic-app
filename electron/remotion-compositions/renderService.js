/**
 * renderService.js — Remotion-based video rendering for the Electron desktop app.
 * Uses @remotion/renderer to produce frame-perfect MP4 output.
 * Falls back to the Canvas+MediaRecorder pipeline if Remotion rendering fails.
 */
import log from '../utils/logger';

const FPS = 30;

const DIMENSIONS = {
  '9:16': { width: 1080, height: 1920 },
  '4:3': { width: 1440, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

/**
 * Check if Remotion rendering is available (Electron desktop only).
 * Remotion's renderMedia() requires Node.js APIs (spawns headless Chrome),
 * so it only works in the Electron main process via IPC.
 */
export function isRemotionAvailable() {
  return !!(window.electronAPI?.remotionRender);
}

/**
 * Render a montage video using Remotion via Electron IPC.
 * The actual rendering happens in the Electron main process.
 *
 * @param {Object} videoData - Same shape as renderWithCanvas: { clips, audio, words, textStyle, cropMode, duration, textOverlays }
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<{blob: Blob, isNativeMP4: boolean}>}
 */
export async function renderWithRemotion(videoData, onProgress = () => {}) {
  const { clips, audio, words, textStyle, cropMode, duration, textOverlays } = videoData;
  const dims = DIMENSIONS[cropMode] || DIMENSIONS['9:16'];
  const totalFrames = Math.ceil(duration * FPS);

  log(`[Remotion] Starting render: ${clips.length} clips, ${duration}s, ${dims.width}x${dims.height}`);
  onProgress(5);

  // Serialize the composition props for IPC transfer
  const compositionProps = {
    clips: clips.map((c) => ({
      id: c.id,
      url: c.url,
      localUrl: c.localUrl,
      startTime: c.startTime || 0,
      duration: c.duration || 1,
      sourceOffset: c.sourceOffset || 0,
    })),
    audioUrl: audio?.url || audio?.localUrl || null,
    audioStartTime: audio?.startTime || 0,
    words: (words || []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
    textStyle: textStyle || {},
    textOverlays: (textOverlays || []).map((o) => ({
      text: o.text,
      startTime: o.startTime || 0,
      endTime: o.endTime,
      style: o.style || textStyle || {},
    })),
    cropMode: cropMode || '9:16',
  };

  try {
    // Send to Electron main process for rendering
    const result = await window.electronAPI.remotionRender({
      compositionProps,
      width: dims.width,
      height: dims.height,
      fps: FPS,
      durationInFrames: totalFrames,
      onProgress: (p) => onProgress(Math.round(p * 90) + 5), // 5-95%
    });

    onProgress(95);

    // Result is a file path — read it as a blob
    const response = await fetch(`file://${result.outputPath}`);
    const blob = await response.blob();

    log(`[Remotion] Render complete: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    onProgress(100);

    return { blob, isNativeMP4: true };
  } catch (err) {
    log.error('[Remotion] Render failed, will fall back to canvas:', err);
    throw err; // Let caller handle fallback
  }
}
