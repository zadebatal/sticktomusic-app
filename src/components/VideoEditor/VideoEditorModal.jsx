import React, { useState, useCallback, useRef, useEffect, useMemo, Suspense } from 'react';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import WordTimeline from './WordTimeline';
import BeatSelector from './BeatSelector';
import MomentumSelector from './MomentumSelector';
import LyricBank from './LyricBank';
import LyricBankSection from './shared/LyricBankSection';
import TemplatePicker from './TemplatePicker';
const SoloClipEditor = React.lazy(() => import('./SoloClipEditor'));
const MultiClipEditor = React.lazy(() => import('./MultiClipEditor'));
const PhotoMontageEditor = React.lazy(() => import('./PhotoMontageEditor'));
const ClipperEditor = React.lazy(() => import('./ClipperEditor'));
import AudioClipSelector from './AudioClipSelector';
import CloudImportButton from './CloudImportButton';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';
import { saveApiKey, loadApiKey } from '../../services/storageService';
import { EmptyState as SharedEmptyState, useToast } from '../ui';
import {
  incrementUseCount,
  getLibrary,
  getCollections,
  getLyrics,
  subscribeToLibrary,
  subscribeToCollections,
  addToTextBank,
  updateTextBankEntry,
  MEDIA_TYPES,
  getTextBankText,
  getTextBankStyle,
} from '../../services/libraryService';
import {
  getTrimHash,
  getTrimBoundaries,
  validateLocalTimeData,
  normalizeWordsToTrimRange,
  normalizeBeatsToTrimRange,
} from '../../utils/timelineNormalization';
import log from '../../utils/logger';
import useIsMobile from '../../hooks/useIsMobile';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherX,
  FeatherPlay,
  FeatherPause,
  FeatherVolume2,
  FeatherVolumeX,
  FeatherMaximize2,
  FeatherPlus,
  FeatherTrash2,
  FeatherScissors,
  FeatherRefreshCw,
  FeatherChevronUp,
  FeatherZoomIn,
  FeatherZoomOut,
  FeatherStar,
  FeatherMusic,
  FeatherUpload,
  FeatherDatabase,
  FeatherMic,
  FeatherAlignLeft,
  FeatherAlignCenter,
  FeatherAlignRight,
} from '@subframe/core';
import DraggableTextOverlay from './shared/previews/DraggableTextOverlay';
import EditorShell from './shared/EditorShell';
import EditorTopBar from './shared/EditorTopBar';
import EditorFooter from './shared/EditorFooter';
import useCollapsibleSections from './shared/useCollapsibleSections';
import useUnsavedChanges from './shared/useUnsavedChanges';
import { parseStroke, buildStroke, AVAILABLE_FONTS } from './shared/editorConstants';

// Default text style used for template initialization and recovery fallback
const DEFAULT_TEXT_STYLE = {
  fontSize: 48,
  fontFamily: "'TikTok Sans', sans-serif",
  fontWeight: '600',
  color: '#ffffff',
  outline: true,
  outlineColor: '#000000',
  textStroke: null,
  textCase: 'default',
  displayMode: 'word',
};

/**
 * VideoEditorModal - Flowstage-inspired video editor modal
 * Clean UI with preview, controls, and clip timeline
 */
