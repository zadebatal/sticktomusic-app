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

import React, { useState, useEffect, useRef, useCallback } from 'react';
// OnboardingModal removed - auto-setup happens in VideoStudio
import LibraryBrowser from './LibraryBrowser';
import CollectionPicker from './CollectionPicker';
import AudioClipSelector from './AudioClipSelector';
import LyricBank from './LyricBank';
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
  getOnboardingStatus,
  incrementUseCount,
  addToCollection,
  saveCollectionToFirestore,
  MEDIA_TYPES,
  STARTER_TEMPLATES,
  // Firestore async functions
  subscribeToLibrary,
  subscribeToCollections,
  addToLibraryAsync,
  addManyToLibraryAsync,
  removeFromLibraryAsync,
  migrateToFirestore,
  migrateThumbnails
} from '../../services/libraryService';
import { uploadFile, getMediaDuration } from '../../services/firebaseStorage';

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
  onDeleteLyrics: externalDeleteLyrics
}) => {
  // UI State
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [activeTab, setActiveTab] = useState('media'); // 'media' | 'lyrics'
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [autoCollectionSet, setAutoCollectionSet] = useState(false);

  // Library State
  const [library, setLibrary] = useState([]);
  const [collections, setCollections] = useState([]);
  const [lyrics, setLyrics] = useState([]);
  const [createdContent, setCreatedContent] = useState({ videos: [], slideshows: [] });

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [libraryRefreshTrigger, setLibraryRefreshTrigger] = useState(0);

  // Toast for non-blocking feedback (H-02: replaces alert())
  const { success: toastSuccess, error: toastError } = useToast();

  // Confirm dialog state (H-01: replaces window.confirm())
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null, confirmVariant: 'default' });

  // Upload cancellation
  const cancelFunctionsRef = useRef([]);

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
  const [editingAudio, setEditingAudio] = useState(null);

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

  // Mobile detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load data when artist changes - use Firestore subscription if available
  useEffect(() => {
    if (!artistId) return;

    // Load non-library data from localStorage as initial state
    setCollections(getCollections(artistId));
    setLyrics(getLyrics(artistId));
    setCreatedContent(getCreatedContent(artistId));

    const unsubscribes = [];

    // For library + collections, use Firestore real-time subscription if db is available
    if (db) {
      console.log('[StudioHome] Setting up Firestore subscriptions for library + collections');

      // Try to migrate localStorage data to Firestore (one-time)
      const migrationKey = `stm_migrated_${artistId}`;
      if (!localStorage.getItem(migrationKey)) {
        migrateToFirestore(db, artistId).then(result => {
          if (result.success) {
            localStorage.setItem(migrationKey, 'true');
            console.log('[StudioHome] Migration complete:', result.migrated);
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
        console.log('[StudioHome] Firestore collections sync:', cols.length, 'collections');
        setCollections(cols);
      }));
    } else {
      // Fallback to localStorage
      console.log('[StudioHome] Using localStorage (no db available)');
      setLibrary(getLibrary(artistId));
    }

    return () => unsubscribes.forEach(unsub => unsub());
  }, [db, artistId]);

  // Diagnostic logging on mount
  useEffect(() => {
    console.log('[StudioHome] Component mounted');
    console.log('[StudioHome] artistId:', artistId);
    console.log('[StudioHome] db available:', !!db);

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

  // Auto-select first collection with banks when in slideshow mode and none is selected
  useEffect(() => {
    if (autoCollectionSet || selectedCollection) return;
    if (!studioMode || studioMode !== 'slideshows') return;
    if (collections.length === 0) return;

    // Find a collection with bankA or bankB populated
    const colWithBanks = collections.find(c =>
      (c.bankA?.length > 0 || c.bankB?.length > 0) && c.type !== 'smart'
    );
    if (colWithBanks) {
      setSelectedCollection(colWithBanks.id);
    } else if (collections.filter(c => c.type !== 'smart').length > 0) {
      // Just select the first non-smart collection
      setSelectedCollection(collections.filter(c => c.type !== 'smart')[0].id);
    }
    setAutoCollectionSet(true);
  // eslint-disable-next-line
  }, [collections, studioMode, selectedCollection, autoCollectionSet]);

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

    console.log(`[ThumbnailMigration] v${THUMB_VERSION}: ${imageItems.length} images to process`);

    // Run in background after a short delay so it doesn't block initial render
    const timer = setTimeout(async () => {
      try {
        const result = await migrateThumbnails(db, artistId, library, uploadFile, (done, total, generated) => {
          if (done % 10 === 0 || done === total) {
            setLibraryRefreshTrigger(prev => prev + 1);
          }
        });
        console.log(`[ThumbnailMigration] v${THUMB_VERSION} complete: ${result.generated} generated, ${result.failed} failed`);
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

  // =====================
  // UPLOAD HANDLERS
  // =====================

  const handleFileUpload = async (files, type) => {
    if (!files.length) return;

    console.log('[StudioHome] Starting upload for', files.length, 'files, artistId:', artistId, 'type:', type);

    if (!artistId) {
      console.error('[StudioHome] No artistId - cannot save to library');
      toastError('No artist selected. Please select an artist first.');
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length });
    cancelFunctionsRef.current = [];

    const uploadedItems = [];
    const failedFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress({ current: i + 1, total: files.length, name: file.name });

      try {
        console.log('[StudioHome] Uploading file:', file.name, 'size:', file.size, 'type:', file.type);

        // Upload to Firebase
        const folder = type === MEDIA_TYPES.VIDEO ? 'videos'
          : type === MEDIA_TYPES.IMAGE ? 'images' : 'audio';
        console.log('[StudioHome] Calling uploadFile to folder:', folder);
        const { url, path } = await uploadFile(file, folder, null, {
          onCancel: (cancelFn) => {
            cancelFunctionsRef.current.push(cancelFn);
          }
        });
        console.log('[StudioHome] Upload successful! URL:', url?.substring(0, 50) + '...');

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
          // Check for audio in video
          const video = document.createElement('video');
          video.src = localUrl;
          await new Promise(r => { video.onloadedmetadata = r; });
          width = video.videoWidth;
          height = video.videoHeight;
          hasEmbeddedAudio = true; // Assume true, can't reliably detect
        }

        let thumbnailUrl = null;
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
      console.log('[StudioHome] Adding', uploadedItems.length, 'items to library for artist:', artistId);
      try {
        // Use async Firestore function if db is available
        const added = await addManyToLibraryAsync(db, artistId, uploadedItems);
        console.log('[StudioHome] Successfully added to library:', added.length, 'items');

        // Also add items to the selected collection if one is active
        if (selectedCollection && added.length > 0) {
          const addedIds = added.map(item => item.id);
          addToCollection(artistId, selectedCollection, addedIds);
          // Sync updated collection to Firestore
          if (db) {
            const cols = getCollections(artistId);
            const col = cols.find(c => c.id === selectedCollection && c.type !== 'smart');
            if (col) {
              saveCollectionToFirestore(db, artistId, col).catch(err =>
                console.warn('[StudioHome] Failed to sync collection after upload:', err)
              );
            }
          }
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
      console.log('[StudioHome] Upload complete!', uploadedItems.length, 'files added to library');
    }

    setIsUploading(false);
    setUploadProgress({ current: 0, total: 0 });
  };

  const handleVideoUpload = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    handleFileUpload(files, MEDIA_TYPES.VIDEO);
  };

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

  // Helper function to format time mm:ss
  const formatTime = (seconds) => {
    if (!seconds || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  // Audio clip handling
  const handleClipSave = async (clipData) => {
    console.log('[StudioHome] handleClipSave called with clipData:', clipData);

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
    console.log('[StudioHome] Audio duration:', {
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
    cancelFunctionsRef.current = [];

    try {
      const { url, path } = await uploadFile(pendingAudio.file, 'audio', null, {
        onCancel: (cancelFn) => {
          cancelFunctionsRef.current.push(cancelFn);
        }
      });
      console.log('[StudioHome] Audio uploaded to Firebase:', url?.substring(0, 50) + '...');

      // Create a descriptive name for the trimmed clip
      const clipName = `${pendingAudio.name} (${formatTime(clipData.startTime)}-${formatTime(clipData.endTime)})`;

      const audioItem = {
        type: MEDIA_TYPES.AUDIO,
        name: clipName,
        url,
        storagePath: path,
        duration: calculatedDuration,
        metadata: {
          startTime: clipData.startTime,
          endTime: clipData.endTime,
          fullDuration: clipData.fullDuration || clipData.endTime,
          originalName: pendingAudio.name,
          originalMediaId: null // Will be set if this is based on an existing library item
        }
      };

      console.log('[StudioHome] Saving audio item with duration:', audioItem.duration);

      if (selectedCollection) {
        audioItem.collectionIds = [selectedCollection];
      }

      // Use async Firestore function if db is available
      const added = await addToLibraryAsync(db, artistId, audioItem);
      console.log('[StudioHome] Audio saved to library:', added);
      if (!db) loadData(); // Only reload from localStorage if no Firestore
      setLibraryRefreshTrigger(prev => prev + 1);

    } catch (error) {
      console.error('[StudioHome] Audio upload failed:', error);
      toastError('Audio upload failed: ' + error.message);
    }

    setPendingAudio(null);
    setIsUploading(false);
  };

  const handleClipCancel = () => {
    if (pendingAudio?.url) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
  };

  const handleCancelUpload = () => {
    console.log('[StudioHome] Cancelling all active uploads');
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

  const handleAddLyrics = (lyricsData) => {
    const newLyrics = addLyrics(artistId, lyricsData);
    loadData();
    if (externalAddLyrics) externalAddLyrics(lyricsData);
    return newLyrics;
  };

  const handleUpdateLyrics = (lyricsId, updates) => {
    updateLyrics(artistId, lyricsId, updates);
    loadData();
    if (externalUpdateLyrics) externalUpdateLyrics(lyricsId, updates);
  };

  const handleDeleteLyrics = (lyricsId) => {
    deleteLyrics(artistId, lyricsId);
    loadData();
    if (externalDeleteLyrics) externalDeleteLyrics(lyricsId);
  };

  // =====================
  // EDITOR LAUNCH
  // =====================

  const handleLaunchVideoEditor = (existingVideo = null) => {
    // Mark selected videos as used
    selectedMedia.videos.forEach(v => incrementUseCount(artistId, v.id));
    if (selectedMedia.audio) incrementUseCount(artistId, selectedMedia.audio.id);

    // Pass selected media to editor
    if (onMakeVideo) {
      onMakeVideo({
        existingVideo,
        libraryVideos: selectedMedia.videos,
        libraryAudio: selectedMedia.audio,
        pullFromCollection: selectedCollection
      });
    }
  };

  const handleLaunchSlideshowEditor = (existingSlideshow = null) => {
    // Mark selected images as used
    selectedMedia.images.forEach(i => incrementUseCount(artistId, i.id));

    if (onMakeSlideshow) {
      onMakeSlideshow({
        existingSlideshow,
        libraryImages: selectedMedia.images,
        libraryAudio: selectedMedia.audio,
        pullFromCollection: selectedCollection,
        // Pass collection bank info so editor can auto-start from banks
        collectionId: selectedCollection || null
      });
    }
  };

  const handleBatchGenerate = useCallback(() => {
    const col = collections.find(c => c.id === selectedCollection);
    if (!col) return;

    const bankAImages = library.filter(item => (col.bankA || []).includes(item.id));
    const bankBImages = library.filter(item => (col.bankB || []).includes(item.id));
    const textBank1 = col.textBank1 || [];
    const textBank2 = col.textBank2 || [];
    const template = col.textTemplates?.[0] || null;

    // Validate: at least one bank must have images
    if (bankAImages.length === 0 && bankBImages.length === 0) {
      toastError('Please add images to Bank A and/or Bank B first.');
      return;
    }

    // Warn if only one bank is populated
    if (bankAImages.length === 0 || bankBImages.length === 0) {
      const emptyBank = bankAImages.length === 0 ? 'A' : 'B';
      console.warn(`[Batch] Bank ${emptyBank} is empty — will use images from the other bank as fallback.`);
    }

    setBatchGenerating(true);

    const randomFrom = (arr) => arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null;

    const slideshows = [];
    let skippedSlides = 0;

    for (let i = 0; i < batchCount; i++) {
      const slides = [];
      for (let s = 0; s < batchSlidesPerShow; s++) {
        // Alternate between Bank A and Bank B: even slides = A, odd = B
        const useA = s % 2 === 0;
        const bank = useA ? bankAImages : bankBImages;
        const fallbackBank = useA ? bankBImages : bankAImages;
        const img = randomFrom(bank.length > 0 ? bank : fallbackBank);

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

  // =====================
  // STYLES
  // =====================

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#0a0a0f',
      color: '#ffffff',
      overflow: 'hidden'
    },
    header: {
      padding: isMobile ? '12px 16px' : '16px 24px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      flexWrap: isMobile ? 'wrap' : 'nowrap'
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    },
    headerTitle: {
      fontSize: isMobile ? '18px' : '20px',
      fontWeight: '600',
      margin: 0
    },
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    },
    tabs: {
      display: 'flex',
      gap: '4px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      padding: '4px',
      borderRadius: '8px'
    },
    tab: {
      padding: '8px 16px',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '6px',
      color: 'rgba(255, 255, 255, 0.6)',
      fontSize: '13px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    tabActive: {
      backgroundColor: 'rgba(99, 102, 241, 0.2)',
      color: '#ffffff'
    },
    body: {
      display: 'flex',
      flex: 1,
      overflow: 'hidden'
    },
    mainContent: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    },
    modeSelector: {
      padding: '24px',
      display: 'flex',
      justifyContent: 'center',
      gap: '24px',
      flexWrap: 'wrap'
    },
    modeCard: {
      width: isMobile ? '100%' : '280px',
      padding: '32px 24px',
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      border: '2px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '16px',
      cursor: 'pointer',
      textAlign: 'center',
      transition: 'all 0.2s'
    },
    modeCardActive: {
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99, 102, 241, 0.1)'
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
      color: 'rgba(255, 255, 255, 0.5)'
    },
    librarySection: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    },
    libraryHeader: {
      padding: '16px 24px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px'
    },
    libraryTitle: {
      fontSize: '16px',
      fontWeight: '600'
    },
    uploadButton: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 20px',
      backgroundColor: '#6366f1',
      border: 'none',
      borderRadius: '8px',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer'
    },
    mediaGrid: {
      flex: 1,
      padding: '16px 24px',
      overflowY: 'auto'
    },
    actionBar: {
      padding: '16px 24px',
      borderTop: '1px solid rgba(255, 255, 255, 0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      backgroundColor: 'rgba(0, 0, 0, 0.3)'
    },
    actionInfo: {
      fontSize: '14px',
      color: 'rgba(255, 255, 255, 0.6)'
    },
    actionButtons: {
      display: 'flex',
      gap: '12px'
    },
    actionButton: {
      padding: '10px 24px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    primaryButton: {
      backgroundColor: '#6366f1',
      border: 'none',
      color: '#ffffff'
    },
    secondaryButton: {
      backgroundColor: 'transparent',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      color: 'rgba(255, 255, 255, 0.8)'
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
      backgroundColor: '#1a1a1a',
      borderRadius: '16px',
      padding: '32px',
      textAlign: 'center',
      minWidth: '280px'
    },
    uploadIcon: {
      fontSize: '48px',
      marginBottom: '16px'
    },
    uploadText: {
      fontSize: '16px',
      color: '#ffffff',
      marginBottom: '8px'
    },
    uploadProgress: {
      fontSize: '14px',
      color: 'rgba(255, 255, 255, 0.5)'
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

        <div style={styles.headerRight}>
          {studioMode && (
            <div style={styles.tabs}>
              <button
                style={{...styles.tab, ...(activeTab === 'media' ? styles.tabActive : {})}}
                onClick={() => setActiveTab('media')}
              >
                Media
              </button>
              <button
                style={{...styles.tab, ...(activeTab === 'lyrics' ? styles.tabActive : {})}}
                onClick={() => setActiveTab('lyrics')}
              >
                Lyrics
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
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

              {/* Drafts entry point on dashboard */}
              {totalDrafts > 0 && (
                <div
                  style={styles.modeCard}
                  onClick={() => onViewContent?.({ type: draftSlideshows.length > 0 ? 'slideshows' : 'videos' })}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6366f1'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                >
                  <div style={styles.modeIcon}>📝</div>
                  <div style={styles.modeName}>Drafts</div>
                  <div style={styles.modeCount}>{totalDrafts} draft{totalDrafts !== 1 ? 's' : ''}</div>
                </div>
              )}
            </div>
          )}

          {/* Video Mode */}
          {studioMode === 'videos' && activeTab === 'media' && (
            <div style={styles.librarySection}>
              <div style={styles.libraryHeader}>
                <span style={styles.libraryTitle}>
                  Video Clips ({libraryVideos.length})
                </span>
                <label style={styles.uploadButton}>
                  ⬆️ Upload Videos
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={handleVideoUpload}
                    style={{ display: 'none' }}
                  />
                </label>
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
                  isMobile={isMobile}
                  compact
                  refreshTrigger={libraryRefreshTrigger}
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
          {studioMode === 'slideshows' && activeTab === 'media' && (
            <div style={styles.librarySection}>
              <div style={styles.libraryHeader}>
                <span style={styles.libraryTitle}>
                  Images ({libraryImages.length})
                </span>
                <label style={styles.uploadButton}>
                  ⬆️ Upload Images
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                  />
                </label>
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
                  isMobile={isMobile}
                  compact
                  refreshTrigger={libraryRefreshTrigger}
                />
              </div>

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
          {studioMode === 'audio' && activeTab === 'media' && (
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

          {/* Lyrics Tab */}
          {studioMode && activeTab === 'lyrics' && (
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
              <LyricBank
                lyrics={lyrics}
                onAddLyrics={handleAddLyrics}
                onUpdateLyrics={handleUpdateLyrics}
                onDeleteLyrics={handleDeleteLyrics}
                onSelectLyrics={(l) => console.log('Selected lyrics:', l)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Batch Generate Modal */}
      {showBatchModal && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }} onClick={() => setShowBatchModal(false)}>
          <div style={{
            backgroundColor: '#1a1a2e', borderRadius: '16px', padding: '24px',
            width: '440px', maxHeight: '80vh', overflowY: 'auto'
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: '#fff' }}>Batch Generate Slideshows</h3>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
              Generate multiple slideshows from the current collection's banks
            </p>

            {/* Collection Info */}
            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(99,102,241,0.1)', marginBottom: '16px', fontSize: '12px', color: '#a5b4fc' }}>
              Collection: {collections.find(c => c.id === selectedCollection)?.name || 'None selected'}
              {(() => {
                const col = collections.find(c => c.id === selectedCollection);
                if (!col) return ' — Select a collection first';
                const aCount = col.bankA?.length || 0;
                const bCount = col.bankB?.length || 0;
                const t1Count = col.textBank1?.length || 0;
                const t2Count = col.textBank2?.length || 0;
                return ` • Bank A: ${aCount} • Bank B: ${bCount} • Text 1: ${t1Count} • Text 2: ${t2Count}`;
              })()}
            </div>

            {/* Count */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>Number of Slideshows</label>
              <input type="number" min="1" max="50" value={batchCount}
                onChange={e => setBatchCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: '#0f0f1a', color: '#fff', fontSize: '14px' }}
              />
            </div>

            {/* Slides per show */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>Slides per Slideshow</label>
              <input type="number" min="2" max="20" value={batchSlidesPerShow}
                onChange={e => setBatchSlidesPerShow(Math.max(2, Math.min(20, parseInt(e.target.value) || 2)))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: '#0f0f1a', color: '#fff', fontSize: '14px' }}
              />
            </div>

            {/* Audio selection */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>Audio Track (used for all)</label>
              <select
                value={batchAudio?.id || ''}
                onChange={e => {
                  const audio = library.filter(item => item.type === 'audio').find(a => a.id === e.target.value);
                  setBatchAudio(audio || null);
                }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: '#0f0f1a', color: '#fff', fontSize: '14px' }}
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
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer' }}
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

      {/* Audio Clip Selector Modal */}
      {pendingAudio && (
        <AudioClipSelector
          audioUrl={pendingAudio.url}
          audioName={pendingAudio.name}
          onSave={handleClipSave}
          onCancel={handleClipCancel}
        />
      )}

      {/* Upload Progress Overlay */}
      {isUploading && (
        <div style={styles.uploadOverlay}>
          <div style={styles.uploadModal}>
            <div style={styles.uploadIcon}>⬆️</div>
            <div style={styles.uploadText}>Uploading...</div>
            <div style={styles.uploadProgress}>
              {uploadProgress.current} of {uploadProgress.total}
              {uploadProgress.name && ` - ${uploadProgress.name}`}
            </div>
            <button
              onClick={handleCancelUpload}
              style={{
                marginTop: '24px',
                padding: '10px 24px',
                backgroundColor: '#ef4444',
                border: 'none',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ef4444'}
            >
              Cancel Upload
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
