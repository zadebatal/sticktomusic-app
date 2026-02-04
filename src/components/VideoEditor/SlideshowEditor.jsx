import React, { useState, useCallback, useRef, useEffect } from 'react';
import { exportSlideshowAsImages } from '../../services/slideshowExportService';
import LyricBank from './LyricBank';
import AudioClipSelector from './AudioClipSelector';
import LyricAnalyzer from './LyricAnalyzer';

/**
 * SlideshowEditor - Flowstage-style carousel/slideshow creator
 *
 * Features:
 * - Image A / Image B banks for backgrounds
 * - Lyric Bank for text overlays (with paragraph selection)
 * - Drag-and-drop to add images to slides
 * - Click-to-edit text overlays
 * - Aspect ratio options (9:16 / 4:3)
 * - Export as carousel images for Instagram/TikTok
 */

const SlideshowEditor = ({
  category,
  existingSlideshow = null,
  batchMode = false,
  onSave,
  onClose,
  onSchedulePost,
  onAddLyrics,
  lateAccountIds = {}
}) => {
  // Slideshow state
  const [name, setName] = useState(existingSlideshow?.name || 'Untitled Slideshow');
  const [aspectRatio, setAspectRatio] = useState(existingSlideshow?.aspectRatio || '9:16');
  const [slides, setSlides] = useState(existingSlideshow?.slides || []);
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0);
  const [activeBank, setActiveBank] = useState('imageA'); // 'imageA' | 'imageB' | 'audio' | 'lyrics'

  // Audio state
  const [selectedAudio, setSelectedAudio] = useState(existingSlideshow?.audio || null);
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef(null);
  const animationRef = useRef(null);

  // Text editor state
  const [editingTextId, setEditingTextId] = useState(null);
  const [textEditorPosition, setTextEditorPosition] = useState({ x: 0, y: 0 });
  const [showTextEditorPanel, setShowTextEditorPanel] = useState(false); // Flowstage-style side panel

  // AI Transcription state
  const [showLyricAnalyzer, setShowLyricAnalyzer] = useState(false);

  // Audio upload ref for slideshow
  const slideshowAudioInputRef = useRef(null);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedImages, setExportedImages] = useState(existingSlideshow?.exportedImages || []);

  // Scheduling state
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [selectedHandle, setSelectedHandle] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });
  const [isScheduling, setIsScheduling] = useState(false);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('#carousel #slideshow #fyp');

  // Available handles from lateAccountIds
  const availableHandles = Object.keys(lateAccountIds);

  // Canvas ref for rendering
  const canvasRef = useRef(null);
  const previewRef = useRef(null);

  // Get content from category's banks (separate from video banks)
  const imagesA = category?.imagesA || [];
  const imagesB = category?.imagesB || [];
  const audioTracks = category?.audio || [];
  const lyrics = category?.lyrics || [];
  const activeContent = activeBank === 'imageA' ? imagesA : activeBank === 'imageB' ? imagesB : activeBank === 'audio' ? audioTracks : [];

  // Dimensions based on aspect ratio
  const dimensions = aspectRatio === '9:16'
    ? { width: 1080, height: 1920 }
    : { width: 1080, height: 1440 };

  // Preview dimensions (scaled down)
  const previewScale = 0.25;
  const previewDimensions = {
    width: dimensions.width * previewScale,
    height: dimensions.height * previewScale
  };

  // Get current slide (defined early so callbacks can reference it)
  const currentSlide = slides[selectedSlideIndex];

  // Initialize with at least one slide, or generate batch of 10 in batch mode
  useEffect(() => {
    if (slides.length === 0) {
      if (batchMode && (imagesA.length > 0 || imagesB.length > 0)) {
        // Batch mode: Generate 10 slides randomly from A/B banks
        const allImages = [
          ...imagesA.map(img => ({ ...img, sourceBank: 'imageA' })),
          ...imagesB.map(img => ({ ...img, sourceBank: 'imageB' }))
        ];

        if (allImages.length > 0) {
          const batchSlides = [];
          for (let i = 0; i < 10; i++) {
            const randomImage = allImages[Math.floor(Math.random() * allImages.length)];
            batchSlides.push({
              id: `slide_${Date.now()}_${i}`,
              index: i,
              backgroundImage: randomImage.localUrl || randomImage.url,
              thumbnail: randomImage.localUrl || randomImage.url,
              sourceBank: randomImage.sourceBank,
              sourceImageId: randomImage.id,
              textOverlays: [],
              duration: 3
            });
          }
          setSlides(batchSlides);
          setName('Batch Slideshow ' + new Date().toLocaleTimeString());
        }
      } else {
        addSlide();
      }
    }
  }, [batchMode]);

  // Add a new slide
  const addSlide = useCallback(() => {
    const newSlide = {
      id: `slide_${Date.now()}`,
      index: slides.length,
      backgroundImage: null,
      backgroundVideo: null,
      textOverlays: [],
      duration: 3 // Default 3 seconds per slide for video export
    };
    setSlides(prev => [...prev, newSlide]);
    setSelectedSlideIndex(slides.length);
  }, [slides.length]);

  // Remove a slide
  const removeSlide = useCallback((slideId) => {
    setSlides(prev => {
      const filtered = prev.filter(s => s.id !== slideId);
      // Re-index slides
      return filtered.map((s, i) => ({ ...s, index: i }));
    });
    // Adjust selected index if needed
    if (selectedSlideIndex >= slides.length - 1) {
      setSelectedSlideIndex(Math.max(0, slides.length - 2));
    }
  }, [slides.length, selectedSlideIndex]);

  // Reorder slides
  const moveSlide = useCallback((fromIndex, toIndex) => {
    setSlides(prev => {
      const newSlides = [...prev];
      const [removed] = newSlides.splice(fromIndex, 1);
      newSlides.splice(toIndex, 0, removed);
      // Re-index
      return newSlides.map((s, i) => ({ ...s, index: i }));
    });
    setSelectedSlideIndex(toIndex);
  }, []);

  // Set background for current slide (tracks source bank for re-roll)
  const setSlideBackground = useCallback((imageUrl, thumbnail, sourceBank = null, sourceImageId = null) => {
    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? {
            ...slide,
            backgroundImage: imageUrl,
            thumbnail: thumbnail || imageUrl,
            sourceBank: sourceBank || slide.sourceBank,
            sourceImageId: sourceImageId || slide.sourceImageId
          }
        : slide
    ));
  }, [selectedSlideIndex]);

  // Re-roll: Replace current slide's image with random different image from same bank
  const handleReroll = useCallback(() => {
    if (!currentSlide?.sourceBank) return;

    const bank = currentSlide.sourceBank === 'imageA' ? imagesA : imagesB;
    const otherImages = bank.filter(img => img.id !== currentSlide.sourceImageId);

    if (otherImages.length === 0) return; // No other images available

    const randomImage = otherImages[Math.floor(Math.random() * otherImages.length)];
    setSlideBackground(
      randomImage.localUrl || randomImage.url,
      randomImage.localUrl || randomImage.url,
      currentSlide.sourceBank,
      randomImage.id
    );
  }, [currentSlide, imagesA, imagesB, setSlideBackground]);

  // Audio playback controls
  const handleSelectAudio = useCallback((audio) => {
    // Open trimmer for the selected audio
    setAudioToTrim(audio);
    setShowAudioTrimmer(true);
  }, []);

  const handleAudioTrimSave = useCallback(({ startTime, endTime, duration }) => {
    if (!audioToTrim) return;

    setSelectedAudio({
      ...audioToTrim,
      startTime,
      endTime,
      trimmedDuration: endTime - startTime,
      isTrimmed: true
    });
    setShowAudioTrimmer(false);
    setAudioToTrim(null);
  }, [audioToTrim]);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current || !selectedAudio) return;

    if (isPlaying) {
      audioRef.current.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      setIsPlaying(false);
    } else {
      const startBoundary = selectedAudio.startTime || 0;
      if (audioRef.current.currentTime < startBoundary) {
        audioRef.current.currentTime = startBoundary;
      }
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);

      // Animation loop for time updates
      const updateTime = () => {
        if (audioRef.current) {
          const startBound = selectedAudio.startTime || 0;
          const endBound = selectedAudio.endTime || audioRef.current.duration;
          const actualTime = audioRef.current.currentTime;

          setCurrentTime(actualTime - startBound);

          // Loop back if past end boundary
          if (actualTime >= endBound) {
            audioRef.current.currentTime = startBound;
          }
        }
        animationRef.current = requestAnimationFrame(updateTime);
      };
      animationRef.current = requestAnimationFrame(updateTime);
    }
  }, [isPlaying, selectedAudio]);

  const handleRemoveAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setSelectedAudio(null);
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  // Load audio when selected
  useEffect(() => {
    if (!selectedAudio || !audioRef.current) return;

    const audioUrl = selectedAudio.url || selectedAudio.localUrl;
    if (!audioUrl) return;

    audioRef.current.src = audioUrl;
    audioRef.current.load();

    audioRef.current.onloadedmetadata = () => {
      const start = selectedAudio.startTime || 0;
      const end = selectedAudio.endTime || audioRef.current.duration;
      setAudioDuration(end - start);
      audioRef.current.currentTime = start;
    };

    audioRef.current.onended = () => {
      const start = selectedAudio.startTime || 0;
      audioRef.current.currentTime = start;
    };

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [selectedAudio]);

  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle drag over
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Handle drop on canvas
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/json');
    if (data) {
      try {
        const clipData = JSON.parse(data);
        setSlideBackground(
          clipData.url || clipData.localUrl,
          clipData.thumbnail,
          clipData.sourceBank,
          clipData.id
        );
      } catch (err) {
        console.warn('Invalid drop data:', err);
      }
    }
  }, [setSlideBackground]);

  // Add text overlay to current slide
  const addTextOverlay = useCallback(() => {
    const newOverlay = {
      id: `text_${Date.now()}`,
      text: 'Click to edit',
      style: {
        fontSize: 48,
        fontFamily: "'Inter', sans-serif",
        fontWeight: '600',
        color: '#ffffff',
        textAlign: 'center',
        outline: true,
        outlineColor: 'rgba(0,0,0,0.5)'
      },
      position: {
        x: 50, // Center horizontally (%)
        y: 50, // Center vertically (%)
        width: 80,
        height: 20
      }
    };

    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
        : slide
    ));

    setEditingTextId(newOverlay.id);
  }, [selectedSlideIndex]);

  // Update text overlay
  const updateTextOverlay = useCallback((overlayId, updates) => {
    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? {
            ...slide,
            textOverlays: slide.textOverlays.map(overlay =>
              overlay.id === overlayId ? { ...overlay, ...updates } : overlay
            )
          }
        : slide
    ));
  }, [selectedSlideIndex]);

  // Remove text overlay
  const removeTextOverlay = useCallback((overlayId) => {
    setSlides(prev => prev.map((slide, i) =>
      i === selectedSlideIndex
        ? {
            ...slide,
            textOverlays: slide.textOverlays.filter(o => o.id !== overlayId)
          }
        : slide
    ));
    setEditingTextId(null);
  }, [selectedSlideIndex]);

  // Handle click on text overlay to edit
  const handleTextClick = useCallback((e, overlayId) => {
    e.stopPropagation();
    setEditingTextId(overlayId);
    setShowTextEditorPanel(true);
  }, []);

  // Handle click on slide image to open text editor panel
  const handleSlideClick = useCallback(() => {
    setShowTextEditorPanel(true);
  }, []);

  // Handle AI transcription completion - add lyrics to bank and to slide
  const handleTranscriptionComplete = useCallback((result) => {
    if (result?.text) {
      // Add text overlay with the transcribed lyrics
      const newOverlay = {
        id: `text_${Date.now()}`,
        text: result.text,
        style: {
          fontSize: 36,
          fontFamily: "'Inter', sans-serif",
          fontWeight: '600',
          color: '#ffffff',
          textAlign: 'center',
          outline: true,
          outlineColor: 'rgba(0,0,0,0.5)'
        },
        position: { x: 50, y: 50, width: 80, height: 20 }
      };
      setSlides(prev => prev.map((slide, i) =>
        i === selectedSlideIndex
          ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
          : slide
      ));
      setEditingTextId(newOverlay.id);
      setShowTextEditorPanel(true);
    }
    setShowLyricAnalyzer(false);
  }, [selectedSlideIndex]);

  // Handle audio file upload directly in slideshow editor
  const handleSlideshowAudioUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      // Open trimmer for the uploaded audio
      setAudioToTrim({ file, url, localUrl: url, name: file.name, duration: 0 });
      setShowAudioTrimmer(true);
    }
    e.target.value = '';
  }, []);

  // Save slideshow
  const handleSave = useCallback(() => {
    const slideshowData = {
      id: existingSlideshow?.id || `slideshow_${Date.now()}`,
      name,
      aspectRatio,
      slides,
      audio: selectedAudio,
      status: 'draft',
      createdAt: existingSlideshow?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onSave?.(slideshowData);
    onClose?.();
  }, [name, aspectRatio, slides, selectedAudio, existingSlideshow, onSave, onClose]);

  // Export slideshow as carousel images
  const handleExport = useCallback(async () => {
    // Check if there are slides with backgrounds
    const slidesWithContent = slides.filter(s => s.backgroundImage);
    if (slidesWithContent.length === 0) {
      alert('Please add at least one image to your slides before exporting.');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      const images = await exportSlideshowAsImages(
        { name, aspectRatio, slides },
        (progress) => setExportProgress(progress)
      );

      console.log('[Export] Complete:', images);
      setExportedImages(images);

      // Save the slideshow with export URLs
      const slideshowData = {
        id: existingSlideshow?.id || `slideshow_${Date.now()}`,
        name,
        aspectRatio,
        slides,
        status: 'rendered',
        exportedImages: images,
        createdAt: existingSlideshow?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      onSave?.(slideshowData);

      // Initialize schedule date to today
      const today = new Date();
      setScheduleDate(today.toISOString().split('T')[0]);

      // Show schedule panel if Late.co integration is available
      if (onSchedulePost && availableHandles.length > 0) {
        setShowSchedulePanel(true);
      } else {
        alert(`Successfully exported ${images.length} carousel images!`);
      }
    } catch (err) {
      console.error('[Export] Failed:', err);
      alert(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [name, aspectRatio, slides, existingSlideshow, onSave, onSchedulePost, availableHandles.length]);

  // Schedule the carousel post
  const handleSchedule = useCallback(async () => {
    if (!selectedHandle) {
      alert('Please select an account');
      return;
    }

    if (exportedImages.length === 0) {
      alert('Please export the slideshow first');
      return;
    }

    const accountMapping = lateAccountIds[selectedHandle];
    if (!accountMapping) {
      alert(`No Late.co account mapping found for ${selectedHandle}`);
      return;
    }

    setIsScheduling(true);

    try {
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`);
      const fullCaption = `${caption}\n\n${hashtags}`.trim();

      // Build platforms array
      const platformsArray = [];
      if (platforms.tiktok && accountMapping.tiktok) {
        platformsArray.push({
          platform: 'tiktok',
          accountId: accountMapping.tiktok
        });
      }
      if (platforms.instagram && accountMapping.instagram) {
        platformsArray.push({
          platform: 'instagram',
          accountId: accountMapping.instagram
        });
      }

      if (platformsArray.length === 0) {
        alert('Please select at least one platform');
        setIsScheduling(false);
        return;
      }

      // Schedule as carousel (array of image URLs)
      await onSchedulePost({
        platforms: platformsArray,
        caption: fullCaption,
        mediaUrls: exportedImages.map(img => img.url), // Carousel images
        mediaType: 'carousel',
        scheduledFor: scheduledFor.toISOString()
      });

      alert(`Successfully scheduled carousel to ${platformsArray.map(p => p.platform).join(' & ')}!`);
      setShowSchedulePanel(false);
      onClose?.();
    } catch (err) {
      console.error('[Schedule] Failed:', err);
      alert(`Scheduling failed: ${err.message}`);
    } finally {
      setIsScheduling(false);
    }
  }, [selectedHandle, exportedImages, lateAccountIds, scheduleDate, scheduleTime, caption, hashtags, platforms, onSchedulePost, onClose]);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.nameInput}
              placeholder="Slideshow name..."
            />
          </div>

          <div style={styles.headerCenter}>
            {/* Aspect Ratio Toggle */}
            <div style={styles.aspectToggle}>
              <button
                style={{
                  ...styles.aspectButton,
                  ...(aspectRatio === '9:16' ? styles.aspectButtonActive : {})
                }}
                onClick={() => setAspectRatio('9:16')}
              >
                9:16
              </button>
              <button
                style={{
                  ...styles.aspectButton,
                  ...(aspectRatio === '4:3' ? styles.aspectButtonActive : {})
                }}
                onClick={() => setAspectRatio('4:3')}
              >
                4:3
              </button>
            </div>
          </div>

          <div style={styles.headerRight}>
            <button style={styles.saveButton} onClick={handleSave}>
              Save Draft
            </button>
            <button
              style={styles.exportButton}
              onClick={handleExport}
              disabled={isExporting || slides.filter(s => s.backgroundImage).length === 0}
            >
              {isExporting ? (
                <>
                  <span style={styles.exportSpinner} />
                  Exporting {exportProgress}%
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Export Carousel
                </>
              )}
            </button>
            <button style={styles.closeButton} onClick={onClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <div style={styles.content}>
          {/* Left Panel - Content Banks */}
          <div style={styles.leftPanel}>
            <div style={styles.bankTabs}>
              <button
                style={{
                  ...styles.bankTab,
                  ...styles.bankTabTeal,
                  ...(activeBank === 'imageA' ? styles.bankTabActiveTeal : {})
                }}
                onClick={() => setActiveBank('imageA')}
              >
                Image A
              </button>
              <button
                style={{
                  ...styles.bankTab,
                  ...styles.bankTabAmber,
                  ...(activeBank === 'imageB' ? styles.bankTabActiveAmber : {})
                }}
                onClick={() => setActiveBank('imageB')}
              >
                Image B
              </button>
              <button
                style={{
                  ...styles.bankTab,
                  ...styles.bankTabGreen,
                  ...(activeBank === 'audio' ? styles.bankTabActiveGreen : {})
                }}
                onClick={() => setActiveBank('audio')}
              >
                🎵 Audio
              </button>
              <button
                style={{
                  ...styles.bankTab,
                  ...styles.bankTabPurple,
                  ...(activeBank === 'lyrics' ? styles.bankTabActivePurple : {})
                }}
                onClick={() => setActiveBank('lyrics')}
              >
                Lyrics
              </button>
            </div>

            <div style={styles.bankContent}>
              {activeBank === 'lyrics' ? (
                /* Lyric Bank Panel */
                <LyricBank
                  lyrics={lyrics}
                  onSelectText={(text) => {
                    // Add selected lyrics as text overlay to current slide
                    const newOverlay = {
                      id: `text_${Date.now()}`,
                      text: text,
                      style: {
                        fontSize: 48,
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        outline: true,
                        outlineColor: 'rgba(0,0,0,0.5)'
                      },
                      position: {
                        x: 50,
                        y: 50,
                        width: 80,
                        height: 20
                      }
                    };
                    setSlides(prev => prev.map((slide, i) =>
                      i === selectedSlideIndex
                        ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
                        : slide
                    ));
                    setEditingTextId(newOverlay.id);
                  }}
                  showAddForm={false}
                  compact={false}
                />
              ) : activeBank === 'audio' ? (
                /* Audio Bank Panel */
                audioTracks.length === 0 ? (
                  <div style={styles.emptyBank}>
                    <p>No audio tracks</p>
                    <p style={styles.emptySubtext}>Upload audio to get started</p>
                    <button
                      style={styles.uploadAudioBtn}
                      onClick={() => slideshowAudioInputRef.current?.click()}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      Add Audio
                    </button>
                  </div>
                ) : (
                  <div style={styles.audioList}>
                    {/* Selected Audio Indicator */}
                    {selectedAudio && (
                      <div style={styles.selectedAudioCard}>
                        <div style={styles.selectedAudioHeader}>
                          <span style={styles.selectedAudioIcon}>🎵</span>
                          <span style={styles.selectedAudioLabel}>Selected</span>
                        </div>
                        <div style={styles.selectedAudioName}>{selectedAudio.name}</div>
                        <div style={styles.selectedAudioDuration}>
                          {formatTime(selectedAudio.trimmedDuration || selectedAudio.duration || 0)}
                          {selectedAudio.isTrimmed && <span style={styles.trimmedBadge}>Trimmed</span>}
                        </div>
                        <button style={styles.removeAudioBtn} onClick={handleRemoveAudio}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                          Remove
                        </button>
                      </div>
                    )}
                    {/* Audio Track List */}
                    {audioTracks.map(audio => (
                      <div
                        key={audio.id}
                        style={{
                          ...styles.audioCard,
                          ...(selectedAudio?.id === audio.id ? styles.audioCardSelected : {})
                        }}
                        onClick={() => handleSelectAudio(audio)}
                      >
                        <div style={styles.audioCardIcon}>🎵</div>
                        <div style={styles.audioCardInfo}>
                          <div style={styles.audioCardName}>{audio.name}</div>
                          <div style={styles.audioCardDuration}>
                            {formatTime(audio.duration || 0)}
                          </div>
                        </div>
                        <button style={styles.audioSelectBtn}>
                          {selectedAudio?.id === audio.id ? '✓' : 'Use'}
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : activeContent.length === 0 ? (
                <div style={styles.emptyBank}>
                  <p>No images in {activeBank === 'imageA' ? 'Image A' : 'Image B'}</p>
                  <p style={styles.emptySubtext}>Upload images in the Aesthetic Home</p>
                </div>
              ) : (
                <div style={styles.clipGrid}>
                  {activeContent.map(image => (
                    <div
                      key={image.id}
                      style={styles.clipCard}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({
                          ...image,
                          url: image.localUrl || image.url,
                          thumbnail: image.localUrl || image.url,
                          sourceBank: activeBank // Track which bank this came from
                        }));
                      }}
                    >
                      <img
                        src={image.localUrl || image.url}
                        alt={image.name}
                        style={styles.clipThumbnail}
                      />
                      <span style={styles.clipName}>{image.name?.slice(0, 15) || 'Untitled'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Canvas & Filmstrip */}
          <div style={styles.rightPanel}>
            {/* Canvas Preview */}
            <div
              style={styles.canvasContainer}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div
                ref={previewRef}
                style={{
                  ...styles.canvas,
                  width: previewDimensions.width,
                  height: previewDimensions.height,
                  aspectRatio: aspectRatio === '9:16' ? '9/16' : '3/4'
                }}
              >
                {/* Background Image - Click to open text editor */}
                {currentSlide?.backgroundImage ? (
                  <img
                    src={currentSlide.backgroundImage}
                    alt="Slide background"
                    style={styles.canvasBackground}
                    onClick={handleSlideClick}
                  />
                ) : (
                  <div style={styles.canvasPlaceholder}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <path d="M21 15l-5-5L5 21"/>
                    </svg>
                    <p>Drag an image here</p>
                  </div>
                )}

                {/* Text Overlays */}
                {(currentSlide?.textOverlays || []).map(overlay => (
                  <div
                    key={overlay.id}
                    style={{
                      ...styles.textOverlay,
                      left: `${overlay.position.x}%`,
                      top: `${overlay.position.y}%`,
                      transform: 'translate(-50%, -50%)',
                      fontSize: `${overlay.style.fontSize * previewScale}px`,
                      fontFamily: overlay.style.fontFamily,
                      fontWeight: overlay.style.fontWeight,
                      color: overlay.style.color,
                      textAlign: overlay.style.textAlign,
                      textShadow: overlay.style.outline
                        ? `0 0 ${4 * previewScale}px ${overlay.style.outlineColor}`
                        : 'none',
                      cursor: 'pointer',
                      border: editingTextId === overlay.id ? '1px dashed #6366f1' : 'none',
                      padding: '4px 8px'
                    }}
                    onClick={(e) => handleTextClick(e, overlay.id)}
                  >
                    {overlay.text}
                  </div>
                ))}
              </div>

              {/* Hidden audio element */}
              <audio ref={audioRef} style={{ display: 'none' }} />

              {/* Audio Player Controls */}
              {selectedAudio && (
                <div style={styles.audioPlayerBar}>
                  <button
                    style={styles.playPauseBtn}
                    onClick={handlePlayPause}
                  >
                    {isPlaying ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1"/>
                        <rect x="14" y="4" width="4" height="16" rx="1"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21"/>
                      </svg>
                    )}
                  </button>
                  <div style={styles.audioPlayerInfo}>
                    <span style={styles.audioPlayerName}>{selectedAudio.name}</span>
                    <span style={styles.audioPlayerTime}>
                      {formatTime(currentTime)} / {formatTime(audioDuration)}
                    </span>
                  </div>
                  <div style={styles.audioProgressBar}>
                    <div
                      style={{
                        ...styles.audioProgressFill,
                        width: `${audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0}%`
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Hidden audio input for slideshow */}
              <input
                ref={slideshowAudioInputRef}
                type="file"
                accept="audio/*"
                onChange={handleSlideshowAudioUpload}
                style={{ display: 'none' }}
              />

              {/* Canvas Actions */}
              <div style={styles.canvasActions}>
                {/* Re-roll Button (only show when slide has an image) */}
                {currentSlide?.backgroundImage && currentSlide?.sourceBank && (
                  <button
                    style={styles.rerollButton}
                    onClick={handleReroll}
                    title="Replace with random image from same bank"
                    disabled={
                      (currentSlide.sourceBank === 'imageA' && imagesA.length <= 1) ||
                      (currentSlide.sourceBank === 'imageB' && imagesB.length <= 1)
                    }
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 4v6h-6"/>
                      <path d="M1 20v-6h6"/>
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/>
                      <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/>
                    </svg>
                    Reroll
                  </button>
                )}

                {/* Add Text Button */}
                <button style={styles.addTextButton} onClick={() => { addTextOverlay(); setShowTextEditorPanel(true); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Add Text
                </button>

                {/* AI Transcribe Button */}
                {selectedAudio && (
                  <button
                    style={styles.aiTranscribeButton}
                    onClick={() => setShowLyricAnalyzer(true)}
                    title="AI transcribe audio to add lyrics"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                      <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                    AI Transcribe
                  </button>
                )}

                {/* Add to Lyric Bank Button */}
                {onAddLyrics && (
                  <button
                    style={styles.addToLyricBankButton}
                    onClick={() => {
                      const text = prompt('Enter lyrics to add to bank:');
                      if (text?.trim()) {
                        onAddLyrics({
                          title: text.split('\n')[0].slice(0, 30) || 'New Lyrics',
                          content: text.trim()
                        });
                      }
                    }}
                    title="Add lyrics to your bank"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <path d="M14 2v6h6"/>
                      <line x1="12" y1="11" x2="12" y2="17"/>
                      <line x1="9" y1="14" x2="15" y2="14"/>
                    </svg>
                    + Lyric Bank
                  </button>
                )}
              </div>
            </div>

            {/* Flowstage-style Text Editor Side Panel */}
            {showTextEditorPanel && currentSlide && (
              <TextEditorPanel
                slide={currentSlide}
                editingTextId={editingTextId}
                lyrics={lyrics}
                onSelectText={(text) => {
                  // Add selected lyrics as text overlay
                  const newOverlay = {
                    id: `text_${Date.now()}`,
                    text: text,
                    style: {
                      fontSize: 36,
                      fontFamily: "'Inter', sans-serif",
                      fontWeight: '600',
                      color: '#ffffff',
                      textAlign: 'center',
                      outline: true,
                      outlineColor: 'rgba(0,0,0,0.5)'
                    },
                    position: { x: 50, y: 50, width: 80, height: 20 }
                  };
                  setSlides(prev => prev.map((slide, i) =>
                    i === selectedSlideIndex
                      ? { ...slide, textOverlays: [...slide.textOverlays, newOverlay] }
                      : slide
                  ));
                  setEditingTextId(newOverlay.id);
                }}
                onAddTextOverlay={() => {
                  addTextOverlay();
                }}
                onSelectOverlay={(overlayId) => setEditingTextId(overlayId)}
                onUpdateOverlay={(overlayId, updates) => updateTextOverlay(overlayId, updates)}
                onRemoveOverlay={(overlayId) => removeTextOverlay(overlayId)}
                onClose={() => {
                  setShowTextEditorPanel(false);
                  setEditingTextId(null);
                }}
              />
            )}

            {/* Slide Filmstrip */}
            <div style={styles.filmstrip}>
              <div style={styles.filmstripScroll}>
                {slides.map((slide, index) => (
                  <div
                    key={slide.id}
                    style={{
                      ...styles.filmstripSlide,
                      ...(index === selectedSlideIndex ? styles.filmstripSlideActive : {})
                    }}
                    onClick={() => setSelectedSlideIndex(index)}
                  >
                    {slide.backgroundImage ? (
                      <img
                        src={slide.thumbnail || slide.backgroundImage}
                        alt={`Slide ${index + 1}`}
                        style={styles.filmstripThumbnail}
                      />
                    ) : (
                      <div style={styles.filmstripEmpty}>
                        <span>{index + 1}</span>
                      </div>
                    )}
                    <button
                      style={styles.removeSlideButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSlide(slide.id);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}

                {/* Add Slide Button */}
                <button style={styles.addSlideButton} onClick={addSlide}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
              </div>

              <div style={styles.slideCount}>
                {slides.length} / 10 slides
              </div>
            </div>
          </div>
        </div>

        {/* Schedule Panel (shown after export) */}
        {showSchedulePanel && (
          <div style={styles.schedulePanel}>
            <div style={styles.schedulePanelHeader}>
              <h3 style={styles.schedulePanelTitle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Schedule Carousel
              </h3>
              <button
                style={styles.scheduleCloseBtn}
                onClick={() => setShowSchedulePanel(false)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div style={styles.scheduleGrid}>
              {/* Account Selection */}
              <div style={styles.scheduleField}>
                <label style={styles.scheduleLabel}>Account</label>
                <select
                  value={selectedHandle}
                  onChange={(e) => setSelectedHandle(e.target.value)}
                  style={styles.scheduleSelect}
                >
                  <option value="">Select account...</option>
                  {availableHandles.map(handle => (
                    <option key={handle} value={handle}>{handle}</option>
                  ))}
                </select>
              </div>

              {/* Date & Time */}
              <div style={styles.scheduleField}>
                <label style={styles.scheduleLabel}>Date</label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  style={styles.scheduleDateInput}
                />
              </div>

              <div style={styles.scheduleField}>
                <label style={styles.scheduleLabel}>Time</label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  style={styles.scheduleDateInput}
                />
              </div>

              {/* Platforms */}
              <div style={styles.scheduleField}>
                <label style={styles.scheduleLabel}>Platforms</label>
                <div style={styles.platformCheckboxes}>
                  <label style={styles.platformCheck}>
                    <input
                      type="checkbox"
                      checked={platforms.tiktok}
                      onChange={(e) => setPlatforms(p => ({ ...p, tiktok: e.target.checked }))}
                    />
                    TikTok
                  </label>
                  <label style={styles.platformCheck}>
                    <input
                      type="checkbox"
                      checked={platforms.instagram}
                      onChange={(e) => setPlatforms(p => ({ ...p, instagram: e.target.checked }))}
                    />
                    Instagram
                  </label>
                </div>
              </div>
            </div>

            {/* Caption */}
            <div style={styles.scheduleField}>
              <label style={styles.scheduleLabel}>Caption</label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                style={styles.scheduleCaptionInput}
                placeholder="Write a caption..."
                rows={2}
              />
            </div>

            {/* Hashtags */}
            <div style={styles.scheduleField}>
              <label style={styles.scheduleLabel}>Hashtags</label>
              <input
                type="text"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                style={styles.scheduleHashtagInput}
                placeholder="#hashtag1 #hashtag2..."
              />
            </div>

            {/* Preview */}
            <div style={styles.schedulePreview}>
              <span style={styles.schedulePreviewLabel}>
                {exportedImages.length} images ready to post
              </span>
              <div style={styles.schedulePreviewImages}>
                {exportedImages.slice(0, 5).map((img, i) => (
                  <img
                    key={i}
                    src={img.url}
                    alt={`Slide ${i + 1}`}
                    style={styles.schedulePreviewImg}
                  />
                ))}
                {exportedImages.length > 5 && (
                  <div style={styles.schedulePreviewMore}>
                    +{exportedImages.length - 5}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={styles.scheduleActions}>
              <button
                style={styles.scheduleSkipBtn}
                onClick={() => {
                  setShowSchedulePanel(false);
                  alert(`Exported ${exportedImages.length} images! You can schedule them later.`);
                }}
              >
                Skip for now
              </button>
              <button
                style={styles.scheduleSubmitBtn}
                onClick={handleSchedule}
                disabled={isScheduling || !selectedHandle}
              >
                {isScheduling ? 'Scheduling...' : 'Schedule Post'}
              </button>
            </div>
          </div>
        )}

        {/* AI Lyric Analyzer Modal */}
        {showLyricAnalyzer && selectedAudio && (
          <LyricAnalyzer
            audioFile={selectedAudio.file}
            audioUrl={selectedAudio.url || selectedAudio.localUrl}
            startTime={selectedAudio.startTime}
            endTime={selectedAudio.endTime}
            onComplete={handleTranscriptionComplete}
            onClose={() => setShowLyricAnalyzer(false)}
          />
        )}

        {/* Audio Trimmer Modal */}
        {showAudioTrimmer && audioToTrim && (
          <AudioClipSelector
            audioFile={audioToTrim.file}
            audioUrl={audioToTrim.url || audioToTrim.localUrl}
            audioName={audioToTrim.name}
            initialStart={audioToTrim.startTime || 0}
            initialEnd={audioToTrim.endTime || null}
            onSave={handleAudioTrimSave}
            onCancel={() => {
              setShowAudioTrimmer(false);
              setAudioToTrim(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

/**
 * TextEditorPanel - Flowstage-style side panel for text editing
 * Shows all text overlays on slide, allows editing, and pulling from lyric bank
 */
const TextEditorPanel = ({
  slide,
  editingTextId,
  lyrics = [],
  onSelectText,
  onAddTextOverlay,
  onSelectOverlay,
  onUpdateOverlay,
  onRemoveOverlay,
  onClose
}) => {
  const [showLyricPicker, setShowLyricPicker] = useState(false);
  const textOverlays = slide?.textOverlays || [];
  const selectedOverlay = textOverlays.find(o => o.id === editingTextId);

  return (
    <div style={textPanelStyles.panel}>
      {/* Panel Header */}
      <div style={textPanelStyles.header}>
        <h3 style={textPanelStyles.title}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V4h16v3M9 20h6M12 4v16"/>
          </svg>
          Text Editor
        </h3>
        <button style={textPanelStyles.closeBtn} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Text Blocks List */}
      <div style={textPanelStyles.textList}>
        <div style={textPanelStyles.sectionHeader}>
          <span>Text Blocks ({textOverlays.length})</span>
          <button style={textPanelStyles.addBtn} onClick={onAddTextOverlay}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>

        {textOverlays.length === 0 ? (
          <div style={textPanelStyles.emptyText}>
            <p>No text on this slide</p>
            <button style={textPanelStyles.addTextBtn} onClick={onAddTextOverlay}>
              + Add Text
            </button>
          </div>
        ) : (
          textOverlays.map(overlay => (
            <div
              key={overlay.id}
              style={{
                ...textPanelStyles.textBlock,
                ...(editingTextId === overlay.id ? textPanelStyles.textBlockActive : {})
              }}
              onClick={() => onSelectOverlay(overlay.id)}
            >
              <div style={textPanelStyles.textPreview}>
                {overlay.text.slice(0, 50)}{overlay.text.length > 50 ? '...' : ''}
              </div>
              <button
                style={textPanelStyles.deleteBlockBtn}
                onClick={(e) => { e.stopPropagation(); onRemoveOverlay(overlay.id); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Selected Text Editor */}
      {selectedOverlay && (
        <div style={textPanelStyles.editor}>
          <div style={textPanelStyles.sectionHeader}>Edit Text</div>

          <textarea
            value={selectedOverlay.text}
            onChange={(e) => onUpdateOverlay(selectedOverlay.id, { text: e.target.value })}
            style={textPanelStyles.textarea}
            placeholder="Enter text..."
            rows={4}
          />

          {/* Font Size */}
          <div style={textPanelStyles.control}>
            <div style={textPanelStyles.controlHeader}>
              <span>Size</span>
              <span style={textPanelStyles.controlValue}>{selectedOverlay.style.fontSize}px</span>
            </div>
            <div style={textPanelStyles.sizeButtons}>
              <button
                style={textPanelStyles.sizeBtn}
                onClick={() => onUpdateOverlay(selectedOverlay.id, {
                  style: { ...selectedOverlay.style, fontSize: Math.max(12, selectedOverlay.style.fontSize - 4) }
                })}
              >A-</button>
              <button
                style={textPanelStyles.sizeBtn}
                onClick={() => onUpdateOverlay(selectedOverlay.id, {
                  style: { ...selectedOverlay.style, fontSize: Math.min(120, selectedOverlay.style.fontSize + 4) }
                })}
              >A+</button>
            </div>
          </div>

          {/* Alignment */}
          <div style={textPanelStyles.control}>
            <span>Align</span>
            <div style={textPanelStyles.alignButtons}>
              {['left', 'center', 'right'].map(align => (
                <button
                  key={align}
                  style={{
                    ...textPanelStyles.alignBtn,
                    ...(selectedOverlay.style.textAlign === align ? textPanelStyles.alignBtnActive : {})
                  }}
                  onClick={() => onUpdateOverlay(selectedOverlay.id, {
                    style: { ...selectedOverlay.style, textAlign: align }
                  })}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {align === 'left' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></>}
                    {align === 'center' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></>}
                    {align === 'right' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></>}
                  </svg>
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div style={textPanelStyles.control}>
            <span>Color</span>
            <input
              type="color"
              value={selectedOverlay.style.color}
              onChange={(e) => onUpdateOverlay(selectedOverlay.id, {
                style: { ...selectedOverlay.style, color: e.target.value }
              })}
              style={textPanelStyles.colorPicker}
            />
          </div>
        </div>
      )}

      {/* Pull from Lyric Bank Section */}
      <div style={textPanelStyles.lyricSection}>
        <button
          style={textPanelStyles.lyricBankBtn}
          onClick={() => setShowLyricPicker(!showLyricPicker)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <path d="M14 2v6h6"/>
          </svg>
          Pull from Lyric Bank
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto', transform: showLyricPicker ? 'rotate(180deg)' : 'none' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {showLyricPicker && (
          <div style={textPanelStyles.lyricPicker}>
            {lyrics.length === 0 ? (
              <div style={textPanelStyles.noLyrics}>No lyrics in bank</div>
            ) : (
              lyrics.map(lyric => (
                <div key={lyric.id} style={textPanelStyles.lyricItem}>
                  <div style={textPanelStyles.lyricTitle}>{lyric.title}</div>
                  <div style={textPanelStyles.lyricPreview}>
                    {lyric.content.split('\n').slice(0, 2).join(' / ')}
                  </div>
                  <button
                    style={textPanelStyles.useLyricBtn}
                    onClick={() => {
                      onSelectText(lyric.content);
                      setShowLyricPicker(false);
                    }}
                  >
                    Use
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Styles
const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modal: {
    width: '95vw',
    height: '95vh',
    backgroundColor: '#0f0f1a',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: '#1a1a2e'
  },
  headerLeft: {
    flex: 1
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  nameInput: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#fff',
    fontSize: '18px',
    fontWeight: '600',
    outline: 'none',
    width: '300px'
  },
  aspectToggle: {
    display: 'flex',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '8px',
    padding: '4px'
  },
  aspectButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s'
  },
  aspectButtonActive: {
    backgroundColor: '#6366f1',
    color: '#fff'
  },
  saveButton: {
    padding: '10px 24px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  exportButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 24px',
    backgroundColor: '#059669',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'opacity 0.2s'
  },
  exportSpinner: {
    width: '14px',
    height: '14px',
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  closeButton: {
    padding: '8px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  content: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  leftPanel: {
    width: '300px',
    borderRight: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#16162a'
  },
  bankTabs: {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.1)'
  },
  bankTab: {
    flex: 1,
    padding: '12px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  bankTabActive: {
    color: '#fff',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderBottom: '2px solid #6366f1'
  },
  // Colored tab variants
  bankTabTeal: {
    color: '#5eead4'
  },
  bankTabActiveTeal: {
    color: '#14b8a6',
    backgroundColor: 'rgba(20, 184, 166, 0.15)',
    borderBottom: '2px solid #14b8a6'
  },
  bankTabAmber: {
    color: '#fcd34d'
  },
  bankTabActiveAmber: {
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderBottom: '2px solid #f59e0b'
  },
  bankTabPurple: {
    color: '#c4b5fd'
  },
  bankTabActivePurple: {
    color: '#a78bfa',
    backgroundColor: 'rgba(167, 139, 250, 0.15)',
    borderBottom: '2px solid #a78bfa'
  },
  bankTabGreen: {
    color: '#86efac'
  },
  bankTabActiveGreen: {
    color: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderBottom: '2px solid #22c55e'
  },
  bankContent: {
    flex: 1,
    overflow: 'auto',
    padding: '12px'
  },
  emptyBank: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    color: '#6b7280',
    textAlign: 'center'
  },
  emptySubtext: {
    fontSize: '12px',
    marginTop: '8px',
    color: '#4b5563'
  },
  clipGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px'
  },
  clipCard: {
    aspectRatio: '1',
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'grab',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column'
  },
  clipThumbnail: {
    width: '100%',
    height: '80%',
    objectFit: 'cover'
  },
  clipPlaceholder: {
    width: '100%',
    height: '80%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4b5563'
  },
  clipName: {
    padding: '4px 8px',
    fontSize: '11px',
    color: '#9ca3af',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  rightPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    gap: '16px'
  },
  canvasContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px'
  },
  canvas: {
    backgroundColor: '#000',
    borderRadius: '12px',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
  },
  canvasBackground: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  canvasPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4b5563',
    gap: '12px'
  },
  textOverlay: {
    position: 'absolute',
    userSelect: 'none'
  },
  canvasActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  addTextButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid rgba(99, 102, 241, 0.5)',
    borderRadius: '8px',
    color: '#a5b4fc',
    cursor: 'pointer',
    fontSize: '13px'
  },
  rerollButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    border: '1px solid rgba(16, 185, 129, 0.5)',
    borderRadius: '8px',
    color: '#6ee7b7',
    cursor: 'pointer',
    fontSize: '13px'
  },
  addToLyricBankButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    border: '1px solid rgba(139, 92, 246, 0.5)',
    borderRadius: '8px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '13px'
  },
  aiTranscribeButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    border: '1px solid rgba(251, 191, 36, 0.5)',
    borderRadius: '8px',
    color: '#fcd34d',
    cursor: 'pointer',
    fontSize: '13px'
  },
  uploadAudioBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    marginTop: '12px',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    border: '1px solid rgba(34, 197, 94, 0.5)',
    borderRadius: '8px',
    color: '#22c55e',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  filmstrip: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    paddingTop: '16px'
  },
  filmstripScroll: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    paddingBottom: '8px'
  },
  filmstripSlide: {
    width: '80px',
    height: '120px',
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'pointer',
    border: '2px solid transparent',
    flexShrink: 0,
    position: 'relative'
  },
  filmstripSlideActive: {
    border: '2px solid #6366f1'
  },
  filmstripThumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  filmstripEmpty: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4b5563',
    fontSize: '18px',
    fontWeight: '600'
  },
  removeSlideButton: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    width: '20px',
    height: '20px',
    backgroundColor: 'rgba(239, 68, 68, 0.8)',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    transition: 'opacity 0.2s'
  },
  addSlideButton: {
    width: '80px',
    height: '120px',
    backgroundColor: 'transparent',
    border: '2px dashed rgba(255,255,255,0.2)',
    borderRadius: '8px',
    cursor: 'pointer',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#6b7280',
    transition: 'all 0.2s'
  },
  slideCount: {
    fontSize: '12px',
    color: '#6b7280',
    textAlign: 'center'
  },
  // Schedule Panel Styles
  schedulePanel: {
    position: 'absolute',
    bottom: '80px',
    right: '24px',
    width: '360px',
    backgroundColor: '#1a1a2e',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '20px',
    zIndex: 100
  },
  schedulePanelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  schedulePanelTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff'
  },
  scheduleCloseBtn: {
    padding: '4px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '4px'
  },
  scheduleGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '12px'
  },
  scheduleField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '8px'
  },
  scheduleLabel: {
    fontSize: '11px',
    fontWeight: '500',
    color: '#9ca3af',
    textTransform: 'uppercase'
  },
  scheduleSelect: {
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer'
  },
  scheduleDateInput: {
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px'
  },
  platformCheckboxes: {
    display: 'flex',
    gap: '12px'
  },
  platformCheck: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#e4e4e7',
    cursor: 'pointer'
  },
  scheduleCaptionInput: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    resize: 'none'
  },
  scheduleHashtagInput: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#a78bfa',
    fontSize: '13px'
  },
  schedulePreview: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px'
  },
  schedulePreviewLabel: {
    fontSize: '12px',
    color: '#9ca3af',
    display: 'block',
    marginBottom: '8px'
  },
  schedulePreviewImages: {
    display: 'flex',
    gap: '4px'
  },
  schedulePreviewImg: {
    width: '48px',
    height: '64px',
    objectFit: 'cover',
    borderRadius: '6px'
  },
  schedulePreviewMore: {
    width: '48px',
    height: '64px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    color: '#9ca3af'
  },
  scheduleActions: {
    display: 'flex',
    gap: '12px',
    marginTop: '16px'
  },
  scheduleSkipBtn: {
    flex: 1,
    padding: '10px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    color: '#9ca3af',
    fontSize: '14px',
    cursor: 'pointer'
  },
  scheduleSubmitBtn: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#22c55e',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  // Audio styles
  audioList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  selectedAudioCard: {
    padding: '12px',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '10px',
    marginBottom: '8px'
  },
  selectedAudioHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '6px'
  },
  selectedAudioIcon: {
    fontSize: '14px'
  },
  selectedAudioLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#22c55e',
    textTransform: 'uppercase'
  },
  selectedAudioName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#fff',
    marginBottom: '4px'
  },
  selectedAudioDuration: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#9ca3af'
  },
  trimmedBadge: {
    fontSize: '10px',
    padding: '2px 6px',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    color: '#22c55e',
    borderRadius: '4px'
  },
  removeAudioBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginTop: '8px',
    padding: '6px 10px',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '6px',
    color: '#f87171',
    fontSize: '12px',
    cursor: 'pointer'
  },
  audioCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  audioCardSelected: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.3)'
  },
  audioCardIcon: {
    fontSize: '20px'
  },
  audioCardInfo: {
    flex: 1,
    minWidth: 0
  },
  audioCardName: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  audioCardDuration: {
    fontSize: '11px',
    color: '#6b7280'
  },
  audioSelectBtn: {
    padding: '4px 10px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '4px',
    color: '#a5b4fc',
    fontSize: '11px',
    cursor: 'pointer'
  },
  audioPlayerBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.2)',
    borderRadius: '10px',
    marginBottom: '8px'
  },
  playPauseBtn: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22c55e',
    border: 'none',
    borderRadius: '50%',
    color: '#fff',
    cursor: 'pointer'
  },
  audioPlayerInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  audioPlayerName: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#fff'
  },
  audioPlayerTime: {
    fontSize: '11px',
    color: '#86efac',
    fontFamily: 'monospace'
  },
  audioProgressBar: {
    width: '100px',
    height: '4px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  audioProgressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    transition: 'width 0.1s linear'
  }
};

// Flowstage-style Text Editor Panel Styles
const textPanelStyles = {
  panel: {
    position: 'absolute',
    right: '24px',
    top: '24px',
    width: '320px',
    maxHeight: 'calc(100% - 180px)',
    backgroundColor: '#1a1a2e',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 100
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)' // Red tint like Flowstage
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#f87171'
  },
  closeBtn: {
    padding: '6px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '6px',
    transition: 'background 0.2s'
  },
  textList: {
    padding: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.1)'
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase'
  },
  addBtn: {
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: 'none',
    borderRadius: '6px',
    color: '#a5b4fc',
    cursor: 'pointer'
  },
  emptyText: {
    textAlign: 'center',
    padding: '20px',
    color: '#6b7280'
  },
  addTextBtn: {
    marginTop: '12px',
    padding: '8px 16px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '8px',
    color: '#a5b4fc',
    cursor: 'pointer',
    fontSize: '13px'
  },
  textBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    marginBottom: '8px',
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.2s'
  },
  textBlockActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)'
  },
  textPreview: {
    flex: 1,
    fontSize: '13px',
    color: '#e4e4e7',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  deleteBlockBtn: {
    padding: '4px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    opacity: 0.6,
    transition: 'opacity 0.2s'
  },
  editor: {
    padding: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  textarea: {
    width: '100%',
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    resize: 'none',
    outline: 'none',
    marginBottom: '12px',
    fontFamily: 'inherit'
  },
  control: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
    fontSize: '13px',
    color: '#9ca3af'
  },
  controlHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  controlValue: {
    fontSize: '12px',
    color: '#6b7280'
  },
  sizeButtons: {
    display: 'flex',
    gap: '4px'
  },
  sizeBtn: {
    padding: '6px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: 'none',
    borderRadius: '4px',
    color: '#e4e4e7',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600'
  },
  alignButtons: {
    display: 'flex',
    gap: '4px'
  },
  alignBtn: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: 'none',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer'
  },
  alignBtnActive: {
    backgroundColor: '#ef4444',
    color: '#fff'
  },
  colorPicker: {
    width: '32px',
    height: '32px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    padding: 0
  },
  lyricSection: {
    padding: '16px'
  },
  lyricBankBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 16px',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: '10px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  lyricPicker: {
    marginTop: '12px',
    maxHeight: '200px',
    overflowY: 'auto'
  },
  noLyrics: {
    padding: '16px',
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '13px'
  },
  lyricItem: {
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    marginBottom: '8px'
  },
  lyricTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#e4e4e7',
    marginBottom: '4px'
  },
  lyricPreview: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '8px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  useLyricBtn: {
    padding: '6px 12px',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: '6px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '12px'
  }
};

// Add hover effect for remove button and animations
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  .slideshow-filmstrip-slide:hover .slideshow-remove-btn {
    opacity: 1 !important;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;
document.head.appendChild(styleSheet);

export default SlideshowEditor;
