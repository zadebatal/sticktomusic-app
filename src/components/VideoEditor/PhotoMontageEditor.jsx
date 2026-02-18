import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections,
  incrementUseCount, MEDIA_TYPES,
  addCreatedVideo, saveCreatedContentAsync
} from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';
import { renderPhotoMontage } from '../../services/photoMontageExportService';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import CloudImportButton from './CloudImportButton';
import log from '../../utils/logger';

/**
 * PhotoMontageEditor — Turn photos into a fast-paced video with transitions
 *
 * Layout:
 *   Left (w-72):   Photo list (drag-to-reorder), per-photo duration, upload/import
 *   Center:        Preview with Ken Burns CSS animation, playback controls
 *   Right (w-64):  Settings: speed, transition, Ken Burns toggle, audio, beat sync
 */
const PhotoMontageEditor = ({
  category,
  existingVideo = null,
  onSave,
  onClose,
  artistId = null,
  db = null
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
  const [speed, setSpeed] = useState(existingVideo?.montageSpeed || 1); // seconds per photo
  const [transition, setTransition] = useState(existingVideo?.montageTransition || 'cut');
  const [kenBurnsEnabled, setKenBurnsEnabled] = useState(existingVideo?.montageKenBurns !== false);
  const [aspectRatio, setAspectRatio] = useState(existingVideo?.cropMode || '9:16');

  // ── Audio state ──
  const [audio, setAudio] = useState(existingVideo?.audio || null);
  const [beatSyncEnabled, setBeatSyncEnabled] = useState(existingVideo?.montageBeatSync || false);
  const audioRef = useRef(null);

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

  // ── Drag reorder ──
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Subscribe to library for importing photos
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

  // ── Computed: photo durations (beat-synced or fixed) ──
  const photoDurations = useMemo(() => {
    if (beatSyncEnabled && beats.length > 1 && photos.length > 0) {
      // Distribute photos across beats
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
    if (beatSyncEnabled && audio?.url && !bpm) {
      analyzeAudio(audio.url);
    }
  }, [beatSyncEnabled, audio?.url, bpm, analyzeAudio]);

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
        if (next >= totalDuration) return 0; // loop
        return next;
      });

      playbackRef.current = requestAnimationFrame(tick);
    };
    playbackRef.current = requestAnimationFrame(tick);

    // Start audio
    if (audioRef.current && audio?.url) {
      audioRef.current.currentTime = audio.startTime || 0;
      audioRef.current.play().catch(() => {});
    }
  }, [photos.length, totalDuration, audio]);

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

  // ── Audio handling ──
  const handleAudioUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAudio({ id: `audio_${Date.now()}`, name: file.name, url, file, duration: null });
    setBeatSyncEnabled(false); // Reset beat sync for new audio
  }, []);

  const handleRemoveAudio = useCallback(() => {
    if (audio?.url?.startsWith('blob:')) URL.revokeObjectURL(audio.url);
    setAudio(null);
    setBeatSyncEnabled(false);
  }, [audio]);

  // ── Export ──
  const handleExport = useCallback(async () => {
    if (photos.length === 0) { toastError('Add at least one photo'); return; }
    setIsExporting(true);
    setExportProgress(0);
    stopPlayback();

    try {
      // Upload local photos first
      const uploadedPhotos = await Promise.all(photos.map(async (photo, i) => {
        if (photo.isLocal && photo.file) {
          const { url } = await uploadFile(photo.file, 'images');
          return { ...photo, url, isLocal: false };
        }
        return photo;
      }));

      // Upload audio if local
      let audioForExport = audio;
      if (audio?.file) {
        const { url } = await uploadFile(audio.file, 'audio');
        audioForExport = { ...audio, url };
      }

      // Build photo array with durations
      const photosWithDurations = uploadedPhotos.map((p, i) => ({
        url: p.url,
        duration: photoDurations[i]
      }));

      // Render
      const blob = await renderPhotoMontage({
        photos: photosWithDurations,
        aspectRatio,
        transition,
        kenBurns: kenBurnsEnabled,
        audio: audioForExport
      }, (progress) => setExportProgress(progress));

      // Upload final video
      setExportProgress(95);
      const { url: cloudUrl } = await uploadFile(
        new File([blob], `montage_${Date.now()}.mp4`, { type: 'video/mp4' }),
        'videos'
      );

      // Save as created video
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
  }, [photos, audio, photoDurations, aspectRatio, transition, kenBurnsEnabled, name, speed, beatSyncEnabled, totalDuration, artistId, db, category, onSave, onClose, toastSuccess, toastError, stopPlayback]);

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

  // Speed presets
  const SPEED_PRESETS = [
    { label: '0.5s', value: 0.5 },
    { label: '1s', value: 1 },
    { label: '2s', value: 2 },
    { label: '3s', value: 3 },
  ];

  // ── Render ──
  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        {/* Top Bar */}
        <div style={styles.topBar}>
          <button onClick={onClose} style={styles.backButton} title="Back">
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
                <div style={styles.previewFrame}>
                  <img
                    src={photos[currentPhotoIndex]?.url}
                    alt=""
                    style={{
                      ...styles.previewImage,
                      ...getKenBurnsStyle(currentPhotoIndex, currentPhotoProgress),
                      transition: isPlaying ? 'none' : 'transform 0.3s ease'
                    }}
                  />
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
            </div>

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

            {/* Audio */}
            <div style={styles.settingsSection}>
              <div style={styles.settingsLabel}>Audio</div>
              {audio ? (
                <div style={styles.audioItem}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.accent.primary} strokeWidth="2">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                  </svg>
                  <span style={{ flex: 1, fontSize: '12px', color: theme.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {audio.name || 'Audio'}
                  </span>
                  <button onClick={handleRemoveAudio} style={styles.removeButton}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <label style={styles.addAudioButton}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                  </svg>
                  Add Audio
                  <input type="file" accept="audio/*" onChange={handleAudioUpload} style={{ display: 'none' }} />
                </label>
              )}
            </div>

            {/* Beat Sync */}
            {audio && (
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

            {/* Summary */}
            <div style={{ ...styles.settingsSection, borderTop: `1px solid ${theme.border.subtle}`, paddingTop: '12px', marginTop: '8px' }}>
              <div style={{ fontSize: '11px', color: theme.text.muted }}>
                {photos.length} photo{photos.length !== 1 ? 's' : ''} &middot; {totalDuration.toFixed(1)}s total
                {bpm ? ` &middot; ${bpm} BPM` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Hidden audio element for preview playback */}
        {audio?.url && (
          <audio ref={audioRef} src={audio.url} preload="auto" />
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
  // Export progress
  exportProgressBar: {
    width: '100%', maxWidth: '500px', height: '4px',
    backgroundColor: theme.bg.input, borderRadius: '2px',
    marginTop: '8px', overflow: 'hidden'
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
  }
});

export default PhotoMontageEditor;
