import React, { useState, useEffect, useCallback } from 'react';
import AestheticHome from './AestheticHome';
import ContentLibrary from './ContentLibrary';
import VideoEditorModal from './VideoEditorModal';
import { uploadFile, deleteFile, getMediaDuration, generateThumbnail } from '../../services/firebaseStorage';
import { saveCategories, loadCategories, savePresets, loadPresets } from '../../services/storageService';

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
const VideoStudio = ({ onClose, artists = [] }) => {
  // Navigation state
  const [currentView, setCurrentView] = useState('home'); // home, library, editor
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null); // Track upload progress

  // Default categories for fresh installs
  const defaultCategories = [
    {
      id: 'boon-runway',
      artistId: 'boon',
      name: 'Runway',
      description: 'High fashion editorial content',
      thumbnail: null,
      videos: [],
      audio: [],
      createdVideos: []
    },
    {
      id: 'boon-edm',
      artistId: 'boon',
      name: 'EDM',
      description: 'High energy electronic visuals',
      thumbnail: null,
      videos: [],
      audio: [],
      createdVideos: []
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

  // Editor state
  const [editingVideo, setEditingVideo] = useState(null);
  const [showEditor, setShowEditor] = useState(false);

  // Save to localStorage when categories change
  useEffect(() => {
    saveCategories(categories);
  }, [categories]);

  // Save to localStorage when presets change
  useEffect(() => {
    savePresets(presets);
  }, [presets]);

  // Initialize with first artist
  useEffect(() => {
    if (artists.length > 0 && !selectedArtist) {
      setSelectedArtist(artists[0]);
    }
  }, [artists, selectedArtist]);

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

    setCategories(prev => prev.map(cat => {
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
            status: 'draft'
          }]
        };
      }
    }));

    // Update selected category
    setSelectedCategory(prev => {
      if (!prev) return prev;
      const updated = categories.find(c => c.id === prev.id);
      return updated || prev;
    });

    setShowEditor(false);
    setEditingVideo(null);
  }, [selectedCategory, categories]);

  const handleUploadVideos = useCallback(async (files) => {
    if (!selectedCategory) return;

    setUploadProgress({ type: 'video', current: 0, total: files.length });

    const uploadedVideos = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        setUploadProgress({ type: 'video', current: i + 1, total: files.length, name: file.name });

        // Upload to Firebase Storage
        const { url, path } = await uploadFile(file, 'videos', (progress) => {
          setUploadProgress(prev => ({ ...prev, progress }));
        });

        // Get duration and thumbnail from the uploaded file
        const duration = await getMediaDuration(url, 'video');
        const thumbnail = await generateThumbnail(url);

        uploadedVideos.push({
          id: `clip_${Date.now()}_${i}`,
          name: file.name,
          url,
          storagePath: path,
          duration,
          thumbnail,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Failed to upload video:', file.name, error);
        // Continue with other files
      }
    }

    if (uploadedVideos.length > 0) {
      setCategories(prev => prev.map(cat =>
        cat.id === selectedCategory.id
          ? { ...cat, videos: [...cat.videos, ...uploadedVideos] }
          : cat
      ));

      setSelectedCategory(prev => prev ? { ...prev, videos: [...prev.videos, ...uploadedVideos] } : prev);
    }

    setUploadProgress(null);
  }, [selectedCategory]);

  const handleUploadAudio = useCallback(async (files) => {
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

        // Get duration from the uploaded file
        const duration = await getMediaDuration(url, 'audio');

        uploadedAudio.push({
          id: `audio_${Date.now()}_${i}`,
          name: file.name,
          url,
          storagePath: path,
          duration,
          createdAt: new Date().toISOString()
        });
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

      // Create the saved clip with trim info
      const savedClip = {
        id: `audioclip_${Date.now()}`,
        name: clipData.name,
        url,
        storagePath: path,
        duration: clipData.clipDuration,
        // Store trim info so we can restore the selection
        startTime: clipData.startTime,
        endTime: clipData.endTime,
        isClip: true, // Flag to identify saved clips
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

  const handleApproveVideo = useCallback((videoId) => {
    if (!selectedCategory) return;

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? {
            ...cat,
            createdVideos: cat.createdVideos.map(v =>
              v.id === videoId ? { ...v, status: v.status === 'approved' ? 'draft' : 'approved' } : v
            )
          }
        : cat
    ));

    setSelectedCategory(prev => prev ? {
      ...prev,
      createdVideos: prev.createdVideos.map(v =>
        v.id === videoId ? { ...v, status: v.status === 'approved' ? 'draft' : 'approved' } : v
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
            onDeleteBankVideo={handleDeleteBankVideo}
            onDeleteBankAudio={handleDeleteBankAudio}
            onRenameBankVideo={handleRenameBankVideo}
            onRenameBankAudio={handleRenameBankAudio}
            onCreateContent={handleCreateContent}
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
            onClose={handleCloseEditor}
          />
        </EditorErrorBoundary>
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
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#0a0a0f',
    color: '#e5e7eb',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
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
