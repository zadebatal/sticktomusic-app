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
  getUserCollections,
  getCreatedContent,
  deleteCreatedSlideshowAsync,
  softDeleteCreatedVideoAsync,
  getProjectById,
  getProjectNiches,
  createNiche,
  addToProjectPool,
  addToCollection,
  assignToBank,
  migrateCollectionBanks,
  addToCollectionAsync,
  addToLibraryAsync,
  saveCollections,
  saveCollectionToFirestore,
  deleteCollectionAsync,
  markCollectionPendingDeletion,
  isCollectionPendingDeletion,
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
  updateProjectCaptionBank,
  updateProjectHashtagBank,
  getRecentCollectionSnapshots,
  getRecentCollectionRemovals,
} from '../../services/libraryService';
import { uploadFile, uploadFileWithQuota, getMediaDuration } from '../../services/firebaseStorage';
import { convertImageIfNeeded } from '../../utils/imageConverter';
import { convertAudioIfNeeded } from '../../utils/audioConverter';
import { runPool } from '../../utils/uploadPool';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlus, FeatherX, FeatherUploadCloud,
  FeatherArrowLeft, FeatherImage, FeatherMusic, FeatherPlay,
  FeatherCheck, FeatherFilm, FeatherLayers, FeatherCamera,
  FeatherHash, FeatherMessageSquare, FeatherTrash2, FeatherScissors,
} from '@subframe/core';
import { useToast, ConfirmDialog } from '../ui';
import SlideshowNicheContent from './SlideshowNicheContent';
import VideoNicheContent from './VideoNicheContent';
import FinishedMediaNicheContent from './FinishedMediaNicheContent';
import ClipperNicheContent from './ClipperNicheContent';
import AllMediaContent from './AllMediaContent';
import WebImportModal from './WebImportModal';
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
  user = null,
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
  const [activeNicheId, setActiveNicheIdRaw] = useState(initialNicheId);

  // All Media tab
  const [showAllMedia, setShowAllMediaRaw] = useState(false);

  // Show niche format picker
  const [showNichePicker, setShowNichePicker] = useState(false);

  // Caption & Hashtag page
  const [showCaptionPage, setShowCaptionPageRaw] = useState(false);

  // Navigation history stack for in-project back button
  const navHistoryRef = useRef([]);
  const getCurrentNavState = useCallback(() => ({
    nicheId: activeNicheId,
    allMedia: showAllMedia,
    captionPage: showCaptionPage,
  }), [activeNicheId, showAllMedia, showCaptionPage]);

  // Wrapped navigators that push current state onto history before changing
  const navigateTo = useCallback(({ nicheId, allMedia, captionPage }) => {
    navHistoryRef.current.push(getCurrentNavState());
    // Cap stack size to prevent unbounded growth
    if (navHistoryRef.current.length > 50) navHistoryRef.current.shift();
    setActiveNicheIdRaw(nicheId !== undefined ? nicheId : activeNicheId);
    setShowAllMediaRaw(!!allMedia);
    setShowCaptionPageRaw(!!captionPage);
    // Re-read library (for new uploads) but NOT collections (guarded by subscription)
    if (artistId) {
      setLibrary(getLibrary(artistId));
    }
  }, [getCurrentNavState, activeNicheId, artistId]);

  const navigateBack = useCallback(() => {
    // Re-read library (for new uploads) but NOT collections (guarded by subscription)
    if (artistId) {
      setLibrary(getLibrary(artistId));
    }
    // Pop history entries until we find a valid target (or exhaust stack)
    while (navHistoryRef.current.length > 0) {
      const prev = navHistoryRef.current.pop();
      // Validate niche still exists before navigating to it
      if (prev.nicheId) {
        const nicheExists = collections.some(c => c.id === prev.nicheId);
        if (!nicheExists) continue; // skip deleted niche entries
      }
      setActiveNicheIdRaw(prev.nicheId);
      setShowAllMediaRaw(prev.allMedia);
      setShowCaptionPageRaw(prev.captionPage);
      return;
    }
    onBack();
  }, [onBack, collections, artistId]);

  // Convenience setter — re-reads library (for new uploads) but NOT collections
  // (collections are protected by the safeSetCollections guard from the subscription)
  const setActiveNicheId = useCallback((id) => {
    setActiveNicheIdRaw(id);
    if (artistId) {
      setLibrary(getLibrary(artistId));
    }
  }, [artistId]);

  // Import from library modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importAudioOnly, setImportAudioOnly] = useState(false);


  // Bank upload: when user clicks "+" in a bank, we track which bank to assign after upload
  const pendingBankIndexRef = useRef(null);

  // Bank import: when user clicks "Import" in a bank, track which bank to assign after import
  const pendingImportBankRef = useRef(null);

  // Web import modal
  const [showWebImportModal, setShowWebImportModal] = useState(false);
  const pendingWebImportBankRef = useRef(null);

  // Subscribe to data
  useEffect(() => {
    if (!artistId) return;
    setCollections(getCollections(artistId));
    setLibrary(getLibrary(artistId));
    setCreatedContent(getCreatedContent(artistId));

    // Safe setter: merges FOUR sources to prevent data loss from subscription race conditions.
    // Sources: (1) previous React state, (2) new subscription data, (3) current localStorage,
    // (4) recent collection writes (tracked by addToCollection/assignToBank).
    // The subscription handler writes to localStorage BEFORE calling this callback,
    // so localStorage may already be overwritten. Source (4) is the last resort —
    // it captures what addToCollection/assignToBank wrote before the subscription handler
    // could overwrite it.
    const safeSetCollections = (newCols) => {
      setCollections(prev => {
        const prevUser = prev.filter(c => c.type !== 'smart' && !c.id?.startsWith('smart_'));
        const newUser = newCols.filter(c => c.type !== 'smart' && !c.id?.startsWith('smart_'));
        const smart = newCols.filter(c => c.type === 'smart' || c.id?.startsWith('smart_'));
        const currentLocal = getUserCollections(artistId);
        const recentWrites = getRecentCollectionSnapshots();
        const recentRemovals = getRecentCollectionRemovals();

        // Build merged result starting from subscription data
        const result = newUser.map(col => {
          const fromPrev = prevUser.find(p => p.id === col.id);
          const fromLocal = currentLocal.find(l => l.id === col.id);
          const fromRecent = recentWrites.get(col.id);
          const removed = recentRemovals.get(col.id)?.removedIds;
          // Union mediaIds from all four sources
          let allMediaIds = [...new Set([
            ...(col.mediaIds || []),
            ...(fromPrev?.mediaIds || []),
            ...(fromLocal?.mediaIds || []),
            ...(fromRecent?.mediaIds || []),
          ])];
          // Subtract recent intentional removals
          if (removed?.size > 0) {
            allMediaIds = allMediaIds.filter(id => !removed.has(id));
          }
          // Union banks from all four sources
          const maxBankLen = Math.max(
            col.banks?.length || 0,
            fromPrev?.banks?.length || 0,
            fromLocal?.banks?.length || 0,
            fromRecent?.banks?.length || 0
          );
          const mergedBanks = [];
          for (let i = 0; i < maxBankLen; i++) {
            mergedBanks.push([...new Set([
              ...(col.banks?.[i] || []),
              ...(fromPrev?.banks?.[i] || []),
              ...(fromLocal?.banks?.[i] || []),
              ...(fromRecent?.banks?.[i] || []),
            ])]);
          }
          return {
            ...col,
            mediaIds: allMediaIds,
            ...(maxBankLen > 0 ? { banks: mergedBanks } : {}),
          };
        });

        // Filter out any collections pending deletion (race condition guard)
        const filtered = result.filter(c => !isCollectionPendingDeletion(c.id));
        result.length = 0;
        result.push(...filtered);

        // Add collections from prev/localStorage that aren't in subscription data
        const resultIds = new Set(result.map(c => c.id));
        const localIds = new Set(currentLocal.map(c => c.id));
        let needsFix = false;
        for (const p of prevUser) {
          // Only preserve if still in localStorage (deleted collections are removed from localStorage)
          if (!resultIds.has(p.id) && localIds.has(p.id) && !isCollectionPendingDeletion(p.id)) {
            log.warn('[ProjectWorkspace] Preserving collection missing from subscription:', p.name);
            result.push(p);
            resultIds.add(p.id);
            needsFix = true;
          }
        }
        for (const l of currentLocal) {
          if (!resultIds.has(l.id) && !isCollectionPendingDeletion(l.id)) {
            result.push(l);
            resultIds.add(l.id);
            needsFix = true;
          }
        }

        // Log guard results for each niche
        const niches = result.filter(c => c.isPipeline);
        for (const n of niches) {
          const sub = newUser.find(c => c.id === n.id);
          const prev = prevUser.find(c => c.id === n.id);
          const loc = currentLocal.find(c => c.id === n.id);
          const rec = recentWrites.get(n.id);
          if (sub?.mediaIds?.length !== n.mediaIds?.length) {
            log('[safeSetCollections]', n.name, '| sub:', sub?.mediaIds?.length || 0,
              'prev:', prev?.mediaIds?.length || 0, 'local:', loc?.mediaIds?.length || 0,
              'recent:', rec?.mediaIds?.length || '–', '→ result:', n.mediaIds?.length || 0);
          }
        }

        // Check if subscription data was stale — if we added anything, fix localStorage
        const subMediaTotal = newUser.reduce((s, c) => s + (c.mediaIds?.length || 0), 0);
        const resultMediaTotal = result.reduce((s, c) => s + (c.mediaIds?.length || 0), 0);
        if (needsFix || resultMediaTotal > subMediaTotal) {
          saveCollections(artistId, result);
        }

        return [...smart, ...result];
      });
    };

    const unsubs = [];
    if (db) {
      unsubs.push(subscribeToCollections(db, artistId, safeSetCollections));
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

  // Audio always from project pool
  const projectAudio = useMemo(() => projectMedia.filter(m => m.type === 'audio'), [projectMedia]);

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
      const isVideo = rawFile.type?.startsWith('video');
      if (rawFile.type?.startsWith('image')) file = await convertImageIfNeeded(rawFile);
      else if (rawFile.type?.startsWith('audio')) file = await convertAudioIfNeeded(rawFile);

      const isAudio = file.type?.startsWith('audio');
      const folder = isVideo ? 'videos' : isAudio ? 'audio' : 'images';
      const quotaCtx = { userData: user, userEmail: user?.email };
      const { url, path } = await uploadFileWithQuota(file, folder, null, {}, quotaCtx);

      let thumbnailUrl = null;
      if (isVideo) {
        // Generate thumbnail from video first frame
        try {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.muted = true;
          const objUrl = URL.createObjectURL(file);
          video.src = objUrl;
          await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = reject;
          });
          video.currentTime = 0.1;
          await new Promise((resolve) => { video.onseeked = resolve; });
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', THUMB_QUALITY));
          if (blob) {
            const tf = new File([blob], `thumb_${file.name}.jpg`, { type: 'image/jpeg' });
            const tr = await uploadFile(tf, 'thumbnails');
            thumbnailUrl = tr.url;
          }
          URL.revokeObjectURL(objUrl);
        } catch (e) { /* skip video thumb */ }
      } else if (!isAudio) {
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

      // Extract duration for audio/video — try local blob first (no CORS), fall back to remote URL
      let duration = undefined;
      if (isAudio || isVideo) {
        const localBlobUrl = URL.createObjectURL(file);
        try {
          duration = await getMediaDuration(localBlobUrl, isVideo ? 'video' : 'audio');
        } catch (e) { /* try remote */ }
        URL.revokeObjectURL(localBlobUrl);
        if (!duration) {
          try {
            duration = await getMediaDuration(url, isVideo ? 'video' : 'audio');
          } catch (e) { /* duration stays undefined */ }
        }
      }

      // Target collection: active niche (if exists) or project root
      const targetCollectionId = activeNicheId || projectId;

      const mediaType = isVideo ? MEDIA_TYPES.VIDEO : isAudio ? MEDIA_TYPES.AUDIO : MEDIA_TYPES.IMAGE;
      const item = {
        type: mediaType,
        name: file.name,
        url,
        thumbnailUrl,
        thumbVersion: thumbnailUrl ? THUMB_VERSION : undefined,
        storagePath: path,
        collectionIds: [targetCollectionId],
        metadata: { fileSize: file.size, mimeType: file.type },
        ...(duration ? { duration } : {}),
      };

      const savedItem = await addToLibraryAsync(db, artistId, item);
      // Add to target collection
      await addToCollectionAsync(db, artistId, targetCollectionId, savedItem.id);
      // Also add to project pool if uploading in a niche
      if (activeNicheId && activeNicheId !== projectId) {
        addToProjectPool(artistId, projectId, [savedItem.id], db);
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
          imageItems.forEach(item => assignToBank(artistId, activeNicheId, item.id, bankIdx, db));
          pendingBankIndexRef.current = null;
        }
        // Merge localStorage changes into state safely (union, never lose data)
        setCollections(prev => {
          const freshLocal = getCollections(artistId);
          const prevUser = prev.filter(c => c.type !== 'smart' && !c.id?.startsWith('smart_'));
          const localUser = freshLocal.filter(c => c.type !== 'smart' && !c.id?.startsWith('smart_'));
          const smart = freshLocal.filter(c => c.type === 'smart' || c.id?.startsWith('smart_'));
          // Start from localStorage, union mediaIds/banks with prev state
          const merged = localUser.map(col => {
            const p = prevUser.find(pc => pc.id === col.id);
            if (!p) return col;
            return {
              ...col,
              mediaIds: [...new Set([...(col.mediaIds || []), ...(p.mediaIds || [])])],
            };
          });
          // Add any prev collections missing from localStorage
          const mergedIds = new Set(merged.map(c => c.id));
          for (const p of prevUser) {
            if (!mergedIds.has(p.id)) merged.push(p);
          }
          return [...smart, ...merged];
        });
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

  // Web import: open modal targeting a specific bank
  const handleWebImportToBank = useCallback((bankIndex) => {
    pendingWebImportBankRef.current = bankIndex;
    setShowWebImportModal(true);
  }, []);

  // Web import: open modal (no specific bank — for VideoNicheContent)
  const handleWebImport = useCallback(() => {
    pendingWebImportBankRef.current = null;
    setShowWebImportModal(true);
  }, []);

  // Web import complete — files are already in Firebase Storage (uploaded by Railway backend)
  const handleWebImportComplete = useCallback(async (files, bankIndex) => {
    if (!files?.length || !activeNicheId) {
      setShowWebImportModal(false);
      return;
    }

    try {
      const importedIds = [];
      for (const file of files) {
        // Create library item
        const item = {
          id: `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          url: file.url,
          storagePath: file.storagePath,
          type: file.type || 'image',
          size: file.size,
          source: 'web-import',
          createdAt: new Date().toISOString(),
        };

        await addToLibraryAsync(db, artistId, item);
        await addToCollectionAsync(db, artistId, activeNicheId, item.id);
        importedIds.push(item.id);

        // Assign to bank if specified
        const targetBank = bankIndex ?? pendingWebImportBankRef.current;
        if (targetBank !== null && targetBank !== undefined) {
          assignToBank(artistId, activeNicheId, [item.id], targetBank, db);
        }
      }

      // Add to project pool
      if (projectId) {
        addToProjectPool(artistId, projectId, importedIds, db);
      }

      // Refresh data
      setLibrary(getLibrary(artistId));
      setCollections(getCollections(artistId));

      toastSuccess(`Imported ${files.length} file${files.length !== 1 ? 's' : ''} from web`);
    } catch (err) {
      log.error('Web import complete error:', err);
      toastError('Failed to add imported media to library');
    }

    setShowWebImportModal(false);
    pendingWebImportBankRef.current = null;
  }, [activeNicheId, artistId, projectId, db, toastSuccess, toastError]);

  // Import audio only — opens import modal filtered to audio
  const handleImportAudio = useCallback(() => {
    pendingImportBankRef.current = null;
    setImportAudioOnly(true);
    setShowImportModal(true);
  }, []);

  // Create niche
  const handleCreateNiche = useCallback(async (format) => {
    try {
      const niche = createNiche(artistId, { projectId, format }, db);
      navigateTo({ nicheId: niche.id });
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
      // Mark as pending deletion BEFORE async ops (prevents subscription race condition)
      markCollectionPendingDeletion(nicheId);

      // Immediately remove from local UI state
      setCollections(prev => prev.filter(c => c.id !== nicheId));
      if (activeNicheId === nicheId) {
        const remaining = niches.filter(n => n.id !== nicheId);
        setActiveNicheId(remaining.length > 0 ? remaining[0].id : null);
      }

      // Cascade-delete drafts belonging to this niche
      const content = getCreatedContent(artistId);
      const nicheDrafts = [...(content.slideshows || []), ...(content.videos || [])].filter(d => d.collectionId === nicheId);
      for (const draft of nicheDrafts) {
        if (draft.slides) {
          deleteCreatedSlideshowAsync(db, artistId, draft.id).catch(log.error);
        } else {
          softDeleteCreatedVideoAsync(db, artistId, draft.id).catch(log.error);
        }
      }
      await deleteCollectionAsync(db, artistId, nicheId);
      toastSuccess(`"${niche.name}" deleted`);
    } catch (err) {
      toastError('Failed to delete niche');
    }
  }, [collections, db, artistId, activeNicheId, niches, toastSuccess, toastError]);

  // Import from library
  const availableLibraryMedia = useMemo(() => {
    if (!project) return [];
    const poolIds = new Set(project.mediaIds || []);
    return library.filter(item => !poolIds.has(item.id));
  }, [library, project]);

  // Pull from project: media in project pool (or other niches) not in active niche
  const availableProjectMedia = useMemo(() => {
    if (!project || !activeNicheId) return [];
    const nicheIds = new Set(activeNiche?.mediaIds || []);
    // Include all project pool media + media from other niches in this project
    const allProjectIds = new Set(project.mediaIds || []);
    niches.forEach(n => {
      if (n.id !== activeNicheId) {
        (n.mediaIds || []).forEach(id => allProjectIds.add(id));
      }
    });
    return library.filter(item => allProjectIds.has(item.id) && !nicheIds.has(item.id));
  }, [library, project, activeNicheId, activeNiche, niches]);

  // Media from OTHER projects (roots + their niches), excluding items already in current project or active niche
  const availableOtherProjectMedia = useMemo(() => {
    if (!project) return [];
    const allOtherProjects = collections.filter(c => c.isProjectRoot && c.id !== projectId);
    if (allOtherProjects.length === 0) return [];
    const nicheIds = new Set(activeNiche?.mediaIds || []);
    const poolIds = new Set(project.mediaIds || []);
    const otherIds = new Set();
    allOtherProjects.forEach(proj => {
      (proj.mediaIds || []).forEach(id => otherIds.add(id));
      collections.filter(c => c.projectId === proj.id && c.isPipeline)
        .forEach(n => (n.mediaIds || []).forEach(id => otherIds.add(id)));
    });
    return library.filter(item => otherIds.has(item.id) && !nicheIds.has(item.id) && !poolIds.has(item.id));
  }, [collections, projectId, library, activeNiche, project]);

  const handleImportFromLibrary = useCallback((selectedIds) => {
    if (!selectedIds.length || !project) return;
    addToProjectPool(artistId, projectId, selectedIds, db);
    if (activeNicheId) {
      // Also add to niche
      addToCollection(artistId, activeNicheId, selectedIds, db);
    }
    // If triggered from a bank "Import", assign imported images to that bank
    const bankIdx = pendingImportBankRef.current;
    if (bankIdx != null && activeNicheId) {
      const imageIds = selectedIds.filter(id => {
        const item = library.find(m => m.id === id);
        return item && item.type !== MEDIA_TYPES.AUDIO;
      });
      imageIds.forEach(id => assignToBank(artistId, activeNicheId, id, bankIdx, db));
      pendingImportBankRef.current = null;
    }
    setShowImportModal(false);
    toastSuccess(`Imported ${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''}`);
  }, [project, artistId, projectId, activeNicheId, db, library, toastSuccess]);

  // Pull from project pool → add to active niche (+ project pool if not already there)
  const handlePullFromProject = useCallback((selectedIds) => {
    if (!selectedIds.length || !activeNicheId) return;
    const cols = getCollections(artistId);
    const nicheIdx = cols.findIndex(c => c.id === activeNicheId);
    if (nicheIdx === -1) return;
    const existing = new Set(cols[nicheIdx].mediaIds || []);
    const newIds = selectedIds.filter(id => !existing.has(id));
    if (newIds.length === 0) { setShowImportModal(false); return; }
    cols[nicheIdx] = { ...cols[nicheIdx], mediaIds: [...(cols[nicheIdx].mediaIds || []), ...newIds], updatedAt: new Date().toISOString() };
    // Also ensure items are in the project pool
    const poolIds = new Set(project?.mediaIds || []);
    const missingFromPool = newIds.filter(id => !poolIds.has(id));
    if (missingFromPool.length > 0) {
      addToProjectPool(artistId, projectId, missingFromPool, db);
    }
    saveCollections(artistId, cols);
    if (db) saveCollectionToFirestore(db, artistId, cols[nicheIdx]);
    setShowImportModal(false);
    toastSuccess(`Pulled ${newIds.length} item${newIds.length !== 1 ? 's' : ''} into niche`);
  }, [artistId, activeNicheId, projectId, project, db, toastSuccess]);

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
          <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherArrowLeft />} aria-label="Back" onClick={navigateBack} />
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
          const isActive = niche.id === activeNicheId && !showAllMedia && !showCaptionPage;
          const fmt = niche.formats?.[0];
          const draftCount = nicheDraftCounts[niche.id] || 0;
          return (
            <div
              key={niche.id}
              className={`group flex items-center gap-2 px-4 py-3 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                isActive ? 'border-[#6366f1ff] text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
              onClick={() => navigateTo({ nicheId: niche.id })}
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
        <div className="flex-1 min-w-0" />
        <button
          className={`flex items-center gap-1.5 px-4 py-3 border-b-2 cursor-pointer transition-colors whitespace-nowrap flex-shrink-0 bg-transparent ${
            showAllMedia ? 'border-[#6366f1ff] text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
          onClick={() => {
            if (showAllMedia) {
              navigateBack();
            } else {
              navHistoryRef.current.push({ nicheId: activeNicheId, allMedia: false, captionPage: showCaptionPage });
              setShowAllMediaRaw(true);
              setShowCaptionPageRaw(false);
            }
          }}
        >
          <FeatherImage style={{ width: 14, height: 14 }} />
          <span className="text-caption-bold font-caption-bold">All Media</span>
        </button>
        <button
          className={`flex items-center gap-1.5 px-4 py-3 border-b-2 cursor-pointer transition-colors whitespace-nowrap flex-shrink-0 bg-transparent ${
            showCaptionPage ? 'border-[#6366f1ff] text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
          onClick={() => { if (showCaptionPage) { navigateBack(); } else { navigateTo({ nicheId: activeNicheId, captionPage: true }); } }}
        >
          <FeatherHash style={{ width: 14, height: 14 }} />
          <span className="text-caption-bold font-caption-bold">Captions & Hashtags</span>
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={setFileInputRef} type="file" multiple accept="image/*,audio/*,video/*"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
      />

      {/* Main content area — full width, no sidebar */}
      <div className="flex items-start overflow-hidden flex-1 self-stretch">
        {/* All Media tab */}
        {showAllMedia && (
          <AllMediaContent
            projectMedia={projectMedia}
            library={library}
            activeNicheId={activeNicheId}
            activeNiche={activeNiche}
            onUpload={() => { pendingBankIndexRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'image/*,audio/*,video/*'; fileInputRef.current.click(); } }}
            onImport={() => { pendingImportBankRef.current = null; setShowImportModal(true); }}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
          />
        )}

        {/* Caption page */}
        {!showAllMedia && showCaptionPage && (
          <ProjectCaptionPage
            db={db}
            artistId={artistId}
            projectId={projectId}
            project={project}
          />
        )}

        {!showAllMedia && !showCaptionPage && activeNiche && activeFormat?.type === 'slideshow' && (
          <SlideshowNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            library={library}
            createdContent={createdContent}
            projectAudio={projectAudio}
            projectMedia={projectMedia}
            draggingMediaIds={[]}
            onOpenEditor={onOpenEditor}
            onViewDrafts={onViewDrafts}

            onUploadToBank={handleUploadToBank}
            onImportToBank={handleImportToBank}
            onWebImportToBank={handleWebImportToBank}
            onUploadAudio={() => { pendingBankIndexRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'audio/*'; fileInputRef.current.click(); } }}
            onImportAudio={handleImportAudio}
          />
        )}

        {!showAllMedia && !showCaptionPage && activeNiche && activeFormat?.id === 'clipper' && (
          <ClipperNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            library={library}
            projectMedia={projectMedia}
            onMakeVideo={(format, nicheId, existingDraft, templateSettings, nicheSourceVideos) => {
              onOpenVideoEditor?.(format, nicheId, existingDraft, templateSettings, nicheSourceVideos);
            }}
            onUpload={() => { pendingBankIndexRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'video/*'; fileInputRef.current.click(); } }}
            onImport={() => { pendingImportBankRef.current = null; setShowImportModal(true); }}
          />
        )}

        {!showAllMedia && !showCaptionPage && activeNiche && activeFormat?.type === 'video' && activeFormat?.id !== 'finished_media' && activeFormat?.id !== 'clipper' && (
          <VideoNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            library={library}
            createdContent={createdContent}
            projectAudio={projectAudio}
            onMakeVideo={(format, nicheId, existingDraft, templateSettings) => {
              onOpenVideoEditor?.(format, nicheId, existingDraft, templateSettings);
            }}
            onUpload={() => { pendingBankIndexRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'image/*,audio/*,video/*'; fileInputRef.current.click(); } }}
            onUploadAudio={() => { pendingBankIndexRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'audio/*'; fileInputRef.current.click(); } }}
            onImport={() => { pendingImportBankRef.current = null; setShowImportModal(true); }}
            onImportAudio={handleImportAudio}
            onWebImport={handleWebImport}
          />
        )}

        {!showAllMedia && !showCaptionPage && activeNiche && activeFormat?.id === 'finished_media' && (
          <FinishedMediaNicheContent
            db={db}
            user={user}
            artistId={artistId}
            niche={activeNiche}
            projectAudio={projectAudio}

          />
        )}

        {/* No niches — format picker */}
        {!showAllMedia && !showCaptionPage && niches.length === 0 && !showNichePicker && (
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

      {/* Import Modal — Library + Project tabs */}
      {showImportModal && (() => {
        const closeImport = () => { setShowImportModal(false); setImportAudioOnly(false); };
        const filterAudio = (items) => importAudioOnly ? items.filter(i => i.type === 'audio') : items;
        return (
          <ImportFromLibraryModal
            onClose={closeImport}
            title={importAudioOnly ? 'Import Audio' : 'Import Media'}
            sources={[
              { label: 'Library', items: filterAudio(availableLibraryMedia), onImport: (ids) => { handleImportFromLibrary(ids); setImportAudioOnly(false); } },
              ...(filterAudio(availableProjectMedia).length > 0
                ? [{ label: 'This Project', items: filterAudio(availableProjectMedia), onImport: (ids) => { handlePullFromProject(ids); setImportAudioOnly(false); } }]
                : []),
              ...(filterAudio(availableOtherProjectMedia).length > 0
                ? [{ label: 'Other Projects', items: filterAudio(availableOtherProjectMedia), onImport: (ids) => { handleImportFromLibrary(ids); setImportAudioOnly(false); } }]
                : []),
            ]}
            allCollections={collections}
            activeNicheId={activeNicheId}
          />
        );
      })()}

      {/* Web Import Modal */}
      {showWebImportModal && (
        <WebImportModal
          onClose={() => { setShowWebImportModal(false); pendingWebImportBankRef.current = null; }}
          onComplete={handleWebImportComplete}
          defaultBankIndex={pendingWebImportBankRef.current ?? 0}
          bankCount={activeNiche?.banks?.length || 1}
          artistId={artistId}
        />
      )}

      {/* Upload progress banner */}
      {isUploading && uploadProgress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-neutral-700 bg-[#111111] px-5 py-3 shadow-2xl">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent flex-none" />
          <div className="flex flex-col gap-0.5">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">
              Uploading {uploadProgress.current} of {uploadProgress.total}
            </span>
            <div className="w-48 h-1.5 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Reused ImportFromLibraryModal with rubber-band drag selection + optional source tabs
// sources = [{ label, items, onImport }] — when provided, shows tabs to switch between sources
const ImportFromLibraryModal = ({ items: defaultItems, onImport: defaultOnImport, onClose, title = 'Import from Library', subtitle, sources, allCollections = [], activeNicheId }) => {
  const [activeSourceIdx, setActiveSourceIdx] = useState(0);
  const [nicheFilter, setNicheFilter] = useState(null);
  const resolvedSources = sources || [{ label: 'Library', items: defaultItems, onImport: defaultOnImport }];
  const activeSource = resolvedSources[activeSourceIdx] || resolvedSources[0];

  // All niches except the active one — always show all so user can filter across tabs
  const filterableNiches = useMemo(() => {
    return allCollections
      .filter(c => c.isPipeline && c.id !== activeNicheId && (c.mediaIds || []).length > 0)
      .map(c => ({ id: c.id, name: c.name }));
  }, [allCollections, activeNicheId]);

  // Filter items by niche if a niche filter is selected
  const items = useMemo(() => {
    const sourceItems = activeSource.items;
    if (!nicheFilter) return sourceItems;
    const niche = allCollections.find(c => c.id === nicheFilter);
    if (!niche) return sourceItems;
    const nicheMediaIds = new Set(niche.mediaIds || []);
    return sourceItems.filter(item => nicheMediaIds.has(item.id));
  }, [activeSource.items, nicheFilter, allCollections]);

  // Count of niche-filtered items per source (for showing match counts on pills)
  const nicheFilterCount = useMemo(() => {
    if (!nicheFilter) return null;
    const niche = allCollections.find(c => c.id === nicheFilter);
    if (!niche) return null;
    const nicheMediaIds = new Set(niche.mediaIds || []);
    return resolvedSources.reduce((acc, src, idx) => {
      acc[idx] = src.items.filter(item => nicheMediaIds.has(item.id)).length;
      return acc;
    }, {});
  }, [nicheFilter, allCollections, resolvedSources]);

  const onImport = activeSource.onImport;

  const [selected, setSelected] = useState(new Set());
  const gridRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [rubberBand, setRubberBand] = useState(null);

  // Clear selection and niche filter when switching sources
  const handleSwitchSource = (idx) => {
    setActiveSourceIdx(idx);
    setSelected(new Set());
    setNicheFilter(null);
  };

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
  const videos = useMemo(() => items.filter(i => i.type === 'video'), [items]);
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
        <div className="flex flex-col border-b border-neutral-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col gap-1">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{title}</span>
              <span className="text-caption font-caption text-neutral-400">{subtitle || `${items.length} item${items.length !== 1 ? 's' : ''} available`}</span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="neutral-tertiary" size="small" onClick={selectAll}>
                {selected.size === items.length ? 'Deselect All' : 'Select All'}
              </Button>
              <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} aria-label="Close" onClick={onClose} />
            </div>
          </div>
          {resolvedSources.length > 1 && (
            <div className="flex items-center gap-0 px-6">
              {resolvedSources.map((src, idx) => (
                <button
                  key={idx}
                  className={`px-4 py-2 text-caption-bold font-caption-bold border-b-2 transition-colors cursor-pointer bg-transparent ${
                    idx === activeSourceIdx
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-neutral-400 hover:text-neutral-200'
                  }`}
                  onClick={() => handleSwitchSource(idx)}
                >
                  {src.label} ({nicheFilterCount ? nicheFilterCount[idx] : src.items.length})
                </button>
              ))}
            </div>
          )}
          {/* Niche filter */}
          {filterableNiches.length > 0 && (
            <div className="flex items-center gap-2 px-6 py-2 border-t border-neutral-800/50">
              <span className="text-caption font-caption text-neutral-500">Filter:</span>
              <button
                className={`px-2.5 py-1 rounded-full text-caption font-caption transition-colors cursor-pointer border ${
                  !nicheFilter ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-transparent border-neutral-700 text-neutral-400 hover:text-neutral-200'
                }`}
                onClick={() => { setNicheFilter(null); setSelected(new Set()); }}
              >
                All
              </button>
              {filterableNiches.map(n => (
                <button
                  key={n.id}
                  className={`px-2.5 py-1 rounded-full text-caption font-caption transition-colors cursor-pointer border ${
                    nicheFilter === n.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-transparent border-neutral-700 text-neutral-400 hover:text-neutral-200'
                  }`}
                  onClick={() => { setNicheFilter(n.id); setSelected(new Set()); }}
                >
                  {n.name}
                </button>
              ))}
            </div>
          )}
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
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-6">
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
              {videos.length > 0 && (
                <>
                  <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Videos ({videos.length})</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-6">
                    {videos.map(item => (
                      <div key={item.id}
                        data-media-id={item.id}
                        className={`relative aspect-video rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                          selected.has(item.id) ? 'border-indigo-500' : 'border-transparent hover:border-neutral-600'
                        }`}
                        onClick={() => { if (!isDragging) toggle(item.id); }}
                      >
                        {item.thumbnailUrl ? (
                          <img src={item.thumbnailUrl} alt={item.name} className="h-full w-full object-cover" loading="lazy" draggable={false} />
                        ) : (
                          <div className="h-full w-full bg-neutral-800 flex items-center justify-center">
                            <FeatherFilm className="text-neutral-500" style={{ width: 24, height: 24 }} />
                          </div>
                        )}
                        <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5">
                          <FeatherPlay className="text-white" style={{ width: 10, height: 10 }} />
                          {item.duration && (
                            <span className="text-[10px] text-white">{Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')}</span>
                          )}
                        </div>
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
// ProjectCaptionPage — Project-level Captions & Hashtags
// ═══════════════════════════════════════════════════
const ProjectCaptionPage = ({ db, artistId, projectId, project }) => {
  const { success: toastSuccess } = useToast();
  const [newCaption, setNewCaption] = useState('');
  const [newHashtag, setNewHashtag] = useState('');

  // Read from project root
  const captions = useMemo(() => {
    if (!project) return [];
    return Array.isArray(project.captionBank)
      ? project.captionBank
      : [...(project.captionBank?.always || []), ...(project.captionBank?.pool || [])];
  }, [project]);

  const hashtags = useMemo(() => {
    if (!project) return [];
    return Array.isArray(project.hashtagBank)
      ? project.hashtagBank
      : [...(project.hashtagBank?.always || []), ...(project.hashtagBank?.pool || [])];
  }, [project]);

  const handleAddCaption = useCallback(() => {
    const text = newCaption.trim();
    if (!text || !projectId) return;
    updateProjectCaptionBank(artistId, projectId, [...captions, text], db);
    setNewCaption('');
  }, [db, artistId, projectId, captions, newCaption]);

  const handleRemoveCaption = useCallback((idx) => {
    const updated = [...captions];
    updated.splice(idx, 1);
    updateProjectCaptionBank(artistId, projectId, updated, db);
  }, [db, artistId, projectId, captions]);

  const handleAddHashtag = useCallback(() => {
    const raw = newHashtag.trim();
    if (!raw || !projectId) return;
    const tag = raw.startsWith('#') ? raw : `#${raw}`;
    if (hashtags.includes(tag)) return;
    updateProjectHashtagBank(artistId, projectId, [...hashtags, tag], db);
    setNewHashtag('');
  }, [db, artistId, projectId, hashtags, newHashtag]);

  const handleRemoveHashtag = useCallback((idx) => {
    const updated = [...hashtags];
    updated.splice(idx, 1);
    updateProjectHashtagBank(artistId, projectId, updated, db);
  }, [db, artistId, projectId, hashtags]);

  const handleCopyAll = useCallback(() => {
    if (hashtags.length === 0) return;
    navigator.clipboard.writeText(hashtags.join(' '));
    toastSuccess('Copied all hashtags');
  }, [hashtags, toastSuccess]);

  if (!project) return null;

  return (
    <div className="flex flex-1 flex-col items-start self-stretch overflow-y-auto px-8 py-6 gap-8">
      <div className="flex flex-col gap-1">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Captions & Hashtags</span>
        <span className="text-body font-body text-neutral-400">
          Shared across all niches in this project
        </span>
      </div>

      {/* Captions */}
      <div className="flex w-full flex-col gap-3 rounded-lg border border-solid border-neutral-800 bg-[#111111] p-5">
        <div className="flex items-center gap-2">
          <FeatherMessageSquare className="text-neutral-400" style={{ width: 14, height: 14 }} />
          <span className="text-body-bold font-body-bold text-[#ffffffff]">Captions</span>
          <Badge variant="neutral">{captions.length}</Badge>
        </div>
        {captions.length > 0 && (
          <div className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto">
            {captions.map((cap, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-md bg-black px-2.5 py-1.5 group">
                <span
                  className="grow text-caption font-caption text-neutral-300 cursor-pointer hover:text-white line-clamp-3"
                  title="Click to copy"
                  onClick={() => { navigator.clipboard.writeText(cap); toastSuccess('Copied'); }}
                >{cap}</span>
                <button
                  className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 flex-none opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemoveCaption(idx)}
                >
                  <FeatherTrash2 style={{ width: 12, height: 12 }} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex w-full gap-2">
          <textarea
            className="flex-1 min-h-[32px] max-h-[80px] rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500 resize-none"
            placeholder="Add caption..."
            value={newCaption}
            onChange={e => setNewCaption(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddCaption(); } }}
            rows={1}
          />
          <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add caption" onClick={handleAddCaption} />
        </div>
      </div>

      {/* Hashtags */}
      <div className="flex w-full flex-col gap-3 rounded-lg border border-solid border-neutral-800 bg-[#111111] p-5">
        <div className="flex items-center gap-2">
          <FeatherHash className="text-neutral-400" style={{ width: 14, height: 14 }} />
          <span className="text-body-bold font-body-bold text-[#ffffffff]">Hashtags</span>
          <Badge variant="neutral">{hashtags.length}</Badge>
          {hashtags.length > 0 && (
            <button className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-auto" onClick={handleCopyAll}>
              Copy All
            </button>
          )}
        </div>
        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-h-[200px] overflow-y-auto">
            {hashtags.map((tag, idx) => (
              <div key={idx} className="flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-0.5 group">
                <span className="text-caption font-caption text-indigo-300">{tag}</span>
                <button
                  className="text-indigo-400 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemoveHashtag(idx)}
                >
                  <FeatherX style={{ width: 10, height: 10 }} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex w-full gap-2">
          <input
            className="flex-1 rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
            placeholder="#hashtag"
            value={newHashtag}
            onChange={e => setNewHashtag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddHashtag(); }}
          />
          <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add hashtag" onClick={handleAddHashtag} />
        </div>
      </div>

      {captions.length === 0 && hashtags.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 w-full text-neutral-500">
          <FeatherMessageSquare style={{ width: 28, height: 28 }} />
          <p className="mt-3 text-body font-body">Add your first caption or hashtag above</p>
        </div>
      )}
    </div>
  );
};

export default ProjectWorkspace;
