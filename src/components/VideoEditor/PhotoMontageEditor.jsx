import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  subscribeToLibrary,
  subscribeToCollections,
  getCollections,
  getLibrary,
  getLyrics,
  incrementUseCount,
  MEDIA_TYPES,
  addToLibraryAsync,
  addCreatedVideo,
  saveCreatedContentAsync,
  getBankColor,
  getBankLabel,
  getTextBankText,
  getTextBankStyle,
  addToTextBank,
  removeFromTextBank,
  updateTextBankEntry,
  migrateCollectionBanks,
  addBankToCollection,
  removeBankFromCollection,
  saveCollectionToFirestore,
  MAX_BANKS,
  MIN_BANKS,
} from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';
import { renderPhotoMontage } from '../../services/photoMontageExportService';
import { quickQC } from '../../services/qcService';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import { normalizeBeatsToTrimRange } from '../../utils/timelineNormalization';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import log from '../../utils/logger';
import useIsMobile from '../../hooks/useIsMobile';
import AudioClipSelector from './AudioClipSelector';
import LyricBank from './LyricBank';
import WordTimeline from './WordTimeline';
import LyricAnalyzer from './LyricAnalyzer';
import CloudImportButton from './CloudImportButton';
import BeatSelector from './BeatSelector';
import MomentumSelector from './MomentumSelector';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherMaximize2,
  FeatherGrid,
  FeatherStar,
  FeatherMusic,
  FeatherUpload,
  FeatherTrash2,
  FeatherScissors,
  FeatherPlus,
  FeatherMic,
  FeatherRefreshCw,
  FeatherPlay,
  FeatherPause,
  FeatherSkipBack,
  FeatherSkipForward,
  FeatherCheck,
  FeatherZoomIn,
  FeatherZoomOut,
  FeatherAlignLeft,
  FeatherAlignCenter,
  FeatherAlignRight,
  FeatherX,
} from '@subframe/core';
import EditorShell from './shared/EditorShell';
import EditorTopBar from './shared/EditorTopBar';
import EditorFooter from './shared/EditorFooter';
import useCollapsibleSections from './shared/useCollapsibleSections';
import useMediaMultiSelect from './shared/useMediaMultiSelect';
import useEditorSessionState from './shared/useEditorSessionState';
import useUnsavedChanges from './shared/useUnsavedChanges';
import usePixelTimeline from './shared/usePixelTimeline';
import useTimelineZoom from '../../hooks/useTimelineZoom';
import DraggableTextOverlay from './shared/previews/DraggableTextOverlay';
import LyricBankSection from './shared/LyricBankSection';

import {
  parseStroke,
  buildStroke,
  AVAILABLE_FONTS,
  makeFieldSetter,
} from './shared/editorConstants';
import CloseConfirmOverlay from './shared/CloseConfirmOverlay';
import WordPreview from './shared/WordPreview';
import InlineWordsRow from './shared/InlineWordsRow';
import WordBoundaryLines from './shared/WordBoundaryLines';
import useWordBoundaryDrag from './shared/useWordBoundaryDrag';

/**
 * PhotoMontageEditor — Turn photos into a fast-paced video with transitions.
 *
 * Unified layout (matches Montage blueprint):
 *   Top bar:   ← Back | TextField w-80 | Undo/Redo | Save | Export
 *   Body:      Left (w-72) Photo list | Center Preview | Right (w-96) Sidebar
 *   Sidebar:   Audio, Photo Settings, Lyrics, Text Style (collapsible)
 *   Footer:    Auto-saved timestamp | Cancel | Save
 */
