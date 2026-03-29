/**
 * AllMediaContent — Full-width tab content replacing the old sidebar.
 * Shows project media grid (images + videos + audio) with search, scope toggle, upload/import.
 * Supports marquee (rubber-band) selection for batch delete.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import {
  FeatherUpload,
  FeatherDownloadCloud,
  FeatherImage,
  FeatherMusic,
  FeatherPlay,
  FeatherX,
  FeatherSearch,
  FeatherFilm,
  FeatherTrash2,
  FeatherCheck,
} from '@subframe/core';
import { removeFromLibraryAsync } from '../../services/libraryService';
import { useToast, ConfirmDialog } from '../ui';
import log from '../../utils/logger';

const AllMediaContent = ({
  db,
  artistId,
  projectMedia,
  library,
  activeNicheId,
  activeNiche,
  onUpload,
  onImport,
  isUploading,
  uploadProgress,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const [mediaScope, setMediaScope] = useState('all');
  const [mediaSearch, setMediaSearch] = useState('');
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);

  // ── Selection state ──
  const [selected, setSelected] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const gridRef = useRef(null);
  const [dragStart, setDragStart] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rubberBand, setRubberBand] = useState(null);

  // Clear selection when scope/search changes
  useEffect(() => {
    setSelected(new Set());
  }, [mediaScope, mediaSearch]);

  // ── Rubber-band handlers ──
  const getIdsInRect = useCallback((rect) => {
    if (!gridRef.current) return [];
    const ids = [];
    gridRef.current.querySelectorAll('[data-media-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (
        r.right > rect.left &&
        r.left < rect.right &&
        r.bottom > rect.top &&
        r.top < rect.bottom
      ) {
        ids.push(el.getAttribute('data-media-id'));
      }
    });
    return ids;
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (
      e.button !== 0 ||
      e.target.closest('[data-media-id]') ||
      e.target.closest('button') ||
      e.target.closest('input')
    )
      return;
    const container = gridRef.current;
    if (!container) return;
    setDragStart({ x: e.clientX, y: e.clientY, scrollTop: container.scrollTop });
    setIsDragging(false);
  }, []);

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (!isDragging && Math.abs(dx) + Math.abs(dy) < 5) return;
      setIsDragging(true);
      const container = gridRef.current;
      if (!container) return;
      const scrollDelta = container.scrollTop - dragStart.scrollTop;
      const cr = container.getBoundingClientRect();
      const x1 = Math.min(dragStart.x, e.clientX) - cr.left;
      const x2 = Math.max(dragStart.x, e.clientX) - cr.left;
      const y1 = Math.min(dragStart.y - scrollDelta, e.clientY) - cr.top;
      const y2 = Math.max(dragStart.y - scrollDelta, e.clientY) - cr.top;
      setRubberBand({ left: x1, top: y1 + container.scrollTop, width: x2 - x1, height: y2 - y1 });
      const absRect = {
        left: Math.min(dragStart.x, e.clientX),
        right: Math.max(dragStart.x, e.clientX),
        top: Math.min(dragStart.y - scrollDelta, e.clientY),
        bottom: Math.max(dragStart.y - scrollDelta, e.clientY),
      };
      setSelected(new Set(getIdsInRect(absRect)));
    },
    [dragStart, isDragging, getIdsInRect],
  );

  const handleMouseUp = useCallback(() => {
    setDragStart(null);
    setRubberBand(null);
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (dragStart) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragStart, handleMouseMove, handleMouseUp]);

  // ── Toggle single item ──
  const toggleItem = useCallback(
    (id) => {
      if (isDragging) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [isDragging],
  );

  // ── Delete handlers ──
  const handleDelete = useCallback(
    (item) => {
      if (isDeleting) return;
      setConfirmDialog({
        isOpen: true,
        title: 'Delete Media',
        message: `Delete "${item.name || 'this item'}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        onConfirm: async () => {
          setIsDeleting(true);
          try {
            await removeFromLibraryAsync(db, artistId, item.id);
            setSelected((prev) => {
              const next = new Set(prev);
              next.delete(item.id);
              return next;
            });
            toastSuccess('Media deleted');
          } catch (err) {
            log.error('[AllMedia] Delete failed:', err);
            toastError('Failed to delete media');
          }
          setConfirmDialog({ isOpen: false });
          setIsDeleting(false);
        },
      });
    },
    [isDeleting, db, artistId, toastSuccess, toastError],
  );

  const handleDeleteSelected = useCallback(() => {
    if (selected.size === 0 || isDeleting) return;
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Selected',
      message: `Delete ${selected.size} item${selected.size !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete All',
      isLoading: false,
      onConfirm: async () => {
        setIsDeleting(true);
        setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
        let deleted = 0;
        for (const id of selected) {
          try {
            await removeFromLibraryAsync(db, artistId, id);
            deleted++;
          } catch (err) {
            log.error('[AllMedia] Delete failed:', id, err);
          }
        }
        setSelected(new Set());
        if (deleted > 0) toastSuccess(`Deleted ${deleted} item${deleted !== 1 ? 's' : ''}`);
        setConfirmDialog({ isOpen: false });
        setIsDeleting(false);
      },
    });
  }, [selected, isDeleting, db, artistId, toastSuccess]);

  // ── Data ──
  const nicheMedia = useMemo(() => {
    if (!activeNiche) return [];
    return library.filter((item) => (activeNiche.mediaIds || []).includes(item.id));
  }, [activeNiche, library]);

  const scopedMedia = mediaScope === 'niche' ? nicheMedia : library;
  const scopedImages = useMemo(() => scopedMedia.filter((m) => m.type === 'image'), [scopedMedia]);
  const scopedVideos = useMemo(() => scopedMedia.filter((m) => m.type === 'video'), [scopedMedia]);

  const filteredImages = useMemo(() => {
    if (!mediaSearch.trim()) return scopedImages;
    const q = mediaSearch.toLowerCase();
    return scopedImages.filter((m) => (m.name || '').toLowerCase().includes(q));
  }, [scopedImages, mediaSearch]);

  const filteredVideos = useMemo(() => {
    if (!mediaSearch.trim()) return scopedVideos;
    const q = mediaSearch.toLowerCase();
    return scopedVideos.filter((m) => (m.name || '').toLowerCase().includes(q));
  }, [scopedVideos, mediaSearch]);

  const scopedAudio = useMemo(() => scopedMedia.filter((m) => m.type === 'audio'), [scopedMedia]);
  const filteredAudio = useMemo(() => {
    if (!mediaSearch.trim()) return scopedAudio;
    const q = mediaSearch.toLowerCase();
    return scopedAudio.filter((m) => (m.name || '').toLowerCase().includes(q));
  }, [scopedAudio, mediaSearch]);

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-1 flex-col items-start self-stretch overflow-y-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between px-4 sm:px-8 py-4 border-b border-solid border-neutral-200">
        <div className="flex items-center gap-3">
          <span className="text-heading-2 font-heading-2 text-white">All Media</span>
          <Badge variant="neutral">{scopedImages.length} images</Badge>
          <Badge variant="neutral">{scopedVideos.length} videos</Badge>
          <Badge variant="neutral">{scopedAudio.length} audio</Badge>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-caption font-caption text-indigo-400">
                {selected.size} selected
              </span>
              <Button
                variant="destructive-secondary"
                size="small"
                icon={<FeatherTrash2 />}
                onClick={handleDeleteSelected}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : `Delete (${selected.size})`}
              </Button>
              <Button
                variant="neutral-tertiary"
                size="small"
                onClick={() => setSelected(new Set())}
              >
                Deselect
              </Button>
            </>
          )}
          <Button
            variant="neutral-secondary"
            size="small"
            icon={<FeatherUpload />}
            onClick={onUpload}
          >
            Upload
          </Button>
          <Button
            variant="neutral-secondary"
            size="small"
            icon={<FeatherDownloadCloud />}
            onClick={onImport}
          >
            Import
          </Button>
        </div>
      </div>

      {/* Search + scope */}
      <div className="flex w-full items-center gap-4 px-8 py-3">
        <div className="flex items-center gap-2 flex-1 rounded-md border border-solid border-neutral-200 bg-black px-3 py-1.5">
          <FeatherSearch className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
          <input
            className="w-full bg-transparent text-body font-body text-white placeholder-neutral-500 outline-none"
            placeholder="Search media..."
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
          />
          {mediaSearch && (
            <button
              className="text-neutral-500 hover:text-white flex-none bg-transparent border-none cursor-pointer"
              onClick={() => setMediaSearch('')}
            >
              <FeatherX style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>
        {activeNicheId && (
          <ToggleGroup value={mediaScope} onValueChange={(v) => v && setMediaScope(v)}>
            <ToggleGroup.Item icon={null} value="all">
              All Media
            </ToggleGroup.Item>
            <ToggleGroup.Item icon={null} value="niche">
              This Niche
            </ToggleGroup.Item>
          </ToggleGroup>
        )}
      </div>

      {/* Upload progress */}
      {isUploading && uploadProgress && (
        <div className="w-full px-8 py-2">
          <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500"
              style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
            />
          </div>
          <span className="text-caption font-caption text-neutral-400 mt-1">
            {uploadProgress.current}/{uploadProgress.total}
          </span>
        </div>
      )}

      {/* Scrollable grid area with rubber-band selection */}
      <div
        ref={gridRef}
        className="flex-1 w-full overflow-y-auto relative px-8 py-4"
        onMouseDown={handleMouseDown}
        style={{ userSelect: isDragging ? 'none' : undefined }}
      >
        {/* Rubber-band visual */}
        {rubberBand && (
          <div
            className="absolute pointer-events-none border border-indigo-400 bg-indigo-500/20 z-10 rounded-sm"
            style={{
              left: rubberBand.left,
              top: rubberBand.top,
              width: rubberBand.width,
              height: rubberBand.height,
            }}
          />
        )}

        {/* Images section */}
        {filteredImages.length > 0 && (
          <div className="flex w-full flex-col gap-3 mb-6">
            <div className="flex items-center gap-2">
              <FeatherImage className="text-indigo-400" style={{ width: 14, height: 14 }} />
              <span className="text-body-bold font-body-bold text-white">Images</span>
              <Badge variant="neutral">{filteredImages.length}</Badge>
            </div>
            <div className="grid w-full grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1.5">
              {filteredImages.map((item) => {
                const isSelected = selected.has(item.id);
                return (
                  <div
                    key={item.id}
                    data-media-id={item.id}
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={item.name || 'Image'}
                    className={`relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group border-2 transition-colors ${
                      isSelected ? 'border-indigo-500' : 'border-transparent'
                    }`}
                    onClick={() => toggleItem(item.id)}
                  >
                    <img
                      src={item.thumbnailUrl || item.url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      draggable={false}
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-indigo-500/25 pointer-events-none flex items-center justify-center">
                        <FeatherCheck className="text-white" style={{ width: 16, height: 16 }} />
                      </div>
                    )}
                    <button
                      className="absolute top-0.5 right-0.5 z-[4] flex h-6 w-6 items-center justify-center rounded-full bg-black/70 border-none cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-red-600/90"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      title="Delete"
                    >
                      <FeatherTrash2 className="text-white" style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Videos section */}
        {filteredVideos.length > 0 && (
          <div className="flex w-full flex-col gap-3 mb-6">
            <div className="flex items-center gap-2">
              <FeatherFilm className="text-indigo-400" style={{ width: 14, height: 14 }} />
              <span className="text-body-bold font-body-bold text-white">Videos</span>
              <Badge variant="neutral">{filteredVideos.length}</Badge>
            </div>
            <div className="grid w-full grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1.5">
              {filteredVideos.map((item) => {
                const isSelected = selected.has(item.id);
                return (
                  <div
                    key={item.id}
                    data-media-id={item.id}
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={item.name || 'Video'}
                    className={`relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group border-2 transition-colors ${
                      isSelected ? 'border-indigo-500' : 'border-transparent'
                    }`}
                    onClick={() => {
                      if (!isDragging) toggleItem(item.id);
                    }}
                  >
                    {item.thumbnailUrl || item.thumbnail ? (
                      <img
                        src={item.thumbnailUrl || item.thumbnail}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <FeatherFilm
                          className="text-neutral-600"
                          style={{ width: 16, height: 16 }}
                        />
                      </div>
                    )}
                    <div
                      className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-auto cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setVideoPreviewUrl(item.url);
                      }}
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 border border-white/20">
                        <FeatherPlay className="text-white" style={{ width: 8, height: 8 }} />
                      </div>
                    </div>
                    {item.duration && (
                      <div className="absolute top-0.5 left-0.5 bg-black/70 rounded px-1 py-px pointer-events-none">
                        <span className="text-[8px] text-neutral-300 font-mono">
                          {formatDuration(item.duration)}
                        </span>
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-indigo-500/25 pointer-events-none flex items-center justify-center">
                        <FeatherCheck className="text-white" style={{ width: 16, height: 16 }} />
                      </div>
                    )}
                    <button
                      className="absolute top-0.5 right-0.5 z-[4] flex h-6 w-6 items-center justify-center rounded-full bg-black/70 border-none cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-red-600/90"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      title="Delete"
                    >
                      <FeatherTrash2 className="text-white" style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Audio section */}
        {filteredAudio.length > 0 && (
          <div className="flex w-full flex-col gap-2 mb-6">
            <div className="flex items-center gap-2">
              <FeatherMusic className="text-indigo-400" style={{ width: 14, height: 14 }} />
              <span className="text-body-bold font-body-bold text-white">Audio</span>
              <Badge variant="neutral">{filteredAudio.length}</Badge>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-solid border-neutral-200 bg-[#111118] overflow-hidden">
              {filteredAudio.map((audio) => {
                const isSelected = selected.has(audio.id);
                return (
                  <div
                    key={audio.id}
                    data-media-id={audio.id}
                    className={`group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                      isSelected ? 'bg-indigo-500/15' : 'hover:bg-neutral-100/30'
                    }`}
                    onClick={() => toggleItem(audio.id)}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-500/10 flex-none">
                      {isSelected ? (
                        <FeatherCheck
                          className="text-indigo-400"
                          style={{ width: 11, height: 11 }}
                        />
                      ) : (
                        <FeatherPlay
                          className="text-indigo-400"
                          style={{ width: 11, height: 11 }}
                        />
                      )}
                    </div>
                    <span className="text-caption font-caption text-white truncate flex-1">
                      {audio.name}
                    </span>
                    {audio.duration && (
                      <span className="text-[11px] text-neutral-500 tabular-nums flex-none">
                        {formatDuration(audio.duration)}
                      </span>
                    )}
                    <button
                      className="flex h-6 w-6 items-center justify-center rounded bg-transparent border-none cursor-pointer text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(audio);
                      }}
                      title="Delete"
                    >
                      <FeatherTrash2 style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No search results */}
        {filteredImages.length === 0 &&
          filteredVideos.length === 0 &&
          (scopedImages.length > 0 || scopedVideos.length > 0) &&
          mediaSearch && (
            <div className="flex w-full items-center justify-center py-8">
              <span className="text-body font-body text-neutral-500">
                No matches for &ldquo;{mediaSearch}&rdquo;
              </span>
            </div>
          )}

        {/* Empty state */}
        {scopedMedia.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center w-full">
            <FeatherImage className="w-12 h-12 text-zinc-600" />
            <h3 className="text-lg font-semibold text-white">No media in pool</h3>
            <p className="text-sm text-zinc-400 max-w-xs">
              Upload images and audio to start creating
            </p>
            <Button
              variant="brand-primary"
              size="medium"
              icon={<FeatherUpload />}
              onClick={onUpload}
            >
              Upload Media
            </Button>
          </div>
        )}
      </div>

      {/* Selection bar — fixed at bottom when items selected */}
      {selected.size > 0 && (
        <div className="flex w-full items-center justify-between px-8 py-3 border-t border-neutral-200 bg-[#0a0a0f]">
          <span className="text-caption font-caption text-neutral-400">
            {selected.size} item{selected.size !== 1 ? 's' : ''} selected — drag to select more
          </span>
          <div className="flex items-center gap-2">
            <Button variant="neutral-tertiary" size="small" onClick={() => setSelected(new Set())}>
              Deselect All
            </Button>
            <Button
              variant="destructive-secondary"
              size="small"
              icon={<FeatherTrash2 />}
              onClick={handleDeleteSelected}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : `Delete ${selected.size}`}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        confirmVariant="destructive"
        isLoading={confirmDialog.isLoading}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ isOpen: false })}
      />

      {/* Video preview lightbox */}
      {videoPreviewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setVideoPreviewUrl(null)}
        >
          <div className="relative max-w-2xl max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <video
              src={videoPreviewUrl}
              controls
              autoPlay
              className="max-w-full max-h-[80vh] rounded-lg"
            />
            <button
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/80 flex items-center justify-center hover:bg-black transition-colors border-none cursor-pointer"
              onClick={() => setVideoPreviewUrl(null)}
            >
              <FeatherX className="text-white" style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllMediaContent;