const VideoEditorModal = ({
  category,
  existingVideo,
  presets = [],
  onSave,
  onSavePreset,
  onSaveLyrics,
  onAddLyrics,
  onUpdateLyrics,
  onDeleteLyrics,
  onShowBatchPipeline,
  onClose,
  artistId = null,
  db = null,
  showTemplatePicker = false,
  schedulerEditMode = false,
  initialEditorMode = null,
  clipperSourceVideos = [],
  clipperSession = null,
  onSaveClipperSession = null,
  nicheBankLabels = null,
  clipperProjectNiches = [],
}) => {
  // Editor mode: null = show picker, 'montage' = current editor, 'solo-clip' = solo clip editor
  // Show picker only when explicitly creating a new video (showTemplatePicker=true)
  // initialEditorMode bypasses the template picker when launching from pipeline format selection
  const [editorMode, setEditorMode] = useState(
    initialEditorMode || existingVideo?.editorMode || (showTemplatePicker ? null : 'montage'),
  );

  // Theme (kept for dynamic values in waveform tracks)
  const { theme } = useTheme();

  // Mobile responsive detection
  const { isMobile } = useIsMobile();

  // ── Multi-video state (template + generated variations) ──
  // DEFAULT_TEXT_STYLE defined outside component for stable reference
  // Convert niche textOverlays to words format for montage editor (preserve position)
  const initialWords =
    existingVideo?.words?.length > 0
      ? existingVideo.words
      : (existingVideo?.textOverlays || []).map((ov, i) => ({
          id: ov.id || `word-niche-${i}`,
          text: ov.text,
          startTime: 0,
          duration: existingVideo?.duration || 30,
          position: ov.position || null,
          style: ov.style || null,
        }));
  const initialTextOverlays = (existingVideo?.textOverlays || []).map((ov, i) => ({
    id: ov.id || `text_niche_${i}`,
    text: ov.text,
    style: ov.style || null,
    position: ov.position || { x: 50, y: 50, width: 80 },
    startTime: ov.startTime ?? 0,
    endTime: ov.endTime ?? (existingVideo?.duration || 30),
  }));
  const [allVideos, setAllVideos] = useState([
    {
      id: 'template',
      name: existingVideo?.name || 'Template',
      clips: existingVideo?.clips || [],
      audio: existingVideo?.audio || null,
      words: initialWords,
      textOverlays: initialTextOverlays,
      lyrics: existingVideo?.lyrics || initialWords.map((w) => w.text).join(' '),
      textStyle: existingVideo?.textStyle || { ...DEFAULT_TEXT_STYLE },
      cropMode: '9:16',
      duration: existingVideo?.duration || 30,
      isTemplate: true,
    },
  ]);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const nicheGenCount = existingVideo?._nicheGenerateCount || null;
  const [generateCount, setGenerateCount] = useState(
    nicheGenCount ? Math.max(nicheGenCount - 1, 1) : 10,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [keepTemplateText, setKeepTemplateText] = useState('none');

  // Derived reads from active video
  const selectedAudio = allVideos[activeVideoIndex]?.audio || null;
  const clips = allVideos[activeVideoIndex]?.clips || [];
  const duration = allVideos[activeVideoIndex]?.duration || 30;
  const lyrics = allVideos[activeVideoIndex]?.lyrics || '';
  const words = allVideos[activeVideoIndex]?.words || [];
  const textStyle = allVideos[activeVideoIndex]?.textStyle || { ...DEFAULT_TEXT_STYLE };
  const cropMode = allVideos[activeVideoIndex]?.cropMode || '9:16';
  const textOverlays = allVideos[activeVideoIndex]?.textOverlays || [];

  // Wrapper setters that route through allVideos
  const setTextOverlays = useCallback(
    (updater) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = {
          ...cur,
          textOverlays: typeof updater === 'function' ? updater(cur.textOverlays || []) : updater,
        };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  const setSelectedAudio = useCallback(
    (updater) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = {
          ...cur,
          audio: typeof updater === 'function' ? updater(cur.audio) : updater,
        };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  const setClips = useCallback(
    (updater) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = {
          ...cur,
          clips: typeof updater === 'function' ? updater(cur.clips) : updater,
        };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  const setDuration = useCallback(
    (updater) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = {
          ...cur,
          duration: typeof updater === 'function' ? updater(cur.duration) : updater,
        };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  const setLyrics = useCallback(
    (updater) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = {
          ...cur,
          lyrics: typeof updater === 'function' ? updater(cur.lyrics) : updater,
        };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  const setWords = useCallback(
    (updater) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = {
          ...cur,
          words: typeof updater === 'function' ? updater(cur.words) : updater,
        };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  const setTextStyle = useCallback(
    (updater) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = {
          ...cur,
          textStyle: typeof updater === 'function' ? updater(cur.textStyle) : updater,
        };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  const setCropMode = useCallback(
    (updater) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = {
          ...cur,
          cropMode: typeof updater === 'function' ? updater(cur.cropMode) : updater,
        };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  // ── Undo/Redo history ──
  const getHistorySnapshot = useCallback(() => {
    const v = allVideos[activeVideoIndex];
    return v
      ? {
          clips: v.clips,
          audio: v.audio,
          words: v.words,
          textOverlays: v.textOverlays,
          lyrics: v.lyrics,
          textStyle: v.textStyle,
          cropMode: v.cropMode,
          duration: v.duration,
        }
      : null;
  }, [allVideos, activeVideoIndex]);

  const restoreHistorySnapshot = useCallback(
    (snapshot) => {
      setAllVideos((prev) => {
        const copy = [...prev];
        const cur = copy[activeVideoIndex];
        if (!cur) return prev;
        copy[activeVideoIndex] = { ...cur, ...snapshot };
        return copy;
      });
    },
    [activeVideoIndex],
  );

  const { canUndo, canRedo, handleUndo, handleRedo, resetHistory } = useEditorHistory({
    getSnapshot: getHistorySnapshot,
    restoreSnapshot: restoreHistorySnapshot,
    deps: [clips, words, textOverlays, textStyle, selectedAudio],
    isEditingText: false,
  });

  // Reset history when switching video variations
  useEffect(() => {
    resetHistory();
  }, [activeVideoIndex, resetHistory]);

  // Playback state (shared across all videos)
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // ── Audio leveling state ──
  const [sourceVideoMuted, setSourceVideoMuted] = useState(() => {
    if (existingVideo?.sourceVideoMuted != null) return existingVideo.sourceVideoMuted;
    if (existingVideo?.audio && !existingVideo.audio.isSourceAudio) return true;
    return false;
  });
  const [sourceVideoVolume, setSourceVideoVolume] = useState(
    existingVideo?.sourceVideoVolume ?? 1.0,
  );
  const [externalAudioVolume, setExternalAudioVolume] = useState(
    existingVideo?.externalAudioVolume ?? 1.0,
  );

  // Auto-select source video audio when clips exist — skip the audio picker screen
  useEffect(() => {
    if (!selectedAudio && category?.videos?.length > 0) {
      const firstVideo = category.videos[0];
      const videoUrl = firstVideo.url || firstVideo.localUrl || firstVideo.src;
      if (videoUrl) {
        setSelectedAudio({
          id: '__source_video__',
          name: 'Source Video Audio',
          url: videoUrl,
          localUrl: firstVideo.localUrl || videoUrl,
          isSourceAudio: true,
        });
      }
    }
  }, []); // Run once on mount — intentionally empty deps

  // Auto-populate timeline with collection/library videos on first open
  useEffect(() => {
    if (
      (!existingVideo || existingVideo._nicheGenerateCount) &&
      clips.length === 0 &&
      category?.videos?.length > 0
    ) {
      const initialClips = category.videos.map((v, i) => ({
        id: `clip_${Date.now()}_${i}`,
        sourceId: v.id,
        url: v.url || v.localUrl || v.src,
        localUrl: v.localUrl || v.url || v.src,
        thumbnail: v.thumbnailUrl || v.thumbnail,
        startTime: i * 2,
        duration: 2,
        locked: false,
        sourceOffset: 0,
      }));
      setClips(initialClips);
    }
  }, []); // Run once on mount

  // ── Left sidebar state (Videos/Audio/Lyrics/Text tabs) ──
  const [activeBank, setActiveBank] = useState('videos');
  const [selectedCollection, setSelectedCollection] = useState(
    category?.videos?.length > 0 ? 'category' : 'all',
  );
  const [sidebarCollections, setSidebarCollections] = useState([]);
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [libraryAudio, setLibraryAudio] = useState([]);
  const [newTextA, setNewTextA] = useState('');
  const [newTextB, setNewTextB] = useState('');

  // ── Audio scope filter (Niche / Project / All) ──
  const [audioScope, setAudioScope] = useState('niche');
  const nicheAudio = useMemo(() => category?.audio || [], [category?.audio]);
  const projectAudio = useMemo(() => {
    if (!category?.projectId) return [];
    const projectRoot = sidebarCollections.find(
      (c) => c.id === category.projectId && c.isProjectRoot,
    );
    if (!projectRoot?.mediaIds?.length) return [];
    const ids = new Set(projectRoot.mediaIds);
    return libraryAudio.filter((m) => ids.has(m.id));
  }, [category?.projectId, sidebarCollections, libraryAudio]);
  const filteredAudio = useMemo(() => {
    if (audioScope === 'niche' && nicheAudio.length > 0) return nicheAudio;
    if (audioScope === 'project' && projectAudio.length > 0) return projectAudio;
    return libraryAudio;
  }, [audioScope, nicheAudio, projectAudio, libraryAudio]);
  useEffect(() => {
    if (nicheAudio.length > 0) setAudioScope('niche');
    else if (projectAudio.length > 0) setAudioScope('project');
    else setAudioScope('all');
  }, [nicheAudio.length, projectAudio.length]);

  // Load library + collections for sidebar (same pattern as SlideshowEditor)
  useEffect(() => {
    if (!artistId) return;
    const cached = getLibrary(artistId);
    setLibraryVideos(cached.filter((i) => i.type === MEDIA_TYPES.VIDEO));
    setLibraryAudio(cached.filter((i) => i.type === MEDIA_TYPES.AUDIO));
    const cols = getCollections(artistId);
    setSidebarCollections(cols.filter((c) => c.type !== 'smart'));
    setLyricsBank(getLyrics(artistId));

    if (!db) return;
    const unsubs = [];
    unsubs.push(
      subscribeToLibrary(db, artistId, (items) => {
        setLibraryVideos(items.filter((i) => i.type === MEDIA_TYPES.VIDEO));
        setLibraryAudio(items.filter((i) => i.type === MEDIA_TYPES.AUDIO));
      }),
    );
    unsubs.push(
      subscribeToCollections(db, artistId, (cols) => {
        setSidebarCollections(cols.filter((c) => c.type !== 'smart'));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [db, artistId]);

  // Computed: visible videos based on selected collection
  const visibleVideos = useMemo(() => {
    if (selectedCollection === 'category') return category?.videos || [];
    if (selectedCollection === 'all') return libraryVideos;
    // Media bank filter (e.g. 'bank_mb_xxxxx')
    if (selectedCollection.startsWith('bank_') && category?.mediaBanks) {
      const bankId = selectedCollection.replace('bank_', '');
      const bank = category.mediaBanks.find((b) => b.id === bankId);
      if (!bank?.mediaIds?.length) return [];
      const bankSet = new Set(bank.mediaIds);
      return libraryVideos.filter((v) => bankSet.has(v.id));
    }
    const col = sidebarCollections.find((c) => c.id === selectedCollection);
    if (!col?.mediaIds?.length) return [];
    return libraryVideos.filter((v) => col.mediaIds.includes(v.id));
  }, [
    selectedCollection,
    libraryVideos,
    sidebarCollections,
    category?.videos,
    category?.mediaBanks,
  ]);

  // Text banks from niche (video text banks) or collections (slideshow text banks)
  const getTextBanks = useCallback(() => {
    let textBank1 = [],
      textBank2 = [];
    // Use niche text banks if available (single source of truth from niche)
    if (category?.nicheTextBanks) {
      const extractTexts = (bank) =>
        (bank || []).map((e) => (typeof e === 'string' ? e : e?.text || '')).filter(Boolean);
      if (category.nicheTextBanks[0]?.length > 0)
        textBank1 = [...extractTexts(category.nicheTextBanks[0])];
      if (category.nicheTextBanks[1]?.length > 0)
        textBank2 = [...extractTexts(category.nicheTextBanks[1])];
    } else {
      // Fallback: merge from collections when not opened from niche
      sidebarCollections.forEach((col) => {
        if (col.textBank1?.length) textBank1 = [...textBank1, ...col.textBank1];
        if (col.textBank2?.length) textBank2 = [...textBank2, ...col.textBank2];
      });
    }
    return { textBank1, textBank2 };
  }, [sidebarCollections, category?.nicheTextBanks]);

  const handleAddToTextBank = useCallback(
    (bankNum, text) => {
      if (!text.trim() || !artistId || sidebarCollections.length === 0) return;
      const targetCol = sidebarCollections[0];
      addToTextBank(artistId, targetCol.id, bankNum, text.trim(), db);
      setSidebarCollections((prev) =>
        prev.map((col) =>
          col.id === targetCol.id
            ? {
                ...col,
                [`textBank${bankNum}`]: [...(col[`textBank${bankNum}`] || []), text.trim()],
              }
            : col,
        ),
      );
    },
    [artistId, sidebarCollections],
  );

  // Text state (lyrics/words derived from allVideos above)

  // Lyrics saving state
  const [showSaveLyricsPrompt, setShowSaveLyricsPrompt] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState(null);
  // textStyle derived from allVideos above

  // Editor state - restore tab from session
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem('stm_editor_tab') || 'caption';
    } catch {
      return 'caption';
    }
  });
  // cropMode derived from allVideos above
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [showLyricsEditor, setShowLyricsEditor] = useState(false);
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [showBeatSelector, setShowBeatSelector] = useState(false);
  const [showMomentumSelector, setShowMomentumSelector] = useState(false);
  const [selectedClips, setSelectedClips] = useState([]);
  const [timelineScale, setTimelineScale] = useState(1);
  const [userMaxDuration, setUserMaxDuration] = useState(existingVideo?.maxDuration || 30);
  const [clipResize, setClipResize] = useState({
    active: false,
    clipIndex: -1,
    edge: null,
    startX: 0,
    startDuration: 0,
  });

  // Cut line drag state (draggable boundaries between clips on waveform tracks)
  const [cutLineDrag, setCutLineDrag] = useState(null); // { active, clipIndex, startX, originalStartTime, originalPrevDuration }

  // AI Transcription state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(null);

  // Video loading state
  const [videoError, setVideoError] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);

  // Auto-save state
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
  const [recoveryData, setRecoveryData] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const autoSaveKey = `stm_autosave_${category?.id || 'default'}`;

  // Close confirmation state
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);

  // Batch generation now uses in-editor allVideos pattern (no separate prompt)

  // Lyric bank picker state
  const [showLyricBankPicker, setShowLyricBankPicker] = useState(false);
  const [loadedBankLyricId, setLoadedBankLyricId] = useState(null); // Track which lyric from bank is loaded
  const [lyricsBank, setLyricsBank] = useState([]);

  // Text overlay editing state
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [selectedWordId, setSelectedWordId] = useState(null);
  const [activeTimelineRow, setActiveTimelineRow] = useState('clips'); // 'clips' | 'words'
  const previewRef = useRef(null);

  // Progress bar dragging state
  const [progressDragging, setProgressDragging] = useState(false);
  const progressBarRef = useRef(null);

  // Inline timeline playhead dragging state
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const wasPlayingBeforePlayheadDrag = useRef(false);

  // Clip drag reordering state
  const [clipDrag, setClipDrag] = useState({ dragging: false, fromIndex: -1, toIndex: -1 });

  // Waveform via shared hook (below)

  // Slip editing state (click-hold + drag to shift sourceOffset within fixed clip boundary)
  const [slipEdit, setSlipEdit] = useState(null); // { active, clipIndex, startX, originalOffset }
  const slipTimerRef = useRef(null);

  // Audio upload + trim state
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);
  const audioFileInputRef = useRef(null);

  // ── Right Sidebar: collapsible sections ──
  const [videoName, setVideoName] = useState(existingVideo?.name || 'Untitled Video');
  const { renderCollapsibleSection } = useCollapsibleSections({
    audio: true,
    clips: true,
    lyricBank: false,
    text: false,
    textStyle: false,
  });

  // Beat detection
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();

  // Toast notifications
  const toast = useToast();

  // Preset prompt modal state
  const [showPresetPrompt, setShowPresetPrompt] = useState(false);
  const [presetPromptValue, setPresetPromptValue] = useState('');

  // Refs
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const videoRefB = useRef(null); // Second video element for double-buffering
  const activeVideoRef = useRef('A'); // Track which video is currently active
  const timelineRef = useRef(null);
  const animationRef = useRef(null);
  const previousTrimHashRef = useRef(null);
  const isPlayingRef = useRef(false); // Ref to avoid stale closure in animation loop
  const videoCache = useRef(new Map()); // Cache for preloaded video blobs
  const preloadQueue = useRef([]); // Queue for videos being preloaded
  const videoLoadingTimer = useRef(null); // Delayed loading indicator (avoids flash for cached videos)
  const lastClipIdRef = useRef(null); // Track last clip to detect changes
  // Track if we're still in initial load phase (loading existing video with words)
  // This prevents clearing words due to minor duration changes when audio loads
  const initialLoadPhaseRef = useRef(existingVideo?.words?.length > 0);

  // Persist active tab to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('stm_editor_tab', activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab]);

  // Trim change detection - invalidate dependent data when trim boundaries change
  // INVARIANT: Words and clips are in LOCAL time, so they become invalid if trim changes
  useEffect(() => {
    const { trimStart, trimEnd } = getTrimBoundaries(selectedAudio, duration);
    const currentHash = getTrimHash(trimStart, trimEnd);

    // Skip on initial mount
    if (previousTrimHashRef.current === null) {
      previousTrimHashRef.current = currentHash;
      return;
    }

    // Check if trim boundaries changed
    if (previousTrimHashRef.current !== currentHash) {
      log('[TrimChange] Trim boundaries changed');
      log(`  Old: ${previousTrimHashRef.current}`);
      log(`  New: ${currentHash}`);

      // If we're in the initial load phase (loading existing video with words),
      // don't clear words - the change is just from audio metadata loading
      if (initialLoadPhaseRef.current) {
        log('[TrimChange] In initial load phase, skipping word clear');
        initialLoadPhaseRef.current = false; // Mark initial load as complete
        previousTrimHashRef.current = currentHash;
        return;
      }

      // Reset playhead to start (prevent out-of-bounds position)
      setCurrentTime(0);
      if (audioRef.current) {
        audioRef.current.currentTime = trimStart;
      }

      // Clear words (they were timed to the old trim range)
      if (words.length > 0) {
        log(`  Clearing ${words.length} words`);
        setWords([]);
        setLyrics('');
      }

      // Note: We don't clear clips automatically because user may have manually curated them
      // But we should warn them if clips exist
      if (clips.length > 0) {
        log.warn('[TrimChange] Clips may be out of sync with new trim range');
      }

      previousTrimHashRef.current = currentHash;
    }
  }, [selectedAudio, duration, words.length, clips.length]);

  // Helper to get the best URL for a clip (prefer cloud URL over expired blob)
  const getClipUrl = useCallback((clip) => {
    if (!clip) return null;
    const localUrl = clip.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    // If it's a blob URL, use cloud URL instead (blob URLs expire)
    return isBlobUrl ? clip.url : localUrl || clip.url;
  }, []);

  // Get current clip based on currentTime
  const currentClip =
    clips.find((clip, i) => {
      const nextClip = clips[i + 1];
      if (!nextClip) return true; // Last clip
      return currentTime >= clip.startTime && currentTime < nextClip.startTime;
    }) || clips[0];

  // Get audio trim boundaries (if trimmed) or full duration
  const audioStartTime = selectedAudio?.startTime || 0;
  const audioEndTime = selectedAudio?.endTime || selectedAudio?.duration || duration;
  const trimmedDuration = audioEndTime - audioStartTime;
  const hasExternalAudio = !!(selectedAudio?.url && !selectedAudio?.isSourceAudio);

  // Filter beats to only those within the trimmed range and normalize to local time
  // INVARIANT: All beat timestamps shown to user and used for clip creation must be in LOCAL time (0 to trimmedDuration)
  const filteredBeats = useMemo(() => {
    if (!beats.length) return [];
    // Use centralized normalization utility
    return normalizeBeatsToTrimRange(beats, audioStartTime, audioEndTime);
  }, [beats, audioStartTime, audioEndTime]);

  // Load audio and analyze beats
  useEffect(() => {
    if (selectedAudio?.url || selectedAudio?.localUrl) {
      // Determine best audio source - skip expired blob URLs
      let audioSource = null;
      const localUrl = selectedAudio.localUrl;
      const isBlobUrl = localUrl && localUrl.startsWith('blob:');

      if (selectedAudio.file instanceof File || selectedAudio.file instanceof Blob) {
        audioSource = selectedAudio.file;
        log('[VideoEditorModal] Using file object for beat detection');
      } else if (localUrl && !isBlobUrl) {
        audioSource = localUrl;
        log('[VideoEditorModal] Using localUrl for beat detection');
      } else if (selectedAudio.url) {
        audioSource = selectedAudio.url;
        log('[VideoEditorModal] Using cloud URL for beat detection');
      }

      if (audioSource) {
        analyzeAudio(audioSource).catch((err) => {
          log.error('Beat analysis failed:', err);
        });
      }

      // Create audio element for playback - use cloud URL if blob expired
      if (audioRef.current) {
        const playbackUrl = isBlobUrl ? selectedAudio.url : localUrl || selectedAudio.url;
        const start = selectedAudio.startTime || 0;
        const endProp = selectedAudio.endTime || null;

        const onLoadedMetadata = () => {
          if (!audioRef.current) return;
          const end = endProp || audioRef.current.duration;
          const effectiveDuration = end - start;
          setDuration(effectiveDuration);

          // Store the start boundary on the audioRef for child components (WordTimeline)
          audioRef.current._startBoundary = start;
          audioRef.current._endBoundary = end;

          // Set initial playback position to trim start
          if (start > 0) {
            audioRef.current.currentTime = start;
          }
          log(
            `Audio loaded: ${start.toFixed(1)}s - ${end.toFixed(1)}s (${effectiveDuration.toFixed(1)}s)`,
          );
        };

        // Set handler BEFORE load so cached audio doesn't miss the event
        audioRef.current.onloadedmetadata = onLoadedMetadata;
        audioRef.current.src = playbackUrl;
        audioRef.current.load();

        // Handle audio ended
        audioRef.current.onended = () => {
          setIsPlaying(false);
          setCurrentTime(0);
        };

        // Fallback: if audio was already cached, onloadedmetadata may not re-fire
        setTimeout(() => {
          if (
            audioRef.current &&
            audioRef.current.readyState >= 1 &&
            audioRef.current.duration > 0
          ) {
            onLoadedMetadata();
          }
        }, 100);
      }
    }
  }, [selectedAudio, analyzeAudio]);

  // Waveform data via shared hook
  const { waveformData, clipWaveforms, waveformSource } = useWaveform({
    selectedAudio,
    clips,
    getClipUrl,
  });

  // Downsample a waveform array to maxBars using peak-picking
  const downsample = useCallback((data, maxBars = 200) => {
    if (!data || data.length === 0) return data || [];
    if (data.length <= maxBars) return data;
    const step = data.length / maxBars;
    const result = [];
    for (let i = 0; i < maxBars; i++) {
      const start = Math.floor(i * step);
      const end = Math.floor((i + 1) * step);
      let max = 0;
      for (let j = start; j < end; j++) max = Math.max(max, data[j] || 0);
      result.push(max);
    }
    return result;
  }, []);

  // Per-clip waveform segments for external audio (sliced from waveformData proportionally)
  const perClipAudioWaveforms = useMemo(() => {
    if (!waveformData.length || !clips.length) return [];
    const totalDur = clips.reduce((s, c) => s + (c.duration || 1), 0);
    let sampleOffset = 0;
    return clips.map((clip) => {
      const sampleCount = Math.max(
        1,
        Math.round(((clip.duration || 1) / totalDur) * waveformData.length),
      );
      const sliced = waveformData.slice(sampleOffset, sampleOffset + sampleCount);
      sampleOffset += sampleCount;
      return downsample(sliced, 30); // max 30 bars per clip segment
    });
  }, [waveformData, clips, downsample]);

  // Per-clip waveform segments for source audio
  const perClipSourceWaveforms = useMemo(() => {
    if (!clips.length || !Object.keys(clipWaveforms).length) return [];
    return clips.map((clip) => {
      const clipId = clip.id || clip.sourceId;
      const data = clipWaveforms[clipId] || [];
      return downsample(data, 30); // max 30 bars per clip segment
    });
  }, [clips, clipWaveforms, downsample]);

  // Total clip duration for timeline-relative positioning (clips may not span full audio)
  const totalClipDuration = useMemo(
    () => clips.reduce((s, c) => s + (c.duration || 1), 0),
    [clips],
  );

  // Stable timeline duration: always the max of clips, audio, and user cap — audio is a guide, not a constraint
  const timelineDuration = useMemo(() => {
    const audioDur = hasExternalAudio ? trimmedDuration : 0;
    return Math.max(userMaxDuration, totalClipDuration, audioDur);
  }, [hasExternalAudio, trimmedDuration, userMaxDuration, totalClipDuration]);

  // Auto-grow userMaxDuration when clips exceed it (adding clips can grow, removing never shrinks)
  useEffect(() => {
    if (totalClipDuration > userMaxDuration) {
      setUserMaxDuration(Math.ceil(totalClipDuration));
    }
  }, [totalClipDuration, userMaxDuration]);

  // ── Text overlay CRUD (matches SoloClipEditor pattern) ──
  const getDefaultTextStyle = useCallback(
    () => ({
      fontSize: textStyle.fontSize,
      fontFamily: textStyle.fontFamily,
      fontWeight: textStyle.fontWeight,
      color: textStyle.color,
      outline: textStyle.outline,
      outlineColor: textStyle.outlineColor,
      textStroke: textStyle.textStroke,
      textAlign: textStyle.textAlign || 'center',
      textCase: textStyle.textCase,
    }),
    [textStyle],
  );

  const addTextOverlay = useCallback(
    (prefillText) => {
      const dur = timelineDuration || 30;
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
      setSelectedWordId(null);
    },
    [getDefaultTextStyle, setTextOverlays, timelineDuration],
  );

  const updateTextOverlay = useCallback(
    (overlayId, updates) => {
      setTextOverlays((prev) => prev.map((o) => (o.id === overlayId ? { ...o, ...updates } : o)));
    },
    [setTextOverlays],
  );

  const removeTextOverlay = useCallback(
    (overlayId) => {
      setTextOverlays((prev) => prev.filter((o) => o.id !== overlayId));
      if (editingTextId === overlayId) {
        setEditingTextId(null);
        setEditingTextValue('');
      }
    },
    [setTextOverlays, editingTextId],
  );

  // Handle play/pause with trim boundary support + wall-clock fallback
  const playStartRef = useRef(null); // wall-clock start time for fallback
  const playOffsetRef = useRef(0); // currentTime when play was pressed

  useEffect(() => {
    const startBoundary = selectedAudio?.startTime || 0;
    const endBoundary =
      selectedAudio?.endTime ||
      (audioRef.current?.duration > 0 ? audioRef.current.duration : 0) ||
      duration;
    const effectiveDuration = endBoundary - startBoundary;
    // Loop at the shorter of audio duration and total clip duration (don't play into empty space)
    const loopEnd =
      totalClipDuration > 0
        ? Math.min(effectiveDuration > 0 ? effectiveDuration : Infinity, totalClipDuration)
        : effectiveDuration;

    // Update ref to avoid stale closure
    isPlayingRef.current = isPlaying;

    if (isPlaying) {
      // Try to play audio if it has a valid source
      const hasAudio =
        audioRef.current?.src &&
        audioRef.current.src !== '' &&
        audioRef.current.src !== window.location.href;
      if (hasAudio) {
        audioRef.current.play().catch(() => {});
      }

      // Record wall-clock start for fallback timing
      playStartRef.current = performance.now();
      playOffsetRef.current = currentTime;

      // Update currentTime during playback
      const updateTime = () => {
        if (!isPlayingRef.current) return;

        let relTime;

        // Primary: use audio element time if audio is actively playing
        if (
          hasAudio &&
          audioRef.current &&
          !audioRef.current.paused &&
          audioRef.current.currentTime > 0
        ) {
          const actualTime = audioRef.current.currentTime;

          if (loopEnd > 0 && actualTime - startBoundary >= loopEnd) {
            audioRef.current.currentTime = startBoundary;
            relTime = 0;
          } else {
            relTime = actualTime - startBoundary;
          }
        } else {
          // Fallback: use wall-clock elapsed time
          const elapsed = (performance.now() - playStartRef.current) / 1000;
          relTime = playOffsetRef.current + elapsed;

          // Loop if we've exceeded duration
          if (loopEnd > 0 && relTime >= loopEnd) {
            relTime = 0;
            playStartRef.current = performance.now();
            playOffsetRef.current = 0;
            if (hasAudio && audioRef.current) {
              audioRef.current.currentTime = startBoundary;
            }
          }
        }

        setCurrentTime(relTime);
        animationRef.current = requestAnimationFrame(updateTime);
      };
      animationRef.current = requestAnimationFrame(updateTime);
    } else {
      if (audioRef.current) audioRef.current.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
    // eslint-disable-next-line
  }, [isPlaying, selectedAudio, duration, totalClipDuration]);

  // Sync video with audio time (use active video element)
  useEffect(() => {
    const activeVideo = activeVideoRef.current === 'A' ? videoRef.current : videoRefB.current;
    if (activeVideo && currentClip?.url) {
      // Calculate position within the clip (respects slip editing sourceOffset)
      const clipStartTime = currentClip.startTime || 0;
      const clipDuration = currentClip.duration || 2;
      const sourceOffset = currentClip.sourceOffset || 0;
      const positionInClip = sourceOffset + ((currentTime - clipStartTime) % clipDuration);

      // Set video time if significantly different
      if (Math.abs(activeVideo.currentTime - positionInClip) > 0.3) {
        activeVideo.currentTime = positionInClip;
      }

      // Only call play/pause when state actually differs (prevents AbortError)
      if (isPlaying && activeVideo.paused) {
        activeVideo.play().catch(() => {});
      } else if (!isPlaying && !activeVideo.paused) {
        activeVideo.pause();
      }
    }
  }, [currentClip, currentTime, isPlaying]);

  // Handlers - MUST be defined before useEffect that references them (TDZ fix)
  const handleSeek = useCallback(
    (time) => {
      // Use trimmed duration for clamping
      const effectiveDuration =
        (selectedAudio?.endTime || selectedAudio?.duration || duration) -
        (selectedAudio?.startTime || 0);
      const clampedTime = Math.max(0, Math.min(time, effectiveDuration));
      setCurrentTime(clampedTime);
      if (audioRef.current) {
        // Add audio start boundary offset for trimmed audio
        const startBoundary = selectedAudio?.startTime || 0;
        audioRef.current.currentTime = clampedTime + startBoundary;
      }
      // Video sync will happen via the useEffect
    },
    [duration, selectedAudio],
  );

  // Progress bar dragging
  useEffect(() => {
    if (!progressDragging) return;

    const handleMouseMove = (e) => {
      if (!progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const percent = clickX / rect.width;
      const newTime = percent * trimmedDuration;
      handleSeek(newTime);
    };

    const handleMouseUp = () => {
      setProgressDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('pointercancel', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
    };
  }, [progressDragging, trimmedDuration, handleSeek]);

  // Inline timeline playhead dragging
  useEffect(() => {
    if (!playheadDragging) return;
    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';
    document.body.style.WebkitUserSelect = 'none';

    const handleMouseMove = (e) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const contentWidth = timelineRef.current.scrollWidth || rect.width;
      const clickX = Math.max(
        0,
        Math.min(contentWidth, e.clientX - rect.left + timelineRef.current.scrollLeft),
      );
      const percent = clickX / contentWidth;
      const newTime = percent * timelineDuration;
      handleSeek(newTime);
    };

    const handleMouseUp = () => {
      setPlayheadDragging(false);
      document.body.style.userSelect = '';
      document.body.style.WebkitUserSelect = '';
      if (wasPlayingBeforePlayheadDrag.current) {
        setIsPlaying(true);
      }
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
  }, [playheadDragging, timelineDuration, handleSeek]);

  // Double-buffered video loading for smooth clip transitions
  // Uses blob cache when available for instant switching
  useEffect(() => {
    const rawUrl = getClipUrl(currentClip);
    if (!rawUrl) return;

    // Detect clip change: either different clip position OR same clip with rerolled source
    const clipKey = `${currentClip?.id}_${currentClip?.sourceId || ''}`;
    const clipChanged = lastClipIdRef.current !== clipKey;
    lastClipIdRef.current = clipKey;

    if (!clipChanged) return;

    // Prefer cached blob URL, fall back to raw URL
    const clipUrl = videoCache.current.get(rawUrl) || rawUrl;

    const activeVideo = activeVideoRef.current === 'A' ? videoRef.current : videoRefB.current;
    const inactiveVideo = activeVideoRef.current === 'A' ? videoRefB.current : videoRef.current;

    if (activeVideo && activeVideo.src !== clipUrl) {
      // Check if inactive video already has this clip loaded
      if (inactiveVideo && inactiveVideo.src === clipUrl && inactiveVideo.readyState >= 3) {
        activeVideoRef.current = activeVideoRef.current === 'A' ? 'B' : 'A';
        if (isPlaying) {
          inactiveVideo.play().catch(() => {});
        }
        activeVideo.pause();
      } else {
        activeVideo.src = clipUrl;
        activeVideo.load();
        if (isPlaying) {
          activeVideo.play().catch(() => {});
        }
      }
    }

    // Preload NEXT clip into inactive video
    const currentIndex = clips.findIndex((c) => c.id === currentClip?.id);
    if (currentIndex >= 0 && currentIndex < clips.length - 1) {
      const nextClip = clips[currentIndex + 1];
      const nextRaw = getClipUrl(nextClip);
      const nextUrl = nextRaw ? videoCache.current.get(nextRaw) || nextRaw : null;
      if (inactiveVideo && nextUrl && inactiveVideo.src !== nextUrl) {
        inactiveVideo.src = nextUrl;
        inactiveVideo.load();
      }
    }
  }, [
    currentClip?.url,
    currentClip?.id,
    currentClip?.sourceId,
    currentClip?.localUrl,
    getClipUrl,
    isPlaying,
    clips,
  ]);

  // Preload clip videos as blob URLs — current clip first, then rest sequentially
  // Prioritizes current clip so it loads fastest, avoids bandwidth contention
  useEffect(() => {
    if (!clips.length) return;
    let cancelled = false;
    const fetchAndCache = async (url) => {
      if (videoCache.current.has(url) || preloadQueue.current.includes(url)) return;
      preloadQueue.current.push(url);
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!cancelled) {
          const blobUrl = URL.createObjectURL(blob);
          videoCache.current.set(url, blobUrl);
          // If this is the current clip, swap the active video to blob URL for faster decode
          const activeVideo = activeVideoRef.current === 'A' ? videoRef.current : videoRefB.current;
          if (activeVideo && activeVideo.src === url) {
            activeVideo.src = blobUrl;
            activeVideo.load();
          }
        }
      } catch {
        // Ignore — raw URL still works as fallback
      } finally {
        preloadQueue.current = preloadQueue.current.filter((u) => u !== url);
      }
    };
    const preloadAll = async () => {
      // Priority: current clip first
      const currentUrl = getClipUrl(currentClip);
      if (currentUrl) await fetchAndCache(currentUrl);
      if (cancelled) return;
      // Then remaining clips sequentially (2 at a time to balance speed vs bandwidth)
      const remaining = [];
      clips.forEach((clip) => {
        const url = getClipUrl(clip);
        if (url && url !== currentUrl && !videoCache.current.has(url)) remaining.push(url);
      });
      for (let i = 0; i < remaining.length && !cancelled; i += 2) {
        const batch = remaining.slice(i, i + 2);
        await Promise.all(batch.map(fetchAndCache));
      }
    };
    preloadAll();
    return () => {
      cancelled = true;
    };
  }, [clips, currentClip, getClipUrl]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Dynamically mute/volume video when external audio is selected
  useEffect(() => {
    const hasLibraryAudio = selectedAudio && selectedAudio.url && !selectedAudio.isSourceAudio;
    const isSourceAudio = !!selectedAudio?.isSourceAudio;
    // Mute video when: global mute, OR source audio mode (audioRef provides sound),
    // OR external audio is present and source toggle is muted
    const videoMuted = isMuted || isSourceAudio || (!!hasLibraryAudio && sourceVideoMuted);
    if (videoRef.current) {
      videoRef.current.muted = videoMuted;
      videoRef.current.volume = sourceVideoVolume;
    }
    if (videoRefB.current) {
      videoRefB.current.muted = videoMuted;
      videoRefB.current.volume = sourceVideoVolume;
    }
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
      audioRef.current.volume = isSourceAudio ? sourceVideoVolume : externalAudioVolume;
    }
  }, [isMuted, selectedAudio, sourceVideoMuted, sourceVideoVolume, externalAudioVolume]);

  const handlePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // Track whether the editor has unsaved work (for beforeunload guard)
  const hasUnsavedWork =
    clips.length > 0 || words.length > 0 || textOverlays.length > 0 || !!selectedAudio;
  useUnsavedChanges(hasUnsavedWork);

  // Handle close with confirmation if there's unsaved work
  const handleCloseRequest = useCallback(() => {
    if (hasUnsavedWork) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [hasUnsavedWork, onClose]);

  const handleConfirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    onClose();
  }, [onClose]);

  // Clear auto-save on successful save - MUST be defined before handleSave
  const clearAutoSave = useCallback(() => {
    try {
      localStorage.removeItem(autoSaveKey);
    } catch (e) {
      log.error('Failed to clear auto-save:', e);
    }
  }, [autoSaveKey]);

  // handleSave - MUST be defined before keyboard shortcuts useEffect
  const handleSave = useCallback(
    (skipLyricsPrompt = false) => {
      const videoData = {
        id: existingVideo?.id,
        audio: selectedAudio,
        clips,
        words,
        textOverlays,
        lyrics,
        textStyle,
        cropMode,
        duration,
        bpm,
        thumbnail: clips[0]?.thumbnail || null,
        textOverlay: textOverlays[0]?.text || words[0]?.text || lyrics.split('\n')[0] || '',
        maxDuration: userMaxDuration,
        // Audio mixing state
        sourceVideoMuted,
        sourceVideoVolume,
        externalAudioVolume,
        // Preserve niche metadata
        _nicheGenerateCount: existingVideo?._nicheGenerateCount || null,
      };

      // If we have lyrics and a save handler, prompt to save to song
      if (!skipLyricsPrompt && words.length > 0 && selectedAudio?.id && onSaveLyrics) {
        setPendingSaveData(videoData);
        setShowSaveLyricsPrompt(true);
        return;
      }

      // Save directly
      onSave(videoData);
      clearAutoSave();
    },
    [
      existingVideo,
      selectedAudio,
      clips,
      words,
      textOverlays,
      lyrics,
      textStyle,
      cropMode,
      duration,
      bpm,
      userMaxDuration,
      sourceVideoMuted,
      sourceVideoVolume,
      externalAudioVolume,
      onSave,
      onSaveLyrics,
      clearAutoSave,
    ],
  );

  // Handle lyrics save prompt response
  const handleLyricsPromptResponse = useCallback(
    (saveLyrics) => {
      if (saveLyrics && selectedAudio?.id && onSaveLyrics) {
        // Save lyrics to the song
        onSaveLyrics(selectedAudio.id, {
          name: selectedAudio.name || 'Untitled',
          words: words,
        });
        toast.success('Lyrics saved to song for future videos!');
      }

      // Now save the video
      if (pendingSaveData) {
        onSave(pendingSaveData);
        clearAutoSave();
      }

      setShowSaveLyricsPrompt(false);
      setPendingSaveData(null);
    },
    [selectedAudio, words, onSaveLyrics, pendingSaveData, onSave, clearAutoSave, toast],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // ESC to close modal (with confirmation if there's work)
      if (e.code === 'Escape') {
        e.preventDefault();
        handleCloseRequest();
        return;
      }
      // Space bar to play/pause
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handlePlayPause();
      }
      // Left/Right arrows to seek
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleSeek(Math.max(0, currentTime - 1));
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleSeek(Math.min(duration, currentTime + 1));
      }
      // M to mute/unmute
      if (e.code === 'KeyM' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleToggleMute();
      }
      // Cmd+S / Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handlePlayPause,
    handleSeek,
    handleToggleMute,
    handleSave,
    handleCloseRequest,
    currentTime,
    duration,
  ]);

  // Prevent background scroll when modal is open (P0-UI-04)
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Check for auto-saved draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(autoSaveKey);
      if (saved && !existingVideo) {
        const data = JSON.parse(saved);
        // Only show recovery if it's recent (less than 24 hours old)
        const savedTime = data.savedAt ? new Date(data.savedAt).getTime() : 0;
        const now = Date.now();
        if (now - savedTime < 24 * 60 * 60 * 1000) {
          setRecoveryData(data);
          setShowRecoveryPrompt(true);
        } else {
          // Clear old drafts
          localStorage.removeItem(autoSaveKey);
        }
      }
    } catch (e) {
      log.error('Failed to check for auto-saved draft:', e);
    }
  }, [autoSaveKey, existingVideo]);

  // Auto-save every 30 seconds (saves full allVideos state)
  useEffect(() => {
    let failedOnce = false;

    const autoSave = () => {
      // Don't auto-save if there's nothing to save
      const template = allVideos[0];
      if (
        !template?.audio &&
        !template?.clips?.length &&
        !template?.words?.length &&
        !template?.textOverlays?.length
      )
        return;

      try {
        const draftData = {
          allVideos,
          activeVideoIndex,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(autoSaveKey, JSON.stringify(draftData));
        setLastSaved(new Date());
        failedOnce = false;
      } catch (e) {
        log.error('Auto-save failed:', e);
        if (!failedOnce) {
          toast.error('Auto-save failed. Save your work manually.');
          failedOnce = true;
        }
      }
    };

    const interval = setInterval(autoSave, 30000);
    return () => clearInterval(interval);
  }, [autoSaveKey, allVideos, activeVideoIndex, toast]);

  // Restore from auto-saved draft (handles both new allVideos format and legacy flat format)
  const handleRestoreDraft = useCallback(() => {
    if (recoveryData) {
      if (recoveryData.allVideos) {
        // New multi-video format
        setAllVideos(recoveryData.allVideos);
        if (recoveryData.activeVideoIndex != null) {
          setActiveVideoIndex(recoveryData.activeVideoIndex);
        }
      } else {
        // Legacy flat format — wrap into template
        setAllVideos([
          {
            id: 'template',
            name: 'Template',
            clips: recoveryData.clips || [],
            audio: recoveryData.audio || null,
            words: recoveryData.words || [],
            lyrics: recoveryData.lyrics || '',
            textStyle: recoveryData.textStyle || { ...DEFAULT_TEXT_STYLE },
            cropMode: recoveryData.cropMode || '9:16',
            duration: recoveryData.duration || 30,
            isTemplate: true,
          },
        ]);
        setActiveVideoIndex(0);
      }
    }
    setShowRecoveryPrompt(false);
    setRecoveryData(null);
  }, [recoveryData]);

  // Discard auto-saved draft
  const handleDiscardDraft = useCallback(() => {
    clearAutoSave();
    setShowRecoveryPrompt(false);
    setRecoveryData(null);
  }, [clearAutoSave]);

  // ── Multi-video switching ──
  const switchToVideo = useCallback(
    (index) => {
      if (index === activeVideoIndex || index < 0 || index >= allVideos.length) return;
      // Stop playback, reset UI state
      setIsPlaying(false);
      setCurrentTime(0);
      setSelectedClips([]);
      setSelectedWordId(null);
      setActiveTimelineRow('clips');
      setShowWordTimeline(false);
      setShowBeatSelector(false);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setActiveVideoIndex(index);
    },
    [activeVideoIndex, allVideos.length],
  );

  const handleDeleteVideo = useCallback(
    (index) => {
      if (index === 0) return; // Can't delete template
      setAllVideos((prev) => {
        const next = prev.filter((_, i) => i !== index);
        return next;
      });
      // Adjust activeVideoIndex if needed
      setActiveVideoIndex((prev) => {
        if (prev === index) return 0; // Go to template
        if (prev > index) return prev - 1; // Shift left
        return prev;
      });
      toast.success('Variation deleted');
    },
    [toast],
  );

  // ── Generate variations from template ──
  const executeGeneration = useCallback(() => {
    const template = allVideos[0];
    if (!template?.clips?.length) {
      toast.error('Add clips to template before generating');
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

    // Get extra clips for substitution — prefer niche videos (category), fall back to full library
    const sourcePool = category?.videos?.length > 0 ? category.videos : libraryVideos;
    const extraClips = sourcePool
      .filter((v) => !template.clips.some((c) => c.sourceId === v.id))
      .map((v, i) => ({
        id: `clip_gen_${Date.now()}_${i}`,
        sourceId: v.id,
        url: v.url || v.localUrl || v.src,
        localUrl: v.localUrl || v.url || v.src,
        thumbnail: v.thumbnailUrl || v.thumbnail,
        startTime: 0,
        duration: 2,
        locked: false,
      }));

    // Get text banks for cycling
    const { textBank1, textBank2 } = getTextBanks();

    // Build the timing skeleton from the template — durations and startTimes are sacred
    const timingSkeleton = template.clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
    }));

    // Pool of all source videos to draw from (template clips + extras)
    const allSourcePool = [
      ...template.clips.map((c) => ({
        sourceId: c.sourceId,
        url: c.url,
        localUrl: c.localUrl,
        thumbnail: c.thumbnail,
      })),
      ...extraClips.map((c) => ({
        sourceId: c.sourceId,
        url: c.url,
        localUrl: c.localUrl,
        thumbnail: c.thumbnail,
      })),
    ];

    const newVideos = [];
    for (let g = 0; g < generateCount; g++) {
      // Shuffle the source pool, then slot into the fixed timing skeleton
      const shuffledSources = shuffle(allSourcePool);

      let genClips = timingSkeleton.map((slot, idx) => {
        const source = shuffledSources[idx % shuffledSources.length];
        return {
          id: `clip_${Date.now()}_${g}_${Math.random().toString(36).slice(2)}`,
          sourceId: source.sourceId,
          url: source.url,
          localUrl: source.localUrl,
          thumbnail: source.thumbnail,
          startTime: slot.startTime,
          duration: slot.duration,
          locked: false,
          sourceOffset: 0,
        };
      });

      // Cycle text from banks if available (unless keepTemplateText is active)
      let genWords = [...template.words];
      if (keepTemplateText === 'none' && textBank1.length > 0 && genWords.length > 0) {
        const bankText = textBank1[g % textBank1.length];
        if (bankText) {
          // Replace first word with cycled text
          genWords = genWords.map((w, i) => (i === 0 ? { ...w, text: bankText } : w));
        }
      }

      // Cycle textOverlays from banks
      let genTextOverlays = [...(template.textOverlays || [])];
      if (keepTemplateText === 'none' && textBank1.length > 0 && genTextOverlays.length > 0) {
        const bankText = textBank1[g % textBank1.length];
        if (bankText) {
          genTextOverlays = genTextOverlays.map((o, i) => (i === 0 ? { ...o, text: bankText } : o));
        }
      }

      newVideos.push({
        id: `gen_${Date.now()}_${g}`,
        name: `#${allVideos.length + g}`,
        clips: genClips,
        audio: template.audio,
        words: genWords,
        textOverlays: genTextOverlays,
        lyrics: template.lyrics,
        textStyle: { ...template.textStyle },
        cropMode: template.cropMode,
        duration: template.duration,
        isTemplate: false,
      });
    }

    setAllVideos((prev) => [...prev, ...newVideos]);
    setActiveVideoIndex(allVideos.length);
    setIsGenerating(false);
    toast.success(`Generated ${generateCount} variations`);
  }, [
    allVideos,
    generateCount,
    libraryVideos,
    category?.videos,
    getTextBanks,
    keepTemplateText,
    toast,
  ]);

  // Auto-generate on mount when coming from niche preview (Create N flow)
  const autoGenTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoGenTriggeredRef.current || !nicheGenCount) return;
    const template = allVideos[0];
    if (!template?.clips?.length) return;
    autoGenTriggeredRef.current = true;
    executeGeneration();
  }, [nicheGenCount, allVideos, executeGeneration]);

  // ── Save all videos ──
  const handleSaveAllAndClose = useCallback(async () => {
    if (isSavingAll) return;
    setIsSavingAll(true);
    let savedCount = 0;
    try {
      for (const video of allVideos) {
        const videoData = {
          id: video.isTemplate ? existingVideo?.id : undefined,
          audio: video.audio,
          clips: video.clips,
          words: video.words,
          textOverlays: video.textOverlays || [],
          lyrics: video.lyrics,
          textStyle: video.textStyle,
          cropMode: video.cropMode,
          duration: video.duration,
          bpm,
          thumbnail: video.clips[0]?.thumbnail || null,
          textOverlay:
            video.textOverlays?.[0]?.text ||
            video.words[0]?.text ||
            video.lyrics.split('\n')[0] ||
            '',
        };
        try {
          await onSave(videoData);
        } catch (err) {
          log.error(`[VideoEditorModal] Failed to save video ${savedCount}:`, err);
          toast.error(`Failed to save video. Please try again.`);
          setIsSavingAll(false);
          return;
        }
        savedCount++;
      }
      clearAutoSave();
      toast.success(`Saved ${savedCount} video${savedCount !== 1 ? 's' : ''}`);
      onClose?.();
    } finally {
      setIsSavingAll(false);
    }
  }, [allVideos, existingVideo, bpm, onSave, clearAutoSave, toast, onClose, isSavingAll]);

  // Get current visible text overlays — multiple overlays can be visible simultaneously
  const visibleTexts = textOverlays.filter(
    (o) => currentTime >= (o.startTime ?? 0) && currentTime <= (o.endTime ?? timelineDuration),
  );

  // Current word from lyrics (for preview overlay)
  const currentWord =
    words.length > 0
      ? words.find((w) => {
          const wStart = w.startTime ?? w.start ?? 0;
          const wEnd = wStart + (w.duration ?? ((w.end ?? 0) - (w.start ?? 0) || 0.5));
          return currentTime >= wStart && currentTime < wEnd;
        })
      : null;

  // Handlers
  const handleAudioSelect = (audio) => {
    setSelectedAudio(audio);
    // Auto-mute source video when external audio is added; restore when removed
    const hasExternal = audio && audio.url && !audio.isSourceAudio;
    setSourceVideoMuted(!!hasExternal);

    // Auto-load saved lyrics from this audio if available and no lyrics exist yet
    if (audio?.savedLyrics?.length > 0 && words.length === 0) {
      const latestLyrics = audio.savedLyrics[audio.savedLyrics.length - 1];
      if (latestLyrics.words?.length > 0) {
        log('[Lyrics] Auto-loading saved lyrics from audio:', latestLyrics.name);
        setWords(latestLyrics.words);
        setLyrics(latestLyrics.words.map((w) => w.text).join(' '));
        toast.success(`Loaded saved lyrics: "${latestLyrics.name}"`);
      }
    }
  };

  // Audio upload handler
  const handleAudioUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    const uploadedAudio = {
      id: `upload_${Date.now()}`,
      name: file.name,
      file,
      url: localUrl,
      localUrl,
    };
    setAudioToTrim(uploadedAudio);
    setShowAudioTrimmer(true);
    // Reset file input so same file can be re-uploaded
    if (audioFileInputRef.current) audioFileInputRef.current.value = '';
  };

  // Audio trim save handler
  const handleAudioTrimSave = ({
    startTime,
    endTime,
    duration: trimDuration,
    trimmedFile,
    trimmedName,
  }) => {
    if (!audioToTrim) return;
    if (trimmedFile) {
      const localUrl = URL.createObjectURL(trimmedFile);
      handleAudioSelect({
        ...audioToTrim,
        id: `audio_trim_${Date.now()}`,
        name: trimmedName || trimmedFile.name,
        file: trimmedFile,
        url: localUrl,
        localUrl,
        startTime: 0,
        endTime: trimDuration,
        trimmedDuration: trimDuration,
        duration: trimDuration,
      });
    } else {
      handleAudioSelect({
        ...audioToTrim,
        startTime,
        endTime,
        trimmedDuration: endTime - startTime,
        isTrimmed:
          startTime > 0 || (audioToTrim.duration && Math.abs(endTime - audioToTrim.duration) > 0.1),
      });
    }
    setShowAudioTrimmer(false);
    setAudioToTrim(null);
  };

  // Show the beat selector modal
  const handleCutByBeat = useCallback(() => {
    if (!filteredBeats.length) {
      toast.error('No beats detected. Try a different audio track or check the trim range.');
      return;
    }
    setShowBeatSelector(true);
  }, [filteredBeats, toast]);

  // Handle when user selects beats from the BeatSelector modal
  // Note: selectedBeatTimes are now in LOCAL time (0 to trimmedDuration)
  const handleBeatSelectionApply = useCallback(
    (selectedBeatTimes) => {
      if (!selectedBeatTimes.length) {
        setShowBeatSelector(false);
        return;
      }

      // Calculate trimmed duration for the end boundary
      const effectiveDuration =
        (selectedAudio?.endTime || selectedAudio?.duration || duration) -
        (selectedAudio?.startTime || 0);
      // Use category videos as source pool, fall back to existing clips' sources
      const availableClips =
        category?.videos?.length > 0
          ? category.videos
          : clips.map((c) => ({
              id: c.sourceId || c.id,
              url: c.url,
              localUrl: c.localUrl,
              thumbnail: c.thumbnail,
            }));
      if (!availableClips.length) {
        setShowBeatSelector(false);
        return;
      }
      const newClips = [];

      // Create clips for each selected beat (cut points) - all times are LOCAL
      for (let i = 0; i < selectedBeatTimes.length; i++) {
        const startTime = selectedBeatTimes[i];
        const endTime = selectedBeatTimes[i + 1] || effectiveDuration; // Use next beat or end of trimmed audio
        const clipDuration = endTime - startTime;

        const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];

        newClips.push({
          id: `clip_${Date.now()}_${i}`,
          sourceId: randomClip.id,
          url: randomClip.url,
          localUrl: randomClip.localUrl, // Include localUrl for CORS fallback
          thumbnail: randomClip.thumbnail,
          startTime: startTime,
          duration: clipDuration,
          locked: false,
          sourceOffset: 0,
        });
      }

      setClips(newClips);
      setSelectedClips([]);
      setShowBeatSelector(false);
    },
    [category?.videos, clips, duration, selectedAudio],
  );

  const handleCutByWord = useCallback(() => {
    if (!words.length) {
      toast.error('No words to cut by. Add lyrics first.');
      return;
    }
    if (!category?.videos?.length) {
      toast.error('No clips in bank. Upload videos first.');
      return;
    }

    const availableClips = category.videos;
    const newClips = words.map((word, i) => {
      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
      return {
        id: `clip_${Date.now()}_${i}`,
        sourceId: randomClip.id,
        url: randomClip.url,
        localUrl: randomClip.localUrl, // Include localUrl for CORS fallback
        thumbnail: randomClip.thumbnail,
        startTime: word.startTime,
        duration: word.duration || 0.5,
        locked: false,
        sourceOffset: 0,
      };
    });

    setClips(newClips);
    toast.success(`Created ${newClips.length} clips from words`);
  }, [words, category?.videos, toast]);

  const handleReroll = useCallback(() => {
    // Context-aware: text selected → reroll text, else reroll clips
    if (editingTextId) {
      const { textBank1, textBank2 } = getTextBanks();
      const allBankTexts = [...textBank1, ...textBank2].filter(Boolean);
      if (allBankTexts.length === 0) {
        toast.error('No text banks to reroll from.');
        return;
      }
      const overlay = textOverlays.find((o) => o.id === editingTextId);
      const others = allBankTexts.filter((t) => t !== overlay?.text);
      const pool = others.length > 0 ? others : allBankTexts;
      const randomText = pool[Math.floor(Math.random() * pool.length)];
      setTextOverlays((prev) =>
        prev.map((o) => (o.id === editingTextId ? { ...o, text: randomText } : o)),
      );
      toast.success('Rerolled text');
      return;
    }

    // Pull from visible collection (respects dropdown selection), fall back to category
    const availableClips = visibleVideos.length > 0 ? visibleVideos : category?.videos || [];
    if (!availableClips.length) {
      toast.error('No clips in bank. Upload videos first.');
      return;
    }
    if (!clips.length) {
      toast.error('No clips to reroll. Cut by beat or word first.');
      return;
    }

    // Get indices to reroll: selected clips, or clip at playhead, or all clips
    let indicesToReroll;
    if (selectedClips.length > 0) {
      indicesToReroll = selectedClips;
    } else {
      // Find clip at current playhead position
      let cumTime = 0;
      let playheadClip = -1;
      for (let i = 0; i < clips.length; i++) {
        const clipEnd = cumTime + (clips[i].duration || 0.5);
        if (currentTime >= cumTime && currentTime < clipEnd) {
          playheadClip = i;
          break;
        }
        cumTime = clipEnd;
      }
      indicesToReroll = playheadClip >= 0 ? [playheadClip] : clips.map((_, i) => i);
    }

    const rerollCount = indicesToReroll.filter((i) => !clips[i]?.locked).length;
    setClips((prev) =>
      prev.map((clip, i) => {
        if (!indicesToReroll.includes(i) || clip.locked) return clip;
        const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
        return {
          ...clip,
          // Preserve timeline position and trim
          id: clip.id,
          startTime: clip.startTime,
          duration: clip.duration,
          // Swap source media only
          sourceId: randomClip.id,
          url: randomClip.url,
          localUrl: randomClip.localUrl,
          thumbnail: randomClip.thumbnailUrl || randomClip.thumbnail,
          sourceOffset: 0,
        };
      }),
    );
    toast.success(`Rerolled ${rerollCount} clip${rerollCount !== 1 ? 's' : ''}`);
  }, [
    editingTextId,
    textOverlays,
    getTextBanks,
    setTextOverlays,
    clips,
    selectedClips,
    visibleVideos,
    category?.videos,
    currentTime,
    toast,
  ]);

  const handleRearrange = useCallback(() => {
    if (!clips.length) {
      toast.error('No clips to rearrange.');
      return;
    }
    const unlockedCount = clips.filter((c) => !c.locked).length;
    if (unlockedCount < 2) {
      toast.info('Need at least 2 unlocked clips to rearrange.');
      return;
    }

    setClips((prev) => {
      const unlocked = prev.filter((c) => !c.locked);
      const shuffled = [...unlocked].sort(() => Math.random() - 0.5);

      let j = 0;
      return prev.map((clip) => {
        if (clip.locked) return clip;
        return { ...shuffled[j++], startTime: clip.startTime, duration: clip.duration };
      });
    });
    toast.success(`Shuffled ${unlockedCount} clips`);
  }, [clips, toast]);

  // Get the clip at the current playhead position
  const getClipAtPlayhead = useCallback(() => {
    let cumTime = 0;
    for (let i = 0; i < clips.length; i++) {
      const clipEnd = cumTime + (clips[i].duration || 0.5);
      if (currentTime >= cumTime && currentTime < clipEnd) {
        return i;
      }
      cumTime = clipEnd;
    }
    return -1;
  }, [clips, currentTime]);

  // Get effective indices for operations (selected or at playhead)
  const getEffectiveClipIndices = useCallback(() => {
    if (selectedClips.length > 0) return selectedClips;
    const playheadClip = getClipAtPlayhead();
    return playheadClip >= 0 ? [playheadClip] : [];
  }, [selectedClips, getClipAtPlayhead]);

  // Combine selected clips into one (merges consecutive clips)
  const handleCombine = useCallback(() => {
    const indices = getEffectiveClipIndices();
    if (indices.length < 2) {
      // Need at least 2 clips to combine - try combining with next clip
      if (indices.length === 1 && indices[0] < clips.length - 1) {
        const idx = indices[0];
        setClips((prev) => {
          const newClips = [...prev];
          const clip1 = newClips[idx];
          const clip2 = newClips[idx + 1];
          // Keep the first clip's source, sum the durations
          const combined = {
            ...clip1,
            duration: (clip1.duration || 0.5) + (clip2.duration || 0.5),
          };
          newClips.splice(idx, 2, combined);
          return newClips;
        });
        setSelectedClips([]);
        toast.success('Combined clip with next');
      } else {
        toast.info('Select clips or position playhead to combine');
      }
      return;
    }

    // Sort indices and combine consecutive clips
    const sorted = [...indices].sort((a, b) => a - b);
    let combineCount = 0;
    setClips((prev) => {
      const newClips = [...prev];
      // Start from the end to preserve indices
      for (let i = sorted.length - 1; i > 0; i--) {
        const idx = sorted[i];
        const prevIdx = sorted[i - 1];
        // Only combine if consecutive
        if (idx === prevIdx + 1) {
          const combined = {
            ...newClips[prevIdx],
            duration: (newClips[prevIdx].duration || 0.5) + (newClips[idx].duration || 0.5),
          };
          newClips.splice(prevIdx, 2, combined);
          combineCount++;
        }
      }
      return newClips;
    });
    setSelectedClips([]);
    if (combineCount > 0) {
      toast.success(`Combined ${combineCount + 1} clips`);
    } else {
      toast.info('Select consecutive clips to combine');
    }
  }, [clips, getEffectiveClipIndices, toast]);

  // Break/split a clip at the playhead position
  const handleBreak = useCallback(() => {
    const clipIndex = getClipAtPlayhead();
    if (clipIndex < 0) {
      toast.info('Position playhead over a clip to split');
      return;
    }

    // Calculate where in the clip the playhead is
    let cumTime = 0;
    for (let i = 0; i < clipIndex; i++) {
      cumTime += clips[i].duration || 0.5;
    }
    const clipStartTime = cumTime;
    const clip = clips[clipIndex];
    const clipDuration = clip.duration || 0.5;
    const splitPoint = currentTime - clipStartTime;

    // Don't split if too close to edges
    if (splitPoint < 0.1 || splitPoint > clipDuration - 0.1) {
      toast.info('Move playhead away from clip edge to split');
      return;
    }

    // Create two clips from one
    const firstHalf = {
      ...clip,
      id: `${clip.id}_a`,
      duration: splitPoint,
      sourceOffset: clip.sourceOffset || 0,
    };
    const secondHalf = {
      ...clip,
      id: `${clip.id}_b`,
      duration: clipDuration - splitPoint,
      startTime: clip.startTime + splitPoint,
      sourceOffset: (clip.sourceOffset || 0) + splitPoint,
    };

    setClips((prev) => {
      const newClips = [...prev];
      newClips.splice(clipIndex, 1, firstHalf, secondHalf);
      return newClips;
    });
    setSelectedClips([]);
    toast.success('Split clip at playhead');
  }, [clips, currentTime, getClipAtPlayhead, toast]);

  // Remove/delete clips
  const handleRemoveClips = useCallback(() => {
    const indices = getEffectiveClipIndices();
    if (indices.length === 0) {
      toast.info('Select clip(s) to remove');
      return;
    }

    // Prevent deleting if only 1 clip remains
    if (clips.length - indices.length < 1) {
      toast.error('Cannot delete all clips. At least 1 clip is required.');
      return;
    }

    setClips((prev) => {
      // Remove clips at specified indices (in reverse order to maintain indices)
      const newClips = prev.filter((_, index) => !indices.includes(index));

      // Recalculate cumulative start times
      let cumTime = 0;
      return newClips.map((clip) => {
        const updated = { ...clip, startTime: cumTime };
        cumTime += clip.duration || 0.5;
        return updated;
      });
    });

    setSelectedClips([]);
    toast.success(`Removed ${indices.length} clip${indices.length !== 1 ? 's' : ''}`);
  }, [clips, getEffectiveClipIndices, toast]);

  // Update clip duration
  const handleUpdateClipDuration = useCallback(
    (clipIndex, newDuration) => {
      if (clipIndex < 0 || clipIndex >= clips.length) {
        return;
      }

      const minDuration = 0.1;
      const maxDuration = 30;
      const duration = Math.max(minDuration, Math.min(maxDuration, newDuration));

      setClips((prev) => {
        const newClips = [...prev];
        newClips[clipIndex] = {
          ...newClips[clipIndex],
          duration: duration,
        };

        // Recalculate cumulative start times for clips after this one
        let cumTime = 0;
        return newClips.map((clip) => {
          const updated = { ...clip, startTime: cumTime };
          cumTime += clip.duration || 0.5;
          return updated;
        });
      });
    },
    [clips],
  );

  // Clip drag reorder handlers
  const handleClipDragStart = useCallback((index) => {
    setClipDrag({ dragging: true, fromIndex: index, toIndex: index });
  }, []);

  const handleClipDragOver = useCallback(
    (index) => {
      if (clipDrag.dragging && index !== clipDrag.toIndex) {
        setClipDrag((prev) => ({ ...prev, toIndex: index }));
      }
    },
    [clipDrag.dragging, clipDrag.toIndex],
  );

  const handleClipDragEnd = useCallback(() => {
    if (
      clipDrag.dragging &&
      clipDrag.fromIndex !== clipDrag.toIndex &&
      clipDrag.fromIndex >= 0 &&
      clipDrag.toIndex >= 0
    ) {
      setClips((prev) => {
        const newClips = [...prev];
        const [movedClip] = newClips.splice(clipDrag.fromIndex, 1);
        newClips.splice(clipDrag.toIndex, 0, movedClip);
        // Recalculate start times
        let cumTime = 0;
        return newClips.map((clip) => {
          const updated = { ...clip, startTime: cumTime };
          cumTime += clip.duration || 0.5;
          return updated;
        });
      });
    }
    setClipDrag({ dragging: false, fromIndex: -1, toIndex: -1 });
  }, [clipDrag]);

  // Clip resize handlers (drag edges to change duration)
  const handleResizeStart = useCallback(
    (e, clipIndex, edge) => {
      e.stopPropagation();
      e.preventDefault();
      const clip = clips[clipIndex];
      if (!clip || clip.locked) return;
      setClipResize({
        active: true,
        clipIndex,
        edge,
        startX: e.clientX,
        startDuration: clip.duration || 1,
      });
    },
    [clips],
  );

  useEffect(() => {
    if (!clipResize.active) return;

    const handleResizeMove = (e) => {
      const deltaX = e.clientX - clipResize.startX;
      // pixelsPerSecond must match the rendering formula: duration * 40 * timelineScale
      const pixelsPerSecond = 40 * timelineScale;
      const deltaSec = deltaX / pixelsPerSecond;
      let newDuration;
      if (clipResize.edge === 'right') {
        newDuration = clipResize.startDuration + deltaSec;
      } else {
        newDuration = clipResize.startDuration - deltaSec;
      }
      newDuration = Math.max(0.1, Math.min(300, newDuration));
      handleUpdateClipDuration(clipResize.clipIndex, newDuration);
    };

    const handleResizeEnd = () => {
      setClipResize({ active: false, clipIndex: -1, edge: null, startX: 0, startDuration: 0 });
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
    document.addEventListener('pointercancel', handleResizeEnd);
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.removeEventListener('pointercancel', handleResizeEnd);
    };
  }, [clipResize, handleUpdateClipDuration, timelineScale]);

  // Cut line drag handler — dragging boundary lines between clips on waveform tracks
  // Stores both originalPrevDuration and originalCurrDuration at drag start so the handler
  // never needs to read current clips (avoids stale closure / re-register feedback loops).
  // Cut line drag — ripple edit: left clip grows/shrinks, right clip keeps duration but shifts start time
  useEffect(() => {
    if (!cutLineDrag?.active) return;
    const pxPerSec = 40 * timelineScale;
    const { clipIndex, startX, originalPrevDuration } = cutLineDrag;

    const handleCutLineMove = (e) => {
      const deltaX = e.clientX - startX;
      const deltaSec = deltaX / pxPerSec;
      const newPrevDur = Math.max(0.1, Math.min(300, originalPrevDuration + deltaSec));

      setClips((prev) => {
        const updated = [...prev];
        const prevIdx = clipIndex - 1;
        if (prevIdx < 0 || !updated[prevIdx] || !updated[clipIndex]) return prev;
        updated[prevIdx] = { ...updated[prevIdx], duration: newPrevDur };
        // Shift this clip's start time; keep its own duration unchanged
        const newStart = (updated[prevIdx].startTime || 0) + newPrevDur;
        updated[clipIndex] = { ...updated[clipIndex], startTime: newStart };
        // Ripple: shift all downstream clips
        for (let i = clipIndex + 1; i < updated.length; i++) {
          const prevEnd = (updated[i - 1].startTime || 0) + (updated[i - 1].duration || 1);
          updated[i] = { ...updated[i], startTime: prevEnd };
        }
        return updated;
      });
    };

    const handleCutLineUp = () => {
      setCutLineDrag(null);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', handleCutLineMove);
    document.addEventListener('mouseup', handleCutLineUp);
    document.addEventListener('pointercancel', handleCutLineUp);
    return () => {
      document.removeEventListener('mousemove', handleCutLineMove);
      document.removeEventListener('mouseup', handleCutLineUp);
      document.removeEventListener('pointercancel', handleCutLineUp);
      document.body.style.cursor = '';
    };
  }, [cutLineDrag, timelineScale, setClips]);

  // Slip edit handler — click-hold + drag to shift sourceOffset within fixed clip boundary
  useEffect(() => {
    if (!slipEdit?.active) return;

    const handleSlipMove = (e) => {
      const deltaX = e.clientX - slipEdit.startX;
      const pxPerSec = 40 * timelineScale;
      const deltaSec = deltaX / pxPerSec;
      const newOffset = Math.max(0, slipEdit.originalOffset - deltaSec); // drag right = earlier source, drag left = later
      setClips((prev) => {
        const updated = [...prev];
        if (!updated[slipEdit.clipIndex]) return prev;
        updated[slipEdit.clipIndex] = { ...updated[slipEdit.clipIndex], sourceOffset: newOffset };
        return updated;
      });
    };

    const handleSlipUp = () => {
      // Capture new thumbnail at the updated sourceOffset
      const clip = clips[slipEdit.clipIndex];
      if (clip) {
        const url = getClipUrl(clip);
        const cachedBlob = videoCache.current.get(url);
        const videoSrc = cachedBlob || url;
        if (videoSrc) {
          const tmpVideo = document.createElement('video');
          tmpVideo.crossOrigin = 'anonymous';
          tmpVideo.muted = true;
          tmpVideo.preload = 'auto';
          tmpVideo.src = videoSrc;
          const seekTo = clip.sourceOffset || 0;
          tmpVideo.onloadeddata = () => {
            tmpVideo.currentTime = seekTo;
          };
          tmpVideo.onseeked = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = tmpVideo.videoWidth || 160;
              canvas.height = tmpVideo.videoHeight || 90;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(tmpVideo, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
              setClips((prev) => {
                const updated = [...prev];
                if (updated[slipEdit.clipIndex]) {
                  updated[slipEdit.clipIndex] = {
                    ...updated[slipEdit.clipIndex],
                    thumbnail: dataUrl,
                  };
                }
                return updated;
              });
            } catch (e) {
              // CORS or canvas tainted — ignore, keep existing thumbnail
            }
            tmpVideo.src = '';
            tmpVideo.remove();
          };
          tmpVideo.onerror = () => {
            tmpVideo.remove();
          };
          tmpVideo.load();
        }
      }
      setSlipEdit(null);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'ew-resize';
    document.addEventListener('mousemove', handleSlipMove);
    document.addEventListener('mouseup', handleSlipUp);
    document.addEventListener('pointerup', handleSlipUp);
    document.addEventListener('pointercancel', handleSlipUp);
    return () => {
      document.removeEventListener('mousemove', handleSlipMove);
      document.removeEventListener('mouseup', handleSlipUp);
      document.removeEventListener('pointerup', handleSlipUp);
      document.removeEventListener('pointercancel', handleSlipUp);
      document.body.style.cursor = '';
    };
  }, [slipEdit, timelineScale, setClips, clips, getClipUrl]);

  // Slip edit: pointer down on clip (starts 200ms timer, promotes to slip on hold)
  const handleClipPointerDown = useCallback(
    (e, index) => {
      if (clips[index]?.locked) return;
      const startX = e.clientX;
      slipTimerRef.current = setTimeout(() => {
        setSlipEdit({
          active: true,
          clipIndex: index,
          startX,
          originalOffset: clips[index]?.sourceOffset || 0,
        });
      }, 200);
    },
    [clips],
  );

  const handleClipPointerUp = useCallback(() => {
    if (slipTimerRef.current) {
      clearTimeout(slipTimerRef.current);
      slipTimerRef.current = null;
    }
    // Always clear any active slip edit on pointer release
    setSlipEdit(null);
    document.body.style.cursor = '';
  }, []);

  const handleApplyPreset = useCallback((preset) => {
    setSelectedPreset(preset);
    if (preset.settings) {
      // Apply text style settings
      setTextStyle((prev) => ({ ...prev, ...preset.settings }));

      // Apply crop mode if specified in preset
      if (preset.settings.cropMode) {
        setCropMode(preset.settings.cropMode);
      }
    }
  }, []);

  const handleSyncLyrics = useCallback(
    (mode) => {
      if (!lyrics.trim() || !filteredBeats.length) return;

      const lyricWords = lyrics.split(/\s+/).filter((w) => w.trim());
      // Use trimmed duration for timing calculations
      const effectiveDuration =
        (selectedAudio?.endTime || selectedAudio?.duration || duration) -
        (selectedAudio?.startTime || 0);

      if (mode === 'beat') {
        // One word per beat - uses LOCAL time from filteredBeats
        const newWords = lyricWords.map((text, i) => ({
          id: `word_${Date.now()}_${i}`,
          text,
          startTime: filteredBeats[i % filteredBeats.length] || i * 0.5,
          duration: 0.4,
        }));
        setWords(newWords);
      } else if (mode === 'even') {
        // Evenly spread across trimmed duration
        const interval = effectiveDuration / lyricWords.length;
        const newWords = lyricWords.map((text, i) => ({
          id: `word_${Date.now()}_${i}`,
          text,
          startTime: i * interval,
          duration: interval * 0.8,
        }));
        setWords(newWords);
      }

      setShowLyricsEditor(false);
    },
    [lyrics, filteredBeats, duration, selectedAudio],
  );

  // Check if server-side OpenAI key is configured
  const checkWhisperAvailable = useCallback(async () => {
    try {
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) return false;

      const token = await user.getIdToken();
      const baseUrl =
        window.location.hostname === 'localhost' ? `http://localhost:${window.location.port}` : '';
      const response = await fetch(`${baseUrl}/api/whisper?action=status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return false;
      const data = await response.json();
      return data.configured;
    } catch (error) {
      log.warn('Could not check Whisper status:', error.message);
      return false;
    }
  }, []);

  // AI Transcription with OpenAI Whisper via server proxy
  const handleAITranscribe = useCallback(async () => {
    // Check if server-side Whisper is available
    const available = await checkWhisperAvailable();
    if (!available) {
      setTranscriptionError(
        'Whisper transcription is not configured on the server. Contact your admin.',
      );
      return;
    }

    if (!selectedAudio?.url && !selectedAudio?.localUrl && !selectedAudio?.file) {
      setTranscriptionError('Please select an audio file first');
      return;
    }

    setIsTranscribing(true);
    setTranscriptionError(null);

    try {
      // Get trim boundaries - we'll only transcribe this portion
      let { trimStart, trimEnd } = getTrimBoundaries(selectedAudio, duration);
      let trimDuration = trimEnd - trimStart;

      // Whisper API has a 25MB file limit. At 44.1kHz stereo 16-bit WAV, that's ~145 seconds.
      // Limit to 90 seconds to be safe and provide better transcription quality.
      const MAX_TRANSCRIBE_DURATION = 90;
      if (trimDuration > MAX_TRANSCRIBE_DURATION) {
        log(
          `Whisper: Duration ${trimDuration.toFixed(1)}s exceeds max ${MAX_TRANSCRIBE_DURATION}s, limiting`,
        );
        toast.info(
          `Audio is ${Math.floor(trimDuration)}s - transcribing first ${MAX_TRANSCRIBE_DURATION}s. Trim your audio for a specific section.`,
        );
        trimEnd = trimStart + MAX_TRANSCRIBE_DURATION;
        trimDuration = MAX_TRANSCRIBE_DURATION;
      }

      log(
        `Whisper: Will transcribe ${trimDuration.toFixed(1)}s (${trimStart.toFixed(1)}s - ${trimEnd.toFixed(1)}s)`,
      );

      if (!selectedAudio.url) {
        throw new Error('No audio URL available. Please re-upload the audio file.');
      }

      // Fetch and trim the audio
      log('Whisper: Fetching audio from Firebase...');
      const response = await fetch(selectedAudio.url);
      if (!response.ok) throw new Error('Failed to fetch audio');
      const fullAudioBlob = await response.blob();
      log(`Whisper: Fetched full audio - ${(fullAudioBlob.size / 1024 / 1024).toFixed(1)}MB`);

      // Trim the audio to just the selected range using Web Audio API
      log('Whisper: Trimming audio to selected range...');
      const arrayBuffer = await fullAudioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(trimStart * sampleRate);
      const endSample = Math.min(Math.floor(trimEnd * sampleRate), audioBuffer.length);
      const trimmedLength = endSample - startSample;
      log(`Whisper: Trimming ${(trimmedLength / sampleRate).toFixed(1)}s of audio`);

      // Create a new buffer with just the trimmed portion
      const trimmedBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        trimmedLength,
        sampleRate,
      );

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel);
        const destData = trimmedBuffer.getChannelData(channel);
        for (let i = 0; i < trimmedLength; i++) {
          destData[i] = sourceData[startSample + i];
        }
      }

      // Convert to WAV
      const wavBlob = audioBufferToWav(trimmedBuffer);
      log(`Whisper: Trimmed audio ready - ${(wavBlob.size / 1024).toFixed(0)}KB`);
      await audioContext.close();

      // Helper function to convert AudioBuffer to WAV
      function audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sr = buffer.sampleRate;
        const format = 1;
        const bitDepth = 16;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const dataLength = buffer.length * blockAlign;
        const bufferLength = 44 + dataLength;
        const ab = new ArrayBuffer(bufferLength);
        const view = new DataView(ab);

        const writeString = (offset, string) => {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, bufferLength - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataLength, true);

        let offset = 44;
        for (let i = 0; i < buffer.length; i++) {
          for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
          }
        }
        return new Blob([ab], { type: 'audio/wav' });
      }

      // Send to server proxy (keeps API key server-side)
      log('Whisper: Sending to server proxy for transcription...');
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'word');

      const { getAuth: getAuthForToken } = await import('firebase/auth');
      const authForToken = getAuthForToken();
      const firebaseToken = await authForToken.currentUser?.getIdToken();
      const proxyBase =
        window.location.hostname === 'localhost' ? `http://localhost:${window.location.port}` : '';
      const whisperResponse = await fetch(`${proxyBase}/api/transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firebaseToken}`,
        },
        body: formData,
      });

      if (!whisperResponse.ok) {
        const errorData = await whisperResponse.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Whisper API error: ${whisperResponse.status}`);
      }

      const result = await whisperResponse.json();
      log('Whisper: Transcription complete', result);

      // Process words from Whisper response
      if (result.words && result.words.length > 0) {
        const newWords = result.words.map((word, index) => ({
          id: `word-${Date.now()}-${index}`,
          text: word.word,
          startTime: word.start,
          duration: word.end - word.start,
        }));

        log(`Whisper: Got ${newWords.length} words`);
        setWords(newWords);
        setLyrics(result.text || newWords.map((w) => w.text).join(' '));
        toast.success(`Transcribed ${newWords.length} words with Whisper`);
      } else if (result.text) {
        // Whisper returned text but no word timestamps - create evenly spaced words
        const words = result.text.split(/\s+/).filter((w) => w.length > 0);
        const wordDuration = trimDuration / words.length;
        const newWords = words.map((word, index) => ({
          id: `word-${Date.now()}-${index}`,
          text: word,
          startTime: index * wordDuration,
          duration: wordDuration * 0.9,
        }));

        log(`Whisper: Got ${newWords.length} words (evenly spaced)`);
        setWords(newWords);
        setLyrics(result.text);
        toast.success(`Transcribed ${newWords.length} words (adjust timing in Word Timeline)`);
      } else {
        toast.error('No words detected in audio');
        setTranscriptionError('No words detected in audio');
      }
    } catch (error) {
      log.error('Transcription error:', error);
      toast.error(`Transcription failed: ${error.message}`);
      setTranscriptionError(error.message);
    } finally {
      setIsTranscribing(false);
    }
  }, [selectedAudio, duration, toast]);

  const handleSaveApiKey = useCallback(() => {
    if (apiKeyInput.trim()) {
      saveApiKey('openai', apiKeyInput.trim());
      setShowApiKeyModal(false);
      setApiKeyInput('');
      // Trigger transcription after saving key
      handleAITranscribe();
    }
  }, [apiKeyInput, handleAITranscribe]);

  const handleClipSelect = (index, e) => {
    setActiveTimelineRow('clips');
    if (e.shiftKey) {
      // Multi-select — don't move playhead
      setSelectedClips((prev) =>
        prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
      );
    } else {
      setSelectedClips([index]); // Select only — NO seek
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Ruler click/drag to seek playhead
  const handleRulerMouseDown = useCallback(
    (e) => {
      if (!timelineRef.current || timelineDuration <= 0) return;
      e.preventDefault();
      const rect = timelineRef.current.getBoundingClientRect();
      const pxPerSec = 40 * timelineScale;
      const timelinePx = timelineDuration * pxPerSec;
      const clickX = e.clientX - rect.left + timelineRef.current.scrollLeft;
      handleSeek(Math.max(0, Math.min(1, clickX / timelinePx)) * timelineDuration);
      wasPlayingBeforePlayheadDrag.current = isPlaying;
      if (isPlaying) setIsPlaying(false);
      setPlayheadDragging(true);
    },
    [timelineDuration, timelineScale, handleSeek, isPlaying],
  );

  // Smart ruler ticks based on zoom level
  const rulerTicks = useMemo(() => {
    if (timelineDuration <= 0) return [];
    const pxPerSec = 40 * timelineScale;
    let minor, labelEvery;
    if (pxPerSec >= 60) {
      minor = 0.5;
      labelEvery = 1;
    } else if (pxPerSec >= 30) {
      minor = 1;
      labelEvery = 5;
    } else {
      minor = 2;
      labelEvery = 10;
    }
    const ticks = [];
    for (let t = 0; t <= timelineDuration; t += minor) {
      const rounded = Math.round(t * 100) / 100;
      ticks.push({ time: rounded, isLabel: rounded % labelEvery === 0 });
    }
    return ticks;
  }, [timelineDuration, timelineScale]);

  // ── Template Picker (no mode selected yet) ──
  if (!editorMode) {
    return (
      <TemplatePicker
        onSelect={(mode) => setEditorMode(mode)}
        onClose={onClose}
        clipCount={category?.videos?.length || 0}
      />
    );
  }

  // ── Solo Clip mode ──
  if (editorMode === 'solo-clip') {
    return (
      <Suspense
        fallback={
          <EditorShell>
            <div className="flex items-center justify-center h-full text-neutral-500">
              Loading editor...
            </div>
          </EditorShell>
        }
      >
        <SoloClipEditor
          category={category}
          existingVideo={existingVideo}
          onSave={onSave}
          onClose={onClose}
          artistId={artistId}
          db={db}
          onSaveLyrics={onSaveLyrics}
          onAddLyrics={onAddLyrics}
          onUpdateLyrics={onUpdateLyrics}
          onDeleteLyrics={onDeleteLyrics}
          presets={presets}
          onSavePreset={onSavePreset}
          nicheTextBanks={category?.nicheTextBanks || null}
        />
      </Suspense>
    );
  }

  // ── Multi-Clip mode ──
  if (editorMode === 'multi-clip') {
    return (
      <Suspense
        fallback={
          <EditorShell>
            <div className="flex items-center justify-center h-full text-neutral-500">
              Loading editor...
            </div>
          </EditorShell>
        }
      >
        <MultiClipEditor
          category={category}
          existingVideo={existingVideo}
          onSave={onSave}
          onClose={onClose}
          artistId={artistId}
          db={db}
          onSaveLyrics={onSaveLyrics}
          onAddLyrics={onAddLyrics}
          onUpdateLyrics={onUpdateLyrics}
          onDeleteLyrics={onDeleteLyrics}
          presets={presets}
          onSavePreset={onSavePreset}
          nicheTextBanks={category?.nicheTextBanks || null}
        />
      </Suspense>
    );
  }

  // ── Photo Montage mode ──
  if (editorMode === 'photo-montage') {
    return (
      <Suspense
        fallback={
          <EditorShell>
            <div className="flex items-center justify-center h-full text-neutral-500">
              Loading editor...
            </div>
          </EditorShell>
        }
      >
        <PhotoMontageEditor
          category={category}
          existingVideo={existingVideo}
          onSave={onSave}
          onClose={onClose}
          artistId={artistId}
          db={db}
          onSaveLyrics={onSaveLyrics}
          onAddLyrics={onAddLyrics}
          onUpdateLyrics={onUpdateLyrics}
          onDeleteLyrics={onDeleteLyrics}
          presets={presets}
          onSavePreset={onSavePreset}
          nicheTextBanks={category?.nicheTextBanks || null}
        />
      </Suspense>
    );
  }

  // ── Clipper mode ──
  if (editorMode === 'clipper') {
    return (
      <Suspense
        fallback={
          <EditorShell>
            <div className="flex items-center justify-center h-full text-neutral-500">
              Loading editor...
            </div>
          </EditorShell>
        }
      >
        <ClipperEditor
          category={category}
          existingVideo={existingVideo}
          existingSession={clipperSession}
          onSaveSession={onSaveClipperSession}
          onClose={onClose}
          artistId={artistId}
          db={db}
          sourceVideos={clipperSourceVideos}
          nicheId={category?.id}
          projectId={category?.projectId}
          nicheBankLabels={nicheBankLabels}
          projectNiches={clipperProjectNiches}
        />
      </Suspense>
    );
  }

  // ── Montage mode (existing editor) ──
  return (
    <EditorShell onBackdropClick={handleCloseRequest} isMobile={isMobile}>
      <EditorTopBar
        title={videoName}
        onTitleChange={setVideoName}
        placeholder="Untitled Video"
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={handleSave}
        onExport={handleSave}
        onBack={handleCloseRequest}
        isMobile={isMobile}
      />

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex grow basis-0 min-h-0 self-stretch overflow-hidden">
        {/* LEFT: Preview + Controls */}
        <div className="flex grow basis-0 min-h-0 flex-col items-center bg-black overflow-hidden">
          <div className="flex w-full max-w-[448px] grow flex-col items-center gap-4 py-6 px-4 overflow-auto">
            {/* Video Preview */}
            <div
              ref={previewRef}
              className="flex items-center justify-center rounded-lg bg-[#1a1a1aff] border border-neutral-200 relative overflow-hidden"
              style={{ aspectRatio: '9/16', height: '50vh' }}
              onClick={() => {
                setEditingTextId(null);
                setSelectedWordId(null);
              }}
            >
              {/* Hidden audio element for playback */}
              <audio ref={audioRef} style={{ display: 'none' }} />

              {/* Video preview - double-buffered for smooth transitions */}
              {currentClip?.url ||
              currentClip?.localUrl ||
              category?.videos?.[0]?.url ||
              category?.videos?.[0]?.localUrl ? (
                <>
                  {/* Primary video element (A) */}
                  <video
                    ref={videoRef}
                    src={getClipUrl(currentClip) || getClipUrl(category?.videos?.[0])}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: videoError ? 'none' : 'block',
                      opacity: activeVideoRef.current === 'A' ? 1 : 0,
                      position: 'absolute',
                      top: 0,
                      left: 0,
                    }}
                    loop
                    playsInline
                    preload="auto"
                    autoPlay={isPlaying && activeVideoRef.current === 'A'}
                    crossOrigin="anonymous"
                    onLoadStart={() => {
                      if (activeVideoRef.current === 'A') {
                        setVideoError(null);
                        clearTimeout(videoLoadingTimer.current);
                        videoLoadingTimer.current = setTimeout(() => setVideoLoading(true), 200);
                      }
                    }}
                    onCanPlay={() => {
                      if (activeVideoRef.current === 'A') {
                        clearTimeout(videoLoadingTimer.current);
                        setVideoLoading(false);
                      }
                    }}
                    onError={(e) => {
                      log.error('Video A load error:', e);
                      if (activeVideoRef.current === 'A') {
                        clearTimeout(videoLoadingTimer.current);
                        setVideoError(
                          'Unable to load video. This may be due to CORS restrictions.',
                        );
                        setVideoLoading(false);
                      }
                    }}
                  />
                  {/* Secondary video element (B) - for preloading next clip */}
                  <video
                    ref={videoRefB}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: videoError ? 'none' : 'block',
                      opacity: activeVideoRef.current === 'B' ? 1 : 0,
                      position: 'absolute',
                      top: 0,
                      left: 0,
                    }}
                    loop
                    playsInline
                    preload="auto"
                    autoPlay={isPlaying && activeVideoRef.current === 'B'}
                    crossOrigin="anonymous"
                    onLoadStart={() => {
                      if (activeVideoRef.current === 'B') {
                        setVideoError(null);
                        clearTimeout(videoLoadingTimer.current);
                        videoLoadingTimer.current = setTimeout(() => setVideoLoading(true), 200);
                      }
                    }}
                    onCanPlay={() => {
                      if (activeVideoRef.current === 'B') {
                        clearTimeout(videoLoadingTimer.current);
                        setVideoLoading(false);
                      }
                    }}
                    onError={(e) => {
                      log.error('Video B load error:', e);
                      if (activeVideoRef.current === 'B') {
                        clearTimeout(videoLoadingTimer.current);
                        setVideoError(
                          'Unable to load video. This may be due to CORS restrictions.',
                        );
                        setVideoLoading(false);
                      }
                    }}
                  />
                  {videoLoading && !videoError && (
                    <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-[#0a0a0aff]">
                      {/* Show thumbnail as poster frame while video loads */}
                      {currentClip?.thumbnail || currentClip?.thumbnailUrl ? (
                        <>
                          <img
                            src={currentClip.thumbnail || currentClip.thumbnailUrl}
                            alt=""
                            style={{
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              opacity: 0.7,
                            }}
                          />
                          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1.5">
                            <div className="w-4 h-4 border-2 border-neutral-500 border-t-white rounded-full animate-spin" />
                            <span className="text-[11px] text-neutral-300">Loading...</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-8 h-8 border-[3px] border-[#333] border-t-[#6366f1] rounded-full animate-spin" />
                          <p className="mt-2 text-xs" style={{ color: theme.text.secondary }}>
                            Loading video...
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  {videoError && (
                    <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-[#0a0a0aff]">
                      <svg
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="1.5"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <p
                        style={{
                          color: '#ef4444',
                          marginTop: 8,
                          fontSize: 12,
                          textAlign: 'center',
                          maxWidth: '90%',
                        }}
                      >
                        {videoError}
                      </p>
                      <p
                        style={{
                          color: theme.text.muted,
                          fontSize: 10,
                          textAlign: 'center',
                          maxWidth: '90%',
                          marginTop: 4,
                        }}
                      >
                        Try re-uploading the video or check Firebase CORS settings.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-[#0a0a0aff]">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={theme.text.muted}
                    strokeWidth="1.5"
                  >
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M10 9l5 3-5 3V9z" />
                  </svg>
                  <p style={{ color: theme.text.muted, marginTop: 8, fontSize: 12 }}>
                    {clips.length === 0 ? 'Add clips to preview' : 'Loading...'}
                  </p>
                </div>
              )}

              {/* Text Overlays — DraggableTextOverlay handles click/drag/edit */}
              {visibleTexts.map((overlay) => (
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
                  onPositionChange={(newPos) => updateTextOverlay(overlay.id, { position: newPos })}
                  onTextChange={(newText) => updateTextOverlay(overlay.id, { text: newText })}
                  containerRef={previewRef}
                  onDelete={() => removeTextOverlay(overlay.id)}
                  onDragEnd={() => {}}
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
                            toast.success('Updated text in bank');
                          }
                        }
                      : undefined
                  }
                />
              ))}

              {/* Active word from lyrics — centered, fully styled */}
              {currentWord &&
                (() => {
                  const scaledFontSize = Math.round((textStyle.fontSize || 48) * 0.35);
                  const wordTextTransform =
                    textStyle.textCase === 'upper'
                      ? 'uppercase'
                      : textStyle.textCase === 'lower'
                        ? 'lowercase'
                        : 'none';
                  const wordTextShadow = textStyle.outline
                    ? `0 0 4px ${textStyle.outlineColor || '#000'}, 1px 1px 2px ${textStyle.outlineColor || '#000'}, -1px -1px 2px ${textStyle.outlineColor || '#000'}`
                    : 'none';
                  return (
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '80%',
                        textAlign: textStyle.textAlign || 'center',
                        pointerEvents: 'none',
                        zIndex: 7,
                      }}
                    >
                      <span
                        style={{
                          fontSize: scaledFontSize,
                          fontFamily: textStyle.fontFamily || 'sans-serif',
                          fontWeight: textStyle.fontWeight || '600',
                          color: textStyle.color || '#ffffff',
                          textTransform: wordTextTransform,
                          textShadow: wordTextShadow,
                          WebkitTextStroke: textStyle.textStroke || 'unset',
                          userSelect: 'none',
                        }}
                      >
                        {currentWord.text}
                      </span>
                    </div>
                  );
                })()}

              {/* Crop Overlay */}
              {cropMode === '4:3' && (
                <>
                  <div
                    style={{
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
                      zIndex: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.6)',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                      }}
                    >
                      Cropped
                    </span>
                  </div>
                  <div
                    style={{
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
                      zIndex: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.6)',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                      }}
                    >
                      Cropped
                    </span>
                  </div>
                </>
              )}
              {cropMode === '1:1' && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 'calc((100% - (100% * 0.5625)) / 2)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderBottom: '2px dashed rgba(255, 255, 255, 0.4)',
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.6)',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                      }}
                    >
                      Cropped
                    </span>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 'calc((100% - (100% * 0.5625)) / 2)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderTop: '2px dashed rgba(255, 255, 255, 0.4)',
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.6)',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                      }}
                    >
                      Cropped
                    </span>
                  </div>
                </>
              )}

              {/* Safe Zone Guides */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-0 right-0 h-[15%] border-b border-dashed border-neutral-500" />
                <div className="absolute bottom-0 left-0 right-0 h-[15%] border-t border-dashed border-neutral-500" />
              </div>
            </div>

            {/* Reroll */}
            {clips.length > 0 && (
              <Button
                variant="neutral-tertiary"
                size="medium"
                icon={<FeatherRefreshCw />}
                onClick={handleReroll}
              >
                {editingTextId ? 'Re-roll Text' : 'Re-roll'}
              </Button>
            )}

            {/* Generation Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant="brand-primary"
                size="medium"
                icon={<FeatherPlus />}
                onClick={executeGeneration}
                disabled={isGenerating || clips.length === 0}
              >
                {isGenerating ? 'Creating...' : 'Create'}
              </Button>
              <input
                type="number"
                min={1}
                max={50}
                value={generateCount}
                onChange={(e) =>
                  setGenerateCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))
                }
                className="w-16 px-2 py-1.5 rounded-md border border-neutral-200 bg-[#1a1a1aff] text-[#ffffffff] text-[12px] text-center outline-none"
              />
            </div>
          </div>

          {/* ═══ TIMELINE ═══ */}
          <div className="flex w-full flex-col items-start border-t border-neutral-200 bg-[#1a1a1aff] px-6 py-4 flex-shrink-0">
            {/* Timeline header — title + cut actions left, BPM + zoom right */}
            <div className="flex w-full items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-heading-3 font-heading-3 text-[#ffffffff]">
                  Timeline ({clips.length} clips)
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
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-neutral-500">Max:</span>
                  <input
                    type="number"
                    min={1}
                    max={300}
                    step={1}
                    value={Math.round(userMaxDuration)}
                    onChange={(e) =>
                      setUserMaxDuration(Math.max(1, Math.min(300, parseInt(e.target.value) || 30)))
                    }
                    className="w-12 px-1 py-0.5 rounded border border-neutral-200 bg-black text-[11px] text-white text-center"
                    title="Set minimum timeline duration (seconds)"
                  />
                  <span className="text-[11px] text-neutral-500">s</span>
                </div>
                <Badge variant="neutral">
                  {isAnalyzing
                    ? 'Analyzing beats...'
                    : bpm
                      ? `${Math.round(bpm)} BPM (${filteredBeats.length} beats)`
                      : 'No beats detected'}
                </Badge>
                <IconButton
                  variant="neutral-tertiary"
                  size="small"
                  icon={<FeatherZoomOut />}
                  onClick={() => setTimelineScale((s) => Math.max(0.5, s - 0.1))}
                  aria-label="Zoom out"
                />
                <IconButton
                  variant="neutral-tertiary"
                  size="small"
                  icon={<FeatherZoomIn />}
                  onClick={() => setTimelineScale((s) => Math.min(2, s + 0.1))}
                  aria-label="Zoom in"
                />
              </div>
            </div>

            {/* Draft Variation Tabs */}
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
              </div>
            )}
            {/* Volume Controls — above the unified scroll area */}
            {((selectedAudio && selectedAudio.url && !selectedAudio.isSourceAudio) ||
              Object.keys(clipWaveforms).length > 0) && (
              <div className="flex w-full items-center gap-3 mb-2">
                <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">
                  Volume
                </span>
                <div className="flex-1 flex items-center gap-5 py-1">
                  {selectedAudio && selectedAudio.url && !selectedAudio.isSourceAudio && (
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: '10px' }}>{'\uD83C\uDFB5'}</span>
                      <span className="text-[11px] text-green-400 w-10 shrink-0">Audio</span>
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
                        title={`Added audio: ${Math.round(externalAudioVolume * 100)}%`}
                      />
                      <span className="text-[10px] text-neutral-500 w-8">
                        {Math.round(externalAudioVolume * 100)}%
                      </span>
                    </div>
                  )}
                  {Object.keys(clipWaveforms).length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSourceVideoMuted((m) => !m)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          fontSize: '10px',
                          opacity: sourceVideoMuted ? 0.4 : 1,
                        }}
                        title={sourceVideoMuted ? 'Unmute source audio' : 'Mute source audio'}
                      >
                        {sourceVideoMuted ? '\uD83D\uDD07' : '\uD83C\uDFAC'}
                      </button>
                      <span className="text-[11px] text-amber-400 w-10 shrink-0">Source</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={sourceVideoMuted ? 0 : sourceVideoVolume}
                        onChange={(e) => {
                          setSourceVideoVolume(parseFloat(e.target.value));
                          if (sourceVideoMuted) setSourceVideoMuted(false);
                        }}
                        style={{
                          width: '64px',
                          height: '4px',
                          accentColor: '#f59e0b',
                          cursor: 'pointer',
                        }}
                        title={
                          sourceVideoMuted
                            ? 'Muted'
                            : `Source audio: ${Math.round(sourceVideoVolume * 100)}%`
                        }
                      />
                      <span className="text-[10px] text-neutral-500 w-8">
                        {sourceVideoMuted ? 'Off' : `${Math.round(sourceVideoVolume * 100)}%`}
                      </span>
                    </div>
                  )}
                  {/* Zoom slider — right-aligned */}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <FeatherZoomOut style={{ width: 12, height: 12, color: '#737373' }} />
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
                    <FeatherZoomIn style={{ width: 12, height: 12, color: '#737373' }} />
                  </div>
                </div>
              </div>
            )}

            {/* ═══ UNIFIED TIMELINE: labels column + single scrollable area ═══ */}
            {(() => {
              const hasAudioTrack = !!(
                selectedAudio &&
                selectedAudio.url &&
                !selectedAudio.isSourceAudio &&
                waveformData.length > 0
              );
              const hasSourceTrack = Object.keys(clipWaveforms).length > 0;
              const pxPerSec = 40 * timelineScale;
              const timelinePx = timelineDuration * pxPerSec;
              const playheadPercent =
                timelineDuration > 0 ? (currentTime / timelineDuration) * 100 : 0;
              const audioTrackH = hasAudioTrack ? Math.round(4 + 28 * externalAudioVolume) : 0;
              const srcVol = sourceVideoMuted ? 0 : sourceVideoVolume;
              const sourceTrackH = hasSourceTrack ? Math.round(4 + 28 * srcVol) : 0;
              return (
                <div className="flex w-full items-start gap-3">
                  {/* Fixed labels column — heights match waveform tracks */}
                  <div className="w-20 flex flex-col shrink-0">
                    <div style={{ height: '24px' }} className="flex items-center justify-end pr-1">
                      <span className="text-[10px] text-neutral-600">Time</span>
                    </div>
                    {textOverlays.length > 0 && (
                      <div
                        style={{ height: `${textOverlays.length * 24}px` }}
                        className="flex items-center justify-end pr-1"
                      >
                        <span className="text-caption font-caption text-neutral-400">Text</span>
                      </div>
                    )}
                    {words.length > 0 && (
                      <div
                        style={{ height: '28px' }}
                        className="flex items-center justify-end pr-1"
                      >
                        <span
                          className={`text-caption font-caption ${activeTimelineRow === 'words' ? 'text-indigo-400 font-semibold' : 'text-neutral-400'}`}
                        >
                          Words
                        </span>
                      </div>
                    )}
                    <div style={{ height: '48px' }} className="flex items-center justify-end pr-1">
                      <span
                        className={`text-caption font-caption ${activeTimelineRow === 'clips' ? 'text-indigo-400 font-semibold' : 'text-neutral-400'}`}
                      >
                        Clips
                      </span>
                    </div>
                    {hasAudioTrack && (
                      <div
                        style={{ height: `${audioTrackH}px`, transition: 'height 0.15s ease-out' }}
                        className="flex items-center justify-end pr-1"
                      >
                        {audioTrackH >= 16 && (
                          <span className="text-caption font-caption text-neutral-400">Audio</span>
                        )}
                      </div>
                    )}
                    {hasSourceTrack && (
                      <div
                        style={{ height: `${sourceTrackH}px`, transition: 'height 0.15s ease-out' }}
                        className="flex items-center justify-end pr-1"
                      >
                        {sourceTrackH >= 16 && (
                          <span className="text-caption font-caption text-neutral-400">Source</span>
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
                      style={{ position: 'relative', minWidth: '100%', width: `${timelinePx}px` }}
                    >
                      {/* Playhead line — spans all tracks */}
                      {timelineDuration > 0 && (
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
                          {/* Playhead triangle in ruler */}
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

                      {/* Audio-end marker — dashed line showing where audio stops */}
                      {hasExternalAudio &&
                        trimmedDuration > 0 &&
                        trimmedDuration < timelineDuration && (
                          <>
                            <div
                              style={{
                                position: 'absolute',
                                left: `${(trimmedDuration / timelineDuration) * 100}%`,
                                top: 0,
                                bottom: 0,
                                width: '1px',
                                borderLeft: '1px dashed rgba(34, 197, 94, 0.5)',
                                zIndex: 15,
                                pointerEvents: 'none',
                              }}
                            />
                            {/* Dimmed overlay past audio end */}
                            <div
                              style={{
                                position: 'absolute',
                                left: `${(trimmedDuration / timelineDuration) * 100}%`,
                                right: 0,
                                top: '24px',
                                bottom: 0,
                                background:
                                  'repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(0,0,0,0.15) 4px, rgba(0,0,0,0.15) 8px)',
                                zIndex: 10,
                                pointerEvents: 'none',
                              }}
                            />
                          </>
                        )}

                      {/* Ruler row — click/drag to seek */}
                      <div
                        style={{
                          height: '24px',
                          position: 'relative',
                          cursor: 'crosshair',
                          borderBottom: '1px solid #333',
                        }}
                        onMouseDown={handleRulerMouseDown}
                      >
                        {rulerTicks.map((tick, i) => {
                          const xPx = tick.time * pxPerSec;
                          return (
                            <div
                              key={i}
                              style={{ position: 'absolute', left: `${xPx}px`, top: 0, bottom: 0 }}
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
                        <div style={{ position: 'relative', borderBottom: '1px solid #222' }}>
                          {textOverlays.map((overlay) => {
                            const start = overlay.startTime ?? 0;
                            const end = overlay.endTime ?? timelineDuration;
                            const leftPx = start * pxPerSec;
                            const widthPx = Math.max(20, (end - start) * pxPerSec);
                            const isSelected = editingTextId === overlay.id;
                            const overlayColor = isSelected ? '#818cf8' : '#6366f1';
                            return (
                              <div
                                key={overlay.id}
                                style={{ height: '24px', position: 'relative' }}
                              >
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: `${leftPx}px`,
                                    width: `${widthPx}px`,
                                    top: 2,
                                    bottom: 2,
                                    backgroundColor: isSelected
                                      ? 'rgba(99,102,241,0.4)'
                                      : 'rgba(99,102,241,0.2)',
                                    border: `1px solid ${overlayColor}`,
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    alignItems: 'center',
                                    paddingLeft: '6px',
                                  }}
                                  onClick={() => {
                                    setEditingTextId(overlay.id);
                                    setEditingTextValue(overlay.text);
                                    setSelectedWordId(null);
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
                                  {/* Left resize handle */}
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
                                        const dx = (me.clientX - startX) / pxPerSec;
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
                                  {/* Right resize handle */}
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
                                        const dx = (me.clientX - startX) / pxPerSec;
                                        const newEnd = Math.max(
                                          start + 0.5,
                                          Math.min(timelineDuration, origEnd + dx),
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

                      {/* Words row — absolute positioning based on word timing */}
                      {words.length > 0 && (
                        <div
                          style={{
                            height: '28px',
                            position: 'relative',
                            minWidth: '100%',
                            borderBottom: '1px solid #222',
                          }}
                        >
                          {words.map((word, wi) => {
                            const wDur =
                              word.duration ?? ((word.end ?? 0) - (word.start ?? 0) || 0.5);
                            const wWidth = Math.max(40, wDur * pxPerSec);
                            const wStart = word.startTime ?? word.start ?? 0;
                            const wordId = word.id || `w_${wi}`;
                            const isSelected = selectedWordId === wordId;
                            return (
                              <div
                                key={wordId}
                                style={{
                                  position: 'absolute',
                                  left: `${wStart * pxPerSec}px`,
                                  width: `${wWidth}px`,
                                  height: '100%',
                                  backgroundColor: isSelected
                                    ? 'rgba(99,102,241,0.25)'
                                    : 'rgba(16,185,129,0.15)',
                                  border: isSelected
                                    ? '2px solid #a5b4fc'
                                    : '1px solid rgba(0,0,0,0.3)',
                                  boxShadow: isSelected
                                    ? '0 0 0 1px rgba(129, 140, 248, 0.6), 0 0 8px rgba(99, 102, 241, 0.4)'
                                    : 'none',
                                  overflow: 'hidden',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  zIndex: isSelected ? 5 : 1,
                                  borderRadius: '3px',
                                  boxSizing: 'border-box',
                                }}
                                title={word.text}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSeek(wStart);
                                  setSelectedWordId(wordId);
                                  setEditingTextId(null);
                                  setActiveTimelineRow('words');
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '9px',
                                    color: isSelected ? '#c7d2fe' : '#a1a1aa',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    userSelect: 'none',
                                    padding: '0 2px',
                                    fontWeight: isSelected ? 600 : 400,
                                  }}
                                >
                                  {word.text}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Clips row — always spans full timelinePx so empty area is visible */}
                      <div style={{ height: '48px', position: 'relative', width: '100%' }}>
                        {clips.length === 0 ? (
                          <div className="text-center py-3 text-neutral-500 text-[13px]">
                            <p>Click clips above to add, or use Cut by beat</p>
                          </div>
                        ) : (
                          <div className="flex" style={{ height: '100%', minWidth: '100%' }}>
                            {clips.map((clip, index) => {
                              const clipWidth = Math.max(50, (clip.duration || 1) * pxPerSec);
                              const thumbWidth = Math.min(68, clipWidth - 2);
                              return (
                                <div
                                  key={clip.id}
                                  data-clip-block="true"
                                  draggable={
                                    !clip.locked && !clipResize.active && !slipEdit?.active
                                  }
                                  onDragStart={() =>
                                    !clipResize.active &&
                                    !slipEdit?.active &&
                                    handleClipDragStart(index)
                                  }
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    handleClipDragOver(index);
                                  }}
                                  onDragEnd={handleClipDragEnd}
                                  onPointerDown={(e) => handleClipPointerDown(e, index)}
                                  onPointerUp={handleClipPointerUp}
                                  onPointerLeave={handleClipPointerUp}
                                  style={{
                                    position: 'relative',
                                    height: '48px',
                                    backgroundColor: '#8b5cf6',
                                    borderRadius: '6px',
                                    overflow: 'hidden',
                                    flexShrink: 0,
                                    boxSizing: 'border-box',
                                    width: `${clipWidth}px`,
                                    minWidth: '50px',
                                    display: 'flex',
                                    flexDirection: 'row',
                                    border:
                                      slipEdit?.active && slipEdit.clipIndex === index
                                        ? '2px solid #f59e0b'
                                        : selectedClips.includes(index)
                                          ? '2px solid #a5b4fc'
                                          : '2px solid transparent',
                                    boxShadow: selectedClips.includes(index)
                                      ? '0 0 0 1px rgba(129, 140, 248, 0.6), 0 0 8px rgba(99, 102, 241, 0.4)'
                                      : 'none',
                                    filter: selectedClips.includes(index)
                                      ? 'brightness(1.15)'
                                      : 'none',
                                    zIndex: selectedClips.includes(index) ? 5 : 1,
                                    ...(clipDrag.dragging && clipDrag.fromIndex === index
                                      ? { opacity: 0.5 }
                                      : {}),
                                    ...(clipDrag.dragging &&
                                    clipDrag.toIndex === index &&
                                    clipDrag.fromIndex !== index
                                      ? {
                                          borderLeft: '3px solid #22c55e',
                                          marginLeft: '-3px',
                                        }
                                      : {}),
                                    cursor: clip.locked ? 'not-allowed' : 'grab',
                                    transition: clipResize.active
                                      ? 'none'
                                      : 'width 0.15s ease-out, box-shadow 0.15s ease-out, filter 0.15s ease-out',
                                    borderRight:
                                      index < clips.length - 1
                                        ? '1px solid rgba(0,0,0,0.6)'
                                        : 'none',
                                  }}
                                  onClick={(e) => handleClipSelect(index, e)}
                                >
                                  {/* Selected top accent bar */}
                                  {selectedClips.includes(index) && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        height: '3px',
                                        background: 'linear-gradient(90deg, #818cf8, #a5b4fc)',
                                        zIndex: 4,
                                        borderRadius: '4px 4px 0 0',
                                      }}
                                    />
                                  )}
                                  {/* Thumbnail area */}
                                  <div
                                    style={{
                                      width: `${thumbWidth}px`,
                                      height: '100%',
                                      flexShrink: 0,
                                      position: 'relative',
                                      overflow: 'hidden',
                                      borderRadius: '6px 0 0 6px',
                                    }}
                                  >
                                    {clip.thumbnail || clip.thumbnailUrl ? (
                                      <img
                                        src={clip.thumbnail || clip.thumbnailUrl}
                                        alt=""
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          objectFit: 'cover',
                                          pointerEvents: 'none',
                                        }}
                                        loading="lazy"
                                        draggable={false}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          background:
                                            'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: '9px',
                                            color: 'rgba(255,255,255,0.6)',
                                            fontWeight: 600,
                                          }}
                                        >
                                          {index + 1}
                                        </span>
                                      </div>
                                    )}
                                    {clip.locked && (
                                      <div
                                        style={{
                                          position: 'absolute',
                                          top: 2,
                                          right: 2,
                                          zIndex: 2,
                                          width: '16px',
                                          height: '16px',
                                          borderRadius: '50%',
                                          backgroundColor: '#f59e0b',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          fontSize: '10px',
                                        }}
                                      >
                                        🔒
                                      </div>
                                    )}
                                    {clip.duration > 0 && (
                                      <span
                                        style={{
                                          position: 'absolute',
                                          bottom: 2,
                                          left: 2,
                                          padding: '1px 4px',
                                          backgroundColor: 'rgba(0,0,0,0.6)',
                                          borderRadius: '3px',
                                          fontSize: '9px',
                                          color: '#fff',
                                        }}
                                      >
                                        {clip.duration.toFixed(1)}s
                                      </span>
                                    )}
                                    {slipEdit?.active && slipEdit.clipIndex === index && (
                                      <span
                                        style={{
                                          position: 'absolute',
                                          top: 2,
                                          left: 2,
                                          padding: '1px 4px',
                                          backgroundColor: 'rgba(245, 158, 11, 0.85)',
                                          borderRadius: '3px',
                                          fontSize: '9px',
                                          color: '#000',
                                          fontWeight: 700,
                                          letterSpacing: '0.5px',
                                        }}
                                      >
                                        SLIP
                                      </span>
                                    )}
                                  </div>
                                  {/* Duration track area */}
                                  <div
                                    style={{
                                      flex: 1,
                                      height: '100%',
                                      backgroundColor: selectedClips.includes(index)
                                        ? `${theme.accent.primary}22`
                                        : `${theme.bg.surface}`,
                                      position: 'relative',
                                      borderRadius: '0 6px 6px 0',
                                      overflow: 'hidden',
                                    }}
                                  />
                                  {/* Right-edge resize handle */}
                                  {!clip.locked && (
                                    <div
                                      onPointerDown={(e) => handleResizeStart(e, index, 'right')}
                                      style={{
                                        position: 'absolute',
                                        top: 0,
                                        right: 0,
                                        width: '8px',
                                        height: '100%',
                                        cursor: 'col-resize',
                                        zIndex: 3,
                                        background:
                                          'linear-gradient(to left, rgba(167,139,250,0.4), transparent)',
                                        opacity: 0,
                                        transition: 'opacity 0.15s',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Audio waveform row (external) — continuous strip, height scales with volume */}
                      {hasAudioTrack &&
                        (() => {
                          const audioPx = trimmedDuration * pxPerSec;
                          const maxBars = Math.max(50, Math.round(audioPx / 3));
                          const bars = downsample(waveformData, maxBars);
                          const vol = externalAudioVolume;
                          const trackH = Math.round(4 + 28 * vol); // 4px at 0%, 32px at 100%
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
                                        height: `${amplitude * vol * 100}%`,
                                        opacity: vol > 0 ? 0.6 : 0.2,
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                      {/* Source audio waveform row — per-clip segments, height scales with volume */}
                      {hasSourceTrack &&
                        (() => {
                          const srcVol = sourceVideoMuted ? 0 : sourceVideoVolume;
                          const trackH = Math.round(4 + 28 * srcVol); // 4px at 0%, 32px at 100%
                          return (
                            <div
                              style={{
                                height: `${trackH}px`,
                                borderTop: '1px solid #333',
                                position: 'relative',
                                display: 'flex',
                                transition: 'height 0.15s ease-out',
                              }}
                            >
                              {clips.map((clip, idx) => {
                                const segWidth = Math.max(50, (clip.duration || 1) * pxPerSec);
                                const bars = perClipSourceWaveforms[idx] || [];
                                return (
                                  <div
                                    key={`src-seg-${idx}`}
                                    style={{
                                      width: `${segWidth}px`,
                                      flexShrink: 0,
                                      display: 'flex',
                                      alignItems: 'center',
                                      height: '100%',
                                      backgroundColor:
                                        srcVol > 0
                                          ? 'rgba(245, 158, 11, 0.06)'
                                          : 'rgba(245, 158, 11, 0.02)',
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
                                            backgroundColor: 'rgba(245, 158, 11, 0.4)',
                                            height: `${amplitude * srcVol * 100}%`,
                                            opacity: srcVol > 0 ? 0.6 : 0.2,
                                          }}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                      {/* Unified cut lines — only visible when clips row is active */}
                      {clips.length > 1 &&
                        activeTimelineRow === 'clips' &&
                        (() => {
                          let cumPx = 0;
                          const boundaries = [];
                          clips.forEach((clip, idx) => {
                            cumPx += Math.max(50, (clip.duration || 1) * pxPerSec);
                            if (idx < clips.length - 1) {
                              boundaries.push({ px: cumPx, idx });
                            }
                          });
                          // Calculate top offset: skip ruler + text overlays + words row
                          const cutLineTop =
                            24 +
                            (textOverlays.length > 0 ? textOverlays.length * 24 : 0) +
                            (words.length > 0 ? 28 : 0);
                          return boundaries.map(({ px, idx }) => (
                            <div key={`cut-${idx}`}>
                              {/* Visible line spanning clips + audio + source rows */}
                              <div
                                style={{
                                  position: 'absolute',
                                  top: `${cutLineTop}px`,
                                  bottom: 0,
                                  left: `${px}px`,
                                  width: '2px',
                                  backgroundColor: 'rgba(255,255,255,0.5)',
                                  zIndex: 12,
                                  pointerEvents: 'none',
                                }}
                              />
                              {/* Drag handle */}
                              <div
                                style={{
                                  position: 'absolute',
                                  top: `${cutLineTop}px`,
                                  bottom: 0,
                                  left: `${px - 6}px`,
                                  width: '12px',
                                  cursor: 'col-resize',
                                  zIndex: 13,
                                }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const clipIdx = idx + 1;
                                  setCutLineDrag({
                                    active: true,
                                    clipIndex: clipIdx,
                                    startX: e.clientX,
                                    originalStartTime: clips[clipIdx].startTime,
                                    originalPrevDuration: clips[idx].duration || 1,
                                    originalCurrDuration: clips[clipIdx].duration || 1,
                                  });
                                }}
                              />
                            </div>
                          ));
                        })()}

                      {/* Word boundary cut lines — only visible when words row is active */}
                      {words.length > 1 &&
                        activeTimelineRow === 'words' &&
                        (() => {
                          const wordBoundaries = [];
                          words.forEach((word, wi) => {
                            if (wi === 0) return;
                            const wStart = word.startTime ?? word.start ?? 0;
                            wordBoundaries.push({ px: wStart * pxPerSec, wi });
                          });
                          return wordBoundaries.map(({ px, wi }) => (
                            <div
                              key={`wcut-${wi}`}
                              style={{
                                position: 'absolute',
                                top: '24px',
                                bottom: 0,
                                left: `${px}px`,
                                width: '2px',
                                backgroundColor: 'rgba(165,180,252,0.5)',
                                zIndex: 12,
                                pointerEvents: 'none',
                              }}
                            />
                          ));
                        })()}
                    </div>
                    {/* inner content wrapper */}
                  </div>
                  {/* scroll container */}
                </div>
              );
            })()}

            {/* Clip Actions */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Button
                variant="neutral-secondary"
                size="small"
                onClick={handleCombine}
                title="Combine selected clips or clip at playhead with next"
              >
                Combine
              </Button>
              <Button
                variant="neutral-secondary"
                size="small"
                onClick={handleBreak}
                title="Split clip at playhead position"
              >
                Break
              </Button>
              <Button
                variant="neutral-secondary"
                size="small"
                icon={<FeatherRefreshCw />}
                onClick={handleReroll}
                title="Replace clip(s) with random from bank"
              >
                {editingTextId ? 'Reroll Text' : 'Reroll'}
              </Button>
              <Button variant="neutral-secondary" size="small" onClick={handleRearrange}>
                Rearrange
              </Button>
              <Button
                variant="destructive-tertiary"
                size="small"
                icon={<FeatherTrash2 />}
                onClick={handleRemoveClips}
                title="Delete selected clip(s) or clip at playhead"
              >
                Remove
              </Button>
            </div>

            {/* Selection info */}
            {selectedClips.length > 1 && (
              <div className="flex items-center gap-2 px-2 py-1 text-[12px] text-brand-600">
                <span>{selectedClips.length} clips selected</span>
                <Button
                  variant="neutral-tertiary"
                  size="small"
                  onClick={() => setSelectedClips([])}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Sidebar */}
        {!isMobile && (
          <div className="flex w-96 flex-none flex-col items-start self-stretch border-l border-neutral-200 bg-[#1a1a1aff] overflow-auto">
            <div className="flex w-full flex-col items-start">
              {renderCollapsibleSection(
                'audio',
                'Audio',
                <div className="flex flex-col gap-3">
                  {selectedAudio ? (
                    <>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-black/50 min-w-0">
                        <FeatherMusic className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        <span className="text-body font-body text-[#ffffffff] flex-1 min-w-0 truncate">
                          {selectedAudio.name}
                        </span>
                        {selectedAudio.isTrimmed && (
                          <Badge variant="neutral" className="flex-shrink-0">
                            Trimmed
                          </Badge>
                        )}
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
                          onClick={handleAITranscribe}
                          disabled={isTranscribing}
                        >
                          {isTranscribing ? 'Transcribing...' : 'Auto Transcribe'}
                        </Button>
                        <Button
                          variant="destructive-tertiary"
                          size="small"
                          icon={<FeatherTrash2 />}
                          onClick={() => {
                            if (audioRef.current) {
                              audioRef.current.pause();
                              audioRef.current.src = '';
                            }
                            setSelectedAudio(null);
                            setIsPlaying(false);
                            setCurrentTime(0);
                            setDuration(0);
                            setSourceVideoMuted(false);
                          }}
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
                  {/* Filtered audio list */}
                  {filteredAudio.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <select
                        value={audioScope}
                        onChange={(e) => setAudioScope(e.target.value)}
                        className="w-full px-2 py-1 bg-black border border-neutral-200 rounded-md text-[11px] text-neutral-400 outline-none cursor-pointer"
                      >
                        {nicheAudio.length > 0 && (
                          <option value="niche">This Niche ({nicheAudio.length})</option>
                        )}
                        {projectAudio.length > 0 && (
                          <option value="project">This Project ({projectAudio.length})</option>
                        )}
                        <option value="all">All Audio ({libraryAudio.length})</option>
                      </select>
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
                'clips',
                'Clips',
                <div className="flex flex-col gap-3">
                  {/* Collection dropdown */}
                  <select
                    value={selectedCollection}
                    onChange={(e) => setSelectedCollection(e.target.value)}
                    className="w-full px-3 py-2 bg-black border border-neutral-200 rounded-md text-[#ffffffff] text-[13px] outline-none cursor-pointer"
                  >
                    <option value="category">Selected Clips</option>
                    {category?.mediaBanks?.map((bank) => (
                      <option key={bank.id} value={`bank_${bank.id}`}>
                        {bank.name || 'Media Bank'}
                      </option>
                    ))}
                    <option value="all">All Videos (Library)</option>
                    {sidebarCollections.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.name}
                      </option>
                    ))}
                  </select>
                  {/* Clip count + actions */}
                  <div className="flex justify-between items-center">
                    <span className="text-caption font-caption text-neutral-400">
                      {visibleVideos.length} clips
                    </span>
                    <div className="flex gap-1.5 items-center">
                      <CloudImportButton
                        artistId={artistId}
                        db={db}
                        mediaType="video"
                        compact
                        onImportMedia={async (files) => {
                          // Immediately show with blob URLs for instant preview
                          const newVids = files.map((f, i) => ({
                            id: `import_${Date.now()}_${i}`,
                            name: f.name,
                            url: f.url,
                            localUrl: f.localUrl,
                            type: 'video',
                          }));
                          setLibraryVideos((prev) => [...prev, ...newVids]);
                          // Upload to Firebase Storage + library in background
                          for (const f of files) {
                            if (f.file && db && artistId) {
                              try {
                                const { uploadFileWithQuota } =
                                  await import('../../services/firebaseStorage');
                                const { url: firebaseUrl, path } = await uploadFileWithQuota(
                                  db,
                                  artistId,
                                  f.file,
                                  'video',
                                );
                                const { addToLibraryAsync: addLib } =
                                  await import('../../services/libraryService');
                                await addLib(db, artistId, {
                                  name: f.name,
                                  url: firebaseUrl,
                                  type: 'video',
                                  storagePath: path,
                                  source: f.source || 'cloud_import',
                                });
                              } catch (err) {
                                log.warn(
                                  '[VideoEditor] Cloud import upload failed:',
                                  f.name,
                                  err.message,
                                );
                              }
                            }
                          }
                        }}
                      />
                      <Button
                        variant="neutral-tertiary"
                        size="small"
                        onClick={() => {
                          const newClips = visibleVideos.map((v, i) => ({
                            id: `clip_${Date.now()}_${i}`,
                            sourceId: v.id,
                            url: v.url || v.localUrl,
                            localUrl: v.localUrl || v.url,
                            thumbnail: v.thumbnailUrl || v.thumbnail,
                            startTime: i * 2,
                            duration: 2,
                            locked: false,
                            sourceOffset: 0,
                          }));
                          setClips(newClips);
                        }}
                      >
                        Add All
                      </Button>
                    </div>
                  </div>
                  {/* Clip grid */}
                  {visibleVideos.length === 0 ? (
                    <div className="py-4 text-center text-neutral-500 text-[13px]">
                      No videos in this collection
                    </div>
                  ) : (
                    <div className="relative max-h-[300px] overflow-y-auto">
                      <div className="grid grid-cols-2 gap-1.5">
                        {visibleVideos.map((video, i) => {
                          const isInTimeline = clips.some((clip) => clip.sourceId === video.id);
                          return (
                            <div
                              key={video.id || i}
                              className={`cursor-pointer p-1 rounded-md border-2 transition-colors relative ${isInTimeline ? 'border-green-500/40' : 'border-transparent'}`}
                              onClick={() => {
                                setClips((prev) => [
                                  ...prev,
                                  {
                                    id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                    sourceId: video.id,
                                    url: video.url || video.localUrl,
                                    localUrl: video.localUrl || video.url,
                                    thumbnail: video.thumbnailUrl || video.thumbnail,
                                    startTime: prev.length * 2,
                                    duration: 2,
                                    locked: false,
                                    sourceOffset: 0,
                                  },
                                ]);
                                if (video.id && category?.artistId)
                                  incrementUseCount(category.artistId, video.id);
                              }}
                            >
                              {isInTimeline && (
                                <div className="absolute top-1 right-1 z-[2] w-[18px] h-[18px] rounded-full bg-green-500 flex items-center justify-center text-[11px] text-white font-bold shadow-sm">
                                  ✓
                                </div>
                              )}
                              <div className="w-full aspect-video rounded overflow-hidden bg-[#0a0a0aff]">
                                {video.thumbnailUrl || video.thumbnail ? (
                                  <img
                                    src={video.thumbnailUrl || video.thumbnail}
                                    alt={video.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-xl">
                                    🎬
                                  </div>
                                )}
                              </div>
                              <div className="text-[10px] text-neutral-400 overflow-hidden text-ellipsis whitespace-nowrap mt-1">
                                {(video.name || video.metadata?.originalName || 'Clip').substring(
                                  0,
                                  20,
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                      toast.error('Upload audio first');
                      return;
                    }
                    handleAITranscribe();
                  }}
                  onApplyLyric={(lyric) => {
                    setLoadedBankLyricId(lyric.id);
                    if (lyric.words?.length > 0) {
                      setWords(lyric.words);
                      setShowWordTimeline(true);
                    } else if (lyric.content) {
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
                      toast.error('This lyric has no content to edit');
                    }
                  }}
                  onApplyToTimeline={(lyric) => {
                    // Load words from lyric, then cut by word + create text overlays in one step
                    const lyricWords =
                      lyric.words?.length > 0
                        ? lyric.words
                        : lyric.content
                          ? lyric.content
                              .split(/\s+/)
                              .filter(Boolean)
                              .map((text, i) => ({
                                text,
                                startTime: i * 0.5,
                                duration: 0.5,
                              }))
                          : [];
                    if (!lyricWords.length) {
                      toast.error('This lyric has no words');
                      return;
                    }
                    setLoadedBankLyricId(lyric.id);
                    setWords(lyricWords);
                    // Cut by word using available clips
                    const availableClips =
                      visibleVideos.length > 0 ? visibleVideos : category?.videos || [];
                    if (!availableClips.length) {
                      toast.error('No clips in bank. Upload videos first.');
                      return;
                    }
                    const now = Date.now();
                    // Create clips aligned exactly to word timings
                    const newClips = lyricWords.map((word, i) => {
                      const randomClip =
                        availableClips[Math.floor(Math.random() * availableClips.length)];
                      const wStart = word.startTime ?? word.start ?? 0;
                      const wDur = word.duration ?? ((word.end ?? 0) - (word.start ?? 0) || 0.5);
                      return {
                        id: `clip_${now}_${i}`,
                        sourceId: randomClip.id,
                        url: randomClip.url,
                        localUrl: randomClip.localUrl,
                        thumbnail: randomClip.thumbnail,
                        startTime: wStart,
                        duration: wDur,
                        locked: false,
                        sourceOffset: 0,
                      };
                    });
                    setClips(newClips);
                    toast.success(`Applied ${newClips.length} clips from lyrics`);
                  }}
                  onDeleteLyric={(lyricId) => {
                    if (onDeleteLyrics) onDeleteLyrics(lyricId);
                    setLyricsBank((prev) => prev.filter((l) => l.id !== lyricId));
                  }}
                />,
              )}

              {renderCollapsibleSection(
                'text',
                'Text Banks',
                <div className="flex flex-col gap-3">
                  {(() => {
                    const { textBank1, textBank2 } = getTextBanks();
                    return (
                      <>
                        <div>
                          <div
                            className="text-body-bold font-body-bold mb-2"
                            style={{ color: '#818cf8' }}
                          >
                            Text Bank A
                          </div>
                          <div className="flex gap-1.5 mb-2">
                            <input
                              value={newTextA}
                              onChange={(e) => setNewTextA(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTextA.trim()) {
                                  handleAddToTextBank(1, newTextA);
                                  setNewTextA('');
                                }
                              }}
                              placeholder="Add text..."
                              className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-200 bg-black text-[#ffffffff] text-[12px] outline-none"
                            />
                            <IconButton
                              variant="brand-primary"
                              size="small"
                              icon={<FeatherPlus />}
                              onClick={() => {
                                if (newTextA.trim()) {
                                  handleAddToTextBank(1, newTextA);
                                  setNewTextA('');
                                }
                              }}
                              aria-label="Add to Text Bank A"
                            />
                          </div>
                          {textBank1.map((text, idx) => (
                            <div
                              key={idx}
                              className="flex items-center px-2 py-1.5 rounded-md bg-neutral-100/50 mb-1 text-neutral-300 cursor-pointer hover:bg-neutral-200/50"
                              onClick={() => addTextOverlay(text)}
                            >
                              <span className="flex-1 text-[12px]">{text}</span>
                            </div>
                          ))}
                          {textBank1.length === 0 && (
                            <div className="text-[11px] text-neutral-500">No text added yet</div>
                          )}
                        </div>
                        <div>
                          <div
                            className="text-body-bold font-body-bold mb-2"
                            style={{ color: '#fbbf24' }}
                          >
                            Text Bank B
                          </div>
                          <div className="flex gap-1.5 mb-2">
                            <input
                              value={newTextB}
                              onChange={(e) => setNewTextB(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTextB.trim()) {
                                  handleAddToTextBank(2, newTextB);
                                  setNewTextB('');
                                }
                              }}
                              placeholder="Add text..."
                              className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-200 bg-black text-[#ffffffff] text-[12px] outline-none"
                            />
                            <IconButton
                              variant="brand-primary"
                              size="small"
                              icon={<FeatherPlus />}
                              onClick={() => {
                                if (newTextB.trim()) {
                                  handleAddToTextBank(2, newTextB);
                                  setNewTextB('');
                                }
                              }}
                              aria-label="Add to Text Bank B"
                            />
                          </div>
                          {textBank2.map((text, idx) => (
                            <div
                              key={idx}
                              className="flex items-center px-2 py-1.5 rounded-md bg-neutral-100/50 mb-1 text-neutral-300 cursor-pointer hover:bg-neutral-200/50"
                              onClick={() => addTextOverlay(text)}
                            >
                              <span className="flex-1 text-[12px]">{text}</span>
                            </div>
                          ))}
                          {textBank2.length === 0 && (
                            <div className="text-[11px] text-neutral-500">No text added yet</div>
                          )}
                        </div>
                      </>
                    );
                  })()}
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
                    if (selOverlay) {
                      updateTextOverlay(selOverlay.id, {
                        style: { ...selOverlay.style, ...updates },
                      });
                    } else if (isWordMode) {
                      setTextStyle((prev) => ({ ...prev, ...updates }));
                    }
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

                      {/* Add + Delete buttons — always accessible */}
                      <div
                        className="flex gap-2"
                        style={disabled || isWordMode ? { opacity: 1, pointerEvents: 'auto' } : {}}
                      >
                        <Button
                          variant="brand-secondary"
                          size="small"
                          icon={<FeatherPlus />}
                          onClick={() => addTextOverlay()}
                          style={{ opacity: 1, pointerEvents: 'auto' }}
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
                          onChange={(e) =>
                            updateTextOverlay(selOverlay.id, { text: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-md border border-neutral-200 bg-black text-white text-sm"
                        />
                      )}

                      {/* Font Family */}
                      <div>
                        <div className="text-[13px] text-neutral-500 mb-1.5">Font Family</div>
                        <select
                          value={activeStyle.fontFamily || "'TikTok Sans', sans-serif"}
                          onChange={(e) => handleStyleChange({ fontFamily: e.target.value })}
                          className="w-full px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-100 text-white text-[13px] outline-none cursor-pointer"
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
                          onChange={(e) =>
                            handleStyleChange({ fontSize: parseInt(e.target.value) })
                          }
                          className="w-full accent-brand-600"
                        />
                      </div>

                      {/* Text Color + Outline Color */}
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <div className="text-[13px] text-neutral-500 mb-1.5">Text Color</div>
                          <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-100">
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
                          <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-100">
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
                              <div className="text-[13px] text-neutral-500 mb-1.5">
                                Stroke Color
                              </div>
                              <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-100">
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

                      {/* Text Overlays list — hidden when styling words */}
                      {!isWordMode && (
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
                      )}

                      {/* Crop */}
                      <div className="flex items-center gap-2 pt-2 border-t border-neutral-200">
                        <span className="text-caption font-caption text-neutral-400">Crop</span>
                        <select
                          value={cropMode}
                          onChange={(e) => setCropMode(e.target.value)}
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
          </div>
        )}
      </div>

      {/* Hidden audio file input */}
      <input
        ref={audioFileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleAudioUpload}
      />

      <EditorFooter
        lastSaved={lastSaved}
        onCancel={onClose}
        onSaveAll={handleSaveAllAndClose}
        isSavingAll={isSavingAll}
        saveAllCount={allVideos.length}
      />

      {/* Lyrics Editor Modal */}
      {showLyricsEditor && (
        <div
          className="absolute inset-0 bg-black/80 flex items-center justify-center z-10"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setShowLyricsEditor(false);
            }
          }}
        >
          <div
            className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[400px]'}`}
          >
            <h3 className="text-[16px] font-semibold text-[#ffffffff] mb-4">Edit Lyrics</h3>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder="Enter your lyrics here, one word or line per row..."
              className={`w-full h-[200px] p-3 bg-[#0a0a0a] border border-neutral-200 rounded-lg text-white text-sm resize-none outline-none mb-4 ${isMobile ? 'min-h-[150px] text-base' : ''}`}
              autoFocus={!isMobile}
            />
            <div
              className={`flex items-center gap-2 mb-4 text-[13px] text-neutral-400 ${isMobile ? 'flex-col items-stretch' : ''}`}
            >
              <span>Sync method:</span>
              <div className={`flex gap-2 ${isMobile ? 'w-full' : ''}`}>
                <Button
                  variant="neutral-secondary"
                  size="small"
                  className={isMobile ? 'flex-1' : ''}
                  onClick={() => handleSyncLyrics('beat')}
                >
                  Sync to beats
                </Button>
                <Button
                  variant="neutral-secondary"
                  size="small"
                  className={isMobile ? 'flex-1' : ''}
                  onClick={() => handleSyncLyrics('even')}
                >
                  Spread evenly
                </Button>
              </div>
            </div>
            <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
              <Button
                variant="neutral-secondary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={() => setShowLyricsEditor(false)}
              >
                Cancel
              </Button>
              <Button
                variant="brand-primary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={() => setShowLyricsEditor(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Word Timeline Modal */}
      {showWordTimeline && (
        <WordTimeline
          words={words}
          setWords={setWords}
          duration={trimmedDuration}
          currentTime={currentTime}
          onSeek={handleSeek}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onClose={() => setShowWordTimeline(false)}
          audioRef={audioRef}
          loadedBankLyricId={loadedBankLyricId}
          onSaveToBank={(lyricId, wordsToSave) => {
            // Save word timings back to the lyric bank entry
            if (lyricId && onUpdateLyrics) {
              log(`Saving ${wordsToSave.length} words to lyric bank entry:`, lyricId);
              onUpdateLyrics(lyricId, { words: wordsToSave });
            }
          }}
          onAddToBank={(lyricData) => {
            // Add new lyrics with words to the bank
            if (onAddLyrics) {
              log(
                `Adding new lyric to bank: "${lyricData.title}" with ${lyricData.words?.length || 0} words`,
              );
              onAddLyrics({
                title: lyricData.title,
                content: lyricData.content,
                words: lyricData.words,
              });
            }
          }}
        />
      )}

      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
          <div
            className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[400px]'}`}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4">🔑 OpenAI API Key</h3>
            <p style={{ color: theme.text.secondary }} className="text-sm mb-4">
              AI transcription uses OpenAI Whisper (great for music/vocals). Get a key at{' '}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: theme.accent.primary }}
              >
                platform.openai.com
              </a>
            </p>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && apiKeyInput.trim()) {
                  e.preventDefault();
                  handleSaveApiKey();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowApiKeyModal(false);
                  setApiKeyInput('');
                }
              }}
              placeholder="Enter your OpenAI API key (sk-...)..."
              autoFocus={!isMobile}
              className={`w-full rounded-lg mb-4 outline-none ${isMobile ? 'p-3.5 text-base' : 'p-3 text-sm'}`}
              style={{
                background: theme.bg.surface,
                border: `1px solid ${theme.bg.elevated}`,
                color: theme.text.primary,
              }}
            />
            <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
              <Button
                variant="neutral-secondary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={() => {
                  setShowApiKeyModal(false);
                  setApiKeyInput('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="brand-primary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={handleSaveApiKey}
                disabled={!apiKeyInput.trim()}
              >
                Save & Transcribe
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Analyzing Overlay */}
      {isAnalyzing && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-4 text-[#ffffffff]">
          <div className="w-10 h-10 border-[3px] border-[#333] border-t-[#6366f1] rounded-full animate-spin" />
          <p>Analyzing beats...</p>
        </div>
      )}

      {/* Auto-save Recovery Prompt */}
      {/* Beat Selector Modal */}
      {showBeatSelector && (
        <BeatSelector
          beats={filteredBeats}
          bpm={bpm}
          duration={trimmedDuration}
          onApply={handleBeatSelectionApply}
          onCancel={() => setShowBeatSelector(false)}
        />
      )}

      {/* ── Momentum Selector Modal ── */}
      {showMomentumSelector && selectedAudio?.url && (
        <MomentumSelector
          audioSource={selectedAudio.url}
          duration={trimmedDuration}
          trimStart={audioStartTime || undefined}
          trimEnd={audioEndTime || undefined}
          onApply={(cutPoints) => {
            handleBeatSelectionApply(cutPoints);
            setShowMomentumSelector(false);
          }}
          onCancel={() => setShowMomentumSelector(false)}
        />
      )}

      {showRecoveryPrompt && recoveryData && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
          <div
            className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[400px]'}`}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4">📝 Recover Unsaved Work?</h3>
            <p style={{ color: theme.text.secondary }} className="text-sm mb-4">
              We found an auto-saved draft from{' '}
              <strong style={{ color: theme.text.primary }}>
                {recoveryData.savedAt
                  ? new Date(recoveryData.savedAt).toLocaleString()
                  : 'recently'}
              </strong>
            </p>
            <div
              className="p-3 rounded-lg mb-4 text-[13px]"
              style={{ backgroundColor: theme.bg.surface, color: theme.text.secondary }}
            >
              <div>🎵 Audio: {recoveryData.audio?.name || 'None'}</div>
              <div>🎬 Clips: {recoveryData.clips?.length || 0}</div>
              <div>💬 Words: {recoveryData.words?.length || 0}</div>
            </div>
            <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
              <Button
                variant="neutral-secondary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={handleDiscardDraft}
              >
                Start Fresh
              </Button>
              <Button
                variant="brand-primary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={handleRestoreDraft}
              >
                Restore Draft
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Save Lyrics to Song Prompt */}
      {showSaveLyricsPrompt && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
          <div
            className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[400px]'}`}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4">💾 Save Lyrics to Song?</h3>
            <p style={{ color: theme.text.secondary }} className="text-sm mb-4">
              You've created timed lyrics for{' '}
              <strong style={{ color: theme.text.primary }}>
                {selectedAudio?.name || 'this song'}
              </strong>
              . Save them to the song so they're automatically available next time you use it?
            </p>
            <div
              className="p-3 rounded-lg mb-4 text-[13px]"
              style={{ backgroundColor: theme.bg.surface, color: theme.text.secondary }}
            >
              <div>🎤 {words.length} words with timing data</div>
              <div className="mt-1 text-xs" style={{ color: theme.text.muted }}>
                "
                {words
                  .slice(0, 5)
                  .map((w) => w.text)
                  .join(' ')}
                {words.length > 5 ? '...' : ''}"
              </div>
            </div>
            <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
              <Button
                variant="neutral-secondary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={() => handleLyricsPromptResponse(false)}
              >
                No, Just This Video
              </Button>
              <Button
                variant="brand-primary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={() => handleLyricsPromptResponse(true)}
              >
                Yes, Save to Song
              </Button>
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

      {/* Close Confirmation Dialog */}
      {showCloseConfirm && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
          <div
            className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[380px]'}`}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4">Close Editor?</h3>
            <p style={{ color: theme.text.secondary }} className="text-sm mb-4">
              You have unsaved work. Are you sure you want to close?
            </p>
            <div
              className="p-3 rounded-lg mb-4 text-[13px]"
              style={{ backgroundColor: theme.bg.surface, color: theme.text.secondary }}
            >
              {selectedAudio && <div>🎵 Audio selected</div>}
              {clips.length > 0 && <div>🎬 {clips.length} clips</div>}
              {words.length > 0 && <div>💬 {words.length} words timed</div>}
            </div>
            <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
              <Button
                variant="neutral-secondary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={() => setShowCloseConfirm(false)}
              >
                Keep Editing
              </Button>
              <Button
                variant="destructive-primary"
                size="small"
                className={isMobile ? 'w-full' : ''}
                onClick={handleConfirmClose}
              >
                Close Anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preset name prompt modal */}
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
                  onSavePreset({
                    name: presetPromptValue.trim(),
                    settings: { ...textStyle, cropMode },
                  });
                  toast.success?.(`Preset "${presetPromptValue.trim()}" saved!`);
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
                    onSavePreset({
                      name: presetPromptValue.trim(),
                      settings: { ...textStyle, cropMode },
                    });
                    toast.success?.(`Preset "${presetPromptValue.trim()}" saved!`);
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

// getStyles deleted — all styles now use Tailwind/Subframe classes
// Remaining export below

export default VideoEditorModal;
