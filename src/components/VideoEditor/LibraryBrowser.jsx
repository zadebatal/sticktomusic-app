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
  assignToBank,
  removeFromBank,
  getCollectionBanks,
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
  // Map mode prop ('videos', 'images', 'audio', 'all') to MEDIA_TYPES values ('video', 'image', 'audio')
  const modeToMediaType = (m) => {
    if (m === 'all' || !m) return null;
    if (m === 'videos') return MEDIA_TYPES.VIDEO;   // 'video'
    if (m === 'images') return MEDIA_TYPES.IMAGE;   // 'image'
    if (m === 'audio') return MEDIA_TYPES.AUDIO;    // 'audio'
    return m; // fallback
  };
  const [filterType, setFilterType] = useState(modeToMediaType(mode));
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showNewCollectionModal, setShowNewCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [selectedForBulk, setSelectedForBulk] = useState([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [thumbnailCache, setThumbnailCache] = useState({});
  const [renamingCollectionId, setRenamingCollectionId] = useState(null);
  const [renameText, setRenameText] = useState('');

  // Drag selection state
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragStart, setDragStart] = useState(null); // {x, y} in page coords
  const [dragEnd, setDragEnd] = useState(null);
  const dragThresholdMetRef = useRef(false); // Use ref to avoid stale closure
  const gridRef = useRef(null);
  const mediaCardRefs = useRef({});
  // Ref to hold current displayedMedia for use in drag selection effect
  const displayedMediaRef = useRef([]);
  // Track last clicked index for shift-click range selection
  const lastClickedIndexRef = useRef(null);
  // Track drag coordinates in refs for reliable mouseup access
  const dragStartRef = useRef(null);
  const dragEndRef = useRef(null);

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

  // Filter and search - uses in-memory library state (from Firestore subscription)
  // instead of reading from localStorage, so data stays in sync across devices
  const getDisplayedMedia = useCallback(() => {
    let results = [...library];

    // If viewing a specific collection
    if (activeView !== 'library' && activeView !== 'collections') {
      const colMedia = getCollectionMedia(artistId, activeView);
      // If collection returns items from localStorage, merge with Firestore library
      if (colMedia.length === 0 && library.length > 0) {
        const collections = getCollections(artistId);
        const col = collections.find(c => c.id === activeView);
        if (col?.mediaIds) {
          results = library.filter(item => col.mediaIds.includes(item.id));
        } else {
          results = colMedia;
        }
      } else {
        results = colMedia;
      }
    }

    // If forced to pull from a collection
    if (pullFromCollection && activeView === 'library') {
      const colMedia = getCollectionMedia(artistId, pullFromCollection);
      if (colMedia.length === 0 && library.length > 0) {
        const collections = getCollections(artistId);
        const col = collections.find(c => c.id === pullFromCollection);
        if (col?.mediaIds) {
          results = library.filter(item => col.mediaIds.includes(item.id));
        } else {
          results = colMedia;
        }
      } else {
        results = colMedia;
      }
    }

    // Apply type filter
    if (filterType) {
      results = results.filter(item => item.type === filterType);
    }

    // Apply search query
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      results = results.filter(item =>
        item.name?.toLowerCase().includes(lowerQuery) ||
        item.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    }

    // Apply sort
    switch (sortBy) {
      case 'newest':
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'oldest':
        results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'name':
        results.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'mostUsed':
        results.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        break;
      default:
        break;
    }

    return results;
  }, [library, artistId, activeView, searchQuery, sortBy, filterType, pullFromCollection]);

  const displayedMedia = getDisplayedMedia();

  // Determine if we're in a user collection (not library, favorites, or smart collection)
  const isUserCollectionView = activeView !== 'library' && activeView !== 'collections'
    && !activeView.startsWith('smart_')
    && collections.some(c => c.id === activeView && c.type !== COLLECTION_TYPES.SMART);

  // Get bank data when viewing a user collection (images/slideshow only, not videos)
  // Compute from component state (library + collections) instead of localStorage
  // so it stays in sync with Firestore subscription data
  const collectionBanks = (() => {
    if (!isUserCollectionView || mode === 'videos') return null;
    const col = collections.find(c => c.id === activeView);
    if (!col) return null;
    const allMedia = library.filter(item => (col.mediaIds || []).includes(item.id));
    const bankAIds = col.bankA || [];
    const bankBIds = col.bankB || [];
    return {
      bankA: allMedia.filter(item => bankAIds.includes(item.id)),
      bankB: allMedia.filter(item => bankBIds.includes(item.id)),
      unassigned: allMedia.filter(item => !bankAIds.includes(item.id) && !bankBIds.includes(item.id))
    };
  })();

  // Handle drop onto a bank zone
  const handleDropOnBank = (e, bank) => {
    e.preventDefault();
    e.stopPropagation();
    // Try to get multi-select drag IDs from dataTransfer
    let dragIds = [];
    try {
      const data = e.dataTransfer.getData('text/plain');
      dragIds = JSON.parse(data);
    } catch (err) {}
    if (dragIds.length === 0 && draggedItem) {
      dragIds = [draggedItem.id];
    }
    if (dragIds.length > 0) {
      assignToBank(artistId, activeView, dragIds, bank);
      loadData();
    }
    setDraggedItem(null);
    setDragOverBank(null);
  };

  const [dragOverBank, setDragOverBank] = useState(null); // 'A' | 'B' | null

  // Keep ref in sync for use in drag selection effect
  displayedMediaRef.current = displayedMedia;

  // Drag selection handlers - works from anywhere in the grid (including on cards)
  // Uses a 8px movement threshold before activating to distinguish clicks from drags
  const handleGridMouseDown = (e) => {
    if (!allowMultiSelect) return;
    // Don't interfere with buttons, inputs, or context menu items
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
    // Only respond to left mouse button
    if (e.button !== 0) return;

    const pos = { x: e.clientX, y: e.clientY };
    setDragStart(pos);
    setDragEnd(null);
    dragStartRef.current = pos;
    dragEndRef.current = null;
    dragThresholdMetRef.current = false;
    setIsDragSelecting(true);
  };

  useEffect(() => {
    if (!isDragSelecting || !dragStart) return;

    const handleMouseMove = (e) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 8) {
        dragThresholdMetRef.current = true;
        e.preventDefault();
      }

      const pos = { x: e.clientX, y: e.clientY };
      dragEndRef.current = pos;
      setDragEnd(pos); // For visual rectangle rendering
    };

    const handleMouseUp = () => {
      const start = dragStartRef.current;
      const end = dragEndRef.current;

      if (dragThresholdMetRef.current && start && end) {
        const selectionRect = {
          left: Math.min(start.x, end.x),
          top: Math.min(start.y, end.y),
          right: Math.max(start.x, end.x),
          bottom: Math.max(start.y, end.y)
        };

        const newSelection = [];
        displayedMediaRef.current.forEach(media => {
          const el = mediaCardRefs.current[media.id];
          if (!el) return;
          const rect = el.getBoundingClientRect();
          if (
            rect.right >= selectionRect.left &&
            rect.left <= selectionRect.right &&
            rect.bottom >= selectionRect.top &&
            rect.top <= selectionRect.bottom
          ) {
            newSelection.push(media.id);
          }
        });

        if (onSelectMedia && newSelection.length > 0) {
          const items = newSelection.map(id => displayedMediaRef.current.find(m => m.id === id)).filter(Boolean);
          if (items.length > 0) {
            onSelectMedia(items[0], { replaceAll: items });
          }
        }
      }

      setIsDragSelecting(false);
      setDragStart(null);
      setDragEnd(null);
      dragStartRef.current = null;
      dragEndRef.current = null;
      dragThresholdMetRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragSelecting, dragStart, onSelectMedia, selectedMediaIds]);

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
        else if (file.type === 'audio/mpeg' || file.type === 'audio/mp3') type = MEDIA_TYPES.AUDIO;
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

  // Handle media selection — macOS-style:
  // Single click = exclusive select (deselect all others)
  // Cmd/Ctrl+click = toggle item in/out of selection
  // Shift+click = range select from last clicked
  const handleMediaClick = (media, e) => {
    const clickedIndex = displayedMedia.findIndex(m => m.id === media.id);
    const isMetaKey = e?.metaKey || e?.ctrlKey;

    if (e?.shiftKey && allowMultiSelect && lastClickedIndexRef.current !== null && onSelectMedia) {
      // Shift+click: range select
      const start = Math.min(lastClickedIndexRef.current, clickedIndex);
      const end = Math.max(lastClickedIndexRef.current, clickedIndex);
      const rangeItems = [];
      for (let i = start; i <= end; i++) {
        if (displayedMedia[i]) rangeItems.push(displayedMedia[i]);
      }
      if (rangeItems.length > 0) {
        onSelectMedia(rangeItems[0], { replaceAll: rangeItems });
      }
    } else if (isMetaKey && allowMultiSelect && onSelectMedia) {
      // Cmd/Ctrl+click: toggle this item in/out
      onSelectMedia(media);
      lastClickedIndexRef.current = clickedIndex;
    } else if (onSelectMedia) {
      // Regular click: exclusive select (deselect all, select only this)
      onSelectMedia(media, { exclusive: true });
      lastClickedIndexRef.current = clickedIndex;
    }
  };

  // Handle favorite toggle
  const handleToggleFavorite = (mediaId, e) => {
    e.stopPropagation();
    toggleFavorite(artistId, mediaId);
    loadData();
  };

  // Handle delete — smart: if viewing a collection, ask remove-from-folder vs delete-everywhere
  const [showDeleteModal, setShowDeleteModal] = useState(null); // { mediaId, collectionId? }

  const handleDelete = (mediaId) => {
    const isInCollectionView = activeView !== 'library' && activeView !== 'favorites'
      && !collections.find(c => c.id === activeView && c.type === COLLECTION_TYPES.SMART);

    if (isInCollectionView) {
      // Show smart delete modal
      setShowDeleteModal({ mediaId, collectionId: activeView });
    } else {
      if (window.confirm('Delete this item from your library? This cannot be undone.')) {
        removeFromLibrary(artistId, mediaId);
        loadData();
      }
    }
  };

  const handleSmartDelete = (action) => {
    if (!showDeleteModal) return;
    const { mediaId, collectionId } = showDeleteModal;

    if (action === 'removeFromFolder') {
      removeFromCollection(artistId, collectionId, mediaId);
      loadData();
    } else if (action === 'deleteEverywhere') {
      removeFromLibrary(artistId, mediaId);
      loadData();
    }
    setShowDeleteModal(null);
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

  // Handle drag and drop (supports multi-select drag)
  const handleDragStart = (e, media) => {
    // If this item is selected and there are multiple selected, drag all of them
    const isSelected = selectedMediaIds.includes(media.id);
    const dragIds = (isSelected && selectedMediaIds.length > 1) ? selectedMediaIds : [media.id];

    setDraggedItem(media);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', JSON.stringify(dragIds));

    // Show count badge on drag image
    if (dragIds.length > 1) {
      const badge = document.createElement('div');
      badge.textContent = `${dragIds.length} items`;
      badge.style.cssText = 'position:fixed;top:-100px;padding:6px 12px;background:#6366f1;color:#fff;border-radius:8px;font-size:13px;font-weight:600;';
      document.body.appendChild(badge);
      e.dataTransfer.setDragImage(badge, 40, 20);
      setTimeout(() => document.body.removeChild(badge), 0);
    }
  };

  const [dragOverCollection, setDragOverCollection] = useState(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDropOnCollection = (e, collectionId) => {
    e.preventDefault();
    setDragOverCollection(null);

    // Try to get multi-select drag IDs from dataTransfer
    let dragIds = [];
    try {
      const data = e.dataTransfer.getData('text/plain');
      dragIds = JSON.parse(data);
    } catch (err) {
      // Fallback to single dragged item
    }

    if (dragIds.length > 0) {
      addToCollection(artistId, collectionId, dragIds);
      loadData();
    } else if (draggedItem) {
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
      case 'audio': return '.mp3,audio/mpeg';
      default: return 'video/*,image/*,.mp3,audio/mpeg';
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
      gap: compact ? '8px' : '12px',
      userSelect: 'none',
      WebkitUserSelect: 'none'
    },
    mediaCard: {
      position: 'relative',
      aspectRatio: '1',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '8px',
      overflow: 'hidden',
      cursor: 'pointer',
      border: '1px solid transparent',
      transition: 'all 0.15s ease',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTapHighlightColor: 'transparent'
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

  // Filter collections to only show ones that have items matching current mode
  const filteredCollections = collections.filter(c => {
    // Always show smart collections
    if (c.type === 'smart' || c.id?.startsWith('smart_')) return true;
    // For user collections, check if they have any matching media
    if (!filterType || !c.mediaIds?.length) return true;
    // Check if any media in this collection matches the current type filter
    const collectionMedia = library.filter(item => c.mediaIds.includes(item.id));
    return collectionMedia.some(item => item.type === filterType) || collectionMedia.length === 0;
  });

  // Handle collection rename
  const handleRenameCollection = (collectionId, newName) => {
    if (!newName.trim()) return;
    updateCollection(artistId, collectionId, { name: newName.trim() });
    setRenamingCollectionId(null);
    setRenameText('');
    loadData();
  };

  // Get user collections for context menu
  const userCollections = getUserCollections(artistId);

  // Shared media card renderer — used by both the main grid and bank columns
  const renderMediaCard = (media, isSelected) => (
    <div
      key={media.id}
      ref={el => { if (el) mediaCardRefs.current[media.id] = el; }}
      style={{
        ...styles.mediaCard,
        ...(isSelected ? { border: '1px solid rgba(99, 102, 241, 0.5)' } : {})
      }}
      onClick={(e) => handleMediaClick(media, e)}
      onContextMenu={(e) => handleContextMenu(e, media)}
      draggable={true}
      onDragStart={(e) => handleDragStart(e, media)}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        }
      }}
    >
      {isSelected && (
        <div style={{
          position: 'absolute', inset: 0,
          backgroundColor: 'rgba(99, 102, 241, 0.2)',
          zIndex: 1, pointerEvents: 'none', borderRadius: '7px'
        }}>
          <div style={{
            position: 'absolute', bottom: '6px', right: '6px',
            width: '18px', height: '18px',
            backgroundColor: '#6366f1', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px', color: '#fff', fontWeight: 'bold'
          }}>✓</div>
        </div>
      )}
      {media.type === MEDIA_TYPES.VIDEO && (
        <video src={media.url} style={styles.mediaThumbnail} muted preload="metadata" />
      )}
      {media.type === MEDIA_TYPES.IMAGE && (
        <img src={media.url} alt={media.name} style={styles.mediaThumbnail} />
      )}
      {media.type === MEDIA_TYPES.AUDIO && (
        <div style={styles.audioPlaceholder}>🎵</div>
      )}
      <div style={styles.mediaTypeIcon}>{getTypeIcon(media.type)}</div>
      <button
        style={{
          ...styles.favoriteButton,
          color: media.isFavorite ? '#fbbf24' : 'rgba(255,255,255,0.5)'
        }}
        onClick={(e) => handleToggleFavorite(media.id, e)}
      >
        {media.isFavorite ? '★' : '☆'}
      </button>
      <div style={styles.mediaOverlay}>
        <div style={styles.mediaName}>{media.name}</div>
        <div style={styles.mediaMeta}>
          {media.duration && formatDuration(media.duration)}
          {media.useCount > 0 && ` • Used ${media.useCount}x`}
        </div>
      </div>
    </div>
  );

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
              {filteredCollections
                .filter(c => c.type !== COLLECTION_TYPES.SMART)
                .map(collection => (
                  <div
                    key={collection.id}
                    style={{
                      ...styles.sidebarItem,
                      ...(activeView === collection.id ? styles.sidebarItemActive : {}),
                      ...(dragOverCollection === collection.id ? {
                        backgroundColor: 'rgba(99, 102, 241, 0.25)',
                        border: '1px dashed rgba(99, 102, 241, 0.6)',
                        transform: 'scale(1.02)',
                        transition: 'all 0.15s ease'
                      } : {})
                    }}
                    onClick={() => {
                      if (renamingCollectionId !== collection.id) {
                        setActiveView(collection.id);
                      }
                    }}
                    onDragOver={(e) => {
                      handleDragOver(e);
                      setDragOverCollection(collection.id);
                    }}
                    onDragLeave={() => setDragOverCollection(null)}
                    onDrop={(e) => handleDropOnCollection(e, collection.id)}
                    onMouseEnter={(e) => {
                      if (renamingCollectionId !== collection.id && dragOverCollection !== collection.id) {
                        e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeView !== collection.id && renamingCollectionId !== collection.id && dragOverCollection !== collection.id) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <span style={styles.sidebarItemIcon}>{dragOverCollection === collection.id ? '📂' : '📁'}</span>
                    {renamingCollectionId === collection.id ? (
                      <input
                        type="text"
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            handleRenameCollection(collection.id, renameText);
                          } else if (e.key === 'Escape') {
                            setRenamingCollectionId(null);
                            setRenameText('');
                          }
                        }}
                        onBlur={() => {
                          if (renameText.trim()) {
                            handleRenameCollection(collection.id, renameText);
                          } else {
                            setRenamingCollectionId(null);
                            setRenameText('');
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          flex: 1,
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          border: '1px solid rgba(99, 102, 241, 0.5)',
                          borderRadius: '4px',
                          color: '#ffffff',
                          padding: '4px 8px',
                          fontSize: '14px',
                          outline: 'none'
                        }}
                        autoFocus
                      />
                    ) : (
                      <span style={{ flex: 1 }}>{collection.name}</span>
                    )}
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {renamingCollectionId !== collection.id && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingCollectionId(collection.id);
                            setRenameText(collection.name);
                          }}
                          style={{ opacity: 0.5, fontSize: '12px', cursor: 'pointer', padding: '0 2px' }}
                          title="Rename"
                        >
                          ✎
                        </span>
                      )}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCollection(collection.id);
                        }}
                        style={{ opacity: 0.5, fontSize: '12px', cursor: 'pointer', padding: '0 2px' }}
                        title="Delete"
                      >
                        ✕
                      </span>
                    </div>
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
              {filteredCollections
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
          {/* Collection view: all images on left, Bank A/B stacked on right */}
          {isUserCollectionView && collectionBanks ? (
            <div style={{ display: 'flex', gap: '12px', height: '100%', overflow: 'hidden' }}>
              {/* Left half — all collection images */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                <div style={{
                  padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0
                }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>All Images</span>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                    {displayedMedia.length} items — drag into banks →
                  </span>
                </div>
                <div
                  ref={gridRef}
                  style={{
                    flex: 1, overflowY: 'auto', padding: '10px',
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? '80px' : '110px'}, 1fr))`,
                    gap: '8px', alignContent: 'start',
                    userSelect: 'none', WebkitUserSelect: 'none'
                  }}
                  onMouseDown={handleGridMouseDown}
                >
                  {displayedMedia.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1', padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '13px' }}>
                      This collection is empty. Drag items here to add them.
                    </div>
                  ) : displayedMedia.map(media => renderMediaCard(media, selectedMediaIds.includes(media.id)))}
                </div>
              </div>

              {/* Right half — Bank A and Bank B stacked */}
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', gap: '8px',
                overflow: 'hidden', minWidth: 0
              }}>
                {/* Bank A */}
                <div
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    borderRadius: '10px',
                    border: dragOverBank === 'A' ? '2px dashed rgba(99, 102, 241, 0.6)' : '1px solid rgba(255,255,255,0.08)',
                    backgroundColor: dragOverBank === 'A' ? 'rgba(99, 102, 241, 0.05)' : 'transparent',
                    transition: 'all 0.15s ease'
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverBank('A'); }}
                  onDragLeave={() => setDragOverBank(null)}
                  onDrop={(e) => handleDropOnBank(e, 'A')}
                >
                  <div style={{
                    padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.06), transparent)'
                  }}>
                    <div style={{
                      width: '22px', height: '22px', borderRadius: '6px',
                      background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: 700, color: '#fff'
                    }}>A</div>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#c4b5fd' }}>Bank A</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>
                      {collectionBanks.bankA.length}
                    </span>
                  </div>
                  <div style={{
                    flex: 1, overflowY: 'auto', padding: '8px',
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? '60px' : '80px'}, 1fr))`,
                    gap: '6px', alignContent: 'start'
                  }}>
                    {collectionBanks.bankA.length === 0 ? (
                      <div style={{ gridColumn: '1 / -1', padding: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>
                        Drag images here
                      </div>
                    ) : collectionBanks.bankA.map(media => renderMediaCard(media, selectedMediaIds.includes(media.id)))}
                  </div>
                </div>

                {/* Bank B */}
                <div
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    borderRadius: '10px',
                    border: dragOverBank === 'B' ? '2px dashed rgba(34, 197, 94, 0.6)' : '1px solid rgba(255,255,255,0.08)',
                    backgroundColor: dragOverBank === 'B' ? 'rgba(34, 197, 94, 0.05)' : 'transparent',
                    transition: 'all 0.15s ease'
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverBank('B'); }}
                  onDragLeave={() => setDragOverBank(null)}
                  onDrop={(e) => handleDropOnBank(e, 'B')}
                >
                  <div style={{
                    padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
                    background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.06), transparent)'
                  }}>
                    <div style={{
                      width: '22px', height: '22px', borderRadius: '6px',
                      background: 'linear-gradient(135deg, #22c55e, #4ade80)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: 700, color: '#fff'
                    }}>B</div>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#86efac' }}>Bank B</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>
                      {collectionBanks.bankB.length}
                    </span>
                  </div>
                  <div style={{
                    flex: 1, overflowY: 'auto', padding: '8px',
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? '60px' : '80px'}, 1fr))`,
                    gap: '6px', alignContent: 'start'
                  }}>
                    {collectionBanks.bankB.length === 0 ? (
                      <div style={{ gridColumn: '1 / -1', padding: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>
                        Drag images here
                      </div>
                    ) : collectionBanks.bankB.map(media => renderMediaCard(media, selectedMediaIds.includes(media.id)))}
                  </div>
                </div>
              </div>
            </div>
          ) : displayedMedia.length === 0 ? (
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
            <div
              ref={gridRef}
              style={styles.mediaGrid}
              onMouseDown={handleGridMouseDown}
            >
              {displayedMedia.map(media => {
                const isSelected = selectedMediaIds.includes(media.id);
                return renderMediaCard(media, isSelected);
              })}
            </div>
          )}
        </div>
      </div>

      {/* Drag Selection Rectangle */}
      {isDragSelecting && dragStart && dragEnd && (
        <div style={{
          position: 'fixed',
          left: Math.min(dragStart.x, dragEnd.x),
          top: Math.min(dragStart.y, dragEnd.y),
          width: Math.abs(dragEnd.x - dragStart.x),
          height: Math.abs(dragEnd.y - dragStart.y),
          backgroundColor: 'rgba(99, 102, 241, 0.15)',
          border: '1px solid rgba(99, 102, 241, 0.5)',
          pointerEvents: 'none',
          zIndex: 9999
        }} />
      )}

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

          {/* Assign to Bank A/B — shows per-collection bank options */}
          {userCollections.length > 0 && (contextMenu.media?.type === MEDIA_TYPES.IMAGE) && (
            <>
              <div style={styles.contextMenuDivider} />
              <div style={{ padding: '8px 16px', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                Assign to Bank
              </div>
              {userCollections.map(collection => (
                <React.Fragment key={`bank-${collection.id}`}>
                  <div style={{ padding: '4px 16px 2px', fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>
                    {collection.name}
                  </div>
                  <div
                    style={{...styles.contextMenuItem, paddingLeft: '24px'}}
                    onClick={() => {
                      assignToBank(artistId, collection.id, contextMenu.media.id, 'A');
                      loadData();
                      setContextMenu(null);
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <span style={{
                      display: 'inline-flex', width: '18px', height: '18px', borderRadius: '4px',
                      background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: '10px', fontWeight: 700, color: '#fff'
                    }}>A</span>
                    <span>Bank A</span>
                  </div>
                  <div
                    style={{...styles.contextMenuItem, paddingLeft: '24px'}}
                    onClick={() => {
                      assignToBank(artistId, collection.id, contextMenu.media.id, 'B');
                      loadData();
                      setContextMenu(null);
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(34,197,94,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <span style={{
                      display: 'inline-flex', width: '18px', height: '18px', borderRadius: '4px',
                      background: 'linear-gradient(135deg, #22c55e, #4ade80)',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: '10px', fontWeight: 700, color: '#fff'
                    }}>B</span>
                    <span>Bank B</span>
                  </div>
                </React.Fragment>
              ))}
            </>
          )}

          <div style={styles.contextMenuDivider} />

          {/* Show "Remove from folder" option when in a collection view */}
          {activeView !== 'library' && activeView !== 'favorites'
            && !collections.find(c => c.id === activeView && c.type === COLLECTION_TYPES.SMART) && (
            <div
              style={{...styles.contextMenuItem, color: '#f59e0b'}}
              onClick={() => {
                removeFromCollection(artistId, activeView, contextMenu.media.id);
                loadData();
                setContextMenu(null);
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <span>📁</span>
              <span>Remove from folder</span>
            </div>
          )}

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
            <span>Delete from library</span>
          </div>
        </div>
      )}

      {/* Smart Delete Modal — remove from folder vs delete everywhere */}
      {showDeleteModal && (
        <div style={styles.modal} onClick={() => setShowDeleteModal(null)}>
          <div style={{...styles.modalContent, maxWidth: '380px'}} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Delete Item</div>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', margin: '8px 0 20px', lineHeight: '1.5' }}>
              This item is in a collection. What would you like to do?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                style={{
                  padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(99, 102, 241, 0.3)',
                  backgroundColor: 'rgba(99, 102, 241, 0.1)', color: '#c4b5fd', cursor: 'pointer',
                  fontSize: '13px', fontWeight: '500', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px'
                }}
                onClick={() => handleSmartDelete('removeFromFolder')}
              >
                <span style={{ fontSize: '18px' }}>📁</span>
                <div>
                  <div style={{ fontWeight: 600 }}>Remove from this folder</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>Stays in your library and other folders</div>
                </div>
              </button>
              <button
                style={{
                  padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(239, 68, 68, 0.3)',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)', color: '#fca5a5', cursor: 'pointer',
                  fontSize: '13px', fontWeight: '500', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px'
                }}
                onClick={() => handleSmartDelete('deleteEverywhere')}
              >
                <span style={{ fontSize: '18px' }}>🗑️</span>
                <div>
                  <div style={{ fontWeight: 600 }}>Delete from library</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>Permanently remove from everywhere</div>
                </div>
              </button>
            </div>
            <button
              style={{
                marginTop: '16px', padding: '8px', borderRadius: '8px', border: 'none',
                backgroundColor: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
                fontSize: '12px', width: '100%', textAlign: 'center'
              }}
              onClick={() => setShowDeleteModal(null)}
            >
              Cancel
            </button>
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
