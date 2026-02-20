import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import useIsMobile from '../../hooks/useIsMobile';
import { exportSlideshowAsImages } from '../../services/slideshowExportService';
import { subscribeToLibrary, subscribeToCollections, getCollections, getCollectionsAsync, getLibrary, getLyrics, MEDIA_TYPES, addToTextBank, removeFromTextBank, assignToBank, saveCollectionToFirestore, migrateCollectionBanks, getBankColor, getBankLabel, getPipelineBankLabel, BANK_COLORS, MAX_BANKS, MIN_BANKS, addBankToCollection, removeBankFromCollection, updateLibraryItem, getTextBankText, getTextBankStyle, addToLibraryAsync } from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';
import { useToast } from '../ui';
import LyricBank from './LyricBank';
import AudioClipSelector from './AudioClipSelector';
import LyricAnalyzer from './LyricAnalyzer';
import CloudImportButton from './CloudImportButton';
import log from '../../utils/logger';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { TextField } from '../../ui/components/TextField';
import { Badge } from '../../ui/components/Badge';
import { FeatherArrowLeft, FeatherX, FeatherDownload, FeatherChevronLeft, FeatherChevronRight, FeatherChevronDown, FeatherPlus, FeatherTrash2, FeatherRefreshCw, FeatherPlay, FeatherPause, FeatherScissors, FeatherUpload, FeatherCloud, FeatherMusic, FeatherMic, FeatherDatabase, FeatherAlignLeft, FeatherAlignCenter, FeatherAlignRight, FeatherLayout, FeatherCheck, FeatherCopy, FeatherSave } from '@subframe/core';

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

// Stable empty array for fallbacks — prevents new [] reference on every render
const EMPTY_SLIDES = [];

// Stroke string helpers: parse "0.5px black" ↔ { width: 0.5, color: '#000000' }
const parseStroke = (str) => {
  if (!str) return { width: 0.5, color: '#000000' };
  const match = str.match(/([\d.]+)px\s+(.*)/);
  if (!match) return { width: 0.5, color: '#000000' };
  return { width: parseFloat(match[1]) || 0.5, color: match[2] || '#000000' };
};
const buildStroke = (width, color) => `${width}px ${color}`;

