import React, { useState, useEffect, useCallback } from 'react';
import AestheticHome from './AestheticHome';
import ContentLibrary from './ContentLibrary';
import VideoEditorModal from './VideoEditorModal';
import {
  saveCategories,
  loadCategories,
  savePresets,
  loadPresets
} from '../../services/storageService';
import { generateThumbnailFromUrl } from '../../utils/thumbnailGenerator';
import {
  fetchLateAccounts,
  isLateConnected,
  connectLate,
  disconnectLate
} from '../../services/lateService';

/**
 * VideoStudio - Main container for the Flowstage-inspired video creation workflow
 *
 * Flow:
 * 1. Aesthetic Home - View/manage content banks (videos, audio) per category
 * 2. Content Library - View all created videos, edit them anytime
 * 3. Editor Modal - Create/edit videos with presets and sync tools
 */
const VideoStudio = ({ onClose, artists = [], onSchedulePost, lateAccounts: externalLateAccounts = [] }) => {
  // Navigation state
  const [currentView, setCurrentView] = useState('home'); // home, library, editor
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Late connection state
  const [lateAccounts, setLateAccounts] = useState(externalLateAccounts);
  const [showLateConnect, setShowLateConnect] = useState(false);
  const [lateToken, setLateToken] = useState('');
  const [lateConnecting, setLateConnecting] = useState(false);
  const [lateError, setLateError] = useState('');
  const [lateConnected, setLateConnected] = useState(false);

  // Default categories for first-time users
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

  // Default presets for first-time users
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

  // Data state - initialized from localStorage
  const [categories, setCategories] = useState([]);
  const [presets, setPresets] = useState([]);

  // Load data from localStorage on mount
  useEffect(() => {
    const storedCategories = loadCategories();
    const storedPresets = loadPresets();

    // Use stored data or defaults
    setCategories(storedCategories.length > 0 ? storedCategories : defaultCategories);
    setPresets(storedPresets.length > 0 ? storedPresets : defaultPresets);
    setIsLoading(false);

    // Check Late connection
    if (isLateConnected()) {
      setLateConnected(true);
      fetchLateAccounts()
        .then(accounts => setLateAccounts(accounts))
        .catch(err => {
          if (err.message === 'INVALID_TOKEN') setLateConnected(false);
        });
    }
  }, []);

  // Late handlers
  const handleConnectLate = useCallback(async () => {
    if (!lateToken.trim()) {
      setLateError('Please enter your Late API token');
      return;
    }
    setLateConnecting(true);
    setLateError('');
    try {
      const result = await connectLate(lateToken.trim());
      setLateAccounts(result.accounts);
      setLateConnected(true);
      setShowLateConnect(false);
      setLateToken('');
    } catch (err) {
      setLateError(err.message || 'Failed to connect');
    } finally {
      setLateConnecting(false);
    }
  }, [lateToken]);

  const handleDisconnectLate = useCallback(() => {
    disconnectLate();
    setLateAccounts([]);
    setLateConnected(false);
  }, []);

  const handleRefreshLate = useCallback(async () => {
    if (!isLateConnected()) return;
    setLateConnecting(true);
    try {
      const accounts = await fetchLateAccounts();
      setLateAccounts(accounts);
    } catch (err) {
      if (err.message === 'INVALID_TOKEN') {
        setLateConnected(false);
        setLateAccounts([]);
      }
    } finally {
      setLateConnecting(false);
    }
  }, []);

  // Save categories to localStorage whenever they change
  useEffect(() => {
    if (!isLoading && categories.length > 0) {
      saveCategories(categories);
    }
  }, [categories, isLoading]);

  // Save presets to localStorage whenever they change
  useEffect(() => {
    if (!isLoading && presets.length > 0) {
      savePresets(presets);
    }
  }, [presets, isLoading]);

  // Editor state
  const [editingVideo, setEditingVideo] = useState(null);
  const [showEditor, setShowEditor] = useState(false);

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

    // Create initial video entries
    const newVideos = Array.from(files).map((file, i) => ({
      id: `clip_${Date.now()}_${i}`,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
      duration: 0,
      thumbnail: null,
      createdAt: new Date().toISOString()
    }));

    // Add videos immediately (with null thumbnails)
    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, videos: [...cat.videos, ...newVideos] }
        : cat
    ));
    setSelectedCategory(prev => prev ? { ...prev, videos: [...prev.videos, ...newVideos] } : prev);

    // Generate thumbnails asynchronously
    for (const video of newVideos) {
      try {
        const thumbnail = await generateThumbnailFromUrl(video.url);
        // Update the video with generated thumbnail
        setCategories(prev => prev.map(cat =>
          cat.id === selectedCategory.id
            ? {
                ...cat,
                videos: cat.videos.map(v =>
                  v.id === video.id ? { ...v, thumbnail } : v
                )
              }
            : cat
        ));
        setSelectedCategory(prev => prev ? {
          ...prev,
          videos: prev.videos.map(v =>
            v.id === video.id ? { ...v, thumbnail } : v
          )
        } : prev);
      } catch (error) {
        console.warn('Failed to generate thumbnail for', video.name, error);
      }
    }
  }, [selectedCategory]);

  const handleUploadAudio = useCallback((files) => {
    if (!selectedCategory) return;

    const newAudio = Array.from(files).map((file, i) => ({
      id: `audio_${Date.now()}_${i}`,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
      duration: 0,
      createdAt: new Date().toISOString()
    }));

    setCategories(prev => prev.map(cat =>
      cat.id === selectedCategory.id
        ? { ...cat, audio: [...cat.audio, ...newAudio] }
        : cat
    ));

    setSelectedCategory(prev => prev ? { ...prev, audio: [...prev.audio, ...newAudio] } : prev);
  }, [selectedCategory]);

  const handleDeleteVideo = useCallback((videoId) => {
    if (!selectedCategory) return;

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
          <button
            onClick={() => setShowLateConnect(true)}
            style={{
              ...styles.lateButton,
              ...(lateConnected ? styles.lateButtonConnected : {})
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
            {lateConnected ? `Late (${lateAccounts.length})` : 'Connect Late'}
          </button>
          <button onClick={onClose} style={styles.closeButton}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Late Connection Modal */}
      {showLateConnect && (
        <div style={styles.modalOverlay} onClick={() => setShowLateConnect(false)}>
          <div style={styles.lateModal} onClick={e => e.stopPropagation()}>
            <div style={styles.lateModalHeader}>
              <h2 style={styles.lateModalTitle}>
                {lateConnected ? 'Late Connection' : 'Connect to Late'}
              </h2>
              <button onClick={() => setShowLateConnect(false)} style={styles.modalClose}>×</button>
            </div>
            <div style={styles.lateModalContent}>
              {lateConnected ? (
                <>
                  <div style={styles.connectedBadge}>✓ Connected</div>
                  <p style={styles.accountCount}>{lateAccounts.length} account(s)</p>
                  {lateAccounts.map(acc => (
                    <div key={acc.id} style={styles.accountItem}>
                      <span>{acc.platform === 'tiktok' ? '🎵' : '📸'}</span>
                      <span>{acc.username}</span>
                    </div>
                  ))}
                  <div style={styles.buttonRow}>
                    <button onClick={handleRefreshLate} style={styles.refreshBtn} disabled={lateConnecting}>
                      {lateConnecting ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button onClick={handleDisconnectLate} style={styles.disconnectBtn}>Disconnect</button>
                  </div>
                </>
              ) : (
                <>
                  <p style={styles.modalDesc}>Connect your Late account to post videos to TikTok, Instagram, and more.</p>
                  <input
                    type="password"
                    value={lateToken}
                    onChange={e => setLateToken(e.target.value)}
                    placeholder="Enter Late API token"
                    style={styles.tokenInput}
                    onKeyDown={e => e.key === 'Enter' && handleConnectLate()}
                  />
                  <p style={styles.tokenHint}>Get your token from <a href="https://late.co/settings/api" target="_blank" rel="noreferrer" style={styles.link}>late.co/settings/api</a></p>
                  {lateError && <div style={styles.error}>{lateError}</div>}
                  <button
                    onClick={handleConnectLate}
                    disabled={lateConnecting || !lateToken.trim()}
                    style={{...styles.connectBtn, ...((!lateToken.trim() || lateConnecting) ? styles.btnDisabled : {})}}
                  >
                    {lateConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
            onSchedulePost={onSchedulePost}
            lateAccounts={lateAccounts}
          />
        )}
      </main>

      {/* Editor Modal */}
      {showEditor && selectedCategory && (
        <VideoEditorModal
          category={selectedCategory}
          existingVideo={editingVideo}
          presets={categoryPresets}
          onSave={handleSaveVideo}
          onSavePreset={handleSavePreset}
          onClose={handleCloseEditor}
          lateAccounts={lateAccounts}
          onSchedulePost={onSchedulePost}
        />
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
  lateButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px',
    marginRight: '12px'
  },
  lateButtonConnected: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    color: '#10b981'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  lateModal: {
    backgroundColor: '#111118',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '400px',
    border: '1px solid #2d2d3d'
  },
  lateModalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #1f1f2e'
  },
  lateModalTitle: {
    margin: 0,
    fontSize: '18px',
    color: '#fff'
  },
  modalClose: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    fontSize: '24px',
    cursor: 'pointer'
  },
  lateModalContent: {
    padding: '24px'
  },
  modalDesc: {
    color: '#9ca3af',
    fontSize: '14px',
    marginBottom: '16px'
  },
  tokenInput: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#0a0a0f',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    marginBottom: '8px',
    boxSizing: 'border-box'
  },
  tokenHint: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '16px'
  },
  link: {
    color: '#7c3aed'
  },
  error: {
    padding: '12px',
    backgroundColor: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '8px',
    color: '#ef4444',
    fontSize: '13px',
    marginBottom: '16px'
  },
  connectBtn: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  btnDisabled: {
    backgroundColor: '#2d2d3d',
    color: '#6b7280',
    cursor: 'not-allowed'
  },
  connectedBadge: {
    display: 'inline-block',
    padding: '8px 16px',
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderRadius: '20px',
    color: '#10b981',
    fontSize: '14px',
    marginBottom: '12px'
  },
  accountCount: {
    color: '#9ca3af',
    fontSize: '14px',
    marginBottom: '16px'
  },
  accountItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    marginBottom: '8px'
  },
  buttonRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '16px'
  },
  refreshBtn: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer'
  },
  disconnectBtn: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'transparent',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    color: '#ef4444',
    cursor: 'pointer'
  }
};

export default VideoStudio;
