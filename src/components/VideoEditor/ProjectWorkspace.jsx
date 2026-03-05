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
  updateProjectCaptionBank,
  updateProjectHashtagBank,
  updateNicheCaptionBank,
  updateNicheHashtagBank,
  updateCollectionPlatformHashtags,
  updateCollectionPlatformExcludes,
  getCollectionCaptionBank,
  getCollectionHashtagBank,
  getRecentCollectionSnapshots,
  getRecentCollectionRemovals,
  removeFromProjectPool,
  assignToMediaBank,
} from '../../services/libraryService';
import { migrateThumbnails, THUMB_MAX_SIZE, THUMB_QUALITY, THUMB_VERSION } from '../../services/thumbnailService';
import { uploadFile, uploadFileWithQuota, getMediaDuration } from '../../services/firebaseStorage';
import { convertImageIfNeeded } from '../../utils/imageConverter';
import { convertAudioIfNeeded } from '../../utils/audioConverter';
import { runPool } from '../../utils/uploadPool';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlus, FeatherX, FeatherUploadCloud, FeatherSearch,
  FeatherArrowLeft, FeatherImage, FeatherMusic, FeatherPlay,
  FeatherCheck, FeatherFilm, FeatherLayers, FeatherCamera,
  FeatherHash, FeatherMessageSquare, FeatherTrash2, FeatherScissors,
  FeatherZap,
} from '@subframe/core';
import { useToast } from '../ui';
import SlideshowNicheContent from './SlideshowNicheContent';
import VideoNicheContent from './VideoNicheContent';
import FinishedMediaNicheContent from './FinishedMediaNicheContent';
import ClipperNicheContent from './ClipperNicheContent';
import AllMediaContent from './AllMediaContent';
import WebImportModal from './WebImportModal';
import { generateCaptions } from '../../services/captionGeneratorService';
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
  onAddLyrics,
  onUpdateLyrics,
  onDeleteLyrics,
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

  // Create count for the centered Create bar
  const [createCount, setCreateCount] = useState(1);

  // Selected media bank IDs for video niche editor filtering
  const [selectedMediaBankIds, setSelectedMediaBankIds] = useState(null);

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

  // Named media bank upload/import targeting
  const pendingMediaBankIdRef = useRef(null);

  // Audio web import modal
  const [showAudioWebImport, setShowAudioWebImport] = useState(false);

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
          // Preserve mediaBanks from localStorage (most recent local source)
          // Also apply recent removals to mediaBanks
          // Deserialize if stored as JSON string (from Firestore serialization)
          let mergedMediaBanks = fromLocal?.mediaBanks || col.mediaBanks || null;
          if (typeof mergedMediaBanks === 'string') {
            try { mergedMediaBanks = JSON.parse(mergedMediaBanks); } catch { mergedMediaBanks = null; }
          }
          if (!Array.isArray(mergedMediaBanks)) mergedMediaBanks = null;
          if (mergedMediaBanks && removed?.size > 0) {
            mergedMediaBanks = mergedMediaBanks.map(b => ({
              ...b,
              mediaIds: (b.mediaIds || []).filter(id => !removed.has(id)),
            }));
          }
          return {
            ...col,
            mediaIds: allMediaIds,
            ...(maxBankLen > 0 ? { banks: mergedBanks } : {}),
            ...(mergedMediaBanks ? { mediaBanks: mergedMediaBanks } : {}),
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

  // Byte-level upload progress tracking
  const byteProgressRef = useRef({ files: {}, totalBytes: 0 });
  const progressRafRef = useRef(null);

  const handleUpload = async (files) => {
    if (!files?.length) { toastError('No files selected'); return; }
    if (!artistId || !project) { toastError('No project selected'); return; }
    setIsUploading(true);
    // Initialize byte-level progress
    const totalBytes = Array.from(files).reduce((sum, f) => sum + (f.size || 0), 0);
    byteProgressRef.current = { files: {}, totalBytes: totalBytes || 1 };
    setUploadProgress({ current: 0, total: files.length, bytes: 0, totalBytes });

    // rAF loop to smoothly update progress bar from byte-level data
    const updateProgress = () => {
      const bp = byteProgressRef.current;
      const transferred = Object.values(bp.files).reduce((s, v) => s + v, 0);
      setUploadProgress(prev => prev ? { ...prev, bytes: transferred } : prev);
      progressRafRef.current = requestAnimationFrame(updateProgress);
    };
    progressRafRef.current = requestAnimationFrame(updateProgress);

    const processOne = async (rawFile) => {
      const fileKey = `${rawFile.name}_${rawFile.size}_${rawFile.lastModified}`;
      let file = rawFile;
      const isVideo = rawFile.type?.startsWith('video');
      if (rawFile.type?.startsWith('image')) file = await convertImageIfNeeded(rawFile);
      else if (rawFile.type?.startsWith('audio')) file = await convertAudioIfNeeded(rawFile);

      const isAudio = file.type?.startsWith('audio');
      const folder = isVideo ? 'videos' : isAudio ? 'audio' : 'images';
      const quotaCtx = { userData: user, userEmail: user?.email };

      // Per-file byte-level progress callback
      const onFileProgress = (pct) => {
        byteProgressRef.current.files[fileKey] = Math.round((pct / 100) * rawFile.size);
      };

      // Run upload + thumbnail + duration in parallel
      const thumbPromise = (async () => {
        if (isVideo) {
          try {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            const objUrl = URL.createObjectURL(file);
            video.src = objUrl;
            await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
            video.currentTime = 0.1;
            await new Promise((resolve) => { video.onseeked = resolve; });
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', THUMB_QUALITY));
            URL.revokeObjectURL(objUrl);
            if (blob) {
              const tf = new File([blob], `thumb_${file.name}.jpg`, { type: 'image/jpeg' });
              const tr = await uploadFile(tf, 'thumbnails');
              return tr.url;
            }
          } catch (e) { /* skip video thumb */ }
        } else if (!isAudio) {
          try {
            const objUrl = URL.createObjectURL(file);
            const img = new Image();
            img.src = objUrl;
            await new Promise(r => { img.onload = r; });
            const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', THUMB_QUALITY));
            URL.revokeObjectURL(objUrl);
            if (blob) {
              const tf = new File([blob], `thumb_${file.name}`, { type: 'image/jpeg' });
              const tr = await uploadFile(tf, 'thumbnails');
              return tr.url;
            }
          } catch (e) { /* skip thumb */ }
        }
        return null;
      })();

      const durationPromise = (async () => {
        if (!isAudio && !isVideo) return undefined;
        const localBlobUrl = URL.createObjectURL(file);
        try {
          const dur = await getMediaDuration(localBlobUrl, isVideo ? 'video' : 'audio');
          URL.revokeObjectURL(localBlobUrl);
          return dur || undefined;
        } catch (e) {
          URL.revokeObjectURL(localBlobUrl);
          return undefined;
        }
      })();

      // Upload + thumbnail + duration all in parallel
      const [uploadResult, thumbnailUrl, duration] = await Promise.all([
        uploadFileWithQuota(file, folder, onFileProgress, {}, quotaCtx),
        thumbPromise,
        durationPromise,
      ]);
      const { url, path } = uploadResult;

      // If duration still unknown, try from remote URL
      let finalDuration = duration;
      if (finalDuration === undefined && (isAudio || isVideo)) {
        try { finalDuration = await getMediaDuration(url, isVideo ? 'video' : 'audio'); } catch (e) { /* skip */ }
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
        ...(finalDuration ? { duration: finalDuration } : {}),
      };

      const savedItem = await addToLibraryAsync(db, artistId, item);
      // Add to target collection
      await addToCollectionAsync(db, artistId, targetCollectionId, savedItem.id);
      // Also add to project pool if uploading in a niche
      if (activeNicheId && activeNicheId !== projectId) {
        addToProjectPool(artistId, projectId, [savedItem.id], db);
      }
      // Mark file as fully uploaded for byte progress
      byteProgressRef.current.files[fileKey] = rawFile.size;
      return savedItem;
    };

    try {
      const { results, errors } = await runPool(Array.from(files), processOne, {
        concurrency: 5,
        onProgress: (done, total) => setUploadProgress(prev => prev ? { ...prev, current: done, total } : { current: done, total }),
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
        // If triggered from a named media bank, assign to that bank
        const mediaBankId = pendingMediaBankIdRef.current;
        if (mediaBankId && activeNicheId) {
          const mediaItems = uploadedItems.filter(i => i.type !== MEDIA_TYPES.AUDIO);
          if (mediaItems.length > 0) {
            assignToMediaBank(artistId, activeNicheId, mediaItems.map(i => i.id), mediaBankId, db);
          }
          pendingMediaBankIdRef.current = null;
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
        if (errors.length > 0) {
          toastError(`${errors.length} file(s) failed to upload`);
        }
      } else if (errors.length > 0) {
        toastError(`Upload failed: ${errors[0].error?.message || 'unknown error'}`);
      }
    } catch (err) {
      toastError(`Upload error: ${err.message}`);
    }
    // Stop byte-level progress rAF loop
    if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
    byteProgressRef.current = { files: {}, totalBytes: 0 };
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
          thumbnailUrl: file.thumbnailUrl || (file.type === 'image' ? file.url : null),
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
        // Assign to named media bank if specified
        const mediaBankId = pendingMediaBankIdRef.current;
        if (mediaBankId) {
          assignToMediaBank(artistId, activeNicheId, [item.id], mediaBankId, db);
        }
      }

      // Add to project pool
      if (projectId) {
        addToProjectPool(artistId, projectId, importedIds, db);
      }

      // Clear media bank ref
      pendingMediaBankIdRef.current = null;

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

  // Web import audio — opens WebImportModal in audioOnly mode
  const handleWebImportAudio = useCallback(() => {
    setShowAudioWebImport(true);
  }, []);

  const handleWebImportAudioComplete = useCallback(async (files) => {
    if (!files?.length) {
      setShowAudioWebImport(false);
      return;
    }

    try {
      const importedIds = [];
      for (const file of files) {
        // Fetch duration from the uploaded audio URL (required by addToLibraryAsync)
        let duration = 0;
        try {
          duration = await getMediaDuration(file.url, 'audio');
        } catch (e) {
          log.warn('Could not get audio duration, using fallback:', e);
        }

        const item = {
          id: `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          url: file.url,
          storagePath: file.storagePath,
          type: 'audio',
          size: file.size,
          duration: duration || 60, // Fallback to 60s if duration fetch fails
          source: 'web-import',
          createdAt: new Date().toISOString(),
        };

        await addToLibraryAsync(db, artistId, item);
        importedIds.push(item.id);
      }

      // Add to project pool (audio goes to pool, not banks)
      if (projectId) {
        addToProjectPool(artistId, projectId, importedIds, db);
      }

      // Refresh data
      setLibrary(getLibrary(artistId));

      toastSuccess(`Imported ${files.length} audio file${files.length !== 1 ? 's' : ''} from web`);
    } catch (err) {
      log.error('Web audio import complete error:', err);
      toastError('Failed to add imported audio to library');
    }

    setShowAudioWebImport(false);
  }, [artistId, projectId, db, toastSuccess, toastError]);

  // Named media bank upload/import handlers (for VideoNicheContent)
  const handleUploadToMediaBank = useCallback((bankId) => {
    pendingMediaBankIdRef.current = bankId;
    pendingBankIndexRef.current = null; // Clear slideshow bank ref
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.accept = 'image/*,video/*';
      fileInputRef.current.click();
    }
  }, []);

  const handleImportToMediaBank = useCallback((bankId) => {
    pendingMediaBankIdRef.current = bankId;
    pendingImportBankRef.current = null;
    setShowImportModal(true);
  }, []);

  const handleWebImportToMediaBank = useCallback((bankId) => {
    pendingMediaBankIdRef.current = bankId;
    pendingWebImportBankRef.current = null;
    setShowWebImportModal(true);
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
    // If triggered from a named media bank "Import"
    const mediaBankId = pendingMediaBankIdRef.current;
    if (mediaBankId && activeNicheId) {
      const mediaIds = selectedIds.filter(id => {
        const item = library.find(m => m.id === id);
        return item && item.type !== MEDIA_TYPES.AUDIO;
      });
      if (mediaIds.length > 0) {
        assignToMediaBank(artistId, activeNicheId, mediaIds, mediaBankId, db);
      }
      pendingMediaBankIdRef.current = null;
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
    // If triggered from a named media bank
    const mediaBankId = pendingMediaBankIdRef.current;
    if (mediaBankId) {
      const mediaIds = newIds.filter(id => {
        const item = library.find(m => m.id === id);
        return item && item.type !== MEDIA_TYPES.AUDIO;
      });
      if (mediaIds.length > 0) {
        assignToMediaBank(artistId, activeNicheId, mediaIds, mediaBankId, db);
      }
      pendingMediaBankIdRef.current = null;
    }
    setShowImportModal(false);
    toastSuccess(`Pulled ${newIds.length} item${newIds.length !== 1 ? 's' : ''} into niche`);
  }, [artistId, activeNicheId, projectId, project, db, library, toastSuccess]);

  if (!artistId) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <span className="text-neutral-400">No artist assigned to your account.</span>
        <span className="text-neutral-500 text-sm">Ask your conductor to assign you to an artist in Settings → User Management.</span>
        <Button variant="neutral-secondary" size="medium" onClick={onBack}>Go Back</Button>
      </div>
    );
  }

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
      <div className="flex w-full items-center justify-between border-b border-solid border-neutral-200 bg-black px-6 py-4">
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
      <div className="flex w-full items-center gap-0 border-b border-solid border-neutral-200 bg-black px-6 overflow-x-auto">
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
                  isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-neutral-100 text-neutral-400'
                }`}>
                  {draftCount}
                </span>
              )}
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-neutral-200"
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

      {/* Centered Create bar — visible when a niche is active */}
      {!showAllMedia && !showCaptionPage && activeNiche && activeFormat?.id !== 'finished_media' && (
        <div className="flex items-center justify-center gap-3 px-4 py-3 border-b border-neutral-200">
          <div style={{ display: 'flex', alignItems: 'center', borderRadius: 6, border: '1px solid #404040', backgroundColor: '#171717', overflow: 'hidden' }}>
            <button
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: 'none', border: 'none', cursor: 'pointer', color: '#a3a3a3', fontSize: 16 }}
              onClick={() => setCreateCount(c => Math.max(1, c - 1))}
            >−</button>
            <span style={{ width: 28, textAlign: 'center', color: '#ffffff', fontSize: 14, fontWeight: 600 }}>{createCount}</span>
            <button
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: 'none', border: 'none', cursor: 'pointer', color: '#a3a3a3', fontSize: 16 }}
              onClick={() => setCreateCount(c => Math.min(20, c + 1))}
            >+</button>
          </div>
          <Button
            variant="brand-primary"
            size="medium"
            icon={<FeatherPlay />}
            onClick={() => {
              if (activeFormat?.type === 'slideshow') {
                onOpenEditor?.(activeNiche, createCount, null, null);
              } else if (activeFormat?.id === 'clipper') {
                onOpenVideoEditor?.(activeFormat, activeNiche.id, null, null);
              } else {
                const bankIds = selectedMediaBankIds && selectedMediaBankIds.size > 0 ? [...selectedMediaBankIds] : null;
                onOpenVideoEditor?.(activeFormat, activeNiche.id, null, null, null, bankIds);
              }
            }}
          >
            Create {activeFormat?.name || 'Content'}
          </Button>
        </div>
      )}

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
            db={db}
            artistId={artistId}
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
            niches={niches}
            accounts={latePages}
          />
        )}

        {!showAllMedia && !showCaptionPage && activeNiche && activeFormat?.type === 'slideshow' && (
          <SlideshowNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            library={library}
            projectAudio={projectAudio}
            projectMedia={projectMedia}
            draggingMediaIds={[]}
            onUploadToBank={handleUploadToBank}
            onImportToBank={handleImportToBank}
            onWebImportToBank={handleWebImportToBank}
            onUploadAudio={() => { pendingBankIndexRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'audio/*'; fileInputRef.current.click(); } }}
            onImportAudio={handleImportAudio}
            onWebImportAudio={handleWebImportAudio}
            onRemoveAudio={(audioId) => { removeFromProjectPool(artistId, projectId, [audioId], db); toastSuccess('Audio removed'); }}
          />
        )}

        {!showAllMedia && !showCaptionPage && activeNiche && activeFormat?.id === 'clipper' && (
          <ClipperNicheContent
            db={db}
            artistId={artistId}
            niche={activeNiche}
            library={library}
            projectMedia={projectMedia}
            onMakeVideo={(format, nicheId, existingDraft, _ts, nicheSourceVideos) => {
              onOpenVideoEditor?.(format, nicheId, existingDraft, null, nicheSourceVideos);
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
            selectedMediaBankIds={selectedMediaBankIds}
            onSelectedMediaBankIdsChange={setSelectedMediaBankIds}
            onMakeVideo={(format, nicheId, existingDraft, bankIds) => {
              onOpenVideoEditor?.(format, nicheId, existingDraft, null, null, bankIds);
            }}
            onUpload={() => { pendingBankIndexRef.current = null; pendingMediaBankIdRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'image/*,audio/*,video/*'; fileInputRef.current.click(); } }}
            onUploadAudio={() => { pendingBankIndexRef.current = null; pendingMediaBankIdRef.current = null; if (fileInputRef.current) { fileInputRef.current.accept = 'audio/*'; fileInputRef.current.click(); } }}
            onImport={() => { pendingImportBankRef.current = null; pendingMediaBankIdRef.current = null; setShowImportModal(true); }}
            onImportAudio={handleImportAudio}
            onWebImport={handleWebImport}
            onWebImportAudio={handleWebImportAudio}
            onUploadToMediaBank={handleUploadToMediaBank}
            onImportToMediaBank={handleImportToMediaBank}
            onWebImportToMediaBank={handleWebImportToMediaBank}
            onRefreshCollections={() => setCollections(getCollections(artistId))}
            onAddLyrics={onAddLyrics}
            onUpdateLyrics={onUpdateLyrics}
            onDeleteLyrics={onDeleteLyrics}
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
                    className="flex flex-col items-center gap-3 rounded-lg border border-solid border-neutral-200 bg-[#1a1a1aff] px-5 py-5 cursor-pointer hover:border-neutral-600 transition-colors"
                    onClick={() => handleCreateNiche(fmt)}
                  >
                    {fmt.type === 'slideshow' ? (
                      <div className="flex items-center gap-1 flex-wrap">
                        {fmt.slideLabels.map((label, i) => (
                          <div
                            key={i}
                            className="rounded"
                            style={{
                              width: fmt.slideCount > 5 ? 18 : Math.max(24, 80 / fmt.slideCount),
                              height: fmt.slideCount > 5 ? 24 : 32,
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
          <div className="w-full max-w-2xl rounded-xl border border-neutral-200 bg-[#111111] p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Add Niche</span>
              <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} aria-label="Close" onClick={() => setShowNichePicker(false)} />
            </div>

            <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Slideshows</span>
            <div className="grid grid-cols-3 gap-3 mb-6">
              {slideshowFormats.map(fmt => (
                <div
                  key={fmt.id}
                  className="flex flex-col items-start gap-3 rounded-lg border border-solid border-neutral-200 bg-[#1a1a1aff] px-4 py-4 cursor-pointer hover:border-neutral-600 transition-colors"
                  onClick={() => handleCreateNiche(fmt)}
                >
                  <div className="flex items-center gap-1 flex-wrap">
                    {fmt.slideLabels.map((label, i) => (
                      <div key={i} className="rounded" style={{
                        width: fmt.slideCount > 5 ? 18 : Math.max(24, 80 / fmt.slideCount),
                        height: fmt.slideCount > 5 ? 24 : 32,
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
                    className="flex flex-col items-start gap-3 rounded-lg border border-solid border-neutral-200 bg-[#1a1a1aff] px-4 py-4 cursor-pointer hover:border-neutral-600 transition-colors"
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
        const importingToBank = pendingImportBankRef.current != null;
        // When importing to a bank, show niche media so user can assign existing items to banks
        const nicheMediaItems = activeNiche?.mediaIds?.length > 0
          ? library.filter(item => activeNiche.mediaIds.includes(item.id))
          : [];
        const handleAssignToBank = (ids) => {
          const bankIdx = pendingImportBankRef.current;
          if (bankIdx != null && activeNicheId) {
            ids.forEach(id => assignToBank(artistId, activeNicheId, id, bankIdx, db));
            pendingImportBankRef.current = null;
          }
          setShowImportModal(false);
          toastSuccess(`Added ${ids.length} item${ids.length !== 1 ? 's' : ''} to bank`);
        };
        return (
          <ImportFromLibraryModal
            onClose={closeImport}
            title={importAudioOnly ? 'Import Audio' : 'Import Media'}
            sources={[
              ...(importingToBank && filterAudio(nicheMediaItems).length > 0
                ? [{ label: 'This Niche', items: filterAudio(nicheMediaItems), onImport: handleAssignToBank }]
                : []),
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

      {/* Audio Web Import Modal */}
      {showAudioWebImport && (
        <WebImportModal
          onClose={() => setShowAudioWebImport(false)}
          onComplete={handleWebImportAudioComplete}
          artistId={artistId}
          audioOnly
        />
      )}

      {/* Upload progress banner */}
      {isUploading && uploadProgress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-neutral-200 bg-[#111111] px-5 py-3 shadow-2xl">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent flex-none" />
          <div className="flex flex-col gap-0.5">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">
              Uploading {uploadProgress.current} of {uploadProgress.total}
              {uploadProgress.totalBytes > 0 && (
                <span className="text-neutral-400 font-normal text-caption ml-1.5">
                  {uploadProgress.totalBytes >= 1048576
                    ? `${Math.round((uploadProgress.bytes || 0) / 1048576)}/${Math.round(uploadProgress.totalBytes / 1048576)} MB`
                    : `${Math.round((uploadProgress.bytes || 0) / 1024)}/${Math.round(uploadProgress.totalBytes / 1024)} KB`}
                </span>
              )}
            </span>
            <div className="w-48 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500"
                style={{ width: `${uploadProgress.totalBytes > 0 ? Math.round(((uploadProgress.bytes || 0) / uploadProgress.totalBytes) * 100) : Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}
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

  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const gridRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [rubberBand, setRubberBand] = useState(null);

  // Clear selection, search, and niche filter when switching sources
  const handleSwitchSource = (idx) => {
    setActiveSourceIdx(idx);
    setSelected(new Set());
    setNicheFilter(null);
    setSearchQuery('');
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
    if (selected.size === filteredItems.length) setSelected(new Set());
    else setSelected(new Set(filteredItems.map(i => i.id)));
  };

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(i => i.name?.toLowerCase().includes(q));
  }, [items, searchQuery]);
  const images = useMemo(() => filteredItems.filter(i => i.type === 'image'), [filteredItems]);
  const videos = useMemo(() => filteredItems.filter(i => i.type === 'video'), [filteredItems]);
  const audio = useMemo(() => filteredItems.filter(i => i.type === 'audio'), [filteredItems]);

  // Use full URL for better quality in the import modal (thumbnails are too small/compressed)
  const getImgSrc = useCallback((item) => item.url || item.thumbnailUrl, []);

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
      window.addEventListener('pointercancel', handleMouseUp);
      return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); window.removeEventListener('pointercancel', handleMouseUp); };
    }
  }, [dragStart, handleMouseMove, handleMouseUp]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full max-w-5xl mx-4 rounded-xl border border-neutral-200 bg-[#111111] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex flex-col border-b border-neutral-200">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col gap-1">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{title}</span>
              <span className="text-caption font-caption text-neutral-400">{subtitle || `${filteredItems.length} item${filteredItems.length !== 1 ? 's' : ''} available${searchQuery ? ` (filtered from ${items.length})` : ''}`}</span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="neutral-tertiary" size="small" onClick={selectAll}>
                {selected.size === filteredItems.length ? 'Deselect All' : 'Select All'}
              </Button>
              <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} aria-label="Close" onClick={onClose} />
            </div>
          </div>
          <div className="px-6 pb-3">
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-black px-3 py-2">
              <FeatherSearch className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
              <input
                className="flex-1 bg-transparent text-body font-body text-white outline-none placeholder-neutral-500"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searchQuery && (
                <button className="text-neutral-500 hover:text-neutral-300 bg-transparent border-none cursor-pointer p-0" onClick={() => setSearchQuery('')}>
                  <FeatherX style={{ width: 12, height: 12 }} />
                </button>
              )}
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
            <div className="flex items-center gap-2 px-6 py-2 border-t border-neutral-200/50">
              <span className="text-caption font-caption text-neutral-500">Filter:</span>
              <button
                className={`px-2.5 py-1 rounded-full text-caption font-caption transition-colors cursor-pointer border ${
                  !nicheFilter ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-transparent border-neutral-200 text-neutral-400 hover:text-neutral-200'
                }`}
                onClick={() => { setNicheFilter(null); setSelected(new Set()); }}
              >
                All
              </button>
              {filterableNiches.map(n => (
                <button
                  key={n.id}
                  className={`px-2.5 py-1 rounded-full text-caption font-caption transition-colors cursor-pointer border ${
                    nicheFilter === n.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-transparent border-neutral-200 text-neutral-400 hover:text-neutral-200'
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
              {videos.length > 0 && (
                <>
                  <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Videos ({videos.length})</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-6">
                    {videos.map(item => (
                      <div key={item.id}
                        data-media-id={item.id}
                        className={`relative flex flex-col rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                          selected.has(item.id) ? 'border-indigo-500' : 'border-transparent hover:border-neutral-600'
                        }`}
                        onClick={() => { if (!isDragging) toggle(item.id); }}
                      >
                        <div className="relative aspect-video">
                          {item.thumbnailUrl ? (
                            <img src={item.thumbnailUrl} alt={item.name} className="h-full w-full object-cover" loading="lazy" draggable={false} />
                          ) : (
                            <div className="h-full w-full bg-neutral-100 flex items-center justify-center">
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
                        <span className="text-[11px] text-neutral-300 truncate px-1.5 py-1">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {images.length > 0 && (
                <>
                  <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Images ({images.length})</span>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3 mb-6">
                    {images.map(item => (
                      <div key={item.id}
                        data-media-id={item.id}
                        className={`relative flex flex-col rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                          selected.has(item.id) ? 'border-indigo-500' : 'border-transparent hover:border-neutral-600'
                        }`}
                        onClick={() => { if (!isDragging) toggle(item.id); }}
                      >
                        <div className="relative aspect-square">
                          <img src={getImgSrc(item)} alt={item.name} className="h-full w-full object-cover" loading="lazy" draggable={false} />
                          {selected.has(item.id) && (
                            <div className="absolute inset-0 bg-indigo-500/30 flex items-center justify-center">
                              <FeatherCheck className="text-white" style={{ width: 20, height: 20 }} />
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] text-neutral-300 truncate px-1.5 py-1">{item.name}</span>
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
        <div className="flex items-center justify-between border-t border-neutral-200 px-6 py-4">
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
// ProjectCaptionPage — Captions & Hashtags with Scope Tabs + Platform Rules
// ═══════════════════════════════════════════════════

import { ALL_PLATFORMS, PLATFORM_LABELS as PLATFORM_NAMES, PLATFORM_COLORS as PLATFORM_COLORS_MAP } from '../../config/platforms';

// Helper: extract text from caption (supports string | { text, generatedBy, generatedAt })
const getCaptionText = (cap) => typeof cap === 'string' ? cap : (cap?.text || '');

// Tiny input component for adding captions to a named bank (manages own text state)
const CaptionBankInput = ({ bankId, onAdd }) => {
  const [val, setVal] = useState('');
  return (
    <div className="flex gap-1.5 items-center mt-0.5">
      <input
        className="flex-1 rounded-md border border-solid border-neutral-200 bg-black px-2 py-1 text-caption font-caption text-white outline-none placeholder-neutral-500"
        placeholder="Add caption..."
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onAdd(bankId, val.trim()); setVal(''); } }}
      />
      <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add" onClick={() => { if (val.trim()) { onAdd(bankId, val.trim()); setVal(''); } }} />
    </div>
  );
};

// Tiny input component for adding hashtags to a named bank
const HashtagBankInput = ({ bankId, onAdd }) => {
  const [val, setVal] = useState('');
  return (
    <div className="flex gap-1.5 items-center mt-0.5">
      <input
        className="flex-1 rounded-md border border-solid border-neutral-200 bg-black px-2 py-1 text-caption font-caption text-white outline-none placeholder-neutral-500"
        placeholder="#hashtag..."
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onAdd(bankId, val.trim()); setVal(''); } }}
      />
      <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add" onClick={() => { if (val.trim()) { onAdd(bankId, val.trim()); setVal(''); } }} />
    </div>
  );
};

const ProjectCaptionPage = ({ db, artistId, projectId, project, niches = [], accounts = [] }) => {
  const { success: toastSuccess } = useToast();
  const [newCaption, setNewCaption] = useState('');
  const [newHashtag, setNewHashtag] = useState('');
  const [captionAddTier, setCaptionAddTier] = useState('always'); // 'always' | 'pool'
  const [hashtagAddTier, setHashtagAddTier] = useState('always'); // 'always' | 'pool'
  const [scope, setScope] = useState('project'); // 'project' | niche ID
  const [showPlatformRules, setShowPlatformRules] = useState(false);
  const [newPlatformTag, setNewPlatformTag] = useState({});
  // AI generation state
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiContext, setAiContext] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState(null); // { captions: string[], hashtags: string[] }
  const [aiError, setAiError] = useState(null);
  const [aiAccepted, setAiAccepted] = useState({ captions: new Set(), hashtags: new Set() });
  // Named banks
  const [newBankName, setNewBankName] = useState('');
  const [addingBankFor, setAddingBankFor] = useState(null); // 'captions' | 'hashtags' | null
  const [renamingBankId, setRenamingBankId] = useState(null);
  const [renamingBankVal, setRenamingBankVal] = useState('');

  // Determine which entity we're editing
  const isProjectScope = scope === 'project';
  const activeNiche = !isProjectScope ? niches.find(n => n.id === scope) : null;
  const target = isProjectScope ? project : activeNiche;

  // Read banks from target
  const rawCB = target ? getCollectionCaptionBank(target) : { always: [], pool: [] };
  const rawHB = target ? getCollectionHashtagBank(target) : { always: [], pool: [] };

  const captions = useMemo(() => {
    if (Array.isArray(rawCB)) return { always: rawCB, pool: [] };
    return { always: rawCB.always || [], pool: rawCB.pool || [] };
  }, [rawCB]);

  const hashtags = useMemo(() => {
    if (Array.isArray(rawHB)) return { always: rawHB, pool: [] };
    return { always: rawHB.always || [], pool: rawHB.pool || [] };
  }, [rawHB]);

  const captionBanks = useMemo(() => rawCB?.banks || [], [rawCB]);
  const hashtagBanks = useMemo(() => rawHB?.banks || [], [rawHB]);

  const platformOnly = useMemo(() => {
    if (!target?.hashtagBank || Array.isArray(target.hashtagBank)) return {};
    return target.hashtagBank.platformOnly || {};
  }, [target]);

  const platformExclude = useMemo(() => {
    if (!target?.hashtagBank || Array.isArray(target.hashtagBank)) return {};
    return target.hashtagBank.platformExclude || {};
  }, [target]);

  const allCaptionEntries = [...captions.always, ...captions.pool];
  const allCaptions = allCaptionEntries.map(getCaptionText);
  const allHashtags = [...hashtags.always, ...hashtags.pool];

  // Connected platforms from Late.co accounts
  const connectedPlatforms = useMemo(() => {
    const platforms = new Set();
    accounts.forEach(acc => {
      if (acc.platform) platforms.add(acc.platform);
      // Late.co pages may not have explicit platform, check social_accounts
      if (acc.social_accounts) {
        acc.social_accounts.forEach(sa => { if (sa.platform) platforms.add(sa.platform); });
      }
    });
    return platforms.size > 0 ? [...platforms] : ALL_PLATFORMS;
  }, [accounts]);

  // Save helpers
  const saveCaptions = useCallback((newBank) => {
    if (isProjectScope) {
      updateProjectCaptionBank(artistId, projectId, newBank, db);
    } else {
      updateNicheCaptionBank(artistId, scope, newBank, db);
    }
  }, [db, artistId, projectId, scope, isProjectScope]);

  const saveHashtags = useCallback((newBank) => {
    if (isProjectScope) {
      updateProjectHashtagBank(artistId, projectId, newBank, db);
    } else {
      updateNicheHashtagBank(artistId, scope, newBank, db);
    }
  }, [db, artistId, projectId, scope, isProjectScope]);

  // Caption handlers
  const handleAddCaption = useCallback(() => {
    const text = newCaption.trim();
    if (!text) return;
    // Detect numbered/bulleted lists and split into individual captions
    // Matches: "1. ...", "1) ...", "- ...", "• ..."
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const isNumberedList = lines.length > 1 && lines.every(l => /^\d+[\.\)]\s/.test(l) || /^[-•]\s/.test(l));
    const newItems = isNumberedList
      ? lines.map(l => l.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•]\s*/, '').trim()).filter(Boolean)
      : [text];
    const existing = captions[captionAddTier];
    const existingTexts = new Set(existing.map(getCaptionText));
    const unique = newItems.filter(item => !existingTexts.has(item));
    if (unique.length === 0) { setNewCaption(''); return; }
    saveCaptions({ ...captions, [captionAddTier]: [...existing, ...unique] });
    setNewCaption('');
  }, [newCaption, captions, captionAddTier, saveCaptions]);

  const handleRemoveCaption = useCallback((tier, idx) => {
    const updated = { ...captions, [tier]: captions[tier].filter((_, i) => i !== idx) };
    saveCaptions(updated);
  }, [captions, saveCaptions]);

  const handleToggleCaptionTier = useCallback((fromTier, idx) => {
    const toTier = fromTier === 'always' ? 'pool' : 'always';
    const item = captions[fromTier][idx];
    const updated = {
      ...captions,
      [fromTier]: captions[fromTier].filter((_, i) => i !== idx),
      [toTier]: [...captions[toTier], item],
    };
    saveCaptions(updated);
  }, [captions, saveCaptions]);

  // Hashtag handlers
  const handleAddHashtag = useCallback(() => {
    const raw = newHashtag.trim();
    if (!raw) return;
    // Split on # to support pasting multiple: "#folk #aesthetic #vibes"
    const tags = raw.split('#').map(s => s.trim()).filter(Boolean).map(s => `#${s}`);
    if (tags.length === 0) return;
    const newTags = tags.filter(t => !allHashtags.includes(t));
    if (newTags.length === 0) { setNewHashtag(''); return; }
    saveHashtags({ ...hashtags, [hashtagAddTier]: [...hashtags[hashtagAddTier], ...newTags] });
    setNewHashtag('');
  }, [newHashtag, hashtags, hashtagAddTier, allHashtags, saveHashtags]);

  const handleRemoveHashtag = useCallback((tier, idx) => {
    const updated = { ...hashtags, [tier]: hashtags[tier].filter((_, i) => i !== idx) };
    saveHashtags(updated);
  }, [hashtags, saveHashtags]);

  const handleToggleHashtagTier = useCallback((fromTier, idx) => {
    const toTier = fromTier === 'always' ? 'pool' : 'always';
    const item = hashtags[fromTier][idx];
    const updated = {
      ...hashtags,
      [fromTier]: hashtags[fromTier].filter((_, i) => i !== idx),
      [toTier]: [...hashtags[toTier], item],
    };
    saveHashtags(updated);
  }, [hashtags, saveHashtags]);

  const handleCopyAll = useCallback(() => {
    if (allHashtags.length === 0) return;
    navigator.clipboard.writeText(allHashtags.join(' '));
    toastSuccess('Copied all hashtags');
  }, [allHashtags, toastSuccess]);

  // Platform rule handlers
  const targetId = isProjectScope ? projectId : scope;
  const handleAddPlatformTag = useCallback((platform) => {
    const raw = (newPlatformTag[platform] || '').trim();
    if (!raw) return;
    const tag = raw.startsWith('#') ? raw : `#${raw}`;
    const current = platformOnly[platform] || [];
    if (current.includes(tag)) return;
    const updated = { ...platformOnly, [platform]: [...current, tag] };
    updateCollectionPlatformHashtags(artistId, targetId, updated, db);
    setNewPlatformTag(prev => ({ ...prev, [platform]: '' }));
  }, [db, artistId, targetId, platformOnly, newPlatformTag]);

  const handleRemovePlatformTag = useCallback((platform, idx) => {
    const current = platformOnly[platform] || [];
    const updated = { ...platformOnly, [platform]: current.filter((_, i) => i !== idx) };
    updateCollectionPlatformHashtags(artistId, targetId, updated, db);
  }, [db, artistId, targetId, platformOnly]);

  const handleToggleExclude = useCallback((platform, tag) => {
    const current = platformExclude[platform] || [];
    const isExcluded = current.includes(tag);
    const updated = {
      ...platformExclude,
      [platform]: isExcluded ? current.filter(t => t !== tag) : [...current, tag],
    };
    updateCollectionPlatformExcludes(artistId, targetId, updated, db);
  }, [db, artistId, targetId, platformExclude]);

  // AI generation handler
  const handleAiGenerate = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    setAiResults(null);
    setAiAccepted({ captions: new Set(), hashtags: new Set() });
    try {
      const result = await generateCaptions({
        projectName: project?.name || '',
        nicheName: activeNiche?.name || '',
        context: aiContext.trim() || undefined,
        platforms: connectedPlatforms,
        existingCaptions: allCaptions,
        existingHashtags: allHashtags,
        captionCount: 5,
      });
      setAiResults(result);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }, [project, activeNiche, aiContext, connectedPlatforms, allCaptions, allHashtags]);

  const handleAcceptCaption = useCallback((caption, idx) => {
    const entry = { text: caption, generatedBy: 'ai', generatedAt: new Date().toISOString() };
    const existing = captions[captionAddTier];
    if (existing.some(c => (typeof c === 'string' ? c : c.text) === caption)) return;
    saveCaptions({ ...captions, [captionAddTier]: [...existing, entry] });
    setAiAccepted(prev => ({ ...prev, captions: new Set([...prev.captions, idx]) }));
  }, [captions, captionAddTier, saveCaptions]);

  const handleAcceptHashtag = useCallback((tag, idx) => {
    if (allHashtags.includes(tag)) return;
    saveHashtags({ ...hashtags, [hashtagAddTier]: [...hashtags[hashtagAddTier], tag] });
    setAiAccepted(prev => ({ ...prev, hashtags: new Set([...prev.hashtags, idx]) }));
  }, [hashtags, hashtagAddTier, allHashtags, saveHashtags]);

  const handleAcceptAllCaptions = useCallback(() => {
    if (!aiResults?.captions?.length) return;
    const existing = captions[captionAddTier];
    const existingTexts = new Set(existing.map(c => typeof c === 'string' ? c : c.text));
    const newEntries = aiResults.captions
      .filter(cap => !existingTexts.has(cap))
      .map(cap => ({ text: cap, generatedBy: 'ai', generatedAt: new Date().toISOString() }));
    if (newEntries.length === 0) return;
    saveCaptions({ ...captions, [captionAddTier]: [...existing, ...newEntries] });
    setAiAccepted(prev => ({ ...prev, captions: new Set(aiResults.captions.map((_, i) => i)) }));
  }, [aiResults, captions, captionAddTier, saveCaptions]);

  const handleAcceptAllHashtags = useCallback(() => {
    if (!aiResults?.hashtags?.length) return;
    const existingSet = new Set(allHashtags);
    const newTags = aiResults.hashtags.filter(t => !existingSet.has(t));
    if (newTags.length === 0) return;
    saveHashtags({ ...hashtags, [hashtagAddTier]: [...hashtags[hashtagAddTier], ...newTags] });
    setAiAccepted(prev => ({ ...prev, hashtags: new Set(aiResults.hashtags.map((_, i) => i)) }));
  }, [aiResults, hashtags, hashtagAddTier, allHashtags, saveHashtags]);

  // Named bank handlers
  const handleCreateBank = useCallback((type) => {
    const name = newBankName.trim();
    if (!name) return;
    const id = Date.now().toString(36);
    if (type === 'captions') {
      const banks = [...captionBanks, { id, name, items: [] }];
      saveCaptions({ ...captions, banks });
    } else {
      const banks = [...hashtagBanks, { id, name, items: [] }];
      saveHashtags({ ...hashtags, banks });
    }
    setNewBankName('');
    setAddingBankFor(null);
  }, [newBankName, captions, hashtags, captionBanks, hashtagBanks, saveCaptions, saveHashtags]);

  const handleRenameBank = useCallback((type, bankId, name) => {
    if (!name.trim()) return;
    if (type === 'captions') {
      const banks = captionBanks.map(b => b.id === bankId ? { ...b, name: name.trim() } : b);
      saveCaptions({ ...captions, banks });
    } else {
      const banks = hashtagBanks.map(b => b.id === bankId ? { ...b, name: name.trim() } : b);
      saveHashtags({ ...hashtags, banks });
    }
    setRenamingBankId(null);
  }, [captions, hashtags, captionBanks, hashtagBanks, saveCaptions, saveHashtags]);

  const handleDeleteBank = useCallback((type, bankId) => {
    if (type === 'captions') {
      const banks = captionBanks.filter(b => b.id !== bankId);
      saveCaptions({ ...captions, banks });
    } else {
      const banks = hashtagBanks.filter(b => b.id !== bankId);
      saveHashtags({ ...hashtags, banks });
    }
  }, [captions, hashtags, captionBanks, hashtagBanks, saveCaptions, saveHashtags]);

  const handleAddToBankCaption = useCallback((bankId, text) => {
    if (!text.trim()) return;
    const banks = captionBanks.map(b => {
      if (b.id !== bankId) return b;
      if (b.items.some(i => (typeof i === 'string' ? i : i.text) === text)) return b;
      return { ...b, items: [...b.items, text] };
    });
    saveCaptions({ ...captions, banks });
  }, [captions, captionBanks, saveCaptions]);

  const handleRemoveFromBankCaption = useCallback((bankId, idx) => {
    const banks = captionBanks.map(b => {
      if (b.id !== bankId) return b;
      return { ...b, items: b.items.filter((_, i) => i !== idx) };
    });
    saveCaptions({ ...captions, banks });
  }, [captions, captionBanks, saveCaptions]);

  const handleAddToBankHashtag = useCallback((bankId, raw) => {
    if (!raw.trim()) return;
    const tag = raw.startsWith('#') ? raw.trim() : `#${raw.trim()}`;
    const banks = hashtagBanks.map(b => {
      if (b.id !== bankId) return b;
      if (b.items.includes(tag)) return b;
      return { ...b, items: [...b.items, tag] };
    });
    saveHashtags({ ...hashtags, banks });
  }, [hashtags, hashtagBanks, saveHashtags]);

  const handleRemoveFromBankHashtag = useCallback((bankId, idx) => {
    const banks = hashtagBanks.map(b => {
      if (b.id !== bankId) return b;
      return { ...b, items: b.items.filter((_, i) => i !== idx) };
    });
    saveHashtags({ ...hashtags, banks });
  }, [hashtags, hashtagBanks, saveHashtags]);

  if (!project) return null;

  const renderHashtagPill = (tag, tier, idx) => {
    const isAlways = tier === 'always';
    return (
      <div key={`${tier}-${idx}`} className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 group ${isAlways ? 'bg-green-500/10 border border-green-500/30' : 'bg-neutral-100 border border-neutral-200'}`}>
        <span className={`text-caption font-caption ${isAlways ? 'text-green-400' : 'text-neutral-400'}`}>{tag}</span>
        <button
          className="text-neutral-500 hover:text-indigo-400 bg-transparent border-none cursor-pointer p-0 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => handleToggleHashtagTier(tier, idx)}
          title={isAlways ? 'Move to Pool' : 'Make Always-On'}
        >
          {isAlways ? '↓' : '↑'}
        </button>
        <button
          className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => handleRemoveHashtag(tier, idx)}
        >
          <FeatherX style={{ width: 10, height: 10 }} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col items-start self-stretch overflow-y-auto px-8 py-6 gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Captions & Hashtags</span>
        <span className="text-body font-body text-neutral-400">
          {isProjectScope ? 'Shared across all niches in this project' : `Niche: ${activeNiche?.name || scope}`}
        </span>
      </div>

      {/* Scope Tabs */}
      <div className="flex items-center gap-1 border-b border-neutral-200 w-full">
        <button
          onClick={() => setScope('project')}
          className={`border-none cursor-pointer px-4 py-2 text-[13px] font-semibold rounded-t-md transition-all ${isProjectScope ? 'bg-indigo-500/15 text-indigo-400 border-b-2 border-b-indigo-500' : 'bg-transparent text-neutral-500'}`}
        >
          Project-Wide
        </button>
        {niches.map(n => (
          <button
            key={n.id}
            onClick={() => setScope(n.id)}
            className={`border-none cursor-pointer px-4 py-2 text-[13px] font-semibold rounded-t-md transition-all ${scope === n.id ? 'bg-indigo-500/15 text-indigo-400 border-b-2 border-b-indigo-500' : 'bg-transparent text-neutral-500'}`}
          >
            {n.name}
          </button>
        ))}
      </div>

      {/* AI Generate Panel */}
      <div className="flex w-full flex-col gap-3 rounded-lg border border-solid border-indigo-500/30 bg-indigo-500/5 p-5">
        <button
          className="flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 w-full"
          onClick={() => setShowAiPanel(!showAiPanel)}
        >
          <FeatherZap className="text-indigo-400" style={{ width: 14, height: 14 }} />
          <span className="text-body-bold font-body-bold text-indigo-300">Generate</span>
          <span className="ml-auto text-neutral-500 text-xs">{showAiPanel ? '▲' : '▼'}</span>
        </button>

        {showAiPanel && (
          <div className="flex flex-col gap-3 mt-1">
            <textarea
              className="min-h-[48px] max-h-[100px] rounded-md border border-solid border-indigo-500/30 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500 resize-none"
              placeholder="Describe the song/vibe (e.g., 'upbeat indie folk about summer love, acoustic guitar, chill vibes')..."
              value={aiContext}
              onChange={e => setAiContext(e.target.value)}
              rows={2}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="brand-primary"
                size="small"
                icon={<FeatherZap />}
                loading={aiLoading}
                disabled={aiLoading}
                onClick={handleAiGenerate}
              >
                {aiLoading ? 'Generating...' : 'Generate Captions & Hashtags'}
              </Button>
              {aiResults && (
                <span className="text-caption font-caption text-green-400">
                  {aiResults.captions.length} captions, {aiResults.hashtags.length} hashtags
                </span>
              )}
            </div>
            {aiError && (
              <span className="text-caption font-caption text-red-400">{aiError}</span>
            )}

            {/* AI Results — Captions */}
            {aiResults?.captions?.length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider">Generated Captions</span>
                  <button
                    className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-auto"
                    onClick={handleAcceptAllCaptions}
                  >
                    Accept All → {captionAddTier === 'always' ? 'Always On' : 'Pool'}
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
                  {aiResults.captions.map((cap, idx) => {
                    const accepted = aiAccepted.captions.has(idx);
                    return (
                      <div key={idx} className={`flex items-start gap-2 rounded-md px-2.5 py-1.5 group ${accepted ? 'bg-green-500/10 border border-green-500/20' : 'bg-black/40 border border-neutral-200'}`}>
                        <span className={`grow text-caption font-caption ${accepted ? 'text-green-300' : 'text-neutral-300'} line-clamp-3`}>{cap}</span>
                        {!accepted ? (
                          <button
                            className="text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer p-0 flex-none text-[10px] font-semibold"
                            onClick={() => handleAcceptCaption(cap, idx)}
                          >
                            Add
                          </button>
                        ) : (
                          <FeatherCheck className="text-green-400 flex-none" style={{ width: 12, height: 12 }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Results — Hashtags */}
            {aiResults?.hashtags?.length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider">Generated Hashtags</span>
                  <button
                    className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-auto"
                    onClick={handleAcceptAllHashtags}
                  >
                    Accept All → {hashtagAddTier === 'always' ? 'Always On' : 'Pool'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {aiResults.hashtags.map((tag, idx) => {
                    const accepted = aiAccepted.hashtags.has(idx);
                    return (
                      <button
                        key={idx}
                        className={`rounded-full px-2.5 py-0.5 text-caption font-caption border cursor-pointer transition-all ${accepted ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20'}`}
                        onClick={() => !accepted && handleAcceptHashtag(tag, idx)}
                        disabled={accepted}
                      >
                        {accepted && <span className="mr-1">✓</span>}{tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Captions Section */}
      <div className="flex w-full flex-col gap-3 rounded-lg border border-solid border-neutral-200 bg-[#111111] p-5">
        <div className="flex items-center gap-2">
          <FeatherMessageSquare className="text-neutral-400" style={{ width: 14, height: 14 }} />
          <span className="text-body-bold font-body-bold text-[#ffffffff]">Captions</span>
          <Badge variant="neutral">{allCaptions.length}</Badge>
        </div>

        {/* Always-on captions */}
        {captions.always.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">Always On</span>
            <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
              {captions.always.map((cap, idx) => {
                const text = getCaptionText(cap);
                const isAi = typeof cap === 'object' && cap?.generatedBy === 'ai';
                return (
                  <div key={idx} className="flex items-start gap-2 rounded-md bg-green-500/5 border border-green-500/20 px-2.5 py-1.5 group">
                    {isAi && <FeatherZap className="text-indigo-400 flex-none mt-0.5" style={{ width: 10, height: 10 }} />}
                    <span className="grow text-caption font-caption text-green-300 cursor-pointer hover:text-white line-clamp-3" title="Click to copy" onClick={() => { navigator.clipboard.writeText(text); toastSuccess('Copied'); }}>{text}</span>
                    <button className="text-neutral-500 hover:text-indigo-400 bg-transparent border-none cursor-pointer p-0 text-[9px] opacity-0 group-hover:opacity-100" onClick={() => handleToggleCaptionTier('always', idx)} title="Move to Pool">↓</button>
                    <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 flex-none opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveCaption('always', idx)}><FeatherTrash2 style={{ width: 12, height: 12 }} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pool captions */}
        {captions.pool.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">Pool</span>
            <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
              {captions.pool.map((cap, idx) => {
                const text = getCaptionText(cap);
                const isAi = typeof cap === 'object' && cap?.generatedBy === 'ai';
                return (
                  <div key={idx} className="flex items-start gap-2 rounded-md bg-black px-2.5 py-1.5 group">
                    {isAi && <FeatherZap className="text-indigo-400 flex-none mt-0.5" style={{ width: 10, height: 10 }} />}
                    <span className="grow text-caption font-caption text-neutral-300 cursor-pointer hover:text-white line-clamp-3" title="Click to copy" onClick={() => { navigator.clipboard.writeText(text); toastSuccess('Copied'); }}>{text}</span>
                    <button className="text-neutral-500 hover:text-indigo-400 bg-transparent border-none cursor-pointer p-0 text-[9px] opacity-0 group-hover:opacity-100" onClick={() => handleToggleCaptionTier('pool', idx)} title="Make Always-On">↑</button>
                    <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 flex-none opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveCaption('pool', idx)}><FeatherTrash2 style={{ width: 12, height: 12 }} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Named caption banks */}
        {captionBanks.map(bank => (
          <div key={bank.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-1 group">
              {renamingBankId === bank.id ? (
                <input
                  autoFocus
                  className="text-[10px] font-semibold bg-black border border-indigo-500/30 rounded px-1.5 py-0.5 text-indigo-300 outline-none w-32"
                  value={renamingBankVal}
                  onChange={e => setRenamingBankVal(e.target.value)}
                  onBlur={() => handleRenameBank('captions', bank.id, renamingBankVal)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameBank('captions', bank.id, renamingBankVal); if (e.key === 'Escape') setRenamingBankId(null); }}
                />
              ) : (
                <span
                  className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider cursor-pointer hover:text-indigo-300"
                  onDoubleClick={() => { setRenamingBankId(bank.id); setRenamingBankVal(bank.name); }}
                  title="Double-click to rename"
                >{bank.name}</span>
              )}
              <Badge variant="neutral">{bank.items.length}</Badge>
              <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" onClick={() => handleDeleteBank('captions', bank.id)}>
                <FeatherTrash2 style={{ width: 11, height: 11 }} />
              </button>
            </div>
            <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
              {bank.items.map((cap, idx) => {
                const text = typeof cap === 'string' ? cap : cap.text || '';
                return (
                  <div key={idx} className="flex items-start gap-2 rounded-md bg-indigo-500/5 border border-indigo-500/20 px-2.5 py-1.5 group">
                    <span className="grow text-caption font-caption text-indigo-200 cursor-pointer hover:text-white line-clamp-3" title="Click to copy" onClick={() => { navigator.clipboard.writeText(text); toastSuccess('Copied'); }}>{text}</span>
                    <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 flex-none opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveFromBankCaption(bank.id, idx)}><FeatherTrash2 style={{ width: 12, height: 12 }} /></button>
                  </div>
                );
              })}
            </div>
            <CaptionBankInput bankId={bank.id} onAdd={handleAddToBankCaption} />
          </div>
        ))}

        {/* Add new caption bank */}
        {addingBankFor === 'captions' ? (
          <div className="flex gap-2 items-center">
            <input
              autoFocus
              className="flex-1 rounded-md border border-solid border-indigo-500/30 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
              placeholder="Bank name..."
              value={newBankName}
              onChange={e => setNewBankName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateBank('captions'); if (e.key === 'Escape') { setAddingBankFor(null); setNewBankName(''); } }}
            />
            <Button variant="brand-primary" size="small" onClick={() => handleCreateBank('captions')}>Create</Button>
            <button className="text-neutral-500 hover:text-neutral-300 bg-transparent border-none cursor-pointer text-xs" onClick={() => { setAddingBankFor(null); setNewBankName(''); }}>Cancel</button>
          </div>
        ) : (
          <button
            className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer p-0"
            onClick={() => setAddingBankFor('captions')}
          >
            <FeatherPlus style={{ width: 12, height: 12 }} /> New Bank
          </button>
        )}

        <div className="flex w-full gap-2 items-end">
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center gap-1">
              <button onClick={() => setCaptionAddTier('always')} className={`border-none cursor-pointer px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all ${captionAddTier === 'always' ? 'bg-green-500/20 text-green-400' : 'bg-transparent text-neutral-600'}`}>Always On</button>
              <button onClick={() => setCaptionAddTier('pool')} className={`border-none cursor-pointer px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all ${captionAddTier === 'pool' ? 'bg-neutral-200 text-neutral-300' : 'bg-transparent text-neutral-600'}`}>Pool</button>
            </div>
            <textarea
              className="min-h-[32px] max-h-[80px] rounded-md border border-solid border-neutral-200 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500 resize-none"
              placeholder={`Add to ${captionAddTier === 'always' ? 'always-on' : 'pool'}...`}
              value={newCaption}
              onChange={e => setNewCaption(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddCaption(); } }}
              rows={1}
            />
          </div>
          <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add caption" onClick={handleAddCaption} />
        </div>
      </div>

      {/* Hashtags Section */}
      <div className="flex w-full flex-col gap-3 rounded-lg border border-solid border-neutral-200 bg-[#111111] p-5">
        <div className="flex items-center gap-2">
          <FeatherHash className="text-neutral-400" style={{ width: 14, height: 14 }} />
          <span className="text-body-bold font-body-bold text-[#ffffffff]">Hashtags</span>
          <Badge variant="neutral">{allHashtags.length}</Badge>
          {allHashtags.length > 0 && (
            <button className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-auto" onClick={handleCopyAll}>
              Copy All
            </button>
          )}
        </div>

        {/* Always-on hashtags */}
        {hashtags.always.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">Always On — auto-added to all posts</span>
            <div className="flex flex-wrap gap-1.5">{hashtags.always.map((tag, idx) => renderHashtagPill(tag, 'always', idx))}</div>
          </div>
        )}

        {/* Pool hashtags */}
        {hashtags.pool.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">Pool — available for manual pick</span>
            <div className="flex flex-wrap gap-1.5">{hashtags.pool.map((tag, idx) => renderHashtagPill(tag, 'pool', idx))}</div>
          </div>
        )}

        {/* Named hashtag banks */}
        {hashtagBanks.map(bank => (
          <div key={bank.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-1 group">
              {renamingBankId === bank.id ? (
                <input
                  autoFocus
                  className="text-[10px] font-semibold bg-black border border-indigo-500/30 rounded px-1.5 py-0.5 text-indigo-300 outline-none w-32"
                  value={renamingBankVal}
                  onChange={e => setRenamingBankVal(e.target.value)}
                  onBlur={() => handleRenameBank('hashtags', bank.id, renamingBankVal)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameBank('hashtags', bank.id, renamingBankVal); if (e.key === 'Escape') setRenamingBankId(null); }}
                />
              ) : (
                <span
                  className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider cursor-pointer hover:text-indigo-300"
                  onDoubleClick={() => { setRenamingBankId(bank.id); setRenamingBankVal(bank.name); }}
                  title="Double-click to rename"
                >{bank.name}</span>
              )}
              <Badge variant="neutral">{bank.items.length}</Badge>
              <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" onClick={() => handleDeleteBank('hashtags', bank.id)}>
                <FeatherTrash2 style={{ width: 11, height: 11 }} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bank.items.map((tag, idx) => (
                <div key={idx} className="flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 group">
                  <span className="text-caption font-caption text-indigo-300">{tag}</span>
                  <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveFromBankHashtag(bank.id, idx)}>
                    <FeatherX style={{ width: 10, height: 10 }} />
                  </button>
                </div>
              ))}
            </div>
            <HashtagBankInput bankId={bank.id} onAdd={handleAddToBankHashtag} />
          </div>
        ))}

        {/* Add new hashtag bank */}
        {addingBankFor === 'hashtags' ? (
          <div className="flex gap-2 items-center">
            <input
              autoFocus
              className="flex-1 rounded-md border border-solid border-indigo-500/30 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
              placeholder="Bank name..."
              value={newBankName}
              onChange={e => setNewBankName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateBank('hashtags'); if (e.key === 'Escape') { setAddingBankFor(null); setNewBankName(''); } }}
            />
            <Button variant="brand-primary" size="small" onClick={() => handleCreateBank('hashtags')}>Create</Button>
            <button className="text-neutral-500 hover:text-neutral-300 bg-transparent border-none cursor-pointer text-xs" onClick={() => { setAddingBankFor(null); setNewBankName(''); }}>Cancel</button>
          </div>
        ) : (
          <button
            className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer p-0"
            onClick={() => setAddingBankFor('hashtags')}
          >
            <FeatherPlus style={{ width: 12, height: 12 }} /> New Bank
          </button>
        )}

        <div className="flex w-full gap-2 items-end">
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center gap-1">
              <button onClick={() => setHashtagAddTier('always')} className={`border-none cursor-pointer px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all ${hashtagAddTier === 'always' ? 'bg-green-500/20 text-green-400' : 'bg-transparent text-neutral-600'}`}>Always On</button>
              <button onClick={() => setHashtagAddTier('pool')} className={`border-none cursor-pointer px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all ${hashtagAddTier === 'pool' ? 'bg-neutral-200 text-neutral-300' : 'bg-transparent text-neutral-600'}`}>Pool</button>
            </div>
            <input
              className="rounded-md border border-solid border-neutral-200 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
              placeholder={`#hashtag → ${hashtagAddTier === 'always' ? 'always-on' : 'pool'}`}
              value={newHashtag}
              onChange={e => setNewHashtag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddHashtag(); }}
            />
          </div>
          <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add hashtag" onClick={handleAddHashtag} />
        </div>
      </div>

      {/* Platform Rules Section */}
      <div className="flex w-full flex-col gap-3 rounded-lg border border-solid border-neutral-200 bg-[#111111] p-5">
        <button
          className="flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 w-full"
          onClick={() => setShowPlatformRules(!showPlatformRules)}
        >
          <FeatherHash className="text-neutral-400" style={{ width: 14, height: 14 }} />
          <span className="text-body-bold font-body-bold text-[#ffffffff]">Platform Rules</span>
          <Badge variant="neutral">{Object.values(platformOnly).flat().length + Object.values(platformExclude).flat().length}</Badge>
          <span className="ml-auto text-neutral-500 text-xs">{showPlatformRules ? '▲' : '▼'}</span>
        </button>

        {showPlatformRules && (
          <div className="flex flex-col gap-4 mt-2">
            {connectedPlatforms.map(platform => {
              const platTags = platformOnly[platform] || [];
              const platExcludes = platformExclude[platform] || [];
              return (
                <div key={platform} className="flex flex-col gap-2 rounded-md p-3" style={{ border: `1px solid ${PLATFORM_COLORS_MAP[platform]}30` }}>
                  <span className="text-[12px] font-semibold" style={{ color: PLATFORM_COLORS_MAP[platform] }}>{PLATFORM_NAMES[platform]}</span>

                  {/* Platform-only tags */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Only for {PLATFORM_NAMES[platform]}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {platTags.map((tag, idx) => (
                        <div key={idx} className="flex items-center gap-1 rounded-full px-2 py-0.5 group" style={{ backgroundColor: `${PLATFORM_COLORS_MAP[platform]}15`, border: `1px solid ${PLATFORM_COLORS_MAP[platform]}40` }}>
                          <span className="text-caption font-caption" style={{ color: PLATFORM_COLORS_MAP[platform] }}>{tag}</span>
                          <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100" onClick={() => handleRemovePlatformTag(platform, idx)}>
                            <FeatherX style={{ width: 9, height: 9 }} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        className="flex-1 rounded-md border border-solid border-neutral-200 bg-black px-2 py-1 text-caption font-caption text-white outline-none placeholder-neutral-500"
                        placeholder={`#${platform} tag...`}
                        value={newPlatformTag[platform] || ''}
                        onChange={e => setNewPlatformTag(prev => ({ ...prev, [platform]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddPlatformTag(platform); }}
                      />
                      <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label={`Add ${PLATFORM_NAMES[platform]} tag`} onClick={() => handleAddPlatformTag(platform)} />
                    </div>
                  </div>

                  {/* Excluded from this platform */}
                  {hashtags.always.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Exclude from {PLATFORM_NAMES[platform]}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {hashtags.always.map((tag, idx) => {
                          const isExcluded = platExcludes.includes(tag);
                          return (
                            <button
                              key={idx}
                              className={`rounded-full px-2 py-0.5 text-caption font-caption border cursor-pointer transition-all ${isExcluded ? 'bg-red-500/10 border-red-500/30 text-red-400 line-through' : 'bg-transparent border-neutral-200 text-neutral-500'}`}
                              onClick={() => handleToggleExclude(platform, tag)}
                              title={isExcluded ? 'Click to include' : 'Click to exclude'}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {allCaptions.length === 0 && allHashtags.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 w-full text-neutral-500">
          <FeatherMessageSquare style={{ width: 28, height: 28 }} />
          <p className="mt-3 text-body font-body">Add your first caption or hashtag above</p>
        </div>
      )}
    </div>
  );
};

export default ProjectWorkspace;
