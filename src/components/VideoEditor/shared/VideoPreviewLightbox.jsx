/**
 * VideoPreviewLightbox — Reusable fullscreen video/image preview modal.
 * Supports clip cycling with arrows (on-screen + keyboard).
 * Renders a friendly "offline" panel when item.syncStatus === 'offline'
 * instead of a broken <video> element.
 *
 * @param {Object} item - Media item { url, localUrl, name, type, duration, syncStatus, localPath, metadata }
 * @param {Function} onClose - Close callback
 * @param {Function} [onTrim] - Optional trim callback; shows scissors button when provided
 * @param {Function} [onDelete] - Optional delete callback; shows trash button on offline state
 * @param {Function} [onPrev] - Go to previous item (shows left arrow when provided)
 * @param {Function} [onNext] - Go to next item (shows right arrow when provided)
 */

import {
  FeatherAlertTriangle,
  FeatherChevronLeft,
  FeatherChevronRight,
  FeatherFilm,
  FeatherScissors,
  FeatherTrash2,
  FeatherX,
} from '@subframe/core';
import React, { useEffect } from 'react';

const formatBytes = (bytes) => {
  if (!bytes || !isFinite(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatDate = (iso) => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
};

const VideoPreviewLightbox = ({ item, onClose, onTrim, onDelete, onPrev, onNext }) => {
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

  // Offline state — file metadata exists but the underlying file is gone.
  // Render a friendly explanation instead of a broken <video> element.
  if (item.syncStatus === 'offline') {
    const fileSize = formatBytes(item.metadata?.fileSize);
    const lastSeen = formatDate(item.updatedAt || item.createdAt);
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-md rounded-xl border border-amber-600/40 bg-[#1a1408] p-6"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/60 flex items-center justify-center hover:bg-black border-none cursor-pointer"
            onClick={onClose}
            aria-label="Close"
          >
            <FeatherX className="text-white" style={{ width: 14, height: 14 }} />
          </button>

          {/* Icon + headline */}
          <div className="flex flex-col items-center gap-3 mb-5 mt-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-600/15 border border-amber-600/30">
              <FeatherFilm className="text-amber-400" style={{ width: 24, height: 24 }} />
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <FeatherAlertTriangle
                  className="text-amber-400"
                  style={{ width: 14, height: 14 }}
                />
                <span className="text-body-bold font-body-bold text-white">File Offline</span>
              </div>
              <p className="text-caption font-caption text-neutral-400 max-w-xs">
                The metadata is in your library but the file isn't on this device.
              </p>
            </div>
          </div>

          {/* Filename */}
          <div className="rounded-md bg-black/40 border border-neutral-200 px-3 py-2 mb-3">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">
              Filename
            </div>
            <div className="text-caption font-mono text-white truncate">
              {item.name || 'Untitled'}
            </div>
          </div>

          {/* Local path */}
          {item.localPath && (
            <div className="rounded-md bg-black/40 border border-neutral-200 px-3 py-2 mb-3">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">
                Expected location
              </div>
              <div className="text-[11px] font-mono text-neutral-300 break-all">
                {item.localPath}
              </div>
            </div>
          )}

          {/* Metadata row */}
          {(fileSize || lastSeen || item.duration) && (
            <div className="flex items-center gap-4 px-1 mb-4 text-[11px] font-caption text-neutral-500">
              {fileSize && <span>{fileSize}</span>}
              {item.duration && (
                <span>
                  {Math.floor(item.duration / 60)}:
                  {String(Math.floor(item.duration % 60)).padStart(2, '0')}
                </span>
              )}
              {lastSeen && <span>Last seen {lastSeen}</span>}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                className="flex-1 flex items-center justify-center gap-2 rounded-md border border-solid border-red-500/40 bg-red-500/10 px-3 py-2 text-caption-bold font-caption-bold text-red-300 hover:bg-red-500/20 cursor-pointer transition-colors"
                onClick={() => {
                  onDelete(item);
                  onClose?.();
                }}
              >
                <FeatherTrash2 style={{ width: 12, height: 12 }} />
                Delete entry
              </button>
            )}
            <button
              className="flex-1 rounded-md border border-solid border-neutral-200 bg-transparent px-3 py-2 text-caption-bold font-caption-bold text-white hover:bg-neutral-100 cursor-pointer transition-colors"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

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
