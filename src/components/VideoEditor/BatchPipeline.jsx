import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { renderPreview } from '../../services/videoExportService';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import { isValidBankName, generateBatchPostContent, getBankNames } from '../../utils/captionGenerator';
import { VIDEO_STATUS } from '../../utils/status';
import PreviewPlayer from './PreviewPlayer';

/**
 * BatchPipeline - Streamlined workflow for batch video creation and scheduling
 *
 * Features:
 * - Select All / Deselect All for clips
 * - Beat-synced cuts with granular options (every beat, 2 and 4, etc.)
 * - Preview first video before batch render
 * - Text overlay with saved lyrics
 * - Caption templates per category
 * - Category default presets
 */

const STAGES = {
  OPTIONS: 'options',
  PREVIEW: 'preview',
  GENERATING: 'generating',
  VIDEO_BANK: 'video_bank'  // View/edit videos then save as drafts
};

// Beat cut patterns - mirrors the singular editor's beat selector
const BEAT_PATTERNS = [
  { id: 'every', label: 'Every beat', description: 'Cut on every beat (fast)', beats: [1] },
  { id: '2-4', label: '2 and 4', description: 'Cut on beats 2 and 4 (groovy)', beats: [2, 4] },
  { id: '1-3', label: '1 and 3', description: 'Cut on beats 1 and 3', beats: [1, 3] },
  { id: 'every-2', label: 'Every 2 beats', description: 'Cut every other beat', beats: [1], interval: 2 },
  { id: 'every-4', label: 'Every 4 beats', description: 'Cut every measure (slower)', beats: [1], interval: 4 },
  { id: 'every-8', label: 'Every 8 beats', description: 'Cut every 2 measures (slowest)', beats: [1], interval: 8 }
];

/**
 * ClipThumbnail - Shows thumbnail or video preview
 * Uses autoplay+pause trick to force first frame render in modal context
 */
const ClipThumbnail = ({ clip, style }) => {
  const videoRef = useRef(null);

  // Prefer cloud URL over blob URLs (blob URLs expire between sessions)
  // Only use localUrl if it's NOT a blob URL
  const localUrl = clip.localUrl;
  const isBlobUrl = localUrl && localUrl.startsWith('blob:');
  const videoUrl = isBlobUrl ? clip.url : (localUrl || clip.url);

  // Force first frame render when video loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    const forceFirstFrame = () => {
      // Seek to 0.1s to trigger frame decode, then pause
      video.currentTime = 0.1;
      video.pause();
    };

    // Try multiple events to ensure frame renders
    video.addEventListener('loadeddata', forceFirstFrame);
    video.addEventListener('canplay', forceFirstFrame);

    // Fallback: if video is already loaded, force frame now
    if (video.readyState >= 2) {
      forceFirstFrame();
    }

    return () => {
      video.removeEventListener('loadeddata', forceFirstFrame);
      video.removeEventListener('canplay', forceFirstFrame);
    };
  }, [videoUrl]);

  // If stored thumbnail exists, use it
  if (clip.thumbnail) {
    return <img src={clip.thumbnail} alt="" style={{ ...style, objectFit: 'cover' }} />;
  }

  // Video element with preload and autoplay tricks
  if (videoUrl) {
    return (
      <video
        ref={videoRef}
        src={videoUrl}
        style={{ ...style, objectFit: 'cover', background: '#27272a' }}
        muted
        playsInline
        preload="auto"
        onMouseEnter={(e) => {
          const playPromise = e.target.play();
          if (playPromise) playPromise.catch(() => {});
        }}
        onMouseLeave={(e) => {
          if (!e.target.paused) e.target.pause();
          e.target.currentTime = 0.1;
        }}
      />
    );
  }

  // No media fallback
  return (
    <div style={{
      ...style,
      background: 'linear-gradient(135deg, #3f3f46 0%, #27272a 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#71717a',
      fontSize: '24px'
    }}>
      🎬
    </div>
  );
};