const SlideshowEditor = ({
  db = null,
  artistId = null,
  category,
  existingSlideshow = null,
  initialImages = [],
  initialAudio = null,
  initialLyrics = [],
  initialSelectedBanks = null, // { bankA: true, bankB: false } — which banks to pull from on creation
  batchMode = false,
  onSave,
  onClose,
  onSchedulePost,
  onAddLyrics,
  onImportToBank,
  lateAccountIds = {},
  schedulerEditMode = false
}) => {
  // Mobile responsive detection
  const { isMobile } = useIsMobile();

  const { success: toastSuccess, error: toastError } = useToast();

  // Multi-timeline state: all slideshows (index 0 = template, rest = generated)
  // Ensure every slide has textOverlays array (handles legacy data from localStorage)
  const ensureTextOverlays = (slides) => (slides || []).map(s => ({
    ...s,
    textOverlays: s.textOverlays || []
  }));
  const isMultiDraftMode = !!(existingSlideshow?.multiple && Array.isArray(existingSlideshow.multiple));
  // Strip stale blob URLs from audio on load — prefer cloud URL, null out dead blobs
  const sanitizeAudio = (audio) => {
    if (!audio) return null;
    const clean = { ...audio };
    if (clean.localUrl && clean.localUrl.startsWith('blob:')) delete clean.localUrl;
    if (clean.url && clean.url.startsWith('blob:')) {
      // If only URL is a blob and no cloud fallback, null out
      if (!clean.localUrl) clean.url = null;
    }
    // If no usable URL left, keep metadata but mark as needing re-add
    if (!clean.url && !clean.localUrl) {
      console.warn('[SlideshowEditor] Audio has stale blob URL — cleared on load');
    }
    return clean;
  };
  const [allSlideshows, setAllSlideshows] = useState(() => {
    if (isMultiDraftMode) {
      return existingSlideshow.multiple.map((ss, idx) => ({
        id: ss.id || `multi_${idx}`,
        name: ss.name || `Slideshow ${idx + 1}`,
        slides: ensureTextOverlays(ss.slides),
        audio: sanitizeAudio(ss.audio),
        isTemplate: false
      }));
    }
    return [{
      id: 'template',
      name: existingSlideshow?.name || 'Untitled Slideshow',
      slides: ensureTextOverlays(existingSlideshow?.slides),
      audio: sanitizeAudio(existingSlideshow?.audio || initialAudio || null),
      isTemplate: true
    }];
  });
  const [activeSlideshowIndex, setActiveSlideshowIndex] = useState(0);
  const [generateCount, setGenerateCount] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  // Keep-template-text: 'none' = pull from banks, 'all' = keep all, Set<number> = keep specific slide indices
  const [keepTemplateText, setKeepTemplateText] = useState('none');

  // Derived reads from active slideshow (existing code reads these unchanged)
  // Use stable empty array to prevent creating new [] reference every render
  const slides = allSlideshows[activeSlideshowIndex]?.slides || EMPTY_SLIDES;
  const name = allSlideshows[activeSlideshowIndex]?.name || 'Untitled Slideshow';
  const selectedAudio = allSlideshows[activeSlideshowIndex]?.audio || null;

  // Wrapper setters that route through allSlideshows (existing setSlides/setName/setSelectedAudio calls work unchanged)
  const setSlides = useCallback((updater) => {
    setAllSlideshows(prev => {
      const current = prev[activeSlideshowIndex];
      if (!current) return prev;
      const newSlides = typeof updater === 'function' ? updater(current.slides) : updater;
      // Bail early if slides reference didn't change (prevents unnecessary re-renders)
      if (newSlides === current.slides) return prev;
      // Safety: ensure slide images are never silently stripped
      const safeSlides = (newSlides || []).map((slide, i) => {
        const orig = current.slides[i];
        if (orig && orig.backgroundImage && !slide.backgroundImage) {
          console.warn('[SlideshowEditor] Prevented image loss on slide', i, slide.id);
          return { ...slide, backgroundImage: orig.backgroundImage, thumbnail: orig.thumbnail };
        }
        return slide;
      });
      const copy = [...prev];
      copy[activeSlideshowIndex] = { ...current, slides: safeSlides };
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
  const [activeBank, setActiveBank] = useState('image0'); // 'image0' | 'image1' | ... | 'audio' | 'lyrics'
  const [libraryImages, setLibraryImages] = useState([]);
  const [libraryAudio, setLibraryAudio] = useState([]);
  const [collections, setCollections] = useState([]);
  const [selectedSource, setSelectedSource] = useState('bank_0'); // 'bank_0' | 'bank_1' | 'collectionId:bank_N' | collection ID

  // Detect if we're working with a pipeline collection (for label overrides)
  const activePipeline = useMemo(() => collections.find(c => c.isPipeline), [collections]);
  // Label helper: uses pipeline format labels (e.g. "Hook") when available, falls back to "Slide N"
  const bankLabel = useCallback((idx) => activePipeline ? getPipelineBankLabel(activePipeline, idx) : bankLabel(idx), [activePipeline]);

  // Text bank input state
  const [newTextInputs, setNewTextInputs] = useState({});
  const [showAddToBankPicker, setShowAddToBankPicker] = useState(false);

  // Derive active collection ID from selectedSource (needed before text bank callbacks)
  const activeCollectionId = (() => {
    if (selectedSource && selectedSource.includes(':bank_')) return selectedSource.split(':')[0];
    if (selectedSource && !selectedSource.match(/^bank_\d+$/)) return selectedSource;
    return null;
  })();

  // Add text to a text bank and update local collections state
  // text can be a plain string or { text: string, style: object }
  const handleAddToTextBank = useCallback((bankNum, text) => {
    const plainText = typeof text === 'string' ? text : text?.text || '';
    if (!plainText.trim() || !artistId || collections.length === 0) return;
    // For plain strings, trim; for styled objects, trim the text inside
    const entry = typeof text === 'string' ? text.trim() : { ...text, text: text.text.trim() };
    // Target the active collection from collections state (must be a real Firestore collection)
    const colFromSource = activeCollectionId ? collections.find(c => c.id === activeCollectionId) : null;
    const colFromCategory = category?.id ? collections.find(c => c.id === category.id) : null;
    const targetCol = colFromSource || colFromCategory || collections[0];
    if (!targetCol) return;
    addToTextBank(artistId, targetCol.id, bankNum, entry);
    // Update local state so UI refreshes immediately (write to textBanks array)
    setCollections(prev => prev.map(col => {
      if (col.id !== targetCol.id) return col;
      const migrated = migrateCollectionBanks(col);
      const textBanks = [...(migrated.textBanks || [])];
      const idx = bankNum - 1;
      while (textBanks.length <= idx) textBanks.push([]);
      textBanks[idx] = [...textBanks[idx], entry];
      return { ...col, textBanks };
    }));
  }, [artistId, collections, category, activeCollectionId]);

  // Delete text from a text bank
  const handleRemoveFromTextBank = useCallback((bankNum, index) => {
    if (!artistId || collections.length === 0) return;
    // Target the active collection from collections state (must be a real Firestore collection)
    const colFromSource = activeCollectionId ? collections.find(c => c.id === activeCollectionId) : null;
    const colFromCategory = category?.id ? collections.find(c => c.id === category.id) : null;
    const targetCol = colFromSource || colFromCategory || collections[0];
    if (!targetCol) return;
    removeFromTextBank(artistId, targetCol.id, bankNum, index);
    setCollections(prev => prev.map(col => {
      if (col.id !== targetCol.id) return col;
      const migrated = migrateCollectionBanks(col);
      const textBanks = [...(migrated.textBanks || [])];
      const idx = bankNum - 1;
      if (textBanks[idx]) {
        textBanks[idx] = textBanks[idx].filter((_, i) => i !== index);
      }
      return { ...col, textBanks };
    }));
  }, [artistId, collections, category, activeCollectionId]);

  // Filmstrip drag-and-drop state
  const [filmstripDropIndex, setFilmstripDropIndex] = useState(null);
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const audioRef = useRef(null);
  const animationRef = useRef(null);
  const isPlayingRef = useRef(false);

  // Text editor state
  const [editingTextId, setEditingTextId] = useState(null);
  const [textEditorPosition, setTextEditorPosition] = useState({ x: 0, y: 0 });
  const [showTextEditorPanel, setShowTextEditorPanel] = useState(false); // Flowstage-style side panel

  // Text overlay drag state
  const [draggingTextId, setDraggingTextId] = useState(null);
  const [resizingTextId, setResizingTextId] = useState(null);
  const dragStartRef = useRef(null); // { mouseX, mouseY, startPosX, startPosY }
  const resizeStartRef = useRef(null); // { mouseX, startWidth }

  // AI Transcription state
  const [showLyricAnalyzer, setShowLyricAnalyzer] = useState(false);
  // Linked lyrics highlight (auto-loaded when audio with linkedLyricsId is selected)
  const [linkedLyricId, setLinkedLyricId] = useState(null);

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
  const importImageGenericRef = useRef(null);
  const importBankIndexRef = useRef(0); // tracks which bank index the generic import is for

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
      toastSuccess(`Added ${mediaIds.length} image${mediaIds.length > 1 ? 's' : ''} to ${bankLabel(bank)} Bank`);
      return;
    }

    // Handle file drops from desktop (no media IDs found)
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    const imageFiles = droppedFiles.filter(f => f.type.startsWith('image/') || /\.(heic|heif|tif|tiff)$/i.test(f.name));
    if (imageFiles.length > 0 && onImportToBank) {
      onImportToBank(imageFiles, bank);
    }
  }, [artistId, collections, db, toastSuccess, onImportToBank]);

  // Image drag/resize state (declared early — needed by history tracking)
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isResizingImage, setIsResizingImage] = useState(false);

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

  // BUG-022: Debounce history pushes to prevent flooding on rapid state changes
  const historyTimerRef = useRef(null);
  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    // Don't flood history during drag operations — snapshot pushed on release
    if (draggingTextId || resizingTextId || isDraggingImage || isResizingImage) return;
    if (slides.length > 0) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = setTimeout(() => {
        pushHistory(slides);
      }, 500);
    }
    return () => clearTimeout(historyTimerRef.current);
  }, [slides, pushHistory, draggingTextId, resizingTextId, isDraggingImage, isResizingImage]);

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

  // Close confirmation handler — check for unsaved work before closing
  const handleCloseRequest = useCallback(() => {
    const hasWork = slides.length > 0 || selectedAudio !== null || allSlideshows.length > 1;
    if (hasWork) {
      setShowCloseConfirm(true);
    } else {
      onClose?.();
    }
  }, [slides, selectedAudio, allSlideshows, onClose]);

  // Keyboard shortcut: Cmd+Z / Ctrl+Z for undo, Cmd+Shift+Z / Ctrl+Shift+Z for redo
  // Escape key to trigger close confirmation
  // Skip if user is editing text overlays or typing in an input/textarea
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape key — always trigger close request
      if (e.code === 'Escape') {
        e.preventDefault();
        handleCloseRequest();
        return;
      }

      // Don't steal undo/redo from text inputs
      if (editingTextId) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

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
  }, [handleUndo, handleRedo, editingTextId, handleCloseRequest]);

  // Image drag/resize continued state
  const [imgDragStart, setImgDragStart] = useState({ x: 0, y: 0 });
  const [imgTransformStart, setImgTransformStart] = useState({ scale: 1, offsetX: 0, offsetY: 0 });

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedImages, setExportedImages] = useState(existingSlideshow?.exportedImages || []);

  // Inline prompt modal state (replaces window.prompt)
  const [showLyricsPrompt, setShowLyricsPrompt] = useState(false);
  const [lyricsPromptValue, setLyricsPromptValue] = useState('');
  const [showTemplatePrompt, setShowTemplatePrompt] = useState(false);
  const [templatePromptValue, setTemplatePromptValue] = useState('');
  const [pendingTemplateStyle, setPendingTemplateStyle] = useState(null);

  // Scheduling state
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [selectedHandle, setSelectedHandle] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: false });
  const [isScheduling, setIsScheduling] = useState(false);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('#carousel #slideshow #fyp');

  // Available handles from lateAccountIds
  const availableHandles = Object.keys(lateAccountIds);

  // Canvas ref for rendering
  const canvasRef = useRef(null);
  const previewRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 480, height: 640 });

  // Resolve category bank images dynamically (memoized to prevent unstable deps)
  const categoryBankImages = useMemo(() => {
    if (!category) return [];
    const migrated = migrateCollectionBanks(category);
    return (migrated.banks || []).map(bankIds =>
      (bankIds || []).length > 0 ? libraryImages.filter(img => bankIds.includes(img.id)) : []
    );
  }, [category, libraryImages]);
  // Lyrics: merge category lyrics with library lyrics (for StudioHome/library mode)
  // Filter to only show lyrics tagged to the active collection
  const [libraryLyrics, setLibraryLyrics] = useState([]);
  const refreshLibraryLyrics = useCallback(() => {
    if (artistId) setLibraryLyrics(getLyrics(artistId));
  }, [artistId]);
  useEffect(() => { refreshLibraryLyrics(); }, [refreshLibraryLyrics]);
  // activeCollectionId is now declared earlier (before text bank callbacks)
  const lyrics = (() => {
    const catLyrics = category?.lyrics || [];
    if (catLyrics.length > 0) return catLyrics;
    // Filter library lyrics by active collection
    if (activeCollectionId) {
      const filtered = libraryLyrics.filter(l => (l.collectionIds || []).includes(activeCollectionId));
      if (filtered.length > 0) return filtered;
    }
    if (libraryLyrics.length > 0) return libraryLyrics;
    // Fallback to initialLyrics passed from parent (e.g. StudioHome selection)
    return initialLyrics;
  })();
  // Wrapper: add lyrics then refresh local state so picker updates immediately
  const handleAddLyricsAndRefresh = useCallback((data) => {
    onAddLyrics?.(data);
    // Refresh after a tick so localStorage write completes first
    setTimeout(refreshLibraryLyrics, 50);
  }, [onAddLyrics, refreshLibraryLyrics]);

  // Audio tracks: pull from library audio filtered by active collection, fallback to category.audio
  const audioTracks = (() => {
    // Map trim metadata to startTime/endTime so the editor can use them
    const mapTrimFields = (items) => items.map(a => ({
      ...a,
      startTime: a.startTime ?? a.trimStart ?? a.metadata?.trimStart ?? 0,
      endTime: a.endTime ?? a.trimEnd ?? a.metadata?.trimEnd ?? null
    }));

    // Always show ALL library audio — audio isn't bank-specific like images
    if (libraryAudio.length > 0) {
      return mapTrimFields(libraryAudio);
    }
    // Fallback to category-based audio (legacy)
    return mapTrimFields(category?.audio || []);
  })();

  const activeContent = (() => {
    if (activeBank === 'audio') return audioTracks;
    // Support dynamic bank indices: 'image0', 'image1', 'image2', etc. (also legacy 'imageA'/'imageB')
    const bankMatch = activeBank.match(/^image(\d+)$/);
    if (bankMatch) return categoryBankImages[parseInt(bankMatch[1], 10)] || [];
    if (activeBank === 'imageA') return categoryBankImages[0] || [];
    if (activeBank === 'imageB') return categoryBankImages[1] || [];
    return [];
  })();

  // Load library images and collections when db/artistId available
  // Strategy: instant load from localStorage, then Firestore subscription merges in background
  useEffect(() => {
    if (!artistId) return;

    // Instant load from localStorage for immediate UI (before Firestore fires)
    const cachedLibrary = getLibrary(artistId);
    if (cachedLibrary.length > 0) {
      setLibraryImages(cachedLibrary.filter(item => item.type === MEDIA_TYPES.IMAGE));
      setLibraryAudio(cachedLibrary.filter(item => item.type === MEDIA_TYPES.AUDIO));
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
      const audio = merged.filter(item => item.type === MEDIA_TYPES.AUDIO);
      setLibraryImages(images);
      setLibraryAudio(audio);
    }));

    // Subscribe to collections in real-time — merges localStorage banks
    unsubscribes.push(subscribeToCollections(db, artistId, (cols) => {
      setCollections(cols.filter(c => c.type !== 'smart'));
    }));

    return () => unsubscribes.forEach(unsub => unsub());
  }, [db, artistId]);

  // Auto-select the first collection with populated banks when default 'bank_0' has no category data
  useEffect(() => {
    if (selectedSource !== 'bank_0') return;
    if (categoryBankImages.some(b => (b || []).length > 0)) return;
    for (const col of collections) {
      const migrated = migrateCollectionBanks(col);
      const hasPopulated = (migrated.banks || []).some(b => b?.length > 0);
      if (hasPopulated) {
        setSelectedSource(`${col.id}:bank_0`);
        return;
      }
    }
  }, [collections, categoryBankImages, selectedSource]);

  // Compute active images based on selected source
  // Supports: 'bank_0', 'bank_1', 'collectionId:bank_0', 'collectionId:bank_1', etc.
  // When category banks are empty, aggregates from all collection banks
  const activeImages = (() => {
    // Parse bank index from selectedSource format: 'bank_0', 'bank_1', etc.
    const bankMatch = selectedSource.match(/^bank_(\d+)$/);
    if (bankMatch) {
      const idx = parseInt(bankMatch[1], 10);
      // Use category bank first; if empty, aggregate from all collections
      if (categoryBankImages[idx]?.length > 0) return categoryBankImages[idx];
      const allIds = new Set();
      collections.forEach(col => {
        const migrated = migrateCollectionBanks(col);
        ((migrated.banks || [])[idx] || []).forEach(id => allIds.add(id));
      });
      if (allIds.size > 0) return libraryImages.filter(img => allIds.has(img.id));
      return categoryBankImages[idx] || [];
    }
    // Collection bank source — format: "collectionId:bank_0"
    if (selectedSource.includes(':bank_')) {
      const [colId, bankPart] = selectedSource.split(':');
      const idx = parseInt(bankPart.replace('bank_', ''), 10);
      const col = collections.find(c => c.id === colId);
      if (col) {
        const migrated = migrateCollectionBanks(col);
        const bankIds = (migrated.banks || [])[idx] || [];
        return libraryImages.filter(img => bankIds.includes(img.id));
      }
    }
    // Fallback: aggregate from all collection bank 0
    const fallbackIds = new Set();
    collections.forEach(col => {
      const migrated = migrateCollectionBanks(col);
      ((migrated.banks || [])[0] || []).forEach(id => fallbackIds.add(id));
    });
    if (fallbackIds.size > 0) return libraryImages.filter(img => fallbackIds.has(img.id));
    return categoryBankImages[0] || [];
  })();

  // Export dimensions based on aspect ratio
  const ASPECT_DIMENSIONS = {
    '4:5': { width: 1080, height: 1350 },  // Instagram carousel (standard)
    '1:1': { width: 1080, height: 1080 },  // Square
    '9:16': { width: 1080, height: 1920 }, // Story/TikTok
    '4:3': { width: 1080, height: 1440 },  // Legacy
  };
  const exportDimensions = ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS['4:5'];

  // Preview dimensions - dynamic scale based on rendered canvas width
  const baseDimensions = exportDimensions;
  const [renderedCanvasWidth, setRenderedCanvasWidth] = useState(480);
  const previewScale = renderedCanvasWidth / baseDimensions.width;

  // Measure canvas area container and compute canvas pixel dimensions
  useEffect(() => {
    if (!canvasAreaRef.current) return;
    const observer = new ResizeObserver(entries => {
      const { width: cw, height: ch } = entries[0].contentRect;
      if (cw <= 0 || ch <= 0) return;
      const ar = baseDimensions.width / baseDimensions.height;
      let w, h;
      if (cw / ch > ar) {
        h = ch; w = ch * ar;
      } else {
        w = cw; h = cw / ar;
      }
      setCanvasSize({ width: Math.floor(w), height: Math.floor(h) });
      setRenderedCanvasWidth(Math.floor(w));
    });
    observer.observe(canvasAreaRef.current);
    return () => observer.disconnect();
  }, [baseDimensions]);

  // Get current slide (defined early so callbacks can reference it)
  // Guard: clamp selectedSlideIndex to valid range to prevent undefined currentSlide
  const safeSlideIndex = slides.length > 0 ? Math.min(selectedSlideIndex, slides.length - 1) : 0;
  const currentSlide = slides[safeSlideIndex];

  // Auto-correct out-of-bounds selectedSlideIndex
  useEffect(() => {
    if (slides.length > 0 && selectedSlideIndex >= slides.length) {
      setSelectedSlideIndex(slides.length - 1);
    }
  }, [slides.length, selectedSlideIndex]);

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
    if ((categoryBankImages[0] || []).length > 0 || (categoryBankImages[1] || []).length > 0) return;

    // Find first collection with populated banks
    for (const col of collections) {
      const migrated = migrateCollectionBanks(col);
      for (let idx = 0; idx < (migrated.banks || []).length; idx++) {
        if ((migrated.banks || [])[idx]?.length > 0) {
          setSelectedSource(`${col.id}:bank_${idx}`);
          setSourceAutoSwitched(true);
          return;
        }
      }
    }
  }, [collections, categoryBankImages, sourceAutoSwitched]);

  // Initialize with at least one slide, or generate batch, or use initialImages, or auto-start from banks
  useEffect(() => {
    if (slides.length === 0) {
      if (initialImages && initialImages.length > 0) {
        // Create exactly 2 slides — one from first image (Slide 1), one from second (Slide 2)
        // Even if many images are passed, template always starts as a 2-slide slideshow
        const cappedImages = initialImages.slice(0, 2);
        const initSlides = cappedImages.map((img, i) => ({
          id: `slide_${Date.now()}_${i}`,
          index: i,
          backgroundImage: img.url || img.localUrl,
          thumbnail: img.url || img.localUrl,
          sourceBank: `image${i}`,
          sourceImageId: img.id,
          textOverlays: [],
          duration: 3,
          imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
        }));
        setSlides(initSlides);
      } else if (batchMode && categoryBankImages.some(bank => (bank || []).length > 0)) {
        // Batch mode: Generate 10 slides randomly from ALL banks
        const allImages = categoryBankImages.flatMap((bank, idx) =>
          (bank || []).map(img => ({ ...img, sourceBank: `image${idx}` }))
        );

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
  }, [batchMode, categoryBankImages]);

  // Auto-start from collection banks: once collections load, if slides are empty/blank
  // and any collection has banks populated, auto-create starter slides from selected banks
  useEffect(() => {
    if (autoStartAttempted) return;
    if (!collections || collections.length === 0) return;
    if (initialImages?.length > 0 || batchMode) return;

    // Check if current slides are just a single empty slide (the default addSlide)
    const isDefaultEmpty = slides.length <= 1 && !slides[0]?.backgroundImage;
    if (!isDefaultEmpty) return;

    // Determine which banks to pull from
    // initialSelectedBanks can be a Set of indices, an object with bankA/bankB, or null (use all)
    const isBankSelected = (idx) => {
      if (!initialSelectedBanks) return true; // null = use all
      if (initialSelectedBanks instanceof Set) return initialSelectedBanks.has(idx);
      // Legacy object format: { bankA: true, bankB: false }
      const legacyKey = idx === 0 ? 'bankA' : idx === 1 ? 'bankB' : `bank${idx}`;
      return initialSelectedBanks[legacyKey] !== false;
    };

    // Find collection with populated banks
    for (const col of collections) {
      const migrated = migrateCollectionBanks(col);
      const newSlides = [];
      let defaultBankIdx = -1;
      const numBanks = (migrated.banks || []).length;

      for (let idx = 0; idx < numBanks; idx++) {
        if (!isBankSelected(idx)) continue;

        const bankIds = (migrated.banks || [])[idx] || [];
        const bankImages = bankIds.length > 0 ? libraryImages.filter(img => bankIds.includes(img.id)) : [];
        if (bankImages.length === 0) continue;

        if (defaultBankIdx === -1) defaultBankIdx = idx;
        const img = bankImages[Math.floor(Math.random() * bankImages.length)];
        newSlides.push({
          id: `slide_${Date.now()}_${idx}`, index: newSlides.length,
          backgroundImage: img.url || img.localUrl, thumbnail: img.url || img.localUrl,
          sourceBank: `image${idx}`, sourceImageId: img.id,
          textOverlays: [], duration: 3, imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
        });
      }

      if (newSlides.length > 0) {
        setSlides(newSlides);
        // Set source to the first available bank of this collection
        setSelectedSource(`${col.id}:bank_${defaultBankIdx}`);
        setAutoStartAttempted(true);
        return;
      }
    }
    setAutoStartAttempted(true);
  }, [collections, libraryImages, slides, initialImages, batchMode, autoStartAttempted, initialSelectedBanks]);

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
      return filtered.map((s, i) => ({ ...s, index: i }));
    });
    // Adjust selected index using functional updater to avoid stale closure
    setSelectedSlideIndex(prev => {
      const newLen = slides.filter(s => s.id !== slideId).length;
      return prev >= newLen ? Math.max(0, newLen - 1) : prev;
    });
  }, [slides]);

  // Keyboard Delete/Backspace to remove current slide
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
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

    // Parse bank index from sourceBank format: 'image0', 'image1', etc. (also legacy 'imageA'/'imageB')
    const bankMatch = currentSlide.sourceBank.match(/^image(\d+)$/);
    const bankIdx = bankMatch ? parseInt(bankMatch[1], 10)
      : currentSlide.sourceBank === 'imageA' ? 0
      : currentSlide.sourceBank === 'imageB' ? 1
      : null;

    // First try category-level banks
    let bank = bankIdx !== null ? (categoryBankImages[bankIdx] || []) : [];

    // If category banks are empty, try collection-level banks
    if (bank.length === 0 && bankIdx !== null && collections?.length > 0) {
      const allBankIds = [];
      collections.forEach(col => {
        const migrated = migrateCollectionBanks(col);
        const bankIds = (migrated.banks || [])[bankIdx] || [];
        if (bankIds.length > 0) {
          allBankIds.push(...bankIds);
        }
      });
      if (allBankIds.length > 0) {
        bank = libraryImages.filter(img => allBankIds.includes(img.id));
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
  }, [currentSlide, categoryBankImages, collections, libraryImages, activeImages, migrateCollectionBanks]);

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

  // Gather text bank items from the active collection only (not merged across all)
  const textBanksCache = useMemo(() => {
    // Priority: 1) collection matching activeCollectionId (from source dropdown)
    // 2) category prop if it has textBanks (real collection passed from parent)
    // 3) category.id match in collections (Firestore version has textBanks)
    // 4) first collection as fallback
    const colFromSource = activeCollectionId ? collections.find(c => c.id === activeCollectionId) : null;
    const catHasTextBanks = category && (category.textBanks || []).some(tb => tb?.length > 0);
    const colFromCategory = category?.id ? collections.find(c => c.id === category.id) : null;
    const activeCol = colFromSource || (catHasTextBanks ? category : null) || colFromCategory || collections[0];
    if (!activeCol) { return [[], []]; }
    const migrated = migrateCollectionBanks(activeCol);
    const result = (migrated.textBanks || []).map(tb => tb?.length > 0 ? [...tb] : []);
    while (result.length < 2) result.push([]);
    return result;
  }, [category, activeCollectionId, collections, migrateCollectionBanks]);
  const getTextBanks = useCallback(() => textBanksCache, [textBanksCache]);

  // Re-roll text: Replace text overlays with random text from banks
  const handleTextReroll = useCallback((overlayId = null, bankSource = null) => {
    try {
      const textBanks = getTextBanks();
      if (!textBanks || textBanks.length === 0 || !textBanks.some(b => b?.length > 0)) return;

      setSlides(prev => prev.map((slide, i) => {
        if (i !== selectedSlideIndex) return slide;
        const updatedOverlays = (slide.textOverlays || []).map((overlay, idx) => {
          if (!overlay?.id) return overlay;
          // If a specific overlay ID is given, only reroll that one
          if (overlayId && overlay.id !== overlayId) return overlay;

          // Use specified bank source, or auto-assign based on overlay index
          let bank;
          if (bankSource !== null && bankSource !== undefined) bank = textBanks[bankSource] || [];
          else bank = textBanks[idx] || textBanks[0] || [];
          if (!bank || bank.length === 0) return overlay;

          // Pick random entry different from current if possible
          const others = bank.filter(t => getTextBankText(t) !== overlay.text);
          const pool = others.length > 0 ? others : bank;
          const randomEntry = pool[Math.floor(Math.random() * pool.length)];
          if (!randomEntry) return overlay;
          const randomText = getTextBankText(randomEntry) || overlay.text;
          const randomStyle = getTextBankStyle(randomEntry);
          const baseStyle = overlay.style || { fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: '700', color: '#ffffff', textAlign: 'center' };
          return {
            ...overlay,
            text: randomText,
            style: randomStyle ? { ...baseStyle, ...randomStyle } : baseStyle,
            position: overlay.position || { x: 50, y: 50, width: 80 }
          };
        });
        return { ...slide, textOverlays: updatedOverlays };
      }));
    } catch (err) {
      console.error('[SlideshowEditor] Text reroll error:', err);
    }
  }, [selectedSlideIndex, getTextBanks]);

  // Audio playback controls - just add audio directly, user can trim later
  const handleSelectAudio = useCallback((audio) => {
    // Open the audio editor/trimmer for the selected track
    setAudioToTrim(audio);
    setShowAudioTrimmer(true);
  }, []);

  const handleAudioTrimSave = useCallback(async ({ startTime, endTime, duration, trimmedFile, trimmedName }) => {
    if (!audioToTrim) return;
    if (trimmedFile) {
      // Audio was actually trimmed to a new file — use blob immediately for responsiveness
      const localUrl = URL.createObjectURL(trimmedFile);
      const trimId = `audio_trim_${Date.now()}`;
      const editedAudio = {
        ...audioToTrim,
        id: trimId,
        name: trimmedName || trimmedFile.name,
        file: trimmedFile,
        url: localUrl,
        localUrl: localUrl,
        startTime: 0,
        endTime: duration,
        trimmedDuration: duration,
        isTrimmed: false,
        duration: duration
      };
      setSelectedAudio(editedAudio);
      setShowAudioTrimmer(false);
      setAudioToTrim(null);

      // Upload trimmed file to Firebase Storage + save to library in background
      if (db && artistId) {
        try {
          const { url: firebaseUrl, path: storagePath } = await uploadFile(trimmedFile, 'audio');
          const audioItem = {
            id: trimId,
            type: MEDIA_TYPES.AUDIO,
            name: trimmedName || trimmedFile.name,
            url: firebaseUrl,
            storagePath,
            duration: duration,
            metadata: {
              trimStart: 0,
              trimEnd: duration,
              originalName: audioToTrim.name,
              originalMediaId: audioToTrim.id
            }
          };
          await addToLibraryAsync(db, artistId, audioItem);
          // Update selectedAudio with the persistent Firebase URL so it survives page reloads
          setAllSlideshows(prev => prev.map((ss, i) =>
            i === activeSlideshowIndex && ss.audio?.id === trimId
              ? { ...ss, audio: { ...ss.audio, url: firebaseUrl, localUrl: firebaseUrl } }
              : ss
          ));
        } catch (err) {
          console.error('[SlideshowEditor] Failed to persist trimmed audio:', err);
        }
      }
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

  // When audio with linkedLyricsId is selected, surface linked lyrics
  const prevAudioIdRef = useRef(null);
  useEffect(() => {
    const audioId = selectedAudio?.id;
    if (audioId === prevAudioIdRef.current) return; // only on audio change
    prevAudioIdRef.current = audioId;
    const lyricLink = selectedAudio?.linkedLyricsId;
    if (lyricLink && lyrics.some(l => l.id === lyricLink)) {
      setLinkedLyricId(lyricLink);
      toastSuccess('Linked lyrics loaded with audio');
    } else {
      setLinkedLyricId(null);
    }
  }, [selectedAudio?.id, selectedAudio?.linkedLyricsId, lyrics]);

  // Use a ref for slides to avoid stale closures in the animation loop
  const slidesRef = useRef(slides);
  useEffect(() => { slidesRef.current = slides; }, [slides]);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current || !selectedAudioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      setIsPlaying(false);
    } else {
      // Don't try to play if audio hasn't loaded
      if (!audioReady) return;

      const audio = selectedAudioRef.current;
      const startBoundary = audio.startTime || 0;
      if (audioRef.current.currentTime < startBoundary || !isFinite(audioRef.current.currentTime)) {
        audioRef.current.currentTime = startBoundary;
      }

      // Cancel any existing animation frame before starting new loop
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      audioRef.current.play().then(() => {
        setIsPlaying(true);

        // Animation loop for time updates + slide auto-advance
        // Uses selectedAudioRef to always read the latest audio data without stale closures
        const updateTime = () => {
          if (!audioRef.current) return;
          // If audio was paused externally (e.g. by 'ended' event before our onEnded fires), check
          if (audioRef.current.paused && !isPlayingRef.current) return;

          const currentAudio = selectedAudioRef.current;
          if (!currentAudio) return;
          const startBound = currentAudio.startTime || 0;
          const rawDur = audioRef.current.duration;
          const endBound = (currentAudio.endTime && currentAudio.endTime > 0)
            ? currentAudio.endTime
            : (isFinite(rawDur) ? rawDur : 300);
          const actualTime = audioRef.current.currentTime;
          const elapsed = actualTime - startBound;

          setCurrentTime(Math.max(0, elapsed));

          // Auto-advance slides based on cumulative duration
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

          // Loop back if past end boundary — reset and ensure still playing
          if (isFinite(endBound) && actualTime >= endBound - 0.05) {
            audioRef.current.currentTime = startBound;
            // Ensure audio is still playing after seek (browser may have paused it)
            if (audioRef.current.paused && isPlayingRef.current) {
              audioRef.current.play().catch(() => {});
            }
          }

          animationRef.current = requestAnimationFrame(updateTime);
        };
        animationRef.current = requestAnimationFrame(updateTime);
      }).catch(err => {
        console.error('Audio playback failed:', err);
        setIsPlaying(false);
      });
    }
  }, [isPlaying, audioReady]);

  const handleRemoveAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setSelectedAudio(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
    setAudioReady(false);
    setAudioError(null);
    loadedAudioKeyRef.current = null;
  }, []);

  const handleApplyAudioToAll = useCallback(() => {
    if (!isMultiDraftMode || allSlideshows.length <= 1) return;
    const currentAudio = allSlideshows[activeSlideshowIndex]?.audio || null;
    setAllSlideshows(prev => prev.map((ss, i) =>
      i === activeSlideshowIndex ? ss : { ...ss, audio: currentAudio ? { ...currentAudio } : null }
    ));
  }, [isMultiDraftMode, allSlideshows, activeSlideshowIndex]);

  const handleRemoveAudioFromAll = useCallback(() => {
    if (!isMultiDraftMode || allSlideshows.length <= 1) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setSelectedAudio(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
    setAudioReady(false);
    setAudioError(null);
    loadedAudioKeyRef.current = null;
    setAllSlideshows(prev => prev.map(ss => ({ ...ss, audio: null })));
  }, [isMultiDraftMode, allSlideshows.length]);

  // Load audio when selected — use a stable key to avoid reloading on unrelated re-renders
  // selectedAudio is derived from allSlideshows and gets a new reference on every slide edit,
  // so we track the actual audio identity via a key and only reload when it truly changes.
  const loadedAudioKeyRef = useRef(null);
  const selectedAudioRef = useRef(selectedAudio);
  selectedAudioRef.current = selectedAudio; // Always keep ref current for closures
  isPlayingRef.current = isPlaying; // Always keep playing ref current for closures

  const selectedAudioId = selectedAudio?.id || null;
  // Recover blob URLs that expired on page reload — look up real URL from library
  const selectedAudioUrl = (() => {
    const url = selectedAudio?.url || selectedAudio?.localUrl || null;
    if (!url) return null;
    // If it's a blob URL, check if it's still valid by trying to find the audio in library
    if (url.startsWith('blob:') && selectedAudioId && libraryAudio.length > 0) {
      const libItem = libraryAudio.find(a => a.id === selectedAudioId);
      if (libItem?.url && !libItem.url.startsWith('blob:')) return libItem.url;
    }
    return url;
  })();
  const selectedAudioStart = selectedAudio?.startTime || 0;
  const selectedAudioEnd = selectedAudio?.endTime || null;

  useEffect(() => {
    const el = audioRef.current;
    if (!selectedAudioUrl || !el) {
      loadedAudioKeyRef.current = null;
      setAudioReady(false);
      if (selectedAudio && !selectedAudioUrl) {
        setAudioError('Audio file unavailable');
      }
      return;
    }

    // Build a stable key — only reload when audio actually changes
    const audioKey = `${selectedAudioId}|${selectedAudioUrl}|${selectedAudioStart}|${selectedAudioEnd || ''}`;
    if (loadedAudioKeyRef.current === audioKey) return; // Same audio, skip reload
    loadedAudioKeyRef.current = audioKey;

    // Stop any current playback
    el.pause();
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioReady(false);
    setAudioError(null);

    // Define event handlers
    const onLoadedMetadata = () => {
      if (!audioRef.current) return;
      const start = selectedAudioStart;
      const rawDuration = audioRef.current.duration;
      const end = (selectedAudioEnd && selectedAudioEnd > 0)
        ? selectedAudioEnd
        : (isFinite(rawDuration) ? rawDuration : 0);
      log('[Audio] loadedmetadata:', { rawDuration, start, end, computedDuration: Math.max(0, end - start) });
      setAudioDuration(Math.max(0, end - start));
      audioRef.current.currentTime = start;
    };

    const onCanPlayThrough = () => {
      log('[Audio] canplaythrough fired');
      setAudioReady(true);
      setAudioError(null);
    };

    const onCanPlay = () => {
      // Fallback: some browsers fire canplay but not canplaythrough
      log('[Audio] canplay fired, readyState:', el.readyState);
      if (el.readyState >= 3) { // HAVE_FUTURE_DATA or better
        setAudioReady(true);
        setAudioError(null);
      }
    };

    const onError = () => {
      const errMsg = el.error?.message || 'Failed to load audio';
      console.error('[Audio] load error:', el.error, errMsg);
      setAudioError(errMsg);
      setAudioReady(false);
    };

    const onEnded = () => {
      // When audio reaches its natural end, browser pauses it.
      // If we're supposed to be looping, restart playback from startBound.
      if (isPlayingRef.current && audioRef.current) {
        audioRef.current.currentTime = selectedAudioStart;
        audioRef.current.play().catch(() => {});
      }
    };

    // CRITICAL: Add event listeners BEFORE setting src and calling load().
    // If the browser has this audio cached, events can fire nearly instantly.
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('canplaythrough', onCanPlayThrough);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('error', onError);
    el.addEventListener('ended', onEnded);

    // Now set source and start loading
    log('[Audio] Setting src:', selectedAudioUrl?.substring(0, 100));
    el.src = selectedAudioUrl;
    el.preload = 'auto';
    el.load();

    // Safety fallback: if readyState is already sufficient (e.g. cached audio),
    // events may have fired before React committed this effect. Check immediately.
    const quickCheck = setTimeout(() => {
      if (el.readyState >= 2 && el.duration > 0) {
        log('[Audio] Fallback: already loaded, readyState:', el.readyState);
        onLoadedMetadata();
        setAudioReady(true);
        setAudioError(null);
      }
    }, 100);

    // Timeout fallback: if audio hasn't loaded after 10s, mark as ready anyway
    // (prevents infinite "Loading..." state for slow/unreachable URLs)
    const loadTimeout = setTimeout(() => {
      if (!audioRef.current) return;
      if (audioRef.current.readyState >= 1) {
        log('[Audio] Timeout fallback: marking ready at readyState', audioRef.current.readyState);
        setAudioReady(true);
      } else {
        log('[Audio] Timeout: audio failed to load within 10s');
        setAudioError('Audio took too long to load');
      }
    }, 10000);

    return () => {
      clearTimeout(quickCheck);
      clearTimeout(loadTimeout);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('canplaythrough', onCanPlayThrough);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('error', onError);
      el.removeEventListener('ended', onEnded);
    };
  }, [selectedAudioId, selectedAudioUrl, selectedAudioStart, selectedAudioEnd]);

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
        ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] }
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
            textOverlays: (slide.textOverlays || []).map(overlay =>
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
            textOverlays: (slide.textOverlays || []).filter(o => o.id !== overlayId)
          }
        : slide
    ));
    setEditingTextId(null);
  }, [selectedSlideIndex]);

  // Handle click on text overlay to edit
  const handleTextClick = useCallback((e, overlayId) => {
    e.stopPropagation();
    setEditingTextId(overlayId);
  }, []);

  // Handle click on slide image — deselect text if clicking canvas background
  const handleSlideClick = useCallback(() => {
    // Clicking the canvas background deselects text
    setEditingTextId(null);
  }, []);

  // Text overlay drag handlers — move text freely on the canvas
  const handleTextMouseDown = useCallback((e, overlayId) => {
    e.preventDefault();
    e.stopPropagation();
    const overlay = currentSlide?.textOverlays?.find(o => o.id === overlayId);
    if (!overlay) return;
    setDraggingTextId(overlayId);
    setEditingTextId(overlayId);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startPosX: overlay.position.x,
      startPosY: overlay.position.y
    };
  }, [currentSlide]);

  useEffect(() => {
    if (!draggingTextId) return;

    const handleMouseMove = (e) => {
      if (!dragStartRef.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      // Convert pixel delta to percentage of canvas
      const newX = Math.max(5, Math.min(95, dragStartRef.current.startPosX + (dx / rect.width) * 100));
      const newY = Math.max(5, Math.min(95, dragStartRef.current.startPosY + (dy / rect.height) * 100));

      setSlides(prev => prev.map((slide, idx) => {
        if (idx !== selectedSlideIndex) return slide;
        return {
          ...slide,
          textOverlays: (slide.textOverlays || []).map(o =>
            o.id === draggingTextId
              ? { ...o, position: { ...o.position, x: newX, y: newY } }
              : o
          )
        };
      }));
    };

    const handleMouseUp = () => {
      setDraggingTextId(null);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingTextId, selectedSlideIndex]);

  // Text overlay resize handler (corner handle drag)
  useEffect(() => {
    if (!resizingTextId) return;

    const handleMouseMove = (e) => {
      if (!resizeStartRef.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const dx = e.clientX - resizeStartRef.current.mouseX;
      const newWidth = Math.max(15, Math.min(100, resizeStartRef.current.startWidth + (dx / rect.width) * 100));

      setSlides(prev => prev.map((slide, idx) => {
        if (idx !== selectedSlideIndex) return slide;
        return {
          ...slide,
          textOverlays: (slide.textOverlays || []).map(o =>
            o.id === resizingTextId
              ? { ...o, position: { ...o.position, width: newWidth } }
              : o
          )
        };
      }));
    };

    const handleMouseUp = () => {
      setResizingTextId(null);
      resizeStartRef.current = null;
      pushHistory(slides);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingTextId, selectedSlideIndex]);

  // State for showing "save to bank" option after transcription
  const [transcribedLyrics, setTranscribedLyrics] = useState(null);

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
          ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] }
          : slide
      ));
      setEditingTextId(newOverlay.id);
      // Text editor is now inline — editingTextId activates it

      // Auto-save transcribed lyrics to lyric bank (no popup)
      setTranscribedLyrics(result.text);
      const lyricId = `lyric_${Date.now()}`;
      if (onAddLyrics) {
        const title = selectedAudio?.name || 'Transcribed Lyrics';
        handleAddLyricsAndRefresh({
          id: lyricId,
          title: title.replace(/\.[^/.]+$/, ''),
          content: result.text,
          createdAt: new Date().toISOString()
        });
      }
      // Link the lyric to the audio so lyrics travel with audio
      if (selectedAudio?.id && artistId) {
        updateLibraryItem(artistId, selectedAudio.id, { linkedLyricsId: lyricId });
        // Update the in-memory audio object so the link persists this session
        setSelectedAudio({ ...selectedAudio, linkedLyricsId: lyricId });
      }
    }
    setShowLyricAnalyzer(false);
  }, [selectedSlideIndex]);


  // Handle audio file upload in slideshow editor - converts to MP3 if needed, then opens trimmer
  const handleSlideshowAudioUpload = useCallback(async (e) => {
    const rawFile = e.target.files?.[0];
    if (rawFile) {
      const { convertAudioIfNeeded } = await import('../../utils/audioConverter');
      const file = await convertAudioIfNeeded(rawFile);
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
      setAudioToTrim(audioObj);
      setShowAudioTrimmer(true);
    }
    e.target.value = '';
  }, []);

  // Save active slideshow only (does NOT close editor so user can keep editing other timelines)
  const handleSave = useCallback(async () => {
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
      updatedAt: new Date().toISOString(),
      ...(activePipeline ? { collectionId: activePipeline.id, collectionName: activePipeline.name } : {})
    };
    await onSave?.(slideshowData);
    toastSuccess(`Saved "${activeSlideshow.name}"`);
  }, [allSlideshows, activeSlideshowIndex, aspectRatio, existingSlideshow, onSave, activePipeline]);

  // Save all slideshows and close
  const handleSaveAllAndClose = useCallback(async () => {
    for (const ss of allSlideshows) {
      const slideshowData = {
        id: ss.isTemplate ? (existingSlideshow?.id || `slideshow_${Date.now()}`) : ss.id,
        name: ss.name,
        aspectRatio,
        slides: ss.slides,
        audio: ss.audio,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(activePipeline ? { collectionId: activePipeline.id, collectionName: activePipeline.name } : {})
      };
      try {
        await onSave?.(slideshowData);
      } catch (err) {
        console.error(`[SlideshowEditor] Failed to save "${ss.name}":`, err);
        return; // Stop on failure
      }
    }
    onClose?.();
  }, [allSlideshows, aspectRatio, existingSlideshow, onSave, onClose]);

  // Apply template text styles to ALL generated slideshows (retroactive)
  const handleApplyTemplateToAll = useCallback(() => {
    if (allSlideshows.length <= 1) return;
    const template = allSlideshows[0];
    if (!template?.slides?.length) return;

    // Extract text styles from template slides
    const templateStyles = template.slides.map(slide =>
      (slide.textOverlays || []).map(o => ({ ...o.style }))
    );

    setAllSlideshows(prev => prev.map((ss, ssIdx) => {
      if (ssIdx === 0) return ss; // Skip template itself
      return {
        ...ss,
        slides: ss.slides.map((slide, slideIdx) => {
          const tStyles = templateStyles[slideIdx % templateStyles.length] || [];
          return {
            ...slide,
            textOverlays: (slide.textOverlays || []).map((overlay, oIdx) => {
              const tStyle = tStyles[oIdx % Math.max(tStyles.length, 1)];
              if (!tStyle) return overlay;
              return { ...overlay, style: { ...overlay.style, ...tStyle } };
            })
          };
        })
      };
    }));
    toastSuccess(`Applied template styles to ${allSlideshows.length - 1} slideshows`);
  }, [allSlideshows, toastSuccess]);

  // Switch active slideshow (timeline)
  const switchToSlideshow = useCallback((index) => {
    if (index === activeSlideshowIndex) return;
    // Check if new tab has the same audio — if so, skip audio reset to avoid stuck "Loading..."
    const newAudio = allSlideshows[index]?.audio;
    const newUrl = newAudio?.url || newAudio?.localUrl || null;
    const newKey = newAudio ? `${newAudio.id || ''}|${newUrl}|${newAudio.startTime || 0}|${newAudio.endTime || ''}` : null;
    const sameAudio = newKey && loadedAudioKeyRef.current === newKey;
    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    setIsPlaying(false);
    setCurrentTime(0);
    if (!sameAudio) {
      setAudioReady(false);
      setAudioError(null);
      loadedAudioKeyRef.current = null; // Force reload for new slideshow's audio
    }
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
  }, [activeSlideshowIndex, allSlideshows]);

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
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Core generation logic (called after any prompts are resolved)
  const executeGeneration = useCallback(() => {
    const templateSS = allSlideshows[0];
    if (!templateSS || templateSS.slides.length === 0) return;

    setIsGenerating(true);

    try {
      // Gather image banks — respect selectedSource dropdown
      // If a specific collection is selected, only pull from that collection's banks
      const sourceColId = selectedSource.includes(':') ? selectedSource.split(':')[0] : null;
      const sourceCollections = sourceColId
        ? collections.filter(c => c.id === sourceColId)
        : collections;

      // Start with category banks
      const numBanks = Math.max(categoryBankImages.length, 2);
      const allBankImages = Array.from({ length: numBanks }, (_, idx) => [...(categoryBankImages[idx] || [])]);
      if (sourceCollections.length > 0) {
        for (const col of sourceCollections) {
          const migrated = migrateCollectionBanks(col);
          const banks = migrated.banks || [];
          for (let idx = 0; idx < banks.length; idx++) {
            const bankIds = banks[idx] || [];
            if (bankIds.length > 0) {
              while (allBankImages.length <= idx) allBankImages.push([]);
              allBankImages[idx] = [...allBankImages[idx], ...libraryImages.filter(img => bankIds.includes(img.id))];
            }
          }
        }
      }

      const hasAnyImages = allBankImages.some(bank => bank.length > 0);
      if (!hasAnyImages) {
        toastError('No images in banks. Add images to your slide banks first.');
        return;
      }

      // Gather text banks
      const textBanks = getTextBanks();

      // Current count of generated slideshows (for naming)
      const existingGenCount = allSlideshows.filter(ss => !ss.isTemplate).length;
      const timestamp = Date.now();

      const generated = [];
      for (let i = 0; i < generateCount; i++) {
        const newSlides = [];

        // Mirror template structure — same number of slides
        for (let s = 0; s < templateSS.slides.length; s++) {
          const templateSlide = templateSS.slides[s];

          // Pick random image from the bank matching this slide's position (cycles through available banks)
          const bankIdx = s % allBankImages.length;
          const bank = allBankImages[bankIdx] || [];
          const randomImg = bank.length > 0 ? bank[Math.floor(Math.random() * bank.length)] : null;

          // Copy text overlays from template — keep styling + position, cycle text content
          // keepTemplateText: 'none' = pull from banks, 'all' = keep all, Set<number> = keep specific slides
          const templateOverlays = templateSlide.textOverlays || [];
          const slideTBank = textBanks[s] || textBanks[0] || [];
          const shouldKeepText =
            templateSlide.keepText === true ||
            keepTemplateText === 'all' ||
            (keepTemplateText instanceof Set && keepTemplateText.has(s));
          if (i === 0 && s === 0) {
            log('[SlideshowGen] Template slide 0 has', templateOverlays.length, 'text overlays, textBank has', slideTBank.length, 'entries, keepText:', keepTemplateText);
          }
          const newTextOverlays = templateOverlays.map((overlay, textIdx) => {
            let newText = overlay.text; // Default: keep template text
            let bankStyle = null;
            if (!shouldKeepText && slideTBank.length > 0) {
              // Cycle: use both generation index AND overlay index for variety
              // generation 0 overlay 0 → bank[0], generation 0 overlay 1 → bank[1], etc.
              const bankIndex = (i * Math.max(templateOverlays.length, 1) + textIdx) % slideTBank.length;
              const bankEntry = slideTBank[bankIndex];
              newText = getTextBankText(bankEntry);
              bankStyle = getTextBankStyle(bankEntry);
            }
            return {
              ...overlay,
              id: `text_${timestamp}_${i}_${s}_${textIdx}`,
              text: newText,
              // If bank entry has stored style, merge it on top of template style
              ...(bankStyle ? { style: { ...overlay.style, ...bankStyle } } : {})
            };
          });

          newSlides.push({
            id: `slide_${timestamp}_${i}_${s}`,
            index: s,
            backgroundImage: randomImg?.url || randomImg?.localUrl || null,
            thumbnail: randomImg?.url || randomImg?.localUrl || null,
            sourceBank: `image${bankIdx}`,
            sourceImageId: randomImg?.id || null,
            textOverlays: newTextOverlays,
            duration: templateSlide.duration || 3,
            imageTransform: { scale: 1, offsetX: 0, offsetY: 0 }
          });
        }

        generated.push({
          id: `slideshow_${timestamp}_gen_${i}`,
          name: activePipeline ? `${activePipeline.name} #${existingGenCount + i + 1}` : `Generated ${existingGenCount + i + 1}`,
          slides: newSlides,
          audio: templateSS.audio, // Inherit template audio
          isTemplate: false,
          ...(activePipeline ? { collectionId: activePipeline.id, collectionName: activePipeline.name } : {})
        });
      }

      setAllSlideshows(prev => [...prev, ...generated]);
      toastSuccess(`Generated ${generated.length} slideshows!`);
    } finally {
      setIsGenerating(false);
    }
  }, [allSlideshows, generateCount, category, collections, libraryImages, getTextBanks, keepTemplateText]);

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

      log('[Export] Complete:', images);
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

      // Slideshows go to TikTok as draft only
      if (!accountMapping.tiktok) {
        toastError('No TikTok account linked to this handle');
        setIsScheduling(false);
        return;
      }
      const platformsArray = [{
        platform: 'tiktok',
        accountId: accountMapping.tiktok
      }];

      // Schedule as carousel (array of image URLs)
      const result = await onSchedulePost({
        platforms: platformsArray,
        caption: fullCaption,
        type: 'carousel',
        images: exportedImages.map(img => ({ url: img.url })),
        scheduledFor: scheduledFor.toISOString()
      });

      if (result?.success === false) {
        toastError(`Failed to schedule: ${result.error || 'Unknown error'}`);
        return;
      }

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

  // Collapsible sidebar sections state
  // Preview-only crop overlay — does NOT change actual export aspect ratio
  const [previewCropRatio, setPreviewCropRatio] = useState(null);

  const [openSections, setOpenSections] = useState({
    source: true,
    audio: false,
    textStyle: false,
    textBanks: true,
    slideBanks: true,
    lyrics: false
  });

  const toggleSection = useCallback((key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const renderCollapsibleSection = (key, title, content, icon) => (
    <div className="border-b border-neutral-200">
      <button
        onClick={() => toggleSection(key)}
        className="w-full flex items-center justify-between px-6 py-3 bg-transparent border-none text-white text-heading-3 font-heading-3 cursor-pointer"
      >
        <span>{title}</span>
        <FeatherChevronDown className={`w-4 h-4 text-neutral-500 flex-shrink-0 transition-transform duration-150 ${openSections[key] ? 'rotate-180' : ''}`} />
      </button>
      {openSections[key] && (
        <div className="px-6 pb-4">
          {content}
        </div>
      )}
    </div>
  );

  // ─── Render: Top Bar ───
  const renderTopBar = () => (
    <header className={`flex items-center justify-between border-b border-neutral-200 bg-black ${isMobile ? 'px-4 py-3 flex-wrap gap-2' : 'px-6 py-3'}`}>
      {!isMobile && (
        <Button
          variant="neutral-secondary"
          size="small"
          icon={<FeatherArrowLeft />}
          onClick={onClose}
          className="mr-2"
        >
          Back
        </Button>
      )}
      <div className={`flex-1 ${isMobile ? 'order-1' : ''}`}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`bg-transparent border-none text-white font-semibold outline-none ${isMobile ? 'w-full text-base' : 'text-lg w-[300px]'}`}
          placeholder="Slideshow name..."
        />
      </div>

      {!isMobile && (
        <div className="flex items-center gap-4">
          <ToggleGroup
            value={previewCropRatio || aspectRatio}
            onValueChange={(val) => setPreviewCropRatio(prev => prev === val ? null : val)}
          >
            <ToggleGroup.Item icon={null} value="9:16">9:16</ToggleGroup.Item>
            <ToggleGroup.Item icon={null} value="4:5">4:5</ToggleGroup.Item>
            <ToggleGroup.Item icon={null} value="4:3">4:3</ToggleGroup.Item>
          </ToggleGroup>
        </div>
      )}

      <div className={`flex items-center ${isMobile ? 'order-2 gap-2' : 'gap-3'}`}>
        <Button
          variant="brand-primary"
          icon={isExporting ? null : <FeatherDownload />}
          loading={isExporting}
          onClick={handleExport}
          disabled={isExporting || slides.filter(s => s.backgroundImage).length === 0}
          className={isMobile ? 'px-4 py-2.5' : ''}
        >
          {isExporting ? `Exporting ${exportProgress}%` : 'Export'}
        </Button>
        {!isMobile && (
          <>
            {!schedulerEditMode && allSlideshows.length > 1 && (
              <Button
                variant="brand-primary"
                onClick={handleSaveAllAndClose}
                className="bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] hover:from-[#818cf8] hover:to-[#a78bfa]"
              >
                Save All ({allSlideshows.length})
              </Button>
            )}
            <Button
              variant="brand-primary"
              onClick={handleSave}
              className="bg-[#059669] hover:bg-[#047857]"
            >
              {schedulerEditMode ? 'Save' : 'Save Draft'}
            </Button>
          </>
        )}
        <IconButton
          variant="neutral-secondary"
          size={isMobile ? 'large' : 'medium'}
          icon={<FeatherX />}
          onClick={onClose}
        />
      </div>
    </header>
  );

  // ─── Render: Draft Tabs Bar ───
  const renderDraftTabsBar = () => {
    if (allSlideshows.length <= 1 && !isMultiDraftMode) return null;
    return (
      <div className="border-b border-neutral-200 px-4 py-1.5 bg-black flex-shrink-0">
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
          {allSlideshows.map((show, idx) => (
            <div
              key={show.id}
              onClick={() => switchToSlideshow(idx)}
              className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer transition-all whitespace-nowrap text-[11px] border ${
                idx === activeSlideshowIndex
                  ? 'bg-brand-600 border-brand-700 text-white font-semibold'
                  : 'bg-neutral-50 border-neutral-100 text-neutral-500 hover:bg-neutral-100'
              }`}
            >
              {show.isTemplate ? (
                <FeatherLayout className="w-3 h-3" />
              ) : (
                <span className="text-[10px] opacity-60">#{idx}</span>
              )}
              <span>{show.isTemplate ? 'Template' : show.name || `Slideshow ${idx}`}</span>
              {!show.isTemplate && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSlideshow(idx); }}
                  className={`bg-transparent border-none cursor-pointer pl-1 text-sm leading-none flex items-center ${
                    idx === activeSlideshowIndex ? 'text-white/70 hover:text-white' : 'text-white/30 hover:text-white/60'
                  }`}
                  title="Delete this slideshow"
                >&times;</button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ─── Render: Canvas Preview ───
  const renderCanvasPreview = () => (
    <div
      className={`flex flex-col items-center justify-center ${isMobile ? 'p-4' : ''}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        ref={previewRef}
        className="bg-neutral-0 rounded-lg overflow-hidden relative shadow-lg flex-shrink-0 border border-neutral-200"
        style={{
          width: isMobile ? Math.min(window.innerWidth - 32, canvasSize.width) : canvasSize.width,
          height: isMobile ? Math.min((window.innerWidth - 32) * (baseDimensions.height / baseDimensions.width), canvasSize.height) : canvasSize.height
        }}
      >
        {/* Background Image */}
        {currentSlide?.backgroundImage ? (
          <>
            <img
              src={currentSlide.backgroundImage}
              alt="Slide background"
              style={{
                position: 'absolute', width: '100%', height: '100%', objectFit: 'cover',
                transform: `scale(${(currentSlide.imageTransform?.scale || 1)}) translate(${(currentSlide.imageTransform?.offsetX || 0)}px, ${(currentSlide.imageTransform?.offsetY || 0)}px)`,
                transformOrigin: 'center center',
                cursor: isDraggingImage ? 'grabbing' : 'grab',
                userSelect: 'none', pointerEvents: 'auto', zIndex: 1
              }}
              onMouseDown={handleImageMouseDown}
              draggable={false}
            />
            <div
              onMouseDown={handleResizeMouseDown}
              style={{
                position: 'absolute', bottom: 4, right: 4, width: 20, height: 20,
                cursor: 'nwse-resize', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 4, backgroundColor: 'rgba(99, 102, 241, 0.8)', border: '1px solid rgba(255,255,255,0.5)'
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
                <path d="M9 1v8H1" fill="none" stroke="white" strokeWidth="1.5"/>
                <path d="M6 4v5H1" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5"/>
              </svg>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-neutral-500 gap-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
            <p>Drag an image here</p>
          </div>
        )}

        {/* Crop Overlay — preview only, does not change export */}
        {previewCropRatio && previewCropRatio !== aspectRatio && (() => {
          const baseAR = baseDimensions.width / baseDimensions.height;
          const [tw, th] = previewCropRatio.split(':').map(Number);
          const targetAR = tw / th;
          const visibleFraction = baseAR / targetAR;
          if (visibleFraction >= 1) return null; // no crop needed
          const cropBarPct = ((1 - visibleFraction) / 2 * 100).toFixed(2);
          return (
            <>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                height: `${cropBarPct}%`,
                backgroundColor: 'rgba(0, 0, 0, 0.5)', borderBottom: '2px dashed rgba(255, 255, 255, 0.4)',
                pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8
              }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cropped</span>
              </div>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${cropBarPct}%`,
                backgroundColor: 'rgba(0, 0, 0, 0.5)', borderTop: '2px dashed rgba(255, 255, 255, 0.4)',
                pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8
              }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cropped</span>
              </div>
            </>
          );
        })()}

        {/* Text Overlays */}
        {(currentSlide?.textOverlays || []).map(overlay => {
          const isSelected = editingTextId === overlay.id;
          const isDragging = draggingTextId === overlay.id;
          return (
            <div
              key={overlay.id}
              style={{
                position: 'absolute', userSelect: 'none', zIndex: 5,
                left: `${overlay.position.x}%`, top: `${overlay.position.y}%`,
                transform: 'translate(-50%, -50%)',
                width: `${overlay.position.width || 80}%`,
                fontSize: `${overlay.style.fontSize * previewScale}px`,
                fontFamily: overlay.style.fontFamily, fontWeight: overlay.style.fontWeight,
                color: overlay.style.color, textAlign: overlay.style.textAlign,
                textTransform: overlay.style.textTransform || 'none',
                WebkitTextStroke: overlay.style.textStroke || undefined,
                textShadow: overlay.style.outline ? `0 0 ${4 * previewScale}px ${overlay.style.outlineColor}` : 'none',
                cursor: isDragging ? 'grabbing' : 'grab',
                border: isSelected ? '1px dashed rgba(99,102,241,0.8)' : '1px dashed transparent',
                padding: '4px 8px', borderRadius: '4px',
                transition: isDragging ? 'none' : 'border-color 0.15s',
                backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : 'transparent',
                boxSizing: 'border-box', overflow: 'hidden', wordBreak: 'break-word', whiteSpace: 'pre-wrap'
              }}
              onMouseDown={(e) => handleTextMouseDown(e, overlay.id)}
              onClick={(e) => { e.stopPropagation(); handleTextClick(e, overlay.id); }}
            >
              {overlay.text}
              {isSelected && (
                <>
                  <div style={{
                    position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)',
                    fontSize: '8px', color: 'rgba(163,180,252,0.9)', whiteSpace: 'nowrap',
                    backgroundColor: 'rgba(30,30,40,0.85)', padding: '1px 5px', borderRadius: '3px',
                    pointerEvents: 'none'
                  }}>drag to move</div>
                  <div
                    style={{
                      position: 'absolute', right: '-4px', top: '50%', transform: 'translateY(-50%)',
                      width: '8px', height: '24px', backgroundColor: 'rgba(99,102,241,0.8)',
                      borderRadius: '3px', cursor: 'ew-resize', zIndex: 5
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setResizingTextId(overlay.id);
                      resizeStartRef.current = { mouseX: e.clientX, startWidth: overlay.position.width || 80 };
                    }}
                    title="Drag to resize width"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
    </div>
  );

  // ─── Render: Audio Player Bar ───
  const renderAudioPlayerBar = () => {
    if (!selectedAudio) return null;
    return (
      <div className="flex items-center gap-2 px-4 py-2 border-t border-neutral-200 bg-neutral-50 flex-shrink-0">
        <IconButton
          variant="neutral-secondary"
          size="small"
          icon={
            !audioReady && !audioError ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
              </svg>
            ) : isPlaying ? <FeatherPause /> : <FeatherPlay />
          }
          onClick={handlePlayPause}
          disabled={!audioReady || !!audioError}
          className={audioError ? '!bg-error-600' : ''}
        />
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-xs text-white truncate">
            {audioError ? 'Audio failed to load' : selectedAudio.name}
          </span>
          <span className="text-[10px] text-neutral-400 font-mono">
            {!audioReady && !audioError ? 'Loading...' : `${formatTime(currentTime)} / ${formatTime(audioDuration)}`}
          </span>
        </div>
        <div className="flex-1 h-1 rounded-full bg-neutral-200 min-w-[60px]">
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0}%` }} />
        </div>
        <Button variant="neutral-tertiary" size="small" icon={<FeatherScissors />}
          onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}
        >Trim</Button>
        {isMultiDraftMode && allSlideshows.length > 1 && (
          <Button variant="brand-tertiary" size="small" onClick={handleApplyAudioToAll}>Apply to All</Button>
        )}
        <Button variant="destructive-tertiary" size="small" icon={<FeatherTrash2 />} onClick={handleRemoveAudio}>Remove</Button>
        {isMultiDraftMode && allSlideshows.length > 1 && (
          <Button variant="destructive-tertiary" size="small" onClick={handleRemoveAudioFromAll}>Remove All</Button>
        )}
      </div>
    );
  };

  // ─── Render: Canvas Actions ───
  // ─── Render: Slide Navigation Row ───
  const renderSlideNavRow = () => (
    <div className="flex items-center gap-2 px-4 py-1.5 border-t border-neutral-200 flex-shrink-0">
      {/* Slide navigation */}
      <IconButton
        variant="neutral-secondary"
        size="small"
        icon={<FeatherChevronLeft />}
        onClick={() => setSelectedSlideIndex(Math.max(0, selectedSlideIndex - 1))}
        disabled={selectedSlideIndex === 0}
      />
      <span className="text-[13px] text-neutral-500 whitespace-nowrap font-medium">
        Slide {selectedSlideIndex + 1} of {slides.length}
      </span>
      <IconButton
        variant="neutral-secondary"
        size="small"
        icon={<FeatherChevronRight />}
        onClick={() => setSelectedSlideIndex(Math.min(slides.length - 1, selectedSlideIndex + 1))}
        disabled={selectedSlideIndex === slides.length - 1}
      />

      <div className="w-px h-5 bg-neutral-200" />

      {/* Re-roll Image */}
      {currentSlide?.backgroundImage && (
        <Button
          variant="neutral-secondary"
          size="small"
          icon={<FeatherRefreshCw />}
          onClick={handleReroll}
          disabled={getRerollBank().filter(img => img.id !== currentSlide?.sourceImageId).length === 0}
        >
          Re-roll Image
        </Button>
      )}

      {/* Re-roll Text */}
      {currentSlide?.textOverlays?.length > 0 && (() => {
        const tBanks = getTextBanks();
        const hasTextBanks = tBanks.some(b => b?.length > 0);
        return hasTextBanks ? (
          <Button
            variant="neutral-secondary"
            size="small"
            icon={<FeatherRefreshCw />}
            onClick={() => handleTextReroll()}
          >
            Re-roll Text
          </Button>
        ) : null;
      })()}

      <div className="flex-1" />

      {/* Add Text */}
      <Button
        variant="brand-secondary"
        size="small"
        icon={<FeatherPlus />}
        onClick={() => { addTextOverlay(); }}
      >
        Add Text
      </Button>

      {/* Delete Slide */}
      {slides.length > 1 && (
        <Button
          variant="destructive-secondary"
          size="small"
          icon={<FeatherTrash2 />}
          onClick={() => removeSlide(slides[selectedSlideIndex]?.id)}
        >
          Delete
        </Button>
      )}
    </div>
  );

  // ─── Render: Inline Text Editor ───
  const renderInlineTextEditor = () => {
    if (!editingTextId || !currentSlide) return null;
    const selOverlay = currentSlide.textOverlays?.find(o => o.id === editingTextId);
    if (!selOverlay) return null;
    return (
      <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-2.5 flex gap-2 items-start flex-shrink-0">
        <textarea
          rows={2}
          value={selOverlay.text}
          onChange={(e) => updateTextOverlay(selOverlay.id, { text: e.target.value })}
          placeholder="Enter text..."
          className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-200 bg-neutral-0 text-white text-[13px] outline-none resize-y font-[inherit] leading-[1.4]"
        />
        <IconButton
          variant="destructive-secondary"
          size="small"
          icon={<FeatherTrash2 />}
          onClick={() => { removeTextOverlay(selOverlay.id); setEditingTextId(null); }}
          title="Delete text block"
        />
        <IconButton
          variant="neutral-tertiary"
          size="small"
          icon={<FeatherCheck />}
          onClick={() => setEditingTextId(null)}
          title="Done editing"
        />
        {/* Add to Bank */}
        <div className="relative">
          <Button variant="brand-secondary" size="small" icon={<FeatherPlus />} onClick={() => setShowAddToBankPicker(prev => !prev)} title="Save styled text to a text bank">Bank</Button>
          {showAddToBankPicker && (() => {
            const banks = getTextBanks();
            const bankCount = Math.max(banks.length, 2);
            return (
              <div className="absolute top-full right-0 mt-1 z-20 bg-neutral-50 border border-neutral-200 rounded-md p-1 min-w-[120px] shadow-lg">
                {Array.from({ length: bankCount }, (_, i) => (
                  <button key={i}
                    onClick={() => {
                      const styledEntry = { text: selOverlay.text, style: { ...selOverlay.style } };
                      handleAddToTextBank(i + 1, styledEntry);
                      setShowAddToBankPicker(false);
                      toastSuccess(`Added to ${bankLabel(i)} Text bank`);
                    }}
                    className="block w-full px-2 py-1.5 border-none bg-transparent text-[11px] cursor-pointer rounded text-left hover:bg-white/[0.08]"
                    style={{ color: getBankColor(i).light }}
                  >
                    {bankLabel(i)} Text
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  // ─── Render: Filmstrip ───
  const renderFilmstrip = () => (
    <div className="flex flex-row items-center gap-2 border-t border-neutral-200 px-4 py-1.5 flex-shrink-0">
      {/* Undo / Redo */}
      <div className="flex gap-1 flex-shrink-0">
        <IconButton variant="neutral-tertiary" size="small"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H3"/><path d="M7 6l-4 4 4 4"/></svg>}
          onClick={handleUndo} disabled={!canUndo}
        />
        <IconButton variant="neutral-tertiary" size="small"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10H11a5 5 0 00-5 5v0a5 5 0 005 5h10"/><path d="M17 6l4 4-4 4"/></svg>}
          onClick={handleRedo} disabled={!canRedo}
        />
      </div>

      {/* Filmstrip thumbnails */}
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <div
          className="flex gap-1.5 overflow-x-auto pb-0.5"
          onDragOver={handleFilmstripDragOver}
          onDragLeave={handleFilmstripDragLeave}
          onDrop={handleFilmstripDrop}
        >
          {slides.map((slide, index) => (
            <React.Fragment key={slide.id}>
              {filmstripDropIndex === index && (
                <div className="w-[3px] min-w-[3px] h-20 bg-brand-600 rounded-sm flex-shrink-0 shadow-[0_0_8px_rgba(99,102,241,0.6)] mx-0.5" />
              )}
              <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                <div
                  data-filmstrip-slide="true"
                  className={`w-14 h-20 rounded-md overflow-hidden cursor-pointer flex-shrink-0 relative border-2 ${
                    index === selectedSlideIndex ? 'border-brand-600' : 'border-neutral-200'
                  }`}
                  style={{ backgroundColor: '#171717' }}
                  onClick={() => setSelectedSlideIndex(index)}
                >
                  {slide.backgroundImage ? (
                    <img src={slide.thumbnail || slide.backgroundImage} alt={`Slide ${index + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-300 text-lg font-semibold">{index + 1}</div>
                  )}
                  {/* Per-slide keep-text toggle */}
                  <button
                    className={`absolute bottom-0.5 left-0.5 w-[18px] h-[18px] rounded-[3px] cursor-pointer flex items-center justify-center p-0 z-[2] text-[9px] font-bold ${
                      slide.keepText
                        ? 'bg-brand-600/85 border border-brand-600/90 text-white'
                        : 'bg-black/50 border border-white/15 text-white/50'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSlides(prev => prev.map((s, i) => i === index ? { ...s, keepText: !s.keepText } : s));
                    }}
                    title={slide.keepText ? 'Keep text on generate (click to disable)' : 'Click to keep this slide\'s text on generate'}
                  >T</button>
                  {slides.length > 1 && (
                    <button
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-error-600/80 border-none text-white cursor-pointer flex items-center justify-center p-0 z-[2]"
                      onClick={(e) => { e.stopPropagation(); removeSlide(slide.id); }}
                      title="Remove slide"
                    >
                      <FeatherX className="w-2 h-2" />
                    </button>
                  )}
                </div>
                <span className={`text-[9px] font-medium ${index === selectedSlideIndex ? 'text-brand-600' : 'text-neutral-300'}`}>{index + 1}</span>
              </div>
            </React.Fragment>
          ))}
          {filmstripDropIndex === slides.length && (
            <div className="w-[3px] min-w-[3px] h-20 bg-brand-600 rounded-sm flex-shrink-0 shadow-[0_0_8px_rgba(99,102,241,0.6)] mx-0.5" />
          )}
          <button
            className="w-14 h-20 bg-neutral-50 border-2 border-dashed border-neutral-300 rounded-md cursor-pointer flex-shrink-0 flex items-center justify-center text-neutral-400 hover:border-neutral-400 transition-all"
            onClick={addSlide}
          >
            <FeatherPlus className="w-5 h-5" />
          </button>
        </div>
      </div>

      <span className="text-[11px] text-neutral-300 flex-shrink-0">{slides.length}/10</span>
    </div>
  );

  // ─── Render: Generation Controls ───
  const renderGenerationControls = () => {
    if (schedulerEditMode) return (
      <div className="px-4 py-1 text-[11px] text-neutral-400">Editing scheduled post</div>
    );
    if (isMultiDraftMode) return (
      <div className="px-4 py-1 text-[11px] text-brand-700 font-semibold">Editing {allSlideshows.length} drafts</div>
    );
    return (
      <div className="flex items-center gap-1.5 flex-wrap px-4 py-1.5 border-t border-neutral-200 flex-shrink-0">
        {/* Template quick-switch */}
        <Button
          variant={activeSlideshowIndex === 0 ? 'brand-primary' : 'neutral-secondary'}
          size="small"
          icon={<FeatherLayout />}
          onClick={() => switchToSlideshow(0)}
        >
          Template
        </Button>

        {/* Count */}
        <input
          type="number" min="1" max="100" value={generateCount}
          onChange={(e) => setGenerateCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
          className="w-11 px-1 py-1 rounded-md border border-neutral-200 bg-neutral-50 text-white text-xs text-center outline-none"
          title="Number of slideshows to generate"
        />

        {/* Keep text — multi-select: click individual slides to toggle */}
        <span className="text-[9px] text-neutral-500 font-semibold tracking-wider uppercase">Keep Text:</span>
        <div className="flex items-center gap-0 rounded-md bg-neutral-100 p-0.5">
          {slides.map((_, i) => {
            const isActive = keepTemplateText === 'all' || (keepTemplateText instanceof Set && keepTemplateText.has(i));
            return (
              <div key={`kt-${i}`}
                className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-md cursor-pointer select-none ${isActive ? 'bg-default-background text-white shadow-sm' : 'text-neutral-400 hover:text-white'}`}
                onClick={() => setKeepTemplateText(prev => {
                  if (prev === 'all') {
                    const s = new Set(slides.map((_, j) => j));
                    s.delete(i);
                    return s.size === 0 ? 'none' : s;
                  }
                  if (prev === 'none' || !(prev instanceof Set)) {
                    return new Set([i]);
                  }
                  const s = new Set(prev);
                  if (s.has(i)) { s.delete(i); return s.size === 0 ? 'none' : s; }
                  else { s.add(i); return s.size === slides.length ? 'all' : s; }
                })}
              >S{i + 1}</div>
            );
          })}
          <div className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-md cursor-pointer select-none ${keepTemplateText === 'all' ? 'bg-default-background text-white shadow-sm' : 'text-neutral-400 hover:text-white'}`}
            onClick={() => setKeepTemplateText('all')}
          >All</div>
          <div className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-md cursor-pointer select-none ${keepTemplateText === 'none' ? 'bg-default-background text-white shadow-sm' : 'text-neutral-400 hover:text-white'}`}
            onClick={() => setKeepTemplateText('none')}
          >Random</div>
        </div>

        {/* Generate */}
        <Button
          variant="brand-primary"
          size="small"
          icon={<FeatherPlus />}
          loading={isGenerating}
          onClick={handleGenerateMore}
          disabled={isGenerating}
          className="shadow-md shadow-brand-600/30"
        >
          {isGenerating ? 'Generating...' : 'Generate'}
        </Button>

        {allSlideshows.length > 1 && (
          <>
            <span className="text-[10px] text-neutral-400 whitespace-nowrap">{allSlideshows.length} total</span>
            <Button
              variant="neutral-secondary"
              size="small"
              icon={<FeatherCopy />}
              onClick={handleApplyTemplateToAll}
              className="ml-2"
            >
              Apply Style
            </Button>
          </>
        )}
      </div>
    );
  };

  // ─── Render: Sidebar Source ───
  const renderSidebarSource = () => (
    <div>
      <select
        value={selectedSource}
        onChange={(e) => setSelectedSource(e.target.value)}
        className="w-full px-2.5 py-1.5 rounded-md border border-neutral-200 bg-neutral-50 text-white text-xs outline-none cursor-pointer"
      >
        {collections.filter(c => c.type !== 'smart').map(c => {
          const migrated = migrateCollectionBanks(c);
          const populatedBanks = (migrated.banks || []).filter(b => b?.length > 0);
          if (populatedBanks.length === 0) return null;
          const totalImages = populatedBanks.reduce((sum, b) => sum + b.length, 0);
          return (
            <React.Fragment key={c.id}>
              <option value={`${c.id}:bank_0`}>{c.name} — All Banks ({totalImages})</option>
              {(migrated.banks || []).map((bank, idx) => (
                bank?.length > 0 && <option key={`${c.id}:bank_${idx}`} value={`${c.id}:bank_${idx}`}>&nbsp;&nbsp;{c.name} → {bankLabel(idx)} ({bank.length})</option>
              ))}
            </React.Fragment>
          );
        })}
        {categoryBankImages.some(b => (b || []).length > 0) && (categoryBankImages.length > 0 ? categoryBankImages : [[], []]).map((bank, idx) => (
          (bank || []).length > 0 && <option key={`bank_${idx}`} value={`bank_${idx}`}>{bankLabel(idx)} Bank (Category)</option>
        ))}
      </select>

      {/* Default Template Selector */}
      {textTemplates.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <label className="text-neutral-500 text-[11px] font-medium whitespace-nowrap">Text Style:</label>
          <select
            value={selectedDefaultTemplate?.id || ''}
            onChange={(e) => {
              const template = textTemplates.find(t => t.id === e.target.value);
              setSelectedDefaultTemplate(template || null);
            }}
            className="flex-1 px-2 py-1 rounded-md border border-neutral-200 bg-neutral-50 text-white text-[11px] outline-none cursor-pointer"
          >
            <option value="">Default</option>
            {textTemplates.map(template => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  // ─── Render: Sidebar Audio ───
  const renderSidebarAudio = () => (
    <div className="flex flex-col gap-2.5">
      {/* Selected audio pill */}
      {selectedAudio && (
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-neutral-50 border border-neutral-200">
          <FeatherMusic className="w-3.5 h-3.5 text-success-600 flex-shrink-0" />
          <span className="text-xs text-white flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {selectedAudio.name}
          </span>
          <span className="text-[10px] text-neutral-400 font-mono flex-shrink-0">
            {formatTime(selectedAudio.trimmedDuration || selectedAudio.duration || 0)}
          </span>
        </div>
      )}

      {/* Upload + Import buttons side-by-side */}
      <div className="flex gap-2">
        <Button
          variant="neutral-secondary"
          size="small"
          icon={<FeatherUpload />}
          onClick={() => slideshowAudioInputRef.current?.click()}
          className="flex-1"
        >
          Upload
        </Button>
        {audioTracks.length > 0 && (
          <div className="flex-1 relative">
            <Button
              variant="neutral-secondary"
              size="small"
              icon={<FeatherMusic />}
              onClick={() => setShowAudioPicker(!showAudioPicker)}
              className="w-full"
            >
              Library ({audioTracks.length})
            </Button>
            {showAudioPicker && (
              <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-neutral-50 border border-neutral-200 rounded-md shadow-overlay overflow-hidden">
                <div className="px-3 py-2 text-xs font-semibold text-neutral-500 border-b border-neutral-200">Select Audio</div>
                {audioTracks.map(audio => (
                  <button
                    key={audio.id}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-transparent border-none text-white text-xs cursor-pointer hover:bg-neutral-100"
                    onClick={() => {
                      setAudioToTrim(audio); setShowAudioTrimmer(true); setShowAudioPicker(false);
                    }}
                  >
                    <FeatherMusic className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{audio.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Audio Library full width button */}
      <Button
        variant="neutral-tertiary"
        size="small"
        icon={<FeatherMusic />}
        onClick={() => slideshowAudioInputRef.current?.click()}
        className="w-full"
      >
        Audio Library
      </Button>
    </div>
  );

  // ─── Render: Sidebar Text Style ───
  const renderSidebarTextStyle = () => {
    const selOverlay = editingTextId && currentSlide ? currentSlide.textOverlays?.find(o => o.id === editingTextId) : null;
    const activeStyle = selOverlay ? selOverlay.style : getDefaultTextStyle();
    const disabled = !selOverlay;
    const dimStyle = disabled ? { opacity: 0.4, pointerEvents: 'none' } : {};

    const handleStyleChange = (updates) => {
      if (selOverlay) {
        updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, ...updates } });
      }
    };

    const strokeInfo = activeStyle.textStroke ? parseStroke(activeStyle.textStroke) : { width: 0.5, color: '#000000' };

    return (
      <div className={`flex flex-col gap-4 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {disabled && (
          <div className="text-xs text-neutral-400 italic">
            Select a text overlay to edit its style
          </div>
        )}

        {/* Font Family */}
        <div>
          <div className="text-[13px] text-neutral-500 mb-1.5">Font Family</div>
          <select
            value={activeStyle.fontFamily}
            onChange={(e) => handleStyleChange({ fontFamily: e.target.value })}
            className="w-full px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50 text-white text-[13px] outline-none cursor-pointer"
          >
            {AVAILABLE_FONTS.map(f => (
              <option key={f.name} value={f.value}>{f.name}</option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div>
          <div className="flex justify-between mb-1.5">
            <span className="text-[13px] text-neutral-500">Font Size</span>
            <span className="text-[13px] text-white">{activeStyle.fontSize}px</span>
          </div>
          <input
            type="range" min="12" max="120" step="2"
            value={activeStyle.fontSize}
            onChange={(e) => handleStyleChange({ fontSize: parseInt(e.target.value) })}
            className="w-full accent-brand-600"
          />
        </div>

        {/* Text Color + Outline Color */}
        <div className="flex gap-3">
          <div className="flex-1">
            <div className="text-[13px] text-neutral-500 mb-1.5">Text Color</div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50">
              <input
                type="color" value={activeStyle.color || '#ffffff'}
                onChange={(e) => handleStyleChange({ color: e.target.value })}
                className="w-6 h-6 border-none rounded-full cursor-pointer p-0 bg-transparent"
              />
              <span className="text-xs text-neutral-500 font-mono">{(activeStyle.color || '#ffffff').toUpperCase()}</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[13px] text-neutral-500 mb-1.5">Outline</div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50">
              <input
                type="color" value={strokeInfo.color.startsWith('#') ? strokeInfo.color : '#000000'}
                onChange={(e) => handleStyleChange({ textStroke: buildStroke(strokeInfo.width, e.target.value) })}
                className="w-6 h-6 border-none rounded-full cursor-pointer p-0 bg-transparent"
              />
              <span className="text-xs text-neutral-500 font-mono">{(strokeInfo.color.startsWith('#') ? strokeInfo.color : '#000000').toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* Outline Width */}
        {activeStyle.textStroke && (
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-[13px] text-neutral-500">Outline Width</span>
              <span className="text-[13px] text-white">{strokeInfo.width}px</span>
            </div>
            <input
              type="range" min="0.1" max="10" step="0.1"
              value={strokeInfo.width}
              onChange={(e) => handleStyleChange({ textStroke: buildStroke(parseFloat(e.target.value), strokeInfo.color) })}
              className="w-full accent-brand-600"
            />
          </div>
        )}

        {/* Text Formatting */}
        <div>
          <div className="text-[13px] text-neutral-500 mb-1.5">Formatting</div>
          <div className="flex gap-1">
            {[
              { key: 'bold', label: 'B', active: activeStyle.fontWeight === '700', toggle: () => handleStyleChange({ fontWeight: activeStyle.fontWeight === '700' ? '400' : '700' }), bold: true },
              { key: 'caps', label: 'AA', active: activeStyle.textTransform === 'uppercase', toggle: () => handleStyleChange({ textTransform: activeStyle.textTransform === 'uppercase' ? 'none' : 'uppercase' }) },
              { key: 'outline', label: 'Sh', active: !!activeStyle.outline, toggle: () => handleStyleChange({ outline: !activeStyle.outline }) },
              { key: 'stroke', label: 'St', active: !!activeStyle.textStroke, toggle: () => handleStyleChange({ textStroke: activeStyle.textStroke ? null : buildStroke(0.5, '#000000') }) }
            ].map(btn => (
              <IconButton key={btn.key} onClick={btn.toggle}
                variant={btn.active ? 'brand-secondary' : 'neutral-secondary'}
                size="small"
                icon={<span className={`text-xs ${btn.bold ? 'font-bold' : 'font-semibold'}`}>{btn.label}</span>}
              />
            ))}
          </div>
        </div>

        {/* Text Alignment */}
        <div>
          <div className="text-[13px] text-neutral-500 mb-1.5">Alignment</div>
          <ToggleGroup
            value={activeStyle.textAlign || 'center'}
            onValueChange={(val) => handleStyleChange({ textAlign: val })}
          >
            <ToggleGroup.Item value="left" icon={<FeatherAlignLeft />}>{null}</ToggleGroup.Item>
            <ToggleGroup.Item value="center" icon={<FeatherAlignCenter />}>{null}</ToggleGroup.Item>
            <ToggleGroup.Item value="right" icon={<FeatherAlignRight />}>{null}</ToggleGroup.Item>
          </ToggleGroup>
        </div>
      </div>
    );
  };

  // ─── Render: Sidebar Text Banks ───
  const renderSidebarTextBanks = () => (
    <div className="flex flex-col gap-4">
      {getTextBanks().map((textBank, idx) => {
        const color = getBankColor(idx);
        const inputVal = newTextInputs[idx] || '';
        return (
          <div key={`tb-${idx}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('text/lyric')) { e.preventDefault(); e.currentTarget.style.outline = `1px dashed ${color.light}`; } }}
            onDragLeave={(e) => { e.currentTarget.style.outline = 'none'; }}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.style.outline = 'none'; const text = e.dataTransfer.getData('text/lyric'); if (text) handleAddToTextBank(idx + 1, text); }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold" style={{ color: color.light }}>{bankLabel(idx)} Text</span>
              {idx >= MIN_BANKS && (
                <IconButton variant="neutral-tertiary" size="small" icon={<FeatherTrash2 />}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!window.confirm(`Delete ${bankLabel(idx)} text and image bank?`)) return;
                    collections.forEach(col => {
                      const migrated = migrateCollectionBanks(col);
                      if ((migrated.banks || []).length > idx) {
                        removeBankFromCollection(artistId, col.id, idx);
                        if (db) {
                          const freshCols = getCollections(artistId);
                          const updated = freshCols.find(c => c.id === col.id);
                          if (updated) saveCollectionToFirestore(db, artistId, updated).catch(() => {});
                        }
                      }
                    });
                    setCollections(getCollections(artistId));
                    toastSuccess(`${bankLabel(idx)} deleted`);
                  }}
                />
              )}
            </div>
            {textBank.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-2">
                {textBank.map((entry, i) => {
                  const entryText = getTextBankText(entry);
                  const entryStyle = getTextBankStyle(entry);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: entryStyle?.color || '#737373' }} />
                      <div onClick={() => {
                        if (slides.length === 0) return;
                        // Navigate to matching slide position (wraps if bank index exceeds slide count)
                        const targetIdx = idx % slides.length;
                        setSelectedSlideIndex(targetIdx);
                        const newOverlay = { id: `text_${Date.now()}_${i}`, text: entryText, style: entryStyle ? { ...entryStyle } : getDefaultTextStyle(), position: { x: 50, y: 50, width: 80, height: 20 } };
                        setSlides(prev => prev.map((slide, si) => si === targetIdx ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] } : slide));
                        setEditingTextId(newOverlay.id);
                      }} className="flex-1 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-sm text-white text-[13px] cursor-pointer leading-snug break-words"
                        title={entryStyle ? `Click to add to ${bankLabel(idx % slides.length)} (styled)` : `Click to add to ${bankLabel(idx % slides.length)}`}>
                        {entryText}
                      </div>
                      <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />}
                        onClick={(e) => { e.stopPropagation(); handleRemoveFromTextBank(idx + 1, i); }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {textBank.length === 0 && <div className="text-[13px] text-neutral-400 py-2 text-center">No text yet</div>}
            <div className="flex gap-1.5">
              <input type="text" value={inputVal} onChange={(e) => setNewTextInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && inputVal.trim()) { handleAddToTextBank(idx + 1, inputVal); setNewTextInputs(prev => ({ ...prev, [idx]: '' })); } }}
                placeholder="Add text..."
                className="flex-1 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50 text-white text-[13px] outline-none"
              />
              <IconButton
                variant={inputVal.trim() ? 'neutral-secondary' : 'neutral-tertiary'}
                size="small"
                icon={<FeatherPlus />}
                disabled={!inputVal.trim()}
                onClick={() => { if (inputVal.trim()) { handleAddToTextBank(idx + 1, inputVal); setNewTextInputs(prev => ({ ...prev, [idx]: '' })); } }}
              />
            </div>
          </div>
        );
      })}
      {getTextBanks().length < MAX_BANKS && collections.length > 0 && (
        <Button
          variant="neutral-secondary"
          size="small"
          icon={<FeatherPlus />}
          onClick={() => {
            const targetCol = collections[0];
            addBankToCollection(artistId, targetCol.id);
            if (db) {
              const freshCols = getCollections(artistId);
              const updated = freshCols.find(c => c.id === targetCol.id);
              if (updated) saveCollectionToFirestore(db, artistId, updated).catch(() => {});
            }
            setCollections(getCollections(artistId));
            toastSuccess(`${bankLabel(getTextBanks().length)} added`);
          }}
          className="w-full"
        >
          Add Text Bank
        </Button>
      )}
    </div>
  );

  // ─── Render: Sidebar Slide Banks (Image Banks) ───
  const renderSidebarSlideBanks = () => {
    const collectionMaxBanks = collections.reduce((max, col) => {
      const migrated = migrateCollectionBanks(col);
      return Math.max(max, (migrated.banks || []).length);
    }, 0);
    const numBanks = Math.max((categoryBankImages || []).length, collectionMaxBanks, 2);

    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: numBanks }).map((_, idx) => {
          const color = getBankColor(idx);
          const bankImages = (() => {
            const colId = typeof selectedSource === 'string' && selectedSource.includes(':') ? selectedSource.split(':')[0] : null;
            if (colId) {
              const col = collections.find(c => c.id === colId);
              if (col) {
                const migrated = migrateCollectionBanks(col);
                const ids = (migrated.banks || [])[idx] || [];
                if (ids.length > 0) return libraryImages.filter(item => ids.includes(item.id));
              }
            }
            if ((categoryBankImages[idx] || []).length > 0) return categoryBankImages[idx];
            const allIds = new Set();
            collections.forEach(col => {
              const migrated = migrateCollectionBanks(col);
              ((migrated.banks || [])[idx] || []).forEach(id => allIds.add(id));
            });
            if (allIds.size > 0) return libraryImages.filter(item => allIds.has(item.id));
            return [];
          })();

          return (
            <div key={`img-bank-${idx}`}
              className="rounded-sm overflow-hidden transition-all duration-150"
              style={{
                border: dragOverBankCol === idx ? `2px dashed ${color.border}` : '1px solid rgb(64, 64, 64)',
                backgroundColor: dragOverBankCol === idx ? color.bg : 'transparent'
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverBankCol(idx); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverBankCol(null); }}
              onDrop={(e) => handleDropOnBankColumn(e, idx)}
            >
              {/* Bank header */}
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: color.primary }}>{idx + 1}</div>
                <span className="text-sm font-semibold text-white flex-1">{bankLabel(idx)} Bank</span>
                <Badge variant="neutral">{bankImages.length} images</Badge>
                {idx >= MIN_BANKS && (
                  <IconButton variant="neutral-tertiary" size="small" icon={<FeatherTrash2 />}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm(`Delete ${bankLabel(idx)}? Images will remain in your library.`)) return;
                      collections.forEach(col => {
                        const migrated = migrateCollectionBanks(col);
                        if ((migrated.banks || []).length > idx) {
                          removeBankFromCollection(artistId, col.id, idx);
                          if (db) {
                            const freshCols = getCollections(artistId);
                            const updated = freshCols.find(c => c.id === col.id);
                            if (updated) saveCollectionToFirestore(db, artistId, updated).catch(() => {});
                          }
                        }
                      });
                      setCollections(getCollections(artistId));
                      toastSuccess(`${bankLabel(idx)} deleted`);
                    }}
                  />
                )}
              </div>
              {/* Bank images — horizontal row */}
              <div className="px-3 pb-2">
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {bankImages.map(image => {
                    const isSel = selectedBankImages.has(image.id);
                    return (
                      <div key={image.id} className="w-16 h-16 rounded-md overflow-hidden cursor-grab relative flex-shrink-0"
                        style={{ border: isSel ? `2px solid ${color.primary}` : '1px solid rgb(64, 64, 64)' }}
                        draggable
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) {
                            setSelectedBankImages(prev => { const next = new Set(prev); if (next.has(image.id)) next.delete(image.id); else next.add(image.id); return next; });
                          } else {
                            setSelectedBankImages(prev => prev.size === 1 && prev.has(image.id) ? new Set() : new Set([image.id]));
                          }
                          setActiveBank(`image${idx}`);
                        }}
                        onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ ...image, url: image.url || image.localUrl, thumbnail: image.url || image.localUrl, sourceBank: `image${idx}` })); }}
                      >
                        {isSel && <div className="absolute inset-0 z-[1] pointer-events-none" style={{ backgroundColor: `${color.primary}33` }}><div className="absolute bottom-[3px] right-[3px] w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] text-white font-bold" style={{ backgroundColor: color.primary }}>✓</div></div>}
                        <img src={image.thumbnailUrl || image.url || image.localUrl} alt={image.name} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    );
                  })}
                  {/* Dashed plus button */}
                  <div
                    className="w-16 h-16 rounded-md flex-shrink-0 border-2 border-dashed border-neutral-300 bg-neutral-50 flex items-center justify-center cursor-pointer text-neutral-400 hover:border-neutral-400"
                    onClick={() => { importBankIndexRef.current = idx; importImageGenericRef.current?.click(); }}
                    title={`Add images to ${bankLabel(idx)}`}
                  >
                    <FeatherPlus className="w-5 h-5" />
                  </div>
                </div>
                {bankImages.length === 0 && (
                  <div className="text-[13px] text-neutral-400 py-1 text-center">No images in {bankLabel(idx)}</div>
                )}
              </div>
              {/* Cloud Import */}
              <div className="px-3 pb-2">
                <CloudImportButton
                  artistId={artistId} db={db} mediaType="image" compact
                  onImportMedia={(files) => {
                    const newItems = files.map((f, fi) => ({
                      id: `cloud_${Date.now()}_${fi}`, name: f.name, url: f.url, localUrl: f.localUrl, type: 'image'
                    }));
                    setLibraryImages(prev => [...prev, ...newItems]);
                  }}
                />
              </div>
            </div>
          );
        })}

        {/* Selection action bar */}
        {selectedBankImages.size > 0 && (
          <div className="flex gap-2 py-1.5">
            <Button variant="brand-primary" size="small" onClick={addSelectedImagesToSlides} className="flex-1">
              Add {selectedBankImages.size} to Slides
            </Button>
            <Button variant="neutral-secondary" size="small" onClick={() => setSelectedBankImages(new Set())}>Clear</Button>
          </div>
        )}
      </div>
    );
  };

  // ─── Render: Sidebar Lyrics ───
  const renderSidebarLyrics = () => (
    <div className="flex flex-col gap-3">
      {/* Lyrics text input */}
      <textarea
        placeholder="Enter or paste lyrics here..."
        rows={3}
        className="w-full px-3 py-2.5 rounded-sm border border-neutral-200 bg-neutral-50 text-white text-[13px] outline-none resize-y font-[inherit] leading-relaxed"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && e.target.value.trim()) {
            e.preventDefault();
            if (currentSlide) {
              const newOverlay = {
                id: `text_${Date.now()}`, text: e.target.value.trim(),
                style: getDefaultTextStyle(), position: { x: 50, y: 50, width: 80, height: 20 }
              };
              setSlides(prev => prev.map((slide, i) =>
                i === selectedSlideIndex ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] } : slide
              ));
              setEditingTextId(newOverlay.id);
              e.target.value = '';
            }
          }
        }}
      />

      {/* Load from Bank + AI Transcribe buttons */}
      <div className="flex gap-2">
        {onAddLyrics && (
          <div className="flex-1 relative" data-lyric-bank-picker>
            <Button
              variant="neutral-secondary"
              size="small"
              icon={<FeatherDatabase />}
              onClick={() => setShowLyricBankPicker(!showLyricBankPicker)}
              className="w-full"
            >
              Load from Bank
            </Button>
            {showLyricBankPicker && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-neutral-50 border border-neutral-200 rounded-sm shadow-overlay z-[1000] overflow-hidden">
                <div className="px-3 py-2 text-[11px] font-semibold text-neutral-400 border-b border-neutral-200">
                  SELECT LYRICS
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {lyrics.length === 0 ? (
                    <div className="py-4 px-3 text-xs text-neutral-400 text-center italic">No lyrics in bank yet</div>
                  ) : (
                    lyrics.map((lyric) => (
                      <div
                        key={lyric.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/lyric', lyric.content || lyric.title || '');
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        className={`flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-white cursor-pointer border-b border-neutral-200 hover:bg-neutral-100 ${
                          linkedLyricId === lyric.id ? 'bg-brand-600/15' : ''
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (currentSlide) {
                            const newOverlay = {
                              id: `text_${Date.now()}`, text: lyric.content,
                              style: getDefaultTextStyle(), position: { x: 50, y: 50, width: 80, height: 20 }
                            };
                            setSlides(prev => prev.map((slide, i) =>
                              i === selectedSlideIndex ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] } : slide
                            ));
                            setEditingTextId(newOverlay.id);
                          }
                          setShowLyricBankPicker(false);
                        }}
                      >
                        <FeatherMusic className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                          {lyric.title || lyric.content?.slice(0, 30) || 'Untitled'}
                        </span>
                        {linkedLyricId === lyric.id && <span className="text-[9px] text-brand-600 font-bold">LINKED</span>}
                      </div>
                    ))
                  )}
                </div>
                <div
                  className="flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-success-600 cursor-pointer border-t border-neutral-200 hover:bg-neutral-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLyricsPromptValue('');
                    setShowLyricsPrompt(true);
                    setShowLyricBankPicker(false);
                  }}
                >
                  <FeatherPlus className="w-3.5 h-3.5" />
                  Add New Lyrics
                </div>
              </div>
            )}
          </div>
        )}

        {selectedAudio && (
          <Button
            variant="neutral-secondary"
            size="small"
            icon={<FeatherMic />}
            onClick={() => setShowLyricAnalyzer(true)}
            className="flex-1"
          >
            AI Transcribe
          </Button>
        )}
      </div>
    </div>
  );

  // ─── Render: Modals ───
  const renderModals = () => (
    <>
      {/* Schedule Panel */}
      {showSchedulePanel && (
        <div className="absolute bottom-20 right-6 w-[360px] bg-neutral-50 rounded-2xl shadow-lg border border-neutral-200 p-5 z-[100]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 m-0 text-[16px] font-semibold text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Schedule Carousel
            </h3>
            <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />} onClick={() => setShowSchedulePanel(false)} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="flex flex-col gap-1 mb-2">
              <label className="text-[11px] font-medium text-neutral-500 uppercase">Account</label>
              <select value={selectedHandle} onChange={(e) => setSelectedHandle(e.target.value)}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-[14px] cursor-pointer">
                <option value="">Select account...</option>
                {availableHandles.map(handle => (<option key={handle} value={handle}>{handle}</option>))}
              </select>
            </div>
            <div className="flex flex-col gap-1 mb-2">
              <label className="text-[11px] font-medium text-neutral-500 uppercase">Date</label>
              <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-[14px]" />
            </div>
            <div className="flex flex-col gap-1 mb-2">
              <label className="text-[11px] font-medium text-neutral-500 uppercase">Time</label>
              <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-[14px]" />
            </div>
            <div className="flex flex-col gap-1 mb-2">
              <label className="text-[11px] font-medium text-neutral-500 uppercase">Platforms</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-[13px] text-neutral-400 cursor-pointer">
                  <input type="checkbox" checked={platforms.tiktok} onChange={(e) => setPlatforms(p => ({ ...p, tiktok: e.target.checked }))} /> TikTok
                </label>
                <label className="flex items-center gap-1.5 text-[13px] text-neutral-400 cursor-pointer">
                  <input type="checkbox" checked={platforms.instagram} onChange={(e) => setPlatforms(p => ({ ...p, instagram: e.target.checked }))} /> Instagram
                </label>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-white/[0.35] py-1 italic">
            Caption & hashtags can be added in the Scheduler
          </div>
          <div className="mt-3 p-3 bg-white/[0.03] rounded-lg">
            <span className="text-[12px] text-neutral-500 block mb-2">{exportedImages.length} images ready to post</span>
            <div className="flex gap-1">
              {exportedImages.slice(0, 5).map((img, i) => (
                <img key={i} src={img.url} alt={`Slide ${i + 1}`} className="w-12 h-16 object-cover rounded-md" />
              ))}
              {exportedImages.length > 5 && <div className="w-12 h-16 bg-white/10 rounded-md flex items-center justify-center text-[12px] text-neutral-500">+{exportedImages.length - 5}</div>}
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <Button variant="neutral-secondary" className="flex-1" onClick={() => { setShowSchedulePanel(false); toastSuccess(`Exported ${exportedImages.length} images! You can schedule them later.`); }}>
              Skip for now
            </Button>
            <Button variant="brand-primary" className="flex-1 !bg-green-500 !border-green-500" onClick={handleSchedule} disabled={isScheduling || !selectedHandle}>
              {isScheduling ? 'Scheduling...' : 'Schedule Post'}
            </Button>
          </div>
        </div>
      )}

      {/* AI Lyric Analyzer */}
      {showLyricAnalyzer && selectedAudio && (
        <LyricAnalyzer
          audioFile={selectedAudio.file} audioUrl={selectedAudio.url || selectedAudio.localUrl}
          startTime={selectedAudio.startTime} endTime={selectedAudio.endTime}
          onComplete={handleTranscriptionComplete} onClose={() => setShowLyricAnalyzer(false)}
        />
      )}

      {/* Audio Trimmer */}
      {showAudioTrimmer && audioToTrim && (
        <AudioClipSelector
          audioFile={audioToTrim.file} audioUrl={audioToTrim.url || audioToTrim.localUrl}
          audioName={audioToTrim.name} initialStart={audioToTrim.startTime || 0} initialEnd={audioToTrim.endTime || null}
          onSave={handleAudioTrimSave} onCancel={() => { setShowAudioTrimmer(false); setAudioToTrim(null); }}
        />
      )}

      {/* Audio Prompt */}
      {showAudioPrompt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[10002]">
          <div className="bg-neutral-50 rounded-2xl p-7 max-w-[380px] w-[90%] text-center shadow-lg border border-neutral-200">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-400/20 to-orange-400/10 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
              </svg>
            </div>
            <h3 className="m-0 mb-2 text-white text-[16px] font-semibold">Add audio first?</h3>
            <p className="m-0 mb-5 text-neutral-500 text-[13px] leading-relaxed">
              Your template doesn't have audio yet. All generated slideshows will inherit the template's audio.
            </p>
            <div className="flex gap-2.5">
              <Button variant="neutral-secondary" className="flex-1" onClick={() => { setShowAudioPrompt(false); executeGeneration(); }}>
                Skip, Generate Anyway
              </Button>
              <Button variant="brand-primary" className="flex-1" onClick={() => { setShowAudioPrompt(false); setShowAudioPicker(true); }}>
                Add Audio
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Lyrics Prompt */}
      {showLyricsPrompt && (
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center"
          onClick={() => setShowLyricsPrompt(false)}>
          <div className="bg-neutral-50 rounded-xl p-6 w-[400px] max-w-[90vw] border border-neutral-200"
            onClick={e => e.stopPropagation()}>
            <div className="text-white text-[16px] font-semibold mb-3">Add Lyrics</div>
            <textarea autoFocus value={lyricsPromptValue} onChange={e => setLyricsPromptValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setShowLyricsPrompt(false); }}
              placeholder="Enter lyrics to add to bank..."
              className="w-full min-h-[100px] bg-neutral-0 border border-neutral-200 rounded-lg p-3 text-white text-[14px] resize-y outline-none box-border" />
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="neutral-secondary" onClick={() => setShowLyricsPrompt(false)}>Cancel</Button>
              <Button variant="brand-primary" onClick={() => {
                const text = lyricsPromptValue;
                if (text?.trim()) { handleAddLyricsAndRefresh({ title: text.split('\n')[0].slice(0, 30) || 'New Lyrics', content: text.trim() }); }
                setShowLyricsPrompt(false);
              }}>Add</Button>
            </div>
          </div>
        </div>
      )}

      {/* Template Name Prompt */}
      {showTemplatePrompt && (
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center"
          onClick={() => setShowTemplatePrompt(false)}>
          <div className="bg-neutral-50 rounded-xl p-6 w-[360px] max-w-[90vw] border border-neutral-200"
            onClick={e => e.stopPropagation()}>
            <div className="text-white text-[16px] font-semibold mb-3">Save Template</div>
            <input autoFocus value={templatePromptValue} onChange={e => setTemplatePromptValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setShowTemplatePrompt(false);
                if (e.key === 'Enter' && templatePromptValue.trim() && pendingTemplateStyle) {
                  handleSaveTemplate({ id: `template_${Date.now()}`, name: templatePromptValue.trim(), style: { ...pendingTemplateStyle } });
                  setShowTemplatePrompt(false);
                }
              }}
              placeholder="Template name..."
              className="w-full bg-neutral-0 border border-neutral-200 rounded-lg px-3 py-2.5 text-white text-[14px] outline-none box-border" />
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="neutral-secondary" onClick={() => setShowTemplatePrompt(false)}>Cancel</Button>
              <Button variant="brand-primary" onClick={() => {
                if (templatePromptValue.trim() && pendingTemplateStyle) {
                  handleSaveTemplate({ id: `template_${Date.now()}`, name: templatePromptValue.trim(), style: { ...pendingTemplateStyle } });
                }
                setShowTemplatePrompt(false);
              }}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ─── Hidden File Inputs ───
  const renderHiddenInputs = () => (
    <>
      <input ref={importImageARef} type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple onChange={(e) => handleImportImages(e, 'A')} style={{ display: 'none' }} />
      <input ref={importImageBRef} type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple onChange={(e) => handleImportImages(e, 'B')} style={{ display: 'none' }} />
      <input ref={importImageGenericRef} type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple onChange={(e) => handleImportImages(e, importBankIndexRef.current)} style={{ display: 'none' }} />
      <input ref={slideshowAudioInputRef} type="file" accept="audio/*,.m4a,.wav,.aif,.aiff" onChange={handleSlideshowAudioUpload} style={{ display: 'none' }} />
    </>
  );

  // ═══════════════════════════════════════════
  // ─── MAIN RETURN ───
  // ═══════════════════════════════════════════
  return (
    <div className={`fixed inset-0 bg-black/95 z-[10000] flex items-center justify-center ${isMobile ? 'p-0' : ''}`}>
      <div className={`bg-neutral-0 flex flex-col overflow-hidden border border-neutral-200 ${isMobile ? 'w-full h-screen rounded-none' : 'w-[95vw] h-screen rounded-2xl'}`}>
        {renderTopBar()}
        {renderDraftTabsBar()}

        {/* Mobile Tab Bar */}
        {isMobile && (
          <div style={{
            display: 'flex', borderBottom: '1px solid #262626', backgroundColor: '#000000'
          }}>
            {['preview', 'banks', 'text'].map(tab => (
              <button
                key={tab}
                style={{
                  flex: 1, padding: '12px', border: 'none',
                  backgroundColor: mobilePanelTab === tab ? '#6366f1' : 'transparent',
                  color: mobilePanelTab === tab ? '#fff' : '#a3a3a3',
                  fontSize: '13px', fontWeight: '500', cursor: 'pointer'
                }}
                onClick={() => setMobilePanelTab(tab)}
              >
                {tab === 'preview' ? 'Preview' : tab === 'banks' ? 'Media' : 'Text'}
              </button>
            ))}
          </div>
        )}

        {/* Main Content */}
        <div className={`flex flex-1 overflow-hidden ${isMobile ? 'flex-col' : ''}`}>

          {/* ─── CENTER AREA ─── */}
          {(!isMobile || mobilePanelTab === 'preview') && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0
            }}>
              {/* Canvas area - fills available vertical space */}
              <div ref={canvasAreaRef} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', padding: '8px 24px', minHeight: 0
              }}>
                {renderCanvasPreview()}
              </div>

              {renderGenerationControls()}
              {renderSlideNavRow()}
              {renderAudioPlayerBar()}
              {renderFilmstrip()}
              {renderInlineTextEditor()}
              {renderHiddenInputs()}
            </div>
          )}

          {/* ─── RIGHT SIDEBAR ─── */}
          {(!isMobile || mobilePanelTab === 'banks') && (
            <div style={{
              width: isMobile ? '100%' : '384px',
              borderLeft: isMobile ? 'none' : '1px solid #262626',
              display: 'flex', flexDirection: 'column',
              backgroundColor: '#000000',
              overflow: 'hidden',
              flexShrink: 0
            }}>
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
                {renderCollapsibleSection('source', 'Source', renderSidebarSource())}
                {renderCollapsibleSection('audio', 'Audio', renderSidebarAudio())}
                {renderCollapsibleSection('textStyle', 'Text Style', renderSidebarTextStyle())}
                {renderCollapsibleSection('textBanks', 'Text Banks', renderSidebarTextBanks())}
                {renderCollapsibleSection('slideBanks', 'Slide Banks', renderSidebarSlideBanks())}
                {renderCollapsibleSection('lyrics', 'Lyrics', renderSidebarLyrics())}
              </div>
            </div>
          )}

          {/* Mobile Text Panel */}
          {isMobile && mobilePanelTab === 'text' && currentSlide && (
            <div style={{
              flex: 1, backgroundColor: '#16162a', overflow: 'auto',
              WebkitOverflowScrolling: 'touch', padding: '16px'
            }}>
              <TextEditorPanel
                slide={currentSlide}
                editingTextId={editingTextId}
                lyrics={lyrics}
                templates={textTemplates}
                textBank1={getTextBanks()[0] || []}
                textBank2={getTextBanks()[1] || []}
                onSelectText={(text) => {
                  const newOverlay = {
                    id: `text_${Date.now()}`, text: text,
                    style: { fontFamily: 'Inter, sans-serif', fontSize: 48, fontWeight: '600', color: '#ffffff', textAlign: 'center', outline: true, outlineColor: '#000000' },
                    position: { x: 50, y: 50, width: 80, height: 20 }
                  };
                  setSlides(prev => prev.map((slide, i) => i === selectedSlideIndex ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] } : slide));
                  setEditingTextId(newOverlay.id);
                  setMobilePanelTab('preview');
                }}
                onAddTextOverlay={() => {
                  const newOverlay = {
                    id: `text_${Date.now()}`, text: 'New Text',
                    style: { fontFamily: 'Inter, sans-serif', fontSize: 48, fontWeight: '600', color: '#ffffff', textAlign: 'center', outline: true, outlineColor: '#000000' },
                    position: { x: 50, y: 50, width: 80, height: 20 }
                  };
                  setSlides(prev => prev.map((slide, i) => i === selectedSlideIndex ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] } : slide));
                  setEditingTextId(newOverlay.id);
                }}
                onSelectOverlay={(overlayId) => setEditingTextId(overlayId)}
                onUpdateOverlay={(overlayId, updates) => {
                  setSlides(prev => prev.map((slide, idx) =>
                    idx === selectedSlideIndex
                      ? { ...slide, textOverlays: (slide.textOverlays || []).map(overlay => overlay.id === overlayId ? { ...overlay, ...updates } : overlay) }
                      : slide
                  ));
                }}
                onRemoveOverlay={(overlayId) => {
                  setSlides(prev => prev.map((slide, idx) =>
                    idx === selectedSlideIndex
                      ? { ...slide, textOverlays: (slide.textOverlays || []).filter(o => o.id !== overlayId) }
                      : slide
                  ));
                  setEditingTextId(null);
                }}
                onRerollText={(overlayId, bankSource) => handleTextReroll(overlayId, bankSource)}
                onAddLyrics={handleAddLyricsAndRefresh}
                onSaveTemplate={handleSaveTemplate}
                onRequestSaveTemplate={(style) => {
                  setPendingTemplateStyle(style);
                  setTemplatePromptValue('');
                  setShowTemplatePrompt(true);
                }}
                onClose={() => setMobilePanelTab('preview')}
                isMobile={true}
              />
            </div>
          )}
        </div>

        {renderModals()}
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
  { name: 'Arial Narrow', value: "'Arial Narrow', Arial, sans-serif" },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Times New Roman', value: "'Times New Roman', serif" },
  { name: 'Courier New', value: "'Courier New', monospace" },
  { name: 'Impact', value: 'Impact, sans-serif' },
  { name: 'Comic Sans', value: "'Comic Sans MS', cursive" },
  { name: 'Trebuchet', value: "'Trebuchet MS', sans-serif" },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
  { name: 'Palatino', value: "'Palatino Linotype', serif" },
  { name: 'TikTok Sans', value: "'TikTok Sans', sans-serif" }
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
  onRequestSaveTemplate,
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
        <IconButton icon={<FeatherX />} onClick={onClose} />
      </div>

      {/* Text Blocks List */}
      <div style={textPanelStyles.textList}>
        <div style={textPanelStyles.sectionHeader}>
          <span>Text Blocks ({textOverlays.length})</span>
          <IconButton size="small" icon={<FeatherPlus />} onClick={onAddTextOverlay} />
        </div>

        {textOverlays.length === 0 ? (
          <div style={textPanelStyles.emptyText}>
            <p>No text on this slide</p>
            <Button variant="brand-secondary" size="small" icon={<FeatherPlus />} onClick={onAddTextOverlay}>Add Text</Button>
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
                {(overlay.text || '').slice(0, 50)}{(overlay.text || '').length > 50 ? '...' : ''}
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                {canReroll && (
                  <IconButton size="small" icon={<FeatherRefreshCw />} onClick={(e) => { e.stopPropagation(); onRerollText(overlay.id); }} title={`Reroll from Text Bank ${idx === 0 ? '1' : idx === 1 ? '2' : ''} (${bank.length} items)`} />
                )}
                <IconButton size="small" icon={<FeatherTrash2 />} onClick={(e) => { e.stopPropagation(); onRemoveOverlay(overlay.id); }} />
              </div>
            </div>
            );
          })
        )}
      </div>

      {/* Selected Text Editor */}
      {selectedOverlay && (() => {
        const st = selectedOverlay.style || { fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: '700', color: '#ffffff', textAlign: 'center' };
        return (
        <div style={textPanelStyles.editor}>
          <div style={textPanelStyles.sectionHeader}>Edit Text</div>

          <textarea
            value={selectedOverlay.text || ''}
            onChange={(e) => onUpdateOverlay(selectedOverlay.id, { text: e.target.value })}
            style={textPanelStyles.textarea}
            placeholder="Enter text..."
            rows={4}
          />

          {/* Reroll from Text Banks */}
          {(textBank1.length > 0 || textBank2.length > 0) && (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              {textBank1.length > 0 && (
                <Button variant="neutral-secondary" size="small" icon={<FeatherRefreshCw />} onClick={() => onRerollText(selectedOverlay.id, 0)} title={`Pick random text from Text Bank 1 (${textBank1.length} items)`} className="flex-1">Bank 1 ({textBank1.length})</Button>
              )}
              {textBank2.length > 0 && (
                <Button variant="neutral-secondary" size="small" icon={<FeatherRefreshCw />} onClick={() => onRerollText(selectedOverlay.id, 1)} title={`Pick random text from Text Bank 2 (${textBank2.length} items)`} className="flex-1">Bank 2 ({textBank2.length})</Button>
              )}
            </div>
          )}

          {/* Font Size */}
          <div style={textPanelStyles.control}>
            <div style={textPanelStyles.controlHeader}>
              <span>Size</span>
              <span style={textPanelStyles.controlValue}>{st.fontSize}px</span>
            </div>
            <div style={textPanelStyles.sizeButtons}>
              <button
                style={textPanelStyles.sizeBtn}
                onClick={() => onUpdateOverlay(selectedOverlay.id, {
                  style: { ...st, fontSize: Math.max(12, (st.fontSize || 48) - 4) }
                })}
              >A-</button>
              <button
                style={textPanelStyles.sizeBtn}
                onClick={() => onUpdateOverlay(selectedOverlay.id, {
                  style: { ...st, fontSize: Math.min(120, (st.fontSize || 48) + 4) }
                })}
              >A+</button>
            </div>
          </div>

          {/* Font Family */}
          <div style={textPanelStyles.control}>
            <span>Font</span>
            <select
              value={st.fontFamily}
              onChange={(e) => onUpdateOverlay(selectedOverlay.id, {
                style: { ...st, fontFamily: e.target.value }
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
                    ...(st.textAlign === align ? textPanelStyles.alignBtnActive : {})
                  }}
                  onClick={() => onUpdateOverlay(selectedOverlay.id, {
                    style: { ...st, textAlign: align }
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
              value={st.color || '#ffffff'}
              onChange={(e) => onUpdateOverlay(selectedOverlay.id, {
                style: { ...st, color: e.target.value }
              })}
              style={textPanelStyles.colorPicker}
            />
          </div>

          {/* Template Actions */}
          <div style={textPanelStyles.templateActions}>
            {/* Save as Template */}
            <Button variant="neutral-secondary" size="small" icon={<FeatherSave />} onClick={() => { if (onRequestSaveTemplate && selectedOverlay) onRequestSaveTemplate(st); }}>Save as Template</Button>

            {/* Apply Template dropdown */}
            {templates.length > 0 && (
              <div style={{ position: 'relative' }}>
                <Button variant="neutral-secondary" size="small" icon={<FeatherLayout />} onClick={() => setShowTemplatePicker(!showTemplatePicker)}>Apply Template</Button>
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
          {onAddLyrics && (selectedOverlay.text || '').trim() && (
            <Button variant="neutral-secondary" size="small" icon={<FeatherMusic />} onClick={() => {
                handleAddLyricsAndRefresh({
                  id: `lyric_${Date.now()}`,
                  title: (selectedOverlay.text || '').split('\n')[0].slice(0, 30) || 'Saved Lyrics',
                  content: (selectedOverlay.text || '').trim(),
                  createdAt: new Date().toISOString()
                });
                toastSuccess('Saved to Lyric Bank!');
              }}>Save to Lyric Bank</Button>
          )}
        </div>
        );
      })()}

      {/* Pull from Lyric Bank Section */}
      <div style={textPanelStyles.lyricSection}>
        <Button variant="neutral-secondary" size="small" icon={<FeatherDatabase />} onClick={() => setShowLyricPicker(!showLyricPicker)} className="w-full">Pull from Lyric Bank</Button>

        {showLyricPicker && (
          <div style={textPanelStyles.lyricPicker}>
            {lyrics.length === 0 ? (
              <div style={textPanelStyles.noLyrics}>No lyrics in bank</div>
            ) : (
              lyrics.map(lyric => (
                <div key={lyric.id} style={{
                  ...textPanelStyles.lyricItem,
                  ...(linkedLyricId === lyric.id ? { border: '1px solid #6366f1', backgroundColor: 'rgba(99,102,241,0.15)' } : {})
                }}>
                  <div style={textPanelStyles.lyricTitle}>
                    {lyric.title}
                    {linkedLyricId === lyric.id && <span style={{ marginLeft: '6px', fontSize: '9px', color: '#6366f1' }}>LINKED</span>}
                  </div>
                  <div style={textPanelStyles.lyricPreview}>
                    {lyric.content.split('\n').slice(0, 2).join(' / ')}
                  </div>
                  <Button variant="brand-primary" size="small" onClick={() => { onSelectText(lyric.content); setShowLyricPicker(false); }}>Use</Button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// TextEditorPanel styles (mobile text panel — kept as inline styles)
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
  emptyText: {
    textAlign: 'center',
    padding: '20px',
    color: '#6b7280'
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
  templateActions: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap'
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
};

export default SlideshowEditor;
