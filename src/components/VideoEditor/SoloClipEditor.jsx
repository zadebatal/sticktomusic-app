import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary, getLyrics,
  addToVideoTextBank, removeFromVideoTextBank, updateVideoTextBank,
  addToLibraryAsync, incrementUseCount, MEDIA_TYPES,
  getTextBankText, getTextBankStyle,
  getBankColor, getBankLabel
} from '../../services/libraryService';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import log from '../../utils/logger';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { FeatherX, FeatherPlay, FeatherPause, FeatherVolume2, FeatherVolumeX, FeatherPlus, FeatherTrash2, FeatherRefreshCw, FeatherMusic, FeatherUpload, FeatherDatabase, FeatherMic, FeatherScissors, FeatherSkipBack, FeatherSkipForward, FeatherStar, FeatherCheck, FeatherZoomIn, FeatherZoomOut } from '@subframe/core';
import { Badge } from '../../ui/components/Badge';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import { normalizeBeatsToTrimRange } from '../../utils/timelineNormalization';
import EditorShell from './shared/EditorShell';
import EditorTopBar from './shared/EditorTopBar';
import EditorFooter from './shared/EditorFooter';
import useCollapsibleSections from './shared/useCollapsibleSections';
import useIsMobile from '../../hooks/useIsMobile';
import AudioClipSelector from './AudioClipSelector';
import BeatSelector from './BeatSelector';
import MomentumSelector from './MomentumSelector';
import CloudImportButton from './CloudImportButton';
import LyricBank from './LyricBank';
import LyricAnalyzer from './LyricAnalyzer';
import WordTimeline from './WordTimeline';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';
import useMediaMultiSelect from './shared/useMediaMultiSelect';
import useEditorSessionState from './shared/useEditorSessionState';
import useUnsavedChanges from './shared/useUnsavedChanges';
import usePixelTimeline from './shared/usePixelTimeline';
import useTimelineZoom from '../../hooks/useTimelineZoom';
import DraggableTextOverlay from './shared/previews/DraggableTextOverlay';
import { FeatherAlignLeft, FeatherAlignCenter, FeatherAlignRight } from '@subframe/core';

// Stroke string helpers: parse "0.5px black" ↔ { width: 0.5, color: '#000000' }
const parseStroke = (str) => {
  if (!str) return { width: 0.5, color: '#000000' };
  const match = str.match(/([\d.]+)px\s+(.*)/);
  if (!match) return { width: 0.5, color: '#000000' };
  return { width: parseFloat(match[1]) || 0.5, color: match[2] || '#000000' };
};
const buildStroke = (width, color) => `${width}px ${color}`;

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

/**
 * SoloClipEditor v2 — "Solo Clip" video editor mode
 *
 * 3-column layout:
 *   Left (260px):  Clip grid + generation controls
 *   Center:        Video preview + playback
 *   Right (320px): Text overlays (with inline style) + Video text banks (always visible)
 *
 * Mirrors SlideshowEditor's template/generation architecture:
 *   allVideos[0] = template
 *   allVideos[1..N] = generated
 *   Tab bar at bottom to switch between them
 */
