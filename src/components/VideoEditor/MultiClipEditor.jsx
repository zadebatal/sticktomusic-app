import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary, getLyrics,
  addToVideoTextBank, removeFromVideoTextBank, updateVideoTextBank,
  addToLibraryAsync, incrementUseCount, MEDIA_TYPES,
  getBankColor, getBankLabel
} from '../../services/libraryService';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import log from '../../utils/logger';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { FeatherX, FeatherPlay, FeatherPause, FeatherVolume2, FeatherVolumeX, FeatherPlus, FeatherTrash2, FeatherChevronUp, FeatherChevronDown, FeatherRefreshCw, FeatherMusic, FeatherUpload, FeatherDatabase, FeatherMic, FeatherScissors, FeatherSkipBack, FeatherSkipForward, FeatherStar, FeatherCheck } from '@subframe/core';
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
import CloudImportButton from './CloudImportButton';
import LyricBank from './LyricBank';
import LyricAnalyzer from './LyricAnalyzer';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';
import useMediaMultiSelect from './shared/useMediaMultiSelect';
import useEditorSessionState from './shared/useEditorSessionState';
import useUnsavedChanges from './shared/useUnsavedChanges';

/**
 * MultiClipEditor v1 — "Multi-Clip" video editor mode
 *
 * 3-column layout:
 *   Left (260px):  Clip grid + timeline with reordering
 *   Center:        Video preview + playback
 *   Right (320px): Text overlays (with scope) + Video text banks
 *
 * Mirrors SlideshowEditor's template/generation architecture:
 *   allVideos[0] = template
 *   allVideos[1..N] = generated
 *   Tab bar at bottom to switch between them
 *
 * Key features:
 *   - Each video has a clips[] array (ordered timeline)
 *   - activeClipIndex tracks which clip is playing
 *   - Text overlays have scope: 'full' or clipIndex
 *   - Generation randomizes both clip order and text from banks
 */
