import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import WordTimeline from './WordTimeline';
import { saveApiKey, loadApiKey } from '../../services/storageService';
import { ErrorPanel, EmptyState as SharedEmptyState } from '../ui';

/**
 * VideoEditorModal - Flowstage-inspired video editor modal
 * Clean UI with preview, controls, and clip timeline
 */
const VideoEditorModal = ({
  category,
  existingVideo,
  presets = [],
  onSave,
  onSavePreset,
  onClose
}) => {
  // Media state
  const [selectedAudio, setSelectedAudio] = useState(existingVideo?.audio || null);
  const [clips, setClips] = useState(existingVideo?.clips || []);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(existingVideo?.duration || 30);

  // Text state
  const [lyrics, setLyrics] = useState(existingVideo?.lyrics || '');
  const [words, setWords] = useState(existingVideo?.words || []);
  const [textStyle, setTextStyle] = useState(existingVideo?.textStyle || {
    fontSize: 48,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    color: '#ffffff',
    outline: true,
    outlineColor: '#000000',
    textCase: 'default',
    displayMode: 'word'
  });

  // Editor state
  const [activeTab, setActiveTab] = useState('caption'); // caption, styles
  const [cropMode, setCropMode] = useState('9:16');
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [showLyricsEditor, setShowLyricsEditor] = useState(false);
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [selectedClips, setSelectedClips] = useState([]);

  // AI Transcription state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(null);

  // Beat detection
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();

  // Refs
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const animationRef = useRef(null);

  // Get current clip based on currentTime
  const currentClip = clips.find((clip, i) => {
    const nextClip = clips[i + 1];
    if (!nextClip) return true; // Last clip
    return currentTime >= clip.startTime && currentTime < nextClip.startTime;
  }) || clips[0];

  // Load audio and analyze beats
  useEffect(() => {
    if (selectedAudio?.url) {
      // Analyze beats if we have the file
      if (selectedAudio.file) {
        analyzeAudio(selectedAudio.file);
      }

      // Create audio element for playback
      if (audioRef.current) {
        audioRef.current.src = selectedAudio.url;
        audioRef.current.load();
        audioRef.current.onloadedmetadata = () => {
          setDuration(audioRef.current.duration);
        };
        // Handle audio ended
        audioRef.current.onended = () => {
          setIsPlaying(false);
          setCurrentTime(0);
        };
      }
    }
  }, [selectedAudio, analyzeAudio]);

  // Handle play/pause
  useEffect(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.play().catch(console.error);

      // Update currentTime during playback
      const updateTime = () => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
        if (isPlaying) {
          animationRef.current = requestAnimationFrame(updateTime);
        }
      };
      animationRef.current = requestAnimationFrame(updateTime);
    } else {
      audioRef.current.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying]);

  // Sync video with audio time
  useEffect(() => {
    if (videoRef.current && currentClip?.url) {
      // Calculate position within the clip
      const clipStartTime = currentClip.startTime || 0;
      const clipDuration = currentClip.duration || 2;
      const positionInClip = (currentTime - clipStartTime) % clipDuration;

      // Set video time if significantly different
      if (Math.abs(videoRef.current.currentTime - positionInClip) > 0.3) {
        videoRef.current.currentTime = positionInClip;
      }

      if (isPlaying) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  }, [currentClip, currentTime, isPlaying]);

  // Handle clip changes - load new video
  useEffect(() => {
    if (videoRef.current && currentClip?.url) {
      // If video source changed, reload
      if (videoRef.current.src !== currentClip.url) {
        videoRef.current.src = currentClip.url;
        videoRef.current.load();
        if (isPlaying) {
          videoRef.current.play().catch(() => {});
        }
      }
    }
  }, [currentClip?.url, currentClip?.id]);

  // Handlers - MUST be defined before useEffect that references them (TDZ fix)
  const handleSeek = useCallback((time) => {
    const clampedTime = Math.max(0, Math.min(time, duration));
    setCurrentTime(clampedTime);
    if (audioRef.current) {
      audioRef.current.currentTime = clampedTime;
    }
    // Video sync will happen via the useEffect
  }, [duration]);

  const handleToggleMute = useCallback(() => {
    setIsMuted(prev => {
      if (audioRef.current) {
        audioRef.current.muted = !prev;
      }
      return !prev;
    });
  }, []);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // ESC to close modal
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // Space bar to play/pause
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handlePlayPause();
      }
      // Left/Right arrows to seek
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleSeek(Math.max(0, currentTime - 1));
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleSeek(Math.min(duration, currentTime + 1));
      }
      // M to mute/unmute
      if (e.code === 'KeyM' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleToggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, handleSeek, handleToggleMute, currentTime, duration, onClose]);

  // Prevent background scroll when modal is open (P0-UI-04)
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Get current visible text
  const currentText = words.find(w =>
    currentTime >= w.startTime && currentTime < w.startTime + (w.duration || 0.5)
  );

  // Handlers
  const handleAudioSelect = (audio) => {
    setSelectedAudio(audio);
  };

  const handleCutByBeat = useCallback(() => {
    if (!beats.length || !category?.videos?.length) return;

    const availableClips = category.videos;
    const beatsPerCut = 2;
    const newClips = [];

    for (let i = 0; i < beats.length; i += beatsPerCut) {
      const startBeat = beats[i];
      const endBeat = beats[Math.min(i + beatsPerCut, beats.length - 1)];
      const clipDuration = endBeat - startBeat;

      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];

      newClips.push({
        id: `clip_${Date.now()}_${i}`,
        sourceId: randomClip.id,
        url: randomClip.url,
        thumbnail: randomClip.thumbnail,
        startTime: startBeat,
        duration: clipDuration,
        locked: false
      });
    }

    setClips(newClips);
  }, [beats, category?.videos]);

  const handleCutByWord = useCallback(() => {
    if (!words.length || !category?.videos?.length) return;

    const availableClips = category.videos;
    const newClips = words.map((word, i) => {
      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
      return {
        id: `clip_${Date.now()}_${i}`,
        sourceId: randomClip.id,
        url: randomClip.url,
        thumbnail: randomClip.thumbnail,
        startTime: word.startTime,
        duration: word.duration || 0.5,
        locked: false
      };
    });

    setClips(newClips);
  }, [words, category?.videos]);

  const handleReroll = useCallback(() => {
    if (!category?.videos?.length) return;

    const availableClips = category.videos;
    const indicesToReroll = selectedClips.length > 0
      ? selectedClips
      : clips.map((_, i) => i);

    setClips(prev => prev.map((clip, i) => {
      if (!indicesToReroll.includes(i) || clip.locked) return clip;
      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
      return {
        ...clip,
        sourceId: randomClip.id,
        url: randomClip.url,
        thumbnail: randomClip.thumbnail
      };
    }));
  }, [clips, selectedClips, category?.videos]);

  const handleRearrange = useCallback(() => {
    setClips(prev => {
      const unlocked = prev.filter(c => !c.locked);
      const shuffled = [...unlocked].sort(() => Math.random() - 0.5);

      let j = 0;
      return prev.map(clip => {
        if (clip.locked) return clip;
        return { ...shuffled[j++], startTime: clip.startTime, duration: clip.duration };
      });
    });
  }, []);

  const handleApplyPreset = useCallback((preset) => {
    setSelectedPreset(preset);
    if (preset.settings) {
      setTextStyle(prev => ({ ...prev, ...preset.settings }));
    }
  }, []);

  const handleSave = useCallback(() => {
    onSave({
      id: existingVideo?.id,
      audio: selectedAudio,
      clips,
      words,
      lyrics,
      textStyle,
      cropMode,
      duration,
      bpm,
      thumbnail: clips[0]?.thumbnail || null,
      textOverlay: words[0]?.text || lyrics.split('\n')[0] || ''
    });
  }, [existingVideo, selectedAudio, clips, words, lyrics, textStyle, cropMode, duration, bpm, onSave]);

  const handleSyncLyrics = useCallback((mode) => {
    if (!lyrics.trim() || !beats.length) return;

    const lyricWords = lyrics.split(/\s+/).filter(w => w.trim());

    if (mode === 'beat') {
      // One word per beat
      const newWords = lyricWords.map((text, i) => ({
        id: `word_${Date.now()}_${i}`,
        text,
        startTime: beats[i % beats.length] || i * 0.5,
        duration: 0.4
      }));
      setWords(newWords);
    } else if (mode === 'even') {
      // Evenly spread across duration
      const interval = duration / lyricWords.length;
      const newWords = lyricWords.map((text, i) => ({
        id: `word_${Date.now()}_${i}`,
        text,
        startTime: i * interval,
        duration: interval * 0.8
      }));
      setWords(newWords);
    }

    setShowLyricsEditor(false);
  }, [lyrics, beats, duration]);

  // AI Transcription with AssemblyAI
  const handleAITranscribe = useCallback(async () => {
    // Check for API key
    const savedKey = loadApiKey('assemblyai');
    if (!savedKey) {
      setShowApiKeyModal(true);
      return;
    }

    if (!selectedAudio?.url) {
      setTranscriptionError('Please select an audio file first');
      return;
    }

    setIsTranscribing(true);
    setTranscriptionError(null);

    try {
      let audioUrl;

      // Check if URL is publicly accessible (http/https) vs local blob
      const isPublicUrl = selectedAudio.url.startsWith('http://') || selectedAudio.url.startsWith('https://');

      if (isPublicUrl) {
        // Use URL directly - AssemblyAI can fetch it server-side (avoids CORS)
        audioUrl = selectedAudio.url;
      } else {
        // Local blob URL - need to upload first
        const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
          method: 'POST',
          headers: {
            'Authorization': savedKey,
            'Content-Type': 'application/octet-stream'
          },
          body: await fetch(selectedAudio.url).then(r => r.blob())
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload audio to AssemblyAI');
        }

        const uploadResult = await uploadResponse.json();
        audioUrl = uploadResult.upload_url;
      }

      // Request transcription with word-level timestamps
      const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'Authorization': savedKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          word_boost: [],
          boost_param: 'high'
        })
      });

      if (!transcriptResponse.ok) {
        throw new Error('Failed to start transcription');
      }

      const { id: transcriptId } = await transcriptResponse.json();

      // Step 3: Poll for completion
      let transcript = null;
      while (!transcript) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          headers: { 'Authorization': savedKey }
        });

        const result = await statusResponse.json();

        if (result.status === 'completed') {
          transcript = result;
        } else if (result.status === 'error') {
          throw new Error(result.error || 'Transcription failed');
        }
        // Otherwise still processing, continue polling
      }

      // Step 4: Set the words with timestamps
      if (transcript.words && transcript.words.length > 0) {
        const newWords = transcript.words.map((w, i) => ({
          id: `word_${Date.now()}_${i}`,
          text: w.text,
          startTime: w.start / 1000, // Convert ms to seconds
          duration: (w.end - w.start) / 1000
        }));

        setWords(newWords);
        setLyrics(transcript.text);
      } else {
        setTranscriptionError('No words detected in audio');
      }

    } catch (error) {
      console.error('Transcription error:', error);
      setTranscriptionError(error.message);
    } finally {
      setIsTranscribing(false);
    }
  }, [selectedAudio]);

  const handleSaveApiKey = useCallback(() => {
    if (apiKeyInput.trim()) {
      saveApiKey('assemblyai', apiKeyInput.trim());
      setShowApiKeyModal(false);
      setApiKeyInput('');
      // Trigger transcription after saving key
      handleAITranscribe();
    }
  }, [apiKeyInput, handleAITranscribe]);

  const handleClipSelect = (index, e) => {
    if (e.shiftKey) {
      // Multi-select
      setSelectedClips(prev =>
        prev.includes(index)
          ? prev.filter(i => i !== index)
          : [...prev, index]
      );
    } else {
      setSelectedClips([index]);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={styles.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-editor-title"
    >
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 id="video-editor-title" style={styles.title}>Preview video edit</h2>
          <button
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close editor"
            title="Close (ESC)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div style={styles.body}>
          {/* Left - Preview */}
          <div style={styles.previewSection}>
            <div style={styles.previewContainer}>
              <div style={styles.preview}>
                {/* Hidden audio element for playback */}
                <audio ref={audioRef} style={{ display: 'none' }} />

                {/* Video preview - shows current clip or fallback */}
                {(currentClip?.url || category?.videos?.[0]?.url) ? (
                  <video
                    ref={videoRef}
                    src={currentClip?.url || category?.videos?.[0]?.url}
                    style={styles.previewVideo}
                    muted
                    loop
                    playsInline
                    autoPlay={isPlaying}
                  />
                ) : (
                  <div style={styles.previewPlaceholder}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="M10 9l5 3-5 3V9z"/>
                    </svg>
                    <p style={{ color: '#6b7280', marginTop: 8, fontSize: 12 }}>
                      {clips.length === 0 ? 'Add clips to preview' : 'Loading...'}
                    </p>
                  </div>
                )}

                {/* Text Overlay */}
                {currentText && (
                  <div style={{
                    ...styles.textOverlayPreview,
                    fontSize: `${textStyle.fontSize * 0.5}px`,
                    fontFamily: textStyle.fontFamily,
                    fontWeight: textStyle.fontWeight,
                    color: textStyle.color,
                    textTransform: textStyle.textCase === 'upper' ? 'uppercase' : textStyle.textCase === 'lower' ? 'lowercase' : 'none',
                    textShadow: textStyle.outline ? `2px 2px 0 ${textStyle.outlineColor}, -2px -2px 0 ${textStyle.outlineColor}, 2px -2px 0 ${textStyle.outlineColor}, -2px 2px 0 ${textStyle.outlineColor}` : 'none'
                  }}>
                    {currentText.text}
                  </div>
                )}

                {/* Safe Zone Guides */}
                <div style={styles.safeZone}>
                  <div style={styles.safeZoneTop} />
                  <div style={styles.safeZoneBottom} />
                </div>
              </div>

              {/* Progress Bar */}
              <div
                style={styles.progressBarContainer}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const percent = clickX / rect.width;
                  const newTime = percent * duration;
                  handleSeek(newTime);
                }}
              >
                <div
                  style={{
                    ...styles.progressBar,
                    width: `${(currentTime / duration) * 100}%`
                  }}
                />
                <div
                  style={{
                    ...styles.progressHandle,
                    left: `${(currentTime / duration) * 100}%`
                  }}
                />
              </div>

              {/* Playback Controls */}
              <div style={styles.playbackControls}>
                <button
                  style={styles.playButton}
                  onClick={handlePlayPause}
                >
                  {isPlaying ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16"/>
                      <rect x="14" y="4" width="4" height="16"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                  )}
                </button>
                <button style={styles.muteButton} onClick={handleToggleMute}>
                  {isMuted ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <line x1="23" y1="9" x2="17" y2="15"/>
                      <line x1="17" y1="9" x2="23" y2="15"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M15.54 8.46a5 5 0 010 7.07"/>
                      <path d="M19.07 4.93a10 10 0 010 14.14"/>
                    </svg>
                  )}
                </button>
                <span style={styles.timeDisplay}>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <button style={styles.fullscreenButton}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 3 21 3 21 9"/>
                    <polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/>
                    <line x1="3" y1="21" x2="10" y2="14"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Preset Selector */}
            <div style={styles.presetSection}>
              <span style={styles.presetLabel}>Apply preset</span>
              <select
                value={selectedPreset?.id || ''}
                onChange={(e) => {
                  const preset = presets.find(p => p.id === e.target.value);
                  if (preset) handleApplyPreset(preset);
                }}
                style={styles.presetSelect}
              >
                <option value="">Choose a preset...</option>
                {presets.map(preset => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
            </div>

            <button style={styles.makePresetButton} onClick={() => {
              const name = prompt('Preset name:');
              if (name) {
                onSavePreset({ name, settings: textStyle });
              }
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              Make this a preset
            </button>
          </div>

          {/* Right - Controls */}
          <div style={styles.controlsSection}>
            {/* Audio Selector */}
            {!selectedAudio && (
              <div style={styles.audioSelector}>
                <h3 style={styles.sectionTitle}>Select Audio</h3>
                <div style={styles.audioList}>
                  {category?.audio?.map(audio => (
                    <button
                      key={audio.id}
                      style={styles.audioItem}
                      onClick={() => handleAudioSelect(audio)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                        <path d="M15.54 8.46a5 5 0 010 7.07"/>
                      </svg>
                      <span>{audio.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedAudio && (
              <>
                {/* Tabs */}
                <div style={styles.tabs}>
                  <button
                    style={activeTab === 'caption' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('caption')}
                  >
                    Caption
                  </button>
                  <button
                    style={activeTab === 'styles' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('styles')}
                  >
                    Styles
                  </button>
                </div>

                {activeTab === 'caption' && (
                  <div style={styles.tabContent}>
                    {/* Font Controls */}
                    <div style={styles.controlRow}>
                      <div style={styles.controlGroup}>
                        <button
                          style={styles.sizeButton}
                          onClick={() => setTextStyle(s => ({ ...s, fontSize: Math.max(24, s.fontSize - 4) }))}
                        >
                          A-
                        </button>
                        <button
                          style={styles.sizeButton}
                          onClick={() => setTextStyle(s => ({ ...s, fontSize: Math.min(120, s.fontSize + 4) }))}
                        >
                          A+
                        </button>
                      </div>
                      <select
                        value={textStyle.fontFamily}
                        onChange={(e) => setTextStyle(s => ({ ...s, fontFamily: e.target.value }))}
                        style={styles.fontSelect}
                      >
                        <option value="Inter, sans-serif">Sans</option>
                        <option value="'Playfair Display', serif">Serif</option>
                        <option value="'Space Grotesk', sans-serif">Grotesk</option>
                        <option value="monospace">Mono</option>
                      </select>
                    </div>

                    {/* Outline */}
                    <div style={styles.controlRow}>
                      <button
                        style={!textStyle.outline ? styles.optionButtonActive : styles.optionButton}
                        onClick={() => setTextStyle(s => ({ ...s, outline: false }))}
                      >
                        No outline
                      </button>
                      <button
                        style={textStyle.outline ? styles.optionButtonActive : styles.optionButton}
                        onClick={() => setTextStyle(s => ({ ...s, outline: true }))}
                      >
                        Outline
                      </button>
                    </div>

                    {/* Crop Mode */}
                    <div style={styles.controlRow}>
                      <span style={styles.controlLabel}>Crop mode</span>
                      <select
                        value={cropMode}
                        onChange={(e) => setCropMode(e.target.value)}
                        style={styles.select}
                      >
                        <option value="9:16">9:16 (Vertical)</option>
                        <option value="4:3">4:3 in Vertical</option>
                        <option value="1:1">1:1 (Square)</option>
                      </select>
                    </div>

                    {/* Display Mode */}
                    <div style={styles.controlRow}>
                      <button
                        style={textStyle.displayMode === 'word' ? styles.displayModeActive : styles.displayMode}
                        onClick={() => setTextStyle(s => ({ ...s, displayMode: 'word' }))}
                      >
                        By word
                      </button>
                      <button
                        style={textStyle.displayMode === 'buildLine' ? styles.displayModeActive : styles.displayMode}
                        onClick={() => setTextStyle(s => ({ ...s, displayMode: 'buildLine' }))}
                      >
                        Build line
                      </button>
                      <button
                        style={textStyle.displayMode === 'justify' ? styles.displayModeActive : styles.displayMode}
                        onClick={() => setTextStyle(s => ({ ...s, displayMode: 'justify' }))}
                      >
                        Justify
                      </button>
                    </div>

                    {/* Case */}
                    <div style={styles.controlRow}>
                      <button
                        style={textStyle.textCase === 'default' ? styles.caseButtonActive : styles.caseButton}
                        onClick={() => setTextStyle(s => ({ ...s, textCase: 'default' }))}
                      >
                        Default
                      </button>
                      <button
                        style={textStyle.textCase === 'lower' ? styles.caseButtonActive : styles.caseButton}
                        onClick={() => setTextStyle(s => ({ ...s, textCase: 'lower' }))}
                      >
                        lower
                      </button>
                      <button
                        style={textStyle.textCase === 'upper' ? styles.caseButtonActive : styles.caseButton}
                        onClick={() => setTextStyle(s => ({ ...s, textCase: 'upper' }))}
                      >
                        UPPER
                      </button>
                    </div>

                    {/* Text Overlays */}
                    <div style={styles.textOverlaysSection}>
                      <h4 style={styles.sectionTitle}>Text overlays</h4>
                      <div style={styles.textOverlaysList}>
                        {words.length > 0 ? (
                          <div style={styles.textOverlayItem}>
                            <span style={styles.textPosition}>Center</span>
                            <span style={styles.textContent}>{words.slice(0, 5).map(w => w.text).join(' ')}{words.length > 5 ? '...' : ''}</span>
                            <span style={styles.wordCount}>{words.length} words</span>
                          </div>
                        ) : (
                          <p style={styles.noText}>No lyrics added yet</p>
                        )}
                      </div>
                      <div style={styles.lyricsButtonRow}>
                        <button
                          style={{
                            ...styles.editLyricsButton,
                            background: (!selectedAudio || isTranscribing) ? '#374151' : 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
                            color: (!selectedAudio || isTranscribing) ? '#6b7280' : '#fff',
                            border: 'none',
                            cursor: (!selectedAudio || isTranscribing) ? 'not-allowed' : 'pointer',
                            opacity: (!selectedAudio || isTranscribing) ? 0.6 : 1
                          }}
                          onClick={handleAITranscribe}
                          disabled={isTranscribing || !selectedAudio}
                          title={!selectedAudio ? 'Select audio first' : 'Transcribe with AI'}
                        >
                          {isTranscribing ? '⏳ Transcribing...' : '🤖 AI Transcribe'}
                        </button>
                        <button
                          style={styles.editLyricsButton}
                          onClick={() => setShowLyricsEditor(true)}
                        >
                          ✏️ Quick Edit
                        </button>
                        <button
                          style={styles.wordTimelineButton}
                          onClick={() => setShowWordTimeline(true)}
                        >
                          🎚️ Word Timeline
                        </button>
                      </div>
                      {!selectedAudio && !isTranscribing && (
                        <p style={{ color: '#6b7280', fontSize: '11px', marginTop: '6px' }}>
                          Select audio above to enable AI transcription
                        </p>
                      )}
                      {/* UI-42: Error panel with retry option */}
                      {transcriptionError && (
                        <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#2a0f0f', border: '1px solid #dc2626', borderRadius: '8px' }}>
                          <p style={{ color: '#fca5a5', fontSize: '12px', margin: '0 0 8px 0' }}>
                            ❌ {transcriptionError}
                          </p>
                          <button
                            onClick={() => {
                              setTranscriptionError(null);
                              handleAITranscribe();
                            }}
                            style={{ padding: '6px 12px', backgroundColor: '#dc2626', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '11px', cursor: 'pointer' }}
                          >
                            🔄 Retry
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'styles' && (
                  <div style={styles.tabContent}>
                    <div style={styles.colorSection}>
                      <label style={styles.colorLabel}>
                        Text Color
                        <input
                          type="color"
                          value={textStyle.color}
                          onChange={(e) => setTextStyle(s => ({ ...s, color: e.target.value }))}
                          style={styles.colorInput}
                        />
                      </label>
                      {textStyle.outline && (
                        <label style={styles.colorLabel}>
                          Outline Color
                          <input
                            type="color"
                            value={textStyle.outlineColor}
                            onChange={(e) => setTextStyle(s => ({ ...s, outlineColor: e.target.value }))}
                            style={styles.colorInput}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {/* Available Clips from Category */}
                <div style={styles.availableClipsSection}>
                  <div style={styles.clipsSectionHeader}>
                    <h4 style={styles.sectionTitle}>Available Clips ({category?.videos?.length || 0})</h4>
                    <button
                      style={styles.addAllButton}
                      onClick={() => {
                        if (category?.videos?.length) {
                          const newClips = category.videos.map((v, i) => ({
                            id: `clip_${Date.now()}_${i}`,
                            sourceId: v.id,
                            url: v.url,
                            thumbnail: v.thumbnail,
                            startTime: i * 2,
                            duration: 2,
                            locked: false
                          }));
                          setClips(newClips);
                        }
                      }}
                    >
                      Add All
                    </button>
                  </div>
                  <div style={styles.availableClipsGrid}>
                    {category?.videos?.length > 0 ? (
                      category.videos.map((video, i) => (
                        <div
                          key={video.id}
                          style={styles.availableClip}
                          onClick={() => {
                            setClips(prev => [...prev, {
                              id: `clip_${Date.now()}_${i}`,
                              sourceId: video.id,
                              url: video.url,
                              thumbnail: video.thumbnail,
                              startTime: prev.length * 2,
                              duration: 2,
                              locked: false
                            }]);
                          }}
                        >
                          <video src={video.url} style={styles.availableClipThumb} muted />
                          <span style={styles.availableClipName}>{video.name?.slice(0, 15) || `Clip ${i+1}`}</span>
                        </div>
                      ))
                    ) : (
                      <p style={styles.noAvailableClips}>No clips in this category</p>
                    )}
                  </div>
                </div>

                {/* Clips Timeline */}
                <div style={styles.clipsSection}>
                  <div style={styles.clipsSectionHeader}>
                    <h4 style={styles.sectionTitle}>Timeline ({clips.length} clips)</h4>
                    <div style={styles.beatsInfo}>
                      {isAnalyzing ? 'Analyzing beats...' : bpm ? `${Math.round(bpm)} BPM` : 'No beats detected'}
                    </div>
                  </div>

                  <div style={styles.clipsTimeline} ref={timelineRef}>
                    {clips.length === 0 ? (
                      <div style={styles.noClips}>
                        <p>Click clips above to add, or use Cut by beat</p>
                      </div>
                    ) : (
                      <div style={styles.clipsRow}>
                        {clips.map((clip, index) => (
                          <div
                            key={clip.id}
                            style={{
                              ...styles.clipItem,
                              ...(selectedClips.includes(index) ? styles.clipItemSelected : {})
                            }}
                            onClick={(e) => handleClipSelect(index, e)}
                          >
                            {clip.thumbnail ? (
                              <img src={clip.thumbnail} alt="" style={styles.clipThumb} />
                            ) : (
                              <video src={clip.url} style={styles.clipThumb} muted />
                            )}
                            <span style={styles.clipDuration}>
                              {clip.duration?.toFixed(1)}s
                            </span>
                            {clip.locked && <span style={styles.clipLock}>🔒</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Clip Actions */}
                  <div style={styles.clipActions}>
                    <button style={styles.clipAction} onClick={() => {}}>Combine</button>
                    <button style={styles.clipAction} onClick={() => {}}>Break</button>
                    <button style={styles.clipAction} onClick={handleReroll}>Reroll</button>
                    <button style={styles.clipAction} onClick={handleRearrange}>Rearrange</button>
                    <div style={styles.scaleControl}>
                      <span>Scale</span>
                      <input type="range" min="0.5" max="2" step="0.1" defaultValue="1" style={styles.scaleSlider} />
                      <span>1.00x</span>
                    </div>
                  </div>

                  {/* Cut Actions */}
                  <div style={styles.cutActions}>
                    <span style={styles.cutHint}>Shift + drag checkboxes to select multiple!</span>
                    <div style={styles.cutButtons}>
                      <button style={styles.cutButton} onClick={handleCutByWord}>Cut by word</button>
                      <button style={styles.cutButton} onClick={handleCutByBeat}>Cut by beat</button>
                      <button style={styles.cutButton}>Record cuts</button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.resetButton}>Reset to saved</button>
          <div style={styles.footerRight}>
            <button style={styles.cancelButton} onClick={onClose}>Cancel</button>
            <button style={styles.confirmButton} onClick={handleSave}>Confirm</button>
          </div>
        </div>

        {/* Lyrics Editor Modal */}
        {showLyricsEditor && (
          <div style={styles.lyricsOverlay}>
            <div style={styles.lyricsModal}>
              <h3 style={styles.lyricsTitle}>Edit Lyrics</h3>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Enter your lyrics here, one word or line per row..."
                style={styles.lyricsTextarea}
              />
              <div style={styles.lyricsSyncOptions}>
                <span>Sync method:</span>
                <button style={styles.syncButton} onClick={() => handleSyncLyrics('beat')}>
                  Sync to beats
                </button>
                <button style={styles.syncButton} onClick={() => handleSyncLyrics('even')}>
                  Spread evenly
                </button>
              </div>
              <div style={styles.lyricsActions}>
                <button style={styles.cancelButton} onClick={() => setShowLyricsEditor(false)}>
                  Cancel
                </button>
                <button style={styles.confirmButton} onClick={() => setShowLyricsEditor(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Word Timeline Modal */}
        {showWordTimeline && (
          <WordTimeline
            words={words}
            setWords={setWords}
            duration={duration}
            currentTime={currentTime}
            onSeek={handleSeek}
            isPlaying={isPlaying}
            onPlayPause={handlePlayPause}
            onClose={() => setShowWordTimeline(false)}
          />
        )}

        {/* API Key Modal */}
        {showApiKeyModal && (
          <div style={styles.lyricsOverlay}>
            <div style={{...styles.lyricsModal, maxWidth: '400px'}}>
              <h3 style={styles.lyricsTitle}>🔑 AssemblyAI API Key</h3>
              <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
                To use AI transcription, you need an AssemblyAI API key.
                Get one free at <a href="https://assemblyai.com" target="_blank" rel="noopener noreferrer" style={{ color: '#8B5CF6' }}>assemblyai.com</a>
              </p>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter your AssemblyAI API key..."
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '14px',
                  marginBottom: '16px'
                }}
              />
              <div style={styles.lyricsActions}>
                <button style={styles.cancelButton} onClick={() => { setShowApiKeyModal(false); setApiKeyInput(''); }}>
                  Cancel
                </button>
                <button
                  style={{...styles.confirmButton, background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)'}}
                  onClick={handleSaveApiKey}
                  disabled={!apiKeyInput.trim()}
                >
                  Save & Transcribe
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Analyzing Overlay */}
        {isAnalyzing && (
          <div style={styles.analyzingOverlay}>
            <div style={styles.spinner} />
            <p>Analyzing beats...</p>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px'
  },
  modal: {
    width: '100%',
    maxWidth: '1100px',
    maxHeight: '90vh',
    backgroundColor: '#111118',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #1f1f2e'
  },
  title: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
    margin: 0
  },
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '6px'
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  previewSection: {
    width: '320px',
    padding: '20px',
    borderRight: '1px solid #1f1f2e',
    display: 'flex',
    flexDirection: 'column'
  },
  previewContainer: {
    marginBottom: '16px'
  },
  preview: {
    position: 'relative',
    aspectRatio: '9/16',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  previewVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  previewPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  textOverlayPreview: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
    maxWidth: '90%'
  },
  safeZone: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none'
  },
  safeZoneTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '15%',
    borderBottom: '1px dashed rgba(255,255,255,0.2)'
  },
  safeZoneBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '15%',
    borderTop: '1px dashed rgba(255,255,255,0.2)'
  },
  progressBarContainer: {
    position: 'relative',
    width: '100%',
    height: '6px',
    backgroundColor: '#1f1f2e',
    borderRadius: '3px',
    marginTop: '8px',
    cursor: 'pointer'
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: '#7c3aed',
    borderRadius: '3px',
    transition: 'width 0.1s linear'
  },
  progressHandle: {
    position: 'absolute',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: '12px',
    height: '12px',
    backgroundColor: '#fff',
    borderRadius: '50%',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
  },
  playbackControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '8px'
  },
  playButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    backgroundColor: '#1f1f2e',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer'
  },
  muteButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer'
  },
  timeDisplay: {
    flex: 1,
    fontSize: '12px',
    color: '#9ca3af',
    textAlign: 'center'
  },
  fullscreenButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer'
  },
  presetSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px'
  },
  presetLabel: {
    fontSize: '13px',
    color: '#9ca3af'
  },
  presetSelect: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    outline: 'none'
  },
  makePresetButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '10px',
    backgroundColor: 'transparent',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px'
  },
  controlsSection: {
    flex: 1,
    overflow: 'auto',
    padding: '20px'
  },
  audioSelector: {
    marginBottom: '20px'
  },
  audioList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  audioItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#1f1f2e',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '13px'
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '16px'
  },
  tab: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '13px'
  },
  tabActive: {
    padding: '8px 16px',
    backgroundColor: '#1f1f2e',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px'
  },
  tabContent: {
    marginBottom: '20px'
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px'
  },
  controlGroup: {
    display: 'flex',
    backgroundColor: '#1f1f2e',
    borderRadius: '6px',
    overflow: 'hidden'
  },
  sizeButton: {
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    borderRight: '1px solid #2d2d3d'
  },
  fontSelect: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    outline: 'none'
  },
  optionButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px'
  },
  optionButtonActive: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px'
  },
  controlLabel: {
    fontSize: '13px',
    color: '#9ca3af',
    marginRight: '8px'
  },
  select: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    outline: 'none'
  },
  displayMode: {
    padding: '8px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '12px'
  },
  displayModeActive: {
    padding: '8px 12px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  caseButton: {
    padding: '8px 16px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '12px'
  },
  caseButtonActive: {
    padding: '8px 16px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  textOverlaysSection: {
    marginTop: '20px'
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#9ca3af',
    margin: '0 0 12px 0'
  },
  textOverlaysList: {
    backgroundColor: '#0a0a0f',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '12px'
  },
  textOverlayItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  textPosition: {
    fontSize: '12px',
    color: '#6b7280'
  },
  textContent: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#7c3aed',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  noText: {
    fontSize: '13px',
    color: '#6b7280',
    margin: 0
  },
  lyricsButtonRow: {
    display: 'flex',
    gap: '8px'
  },
  editLyricsButton: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  wordTimelineButton: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#facc15',
    border: 'none',
    borderRadius: '6px',
    color: '#111',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600'
  },
  wordCount: {
    fontSize: '11px',
    color: '#7c3aed',
    marginLeft: 'auto'
  },
  colorSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  colorLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '13px',
    color: '#9ca3af'
  },
  colorInput: {
    width: '40px',
    height: '40px',
    padding: 0,
    border: '2px solid #2d2d3d',
    borderRadius: '8px',
    cursor: 'pointer',
    backgroundColor: 'transparent'
  },
  availableClipsSection: {
    borderTop: '1px solid #1f1f2e',
    paddingTop: '16px',
    marginBottom: '16px'
  },
  addAllButton: {
    padding: '6px 12px',
    backgroundColor: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    cursor: 'pointer'
  },
  availableClipsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
    gap: '8px',
    maxHeight: '150px',
    overflowY: 'auto',
    padding: '8px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px'
  },
  availableClip: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    border: '2px solid transparent',
    transition: 'border-color 0.2s'
  },
  availableClipThumb: {
    width: '60px',
    height: '80px',
    objectFit: 'cover',
    borderRadius: '4px',
    backgroundColor: '#1f1f2e'
  },
  availableClipName: {
    fontSize: '10px',
    color: '#9ca3af',
    textAlign: 'center',
    maxWidth: '70px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  noAvailableClips: {
    textAlign: 'center',
    padding: '20px',
    color: '#6b7280',
    fontSize: '12px'
  },
  beatsInfo: {
    fontSize: '12px',
    color: '#9ca3af',
    padding: '4px 8px',
    backgroundColor: '#1f1f2e',
    borderRadius: '4px'
  },
  clipsSection: {
    borderTop: '1px solid #1f1f2e',
    paddingTop: '16px'
  },
  clipsSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px'
  },
  clipsFilter: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  clipsFilterLabel: {
    fontSize: '12px',
    color: '#6b7280'
  },
  clipsFilterSelect: {
    padding: '6px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '12px',
    outline: 'none'
  },
  clipsTimeline: {
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '12px',
    overflowX: 'auto'
  },
  noClips: {
    textAlign: 'center',
    padding: '20px',
    color: '#6b7280',
    fontSize: '13px'
  },
  clipsRow: {
    display: 'flex',
    gap: '8px'
  },
  clipItem: {
    position: 'relative',
    width: '80px',
    aspectRatio: '9/16',
    backgroundColor: '#1f1f2e',
    borderRadius: '6px',
    overflow: 'hidden',
    cursor: 'pointer',
    border: '2px solid transparent',
    flexShrink: 0
  },
  clipItemSelected: {
    border: '2px solid #7c3aed'
  },
  clipThumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  clipDuration: {
    position: 'absolute',
    bottom: '4px',
    left: '4px',
    padding: '2px 6px',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: '4px',
    fontSize: '10px',
    color: '#fff'
  },
  clipLock: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    fontSize: '10px'
  },
  clipActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap'
  },
  clipAction: {
    padding: '6px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  scaleControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginLeft: 'auto',
    fontSize: '12px',
    color: '#9ca3af'
  },
  scaleSlider: {
    width: '80px',
    accentColor: '#7c3aed'
  },
  cutActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  cutHint: {
    fontSize: '11px',
    color: '#6b7280'
  },
  cutButtons: {
    display: 'flex',
    gap: '8px'
  },
  cutButton: {
    padding: '8px 16px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderTop: '1px solid #1f1f2e'
  },
  resetButton: {
    padding: '10px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px'
  },
  footerRight: {
    display: 'flex',
    gap: '8px'
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#1f1f2e',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px'
  },
  confirmButton: {
    padding: '10px 20px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500'
  },
  lyricsOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10
  },
  lyricsModal: {
    width: '400px',
    backgroundColor: '#111118',
    borderRadius: '12px',
    padding: '20px'
  },
  lyricsTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 16px 0'
  },
  lyricsTextarea: {
    width: '100%',
    height: '200px',
    padding: '12px',
    backgroundColor: '#0a0a0f',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    resize: 'none',
    outline: 'none',
    marginBottom: '16px'
  },
  lyricsSyncOptions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
    fontSize: '13px',
    color: '#9ca3af'
  },
  syncButton: {
    padding: '8px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  lyricsActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px'
  },
  analyzingOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    color: '#fff'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #2d2d3d',
    borderTopColor: '#7c3aed',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  }
};

export default VideoEditorModal;
