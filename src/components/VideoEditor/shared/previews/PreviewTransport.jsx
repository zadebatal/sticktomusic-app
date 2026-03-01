/**
 * PreviewTransport — Shared transport bar for format previews.
 * Play/pause, reroll, scrub-able mini timeline with cells + playhead,
 * and optional text track rows with draggable start/end edges.
 */
import React, { useCallback, useRef, useEffect } from 'react';
import {
  FeatherPlay, FeatherPause, FeatherShuffle, FeatherFilm, FeatherRefreshCw,
} from '@subframe/core';

const HANDLE_W = 6; // px width of drag handles

const PreviewTransport = ({
  isPlaying = false,
  onToggle,
  onReroll,
  progress = 0,
  items = [],
  activeIdx = 0,
  onCellClick,
  onScrub,
  showReroll = true,
  showPlayhead = true,
  totalDuration = 30,
  // Text tracks: [{ id, label, color, start, end }]
  textTracks = [],
  onTextTrackChange,
}) => {
  const timelineRef = useRef(null);
  const progressBarRef = useRef(null);
  const scrubbingRef = useRef(false);

  // Convert pointer X on timeline to 0-1 fraction (accounts for scroll offset + full strip width)
  const getProgressFromEvent = useCallback((e) => {
    const el = timelineRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX || 0) - rect.left + el.scrollLeft;
    const fullWidth = el.scrollWidth || rect.width;
    return Math.max(0, Math.min(1, x / fullWidth));
  }, []);

  // --- Cell strip interaction ---
  const handleTimelinePointerDown = useCallback((e) => {
    e.preventDefault();
    scrubbingRef.current = true;
    const pct = getProgressFromEvent(e);

    if (pct !== null) {
      if (showPlayhead && onScrub) {
        onScrub(pct * totalDuration);
      } else if (onCellClick && items.length > 0) {
        const idx = Math.min(Math.floor(pct * items.length), items.length - 1);
        onCellClick(idx);
      }
    }

    const moveHandler = (moveEvt) => {
      if (!scrubbingRef.current) return;
      const p = getProgressFromEvent(moveEvt);
      if (p !== null) {
        if (showPlayhead && onScrub) {
          onScrub(p * totalDuration);
        } else if (onCellClick && items.length > 0) {
          const idx = Math.min(Math.floor(p * items.length), items.length - 1);
          onCellClick(idx);
        }
      }
    };

    const upHandler = () => {
      scrubbingRef.current = false;
      document.removeEventListener('pointermove', moveHandler);
      document.removeEventListener('pointerup', upHandler);
      document.removeEventListener('pointercancel', upHandler);
    };

    document.addEventListener('pointermove', moveHandler);
    document.addEventListener('pointerup', upHandler);
    document.addEventListener('pointercancel', upHandler);
  }, [getProgressFromEvent, onScrub, onCellClick, items.length, totalDuration, showPlayhead]);

  // --- Progress bar scrub ---
  const handleProgressBarPointerDown = useCallback((e) => {
    if (!onScrub) return;
    e.preventDefault();

    const getPct = (evt) => {
      const el = progressBarRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = (evt.clientX || 0) - rect.left;
      return Math.max(0, Math.min(1, x / rect.width));
    };

    const pct = getPct(e);
    if (pct !== null) onScrub(pct * totalDuration);

    const moveHandler = (moveEvt) => {
      const p = getPct(moveEvt);
      if (p !== null) onScrub(p * totalDuration);
    };

    const upHandler = () => {
      document.removeEventListener('pointermove', moveHandler);
      document.removeEventListener('pointerup', upHandler);
      document.removeEventListener('pointercancel', upHandler);
    };

    document.addEventListener('pointermove', moveHandler);
    document.addEventListener('pointerup', upHandler);
    document.addEventListener('pointercancel', upHandler);
  }, [onScrub, totalDuration]);

  // --- Text track edge drag ---
  const handleTextEdgeDrag = useCallback((trackId, edge, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onTextTrackChange || !timelineRef.current) return;

    const track = textTracks.find(t => t.id === trackId);
    if (!track) return;

    const getTimePct = (evt) => {
      const el = timelineRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = (evt.clientX || 0) - rect.left;
      return Math.max(0, Math.min(1, x / rect.width));
    };

    const moveHandler = (moveEvt) => {
      const pct = getTimePct(moveEvt);
      if (pct === null) return;
      const time = pct * totalDuration;
      if (edge === 'start') {
        onTextTrackChange(trackId, { start: Math.min(time, track.end - 0.5) });
      } else {
        onTextTrackChange(trackId, { end: Math.max(time, track.start + 0.5) });
      }
    };

    const upHandler = () => {
      document.removeEventListener('pointermove', moveHandler);
      document.removeEventListener('pointerup', upHandler);
      document.removeEventListener('pointercancel', upHandler);
    };

    document.addEventListener('pointermove', moveHandler);
    document.addEventListener('pointerup', upHandler);
    document.addEventListener('pointercancel', upHandler);
  }, [textTracks, onTextTrackChange, totalDuration]);

  const stripRef = useRef(null);
  const MIN_CELL_W = 24; // minimum px per cell so thumbnails are visible

  // Auto-scroll filmstrip to keep active cell in view
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || items.length <= 1) return;
    const cellW = Math.max(MIN_CELL_W, strip.parentElement?.clientWidth / items.length || MIN_CELL_W);
    const needsScroll = cellW * items.length > strip.parentElement?.clientWidth;
    if (!needsScroll) return;
    const targetX = activeIdx * cellW - strip.parentElement.clientWidth / 2 + cellW / 2;
    strip.scrollLeft = Math.max(0, targetX);
  }, [activeIdx, items.length]);

  return (
    <div className="flex w-full flex-col gap-1 pt-2">
      {/* Mini timeline — scrolling filmstrip with optional playhead */}
      {items.length > 1 && (
        <div
          ref={(el) => { timelineRef.current = el; stripRef.current = el; }}
          className="relative w-full h-7 overflow-x-auto cursor-pointer select-none scrollbar-none"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          onPointerDown={handleTimelinePointerDown}
        >
          <div
            className="relative flex items-end gap-px h-full"
            style={{ width: items.length > 0 ? `max(100%, ${items.length * MIN_CELL_W}px)` : '100%' }}
          >
            {items.map((item, i) => {
              const isActive = i === activeIdx;
              return (
                <div
                  key={item.id || i}
                  className={`relative flex-1 h-full rounded-sm overflow-hidden ${
                    isActive ? 'ring-1 ring-indigo-500 brightness-100' : 'brightness-50 hover:brightness-75'
                  }`}
                  style={{ minWidth: MIN_CELL_W }}
                  title={item.name || `Item ${i + 1}`}
                >
                  {item.type === 'video' ? (
                    item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-neutral-800">
                        <FeatherFilm className="text-neutral-600" style={{ width: 8, height: 8 }} />
                      </div>
                    )
                  ) : (
                    <img src={item.thumbnailUrl || item.url} alt="" className="w-full h-full object-cover" draggable={false} />
                  )}
                </div>
              );
            })}
            {/* Playhead — inside the strip so it scrolls with cells */}
            {showPlayhead && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                style={{ left: `${Math.min(progress * 100, 100)}%`, transition: 'none' }}
              >
                <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-red-500" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Text track rows */}
      {textTracks.length > 0 && (
        <div className="flex w-full flex-col gap-0.5">
          {textTracks.map(track => {
            const leftPct = (track.start / totalDuration) * 100;
            const widthPct = ((track.end - track.start) / totalDuration) * 100;
            return (
              <div key={track.id} className="relative w-full h-4 rounded-sm bg-neutral-900 overflow-visible select-none">
                {/* Colored bar */}
                <div
                  className="absolute top-0 bottom-0 rounded-sm flex items-center overflow-hidden"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: `${track.color}33`,
                    border: `1px solid ${track.color}88`,
                    minWidth: 12,
                  }}
                >
                  <span
                    className="text-[8px] font-medium truncate px-1 pointer-events-none"
                    style={{ color: track.color }}
                  >
                    {track.label}
                  </span>
                </div>

                {/* Left drag handle */}
                <div
                  className="absolute top-0 bottom-0 cursor-col-resize z-10"
                  style={{
                    left: `calc(${leftPct}% - ${HANDLE_W / 2}px)`,
                    width: HANDLE_W,
                  }}
                  onPointerDown={(e) => handleTextEdgeDrag(track.id, 'start', e)}
                >
                  <div
                    className="absolute top-0 bottom-0 rounded-l-sm"
                    style={{ width: 2, backgroundColor: track.color, left: HANDLE_W / 2 - 1 }}
                  />
                </div>

                {/* Right drag handle */}
                <div
                  className="absolute top-0 bottom-0 cursor-col-resize z-10"
                  style={{
                    left: `calc(${leftPct + widthPct}% - ${HANDLE_W / 2}px)`,
                    width: HANDLE_W,
                  }}
                  onPointerDown={(e) => handleTextEdgeDrag(track.id, 'end', e)}
                >
                  <div
                    className="absolute top-0 bottom-0 rounded-r-sm"
                    style={{ width: 2, backgroundColor: track.color, left: HANDLE_W / 2 - 1 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transport controls */}
      <div className="flex items-center gap-2">
        <button
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 border-none cursor-pointer transition-colors"
          onClick={onToggle}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <FeatherPause className="text-white" style={{ width: 12, height: 12 }} />
          ) : (
            <FeatherPlay className="text-white" style={{ width: 12, height: 12 }} />
          )}
        </button>

        <div
          ref={progressBarRef}
          className={`flex-1 h-1 rounded-full bg-neutral-800 overflow-hidden ${onScrub ? 'cursor-pointer' : ''}`}
          onPointerDown={handleProgressBarPointerDown}
        >
          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${progress * 100}%`, transition: 'none' }} />
        </div>

        {showReroll && onReroll && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 cursor-pointer transition-colors"
            onClick={onReroll}
            aria-label="Reroll current clip"
            title="Swap current clip"
          >
            <FeatherRefreshCw className="text-neutral-300" style={{ width: 12, height: 12 }} />
            <span className="text-caption font-caption text-neutral-300">Reroll</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default PreviewTransport;
