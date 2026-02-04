import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AestheticHome from './AestheticHome';
import ContentLibrary from './ContentLibrary';
import VideoEditorModal from './VideoEditorModal';
import BatchPipeline from './BatchPipeline';
import { uploadFile, deleteFile, getMediaDuration, generateThumbnail } from '../../services/firebaseStorage';
import { saveCategories, loadCategories, savePresets, loadPresets, cleanupStorage } from '../../services/storageService';
import { VIDEO_STATUS } from '../../utils/status';

/**
 * ErrorBoundary - Catches errors in VideoEditorModal to prevent blank page crashes
 */
class EditorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('VideoEditorModal Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#1a1a2e',
            padding: '32px',
            borderRadius: '12px',
            maxWidth: '500px',
            textAlign: 'center'
          }}>
            <h2 style={{ color: '#ef4444', marginBottom: '16px' }}>Something went wrong</h2>
            <p style={{ color: '#9ca3af', marginBottom: '24px' }}>
              The video editor encountered an error. Please try again.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onClose?.();
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Close Editor
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * VideoStudio - Main container for the Flowstage-inspired video creation workflow
 *
 * Flow:
 * 1. Aesthetic Home - View/manage content banks (videos, audio) per category
 * 2. Content Library - View all created videos, edit them anytime
 * 3. Editor Modal - Create/edit videos with presets and sync tools
 */

// Session persistence key
const SESSION_KEY = 'stm_studio_session';

// Helper to load session state
const loadSessionState = () => {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      console.log('[Session] Loaded:', parsed);
      return parsed;
    }
  } catch (e) {
    console.warn('Failed to load session state:', e);
  }
  return null;
};

// Helper to save session state
const saveSessionState = (state) => {
  try {
    const toSave = {
      ...state,
      savedAt: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(toSave));
    console.log('[Session] Saved:', toSave);
  } catch (e) {
    console.warn('Failed to save session state:', e);
  }
};

