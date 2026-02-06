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
import {
  getLibrary,
  getCollections,
  getUserCollections,
  getCollectionMedia,
  addToLibrary,
  addManyToLibrary,
  getCreatedContent,
  addCreatedVideo,
  getLyrics,
  addLyrics,
  updateLyrics,
  deleteLyrics,
  getOnboardingStatus,
  incrementUseCount,
  MEDIA_TYPES,
  STARTER_TEMPLATES,
  // Firestore async functions
  subscribeToLibrary,
  addToLibraryAsync,
  addManyToLibraryAsync,
  migrateToFirestore
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

  // Library State
  const [library, setLibrary] = useState([]);
  const [collections, setCollections] = useState([]);
  const [lyrics, setLyrics] = useState([]);
  const [createdContent, setCreatedContent] = useState({ videos: [], slideshows: [] });

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [libraryRefreshTrigger, setLibraryRefreshTrigger] = useState(0);

  // Upload cancellation
  const cancelFunctionsRef = useRef([]);

  // Audio clip selector
  const [pendingAudio, setPendingAudio] = useState(null);
  const [editingAudio, setEditingAudio] = useState(null);

  // Selected media for editor
  const [selectedMedia, setSelectedMedia] = useState({
    videos: [],
    audio: null,
    images: []
  });

  // File input refs
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const imageInputRef = useRef(null);

  // Mobile detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load data when artist changes - use Firestore subscription if available
  useEffect(() => {
    if (!artistId) return;

    // Load non-library data from localStorage (will migrate these later)
    setCollections(getCollections(artistId));
    setLyrics(getLyrics(artistId));
    setCreatedContent(getCreatedContent(artistId));

    // For library, use Firestore real-time subscription if db is available
    if (db) {
      console.log('[StudioHome] Setting up Firestore subscription for library');

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

      // Subscribe to real-time updates
      const unsubscribe = subscribeToLibrary(db, artistId, (items) => {
        setLibrary(items);
      });

      return () => unsubscribe();
    } else {
      // Fallback to localStorage
      console.log('[StudioHome] Using localStorage (no db available)');
      setLibrary(getLibrary(artistId));
    }
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

  // =====================
  // UPLOAD HANDLERS
  // =====================

  const handleFileUpload = async (files, type) => {
    if (!files.length) return;

    console.log('[StudioHome] Starting upload for', files.length, 'files, artistId:', artistId, 'type:', type);

    if (!artistId) {
      console.error('[StudioHome] No artistId - cannot save to library');
      alert('Error: No artist selected. Please select an artist first.');
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

        if (type === MEDIA_TYPES.IMAGE) {
          const img = new Image();
          img.src = localUrl;
          await new Promise(r => { img.onload = r; });
          width = img.naturalWidth;
          height = img.naturalHeight;
        }

        const item = {
          type,
          name: file.name,
          url,
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

        // Keep local URL for current session
        item.localUrl = localUrl;

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
        // Note: If using Firestore subscription, library will auto-update via onSnapshot
        if (!db) loadData(); // Only reload from localStorage if no Firestore
        // Trigger LibraryBrowser refresh
        setLibraryRefreshTrigger(prev => prev + 1);
      } catch (saveError) {
        console.error('[StudioHome] Failed to save to library:', saveError);
        alert('Files uploaded but failed to save to library: ' + saveError.message);
      }
    }

    // Show feedback about what happened
    if (failedFiles.length > 0) {
      const failedNames = failedFiles.map(f => f.name).join(', ');
      alert(`Upload failed for: ${failedNames}\n\nError: ${failedFiles[0].error}\n\nCheck browser console for details.`);
    } else if (uploadedItems.length === 0) {
      console.error('[StudioHome] No items were successfully uploaded');
      alert('No files were uploaded. Please check if Firebase is configured correctly.');
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
      alert('Error: No artist selected. Please select an artist first.');
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
      alert('Error: Audio duration is invalid or too short (must be at least 1 second). Please try again.');
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
      alert('Audio upload failed: ' + error.message);
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

  const handleSelectMedia = (media) => {
    if (media.type === MEDIA_TYPES.VIDEO) {
      // Toggle video selection
      setSelectedMedia(prev => {
        const isSelected = prev.videos.some(v => v.id === media.id);
        return {
          ...prev,
          videos: isSelected
            ? prev.videos.filter(v => v.id !== media.id)
            : [...prev.videos, media]
        };
      });
    } else if (media.type === MEDIA_TYPES.AUDIO) {
      // Single audio selection
      setSelectedMedia(prev => ({
        ...prev,
        audio: prev.audio?.id === media.id ? null : media
      }));
    } else if (media.type === MEDIA_TYPES.IMAGE) {
      // Toggle image selection
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

    // Increment use count
    incrementUseCount(artistId, media.id);
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
        pullFromCollection: selectedCollection
      });
    }
  };

  // =====================
  // COMPUTED VALUES
  // =====================

  const videoCount = createdContent.videos.length;
  const slideshowCount = createdContent.slideshows.length;

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

              <div style={styles.libraryHeader}>
                <span style={styles.libraryTitle}>
                  Audio ({libraryAudio.length})
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

              {/* Audio list */}
              <div style={{ padding: '8px 24px', maxHeight: '150px', overflowY: 'auto' }}>
                {libraryAudio.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '16px' }}>
                    No audio uploaded yet
                  </div>
                ) : (
                  libraryAudio.map(audio => (
                    <div
                      key={audio.id}
                      onClick={() => handleSelectMedia(audio)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        backgroundColor: selectedMedia.audio?.id === audio.id
                          ? 'rgba(99, 102, 241, 0.2)'
                          : 'rgba(255,255,255,0.05)',
                        borderRadius: '8px',
                        marginBottom: '8px',
                        cursor: 'pointer'
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>🎵</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: '500' }}>{audio.name}</div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                          {audio.duration ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}` : ''}
                        </div>
                      </div>
                      {selectedMedia.audio?.id === audio.id && (
                        <span style={{ color: '#6366f1' }}>✓</span>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Action Bar */}
              <div style={styles.actionBar}>
                <div style={styles.actionInfo}>
                  {selectedMedia.videos.length} clips selected
                  {selectedMedia.audio && ` • Audio: ${selectedMedia.audio.name}`}
                </div>
                <div style={styles.actionButtons}>
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
                </div>
                <div style={styles.actionButtons}>
                  <button
                    style={{...styles.actionButton, ...styles.secondaryButton}}
                    onClick={() => onViewContent?.({ type: 'slideshows' })}
                  >
                    View Library
                  </button>
                  <button
                    style={{
                      ...styles.actionButton,
                      ...styles.primaryButton,
                      opacity: selectedMedia.images.length === 0 ? 0.5 : 1
                    }}
                    onClick={() => handleLaunchSlideshowEditor()}
                  >
                    Create Slideshow
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
    </div>
  );
};

export default StudioHome;
