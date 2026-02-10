/**
 * StudioHome - New Library-based Studio Home
 *
 * Replaces AestheticHome with unified Library/Collections system
 * Features:
 * - First-time onboarding with templates
 * - Unified media library
 * - User and smart collections
 * - Mode selection (videos/slideshows)
 * - Audio-optional workflow
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useIsMobile from '../../hooks/useIsMobile';
// OnboardingModal removed - auto-setup happens in VideoStudio
import { useTheme } from '../../contexts/ThemeContext';
import LibraryBrowser from './LibraryBrowser';
import CollectionPicker from './CollectionPicker';
import AudioClipSelector from './AudioClipSelector';
import LyricBank from './LyricBank';
import CloudImportButton from './CloudImportButton';
import { useToast, ConfirmDialog } from '../ui';
import {
  getLibrary,
  getCollections,
  getUserCollections,
  getCollectionMedia,
  addToLibrary,
  addManyToLibrary,
  getCreatedContent,
  addCreatedVideo,
  addCreatedSlideshow,
  saveCreatedContentAsync,
  getLyrics,
  addLyrics,
  updateLyrics,
  deleteLyrics,
  subscribeToLyrics,
  addLyricsAsync,
  updateLyricsAsync,
  deleteLyricsAsync,
  getOnboardingStatus,
  incrementUseCount,
  addToCollectionAsync,
  saveCollectionToFirestore,
  MEDIA_TYPES,
  STARTER_TEMPLATES,
  // Firestore async functions
  subscribeToLibrary,
  subscribeToCollections,
  addToLibraryAsync,
  addManyToLibraryAsync,
  removeFromLibraryAsync,
  updateLibraryItemAsync,
  migrateToFirestore,
  migrateThumbnails,
  migrateVideoThumbnails,
  // Dynamic bank system
  migrateCollectionBanks,
  getBankColor,
  getBankLabel,
  addBankToCollection,
  MAX_BANKS,
  // Created content subscription
  subscribeToCreatedContent
} from '../../services/libraryService';
import { uploadFile, getMediaDuration } from '../../services/firebaseStorage';
import log from '../../utils/logger';

const StudioHome = ({
  db = null, // Firestore instance for cross-device sync
  artistId,
  artists = [],
  // Mode control (lifted to parent for breadcrumb)
  studioMode,
  onSetStudioMode,
  // Actions - passed to editor
  onMakeVideo,
  onMakeSlideshow,
  onViewContent,
  onShowBatchPipeline,
  // Lyrics handlers
  onAddLyrics: externalAddLyrics,
  onUpdateLyrics: externalUpdateLyrics,
  onDeleteLyrics: externalDeleteLyrics,
  onViewScheduling,
  // Wave 5: Google Drive integration
  onImportFromDrive,
  onExportToDrive,
  driveConnected = false
}) => {
  const { theme } = useTheme();

  // UI State
  const { isMobile } = useIsMobile();
  const [activeTab, setActiveTab] = useState('media'); // kept for compat
  const [sidebarSection, setSidebarSection] = useState({ audio: true, lyrics: false, banks: false });
  const [mobileSidebarTab, setMobileSidebarTab] = useState('audio'); // 'audio' | 'lyrics' | 'banks'
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [selectedBanks, setSelectedBanks] = useState(new Set([0, 1])); // indices of selected banks

  // Reset collection selection when switching modes (video→slideshow etc.)
  // A collection selected in video mode may have no images, causing empty/confusing state
  useEffect(() => {
    setSelectedCollection(null);
  }, [studioMode]);

  // Library State
  const [library, setLibrary] = useState([]);
  const [collections, setCollections] = useState([]);
  const [lyrics, setLyrics] = useState([]);
  const [createdContent, setCreatedContent] = useState({ videos: [], slideshows: [] });

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [libraryRefreshTrigger, setLibraryRefreshTrigger] = useState(0);

  // Toast for non-blocking feedback (H-02: replaces alert())
  const { success: toastSuccess, error: toastError } = useToast();

  // Confirm dialog state (H-01: replaces window.confirm())
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null, confirmVariant: 'default' });

  // Upload cancellation
  const cancelFunctionsRef = useRef([]);

  // Drag-and-drop from OS
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Prevent browser from opening dropped files in new tabs (must be document-level)
  useEffect(() => {
    const preventFileOpen = (e) => { e.preventDefault(); };
    document.addEventListener('dragover', preventFileOpen);
    document.addEventListener('drop', preventFileOpen);
    return () => {
      document.removeEventListener('dragover', preventFileOpen);
      document.removeEventListener('drop', preventFileOpen);
    };
  }, []);

  // Thumbnail migration ref (run once per session)
  const thumbMigrationRef = useRef(false);

  // H-07: Track blob URLs for cleanup on unmount
  const blobUrlsRef = useRef([]);
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      });
    };
  }, []);

  // Audio clip selector
  const [pendingAudio, setPendingAudio] = useState(null);
  const [editingAudio, setEditingAudio] = useState(null); // { id, name } - for inline editing audio bank items
  const [trimmingAudio, setTrimmingAudio] = useState(null); // library audio item being re-trimmed
  const [audioDropdownId, setAudioDropdownId] = useState(null); // which audio item has collection dropdown open
  const [playingAudioId, setPlayingAudioId] = useState(null); // inline audio preview
  const inlineAudioRef = useRef(null);

  // Selected media for editor
  const [selectedMedia, setSelectedMedia] = useState({
    videos: [],
    audio: null,
    images: []
  });

  // Delete selected media from library
  const handleDeleteSelected = useCallback((mediaType) => {
    const items = mediaType === 'videos' ? selectedMedia.videos : selectedMedia.images;
    if (items.length === 0) return;
    const label = mediaType === 'videos' ? 'clip' : 'image';
    setConfirmDialog({
      isOpen: true,
      title: `Delete ${items.length} ${label}${items.length > 1 ? 's' : ''}?`,
      message: 'This will permanently remove them from your library. This cannot be undone.',
      confirmVariant: 'destructive',
      onConfirm: async () => {
        for (const item of items) {
          await removeFromLibraryAsync(db, artistId, item.id);
        }
        setSelectedMedia(prev => ({ ...prev, [mediaType]: [] }));
        setLibraryRefreshTrigger(t => t + 1);
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  }, [selectedMedia, db, artistId]);

  const handleDeleteAll = useCallback((mediaType) => {
    const label = mediaType === 'videos' ? 'video clips' : 'images';
    setConfirmDialog({
      isOpen: true,
      title: `Delete ALL ${label}?`,
      message: 'This will permanently remove all items from your library. This cannot be undone.',
      confirmVariant: 'destructive',
      onConfirm: async () => {
        const allItems = library.filter(item =>
          mediaType === 'videos' ? item.type === 'video' : item.type === 'image'
        );
        for (const item of allItems) {
          await removeFromLibraryAsync(db, artistId, item.id);
        }
        setSelectedMedia(prev => ({ ...prev, [mediaType]: [] }));
        setLibraryRefreshTrigger(t => t + 1);
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  }, [library, db, artistId]);

  // File input refs
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const imageInputRef = useRef(null);

  // Batch generate state
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchCount, setBatchCount] = useState(10);
  const [batchAudio, setBatchAudio] = useState(null);
  const [batchSlidesPerShow, setBatchSlidesPerShow] = useState(2);
  const [batchGenerating, setBatchGenerating] = useState(false);

  // Load data when artist changes - use Firestore subscription if available
  useEffect(() => {
    if (!artistId) return;

    // Load non-library data from localStorage as initial state
    setCollections(getCollections(artistId));
    setLyrics(getLyrics(artistId)); // immediate local fallback
    setCreatedContent(getCreatedContent(artistId));

    const unsubscribes = [];

    // Subscribe to Firestore lyrics real-time sync (auto-migrates localStorage → Firestore)
    if (db) {
      const unsubLyrics = subscribeToLyrics(db, artistId, (firestoreLyrics) => {
        setLyrics(firestoreLyrics);
      });
      unsubscribes.push(unsubLyrics);

      // Subscribe to created content for real-time draft count updates
      const unsubCreated = subscribeToCreatedContent(db, artistId, (content) => {
        setCreatedContent(content);
      });
      unsubscribes.push(unsubCreated);
    }

    // For library + collections, use Firestore real-time subscription if db is available
    if (db) {
      log('[StudioHome] Setting up Firestore subscriptions for library + collections');

      // Try to migrate localStorage data to Firestore (one-time)
      const migrationKey = `stm_migrated_${artistId}`;
      if (!localStorage.getItem(migrationKey)) {
        migrateToFirestore(db, artistId).then(result => {
          if (result.success) {
            localStorage.setItem(migrationKey, 'true');
            log('[StudioHome] Migration complete:', result.migrated);
          }
        });
      }

      // Build thumbnail cache from localStorage for merge
      const cachedLib = getLibrary(artistId);
      const thumbCache = new Map();
      cachedLib.forEach(item => {
        if (item.thumbnailUrl) thumbCache.set(item.id, item.thumbnailUrl);
      });

      // Subscribe to real-time library updates with thumbnail merge
      unsubscribes.push(subscribeToLibrary(db, artistId, (items) => {
        const merged = items.map(item => {
          if (!item.thumbnailUrl && thumbCache.has(item.id)) {
            return { ...item, thumbnailUrl: thumbCache.get(item.id) };
          }
          if (item.thumbnailUrl) thumbCache.set(item.id, item.thumbnailUrl);
          return item;
        });
        setLibrary(merged);
      }));

      // Subscribe to real-time collection updates
      unsubscribes.push(subscribeToCollections(db, artistId, (cols) => {
        log('[StudioHome] Firestore collections sync:', cols.length, 'collections');
        setCollections(cols);
      }));
    } else {
      // Fallback to localStorage
      log('[StudioHome] Using localStorage (no db available)');
      setLibrary(getLibrary(artistId));
    }

    return () => unsubscribes.forEach(unsub => unsub());
  }, [db, artistId]);

  // Diagnostic logging on mount
  useEffect(() => {
    log('[StudioHome] Component mounted');
    log('[StudioHome] artistId:', artistId);
    log('[StudioHome] db available:', !!db);

    if (!artistId) {
      console.warn('[StudioHome] WARNING: No artistId provided - uploads will fail!');
    }
  }, [artistId, db]);

  const loadData = useCallback(() => {
    setLibrary(getLibrary(artistId));
    setCollections(getCollections(artistId));
    setLyrics(getLyrics(artistId));
    setCreatedContent(getCreatedContent(artistId));
  }, [artistId]);

  // No longer auto-select a collection — default to All Media on load.
  // Users can pick a collection from the CollectionPicker dropdown.

  // Background thumbnail migration for existing images
  // THUMB_VERSION: bump this to force re-migration (e.g. after changing thumbnail size)
  useEffect(() => {
    const THUMB_VERSION = 2; // v2 = 150px @ 0.5 quality (was v1 = 300px @ 0.7)
    if (thumbMigrationRef.current || !artistId) return;
    if (library.length === 0) return;

    const versionKey = `stm_thumb_v${THUMB_VERSION}_${artistId}`;
    const alreadyDone = localStorage.getItem(versionKey);
    if (alreadyDone) return;

    const imageItems = library.filter(item => item.type === 'image' && item.url);
    if (imageItems.length === 0) return;
    thumbMigrationRef.current = true;

    log(`[ThumbnailMigration] v${THUMB_VERSION}: ${imageItems.length} images to process`);

    // Run in background after a short delay so it doesn't block initial render
    const timer = setTimeout(async () => {
      try {
        const result = await migrateThumbnails(db, artistId, library, uploadFile, (done, total, generated) => {
          if (done % 10 === 0 || done === total) {
            setLibraryRefreshTrigger(prev => prev + 1);
          }
        });
        log(`[ThumbnailMigration] v${THUMB_VERSION} complete: ${result.generated} generated, ${result.failed} failed`);
        localStorage.setItem(versionKey, Date.now().toString());
        if (result.generated > 0) {
          setLibraryRefreshTrigger(prev => prev + 1);
        }
      } catch (err) {
        console.warn('[StudioHome] Thumbnail migration error:', err);
      }
    }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line
  }, [library, artistId]);

  // Background thumbnail migration for existing videos (same pattern as images)
  const videoThumbMigrationRef = useRef(false);
  useEffect(() => {
    const VID_THUMB_VERSION = 1; // v1 = 150px @ 0.5 quality
    if (videoThumbMigrationRef.current || !artistId) return;
    if (library.length === 0) return;

    const versionKey = `stm_vidthumb_v${VID_THUMB_VERSION}_${artistId}`;
    const alreadyDone = localStorage.getItem(versionKey);
    if (alreadyDone) return;

    const videoItems = library.filter(item => item.type === 'video' && item.url && !item.thumbnailUrl);
    if (videoItems.length === 0) {
      localStorage.setItem(versionKey, Date.now().toString());
      return;
    }
    videoThumbMigrationRef.current = true;

    log(`[VideoThumbMigration] v${VID_THUMB_VERSION}: ${videoItems.length} videos to process`);

    const timer = setTimeout(async () => {
      try {
        const result = await migrateVideoThumbnails(db, artistId, library, uploadFile, (done, total, generated) => {
          if (done % 5 === 0 || done === total) {
            setLibraryRefreshTrigger(prev => prev + 1);
          }
        });
        log(`[VideoThumbMigration] v${VID_THUMB_VERSION} complete: ${result.generated} generated, ${result.failed} failed`);
        localStorage.setItem(versionKey, Date.now().toString());
        if (result.generated > 0) {
          setLibraryRefreshTrigger(prev => prev + 1);
        }
      } catch (err) {
        console.warn('[StudioHome] Video thumbnail migration error:', err);
      }
    }, 4000); // Start after image migration has a head start
    return () => clearTimeout(timer);
  // eslint-disable-next-line
  }, [library, artistId]);

  // =====================
  // UPLOAD HANDLERS
  // =====================

  const handleFileUpload = async (files, type) => {
    if (!files.length) return;

    log('[StudioHome] Starting upload for', files.length, 'files, artistId:', artistId, 'type:', type);

    if (!artistId) {
      console.error('[StudioHome] No artistId - cannot save to library');
      toastError('No artist selected. Please select an artist first.');
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length, percent: 0 });
    cancelFunctionsRef.current = [];

    const uploadedItems = [];
    const failedFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const basePercent = (i / files.length) * 100;
      setUploadProgress({ current: i + 1, total: files.length, name: file.name, percent: Math.round(basePercent) });

      try {
        log('[StudioHome] Uploading file:', file.name, 'size:', file.size, 'type:', file.type);

        // Upload to Firebase with progress tracking
        const folder = type === MEDIA_TYPES.VIDEO ? 'videos'
          : type === MEDIA_TYPES.IMAGE ? 'images' : 'audio';
        log('[StudioHome] Calling uploadFile to folder:', folder);
        const { url, path } = await uploadFile(file, folder, (filePercent) => {
          const overall = Math.round(basePercent + (filePercent / files.length));
          setUploadProgress(prev => ({ ...prev, percent: Math.min(overall, 99) }));
        }, {
          onCancel: (cancelFn) => {
            cancelFunctionsRef.current.push(cancelFn);
          }
        });
        log('[StudioHome] Upload successful! URL:', url?.substring(0, 50) + '...');

        // Get metadata
        let duration = null;
        let width = null;
        let height = null;
        let hasEmbeddedAudio = false;

        const localUrl = URL.createObjectURL(file);

        if (type === MEDIA_TYPES.VIDEO || type === MEDIA_TYPES.AUDIO) {
          try {
            duration = await getMediaDuration(localUrl, type === MEDIA_TYPES.VIDEO ? 'video' : 'audio');
          } catch (e) {
            console.warn('Could not get duration:', e);
          }
        }

        if (type === MEDIA_TYPES.VIDEO) {
          // Extract video metadata (dimensions)
          const metaVideo = document.createElement('video');
          metaVideo.src = localUrl;
          await new Promise(r => { metaVideo.onloadedmetadata = r; });
          width = metaVideo.videoWidth;
          height = metaVideo.videoHeight;
          hasEmbeddedAudio = true; // Assume true, can't reliably detect
        }

        let thumbnailUrl = null;

        // Generate thumbnail from video frame (seek to 1s or 25% of duration)
        if (type === MEDIA_TYPES.VIDEO) {
          try {
            const video = document.createElement('video');
            video.src = localUrl;
            video.crossOrigin = 'anonymous';
            video.muted = true;
            await new Promise((resolve, reject) => {
              video.onloadeddata = resolve;
              video.onerror = reject;
              // Fallback timeout in case onloadeddata never fires
              setTimeout(resolve, 5000);
            });
            const seekTime = Math.min(1, (video.duration || 2) * 0.25);
            video.currentTime = seekTime;
            await new Promise(r => { video.onseeked = r; });

            const maxThumbSize = 150;
            const scale = Math.min(1, maxThumbSize / Math.max(video.videoWidth, video.videoHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const thumbBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.5));
            if (thumbBlob) {
              const thumbFile = new File([thumbBlob], `thumb_${file.name}.jpg`, { type: 'image/jpeg' });
              const thumbResult = await uploadFile(thumbFile, 'thumbnails');
              thumbnailUrl = thumbResult.url;
            }
          } catch (thumbErr) {
            console.warn('[StudioHome] Video thumbnail generation failed:', thumbErr);
          }
        }

        if (type === MEDIA_TYPES.IMAGE) {
          const img = new Image();
          img.src = localUrl;
          await new Promise(r => { img.onload = r; });
          width = img.naturalWidth;
          height = img.naturalHeight;

          // Generate lightweight thumbnail for grid/library views
          try {
            const maxThumbSize = 150;
            const scale = Math.min(1, maxThumbSize / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const thumbBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.5));
            if (thumbBlob) {
              const thumbFile = new File([thumbBlob], `thumb_${file.name}`, { type: 'image/jpeg' });
              const thumbResult = await uploadFile(thumbFile, 'thumbnails');
              thumbnailUrl = thumbResult.url;
            }
          } catch (thumbErr) {
            console.warn('[StudioHome] Thumbnail generation failed:', thumbErr);
          }
        }

        const item = {
          type,
          name: file.name,
          url,
          thumbnailUrl,
          storagePath: path,
          duration,
          width,
          height,
          hasEmbeddedAudio,
          metadata: {
            fileSize: file.size,
            mimeType: file.type
          }
        };

        // Add to selected collection if one is selected
        if (selectedCollection) {
          item.collectionIds = [selectedCollection];
        }

        uploadedItems.push(item);

        // Keep local URL for current session (revoked on unmount via blobUrlsRef)
        item.localUrl = localUrl;
        blobUrlsRef.current.push(localUrl);

      } catch (error) {
        console.error('[StudioHome] Upload FAILED for:', file.name, 'Error:', error.message);
        failedFiles.push({ name: file.name, error: error.message });
      }
    }

    if (uploadedItems.length > 0) {
      log('[StudioHome] Adding', uploadedItems.length, 'items to library for artist:', artistId);
      try {
        // Use async Firestore function if db is available
        const added = await addManyToLibraryAsync(db, artistId, uploadedItems);
        log('[StudioHome] Successfully added to library:', added.length, 'items');

        // Also add items to the selected collection if one is active
        if (selectedCollection && added.length > 0) {
          const addedIds = added.map(item => item.id);
          addToCollectionAsync(db, artistId, selectedCollection, addedIds);
        }

        // Note: If using Firestore subscription, library will auto-update via onSnapshot
        if (!db) loadData(); // Only reload from localStorage if no Firestore
        // Trigger LibraryBrowser refresh
        setLibraryRefreshTrigger(prev => prev + 1);
      } catch (saveError) {
        console.error('[StudioHome] Failed to save to library:', saveError);
        toastError('Files uploaded but failed to save to library: ' + saveError.message);
      }
    }

    // Show feedback about what happened
    if (failedFiles.length > 0) {
      const failedNames = failedFiles.map(f => f.name).join(', ');
      toastError(`Upload failed for: ${failedNames} — ${failedFiles[0].error}`);
    } else if (uploadedItems.length === 0) {
      console.error('[StudioHome] No items were successfully uploaded');
      toastError('No files were uploaded. Check if Firebase is configured correctly.');
    } else {
      log('[StudioHome] Upload complete!', uploadedItems.length, 'files added to library');
    }

    setUploadProgress(prev => ({ ...prev, percent: 100 }));
    setTimeout(() => {
      setIsUploading(false);
      setUploadProgress({ current: 0, total: 0, percent: 0 });
    }, 400);
  };

  const handleVideoUpload = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    handleFileUpload(files, MEDIA_TYPES.VIDEO);
  };

  // Inline audio preview play/stop
  const handleInlinePlay = useCallback((audioItem) => {
    if (playingAudioId === audioItem.id) {
      // Stop
      if (inlineAudioRef.current) { inlineAudioRef.current.pause(); inlineAudioRef.current = null; }
      setPlayingAudioId(null);
      return;
    }
    // Stop any currently playing
    if (inlineAudioRef.current) { inlineAudioRef.current.pause(); }
    const el = new Audio(audioItem.url || audioItem.localUrl);
    el.currentTime = audioItem.startTime || 0;
    el.onended = () => setPlayingAudioId(null);
    el.ontimeupdate = () => {
      if (audioItem.endTime && el.currentTime >= audioItem.endTime) {
        el.pause(); setPlayingAudioId(null);
      }
    };
    el.play().catch(() => {});
    inlineAudioRef.current = el;
    setPlayingAudioId(audioItem.id);
  }, [playingAudioId]);

  // Cleanup inline audio on unmount
  useEffect(() => {
    return () => { if (inlineAudioRef.current) { inlineAudioRef.current.pause(); } };
  }, []);

  const handleAudioUpload = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      const file = files[0];
      const url = URL.createObjectURL(file);
      setPendingAudio({ file, url, name: file.name });
    }
    e.target.value = '';
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    handleFileUpload(files, MEDIA_TYPES.IMAGE);
  };

  // ── Drag-and-drop from OS (Finder / Explorer) ──
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer.types.includes('Files')) return;
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    if (studioMode === 'videos') {
      const videoFiles = files.filter(f => f.type.startsWith('video/'));
      if (videoFiles.length > 0) handleFileUpload(videoFiles, MEDIA_TYPES.VIDEO);
    } else if (studioMode === 'slideshows') {
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) handleFileUpload(imageFiles, MEDIA_TYPES.IMAGE);
    } else if (studioMode === 'audio') {
      const audioFiles = files.filter(f => f.type.startsWith('audio/'));
      if (audioFiles.length > 0) handleFileUpload(audioFiles, MEDIA_TYPES.AUDIO);
    }
  };

  // Helper function to format time mm:ss
  const formatTime = (seconds) => {
    if (!seconds || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  // Audio clip handling
  const handleClipSave = async (clipData) => {
    log('[StudioHome] handleClipSave called with clipData:', clipData);

    if (!pendingAudio) {
      console.error('[StudioHome] No pendingAudio - cannot save');
      return;
    }

    if (!artistId) {
      console.error('[StudioHome] No artistId - cannot save audio clip');
      toastError('No artist selected. Please select an artist first.');
      return;
    }

    // Calculate duration from start/end if not provided directly
    const calculatedDuration = clipData.duration || (clipData.endTime - clipData.startTime);
    log('[StudioHome] Audio duration:', {
      provided: clipData.duration,
      calculated: calculatedDuration,
      startTime: clipData.startTime,
      endTime: clipData.endTime
    });

    if (!calculatedDuration || calculatedDuration < 1) {
      console.error('[StudioHome] Invalid or too short duration:', calculatedDuration, 'clipData:', JSON.stringify(clipData));
      toastError('Audio duration is invalid or too short (must be at least 1 second).');
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 1, total: 1, name: pendingAudio.name, percent: 0 });
    cancelFunctionsRef.current = [];

    try {
      const { url, path } = await uploadFile(pendingAudio.file, 'audio', (pct) => {
        setUploadProgress(prev => ({ ...prev, percent: Math.min(Math.round(pct), 99) }));
      }, {
        onCancel: (cancelFn) => {
          cancelFunctionsRef.current.push(cancelFn);
        }
      });
      log('[StudioHome] Audio uploaded to Firebase:', url?.substring(0, 50) + '...');

      // Create a descriptive name for the trimmed clip
      const clipName = `${pendingAudio.name} (${formatTime(clipData.startTime)}-${formatTime(clipData.endTime)})`;

      const audioItem = {
        type: MEDIA_TYPES.AUDIO,
        name: clipName,
        url,
        storagePath: path,
        duration: calculatedDuration,
        metadata: {
          trimStart: clipData.startTime,
          trimEnd: clipData.endTime,
          fullDuration: clipData.fullDuration || clipData.endTime,
          originalName: pendingAudio.name,
          originalMediaId: null // Will be set if this is based on an existing library item
        }
      };

      log('[StudioHome] Saving audio item with duration:', audioItem.duration);

      if (selectedCollection) {
        audioItem.collectionIds = [selectedCollection];
      }

      // Use async Firestore function if db is available
      const added = await addToLibraryAsync(db, artistId, audioItem);
      log('[StudioHome] Audio saved to library:', added);

      // Add to collection if one is selected
      if (selectedCollection && added) {
        const addedId = added.id || added[0]?.id;
        if (addedId) {
          addToCollectionAsync(db, artistId, selectedCollection, [addedId]);
        }
      }

      if (!db) loadData(); // Only reload from localStorage if no Firestore
      setLibraryRefreshTrigger(prev => prev + 1);

    } catch (error) {
      console.error('[StudioHome] Audio upload failed:', error);
      toastError('Audio upload failed: ' + error.message);
    }

    setPendingAudio(null);
    setUploadProgress(prev => ({ ...prev, percent: 100 }));
    setTimeout(() => {
      setIsUploading(false);
      setUploadProgress({ current: 0, total: 0, percent: 0 });
    }, 400);
  };

  const handleClipCancel = () => {
    if (pendingAudio?.url) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
  };

  // Re-trim existing audio from library → save trimmed version as new item
  const handleRetrimSave = async (clipData) => {
    if (!trimmingAudio || !artistId) return;

    const fileToUpload = clipData.trimmedFile;
    if (!fileToUpload) {
      // Fallback: no actual trim happened (user used full range)
      setTrimmingAudio(null);
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 1, total: 1, name: clipData.trimmedName || 'Trimmed audio', percent: 0 });
    cancelFunctionsRef.current = [];

    try {
      const { url, path } = await uploadFile(fileToUpload, 'audio', (pct) => {
        setUploadProgress(prev => ({ ...prev, percent: Math.min(Math.round(pct), 99) }));
      }, {
        onCancel: (cancelFn) => {
          cancelFunctionsRef.current.push(cancelFn);
        }
      });

      const audioItem = {
        type: MEDIA_TYPES.AUDIO,
        name: clipData.trimmedName || `${trimmingAudio.name} (trimmed)`,
        url,
        storagePath: path,
        duration: clipData.duration || (clipData.endTime - clipData.startTime),
        metadata: {
          trimStart: clipData.startTime || 0,
          trimEnd: clipData.endTime || clipData.duration,
          originalName: trimmingAudio.name,
          originalMediaId: trimmingAudio.id
        }
      };

      if (selectedCollection) {
        audioItem.collectionIds = [selectedCollection];
      }

      await addToLibraryAsync(db, artistId, audioItem);
      setLibraryRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error('[StudioHome] Retrim upload failed:', error);
      toastError('Audio trim failed: ' + error.message);
    }

    setTrimmingAudio(null);
    setUploadProgress(prev => ({ ...prev, percent: 100 }));
    setTimeout(() => {
      setIsUploading(false);
      setUploadProgress({ current: 0, total: 0, percent: 0 });
    }, 400);
  };

  const handleCancelUpload = () => {
    log('[StudioHome] Cancelling all active uploads');
    // Call all accumulated cancel functions
    cancelFunctionsRef.current.forEach(cancelFn => {
      try {
        cancelFn();
      } catch (error) {
        console.error('[StudioHome] Error cancelling upload:', error);
      }
    });
    cancelFunctionsRef.current = [];
    setIsUploading(false);
    setUploadProgress({ current: 0, total: 0 });
  };

  // =====================
  // MEDIA SELECTION
  // =====================

  // macOS-style selection handler:
  // - exclusive: true → select only this item (single click)
  // - replaceAll: [...] → replace entire selection (shift+click range, lasso drag)
  // - no options → toggle (Cmd/Ctrl+click)
  const handleSelectMedia = (media, options = {}) => {
    const { exclusive = false, replaceAll = null } = options;

    if (media.type === MEDIA_TYPES.VIDEO) {
      if (replaceAll) {
        // Lasso drag or shift+click range: replace entire selection
        setSelectedMedia(prev => ({ ...prev, videos: replaceAll }));
      } else if (exclusive) {
        // Single click: select only this one
        setSelectedMedia(prev => ({ ...prev, videos: [media] }));
      } else {
        // Cmd/Ctrl+click: toggle in/out
        setSelectedMedia(prev => {
          const isSelected = prev.videos.some(v => v.id === media.id);
          return {
            ...prev,
            videos: isSelected
              ? prev.videos.filter(v => v.id !== media.id)
              : [...prev.videos, media]
          };
        });
      }
    } else if (media.type === MEDIA_TYPES.AUDIO) {
      // Audio is always single-select toggle
      setSelectedMedia(prev => ({
        ...prev,
        audio: prev.audio?.id === media.id ? null : media
      }));
    } else if (media.type === MEDIA_TYPES.IMAGE) {
      if (replaceAll) {
        setSelectedMedia(prev => ({ ...prev, images: replaceAll }));
      } else if (exclusive) {
        setSelectedMedia(prev => ({ ...prev, images: [media] }));
      } else {
        // Cmd/Ctrl+click: toggle in/out
        setSelectedMedia(prev => {
          const isSelected = prev.images.some(i => i.id === media.id);
          return {
            ...prev,
            images: isSelected
              ? prev.images.filter(i => i.id !== media.id)
              : [...prev.images, media]
          };
        });
      }
    }

    // Increment use count (skip for bulk operations)
    if (!replaceAll) {
      incrementUseCount(artistId, media.id);
    }
  };

  // =====================
  // LYRICS HANDLERS
  // =====================

  const handleAddLyrics = async (lyricsData) => {
    // Auto-tag new lyrics with current collection if one is selected
    const dataWithCollection = selectedCollection
      ? { ...lyricsData, collectionIds: [...(lyricsData.collectionIds || []), selectedCollection] }
      : lyricsData;
    // Dual-write: localStorage (immediate) + Firestore (async)
    const newLyrics = await addLyricsAsync(db, artistId, dataWithCollection);
    // No need to loadData() — Firestore subscription will push the update
    if (!db) loadData(); // fallback for no-Firestore case
    if (externalAddLyrics) externalAddLyrics(dataWithCollection);
    return newLyrics;
  };

  const handleUpdateLyrics = async (lyricsId, updates) => {
    await updateLyricsAsync(db, artistId, lyricsId, updates);
    if (!db) loadData();
    if (externalUpdateLyrics) externalUpdateLyrics(lyricsId, updates);
  };

  const handleDeleteLyrics = async (lyricsId) => {
    await deleteLyricsAsync(db, artistId, lyricsId);
    if (!db) loadData();
    if (externalDeleteLyrics) externalDeleteLyrics(lyricsId);
  };

  // =====================
  // EDITOR LAUNCH
  // =====================

  const handleLaunchVideoEditor = (existingVideo = null) => {
    // When a collection is selected, auto-populate with ALL collection clips
    let videosForEditor = selectedMedia.videos;
    let audioForEditor = selectedMedia.audio;
    let lyricsForEditor = [];

    if (selectedCollection) {
      const col = collections.find(c => c.id === selectedCollection);
      if (col) {
        // Get all media in this collection
        const colMedia = getCollectionMedia(artistId, selectedCollection);
        const colVideos = colMedia.filter(m => m.type === MEDIA_TYPES.VIDEO);
        const colAudioItems = colMedia.filter(m => m.type === MEDIA_TYPES.AUDIO);

        // Use all collection videos if user hasn't manually selected any
        if (videosForEditor.length === 0 && colVideos.length > 0) {
          videosForEditor = colVideos;
        }

        // Use first collection audio if user hasn't manually selected one
        if (!audioForEditor && colAudioItems.length > 0) {
          audioForEditor = colAudioItems[0];
        }

        // Get lyrics associated with this collection
        lyricsForEditor = lyrics.filter(l =>
          (l.collectionIds || []).includes(selectedCollection)
        );
      }
    }

    // Mark media as used
    videosForEditor.forEach(v => incrementUseCount(artistId, v.id));
    if (audioForEditor) incrementUseCount(artistId, audioForEditor.id);

    // Pass media to editor
    if (onMakeVideo) {
      onMakeVideo({
        existingVideo,
        libraryVideos: videosForEditor,
        libraryAudio: audioForEditor,
        libraryLyrics: lyricsForEditor,
        pullFromCollection: selectedCollection
      });
    }
  };

  const handleLaunchSlideshowEditor = (existingSlideshow = null) => {
    let imagesForEditor = selectedMedia.images;
    let audioForEditor = selectedMedia.audio;
    let lyricsForEditor = [];

    if (selectedCollection) {
      const col = collections.find(c => c.id === selectedCollection);
      const colMedia = getCollectionMedia(artistId, selectedCollection);
      const colImages = colMedia.filter(m => m.type === MEDIA_TYPES.IMAGE);
      const colAudioItems = colMedia.filter(m => m.type === MEDIA_TYPES.AUDIO);

      // Use bank images (not all collection images) for slideshow initialization
      if (imagesForEditor.length === 0 && col) {
        const migrated = migrateCollectionBanks(col);
        const bankImages = (migrated.banks || []).map(bankIds =>
          colImages.find(img => (bankIds || []).includes(img.id))
        ).filter(Boolean);
        imagesForEditor = bankImages.length > 0 ? bankImages : colImages.slice(0, 2);
      }
      if (!audioForEditor && colAudioItems.length > 0) {
        audioForEditor = colAudioItems[0];
      }

      // Get lyrics associated with this collection
      lyricsForEditor = lyrics.filter(l =>
        (l.collectionIds || []).includes(selectedCollection)
      );
    }

    // Mark images as used
    imagesForEditor.forEach(i => incrementUseCount(artistId, i.id));

    if (onMakeSlideshow) {
      onMakeSlideshow({
        existingSlideshow,
        libraryImages: imagesForEditor,
        libraryAudio: audioForEditor,
        libraryLyrics: lyricsForEditor,
        pullFromCollection: selectedCollection,
        collectionId: selectedCollection || null,
        selectedBanks: selectedCollection ? selectedBanks : null
      });
    }
  };

  const handleBatchGenerate = useCallback(() => {
    const col = collections.find(c => c.id === selectedCollection);
    if (!col) return;

    const migrated = migrateCollectionBanks(col);
    const bankImages = (migrated.banks || []).map(bankIds =>
      library.filter(item => (bankIds || []).includes(item.id))
    );
    const textBank1 = col.textBank1 || [];
    const textBank2 = col.textBank2 || [];
    const template = col.textTemplates?.[0] || null;

    // Validate: at least one bank must have images
    const anyPopulated = bankImages.some(bank => bank.length > 0);
    if (!anyPopulated) {
      toastError('Please add images to at least one bank first.');
      return;
    }

    // Warn if only one bank is populated
    const populatedCount = bankImages.filter(bank => bank.length > 0).length;
    if (populatedCount === 1) {
      console.warn(`[Batch] Only one bank is populated — will use images from that bank.`);
    }

    setBatchGenerating(true);

    const randomFrom = (arr) => arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null;

    const slideshows = [];
    let skippedSlides = 0;

    for (let i = 0; i < batchCount; i++) {
      const slides = [];
      for (let s = 0; s < batchSlidesPerShow; s++) {
        // Cycle through banks: slide 0 = bank 0, slide 1 = bank 1, etc.
        const bankIndex = s % bankImages.length;
        const bank = bankImages[bankIndex];
        const img = randomFrom(bank.length > 0 ? bank : bankImages.find(b => b.length > 0));

        // Skip slides with no image (both banks exhausted somehow)
        if (!img) {
          skippedSlides++;
          continue;
        }

        const imageUrl = img.url || img.localUrl;
        if (!imageUrl) {
          skippedSlides++;
          continue;
        }

        const slide = {
          id: `slide_${Date.now()}_${i}_${s}`,
          index: s,
          backgroundImage: imageUrl,
          thumbnail: imageUrl,
          sourceBank: useA ? 'imageA' : 'imageB',
          sourceImageId: img.id,
          textOverlays: [],
          imageTransform: { scale: 1, offsetX: 0, offsetY: 0 },
          duration: 3
        };

        // Add text overlay from text banks
        const textBankForSlide = s === 0 ? textBank1 : s === 1 ? textBank2 : (s % 2 === 0 ? textBank1 : textBank2);
        const textStyleForSlide = s === 0 ? template?.text1Style : s === 1 ? template?.text2Style : (s % 2 === 0 ? template?.text1Style : template?.text2Style);

        if (textBankForSlide.length > 0) {
          const randomText = randomFrom(textBankForSlide);
          if (randomText) {
            slide.textOverlays.push({
              id: `text_${Date.now()}_${i}_${s}`,
              text: randomText,
              position: textStyleForSlide?.position || { x: 50, y: 50 },
              style: {
                fontFamily: textStyleForSlide?.fontFamily || 'Inter, sans-serif',
                fontSize: textStyleForSlide?.fontSize || 48,
                fontWeight: textStyleForSlide?.fontWeight || '700',
                color: textStyleForSlide?.color || '#ffffff',
                textAlign: 'center',
                outline: textStyleForSlide?.outline !== false,
                outlineColor: textStyleForSlide?.outlineColor || 'rgba(0,0,0,0.5)'
              }
            });
          }
        }

        slides.push(slide);
      }

      // Only create slideshow if it has at least 1 slide
      if (slides.length === 0) continue;

      // Re-index slides after any skips
      slides.forEach((slide, idx) => { slide.index = idx; });

      const slideshow = {
        id: `slideshow_${Date.now()}_${i}`,
        name: `${col.name} #${i + 1}`,
        aspectRatio: '9:16',
        slides,
        audio: batchAudio ? {
          id: batchAudio.id,
          url: batchAudio.url || batchAudio.localUrl,
          localUrl: batchAudio.localUrl || batchAudio.url,
          name: batchAudio.name,
          startTime: batchAudio.metadata?.startTime || 0,
          endTime: batchAudio.metadata?.endTime || batchAudio.duration || null,
          duration: batchAudio.duration || null
        } : null,
        status: 'draft',
        collectionId: selectedCollection,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      slideshows.push(slideshow);
    }

    // Save all as drafts
    slideshows.forEach(ss => {
      addCreatedSlideshow(artistId, ss);
    });

    // Sync to Firestore for persistence
    const content = getCreatedContent(artistId);
    if (db) {
      saveCreatedContentAsync(db, artistId, content).catch(console.error);
    }

    // Refresh created content
    setCreatedContent(content);
    setBatchGenerating(false);
    setShowBatchModal(false);
    if (slideshows.length === 0) {
      toastError('Could not generate any slideshows — no valid images found in banks.');
    } else {
      const skippedMsg = skippedSlides > 0 ? ` (${skippedSlides} blank slides skipped)` : '';
      toastSuccess(`Generated ${slideshows.length} slideshow drafts!${skippedMsg} View them in your library.`);
    }
  }, [batchCount, batchSlidesPerShow, batchAudio, selectedCollection, collections, library, artistId, db, toastError, toastSuccess]);


  // =====================
  // COMPUTED VALUES
  // =====================

  const videoCount = createdContent.videos.length;
  const slideshowCount = createdContent.slideshows.length;
  const draftVideos = createdContent.videos.filter(v => v.status === 'draft' || v.status === 'DRAFT');
  const draftSlideshows = createdContent.slideshows.filter(s => s.status === 'draft' || s.status === 'DRAFT');
  const totalDrafts = draftVideos.length + draftSlideshows.length;

  const libraryVideos = library.filter(m => m.type === MEDIA_TYPES.VIDEO);
  const libraryAudio = library.filter(m => m.type === MEDIA_TYPES.AUDIO);
  const libraryImages = library.filter(m => m.type === MEDIA_TYPES.IMAGE);

  // Audio filtered by selected collection for the sidebar bank
  const sidebarAudio = useMemo(() => {
    const allAudio = library.filter(m => m.type === MEDIA_TYPES.AUDIO);
    if (!selectedCollection) return allAudio;
    const col = collections.find(c => c.id === selectedCollection);
    if (!col) return allAudio;
    // Only show audio that belongs to this collection — don't fall back to all
    return allAudio.filter(a =>
      (col.mediaIds || []).includes(a.id) || (a.collectionIds || []).includes(selectedCollection)
    );
  }, [library, collections, selectedCollection]);

  // Lyrics filtered by selected collection for the sidebar bank
  const sidebarLyrics = useMemo(() => {
    if (!selectedCollection) return lyrics;
    return lyrics.filter(l =>
      (l.collectionIds || []).includes(selectedCollection)
    );
  }, [lyrics, selectedCollection]);

  // State for "import from other collection" dropdowns
  const [showAudioImport, setShowAudioImport] = useState(false);
  const [showLyricsImport, setShowLyricsImport] = useState(false);

  // Audio items NOT in current collection (for import dropdown)
  const importableAudio = useMemo(() => {
    if (!selectedCollection) return [];
    const allAudio = library.filter(m => m.type === MEDIA_TYPES.AUDIO);
    const col = collections.find(c => c.id === selectedCollection);
    if (!col) return allAudio;
    return allAudio.filter(a =>
      !col.mediaIds?.includes(a.id) && !(a.collectionIds || []).includes(selectedCollection)
    );
  }, [library, collections, selectedCollection]);

  // Lyrics NOT in current collection (for import dropdown)
  const importableLyrics = useMemo(() => {
    if (!selectedCollection) return [];
    return lyrics.filter(l =>
      !(l.collectionIds || []).includes(selectedCollection)
    );
  }, [lyrics, selectedCollection]);

  // =====================
  // STYLES
  // =====================

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: theme.bg.page,
      color: theme.text.primary,
      overflow: isMobile ? 'auto' : 'hidden',
      WebkitOverflowScrolling: 'touch'
    },
    header: {
      padding: isMobile ? '12px 16px' : '16px 24px',
      borderBottom: `1px solid ${theme.border.default}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      flexWrap: isMobile ? 'wrap' : 'nowrap'
    },
    headerLeft: {
      display: 'flex',
      alignItems: isMobile ? 'stretch' : 'center',
      flexDirection: isMobile ? 'column' : 'row',
      gap: isMobile ? '8px' : '16px',
      ...(isMobile ? { width: '100%' } : {})
    },
    headerTitle: {
      fontSize: isMobile ? '18px' : '20px',
      fontWeight: '600',
      margin: 0
    },
    headerCenter: {
      flex: 1,
      display: isMobile ? 'none' : 'flex',
      justifyContent: 'center',
      gap: '8px'
    },
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    },
    tabs: {
      display: 'flex',
      gap: '4px',
      backgroundColor: theme.bg.surface,
      padding: '4px',
      borderRadius: '8px'
    },
    tab: {
      padding: '8px 16px',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '6px',
      color: theme.text.secondary,
      fontSize: '13px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    tabActive: {
      backgroundColor: `${theme.accent.muted}40`,
      color: theme.text.primary
    },
    body: {
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      flex: 1,
      overflow: isMobile ? 'auto' : 'hidden',
      position: 'relative'
    },
    dropOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: `${theme.accent.primary}26`,
      border: `3px dashed ${theme.accent.primary}`,
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      pointerEvents: 'none'
    },
    dropOverlayContent: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
      color: theme.accent.hover,
      textAlign: 'center'
    },
    mainContent: {
      flex: isMobile ? 'none' : 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: isMobile ? 'visible' : 'hidden',
      ...(isMobile ? { minHeight: '50vh' } : {})
    },
    modeSelector: {
      padding: isMobile ? '16px 12px' : '24px',
      display: 'flex',
      justifyContent: 'center',
      gap: isMobile ? '12px' : '24px',
      flexWrap: 'wrap'
    },
    modeCard: {
      width: isMobile ? '100%' : '280px',
      padding: '32px 24px',
      backgroundColor: theme.bg.surface,
      border: `2px solid ${theme.border.default}`,
      borderRadius: '16px',
      cursor: 'pointer',
      textAlign: 'center',
      transition: 'all 0.2s'
    },
    modeCardActive: {
      borderColor: theme.accent.primary,
      backgroundColor: theme.accent.muted
    },
    modeIcon: {
      fontSize: '48px',
      marginBottom: '16px'
    },
    modeName: {
      fontSize: '20px',
      fontWeight: '600',
      marginBottom: '8px'
    },
    modeCount: {
      fontSize: '14px',
      color: theme.text.secondary
    },
    librarySection: {
      flex: isMobile ? 'none' : 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: isMobile ? 'visible' : 'hidden'
    },
    libraryHeader: {
      padding: isMobile ? '12px 16px' : '16px 24px',
      borderBottom: `1px solid ${theme.border.default}`,
      display: 'flex',
      alignItems: isMobile ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: isMobile ? '8px' : '16px',
      flexDirection: isMobile ? 'column' : 'row'
    },
    libraryTitle: {
      fontSize: '16px',
      fontWeight: '600'
    },
    uploadButton: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: isMobile ? 'center' : 'flex-start',
      gap: '8px',
      padding: isMobile ? '12px 20px' : '10px 20px',
      backgroundColor: theme.accent.primary,
      border: 'none',
      borderRadius: '8px',
      color: theme.text.primary,
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      ...(isMobile ? { width: '100%' } : {})
    },
    mediaGrid: {
      flex: 1,
      padding: isMobile ? '8px 12px' : '16px 24px',
      overflowY: 'auto'
    },
    actionBar: {
      padding: isMobile ? '12px 12px' : '16px 24px',
      borderTop: `1px solid ${theme.border.default}`,
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: isMobile ? '10px' : '16px',
      backgroundColor: theme.bg.surface
    },
    actionInfo: {
      fontSize: '14px',
      color: theme.text.secondary
    },
    actionButtons: {
      display: 'flex',
      gap: isMobile ? '8px' : '12px',
      flexWrap: 'wrap',
      ...(isMobile ? { justifyContent: 'stretch' } : {})
    },
    actionButton: {
      padding: isMobile ? '12px 16px' : '10px 24px',
      borderRadius: '8px',
      fontSize: isMobile ? '13px' : '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s',
      ...(isMobile ? { flex: '1 1 auto', minHeight: '44px', textAlign: 'center' } : {})
    },
    primaryButton: {
      backgroundColor: theme.accent.primary,
      border: 'none',
      color: theme.text.primary
    },
    secondaryButton: {
      backgroundColor: 'transparent',
      border: `1px solid ${theme.border.default}`,
      color: theme.text.primary
    },
    uploadOverlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    },
    uploadModal: {
      backgroundColor: theme.bg.surface,
      borderRadius: '16px',
      padding: '32px 40px',
      textAlign: 'center',
      minWidth: '360px',
      maxWidth: '420px'
    },
    uploadIcon: {
      fontSize: '48px',
      marginBottom: '16px'
    },
    uploadText: {
      fontSize: '16px',
      color: theme.text.primary,
      marginBottom: '8px'
    },
    uploadProgress: {
      fontSize: '14px',
      color: theme.text.secondary
    },
    audioSidebar: {
      width: isMobile ? '100%' : '300px',
      flexShrink: 0,
      borderLeft: isMobile ? 'none' : `1px solid ${theme.border.subtle}`,
      borderTop: isMobile ? `1px solid ${theme.border.subtle}` : 'none',
      backgroundColor: theme.bg.surface,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    },
    audioSidebarHeader: {
      padding: '14px 16px',
      borderBottom: `1px solid ${theme?.border?.subtle || 'rgba(255,255,255,0.08)'}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
      cursor: 'pointer'
    },
    audioSidebarTitle: {
      fontSize: '14px',
      fontWeight: '600',
      color: theme.text.primary,
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    audioSidebarFilter: {
      padding: '8px 16px',
      borderBottom: `1px solid ${theme.border.subtle}`,
      fontSize: '11px',
      color: theme.text.muted,
      flexShrink: 0
    },
    audioSidebarList: {
      flex: 1,
      overflowY: 'auto',
      padding: '8px'
    },
    audioSidebarItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 12px',
      borderRadius: '8px',
      marginBottom: '4px',
      cursor: 'pointer',
      fontSize: '13px',
      transition: 'background 0.15s'
    },
    audioSidebarEmpty: {
      padding: '24px 16px',
      textAlign: 'center',
      color: theme.text.muted,
      fontSize: '12px'
    }
  };

  // =====================
  // RENDER
  // =====================

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.headerTitle}>
            {studioMode === 'videos' ? 'Video Studio' :
             studioMode === 'slideshows' ? 'Slideshow Studio' :
             'Studio'}
          </h2>

          {studioMode && (
            <CollectionPicker
              artistId={artistId}
              db={db}
              value={selectedCollection}
              onChange={setSelectedCollection}
              mediaType={
                studioMode === 'videos' ? MEDIA_TYPES.VIDEO :
                studioMode === 'audio' ? MEDIA_TYPES.AUDIO :
                MEDIA_TYPES.IMAGE
              }
              isMobile={isMobile}
              liveCollections={collections}
              liveLibrary={library}
            />
          )}
        </div>

        <div style={styles.headerCenter}>
          {/* View Drafts buttons — centered, shown when drafts exist */}
          {(studioMode === 'videos' && draftVideos.length > 0) && (
            <button
              onClick={() => onViewContent?.({ type: 'videos' })}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px', borderRadius: '8px',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: theme.accent.primary, fontSize: '13px', fontWeight: 500,
                cursor: 'pointer', transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.25)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.15)'; }}
            >
              📝 Drafts ({draftVideos.length})
            </button>
          )}
          {(studioMode === 'slideshows' && draftSlideshows.length > 0) && (
            <button
              onClick={() => onViewContent?.({ type: 'slideshows' })}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px', borderRadius: '8px',
                backgroundColor: 'rgba(236, 72, 153, 0.15)',
                border: '1px solid rgba(236, 72, 153, 0.3)',
                color: '#f9a8d4', fontSize: '13px', fontWeight: 500,
                cursor: 'pointer', transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(236, 72, 153, 0.25)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(236, 72, 153, 0.15)'; }}
            >
              📝 Drafts ({draftSlideshows.length})
            </button>
          )}
        </div>

      </div>

      {/* Body */}
      <div
        style={styles.body}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleFileDrop}
      >
        {/* Drag-and-drop overlay */}
        {isDragOver && studioMode && (
          <div style={styles.dropOverlay}>
            <div style={styles.dropOverlayContent}>
              <div style={{ fontSize: '48px' }}>📁</div>
              <div style={{ fontSize: '18px', fontWeight: 600 }}>
                Drop {studioMode === 'videos' ? 'videos' : studioMode === 'slideshows' ? 'images' : 'audio files'} here to upload
              </div>
            </div>
          </div>
        )}

        <div style={styles.mainContent}>
          {/* Mode Selection */}
          {!studioMode && (
            <div style={styles.modeSelector}>
              <div
                style={styles.modeCard}
                onClick={() => onSetStudioMode('videos')}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6366f1'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
              >
                <div style={styles.modeIcon}>🎬</div>
                <div style={styles.modeName}>Videos</div>
                <div style={styles.modeCount}>{videoCount} created</div>
              </div>

              <div
                style={styles.modeCard}
                onClick={() => onSetStudioMode('slideshows')}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6366f1'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
              >
                <div style={styles.modeIcon}>🖼️</div>
                <div style={styles.modeName}>Slideshows</div>
                <div style={styles.modeCount}>{slideshowCount} created</div>
              </div>

              <div
                style={styles.modeCard}
                onClick={() => onSetStudioMode('audio')}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6366f1'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
              >
                <div style={styles.modeIcon}>🎵</div>
                <div style={styles.modeName}>Audio</div>
                <div style={styles.modeCount}>{libraryAudio.length} clips</div>
              </div>

              {/* Drafts entry point on dashboard — with video/slideshow toggle */}
              {totalDrafts > 0 && (
                <div
                  style={{ ...styles.modeCard, cursor: 'default' }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6366f1'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                >
                  <div style={styles.modeIcon}>📝</div>
                  <div style={styles.modeName}>Drafts</div>
                  <div style={styles.modeCount}>{totalDrafts} draft{totalDrafts !== 1 ? 's' : ''}</div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', width: '100%' }}>
                    {draftVideos.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewContent?.({ type: 'videos' }); }}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          fontSize: '11px',
                          fontWeight: 500,
                          backgroundColor: 'rgba(99, 102, 241, 0.15)',
                          border: '1px solid rgba(99, 102, 241, 0.3)',
                          borderRadius: '6px',
                          color: theme.accent.primary,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.3)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.15)'; }}
                      >
                        🎬 Videos ({draftVideos.length})
                      </button>
                    )}
                    {draftSlideshows.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewContent?.({ type: 'slideshows' }); }}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          fontSize: '11px',
                          fontWeight: 500,
                          backgroundColor: 'rgba(236, 72, 153, 0.15)',
                          border: '1px solid rgba(236, 72, 153, 0.3)',
                          borderRadius: '6px',
                          color: '#f9a8d4',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(236, 72, 153, 0.3)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(236, 72, 153, 0.15)'; }}
                      >
                        🖼️ Slideshows ({draftSlideshows.length})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Video Mode */}
          {studioMode === 'videos' && (
            <div style={styles.librarySection}>
              <div style={styles.libraryHeader}>
                <span style={styles.libraryTitle}>
                  Video Clips ({libraryVideos.length})
                </span>
                <div style={isMobile ? { display: 'flex', gap: '8px', width: '100%' } : {}}>
                  {/* Upload Videos button removed — use LibraryBrowser upload instead */}
                  {isMobile && (
                    <label style={{
                      ...styles.uploadButton,
                      backgroundColor: 'rgba(16, 185, 129, 0.8)',
                      flex: 'none',
                      width: '48px',
                      justifyContent: 'center',
                      padding: '12px'
                    }}>
                      📷
                      <input
                        type="file"
                        accept="video/*"
                        capture="environment"
                        onChange={handleVideoUpload}
                        style={{ display: 'none' }}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div style={styles.mediaGrid}>
                <LibraryBrowser
                  db={db}
                  artistId={artistId}
                  mode="videos"
                  onSelectMedia={handleSelectMedia}
                  selectedMediaIds={selectedMedia.videos.map(v => v.id)}
                  allowMultiSelect={true}
                  pullFromCollection={selectedCollection}
                  onCollectionChange={setSelectedCollection}
                  liveCollections={collections}
                  onCollectionsUpdated={loadData}
                  isMobile={isMobile}
                  compact
                  refreshTrigger={libraryRefreshTrigger}
                  extraToolbarContent={
                    <CloudImportButton
                      artistId={artistId}
                      db={db}
                      mediaType="video"
                      onImportMedia={(files) => {
                        const newItems = files.map((f, i) => ({
                          id: `cloud_${Date.now()}_${i}`,
                          name: f.name,
                          url: f.url || f.localUrl,
                          localUrl: f.localUrl,
                          type: f.type || 'video',
                          source: f.source
                        }));
                        addManyToLibraryAsync(db, artistId, newItems).then(() => {
                          if (selectedCollection && newItems.length > 0) {
                            const addedIds = newItems.map(a => a.id);
                            addToCollectionAsync(db, artistId, selectedCollection, addedIds);
                          }
                          setLibraryRefreshTrigger(prev => prev + 1);
                        }).catch(err => console.warn('[StudioHome] Cloud import save failed:', err));
                      }}
                    />
                  }
                />
              </div>

              {/* Action Bar */}
              <div style={styles.actionBar}>
                <div style={styles.actionInfo}>
                  {selectedMedia.videos.length} clips selected
                  {selectedMedia.videos.length > 0 && (
                    <>
                      <button
                        onClick={() => setSelectedMedia(prev => ({ ...prev, videos: [] }))}
                        style={{
                          background: 'none',
                          border: '1px solid rgba(255,255,255,0.3)',
                          color: 'rgba(255,255,255,0.7)',
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginLeft: '8px'
                        }}
                      >
                        Deselect All
                      </button>
                      <button
                        onClick={() => handleDeleteSelected('videos')}
                        style={{
                          background: 'none',
                          border: '1px solid rgba(239,68,68,0.5)',
                          color: '#ef4444',
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginLeft: '4px'
                        }}
                      >
                        Delete {selectedMedia.videos.length}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDeleteAll('videos')}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: 'rgba(239,68,68,0.6)',
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginLeft: '8px'
                    }}
                  >
                    Delete All
                  </button>
                </div>
                <div style={styles.actionButtons}>
                  {draftVideos.length > 0 && (
                    <button
                      style={{...styles.actionButton, ...styles.secondaryButton}}
                      onClick={() => onViewContent?.({ type: 'videos' })}
                    >
                      View Drafts ({draftVideos.length})
                    </button>
                  )}
                  <button
                    style={{...styles.actionButton, ...styles.secondaryButton}}
                    onClick={() => onViewContent?.({ type: 'videos' })}
                  >
                    View Library
                  </button>
                  {onViewScheduling && (
                    <button
                      style={{...styles.actionButton, ...styles.secondaryButton, borderColor: theme.accent.primary, color: theme.accent.primary}}
                      onClick={onViewScheduling}
                    >
                      Scheduled Posts
                    </button>
                  )}
                  {onImportFromDrive && (
                    <button
                      style={{...styles.actionButton, ...styles.secondaryButton, borderColor: '#10b981', color: '#6ee7b7'}}
                      onClick={onImportFromDrive}
                    >
                      {driveConnected ? 'Import from Drive' : 'Connect Drive'}
                    </button>
                  )}
                  {onExportToDrive && selectedMedia.videos.length > 0 && driveConnected && (
                    <button
                      style={{...styles.actionButton, ...styles.secondaryButton, borderColor: '#10b981', color: '#6ee7b7'}}
                      onClick={() => onExportToDrive(selectedMedia.videos)}
                    >
                      Export to Drive
                    </button>
                  )}
                  <button
                    style={{
                      ...styles.actionButton,
                      ...styles.primaryButton,
                      opacity: selectedMedia.videos.length === 0 ? 0.5 : 1
                    }}
                    onClick={() => handleLaunchVideoEditor()}
                  >
                    Create Video
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Slideshow Mode */}
          {studioMode === 'slideshows' && (
            <div style={styles.librarySection}>
              <div style={styles.libraryHeader}>
                <span style={styles.libraryTitle}>
                  Images ({libraryImages.length})
                </span>
              </div>

              <div style={styles.mediaGrid}>
                <LibraryBrowser
                  db={db}
                  artistId={artistId}
                  mode="images"
                  onSelectMedia={handleSelectMedia}
                  selectedMediaIds={selectedMedia.images.map(i => i.id)}
                  allowMultiSelect={true}
                  pullFromCollection={selectedCollection}
                  onCollectionChange={setSelectedCollection}
                  liveCollections={collections}
                  onCollectionsUpdated={loadData}
                  isMobile={isMobile}
                  compact
                  refreshTrigger={libraryRefreshTrigger}
                  extraToolbarContent={
                    <CloudImportButton
                      artistId={artistId}
                      db={db}
                      mediaType="image"
                      onImportMedia={(files) => {
                        const newItems = files.map((f, i) => ({
                          id: `cloud_${Date.now()}_${i}`,
                          name: f.name,
                          url: f.url || f.localUrl,
                          localUrl: f.localUrl,
                          type: f.type || 'image',
                          source: f.source
                        }));
                        addManyToLibraryAsync(db, artistId, newItems).then(() => {
                          if (selectedCollection && newItems.length > 0) {
                            const addedIds = newItems.map(a => a.id);
                            addToCollectionAsync(db, artistId, selectedCollection, addedIds);
                          }
                          setLibraryRefreshTrigger(prev => prev + 1);
                        }).catch(err => console.warn('[StudioHome] Cloud import save failed:', err));
                      }}
                    />
                  }
                />
              </div>

              {/* Bank Selection — shown when a collection is selected */}
              {selectedCollection && (() => {
                const col = collections.find(c => c.id === selectedCollection);
                if (!col) return null;
                const migrated = migrateCollectionBanks(col);
                const bankCounts = (migrated.banks || []).map(b => (b || []).length);
                const totalBanked = bankCounts.reduce((a, b) => a + b, 0);
                if (totalBanked === 0) return null;
                const numBanks = migrated?.banks?.length || 2;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
                    padding: '8px 12px', margin: '0 0 4px 0',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)'
                  }}>
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Pull from:
                    </span>
                    {Array.from({ length: numBanks }).map((_, idx) => {
                      const color = getBankColor(idx);
                      const count = bankCounts[idx] || 0;
                      return (
                        <label key={idx} style={{
                          display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '4px',
                          fontSize: isMobile ? '13px' : '11px',
                          color: selectedBanks.has(idx) ? color.light : 'rgba(255,255,255,0.3)',
                          cursor: 'pointer', whiteSpace: 'nowrap',
                          ...(isMobile ? { minHeight: '44px', padding: '6px 12px', borderRadius: '8px', backgroundColor: selectedBanks.has(idx) ? `${color.primary}20` : 'rgba(255,255,255,0.04)' } : {})
                        }}>
                          <input type="checkbox" checked={selectedBanks.has(idx)}
                            onChange={() => setSelectedBanks(prev => { const next = new Set(prev); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; })}
                            style={{ accentColor: color.primary, ...(isMobile ? { width: '20px', height: '20px' } : {}) }} />
                          {getBankLabel(idx)} <span style={{ opacity: 0.5 }}>{count}</span>
                        </label>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Action Bar */}
              <div style={styles.actionBar}>
                <div style={styles.actionInfo}>
                  {selectedMedia.images.length} images selected
                  {selectedMedia.images.length > 0 && (
                    <>
                      <button
                        onClick={() => setSelectedMedia(prev => ({ ...prev, images: [] }))}
                        style={{
                          background: 'none',
                          border: '1px solid rgba(255,255,255,0.3)',
                          color: 'rgba(255,255,255,0.7)',
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginLeft: '8px'
                        }}
                      >
                        Deselect All
                      </button>
                      <button
                        onClick={() => handleDeleteSelected('images')}
                        style={{
                          background: 'none',
                          border: '1px solid rgba(239,68,68,0.5)',
                          color: '#ef4444',
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginLeft: '4px'
                        }}
                      >
                        Delete {selectedMedia.images.length}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDeleteAll('images')}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: 'rgba(239,68,68,0.6)',
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginLeft: '8px'
                    }}
                  >
                    Delete All
                  </button>
                </div>
                <div style={styles.actionButtons}>
                  {draftSlideshows.length > 0 && (
                    <button
                      style={{...styles.actionButton, ...styles.secondaryButton}}
                      onClick={() => onViewContent?.({ type: 'slideshows' })}
                    >
                      View Drafts ({draftSlideshows.length})
                    </button>
                  )}
                  <button
                    style={{...styles.actionButton, ...styles.secondaryButton}}
                    onClick={() => onViewContent?.({ type: 'slideshows' })}
                  >
                    View Library
                  </button>
                  <button
                    style={{
                      ...styles.actionButton,
                      ...styles.primaryButton
                    }}
                    onClick={() => handleLaunchSlideshowEditor()}
                  >
                    Create Slideshow (up to 50)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Audio Mode */}
          {studioMode === 'audio' && (
            <div style={styles.librarySection}>
              <div style={styles.libraryHeader}>
                <span style={styles.libraryTitle}>
                  Audio Clips ({libraryAudio.length})
                </span>
                <label style={styles.uploadButton}>
                  ⬆️ Upload Audio
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept=".mp3,audio/mpeg"
                    onChange={handleAudioUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              <div style={styles.mediaGrid}>
                <LibraryBrowser
                  db={db}
                  artistId={artistId}
                  mode="audio"
                  onSelectMedia={handleSelectMedia}
                  selectedMediaIds={selectedMedia.audio ? [selectedMedia.audio.id] : []}
                  allowMultiSelect={false}
                  pullFromCollection={selectedCollection}
                  onCollectionChange={setSelectedCollection}
                  liveCollections={collections}
                  onCollectionsUpdated={loadData}
                  isMobile={isMobile}
                  compact
                  refreshTrigger={libraryRefreshTrigger}
                />
              </div>

              {/* Action Bar */}
              <div style={styles.actionBar}>
                <div style={styles.actionInfo}>
                  {selectedMedia.audio && `Audio: ${selectedMedia.audio.name}`}
                </div>
                <div style={styles.actionButtons}>
                  <button
                    style={{...styles.actionButton, ...styles.secondaryButton}}
                    onClick={() => onViewContent?.({ type: 'audio' })}
                  >
                    View Library
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Right Panel — Audio Bank always, Lyrics only when collection selected */}
        {(studioMode === 'videos' || studioMode === 'slideshows') && (
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            width: isMobile ? '100%' : (selectedCollection ? '680px' : '240px'),
            flexShrink: isMobile ? 0 : 0,
            borderLeft: isMobile ? 'none' : `1px solid ${theme?.border?.default || 'rgba(255,255,255,0.1)'}`,
            borderTop: isMobile ? `1px solid ${theme?.border?.default || 'rgba(255,255,255,0.1)'}` : 'none',
            backgroundColor: theme?.bg?.surface || '#0d0d14',
            overflow: 'visible',
            transition: isMobile ? 'none' : 'width 0.2s ease'
          }}>

            {/* Mobile sidebar pill tabs */}
            {isMobile && (
              <div style={{
                display: 'flex',
                gap: '6px',
                padding: '10px 12px',
                borderBottom: `1px solid ${theme?.border?.subtle || 'rgba(255,255,255,0.08)'}`,
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                flexShrink: 0
              }}>
                {[
                  { key: 'audio', label: 'Audio' },
                  ...(selectedCollection ? [{ key: 'lyrics', label: 'Lyrics' }] : []),
                  ...(selectedCollection && studioMode === 'videos' ? [{ key: 'banks', label: 'Banks' }] : [])
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setMobileSidebarTab(tab.key)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '20px',
                      border: 'none',
                      backgroundColor: mobileSidebarTab === tab.key ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)',
                      color: mobileSidebarTab === tab.key ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                      fontSize: '13px',
                      fontWeight: mobileSidebarTab === tab.key ? 600 : 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      minHeight: '36px',
                      transition: 'all 0.15s'
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {/* ── Audio Bank Column ── */}
            <div style={{
              flex: 1,
              display: (isMobile && mobileSidebarTab !== 'audio') ? 'none' : 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderRight: isMobile ? 'none' : (selectedCollection ? `1px solid ${theme?.border?.subtle || 'rgba(255,255,255,0.08)'}` : 'none')
            }}>
              <div style={{
                padding: '6px 8px',
                borderBottom: `1px solid ${theme?.border?.subtle || 'rgba(255,255,255,0.08)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
              }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: theme.text.primary }}>
                  🎵 Audio Bank
                </span>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '3px',
                  padding: '2px 6px', borderRadius: '4px',
                  backgroundColor: 'rgba(99,102,241,0.2)', border: 'none',
                  color: theme.accent.primary, fontSize: '9px', fontWeight: 500,
                  cursor: 'pointer'
                }}>
                  ⬆ Upload
                  <input
                    type="file"
                    accept=".mp3,audio/mpeg"
                    onChange={handleAudioUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
              <div style={{
                padding: '3px 8px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                fontSize: '9px',
                color: 'rgba(255,255,255,0.4)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                position: 'relative'
              }}>
                <span>
                  {selectedCollection
                    ? `${collections.find(c => c.id === selectedCollection)?.name || 'Collection'}`
                    : 'All Audio'}
                  {' '}({sidebarAudio.length})
                </span>
                {selectedCollection && importableAudio.length > 0 && (
                  <button
                    onClick={() => setShowAudioImport(!showAudioImport)}
                    style={{
                      background: 'none', border: 'none', color: '#6366f1',
                      cursor: 'pointer', fontSize: '10px', padding: '1px 4px'
                    }}
                    title="Import from another collection"
                  >
                    + Import
                  </button>
                )}
                {showAudioImport && selectedCollection && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, zIndex: 50,
                    backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    maxHeight: '200px', overflowY: 'auto', minWidth: '180px', padding: '4px'
                  }}>
                    <div style={{ padding: '4px 8px', fontSize: '9px', color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '4px' }}>
                      Add audio from library:
                    </div>
                    {importableAudio.map(a => (
                      <div
                        key={a.id}
                        onClick={() => {
                          addToCollectionAsync(db, artistId, selectedCollection, [a.id]);
                          loadData();
                          setLibraryRefreshTrigger(t => t + 1);
                          setShowAudioImport(false);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '6px',
                          padding: '5px 8px', borderRadius: '4px', cursor: 'pointer',
                          fontSize: '10px', color: 'rgba(255,255,255,0.7)'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <span>🎵</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      </div>
                    ))}
                    {importableAudio.length === 0 && (
                      <div style={{ padding: '8px', fontSize: '10px', color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
                        All audio already in this collection
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
                {sidebarAudio.length === 0 ? (
                  <div style={{ padding: '16px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '11px' }}>
                    {selectedCollection
                      ? 'No audio in this collection. Click "+ Import" above to add from library.'
                      : 'No audio uploaded yet.'}
                  </div>
                ) : (
                  sidebarAudio.map(audio => {
                    const isSelected = selectedMedia.audio?.id === audio.id;
                    const isEditing = editingAudio?.id === audio.id;

                    if (isEditing) {
                      // Inline edit form
                      return (
                        <div
                          key={audio.id}
                          style={{
                            padding: '8px 6px', borderRadius: '6px', marginBottom: '2px',
                            backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
                            display: 'flex', flexDirection: 'column', gap: '6px'
                          }}
                        >
                          <input
                            autoFocus
                            type="text"
                            value={editingAudio.name}
                            onChange={(e) => setEditingAudio(prev => ({ ...prev, name: e.target.value }))}
                            style={{
                              width: '100%', padding: '6px 8px', borderRadius: '4px',
                              backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                              color: '#fff', fontSize: '10px', fontFamily: 'inherit'
                            }}
                            placeholder="Audio name"
                          />
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={async () => {
                                try {
                                  await updateLibraryItemAsync(db, artistId, audio.id, { name: editingAudio.name });
                                  setLibraryRefreshTrigger(t => t + 1);
                                  setEditingAudio(null);
                                } catch (err) {
                                  console.error('Failed to update audio:', err);
                                }
                              }}
                              style={{
                                flex: 1, padding: '4px 8px', borderRadius: '4px',
                                backgroundColor: '#6366f1', border: 'none', color: '#fff',
                                fontSize: '9px', fontWeight: 500, cursor: 'pointer', lineHeight: 1
                              }}
                            >
                              Replace
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await addToLibraryAsync(db, artistId, { ...audio, id: undefined, name: editingAudio.name });
                                  setLibraryRefreshTrigger(t => t + 1);
                                  setEditingAudio(null);
                                } catch (err) {
                                  console.error('Failed to save as new:', err);
                                }
                              }}
                              style={{
                                flex: 1, padding: '4px 8px', borderRadius: '4px',
                                backgroundColor: 'rgba(167,139,250,0.4)', border: '1px solid rgba(167,139,250,0.5)',
                                color: '#a78bfa', fontSize: '9px', fontWeight: 500, cursor: 'pointer', lineHeight: 1
                              }}
                            >
                              Save as New
                            </button>
                            <button
                              onClick={() => setEditingAudio(null)}
                              style={{
                                flex: 0.6, padding: '4px 8px', borderRadius: '4px',
                                backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                                color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 500,
                                cursor: 'pointer', lineHeight: 1
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // Normal display
                    const dropdownOpen = audioDropdownId === audio.id;
                    return (
                      <div
                        key={audio.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'copy';
                          e.dataTransfer.setData('text/plain', JSON.stringify([audio.id]));
                        }}
                        onClick={() => { if (!dropdownOpen) handleSelectMedia(audio); }}
                        style={{
                          display: 'flex', flexDirection: 'column',
                          borderRadius: '6px', marginBottom: '2px',
                          backgroundColor: isSelected ? 'rgba(99,102,241,0.2)' : 'transparent',
                          position: 'relative'
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = isSelected ? 'rgba(99,102,241,0.2)' : 'transparent';
                        }}
                      >
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '4px',
                          padding: '3px 4px', cursor: 'grab', fontSize: '10px'
                        }}>
                          <span style={{
                            width: '20px', height: '20px', borderRadius: '4px',
                            background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '9px', flexShrink: 0
                          }}>🎵</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: '10px', fontWeight: 500, color: theme.text.primary,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                            }}>
                              {audio.name}
                            </div>
                            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>
                              {audio.duration
                                ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}`
                                : '—'}
                            </div>
                          </div>
                          {isSelected && (
                            <span style={{ color: '#6366f1', fontSize: '12px', flexShrink: 0 }}>✓</span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInlinePlay(audio);
                            }}
                            style={{
                              background: 'none', border: 'none',
                              color: playingAudioId === audio.id ? '#10b981' : 'rgba(255,255,255,0.3)',
                              cursor: 'pointer', fontSize: '10px', padding: '0 1px', flexShrink: 0,
                              lineHeight: 1
                            }}
                            title={playingAudioId === audio.id ? 'Stop preview' : 'Preview audio'}
                          >{playingAudioId === audio.id ? '⏹' : '▶'}</button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setAudioDropdownId(dropdownOpen ? null : audio.id);
                            }}
                            style={{
                              background: 'none', border: 'none',
                              color: dropdownOpen ? '#a5b4fc' : 'rgba(255,255,255,0.25)',
                              cursor: 'pointer', fontSize: '9px', padding: '0 1px', flexShrink: 0,
                              lineHeight: 1
                            }}
                            title="Add to collection"
                          >📂</button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingAudio({ id: audio.id, name: audio.name });
                            }}
                            style={{
                              background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                              cursor: 'pointer', fontSize: '9px', padding: '0 1px', flexShrink: 0,
                              lineHeight: 1
                            }}
                            title="Edit audio"
                          >✏️</button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setTrimmingAudio(audio);
                            }}
                            style={{
                              background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)',
                              cursor: 'pointer', fontSize: '9px', padding: '0 1px', flexShrink: 0,
                              lineHeight: 1
                            }}
                            title="Trim audio"
                          >✂️</button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isSelected) setSelectedMedia(prev => ({ ...prev, audio: null }));
                              removeFromLibraryAsync(db, artistId, audio.id).then(() => {
                                setLibraryRefreshTrigger(t => t + 1);
                              });
                            }}
                            style={{
                              background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)',
                              cursor: 'pointer', fontSize: '9px', padding: '0 1px', flexShrink: 0,
                              lineHeight: 1
                            }}
                            title="Delete audio"
                          >×</button>
                        </div>

                        {/* Collection dropdown */}
                        {dropdownOpen && (
                          <div style={{
                            padding: '4px 6px 6px',
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                            backgroundColor: 'rgba(0,0,0,0.2)',
                            borderRadius: '0 0 6px 6px'
                          }}>
                            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginBottom: '3px', padding: '0 2px' }}>
                              Add to collection:
                            </div>
                            {collections.filter(c => c.type !== 'smart').length === 0 ? (
                              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', padding: '4px 2px' }}>
                                No collections yet
                              </div>
                            ) : (
                              collections.filter(c => c.type !== 'smart').map(col => {
                                const inCol = audio.collectionIds?.includes(col.id);
                                return (
                                  <div
                                    key={col.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!inCol) {
                                        addToCollectionAsync(db, artistId, col.id, audio.id);
                                        loadData();
                                        setLibraryRefreshTrigger(t => t + 1);
                                      }
                                      setAudioDropdownId(null);
                                    }}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: '5px',
                                      padding: '3px 6px', borderRadius: '4px',
                                      cursor: inCol ? 'default' : 'pointer',
                                      fontSize: '10px',
                                      color: inCol ? '#6366f1' : 'rgba(255,255,255,0.6)',
                                      backgroundColor: inCol ? 'rgba(99,102,241,0.1)' : 'transparent'
                                    }}
                                    onMouseEnter={(e) => { if (!inCol) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; }}
                                    onMouseLeave={(e) => { if (!inCol) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  >
                                    <span style={{ fontSize: '10px' }}>{inCol ? '✓' : '📁'}</span>
                                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {col.name}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── Lyrics Column (only when collection selected) ── */}
            {selectedCollection && (!isMobile || mobileSidebarTab === 'lyrics') && (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderRight: isMobile ? 'none' : `1px solid ${theme?.border?.subtle || 'rgba(255,255,255,0.08)'}`
              }}>
                <div style={{
                  padding: '6px 8px',
                  borderBottom: `1px solid ${theme?.border?.subtle || 'rgba(255,255,255,0.08)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0
                }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: theme.text.primary }}>
                    📝 Lyrics
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)' }}>
                      {sidebarLyrics.length} saved
                    </span>
                    {importableLyrics.length > 0 && (
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={() => setShowLyricsImport(!showLyricsImport)}
                          style={{
                            background: 'none', border: 'none', color: '#6366f1',
                            cursor: 'pointer', fontSize: '10px', padding: '1px 4px'
                          }}
                          title="Import lyrics from another collection"
                        >
                          + Import
                        </button>
                        {showLyricsImport && (
                          <div style={{
                            position: 'absolute', top: '100%', right: 0, zIndex: 50,
                            backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                            maxHeight: '200px', overflowY: 'auto', minWidth: '200px', padding: '4px'
                          }}>
                            <div style={{ padding: '4px 8px', fontSize: '9px', color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '4px' }}>
                              Add lyrics to this collection:
                            </div>
                            {importableLyrics.map(l => (
                              <div
                                key={l.id}
                                onClick={() => {
                                  // Add collection ID to the lyric item
                                  const updatedCollectionIds = [...(l.collectionIds || []), selectedCollection];
                                  handleUpdateLyrics(l.id, { ...l, collectionIds: updatedCollectionIds });
                                  setShowLyricsImport(false);
                                }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '6px',
                                  padding: '5px 8px', borderRadius: '4px', cursor: 'pointer',
                                  fontSize: '10px', color: 'rgba(255,255,255,0.7)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <span>📝</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {l.title || 'Untitled'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
                  <LyricBank
                    lyrics={sidebarLyrics}
                    onAddLyrics={handleAddLyrics}
                    onUpdateLyrics={handleUpdateLyrics}
                    onDeleteLyrics={handleDeleteLyrics}
                    onSelectLyrics={(l) => log('Selected lyrics:', l)}
                    compact
                  />
                </div>
              </div>
            )}


            {/* ── Video Text Banks Column (only when collection selected in video mode) ── */}
            {selectedCollection && studioMode === 'videos' && (!isMobile || mobileSidebarTab === 'banks') && (() => {
              const col = collections.find(c => c.id === selectedCollection);
              const vt1 = col?.videoTextBank1 || [];
              const vt2 = col?.videoTextBank2 || [];
              if (vt1.length === 0 && vt2.length === 0) return null;
              return (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    padding: '10px 12px',
                    borderBottom: `1px solid ${theme?.border?.subtle || 'rgba(255,255,255,0.08)'}`,
                    flexShrink: 0
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text.primary }}>
                      Video Text Banks
                    </span>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
                    {/* Bank A */}
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: theme.text.muted, marginBottom: '4px' }}>
                        Bank A ({vt1.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {vt1.map((text, i) => (
                          <span key={i} style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            backgroundColor: 'rgba(124,58,237,0.15)',
                            borderRadius: '4px',
                            fontSize: '10px',
                            color: '#a78bfa',
                            maxWidth: '150px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }} title={text}>
                            {text}
                          </span>
                        ))}
                        {vt1.length === 0 && <span style={{ fontSize: '10px', color: theme.text.muted }}>Empty</span>}
                      </div>
                    </div>
                    {/* Bank B */}
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: theme.text.muted, marginBottom: '4px' }}>
                        Bank B ({vt2.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {vt2.map((text, i) => (
                          <span key={i} style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            backgroundColor: 'rgba(99,102,241,0.15)',
                            borderRadius: '4px',
                            fontSize: '10px',
                            color: '#818cf8',
                            maxWidth: '150px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }} title={text}>
                            {text}
                          </span>
                        ))}
                        {vt2.length === 0 && <span style={{ fontSize: '10px', color: theme.text.muted }}>Empty</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

          </div>
        )}
      </div>

      {/* Batch Generate Modal */}
      {showBatchModal && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }} onClick={() => setShowBatchModal(false)}>
          <div style={{
            backgroundColor: theme.bg.surface,
            borderRadius: isMobile ? '0' : '16px',
            padding: isMobile ? '20px 16px' : '24px',
            width: isMobile ? '100%' : '440px',
            maxHeight: isMobile ? '100%' : '80vh',
            overflowY: 'auto',
            ...(isMobile ? { position: 'fixed', inset: 0 } : {})
          }} onClick={e => e.stopPropagation()}>
            <div style={isMobile ? { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } : {}}>
              <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: theme.text.primary }}>Batch Generate Slideshows</h3>
              {isMobile && (
                <button
                  onClick={() => setShowBatchModal(false)}
                  style={{ background: 'none', border: 'none', color: theme.text.muted, fontSize: '24px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
                >×</button>
              )}
            </div>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: theme.text.secondary }}>
              Generate multiple slideshows from the current collection's banks
            </p>

            {/* Collection Info */}
            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(99,102,241,0.1)', marginBottom: '16px', fontSize: '12px', color: theme.accent.primary }}>
              Collection: {collections.find(c => c.id === selectedCollection)?.name || 'None selected'}
              {(() => {
                const col = collections.find(c => c.id === selectedCollection);
                if (!col) return ' — Select a collection first';
                const migrated = migrateCollectionBanks(col);
                return (migrated.banks || []).map((b, i) => ` • ${getBankLabel(i)}: ${(b || []).length}`).join('');
              })()}
            </div>

            {/* Count */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: theme.text.secondary, display: 'block', marginBottom: '4px' }}>Number of Slideshows</label>
              <input type="number" min="1" max="50" value={batchCount}
                onChange={e => setBatchCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.input, color: theme.text.primary, fontSize: '14px' }}
              />
            </div>

            {/* Slides per show */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: theme.text.secondary, display: 'block', marginBottom: '4px' }}>Slides per Slideshow</label>
              <input type="number" min="2" max="20" value={batchSlidesPerShow}
                onChange={e => setBatchSlidesPerShow(Math.max(2, Math.min(20, parseInt(e.target.value) || 2)))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.input, color: theme.text.primary, fontSize: '14px' }}
              />
            </div>

            {/* Audio selection */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: theme.text.secondary, display: 'block', marginBottom: '4px' }}>Audio Track (used for all)</label>
              <select
                value={batchAudio?.id || ''}
                onChange={e => {
                  const audio = library.filter(item => item.type === 'audio').find(a => a.id === e.target.value);
                  setBatchAudio(audio || null);
                }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.input, color: theme.text.primary, fontSize: '14px' }}
              >
                <option value="">No audio</option>
                {library.filter(item => item.type === 'audio').map(audio => (
                  <option key={audio.id} value={audio.id}>{audio.name}</option>
                ))}
              </select>
            </div>

            {/* Generate button */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowBatchModal(false)}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${theme.border.default}`, backgroundColor: 'transparent', color: theme.text.secondary, fontSize: '13px', cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={handleBatchGenerate}
                disabled={batchGenerating || !selectedCollection}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: batchGenerating ? '#4338ca' : '#6366f1', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: batchGenerating ? 'wait' : 'pointer' }}
              >{batchGenerating ? 'Generating...' : `Generate ${batchCount} Slideshows`}</button>
            </div>
          </div>
        </div>
      )}

      {/* Audio Clip Selector Modal — new upload */}
      {pendingAudio && (
        <AudioClipSelector
          audioUrl={pendingAudio.url}
          audioName={pendingAudio.name}
          onSave={handleClipSave}
          onCancel={handleClipCancel}
        />
      )}

      {/* Audio Clip Selector Modal — re-trim existing audio */}
      {trimmingAudio && (
        <AudioClipSelector
          audioUrl={trimmingAudio.url || trimmingAudio.localUrl}
          audioName={trimmingAudio.name}
          initialStart={trimmingAudio.trimStart || trimmingAudio.startTime || 0}
          initialEnd={trimmingAudio.trimEnd || trimmingAudio.endTime || null}
          onSave={handleRetrimSave}
          onCancel={() => setTrimmingAudio(null)}
        />
      )}

      {/* Upload Progress Overlay */}
      {isUploading && (
        <div style={styles.uploadOverlay}>
          <div style={styles.uploadModal}>
            <div style={styles.uploadIcon}>⬆️</div>
            <div style={styles.uploadText}>
              Uploading{uploadProgress.total > 1 ? ` ${uploadProgress.current} of ${uploadProgress.total}` : ''}...
            </div>
            {/* Progress Bar */}
            <div style={{
              width: '100%', height: '8px', backgroundColor: 'rgba(255,255,255,0.1)',
              borderRadius: '4px', overflow: 'hidden', margin: '16px 0 8px'
            }}>
              <div style={{
                height: '100%',
                width: `${uploadProgress.percent || 0}%`,
                background: 'linear-gradient(90deg, #6366f1, #818cf8)',
                borderRadius: '4px',
                transition: 'width 0.3s ease'
              }} />
            </div>
            {/* Percentage + file name */}
            <div style={{ fontSize: '20px', fontWeight: '600', color: '#ffffff', marginBottom: '4px' }}>
              {Math.round(uploadProgress.percent || 0)}%
            </div>
            <div style={styles.uploadProgress}>
              {uploadProgress.name && (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: '340px' }}>
                  {uploadProgress.name}
                </span>
              )}
            </div>
            <button
              onClick={handleCancelUpload}
              style={{
                marginTop: '20px',
                padding: '8px 20px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.6)',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* H-01: Unified confirm dialog (replaces window.confirm) */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel="Delete"
        confirmVariant={confirmDialog.confirmVariant || 'destructive'}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default StudioHome;
