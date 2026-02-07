import React, { useState, useCallback, useRef, useEffect } from 'react';
import { exportSlideshowAsImages } from '../../services/slideshowExportService';
import { subscribeToLibrary, subscribeToCollections, getCollections, getCollectionsAsync, getLibrary, MEDIA_TYPES, addToTextBank, assignToBank, saveCollectionToFirestore } from '../../services/libraryService';
import { useToast } from '../ui';
import LyricBank from './LyricBank';
import AudioClipSelector from './AudioClipSelector';
import LyricAnalyzer from './LyricAnalyzer';

/**
 * SlideshowEditor - Flowstage-style carousel/slideshow creator
 *
 * Features:
 * - Image A / Image B banks for backgrounds
 * - Lyric Bank for text overlays (with paragraph selection)
 * - Drag-and-drop to add images to slides
 * - Click-to-edit text overlays
 * - Aspect ratio options (9:16 / 4:3)
 * - Export as carousel images for Instagram/TikTok
 */

const SlideshowEditor = ({
  db = null,
  artistId = null,
  category,
  existingSlideshow = null,
  initialImages = [],
  batchMode = false,
  onSave,
  onClose,
  onSchedulePost,
  onAddLyrics,
  onImportToBank,
  lateAccountIds = {}
}) => {
  // Mobile responsive detection
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);

  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Multi-timeline state: all slideshows (index 0 = template, rest = generated)
  const [allSlideshows, setAllSlideshows] = useState([{
    id: 'template',
    name: existingSlideshow?.name || 'Untitled Slideshow',
    slides: existingSlideshow?.slides || [],
    audio: existingSlideshow?.audio || null,
    isTemplate: true
  }]);
  const [activeSlideshowIndex, setActiveSlideshowIndex] = useState(0);
  const [generateCount, setGenerateCount] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);

  // Derived reads from active slideshow (existing code reads these unchanged)
  const slides = allSlideshows[activeSlideshowIndex]?.slides || [];
  const name = allSlideshows[activeSlideshowIndex]?.name || 'Untitled Slideshow';
  const selectedAudio = allSlideshows[activeSlideshowIndex]?.audio || null;

  // Wrapper setters that route through allSlideshows (existing setSlides/setName/setSelectedAudio calls work unchanged)
  const setSlides = useCallback((updater) => {
    setAllSlideshows(prev => {
      const copy = [...prev];
      const current = copy[activeSlideshowIndex];
      if (!current) return prev;
      copy[activeSlideshowIndex] = {
        ...current,
        slides: typeof updater === 'function' ? updater(current.slides) : updater
      };
      return copy;
    });
  }, [activeSlideshowIndex]);

  const setName = useCallback((val) => {
    setAllSlideshows(prev => {
      const copy = [...prev];
      const current = copy[activeSlideshowIndex];
      if (!current) return prev;
      copy[activeSlideshowIndex] = {
        ...current,
        name: typeof val === 'function' ? val(current.name) : val
      };
      return copy;
    });
  }, [activeSlideshowIndex]);

  const setSelectedAudio = useCallback((audio) => {
    setAllSlideshows(prev => {
      const copy = [...prev];
      const current = copy[activeSlideshowIndex];
      if (!current) return prev;
      copy[activeSlideshowIndex] = { ...current, audio };
      return copy;
    });
  }, [activeSlideshowIndex]);

  // Other slideshow state
  const [aspectRatio, setAspectRatio] = useState(existingSlideshow?.aspectRatio || '9:16');
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0);
  const [activeBank, setActiveBank] = useState('imageA'); // 'imageA' | 'imageB' | 'audio' | 'lyrics'
  const [libraryImages, setLibraryImages] = useState([]);
  const [collections, setCollections] = useState([]);
  const [selectedSource, setSelectedSource] = useState('bankA'); // 'bankA' | 'bankB' | 'all' | collection ID

  // Text bank input state
  const [newTextA, setNewTextA] = useState('');
  const [newTextB, setNewTextB] = useState('');

  // Add text to a text bank and update local collections state
  const handleAddToTextBank = useCallback((bankNum, text) => {
    if (!text.trim() || !artistId || collections.length === 0) return;
    const targetCol = collections[0]; // Add to first collection
    addToTextBank(artistId, targetCol.id, bankNum, text.trim());
    // Update local state so UI refreshes immediately
    setCollections(prev => prev.map(col =>
      col.id === targetCol.id
        ? { ...col, [`textBank${bankNum}`]: [...(col[`textBank${bankNum}`] || []), text.trim()] }
        : col
    ));
  }, [artistId, collections]);

  // Filmstrip drag-and-drop state
  const [filmstripDropIndex, setFilmstripDropIndex] = useState(null);
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef(null);
  const animationRef = useRef(null);

  // Text editor state
  const [editingTextId, setEditingTextId] = useState(null);
  const [textEditorPosition, setTextEditorPosition] = useState({ x: 0, y: 0 });
  const [showTextEditorPanel, setShowTextEditorPanel] = useState(false); // Flowstage-style side panel

  // AI Transcription state
  const [showLyricAnalyzer, setShowLyricAnalyzer] = useState(false);

  // Audio picker dropdown state
  const [showAudioPicker, setShowAudioPicker] = useState(false);

  // Text style templates state (persisted in localStorage)
  const [textTemplates, setTextTemplates] = useState(() => {
    try {
      const saved = localStorage.getItem('slideshowTextTemplates');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Selected default template for new text overlays
  const [selectedDefaultTemplate, setSelectedDefaultTemplate] = useState(null);

  // (Batch state removed — generation is now inline via allSlideshows)

  // Save templates to localStorage when they change
  useEffect(() => {
    localStorage.setItem('slideshowTextTemplates', JSON.stringify(textTemplates));
  }, [textTemplates]);

  // Save a new template
  const handleSaveTemplate = useCallback((template) => {
    setTextTemplates(prev => [...prev, template]);
  }, []);

  // Audio upload ref for slideshow
  const slideshowAudioInputRef = useRef(null);

  // Image import refs for banks
  const importImageARef = useRef(null);
  const importImageBRef = useRef(null);

  // Handle importing images to bank from within editor
  const handleImportImages = useCallback((e, bank) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && onImportToBank) {
      onImportToBank(files, bank);
    }
    e.target.value = '';
  }, [onImportToBank]);

  // Drop-to-bank state
  const [dragOverBankCol, setDragOverBankCol] = useState(null); // 'A' | 'B' | null

  const handleDropOnBankColumn = useCallback((e, bank) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverBankCol(null);

    // Try parsing drag data — supports both text/plain (LibraryBrowser) and application/json (SlideshowEditor)
    let mediaIds = [];
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const parsed = JSON.parse(jsonData);
        if (parsed?.id) mediaIds = [parsed.id];
      }
    } catch (err) {}
    if (mediaIds.length === 0) {
      try {
        const textData = e.dataTransfer.getData('text/plain');
        const parsed = JSON.parse(textData);
        if (Array.isArray(parsed)) mediaIds = parsed;
        else if (parsed?.id) mediaIds = [parsed.id];
      } catch (err) {}
    }

    if (mediaIds.length > 0 && artistId && collections.length > 0) {
      const targetCol = collections[0];
      assignToBank(artistId, targetCol.id, mediaIds, bank);
      // Refresh collections state
      const freshCols = getCollections(artistId);
      setCollections(freshCols);
      if (db) {
        const col = freshCols.find(c => c.id === targetCol.id);
        if (col) saveCollectionToFirestore(db, artistId, col).catch(() => {});
      }
      toastSuccess(`Added ${mediaIds.length} image${mediaIds.length > 1 ? 's' : ''} to Bank ${bank}`);
    }
  }, [artistId, collections, db, toastSuccess]);

  // Undo/Redo history
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const isUndoRedoRef = useRef(false); // Flag to skip recording during undo/redo

  // Push current slides state to history (called on meaningful changes)
  const pushHistory = useCallback((slidesSnapshot) => {
    if (isUndoRedoRef.current) return; // Don't record during undo/redo
    const history = historyRef.current;
    const idx = historyIndexRef.current;
    // Trim any forward history (redo states) when new action occurs
    historyRef.current = history.slice(0, idx + 1);
    historyRef.current.push(JSON.parse(JSON.stringify(slidesSnapshot)));
    // Cap history at 50 entries
    if (historyRef.current.length > 50) {
      historyRef.current = historyRef.current.slice(-50);
    }
    historyIndexRef.current = historyRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, []);

  // Track slides changes and push to history
  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    if (slides.length > 0) {
      pushHistory(slides);
    }
  }, [slides, pushHistory]);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current -= 1;
    const prevState = JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current]));
    setSlides(prevState);
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }, [setSlides]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current += 1;
    const nextState = JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current]));
    setSlides(nextState);
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, [setSlides]);

  // Keyboard shortcut: Cmd+Z / Ctrl+Z for undo, Cmd+Shift+Z / Ctrl+Shift+Z for redo
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // Image drag/resize state
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isResizingImage, setIsResizingImage] = useState(false);
  const [imgDragStart, setImgDragStart] = useState({ x: 0, y: 0 });
  const [imgTransformStart, setImgTransformStart] = useState({ scale: 1, offsetX: 0, offsetY: 0 });

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedImages, setExportedImages] = useState(existingSlideshow?.exportedImages || []);

  // Scheduling state
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [selectedHandle, setSelectedHandle] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });
  const [isScheduling, setIsScheduling] = useState(false);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('#carousel #slideshow #fyp');

  // Available handles from lateAccountIds
  const availableHandles = Object.keys(lateAccountIds);

  // Canvas ref for rendering
  const canvasRef = useRef(null);
  const previewRef = useRef(null);

  // Get content from category's banks (separate from video banks)
  const imagesA = category?.imagesA || [];
  const imagesB = category?.imagesB || [];
  const audioTracks = category?.audio || [];
  const lyrics = category?.lyrics || [];
  const activeContent = activeBank === 'imageA' ? imagesA : activeBank === 'imageB' ? imagesB : activeBank === 'audio' ? audioTracks : [];

  // Load library images and collections when db/artistId available
  // Strategy: instant load from localStorage, then Firestore subscription merges in background
  useEffect(() => {
    if (!artistId) return;

    // Instant load from localStorage for immediate UI (before Firestore fires)
    const cachedLibrary = getLibrary(artistId);
    if (cachedLibrary.length > 0) {
      setLibraryImages(cachedLibrary.filter(item => item.type === MEDIA_TYPES.IMAGE));
    }
    // Load collections from localStorage immediately (includes bank data)
    const cachedCols = getCollections(artistId);
    if (cachedCols.length > 0) {
      setCollections(cachedCols.filter(c => c.type !== 'smart'));
    }

    if (!db) return;

    // Build thumbnail cache from localStorage for merge
    const thumbCache = new Map();
    cachedLibrary.forEach(item => {
      if (item.thumbnailUrl) thumbCache.set(item.id, item.thumbnailUrl);
    });

    const unsubscribes = [];

    // Subscribe to library with thumbnail merge
    unsubscribes.push(subscribeToLibrary(db, artistId, (items) => {
      const merged = items.map(item => {
        if (!item.thumbnailUrl && thumbCache.has(item.id)) {
          return { ...item, thumbnailUrl: thumbCache.get(item.id) };
        }
        if (item.thumbnailUrl) thumbCache.set(item.id, item.thumbnailUrl);
        return item;
      });
      const images = merged.filter(item => item.type === MEDIA_TYPES.IMAGE);
      setLibraryImages(images);
    }));

    // Subscribe to collections in real-time — merges localStorage banks
    unsubscribes.push(subscribeToCollections(db, artistId, (cols) => {
      setCollections(cols.filter(c => c.type !== 'smart'));
    }));

    return () => unsubscribes.forEach(unsub => unsub());
  }, [db, artistId]);

  // Compute active images based on selected source
  // Supports: 'bankA', 'bankB', 'all', collectionId, 'collectionId:bankA', 'collectionId:bankB'
  // When category banks are empty, aggregates from all collection banks
  const activeImages = (() => {
    if (selectedSource === 'bankA') {
      // Use category bank first; if empty, aggregate from all collection bankA
      if (imagesA.length > 0) return imagesA;
      const allBankAIds = new Set();
      collections.forEach(col => (col.bankA || []).forEach(id => allBankAIds.add(id)));
      if (allBankAIds.size > 0) return libraryImages.filter(img => allBankAIds.has(img.id));
      return imagesA;
    }
    if (selectedSource === 'bankB') {
      // Use category bank first; if empty, aggregate from all collection bankB
      if (imagesB.length > 0) return imagesB;
      const allBankBIds = new Set();
      collections.forEach(col => (col.bankB || []).forEach(id => allBankBIds.add(id)));
      if (allBankBIds.size > 0) return libraryImages.filter(img => allBankBIds.has(img.id));
      return imagesB;
    }
    if (selectedSource === 'all') return libraryImages;

    // Collection bank source — format: "collectionId:bankA" or "collectionId:bankB"
    if (selectedSource.includes(':bank')) {
      const [colId, bankKey] = selectedSource.split(':');
      const col = collections.find(c => c.id === colId);
      if (col) {
        const bankIds = bankKey === 'bankA' ? (col.bankA || []) : (col.bankB || []);
        return libraryImages.filter(img => bankIds.includes(img.id));
      }
    }

    // Plain collection ID - filter library images by collection membership
    const col = collections.find(c => c.id === selectedSource);
    if (col && col.mediaIds) {
      return libraryImages.filter(img => col.mediaIds.includes(img.id));
    }
    // Fallback: aggregate from all collection bankA
    const fallbackIds = new Set();
    collections.forEach(col => (col.bankA || []).forEach(id => fallbackIds.add(id)));
    if (fallbackIds.size > 0) return libraryImages.filter(img => fallbackIds.has(img.id));
    return imagesA;
  })();

  // Export dimensions based on aspect ratio
  const ASPECT_DIMENSIONS = {
    '4:5': { width: 1080, height: 1350 },  // Instagram carousel (standard)
    '1:1': { width: 1080, height: 1080 },  // Square
    '9:16': { width: 1080, height: 1920 }, // Story/TikTok
    '4:3': { width: 1080, height: 1440 },  // Legacy
  };
  const exportDimensions = ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS['4:5'];

  // Preview dimensions - scale from actual aspect ratio
  const previewScale = 0.25;
  const baseDimensions = exportDimensions;
  const previewDimensions = {
    width: baseDimensions.width * previewScale,
    height: baseDimensions.height * previewScale
  };

  // Get current slide (defined early so callbacks can reference it)
  const currentSlide = slides[selectedSlideIndex];

  // Selected images in bank for bulk add — use Set for O(1) lookups
  const [selectedBankImages, setSelectedBankImages] = useState(new Set());

  // Add selected bank images as slides
  const addSelectedImagesToSlides = useCallback(() => {
    if (selectedBankImages.size === 0) return;
    const allImages = [...(activeImages || []), ...(activeContent || [])];
    const selectedArr = Array.from(selectedBankImages);
    const newSlides = selectedArr.map((imgId, i) => {
      const img = allImages.find(im => im.id === imgId) || libraryImages.find(im => im.id === imgId);
      const imageUrl = img?.url || img?.localUrl;
      if (!img || !imageUrl) return null; // H-12: skip slides with no valid image URL
      return {
        id: `slide_${Date.now()}_${i}`,
        index: slides.length + i,
        backgroundImage: imageUrl,
        thumbnail: imageUrl,
        sourceBank: selectedSource,
        sourceImageId: img.id,
        textOverlays: [],
        duration: 3,
        imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
      };
    }).filter(Boolean);
    if (newSlides.length > 0) {
      setSlides(prev => [...prev, ...newSlides]);
      setSelectedSlideIndex(slides.length);
    }
    setSelectedBankImages(new Set());
  }, [selectedBankImages, activeImages, activeContent, libraryImages, slides.length, selectedSource]);

  // Auto-start: check collection banks for random initial images
  const [autoStartAttempted, setAutoStartAttempted] = useState(false);
  const [sourceAutoSwitched, setSourceAutoSwitched] = useState(false);

  // Auto-switch source dropdown to collection banks when category banks are empty
  useEffect(() => {
    if (sourceAutoSwitched) return;
    if (!collections || collections.length === 0) return;
    // Only auto-switch if category banks are empty
    if (imagesA.length > 0 || imagesB.length > 0) return;

    // Find first collection with populated banks
    for (const col of collections) {
      if (col.bankA?.length > 0) {
        setSelectedSource(`${col.id}:bankA`);
        setSourceAutoSwitched(true);
        return;
      }
      if (col.bankB?.length > 0) {
        setSelectedSource(`${col.id}:bankB`);
        setSourceAutoSwitched(true);
        return;
      }
    }
  }, [collections, imagesA.length, imagesB.length, sourceAutoSwitched]);

  // Initialize with at least one slide, or generate batch, or use initialImages, or auto-start from banks
  useEffect(() => {
    if (slides.length === 0) {
      if (initialImages && initialImages.length > 0) {
        // Create slides from images passed from StudioHome
        const initSlides = initialImages.map((img, i) => ({
          id: `slide_${Date.now()}_${i}`,
          index: i,
          backgroundImage: img.url || img.localUrl,
          thumbnail: img.url || img.localUrl,
          sourceBank: 'library',
          sourceImageId: img.id,
          textOverlays: [],
          duration: 3,
          imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
        }));
        setSlides(initSlides);
      } else if (batchMode && (imagesA.length > 0 || imagesB.length > 0)) {
        // Batch mode: Generate 10 slides randomly from A/B banks
        const allImages = [
          ...imagesA.map(img => ({ ...img, sourceBank: 'imageA' })),
          ...imagesB.map(img => ({ ...img, sourceBank: 'imageB' }))
        ];

        if (allImages.length > 0) {
          const batchSlides = [];
          for (let i = 0; i < 10; i++) {
            const randomImage = allImages[Math.floor(Math.random() * allImages.length)];
            batchSlides.push({
              id: `slide_${Date.now()}_${i}`,
              index: i,
              backgroundImage: randomImage.url || randomImage.localUrl,
              thumbnail: randomImage.url || randomImage.localUrl,
              sourceBank: randomImage.sourceBank,
              sourceImageId: randomImage.id,
              textOverlays: [],
              duration: 3,
              imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
            });
          }
          setSlides(batchSlides);
          setName('Batch Slideshow ' + new Date().toLocaleTimeString());
        }
      } else {
        // Default: add empty slide — will be replaced by auto-start if banks load
        addSlide();
      }
    }
  // eslint-disable-next-line
  }, [batchMode, imagesA.length, imagesB.length]);

  // Auto-start from collection banks: once collections load, if slides are empty/blank
  // and any collection has bankA + bankB populated, auto-create 2 slides
  useEffect(() => {
    if (autoStartAttempted) return;
    if (!collections || collections.length === 0) return;
    if (initialImages?.length > 0 || batchMode) return;

    // Check if current slides are just a single empty slide (the default addSlide)
    const isDefaultEmpty = slides.length <= 1 && !slides[0]?.backgroundImage;
    if (!isDefaultEmpty) return;

    // Find any collection with both bankA and bankB populated
    for (const col of collections) {
      const bankAIds = col.bankA || [];
      const bankBIds = col.bankB || [];
      if (bankAIds.length > 0 && bankBIds.length > 0) {
        // Resolve bank images from library
        const bankAImages = libraryImages.filter(img => bankAIds.includes(img.id));
        const bankBImages = libraryImages.filter(img => bankBIds.includes(img.id));
        if (bankAImages.length > 0 && bankBImages.length > 0) {
          const imgA = bankAImages[Math.floor(Math.random() * bankAImages.length)];
          const imgB = bankBImages[Math.floor(Math.random() * bankBImages.length)];
          setSlides([
            {
              id: `slide_${Date.now()}_0`,
              index: 0,
              backgroundImage: imgA.url || imgA.localUrl,
              thumbnail: imgA.url || imgA.localUrl,
              sourceBank: 'imageA',
              sourceImageId: imgA.id,
              textOverlays: [],
              duration: 3,
              imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
            },
            {
              id: `slide_${Date.now()}_1`,
              index: 1,
              backgroundImage: imgB.url || imgB.localUrl,
              thumbnail: imgB.url || imgB.localUrl,
              sourceBank: 'imageB',
              sourceImageId: imgB.id,
              textOverlays: [],
              duration: 3,
              imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
            }
          ]);
          // Set source to this collection's Bank A by default
          setSelectedSource(`${col.id}:bankA`);
          setAutoStartAttempted(true);
          return;
        }
      }
    }
    setAutoStartAttempted(true);
  }, [collections, libraryImages, slides, initialImages, batchMode, autoStartAttempted]);

  // Add a new slide
  const addSlide = useCallback(() => {
    const newSlide = {
      id: `slide_${Date.now()}`,
      index: slides.length,
      backgroundImage: null,
      backgroundVideo: null,
      textOverlays: [],
      duration: 3, // Default 3 seconds per slide for video export
      imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    setSlides(prev => [...prev, newSlide]);
    setSelectedSlideIndex(slides.length);
  }, [slides.length]);

  // Remove a slide
  const removeSlide = useCallback((slideId) => {
    setSlides(prev => {
      const filtered = prev.filter(s => s.id !== slideId);
      // Re-index slides
      return filtered.map((s, i) => ({ ...s, index: i }));
    });
    // Adjust selected index if needed
    if (selectedSlideIndex >= slides.length - 1) {
      setSelectedSlideIndex(Math.max(0, slides.length - 2));
    }
  }, [slides.length, selectedSlideIndex]);

  // Keyboard Delete/Backspace to remove current slide
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingTextId && slides.length > 1) {
        e.preventDefault();
        removeSlide(slides[selectedSlideIndex]?.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSlideIndex, slides, editingTextId, removeSlide]);

  // Reorder slides
  const moveSlide = useCallback((fromIndex, toIndex) => {
    setSlides(prev => {
      const newSlides = [...prev];
      const [removed] = newSlides.splice(fromIndex, 1);
      newSlides.splice(toIndex, 0, removed);
      // Re-index
      return newSlides.map((s, i) => ({ ...s, index: i }));
    });
    setSelectedSlideIndex(toIndex);
  }, []);

  // Set background for current slide (tracks source bank for re-roll)
  const setSlideBackground = useCallback((imageUrl, thumbnail, sourceBank = null, sourceImageId = null) => {
    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? {
            ...slide,
            backgroundImage: imageUrl,
            thumbnail: thumbnail || imageUrl,
            sourceBank: sourceBank || slide.sourceBank,
            sourceImageId: sourceImageId || slide.sourceImageId,
            imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
          }
        : slide
    ));
  }, [selectedSlideIndex]);

  // Update image transform (scale + position) for current slide
  const updateSlideTransform = useCallback((transform) => {
    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? { ...slide, imageTransform: transform }
        : slide
    ));
  }, [selectedSlideIndex]);

  // Gather all reroll-eligible images for the current slide's bank
  const getRerollBank = useCallback(() => {
    if (!currentSlide?.sourceBank) return [];

    // First try category-level banks
    let bank = currentSlide.sourceBank === 'imageA' ? imagesA : currentSlide.sourceBank === 'imageB' ? imagesB : [];

    // If category banks are empty, try collection-level banks
    if (bank.length === 0 && collections?.length > 0) {
      const isA = currentSlide.sourceBank === 'imageA';
      const isB = currentSlide.sourceBank === 'imageB';
      if (isA || isB) {
        const bankKey = isA ? 'bankA' : 'bankB';
        const allBankIds = [];
        collections.forEach(col => {
          if (col[bankKey]?.length > 0) {
            allBankIds.push(...col[bankKey]);
          }
        });
        if (allBankIds.length > 0) {
          bank = libraryImages.filter(img => allBankIds.includes(img.id));
        }
      }
    }

    // Also try activeImages as fallback
    if (bank.length === 0) {
      bank = activeImages || [];
    }

    // Fallback: try all library images
    if (bank.length === 0) {
      bank = libraryImages || [];
    }

    return bank;
  }, [currentSlide, imagesA, imagesB, collections, libraryImages, activeImages]);

  // Re-roll: Replace current slide's image with random different image from same bank
  const handleReroll = useCallback(() => {
    const bank = getRerollBank();
    const otherImages = bank.filter(img => img.id !== currentSlide?.sourceImageId);
    if (otherImages.length === 0) return;

    const randomImage = otherImages[Math.floor(Math.random() * otherImages.length)];
    setSlideBackground(
      randomImage.url || randomImage.localUrl,
      randomImage.url || randomImage.localUrl,
      currentSlide.sourceBank,
      randomImage.id
    );
  }, [currentSlide, getRerollBank, setSlideBackground]);

  // Gather all text bank items from collections for text reroll
  const getTextBanks = useCallback(() => {
    let textBank1 = [];
    let textBank2 = [];
    for (const col of collections) {
      if (col.textBank1?.length > 0) textBank1 = [...textBank1, ...col.textBank1];
      if (col.textBank2?.length > 0) textBank2 = [...textBank2, ...col.textBank2];
    }
    return { textBank1, textBank2 };
  }, [collections]);

  // Re-roll text: Replace text overlays with random text from banks
  const handleTextReroll = useCallback((overlayId = null, bankSource = null) => {
    const { textBank1, textBank2 } = getTextBanks();
    if (textBank1.length === 0 && textBank2.length === 0) return;

    setSlides(prev => prev.map((slide, i) => {
      if (i !== selectedSlideIndex) return slide;
      const updatedOverlays = slide.textOverlays.map((overlay, idx) => {
        // If a specific overlay ID is given, only reroll that one
        if (overlayId && overlay.id !== overlayId) return overlay;

        // Use specified bank source, or auto-assign based on overlay index
        let bank;
        if (bankSource === 1) bank = textBank1;
        else if (bankSource === 2) bank = textBank2;
        else bank = idx === 0 ? textBank1 : idx === 1 ? textBank2 : [...textBank1, ...textBank2];
        if (bank.length === 0) return overlay;

        // Pick random text different from current if possible
        const others = bank.filter(t => t !== overlay.text);
        const pool = others.length > 0 ? others : bank;
        const randomText = pool[Math.floor(Math.random() * pool.length)];
        return { ...overlay, text: randomText };
      });
      return { ...slide, textOverlays: updatedOverlays };
    }));
  }, [selectedSlideIndex, getTextBanks]);

  // Audio playback controls - just add audio directly, user can trim later
  const handleSelectAudio = useCallback((audio) => {
    // Open the audio editor/trimmer for the selected track
    setAudioToTrim(audio);
    setShowAudioTrimmer(true);
  }, []);

  const handleAudioTrimSave = useCallback(({ startTime, endTime, duration, trimmedFile, trimmedName }) => {
    if (!audioToTrim) return;

    if (trimmedFile) {
      // Audio was actually trimmed to a new file — use it directly (starts at 0)
      const localUrl = URL.createObjectURL(trimmedFile);
      const editedAudio = {
        ...audioToTrim,
        name: trimmedName || trimmedFile.name,
        file: trimmedFile,
        url: localUrl,
        localUrl: localUrl,
        startTime: 0,
        endTime: duration,
        trimmedDuration: duration,
        isTrimmed: false, // It's a new independent file, not metadata-trimmed
        duration: duration
      };
      setSelectedAudio(editedAudio);
      setShowAudioTrimmer(false);
      setAudioToTrim(null);
    } else {
      // Metadata-only trim (fallback or full-length selection)
      const editedAudio = {
        ...audioToTrim,
        startTime,
        endTime,
        trimmedDuration: endTime - startTime,
        isTrimmed: startTime > 0 || (audioToTrim.duration && Math.abs(endTime - audioToTrim.duration) > 0.1)
      };
      setSelectedAudio(editedAudio);
      setShowAudioTrimmer(false);
      setAudioToTrim(null);
    }
  }, [audioToTrim, db, artistId]);

  // Use a ref for slides to avoid stale closures in the animation loop
  const slidesRef = useRef(slides);
  useEffect(() => { slidesRef.current = slides; }, [slides]);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current || !selectedAudio) return;

    if (isPlaying) {
      audioRef.current.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      setIsPlaying(false);
    } else {
      const startBoundary = selectedAudio.startTime || 0;
      if (audioRef.current.currentTime < startBoundary || !isFinite(audioRef.current.currentTime)) {
        audioRef.current.currentTime = startBoundary;
      }

      audioRef.current.play().then(() => {
        setIsPlaying(true);

        // Animation loop for time updates + slide auto-advance
        const updateTime = () => {
          if (!audioRef.current) return;
          const startBound = selectedAudio.startTime || 0;
          const rawDur = audioRef.current.duration;
          const endBound = (selectedAudio.endTime && selectedAudio.endTime > 0)
            ? selectedAudio.endTime
            : (isFinite(rawDur) ? rawDur : 300);
          const actualTime = audioRef.current.currentTime;
          const elapsed = actualTime - startBound;

          setCurrentTime(Math.max(0, elapsed));

          // Auto-advance slides based on cumulative duration (use ref to avoid stale closure)
          const currentSlides = slidesRef.current;
          if (currentSlides.length > 1) {
            let cumulative = 0;
            for (let i = 0; i < currentSlides.length; i++) {
              cumulative += currentSlides[i].duration || 3;
              if (elapsed < cumulative) {
                setSelectedSlideIndex(i);
                break;
              }
              if (i === currentSlides.length - 1) {
                setSelectedSlideIndex(0);
              }
            }
          }

          // Loop back if past end boundary
          if (isFinite(endBound) && actualTime >= endBound) {
            audioRef.current.currentTime = startBound;
          }

          animationRef.current = requestAnimationFrame(updateTime);
        };
        animationRef.current = requestAnimationFrame(updateTime);
      }).catch(err => {
        console.error('Audio playback failed:', err);
        setIsPlaying(false);
      });
    }
  }, [isPlaying, selectedAudio]);

  const handleRemoveAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setSelectedAudio(null);
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  // Load audio when selected
  useEffect(() => {
    if (!selectedAudio || !audioRef.current) return;

    const audioUrl = selectedAudio.url || selectedAudio.localUrl;
    if (!audioUrl) return;

    // Stop any current playback
    audioRef.current.pause();
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setIsPlaying(false);
    setCurrentTime(0);

    audioRef.current.src = audioUrl;
    audioRef.current.load();

    const handleMetadata = () => {
      if (!audioRef.current) return;
      const start = selectedAudio.startTime || 0;
      const rawDuration = audioRef.current.duration;
      // Guard against NaN/Infinity
      const end = (selectedAudio.endTime && selectedAudio.endTime > 0)
        ? selectedAudio.endTime
        : (isFinite(rawDuration) ? rawDuration : 0);
      setAudioDuration(Math.max(0, end - start));
      audioRef.current.currentTime = start;
    };

    audioRef.current.onloadedmetadata = handleMetadata;
    // Also listen for canplaythrough as a fallback for duration
    audioRef.current.oncanplaythrough = () => {
      if (audioDuration === 0) handleMetadata();
    };

    audioRef.current.onended = () => {
      const start = selectedAudio.startTime || 0;
      if (audioRef.current) audioRef.current.currentTime = start;
    };

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [selectedAudio]);

  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Image drag handlers for pan/move
  const handleImageMouseDown = useCallback((e) => {
    if (e.button !== 0) return; // Left click only
    e.preventDefault();
    e.stopPropagation();
    const transform = currentSlide?.imageTransform || { scale: 1, offsetX: 0, offsetY: 0 };
    setIsDraggingImage(true);
    setImgDragStart({ x: e.clientX, y: e.clientY });
    setImgTransformStart({ ...transform });
  }, [currentSlide]);

  const handleResizeMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const transform = currentSlide?.imageTransform || { scale: 1, offsetX: 0, offsetY: 0 };
    setIsResizingImage(true);
    setImgDragStart({ x: e.clientX, y: e.clientY });
    setImgTransformStart({ ...transform });
  }, [currentSlide]);

  useEffect(() => {
    if (!isDraggingImage && !isResizingImage) return;

    const handleMouseMove = (e) => {
      if (isDraggingImage) {
        const dx = e.clientX - imgDragStart.x;
        const dy = e.clientY - imgDragStart.y;
        updateSlideTransform({
          ...imgTransformStart,
          offsetX: imgTransformStart.offsetX + dx,
          offsetY: imgTransformStart.offsetY + dy
        });
      } else if (isResizingImage) {
        const dy = imgDragStart.y - e.clientY; // drag up = scale up
        const scaleDelta = dy / 200; // sensitivity
        const newScale = Math.max(0.2, Math.min(5, imgTransformStart.scale + scaleDelta));
        updateSlideTransform({
          ...imgTransformStart,
          scale: newScale
        });
      }
    };

    const handleMouseUp = () => {
      setIsDraggingImage(false);
      setIsResizingImage(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingImage, isResizingImage, imgDragStart, imgTransformStart, updateSlideTransform]);

  // Handle drag over
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Handle drop on canvas
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/json');
    if (data) {
      try {
        const clipData = JSON.parse(data);
        setSlideBackground(
          clipData.url || clipData.localUrl,
          clipData.thumbnail,
          clipData.sourceBank,
          clipData.id
        );
      } catch (err) {
        console.warn('Invalid drop data:', err);
      }
    }
  }, [setSlideBackground]);

  // Handle filmstrip drag over — determine insert index from cursor position
  const handleFilmstripDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const scrollContainer = e.currentTarget;
    const slideElements = scrollContainer.querySelectorAll('[data-filmstrip-slide]');
    if (slideElements.length === 0) {
      setFilmstripDropIndex(0);
      return;
    }
    const mouseX = e.clientX;
    let insertIndex = slideElements.length; // default: append at end
    for (let i = 0; i < slideElements.length; i++) {
      const rect = slideElements[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (mouseX < midX) {
        insertIndex = i;
        break;
      }
    }
    setFilmstripDropIndex(insertIndex);
  }, []);

  const handleFilmstripDragLeave = useCallback((e) => {
    // Only clear if truly leaving the filmstrip (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setFilmstripDropIndex(null);
    }
  }, []);

  // Handle filmstrip drop — insert a new slide with the dropped image at the drop position
  const handleFilmstripDrop = useCallback((e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/json');
    if (data) {
      try {
        const clipData = JSON.parse(data);
        const imageUrl = clipData.url || clipData.localUrl;
        const thumbnail = clipData.thumbnail || imageUrl;
        const insertAt = filmstripDropIndex != null ? filmstripDropIndex : slides.length;
        const newSlide = {
          id: `slide_${Date.now()}`,
          index: insertAt,
          backgroundImage: imageUrl,
          thumbnail: thumbnail,
          sourceBank: clipData.sourceBank || null,
          sourceImageId: clipData.id || null,
          textOverlays: [],
          duration: 3,
          imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
        };
        setSlides(prev => {
          const updated = [...prev];
          updated.splice(insertAt, 0, newSlide);
          return updated.map((s, i) => ({ ...s, index: i }));
        });
        setSelectedSlideIndex(insertAt);
      } catch (err) {
        console.warn('Invalid filmstrip drop data:', err);
      }
    }
    setFilmstripDropIndex(null);
  }, [filmstripDropIndex, slides.length]);

  // Default text style (can be overridden by selected template)
  const getDefaultTextStyle = useCallback(() => {
    if (selectedDefaultTemplate) {
      return { ...selectedDefaultTemplate.style };
    }
    return {
      fontSize: 48,
      fontFamily: "'Inter', sans-serif",
      fontWeight: '600',
      color: '#ffffff',
      textAlign: 'center',
      outline: true,
      outlineColor: 'rgba(0,0,0,0.5)'
    };
  }, [selectedDefaultTemplate]);

  // Add text overlay to current slide
  const addTextOverlay = useCallback(() => {
    const newOverlay = {
      id: `text_${Date.now()}`,
      text: 'Click to edit',
      style: getDefaultTextStyle(),
      position: {
        x: 50, // Center horizontally (%)
        y: 50, // Center vertically (%)
        width: 80,
        height: 20
      }
    };

    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
        : slide
    ));

    setEditingTextId(newOverlay.id);
  }, [selectedSlideIndex, getDefaultTextStyle]);

  // Update text overlay
  const updateTextOverlay = useCallback((overlayId, updates) => {
    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? {
            ...slide,
            textOverlays: slide.textOverlays.map(overlay =>
              overlay.id === overlayId ? { ...overlay, ...updates } : overlay
            )
          }
        : slide
    ));
  }, [selectedSlideIndex]);

  // Remove text overlay
  const removeTextOverlay = useCallback((overlayId) => {
    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? {
            ...slide,
            textOverlays: slide.textOverlays.filter(o => o.id !== overlayId)
          }
        : slide
    ));
    setEditingTextId(null);
  }, [selectedSlideIndex]);

  // Handle click on text overlay to edit
  const handleTextClick = useCallback((e, overlayId) => {
    e.stopPropagation();
    setEditingTextId(overlayId);
    setShowTextEditorPanel(true);
  }, []);

  // Handle click on slide image to open text editor panel
  const handleSlideClick = useCallback(() => {
    setShowTextEditorPanel(true);
  }, []);

  // State for showing "save to bank" option after transcription
  const [transcribedLyrics, setTranscribedLyrics] = useState(null);
  const [showSaveToBankPrompt, setShowSaveToBankPrompt] = useState(false);

  // State for lyric bank picker dropdown
  const [showLyricBankPicker, setShowLyricBankPicker] = useState(false);

  // Close lyric bank picker when clicking outside
  useEffect(() => {
    if (!showLyricBankPicker) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('[data-lyric-bank-picker]')) {
        setShowLyricBankPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLyricBankPicker]);

  // Handle AI transcription completion - add lyrics to slide and offer to save to bank
  const handleTranscriptionComplete = useCallback((result) => {
    if (result?.text) {
      // Add text overlay with the transcribed lyrics
      const newOverlay = {
        id: `text_${Date.now()}`,
        text: result.text,
        style: {
          fontSize: 36,
          fontFamily: "'Inter', sans-serif",
          fontWeight: '600',
          color: '#ffffff',
          textAlign: 'center',
          outline: true,
          outlineColor: 'rgba(0,0,0,0.5)'
        },
        position: { x: 50, y: 50, width: 80, height: 20 }
      };
      setSlides(prev => prev.map((slide, i) =>
        i === selectedSlideIndex
          ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
          : slide
      ));
      setEditingTextId(newOverlay.id);
      setShowTextEditorPanel(true);

      // Store transcribed lyrics and show save prompt
      setTranscribedLyrics(result.text);
      setShowSaveToBankPrompt(true);
    }
    setShowLyricAnalyzer(false);
  }, [selectedSlideIndex]);

  // Save transcribed lyrics to lyric bank
  const handleSaveToLyricBank = useCallback(() => {
    if (transcribedLyrics && onAddLyrics) {
      const title = selectedAudio?.name || 'Transcribed Lyrics';
      onAddLyrics({
        id: `lyric_${Date.now()}`,
        title: title.replace(/\.[^/.]+$/, ''), // Remove file extension
        content: transcribedLyrics,
        createdAt: new Date().toISOString()
      });
    }
    setShowSaveToBankPrompt(false);
    setTranscribedLyrics(null);
  }, [transcribedLyrics, selectedAudio, onAddLyrics]);

  // Handle audio file upload in slideshow editor - opens the audio editor/trimmer
  const handleSlideshowAudioUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const audioObj = {
        id: `audio_${Date.now()}`,
        file,
        url,
        localUrl: url,
        name: file.name,
        startTime: 0,
        endTime: null
      };
      // Open the audio editor/trimmer with this uploaded file
      setAudioToTrim(audioObj);
      setShowAudioTrimmer(true);
    }
    e.target.value = '';
  }, []);

  // Save active slideshow only (does NOT close editor so user can keep editing other timelines)
  const handleSave = useCallback(() => {
    const activeSlideshow = allSlideshows[activeSlideshowIndex];
    if (!activeSlideshow) return;
    const slideshowData = {
      id: activeSlideshow.isTemplate ? (existingSlideshow?.id || `slideshow_${Date.now()}`) : activeSlideshow.id,
      name: activeSlideshow.name,
      aspectRatio,
      slides: activeSlideshow.slides,
      audio: activeSlideshow.audio,
      status: 'draft',
      createdAt: existingSlideshow?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onSave?.(slideshowData);
    toastSuccess(`Saved "${activeSlideshow.name}"`);
  }, [allSlideshows, activeSlideshowIndex, aspectRatio, existingSlideshow, onSave]);

  // Save all slideshows and close
  const handleSaveAllAndClose = useCallback(() => {
    for (const ss of allSlideshows) {
      const slideshowData = {
        id: ss.isTemplate ? (existingSlideshow?.id || `slideshow_${Date.now()}`) : ss.id,
        name: ss.name,
        aspectRatio,
        slides: ss.slides,
        audio: ss.audio,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      onSave?.(slideshowData);
    }
    onClose?.();
  }, [allSlideshows, aspectRatio, existingSlideshow, onSave, onClose]);

  // Switch active slideshow (timeline)
  const switchToSlideshow = useCallback((index) => {
    if (index === activeSlideshowIndex) return;
    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    setIsPlaying(false);
    setCurrentTime(0);
    // Reset editor state
    setSelectedSlideIndex(0);
    setEditingTextId(null);
    setShowTextEditorPanel(false);
    // Reset undo/redo for new timeline
    historyRef.current = [];
    historyIndexRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    // Switch
    setActiveSlideshowIndex(index);
  }, [activeSlideshowIndex]);

  // Delete a generated slideshow (cannot delete template at index 0)
  const handleDeleteSlideshow = useCallback((index) => {
    if (index === 0) return; // Cannot delete template
    setAllSlideshows(prev => prev.filter((_, i) => i !== index));
    // Adjust active index if needed
    if (activeSlideshowIndex === index) {
      setActiveSlideshowIndex(Math.max(0, index - 1));
      setSelectedSlideIndex(0);
    } else if (activeSlideshowIndex > index) {
      setActiveSlideshowIndex(prev => prev - 1);
    }
  }, [activeSlideshowIndex]);

  // Generate more slideshows from template
  const [showAudioPrompt, setShowAudioPrompt] = useState(false);

  // Core generation logic (called after any prompts are resolved)
  const executeGeneration = useCallback(() => {
    const templateSS = allSlideshows[0];
    if (!templateSS || templateSS.slides.length === 0) return;

    setIsGenerating(true);

    try {
      // Gather image banks
      const imgA = category?.imagesA || [];
      const imgB = category?.imagesB || [];
      let collBankA = [];
      let collBankB = [];
      if (collections.length > 0) {
        for (const col of collections) {
          if (col.bankA?.length > 0) {
            collBankA = [...collBankA, ...libraryImages.filter(img => col.bankA.includes(img.id))];
          }
          if (col.bankB?.length > 0) {
            collBankB = [...collBankB, ...libraryImages.filter(img => col.bankB.includes(img.id))];
          }
        }
      }
      const allImgA = [...imgA, ...collBankA];
      const allImgB = [...imgB, ...collBankB];

      if (allImgA.length === 0 && allImgB.length === 0) {
        toastError('No images in banks. Add images to Bank A and Bank B first.');
        return;
      }

      // Gather text banks
      const { textBank1, textBank2 } = getTextBanks();

      // Current count of generated slideshows (for naming)
      const existingGenCount = allSlideshows.filter(ss => !ss.isTemplate).length;
      const timestamp = Date.now();

      const generated = [];
      for (let i = 0; i < generateCount; i++) {
        const newSlides = [];

        // Mirror template structure — same number of slides
        for (let s = 0; s < templateSS.slides.length; s++) {
          const templateSlide = templateSS.slides[s];

          // Pick random image from alternating banks
          const useA = s % 2 === 0;
          const bank = useA ? allImgA : allImgB;
          const randomImg = bank.length > 0 ? bank[Math.floor(Math.random() * bank.length)] : null;

          // Copy text overlays from template — keep styling, randomize text content
          // Text bank is assigned per SLIDE index: slide 0 → textBank1, slide 1 → textBank2
          const slideTBank = s === 0 ? textBank1 : s === 1 ? textBank2 : [...textBank1, ...textBank2];
          const newTextOverlays = (templateSlide.textOverlays || []).map((overlay, textIdx) => {
            let randomText = overlay.text;
            if (slideTBank.length > 0) {
              randomText = slideTBank[Math.floor(Math.random() * slideTBank.length)];
            }
            return {
              ...overlay,
              id: `text_${timestamp}_${i}_${s}_${textIdx}`,
              text: randomText
            };
          });

          newSlides.push({
            id: `slide_${timestamp}_${i}_${s}`,
            index: s,
            backgroundImage: randomImg?.url || randomImg?.localUrl || null,
            thumbnail: randomImg?.url || randomImg?.localUrl || null,
            sourceBank: useA ? 'imageA' : 'imageB',
            sourceImageId: randomImg?.id || null,
            textOverlays: newTextOverlays,
            duration: templateSlide.duration || 3,
            imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
          });
        }

        generated.push({
          id: `slideshow_${timestamp}_gen_${i}`,
          name: `Generated ${existingGenCount + i + 1}`,
          slides: newSlides,
          audio: templateSS.audio, // Inherit template audio
          isTemplate: false
        });
      }

      setAllSlideshows(prev => [...prev, ...generated]);
      toastSuccess(`Generated ${generated.length} slideshows!`);
    } finally {
      setIsGenerating(false);
    }
  }, [allSlideshows, generateCount, category, collections, libraryImages, getTextBanks]);

  // Public generate handler — checks for audio prompt on first generation
  const handleGenerateMore = useCallback(() => {
    const templateSS = allSlideshows[0];
    if (!templateSS || templateSS.slides.length === 0) {
      toastError('Add at least one slide to the template before generating.');
      return;
    }
    // First-time generation: prompt to add audio if none set
    if (allSlideshows.length === 1 && !templateSS.audio) {
      setShowAudioPrompt(true);
      return;
    }
    executeGeneration();
  }, [allSlideshows, executeGeneration]);

  // Export slideshow as carousel images
  const handleExport = useCallback(async () => {
    // Check if there are slides with backgrounds
    const slidesWithContent = slides.filter(s => s.backgroundImage);
    if (slidesWithContent.length === 0) {
      toastError('Please add at least one image to your slides before exporting.');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      const images = await exportSlideshowAsImages(
        { name, aspectRatio, slides },
        (progress) => setExportProgress(progress)
      );

      console.log('[Export] Complete:', images);
      setExportedImages(images);

      // Save the slideshow with export URLs
      const slideshowData = {
        id: existingSlideshow?.id || `slideshow_${Date.now()}`,
        name,
        aspectRatio,
        slides,
        status: 'rendered',
        exportedImages: images,
        createdAt: existingSlideshow?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      onSave?.(slideshowData);

      // Initialize schedule date to today
      const today = new Date();
      setScheduleDate(today.toISOString().split('T')[0]);

      // Show schedule panel if Late.co integration is available
      if (onSchedulePost && availableHandles.length > 0) {
        setShowSchedulePanel(true);
      } else {
        toastSuccess(`Successfully exported ${images.length} carousel images!`);
      }
    } catch (err) {
      console.error('[Export] Failed:', err);
      toastError(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [name, aspectRatio, slides, existingSlideshow, onSave, onSchedulePost, availableHandles.length]);

  // Schedule the carousel post
  const handleSchedule = useCallback(async () => {
    if (!selectedHandle) {
      toastError('Please select an account');
      return;
    }

    if (exportedImages.length === 0) {
      toastError('Please export the slideshow first');
      return;
    }

    const accountMapping = lateAccountIds[selectedHandle];
    if (!accountMapping) {
      toastError(`No account mapping found for ${selectedHandle}`);
      return;
    }

    setIsScheduling(true);

    try {
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`);
      const fullCaption = `${caption}\n\n${hashtags}`.trim();

      // Build platforms array
      const platformsArray = [];
      if (platforms.tiktok && accountMapping.tiktok) {
        platformsArray.push({
          platform: 'tiktok',
          accountId: accountMapping.tiktok
        });
      }
      if (platforms.instagram && accountMapping.instagram) {
        platformsArray.push({
          platform: 'instagram',
          accountId: accountMapping.instagram
        });
      }

      if (platformsArray.length === 0) {
        toastError('Please select at least one platform');
        setIsScheduling(false);
        return;
      }

      // Schedule as carousel (array of image URLs)
      await onSchedulePost({
        platforms: platformsArray,
        caption: fullCaption,
        mediaUrls: exportedImages.map(img => img.url), // Carousel images
        mediaType: 'carousel',
        scheduledFor: scheduledFor.toISOString()
      });

      toastSuccess(`Scheduled carousel to ${platformsArray.map(p => p.platform).join(' & ')}!`);
      setShowSchedulePanel(false);
      onClose?.();
    } catch (err) {
      console.error('[Schedule] Failed:', err);
      toastError(`Scheduling failed: ${err.message}`);
    } finally {
      setIsScheduling(false);
    }
  }, [selectedHandle, exportedImages, lateAccountIds, scheduleDate, scheduleTime, caption, hashtags, platforms, onSchedulePost, onClose]);

  // Mobile panel state
  const [mobilePanelTab, setMobilePanelTab] = useState('preview'); // 'preview' | 'banks' | 'text'

  return (
    <div style={{
      ...styles.overlay,
      ...(isMobile ? { padding: 0 } : {})
    }}>
      <div style={{
        ...styles.modal,
        ...(isMobile ? {
          width: '100%',
          height: '100vh',
          borderRadius: 0
        } : {})
      }}>
        {/* Header */}
        <header style={{
          ...styles.header,
          ...(isMobile ? {
            padding: '12px 16px',
            flexWrap: 'wrap',
            gap: '8px'
          } : {})
        }}>
          <div style={{
            ...styles.headerLeft,
            ...(isMobile ? { order: 1, flex: '1 1 auto' } : {})
          }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                ...styles.nameInput,
                ...(isMobile ? { width: '100%', fontSize: '16px' } : {})
              }}
              placeholder="Slideshow name..."
            />
          </div>

          {!isMobile && (
            <div style={styles.headerCenter}>
              {/* Aspect Ratio Toggle */}
              <div style={styles.aspectToggle}>
                <button
                  style={{
                  ...styles.aspectButton,
                  ...(aspectRatio === '9:16' ? styles.aspectButtonActive : {})
                }}
                onClick={() => setAspectRatio('9:16')}
              >
                TikTok
              </button>
              <button
                  style={{
                  ...styles.aspectButton,
                  ...(aspectRatio === '4:5' ? styles.aspectButtonActive : {})
                }}
                onClick={() => setAspectRatio('4:5')}
              >
                Instagram
              </button>
            </div>

            {/* Default Template Selector */}
            {textTemplates.length > 0 && (
              <div style={styles.templateSelector}>
                <label style={styles.templateLabel}>Text Style:</label>
                <select
                  value={selectedDefaultTemplate?.id || ''}
                  onChange={(e) => {
                    const template = textTemplates.find(t => t.id === e.target.value);
                    setSelectedDefaultTemplate(template || null);
                  }}
                  style={styles.templateSelect}
                >
                  <option value="">Default</option>
                  {textTemplates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          )}

          <div style={{
            ...styles.headerRight,
            ...(isMobile ? { order: 2, gap: '8px' } : {})
          }}>
            {!isMobile && (
              <>
                <button style={styles.saveButton} onClick={handleSave}>
                  Save Draft
                </button>
                {allSlideshows.length > 1 && (
                  <button
                    style={{
                      ...styles.saveButton,
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      color: '#fff'
                    }}
                    onClick={handleSaveAllAndClose}
                  >
                    Save All ({allSlideshows.length})
                  </button>
                )}
              </>
            )}
            <button
              style={{
                ...styles.exportButton,
                ...(isMobile ? { padding: '10px 16px', fontSize: '13px' } : {})
              }}
              onClick={handleExport}
              disabled={isExporting || slides.filter(s => s.backgroundImage).length === 0}
            >
              {isExporting ? (
                <>
                  <span style={styles.exportSpinner} />
                  {isMobile ? `${exportProgress}%` : `Exporting ${exportProgress}%`}
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {isMobile ? 'Export' : 'Export Carousel'}
                </>
              )}
            </button>
            <button style={{
              ...styles.closeButton,
              ...(isMobile ? { padding: '10px' } : {})
            }} onClick={onClose}>
              <svg width={isMobile ? 24 : 20} height={isMobile ? 24 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Mobile Tab Bar */}
        {isMobile && (
          <div style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            backgroundColor: '#1a1a2e'
          }}>
            <button
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                backgroundColor: mobilePanelTab === 'preview' ? '#6366f1' : 'transparent',
                color: mobilePanelTab === 'preview' ? '#fff' : '#9ca3af',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
              onClick={() => setMobilePanelTab('preview')}
            >
              Preview
            </button>
            <button
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                backgroundColor: mobilePanelTab === 'banks' ? '#6366f1' : 'transparent',
                color: mobilePanelTab === 'banks' ? '#fff' : '#9ca3af',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
              onClick={() => setMobilePanelTab('banks')}
            >
              Media
            </button>
            <button
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                backgroundColor: mobilePanelTab === 'text' ? '#6366f1' : 'transparent',
                color: mobilePanelTab === 'text' ? '#fff' : '#9ca3af',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
              onClick={() => setMobilePanelTab('text')}
            >
              Text
            </button>
          </div>
        )}

        {/* Main Content */}
        <div style={{
          ...styles.content,
          ...(isMobile ? { flexDirection: 'column' } : {})
        }}>
          {/* Left Panel - Content Banks */}
          {(!isMobile || mobilePanelTab === 'banks') && (
          <div style={{
            ...styles.leftPanel,
            ...(isMobile ? {
              width: '100%',
              height: isMobile ? '100%' : 'auto',
              borderRight: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.1)'
            } : {})
          }}>
            {/* Source Dropdown */}
            <div style={{
              padding: '8px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.1)'
            }}>
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  backgroundColor: '#1a1a2e',
                  color: '#fff',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="bankA">Image Bank A (Category)</option>
                <option value="bankB">Image Bank B (Category)</option>
                {(db && artistId) && <option value="all">All Media (Library)</option>}
                {collections.filter(c => c.type !== 'smart').map(c => {
                  const hasBanks = (c.bankA?.length > 0 || c.bankB?.length > 0);
                  return (
                    <React.Fragment key={c.id}>
                      <option value={c.id}>{c.name} — All</option>
                      {hasBanks && <option value={`${c.id}:bankA`}>{c.name} → Bank A ({c.bankA?.length || 0})</option>}
                      {hasBanks && <option value={`${c.id}:bankB`}>{c.name} → Bank B ({c.bankB?.length || 0})</option>}
                    </React.Fragment>
                  );
                })}
              </select>
            </div>

            {/* 3-Column Layout: Image A | Image B | Text Banks */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Column 1: Image A — drop zone */}
              <div
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                  border: dragOverBankCol === 'A' ? '2px dashed rgba(20, 184, 166, 0.6)' : undefined,
                  backgroundColor: dragOverBankCol === 'A' ? 'rgba(20, 184, 166, 0.05)' : undefined,
                  transition: 'all 0.15s ease'
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverBankCol('A'); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverBankCol(null); }}
                onDrop={(e) => handleDropOnBankColumn(e, 'A')}
              >
                <div style={{ padding: '6px 8px', fontSize: '11px', fontWeight: '600', color: '#5eead4', borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(20,184,166,0.08)', textAlign: 'center' }}>
                  Image A
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
                  {(() => {
                    const bankAImages = (() => {
                      const col = collections.find(c => c.id === (typeof selectedSource === 'string' && selectedSource.includes(':') ? selectedSource.split(':')[0] : selectedSource));
                      if (col?.bankA?.length > 0) {
                        return libraryImages.filter(item => col.bankA.includes(item.id));
                      }
                      return imagesA;
                    })();
                    return bankAImages.length === 0 ? (
                      <div style={{ fontSize: '11px', color: '#6b7280', padding: '16px 8px', textAlign: 'center' }}>
                        No images in Bank A
                        {onImportToBank && (
                          <button
                            style={{ marginTop: '8px', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: '11px', cursor: 'pointer', display: 'block', width: '100%' }}
                            onClick={() => importImageARef.current?.click()}
                          >
                            + Import
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                        {bankAImages.map(image => {
                          const isSel = selectedBankImages.has(image.id);
                          return (
                            <div key={image.id} style={{ ...styles.clipCard, border: isSel ? '1px solid rgba(20,184,166,0.5)' : '1px solid transparent', position: 'relative' }}
                              draggable
                              onClick={(e) => {
                                if (e.metaKey || e.ctrlKey) {
                                  setSelectedBankImages(prev => { const next = new Set(prev); if (next.has(image.id)) next.delete(image.id); else next.add(image.id); return next; });
                                } else {
                                  setSelectedBankImages(prev => prev.size === 1 && prev.has(image.id) ? new Set() : new Set([image.id]));
                                }
                                setActiveBank('imageA');
                              }}
                              onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ ...image, url: image.url || image.localUrl, thumbnail: image.url || image.localUrl, sourceBank: 'imageA' })); }}
                            >
                              {isSel && <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(20,184,166,0.2)', zIndex: 1, pointerEvents: 'none', borderRadius: '6px' }}><div style={{ position: 'absolute', bottom: 3, right: 3, width: '14px', height: '14px', backgroundColor: '#14b8a6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#fff', fontWeight: 'bold' }}>✓</div></div>}
                              <img src={image.thumbnailUrl || image.url || image.localUrl} alt={image.name} style={styles.clipThumbnail} loading="lazy" />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Column 2: Image B — drop zone */}
              <div
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                  border: dragOverBankCol === 'B' ? '2px dashed rgba(245, 158, 11, 0.6)' : undefined,
                  backgroundColor: dragOverBankCol === 'B' ? 'rgba(245, 158, 11, 0.05)' : undefined,
                  transition: 'all 0.15s ease'
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverBankCol('B'); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverBankCol(null); }}
                onDrop={(e) => handleDropOnBankColumn(e, 'B')}
              >
                <div style={{ padding: '6px 8px', fontSize: '11px', fontWeight: '600', color: '#fbbf24', borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(245,158,11,0.08)', textAlign: 'center' }}>
                  Image B
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
                  {(() => {
                    const bankBImages = (() => {
                      const col = collections.find(c => c.id === (typeof selectedSource === 'string' && selectedSource.includes(':') ? selectedSource.split(':')[0] : selectedSource));
                      if (col?.bankB?.length > 0) {
                        return libraryImages.filter(item => col.bankB.includes(item.id));
                      }
                      return imagesB;
                    })();
                    return bankBImages.length === 0 ? (
                      <div style={{ fontSize: '11px', color: '#6b7280', padding: '16px 8px', textAlign: 'center' }}>
                        No images in Bank B
                        {onImportToBank && (
                          <button
                            style={{ marginTop: '8px', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.1)', color: '#fbbf24', fontSize: '11px', cursor: 'pointer', display: 'block', width: '100%' }}
                            onClick={() => importImageBRef.current?.click()}
                          >
                            + Import
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                        {bankBImages.map(image => {
                          const isSel = selectedBankImages.has(image.id);
                          return (
                            <div key={image.id} style={{ ...styles.clipCard, border: isSel ? '1px solid rgba(245,158,11,0.5)' : '1px solid transparent', position: 'relative' }}
                              draggable
                              onClick={(e) => {
                                if (e.metaKey || e.ctrlKey) {
                                  setSelectedBankImages(prev => { const next = new Set(prev); if (next.has(image.id)) next.delete(image.id); else next.add(image.id); return next; });
                                } else {
                                  setSelectedBankImages(prev => prev.size === 1 && prev.has(image.id) ? new Set() : new Set([image.id]));
                                }
                                setActiveBank('imageB');
                              }}
                              onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ ...image, url: image.url || image.localUrl, thumbnail: image.url || image.localUrl, sourceBank: 'imageB' })); }}
                            >
                              {isSel && <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(245,158,11,0.2)', zIndex: 1, pointerEvents: 'none', borderRadius: '6px' }}><div style={{ position: 'absolute', bottom: 3, right: 3, width: '14px', height: '14px', backgroundColor: '#f59e0b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#fff', fontWeight: 'bold' }}>✓</div></div>}
                              <img src={image.thumbnailUrl || image.url || image.localUrl} alt={image.name} style={styles.clipThumbnail} loading="lazy" />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Column 3: Text Banks + Audio */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '6px 8px', fontSize: '11px', fontWeight: '600', color: '#f9a8d4', borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(236,72,153,0.08)', textAlign: 'center' }}>
                  Text Banks
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                  {/* Text Bank A */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#f9a8d4', marginBottom: '6px' }}>
                      Text A <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: '400' }}>Slide 1</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                      <input type="text" value={newTextA} onChange={(e) => setNewTextA(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToTextBank(1, newTextA); setNewTextA(''); } }}
                        placeholder="Add text..." style={{ flex: 1, padding: '5px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '11px', outline: 'none' }} />
                      <button onClick={() => { if (newTextA.trim()) { handleAddToTextBank(1, newTextA); setNewTextA(''); } }} disabled={!newTextA.trim()}
                        style={{ padding: '5px 8px', borderRadius: '5px', border: 'none', backgroundColor: newTextA.trim() ? 'rgba(236,72,153,0.3)' : 'rgba(255,255,255,0.05)', color: newTextA.trim() ? '#f9a8d4' : '#4b5563', fontSize: '11px', cursor: newTextA.trim() ? 'pointer' : 'default' }}>+</button>
                    </div>
                    {(() => {
                      const { textBank1 } = getTextBanks();
                      return textBank1.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {textBank1.map((text, i) => (
                            <div key={i} onClick={() => {
                              if (selectedSlideIndex >= 0 && slides[selectedSlideIndex]) {
                                const newOverlay = { id: `text_${Date.now()}_${i}`, text, style: getDefaultTextStyle(), position: { x: 50, y: 50, width: 80, height: 20 } };
                                setSlides(prev => prev.map((slide, idx) => idx === selectedSlideIndex ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] } : slide));
                                setEditingTextId(newOverlay.id);
                              }
                            }} style={{ padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: '#d1d5db', fontSize: '11px', cursor: 'pointer', lineHeight: '1.3', wordBreak: 'break-word' }} title="Click to add as overlay">{text}</div>
                          ))}
                        </div>
                      ) : <div style={{ fontSize: '10px', color: '#6b7280', padding: '6px', textAlign: 'center' }}>No text yet</div>;
                    })()}
                  </div>

                  <div style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: '12px' }} />

                  {/* Text Bank B */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#a5b4fc', marginBottom: '6px' }}>
                      Text B <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: '400' }}>Slide 2</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                      <input type="text" value={newTextB} onChange={(e) => setNewTextB(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToTextBank(2, newTextB); setNewTextB(''); } }}
                        placeholder="Add text..." style={{ flex: 1, padding: '5px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '11px', outline: 'none' }} />
                      <button onClick={() => { if (newTextB.trim()) { handleAddToTextBank(2, newTextB); setNewTextB(''); } }} disabled={!newTextB.trim()}
                        style={{ padding: '5px 8px', borderRadius: '5px', border: 'none', backgroundColor: newTextB.trim() ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)', color: newTextB.trim() ? '#a5b4fc' : '#4b5563', fontSize: '11px', cursor: newTextB.trim() ? 'pointer' : 'default' }}>+</button>
                    </div>
                    {(() => {
                      const { textBank2 } = getTextBanks();
                      return textBank2.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {textBank2.map((text, i) => (
                            <div key={i} onClick={() => {
                              if (selectedSlideIndex >= 0 && slides[selectedSlideIndex]) {
                                const newOverlay = { id: `text_${Date.now()}_${i}`, text, style: getDefaultTextStyle(), position: { x: 50, y: 50, width: 80, height: 20 } };
                                setSlides(prev => prev.map((slide, idx) => idx === selectedSlideIndex ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] } : slide));
                                setEditingTextId(newOverlay.id);
                              }
                            }} style={{ padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: '#d1d5db', fontSize: '11px', cursor: 'pointer', lineHeight: '1.3', wordBreak: 'break-word' }} title="Click to add as overlay">{text}</div>
                          ))}
                        </div>
                      ) : <div style={{ fontSize: '10px', color: '#6b7280', padding: '6px', textAlign: 'center' }}>No text yet</div>;
                    })()}
                  </div>

                  <div style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: '12px' }} />

                  {/* Audio section */}
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#4ade80', marginBottom: '6px' }}>
                      🎵 Audio
                    </div>
                    {(!selectedAudio && audioTracks.length === 0) ? (
                      <button style={{ ...styles.uploadAudioBtn, width: '100%', fontSize: '11px', padding: '6px 10px' }} onClick={() => slideshowAudioInputRef.current?.click()}>
                        + Add Audio
                      </button>
                    ) : (
                      <div>
                        {selectedAudio && (
                          <div style={{ padding: '6px 8px', backgroundColor: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '6px', marginBottom: '4px' }}>
                            <div style={{ fontSize: '11px', color: '#4ade80', fontWeight: '500' }}>{selectedAudio.name}</div>
                            <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>{formatTime(selectedAudio.trimmedDuration || selectedAudio.duration || 0)}</div>
                            <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                              <button style={{ fontSize: '10px', padding: '3px 6px', borderRadius: '4px', border: '1px solid rgba(74,222,128,0.3)', backgroundColor: 'transparent', color: '#4ade80', cursor: 'pointer' }} onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}>Trim</button>
                              <button style={{ fontSize: '10px', padding: '3px 6px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer' }} onClick={handleRemoveAudio}>Remove</button>
                            </div>
                          </div>
                        )}
                        {audioTracks.filter(a => a.id !== selectedAudio?.id).map(audio => (
                          <div key={audio.id} style={{ padding: '5px 8px', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', cursor: 'pointer', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => handleSelectAudio(audio)}>
                            <span style={{ fontSize: '11px', color: '#d1d5db', flex: 1 }}>{audio.name}</span>
                            <span style={{ fontSize: '10px', color: '#6b7280' }}>{formatTime(audio.duration || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Selection action bar */}
            {selectedBankImages.size > 0 && (
              <div style={{ display: 'flex', gap: '8px', padding: '6px 10px', borderTop: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(99,102,241,0.05)' }}>
                <button onClick={addSelectedImagesToSlides} style={{ flex: 1, padding: '6px 12px', backgroundColor: '#7c3aed', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>
                  Add {selectedBankImages.size} to Slides
                </button>
                <button onClick={() => setSelectedBankImages(new Set())} style={{ padding: '6px 8px', backgroundColor: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>Clear</button>
              </div>
            )}

            {/* Old bank content - now only for fallback image display (kept hidden) */}
            <div style={{ ...styles.bankContent, display: 'none' }}>
              {activeBank === 'audio' ? (
                /* Audio Bank Panel */
                (!selectedAudio && audioTracks.length === 0) ? (
                  <div style={styles.emptyBank}>
                    <p>No audio tracks</p>
                    <p style={styles.emptySubtext}>Upload audio to get started</p>
                    <button
                      style={styles.uploadAudioBtn}
                      onClick={() => slideshowAudioInputRef.current?.click()}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      Add Audio
                    </button>
                  </div>
                ) : (
                  <div style={styles.audioList}>
                    {/* Selected Audio Indicator */}
                    {selectedAudio && (
                      <div style={styles.selectedAudioCard}>
                        <div style={styles.selectedAudioHeader}>
                          <span style={styles.selectedAudioIcon}>🎵</span>
                          <span style={styles.selectedAudioLabel}>Selected</span>
                        </div>
                        <div style={styles.selectedAudioName}>{selectedAudio.name}</div>
                        <div style={styles.selectedAudioDuration}>
                          {formatTime(selectedAudio.trimmedDuration || selectedAudio.duration || 0)}
                          {selectedAudio.isTrimmed && <span style={styles.trimmedBadge}>Trimmed</span>}
                        </div>
                        <div style={styles.selectedAudioActions}>
                          <button
                            style={styles.trimAudioBtn}
                            onClick={() => {
                              setAudioToTrim(selectedAudio);
                              setShowAudioTrimmer(true);
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="6" cy="6" r="3"/>
                              <circle cx="6" cy="18" r="3"/>
                              <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                              <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                              <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                            </svg>
                            Trim
                          </button>
                          <button style={styles.removeAudioBtn} onClick={handleRemoveAudio}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Audio Track List from bank */}
                    {audioTracks.map(audio => (
                      <div
                        key={audio.id}
                        style={{
                          ...styles.audioCard,
                          ...(selectedAudio?.id === audio.id ? styles.audioCardSelected : {})
                        }}
                        onClick={() => handleSelectAudio(audio)}
                      >
                        <div style={styles.audioCardIcon}>🎵</div>
                        <div style={styles.audioCardInfo}>
                          <div style={styles.audioCardName}>{audio.name}</div>
                          <div style={styles.audioCardDuration}>
                            {formatTime(audio.duration || 0)}
                          </div>
                        </div>
                        <button style={styles.audioSelectBtn}>
                          {selectedAudio?.id === audio.id ? '✓' : 'Use'}
                        </button>
                      </div>
                    ))}
                    {/* Add more audio button when audio already exists */}
                    <button
                      style={{
                        ...styles.uploadAudioBtn,
                        marginTop: '8px',
                        width: '100%',
                        opacity: 0.7
                      }}
                      onClick={() => slideshowAudioInputRef.current?.click()}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      Replace Audio
                    </button>
                  </div>
                )
              ) : (() => {
                // Always use activeImages which respects the selectedSource dropdown
                const displayImages = (activeBank === 'imageA' || activeBank === 'imageB') ? activeImages : activeContent;
                const sourceName = selectedSource === 'bankA' ? 'Image A' : selectedSource === 'bankB' ? 'Image B' : selectedSource === 'all' ? 'Library' : collections.find(c => selectedSource.startsWith(c.id))?.name || 'Collection';
                return displayImages.length === 0 ? (
                  <div style={styles.emptyBank}>
                    <p>No images in {sourceName}</p>
                    <p style={styles.emptySubtext}>Upload images in the Aesthetic Home</p>
                    {onImportToBank && (activeBank === 'imageA' || activeBank === 'imageB') && (
                      <button
                        style={{
                          marginTop: '8px', padding: '8px 16px', borderRadius: '8px',
                          border: '1px solid rgba(99,102,241,0.4)', backgroundColor: 'rgba(99,102,241,0.15)',
                          color: '#a5b4fc', fontSize: '12px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                        onClick={() => (activeBank === 'imageA' ? importImageARef : importImageBRef).current?.click()}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14"/>
                        </svg>
                        Import Images
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                  {selectedBankImages.size > 0 && (
                    <div style={{ display: 'flex', gap: '8px', padding: '4px 0', marginBottom: '4px' }}>
                      <button
                        onClick={addSelectedImagesToSlides}
                        style={{
                          flex: 1,
                          padding: '6px 12px',
                          backgroundColor: '#7c3aed',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        Add {selectedBankImages.size} to Slides
                      </button>
                      <button
                        onClick={() => setSelectedBankImages(new Set())}
                        style={{
                          padding: '6px 8px',
                          backgroundColor: 'transparent',
                          color: 'rgba(255,255,255,0.6)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '6px',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                  <div style={styles.clipGrid}>
                    {displayImages.map(image => {
                      const isSel = selectedBankImages.has(image.id);
                      return (
                      <div
                        key={image.id}
                        style={{
                          ...styles.clipCard,
                          border: isSel ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid transparent',
                          position: 'relative'
                        }}
                        draggable
                        onClick={(e) => {
                          const isMetaKey = e.metaKey || e.ctrlKey;
                          if (isMetaKey) {
                            // Cmd/Ctrl+click: toggle in/out
                            setSelectedBankImages(prev => {
                              const next = new Set(prev);
                              if (next.has(image.id)) next.delete(image.id);
                              else next.add(image.id);
                              return next;
                            });
                          } else {
                            // Regular click: exclusive select or deselect
                            setSelectedBankImages(prev =>
                              prev.size === 1 && prev.has(image.id)
                                ? new Set() : new Set([image.id])
                            );
                          }
                        }}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify({
                            ...image,
                            url: image.url || image.localUrl,
                            thumbnail: image.url || image.localUrl,
                            sourceBank: selectedSource === 'bankA' ? 'imageA'
                              : selectedSource === 'bankB' ? 'imageB'
                              : selectedSource.includes(':bankA') ? 'imageA'
                              : selectedSource.includes(':bankB') ? 'imageB'
                              : selectedSource
                          }));
                        }}
                        onMouseEnter={(e) => {
                          if (!isSel) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSel) e.currentTarget.style.backgroundColor = '';
                        }}
                      >
                        {/* Selection overlay — subtle tint + checkmark */}
                        {isSel && (
                          <div style={{
                            position: 'absolute', inset: 0,
                            backgroundColor: 'rgba(99, 102, 241, 0.2)',
                            zIndex: 1, pointerEvents: 'none', borderRadius: '6px'
                          }}>
                            <div style={{
                              position: 'absolute', bottom: 3, right: 3, width: '16px', height: '16px',
                              backgroundColor: '#6366f1', borderRadius: '50%', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', fontWeight: 'bold'
                            }}>✓</div>
                          </div>
                        )}
                        <img
                          src={image.thumbnailUrl || image.url || image.localUrl}
                          alt={image.name}
                          style={styles.clipThumbnail}
                          loading="lazy"
                        />
                        <span style={styles.clipName}>{image.name?.slice(0, 15) || 'Untitled'}</span>
                      </div>
                      );
                    })}
                  </div>
                  {/* Import button at bottom of image grid */}
                  {onImportToBank && (activeBank === 'imageA' || activeBank === 'imageB') && (
                    <button
                      style={{
                        marginTop: '8px', padding: '6px 12px', borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)',
                        color: '#9ca3af', fontSize: '11px', cursor: 'pointer', width: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                      }}
                      onClick={() => (activeBank === 'imageA' ? importImageARef : importImageBRef).current?.click()}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      Import More Images
                    </button>
                  )}
                  </>
                );
              })()}
            </div>
          </div>
          )}

          {/* Right Panel - Canvas, Filmstrip & Timeline Switcher */}
          {(!isMobile || mobilePanelTab === 'preview') && (
          <div style={{
            ...styles.rightPanel,
            ...(isMobile ? {
              width: '100%',
              flex: 1
            } : {})
          }}>

            {/* Canvas Preview */}
            <div
              style={{
                ...styles.canvasContainer,
                ...(isMobile ? {
                  padding: '16px'
                } : {})
              }}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div
                ref={previewRef}
                style={{
                  ...styles.canvas,
                  width: isMobile ? Math.min(window.innerWidth - 32, previewDimensions.width) : previewDimensions.width,
                  height: isMobile ? Math.min((window.innerWidth - 32) * (baseDimensions.height / baseDimensions.width), previewDimensions.height) : previewDimensions.height,
                  aspectRatio: '9/16'
                }}
              >
                {/* Background Image - Draggable and resizable */}
                {currentSlide?.backgroundImage ? (
                  <>
                    <img
                      src={currentSlide.backgroundImage}
                      alt="Slide background"
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transform: `scale(${(currentSlide.imageTransform?.scale || 1)}) translate(${(currentSlide.imageTransform?.offsetX || 0)}px, ${(currentSlide.imageTransform?.offsetY || 0)}px)`,
                        transformOrigin: 'center center',
                        cursor: isDraggingImage ? 'grabbing' : 'grab',
                        userSelect: 'none',
                        pointerEvents: 'auto',
                        zIndex: 1
                      }}
                      onMouseDown={handleImageMouseDown}
                      draggable={false}
                    />
                    {/* Resize handle - bottom right corner */}
                    <div
                      onMouseDown={handleResizeMouseDown}
                      style={{
                        position: 'absolute',
                        bottom: 4,
                        right: 4,
                        width: 20,
                        height: 20,
                        cursor: 'nwse-resize',
                        zIndex: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 4,
                        backgroundColor: 'rgba(99, 102, 241, 0.8)',
                        border: '1px solid rgba(255,255,255,0.5)'
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
                        <path d="M9 1v8H1" fill="none" stroke="white" strokeWidth="1.5"/>
                        <path d="M6 4v5H1" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5"/>
                      </svg>
                    </div>
                  </>
                ) : (
                  <div style={styles.canvasPlaceholder}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <path d="M21 15l-5-5L5 21"/>
                    </svg>
                    <p>Drag an image here</p>
                  </div>
                )}

                {/* 4:3 Crop Indicator - shows what area will be exported */}
                {aspectRatio === '4:3' && (
                  <>
                    {/* Top crop overlay */}
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 'calc((100% - (100% * 0.75)) / 2)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderBottom: '2px dashed rgba(255, 255, 255, 0.4)',
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 8
                    }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cropped</span>
                    </div>
                    {/* Bottom crop overlay */}
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 'calc((100% - (100% * 0.75)) / 2)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderTop: '2px dashed rgba(255, 255, 255, 0.4)',
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 8
                    }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cropped</span>
                    </div>
                  </>
                )}

                {/* Text Overlays */}
                {(currentSlide?.textOverlays || []).map(overlay => (
                  <div
                    key={overlay.id}
                    style={{
                      ...styles.textOverlay,
                      left: `${overlay.position.x}%`,
                      top: `${overlay.position.y}%`,
                      transform: 'translate(-50%, -50%)',
                      fontSize: `${overlay.style.fontSize * previewScale}px`,
                      fontFamily: overlay.style.fontFamily,
                      fontWeight: overlay.style.fontWeight,
                      color: overlay.style.color,
                      textAlign: overlay.style.textAlign,
                      textShadow: overlay.style.outline
                        ? `0 0 ${4 * previewScale}px ${overlay.style.outlineColor}`
                        : 'none',
                      cursor: 'pointer',
                      border: editingTextId === overlay.id ? '1px dashed #6366f1' : 'none',
                      padding: '4px 8px'
                    }}
                    onClick={(e) => handleTextClick(e, overlay.id)}
                  >
                    {overlay.text}
                  </div>
                ))}
              </div>

              {/* Hidden audio element */}
              <audio ref={audioRef} style={{ display: 'none' }} crossOrigin="anonymous" />

              {/* Audio Player Controls */}
              {selectedAudio && (
                <div style={styles.audioPlayerBar}>
                  <button
                    style={styles.playPauseBtn}
                    onClick={handlePlayPause}
                  >
                    {isPlaying ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1"/>
                        <rect x="14" y="4" width="4" height="16" rx="1"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21"/>
                      </svg>
                    )}
                  </button>
                  <div style={styles.audioPlayerInfo}>
                    <span style={styles.audioPlayerName}>{selectedAudio.name}</span>
                    <span style={styles.audioPlayerTime}>
                      {formatTime(currentTime)} / {formatTime(audioDuration)}
                    </span>
                  </div>
                  <div style={styles.audioProgressBar}>
                    <div
                      style={{
                        ...styles.audioProgressFill,
                        width: `${audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0}%`
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Hidden file inputs for importing to banks */}
              <input
                ref={importImageARef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleImportImages(e, 'A')}
                style={{ display: 'none' }}
              />
              <input
                ref={importImageBRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleImportImages(e, 'B')}
                style={{ display: 'none' }}
              />

              {/* Hidden audio input for slideshow */}
              <input
                ref={slideshowAudioInputRef}
                type="file"
                accept=".mp3,audio/mpeg"
                onChange={handleSlideshowAudioUpload}
                style={{ display: 'none' }}
              />

              {/* Canvas Actions */}
              <div style={styles.canvasActions}>
                {/* Undo / Redo */}
                <button
                  style={{ ...styles.rerollButton, opacity: canUndo ? 1 : 0.35, pointerEvents: canUndo ? 'auto' : 'none' }}
                  onClick={handleUndo}
                  title="Undo (⌘Z)"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H3"/>
                    <path d="M7 6l-4 4 4 4"/>
                  </svg>
                  Undo
                </button>
                <button
                  style={{ ...styles.rerollButton, opacity: canRedo ? 1 : 0.35, pointerEvents: canRedo ? 'auto' : 'none' }}
                  onClick={handleRedo}
                  title="Redo (⌘⇧Z)"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10H11a5 5 0 00-5 5v0a5 5 0 005 5h10"/>
                    <path d="M17 6l4 4-4 4"/>
                  </svg>
                  Redo
                </button>

                {/* Re-roll Button (only show when slide has an image) */}
                {currentSlide?.backgroundImage && (
                  <button
                    style={styles.rerollButton}
                    onClick={handleReroll}
                    title="Replace with random image from same bank"
                    disabled={getRerollBank().filter(img => img.id !== currentSlide?.sourceImageId).length === 0}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 4v6h-6"/>
                      <path d="M1 20v-6h6"/>
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/>
                      <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/>
                    </svg>
                    Reroll
                  </button>
                )}

                {/* Re-roll Text Button (only show when slide has text overlays) */}
                {currentSlide?.textOverlays?.length > 0 && (() => {
                  const { textBank1, textBank2 } = getTextBanks();
                  const hasTextBanks = textBank1.length > 0 || textBank2.length > 0;
                  return hasTextBanks ? (
                    <button
                      style={styles.rerollButton}
                      onClick={() => handleTextReroll()}
                      title="Replace text with random text from banks"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 7V4h16v3M9 20h6M12 4v16"/>
                      </svg>
                      Reroll Text
                    </button>
                  ) : null;
                })()}

                {/* Add Text Button */}
                <button style={styles.addTextButton} onClick={() => { addTextOverlay(); setShowTextEditorPanel(true); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Add Text
                </button>

                {/* Delete Slide Button */}
                {slides.length > 1 && (
                  <button
                    onClick={() => removeSlide(slides[selectedSlideIndex]?.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#f87171',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '500',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'; }}
                    title="Delete current slide (Delete key)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                    Delete Slide
                  </button>
                )}

                {/* Add Audio Button with Dropdown */}
                <div style={{ position: 'relative' }}>
                  <button
                    style={styles.addAudioButton}
                    onClick={() => setShowAudioPicker(!showAudioPicker)}
                    title="Add audio to slideshow"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18V5l12-2v13"/>
                      <circle cx="6" cy="18" r="3"/>
                      <circle cx="18" cy="16" r="3"/>
                    </svg>
                    Add Audio
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px' }}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>

                  {/* Audio Picker Dropdown */}
                  {showAudioPicker && (
                    <div style={styles.audioPickerDropdown}>
                      <div style={styles.audioPickerHeader}>Select Audio</div>

                      {/* Existing audio from bank */}
                      {audioTracks.length > 0 ? (
                        <div style={styles.audioPickerList}>
                          {audioTracks.map(audio => (
                            <button
                              key={audio.id}
                              style={styles.audioPickerItem}
                              onClick={() => {
                                setAudioToTrim(audio);
                                setShowAudioTrimmer(true);
                                setShowAudioPicker(false);
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 18V5l12-2v13"/>
                                <circle cx="6" cy="18" r="3"/>
                                <circle cx="18" cy="16" r="3"/>
                              </svg>
                              <span style={styles.audioPickerItemName}>{audio.name}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div style={styles.audioPickerEmpty}>No audio in bank</div>
                      )}

                      {/* Divider */}
                      <div style={styles.audioPickerDivider} />

                      {/* Upload new option */}
                      <button
                        style={styles.audioPickerUpload}
                        onClick={() => {
                          slideshowAudioInputRef.current?.click();
                          setShowAudioPicker(false);
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        Upload New Audio
                      </button>
                    </div>
                  )}
                </div>

                {/* AI Transcribe Button */}
                {selectedAudio && (
                  <button
                    style={styles.aiTranscribeButton}
                    onClick={() => setShowLyricAnalyzer(true)}
                    title="AI transcribe audio to add lyrics"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                      <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                    AI Transcribe
                  </button>
                )}

                {/* Lyric Bank Button with Dropdown */}
                {onAddLyrics && (
                  <div style={{ position: 'relative' }} data-lyric-bank-picker>
                    <button
                      style={styles.addToLyricBankButton}
                      onClick={() => setShowLyricBankPicker(!showLyricBankPicker)}
                      title="Add lyrics to your bank"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <path d="M14 2v6h6"/>
                      </svg>
                      + Lyric Bank
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px', transform: showLyricBankPicker ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>

                    {/* Lyric Bank Dropdown Picker */}
                    {showLyricBankPicker && (
                      <div style={styles.lyricBankDropdown}>
                        <div style={styles.lyricBankDropdownHeader}>SELECT LYRICS</div>
                        <div style={styles.lyricBankDropdownList}>
                          {lyrics.length === 0 ? (
                            <div style={styles.lyricBankDropdownEmpty}>
                              No lyrics in bank yet
                            </div>
                          ) : (
                            lyrics.map((lyric) => (
                              <div
                                key={lyric.id}
                                style={styles.lyricBankDropdownItem}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Add lyric as text overlay to current slide
                                  if (currentSlide) {
                                    const newOverlay = {
                                      id: `text_${Date.now()}`,
                                      text: lyric.content,
                                      style: getDefaultTextStyle(),
                                      position: { x: 50, y: 50, width: 80, height: 20 }
                                    };
                                    setSlides(prev => prev.map((slide, i) =>
                                      i === selectedSlideIndex
                                        ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
                                        : slide
                                    ));
                                    setEditingTextId(newOverlay.id);
                                    setShowTextEditorPanel(true);
                                  }
                                  setShowLyricBankPicker(false);
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.3)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.6, pointerEvents: 'none' }}>
                                  <path d="M9 18V5l12-2v13"/>
                                  <circle cx="6" cy="18" r="3"/>
                                  <circle cx="18" cy="16" r="3"/>
                                </svg>
                                <span style={{ pointerEvents: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {lyric.title || lyric.content?.slice(0, 30) || 'Untitled'}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                        <div
                          style={styles.lyricBankDropdownAddNew}
                          onClick={(e) => {
                            e.stopPropagation();
                            const text = prompt('Enter lyrics to add to bank:');
                            if (text?.trim()) {
                              onAddLyrics({
                                title: text.split('\n')[0].slice(0, 30) || 'New Lyrics',
                                content: text.trim()
                              });
                            }
                            setShowLyricBankPicker(false);
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ pointerEvents: 'none' }}>
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                          <span style={{ pointerEvents: 'none' }}>Add New Lyrics</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Flowstage-style Text Editor Side Panel */}
            {showTextEditorPanel && currentSlide && (
              <TextEditorPanel
                slide={currentSlide}
                editingTextId={editingTextId}
                lyrics={lyrics}
                templates={textTemplates}
                textBank1={getTextBanks().textBank1}
                textBank2={getTextBanks().textBank2}
                onSelectText={(text) => {
                  // Add selected lyrics as text overlay using template style if set
                  const newOverlay = {
                    id: `text_${Date.now()}`,
                    text: text,
                    style: getDefaultTextStyle(),
                    position: { x: 50, y: 50, width: 80, height: 20 }
                  };
                  setSlides(prev => prev.map((slide, i) =>
                    i === selectedSlideIndex
                      ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
                      : slide
                  ));
                  setEditingTextId(newOverlay.id);
                }}
                onAddTextOverlay={() => {
                  addTextOverlay();
                }}
                onSelectOverlay={(overlayId) => setEditingTextId(overlayId)}
                onUpdateOverlay={(overlayId, updates) => updateTextOverlay(overlayId, updates)}
                onRemoveOverlay={(overlayId) => removeTextOverlay(overlayId)}
                onRerollText={(overlayId, bankSource) => handleTextReroll(overlayId, bankSource)}
                onAddLyrics={onAddLyrics}
                onSaveTemplate={handleSaveTemplate}
                onClose={() => {
                  setShowTextEditorPanel(false);
                  setEditingTextId(null);
                }}
              />
            )}

            {/* Slide Filmstrip — drop zone for bank images */}
            <div style={styles.filmstrip}>
              <div
                style={styles.filmstripScroll}
                onDragOver={handleFilmstripDragOver}
                onDragLeave={handleFilmstripDragLeave}
                onDrop={handleFilmstripDrop}
              >
                {slides.map((slide, index) => (
                  <React.Fragment key={slide.id}>
                    {/* Drop indicator before this slide */}
                    {filmstripDropIndex === index && (
                      <div style={styles.filmstripDropIndicator} />
                    )}
                    <div
                      data-filmstrip-slide="true"
                      style={{
                        ...styles.filmstripSlide,
                        ...(index === selectedSlideIndex ? styles.filmstripSlideActive : {})
                      }}
                      onClick={() => setSelectedSlideIndex(index)}
                    >
                      {slide.backgroundImage ? (
                        <img
                          src={slide.thumbnail || slide.backgroundImage}
                          alt={`Slide ${index + 1}`}
                          style={styles.filmstripThumbnail}
                        />
                      ) : (
                        <div style={styles.filmstripEmpty}>
                          <span>{index + 1}</span>
                        </div>
                      )}
                      {slides.length > 1 && (
                      <button
                        style={{
                          ...styles.removeSlideButton,
                          position: 'absolute',
                          top: '2px',
                          right: '2px',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'rgba(239, 68, 68, 0.8)',
                          border: 'none',
                          color: '#fff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          zIndex: 2,
                          opacity: 1,
                          transition: 'background 0.15s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 1)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.8)'}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSlide(slide.id);
                        }}
                        title="Remove slide"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                      )}
                    </div>
                  </React.Fragment>
                ))}

                {/* Drop indicator after last slide */}
                {filmstripDropIndex === slides.length && (
                  <div style={styles.filmstripDropIndicator} />
                )}

                {/* Add Slide Button */}
                <button style={styles.addSlideButton} onClick={addSlide}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
              </div>

              <div style={styles.slideCount}>
                {slides.length} / 10 slides
              </div>
            </div>

            {/* ─── Timeline Switcher ─── */}
            <div style={{
              borderTop: '1px solid rgba(255,255,255,0.08)',
              padding: '12px 16px',
              backgroundColor: 'rgba(0,0,0,0.15)',
              flexShrink: 0
            }}>
              {/* Scrollable row of timeline tabs */}
              <div style={{
                display: 'flex',
                gap: '8px',
                overflowX: 'auto',
                paddingBottom: '8px',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.15) transparent'
              }}>
                {allSlideshows.map((show, idx) => (
                  <div
                    key={show.id}
                    onClick={() => switchToSlideshow(idx)}
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      backgroundColor: idx === activeSlideshowIndex ? '#6366f1' : 'rgba(255,255,255,0.06)',
                      border: '1px solid ' + (idx === activeSlideshowIndex ? '#818cf8' : 'rgba(255,255,255,0.08)'),
                      color: idx === activeSlideshowIndex ? '#fff' : '#9ca3af',
                      fontSize: '12px',
                      fontWeight: idx === activeSlideshowIndex ? '600' : '400',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {show.isTemplate ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="3" y1="9" x2="21" y2="9"/>
                        <line x1="9" y1="21" x2="9" y2="9"/>
                      </svg>
                    ) : (
                      <span style={{ fontSize: '10px', opacity: 0.6 }}>#{idx}</span>
                    )}
                    <span>{show.isTemplate ? 'Template' : show.name || `Slideshow ${idx}`}</span>
                    {!show.isTemplate && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSlideshow(idx);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: idx === activeSlideshowIndex ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)',
                          cursor: 'pointer',
                          padding: '0 0 0 4px',
                          fontSize: '14px',
                          lineHeight: 1,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                        title="Delete this slideshow"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Generate controls row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginTop: '8px'
              }}>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  style={{
                    width: '60px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontSize: '13px',
                    textAlign: 'center',
                    outline: 'none'
                  }}
                />
                <button
                  onClick={handleGenerateMore}
                  disabled={isGenerating}
                  style={{
                    flex: 1,
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isGenerating ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.2s'
                  }}
                >
                  {isGenerating ? (
                    <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Generating...</>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      Generate {generateCount} More
                    </>
                  )}
                </button>
                {allSlideshows.length > 1 && (
                  <span style={{ fontSize: '11px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {allSlideshows.length} total
                  </span>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Mobile Text Panel */}
          {isMobile && mobilePanelTab === 'text' && currentSlide && (
            <div style={{
              flex: 1,
              backgroundColor: '#16162a',
              overflow: 'auto',
              WebkitOverflowScrolling: 'touch',
              padding: '16px'
            }}>
              <TextEditorPanel
                slide={currentSlide}
                editingTextId={editingTextId}
                lyrics={lyrics}
                templates={textTemplates}
                textBank1={getTextBanks().textBank1}
                textBank2={getTextBanks().textBank2}
                onSelectText={(text) => {
                  const newOverlay = {
                    id: `text_${Date.now()}`,
                    text: text,
                    style: {
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 48,
                      fontWeight: '600',
                      color: '#ffffff',
                      textAlign: 'center',
                      outline: true,
                      outlineColor: '#000000'
                    },
                    position: { x: 50, y: 50, width: 80, height: 20 }
                  };
                  setSlides(prev => prev.map((slide, i) =>
                    i === selectedSlideIndex
                      ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
                      : slide
                  ));
                  setEditingTextId(newOverlay.id);
                  setMobilePanelTab('preview');
                }}
                onAddTextOverlay={() => {
                  const newOverlay = {
                    id: `text_${Date.now()}`,
                    text: 'New Text',
                    style: {
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 48,
                      fontWeight: '600',
                      color: '#ffffff',
                      textAlign: 'center',
                      outline: true,
                      outlineColor: '#000000'
                    },
                    position: { x: 50, y: 50, width: 80, height: 20 }
                  };
                  setSlides(prev => prev.map((slide, i) =>
                    i === selectedSlideIndex
                      ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
                      : slide
                  ));
                  setEditingTextId(newOverlay.id);
                }}
                onSelectOverlay={(overlayId) => setEditingTextId(overlayId)}
                onUpdateOverlay={(overlayId, updates) => {
                  setSlides(prev => prev.map((slide, idx) =>
                    idx === selectedSlideIndex
                      ? {
                          ...slide,
                          textOverlays: slide.textOverlays.map(overlay =>
                            overlay.id === overlayId ? { ...overlay, ...updates } : overlay
                          )
                        }
                      : slide
                  ));
                }}
                onRemoveOverlay={(overlayId) => {
                  setSlides(prev => prev.map((slide, idx) =>
                    idx === selectedSlideIndex
                      ? {
                          ...slide,
                          textOverlays: slide.textOverlays.filter(o => o.id !== overlayId)
                        }
                      : slide
                  ));
                  setEditingTextId(null);
                }}
                onRerollText={(overlayId, bankSource) => handleTextReroll(overlayId, bankSource)}
                onAddLyrics={onAddLyrics}
                onSaveTemplate={handleSaveTemplate}
                onClose={() => setMobilePanelTab('preview')}
                isMobile={true}
              />
            </div>
          )}
        </div>

        {/* Schedule Panel (shown after export) */}
        {showSchedulePanel && (
          <div style={styles.schedulePanel}>
            <div style={styles.schedulePanelHeader}>
              <h3 style={styles.schedulePanelTitle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Schedule Carousel
              </h3>
              <button
                style={styles.scheduleCloseBtn}
                onClick={() => setShowSchedulePanel(false)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div style={styles.scheduleGrid}>
              {/* Account Selection */}
              <div style={styles.scheduleField}>
                <label style={styles.scheduleLabel}>Account</label>
                <select
                  value={selectedHandle}
                  onChange={(e) => setSelectedHandle(e.target.value)}
                  style={styles.scheduleSelect}
                >
                  <option value="">Select account...</option>
                  {availableHandles.map(handle => (
                    <option key={handle} value={handle}>{handle}</option>
                  ))}
                </select>
              </div>

              {/* Date & Time */}
              <div style={styles.scheduleField}>
                <label style={styles.scheduleLabel}>Date</label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  style={styles.scheduleDateInput}
                />
              </div>

              <div style={styles.scheduleField}>
                <label style={styles.scheduleLabel}>Time</label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  style={styles.scheduleDateInput}
                />
              </div>

              {/* Platforms */}
              <div style={styles.scheduleField}>
                <label style={styles.scheduleLabel}>Platforms</label>
                <div style={styles.platformCheckboxes}>
                  <label style={styles.platformCheck}>
                    <input
                      type="checkbox"
                      checked={platforms.tiktok}
                      onChange={(e) => setPlatforms(p => ({ ...p, tiktok: e.target.checked }))}
                    />
                    TikTok
                  </label>
                  <label style={styles.platformCheck}>
                    <input
                      type="checkbox"
                      checked={platforms.instagram}
                      onChange={(e) => setPlatforms(p => ({ ...p, instagram: e.target.checked }))}
                    />
                    Instagram
                  </label>
                </div>
              </div>
            </div>

            {/* Caption */}
            <div style={styles.scheduleField}>
              <label style={styles.scheduleLabel}>Caption</label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                style={styles.scheduleCaptionInput}
                placeholder="Write a caption..."
                rows={2}
              />
            </div>

            {/* Hashtags */}
            <div style={styles.scheduleField}>
              <label style={styles.scheduleLabel}>Hashtags</label>
              <input
                type="text"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                style={styles.scheduleHashtagInput}
                placeholder="#hashtag1 #hashtag2..."
              />
            </div>

            {/* Preview */}
            <div style={styles.schedulePreview}>
              <span style={styles.schedulePreviewLabel}>
                {exportedImages.length} images ready to post
              </span>
              <div style={styles.schedulePreviewImages}>
                {exportedImages.slice(0, 5).map((img, i) => (
                  <img
                    key={i}
                    src={img.url}
                    alt={`Slide ${i + 1}`}
                    style={styles.schedulePreviewImg}
                  />
                ))}
                {exportedImages.length > 5 && (
                  <div style={styles.schedulePreviewMore}>
                    +{exportedImages.length - 5}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={styles.scheduleActions}>
              <button
                style={styles.scheduleSkipBtn}
                onClick={() => {
                  setShowSchedulePanel(false);
                  toastSuccess(`Exported ${exportedImages.length} images! You can schedule them later.`);
                }}
              >
                Skip for now
              </button>
              <button
                style={styles.scheduleSubmitBtn}
                onClick={handleSchedule}
                disabled={isScheduling || !selectedHandle}
              >
                {isScheduling ? 'Scheduling...' : 'Schedule Post'}
              </button>
            </div>
          </div>
        )}

        {/* AI Lyric Analyzer Modal */}
        {showLyricAnalyzer && selectedAudio && (
          <LyricAnalyzer
            audioFile={selectedAudio.file}
            audioUrl={selectedAudio.url || selectedAudio.localUrl}
            startTime={selectedAudio.startTime}
            endTime={selectedAudio.endTime}
            onComplete={handleTranscriptionComplete}
            onClose={() => setShowLyricAnalyzer(false)}
          />
        )}

        {/* Save to Lyric Bank Prompt - Premium Card Design */}
        {showSaveToBankPrompt && transcribedLyrics && (
          <div style={styles.saveToBankOverlay}>
            <div style={styles.saveToBankModal}>
              {/* Close button */}
              <button
                style={styles.saveToBankCloseBtn}
                onClick={() => {
                  setShowSaveToBankPrompt(false);
                  setTranscribedLyrics(null);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>

              {/* Success Icon with Glow */}
              <div style={styles.saveToBankIconWrapper}>
                <div style={styles.saveToBankIconGlow} />
                <div style={styles.saveToBankIcon}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                    <path d="M9 12l2 2 4-4"/>
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                </div>
              </div>

              {/* Title & Subtitle */}
              <h3 style={styles.saveToBankTitle}>Lyrics Ready!</h3>
              <p style={styles.saveToBankSubtitle}>
                We've transcribed your audio. Save to your Lyric Bank for easy access.
              </p>

              {/* Lyrics Preview Card */}
              <div style={styles.saveToBankPreviewCard}>
                <div style={styles.saveToBankPreviewHeader}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6"/>
                  </svg>
                  <span style={styles.saveToBankPreviewLabel}>Preview</span>
                </div>
                <div style={styles.saveToBankPreviewContent}>
                  {transcribedLyrics.split('\n').slice(0, 4).map((line, i) => (
                    <div key={i} style={styles.saveToBankLyricLine}>
                      {line || '\u00A0'}
                    </div>
                  ))}
                  {transcribedLyrics.split('\n').length > 4 && (
                    <div style={styles.saveToBankMoreLines}>
                      +{transcribedLyrics.split('\n').length - 4} more lines
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={styles.saveToBankActions}>
                <button
                  style={styles.saveToBankSkipBtn}
                  onClick={() => {
                    setShowSaveToBankPrompt(false);
                    setTranscribedLyrics(null);
                  }}
                >
                  Not Now
                </button>
                <button
                  style={styles.saveToBankSaveBtn}
                  onClick={handleSaveToLyricBank}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Save to Bank
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Audio Trimmer Modal */}
        {showAudioTrimmer && audioToTrim && (
          <AudioClipSelector
            audioFile={audioToTrim.file}
            audioUrl={audioToTrim.url || audioToTrim.localUrl}
            audioName={audioToTrim.name}
            initialStart={audioToTrim.startTime || 0}
            initialEnd={audioToTrim.endTime || null}
            onSave={handleAudioTrimSave}
            onCancel={() => {
              setShowAudioTrimmer(false);
              setAudioToTrim(null);
            }}
          />
        )}

        {/* Audio Prompt — first generation without audio */}
        {showAudioPrompt && (
          <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 10002
          }}>
            <div style={{
              backgroundColor: '#1a1a2e', borderRadius: '16px', padding: '28px',
              maxWidth: '380px', width: '90%', textAlign: 'center',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)'
            }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(251,146,60,0.2), rgba(251,146,60,0.1))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2">
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
              </div>
              <h3 style={{ margin: '0 0 8px', color: '#fff', fontSize: '16px', fontWeight: '600' }}>
                Add audio first?
              </h3>
              <p style={{ margin: '0 0 20px', color: '#9ca3af', fontSize: '13px', lineHeight: '1.5' }}>
                Your template doesn't have audio yet. All generated slideshows will inherit the template's audio.
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => {
                    setShowAudioPrompt(false);
                    executeGeneration();
                  }}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                    color: '#9ca3af', fontSize: '13px', cursor: 'pointer'
                  }}
                >
                  Skip, Generate Anyway
                </button>
                <button
                  onClick={() => {
                    setShowAudioPrompt(false);
                    setShowAudioPicker(true);
                  }}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                    background: 'linear-gradient(135deg, #fb923c, #f97316)',
                    color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  Add Audio
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

/**
 * TextEditorPanel - Flowstage-style side panel for text editing
 * Shows all text overlays on slide, allows editing, and pulling from lyric bank
 */
// Available fonts for text overlays
const AVAILABLE_FONTS = [
  { name: 'Inter', value: "'Inter', sans-serif" },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Times New Roman', value: "'Times New Roman', serif" },
  { name: 'Courier New', value: "'Courier New', monospace" },
  { name: 'Impact', value: 'Impact, sans-serif' },
  { name: 'Comic Sans', value: "'Comic Sans MS', cursive" },
  { name: 'Trebuchet', value: "'Trebuchet MS', sans-serif" },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
  { name: 'Palatino', value: "'Palatino Linotype', serif" }
];

const TextEditorPanel = ({
  slide,
  editingTextId,
  lyrics = [],
  templates = [],
  textBank1 = [],
  textBank2 = [],
  onSelectText,
  onAddTextOverlay,
  onSelectOverlay,
  onUpdateOverlay,
  onRemoveOverlay,
  onRerollText,
  onAddLyrics,
  onSaveTemplate,
  onClose,
  isMobile = false
}) => {
  const [showLyricPicker, setShowLyricPicker] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const textOverlays = slide?.textOverlays || [];
  const selectedOverlay = textOverlays.find(o => o.id === editingTextId);

  return (
    <div style={{
      ...textPanelStyles.panel,
      ...(isMobile ? { width: '100%', position: 'relative', borderLeft: 'none' } : {})
    }}>
      {/* Panel Header */}
      <div style={textPanelStyles.header}>
        <h3 style={textPanelStyles.title}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V4h16v3M9 20h6M12 4v16"/>
          </svg>
          Text Editor
        </h3>
        <button style={textPanelStyles.closeBtn} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Text Blocks List */}
      <div style={textPanelStyles.textList}>
        <div style={textPanelStyles.sectionHeader}>
          <span>Text Blocks ({textOverlays.length})</span>
          <button style={textPanelStyles.addBtn} onClick={onAddTextOverlay}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>

        {textOverlays.length === 0 ? (
          <div style={textPanelStyles.emptyText}>
            <p>No text on this slide</p>
            <button style={textPanelStyles.addTextBtn} onClick={onAddTextOverlay}>
              + Add Text
            </button>
          </div>
        ) : (
          textOverlays.map((overlay, idx) => {
            const bank = idx === 0 ? textBank1 : idx === 1 ? textBank2 : [...textBank1, ...textBank2];
            const canReroll = bank.length > 0;
            return (
            <div
              key={overlay.id}
              style={{
                ...textPanelStyles.textBlock,
                ...(editingTextId === overlay.id ? textPanelStyles.textBlockActive : {})
              }}
              onClick={() => onSelectOverlay(overlay.id)}
            >
              <div style={textPanelStyles.textPreview}>
                {overlay.text.slice(0, 50)}{overlay.text.length > 50 ? '...' : ''}
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                {canReroll && (
                  <button
                    style={textPanelStyles.deleteBlockBtn}
                    onClick={(e) => { e.stopPropagation(); onRerollText(overlay.id); }}
                    title={`Reroll from Text Bank ${idx === 0 ? '1' : idx === 1 ? '2' : ''} (${bank.length} items)`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/>
                      <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/>
                    </svg>
                  </button>
                )}
                <button
                  style={textPanelStyles.deleteBlockBtn}
                  onClick={(e) => { e.stopPropagation(); onRemoveOverlay(overlay.id); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
                  </svg>
                </button>
              </div>
            </div>
            );
          })
        )}
      </div>

      {/* Selected Text Editor */}
      {selectedOverlay && (
        <div style={textPanelStyles.editor}>
          <div style={textPanelStyles.sectionHeader}>Edit Text</div>

          <textarea
            value={selectedOverlay.text}
            onChange={(e) => onUpdateOverlay(selectedOverlay.id, { text: e.target.value })}
            style={textPanelStyles.textarea}
            placeholder="Enter text..."
            rows={4}
          />

          {/* Reroll from Text Banks */}
          {(textBank1.length > 0 || textBank2.length > 0) && (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              {textBank1.length > 0 && (
                <button
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '6px 8px', border: '1px solid rgba(139, 92, 246, 0.3)',
                    borderRadius: '6px', backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    color: '#c4b5fd', cursor: 'pointer', fontSize: '11px',
                    transition: 'all 0.15s'
                  }}
                  onClick={() => onRerollText(selectedOverlay.id, 1)}
                  title={`Pick random text from Text Bank 1 (${textBank1.length} items)`}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(139, 92, 246, 0.2)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(139, 92, 246, 0.1)'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/>
                    <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/>
                  </svg>
                  Bank 1 ({textBank1.length})
                </button>
              )}
              {textBank2.length > 0 && (
                <button
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '6px 8px', border: '1px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: '6px', backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    color: '#a5b4fc', cursor: 'pointer', fontSize: '11px',
                    transition: 'all 0.15s'
                  }}
                  onClick={() => onRerollText(selectedOverlay.id, 2)}
                  title={`Pick random text from Text Bank 2 (${textBank2.length} items)`}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.2)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.1)'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/>
                    <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/>
                  </svg>
                  Bank 2 ({textBank2.length})
                </button>
              )}
            </div>
          )}

          {/* Font Size */}
          <div style={textPanelStyles.control}>
            <div style={textPanelStyles.controlHeader}>
              <span>Size</span>
              <span style={textPanelStyles.controlValue}>{selectedOverlay.style.fontSize}px</span>
            </div>
            <div style={textPanelStyles.sizeButtons}>
              <button
                style={textPanelStyles.sizeBtn}
                onClick={() => onUpdateOverlay(selectedOverlay.id, {
                  style: { ...selectedOverlay.style, fontSize: Math.max(12, selectedOverlay.style.fontSize - 4) }
                })}
              >A-</button>
              <button
                style={textPanelStyles.sizeBtn}
                onClick={() => onUpdateOverlay(selectedOverlay.id, {
                  style: { ...selectedOverlay.style, fontSize: Math.min(120, selectedOverlay.style.fontSize + 4) }
                })}
              >A+</button>
            </div>
          </div>

          {/* Font Family */}
          <div style={textPanelStyles.control}>
            <span>Font</span>
            <select
              value={selectedOverlay.style.fontFamily}
              onChange={(e) => onUpdateOverlay(selectedOverlay.id, {
                style: { ...selectedOverlay.style, fontFamily: e.target.value }
              })}
              style={textPanelStyles.fontSelect}
            >
              {AVAILABLE_FONTS.map(font => (
                <option key={font.name} value={font.value} style={{ fontFamily: font.value }}>
                  {font.name}
                </option>
              ))}
            </select>
          </div>

          {/* Alignment */}
          <div style={textPanelStyles.control}>
            <span>Align</span>
            <div style={textPanelStyles.alignButtons}>
              {['left', 'center', 'right'].map(align => (
                <button
                  key={align}
                  style={{
                    ...textPanelStyles.alignBtn,
                    ...(selectedOverlay.style.textAlign === align ? textPanelStyles.alignBtnActive : {})
                  }}
                  onClick={() => onUpdateOverlay(selectedOverlay.id, {
                    style: { ...selectedOverlay.style, textAlign: align }
                  })}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {align === 'left' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></>}
                    {align === 'center' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></>}
                    {align === 'right' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></>}
                  </svg>
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div style={textPanelStyles.control}>
            <span>Color</span>
            <input
              type="color"
              value={selectedOverlay.style.color}
              onChange={(e) => onUpdateOverlay(selectedOverlay.id, {
                style: { ...selectedOverlay.style, color: e.target.value }
              })}
              style={textPanelStyles.colorPicker}
            />
          </div>

          {/* Template Actions */}
          <div style={textPanelStyles.templateActions}>
            {/* Save as Template */}
            <button
              style={textPanelStyles.saveTemplateBtn}
              onClick={() => {
                const name = prompt('Enter template name:');
                if (name?.trim() && onSaveTemplate) {
                  onSaveTemplate({
                    id: `template_${Date.now()}`,
                    name: name.trim(),
                    style: { ...selectedOverlay.style }
                  });
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                <polyline points="17,21 17,13 7,13 7,21"/>
                <polyline points="7,3 7,8 15,8"/>
              </svg>
              Save as Template
            </button>

            {/* Apply Template dropdown */}
            {templates.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  style={textPanelStyles.applyTemplateBtn}
                  onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="9" y1="21" x2="9" y2="9"/>
                  </svg>
                  Apply Template
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {showTemplatePicker && (
                  <div style={textPanelStyles.templateDropdown}>
                    {templates.map(template => (
                      <button
                        key={template.id}
                        style={textPanelStyles.templateItem}
                        onClick={() => {
                          onUpdateOverlay(selectedOverlay.id, { style: { ...template.style } });
                          setShowTemplatePicker(false);
                        }}
                      >
                        {template.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save to Lyric Bank */}
          {onAddLyrics && selectedOverlay.text.trim() && (
            <button
              style={textPanelStyles.saveToLyricBankBtn}
              onClick={() => {
                onAddLyrics({
                  id: `lyric_${Date.now()}`,
                  title: selectedOverlay.text.split('\n')[0].slice(0, 30) || 'Saved Lyrics',
                  content: selectedOverlay.text.trim(),
                  createdAt: new Date().toISOString()
                });
                toastSuccess('Saved to Lyric Bank!');
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6"/>
                <line x1="12" y1="11" x2="12" y2="17"/>
                <line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
              Save to Lyric Bank
            </button>
          )}
        </div>
      )}

      {/* Pull from Lyric Bank Section */}
      <div style={textPanelStyles.lyricSection}>
        <button
          style={textPanelStyles.lyricBankBtn}
          onClick={() => setShowLyricPicker(!showLyricPicker)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <path d="M14 2v6h6"/>
          </svg>
          Pull from Lyric Bank
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto', transform: showLyricPicker ? 'rotate(180deg)' : 'none' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {showLyricPicker && (
          <div style={textPanelStyles.lyricPicker}>
            {lyrics.length === 0 ? (
              <div style={textPanelStyles.noLyrics}>No lyrics in bank</div>
            ) : (
              lyrics.map(lyric => (
                <div key={lyric.id} style={textPanelStyles.lyricItem}>
                  <div style={textPanelStyles.lyricTitle}>{lyric.title}</div>
                  <div style={textPanelStyles.lyricPreview}>
                    {lyric.content.split('\n').slice(0, 2).join(' / ')}
                  </div>
                  <button
                    style={textPanelStyles.useLyricBtn}
                    onClick={() => {
                      onSelectText(lyric.content);
                      setShowLyricPicker(false);
                    }}
                  >
                    Use
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Styles
const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modal: {
    width: '95vw',
    height: '95vh',
    backgroundColor: '#0f0f1a',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: '#1a1a2e'
  },
  headerLeft: {
    flex: 1
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  nameInput: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#fff',
    fontSize: '18px',
    fontWeight: '600',
    outline: 'none',
    width: '300px'
  },
  aspectToggle: {
    display: 'flex',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '8px',
    padding: '4px'
  },
  aspectButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s'
  },
  aspectButtonActive: {
    backgroundColor: '#6366f1',
    color: '#fff'
  },
  templateSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: '6px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)'
  },
  templateLabel: {
    color: '#9ca3af',
    fontSize: '13px',
    fontWeight: '500',
    whiteSpace: 'nowrap'
  },
  templateSelect: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
    minWidth: '120px'
  },
  saveButton: {
    padding: '10px 24px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  exportButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 24px',
    backgroundColor: '#059669',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'opacity 0.2s'
  },
  exportSpinner: {
    width: '14px',
    height: '14px',
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  closeButton: {
    padding: '8px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  content: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  leftPanel: {
    width: '660px',
    borderRight: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#16162a'
  },
  bankTabs: {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.1)'
  },
  bankTab: {
    flex: 1,
    padding: '12px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  bankTabActive: {
    color: '#fff',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderBottom: '2px solid #6366f1'
  },
  // Colored tab variants
  bankTabTeal: {
    color: '#5eead4'
  },
  bankTabActiveTeal: {
    color: '#14b8a6',
    backgroundColor: 'rgba(20, 184, 166, 0.15)',
    borderBottom: '2px solid #14b8a6'
  },
  bankTabAmber: {
    color: '#fcd34d'
  },
  bankTabActiveAmber: {
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderBottom: '2px solid #f59e0b'
  },
  bankTabPurple: {
    color: '#c4b5fd'
  },
  bankTabActivePurple: {
    color: '#a78bfa',
    backgroundColor: 'rgba(167, 139, 250, 0.15)',
    borderBottom: '2px solid #a78bfa'
  },
  bankTabGreen: {
    color: '#86efac'
  },
  bankTabActiveGreen: {
    color: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderBottom: '2px solid #22c55e'
  },
  bankContent: {
    flex: 1,
    overflow: 'auto',
    padding: '12px'
  },
  emptyBank: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    color: '#6b7280',
    textAlign: 'center'
  },
  emptySubtext: {
    fontSize: '12px',
    marginTop: '8px',
    color: '#4b5563'
  },
  clipGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px'
  },
  clipCard: {
    aspectRatio: '1',
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'grab',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column'
  },
  clipThumbnail: {
    width: '100%',
    height: '80%',
    objectFit: 'cover'
  },
  clipPlaceholder: {
    width: '100%',
    height: '80%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4b5563'
  },
  clipName: {
    padding: '4px 8px',
    fontSize: '11px',
    color: '#9ca3af',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  rightPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    gap: '16px',
    overflow: 'auto',
    minHeight: 0
  },
  canvasContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    flexShrink: 0
  },
  canvas: {
    backgroundColor: '#000',
    borderRadius: '12px',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    flexShrink: 0
  },
  canvasBackground: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  canvasPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4b5563',
    gap: '12px'
  },
  textOverlay: {
    position: 'absolute',
    userSelect: 'none',
    zIndex: 5
  },
  canvasActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  addTextButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid rgba(99, 102, 241, 0.5)',
    borderRadius: '8px',
    color: '#a5b4fc',
    cursor: 'pointer',
    fontSize: '13px'
  },
  addAudioButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(251, 146, 60, 0.2)',
    border: '1px solid rgba(251, 146, 60, 0.5)',
    borderRadius: '8px',
    color: '#fdba74',
    cursor: 'pointer',
    fontSize: '13px'
  },
  audioPickerDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginBottom: '8px',
    width: '220px',
    backgroundColor: '#1f1f2e',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    overflow: 'hidden'
  },
  audioPickerHeader: {
    padding: '10px 12px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
  },
  audioPickerList: {
    maxHeight: '150px',
    overflowY: 'auto'
  },
  audioPickerItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#e4e4e7',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left',
    transition: 'background-color 0.15s'
  },
  audioPickerItemName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  audioPickerEmpty: {
    padding: '16px 12px',
    fontSize: '12px',
    color: '#6b7280',
    textAlign: 'center'
  },
  audioPickerDivider: {
    height: '1px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    margin: '4px 0'
  },
  audioPickerUpload: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#fdba74',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left',
    transition: 'background-color 0.15s'
  },
  rerollButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    border: '1px solid rgba(16, 185, 129, 0.5)',
    borderRadius: '8px',
    color: '#6ee7b7',
    cursor: 'pointer',
    fontSize: '13px'
  },
  addToLyricBankButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    border: '1px solid rgba(139, 92, 246, 0.5)',
    borderRadius: '8px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '13px'
  },
  lyricBankDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: '0',
    marginBottom: '8px',
    minWidth: '220px',
    maxHeight: '300px',
    backgroundColor: 'rgba(30, 27, 46, 0.98)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: '12px',
    boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)',
    zIndex: 1000,
    overflow: 'hidden'
  },
  lyricBankDropdownHeader: {
    padding: '10px 14px',
    fontSize: '11px',
    fontWeight: '600',
    color: 'rgba(196, 181, 253, 0.6)',
    letterSpacing: '0.5px',
    borderBottom: '1px solid rgba(139, 92, 246, 0.2)'
  },
  lyricBankDropdownList: {
    maxHeight: '200px',
    overflowY: 'auto'
  },
  lyricBankDropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#e9d5ff',
    cursor: 'pointer',
    background: 'rgba(139, 92, 246, 0.1)',
    borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
    transition: 'background 0.15s'
  },
  lyricBankDropdownEmpty: {
    padding: '16px 14px',
    fontSize: '12px',
    color: 'rgba(196, 181, 253, 0.5)',
    textAlign: 'center',
    fontStyle: 'italic'
  },
  lyricBankDropdownAddNew: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 14px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#6ee7b7',
    cursor: 'pointer',
    borderTop: '1px solid rgba(139, 92, 246, 0.2)',
    transition: 'background 0.15s'
  },
  aiTranscribeButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    border: '1px solid rgba(251, 191, 36, 0.5)',
    borderRadius: '8px',
    color: '#fcd34d',
    cursor: 'pointer',
    fontSize: '13px'
  },
  uploadAudioBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    marginTop: '12px',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    border: '1px solid rgba(34, 197, 94, 0.5)',
    borderRadius: '8px',
    color: '#22c55e',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  filmstrip: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    paddingTop: '16px',
    flexShrink: 0
  },
  filmstripScroll: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    paddingBottom: '8px'
  },
  filmstripSlide: {
    width: '80px',
    height: '120px',
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'pointer',
    border: '2px solid transparent',
    flexShrink: 0,
    position: 'relative'
  },
  filmstripSlideActive: {
    border: '2px solid #6366f1'
  },
  filmstripThumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  filmstripEmpty: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4b5563',
    fontSize: '18px',
    fontWeight: '600'
  },
  filmstripDropIndicator: {
    width: '3px',
    minWidth: '3px',
    height: '80px',
    backgroundColor: '#6366f1',
    borderRadius: '2px',
    flexShrink: 0,
    boxShadow: '0 0 8px rgba(99, 102, 241, 0.6)',
    margin: '0 2px'
  },
  removeSlideButton: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    width: '20px',
    height: '20px',
    backgroundColor: 'rgba(239, 68, 68, 0.8)',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    transition: 'opacity 0.2s'
  },
  addSlideButton: {
    width: '80px',
    height: '120px',
    backgroundColor: 'transparent',
    border: '2px dashed rgba(255,255,255,0.2)',
    borderRadius: '8px',
    cursor: 'pointer',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#6b7280',
    transition: 'all 0.2s'
  },
  slideCount: {
    fontSize: '12px',
    color: '#6b7280',
    textAlign: 'center'
  },
  // Schedule Panel Styles
  schedulePanel: {
    position: 'absolute',
    bottom: '80px',
    right: '24px',
    width: '360px',
    backgroundColor: '#1a1a2e',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '20px',
    zIndex: 100
  },
  schedulePanelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  schedulePanelTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff'
  },
  scheduleCloseBtn: {
    padding: '4px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '4px'
  },
  scheduleGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '12px'
  },
  scheduleField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '8px'
  },
  scheduleLabel: {
    fontSize: '11px',
    fontWeight: '500',
    color: '#9ca3af',
    textTransform: 'uppercase'
  },
  scheduleSelect: {
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer'
  },
  scheduleDateInput: {
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px'
  },
  platformCheckboxes: {
    display: 'flex',
    gap: '12px'
  },
  platformCheck: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#e4e4e7',
    cursor: 'pointer'
  },
  scheduleCaptionInput: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    resize: 'none'
  },
  scheduleHashtagInput: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#a78bfa',
    fontSize: '13px'
  },
  schedulePreview: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px'
  },
  schedulePreviewLabel: {
    fontSize: '12px',
    color: '#9ca3af',
    display: 'block',
    marginBottom: '8px'
  },
  schedulePreviewImages: {
    display: 'flex',
    gap: '4px'
  },
  schedulePreviewImg: {
    width: '48px',
    height: '64px',
    objectFit: 'cover',
    borderRadius: '6px'
  },
  schedulePreviewMore: {
    width: '48px',
    height: '64px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    color: '#9ca3af'
  },
  scheduleActions: {
    display: 'flex',
    gap: '12px',
    marginTop: '16px'
  },
  scheduleSkipBtn: {
    flex: 1,
    padding: '10px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    color: '#9ca3af',
    fontSize: '14px',
    cursor: 'pointer'
  },
  scheduleSubmitBtn: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#22c55e',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  // Audio styles
  audioList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  selectedAudioCard: {
    padding: '12px',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '10px',
    marginBottom: '8px'
  },
  selectedAudioHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '6px'
  },
  selectedAudioIcon: {
    fontSize: '14px'
  },
  selectedAudioLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#22c55e',
    textTransform: 'uppercase'
  },
  selectedAudioName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#fff',
    marginBottom: '4px'
  },
  selectedAudioDuration: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#9ca3af'
  },
  trimmedBadge: {
    fontSize: '10px',
    padding: '2px 6px',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    color: '#22c55e',
    borderRadius: '4px'
  },
  selectedAudioActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '8px'
  },
  trimAudioBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 10px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '6px',
    color: '#a5b4fc',
    fontSize: '12px',
    cursor: 'pointer'
  },
  removeAudioBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 10px',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '6px',
    color: '#f87171',
    fontSize: '12px',
    cursor: 'pointer'
  },
  audioCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  audioCardSelected: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.3)'
  },
  audioCardIcon: {
    fontSize: '20px'
  },
  audioCardInfo: {
    flex: 1,
    minWidth: 0
  },
  audioCardName: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  audioCardDuration: {
    fontSize: '11px',
    color: '#6b7280'
  },
  audioSelectBtn: {
    padding: '4px 10px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '4px',
    color: '#a5b4fc',
    fontSize: '11px',
    cursor: 'pointer'
  },
  audioPlayerBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.2)',
    borderRadius: '10px',
    marginBottom: '8px'
  },
  playPauseBtn: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22c55e',
    border: 'none',
    borderRadius: '50%',
    color: '#fff',
    cursor: 'pointer'
  },
  audioPlayerInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  audioPlayerName: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#fff'
  },
  audioPlayerTime: {
    fontSize: '11px',
    color: '#86efac',
    fontFamily: 'monospace'
  },
  audioProgressBar: {
    width: '100px',
    height: '4px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  audioProgressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    transition: 'width 0.1s linear'
  }
};

// Flowstage-style Text Editor Panel Styles
const textPanelStyles = {
  panel: {
    position: 'absolute',
    right: '24px',
    top: '24px',
    width: '320px',
    maxHeight: 'calc(100% - 180px)',
    backgroundColor: '#1a1a2e',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 100
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)' // Red tint like Flowstage
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#f87171'
  },
  closeBtn: {
    padding: '6px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '6px',
    transition: 'background 0.2s'
  },
  textList: {
    padding: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.1)'
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase'
  },
  addBtn: {
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: 'none',
    borderRadius: '6px',
    color: '#a5b4fc',
    cursor: 'pointer'
  },
  emptyText: {
    textAlign: 'center',
    padding: '20px',
    color: '#6b7280'
  },
  addTextBtn: {
    marginTop: '12px',
    padding: '8px 16px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '8px',
    color: '#a5b4fc',
    cursor: 'pointer',
    fontSize: '13px'
  },
  textBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    marginBottom: '8px',
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.2s'
  },
  textBlockActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)'
  },
  textPreview: {
    flex: 1,
    fontSize: '13px',
    color: '#e4e4e7',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  deleteBlockBtn: {
    padding: '4px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    opacity: 0.6,
    transition: 'opacity 0.2s'
  },
  editor: {
    padding: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  textarea: {
    width: '100%',
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    resize: 'none',
    outline: 'none',
    marginBottom: '12px',
    fontFamily: 'inherit'
  },
  control: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
    fontSize: '13px',
    color: '#9ca3af'
  },
  controlHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  controlValue: {
    fontSize: '12px',
    color: '#6b7280'
  },
  sizeButtons: {
    display: 'flex',
    gap: '4px'
  },
  sizeBtn: {
    padding: '6px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: 'none',
    borderRadius: '4px',
    color: '#e4e4e7',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600'
  },
  alignButtons: {
    display: 'flex',
    gap: '4px'
  },
  alignBtn: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: 'none',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer'
  },
  alignBtnActive: {
    backgroundColor: '#ef4444',
    color: '#fff'
  },
  colorPicker: {
    width: '32px',
    height: '32px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    padding: 0
  },
  fontSelect: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none'
  },
  lyricSection: {
    padding: '16px'
  },
  lyricBankBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 16px',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: '10px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  lyricPicker: {
    marginTop: '12px',
    maxHeight: '200px',
    overflowY: 'auto'
  },
  noLyrics: {
    padding: '16px',
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '13px'
  },
  lyricItem: {
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    marginBottom: '8px'
  },
  lyricTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#e4e4e7',
    marginBottom: '4px'
  },
  lyricPreview: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '8px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  useLyricBtn: {
    padding: '6px 12px',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: '6px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '12px'
  },
  templateActions: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap'
  },
  saveTemplateBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '6px',
    color: '#6ee7b7',
    cursor: 'pointer',
    fontSize: '12px'
  },
  applyTemplateBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '6px',
    color: '#a5b4fc',
    cursor: 'pointer',
    fontSize: '12px'
  },
  templateDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '4px',
    backgroundColor: '#1f1f2e',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    overflow: 'hidden',
    zIndex: 10
  },
  templateItem: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#e4e4e7',
    fontSize: '13px',
    textAlign: 'left',
    cursor: 'pointer'
  },
  saveToLyricBankBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: '8px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '13px',
    marginTop: '8px'
  },
  // Save to Lyric Bank prompt styles - Premium Design
  saveToBankOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    animation: 'fadeIn 0.2s ease-out'
  },
  saveToBankModal: {
    position: 'relative',
    backgroundColor: '#1a1a2e',
    borderRadius: '20px',
    padding: '32px',
    maxWidth: '400px',
    width: '90%',
    boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.1)',
    textAlign: 'center',
    animation: 'slideUp 0.3s ease-out'
  },
  saveToBankCloseBtn: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: '8px',
    padding: '8px',
    cursor: 'pointer',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  saveToBankIconWrapper: {
    position: 'relative',
    display: 'inline-flex',
    marginBottom: '20px'
  },
  saveToBankIconGlow: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(16, 185, 129, 0.3) 0%, transparent 70%)',
    animation: 'pulse 2s ease-in-out infinite'
  },
  saveToBankIcon: {
    position: 'relative',
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%)',
    border: '2px solid rgba(16, 185, 129, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  saveToBankTitle: {
    margin: '0 0 8px 0',
    fontSize: '22px',
    fontWeight: '700',
    color: '#fff',
    letterSpacing: '-0.02em'
  },
  saveToBankSubtitle: {
    color: '#9ca3af',
    fontSize: '14px',
    lineHeight: '1.5',
    marginBottom: '24px',
    padding: '0 12px'
  },
  saveToBankPreviewCard: {
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '24px',
    textAlign: 'left'
  },
  saveToBankPreviewHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    paddingBottom: '12px',
    borderBottom: '1px solid rgba(255,255,255,0.08)'
  },
  saveToBankPreviewLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#8b5cf6',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  saveToBankPreviewContent: {
    maxHeight: '120px',
    overflow: 'hidden'
  },
  saveToBankLyricLine: {
    color: '#e4e4e7',
    fontSize: '13px',
    lineHeight: '1.8',
    fontFamily: "'Inter', sans-serif"
  },
  saveToBankMoreLines: {
    marginTop: '8px',
    fontSize: '12px',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  saveToBankActions: {
    display: 'flex',
    gap: '12px'
  },
  saveToBankSkipBtn: {
    flex: 1,
    padding: '14px 20px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '10px',
    color: '#9ca3af',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  saveToBankSaveBtn: {
    flex: 1.2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px 20px',
    background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
    border: 'none',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
};

// Add hover effect for remove button and animations
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  .slideshow-filmstrip-slide:hover .slideshow-remove-btn {
    opacity: 1 !important;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;
document.head.appendChild(styleSheet);

export default SlideshowEditor;
