import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary, getLyrics,
  addToVideoTextBank, removeFromVideoTextBank, updateVideoTextBank,
  addToLibrary, MEDIA_TYPES
} from '../../services/libraryService';
import { useToast } from '../ui';
import AudioClipSelector from './AudioClipSelector';
import LyricBank from './LyricBank';

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
  const [isExporting, setIsExporting] = useState(false);

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

  // ── Audio state ──
  const [selectedAudio, setSelectedAudio] = useState(existingVideo?.audio || null);
  const audioRef = useRef(null);

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
  const videoRef = useRef(null);
  const animationRef = useRef(null);

  // ── Aspect ratio ──
  const [aspectRatio, setAspectRatio] = useState(existingVideo?.cropMode || '9:16');

  // ── Text editing state ──
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [draggingTextId, setDraggingTextId] = useState(null);
  const dragStartRef = useRef(null);
  const previewRef = useRef(null);

  // ── Library state ──
  const [collections, setCollections] = useState([]);
  const [libraryMedia, setLibraryMedia] = useState([]);

  // Derive library audio from libraryMedia
  const libraryAudio = libraryMedia.filter(i => i.type === MEDIA_TYPES.AUDIO);

  // ── Text bank input state ──
  const [newTextA, setNewTextA] = useState('');
  const [newTextB, setNewTextB] = useState('');

  // ── Close confirmation ──
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // ── Lyrics state ──
  const [lyricsBank, setLyricsBank] = useState([]);

  // ── Audio trimmer state ──
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);

  // ── Mobile detection ──
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  const playbackLoop = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
    animationRef.current = requestAnimationFrame(playbackLoop);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      if (audioRef.current) audioRef.current.pause();
      cancelAnimationFrame(animationRef.current);
    } else {
      videoRef.current.play();
      if (audioRef.current && audioRef.current.src) audioRef.current.play().catch(() => {});
      animationRef.current = requestAnimationFrame(playbackLoop);
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, playbackLoop]);

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
      audioRef.current.currentTime = time;
    }
  }, [clips]);

  // ── Audio selection ──
  const handleAudioSelect = useCallback((audio) => {
    setSelectedAudio(audio);
    if (audioRef.current && audio) {
      const url = audio.localUrl || audio.url;
      audioRef.current.src = url;
      audioRef.current.load();
    } else if (audioRef.current && !audio) {
      audioRef.current.src = '';
    }
  }, []);

  // ── Audio trim save handler ──
  const handleAudioTrimSave = useCallback((trimResult) => {
    // Create a local URL for the trimmed file if we have one
    if (trimResult.trimmedFile) {
      const localUrl = URL.createObjectURL(trimResult.trimmedFile);
      const savedAudio = {
        id: `audio_trim_${Date.now()}`,
        type: MEDIA_TYPES.AUDIO,
        name: trimResult.trimmedName || 'Trimmed Audio',
        url: localUrl,
        localUrl: localUrl,
        duration: trimResult.duration
      };
      // Save to library
      if (artistId) {
        addToLibrary(artistId, savedAudio);
        setLibraryMedia(getLibrary(artistId));
      }
      handleAudioSelect(savedAudio);
      toastSuccess(`Saved "${savedAudio.name}"`);
    } else {
      // Metadata-only trim — update selectedAudio with trim points
      setSelectedAudio(prev => prev ? { ...prev, startTime: trimResult.startTime, endTime: trimResult.endTime } : prev);
    }
    setShowAudioTrimmer(false);
  }, [artistId, handleAudioSelect, toastSuccess]);

  const handleAudioSaveClip = useCallback((clipData) => {
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
    addToLibrary(artistId, savedClip);
    setLibraryMedia(getLibrary(artistId));
    toastSuccess(`Saved clip "${clipData.name}" to library`);
  }, [selectedAudio, artistId, toastSuccess]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
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

  const addTextOverlay = useCallback((prefillText) => {
    const newOverlay = {
      id: `text_${Date.now()}`,
      text: prefillText || 'Click to edit',
      style: getDefaultTextStyle(),
      position: { x: 50, y: 50, width: 80, height: 20 },
      scope: 'full'
    };
    setTextOverlays(prev => [...prev, newOverlay]);
    setEditingTextId(newOverlay.id);
    setEditingTextValue(newOverlay.text);
  }, [getDefaultTextStyle, setTextOverlays]);

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
    setClips(prev => prev.filter((_, i) => i !== clipIndex));
    if (activeClipIndex >= clipIndex && activeClipIndex > 0) {
      setActiveClipIndex(prev => Math.max(0, prev - 1));
    }
  }, [setClips, activeClipIndex]);

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
          const bank = idx === 0 ? videoTextBank1 : idx === 1 ? videoTextBank2 : combinedBank;
          if (bank.length > 0) {
            newText = bank[(existingGenCount + i) % bank.length];
          }
          return {
            ...overlay,
            id: `text_${timestamp}_${i}_${idx}`,
            text: newText,
            scope: overlay.scope // preserve scope
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
  }, [allVideos, generateCount, category, getVideoTextBanks, toastSuccess, toastError]);

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
      updatedAt: new Date().toISOString()
    };
    onSave(videoData);
    toastSuccess(`Saved "${video.name || 'Multi-Clip'}"`);
  }, [allVideos, activeVideoIndex, totalDuration, aspectRatio, selectedAudio, existingVideo, onSave, toastSuccess, toastError]);

  // ── Save All & Close ──
  const handleSaveAllAndClose = useCallback(() => {
    let savedCount = 0;
    const timestamp = Date.now();
    allVideos.forEach((video) => {
      if (!video.clips || video.clips.length === 0) return;
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
      onSave(videoData);
      savedCount++;
    });
    toastSuccess(`Saved ${savedCount} video${savedCount !== 1 ? 's' : ''}!`);
    onClose();
  }, [allVideos, totalDuration, aspectRatio, selectedAudio, existingVideo, onSave, onClose, toastSuccess]);

  // ── Export ──
  const handleExport = useCallback(() => {
    const video = allVideos[activeVideoIndex];
    if (!video?.clips || video.clips.length === 0 || video.textOverlays.length === 0) {
      toastError('Need clips and at least one text overlay to export.');
      return;
    }
    setIsExporting(true);
    try {
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
        status: 'rendered',
        createdAt: existingVideo?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      onSave(videoData);
      toastSuccess(`Exported "${video.name || 'Multi-Clip'}"`);
    } finally {
      setIsExporting(false);
    }
  }, [allVideos, activeVideoIndex, totalDuration, aspectRatio, selectedAudio, existingVideo, onSave, toastSuccess, toastError]);

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

  // Get clip URL safely
  const getClipUrl = (clipObj) => {
    if (!clipObj) return null;
    const localUrl = clipObj.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    return isBlobUrl ? clipObj.url : (localUrl || clipObj.url || clipObj.src);
  };

  // Currently editing overlay
  const editingOverlay = textOverlays.find(o => o.id === editingTextId);

  // Aspect ratio dimensions
  const getPreviewDimensions = () => {
    if (aspectRatio === '9:16') return { width: 270, height: 480 };
    if (aspectRatio === '4:3') return { width: 400, height: 300 };
    if (aspectRatio === '1:1') return { width: 360, height: 360 };
    return { width: 270, height: 480 };
  };
  const previewDims = getPreviewDimensions();

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Video text banks for right panel
  const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();

  // Get current clip for video display
  const currentClip = getCurrentClip();

  // Check if text overlay should be visible in current clip
  const isOverlayVisible = (overlay) => {
    if (overlay.scope === 'full') return true;
    if (typeof overlay.scope === 'number') return overlay.scope === activeClipIndex;
    return true;
  };

  // ── RENDER ──
  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && handleCloseRequest()}>
      <div style={styles.modal}>

        {/* ── Header ── */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={handleCloseRequest} style={styles.backButton}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h2 style={styles.headerTitle}>Multi-Clip Editor</h2>
              <span style={styles.headerSubtitle}>
                {allVideos.length === 1 ? 'Design your template' : `${allVideos.length} videos (1 template + ${allVideos.length - 1} generated)`}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Aspect ratio toggles */}
            {['9:16', '1:1', '4:3'].map(ratio => (
              <button
                key={ratio}
                onClick={() => setAspectRatio(ratio)}
                style={{
                  ...styles.ratioButton,
                  ...(aspectRatio === ratio ? styles.ratioButtonActive : {})
                }}
              >
                {ratio}
              </button>
            ))}
            <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
            {/* Export */}
            <button
              onClick={handleExport}
              disabled={!currentClip || textOverlays.length === 0 || isExporting}
              style={{
                ...styles.exportButton,
                ...(!currentClip || textOverlays.length === 0 || isExporting ? { opacity: 0.4, cursor: 'not-allowed' } : {})
              }}
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
            {/* Save Draft */}
            <button onClick={handleSaveDraft} style={styles.saveDraftButton}>
              Save Draft
            </button>
            {/* Save All */}
            {allVideos.length > 1 && (
              <button onClick={handleSaveAllAndClose} style={styles.saveAllButton}>
                Save All ({allVideos.length})
              </button>
            )}
            {/* Close */}
            <button onClick={handleCloseRequest} style={styles.closeButton}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Main Content — 3 Columns ── */}
        <div style={styles.mainContent}>

          {/* ── LEFT PANEL: Clips Grid + Timeline ── */}
          <div style={styles.leftPanel}>
            <div style={{ padding: '12px', flex: 1, overflow: 'auto' }}>
              {/* Available Clips Grid */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '8px' }}>Available Clips</div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
                  Click to add to timeline
                </div>
                <div style={styles.clipGrid}>
                  {(category?.videos || []).map((v) => {
                    return (
                      <div
                        key={v.id}
                        onClick={() => addClipToTimeline(v)}
                        style={styles.clipThumb}
                        title="Click to add to timeline"
                      >
                        {v.thumbnailUrl || v.thumbnail ? (
                          <img src={v.thumbnailUrl || v.thumbnail} alt="" style={styles.clipThumbImg} />
                        ) : (
                          <div style={styles.clipThumbPlaceholder}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <rect x="2" y="4" width="20" height="16" rx="2" />
                              <path d="M10 9l5 3-5 3V9z" />
                            </svg>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Timeline */}
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '8px' }}>
                  Timeline ({clips.length} clip{clips.length !== 1 ? 's' : ''})
                </div>
                {clips.length === 0 ? (
                  <div style={{ fontSize: '11px', color: '#6b7280', padding: '12px', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
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
                        <div style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500, minWidth: '20px' }}>
                          {idx + 1}.
                        </div>
                        {clip.thumbnailUrl || clip.thumbnail ? (
                          <img src={clip.thumbnailUrl || clip.thumbnail} alt="" style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '32px', height: '32px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="2" y="4" width="20" height="16" rx="2" />
                              <path d="M10 9l5 3-5 3V9z" />
                            </svg>
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '11px', color: '#d1d5db', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {clip.name || 'Clip'}
                          </div>
                          <div style={{ fontSize: '9px', color: '#6b7280' }}>
                            {formatTime(getClipDuration(clip.id || clip.sourceId))}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveClipUp(idx); }}
                            disabled={idx === 0}
                            style={{ ...styles.timelineButton, ...(idx === 0 ? { opacity: 0.3, cursor: 'not-allowed' } : {}) }}
                            title="Move up"
                          >
                            ▲
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveClipDown(idx); }}
                            disabled={idx >= clips.length - 1}
                            style={{ ...styles.timelineButton, ...(idx >= clips.length - 1 ? { opacity: 0.3, cursor: 'not-allowed' } : {}) }}
                            title="Move down"
                          >
                            ▼
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeClipFromTimeline(idx); }}
                            style={styles.timelineRemoveButton}
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Generation controls */}
              <div style={styles.generateSection}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '6px' }}>Generate Videos</div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
                  Randomize clips and text from banks
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#d1d5db' }}>Count:</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, (category?.videos?.length || 1) - 1)}
                    value={generateCount}
                    onChange={(e) => setGenerateCount(Math.max(1, Math.min((category?.videos?.length || 1) - 1, parseInt(e.target.value) || 1)))}
                    style={styles.generateInput}
                  />
                  <button
                    onClick={executeGeneration}
                    disabled={isGenerating || textOverlays.length === 0 || clips.length === 0}
                    style={{
                      ...styles.generateButton,
                      ...(isGenerating || textOverlays.length === 0 || clips.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {})
                    }}
                  >
                    {isGenerating ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── CENTER: Video Preview ── */}
          <div style={styles.previewArea}>
            <div
              ref={previewRef}
              style={{
                ...styles.previewContainer,
                width: previewDims.width,
                height: previewDims.height
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
                      setCurrentTime(0);
                    } else {
                      setIsPlaying(false);
                      if (animationRef.current) cancelAnimationFrame(animationRef.current);
                    }
                  }}
                  loop={false}
                  playsInline
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '8px'
                  }}
                  crossOrigin="anonymous"
                />
              ) : (
                <div style={styles.previewPlaceholder}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M10 9l5 3-5 3V9z" />
                  </svg>
                  <p style={{ color: '#6b7280', marginTop: 8, fontSize: 12 }}>No clips in timeline</p>
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
                      border: editingTextId === overlay.id ? '1px dashed rgba(99,102,241,0.6)' : '1px dashed transparent',
                      transition: 'border-color 0.15s'
                    }}
                  >
                    {displayText}
                  </div>
                );
              })}
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

              <div
                style={styles.progressBar}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = (e.clientX - rect.left) / rect.width;
                  handleSeek(percent * totalDuration);
                }}
              >
                <div style={{ ...styles.progressFill, width: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%` }} />
              </div>

              <span style={styles.timeDisplay}>
                {formatTime(currentTime)} / {formatTime(totalDuration)}
              </span>

              <button onClick={() => setIsMuted(!isMuted)} style={styles.muteButton}>
                {isMuted ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" />
                    <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* ── RIGHT PANEL: Text Overlays + Style + Video Text Banks ── */}
          <div style={styles.rightPanel}>
            <div style={styles.rightPanelScroll}>

              {/* ── TEXT OVERLAYS SECTION ── */}
              <div style={styles.sectionHeader}>
                <span>Text Overlays</span>
                <span style={{ fontSize: '10px', color: '#6b7280' }}>{textOverlays.length}</span>
              </div>

              {textOverlays.length === 0 && (
                <div style={{ fontSize: '12px', color: '#6b7280', textAlign: 'center', padding: '16px 12px' }}>
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
                      <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>Overlay {idx + 1}</span>
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
                      <div style={{ fontSize: '13px', color: '#e5e7eb' }}>{overlay.text}</div>
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
                            <span style={{ fontSize: '11px', color: '#d1d5db', minWidth: '26px', textAlign: 'center' }}>{overlay.style.fontSize}</span>
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
                        <div style={{ ...styles.controlRow, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px', marginTop: '2px' }}>
                          <span style={{ fontSize: '10px', color: '#9ca3af' }}>Save to:</span>
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

              {/* ── DIVIDER ── */}
              <div style={styles.divider} />

              {/* ── AUDIO SECTION ── */}
              <div style={styles.sectionHeader}>
                <span>Audio</span>
              </div>
              <div style={styles.audioSection}>
                {/* Now playing indicator */}
                {selectedAudio && (
                  <div style={styles.audioNowPlaying}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedAudio.isSourceVideo ? 'Source Video Audio' : (selectedAudio.name || selectedAudio.fileName || 'Audio Track')}
                      </span>
                      {selectedAudio.duration && (
                        <span style={{ fontSize: '10px', color: '#9ca3af', flexShrink: 0 }}>
                          {Math.floor(selectedAudio.duration / 60)}:{Math.floor(selectedAudio.duration % 60).toString().padStart(2, '0')}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      {!selectedAudio.isSourceVideo && (
                        <button
                          onClick={() => setShowAudioTrimmer(true)}
                          style={{ background: 'none', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: '10px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px' }}
                        >Trim</button>
                      )}
                      <button
                        onClick={() => handleAudioSelect(null)}
                        style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '14px', cursor: 'pointer', padding: '0 2px' }}
                      >×</button>
                    </div>
                  </div>
                )}

                {/* Source Video Audio button */}
                {currentClip && (
                  <button
                    onClick={() => {
                      const clipUrl = currentClip.localUrl || currentClip.url || currentClip.src;
                      handleAudioSelect({ id: 'source_video', name: 'Source Video Audio', url: clipUrl, localUrl: clipUrl, isSourceVideo: true });
                    }}
                    style={{
                      ...styles.audioTrackButton,
                      ...(selectedAudio?.isSourceVideo ? styles.audioTrackButtonActive : {})
                    }}
                  >
                    <span style={{ fontSize: '13px' }}>🎤</span>
                    <span style={{ flex: 1, textAlign: 'left' }}>Source Video Audio</span>
                  </button>
                )}

                {/* Library audio tracks */}
                {libraryAudio.length > 0 && (
                  <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {libraryAudio.map(audio => {
                      const isSelected = selectedAudio && !selectedAudio.isSourceVideo && selectedAudio.id === audio.id;
                      return (
                        <button
                          key={audio.id}
                          onClick={() => handleAudioSelect(audio)}
                          style={{
                            ...styles.audioTrackButton,
                            ...(isSelected ? styles.audioTrackButtonActive : {})
                          }}
                        >
                          <span style={{ fontSize: '13px' }}>🎵</span>
                          <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {audio.name || audio.fileName || 'Untitled'}
                          </span>
                          {audio.duration && (
                            <span style={{ fontSize: '10px', color: '#9ca3af', flexShrink: 0 }}>
                              {Math.floor(audio.duration / 60)}:{Math.floor(audio.duration % 60).toString().padStart(2, '0')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Empty state */}
                {!currentClip && libraryAudio.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#4b5563', padding: '8px 0', textAlign: 'center' }}>
                    No audio available. Add audio to your library to use here.
                  </div>
                )}
              </div>

              {/* ── DIVIDER ── */}
              <div style={styles.divider} />

              {/* ── LYRICS SECTION ── */}
              <div style={styles.sectionHeader}>
                <span>Lyrics</span>
                <span style={{ fontSize: '10px', color: '#6b7280' }}>{lyricsBank.length}</span>
              </div>
              <div style={{ margin: '0 4px 4px', maxHeight: '200px', overflow: 'auto' }}>
                <LyricBank
                  lyrics={lyricsBank}
                  onAddLyrics={(data) => {
                    onAddLyrics?.(data);
                    if (artistId) setTimeout(() => setLyricsBank(getLyrics(artistId)), 100);
                  }}
                  onUpdateLyrics={(id, updates) => {
                    onUpdateLyrics?.(id, updates);
                    if (artistId) setTimeout(() => setLyricsBank(getLyrics(artistId)), 100);
                  }}
                  onDeleteLyrics={(id) => {
                    onDeleteLyrics?.(id);
                    if (artistId) setTimeout(() => setLyricsBank(getLyrics(artistId)), 100);
                  }}
                  onSelectText={(text) => addTextOverlay(text)}
                  compact={true}
                  showAddForm={true}
                />
              </div>

              {/* ── DIVIDER ── */}
              <div style={styles.divider} />

              {/* ── VIDEO TEXT BANKS SECTION (always visible) ── */}
              <div style={styles.sectionHeader}>
                <span>Video Text Banks</span>
              </div>
              <div style={{ fontSize: '11px', color: '#6b7280', padding: '0 12px 8px', lineHeight: '1.4' }}>
                Click any bank text to add it as an overlay. During generation, Overlay 1 cycles Bank A, Overlay 2 cycles Bank B.
              </div>

              {/* Bank A */}
              <div style={styles.bankContainer}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#14b8a6', marginBottom: '6px' }}>
                  Bank A ({videoTextBank1.length})
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                  <input
                    value={newTextA}
                    onChange={(e) => setNewTextA(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }}
                    placeholder="Add text..."
                    style={styles.textBankInput}
                  />
                  <button
                    onClick={() => { if (newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }}
                    style={styles.textBankAddButton}
                  >+</button>
                </div>
                <div style={styles.textBankList}>
                  {videoTextBank1.map((text, i) => (
                    <div key={i} style={styles.textBankTag}>
                      <span
                        onClick={() => addTextOverlay(text)}
                        style={{ cursor: 'pointer' }}
                        title="Click to add as overlay"
                      >{text}</span>
                      <button
                        onClick={() => handleRemoveFromVideoTextBank(1, i)}
                        style={styles.textBankRemove}
                      >×</button>
                    </div>
                  ))}
                  {videoTextBank1.length === 0 && <span style={{ fontSize: '11px', color: '#4b5563' }}>Empty</span>}
                </div>
              </div>

              {/* Bank B */}
              <div style={styles.bankContainer}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '6px' }}>
                  Bank B ({videoTextBank2.length})
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                  <input
                    value={newTextB}
                    onChange={(e) => setNewTextB(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }}
                    placeholder="Add text..."
                    style={styles.textBankInput}
                  />
                  <button
                    onClick={() => { if (newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }}
                    style={{ ...styles.textBankAddButton, backgroundColor: '#f59e0b' }}
                  >+</button>
                </div>
                <div style={styles.textBankList}>
                  {videoTextBank2.map((text, i) => (
                    <div key={i} style={{ ...styles.textBankTag, borderColor: 'rgba(245,158,11,0.3)' }}>
                      <span
                        onClick={() => addTextOverlay(text)}
                        style={{ cursor: 'pointer' }}
                        title="Click to add as overlay"
                      >{text}</span>
                      <button
                        onClick={() => handleRemoveFromVideoTextBank(2, i)}
                        style={styles.textBankRemove}
                      >×</button>
                    </div>
                  ))}
                  {videoTextBank2.length === 0 && <span style={{ fontSize: '11px', color: '#4b5563' }}>Empty</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab Bar (bottom) ── */}
        <div style={styles.tabBar}>
          <div style={styles.tabScroll}>
            {allVideos.map((video, idx) => (
              <div
                key={video.id}
                onClick={() => switchToVideo(idx)}
                style={{
                  ...styles.tab,
                  ...(idx === activeVideoIndex ? styles.tabActive : {})
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
        </div>

        {/* ── Hidden Audio Element ── */}
        <audio ref={audioRef} style={{ display: 'none' }} crossOrigin="anonymous" />

        {/* ── Audio Trimmer Modal ── */}
        {showAudioTrimmer && selectedAudio && (
          <AudioClipSelector
            audioUrl={selectedAudio.localUrl || selectedAudio.url}
            audioName={selectedAudio.name || selectedAudio.fileName || 'Audio'}
            onSave={handleAudioTrimSave}
            onSaveClip={handleAudioSaveClip}
            onCancel={() => setShowAudioTrimmer(false)}
          />
        )}

        {/* ── Close Confirmation ── */}
        {showCloseConfirm && (
          <div style={styles.confirmOverlay}>
            <div style={styles.confirmModal}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#fff' }}>Close editor?</h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#9ca3af' }}>
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
const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '10px'
  },
  modal: {
    backgroundColor: '#1a1a2e',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.08)',
    width: '100%',
    maxWidth: '1400px',
    height: '92vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0
  },
  headerTitle: {
    margin: 0,
    fontSize: '15px',
    fontWeight: '600',
    color: '#ffffff'
  },
  headerSubtitle: {
    fontSize: '11px',
    color: '#9ca3af'
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center'
  },
  ratioButton: {
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  ratioButtonActive: {
    backgroundColor: 'rgba(99,102,241,0.2)',
    borderColor: '#6366f1',
    color: '#a5b4fc'
  },
  exportButton: {
    padding: '6px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: '#d1d5db',
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
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center'
  },
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },

  // ── Left Panel ──
  leftPanel: {
    width: '260px',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'hidden'
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
    backgroundColor: '#111118'
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
    color: '#4b5563'
  },
  timelineItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 8px',
    borderRadius: '6px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  timelineItemActive: {
    backgroundColor: 'rgba(99,102,241,0.1)',
    borderColor: 'rgba(99,102,241,0.3)'
  },
  timelineButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    fontSize: '11px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
    transition: 'color 0.15s'
  },
  timelineRemoveButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1
  },
  generateSection: {
    padding: '12px',
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderRadius: '8px',
    border: '1px solid rgba(99,102,241,0.15)',
    marginTop: '12px'
  },
  generateInput: {
    width: '50px',
    padding: '4px 6px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.15)',
    backgroundColor: '#111118',
    color: '#fff',
    fontSize: '12px',
    textAlign: 'center'
  },
  generateButton: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },

  // ── Center Preview ──
  previewArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    overflow: 'hidden'
  },
  previewContainer: {
    position: 'relative',
    borderRadius: '10px',
    overflow: 'hidden',
    backgroundColor: '#111118',
    flexShrink: 0
  },
  previewPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  playbackControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '12px',
    width: '100%',
    maxWidth: '480px'
  },
  playButton: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  progressBar: {
    flex: 1,
    height: '6px',
    borderRadius: '3px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: '3px',
    background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
    transition: 'width 0.1s linear'
  },
  timeDisplay: {
    fontSize: '11px',
    color: '#9ca3af',
    fontFamily: 'monospace',
    minWidth: '80px',
    textAlign: 'center',
    flexShrink: 0
  },
  muteButton: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0
  },

  // ── Right Panel ──
  rightPanel: {
    width: '320px',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
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
    color: '#e5e7eb',
    letterSpacing: '-0.01em'
  },
  divider: {
    height: '1px',
    backgroundColor: 'rgba(255,255,255,0.08)',
    margin: '12px 0'
  },

  // ── Overlay cards ──
  overlayCard: {
    margin: '0 8px 6px',
    padding: '10px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  overlayCardActive: {
    backgroundColor: 'rgba(99,102,241,0.1)',
    borderColor: 'rgba(99,102,241,0.3)'
  },
  removeOverlayButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1
  },
  textEditInput: {
    width: '100%',
    padding: '6px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(99,102,241,0.3)',
    backgroundColor: '#111118',
    color: '#fff',
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
    borderTop: '1px solid rgba(255,255,255,0.06)'
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap'
  },
  controlLabel: {
    fontSize: '10px',
    color: '#9ca3af',
    minWidth: '34px'
  },
  selectInput: {
    flex: 1,
    padding: '3px 6px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.15)',
    backgroundColor: '#111118',
    color: '#fff',
    fontSize: '11px'
  },
  sizeButton: {
    padding: '3px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: '#d1d5db',
    fontSize: '11px',
    cursor: 'pointer'
  },
  colorInput: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.15)',
    cursor: 'pointer',
    backgroundColor: 'transparent',
    padding: 0
  },
  toggleButton: {
    padding: '3px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    fontSize: '10px',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  toggleButtonActive: {
    backgroundColor: 'rgba(99,102,241,0.2)',
    borderColor: '#6366f1',
    color: '#a5b4fc'
  },
  addTextButton: {
    margin: '6px 8px',
    padding: '10px',
    borderRadius: '8px',
    border: '1px dashed rgba(99,102,241,0.4)',
    backgroundColor: 'transparent',
    color: '#a5b4fc',
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
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
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
    border: '1px solid rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    color: '#d1d5db',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    width: '100%',
    textAlign: 'left'
  },
  audioTrackButtonActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.1)',
    color: '#22c55e'
  },
  audioNowPlaying: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '6px',
    backgroundColor: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.25)',
    color: '#d1d5db',
    fontSize: '11px'
  },

  // ── Text banks ──
  bankContainer: {
    margin: '0 12px 10px',
    padding: '10px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)'
  },
  textBankInput: {
    flex: 1,
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: '#111118',
    color: '#fff',
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
    color: '#d1d5db',
    fontSize: '11px'
  },
  textBankRemove: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1
  },

  // ── Tab Bar ──
  tabBar: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
    backgroundColor: 'rgba(0,0,0,0.2)'
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
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: '1px solid transparent',
    color: '#9ca3af',
    fontSize: '11px',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
    flexShrink: 0
  },
  tabActive: {
    backgroundColor: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.3)',
    color: '#e5e7eb'
  },
  tabDeleteButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100
  },
  confirmModal: {
    backgroundColor: '#1e1e32',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '360px',
    width: '100%',
    border: '1px solid rgba(255,255,255,0.1)'
  },
  confirmKeepButton: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.15)',
    backgroundColor: 'transparent',
    color: '#d1d5db',
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
};

export default MultiClipEditor;
