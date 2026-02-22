import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary, getLyrics,
  incrementUseCount, MEDIA_TYPES, addToLibraryAsync,
  addCreatedVideo, saveCreatedContentAsync,
  getBankColor, getBankLabel
} from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';
import { renderPhotoMontage } from '../../services/photoMontageExportService';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import { normalizeBeatsToTrimRange } from '../../utils/timelineNormalization';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import AudioClipSelector from './AudioClipSelector';
import LyricBank from './LyricBank';
import WordTimeline from './WordTimeline';
import LyricAnalyzer from './LyricAnalyzer';
import CloudImportButton from './CloudImportButton';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { Badge } from '../../ui/components/Badge';
import { FeatherMaximize2, FeatherGrid, FeatherStar, FeatherMusic, FeatherUpload, FeatherTrash2, FeatherScissors, FeatherPlus, FeatherMic, FeatherRefreshCw, FeatherPlay, FeatherPause, FeatherSkipBack, FeatherSkipForward, FeatherCheck } from '@subframe/core';
import EditorShell from './shared/EditorShell';
import EditorTopBar from './shared/EditorTopBar';
import EditorFooter from './shared/EditorFooter';
import useCollapsibleSections from './shared/useCollapsibleSections';
import useMediaMultiSelect from './shared/useMediaMultiSelect';
import useEditorSessionState from './shared/useEditorSessionState';

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
  nicheTextBanks = null
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const { isMobile } = useIsMobile();

  // ── Multi-video state (mirrors Solo/Multi allVideos pattern) ──
  const [allVideos, setAllVideos] = useState(() => {
    if (existingVideo?.editorMode === 'photo-montage') {
      return [{
        id: 'template',
        name: 'Template',
        photos: existingVideo?.montagePhotos || [],
        textOverlays: existingVideo?.textOverlays || [],
        words: existingVideo?.words || [],
        textStyle: existingVideo?.textStyle || {
          fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: '600',
          color: '#ffffff', outline: true, outlineColor: '#000000', textAlign: 'center', textCase: 'default'
        },
        isTemplate: true
      }];
    }
    return [{
      id: 'template',
      name: 'Template',
      photos: [],
      textOverlays: [],
      words: [],
      textStyle: {
        fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: '600',
        color: '#ffffff', outline: true, outlineColor: '#000000', textAlign: 'center', textCase: 'default'
      },
      isTemplate: true
    }];
  });
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [generateCount, setGenerateCount] = useState(5);
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

  // Wrapper setters (route through allVideos)
  const setPhotos = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const current = copy[activeVideoIndex];
      if (!current) return prev;
      copy[activeVideoIndex] = {
        ...current,
        photos: typeof updater === 'function' ? updater(current.photos || []) : updater
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
        textOverlays: typeof updater === 'function' ? updater(current.textOverlays || []) : updater
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

  const setTextStyle = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const current = copy[activeVideoIndex];
      if (!current) return prev;
      copy[activeVideoIndex] = {
        ...current,
        textStyle: typeof updater === 'function' ? updater(current.textStyle || {}) : updater
      };
      return copy;
    });
  }, [activeVideoIndex]);

  // ── Footer state ──
  const [isSavingAll, setIsSavingAll] = useState(false);

  // ── Settings state (global across all variations) ──
  const [speed, setSpeed] = useState(existingVideo?.montageSpeed || 1);
  const [transition, setTransition] = useState(existingVideo?.montageTransition || 'cut');
  const [kenBurnsEnabled, setKenBurnsEnabled] = useState(existingVideo?.montageKenBurns !== false);
  const [aspectRatio, setAspectRatio] = useState(existingVideo?.cropMode || '9:16');

  // ── Audio state ──
  const [selectedAudio, setSelectedAudio] = useState(existingVideo?.audio || null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [beatSyncEnabled, setBeatSyncEnabled] = useState(existingVideo?.montageBeatSync || false);
  const audioRef = useRef(null);
  const audioFileInputRef = useRef(null);

  // ── Text editing state ──
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [draggingTextId, setDraggingTextId] = useState(null);
  const dragStartRef = useRef(null);
  const previewRef = useRef(null);
  const timelineRef = useRef(null);
  const [timelineDrag, setTimelineDrag] = useState(null);

  // ── Words extra state ──
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [loadedBankLyricId, setLoadedBankLyricId] = useState(null);

  // ── Beat detection ──
  const { beats, bpm, isAnalyzing: beatAnalyzing, analyzeAudio } = useBeatDetection();

  // Audio trim boundaries for beat normalization
  const audioStartTime = selectedAudio?.startTime || 0;
  const audioEndTime = selectedAudio?.endTime || selectedAudio?.duration || 0;

  // Filter beats to trimmed range and normalize to local time
  const filteredBeats = useMemo(() => {
    if (!beats.length) return [];
    return normalizeBeatsToTrimRange(beats, audioStartTime, audioEndTime);
  }, [beats, audioStartTime, audioEndTime]);

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

  // ── Footer state ──
  const [lastSaved, setLastSaved] = useState(null);

  // ── Right Sidebar: collapsible sections ──
  const { openSections, renderCollapsibleSection } = useCollapsibleSections({
    audio: true, photoSettings: true, lyrics: false, textStyle: false
  });

  // ── Session persistence ──
  const { loadSession, saveSession, clearSession } = useEditorSessionState(
    artistId, 'photo-montage', existingVideo?.id
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

  // ── Drag reorder ──
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // ── Undo/Redo history (route through allVideos) ──
  const getHistorySnapshot = useCallback(() => {
    const v = allVideos[activeVideoIndex];
    return { ...v, selectedAudio };
  }, [allVideos, activeVideoIndex, selectedAudio]);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    const { selectedAudio: snapAudio, ...videoSnapshot } = snapshot;
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      copy[activeVideoIndex] = { ...cur, ...videoSnapshot };
      return copy;
    });
    if (snapAudio !== undefined) setSelectedAudio(snapAudio);
  }, [activeVideoIndex]);

  const { canUndo, canRedo, handleUndo, handleRedo, resetHistory } = useEditorHistory({
    getSnapshot: getHistorySnapshot,
    restoreSnapshot: restoreHistorySnapshot,
    deps: [photos, textOverlays, selectedAudio, textStyle, words],
    isEditingText: !!editingTextId
  });

  // Reset history when switching variations
  useEffect(() => { resetHistory(); }, [activeVideoIndex, resetHistory]);

  // ── Waveform (for future timeline rendering) ──
  const { waveformData } = useWaveform({
    selectedAudio,
    clips: [],
    getClipUrl: () => null
  });

  // ── Multi-video: switch, delete, generate ──
  const switchToVideo = useCallback((index) => {
    if (index === activeVideoIndex) return;
    setActiveVideoIndex(index);
  }, [activeVideoIndex]);

  const handleDeleteVideo = useCallback((index) => {
    if (index === 0) return; // Can't delete template
    setAllVideos(prev => prev.filter((_, i) => i !== index));
    setActiveVideoIndex(prev => {
      if (prev === index) return 0;
      if (prev > index) return prev - 1;
      return prev;
    });
    toastSuccess('Variation deleted');
  }, [toastSuccess]);

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
        isTemplate: false
      });
    }

    setAllVideos(prev => [...prev, ...newVideos]);
    setIsGenerating(false);
    toastSuccess(`Generated ${generateCount} variations`);
  }, [allVideos, generateCount, keepTemplateText, toastSuccess, toastError]);

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

  const libraryAudio = useMemo(() =>
    library.filter(m => m.type === MEDIA_TYPES.AUDIO),
    [library]
  );

  // ── Computed: photo durations (beat-synced or fixed) ──
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
    return photos.map(p => p.customDuration || speed);
  }, [photos, speed, beatSyncEnabled, filteredBeats]);

  const totalDuration = useMemo(() =>
    photoDurations.reduce((sum, d) => sum + d, 0),
    [photoDurations]
  );

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
          montagePhotos: (video.photos || []).map(p => ({ id: p.id, sourceImageId: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl || null, name: p.name })),
          montageSpeed: speed,
          montageTransition: transition,
          montageKenBurns: kenBurnsEnabled,
          montageBeatSync: beatSyncEnabled,
          audio: selectedAudio,
          cropMode: aspectRatio,
          duration: totalDuration,
          textOverlays: video.textOverlays || [],
          textStyle: video.textStyle || {},
          words: video.words || [],
          status: 'draft',
          createdAt: existingVideo?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
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
  }, [allVideos, isSavingAll, existingVideo, name, speed, transition, kenBurnsEnabled, beatSyncEnabled, selectedAudio, aspectRatio, totalDuration, onSave, onClose, toastSuccess, toastError]);

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
  }, [draggingTextId, updateTextOverlay]);

  // ── Timeline text block drag/resize ──
  const handleTimelineDragStart = useCallback((e, overlayId, type) => {
    e.preventDefault();
    e.stopPropagation();
    const overlay = textOverlaysRef.current.find(o => o.id === overlayId);
    if (!overlay) return;
    setTimelineDrag({
      overlayId, type,
      startX: e.clientX,
      origStart: overlay.startTime,
      origEnd: overlay.endTime
    });
    setEditingTextId(overlayId);
    setEditingTextValue(overlay.text);
  }, []);

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
      montagePhotos: photos.map(p => ({ id: p.id, sourceImageId: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl || null, name: p.name })),
      montageSpeed: speed,
      montageTransition: transition,
      montageKenBurns: kenBurnsEnabled,
      montageBeatSync: beatSyncEnabled,
      audio: selectedAudio,
      cropMode: aspectRatio,
      duration: totalDuration,
      textOverlays,
      textStyle,
      words,
      status: 'draft',
      createdAt: existingVideo?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onSave(videoData);
    setLastSaved(new Date());
    toastSuccess(`Saved "${name}"`);
  }, [photos, name, speed, transition, kenBurnsEnabled, beatSyncEnabled, selectedAudio, aspectRatio, totalDuration, textOverlays, textStyle, words, existingVideo, onSave, toastSuccess, toastError]);

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
    const hasWork = photos.length > 0 || textOverlays.length > 0 || selectedAudio || allVideos.length > 1;
    if (hasWork) {
      setShowCloseConfirm(true);
    } else {
      clearSession();
      onClose();
    }
  }, [photos.length, textOverlays.length, selectedAudio, allVideos.length, onClose, clearSession]);

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
        <div className={`flex grow shrink-0 basis-0 self-stretch overflow-hidden ${isMobile ? 'flex-col overflow-auto' : ''}`}>

          {/* ── LEFT PANEL — Photo List ── */}
          {!isMobile && (
          <div className="flex w-72 flex-none flex-col border-r border-neutral-800 bg-[#1a1a1aff] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-800">
              <span className="text-[13px] font-semibold text-white">Photos ({photos.length})</span>
              <div className="flex gap-1">
                <label className="flex items-center justify-center w-7 h-7 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-400 cursor-pointer hover:text-white">
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
                    const realFiles = files.map(f => f.file).filter(Boolean);
                    if (realFiles.length > 0) addPhotosFromFiles(realFiles);
                  }}
                />
                {libraryImages.length > 0 && (
                  <IconButton size="small" icon={<FeatherGrid />} aria-label="Browse library" onClick={() => setShowLibraryPicker(!showLibraryPicker)} />
                )}
              </div>
            </div>

            {/* Library picker dropdown */}
            {showLibraryPicker && (
              <div className="p-2 border-b border-neutral-800 bg-[#171717]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-neutral-400">
                      Library ({libraryImages.length})
                    </span>
                    {libraryImages.length > 0 && (
                      <button className="text-[11px] text-indigo-400 hover:text-indigo-300" onClick={selectAllLib}>
                        {selectedLibIds.size === libraryImages.length ? 'Deselect All' : 'Select All'}
                      </button>
                    )}
                  </div>
                  {selectedLibIds.size > 0 && (
                    <span className="text-[11px] text-neutral-500">{selectedLibIds.size} selected</span>
                  )}
                </div>
                {selectedLibIds.size > 0 && (
                  <Button variant="brand-secondary" size="small" className="w-full mb-1.5" onClick={() => {
                    const selected = libraryImages.filter(img => selectedLibIds.has(img.id));
                    addPhotosFromLibrary(selected);
                    clearLibSelection();
                    toastSuccess(`Added ${selected.length} photo${selected.length !== 1 ? 's' : ''} to montage`);
                  }}>
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
                    <div className="absolute pointer-events-none border border-indigo-400 bg-indigo-500/20 z-10 rounded-sm"
                      style={{ left: libRubberBand.left, top: libRubberBand.top, width: libRubberBand.width, height: libRubberBand.height }} />
                  )}
                  <div className="grid grid-cols-3 gap-1">
                    {libraryImages.map(img => {
                      const isSelected = selectedLibIds.has(img.id);
                      return (
                        <div key={img.id}
                          data-media-id={img.id}
                          className={`relative aspect-square cursor-pointer rounded overflow-hidden border-2 transition-colors ${
                            isSelected ? 'border-indigo-500' : 'border-neutral-700 hover:border-brand-500'
                          }`}
                          onClick={(e) => {
                            if (libDragSelecting) return;
                            if (e.shiftKey || selectedLibIds.size > 0) {
                              toggleLibSelect(img.id, e);
                            } else {
                              addPhotosFromLibrary([img]);
                            }
                          }}>
                          <img src={img.thumbnailUrl || img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          {isSelected && (
                            <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-indigo-500 flex items-center justify-center">
                              <FeatherCheck className="text-white" style={{ width: 10, height: 10 }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Button variant="neutral-secondary" size="small" onClick={() => { setShowLibraryPicker(false); clearLibSelection(); }} className="mt-1.5 w-full">Done</Button>
              </div>
            )}

            {/* Photo list */}
            <div className="flex-1 overflow-y-auto p-2">
              {photos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                  </svg>
                  <span className="text-[12px] text-neutral-500">Upload or import photos</span>
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
                    className="flex items-center gap-2 p-1.5 rounded-md mb-1 border cursor-grab transition-colors"
                    style={{
                      opacity: dragIndex === index ? 0.5 : 1,
                      borderColor: dragOverIndex === index ? theme.accent.primary : 'rgb(38,38,38)',
                      backgroundColor: currentPhotoIndex === index && isPlaying ? `${theme.accent.primary}15` : 'transparent'
                    }}
                  >
                    <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
                      <img src={photo.thumbnailUrl || photo.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-white truncate">{photo.name || `Photo ${index + 1}`}</div>
                      <div className="text-[10px] text-neutral-500">
                        {beatSyncEnabled ? `${photoDurations[index]?.toFixed(2)}s (beat)` : `${photoDurations[index]?.toFixed(1)}s`}
                      </div>
                    </div>
                    <IconButton size="small" variant="destructive-tertiary" icon={<FeatherTrash2 className="w-3 h-3" />} onClick={() => removePhoto(index)} aria-label="Remove" />
                  </div>
                ))
              )}
            </div>
          </div>
          )}

          {/* ── CENTER COLUMN ── */}
          <div className="flex grow shrink-0 basis-0 flex-col items-center bg-black overflow-hidden">
            <div className="flex w-full max-w-[448px] grow flex-col items-center gap-4 py-6 px-4 overflow-auto">

              {/* Photo Preview */}
              {photos.length > 0 ? (
                <div
                  ref={previewRef}
                  className="flex items-center justify-center rounded-lg bg-[#1a1a1aff] border border-neutral-800 relative overflow-hidden"
                  style={{ aspectRatio: '9/16', height: '50vh' }}
                  onClick={() => setEditingTextId(null)}
                >
                  <img
                    src={photos[currentPhotoIndex]?.url}
                    alt=""
                    style={{
                      width: '100%', height: '100%', objectFit: 'cover', display: 'block',
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
                  <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-[11px] font-semibold">
                    {currentPhotoIndex + 1} / {photos.length}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg bg-[#111118] border-2 border-dashed border-neutral-700" style={{ width: '300px', aspectRatio: '9/16' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
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
                    setCurrentTime(parseFloat(e.target.value));
                  }}
                  className="flex-1 accent-brand-600"
                />

                <span className="text-[11px] text-neutral-500 tabular-nums whitespace-nowrap min-w-[80px] text-right">
                  {currentTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
                </span>
                {!isMobile && (
                  <IconButton size="small" icon={<FeatherMaximize2 />} aria-label="Fullscreen" onClick={() => previewRef.current?.requestFullscreen()} />
                )}
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
                    <span>{video.isTemplate ? 'Template' : video.name || `Montage ${idx}`}</span>
                    {!video.isTemplate && (
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteVideo(idx); }} className="bg-transparent border-none text-neutral-500 text-[14px] cursor-pointer px-0.5 ml-0.5 leading-none">&times;</button>
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
                <Button variant="brand-primary" size="small" onClick={executeGeneration} disabled={isGenerating || photos.length === 0}>
                  {isGenerating ? 'Remixing...' : 'Remix'}
                </Button>
              </div>

              {/* Photo filmstrip timeline */}
              {photos.length > 0 && (
                <div className="flex w-full max-w-[500px] h-8 rounded overflow-hidden relative bg-neutral-800 flex-shrink-0">
                  {photos.map((photo, i) => {
                    const widthPct = totalDuration > 0 ? (photoDurations[i] / totalDuration) * 100 : (100 / photos.length);
                    return (
                      <div
                        key={photo.id}
                        className="h-full overflow-hidden box-border"
                        style={{
                          width: `${widthPct}%`,
                          borderBottom: `2px solid ${currentPhotoIndex === i ? theme.accent.primary : 'transparent'}`
                        }}
                      >
                        <img src={photo.url} alt="" className="w-full h-full object-cover block" />
                      </div>
                    );
                  })}
                  {/* Playhead */}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-white z-[2] pointer-events-none" style={{
                    left: totalDuration > 0 ? `${(currentTime / totalDuration) * 100}%` : '0%'
                  }} />
                </div>
              )}

              {/* Text overlay timeline track */}
              {textOverlays.length > 0 && (
                <div ref={timelineRef} className="relative w-full max-w-[500px] h-6 rounded bg-neutral-800 flex-shrink-0 overflow-visible">
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
                        <div
                          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '5px', cursor: 'col-resize', zIndex: 11 }}
                          onMouseDown={(e) => { e.stopPropagation(); handleTimelineDragStart(e, overlay.id, 'left'); }}
                        />
                        <span style={{ fontSize: '9px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', padding: '0 4px' }}>
                          {overlay.text}
                        </span>
                        <div
                          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '5px', cursor: 'col-resize', zIndex: 11 }}
                          onMouseDown={(e) => { e.stopPropagation(); handleTimelineDragStart(e, overlay.id, 'right'); }}
                        />
                      </div>
                    );
                  })}
                  {/* Playhead on text track */}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-white z-[2] pointer-events-none" style={{
                    left: totalDuration > 0 ? `${(currentTime / totalDuration) * 100}%` : '0%'
                  }} />
                </div>
              )}

              {/* Audio waveform track */}
              {waveformData.length > 0 && selectedAudio && (
                <div className="flex items-center gap-2 w-full max-w-[500px] h-7 flex-shrink-0">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={externalAudioVolume}
                    onChange={(e) => setExternalAudioVolume(parseFloat(e.target.value))}
                    title={`Volume: ${Math.round(externalAudioVolume * 100)}%`}
                    className="w-10 accent-purple-500 flex-shrink-0"
                  />
                  <div className="flex-1 h-full flex items-end gap-px bg-neutral-800 rounded p-0.5 overflow-hidden">
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
                  <div className="flex items-center gap-1.5 w-full max-w-[500px] p-1 rounded-md bg-[#171717] border border-neutral-800 flex-shrink-0">
                    <input
                      type="text"
                      value={editingTextValue}
                      onChange={(e) => {
                        setEditingTextValue(e.target.value);
                        updateTextOverlay(editingTextId, { text: e.target.value });
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') setEditingTextId(null); }}
                      className="flex-1 py-1 px-2 text-[12px] bg-neutral-800 border border-neutral-700 rounded text-white outline-none"
                      autoFocus
                    />
                    <IconButton size="small" variant="destructive-tertiary" icon={<FeatherTrash2 className="w-3 h-3" />} onClick={() => removeTextOverlay(editingTextId)} aria-label="Delete overlay" />
                    <Button variant="brand-primary" size="small" onClick={() => setEditingTextId(null)}>Done</Button>
                  </div>
                );
              })()}

              {/* Export progress bar */}
              {isExporting && (
                <div className="w-full max-w-[500px] h-1 bg-neutral-800 rounded overflow-hidden flex-shrink-0">
                  <div className="h-full bg-brand-600 rounded transition-[width] duration-200" style={{ width: `${exportProgress}%` }} />
                </div>
              )}

            </div>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          {!isMobile && (
            <div className="flex w-96 flex-none flex-col border-l border-neutral-800 bg-[#1a1a1aff] overflow-auto">

              {renderCollapsibleSection('audio', 'Audio', (
                <div className="flex flex-col gap-3">
                  {selectedAudio ? (
                    <>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-black/50">
                        <FeatherMusic className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        <span className="text-body font-body text-[#ffffffff] flex-1 truncate">{selectedAudio.name || 'Audio'}</span>
                        {selectedAudio.isTrimmed && <Badge>Trimmed</Badge>}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="neutral-secondary" size="small" icon={<FeatherScissors />} onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}>Trim</Button>
                        <Button variant="destructive-tertiary" size="small" icon={<FeatherTrash2 />} onClick={handleRemoveAudio}>Remove</Button>
                      </div>
                      {/* Volume control */}
                      <div className="flex items-center gap-2">
                        <span className="text-caption font-caption text-neutral-400 w-16">Volume</span>
                        <input type="range" min="0" max="1" step="0.05" value={externalAudioVolume}
                          onChange={e => setExternalAudioVolume(parseFloat(e.target.value))}
                          className="flex-1 h-1 accent-purple-500 cursor-pointer" />
                        <span className="text-caption font-caption text-neutral-400 w-8">{Math.round(externalAudioVolume * 100)}%</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-neutral-500 text-caption font-caption py-4">No audio selected</div>
                  )}
                  <Button variant="neutral-secondary" size="small" icon={<FeatherUpload />} onClick={() => audioFileInputRef.current?.click()}>Upload Audio</Button>
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

              {renderCollapsibleSection('photoSettings', 'Photo Settings', (
                <div className="flex flex-col gap-4">
                  {/* Speed */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-semibold text-white">Speed (per photo)</span>
                    <ToggleGroup value={String(speed)} onValueChange={(val) => { if (val) setSpeed(parseFloat(val)); }}>
                      {SPEED_PRESETS.map(preset => (
                        <ToggleGroup.Item key={preset.value} value={String(preset.value)} icon={null}>{preset.label}</ToggleGroup.Item>
                      ))}
                    </ToggleGroup>
                    <input
                      type="number"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value) || 1)}
                      placeholder="Custom (s)"
                      className="w-full mt-1 py-1.5 px-2 text-[12px] bg-neutral-800 border border-neutral-700 rounded text-white outline-none"
                    />
                  </div>

                  {/* Transition */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-semibold text-white">Transition</span>
                    <ToggleGroup value={transition} onValueChange={(val) => { if (val) setTransition(val); }}>
                      <ToggleGroup.Item value="cut" icon={null}>Cut</ToggleGroup.Item>
                      <ToggleGroup.Item value="crossfade" icon={null}>Crossfade</ToggleGroup.Item>
                    </ToggleGroup>
                  </div>

                  {/* Ken Burns */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-white">Ken Burns</span>
                      <Button variant={kenBurnsEnabled ? 'brand-secondary' : 'neutral-secondary'} size="small" onClick={() => setKenBurnsEnabled(!kenBurnsEnabled)}>
                        {kenBurnsEnabled ? 'ON' : 'OFF'}
                      </Button>
                    </div>
                    <span className="text-[11px] text-neutral-500">Pan & zoom animation on each photo</span>
                  </div>

                  {/* Beat Sync */}
                  {selectedAudio && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-white">Beat Sync</span>
                        <Button variant={beatSyncEnabled ? 'brand-secondary' : 'neutral-secondary'} size="small" onClick={() => setBeatSyncEnabled(!beatSyncEnabled)} disabled={beatAnalyzing}>
                          {beatAnalyzing ? '...' : beatSyncEnabled ? 'ON' : 'OFF'}
                        </Button>
                      </div>
                      {bpm && <Badge variant="neutral">{bpm} BPM</Badge>}
                      <span className="text-[11px] text-neutral-500">Time photo cuts to the beat</span>
                    </div>
                  )}

                  {/* Aspect Ratio */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-semibold text-white">Aspect Ratio</span>
                    <ToggleGroup value={aspectRatio} onValueChange={(val) => { if (val) setAspectRatio(val); }}>
                      <ToggleGroup.Item value="9:16" icon={null}>9:16</ToggleGroup.Item>
                      <ToggleGroup.Item value="1:1" icon={null}>1:1</ToggleGroup.Item>
                      <ToggleGroup.Item value="4:5" icon={null}>4:5</ToggleGroup.Item>
                    </ToggleGroup>
                  </div>
                </div>
              ))}

              {renderCollapsibleSection('lyrics', 'Lyrics', (
                <div className="flex flex-col gap-3">
                  <LyricBank
                    lyrics={category?.lyrics || lyricsBank || []}
                    onAddLyrics={onAddLyrics}
                    onUpdateLyrics={onUpdateLyrics}
                    onDeleteLyrics={onDeleteLyrics}
                    onSelectText={(selectedText) => addLyricsAsTimedOverlays(selectedText)}
                    compact={true}
                    showAddForm={true}
                  />
                  {selectedAudio && (
                    <Button variant="neutral-secondary" size="small" icon={<FeatherMic />} onClick={() => setShowTranscriber(true)}>AI Transcribe</Button>
                  )}
                  {(words.length > 0 || selectedAudio) && (
                    <Button variant="neutral-secondary" size="small" onClick={() => setShowWordTimeline(true)}>Word Timeline</Button>
                  )}
                </div>
              ))}

              {renderCollapsibleSection('textStyle', 'Text Style', (
                <div className="flex flex-col gap-3">
                  <Button variant="neutral-secondary" size="small" icon={<FeatherPlus />} onClick={() => addTextOverlay()}>Add Text</Button>
                  {/* Niche Text Banks */}
                  {nicheTextBanks && nicheTextBanks.some(b => b?.length > 0) && (
                    <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800">
                      <span className="text-[12px] font-semibold text-neutral-300">Niche Banks</span>
                      {nicheTextBanks.map((bank, bankIdx) => {
                        if (!bank?.length) return null;
                        const color = getBankColor(bankIdx);
                        return (
                          <div key={bankIdx}>
                            <div className="text-[11px] font-semibold mb-1" style={{ color: color.primary }}>{getBankLabel(bankIdx)}</div>
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
                  {textOverlays.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {textOverlays.map(overlay => (
                        <div key={overlay.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${editingTextId === overlay.id ? 'bg-brand-600/20 border border-brand-600' : 'border border-neutral-800 hover:bg-neutral-800'}`}
                          onClick={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}>
                          <span className="text-body font-body text-[#ffffffff] text-[12px] truncate flex-1">{overlay.text}</span>
                          <IconButton size="small" variant="destructive-tertiary" icon={<FeatherTrash2 className="w-3 h-3" />} onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }} aria-label="Remove" />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Summary */}
                  <div className="text-[11px] text-neutral-500 pt-2 border-t border-neutral-800">
                    {photos.length} photo{photos.length !== 1 ? 's' : ''} · {totalDuration.toFixed(1)}s total
                    {bpm ? ` · ${bpm} BPM` : ''}
                    {textOverlays.length > 0 ? ` · ${textOverlays.length} texts` : ''}
                  </div>
                </div>
              ))}

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

        <EditorFooter lastSaved={lastSaved} onCancel={onClose} onSaveAll={allVideos.length > 1 ? handleSaveAllAndClose : handleSaveDraft} isSavingAll={isSavingAll} saveAllCount={allVideos.length} saveLabel="Save" />

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

export default PhotoMontageEditor;