const SoloClipEditor = ({
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

  // ── Multi-video state (mirrors SlideshowEditor allSlideshows) ──
  // _nicheVideos passed directly from VideoNicheContent bypasses pipelineCategory localStorage lookup
  const nicheVideos = existingVideo?._nicheVideos || [];
  const availableVideos = nicheVideos.length > 0 ? nicheVideos : (category?.videos || []);
  const [allVideos, setAllVideos] = useState(() => {
    if (existingVideo && existingVideo.editorMode === 'solo-clip') {
      // Re-editing an existing solo clip draft
      const existingClip = existingVideo.clips?.[0]
        ? availableVideos.find(v => v.id === existingVideo.clips[0].sourceId) || {
            id: existingVideo.clips[0].sourceId,
            url: existingVideo.clips[0].url,
            localUrl: existingVideo.clips[0].localUrl,
            thumbnailUrl: existingVideo.clips[0].thumbnail,
            thumbnail: existingVideo.clips[0].thumbnail
          }
        : availableVideos[0] || null;
      return [{
        id: 'template',
        name: 'Template',
        clip: existingClip,
        textOverlays: existingVideo.textOverlays || [],
        words: existingVideo.words || [],
        isTemplate: true
      }];
    }
    const firstClip = availableVideos[0] || null;
    return [{
      id: 'template',
      name: 'Template',
      clip: firstClip,
      textOverlays: existingVideo?.textOverlays || [],
      words: existingVideo?.words || [],
      isTemplate: true
    }];
  });
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const nicheGenCount = existingVideo?._nicheGenerateCount || null;
  const [generateCount, setGenerateCount] = useState(
    nicheGenCount ? Math.max(nicheGenCount - 1, 1) : Math.min(10, Math.max(1, (availableVideos.length || 1) - 1))
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [keepTemplateText, setKeepTemplateText] = useState('none');

  // Derived reads from active video
  const activeVideo = allVideos[activeVideoIndex];
  const clip = activeVideo?.clip;
  const textOverlays = activeVideo?.textOverlays || [];
  const textOverlaysRef = useRef(textOverlays);
  textOverlaysRef.current = textOverlays;
  const words = activeVideo?.words || [];

  // ── Footer state ──
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // Wrapper setters (route through allVideos)
  const setTextOverlays = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const current = copy[activeVideoIndex];
      if (!current) return prev;
      copy[activeVideoIndex] = {
        ...current,
        textOverlays: typeof updater === 'function'
          ? updater(current.textOverlays || [])
          : updater
      };
      return copy;
    });
  }, [activeVideoIndex]);

  const setWords = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const current = copy[activeVideoIndex];
      if (!current) return prev;
      copy[activeVideoIndex] = {
        ...current,
        words: typeof updater === 'function' ? updater(current.words || []) : updater
      };
      return copy;
    });
  }, [activeVideoIndex]);

  const setClip = useCallback((newClip) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const current = copy[activeVideoIndex];
      if (!current) return prev;
      copy[activeVideoIndex] = { ...current, clip: newClip };
      return copy;
    });
  }, [activeVideoIndex]);

  // ── Undo/Redo history ──
  const getHistorySnapshot = useCallback(() => {
    const v = allVideos[activeVideoIndex];
    return v ? { clip: v.clip, textOverlays: v.textOverlays, words: v.words } : null;
  }, [allVideos, activeVideoIndex]);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, ...snapshot };
      return copy;
    });
  }, [activeVideoIndex]);

  const { canUndo, canRedo, handleUndo, handleRedo, resetHistory } = useEditorHistory({
    getSnapshot: getHistorySnapshot,
    restoreSnapshot: restoreHistorySnapshot,
    deps: [clip, textOverlays],
    isEditingText: false
  });

  // Reset history when switching video variations
  useEffect(() => { resetHistory(); }, [activeVideoIndex, resetHistory]);

  // ── Audio state ──
  const [selectedAudio, setSelectedAudio] = useState(existingVideo?.audio || null);
  const audioRef = useRef(null);
  const audioFileInputRef = useRef(null);
  // Waveform via shared hook (below)

  // ── Beat detection ──
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();
  const [showBeatSelector, setShowBeatSelector] = useState(false);
  const [showMomentumSelector, setShowMomentumSelector] = useState(false);

  // Audio trim boundaries for beat normalization
  const audioStartTime = selectedAudio?.startTime || 0;
  const audioEndTime = selectedAudio?.endTime || selectedAudio?.duration || 0;

  // Filter beats to trimmed range and normalize to local time
  const filteredBeats = useMemo(() => {
    if (!beats.length) return [];
    return normalizeBeatsToTrimRange(beats, audioStartTime, audioEndTime);
  }, [beats, audioStartTime, audioEndTime]);

  // ── Audio leveling state ──
  const [sourceVideoMuted, setSourceVideoMuted] = useState(existingVideo?.sourceVideoMuted ?? false);
  const [sourceVideoVolume, setSourceVideoVolume] = useState(existingVideo?.sourceVideoVolume ?? 1.0);
  const [externalAudioVolume, setExternalAudioVolume] = useState(existingVideo?.externalAudioVolume ?? 1.0);

  // ── Playback state ──
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [clipDuration, setClipDuration] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const wasPlayingBeforePlayheadDrag = useRef(false);
  const [timelineScale, setTimelineScale] = useState(1);
  const [userMaxDuration, setUserMaxDuration] = useState(existingVideo?.maxDuration || 30);
  const videoRef = useRef(null);
  const animationRef = useRef(null);

  // ── Aspect ratio ──
  const [aspectRatio, setAspectRatio] = useState(existingVideo?.cropMode || '9:16');

  // ── Global text style (matches Montage editor pattern) ──
  const [textStyle, setTextStyle] = useState({
    fontSize: 48,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    color: '#ffffff',
    outline: true,
    outlineColor: '#000000',
    textStroke: null,
    textAlign: 'center',
    textCase: 'default',
    displayMode: 'word',
    ...(existingVideo?.textStyle || {}),
  });
  const [activeTab, setActiveTab] = useState('caption');

  // ── Text editing state ──
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const previewRef = useRef(null);

  // ── Timeline refs ──
  const timelineRef = useRef(null);

  // ── Library state ──
  const [collections, setCollections] = useState([]);
  const [libraryMedia, setLibraryMedia] = useState([]);

  // Derive library audio and video from libraryMedia (memoized to avoid re-render cascades)
  const libraryAudio = useMemo(() => libraryMedia.filter(i => i.type === MEDIA_TYPES.AUDIO), [libraryMedia]);
  const libraryVideos = useMemo(() => libraryMedia.filter(i => i.type === MEDIA_TYPES.VIDEO), [libraryMedia]);

  // ── Audio scope filter (Niche / Project / All) ──
  const [audioScope, setAudioScope] = useState('niche');
  const nicheAudio = useMemo(() => (category?.audio || []), [category?.audio]);
  const projectAudio = useMemo(() => {
    if (!category?.projectId) return [];
    const projectRoot = collections.find(c => c.id === category.projectId && c.isProjectRoot);
    if (!projectRoot?.mediaIds?.length) return [];
    const ids = new Set(projectRoot.mediaIds);
    return libraryMedia.filter(m => m.type === MEDIA_TYPES.AUDIO && ids.has(m.id));
  }, [category?.projectId, collections, libraryMedia]);
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

  // ── Collection dropdown state ──
  const [selectedCollection, setSelectedCollection] = useState('all');

  // Computed: visible videos based on selected collection (matches Montage pattern)
  const visibleVideos = useMemo(() => {
    if (selectedCollection === 'category') return availableVideos.length > 0 ? availableVideos : (category?.videos || []);
    if (selectedCollection === 'all') return libraryVideos;
    const col = collections.find(c => c.id === selectedCollection);
    if (!col?.mediaIds?.length) return [];
    return libraryVideos.filter(v => col.mediaIds.includes(v.id));
  }, [selectedCollection, libraryVideos, collections, category?.videos, availableVideos]);

  // ── Multi-select for clip grid ──
  const {
    selectedIds: selectedClipIds,
    isDragSelecting: clipDragSelecting,
    rubberBand: clipRubberBand,
    gridRef: clipGridRef,
    gridMouseHandlers: clipGridMouseHandlers,
    toggleSelect: toggleClipSelect,
    selectAll: selectAllClips,
    clearSelection: clearClipSelection,
  } = useMediaMultiSelect(visibleVideos);

  // ── Text bank input state ──
  const [newTextA, setNewTextA] = useState('');
  const [newTextB, setNewTextB] = useState('');

  // ── Close confirmation ──
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // ── Word Timeline state ──
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [loadedBankLyricId, setLoadedBankLyricId] = useState(null);

  // ── Lyrics state ──
  const [lyrics, setLyrics] = useState(() => {
    const initialWords = existingVideo?.words || [];
    return initialWords.length > 0 ? initialWords.map(w => w.text).join('\n') : '';
  });
  const [lyricsBank, setLyricsBank] = useState([]);
  const [showLyricBankPicker, setShowLyricBankPicker] = useState(false);

  // ── Audio trimmer state ──
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);

  // ── Transcriber state ──
  const [showTranscriber, setShowTranscriber] = useState(false);

  // ── Video name state ──
  const [videoName, setVideoName] = useState(existingVideo?.name || 'Untitled Solo Clip');

  // ── Collapsible sidebar sections ──
  const { openSections, renderCollapsibleSection } = useCollapsibleSections({
    audio: true, clips: true, text: false, textStyle: (existingVideo?.textOverlays?.length > 0)
  });

  // ── Session persistence ──
  const { loadSession, saveSession, clearSession } = useEditorSessionState(
    artistId, 'solo-clip', existingVideo?.id
  );

  // Restore session on mount
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const session = loadSession();
    if (session?.activeVideoIndex != null) setActiveVideoIndex(session.activeVideoIndex);
  }, [loadSession]);

  // Save session on state changes
  useEffect(() => {
    saveSession({ activeVideoIndex, openSections });
  }, [activeVideoIndex, openSections, saveSession]);

  // ── Preset state ──
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [showPresetPrompt, setShowPresetPrompt] = useState(false);
  const [presetPromptValue, setPresetPromptValue] = useState('');

  // ── Mobile detection ──
  const { isMobile } = useIsMobile();

  // ── Mobile tool tab state ──
  const [mobileToolTab, setMobileToolTab] = useState(null); // 'clips' | 'text' | 'audio' | 'banks' | null

  // ── Library subscriptions ──
  useEffect(() => {
    if (!artistId) return;
    const localCols = getCollections(artistId);
    setCollections(localCols.filter(c => c.type !== 'smart'));
    const localLib = getLibrary(artistId);
    setLibraryMedia(localLib);
    setLyricsBank(getLyrics(artistId));
  }, [artistId]);

  useEffect(() => {
    if (!db || !artistId) return;
    const unsubs = [];
    unsubs.push(subscribeToLibrary(db, artistId, (items) => {
      setLibraryMedia(items);
    }));
    unsubs.push(subscribeToCollections(db, artistId, (cols) => {
      setCollections(cols.filter(c => c.type !== 'smart'));
    }));
    return () => unsubs.forEach(u => u());
  }, [db, artistId]);

  // ── Video Text Banks (uses videoTextBank1/videoTextBank2, NOT textBank1/textBank2) ──
  const getVideoTextBanks = useCallback(() => {
    let videoTextBank1 = [], videoTextBank2 = [];
    // Use niche text banks if available (single source of truth from niche)
    if (nicheTextBanks) {
      const extractTexts = (bank) => (bank || []).map(e => typeof e === 'string' ? e : e?.text || '').filter(Boolean);
      if (nicheTextBanks[0]?.length > 0) videoTextBank1 = [...extractTexts(nicheTextBanks[0])];
      if (nicheTextBanks[1]?.length > 0) videoTextBank2 = [...extractTexts(nicheTextBanks[1])];
    } else {
      // Fallback: merge from all collections when not opened from niche
      for (const col of collections) {
        if (col.videoTextBank1?.length > 0) videoTextBank1 = [...videoTextBank1, ...col.videoTextBank1];
        if (col.videoTextBank2?.length > 0) videoTextBank2 = [...videoTextBank2, ...col.videoTextBank2];
      }
    }
    return { videoTextBank1, videoTextBank2 };
  }, [collections, nicheTextBanks]);

  const handleAddToVideoTextBank = useCallback((bankNum, text) => {
    if (!text.trim() || !artistId || collections.length === 0) return;
    const targetCol = collections[0];
    addToVideoTextBank(artistId, targetCol.id, bankNum, text.trim(), db);
    setCollections(prev => prev.map(col =>
      col.id === targetCol.id
        ? { ...col, [`videoTextBank${bankNum}`]: [...(col[`videoTextBank${bankNum}`] || []), text.trim()] }
        : col
    ));
  }, [artistId, collections, db]);

  const handleRemoveFromVideoTextBank = useCallback((bankNum, index) => {
    if (!artistId || collections.length === 0) return;
    const targetCol = collections[0];
    removeFromVideoTextBank(artistId, targetCol.id, bankNum, index, db);
    setCollections(prev => prev.map(col =>
      col.id === targetCol.id
        ? { ...col, [`videoTextBank${bankNum}`]: (col[`videoTextBank${bankNum}`] || []).filter((_, i) => i !== index) }
        : col
    ));
  }, [artistId, collections]);

  // ── Video playback ──
  const handleVideoLoaded = useCallback(() => {
    if (videoRef.current) {
      setClipDuration(videoRef.current.duration);
    }
  }, []);

  // Timeline duration = max(userMaxDuration, clipDuration, audioDuration)
  const timelineDuration = useMemo(() => {
    const audioDur = selectedAudio && !selectedAudio.isSourceVideo ? audioDuration : 0;
    return Math.max(userMaxDuration, clipDuration || 0, audioDur) || 1;
  }, [userMaxDuration, clipDuration, audioDuration, selectedAudio]);

  // Auto-grow max duration
  const userMaxDurationRef = useRef(userMaxDuration);
  userMaxDurationRef.current = userMaxDuration;
  useEffect(() => {
    const maxContentDur = Math.max(clipDuration || 0, audioDuration || 0);
    if (maxContentDur > userMaxDurationRef.current) {
      setUserMaxDuration(Math.ceil(maxContentDur));
    }
  }, [clipDuration, audioDuration]);

  // Wire shared pixel timeline hook
  const { pxPerSec, timelinePx, rulerTicks, handleRulerMouseDown, formatTime, downsample } = usePixelTimeline({
    timelineScale,
    timelineDuration,
    timelineRef,
    handleSeek: useCallback((time) => {
      if (videoRef.current) {
        videoRef.current.currentTime = time;
        setCurrentTime(time);
      }
      if (audioRef.current) {
        const startBoundary = selectedAudio?.startTime || 0;
        audioRef.current.currentTime = time + startBoundary;
      }
    }, [selectedAudio]),
    isPlaying,
    setIsPlaying,
    setPlayheadDragging,
    wasPlayingRef: wasPlayingBeforePlayheadDrag,
  });

  // Wire pinch-to-zoom on timeline container
  useTimelineZoom(timelineRef, {
    zoom: timelineScale,
    setZoom: setTimelineScale,
    minZoom: 0.3,
    maxZoom: 3,
    basePixelsPerSecond: 40,
  });

  const playbackLoop = useCallback(() => {
    const startBoundary = selectedAudio?.startTime || 0;
    const endBoundary = selectedAudio?.endTime || (audioRef.current?.duration > 0 ? audioRef.current.duration : 0);

    // If audio is longer than video and video ended, track audio time instead
    if (audioRef.current && audioRef.current.src && !audioRef.current.paused && audioRef.current.duration > 0) {
      const videoEnded = videoRef.current ? videoRef.current.ended : true;
      const actualTime = audioRef.current.currentTime;

      // Loop at endBoundary
      if (endBoundary > 0 && actualTime >= endBoundary) {
        audioRef.current.currentTime = startBoundary;
        if (videoRef.current) videoRef.current.currentTime = 0;
      }

      const relTime = actualTime - startBoundary;
      if (videoEnded && relTime > (clipDuration || 0)) {
        setCurrentTime(relTime);
        animationRef.current = requestAnimationFrame(playbackLoop);
        return;
      }
    }
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
    animationRef.current = requestAnimationFrame(playbackLoop);
  }, [clipDuration, selectedAudio]);

  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      if (audioRef.current) audioRef.current.pause();
      cancelAnimationFrame(animationRef.current);
    } else {
      // Always enforce trim start boundary before playing
      const startBoundary = selectedAudio?.startTime || 0;
      if (audioRef.current && audioRef.current.src) {
        if (!isFinite(audioRef.current.currentTime) || audioRef.current.currentTime < startBoundary) {
          audioRef.current.currentTime = startBoundary;
        }
        audioRef.current.play().catch(() => {});
      }
      videoRef.current.play();
      animationRef.current = requestAnimationFrame(playbackLoop);
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, playbackLoop, selectedAudio]);

  // Stable ref for seek during playhead drag (avoids stale closure issues)
  const handleSeek = useCallback((time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
    if (audioRef.current) {
      const startBoundary = selectedAudio?.startTime || 0;
      audioRef.current.currentTime = time + startBoundary;
    }
  }, [selectedAudio]);
  const handleSeekRef = useRef(handleSeek);
  handleSeekRef.current = handleSeek;
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
      const time = Math.max(0, Math.min(1, clickX / pxW)) * timelineDuration;
      handleSeekRef.current(time);
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
  }, [playheadDragging, timelineDuration]);

  // ── Audio selection — just set state, useEffect handles element config ──
  const handleAudioSelect = useCallback((audio) => {
    setSelectedAudio(audio);
    // Auto-mute source video when external audio is added; restore when removed
    const hasExternal = audio && !audio.isSourceVideo;
    setSourceVideoMuted(!!hasExternal);
  }, []);

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
    // Check after a tick whether readyState is sufficient
    const fallback = setTimeout(() => {
      if (el.readyState >= 1 && el.duration > 0) {
        onLoadedMetadata();
      }
    }, 100);

    return () => clearTimeout(fallback);
  }, [selectedAudio]);

  // ── Beat analysis — trigger when audio changes ──
  useEffect(() => {
    if (selectedAudio?.url || selectedAudio?.localUrl) {
      let audioSource = null;
      const localUrl = selectedAudio.localUrl;
      const isBlobUrl = localUrl && localUrl.startsWith('blob:');

      if (selectedAudio.file instanceof File || selectedAudio.file instanceof Blob) {
        audioSource = selectedAudio.file;
      } else if (localUrl && !isBlobUrl) {
        audioSource = localUrl;
      } else if (selectedAudio.url) {
        audioSource = selectedAudio.url;
      }

      if (audioSource) {
        analyzeAudio(audioSource).catch(err => {
          log.error('Beat analysis failed:', err);
        });
      }
    }
  }, [selectedAudio, analyzeAudio]);

  // ── Audio trim save handler ──
  const handleAudioTrimSave = useCallback(({ startTime, endTime, duration: trimDuration, trimmedFile, trimmedName }) => {
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
        duration: trimDuration
      });
    } else {
      handleAudioSelect({
        ...audioToTrim,
        startTime,
        endTime,
        trimmedDuration: endTime - startTime,
        isTrimmed: startTime > 0 || (audioToTrim.duration && Math.abs(endTime - audioToTrim.duration) > 0.1)
      });
    }
    setShowAudioTrimmer(false);
    setAudioToTrim(null);
  }, [audioToTrim, handleAudioSelect]);

  const handleAudioSaveClip = useCallback(async (clipData) => {
    if (!selectedAudio || !artistId) return;
    const savedClip = {
      id: `audio_clip_${Date.now()}`,
      type: MEDIA_TYPES.AUDIO,
      name: clipData.name,
      url: selectedAudio.url || selectedAudio.localUrl,
      localUrl: selectedAudio.localUrl || selectedAudio.url,
      duration: clipData.clipDuration,
      startTime: clipData.startTime,
      endTime: clipData.endTime
    };
    await addToLibraryAsync(db, artistId, savedClip);
    setLibraryMedia(getLibrary(artistId));
    toastSuccess(`Saved clip "${clipData.name}" to library`);
  }, [selectedAudio, artistId, toastSuccess]);

  // ── Preset handler ──
  const handleApplyPreset = useCallback((preset) => {
    setSelectedPreset(preset);
    if (preset.settings) {
      setTextStyle(prev => ({ ...prev, ...preset.settings }));
      if (preset.settings.cropMode) setAspectRatio(preset.settings.cropMode);
    }
  }, []);

  // ── Text overlay CRUD ──
  const getDefaultTextStyle = useCallback(() => ({
    fontSize: textStyle.fontSize,
    fontFamily: textStyle.fontFamily,
    fontWeight: textStyle.fontWeight,
    color: textStyle.color,
    outline: textStyle.outline,
    outlineColor: textStyle.outlineColor,
    textStroke: textStyle.textStroke,
    textAlign: textStyle.textAlign,
    textCase: textStyle.textCase
  }), [textStyle]);

  // Propagate global style changes to all existing overlays
  const applyStyleToAll = useCallback((styleUpdates) => {
    setTextOverlays(prev => prev.map(o => ({
      ...o,
      style: { ...o.style, ...styleUpdates }
    })));
  }, [setTextOverlays]);

  // Wrapper: update global textStyle AND propagate to all overlays
  const updateGlobalStyle = useCallback((updater) => {
    setTextStyle(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      // Extract only the changed fields for overlay propagation
      const diff = {};
      for (const key of Object.keys(next)) {
        if (next[key] !== prev[key]) diff[key] = next[key];
      }
      if (Object.keys(diff).length > 0) {
        // Schedule overlay update after state commit
        setTimeout(() => applyStyleToAll(diff), 0);
      }
      return next;
    });
  }, [applyStyleToAll]);

  // ── Transcript lines state (line-level data from LRC for WordTimeline) ──
  const [transcriptLines, setTranscriptLines] = useState([]);

  // ── AI Transcription handler — stores words + opens WordTimeline ──
  const handleTranscriptionComplete = useCallback((result) => {
    if (!result?.words?.length) {
      toastError('No words detected in transcription.');
      setShowTranscriber(false);
      return;
    }
    const dur = clipDuration || 30;
    // Store words for WordTimeline
    setWords(result.words.map((w, i) => ({
      id: `word_${Date.now()}_${i}`,
      text: w.text,
      startTime: Math.min(w.startTime || 0, dur),
      duration: w.duration || 0.5
    })));
    // Store lines if available (from LRC pipeline)
    if (result.lines?.length) {
      setTranscriptLines(result.lines);
    }
    setShowTranscriber(false);
    // Open WordTimeline so user can choose text cell mode
    setShowWordTimeline(true);
  }, [clipDuration, setWords, toastError]);

  // ── Cut by word — opens WordTimeline for text cell mode selection ──
  const handleCutByWord = useCallback(() => {
    if (!words.length) {
      toastError('No words to cut by. Add lyrics first.');
      return;
    }
    setShowWordTimeline(true);
  }, [words, toastError]);

  // ── Cut by beat — opens BeatSelector modal ──
  const handleCutByBeat = useCallback(() => {
    if (!filteredBeats.length) {
      toastError('No beats detected. Try a different audio track or check the trim range.');
      return;
    }
    setShowBeatSelector(true);
  }, [filteredBeats, toastError]);

  // ── Apply selected beats — creates text overlays at beat boundaries ──
  const handleBeatSelectionApply = useCallback((selectedBeatTimes) => {
    if (!selectedBeatTimes.length) {
      setShowBeatSelector(false);
      return;
    }

    const effectiveDuration = (selectedAudio?.endTime || selectedAudio?.duration || audioDuration) - (selectedAudio?.startTime || 0);
    const newOverlays = [];

    for (let i = 0; i < selectedBeatTimes.length; i++) {
      const startTime = selectedBeatTimes[i];
      const endTime = selectedBeatTimes[i + 1] || effectiveDuration;

      // Use word text if available, otherwise numbered beat markers
      const text = words[i % words.length]?.text || `Beat ${i + 1}`;

      newOverlays.push({
        id: `text_${Date.now()}_${i}`,
        text,
        style: getDefaultTextStyle(),
        position: { x: 50, y: 50, width: 80, height: 20 },
        startTime,
        endTime
      });
    }

    setTextOverlays(newOverlays);
    setShowBeatSelector(false);
    toastSuccess(`Created ${newOverlays.length} text overlays from beats`);
  }, [words, audioDuration, selectedAudio, getDefaultTextStyle, setTextOverlays, toastSuccess]);

  useEffect(() => {
    const hasLibraryAudio = selectedAudio && !selectedAudio.isSourceVideo;
    if (videoRef.current) {
      // Mute source video if: global mute OR (external audio present AND source toggle is muted)
      videoRef.current.muted = isMuted || (hasLibraryAudio && sourceVideoMuted);
      videoRef.current.volume = sourceVideoVolume;
    }
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
      audioRef.current.volume = externalAudioVolume;
    }
  }, [isMuted, selectedAudio, sourceVideoMuted, sourceVideoVolume, externalAudioVolume]);

  // Get clip URL safely (must be before useWaveform which references it)
  const getClipUrl = useCallback((clipObj) => {
    if (!clipObj) return null;
    const localUrl = clipObj.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    return isBlobUrl ? clipObj.url : (localUrl || clipObj.url || clipObj.src);
  }, []);

  // Stable clips array for useWaveform — avoids new array ref every render
  const waveformClips = useMemo(() => clip ? [clip] : [], [clip]);

  // Waveform data via shared hook
  const { waveformData, clipWaveforms, waveformSource } = useWaveform({
    selectedAudio,
    clips: waveformClips,
    getClipUrl
  });

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const addTextOverlay = useCallback((prefillText) => {
    const dur = timelineDuration || 30;
    const newOverlay = {
      id: `text_${Date.now()}`,
      text: prefillText || 'Click to edit',
      style: getDefaultTextStyle(),
      position: { x: 50, y: 50, width: 80 },
      startTime: 0,
      endTime: dur,
    };
    setTextOverlays(prev => [...prev, newOverlay]);
    setEditingTextId(newOverlay.id);
    setEditingTextValue(newOverlay.text);
  }, [getDefaultTextStyle, setTextOverlays, timelineDuration]);

  // Add lyrics as timed word overlays (one per word, evenly spread across clip)
  const addLyricsAsTimedOverlays = useCallback((lyricsText) => {
    const words = lyricsText.split(/\s+/).filter(w => w.trim().length > 0);
    if (!words.length) return;

    const dur = clipDuration || 13; // fallback to reasonable default
    const wordDuration = dur / words.length;
    const timestamp = Date.now();

    const newOverlays = words.map((word, i) => ({
      id: `text_${timestamp}_${i}`,
      text: word,
      style: getDefaultTextStyle(),
      position: { x: 50, y: 50, width: 80, height: 20 },
      startTime: i * wordDuration,
      endTime: (i + 1) * wordDuration
    }));

    setTextOverlays(newOverlays);
    toastSuccess(`Created ${newOverlays.length} timed word overlays`);
  }, [clipDuration, getDefaultTextStyle, setTextOverlays, toastSuccess]);

  // ── Reroll: always swap clip AND randomize text overlays ──
  const handleReroll = useCallback(() => {
    // Reroll media
    const rerollPool = visibleVideos.length > 0 ? visibleVideos : availableVideos;
    if (rerollPool.length > 0) {
      const available = rerollPool.filter(v => v.id !== clip?.id);
      if (available.length > 0) {
        const randomClip = available[Math.floor(Math.random() * available.length)];
        setClip(randomClip);
      }
    }
    // Reroll text overlays
    const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();
    const allBankTexts = [...videoTextBank1, ...videoTextBank2].filter(Boolean);
    if (allBankTexts.length > 0 && textOverlays.length > 0) {
      setTextOverlays(prev => prev.map(o => {
        const others = allBankTexts.filter(t => t !== o.text);
        const pool = others.length > 0 ? others : allBankTexts;
        return { ...o, text: pool[Math.floor(Math.random() * pool.length)] };
      }));
    }
    toastSuccess('Rerolled');
  }, [textOverlays, getVideoTextBanks, setTextOverlays, visibleVideos, availableVideos, clip, setClip, toastSuccess]);

  // ── Audio upload handler — route through trimmer ──
  const handleAudioUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    const uploadedAudio = {
      id: `upload_${Date.now()}`,
      name: file.name,
      file,
      url: localUrl,
      localUrl
    };
    setAudioToTrim(uploadedAudio);
    setShowAudioTrimmer(true);
    if (audioFileInputRef.current) audioFileInputRef.current.value = '';
  }, []);

  const updateTextOverlay = useCallback((overlayId, updates) => {
    setTextOverlays(prev => prev.map(o =>
      o.id === overlayId ? { ...o, ...updates } : o
    ));
  }, [setTextOverlays]);

  const removeTextOverlay = useCallback((overlayId) => {
    setTextOverlays(prev => prev.filter(o => o.id !== overlayId));
    if (editingTextId === overlayId) {
      setEditingTextId(null);
      setEditingTextValue('');
    }
  }, [setTextOverlays, editingTextId]);

  // Text overlay drag is handled by DraggableTextOverlay component

  // ── Switch between videos ──
  const switchToVideo = useCallback((index) => {
    if (index === activeVideoIndex) return;
    if (videoRef.current) {
      videoRef.current.pause();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    if (audioRef.current) audioRef.current.pause();
    setIsPlaying(false);
    setCurrentTime(0);
    setEditingTextId(null);
    setEditingTextValue('');
    setActiveVideoIndex(index);
  }, [activeVideoIndex]);

  // Timeline text drag removed — text overlays now use DraggableTextOverlay on preview

  // ── Delete generated video ──
  const handleDeleteVideo = useCallback((index) => {
    if (index === 0) return;
    setAllVideos(prev => prev.filter((_, i) => i !== index));
    if (activeVideoIndex === index) {
      setActiveVideoIndex(Math.max(0, index - 1));
    } else if (activeVideoIndex > index) {
      setActiveVideoIndex(prev => prev - 1);
    }
  }, [activeVideoIndex]);

  // ── Generation (uses video text banks) ──
  const executeGeneration = useCallback(() => {
    const template = allVideos[0];
    if (!template?.clip) {
      toastError('No clip loaded. Add a clip first.');
      return;
    }
    const availableClips = availableVideos.filter(v => v.id !== template.clip.id);
    if (availableClips.length === 0) {
      toastError('Need more than one clip to generate.');
      return;
    }

    setIsGenerating(true);

    try {
      const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();
      const combinedBank = [...videoTextBank1, ...videoTextBank2];
      const existingGenCount = allVideos.filter(v => !v.isTemplate).length;
      const timestamp = Date.now();
      const generated = [];
      // Shuffle clips randomly
      const shuffled = [...availableClips].sort(() => Math.random() - 0.5);
      const clipsToUse = shuffled.slice(0, generateCount);

      for (let i = 0; i < clipsToUse.length; i++) {
        const clipItem = clipsToUse[i];

        const newOverlays = template.textOverlays.map((overlay, idx) => {
          let newText = overlay.text;
          if (keepTemplateText === 'none') {
            const bank = idx === 0 ? videoTextBank1 : idx === 1 ? videoTextBank2 : combinedBank;
            if (bank.length > 0) {
              newText = bank[i % bank.length];
            }
          }
          return {
            ...overlay,
            id: `text_${timestamp}_${i}_${idx}`,
            text: newText
          };
        });

        generated.push({
          id: `video_${timestamp}_${i}`,
          name: `Generated ${existingGenCount + i + 1}`,
          clip: clipItem,
          textOverlays: newOverlays,
          isTemplate: false
        });
      }

      setAllVideos(prev => [...prev, ...generated]);
      setActiveVideoIndex(allVideos.length);
      toastSuccess(`Generated ${generated.length} video${generated.length !== 1 ? 's' : ''}!`);
    } finally {
      setIsGenerating(false);
    }
  }, [allVideos, generateCount, category, getVideoTextBanks, keepTemplateText, toastSuccess, toastError]);

  // Auto-generate on mount when coming from niche preview (Create N flow)
  const autoGenTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoGenTriggeredRef.current || !nicheGenCount) return;
    if (availableVideos.length < 2) return;
    const template = allVideos[0];
    // Auto-populate template with first clip if empty (niche videos load via draft)
    if (!template?.clip) {
      setAllVideos(prev => {
        const copy = [...prev];
        copy[0] = { ...copy[0], clip: availableVideos[0] };
        return copy;
      });
      return; // Re-render will trigger this effect again with clip populated
    }
    autoGenTriggeredRef.current = true;
    executeGeneration();
  }, [nicheGenCount, allVideos, category, executeGeneration]);

  // ── Save Draft (active video only) ──
  const handleSaveDraft = useCallback(() => {
    const video = allVideos[activeVideoIndex];
    if (!video?.clip) {
      toastError('No clip to save.');
      return;
    }
    const clipUrl = video.clip.url || video.clip.localUrl || video.clip.src;
    const videoData = {
      id: video.id === 'template' ? (existingVideo?.id || `solovideo_${Date.now()}`) : video.id,
      editorMode: 'solo-clip',
      name: video.name || 'Solo Clip',
      clips: [{
        id: `clip_${Date.now()}_0`,
        sourceId: video.clip.id,
        url: clipUrl,
        localUrl: video.clip.localUrl || clipUrl,
        thumbnail: video.clip.thumbnailUrl || video.clip.thumbnail,
        startTime: 0,
        duration: clipDuration || 5,
        locked: true
      }],
      textOverlays: video.textOverlays,
      words: video.words || [],
      audio: selectedAudio,
      cropMode: aspectRatio,
      duration: clipDuration || 5,
      thumbnail: video.clip.thumbnailUrl || video.clip.thumbnail,
      isTemplate: video.isTemplate,
      status: 'draft',
      createdAt: existingVideo?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Audio mixing state
      sourceVideoMuted,
      sourceVideoVolume,
      externalAudioVolume,
      maxDuration: userMaxDuration
    };
    onSave(videoData);
    setLastSaved(new Date());
    toastSuccess(`Saved "${video.name || 'Solo Clip'}"`);
  }, [allVideos, activeVideoIndex, clipDuration, aspectRatio, selectedAudio, existingVideo, sourceVideoMuted, sourceVideoVolume, externalAudioVolume, userMaxDuration, onSave, toastSuccess, toastError]);

  // ── Save All & Close ──
  const handleSaveAllAndClose = useCallback(async () => {
    if (isSavingAll) return;
    setIsSavingAll(true);
    let savedCount = 0;
    for (const video of allVideos) {
      if (!video.clip) continue;
      const clipUrl = video.clip.url || video.clip.localUrl || video.clip.src;
      const videoData = {
        id: video.id === 'template' ? (existingVideo?.id || `solovideo_${Date.now()}_${savedCount}`) : video.id,
        editorMode: 'solo-clip',
        name: video.name || 'Solo Clip',
        clips: [{
          id: `clip_${Date.now()}_${savedCount}`,
          sourceId: video.clip.id,
          url: clipUrl,
          localUrl: video.clip.localUrl || clipUrl,
          thumbnail: video.clip.thumbnailUrl || video.clip.thumbnail,
          startTime: 0,
          duration: clipDuration || 5,
          locked: true
        }],
        textOverlays: video.textOverlays,
        words: video.words || [],
        audio: selectedAudio,
        cropMode: aspectRatio,
        duration: clipDuration || 5,
        thumbnail: video.clip.thumbnailUrl || video.clip.thumbnail,
        isTemplate: video.isTemplate,
        status: 'draft',
        createdAt: existingVideo?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Audio mixing state
        sourceVideoMuted,
        sourceVideoVolume,
        externalAudioVolume,
        maxDuration: userMaxDuration
      };
      try {
        await onSave(videoData);
      } catch (err) {
        log.error(`[SoloClipEditor] Failed to save video ${savedCount}:`, err);
        toastError(`Failed to save "${video.name || 'Solo Clip'}". Please try again.`);
        setIsSavingAll(false);
        return; // Stop on failure so user doesn't lose context
      }
      savedCount++;
    }
    setIsSavingAll(false);
    toastSuccess(`Saved ${savedCount} video${savedCount !== 1 ? 's' : ''}!`);
    onClose();
  }, [allVideos, clipDuration, aspectRatio, selectedAudio, existingVideo, sourceVideoMuted, sourceVideoVolume, externalAudioVolume, userMaxDuration, onSave, onClose, toastSuccess, toastError, isSavingAll]);

  // Export removed — was identical to Save Draft but set status='rendered' without actually rendering.
  // Real video export (FFmpeg render + download) will be added as a future feature.

  // ── Unsaved changes guard (beforeunload) ──
  const hasUnsavedWork = textOverlays.length > 0 || allVideos.length > 1;
  useUnsavedChanges(hasUnsavedWork);

  // ── Close with confirmation ──
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
      if (e.code === 'Escape') {
        e.preventDefault();
        handleCloseRequest();
      }
      if (e.code === 'Space' && !editingTextId) {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseRequest, handlePlayPause, editingTextId]);

  // Currently editing overlay
  const editingOverlay = textOverlays.find(o => o.id === editingTextId);

  // Canvas is ALWAYS 9:16 — aspect ratio only controls how media is cropped within it
  const previewDims = { width: 270, height: 480 };

  // Compute video style based on crop mode (aspect ratio)
  const getVideoCropStyle = () => {
    // 9:16 = fill the canvas (default, no crop needed)
    if (aspectRatio === '9:16') {
      return { width: '100%', height: '100%', objectFit: 'cover' };
    }
    // 1:1 = square crop centered in the 9:16 canvas
    if (aspectRatio === '1:1') {
      return {
        width: '100%',
        height: 'auto',
        aspectRatio: '1 / 1',
        objectFit: 'cover',
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        maxWidth: '100%'
      };
    }
    // 4:3 = landscape crop centered in the 9:16 canvas
    if (aspectRatio === '4:3') {
      return {
        width: '100%',
        height: 'auto',
        aspectRatio: '4 / 3',
        objectFit: 'cover',
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        maxWidth: '100%'
      };
    }
    return { width: '100%', height: '100%', objectFit: 'cover' };
  };

  // formatTime provided by usePixelTimeline hook

  // Video text banks for left panel
  const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();

  // ── RENDER ──
  return (
    <EditorShell onBackdropClick={handleCloseRequest} isMobile={isMobile}>
        <EditorTopBar
          title={videoName}
          onTitleChange={setVideoName}
          placeholder="Untitled Solo Clip"
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onSave={handleSaveDraft}
          onExport={handleSaveDraft}
          onBack={handleCloseRequest}
          isMobile={isMobile}
        />

        {/* ═══ MAIN CONTENT ═══ */}
        <div className={`flex grow basis-0 min-h-0 self-stretch overflow-hidden ${isMobile ? 'flex-col overflow-auto' : ''}`}>

          {/* LEFT: Preview + Controls */}
          <div className="flex grow basis-0 min-h-0 flex-col items-center bg-black overflow-hidden">
            <div className="flex w-full max-w-[448px] grow flex-col items-center gap-4 py-6 px-4 overflow-auto">
              {/* Video Preview */}
              <div
                ref={previewRef}
                className="flex items-center justify-center rounded-lg bg-[#1a1a1aff] border border-neutral-200 relative overflow-hidden"
                style={{ aspectRatio: '9/16', height: '50vh' }}
                onPointerDown={(e) => { if (e.target === e.currentTarget || e.target.tagName === 'VIDEO') setEditingTextId(null); }}
              >
                {clip ? (
                  <video
                    ref={videoRef}
                    src={getClipUrl(clip)}
                    onLoadedMetadata={handleVideoLoaded}
                    onEnded={() => {
                      if (audioRef.current && audioRef.current.src && !audioRef.current.paused && audioRef.current.duration > clipDuration) return;
                      setIsPlaying(false);
                      if (animationRef.current) cancelAnimationFrame(animationRef.current);
                    }}
                    loop={false}
                    playsInline
                    style={{ ...getVideoCropStyle(), borderRadius: '8px' }}
                    crossOrigin="anonymous"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M10 9l5 3-5 3V9z" />
                    </svg>
                    <p className="text-neutral-500 mt-2 text-[12px]">No clip selected</p>
                  </div>
                )}

                {/* Text Overlays on video — DraggableTextOverlay handles drag/edit */}
                {textOverlays.filter(o => currentTime >= (o.startTime ?? 0) && currentTime <= (o.endTime ?? timelineDuration)).map((overlay) => (
                  <DraggableTextOverlay
                    key={overlay.id}
                    text={overlay.text}
                    textStyle={overlay.style || textStyle}
                    color={editingTextId === overlay.id ? '#6366f1' : '#6366f180'}
                    isSelected={editingTextId === overlay.id}
                    onSelect={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}
                    position={overlay.position || { x: 50, y: 50, width: 80 }}
                    onPositionChange={(newPos) => updateTextOverlay(overlay.id, { position: newPos })}
                    onTextChange={(newText) => updateTextOverlay(overlay.id, { text: newText })}
                    containerRef={previewRef}
                  />
                ))}
              </div>

              {/* Reroll */}
              {(visibleVideos.length > 0 || availableVideos.length > 1) && (
                <Button variant="neutral-tertiary" size="medium" icon={<FeatherRefreshCw />} onClick={handleReroll}>Re-roll</Button>
              )}

              {/* Generation Controls */}
              <div className="flex items-center gap-2">
                <Button variant="brand-primary" size="medium" icon={<FeatherPlus />} onClick={executeGeneration} disabled={isGenerating}>
                  {isGenerating ? 'Creating...' : 'Create'}
                </Button>
                <input
                  type="number" min={1} max={50} value={generateCount}
                  onChange={(e) => setGenerateCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="w-16 px-2 py-1.5 rounded-md border border-neutral-200 bg-[#1a1a1aff] text-[#ffffffff] text-[12px] text-center outline-none"
                />
              </div>

            </div>

            {/* ── MOBILE TOOL TOOLBAR ── */}
            {isMobile && (
              <div className="flex justify-around items-center border-t border-b border-neutral-200 bg-[#0a0a0aff] flex-shrink-0 py-1">
                {[
                  { id: 'clips', label: 'Clips', icon: '\uD83C\uDFAC' },
                  { id: 'text', label: 'Text', icon: '\uD83D\uDCDD' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setMobileToolTab(mobileToolTab === tab.id ? null : tab.id)}
                    className={`flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] px-3 py-1.5 rounded-lg border-none cursor-pointer transition-all ${mobileToolTab === tab.id ? 'bg-brand-600/20 text-brand-400' : 'bg-transparent text-neutral-400'}`}
                  >
                    <span style={{ fontSize: '16px' }}>{tab.icon}</span>
                    <span style={{ fontSize: '10px' }}>{tab.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* ── MOBILE TOOL PANEL ── */}
            {isMobile && mobileToolTab && (
              <div className="flex-1 overflow-auto bg-[#1a1a1aff] border-t border-neutral-200 min-h-0">
                {mobileToolTab === 'clips' && (
                  <div className="p-3">
                    <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)}
                      className="w-full px-3 py-2 bg-[#0a0a0aff] border border-neutral-200 rounded-lg text-[#ffffffff] text-[13px] outline-none cursor-pointer mb-2 min-h-[44px]">
                      <option value="category">Selected Clips</option>
                      <option value="all">All Videos (Library)</option>
                      {collections.filter(c => !category?.projectId || c.projectId === category.projectId).map(col => (<option key={col.id} value={col.id}>{col.name}</option>))}
                    </select>
                    <div className="grid grid-cols-3 gap-2">
                      {visibleVideos.map((video, i) => (
                        <div key={video.id || i} onClick={() => setClip(video)}
                          className={`cursor-pointer p-1 rounded-md border-2 min-h-[44px] ${clip?.id === video.id ? 'border-brand-600' : 'border-transparent'}`}>
                          <div className="w-full aspect-video rounded overflow-hidden bg-[#0a0a0aff]">
                            {(video.thumbnailUrl || video.thumbnail) ? (
                              <img src={video.thumbnailUrl || video.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (<div className="w-full h-full flex items-center justify-center text-xl">🎬</div>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mobileToolTab === 'text' && (
                  <div className="p-3">
                    {textOverlays.map((overlay, idx) => (
                      <div key={overlay.id} onClick={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}
                        className={`mb-1.5 p-2.5 rounded-lg cursor-pointer ${editingTextId === overlay.id ? 'bg-brand-600/10 border border-brand-600/30' : 'bg-neutral-100/50 border border-neutral-200'}`}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[11px] text-neutral-400">Overlay {idx + 1}</span>
                          <IconButton icon={<FeatherX />} aria-label="Remove overlay" onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }} />
                        </div>
                        <div className="text-[13px] text-[#ffffffff]">{overlay.text}</div>
                      </div>
                    ))}
                    <Button variant="brand-secondary" size="small" icon={<FeatherPlus />} onClick={() => addTextOverlay()}>Add Text</Button>
                  </div>
                )}
              </div>
            )}

            {/* ═══ PIXEL TIMELINE (unified scroll layout) ═══ */}
            {(() => {
              const hasAudioTrack = !!(selectedAudio && !selectedAudio.isSourceVideo && waveformData.length > 0);
              const sourceData = clip ? (clipWaveforms[clip.id || clip.sourceId] || []) : [];
              const hasSourceTrack = sourceData.length > 0;
              const playheadPercent = timelineDuration > 0 ? (currentTime / timelineDuration) * 100 : 0;
              const audioTrackH = hasAudioTrack ? Math.round(4 + 28 * externalAudioVolume) : 0;
              const srcVol = sourceVideoMuted ? 0 : sourceVideoVolume;
              const sourceTrackH = hasSourceTrack ? Math.round(4 + 28 * srcVol) : 0;
              const trimmedDuration = selectedAudio
                ? ((selectedAudio.endTime || selectedAudio.duration || audioDuration) - (selectedAudio.startTime || 0))
                : 0;
              const sourceWaveformBars = hasSourceTrack ? (() => {
                const clipDur = clipDuration || 1;
                const segPx = clipDur * pxPerSec;
                const maxBars = Math.max(10, Math.round(segPx / 3));
                return downsample(sourceData, maxBars);
              })() : [];
              return (
              <div className="flex w-full flex-col border-t border-neutral-200 bg-[#1a1a1aff] px-4 py-3 flex-shrink-0">
                {/* Timeline header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Timeline</span>
                    <Button variant="neutral-secondary" size="small" onClick={handleCutByWord}>Cut by word</Button>
                    <Button variant="neutral-secondary" size="small" onClick={handleCutByBeat}>Cut by beat</Button>
                    <Badge variant="neutral">
                      {isAnalyzing ? 'Analyzing beats...' : bpm ? `${Math.round(bpm)} BPM (${filteredBeats.length} beats)` : 'No beats detected'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-neutral-500">Max</span>
                    <input type="number" min={1} max={300} step={1} value={userMaxDuration}
                      onChange={(e) => setUserMaxDuration(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-14 px-1.5 py-0.5 rounded border border-neutral-200 bg-black text-[#ffffffff] text-[11px] text-center outline-none"
                      title="Max timeline duration (seconds)"
                      disabled={!!(selectedAudio && !selectedAudio.isSourceVideo)}
                    />
                    <span className="text-[10px] text-neutral-500">s</span>
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
                        {video.isTemplate ? 'Template' : (
                          <>
                            #{idx}
                            <span onClick={(e) => { e.stopPropagation(); handleDeleteVideo(idx); }} className="ml-0.5 opacity-50 hover:opacity-100 cursor-pointer text-[10px]">x</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Volume controls row */}
                {(hasAudioTrack || hasSourceTrack) && (
                  <div className="flex items-center gap-3 mb-2">
                    {hasAudioTrack && (
                      <div className="flex items-center gap-1.5">
                        <FeatherMusic style={{ width: 10, height: 10, color: '#22c55e' }} />
                        <span className="text-[10px] text-green-400 w-8">Audio</span>
                        <input type="range" min="0" max="1" step="0.05" value={externalAudioVolume}
                          onChange={e => setExternalAudioVolume(parseFloat(e.target.value))}
                          style={{ width: '64px', height: '4px', accentColor: '#22c55e', cursor: 'pointer' }}
                          title={`Audio: ${Math.round(externalAudioVolume * 100)}%`}
                        />
                        <span className="text-[10px] text-neutral-500 w-8">{Math.round(externalAudioVolume * 100)}%</span>
                      </div>
                    )}
                    {hasSourceTrack && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setSourceVideoMuted(m => !m)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '10px', opacity: sourceVideoMuted ? 0.4 : 1 }}
                          title={sourceVideoMuted ? 'Unmute source audio' : 'Mute source audio'}
                        >{sourceVideoMuted ? '\uD83D\uDD07' : '\uD83C\uDFAC'}</button>
                        <span className="text-[10px] text-amber-400 w-10">Source</span>
                        <input type="range" min="0" max="1" step="0.05"
                          value={sourceVideoMuted ? 0 : sourceVideoVolume}
                          onChange={e => { setSourceVideoVolume(parseFloat(e.target.value)); if (sourceVideoMuted) setSourceVideoMuted(false); }}
                          style={{ width: '64px', height: '4px', accentColor: '#f59e0b', cursor: 'pointer' }}
                          title={sourceVideoMuted ? 'Muted' : `Source: ${Math.round(sourceVideoVolume * 100)}%`}
                        />
                        <span className="text-[10px] text-neutral-500 w-8">{sourceVideoMuted ? 'Off' : `${Math.round(sourceVideoVolume * 100)}%`}</span>
                      </div>
                    )}
                    {/* Zoom controls — right-aligned */}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <FeatherZoomOut style={{ width: 12, height: 12, color: '#737373' }} />
                      <input type="range" min="0.3" max="3" step="0.05" value={timelineScale}
                        onChange={e => setTimelineScale(parseFloat(e.target.value))}
                        style={{ width: '80px', height: '4px', accentColor: '#6366f1', cursor: 'pointer' }}
                        title={`Zoom: ${Math.round(timelineScale * 100)}%`}
                      />
                      <FeatherZoomIn style={{ width: 12, height: 12, color: '#737373' }} />
                    </div>
                  </div>
                )}
                {/* Zoom controls when no audio tracks */}
                {!hasAudioTrack && !hasSourceTrack && (
                  <div className="flex items-center gap-1.5 mb-2 justify-end">
                    <FeatherZoomOut style={{ width: 12, height: 12, color: '#737373' }} />
                    <input type="range" min="0.3" max="3" step="0.05" value={timelineScale}
                      onChange={e => setTimelineScale(parseFloat(e.target.value))}
                      style={{ width: '80px', height: '4px', accentColor: '#6366f1', cursor: 'pointer' }}
                      title={`Zoom: ${Math.round(timelineScale * 100)}%`}
                    />
                    <FeatherZoomIn style={{ width: 12, height: 12, color: '#737373' }} />
                  </div>
                )}

                {/* ═══ UNIFIED TIMELINE: labels column + single scrollable area ═══ */}
                <div className="flex w-full items-start gap-3">
                  {/* Fixed labels column */}
                  <div className="w-20 flex flex-col shrink-0">
                    <div style={{ height: '24px' }} className="flex items-center justify-end pr-1">
                      <span className="text-[10px] text-neutral-600">Time</span>
                    </div>
                    {textOverlays.length > 0 && (
                      <div style={{ height: `${Math.max(24, textOverlays.length * 24)}px` }} className="flex items-center justify-end pr-1">
                        <span className="text-caption font-caption text-neutral-400">Text</span>
                      </div>
                    )}
                    <div style={{ height: '40px' }} className="flex items-center justify-end pr-1">
                      <span className="text-caption font-caption text-neutral-400">Clip</span>
                    </div>
                    {hasAudioTrack && (
                      <div style={{ height: `${audioTrackH}px`, transition: 'height 0.15s ease-out' }} className="flex items-center justify-end pr-1">
                        {audioTrackH >= 16 && <span className="text-caption font-caption text-neutral-400">Audio</span>}
                      </div>
                    )}
                    {hasSourceTrack && (
                      <div style={{ height: `${sourceTrackH}px`, transition: 'height 0.15s ease-out' }} className="flex items-center justify-end pr-1">
                        {sourceTrackH >= 16 && <span className="text-caption font-caption text-neutral-400">Source</span>}
                      </div>
                    )}
                  </div>

                  {/* Single scrollable column */}
                  <div className="flex-1 rounded-md border border-neutral-200 bg-black overflow-x-auto" ref={timelineRef}>
                    <div style={{ position: 'relative', minWidth: '100%', width: `${timelinePx}px` }}>
                      {/* Playhead line — spans all tracks */}
                      {timelineDuration > 0 && (
                        <div style={{
                          position: 'absolute', left: `${playheadPercent}%`, top: 0, bottom: 0, width: '2px',
                          background: '#ef4444', zIndex: 20, pointerEvents: 'none',
                          boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)',
                          transition: isPlaying ? 'none' : 'left 0.1s ease-out'
                        }}>
                          <div style={{
                            position: 'absolute', top: '16px', left: '-5px',
                            width: 0, height: 0,
                            borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
                            borderTop: '8px solid #ef4444'
                          }} />
                        </div>
                      )}

                      {/* Ruler row — click/drag to seek */}
                      <div style={{ height: '24px', position: 'relative', cursor: 'crosshair', borderBottom: '1px solid #333' }}
                        onMouseDown={handleRulerMouseDown}
                      >
                        {rulerTicks.map((tick, i) => {
                          const xPx = tick.time * pxPerSec;
                          return (
                            <div key={i} style={{ position: 'absolute', left: `${xPx}px`, top: 0, bottom: 0 }}>
                              <div style={{
                                width: '1px', height: tick.isLabel ? '10px' : '6px',
                                backgroundColor: tick.isLabel ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
                                position: 'absolute', bottom: 0
                              }} />
                              {tick.isLabel && (
                                <span style={{
                                  position: 'absolute', top: '1px', left: '3px',
                                  fontSize: '9px', color: 'rgba(255,255,255,0.45)',
                                  whiteSpace: 'nowrap', userSelect: 'none'
                                }}>
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
                              <div key={overlay.id} style={{ height: '24px', position: 'relative' }}>
                                <div
                                  style={{
                                    position: 'absolute', left: `${leftPx}px`, width: `${widthPx}px`, top: 2, bottom: 2,
                                    backgroundColor: isSelected ? 'rgba(99,102,241,0.4)' : 'rgba(99,102,241,0.2)',
                                    border: `1px solid ${overlayColor}`,
                                    borderRadius: '4px', cursor: 'pointer', overflow: 'hidden',
                                    display: 'flex', alignItems: 'center', paddingLeft: '6px',
                                  }}
                                  onClick={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}
                                >
                                  <span style={{ fontSize: '9px', color: '#c7d2fe', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'none' }}>
                                    {overlay.text}
                                  </span>
                                  {/* Left resize handle */}
                                  <div
                                    style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'col-resize', zIndex: 3 }}
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      const startX = e.clientX;
                                      const origStart = start;
                                      const move = (me) => {
                                        const dx = (me.clientX - startX) / pxPerSec;
                                        const newStart = Math.max(0, Math.min(end - 0.5, origStart + dx));
                                        updateTextOverlay(overlay.id, { startTime: newStart });
                                      };
                                      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
                                      document.addEventListener('pointermove', move);
                                      document.addEventListener('pointerup', up);
                                      document.addEventListener('pointercancel', up);
                                    }}
                                  />
                                  {/* Right resize handle */}
                                  <div
                                    style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'col-resize', zIndex: 3 }}
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      const startX = e.clientX;
                                      const origEnd = end;
                                      const move = (me) => {
                                        const dx = (me.clientX - startX) / pxPerSec;
                                        const newEnd = Math.max(start + 0.5, Math.min(timelineDuration, origEnd + dx));
                                        updateTextOverlay(overlay.id, { endTime: newEnd });
                                      };
                                      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
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

                      {/* Clip row — single clip spanning its duration */}
                      <div style={{ height: '40px', position: 'relative', borderBottom: '1px solid #222' }}>
                        {clip ? (
                          <div style={{
                            position: 'relative', height: '40px', backgroundColor: '#8b5cf6',
                            borderRadius: '6px', overflow: 'hidden',
                            boxSizing: 'border-box', width: `${Math.max(50, (clipDuration || 1) * pxPerSec)}px`, minWidth: '50px',
                            display: 'flex', flexDirection: 'row',
                            border: '2px solid #a5b4fc'
                          }}>
                            <div style={{ width: '60px', height: '100%', flexShrink: 0, position: 'relative', overflow: 'hidden', borderRadius: '6px 0 0 6px' }}>
                              {(clip.thumbnailUrl || clip.thumbnail) ? (
                                <img src={clip.thumbnailUrl || clip.thumbnail} alt=""
                                  style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                                  loading="lazy" draggable={false} />
                              ) : (
                                <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>1</span>
                                </div>
                              )}
                              {clipDuration > 0 && (
                                <span style={{ position: 'absolute', bottom: 2, left: 2, padding: '1px 4px', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '3px', fontSize: '9px', color: '#fff' }}>
                                  {clipDuration.toFixed(1)}s
                                </span>
                              )}
                            </div>
                            <div style={{ flex: 1, height: '100%', backgroundColor: 'rgba(99,102,241,0.15)', position: 'relative', borderRadius: '0 6px 6px 0', overflow: 'hidden' }} />
                          </div>
                        ) : (
                          <div className="text-center py-2 text-neutral-500 text-[13px]">
                            <p>No clip selected</p>
                          </div>
                        )}
                      </div>

                      {/* Audio waveform row — continuous strip, height scales with volume */}
                      {hasAudioTrack && (() => {
                        const audioPx = trimmedDuration * pxPerSec;
                        const maxBars = Math.max(50, Math.round(audioPx / 3));
                        const bars = downsample(waveformData, maxBars);
                        const trackH = audioTrackH;
                        return (
                          <div style={{ height: `${trackH}px`, borderTop: '1px solid #333', position: 'relative', transition: 'height 0.15s ease-out' }}>
                            <div style={{ width: `${audioPx}px`, height: '100%', backgroundColor: 'rgba(34, 197, 94, 0.06)', display: 'flex', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: `${Math.max(2, trackH - 4)}px`, gap: '1px', padding: '0 1px' }}>
                                {bars.map((amplitude, i) => (
                                  <div key={i} style={{ flex: 1, minWidth: '1px', backgroundColor: 'rgba(34, 197, 94, 0.5)', height: `${amplitude * externalAudioVolume * 100}%`, opacity: externalAudioVolume > 0 ? 0.6 : 0.2 }} />
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Source audio waveform row */}
                      {hasSourceTrack && (() => {
                        const trackH = sourceTrackH;
                        const clipDur = clipDuration || 1;
                        const segWidth = Math.max(50, clipDur * pxPerSec);
                        return (
                          <div style={{ height: `${trackH}px`, borderTop: '1px solid #333', position: 'relative', transition: 'height 0.15s ease-out' }}>
                            <div style={{
                              width: `${segWidth}px`, display: 'flex', alignItems: 'center',
                              height: '100%',
                              backgroundColor: srcVol > 0 ? 'rgba(245, 158, 11, 0.06)' : 'rgba(245, 158, 11, 0.02)'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: `${Math.max(2, trackH - 4)}px`, gap: '1px', padding: '0 1px' }}>
                                {sourceWaveformBars.map((amplitude, i) => (
                                  <div key={i} style={{ flex: 1, minWidth: '1px', backgroundColor: 'rgba(245, 158, 11, 0.4)', height: `${amplitude * srcVol * 100}%`, opacity: srcVol > 0 ? 0.6 : 0.2 }} />
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
              );
            })()}
          </div>

          {/* RIGHT: Sidebar */}
          {!isMobile && (
            <div className="flex w-96 flex-none flex-col items-start self-stretch border-l border-neutral-200 bg-[#1a1a1aff] overflow-auto">
              <div className="flex w-full flex-col items-start">
                {renderCollapsibleSection('audio', 'Audio', (
                  <div className="flex flex-col gap-3">
                    {selectedAudio ? (
                      <>
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-black/50 min-w-0">
                          <FeatherMusic className="w-4 h-4 text-purple-400 flex-shrink-0" />
                          <span className="text-body font-body text-[#ffffffff] flex-1 min-w-0 truncate">{selectedAudio.name}</span>
                          {selectedAudio.isTrimmed && <Badge variant="neutral" className="flex-shrink-0">Trimmed</Badge>}
                        </div>
                        <div className="flex gap-2">
                          <Button variant="neutral-secondary" size="small" icon={<FeatherScissors />} onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}>Trim</Button>
                          <Button variant="neutral-secondary" size="small" icon={<FeatherMic />} onClick={() => setShowTranscriber(true)}>Auto Transcribe</Button>
                          <Button variant="destructive-tertiary" size="small" icon={<FeatherTrash2 />} onClick={() => {
                            if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
                            if (animationRef.current) cancelAnimationFrame(animationRef.current);
                            setSelectedAudio(null); setIsPlaying(false); setCurrentTime(0); setAudioDuration(0); setSourceVideoMuted(false);
                          }}>Remove</Button>
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-neutral-500 text-caption font-caption py-4">No audio selected</div>
                    )}
                    <Button className="w-full" variant="neutral-secondary" size="small" icon={<FeatherUpload />} onClick={() => audioFileInputRef.current?.click()}>
                      {selectedAudio ? 'Change Audio' : 'Upload Audio'}
                    </Button>
                    {filteredAudio.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <select
                          value={audioScope}
                          onChange={(e) => setAudioScope(e.target.value)}
                          className="w-full px-2 py-1 bg-black border border-neutral-200 rounded-md text-[11px] text-neutral-400 outline-none cursor-pointer"
                        >
                          {nicheAudio.length > 0 && <option value="niche">This Niche ({nicheAudio.length})</option>}
                          {projectAudio.length > 0 && <option value="project">This Project ({projectAudio.length})</option>}
                          <option value="all">All Audio ({libraryAudio.length})</option>
                        </select>
                        <div className="flex flex-col gap-0.5 max-h-[120px] overflow-y-auto">
                          {filteredAudio.map(audio => (
                            <div key={audio.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-neutral-100 text-[12px] text-[#ffffffff]"
                              onClick={() => { setAudioToTrim(audio); setShowAudioTrimmer(true); }}>
                              <FeatherMusic className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                              <span className="truncate">{audio.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {renderCollapsibleSection('clips', 'Clips', (
                  <div className="flex flex-col gap-3">
                    <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)}
                      className="w-full px-3 py-2 bg-black border border-neutral-200 rounded-md text-[#ffffffff] text-[13px] outline-none cursor-pointer">
                      <option value="category">Selected Clips</option>
                      <option value="all">All Videos (Library)</option>
                      {collections.filter(c => !category?.projectId || c.projectId === category.projectId).map(col => (<option key={col.id} value={col.id}>{col.name}</option>))}
                    </select>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-caption font-caption text-neutral-400">{visibleVideos.length} clips</span>
                        {visibleVideos.length > 0 && (
                          <button className="text-caption font-caption text-indigo-400 hover:text-indigo-300" onClick={selectAllClips}>
                            {selectedClipIds.size === visibleVideos.length ? 'Deselect All' : 'Select All'}
                          </button>
                        )}
                        {selectedClipIds.size > 0 && (
                          <span className="text-caption font-caption text-neutral-500">{selectedClipIds.size} selected</span>
                        )}
                      </div>
                      <CloudImportButton artistId={artistId} db={db} mediaType="video" compact onImportMedia={(files) => {
                        const newVids = files.map((f, i) => ({ id: `import_${Date.now()}_${i}`, name: f.name, url: f.url, localUrl: f.localUrl, type: 'video' }));
                        setLibraryMedia(prev => [...prev, ...newVids]);
                      }} />
                    </div>
                    {visibleVideos.length === 0 ? (
                      <div className="py-4 text-center text-neutral-500 text-[13px]">No videos in this collection</div>
                    ) : (
                      <div
                        className="relative max-h-[300px] overflow-y-auto"
                        ref={clipGridRef}
                        {...clipGridMouseHandlers}
                        style={{ userSelect: clipDragSelecting ? 'none' : undefined }}
                      >
                        {clipRubberBand && (
                          <div className="absolute pointer-events-none border border-indigo-400 bg-indigo-500/20 z-10 rounded-sm"
                            style={{ left: clipRubberBand.left, top: clipRubberBand.top, width: clipRubberBand.width, height: clipRubberBand.height }} />
                        )}
                        <div className="grid grid-cols-2 gap-1.5">
                          {visibleVideos.map((video, i) => {
                            const isActive = clip?.id === video.id;
                            const isSelected = selectedClipIds.has(video.id);
                            return (
                              <div key={video.id || i}
                                data-media-id={video.id}
                                className={`cursor-pointer p-1 rounded-md border-2 transition-colors relative ${
                                  isSelected ? 'border-indigo-500' : isActive ? 'border-brand-600' : 'border-transparent'
                                }`}
                                onClick={(e) => {
                                  if (clipDragSelecting) return;
                                  if (e.shiftKey || selectedClipIds.size > 0) {
                                    toggleClipSelect(video.id, e);
                                  } else {
                                    setClip(video);
                                    if (video.id && artistId) incrementUseCount(artistId, video.id);
                                  }
                                }}>
                                {isSelected && (
                                  <div className="absolute top-1 left-1 z-[2] h-4 w-4 rounded-full bg-indigo-500 flex items-center justify-center">
                                    <FeatherCheck className="text-white" style={{ width: 10, height: 10 }} />
                                  </div>
                                )}
                                {isActive && !isSelected && <div className="absolute top-1 right-1 z-[2] w-[18px] h-[18px] rounded-full bg-brand-600 flex items-center justify-center text-[11px] text-white font-bold">&#10003;</div>}
                                <div className="w-full aspect-video rounded overflow-hidden bg-[#0a0a0aff]">
                                  {(video.thumbnailUrl || video.thumbnail) ? (
                                    <img src={video.thumbnailUrl || video.thumbnail} alt={video.name} className="w-full h-full object-cover" loading="lazy" />
                                  ) : (<div className="w-full h-full flex items-center justify-center text-xl">&#127916;</div>)}
                                </div>
                                <div className="text-[10px] text-neutral-400 overflow-hidden text-ellipsis whitespace-nowrap mt-1">
                                  {(video.name || video.metadata?.originalName || 'Clip').substring(0, 20)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {renderCollapsibleSection('text', 'Text Banks', (
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="text-body-bold font-body-bold mb-2" style={{ color: '#818cf8' }}>Text Bank A</div>
                      <div className="flex gap-1.5 mb-2">
                        <input value={newTextA} onChange={(e) => setNewTextA(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }}
                          placeholder="Add text..." className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-200 bg-black text-[#ffffffff] text-[12px] outline-none" />
                        <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} aria-label="Add to Text Bank A" onClick={() => { if (newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }} />
                      </div>
                      {videoTextBank1.map((text, idx) => (
                        <div key={idx} className="flex items-center px-2 py-1.5 rounded-md bg-neutral-100/50 mb-1 text-neutral-300">
                          <span className="flex-1 text-[12px] cursor-pointer" onClick={() => addTextOverlay(text)}>{text}</span>
                          <button onClick={() => handleRemoveFromVideoTextBank(1, idx)} className="bg-transparent border-none text-neutral-500 text-[14px] cursor-pointer px-1">×</button>
                        </div>
                      ))}
                      {videoTextBank1.length === 0 && <div className="text-[11px] text-neutral-500">No text added yet</div>}
                    </div>
                    <div>
                      <div className="text-body-bold font-body-bold mb-2" style={{ color: '#fbbf24' }}>Text Bank B</div>
                      <div className="flex gap-1.5 mb-2">
                        <input value={newTextB} onChange={(e) => setNewTextB(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }}
                          placeholder="Add text..." className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-200 bg-black text-[#ffffffff] text-[12px] outline-none" />
                        <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} aria-label="Add to Text Bank B" onClick={() => { if (newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }} />
                      </div>
                      {videoTextBank2.map((text, idx) => (
                        <div key={idx} className="flex items-center px-2 py-1.5 rounded-md bg-neutral-100/50 mb-1 text-neutral-300">
                          <span className="flex-1 text-[12px] cursor-pointer" onClick={() => addTextOverlay(text)}>{text}</span>
                          <button onClick={() => handleRemoveFromVideoTextBank(2, idx)} className="bg-transparent border-none text-neutral-500 text-[14px] cursor-pointer px-1">×</button>
                        </div>
                      ))}
                      {videoTextBank2.length === 0 && <div className="text-[11px] text-neutral-500">No text added yet</div>}
                    </div>
                  </div>
                ))}


                {renderCollapsibleSection('textStyle', 'Text Style', (() => {
                  const selOverlay = editingTextId ? textOverlays.find(o => o.id === editingTextId) : null;
                  const activeStyle = selOverlay?.style || getDefaultTextStyle();
                  const disabled = !selOverlay;
                  const handleStyleChange = (updates) => {
                    if (selOverlay) updateTextOverlay(selOverlay.id, { style: { ...selOverlay.style, ...updates } });
                  };
                  const strokeInfo = activeStyle.textStroke ? parseStroke(activeStyle.textStroke) : { width: 0.5, color: '#000000' };
                  return (
                    <div className={`flex flex-col gap-4 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
                      {disabled && <div className="text-xs text-neutral-400 italic mb-3">Click text on preview to edit</div>}

                      {/* Add + Delete buttons — always accessible */}
                      <div className="flex gap-2" style={disabled ? { opacity: 1, pointerEvents: 'auto' } : {}}>
                        <Button variant="brand-secondary" size="small" icon={<FeatherPlus />}
                          onClick={() => addTextOverlay()} style={{ opacity: 1, pointerEvents: 'auto' }}>Add Text</Button>
                        {selOverlay && (
                          <Button variant="neutral-secondary" size="small" icon={<FeatherTrash2 />}
                            onClick={() => removeTextOverlay(selOverlay.id)}>Delete</Button>
                        )}
                      </div>

                      {/* Selected overlay text input */}
                      {selOverlay && (
                        <input value={selOverlay.text}
                          onChange={(e) => updateTextOverlay(selOverlay.id, { text: e.target.value })}
                          className="w-full px-3 py-2 rounded-md border border-neutral-200 bg-black text-white text-sm" />
                      )}

                      {/* Font Family */}
                      <div>
                        <div className="text-[13px] text-neutral-500 mb-1.5">Font Family</div>
                        <select value={activeStyle.fontFamily || "'Inter', sans-serif"}
                          onChange={(e) => handleStyleChange({ fontFamily: e.target.value })}
                          className="w-full px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50 text-white text-[13px] outline-none cursor-pointer">
                          {AVAILABLE_FONTS.map(f => <option key={f.name} value={f.value}>{f.name}</option>)}
                        </select>
                      </div>

                      {/* Font Size */}
                      <div>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-[13px] text-neutral-500">Font Size</span>
                          <span className="text-[13px] text-white">{activeStyle.fontSize || 48}px</span>
                        </div>
                        <input type="range" min="12" max="120" step="2" value={activeStyle.fontSize || 48}
                          onChange={(e) => handleStyleChange({ fontSize: parseInt(e.target.value) })}
                          className="w-full accent-brand-600" />
                      </div>

                      {/* Text Color + Outline Color */}
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <div className="text-[13px] text-neutral-500 mb-1.5">Text Color</div>
                          <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50">
                            <input type="color" value={activeStyle.color || '#ffffff'}
                              onChange={(e) => handleStyleChange({ color: e.target.value })}
                              className="w-6 h-6 border-none rounded-full cursor-pointer p-0 bg-transparent" />
                            <span className="text-xs text-neutral-500 font-mono">{(activeStyle.color || '#ffffff').toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] text-neutral-500 mb-1.5">Outline</div>
                          <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-neutral-200 bg-neutral-50">
                            <input type="color" value={activeStyle.outlineColor || '#000000'}
                              onChange={(e) => handleStyleChange({ outlineColor: e.target.value, outline: true })}
                              className="w-6 h-6 border-none rounded-full cursor-pointer p-0 bg-transparent" />
                            <span className="text-xs text-neutral-500 font-mono">{(activeStyle.outlineColor || '#000000').toUpperCase()}</span>
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
                                <input type="color" value={strokeInfo.color.startsWith('#') ? strokeInfo.color : '#000000'}
                                  onChange={(e) => handleStyleChange({ textStroke: buildStroke(strokeInfo.width, e.target.value) })}
                                  className="w-6 h-6 border-none rounded-full cursor-pointer p-0 bg-transparent" />
                                <span className="text-xs text-neutral-500 font-mono">{(strokeInfo.color.startsWith('#') ? strokeInfo.color : '#000000').toUpperCase()}</span>
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between mb-1.5">
                              <span className="text-[13px] text-neutral-500">Stroke Width</span>
                              <span className="text-[13px] text-white">{strokeInfo.width}px</span>
                            </div>
                            <input type="range" min="0.1" max="10" step="0.1" value={strokeInfo.width}
                              onChange={(e) => handleStyleChange({ textStroke: buildStroke(parseFloat(e.target.value), strokeInfo.color) })}
                              className="w-full accent-brand-600" />
                          </div>
                        </>
                      )}

                      {/* Formatting */}
                      <div>
                        <div className="text-[13px] text-neutral-500 mb-1.5">Formatting</div>
                        <div className="flex gap-1">
                          {[
                            { key: 'bold', label: 'B', ariaLabel: 'Bold', active: activeStyle.fontWeight === '700', toggle: () => handleStyleChange({ fontWeight: activeStyle.fontWeight === '700' ? '400' : '700' }), bold: true },
                            { key: 'caps', label: 'AA', ariaLabel: 'All caps', active: activeStyle.textCase === 'upper', toggle: () => handleStyleChange({ textCase: activeStyle.textCase === 'upper' ? 'default' : 'upper' }) },
                            { key: 'outline', label: 'O', ariaLabel: 'Outline', active: !!activeStyle.outline, toggle: () => handleStyleChange({ outline: !activeStyle.outline }) },
                            { key: 'stroke', label: 'St', ariaLabel: 'Stroke', active: !!activeStyle.textStroke, toggle: () => handleStyleChange({ textStroke: activeStyle.textStroke ? null : buildStroke(0.5, '#000000') }) },
                          ].map(btn => (
                            <IconButton key={btn.key} onClick={btn.toggle}
                              variant={btn.active ? 'brand-secondary' : 'neutral-secondary'} size="small"
                              icon={<span className={`text-xs ${btn.bold ? 'font-bold' : 'font-semibold'}`}>{btn.label}</span>}
                              aria-label={btn.ariaLabel} />
                          ))}
                        </div>
                      </div>

                      {/* Alignment */}
                      <div>
                        <div className="text-[13px] text-neutral-500 mb-1.5">Alignment</div>
                        <ToggleGroup value={activeStyle.textAlign || 'center'}
                          onValueChange={(val) => handleStyleChange({ textAlign: val })}>
                          <ToggleGroup.Item value="left" icon={<FeatherAlignLeft />}>{null}</ToggleGroup.Item>
                          <ToggleGroup.Item value="center" icon={<FeatherAlignCenter />}>{null}</ToggleGroup.Item>
                          <ToggleGroup.Item value="right" icon={<FeatherAlignRight />}>{null}</ToggleGroup.Item>
                        </ToggleGroup>
                      </div>

                      {/* Text Overlays list */}
                      <div className="pt-2 border-t border-neutral-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[13px] text-neutral-500">Text Overlays</span>
                        </div>
                        {textOverlays.length > 0 ? (
                          <div className="flex flex-col gap-1.5">
                            {textOverlays.map(overlay => (
                              <div key={overlay.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${editingTextId === overlay.id ? 'bg-brand-600/20 border border-brand-600' : 'border border-neutral-200 hover:bg-neutral-100'}`}
                                onClick={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}>
                                <span className="text-body font-body text-[#ffffffff] text-[12px] truncate flex-1">{overlay.text}</span>
                                <IconButton size="small" variant="destructive-tertiary" icon={<FeatherTrash2 className="w-3 h-3" />} onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }} aria-label="Remove" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[12px] text-neutral-500 text-center py-2">No text overlays yet</div>
                        )}
                      </div>

                      {/* Crop */}
                      <div className="flex items-center gap-2 pt-2 border-t border-neutral-200">
                        <span className="text-caption font-caption text-neutral-400">Crop</span>
                        <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="flex-1 px-2 py-1.5 bg-neutral-100 border border-neutral-200 rounded-md text-[#ffffffff] text-[12px] outline-none">
                          <option value="9:16">9:16 (Full)</option>
                          <option value="4:3">4:3 (Crop)</option>
                          <option value="1:1">1:1 (Crop)</option>
                        </select>
                      </div>
                      {presets.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-caption font-caption text-neutral-400">Apply Preset</span>
                          <select value={selectedPreset?.id || ''} onChange={(e) => { const preset = presets.find(p => p.id === e.target.value); if (preset) handleApplyPreset(preset); }}
                            className="w-full px-3 py-2 bg-neutral-100 border border-neutral-200 rounded-md text-[#ffffffff] text-[13px] outline-none">
                            <option value="">Choose a preset...</option>
                            {presets.map(preset => (<option key={preset.id} value={preset.id}>{preset.name}</option>))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })())}
              </div>
            </div>
          )}
        </div>

        {/* ── Preset Bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderTop: `1px solid ${theme.border.subtle}` }}>
          <span style={{ fontSize: '11px', color: theme.text.muted, whiteSpace: 'nowrap' }}>Preset</span>
          <select
            value={selectedPreset?.id || ''}
            onChange={(e) => {
              const preset = presets.find(p => p.id === e.target.value);
              if (preset) handleApplyPreset(preset);
            }}
            style={{ flex: '0 1 200px', padding: '4px 8px', fontSize: '11px', backgroundColor: theme.bg.surface, border: `1px solid ${theme.bg.elevated}`, borderRadius: '6px', color: theme.text.primary, outline: 'none' }}
          >
            <option value="">Choose a preset...</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
          {!isMobile && (
            <Button variant="neutral-tertiary" size="small" icon={<FeatherStar />} onClick={() => { setPresetPromptValue(''); setShowPresetPrompt(true); }}>Save preset</Button>
          )}
        </div>

        <EditorFooter lastSaved={lastSaved} onCancel={onClose} onSaveAll={handleSaveAllAndClose} isSavingAll={isSavingAll} saveAllCount={allVideos.length} />

        {/* ── Hidden Audio Element ── */}
        <audio ref={audioRef} style={{ display: 'none' }} crossOrigin="anonymous" />

        {/* ── Audio Trimmer Modal ── */}
        {showAudioTrimmer && (audioToTrim || selectedAudio) && (() => {
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
            duration={timelineDuration}
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
                onAddLyrics({ title: lyricData.title, content: lyricData.content, words: lyricData.words });
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
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[100]">
            <div className="bg-[#171717] rounded-xl p-6 max-w-[360px] w-full border border-neutral-200">
              <h3 className="text-[16px] font-semibold mb-2" style={{ color: theme.text.primary }}>Close editor?</h3>
              <p className="text-[13px] mb-4" style={{ color: theme.text.secondary }}>
                You have unsaved work. Are you sure you want to close?
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="neutral-secondary" size="small" onClick={() => setShowCloseConfirm(false)}>Keep Editing</Button>
                <Button variant="destructive-primary" size="small" onClick={() => { setShowCloseConfirm(false); onClose(); }}>Close Anyway</Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Preset Save Modal ── */}
        {showPresetPrompt && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: theme.overlay.heavy }}
            onClick={() => setShowPresetPrompt(false)}>
            <div className="rounded-xl p-6 w-[360px] max-w-[90vw]" style={{ background: theme.bg.input }}
              onClick={e => e.stopPropagation()}>
              <div className="text-[16px] font-semibold mb-3" style={{ color: theme.text.primary }}>Save Preset</div>
              <input
                autoFocus
                value={presetPromptValue}
                onChange={e => setPresetPromptValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setShowPresetPrompt(false);
                  if (e.key === 'Enter' && presetPromptValue.trim()) {
                    onSavePreset?.({ name: presetPromptValue.trim(), settings: { ...textStyle, cropMode: aspectRatio } });
                    toastSuccess(`Preset "${presetPromptValue.trim()}" saved!`);
                    setShowPresetPrompt(false);
                  }
                }}
                placeholder="Preset name..."
                className="w-full rounded-lg py-2.5 px-3 text-sm outline-none"
                style={{ background: theme.bg.page, border: `1px solid ${theme.bg.elevated}`, color: theme.text.primary }}
              />
              <div className="flex gap-2 justify-end mt-3">
                <Button variant="neutral-secondary" size="small" onClick={() => setShowPresetPrompt(false)}>
                  Cancel
                </Button>
                <Button variant="brand-primary" size="small" onClick={() => {
                  if (presetPromptValue.trim()) {
                    onSavePreset?.({ name: presetPromptValue.trim(), settings: { ...textStyle, cropMode: aspectRatio } });
                    toastSuccess(`Preset "${presetPromptValue.trim()}" saved!`);
                  }
                  setShowPresetPrompt(false);
                }}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
    </EditorShell>
  );
};

export default SoloClipEditor;
