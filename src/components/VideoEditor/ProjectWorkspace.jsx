/**
 * ProjectWorkspace — Unified workspace: media pool + niche tabs + niche content
 * Left: shared media pool (images + audio, with scope toggle)
 * Top: niche tabs + "+ New Niche"
 * Right: routes to SlideshowNicheContent or VideoNicheContent based on active niche
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  getLibrary,
  getCollections,
  getCreatedContent,
  getProjectById,
  getProjectNiches,
  createNiche,
  addToProjectPool,
  assignToBank,
  migrateCollectionBanks,
  addToCollectionAsync,
  addToLibraryAsync,
  saveCollections,
  saveCollectionToFirestore,
  deleteCollectionAsync,
  subscribeToCollections,
  subscribeToLibrary,
  subscribeToCreatedContent,
  FORMAT_TEMPLATES,
  MEDIA_TYPES,
  getBankColor,
  THUMB_MAX_SIZE,
  THUMB_QUALITY,
  THUMB_VERSION,
  migrateThumbnails,
  updateNicheCaptionBank,
  updateNicheHashtagBank,
  moveNicheBankEntry,
} from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';
import { convertImageIfNeeded } from '../../utils/imageConverter';
import { convertAudioIfNeeded } from '../../utils/audioConverter';
import { runPool } from '../../utils/uploadPool';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import {
  FeatherUpload, FeatherUploadCloud, FeatherDownloadCloud, FeatherPlus, FeatherX,
  FeatherArrowLeft, FeatherImage, FeatherMusic, FeatherPlay,
  FeatherCheck, FeatherFilm, FeatherLayers, FeatherCamera,
  FeatherFileText, FeatherSearch, FeatherChevronDown,
  FeatherHash, FeatherMessageSquare, FeatherTrash2, FeatherScissors,
} from '@subframe/core';
import * as SubframeCore from '@subframe/core';
import { useToast, ConfirmDialog } from '../ui';
import SlideshowNicheContent from './SlideshowNicheContent';
import VideoNicheContent from './VideoNicheContent';
import FinishedMediaNicheContent from './FinishedMediaNicheContent';
import ClipperNicheContent from './ClipperNicheContent';
import useMediaMultiSelect from './shared/useMediaMultiSelect';
import log from '../../utils/logger';

const FORMAT_TO_EDITOR = {
  montage: 'montage',
  solo_clip: 'solo-clip',
  multi_clip: 'multi-clip',
  photo_montage: 'photo-montage',
  clipper: 'clipper',
};

const FORMAT_ICONS = {
  montage: FeatherFilm,
  solo_clip: FeatherPlay,
  multi_clip: FeatherLayers,
  photo_montage: FeatherCamera,
  finished_media: FeatherUploadCloud,
  clipper: FeatherScissors,
};

const VIDEO_FORMAT_COLORS = {
  montage: '#6366f1',       // indigo
  solo_clip: '#22c55e',     // green
  multi_clip: '#f59e0b',    // amber
  photo_montage: '#a855f7', // purple
  finished_media: '#06b6d4', // cyan
  clipper: '#f43f5e',         // rose
};

const ProjectWorkspace = ({
  db,
  artistId,
  projectId,
  initialNicheId = null,
  onBack,
  onOpenEditor,
  onOpenVideoEditor,
  onViewDrafts,
  onSchedule,
  latePages = [],
}) => {
  const { success: toastSuccess, error: toastError } = useToast();

  // Data
  const [collections, setCollections] = useState(() => artistId ? getCollections(artistId) : []);
  const [library, setLibrary] = useState(() => artistId ? getLibrary(artistId) : []);
  const [createdContent, setCreatedContent] = useState(() => artistId ? getCreatedContent(artistId) : { videos: [], slideshows: [] });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Active niche tab
  const [activeNicheId, setActiveNicheId] = useState(initialNicheId);

  // Media pool scope: 'all' = project root, 'niche' = active niche only
  const [mediaScope, setMediaScope] = useState('all');

  // Selected audio
  const [selectedAudioId, setSelectedAudioId] = useState(null);

  // (Multi-select hook called after filteredImages is computed below)

  // Show niche format picker
  const [showNichePicker, setShowNichePicker] = useState(false);

  // Caption & Hashtag page
  const [showCaptionPage, setShowCaptionPage] = useState(false);

  // Import from library modal
  const [showImportModal, setShowImportModal] = useState(false);

  // Bank upload: when user clicks "+" in a bank, we track which bank to assign after upload
  const pendingBankIndexRef = useRef(null);

  // Bank import: when user clicks "Import" in a bank, track which bank to assign after import
  const pendingImportBankRef = useRef(null);

  // Media search filter
  const [mediaSearch, setMediaSearch] = useState('');

  // Audio picker expanded
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);

  // Subscribe to data
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

  // Background thumbnail regeneration (v1→v2 quality upgrade)
  const thumbMigrationRef = useRef(false);
  useEffect(() => {
    if (!db || !artistId || thumbMigrationRef.current) return;
    const needsUpgrade = library.some(item =>
      item.type === MEDIA_TYPES.IMAGE && item.url && item.thumbVersion !== THUMB_VERSION
    );
    if (!needsUpgrade) return;
    thumbMigrationRef.current = true;
    migrateThumbnails(db, artistId, library, uploadFile).catch(log.error);
  }, [db, artistId, library]);

  // Project root
  const project = useMemo(() => {
    return collections.find(c => c.id === projectId && c.isProjectRoot) || null;
  }, [collections, projectId]);

  // Niches in this project
  const niches = useMemo(() => {
    return collections.filter(c => c.projectId === projectId && c.isPipeline);
  }, [collections, projectId]);

  // Auto-select first niche if none selected
  useEffect(() => {
    if (!activeNicheId && niches.length > 0) {
      setActiveNicheId(niches[0].id);
    }
  }, [niches, activeNicheId]);

  // Active niche
  const activeNiche = useMemo(() => {
    if (!activeNicheId) return null;
    const n = collections.find(c => c.id === activeNicheId);
    return n ? migrateCollectionBanks(n) : null;
  }, [collections, activeNicheId]);

  const activeFormat = activeNiche?.formats?.find(f => f.id === activeNiche.activeFormatId) || activeNiche?.formats?.[0];

  // Project pool media
  const projectMedia = useMemo(() => {
    if (!project) return [];
    return library.filter(item => (project.mediaIds || []).includes(item.id));
  }, [project, library]);

  // Niche media
  const nicheMedia = useMemo(() => {
    if (!activeNiche) return [];
    return library.filter(item => (activeNiche.mediaIds || []).includes(item.id));
  }, [activeNiche, library]);

  // Scoped media for display
  const scopedMedia = mediaScope === 'niche' ? nicheMedia : projectMedia;
  const scopedImages = useMemo(() => scopedMedia.filter(m => m.type === 'image'), [scopedMedia]);

  // Search-filtered images
  const filteredImages = useMemo(() => {
    if (!mediaSearch.trim()) return scopedImages;
    const q = mediaSearch.toLowerCase();
    return scopedImages.filter(m => (m.name || '').toLowerCase().includes(q));
  }, [scopedImages, mediaSearch]);

  // Multi-select (shared hook)
  const {
    selectedIds: selectedMediaIds,
    setSelectedIds: setSelectedMediaIds,
    isDragSelecting,
    rubberBand,
    gridRef,
    gridMouseHandlers,
    toggleSelect: toggleMediaSelect,
    selectAll,
    clearSelection,
    draggingIds: draggingMediaIds,
    setDraggingIds: setDraggingMediaIds,
    makeDraggableProps,
  } = useMediaMultiSelect(filteredImages);

  // Audio always from project pool
  const projectAudio = useMemo(() => projectMedia.filter(m => m.type === 'audio'), [projectMedia]);

  // Selected audio item
  const selectedAudio = useMemo(
    () => projectAudio.find(a => a.id === selectedAudioId) || projectAudio[0] || null,
    [projectAudio, selectedAudioId]
  );

  // Bank assignment check
  const getImageBankIndex = useCallback((mediaId) => {
    if (!activeNiche?.banks) return -1;
    for (let i = 0; i < activeNiche.banks.length; i++) {
      if (activeNiche.banks[i]?.includes(mediaId)) return i;
    }
    return -1;
  }, [activeNiche]);

  // Draft counts per niche
  const nicheDraftCounts = useMemo(() => {
    const counts = {};
    niches.forEach(n => {
      const slideshowCount = (createdContent.slideshows || []).filter(s => s.collectionId === n.id && !s.isTemplate).length;
      const videoCount = (createdContent.videos || []).filter(v => v.collectionId === n.id).length;
      counts[n.id] = slideshowCount + videoCount;
    });
    return counts;
  }, [niches, createdContent]);

  // Upload handler
  const fileInputRef = useRef(null);
  const handleUploadRef = useRef(null);

  const handleUpload = async (files) => {
    if (!files?.length) { toastError('No files selected'); return; }
    if (!artistId || !project) { toastError('No project selected'); return; }
    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length });

    const processOne = async (rawFile) => {
      let file = rawFile;
      if (rawFile.type?.startsWith('image')) file = await convertImageIfNeeded(rawFile);
      else if (rawFile.type?.startsWith('audio')) file = await convertAudioIfNeeded(rawFile);

      const isAudio = file.type?.startsWith('audio');
      const folder = isAudio ? 'audio' : 'images';
      const { url, path } = await uploadFile(file, folder);

      let thumbnailUrl = null;
      if (!isAudio) {
        try {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          await new Promise(r => { img.onload = r; });
          const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', THUMB_QUALITY));
          if (blob) {
            const tf = new File([blob], `thumb_${file.name}`, { type: 'image/jpeg' });
            const tr = await uploadFile(tf, 'thumbnails');
            thumbnailUrl = tr.url;
          }
        } catch (e) { /* skip thumb */ }
      }

      // Target collection: active niche (if exists) or project root
      const targetCollectionId = activeNicheId || projectId;

      const item = {
        type: isAudio ? MEDIA_TYPES.AUDIO : MEDIA_TYPES.IMAGE,
        name: file.name,
        url,
        thumbnailUrl,
        thumbVersion: thumbnailUrl ? THUMB_VERSION : undefined,
        storagePath: path,
        collectionIds: [targetCollectionId],
        metadata: { fileSize: file.size, mimeType: file.type },
      };

      const savedItem = await addToLibraryAsync(db, artistId, item);
      // Add to target collection
      await addToCollectionAsync(db, artistId, targetCollectionId, savedItem.id);
      // Also add to project pool if uploading in a niche
      if (activeNicheId && activeNicheId !== projectId) {
        addToProjectPool(artistId, projectId, [savedItem.id]);
        if (db && project) {
          const updatedProject = getCollections(artistId).find(c => c.id === projectId);
          if (updatedProject) saveCollectionToFirestore(db, artistId, updatedProject);
        }
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
        // If triggered from a bank "+", assign uploaded images to that bank
        const bankIdx = pendingBankIndexRef.current;
        if (bankIdx != null && activeNicheId) {
          const imageItems = uploadedItems.filter(i => i.type !== MEDIA_TYPES.AUDIO);
          imageItems.forEach(item => assignToBank(artistId, activeNicheId, item.id, bankIdx));
          if (db) {
            const updated = getCollections(artistId).find(c => c.id === activeNicheId);
            if (updated) saveCollectionToFirestore(db, artistId, updated);
          }
          pendingBankIndexRef.current = null;
        }
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
  };

  handleUploadRef.current = handleUpload;

  const setFileInputRef = useCallback((el) => {
    fileInputRef.current = el;
    if (el && !el._hasNativeListener) {
      el._hasNativeListener = true;
      el.addEventListener('change', () => {
        if (el.files?.length && handleUploadRef.current) {
          handleUploadRef.current(el.files);
        }
      });
    }
  }, []);

  // Trigger file upload targeting a specific bank index
  const handleUploadToBank = useCallback((bankIndex) => {
    pendingBankIndexRef.current = bankIndex;
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // reset so same file re-triggers
      fileInputRef.current.accept = 'image/*';
      fileInputRef.current.click();
    }
  }, []);

  // Trigger import modal targeting a specific bank
  const handleImportToBank = useCallback((bankIndex) => {
    pendingImportBankRef.current = bankIndex;
    setShowImportModal(true);
  }, []);

  // Create niche
  const handleCreateNiche = useCallback(async (format) => {
    try {
      const niche = createNiche(artistId, { projectId, format });
      if (db) await saveCollectionToFirestore(db, artistId, niche);
      setActiveNicheId(niche.id);
      setShowNichePicker(false);
      toastSuccess(`"${format.name}" niche created`);
    } catch (err) {
      toastError('Failed to create niche');
    }
  }, [artistId, projectId, db, toastSuccess, toastError]);

  // Delete niche with confirmation
  const handleDeleteNiche = useCallback(async (nicheId) => {
    const niche = collections.find(c => c.id === nicheId);
    if (!niche) return;
    if (!window.confirm(`Delete "${niche.name}"? This cannot be undone.`)) return;
    try {
      await deleteCollectionAsync(db, artistId, nicheId);
      if (activeNicheId === nicheId) {
        const remaining = niches.filter(n => n.id !== nicheId);
        setActiveNicheId(remaining.length > 0 ? remaining[0].id : null);
      }
      toastSuccess(`"${niche.name}" deleted`);
    } catch (err) {
      toastError('Failed to delete niche');
    }
  }, [collections, db, artistId, activeNicheId, niches, toastSuccess, toastError]);

  // Clear selection when scope/search changes
  useEffect(() => { clearSelection(); }, [mediaScope, mediaSearch, clearSelection]);


  // Import from library
  const availableLibraryMedia = useMemo(() => {
    if (!project) return [];
    const poolIds = new Set(project.mediaIds || []);
    return library.filter(item => !poolIds.has(item.id));
  }, [library, project]);

  const handleImportFromLibrary = useCallback((selectedIds) => {
    if (!selectedIds.length || !project) return;
    addToProjectPool(artistId, projectId, selectedIds);
    if (activeNicheId) {
      // Also add to niche
      const cols = getCollections(artistId);
      const nicheIdx = cols.findIndex(c => c.id === activeNicheId);
      if (nicheIdx !== -1) {
        const existing = new Set(cols[nicheIdx].mediaIds || []);
        const newIds = selectedIds.filter(id => !existing.has(id));
        cols[nicheIdx] = { ...cols[nicheIdx], mediaIds: [...(cols[nicheIdx].mediaIds || []), ...newIds], updatedAt: new Date().toISOString() };
        saveCollections(artistId, cols);
        if (db) saveCollectionToFirestore(db, artistId, cols[nicheIdx]);
      }
    }
    if (db && project) {
      const updatedProject = getCollections(artistId).find(c => c.id === projectId);
      if (updatedProject) saveCollectionToFirestore(db, artistId, updatedProject);
    }
    // If triggered from a bank "Import", assign imported images to that bank
    const bankIdx = pendingImportBankRef.current;
    if (bankIdx != null && activeNicheId) {
      const imageIds = selectedIds.filter(id => {
        const item = library.find(m => m.id === id);
        return item && item.type !== MEDIA_TYPES.AUDIO;
      });
      imageIds.forEach(id => assignToBank(artistId, activeNicheId, id, bankIdx));
      if (db) {
        const updated = getCollections(artistId).find(c => c.id === activeNicheId);
        if (updated) saveCollectionToFirestore(db, artistId, updated);
      }
      pendingImportBankRef.current = null;
    }
    setShowImportModal(false);
    toastSuccess(`Imported ${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''}`);
  }, [project, artistId, projectId, activeNicheId, db, library, toastSuccess]);

  if (!project) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-neutral-400">Loading project...</span>
      </div>
    );
  }

  const slideshowFormats = FORMAT_TEMPLATES.filter(f => f.type === 'slideshow');
  const videoFormats = FORMAT_TEMPLATES.filter(f => f.type === 'video');

  return (
    <div className="flex h-full w-full flex-col items-start bg-black">
      {/* Top header bar */}
      <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 bg-black px-6 py-4">
        <div className="flex items-center gap-4">
          <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherArrowLeft />} aria-label="Back" onClick={onBack} />
          <div
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
            style={{ backgroundColor: project.projectColor || '#6366f1' }}
          >
            <span className="text-caption-bold font-caption-bold text-[#ffffffff]">
              {(project.name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map(w => (w.replace(/[^a-zA-Z0-9]/g, '')[0] || w[0])).join('').toUpperCase()}
            </span>
          </div>
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{project.name}</span>
            {project.linkedPage && (
              <span className="text-caption font-caption text-neutral-400">
                @{project.linkedPage.handle} · {project.linkedPage.platform}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="brand" icon={<FeatherImage />}>{projectMedia.length} Assets</Badge>
          {onSchedule && (
            <Button variant="neutral-secondary" size="small" onClick={onSchedule}>Schedule</Button>
          )}
        </div>
      </div>

      {/* Niche tabs */}
      <div className="flex w-full items-center gap-0 border-b border-solid border-neutral-800 bg-black px-6 overflow-x-auto">
        {niches.map(niche => {
          const isActive = niche.id === activeNicheId;
          const fmt = niche.formats?.[0];
          const draftCount = nicheDraftCounts[niche.id] || 0;
          return (
            <div
              key={niche.id}
              className={`group flex items-center gap-2 px-4 py-3 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                isActive ? 'border-[#6366f1ff] text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
              onClick={() => setActiveNicheId(niche.id)}
            >
              <span className="text-body-bold font-body-bold">{niche.name}</span>
              {draftCount > 0 && (
                <span className={`text-caption font-caption px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-neutral-800 text-neutral-400'
                }`}>
                  {draftCount}
                </span>
              )}
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-neutral-700"
                onClick={(e) => { e.stopPropagation(); handleDeleteNiche(niche.id); }}
                title="Delete niche"
              >
                <FeatherX style={{ width: 12, height: 12 }} />
              </button>
            </div>
          );
        })}
        <button
          className="flex items-center gap-1 px-4 py-3 text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors whitespace-nowrap"
          onClick={() => setShowNichePicker(true)}
        >
          <FeatherPlus style={{ width: 14, height: 14 }} />
          <span className="text-caption-bold font-caption-bold">New Niche</span>
        </button>
        <div className="flex-1" />
        <div
          className={`flex items-center gap-1.5 px-4 py-3 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
            showCaptionPage ? 'border-[#6366f1ff] text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
          onClick={() => setShowCaptionPage(!showCaptionPage)}
        >
          <FeatherHash style={{ width: 14, height: 14 }} />
          <span className="text-caption-bold font-caption-bold">Captions & Hashtags</span>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex items-start overflow-hidden flex-1 self-stretch">
        {/* Left — Media Pool */}
        <div className="flex w-72 flex-none flex-col items-start self-stretch border-r border-solid border-neutral-800 bg-black">
          {/* Header + actions */}
          <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-caption-bold font-caption-bold text-[#ffffffff]">Media</span>
              <Badge variant="neutral">{scopedImages.length}</Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button className="h-auto" variant="neutral-tertiary" size="small" icon={<FeatherUpload />}
                onClick={() => { pendingBankIndexRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'image/*,audio/*'; fileInputRef.current.click(); } }} />
              <Button className="h-auto" variant="neutral-tertiary" size="small" icon={<FeatherDownloadCloud />}
                onClick={() => { pendingImportBankRef.current = null; setShowImportModal(true); }} />
            </div>
          </div>

          {/* Search */}
          <div className="flex w-full items-center gap-2 px-3 py-2 border-b border-solid border-neutral-800">
            <FeatherSearch className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
            <input
              className="w-full bg-transparent text-caption font-caption text-white placeholder-neutral-500 outline-none"
              placeholder="Search images..."
              value={mediaSearch}
              onChange={e => setMediaSearch(e.target.value)}
            />
            {mediaSearch && (
              <button className="text-neutral-500 hover:text-white flex-none" onClick={() => setMediaSearch('')}>
                <FeatherX style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>

          {/* Scope toggle */}
          {activeNicheId && (
            <div className="flex w-full items-center justify-center px-3 py-1.5 border-b border-solid border-neutral-800">
              <ToggleGroup value={mediaScope} onValueChange={(v) => v && setMediaScope(v)}>
                <ToggleGroup.Item icon={null} value="all">All Media</ToggleGroup.Item>
                <ToggleGroup.Item icon={null} value="niche">This Niche</ToggleGroup.Item>
              </ToggleGroup>
            </div>
          )}

          <input
            ref={setFileInputRef} type="file" multiple accept="image/*,audio/*"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
          />

          {/* Upload progress */}
          {isUploading && uploadProgress && (
            <div className="w-full px-3 py-1.5 border-b border-solid border-neutral-800">
              <div className="h-1 w-full bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
              </div>
              <span className="text-caption font-caption text-neutral-400 mt-1">{uploadProgress.current}/{uploadProgress.total}</span>
            </div>
          )}

          {/* Select All / count bar */}
          {filteredImages.length > 0 && (
            <div className="flex w-full items-center justify-between px-3 py-1 border-b border-solid border-neutral-800">
              <button
                className="text-caption font-caption text-indigo-400 hover:text-indigo-300"
                onClick={selectAll}
              >
                {selectedMediaIds.size === filteredImages.length ? 'Deselect All' : 'Select All'}
              </button>
              {selectedMediaIds.size > 0 && (
                <span className="text-caption font-caption text-neutral-400">{selectedMediaIds.size} selected</span>
              )}
            </div>
          )}

          {/* Compact image grid — 4 columns with multi-select + rubber-band */}
          <div
            className="flex w-full grow flex-col items-start px-2 py-2 overflow-y-auto relative"
            ref={gridRef}
            {...gridMouseHandlers}
            style={{ userSelect: isDragSelecting ? 'none' : undefined }}
          >
            {rubberBand && (
              <div
                className="absolute pointer-events-none border border-indigo-400 bg-indigo-500/20 z-10 rounded-sm"
                style={{ left: rubberBand.left, top: rubberBand.top, width: rubberBand.width, height: rubberBand.height }}
              />
            )}
            <div className="w-full gap-1 grid grid-cols-4">
              {filteredImages.map(item => {
                const bankIdx = getImageBankIndex(item.id);
                const bankColor = bankIdx >= 0 ? getBankColor(bankIdx) : null;
                const isSelected = selectedMediaIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    data-media-id={item.id}
                    className="relative aspect-square"
                    {...makeDraggableProps(item.id)}
                    onClick={(e) => {
                      if (isDragSelecting) return;
                      e.stopPropagation();
                      toggleMediaSelect(item.id, e);
                    }}
                  >
                    <img
                      className={`w-full h-full rounded object-cover border-2 transition ${
                        isSelected ? 'border-indigo-500' : 'border-neutral-800 hover:border-neutral-600'
                      }`}
                      src={item.thumbnailUrl || item.url}
                      alt={item.name}
                      loading="lazy"
                      draggable={false}
                      style={{ pointerEvents: isDragSelecting ? 'none' : undefined }}
                    />
                    {isSelected && (
                      <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-indigo-500 flex items-center justify-center">
                        <FeatherCheck className="text-white" style={{ width: 10, height: 10 }} />
                      </div>
                    )}
                    {bankColor && !isSelected && (
                      <div className="h-1.5 w-1.5 rounded-full absolute bottom-0.5 right-0.5"
                        style={{ backgroundColor: bankColor.primary }} />
                    )}
                  </div>
                );
              })}
            </div>

            {filteredImages.length === 0 && scopedImages.length > 0 && mediaSearch && (
              <div className="flex w-full items-center justify-center py-6">
                <span className="text-caption font-caption text-neutral-500">No matches for "{mediaSearch}"</span>
              </div>
            )}

            {scopedMedia.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center w-full">
                <FeatherImage className="w-12 h-12 text-zinc-600" />
                <h3 className="text-lg font-semibold text-white">No media in pool</h3>
                <p className="text-sm text-zinc-400 max-w-xs">
                  Upload images and audio to start creating
                </p>
              </div>
            )}
          </div>

          {/* Audio — pinned at bottom, dropdown opens upward */}
          {projectAudio.length > 0 && (
            <div className="relative flex w-full flex-col flex-none border-t border-solid border-neutral-800">
              {audioPickerOpen && (
                <div className="absolute bottom-full left-0 right-0 flex flex-col gap-0.5 px-2 py-2 bg-[#111111] border border-neutral-700 rounded-t-lg max-h-64 overflow-y-auto shadow-xl">
                  {projectAudio.map(audio => {
                    const isSelected = selectedAudio?.id === audio.id;
                    return (
                      <button
                        key={audio.id}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                          isSelected ? 'bg-indigo-600' : 'hover:bg-neutral-800'
                        }`}
                        onClick={() => { setSelectedAudioId(audio.id); setAudioPickerOpen(false); }}
                      >
                        <FeatherPlay className="text-neutral-300 flex-none" style={{ width: 10, height: 10 }} />
                        <span className="text-caption font-caption text-[#ffffffff] truncate grow">{audio.name}</span>
                        {isSelected && <FeatherCheck className="text-indigo-300 flex-none" style={{ width: 12, height: 12 }} />}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-[#262626] transition"
                onClick={() => setAudioPickerOpen(!audioPickerOpen)}
              >
                <FeatherMusic className="text-indigo-400 flex-none" style={{ width: 14, height: 14 }} />
                <span className="text-caption-bold font-caption-bold text-[#ffffffff] truncate grow text-left">
                  {selectedAudio?.name || 'Select audio'}
                </span>
                <FeatherChevronDown
                  className="text-neutral-400 flex-none transition-transform"
                  style={{ width: 14, height: 14, transform: audioPickerOpen ? 'rotate(180deg)' : 'none' }}
                />
              </button>
            </div>
          )}
        </div>

        {/* Right content — Caption page or niche content */}
        {showCaptionPage && (
          <ProjectCaptionPage
            artistId={artistId}
            niches={niches}
            collections={collections}
          />
        )}

        {!showCaptionPage && activeNiche && activeFormat?.type === 'slideshow' && (
          <SlideshowNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            library={library}
            createdContent={createdContent}
            selectedAudio={selectedAudio}
            draggingMediaIds={draggingMediaIds}
            onOpenEditor={onOpenEditor}
            onViewDrafts={onViewDrafts}
            allNiches={niches}
            onUploadToBank={handleUploadToBank}
            onImportToBank={handleImportToBank}
          />
        )}

        {!showCaptionPage && activeNiche && activeFormat?.id === 'clipper' && (
          <ClipperNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            createdContent={createdContent}
            onMakeVideo={(format, nicheId, existingDraft) => {
              onOpenVideoEditor?.(format, nicheId, existingDraft);
            }}
            allNiches={niches}
          />
        )}

        {!showCaptionPage && activeNiche && activeFormat?.type === 'video' && activeFormat?.id !== 'finished_media' && activeFormat?.id !== 'clipper' && (
          <VideoNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            createdContent={createdContent}
            onMakeVideo={(format, nicheId, existingDraft) => {
              onOpenVideoEditor?.(format, nicheId, existingDraft);
            }}
            allNiches={niches}
          />
        )}

        {!showCaptionPage && activeNiche && activeFormat?.id === 'finished_media' && (
          <FinishedMediaNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            allNiches={niches}
          />
        )}

        {/* No niches — format picker */}
        {!showCaptionPage && niches.length === 0 && !showNichePicker && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 self-stretch">
            <div className="flex flex-col items-center gap-3">
              <FeatherPlus className="text-neutral-500" style={{ width: 32, height: 32 }} />
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">What do you want to make?</span>
              <span className="text-body font-body text-neutral-400">Choose a content format to create your first niche</span>
            </div>
            <div className="grid grid-cols-3 gap-4 max-w-2xl">
              {[...slideshowFormats, ...videoFormats].map(fmt => {
                const IconComp = FORMAT_ICONS[fmt.id] || FeatherImage;
                return (
                  <div
                    key={fmt.id}
                    className="flex flex-col items-center gap-3 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-5 cursor-pointer hover:border-neutral-600 transition-colors"
                    onClick={() => handleCreateNiche(fmt)}
                  >
                    {fmt.type === 'slideshow' ? (
                      <div className="flex items-center gap-1">
                        {fmt.slideLabels.map((label, i) => (
                          <div
                            key={i}
                            className="h-8 rounded"
                            style={{
                              width: `${Math.max(24, 80 / fmt.slideCount)}px`,
                              backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5] + '33',
                              border: `1px solid ${['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5]}55`,
                            }}
                          />
                        ))}
                      </div>
                    ) : (() => {
                      const color = VIDEO_FORMAT_COLORS[fmt.id] || '#6366f1';
                      return (
                        <div className="flex items-center justify-center rounded-md" style={{
                          width: 36, height: 36,
                          backgroundColor: color + '22',
                          border: `1px solid ${color}44`,
                        }}>
                          <IconComp style={{ width: 18, height: 18, color }} />
                        </div>
                      );
                    })()}
                    <span className="text-body-bold font-body-bold text-[#ffffffff]">{fmt.name}</span>
                    {fmt.description && (
                      <span className="text-caption font-caption text-neutral-400 text-center">{fmt.description}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* New Niche format picker modal */}
      {showNichePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setShowNichePicker(false)}>
          <div className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-[#111111] p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Add Niche</span>
              <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} aria-label="Close" onClick={() => setShowNichePicker(false)} />
            </div>

            <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Slideshows</span>
            <div className="grid grid-cols-3 gap-3 mb-6">
              {slideshowFormats.map(fmt => (
                <div
                  key={fmt.id}
                  className="flex flex-col items-start gap-3 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-4 py-4 cursor-pointer hover:border-neutral-600 transition-colors"
                  onClick={() => handleCreateNiche(fmt)}
                >
                  <div className="flex items-center gap-1">
                    {fmt.slideLabels.map((label, i) => (
                      <div key={i} className="h-8 rounded" style={{
                        width: `${Math.max(24, 80 / fmt.slideCount)}px`,
                        backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5] + '33',
                        border: `1px solid ${['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5]}55`,
                      }} />
                    ))}
                  </div>
                  <span className="text-body-bold font-body-bold text-[#ffffffff]">{fmt.name}</span>
                  <span className="text-caption font-caption text-neutral-400">{fmt.slideCount} slide{fmt.slideCount !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>

            <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Videos</span>
            <div className="grid grid-cols-3 gap-3">
              {videoFormats.map(fmt => {
                const IconComp = FORMAT_ICONS[fmt.id] || FeatherImage;
                const color = VIDEO_FORMAT_COLORS[fmt.id] || '#6366f1';
                return (
                  <div
                    key={fmt.id}
                    className="flex flex-col items-start gap-3 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-4 py-4 cursor-pointer hover:border-neutral-600 transition-colors"
                    onClick={() => handleCreateNiche(fmt)}
                  >
                    <div className="flex items-center justify-center rounded-md" style={{
                      width: 36, height: 36,
                      backgroundColor: color + '22',
                      border: `1px solid ${color}44`,
                    }}>
                      <IconComp style={{ width: 18, height: 18, color }} />
                    </div>
                    <span className="text-body-bold font-body-bold text-[#ffffffff]">{fmt.name}</span>
                    {fmt.description && <span className="text-caption font-caption text-neutral-400">{fmt.description}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Import from Library Modal */}
      {showImportModal && (
        <ImportFromLibraryModal
          items={availableLibraryMedia}
          onImport={handleImportFromLibrary}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
};

// Reused ImportFromLibraryModal with rubber-band drag selection
const ImportFromLibraryModal = ({ items, onImport, onClose }) => {
  const [selected, setSelected] = useState(new Set());
  const gridRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [rubberBand, setRubberBand] = useState(null);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  };

  const images = useMemo(() => items.filter(i => i.type === 'image'), [items]);
  const audio = useMemo(() => items.filter(i => i.type === 'audio'), [items]);

  // Use full-quality URL: prefer v2 thumbnails (200px/40%), fall back to full URL for v1 or missing
  const getImgSrc = useCallback((item) => {
    if (item.thumbVersion >= 2 && item.thumbnailUrl) return item.thumbnailUrl;
    return item.url;
  }, []);

  // Rubber-band helpers
  const getIdsInRect = useCallback((rect) => {
    if (!gridRef.current) return [];
    const ids = [];
    gridRef.current.querySelectorAll('[data-media-id]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > rect.left && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom) {
        ids.push(el.getAttribute('data-media-id'));
      }
    });
    return ids;
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0 || e.target.closest('[data-media-id]')) return;
    const container = gridRef.current;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    setDragStart({ x: e.clientX, y: e.clientY, scrollTop: container.scrollTop, cr });
    setIsDragging(false);
  }, []);

  const handleMouseMove = useCallback((e) => {
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

    const absRect = { left: Math.min(dragStart.x, e.clientX), right: Math.max(dragStart.x, e.clientX), top: Math.min(dragStart.y - scrollDelta, e.clientY), bottom: Math.max(dragStart.y - scrollDelta, e.clientY) };
    const hit = getIdsInRect(absRect);
    setSelected(new Set(hit));
  }, [dragStart, isDragging, getIdsInRect]);

  const handleMouseUp = useCallback(() => {
    setDragStart(null);
    setRubberBand(null);
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (dragStart) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
    }
  }, [dragStart, handleMouseMove, handleMouseUp]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-[#111111] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Import from Library</span>
            <span className="text-caption font-caption text-neutral-400">{items.length} item{items.length !== 1 ? 's' : ''} available</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="neutral-tertiary" size="small" onClick={selectAll}>
              {selected.size === items.length ? 'Deselect All' : 'Select All'}
            </Button>
            <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div
          ref={gridRef}
          className="max-h-[60vh] overflow-y-auto p-6 relative"
          onMouseDown={handleMouseDown}
          style={{ userSelect: isDragging ? 'none' : undefined }}
        >
          {rubberBand && (
            <div
              className="absolute pointer-events-none border border-indigo-400 bg-indigo-500/20 z-10 rounded-sm"
              style={{ left: rubberBand.left, top: rubberBand.top, width: rubberBand.width, height: rubberBand.height }}
            />
          )}
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <FeatherImage className="text-neutral-500" style={{ width: 32, height: 32 }} />
              <span className="text-body font-body text-neutral-400">No additional media in your library</span>
            </div>
          ) : (
            <>
              {images.length > 0 && (
                <>
                  <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Images ({images.length})</span>
                  <div className="grid grid-cols-5 gap-2 mb-6">
                    {images.map(item => (
                      <div key={item.id}
                        data-media-id={item.id}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                          selected.has(item.id) ? 'border-indigo-500' : 'border-transparent hover:border-neutral-600'
                        }`}
                        onClick={() => { if (!isDragging) toggle(item.id); }}
                      >
                        <img src={getImgSrc(item)} alt={item.name} className="h-full w-full object-cover" loading="lazy" draggable={false} />
                        {selected.has(item.id) && (
                          <div className="absolute inset-0 bg-indigo-500/30 flex items-center justify-center">
                            <FeatherCheck className="text-white" style={{ width: 20, height: 20 }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {audio.length > 0 && (
                <>
                  <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Audio ({audio.length})</span>
                  <div className="flex flex-col gap-1">
                    {audio.map(item => (
                      <div key={item.id}
                        data-media-id={item.id}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                          selected.has(item.id) ? 'bg-indigo-500/20 border border-indigo-500' : 'hover:bg-[#262626] border border-transparent'
                        }`}
                        onClick={() => { if (!isDragging) toggle(item.id); }}
                      >
                        <FeatherMusic className="text-neutral-400 flex-shrink-0" style={{ width: 16, height: 16 }} />
                        <span className="text-body font-body text-[#ffffffff] truncate flex-1">{item.name}</span>
                        {selected.has(item.id) && <FeatherCheck className="text-indigo-400 flex-shrink-0" style={{ width: 16, height: 16 }} />}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-neutral-800 px-6 py-4">
          <span className="text-caption font-caption text-neutral-400">
            {selected.size > 0 ? `${selected.size} selected` : 'Drag to select multiple'}
          </span>
          <div className="flex items-center gap-3">
            <Button variant="neutral-secondary" size="medium" onClick={onClose}>Cancel</Button>
            <Button variant="brand-primary" size="medium" disabled={selected.size === 0}
              onClick={() => onImport(Array.from(selected))}>
              Import {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════
// ProjectCaptionPage — Captions & Hashtags across all niches
// ═══════════════════════════════════════════════════
const ProjectCaptionPage = ({ artistId, niches, collections }) => {
  const { success: toastSuccess } = useToast();
  const [newCaptions, setNewCaptions] = useState({});
  const [newHashtags, setNewHashtags] = useState({});

  // Get fresh data from collections
  const getNiche = (nicheId) => collections.find(c => c.id === nicheId) || null;

  const handleAddCaption = (nicheId) => {
    const text = (newCaptions[nicheId] || '').trim();
    if (!text) return;
    const niche = getNiche(nicheId);
    if (!niche) return;
    const captions = [...(niche.captionBank || []), text];
    updateNicheCaptionBank(artistId, nicheId, captions);
    setNewCaptions(prev => ({ ...prev, [nicheId]: '' }));
  };

  const handleRemoveCaption = (nicheId, idx) => {
    const niche = getNiche(nicheId);
    if (!niche) return;
    const captions = [...(niche.captionBank || [])];
    captions.splice(idx, 1);
    updateNicheCaptionBank(artistId, nicheId, captions);
  };

  const handleAddHashtag = (nicheId) => {
    const raw = (newHashtags[nicheId] || '').trim();
    if (!raw) return;
    const tag = raw.startsWith('#') ? raw : `#${raw}`;
    const niche = getNiche(nicheId);
    if (!niche) return;
    const hashtags = [...(niche.hashtagBank || [])];
    if (!hashtags.includes(tag)) hashtags.push(tag);
    updateNicheHashtagBank(artistId, nicheId, hashtags);
    setNewHashtags(prev => ({ ...prev, [nicheId]: '' }));
  };

  const handleRemoveHashtag = (nicheId, idx) => {
    const niche = getNiche(nicheId);
    if (!niche) return;
    const hashtags = [...(niche.hashtagBank || [])];
    hashtags.splice(idx, 1);
    updateNicheHashtagBank(artistId, nicheId, hashtags);
  };

  const handleCopyAll = (nicheId) => {
    const niche = getNiche(nicheId);
    if (!niche?.hashtagBank?.length) return;
    navigator.clipboard.writeText(niche.hashtagBank.join(' '));
    toastSuccess('Copied all hashtags');
  };

  const handleMoveCaption = (fromNicheId, caption, toNicheId) => {
    moveNicheBankEntry(artistId, fromNicheId, toNicheId, caption, 'caption');
  };

  const handleMoveHashtag = (fromNicheId, hashtag, toNicheId) => {
    moveNicheBankEntry(artistId, fromNicheId, toNicheId, hashtag, 'hashtag');
  };

  return (
    <div className="flex flex-1 flex-col items-start self-stretch overflow-y-auto px-8 py-6 gap-8">
      <div className="flex flex-col gap-1">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Captions & Hashtags</span>
        <span className="text-body font-body text-neutral-400">Manage captions and hashtags for each niche</span>
      </div>

      {niches.map(niche => {
        const nicheData = getNiche(niche.id);
        const captions = nicheData?.captionBank || [];
        const hashtags = nicheData?.hashtagBank || [];
        const otherNiches = niches.filter(n => n.id !== niche.id);
        const nicheColor = niche.pipelineColor || getBankColor(niches.indexOf(niche)).primary;

        return (
          <div key={niche.id} className="flex w-full flex-col gap-4 rounded-lg border border-solid border-neutral-800 bg-[#111111] p-5">
            {/* Niche header */}
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full flex-none" style={{ backgroundColor: nicheColor }} />
              <span className="text-body-bold font-body-bold text-[#ffffffff]">{niche.name}</span>
              <Badge variant="neutral">{captions.length + hashtags.length}</Badge>
            </div>

            {/* Captions */}
            <div className="flex w-full flex-col gap-2">
              <div className="flex items-center gap-2">
                <FeatherMessageSquare className="text-neutral-400" style={{ width: 12, height: 12 }} />
                <span className="text-caption-bold font-caption-bold text-neutral-300">Captions</span>
                <Badge variant="neutral">{captions.length}</Badge>
              </div>
              {captions.length > 0 && (
                <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
                  {captions.map((cap, idx) => (
                    <div key={idx} className="flex items-start gap-2 rounded-md bg-black px-2.5 py-1.5 group">
                      <span
                        className="grow text-caption font-caption text-neutral-300 cursor-pointer hover:text-white line-clamp-2"
                        title="Click to copy"
                        onClick={() => { navigator.clipboard.writeText(cap); toastSuccess('Copied'); }}
                      >{cap}</span>
                      <div className="flex items-center gap-1 flex-none opacity-0 group-hover:opacity-100 transition-opacity">
                        {otherNiches.length > 0 && (
                          <select
                            className="bg-neutral-800 text-caption text-neutral-300 border-none rounded px-1 py-0.5 cursor-pointer outline-none"
                            value=""
                            onChange={e => { if (e.target.value) handleMoveCaption(niche.id, cap, e.target.value); }}
                          >
                            <option value="" disabled>Move to...</option>
                            {otherNiches.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                          </select>
                        )}
                        <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0" onClick={() => handleRemoveCaption(niche.id, idx)}>
                          <FeatherTrash2 style={{ width: 12, height: 12 }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex w-full gap-2">
                <textarea
                  className="flex-1 min-h-[32px] max-h-[64px] rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500 resize-none"
                  placeholder="Add caption..."
                  value={newCaptions[niche.id] || ''}
                  onChange={e => setNewCaptions(prev => ({ ...prev, [niche.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddCaption(niche.id); } }}
                  rows={1}
                />
                <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add caption" onClick={() => handleAddCaption(niche.id)} />
              </div>
            </div>

            {/* Hashtags */}
            <div className="flex w-full flex-col gap-2">
              <div className="flex items-center gap-2">
                <FeatherHash className="text-neutral-400" style={{ width: 12, height: 12 }} />
                <span className="text-caption-bold font-caption-bold text-neutral-300">Hashtags</span>
                <Badge variant="neutral">{hashtags.length}</Badge>
                {hashtags.length > 0 && (
                  <button className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-auto" onClick={() => handleCopyAll(niche.id)}>
                    Copy All
                  </button>
                )}
              </div>
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                  {hashtags.map((tag, idx) => (
                    <div key={idx} className="flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-0.5 group">
                      <span className="text-caption font-caption text-indigo-300">{tag}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {otherNiches.length > 0 && (
                          <select
                            className="bg-neutral-800 text-caption text-neutral-300 border-none rounded px-1 py-0.5 cursor-pointer outline-none"
                            value=""
                            onChange={e => { if (e.target.value) handleMoveHashtag(niche.id, tag, e.target.value); }}
                          >
                            <option value="" disabled>Move to...</option>
                            {otherNiches.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                          </select>
                        )}
                        <button className="text-indigo-400 hover:text-red-400 bg-transparent border-none cursor-pointer p-0" onClick={() => handleRemoveHashtag(niche.id, idx)}>
                          <FeatherX style={{ width: 10, height: 10 }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex w-full gap-2">
                <input
                  className="flex-1 rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
                  placeholder="#hashtag"
                  value={newHashtags[niche.id] || ''}
                  onChange={e => setNewHashtags(prev => ({ ...prev, [niche.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddHashtag(niche.id); }}
                />
                <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add hashtag" onClick={() => handleAddHashtag(niche.id)} />
              </div>
            </div>
          </div>
        );
      })}

      {niches.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 w-full text-neutral-500">
          <FeatherHash style={{ width: 32, height: 32 }} />
          <p className="mt-3 text-body font-body">Create niches first to manage captions & hashtags</p>
        </div>
      )}
    </div>
  );
};

export default ProjectWorkspace;
