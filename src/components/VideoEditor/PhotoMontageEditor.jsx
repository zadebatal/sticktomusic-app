import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary, getLyrics,
  incrementUseCount, MEDIA_TYPES, addToLibraryAsync,
  addCreatedVideo, saveCreatedContentAsync
} from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';
import { renderPhotoMontage } from '../../services/photoMontageExportService';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import AudioClipSelector from './AudioClipSelector';
import EditorToolbar from './EditorToolbar';
import LyricBank from './LyricBank';
import WordTimeline from './WordTimeline';
import LyricAnalyzer from './LyricAnalyzer';
import CloudImportButton from './CloudImportButton';
import log from '../../utils/logger';

/**
 * PhotoMontageEditor — Turn photos into a fast-paced video with transitions.
 *
 * Full feature parity with SoloClipEditor:
 *   EditorToolbar (undo/redo, audio picker, lyrics picker, AI transcribe),
 *   close confirmation, waveform, word overlays from transcription.
 *
 * Layout:
 *   Top bar:   Back, Name, Aspect, Export
 *   Body:      Left (w-72) Photo list | Center Preview | Right (w-64) Settings
 *   Toolbar:   EditorToolbar (shared)
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
  onSavePreset
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const { isMobile } = useIsMobile();
  const styles = useMemo(() => getStyles(theme, isMobile), [theme, isMobile]);

  // ── Photo list state ──
  const [photos, setPhotos] = useState(() => {
    if (existingVideo?.editorMode === 'photo-montage' && existingVideo?.montagePhotos) {
      return existingVideo.montagePhotos;
    }
    return [];
  });
  const [name, setName] = useState(existingVideo?.name || 'Photo Montage');

  // ── Settings state ──
  const [speed, setSpeed] = useState(existingVideo?.montageSpeed || 1);
  const [transition, setTransition] = useState(existingVideo?.montageTransition || 'cut');
  const [kenBurnsEnabled, setKenBurnsEnabled] = useState(existingVideo?.montageKenBurns !== false);
  const [aspectRatio, setAspectRatio] = useState(existingVideo?.cropMode || '9:16');

  // ── Audio state (renamed from `audio` to match VEM/SoloClipEditor pattern) ──
  const [selectedAudio, setSelectedAudio] = useState(existingVideo?.audio || null);
  const [beatSyncEnabled, setBeatSyncEnabled] = useState(existingVideo?.montageBeatSync || false);
  const audioRef = useRef(null);
  const audioFileInputRef = useRef(null);

  // ── Text overlay state (same pattern as SoloClipEditor) ──
  const [textOverlays, setTextOverlays] = useState(existingVideo?.textOverlays || []);
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [draggingTextId, setDraggingTextId] = useState(null);
  const dragStartRef = useRef(null);
  const previewRef = useRef(null);
  const timelineRef = useRef(null);
  const [timelineDrag, setTimelineDrag] = useState(null);
  const [textStyle, setTextStyle] = useState({
    fontSize: 48,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    color: '#ffffff',
    outline: true,
    outlineColor: '#000000',
    textAlign: 'center',
    textCase: 'default'
  });

  // ── Words state (for WordTimeline) ──
  const [words, setWords] = useState(existingVideo?.words || []);
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [loadedBankLyricId, setLoadedBankLyricId] = useState(null);

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

  // ── Preset state ──
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [showPresetPrompt, setShowPresetPrompt] = useState(false);
  const [presetPromptValue, setPresetPromptValue] = useState('');

  // ── Audio trimmer state ──
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);

  // ── Audio volume state ──
  const [externalAudioVolume, setExternalAudioVolume] = useState(1.0);

  // ── Drag reorder ──
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // ── Undo/Redo history ──
  const getHistorySnapshot = useCallback(() => ({
    photos, textOverlays, selectedAudio, textStyle, words
  }), [photos, textOverlays, selectedAudio, textStyle, words]);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    if (snapshot.photos !== undefined) setPhotos(snapshot.photos);
    if (snapshot.textOverlays !== undefined) setTextOverlays(snapshot.textOverlays);
    if (snapshot.selectedAudio !== undefined) setSelectedAudio(snapshot.selectedAudio);
    if (snapshot.textStyle !== undefined) setTextStyle(snapshot.textStyle);
    if (snapshot.words !== undefined) setWords(snapshot.words);
  }, []);

  const { canUndo, canRedo, handleUndo, handleRedo } = useEditorHistory({
    getSnapshot: getHistorySnapshot,
    restoreSnapshot: restoreHistorySnapshot,
    deps: [photos, textOverlays, selectedAudio, textStyle, words],
    isEditingText: !!editingTextId
  });

  // ── Waveform (for future timeline rendering) ──
  const { waveformData } = useWaveform({
    selectedAudio,
    clips: [],
    getClipUrl: () => null
  });

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
    return () => unsubs.forEach(u => u());
  }, [db, artistId]);

  const libraryImages = useMemo(() =>
    library.filter(m => m.type === MEDIA_TYPES.IMAGE && m.url && !m.url.startsWith('blob:')),
    [library]
  );

  const libraryAudio = useMemo(() =>
    library.filter(m => m.type === MEDIA_TYPES.AUDIO),
    [library]
  );

  // ── Computed: photo durations (beat-synced or fixed) ──
  const photoDurations = useMemo(() => {
    if (beatSyncEnabled && beats.length > 1 && photos.length > 0) {
      const durations = [];
      const beatsPerPhoto = Math.max(1, Math.floor(beats.length / photos.length));
      for (let i = 0; i < photos.length; i++) {
        const beatStart = i * beatsPerPhoto;
        const beatEnd = Math.min((i + 1) * beatsPerPhoto, beats.length - 1);
        if (beatStart < beats.length && beatEnd < beats.length) {
          durations.push(beats[beatEnd] - beats[beatStart]);
        } else {
          durations.push(speed);
        }
      }
      return durations;
    }
    return photos.map(p => p.customDuration || speed);
  }, [photos, speed, beatSyncEnabled, beats]);

  const totalDuration = useMemo(() =>
    photoDurations.reduce((sum, d) => sum + d, 0),
    [photoDurations]
  );

  // ── Beat sync: analyze audio when toggled on ──
  useEffect(() => {
    if (beatSyncEnabled && selectedAudio?.url && !bpm) {
      analyzeAudio(selectedAudio.url);
    }
  }, [beatSyncEnabled, selectedAudio?.url, bpm, analyzeAudio]);

  // ── Preview playback loop ──
  const startPlayback = useCallback(() => {
    if (photos.length === 0) return;
    setIsPlaying(true);
    lastFrameTimeRef.current = performance.now();

    const tick = (now) => {
      const delta = (now - (lastFrameTimeRef.current || now)) / 1000;
      lastFrameTimeRef.current = now;

      setCurrentTime(prev => {
        const next = prev + delta;
        if (next >= totalDuration) return 0;
        return next;
      });

      playbackRef.current = requestAnimationFrame(tick);
    };
    playbackRef.current = requestAnimationFrame(tick);

    if (audioRef.current && selectedAudio?.url) {
      audioRef.current.currentTime = selectedAudio.startTime || 0;
      audioRef.current.play().catch(() => {});
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

  const handleSeek = useCallback((time) => {
    setCurrentTime(Math.max(0, Math.min(time, totalDuration || 0)));
    if (audioRef.current && selectedAudio?.url) {
      audioRef.current.currentTime = (selectedAudio.startTime || 0) + time;
    }
  }, [totalDuration, selectedAudio]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
  }, []);

  // ── Current photo index for preview ──
  const currentPhotoIndex = useMemo(() => {
    let elapsed = 0;
    for (let i = 0; i < photoDurations.length; i++) {
      elapsed += photoDurations[i];
      if (currentTime < elapsed) return i;
    }
    return Math.max(0, photos.length - 1);
  }, [currentTime, photoDurations, photos.length]);

  const currentPhotoProgress = useMemo(() => {
    let elapsed = 0;
    for (let i = 0; i < photoDurations.length; i++) {
      if (i === currentPhotoIndex) {
        return (currentTime - elapsed) / photoDurations[i];
      }
      elapsed += photoDurations[i];
    }
    return 0;
  }, [currentTime, currentPhotoIndex, photoDurations]);

  // ── Photo management ──
  const addPhotosFromFiles = useCallback(async (files) => {
    const newPhotos = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const localUrl = URL.createObjectURL(file);
      newPhotos.push({
        id: `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        url: localUrl,
        file,
        name: file.name,
        isLocal: true
      });
    }
    if (newPhotos.length > 0) {
      setPhotos(prev => [...prev, ...newPhotos]);
      toastSuccess(`Added ${newPhotos.length} photo${newPhotos.length !== 1 ? 's' : ''}`);
    }
  }, [toastSuccess]);

  const addPhotosFromLibrary = useCallback((mediaItems) => {
    const newPhotos = mediaItems.map(item => ({
      id: item.id,
      url: item.url,
      name: item.name,
      libraryId: item.id,
      isLocal: false
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
    setShowLibraryPicker(false);
    toastSuccess(`Added ${newPhotos.length} photo${newPhotos.length !== 1 ? 's' : ''}`);
  }, [toastSuccess]);

  const removePhoto = useCallback((index) => {
    setPhotos(prev => {
      const photo = prev[index];
      if (photo?.isLocal && photo.url?.startsWith('blob:')) {
        URL.revokeObjectURL(photo.url);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const movePhoto = useCallback((fromIndex, toIndex) => {
    setPhotos(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  // ── Drag handlers ──
  const handleDragStart = useCallback((index) => setDragIndex(index), []);
  const handleDragOver = useCallback((e, index) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);
  const handleDrop = useCallback((index) => {
    if (dragIndex !== null && dragIndex !== index) {
      movePhoto(dragIndex, index);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, movePhoto]);

  // ── Text overlay CRUD (matches SoloClipEditor) ──
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

  const addTextOverlay = useCallback((prefillText, overrideStart, overrideEnd) => {
    const start = overrideStart !== undefined ? overrideStart : currentTime;
    const end = overrideEnd !== undefined ? overrideEnd : Math.min(start + 3, totalDuration || start + 3);
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
  }, [getDefaultTextStyle, currentTime, totalDuration]);

  const updateTextOverlay = useCallback((overlayId, updates) => {
    setTextOverlays(prev => prev.map(o =>
      o.id === overlayId ? { ...o, ...updates } : o
    ));
  }, []);

  const removeTextOverlay = useCallback((overlayId) => {
    setTextOverlays(prev => prev.filter(o => o.id !== overlayId));
    if (editingTextId === overlayId) {
      setEditingTextId(null);
      setEditingTextValue('');
    }
  }, [editingTextId]);

  // ── Text overlay dragging on preview ──
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
      const overlay = textOverlays.find(o => o.id === draggingTextId);
      if (overlay) {
        updateTextOverlay(draggingTextId, { position: { ...overlay.position, x: newX, y: newY } });
      }
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
      overlayId, type,
      startX: e.clientX,
      origStart: overlay.startTime,
      origEnd: overlay.endTime
    });
    setEditingTextId(overlayId);
    setEditingTextValue(overlay.text);
  }, [textOverlays]);

  useEffect(() => {
    if (!timelineDrag || !timelineRef.current) return;
    const dur = totalDuration || 1;
    const handleMouseMove = (e) => {
      const rect = timelineRef.current.getBoundingClientRect();
      const deltaX = e.clientX - timelineDrag.startX;
      const deltaSec = (deltaX / rect.width) * dur;
      const minDur = 0.3;

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
  }, [timelineDrag, totalDuration, updateTextOverlay]);

  // ── Preset handler ──
  const handleApplyPreset = useCallback((preset) => {
    setSelectedPreset(preset);
    if (preset.settings) {
      setTextStyle(prev => ({ ...prev, ...preset.settings }));
      if (preset.settings.cropMode) setAspectRatio(preset.settings.cropMode);
    }
  }, []);

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
  const handleAudioTrimSave = useCallback(({ startTime, endTime, trimmedFile, trimmedName }) => {
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
        isTrimmed: true
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
    toastSuccess(`Saved clip "${clipData.name}" to library`);
  }, [selectedAudio, artistId, db, toastSuccess]);

  // ── Audio element config ──
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!selectedAudio) {
      el.src = '';
      return;
    }
    const url = selectedAudio.localUrl || selectedAudio.url;
    if (!url) return;
    el.src = url;
    el.load();
  }, [selectedAudio]);

  // ── Sync audio volume ──
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = externalAudioVolume;
    }
  }, [externalAudioVolume]);

  // ── AI Transcription handler — creates text overlays (matches SoloClipEditor) ──
  const handleTranscriptionComplete = useCallback((result) => {
    if (!result?.words?.length) {
      toastError('No words detected in transcription.');
      setShowTranscriber(false);
      return;
    }
    const dur = totalDuration || 30;
    const newOverlays = result.words.map((w, i) => {
      const start = Math.min(w.startTime || 0, dur);
      const end = Math.min(start + (w.duration || 0.5), dur);
      return {
        id: `text_${Date.now()}_${i}`,
        text: w.text,
        style: getDefaultTextStyle(),
        position: { x: 50, y: 50, width: 80, height: 20 },
        startTime: start,
        endTime: end
      };
    });
    setTextOverlays(newOverlays);
    // Also set words for WordTimeline
    setWords(result.words.map((w, i) => ({
      id: `word_${Date.now()}_${i}`,
      text: w.text,
      startTime: Math.min(w.startTime || 0, dur),
      duration: w.duration || 0.5
    })));
    toastSuccess(`Added ${newOverlays.length} text overlays from transcription`);
    setShowTranscriber(false);
  }, [totalDuration, getDefaultTextStyle, toastSuccess, toastError]);

  // ── Lyrics as timed text overlays ──
  const addLyricsAsTimedOverlays = useCallback((lyricsText) => {
    const wordList = lyricsText.split(/\s+/).filter(w => w.trim().length > 0);
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
      endTime: (i + 1) * wordDuration
    }));
    setTextOverlays(newOverlays);
    toastSuccess(`Created ${newOverlays.length} timed word overlays`);
  }, [totalDuration, getDefaultTextStyle, toastSuccess]);

  // ── Close with confirmation (fixes back button bug) ──
  const handleCloseRequest = useCallback(() => {
    const hasWork = photos.length > 0 || textOverlays.length > 0 || selectedAudio;
    if (hasWork) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [photos.length, textOverlays.length, selectedAudio, onClose]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e) => {
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
  }, [handleCloseRequest, isPlaying, stopPlayback, startPlayback]);

  // ── Export ──
  const handleExport = useCallback(async () => {
    if (photos.length === 0) { toastError('Add at least one photo'); return; }
    setIsExporting(true);
    setExportProgress(0);
    stopPlayback();

    try {
      const uploadedPhotos = await Promise.all(photos.map(async (photo) => {
        if (photo.isLocal && photo.file) {
          const { url } = await uploadFile(photo.file, 'images');
          return { ...photo, url, isLocal: false };
        }
        return photo;
      }));

      let audioForExport = selectedAudio;
      if (selectedAudio?.file) {
        const { url } = await uploadFile(selectedAudio.file, 'audio');
        audioForExport = { ...selectedAudio, url };
      }

      const photosWithDurations = uploadedPhotos.map((p, i) => ({
        url: p.url,
        duration: photoDurations[i]
      }));

      const blob = await renderPhotoMontage({
        photos: photosWithDurations,
        aspectRatio,
        transition,
        kenBurns: kenBurnsEnabled,
        audio: audioForExport
      }, (progress) => setExportProgress(progress));

      setExportProgress(95);
      const { url: cloudUrl } = await uploadFile(
        new File([blob], `montage_${Date.now()}.mp4`, { type: 'video/mp4' }),
        'videos'
      );

      const videoData = {
        name,
        audio: audioForExport ? { id: audioForExport.id, url: audioForExport.url, name: audioForExport.name } : null,
        clips: [],
        cropMode: aspectRatio,
        duration: totalDuration,
        collectionId: category?.id || null,
        editorMode: 'photo-montage',
        montagePhotos: uploadedPhotos.map(p => ({ id: p.id, url: p.url, name: p.name })),
        montageSpeed: speed,
        montageTransition: transition,
        montageKenBurns: kenBurnsEnabled,
        montageBeatSync: beatSyncEnabled,
        textOverlays,
        textStyle,
        words,
        status: 'ready',
        cloudUrl
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
      console.error('[PhotoMontage] Export failed:', err);
      toastError(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [photos, selectedAudio, photoDurations, aspectRatio, transition, kenBurnsEnabled, name, speed, beatSyncEnabled, totalDuration, artistId, db, category, textOverlays, textStyle, onSave, onClose, toastSuccess, toastError, stopPlayback]);

  // ── Ken Burns CSS animation for preview ──
  const getKenBurnsStyle = useCallback((photoIndex, progress) => {
    if (!kenBurnsEnabled) return {};
    const effects = [
      { transform: `scale(${1 + progress * 0.15})` },
      { transform: `scale(${1.15 - progress * 0.15})` },
      { transform: `scale(1.1) translateX(${(-5 + progress * 10)}%)` },
      { transform: `scale(1.1) translateX(${(5 - progress * 10)}%)` },
      { transform: `scale(1.1) translateY(${(5 - progress * 10)}%)` },
      { transform: `scale(1.1) translateY(${(-5 + progress * 10)}%)` },
    ];
    return effects[photoIndex % effects.length];
  }, [kenBurnsEnabled]);

  const SPEED_PRESETS = [
    { label: '0.5s', value: 0.5 },
    { label: '1s', value: 1 },
    { label: '2s', value: 2 },
    { label: '3s', value: 3 },
  ];

  // ── Render ──
  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && handleCloseRequest()}>
      <div style={styles.container}>
        {/* Top Bar */}
        <div style={styles.topBar}>
          <button onClick={handleCloseRequest} style={styles.backButton} title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.nameInput}
            placeholder="Montage name"
          />

          <div style={styles.aspectGroup}>
            {['9:16', '1:1', '4:5'].map(ratio => (
              <button
                key={ratio}
                onClick={() => setAspectRatio(ratio)}
                style={aspectRatio === ratio ? styles.aspectActive : styles.aspectButton}
              >
                {ratio}
              </button>
            ))}
          </div>

          <button
            onClick={handleExport}
            disabled={isExporting || photos.length === 0}
            style={isExporting ? styles.exportButtonDisabled : styles.exportButton}
          >
            {isExporting ? `Exporting ${exportProgress}%` : 'Export'}
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Left Panel — Photo List */}
          <div style={styles.leftPanel}>
            <div style={styles.panelHeader}>
              <span style={styles.panelTitle}>Photos ({photos.length})</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <label style={styles.uploadButton}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => addPhotosFromFiles(Array.from(e.target.files))}
                    style={{ display: 'none' }}
                  />
                </label>
                {libraryImages.length > 0 && (
                  <button onClick={() => setShowLibraryPicker(!showLibraryPicker)} style={styles.uploadButton} title="Import from library">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Library picker dropdown */}
            {showLibraryPicker && (
              <div style={styles.libraryPicker}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: theme.text.secondary, marginBottom: '8px' }}>
                  Select from library ({libraryImages.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                  {libraryImages.map(img => (
                    <div
                      key={img.id}
                      onClick={() => addPhotosFromLibrary([img])}
                      style={styles.libraryThumb}
                    >
                      <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowLibraryPicker(false)} style={{ ...styles.smallButton, marginTop: '6px', width: '100%' }}>Done</button>
              </div>
            )}

            {/* Photo list */}
            <div style={styles.photoList}>
              {photos.length === 0 ? (
                <div style={styles.emptyPhotos}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={theme.text.muted} strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                  </svg>
                  <span style={{ fontSize: '12px', color: theme.text.muted }}>Upload or import photos</span>
                </div>
              ) : (
                photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                    style={{
                      ...styles.photoItem,
                      opacity: dragIndex === index ? 0.5 : 1,
                      borderColor: dragOverIndex === index ? theme.accent.primary : theme.border.subtle,
                      backgroundColor: currentPhotoIndex === index && isPlaying ? `${theme.accent.primary}15` : 'transparent'
                    }}
                  >
                    <div style={styles.photoThumb}>
                      <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
                    </div>
                    <div style={styles.photoInfo}>
                      <div style={styles.photoName}>{photo.name || `Photo ${index + 1}`}</div>
                      <div style={styles.photoDuration}>
                        {beatSyncEnabled ? `${photoDurations[index]?.toFixed(2)}s (beat)` : `${photoDurations[index]?.toFixed(1)}s`}
                      </div>
                    </div>
                    <button onClick={() => removePhoto(index)} style={styles.removeButton} title="Remove">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Center — Preview */}
          <div style={styles.centerPanel}>
            <div style={styles.previewContainer}>
              {photos.length > 0 ? (
                <div ref={previewRef} style={styles.previewFrame} onClick={() => setEditingTextId(null)}>
                  <img
                    src={photos[currentPhotoIndex]?.url}
                    alt=""
                    style={{
                      ...styles.previewImage,
                      ...getKenBurnsStyle(currentPhotoIndex, currentPhotoProgress),
                      transition: isPlaying ? 'none' : 'transform 0.3s ease'
                    }}
                  />

                  {/* Text overlays on preview */}
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
                          fontSize: `${(style.fontSize || 48) * 0.5}px`,
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

                  {/* Photo counter */}
                  <div style={styles.photoCounter}>
                    {currentPhotoIndex + 1} / {photos.length}
                  </div>
                </div>
              ) : (
                <div style={styles.previewEmpty}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={theme.text.muted} strokeWidth="1">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                  </svg>
                  <span style={{ color: theme.text.muted, fontSize: '14px', marginTop: '12px' }}>Add photos to preview</span>
                </div>
              )}
            </div>

            {/* Playback controls */}
            <div style={styles.playbackControls}>
              <button
                onClick={isPlaying ? stopPlayback : startPlayback}
                disabled={photos.length === 0}
                style={styles.playButton}
              >
                {isPlaying ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
                )}
              </button>

              {/* Scrubber */}
              <div style={styles.scrubberContainer}>
                <input
                  type="range"
                  min={0}
                  max={totalDuration || 1}
                  step={0.01}
                  value={currentTime}
                  onChange={(e) => {
                    stopPlayback();
                    setCurrentTime(parseFloat(e.target.value));
                  }}
                  style={styles.scrubber}
                />
              </div>

              <span style={styles.timeDisplay}>
                {currentTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
              </span>
              {!isMobile && (
                <button style={styles.fullscreenButton} onClick={() => previewRef.current?.requestFullscreen()} title="Fullscreen">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 3 21 3 21 9"/>
                    <polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/>
                    <line x1="3" y1="21" x2="10" y2="14"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Photo filmstrip timeline */}
            {photos.length > 0 && (
              <div style={styles.filmstrip}>
                {photos.map((photo, i) => {
                  const widthPct = totalDuration > 0 ? (photoDurations[i] / totalDuration) * 100 : (100 / photos.length);
                  return (
                    <div
                      key={photo.id}
                      style={{
                        ...styles.filmstripItem,
                        width: `${widthPct}%`,
                        borderColor: currentPhotoIndex === i ? theme.accent.primary : 'transparent'
                      }}
                    >
                      <img src={photo.url} alt="" style={styles.filmstripThumb} />
                    </div>
                  );
                })}
                {/* Playhead */}
                <div style={{
                  ...styles.filmstripPlayhead,
                  left: totalDuration > 0 ? `${(currentTime / totalDuration) * 100}%` : '0%'
                }} />
              </div>
            )}

            {/* Text overlay timeline track */}
            {textOverlays.length > 0 && (
              <div ref={timelineRef} style={styles.textTimelineTrack}>
                {textOverlays.map((overlay) => {
                  const startPct = totalDuration > 0 ? (overlay.startTime / totalDuration) * 100 : 0;
                  const widthPct = totalDuration > 0 ? ((overlay.endTime - overlay.startTime) / totalDuration) * 100 : 10;
                  const isSelected = editingTextId === overlay.id;
                  return (
                    <div
                      key={overlay.id}
                      style={{
                        position: 'absolute',
                        left: `${startPct}%`,
                        width: `${widthPct}%`,
                        top: '2px',
                        height: '20px',
                        backgroundColor: isSelected ? '#9333ea' : theme.accent.primary,
                        borderRadius: '3px',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 3px',
                        cursor: timelineDrag ? 'grabbing' : 'grab',
                        overflow: 'hidden',
                        border: isSelected ? '1px solid #a855f7' : '1px solid rgba(124,58,237,0.5)',
                        zIndex: isSelected ? 10 : 5,
                        transition: timelineDrag ? 'none' : 'background-color 0.15s'
                      }}
                      onMouseDown={(e) => handleTimelineDragStart(e, overlay.id, 'move')}
                    >
                      {/* Left resize handle */}
                      <div
                        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '5px', cursor: 'col-resize', zIndex: 11 }}
                        onMouseDown={(e) => { e.stopPropagation(); handleTimelineDragStart(e, overlay.id, 'left'); }}
                      />
                      <span style={{ fontSize: '9px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', padding: '0 4px' }}>
                        {overlay.text}
                      </span>
                      {/* Right resize handle */}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '5px', cursor: 'col-resize', zIndex: 11 }}
                        onMouseDown={(e) => { e.stopPropagation(); handleTimelineDragStart(e, overlay.id, 'right'); }}
                      />
                    </div>
                  );
                })}
                {/* Playhead on text track */}
                <div style={{
                  ...styles.filmstripPlayhead,
                  left: totalDuration > 0 ? `${(currentTime / totalDuration) * 100}%` : '0%'
                }} />
              </div>
            )}

            {/* Audio waveform track */}
            {waveformData.length > 0 && selectedAudio && (
              <div style={styles.audioTrack}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={externalAudioVolume}
                  onChange={(e) => setExternalAudioVolume(parseFloat(e.target.value))}
                  title={`Volume: ${Math.round(externalAudioVolume * 100)}%`}
                  style={{ width: '40px', accentColor: '#9333ea', flexShrink: 0 }}
                />
                <div style={styles.waveformContainer}>
                  {waveformData.map((val, i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: `${Math.max(2, val * 100)}%`,
                        backgroundColor: (i / waveformData.length) <= (totalDuration > 0 ? currentTime / totalDuration : 0)
                          ? '#9333ea' : 'rgba(147, 51, 234, 0.3)',
                        borderRadius: '1px',
                        minWidth: '1px'
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Selected overlay edit bar */}
            {editingTextId && (() => {
              const overlay = textOverlays.find(o => o.id === editingTextId);
              if (!overlay) return null;
              return (
                <div style={styles.editBar}>
                  <input
                    type="text"
                    value={editingTextValue}
                    onChange={(e) => {
                      setEditingTextValue(e.target.value);
                      updateTextOverlay(editingTextId, { text: e.target.value });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditingTextId(null); }}
                    style={styles.editBarInput}
                    autoFocus
                  />
                  <button
                    onClick={() => removeTextOverlay(editingTextId)}
                    style={styles.editBarDelete}
                    title="Delete overlay"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => setEditingTextId(null)}
                    style={styles.editBarDone}
                  >
                    Done
                  </button>
                </div>
              );
            })()}

            {/* Export progress bar */}
            {isExporting && (
              <div style={styles.exportProgressBar}>
                <div style={{ ...styles.exportProgressFill, width: `${exportProgress}%` }} />
              </div>
            )}
          </div>

          {/* Right Panel — Settings */}
          <div style={styles.rightPanel}>
            {/* Speed */}
            <div style={styles.settingsSection}>
              <div style={styles.settingsLabel}>Speed (per photo)</div>
              <div style={styles.toggleGroup}>
                {SPEED_PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    onClick={() => setSpeed(preset.value)}
                    style={speed === preset.value ? styles.toggleActive : styles.toggleButton}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value) || 1)}
                style={styles.numberInput}
                placeholder="Custom (s)"
              />
            </div>

            {/* Transition */}
            <div style={styles.settingsSection}>
              <div style={styles.settingsLabel}>Transition</div>
              <div style={styles.toggleGroup}>
                {['cut', 'crossfade'].map(t => (
                  <button
                    key={t}
                    onClick={() => setTransition(t)}
                    style={transition === t ? styles.toggleActive : styles.toggleButton}
                  >
                    {t === 'cut' ? 'Cut' : 'Crossfade'}
                  </button>
                ))}
              </div>
            </div>

            {/* Ken Burns */}
            <div style={styles.settingsSection}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={styles.settingsLabel}>Ken Burns</div>
                <button
                  onClick={() => setKenBurnsEnabled(!kenBurnsEnabled)}
                  style={kenBurnsEnabled ? styles.toggleOnButton : styles.toggleOffButton}
                >
                  {kenBurnsEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div style={{ fontSize: '11px', color: theme.text.muted, marginTop: '4px' }}>
                Pan & zoom animation on each photo
              </div>
            </div>

            {/* Audio display (when selected via toolbar) */}
            <div style={styles.settingsSection}>
              <div style={styles.settingsLabel}>Audio</div>
              {selectedAudio ? (
                <div style={styles.audioItem}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.accent.primary} strokeWidth="2">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                  </svg>
                  <span style={{ flex: 1, fontSize: '12px', color: theme.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedAudio.name || 'Audio'}
                  </span>
                  <button onClick={handleRemoveAudio} style={styles.removeButton}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: theme.text.muted }}>
                  Use the Audio button in the toolbar below to add audio
                </div>
              )}
            </div>

            {/* Beat Sync */}
            {selectedAudio && (
              <div style={styles.settingsSection}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={styles.settingsLabel}>Beat Sync</div>
                  <button
                    onClick={() => setBeatSyncEnabled(!beatSyncEnabled)}
                    disabled={beatAnalyzing}
                    style={beatSyncEnabled ? styles.toggleOnButton : styles.toggleOffButton}
                  >
                    {beatAnalyzing ? '...' : beatSyncEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                {bpm && (
                  <div style={{ fontSize: '11px', color: theme.accent.primary, marginTop: '4px' }}>
                    {bpm} BPM detected
                  </div>
                )}
                <div style={{ fontSize: '11px', color: theme.text.muted, marginTop: '2px' }}>
                  Time photo cuts to the beat
                </div>
              </div>
            )}

            {/* Lyrics */}
            <div style={styles.settingsSection}>
              <div style={styles.settingsLabel}>Lyrics</div>
              <LyricBank
                lyrics={category?.lyrics || lyricsBank || []}
                onAddLyrics={onAddLyrics}
                onUpdateLyrics={onUpdateLyrics}
                onDeleteLyrics={onDeleteLyrics}
                onSelectText={(selectedText) => addLyricsAsTimedOverlays(selectedText)}
                compact={true}
                showAddForm={true}
              />
            </div>

            {/* Summary */}
            <div style={{ ...styles.settingsSection, borderTop: `1px solid ${theme.border.subtle}`, paddingTop: '12px', marginTop: '8px' }}>
              <div style={{ fontSize: '11px', color: theme.text.muted }}>
                {photos.length} photo{photos.length !== 1 ? 's' : ''} &middot; {totalDuration.toFixed(1)}s total
                {bpm ? ` \u00b7 ${bpm} BPM` : ''}
                {textOverlays.length > 0 ? ` \u00b7 ${textOverlays.length} texts` : ''}
              </div>
            </div>
          </div>
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
            style={{ ...styles.presetSelect, padding: '4px 8px', fontSize: '11px', flex: '0 1 200px' }}
          >
            <option value="">Choose a preset...</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
          {!isMobile && (
            <button
              style={{ background: 'none', border: 'none', color: theme.text.muted, cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
              onClick={() => { setPresetPromptValue(''); setShowPresetPrompt(true); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              Save preset
            </button>
          )}
        </div>

        {/* EditorToolbar */}
        <EditorToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onAddText={() => addTextOverlay()}
          audioTracks={libraryAudio}
          onSelectAudio={(audio) => {
            setAudioToTrim(audio);
            setShowAudioTrimmer(true);
          }}
          onUploadAudio={() => audioFileInputRef.current?.click()}
          lyrics={lyricsBank}
          onSelectLyric={(lyric) => addLyricsAsTimedOverlays(lyric.content || lyric.title || '')}
          onAddNewLyrics={onAddLyrics ? () => onAddLyrics({ title: 'New Lyrics', content: '' }) : null}
          onAITranscribe={selectedAudio ? () => setShowTranscriber(true) : null}
          onWordTimeline={(words.length > 0 || selectedAudio) ? () => setShowWordTimeline(true) : null}
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
        <audio ref={audioRef} preload="auto" />

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
                onAddLyrics({ title: lyricData.title, content: lyricData.content, words: lyricData.words });
              }
            }}
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

        {/* ── Preset Save Modal ── */}
        {showPresetPrompt && (
          <div style={{ position: 'fixed', inset: 0, background: theme.overlay.heavy, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setShowPresetPrompt(false)}>
            <div style={{ background: theme.bg.input, borderRadius: 12, padding: 24, width: 360, maxWidth: '90vw' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Save Preset</div>
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
                style={{ width: '100%', background: theme.bg.page, border: `1px solid ${theme.bg.elevated}`, borderRadius: 8, padding: '10px 12px', color: theme.text.primary, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button onClick={() => setShowPresetPrompt(false)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${theme.bg.elevated}`, background: 'transparent', color: theme.text.secondary, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={() => {
                  if (presetPromptValue.trim()) {
                    onSavePreset?.({ name: presetPromptValue.trim(), settings: { ...textStyle, cropMode: aspectRatio } });
                    toastSuccess(`Preset "${presetPromptValue.trim()}" saved!`);
                  }
                  setShowPresetPrompt(false);
                }}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: theme.accent.primary, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Styles ──
const getStyles = (theme, isMobile) => ({
  overlay: {
    position: 'fixed', inset: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, padding: isMobile ? '0' : '20px'
  },
  container: {
    backgroundColor: theme.bg.page,
    borderRadius: isMobile ? 0 : '16px',
    border: isMobile ? 'none' : `1px solid ${theme.border.subtle}`,
    display: 'flex', flexDirection: 'column',
    width: '100%', maxWidth: '1400px',
    height: isMobile ? '100%' : '90vh',
    overflow: 'hidden'
  },
  // Top bar
  topBar: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '12px 16px', borderBottom: `1px solid ${theme.border.subtle}`,
    flexShrink: 0
  },
  backButton: {
    background: 'none', border: 'none', color: theme.text.secondary,
    cursor: 'pointer', padding: '6px', borderRadius: '6px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '32px', minHeight: '32px'
  },
  nameInput: {
    flex: 1, background: 'none', border: `1px solid ${theme.border.subtle}`,
    borderRadius: '6px', padding: '6px 10px', color: theme.text.primary,
    fontSize: '14px', fontWeight: 500, outline: 'none'
  },
  aspectGroup: {
    display: 'flex', gap: '2px', backgroundColor: theme.bg.input,
    borderRadius: '6px', padding: '2px'
  },
  aspectButton: {
    padding: '4px 10px', fontSize: '11px', fontWeight: 500,
    background: 'none', border: 'none', color: theme.text.secondary,
    cursor: 'pointer', borderRadius: '4px'
  },
  aspectActive: {
    padding: '4px 10px', fontSize: '11px', fontWeight: 600,
    backgroundColor: theme.accent.primary, border: 'none', color: '#fff',
    cursor: 'pointer', borderRadius: '4px'
  },
  exportButton: {
    padding: '6px 16px', fontSize: '13px', fontWeight: 600,
    backgroundColor: theme.accent.primary, border: 'none', color: '#fff',
    cursor: 'pointer', borderRadius: '6px', whiteSpace: 'nowrap'
  },
  exportButtonDisabled: {
    padding: '6px 16px', fontSize: '13px', fontWeight: 600,
    backgroundColor: theme.bg.elevated, border: 'none', color: theme.text.muted,
    cursor: 'not-allowed', borderRadius: '6px', whiteSpace: 'nowrap'
  },
  // Body
  body: {
    display: 'flex', flex: 1, minHeight: 0,
    flexDirection: isMobile ? 'column' : 'row'
  },
  // Left panel
  leftPanel: {
    width: isMobile ? '100%' : '288px', flexShrink: 0,
    borderRight: isMobile ? 'none' : `1px solid ${theme.border.subtle}`,
    display: 'flex', flexDirection: 'column', overflow: 'hidden'
  },
  panelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', borderBottom: `1px solid ${theme.border.subtle}`
  },
  panelTitle: {
    fontSize: '13px', fontWeight: 600, color: theme.text.primary
  },
  uploadButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '6px',
    backgroundColor: theme.bg.input, border: `1px solid ${theme.border.subtle}`,
    color: theme.text.secondary, cursor: 'pointer'
  },
  photoList: {
    flex: 1, overflowY: 'auto', padding: '8px'
  },
  emptyPhotos: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: '40px 16px', gap: '8px'
  },
  photoItem: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '6px', borderRadius: '6px', marginBottom: '4px',
    border: `1px solid ${theme.border.subtle}`, cursor: 'grab',
    transition: 'border-color 0.15s'
  },
  photoThumb: {
    width: '40px', height: '40px', borderRadius: '4px', overflow: 'hidden', flexShrink: 0
  },
  photoInfo: {
    flex: 1, minWidth: 0
  },
  photoName: {
    fontSize: '12px', fontWeight: 500, color: theme.text.primary,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  },
  photoDuration: {
    fontSize: '10px', color: theme.text.muted
  },
  removeButton: {
    background: 'none', border: 'none', color: theme.text.muted,
    cursor: 'pointer', padding: '4px', borderRadius: '4px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '24px', minHeight: '24px'
  },
  // Library picker
  libraryPicker: {
    padding: '8px', borderBottom: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.bg.elevated
  },
  libraryThumb: {
    aspectRatio: '1', cursor: 'pointer', borderRadius: '4px', overflow: 'hidden',
    border: `1px solid ${theme.border.subtle}`
  },
  smallButton: {
    padding: '4px 8px', fontSize: '11px', fontWeight: 500,
    backgroundColor: theme.bg.input, border: `1px solid ${theme.border.subtle}`,
    borderRadius: '4px', color: theme.text.secondary, cursor: 'pointer'
  },
  // Center panel
  centerPanel: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '16px', minWidth: 0
  },
  previewContainer: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', minHeight: 0
  },
  previewFrame: {
    position: 'relative', overflow: 'hidden',
    borderRadius: '8px', backgroundColor: '#000',
    maxHeight: '100%', maxWidth: '100%',
    aspectRatio: '9/16'
  },
  previewImage: {
    width: '100%', height: '100%', objectFit: 'cover',
    display: 'block'
  },
  photoCounter: {
    position: 'absolute', bottom: '8px', right: '8px',
    padding: '3px 8px', borderRadius: '4px',
    backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff',
    fontSize: '11px', fontWeight: 600
  },
  previewEmpty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', width: '300px', aspectRatio: '9/16',
    backgroundColor: theme.bg.input, borderRadius: '8px',
    border: `2px dashed ${theme.border.subtle}`
  },
  // Playback controls
  playbackControls: {
    display: 'flex', alignItems: 'center', gap: '12px',
    width: '100%', maxWidth: '500px', marginTop: '12px', flexShrink: 0
  },
  playButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '36px', height: '36px', borderRadius: '50%',
    backgroundColor: theme.accent.primary, border: 'none',
    color: '#fff', cursor: 'pointer', flexShrink: 0
  },
  scrubberContainer: {
    flex: 1
  },
  scrubber: {
    width: '100%', accentColor: theme.accent.primary
  },
  timeDisplay: {
    fontSize: '11px', color: theme.text.muted, fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap', minWidth: '80px', textAlign: 'right'
  },
  presetSelect: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.primary,
    fontSize: '13px',
    outline: 'none'
  },
  fullscreenButton: {
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
  audioTrack: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    maxWidth: '500px',
    height: '28px',
    marginTop: '6px',
    flexShrink: 0
  },
  waveformContainer: {
    flex: 1,
    height: '100%',
    display: 'flex',
    alignItems: 'flex-end',
    gap: '1px',
    backgroundColor: theme.bg.input,
    borderRadius: '4px',
    padding: '2px',
    overflow: 'hidden'
  },
  // Filmstrip timeline
  filmstrip: {
    display: 'flex', width: '100%', maxWidth: '500px',
    height: '32px', marginTop: '8px', borderRadius: '4px',
    overflow: 'hidden', position: 'relative',
    backgroundColor: theme.bg.input, flexShrink: 0
  },
  filmstripItem: {
    height: '100%', overflow: 'hidden',
    borderBottom: '2px solid transparent',
    boxSizing: 'border-box'
  },
  filmstripThumb: {
    width: '100%', height: '100%', objectFit: 'cover',
    display: 'block'
  },
  filmstripPlayhead: {
    position: 'absolute', top: 0, bottom: 0,
    width: '2px', backgroundColor: '#fff',
    zIndex: 2, pointerEvents: 'none'
  },
  // Text timeline track
  textTimelineTrack: {
    position: 'relative', width: '100%', maxWidth: '500px',
    height: '24px', marginTop: '6px', borderRadius: '4px',
    backgroundColor: theme.bg.input, flexShrink: 0,
    overflow: 'visible'
  },
  // Edit bar
  editBar: {
    display: 'flex', alignItems: 'center', gap: '6px',
    width: '100%', maxWidth: '500px', marginTop: '6px',
    padding: '4px 6px', borderRadius: '6px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.border.subtle}`, flexShrink: 0
  },
  editBarInput: {
    flex: 1, padding: '4px 8px', fontSize: '12px',
    backgroundColor: theme.bg.input, border: `1px solid ${theme.border.subtle}`,
    borderRadius: '4px', color: theme.text.primary, outline: 'none'
  },
  editBarDelete: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '4px',
    backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    color: '#ef4444', cursor: 'pointer'
  },
  editBarDone: {
    padding: '4px 10px', fontSize: '11px', fontWeight: 600,
    backgroundColor: theme.accent.primary, border: 'none',
    borderRadius: '4px', color: '#fff', cursor: 'pointer'
  },
  // Export progress
  exportProgressBar: {
    width: '100%', maxWidth: '500px', height: '4px',
    backgroundColor: theme.bg.input, borderRadius: '2px',
    marginTop: '8px', overflow: 'hidden', flexShrink: 0
  },
  exportProgressFill: {
    height: '100%', backgroundColor: theme.accent.primary,
    borderRadius: '2px', transition: 'width 0.2s'
  },
  // Right panel
  rightPanel: {
    width: isMobile ? '100%' : '256px', flexShrink: 0,
    borderLeft: isMobile ? 'none' : `1px solid ${theme.border.subtle}`,
    overflowY: 'auto', padding: '12px'
  },
  settingsSection: {
    marginBottom: '16px'
  },
  settingsLabel: {
    fontSize: '12px', fontWeight: 600, color: theme.text.primary, marginBottom: '6px'
  },
  toggleGroup: {
    display: 'flex', gap: '2px', backgroundColor: theme.bg.input,
    borderRadius: '6px', padding: '2px'
  },
  toggleButton: {
    flex: 1, padding: '5px 8px', fontSize: '11px', fontWeight: 500,
    background: 'none', border: 'none', color: theme.text.secondary,
    cursor: 'pointer', borderRadius: '4px', textAlign: 'center'
  },
  toggleActive: {
    flex: 1, padding: '5px 8px', fontSize: '11px', fontWeight: 600,
    backgroundColor: theme.accent.primary, border: 'none', color: '#fff',
    cursor: 'pointer', borderRadius: '4px', textAlign: 'center'
  },
  numberInput: {
    width: '100%', marginTop: '6px', padding: '5px 8px',
    fontSize: '12px', backgroundColor: theme.bg.input,
    border: `1px solid ${theme.border.subtle}`, borderRadius: '4px',
    color: theme.text.primary, outline: 'none'
  },
  toggleOnButton: {
    padding: '3px 10px', fontSize: '11px', fontWeight: 600,
    backgroundColor: `${theme.accent.primary}30`, border: `1px solid ${theme.accent.primary}`,
    borderRadius: '4px', color: theme.accent.primary, cursor: 'pointer'
  },
  toggleOffButton: {
    padding: '3px 10px', fontSize: '11px', fontWeight: 500,
    backgroundColor: theme.bg.input, border: `1px solid ${theme.border.subtle}`,
    borderRadius: '4px', color: theme.text.muted, cursor: 'pointer'
  },
  // Audio
  audioItem: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '6px 8px', borderRadius: '6px',
    backgroundColor: `${theme.accent.primary}10`,
    border: `1px solid ${theme.accent.primary}30`
  },
  addAudioButton: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '8px 12px', borderRadius: '6px', width: '100%',
    backgroundColor: theme.bg.input, border: `1px solid ${theme.border.subtle}`,
    color: theme.text.secondary, cursor: 'pointer', fontSize: '12px', fontWeight: 500
  },
  // Confirm modal
  confirmOverlay: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100
  },
  confirmModal: {
    backgroundColor: theme.bg.surface,
    borderRadius: '12px', padding: '20px',
    border: `1px solid ${theme.border.subtle}`,
    maxWidth: '340px', width: '100%'
  },
  confirmKeepButton: {
    padding: '8px 16px', fontSize: '13px', fontWeight: 500,
    backgroundColor: theme.bg.input, border: `1px solid ${theme.border.subtle}`,
    borderRadius: '6px', color: theme.text.primary, cursor: 'pointer'
  },
  confirmCloseButton: {
    padding: '8px 16px', fontSize: '13px', fontWeight: 600,
    backgroundColor: '#ef4444', border: 'none',
    borderRadius: '6px', color: '#fff', cursor: 'pointer'
  }
});

export default PhotoMontageEditor;
