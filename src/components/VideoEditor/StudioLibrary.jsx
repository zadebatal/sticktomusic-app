/**
 * StudioLibrary — Horizontal nav + media grid for browsing all artist media
 * Pipeline albums, All Media, Unassigned bucket, type filtering, search, sort
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import useIsMobile from '../../hooks/useIsMobile';
import {
  getLibrary,
  getCollections,
  getCreatedContent,
  getPipelineAssetCounts,
  subscribeToCollections,
  subscribeToLibrary,
  subscribeToCreatedContent,
  addToLibraryAsync,
  addToCollectionAsync,
  MEDIA_TYPES,
} from '../../services/libraryService';
import { uploadFile, generateThumbnail } from '../../services/firebaseStorage';
import { convertImageIfNeeded } from '../../utils/imageConverter';
import { convertAudioIfNeeded } from '../../utils/audioConverter';
import { runPool } from '../../utils/uploadPool';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { TextField } from '../../ui/components/TextField';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import { useToast } from '../ui';
import {
  FeatherSearch, FeatherGrid, FeatherMusic,
  FeatherUpload, FeatherFileQuestion, FeatherPlay, FeatherPause,
  FeatherArrowDownUp, FeatherChevronDown, FeatherFolder, FeatherFilm,
} from '@subframe/core';
import * as SubframeCore from '@subframe/core';
import CloudImportButton from './CloudImportButton';

// Format duration (seconds → "m:ss")
const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// Sort options
const SORT_OPTIONS = [
  { value: 'date', label: 'Sort by Date' },
  { value: 'name', label: 'Sort by Name' },
  { value: 'type', label: 'Sort by Type' },
];

/**
 * MediaCard — renders a single media item (image, video, or audio)
 */
const MediaCard = ({ item, pipelineColor, playingAudioId, onToggleAudio, playingVideoId, onToggleVideo, onViewImage }) => {
  const isAudio = item.type === MEDIA_TYPES.AUDIO;
  const isVideo = item.type === MEDIA_TYPES.VIDEO;
  const isPlaying = playingAudioId === item.id;
  const isVideoPlaying = playingVideoId === item.id;

  // Audio — thin horizontal pill row
  if (isAudio) {
    return (
      <div
        className={`flex w-full items-center gap-2 rounded-md border border-solid px-3 py-1.5 cursor-pointer transition-colors ${
          isPlaying
            ? 'border-[#f59e0b]/40 bg-[#f59e0b]/5'
            : 'border-neutral-800 bg-[#1a1a1a] hover:border-neutral-600'
        }`}
        onClick={() => onToggleAudio?.(item)}
      >
        {isPlaying ? (
          <FeatherPause className="flex-none text-[#f59e0b]" style={{ width: 14, height: 14 }} />
        ) : (
          <FeatherMusic className="flex-none text-neutral-500" style={{ width: 14, height: 14 }} />
        )}
        <span className={`text-caption font-caption truncate grow ${isPlaying ? 'text-[#f59e0b]' : 'text-neutral-300'}`}>
          {item.name || 'Untitled'}
        </span>
        <span className={`text-caption font-caption flex-none ${isPlaying ? 'text-[#f59e0b]/60' : 'text-neutral-500'}`}>
          {formatDuration(item.duration)}
        </span>
        {pipelineColor && (
          <div className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: pipelineColor }} />
        )}
      </div>
    );
  }

  // Video — thumbnailUrl first (url is .mp4, can't render as img)
  if (isVideo) {
    return (
      <div
        className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1a] overflow-hidden hover:border-neutral-600 cursor-pointer transition-colors"
        onClick={() => onToggleVideo?.(item)}
      >
        <div className="w-full relative bg-[#171717]" style={{ paddingTop: '177.78%' }}>
          {isVideoPlaying ? (
            <>
              <video
                className="absolute inset-0 w-full h-full object-contain"
                src={item.url}
                autoPlay
                onEnded={() => onToggleVideo?.(item)}
              />
              <div className="flex items-center justify-center absolute inset-0 opacity-0 hover:opacity-100 transition-opacity">
                <FeatherPause className="text-heading-1 font-heading-1 text-white drop-shadow-lg" />
              </div>
            </>
          ) : (
            <>
              {(item.thumbnailUrl || item.url) && (
                <img
                  className="absolute inset-0 w-full h-full object-contain"
                  src={item.thumbnailUrl || item.url}
                  alt={item.name}
                  loading="lazy"
                />
              )}
              <div className="flex items-center justify-center absolute inset-0">
                <FeatherPlay className="text-heading-1 font-heading-1 text-white drop-shadow-lg" />
              </div>
            </>
          )}
          {!isVideoPlaying && item.duration > 0 && (
            <div className="flex items-start absolute bottom-2 right-2">
              <Badge variant="neutral">{formatDuration(item.duration)}</Badge>
            </div>
          )}
        </div>
        <div className="flex w-full items-center justify-between px-3 py-2">
          <span className="text-caption font-caption text-neutral-300 truncate max-w-[85%]">
            {item.name || 'Untitled'}
          </span>
          {pipelineColor && (
            <div className="flex h-2 w-2 flex-none rounded-full" style={{ backgroundColor: pipelineColor }} />
          )}
        </div>
      </div>
    );
  }

  // Default: Image — always use full-res url (old thumbnails are 50px micro-thumbs)
  return (
    <div
      className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1a] overflow-hidden hover:border-neutral-600 cursor-pointer transition-colors"
      onClick={() => onViewImage?.(item)}
    >
      <div className="w-full relative bg-[#171717]" style={{ paddingTop: '177.78%' }}>
        <img
          className="absolute inset-0 w-full h-full object-cover"
          src={item.url || item.thumbnailUrl}
          alt={item.name}
          loading="lazy"
        />
      </div>
      <div className="flex w-full items-center justify-between px-3 py-2">
        <span className="text-caption font-caption text-neutral-300 truncate max-w-[85%]">
          {item.name || 'Untitled'}
        </span>
        {pipelineColor && (
          <div className="flex h-2 w-2 flex-none rounded-full" style={{ backgroundColor: pipelineColor }} />
        )}
      </div>
    </div>
  );
};

