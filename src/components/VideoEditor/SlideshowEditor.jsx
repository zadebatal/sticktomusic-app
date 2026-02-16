import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import useIsMobile from '../../hooks/useIsMobile';
import { exportSlideshowAsImages, generateSlideThumbnail } from '../../services/slideshowExportService';
import { subscribeToLibrary, subscribeToCollections, getCollections, getCollectionsAsync, getLibrary, getLyrics, MEDIA_TYPES, addToTextBank, removeFromTextBank, assignToBank, saveCollectionToFirestore, migrateCollectionBanks, getBankColor, getBankLabel, BANK_COLORS, MAX_BANKS, MIN_BANKS, addBankToCollection, removeBankFromCollection, updateLibraryItem, getTextBankText, getTextBankStyle } from '../../services/libraryService';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import LyricBank from './LyricBank';
import AudioClipSelector from './AudioClipSelector';
import LyricAnalyzer from './LyricAnalyzer';
import CloudImportButton from './CloudImportButton';
import AudioSelectionModal from './AudioSelectionModal';
import log from '../../utils/logger';

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
  // Debug log removed — was firing on every render and flooding console

  const { theme } = useTheme();
  const styles = getStyles(theme);

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
  // Keep-template-text options: 'none' (use text banks), 'slideA', 'slideB', 'both'
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

  // Text bank input state
  const [newTextInputs, setNewTextInputs] = useState({});
  const [showAddToBankPicker, setShowAddToBankPicker] = useState(false);

  // Add text to a text bank and update local collections state
  // text can be a plain string or { text: string, style: object }
  const handleAddToTextBank = useCallback((bankNum, text) => {
    const plainText = typeof text === 'string' ? text : text?.text || '';
    if (!plainText.trim() || !artistId || collections.length === 0) return;
    // For plain strings, trim; for styled objects, trim the text inside
    const entry = typeof text === 'string' ? text.trim() : { ...text, text: text.text.trim() };
    const targetCol = collections[0]; // Add to first collection
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
  }, [artistId, collections]);

  // Delete text from a text bank
  const handleRemoveFromTextBank = useCallback((bankNum, index) => {
    if (!artistId || collections.length === 0) return;
    const targetCol = collections[0];
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
  }, [artistId, collections]);

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
  const [showAudioSelectionModal, setShowAudioSelectionModal] = useState(false);

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
      toastSuccess(`Added ${mediaIds.length} image${mediaIds.length > 1 ? 's' : ''} to ${getBankLabel(bank)} Bank`);
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

  // Keyboard shortcut: Cmd+Z / Ctrl+Z for undo, Cmd+Shift+Z / Ctrl+Shift+Z for redo
  // Skip if user is editing text overlays or typing in an input/textarea
  useEffect(() => {
    const handleKeyDown = (e) => {
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
  }, [handleUndo, handleRedo, editingTextId]);

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
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });
  const [isScheduling, setIsScheduling] = useState(false);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('#carousel #slideshow #fyp');

  // Available handles from lateAccountIds
  const availableHandles = Object.keys(lateAccountIds);

  // Canvas ref for rendering
  const canvasRef = useRef(null);
  const previewRef = useRef(null);

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
  const activeCollectionId = (() => {
    if (selectedSource && selectedSource.includes(':bank_')) return selectedSource.split(':')[0];
    if (selectedSource && !selectedSource.match(/^bank_\d+$/)) return selectedSource;
    return null;
  })();
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

  // Preview dimensions - scale from actual aspect ratio
  const previewScale = 0.25;
  const baseDimensions = exportDimensions;
  const previewDimensions = {
    width: baseDimensions.width * previewScale,
    height: baseDimensions.height * previewScale
  };

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

  // Gather all text bank items from collections for text reroll
  const textBanksCache = useMemo(() => {
    const result = [];
    for (const col of collections) {
      const migrated = migrateCollectionBanks(col);
      (migrated.textBanks || []).forEach((tb, i) => {
        if (!result[i]) result[i] = [];
        if (tb?.length > 0) result[i] = [...result[i], ...tb];
      });
    }
    while (result.length < 2) result.push([]);
    return result;
  }, [collections, migrateCollectionBanks]);
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
      // Audio was actually trimmed to a new file — upload to Firebase Storage immediately
      try {
        toastSuccess('Uploading trimmed audio...');
        const { uploadFile } = await import('../../services/firebaseStorage');
        const { url: storageUrl } = await uploadFile(trimmedFile, 'audio', (progress) => {
          if (progress === 100) toastSuccess('Processing...');
        });

        const editedAudio = {
          ...audioToTrim,
          id: `audio_trim_${Date.now()}`,
          name: trimmedName || trimmedFile.name,
          file: undefined, // Don't store File object (non-serializable)
          url: storageUrl, // Firebase Storage URL (persistent)
          localUrl: storageUrl, // Same as url for consistency
          startTime: 0,
          endTime: duration,
          trimmedDuration: duration,
          isTrimmed: false, // It's a new independent file, not metadata-trimmed
          duration: duration
        };
        setSelectedAudio(editedAudio);
        setShowAudioTrimmer(false);
        setAudioToTrim(null);
        toastSuccess('Audio ready');
      } catch (error) {
        console.error('[SlideshowEditor] Failed to upload trimmed audio:', error);
        toastError(`Failed to upload audio: ${error.message}`);
      }
    } else {
      // Metadata-only trim (fallback or full-length selection)
      // IMPORTANT: Check if audio has expired blob URL and reject it
      if (audioToTrim.url?.startsWith('blob:')) {
        toastError('This audio has an expired URL. Please re-upload the audio file.');
        setShowAudioTrimmer(false);
        setAudioToTrim(null);
        return;
      }

      const editedAudio = {
        ...audioToTrim,
        file: undefined, // Strip non-serializable fields
        localUrl: undefined,
        startTime,
        endTime,
        trimmedDuration: endTime - startTime,
        isTrimmed: startTime > 0 || (audioToTrim.duration && Math.abs(endTime - audioToTrim.duration) > 0.1)
      };
      setSelectedAudio(editedAudio);
      setShowAudioTrimmer(false);
      setAudioToTrim(null);
    }
  }, [audioToTrim, db, artistId, toastSuccess, toastError]);

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
  const selectedAudioUrl = useMemo(() => {
    try {
      const url = selectedAudio?.url || selectedAudio?.localUrl || null;
      if (!url) return null;

      // If it's a blob URL, check if it's still valid by trying to find the audio in library
      if (typeof url === 'string' && url.startsWith('blob:') && selectedAudioId && Array.isArray(libraryAudio) && libraryAudio.length > 0) {
        const libItem = libraryAudio.find(a => a && a.id === selectedAudioId);
        // If library has a non-blob URL (actual file URL), use that
        if (libItem?.url && typeof libItem.url === 'string' && !libItem.url.startsWith('blob:')) {
          return libItem.url;
        }
      }

      return url;
    } catch (error) {
      console.error('[SlideshowEditor] Error in selectedAudioUrl:', error);
      return null;
    }
  }, [selectedAudio, selectedAudioId, libraryAudio]);
  const selectedAudioStart = selectedAudio?.startTime || 0;
  const selectedAudioEnd = selectedAudio?.endTime || null;

  useEffect(() => {
    const el = audioRef.current;
    if (!selectedAudioUrl || !el) {
      loadedAudioKeyRef.current = null;
      setAudioReady(false);
      if (selectedAudio && !selectedAudioUrl) {
        setAudioError('Audio file unavailable - please re-add audio');
      }
      return;
    }

    // Check if it's an expired blob URL
    if (selectedAudioUrl.startsWith('blob:')) {
      console.warn('[SlideshowEditor] Audio has expired blob URL, checking library...');
      // Try to find in library by name or ID
      const audioName = selectedAudio?.name;
      if (audioName && Array.isArray(libraryAudio) && libraryAudio.length > 0) {
        const libItem = libraryAudio.find(a =>
          a && a.name === audioName && a.url && !a.url.startsWith('blob:')
        );
        if (libItem) {
          console.log('[SlideshowEditor] Found audio in library with valid URL, updating...');
          setSelectedAudio({ ...selectedAudio, url: libItem.url, localUrl: libItem.url });
          return;
        }
      }
      console.warn('[SlideshowEditor] Could not find valid URL for audio, showing error');
      setAudioError('Audio file expired - please re-add from library');
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


  // Handle audio file upload in slideshow editor - converts to MP3 if needed, saves to library, then opens trimmer
  const handleSlideshowAudioUpload = useCallback(async (e) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;

    try {
      const { convertAudioIfNeeded } = await import('../../utils/audioConverter');
      const { addToLibraryAsync } = await import('../../services/libraryService');
      const { uploadFile } = await import('../../services/firebaseStorage');

      const file = await convertAudioIfNeeded(rawFile);

      // Create temporary blob URL for immediate playback
      const tempUrl = URL.createObjectURL(file);

      // Get audio duration
      const audio = new Audio(tempUrl);
      await new Promise((resolve, reject) => {
        audio.addEventListener('loadedmetadata', resolve);
        audio.addEventListener('error', reject);
      });

      const duration = audio.duration;

      // Upload to Firebase Storage for persistence
      toastSuccess('Uploading audio...');
      const { url: storageUrl } = await uploadFile(file, 'audio', (progress) => {
        if (progress === 100) toastSuccess('Processing...');
      });

      // Create media item for library with persistent URL
      const mediaItem = {
        type: 'audio',
        name: file.name,
        url: storageUrl,
        localUrl: storageUrl,
        duration,
        createdAt: new Date().toISOString()
      };

      // Save to library (localStorage + Firestore)
      const savedItem = await addToLibraryAsync(db, artistId, mediaItem);

      // Clean up temp blob URL
      URL.revokeObjectURL(tempUrl);

      toastSuccess(`Added "${file.name}" to library`);

      // Open trimmer with the saved library audio
      setAudioToTrim({
        ...savedItem,
        startTime: 0,
        endTime: duration
      });
      setShowAudioTrimmer(true);
    } catch (error) {
      console.error('[SlideshowEditor] Audio upload failed:', error);
      toastError(`Failed to upload audio: ${error.message}`);
    }

    e.target.value = '';
  }, [db, artistId, toastSuccess, toastError]);

  // Helper to clean audio object for Firestore (removes non-serializable fields and undefined values)
  const cleanAudioForSave = (audio) => {
    if (!audio) return null;

    // Explicitly construct object with only the fields we want (no file, localUrl, etc.)
    const cleaned = {
      id: audio.id,
      name: audio.name,
      url: audio.url?.startsWith('blob:') ? null : audio.url,
      duration: audio.duration,
      startTime: audio.startTime || 0,
      endTime: audio.endTime || null,
      trimmedDuration: audio.trimmedDuration,
      isTrimmed: audio.isTrimmed
    };

    // Remove any undefined fields (Firestore doesn't accept undefined)
    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === undefined) {
        delete cleaned[key];
      }
    });

    // Don't save if we don't have a valid URL
    if (!cleaned.url) return null;

    return cleaned;
  };

  // Save active slideshow only (does NOT close editor so user can keep editing other timelines)
  const handleSave = useCallback(async () => {
    const activeSlideshow = allSlideshows[activeSlideshowIndex];
    if (!activeSlideshow) return;

    // Generate fresh thumbnail with current text overlays
    let thumbnail = activeSlideshow.slides[0]?.backgroundImage || activeSlideshow.slides[0]?.imageUrl || null;
    if (activeSlideshow.slides[0]) {
      try {
        thumbnail = await generateSlideThumbnail(activeSlideshow.slides[0], aspectRatio);
      } catch (err) {
        console.warn('[SlideshowEditor] Failed to generate thumbnail:', err);
      }
    }

    // Clean audio object before saving
    const cleanedAudio = cleanAudioForSave(activeSlideshow.audio);

    const slideshowData = {
      id: activeSlideshow.isTemplate ? (existingSlideshow?.id || `slideshow_${Date.now()}`) : activeSlideshow.id,
      name: activeSlideshow.name,
      aspectRatio,
      slides: activeSlideshow.slides,
      audio: cleanedAudio,
      thumbnail,
      status: 'draft',
      createdAt: existingSlideshow?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await onSave?.(slideshowData);
    toastSuccess(`Saved "${activeSlideshow.name}"`);
  }, [allSlideshows, activeSlideshowIndex, aspectRatio, existingSlideshow, onSave]);

  // Save all slideshows and close
  const handleSaveAllAndClose = useCallback(async () => {
    // Prepare all slideshow data first (parallel thumbnail generation)
    const slideshowsToSave = await Promise.all(
      allSlideshows.map(async (ss) => {
        let thumbnail = ss.slides[0]?.backgroundImage || ss.slides[0]?.imageUrl || null;
        if (ss.slides[0]) {
          try {
            thumbnail = await generateSlideThumbnail(ss.slides[0], aspectRatio);
          } catch (err) {
            console.warn('[SlideshowEditor] Failed to generate thumbnail:', err);
          }
        }

        // Clean audio object before saving
        const cleanedAudio = cleanAudioForSave(ss.audio);

        return {
          id: ss.isTemplate ? (existingSlideshow?.id || `slideshow_${Date.now()}`) : ss.id,
          name: ss.name,
          aspectRatio,
          slides: ss.slides,
          audio: cleanedAudio,
          thumbnail,
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      })
    );

    // Save all at once with a single Firestore sync (not in a loop)
    try {
      // Call onSave for each but add small delays to prevent Firestore write stream exhaustion
      for (let i = 0; i < slideshowsToSave.length; i++) {
        await onSave?.(slideshowsToSave[i]);
        // Add 100ms delay between saves to prevent overwhelming Firestore
        if (i < slideshowsToSave.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      toastSuccess(`Saved ${slideshowsToSave.length} slideshows`);
    } catch (err) {
      console.error(`[SlideshowEditor] Failed to save slideshows:`, err);
      toastError('Some slideshows failed to save');
      return; // Stop on failure
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
          // keepTemplateText controls whether to use template text or pull from text banks:
          //   'slideA' → keep text from slide 0 (even-indexed), pull banks for slide 1
          //   'slideB' → keep text from slide 1 (odd-indexed), pull banks for slide 0
          //   'both'   → keep text from ALL template slides (no bank replacement)
          //   'none'   → pull from text banks for all slides (original behavior)
          const templateOverlays = templateSlide.textOverlays || [];
          const slideTBank = textBanks[s] || textBanks[0] || [];
          const isSlideA = s % 2 === 0;  // even slides = A, odd = B
          const shouldKeepText =
            templateSlide.keepText === true ||
            keepTemplateText === 'all' ||
            keepTemplateText === 'both' || // legacy compat
            keepTemplateText === `slide_${s}` ||
            (keepTemplateText === 'slideA' && s === 0) || // legacy compat
            (keepTemplateText === 'slideB' && s === 1); // legacy compat
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
        thumbnail: images[0]?.url || slides[0]?.backgroundImage || slides[0]?.imageUrl || null,
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
            <button
              style={{
                ...styles.exportButton,
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
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
            {!isMobile && (
              <>
                {!schedulerEditMode && allSlideshows.length > 1 && (
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
                <button style={{ ...styles.saveButton, backgroundColor: '#059669', border: 'none', color: '#fff' }} onClick={handleSave}>
                  {schedulerEditMode ? 'Save' : 'Save Draft'}
                </button>
              </>
            )}
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
                {collections.filter(c => c.type !== 'smart').map(c => {
                  const migrated = migrateCollectionBanks(c);
                  const populatedBanks = (migrated.banks || []).filter(b => b?.length > 0);
                  if (populatedBanks.length === 0) return null;
                  const totalImages = populatedBanks.reduce((sum, b) => sum + b.length, 0);
                  return (
                    <React.Fragment key={c.id}>
                      <option value={`${c.id}:bank_0`}>{c.name} — All Banks ({totalImages})</option>
                      {(migrated.banks || []).map((bank, idx) => (
                        bank?.length > 0 && <option key={`${c.id}:bank_${idx}`} value={`${c.id}:bank_${idx}`}>&nbsp;&nbsp;{c.name} → {getBankLabel(idx)} ({bank.length})</option>
                      ))}
                    </React.Fragment>
                  );
                })}
                {categoryBankImages.some(b => (b || []).length > 0) && (categoryBankImages.length > 0 ? categoryBankImages : [[], []]).map((bank, idx) => (
                  (bank || []).length > 0 && <option key={`bank_${idx}`} value={`bank_${idx}`}>{getBankLabel(idx)} Bank (Category)</option>
                ))}
              </select>
            </div>

            {/* Dynamic Image Bank Columns + Text Banks */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Dynamic image bank columns */}
              {(() => {
                // Count banks from both category and collections to show all available bank columns
                const collectionMaxBanks = collections.reduce((max, col) => {
                  const migrated = migrateCollectionBanks(col);
                  return Math.max(max, (migrated.banks || []).length);
                }, 0);
                const numBanks = Math.max((categoryBankImages || []).length, collectionMaxBanks, 2);
                return Array.from({ length: numBanks }).map((_, idx) => {
                  const color = getBankColor(idx);
                  return (
                    <div key={`img-bank-${idx}`}
                      style={{
                        flex: 1, display: 'flex', flexDirection: 'column',
                        borderRight: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                        border: dragOverBankCol === idx ? `2px dashed ${color.border}` : undefined,
                        backgroundColor: dragOverBankCol === idx ? color.bg : undefined,
                        transition: 'all 0.15s ease'
                      }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverBankCol(idx); }}
                      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverBankCol(null); }}
                      onDrop={(e) => handleDropOnBankColumn(e, idx)}
                    >
                      <div style={{ padding: '6px 8px', fontSize: '11px', fontWeight: '600', color: color.light, borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: color.bg, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        {getBankLabel(idx)} Photos
                        <CloudImportButton
                          artistId={artistId}
                          db={db}
                          mediaType="image"
                          compact
                          onImportMedia={(files) => {
                            const newItems = files.map((f, i) => ({
                              id: `cloud_${Date.now()}_${i}`,
                              name: f.name,
                              url: f.url,
                              localUrl: f.localUrl,
                              type: 'image'
                            }));
                            setLibraryImages(prev => [...prev, ...newItems]);
                          }}
                        />
                        {idx >= MIN_BANKS && (
                          <button
                            title={`Delete ${getBankLabel(idx)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!window.confirm(`Delete ${getBankLabel(idx)}? Images will remain in your library.`)) return;
                              // Find which collection(s) have this bank and remove it
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
                              // Refresh collections state
                              setCollections(getCollections(artistId));
                              toastSuccess(`${getBankLabel(idx)} deleted`);
                            }}
                            style={{
                              background: 'none', border: 'none', color: color.light,
                              cursor: 'pointer', padding: '0 2px', fontSize: '14px',
                              opacity: 0.6, lineHeight: 1
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
                        {(() => {
                          const bankImages = (() => {
                            // If selectedSource points to a specific collection, use that
                            const colId = typeof selectedSource === 'string' && selectedSource.includes(':') ? selectedSource.split(':')[0] : null;
                            if (colId) {
                              const col = collections.find(c => c.id === colId);
                              if (col) {
                                const migrated = migrateCollectionBanks(col);
                                const ids = (migrated.banks || [])[idx] || [];
                                if (ids.length > 0) return libraryImages.filter(item => ids.includes(item.id));
                              }
                            }
                            // Try category banks
                            if ((categoryBankImages[idx] || []).length > 0) return categoryBankImages[idx];
                            // Aggregate from all collections
                            const allIds = new Set();
                            collections.forEach(col => {
                              const migrated = migrateCollectionBanks(col);
                              ((migrated.banks || [])[idx] || []).forEach(id => allIds.add(id));
                            });
                            if (allIds.size > 0) return libraryImages.filter(item => allIds.has(item.id));
                            return [];
                          })();
                          return bankImages.length === 0 ? (
                            <div style={{ fontSize: '11px', color: '#6b7280', padding: '16px 8px', textAlign: 'center' }}>
                              No images in {getBankLabel(idx)}
                            </div>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                              {bankImages.map(image => {
                                const isSel = selectedBankImages.has(image.id);
                                return (
                                  <div key={image.id} style={{ ...styles.clipCard, border: isSel ? `1px solid ${color.primary}80` : '1px solid transparent', position: 'relative' }}
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
                                    {isSel && <div style={{ position: 'absolute', inset: 0, backgroundColor: `${color.primary}33`, zIndex: 1, pointerEvents: 'none', borderRadius: '6px' }}><div style={{ position: 'absolute', bottom: 3, right: 3, width: '14px', height: '14px', backgroundColor: color.primary, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#fff', fontWeight: 'bold' }}>✓</div></div>}
                                    <img src={image.thumbnailUrl || image.url || image.localUrl} alt={image.name} style={styles.clipThumbnail} loading="lazy" />
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Text Banks Column */}
              <div style={{ flex: 1.2, minWidth: '160px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '4px 8px', fontSize: '10px', fontWeight: '600', color: '#f9a8d4', borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(236,72,153,0.08)', textAlign: 'center' }}>
                  Text Banks
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
                  {getTextBanks().map((textBank, idx) => {
                    const color = getBankColor(idx);
                    const inputVal = newTextInputs[idx] || '';
                    return (
                      <React.Fragment key={`tb-${idx}`}>
                        {idx > 0 && <div style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: '4px' }} />}
                        <div style={{ marginBottom: '4px' }}
                          onDragOver={(e) => { if (e.dataTransfer.types.includes('text/lyric')) { e.preventDefault(); e.currentTarget.style.outline = `1px dashed ${color.light}`; } }}
                          onDragLeave={(e) => { e.currentTarget.style.outline = 'none'; }}
                          onDrop={(e) => { e.preventDefault(); e.currentTarget.style.outline = 'none'; const text = e.dataTransfer.getData('text/lyric'); if (text) handleAddToTextBank(idx + 1, text); }}
                        >
                          <div style={{ fontSize: '10px', fontWeight: '600', color: color.light, marginBottom: '3px' }}>
                            {getBankLabel(idx)} Text
                          </div>
                          <div style={{ display: 'flex', gap: '3px', marginBottom: '2px' }}>
                            <input type="text" value={inputVal} onChange={(e) => setNewTextInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && inputVal.trim()) { handleAddToTextBank(idx + 1, inputVal); setNewTextInputs(prev => ({ ...prev, [idx]: '' })); } }}
                              placeholder="Add text..." style={{ flex: 1, padding: '3px 6px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '10px', outline: 'none' }} />
                            <button onClick={() => { if (inputVal.trim()) { handleAddToTextBank(idx + 1, inputVal); setNewTextInputs(prev => ({ ...prev, [idx]: '' })); } }} disabled={!inputVal.trim()}
                              style={{ padding: '3px 6px', borderRadius: '4px', border: 'none', backgroundColor: inputVal.trim() ? `${color.primary}4d` : 'rgba(255,255,255,0.05)', color: inputVal.trim() ? color.light : '#4b5563', fontSize: '10px', cursor: inputVal.trim() ? 'pointer' : 'default' }}>+</button>
                          </div>
                          {textBank.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {textBank.map((entry, i) => {
                                const entryText = getTextBankText(entry);
                                const entryStyle = getTextBankStyle(entry);
                                return (
                                <div key={i} style={{ display: 'flex', alignItems: 'stretch', gap: '2px' }}>
                                  <div onClick={() => {
                                    if (selectedSlideIndex >= 0 && slides[selectedSlideIndex]) {
                                      const newOverlay = { id: `text_${Date.now()}_${i}`, text: entryText, style: entryStyle ? { ...entryStyle } : getDefaultTextStyle(), position: { x: 50, y: 50, width: 80, height: 20 } };
                                      setSlides(prev => prev.map((slide, si) => si === selectedSlideIndex ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] } : slide));
                                      setEditingTextId(newOverlay.id);
                                    }
                                  }} style={{ flex: 1, padding: '4px 6px', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px 0 0 4px', color: '#d1d5db', fontSize: '10px', cursor: 'pointer', lineHeight: '1.3', wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: '4px' }} title={entryStyle ? `Click to add as overlay (styled: ${entryStyle.fontFamily || ''})` : 'Click to add as overlay'}>
                                    {entryStyle && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: entryStyle.color || '#fff', flexShrink: 0, border: '1px solid rgba(255,255,255,0.2)' }} />}
                                    {entryText}
                                  </div>
                                  <button onClick={(e) => { e.stopPropagation(); handleRemoveFromTextBank(idx + 1, i); }}
                                    style={{ padding: '0 5px', backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.2)', borderLeft: 'none', borderRadius: '0 4px 4px 0', color: '#ef4444', fontSize: '9px', cursor: 'pointer', flexShrink: 0 }} title="Remove">×</button>
                                </div>
                                );
                              })}
                            </div>
                          ) : <div style={{ fontSize: '9px', color: '#6b7280', padding: '2px', textAlign: 'center' }}>No text yet</div>}
                        </div>
                      </React.Fragment>
                    );
                  })}
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
                const isImageBank = activeBank.startsWith('image');
                const displayImages = isImageBank ? activeImages : activeContent;
                const sourceName = (() => {
                  const bankMatch = selectedSource.match(/^bank_(\d+)$/);
                  if (bankMatch) return getBankLabel(parseInt(bankMatch[1], 10));
                  if (selectedSource === 'all') return 'Library';
                  return collections.find(c => selectedSource.startsWith(c.id))?.name || 'Collection';
                })();
                return displayImages.length === 0 ? (
                  <div style={styles.emptyBank}>
                    <p>No images in {sourceName}</p>
                    <p style={styles.emptySubtext}>Upload images in the Aesthetic Home</p>
                    {onImportToBank && isImageBank && (
                      <button
                        style={{
                          marginTop: '8px', padding: '8px 16px', borderRadius: '8px',
                          border: '1px solid rgba(99,102,241,0.4)', backgroundColor: 'rgba(99,102,241,0.15)',
                          color: '#a5b4fc', fontSize: '12px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                        onClick={() => { const m = activeBank.match(/^image(\d+)$/); importBankIndexRef.current = m ? parseInt(m[1], 10) : 0; importImageGenericRef.current?.click(); }}
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
                      const isInSlides = slides.some(s => s.sourceImageId === image.id);
                      return (
                      <div
                        key={image.id}
                        style={{
                          ...styles.clipCard,
                          border: isSel ? '1px solid rgba(99, 102, 241, 0.5)' : isInSlides ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
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
                            sourceBank: (() => {
                      const m = selectedSource.match(/(?:.*:)?bank_(\d+)$/);
                      return m ? `image${m[1]}` : selectedSource;
                    })()
                          }));
                        }}
                        onMouseEnter={(e) => {
                          if (!isSel) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSel) e.currentTarget.style.backgroundColor = '';
                        }}
                      >
                        {/* In-slides indicator — green checkmark top-right */}
                        {isInSlides && (
                          <div style={{
                            position: 'absolute', top: 3, right: 3, zIndex: 2,
                            width: '16px', height: '16px', borderRadius: '50%',
                            backgroundColor: '#22c55e', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: '9px', color: '#fff', fontWeight: 'bold',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.4)', pointerEvents: 'none'
                          }}>✓</div>
                        )}
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
                  {onImportToBank && activeBank.startsWith('image') && (
                    <button
                      style={{
                        marginTop: '8px', padding: '6px 12px', borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)',
                        color: '#9ca3af', fontSize: '11px', cursor: 'pointer', width: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                      }}
                      onClick={() => { const m = activeBank.match(/^image(\d+)$/); importBankIndexRef.current = m ? parseInt(m[1], 10) : 0; importImageGenericRef.current?.click(); }}
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

            {/* Scrollable area: canvas + audio */}
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 24px 4px', minHeight: 0 }}>

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
                  maxHeight: 'calc(95vh - 340px)',
                  aspectRatio: `${baseDimensions.width}/${baseDimensions.height}`
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

                {/* Text Overlays — draggable */}
                {(currentSlide?.textOverlays || []).map(overlay => {
                  if (!overlay?.id) return null;
                  const pos = overlay.position || { x: 50, y: 50, width: 80 };
                  const st = overlay.style || { fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: '700', color: '#ffffff', textAlign: 'center' };
                  const isSelected = editingTextId === overlay.id;
                  const isDragging = draggingTextId === overlay.id;
                  return (
                    <div
                      key={overlay.id}
                      style={{
                        ...styles.textOverlay,
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        transform: 'translate(-50%, -50%)',
                        width: `${pos.width || 80}%`,
                        fontSize: `${(st.fontSize || 48) * previewScale}px`,
                        fontFamily: st.fontFamily || 'Inter, sans-serif',
                        fontWeight: st.fontWeight || '700',
                        color: st.color || '#ffffff',
                        textAlign: st.textAlign || 'center',
                        textTransform: st.textTransform || 'none',
                        WebkitTextStroke: (() => {
                          const stroke = st.textStroke;
                          if (!stroke) return 'none';
                          const parsed = parseStroke(stroke);
                          return parsed.width > 0 ? stroke : 'none';
                        })(),
                        textShadow: st.outline
                          ? `0 0 ${4 * previewScale}px ${st.outlineColor || 'rgba(0,0,0,0.5)'}`
                          : 'none',
                        cursor: isDragging ? 'grabbing' : 'grab',
                        border: isSelected ? '1px dashed rgba(99,102,241,0.8)' : '1px dashed transparent',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        transition: isDragging ? 'none' : 'border-color 0.15s',
                        backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : 'transparent',
                        boxSizing: 'border-box',
                        overflow: 'hidden',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap'
                      }}
                      onMouseDown={(e) => handleTextMouseDown(e, overlay.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTextClick(e, overlay.id);
                      }}
                    >
                      {overlay.text || ''}
                      {isSelected && (
                        <>
                          <div style={{
                            position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)',
                            fontSize: '8px', color: 'rgba(163,180,252,0.9)', whiteSpace: 'nowrap',
                            backgroundColor: 'rgba(30,30,40,0.85)', padding: '1px 5px', borderRadius: '3px',
                            pointerEvents: 'none'
                          }}>drag to move</div>
                          {/* Right-edge resize handle */}
                          <div
                            style={{
                              position: 'absolute', right: '-4px', top: '50%', transform: 'translateY(-50%)',
                              width: '8px', height: '24px', backgroundColor: 'rgba(99,102,241,0.8)',
                              borderRadius: '3px', cursor: 'ew-resize', zIndex: 5
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setResizingTextId(overlay.id);
                              resizeStartRef.current = {
                                mouseX: e.clientX,
                                startWidth: overlay.position.width || 80
                              };
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

              {/* Audio Player Controls */}
              {selectedAudio && (
                <div style={styles.audioPlayerBar}>
                  <button
                    style={{
                      ...styles.playPauseBtn,
                      ...(!audioReady && !audioError ? { opacity: 0.5 } : {}),
                      ...(audioError ? { backgroundColor: '#ef4444' } : {})
                    }}
                    onClick={handlePlayPause}
                    disabled={!audioReady || !!audioError}
                  >
                    {!audioReady && !audioError ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
                      </svg>
                    ) : audioError ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                      </svg>
                    ) : isPlaying ? (
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
                    <span style={styles.audioPlayerName}>
                      {audioError ? (
                        <span style={{ color: '#ef4444' }}>
                          Audio expired - <button
                            onClick={() => setShowAudioSelectionModal(true)}
                            style={{ color: '#6366f1', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
                          >
                            select from library
                          </button>
                        </span>
                      ) : selectedAudio.name}
                    </span>
                    <span style={styles.audioPlayerTime}>
                      {!audioReady && !audioError
                        ? 'Loading...'
                        : `${formatTime(currentTime)} / ${formatTime(audioDuration)}`
                      }
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
                  <button
                    onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}
                    style={{
                      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                      border: '1px solid rgba(34,197,94,0.3)', backgroundColor: 'transparent',
                      color: '#86efac', cursor: 'pointer', flexShrink: 0
                    }}
                  >Trim</button>
                  {isMultiDraftMode && allSlideshows.length > 1 && (
                    <button
                      onClick={handleApplyAudioToAll}
                      style={{
                        padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                        border: `1px solid ${theme.accent.primary}40`, backgroundColor: 'transparent',
                        color: theme.accent.primary, cursor: 'pointer', flexShrink: 0
                      }}
                    >Apply to All</button>
                  )}
                  <button
                    onClick={handleRemoveAudio}
                    style={{
                      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                      border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'transparent',
                      color: '#ef4444', cursor: 'pointer', flexShrink: 0
                    }}
                  >Remove</button>
                  {isMultiDraftMode && allSlideshows.length > 1 && (
                    <button
                      onClick={handleRemoveAudioFromAll}
                      style={{
                        padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                        border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'transparent',
                        color: '#ef4444', cursor: 'pointer', flexShrink: 0
                      }}
                    >Remove All</button>
                  )}
                </div>
              )}

              {/* Hidden file inputs for importing to banks */}
              <input
                ref={importImageARef}
                type="file"
                accept="image/*,.heic,.heif,.tif,.tiff"
                multiple
                onChange={(e) => handleImportImages(e, 'A')}
                style={{ display: 'none' }}
              />
              <input
                ref={importImageBRef}
                type="file"
                accept="image/*,.heic,.heif,.tif,.tiff"
                multiple
                onChange={(e) => handleImportImages(e, 'B')}
                style={{ display: 'none' }}
              />
              <input
                ref={importImageGenericRef}
                type="file"
                accept="image/*,.heic,.heif,.tif,.tiff"
                multiple
                onChange={(e) => handleImportImages(e, importBankIndexRef.current)}
                style={{ display: 'none' }}
              />

              {/* Hidden audio input for slideshow */}
              <input
                ref={slideshowAudioInputRef}
                type="file"
                accept="audio/*,.m4a,.wav,.aif,.aiff"
                onChange={handleSlideshowAudioUpload}
                style={{ display: 'none' }}
              />

            </div>{/* end scrollable area */}

              {/* Canvas Actions — sticky bottom toolbar */}
              <div style={{ ...styles.canvasActions, padding: '4px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
                {/* Undo / Redo */}
                <button
                  style={{ ...styles.rerollButton, opacity: canUndo ? 1 : 0.35, pointerEvents: canUndo ? 'auto' : 'none' }}
                  onClick={handleUndo}
                  title="Undo (⌘Z)"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                  const tBanks = getTextBanks();
                  const hasTextBanks = tBanks.some(b => b?.length > 0);
                  return hasTextBanks ? (
                    <button
                      style={styles.rerollButton}
                      onClick={() => handleTextReroll()}
                      title="Replace text with random text from banks"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 7V4h16v3M9 20h6M12 4v16"/>
                      </svg>
                      Reroll Text
                    </button>
                  ) : null;
                })()}

                {/* Add Text Button */}
                <button style={styles.addTextButton} onClick={() => { addTextOverlay(); }} title="Add text overlay">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                      gap: '4px',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#f87171',
                      cursor: 'pointer',
                      fontSize: '11px',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'; }}
                    title="Delete current slide (Delete key)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                    Delete
                  </button>
                )}

                {/* Add Audio Button */}
                <button
                  style={styles.addAudioButton}
                  onClick={() => setShowAudioSelectionModal(true)}
                  title="Add audio to slideshow"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                  </svg>
                  Audio
                </button>

                {/* AI Transcribe Button */}
                {selectedAudio && (
                  <button
                    style={styles.aiTranscribeButton}
                    onClick={() => setShowLyricAnalyzer(true)}
                    title="AI transcribe audio to add lyrics"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                      <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                    Transcribe
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
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <path d="M14 2v6h6"/>
                      </svg>
                      Lyrics
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('text/lyric', lyric.content || lyric.title || '');
                                  e.dataTransfer.effectAllowed = 'copy';
                                }}
                                style={{
                                  ...styles.lyricBankDropdownItem,
                                  ...(linkedLyricId === lyric.id ? { border: '1px solid #6366f1', backgroundColor: 'rgba(99,102,241,0.15)' } : {})
                                }}
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
                                        ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] }
                                        : slide
                                    ));
                                    setEditingTextId(newOverlay.id);
                                    // Text editor is now inline — editingTextId activates it
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
                                  {linkedLyricId === lyric.id && <span style={{ marginLeft: '4px', fontSize: '8px', color: '#6366f1', fontWeight: 700 }}>LINKED</span>}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                        <div
                          style={styles.lyricBankDropdownAddNew}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLyricsPromptValue('');
                            setShowLyricsPrompt(true);
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

            {/* ─── Inline Text Editor Bar ─── */}
            {editingTextId && currentSlide && (() => {
              const selOverlay = currentSlide.textOverlays?.find(o => o.id === editingTextId);
              if (!selOverlay) return null;
              return (
                <div style={{
                  borderTop: '1px solid rgba(99,102,241,0.25)',
                  backgroundColor: 'rgba(30,30,50,0.95)',
                  padding: '10px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  {/* Row 1: Text input + close */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <textarea
                      rows={2}
                      value={selOverlay.text}
                      onChange={(e) => updateTextOverlay(selOverlay.id, { text: e.target.value })}
                      placeholder="Enter text..."
                      style={{
                        flex: 1, padding: '7px 10px', borderRadius: '6px',
                        border: '1px solid rgba(99,102,241,0.3)', backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#fff', fontSize: '13px', outline: 'none', resize: 'vertical',
                        fontFamily: 'inherit', lineHeight: '1.4'
                      }}
                    />
                    <button
                      onClick={() => { removeTextOverlay(selOverlay.id); setEditingTextId(null); }}
                      style={{
                        padding: '6px', borderRadius: '5px', border: '1px solid rgba(239,68,68,0.3)',
                        backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer',
                        display: 'flex', alignItems: 'center'
                      }}
                      title="Delete text block"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => setEditingTextId(null)}
                      style={{
                        padding: '6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.15)',
                        backgroundColor: 'transparent', color: '#9ca3af', cursor: 'pointer',
                        display: 'flex', alignItems: 'center'
                      }}
                      title="Done editing"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </button>
                    {/* Add to Bank button with dropdown */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowAddToBankPicker(prev => !prev)}
                        style={{
                          padding: '4px 8px', borderRadius: '5px', border: '1px solid rgba(236,72,153,0.3)',
                          backgroundColor: showAddToBankPicker ? 'rgba(236,72,153,0.2)' : 'rgba(236,72,153,0.1)',
                          color: '#f9a8d4', cursor: 'pointer', fontSize: '10px', fontWeight: '600',
                          display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap'
                        }}
                        title="Save styled text to a text bank"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14"/>
                        </svg>
                        Bank
                      </button>
                      {showAddToBankPicker && (() => {
                        const banks = getTextBanks();
                        const bankCount = Math.max(banks.length, 2);
                        return (
                          <div style={{
                            position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 20,
                            backgroundColor: '#1e1e2e', border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: '6px', padding: '4px', minWidth: '120px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
                          }}>
                            {Array.from({ length: bankCount }, (_, i) => (
                              <button key={i}
                                onClick={() => {
                                  const styledEntry = { text: selOverlay.text, style: { ...selOverlay.style } };
                                  handleAddToTextBank(i + 1, styledEntry);
                                  setShowAddToBankPicker(false);
                                  toastSuccess(`Added to ${getBankLabel(i)} Text bank`);
                                }}
                                style={{
                                  display: 'block', width: '100%', padding: '5px 8px', border: 'none',
                                  backgroundColor: 'transparent', color: getBankColor(i).light,
                                  fontSize: '11px', cursor: 'pointer', borderRadius: '4px', textAlign: 'left'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                              >
                                {getBankLabel(i)} Text
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Row 2: Font, Size, Color, Align, Position */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Font */}
                    <select
                      value={selOverlay.style.fontFamily}
                      onChange={(e) => updateTextOverlay(selOverlay.id, {
                        style: { ...selOverlay.style, fontFamily: e.target.value }
                      })}
                      style={{
                        padding: '5px 6px', borderRadius: '5px',
                        border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#d1d5db', fontSize: '11px', outline: 'none', maxWidth: '100px'
                      }}
                    >
                      {AVAILABLE_FONTS.map(f => (
                        <option key={f.name} value={f.value}>{f.name}</option>
                      ))}
                    </select>

                    {/* Size controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                      <button onClick={() => updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, fontSize: Math.max(12, selOverlay.style.fontSize - 4) } })}
                        style={{ padding: '4px 8px', border: 'none', backgroundColor: 'rgba(255,255,255,0.06)', color: '#d1d5db', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>A-</button>
                      <span style={{ padding: '4px 6px', backgroundColor: 'rgba(255,255,255,0.03)', color: '#9ca3af', fontSize: '11px', minWidth: '32px', textAlign: 'center' }}>{selOverlay.style.fontSize}</span>
                      <button onClick={() => updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, fontSize: Math.min(120, selOverlay.style.fontSize + 4) } })}
                        style={{ padding: '4px 8px', border: 'none', backgroundColor: 'rgba(255,255,255,0.06)', color: '#d1d5db', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>A+</button>
                    </div>

                    {/* Color */}
                    <input
                      type="color"
                      value={selOverlay.style.color}
                      onChange={(e) => updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, color: e.target.value } })}
                      style={{ width: '28px', height: '28px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', cursor: 'pointer', backgroundColor: 'transparent', padding: '1px' }}
                    />

                    {/* Divider */}
                    <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(255,255,255,0.1)' }} />

                    {/* Text Align */}
                    {['left', 'center', 'right'].map(align => (
                      <button
                        key={align}
                        onClick={() => updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, textAlign: align } })}
                        style={{
                          padding: '5px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                          backgroundColor: selOverlay.style.textAlign === align ? 'rgba(99,102,241,0.3)' : 'transparent',
                          color: selOverlay.style.textAlign === align ? '#a5b4fc' : '#6b7280'
                        }}
                        title={`Align ${align}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          {align === 'left' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></>}
                          {align === 'center' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></>}
                          {align === 'right' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></>}
                        </svg>
                      </button>
                    ))}

                    {/* Divider */}
                    <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(255,255,255,0.1)' }} />

                    {/* Auto-Align Position buttons */}
                    <button
                      onClick={() => updateTextOverlay(selOverlay.id, { position: { ...selOverlay.position, x: 50 } })}
                      style={{
                        padding: '4px 8px', borderRadius: '5px', border: '1px solid rgba(99,102,241,0.25)',
                        backgroundColor: Math.abs(selOverlay.position.x - 50) < 1 ? 'rgba(99,102,241,0.2)' : 'transparent',
                        color: Math.abs(selOverlay.position.x - 50) < 1 ? '#a5b4fc' : '#6b7280',
                        cursor: 'pointer', fontSize: '10px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '3px'
                      }}
                      title="Center horizontally"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="2" x2="12" y2="22"/><polyline points="8 6 12 2 16 6"/><polyline points="8 18 12 22 16 18"/>
                      </svg>
                      H
                    </button>
                    <button
                      onClick={() => updateTextOverlay(selOverlay.id, { position: { ...selOverlay.position, y: 50 } })}
                      style={{
                        padding: '4px 8px', borderRadius: '5px', border: '1px solid rgba(99,102,241,0.25)',
                        backgroundColor: Math.abs(selOverlay.position.y - 50) < 1 ? 'rgba(99,102,241,0.2)' : 'transparent',
                        color: Math.abs(selOverlay.position.y - 50) < 1 ? '#a5b4fc' : '#6b7280',
                        cursor: 'pointer', fontSize: '10px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '3px'
                      }}
                      title="Center vertically"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="2" y1="12" x2="22" y2="12"/><polyline points="6 8 2 12 6 16"/><polyline points="18 8 22 12 18 16"/>
                      </svg>
                      V
                    </button>

                    {/* Bold toggle */}
                    <button
                      onClick={() => updateTextOverlay(selOverlay.id, {
                        style: { ...selOverlay.style, fontWeight: selOverlay.style.fontWeight === '700' ? '400' : '700' }
                      })}
                      style={{
                        padding: '5px 7px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                        backgroundColor: selOverlay.style.fontWeight === '700' ? 'rgba(99,102,241,0.3)' : 'transparent',
                        color: selOverlay.style.fontWeight === '700' ? '#a5b4fc' : '#6b7280',
                        fontWeight: '700', fontSize: '13px'
                      }}
                      title="Bold"
                    >B</button>

                    {/* ALL CAPS toggle */}
                    <button
                      onClick={() => updateTextOverlay(selOverlay.id, {
                        style: { ...selOverlay.style, textTransform: selOverlay.style.textTransform === 'uppercase' ? 'none' : 'uppercase' }
                      })}
                      style={{
                        padding: '4px 7px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                        backgroundColor: selOverlay.style.textTransform === 'uppercase' ? 'rgba(99,102,241,0.3)' : 'transparent',
                        color: selOverlay.style.textTransform === 'uppercase' ? '#a5b4fc' : '#6b7280',
                        fontSize: '10px', fontWeight: '700', letterSpacing: '1px'
                      }}
                      title="ALL CAPS"
                    >AA</button>

                    {/* all lowercase toggle */}
                    <button
                      onClick={() => updateTextOverlay(selOverlay.id, {
                        style: { ...selOverlay.style, textTransform: selOverlay.style.textTransform === 'lowercase' ? 'none' : 'lowercase' }
                      })}
                      style={{
                        padding: '4px 7px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                        backgroundColor: selOverlay.style.textTransform === 'lowercase' ? 'rgba(99,102,241,0.3)' : 'transparent',
                        color: selOverlay.style.textTransform === 'lowercase' ? '#a5b4fc' : '#6b7280',
                        fontSize: '10px', fontWeight: '700', letterSpacing: '1px'
                      }}
                      title="all lowercase"
                    >aa</button>

                    {/* Outline toggle */}
                    <button
                      onClick={() => updateTextOverlay(selOverlay.id, {
                        style: { ...selOverlay.style, outline: !selOverlay.style.outline }
                      })}
                      style={{
                        padding: '4px 7px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                        backgroundColor: selOverlay.style.outline ? 'rgba(99,102,241,0.3)' : 'transparent',
                        color: selOverlay.style.outline ? '#a5b4fc' : '#6b7280',
                        fontSize: '11px', fontWeight: '600'
                      }}
                      title="Text shadow/outline"
                    >Sh</button>

                    {/* Text stroke toggle — on/off */}
                    <button
                      onClick={() => {
                        const currentStroke = parseStroke(selOverlay.style.textStroke);
                        const hasStroke = currentStroke.width > 0;
                        updateTextOverlay(selOverlay.id, {
                          style: {
                            ...selOverlay.style,
                            textStroke: hasStroke ? buildStroke(0, currentStroke.color) : buildStroke(0.1, '#000000')
                          }
                        });
                      }}
                      style={{
                        padding: '4px 7px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                        backgroundColor: (() => { const w = parseStroke(selOverlay.style.textStroke).width; return w > 0 ? 'rgba(99,102,241,0.3)' : 'transparent'; })(),
                        color: (() => { const w = parseStroke(selOverlay.style.textStroke).width; return w > 0 ? '#a5b4fc' : '#6b7280'; })(),
                        fontSize: '11px', fontWeight: '600'
                      }}
                      title={(() => { const w = parseStroke(selOverlay.style.textStroke).width; return w > 0 ? 'Remove text stroke' : 'Add text stroke'; })()}
                    >St</button>
                  </div>

                  {/* Stroke width + color controls (when stroke is active) */}
                  {(() => {
                    const { width: strokeW, color: strokeC } = parseStroke(selOverlay.style.textStroke);
                    if (strokeW === 0) return null;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '4px' }}>
                        <span style={{ color: '#9ca3af', fontSize: '11px' }}>Stroke</span>
                        <button
                          onClick={() => { const nw = Math.round(Math.max(0, strokeW - 0.1) * 10) / 10; updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, textStroke: buildStroke(nw, strokeC) } }); }}
                          style={{
                            width: '22px', height: '22px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)',
                            backgroundColor: 'transparent', color: '#9ca3af', cursor: strokeW > 0 ? 'pointer' : 'not-allowed',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700',
                            opacity: strokeW > 0.1 ? 1 : 0.4
                          }}
                        >−</button>
                        <span style={{ color: '#fff', fontSize: '11px', minWidth: '30px', textAlign: 'center' }}>{strokeW}px</span>
                        <button
                          onClick={() => { const nw = Math.round(Math.min(10, strokeW + 0.1) * 10) / 10; updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, textStroke: buildStroke(nw, strokeC) } }); }}
                          style={{
                            width: '22px', height: '22px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)',
                            backgroundColor: 'transparent', color: '#9ca3af', cursor: strokeW < 10 ? 'pointer' : 'not-allowed',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700',
                            opacity: strokeW < 10 ? 1 : 0.4
                          }}
                        >+</button>
                        <input
                          type="color"
                          value={strokeC.startsWith('#') ? strokeC : '#000000'}
                          onChange={(e) => updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, textStroke: buildStroke(strokeW, e.target.value) } })}
                          style={{ width: '24px', height: '22px', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: 0, background: 'transparent' }}
                          title="Stroke color"
                        />
                      </div>
                    );
                  })()}
                </div>
              );
            })()}


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
                      {/* Per-slide keep-text toggle */}
                      <button
                        style={{
                          position: 'absolute',
                          bottom: '2px',
                          left: '2px',
                          width: '18px',
                          height: '18px',
                          borderRadius: '3px',
                          background: slide.keepText ? 'rgba(99,102,241,0.85)' : 'rgba(0,0,0,0.5)',
                          border: slide.keepText ? '1px solid rgba(99,102,241,0.9)' : '1px solid rgba(255,255,255,0.15)',
                          color: slide.keepText ? '#fff' : 'rgba(255,255,255,0.5)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          zIndex: 2,
                          fontSize: '9px',
                          fontWeight: 700
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSlides(prev => prev.map((s, i) => i === index ? { ...s, keepText: !s.keepText } : s));
                        }}
                        title={slide.keepText ? 'Keep text on generate (click to disable)' : 'Click to keep this slide\'s text on generate'}
                      >T</button>
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

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
                <div style={{ ...styles.slideCount, fontSize: '10px' }}>
                  {slides.length}/10
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {schedulerEditMode ? (
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>Editing scheduled post</span>
                  ) : isMultiDraftMode ? (
                    <span style={{ fontSize: '11px', color: '#a5b4fc', fontWeight: '600' }}>Editing {allSlideshows.length} drafts</span>
                  ) : <>
                  {/* Template quick-switch */}
                  <button
                    onClick={() => switchToSlideshow(0)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid ' + (activeSlideshowIndex === 0 ? '#818cf8' : 'rgba(255,255,255,0.1)'),
                      backgroundColor: activeSlideshowIndex === 0 ? '#6366f1' : 'rgba(255,255,255,0.06)',
                      color: activeSlideshowIndex === 0 ? '#fff' : '#9ca3af',
                      fontSize: '10px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.15s'
                    }}
                    title="Switch to template"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <line x1="3" y1="9" x2="21" y2="9"/>
                      <line x1="9" y1="21" x2="9" y2="9"/>
                    </svg>
                    Template
                  </button>
                  {/* Count selector */}
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={generateCount}
                    onChange={(e) => setGenerateCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                    style={{
                      width: '44px',
                      padding: '5px 4px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.12)',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      color: '#fff',
                      fontSize: '12px',
                      textAlign: 'center',
                      outline: 'none'
                    }}
                    title="Number of slideshows to generate"
                  />
                  {/* Keep template text toggle */}
                  <span style={{ fontSize: '9px', color: '#9ca3af', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Keep Text:</span>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '1px',
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    borderRadius: '5px', border: '1px solid rgba(255,255,255,0.08)',
                    padding: '1px'
                  }} title="Keep exact text from template: Randomize = pull from text banks, per-slide = keep that slide's text, All = keep all text">
                    {[
                      ...slides.map((_, i) => ({ value: `slide_${i}`, label: `S${i + 1}` })),
                      { value: 'all', label: 'All' },
                      { value: 'none', label: 'Random' }
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setKeepTemplateText(opt.value)}
                        style={{
                          padding: '2px 5px',
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: keepTemplateText === opt.value ? 'rgba(99,102,241,0.6)' : 'transparent',
                          color: keepTemplateText === opt.value ? '#fff' : '#9ca3af',
                          fontSize: '9px',
                          fontWeight: keepTemplateText === opt.value ? '700' : '500',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          letterSpacing: '0.3px'
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* Generate button */}
                  <button
                    onClick={handleGenerateMore}
                    disabled={isGenerating}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      background: isGenerating ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      color: '#fff',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: isGenerating ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                      whiteSpace: 'nowrap'
                    }}
                    title={`Generate ${generateCount} more slideshows from this template`}
                  >
                    {isGenerating ? (
                      <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Generating...</>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 5v14M5 12h14"/>
                        </svg>
                        Generate
                      </>
                    )}
                  </button>
                  {allSlideshows.length > 1 && (
                    <>
                      <span style={{ fontSize: '10px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {allSlideshows.length} total
                      </span>
                      <button
                        onClick={handleApplyTemplateToAll}
                        title="Apply template text styles to all generated slideshows"
                        style={{
                          padding: '4px 8px',
                          marginLeft: '8px',
                          borderRadius: '4px',
                          border: '1px solid #4b5563',
                          background: '#1f2937',
                          color: '#d1d5db',
                          fontSize: '11px',
                          fontWeight: '500',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.background = '#374151';
                          e.target.style.borderColor = '#6b7280';
                          e.target.style.color = '#f3f4f6';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = '#1f2937';
                          e.target.style.borderColor = '#4b5563';
                          e.target.style.color = '#d1d5db';
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M7 12c0-1.657 1.343-3 3-3h4c1.657 0 3 1.343 3 3v4c0 1.657-1.343 3-3 3h-4c-1.657 0-3-1.343-3-3v-4zM3 3l9 9M15 21l-9-9"/>
                        </svg>
                        Apply Style
                      </button>
                    </>
                  )}
                  </>}
                </div>
              </div>
            </div>

            {/* ─── Timeline Switcher ─── */}
            <div style={{
              borderTop: '1px solid rgba(255,255,255,0.08)',
              padding: '6px 16px',
              backgroundColor: 'rgba(0,0,0,0.15)',
              flexShrink: 0
            }}>
              {/* Scrollable row of timeline tabs */}
              <div style={{
                display: 'flex',
                gap: '6px',
                overflowX: 'auto',
                paddingBottom: '4px',
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
                      gap: '4px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      backgroundColor: idx === activeSlideshowIndex ? '#6366f1' : 'rgba(255,255,255,0.06)',
                      border: '1px solid ' + (idx === activeSlideshowIndex ? '#818cf8' : 'rgba(255,255,255,0.08)'),
                      color: idx === activeSlideshowIndex ? '#fff' : '#9ca3af',
                      fontSize: '11px',
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
                textBank1={getTextBanks()[0] || []}
                textBank2={getTextBanks()[1] || []}
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
                      ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] }
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
                      ? { ...slide, textOverlays: [...(slide.textOverlays || []), newOverlay] }
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
                          textOverlays: (slide.textOverlays || []).map(overlay =>
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
                          textOverlays: (slide.textOverlays || []).filter(o => o.id !== overlayId)
                        }
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
                handleAddLyricsAndRefresh={handleAddLyricsAndRefresh}
                toastSuccess={toastSuccess}
                linkedLyricId={linkedLyricId}
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

            {/* Caption & hashtags managed in Scheduler */}
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', padding: '4px 0', fontStyle: 'italic' }}>
              Caption & hashtags can be added in the Scheduler
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
            db={db}
            artistId={artistId}
            onSuccess={(msg) => toastSuccess(msg)}
            onError={(msg) => toastError(msg)}
          />
        )}

        {/* Audio Selection Modal */}
        {showAudioSelectionModal && (
          <AudioSelectionModal
            libraryAudio={Array.isArray(libraryAudio) ? libraryAudio : []}
            collections={Array.isArray(collections) ? collections : []}
            selectedAudioId={selectedAudio?.id || null}
            currentCollectionId={null}
            onSelect={(audio) => {
              try {
                setShowAudioSelectionModal(false);
                setAudioToTrim(audio);
                setShowAudioTrimmer(true);
              } catch (error) {
                console.error('[AudioSelectionModal] onSelect error:', error);
                toastError('Failed to select audio');
              }
            }}
            onUpload={() => {
              try {
                setShowAudioSelectionModal(false);
                slideshowAudioInputRef.current?.click();
              } catch (error) {
                console.error('[AudioSelectionModal] onUpload error:', error);
                toastError('Failed to open upload');
              }
            }}
            onClose={() => setShowAudioSelectionModal(false)}
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
                    setShowAudioSelectionModal(true);
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

      {/* Inline Lyrics Prompt Modal */}
      {showLyricsPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: theme.overlay.heavy, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowLyricsPrompt(false)}>
          <div style={{ background: theme.bg.input, borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Add Lyrics</div>
            <textarea autoFocus value={lyricsPromptValue} onChange={e => setLyricsPromptValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setShowLyricsPrompt(false); }}
              placeholder="Enter lyrics to add to bank..."
              style={{ width: '100%', minHeight: 100, background: theme.bg.page, border: `1px solid ${theme.bg.elevated}`, borderRadius: 8, padding: 12, color: theme.text.primary, fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setShowLyricsPrompt(false)}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${theme.bg.elevated}`, background: 'transparent', color: theme.text.secondary, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                const text = lyricsPromptValue;
                if (text?.trim()) { handleAddLyricsAndRefresh({ title: text.split('\n')[0].slice(0, 30) || 'New Lyrics', content: text.trim() }); }
                setShowLyricsPrompt(false);
              }} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: theme.accent.primary, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Template Name Prompt Modal */}
      {showTemplatePrompt && (
        <div style={{ position: 'fixed', inset: 0, background: theme.overlay.heavy, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowTemplatePrompt(false)}>
          <div style={{ background: theme.bg.input, borderRadius: 12, padding: 24, width: 360, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Save Template</div>
            <input autoFocus value={templatePromptValue} onChange={e => setTemplatePromptValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setShowTemplatePrompt(false);
                if (e.key === 'Enter' && templatePromptValue.trim() && pendingTemplateStyle) {
                  handleSaveTemplate({ id: `template_${Date.now()}`, name: templatePromptValue.trim(), style: { ...pendingTemplateStyle } });
                  setShowTemplatePrompt(false);
                }
              }}
              placeholder="Template name..."
              style={{ width: '100%', background: theme.bg.page, border: `1px solid ${theme.bg.elevated}`, borderRadius: 8, padding: '10px 12px', color: theme.text.primary, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setShowTemplatePrompt(false)}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${theme.bg.elevated}`, background: 'transparent', color: theme.text.secondary, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                if (templatePromptValue.trim() && pendingTemplateStyle) {
                  handleSaveTemplate({ id: `template_${Date.now()}`, name: templatePromptValue.trim(), style: { ...pendingTemplateStyle } });
                }
                setShowTemplatePrompt(false);
              }} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: theme.accent.primary, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Save</button>
            </div>
          </div>
        </div>
      )}

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
  isMobile = false,
  handleAddLyricsAndRefresh,
  toastSuccess,
  linkedLyricId
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
                {(overlay.text || '').slice(0, 50)}{(overlay.text || '').length > 50 ? '...' : ''}
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
                <button
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '6px 8px', border: '1px solid rgba(139, 92, 246, 0.3)',
                    borderRadius: '6px', backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    color: '#c4b5fd', cursor: 'pointer', fontSize: '11px',
                    transition: 'all 0.15s'
                  }}
                  onClick={() => onRerollText(selectedOverlay.id, 0)}
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
                  onClick={() => onRerollText(selectedOverlay.id, 1)}
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
            <button
              style={textPanelStyles.saveTemplateBtn}
              onClick={() => {
                if (onRequestSaveTemplate && selectedOverlay) {
                  onRequestSaveTemplate(st);
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
          {onAddLyrics && (selectedOverlay.text || '').trim() && (
            <button
              style={textPanelStyles.saveToLyricBankBtn}
              onClick={() => {
                handleAddLyricsAndRefresh({
                  id: `lyric_${Date.now()}`,
                  title: (selectedOverlay.text || '').split('\n')[0].slice(0, 30) || 'Saved Lyrics',
                  content: (selectedOverlay.text || '').trim(),
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
        );
      })()}

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

// Styles — function so it can access theme from the calling component
const getStyles = (theme) => ({
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
    backgroundColor: theme.bg.page,
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
    borderBottom: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface
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
    color: theme.text.primary,
    fontSize: '18px',
    fontWeight: '600',
    outline: 'none',
    width: '300px'
  },
  aspectToggle: {
    display: 'flex',
    backgroundColor: theme.bg.elevated,
    borderRadius: '8px',
    padding: '4px'
  },
  aspectButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: theme.text.secondary,
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s'
  },
  aspectButtonActive: {
    backgroundColor: theme.accent.primary,
    color: theme.text.primary
  },
  templateSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: theme.bg.elevated,
    padding: '6px 12px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.default}`
  },
  templateLabel: {
    color: theme.text.secondary,
    fontSize: '13px',
    fontWeight: '500',
    whiteSpace: 'nowrap'
  },
  templateSelect: {
    backgroundColor: theme.bg.input,
    color: theme.text.primary,
    border: `1px solid ${theme.border.subtle}`,
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
    minWidth: '120px'
  },
  saveButton: {
    padding: '10px 24px',
    backgroundColor: theme.bg.elevated,
    color: theme.text.primary,
    border: `1px solid ${theme.border.default}`,
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
    border: `2px solid ${theme.border.subtle}`,
    borderTopColor: theme.text.primary,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  closeButton: {
    padding: '8px',
    backgroundColor: theme.bg.elevated,
    border: 'none',
    borderRadius: '8px',
    color: theme.text.secondary,
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
    borderRight: `1px solid ${theme.border.default}`,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.bg.surface
  },
  bankTabs: {
    display: 'flex',
    borderBottom: `1px solid ${theme.border.default}`
  },
  bankTab: {
    flex: 1,
    padding: '12px',
    border: 'none',
    backgroundColor: 'transparent',
    color: theme.text.secondary,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  bankTabActive: {
    color: theme.text.primary,
    backgroundColor: `${theme.accent.muted}40`,
    borderBottom: `2px solid ${theme.accent.primary}`
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
    color: theme.text.muted,
    textAlign: 'center'
  },
  emptySubtext: {
    fontSize: '12px',
    marginTop: '8px',
    color: theme.text.muted
  },
  clipGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px'
  },
  clipCard: {
    aspectRatio: '1',
    backgroundColor: theme.bg.elevated,
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
    color: theme.text.muted
  },
  clipName: {
    padding: '4px 8px',
    fontSize: '11px',
    color: theme.text.secondary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  rightPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    gap: '0',
    overflow: 'hidden',
    minHeight: 0
  },
  canvasContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
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
    color: theme.text.muted,
    gap: '12px'
  },
  textOverlay: {
    position: 'absolute',
    userSelect: 'none',
    zIndex: 5
  },
  canvasActions: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center'
  },
  addTextButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: `${theme.accent.primary}26`,
    border: `1px solid ${theme.accent.primary}66`,
    borderRadius: '6px',
    color: theme.accent.hover,
    cursor: 'pointer',
    fontSize: '11px'
  },
  addAudioButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'rgba(251, 146, 60, 0.2)',
    border: '1px solid rgba(251, 146, 60, 0.5)',
    borderRadius: '6px',
    color: '#fdba74',
    cursor: 'pointer',
    fontSize: '11px'
  },
  audioPickerDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginBottom: '8px',
    width: '220px',
    backgroundColor: theme.bg.elevated,
    border: `1px solid ${theme.border.default}`,
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    overflow: 'hidden'
  },
  audioPickerHeader: {
    padding: '10px 12px',
    fontSize: '11px',
    fontWeight: '600',
    color: theme.text.secondary,
    textTransform: 'uppercase',
    borderBottom: `1px solid ${theme.border.default}`
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
    color: theme.text.primary,
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
    color: theme.text.muted,
    textAlign: 'center'
  },
  audioPickerDivider: {
    height: '1px',
    backgroundColor: theme.border.default,
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
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    border: '1px solid rgba(16, 185, 129, 0.5)',
    borderRadius: '6px',
    color: '#6ee7b7',
    cursor: 'pointer',
    fontSize: '11px'
  },
  addToLyricBankButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    border: '1px solid rgba(139, 92, 246, 0.5)',
    borderRadius: '6px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '11px'
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
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    border: '1px solid rgba(251, 191, 36, 0.5)',
    borderRadius: '6px',
    color: '#fcd34d',
    cursor: 'pointer',
    fontSize: '11px'
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
    gap: '2px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    padding: '4px 16px 2px',
    flexShrink: 0
  },
  filmstripScroll: {
    display: 'flex',
    gap: '4px',
    overflowX: 'auto',
    paddingBottom: '2px'
  },
  filmstripSlide: {
    width: '48px',
    height: '72px',
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
    width: '48px',
    height: '72px',
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
});

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
