import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import WordTimeline from './WordTimeline';
import BeatSelector from './BeatSelector';
import { saveApiKey, loadApiKey } from '../../services/storageService';
import { ErrorPanel, EmptyState as SharedEmptyState, useToast } from '../ui';
import {
  getTrimHash,
  getTrimBoundaries,
  validateLocalTimeData,
  normalizeWordsToTrimRange,
  normalizeBeatsToTrimRange
} from '../../utils/timelineNormalization';

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
  onSaveLyrics,
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

  // Lyrics saving state
  const [showSaveLyricsPrompt, setShowSaveLyricsPrompt] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState(null);
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

  // Editor state - restore tab from session
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem('stm_editor_tab') || 'caption';
    } catch { return 'caption'; }
  });
  const [cropMode, setCropMode] = useState('9:16');
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [showLyricsEditor, setShowLyricsEditor] = useState(false);
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [showBeatSelector, setShowBeatSelector] = useState(false);
  const [selectedClips, setSelectedClips] = useState([]);
  const [timelineScale, setTimelineScale] = useState(1);

  // AI Transcription state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(null);

  // Video loading state
  const [videoError, setVideoError] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);

  // Auto-save state
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
  const [recoveryData, setRecoveryData] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const autoSaveKey = `stm_autosave_${category?.id || 'default'}`;

  // Close confirmation state
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Progress bar dragging state
  const [progressDragging, setProgressDragging] = useState(false);
  const progressBarRef = useRef(null);

  // Clip drag reordering state
  const [clipDrag, setClipDrag] = useState({ dragging: false, fromIndex: -1, toIndex: -1 });

  // Beat detection
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();

  // Toast notifications
  const toast = useToast();

  // Refs
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const animationRef = useRef(null);
  const previousTrimHashRef = useRef(null);
  const isPlayingRef = useRef(false); // Ref to avoid stale closure in animation loop

  // Persist active tab to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('stm_editor_tab', activeTab);
    } catch { /* ignore */ }
  }, [activeTab]);

  // Trim change detection - invalidate dependent data when trim boundaries change
  // INVARIANT: Words and clips are in LOCAL time, so they become invalid if trim changes
  useEffect(() => {
    const { trimStart, trimEnd } = getTrimBoundaries(selectedAudio, duration);
    const currentHash = getTrimHash(trimStart, trimEnd);

    // Skip on initial mount
    if (previousTrimHashRef.current === null) {
      previousTrimHashRef.current = currentHash;
      return;
    }

    // Check if trim boundaries changed
    if (previousTrimHashRef.current !== currentHash) {
      console.log('[TrimChange] Trim boundaries changed, invalidating dependent data');
      console.log(`  Old: ${previousTrimHashRef.current}`);
      console.log(`  New: ${currentHash}`);

      // Reset playhead to start (prevent out-of-bounds position)
      setCurrentTime(0);
      if (audioRef.current) {
        audioRef.current.currentTime = trimStart;
      }

      // Clear words (they were timed to the old trim range)
      if (words.length > 0) {
        console.log(`  Clearing ${words.length} words`);
        setWords([]);
        setLyrics('');
      }

      // Note: We don't clear clips automatically because user may have manually curated them
      // But we should warn them if clips exist
      if (clips.length > 0) {
        console.warn('[TrimChange] Clips may be out of sync with new trim range');
      }

      previousTrimHashRef.current = currentHash;
    }
  }, [selectedAudio, duration, words.length, clips.length]);

  // Helper to get the best URL for a clip (prefer cloud URL over expired blob)
  const getClipUrl = useCallback((clip) => {
    if (!clip) return null;
    const localUrl = clip.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    // If it's a blob URL, use cloud URL instead (blob URLs expire)
    return isBlobUrl ? clip.url : (localUrl || clip.url);
  }, []);

  // Get current clip based on currentTime
  const currentClip = clips.find((clip, i) => {
    const nextClip = clips[i + 1];
    if (!nextClip) return true; // Last clip
    return currentTime >= clip.startTime && currentTime < nextClip.startTime;
  }) || clips[0];

  // Get audio trim boundaries (if trimmed) or full duration
  const audioStartTime = selectedAudio?.startTime || 0;
  const audioEndTime = selectedAudio?.endTime || selectedAudio?.duration || duration;
  const trimmedDuration = audioEndTime - audioStartTime;

  // Filter beats to only those within the trimmed range and normalize to local time
  // INVARIANT: All beat timestamps shown to user and used for clip creation must be in LOCAL time (0 to trimmedDuration)
  const filteredBeats = useMemo(() => {
    if (!beats.length) return [];
    // Use centralized normalization utility
    return normalizeBeatsToTrimRange(beats, audioStartTime, audioEndTime);
  }, [beats, audioStartTime, audioEndTime]);

  // Load audio and analyze beats
  useEffect(() => {
    if (selectedAudio?.url || selectedAudio?.localUrl) {
      // Determine best audio source - skip expired blob URLs
      let audioSource = null;
      const localUrl = selectedAudio.localUrl;
      const isBlobUrl = localUrl && localUrl.startsWith('blob:');

      if (selectedAudio.file instanceof File || selectedAudio.file instanceof Blob) {
        audioSource = selectedAudio.file;
        console.log('[VideoEditorModal] Using file object for beat detection');
      } else if (localUrl && !isBlobUrl) {
        audioSource = localUrl;
        console.log('[VideoEditorModal] Using localUrl for beat detection');
      } else if (selectedAudio.url) {
        audioSource = selectedAudio.url;
        console.log('[VideoEditorModal] Using cloud URL for beat detection');
      }

      if (audioSource) {
        analyzeAudio(audioSource).catch(err => {
          console.error('Beat analysis failed:', err);
        });
      }

      // Create audio element for playback - use cloud URL if blob expired
      if (audioRef.current) {
        const playbackUrl = isBlobUrl ? selectedAudio.url : (localUrl || selectedAudio.url);
        audioRef.current.src = playbackUrl;
        audioRef.current.load();
        audioRef.current.onloadedmetadata = () => {
          // Use trimmed duration if audio was trimmed, otherwise full duration
          const start = selectedAudio.startTime || 0;
          const end = selectedAudio.endTime || audioRef.current.duration;
          const effectiveDuration = end - start;
          setDuration(effectiveDuration);

          // Store the start boundary on the audioRef for child components (WordTimeline)
          // This allows them to calculate relative time for the trimmed range
          audioRef.current._startBoundary = start;
          audioRef.current._endBoundary = end;

          // Set initial playback position to trim start
          if (start > 0) {
            audioRef.current.currentTime = start;
          }
          console.log(`Audio loaded: ${start.toFixed(1)}s - ${end.toFixed(1)}s (${effectiveDuration.toFixed(1)}s)`);
        };
        // Handle audio ended
        audioRef.current.onended = () => {
          setIsPlaying(false);
          setCurrentTime(0);
        };
      }
    }
  }, [selectedAudio, analyzeAudio]);

  // Handle play/pause with trim boundary support
  useEffect(() => {
    if (!audioRef.current) return;

    const startBoundary = selectedAudio?.startTime || 0;
    const endBoundary = selectedAudio?.endTime || audioRef.current.duration || duration;

    // Update ref to avoid stale closure
    isPlayingRef.current = isPlaying;

    if (isPlaying) {
      audioRef.current.play().catch(console.error);

      // Update currentTime during playback, respecting trim boundaries
      const updateTime = () => {
        if (audioRef.current && isPlayingRef.current) {
          const actualTime = audioRef.current.currentTime;

          // Check if we've reached the end boundary
          if (actualTime >= endBoundary) {
            // Loop back to start boundary
            audioRef.current.currentTime = startBoundary;
            setCurrentTime(0); // Reset relative time to 0
          } else {
            // Set relative time (offset from start boundary)
            setCurrentTime(actualTime - startBoundary);
          }

          // Continue animation loop using ref to check current state
          if (isPlayingRef.current) {
            animationRef.current = requestAnimationFrame(updateTime);
          }
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
  }, [isPlaying, selectedAudio, duration]);

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

  // Handlers - MUST be defined before useEffect that references them (TDZ fix)
  const handleSeek = useCallback((time) => {
    // Use trimmed duration for clamping
    const effectiveDuration = (selectedAudio?.endTime || selectedAudio?.duration || duration) - (selectedAudio?.startTime || 0);
    const clampedTime = Math.max(0, Math.min(time, effectiveDuration));
    setCurrentTime(clampedTime);
    if (audioRef.current) {
      // Add audio start boundary offset for trimmed audio
      const startBoundary = selectedAudio?.startTime || 0;
      audioRef.current.currentTime = clampedTime + startBoundary;
    }
    // Video sync will happen via the useEffect
  }, [duration, selectedAudio]);

  // Progress bar dragging
  useEffect(() => {
    if (!progressDragging) return;

    const handleMouseMove = (e) => {
      if (!progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const percent = clickX / rect.width;
      const newTime = percent * trimmedDuration;
      handleSeek(newTime);
    };

    const handleMouseUp = () => {
      setProgressDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [progressDragging, trimmedDuration, handleSeek]);

  // Handle clip changes - load new video
  useEffect(() => {
    const clipUrl = getClipUrl(currentClip);
    if (videoRef.current && clipUrl) {
      // If video source changed, reload
      if (videoRef.current.src !== clipUrl) {
        console.log('[VideoEditorModal] Loading video:', clipUrl.substring(0, 60));
        videoRef.current.src = clipUrl;
        videoRef.current.load();
        if (isPlaying) {
          videoRef.current.play().catch(() => {});
        }
      }
    }
  }, [currentClip?.url, currentClip?.id, currentClip?.localUrl, getClipUrl, isPlaying]);

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

  // Handle close with confirmation if there's unsaved work
  const handleCloseRequest = useCallback(() => {
    // Check if there's any work that would be lost
    const hasWork = clips.length > 0 || words.length > 0 || selectedAudio;

    if (hasWork) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [clips.length, words.length, selectedAudio, onClose]);

  const handleConfirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    onClose();
  }, [onClose]);

  // Clear auto-save on successful save - MUST be defined before handleSave
  const clearAutoSave = useCallback(() => {
    try {
      localStorage.removeItem(autoSaveKey);
    } catch (e) {
      console.error('Failed to clear auto-save:', e);
    }
  }, [autoSaveKey]);

  // handleSave - MUST be defined before keyboard shortcuts useEffect
  const handleSave = useCallback((skipLyricsPrompt = false) => {
    const videoData = {
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
    };

    // If we have lyrics and a save handler, prompt to save to song
    if (!skipLyricsPrompt && words.length > 0 && selectedAudio?.id && onSaveLyrics) {
      setPendingSaveData(videoData);
      setShowSaveLyricsPrompt(true);
      return;
    }

    // Save directly
    onSave(videoData);
    clearAutoSave();
  }, [existingVideo, selectedAudio, clips, words, lyrics, textStyle, cropMode, duration, bpm, onSave, onSaveLyrics, clearAutoSave]);

  // Handle lyrics save prompt response
  const handleLyricsPromptResponse = useCallback((saveLyrics) => {
    if (saveLyrics && selectedAudio?.id && onSaveLyrics) {
      // Save lyrics to the song
      onSaveLyrics(selectedAudio.id, {
        name: selectedAudio.name || 'Untitled',
        words: words
      });
      toast.success('Lyrics saved to song for future videos!');
    }

    // Now save the video
    if (pendingSaveData) {
      onSave(pendingSaveData);
      clearAutoSave();
    }

    setShowSaveLyricsPrompt(false);
    setPendingSaveData(null);
  }, [selectedAudio, words, onSaveLyrics, pendingSaveData, onSave, clearAutoSave, toast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // ESC to close modal (with confirmation if there's work)
      if (e.code === 'Escape') {
        e.preventDefault();
        handleCloseRequest();
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
      // Cmd+S / Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, handleSeek, handleToggleMute, handleSave, handleCloseRequest, currentTime, duration]);

  // Prevent background scroll when modal is open (P0-UI-04)
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Check for auto-saved draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(autoSaveKey);
      if (saved && !existingVideo) {
        const data = JSON.parse(saved);
        // Only show recovery if it's recent (less than 24 hours old)
        const savedTime = data.savedAt ? new Date(data.savedAt).getTime() : 0;
        const now = Date.now();
        if (now - savedTime < 24 * 60 * 60 * 1000) {
          setRecoveryData(data);
          setShowRecoveryPrompt(true);
        } else {
          // Clear old drafts
          localStorage.removeItem(autoSaveKey);
        }
      }
    } catch (e) {
      console.error('Failed to check for auto-saved draft:', e);
    }
  }, [autoSaveKey, existingVideo]);

  // Auto-save every 30 seconds
  useEffect(() => {
    let failedOnce = false; // Track if we already warned user

    const autoSave = () => {
      // Don't auto-save if there's nothing to save
      if (!selectedAudio && clips.length === 0 && words.length === 0) return;

      try {
        const draftData = {
          audio: selectedAudio,
          clips,
          words,
          lyrics,
          textStyle,
          cropMode,
          savedAt: new Date().toISOString()
        };
        localStorage.setItem(autoSaveKey, JSON.stringify(draftData));
        setLastSaved(new Date());
        failedOnce = false; // Reset on success
      } catch (e) {
        console.error('Auto-save failed:', e);
        // Only warn once per session to avoid spamming
        if (!failedOnce) {
          toast.error('Auto-save failed. Save your work manually.');
          failedOnce = true;
        }
      }
    };

    const interval = setInterval(autoSave, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, [autoSaveKey, selectedAudio, clips, words, lyrics, textStyle, cropMode, toast]);

  // Restore from auto-saved draft
  const handleRestoreDraft = useCallback(() => {
    if (recoveryData) {
      if (recoveryData.audio) setSelectedAudio(recoveryData.audio);
      if (recoveryData.clips) setClips(recoveryData.clips);
      if (recoveryData.words) setWords(recoveryData.words);
      if (recoveryData.lyrics) setLyrics(recoveryData.lyrics);
      if (recoveryData.textStyle) setTextStyle(recoveryData.textStyle);
      if (recoveryData.cropMode) setCropMode(recoveryData.cropMode);
    }
    setShowRecoveryPrompt(false);
    setRecoveryData(null);
  }, [recoveryData]);

  // Discard auto-saved draft
  const handleDiscardDraft = useCallback(() => {
    clearAutoSave();
    setShowRecoveryPrompt(false);
    setRecoveryData(null);
  }, [clearAutoSave]);

  // Get current visible text
  const currentText = words.find(w =>
    currentTime >= w.startTime && currentTime < w.startTime + (w.duration || 0.5)
  );

  // Handlers
  const handleAudioSelect = (audio) => {
    setSelectedAudio(audio);

    // Auto-load saved lyrics from this audio if available and no lyrics exist yet
    if (audio?.savedLyrics?.length > 0 && words.length === 0) {
      const latestLyrics = audio.savedLyrics[audio.savedLyrics.length - 1];
      if (latestLyrics.words?.length > 0) {
        console.log('[Lyrics] Auto-loading saved lyrics from audio:', latestLyrics.name);
        setWords(latestLyrics.words);
        setLyrics(latestLyrics.words.map(w => w.text).join(' '));
        toast.success(`Loaded saved lyrics: "${latestLyrics.name}"`);
      }
    }
  };

  // Show the beat selector modal
  const handleCutByBeat = useCallback(() => {
    if (!filteredBeats.length) {
      toast.error('No beats detected. Try a different audio track or check the trim range.');
      return;
    }
    setShowBeatSelector(true);
  }, [filteredBeats, toast]);

  // Handle when user selects beats from the BeatSelector modal
  // Note: selectedBeatTimes are now in LOCAL time (0 to trimmedDuration)
  const handleBeatSelectionApply = useCallback((selectedBeatTimes) => {
    if (!selectedBeatTimes.length || !category?.videos?.length) {
      setShowBeatSelector(false);
      return;
    }

    // Calculate trimmed duration for the end boundary
    const effectiveDuration = (selectedAudio?.endTime || selectedAudio?.duration || duration) - (selectedAudio?.startTime || 0);
    const availableClips = category.videos;
    const newClips = [];

    // Create clips for each selected beat (cut points) - all times are LOCAL
    for (let i = 0; i < selectedBeatTimes.length; i++) {
      const startTime = selectedBeatTimes[i];
      const endTime = selectedBeatTimes[i + 1] || effectiveDuration; // Use next beat or end of trimmed audio
      const clipDuration = endTime - startTime;

      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];

      newClips.push({
        id: `clip_${Date.now()}_${i}`,
        sourceId: randomClip.id,
        url: randomClip.url,
        localUrl: randomClip.localUrl, // Include localUrl for CORS fallback
        thumbnail: randomClip.thumbnail,
        startTime: startTime,
        duration: clipDuration,
        locked: false
      });
    }

    setClips(newClips);
    setShowBeatSelector(false);
  }, [category?.videos, duration, selectedAudio]);

  const handleCutByWord = useCallback(() => {
    if (!words.length) {
      toast.error('No words to cut by. Add lyrics first.');
      return;
    }
    if (!category?.videos?.length) {
      toast.error('No clips in bank. Upload videos first.');
      return;
    }

    const availableClips = category.videos;
    const newClips = words.map((word, i) => {
      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
      return {
        id: `clip_${Date.now()}_${i}`,
        sourceId: randomClip.id,
        url: randomClip.url,
        localUrl: randomClip.localUrl, // Include localUrl for CORS fallback
        thumbnail: randomClip.thumbnail,
        startTime: word.startTime,
        duration: word.duration || 0.5,
        locked: false
      };
    });

    setClips(newClips);
    toast.success(`Created ${newClips.length} clips from words`);
  }, [words, category?.videos, toast]);

  const handleReroll = useCallback(() => {
    if (!category?.videos?.length) {
      toast.error('No clips in bank. Upload videos first.');
      return;
    }
    if (!clips.length) {
      toast.error('No clips to reroll. Cut by beat or word first.');
      return;
    }

    const availableClips = category.videos;

    // Get indices to reroll: selected clips, or clip at playhead, or all clips
    let indicesToReroll;
    if (selectedClips.length > 0) {
      indicesToReroll = selectedClips;
    } else {
      // Find clip at current playhead position
      let cumTime = 0;
      let playheadClip = -1;
      for (let i = 0; i < clips.length; i++) {
        const clipEnd = cumTime + (clips[i].duration || 0.5);
        if (currentTime >= cumTime && currentTime < clipEnd) {
          playheadClip = i;
          break;
        }
        cumTime = clipEnd;
      }
      indicesToReroll = playheadClip >= 0 ? [playheadClip] : clips.map((_, i) => i);
    }

    const rerollCount = indicesToReroll.filter(i => !clips[i]?.locked).length;
    setClips(prev => prev.map((clip, i) => {
      if (!indicesToReroll.includes(i) || clip.locked) return clip;
      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
      return {
        ...clip,
        sourceId: randomClip.id,
        url: randomClip.url,
        localUrl: randomClip.localUrl, // Include localUrl for CORS fallback
        thumbnail: randomClip.thumbnail
      };
    }));
    toast.success(`Rerolled ${rerollCount} clip${rerollCount !== 1 ? 's' : ''}`);
  }, [clips, selectedClips, category?.videos, currentTime, toast]);

  const handleRearrange = useCallback(() => {
    if (!clips.length) {
      toast.error('No clips to rearrange.');
      return;
    }
    const unlockedCount = clips.filter(c => !c.locked).length;
    if (unlockedCount < 2) {
      toast.info('Need at least 2 unlocked clips to rearrange.');
      return;
    }

    setClips(prev => {
      const unlocked = prev.filter(c => !c.locked);
      const shuffled = [...unlocked].sort(() => Math.random() - 0.5);

      let j = 0;
      return prev.map(clip => {
        if (clip.locked) return clip;
        return { ...shuffled[j++], startTime: clip.startTime, duration: clip.duration };
      });
    });
    toast.success(`Shuffled ${unlockedCount} clips`);
  }, [clips, toast]);

  // Get the clip at the current playhead position
  const getClipAtPlayhead = useCallback(() => {
    let cumTime = 0;
    for (let i = 0; i < clips.length; i++) {
      const clipEnd = cumTime + (clips[i].duration || 0.5);
      if (currentTime >= cumTime && currentTime < clipEnd) {
        return i;
      }
      cumTime = clipEnd;
    }
    return -1;
  }, [clips, currentTime]);

  // Get effective indices for operations (selected or at playhead)
  const getEffectiveClipIndices = useCallback(() => {
    if (selectedClips.length > 0) return selectedClips;
    const playheadClip = getClipAtPlayhead();
    return playheadClip >= 0 ? [playheadClip] : [];
  }, [selectedClips, getClipAtPlayhead]);

  // Combine selected clips into one (merges consecutive clips)
  const handleCombine = useCallback(() => {
    const indices = getEffectiveClipIndices();
    if (indices.length < 2) {
      // Need at least 2 clips to combine - try combining with next clip
      if (indices.length === 1 && indices[0] < clips.length - 1) {
        const idx = indices[0];
        setClips(prev => {
          const newClips = [...prev];
          const clip1 = newClips[idx];
          const clip2 = newClips[idx + 1];
          // Keep the first clip's source, sum the durations
          const combined = {
            ...clip1,
            duration: (clip1.duration || 0.5) + (clip2.duration || 0.5)
          };
          newClips.splice(idx, 2, combined);
          return newClips;
        });
        setSelectedClips([]);
        toast.success('Combined clip with next');
      } else {
        toast.info('Select clips or position playhead to combine');
      }
      return;
    }

    // Sort indices and combine consecutive clips
    const sorted = [...indices].sort((a, b) => a - b);
    let combineCount = 0;
    setClips(prev => {
      const newClips = [...prev];
      // Start from the end to preserve indices
      for (let i = sorted.length - 1; i > 0; i--) {
        const idx = sorted[i];
        const prevIdx = sorted[i - 1];
        // Only combine if consecutive
        if (idx === prevIdx + 1) {
          const combined = {
            ...newClips[prevIdx],
            duration: (newClips[prevIdx].duration || 0.5) + (newClips[idx].duration || 0.5)
          };
          newClips.splice(prevIdx, 2, combined);
          combineCount++;
        }
      }
      return newClips;
    });
    setSelectedClips([]);
    if (combineCount > 0) {
      toast.success(`Combined ${combineCount + 1} clips`);
    } else {
      toast.info('Select consecutive clips to combine');
    }
  }, [clips, getEffectiveClipIndices, toast]);

  // Break/split a clip at the playhead position
  const handleBreak = useCallback(() => {
    const clipIndex = getClipAtPlayhead();
    if (clipIndex < 0) {
      toast.info('Position playhead over a clip to split');
      return;
    }

    // Calculate where in the clip the playhead is
    let cumTime = 0;
    for (let i = 0; i < clipIndex; i++) {
      cumTime += clips[i].duration || 0.5;
    }
    const clipStartTime = cumTime;
    const clip = clips[clipIndex];
    const clipDuration = clip.duration || 0.5;
    const splitPoint = currentTime - clipStartTime;

    // Don't split if too close to edges
    if (splitPoint < 0.1 || splitPoint > clipDuration - 0.1) {
      toast.info('Move playhead away from clip edge to split');
      return;
    }

    // Create two clips from one
    const firstHalf = {
      ...clip,
      id: `${clip.id}_a`,
      duration: splitPoint
    };
    const secondHalf = {
      ...clip,
      id: `${clip.id}_b`,
      duration: clipDuration - splitPoint,
      startTime: clip.startTime + splitPoint
    };

    setClips(prev => {
      const newClips = [...prev];
      newClips.splice(clipIndex, 1, firstHalf, secondHalf);
      return newClips;
    });
    setSelectedClips([]);
    toast.success('Split clip at playhead');
  }, [clips, currentTime, getClipAtPlayhead, toast]);

  // Clip drag reorder handlers
  const handleClipDragStart = useCallback((index) => {
    setClipDrag({ dragging: true, fromIndex: index, toIndex: index });
  }, []);

  const handleClipDragOver = useCallback((index) => {
    if (clipDrag.dragging && index !== clipDrag.toIndex) {
      setClipDrag(prev => ({ ...prev, toIndex: index }));
    }
  }, [clipDrag.dragging, clipDrag.toIndex]);

  const handleClipDragEnd = useCallback(() => {
    if (clipDrag.dragging && clipDrag.fromIndex !== clipDrag.toIndex && clipDrag.fromIndex >= 0 && clipDrag.toIndex >= 0) {
      setClips(prev => {
        const newClips = [...prev];
        const [movedClip] = newClips.splice(clipDrag.fromIndex, 1);
        newClips.splice(clipDrag.toIndex, 0, movedClip);
        // Recalculate start times
        let cumTime = 0;
        return newClips.map(clip => {
          const updated = { ...clip, startTime: cumTime };
          cumTime += clip.duration || 0.5;
          return updated;
        });
      });
    }
    setClipDrag({ dragging: false, fromIndex: -1, toIndex: -1 });
  }, [clipDrag]);

  const handleApplyPreset = useCallback((preset) => {
    setSelectedPreset(preset);
    if (preset.settings) {
      // Apply text style settings
      setTextStyle(prev => ({ ...prev, ...preset.settings }));

      // Apply crop mode if specified in preset
      if (preset.settings.cropMode) {
        setCropMode(preset.settings.cropMode);
      }
    }
  }, []);

  const handleSyncLyrics = useCallback((mode) => {
    if (!lyrics.trim() || !filteredBeats.length) return;

    const lyricWords = lyrics.split(/\s+/).filter(w => w.trim());
    // Use trimmed duration for timing calculations
    const effectiveDuration = (selectedAudio?.endTime || selectedAudio?.duration || duration) - (selectedAudio?.startTime || 0);

    if (mode === 'beat') {
      // One word per beat - uses LOCAL time from filteredBeats
      const newWords = lyricWords.map((text, i) => ({
        id: `word_${Date.now()}_${i}`,
        text,
        startTime: filteredBeats[i % filteredBeats.length] || i * 0.5,
        duration: 0.4
      }));
      setWords(newWords);
    } else if (mode === 'even') {
      // Evenly spread across trimmed duration
      const interval = effectiveDuration / lyricWords.length;
      const newWords = lyricWords.map((text, i) => ({
        id: `word_${Date.now()}_${i}`,
        text,
        startTime: i * interval,
        duration: interval * 0.8
      }));
      setWords(newWords);
    }

    setShowLyricsEditor(false);
  }, [lyrics, filteredBeats, duration, selectedAudio]);

  // AI Transcription with OpenAI Whisper (much better for music/vocals)
  const handleAITranscribe = useCallback(async () => {
    // Check for API key
    const savedKey = loadApiKey('openai');
    if (!savedKey) {
      setShowApiKeyModal(true);
      return;
    }

    if (!selectedAudio?.url && !selectedAudio?.localUrl && !selectedAudio?.file) {
      setTranscriptionError('Please select an audio file first');
      return;
    }

    setIsTranscribing(true);
    setTranscriptionError(null);

    try {
      // Get trim boundaries - we'll only transcribe this portion
      const { trimStart, trimEnd } = getTrimBoundaries(selectedAudio, duration);
      const trimDuration = trimEnd - trimStart;
      console.log(`Whisper: Will transcribe ${trimDuration.toFixed(1)}s (${trimStart.toFixed(1)}s - ${trimEnd.toFixed(1)}s)`);

      if (!selectedAudio.url) {
        throw new Error('No audio URL available. Please re-upload the audio file.');
      }

      // Fetch and trim the audio
      console.log('Whisper: Fetching audio from Firebase...');
      const response = await fetch(selectedAudio.url);
      if (!response.ok) throw new Error('Failed to fetch audio');
      const fullAudioBlob = await response.blob();
      console.log(`Whisper: Fetched full audio - ${(fullAudioBlob.size / 1024 / 1024).toFixed(1)}MB`);

      // Trim the audio to just the selected range using Web Audio API
      console.log('Whisper: Trimming audio to selected range...');
      const arrayBuffer = await fullAudioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(trimStart * sampleRate);
      const endSample = Math.min(Math.floor(trimEnd * sampleRate), audioBuffer.length);
      const trimmedLength = endSample - startSample;
      console.log(`Whisper: Trimming ${(trimmedLength/sampleRate).toFixed(1)}s of audio`);

      // Create a new buffer with just the trimmed portion
      const trimmedBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        trimmedLength,
        sampleRate
      );

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel);
        const destData = trimmedBuffer.getChannelData(channel);
        for (let i = 0; i < trimmedLength; i++) {
          destData[i] = sourceData[startSample + i];
        }
      }

      // Convert to WAV
      const wavBlob = audioBufferToWav(trimmedBuffer);
      console.log(`Whisper: Trimmed audio ready - ${(wavBlob.size / 1024).toFixed(0)}KB`);
      await audioContext.close();

      // Helper function to convert AudioBuffer to WAV
      function audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sr = buffer.sampleRate;
        const format = 1;
        const bitDepth = 16;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const dataLength = buffer.length * blockAlign;
        const bufferLength = 44 + dataLength;
        const ab = new ArrayBuffer(bufferLength);
        const view = new DataView(ab);

        const writeString = (offset, string) => {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, bufferLength - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataLength, true);

        let offset = 44;
        for (let i = 0; i < buffer.length; i++) {
          for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
          }
        }
        return new Blob([ab], { type: 'audio/wav' });
      }

      // Send to OpenAI Whisper API with word-level timestamps
      console.log('Whisper: Sending to OpenAI for transcription...');
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'word');

      const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${savedKey}`
        },
        body: formData
      });

      if (!whisperResponse.ok) {
        const errorData = await whisperResponse.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Whisper API error: ${whisperResponse.status}`);
      }

      const result = await whisperResponse.json();
      console.log('Whisper: Transcription complete', result);

      // Process words from Whisper response
      if (result.words && result.words.length > 0) {
        const newWords = result.words.map((word, index) => ({
          id: `word-${Date.now()}-${index}`,
          text: word.word,
          startTime: word.start,
          duration: word.end - word.start
        }));

        console.log(`Whisper: Got ${newWords.length} words`);
        setWords(newWords);
        setLyrics(result.text || newWords.map(w => w.text).join(' '));
        toast.success(`Transcribed ${newWords.length} words with Whisper`);
      } else if (result.text) {
        // Whisper returned text but no word timestamps - create evenly spaced words
        const words = result.text.split(/\s+/).filter(w => w.length > 0);
        const wordDuration = trimDuration / words.length;
        const newWords = words.map((word, index) => ({
          id: `word-${Date.now()}-${index}`,
          text: word,
          startTime: index * wordDuration,
          duration: wordDuration * 0.9
        }));

        console.log(`Whisper: Got ${newWords.length} words (evenly spaced)`);
        setWords(newWords);
        setLyrics(result.text);
        toast.success(`Transcribed ${newWords.length} words (adjust timing in Word Timeline)`);
      } else {
        toast.error('No words detected in audio');
        setTranscriptionError('No words detected in audio');
      }

    } catch (error) {
      console.error('Transcription error:', error);
      toast.error(`Transcription failed: ${error.message}`);
      setTranscriptionError(error.message);
    } finally {
      setIsTranscribing(false);
    }
  }, [selectedAudio, duration, toast]);

  const handleSaveApiKey = useCallback(() => {
    if (apiKeyInput.trim()) {
      saveApiKey('openai', apiKeyInput.trim());
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
      onClick={(e) => e.target === e.currentTarget && handleCloseRequest()}
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
            onClick={handleCloseRequest}
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
                {(currentClip?.url || currentClip?.localUrl || category?.videos?.[0]?.url || category?.videos?.[0]?.localUrl) ? (
                  <>
                    <video
                      ref={videoRef}
                      src={getClipUrl(currentClip) || getClipUrl(category?.videos?.[0])}
                      style={{
                        ...styles.previewVideo,
                        display: videoError ? 'none' : 'block'
                      }}
                      muted
                      loop
                      playsInline
                      autoPlay={isPlaying}
                      crossOrigin="anonymous"
                      onLoadStart={() => { setVideoLoading(true); setVideoError(null); }}
                      onCanPlay={() => setVideoLoading(false)}
                      onError={(e) => {
                        console.error('Video load error:', e);
                        setVideoError('Unable to load video. This may be due to CORS restrictions.');
                        setVideoLoading(false);
                      }}
                    />
                    {videoLoading && !videoError && (
                      <div style={styles.previewPlaceholder}>
                        <div style={{ ...styles.spinner, width: 32, height: 32 }} />
                        <p style={{ color: '#9ca3af', marginTop: 8, fontSize: 12 }}>Loading video...</p>
                      </div>
                    )}
                    {videoError && (
                      <div style={styles.previewPlaceholder}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="12" y1="8" x2="12" y2="12"/>
                          <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p style={{ color: '#ef4444', marginTop: 8, fontSize: 12, textAlign: 'center', maxWidth: '90%' }}>
                          {videoError}
                        </p>
                        <p style={{ color: '#6b7280', fontSize: 10, textAlign: 'center', maxWidth: '90%', marginTop: 4 }}>
                          Try re-uploading the video or check Firebase CORS settings.
                        </p>
                      </div>
                    )}
                  </>
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

              {/* Progress Bar - Draggable */}
              <div
                ref={progressBarRef}
                style={{
                  ...styles.progressBarContainer,
                  cursor: progressDragging ? 'grabbing' : 'pointer'
                }}
                onClick={(e) => {
                  if (progressDragging) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const percent = clickX / rect.width;
                  const newTime = percent * trimmedDuration;
                  handleSeek(newTime);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setProgressDragging(true);
                  // Immediately seek to clicked position
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const percent = clickX / rect.width;
                  const newTime = percent * trimmedDuration;
                  handleSeek(newTime);
                }}
              >
                <div
                  style={{
                    ...styles.progressBar,
                    width: `${(currentTime / trimmedDuration) * 100}%`
                  }}
                />
                <div
                  style={{
                    ...styles.progressHandle,
                    left: `${(currentTime / trimmedDuration) * 100}%`,
                    cursor: 'grab',
                    width: '14px',
                    height: '14px',
                    marginLeft: '-7px',
                    marginTop: '-5px'
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setProgressDragging(true);
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
                  {formatTime(currentTime)} / {formatTime(trimmedDuration)}
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
                // Include all relevant settings in the preset
                onSavePreset({ name, settings: { ...textStyle, cropMode } });
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
                            localUrl: v.localUrl, // Include localUrl for CORS fallback
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
                              localUrl: video.localUrl, // Include localUrl for CORS fallback
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
                      {isAnalyzing ? 'Analyzing beats...' : bpm ? `${Math.round(bpm)} BPM (${filteredBeats.length} beats)` : 'No beats detected'}
                    </div>
                  </div>

                  <div style={{...styles.clipsTimeline, position: 'relative'}} ref={timelineRef}>
                    {/* Playhead indicator */}
                    {clips.length > 0 && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${(currentTime / trimmedDuration) * 100}%`,
                          top: 0,
                          bottom: 0,
                          width: '2px',
                          background: '#ef4444',
                          zIndex: 20,
                          pointerEvents: 'none',
                          boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)',
                          transition: isPlaying ? 'none' : 'left 0.1s ease-out'
                        }}
                      >
                        {/* Playhead top triangle */}
                        <div style={{
                          position: 'absolute',
                          top: '-4px',
                          left: '-5px',
                          width: 0,
                          height: 0,
                          borderLeft: '6px solid transparent',
                          borderRight: '6px solid transparent',
                          borderTop: '8px solid #ef4444'
                        }} />
                      </div>
                    )}
                    {clips.length === 0 ? (
                      <div style={styles.noClips}>
                        <p>Click clips above to add, or use Cut by beat</p>
                      </div>
                    ) : (
                      <div style={{...styles.clipsRow, transform: `scaleX(${timelineScale})`, transformOrigin: 'left center'}}>
                        {clips.map((clip, index) => (
                          <div
                            key={clip.id}
                            draggable={!clip.locked}
                            onDragStart={() => handleClipDragStart(index)}
                            onDragOver={(e) => { e.preventDefault(); handleClipDragOver(index); }}
                            onDragEnd={handleClipDragEnd}
                            style={{
                              ...styles.clipItem,
                              minWidth: `${Math.max(60, (clip.duration || 1) * 40)}px`,
                              ...(selectedClips.includes(index) ? styles.clipItemSelected : {}),
                              ...(clipDrag.dragging && clipDrag.fromIndex === index ? { opacity: 0.5 } : {}),
                              ...(clipDrag.dragging && clipDrag.toIndex === index && clipDrag.fromIndex !== index ? {
                                borderLeft: '3px solid #22c55e',
                                marginLeft: '-3px'
                              } : {}),
                              cursor: clip.locked ? 'not-allowed' : 'grab'
                            }}
                            onClick={(e) => handleClipSelect(index, e)}
                          >
                            {clip.thumbnail ? (
                              <img src={clip.thumbnail} alt="" style={styles.clipThumb} draggable={false} />
                            ) : (
                              <video src={getClipUrl(clip)} style={styles.clipThumb} muted />
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
                    <button style={styles.clipAction} onClick={handleCombine} title="Combine selected clips or clip at playhead with next">Combine</button>
                    <button style={styles.clipAction} onClick={handleBreak} title="Split clip at playhead position">Break</button>
                    <button style={styles.clipAction} onClick={handleReroll} title="Replace clip(s) with random from bank">Reroll</button>
                    <button style={styles.clipAction} onClick={handleRearrange}>Rearrange</button>
                    <div style={styles.scaleControl}>
                      <span>Scale</span>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={timelineScale}
                        onChange={(e) => setTimelineScale(parseFloat(e.target.value))}
                        style={styles.scaleSlider}
                      />
                      <span>{timelineScale.toFixed(2)}x</span>
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
          <div style={styles.footerLeft}>
            <button style={styles.resetButton}>Reset to saved</button>
            {lastSaved && (
              <span style={styles.autoSaveIndicator}>
                ✓ Auto-saved {lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div style={styles.footerRight}>
            <span style={styles.shortcutHint}>⌘S to save</span>
            <button style={styles.cancelButton} onClick={onClose}>Cancel</button>
            <button style={styles.confirmButton} onClick={handleSave}>Confirm</button>
          </div>
        </div>

        {/* Lyrics Editor Modal */}
        {showLyricsEditor && (
          <div
            style={styles.lyricsOverlay}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setShowLyricsEditor(false);
              }
            }}
          >
            <div style={styles.lyricsModal}>
              <h3 style={styles.lyricsTitle}>Edit Lyrics</h3>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Enter your lyrics here, one word or line per row..."
                style={styles.lyricsTextarea}
                autoFocus
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
            duration={trimmedDuration}
            currentTime={currentTime}
            onSeek={handleSeek}
            isPlaying={isPlaying}
            onPlayPause={handlePlayPause}
            onClose={() => setShowWordTimeline(false)}
            audioRef={audioRef}
          />
        )}

        {/* API Key Modal */}
        {showApiKeyModal && (
          <div style={styles.lyricsOverlay}>
            <div style={{...styles.lyricsModal, maxWidth: '400px'}}>
              <h3 style={styles.lyricsTitle}>🔑 OpenAI API Key</h3>
              <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
                AI transcription uses OpenAI Whisper (great for music/vocals).
                Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" style={{ color: '#8B5CF6' }}>platform.openai.com</a>
              </p>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && apiKeyInput.trim()) {
                    e.preventDefault();
                    handleSaveApiKey();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowApiKeyModal(false);
                    setApiKeyInput('');
                  }
                }}
                placeholder="Enter your OpenAI API key (sk-...)..."
                autoFocus
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

        {/* Auto-save Recovery Prompt */}
        {/* Beat Selector Modal */}
        {showBeatSelector && (
          <BeatSelector
            beats={filteredBeats}
            bpm={bpm}
            duration={trimmedDuration}
            onApply={handleBeatSelectionApply}
            onCancel={() => setShowBeatSelector(false)}
          />
        )}

        {showRecoveryPrompt && recoveryData && (
          <div style={styles.lyricsOverlay}>
            <div style={{...styles.lyricsModal, maxWidth: '420px'}}>
              <h3 style={styles.lyricsTitle}>📝 Recover Unsaved Work?</h3>
              <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
                We found an auto-saved draft from{' '}
                <strong style={{ color: '#fff' }}>
                  {recoveryData.savedAt ? new Date(recoveryData.savedAt).toLocaleString() : 'recently'}
                </strong>
              </p>
              <div style={{
                backgroundColor: '#1f1f2e',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#9ca3af'
              }}>
                <div>🎵 Audio: {recoveryData.audio?.name || 'None'}</div>
                <div>🎬 Clips: {recoveryData.clips?.length || 0}</div>
                <div>💬 Words: {recoveryData.words?.length || 0}</div>
              </div>
              <div style={styles.lyricsActions}>
                <button
                  style={styles.cancelButton}
                  onClick={handleDiscardDraft}
                >
                  Start Fresh
                </button>
                <button
                  style={{...styles.confirmButton, background: 'linear-gradient(135deg, #10b981, #059669)'}}
                  onClick={handleRestoreDraft}
                >
                  ✨ Restore Draft
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Save Lyrics to Song Prompt */}
        {showSaveLyricsPrompt && (
          <div style={styles.lyricsOverlay}>
            <div style={{...styles.lyricsModal, maxWidth: '420px'}}>
              <h3 style={styles.lyricsTitle}>💾 Save Lyrics to Song?</h3>
              <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
                You've created timed lyrics for <strong style={{ color: '#fff' }}>{selectedAudio?.name || 'this song'}</strong>.
                Save them to the song so they're automatically available next time you use it?
              </p>
              <div style={{
                backgroundColor: '#1f1f2e',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#9ca3af'
              }}>
                <div>🎤 {words.length} words with timing data</div>
                <div style={{ marginTop: '4px', fontSize: '12px', color: '#6b7280' }}>
                  "{words.slice(0, 5).map(w => w.text).join(' ')}{words.length > 5 ? '...' : ''}"
                </div>
              </div>
              <div style={styles.lyricsActions}>
                <button
                  style={styles.cancelButton}
                  onClick={() => handleLyricsPromptResponse(false)}
                >
                  No, Just This Video
                </button>
                <button
                  style={styles.confirmButton}
                  onClick={() => handleLyricsPromptResponse(true)}
                >
                  Yes, Save to Song
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Close Confirmation Dialog */}
        {showCloseConfirm && (
          <div style={styles.lyricsOverlay}>
            <div style={{...styles.lyricsModal, maxWidth: '380px'}}>
              <h3 style={styles.lyricsTitle}>Close Editor?</h3>
              <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
                You have unsaved work. Are you sure you want to close?
              </p>
              <div style={{
                backgroundColor: '#1f1f2e',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#9ca3af'
              }}>
                {selectedAudio && <div>🎵 Audio selected</div>}
                {clips.length > 0 && <div>🎬 {clips.length} clips</div>}
                {words.length > 0 && <div>💬 {words.length} words timed</div>}
              </div>
              <div style={styles.lyricsActions}>
                <button
                  style={styles.cancelButton}
                  onClick={() => setShowCloseConfirm(false)}
                >
                  Keep Editing
                </button>
                <button
                  style={{...styles.confirmButton, background: 'linear-gradient(135deg, #ef4444, #dc2626)'}}
                  onClick={handleConfirmClose}
                >
                  Close Anyway
                </button>
              </div>
            </div>
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
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0f'
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
  footerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
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
  autoSaveIndicator: {
    fontSize: '11px',
    color: '#10b981',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  footerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  shortcutHint: {
    fontSize: '11px',
    color: '#6b7280',
    padding: '4px 8px',
    backgroundColor: '#1f1f2e',
    borderRadius: '4px'
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