/**
 * DraftCard — renders a draft (slideshow or video) in the drafts tab
 */
const DraftCard = ({ draft, type }) => {
  const thumbSrc = type === 'slideshow'
    ? draft.slides?.[0]?.imageUrl || draft.slides?.[0]?.url
    : draft.thumbnailUrl || draft.url;

  return (
    <div className="flex w-full flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1a] overflow-hidden hover:border-neutral-600 cursor-pointer transition-colors">
      <div className="w-full aspect-[9/16] bg-[#171717] relative">
        {thumbSrc ? (
          <img className="w-full h-full object-cover" src={thumbSrc} alt={draft.name} loading="lazy" />
        ) : (
          <div className="flex w-full h-full items-center justify-center">
            <FeatherFilm className="text-neutral-700" style={{ width: 24, height: 24 }} />
          </div>
        )}
        {type === 'slideshow' && draft.slides?.length > 0 && (
          <div className="flex items-start absolute bottom-2 right-2">
            <Badge variant="neutral">{draft.slides.length} slides</Badge>
          </div>
        )}
      </div>
      <div className="flex w-full flex-col gap-0.5 px-3 pb-3">
        <span className="text-caption font-caption text-neutral-300 truncate">
          {draft.name || 'Untitled Draft'}
        </span>
        <span className="text-caption font-caption text-neutral-500">
          {draft.createdAt ? new Date(draft.createdAt).toLocaleDateString() : ''}
        </span>
      </div>
    </div>
  );
};

