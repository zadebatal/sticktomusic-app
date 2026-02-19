import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary, getLyrics,
  addToVideoTextBank, removeFromVideoTextBank, updateVideoTextBank,
  addToLibraryAsync, incrementUseCount, MEDIA_TYPES,
  getTextBankText, getTextBankStyle
} from '../../services/libraryService';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { FeatherArrowLeft, FeatherX, FeatherPlay, FeatherPause, FeatherVolume2, FeatherVolumeX, FeatherPlus, FeatherTrash2, FeatherSave, FeatherDownload, FeatherRotateCcw, FeatherRotateCw, FeatherChevronDown, FeatherRefreshCw, FeatherMusic, FeatherUpload, FeatherDatabase, FeatherMic, FeatherScissors, FeatherSkipBack, FeatherSkipForward } from '@subframe/core';
import { TextField } from '../../ui/components/TextField';
import { Badge } from '../../ui/components/Badge';
import useIsMobile from '../../hooks/useIsMobile';
import AudioClipSelector from './AudioClipSelector';
import CloudImportButton from './CloudImportButton';
import LyricBank from './LyricBank';
import LyricAnalyzer from './LyricAnalyzer';
import WordTimeline from './WordTimeline';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';

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
  onSavePreset
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();

  // ── Multi-video state (mirrors SlideshowEditor allSlideshows) ──
  const [allVideos, setAllVideos] = useState(() => {
    if (existingVideo && existingVideo.editorMode === 'solo-clip') {
      // Re-editing an existing solo clip draft
      const existingClip = existingVideo.clips?.[0]
        ? (category?.videos || []).find(v => v.id === existingVideo.clips[0].sourceId) || {
            id: existingVideo.clips[0].sourceId,
            url: existingVideo.clips[0].url,
            localUrl: existingVideo.clips[0].localUrl,
            thumbnailUrl: existingVideo.clips[0].thumbnail,
            thumbnail: existingVideo.clips[0].thumbnail
          }
        : category?.videos?.[0] || null;
      return [{
        id: 'template',
        name: 'Template',
        clip: existingClip,
        textOverlays: existingVideo.textOverlays || [],
        words: existingVideo.words || [],
        isTemplate: true
      }];
    }
    const firstClip = category?.videos?.[0] || null;
    return [{
      id: 'template',
      name: 'Template',
      clip: firstClip,
      textOverlays: [],
      words: [],
      isTemplate: true
    }];
  });
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [generateCount, setGenerateCount] = useState(
    Math.min(10, Math.max(1, (category?.videos?.length || 1) - 1))
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [keepTemplateText, setKeepTemplateText] = useState('none');

  // Derived reads from active video
  const activeVideo = allVideos[activeVideoIndex];
  const clip = activeVideo?.clip;
  const textOverlays = activeVideo?.textOverlays || [];
  const words = activeVideo?.words || [];

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
    textAlign: 'center',
    textCase: 'default',
    displayMode: 'word'
  });
  const [activeTab, setActiveTab] = useState('caption');

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

  // Derive library audio and video from libraryMedia (memoized to avoid re-render cascades)
  const libraryAudio = useMemo(() => libraryMedia.filter(i => i.type === MEDIA_TYPES.AUDIO), [libraryMedia]);
  const libraryVideos = useMemo(() => libraryMedia.filter(i => i.type === MEDIA_TYPES.VIDEO), [libraryMedia]);

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

  // ── Text bank input state ──
  const [newTextA, setNewTextA] = useState('');
  const [newTextB, setNewTextB] = useState('');

  // ── Close confirmation ──
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // ── Word Timeline state ──
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [loadedBankLyricId, setLoadedBankLyricId] = useState(null);

  // ── Lyrics state ──
  const [lyricsBank, setLyricsBank] = useState([]);

  // ── Audio trimmer state ──
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);

  // ── Transcriber state ──
  const [showTranscriber, setShowTranscriber] = useState(false);

  // ── Video name state ──
  const [videoName, setVideoName] = useState(existingVideo?.name || 'Untitled Solo Clip');

  // ── Collapsible sidebar sections ──
  const [openSections, setOpenSections] = useState({
    audio: true, clips: true, lyrics: false, textStyle: false
  });
  const toggleSection = useCallback((key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const renderCollapsibleSection = (key, title, content) => (
    <div className="w-full border-t border-neutral-800">
      <button onClick={() => toggleSection(key)}
        className="w-full flex items-center justify-between px-4 py-3 bg-transparent border-none text-white text-heading-3 font-heading-3 cursor-pointer">
        <span>{title}</span>
        <FeatherChevronDown className={`w-4 h-4 text-neutral-500 flex-shrink-0 transition-transform duration-150 ${openSections[key] ? 'rotate-180' : ''}`} />
      </button>
      {openSections[key] && (<div className="px-4 pb-4">{content}</div>)}
    </div>
  );

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
    for (const col of collections) {
      if (col.videoTextBank1?.length > 0) videoTextBank1 = [...videoTextBank1, ...col.videoTextBank1];
      if (col.videoTextBank2?.length > 0) videoTextBank2 = [...videoTextBank2, ...col.videoTextBank2];
    }
    return { videoTextBank1, videoTextBank2 };
  }, [collections]);

  const handleAddToVideoTextBank = useCallback((bankNum, text) => {
    if (!text.trim() || !artistId || collections.length === 0) return;
    const targetCol = collections[0];
    addToVideoTextBank(artistId, targetCol.id, bankNum, text.trim());
    setCollections(prev => prev.map(col =>
      col.id === targetCol.id
        ? { ...col, [`videoTextBank${bankNum}`]: [...(col[`videoTextBank${bankNum}`] || []), text.trim()] }
        : col
    ));
  }, [artistId, collections]);

  const handleRemoveFromVideoTextBank = useCallback((bankNum, index) => {
    if (!artistId || collections.length === 0) return;
    const targetCol = collections[0];
    removeFromVideoTextBank(artistId, targetCol.id, bankNum, index);
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

  // Timeline duration dictated by audio; falls back to clip length when no audio
  const timelineDuration = audioDuration > 0 ? audioDuration : (clipDuration || 1);

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

  const handleSeek = useCallback((time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
    if (audioRef.current) {
      // Add audio start boundary offset for trimmed audio
      const startBoundary = selectedAudio?.startTime || 0;
      audioRef.current.currentTime = time + startBoundary;
    }
  }, [selectedAudio]);

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

  // ── AI Transcription handler ──
  const handleTranscriptionComplete = useCallback((result) => {
    if (!result?.words?.length) {
      toastError('No words detected in transcription.');
      setShowTranscriber(false);
      return;
    }
    const dur = clipDuration || 30;
    result.words.forEach(w => {
      const start = Math.min(w.startTime || 0, dur);
      const end = Math.min(w.startTime + (w.duration || 0.5), dur);
      const newOverlay = {
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: w.text,
        style: getDefaultTextStyle(),
        position: { x: 50, y: 50, width: 80, height: 20 },
        startTime: start,
        endTime: end
      };
      setTextOverlays(prev => [...prev, newOverlay]);
    });
    // Also set words for WordTimeline
    setWords(result.words.map((w, i) => ({
      id: `word_${Date.now()}_${i}`,
      text: w.text,
      startTime: Math.min(w.startTime || 0, dur),
      duration: w.duration || 0.5
    })));
    toastSuccess(`Added ${result.words.length} text overlays from transcription`);
    setShowTranscriber(false);
  }, [clipDuration, getDefaultTextStyle, setTextOverlays, setWords, toastSuccess, toastError]);

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

  const addTextOverlay = useCallback((prefillText, overrideStart, overrideEnd) => {
    const start = overrideStart !== undefined ? overrideStart : currentTime;
    const end = overrideEnd !== undefined ? overrideEnd : Math.min(start + 3, clipDuration || start + 3);
    const newOverlay = {
      id: `text_${Date.now()}`,
      text: prefillText || 'Click to edit',
      style: getDefaultTextStyle(),
      position: { x: 50, y: 50, width: 80, height: 20 },
      startTime: start,
      endTime: end
    };
    setTextOverlays(prev => [...prev, newOverlay]);
    setEditingTextId(newOverlay.id);
    setEditingTextValue(newOverlay.text);
  }, [getDefaultTextStyle, setTextOverlays, currentTime, clipDuration]);

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

  // ── Reroll: swap clip with random from visible videos (collection-aware) ──
  const handleReroll = useCallback(() => {
    const availableClips = visibleVideos.length > 0 ? visibleVideos : (category?.videos || []);
    if (!availableClips.length) {
      toastError('No clips available to reroll from.');
      return;
    }
    const available = availableClips.filter(v => v.id !== clip?.id);
    if (available.length === 0) {
      toastError('No other clips available to swap with.');
      return;
    }
    const randomClip = available[Math.floor(Math.random() * available.length)];
    setClip(randomClip);
    toastSuccess('Swapped clip');
  }, [visibleVideos, category?.videos, clip, setClip, toastSuccess, toastError]);

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
    const overlay = textOverlays.find(o => o.id === overlayId);
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
  }, [textOverlays]);

  useEffect(() => {
    if (!draggingTextId) return;
    const handleMouseMove = (e) => {
      if (!dragStartRef.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const newX = Math.max(5, Math.min(95, dragStartRef.current.startPosX + (dx / rect.width) * 100));
      const newY = Math.max(5, Math.min(95, dragStartRef.current.startPosY + (dy / rect.height) * 100));
      updateTextOverlay(draggingTextId, { position: { ...textOverlays.find(o => o.id === draggingTextId)?.position, x: newX, y: newY } });
    };
    const handleMouseUp = () => setDraggingTextId(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingTextId, textOverlays, updateTextOverlay]);

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

  // ── Timeline text block drag/resize ──
  const handleTimelineDragStart = useCallback((e, overlayId, type) => {
    e.preventDefault();
    e.stopPropagation();
    const overlay = textOverlays.find(o => o.id === overlayId);
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
  }, [textOverlays]);

  useEffect(() => {
    if (!timelineDrag || !timelineRef.current) return;
    const dur = clipDuration || 1;
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
        updateTextOverlay(timelineDrag.overlayId, { startTime: newStart, endTime: newEnd });
      } else if (timelineDrag.type === 'left') {
        const newStart = Math.max(0, Math.min(timelineDrag.origEnd - minDur, timelineDrag.origStart + deltaSec));
        updateTextOverlay(timelineDrag.overlayId, { startTime: newStart });
      } else if (timelineDrag.type === 'right') {
        const newEnd = Math.min(dur, Math.max(timelineDrag.origStart + minDur, timelineDrag.origEnd + deltaSec));
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
  }, [timelineDrag, clipDuration, updateTextOverlay]);

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
    if (template.textOverlays.length === 0) {
      toastError('Add at least one text overlay to the template before generating.');
      return;
    }

    const availableClips = (category?.videos || []).filter(v => v.id !== template.clip.id);
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
      toastSuccess(`Generated ${generated.length} video${generated.length !== 1 ? 's' : ''}!`);
    } finally {
      setIsGenerating(false);
    }
  }, [allVideos, generateCount, category, getVideoTextBanks, keepTemplateText, toastSuccess, toastError]);

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
      externalAudioVolume
    };
    onSave(videoData);
    toastSuccess(`Saved "${video.name || 'Solo Clip'}"`);
  }, [allVideos, activeVideoIndex, clipDuration, aspectRatio, selectedAudio, existingVideo, sourceVideoMuted, sourceVideoVolume, externalAudioVolume, onSave, toastSuccess, toastError]);

  // ── Save All & Close ──
  const handleSaveAllAndClose = useCallback(async () => {
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
        updatedAt: new Date().toISOString()
      };
      try {
        await onSave(videoData);
      } catch (err) {
        console.error(`[SoloClipEditor] Failed to save video ${savedCount}:`, err);
        toastError(`Failed to save "${video.name || 'Solo Clip'}". Please try again.`);
        return; // Stop on failure so user doesn't lose context
      }
      savedCount++;
    }
    toastSuccess(`Saved ${savedCount} video${savedCount !== 1 ? 's' : ''}!`);
    onClose();
  }, [allVideos, clipDuration, aspectRatio, selectedAudio, existingVideo, onSave, onClose, toastSuccess, toastError]);

  // Export removed — was identical to Save Draft but set status='rendered' without actually rendering.
  // Real video export (FFmpeg render + download) will be added as a future feature.

  // ── Close with confirmation ──
  const handleCloseRequest = useCallback(() => {
    const hasWork = textOverlays.length > 0 || allVideos.length > 1;
    if (hasWork) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [textOverlays, allVideos, onClose]);

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

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Video text banks for left panel
  const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();

  // ── RENDER ──
  return (
    <div className={`fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] ${isMobile ? 'p-0' : 'p-5'}`} onClick={(e) => e.target === e.currentTarget && handleCloseRequest()}>
      <div className="w-full h-screen bg-black flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* ═══ TOP BAR ═══ */}
        <div className="flex w-full items-center justify-between border-b border-neutral-800 bg-black px-6 py-4">
          <div className="flex items-center gap-4">
            <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherArrowLeft />} onClick={handleCloseRequest} />
            {!isMobile && (
              <TextField className="w-80" variant="filled" label="" helpText="">
                <TextField.Input placeholder="Untitled Solo Clip" value={videoName} onChange={(e) => setVideoName(e.target.value)} />
              </TextField>
            )}
          </div>
          <div className="flex items-center gap-3">
            <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherRotateCcw />} disabled={!canUndo} onClick={handleUndo} title="Undo (⌘Z)" />
            <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherRotateCw />} disabled={!canRedo} onClick={handleRedo} title="Redo (⌘⇧Z)" />
            <Button variant="neutral-secondary" size="medium" icon={<FeatherSave />} onClick={handleSaveDraft}>Save</Button>
            <Button variant="brand-primary" size="medium" icon={<FeatherDownload />} onClick={handleSaveDraft}>Export</Button>
          </div>
        </div>

        {/* ═══ MAIN CONTENT ═══ */}
        <div className="flex grow shrink-0 basis-0 self-stretch overflow-hidden">

          {/* LEFT: Preview + Controls */}
          <div className="flex grow shrink-0 basis-0 flex-col items-center bg-black overflow-hidden">
            <div className="flex w-full max-w-[448px] grow flex-col items-center gap-4 py-6 px-4 overflow-auto">
              {/* Video Preview */}
              <div
                ref={previewRef}
                className="flex items-center justify-center rounded-lg bg-[#1a1a1aff] border border-neutral-800 relative overflow-hidden"
                style={{ aspectRatio: '9/16', height: '50vh' }}
                onClick={() => setEditingTextId(null)}
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

                {/* Text Overlays on video */}
                {textOverlays.map((overlay) => {
                  const style = overlay.style || {};
                  const pos = overlay.position || { x: 50, y: 50 };
                  if (overlay.startTime !== undefined && overlay.endTime !== undefined) {
                    if (currentTime < overlay.startTime || currentTime >= overlay.endTime) return null;
                  }
                  const displayText = style.textCase === 'upper' ? overlay.text.toUpperCase()
                    : style.textCase === 'lower' ? overlay.text.toLowerCase()
                    : overlay.text;
                  return (
                    <div
                      key={overlay.id}
                      onMouseDown={(e) => handleTextMouseDown(e, overlay.id)}
                      onClick={(e) => { e.stopPropagation(); setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}
                      style={{
                        position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)',
                        cursor: draggingTextId === overlay.id ? 'grabbing' : 'grab',
                        fontSize: `${(style.fontSize || 48) * (previewDims.width / 1080) * 2}px`,
                        fontFamily: style.fontFamily || 'Inter, sans-serif', fontWeight: style.fontWeight || '600',
                        color: style.color || '#ffffff', textAlign: style.textAlign || 'center',
                        textShadow: style.outline ? `2px 2px 0 ${style.outlineColor || '#000'}, -2px -2px 0 ${style.outlineColor || '#000'}, 2px -2px 0 ${style.outlineColor || '#000'}, -2px 2px 0 ${style.outlineColor || '#000'}` : 'none',
                        userSelect: 'none', WebkitUserSelect: 'none', whiteSpace: 'nowrap', zIndex: 10,
                        padding: '4px 8px', borderRadius: '4px',
                        border: editingTextId === overlay.id ? `1px dashed ${theme.accent.primary}99` : '1px dashed transparent'
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
                  type="number" min={1} max={50} value={generateCount}
                  onChange={(e) => setGenerateCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
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
                <IconButton variant="neutral-tertiary" size="small" icon={<FeatherSkipBack />} onClick={() => handleSeek(0)} />
                <IconButton variant="neutral-secondary" size="medium" icon={isPlaying ? <FeatherPause /> : <FeatherPlay />} onClick={handlePlayPause} />
                <IconButton variant="neutral-tertiary" size="small" icon={<FeatherSkipForward />} onClick={() => handleSeek(timelineDuration)} />
                <IconButton variant="neutral-tertiary" size="small" icon={isMuted ? <FeatherVolumeX /> : <FeatherVolume2 />} onClick={() => setIsMuted(!isMuted)} />
              </div>

            </div>

            {/* ── MOBILE TOOL TOOLBAR ── */}
            {isMobile && (
              <div className="flex justify-around items-center border-t border-b border-neutral-800 bg-[#0a0a0aff] flex-shrink-0 py-1">
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
              <div className="flex-1 overflow-auto bg-[#1a1a1aff] border-t border-neutral-800 min-h-0">
                {mobileToolTab === 'clips' && (
                  <div className="p-3">
                    <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)}
                      className="w-full px-3 py-2 bg-[#0a0a0aff] border border-neutral-800 rounded-lg text-[#ffffffff] text-[13px] outline-none cursor-pointer mb-2 min-h-[44px]">
                      <option value="category">Selected Clips</option>
                      <option value="all">All Videos (Library)</option>
                      {collections.map(col => (<option key={col.id} value={col.id}>{col.name}</option>))}
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
                        className={`mb-1.5 p-2.5 rounded-lg cursor-pointer ${editingTextId === overlay.id ? 'bg-brand-600/10 border border-brand-600/30' : 'bg-neutral-800/50 border border-neutral-800'}`}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[11px] text-neutral-400">Overlay {idx + 1}</span>
                          <IconButton icon={<FeatherX />} onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }} />
                        </div>
                        <div className="text-[13px] text-[#ffffffff]">{overlay.text}</div>
                      </div>
                    ))}
                    <Button variant="brand-secondary" size="small" icon={<FeatherPlus />} onClick={() => addTextOverlay()}>Add Text</Button>
                  </div>
                )}
              </div>
            )}

            {/* ═══ TIMELINE ═══ */}
            <div className="flex w-full flex-col items-start border-t border-neutral-800 bg-[#1a1a1aff] px-6 py-4 flex-shrink-0">
              <div className="flex w-full items-center justify-between mb-3">
                <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Timeline</span>
              </div>
              <div
                ref={timelineRef}
                className="flex w-full flex-col gap-2 relative"
                style={{ minHeight: '140px', cursor: 'pointer', userSelect: 'none' }}
                onClick={(e) => {
                  if (playheadDragging) return;
                  if (e.target === e.currentTarget || e.target.dataset.timelineClickable) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const time = (clickX / rect.width) * (timelineDuration || 1);
                    handleSeek(Math.max(0, Math.min(timelineDuration || 0, time)));
                  }
                }}
              >
                {/* Text Track */}
                <div className="flex w-full items-center gap-3">
                  <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Text</span>
                  <div className="flex-1 h-7 rounded-md border border-neutral-800 bg-black relative" data-timeline-clickable="true">
                    {textOverlays.map((overlay) => {
                      const startPct = timelineDuration > 0 ? (overlay.startTime / timelineDuration) * 100 : 0;
                      const widthPct = timelineDuration > 0 ? ((overlay.endTime - overlay.startTime) / timelineDuration) * 100 : 10;
                      const isSelected = editingTextId === overlay.id;
                      return (
                        <div key={overlay.id} style={{
                          position: 'absolute', left: `${startPct}%`, width: `${widthPct}%`, top: '2px', height: '24px',
                          backgroundColor: isSelected ? '#9333ea' : theme.accent.primary, borderRadius: '4px',
                          display: 'flex', alignItems: 'center', padding: '0 4px', cursor: timelineDrag ? 'grabbing' : 'grab', overflow: 'hidden',
                          border: isSelected ? '1px solid #a855f7' : '1px solid rgba(124,58,237,0.5)',
                          zIndex: isSelected ? 10 : 5
                        }} onMouseDown={(e) => handleTimelineDragStart(e, overlay.id, 'move')}>
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

                {/* Clip Track */}
                <div className="flex w-full items-center gap-3">
                  <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Clip</span>
                  <div className="flex-1 h-10 rounded-md border border-neutral-800 bg-black relative overflow-hidden">
                    {clip && (clip.thumbnailUrl || clip.thumbnail) && (
                      <img src={clip.thumbnailUrl || clip.thumbnail} alt="" style={{ width: '60px', height: '100%', objectFit: 'cover', opacity: 0.6 }} />
                    )}
                    <span style={{ position: 'absolute', left: '68px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: theme.text.secondary }}>
                      {clip ? 'Clip' : 'No clip'}
                    </span>
                  </div>
                </div>

                {/* Audio Track (external) */}
                {selectedAudio && !selectedAudio.isSourceVideo && waveformData.length > 0 && (
                  <div className="flex w-full items-center gap-3">
                    <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Audio</span>
                    <div className="flex-1 h-8 rounded-md border border-neutral-800 bg-black relative overflow-hidden">
                      <div style={{ position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '3px', zIndex: 3, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: '4px', padding: '2px 5px' }}>
                        <span style={{ fontSize: '10px' }}>{'\uD83C\uDFB5'}</span>
                        <input type="range" min="0" max="1" step="0.05" value={externalAudioVolume}
                          onChange={e => setExternalAudioVolume(parseFloat(e.target.value))}
                          style={{ width: '36px', height: '3px', accentColor: '#22c55e', cursor: 'pointer' }}
                          onClick={e => e.stopPropagation()} />
                      </div>
                      <div style={{ position: 'absolute', left: '68px', right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: '1px' }}>
                        {waveformData.map((amplitude, i) => (
                          <div key={i} style={{ flex: 1, minWidth: '1px', backgroundColor: 'rgba(34, 197, 94, 0.5)', height: `${amplitude * 100}%`, opacity: 0.6 }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Source Audio Track */}
                {clip && (clipWaveforms[clip.id || clip.sourceId] || []).length > 0 && (() => {
                  const data = clipWaveforms[clip.id || clip.sourceId] || [];
                  const hasExternal = selectedAudio && !selectedAudio.isSourceVideo;
                  return (
                    <div className="flex w-full items-center gap-3">
                      <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Source</span>
                      <div className="flex-1 h-8 rounded-md border border-neutral-800 bg-black relative overflow-hidden">
                        <div style={{ position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '3px', zIndex: 3, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: '4px', padding: '2px 5px' }}>
                          <button onClick={e => { e.stopPropagation(); setSourceVideoMuted(m => !m); }}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '10px', opacity: (hasExternal && sourceVideoMuted) ? 0.4 : 1 }}
                          >{sourceVideoMuted ? '\uD83D\uDD07' : '\uD83C\uDFAC'}</button>
                          {hasExternal && (
                            <input type="range" min="0" max="1" step="0.05" value={sourceVideoVolume}
                              onChange={e => setSourceVideoVolume(parseFloat(e.target.value))}
                              style={{ width: '36px', height: '3px', accentColor: '#f59e0b', cursor: 'pointer' }}
                              onClick={e => e.stopPropagation()} />
                          )}
                        </div>
                        <div style={{ position: 'absolute', left: hasExternal ? '68px' : '20px', right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: '1px' }}>
                          {data.map((amplitude, i) => (
                            <div key={i} style={{ flex: 1, minWidth: '1px', backgroundColor: 'rgba(245, 158, 11, 0.4)', height: `${amplitude * 100}%`, opacity: (hasExternal && sourceVideoMuted) ? 0.3 : 0.6 }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Playhead */}
                {timelineDuration > 0 && (
                  <div style={{
                    position: 'absolute', left: `${(currentTime / timelineDuration) * 100}%`, top: 0, bottom: 0,
                    width: '2px', backgroundColor: '#ef4444', zIndex: 20, pointerEvents: 'auto', cursor: 'ew-resize',
                    transition: (isPlaying && !playheadDragging) ? 'none' : playheadDragging ? 'none' : 'left 0.1s ease-out'
                  }} onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setPlayheadDragging(true);
                    document.body.style.userSelect = 'none';
                    const wasPlaying = isPlaying;
                    if (isPlaying) { videoRef.current?.pause(); audioRef.current?.pause(); cancelAnimationFrame(animationRef.current); setIsPlaying(false); }
                    const handleDragMove = (moveE) => {
                      const rect = timelineRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const pct = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width));
                      handleSeek(pct * timelineDuration);
                    };
                    const handleDragEnd = () => {
                      setPlayheadDragging(false); document.body.style.userSelect = '';
                      window.removeEventListener('mousemove', handleDragMove);
                      window.removeEventListener('mouseup', handleDragEnd);
                      if (wasPlaying) { videoRef.current?.play(); if (audioRef.current?.src) audioRef.current.play().catch(() => {}); animationRef.current = requestAnimationFrame(playbackLoop); setIsPlaying(true); }
                    };
                    window.addEventListener('mousemove', handleDragMove);
                    window.addEventListener('mouseup', handleDragEnd);
                  }}>
                    <div style={{ position: 'absolute', left: '-6px', right: '-6px', top: 0, bottom: 0, cursor: 'ew-resize' }} />
                    <div style={{ position: 'absolute', top: '-2px', left: '50%', transform: 'translateX(-50%)', width: '10px', height: '10px', backgroundColor: '#ef4444', borderRadius: '2px', clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Sidebar */}
          {!isMobile && (
            <div className="flex w-96 flex-none flex-col items-start self-stretch border-l border-neutral-800 bg-[#1a1a1aff] overflow-auto">
              <div className="flex w-full flex-col items-start">
                {renderCollapsibleSection('audio', 'Audio', (
                  <div className="flex flex-col gap-3">
                    {selectedAudio ? (
                      <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-black px-3 py-2">
                        <FeatherMusic className="text-neutral-400" style={{ width: 16, height: 16 }} />
                        <span className="text-body font-body text-[#ffffffff] truncate flex-1">{selectedAudio.name}</span>
                        {selectedAudio.isTrimmed && <Badge variant="neutral">Trimmed</Badge>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-black px-3 py-2">
                        <FeatherMusic className="text-neutral-500" style={{ width: 16, height: 16 }} />
                        <span className="text-body font-body text-neutral-500">No audio selected</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {selectedAudio && (
                        <>
                          <Button variant="neutral-secondary" size="small" icon={<FeatherScissors />} onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}>Trim</Button>
                          <Button variant="destructive-tertiary" size="small" icon={<FeatherTrash2 />} onClick={() => {
                            if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
                            if (animationRef.current) cancelAnimationFrame(animationRef.current);
                            setSelectedAudio(null); setIsPlaying(false); setCurrentTime(0); setAudioDuration(0); setSourceVideoMuted(false);
                          }}>Remove</Button>
                        </>
                      )}
                    </div>
                    <Button className="w-full" variant="neutral-secondary" size="small" icon={<FeatherUpload />} onClick={() => audioFileInputRef.current?.click()}>
                      {selectedAudio ? 'Change Audio' : 'Upload Audio'}
                    </Button>
                    {libraryAudio.length > 0 && (
                      <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
                        <span className="text-caption font-caption text-neutral-400">Library Audio</span>
                        {libraryAudio.map(audio => (
                          <div key={audio.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-neutral-800 text-[12px] text-[#ffffffff]"
                            onClick={() => { setAudioToTrim(audio); setShowAudioTrimmer(true); }}>
                            <FeatherMusic className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                            <span className="truncate">{audio.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {renderCollapsibleSection('clips', 'Clips', (
                  <div className="flex flex-col gap-3">
                    <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)}
                      className="w-full px-3 py-2 bg-black border border-neutral-800 rounded-md text-[#ffffffff] text-[13px] outline-none cursor-pointer">
                      <option value="category">Selected Clips</option>
                      <option value="all">All Videos (Library)</option>
                      {collections.map(col => (<option key={col.id} value={col.id}>{col.name}</option>))}
                    </select>
                    <div className="flex justify-between items-center">
                      <span className="text-caption font-caption text-neutral-400">{visibleVideos.length} clips</span>
                      <CloudImportButton artistId={artistId} db={db} mediaType="video" compact onImportMedia={(files) => {
                        const newVids = files.map((f, i) => ({ id: `import_${Date.now()}_${i}`, name: f.name, url: f.url, localUrl: f.localUrl, type: 'video' }));
                        setLibraryMedia(prev => [...prev, ...newVids]);
                      }} />
                    </div>
                    {visibleVideos.length === 0 ? (
                      <div className="py-4 text-center text-neutral-500 text-[13px]">No videos in this collection</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {visibleVideos.map((video, i) => {
                          const isActive = clip?.id === video.id;
                          return (
                            <div key={video.id || i}
                              className={`cursor-pointer p-1 rounded-md border-2 transition-colors relative ${isActive ? 'border-brand-600' : 'border-transparent'}`}
                              onClick={() => { setClip(video); if (video.id && artistId) incrementUseCount(artistId, video.id); }}>
                              {isActive && <div className="absolute top-1 right-1 z-[2] w-[18px] h-[18px] rounded-full bg-brand-600 flex items-center justify-center text-[11px] text-white font-bold">✓</div>}
                              <div className="w-full aspect-video rounded overflow-hidden bg-[#0a0a0aff]">
                                {(video.thumbnailUrl || video.thumbnail) ? (
                                  <img src={video.thumbnailUrl || video.thumbnail} alt={video.name} className="w-full h-full object-cover" />
                                ) : (<div className="w-full h-full flex items-center justify-center text-xl">🎬</div>)}
                              </div>
                              <div className="text-[10px] text-neutral-400 overflow-hidden text-ellipsis whitespace-nowrap mt-1">
                                {(video.name || video.metadata?.originalName || 'Clip').substring(0, 20)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Text Banks */}
                    {(() => {
                      return (
                        <div className="flex flex-col gap-3 pt-3 border-t border-neutral-800">
                          <div>
                            <div className="text-body-bold font-body-bold text-teal-400 mb-2">Text Bank A</div>
                            <div className="flex gap-1.5 mb-2">
                              <input value={newTextA} onChange={(e) => setNewTextA(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }}
                                placeholder="Add text..." className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-800 bg-black text-[#ffffffff] text-[12px] outline-none" />
                              <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} onClick={() => { if (newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }} />
                            </div>
                            {videoTextBank1.map((text, idx) => (
                              <div key={idx} className="flex items-center px-2 py-1.5 rounded-md bg-neutral-800/50 mb-1 text-neutral-300">
                                <span className="flex-1 text-[12px] cursor-pointer" onClick={() => addTextOverlay(text)}>{text}</span>
                                <button onClick={() => handleRemoveFromVideoTextBank(1, idx)} className="bg-transparent border-none text-neutral-500 text-[14px] cursor-pointer px-1">×</button>
                              </div>
                            ))}
                            {videoTextBank1.length === 0 && <div className="text-[11px] text-neutral-500">No text added yet</div>}
                          </div>
                          <div>
                            <div className="text-body-bold font-body-bold text-amber-400 mb-2">Text Bank B</div>
                            <div className="flex gap-1.5 mb-2">
                              <input value={newTextB} onChange={(e) => setNewTextB(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }}
                                placeholder="Add text..." className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-800 bg-black text-[#ffffffff] text-[12px] outline-none" />
                              <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} onClick={() => { if (newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }} />
                            </div>
                            {videoTextBank2.map((text, idx) => (
                              <div key={idx} className="flex items-center px-2 py-1.5 rounded-md bg-neutral-800/50 mb-1 text-neutral-300">
                                <span className="flex-1 text-[12px] cursor-pointer" onClick={() => addTextOverlay(text)}>{text}</span>
                                <button onClick={() => handleRemoveFromVideoTextBank(2, idx)} className="bg-transparent border-none text-neutral-500 text-[14px] cursor-pointer px-1">×</button>
                              </div>
                            ))}
                            {videoTextBank2.length === 0 && <div className="text-[11px] text-neutral-500">No text added yet</div>}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}

                {renderCollapsibleSection('lyrics', 'Lyrics', (
                  <div className="flex flex-col gap-3">
                    <span className="text-body font-body text-neutral-400">
                      {lyricsBank.length > 0 ? `${lyricsBank.length} lyrics in bank` : 'No lyrics in bank'}
                    </span>
                    {lyricsBank.map(lyric => (
                      <div key={lyric.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-neutral-800 text-[12px] text-[#ffffffff]"
                        onClick={() => addTextOverlay(lyric.content || lyric.title || '')}>
                        <FeatherDatabase className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                        <span className="truncate">{lyric.title || lyric.content?.slice(0, 30) || 'Untitled'}</span>
                      </div>
                    ))}
                    {selectedAudio && (
                      <Button variant="neutral-secondary" size="small" icon={<FeatherMic />} onClick={() => setShowTranscriber(true)}>
                        AI Transcribe
                      </Button>
                    )}
                  </div>
                ))}

                {renderCollapsibleSection('textStyle', 'Text Style', (
                  <div className="flex flex-col gap-3">
                    <Button variant="brand-secondary" size="small" icon={<FeatherPlus />} onClick={() => addTextOverlay()}>Add Text Overlay</Button>
                    <div className="flex flex-col gap-1">
                      <span className="text-body-bold font-body-bold text-[#ffffffff] mb-1">Text Overlays</span>
                      {textOverlays.length === 0 && <p className="text-[12px] text-neutral-500">No text overlays yet</p>}
                      {textOverlays.map((overlay, idx) => {
                        const isSelected = editingTextId === overlay.id;
                        return (
                          <div key={overlay.id} onClick={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}
                            className={`p-2.5 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-brand-600/10 border border-brand-600/30' : 'bg-neutral-800/50 border border-neutral-800'}`}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[11px] text-neutral-400">
                                Overlay {idx + 1}
                                {overlay.startTime !== undefined && <span className="ml-1.5 text-[9px] text-neutral-500">{overlay.startTime.toFixed(1)}s – {overlay.endTime.toFixed(1)}s</span>}
                              </span>
                              <IconButton size="small" icon={<FeatherX />} onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }} />
                            </div>
                            {isSelected ? (
                              <input value={editingTextValue} onChange={(e) => setEditingTextValue(e.target.value)}
                                onBlur={() => updateTextOverlay(overlay.id, { text: editingTextValue })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { updateTextOverlay(overlay.id, { text: editingTextValue }); e.target.blur(); } }}
                                className="w-full px-2 py-1.5 rounded border border-brand-600/30 bg-black text-[#ffffffff] text-[13px] outline-none" autoFocus />
                            ) : (
                              <div className="text-[13px] text-[#ffffffff]">{overlay.text}</div>
                            )}
                            {isSelected && (
                              <div className="mt-2 flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-neutral-400 min-w-[34px]">Font</span>
                                  <select value={overlay.style.fontFamily} onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, fontFamily: e.target.value } })}
                                    className="flex-1 px-1.5 py-0.5 rounded border border-neutral-800 bg-black text-[#ffffffff] text-[11px]">
                                    <option value="Inter, sans-serif">Sans</option>
                                    <option value="'Playfair Display', serif">Serif</option>
                                    <option value="'Space Grotesk', sans-serif">Grotesk</option>
                                    <option value="monospace">Mono</option>
                                  </select>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-neutral-400 min-w-[34px]">Size</span>
                                  <button className="px-2 py-0.5 rounded border border-neutral-800 bg-neutral-800/50 text-[#ffffffff] text-[11px] cursor-pointer"
                                    onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.max(16, overlay.style.fontSize - 4) } }); }}>A-</button>
                                  <span className="text-[11px] text-[#ffffffff] min-w-[26px] text-center">{overlay.style.fontSize}</span>
                                  <button className="px-2 py-0.5 rounded border border-neutral-800 bg-neutral-800/50 text-[#ffffffff] text-[11px] cursor-pointer"
                                    onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.min(120, overlay.style.fontSize + 4) } }); }}>A+</button>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-neutral-400 min-w-[34px]">Color</span>
                                  <input type="color" value={overlay.style.color} onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, color: e.target.value } })} className="w-6 h-6 rounded border-0 cursor-pointer" />
                                  <span className="text-[10px] text-neutral-400 ml-2">Outline</span>
                                  <button className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${overlay.style.outline ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 text-neutral-400'}`}
                                    onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, outline: !overlay.style.outline } }); }}>
                                    {overlay.style.outline ? 'On' : 'Off'}
                                  </button>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-neutral-400 min-w-[34px]">Align</span>
                                  {['left', 'center', 'right'].map(align => (
                                    <button key={align} className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${overlay.style.textAlign === align ? 'bg-brand-600/20 border-brand-600 text-brand-400' : 'border-neutral-800 text-neutral-400'}`}
                                      onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, textAlign: align } }); }}>
                                      {align.charAt(0).toUpperCase() + align.slice(1)}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex items-center gap-1 border-t border-neutral-800 pt-1.5 mt-0.5">
                                  <span className="text-[10px] text-neutral-400">Save to:</span>
                                  <button className="px-2 py-0.5 rounded border border-teal-500/30 text-teal-500 text-[10px] cursor-pointer bg-transparent"
                                    onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(1, overlay.text); toastSuccess('Saved to Bank A'); }}>Bank A</button>
                                  <button className="px-2 py-0.5 rounded border border-amber-500/30 text-amber-500 text-[10px] cursor-pointer bg-transparent"
                                    onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(2, overlay.text); toastSuccess('Saved to Bank B'); }}>Bank B</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

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
          />
        )}

        {/* ── Close Confirmation ── */}
        {showCloseConfirm && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[100]">
            <div className="bg-neutral-900 rounded-xl p-6 max-w-[360px] w-full border border-neutral-800">
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
      </div>
    </div>
  );
};

export default SoloClipEditor;
