import { useMemo, useCallback } from 'react';

/**
 * usePixelTimeline — Shared hook for pixel-based timeline rendering.
 *
 * Extracts repeated logic from VideoEditorModal:
 * - pxPerSec / timelinePx calculations
 * - Smart ruler tick intervals based on zoom level
 * - Ruler click/drag to seek
 * - formatTime helper
 * - Waveform peak-picking downsampler
 *
 * @param {Object} options
 * @param {number} options.timelineScale - Current zoom scale (1 = default)
 * @param {number} options.timelineDuration - Total timeline duration in seconds
 * @param {React.RefObject} options.timelineRef - Ref to the scrollable timeline container
 * @param {function} options.handleSeek - Seek to a given time in seconds
 * @param {boolean} options.isPlaying - Whether playback is active
 * @param {function} options.setIsPlaying - Set playback state
 * @param {function} options.setPlayheadDragging - Set playhead drag state
 * @param {React.RefObject} options.wasPlayingRef - Ref tracking if playback was active before drag
 */
export default function usePixelTimeline({
  timelineScale = 1,
  timelineDuration = 0,
  timelineRef,
  handleSeek,
  isPlaying,
  setIsPlaying,
  setPlayheadDragging,
  wasPlayingRef,
}) {
  const pxPerSec = 40 * timelineScale;
  const timelinePx = timelineDuration * pxPerSec;

  // Smart ruler ticks based on zoom level
  const rulerTicks = useMemo(() => {
    if (timelineDuration <= 0) return [];
    let minor, labelEvery;
    if (pxPerSec >= 60) { minor = 0.5; labelEvery = 1; }
    else if (pxPerSec >= 30) { minor = 1; labelEvery = 5; }
    else { minor = 2; labelEvery = 10; }
    const ticks = [];
    for (let t = 0; t <= timelineDuration; t += minor) {
      const rounded = Math.round(t * 100) / 100;
      ticks.push({ time: rounded, isLabel: rounded % labelEvery === 0 });
    }
    return ticks;
  }, [timelineDuration, pxPerSec]);

  // Ruler click/drag to seek playhead
  const handleRulerMouseDown = useCallback((e) => {
    if (!timelineRef?.current || timelineDuration <= 0) return;
    e.preventDefault();
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + timelineRef.current.scrollLeft;
    handleSeek(Math.max(0, Math.min(1, clickX / timelinePx)) * timelineDuration);
    if (wasPlayingRef) wasPlayingRef.current = isPlaying;
    if (isPlaying) setIsPlaying(false);
    setPlayheadDragging(true);
  }, [timelineDuration, timelinePx, timelineRef, handleSeek, isPlaying, setIsPlaying, setPlayheadDragging, wasPlayingRef]);

  // Format time as mm:ss
  const formatTime = useCallback((seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Waveform peak-picking downsampler
  const downsample = useCallback((data, maxBars = 200) => {
    if (!data || data.length === 0) return data || [];
    if (data.length <= maxBars) return data;
    const step = data.length / maxBars;
    const result = [];
    for (let i = 0; i < maxBars; i++) {
      const start = Math.floor(i * step);
      const end = Math.floor((i + 1) * step);
      let max = 0;
      for (let j = start; j < end; j++) max = Math.max(max, data[j] || 0);
      result.push(max);
    }
    return result;
  }, []);

  return {
    pxPerSec,
    timelinePx,
    rulerTicks,
    handleRulerMouseDown,
    formatTime,
    downsample,
  };
}