const StudioLibrary = ({ db, artistId }) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { isMobile } = useIsMobile();

  // Data state
  const [collections, setCollections] = useState([]);
  const [library, setLibrary] = useState([]);
  const [createdContent, setCreatedContent] = useState({ videos: [], slideshows: [] });

  // UI state
  const [selectedAlbum, setSelectedAlbum] = useState('all');
  const [activeTypeTab, setActiveTypeTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [showDrafts, setShowDrafts] = useState(false);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInputRef = useRef(null);
  const handleUploadRef = useRef(null);

  // Audio playback state
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const audioRef = useRef(new Audio());

  // Video playback state
  const [playingVideoId, setPlayingVideoId] = useState(null);

  // Image lightbox state
  const [lightboxImage, setLightboxImage] = useState(null);

  // Reset drafts tab when album changes
  useEffect(() => {
    setShowDrafts(false);
    setActiveTypeTab('all');
  }, [selectedAlbum]);

  // Load data + subscribe (matches PipelineListView pattern)
  useEffect(() => {
    if (!artistId) return;
    setCollections(getCollections(artistId));
    setLibrary(getLibrary(artistId));
    setCreatedContent(getCreatedContent(artistId));

    const unsubs = [];
    if (db) {
      unsubs.push(subscribeToCollections(db, artistId, setCollections));
      unsubs.push(subscribeToLibrary(db, artistId, setLibrary));
      unsubs.push(subscribeToCreatedContent(db, artistId, setCreatedContent));
    }
    return () => unsubs.forEach(u => u && u());
  }, [db, artistId]);

  // Cleanup audio on unmount
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Derived: pipelines
  const pipelines = useMemo(
    () => collections.filter(c => c.isPipeline || c.pageId),
    [collections]
  );

  // Derived: pipeline color map (for dot indicators on media cards)
  const pipelineColorMap = useMemo(() => {
    const map = {};
    pipelines.forEach(p => {
      (p.mediaIds || []).forEach(id => {
        if (!map[id]) map[id] = p.pipelineColor || '#6366f1';
      });
    });
    return map;
  }, [pipelines]);

  // Derived: unassigned media
  const unassignedMedia = useMemo(() => {
    const pipelineIds = new Set(pipelines.map(p => p.id));
    return library.filter(item => {
      const ids = item.collectionIds || [];
      return !ids.some(cid => pipelineIds.has(cid));
    });
  }, [library, pipelines]);

  // Derived: pipeline drafts (when viewing a pipeline)
  const pipelineDrafts = useMemo(() => {
    if (selectedAlbum === 'all' || selectedAlbum === 'unassigned') return [];
    const slideshows = (createdContent.slideshows || [])
      .filter(s => !s.isTemplate && s.collectionId === selectedAlbum)
      .map(s => ({ ...s, _draftType: 'slideshow' }));
    const videos = (createdContent.videos || [])
      .filter(v => v.collectionId === selectedAlbum)
      .map(v => ({ ...v, _draftType: 'video' }));
    return [...slideshows, ...videos].sort((a, b) =>
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
  }, [selectedAlbum, createdContent]);

  // Filtered media: album → type → search → sort
  const filteredMedia = useMemo(() => {
    let items = library;

    // Album filter
    if (selectedAlbum === 'unassigned') {
      items = unassignedMedia;
    } else if (selectedAlbum !== 'all') {
      items = items.filter(item =>
        (item.collectionIds || []).includes(selectedAlbum)
      );
    }

    // Type filter
    if (activeTypeTab === 'photos') {
      items = items.filter(i => i.type === MEDIA_TYPES.IMAGE);
    } else if (activeTypeTab === 'videos') {
      items = items.filter(i => i.type === MEDIA_TYPES.VIDEO);
    } else if (activeTypeTab === 'audio') {
      items = items.filter(i => i.type === MEDIA_TYPES.AUDIO);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => (i.name || '').toLowerCase().includes(q));
    }

    // Sort
    if (sortBy === 'name') {
      items = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'type') {
      items = [...items].sort((a, b) => (a.type || '').localeCompare(b.type || ''));
    } else {
      // date (newest first)
      items = [...items].sort((a, b) =>
        new Date(b.createdAt || b.addedAt || 0) - new Date(a.createdAt || a.addedAt || 0)
      );
    }

    return items;
  }, [library, selectedAlbum, unassignedMedia, activeTypeTab, searchQuery, sortBy]);

  // Album title
  const albumTitle = useMemo(() => {
    if (selectedAlbum === 'all') return 'All Media';
    if (selectedAlbum === 'unassigned') return 'Unassigned';
    const p = pipelines.find(p => p.id === selectedAlbum);
    return p?.name || 'Unknown';
  }, [selectedAlbum, pipelines]);

  // Item count for header badge
  const itemCount = showDrafts ? pipelineDrafts.length : filteredMedia.length;

  // Toggle audio playback
  const toggleAudioPlay = useCallback((item) => {
    const audio = audioRef.current;
    if (playingAudioId === item.id) {
      audio.pause();
      setPlayingAudioId(null);
    } else {
      audio.src = item.url;
      audio.play().catch(() => {});
      setPlayingAudioId(item.id);
      audio.onended = () => setPlayingAudioId(null);
    }
  }, [playingAudioId]);

  // Toggle video playback
  const toggleVideoPlay = useCallback((item) => {
    if (playingVideoId === item.id) {
      setPlayingVideoId(null);
    } else {
      // Stop any playing audio first
      audioRef.current.pause();
      setPlayingAudioId(null);
      setPlayingVideoId(item.id);
    }
  }, [playingVideoId]);

  // Upload handler
  const handleUpload = useCallback(async (files) => {
    if (!files?.length) { toastError('No files selected'); return; }
    if (!artistId) { toastError('No artist selected'); return; }
    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length });

    const targetCollectionId = (selectedAlbum !== 'all' && selectedAlbum !== 'unassigned') ? selectedAlbum : null;

    const processOne = async (rawFile) => {
      let file = rawFile;
      if (rawFile.type?.startsWith('image')) file = await convertImageIfNeeded(rawFile);
      else if (rawFile.type?.startsWith('audio')) file = await convertAudioIfNeeded(rawFile);

      const isAudio = file.type?.startsWith('audio');
      const isVideo = file.type?.startsWith('video');
      const folder = isAudio ? 'audio' : isVideo ? 'videos' : 'images';
      const { url, path } = await uploadFile(file, folder);

      // Thumbnail generation — 50% resolution for grid display
      let thumbnailUrl = null;
      if (!isAudio && !isVideo) {
        // Image thumbnail: 50% of original dimensions
        try {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          await new Promise(r => { img.onload = r; });
          const scale = 0.5;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.7));
          if (blob) {
            const tf = new File([blob], `thumb_${file.name}`, { type: 'image/jpeg' });
            const tr = await uploadFile(tf, 'thumbnails');
            thumbnailUrl = tr.url;
          }
          URL.revokeObjectURL(img.src);
        } catch (e) { /* skip thumb */ }
      } else if (isVideo) {
        // Video thumbnail: capture frame at 1s, scale to 50%
        try {
          const dataUrl = await generateThumbnail(url, 1);
          if (dataUrl) {
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const tf = new File([blob], `thumb_${file.name}.jpg`, { type: 'image/jpeg' });
            const tr = await uploadFile(tf, 'thumbnails');
            thumbnailUrl = tr.url;
          }
        } catch (e) { /* skip thumb */ }
      }

      const mediaType = isAudio ? MEDIA_TYPES.AUDIO : isVideo ? MEDIA_TYPES.VIDEO : MEDIA_TYPES.IMAGE;
      const item = {
        type: mediaType,
        name: file.name,
        url,
        thumbnailUrl,
        storagePath: path,
        collectionIds: targetCollectionId ? [targetCollectionId] : [],
        metadata: { fileSize: file.size, mimeType: file.type },
      };

      const savedItem = await addToLibraryAsync(db, artistId, item);
      if (targetCollectionId) {
        await addToCollectionAsync(db, artistId, targetCollectionId, savedItem.id);
      }
      return savedItem;
    };

    try {
      const { results, errors } = await runPool(Array.from(files), processOne, {
        concurrency: 5,
        onProgress: (done, total) => setUploadProgress({ current: done, total }),
      });
      const uploadedItems = results.filter(Boolean);
      if (uploadedItems.length > 0) {
        setLibrary(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const newItems = uploadedItems.filter(i => !existingIds.has(i.id));
          return newItems.length > 0 ? [...prev, ...newItems] : prev;
        });
        setCollections(getCollections(artistId));
        toastSuccess(`${uploadedItems.length} item${uploadedItems.length > 1 ? 's' : ''} uploaded`);
      } else if (errors.length > 0) {
        toastError(`Upload failed: ${errors[0].error?.message || 'unknown error'}`);
      }
    } catch (err) {
      toastError(`Upload error: ${err.message}`);
    }
    setIsUploading(false);
    setUploadProgress(null);
  }, [artistId, db, selectedAlbum, toastSuccess, toastError]);

  handleUploadRef.current = handleUpload;

  // Callback ref for file input
  const setFileInputRef = useCallback((el) => {
    fileInputRef.current = el;
    if (el && !el._hasNativeListener) {
      el._hasNativeListener = true;
      el.addEventListener('change', () => {
        if (el.files?.length && handleUploadRef.current) {
          handleUploadRef.current(el.files);
          el.value = '';
        }
      });
    }
  }, []);

  // Is currently viewing a pipeline?
  const isViewingPipeline = selectedAlbum !== 'all' && selectedAlbum !== 'unassigned';

  // Type tabs
  const typeTabs = [
    { value: 'all', label: 'All' },
    { value: 'photos', label: 'Photos' },
    { value: 'videos', label: 'Videos' },
    { value: 'audio', label: 'Audio' },
  ];

  // Sort label for dropdown trigger
  const sortLabel = SORT_OPTIONS.find(o => o.value === sortBy)?.label || 'Sort by Date';

  return (
    <div className="flex h-full w-full flex-col items-start bg-black overflow-auto">
      {/* Hidden file input */}
      <input
        ref={setFileInputRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*"
        style={{ display: 'none' }}
      />

      {/* ═══ HORIZONTAL TOP NAV BAR ═══ */}
      <div className="flex w-full flex-none items-center gap-2 border-b border-solid border-neutral-800 px-6 py-3">
        {/* Album pills: All Media */}
        <button
          className={`flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-caption font-caption transition-colors ${
            selectedAlbum === 'all'
              ? 'border-[#404040] bg-[#2a2a2a] text-white'
              : 'border-[#404040] bg-[#171717] text-[#d4d4d4] hover:border-[#737373]'
          }`}
          onClick={() => setSelectedAlbum('all')}
        >
          <FeatherGrid style={{ width: 12, height: 12 }} />
          <span>All Media</span>
          <span className="text-[#737373]">{library.length}</span>
        </button>

        {/* Pipeline pills or dropdown */}
        {pipelines.length > 0 && pipelines.length <= 5 ? (
          // Show as pills when ≤5 pipelines
          pipelines.map(pipeline => {
            const isSelected = selectedAlbum === pipeline.id;
            return (
              <button
                key={pipeline.id}
                className={`flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-caption font-caption transition-colors ${
                  isSelected
                    ? 'border-[#404040] bg-[#2a2a2a] text-white'
                    : 'border-[#404040] bg-[#171717] text-[#d4d4d4] hover:border-[#737373]'
                }`}
                onClick={() => setSelectedAlbum(pipeline.id)}
              >
                <div
                  className="h-1.5 w-1.5 flex-none rounded-full"
                  style={{ backgroundColor: pipeline.pipelineColor || '#6366f1' }}
                />
                <span className="truncate max-w-[120px]">{pipeline.name}</span>
              </button>
            );
          })
        ) : pipelines.length > 5 ? (
          // Show as dropdown when >5 pipelines
          <SubframeCore.DropdownMenu.Root>
            <SubframeCore.DropdownMenu.Trigger asChild>
              <button
                className={`flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-caption font-caption transition-colors ${
                  isViewingPipeline
                    ? 'border-[#404040] bg-[#2a2a2a] text-white'
                    : 'border-[#404040] bg-[#171717] text-[#d4d4d4] hover:border-[#737373]'
                }`}
              >
                <FeatherFolder style={{ width: 12, height: 12 }} />
                <span>{isViewingPipeline ? albumTitle : 'Pipelines'}</span>
                <FeatherChevronDown style={{ width: 10, height: 10 }} />
              </button>
            </SubframeCore.DropdownMenu.Trigger>
            <SubframeCore.DropdownMenu.Portal>
              <SubframeCore.DropdownMenu.Content side="bottom" align="start" sideOffset={4} asChild>
                <DropdownMenu>
                  {pipelines.map(pipeline => (
                    <DropdownMenu.DropdownItem
                      key={pipeline.id}
                      icon={null}
                      onClick={() => setSelectedAlbum(pipeline.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-1.5 w-1.5 flex-none rounded-full"
                          style={{ backgroundColor: pipeline.pipelineColor || '#6366f1' }}
                        />
                        {pipeline.name}
                      </div>
                    </DropdownMenu.DropdownItem>
                  ))}
                </DropdownMenu>
              </SubframeCore.DropdownMenu.Content>
            </SubframeCore.DropdownMenu.Portal>
          </SubframeCore.DropdownMenu.Root>
        ) : null}

        {/* Unassigned pill */}
        <button
          className={`flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-caption font-caption transition-colors ${
            selectedAlbum === 'unassigned'
              ? 'border-[#404040] bg-[#2a2a2a] text-white'
              : 'border-[#404040] bg-[#171717] text-[#d4d4d4] hover:border-[#737373]'
          }`}
          onClick={() => setSelectedAlbum('unassigned')}
        >
          <FeatherFileQuestion style={{ width: 12, height: 12 }} />
          <span>Unassigned</span>
          <span className="text-[#737373]">{unassignedMedia.length}</span>
        </button>

        {/* Spacer */}
        <div className="grow" />

        {/* Search */}
        <TextField className="h-auto w-56 flex-none" variant="filled" icon={<FeatherSearch />}>
          <TextField.Input
            placeholder="Search media..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </TextField>

        {/* Upload */}
        <Button
          variant="brand-primary"
          size="medium"
          icon={<FeatherUpload />}
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading
            ? `${uploadProgress?.current || 0}/${uploadProgress?.total || 0}`
            : 'Upload'}
        </Button>

        {/* Cloud Import */}
        <CloudImportButton
          artistId={artistId}
          db={db}
          mediaType="all"
          onImportMedia={(files) => {
            const realFiles = files.map(f => f.file).filter(Boolean);
            if (realFiles.length > 0) handleUpload(realFiles);
          }}
        />
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex w-full grow flex-col items-start overflow-auto">
        <div className="flex w-full flex-col items-start gap-6 px-8 py-8">
          {/* Header row: title + sort */}
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-heading-1 font-heading-1 text-[#ffffffff]">{albumTitle}</span>
              <Badge variant="neutral">{itemCount} item{itemCount !== 1 ? 's' : ''}</Badge>
            </div>
            <SubframeCore.DropdownMenu.Root>
              <SubframeCore.DropdownMenu.Trigger asChild>
                <Button variant="neutral-secondary" icon={<FeatherArrowDownUp />} iconRight={<FeatherChevronDown />}>
                  {sortLabel}
                </Button>
              </SubframeCore.DropdownMenu.Trigger>
              <SubframeCore.DropdownMenu.Portal>
                <SubframeCore.DropdownMenu.Content side="bottom" align="end" sideOffset={4} asChild>
                  <DropdownMenu>
                    {SORT_OPTIONS.map(opt => (
                      <DropdownMenu.DropdownItem key={opt.value} icon={null} onClick={() => setSortBy(opt.value)}>
                        {opt.label}
                      </DropdownMenu.DropdownItem>
                    ))}
                  </DropdownMenu>
                </SubframeCore.DropdownMenu.Content>
              </SubframeCore.DropdownMenu.Portal>
            </SubframeCore.DropdownMenu.Root>
          </div>

          {/* Type filter tabs */}
          <div className="flex w-full items-end border-b border-solid border-neutral-800">
            <div className="flex items-start">
              {typeTabs.map(tab => {
                const isActive = !showDrafts && activeTypeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    className={`flex h-10 items-center justify-center gap-2 px-3 py-0.5 cursor-pointer border-b-2 transition-colors ${
                      isActive
                        ? 'border-brand-600 text-brand-700'
                        : 'border-transparent text-neutral-400 hover:text-white'
                    }`}
                    onClick={() => { setShowDrafts(false); setActiveTypeTab(tab.value); }}
                  >
                    <span className="text-body-bold font-body-bold whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
              {/* Drafts tab (only for pipeline views) */}
              {isViewingPipeline && (
                <button
                  className={`flex h-10 items-center justify-center gap-2 px-3 py-0.5 cursor-pointer border-b-2 transition-colors ${
                    showDrafts
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-neutral-400 hover:text-white'
                  }`}
                  onClick={() => setShowDrafts(true)}
                >
                  <span className="text-body-bold font-body-bold whitespace-nowrap">
                    Drafts ({pipelineDrafts.length})
                  </span>
                </button>
              )}
            </div>
            <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 self-stretch border-b-2 border-transparent" />
          </div>

          {/* Grid: Drafts or Media */}
          {showDrafts ? (
            pipelineDrafts.length > 0 ? (
              <div className={`grid w-full gap-4 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
                {pipelineDrafts.map(draft => (
                  <DraftCard key={draft.id} draft={draft} type={draft._draftType} />
                ))}
              </div>
            ) : (
              <div className="flex w-full flex-col items-center justify-center gap-3 py-16">
                <FeatherFilm className="text-[48px] text-neutral-600" style={{ width: 48, height: 48 }} />
                <span className="text-body font-body text-neutral-400">No drafts in this pipeline</span>
              </div>
            )
          ) : filteredMedia.length > 0 ? (
            (() => {
              const audioItems = filteredMedia.filter(i => i.type === MEDIA_TYPES.AUDIO);
              const visualItems = filteredMedia.filter(i => i.type !== MEDIA_TYPES.AUDIO);
              return (
                <div className="flex w-full flex-col gap-4">
                  {/* Audio — thin horizontal rows */}
                  {audioItems.length > 0 && (
                    <div className="flex w-full flex-col gap-1">
                      {audioItems.map(item => (
                        <MediaCard
                          key={item.id}
                          item={item}
                          pipelineColor={pipelineColorMap[item.id]}
                          playingAudioId={playingAudioId}
                          onToggleAudio={toggleAudioPlay}
                          playingVideoId={playingVideoId}
                          onToggleVideo={toggleVideoPlay}
                          onViewImage={setLightboxImage}
                        />
                      ))}
                    </div>
                  )}
                  {/* Image/video grid */}
                  {visualItems.length > 0 && (
                    <div className={`grid w-full gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
                      {visualItems.map(item => (
                        <MediaCard
                          key={item.id}
                          item={item}
                          pipelineColor={pipelineColorMap[item.id]}
                          playingAudioId={playingAudioId}
                          onToggleAudio={toggleAudioPlay}
                          playingVideoId={playingVideoId}
                          onToggleVideo={toggleVideoPlay}
                          onViewImage={setLightboxImage}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="flex w-full flex-col items-center justify-center gap-3 py-16">
              <FeatherFolder className="text-neutral-600" style={{ width: 48, height: 48 }} />
              <span className="text-body font-body text-neutral-400">
                {searchQuery ? 'No media matches your search' : 'No media yet'}
              </span>
              <Button
                variant="brand-primary"
                icon={<FeatherUpload />}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload Media
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ═══ FULLSCREEN IMAGE LIGHTBOX ═══ */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 cursor-pointer"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="absolute top-6 right-6 flex items-center justify-center rounded-full cursor-pointer transition-colors"
            style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#171717', border: '1px solid #404040' }}
            onClick={(e) => { e.stopPropagation(); setLightboxImage(null); }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#262626'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#171717'; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <img
            className="max-w-[90vw] max-h-[90vh] object-contain"
            src={lightboxImage.url || lightboxImage.thumbnailUrl}
            alt={lightboxImage.name || 'Image'}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <span className="text-body font-body text-neutral-300 bg-black/60 px-4 py-2 rounded-lg">
              {lightboxImage.name || 'Untitled'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudioLibrary;