const PhotoMontageEditor = ({
  category,
  existingVideo = null,
  onSave,
  onClose,
  artistId = null,
  db = null,
  onSaveLyrics,
  onAddLyrics,
  onUpdateLyrics,
  onDeleteLyrics,
  presets = [],
  onSavePreset,
  nicheTextBanks = null,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const { isMobile } = useIsMobile();

  // ── Multi-video state (mirrors Solo/Multi allVideos pattern) ──
  const defaultTextStyle = {
    fontSize: 48,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    color: '#ffffff',
    outline: true,
    outlineColor: '#000000',
    textStroke: null,
    textAlign: 'center',
    textCase: 'default',
  };
  const [allVideos, setAllVideos] = useState(() => {
    if (existingVideo?.editorMode === 'photo-montage') {
      return [
        {
          id: 'template',
          name: 'Template',
          photos: existingVideo?.montagePhotos || [],
          textOverlays: existingVideo?.textOverlays || [],
          words: existingVideo?.words || [],
          textStyle: existingVideo?.textStyle || defaultTextStyle,
          isTemplate: true,
        },
      ];
    }
    return [
      {
        id: 'template',
        name: 'Template',
        photos: existingVideo?.montagePhotos || [],
        textOverlays: existingVideo?.textOverlays || [],
        words: existingVideo?.words || [],
        textStyle: existingVideo?.textStyle || defaultTextStyle,
        isTemplate: true,
      },
    ];
  });
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const nicheGenCount = existingVideo?._nicheGenerateCount || null;
  const [generateCount, setGenerateCount] = useState(
    nicheGenCount ? Math.max(nicheGenCount - 1, 1) : 5,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [keepTemplateText, setKeepTemplateText] = useState('none');
  const [name, setName] = useState(existingVideo?.name || 'Photo Montage');

  // Derived reads from active video
  const activeVideo = allVideos[activeVideoIndex];
  const photos = activeVideo?.photos || [];
  const textOverlays = activeVideo?.textOverlays || [];
  const textOverlaysRef = useRef(textOverlays);
  textOverlaysRef.current = textOverlays;
  const words = activeVideo?.words || [];
  const textStyle = activeVideo?.textStyle || {};

  // Wrapper setters (route through allVideos via shared factory)
  const setPhotos = useMemo(
    () => makeFieldSetter(setAllVideos, activeVideoIndex, 'photos', []),
    [activeVideoIndex],
  );
  const setTextOverlays = useMemo(
    () => makeFieldSetter(setAllVideos, activeVideoIndex, 'textOverlays', []),
    [activeVideoIndex],
  );
  const setWords = useMemo(
    () => makeFieldSetter(setAllVideos, activeVideoIndex, 'words', []),
    [activeVideoIndex],
  );
  const setTextStyle = useMemo(
    () => makeFieldSetter(setAllVideos, activeVideoIndex, 'textStyle', {}),
    [activeVideoIndex],
  );

  // ── Footer state ──
  const [isSavingAll, setIsSavingAll] = useState(false);

  // ── Settings state (global across all variations) ──
  const [speed, setSpeed] = useState(existingVideo?.montageSpeed || 1);
  const [transition, setTransition] = useState(existingVideo?.montageTransition || 'cut');
  const [kenBurnsEnabled, setKenBurnsEnabled] = useState(existingVideo?.montageKenBurns === true);
  const [aspectRatio, setAspectRatio] = useState(existingVideo?.cropMode || '9:16');
  const [displayMode, setDisplayMode] = useState(existingVideo?.montageDisplayMode || 'cover');

  // ── Audio state ──
  const [selectedAudio, setSelectedAudio] = useState(existingVideo?.audio || null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [beatSyncEnabled, setBeatSyncEnabled] = useState(existingVideo?.montageBeatSync || false);
  const audioRef = useRef(null);
  const audioFileInputRef = useRef(null);

  // ── Text editing state ──
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [selectedTextIds, setSelectedTextIds] = useState(new Set());
  const [textMarquee, setTextMarquee] = useState(null); // { startX, currentX }
  const textTrackRef = useRef(null);
  const previewRef = useRef(null);
  const timelineRef = useRef(null);
  const wasPlayingBeforePlayheadDrag = useRef(false);
  const [timelineScale, setTimelineScale] = useState(1);
  const [playheadDragging, setPlayheadDragging] = useState(false);

  // ── Words extra state ──
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [loadedBankLyricId, setLoadedBankLyricId] = useState(null);
  const [selectedWordId, setSelectedWordId] = useState(null);
  const [activeTimelineRow, setActiveTimelineRow] = useState('photos');
  const [wordCutDrag, setWordCutDrag] = useState(null);

  // ── Beat detection ──
  const { beats, bpm, isAnalyzing: beatAnalyzing, analyzeAudio } = useBeatDetection();

  // ── Export state ──
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // ── Preview playback ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playbackRef = useRef(null);
  const lastFrameTimeRef = useRef(null);

  // ── Library ──
  const [library, setLibrary] = useState([]);
  const [collections, setCollections] = useState([]);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [lyricsBank, setLyricsBank] = useState([]);

  // ── Modals ──
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showTranscriber, setShowTranscriber] = useState(false);
  const [showBeatSelector, setShowBeatSelector] = useState(false);
  const [showMomentumSelector, setShowMomentumSelector] = useState(false);

  // ── Preset state ──
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [showPresetPrompt, setShowPresetPrompt] = useState(false);
  const [presetPromptValue, setPresetPromptValue] = useState('');

  // ── Text bank state ──
  const [newTextInputs, setNewTextInputs] = useState({});

  // ── Footer state ──
  const [lastSaved, setLastSaved] = useState(null);

  // ── Right Sidebar: collapsible sections ──
  const { openSections, renderCollapsibleSection } = useCollapsibleSections({
    audio: true,
    photoSettings: true,
    lyricBank: false,
    textBanks: true,
    textStyle: existingVideo?.textOverlays?.length > 0,
  });

  // ── Session persistence ──
  const { loadSession, saveSession, clearSession } = useEditorSessionState(
    artistId,
    'photo-montage',
    existingVideo?.id,
  );
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const session = loadSession();
    if (session?.activeVideoIndex != null) setActiveVideoIndex(session.activeVideoIndex);
  }, [loadSession]);
  useEffect(() => {
    saveSession({ activeVideoIndex, openSections });
  }, [activeVideoIndex, openSections, saveSession]);

  // ── Audio trimmer state ──
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);

  // ── Audio volume state ──
  const [externalAudioVolume, setExternalAudioVolume] = useState(1.0);
  const [sourceVideoVolume, setSourceVideoVolume] = useState(1.0);
  const [sourceVideoMuted, setSourceVideoMuted] = useState(false);

  // ── Drag reorder ──
  const [dragIndex, setDragIndex] = useState(null);

  // ── Undo/Redo history (route through allVideos) ──
  const getHistorySnapshot = useCallback(() => {
    const v = allVideos[activeVideoIndex];
    return { ...v, selectedAudio };
  }, [allVideos, activeVideoIndex, selectedAudio]);

  const restoreHistorySnapshot = useCallback(
    (snapshot) => {
      const { selectedAudio: snapAudio, ...videoSnapshot } = snapshot;
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        copy[activeVideoIndex] = { ...cur, ...videoSnapshot };
        return copy;
      });
      if (snapAudio !== undefined) setSelectedAudio(snapAudio);
    },
    [activeVideoIndex],
  );

  const { canUndo, canRedo, handleUndo, handleRedo, resetHistory } = useEditorHistory({
    getSnapshot: getHistorySnapshot,
    restoreSnapshot: restoreHistorySnapshot,
    deps: [photos, textOverlays, selectedAudio, textStyle, words],
    isEditingText: !!editingTextId,
  });

  // Reset history when switching variations
  useEffect(() => {
    resetHistory();
  }, [activeVideoIndex, resetHistory]);

  // ── Waveform (for future timeline rendering) ──
  const EMPTY_CLIPS = useRef([]).current;
  const NULL_URL = useRef(() => null).current;
  const { waveformData, waveformDuration } = useWaveform({
    selectedAudio,
    clips: EMPTY_CLIPS,
    getClipUrl: NULL_URL,
  });

  // Audio trim boundaries for beat normalization (must be after useWaveform)
  const audioStartTime = selectedAudio?.startTime || 0;
  const audioEndTime =
    selectedAudio?.endTime || waveformDuration || audioDuration || selectedAudio?.duration || 0;

  // Filter beats to trimmed range and normalize to local time
  const filteredBeats = useMemo(() => {
    if (!beats.length) return [];
    return normalizeBeatsToTrimRange(beats, audioStartTime, audioEndTime);
  }, [beats, audioStartTime, audioEndTime]);

  // ── Multi-video: switch, delete, generate ──
  const switchToVideo = useCallback(
    (index) => {
      if (index === activeVideoIndex) return;
      setActiveVideoIndex(index);
      setSelectedWordId(null);
      setActiveTimelineRow('photos');
    },
    [activeVideoIndex],
  );

  const handleDeleteVideo = useCallback(
    (index) => {
      if (index === 0) return; // Can't delete template
      setAllVideos((prev) => prev.filter((_, i) => i !== index));
      setActiveVideoIndex((prev) => {
        if (prev === index) return 0;
        if (prev > index) return prev - 1;
        return prev;
      });
      toastSuccess('Variation deleted');
    },
    [toastSuccess],
  );

  const executeGeneration = useCallback(() => {
    const template = allVideos[0];
    if (!template?.photos?.length) {
      toastError('Add photos to template before generating');
      return;
    }
    setIsGenerating(true);

    // Fisher-Yates shuffle
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const newVideos = [];
    for (let g = 0; g < generateCount; g++) {
      // Shuffle photo order
      const genPhotos = shuffle(template.photos);

      // Cycle text from words if keepTemplateText is 'none'
      let genWords = [...(template.words || [])];
      let genTextOverlays = [...(template.textOverlays || [])];
      if (keepTemplateText === 'none' && genWords.length > 0) {
        // Rotate words by variation index for variety
        const rotateBy = (g + 1) % genWords.length;
        genWords = [...genWords.slice(rotateBy), ...genWords.slice(0, rotateBy)];
      }

      newVideos.push({
        id: `gen_${Date.now()}_${g}`,
        name: `#${allVideos.length + g}`,
        photos: genPhotos,
        textOverlays: genTextOverlays,
        words: genWords,
        textStyle: { ...template.textStyle },
        isTemplate: false,
      });
    }

    // Track usage for clip recycling
    const usedIds = new Set();
    newVideos.forEach((v) =>
      v.photos.forEach((p) => {
        if (p.id) usedIds.add(p.id);
      }),
    );
    if (artistId) usedIds.forEach((id) => incrementUseCount(artistId, id));

    setAllVideos((prev) => [...prev, ...newVideos]);
    setActiveVideoIndex(allVideos.length);
    setIsGenerating(false);
    toastSuccess(`Generated ${generateCount} variations`);
  }, [allVideos, generateCount, keepTemplateText, artistId, toastSuccess, toastError]);

  // ── Library subscriptions ──
  useEffect(() => {
    if (!artistId) return;
    const localLib = getLibrary(artistId);
    setLibrary(localLib);
    const localCols = getCollections(artistId);
    setCollections(localCols);
    setLyricsBank(getLyrics(artistId));
  }, [artistId]);

  useEffect(() => {
    if (!db || !artistId) return;
    const unsubs = [];
    unsubs.push(subscribeToLibrary(db, artistId, (lib) => setLibrary(lib)));
    unsubs.push(subscribeToCollections(db, artistId, (cols) => setCollections(cols)));
    return () => unsubs.forEach((u) => u());
  }, [db, artistId]);

  const libraryImages = useMemo(() => {
    // Prefer niche images from category if available (passed from ProjectWorkspace via pipelineCategory)
    if (category?.images?.length > 0) {
      return category.images.filter((m) => m.url && !m.url.startsWith('blob:'));
    }
    // Fallback to full library for non-niche usage
    return library.filter(
      (m) => m.type === MEDIA_TYPES.IMAGE && m.url && !m.url.startsWith('blob:'),
    );
  }, [library, category]);

  // Auto-populate photos from library on mount (always when template is empty)
  const autoPopulatedRef = useRef(false);
  useEffect(() => {
    if (autoPopulatedRef.current) return;
    if (libraryImages.length === 0) return;
    const template = allVideos[0];
    if (template?.photos?.length > 0) return; // Already has photos
    autoPopulatedRef.current = true;
    setAllVideos((prev) => {
      const copy = [...prev];
      copy[0] = { ...copy[0], photos: libraryImages };
      return copy;
    });
  }, [allVideos, libraryImages]);

  // Auto-generate additional timelines when coming from niche preview (Create N flow)
  const autoGenTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoGenTriggeredRef.current || !nicheGenCount) return;
    if (libraryImages.length === 0) return;
    const template = allVideos[0];
    if (!template?.photos?.length) return; // Wait for auto-populate above
    autoGenTriggeredRef.current = true;
    executeGeneration();
  }, [nicheGenCount, allVideos, libraryImages, executeGeneration]);

  // ── Multi-select for library picker ──
  const {
    selectedIds: selectedLibIds,
    isDragSelecting: libDragSelecting,
    rubberBand: libRubberBand,
    gridRef: libGridRef,
    gridMouseHandlers: libGridMouseHandlers,
    toggleSelect: toggleLibSelect,
    selectAll: selectAllLib,
    clearSelection: clearLibSelection,
  } = useMediaMultiSelect(libraryImages);

  // ── Audio scope filter (Niche / Project / All) ──
  const [audioScope, setAudioScope] = useState('niche');

  const nicheAudio = useMemo(() => category?.audio || [], [category?.audio]);

  const projectAudio = useMemo(() => {
    if (!category?.projectId) return [];
    const projectRoot = collections.find((c) => c.id === category.projectId && c.isProjectRoot);
    if (!projectRoot?.mediaIds?.length) return [];
    const ids = new Set(projectRoot.mediaIds);
    return library.filter((m) => m.type === MEDIA_TYPES.AUDIO && ids.has(m.id));
  }, [category?.projectId, collections, library]);

  const libraryAudio = useMemo(
    () => library.filter((m) => m.type === MEDIA_TYPES.AUDIO),
    [library],
  );

  const filteredAudio = useMemo(() => {
    if (audioScope === 'niche' && nicheAudio.length > 0) return nicheAudio;
    if (audioScope === 'project' && projectAudio.length > 0) return projectAudio;
    return libraryAudio;
  }, [audioScope, nicheAudio, projectAudio, libraryAudio]);

  // Auto-select best scope on mount
  useEffect(() => {
    if (nicheAudio.length > 0) setAudioScope('niche');
    else if (projectAudio.length > 0) setAudioScope('project');
    else setAudioScope('all');
  }, [nicheAudio.length, projectAudio.length]);

  // Effective audio duration (trimmed range or full)
  const effectiveAudioDuration = useMemo(() => {
    if (!selectedAudio) return 0;
    return (
      (selectedAudio.endTime || waveformDuration || audioDuration || selectedAudio.duration || 0) -
      (selectedAudio.startTime || 0)
    );
  }, [selectedAudio, audioDuration, waveformDuration]);

  // ── Computed: photo durations (beat-synced or fixed), expanded to fill audio ──
  const photoDurations = useMemo(() => {
    if (beatSyncEnabled && filteredBeats.length > 1 && photos.length > 0) {
      const durations = [];
      const beatsPerPhoto = Math.max(1, Math.floor(filteredBeats.length / photos.length));
      for (let i = 0; i < photos.length; i++) {
        const beatStart = i * beatsPerPhoto;
        const beatEnd = Math.min((i + 1) * beatsPerPhoto, filteredBeats.length - 1);
        if (beatStart < filteredBeats.length && beatEnd < filteredBeats.length) {
          durations.push(filteredBeats[beatEnd] - filteredBeats[beatStart]);
        } else {
          durations.push(speed);
        }
      }
      return durations;
    }
    // Base durations for one cycle
    const baseDurations = photos.map((p) => p.customDuration || speed);
    const oneCycleLen = baseDurations.reduce((s, d) => s + d, 0);
    // If audio is longer than one photo cycle, repeat photos to fill
    const targetDuration = effectiveAudioDuration > oneCycleLen ? effectiveAudioDuration : 0;
    if (targetDuration > 0 && oneCycleLen > 0 && photos.length > 0) {
      const expanded = [];
      let total = 0;
      let i = 0;
      while (total < targetDuration) {
        const dur = baseDurations[i % baseDurations.length];
        expanded.push(dur);
        total += dur;
        i++;
        if (i > 10000) break; // safety cap
      }
      return expanded;
    }
    return baseDurations;
  }, [photos, speed, beatSyncEnabled, filteredBeats, effectiveAudioDuration]);

  const totalDuration = useMemo(
    () => photoDurations.reduce((sum, d) => sum + d, 0),
    [photoDurations],
  );

  // Wire shared pixel timeline hook
  const { pxPerSec, timelinePx, rulerTicks, handleRulerMouseDown, formatTime, downsample } =
    usePixelTimeline({
      timelineScale,
      timelineDuration: totalDuration,
      timelineRef,
      handleSeek: useCallback(
        (time) => {
          const clamped = Math.max(0, Math.min(time, totalDuration || 0));
          setCurrentTime(clamped);
          if (audioRef.current && selectedAudio?.url) {
            audioRef.current.currentTime = (selectedAudio.startTime || 0) + clamped;
          }
        },
        [totalDuration, selectedAudio],
      ),
      isPlaying,
      setIsPlaying,
      setPlayheadDragging,
      wasPlayingRef: wasPlayingBeforePlayheadDrag,
    });

  // Effective px/sec: accounts for min cell widths in rapid-fire photo modes
  const MIN_CELL_W_HOOK = 20;
  const effectivePxPerSecHook = useMemo(() => {
    if (!photos.length || !photoDurations.length || totalDuration <= 0) return pxPerSec;
    // Scale min cell width with zoom so zooming out actually shrinks cells
    const scaledMinCell = Math.max(4, MIN_CELL_W_HOOK * timelineScale);
    const stripPx = photoDurations.reduce(
      (sum, dur) => sum + Math.max(scaledMinCell, dur * pxPerSec),
      0,
    );
    return stripPx > timelinePx ? stripPx / totalDuration : pxPerSec;
  }, [photos.length, photoDurations, totalDuration, pxPerSec, timelinePx, timelineScale]);

  // Wire pinch-to-zoom on timeline container
  useTimelineZoom(timelineRef, {
    zoom: timelineScale,
    setZoom: setTimelineScale,
    minZoom: 0.3,
    maxZoom: 3,
    basePixelsPerSecond: 40,
  });

  // Word boundary drag (shared hook)
  useWordBoundaryDrag(wordCutDrag, effectivePxPerSecHook, setWords, setWordCutDrag);

  // Refs for stable access inside playhead drag effect
  const selectedAudioRef = useRef(selectedAudio);
  selectedAudioRef.current = selectedAudio;
  const timelinePxRef = useRef(timelinePx);
  timelinePxRef.current = timelinePx;

  // Playhead drag across timeline
  useEffect(() => {
    if (!playheadDragging) return;
    document.body.style.userSelect = 'none';
    document.body.style.WebkitUserSelect = 'none';
    const handleMouseMove = (e) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left + timelineRef.current.scrollLeft;
      const pxW = timelinePxRef.current || 1;
      const seekTime = Math.max(0, Math.min(1, clickX / pxW)) * totalDuration;
      const clamped = Math.max(0, Math.min(seekTime, totalDuration || 0));
      setCurrentTime(clamped);
      const audio = selectedAudioRef.current;
      if (audioRef.current && audio?.url) {
        audioRef.current.currentTime = (audio.startTime || 0) + clamped;
      }
    };
    const handleMouseUp = () => {
      setPlayheadDragging(false);
      document.body.style.userSelect = '';
      document.body.style.WebkitUserSelect = '';
      if (wasPlayingBeforePlayheadDrag.current) setIsPlaying(true);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('pointercancel', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.WebkitUserSelect = '';
    };
  }, [playheadDragging, totalDuration]);

  // ── Save all variations ──
  const handleSaveAllAndClose = useCallback(async () => {
    if (isSavingAll) return;
    setIsSavingAll(true);
    let savedCount = 0;
    try {
      for (const video of allVideos) {
        const videoData = {
          id: video.isTemplate ? existingVideo?.id : undefined,
          editorMode: 'photo-montage',
          name: video.isTemplate ? name : `${name} ${video.name}`,
          clips: [],
          montagePhotos: (video.photos || []).map((p) => ({
            id: p.id,
            sourceImageId: p.id,
            url: p.url,
            thumbnailUrl: p.thumbnailUrl || null,
            name: p.name,
          })),
          montageSpeed: speed,
          montageTransition: transition,
          montageKenBurns: kenBurnsEnabled,
          montageBeatSync: beatSyncEnabled,
          montageDisplayMode: displayMode,
          audio: selectedAudio,
          cropMode: aspectRatio,
          duration: totalDuration,
          textOverlays: video.textOverlays || [],
          textStyle: video.textStyle || {},
          words: video.words || [],
          status: 'draft',
          createdAt: existingVideo?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          externalAudioVolume,
          _nicheGenerateCount: existingVideo?._nicheGenerateCount || null,
        };
        onSave(videoData);
        savedCount++;
      }
      toastSuccess(`Saved ${savedCount} montage${savedCount > 1 ? 's' : ''}`);
      onClose();
    } catch (err) {
      toastError(`Error saving: ${err.message}`);
    } finally {
      setIsSavingAll(false);
    }
  }, [
    allVideos,
    isSavingAll,
    existingVideo,
    name,
    speed,
    transition,
    kenBurnsEnabled,
    beatSyncEnabled,
    displayMode,
    selectedAudio,
    aspectRatio,
    totalDuration,
    externalAudioVolume,
    onSave,
    onClose,
    toastSuccess,
    toastError,
  ]);

  // ── Beat detection: auto-analyze whenever audio is loaded ──
  useEffect(() => {
    if (selectedAudio?.url && !bpm) {
      analyzeAudio(selectedAudio.url);
    }
  }, [selectedAudio?.url, bpm, analyzeAudio]);

  // ── Preview playback loop ──
  const startPlayback = useCallback(() => {
    if (photos.length === 0) return;
    setIsPlaying(true);
    lastFrameTimeRef.current = performance.now();

    const tick = (now) => {
      const delta = (now - (lastFrameTimeRef.current || now)) / 1000;
      lastFrameTimeRef.current = now;

      setCurrentTime((prev) => {
        const next = prev + delta;
        if (next >= totalDuration) return 0;
        return next;
      });

      playbackRef.current = requestAnimationFrame(tick);
    };
    playbackRef.current = requestAnimationFrame(tick);

    if (audioRef.current && selectedAudio?.url) {
      // Resume from current timeline position, not from the beginning
      setCurrentTime((prev) => {
        audioRef.current.currentTime = (selectedAudio.startTime || 0) + prev;
        audioRef.current.play().catch(() => {});
        return prev;
      });
    }
  }, [photos.length, totalDuration, selectedAudio]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current);
      playbackRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  // Wrappers for WordTimeline compatibility
  const handlePlayPause = useCallback(() => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  }, [isPlaying, startPlayback, stopPlayback]);

  const handleSeek = useCallback(
    (time) => {
      const clamped = Math.max(0, Math.min(time, totalDuration || 0));
      setCurrentTime(clamped);
      lastFrameTimeRef.current = performance.now();
      if (audioRef.current && selectedAudio?.url) {
        audioRef.current.currentTime = (selectedAudio.startTime || 0) + clamped;
      }
    },
    [totalDuration, selectedAudio],
  );

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
    },
    [],
  );

  // ── Current expanded slot index (into photoDurations[]) ──
  const currentExpandedIndex = useMemo(() => {
    if (!photos.length) return 0;
    let elapsed = 0;
    for (let i = 0; i < photoDurations.length; i++) {
      elapsed += photoDurations[i];
      if (currentTime < elapsed) return i;
    }
    return Math.max(0, photoDurations.length - 1);
  }, [currentTime, photoDurations, photos.length]);

  // Map expanded index back to base photos array
  const currentPhotoIndex = photos.length > 0 ? currentExpandedIndex % photos.length : 0;

  // Deduplicated base photos for left panel display (unique by id, preserving order)
  const basePhotos = useMemo(() => {
    const seen = new Set();
    return photos.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [photos]);

  const currentPhotoProgress = useMemo(() => {
    let elapsed = 0;
    for (let i = 0; i < photoDurations.length; i++) {
      if (i === currentExpandedIndex) {
        return (currentTime - elapsed) / photoDurations[i];
      }
      elapsed += photoDurations[i];
    }
    return 0;
  }, [currentTime, currentExpandedIndex, photoDurations]);

  // ── Photo management ──
  const addPhotosFromFiles = useCallback(
    async (files) => {
      const newPhotos = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const localUrl = URL.createObjectURL(file);
        newPhotos.push({
          id: `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          url: localUrl,
          file,
          name: file.name,
          isLocal: true,
        });
      }
      if (newPhotos.length > 0) {
        setPhotos((prev) => [...prev, ...newPhotos]);
        toastSuccess(`Added ${newPhotos.length} photo${newPhotos.length !== 1 ? 's' : ''}`);
      }
    },
    [toastSuccess],
  );

  const addPhotosFromLibrary = useCallback(
    (mediaItems) => {
      const newPhotos = mediaItems.map((item) => ({
        id: item.id,
        url: item.url,
        name: item.name,
        libraryId: item.id,
        isLocal: false,
      }));
      setPhotos((prev) => [...prev, ...newPhotos]);
      setShowLibraryPicker(false);
      toastSuccess(`Added ${newPhotos.length} photo${newPhotos.length !== 1 ? 's' : ''}`);
    },
    [toastSuccess],
  );

  const removePhoto = useCallback(
    (baseIndex) => {
      const photoToRemove = basePhotos[baseIndex];
      if (!photoToRemove) return;
      if (photoToRemove.isLocal && photoToRemove.url?.startsWith('blob:')) {
        URL.revokeObjectURL(photoToRemove.url);
      }
      // Remove all instances of this photo from the (possibly materialized) array
      setPhotos((prev) => prev.filter((p) => p.id !== photoToRemove.id));
    },
    [basePhotos],
  );

  const movePhoto = useCallback((fromIndex, toIndex) => {
    setPhotos((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  // ── Text bank helpers (must be before handleReroll which references getTextBanks) ──
  const textBanksCache = useMemo(() => {
    // Use niche text banks if available, otherwise derive from collection
    if (nicheTextBanks && nicheTextBanks.some((b) => b?.length > 0)) {
      return nicheTextBanks.map((tb) => (tb?.length > 0 ? [...tb] : []));
    }
    const col = category?.id ? collections.find((c) => c.id === category.id) : collections[0];
    if (!col) return [[], []];
    const migrated = migrateCollectionBanks(col);
    const result = (migrated.textBanks || []).map((tb) => (tb?.length > 0 ? [...tb] : []));
    while (result.length < 2) result.push([]);
    return result;
  }, [nicheTextBanks, category, collections]);

  const getTextBanks = useCallback(() => textBanksCache, [textBanksCache]);

  // ── Re-roll: always swap photo AND randomize text overlays ──
  const handleReroll = useCallback(() => {
    // Reroll media
    if (photos.length > 0 && photoDurations.length > 0) {
      const currentPhoto = photos[currentExpandedIndex % photos.length];
      const imgPool = libraryImages.filter((img) => img.id !== currentPhoto?.id);
      if (imgPool.length > 0) {
        const pick = imgPool[Math.floor(Math.random() * imgPool.length)];
        setPhotos((prev) => {
          let expanded = prev;
          if (photoDurations.length > prev.length) {
            expanded = photoDurations.map((_, i) => prev[i % prev.length]);
          }
          const updated = [...expanded];
          updated[currentExpandedIndex] = {
            id: pick.id,
            url: pick.url,
            name: pick.name,
            thumbnailUrl: pick.thumbnailUrl || null,
            libraryId: pick.id,
            isLocal: false,
          };
          return updated;
        });
      }
    }
    // Reroll text overlays
    const banks = getTextBanks();
    const allBankTexts = banks
      .flat()
      .map((e) => getTextBankText(e))
      .filter(Boolean);
    if (allBankTexts.length > 0 && textOverlays.length > 0) {
      setTextOverlays((prev) =>
        prev.map((o) => {
          const others = allBankTexts.filter((t) => t !== o.text);
          const pool = others.length > 0 ? others : allBankTexts;
          return { ...o, text: pool[Math.floor(Math.random() * pool.length)] };
        }),
      );
    }
    toastSuccess('Rerolled');
  }, [
    textOverlays,
    getTextBanks,
    setTextOverlays,
    photos,
    photoDurations,
    currentExpandedIndex,
    libraryImages,
    setPhotos,
    toastSuccess,
  ]);

  // ── Cut by beat — opens BeatSelector modal ──
  const handleCutByBeat = useCallback(() => {
    if (!filteredBeats.length) {
      toastError('No beats detected. Try a different audio track or check the trim range.');
      return;
    }
    setShowBeatSelector(true);
  }, [filteredBeats, toastError]);

  // ── Apply selected beats — sets customDuration on photos to match beat intervals ──
  const handleBeatSelectionApply = useCallback(
    (selectedBeatTimes) => {
      if (!selectedBeatTimes.length || photos.length === 0) {
        setShowBeatSelector(false);
        return;
      }
      const effectiveDur =
        (selectedAudio?.endTime ||
          waveformDuration ||
          audioDuration ||
          selectedAudio?.duration ||
          0) - (selectedAudio?.startTime || 0);
      setPhotos((prev) => {
        const updated = [...prev];
        for (let i = 0; i < updated.length; i++) {
          const beatIdx = i % selectedBeatTimes.length;
          const start = selectedBeatTimes[beatIdx];
          const end = selectedBeatTimes[beatIdx + 1] || effectiveDur;
          updated[i] = { ...updated[i], customDuration: Math.max(0.1, end - start) };
        }
        return updated;
      });
      setShowBeatSelector(false);
      toastSuccess('Photos synced to beats');
    },
    [photos.length, selectedAudio, audioDuration, setPhotos, toastSuccess],
  );

  // ── Text overlay default style (must be before functions that reference it) ──
  const getDefaultTextStyle = useCallback(
    () => ({
      fontSize: textStyle.fontSize || 48,
      fontFamily: textStyle.fontFamily || "'TikTok Sans', sans-serif",
      fontWeight: textStyle.fontWeight || '600',
      color: textStyle.color || '#ffffff',
      outline: textStyle.outline ?? true,
      outlineColor: textStyle.outlineColor || '#000000',
      textStroke: textStyle.textStroke || null,
      textAlign: textStyle.textAlign || 'center',
      textCase: textStyle.textCase || 'default',
    }),
    [textStyle],
  );

  // ── Cut by word — opens WordTimeline for text cell mode selection ──
  const handleCutByWord = useCallback(() => {
    if (!words.length) {
      toastError('No words available. Use the Lyrics section to add words first.');
      return;
    }
    setShowWordTimeline(true);
  }, [words, toastError]);

  // ── Drag handlers ──
  const handleDragStart = useCallback((index) => setDragIndex(index), []);
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);
  const handleDrop = useCallback(
    (index) => {
      if (dragIndex !== null && dragIndex !== index) {
        movePhoto(dragIndex, index);
      }
      setDragIndex(null);
    },
    [dragIndex, movePhoto],
  );

  // ── Text overlay CRUD (matches SoloClipEditor) ──
  const addTextOverlay = useCallback(
    (prefillText) => {
      const dur = totalDuration || 30;
      const newOverlay = {
        id: `text_${Date.now()}`,
        text: prefillText || 'Click to edit',
        style: getDefaultTextStyle(),
        position: { x: 50, y: 50, width: 80 },
        startTime: 0,
        endTime: dur,
      };
      setTextOverlays((prev) => [...prev, newOverlay]);
      setEditingTextId(newOverlay.id);
      setEditingTextValue(newOverlay.text);
    },
    [getDefaultTextStyle, totalDuration],
  );

  const updateTextOverlay = useCallback((overlayId, updates) => {
    setTextOverlays((prev) => prev.map((o) => (o.id === overlayId ? { ...o, ...updates } : o)));
  }, []);

  const removeTextOverlay = useCallback(
    (overlayId) => {
      setTextOverlays((prev) => prev.filter((o) => o.id !== overlayId));
      if (editingTextId === overlayId) {
        setEditingTextId(null);
        setEditingTextValue('');
      }
    },
    [editingTextId],
  );

  // ── Text track marquee selection ──
  const handleTextTrackPointerDown = useCallback(
    (e) => {
      // Don't start marquee if clicking on overlay blocks (they handle their own clicks)
      if (e.target.closest('[data-text-overlay]')) return;
      if (!timelineRef.current || totalDuration <= 0) return;
      e.preventDefault();
      const pxPerSec = effectivePxPerSecHook;
      const rect = timelineRef.current.getBoundingClientRect();
      const startX = e.clientX - rect.left + timelineRef.current.scrollLeft;
      setTextMarquee({ startX, currentX: startX });
      if (!e.shiftKey) {
        setSelectedTextIds(new Set());
        setEditingTextId(null);
      }

      const onMove = (me) => {
        const cx = me.clientX - rect.left + timelineRef.current.scrollLeft;
        setTextMarquee((prev) => (prev ? { ...prev, currentX: cx } : null));
        // Compute which overlays are in range
        const minX = Math.min(startX, cx);
        const maxX = Math.max(startX, cx);
        const ids = new Set();
        textOverlays.forEach((o) => {
          const oLeft = (o.startTime ?? 0) * pxPerSec;
          const oRight =
            oLeft + Math.max(20, ((o.endTime ?? totalDuration) - (o.startTime ?? 0)) * pxPerSec);
          if (oRight >= minX && oLeft <= maxX) ids.add(o.id);
        });
        setSelectedTextIds(ids);
      };
      const onUp = () => {
        setTextMarquee(null);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    },
    [totalDuration, textOverlays, effectivePxPerSecHook],
  );

  // ── Preset handler ──
  const handleApplyPreset = useCallback((preset) => {
    setSelectedPreset(preset);
    if (preset.settings) {
      setTextStyle((prev) => ({ ...prev, ...preset.settings }));
      if (preset.settings.cropMode) setAspectRatio(preset.settings.cropMode);
    }
  }, []);

  // ── Save Draft ──
  const handleSaveDraft = useCallback(() => {
    if (photos.length === 0) {
      toastError('No photos to save.');
      return;
    }
    const videoData = {
      id: existingVideo?.id || `montage_${Date.now()}`,
      editorMode: 'photo-montage',
      name,
      clips: [],
      montagePhotos: photos.map((p) => ({
        id: p.id,
        sourceImageId: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl || null,
        name: p.name,
      })),
      montageSpeed: speed,
      montageTransition: transition,
      montageKenBurns: kenBurnsEnabled,
      montageBeatSync: beatSyncEnabled,
      montageDisplayMode: displayMode,
      audio: selectedAudio,
      cropMode: aspectRatio,
      duration: totalDuration,
      textOverlays,
      textStyle,
      words,
      status: 'draft',
      createdAt: existingVideo?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      externalAudioVolume,
      _nicheGenerateCount: existingVideo?._nicheGenerateCount || null,
    };
    onSave(videoData);
    setLastSaved(new Date());
    toastSuccess(`Saved "${name}"`);
  }, [
    photos,
    name,
    speed,
    transition,
    kenBurnsEnabled,
    beatSyncEnabled,
    displayMode,
    selectedAudio,
    aspectRatio,
    totalDuration,
    textOverlays,
    textStyle,
    words,
    externalAudioVolume,
    existingVideo,
    onSave,
    toastSuccess,
    toastError,
  ]);

  // ── Audio handling ──
  const handleAudioUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSelectedAudio({ id: `audio_${Date.now()}`, name: file.name, url, file, duration: null });
    setBeatSyncEnabled(false);
  }, []);

  const handleAudioSelect = useCallback((audio) => {
    setSelectedAudio(audio);
    setBeatSyncEnabled(false);
  }, []);

  const handleRemoveAudio = useCallback(() => {
    if (selectedAudio?.url?.startsWith('blob:')) URL.revokeObjectURL(selectedAudio.url);
    setSelectedAudio(null);
    setBeatSyncEnabled(false);
  }, [selectedAudio]);

  // ── Audio trim save handler ──
  const handleAudioTrimSave = useCallback(
    ({ startTime, endTime, trimmedFile, trimmedName }) => {
      if (!audioToTrim) return;
      if (trimmedFile) {
        const localUrl = URL.createObjectURL(trimmedFile);
        handleAudioSelect({
          ...audioToTrim,
          id: `audio_trim_${Date.now()}`,
          name: trimmedName || trimmedFile.name,
          file: trimmedFile,
          localUrl,
          url: localUrl,
          startTime: 0,
          endTime: null,
          isTrimmed: true,
        });
      } else {
        handleAudioSelect({
          ...audioToTrim,
          startTime,
          endTime,
          trimmedDuration: endTime - startTime,
          isTrimmed:
            startTime > 0 ||
            (audioToTrim.duration && Math.abs(endTime - audioToTrim.duration) > 0.1),
        });
      }
      setShowAudioTrimmer(false);
      setAudioToTrim(null);
    },
    [audioToTrim, handleAudioSelect],
  );

  const handleAudioSaveClip = useCallback(
    async (clipData) => {
      if (!selectedAudio || !artistId) return;
      const savedClip = {
        id: `audio_clip_${Date.now()}`,
        type: MEDIA_TYPES.AUDIO,
        name: clipData.name,
        url: selectedAudio.url || selectedAudio.localUrl,
        localUrl: selectedAudio.localUrl || selectedAudio.url,
        duration: clipData.clipDuration,
        startTime: clipData.startTime,
        endTime: clipData.endTime,
      };
      await addToLibraryAsync(db, artistId, savedClip);
      toastSuccess(`Saved clip "${clipData.name}" to library`);
    },
    [selectedAudio, artistId, db, toastSuccess],
  );

  // ── Audio element config — runs whenever selectedAudio changes ──
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!selectedAudio) {
      el.src = '';
      setAudioDuration(0);
      return;
    }
    const url = selectedAudio.localUrl || selectedAudio.url;
    if (!url) return;

    const start = selectedAudio.startTime || 0;
    const endProp = selectedAudio.endTime || null;

    const onLoadedMetadata = () => {
      if (!audioRef.current) return;
      const end = endProp || audioRef.current.duration;
      setAudioDuration(end - start);
      if (start > 0) {
        audioRef.current.currentTime = start;
      }
    };

    // Set handler BEFORE load so cached audio doesn't miss the event
    el.onloadedmetadata = onLoadedMetadata;
    el.src = url;
    el.load();

    // Fallback: if audio was already cached, onloadedmetadata may not re-fire
    const fallback = setTimeout(() => {
      if (el.readyState >= 1 && el.duration > 0) {
        onLoadedMetadata();
      }
    }, 100);

    return () => clearTimeout(fallback);
  }, [selectedAudio]);

  // ── Sync audio volume ──
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = externalAudioVolume;
    }
  }, [externalAudioVolume]);

  // ── Transcript lines state (line-level data from LRC for WordTimeline) ──
  const [transcriptLines, setTranscriptLines] = useState([]);

  // ── AI Transcription handler — stores words + opens WordTimeline ──
  const handleTranscriptionComplete = useCallback(
    (result) => {
      if (!result?.words?.length) {
        toastError('No words detected in transcription.');
        setShowTranscriber(false);
        return;
      }
      const dur = totalDuration || 30;
      // Store words for WordTimeline
      setWords(
        result.words.map((w, i) => ({
          id: `word_${Date.now()}_${i}`,
          text: w.text,
          startTime: Math.min(w.startTime || 0, dur),
          duration: w.duration || 0.5,
        })),
      );
      // Store lines if available (from LRC pipeline)
      if (result.lines?.length) {
        setTranscriptLines(result.lines);
      }
      setShowTranscriber(false);
      // Open WordTimeline so user can choose text cell mode
      setShowWordTimeline(true);
    },
    [totalDuration, toastError],
  );

  // ── Lyrics as timed text overlays ──
  const addLyricsAsTimedOverlays = useCallback(
    (lyricsText) => {
      const wordList = lyricsText.split(/\s+/).filter((w) => w.trim().length > 0);
      if (!wordList.length) return;
      const dur = totalDuration || 10;
      const wordDuration = dur / wordList.length;
      const timestamp = Date.now();
      const newOverlays = wordList.map((word, i) => ({
        id: `text_${timestamp}_${i}`,
        text: word,
        style: getDefaultTextStyle(),
        position: { x: 50, y: 50, width: 80, height: 20 },
        startTime: i * wordDuration,
        endTime: (i + 1) * wordDuration,
      }));
      setTextOverlays(newOverlays);
      toastSuccess(`Created ${newOverlays.length} timed word overlays`);
    },
    [totalDuration, getDefaultTextStyle, toastSuccess],
  );

  // ── Unsaved changes guard (beforeunload) ──
  const hasUnsavedWork =
    photos.length > 0 || textOverlays.length > 0 || !!selectedAudio || allVideos.length > 1;
  useUnsavedChanges(hasUnsavedWork);

  // ── Close with confirmation (fixes back button bug) ──
  const handleCloseRequest = useCallback(() => {
    if (hasUnsavedWork) {
      setShowCloseConfirm(true);
    } else {
      clearSession();
      onClose();
    }
  }, [hasUnsavedWork, onClose, clearSession]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't handle keys when a modal/overlay is open — let the modal handle them
      if (showAudioTrimmer || showBeatSelector || showMomentumSelector || showTranscriber) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        handleCloseRequest();
      }
      if (e.code === 'Space') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        if (isPlaying) stopPlayback();
        else startPlayback();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleCloseRequest,
    isPlaying,
    stopPlayback,
    startPlayback,
    showAudioTrimmer,
    showBeatSelector,
    showMomentumSelector,
    showTranscriber,
  ]);

  // ── Export ──
  const handleExport = useCallback(async () => {
    if (photos.length === 0) {
      toastError('Add at least one photo');
      return;
    }
    setIsExporting(true);
    setExportProgress(0);
    stopPlayback();

    try {
      const uploadedPhotos = await Promise.all(
        photos.map(async (photo) => {
          if (photo.isLocal && photo.file) {
            const { url } = await uploadFile(photo.file, 'images');
            return { ...photo, url, isLocal: false };
          }
          return photo;
        }),
      );

      let audioForExport = selectedAudio;
      if (selectedAudio?.file) {
        const { url } = await uploadFile(selectedAudio.file, 'audio');
        audioForExport = { ...selectedAudio, url };
      }

      // Build full expanded sequence (photos cycle to fill audio duration)
      const photosWithDurations = photoDurations.map((dur, i) => ({
        url: uploadedPhotos[i % uploadedPhotos.length].url,
        duration: dur,
      }));

      const blob = await renderPhotoMontage(
        {
          photos: photosWithDurations,
          aspectRatio,
          transition,
          kenBurns: kenBurnsEnabled,
          displayMode,
          audio: audioForExport,
        },
        (progress) => setExportProgress(progress),
      );

      setExportProgress(95);
      const { url: cloudUrl } = await uploadFile(
        new File([blob], `montage_${Date.now()}.mp4`, { type: 'video/mp4' }),
        'videos',
      );

      // Run quick QC check on exported video
      const qcResult = quickQC(
        { width: 1080, height: aspectRatio === '16:9' ? 608 : 1920, duration: totalDuration },
        { expectedDuration: totalDuration },
      );
      if (!qcResult.passed) {
        log.warn('[PhotoMontage] QC issues:', qcResult.issues);
      }

      const videoData = {
        name,
        audio: audioForExport
          ? { id: audioForExport.id, url: audioForExport.url, name: audioForExport.name }
          : null,
        clips: [],
        cropMode: aspectRatio,
        duration: totalDuration,
        collectionId: category?.id || null,
        editorMode: 'photo-montage',
        montagePhotos: uploadedPhotos.map((p) => ({ id: p.id, url: p.url, name: p.name })),
        montageSpeed: speed,
        montageTransition: transition,
        montageKenBurns: kenBurnsEnabled,
        montageBeatSync: beatSyncEnabled,
        montageDisplayMode: displayMode,
        textOverlays,
        textStyle,
        words,
        status: 'ready',
        cloudUrl,
        qcResult,
        sourceClipIds: uploadedPhotos.map((p) => p.id).filter(Boolean),
      };

      const saved = addCreatedVideo(artistId, videoData);
      if (db) {
        const content = { videos: [saved], slideshows: [] };
        await saveCreatedContentAsync(db, artistId, content);
      }

      toastSuccess('Photo montage exported!');
      onSave?.(saved);
      onClose?.();
    } catch (err) {
      log.error('[PhotoMontage] Export failed:', err);
      toastError(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [
    photos,
    selectedAudio,
    photoDurations,
    aspectRatio,
    transition,
    kenBurnsEnabled,
    displayMode,
    name,
    speed,
    beatSyncEnabled,
    totalDuration,
    artistId,
    db,
    category,
    textOverlays,
    textStyle,
    onSave,
    onClose,
    toastSuccess,
    toastError,
    stopPlayback,
  ]);

  // ── Ken Burns CSS animation for preview ──
  const getKenBurnsStyle = useCallback(
    (photoIndex, progress) => {
      if (!kenBurnsEnabled) return {};
      const effects = [
        { transform: `scale(${1 + progress * 0.15})` },
        { transform: `scale(${1.15 - progress * 0.15})` },
        { transform: `scale(1.1) translateX(${-5 + progress * 10}%)` },
        { transform: `scale(1.1) translateX(${5 - progress * 10}%)` },
        { transform: `scale(1.1) translateY(${5 - progress * 10}%)` },
        { transform: `scale(1.1) translateY(${-5 + progress * 10}%)` },
      ];
      return effects[photoIndex % effects.length];
    },
    [kenBurnsEnabled],
  );

  const SPEED_PRESETS = [
    { label: '4f', value: 4 / 30 },
    { label: '0.5s', value: 0.5 },
    { label: '1s', value: 1 },
    { label: '2s', value: 2 },
    { label: '3s', value: 3 },
  ];

  const handleAddToTextBank = useCallback(
    (bankNum, text) => {
      const col = category?.id ? collections.find((c) => c.id === category.id) : collections[0];
      if (!col) return;
      addToTextBank(artistId, col.id, bankNum, text, db);
      setCollections(getCollections(artistId));
    },
    [artistId, category, collections, db],
  );

  const handleRemoveFromTextBank = useCallback(
    (bankNum, index) => {
      const col = category?.id ? collections.find((c) => c.id === category.id) : collections[0];
      if (!col) return;
      removeFromTextBank(artistId, col.id, bankNum, index, db);
      setCollections(getCollections(artistId));
    },
    [artistId, category, collections, db],
  );

  const bankLabel = useCallback((idx) => getBankLabel(idx), []);

  // ── Current word (for inline preview) ──
  const currentWord =
    words.length > 0
      ? words.find((w) => {
          const s = w.startTime ?? w.start ?? 0;
          return (
            currentTime >= s &&
            currentTime < s + (w.duration ?? ((w.end ?? 0) - (w.start ?? 0) || 0.5))
          );
        })
      : null;

  // ── Render ──
  return (
    <EditorShell onBackdropClick={handleCloseRequest} isMobile={isMobile}>
      <EditorTopBar
        title={name}
        onTitleChange={setName}
        placeholder="Untitled Photo Montage"
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={handleSaveDraft}
        onExport={handleExport}
        onBack={handleCloseRequest}
        isMobile={isMobile}
        exportDisabled={isExporting || photos.length === 0}
        exportLoading={isExporting}
        exportLabel={isExporting ? `Exporting ${exportProgress}%` : 'Export'}
      />

      {/* ═══ MAIN CONTENT ═══ */}
      <div
        className={`flex grow basis-0 min-h-0 self-stretch overflow-hidden ${isMobile ? 'flex-col overflow-auto' : ''}`}
      >
        {/* ── LEFT PANEL — Photo List ── */}
        {!isMobile && (
          <div className="flex w-72 flex-none flex-col border-r border-neutral-200 bg-[#1a1a1aff] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-200">
              <span className="text-[13px] font-semibold text-white">
                Photos ({basePhotos.length})
              </span>
              <div className="flex gap-1">
                <label className="flex items-center justify-center w-7 h-7 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-400 cursor-pointer hover:text-white">
                  <FeatherUpload className="w-3.5 h-3.5" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => addPhotosFromFiles(Array.from(e.target.files))}
                    style={{ display: 'none' }}
                  />
                </label>
                <CloudImportButton
                  artistId={artistId}
                  db={db}
                  mediaType="image"
                  compact
                  onImportMedia={(files) => {
                    const realFiles = files.map((f) => f.file).filter(Boolean);
                    if (realFiles.length > 0) addPhotosFromFiles(realFiles);
                  }}
                />
                {libraryImages.length > 0 && (
                  <IconButton
                    size="small"
                    icon={<FeatherGrid />}
                    aria-label="Browse library"
                    onClick={() => setShowLibraryPicker(!showLibraryPicker)}
                  />
                )}
              </div>
            </div>

            {/* Library picker dropdown */}
            {showLibraryPicker && (
              <div className="p-2 border-b border-neutral-200 bg-[#171717]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-neutral-400">
                      Library ({libraryImages.length})
                    </span>
                    {libraryImages.length > 0 && (
                      <button
                        className="text-[11px] text-indigo-400 hover:text-indigo-300"
                        onClick={selectAllLib}
                      >
                        {selectedLibIds.size === libraryImages.length
                          ? 'Deselect All'
                          : 'Select All'}
                      </button>
                    )}
                  </div>
                  {selectedLibIds.size > 0 && (
                    <span className="text-[11px] text-neutral-500">
                      {selectedLibIds.size} selected
                    </span>
                  )}
                </div>
                {selectedLibIds.size > 0 && (
                  <Button
                    variant="brand-secondary"
                    size="small"
                    className="w-full mb-1.5"
                    onClick={() => {
                      const selected = libraryImages.filter((img) => selectedLibIds.has(img.id));
                      addPhotosFromLibrary(selected);
                      clearLibSelection();
                      toastSuccess(
                        `Added ${selected.length} photo${selected.length !== 1 ? 's' : ''} to montage`,
                      );
                    }}
                  >
                    Add {selectedLibIds.size} Photo{selectedLibIds.size !== 1 ? 's' : ''}
                  </Button>
                )}
                <div
                  className="relative max-h-[200px] overflow-y-auto"
                  ref={libGridRef}
                  {...libGridMouseHandlers}
                  style={{ userSelect: libDragSelecting ? 'none' : undefined }}
                >
                  {libRubberBand && (
                    <div
                      className="absolute pointer-events-none border border-indigo-400 bg-indigo-500/20 z-10 rounded-sm"
                      style={{
                        left: libRubberBand.left,
                        top: libRubberBand.top,
                        width: libRubberBand.width,
                        height: libRubberBand.height,
                      }}
                    />
                  )}
                  <div className="grid grid-cols-3 gap-1">
                    {libraryImages.map((img) => {
                      const isSelected = selectedLibIds.has(img.id);
                      return (
                        <div
                          key={img.id}
                          data-media-id={img.id}
                          className={`relative aspect-square cursor-pointer rounded overflow-hidden border-2 transition-colors ${
                            isSelected
                              ? 'border-indigo-500'
                              : 'border-neutral-200 hover:border-brand-500'
                          }`}
                          onClick={(e) => {
                            if (libDragSelecting) return;
                            if (e.shiftKey || selectedLibIds.size > 0) {
                              toggleLibSelect(img.id, e);
                            } else {
                              addPhotosFromLibrary([img]);
                            }
                          }}
                        >
                          <img
                            src={img.thumbnailUrl || img.url}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          {isSelected && (
                            <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-indigo-500 flex items-center justify-center">
                              <FeatherCheck
                                className="text-white"
                                style={{ width: 10, height: 10 }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Button
                  variant="neutral-secondary"
                  size="small"
                  onClick={() => {
                    setShowLibraryPicker(false);
                    clearLibSelection();
                  }}
                  className="mt-1.5 w-full"
                >
                  Done
                </Button>
              </div>
            )}

            {/* Photo list — shows unique base photos */}
            <div className="flex-1 overflow-y-auto p-2">
              {basePhotos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#555"
                    strokeWidth="1.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  <span className="text-[12px] text-neutral-500">Upload or import photos</span>
                </div>
              ) : (
                basePhotos.map((photo, index) => (
                  <div
                    key={`${photo.id}_${index}`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={() => setDragIndex(null)}
                    className="flex items-center gap-2 p-1.5 rounded-md mb-1 border cursor-grab transition-colors"
                    style={{
                      opacity: dragIndex === index ? 0.5 : 1,
                      borderColor: 'rgb(38,38,38)',
                      backgroundColor: 'transparent',
                    }}
                  >
                    <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
                      <img
                        src={photo.thumbnailUrl || photo.url}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-white truncate">
                        {photo.name || `Photo ${index + 1}`}
                      </div>
                      <div className="text-[10px] text-neutral-500">{speed.toFixed(1)}s</div>
                    </div>
                    <IconButton
                      size="small"
                      variant="destructive-tertiary"
                      icon={<FeatherTrash2 className="w-3 h-3" />}
                      onClick={() => removePhoto(index)}
                      aria-label="Remove"
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── CENTER COLUMN ── */}
        <div className="flex grow basis-0 min-h-0 flex-col items-center bg-black overflow-hidden">
          <div className="flex w-full max-w-[448px] grow flex-col items-center gap-4 py-6 px-4 overflow-auto">
            {/* Photo Preview */}
            {photos.length > 0 ? (
              <div
                ref={previewRef}
                className={`flex items-center justify-center rounded-lg border border-neutral-200 relative overflow-hidden ${displayMode === 'gallery' ? 'bg-[#f5f5f5]' : 'bg-[#1a1a1aff]'}`}
                style={{
                  aspectRatio:
                    aspectRatio === '1:1'
                      ? '1/1'
                      : aspectRatio === '4:5'
                        ? '4/5'
                        : aspectRatio === '16:9'
                          ? '16/9'
                          : '9/16',
                  maxHeight: '50vh',
                  width: 'auto',
                }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget || e.target.tagName === 'IMG')
                    setEditingTextId(null);
                }}
              >
                {displayMode === 'gallery' ? (
                  <img
                    src={photos[currentPhotoIndex]?.url}
                    alt=""
                    className="max-w-[80%] max-h-[85%] object-contain rounded-sm"
                    style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1)' }}
                  />
                ) : (
                  (() => {
                    // Compute crossfade alpha (0.3s before end of each photo)
                    const CROSSFADE_DUR = 0.3;
                    let fadeProgress = 0;
                    let nextIndex = -1;
                    if (
                      transition === 'crossfade' &&
                      photoDurations.length > 0 &&
                      currentExpandedIndex < photoDurations.length - 1
                    ) {
                      let elapsed = 0;
                      for (let i = 0; i < currentExpandedIndex; i++) elapsed += photoDurations[i];
                      const slotEnd = elapsed + photoDurations[currentExpandedIndex];
                      const timeUntilEnd = slotEnd - currentTime;
                      if (timeUntilEnd < CROSSFADE_DUR && timeUntilEnd >= 0) {
                        fadeProgress = 1 - timeUntilEnd / CROSSFADE_DUR;
                        nextIndex = (currentExpandedIndex + 1) % photos.length;
                      }
                    }
                    return (
                      <>
                        <img
                          src={photos[currentPhotoIndex]?.url}
                          alt=""
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                            opacity: fadeProgress > 0 ? 1 - fadeProgress : 1,
                            ...getKenBurnsStyle(currentPhotoIndex, currentPhotoProgress),
                            transition: isPlaying ? 'none' : 'transform 0.3s ease',
                          }}
                        />
                        {fadeProgress > 0 && nextIndex >= 0 && (
                          <img
                            src={photos[nextIndex]?.url}
                            alt=""
                            style={{
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              opacity: fadeProgress,
                              ...getKenBurnsStyle(nextIndex, 0),
                            }}
                          />
                        )}
                      </>
                    );
                  })()
                )}

                {/* Text overlays on preview */}
                {textOverlays
                  .filter(
                    (o) =>
                      currentTime >= (o.startTime ?? 0) &&
                      currentTime <= (o.endTime ?? totalDuration),
                  )
                  .map((overlay) => (
                    <DraggableTextOverlay
                      key={overlay.id}
                      text={overlay.text}
                      textStyle={overlay.style || textStyle}
                      color={editingTextId === overlay.id ? '#6366f1' : '#6366f180'}
                      isSelected={editingTextId === overlay.id}
                      onSelect={() => {
                        setEditingTextId(overlay.id);
                        setEditingTextValue(overlay.text);
                        setSelectedWordId(null);
                      }}
                      position={overlay.position || { x: 50, y: 50, width: 80 }}
                      onPositionChange={(newPos) =>
                        updateTextOverlay(overlay.id, { position: newPos })
                      }
                      onTextChange={(newText) => updateTextOverlay(overlay.id, { text: newText })}
                      containerRef={previewRef}
                      onDelete={() => {
                        removeTextOverlay(overlay.id);
                        setEditingTextId(null);
                      }}
                      hasSource={overlay.sourceBankIdx !== undefined}
                      onSaveToBank={
                        overlay.sourceBankIdx !== undefined
                          ? () => {
                              const colId = category?.id;
                              if (colId && artistId) {
                                updateTextBankEntry(
                                  artistId,
                                  colId,
                                  overlay.sourceBankIdx,
                                  overlay.sourceTextIdx,
                                  overlay.text,
                                  db,
                                );
                                toastSuccess('Updated text in bank');
                              }
                            }
                          : undefined
                      }
                    />
                  ))}

                {/* Inline word preview */}
                <WordPreview currentWord={currentWord} textStyle={textStyle} />

                {/* Photo counter */}
                <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-[11px] font-semibold">
                  {currentPhotoIndex + 1} / {photos.length}
                </div>
              </div>
            ) : (
              <div
                className="flex flex-col items-center justify-center rounded-lg bg-[#111118] border-2 border-dashed border-neutral-200"
                style={{
                  width: '300px',
                  aspectRatio:
                    aspectRatio === '1:1'
                      ? '1/1'
                      : aspectRatio === '4:5'
                        ? '4/5'
                        : aspectRatio === '16:9'
                          ? '16/9'
                          : '9/16',
                }}
              >
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#555"
                  strokeWidth="1"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
                <span className="text-neutral-500 text-[14px] mt-3">Add photos to preview</span>
              </div>
            )}

            {/* Playback controls */}
            <div className="flex items-center gap-3 w-full max-w-[500px] flex-shrink-0">
              <button
                onClick={isPlaying ? stopPlayback : startPlayback}
                disabled={photos.length === 0}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-brand-600 border-none text-white cursor-pointer flex-shrink-0 disabled:opacity-50"
              >
                {isPlaying ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21" />
                  </svg>
                )}
              </button>

              <input
                type="range"
                min={0}
                max={totalDuration || 1}
                step={0.01}
                value={currentTime}
                onChange={(e) => {
                  stopPlayback();
                  handleSeek(parseFloat(e.target.value));
                }}
                className="flex-1 accent-brand-600"
              />

              <span className="text-[11px] text-neutral-500 tabular-nums whitespace-nowrap min-w-[80px] text-right">
                {currentTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
              </span>
              {!isMobile && (
                <IconButton
                  size="small"
                  icon={<FeatherMaximize2 />}
                  aria-label="Fullscreen"
                  onClick={() => previewRef.current?.requestFullscreen()}
                />
              )}
            </div>

            {/* Re-roll Photo */}
            {photos.length > 0 && libraryImages.length > 1 && (
              <Button
                variant="neutral-secondary"
                size="small"
                icon={<FeatherRefreshCw />}
                onClick={handleReroll}
              >
                Re-roll
              </Button>
            )}

            {/* Export progress bar */}
            {isExporting && (
              <div className="w-full max-w-[500px] h-1 bg-neutral-100 rounded overflow-hidden flex-shrink-0">
                <div
                  className="h-full bg-brand-600 rounded transition-[width] duration-200"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            )}
          </div>

          {/* ═══ PIXEL TIMELINE (pinned below preview, matches Solo/Multi pattern) ═══ */}
          {photos.length > 0 &&
            (() => {
              const hasAudioTrack = !!(selectedAudio && waveformData.length > 0);
              const playheadPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
              const audioTrackH = hasAudioTrack ? Math.round(4 + 28 * externalAudioVolume) : 0;
              const trimmedDuration = selectedAudio
                ? (selectedAudio.endTime ||
                    waveformDuration ||
                    audioDuration ||
                    selectedAudio.duration ||
                    0) - (selectedAudio.startTime || 0)
                : 0;
              const MIN_CELL_W = MIN_CELL_W_HOOK;
              const effectiveTimelinePx = totalDuration * effectivePxPerSecHook;
              const effectivePxPerSec = effectivePxPerSecHook;
              return (
                <div className="flex w-full flex-col border-t border-neutral-200 bg-[#1a1a1aff] px-4 py-3 flex-shrink-0">
                  {/* Variation Tabs */}
                  {allVideos.length > 0 && (
                    <div className="flex w-full gap-1.5 overflow-x-auto mb-3 pb-1">
                      {allVideos.map((video, idx) => (
                        <button
                          key={video.id}
                          onClick={() => switchToVideo(idx)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] whitespace-nowrap flex-shrink-0 cursor-pointer transition-colors ${
                            idx === activeVideoIndex
                              ? 'border-brand-600 bg-brand-600/15 text-brand-600 font-semibold'
                              : 'border-neutral-200 bg-[#1a1a1aff] text-neutral-400 hover:border-neutral-600'
                          }`}
                        >
                          {video.isTemplate ? (
                            'Template'
                          ) : (
                            <>
                              #{idx}
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteVideo(idx);
                                }}
                                className="ml-0.5 opacity-50 hover:opacity-100 cursor-pointer text-[10px]"
                              >
                                x
                              </span>
                            </>
                          )}
                        </button>
                      ))}
                      <div className="flex items-center gap-1.5 ml-auto">
                        <ToggleGroup
                          value={keepTemplateText}
                          onValueChange={(v) => v && setKeepTemplateText(v)}
                        >
                          <ToggleGroup.Item value="none">Random</ToggleGroup.Item>
                          <ToggleGroup.Item value="all">Keep Text</ToggleGroup.Item>
                        </ToggleGroup>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={generateCount}
                          onChange={(e) =>
                            setGenerateCount(
                              Math.max(1, Math.min(20, parseInt(e.target.value) || 1)),
                            )
                          }
                          className="w-12 px-2 py-1.5 rounded-md border border-neutral-200 bg-black text-[#ffffffff] text-[13px] text-center outline-none"
                        />
                        <Button
                          variant="brand-primary"
                          size="small"
                          onClick={executeGeneration}
                          disabled={isGenerating || photos.length === 0}
                        >
                          {isGenerating ? 'Creating...' : 'Create'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Timeline header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-heading-3 font-heading-3 text-[#ffffffff]">
                        Timeline
                      </span>
                      <span className="text-caption font-caption text-neutral-500">
                        {basePhotos.length} photo{basePhotos.length !== 1 ? 's' : ''}
                      </span>
                      <Button variant="neutral-secondary" size="small" onClick={handleCutByWord}>
                        Cut by word
                      </Button>
                      <Button variant="neutral-secondary" size="small" onClick={handleCutByBeat}>
                        Cut by beat
                      </Button>
                      <Button
                        variant="neutral-secondary"
                        size="small"
                        onClick={() => setShowMomentumSelector(true)}
                      >
                        Cut to music
                      </Button>
                      {selectedTextIds.size > 0 && (
                        <>
                          <span className="text-[11px] text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">
                            {selectedTextIds.size} text selected
                          </span>
                          <Button
                            variant="destructive-tertiary"
                            size="small"
                            icon={<FeatherTrash2 />}
                            onClick={() => {
                              setTextOverlays((prev) =>
                                prev.filter((o) => !selectedTextIds.has(o.id)),
                              );
                              setSelectedTextIds(new Set());
                              setEditingTextId(null);
                            }}
                          >
                            Delete selected
                          </Button>
                        </>
                      )}
                      <Badge variant="neutral">
                        {beatAnalyzing
                          ? 'Analyzing beats...'
                          : bpm
                            ? `${Math.round(bpm)} BPM (${filteredBeats.length} beats)`
                            : 'No beats detected'}
                      </Badge>
                    </div>
                  </div>

                  {/* Volume controls row */}
                  {hasAudioTrack && (
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center gap-1.5">
                        <FeatherMusic style={{ width: 10, height: 10, color: '#22c55e' }} />
                        <span className="text-[10px] text-green-400 w-8">Audio</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={externalAudioVolume}
                          onChange={(e) => setExternalAudioVolume(parseFloat(e.target.value))}
                          style={{
                            width: '64px',
                            height: '4px',
                            accentColor: '#22c55e',
                            cursor: 'pointer',
                          }}
                          title={`Audio: ${Math.round(externalAudioVolume * 100)}%`}
                        />
                        <span className="text-[10px] text-neutral-500 w-8">
                          {Math.round(externalAudioVolume * 100)}%
                        </span>
                      </div>
                      {/* Zoom controls — right-aligned */}
                      <div className="flex items-center gap-1.5 ml-auto">
                        <FeatherZoomOut
                          style={{ width: 12, height: 12, color: '#737373', cursor: 'pointer' }}
                          onClick={() => setTimelineScale((s) => Math.max(0.3, s - 0.2))}
                        />
                        <input
                          type="range"
                          min="0.3"
                          max="3"
                          step="0.05"
                          value={timelineScale}
                          onChange={(e) => setTimelineScale(parseFloat(e.target.value))}
                          style={{
                            width: '80px',
                            height: '4px',
                            accentColor: '#6366f1',
                            cursor: 'pointer',
                          }}
                          title={`Zoom: ${Math.round(timelineScale * 100)}%`}
                        />
                        <FeatherZoomIn
                          style={{ width: 12, height: 12, color: '#737373', cursor: 'pointer' }}
                          onClick={() => setTimelineScale((s) => Math.min(3, s + 0.2))}
                        />
                      </div>
                    </div>
                  )}
                  {/* Zoom controls when no audio tracks */}
                  {!hasAudioTrack && (
                    <div className="flex items-center gap-1.5 mb-2 justify-end">
                      <FeatherZoomOut
                        style={{ width: 12, height: 12, color: '#737373', cursor: 'pointer' }}
                        onClick={() => setTimelineScale((s) => Math.max(0.3, s - 0.2))}
                      />
                      <input
                        type="range"
                        min="0.3"
                        max="3"
                        step="0.05"
                        value={timelineScale}
                        onChange={(e) => setTimelineScale(parseFloat(e.target.value))}
                        style={{
                          width: '80px',
                          height: '4px',
                          accentColor: '#6366f1',
                          cursor: 'pointer',
                        }}
                        title={`Zoom: ${Math.round(timelineScale * 100)}%`}
                      />
                      <FeatherZoomIn
                        style={{ width: 12, height: 12, color: '#737373', cursor: 'pointer' }}
                        onClick={() => setTimelineScale((s) => Math.min(3, s + 0.2))}
                      />
                    </div>
                  )}

                  {/* ═══ UNIFIED TIMELINE: labels column + single scrollable area ═══ */}
                  <div className="flex w-full items-start gap-3">
                    {/* Fixed labels column */}
                    <div className="w-20 flex flex-col shrink-0">
                      <div
                        style={{ height: '24px' }}
                        className="flex items-center justify-end pr-1"
                      >
                        <span className="text-[10px] text-neutral-600">Time</span>
                      </div>
                      {textOverlays.length > 0 && (
                        <div
                          style={{ height: `${Math.max(24, textOverlays.length * 24)}px` }}
                          className="flex items-center justify-end pr-1"
                        >
                          <span className="text-caption font-caption text-neutral-400">Text</span>
                        </div>
                      )}
                      {words.length > 0 && (
                        <div
                          style={{ height: '28px', cursor: 'pointer' }}
                          className="flex items-center justify-end pr-1"
                          onClick={() => setActiveTimelineRow('words')}
                        >
                          <span
                            className={`text-caption font-caption ${activeTimelineRow === 'words' ? 'text-indigo-400 font-semibold' : 'text-neutral-400'}`}
                          >
                            Words
                          </span>
                        </div>
                      )}
                      <div
                        style={{ height: '36px', cursor: 'pointer' }}
                        className="flex items-center justify-end pr-1"
                        onClick={() => setActiveTimelineRow('photos')}
                      >
                        <span
                          className={`text-caption font-caption ${activeTimelineRow === 'photos' ? 'text-indigo-400 font-semibold' : 'text-neutral-400'}`}
                        >
                          Photos
                        </span>
                      </div>
                      {hasAudioTrack && (
                        <div
                          style={{
                            height: `${audioTrackH}px`,
                            transition: 'height 0.15s ease-out',
                          }}
                          className="flex items-center justify-end pr-1"
                        >
                          {audioTrackH >= 16 && (
                            <span className="text-caption font-caption text-neutral-400">
                              Audio
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Single scrollable column */}
                    <div
                      className="flex-1 rounded-md border border-neutral-200 bg-black overflow-x-auto"
                      ref={timelineRef}
                    >
                      <div
                        style={{
                          position: 'relative',
                          minWidth: '100%',
                          width: `${effectiveTimelinePx}px`,
                        }}
                      >
                        {/* Playhead line — spans all tracks */}
                        {totalDuration > 0 && (
                          <div
                            style={{
                              position: 'absolute',
                              left: `${playheadPercent}%`,
                              top: 0,
                              bottom: 0,
                              width: '2px',
                              background: '#ef4444',
                              zIndex: 20,
                              pointerEvents: 'none',
                              boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)',
                              transition: isPlaying ? 'none' : 'left 0.1s ease-out',
                            }}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                top: '16px',
                                left: '-5px',
                                width: 0,
                                height: 0,
                                borderLeft: '6px solid transparent',
                                borderRight: '6px solid transparent',
                                borderTop: '8px solid #ef4444',
                              }}
                            />
                          </div>
                        )}

                        {/* Ruler row — click/drag to seek */}
                        <div
                          style={{
                            height: '24px',
                            position: 'relative',
                            cursor: 'crosshair',
                            borderBottom: '1px solid #333',
                          }}
                          onMouseDown={(e) => {
                            if (!timelineRef?.current || totalDuration <= 0) return;
                            e.preventDefault();
                            const seekFromEvent = (evt) => {
                              const rect = timelineRef.current.getBoundingClientRect();
                              const x =
                                (evt.clientX || 0) - rect.left + timelineRef.current.scrollLeft;
                              const t =
                                Math.max(0, Math.min(1, x / effectiveTimelinePx)) * totalDuration;
                              setCurrentTime(t);
                              if (audioRef.current && selectedAudio?.url) {
                                audioRef.current.currentTime = (selectedAudio.startTime || 0) + t;
                              }
                            };
                            seekFromEvent(e);
                            if (isPlaying) stopPlayback();
                            const onMove = (evt) => seekFromEvent(evt);
                            const onUp = () => {
                              document.removeEventListener('mousemove', onMove);
                              document.removeEventListener('mouseup', onUp);
                              document.removeEventListener('pointercancel', onUp);
                            };
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                            document.addEventListener('pointercancel', onUp);
                          }}
                        >
                          {rulerTicks.map((tick, i) => {
                            const xPx = tick.time * effectivePxPerSec;
                            return (
                              <div
                                key={i}
                                style={{
                                  position: 'absolute',
                                  left: `${xPx}px`,
                                  top: 0,
                                  bottom: 0,
                                }}
                              >
                                <div
                                  style={{
                                    width: '1px',
                                    height: tick.isLabel ? '10px' : '6px',
                                    backgroundColor: tick.isLabel
                                      ? 'rgba(255,255,255,0.4)'
                                      : 'rgba(255,255,255,0.15)',
                                    position: 'absolute',
                                    bottom: 0,
                                  }}
                                />
                                {tick.isLabel && (
                                  <span
                                    style={{
                                      position: 'absolute',
                                      top: '1px',
                                      left: '3px',
                                      fontSize: '9px',
                                      color: 'rgba(255,255,255,0.45)',
                                      whiteSpace: 'nowrap',
                                      userSelect: 'none',
                                    }}
                                  >
                                    {formatTime(tick.time)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Text overlay rows — one row per overlay */}
                        {textOverlays.length > 0 && (
                          <div
                            style={{
                              position: 'relative',
                              borderBottom: '1px solid #222',
                              cursor: 'crosshair',
                            }}
                            onPointerDown={handleTextTrackPointerDown}
                          >
                            {/* Marquee selection box */}
                            {textMarquee &&
                              (() => {
                                const minX = Math.min(textMarquee.startX, textMarquee.currentX);
                                const w = Math.abs(textMarquee.currentX - textMarquee.startX);
                                return (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      left: `${minX}px`,
                                      top: 0,
                                      bottom: 0,
                                      width: `${w}px`,
                                      backgroundColor: 'rgba(99,102,241,0.15)',
                                      border: '1px solid rgba(99,102,241,0.4)',
                                      zIndex: 10,
                                      pointerEvents: 'none',
                                    }}
                                  />
                                );
                              })()}
                            {textOverlays.map((overlay) => {
                              const start = overlay.startTime ?? 0;
                              const end = overlay.endTime ?? totalDuration;
                              const leftPx = start * effectivePxPerSec;
                              const widthPx = Math.max(20, (end - start) * effectivePxPerSec);
                              const isEditing = editingTextId === overlay.id;
                              const isMarqueeSelected = selectedTextIds.has(overlay.id);
                              const isSelected = isEditing || isMarqueeSelected;
                              const overlayColor = isSelected ? '#818cf8' : '#6366f1';
                              return (
                                <div
                                  key={overlay.id}
                                  style={{ height: '24px', position: 'relative' }}
                                >
                                  <div
                                    data-text-overlay
                                    style={{
                                      position: 'absolute',
                                      left: `${leftPx}px`,
                                      width: `${widthPx}px`,
                                      top: 2,
                                      bottom: 2,
                                      backgroundColor: isSelected
                                        ? 'rgba(99,102,241,0.4)'
                                        : 'rgba(99,102,241,0.2)',
                                      border: isMarqueeSelected
                                        ? '2px solid #a78bfa'
                                        : `1px solid ${overlayColor}`,
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      overflow: 'hidden',
                                      display: 'flex',
                                      alignItems: 'center',
                                      paddingLeft: '6px',
                                      boxShadow: isMarqueeSelected
                                        ? '0 0 6px rgba(167,139,250,0.4)'
                                        : 'none',
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (e.shiftKey) {
                                        setSelectedTextIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(overlay.id)) next.delete(overlay.id);
                                          else next.add(overlay.id);
                                          return next;
                                        });
                                      } else {
                                        setEditingTextId(overlay.id);
                                        setEditingTextValue(overlay.text);
                                        setSelectedTextIds(new Set());
                                        setSelectedWordId(null);
                                      }
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: '9px',
                                        color: '#c7d2fe',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        userSelect: 'none',
                                      }}
                                    >
                                      {overlay.text}
                                    </span>
                                    <div
                                      style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        width: '6px',
                                        height: '100%',
                                        cursor: 'col-resize',
                                        zIndex: 3,
                                      }}
                                      onPointerDown={(e) => {
                                        e.stopPropagation();
                                        const startX = e.clientX;
                                        const origStart = start;
                                        const move = (me) => {
                                          const dx = (me.clientX - startX) / effectivePxPerSec;
                                          const newStart = Math.max(
                                            0,
                                            Math.min(end - 0.5, origStart + dx),
                                          );
                                          updateTextOverlay(overlay.id, { startTime: newStart });
                                        };
                                        const up = () => {
                                          document.removeEventListener('pointermove', move);
                                          document.removeEventListener('pointerup', up);
                                          document.removeEventListener('pointercancel', up);
                                        };
                                        document.addEventListener('pointermove', move);
                                        document.addEventListener('pointerup', up);
                                        document.addEventListener('pointercancel', up);
                                      }}
                                    />
                                    <div
                                      style={{
                                        position: 'absolute',
                                        right: 0,
                                        top: 0,
                                        width: '6px',
                                        height: '100%',
                                        cursor: 'col-resize',
                                        zIndex: 3,
                                      }}
                                      onPointerDown={(e) => {
                                        e.stopPropagation();
                                        const startX = e.clientX;
                                        const origEnd = end;
                                        const move = (me) => {
                                          const dx = (me.clientX - startX) / effectivePxPerSec;
                                          const newEnd = Math.max(
                                            start + 0.5,
                                            Math.min(totalDuration, origEnd + dx),
                                          );
                                          updateTextOverlay(overlay.id, { endTime: newEnd });
                                        };
                                        const up = () => {
                                          document.removeEventListener('pointermove', move);
                                          document.removeEventListener('pointerup', up);
                                          document.removeEventListener('pointercancel', up);
                                        };
                                        document.addEventListener('pointermove', move);
                                        document.addEventListener('pointerup', up);
                                        document.addEventListener('pointercancel', up);
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Inline words row */}
                        {words.length > 0 && (
                          <InlineWordsRow
                            words={words}
                            pxPerSec={effectivePxPerSec}
                            selectedWordId={selectedWordId}
                            onWordClick={(wordId, wStart) => {
                              handleSeek(wStart);
                              setSelectedWordId(wordId);
                              setEditingTextId(null);
                              setActiveTimelineRow('words');
                            }}
                          />
                        )}

                        {/* Photo filmstrip row — expanded cycling cells */}
                        <div
                          style={{
                            height: '36px',
                            position: 'relative',
                            borderBottom: '1px solid #222',
                            display: 'flex',
                          }}
                        >
                          {(() => {
                            let cumulativeTime = 0;
                            return photoDurations.map((dur, i) => {
                              const photo = photos[i % photos.length];
                              if (!photo) {
                                cumulativeTime += dur;
                                return null;
                              }
                              const cellStart = cumulativeTime;
                              cumulativeTime += dur;
                              const photoWidth = Math.max(MIN_CELL_W, dur * effectivePxPerSec);
                              const isActive = currentExpandedIndex === i;
                              return (
                                <div
                                  key={`${photo.id}_t${i}`}
                                  onClick={() => {
                                    setCurrentTime(cellStart);
                                    if (audioRef.current && selectedAudio?.url) {
                                      audioRef.current.currentTime =
                                        (selectedAudio.startTime || 0) + cellStart;
                                    }
                                  }}
                                  style={{
                                    width: `${photoWidth}px`,
                                    height: '100%',
                                    overflow: 'hidden',
                                    boxSizing: 'border-box',
                                    flexShrink: 0,
                                    cursor: 'pointer',
                                    borderBottom: `2px solid ${isActive ? '#6366f1' : 'transparent'}`,
                                    borderRight:
                                      i < photoDurations.length - 1
                                        ? '1px solid rgba(0,0,0,0.4)'
                                        : 'none',
                                    opacity: isActive ? 1 : 0.6,
                                  }}
                                >
                                  <img
                                    src={photo.thumbnailUrl || photo.url}
                                    alt=""
                                    style={{
                                      width: '100%',
                                      height: '100%',
                                      objectFit: 'cover',
                                      display: 'block',
                                      pointerEvents: 'none',
                                    }}
                                    draggable={false}
                                  />
                                </div>
                              );
                            });
                          })()}
                        </div>

                        {/* Audio waveform row — continuous strip, height scales with volume */}
                        {hasAudioTrack &&
                          (() => {
                            const audioPx = trimmedDuration * effectivePxPerSec;
                            const maxBars = Math.max(50, Math.round(audioPx / 3));
                            const bars = downsample(waveformData, maxBars);
                            const trackH = audioTrackH;
                            return (
                              <div
                                style={{
                                  height: `${trackH}px`,
                                  borderTop: '1px solid #333',
                                  position: 'relative',
                                  transition: 'height 0.15s ease-out',
                                }}
                              >
                                <div
                                  style={{
                                    width: `${audioPx}px`,
                                    height: '100%',
                                    backgroundColor: 'rgba(34, 197, 94, 0.06)',
                                    display: 'flex',
                                    alignItems: 'center',
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      width: '100%',
                                      height: `${Math.max(2, trackH - 4)}px`,
                                      gap: '1px',
                                      padding: '0 1px',
                                    }}
                                  >
                                    {bars.map((amplitude, i) => (
                                      <div
                                        key={i}
                                        style={{
                                          flex: 1,
                                          minWidth: '1px',
                                          backgroundColor: 'rgba(34, 197, 94, 0.5)',
                                          height: `${amplitude * externalAudioVolume * 100}%`,
                                          opacity: externalAudioVolume > 0 ? 0.6 : 0.2,
                                        }}
                                      />
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                        {/* Unified cut lines — draggable to resize photo durations */}
                        {activeTimelineRow === 'photos' &&
                          photoDurations.length > 1 &&
                          (() => {
                            let cumDur = 0;
                            const boundaries = [];
                            photoDurations.forEach((dur, idx) => {
                              cumDur += dur;
                              if (idx < photoDurations.length - 1) {
                                boundaries.push({ px: cumDur * effectivePxPerSec, idx, cumDur });
                              }
                            });
                            const canDrag = !beatSyncEnabled;
                            const wordsRowH = words.length > 0 ? 28 : 0;
                            return boundaries.map(({ px, idx, cumDur: boundaryTime }) => (
                              <div
                                key={`cut-${idx}`}
                                style={{
                                  position: 'absolute',
                                  top: `${24 + (textOverlays.length > 0 ? Math.max(24, textOverlays.length * 24) : 0) + wordsRowH}px`,
                                  bottom: 0,
                                  left: `${px - 3}px`,
                                  width: '7px',
                                  cursor: canDrag ? 'col-resize' : 'default',
                                  zIndex: 14,
                                  display: 'flex',
                                  justifyContent: 'center',
                                }}
                                onMouseDown={
                                  canDrag
                                    ? (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const startX = e.clientX;
                                        const leftIdx = idx;
                                        const rightIdx = idx + 1;
                                        const leftPhotoIdx = leftIdx % photos.length;
                                        const rightPhotoIdx = rightIdx % photos.length;
                                        const origLeftDur = photoDurations[leftIdx];
                                        const origRightDur = photoDurations[rightIdx];
                                        const MIN_DUR = 0.1;
                                        const onMove = (me) => {
                                          const dx = (me.clientX - startX) / effectivePxPerSec;
                                          const newLeft = Math.max(
                                            MIN_DUR,
                                            Math.min(
                                              origLeftDur + origRightDur - MIN_DUR,
                                              origLeftDur + dx,
                                            ),
                                          );
                                          const newRight = origLeftDur + origRightDur - newLeft;
                                          setPhotos((prev) => {
                                            const copy = [...prev];
                                            copy[leftPhotoIdx] = {
                                              ...copy[leftPhotoIdx],
                                              customDuration: Math.round(newLeft * 100) / 100,
                                            };
                                            copy[rightPhotoIdx] = {
                                              ...copy[rightPhotoIdx],
                                              customDuration: Math.round(newRight * 100) / 100,
                                            };
                                            return copy;
                                          });
                                        };
                                        const onUp = () => {
                                          window.removeEventListener('mousemove', onMove);
                                          window.removeEventListener('mouseup', onUp);
                                        };
                                        window.addEventListener('mousemove', onMove);
                                        window.addEventListener('mouseup', onUp);
                                      }
                                    : undefined
                                }
                              >
                                <div
                                  style={{
                                    width: '1px',
                                    height: '100%',
                                    backgroundColor: canDrag
                                      ? 'rgba(255,255,255,0.5)'
                                      : 'rgba(255,255,255,0.35)',
                                  }}
                                />
                              </div>
                            ));
                          })()}

                        {/* Word boundary lines */}
                        {words.length > 0 && activeTimelineRow === 'words' && (
                          <WordBoundaryLines
                            words={words}
                            pxPerSec={effectivePxPerSec}
                            onStartDrag={(e, type, wi) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const word = words[wi];
                              if (!word) return;
                              const wStart = word.startTime ?? word.start ?? 0;
                              const wDur =
                                word.duration ?? ((word.end ?? 0) - (word.start ?? 0) || 0.5);
                              setWordCutDrag({
                                active: true,
                                wordIndex: wi,
                                boundaryType: type,
                                startX: e.clientX,
                                originalPos: type === 'end' ? wStart + wDur : wStart,
                              });
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        {!isMobile && (
          <div className="w-96 flex-none flex flex-col border-l border-neutral-200 bg-[#1a1a1aff] overflow-y-auto">
            {renderCollapsibleSection(
              'audio',
              'Audio',
              <div className="flex flex-col gap-3">
                {selectedAudio ? (
                  <>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-black/50 min-w-0">
                      <FeatherMusic className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      <span className="text-body font-body text-[#ffffffff] flex-1 min-w-0 truncate">
                        {selectedAudio.name || 'Audio'}
                      </span>
                      {selectedAudio.isTrimmed && <Badge className="flex-shrink-0">Trimmed</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="neutral-secondary"
                        size="small"
                        icon={<FeatherScissors />}
                        onClick={() => {
                          setAudioToTrim(selectedAudio);
                          setShowAudioTrimmer(true);
                        }}
                      >
                        Trim
                      </Button>
                      <Button
                        variant="neutral-secondary"
                        size="small"
                        icon={<FeatherMic />}
                        onClick={() => setShowTranscriber(true)}
                      >
                        Auto Transcribe
                      </Button>
                      <Button
                        variant="destructive-tertiary"
                        size="small"
                        icon={<FeatherTrash2 />}
                        onClick={handleRemoveAudio}
                      >
                        Remove
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="text-center text-neutral-500 text-caption font-caption py-4">
                    No audio selected
                  </div>
                )}
                <Button
                  className="w-full"
                  variant="neutral-secondary"
                  size="small"
                  icon={<FeatherUpload />}
                  onClick={() => audioFileInputRef.current?.click()}
                >
                  {selectedAudio ? 'Change Audio' : 'Upload Audio'}
                </Button>
                {filteredAudio.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <select
                        value={audioScope}
                        onChange={(e) => setAudioScope(e.target.value)}
                        className="flex-1 px-2 py-1 bg-black border border-neutral-200 rounded-md text-[11px] text-neutral-400 outline-none cursor-pointer"
                      >
                        {nicheAudio.length > 0 && (
                          <option value="niche">This Niche ({nicheAudio.length})</option>
                        )}
                        {projectAudio.length > 0 && (
                          <option value="project">This Project ({projectAudio.length})</option>
                        )}
                        <option value="all">All Audio ({libraryAudio.length})</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-0.5 max-h-[120px] overflow-y-auto">
                      {filteredAudio.map((audio) => (
                        <div
                          key={audio.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-neutral-100 text-[12px] text-[#ffffffff]"
                          onClick={() => {
                            setAudioToTrim(audio);
                            setShowAudioTrimmer(true);
                          }}
                        >
                          <FeatherMusic className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                          <span className="truncate">{audio.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>,
            )}

            {renderCollapsibleSection(
              'photoSettings',
              'Photo Settings',
              <div className="flex flex-col gap-4">
                {/* Display Mode */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-semibold text-white">Display Mode</span>
                  <ToggleGroup
                    value={displayMode}
                    onValueChange={(val) => {
                      if (val) setDisplayMode(val);
                    }}
                  >
                    <ToggleGroup.Item value="cover" icon={null}>
                      Cover
                    </ToggleGroup.Item>
                    <ToggleGroup.Item value="gallery" icon={null}>
                      Gallery
                    </ToggleGroup.Item>
                  </ToggleGroup>
                  <span className="text-[11px] text-neutral-500">
                    {displayMode === 'gallery'
                      ? 'White background with shadow — clean gallery look'
                      : 'Full-bleed photo fill'}
                  </span>
                </div>

                {/* Speed */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-semibold text-white">Speed (per photo)</span>
                  <ToggleGroup
                    value={
                      SPEED_PRESETS.find((p) => Math.abs(p.value - speed) < 0.001)?.label || ''
                    }
                    onValueChange={(label) => {
                      const preset = SPEED_PRESETS.find((p) => p.label === label);
                      if (preset) setSpeed(preset.value);
                    }}
                  >
                    {SPEED_PRESETS.map((preset) => (
                      <ToggleGroup.Item key={preset.label} value={preset.label} icon={null}>
                        {preset.label}
                      </ToggleGroup.Item>
                    ))}
                  </ToggleGroup>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min={0.03}
                      max={10}
                      step={0.1}
                      value={parseFloat(speed.toFixed(2))}
                      onChange={(e) => setSpeed(parseFloat(e.target.value) || 1)}
                      className="flex-1 py-1.5 px-2 text-[12px] bg-neutral-100 border border-neutral-200 rounded text-white outline-none"
                    />
                    <span className="text-[11px] text-neutral-500">sec</span>
                  </div>
                </div>

                {/* Transition */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-semibold text-white">Transition</span>
                  <ToggleGroup
                    value={transition}
                    onValueChange={(val) => {
                      if (val) setTransition(val);
                    }}
                  >
                    <ToggleGroup.Item value="cut" icon={null}>
                      Cut
                    </ToggleGroup.Item>
                    <ToggleGroup.Item value="crossfade" icon={null}>
                      Crossfade
                    </ToggleGroup.Item>
                  </ToggleGroup>
                </div>

                {/* Ken Burns */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-white">Ken Burns</span>
                    <Button
                      variant={kenBurnsEnabled ? 'brand-secondary' : 'neutral-secondary'}
                      size="small"
                      onClick={() => setKenBurnsEnabled(!kenBurnsEnabled)}
                    >
                      {kenBurnsEnabled ? 'ON' : 'OFF'}
                    </Button>
                  </div>
                  <span className="text-[11px] text-neutral-500">
                    Pan & zoom animation on each photo
                  </span>
                </div>

                {/* Beat Sync */}
                {selectedAudio && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-white">Beat Sync</span>
                      <Button
                        variant={beatSyncEnabled ? 'brand-secondary' : 'neutral-secondary'}
                        size="small"
                        onClick={() => setBeatSyncEnabled(!beatSyncEnabled)}
                        disabled={beatAnalyzing}
                      >
                        {beatAnalyzing ? '...' : beatSyncEnabled ? 'ON' : 'OFF'}
                      </Button>
                    </div>
                    {bpm && <Badge variant="neutral">{bpm} BPM</Badge>}
                    <span className="text-[11px] text-neutral-500">
                      Time photo cuts to the beat
                    </span>
                  </div>
                )}

                {/* Aspect Ratio */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-semibold text-white">Aspect Ratio</span>
                  <ToggleGroup
                    value={aspectRatio}
                    onValueChange={(val) => {
                      if (val) setAspectRatio(val);
                    }}
                  >
                    <ToggleGroup.Item value="9:16" icon={null}>
                      9:16
                    </ToggleGroup.Item>
                    <ToggleGroup.Item value="1:1" icon={null}>
                      1:1
                    </ToggleGroup.Item>
                    <ToggleGroup.Item value="4:5" icon={null}>
                      4:5
                    </ToggleGroup.Item>
                  </ToggleGroup>
                </div>
              </div>,
            )}

            {renderCollapsibleSection(
              'lyricBank',
              'Lyric Bank',
              <LyricBankSection
                lyrics={lyricsBank}
                hasAudio={!!selectedAudio}
                onAddNew={() => {
                  if (!selectedAudio) {
                    toastError('Upload audio first');
                    return;
                  }
                  setShowTranscriber(true);
                }}
                onApplyLyric={(lyric) => {
                  setLoadedBankLyricId(lyric.id);
                  if (lyric.words?.length > 0) {
                    setWords(lyric.words);
                    setShowWordTimeline(true);
                  } else if (lyric.content) {
                    // Parse raw lyrics text into placeholder words for WordTimeline
                    const plainWords = lyric.content
                      .split(/\s+/)
                      .filter(Boolean)
                      .map((text, i) => ({
                        text,
                        start: i * 0.5,
                        end: (i + 1) * 0.5,
                      }));
                    setWords(plainWords);
                    setShowWordTimeline(true);
                  } else {
                    toastError('This lyric has no content to edit');
                  }
                }}
                onDeleteLyric={(lyricId) => {
                  if (onDeleteLyrics) onDeleteLyrics(lyricId);
                  setLyricsBank((prev) => prev.filter((l) => l.id !== lyricId));
                }}
              />,
            )}

            {renderCollapsibleSection(
              'textBanks',
              'Text Banks',
              <div className="flex flex-col gap-4">
                {getTextBanks()
                  .slice(0, Math.max(photos.length, 2))
                  .map((textBank, idx) => {
                    const color = getBankColor(idx);
                    const inputVal = newTextInputs[idx] || '';
                    return (
                      <div key={`tb-${idx}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className="text-sm font-semibold"
                            style={{ color: color.light || color }}
                          >
                            {bankLabel(idx)} Text
                          </span>
                          {idx >= MIN_BANKS && (
                            <IconButton
                              variant="neutral-tertiary"
                              size="small"
                              icon={<FeatherTrash2 />}
                              aria-label={`Delete ${bankLabel(idx)} bank`}
                              onClick={() => {
                                const col = category?.id
                                  ? collections.find((c) => c.id === category.id)
                                  : collections[0];
                                if (!col) return;
                                removeBankFromCollection(artistId, col.id, idx);
                                if (db) {
                                  const freshCols = getCollections(artistId);
                                  const updated = freshCols.find((c) => c.id === col.id);
                                  if (updated)
                                    saveCollectionToFirestore(db, artistId, updated).catch(
                                      log.error,
                                    );
                                }
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
                              return (
                                <div key={i} className="flex items-center gap-2">
                                  <div
                                    className="flex-1 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50 text-white text-[13px] cursor-pointer leading-snug break-words"
                                    style={{ borderLeft: `3px solid ${color.light || color}` }}
                                    onClick={() => addTextOverlay(entryText)}
                                  >
                                    {entryText}
                                  </div>
                                  <IconButton
                                    variant="neutral-tertiary"
                                    size="small"
                                    icon={<FeatherX />}
                                    onClick={() => handleRemoveFromTextBank(idx + 1, i)}
                                    aria-label="Remove text"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {textBank.length === 0 && (
                          <div className="text-[13px] text-neutral-400 py-2 text-center">
                            No text yet
                          </div>
                        )}
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={inputVal}
                            onChange={(e) =>
                              setNewTextInputs((prev) => ({ ...prev, [idx]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && inputVal.trim()) {
                                handleAddToTextBank(idx + 1, inputVal);
                                setNewTextInputs((prev) => ({ ...prev, [idx]: '' }));
                              }
                            }}
                            placeholder="Add text..."
                            className="flex-1 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50 text-white text-[13px] outline-none"
                          />
                          <IconButton
                            variant={inputVal.trim() ? 'neutral-secondary' : 'neutral-tertiary'}
                            size="small"
                            icon={<FeatherPlus />}
                            disabled={!inputVal.trim()}
                            onClick={() => {
                              if (inputVal.trim()) {
                                handleAddToTextBank(idx + 1, inputVal);
                                setNewTextInputs((prev) => ({ ...prev, [idx]: '' }));
                              }
                            }}
                            aria-label="Add text"
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
                      const col = category?.id
                        ? collections.find((c) => c.id === category.id)
                        : collections[0];
                      if (!col) return;
                      addBankToCollection(artistId, col.id);
                      if (db) {
                        const freshCols = getCollections(artistId);
                        const updated = freshCols.find((c) => c.id === col.id);
                        if (updated)
                          saveCollectionToFirestore(db, artistId, updated).catch(log.error);
                      }
                      setCollections(getCollections(artistId));
                      toastSuccess(`${bankLabel(getTextBanks().length)} added`);
                    }}
                    className="w-full"
                  >
                    Add Text Bank
                  </Button>
                )}
              </div>,
            )}

            {renderCollapsibleSection(
              'textStyle',
              'Text Style',
              (() => {
                const selOverlay = editingTextId
                  ? textOverlays.find((o) => o.id === editingTextId)
                  : null;
                const isWordMode = !selOverlay && !!selectedWordId;
                const activeStyle =
                  selOverlay?.style || (isWordMode ? textStyle : getDefaultTextStyle());
                const disabled = !selOverlay && !isWordMode;
                const handleStyleChange = (updates) => {
                  if (selOverlay)
                    updateTextOverlay(selOverlay.id, {
                      style: { ...selOverlay.style, ...updates },
                    });
                  else if (isWordMode) setTextStyle((prev) => ({ ...prev, ...updates }));
                };
                const strokeInfo = activeStyle.textStroke
                  ? parseStroke(activeStyle.textStroke)
                  : { width: 0.5, color: '#000000' };
                return (
                  <div
                    className={`flex flex-col gap-4 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
                  >
                    {disabled && (
                      <div className="text-xs text-neutral-400 italic mb-3">
                        Click a word or text overlay to style it
                      </div>
                    )}
                    {isWordMode && (
                      <div className="text-xs text-indigo-400 italic mb-1">
                        Styling lyrics words
                      </div>
                    )}

                    {/* Add + Delete buttons — always accessible (escape disabled when isWordMode) */}
                    <div
                      className="flex gap-2"
                      style={disabled || isWordMode ? { opacity: 1, pointerEvents: 'auto' } : {}}
                    >
                      <Button
                        variant="brand-secondary"
                        size="small"
                        icon={<FeatherPlus />}
                        onClick={() => addTextOverlay()}
                        style={
                          isWordMode ? { display: 'none' } : { opacity: 1, pointerEvents: 'auto' }
                        }
                      >
                        Add Text
                      </Button>
                      {selOverlay && (
                        <Button
                          variant="neutral-secondary"
                          size="small"
                          icon={<FeatherTrash2 />}
                          onClick={() => removeTextOverlay(selOverlay.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>

                    {/* Selected overlay text input */}
                    {selOverlay && (
                      <input
                        value={selOverlay.text}
                        onChange={(e) => updateTextOverlay(selOverlay.id, { text: e.target.value })}
                        className="w-full px-3 py-2 rounded-md border border-neutral-200 bg-black text-white text-sm"
                      />
                    )}

                    {/* Font Family */}
                    <div>
                      <div className="text-[13px] text-neutral-500 mb-1.5">Font Family</div>
                      <select
                        value={activeStyle.fontFamily || "'Inter', sans-serif"}
                        onChange={(e) => handleStyleChange({ fontFamily: e.target.value })}
                        className="w-full px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50 text-white text-[13px] outline-none cursor-pointer"
                      >
                        {AVAILABLE_FONTS.map((f) => (
                          <option key={f.name} value={f.value}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Font Size */}
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-[13px] text-neutral-500">Font Size</span>
                        <span className="text-[13px] text-white">
                          {activeStyle.fontSize || 48}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="12"
                        max="120"
                        step="2"
                        value={activeStyle.fontSize || 48}
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
                            type="color"
                            value={activeStyle.color || '#ffffff'}
                            onChange={(e) => handleStyleChange({ color: e.target.value })}
                            className="w-6 h-6 border-none rounded-full cursor-pointer p-0 bg-transparent"
                          />
                          <span className="text-xs text-neutral-500 font-mono">
                            {(activeStyle.color || '#ffffff').toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="text-[13px] text-neutral-500 mb-1.5">Outline</div>
                        <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50">
                          <input
                            type="color"
                            value={activeStyle.outlineColor || '#000000'}
                            onChange={(e) =>
                              handleStyleChange({ outlineColor: e.target.value, outline: true })
                            }
                            className="w-6 h-6 border-none rounded-full cursor-pointer p-0 bg-transparent"
                          />
                          <span className="text-xs text-neutral-500 font-mono">
                            {(activeStyle.outlineColor || '#000000').toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stroke Color + Width */}
                    {activeStyle.textStroke && (
                      <>
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <div className="text-[13px] text-neutral-500 mb-1.5">Stroke Color</div>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50">
                              <input
                                type="color"
                                value={
                                  strokeInfo.color.startsWith('#') ? strokeInfo.color : '#000000'
                                }
                                onChange={(e) =>
                                  handleStyleChange({
                                    textStroke: buildStroke(strokeInfo.width, e.target.value),
                                  })
                                }
                                className="w-6 h-6 border-none rounded-full cursor-pointer p-0 bg-transparent"
                              />
                              <span className="text-xs text-neutral-500 font-mono">
                                {(strokeInfo.color.startsWith('#')
                                  ? strokeInfo.color
                                  : '#000000'
                                ).toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between mb-1.5">
                            <span className="text-[13px] text-neutral-500">Stroke Width</span>
                            <span className="text-[13px] text-white">{strokeInfo.width}px</span>
                          </div>
                          <input
                            type="range"
                            min="0.1"
                            max="10"
                            step="0.1"
                            value={strokeInfo.width}
                            onChange={(e) =>
                              handleStyleChange({
                                textStroke: buildStroke(
                                  parseFloat(e.target.value),
                                  strokeInfo.color,
                                ),
                              })
                            }
                            className="w-full accent-brand-600"
                          />
                        </div>
                      </>
                    )}

                    {/* Formatting */}
                    <div>
                      <div className="text-[13px] text-neutral-500 mb-1.5">Formatting</div>
                      <div className="flex gap-1">
                        {[
                          {
                            key: 'bold',
                            label: 'B',
                            ariaLabel: 'Bold',
                            active: activeStyle.fontWeight === '700',
                            toggle: () =>
                              handleStyleChange({
                                fontWeight: activeStyle.fontWeight === '700' ? '400' : '700',
                              }),
                            bold: true,
                          },
                          {
                            key: 'caps',
                            label: 'AA',
                            ariaLabel: 'All caps',
                            active: activeStyle.textCase === 'upper',
                            toggle: () =>
                              handleStyleChange({
                                textCase: activeStyle.textCase === 'upper' ? 'default' : 'upper',
                              }),
                          },
                          {
                            key: 'outline',
                            label: 'O',
                            ariaLabel: 'Outline',
                            active: !!activeStyle.outline,
                            toggle: () => handleStyleChange({ outline: !activeStyle.outline }),
                          },
                          {
                            key: 'stroke',
                            label: 'St',
                            ariaLabel: 'Stroke',
                            active: !!activeStyle.textStroke,
                            toggle: () =>
                              handleStyleChange({
                                textStroke: activeStyle.textStroke
                                  ? null
                                  : buildStroke(0.5, '#000000'),
                              }),
                          },
                        ].map((btn) => (
                          <IconButton
                            key={btn.key}
                            onClick={btn.toggle}
                            variant={btn.active ? 'brand-secondary' : 'neutral-secondary'}
                            size="small"
                            icon={
                              <span
                                className={`text-xs ${btn.bold ? 'font-bold' : 'font-semibold'}`}
                              >
                                {btn.label}
                              </span>
                            }
                            aria-label={btn.ariaLabel}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Alignment */}
                    <div>
                      <div className="text-[13px] text-neutral-500 mb-1.5">Alignment</div>
                      <ToggleGroup
                        value={activeStyle.textAlign || 'center'}
                        onValueChange={(val) => handleStyleChange({ textAlign: val })}
                      >
                        <ToggleGroup.Item value="left" icon={<FeatherAlignLeft />}>
                          {null}
                        </ToggleGroup.Item>
                        <ToggleGroup.Item value="center" icon={<FeatherAlignCenter />}>
                          {null}
                        </ToggleGroup.Item>
                        <ToggleGroup.Item value="right" icon={<FeatherAlignRight />}>
                          {null}
                        </ToggleGroup.Item>
                      </ToggleGroup>
                    </div>

                    {/* Text Overlays list */}
                    <div className="pt-2 border-t border-neutral-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[13px] text-neutral-500">Text Overlays</span>
                      </div>
                      {textOverlays.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          {textOverlays.map((overlay) => (
                            <div
                              key={overlay.id}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${editingTextId === overlay.id ? 'bg-brand-600/20 border border-brand-600' : 'border border-neutral-200 hover:bg-neutral-100'}`}
                              onClick={() => {
                                setEditingTextId(overlay.id);
                                setEditingTextValue(overlay.text);
                                setSelectedWordId(null);
                              }}
                            >
                              <span className="text-body font-body text-[#ffffffff] text-[12px] truncate flex-1">
                                {overlay.text}
                              </span>
                              <IconButton
                                size="small"
                                variant="destructive-tertiary"
                                icon={<FeatherTrash2 className="w-3 h-3" />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeTextOverlay(overlay.id);
                                }}
                                aria-label="Remove"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[12px] text-neutral-500 text-center py-2">
                          No text overlays yet
                        </div>
                      )}
                    </div>

                    {/* Crop */}
                    <div className="flex items-center gap-2 pt-2 border-t border-neutral-200">
                      <span className="text-caption font-caption text-neutral-400">Crop</span>
                      <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        className="flex-1 px-2 py-1.5 bg-neutral-100 border border-neutral-200 rounded-md text-[#ffffffff] text-[12px] outline-none"
                      >
                        <option value="9:16">9:16 (Full)</option>
                        <option value="4:3">4:3 (Crop)</option>
                        <option value="1:1">1:1 (Crop)</option>
                      </select>
                    </div>
                    {presets.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-caption font-caption text-neutral-400">
                          Apply Preset
                        </span>
                        <select
                          value={selectedPreset?.id || ''}
                          onChange={(e) => {
                            const preset = presets.find((p) => p.id === e.target.value);
                            if (preset) handleApplyPreset(preset);
                          }}
                          className="w-full px-3 py-2 bg-neutral-100 border border-neutral-200 rounded-md text-[#ffffffff] text-[13px] outline-none"
                        >
                          <option value="">Choose a preset...</option>
                          {presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })(),
            )}
          </div>
        )}
      </div>

      {/* ── Preset Bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          borderTop: `1px solid ${theme.border.subtle}`,
        }}
      >
        <span style={{ fontSize: '11px', color: theme.text.muted, whiteSpace: 'nowrap' }}>
          Preset
        </span>
        <select
          value={selectedPreset?.id || ''}
          onChange={(e) => {
            const preset = presets.find((p) => p.id === e.target.value);
            if (preset) handleApplyPreset(preset);
          }}
          style={{
            flex: '0 1 200px',
            padding: '4px 8px',
            fontSize: '11px',
            backgroundColor: theme.bg.surface,
            border: `1px solid ${theme.bg.elevated}`,
            borderRadius: '6px',
            color: theme.text.primary,
            outline: 'none',
          }}
        >
          <option value="">Choose a preset...</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        {!isMobile && (
          <Button
            variant="neutral-tertiary"
            size="small"
            icon={<FeatherStar />}
            onClick={() => {
              setPresetPromptValue('');
              setShowPresetPrompt(true);
            }}
          >
            Save preset
          </Button>
        )}
      </div>

      <EditorFooter
        lastSaved={lastSaved}
        onCancel={onClose}
        onSaveAll={allVideos.length > 1 ? handleSaveAllAndClose : handleSaveDraft}
        isSavingAll={isSavingAll}
        saveAllCount={allVideos.length}
        saveLabel="Save"
      />

      {/* Hidden audio file input */}
      <input
        ref={audioFileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleAudioUpload}
        style={{ display: 'none' }}
      />

      {/* Hidden audio element for preview playback */}
      <audio ref={audioRef} style={{ display: 'none' }} crossOrigin="anonymous" preload="auto" />

      {/* ── Audio Trimmer Modal ── */}
      {showAudioTrimmer &&
        (audioToTrim || selectedAudio) &&
        (() => {
          const trimTarget = audioToTrim || selectedAudio;
          return (
            <AudioClipSelector
              audioFile={trimTarget.file}
              audioUrl={trimTarget.localUrl || trimTarget.url}
              audioName={trimTarget.name || trimTarget.fileName || 'Audio'}
              initialStart={trimTarget.startTime || 0}
              initialEnd={trimTarget.endTime || null}
              onSave={handleAudioTrimSave}
              onSaveClip={handleAudioSaveClip}
              onCancel={() => {
                setShowAudioTrimmer(false);
                setAudioToTrim(null);
              }}
            />
          );
        })()}

      {/* ── Beat Selector Modal ── */}
      {showBeatSelector && (
        <BeatSelector
          beats={filteredBeats}
          bpm={bpm}
          duration={(audioEndTime || audioDuration) - audioStartTime}
          onApply={handleBeatSelectionApply}
          onCancel={() => setShowBeatSelector(false)}
        />
      )}

      {/* ── Momentum Selector Modal ── */}
      {showMomentumSelector && selectedAudio?.url && (
        <MomentumSelector
          audioSource={selectedAudio.url}
          duration={(audioEndTime || audioDuration) - audioStartTime}
          trimStart={audioStartTime || undefined}
          trimEnd={audioEndTime || undefined}
          onApply={(cutPoints) => {
            handleBeatSelectionApply(cutPoints);
            setShowMomentumSelector(false);
          }}
          onCancel={() => setShowMomentumSelector(false)}
        />
      )}

      {/* ── Lyric Analyzer Modal ── */}
      {showTranscriber && selectedAudio && (
        <LyricAnalyzer
          audioUrl={selectedAudio.localUrl || selectedAudio.url}
          onComplete={handleTranscriptionComplete}
          onClose={() => setShowTranscriber(false)}
        />
      )}

      {/* ── Word Timeline Modal ── */}
      {showWordTimeline && (
        <WordTimeline
          words={words}
          setWords={setWords}
          duration={totalDuration}
          currentTime={currentTime}
          onSeek={handleSeek}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onClose={() => setShowWordTimeline(false)}
          audioRef={audioRef}
          loadedBankLyricId={loadedBankLyricId}
          onSaveToBank={(lyricId, wordsToSave) => {
            if (lyricId && onUpdateLyrics) {
              onUpdateLyrics(lyricId, { words: wordsToSave });
            }
          }}
          onAddToBank={(lyricData) => {
            if (onAddLyrics) {
              onAddLyrics({
                title: lyricData.title,
                content: lyricData.content,
                words: lyricData.words,
              });
            }
          }}
          lines={transcriptLines}
          beats={filteredBeats}
          onApplyTextCells={(overlays) => {
            setTextOverlays(overlays);
            setShowWordTimeline(false);
          }}
          textStyle={getDefaultTextStyle()}
        />
      )}

      {/* ── Close Confirmation ── */}
      {showCloseConfirm && (
        <CloseConfirmOverlay
          onKeepEditing={() => setShowCloseConfirm(false)}
          onClose={() => {
            setShowCloseConfirm(false);
            onClose();
          }}
        />
      )}

      {/* ── Preset Save Modal ── */}
      {showPresetPrompt && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: theme.overlay.heavy }}
          onClick={() => setShowPresetPrompt(false)}
        >
          <div
            className="rounded-xl p-6 w-[360px] max-w-[90vw]"
            style={{ background: theme.bg.input }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[16px] font-semibold mb-3" style={{ color: theme.text.primary }}>
              Save Preset
            </div>
            <input
              autoFocus
              value={presetPromptValue}
              onChange={(e) => setPresetPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowPresetPrompt(false);
                if (e.key === 'Enter' && presetPromptValue.trim()) {
                  onSavePreset?.({
                    name: presetPromptValue.trim(),
                    settings: { ...textStyle, cropMode: aspectRatio },
                  });
                  toastSuccess(`Preset "${presetPromptValue.trim()}" saved!`);
                  setShowPresetPrompt(false);
                }
              }}
              placeholder="Preset name..."
              className="w-full rounded-lg py-2.5 px-3 text-sm outline-none"
              style={{
                background: theme.bg.page,
                border: `1px solid ${theme.bg.elevated}`,
                color: theme.text.primary,
              }}
            />
            <div className="flex gap-2 justify-end mt-3">
              <Button
                variant="neutral-secondary"
                size="small"
                onClick={() => setShowPresetPrompt(false)}
              >
                Cancel
              </Button>
              <Button
                variant="brand-primary"
                size="small"
                onClick={() => {
                  if (presetPromptValue.trim()) {
                    onSavePreset?.({
                      name: presetPromptValue.trim(),
                      settings: { ...textStyle, cropMode: aspectRatio },
                    });
                    toastSuccess(`Preset "${presetPromptValue.trim()}" saved!`);
                  }
                  setShowPresetPrompt(false);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </EditorShell>
  );
};

export default PhotoMontageEditor;
