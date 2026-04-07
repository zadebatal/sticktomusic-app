/**
 * VideoPreviewLightbox — Reusable fullscreen video/image preview modal.
 * Supports clip cycling with arrows (on-screen + keyboard).
 *
 * @param {Object} item - Media item { url, localUrl, name, type, duration }
 * @param {Function} onClose - Close callback
 * @param {Function} [onTrim] - Optional trim callback; shows scissors button when provided
 * @param {Function} [onPrev] - Go to previous item (shows left arrow when provided)
 * @param {Function} [onNext] - Go to next item (shows right arrow when provided)
 */
import React, { useEffect, useCallback } from 'react';
import { FeatherX, FeatherScissors, FeatherChevronLeft, FeatherChevronRight } from '@subframe/core';

const VideoPreviewLightbox = ({ item, onClose, onTrim, onPrev, onNext }) => {
  // Keyboard navigation
  useEffect(() => {
    if (!item) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [item, onClose, onPrev, onNext]);

  if (!item) return null;

  const src = item.localUrl || item.url;
  if (!src) return null;

  const isVideo = item.type === 'video' || src.match(/\.(mp4|mov|webm|mkv)(\?|$)/i);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      {/* Left arrow */}
      {onPrev && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 z-[51] h-10 w-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center border-none cursor-pointer transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          title="Previous (←)"
        >
          <FeatherChevronLeft className="text-white" style={{ width: 20, height: 20 }} />
        </button>
      )}

      {/* Right arrow */}
      {onNext && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 z-[51] h-10 w-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center border-none cursor-pointer transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          title="Next (→)"
        >
          <FeatherChevronRight className="text-white" style={{ width: 20, height: 20 }} />
        </button>
      )}

      <div className="relative max-w-3xl max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video
            key={src}
            src={src}
            controls
            autoPlay
            className="max-w-full max-h-[80vh] rounded-lg"
          />
        ) : (
          <img
            src={src}
            alt={item.name || 'Preview'}
            className="max-w-full max-h-[80vh] rounded-lg object-contain"
          />
        )}

        {/* Top bar: name + actions */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-2">
          {/* Media name */}
          <span className="text-[11px] text-white/70 bg-black/60 rounded px-2 py-1 truncate max-w-[60%]">
            {item.name || 'Untitled'}
          </span>

          <div className="flex items-center gap-2">
            {/* Trim button */}
            {onTrim && isVideo && (
              <button
                className="h-8 w-8 rounded-full bg-black/80 flex items-center justify-center hover:bg-indigo-600 transition-colors border-none cursor-pointer"
                onClick={() => onTrim(item)}
                title="Trim clip"
              >
                <FeatherScissors className="text-white" style={{ width: 14, height: 14 }} />
              </button>
            )}

            {/* Close button */}
            <button
              className="h-8 w-8 rounded-full bg-black/80 flex items-center justify-center hover:bg-black transition-colors border-none cursor-pointer"
              onClick={onClose}
            >
              <FeatherX className="text-white" style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPreviewLightbox;
