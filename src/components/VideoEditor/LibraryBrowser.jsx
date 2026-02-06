/**
 * LibraryBrowser - Main library and collections UI
 * Replaces the old bank system with unified media management
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getLibrary,
  getCollections,
  getUserCollections,
  getCollectionMedia,
  addToLibrary,
  removeFromLibrary,
  toggleFavorite,
  createNewCollection,
  updateCollection,
  deleteCollection,
  addToCollection,
  removeFromCollection,
  searchLibrary,
  MEDIA_TYPES,
  COLLECTION_TYPES,
  SMART_COLLECTION_IDS,
  // Firestore async functions
  subscribeToLibrary,
  addToLibraryAsync,
  removeFromLibraryAsync
} from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';

const LibraryBrowser = ({
  db = null, // Firestore instance for cross-device sync
  artistId,
  mode = 'all', // 'all' | 'videos' | 'images' | 'audio'
  onSelectMedia,
  onSelectMultiple,
  selectedMediaIds = [],
  allowMultiSelect = false,
  showCollectionPicker = true,
  pullFromCollection = null, // Force pull from specific collection
  isMobile = false,
  compact = false,
  refreshTrigger = 0 // Increment to force refresh
}) => {
  // State
  const [library, setLibrary] = useState([]);
  const [collections, setCollections] = useState([]);
  const [activeView, setActiveView] = useState('library'); // 'library' | 'collections' | collection ID
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [filterType, setFilterType] = useState(mode === 'all' ? null : mode);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showNewCollectionModal, setShowNewCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [selectedForBulk, setSelectedForBulk] = useState([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [thumbnailCache, setThumbnailCache] = useState({});

  const fileInputRef = useRef(null);

  // Load data when artistId changes or refresh is triggered
  // Use Firestore subscription if db is available
  useEffect(() => {
    if (!artistId) return;

    console.log('[LibraryBrowser] Loading data for artist:', artistId, 'refreshTrigger:', refreshTrigger, 'db:', !!db);

    // Load collections from localStorage (will migrate later)
    setCollections(getCollections(artistId));

    // For library, use Firestore real-time subscription if db is available
    if (db) {
      console.log('[LibraryBrowser] Setting up Firestore subscription');
      const unsubscribe = subscribeToLibrary(db, artistId, (items) => {
        console.log('[LibraryBrowser] Received', items.length, 'items from Firestore');
        setLibrary(items);
      });
      return () => unsubscribe();
    } else {
      // Fallback to localStorage
      setLibrary(getLibrary(artistId));
    }
  }, [db, artistId, refreshTrigger]);

  const loadData = () => {
    // Still needed for collections and as fallback
    if (!db) {
      setLibrary(getLibrary(artistId));
    }
    setCollections(getCollections(artistId));
  };

  // Filter and search
  const getDisplayedMedia = useCallback(() => {
    let filters = { sortBy };

    if (filterType) {
      filters.type = filterType;
    }

    // If viewing a specific collection
    if (activeView !== 'library' && activeView !== 'collections') {
      return getCollectionMedia(artistId, activeView);
    }

    // If forced to pull from a collection
    if (pullFromCollection) {
      return getCollectionMedia(artistId, pullFromCollection);
    }

    return searchLibrary(artistId, searchQuery, filters);
  }, [artistId, activeView, searchQuery, sortBy, filterType, pullFromCollection]);

  const displayedMedia = getDisplayedMedia();

  // Generate thumbnail for video
  const generateThumbnail = async (videoUrl, mediaId) => {
    if (thumbnailCache[mediaId]) return thumbnailCache[mediaId];

    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.src = videoUrl;
      video.currentTime = 1;

      video.onloadeddata = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
          const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
          setThumbnailCache(prev => ({ ...prev, [mediaId]: thumbnail }));
          resolve(thumbnail);
        } catch (e) {
          resolve(null);
        }
      };

      video.onerror = () => resolve(null);
    });
  };

  // Handle file upload
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    console.log('[LibraryBrowser] Starting upload for', files.length, 'files, artistId:', artistId);

    if (!artistId) {
      console.error('[LibraryBrowser] No artistId provided - cannot save to library');
      alert('Error: No artist selected. Please select an artist first.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progress = ((i + 1) / files.length) * 100;
        setUploadProgress(progress);

        // Determine media type
        let type;
        if (file.type.startsWith('video/')) type = MEDIA_TYPES.VIDEO;
        else if (file.type.startsWith('image/')) type = MEDIA_TYPES.IMAGE;
        else if (file.type.startsWith('audio/')) type = MEDIA_TYPES.AUDIO;
        else continue;

        console.log('[LibraryBrowser] Uploading file:', file.name, 'type:', type);

        // Upload to Firebase
        const result = await uploadFile(file, type + 's');
        console.log('[LibraryBrowser] Firebase upload result:', result);

        // Get duration for video/audio
        let duration = null;
        let width = null;
        let height = null;
        let hasEmbeddedAudio = false;

        if (type === MEDIA_TYPES.VIDEO || type === MEDIA_TYPES.AUDIO) {
          const mediaEl = document.createElement(type === MEDIA_TYPES.VIDEO ? 'video' : 'audio');
          mediaEl.src = URL.createObjectURL(file);

          await new Promise((resolve) => {
            mediaEl.onloadedmetadata = () => {
              duration = mediaEl.duration;
              if (type === MEDIA_TYPES.VIDEO) {
                width = mediaEl.videoWidth;
                height = mediaEl.videoHeight;
                // Check for audio tracks
                hasEmbeddedAudio = mediaEl.mozHasAudio ||
                  Boolean(mediaEl.webkitAudioDecodedByteCount) ||
                  Boolean(mediaEl.audioTracks?.length);
              }
              resolve();
            };
            mediaEl.onerror = resolve;
          });
          URL.revokeObjectURL(mediaEl.src);
        }

        if (type === MEDIA_TYPES.IMAGE) {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          await new Promise((resolve) => {
            img.onload = () => {
              width = img.naturalWidth;
              height = img.naturalHeight;
              resolve();
            };
            img.onerror = resolve;
          });
          URL.revokeObjectURL(img.src);
        }

        // Add to library using async Firestore function
        const newItem = await addToLibraryAsync(db, artistId, {
          type,
          name: file.name,
          url: result.url,
          storagePath: result.path,
          duration,
          width,
          height,
          hasEmbeddedAudio,
          metadata: {
            fileSize: file.size,
            mimeType: file.type
          }
        });
        console.log('[LibraryBrowser] Added to library:', newItem);
      }

      console.log('[LibraryBrowser] Upload complete');
      // Note: If using Firestore subscription, library will auto-update via onSnapshot
      if (!db) loadData();
    } catch (error) {
      console.error('[LibraryBrowser] Upload failed:', error);
      alert('Upload failed: ' + error.message);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle media selection
  const handleMediaClick = (media, e) => {
    if (e?.shiftKey && allowMultiSelect) {
      // Multi-select
      if (selectedForBulk.includes(media.id)) {
        setSelectedForBulk(prev => prev.filter(id => id !== media.id));
      } else {
        setSelectedForBulk(prev => [...prev, media.id]);
      }
    } else if (onSelectMedia) {
      onSelectMedia(media);
    }
  };

  // Handle favorite toggle
  const handleToggleFavorite = (mediaId, e) => {
    e.stopPropagation();
    toggleFavorite(artistId, mediaId);
    loadData();
  };

  // Handle delete
  const handleDelete = (mediaId) => {
    if (window.confirm('Delete this item from your library? This cannot be undone.')) {
      removeFromLibrary(artistId, mediaId);
      loadData();
    }
  };

  // Handle create collection
  const handleCreateCollection = () => {
    if (!newCollectionName.trim()) return;

    createNewCollection(artistId, {
      name: newCollectionName.trim(),
      description: ''
    });

    setNewCollectionName('');
    setShowNewCollectionModal(false);
    loadData();
  };

  // Handle delete collection
  const handleDeleteCollection = (collectionId) => {
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return;

    if (window.confirm(`Delete "${collection.name}" collection? Media will remain in your library.`)) {
      deleteCollection(artistId, collectionId);
      if (activeView === collectionId) {
        setActiveView('library');
      }
      loadData();
    }
  };

  // Handle add to collection
  const handleAddToCollection = (mediaIds, collectionId) => {
    addToCollection(artistId, collectionId, mediaIds);
    loadData();
    setContextMenu(null);
  };

  // Handle drag and drop
  const handleDragStart = (e, media) => {
    setDraggedItem(media);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDropOnCollection = (e, collectionId) => {
    e.preventDefault();
    if (draggedItem) {
      addToCollection(artistId, collectionId, draggedItem.id);
      loadData();
    }
    setDraggedItem(null);
  };

  // Context menu
  const handleContextMenu = (e, media) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      media
    });
  };

  // Get accept types for file input
  const getAcceptTypes = () => {
    switch (mode) {
      case 'videos': return 'video/*';
      case 'images': return 'image/*';
      case 'audio': return 'audio/*';
      default: return 'video/*,image/*,audio/*';
    }
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#0a0a0a',
      color: '#ffffff',
      overflow: 'hidden'
    },
    header: {
      padding: compact ? '12px 16px' : '16px 20px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: '12px',
      alignItems: isMobile ? 'stretch' : 'center'
    },
    searchBar: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '8px',
      padding: '8px 12px'
    },
    searchInput: {
      flex: 1,
      backgroundColor: 'transparent',
      border: 'none',
      color: '#ffffff',
      fontSize: '14px',
      outline: 'none'
    },
    controls: {
      display: 'flex',
      gap: '8px',
      alignItems: 'center'
    },
    select: {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '6px',
      color: '#ffffff',
      padding: '8px 12px',
      fontSize: '13px',
      cursor: 'pointer',
      outline: 'none'
    },
    uploadButton: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 16px',
      backgroundColor: '#6366f1',
      border: 'none',
      borderRadius: '6px',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background-color 0.2s'
    },
    body: {
      display: 'flex',
      flex: 1,
      overflow: 'hidden'
    },
    sidebar: {
      width: isMobile ? '100%' : '200px',
      borderRight: isMobile ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
      padding: '12px',
      overflowY: 'auto',
      display: isMobile && activeView !== 'collections' ? 'none' : 'block'
    },
    sidebarSection: {
      marginBottom: '20px'
    },
    sidebarTitle: {
      fontSize: '11px',
      fontWeight: '600',
      color: 'rgba(255, 255, 255, 0.4)',
      textTransform: 'uppercase',
      letterSpacing: '1px',
      marginBottom: '8px',
      padding: '0 8px'
    },
    sidebarItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      color: 'rgba(255, 255, 255, 0.8)',
      transition: 'all 0.2s'
    },
    sidebarItemActive: {
      backgroundColor: 'rgba(99, 102, 241, 0.2)',
      color: '#ffffff'
    },
    sidebarItemIcon: {
      fontSize: '16px'
    },
    addCollectionButton: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 12px',
      color: 'rgba(255, 255, 255, 0.5)',
      fontSize: '13px',
      cursor: 'pointer',
      borderRadius: '6px',
      transition: 'all 0.2s'
    },
    content: {
      flex: 1,
      padding: compact ? '12px' : '16px',
      overflowY: 'auto'
    },
    mediaGrid: {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? '100px' : '140px'}, 1fr))`,
      gap: compact ? '8px' : '12px'
    },
    mediaCard: {
      position: 'relative',
      aspectRatio: '1',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '8px',
      overflow: 'hidden',
      cursor: 'pointer',
      border: '2px solid transparent',
      transition: 'all 0.2s'
    },
    mediaCardSelected: {
      borderColor: '#6366f1'
    },
    mediaThumbnail: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    },
    mediaOverlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: '8px',
      background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    },
    mediaName: {
      fontSize: '11px',
      color: '#ffffff',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    mediaMeta: {
      fontSize: '10px',
      color: 'rgba(255, 255, 255, 0.5)'
    },
    mediaTypeIcon: {
      position: 'absolute',
      top: '8px',
      left: '8px',
      fontSize: '16px',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderRadius: '4px',
      padding: '4px'
    },
    favoriteButton: {
      position: 'absolute',
      top: '8px',
      right: '8px',
      fontSize: '16px',
      cursor: 'pointer',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderRadius: '4px',
      padding: '4px',
      border: 'none',
      transition: 'transform 0.2s'
    },
    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: '16px',
      color: 'rgba(255, 255, 255, 0.5)'
    },
    emptyIcon: {
      fontSize: '48px'
    },
    emptyText: {
      fontSize: '16px',
      textAlign: 'center'
    },
    uploadOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      zIndex: 100
    },
    progressBar: {
      width: '200px',
      height: '4px',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: '2px',
      overflow: 'hidden'
    },
    progressFill: {
      height: '100%',
      backgroundColor: '#6366f1',
      transition: 'width 0.3s'
    },
    contextMenu: {
      position: 'fixed',
      backgroundColor: '#1a1a1a',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      padding: '8px 0',
      minWidth: '180px',
      zIndex: 10000,
      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)'
    },
    contextMenuItem: {
      padding: '10px 16px',
      fontSize: '14px',
      color: 'rgba(255, 255, 255, 0.8)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      transition: 'background-color 0.2s'
    },
    contextMenuDivider: {
      height: '1px',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      margin: '8px 0'
    },
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10001
    },
    modalContent: {
      backgroundColor: '#1a1a1a',
      borderRadius: '12px',
      padding: '24px',
      width: '90%',
      maxWidth: '400px'
    },
    modalTitle: {
      fontSize: '18px',
      fontWeight: '600',
      marginBottom: '16px'
    },
    modalInput: {
      width: '100%',
      padding: '12px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      color: '#ffffff',
      fontSize: '14px',
      outline: 'none',
      marginBottom: '16px'
    },
    modalButtons: {
      display: 'flex',
      gap: '12px',
      justifyContent: 'flex-end'
    },
    modalButton: {
      padding: '10px 20px',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    audioPlaceholder: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      fontSize: '32px'
    }
  };

  // Get type icon
  const getTypeIcon = (type) => {
    switch (type) {
      case MEDIA_TYPES.VIDEO: return '🎬';
      case MEDIA_TYPES.IMAGE: return '🖼️';
      case MEDIA_TYPES.AUDIO: return '🎵';
      default: return '📁';
    }
  };

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get user collections for context menu
  const userCollections = getUserCollections(artistId);

  return (
    <div style={styles.container} onClick={() => setContextMenu(null)}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.searchBar}>
          <span>🔍</span>
          <input
            type="text"
            placeholder="Search library..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        <div style={styles.controls}>
          {mode === 'all' && (
            <select
              value={filterType || ''}
              onChange={(e) => setFilterType(e.target.value || null)}
              style={styles.select}
            >
              <option value="">All Types</option>
              <option value={MEDIA_TYPES.VIDEO}>Videos</option>
              <option value={MEDIA_TYPES.IMAGE}>Images</option>
              <option value={MEDIA_TYPES.AUDIO}>Audio</option>
            </select>
          )}

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.select}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="mostUsed">Most Used</option>
          </select>

          <label style={styles.uploadButton}>
            <span>⬆️</span>
            <span>{isMobile ? 'Add' : 'Upload'}</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={getAcceptTypes()}
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* Sidebar - Collections */}
        {showCollectionPicker && (
          <div style={styles.sidebar}>
            {/* Library */}
            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>Library</div>
              <div
                style={{
                  ...styles.sidebarItem,
                  ...(activeView === 'library' ? styles.sidebarItemActive : {})
                }}
                onClick={() => setActiveView('library')}
              >
                <span style={styles.sidebarItemIcon}>📚</span>
                <span>All Media</span>
              </div>
            </div>

            {/* User Collections - Above Smart Collections */}
            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>Collections</div>
              {collections
                .filter(c => c.type !== COLLECTION_TYPES.SMART)
                .map(collection => (
                  <div
                    key={collection.id}
                    style={{
                      ...styles.sidebarItem,
                      ...(activeView === collection.id ? styles.sidebarItemActive : {})
                    }}
                    onClick={() => setActiveView(collection.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDropOnCollection(e, collection.id)}
                  >
                    <span style={styles.sidebarItemIcon}>📁</span>
                    <span style={{ flex: 1 }}>{collection.name}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCollection(collection.id);
                      }}
                      style={{ opacity: 0.5, fontSize: '12px' }}
                    >
                      ✕
                    </span>
                  </div>
                ))}

              <div
                style={styles.addCollectionButton}
                onClick={() => setShowNewCollectionModal(true)}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>+</span>
                <span>New Collection</span>
              </div>
            </div>

            {/* Smart Collections */}
            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>Smart Collections</div>
              {collections
                .filter(c => c.type === COLLECTION_TYPES.SMART)
                .map(collection => (
                  <div
                    key={collection.id}
                    style={{
                      ...styles.sidebarItem,
                      ...(activeView === collection.id ? styles.sidebarItemActive : {})
                    }}
                    onClick={() => setActiveView(collection.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDropOnCollection(e, collection.id)}
                  >
                    <span style={styles.sidebarItemIcon}>{collection.icon}</span>
                    <span>{collection.name}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Content */}
        <div style={styles.content}>
          {displayedMedia.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>📂</div>
              <div style={styles.emptyText}>
                {searchQuery
                  ? 'No results found'
                  : activeView === 'library'
                    ? 'Your library is empty. Upload some media to get started!'
                    : 'This collection is empty. Drag items here to add them.'
                }
              </div>
              {!searchQuery && activeView === 'library' && (
                <label style={{...styles.uploadButton, marginTop: '8px'}}>
                  <span>⬆️</span>
                  <span>Upload Media</span>
                  <input
                    type="file"
                    multiple
                    accept={getAcceptTypes()}
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              )}
            </div>
          ) : (
            <div style={styles.mediaGrid}>
              {displayedMedia.map(media => (
                <div
                  key={media.id}
                  style={{
                    ...styles.mediaCard,
                    ...(selectedMediaIds.includes(media.id) || selectedForBulk.includes(media.id)
                      ? styles.mediaCardSelected
                      : {})
                  }}
                  onClick={(e) => handleMediaClick(media, e)}
                  onContextMenu={(e) => handleContextMenu(e, media)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, media)}
                  onMouseEnter={(e) => {
                    if (!selectedMediaIds.includes(media.id)) {
                      e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!selectedMediaIds.includes(media.id)) {
                      e.currentTarget.style.borderColor = 'transparent';
                    }
                  }}
                >
                  {/* Thumbnail */}
                  {media.type === MEDIA_TYPES.VIDEO && (
                    <video
                      src={media.url}
                      style={styles.mediaThumbnail}
                      muted
                      preload="metadata"
                    />
                  )}
                  {media.type === MEDIA_TYPES.IMAGE && (
                    <img
                      src={media.url}
                      alt={media.name}
                      style={styles.mediaThumbnail}
                    />
                  )}
                  {media.type === MEDIA_TYPES.AUDIO && (
                    <div style={styles.audioPlaceholder}>🎵</div>
                  )}

                  {/* Type Icon */}
                  <div style={styles.mediaTypeIcon}>
                    {getTypeIcon(media.type)}
                  </div>

                  {/* Favorite Button */}
                  <button
                    style={{
                      ...styles.favoriteButton,
                      color: media.isFavorite ? '#fbbf24' : 'rgba(255,255,255,0.5)'
                    }}
                    onClick={(e) => handleToggleFavorite(media.id, e)}
                  >
                    {media.isFavorite ? '★' : '☆'}
                  </button>

                  {/* Info Overlay */}
                  <div style={styles.mediaOverlay}>
                    <div style={styles.mediaName}>{media.name}</div>
                    <div style={styles.mediaMeta}>
                      {media.duration && formatDuration(media.duration)}
                      {media.useCount > 0 && ` • Used ${media.useCount}x`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upload Progress Overlay */}
      {isUploading && (
        <div style={styles.uploadOverlay}>
          <div style={{ fontSize: '24px' }}>⬆️</div>
          <div>Uploading...</div>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            ...styles.contextMenu,
            left: contextMenu.x,
            top: contextMenu.y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={styles.contextMenuItem}
            onClick={() => handleToggleFavorite(contextMenu.media.id, { stopPropagation: () => {} })}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <span>{contextMenu.media.isFavorite ? '★' : '☆'}</span>
            <span>{contextMenu.media.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
          </div>

          {userCollections.length > 0 && (
            <>
              <div style={styles.contextMenuDivider} />
              <div style={{ padding: '8px 16px', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                Add to Collection
              </div>
              {userCollections.map(collection => (
                <div
                  key={collection.id}
                  style={styles.contextMenuItem}
                  onClick={() => handleAddToCollection([contextMenu.media.id], collection.id)}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span>📁</span>
                  <span>{collection.name}</span>
                </div>
              ))}
            </>
          )}

          <div style={styles.contextMenuDivider} />

          <div
            style={{...styles.contextMenuItem, color: '#ef4444'}}
            onClick={() => {
              handleDelete(contextMenu.media.id);
              setContextMenu(null);
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <span>🗑️</span>
            <span>Delete</span>
          </div>
        </div>
      )}

      {/* New Collection Modal */}
      {showNewCollectionModal && (
        <div style={styles.modal} onClick={() => setShowNewCollectionModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>New Collection</div>
            <input
              type="text"
              placeholder="Collection name..."
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              style={styles.modalInput}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
            />
            <div style={styles.modalButtons}>
              <button
                style={{
                  ...styles.modalButton,
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: 'rgba(255,255,255,0.6)'
                }}
                onClick={() => setShowNewCollectionModal(false)}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.modalButton,
                  backgroundColor: '#6366f1',
                  border: 'none',
                  color: '#ffffff'
                }}
                onClick={handleCreateCollection}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryBrowser;
