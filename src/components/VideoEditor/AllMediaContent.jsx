/**
 * AllMediaContent — Full-width tab content replacing the old sidebar.
 * Shows project media grid (images + videos + audio) with search, scope toggle, upload/import.
 * Supports marquee (rubber-band) selection for batch delete.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import VideoPreviewLightbox from './shared/VideoPreviewLightbox';
import QuickTrimPopover from './shared/QuickTrimPopover';
import MediaStatusBadge from '../ui/MediaStatusBadge';
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
  FeatherFolder,
} from '@subframe/core';
import {
  removeFromLibraryAsync,
  createCollection,
  getCollections,
  saveCollections,
  saveCollectionToFirestore,
  addToCollectionAsync,
  getUserCollections,
  assignToMediaBank,
  migrateToMediaBanks,
  getBankColor,
} from '../../services/libraryService';
import { uploadLocalItemToCloud } from '../../services/localMediaService';
import { useToast, ConfirmDialog } from '../ui';
import { bucketByDuration } from './shared/editorConstants';
import { isSearchAvailable, searchMedia } from '../../services/mediaSearchService';
import log from '../../utils/logger';

const AllMediaContent = ({
  db,
  user = null,
  artistId,
  artistName = '',
  projectMedia,
  library,
  activeNicheId,
  activeNiche,
  onUpload,
  onImport,
  onRefreshLibrary,
  isUploading,
  uploadProgress,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const [mediaScope, setMediaScope] = useState('all');
  const [mediaSearch, setMediaSearch] = useState('');
  const [previewItem, setPreviewItem] = useState(null);
  const [trimItemId, setTrimItemId] = useState(null);
  const [showDurationBuckets, setShowDurationBuckets] = useState(false);
  const [searchMode, setSearchMode] = useState('name'); // 'name' | 'visual'
  const [semanticResults, setSemanticResults] = useState(null); // null = no active search, [] = no results
  const [isSearching, setIsSearching] = useState(false);
  const [sortBy, setSortBy] = useState('date'); // 'name' | 'date' | 'duration' | 'type'
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'cloud' | 'local' | 'offline'
  const [showMoveToBankModal, setShowMoveToBankModal] = useState(false);
  const [isBulkUploading, setIsBulkUploading] = useState(false);

  // ── Selection state ──
  const [selected, setSelected] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const gridRef = useRef(null);
  const [dragStart, setDragStart] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rubberBand, setRubberBand] = useState(null);

  // ── Broken thumbnails ──
  // Tracks media items whose thumbnailUrl points to a file that doesn't exist
  // (404 from the local Express server, broken Firebase Storage URL, etc.).
  // When the <img> errors out we add the item ID here so the next render falls
  // through to the Film icon placeholder instead of showing a transparent
  // broken-image box. This is a renderer-only mitigation for the broader
  // local-first orphan problem — see 94n session notes for the underlying issue
  // (Firestore items reference local files that only exist on a since-deleted
  // device's disk).
  const [brokenThumbs, setBrokenThumbs] = useState(() => new Set());
  const markThumbBroken = useCallback((id) => {
    setBrokenThumbs((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Clear selection when scope/search/source changes
  useEffect(() => {
    setSelected(new Set());
  }, [mediaScope, mediaSearch, sourceFilter]);

  // ── Debounced semantic search ──
  useEffect(() => {
    if (searchMode !== 'visual' || !mediaSearch.trim()) {
      setSemanticResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const collectionIds =
        mediaScope === 'niche' && activeNiche?.id ? [activeNiche.id] : undefined;
      const results = await searchMedia(artistId, mediaSearch, { collectionIds });
      setSemanticResults(results);
      setIsSearching(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchMode, mediaSearch, artistId, activeNiche?.id, mediaScope]);

  // ── Rubber-band handlers ──
  const cachedRectsRef = useRef(null);

  const getIdsInRect = useCallback((rect) => {
    if (!cachedRectsRef.current) return [];
    const ids = [];
    for (const { id, rect: r } of cachedRectsRef.current) {
      if (
        r.right > rect.left &&
        r.left < rect.right &&
        r.bottom > rect.top &&
        r.top < rect.bottom
      ) {
        ids.push(id);
      }
    }
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
    // Cache all item rects on drag start (avoids getBoundingClientRect per item on every mousemove)
    const rects = [];
    container.querySelectorAll('[data-media-id]').forEach((el) => {
      rects.push({ id: el.getAttribute('data-media-id'), rect: el.getBoundingClientRect() });
    });
    cachedRectsRef.current = rects;
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

  // ── Upload-to-Cloud (bulk) ──
  const handleBulkUploadToCloud = useCallback(async () => {
    if (selected.size === 0 || isBulkUploading) return;
    const allMedia = [...(projectMedia || []), ...(library || [])];
    const candidates = [...selected]
      .map((id) => allMedia.find((m) => m.id === id))
      .filter((m) => m && (!m.url || m.syncStatus === 'local'));
    if (candidates.length === 0) {
      toastSuccess('Selected items are already in the cloud');
      return;
    }
    setIsBulkUploading(true);
    let uploaded = 0;
    let failed = 0;
    const quotaCtx = { userData: user, userEmail: user?.email };
    for (const item of candidates) {
      try {
        const result = await uploadLocalItemToCloud(db, artistId, artistName, item, quotaCtx);
        if (result) uploaded++;
        else failed++;
      } catch (err) {
        log.error('[AllMedia] Bulk upload failed for', item.id, err);
        failed++;
      }
    }
    if (uploaded > 0)
      toastSuccess(`Uploaded ${uploaded} item${uploaded !== 1 ? 's' : ''} to cloud`);
    if (failed > 0) toastError(`${failed} upload${failed !== 1 ? 's' : ''} failed`);
    setIsBulkUploading(false);
    onRefreshLibrary?.();
  }, [
    selected,
    isBulkUploading,
    projectMedia,
    library,
    user,
    db,
    artistId,
    artistName,
    toastSuccess,
    toastError,
    onRefreshLibrary,
  ]);

  // ── Upload-to-Cloud (per-item) ──
  const handleUploadToCloud = useCallback(
    async (item) => {
      if (!item || !item.id) return;
      if (item.url && item.syncStatus !== 'local') {
        toastSuccess('Already in the cloud');
        return;
      }
      try {
        const quotaCtx = { userData: user, userEmail: user?.email };
        const result = await uploadLocalItemToCloud(db, artistId, artistName, item, quotaCtx);
        if (result) {
          toastSuccess(`Uploaded "${item.name}" to cloud`);
          onRefreshLibrary?.();
        } else {
          toastError(`Could not upload "${item.name}"`);
        }
      } catch (err) {
        log.error('[AllMedia] Upload to cloud failed:', err);
        toastError(err?.message || 'Upload failed');
      }
    },
    [db, user, artistId, artistName, toastSuccess, toastError, onRefreshLibrary],
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
            // Also delete local file from disk (Electron desktop)
            if (window.electronAPI?.isElectron && (item.localPath || item.path)) {
              window.electronAPI.trashFile(item.localPath || item.path).catch(() => {});
            }
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
        const allMedia = [...(projectMedia || []), ...(library || [])];
        for (const id of selected) {
          try {
            await removeFromLibraryAsync(db, artistId, id);
            // Also delete local file from disk
            if (window.electronAPI?.isElectron) {
              const item = allMedia.find((m) => m.id === id);
              if (item?.localPath || item?.path) {
                window.electronAPI.trashFile(item.localPath || item.path).catch(() => {});
              }
            }
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

  const handleAddToFolder = useCallback(
    async (folderName, mediaIds) => {
      if (!artistId || !folderName || !mediaIds.length) return;
      // Check if folder already exists
      const cols = getCollections(artistId);
      let folder = cols.find(
        (c) => c.name?.toLowerCase() === folderName.toLowerCase() && c.type === 'user',
      );
      if (!folder) {
        folder = createCollection({ name: folderName });
        folder.mediaIds = mediaIds;
        const updated = [...cols, folder];
        saveCollections(artistId, updated);
        if (db) saveCollectionToFirestore(db, artistId, folder).catch(() => {});
      } else {
        // Add to existing folder
        const newIds = new Set([...(folder.mediaIds || []), ...mediaIds]);
        folder.mediaIds = [...newIds];
        saveCollections(
          artistId,
          cols.map((c) => (c.id === folder.id ? folder : c)),
        );
        if (db) saveCollectionToFirestore(db, artistId, folder).catch(() => {});
      }
      setSelected(new Set());
      toastSuccess(`Added ${mediaIds.length} items to "${folderName}"`);
    },
    [artistId, db, toastSuccess],
  );

  // ── Data ──
  const nicheMedia = useMemo(() => {
    if (!activeNiche) return [];
    return library.filter((item) => (activeNiche.mediaIds || []).includes(item.id));
  }, [activeNiche, library]);

  const rawScopedMedia = mediaScope === 'niche' ? nicheMedia : projectMedia;

  // Apply source filter (cloud / local / offline / all). Items WITHOUT a
  // syncStatus default to "cloud" if they have a remote URL, "local" if they
  // only have a localPath/localUrl, otherwise "all".
  const matchesSourceFilter = useCallback(
    (m) => {
      if (sourceFilter === 'all') return true;
      const status = m.syncStatus
        ? m.syncStatus
        : m.url
          ? 'cloud'
          : m.localUrl || m.localPath
            ? 'local'
            : 'cloud';
      if (sourceFilter === 'cloud') return status === 'cloud' || status === 'synced';
      if (sourceFilter === 'local') return status === 'local';
      if (sourceFilter === 'offline') return status === 'offline';
      return true;
    },
    [sourceFilter],
  );
  const scopedMedia = useMemo(
    () => rawScopedMedia.filter(matchesSourceFilter),
    [rawScopedMedia, matchesSourceFilter],
  );
  const scopedImages = useMemo(() => scopedMedia.filter((m) => m.type === 'image'), [scopedMedia]);
  const scopedVideos = useMemo(() => scopedMedia.filter((m) => m.type === 'video'), [scopedMedia]);

  // Sort comparator
  const sortItems = useCallback(
    (items) => {
      const arr = [...items];
      switch (sortBy) {
        case 'name':
          arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          break;
        case 'duration':
          arr.sort((a, b) => (b.duration || 0) - (a.duration || 0));
          break;
        case 'type':
          arr.sort((a, b) => (a.type || '').localeCompare(b.type || ''));
          break;
        case 'date':
        default:
          arr.sort((a, b) => {
            const at = new Date(a.createdAt || a.metadata?.importedAt || 0).getTime();
            const bt = new Date(b.createdAt || b.metadata?.importedAt || 0).getTime();
            return bt - at;
          });
          break;
      }
      return arr;
    },
    [sortBy],
  );

  const filteredImages = useMemo(() => {
    let items;
    if (searchMode === 'visual' && semanticResults) {
      const matchIds = new Set(
        semanticResults.filter((r) => r.type === 'image').map((r) => r.mediaId),
      );
      items = scopedImages.filter((m) => matchIds.has(m.id));
    } else if (!mediaSearch.trim()) {
      items = scopedImages;
    } else {
      const q = mediaSearch.toLowerCase();
      items = scopedImages.filter((m) => (m.name || '').toLowerCase().includes(q));
    }
    return sortItems(items);
  }, [scopedImages, mediaSearch, searchMode, semanticResults, sortItems]);

  const filteredVideos = useMemo(() => {
    let items;
    if (searchMode === 'visual' && semanticResults) {
      const matchIds = new Set(
        semanticResults.filter((r) => r.type === 'video').map((r) => r.mediaId),
      );
      items = scopedVideos.filter((m) => matchIds.has(m.id));
    } else if (!mediaSearch.trim()) {
      items = scopedVideos;
    } else {
      const q = mediaSearch.toLowerCase();
      items = scopedVideos.filter((m) => (m.name || '').toLowerCase().includes(q));
    }
    return sortItems(items);
  }, [scopedVideos, mediaSearch, searchMode, semanticResults, sortItems]);

  const scopedAudio = useMemo(() => scopedMedia.filter((m) => m.type === 'audio'), [scopedMedia]);
  const filteredAudio = useMemo(() => {
    let items;
    if (!mediaSearch.trim()) {
      items = scopedAudio;
    } else {
      const q = mediaSearch.toLowerCase();
      items = scopedAudio.filter((m) => (m.name || '').toLowerCase().includes(q));
    }
    return sortItems(items);
  }, [scopedAudio, mediaSearch, sortItems]);

  // Union of everything currently visible in the grid (after scope + search + sort).
  // Counts/Select-All read from this so they always reflect what the user can actually see.
  const visibleMedia = useMemo(
    () => [...filteredImages, ...filteredVideos, ...filteredAudio],
    [filteredImages, filteredVideos, filteredAudio],
  );

  const durationBuckets = useMemo(() => bucketByDuration(filteredVideos), [filteredVideos]);

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const renderVideoCard = (item) => {
    const isSelected = selected.has(item.id);
    return (
      <div
        key={item.id}
        data-media-id={item.id}
        role="checkbox"
        aria-checked={isSelected}
        aria-label={item.name || 'Video'}
        className={`relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group border-2 ${
          isSelected ? 'border-indigo-500' : 'border-transparent'
        }`}
        onClick={() => {
          if (!isDragging) toggleItem(item.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setPreviewItem(item);
        }}
      >
        {(item.thumbnailUrl || item.thumbnail) && !brokenThumbs.has(item.id) ? (
          <img
            src={item.thumbnailUrl || item.thumbnail}
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable={false}
            onError={() => markThumbBroken(item.id)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FeatherFilm className="text-neutral-600" style={{ width: 16, height: 16 }} />
          </div>
        )}
        {/* Hover-only play affordance — pointer-events-none so it doesn't intercept clicks */}
        <div className="absolute inset-0 z-[3] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 border border-white/30">
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
        <MediaStatusBadge syncStatus={item.syncStatus} />
        {/* Upload to Cloud — only for local-only items */}
        {(!item.url || item.syncStatus === 'local') && (
          <button
            className="absolute top-0.5 left-0.5 z-[4] flex h-6 w-6 items-center justify-center rounded-full bg-blue-600/80 border-none cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-blue-500"
            style={{ marginLeft: 18 }}
            onClick={(e) => {
              e.stopPropagation();
              handleUploadToCloud(item);
            }}
            title="Upload to cloud"
          >
            <FeatherUpload className="text-white" style={{ width: 12, height: 12 }} />
          </button>
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
  };

  return (
    <div className="flex flex-1 flex-col items-start self-stretch overflow-y-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between px-4 sm:px-8 py-4 border-b border-solid border-neutral-200">
        <div className="flex items-center gap-3">
          <span className="text-heading-2 font-heading-2 text-white">All Media</span>
          <Badge variant="neutral">{filteredImages.length} images</Badge>
          <Badge variant="neutral">{filteredVideos.length} videos</Badge>
          <Badge variant="neutral">{filteredAudio.length} audio</Badge>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 ? (
            <>
              <span className="text-caption font-caption text-indigo-400">
                {selected.size} of {visibleMedia.length} selected
              </span>
              <Button
                variant="neutral-tertiary"
                size="small"
                onClick={() => setSelected(new Set(visibleMedia.map((m) => m.id)))}
              >
                Select All
              </Button>
              <Button
                variant="brand-secondary"
                size="small"
                icon={<FeatherUpload />}
                onClick={handleBulkUploadToCloud}
                disabled={isBulkUploading}
                title="Upload selected local clips to the cloud"
              >
                {isBulkUploading ? 'Uploading...' : 'Upload to Cloud'}
              </Button>
              <Button
                variant="brand-secondary"
                size="small"
                icon={<FeatherFolder />}
                onClick={() => {
                  const name = prompt('Folder name:');
                  if (!name?.trim()) return;
                  handleAddToFolder(name.trim(), [...selected]);
                }}
              >
                Add to Folder
              </Button>
              <Button
                variant="neutral-secondary"
                size="small"
                onClick={() => setShowMoveToBankModal(true)}
              >
                Move to Bank…
              </Button>
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
          ) : (
            <Button
              variant="neutral-tertiary"
              size="small"
              icon={<FeatherCheck />}
              onClick={() => setSelected(new Set(visibleMedia.map((m) => m.id)))}
            >
              Select All
            </Button>
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
      <div className="flex w-full items-center gap-4 px-8 py-3 flex-wrap">
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
        {/* Source filter chips: All / Cloud / Local / Offline */}
        <ToggleGroup value={sourceFilter} onValueChange={(v) => v && setSourceFilter(v)}>
          <ToggleGroup.Item icon={null} value="all">
            All
          </ToggleGroup.Item>
          <ToggleGroup.Item icon={null} value="cloud">
            Cloud
          </ToggleGroup.Item>
          <ToggleGroup.Item icon={null} value="local">
            Local
          </ToggleGroup.Item>
          <ToggleGroup.Item icon={null} value="offline">
            Offline
          </ToggleGroup.Item>
        </ToggleGroup>
        <Button
          variant={showDurationBuckets ? 'brand-secondary' : 'neutral-secondary'}
          size="small"
          onClick={() => setShowDurationBuckets((prev) => !prev)}
        >
          By Duration
        </Button>
        {/* Sort selector — styled to match Subframe controls instead of native <select> */}
        <ToggleGroup value={sortBy} onValueChange={(v) => v && setSortBy(v)}>
          <ToggleGroup.Item icon={null} value="date">
            Newest
          </ToggleGroup.Item>
          <ToggleGroup.Item icon={null} value="name">
            Name
          </ToggleGroup.Item>
          <ToggleGroup.Item icon={null} value="duration">
            Duration
          </ToggleGroup.Item>
          <ToggleGroup.Item icon={null} value="type">
            Type
          </ToggleGroup.Item>
        </ToggleGroup>
        {isSearchAvailable() && (
          <ToggleGroup value={searchMode} onValueChange={(v) => v && setSearchMode(v)}>
            <ToggleGroup.Item icon={null} value="name">
              Name
            </ToggleGroup.Item>
            <ToggleGroup.Item icon={null} value="visual">
              Visual
            </ToggleGroup.Item>
          </ToggleGroup>
        )}
        {isSearching && (
          <span className="text-caption font-caption text-indigo-400 animate-pulse">
            Searching...
          </span>
        )}
        {searchMode === 'visual' && semanticResults && !isSearching && (
          <Badge variant="brand">
            {semanticResults.length} visual match{semanticResults.length !== 1 ? 'es' : ''}
          </Badge>
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
                    className={`relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group border-2 ${
                      isSelected ? 'border-indigo-500' : 'border-transparent'
                    }`}
                    onClick={() => toggleItem(item.id)}
                  >
                    {!brokenThumbs.has(item.id) ? (
                      <img
                        src={item.thumbnailUrl || item.url}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        draggable={false}
                        onError={() => markThumbBroken(item.id)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <FeatherImage
                          className="text-neutral-600"
                          style={{ width: 16, height: 16 }}
                        />
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-indigo-500/25 pointer-events-none flex items-center justify-center">
                        <FeatherCheck className="text-white" style={{ width: 16, height: 16 }} />
                      </div>
                    )}
                    <MediaStatusBadge syncStatus={item.syncStatus} />
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
            {showDurationBuckets ? (
              <>
                {durationBuckets.buckets.map((bucket) => (
                  <div key={bucket.key} className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-body-bold font-body-bold text-white">
                        {bucket.label}
                      </span>
                      <Badge variant="neutral">{bucket.items.length} clips</Badge>
                    </div>
                    <div className="grid w-full grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1.5">
                      {bucket.items.map((item) => renderVideoCard(item))}
                    </div>
                  </div>
                ))}
                {durationBuckets.unknown.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-body-bold font-body-bold text-white">
                        Unknown Duration
                      </span>
                      <Badge variant="neutral">{durationBuckets.unknown.length} clips</Badge>
                    </div>
                    <div className="grid w-full grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1.5">
                      {durationBuckets.unknown.map((item) => renderVideoCard(item))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="grid w-full grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1.5">
                {filteredVideos.map((item) => renderVideoCard(item))}
              </div>
            )}
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
                    className={`group flex items-center gap-3 px-3 py-2 cursor-pointer ${
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

      {/* Quick Trim Popover */}
      {trimItemId &&
        (() => {
          const trimItem = [...(projectMedia || []), ...(library || [])].find(
            (m) => m.id === trimItemId,
          );
          if (!trimItem) return null;
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
              onClick={() => setTrimItemId(null)}
            >
              <QuickTrimPopover
                item={trimItem}
                initialTrimStart={0}
                initialTrimEnd={trimItem.duration}
                onSave={async (trimStart, trimEnd) => {
                  // Destructive trim if Electron + local file
                  const localPath = trimItem.localPath || trimItem.metadata?.localPath;
                  if (window.electronAPI?.trimVideoDestructive && localPath) {
                    try {
                      const mediaFolder = await window.electronAPI.getMediaFolder();
                      const fullPath = `${mediaFolder}/${localPath}`;
                      const result = await window.electronAPI.trimVideoDestructive(
                        fullPath,
                        trimStart,
                        trimEnd,
                      );
                      if (result.success) {
                        const { updateLibraryItemAsync } =
                          await import('../../services/libraryService');
                        await updateLibraryItemAsync(db, artistId, trimItemId, {
                          duration: result.newDuration,
                        });
                        toastSuccess(`Trimmed to ${result.newDuration.toFixed(1)}s`);
                      }
                    } catch (err) {
                      toastError(`Trim failed: ${err.message}`);
                    }
                  } else {
                    toastSuccess('Trim saved (metadata only)');
                  }
                  setTrimItemId(null);
                }}
                onClose={() => setTrimItemId(null)}
              />
            </div>
          );
        })()}

      {/* Move to Bank modal */}
      {showMoveToBankModal &&
        (() => {
          const allCollections = getUserCollections(artistId);
          const niches = allCollections.filter((c) => c.isPipeline);
          const handleAssign = async (nicheId, bankId) => {
            const ids = [...selected];
            assignToMediaBank(artistId, nicheId, ids, bankId, db);
            // Also ensure they're in the niche collection
            for (const mediaId of ids) {
              await addToCollectionAsync(db, artistId, nicheId, mediaId);
            }
            toastSuccess(`Moved ${ids.length} item${ids.length !== 1 ? 's' : ''} to bank`);
            setShowMoveToBankModal(false);
            setSelected(new Set());
          };
          return (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70"
              onClick={() => setShowMoveToBankModal(false)}
            >
              <div
                className="rounded-lg border border-solid border-neutral-200 bg-[#0f0f17] p-5 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-heading-3 font-heading-3 text-white">
                    Move {selected.size} item{selected.size !== 1 ? 's' : ''} to bank
                  </span>
                  <button
                    className="text-neutral-400 hover:text-white bg-transparent border-none cursor-pointer"
                    onClick={() => setShowMoveToBankModal(false)}
                  >
                    <FeatherX style={{ width: 18, height: 18 }} />
                  </button>
                </div>
                {niches.length === 0 ? (
                  <span className="text-body font-body text-neutral-500">
                    No niches in this project. Create a niche first.
                  </span>
                ) : (
                  <div className="flex flex-col gap-4">
                    {niches.map((niche) => {
                      const migrated = migrateToMediaBanks(niche);
                      const banks = migrated.mediaBanks || [];
                      return (
                        <div key={niche.id} className="flex flex-col gap-2">
                          <span className="text-caption-bold font-caption-bold text-neutral-400">
                            {niche.name || 'Untitled Niche'}
                          </span>
                          <div className="flex items-center gap-2 flex-wrap">
                            {banks.length === 0 ? (
                              <span className="text-caption font-caption text-neutral-600">
                                No banks
                              </span>
                            ) : (
                              banks.map((bank, idx) => {
                                const color = getBankColor(idx);
                                return (
                                  <button
                                    key={bank.id}
                                    className="flex items-center gap-1.5 rounded-full px-3 py-1 text-caption-bold font-caption-bold border border-solid bg-transparent cursor-pointer hover:brightness-125 transition-colors"
                                    style={{ borderColor: color.primary, color: color.light }}
                                    onClick={() => handleAssign(niche.id, bank.id)}
                                  >
                                    <div
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: color.primary }}
                                    />
                                    {bank.name}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Video preview lightbox */}
      <VideoPreviewLightbox
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onTrim={(item) => {
          setPreviewItem(null);
          setTrimItemId(item.id);
        }}
        onDelete={(item) => {
          setPreviewItem(null);
          handleDelete(item);
        }}
        onPrev={(() => {
          if (!previewItem) return undefined;
          const all = [...filteredImages, ...filteredVideos];
          const idx = all.findIndex((m) => m.id === previewItem.id);
          return idx > 0 ? () => setPreviewItem(all[idx - 1]) : undefined;
        })()}
        onNext={(() => {
          if (!previewItem) return undefined;
          const all = [...filteredImages, ...filteredVideos];
          const idx = all.findIndex((m) => m.id === previewItem.id);
          return idx >= 0 && idx < all.length - 1 ? () => setPreviewItem(all[idx + 1]) : undefined;
        })()}
      />
    </div>
  );
};

export default AllMediaContent;
