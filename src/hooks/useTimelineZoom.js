import { useCallback, useEffect } from 'react';

/**
 * useTimelineZoom — Shared trackpad pinch-to-zoom for timeline components.
 *
 * Handles:
 * - Trackpad pinch detection (ctrlKey/metaKey + wheel)
 * - Zoom clamping within min/max
 * - Cursor-centered zoom (scroll position preserved around cursor)
 *
 * @param {React.RefObject} containerRef - Ref to the scrollable timeline container
 * @param {Object} options
 * @param {number} options.zoom - Current zoom level
 * @param {function} options.setZoom - Zoom setter
 * @param {number} [options.minZoom=0.5] - Minimum zoom
 * @param {number} [options.maxZoom=3] - Maximum zoom
 * @param {number} [options.basePixelsPerSecond=50] - Pixels per second at zoom 1x
 * @param {number} [options.sensitivity=0.01] - Zoom sensitivity per wheel delta unit
 */
export default function useTimelineZoom(containerRef, {
  zoom,
  setZoom,
  minZoom = 0.5,
  maxZoom = 3,
  basePixelsPerSecond = 50,
  sensitivity = 0.01,
} = {}) {
  const pixelsPerSecond = basePixelsPerSecond * zoom;

  const handleWheel = useCallback((e) => {
    // Trackpad pinch-zoom is reported as wheel with ctrlKey
    if (!(e.ctrlKey || e.metaKey)) return;

    e.preventDefault();

    const delta = -e.deltaY * sensitivity;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft || 0;
    const cursorX = e.clientX - rect.left + scrollLeft;
    const cursorTime = cursorX / (basePixelsPerSecond * zoom);

    const newZoom = Math.max(minZoom, Math.min(maxZoom, zoom + delta));
    if (newZoom === zoom) return;

    setZoom(newZoom);

    // Re-center scroll on cursor position after zoom
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const newPxPerSec = basePixelsPerSecond * newZoom;
      const newCursorX = cursorTime * newPxPerSec;
      const cursorOffset = e.clientX - rect.left;
      containerRef.current.scrollLeft = newCursorX - cursorOffset;
    });
  }, [zoom, setZoom, minZoom, maxZoom, basePixelsPerSecond, sensitivity, containerRef]);

  // Attach with { passive: false } so we can preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel, containerRef]);

  return { pixelsPerSecond };
}
