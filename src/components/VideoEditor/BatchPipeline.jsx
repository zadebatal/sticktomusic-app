import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { renderVideo, renderPreview } from '../../services/videoExportService';
import { uploadFile } from '../../services/firebaseStorage';
import { useBeatDetection } from '../../hooks/useBeatDetection';

/**
 * BatchPipeline - Streamlined workflow for batch video creation and scheduling
 *
 * Features:
 * - Select All / Deselect All for clips
 * - Beat-synced cuts option
 * - Preview first video before batch render
 * - Text overlay with saved lyrics
 * - Caption templates per category
 * - Category default presets
 */

const STAGES = {
  OPTIONS: 'options',
  PREVIEW: 'preview',
  GENERATING: 'generating',
  REVIEW: 'review',
  SCHEDULING: 'scheduling',
  DONE: 'done'
};

const BatchPipeline = ({
  category,
  lateAccountIds = {},
  onSchedulePost,
  onClose,
  onVideosCreated,
  onSaveLyrics // Save lyrics to audio track
}) => {
  // Stage management
  const [stage, setStage] = useState(STAGES.OPTIONS);
  const [error, setError] = useState(null);

  // Options stage
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedClips, setSelectedClips] = useState([]);
  const [quantity, setQuantity] = useState(5);
  const [clipStrategy, setClipStrategy] = useState('beat'); // beat, random, sequential
  const [beatsPerCut, setBeatsPerCut] = useState(2);

  // Text overlay options
  const [useTextOverlay, setUseTextOverlay] = useState(false);
  const [selectedLyrics, setSelectedLyrics] = useState(null); // Saved lyrics template

  // Beat detection
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();

  // Generation progress
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, status: '' });

  // Preview state
  const [previewBlob, setPreviewBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  // Generated videos ready for scheduling
  const [generatedVideos, setGeneratedVideos] = useState([]);

  // Scheduling options
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    return tomorrow.toISOString().slice(0, 16);
  });
  const [intervalMinutes, setIntervalMinutes] = useState(180);
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });
  const [captions, setCaptions] = useState([]);

  // Caption template from category
  const captionTemplate = category?.captionTemplate || '{title} ✨ {hashtags}';
  const defaultHashtags = category?.defaultHashtags || '#viral #fyp';

  // Get account from category
  const accountHandle = category?.accountHandle;
  const accountMapping = accountHandle ? lateAccountIds[accountHandle] : null;

  // Available clips and audio from category
  const availableClips = category?.videos || [];
  const availableAudio = category?.audio || [];

  // Get saved lyrics for selected audio
  const savedLyricsForAudio = useMemo(() => {
    if (!selectedAudio) return [];
    // Check if audio has saved lyrics
    return selectedAudio.savedLyrics || [];
  }, [selectedAudio]);

  // Analyze beats when audio is selected
  useEffect(() => {
    if (selectedAudio && (selectedAudio.localUrl || selectedAudio.url)) {
      const audioSource = selectedAudio.file || selectedAudio.localUrl || selectedAudio.url;
      analyzeAudio(audioSource).catch(err => {
        console.warn('Beat analysis failed:', err);
      });
    }
  }, [selectedAudio, analyzeAudio]);

  // Select All / Deselect All
  const handleSelectAll = useCallback(() => {
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

  // Generate clip sequence based on strategy and beats
  const generateClipSequence = useCallback((audioDuration, clipPool, strategy) => {
    const clips = [];
    let currentTime = 0;

    if (strategy === 'beat' && beats.length > 0) {
      // Beat-synced cuts
      const audioStart = selectedAudio?.startTime || 0;
      const audioEnd = selectedAudio?.endTime || audioDuration + audioStart;

      // Filter beats to trimmed range and normalize to local time
      const trimmedBeats = beats
        .filter(b => b >= audioStart && b <= audioEnd)
        .map(b => b - audioStart);

      // Group beats by beatsPerCut
      let beatIndex = 0;
      while (currentTime < audioDuration && beatIndex < trimmedBeats.length) {
        const clipStartTime = currentTime;
        let clipEndTime;

        // Advance by beatsPerCut beats
        const targetBeatIndex = beatIndex + beatsPerCut;
        if (targetBeatIndex < trimmedBeats.length) {
          clipEndTime = trimmedBeats[targetBeatIndex];
        } else {
          clipEndTime = audioDuration;
        }

        const clipDuration = clipEndTime - clipStartTime;
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

        currentTime = clipEndTime;
        beatIndex = targetBeatIndex;
      }
    } else if (strategy === 'random') {
      // Random shuffle
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
  }, [beats, beatsPerCut, selectedAudio]);

  // Generate preview of first video
  const handleGeneratePreview = useCallback(async () => {
    if (!selectedAudio || selectedClips.length < 2) {
      setError('Select audio and at least 2 clips');
      return;
    }

    setIsGeneratingPreview(true);
    setError(null);

    try {
      const audioDuration = selectedAudio.duration || 30;
      const clips = generateClipSequence(audioDuration, selectedClips, clipStrategy);

      const videoData = {
        id: `preview_${Date.now()}`,
        title: `${category.name} Preview`,
        clips,
        audio: selectedAudio,
        words: useTextOverlay && selectedLyrics ? selectedLyrics.words : [],
        textStyle: category?.defaultPreset?.textStyle || {
          fontSize: 48,
          fontFamily: 'Inter, sans-serif',
          fontWeight: '600',
          color: '#ffffff',
          outline: true,
          outlineColor: '#000000'
        },
        cropMode: '9:16',
        duration: Math.min(audioDuration, 10) // Preview only first 10 seconds
      };

      const blob = await renderPreview(videoData, (p) => {
        setGenerationProgress({ current: 1, total: 1, status: `Generating preview... ${p}%` });
      });

      // Create URL for preview
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewBlob(blob);
      setPreviewUrl(url);
      setStage(STAGES.PREVIEW);

    } catch (err) {
      console.error('Preview generation failed:', err);
      setError(`Preview failed: ${err.message}`);
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [selectedAudio, selectedClips, clipStrategy, generateClipSequence, useTextOverlay, selectedLyrics, category, previewUrl]);

  // Generate all videos
  const handleGenerate = useCallback(async () => {
    if (!selectedAudio) {
      setError('Please select an audio track');
      return;
    }
    if (selectedClips.length < 2) {
      setError('Please select at least 2 video clips');
      return;
    }

    setStage(STAGES.GENERATING);
    setError(null);
    setGeneratedVideos([]);

    const videos = [];
    const audioDuration = selectedAudio.duration || 30;

    try {
      for (let i = 0; i < quantity; i++) {
        setGenerationProgress({
          current: i + 1,
          total: quantity,
          status: `Creating video ${i + 1} of ${quantity}...`
        });

        // Generate clip sequence with variation
        let clipPool = [...selectedClips];
        if (clipStrategy === 'random') {
          clipPool = clipPool.sort(() => Math.random() - 0.5);
        } else if (clipStrategy === 'sequential') {
          // Rotate starting point for each video
          const offset = i % clipPool.length;
          clipPool = [...clipPool.slice(offset), ...clipPool.slice(0, offset)];
        }

        const clips = generateClipSequence(audioDuration, clipPool, clipStrategy);

        const videoData = {
          id: `batch_${Date.now()}_${i}`,
          title: `${category.name} ${i + 1}`,
          clips,
          audio: selectedAudio,
          words: useTextOverlay && selectedLyrics ? selectedLyrics.words : [],
          textStyle: category?.defaultPreset?.textStyle || {
            fontSize: 48,
            fontFamily: 'Inter, sans-serif',
            fontWeight: '600',
            color: '#ffffff',
            outline: true,
            outlineColor: '#000000'
          },
          cropMode: '9:16',
          duration: audioDuration
        };

        // Render video
        setGenerationProgress(prev => ({ ...prev, status: `Rendering video ${i + 1}...` }));
        const blob = await renderVideo(videoData, (p) => {
          setGenerationProgress(prev => ({
            ...prev,
            status: `Rendering video ${i + 1}... ${p}%`
          }));
        });

        // Upload to Firebase
        setGenerationProgress(prev => ({ ...prev, status: `Uploading video ${i + 1}...` }));
        const { url: cloudUrl } = await uploadFile(
          new File([blob], `${videoData.id}.webm`, { type: 'video/webm' }),
          'videos'
        );

        // Generate caption from template
        const caption = captionTemplate
          .replace('{title}', category.name)
          .replace('{hashtags}', defaultHashtags)
          .replace('{index}', String(i + 1));

        videos.push({
          ...videoData,
          cloudUrl,
          caption,
          hashtags: defaultHashtags
        });
      }

      setGeneratedVideos(videos);
      setCaptions(videos.map(v => v.caption));
      setStage(STAGES.REVIEW);

      // Notify parent
      if (onVideosCreated) {
        onVideosCreated(videos);
      }

    } catch (err) {
      console.error('Generation error:', err);
      setError(`Failed to generate videos: ${err.message}`);
      setStage(STAGES.OPTIONS);
    }
  }, [selectedAudio, selectedClips, quantity, clipStrategy, generateClipSequence, useTextOverlay, selectedLyrics, category, captionTemplate, defaultHashtags, onVideosCreated]);

  // Schedule all videos
  const handleSchedule = useCallback(async () => {
    if (!accountMapping) {
      setError('No account linked to this category');
      return;
    }

    setStage(STAGES.SCHEDULING);
    setError(null);

    const baseDate = new Date(scheduleDate);
    let successCount = 0;
    const errors = [];

    for (let i = 0; i < generatedVideos.length; i++) {
      const video = generatedVideos[i];
      const scheduledFor = new Date(baseDate.getTime() + (i * intervalMinutes * 60 * 1000));

      const platformsArray = [];
      if (platforms.tiktok && accountMapping.tiktok) {
        platformsArray.push({ platform: 'tiktok', accountId: accountMapping.tiktok });
      }
      if (platforms.instagram && accountMapping.instagram) {
        platformsArray.push({ platform: 'instagram', accountId: accountMapping.instagram });
      }

      if (platformsArray.length === 0) {
        errors.push(`Video ${i + 1}: No platforms selected`);
        continue;
      }

      try {
        await onSchedulePost({
          platforms: platformsArray,
          caption: captions[i] || video.caption,
          videoUrl: video.cloudUrl,
          scheduledFor: scheduledFor.toISOString()
        });
        successCount++;
      } catch (err) {
        errors.push(`Video ${i + 1}: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      setError(`Scheduled ${successCount}/${generatedVideos.length}. Errors: ${errors.join('; ')}`);
    }

    setStage(STAGES.DONE);
  }, [generatedVideos, scheduleDate, intervalMinutes, platforms, accountMapping, captions, onSchedulePost]);

  // Update individual caption
  const updateCaption = useCallback((index, value) => {
    setCaptions(prev => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }, []);

  // Cleanup preview URL on unmount
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
      border: selected ? '3px solid #8b5cf6' : '2px solid transparent',
      opacity: selected ? 1 : 0.6,
      transition: 'all 0.15s'
    }),
    clipThumb: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
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
    secondaryBtn: {
      background: '#27272a',
      color: 'white'
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
                    onClick={() => setSelectedAudio(audio)}
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
                        {clip.thumbnail ? (
                          <img src={clip.thumbnail} alt="" style={styles.clipThumb} />
                        ) : (
                          <div style={{ ...styles.clipThumb, background: '#3f3f46' }} />
                        )}
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
                {clipStrategy === 'beat' && (
                  <div style={styles.col}>
                    <label style={styles.label}>Beats per Cut</label>
                    <select
                      style={styles.select}
                      value={beatsPerCut}
                      onChange={e => setBeatsPerCut(Number(e.target.value))}
                    >
                      <option value={1}>Every beat (fast)</option>
                      <option value={2}>Every 2 beats</option>
                      <option value={4}>Every 4 beats (slow)</option>
                      <option value={8}>Every 8 beats</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Text Overlay Option */}
              <div style={styles.row}>
                <label style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={useTextOverlay}
                    onChange={e => setUseTextOverlay(e.target.checked)}
                  />
                  <span style={{ color: 'white' }}>Add text overlay (lyrics)</span>
                </label>
              </div>

              {useTextOverlay && savedLyricsForAudio.length > 0 && (
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
                style={{ ...styles.btn, ...styles.secondaryBtn }}
                onClick={handleGeneratePreview}
                disabled={!selectedAudio || selectedClips.length < 2 || isGeneratingPreview}
              >
                {isGeneratingPreview ? 'Generating...' : '👁 Preview First'}
              </button>
              <button
                style={{ ...styles.btn, ...styles.primaryBtn }}
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

  // REVIEW STAGE
  if (stage === STAGES.REVIEW) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h2 style={styles.title}>Review & Schedule</h2>
            <button style={styles.closeBtn} onClick={onClose}>×</button>
          </div>

          <div style={styles.content}>
            {error && <div style={styles.error}>{error}</div>}

            {/* Schedule Settings */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Schedule Settings</div>
              <div style={styles.row}>
                <div style={styles.col}>
                  <label style={styles.label}>Start Date & Time</label>
                  <input
                    type="datetime-local"
                    style={styles.input}
                    value={scheduleDate}
                    onChange={e => setScheduleDate(e.target.value)}
                  />
                </div>
                <div style={styles.col}>
                  <label style={styles.label}>Interval Between Posts</label>
                  <select
                    style={styles.select}
                    value={intervalMinutes}
                    onChange={e => setIntervalMinutes(Number(e.target.value))}
                  >
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                    <option value={180}>3 hours</option>
                    <option value={360}>6 hours</option>
                    <option value={720}>12 hours</option>
                    <option value={1440}>24 hours</option>
                  </select>
                </div>
              </div>
              <div style={styles.row}>
                <label style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={platforms.tiktok}
                    onChange={e => setPlatforms(p => ({ ...p, tiktok: e.target.checked }))}
                  />
                  <span style={{ color: '#ff0050' }}>TikTok</span>
                </label>
                <label style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={platforms.instagram}
                    onChange={e => setPlatforms(p => ({ ...p, instagram: e.target.checked }))}
                  />
                  <span style={{ color: '#c13584' }}>Instagram</span>
                </label>
              </div>
            </div>

            {/* Video List */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Videos ({generatedVideos.length})</div>
              <div style={styles.videoList}>
                {generatedVideos.map((video, idx) => {
                  const postTime = new Date(
                    new Date(scheduleDate).getTime() + (idx * intervalMinutes * 60 * 1000)
                  );
                  return (
                    <div key={video.id} style={styles.videoRow}>
                      <div style={styles.videoThumb}>
                        {video.clips[0]?.thumbnail && (
                          <img
                            src={video.clips[0].thumbnail}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                      </div>
                      <div style={styles.videoInfo}>
                        <div style={{ color: 'white', fontWeight: '500', marginBottom: '4px' }}>
                          {video.title}
                        </div>
                        <div style={{ color: '#a1a1aa', fontSize: '12px' }}>
                          📅 {postTime.toLocaleString()}
                        </div>
                        <input
                          type="text"
                          placeholder="Add caption..."
                          style={{ ...styles.input, marginTop: '8px', padding: '6px 10px' }}
                          value={captions[idx] || ''}
                          onChange={e => updateCaption(idx, e.target.value)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={styles.footer}>
            <button style={{ ...styles.btn, ...styles.secondaryBtn }} onClick={onClose}>
              Save as Drafts
            </button>
            <button
              style={{ ...styles.btn, ...styles.primaryBtn }}
              onClick={handleSchedule}
              disabled={!platforms.tiktok && !platforms.instagram}
            >
              Schedule All →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SCHEDULING STAGE
  if (stage === STAGES.SCHEDULING) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h2 style={styles.title}>Scheduling Posts...</h2>
          </div>
          <div style={styles.content}>
            <div style={styles.progress}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📅</div>
              <div style={{ color: 'white', fontSize: '18px' }}>
                Sending to Late.co...
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // DONE STAGE
  if (stage === STAGES.DONE) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h2 style={styles.title}>Done!</h2>
          </div>
          <div style={styles.content}>
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.success}>
              <div style={styles.successIcon}>✅</div>
              <div style={{ color: 'white', fontSize: '24px', marginBottom: '8px' }}>
                {generatedVideos.length} Videos Scheduled
              </div>
              <div style={{ color: '#a1a1aa' }}>
                Posted to {accountHandle} on{' '}
                {[platforms.tiktok && 'TikTok', platforms.instagram && 'Instagram'].filter(Boolean).join(' & ')}
              </div>
            </div>
          </div>
          <div style={styles.footer}>
            <div />
            <button style={{ ...styles.btn, ...styles.primaryBtn }} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default BatchPipeline;