const MultiClipEditor = ({
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
  templateSettings = null
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();

  // ── Multi-video state (mirrors SlideshowEditor allSlideshows) ──
  const [allVideos, setAllVideos] = useState(() => {
    if (existingVideo && existingVideo.editorMode === 'multi-clip') {
      // Re-editing an existing multi-clip draft
      return [{
        id: 'template',
        name: 'Template',
        clips: existingVideo.clips || [],
        textOverlays: existingVideo.textOverlays || [],
        words: existingVideo.words || [],
        isTemplate: true
      }];
    }
    // Start with first clip in timeline
    const firstClip = category?.videos?.[0] || null;
    return [{
      id: 'template',
      name: 'Template',
      clips: firstClip ? [firstClip] : [],
      textOverlays: [],
      words: [],
      isTemplate: true
    }];
  });
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const nicheGenCount = existingVideo?._nicheGenerateCount || null;
  const [generateCount, setGenerateCount] = useState(
    nicheGenCount ? Math.max(nicheGenCount - 1, 1) : Math.min(10, Math.max(1, (category?.videos?.length || 1) - 1))
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [keepTemplateText, setKeepTemplateText] = useState('none');

  // Derived reads from active video
  const activeVideo = allVideos[activeVideoIndex];
  const clips = activeVideo?.clips || [];
  const textOverlays = activeVideo?.textOverlays || [];
  const textOverlaysRef = useRef(textOverlays);
  textOverlaysRef.current = textOverlays;
  const words = activeVideo?.words || [];

  // ── Footer state ──
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // Wrapper setters (route through allVideos)
  const setClips = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const current = copy[activeVideoIndex];
      if (!current) return prev;
      copy[activeVideoIndex] = {
        ...current,
        clips: typeof updater === 'function' ? updater(current.clips || []) : updater
      };
      return copy;
    });
  }, [activeVideoIndex]);

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

  // ── Undo/Redo history ──
  const getHistorySnapshot = useCallback(() => {
    const v = allVideos[activeVideoIndex];
    return v ? { clips: v.clips, textOverlays: v.textOverlays, words: v.words } : null;
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
    deps: [clips, textOverlays],
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

  // ── Clip durations tracking ──
  const clipDurationsRef = useRef({});
  const [clipDurationsState, setClipDurationsState] = useState({});

  const getClipDuration = (clipId) => {
    return clipDurationsRef.current[clipId] || 5;
  };

  const setClipDuration = (clipId, duration) => {
    clipDurationsRef.current[clipId] = duration;
    setClipDurationsState(prev => ({ ...prev, [clipId]: duration }));
  };

  // Calculate total duration across all clips
  const calculateTotalDuration = useCallback(() => {
    return clips.reduce((sum, clip) => sum + getClipDuration(clip.id || clip.sourceId), 0);
  }, [clips]);

  const totalDuration = calculateTotalDuration();

  // ── Playback state ──
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const videoRef = useRef(null);
  const animationRef = useRef(null);

  // ── Aspect ratio ──
  const [aspectRatio, setAspectRatio] = useState(existingVideo?.cropMode || templateSettings?.aspectRatio || '9:16');

  // ── Text editing state ──
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [draggingTextId, setDraggingTextId] = useState(null);
  const dragStartRef = useRef(null);
  const previewRef = useRef(null);

  // ── Timeline drag state ──
  const timelineRef = useRef(null);
  const [timelineDrag, setTimelineDrag] = useState(null); // { overlayId, type: 'move'|'left'|'right', startX, origStart, origEnd }

  // ── Library state ──
  const [collections, setCollections] = useState([]);
  const [libraryMedia, setLibraryMedia] = useState([]);

  // Derive library audio and video from libraryMedia
  const libraryAudio = libraryMedia.filter(i => i.type === MEDIA_TYPES.AUDIO);
  const libraryVideos = libraryMedia.filter(i => i.type === MEDIA_TYPES.VIDEO);

  // ── Collection dropdown state ──
  const [selectedCollection, setSelectedCollection] = useState('all');

  // Computed: visible videos based on selected collection (matches Montage pattern)
  const visibleVideos = useMemo(() => {
    if (selectedCollection === 'category') return category?.videos || [];
    if (selectedCollection === 'all') return libraryVideos;
    const col = collections.find(c => c.id === selectedCollection);
    if (!col?.mediaIds?.length) return [];
    return libraryVideos.filter(v => col.mediaIds.includes(v.id));
  }, [selectedCollection, libraryVideos, collections, category?.videos]);

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

  // ── Lyrics state ──
  const [lyricsBank, setLyricsBank] = useState([]);

  // ── Audio trimmer state ──
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);

  // ── Transcriber state ──
  const [showTranscriber, setShowTranscriber] = useState(false);

  // ── BeatSync layout state ──
  const [videoName, setVideoName] = useState(existingVideo?.name || 'Untitled Multi-Clip');
  const { openSections, renderCollapsibleSection } = useCollapsibleSections({
    audio: true, clips: true, lyrics: false, textStyle: false
  });

  // ── Session persistence ──
  const { loadSession, saveSession, clearSession } = useEditorSessionState(
    artistId, 'multi-clip', existingVideo?.id
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

  // ── Preset state ──
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [showPresetPrompt, setShowPresetPrompt] = useState(false);
  const [presetPromptValue, setPresetPromptValue] = useState('');

  // ── Mobile detection ──
  const { isMobile } = useIsMobile();

  // ── Mobile tool tab state ──
  const [mobileToolTab, setMobileToolTab] = useState(null); // 'clips', 'text', 'audio', 'banks', or null

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

  // ── Video Text Banks ──
  const getVideoTextBanks = useCallback(() => {
    let videoTextBank1 = [], videoTextBank2 = [];
    for (const col of collections) {
      if (col.videoTextBank1?.length > 0) videoTextBank1 = [...videoTextBank1, ...col.videoTextBank1];
      if (col.videoTextBank2?.length > 0) videoTextBank2 = [...videoTextBank2, ...col.videoTextBank2];
    }
    return { videoTextBank1, videoTextBank2 };
  }, [collections]);

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
  const getCurrentClip = useCallback(() => {
    if (activeClipIndex >= 0 && activeClipIndex < clips.length) {
      return clips[activeClipIndex];
    }
    return null;
  }, [clips, activeClipIndex]);

  const handleVideoLoaded = useCallback(() => {
    if (videoRef.current && activeClipIndex < clips.length) {
      const clipId = clips[activeClipIndex].id || clips[activeClipIndex].sourceId;
      setClipDuration(clipId, videoRef.current.duration);
    }
  }, [activeClipIndex, clips]);

  // Effective timeline duration = max(totalClipsDuration, audioDuration) so audio can extend past video
  const timelineDuration = Math.max(totalDuration || 0, audioDuration || 0) || totalDuration || 1;

  const playbackLoop = useCallback(() => {
    const startBoundary = selectedAudio?.startTime || 0;
    const endBoundary = selectedAudio?.endTime || (audioRef.current?.duration > 0 ? audioRef.current.duration : 0);

    // If audio is longer than all clips and all clips ended, track audio time
    if (audioRef.current && audioRef.current.src && !audioRef.current.paused && audioRef.current.duration > 0) {
      const allClipsEnded = videoRef.current ? videoRef.current.ended : true;
      const isLastClip = activeClipIndex >= clips.length - 1;
      const actualTime = audioRef.current.currentTime;

      // Loop at endBoundary
      if (endBoundary > 0 && actualTime >= endBoundary) {
        audioRef.current.currentTime = startBoundary;
        if (videoRef.current) videoRef.current.currentTime = 0;
        setActiveClipIndex(0);
      }

      const relTime = actualTime - startBoundary;
      if (allClipsEnded && isLastClip && relTime > (totalDuration || 0)) {
        setCurrentTime(relTime);
        animationRef.current = requestAnimationFrame(playbackLoop);
        return;
      }
    }
    if (videoRef.current) {
      // For multi-clip, currentTime is accumulated global time
      let accBefore = 0;
      for (let i = 0; i < activeClipIndex; i++) {
        accBefore += getClipDuration(clips[i]?.id || clips[i]?.sourceId);
      }
      setCurrentTime(accBefore + videoRef.current.currentTime);
    }
    animationRef.current = requestAnimationFrame(playbackLoop);
  }, [activeClipIndex, clips, totalDuration, selectedAudio]);

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

  // Handle clip progression
  useEffect(() => {
    if (!videoRef.current || clips.length === 0) return;

    const currentClip = clips[activeClipIndex];
    const currentClipId = currentClip.id || currentClip.sourceId;
    const currentClipDuration = getClipDuration(currentClipId);

    if (videoRef.current.currentTime >= currentClipDuration) {
      // Current clip ended
      if (activeClipIndex < clips.length - 1) {
        // Advance to next clip
        setActiveClipIndex(prev => prev + 1);
        setCurrentTime(0);
        videoRef.current.currentTime = 0;
      } else {
        // Last clip ended
        setIsPlaying(false);
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      }
    }
  }, [currentTime, activeClipIndex, clips]);

  const handleSeek = useCallback((time) => {
    if (clips.length === 0) return;

    let accumulatedTime = 0;
    let targetClipIndex = 0;
    let timeInClip = time;

    for (let i = 0; i < clips.length; i++) {
      const clipId = clips[i].id || clips[i].sourceId;
      const clipDur = getClipDuration(clipId);
      if (accumulatedTime + clipDur >= time) {
        targetClipIndex = i;
        timeInClip = time - accumulatedTime;
        break;
      }
      accumulatedTime += clipDur;
    }

    setActiveClipIndex(targetClipIndex);
    setCurrentTime(time);

    if (videoRef.current) {
      videoRef.current.currentTime = timeInClip;
    }
    if (audioRef.current) {
      // Add audio start boundary offset for trimmed audio
      const startBoundary = selectedAudio?.startTime || 0;
      audioRef.current.currentTime = time + startBoundary;
    }
  }, [clips, selectedAudio]);

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
      if (preset.settings.cropMode) setAspectRatio(preset.settings.cropMode);
    }
  }, []);

  // ── Text overlay CRUD ──
  const getDefaultTextStyle = useCallback(() => ({
    fontSize: 48,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    color: '#ffffff',
    outline: true,
    outlineColor: '#000000',
    textAlign: 'center',
    textCase: 'default'
  }), []);

  // ── AI Transcription handler ──
  const handleTranscriptionComplete = useCallback((result) => {
    if (!result?.words?.length) {
      toastError('No words detected in transcription.');
      setShowTranscriber(false);
      return;
    }
    const dur = totalDuration || 30;
    result.words.forEach(w => {
      const start = Math.min(w.startTime || 0, dur);
      const end = Math.min(w.startTime + (w.duration || 0.5), dur);
      const newOverlay = {
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: w.text,
        style: getDefaultTextStyle(),
        position: { x: 50, y: 50, width: 80, height: 20 },
        scope: 'full',
        startTime: start,
        endTime: end
      };
      setTextOverlays(prev => [...prev, newOverlay]);
    });
    toastSuccess(`Added ${result.words.length} text overlays from transcription`);
    setShowTranscriber(false);
  }, [totalDuration, getDefaultTextStyle, setTextOverlays, toastSuccess, toastError]);

  // ── Cut by word — creates one clip per word from random source clips ──
  const handleCutByWord = useCallback(() => {
    if (!words.length) {
      toastError('No words to cut by. Add lyrics first.');
      return;
    }
    if (!category?.videos?.length) {
      toastError('No clips in bank. Upload videos first.');
      return;
    }

    const availableClips = category.videos;
    const newClips = words.map((word, i) => {
      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
      return {
        id: `clip_${Date.now()}_${i}`,
        sourceId: randomClip.id,
        url: randomClip.url,
        localUrl: randomClip.localUrl,
        thumbnail: randomClip.thumbnail,
        startTime: word.startTime,
        duration: word.duration || 0.5,
        locked: false
      };
    });

    setClips(newClips);
    toastSuccess(`Created ${newClips.length} clips from words`);
  }, [words, category?.videos, setClips, toastSuccess, toastError]);

  // ── Cut by beat — opens BeatSelector modal ──
  const handleCutByBeat = useCallback(() => {
    if (!filteredBeats.length) {
      toastError('No beats detected. Try a different audio track or check the trim range.');
      return;
    }
    setShowBeatSelector(true);
  }, [filteredBeats, toastError]);

  // ── Apply selected beats — creates clips at beat boundaries ──
  const handleBeatSelectionApply = useCallback((selectedBeatTimes) => {
    if (!selectedBeatTimes.length || !category?.videos?.length) {
      setShowBeatSelector(false);
      return;
    }

    const effectiveDuration = (selectedAudio?.endTime || selectedAudio?.duration || audioDuration) - (selectedAudio?.startTime || 0);
    const availableClips = category.videos;
    const newClips = [];

    for (let i = 0; i < selectedBeatTimes.length; i++) {
      const startTime = selectedBeatTimes[i];
      const endTime = selectedBeatTimes[i + 1] || effectiveDuration;
      const clipDuration = endTime - startTime;

      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];

      newClips.push({
        id: `clip_${Date.now()}_${i}`,
        sourceId: randomClip.id,
        url: randomClip.url,
        localUrl: randomClip.localUrl,
        thumbnail: randomClip.thumbnail,
        startTime: startTime,
        duration: clipDuration,
        locked: false
      });
    }

    setClips(newClips);
    setShowBeatSelector(false);
    toastSuccess(`Created ${newClips.length} clips from beats`);
  }, [category?.videos, audioDuration, selectedAudio, setClips, toastSuccess]);

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
  const getClipUrl = (clipObj) => {
    if (!clipObj) return null;
    const localUrl = clipObj.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    return isBlobUrl ? clipObj.url : (localUrl || clipObj.url || clipObj.src);
  };

  // Waveform data via shared hook
  const { waveformData, clipWaveforms, waveformSource } = useWaveform({
    selectedAudio,
    clips,
    getClipUrl
  });

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const addTextOverlay = useCallback((prefillText, overrideStart, overrideEnd) => {
    const start = overrideStart !== undefined ? overrideStart : currentTime;
    const end = overrideEnd !== undefined ? overrideEnd : Math.min(start + 3, totalDuration || start + 3);
    const newOverlay = {
      id: `text_${Date.now()}`,
      text: prefillText || 'Click to edit',
      style: getDefaultTextStyle(),
      position: { x: 50, y: 50, width: 80, height: 20 },
      scope: 'full',
      startTime: start,
      endTime: end
    };
    setTextOverlays(prev => [...prev, newOverlay]);
    setEditingTextId(newOverlay.id);
    setEditingTextValue(newOverlay.text);
  }, [getDefaultTextStyle, setTextOverlays, currentTime, totalDuration]);

  // ── Reroll: swap active clip with random from visible videos (collection-aware) ──
  const handleReroll = useCallback(() => {
    const availableClips = visibleVideos.length > 0 ? visibleVideos : (category?.videos || []);
    if (!availableClips.length) {
      toastError('No clips available to reroll from.');
      return;
    }
    const currentClip = clips[activeClipIndex];
    const currentSourceId = currentClip?.id || currentClip?.sourceId;
    const available = availableClips.filter(v => v.id !== currentSourceId);
    if (available.length === 0) {
      toastError('No other clips available to swap with.');
      return;
    }
    const randomClip = available[Math.floor(Math.random() * available.length)];
    setClips(prev => prev.map((c, i) => {
      if (i !== activeClipIndex) return c;
      return { ...c, id: randomClip.id, sourceId: randomClip.id, url: randomClip.url, localUrl: randomClip.localUrl, thumbnail: randomClip.thumbnailUrl || randomClip.thumbnail };
    }));
    toastSuccess('Swapped active clip');
  }, [visibleVideos, category?.videos, clips, activeClipIndex, setClips, toastSuccess, toastError]);

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

  // ── Text overlay dragging ──
  const handleTextMouseDown = useCallback((e, overlayId) => {
    e.preventDefault();
    e.stopPropagation();
    const overlay = textOverlaysRef.current.find(o => o.id === overlayId);
    if (!overlay) return;
    setDraggingTextId(overlayId);
    setEditingTextId(overlayId);
    setEditingTextValue(overlay.text);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startPosX: overlay.position.x,
      startPosY: overlay.position.y
    };
  }, []);

  useEffect(() => {
    if (!draggingTextId) return;
    const handleMouseMove = (e) => {
      if (!dragStartRef.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const newX = Math.max(5, Math.min(95, dragStartRef.current.startPosX + (dx / rect.width) * 100));
      const newY = Math.max(5, Math.min(95, dragStartRef.current.startPosY + (dy / rect.height) * 100));
      const overlay = textOverlaysRef.current.find(o => o.id === draggingTextId);
      updateTextOverlay(draggingTextId, { position: { ...overlay?.position, x: newX, y: newY } });
    };
    const handleMouseUp = () => setDraggingTextId(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingTextId, updateTextOverlay]);

  // ── Timeline text block drag/resize ──
  const handleTimelineDragStart = useCallback((e, overlayId, type) => {
    e.preventDefault();
    e.stopPropagation();
    const overlay = textOverlaysRef.current.find(o => o.id === overlayId);
    if (!overlay) return;
    setTimelineDrag({
      overlayId,
      type, // 'move', 'left', 'right'
      startX: e.clientX,
      origStart: overlay.startTime,
      origEnd: overlay.endTime
    });
    setEditingTextId(overlayId);
    setEditingTextValue(overlay.text);
  }, []);

  // Compute clip cut points (boundaries between clips) for magnetic snap
  const clipCutPoints = useMemo(() => {
    const cuts = [0]; // timeline start
    let acc = 0;
    for (const c of clips) {
      acc += getClipDuration(c.id || c.sourceId);
      cuts.push(acc);
    }
    return cuts;
  }, [clips, clipDurationsState]);

  // Magnetic snap: snap a time value to nearest clip cut point within threshold
  const SNAP_THRESHOLD = 0.3; // seconds
  const snapToClipCut = useCallback((time) => {
    for (const cutPoint of clipCutPoints) {
      if (Math.abs(time - cutPoint) <= SNAP_THRESHOLD) return cutPoint;
    }
    return time;
  }, [clipCutPoints]);

  useEffect(() => {
    if (!timelineDrag || !timelineRef.current) return;
    const dur = timelineDuration || 1;
    const handleMouseMove = (e) => {
      const rect = timelineRef.current.getBoundingClientRect();
      const deltaX = e.clientX - timelineDrag.startX;
      const deltaSec = (deltaX / rect.width) * dur;
      const minDur = 0.5;

      if (timelineDrag.type === 'move') {
        const length = timelineDrag.origEnd - timelineDrag.origStart;
        let newStart = Math.max(0, timelineDrag.origStart + deltaSec);
        let newEnd = newStart + length;
        if (newEnd > dur) { newEnd = dur; newStart = dur - length; }
        if (newStart < 0) newStart = 0;
        // Magnetic snap: snap start edge to nearest clip cut
        const snappedStart = snapToClipCut(newStart);
        if (snappedStart !== newStart) { newStart = snappedStart; newEnd = newStart + length; }
        // Also try snapping end edge
        const snappedEnd = snapToClipCut(newEnd);
        if (snappedEnd !== newEnd) { newEnd = snappedEnd; newStart = newEnd - length; }
        newStart = Math.max(0, newStart);
        newEnd = Math.min(dur, newEnd);
        updateTextOverlay(timelineDrag.overlayId, { startTime: newStart, endTime: newEnd });
      } else if (timelineDrag.type === 'left') {
        let newStart = Math.max(0, Math.min(timelineDrag.origEnd - minDur, timelineDrag.origStart + deltaSec));
        newStart = snapToClipCut(newStart); // Magnetic snap
        updateTextOverlay(timelineDrag.overlayId, { startTime: newStart });
      } else if (timelineDrag.type === 'right') {
        let newEnd = Math.min(dur, Math.max(timelineDrag.origStart + minDur, timelineDrag.origEnd + deltaSec));
        newEnd = snapToClipCut(newEnd); // Magnetic snap
        updateTextOverlay(timelineDrag.overlayId, { endTime: newEnd });
      }
    };
    const handleMouseUp = () => setTimelineDrag(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [timelineDrag, timelineDuration, updateTextOverlay, snapToClipCut]);

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
    setActiveClipIndex(0);
    setEditingTextId(null);
    setEditingTextValue('');
    setActiveVideoIndex(index);
  }, [activeVideoIndex]);

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

  // ── Clip timeline management ──
  const addClipToTimeline = useCallback((clip) => {
    setClips(prev => [...prev, clip]);
  }, [setClips]);

  const removeClipFromTimeline = useCallback((clipIndex) => {
    setClips(prev => {
      const updated = prev.filter((_, i) => i !== clipIndex);
      // BUG-025: Clamp activeClipIndex to valid range after removal
      setActiveClipIndex(current => {
        if (updated.length === 0) return 0;
        if (current >= clipIndex && current > 0) return current - 1;
        if (current >= updated.length) return updated.length - 1;
        return current;
      });
      return updated;
    });
  }, [setClips]);

  const moveClipUp = useCallback((clipIndex) => {
    if (clipIndex <= 0) return;
    setClips(prev => {
      const copy = [...prev];
      [copy[clipIndex - 1], copy[clipIndex]] = [copy[clipIndex], copy[clipIndex - 1]];
      return copy;
    });
    if (activeClipIndex === clipIndex) {
      setActiveClipIndex(clipIndex - 1);
    } else if (activeClipIndex === clipIndex - 1) {
      setActiveClipIndex(clipIndex);
    }
  }, [setClips, activeClipIndex]);

  const moveClipDown = useCallback((clipIndex) => {
    if (clipIndex >= clips.length - 1) return;
    setClips(prev => {
      const copy = [...prev];
      [copy[clipIndex], copy[clipIndex + 1]] = [copy[clipIndex + 1], copy[clipIndex]];
      return copy;
    });
    if (activeClipIndex === clipIndex) {
      setActiveClipIndex(clipIndex + 1);
    } else if (activeClipIndex === clipIndex + 1) {
      setActiveClipIndex(clipIndex);
    }
  }, [setClips, activeClipIndex, clips]);

  // ── Generation (uses video text banks) ──
  const executeGeneration = useCallback(() => {
    const template = allVideos[0];
    if (!template?.clips || template.clips.length === 0) {
      toastError('No clips in timeline. Add clips first.');
      return;
    }
    const availableClips = (category?.videos || []).filter(v => !template.clips.some(tc => tc.id === v.id));
    if (availableClips.length === 0) {
      toastError('Need more clips available to generate.');
      return;
    }

    setIsGenerating(true);

    try {
      const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();
      const combinedBank = [...videoTextBank1, ...videoTextBank2];
      const existingGenCount = allVideos.filter(v => !v.isTemplate).length;
      const timestamp = Date.now();
      const generated = [];
      const templatesClipsCount = template.clips.length;

      for (let i = 0; i < generateCount; i++) {
        // Shuffle available clips and pick a random subset
        const shuffled = [...availableClips].sort(() => Math.random() - 0.5);
        const clipsToUse = shuffled.slice(0, templatesClipsCount);

        // Also shuffle the selected clips randomly
        const finalClips = [...clipsToUse].sort(() => Math.random() - 0.5);

        const newOverlays = template.textOverlays.map((overlay, idx) => {
          let newText = overlay.text;
          if (keepTemplateText === 'none') {
            const bank = idx === 0 ? videoTextBank1 : idx === 1 ? videoTextBank2 : combinedBank;
            if (bank.length > 0) {
              newText = bank[(existingGenCount + i) % bank.length];
            }
          }
          return {
            ...overlay,
            id: `text_${timestamp}_${i}_${idx}`,
            text: newText,
            scope: overlay.scope,
            startTime: overlay.startTime,
            endTime: overlay.endTime
          };
        });

        generated.push({
          id: `video_${timestamp}_${i}`,
          name: `Generated ${existingGenCount + i + 1}`,
          clips: finalClips,
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
    const categoryVideos = category?.videos || [];
    if (categoryVideos.length < 2) return;
    const template = allVideos[0];
    // Auto-populate template with first clip if empty (category loads async)
    if (!template?.clips || template.clips.length === 0) {
      setAllVideos(prev => {
        const copy = [...prev];
        copy[0] = { ...copy[0], clips: [categoryVideos[0]] };
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
    if (!video?.clips || video.clips.length === 0) {
      toastError('No clips to save.');
      return;
    }
    const timestamp = Date.now();
    const videoData = {
      id: video.id === 'template' ? (existingVideo?.id || `multivideo_${timestamp}`) : video.id,
      editorMode: 'multi-clip',
      name: video.name || 'Multi-Clip',
      clips: video.clips.map((clip, i) => {
        const clipUrl = clip.url || clip.localUrl || clip.src;
        const clipId = clip.id || clip.sourceId;
        return {
          id: `clip_${timestamp}_${i}`,
          sourceId: clip.id || clipId,
          url: clipUrl,
          localUrl: clip.localUrl || clipUrl,
          thumbnail: clip.thumbnailUrl || clip.thumbnail,
          startTime: 0,
          duration: getClipDuration(clipId),
          locked: true
        };
      }),
      textOverlays: video.textOverlays,
      audio: selectedAudio,
      cropMode: aspectRatio,
      duration: totalDuration,
      thumbnail: video.clips[0]?.thumbnailUrl || video.clips[0]?.thumbnail,
      isTemplate: video.isTemplate,
      status: 'draft',
      createdAt: existingVideo?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Audio mixing state
      sourceVideoMuted,
      sourceVideoVolume,
      externalAudioVolume
    };
    onSave(videoData);
    setLastSaved(new Date());
    toastSuccess(`Saved "${video.name || 'Multi-Clip'}"`);
  }, [allVideos, activeVideoIndex, totalDuration, aspectRatio, selectedAudio, existingVideo, sourceVideoMuted, sourceVideoVolume, externalAudioVolume, onSave, toastSuccess, toastError]);

  // ── Save All & Close ──
  const handleSaveAllAndClose = useCallback(async () => {
    if (isSavingAll) return;
    setIsSavingAll(true);
    let savedCount = 0;
    const timestamp = Date.now();
    for (const video of allVideos) {
      if (!video.clips || video.clips.length === 0) continue;
      const videoData = {
        id: video.id === 'template' ? (existingVideo?.id || `multivideo_${timestamp}_${savedCount}`) : video.id,
        editorMode: 'multi-clip',
        name: video.name || 'Multi-Clip',
        clips: video.clips.map((clip, i) => {
          const clipUrl = clip.url || clip.localUrl || clip.src;
          const clipId = clip.id || clip.sourceId;
          return {
            id: `clip_${timestamp}_${savedCount}_${i}`,
            sourceId: clip.id || clipId,
            url: clipUrl,
            localUrl: clip.localUrl || clipUrl,
            thumbnail: clip.thumbnailUrl || clip.thumbnail,
            startTime: 0,
            duration: getClipDuration(clipId),
            locked: true
          };
        }),
        textOverlays: video.textOverlays,
        audio: selectedAudio,
        cropMode: aspectRatio,
        duration: totalDuration,
        thumbnail: video.clips[0]?.thumbnailUrl || video.clips[0]?.thumbnail,
        isTemplate: video.isTemplate,
        status: 'draft',
        createdAt: existingVideo?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      try {
        await onSave(videoData);
      } catch (err) {
        log.error(`[MultiClipEditor] Failed to save video ${savedCount}:`, err);
        toastError(`Failed to save "${video.name || 'Multi-Clip'}". Please try again.`);
        setIsSavingAll(false);
        return; // Stop on failure so user doesn't lose context
      }
      savedCount++;
    }
    setIsSavingAll(false);
    toastSuccess(`Saved ${savedCount} video${savedCount !== 1 ? 's' : ''}!`);
    onClose();
  }, [allVideos, totalDuration, aspectRatio, selectedAudio, existingVideo, onSave, onClose, toastSuccess, toastError, isSavingAll]);

  // Export removed — was identical to Save Draft but set status='rendered' without actually rendering.
  // Real video export (FFmpeg render + download) will be added as a future feature.

  // ── Unsaved changes guard (beforeunload) ──
  const hasUnsavedWork = textOverlays.length > 0 || allVideos.length > 1 || clips.length > 0;
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
  const previewDims = isMobile
    ? { width: Math.min(window.innerWidth - 32, 300), height: Math.min(window.innerWidth - 32, 300) * (480 / 270) }
    : { width: 270, height: 480 };

  // Compute video style based on crop mode (aspect ratio)
  const getVideoCropStyle = () => {
    if (aspectRatio === '9:16') {
      return { width: '100%', height: '100%', objectFit: 'cover' };
    }
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

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Video text banks for right panel
  const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();

  // Get current clip for video display
  const currentClip = getCurrentClip();

  // BUG-032: Memoize overlay visibility check — called for every overlay on every render
  const isOverlayVisible = useCallback((overlay) => {
    // Time range check first
    if (overlay.startTime !== undefined && overlay.endTime !== undefined) {
      if (currentTime < overlay.startTime || currentTime >= overlay.endTime) return false;
    }
    // Scope check
    if (overlay.scope === 'full') return true;
    if (typeof overlay.scope === 'number') return overlay.scope === activeClipIndex;
    return true;
  }, [currentTime, activeClipIndex]);

  // ── RENDER ──
  return (
    <EditorShell onBackdropClick={handleCloseRequest} isMobile={isMobile}>
        <EditorTopBar
          title={videoName}
          onTitleChange={setVideoName}
          placeholder="Untitled Multi-Clip"
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onSave={handleSaveDraft}
          onExport={handleSaveDraft}
          onBack={handleCloseRequest}
          isMobile={isMobile}
        />

        {/* ── Main Content — Center + Right Sidebar (BeatSync layout) ── */}
        <div className={`flex grow shrink-0 basis-0 self-stretch overflow-hidden ${isMobile ? 'flex-col overflow-auto' : ''}`}>

          {/* ── CENTER COLUMN ── */}
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            {/* Center content area — centered, scrollable */}
            <div className={`flex-1 flex flex-col items-center overflow-auto gap-3 ${isMobile ? 'p-2' : 'p-4'}`}>
              <div className="flex flex-col items-center gap-3 w-full max-w-[448px]">

              {/* ── Video Preview ── */}
              <div
                ref={previewRef}
                className="relative rounded-lg overflow-hidden bg-[#1a1a1aff] flex-shrink-0 mx-auto"
                style={{
                  aspectRatio: '9/16',
                  height: '50vh'
                }}
                onClick={() => setEditingTextId(null)}
              >
              {currentClip ? (
                <video
                  ref={videoRef}
                  src={getClipUrl(currentClip)}
                  onLoadedMetadata={handleVideoLoaded}
                  onEnded={() => {
                    if (activeClipIndex < clips.length - 1) {
                      setActiveClipIndex(prev => prev + 1);
                      if (videoRef.current) videoRef.current.currentTime = 0;
                    } else {
                      // Last clip ended — check if audio is still playing (longer than total clips)
                      if (audioRef.current && audioRef.current.src && !audioRef.current.paused && audioRef.current.duration > totalDuration) {
                        return; // Audio continues — playbackLoop will switch to audio time
                      }
                      setIsPlaying(false);
                      if (animationRef.current) cancelAnimationFrame(animationRef.current);
                    }
                  }}
                  loop={false}
                  playsInline
                  style={{
                    ...getVideoCropStyle(),
                    borderRadius: '8px'
                  }}
                  crossOrigin="anonymous"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M10 9l5 3-5 3V9z" />
                  </svg>
                  <p style={{ color: theme.text.muted, marginTop: 8, fontSize: 12 }}>No clips in timeline</p>
                </div>
              )}

              {/* Text Overlays on video */}
              {textOverlays.map((overlay) => {
                if (!isOverlayVisible(overlay)) return null;

                const style = overlay.style || {};
                const pos = overlay.position || { x: 50, y: 50 };
                const displayText = style.textCase === 'upper' ? overlay.text.toUpperCase()
                  : style.textCase === 'lower' ? overlay.text.toLowerCase()
                  : overlay.text;

                return (
                  <div
                    key={overlay.id}
                    onMouseDown={(e) => handleTextMouseDown(e, overlay.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTextId(overlay.id);
                      setEditingTextValue(overlay.text);
                    }}
                    style={{
                      position: 'absolute',
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      transform: 'translate(-50%, -50%)',
                      cursor: draggingTextId === overlay.id ? 'grabbing' : 'grab',
                      fontSize: `${(style.fontSize || 48) * (previewDims.width / 1080) * 2}px`,
                      fontFamily: style.fontFamily || 'Inter, sans-serif',
                      fontWeight: style.fontWeight || '600',
                      color: style.color || '#ffffff',
                      textAlign: style.textAlign || 'center',
                      textShadow: style.outline
                        ? `2px 2px 0 ${style.outlineColor || '#000'}, -2px -2px 0 ${style.outlineColor || '#000'}, 2px -2px 0 ${style.outlineColor || '#000'}, -2px 2px 0 ${style.outlineColor || '#000'}`
                        : 'none',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      whiteSpace: 'nowrap',
                      zIndex: 10,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: editingTextId === overlay.id ? `1px dashed ${theme.accent.primary}99` : '1px dashed transparent',
                      transition: 'border-color 0.15s'
                    }}
                  >
                    {displayText}
                  </div>
                );
              })}
            </div>

              {/* Variation Tabs */}
              <div className="flex w-full overflow-auto gap-1">
                {allVideos.map((video, idx) => (
                  <div
                    key={video.id}
                    onClick={() => switchToVideo(idx)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium cursor-pointer whitespace-nowrap flex-shrink-0 transition-all ${idx === activeVideoIndex ? 'bg-brand-600/15 border border-brand-600/30 text-[#ffffffff]' : 'bg-neutral-800/50 border border-transparent text-neutral-400'}`}
                  >
                    {video.isTemplate ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
                    ) : (
                      <span style={{ fontSize: '10px', opacity: 0.6 }}>#{idx}</span>
                    )}
                    <span>{video.isTemplate ? 'Template' : video.name || `Video ${idx}`}</span>
                    {!video.isTemplate && (
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteVideo(idx); }} className="bg-transparent border-none text-neutral-500 text-[14px] cursor-pointer px-0.5 ml-0.5 leading-none">×</button>
                    )}
                  </div>
                ))}
              </div>

              {/* Generation Controls */}
              <div className="flex w-full items-center gap-2">
                <ToggleGroup value={keepTemplateText} onValueChange={(v) => v && setKeepTemplateText(v)}>
                  <ToggleGroup.Item value="none">Random</ToggleGroup.Item>
                  <ToggleGroup.Item value="all">Keep Text</ToggleGroup.Item>
                </ToggleGroup>
                <input
                  type="number" min={1} max={20} value={generateCount}
                  onChange={(e) => setGenerateCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="w-12 px-2 py-1.5 rounded-md border border-neutral-800 bg-black text-[#ffffffff] text-[13px] text-center outline-none"
                />
                <Button variant="brand-primary" size="small" onClick={executeGeneration} disabled={isGenerating}>
                  {isGenerating ? 'Remixing...' : 'Remix'}
                </Button>
              </div>

              {/* Reroll */}
              {(visibleVideos.length > 0 || (category?.videos?.length || 0) > 1) && (
                <Button variant="neutral-secondary" size="small" icon={<FeatherRefreshCw />} onClick={handleReroll}>Re-roll</Button>
              )}

              {/* Playback Controls */}
              <div className="flex w-full items-center justify-center gap-3">
                <IconButton variant="neutral-tertiary" size="small" icon={<FeatherSkipBack />} aria-label="Skip to start" onClick={() => handleSeek(0)} />
                <IconButton variant="neutral-secondary" size="medium" icon={isPlaying ? <FeatherPause /> : <FeatherPlay />} aria-label={isPlaying ? "Pause" : "Play"} onClick={handlePlayPause} />
                <IconButton variant="neutral-tertiary" size="small" icon={<FeatherSkipForward />} aria-label="Skip to end" onClick={() => handleSeek(timelineDuration)} />
                <IconButton variant="neutral-tertiary" size="small" icon={isMuted ? <FeatherVolumeX /> : <FeatherVolume2 />} aria-label={isMuted ? "Unmute" : "Mute"} onClick={() => setIsMuted(!isMuted)} />
              </div>


              </div>{/* end max-w-[448px] centered content */}
            </div>{/* end center scrollable area */}

          {/* ── MOBILE TOOL TOOLBAR + PANEL ── */}
          {isMobile && (
            <div style={{ width: '100%', flexShrink: 0 }}>
              {/* Mobile toolbar tabs */}
              <div style={{
                display: 'flex',
                borderTop: `1px solid ${theme.border.subtle}`,
                borderBottom: `1px solid ${theme.border.subtle}`,
                backgroundColor: theme.bg.page
              }}>
                {[
                  { id: 'clips', label: 'Clips', icon: '\uD83C\uDFAC' },
                  { id: 'text', label: 'Text', icon: '\uD83D\uDCDD' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setMobileToolTab(mobileToolTab === tab.id ? null : tab.id)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '2px',
                      padding: '10px 4px',
                      minHeight: '52px',
                      border: 'none',
                      backgroundColor: mobileToolTab === tab.id ? `${theme.accent.primary}26` : 'transparent',
                      color: mobileToolTab === tab.id ? theme.accent.hover : theme.text.secondary,
                      fontSize: '10px',
                      fontWeight: mobileToolTab === tab.id ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      borderBottom: mobileToolTab === tab.id ? `2px solid ${theme.accent.primary}` : '2px solid transparent'
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Mobile panel content */}
              {mobileToolTab && (
                <div style={{
                  maxHeight: '45vh',
                  overflowY: 'auto',
                  backgroundColor: theme.bg.input,
                  borderBottom: `1px solid ${theme.border.subtle}`
                }}>
                  {/* ── CLIPS TAB ── */}
                  {mobileToolTab === 'clips' && (
                    <div style={{ padding: '12px' }}>
                      {/* Collection dropdown */}
                      <select
                        value={selectedCollection}
                        onChange={(e) => setSelectedCollection(e.target.value)}
                        className="w-full px-3 py-2 bg-[#0a0a0aff] border border-neutral-800 rounded-lg text-[#ffffffff] text-[13px] outline-none cursor-pointer mb-2.5"
                      >
                        <option value="category">Selected Clips</option>
                        <option value="all">All Videos (Library)</option>
                        {collections.map(col => (
                          <option key={col.id} value={col.id}>{col.name}</option>
                        ))}
                      </select>

                      {/* Video grid */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '11px', color: theme.text.muted }}>{visibleVideos.length} clips</span>
                        <button
                          style={{ fontSize: '11px', color: '#14b8a6', background: 'none', border: 'none', cursor: 'pointer' }}
                          onClick={() => { visibleVideos.forEach(v => addClipToTimeline(v)); }}
                        >Add All</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '12px' }}>
                        {visibleVideos.map((video, i) => {
                          const isInTimeline = clips.some(clip => (clip.id === video.id) || (clip.sourceId === video.id));
                          return (
                            <div
                              key={video.id || i}
                              onClick={() => {
                                addClipToTimeline(video);
                                if (video.id && artistId) incrementUseCount(artistId, video.id);
                              }}
                              style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', border: isInTimeline ? '1px solid rgba(34,197,94,0.4)' : `1px solid ${theme.border.subtle}`, cursor: 'pointer', minHeight: '44px' }}
                            >
                              {isInTimeline && (
                                <div style={{ position: 'absolute', top: 2, right: 2, zIndex: 2, width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', fontWeight: 'bold' }}>✓</div>
                              )}
                              <div style={{ width: '100%', aspectRatio: '16/9', backgroundColor: theme.bg.page }}>
                                {(video.thumbnailUrl || video.thumbnail) ? (
                                  <img src={video.thumbnailUrl || video.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🎬</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Timeline */}
                      <div style={{ borderTop: `1px solid ${theme.border.subtle}`, paddingTop: '10px', marginBottom: '12px' }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text.primary }}>
                              Timeline ({clips.length} clip{clips.length !== 1 ? 's' : ''})
                            </span>
                            <Button variant="neutral-secondary" size="small" onClick={handleCutByWord}>Cut by word</Button>
                            <Button variant="neutral-secondary" size="small" onClick={handleCutByBeat}>Cut by beat</Button>
                          </div>
                          <Badge variant="neutral">
                            {isAnalyzing ? 'Analyzing beats...' : bpm ? `${Math.round(bpm)} BPM (${filteredBeats.length} beats)` : 'No beats detected'}
                          </Badge>
                        </div>
                        {clips.length === 0 ? (
                          <div style={{ fontSize: '11px', color: theme.text.muted, padding: '12px', textAlign: 'center', backgroundColor: theme.hover.bg, borderRadius: '6px' }}>
                            No clips added. Tap available clips to add them.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {clips.map((clip, idx) => (
                              <div
                                key={idx}
                                style={{
                                  padding: '8px', borderRadius: '6px', cursor: 'pointer', border: '1px solid transparent', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '8px',
                                  ...(activeClipIndex === idx ? { borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)' } : {}),
                                  minHeight: '44px'
                                }}
                                onClick={() => setActiveClipIndex(idx)}
                              >
                                <div style={{ fontSize: '10px', color: theme.text.secondary, fontWeight: 500, minWidth: '20px' }}>{idx + 1}.</div>
                                {clip.thumbnailUrl || clip.thumbnail ? (
                                  <img src={clip.thumbnailUrl || clip.thumbnail} alt="" style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }} />
                                ) : (
                                  <div style={{ width: '32px', height: '32px', borderRadius: '4px', backgroundColor: theme.hover.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <rect x="2" y="4" width="20" height="16" rx="2" />
                                      <path d="M10 9l5 3-5 3V9z" />
                                    </svg>
                                  </div>
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '11px', color: theme.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.name || 'Clip'}</div>
                                  <div style={{ fontSize: '9px', color: theme.text.muted }}>{formatTime(getClipDuration(clip.id || clip.sourceId))}</div>
                                </div>
                                <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                                  <button onClick={(e) => { e.stopPropagation(); moveClipUp(idx); }} disabled={idx === 0} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '12px', padding: '2px 6px', ...(idx === 0 ? { opacity: 0.3, cursor: 'not-allowed' } : {}), minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Move up">▲</button>
                                  <button onClick={(e) => { e.stopPropagation(); moveClipDown(idx); }} disabled={idx >= clips.length - 1} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '12px', padding: '2px 6px', ...(idx >= clips.length - 1 ? { opacity: 0.3, cursor: 'not-allowed' } : {}), minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Move down">▼</button>
                                  <button onClick={(e) => { e.stopPropagation(); removeClipFromTimeline(idx); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0 2px', minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Remove">×</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Text Banks */}
                      {(() => {
                        const { videoTextBank1: bankA, videoTextBank2: bankB } = getVideoTextBanks();
                        return (
                          <div style={{ borderTop: `1px solid ${theme.border.subtle}`, paddingTop: '10px' }}>
                            {/* Bank A */}
                            <div style={{ marginBottom: '12px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#14b8a6', marginBottom: '6px' }}>Text Bank A</div>
                              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                                <input value={newTextA} onChange={(e) => setNewTextA(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }} placeholder="Add text..." className="flex-1 px-2 py-1.5 rounded-md border border-neutral-800 bg-[#0a0a0aff] text-[#ffffffff] text-[12px] outline-none min-h-[44px]" />
                                <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} aria-label="Add to Text Bank A" onClick={() => { if (newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }} />
                              </div>
                              {bankA.map((text, idx) => (
                                <div key={idx} className="flex items-center px-2 py-1.5 rounded-md bg-neutral-800/50 mb-1 text-neutral-400 min-h-[36px]">
                                  <span style={{ flex: 1, fontSize: '12px', cursor: 'pointer' }} onClick={() => addTextOverlay(text)}>
                                    {text}
                                  </span>
                                  <button onClick={() => handleRemoveFromVideoTextBank(1, idx)} style={{ background: 'none', border: 'none', color: theme.text.muted, cursor: 'pointer', fontSize: '14px', padding: '0 2px' }}>×</button>
                                </div>
                              ))}
                              {bankA.length === 0 && <div style={{ fontSize: '11px', color: theme.text.muted }}>No text added yet</div>}
                            </div>
                            {/* Bank B */}
                            <div>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '6px' }}>Text Bank B</div>
                              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                                <input value={newTextB} onChange={(e) => setNewTextB(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }} placeholder="Add text..." className="flex-1 px-2 py-1.5 rounded-md border border-neutral-800 bg-[#0a0a0aff] text-[#ffffffff] text-[12px] outline-none min-h-[44px]" />
                                <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} aria-label="Add to Text Bank B" onClick={() => { if (newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }} />
                              </div>
                              {bankB.map((text, idx) => (
                                <div key={idx} className="flex items-center px-2 py-1.5 rounded-md bg-neutral-800/50 mb-1 text-neutral-400 min-h-[36px]">
                                  <span style={{ flex: 1, fontSize: '12px', cursor: 'pointer' }} onClick={() => addTextOverlay(text)}>
                                    {text}
                                  </span>
                                  <button onClick={() => handleRemoveFromVideoTextBank(2, idx)} style={{ background: 'none', border: 'none', color: theme.text.muted, cursor: 'pointer', fontSize: '14px', padding: '0 2px' }}>×</button>
                                </div>
                              ))}
                              {bankB.length === 0 && <div style={{ fontSize: '11px', color: theme.text.muted }}>No text added yet</div>}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* ── TEXT TAB ── */}
                  {mobileToolTab === 'text' && (
                    <div style={{ padding: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text.primary, marginBottom: '8px' }}>
                        Text Overlays ({textOverlays.length})
                      </div>

                      {textOverlays.length === 0 && (
                        <div style={{ fontSize: '12px', color: theme.text.muted, textAlign: 'center', padding: '16px 12px' }}>
                          No text overlays yet. Add one to start designing.
                        </div>
                      )}

                      {textOverlays.map((overlay, idx) => {
                        const isSelected = editingTextId === overlay.id;
                        return (
                          <div
                            key={overlay.id}
                            onClick={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}
                            className={`mx-0 mb-1.5 p-2.5 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-brand-600/10 border border-brand-600/30' : 'bg-neutral-800/50 border border-neutral-800'}`}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ fontSize: '11px', color: theme.text.secondary, fontWeight: 500 }}>
                                Overlay {idx + 1}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }}
                                className="bg-transparent border-none text-neutral-500 text-[16px] cursor-pointer px-1 leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
                              >&#215;</button>
                            </div>
                            {isSelected ? (
                              <input
                                value={editingTextValue}
                                onChange={(e) => setEditingTextValue(e.target.value)}
                                onBlur={() => updateTextOverlay(overlay.id, { text: editingTextValue })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { updateTextOverlay(overlay.id, { text: editingTextValue }); e.target.blur(); } }}
                                className="w-full px-2 py-1.5 rounded border border-brand-600/30 bg-[#1a1a1aff] text-[#ffffffff] text-[14px] outline-none box-border min-h-[44px]"
                                autoFocus
                              />
                            ) : (
                              <div style={{ fontSize: '13px', color: theme.text.primary }}>{overlay.text}</div>
                            )}

                            {isSelected && (
                              <div className="mt-2 flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                                {/* Font Family */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] text-neutral-400 min-w-[34px]">Font</span>
                                  <select
                                    value={overlay.style.fontFamily}
                                    onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, fontFamily: e.target.value } })}
                                    className="flex-1 px-1.5 py-0.5 rounded border border-neutral-800 bg-[#1a1a1aff] text-[#ffffffff] text-[11px] min-h-[44px]"
                                  >
                                    <option value="Inter, sans-serif">Sans</option>
                                    <option value="'Playfair Display', serif">Serif</option>
                                    <option value="'Space Grotesk', sans-serif">Grotesk</option>
                                    <option value="monospace">Mono</option>
                                  </select>
                                </div>
                                {/* Font Size */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] text-neutral-400 min-w-[34px]">Size</span>
                                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                    <button
                                      className="px-2 py-0.5 rounded border border-neutral-800 bg-neutral-800/50 text-[#ffffffff] text-[11px] cursor-pointer min-w-[44px] min-h-[44px]"
                                      onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.max(16, overlay.style.fontSize - 4) } }); }}
                                    >A-</button>
                                    <span style={{ fontSize: '11px', color: theme.text.primary, minWidth: '26px', textAlign: 'center' }}>{overlay.style.fontSize}</span>
                                    <button
                                      className="px-2 py-0.5 rounded border border-neutral-800 bg-neutral-800/50 text-[#ffffffff] text-[11px] cursor-pointer min-w-[44px] min-h-[44px]"
                                      onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.min(120, overlay.style.fontSize + 4) } }); }}
                                    >A+</button>
                                  </div>
                                </div>
                                {/* Color + Outline */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] text-neutral-400 min-w-[34px]">Color</span>
                                  <input
                                    type="color"
                                    value={overlay.style.color}
                                    onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, color: e.target.value } })}
                                    className="w-11 h-11 rounded border border-neutral-800 cursor-pointer bg-transparent p-0"
                                  />
                                  <span className="text-[10px] text-neutral-400 min-w-[34px] ml-2">Outline</span>
                                  <button
                                    className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer transition-all min-w-[44px] min-h-[44px] ${overlay.style.outline ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 bg-transparent text-neutral-400'}`}
                                    onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, outline: !overlay.style.outline } }); }}
                                  >{overlay.style.outline ? 'On' : 'Off'}</button>
                                </div>
                                {/* Scope */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] text-neutral-400 min-w-[34px]">Scope</span>
                                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                    <button
                                      className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer transition-all min-h-[44px] px-2.5 py-1.5 ${overlay.scope === 'full' ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 bg-transparent text-neutral-400'}`}
                                      onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { scope: 'full' }); }}
                                    >Full Video</button>
                                    {clips.map((_, i) => (
                                      <button
                                        key={i}
                                        className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer transition-all min-h-[44px] px-2.5 py-1.5 ${overlay.scope === i ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 bg-transparent text-neutral-400'}`}
                                        onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { scope: i }); }}
                                      >Clip {i + 1}</button>
                                    ))}
                                  </div>
                                </div>
                                {/* Save to Bank */}
                                <div className="flex items-center gap-1.5 flex-wrap border-t border-neutral-800 pt-1.5 mt-0.5">
                                  <span style={{ fontSize: '10px', color: theme.text.secondary }}>Save to:</span>
                                  <button
                                    className="px-2 py-0.5 rounded border border-teal-500/30 bg-transparent text-teal-500 text-[10px] cursor-pointer transition-all min-h-[44px] px-2.5 py-1.5"
                                    onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(1, overlay.text); toastSuccess('Saved to Bank A'); }}
                                  >Bank A</button>
                                  <button
                                    className="px-2 py-0.5 rounded border border-amber-500/30 bg-transparent text-amber-500 text-[10px] cursor-pointer transition-all min-h-[44px] px-2.5 py-1.5"
                                    onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(2, overlay.text); toastSuccess('Saved to Bank B'); }}
                                  >Bank B</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <Button variant="brand-secondary" size="small" icon={<FeatherPlus />} onClick={() => addTextOverlay()}>Add Text Overlay</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}


        {/* ── Timeline (labeled tracks) ── */}
        {!isMobile && (
          <div className="flex w-full flex-col border-t border-neutral-800 bg-[#1a1a1aff] px-4 py-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Timeline</span>
            </div>
            <div ref={timelineRef} className="flex w-full flex-col gap-2 relative" style={{ cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none' }}
              onClick={(e) => {
                if (playheadDragging) return;
                if (e.target === e.currentTarget || e.target.dataset?.timelineClickable) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const time = (clickX / rect.width) * (timelineDuration || 1);
                  handleSeek(Math.max(0, Math.min(timelineDuration || 0, time)));
                }
              }}
            >
              {/* Text Track */}
              <div className="flex items-center gap-3">
                <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Text</span>
                <div className="flex-1 h-12 rounded-md border border-neutral-800 bg-black relative overflow-hidden" data-timeline-clickable="true">
                  {textOverlays.map((overlay) => {
                    const startPct = timelineDuration > 0 ? ((overlay.startTime || 0) / timelineDuration) * 100 : 0;
                    const widthPct = timelineDuration > 0 ? (((overlay.endTime || 0) - (overlay.startTime || 0)) / timelineDuration) * 100 : 10;
                    const isSelected = editingTextId === overlay.id;
                    return (
                      <div key={overlay.id} style={{ position: 'absolute', left: `${startPct}%`, width: `${widthPct}%`, top: '4px', height: 'calc(100% - 8px)', backgroundColor: isSelected ? '#9333ea' : '#6366f1', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 4px', cursor: timelineDrag ? 'grabbing' : 'grab', overflow: 'hidden', border: isSelected ? '1px solid #a855f7' : '1px solid rgba(124,58,237,0.5)', zIndex: isSelected ? 10 : 5 }}
                        onMouseDown={(e) => handleTimelineDragStart(e, overlay.id, 'move')}
                      >
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', cursor: 'col-resize', zIndex: 11 }}
                          onMouseDown={(e) => { e.stopPropagation(); handleTimelineDragStart(e, overlay.id, 'left'); }} />
                        <span style={{ fontSize: '10px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', padding: '0 6px' }}>{overlay.text}</span>
                        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '6px', cursor: 'col-resize', zIndex: 11 }}
                          onMouseDown={(e) => { e.stopPropagation(); handleTimelineDragStart(e, overlay.id, 'right'); }} />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Clips Track */}
              <div className="flex items-center gap-3">
                <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Clips</span>
                <div className="flex-1 h-12 rounded-md border border-neutral-800 bg-black relative overflow-hidden">
                  {clips.map((clipItem, idx) => {
                    const clipId = clipItem.id || clipItem.sourceId;
                    const clipDur = getClipDuration(clipId);
                    let accBefore = 0;
                    for (let j = 0; j < idx; j++) { accBefore += getClipDuration(clips[j].id || clips[j].sourceId); }
                    const leftPct = timelineDuration > 0 ? (accBefore / timelineDuration) * 100 : 0;
                    const widthPct = timelineDuration > 0 ? (clipDur / timelineDuration) * 100 : 100;
                    return (
                      <div key={idx} style={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: '2px', height: 'calc(100% - 4px)', backgroundColor: activeClipIndex === idx ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden', border: activeClipIndex === idx ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {(clipItem.thumbnailUrl || clipItem.thumbnail) && <img src={clipItem.thumbnailUrl || clipItem.thumbnail} alt="" style={{ width: '40px', height: '100%', objectFit: 'cover', opacity: 0.6, flexShrink: 0 }} />}
                        <span style={{ fontSize: '9px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>{clipItem.name || `Clip ${idx + 1}`}</span>
                      </div>
                    );
                  })}
                  {/* Clip cut lines */}
                  {clipCutPoints.slice(1, -1).map((cutTime, i) => (
                    <div key={`cut-${i}`} style={{ position: 'absolute', left: `${(cutTime / timelineDuration) * 100}%`, top: 0, bottom: 0, width: '1px', backgroundColor: 'rgba(234,179,8,0.4)', zIndex: 15, pointerEvents: 'none' }} />
                  ))}
                </div>
              </div>

              {/* Audio Track (external) */}
              {selectedAudio && !selectedAudio.isSourceVideo && waveformData.length > 0 && (
                <div className="flex items-center gap-3">
                  <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0 flex items-center justify-end gap-1">
                    <FeatherMusic className="w-3 h-3" />Audio
                  </span>
                  <div className="flex-1 h-8 rounded-md border border-neutral-800 bg-black relative overflow-hidden">
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 0 }}>
                      {waveformData.map((amplitude, i) => (
                        <div key={i} style={{ flex: 1, backgroundColor: 'rgba(34, 197, 94, 0.5)', height: `${amplitude * 100}%`, opacity: 0.6 }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Source Audio Track */}
              {Object.keys(clipWaveforms).length > 0 && (
                <div className="flex items-center gap-3">
                  <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Source</span>
                  <div className="flex-1 h-8 rounded-md border border-neutral-800 bg-black relative overflow-hidden">
                    {clips.map((clipItem, idx) => {
                      const clipId = clipItem.id || clipItem.sourceId;
                      const clipDur = getClipDuration(clipId);
                      let accBefore = 0;
                      for (let j = 0; j < idx; j++) { accBefore += getClipDuration(clips[j].id || clips[j].sourceId); }
                      const leftPct = timelineDuration > 0 ? (accBefore / timelineDuration) * 100 : 0;
                      const widthPct = timelineDuration > 0 ? (clipDur / timelineDuration) * 100 : 100;
                      const data = clipWaveforms[clipId] || [];
                      return (
                        <div key={idx} style={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 0, borderRight: idx < clips.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
                          {data.map((amplitude, i) => (
                            <div key={i} style={{ flex: 1, backgroundColor: 'rgba(245, 158, 11, 0.4)', height: `${amplitude * 100}%`, opacity: sourceVideoMuted ? 0.3 : 0.6 }} />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Playhead */}
              {timelineDuration > 0 && (
                <div style={{ position: 'absolute', left: `${(currentTime / timelineDuration) * 100}%`, top: 0, bottom: 0, width: '2px', backgroundColor: '#ef4444', zIndex: 20, pointerEvents: 'auto', cursor: 'ew-resize', transition: (isPlaying && !playheadDragging) ? 'none' : playheadDragging ? 'none' : 'left 0.1s ease-out' }}
                  onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setPlayheadDragging(true);
                    document.body.style.userSelect = 'none'; document.body.style.WebkitUserSelect = 'none';
                    const wasPlaying = isPlaying;
                    if (isPlaying) { videoRef.current?.pause(); audioRef.current?.pause(); cancelAnimationFrame(animationRef.current); setIsPlaying(false); }
                    const handleDragMove = (moveE) => {
                      const rect = timelineRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const pct = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width));
                      handleSeek(pct * timelineDuration);
                    };
                    const handleDragEnd = () => {
                      setPlayheadDragging(false);
                      document.body.style.userSelect = ''; document.body.style.WebkitUserSelect = '';
                      window.removeEventListener('mousemove', handleDragMove);
                      window.removeEventListener('mouseup', handleDragEnd);
                      if (wasPlaying) { videoRef.current?.play(); if (audioRef.current?.src) audioRef.current.play().catch(() => {}); animationRef.current = requestAnimationFrame(playbackLoop); setIsPlaying(true); }
                    };
                    window.addEventListener('mousemove', handleDragMove);
                    window.addEventListener('mouseup', handleDragEnd);
                  }}
                >
                  <div style={{ position: 'absolute', left: '-6px', right: '-6px', top: 0, bottom: 0, cursor: 'ew-resize' }} />
                  <div style={{ position: 'absolute', top: '-2px', left: '50%', transform: 'translateX(-50%)', width: '10px', height: '10px', backgroundColor: '#ef4444', borderRadius: '2px', clipPath: 'polygon(0 0, 100% 0, 50% 100%)', cursor: 'ew-resize' }} />
                </div>
              )}
            </div>
          </div>
        )}

          </div>{/* end center column */}

          {/* ── RIGHT SIDEBAR ── */}
          {!isMobile && (
            <div className="flex w-96 flex-none flex-col border-l border-neutral-800 bg-[#1a1a1aff] overflow-auto">

              {renderCollapsibleSection('audio', 'Audio', (
                <div className="flex flex-col gap-3">
                  {selectedAudio ? (
                    <>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-black/50">
                        <FeatherMusic className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        <span className="text-body font-body text-[#ffffffff] flex-1 truncate">{selectedAudio.name}</span>
                        {selectedAudio.isTrimmed && <Badge>Trimmed</Badge>}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="neutral-secondary" size="small" icon={<FeatherScissors />} onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}>Trim</Button>
                        <Button variant="destructive-tertiary" size="small" icon={<FeatherTrash2 />} onClick={() => {
                          if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
                          if (animationRef.current) cancelAnimationFrame(animationRef.current);
                          setSelectedAudio(null); setIsPlaying(false); setCurrentTime(0); setAudioDuration(0); setSourceVideoMuted(false);
                        }}>Remove</Button>
                      </div>
                      {/* Volume controls */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-caption font-caption text-neutral-400 w-16">Added</span>
                          <input type="range" min="0" max="1" step="0.05" value={externalAudioVolume}
                            onChange={e => setExternalAudioVolume(parseFloat(e.target.value))}
                            className="flex-1 h-1 accent-purple-500 cursor-pointer" />
                          <span className="text-caption font-caption text-neutral-400 w-8">{Math.round(externalAudioVolume * 100)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-caption font-caption text-neutral-400 w-16">Source</span>
                          <input type="range" min="0" max="1" step="0.05" value={sourceVideoVolume}
                            onChange={e => setSourceVideoVolume(parseFloat(e.target.value))}
                            className="flex-1 h-1 accent-blue-500 cursor-pointer"
                            style={{ opacity: sourceVideoMuted ? 0.3 : 1, pointerEvents: sourceVideoMuted ? 'none' : 'auto' }} />
                          <span className="text-caption font-caption text-neutral-400 w-8" style={{ opacity: sourceVideoMuted ? 0.3 : 1 }}>{Math.round(sourceVideoVolume * 100)}%</span>
                        </div>
                        <Button variant={sourceVideoMuted ? 'destructive-secondary' : 'neutral-tertiary'} size="small" onClick={() => setSourceVideoMuted(m => !m)}>
                          {sourceVideoMuted ? 'Source Muted' : 'Mute Source'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-neutral-500 text-caption font-caption py-4">No audio selected</div>
                  )}
                  <Button variant="neutral-secondary" size="small" icon={<FeatherUpload />} onClick={() => audioFileInputRef.current?.click()}>Upload Audio</Button>
                  <input ref={audioFileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleAudioUpload} />
                  {libraryAudio.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      <span className="text-caption font-caption text-neutral-500">Library Audio</span>
                      {libraryAudio.map(audio => (
                        <div key={audio.id} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-neutral-800 transition-colors"
                          onClick={() => { setAudioToTrim(audio); setShowAudioTrimmer(true); }}>
                          <FeatherMusic className="w-3 h-3 text-neutral-500" />
                          <span className="text-body font-body text-neutral-300 text-[12px] truncate flex-1">{audio.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {renderCollapsibleSection('clips', 'Clips', (
                <div className="flex flex-col gap-3">
                  {/* Collection dropdown */}
                  <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)}
                    className="w-full px-3 py-2 bg-black border border-neutral-800 rounded-lg text-[#ffffffff] text-[13px] outline-none cursor-pointer">
                    <option value="category">Selected Clips</option>
                    <option value="all">All Videos (Library)</option>
                    {collections.map(col => <option key={col.id} value={col.id}>{col.name}</option>)}
                  </select>
                  {/* Video grid */}
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-caption font-caption text-neutral-500">{visibleVideos.length} clips</span>
                      {visibleVideos.length > 0 && (
                        <button className="text-caption font-caption text-indigo-400 hover:text-indigo-300" onClick={selectAllClips}>
                          {selectedClipIds.size === visibleVideos.length ? 'Deselect All' : 'Select All'}
                        </button>
                      )}
                      {selectedClipIds.size > 0 && (
                        <span className="text-caption font-caption text-neutral-500">{selectedClipIds.size} sel</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CloudImportButton artistId={artistId} db={db} mediaType="video" compact
                        onImportMedia={(files) => { const newVids = files.map((f, i) => ({ id: `import_${Date.now()}_${i}`, name: f.name, url: f.url, localUrl: f.localUrl, type: 'video' })); setLibraryMedia(prev => [...prev, ...newVids]); }} />
                      <button className="text-[11px] text-teal-400 bg-transparent border-none cursor-pointer"
                        onClick={() => { visibleVideos.forEach(v => addClipToTimeline(v)); }}>Add All</button>
                    </div>
                  </div>
                  {selectedClipIds.size > 0 && (
                    <Button variant="brand-secondary" size="small" className="w-full" onClick={() => {
                      const selected = visibleVideos.filter(v => selectedClipIds.has(v.id));
                      selected.forEach(v => addClipToTimeline(v));
                      clearClipSelection();
                      toastSuccess(`Added ${selected.length} clip${selected.length !== 1 ? 's' : ''} to timeline`);
                    }}>
                      Add {selectedClipIds.size} to Timeline
                    </Button>
                  )}
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
                        const isInTimeline = clips.some(clip => (clip.id === video.id) || (clip.sourceId === video.id));
                        const isSelected = selectedClipIds.has(video.id);
                        return (
                          <div key={video.id || i}
                            data-media-id={video.id}
                            className={`relative rounded-md overflow-hidden cursor-pointer border-2 transition-colors ${
                              isSelected ? 'border-indigo-500' : 'border-transparent hover:border-teal-500/50'
                            }`}
                            style={!isSelected && isInTimeline ? { borderColor: 'rgba(34,197,94,0.4)' } : undefined}
                            onClick={(e) => {
                              if (clipDragSelecting) return;
                              if (e.shiftKey || selectedClipIds.size > 0) {
                                toggleClipSelect(video.id, e);
                              } else {
                                addClipToTimeline(video);
                                if (video.id && artistId) incrementUseCount(artistId, video.id);
                              }
                            }}>
                            {isSelected && (
                              <div className="absolute top-1 left-1 z-10 h-4 w-4 rounded-full bg-indigo-500 flex items-center justify-center">
                                <FeatherCheck className="text-white" style={{ width: 10, height: 10 }} />
                              </div>
                            )}
                            {isInTimeline && !isSelected && <div className="absolute top-1 right-1 z-10 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-[9px] text-white font-bold">&#10003;</div>}
                            <div className="w-full aspect-video bg-black">
                              {(video.thumbnailUrl || video.thumbnail) ? <img src={video.thumbnailUrl || video.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-neutral-600 text-lg">&#127916;</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Clip ordering */}
                  <div className="border-t border-neutral-800 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-caption font-caption text-neutral-400">Timeline ({clips.length} clip{clips.length !== 1 ? 's' : ''})</span>
                      <div className="flex items-center gap-1">
                        <Button variant="neutral-secondary" size="small" onClick={handleCutByWord}>Cut by word</Button>
                        <Button variant="neutral-secondary" size="small" onClick={handleCutByBeat}>Cut by beat</Button>
                      </div>
                    </div>
                    <Badge variant="neutral" className="mb-2">
                      {isAnalyzing ? 'Analyzing beats...' : bpm ? `${Math.round(bpm)} BPM (${filteredBeats.length} beats)` : 'No beats detected'}
                    </Badge>
                    {clips.length === 0 ? (
                      <div className="text-[11px] text-neutral-600 text-center py-3 bg-neutral-800/30 rounded-md">No clips added yet</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {clips.map((clip, idx) => (
                          <div key={idx} className={`flex items-center gap-2 p-1.5 rounded-md cursor-pointer ${activeClipIndex === idx ? 'bg-brand-600/10 border border-brand-600/30' : 'bg-neutral-800/30 border border-transparent'}`}
                            onClick={() => setActiveClipIndex(idx)}>
                            <span className="text-[10px] text-neutral-500 w-4">{idx + 1}.</span>
                            {(clip.thumbnailUrl || clip.thumbnail) ? <img src={clip.thumbnailUrl || clip.thumbnail} alt="" className="w-7 h-7 rounded object-cover" /> : <div className="w-7 h-7 rounded bg-neutral-800 flex items-center justify-center text-[10px]">&#127916;</div>}
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] text-[#ffffffff] truncate">{clip.name || 'Clip'}</div>
                              <div className="text-[9px] text-neutral-500">{formatTime(getClipDuration(clip.id || clip.sourceId))}</div>
                            </div>
                            <div className="flex gap-0.5 flex-shrink-0">
                              <IconButton variant="neutral-tertiary" size="small" icon={<FeatherChevronUp />} aria-label="Move clip up" disabled={idx === 0} onClick={(e) => { e.stopPropagation(); moveClipUp(idx); }} />
                              <IconButton variant="neutral-tertiary" size="small" icon={<FeatherChevronDown />} aria-label="Move clip down" disabled={idx >= clips.length - 1} onClick={(e) => { e.stopPropagation(); moveClipDown(idx); }} />
                              <IconButton variant="neutral-tertiary" size="small" icon={<FeatherTrash2 />} aria-label="Remove clip" onClick={(e) => { e.stopPropagation(); removeClipFromTimeline(idx); }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Text Banks A/B */}
                  {(() => {
                    const { videoTextBank1: bankA, videoTextBank2: bankB } = getVideoTextBanks();
                    return (
                      <div className="flex flex-col gap-3 border-t border-neutral-800 pt-3">
                        <div>
                          <span className="text-[12px] font-semibold text-teal-400 mb-2 block">Text Bank A</span>
                          <div className="flex gap-1.5 mb-2">
                            <input value={newTextA} onChange={(e) => setNewTextA(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }}
                              placeholder="Add text..." className="flex-1 px-2 py-1.5 rounded-md border border-neutral-800 bg-black text-[#ffffffff] text-[12px] outline-none" />
                            <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} aria-label="Add to Text Bank A" onClick={() => { if (newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }} />
                          </div>
                          {bankA.map((text, idx) => (
                            <div key={idx} className="flex items-center px-2 py-1 rounded-md bg-neutral-800/50 mb-1">
                              <span className="flex-1 text-[12px] text-neutral-300 cursor-pointer" onClick={() => addTextOverlay(text)}>{text}</span>
                              <button onClick={() => handleRemoveFromVideoTextBank(1, idx)} className="bg-transparent border-none text-neutral-600 cursor-pointer text-[14px] px-1">&#215;</button>
                            </div>
                          ))}
                          {bankA.length === 0 && <span className="text-[11px] text-neutral-600">No text added yet</span>}
                        </div>
                        <div>
                          <span className="text-[12px] font-semibold text-amber-400 mb-2 block">Text Bank B</span>
                          <div className="flex gap-1.5 mb-2">
                            <input value={newTextB} onChange={(e) => setNewTextB(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }}
                              placeholder="Add text..." className="flex-1 px-2 py-1.5 rounded-md border border-neutral-800 bg-black text-[#ffffffff] text-[12px] outline-none" />
                            <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} aria-label="Add to Text Bank B" onClick={() => { if (newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }} />
                          </div>
                          {bankB.map((text, idx) => (
                            <div key={idx} className="flex items-center px-2 py-1 rounded-md bg-neutral-800/50 mb-1">
                              <span className="flex-1 text-[12px] text-neutral-300 cursor-pointer" onClick={() => addTextOverlay(text)}>{text}</span>
                              <button onClick={() => handleRemoveFromVideoTextBank(2, idx)} className="bg-transparent border-none text-neutral-600 cursor-pointer text-[14px] px-1">&#215;</button>
                            </div>
                          ))}
                          {bankB.length === 0 && <span className="text-[11px] text-neutral-600">No text added yet</span>}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Niche Text Banks */}
                  {nicheTextBanks && nicheTextBanks.some(b => b?.length > 0) && (
                    <div className="flex flex-col gap-3 pt-3 border-t border-neutral-800">
                      <div className="text-body-bold font-body-bold text-neutral-300">Niche Banks</div>
                      {nicheTextBanks.map((bank, bankIdx) => {
                        if (!bank?.length) return null;
                        const color = getBankColor(bankIdx);
                        return (
                          <div key={bankIdx}>
                            <div className="text-[12px] font-semibold mb-1.5" style={{ color: color.primary }}>{getBankLabel(bankIdx)}</div>
                            {bank.map((entry, entryIdx) => {
                              const text = typeof entry === 'string' ? entry : entry?.text || '';
                              if (!text) return null;
                              return (
                                <div key={entryIdx} className="flex items-center px-2 py-1 rounded-md mb-0.5 cursor-pointer hover:bg-neutral-800/50"
                                  style={{ borderLeft: `2px solid ${color.primary}` }}
                                  onClick={() => addTextOverlay(text)}>
                                  <span className="text-[12px] text-neutral-300 truncate">{text}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              {renderCollapsibleSection('lyrics', 'Lyrics', (
                <div className="flex flex-col gap-3">
                  {lyricsBank.length === 0 ? (
                    <div className="text-center text-neutral-500 text-caption font-caption py-4">No lyrics in bank yet</div>
                  ) : (
                    lyricsBank.map(lyric => (
                      <div key={lyric.id} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-neutral-800 transition-colors"
                        onClick={() => addTextOverlay(lyric.content || lyric.title || '')}>
                        <FeatherDatabase className="w-3 h-3 text-neutral-500" />
                        <span className="text-body font-body text-neutral-300 text-[12px] truncate flex-1">{lyric.title || lyric.content?.slice(0, 30) || 'Untitled'}</span>
                      </div>
                    ))
                  )}
                  <Button variant="neutral-secondary" size="small" icon={<FeatherMic />}
                    disabled={!selectedAudio}
                    onClick={() => setShowTranscriber(true)}>AI Transcribe</Button>
                </div>
              ))}

              {renderCollapsibleSection('textStyle', 'Text Style', (
                <div className="flex flex-col gap-2">
                  <Button variant="brand-secondary" size="small" icon={<FeatherPlus />} onClick={() => addTextOverlay()}>Add Text Overlay</Button>
                  {textOverlays.length === 0 && <div className="text-center text-neutral-500 text-caption font-caption py-3">No text overlays yet</div>}
                  {textOverlays.map((overlay, idx) => {
                    const isSelected = editingTextId === overlay.id;
                    return (
                      <div key={overlay.id}
                        onClick={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}
                        className={`p-2.5 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-brand-600/10 border border-brand-600/30' : 'bg-neutral-800/50 border border-neutral-800'}`}>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-[11px] text-neutral-400 font-medium">
                            Overlay {idx + 1}
                            {overlay.startTime !== undefined && <span className="ml-1.5 text-[9px] text-neutral-600">{overlay.startTime.toFixed(1)}s &#8211; {overlay.endTime.toFixed(1)}s</span>}
                          </span>
                          <IconButton size="small" icon={<FeatherX />} aria-label="Remove overlay" onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }} />
                        </div>
                        {isSelected ? (
                          <input value={editingTextValue} onChange={(e) => setEditingTextValue(e.target.value)}
                            onBlur={() => updateTextOverlay(overlay.id, { text: editingTextValue })}
                            onKeyDown={(e) => { if (e.key === 'Enter') { updateTextOverlay(overlay.id, { text: editingTextValue }); e.target.blur(); } }}
                            className="w-full px-2 py-1.5 rounded border border-brand-600/30 bg-black text-[#ffffffff] text-[13px] outline-none"
                            autoFocus />
                        ) : (
                          <div className="text-[13px] text-[#ffffffff]">{overlay.text}</div>
                        )}
                        {isSelected && (
                          <div className="mt-2 flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                            {/* Font */}
                            <div className="flex items-center gap-1.5"><span className="text-[10px] text-neutral-400 w-9">Font</span>
                              <select value={overlay.style.fontFamily} onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, fontFamily: e.target.value } })}
                                className="flex-1 px-1.5 py-0.5 rounded border border-neutral-800 bg-black text-[#ffffffff] text-[11px]">
                                <option value="Inter, sans-serif">Sans</option><option value="'Playfair Display', serif">Serif</option><option value="'Space Grotesk', sans-serif">Grotesk</option><option value="monospace">Mono</option>
                              </select>
                            </div>
                            {/* Size */}
                            <div className="flex items-center gap-1.5"><span className="text-[10px] text-neutral-400 w-9">Size</span>
                              <button className="px-2 py-0.5 rounded border border-neutral-800 bg-neutral-800/50 text-[#ffffffff] text-[11px] cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.max(16, overlay.style.fontSize - 4) } }); }}>A-</button>
                              <span className="text-[11px] text-[#ffffffff] min-w-[26px] text-center">{overlay.style.fontSize}</span>
                              <button className="px-2 py-0.5 rounded border border-neutral-800 bg-neutral-800/50 text-[#ffffffff] text-[11px] cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.min(120, overlay.style.fontSize + 4) } }); }}>A+</button>
                            </div>
                            {/* Color + Outline */}
                            <div className="flex items-center gap-1.5 flex-wrap"><span className="text-[10px] text-neutral-400 w-9">Color</span>
                              <input type="color" value={overlay.style.color} onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, color: e.target.value } })} className="w-6 h-6 rounded border border-neutral-800 cursor-pointer bg-transparent p-0" />
                              <span className="text-[10px] text-neutral-400 w-9 ml-2">Outline</span>
                              <button className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${overlay.style.outline ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 bg-transparent text-neutral-400'}`}
                                onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, outline: !overlay.style.outline } }); }}>{overlay.style.outline ? 'On' : 'Off'}</button>
                              {overlay.style.outline && <input type="color" value={overlay.style.outlineColor} onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, outlineColor: e.target.value } })} className="w-6 h-6 rounded border border-neutral-800 cursor-pointer bg-transparent p-0" />}
                            </div>
                            {/* Align */}
                            <div className="flex items-center gap-1.5"><span className="text-[10px] text-neutral-400 w-9">Align</span>
                              <div className="flex gap-1">{['left', 'center', 'right'].map(a => (
                                <button key={a} className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${overlay.style.textAlign === a ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 bg-transparent text-neutral-400'}`}
                                  onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, textAlign: a } }); }}>{a.charAt(0).toUpperCase() + a.slice(1)}</button>
                              ))}</div>
                            </div>
                            {/* Case */}
                            <div className="flex items-center gap-1.5"><span className="text-[10px] text-neutral-400 w-9">Case</span>
                              <div className="flex gap-1">{[{ id: 'default', label: 'Aa' }, { id: 'upper', label: 'AA' }, { id: 'lower', label: 'aa' }].map(opt => (
                                <button key={opt.id} className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${overlay.style.textCase === opt.id ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 bg-transparent text-neutral-400'}`}
                                  onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, textCase: opt.id } }); }}>{opt.label}</button>
                              ))}</div>
                            </div>
                            {/* Scope */}
                            <div className="flex items-center gap-1.5 flex-wrap"><span className="text-[10px] text-neutral-400 w-9">Scope</span>
                              <div className="flex gap-1 flex-wrap">
                                <button className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${overlay.scope === 'full' ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 bg-transparent text-neutral-400'}`}
                                  onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { scope: 'full' }); }}>Full Video</button>
                                {clips.map((_, i) => (
                                  <button key={i} className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${overlay.scope === i ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 bg-transparent text-neutral-400'}`}
                                    onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { scope: i }); }}>Clip {i + 1}</button>
                                ))}
                              </div>
                            </div>
                            {/* Save to Bank */}
                            <div className="flex items-center gap-1.5 border-t border-neutral-800 pt-1.5 mt-0.5">
                              <span className="text-[10px] text-neutral-400">Save to:</span>
                              <button className="px-2 py-0.5 rounded border border-teal-500/30 bg-transparent text-teal-500 text-[10px] cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(1, overlay.text); toastSuccess('Saved to Bank A'); }}>Bank A</button>
                              <button className="px-2 py-0.5 rounded border border-amber-500/30 bg-transparent text-amber-500 text-[10px] cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(2, overlay.text); toastSuccess('Saved to Bank B'); }}>Bank B</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>{/* end mainContent */}

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

        <EditorFooter lastSaved={lastSaved} onCancel={handleCloseRequest} onSaveAll={handleSaveAllAndClose} isSavingAll={isSavingAll} saveAllCount={allVideos.length} />

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

        {/* ── Lyric Analyzer Modal ── */}
        {showTranscriber && selectedAudio && (
          <LyricAnalyzer
            audioUrl={selectedAudio.localUrl || selectedAudio.url}
            onComplete={handleTranscriptionComplete}
            onClose={() => setShowTranscriber(false)}
          />
        )}

        {/* ── Close Confirmation ── */}
        {showCloseConfirm && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[100]">
            <div className="bg-[#171717] rounded-xl p-6 max-w-[360px] w-full border border-neutral-800">
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
                    onSavePreset?.({ name: presetPromptValue.trim(), settings: { cropMode: aspectRatio } });
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
                    onSavePreset?.({ name: presetPromptValue.trim(), settings: { cropMode: aspectRatio } });
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


export default MultiClipEditor;
