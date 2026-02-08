import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  subscribeToLibrary, subscribeToCollections, getCollections, getLibrary,
  addToTextBank, MEDIA_TYPES
} from '../../services/libraryService';
import { useToast } from '../ui';

/**
 * SoloClipEditor — "Solo Clip" video editor mode
 *
 * Mirrors SlideshowEditor's template/generation architecture:
 * - allVideos[0] = template (one clip + text overlays the user designs)
 * - allVideos[1..N] = generated (same overlay style/position, different clip + cycled text)
 * - Tab bar at bottom to switch between them
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
    const firstClip = category?.videos?.[0] || null;
    return [{
      id: 'template',
      name: 'Template',
      clip: firstClip,
      textOverlays: existingVideo?.textOverlays || [],
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

  // Wrapper setters (route through allVideos — same pattern as SlideshowEditor)
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

  // ── Playback state ──
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [clipDuration, setClipDuration] = useState(0);
  const videoRef = useRef(null);
  const animationRef = useRef(null);

  // ── Aspect ratio ──
  const [aspectRatio, setAspectRatio] = useState('9:16');

  // ── Text editing state ──
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [draggingTextId, setDraggingTextId] = useState(null);
  const dragStartRef = useRef(null);
  const previewRef = useRef(null);

  // ── Library state ──
  const [collections, setCollections] = useState([]);
  const [libraryMedia, setLibraryMedia] = useState([]);

  // ── Text bank input state ──
  const [newTextA, setNewTextA] = useState('');
  const [newTextB, setNewTextB] = useState('');
  const [activePanel, setActivePanel] = useState('clips'); // 'clips' | 'text' | 'style' | 'textBank'

  // ── Close confirmation ──
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // ── Mobile detection ──
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Library subscriptions (same as SlideshowEditor) ──
  useEffect(() => {
    if (!artistId) return;
    // Load from localStorage first
    const localCols = getCollections(artistId);
    setCollections(localCols.filter(c => c.type !== 'smart'));
    const localLib = getLibrary(artistId);
    setLibraryMedia(localLib);
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

  // ── Text banks (same as SlideshowEditor) ──
  const getTextBanks = useCallback(() => {
    let textBank1 = [], textBank2 = [];
    for (const col of collections) {
      if (col.textBank1?.length > 0) textBank1 = [...textBank1, ...col.textBank1];
      if (col.textBank2?.length > 0) textBank2 = [...textBank2, ...col.textBank2];
    }
    return { textBank1, textBank2 };
  }, [collections]);

  const handleAddToTextBank = useCallback((bankNum, text) => {
    if (!text.trim() || !artistId || collections.length === 0) return;
    const targetCol = collections[0];
    addToTextBank(artistId, targetCol.id, bankNum, text.trim());
    setCollections(prev => prev.map(col =>
      col.id === targetCol.id
        ? { ...col, [`textBank${bankNum}`]: [...(col[`textBank${bankNum}`] || []), text.trim()] }
        : col
    ));
  }, [artistId, collections]);

  // ── Video playback ──
  const handleVideoLoaded = useCallback(() => {
    if (videoRef.current) {
      setClipDuration(videoRef.current.duration);
    }
  }, []);

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
      cancelAnimationFrame(animationRef.current);
    } else {
      videoRef.current.play();
      animationRef.current = requestAnimationFrame(playbackLoop);
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, playbackLoop]);

  const handleSeek = useCallback((time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Text overlay CRUD (same pattern as SlideshowEditor) ──
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

  const addTextOverlay = useCallback(() => {
    const newOverlay = {
      id: `text_${Date.now()}`,
      text: 'Click to edit',
      style: getDefaultTextStyle(),
      position: { x: 50, y: 50, width: 80, height: 20 }
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

  // ── Text overlay dragging (same as SlideshowEditor) ──
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

  // ── Switch between videos (same as SlideshowEditor switchToSlideshow) ──
  const switchToVideo = useCallback((index) => {
    if (index === activeVideoIndex) return;
    if (videoRef.current) {
      videoRef.current.pause();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setEditingTextId(null);
    setEditingTextValue('');
    setActiveVideoIndex(index);
  }, [activeVideoIndex]);

  // ── Delete generated video ──
  const handleDeleteVideo = useCallback((index) => {
    if (index === 0) return; // Can't delete template
    setAllVideos(prev => prev.filter((_, i) => i !== index));
    if (activeVideoIndex === index) {
      setActiveVideoIndex(Math.max(0, index - 1));
    } else if (activeVideoIndex > index) {
      setActiveVideoIndex(prev => prev - 1);
    }
  }, [activeVideoIndex]);

  // ── Generation (adapted from SlideshowEditor executeGeneration) ──
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
      const { textBank1, textBank2 } = getTextBanks();
      const combinedBank = [...textBank1, ...textBank2];
      const existingGenCount = allVideos.filter(v => !v.isTemplate).length;
      const timestamp = Date.now();
      const generated = [];
      const clipsToUse = availableClips.slice(0, generateCount);

      for (let i = 0; i < clipsToUse.length; i++) {
        const clipItem = clipsToUse[i];

        // Clone template overlays — preserve style + position, cycle text
        const newOverlays = template.textOverlays.map((overlay, idx) => {
          let newText = overlay.text;
          const bank = idx === 0 ? textBank1 : idx === 1 ? textBank2 : combinedBank;
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
  }, [allVideos, generateCount, category, getTextBanks, toastSuccess, toastError]);

  // ── Save ──
  const handleSave = useCallback(() => {
    allVideos.forEach((video) => {
      if (!video.clip) return;
      const clipUrl = video.clip.url || video.clip.localUrl || video.clip.src;
      const videoData = {
        id: video.id === 'template' ? undefined : video.id,
        editorMode: 'solo-clip',
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
        cropMode: aspectRatio,
        duration: clipDuration || 5,
        thumbnail: video.clip.thumbnailUrl || video.clip.thumbnail,
        isTemplate: video.isTemplate
      };
      onSave(videoData);
    });
  }, [allVideos, clipDuration, aspectRatio, onSave]);

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

  // Aspect ratio dimensions
  const getPreviewDimensions = () => {
    if (aspectRatio === '9:16') return { width: 270, height: 480 };
    if (aspectRatio === '4:3') return { width: 400, height: 300 };
    if (aspectRatio === '1:1') return { width: 360, height: 360 };
    return { width: 270, height: 480 };
  };
  const previewDims = getPreviewDimensions();

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
              <h2 style={styles.headerTitle}>Solo Clip Editor</h2>
              <span style={styles.headerSubtitle}>
                {allVideos.length === 1 ? 'Design your template' : `${allVideos.length} videos (1 template + ${allVideos.length - 1} generated)`}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {/* Aspect ratio toggle */}
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
            <button onClick={handleSave} style={styles.saveButton}>
              Save{allVideos.length > 1 ? ` All (${allVideos.length})` : ''}
            </button>
          </div>
        </div>

        {/* ── Main Content ── */}
        <div style={styles.mainContent}>

          {/* ── Left Sidebar ── */}
          <div style={styles.sidebar}>
            {/* Panel tabs */}
            <div style={styles.panelTabs}>
              {[
                { id: 'clips', label: 'Clips' },
                { id: 'text', label: 'Text' },
                { id: 'style', label: 'Style' },
                { id: 'textBank', label: 'Banks' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActivePanel(tab.id)}
                  style={{
                    ...styles.panelTab,
                    ...(activePanel === tab.id ? styles.panelTabActive : {})
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div style={styles.panelContent}>
              {/* ── Clips Panel ── */}
              {activePanel === 'clips' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                    Click a clip to use as template. Remaining clips are used for generation.
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
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '8px' }}>Generate Videos</div>
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
              )}

              {/* ── Text Panel ── */}
              {activePanel === 'text' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button onClick={addTextOverlay} style={styles.addTextButton}>
                    + Add Text Overlay
                  </button>

                  {textOverlays.length === 0 && (
                    <div style={{ fontSize: '12px', color: '#6b7280', textAlign: 'center', padding: '20px 0' }}>
                      No text overlays yet. Click "Add Text Overlay" to start designing your template.
                    </div>
                  )}

                  {textOverlays.map((overlay, idx) => (
                    <div
                      key={overlay.id}
                      onClick={() => { setEditingTextId(overlay.id); setEditingTextValue(overlay.text); }}
                      style={{
                        ...styles.textOverlayItem,
                        ...(editingTextId === overlay.id ? styles.textOverlayItemActive : {})
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>Overlay {idx + 1}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeTextOverlay(overlay.id); }}
                          style={styles.removeOverlayButton}
                        >×</button>
                      </div>
                      {editingTextId === overlay.id ? (
                        <input
                          value={editingTextValue}
                          onChange={(e) => setEditingTextValue(e.target.value)}
                          onBlur={() => updateTextOverlay(overlay.id, { text: editingTextValue })}
                          onKeyDown={(e) => { if (e.key === 'Enter') { updateTextOverlay(overlay.id, { text: editingTextValue }); e.target.blur(); } }}
                          style={styles.textEditInput}
                          autoFocus
                        />
                      ) : (
                        <div style={{ fontSize: '13px', color: '#e5e7eb', marginTop: '4px' }}>{overlay.text}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Style Panel ── */}
              {activePanel === 'style' && editingOverlay && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb' }}>
                    Editing: Overlay "{editingOverlay.text.substring(0, 20)}{editingOverlay.text.length > 20 ? '...' : ''}"
                  </div>

                  {/* Font Family */}
                  <div style={styles.controlRow}>
                    <span style={styles.controlLabel}>Font</span>
                    <select
                      value={editingOverlay.style.fontFamily}
                      onChange={(e) => updateTextOverlay(editingTextId, { style: { ...editingOverlay.style, fontFamily: e.target.value } })}
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
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <button
                        style={styles.sizeButton}
                        onClick={() => updateTextOverlay(editingTextId, {
                          style: { ...editingOverlay.style, fontSize: Math.max(16, editingOverlay.style.fontSize - 4) }
                        })}
                      >A-</button>
                      <span style={{ fontSize: '12px', color: '#d1d5db', minWidth: '30px', textAlign: 'center' }}>{editingOverlay.style.fontSize}</span>
                      <button
                        style={styles.sizeButton}
                        onClick={() => updateTextOverlay(editingTextId, {
                          style: { ...editingOverlay.style, fontSize: Math.min(120, editingOverlay.style.fontSize + 4) }
                        })}
                      >A+</button>
                    </div>
                  </div>

                  {/* Colors */}
                  <div style={styles.controlRow}>
                    <span style={styles.controlLabel}>Color</span>
                    <input
                      type="color"
                      value={editingOverlay.style.color}
                      onChange={(e) => updateTextOverlay(editingTextId, { style: { ...editingOverlay.style, color: e.target.value } })}
                      style={styles.colorInput}
                    />
                  </div>

                  {/* Outline */}
                  <div style={styles.controlRow}>
                    <span style={styles.controlLabel}>Outline</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        style={{
                          ...styles.toggleButton,
                          ...(editingOverlay.style.outline ? styles.toggleButtonActive : {})
                        }}
                        onClick={() => updateTextOverlay(editingTextId, { style: { ...editingOverlay.style, outline: true } })}
                      >On</button>
                      <button
                        style={{
                          ...styles.toggleButton,
                          ...(!editingOverlay.style.outline ? styles.toggleButtonActive : {})
                        }}
                        onClick={() => updateTextOverlay(editingTextId, { style: { ...editingOverlay.style, outline: false } })}
                      >Off</button>
                    </div>
                    {editingOverlay.style.outline && (
                      <input
                        type="color"
                        value={editingOverlay.style.outlineColor}
                        onChange={(e) => updateTextOverlay(editingTextId, { style: { ...editingOverlay.style, outlineColor: e.target.value } })}
                        style={styles.colorInput}
                      />
                    )}
                  </div>

                  {/* Text Align */}
                  <div style={styles.controlRow}>
                    <span style={styles.controlLabel}>Align</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {['left', 'center', 'right'].map(align => (
                        <button
                          key={align}
                          style={{
                            ...styles.toggleButton,
                            ...(editingOverlay.style.textAlign === align ? styles.toggleButtonActive : {})
                          }}
                          onClick={() => updateTextOverlay(editingTextId, { style: { ...editingOverlay.style, textAlign: align } })}
                        >
                          {align.charAt(0).toUpperCase() + align.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Case */}
                  <div style={styles.controlRow}>
                    <span style={styles.controlLabel}>Case</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[
                        { id: 'default', label: 'Default' },
                        { id: 'upper', label: 'UPPER' },
                        { id: 'lower', label: 'lower' }
                      ].map(opt => (
                        <button
                          key={opt.id}
                          style={{
                            ...styles.toggleButton,
                            ...(editingOverlay.style.textCase === opt.id ? styles.toggleButtonActive : {})
                          }}
                          onClick={() => updateTextOverlay(editingTextId, { style: { ...editingOverlay.style, textCase: opt.id } })}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activePanel === 'style' && !editingOverlay && (
                <div style={{ fontSize: '12px', color: '#6b7280', textAlign: 'center', padding: '20px 0' }}>
                  Select a text overlay to edit its style.
                </div>
              )}

              {/* ── Text Bank Panel ── */}
              {activePanel === 'textBank' && (() => {
                const { textBank1, textBank2 } = getTextBanks();
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                      Text banks cycle through overlays during generation. Overlay 1 uses Bank A, Overlay 2 uses Bank B.
                    </div>

                    {/* Text Bank A */}
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#14b8a6', marginBottom: '8px' }}>
                        Text Bank A ({textBank1.length})
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                        <input
                          value={newTextA}
                          onChange={(e) => setNewTextA(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToTextBank(1, newTextA); setNewTextA(''); } }}
                          placeholder="Add text..."
                          style={styles.textBankInput}
                        />
                        <button
                          onClick={() => { if (newTextA.trim()) { handleAddToTextBank(1, newTextA); setNewTextA(''); } }}
                          style={styles.textBankAddButton}
                        >+</button>
                      </div>
                      <div style={styles.textBankList}>
                        {textBank1.map((text, i) => (
                          <div key={i} style={styles.textBankTag}>{text}</div>
                        ))}
                        {textBank1.length === 0 && <span style={{ fontSize: '11px', color: '#6b7280' }}>Empty</span>}
                      </div>
                    </div>

                    {/* Text Bank B */}
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '8px' }}>
                        Text Bank B ({textBank2.length})
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                        <input
                          value={newTextB}
                          onChange={(e) => setNewTextB(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToTextBank(2, newTextB); setNewTextB(''); } }}
                          placeholder="Add text..."
                          style={styles.textBankInput}
                        />
                        <button
                          onClick={() => { if (newTextB.trim()) { handleAddToTextBank(2, newTextB); setNewTextB(''); } }}
                          style={{ ...styles.textBankAddButton, backgroundColor: '#f59e0b' }}
                        >+</button>
                      </div>
                      <div style={styles.textBankList}>
                        {textBank2.map((text, i) => (
                          <div key={i} style={{ ...styles.textBankTag, borderColor: 'rgba(245,158,11,0.3)' }}>{text}</div>
                        ))}
                        {textBank2.length === 0 && <span style={{ fontSize: '11px', color: '#6b7280' }}>Empty</span>}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Center Preview ── */}
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
              {clip ? (
                <video
                  ref={videoRef}
                  src={getClipUrl(clip)}
                  onLoadedMetadata={handleVideoLoaded}
                  onEnded={() => { setIsPlaying(false); if (animationRef.current) cancelAnimationFrame(animationRef.current); }}
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
                  <p style={{ color: '#6b7280', marginTop: 8, fontSize: 12 }}>No clip selected</p>
                </div>
              )}

              {/* Text Overlays (rendered on top of video) */}
              {textOverlays.map((overlay) => {
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

              {/* Progress bar */}
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
        </div>

        {/* ── Tab Bar (bottom — same pattern as SlideshowEditor) ── */}
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
    maxWidth: '1100px',
    height: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
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
  saveButton: {
    padding: '6px 16px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  sidebar: {
    width: '260px',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0
  },
  panelTabs: {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0
  },
  panelTab: {
    flex: 1,
    padding: '8px 4px',
    border: 'none',
    background: 'none',
    color: '#6b7280',
    fontSize: '11px',
    fontWeight: '500',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'all 0.15s'
  },
  panelTabActive: {
    color: '#a5b4fc',
    borderBottomColor: '#6366f1'
  },
  panelContent: {
    flex: 1,
    overflow: 'auto',
    padding: '12px'
  },
  clipGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px'
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
    marginTop: '16px',
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
  addTextButton: {
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
  textOverlayItem: {
    padding: '10px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  textOverlayItemActive: {
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
    marginTop: '4px',
    outline: 'none'
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap'
  },
  controlLabel: {
    fontSize: '11px',
    color: '#9ca3af',
    minWidth: '40px'
  },
  selectInput: {
    flex: 1,
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.15)',
    backgroundColor: '#111118',
    color: '#fff',
    fontSize: '12px'
  },
  sizeButton: {
    padding: '4px 10px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: '#d1d5db',
    fontSize: '12px',
    cursor: 'pointer'
  },
  colorInput: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.15)',
    cursor: 'pointer',
    backgroundColor: 'transparent',
    padding: 0
  },
  toggleButton: {
    padding: '4px 10px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  toggleButtonActive: {
    backgroundColor: 'rgba(99,102,241,0.2)',
    borderColor: '#6366f1',
    color: '#a5b4fc'
  },
  textBankInput: {
    flex: 1,
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: '#111118',
    color: '#fff',
    fontSize: '12px',
    outline: 'none'
  },
  textBankAddButton: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#14b8a6',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
    flexShrink: 0
  },
  textBankList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px'
  },
  textBankTag: {
    padding: '3px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(20,184,166,0.3)',
    backgroundColor: 'rgba(20,184,166,0.08)',
    color: '#d1d5db',
    fontSize: '11px'
  },
  previewArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '16px',
    overflow: 'hidden'
  },
  previewContainer: {
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
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
    width: '100%',
    maxWidth: '400px'
  },
  playButton: {
    background: 'none',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    padding: '6px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.1)'
  },
  progressBar: {
    flex: 1,
    height: '4px',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: '2px',
    cursor: 'pointer',
    position: 'relative'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: '2px',
    transition: 'width 0.05s linear'
  },
  timeDisplay: {
    fontSize: '11px',
    color: '#9ca3af',
    fontVariantNumeric: 'tabular-nums',
    minWidth: '70px',
    textAlign: 'right'
  },
  muteButton: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center'
  },
  tabBar: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    padding: '10px 16px',
    backgroundColor: 'rgba(0,0,0,0.15)',
    flexShrink: 0
  },
  tabScroll: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    paddingBottom: '4px',
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(255,255,255,0.15) transparent'
  },
  tab: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#9ca3af',
    fontSize: '12px',
    fontWeight: '400',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap'
  },
  tabActive: {
    backgroundColor: '#6366f1',
    borderColor: '#818cf8',
    color: '#fff',
    fontWeight: '600'
  },
  tabDeleteButton: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: '0 0 0 4px',
    fontSize: '14px',
    lineHeight: 1
  },
  confirmOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    borderRadius: '12px'
  },
  confirmModal: {
    backgroundColor: '#1f1f2e',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '24px',
    maxWidth: '360px',
    width: '100%'
  },
  confirmKeepButton: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: 'transparent',
    color: '#d1d5db',
    fontSize: '13px',
    cursor: 'pointer'
  },
  confirmCloseButton: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default SoloClipEditor;