const BatchPipeline = ({
  category,
  lateAccountIds = {},
  onSchedulePost,
  onClose,
  onVideosCreated,
  onSaveLyrics,
  onEditVideo,           // Open video in full editor
  onNavigateToLibrary,   // Navigate to content library
  initialWords = null,   // Word timings from editor (applies to all batch videos)
  initialTextStyle = null // Text style from editor (applies to all batch videos)
}) => {
  // Stage management
  const [stage, setStage] = useState(STAGES.OPTIONS);
  const [error, setError] = useState(null);

  // Options stage
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedClips, setSelectedClips] = useState([]);
  const [quantity, setQuantity] = useState(5);
  const [clipStrategy, setClipStrategy] = useState('beat');
  const [beatPattern, setBeatPattern] = useState('every-2'); // Default: every 2 beats

  // Text overlay options
  // Auto-enable if initialWords are provided from editor
  const [useTextOverlay, setUseTextOverlay] = useState(initialWords?.length > 0);
  const [selectedLyrics, setSelectedLyrics] = useState(null);
  // Track if we're using initial settings from editor
  const [usingInitialSettings, setUsingInitialSettings] = useState(initialWords?.length > 0);

  // Beat detection
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();

  // Generation progress
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, status: '' });

  // Preview state
  const [previewBlob, setPreviewBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  // Generated videos
  const [generatedVideos, setGeneratedVideos] = useState([]);
  const [playingVideoId, setPlayingVideoId] = useState(null);  // Track which video is playing

  // Captions for generated videos
  const [captions, setCaptions] = useState([]);

  // Caption bank state
  const [showBankWarning, setShowBankWarning] = useState(false);
  const hasCaptionBank = useMemo(() => {
    return isValidBankName(category?.name);
  }, [category?.name]);

  // Category settings - use bank if available, otherwise fallback to category templates
  const captionTemplate = category?.captionTemplate || '{title} ✨ {hashtags}';
  const defaultHashtags = category?.defaultHashtags || '#viral #fyp';
  const accountHandle = category?.accountHandle;
  const accountMapping = accountHandle ? lateAccountIds[accountHandle] : null;

  // Available clips and audio
  const availableClips = category?.videos || [];
  const availableAudio = category?.audio || [];

  // DEBUG: Log state on every render
  console.log('[BatchPipeline] Render state:', {
    selectedAudio: selectedAudio ? { id: selectedAudio.id, name: selectedAudio.name } : null,
    selectedClipsCount: selectedClips.length,
    availableClipsCount: availableClips.length,
    availableAudioCount: availableAudio.length,
    disabledCondition: !selectedAudio || selectedClips.length < 2
  });

  // Saved lyrics for selected audio
  const savedLyricsForAudio = useMemo(() => {
    if (!selectedAudio) return [];
    return selectedAudio.savedLyrics || [];
  }, [selectedAudio]);

  // Auto-select audio if only one option (better UX)
  useEffect(() => {
    if (!selectedAudio && availableAudio.length === 1) {
      console.log('[BatchPipeline] Auto-selecting single audio option');
      setSelectedAudio(availableAudio[0]);
    }
  }, [availableAudio, selectedAudio]);

  // Analyze beats when audio is selected
  useEffect(() => {
    if (selectedAudio) {
      // Determine the best audio source for beat detection
      // Priority: File object > non-blob URL > cloud URL
      let audioSource = null;

      if (selectedAudio.file instanceof File || selectedAudio.file instanceof Blob) {
        audioSource = selectedAudio.file;
        console.log('[BatchPipeline] Using file object for beat detection');
      } else if (selectedAudio.localUrl && !selectedAudio.localUrl.startsWith('blob:')) {
        audioSource = selectedAudio.localUrl;
        console.log('[BatchPipeline] Using localUrl for beat detection:', audioSource?.substring(0, 50));
      } else if (selectedAudio.url) {
        audioSource = selectedAudio.url;
        console.log('[BatchPipeline] Using cloud URL for beat detection:', audioSource?.substring(0, 50));
      }

      if (audioSource) {
        analyzeAudio(audioSource).catch(err => {
          console.warn('Beat analysis failed:', err);
        });
      } else {
        console.warn('[BatchPipeline] No valid audio source for beat detection:', selectedAudio);
      }
    }
  }, [selectedAudio, analyzeAudio]);

  // Select All / Deselect All
  const handleSelectAll = useCallback(() => {
    console.log('[BatchPipeline] Select All clicked:', {
      currentSelected: selectedClips.length,
      available: availableClips.length
    });
    if (selectedClips.length === availableClips.length) {
      setSelectedClips([]);
    } else {
      setSelectedClips([...availableClips]);
    }
  }, [selectedClips.length, availableClips]);

  // Toggle clip selection
  const toggleClip = useCallback((clip) => {
    setSelectedClips(prev => {
      const exists = prev.find(c => c.id === clip.id);
      if (exists) {
        return prev.filter(c => c.id !== clip.id);
      }
      return [...prev, clip];
    });
  }, []);

  // Generate clip sequence based on strategy and beat pattern
  const generateClipSequence = useCallback((audioDuration, clipPool, strategy) => {
    const clips = [];
    let currentTime = 0;

    if (strategy === 'beat' && beats.length > 0) {
      const audioStart = selectedAudio?.startTime || 0;
      const audioEnd = selectedAudio?.endTime || audioDuration + audioStart;

      // Filter beats to trimmed range and normalize to local time
      const trimmedBeats = beats
        .filter(b => b >= audioStart && b <= audioEnd)
        .map(b => b - audioStart);

      if (trimmedBeats.length === 0) {
        // No beats, fall back to even distribution
        const numClips = Math.min(clipPool.length, 8);
        const clipDuration = audioDuration / numClips;
        for (let i = 0; i < numClips; i++) {
          clips.push({
            id: `clip_${Date.now()}_${i}`,
            sourceId: clipPool[i % clipPool.length].id,
            url: clipPool[i % clipPool.length].url,
            localUrl: clipPool[i % clipPool.length].localUrl,
            thumbnail: clipPool[i % clipPool.length].thumbnail,
            startTime: i * clipDuration,
            duration: clipDuration,
            locked: false
          });
        }
        return clips;
      }

      // Get the selected beat pattern
      const pattern = BEAT_PATTERNS.find(p => p.id === beatPattern) || BEAT_PATTERNS[0];

      // Calculate cut points based on pattern
      const cutPoints = [0]; // Always start at 0

      if (pattern.interval) {
        // Every N beats pattern
        for (let i = pattern.interval; i < trimmedBeats.length; i += pattern.interval) {
          cutPoints.push(trimmedBeats[i]);
        }
      } else {
        // Specific beat pattern (e.g., 2 and 4)
        // Assuming 4/4 time signature, group beats into measures
        const beatsPerMeasure = 4;
        for (let measureStart = 0; measureStart < trimmedBeats.length; measureStart += beatsPerMeasure) {
          for (const beatNum of pattern.beats) {
            const beatIndex = measureStart + beatNum - 1;
            if (beatIndex < trimmedBeats.length && trimmedBeats[beatIndex] > cutPoints[cutPoints.length - 1]) {
              cutPoints.push(trimmedBeats[beatIndex]);
            }
          }
        }
      }

      // Add end point
      cutPoints.push(audioDuration);

      // Create clips from cut points
      for (let i = 0; i < cutPoints.length - 1; i++) {
        const clipStartTime = cutPoints[i];
        const clipEndTime = cutPoints[i + 1];
        const clipDuration = clipEndTime - clipStartTime;

        if (clipDuration < 0.1) continue; // Skip very short clips

        const sourceClip = clipPool[clips.length % clipPool.length];
        clips.push({
          id: `clip_${Date.now()}_${clips.length}`,
          sourceId: sourceClip.id,
          url: sourceClip.url,
          localUrl: sourceClip.localUrl,
          thumbnail: sourceClip.thumbnail,
          startTime: clipStartTime,
          duration: clipDuration,
          locked: false
        });
      }
    } else if (strategy === 'random') {
      const shuffled = [...clipPool].sort(() => Math.random() - 0.5);
      const numClips = Math.min(shuffled.length, 8);
      const clipDuration = audioDuration / numClips;

      for (let i = 0; i < numClips; i++) {
        clips.push({
          id: `clip_${Date.now()}_${i}`,
          sourceId: shuffled[i].id,
          url: shuffled[i].url,
          localUrl: shuffled[i].localUrl,
          thumbnail: shuffled[i].thumbnail,
          startTime: i * clipDuration,
          duration: clipDuration,
          locked: false
        });
      }
    } else {
      // Sequential
      const numClips = Math.min(clipPool.length, 8);
      const clipDuration = audioDuration / numClips;

      for (let i = 0; i < numClips; i++) {
        const sourceClip = clipPool[i % clipPool.length];
        clips.push({
          id: `clip_${Date.now()}_${i}`,
          sourceId: sourceClip.id,
          url: sourceClip.url,
          localUrl: sourceClip.localUrl,
          thumbnail: sourceClip.thumbnail,
          startTime: i * clipDuration,
          duration: clipDuration,
          locked: false
        });
      }
    }

    return clips;
  }, [beats, beatPattern, selectedAudio]);

  // Generate preview
  const handleGeneratePreview = useCallback(async () => {
    if (!selectedAudio || selectedClips.length < 2) {
      setError('Select audio and at least 2 clips');
      return;
    }

    setIsGeneratingPreview(true);
    setError(null);

    try {
      const audioDuration = selectedAudio.endTime
        ? selectedAudio.endTime - (selectedAudio.startTime || 0)
        : selectedAudio.duration || 30;

      console.log('[BatchPipeline] Generating preview with duration:', audioDuration);

      const clips = generateClipSequence(audioDuration, selectedClips, clipStrategy);
      console.log('[BatchPipeline] Generated clips:', clips.length);

      // Determine words: prioritize initialWords from editor, then selected lyrics, then empty
      const wordsToUse = useTextOverlay
        ? (usingInitialSettings && initialWords?.length > 0
            ? initialWords
            : (selectedLyrics?.words || []))
        : [];

      // Determine textStyle: prioritize initialTextStyle from editor, then category default
      const textStyleToUse = (usingInitialSettings && initialTextStyle)
        ? initialTextStyle
        : (category?.defaultPreset?.textStyle || {
            fontSize: 48,
            fontFamily: 'Inter, sans-serif',
            fontWeight: '600',
            color: '#ffffff',
            outline: true,
            outlineColor: '#000000'
          });

      const videoData = {
        id: `preview_${Date.now()}`,
        title: `${category.name} Preview`,
        clips,
        audio: selectedAudio,
        words: wordsToUse,
        textStyle: textStyleToUse,
        cropMode: '9:16',
        duration: Math.min(audioDuration, 10)
      };

      console.log('[BatchPipeline] Rendering preview...');
      const blob = await renderPreview(videoData, (p) => {
        setGenerationProgress({ current: 1, total: 1, status: `Generating preview... ${p}%` });
      });

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewBlob(blob);
      setPreviewUrl(url);
      setStage(STAGES.PREVIEW);

    } catch (err) {
      console.error('[BatchPipeline] Preview generation failed:', err);
      setError(`Preview failed: ${err.message}`);
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [selectedAudio, selectedClips, clipStrategy, generateClipSequence, useTextOverlay, selectedLyrics, category, previewUrl, usingInitialSettings, initialWords, initialTextStyle]);

  // Generate all video RECIPES (instant - no rendering!)
  const handleGenerate = useCallback(async () => {
    if (!selectedAudio) {
      setError('Please select an audio track');
      return;
    }
    if (selectedClips.length < 2) {
      setError('Please select at least 2 video clips');
      return;
    }

    // INSTANT - no rendering, just create recipes!
    setError(null);
    setGeneratedVideos([]);

    const videos = [];
    const audioDuration = selectedAudio.endTime
      ? selectedAudio.endTime - (selectedAudio.startTime || 0)
      : selectedAudio.duration || 30;

    console.log('[BatchPipeline] Creating video recipes (instant!)');
    console.log('[BatchPipeline] Audio duration:', audioDuration);
    console.log('[BatchPipeline] Selected clips:', selectedClips.length);

    for (let i = 0; i < quantity; i++) {
      // Generate clip sequence with variation
      // ALWAYS shuffle the clip pool for variety between videos
      let clipPool = [...selectedClips].sort(() => Math.random() - 0.5);

      // For sequential mode, also apply rotation offset
      if (clipStrategy === 'sequential') {
        const offset = i % clipPool.length;
        clipPool = [...clipPool.slice(offset), ...clipPool.slice(0, offset)];
      }

      const clips = generateClipSequence(audioDuration, clipPool, clipStrategy);
      console.log(`[BatchPipeline] Video ${i + 1} recipe: ${clips.length} clips`);

      // Generate caption - use bank if available, otherwise use template
      let caption, hashtags;
      if (hasCaptionBank) {
        const postContent = generateBatchPostContent(category.name, 1)[0];
        caption = postContent.fullText;
        hashtags = postContent.hashtagString;
      } else {
        // Fallback to template-based caption
        caption = captionTemplate
          .replace('{title}', category.name)
          .replace('{hashtags}', defaultHashtags)
          .replace('{index}', String(i + 1));
        hashtags = defaultHashtags;
      }

      // Determine words: prioritize initialWords from editor, then selected lyrics
      const wordsForVideo = useTextOverlay
        ? (usingInitialSettings && initialWords?.length > 0
            ? initialWords
            : (selectedLyrics?.words || []))
        : [];

      // Determine textStyle: prioritize initialTextStyle from editor, then category default
      const textStyleForVideo = (usingInitialSettings && initialTextStyle)
        ? initialTextStyle
        : (category?.defaultPreset?.textStyle || {
            fontSize: 48,
            fontFamily: 'Inter, sans-serif',
            fontWeight: '600',
            color: '#ffffff',
            outline: true,
            outlineColor: '#000000'
          });

      // Create video RECIPE (not rendered yet!)
      const videoRecipe = {
        id: `batch_${Date.now()}_${i}`,
        title: `${category.name} ${i + 1}`,
        clips,
        audio: selectedAudio,
        words: wordsForVideo,
        textStyle: textStyleForVideo,
        cropMode: '9:16',
        duration: audioDuration,
        caption,
        hashtags,
        // Mark as draft - not rendered yet
        status: VIDEO_STATUS.DRAFT,
        isRendered: false,  // Flag to indicate this needs rendering
        cloudUrl: null,     // Will be set after rendering
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      videos.push(videoRecipe);
    }

    console.log(`[BatchPipeline] Created ${videos.length} video recipes instantly!`);
    setGeneratedVideos(videos);
    setCaptions(videos.map(v => v.caption));
    setStage(STAGES.VIDEO_BANK);  // Go to video bank to preview
  }, [selectedAudio, selectedClips, quantity, clipStrategy, generateClipSequence, useTextOverlay, selectedLyrics, category, captionTemplate, defaultHashtags, hasCaptionBank, usingInitialSettings, initialWords, initialTextStyle]);

  // Save videos as drafts to library
  const handleSaveAsDrafts = useCallback(() => {
    if (generatedVideos.length === 0) return;

    // Update videos with current captions from state
    const videosWithCaptions = generatedVideos.map((video, idx) => ({
      ...video,
      caption: captions[idx] || video.caption,
      status: VIDEO_STATUS.DRAFT
    }));

    // Save to category's createdVideos
    if (onVideosCreated) {
      onVideosCreated(videosWithCaptions);
    }

    // Navigate to library to view drafts
    if (onNavigateToLibrary) {
      onNavigateToLibrary();
    }

    onClose();
  }, [generatedVideos, captions, onVideosCreated, onNavigateToLibrary, onClose]);

  // Handle click on video to edit
  const handleEditVideoClick = useCallback((video, index) => {
    // Update video with current caption before editing
    const videoToEdit = {
      ...video,
      caption: captions[index] || video.caption
    };

    if (onEditVideo) {
      onEditVideo(videoToEdit);
      onClose();
    }
  }, [captions, onEditVideo, onClose]);

  // Update caption
  const updateCaption = useCallback((index, value) => {
    setCaptions(prev => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Styles
  const styles = {
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.9)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: '20px'
    },
    modal: {
      background: '#18181b',
      borderRadius: '16px',
      width: '100%',
      maxWidth: '900px',
      maxHeight: '90vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    },
    header: {
      padding: '20px 24px',
      borderBottom: '1px solid #27272a',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    title: {
      margin: 0,
      fontSize: '20px',
      fontWeight: '600',
      color: 'white'
    },
    closeBtn: {
      background: 'none',
      border: 'none',
      color: '#71717a',
      fontSize: '24px',
      cursor: 'pointer'
    },
    content: {
      padding: '24px',
      overflowY: 'auto',
      flex: 1
    },
    section: {
      marginBottom: '24px'
    },
    sectionHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px'
    },
    sectionTitle: {
      fontSize: '14px',
      fontWeight: '600',
      color: '#a1a1aa',
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    },
    selectAllBtn: {
      padding: '6px 12px',
      background: '#27272a',
      border: '1px solid #3f3f46',
      borderRadius: '6px',
      color: '#e4e4e7',
      fontSize: '12px',
      cursor: 'pointer'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
      gap: '8px'
    },
    clipCard: (selected) => ({
      position: 'relative',
      aspectRatio: '9/16',
      borderRadius: '8px',
      overflow: 'hidden',
      cursor: 'pointer',
      border: selected ? '3px solid #8b5cf6' : '2px solid #3f3f46',
      opacity: selected ? 1 : 0.7,
      transition: 'all 0.15s'
    }),
    clipThumb: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block'
    },
    clipCheck: {
      position: 'absolute',
      top: '4px',
      right: '4px',
      width: '20px',
      height: '20px',
      background: '#8b5cf6',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontSize: '12px'
    },
    audioCard: (selected) => ({
      padding: '12px',
      background: selected ? '#8b5cf6' : '#27272a',
      borderRadius: '8px',
      cursor: 'pointer',
      marginBottom: '8px',
      transition: 'all 0.15s'
    }),
    input: {
      width: '100%',
      padding: '10px 12px',
      background: '#27272a',
      border: '1px solid #3f3f46',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px',
      boxSizing: 'border-box'
    },
    select: {
      padding: '10px 12px',
      background: '#27272a',
      border: '1px solid #3f3f46',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px',
      cursor: 'pointer',
      minWidth: '150px'
    },
    row: {
      display: 'flex',
      gap: '16px',
      marginBottom: '16px',
      flexWrap: 'wrap'
    },
    col: {
      flex: 1,
      minWidth: '150px'
    },
    label: {
      display: 'block',
      fontSize: '13px',
      color: '#a1a1aa',
      marginBottom: '6px'
    },
    btn: {
      padding: '12px 24px',
      borderRadius: '8px',
      border: 'none',
      fontWeight: '600',
      cursor: 'pointer',
      fontSize: '14px',
      transition: 'all 0.15s'
    },
    primaryBtn: {
      background: '#8b5cf6',
      color: 'white'
    },
    primaryBtnDisabled: {
      background: '#4c4c54',
      color: '#71717a',
      cursor: 'not-allowed'
    },
    secondaryBtn: {
      background: '#27272a',
      color: 'white'
    },
    secondaryBtnDisabled: {
      background: '#1f1f23',
      color: '#52525b',
      cursor: 'not-allowed'
    },
    footer: {
      padding: '16px 24px',
      borderTop: '1px solid #27272a',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    error: {
      background: '#7f1d1d',
      color: '#fca5a5',
      padding: '12px 16px',
      borderRadius: '8px',
      marginBottom: '16px'
    },
    progress: {
      textAlign: 'center',
      padding: '40px'
    },
    progressBar: {
      width: '100%',
      height: '8px',
      background: '#27272a',
      borderRadius: '4px',
      overflow: 'hidden',
      marginTop: '16px'
    },
    progressFill: (percent) => ({
      width: `${percent}%`,
      height: '100%',
      background: '#8b5cf6',
      transition: 'width 0.3s'
    }),
    accountBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 16px',
      background: '#27272a',
      borderRadius: '8px',
      marginBottom: '16px'
    },
    checkbox: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      cursor: 'pointer',
      padding: '8px 12px',
      background: '#27272a',
      borderRadius: '6px'
    },
    beatPatternGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '8px',
      marginTop: '8px'
    },
    beatPatternBtn: (selected) => ({
      padding: '10px 12px',
      background: selected ? '#8b5cf6' : '#27272a',
      border: selected ? '2px solid #a78bfa' : '1px solid #3f3f46',
      borderRadius: '8px',
      cursor: 'pointer',
      textAlign: 'left'
    }),
    beatPatternLabel: {
      color: 'white',
      fontSize: '13px',
      fontWeight: '500',
      display: 'block'
    },
    beatPatternDesc: {
      color: '#71717a',
      fontSize: '11px',
      marginTop: '2px'
    },
    videoList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    },
    videoRow: {
      display: 'flex',
      gap: '12px',
      padding: '12px',
      background: '#27272a',
      borderRadius: '8px',
      alignItems: 'center'
    },
    videoThumb: {
      width: '60px',
      height: '80px',
      borderRadius: '4px',
      background: '#3f3f46',
      overflow: 'hidden'
    },
    videoInfo: {
      flex: 1
    },
    previewVideo: {
      width: '100%',
      maxHeight: '400px',
      borderRadius: '8px',
      background: '#000'
    },
    success: {
      textAlign: 'center',
      padding: '60px 40px'
    },
    successIcon: {
      fontSize: '64px',
      marginBottom: '16px'
    },
    bpmBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 8px',
      background: '#7c3aed',
      borderRadius: '4px',
      fontSize: '11px',
      color: 'white',
      marginLeft: '8px'
    }
  };

  // OPTIONS STAGE
  if (stage === STAGES.OPTIONS) {
    const allSelected = selectedClips.length === availableClips.length && availableClips.length > 0;

    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h2 style={styles.title}>Batch Create for {category?.name}</h2>
            <button style={styles.closeBtn} onClick={onClose}>×</button>
          </div>

          <div style={styles.content}>
            {error && <div style={styles.error}>{error}</div>}

            {/* Account Badge */}
            <div style={styles.accountBadge}>
              <span style={{ color: '#a1a1aa' }}>Posting to:</span>
              <span style={{ color: 'white', fontWeight: '600' }}>
                {accountHandle || 'No account linked'}
              </span>
              {accountMapping && (
                <>
                  {accountMapping.tiktok && <span style={{ color: '#ff0050' }}>TikTok</span>}
                  {accountMapping.instagram && <span style={{ color: '#c13584' }}>IG</span>}
                </>
              )}
            </div>

            {/* Audio Selection */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>1. Select Audio Track</div>
              {availableAudio.length === 0 ? (
                <p style={{ color: '#71717a' }}>No audio uploaded. Upload audio first.</p>
              ) : (
                availableAudio.map(audio => (
                  <div
                    key={audio.id}
                    style={styles.audioCard(selectedAudio?.id === audio.id)}
                    onClick={() => {
                      console.log('[BatchPipeline] Audio clicked:', audio.id, audio.name);
                      setSelectedAudio(audio);
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'white', fontWeight: '500' }}>{audio.name}</div>
                        <div style={{ color: selectedAudio?.id === audio.id ? 'rgba(255,255,255,0.7)' : '#71717a', fontSize: '12px' }}>
                          {audio.duration ? `${Math.round(audio.duration)}s` : 'Unknown duration'}
                          {audio.savedLyrics?.length > 0 && ` • ${audio.savedLyrics.length} lyrics saved`}
                        </div>
                      </div>
                      {isAnalyzing && selectedAudio?.id === audio.id && (
                        <span style={{ color: '#a1a1aa', fontSize: '12px' }}>Analyzing beats...</span>
                      )}
                      {!isAnalyzing && selectedAudio?.id === audio.id && bpm > 0 && (
                        <span style={styles.bpmBadge}>🎵 {Math.round(bpm)} BPM</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Clip Selection */}
            <div style={styles.section}>
              <div style={styles.sectionHeader}>
                <div style={styles.sectionTitle}>
                  2. Select Video Clips ({selectedClips.length}/{availableClips.length})
                </div>
                {availableClips.length > 0 && (
                  <button style={styles.selectAllBtn} onClick={handleSelectAll}>
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>
              {availableClips.length === 0 ? (
                <p style={{ color: '#71717a' }}>No clips uploaded. Upload videos first.</p>
              ) : (
                <div style={styles.grid}>
                  {availableClips.map(clip => {
                    const isSelected = selectedClips.some(c => c.id === clip.id);
                    return (
                      <div
                        key={clip.id}
                        style={styles.clipCard(isSelected)}
                        onClick={() => toggleClip(clip)}
                      >
                        <ClipThumbnail clip={clip} style={styles.clipThumb} />
                        {isSelected && (
                          <div style={styles.clipCheck}>✓</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Generation Options */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>3. Generation Options</div>
              <div style={styles.row}>
                <div style={styles.col}>
                  <label style={styles.label}>Number of Videos</label>
                  <select
                    style={styles.select}
                    value={quantity}
                    onChange={e => setQuantity(Number(e.target.value))}
                  >
                    {[1, 2, 3, 5, 7, 10].map(n => (
                      <option key={n} value={n}>{n} video{n > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.col}>
                  <label style={styles.label}>Cut Style</label>
                  <select
                    style={styles.select}
                    value={clipStrategy}
                    onChange={e => setClipStrategy(e.target.value)}
                  >
                    <option value="beat">Beat-synced {bpm > 0 ? `(${Math.round(bpm)} BPM)` : ''}</option>
                    <option value="random">Random shuffle</option>
                    <option value="sequential">Sequential rotation</option>
                  </select>
                </div>
              </div>

              {/* Beat Pattern Selection - Only show for beat-synced */}
              {clipStrategy === 'beat' && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={styles.label}>Beat Pattern (when to cut)</label>
                  <div style={styles.beatPatternGrid}>
                    {BEAT_PATTERNS.map(pattern => (
                      <button
                        key={pattern.id}
                        style={styles.beatPatternBtn(beatPattern === pattern.id)}
                        onClick={() => setBeatPattern(pattern.id)}
                      >
                        <span style={styles.beatPatternLabel}>{pattern.label}</span>
                        <span style={styles.beatPatternDesc}>{pattern.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Text Overlay Option */}
              <div style={styles.row}>
                <label style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={useTextOverlay}
                    onChange={e => {
                      setUseTextOverlay(e.target.checked);
                      // If disabling, also clear initial settings usage
                      if (!e.target.checked) {
                        setUsingInitialSettings(false);
                      }
                    }}
                  />
                  <span style={{ color: 'white' }}>Add text overlay (lyrics)</span>
                </label>
              </div>

              {/* Show indicator when using initial settings from editor */}
              {useTextOverlay && usingInitialSettings && initialWords?.length > 0 && (
                <div style={{
                  ...styles.row,
                  backgroundColor: 'rgba(139, 92, 246, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginTop: '8px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div>
                      <div style={{ color: '#a78bfa', fontSize: '13px', fontWeight: '500', marginBottom: '4px' }}>
                        ✨ Using lyrics from editor
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: '12px' }}>
                        {initialWords.length} words with timing • {initialTextStyle?.outline ? 'Outline' : 'No outline'}
                        {initialTextStyle?.textCase && initialTextStyle.textCase !== 'default' ? ` • ${initialTextStyle.textCase.toUpperCase()}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setUsingInitialSettings(false);
                        setSelectedLyrics(null);
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'rgba(255,255,255,0.1)',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#9ca3af',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Use different lyrics
                    </button>
                  </div>
                </div>
              )}

              {/* Show lyrics dropdown only if NOT using initial settings */}
              {useTextOverlay && !usingInitialSettings && savedLyricsForAudio.length > 0 && (
                <div style={styles.row}>
                  <div style={styles.col}>
                    <label style={styles.label}>Select Lyrics Template</label>
                    <select
                      style={styles.select}
                      value={selectedLyrics?.id || ''}
                      onChange={e => {
                        const lyrics = savedLyricsForAudio.find(l => l.id === e.target.value);
                        setSelectedLyrics(lyrics || null);
                      }}
                    >
                      <option value="">No lyrics</option>
                      {savedLyricsForAudio.map(lyrics => (
                        <option key={lyrics.id} value={lyrics.id}>{lyrics.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={styles.footer}>
            <button style={{ ...styles.btn, ...styles.secondaryBtn }} onClick={onClose}>
              Cancel
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                style={{
                  ...styles.btn,
                  ...styles.secondaryBtn,
                  ...(((!selectedAudio || selectedClips.length < 2 || isGeneratingPreview) ? styles.secondaryBtnDisabled : {}))
                }}
                onClick={handleGeneratePreview}
                disabled={!selectedAudio || selectedClips.length < 2 || isGeneratingPreview}
              >
                {isGeneratingPreview ? 'Generating...' : '👁 Preview First'}
              </button>
              <button
                style={{
                  ...styles.btn,
                  ...styles.primaryBtn,
                  ...((!selectedAudio || selectedClips.length < 2) ? styles.primaryBtnDisabled : {})
                }}
                onClick={handleGenerate}
                disabled={!selectedAudio || selectedClips.length < 2}
              >
                Generate {quantity} Video{quantity > 1 ? 's' : ''} →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PREVIEW STAGE
  if (stage === STAGES.PREVIEW) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h2 style={styles.title}>Preview - First Video</h2>
            <button style={styles.closeBtn} onClick={onClose}>×</button>
          </div>
          <div style={styles.content}>
            {previewUrl && (
              <video
                src={previewUrl}
                controls
                autoPlay
                loop
                style={styles.previewVideo}
              />
            )}
            <p style={{ color: '#a1a1aa', textAlign: 'center', marginTop: '16px' }}>
              This is a preview of how your videos will look. The full batch will render at higher quality.
            </p>
          </div>
          <div style={styles.footer}>
            <button
              style={{ ...styles.btn, ...styles.secondaryBtn }}
              onClick={() => setStage(STAGES.OPTIONS)}
            >
              ← Back to Options
            </button>
            <button
              style={{ ...styles.btn, ...styles.primaryBtn }}
              onClick={handleGenerate}
            >
              Looks Good - Generate {quantity} Videos →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // GENERATING STAGE
  if (stage === STAGES.GENERATING) {
    const percent = generationProgress.total > 0
      ? Math.round((generationProgress.current / generationProgress.total) * 100)
      : 0;

    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h2 style={styles.title}>Generating Videos...</h2>
          </div>
          <div style={styles.content}>
            <div style={styles.progress}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎬</div>
              <div style={{ fontSize: '24px', color: 'white', marginBottom: '8px' }}>
                {generationProgress.current} / {generationProgress.total}
              </div>
              <div style={{ color: '#a1a1aa' }}>{generationProgress.status}</div>
              <div style={styles.progressBar}>
                <div style={styles.progressFill(percent)} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // VIDEO_BANK STAGE - View and edit videos before scheduling
  if (stage === STAGES.VIDEO_BANK) {
    return (
      <div style={styles.overlay}>
        <div style={{ ...styles.modal, maxWidth: '1100px' }}>
          <div style={styles.header}>
            <h2 style={styles.title}>Video Bank - {generatedVideos.length} Videos Created</h2>
            <button style={styles.closeBtn} onClick={onClose}>×</button>
          </div>

          <div style={styles.content}>
            {error && <div style={styles.error}>{error}</div>}

            {/* Caption Bank Warning */}
            {!hasCaptionBank && (
              <div style={{
                background: '#78350f',
                border: '1px solid #fbbf24',
                borderRadius: '8px',
                padding: '12px 16px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <span style={{ fontSize: '20px' }}>⚠️</span>
                <div>
                  <div style={{ color: '#fef3c7', fontWeight: '500', marginBottom: '2px' }}>
                    No Caption Bank for "{category?.name}"
                  </div>
                  <div style={{ color: '#fde68a', fontSize: '13px' }}>
                    Create a bank named "{category?.name}" to auto-generate captions.
                    Available banks: {getBankNames().join(', ')}
                  </div>
                </div>
              </div>
            )}

            {/* Instant generation notice */}
            <div style={{
              background: '#065f46',
              border: '1px solid #10b981',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <span style={{ fontSize: '20px' }}>⚡</span>
              <div>
                <div style={{ color: '#d1fae5', fontWeight: '500', marginBottom: '2px' }}>
                  Instant Preview Mode
                </div>
                <div style={{ color: '#a7f3d0', fontSize: '13px' }}>
                  Videos are previews only - they'll be rendered when you export/finalize from the library.
                </div>
              </div>
            </div>

            <p style={{ color: '#a1a1aa', marginBottom: '20px' }}>
              Preview your video recipes below. Click "Edit" to open in full editor, or save as drafts to render later.
            </p>

            {/* Video Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '16px'
            }}>
              {generatedVideos.map((video, idx) => (
                <div
                  key={video.id}
                  style={{
                    background: '#27272a',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: playingVideoId === video.id ? '2px solid #8b5cf6' : '2px solid transparent'
                  }}
                >
                  {/* Video Preview using PreviewPlayer */}
                  <div style={{ position: 'relative' }}>
                    <PreviewPlayer
                      clips={video.clips}
                      audio={video.audio}
                      duration={video.duration}
                      showControls={true}
                    />
                    {/* Video number badge */}
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      left: '8px',
                      background: '#8b5cf6',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '600',
                      zIndex: 10
                    }}>
                      #{idx + 1}
                    </div>
                    {/* "Not Rendered" badge */}
                    {!video.isRendered && (
                      <div style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(0,0,0,0.7)',
                        color: '#fbbf24',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: '500',
                        zIndex: 10
                      }}>
                        ⚡ Preview
                      </div>
                    )}
                  </div>

                  {/* Video Info */}
                  <div style={{ padding: '12px' }}>
                    <div style={{ color: 'white', fontWeight: '500', marginBottom: '4px' }}>
                      {video.title}
                    </div>
                    <div style={{ color: '#71717a', fontSize: '12px', marginBottom: '8px' }}>
                      {video.clips?.length || 0} clips • {Math.round(video.duration || 0)}s
                    </div>

                    {/* Caption Preview */}
                    <input
                      type="text"
                      placeholder="Add caption..."
                      style={{ ...styles.input, padding: '8px 10px', fontSize: '12px' }}
                      value={captions[idx] || ''}
                      onChange={e => updateCaption(idx, e.target.value)}
                    />

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      {onEditVideo && (
                        <button
                          style={{
                            flex: 1,
                            padding: '6px',
                            background: '#8b5cf6',
                            border: 'none',
                            borderRadius: '6px',
                            color: 'white',
                            fontSize: '11px',
                            cursor: 'pointer',
                            fontWeight: '500'
                          }}
                          onClick={() => handleEditVideoClick(video, idx)}
                        >
                          ✏️ Edit
                        </button>
                      )}
                      <button
                        style={{
                          flex: 1,
                          padding: '6px',
                          background: '#3f3f46',
                          border: 'none',
                          borderRadius: '6px',
                          color: 'white',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                        onClick={() => {
                          // Remove this video
                          setGeneratedVideos(prev => prev.filter(v => v.id !== video.id));
                          setCaptions(prev => prev.filter((_, i) => i !== idx));
                        }}
                      >
                        🗑️ Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {generatedVideos.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#71717a' }}>
                No videos in bank. Generate some videos first.
              </div>
            )}
          </div>

          <div style={styles.footer}>
            <button
              style={{ ...styles.btn, ...styles.secondaryBtn }}
              onClick={() => setStage(STAGES.OPTIONS)}
            >
              ← Generate More
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                style={{
                  ...styles.btn,
                  ...styles.primaryBtn,
                  ...(generatedVideos.length === 0 ? styles.primaryBtnDisabled : {})
                }}
                onClick={handleSaveAsDrafts}
                disabled={generatedVideos.length === 0}
              >
                💾 Save as Drafts ({generatedVideos.length})
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default BatchPipeline;