const VideoStudio = ({
  onClose,
  artists = [],
  lateAccountIds = {},
  onSchedulePost
}) => {
  // Load saved session for initial state
  const savedSession = useMemo(() => loadSessionState(), []);

  // Navigation state - restore from session if available
  const [currentView, setCurrentView] = useState(savedSession?.currentView || 'home');
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null); // Track upload progress
  const [sessionRestored, setSessionRestored] = useState(false);

  // Derive accounts array from lateAccountIds for PostingModule
  const accounts = useMemo(() => {
    return Object.entries(lateAccountIds).map(([handle, ids]) => ({
      handle,
      tiktokId: ids.tiktok,
      instagramId: ids.instagram
    }));
  }, [lateAccountIds]);

  // Default categories for fresh installs
  // accountHandle links category to Late.co account for auto-scheduling
  // defaultPreset contains text style and cut settings for batch generation
  // captionTemplate uses {title}, {hashtags}, {index} placeholders
  const defaultCategories = [
    {
      id: 'boon-runway',
      artistId: 'boon',
      name: 'Runway',
      description: 'High fashion editorial content',
      accountHandle: '@margiela.mommy', // Linked Late.co account
      thumbnail: null,
      videos: [],
      audio: [],
      createdVideos: [],
      // New: Category defaults for batch generation
      defaultPreset: {
        textStyle: {
          fontSize: 48,
          fontFamily: "'Playfair Display', serif",
          fontWeight: '300',
          color: '#ffffff',
          outline: true,
          outlineColor: 'rgba(0,0,0,0.3)',
          textCase: 'upper'
        },
        cutStyle: 'beat',
        beatsPerCut: 2
      },
      captionTemplate: '{title} ✨ #fashion #runway {hashtags}',
      defaultHashtags: '#aesthetic #fyp #style #viral'
    },
    {
      id: 'boon-edm',
      artistId: 'boon',
      name: 'EDM',
      description: 'High energy electronic visuals',
      accountHandle: '@neonphoebe', // Linked Late.co account
      thumbnail: null,
      videos: [],
      audio: [],
      createdVideos: [],
      // New: Category defaults for batch generation
      defaultPreset: {
        textStyle: {
          fontSize: 72,
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: '900',
          color: '#00ff88',
          outline: true,
          outlineColor: '#000000',
          textCase: 'upper'
        },
        cutStyle: 'beat',
        beatsPerCut: 1
      },
      captionTemplate: '{title} 🔥 #edm #rave {hashtags}',
      defaultHashtags: '#dj #electronic #music #fyp'
    }
  ];

  const defaultPresets = [
    {
      id: 'preset-fashion-minimal',
      name: 'Fashion Minimal',
      categoryId: 'boon-runway',
      settings: {
        fontSize: 48,
        fontFamily: "'Playfair Display', serif",
        fontWeight: '300',
        color: '#ffffff',
        outline: true,
        outlineColor: 'rgba(0,0,0,0.3)',
        textCase: 'upper',
        letterSpacing: '0.2em',
        displayMode: 'word',
        beatsPerCut: 2
      }
    },
    {
      id: 'preset-edm-bold',
      name: 'EDM Bold',
      categoryId: 'boon-edm',
      settings: {
        fontSize: 72,
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: '900',
        color: '#00ff88',
        outline: true,
        outlineColor: '#000000',
        textCase: 'upper',
        letterSpacing: '0',
        displayMode: 'word',
        beatsPerCut: 1
      }
    }
  ];

  // Load from localStorage or use defaults
  const [categories, setCategories] = useState(() => {
    const saved = loadCategories();
    return saved.length > 0 ? saved : defaultCategories;
  });

  const [presets, setPresets] = useState(() => {
    const saved = loadPresets();
    return saved.length > 0 ? saved : defaultPresets;
  });

  // Editor state - restore showEditor from session if they were in the editor
  const [editingVideo, setEditingVideo] = useState(null);
  const [showEditor, setShowEditor] = useState(savedSession?.showEditor || false);
  const [showBatchPipeline, setShowBatchPipeline] = useState(false);

  // Save to localStorage when categories change
  useEffect(() => {
    const success = saveCategories(categories);
    if (!success) {
      // Storage quota exceeded - try cleanup and retry
      console.warn('Storage save failed, attempting cleanup...');
      cleanupStorage();
      // Retry save after cleanup
      saveCategories(categories);
    }
  }, [categories]);

  // Save to localStorage when presets change
  useEffect(() => {
    savePresets(presets);
  }, [presets]);

  // Initialize with first artist and restore session
  useEffect(() => {
    if (artists.length > 0 && !selectedArtist) {
      setSelectedArtist(artists[0]);
    }
  }, [artists, selectedArtist]);

  // Restore full session state after categories are loaded
  useEffect(() => {
    if (sessionRestored || categories.length === 0) return;

    const saved = loadSessionState();
    if (saved && saved.categoryId) {
      // Find the saved category
      const category = categories.find(c => c.id === saved.categoryId);
      if (category) {
        console.log('[Session] Restoring:', saved.currentView, category.name, 'editor:', saved.showEditor);
        setSelectedCategory(category);
        setCurrentView(saved.currentView || 'home');
        // showEditor is already set from initial state
      }
    }
    setSessionRestored(true);
  }, [categories, sessionRestored]);

  // Save session state when navigation changes
  useEffect(() => {
    if (!sessionRestored) return; // Don't save during initial restore

    saveSessionState({
      currentView,
      categoryId: selectedCategory?.id || null,
      artistId: selectedArtist?.id || null,
      showEditor
    });
  }, [currentView, selectedCategory?.id, selectedArtist?.id, showEditor, sessionRestored]);

  // Get categories for selected artist
  const artistCategories = categories.filter(c =>
    c.artistId === selectedArtist?.id || c.artistId === null
  );

  // Handlers
  const handleSelectCategory = useCallback((category) => {
    setSelectedCategory(category);
  }, []);

  const handleCreateContent = useCallback(() => {
    setCurrentView('library');
  }, []);

  const handleMakeVideo = useCallback((existingVideo = null) => {
    setEditingVideo(existingVideo);
    setShowEditor(true);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setShowEditor(false);
    setEditingVideo(null);
  }, []);

  const handleSaveVideo = useCallback((videoData) => {
    if (!selectedCategory) return;

    // Build the updated category data
    const updateCategory = (cat) => {
      if (cat.id !== selectedCategory.id) return cat;

      const existingIndex = cat.createdVideos.findIndex(v => v.id === videoData.id);
      if (existingIndex >= 0) {
        // Update existing
        const newVideos = [...cat.createdVideos];
        newVideos[existingIndex] = { ...videoData, updatedAt: new Date().toISOString() };
        return { ...cat, createdVideos: newVideos };
      } else {
        // Add new
        return {
          ...cat,
          createdVideos: [...cat.createdVideos, {
            ...videoData,
            id: `video_${Date.now()}`,
            createdAt: new Date().toISOString(),
            status: VIDEO_STATUS.DRAFT
          }]
        };
      }
    };

    // Update categories
    setCategories(prev => prev.map(updateCategory));

    // Update selected category with the same logic (avoids stale closure)
    setSelectedCategory(prev => {
      if (!prev) return prev;
      return updateCategory(prev);
    });

    setShowEditor(false);
    setEditingVideo(null);
    // Navigate to content library after saving
    setCurrentView('library');
  }, [selectedCategory]);

  const handleUploadVideos = useCallback(async (files) => {
    if (!selectedCategory) return;

    setUploadProgress({ type: 'video', current: 0, total: files.length });

    const uploadedVideos = [];
    const failedUploads = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`Starting upload ${i + 1}/${files.length}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

      try {
        setUploadProgress({ type: 'video', current: i + 1, total: files.length, name: file.name, progress: 0 });

        // Upload to Firebase Storage
        const { url, path } = await uploadFile(file, 'videos', (progress) => {
          setUploadProgress(prev => ({ ...prev, progress }));
        });

        console.log(`Upload complete for ${file.name}, getting metadata...`);

        // Get duration and thumbnail from local blob (more reliable than Firebase URL due to CORS)
        let duration = 0;
        let thumbnail = null;
        const localBlobUrl = URL.createObjectURL(file);

        try {
          duration = await getMediaDuration(localBlobUrl, 'video');
        } catch (e) {
          console.warn('Could not get video duration:', file.name, e.message);
        }

        try {
          thumbnail = await generateThumbnail(localBlobUrl);
        } catch (e) {
          console.warn('Could not generate thumbnail:', file.name, e.message);
        }

        // Keep blob URL for current session playback (avoids CORS issues)
        // Note: Don't revoke - we need it for video preview in current session
        // URL.revokeObjectURL(localBlobUrl); // Commented out to keep for playback

        uploadedVideos.push({
          id: `clip_${Date.now()}_${i}`,
          name: file.name,
          url,
          localUrl: localBlobUrl, // Local blob URL for current session (no CORS issues)
          storagePath: path,
          duration,
          thumbnail,
          createdAt: new Date().toISOString()
        });

        console.log('✓ Video uploaded successfully:', file.name);

        // Small delay between uploads to avoid rate limiting
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error('✗ Failed to upload video:', file.name, error.message || error);
        failedUploads.push({ name: file.name, error: error.message || 'Unknown error' });
        // Continue with other files
      }
    }

    // Log summary
    console.log(`Upload summary: ${uploadedVideos.length} succeeded, ${failedUploads.length} failed`);
    if (failedUploads.length > 0) {
      console.warn('Failed uploads:', failedUploads);
    }

    console.log('Upload complete. Videos to add:', uploadedVideos.length);

    if (uploadedVideos.length > 0) {
      setCategories(prev => {
        const updated = prev.map(cat =>
          cat.id === selectedCategory.id
            ? { ...cat, videos: [...cat.videos, ...uploadedVideos] }
            : cat
        );
        console.log('Categories updated, total videos in category:', updated.find(c => c.id === selectedCategory.id)?.videos.length);
        return updated;
      });

      setSelectedCategory(prev => {
        if (!prev) return prev;
        const updated = { ...prev, videos: [...prev.videos, ...uploadedVideos] };
        console.log('Selected category updated, videos:', updated.videos.length);
        return updated;
      });
    } else {
      console.warn('No videos were successfully uploaded');
    }

    setUploadProgress(null);
  }, [selectedCategory]);

  const handleUploadAudio = useCallback(async (files, trimData = null) => {
    if (!selectedCategory) return;

    setUploadProgress({ type: 'audio', current: 0, total: files.length });

    const uploadedAudio = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        setUploadProgress({ type: 'audio', current: i + 1, total: files.length, name: file.name });

        // Upload to Firebase Storage
        const { url, path } = await uploadFile(file, 'audio', (progress) => {
          setUploadProgress(prev => ({ ...prev, progress }));
        });

        // Create local blob URL for reliable metadata access and beat detection (avoids CORS)
        const localBlobUrl = URL.createObjectURL(file);

        // Get duration from local blob (more reliable than Firebase URL due to CORS)
        let fullDuration = 0;
        try {
          fullDuration = await getMediaDuration(localBlobUrl, 'audio');
        } catch (e) {
          console.warn('Could not get audio duration:', file.name, e.message);
          // Try from Firebase URL as fallback
          fullDuration = await getMediaDuration(url, 'audio').catch(() => 0);
        }

        // Use trim data if provided, otherwise use full duration
        const audioData = {
          id: `audio_${Date.now()}_${i}`,
          name: file.name,
          url,
          localUrl: localBlobUrl, // Local blob URL for beat detection and playback (no CORS)
          file: file, // Keep original file for beat detection
          storagePath: path,
          fullDuration, // Store the full duration for reference
          duration: trimData?.clipDuration || fullDuration, // Use trimmed duration if provided
          createdAt: new Date().toISOString()
        };

        // Add trim boundaries if trim data was provided
        if (trimData) {
          audioData.startTime = trimData.startTime;
          audioData.endTime = trimData.endTime;
          audioData.isTrimmed = true;
          console.log(`Audio uploaded with trim: ${trimData.startTime.toFixed(1)}s - ${trimData.endTime.toFixed(1)}s`);
        }

        uploadedAudio.push(audioData);
      } catch (error) {
        console.error('Failed to upload audio:', file.name, error);
        // Continue with other files
      }
    }

    if (uploadedAudio.length > 0) {
      setCategories(prev => prev.map(cat =>
        cat.id === selectedCategory.id
          ? { ...cat, audio: [...cat.audio, ...uploadedAudio] }
          : cat
      ));

      setSelectedCategory(prev => prev ? { ...prev, audio: [...prev.audio, ...uploadedAudio] } : prev);
    }

    setUploadProgress(null);
  }, [selectedCategory]);

  // Save a trimmed audio clip to the library for reuse
  const handleSaveAudioClip = useCallback(async (clipData) => {
    if (!selectedCategory) return;

    setUploadProgress({ type: 'audio', current: 1, total: 1, name: clipData.name });

    try {
      // Upload the original file to Firebase Storage
      const { url, path } = await uploadFile(clipData.file, 'audio', (progress) => {
        setUploadProgress(prev => ({ ...prev, progress }));
      });

      // Create local blob URL for reliable playback (avoids CORS)
      const localBlobUrl = URL.createObjectURL(clipData.file);

      // Create the saved clip with trim info
      const savedClip = {
        id: `audioclip_${Date.now()}`,
        name: clipData.name,
        url,
        localUrl: localBlobUrl, // Local blob URL for current session (no CORS)
        file: clipData.file, // Keep file reference for beat detection
        storagePath: path,
        duration: clipData.clipDuration,
        // Store trim info so we can restore the selection
        startTime: clipData.startTime,
        endTime: clipData.endTime,
        isClip: true, // Flag to identify saved clips
        autoSaved: clipData.autoSaved || false, // Was this auto-saved from "Use this clip"?
        savedLyrics: [], // Initialize empty lyrics array
        createdAt: new Date().toISOString()
      };

      setCategories(prev => prev.map(cat =>
        cat.id === selectedCategory.id
          ? { ...cat, audio: [...cat.audio, savedClip] }
          : cat
      ));

      setSelectedCategory(prev => prev ? { ...prev, audio: [...prev.audio, savedClip] } : prev);
    } catch (error) {
      console.error('Failed to save audio clip:', error);
    }

    setUploadProgress(null);
  }, [selectedCategory]);

  // Save lyrics template to an audio track
  const handleSaveLyricsToAudio = useCallback((audioId, lyricsData) => {
    if (!selectedCategory) return;

    const lyricsEntry = {
      id: `lyrics_${Date.now()}`,
      name: lyricsData.name || 'Untitled Lyrics',
      words: lyricsData.words || [],
      createdAt: new Date().toISOString()
    };

    const updateCategory = (cat) => {
      if (cat.id !== selectedCategory.id) return cat;
      return {
        ...cat,
        audio: cat.audio.map(audio =>
          audio.id === audioId
            ? {
                ...audio,
                savedLyrics: [...(audio.savedLyrics || []), lyricsEntry]
              }
            : audio
        )
      };
    };

    setCategories(prev => prev.map(updateCategory));
    setSelectedCategory(prev => prev ? updateCategory(prev) : prev);

    console.log('[Lyrics] Saved lyrics to audio:', audioId, lyricsEntry);
  }, [selectedCategory]);

  const handleDeleteVideo = useCallback(async (videoId) => {
    if (!selectedCategory) return;

    // Find the video to get its storage path
    const video = selectedCategory.createdVideos.find(v => v.id === videoId);

    // Delete from Firebase Storage if there's a storage path
    if (video?.storagePath) {
      await deleteFile(video.storagePath);
    }
    // Also try to delete thumbnail if it has a storage path
    if (video?.thumbnailPath) {
      await deleteFile(video.thumbnailPath);
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, createdVideos: cat.createdVideos.filter(v => v.id !== videoId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      createdVideos: prev.createdVideos.filter(v => v.id !== videoId)
    } : prev);
  }, [selectedCategory]);

  // Delete a video clip from the bank (source videos)
  const handleDeleteBankVideo = useCallback(async (videoId) => {
    if (!selectedCategory) return;

    // Find the video to get its storage path
    const video = selectedCategory.videos.find(v => v.id === videoId);

    // Delete from Firebase Storage if there's a storage path
    if (video?.storagePath) {
      const result = await deleteFile(video.storagePath);
      console.log('Deleted video from storage:', result);
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, videos: cat.videos.filter(v => v.id !== videoId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      videos: prev.videos.filter(v => v.id !== videoId)
    } : prev);
  }, [selectedCategory]);

  // Delete an audio track from the bank
  const handleDeleteBankAudio = useCallback(async (audioId) => {
    if (!selectedCategory) return;

    // Find the audio to get its storage path
    const audio = selectedCategory.audio.find(a => a.id === audioId);

    // Delete from Firebase Storage if there's a storage path
    if (audio?.storagePath) {
      const result = await deleteFile(audio.storagePath);
      console.log('Deleted audio from storage:', result);
    }

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, audio: cat.audio.filter(a => a.id !== audioId) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      audio: prev.audio.filter(a => a.id !== audioId)
    } : prev);
  }, [selectedCategory]);

  // Rename a video clip in the bank
  const handleRenameBankVideo = useCallback((videoId, newName) => {
    if (!selectedCategory || !newName.trim()) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, videos: cat.videos.map(v => v.id === videoId ? { ...v, name: newName.trim() } : v) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      videos: prev.videos.map(v => v.id === videoId ? { ...v, name: newName.trim() } : v)
    } : prev);
  }, [selectedCategory]);

  // Rename an audio track in the bank
  const handleRenameBankAudio = useCallback((audioId, newName) => {
    if (!selectedCategory || !newName.trim()) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, audio: cat.audio.map(a => a.id === audioId ? { ...a, name: newName.trim() } : a) }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      audio: prev.audio.map(a => a.id === audioId ? { ...a, name: newName.trim() } : a)
    } : prev);
  }, [selectedCategory]);

  // Edit/re-trim an existing audio track
  const handleEditAudio = useCallback((audioId, trimData) => {
    if (!selectedCategory) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? {
            ...cat,
            audio: cat.audio.map(a => a.id === audioId ? {
              ...a,
              startTime: trimData.startTime,
              endTime: trimData.endTime,
              duration: trimData.duration
            } : a)
          }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      audio: prev.audio.map(a => a.id === audioId ? {
        ...a,
        startTime: trimData.startTime,
        endTime: trimData.endTime,
        duration: trimData.duration
      } : a)
    } : prev);
  }, [selectedCategory]);

  const handleApproveVideo = useCallback((videoId) => {
    if (!selectedCategory) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? {
            ...cat,
            createdVideos: cat.createdVideos.map(v =>
              v.id === videoId ? { ...v, status: v.status === VIDEO_STATUS.APPROVED ? VIDEO_STATUS.DRAFT : VIDEO_STATUS.APPROVED } : v
            )
          }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      createdVideos: prev.createdVideos.map(v =>
        v.id === videoId ? { ...v, status: v.status === VIDEO_STATUS.APPROVED ? VIDEO_STATUS.DRAFT : VIDEO_STATUS.APPROVED } : v
      )
    } : prev);
  }, [selectedCategory]);

  // Update a video with new fields (used after rendering)
  const handleUpdateVideo = useCallback((videoId, updates) => {
    if (!selectedCategory) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? {
            ...cat,
            createdVideos: cat.createdVideos.map(v =>
              v.id === videoId ? { ...v, ...updates } : v
            )
          }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      createdVideos: prev.createdVideos.map(v =>
        v.id === videoId ? { ...v, ...updates } : v
      )
    } : prev);
  }, [selectedCategory]);

  const handleCreateCategory = useCallback((categoryData) => {
    const newCategory = {
      id: `cat_${Date.now()}`,
      artistId: selectedArtist?.id,
      videos: [],
      audio: [],
      createdVideos: [],
      ...categoryData
    };
    setCategories(prev => [...prev, newCategory]);
    setSelectedCategory(newCategory);
  }, [selectedArtist]);

  const handleSavePreset = useCallback((presetData) => {
    const newPreset = {
      id: `preset_${Date.now()}`,
      categoryId: selectedCategory?.id,
      ...presetData
    };
    setPresets(prev => [...prev, newPreset]);
  }, [selectedCategory]);

  const categoryPresets = presets.filter(p =>
    p.categoryId === selectedCategory?.id || p.categoryId === null
  );

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={onClose} style={styles.logoButton}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5,3 19,12 5,21" fill="currentColor"/>
            </svg>
            <span style={styles.logoText}>StickToMusic Studio</span>
          </button>
        </div>

        <div style={styles.headerCenter}>
          {selectedCategory && currentView !== 'home' && (
            <div style={styles.breadcrumb}>
              <button
                style={styles.breadcrumbLink}
                onClick={() => { setCurrentView('home'); setSelectedCategory(null); }}
              >
                {selectedArtist?.name}
              </button>
              <span style={styles.breadcrumbSep}>/</span>
              <button
                style={styles.breadcrumbLink}
                onClick={() => setCurrentView('home')}
              >
                {selectedCategory.name}
              </button>
              {currentView === 'library' && (
                <>
                  <span style={styles.breadcrumbSep}>/</span>
                  <span style={styles.breadcrumbCurrent}>Content</span>
                </>
              )}
            </div>
          )}
        </div>

        <div style={styles.headerRight}>
          <button onClick={onClose} style={styles.closeButton}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {currentView === 'home' && (
          <AestheticHome
            artists={artists}
            selectedArtist={selectedArtist}
            onSelectArtist={setSelectedArtist}
            categories={artistCategories}
            selectedCategory={selectedCategory}
            onSelectCategory={handleSelectCategory}
            onCreateCategory={handleCreateCategory}
            onUploadVideos={handleUploadVideos}
            onUploadAudio={handleUploadAudio}
            onSaveAudioClip={handleSaveAudioClip}
            onEditAudio={handleEditAudio}
            onDeleteBankVideo={handleDeleteBankVideo}
            onDeleteBankAudio={handleDeleteBankAudio}
            onRenameBankVideo={handleRenameBankVideo}
            onRenameBankAudio={handleRenameBankAudio}
            onCreateContent={handleCreateContent}
            onShowBatchPipeline={() => setShowBatchPipeline(true)}
            onViewContent={() => setCurrentView('library')}
          />
        )}

        {currentView === 'library' && selectedCategory && (
          <ContentLibrary
            category={selectedCategory}
            onBack={() => setCurrentView('home')}
            onMakeVideo={handleMakeVideo}
            onEditVideo={handleMakeVideo}
            onDeleteVideo={handleDeleteVideo}
            onApproveVideo={handleApproveVideo}
            onUpdateVideo={handleUpdateVideo}
            onSchedulePost={onSchedulePost}
            onShowBatchPipeline={() => setShowBatchPipeline(true)}
            accounts={accounts}
            lateAccountIds={lateAccountIds}
          />
        )}
      </main>

      {/* Editor Modal with ErrorBoundary to prevent blank page crashes */}
      {showEditor && selectedCategory && (
        <EditorErrorBoundary onClose={handleCloseEditor}>
          <VideoEditorModal
            category={selectedCategory}
            existingVideo={editingVideo}
            presets={categoryPresets}
            onSave={handleSaveVideo}
            onSavePreset={handleSavePreset}
            onSaveLyrics={handleSaveLyricsToAudio}
            onClose={handleCloseEditor}
          />
        </EditorErrorBoundary>
      )}

      {/* Batch Pipeline - Streamlined batch create & schedule */}
      {showBatchPipeline && selectedCategory && (
        <BatchPipeline
          category={selectedCategory}
          lateAccountIds={lateAccountIds}
          onSchedulePost={onSchedulePost}
          onClose={() => setShowBatchPipeline(false)}
          onSaveLyrics={(audioId, lyricsData) => handleSaveLyricsToAudio(audioId, lyricsData)}
          onVideosCreated={(videos) => {
            // Add created videos to category
            setCategories(prev => prev.map(cat =>
              cat.id === selectedCategory.id
                ? { ...cat, createdVideos: [...cat.createdVideos, ...videos] }
                : cat
            ));
            setSelectedCategory(prev => prev ? {
              ...prev,
              createdVideos: [...prev.createdVideos, ...videos]
            } : prev);
          }}
          onEditVideo={(video) => {
            // Open video in full editor
            setShowBatchPipeline(false);
            handleMakeVideo(video);
          }}
          onNavigateToLibrary={() => {
            // Navigate to content library to view drafts
            setShowBatchPipeline(false);
            setCurrentView('library');
          }}
        />
      )}

      {/* UI-20: Upload Progress Overlay */}
      {uploadProgress && (
        <div style={styles.uploadOverlay}>
          <div style={styles.uploadModal}>
            <div style={styles.uploadIcon}>
              {uploadProgress.type === 'video' ? '🎬' : '🎵'}
            </div>
            <h3 style={styles.uploadTitle}>
              Uploading {uploadProgress.type === 'video' ? 'Videos' : 'Audio'}
            </h3>
            <p style={styles.uploadStatus}>
              {uploadProgress.current} of {uploadProgress.total}
              {uploadProgress.name && ` — ${uploadProgress.name}`}
            </p>
            <div style={styles.uploadProgressBar}>
              <div
                style={{
                  ...styles.uploadProgressFill,
                  width: `${uploadProgress.progress || 0}%`
                }}
              />
            </div>
            <p style={styles.uploadPercent}>
              {Math.round(uploadProgress.progress || 0)}%
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: 'rgba(10, 10, 15, 0.98)',
    backdropFilter: 'blur(8px)',
    color: '#e5e7eb',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 0 60px rgba(0, 0, 0, 0.8)'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    backgroundColor: '#111118',
    borderBottom: '1px solid #1f1f2e'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center'
  },
  headerCenter: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center'
  },
  logoButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    borderRadius: '8px'
  },
  logoText: {
    fontSize: '15px',
    fontWeight: '600'
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px'
  },
  breadcrumbLink: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '13px'
  },
  breadcrumbSep: {
    color: '#4b5563'
  },
  breadcrumbCurrent: {
    color: '#fff'
  },
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '8px'
  },
  main: {
    flex: 1,
    overflow: 'hidden'
  },
  // UI-20: Upload progress overlay styles
  uploadOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  },
  uploadModal: {
    backgroundColor: '#111118',
    borderRadius: '16px',
    padding: '32px 48px',
    textAlign: 'center',
    minWidth: '300px'
  },
  uploadIcon: {
    fontSize: '48px',
    marginBottom: '16px'
  },
  uploadTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 8px 0'
  },
  uploadStatus: {
    fontSize: '13px',
    color: '#9ca3af',
    margin: '0 0 20px 0'
  },
  uploadProgressBar: {
    width: '100%',
    height: '6px',
    backgroundColor: '#1f1f2e',
    borderRadius: '3px',
    overflow: 'hidden'
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: '#7c3aed',
    borderRadius: '3px',
    transition: 'width 0.3s ease'
  },
  uploadPercent: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#7c3aed',
    margin: '16px 0 0 0'
  }
};

export default VideoStudio;
