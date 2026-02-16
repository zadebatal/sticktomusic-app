import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary, getLyrics,
  addToVideoTextBank, removeFromVideoTextBank, updateVideoTextBank,
  addToLibraryAsync, incrementUseCount, MEDIA_TYPES
} from '../../services/libraryService';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import AudioClipSelector from './AudioClipSelector';
import CloudImportButton from './CloudImportButton';
import EditorToolbar from './EditorToolbar';
import LyricBank from './LyricBank';
import LyricAnalyzer from './LyricAnalyzer';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';

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
  onDeleteLyrics
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);

  // ── Multi-video state (mirrors SlideshowEditor allSlideshows) ──
  const [allVideos, setAllVideos] = useState(() => {
    if (existingVideo && existingVideo.editorMode === 'multi-clip') {
      // Re-editing an existing multi-clip draft
      return [{
        id: 'template',
        name: 'Template',
        clips: existingVideo.clips || [],
        textOverlays: existingVideo.textOverlays || [],
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
  const clips = activeVideo?.clips || [];
  const textOverlays = activeVideo?.textOverlays || [];

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

  // ── Undo/Redo history ──
  const getHistorySnapshot = useCallback(() => {
    const v = allVideos[activeVideoIndex];
    return v ? { clips: v.clips, textOverlays: v.textOverlays } : null;
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
  const [aspectRatio, setAspectRatio] = useState(existingVideo?.cropMode || '9:16');

  // ── Text editing state ──
  const [editingTextId, setEditingTextId] = useState(null);
  const [showTextPanel, setShowTextPanel] = useState(false);
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
    if (template.textOverlays.length === 0) {
      toastError('Add at least one text overlay to the template before generating.');
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
      toastSuccess(`Generated ${generated.length} video${generated.length !== 1 ? 's' : ''}!`);
    } finally {
      setIsGenerating(false);
    }
  }, [allVideos, generateCount, category, getVideoTextBanks, keepTemplateText, toastSuccess, toastError]);

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
    toastSuccess(`Saved "${video.name || 'Multi-Clip'}"`);
  }, [allVideos, activeVideoIndex, totalDuration, aspectRatio, selectedAudio, existingVideo, sourceVideoMuted, sourceVideoVolume, externalAudioVolume, onSave, toastSuccess, toastError]);

  // ── Save All & Close ──
  const handleSaveAllAndClose = useCallback(async () => {
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
        console.error(`[MultiClipEditor] Failed to save video ${savedCount}:`, err);
        toastError(`Failed to save "${video.name || 'Multi-Clip'}". Please try again.`);
        return; // Stop on failure so user doesn't lose context
      }
      savedCount++;
    }
    toastSuccess(`Saved ${savedCount} video${savedCount !== 1 ? 's' : ''}!`);
    onClose();
  }, [allVideos, totalDuration, aspectRatio, selectedAudio, existingVideo, onSave, onClose, toastSuccess, toastError]);

  // Export removed — was identical to Save Draft but set status='rendered' without actually rendering.
  // Real video export (FFmpeg render + download) will be added as a future feature.

  // ── Close with confirmation ──
  const handleCloseRequest = useCallback(() => {
    const hasWork = textOverlays.length > 0 || allVideos.length > 1 || (clips.length > 0);
    if (hasWork) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [textOverlays, allVideos, clips, onClose]);

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
    <div style={{
      ...styles.overlay,
      ...(isMobile ? { padding: 0 } : {})
    }} onClick={(e) => e.target === e.currentTarget && handleCloseRequest()}>
      <div style={{
        ...styles.modal,
        ...(isMobile ? { borderRadius: 0, maxWidth: '100%', height: '100vh', width: '100vw', border: 'none' } : {})
      }}>

        {/* ── Header (matches Montage) ── */}
        <div style={{
          ...styles.header,
          ...(isMobile ? { padding: '12px 16px' } : {})
        }}>
          <button
            style={{
              ...styles.studioButton,
              ...(isMobile ? { padding: '6px 10px', fontSize: '14px' } : {})
            }}
            onClick={handleCloseRequest}
            title="Back to Studio"
          >
            <svg width={isMobile ? 18 : 20} height={isMobile ? 18 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5,3 19,12 5,21" fill="currentColor"/>
            </svg>
            {!isMobile && <span>Studio</span>}
          </button>
          <div style={{ display: 'flex', gap: isMobile ? '4px' : '8px', alignItems: 'center' }}>
            {/* Aspect ratio toggles */}
            {['9:16', '1:1', '4:3'].map(ratio => (
              <button
                key={ratio}
                onClick={() => setAspectRatio(ratio)}
                style={{
                  ...styles.ratioButton,
                  ...(aspectRatio === ratio ? styles.ratioButtonActive : {}),
                  ...(isMobile ? { padding: '4px 8px', fontSize: '10px', minHeight: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' } : {})
                }}
              >
                {ratio}
              </button>
            ))}
            {!isMobile && <div style={{ width: '1px', height: '20px', backgroundColor: theme.border.subtle, margin: '0 4px' }} />}
            {/* Save Draft */}
            <button onClick={handleSaveDraft} style={{
              ...styles.saveDraftButton,
              ...(isMobile ? { padding: '6px 10px', fontSize: '11px', minHeight: '44px', minWidth: '44px' } : {})
            }}>
              {isMobile ? 'Save' : 'Save Draft'}
            </button>
            {/* Save All */}
            {allVideos.length > 1 && (
              <button onClick={handleSaveAllAndClose} style={{
                ...styles.saveAllButton,
                ...(isMobile ? { padding: '6px 10px', fontSize: '11px', minHeight: '44px' } : {})
              }}>
                {isMobile ? `All (${allVideos.length})` : `Save All (${allVideos.length})`}
              </button>
            )}
            {/* Close */}
            <button onClick={handleCloseRequest} style={styles.closeButton}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Main Content — 3 Columns (desktop) / stacked (mobile) ── */}
        <div style={{
          ...styles.mainContent,
          ...(isMobile ? { flexDirection: 'column', overflow: 'auto' } : {})
        }}>

          {/* ── LEFT PANEL: Collection dropdown + Video grid + Timeline + Text Banks (desktop only) ── */}
          {!isMobile && <div style={styles.leftPanel}>
            {/* Collection dropdown */}
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${theme.border.subtle}` }}>
              <select
                value={selectedCollection}
                onChange={(e) => setSelectedCollection(e.target.value)}
                style={styles.sourceDropdown}
              >
                <option value="category">Selected Clips</option>
                <option value="all">All Videos (Library)</option>
                {collections.map(col => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>
            </div>

            {/* Videos + Timeline + Text Banks */}
            <div style={styles.bankContent}>
              {/* ── Videos section ── */}
              {visibleVideos.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: theme.text.muted, fontSize: '13px' }}>
                  No videos in this collection
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: theme.text.muted }}>{visibleVideos.length} clips</span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <CloudImportButton
                        artistId={artistId}
                        db={db}
                        mediaType="video"
                        compact
                        onImportMedia={(files) => {
                          const newVids = files.map((f, i) => ({
                            id: `import_${Date.now()}_${i}`,
                            name: f.name,
                            url: f.url,
                            localUrl: f.localUrl,
                            type: 'video'
                          }));
                          setLibraryMedia(prev => [...prev, ...newVids]);
                        }}
                      />
                      <button
                        style={{ fontSize: '11px', color: '#14b8a6', background: 'none', border: 'none', cursor: 'pointer' }}
                        onClick={() => {
                          visibleVideos.forEach(v => addClipToTimeline(v));
                        }}
                      >Add All</button>
                    </div>
                  </div>
                  <div style={styles.sidebarClipGrid}>
                    {visibleVideos.map((video, i) => {
                      const isInTimeline = clips.some(clip => (clip.id === video.id) || (clip.sourceId === video.id));
                      return (
                        <div
                          key={video.id || i}
                          style={{ ...styles.sidebarClip, position: 'relative', border: isInTimeline ? '1px solid rgba(34,197,94,0.4)' : undefined }}
                          onClick={() => {
                            addClipToTimeline(video);
                            if (video.id && artistId) incrementUseCount(artistId, video.id);
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = isInTimeline ? 'rgba(34,197,94,0.6)' : 'rgba(20,184,166,0.5)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = isInTimeline ? 'rgba(34,197,94,0.4)' : 'transparent'; }}
                        >
                          {isInTimeline && (
                            <div style={{
                              position: 'absolute', top: 3, right: 3, zIndex: 2,
                              width: '18px', height: '18px', borderRadius: '50%',
                              backgroundColor: '#22c55e', display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                              fontSize: '11px', color: '#fff', fontWeight: 'bold',
                              boxShadow: `0 1px 4px ${theme.overlay.light}`
                            }}>✓</div>
                          )}
                          <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: '4px', overflow: 'hidden', backgroundColor: theme.bg.page }}>
                            {(video.thumbnailUrl || video.thumbnail) ? (
                              <img src={video.thumbnailUrl || video.thumbnail} alt={video.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🎬</div>
                            )}
                          </div>
                          <div style={{ fontSize: '10px', color: theme.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '4px' }}>
                            {(video.name || video.metadata?.originalName || 'Clip').substring(0, 20)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* ── Timeline (clip ordering — unique to Multi) ── */}
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.border.subtle}` }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text.primary, marginBottom: '8px' }}>
                  Timeline ({clips.length} clip{clips.length !== 1 ? 's' : ''})
                </div>
                {clips.length === 0 ? (
                  <div style={{ fontSize: '11px', color: theme.text.muted, padding: '12px', textAlign: 'center', backgroundColor: theme.hover.bg, borderRadius: '6px' }}>
                    No clips added. Click available clips to add them.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {clips.map((clip, idx) => (
                      <div
                        key={idx}
                        style={{
                          ...styles.timelineItem,
                          ...(activeClipIndex === idx ? styles.timelineItemActive : {})
                        }}
                        onClick={() => setActiveClipIndex(idx)}
                      >
                        <div style={{ fontSize: '10px', color: theme.text.secondary, fontWeight: 500, minWidth: '20px' }}>
                          {idx + 1}.
                        </div>
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
                          <div style={{ fontSize: '11px', color: theme.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {clip.name || 'Clip'}
                          </div>
                          <div style={{ fontSize: '9px', color: theme.text.muted }}>
                            {formatTime(getClipDuration(clip.id || clip.sourceId))}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveClipUp(idx); }}
                            disabled={idx === 0}
                            style={{ ...styles.timelineButton, ...(idx === 0 ? { opacity: 0.3, cursor: 'not-allowed' } : {}) }}
                            title="Move up"
                          >▲</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveClipDown(idx); }}
                            disabled={idx >= clips.length - 1}
                            style={{ ...styles.timelineButton, ...(idx >= clips.length - 1 ? { opacity: 0.3, cursor: 'not-allowed' } : {}) }}
                            title="Move down"
                          >▼</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeClipFromTimeline(idx); }}
                            style={styles.timelineRemoveButton}
                            title="Remove"
                          >×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Text Banks (always visible below timeline) ── */}
              {(() => {
                const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.border.subtle}` }}>
                    {/* Text Bank A */}
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#14b8a6', marginBottom: '8px' }}>Text Bank A</div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                        <input
                          value={newTextA}
                          onChange={(e) => setNewTextA(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }}
                          placeholder="Add text..."
                          style={styles.textBankInput}
                        />
                        <button
                          onClick={() => { if (newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }}
                          style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#14b8a6', color: '#fff', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}
                        >+</button>
                      </div>
                      {videoTextBank1.map((text, idx) => (
                        <div key={idx} style={styles.textBankItem}>
                          <span
                            style={{ flex: 1, fontSize: '12px', cursor: 'pointer' }}
                            onClick={() => addTextOverlay(text)}
                            title="Click to add as overlay"
                          >{text}</span>
                          <button
                            onClick={() => handleRemoveFromVideoTextBank(1, idx)}
                            style={{ background: 'none', border: 'none', color: theme.text.muted, cursor: 'pointer', fontSize: '14px', padding: '0 2px' }}
                          >×</button>
                        </div>
                      ))}
                      {videoTextBank1.length === 0 && <div style={{ fontSize: '11px', color: theme.text.muted }}>No text added yet</div>}
                    </div>
                    {/* Text Bank B */}
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '8px' }}>Text Bank B</div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                        <input
                          value={newTextB}
                          onChange={(e) => setNewTextB(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }}
                          placeholder="Add text..."
                          style={styles.textBankInput}
                        />
                        <button
                          onClick={() => { if (newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }}
                          style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#f59e0b', color: '#fff', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}
                        >+</button>
                      </div>
                      {videoTextBank2.map((text, idx) => (
                        <div key={idx} style={styles.textBankItem}>
                          <span
                            style={{ flex: 1, fontSize: '12px', cursor: 'pointer' }}
                            onClick={() => addTextOverlay(text)}
                            title="Click to add as overlay"
                          >{text}</span>
                          <button
                            onClick={() => handleRemoveFromVideoTextBank(2, idx)}
                            style={{ background: 'none', border: 'none', color: theme.text.muted, cursor: 'pointer', fontSize: '14px', padding: '0 2px' }}
                          >×</button>
                        </div>
                      ))}
                      {videoTextBank2.length === 0 && <div style={{ fontSize: '11px', color: theme.text.muted }}>No text added yet</div>}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>}

          {/* ── CENTER: Video Preview (matches Montage layout) ── */}
          <div style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
            ...(isMobile ? { width: '100%', flexShrink: 0 } : {})
          }}>
            <div style={styles.previewContainer}>
              <div
                ref={previewRef}
                style={styles.preview}
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
                        if (audioRef.current && audioRef.current.src && !audioRef.current.paused && audioRef.current.duration > totalDuration) {
                          return;
                        }
                        setIsPlaying(false);
                        if (animationRef.current) cancelAnimationFrame(animationRef.current);
                      }
                    }}
                    loop={false}
                    playsInline
                    style={styles.previewVideo}
                    crossOrigin="anonymous"
                  />
                ) : (
                  <div style={styles.previewPlaceholder}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={theme.text.muted} strokeWidth="1.5">
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

              {/* Progress Bar */}
              <div
                style={styles.progressBarContainer}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = (e.clientX - rect.left) / rect.width;
                  handleSeek(percent * timelineDuration);
                }}
              >
                <div style={{ ...styles.progressBar, width: `${timelineDuration > 0 ? (currentTime / timelineDuration) * 100 : 0}%` }} />
                <div style={{ ...styles.progressHandle, left: `${timelineDuration > 0 ? (currentTime / timelineDuration) * 100 : 0}%` }} />
              </div>

              {/* Playback Controls */}
              <div style={styles.playbackControls}>
                <button onClick={handlePlayPause} style={styles.playButton}>
                  {isPlaying ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  )}
                </button>
                <button onClick={() => setIsMuted(!isMuted)} style={styles.muteButton}>
                  {isMuted ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <line x1="23" y1="9" x2="17" y2="15"/>
                      <line x1="17" y1="9" x2="23" y2="15"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M15.54 8.46a5 5 0 010 7.07"/>
                      <path d="M19.07 4.93a10 10 0 010 14.14"/>
                    </svg>
                  )}
                </button>
                <span style={styles.timeDisplay}>
                  {formatTime(currentTime)} / {formatTime(timelineDuration)}
                </span>
              </div>
            </div>
          </div>

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
                        style={{ ...styles.sourceDropdown, marginBottom: '10px' }}
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
                        <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text.primary, marginBottom: '8px' }}>
                          Timeline ({clips.length} clip{clips.length !== 1 ? 's' : ''})
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
                                  ...styles.timelineItem,
                                  ...(activeClipIndex === idx ? styles.timelineItemActive : {}),
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
                                  <button onClick={(e) => { e.stopPropagation(); moveClipUp(idx); }} disabled={idx === 0} style={{ ...styles.timelineButton, ...(idx === 0 ? { opacity: 0.3, cursor: 'not-allowed' } : {}), minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Move up">▲</button>
                                  <button onClick={(e) => { e.stopPropagation(); moveClipDown(idx); }} disabled={idx >= clips.length - 1} style={{ ...styles.timelineButton, ...(idx >= clips.length - 1 ? { opacity: 0.3, cursor: 'not-allowed' } : {}), minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Move down">▼</button>
                                  <button onClick={(e) => { e.stopPropagation(); removeClipFromTimeline(idx); }} style={{ ...styles.timelineRemoveButton, minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Remove">×</button>
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
                                <input value={newTextA} onChange={(e) => setNewTextA(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }} placeholder="Add text..." style={{ ...styles.textBankInput, minHeight: '44px' }} />
                                <button onClick={() => { if (newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }} style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#14b8a6', color: '#fff', cursor: 'pointer', fontSize: '12px', flexShrink: 0, minHeight: '44px' }}>+</button>
                              </div>
                              {bankA.map((text, idx) => (
                                <div key={idx} style={{ ...styles.textBankItem, minHeight: '36px' }}>
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
                                <input value={newTextB} onChange={(e) => setNewTextB(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }} placeholder="Add text..." style={{ ...styles.textBankInput, minHeight: '44px' }} />
                                <button onClick={() => { if (newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }} style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#f59e0b', color: '#fff', cursor: 'pointer', fontSize: '12px', flexShrink: 0, minHeight: '44px' }}>+</button>
                              </div>
                              {bankB.map((text, idx) => (
                                <div key={idx} style={{ ...styles.textBankItem, minHeight: '36px' }}>
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
                            style={{
                              ...styles.overlayCard,
                              margin: '0 0 6px',
                              ...(isSelected ? styles.overlayCardActive : {})
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ fontSize: '11px', color: theme.text.secondary, fontWeight: 500 }}>
                                Overlay {idx + 1}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }}
                                style={{ ...styles.removeOverlayButton, minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              >&#215;</button>
                            </div>
                            {isSelected ? (
                              <input
                                value={editingTextValue}
                                onChange={(e) => setEditingTextValue(e.target.value)}
                                onBlur={() => updateTextOverlay(overlay.id, { text: editingTextValue })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { updateTextOverlay(overlay.id, { text: editingTextValue }); e.target.blur(); } }}
                                style={{ ...styles.textEditInput, minHeight: '44px', fontSize: '14px' }}
                                autoFocus
                              />
                            ) : (
                              <div style={{ fontSize: '13px', color: theme.text.primary }}>{overlay.text}</div>
                            )}

                            {isSelected && (
                              <div style={styles.styleControls}>
                                {/* Font Family */}
                                <div style={styles.controlRow}>
                                  <span style={styles.controlLabel}>Font</span>
                                  <select
                                    value={overlay.style.fontFamily}
                                    onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, fontFamily: e.target.value } })}
                                    style={{ ...styles.selectInput, minHeight: '44px' }}
                                  >
                                    <option value="Inter, sans-serif">Sans</option>
                                    <option value="'Playfair Display', serif">Serif</option>
                                    <option value="'Space Grotesk', sans-serif">Grotesk</option>
                                    <option value="monospace">Mono</option>
                                  </select>
                                </div>
                                {/* Font Size */}
                                <div style={styles.controlRow}>
                                  <span style={styles.controlLabel}>Size</span>
                                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                    <button
                                      style={{ ...styles.sizeButton, minWidth: '44px', minHeight: '44px' }}
                                      onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.max(16, overlay.style.fontSize - 4) } }); }}
                                    >A-</button>
                                    <span style={{ fontSize: '11px', color: theme.text.primary, minWidth: '26px', textAlign: 'center' }}>{overlay.style.fontSize}</span>
                                    <button
                                      style={{ ...styles.sizeButton, minWidth: '44px', minHeight: '44px' }}
                                      onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.min(120, overlay.style.fontSize + 4) } }); }}
                                    >A+</button>
                                  </div>
                                </div>
                                {/* Color + Outline */}
                                <div style={styles.controlRow}>
                                  <span style={styles.controlLabel}>Color</span>
                                  <input
                                    type="color"
                                    value={overlay.style.color}
                                    onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, color: e.target.value } })}
                                    style={{ ...styles.colorInput, width: '44px', height: '44px' }}
                                  />
                                  <span style={{ ...styles.controlLabel, marginLeft: '8px' }}>Outline</span>
                                  <button
                                    style={{
                                      ...styles.toggleButton,
                                      ...(overlay.style.outline ? styles.toggleButtonActive : {}),
                                      minWidth: '44px', minHeight: '44px'
                                    }}
                                    onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, outline: !overlay.style.outline } }); }}
                                  >{overlay.style.outline ? 'On' : 'Off'}</button>
                                </div>
                                {/* Scope */}
                                <div style={styles.controlRow}>
                                  <span style={styles.controlLabel}>Scope</span>
                                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                    <button
                                      style={{
                                        ...styles.toggleButton,
                                        ...(overlay.scope === 'full' ? styles.toggleButtonActive : {}),
                                        minHeight: '44px', padding: '6px 10px'
                                      }}
                                      onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { scope: 'full' }); }}
                                    >Full Video</button>
                                    {clips.map((_, i) => (
                                      <button
                                        key={i}
                                        style={{
                                          ...styles.toggleButton,
                                          ...(overlay.scope === i ? styles.toggleButtonActive : {}),
                                          minHeight: '44px', padding: '6px 10px'
                                        }}
                                        onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { scope: i }); }}
                                      >Clip {i + 1}</button>
                                    ))}
                                  </div>
                                </div>
                                {/* Save to Bank */}
                                <div style={{ ...styles.controlRow, borderTop: `1px solid ${theme.border.subtle}`, paddingTop: '6px', marginTop: '2px' }}>
                                  <span style={{ fontSize: '10px', color: theme.text.secondary }}>Save to:</span>
                                  <button
                                    style={{ ...styles.toggleButton, borderColor: 'rgba(20,184,166,0.3)', color: '#14b8a6', fontSize: '10px', minHeight: '44px', padding: '6px 10px' }}
                                    onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(1, overlay.text); toastSuccess('Saved to Bank A'); }}
                                  >Bank A</button>
                                  <button
                                    style={{ ...styles.toggleButton, borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: '10px', minHeight: '44px', padding: '6px 10px' }}
                                    onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(2, overlay.text); toastSuccess('Saved to Bank B'); }}
                                  >Bank B</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <button onClick={() => addTextOverlay()} style={{ ...styles.addTextButton, minHeight: '44px', margin: '6px 0' }}>
                        + Add Text Overlay
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── RIGHT PANEL: Text Overlays (collapsible) ── */}
          {showTextPanel && !isMobile && <div style={{ ...styles.rightPanel, width: '280px' }}>
            <div style={{ padding: '6px 12px', borderBottom: `1px solid ${theme.border.subtle}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: theme.text.primary }}>Text Controls</span>
              <button onClick={() => setShowTextPanel(false)} style={{ background: 'none', border: 'none', color: theme.text.muted, fontSize: '18px', cursor: 'pointer', padding: '2px 6px' }}>×</button>
            </div>
            <div style={styles.rightPanelScroll}>

              {/* ── TEXT OVERLAYS SECTION ── */}
              <div style={styles.sectionHeader}>
                <span>Text Overlays</span>
                <span style={{ fontSize: '10px', color: theme.text.muted }}>{textOverlays.length}</span>
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
                    style={{
                      ...styles.overlayCard,
                      ...(isSelected ? styles.overlayCardActive : {})
                    }}
                  >
                    {/* Overlay header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '11px', color: theme.text.secondary, fontWeight: 500 }}>
                        Overlay {idx + 1}
                        {overlay.startTime !== undefined && (
                          <span style={{ marginLeft: '6px', fontSize: '9px', color: theme.text.muted }}>
                            {overlay.startTime.toFixed(1)}s – {overlay.endTime.toFixed(1)}s
                          </span>
                        )}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }}
                        style={styles.removeOverlayButton}
                      >×</button>
                    </div>

                    {/* Inline text edit */}
                    {isSelected ? (
                      <input
                        value={editingTextValue}
                        onChange={(e) => setEditingTextValue(e.target.value)}
                        onBlur={() => updateTextOverlay(overlay.id, { text: editingTextValue })}
                        onKeyDown={(e) => { if (e.key === 'Enter') { updateTextOverlay(overlay.id, { text: editingTextValue }); e.target.blur(); } }}
                        style={styles.textEditInput}
                        autoFocus
                      />
                    ) : (
                      <div style={{ fontSize: '13px', color: theme.text.primary }}>{overlay.text}</div>
                    )}

                    {/* Style controls — always shown for selected overlay */}
                    {isSelected && (
                      <div style={styles.styleControls}>
                        {/* Font Family */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>Font</span>
                          <select
                            value={overlay.style.fontFamily}
                            onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, fontFamily: e.target.value } })}
                            style={styles.selectInput}
                          >
                            <option value="Inter, sans-serif">Sans</option>
                            <option value="'Playfair Display', serif">Serif</option>
                            <option value="'Space Grotesk', sans-serif">Grotesk</option>
                            <option value="monospace">Mono</option>
                          </select>
                        </div>

                        {/* Font Size */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>Size</span>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <button
                              style={styles.sizeButton}
                              onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.max(16, overlay.style.fontSize - 4) } }); }}
                            >A-</button>
                            <span style={{ fontSize: '11px', color: theme.text.primary, minWidth: '26px', textAlign: 'center' }}>{overlay.style.fontSize}</span>
                            <button
                              style={styles.sizeButton}
                              onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.min(120, overlay.style.fontSize + 4) } }); }}
                            >A+</button>
                          </div>
                        </div>

                        {/* Color + Outline */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>Color</span>
                          <input
                            type="color"
                            value={overlay.style.color}
                            onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, color: e.target.value } })}
                            style={styles.colorInput}
                          />
                          <span style={{ ...styles.controlLabel, marginLeft: '8px' }}>Outline</span>
                          <button
                            style={{
                              ...styles.toggleButton,
                              ...(overlay.style.outline ? styles.toggleButtonActive : {})
                            }}
                            onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, outline: !overlay.style.outline } }); }}
                          >{overlay.style.outline ? 'On' : 'Off'}</button>
                          {overlay.style.outline && (
                            <input
                              type="color"
                              value={overlay.style.outlineColor}
                              onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, outlineColor: e.target.value } })}
                              style={styles.colorInput}
                            />
                          )}
                        </div>

                        {/* Align */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>Align</span>
                          <div style={{ display: 'flex', gap: '3px' }}>
                            {['left', 'center', 'right'].map(align => (
                              <button
                                key={align}
                                style={{
                                  ...styles.toggleButton,
                                  ...(overlay.style.textAlign === align ? styles.toggleButtonActive : {})
                                }}
                                onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, textAlign: align } }); }}
                              >
                                {align.charAt(0).toUpperCase() + align.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Case */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>Case</span>
                          <div style={{ display: 'flex', gap: '3px' }}>
                            {[
                              { id: 'default', label: 'Aa' },
                              { id: 'upper', label: 'AA' },
                              { id: 'lower', label: 'aa' }
                            ].map(opt => (
                              <button
                                key={opt.id}
                                style={{
                                  ...styles.toggleButton,
                                  ...(overlay.style.textCase === opt.id ? styles.toggleButtonActive : {})
                                }}
                                onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, textCase: opt.id } }); }}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Scope */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>Scope</span>
                          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                            <button
                              style={{
                                ...styles.toggleButton,
                                ...(overlay.scope === 'full' ? styles.toggleButtonActive : {})
                              }}
                              onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { scope: 'full' }); }}
                            >Full Video</button>
                            {clips.map((_, i) => (
                              <button
                                key={i}
                                style={{
                                  ...styles.toggleButton,
                                  ...(overlay.scope === i ? styles.toggleButtonActive : {})
                                }}
                                onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { scope: i }); }}
                              >Clip {i + 1}</button>
                            ))}
                          </div>
                        </div>

                        {/* Save to Bank */}
                        <div style={{ ...styles.controlRow, borderTop: `1px solid ${theme.border.subtle}`, paddingTop: '6px', marginTop: '2px' }}>
                          <span style={{ fontSize: '10px', color: theme.text.secondary }}>Save to:</span>
                          <button
                            style={{ ...styles.toggleButton, borderColor: 'rgba(20,184,166,0.3)', color: '#14b8a6', fontSize: '10px' }}
                            onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(1, overlay.text); toastSuccess('Saved to Bank A'); }}
                          >Bank A</button>
                          <button
                            style={{ ...styles.toggleButton, borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: '10px' }}
                            onClick={(e) => { e.stopPropagation(); handleAddToVideoTextBank(2, overlay.text); toastSuccess('Saved to Bank B'); }}
                          >Bank B</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={() => addTextOverlay()} style={styles.addTextButton}>
                + Add Text Overlay
              </button>
            </div>
          </div>}
        </div>

        {/* ── Audio Info Bar ── */}
        {selectedAudio && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '6px 12px', marginBottom: '4px',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
            borderRadius: '8px'
          }}>
            <span style={{ fontSize: '12px', color: theme.text.primary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedAudio.name}
              {selectedAudio.isTrimmed && <span style={{ marginLeft: '6px', fontSize: '10px', padding: '1px 5px', backgroundColor: 'rgba(139,92,246,0.2)', borderRadius: '4px', color: '#a78bfa' }}>Trimmed</span>}
            </span>
            <button
              onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}
              style={{
                padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                border: '1px solid rgba(139,92,246,0.3)', backgroundColor: 'transparent',
                color: '#a78bfa', cursor: 'pointer'
              }}
            >Trim</button>
            <button
              onClick={() => {
                if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
                if (animationRef.current) cancelAnimationFrame(animationRef.current);
                setSelectedAudio(null); setIsPlaying(false); setCurrentTime(0); setAudioDuration(0);
                setSourceVideoMuted(false);
              }}
              style={{
                padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'transparent',
                color: '#ef4444', cursor: 'pointer'
              }}
            >Remove</button>
          </div>
        )}

        {/* ── Timeline Section ── */}
        {!isMobile && <div style={{ ...styles.timelineSection, position: 'relative' }}>
          {/* Text Controls toggle */}
          <button
            onClick={() => setShowTextPanel(p => !p)}
            style={{
              position: 'absolute', top: '4px', right: '8px', zIndex: 5,
              padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              border: `1px solid ${showTextPanel ? theme.accent.primary : theme.border.default}`,
              backgroundColor: showTextPanel ? theme.accent.primary + '22' : 'transparent',
              color: showTextPanel ? theme.accent.primary : theme.text.secondary,
              cursor: 'pointer'
            }}
          >
            Text Controls
          </button>
          <div
            ref={timelineRef}
            style={styles.timelineTrackArea}
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
            {/* Time Ruler */}
            <div style={styles.timelineRuler}>
              {timelineDuration > 0 && Array.from({ length: Math.ceil(timelineDuration) + 1 }, (_, i) => (
                <div key={i} style={{ position: 'absolute', left: `${(i / timelineDuration) * 100}%`, top: 0, height: '100%' }}>
                  <div style={{ width: '1px', height: i % 5 === 0 ? '10px' : '6px', backgroundColor: theme.border.subtle }} />
                  {i % 2 === 0 && <span style={{ fontSize: '9px', color: theme.text.muted, position: 'absolute', top: '10px', transform: 'translateX(-50%)' }}>{i}s</span>}
                </div>
              ))}
            </div>

            {/* Text Overlay Track */}
            <div style={styles.textTrack} data-timeline-clickable="true">
              {textOverlays.map((overlay) => {
                const startPct = timelineDuration > 0 ? ((overlay.startTime || 0) / timelineDuration) * 100 : 0;
                const widthPct = timelineDuration > 0 ? (((overlay.endTime || 0) - (overlay.startTime || 0)) / timelineDuration) * 100 : 10;
                const isSelected = editingTextId === overlay.id;
                return (
                  <div
                    key={overlay.id}
                    style={{
                      position: 'absolute',
                      left: `${startPct}%`,
                      width: `${widthPct}%`,
                      top: '2px',
                      height: '24px',
                      backgroundColor: isSelected ? '#9333ea' : theme.accent.primary,
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 4px',
                      cursor: timelineDrag ? 'grabbing' : 'grab',
                      overflow: 'hidden',
                      border: isSelected ? '1px solid #a855f7' : '1px solid rgba(124,58,237,0.5)',
                      boxShadow: isSelected ? '0 2px 8px rgba(168,85,247,0.4)' : 'none',
                      zIndex: isSelected ? 10 : 5,
                      transition: timelineDrag ? 'none' : 'background-color 0.15s'
                    }}
                    onMouseDown={(e) => handleTimelineDragStart(e, overlay.id, 'move')}
                  >
                    {/* Left resize handle */}
                    <div
                      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', cursor: 'col-resize', zIndex: 11 }}
                      onMouseDown={(e) => { e.stopPropagation(); handleTimelineDragStart(e, overlay.id, 'left'); }}
                    />
                    <span style={{ fontSize: '10px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', padding: '0 6px' }}>
                      {overlay.text}
                    </span>
                    {/* Right resize handle */}
                    <div
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '6px', cursor: 'col-resize', zIndex: 11 }}
                      onMouseDown={(e) => { e.stopPropagation(); handleTimelineDragStart(e, overlay.id, 'right'); }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Clip Cut Lines — visual snap guides at clip boundaries */}
            {clipCutPoints.slice(1, -1).map((cutTime, i) => (
              <div
                key={`cut-${i}`}
                style={{
                  position: 'absolute',
                  left: `${(cutTime / timelineDuration) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: '1px',
                  backgroundColor: 'rgba(234,179,8,0.4)',
                  zIndex: 15,
                  pointerEvents: 'none'
                }}
              />
            ))}

            {/* Clip Track — multi-clip: segments for each clip */}
            <div style={styles.clipTrack}>
              {clips.map((clipItem, idx) => {
                const clipId = clipItem.id || clipItem.sourceId;
                const clipDur = getClipDuration(clipId);
                let accBefore = 0;
                for (let j = 0; j < idx; j++) {
                  accBefore += getClipDuration(clips[j].id || clips[j].sourceId);
                }
                const leftPct = timelineDuration > 0 ? (accBefore / timelineDuration) * 100 : 0;
                const widthPct = timelineDuration > 0 ? (clipDur / timelineDuration) * 100 : 100;
                return (
                  <div
                    key={idx}
                    style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      top: '2px',
                      height: '40px',
                      backgroundColor: activeClipIndex === idx ? theme.bg.elevated : theme.bg.surface,
                      borderRadius: '4px',
                      overflow: 'hidden',
                      border: activeClipIndex === idx ? `1px solid ${theme.accent.primary}66` : `1px solid ${theme.border.subtle}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    {(clipItem.thumbnailUrl || clipItem.thumbnail) && (
                      <img
                        src={clipItem.thumbnailUrl || clipItem.thumbnail}
                        alt=""
                        style={{ width: '40px', height: '100%', objectFit: 'cover', opacity: 0.6, flexShrink: 0 }}
                      />
                    )}
                    <span style={{ fontSize: '9px', color: theme.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>
                      {clipItem.name || `Clip ${idx + 1}`}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Added Audio Waveform Track (purple) — shown when external audio present */}
            {selectedAudio && !selectedAudio.isSourceVideo && waveformData.length > 0 && (
              <div style={styles.audioTrack}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}>
                  <span style={{ fontSize: '10px' }}>{'\uD83C\uDFB5'}</span>
                  <input type="range" min="0" max="1" step="0.05" value={externalAudioVolume}
                    onChange={e => setExternalAudioVolume(parseFloat(e.target.value))}
                    style={{ width: '36px', height: '3px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    title={`Added audio: ${Math.round(externalAudioVolume * 100)}%`}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
                <div style={{ position: 'absolute', left: '68px', right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: '1px' }}>
                  {waveformData.map((amplitude, i) => (
                    <div key={i} style={{
                      flex: 1, minWidth: '1px', backgroundColor: 'rgba(139, 92, 246, 0.5)',
                      height: `${amplitude * 100}%`, opacity: 0.6
                    }} />
                  ))}
                </div>
              </div>
            )}

            {/* Source Video Audio Waveform Track (blue) — shown when clips have audio */}
            {Object.keys(clipWaveforms).length > 0 && (() => {
              const hasExternal = selectedAudio && !selectedAudio.isSourceVideo;
              return (
                <div style={styles.audioTrack}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}>
                    <button
                      onClick={e => { e.stopPropagation(); setSourceVideoMuted(m => !m); }}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '10px',
                        opacity: (hasExternal && sourceVideoMuted) ? 0.4 : 1
                      }}
                      title={sourceVideoMuted ? 'Unmute source audio' : 'Mute source audio'}
                    >{sourceVideoMuted ? '\uD83D\uDD07' : '\uD83C\uDFAC'}</button>
                    {hasExternal && (
                      <input type="range" min="0" max="1" step="0.05" value={sourceVideoVolume}
                        onChange={e => setSourceVideoVolume(parseFloat(e.target.value))}
                        style={{ width: '36px', height: '3px', accentColor: '#3b82f6', cursor: 'pointer' }}
                        title={`Source audio: ${Math.round(sourceVideoVolume * 100)}%`}
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                  </div>
                  <div style={{ position: 'absolute', left: hasExternal ? '68px' : '20px', right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
                    {clips.map((clipItem, idx) => {
                      const clipId = clipItem.id || clipItem.sourceId;
                      const clipDur = getClipDuration(clipId);
                      let accBefore = 0;
                      for (let j = 0; j < idx; j++) {
                        accBefore += getClipDuration(clips[j].id || clips[j].sourceId);
                      }
                      const leftPct = timelineDuration > 0 ? (accBefore / timelineDuration) * 100 : 0;
                      const widthPct = timelineDuration > 0 ? (clipDur / timelineDuration) * 100 : 100;
                      const data = clipWaveforms[clipId] || [];
                      return (
                        <div key={idx} style={{
                          position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`,
                          top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: '1px',
                          borderRight: idx < clips.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'
                        }}>
                          {data.map((amplitude, i) => (
                            <div key={i} style={{
                              flex: 1, minWidth: '1px', backgroundColor: 'rgba(59, 130, 246, 0.4)',
                              height: `${amplitude * 100}%`, opacity: (hasExternal && sourceVideoMuted) ? 0.3 : 0.6
                            }} />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Playhead — draggable */}
            {timelineDuration > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: `${(currentTime / timelineDuration) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  backgroundColor: '#ef4444',
                  zIndex: 20,
                  pointerEvents: 'auto',
                  cursor: 'ew-resize',
                  transition: (isPlaying && !playheadDragging) ? 'none' : playheadDragging ? 'none' : 'left 0.1s ease-out'
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPlayheadDragging(true);
                  document.body.style.userSelect = 'none';
                  document.body.style.WebkitUserSelect = 'none';
                  const wasPlaying = isPlaying;
                  if (isPlaying) { videoRef.current?.pause(); audioRef.current?.pause(); cancelAnimationFrame(animationRef.current); setIsPlaying(false); }
                  const handleDragMove = (moveE) => {
                    const rect = timelineRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const pct = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width));
                    const t = pct * timelineDuration;
                    handleSeek(t);
                  };
                  const handleDragEnd = () => {
                    setPlayheadDragging(false);
                    document.body.style.userSelect = '';
                    document.body.style.WebkitUserSelect = '';
                    window.removeEventListener('mousemove', handleDragMove);
                    window.removeEventListener('mouseup', handleDragEnd);
                    if (wasPlaying) { videoRef.current?.play(); if (audioRef.current?.src) audioRef.current.play().catch(() => {}); animationRef.current = requestAnimationFrame(playbackLoop); setIsPlaying(true); }
                  };
                  window.addEventListener('mousemove', handleDragMove);
                  window.addEventListener('mouseup', handleDragEnd);
                }}
              >
                {/* Wider grab area */}
                <div style={{ position: 'absolute', left: '-6px', right: '-6px', top: 0, bottom: 0, cursor: 'ew-resize' }} />
                <div style={{
                  position: 'absolute',
                  top: '-2px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '10px',
                  height: '10px',
                  backgroundColor: '#ef4444',
                  borderRadius: '2px',
                  clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
                  cursor: 'ew-resize'
                }} />
              </div>
            )}
          </div>
        </div>}

        {/* ── Editor Toolbar ── */}
        <EditorToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onReroll={visibleVideos.length > 0 || category?.videos?.length > 1 ? handleReroll : null}
          rerollDisabled={!visibleVideos.length && !category?.videos?.length}
          onAddText={() => addTextOverlay()}
          onDelete={clips.length > 1 ? () => removeClipFromTimeline(activeClipIndex) : null}
          audioTracks={libraryAudio}
          onSelectAudio={(audio) => {
            setAudioToTrim(audio);
            setShowAudioTrimmer(true);
          }}
          onUploadAudio={() => audioFileInputRef.current?.click()}
          lyrics={lyricsBank}
          onSelectLyric={(lyric) => addTextOverlay(lyric.content || lyric.title || '')}
          onAddNewLyrics={onAddLyrics ? () => onAddLyrics({ title: 'New Lyrics', content: '' }) : null}
        />

        {/* Hidden audio file input */}
        <input
          ref={audioFileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={handleAudioUpload}
        />

        {/* ── Tab Bar (bottom) ── */}
        <div style={{
          ...styles.tabBar,
          ...(isMobile ? { flexShrink: 0 } : {})
        }}>
          <div style={styles.tabScroll}>
            {allVideos.map((video, idx) => (
              <div
                key={video.id}
                onClick={() => switchToVideo(idx)}
                style={{
                  ...styles.tab,
                  ...(idx === activeVideoIndex ? styles.tabActive : {}),
                  ...(isMobile ? { minHeight: '44px', padding: '6px 14px' } : {})
                }}
              >
                {video.isTemplate ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                ) : (
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>#{idx}</span>
                )}
                <span>{video.isTemplate ? 'Template' : video.name || `Video ${idx}`}</span>
                {!video.isTemplate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteVideo(idx); }}
                    style={styles.tabDeleteButton}
                  >×</button>
                )}
              </div>
            ))}
          </div>

          {/* ── Generate + keepText controls ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', paddingRight: '8px', flexShrink: 0 }}>
            <div style={{
              display: 'flex',
              borderRadius: '4px',
              overflow: 'hidden',
              border: `1px solid ${theme.border.subtle}`
            }}>
              <button
                onClick={() => setKeepTemplateText('none')}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: keepTemplateText === 'none' ? theme.accent.primary : 'transparent',
                  color: keepTemplateText === 'none' ? '#fff' : theme.text.secondary,
                }}
              >Random</button>
              <button
                onClick={() => setKeepTemplateText('all')}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  border: 'none',
                  borderLeft: `1px solid ${theme.border.subtle}`,
                  cursor: 'pointer',
                  backgroundColor: keepTemplateText === 'all' ? theme.accent.primary : 'transparent',
                  color: keepTemplateText === 'all' ? '#fff' : theme.text.secondary,
                }}
              >Keep Text</button>
            </div>
            <input
              type="number"
              min="1"
              max="20"
              value={generateCount}
              onChange={(e) => setGenerateCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              style={{
                width: '36px',
                padding: '4px',
                fontSize: '11px',
                textAlign: 'center',
                borderRadius: '4px',
                border: `1px solid ${theme.border.subtle}`,
                backgroundColor: theme.bg.input,
                color: theme.text.primary,
              }}
            />
            <button
              onClick={executeGeneration}
              disabled={isGenerating}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                backgroundColor: isGenerating ? theme.text.muted : theme.accent.primary,
                color: '#fff',
                opacity: isGenerating ? 0.6 : 1,
              }}
            >{isGenerating ? 'Generating...' : 'Generate'}</button>
          </div>
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

        {/* ── Close Confirmation ── */}
        {showCloseConfirm && (
          <div style={styles.confirmOverlay}>
            <div style={styles.confirmModal}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: theme.text.primary }}>Close editor?</h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: theme.text.secondary }}>
                You have unsaved work. Are you sure you want to close?
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCloseConfirm(false)} style={styles.confirmKeepButton}>Keep Editing</button>
                <button onClick={() => { setShowCloseConfirm(false); onClose(); }} style={styles.confirmCloseButton}>Close Anyway</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Styles ──
const getStyles = (theme) => ({
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px'
  },
  modal: {
    backgroundColor: theme.bg.input,
    borderRadius: '12px',
    width: '100%',
    maxWidth: '1400px',
    maxHeight: '95vh',
    height: '95vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: `1px solid ${theme.bg.surface}`,
    flexShrink: 0
  },
  studioButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.text.primary,
    cursor: 'pointer',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: '600',
    transition: 'background-color 0.2s'
  },
  ratioButton: {
    padding: '4px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: 'transparent',
    color: theme.text.secondary,
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  ratioButtonActive: {
    backgroundColor: `${theme.accent.primary}33`,
    borderColor: theme.accent.primary,
    color: theme.accent.hover
  },
  exportButton: {
    padding: '6px 14px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.hover.bg,
    color: theme.text.primary,
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  saveDraftButton: {
    padding: '6px 14px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#059669',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  saveAllButton: {
    padding: '6px 14px',
    borderRadius: '8px',
    border: 'none',
    background: `linear-gradient(135deg, ${theme.accent.primary}, #8b5cf6)`,
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.text.secondary,
    cursor: 'pointer',
    borderRadius: '6px'
  },
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },

  // ── Left Panel (matches Montage layout) ──
  leftPanel: {
    width: '256px',
    backgroundColor: theme.bg.input,
    borderRight: `1px solid ${theme.border.subtle}`,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'hidden'
  },
  sourceDropdown: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: theme.bg.page,
    border: `1px solid ${theme.border.subtle}`,
    borderRadius: '8px',
    color: theme.text.primary,
    fontSize: '13px',
    outline: 'none',
    cursor: 'pointer'
  },
  bankContent: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '12px'
  },
  sidebarClipGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px'
  },
  sidebarClip: {
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    border: '2px solid transparent',
    transition: 'border-color 0.15s ease'
  },
  textBankInput: {
    flex: 1,
    padding: '6px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.bg.page,
    color: theme.text.primary,
    fontSize: '12px',
    outline: 'none'
  },
  textBankItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: '6px',
    backgroundColor: theme.hover.bg,
    marginBottom: '4px',
    color: theme.text.secondary
  },
  clipGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px',
    marginBottom: '12px'
  },
  clipThumb: {
    position: 'relative',
    aspectRatio: '9/16',
    borderRadius: '6px',
    overflow: 'hidden',
    border: '2px solid transparent',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
    backgroundColor: theme.bg.input
  },
  clipThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  clipThumbPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.text.muted
  },
  timelineItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 8px',
    borderRadius: '6px',
    backgroundColor: theme.hover.bg,
    border: `1px solid ${theme.border.subtle}`,
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  timelineItemActive: {
    backgroundColor: `${theme.accent.primary}1a`,
    borderColor: `${theme.accent.primary}4d`
  },
  timelineButton: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    fontSize: '11px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
    transition: 'color 0.15s'
  },
  timelineRemoveButton: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    fontSize: '14px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1
  },
  generateSection: {
    padding: '12px',
    backgroundColor: `${theme.accent.primary}14`,
    borderRadius: '8px',
    border: `1px solid ${theme.accent.primary}26`,
    marginTop: '12px'
  },
  generateInput: {
    width: '50px',
    padding: '4px 6px',
    borderRadius: '4px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.bg.input,
    color: theme.text.primary,
    fontSize: '12px',
    textAlign: 'center'
  },
  generateButton: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: 'none',
    background: `linear-gradient(135deg, ${theme.accent.primary}, #8b5cf6)`,
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },

  // ── Center Preview (matches Montage layout) ──
  previewContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
    overflow: 'hidden',
    padding: '16px 24px 8px',
    backgroundColor: theme.bg.page
  },
  preview: {
    position: 'relative',
    aspectRatio: '9/16',
    backgroundColor: '#000',
    borderRadius: '12px',
    overflow: 'hidden',
    flex: 1,
    minHeight: 0,
    width: 'auto',
    maxWidth: '100%',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
  },
  previewVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  previewPlaceholder: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg.page
  },
  progressBarContainer: {
    position: 'relative',
    width: '100%',
    maxWidth: '400px',
    height: '4px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '2px',
    marginTop: '10px',
    cursor: 'pointer'
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: theme.accent.primary,
    borderRadius: '3px',
    transition: 'width 0.1s linear'
  },
  progressHandle: {
    position: 'absolute',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: '12px',
    height: '12px',
    backgroundColor: theme.text.primary,
    borderRadius: '50%',
    boxShadow: `0 2px 4px ${theme.overlay.light}`
  },
  playbackControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    marginTop: '6px',
    paddingBottom: '4px'
  },
  playButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: '50%',
    color: theme.text.primary,
    cursor: 'pointer',
    transition: 'background-color 0.15s'
  },
  timeDisplay: {
    flex: 1,
    fontSize: '12px',
    color: theme.text.secondary,
    textAlign: 'center'
  },
  muteButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.text.muted,
    cursor: 'pointer'
  },

  // ── Right Panel ──
  rightPanel: {
    width: '256px',
    borderLeft: `1px solid ${theme.border.subtle}`,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'hidden'
  },
  rightPanelScroll: {
    flex: 1,
    overflow: 'auto',
    padding: '0 0 12px 0'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 12px 6px',
    fontSize: '12px',
    fontWeight: 600,
    color: theme.text.primary,
    letterSpacing: '-0.01em'
  },
  divider: {
    height: '1px',
    backgroundColor: theme.border.subtle,
    margin: '12px 0'
  },

  // ── Overlay cards ──
  overlayCard: {
    margin: '0 8px 6px',
    padding: '10px',
    borderRadius: '8px',
    backgroundColor: theme.hover.bg,
    border: `1px solid ${theme.border.subtle}`,
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  overlayCardActive: {
    backgroundColor: `${theme.accent.primary}1a`,
    borderColor: `${theme.accent.primary}4d`
  },
  removeOverlayButton: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    fontSize: '16px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1
  },
  textEditInput: {
    width: '100%',
    padding: '6px 8px',
    borderRadius: '4px',
    border: `1px solid ${theme.accent.primary}4d`,
    backgroundColor: theme.bg.input,
    color: theme.text.primary,
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box'
  },
  styleControls: {
    marginTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingTop: '8px',
    borderTop: `1px solid ${theme.border.subtle}`
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap'
  },
  controlLabel: {
    fontSize: '10px',
    color: theme.text.secondary,
    minWidth: '34px'
  },
  selectInput: {
    flex: 1,
    padding: '3px 6px',
    borderRadius: '4px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.bg.input,
    color: theme.text.primary,
    fontSize: '11px'
  },
  sizeButton: {
    padding: '3px 8px',
    borderRadius: '4px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.hover.bg,
    color: theme.text.primary,
    fontSize: '11px',
    cursor: 'pointer'
  },
  colorInput: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    border: `1px solid ${theme.border.subtle}`,
    cursor: 'pointer',
    backgroundColor: 'transparent',
    padding: 0
  },
  toggleButton: {
    padding: '3px 8px',
    borderRadius: '4px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: 'transparent',
    color: theme.text.secondary,
    fontSize: '10px',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  toggleButtonActive: {
    backgroundColor: `${theme.accent.primary}33`,
    borderColor: theme.accent.primary,
    color: theme.accent.hover
  },
  addTextButton: {
    margin: '6px 8px',
    padding: '10px',
    borderRadius: '8px',
    border: `1px dashed ${theme.accent.primary}66`,
    backgroundColor: 'transparent',
    color: theme.accent.hover,
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s'
  },

  // ── Audio section ──
  audioSection: {
    margin: '0 12px 4px',
    padding: '10px',
    borderRadius: '8px',
    backgroundColor: theme.hover.bg,
    border: `1px solid ${theme.hover.bg}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  audioTrackButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.hover.bg,
    color: theme.text.primary,
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    width: '100%',
    textAlign: 'left'
  },
  audioTrackButtonActive: {
    borderColor: '#8b5cf6',
    backgroundColor: 'rgba(139,92,246,0.1)',
    color: '#8b5cf6'
  },
  audioNowPlaying: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '6px',
    backgroundColor: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.25)',
    color: theme.text.primary,
    fontSize: '11px'
  },

  // ── Text banks ──
  bankContainer: {
    margin: '0 12px 10px',
    padding: '10px',
    borderRadius: '8px',
    backgroundColor: theme.hover.bg,
    border: `1px solid ${theme.hover.bg}`
  },
  textBankInput: {
    flex: 1,
    padding: '5px 8px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.bg.input,
    color: theme.text.primary,
    fontSize: '12px',
    outline: 'none'
  },
  textBankAddButton: {
    padding: '4px 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#14b8a6',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    flexShrink: 0
  },
  textBankList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px'
  },
  textBankTag: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 8px',
    borderRadius: '6px',
    backgroundColor: 'rgba(20,184,166,0.1)',
    border: '1px solid rgba(20,184,166,0.2)',
    color: theme.text.primary,
    fontSize: '11px'
  },
  textBankRemove: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    fontSize: '13px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1
  },

  // ── Timeline ──
  timelineSection: {
    borderTop: `1px solid ${theme.border.subtle}`,
    flexShrink: 0,
    backgroundColor: theme.bg.page,
    padding: '0 8px'
  },
  timelineTrackArea: {
    position: 'relative',
    height: '140px',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none'
  },
  timelineRuler: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '22px',
    borderBottom: `1px solid ${theme.border.subtle}`
  },
  textTrack: {
    position: 'absolute',
    top: '22px',
    left: 0,
    right: 0,
    height: '28px'
  },
  clipTrack: {
    position: 'absolute',
    top: '54px',
    left: 0,
    right: 0,
    height: '44px'
  },
  audioTrack: {
    position: 'absolute',
    top: '102px',
    left: 0,
    right: 0,
    height: '30px',
    borderTop: `1px solid ${theme.border.subtle}`
  },

  // ── Tab Bar ──
  tabBar: {
    borderTop: `1px solid ${theme.border.subtle}`,
    flexShrink: 0,
    backgroundColor: theme.overlay.light
  },
  tabScroll: {
    display: 'flex',
    overflow: 'auto',
    padding: '6px 8px',
    gap: '4px'
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '6px',
    backgroundColor: theme.hover.bg,
    border: '1px solid transparent',
    color: theme.text.secondary,
    fontSize: '11px',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
    flexShrink: 0
  },
  tabActive: {
    backgroundColor: `${theme.accent.primary}26`,
    borderColor: `${theme.accent.primary}4d`,
    color: theme.text.primary
  },
  tabDeleteButton: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    fontSize: '14px',
    cursor: 'pointer',
    padding: '0 2px',
    marginLeft: '2px',
    lineHeight: 1
  },

  // ── Confirm Modal ──
  confirmOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100
  },
  confirmModal: {
    backgroundColor: theme.bg.elevated,
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '360px',
    width: '100%',
    border: `1px solid ${theme.border.subtle}`
  },
  confirmKeepButton: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: 'transparent',
    color: theme.text.primary,
    fontSize: '13px',
    cursor: 'pointer'
  },
  confirmCloseButton: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#dc2626',
    color: '#fff',
    fontSize: '13px',
    cursor: 'pointer'
  }
});

export default MultiClipEditor;
