import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary, getLyrics,
  addToVideoTextBank, removeFromVideoTextBank, updateVideoTextBank,
  addToLibraryAsync, MEDIA_TYPES
} from '../../services/libraryService';
import { useToast } from '../ui';
import useIsMobile from '../../hooks/useIsMobile';
import AudioClipSelector from './AudioClipSelector';
import LyricBank from './LyricBank';
import LyricAnalyzer from './LyricAnalyzer';

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
  onDeleteLyrics
}) => {
  const { success: toastSuccess, error: toastError } = useToast();

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
        isTemplate: true
      }];
    }
    const firstClip = category?.videos?.[0] || null;
    return [{
      id: 'template',
      name: 'Template',
      clip: firstClip,
      textOverlays: [],
      isTemplate: true
    }];
  });
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [generateCount, setGenerateCount] = useState(
    Math.min(10, Math.max(1, (category?.videos?.length || 1) - 1))
  );
  const [isGenerating, setIsGenerating] = useState(false);

  // Derived reads from active video
  const activeVideo = allVideos[activeVideoIndex];
  const clip = activeVideo?.clip;
  const textOverlays = activeVideo?.textOverlays || [];

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

  const setClip = useCallback((newClip) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const current = copy[activeVideoIndex];
      if (!current) return prev;
      copy[activeVideoIndex] = { ...current, clip: newClip };
      return copy;
    });
  }, [activeVideoIndex]);

  // ── Audio state ──
  const [selectedAudio, setSelectedAudio] = useState(existingVideo?.audio || null);
  const audioRef = useRef(null);

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

  // ── Transcriber state ──
  const [showTranscriber, setShowTranscriber] = useState(false);

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

  // Effective timeline duration = max(clip, audio) so audio can extend past video
  const timelineDuration = Math.max(clipDuration || 0, audioDuration || 0) || clipDuration || 1;

  const playbackLoop = useCallback(() => {
    // If audio is longer than video and video ended, track audio time instead
    if (audioRef.current && audioRef.current.src && !audioRef.current.paused && audioRef.current.duration > 0) {
      const videoEnded = videoRef.current ? videoRef.current.ended : true;
      if (videoEnded && audioRef.current.currentTime > (clipDuration || 0)) {
        setCurrentTime(audioRef.current.currentTime);
        animationRef.current = requestAnimationFrame(playbackLoop);
        return;
      }
    }
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
    animationRef.current = requestAnimationFrame(playbackLoop);
  }, [clipDuration]);

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

  const handleSeek = useCallback((time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  }, []);

  // ── Audio selection ──
  const handleAudioSelect = useCallback((audio) => {
    setSelectedAudio(audio);
    if (audioRef.current && audio) {
      const url = audio.localUrl || audio.url;
      audioRef.current.src = url;
      audioRef.current.load();
      // Track audio duration once loaded
      audioRef.current.onloadedmetadata = () => {
        setAudioDuration(audioRef.current.duration || 0);
      };
    } else if (audioRef.current && !audio) {
      audioRef.current.src = '';
      setAudioDuration(0);
    }
    // When library audio is selected, mute source video audio so they don't overlap
    if (videoRef.current) {
      videoRef.current.muted = !!(audio && !audio.isSourceVideo);
    }
  }, []);

  // ── Audio trim save handler ──
  const handleAudioTrimSave = useCallback(async (trimResult) => {
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
        await addToLibraryAsync(db, artistId, savedAudio);
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
    toastSuccess(`Added ${result.words.length} text overlays from transcription`);
    setShowTranscriber(false);
  }, [clipDuration, getDefaultTextStyle, setTextOverlays, toastSuccess, toastError]);

  useEffect(() => {
    if (videoRef.current) {
      // Mute source video when: global mute is on, OR library audio is replacing source
      const hasLibraryAudio = selectedAudio && !selectedAudio.isSourceVideo;
      videoRef.current.muted = isMuted || hasLibraryAudio;
    }
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted, selectedAudio]);

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
          const bank = idx === 0 ? videoTextBank1 : idx === 1 ? videoTextBank2 : combinedBank;
          if (bank.length > 0) {
            newText = bank[i % bank.length];
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
  }, [allVideos, generateCount, category, getVideoTextBanks, toastSuccess, toastError]);

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
      audio: selectedAudio,
      cropMode: aspectRatio,
      duration: clipDuration || 5,
      thumbnail: video.clip.thumbnailUrl || video.clip.thumbnail,
      isTemplate: video.isTemplate,
      status: 'draft',
      createdAt: existingVideo?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onSave(videoData);
    toastSuccess(`Saved "${video.name || 'Solo Clip'}"`);
  }, [allVideos, activeVideoIndex, clipDuration, aspectRatio, selectedAudio, existingVideo, onSave, toastSuccess, toastError]);

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

  // Get clip URL safely
  const getClipUrl = (clipObj) => {
    if (!clipObj) return null;
    const localUrl = clipObj.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    return isBlobUrl ? clipObj.url : (localUrl || clipObj.url || clipObj.src);
  };

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

  // Video text banks for right panel
  const { videoTextBank1, videoTextBank2 } = getVideoTextBanks();

  // ── RENDER ──
  return (
    <div style={{
      ...styles.overlay,
      ...(isMobile ? { padding: 0 } : {})
    }} onClick={(e) => e.target === e.currentTarget && handleCloseRequest()}>
      <div style={{
        ...styles.modal,
        ...(isMobile ? {
          borderRadius: 0,
          maxWidth: '100%',
          height: '100vh',
          width: '100vw',
          border: 'none'
        } : {})
      }}>

        {/* ── Header ── */}
        <div style={{
          ...styles.header,
          ...(isMobile ? { padding: '8px 10px', gap: '6px' } : {})
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '12px', minWidth: 0 }}>
            <button onClick={handleCloseRequest} style={{
              ...styles.backButton,
              ...(isMobile ? { minWidth: '44px', minHeight: '44px', justifyContent: 'center' } : {})
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <div style={{ minWidth: 0 }}>
              <h2 style={{
                ...styles.headerTitle,
                ...(isMobile ? { fontSize: '13px' } : {})
              }}>Solo Clip Editor</h2>
              {!isMobile && (
                <span style={styles.headerSubtitle}>
                  {allVideos.length === 1 ? 'Design your template' : `${allVideos.length} videos (1 template + ${allVideos.length - 1} generated)`}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: isMobile ? '4px' : '8px', alignItems: 'center', flexShrink: 0 }}>
            {/* Aspect ratio toggles — hide on mobile */}
            {!isMobile && ['9:16', '1:1', '4:3'].map(ratio => (
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
            {!isMobile && (
              <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
            )}
            {/* Save Draft */}
            <button onClick={handleSaveDraft} style={{
              ...styles.saveDraftButton,
              ...(isMobile ? { minWidth: '44px', minHeight: '44px', padding: '6px 10px', fontSize: '11px' } : {})
            }}>
              {isMobile ? 'Save' : 'Save Draft'}
            </button>
            {/* Save All */}
            {allVideos.length > 1 && (
              <button onClick={handleSaveAllAndClose} style={{
                ...styles.saveAllButton,
                ...(isMobile ? { minWidth: '44px', minHeight: '44px', padding: '6px 10px', fontSize: '11px' } : {})
              }}>
                {isMobile ? `All (${allVideos.length})` : `Save All (${allVideos.length})`}
              </button>
            )}
            {/* Close */}
            <button onClick={handleCloseRequest} style={{
              ...styles.closeButton,
              ...(isMobile ? { minWidth: '44px', minHeight: '44px', justifyContent: 'center' } : {})
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

          {/* ── LEFT PANEL: Clips + Generation (desktop only) ── */}
          {!isMobile && (
          <div style={styles.leftPanel}>
            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '8px' }}>Clips</div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
                Click to set as template clip
              </div>
              <div style={styles.clipGrid}>
                {(category?.videos || []).map((v) => {
                  const isActive = clip?.id === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => setClip(v)}
                      style={{
                        ...styles.clipThumb,
                        ...(isActive ? styles.clipThumbActive : {})
                      }}
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
                      {isActive && (
                        <div style={styles.clipThumbBadge}>Template</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Generation controls */}
              <div style={styles.generateSection}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '6px' }}>Generate Videos</div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
                  {(category?.videos || []).length - 1} other clip{(category?.videos || []).length - 1 !== 1 ? 's' : ''} available
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
                    disabled={isGenerating || textOverlays.length === 0}
                    style={{
                      ...styles.generateButton,
                      ...(isGenerating || textOverlays.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {})
                    }}
                  >
                    {isGenerating ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* ── CENTER: Video Preview ── */}
          <div style={{
            ...styles.previewArea,
            ...(isMobile ? { padding: '8px', flexShrink: 0 } : {})
          }}>
            <div
              ref={previewRef}
              style={{
                ...styles.previewContainer,
                width: previewDims.width,
                height: previewDims.height
              }}
              onClick={() => setEditingTextId(null)}
            >
              {clip ? (
                <video
                  ref={videoRef}
                  src={getClipUrl(clip)}
                  onLoadedMetadata={handleVideoLoaded}
                  onEnded={() => {
                    // If audio is still playing (longer than video), keep the playback loop going
                    if (audioRef.current && audioRef.current.src && !audioRef.current.paused && audioRef.current.duration > clipDuration) {
                      // Video ended but audio continues — playbackLoop will switch to audio time
                      return;
                    }
                    setIsPlaying(false);
                    if (animationRef.current) cancelAnimationFrame(animationRef.current);
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
                <div style={styles.previewPlaceholder}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M10 9l5 3-5 3V9z" />
                  </svg>
                  <p style={{ color: '#6b7280', marginTop: 8, fontSize: 12 }}>No clip selected</p>
                </div>
              )}

              {/* Text Overlays on video */}
              {textOverlays.map((overlay) => {
                const style = overlay.style || {};
                const pos = overlay.position || { x: 50, y: 50 };
                // Only show overlay during its time range
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
            <div style={{
              ...styles.playbackControls,
              ...(isMobile ? { maxWidth: '100%' } : {})
            }}>
              <button onClick={handlePlayPause} style={{
                ...styles.playButton,
                ...(isMobile ? { minWidth: '44px', minHeight: '44px', width: '44px', height: '44px' } : {})
              }}>
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
                  handleSeek(percent * clipDuration);
                }}
              >
                <div style={{ ...styles.progressFill, width: `${clipDuration > 0 ? (currentTime / clipDuration) * 100 : 0}%` }} />
              </div>

              <span style={styles.timeDisplay}>
                {formatTime(currentTime)} / {formatTime(clipDuration)}
              </span>

              <button onClick={() => setIsMuted(!isMuted)} style={{
                ...styles.muteButton,
                ...(isMobile ? { minWidth: '44px', minHeight: '44px', justifyContent: 'center' } : {})
              }}>
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

          {/* ── MOBILE TOOL TOOLBAR ── */}
          {isMobile && (
            <div style={styles.mobileToolbar}>
              {[
                { id: 'clips', label: 'Clips', icon: '\uD83C\uDFAC' },
                { id: 'text', label: 'Text', icon: '\uD83D\uDCDD' },
                { id: 'audio', label: 'Audio', icon: '\uD83C\uDFB5' },
                { id: 'banks', label: 'Banks', icon: '\uD83D\uDCE6' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setMobileToolTab(mobileToolTab === tab.id ? null : tab.id)}
                  style={{
                    ...styles.mobileToolbarTab,
                    ...(mobileToolTab === tab.id ? styles.mobileToolbarTabActive : {})
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{tab.icon}</span>
                  <span style={{ fontSize: '10px' }}>{tab.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* ── MOBILE TOOL PANEL (shown when a tool tab is active) ── */}
          {isMobile && mobileToolTab && (
            <div style={styles.mobileToolPanel}>
              {/* Clips tab */}
              {mobileToolTab === 'clips' && (
                <div style={{ padding: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '8px' }}>Clips</div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
                    Tap to set as template clip
                  </div>
                  <div style={{ ...styles.clipGrid, gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    {(category?.videos || []).map((v) => {
                      const isActive = clip?.id === v.id;
                      return (
                        <div
                          key={v.id}
                          onClick={() => setClip(v)}
                          style={{
                            ...styles.clipThumb,
                            ...(isActive ? styles.clipThumbActive : {}),
                            minHeight: '44px'
                          }}
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
                          {isActive && (
                            <div style={styles.clipThumbBadge}>Template</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Aspect ratio on mobile — moved here from header */}
                  <div style={{ marginTop: '12px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '6px' }}>Aspect Ratio</div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {['9:16', '1:1', '4:3'].map(ratio => (
                        <button
                          key={ratio}
                          onClick={() => setAspectRatio(ratio)}
                          style={{
                            ...styles.ratioButton,
                            ...(aspectRatio === ratio ? styles.ratioButtonActive : {}),
                            minWidth: '44px',
                            minHeight: '44px'
                          }}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Generation controls */}
                  <div style={styles.generateSection}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '6px' }}>Generate Videos</div>
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
                      {(category?.videos || []).length - 1} other clip{(category?.videos || []).length - 1 !== 1 ? 's' : ''} available
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#d1d5db' }}>Count:</span>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, (category?.videos?.length || 1) - 1)}
                        value={generateCount}
                        onChange={(e) => setGenerateCount(Math.max(1, Math.min((category?.videos?.length || 1) - 1, parseInt(e.target.value) || 1)))}
                        style={{ ...styles.generateInput, minHeight: '44px' }}
                      />
                      <button
                        onClick={executeGeneration}
                        disabled={isGenerating || textOverlays.length === 0}
                        style={{
                          ...styles.generateButton,
                          minHeight: '44px',
                          ...(isGenerating || textOverlays.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {})
                        }}
                      >
                        {isGenerating ? 'Generating...' : 'Generate'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Text tab */}
              {mobileToolTab === 'text' && (
                <div style={{ padding: '0 0 12px 0' }}>
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>
                            Overlay {idx + 1}
                            {overlay.startTime !== undefined && (
                              <span style={{ marginLeft: '6px', fontSize: '9px', color: '#6b7280' }}>
                                {overlay.startTime.toFixed(1)}s - {overlay.endTime.toFixed(1)}s
                              </span>
                            )}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }}
                            style={{ ...styles.removeOverlayButton, minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >x</button>
                        </div>
                        {isSelected ? (
                          <input
                            value={editingTextValue}
                            onChange={(e) => setEditingTextValue(e.target.value)}
                            onBlur={() => updateTextOverlay(overlay.id, { text: editingTextValue })}
                            onKeyDown={(e) => { if (e.key === 'Enter') { updateTextOverlay(overlay.id, { text: editingTextValue }); e.target.blur(); } }}
                            style={{ ...styles.textEditInput, minHeight: '44px' }}
                            autoFocus
                          />
                        ) : (
                          <div style={{ fontSize: '13px', color: '#e5e7eb' }}>{overlay.text}</div>
                        )}
                        {isSelected && (
                          <div style={styles.styleControls}>
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
                            <div style={styles.controlRow}>
                              <span style={styles.controlLabel}>Size</span>
                              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <button
                                  style={{ ...styles.sizeButton, minWidth: '44px', minHeight: '44px' }}
                                  onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.max(16, overlay.style.fontSize - 4) } }); }}
                                >A-</button>
                                <span style={{ fontSize: '11px', color: '#d1d5db', minWidth: '26px', textAlign: 'center' }}>{overlay.style.fontSize}</span>
                                <button
                                  style={{ ...styles.sizeButton, minWidth: '44px', minHeight: '44px' }}
                                  onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, fontSize: Math.min(120, overlay.style.fontSize + 4) } }); }}
                                >A+</button>
                              </div>
                            </div>
                            <div style={styles.controlRow}>
                              <span style={styles.controlLabel}>Color</span>
                              <input
                                type="color"
                                value={overlay.style.color}
                                onChange={(e) => updateTextOverlay(overlay.id, { style: { ...overlay.style, color: e.target.value } })}
                                style={{ ...styles.colorInput, minWidth: '44px', minHeight: '44px' }}
                              />
                              <span style={{ ...styles.controlLabel, marginLeft: '8px' }}>Outline</span>
                              <button
                                style={{
                                  ...styles.toggleButton,
                                  ...(overlay.style.outline ? styles.toggleButtonActive : {}),
                                  minWidth: '44px',
                                  minHeight: '44px'
                                }}
                                onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, outline: !overlay.style.outline } }); }}
                              >{overlay.style.outline ? 'On' : 'Off'}</button>
                            </div>
                            <div style={styles.controlRow}>
                              <span style={styles.controlLabel}>Align</span>
                              <div style={{ display: 'flex', gap: '3px' }}>
                                {['left', 'center', 'right'].map(align => (
                                  <button
                                    key={align}
                                    style={{
                                      ...styles.toggleButton,
                                      ...(overlay.style.textAlign === align ? styles.toggleButtonActive : {}),
                                      minWidth: '44px',
                                      minHeight: '44px'
                                    }}
                                    onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, textAlign: align } }); }}
                                  >
                                    {align.charAt(0).toUpperCase() + align.slice(1)}
                                  </button>
                                ))}
                              </div>
                            </div>
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
                                      ...(overlay.style.textCase === opt.id ? styles.toggleButtonActive : {}),
                                      minWidth: '44px',
                                      minHeight: '44px'
                                    }}
                                    onClick={(e) => { e.stopPropagation(); updateTextOverlay(overlay.id, { style: { ...overlay.style, textCase: opt.id } }); }}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <button onClick={() => addTextOverlay()} style={{ ...styles.addTextButton, minHeight: '44px' }}>
                    + Add Text Overlay
                  </button>
                </div>
              )}

              {/* Audio tab */}
              {mobileToolTab === 'audio' && (
                <div style={{ padding: '0 0 12px 0' }}>
                  <div style={styles.sectionHeader}>
                    <span>Audio</span>
                  </div>
                  <div style={styles.audioSection}>
                    {selectedAudio && (
                      <div style={styles.audioNowPlaying}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {selectedAudio.isSourceVideo ? 'Source Video Audio' : (selectedAudio.name || selectedAudio.fileName || 'Audio Track')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          {!selectedAudio.isSourceVideo && (
                            <button
                              onClick={() => setShowAudioTrimmer(true)}
                              style={{ background: 'none', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: '10px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', minWidth: '44px', minHeight: '44px' }}
                            >Trim</button>
                          )}
                          <button
                            onClick={() => setShowTranscriber(true)}
                            style={{ background: 'none', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7', fontSize: '10px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', minWidth: '44px', minHeight: '44px' }}
                          >AI</button>
                          <button
                            onClick={() => handleAudioSelect(null)}
                            style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '14px', cursor: 'pointer', padding: '0 2px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >x</button>
                        </div>
                      </div>
                    )}
                    {clip && (
                      <button
                        onClick={() => {
                          const clipUrl = clip.localUrl || clip.url || clip.src;
                          handleAudioSelect({ id: 'source_video', name: 'Source Video Audio', url: clipUrl, localUrl: clipUrl, isSourceVideo: true });
                        }}
                        style={{
                          ...styles.audioTrackButton,
                          ...(selectedAudio?.isSourceVideo ? styles.audioTrackButtonActive : {}),
                          minHeight: '44px'
                        }}
                      >
                        <span style={{ fontSize: '13px' }}>{'\uD83C\uDFA4'}</span>
                        <span style={{ flex: 1, textAlign: 'left' }}>Source Video Audio</span>
                      </button>
                    )}
                    {libraryAudio.length > 0 && (
                      <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {libraryAudio.map(audio => {
                          const isSelected = selectedAudio && !selectedAudio.isSourceVideo && selectedAudio.id === audio.id;
                          return (
                            <button
                              key={audio.id}
                              onClick={() => handleAudioSelect(audio)}
                              style={{
                                ...styles.audioTrackButton,
                                ...(isSelected ? styles.audioTrackButtonActive : {}),
                                minHeight: '44px'
                              }}
                            >
                              <span style={{ fontSize: '13px' }}>{'\uD83C\uDFB5'}</span>
                              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {audio.name || audio.fileName || 'Untitled'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {!clip && libraryAudio.length === 0 && (
                      <div style={{ fontSize: '11px', color: '#4b5563', padding: '8px 0', textAlign: 'center' }}>
                        No audio available. Add audio to your library to use here.
                      </div>
                    )}
                  </div>

                  {/* Lyrics in Audio tab on mobile */}
                  <div style={styles.divider} />
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
                </div>
              )}

              {/* Banks tab */}
              {mobileToolTab === 'banks' && (
                <div style={{ padding: '0 0 12px 0' }}>
                  <div style={styles.sectionHeader}>
                    <span>Video Text Banks</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#6b7280', padding: '0 12px 8px', lineHeight: '1.4' }}>
                    Tap any bank text to add it as an overlay.
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
                        style={{ ...styles.textBankInput, minHeight: '44px' }}
                      />
                      <button
                        onClick={() => { if (newTextA.trim()) { handleAddToVideoTextBank(1, newTextA); setNewTextA(''); } }}
                        style={{ ...styles.textBankAddButton, minWidth: '44px', minHeight: '44px' }}
                      >+</button>
                    </div>
                    <div style={styles.textBankList}>
                      {videoTextBank1.map((text, i) => (
                        <div key={i} style={{ ...styles.textBankTag, minHeight: '44px', display: 'flex', alignItems: 'center' }}>
                          <span
                            onClick={() => addTextOverlay(text)}
                            style={{ cursor: 'pointer' }}
                            title="Tap to add as overlay"
                          >{text}</span>
                          <button
                            onClick={() => handleRemoveFromVideoTextBank(1, i)}
                            style={{ ...styles.textBankRemove, minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >x</button>
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
                        style={{ ...styles.textBankInput, minHeight: '44px' }}
                      />
                      <button
                        onClick={() => { if (newTextB.trim()) { handleAddToVideoTextBank(2, newTextB); setNewTextB(''); } }}
                        style={{ ...styles.textBankAddButton, backgroundColor: '#f59e0b', minWidth: '44px', minHeight: '44px' }}
                      >+</button>
                    </div>
                    <div style={styles.textBankList}>
                      {videoTextBank2.map((text, i) => (
                        <div key={i} style={{ ...styles.textBankTag, borderColor: 'rgba(245,158,11,0.3)', minHeight: '44px', display: 'flex', alignItems: 'center' }}>
                          <span
                            onClick={() => addTextOverlay(text)}
                            style={{ cursor: 'pointer' }}
                            title="Tap to add as overlay"
                          >{text}</span>
                          <button
                            onClick={() => handleRemoveFromVideoTextBank(2, i)}
                            style={{ ...styles.textBankRemove, minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >x</button>
                        </div>
                      ))}
                      {videoTextBank2.length === 0 && <span style={{ fontSize: '11px', color: '#4b5563' }}>Empty</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── RIGHT PANEL: Text Overlays + Style + Video Text Banks (desktop only) ── */}
          {!isMobile && (
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
                      <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>
                        Overlay {idx + 1}
                        {overlay.startTime !== undefined && (
                          <span style={{ marginLeft: '6px', fontSize: '9px', color: '#6b7280' }}>
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
                        onClick={() => setShowTranscriber(true)}
                        style={{ background: 'none', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7', fontSize: '10px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px' }}
                      >AI</button>
                      <button
                        onClick={() => handleAudioSelect(null)}
                        style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '14px', cursor: 'pointer', padding: '0 2px' }}
                      >×</button>
                    </div>
                  </div>
                )}

                {/* Source Video Audio button */}
                {clip && (
                  <button
                    onClick={() => {
                      const clipUrl = clip.localUrl || clip.url || clip.src;
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
                {!clip && libraryAudio.length === 0 && (
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
          )}
        </div>

        {/* ── Timeline Section ── */}
        <div style={styles.timelineSection}>
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
                  <div style={{ width: '1px', height: i % 5 === 0 ? '10px' : '6px', backgroundColor: 'rgba(255,255,255,0.15)' }} />
                  {i % 2 === 0 && <span style={{ fontSize: '9px', color: '#6b7280', position: 'absolute', top: '10px', transform: 'translateX(-50%)' }}>{i}s</span>}
                </div>
              ))}
            </div>

            {/* Text Overlay Track */}
            <div style={styles.textTrack} data-timeline-clickable="true">
              {textOverlays.map((overlay) => {
                const startPct = timelineDuration > 0 ? (overlay.startTime / timelineDuration) * 100 : 0;
                const widthPct = timelineDuration > 0 ? ((overlay.endTime - overlay.startTime) / timelineDuration) * 100 : 10;
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
                      backgroundColor: isSelected ? '#9333ea' : '#7c3aed',
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

            {/* Clip Track */}
            <div style={styles.clipTrack}>
              <div style={{
                position: 'absolute', left: 0, top: '2px', right: 0, height: '40px',
                backgroundColor: '#334155', borderRadius: '4px', overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.08)'
              }}>
                {clip && (clip.thumbnailUrl || clip.thumbnail) && (
                  <img
                    src={clip.thumbnailUrl || clip.thumbnail}
                    alt=""
                    style={{ width: '60px', height: '100%', objectFit: 'cover', opacity: 0.6 }}
                  />
                )}
                <span style={{ position: 'absolute', left: '68px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: '#9ca3af' }}>
                  {clip ? 'Clip' : 'No clip'}
                </span>
              </div>
            </div>

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
    overflow: 'auto'
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
  clipThumbActive: {
    borderColor: '#6366f1'
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
  clipThumbBadge: {
    position: 'absolute',
    bottom: '2px',
    left: '2px',
    right: '2px',
    padding: '2px 0',
    backgroundColor: 'rgba(99,102,241,0.85)',
    color: '#fff',
    fontSize: '8px',
    fontWeight: '600',
    textAlign: 'center',
    borderRadius: '0 0 4px 4px'
  },
  generateSection: {
    padding: '12px',
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderRadius: '8px',
    border: '1px solid rgba(99,102,241,0.15)'
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

  // ── Timeline ──
  timelineSection: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
    backgroundColor: '#0f0f23',
    padding: '0 8px'
  },
  timelineTrackArea: {
    position: 'relative',
    height: '110px',
    cursor: 'pointer'
  },
  timelineRuler: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '22px',
    borderBottom: '1px solid rgba(255,255,255,0.06)'
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
  },

  // ── Mobile Tool Toolbar ──
  mobileToolbar: {
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    backgroundColor: '#0f0f23',
    flexShrink: 0,
    padding: '4px 0'
  },
  mobileToolbarTab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    minWidth: '44px',
    minHeight: '44px',
    padding: '6px 12px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  mobileToolbarTabActive: {
    backgroundColor: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc'
  },
  mobileToolPanel: {
    flex: 1,
    overflow: 'auto',
    backgroundColor: '#1a1a2e',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    minHeight: 0
  }
};

export default SoloClipEditor;
