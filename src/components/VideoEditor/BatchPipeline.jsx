import React, { useState, useCallback, useMemo } from 'react';
import { renderVideo } from '../../services/videoExportService';
import { uploadFile } from '../../services/firebaseStorage';

/**
 * BatchPipeline - Streamlined workflow for batch video creation and scheduling
 *
 * Flow: Select Options → Generate & Export → Review & Schedule → Done
 */

const STAGES = {
  OPTIONS: 'options',
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
  onVideosCreated
}) => {
  // Stage management
  const [stage, setStage] = useState(STAGES.OPTIONS);
  const [error, setError] = useState(null);

  // Options stage
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedClips, setSelectedClips] = useState([]);
  const [quantity, setQuantity] = useState(5);
  const [clipStrategy, setClipStrategy] = useState('random'); // random or sequential

  // Generation progress
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, status: '' });

  // Generated videos ready for scheduling
  const [generatedVideos, setGeneratedVideos] = useState([]);

  // Scheduling options
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    return tomorrow.toISOString().slice(0, 16);
  });
  const [intervalMinutes, setIntervalMinutes] = useState(180); // 3 hours
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });
  const [captions, setCaptions] = useState([]); // Per-video captions

  // Get account from category
  const accountHandle = category?.accountHandle;
  const accountMapping = accountHandle ? lateAccountIds[accountHandle] : null;

  // Available clips and audio from category
  const availableClips = category?.videos || [];
  const availableAudio = category?.audio || [];

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

  // Generate videos with auto-export
  const handleGenerate = useCallback(async () => {
    if (!selectedAudio) {
      setError('Please select an audio track');
      return;
    }
    if (selectedClips.length < 2) {
      setError('Please select at least 2 video clips');
      return;
    }
    if (!accountMapping) {
      setError(`No Late.co account linked to this category. Please set accountHandle in category settings.`);
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

        // Generate clip sequence based on strategy
        let clipSequence;
        if (clipStrategy === 'random') {
          // Shuffle and pick clips
          const shuffled = [...selectedClips].sort(() => Math.random() - 0.5);
          clipSequence = shuffled.slice(0, Math.min(shuffled.length, 8));
        } else {
          // Sequential with offset
          const offset = i % selectedClips.length;
          clipSequence = [];
          for (let j = 0; j < Math.min(selectedClips.length, 8); j++) {
            clipSequence.push(selectedClips[(offset + j) % selectedClips.length]);
          }
        }

        // Calculate clip timings to fill audio duration
        const clipDuration = audioDuration / clipSequence.length;
        const clips = clipSequence.map((clip, idx) => ({
          id: `clip_${Date.now()}_${i}_${idx}`,
          sourceId: clip.id,
          url: clip.url,
          localUrl: clip.localUrl,
          thumbnail: clip.thumbnail,
          startTime: idx * clipDuration,
          duration: clipDuration,
          locked: false
        }));

        // Video data for rendering
        const videoData = {
          id: `batch_${Date.now()}_${i}`,
          title: `${category.name} ${i + 1}`,
          clips,
          audio: selectedAudio,
          words: [], // No text overlay for batch
          textStyle: {},
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
          new File([blob], `${videoData.id}.mp4`, { type: 'video/mp4' }),
          'videos'
        );

        videos.push({
          ...videoData,
          cloudUrl,
          caption: '',
          hashtags: category.name.toLowerCase()
        });
      }

      setGeneratedVideos(videos);
      setCaptions(videos.map(() => ''));
      setStage(STAGES.REVIEW);

      // Notify parent of created videos
      if (onVideosCreated) {
        onVideosCreated(videos);
      }

    } catch (err) {
      console.error('Generation error:', err);
      setError(`Failed to generate videos: ${err.message}`);
      setStage(STAGES.OPTIONS);
    }
  }, [selectedAudio, selectedClips, quantity, clipStrategy, category, accountMapping, onVideosCreated]);

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

      // Build platforms array
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
        const caption = captions[i] || `${category.name} vibes ✨`;
        await onSchedulePost({
          platforms: platformsArray,
          caption,
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
  }, [generatedVideos, scheduleDate, intervalMinutes, platforms, accountMapping, captions, category, onSchedulePost]);

  // Update individual caption
  const updateCaption = useCallback((index, value) => {
    setCaptions(prev => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }, []);

  // Styles
  const styles = {
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.9)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
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
    sectionTitle: {
      fontSize: '14px',
      fontWeight: '600',
      color: '#a1a1aa',
      marginBottom: '12px',
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
      gap: '8px'
    },
    clipCard: (selected) => ({
      position: 'relative',
      aspectRatio: '9/16',
      borderRadius: '8px',
      overflow: 'hidden',
      cursor: 'pointer',
      border: selected ? '3px solid #8b5cf6' : '2px solid transparent',
      opacity: selected ? 1 : 0.7
    }),
    clipThumb: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    },
    audioCard: (selected) => ({
      padding: '12px',
      background: selected ? '#8b5cf6' : '#27272a',
      borderRadius: '8px',
      cursor: 'pointer',
      marginBottom: '8px'
    }),
    input: {
      width: '100%',
      padding: '10px 12px',
      background: '#27272a',
      border: '1px solid #3f3f46',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px'
    },
    select: {
      padding: '10px 12px',
      background: '#27272a',
      border: '1px solid #3f3f46',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px',
      cursor: 'pointer'
    },
    row: {
      display: 'flex',
      gap: '16px',
      marginBottom: '16px'
    },
    col: {
      flex: 1
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
      fontSize: '14px'
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
      cursor: 'pointer'
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
      background: '#3f3f46'
    },
    videoInfo: {
      flex: 1
    },
    success: {
      textAlign: 'center',
      padding: '60px 40px'
    },
    successIcon: {
      fontSize: '64px',
      marginBottom: '16px'
    }
  };

  // OPTIONS STAGE
  if (stage === STAGES.OPTIONS) {
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
                  {accountMapping.instagram && <span style={{ color: '#c13584' }}>Instagram</span>}
                </>
              )}
            </div>

            {/* Audio Selection */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>1. Select Audio Track</div>
              {availableAudio.length === 0 ? (
                <p style={{ color: '#71717a' }}>No audio uploaded. Upload audio to this category first.</p>
              ) : (
                availableAudio.map(audio => (
                  <div
                    key={audio.id}
                    style={styles.audioCard(selectedAudio?.id === audio.id)}
                    onClick={() => setSelectedAudio(audio)}
                  >
                    <div style={{ color: 'white', fontWeight: '500' }}>{audio.name}</div>
                    <div style={{ color: '#a1a1aa', fontSize: '12px' }}>
                      {audio.duration ? `${Math.round(audio.duration)}s` : 'Unknown duration'}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Clip Selection */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                2. Select Video Clips ({selectedClips.length} selected)
              </div>
              {availableClips.length === 0 ? (
                <p style={{ color: '#71717a' }}>No clips uploaded. Upload videos to this category first.</p>
              ) : (
                <div style={styles.grid}>
                  {availableClips.map(clip => (
                    <div
                      key={clip.id}
                      style={styles.clipCard(selectedClips.some(c => c.id === clip.id))}
                      onClick={() => toggleClip(clip)}
                    >
                      {clip.thumbnail ? (
                        <img src={clip.thumbnail} alt="" style={styles.clipThumb} />
                      ) : (
                        <div style={{ ...styles.clipThumb, background: '#3f3f46' }} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Options */}
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
                    {[2, 3, 5, 7, 10].map(n => (
                      <option key={n} value={n}>{n} videos</option>
                    ))}
                  </select>
                </div>
                <div style={styles.col}>
                  <label style={styles.label}>Clip Selection</label>
                  <select
                    style={styles.select}
                    value={clipStrategy}
                    onChange={e => setClipStrategy(e.target.value)}
                  >
                    <option value="random">Random shuffle</option>
                    <option value="sequential">Sequential rotation</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.footer}>
            <button style={{ ...styles.btn, ...styles.secondaryBtn }} onClick={onClose}>
              Cancel
            </button>
            <button
              style={{ ...styles.btn, ...styles.primaryBtn }}
              onClick={handleGenerate}
              disabled={!selectedAudio || selectedClips.length < 2}
            >
              Generate {quantity} Videos →
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
                            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }}
                          />
                        )}
                      </div>
                      <div style={styles.videoInfo}>
                        <div style={{ color: 'white', fontWeight: '500', marginBottom: '4px' }}>
                          {video.title}
                        </div>
                        <div style={{ color: '#a1a1aa', fontSize: '12px' }}>
                          Scheduled: {postTime.toLocaleString()}
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
