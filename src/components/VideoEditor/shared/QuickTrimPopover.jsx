/**
 * QuickTrimPopover — Small popover for per-clip in/out trim points.
 * Shows mini video thumbnail, draggable in/out handles, and preview button.
 */

import { FeatherCheck, FeatherPlay, FeatherX } from '@subframe/core';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/components/Button';
import { IconButton } from '../../../ui/components/IconButton';

const POPOVER_WIDTH = 280;

const QuickTrimPopover = ({ item, initialTrimStart = 0, initialTrimEnd, onSave, onClose }) => {
  const videoDuration = item?.duration || 10;
  const [trimStart, setTrimStart] = useState(initialTrimStart || 0);
  const [trimEnd, setTrimEnd] = useState(initialTrimEnd || videoDuration);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(null); // 'start' | 'end' | null
  const rafRef = useRef(null);

  // Ensure trimEnd is valid
  useEffect(() => {
    if (trimEnd > videoDuration) setTrimEnd(videoDuration);
  }, [videoDuration, trimEnd]);

  // Get duration from video element if not provided
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || item?.duration) return;
    const onMeta = () => {
      if (vid.duration && isFinite(vid.duration)) {
        setTrimEnd((prev) => (prev > vid.duration ? vid.duration : prev));
      }
    };
    vid.addEventListener('loadedmetadata', onMeta);
    return () => vid.removeEventListener('loadedmetadata', onMeta);
  }, [item?.duration]);

  const getEffectiveDuration = useCallback(() => {
    const vid = videoRef.current;
    if (item?.duration) return item.duration;
    if (vid?.duration && isFinite(vid.duration)) return vid.duration;
    return 10;
  }, [item?.duration]);

  // Compute position from time
  const timeToPercent = useCallback(
    (time) => {
      const dur = getEffectiveDuration();
      return dur > 0 ? (time / dur) * 100 : 0;
    },
    [getEffectiveDuration],
  );

  // Handle dragging trim handles
  const handlePointerDown = useCallback(
    (handle, e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = handle;

      const moveHandler = (moveEvent) => {
        const track = trackRef.current;
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const x = (moveEvent.clientX || moveEvent.touches?.[0]?.clientX || 0) - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        const time = pct * getEffectiveDuration();

        let scrubTime;
        if (handle === 'start') {
          scrubTime = Math.min(time, trimEnd - 0.1);
          setTrimStart(scrubTime);
        } else {
          scrubTime = Math.max(time, trimStart + 0.1);
          setTrimEnd(scrubTime);
        }

        // Live-scrub the preview video to act as a playhead
        const vid = videoRef.current;
        if (vid && isFinite(scrubTime)) {
          try {
            vid.currentTime = scrubTime;
          } catch {}
        }
      };

      const upHandler = () => {
        draggingRef.current = null;
        document.removeEventListener('pointermove', moveHandler);
        document.removeEventListener('pointerup', upHandler);
        document.removeEventListener('pointercancel', upHandler);
      };

      document.addEventListener('pointermove', moveHandler);
      document.addEventListener('pointerup', upHandler);
      document.addEventListener('pointercancel', upHandler);
    },
    [trimStart, trimEnd, getEffectiveDuration],
  );

  // Preview trimmed region
  const handlePreview = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = trimStart;
    vid.play().catch(() => {});
    setIsPreviewPlaying(true);

    // Stop at trimEnd
    const check = () => {
      if (vid.currentTime >= trimEnd) {
        vid.pause();
        setIsPreviewPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(check);
    };
    rafRef.current = requestAnimationFrame(check);
  }, [trimStart, trimEnd]);

  // Cleanup
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleSave = useCallback(() => {
    onSave(trimStart, trimEnd);
  }, [trimStart, trimEnd, onSave]);

  const formatTime = (t) => {
    const s = Math.floor(t);
    const ms = Math.round((t - s) * 10);
    return `${s}.${ms}s`;
  };

  if (!item || item.type !== 'video') return null;

  return (
    <div
      className="absolute z-50 rounded-xl border border-neutral-200 bg-[#111111] shadow-2xl overflow-hidden"
      style={{ width: POPOVER_WIDTH }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
        <span className="text-caption-bold font-caption-bold text-white truncate flex-1">
          Quick Trim
        </span>
        <IconButton
          variant="neutral-tertiary"
          size="small"
          icon={<FeatherX />}
          aria-label="Close"
          onClick={onClose}
        />
      </div>

      {/* Video thumbnail */}
      <div className="relative w-full aspect-video bg-black">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          src={item.url}
          muted
          playsInline
          preload="metadata"
        />
        {!isPreviewPlaying && (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/20"
            onClick={handlePreview}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 border border-white/20">
              <FeatherPlay className="text-white" style={{ width: 12, height: 12 }} />
            </div>
          </div>
        )}
      </div>

      {/* Trim track */}
      <div className="px-3 py-3">
        <div ref={trackRef} className="relative h-6 w-full rounded bg-neutral-100 cursor-crosshair">
          {/* Selected range */}
          <div
            className="absolute top-0 h-full bg-indigo-500/30 rounded"
            style={{
              left: `${timeToPercent(trimStart)}%`,
              width: `${timeToPercent(trimEnd) - timeToPercent(trimStart)}%`,
            }}
          />

          {/* In handle (green) */}
          <div
            className="absolute top-0 h-full w-2 rounded-l cursor-ew-resize bg-green-500 hover:bg-green-400 transition-colors"
            style={{ left: `calc(${timeToPercent(trimStart)}% - 4px)` }}
            onPointerDown={(e) => handlePointerDown('start', e)}
          />

          {/* Out handle (orange) */}
          <div
            className="absolute top-0 h-full w-2 rounded-r cursor-ew-resize bg-orange-500 hover:bg-orange-400 transition-colors"
            style={{ left: `${timeToPercent(trimEnd)}%` }}
            onPointerDown={(e) => handlePointerDown('end', e)}
          />
        </div>

        {/* Time labels */}
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] font-mono text-green-400">{formatTime(trimStart)}</span>
          <span className="text-[10px] font-mono text-neutral-500">
            {formatTime(trimEnd - trimStart)} selected
          </span>
          <span className="text-[10px] font-mono text-orange-400">{formatTime(trimEnd)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 pb-3">
        <Button
          className="flex-1"
          variant="brand-primary"
          size="small"
          icon={<FeatherCheck />}
          onClick={handleSave}
        >
          Save
        </Button>
        <Button className="flex-1" variant="neutral-secondary" size="small" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default QuickTrimPopover;
