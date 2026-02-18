import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import WordTimeline from './WordTimeline';
import BeatSelector from './BeatSelector';
import LyricBank from './LyricBank';
import TemplatePicker from './TemplatePicker';
import SoloClipEditor from './SoloClipEditor';
import MultiClipEditor from './MultiClipEditor';
import PhotoMontageEditor from './PhotoMontageEditor';
import AudioClipSelector from './AudioClipSelector';
import CloudImportButton from './CloudImportButton';
import EditorToolbar from './EditorToolbar';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';
import { saveApiKey, loadApiKey } from '../../services/storageService';
import { ErrorPanel, EmptyState as SharedEmptyState, useToast } from '../ui';
import {
  incrementUseCount, getLibrary, getCollections, getLyrics,
  subscribeToLibrary, subscribeToCollections, addToTextBank, MEDIA_TYPES,
  getTextBankText, getTextBankStyle
} from '../../services/libraryService';
import {
  getTrimHash,
  getTrimBoundaries,
  validateLocalTimeData,
  normalizeWordsToTrimRange,
  normalizeBeatsToTrimRange
} from '../../utils/timelineNormalization';
import log from '../../utils/logger';
import useIsMobile from '../../hooks/useIsMobile';
import { useTheme } from '../../contexts/ThemeContext';

// Default text style used for template initialization and recovery fallback
const DEFAULT_TEXT_STYLE = {
  fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: '600',
  color: '#ffffff', outline: true, outlineColor: '#000000',
  textCase: 'default', displayMode: 'word'
};

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
  onAddLyrics,
  onUpdateLyrics,
  onDeleteLyrics,
  onShowBatchPipeline,
  onClose,
  artistId = null,
  db = null,
  showTemplatePicker = false,
  schedulerEditMode = false
}) => {
  // Editor mode: null = show picker, 'montage' = current editor, 'solo-clip' = solo clip editor
  // Show picker only when explicitly creating a new video (showTemplatePicker=true)
  const [editorMode, setEditorMode] = useState(
    existingVideo?.editorMode || (showTemplatePicker ? null : 'montage')
  );

  // Theme
  const { theme } = useTheme();
  const styles = getStyles(theme);

  // Mobile responsive detection
  const { isMobile } = useIsMobile();
  const [mobilePreviewExpanded, setMobilePreviewExpanded] = useState(false);

  // ── Multi-video state (template + generated variations) ──
  // DEFAULT_TEXT_STYLE defined outside component for stable reference
  // Strip stale blob URLs from audio on load — prefer cloud URL
  const sanitizeAudio = (audio) => {
    if (!audio) return null;
    const clean = { ...audio };
    if (clean.localUrl && clean.localUrl.startsWith('blob:')) delete clean.localUrl;
    if (clean.url && clean.url.startsWith('blob:')) clean.url = null;
    if (!clean.url && !clean.localUrl && !(clean.file instanceof File || clean.file instanceof Blob)) {
      console.warn('[VideoEditorModal] Audio has stale blob URL — cleared on load');
      // Keep the object shell (with id/name) so library recovery can find the cloud URL
      if (clean.id) return clean;
      return null;
    }
    return clean;
  };
  const [allVideos, setAllVideos] = useState([{
    id: 'template',
    name: existingVideo?.name || 'Template',
    clips: existingVideo?.clips || [],
    audio: sanitizeAudio(existingVideo?.audio) || null,
    words: existingVideo?.words || [],
    lyrics: existingVideo?.lyrics || '',
    textStyle: existingVideo?.textStyle || { ...DEFAULT_TEXT_STYLE },
    cropMode: '9:16',
    duration: existingVideo?.duration || 30,
    isTemplate: true
  }]);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [generateCount, setGenerateCount] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [keepTemplateText, setKeepTemplateText] = useState('none');

  // Derived reads from active video
  const selectedAudio = allVideos[activeVideoIndex]?.audio || null;
  const clips = allVideos[activeVideoIndex]?.clips || [];
  const duration = allVideos[activeVideoIndex]?.duration || 30;
  const lyrics = allVideos[activeVideoIndex]?.lyrics || '';
  const words = allVideos[activeVideoIndex]?.words || [];
  const textStyle = allVideos[activeVideoIndex]?.textStyle || { ...DEFAULT_TEXT_STYLE };
  const cropMode = allVideos[activeVideoIndex]?.cropMode || '9:16';

  // Wrapper setters that route through allVideos
  const setSelectedAudio = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, audio: typeof updater === 'function' ? updater(cur.audio) : updater };
      return copy;
    });
  }, [activeVideoIndex]);

  const setClips = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, clips: typeof updater === 'function' ? updater(cur.clips) : updater };
      return copy;
    });
  }, [activeVideoIndex]);

  const setDuration = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, duration: typeof updater === 'function' ? updater(cur.duration) : updater };
      return copy;
    });
  }, [activeVideoIndex]);

  const setLyrics = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, lyrics: typeof updater === 'function' ? updater(cur.lyrics) : updater };
      return copy;
    });
  }, [activeVideoIndex]);

  const setWords = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, words: typeof updater === 'function' ? updater(cur.words) : updater };
      return copy;
    });
  }, [activeVideoIndex]);

  const setTextStyle = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, textStyle: typeof updater === 'function' ? updater(cur.textStyle) : updater };
      return copy;
    });
  }, [activeVideoIndex]);

  const setCropMode = useCallback((updater) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, cropMode: typeof updater === 'function' ? updater(cur.cropMode) : updater };
      return copy;
    });
  }, [activeVideoIndex]);

  // ── Undo/Redo history ──
  const getHistorySnapshot = useCallback(() => {
    const v = allVideos[activeVideoIndex];
    return v ? { clips: v.clips, audio: v.audio, words: v.words, lyrics: v.lyrics, textStyle: v.textStyle, cropMode: v.cropMode, duration: v.duration } : null;
  }, [allVideos, activeVideoIndex]);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    setAllVideos(prev => {
      const copy = [...prev];
      const cur = copy[activeVideoIndex];
      if (!cur) return prev;
      copy[activeVideoIndex] = { ...cur, ...snapshot };
      return copy;
    });
  }, [activeVideoIndex]);

  const { canUndo, canRedo, handleUndo, handleRedo, resetHistory } = useEditorHistory({
    getSnapshot: getHistorySnapshot,
    restoreSnapshot: restoreHistorySnapshot,
    deps: [clips, words, textStyle, selectedAudio],
    isEditingText: false
  });

  // Reset history when switching video variations
  useEffect(() => { resetHistory(); }, [activeVideoIndex, resetHistory]);

  // Playback state (shared across all videos)
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // ── Audio leveling state ──
  const [sourceVideoMuted, setSourceVideoMuted] = useState(existingVideo?.sourceVideoMuted ?? false);
  const [sourceVideoVolume, setSourceVideoVolume] = useState(existingVideo?.sourceVideoVolume ?? 1.0);
  const [externalAudioVolume, setExternalAudioVolume] = useState(existingVideo?.externalAudioVolume ?? 1.0);

  // Auto-select source video audio when clips exist — skip the audio picker screen
  useEffect(() => {
    if (!selectedAudio && category?.videos?.length > 0) {
      const firstVideo = category.videos[0];
      const videoUrl = firstVideo.url || firstVideo.localUrl || firstVideo.src;
      if (videoUrl) {
        setSelectedAudio({
          id: '__source_video__',
          name: 'Source Video Audio',
          url: videoUrl,
          localUrl: firstVideo.localUrl || videoUrl,
          isSourceAudio: true
        });
      }
    }
  }, []); // Run once on mount — intentionally empty deps

  // Auto-populate timeline with collection/library videos on first open
  useEffect(() => {
    if (!existingVideo && clips.length === 0 && category?.videos?.length > 0) {
      const initialClips = category.videos.map((v, i) => ({
        id: `clip_${Date.now()}_${i}`,
        sourceId: v.id,
        url: v.url || v.localUrl || v.src,
        localUrl: v.localUrl || v.url || v.src,
        thumbnail: v.thumbnailUrl || v.thumbnail,
        startTime: i * 2,
        duration: 2,
        locked: false
      }));
      setClips(initialClips);
    }
  }, []); // Run once on mount

  // ── Left sidebar state (Videos/Audio/Lyrics/Text tabs) ──
  const [activeBank, setActiveBank] = useState('videos');
  const [selectedCollection, setSelectedCollection] = useState('all');
  const [sidebarCollections, setSidebarCollections] = useState([]);
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [libraryAudio, setLibraryAudio] = useState([]);
  const [newTextA, setNewTextA] = useState('');
  const [newTextB, setNewTextB] = useState('');

  // Load library + collections for sidebar (same pattern as SlideshowEditor)
  useEffect(() => {
    if (!artistId) return;
    const cached = getLibrary(artistId);
    setLibraryVideos(cached.filter(i => i.type === MEDIA_TYPES.VIDEO));
    setLibraryAudio(cached.filter(i => i.type === MEDIA_TYPES.AUDIO));
    const cols = getCollections(artistId);
    setSidebarCollections(cols.filter(c => c.type !== 'smart'));

    if (!db) return;
    const unsubs = [];
    unsubs.push(subscribeToLibrary(db, artistId, (items) => {
      setLibraryVideos(items.filter(i => i.type === MEDIA_TYPES.VIDEO));
      setLibraryAudio(items.filter(i => i.type === MEDIA_TYPES.AUDIO));
    }));
    unsubs.push(subscribeToCollections(db, artistId, (cols) => {
      setSidebarCollections(cols.filter(c => c.type !== 'smart'));
    }));
    return () => unsubs.forEach(u => u());
  }, [db, artistId]);

  // Recover audio from library if it was sanitized (had stale blob URL but has ID)
  const audioRecoveryDoneRef = useRef(false);
  useEffect(() => {
    if (audioRecoveryDoneRef.current) return;
    const audio = allVideos[0]?.audio;
    if (!audio?.id || audio.url || audio.localUrl) return; // already has valid URL or no ID

    if (libraryAudio.length) {
      const libItem = libraryAudio.find(a => a.id === audio.id);
      if (libItem?.url && !libItem.url.startsWith('blob:')) {
        audioRecoveryDoneRef.current = true;
        setAllVideos(prev => {
          const copy = [...prev];
          copy[0] = { ...copy[0], audio: { ...copy[0].audio, url: libItem.url } };
          return copy;
        });
        log('[VideoEditorModal] Recovered audio URL from library:', libItem.url.slice(0, 50));
        return;
      }
      // Library loaded but audio not found — clear the dead audio shell
      audioRecoveryDoneRef.current = true;
      console.warn('[VideoEditorModal] Audio ID not found in library — clearing dead audio');
      setAllVideos(prev => {
        const copy = [...prev];
        copy[0] = { ...copy[0], audio: null };
        return copy;
      });
    }
  }, [libraryAudio, allVideos]);

  // Computed: visible videos based on selected collection
  const visibleVideos = useMemo(() => {
    if (selectedCollection === 'category') return category?.videos || [];
    if (selectedCollection === 'all') return libraryVideos;
    const col = sidebarCollections.find(c => c.id === selectedCollection);
    if (!col?.mediaIds?.length) return [];
    return libraryVideos.filter(v => col.mediaIds.includes(v.id));
  }, [selectedCollection, libraryVideos, sidebarCollections, category?.videos]);

  // Text banks from collections (shared with SlideshowEditor)
  const getTextBanks = useCallback(() => {
    let textBank1 = [], textBank2 = [];
    sidebarCollections.forEach(col => {
      if (col.textBank1?.length) textBank1 = [...textBank1, ...col.textBank1];
      if (col.textBank2?.length) textBank2 = [...textBank2, ...col.textBank2];
    });
    return { textBank1, textBank2 };
  }, [sidebarCollections]);

  const handleAddToTextBank = useCallback((bankNum, text) => {
    if (!text.trim() || !artistId || sidebarCollections.length === 0) return;
    const targetCol = sidebarCollections[0];
    addToTextBank(artistId, targetCol.id, bankNum, text.trim());
    setSidebarCollections(prev => prev.map(col =>
      col.id === targetCol.id
        ? { ...col, [`textBank${bankNum}`]: [...(col[`textBank${bankNum}`] || []), text.trim()] }
        : col
    ));
  }, [artistId, sidebarCollections]);

  // Text state (lyrics/words derived from allVideos above)

  // Lyrics saving state
  const [showSaveLyricsPrompt, setShowSaveLyricsPrompt] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState(null);
  // textStyle derived from allVideos above

  // Editor state - restore tab from session
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem('stm_editor_tab') || 'caption';
    } catch { return 'caption'; }
  });
  // cropMode derived from allVideos above
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [showLyricsEditor, setShowLyricsEditor] = useState(false);
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [showBeatSelector, setShowBeatSelector] = useState(false);
  const [selectedClips, setSelectedClips] = useState([]);
  const [timelineScale, setTimelineScale] = useState(1);
  const [showTextPanel, setShowTextPanel] = useState(false);
  const [clipResize, setClipResize] = useState({ active: false, clipIndex: -1, edge: null, startX: 0, startDuration: 0 });

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

  // Batch generation now uses in-editor allVideos pattern (no separate prompt)

  // Lyric bank picker state
  const [showLyricBankPicker, setShowLyricBankPicker] = useState(false);
  const [loadedBankLyricId, setLoadedBankLyricId] = useState(null); // Track which lyric from bank is loaded

  // Progress bar dragging state
  const [progressDragging, setProgressDragging] = useState(false);
  const progressBarRef = useRef(null);

  // Inline timeline playhead dragging state
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const wasPlayingBeforePlayheadDrag = useRef(false);

  // Clip drag reordering state
  const [clipDrag, setClipDrag] = useState({ dragging: false, fromIndex: -1, toIndex: -1 });

  // Waveform via shared hook (below)

  // Marquee selection state for inline timeline
  const [marqueeState, setMarqueeState] = useState(null);
  const justFinishedMarqueeRef = useRef(false);

  // Audio upload + trim state
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [audioToTrim, setAudioToTrim] = useState(null);
  const audioFileInputRef = useRef(null);

  // Beat detection
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();

  // Toast notifications
  const toast = useToast();

  // Preset prompt modal state
  const [showPresetPrompt, setShowPresetPrompt] = useState(false);
  const [presetPromptValue, setPresetPromptValue] = useState('');

  // Refs
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const videoRefB = useRef(null); // Second video element for double-buffering
  const activeVideoRef = useRef('A'); // Track which video is currently active
  const timelineRef = useRef(null);
  const animationRef = useRef(null);
  const previousTrimHashRef = useRef(null);
  const isPlayingRef = useRef(false); // Ref to avoid stale closure in animation loop
  const videoCache = useRef(new Map()); // Cache for preloaded video blobs
  const preloadQueue = useRef([]); // Queue for videos being preloaded
  const lastClipIdRef = useRef(null); // Track last clip to detect changes
  // Track if we're still in initial load phase (loading existing video with words)
  // This prevents clearing words due to minor duration changes when audio loads
  const initialLoadPhaseRef = useRef(existingVideo?.words?.length > 0);

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
      log('[TrimChange] Trim boundaries changed');
      log(`  Old: ${previousTrimHashRef.current}`);
      log(`  New: ${currentHash}`);

      // If we're in the initial load phase (loading existing video with words),
      // don't clear words - the change is just from audio metadata loading
      if (initialLoadPhaseRef.current) {
        log('[TrimChange] In initial load phase, skipping word clear');
        initialLoadPhaseRef.current = false; // Mark initial load as complete
        previousTrimHashRef.current = currentHash;
        return;
      }

      // Reset playhead to start (prevent out-of-bounds position)
      setCurrentTime(0);
      if (audioRef.current) {
        audioRef.current.currentTime = trimStart;
      }

      // Clear words (they were timed to the old trim range)
      if (words.length > 0) {
        log(`  Clearing ${words.length} words`);
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

      const isUrlBlob = selectedAudio.url && selectedAudio.url.startsWith('blob:');

      if (selectedAudio.file instanceof File || selectedAudio.file instanceof Blob) {
        audioSource = selectedAudio.file;
        log('[VideoEditorModal] Using file object for beat detection');
      } else if (localUrl && !isBlobUrl) {
        audioSource = localUrl;
        log('[VideoEditorModal] Using localUrl for beat detection');
      } else if (selectedAudio.url && !isUrlBlob) {
        audioSource = selectedAudio.url;
        log('[VideoEditorModal] Using cloud URL for beat detection');
      }

      if (audioSource) {
        analyzeAudio(audioSource).catch(err => {
          console.error('Beat analysis failed:', err);
        });
      }

      // Create audio element for playback - skip any blob URLs
      if (audioRef.current) {
        const safeLocal = localUrl && !isBlobUrl ? localUrl : null;
        const safeCloud = selectedAudio.url && !isUrlBlob ? selectedAudio.url : null;
        const playbackUrl = safeLocal || safeCloud;
        const start = selectedAudio.startTime || 0;
        const endProp = selectedAudio.endTime || null;

        const onLoadedMetadata = () => {
          if (!audioRef.current) return;
          const end = endProp || audioRef.current.duration;
          const effectiveDuration = end - start;
          setDuration(effectiveDuration);

          // Store the start boundary on the audioRef for child components (WordTimeline)
          audioRef.current._startBoundary = start;
          audioRef.current._endBoundary = end;

          // Set initial playback position to trim start
          if (start > 0) {
            audioRef.current.currentTime = start;
          }
          log(`Audio loaded: ${start.toFixed(1)}s - ${end.toFixed(1)}s (${effectiveDuration.toFixed(1)}s)`);
        };

        // Set handler BEFORE load so cached audio doesn't miss the event
        if (playbackUrl) {
          audioRef.current.onloadedmetadata = onLoadedMetadata;
          audioRef.current.src = playbackUrl;
          audioRef.current.load();
        } else {
          console.warn('[VideoEditorModal] No valid audio URL for playback — all URLs are stale blob references');
        }

        // Handle audio ended
        audioRef.current.onended = () => {
          setIsPlaying(false);
          setCurrentTime(0);
        };

        // Fallback: if audio was already cached, onloadedmetadata may not re-fire
        setTimeout(() => {
          if (audioRef.current && audioRef.current.readyState >= 1 && audioRef.current.duration > 0) {
            onLoadedMetadata();
          }
        }, 100);
      }
    }
  }, [selectedAudio, analyzeAudio]);

  // Waveform data via shared hook
  const { waveformData, clipWaveforms, waveformSource } = useWaveform({
    selectedAudio,
    clips,
    getClipUrl
  });

  // Handle play/pause with trim boundary support + wall-clock fallback
  const playStartRef = useRef(null); // wall-clock start time for fallback
  const playOffsetRef = useRef(0);   // currentTime when play was pressed

  useEffect(() => {
    const startBoundary = selectedAudio?.startTime || 0;
    const endBoundary = selectedAudio?.endTime || (audioRef.current?.duration > 0 ? audioRef.current.duration : 0) || duration;
    const effectiveDuration = endBoundary - startBoundary;

    // Update ref to avoid stale closure
    isPlayingRef.current = isPlaying;

    if (isPlaying) {
      // Try to play audio if it has a valid source
      const hasAudio = audioRef.current?.src && audioRef.current.src !== '' && audioRef.current.src !== window.location.href;
      if (hasAudio) {
        audioRef.current.play().catch(() => {});
      }

      // Record wall-clock start for fallback timing
      playStartRef.current = performance.now();
      playOffsetRef.current = currentTime;

      // Update currentTime during playback
      const updateTime = () => {
        if (!isPlayingRef.current) return;

        let relTime;

        // Primary: use audio element time if audio is actively playing
        if (hasAudio && audioRef.current && !audioRef.current.paused && audioRef.current.currentTime > 0) {
          const actualTime = audioRef.current.currentTime;

          if (effectiveDuration > 0 && actualTime >= endBoundary) {
            audioRef.current.currentTime = startBoundary;
            relTime = 0;
          } else {
            relTime = actualTime - startBoundary;
          }
        } else {
          // Fallback: use wall-clock elapsed time
          const elapsed = (performance.now() - playStartRef.current) / 1000;
          relTime = playOffsetRef.current + elapsed;

          // Loop if we've exceeded duration
          if (effectiveDuration > 0 && relTime >= effectiveDuration) {
            relTime = 0;
            playStartRef.current = performance.now();
            playOffsetRef.current = 0;
            if (hasAudio && audioRef.current) {
              audioRef.current.currentTime = startBoundary;
            }
          }
        }

        setCurrentTime(relTime);
        animationRef.current = requestAnimationFrame(updateTime);
      };
      animationRef.current = requestAnimationFrame(updateTime);
    } else {
      if (audioRef.current) audioRef.current.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  // eslint-disable-next-line
  }, [isPlaying, selectedAudio, duration]);

  // Sync video with audio time (use active video element)
  useEffect(() => {
    const activeVideo = activeVideoRef.current === 'A' ? videoRef.current : videoRefB.current;
    if (activeVideo && currentClip?.url) {
      // Calculate position within the clip
      const clipStartTime = currentClip.startTime || 0;
      const clipDuration = currentClip.duration || 2;
      const positionInClip = (currentTime - clipStartTime) % clipDuration;

      // Set video time if significantly different
      if (Math.abs(activeVideo.currentTime - positionInClip) > 0.3) {
        activeVideo.currentTime = positionInClip;
      }

      // Only call play/pause when state actually differs (prevents AbortError)
      if (isPlaying && activeVideo.paused) {
        activeVideo.play().catch(() => {});
      } else if (!isPlaying && !activeVideo.paused) {
        activeVideo.pause();
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

  // Inline timeline playhead dragging
  useEffect(() => {
    if (!playheadDragging) return;
    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';
    document.body.style.WebkitUserSelect = 'none';

    const handleMouseMove = (e) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const percent = clickX / rect.width;
      const newTime = percent * trimmedDuration;
      handleSeek(newTime);
    };

    const handleMouseUp = () => {
      setPlayheadDragging(false);
      document.body.style.userSelect = '';
      document.body.style.WebkitUserSelect = '';
      if (wasPlayingBeforePlayheadDrag.current) {
        setIsPlaying(true);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.WebkitUserSelect = '';
    };
  }, [playheadDragging, trimmedDuration, handleSeek]);

  // Double-buffered video loading for smooth clip transitions
  useEffect(() => {
    const clipUrl = getClipUrl(currentClip);
    if (!clipUrl) return;

    const clipChanged = lastClipIdRef.current !== currentClip?.id;
    lastClipIdRef.current = currentClip?.id;

    if (!clipChanged) return;

    // Get the inactive video element to preload next clip
    const activeVideo = activeVideoRef.current === 'A' ? videoRef.current : videoRefB.current;
    const inactiveVideo = activeVideoRef.current === 'A' ? videoRefB.current : videoRef.current;

    if (activeVideo && activeVideo.src !== clipUrl) {
      // Check if inactive video already has this clip loaded
      if (inactiveVideo && inactiveVideo.src === clipUrl && inactiveVideo.readyState >= 3) {
        // Swap videos - the inactive one is ready!
        activeVideoRef.current = activeVideoRef.current === 'A' ? 'B' : 'A';
        if (isPlaying) {
          inactiveVideo.play().catch(() => {});
        }
        activeVideo.pause();
      } else {
        // Load into active video
        activeVideo.src = clipUrl;
        activeVideo.load();
        if (isPlaying) {
          activeVideo.play().catch(() => {});
        }
      }
    }

    // Preload NEXT clip into inactive video
    const currentIndex = clips.findIndex(c => c.id === currentClip?.id);
    if (currentIndex >= 0 && currentIndex < clips.length - 1) {
      const nextClip = clips[currentIndex + 1];
      const nextUrl = getClipUrl(nextClip);
      if (inactiveVideo && nextUrl && inactiveVideo.src !== nextUrl) {
        inactiveVideo.src = nextUrl;
        inactiveVideo.load();
      }
    }
  }, [currentClip?.url, currentClip?.id, currentClip?.localUrl, getClipUrl, isPlaying, clips]);

  // Preload upcoming clips for smoother playback
  useEffect(() => {
    if (!clips.length) return;

    // Find current clip index
    const currentIndex = clips.findIndex(c => c.id === currentClip?.id);
    if (currentIndex === -1) return;

    // Preload next 3 clips
    const clipsToPreload = clips.slice(currentIndex + 1, currentIndex + 4);

    clipsToPreload.forEach(clip => {
      const url = getClipUrl(clip);
      if (!url || videoCache.current.has(url) || preloadQueue.current.includes(url)) return;

      preloadQueue.current.push(url);

      // Create a hidden video element to preload
      const preloadVideo = document.createElement('video');
      preloadVideo.preload = 'auto';
      preloadVideo.muted = true;
      preloadVideo.crossOrigin = 'anonymous';
      preloadVideo.src = url;

      preloadVideo.oncanplaythrough = () => {
        videoCache.current.set(url, true);
        preloadQueue.current = preloadQueue.current.filter(u => u !== url);
      };

      preloadVideo.onerror = () => {
        preloadQueue.current = preloadQueue.current.filter(u => u !== url);
      };

      // Start loading
      preloadVideo.load();
    });
  }, [clips, currentClip?.id, getClipUrl]);

  const handleToggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  // Dynamically mute/volume video when external audio is selected
  useEffect(() => {
    const hasLibraryAudio = selectedAudio && selectedAudio.url && !selectedAudio.isSourceAudio;
    const isSourceAudio = !!selectedAudio?.isSourceAudio;
    // Mute video when: global mute, OR source audio mode (audioRef provides sound),
    // OR external audio is present and source toggle is muted
    const videoMuted = isMuted || isSourceAudio || (!!hasLibraryAudio && sourceVideoMuted);
    if (videoRef.current) { videoRef.current.muted = videoMuted; videoRef.current.volume = sourceVideoVolume; }
    if (videoRefB.current) { videoRefB.current.muted = videoMuted; videoRefB.current.volume = sourceVideoVolume; }
    if (audioRef.current) { audioRef.current.muted = isMuted; audioRef.current.volume = isSourceAudio ? sourceVideoVolume : externalAudioVolume; }
  }, [isMuted, selectedAudio, sourceVideoMuted, sourceVideoVolume, externalAudioVolume]);

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
      textOverlay: words[0]?.text || lyrics.split('\n')[0] || '',
      // Audio mixing state
      sourceVideoMuted,
      sourceVideoVolume,
      externalAudioVolume
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
  }, [existingVideo, selectedAudio, clips, words, lyrics, textStyle, cropMode, duration, bpm, sourceVideoMuted, sourceVideoVolume, externalAudioVolume, onSave, onSaveLyrics, clearAutoSave]);

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

  // Auto-save every 30 seconds (saves full allVideos state)
  useEffect(() => {
    let failedOnce = false;

    const autoSave = () => {
      // Don't auto-save if there's nothing to save
      const template = allVideos[0];
      if (!template?.audio && (!template?.clips?.length) && (!template?.words?.length)) return;

      try {
        const draftData = {
          allVideos,
          activeVideoIndex,
          savedAt: new Date().toISOString()
        };
        localStorage.setItem(autoSaveKey, JSON.stringify(draftData));
        setLastSaved(new Date());
        failedOnce = false;
      } catch (e) {
        console.error('Auto-save failed:', e);
        if (!failedOnce) {
          toast.error('Auto-save failed. Save your work manually.');
          failedOnce = true;
        }
      }
    };

    const interval = setInterval(autoSave, 30000);
    return () => clearInterval(interval);
  }, [autoSaveKey, allVideos, activeVideoIndex, toast]);

  // Restore from auto-saved draft (handles both new allVideos format and legacy flat format)
  const handleRestoreDraft = useCallback(() => {
    if (recoveryData) {
      if (recoveryData.allVideos) {
        // New multi-video format
        setAllVideos(recoveryData.allVideos);
        if (recoveryData.activeVideoIndex != null) {
          setActiveVideoIndex(recoveryData.activeVideoIndex);
        }
      } else {
        // Legacy flat format — wrap into template
        setAllVideos([{
          id: 'template',
          name: 'Template',
          clips: recoveryData.clips || [],
          audio: recoveryData.audio || null,
          words: recoveryData.words || [],
          lyrics: recoveryData.lyrics || '',
          textStyle: recoveryData.textStyle || { ...DEFAULT_TEXT_STYLE },
          cropMode: recoveryData.cropMode || '9:16',
          duration: recoveryData.duration || 30,
          isTemplate: true
        }]);
        setActiveVideoIndex(0);
      }
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

  // ── Multi-video switching ──
  const switchToVideo = useCallback((index) => {
    if (index === activeVideoIndex || index < 0 || index >= allVideos.length) return;
    // Stop playback, reset UI state
    setIsPlaying(false);
    setCurrentTime(0);
    setSelectedClips([]);
    setShowWordTimeline(false);
    setShowBeatSelector(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setActiveVideoIndex(index);
  }, [activeVideoIndex, allVideos.length]);

  const handleDeleteVideo = useCallback((index) => {
    if (index === 0) return; // Can't delete template
    setAllVideos(prev => {
      const next = prev.filter((_, i) => i !== index);
      return next;
    });
    // Adjust activeVideoIndex if needed
    setActiveVideoIndex(prev => {
      if (prev === index) return 0; // Go to template
      if (prev > index) return prev - 1; // Shift left
      return prev;
    });
    toast.success('Variation deleted');
  }, [toast]);

  // ── Generate variations from template ──
  const executeGeneration = useCallback(() => {
    const template = allVideos[0];
    if (!template?.clips?.length) {
      toast.error('Add clips to template before generating');
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

    // Get extra clips from library for substitution
    const extraClips = libraryVideos
      .filter(v => !template.clips.some(c => c.sourceId === v.id))
      .map((v, i) => ({
        id: `clip_gen_${Date.now()}_${i}`,
        sourceId: v.id,
        url: v.url || v.localUrl || v.src,
        localUrl: v.localUrl || v.url || v.src,
        thumbnail: v.thumbnailUrl || v.thumbnail,
        startTime: 0,
        duration: 2,
        locked: false
      }));

    // Get text banks for cycling
    const { textBank1, textBank2 } = getTextBanks();

    const newVideos = [];
    for (let g = 0; g < generateCount; g++) {
      // Shuffle clip order
      let genClips = shuffle(template.clips);

      // Randomly substitute some clips if extras available
      if (extraClips.length > 0) {
        const subCount = Math.min(
          Math.floor(Math.random() * 3), // 0-2 substitutions
          extraClips.length
        );
        for (let s = 0; s < subCount; s++) {
          const replaceIdx = Math.floor(Math.random() * genClips.length);
          const extraIdx = Math.floor(Math.random() * extraClips.length);
          genClips = [...genClips];
          genClips[replaceIdx] = {
            ...extraClips[extraIdx],
            id: `clip_gen_${Date.now()}_${g}_${s}`,
            startTime: genClips[replaceIdx].startTime,
            duration: genClips[replaceIdx].duration
          };
        }
      }

      // Recalculate startTimes for sequential playback
      let runningTime = 0;
      genClips = genClips.map(c => {
        const clip = { ...c, id: `clip_${Date.now()}_${g}_${Math.random().toString(36).slice(2)}`, startTime: runningTime };
        runningTime += clip.duration;
        return clip;
      });

      // Cycle text from banks if available (unless keepTemplateText is active)
      let genWords = [...template.words];
      if (keepTemplateText === 'none' && textBank1.length > 0 && genWords.length > 0) {
        const bankEntry = textBank1[g % textBank1.length];
        const bankText = getTextBankText(bankEntry);
        if (bankText) {
          // Replace first word with cycled text
          genWords = genWords.map((w, i) => i === 0 ? { ...w, text: bankText } : w);
        }
      }

      newVideos.push({
        id: `gen_${Date.now()}_${g}`,
        name: `#${allVideos.length + g}`,
        clips: genClips,
        audio: template.audio,
        words: genWords,
        lyrics: template.lyrics,
        textStyle: { ...template.textStyle },
        cropMode: template.cropMode,
        duration: template.duration,
        isTemplate: false
      });
    }

    setAllVideos(prev => [...prev, ...newVideos]);
    setIsGenerating(false);
    toast.success(`Generated ${generateCount} variations`);
  }, [allVideos, generateCount, libraryVideos, getTextBanks, keepTemplateText, toast]);

  // ── Save all videos ──
  const handleSaveAllAndClose = useCallback(async () => {
    let savedCount = 0;
    for (const video of allVideos) {
      const videoData = {
        id: video.isTemplate ? existingVideo?.id : undefined,
        audio: video.audio,
        clips: video.clips,
        words: video.words,
        lyrics: video.lyrics,
        textStyle: video.textStyle,
        cropMode: video.cropMode,
        duration: video.duration,
        bpm,
        thumbnail: video.clips[0]?.thumbnail || null,
        textOverlay: video.words[0]?.text || video.lyrics.split('\n')[0] || ''
      };
      try {
        await onSave(videoData);
      } catch (err) {
        console.error(`[VideoEditorModal] Failed to save video ${savedCount}:`, err);
        toast.error(`Failed to save video. Please try again.`);
        return; // Stop on failure so user doesn't lose context
      }
      savedCount++;
    }
    clearAutoSave();
    toast.success(`Saved ${savedCount} video${savedCount !== 1 ? 's' : ''}`);
    onClose?.();
  }, [allVideos, existingVideo, bpm, onSave, clearAutoSave, toast, onClose]);

  // Get current visible text
  const currentText = words.find(w =>
    currentTime >= w.startTime && currentTime < w.startTime + (w.duration || 2)
  );

  // Handlers
  const handleAudioSelect = (audio) => {
    setSelectedAudio(audio);
    // Auto-mute source video when external audio is added; restore when removed
    const hasExternal = audio && audio.url && !audio.isSourceAudio;
    setSourceVideoMuted(!!hasExternal);

    // Auto-load saved lyrics from this audio if available and no lyrics exist yet
    if (audio?.savedLyrics?.length > 0 && words.length === 0) {
      const latestLyrics = audio.savedLyrics[audio.savedLyrics.length - 1];
      if (latestLyrics.words?.length > 0) {
        log('[Lyrics] Auto-loading saved lyrics from audio:', latestLyrics.name);
        setWords(latestLyrics.words);
        setLyrics(latestLyrics.words.map(w => w.text).join(' '));
        toast.success(`Loaded saved lyrics: "${latestLyrics.name}"`);
      }
    }
  };

  // Audio upload handler
  const handleAudioUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    const uploadedAudio = {
      id: `upload_${Date.now()}`,
      name: file.name,
      file,
      url: localUrl,
      localUrl
    };
    setAudioToTrim(uploadedAudio);
    setShowAudioTrimmer(true);
    // Reset file input so same file can be re-uploaded
    if (audioFileInputRef.current) audioFileInputRef.current.value = '';
  };

  // Audio trim save handler
  const handleAudioTrimSave = ({ startTime, endTime, duration: trimDuration, trimmedFile, trimmedName }) => {
    if (!audioToTrim) return;
    if (trimmedFile) {
      const localUrl = URL.createObjectURL(trimmedFile);
      handleAudioSelect({
        ...audioToTrim,
        id: `audio_trim_${Date.now()}`,
        name: trimmedName || trimmedFile.name,
        file: trimmedFile,
        url: localUrl,
        localUrl,
        startTime: 0,
        endTime: trimDuration,
        trimmedDuration: trimDuration,
        duration: trimDuration
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
    const availableClips = visibleVideos.length > 0 ? visibleVideos : (category?.videos || []);
    if (!selectedBeatTimes.length || !availableClips.length) {
      setShowBeatSelector(false);
      return;
    }

    // Calculate trimmed duration for the end boundary
    const effectiveDuration = (selectedAudio?.endTime || selectedAudio?.duration || duration) - (selectedAudio?.startTime || 0);
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
  }, [visibleVideos, category?.videos, duration, selectedAudio]);

  const handleCutByWord = useCallback(() => {
    if (!words.length) {
      toast.error('No words to cut by. Add lyrics first.');
      return;
    }
    const availableClips = visibleVideos.length > 0 ? visibleVideos : (category?.videos || []);
    if (!availableClips.length) {
      toast.error('No clips in bank. Upload videos first.');
      return;
    }

    const newClips = words.map((word, i) => {
      const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
      return {
        id: `clip_${Date.now()}_${i}`,
        sourceId: randomClip.id,
        url: randomClip.url,
        localUrl: randomClip.localUrl, // Include localUrl for CORS fallback
        thumbnail: randomClip.thumbnail,
        startTime: word.startTime,
        duration: word.duration || 2,
        locked: false
      };
    });

    setClips(newClips);
    toast.success(`Created ${newClips.length} clips from words`);
  }, [words, visibleVideos, category?.videos, toast]);

  const handleReroll = useCallback(() => {
    // Pull from visible collection (respects dropdown selection), fall back to category
    const availableClips = visibleVideos.length > 0 ? visibleVideos : (category?.videos || []);
    if (!availableClips.length) {
      toast.error('No clips in bank. Upload videos first.');
      return;
    }
    if (!clips.length) {
      toast.error('No clips to reroll. Cut by beat or word first.');
      return;
    }

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
        localUrl: randomClip.localUrl,
        thumbnail: randomClip.thumbnailUrl || randomClip.thumbnail
      };
    }));
    toast.success(`Rerolled ${rerollCount} clip${rerollCount !== 1 ? 's' : ''}`);
  }, [clips, selectedClips, visibleVideos, category?.videos, currentTime, toast]);

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

  // Remove/delete clips
  const handleRemoveClips = useCallback(() => {
    const indices = getEffectiveClipIndices();
    if (indices.length === 0) {
      toast.info('Select clip(s) to remove');
      return;
    }

    // Prevent deleting if only 1 clip remains
    if (clips.length - indices.length < 1) {
      toast.error('Cannot delete all clips. At least 1 clip is required.');
      return;
    }

    setClips(prev => {
      // Remove clips at specified indices (in reverse order to maintain indices)
      const newClips = prev.filter((_, index) => !indices.includes(index));

      // Recalculate cumulative start times
      let cumTime = 0;
      return newClips.map(clip => {
        const updated = { ...clip, startTime: cumTime };
        cumTime += clip.duration || 0.5;
        return updated;
      });
    });

    setSelectedClips([]);
    toast.success(`Removed ${indices.length} clip${indices.length !== 1 ? 's' : ''}`);
  }, [clips, getEffectiveClipIndices, toast]);

  // Update clip duration
  const handleUpdateClipDuration = useCallback((clipIndex, newDuration) => {
    if (clipIndex < 0 || clipIndex >= clips.length) {
      return;
    }

    const minDuration = 0.1;
    const maxDuration = 30;
    const duration = Math.max(minDuration, Math.min(maxDuration, newDuration));

    setClips(prev => {
      const newClips = [...prev];
      newClips[clipIndex] = {
        ...newClips[clipIndex],
        duration: duration
      };

      // Recalculate cumulative start times for clips after this one
      let cumTime = 0;
      return newClips.map(clip => {
        const updated = { ...clip, startTime: cumTime };
        cumTime += clip.duration || 0.5;
        return updated;
      });
    });
  }, [clips]);

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

  // Clip resize handlers (drag edges to change duration)
  const handleResizeStart = useCallback((e, clipIndex, edge) => {
    e.stopPropagation();
    e.preventDefault();
    const clip = clips[clipIndex];
    if (!clip || clip.locked) return;
    setClipResize({ active: true, clipIndex, edge, startX: e.clientX, startDuration: clip.duration || 1 });
  }, [clips]);

  useEffect(() => {
    if (!clipResize.active) return;

    const handleResizeMove = (e) => {
      const deltaX = e.clientX - clipResize.startX;
      // pixelsPerSecond must match the rendering formula: duration * 40 * timelineScale
      const pixelsPerSecond = 40 * timelineScale;
      const deltaSec = deltaX / pixelsPerSecond;
      let newDuration;
      if (clipResize.edge === 'right') {
        newDuration = clipResize.startDuration + deltaSec;
      } else {
        newDuration = clipResize.startDuration - deltaSec;
      }
      newDuration = Math.max(0.1, Math.min(30, newDuration));
      handleUpdateClipDuration(clipResize.clipIndex, newDuration);
    };

    const handleResizeEnd = () => {
      setClipResize({ active: false, clipIndex: -1, edge: null, startX: 0, startDuration: 0 });
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [clipResize, handleUpdateClipDuration, timelineScale]);

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

  // Check if server-side OpenAI key is configured
  const checkWhisperAvailable = useCallback(async () => {
    try {
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) return false;

      const token = await user.getIdToken();
      const baseUrl = window.location.hostname === 'localhost'
        ? `http://localhost:${window.location.port}`
        : '';
      const response = await fetch(`${baseUrl}/api/whisper?action=status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return false;
      const data = await response.json();
      return data.configured;
    } catch (error) {
      console.warn('Could not check Whisper status:', error.message);
      return false;
    }
  }, []);

  // AI Transcription with OpenAI Whisper via server proxy
  const handleAITranscribe = useCallback(async () => {
    // Check if server-side Whisper is available
    const available = await checkWhisperAvailable();
    if (!available) {
      setTranscriptionError('Whisper transcription is not configured on the server. Contact your admin.');
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
      let { trimStart, trimEnd } = getTrimBoundaries(selectedAudio, duration);
      let trimDuration = trimEnd - trimStart;

      // Whisper API has a 25MB file limit. At 44.1kHz stereo 16-bit WAV, that's ~145 seconds.
      // Limit to 90 seconds to be safe and provide better transcription quality.
      const MAX_TRANSCRIBE_DURATION = 90;
      if (trimDuration > MAX_TRANSCRIBE_DURATION) {
        log(`Whisper: Duration ${trimDuration.toFixed(1)}s exceeds max ${MAX_TRANSCRIBE_DURATION}s, limiting`);
        toast.info(`Audio is ${Math.floor(trimDuration)}s - transcribing first ${MAX_TRANSCRIBE_DURATION}s. Trim your audio for a specific section.`);
        trimEnd = trimStart + MAX_TRANSCRIBE_DURATION;
        trimDuration = MAX_TRANSCRIBE_DURATION;
      }

      log(`Whisper: Will transcribe ${trimDuration.toFixed(1)}s (${trimStart.toFixed(1)}s - ${trimEnd.toFixed(1)}s)`);

      if (!selectedAudio.url) {
        throw new Error('No audio URL available. Please re-upload the audio file.');
      }

      // Fetch and trim the audio
      log('Whisper: Fetching audio from Firebase...');
      const response = await fetch(selectedAudio.url);
      if (!response.ok) throw new Error('Failed to fetch audio');
      const fullAudioBlob = await response.blob();
      log(`Whisper: Fetched full audio - ${(fullAudioBlob.size / 1024 / 1024).toFixed(1)}MB`);

      // Trim the audio to just the selected range using Web Audio API
      log('Whisper: Trimming audio to selected range...');
      const arrayBuffer = await fullAudioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(trimStart * sampleRate);
      const endSample = Math.min(Math.floor(trimEnd * sampleRate), audioBuffer.length);
      const trimmedLength = endSample - startSample;
      log(`Whisper: Trimming ${(trimmedLength/sampleRate).toFixed(1)}s of audio`);

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
      log(`Whisper: Trimmed audio ready - ${(wavBlob.size / 1024).toFixed(0)}KB`);
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

      // Send to server proxy (keeps API key server-side)
      log('Whisper: Sending to server proxy for transcription...');
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'word');

      const { getAuth: getAuthForToken } = await import('firebase/auth');
      const authForToken = getAuthForToken();
      const firebaseToken = await authForToken.currentUser?.getIdToken();
      const proxyBase = window.location.hostname === 'localhost'
        ? `http://localhost:${window.location.port}`
        : '';
      const whisperResponse = await fetch(`${proxyBase}/api/transcribe`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firebaseToken}`
        },
        body: formData
      });

      if (!whisperResponse.ok) {
        const errorData = await whisperResponse.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Whisper API error: ${whisperResponse.status}`);
      }

      const result = await whisperResponse.json();
      log('Whisper: Transcription complete', result);

      // Process words from Whisper response
      if (result.words && result.words.length > 0) {
        const newWords = result.words.map((word, index) => ({
          id: `word-${Date.now()}-${index}`,
          text: word.word,
          startTime: word.start,
          duration: word.end - word.start
        }));

        log(`Whisper: Got ${newWords.length} words`);
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

        log(`Whisper: Got ${newWords.length} words (evenly spaced)`);
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
    if (justFinishedMarqueeRef.current) {
      justFinishedMarqueeRef.current = false;
      return;
    }
    if (e.shiftKey) {
      // Multi-select — don't move playhead
      setSelectedClips(prev =>
        prev.includes(index)
          ? prev.filter(i => i !== index)
          : [...prev, index]
      );
    } else {
      setSelectedClips([index]);
      // Jump playhead to clip start time
      const clip = clips[index];
      if (clip) {
        handleSeek(clip.startTime);
      }
    }
  };

  // Marquee selection: pointer down on timeline background
  const handleTimelineMarqueeDown = (e) => {
    if (e.target.closest('[data-clip-block]')) return;
    if (playheadDragging) return;
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = timelineRef.current.scrollLeft || 0;
    const startX = e.clientX - rect.left + scrollLeft;
    const startY = e.clientY - rect.top;
    setMarqueeState({ startX, startY, currentX: startX, currentY: startY });
    if (!e.shiftKey) setSelectedClips([]);
  };

  // Marquee selection: pointermove / pointerup effect
  useEffect(() => {
    if (!marqueeState) return;
    const handlePointerMove = (e) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scrollLeft = timelineRef.current?.scrollLeft || 0;
      const currentX = e.clientX - rect.left + scrollLeft;
      const currentY = e.clientY - rect.top;
      setMarqueeState(prev => ({ ...prev, currentX, currentY }));
      // Calculate which clips overlap
      const pxPerSec = 40 * timelineScale;
      const minX = Math.min(marqueeState.startX, currentX);
      const maxX = Math.max(marqueeState.startX, currentX);
      const indices = [];
      let offset = 0;
      clips.forEach((clip, i) => {
        const clipW = Math.max(50, (clip.duration || 1) * pxPerSec);
        const clipRight = offset + clipW;
        if (clipRight >= minX && offset <= maxX) indices.push(i);
        offset = clipRight;
      });
      setSelectedClips(indices);
    };
    const handlePointerUp = () => {
      const hasDragged = marqueeState && (
        Math.abs(marqueeState.currentX - marqueeState.startX) > 5 ||
        Math.abs(marqueeState.currentY - marqueeState.startY) > 5
      );
      if (hasDragged) justFinishedMarqueeRef.current = true;
      setMarqueeState(null);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [marqueeState, clips, timelineScale]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Template Picker (no mode selected yet) ──
  if (!editorMode) {
    return (
      <TemplatePicker
        onSelect={(mode) => setEditorMode(mode)}
        onClose={onClose}
        clipCount={category?.videos?.length || 0}
      />
    );
  }

  // ── Solo Clip mode ──
  if (editorMode === 'solo-clip') {
    return (
      <SoloClipEditor
        category={category}
        existingVideo={existingVideo}
        onSave={onSave}
        onClose={onClose}
        artistId={artistId}
        db={db}
        onSaveLyrics={onSaveLyrics}
        onAddLyrics={onAddLyrics}
        onUpdateLyrics={onUpdateLyrics}
        onDeleteLyrics={onDeleteLyrics}
      />
    );
  }

  // ── Multi-Clip mode ──
  if (editorMode === 'multi-clip') {
    return (
      <MultiClipEditor
        category={category}
        existingVideo={existingVideo}
        onSave={onSave}
        onClose={onClose}
        artistId={artistId}
        db={db}
        onSaveLyrics={onSaveLyrics}
        onAddLyrics={onAddLyrics}
        onUpdateLyrics={onUpdateLyrics}
        onDeleteLyrics={onDeleteLyrics}
      />
    );
  }

  // ── Photo Montage mode ──
  if (editorMode === 'photo-montage') {
    return (
      <PhotoMontageEditor
        category={category}
        existingVideo={existingVideo}
        onSave={onSave}
        onClose={onClose}
        artistId={artistId}
        db={db}
        onSaveLyrics={onSaveLyrics}
        onAddLyrics={onAddLyrics}
        onUpdateLyrics={onUpdateLyrics}
        onDeleteLyrics={onDeleteLyrics}
      />
    );
  }

  // ── Montage mode (existing editor) ──
  return (
    <div
      style={{
        ...styles.overlay,
        ...(isMobile ? { padding: 0 } : {})
      }}
      onClick={(e) => e.target === e.currentTarget && handleCloseRequest()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-editor-title"
    >
      <div style={{
        ...styles.modal,
        ...(isMobile ? {
          maxWidth: '100%',
          maxHeight: '100vh',
          height: '100vh',
          borderRadius: 0
        } : {})
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          ...styles.header,
          ...(isMobile ? { padding: '12px 16px' } : {})
        }}>
          <button
            id="video-editor-title"
            style={{
              ...styles.studioButton,
              ...(isMobile ? { padding: '6px 10px', fontSize: '14px' } : {})
            }}
            onClick={handleCloseRequest}
            title="Back to categories"
          >
            <svg width={isMobile ? 18 : 20} height={isMobile ? 18 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5,3 19,12 5,21" fill="currentColor"/>
            </svg>
            {!isMobile && <span>Studio</span>}
          </button>
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

        <div style={{
          ...styles.body,
          ...(isMobile ? { flexDirection: 'column', overflow: 'auto' } : {})
        }}>
          {/* ── LEFT SIDEBAR: Videos / Audio / Lyrics / Text ── */}
          {!isMobile && (
            <div style={styles.leftPanel}>
              {/* Collection dropdown */}
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${theme.border.subtle}` }}>
                <select
                  value={selectedCollection}
                  onChange={(e) => setSelectedCollection(e.target.value)}
                  style={styles.sourceDropdown}
                >
                  <option value="category">Selected Clips</option>
                  <option value="all">All Videos (Library)</option>
                  {sidebarCollections.map(col => (
                    <option key={col.id} value={col.id}>{col.name}</option>
                  ))}
                </select>
              </div>

              {/* Videos + Text shown together (no tabs — Audio/Lyrics moved to toolbar) */}
              <div style={styles.bankContent}>
                {/* ── Videos section ── */}
                {(
                  <div>
                    {visibleVideos.length === 0 ? (
                      <div style={{ padding: '24px', textAlign: 'center', color: theme.text.muted, fontSize: '13px' }}>
                        No videos in this collection
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontSize: '11px', color: theme.text.muted }}>{visibleVideos.length} clips</span>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <CloudImportButton
                              artistId={artistId}
                              db={db}
                              mediaType="video"
                              compact
                              onImportMedia={(files) => {
                                const newVids = files.map((f, i) => ({
                                  id: `import_${Date.now()}_${i}`,
                                  name: f.name,
                                  url: f.url,
                                  localUrl: f.localUrl,
                                  type: 'video'
                                }));
                                setLibraryVideos(prev => [...prev, ...newVids]);
                              }}
                            />
                            <button
                              style={{ fontSize: '11px', color: '#14b8a6', background: 'none', border: 'none', cursor: 'pointer' }}
                              onClick={() => {
                                const newClips = visibleVideos.map((v, i) => ({
                                  id: `clip_${Date.now()}_${i}`,
                                  sourceId: v.id,
                                  url: v.url || v.localUrl,
                                  localUrl: v.localUrl || v.url,
                                  thumbnail: v.thumbnailUrl || v.thumbnail,
                                  startTime: i * 2,
                                  duration: 2,
                                  locked: false
                                }));
                                setClips(newClips);
                              }}
                            >Add All</button>
                          </div>
                        </div>
                        <div style={styles.sidebarClipGrid}>
                          {visibleVideos.map((video, i) => {
                            const isInTimeline = clips.some(clip => clip.sourceId === video.id);
                            return (
                            <div
                              key={video.id || i}
                              style={{ ...styles.sidebarClip, position: 'relative', border: isInTimeline ? '1px solid rgba(34,197,94,0.4)' : undefined }}
                              onClick={() => {
                                setClips(prev => {
                                  const newClip = {
                                    id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                    sourceId: video.id,
                                    url: video.url || video.localUrl,
                                    localUrl: video.localUrl || video.url,
                                    thumbnail: video.thumbnailUrl || video.thumbnail,
                                    startTime: prev.length * 2,
                                    duration: 2,
                                    locked: false
                                  };
                                  return [...prev, newClip];
                                });
                                if (video.id && category?.artistId) incrementUseCount(category.artistId, video.id);
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.borderColor = isInTimeline ? 'rgba(34,197,94,0.6)' : 'rgba(20,184,166,0.5)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.borderColor = isInTimeline ? 'rgba(34,197,94,0.4)' : 'transparent'; }}
                            >
                              {/* In-timeline indicator */}
                              {isInTimeline && (
                                <div style={{
                                  position: 'absolute', top: 3, right: 3, zIndex: 2,
                                  width: '18px', height: '18px', borderRadius: '50%',
                                  backgroundColor: '#22c55e', display: 'flex',
                                  alignItems: 'center', justifyContent: 'center',
                                  fontSize: '11px', color: '#fff', fontWeight: 'bold',
                                  boxShadow: `0 1px 4px ${theme.overlay.light}`
                                }}>✓</div>
                              )}
                              <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: '4px', overflow: 'hidden', backgroundColor: theme.bg.page }}>
                                {(video.thumbnailUrl || video.thumbnail) ? (
                                  <img src={video.thumbnailUrl || video.thumbnail} alt={video.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🎬</div>
                                )}
                              </div>
                              <div style={{ fontSize: '10px', color: theme.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '4px' }}>
                                {(video.name || video.metadata?.originalName || 'Clip').substring(0, 20)}
                              </div>
                            </div>
                          );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── Text Banks (always visible below videos) ── */}
                {(() => {
                  const { textBank1, textBank2 } = getTextBanks();
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.border.subtle}` }}>
                      {/* Text Bank A */}
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#14b8a6', marginBottom: '8px' }}>Text Bank A</div>
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
                            style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#14b8a6', color: '#fff', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}
                          >+</button>
                        </div>
                        {textBank1.map((text, idx) => (
                          <div key={idx} style={styles.textBankItem}>
                            <span
                              style={{ flex: 1, fontSize: '12px', cursor: 'pointer' }}
                              onClick={() => {
                                const t = getTextBankText(text);
                                const newWord = { id: `word_${Date.now()}`, text: t, startTime: currentTime, duration: 2 };
                                setWords(prev => [...prev, newWord]);
                              }}
                              title="Click to add as word at playhead"
                            >{getTextBankText(text)}</span>
                          </div>
                        ))}
                        {textBank1.length === 0 && <div style={{ fontSize: '11px', color: theme.text.muted }}>No text added yet</div>}
                      </div>
                      {/* Text Bank B */}
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '8px' }}>Text Bank B</div>
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
                            style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#f59e0b', color: '#fff', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}
                          >+</button>
                        </div>
                        {textBank2.map((text, idx) => (
                          <div key={idx} style={styles.textBankItem}>
                            <span
                              style={{ flex: 1, fontSize: '12px', cursor: 'pointer' }}
                              onClick={() => {
                                const t = getTextBankText(text);
                                const newWord = { id: `word_${Date.now()}`, text: t, startTime: currentTime, duration: 2 };
                                setWords(prev => [...prev, newWord]);
                              }}
                              title="Click to add as word at playhead"
                            >{getTextBankText(text)}</span>
                          </div>
                        ))}
                        {textBank2.length === 0 && <div style={{ fontSize: '11px', color: theme.text.muted }}>No text added yet</div>}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Main Area - Preview + Timeline */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
            ...(isMobile ? {
              width: '100%',
              flexShrink: 0
            } : {})
          }}>
            <div style={styles.previewContainer}>
              <div style={styles.preview}>
                {/* Hidden audio element for playback */}
                <audio ref={audioRef} style={{ display: 'none' }} />

                {/* Video preview - double-buffered for smooth transitions */}
                {(currentClip?.url || currentClip?.localUrl || category?.videos?.[0]?.url || category?.videos?.[0]?.localUrl) ? (
                  <>
                    {/* Primary video element (A) */}
                    <video
                      ref={videoRef}
                      src={getClipUrl(currentClip) || getClipUrl(category?.videos?.[0])}
                      style={{
                        ...styles.previewVideo,
                        display: videoError ? 'none' : 'block',
                        opacity: activeVideoRef.current === 'A' ? 1 : 0,
                        position: 'absolute',
                        top: 0,
                        left: 0
                      }}
                      loop
                      playsInline
                      preload="auto"
                      autoPlay={isPlaying && activeVideoRef.current === 'A'}
                      crossOrigin="anonymous"
                      onLoadStart={() => { if (activeVideoRef.current === 'A' && !isPlaying) { setVideoLoading(true); setVideoError(null); } }}
                      onCanPlay={() => { if (activeVideoRef.current === 'A') setVideoLoading(false); }}
                      onLoadedData={() => { if (activeVideoRef.current === 'A') setVideoLoading(false); }}
                      onPlaying={() => setVideoLoading(false)}
                      onError={(e) => {
                        console.error('Video A load error:', e);
                        if (activeVideoRef.current === 'A') {
                          setVideoError('Unable to load video. This may be due to CORS restrictions.');
                          setVideoLoading(false);
                        }
                      }}
                    />
                    {/* Secondary video element (B) - for preloading next clip */}
                    <video
                      ref={videoRefB}
                      style={{
                        ...styles.previewVideo,
                        display: videoError ? 'none' : 'block',
                        opacity: activeVideoRef.current === 'B' ? 1 : 0,
                        position: 'absolute',
                        top: 0,
                        left: 0
                      }}
                      loop
                      playsInline
                      preload="auto"
                      autoPlay={isPlaying && activeVideoRef.current === 'B'}
                      crossOrigin="anonymous"
                      onLoadStart={() => { if (activeVideoRef.current === 'B' && !isPlaying) { setVideoLoading(true); setVideoError(null); } }}
                      onCanPlay={() => { if (activeVideoRef.current === 'B') setVideoLoading(false); }}
                      onLoadedData={() => { if (activeVideoRef.current === 'B') setVideoLoading(false); }}
                      onPlaying={() => setVideoLoading(false)}
                      onError={(e) => {
                        console.error('Video B load error:', e);
                        if (activeVideoRef.current === 'B') {
                          setVideoError('Unable to load video. This may be due to CORS restrictions.');
                          setVideoLoading(false);
                        }
                      }}
                    />
                    {videoLoading && !videoError && (
                      <div style={styles.previewPlaceholder}>
                        <div style={{ ...styles.spinner, width: 32, height: 32 }} />
                        <p style={{ color: theme.text.secondary, marginTop: 8, fontSize: 12 }}>Loading video...</p>
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
                        <p style={{ color: theme.text.muted, fontSize: 10, textAlign: 'center', maxWidth: '90%', marginTop: 4 }}>
                          Try re-uploading the video or check Firebase CORS settings.
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={styles.previewPlaceholder}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={theme.text.muted} strokeWidth="1.5">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="M10 9l5 3-5 3V9z"/>
                    </svg>
                    <p style={{ color: theme.text.muted, marginTop: 8, fontSize: 12 }}>
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

                {/* Crop Overlay */}
                {cropMode === '4:3' && (
                  <>
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0,
                      height: 'calc((100% - (100% * 0.75)) / 2)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderBottom: '2px dashed rgba(255, 255, 255, 0.4)',
                      pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8
                    }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cropped</span>
                    </div>
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: 'calc((100% - (100% * 0.75)) / 2)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderTop: '2px dashed rgba(255, 255, 255, 0.4)',
                      pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8
                    }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cropped</span>
                    </div>
                  </>
                )}
                {cropMode === '1:1' && (
                  <>
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0,
                      height: 'calc((100% - (100% * 0.5625)) / 2)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderBottom: '2px dashed rgba(255, 255, 255, 0.4)',
                      pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8
                    }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cropped</span>
                    </div>
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: 'calc((100% - (100% * 0.5625)) / 2)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderTop: '2px dashed rgba(255, 255, 255, 0.4)',
                      pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8
                    }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cropped</span>
                    </div>
                  </>
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
                {!isMobile && (
                  <button style={styles.fullscreenButton} onClick={() => {
                    const el = activeVideoRef.current === 'A' ? videoRef.current : videoRefB.current;
                    if (el?.requestFullscreen) el.requestFullscreen();
                  }} title="Fullscreen">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 3 21 3 21 9"/>
                      <polyline points="9 21 3 21 3 15"/>
                      <line x1="21" y1="3" x2="14" y2="10"/>
                      <line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                  </button>
                )}
                {/* Mobile expand/collapse button */}
                {isMobile && (
                  <button
                    style={{
                      padding: '8px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: theme.text.secondary,
                      cursor: 'pointer'
                    }}
                    onClick={() => setMobilePreviewExpanded(!mobilePreviewExpanded)}
                    title={mobilePreviewExpanded ? 'Collapse preview' : 'Expand preview'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {mobilePreviewExpanded ? (
                        <polyline points="18 15 12 9 6 15" />
                      ) : (
                        <polyline points="6 9 12 15 18 9" />
                      )}
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Controls + Timeline — compact scrollable section */}
            <div style={{ flexShrink: 1, overflow: 'auto', minHeight: 0 }}>

            {/* Preset + Audio compact bar */}
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

            {/* ── Audio Info Bar ── */}
            {selectedAudio && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '4px 12px',
                backgroundColor: 'rgba(139, 92, 246, 0.08)',
                borderBottom: '1px solid rgba(139, 92, 246, 0.15)'
              }}>
                <span style={{ fontSize: '12px', color: theme.text.primary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedAudio.name}
                  {selectedAudio.isTrimmed && <span style={{ marginLeft: '6px', fontSize: '10px', padding: '1px 5px', backgroundColor: 'rgba(139,92,246,0.2)', borderRadius: '4px', color: '#a78bfa' }}>Trimmed</span>}
                </span>
                <button
                  onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}
                  style={{
                    padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                    border: '1px solid rgba(139,92,246,0.3)', backgroundColor: 'transparent',
                    color: '#a78bfa', cursor: 'pointer'
                  }}
                >Trim</button>
                <button
                  onClick={() => {
                    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
                    if (animationRef.current) cancelAnimationFrame(animationRef.current);
                    setSelectedAudio(null);
                    setIsPlaying(false);
                    setCurrentTime(0);
                    setDuration(0);
                    setSourceVideoMuted(false);
                  }}
                  style={{
                    padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                    border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'transparent',
                    color: '#ef4444', cursor: 'pointer'
                  }}
                >Remove</button>
              </div>
            )}

            {/* ── Timeline Section (moved from right panel to main area) ── */}
            <div style={{ ...styles.clipsSection, borderTop: `1px solid ${theme.border.subtle}` }}>
              <div style={styles.clipsSectionHeader}>
                <h4 style={styles.sectionTitle}>Timeline ({clips.length} clips)</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={styles.beatsInfo}>
                    {isAnalyzing ? 'Analyzing beats...' : bpm ? `${Math.round(bpm)} BPM (${filteredBeats.length} beats)` : 'No beats detected'}
                  </div>
                  <button
                    onClick={() => setShowTextPanel(p => !p)}
                    style={{
                      padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                      border: `1px solid ${showTextPanel ? theme.accent.primary : theme.border.default}`,
                      backgroundColor: showTextPanel ? theme.accent.primary + '22' : 'transparent',
                      color: showTextPanel ? theme.accent.primary : theme.text.secondary,
                      cursor: 'pointer'
                    }}
                    title="Toggle text/style controls panel"
                  >
                    Text Controls
                  </button>
                </div>
              </div>

              <div style={{...styles.clipsTimeline, position: 'relative'}} ref={timelineRef} onPointerDown={handleTimelineMarqueeDown}>
                {/* Marquee overlay */}
                {marqueeState && (() => {
                  const minX = Math.min(marqueeState.startX, marqueeState.currentX);
                  const maxX = Math.max(marqueeState.startX, marqueeState.currentX);
                  const minY = Math.min(marqueeState.startY, marqueeState.currentY);
                  const maxY = Math.max(marqueeState.startY, marqueeState.currentY);
                  return (
                    <div style={{
                      position: 'absolute', left: minX, top: minY,
                      width: maxX - minX, height: maxY - minY,
                      backgroundColor: 'rgba(99, 102, 241, 0.2)',
                      border: '1px solid rgba(99, 102, 241, 0.5)',
                      pointerEvents: 'none', zIndex: 25
                    }} />
                  );
                })()}
                {/* Playhead indicator — draggable */}
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
                      pointerEvents: 'auto',
                      boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)',
                      transition: isPlaying ? 'none' : 'left 0.1s ease-out'
                    }}
                  >
                    {/* Wider grab area for easier dragging */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '-6px',
                        left: '-8px',
                        width: '18px',
                        bottom: 0,
                        cursor: 'ew-resize',
                        zIndex: 21
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        wasPlayingBeforePlayheadDrag.current = isPlaying;
                        if (isPlaying) setIsPlaying(false);
                        setPlayheadDragging(true);
                      }}
                    />
                    {/* Playhead top triangle */}
                    <div style={{
                      position: 'absolute',
                      top: '-4px',
                      left: '-5px',
                      width: 0,
                      height: 0,
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '8px solid #ef4444',
                      cursor: 'ew-resize'
                    }} />
                  </div>
                )}
                {clips.length === 0 ? (
                  <div style={styles.noClips}>
                    <p>Click clips above to add, or use Cut by beat</p>
                  </div>
                ) : (
                  <div style={styles.clipsRow}>
                    {clips.map((clip, index) => {
                      const pxPerSec = 40 * timelineScale;
                      const clipWidth = Math.max(50, (clip.duration || 1) * pxPerSec);
                      const thumbWidth = 68;
                      return (
                      <div
                        key={clip.id}
                        data-clip-block="true"
                        draggable={!clip.locked && !clipResize.active}
                        onDragStart={() => !clipResize.active && handleClipDragStart(index)}
                        onDragOver={(e) => { e.preventDefault(); handleClipDragOver(index); }}
                        onDragEnd={handleClipDragEnd}
                        style={{
                          ...styles.clipItem,
                          width: `${clipWidth}px`,
                          minWidth: '50px',
                          display: 'flex',
                          flexDirection: 'row',
                          ...(selectedClips.includes(index) ? styles.clipItemSelected : {}),
                          ...(clipDrag.dragging && clipDrag.fromIndex === index ? { opacity: 0.5 } : {}),
                          ...(clipDrag.dragging && clipDrag.toIndex === index && clipDrag.fromIndex !== index ? {
                            borderLeft: '3px solid #22c55e',
                            marginLeft: '-3px'
                          } : {}),
                          cursor: clip.locked ? 'not-allowed' : 'grab',
                          position: 'relative',
                          transition: clipResize.active ? 'none' : 'width 0.15s ease-out'
                        }}
                        onClick={(e) => handleClipSelect(index, e)}
                      >
                        {/* Thumbnail area - fixed width at start of clip */}
                        <div style={{
                          width: `${thumbWidth}px`,
                          height: '100%',
                          flexShrink: 0,
                          position: 'relative',
                          overflow: 'hidden',
                          borderRadius: '6px 0 0 6px'
                        }}>
                          {clip.thumbnailUrl || clip.url || clip.localUrl ? (
                            <video
                              src={clip.thumbnailUrl || clip.url || clip.localUrl}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                              preload="metadata"
                              muted
                            />
                          ) : (
                            <div style={{ width: '100%', height: '100%', backgroundColor: theme.bg.elevated, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: '10px', color: theme.text.muted }}>No thumb</span>
                            </div>
                          )}
                          {clip.locked && (
                            <div style={{
                              position: 'absolute', top: 2, right: 2, zIndex: 2,
                              width: '16px', height: '16px', borderRadius: '50%',
                              backgroundColor: '#f59e0b', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', fontSize: '10px'
                            }}>🔒</div>
                          )}
                          {clip.duration > 0 && (
                            <span style={{
                              position: 'absolute', bottom: 2, left: 2, padding: '1px 4px',
                              backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '3px',
                              fontSize: '9px', color: '#fff'
                            }}>
                              {clip.duration.toFixed(1)}s
                            </span>
                          )}
                        </div>
                        {/* Duration track area after thumbnail */}
                        <div style={{
                          flex: 1,
                          height: '100%',
                          backgroundColor: selectedClips.includes(index) ? `${theme.accent.primary}22` : `${theme.bg.surface}`,
                          position: 'relative',
                          borderRadius: '0 6px 6px 0',
                          overflow: 'hidden'
                        }}>
                          {/* Duration bars */}
                          <div style={{
                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                            display: 'flex', alignItems: 'flex-end', padding: '2px', gap: '1px', opacity: 0.3
                          }}>
                            {Array.from({ length: Math.ceil((clip.duration || 1) * 2) }, (_, i) => (
                              <div key={i} style={{
                                flex: 1, minWidth: '2px',
                                height: `${20 + Math.random() * 60}%`,
                                backgroundColor: selectedClips.includes(index) ? theme.accent.primary : theme.text.muted,
                                borderRadius: '1px'
                              }} />
                            ))}
                          </div>
                        </div>
                        {/* Right-edge resize handle */}
                        {!clip.locked && (
                          <div
                            onPointerDown={(e) => handleResizeStart(e, index, 'right')}
                            style={{
                              position: 'absolute', top: 0, right: 0, width: '8px', height: '100%',
                              cursor: 'col-resize',
                              zIndex: 3,
                              background: 'linear-gradient(to left, rgba(167,139,250,0.4), transparent)',
                              opacity: 0,
                              transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}
                          />
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
                {/* Added Audio Waveform Track (purple) — per-clip cells, only for external audio */}
                {selectedAudio && selectedAudio.url && !selectedAudio.isSourceAudio && waveformData.length > 0 && (() => {
                  const pxPerSec = 40 * timelineScale;
                  const totalDur = clips.reduce((s, c) => s + (c.duration || 1), 0);
                  let sampleOffset = 0;
                  return (
                    <div style={{
                      display: 'flex', alignItems: 'center', height: '32px',
                      borderTop: `1px solid ${theme.border.subtle}`, marginTop: '4px',
                      pointerEvents: 'auto', position: 'relative'
                    }}>
                      {/* Controls overlay */}
                      <div style={{
                        position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)',
                        display: 'flex', alignItems: 'center', gap: '3px', zIndex: 3,
                        backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: '4px', padding: '2px 5px'
                      }}>
                        <span style={{ fontSize: '10px' }}>{'\uD83C\uDFB5'}</span>
                        <input type="range" min="0" max="1" step="0.05" value={externalAudioVolume}
                          onChange={e => setExternalAudioVolume(parseFloat(e.target.value))}
                          style={{ width: '36px', height: '3px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                          title={`Added audio: ${Math.round(externalAudioVolume * 100)}%`}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: '8px', flexShrink: 0 }}>
                        {clips.map((clip, idx) => {
                          const clipWidth = Math.max(50, (clip.duration || 1) * pxPerSec);
                          const sampleCount = Math.max(1, Math.round((clip.duration || 1) / totalDur * waveformData.length));
                          const slicedData = waveformData.slice(sampleOffset, sampleOffset + sampleCount);
                          sampleOffset += sampleCount;
                          return (
                            <div key={idx} style={{
                              width: clipWidth, display: 'flex', alignItems: 'center', gap: '1px',
                              height: '28px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden',
                              backgroundColor: 'rgba(139, 92, 246, 0.08)',
                              border: '1px solid rgba(139, 92, 246, 0.2)'
                            }}>
                              {slicedData.map((amplitude, i) => (
                                <div key={i} style={{
                                  flex: 1, minWidth: '1px', backgroundColor: 'rgba(139, 92, 246, 0.5)',
                                  height: `${amplitude * 100}%`, opacity: 0.6
                                }} />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Source Video Audio Waveform Track (blue) — per-clip cells */}
                {Object.keys(clipWaveforms).length > 0 && (() => {
                  const pxPerSec = 40 * timelineScale;
                  const hasExternal = selectedAudio && selectedAudio.url && !selectedAudio.isSourceAudio;
                  return (
                    <div style={{
                      display: 'flex', alignItems: 'center', height: '32px',
                      borderTop: `1px solid ${theme.border.subtle}`, marginTop: '4px',
                      pointerEvents: 'auto', position: 'relative'
                    }}>
                      {/* Controls overlay */}
                      <div style={{
                        position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)',
                        display: 'flex', alignItems: 'center', gap: '3px', zIndex: 3,
                        backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: '4px', padding: '2px 5px'
                      }}>
                        <button
                          onClick={() => setSourceVideoMuted(m => !m)}
                          style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '10px',
                            opacity: (hasExternal && sourceVideoMuted) ? 0.4 : 1
                          }}
                          title={sourceVideoMuted ? 'Unmute source audio' : 'Mute source audio'}
                        >{sourceVideoMuted ? '\uD83D\uDD07' : '\uD83C\uDFAC'}</button>
                        {hasExternal && (
                          <input type="range" min="0" max="1" step="0.05" value={sourceVideoVolume}
                            onChange={e => setSourceVideoVolume(parseFloat(e.target.value))}
                            style={{ width: '36px', height: '3px', accentColor: '#3b82f6', cursor: 'pointer' }}
                            title={`Source audio: ${Math.round(sourceVideoVolume * 100)}%`}
                          />
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: '8px', flexShrink: 0 }}>
                        {clips.map((clip, idx) => {
                          const clipWidth = Math.max(50, (clip.duration || 1) * pxPerSec);
                          const clipId = clip.id || clip.sourceId;
                          const data = clipWaveforms[clipId] || [];
                          return (
                            <div key={idx} style={{
                              width: clipWidth, display: 'flex', alignItems: 'center', gap: '1px',
                              height: '28px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden',
                              backgroundColor: (hasExternal && sourceVideoMuted) ? 'rgba(59, 130, 246, 0.04)' : 'rgba(59, 130, 246, 0.08)',
                              border: `1px solid rgba(59, 130, 246, ${(hasExternal && sourceVideoMuted) ? '0.1' : '0.2'})`
                            }}>
                              {data.map((amplitude, i) => (
                                <div key={i} style={{
                                  flex: 1, minWidth: '1px', backgroundColor: 'rgba(59, 130, 246, 0.4)',
                                  height: `${amplitude * 100}%`, opacity: (hasExternal && sourceVideoMuted) ? 0.3 : 0.6
                                }} />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Clip Actions */}
              <div style={styles.clipActions}>
                <button style={styles.clipAction} onClick={handleCombine} title="Combine selected clips or clip at playhead with next">Combine</button>
                <button style={styles.clipAction} onClick={handleBreak} title="Split clip at playhead position">Break</button>
                <button style={styles.clipAction} onClick={handleReroll} title="Replace clip(s) with random from bank">Reroll</button>
                <button style={styles.clipAction} onClick={handleRearrange}>Rearrange</button>
                <button style={styles.clipActionDanger} onClick={handleRemoveClips} title="Delete selected clip(s) or clip at playhead">Remove</button>
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

              {/* Selection info */}
              {selectedClips.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', fontSize: '12px', color: theme.accent.primary }}>
                  <span>{selectedClips.length} clips selected</span>
                  <button style={{ ...styles.clipAction, fontSize: '11px', padding: '2px 8px' }} onClick={() => setSelectedClips([])}>Clear</button>
                </div>
              )}

              {/* Cut Actions */}
              <div style={styles.cutActions}>
                <span style={styles.cutHint}>Click-drag timeline to marquee select, or Shift-click clips</span>
                <div style={styles.cutButtons}>
                  <button style={styles.cutButton} onClick={handleCutByWord}>Cut by word</button>
                  <button style={styles.cutButton} onClick={handleCutByBeat}>Cut by beat</button>
                  <button style={{...styles.cutButton, opacity: 0.5, cursor: 'not-allowed'}} title="Coming soon" disabled>Record cuts</button>
                </div>
              </div>
            </div>
            </div>{/* end scrollable controls+timeline wrapper */}
          </div>

          {/* ── Floating Text Controls Panel ── */}
          {showTextPanel && !isMobile && (
          <div style={{
            width: '300px',
            borderLeft: `1px solid ${theme.border.subtle}`,
            backgroundColor: theme.bg.surface,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto'
          }}>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${theme.border.subtle}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: theme.text.primary }}>Text Controls</span>
              <button onClick={() => setShowTextPanel(false)} style={{ background: 'none', border: 'none', color: theme.text.muted, fontSize: '18px', cursor: 'pointer', padding: '2px 6px' }}>×</button>
            </div>

                {/* Tabs - scrollable on mobile */}
                <div style={{
                  ...styles.tabs,
                  ...(isMobile ? {
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    marginBottom: '12px',
                    paddingBottom: '4px'
                  } : {})
                }}>
                  <button
                    style={{
                      ...(activeTab === 'caption' ? styles.tabActive : styles.tab),
                      ...(isMobile ? { padding: '10px 16px', fontSize: '13px', whiteSpace: 'nowrap' } : {})
                    }}
                    onClick={() => setActiveTab('caption')}
                  >
                    Caption
                  </button>
                  <button
                    style={{
                      ...(activeTab === 'styles' ? styles.tabActive : styles.tab),
                      ...(isMobile ? { padding: '10px 16px', fontSize: '13px', whiteSpace: 'nowrap' } : {})
                    }}
                    onClick={() => setActiveTab('styles')}
                  >
                    Styles
                  </button>
                  <button
                    style={{
                      ...(activeTab === 'lyrics' ? {...styles.tabActive, color: '#a78bfa'} : {...styles.tab, color: '#8b5cf6'}),
                      ...(isMobile ? { padding: '10px 16px', fontSize: '13px', whiteSpace: 'nowrap' } : {})
                    }}
                    onClick={() => setActiveTab('lyrics')}
                  >
                    📝 Lyrics
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
                        <option value="'Arial Narrow', Arial, sans-serif">Arial Narrow</option>
                        <option value="Georgia, serif">Georgia</option>
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
                        <option value="9:16">9:16 (Full)</option>
                        <option value="4:3">4:3 (Crop)</option>
                        <option value="1:1">1:1 (Crop)</option>
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
                            background: (!selectedAudio || isTranscribing) ? theme.bg.elevated : 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
                            color: (!selectedAudio || isTranscribing) ? theme.text.muted : theme.text.primary,
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

                      {/* From Bank Button & Dropdown */}
                      <div style={{ position: 'relative', marginTop: '8px' }}>
                        <button
                          style={{
                            ...styles.editLyricsButton,
                            width: '100%',
                            background: (category?.lyrics?.length || 0) === 0 ? theme.bg.elevated : 'linear-gradient(135deg, #14b8a6, #0d9488)',
                            color: (category?.lyrics?.length || 0) === 0 ? theme.text.muted : theme.text.primary,
                            cursor: (category?.lyrics?.length || 0) === 0 ? 'not-allowed' : 'pointer',
                            opacity: (category?.lyrics?.length || 0) === 0 ? 0.6 : 1
                          }}
                          onClick={() => setShowLyricBankPicker(!showLyricBankPicker)}
                          disabled={(category?.lyrics?.length || 0) === 0}
                          title={(category?.lyrics?.length || 0) === 0 ? 'No lyrics in bank' : 'Load lyrics from bank'}
                        >
                          📚 From Bank ({category?.lyrics?.length || 0})
                        </button>

                        {/* Lyric Bank Dropdown */}
                        {showLyricBankPicker && (category?.lyrics?.length || 0) > 0 && (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            marginTop: '4px',
                            backgroundColor: theme.bg.surface,
                            border: `1px solid ${theme.bg.elevated}`,
                            borderRadius: '8px',
                            maxHeight: '200px',
                            overflowY: 'auto',
                            zIndex: 100,
                            boxShadow: `0 4px 12px ${theme.overlay.light}`
                          }}>
                            {category.lyrics.map(lyric => (
                              <div
                                key={lyric.id}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  backgroundColor: 'transparent',
                                  borderBottom: `1px solid ${theme.bg.elevated}`,
                                  color: theme.text.primary,
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  fontSize: '13px'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const content = lyric.content || '';
                                  log('Loading lyric:', lyric.title, content);

                                  let newWords;

                                  // Check if lyric has pre-saved word timings
                                  if (lyric.words && lyric.words.length > 0) {
                                    // Use saved word timings
                                    log(`Loading ${lyric.words.length} pre-timed words from bank`);
                                    newWords = lyric.words;
                                  } else {
                                    // Parse lyrics into words stacked at beginning with 0.5s duration each
                                    const lyricWords = content.split(/\s+/).filter(w => w.trim().length > 0);
                                    const wordDuration = 2;

                                    newWords = lyricWords.map((text, i) => ({
                                      id: `word_${Date.now()}_${i}`,
                                      text,
                                      startTime: i * wordDuration,
                                      duration: wordDuration
                                    }));
                                    log(`Created ${newWords.length} words from bank lyrics (stacked at start)`);
                                  }

                                  setLyrics(content);
                                  setWords(newWords);
                                  setLoadedBankLyricId(lyric.id); // Track which lyric is loaded for saving
                                  setShowLyricBankPicker(false);
                                  // Auto-open Word Timeline so user can adjust timing
                                  setShowWordTimeline(true);
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.bg.elevated}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <div style={{ fontWeight: '500', marginBottom: '2px', pointerEvents: 'none' }}>{lyric.title}</div>
                                <div style={{ fontSize: '11px', color: theme.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                                  {lyric.content?.substring(0, 50)}...
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {!selectedAudio && !isTranscribing && (
                        <p style={{ color: theme.text.muted, fontSize: '11px', marginTop: '6px' }}>
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

                {activeTab === 'lyrics' && (
                  <div style={styles.tabContent}>
                    <LyricBank
                      lyrics={category?.lyrics || []}
                      onAddLyrics={onAddLyrics}
                      onUpdateLyrics={onUpdateLyrics}
                      onDeleteLyrics={onDeleteLyrics}
                      onSelectText={(selectedText) => {
                        // Set selected lyrics as the current lyrics
                        setLyrics(selectedText);
                        // Auto-switch to caption tab to see the result
                        setActiveTab('caption');
                        toast.success('Lyrics loaded! Use Quick Edit or Word Timeline to sync.');
                      }}
                      compact={false}
                      showAddForm={true}
                    />
                    {category?.lyrics?.length === 0 && (
                      <p style={{ color: theme.text.muted, fontSize: '12px', marginTop: '12px', textAlign: 'center' }}>
                        Add lyrics in your category's Aesthetic Home, or add them here for quick access.
                      </p>
                    )}
                  </div>
                )}

          </div>
          )}
        </div>

        {/* ── Video Variation Tabs + Generate ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: isMobile ? '8px 12px' : '6px 16px',
          borderTop: `1px solid ${theme.border.default}`,
          backgroundColor: theme.bg.surface,
          overflowX: 'auto',
          flexShrink: 0
        }}>
          {/* Variation tabs */}
          <div style={{ display: 'flex', gap: '4px', flex: 1, overflowX: 'auto', minWidth: 0 }}>
            {allVideos.map((video, idx) => (
              <button
                key={video.id}
                onClick={() => switchToVideo(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: isMobile ? '6px 10px' : '4px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${idx === activeVideoIndex ? theme.accent.primary : theme.border.default}`,
                  backgroundColor: idx === activeVideoIndex ? theme.accent.primary + '22' : theme.bg.input,
                  color: idx === activeVideoIndex ? theme.accent.primary : theme.text.secondary,
                  fontSize: '12px',
                  fontWeight: idx === activeVideoIndex ? '600' : '400',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  minHeight: isMobile ? '36px' : undefined
                }}
              >
                {video.isTemplate ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" rx="1"/>
                      <rect x="14" y="3" width="7" height="7" rx="1"/>
                      <rect x="3" y="14" width="7" height="7" rx="1"/>
                      <rect x="14" y="14" width="7" height="7" rx="1"/>
                    </svg>
                    Template
                  </>
                ) : (
                  <>
                    {video.name}
                    <span
                      onClick={(e) => { e.stopPropagation(); handleDeleteVideo(idx); }}
                      style={{ marginLeft: '2px', opacity: 0.5, cursor: 'pointer', fontSize: '10px' }}
                    >
                      x
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>

          {/* keepText toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
            {[
              { value: 'none', label: 'Random' },
              { value: 'all', label: 'Keep Text' }
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setKeepTemplateText(opt.value)}
                style={{
                  padding: '3px 6px', borderRadius: '4px', border: 'none',
                  backgroundColor: keepTemplateText === opt.value ? 'rgba(99,102,241,0.6)' : 'transparent',
                  color: keepTemplateText === opt.value ? '#fff' : theme.text.muted,
                  fontSize: '10px', fontWeight: keepTemplateText === opt.value ? '700' : '500',
                  cursor: 'pointer'
                }}
              >{opt.label}</button>
            ))}
          </div>

          {/* Generate controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <input
              type="number"
              min={1}
              max={50}
              value={generateCount}
              onChange={(e) => setGenerateCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              style={{
                width: '48px',
                padding: '4px 6px',
                borderRadius: '6px',
                border: `1px solid ${theme.border.default}`,
                backgroundColor: theme.bg.input,
                color: theme.text.primary,
                fontSize: '12px',
                textAlign: 'center'
              }}
            />
            <button
              onClick={executeGeneration}
              disabled={isGenerating || clips.length === 0}
              style={{
                padding: isMobile ? '6px 12px' : '4px 12px',
                borderRadius: '6px',
                border: 'none',
                background: isGenerating ? theme.bg.elevated : 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: '600',
                cursor: isGenerating || clips.length === 0 ? 'not-allowed' : 'pointer',
                opacity: clips.length === 0 ? 0.5 : 1,
                whiteSpace: 'nowrap'
              }}
            >
              {isGenerating ? 'Generating...' : `Generate ${generateCount}`}
            </button>
            {allVideos.length > 1 && (
              <span style={{ fontSize: '11px', color: theme.text.muted, whiteSpace: 'nowrap' }}>
                {allVideos.length} total
              </span>
            )}
          </div>
        </div>

        {/* Hidden audio file input (used by toolbar Audio button) */}
        <input
          ref={audioFileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={handleAudioUpload}
        />

        {/* ── Editor Toolbar ── */}
        <EditorToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onReroll={clips.length > 0 ? handleReroll : null}
          rerollDisabled={!visibleVideos.length && !category?.videos?.length}
          onAddText={null}
          onDelete={clips.length > 1 ? handleRemoveClips : null}
          audioTracks={libraryAudio}
          onSelectAudio={(audio) => {
            setAudioToTrim(audio);
            setShowAudioTrimmer(true);
          }}
          onUploadAudio={() => audioFileInputRef.current?.click()}
          lyrics={artistId ? getLyrics(artistId) : (category?.lyrics || [])}
          onSelectLyric={(lyric) => {
            if (lyric.words?.length > 0) {
              setWords(lyric.words);
              setLyrics(lyric.words.map(w => w.text).join(' '));
            } else if (lyric.content) {
              setLyrics(lyric.content);
            }
          }}
          onAddNewLyrics={onAddLyrics ? () => {
            setShowLyricBankPicker(false);
            if (onAddLyrics) onAddLyrics({ title: 'New Lyrics', content: '' });
          } : null}
          onAITranscribe={selectedAudio ? handleAITranscribe : null}
          isTranscribing={isTranscribing}
        />

        {/* Footer */}
        <div style={{
          ...styles.footer,
          ...(isMobile ? {
            flexDirection: 'column',
            gap: '12px',
            padding: '12px 16px'
          } : {})
        }}>
          <div style={{
            ...styles.footerLeft,
            ...(isMobile ? { width: '100%', justifyContent: 'center' } : {})
          }}>
            {!isMobile && <button style={styles.resetButton} onClick={() => {
              if (window.confirm('Reset all changes to last saved state?')) {
                // Restore from auto-saved draft if available
                const key = autoSaveKey;
                try {
                  const saved = localStorage.getItem(key);
                  if (saved) {
                    const data = JSON.parse(saved);
                    if (data.clips) setClips(data.clips);
                    if (data.words) setWords(data.words);
                    if (data.textStyle) setTextStyle(data.textStyle);
                  }
                } catch(e) { console.warn('Reset failed:', e); }
              }
            }}>Reset to saved</button>}
            {lastSaved && (
              <span style={styles.autoSaveIndicator}>
                ✓ Auto-saved {lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div style={{
            ...styles.footerRight,
            ...(isMobile ? {
              width: '100%',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: '8px'
            } : {})
          }}>
            {!isMobile && <span style={styles.shortcutHint}>⌘S to save</span>}
            <button
              style={{
                ...styles.cancelButton,
                ...(isMobile ? {
                  padding: '12px 20px',
                  fontSize: '14px',
                  flex: '1'
                } : {})
              }}
              onClick={onClose}
            >
              Cancel
            </button>
            {allVideos.length > 1 && (
              <button
                style={{
                  ...styles.confirmButton,
                  background: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
                  ...(isMobile ? {
                    padding: '12px 20px',
                    fontSize: '14px',
                    flex: '1'
                  } : {})
                }}
                onClick={handleSaveAllAndClose}
              >
                Save All ({allVideos.length})
              </button>
            )}
            <button
              style={{
                ...styles.confirmButton,
                ...(isMobile ? {
                  padding: '12px 20px',
                  fontSize: '14px',
                  flex: '1',
                  width: allVideos.length > 1 ? undefined : '100%'
                } : {})
              }}
              onClick={handleSave}
            >
              {schedulerEditMode ? 'Save' : allVideos.length > 1 ? 'Save Current' : 'Confirm'}
            </button>
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
            <div style={{
            ...styles.lyricsModal,
            ...(isMobile ? {
              width: '95%',
              maxWidth: '95%',
              maxHeight: '90vh',
              overflow: 'auto'
            } : {})
          }}>
              <h3 style={styles.lyricsTitle}>Edit Lyrics</h3>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Enter your lyrics here, one word or line per row..."
                style={{
                  ...styles.lyricsTextarea,
                  ...(isMobile ? { minHeight: '150px', fontSize: '16px' } : {})
                }}
                autoFocus={!isMobile}
              />
              <div style={{
                ...styles.lyricsSyncOptions,
                ...(isMobile ? { flexDirection: 'column', alignItems: 'stretch', gap: '8px' } : {})
              }}>
                <span style={isMobile ? { marginBottom: '4px' } : {}}>Sync method:</span>
                <div style={{ display: 'flex', gap: '8px', ...(isMobile ? { width: '100%' } : {}) }}>
                  <button style={{
                    ...styles.syncButton,
                    ...(isMobile ? { flex: 1, padding: '12px' } : {})
                  }} onClick={() => handleSyncLyrics('beat')}>
                    Sync to beats
                  </button>
                  <button style={{
                    ...styles.syncButton,
                    ...(isMobile ? { flex: 1, padding: '12px' } : {})
                  }} onClick={() => handleSyncLyrics('even')}>
                    Spread evenly
                  </button>
                </div>
              </div>
              <div style={{
                ...styles.lyricsActions,
                ...(isMobile ? { flexDirection: 'column', gap: '8px' } : {})
              }}>
                <button style={{
                  ...styles.cancelButton,
                  ...(isMobile ? { width: '100%', padding: '14px' } : {})
                }} onClick={() => setShowLyricsEditor(false)}>
                  Cancel
                </button>
                <button style={{
                  ...styles.confirmButton,
                  ...(isMobile ? { width: '100%', padding: '14px' } : {})
                }} onClick={() => setShowLyricsEditor(false)}>
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
            loadedBankLyricId={loadedBankLyricId}
            onSaveToBank={(lyricId, wordsToSave) => {
              // Save word timings back to the lyric bank entry
              if (lyricId && onUpdateLyrics) {
                log(`Saving ${wordsToSave.length} words to lyric bank entry:`, lyricId);
                onUpdateLyrics(lyricId, { words: wordsToSave });
              }
            }}
            onAddToBank={(lyricData) => {
              // Add new lyrics with words to the bank
              if (onAddLyrics) {
                log(`Adding new lyric to bank: "${lyricData.title}" with ${lyricData.words?.length || 0} words`);
                onAddLyrics({
                  title: lyricData.title,
                  content: lyricData.content,
                  words: lyricData.words
                });
              }
            }}
          />
        )}

        {/* API Key Modal */}
        {showApiKeyModal && (
          <div style={styles.lyricsOverlay}>
            <div style={{
              ...styles.lyricsModal,
              maxWidth: '400px',
              ...(isMobile ? { width: '95%', maxWidth: '95%' } : {})
            }}>
              <h3 style={styles.lyricsTitle}>🔑 OpenAI API Key</h3>
              <p style={{ color: theme.text.secondary, fontSize: '14px', marginBottom: '16px' }}>
                AI transcription uses OpenAI Whisper (great for music/vocals).
                Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" style={{ color: theme.accent.primary }}>platform.openai.com</a>
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
                autoFocus={!isMobile}
                style={{
                  width: '100%',
                  padding: isMobile ? '14px' : '12px',
                  background: theme.bg.surface,
                  border: `1px solid ${theme.bg.elevated}`,
                  borderRadius: '8px',
                  color: theme.text.primary,
                  fontSize: isMobile ? '16px' : '14px',
                  marginBottom: '16px'
                }}
              />
              <div style={{
                ...styles.lyricsActions,
                ...(isMobile ? { flexDirection: 'column', gap: '8px' } : {})
              }}>
                <button style={{
                  ...styles.cancelButton,
                  ...(isMobile ? { width: '100%', padding: '14px' } : {})
                }} onClick={() => { setShowApiKeyModal(false); setApiKeyInput(''); }}>
                  Cancel
                </button>
                <button
                  style={{
                    ...styles.confirmButton,
                    background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
                    ...(isMobile ? { width: '100%', padding: '14px' } : {})
                  }}
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
              <p style={{ color: theme.text.secondary, fontSize: '14px', marginBottom: '16px' }}>
                We found an auto-saved draft from{' '}
                <strong style={{ color: theme.text.primary }}>
                  {recoveryData.savedAt ? new Date(recoveryData.savedAt).toLocaleString() : 'recently'}
                </strong>
              </p>
              <div style={{
                backgroundColor: theme.bg.surface,
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                color: theme.text.secondary
              }}>
                <div>🎵 Audio: {recoveryData.audio?.name || 'None'}</div>
                <div>🎬 Clips: {recoveryData.clips?.length || 0}</div>
                <div>💬 Words: {recoveryData.words?.length || 0}</div>
              </div>
              <div style={{
                ...styles.lyricsActions,
                ...(isMobile ? { flexDirection: 'column', gap: '8px' } : {})
              }}>
                <button
                  style={{
                    ...styles.cancelButton,
                    ...(isMobile ? { width: '100%', padding: '14px' } : {})
                  }}
                  onClick={handleDiscardDraft}
                >
                  Start Fresh
                </button>
                <button
                  style={{
                    ...styles.confirmButton,
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    ...(isMobile ? { width: '100%', padding: '14px' } : {})
                  }}
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
            <div style={{
              ...styles.lyricsModal,
              maxWidth: '420px',
              ...(isMobile ? { width: '95%', maxWidth: '95%' } : {})
            }}>
              <h3 style={styles.lyricsTitle}>💾 Save Lyrics to Song?</h3>
              <p style={{ color: theme.text.secondary, fontSize: '14px', marginBottom: '16px' }}>
                You've created timed lyrics for <strong style={{ color: theme.text.primary }}>{selectedAudio?.name || 'this song'}</strong>.
                Save them to the song so they're automatically available next time you use it?
              </p>
              <div style={{
                backgroundColor: theme.bg.surface,
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                color: theme.text.secondary
              }}>
                <div>🎤 {words.length} words with timing data</div>
                <div style={{ marginTop: '4px', fontSize: '12px', color: theme.text.muted }}>
                  "{words.slice(0, 5).map(w => w.text).join(' ')}{words.length > 5 ? '...' : ''}"
                </div>
              </div>
              <div style={{
                ...styles.lyricsActions,
                ...(isMobile ? { flexDirection: 'column', gap: '8px' } : {})
              }}>
                <button
                  style={{
                    ...styles.cancelButton,
                    ...(isMobile ? { width: '100%', padding: '14px' } : {})
                  }}
                  onClick={() => handleLyricsPromptResponse(false)}
                >
                  No, Just This Video
                </button>
                <button
                  style={{
                    ...styles.confirmButton,
                    ...(isMobile ? { width: '100%', padding: '14px' } : {})
                  }}
                  onClick={() => handleLyricsPromptResponse(true)}
                >
                  Yes, Save to Song
                </button>
              </div>
            </div>
          </div>
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

        {/* Close Confirmation Dialog */}
        {showCloseConfirm && (
          <div style={styles.lyricsOverlay}>
            <div style={{
              ...styles.lyricsModal,
              maxWidth: '380px',
              ...(isMobile ? { width: '95%', maxWidth: '95%' } : {})
            }}>
              <h3 style={styles.lyricsTitle}>Close Editor?</h3>
              <p style={{ color: theme.text.secondary, fontSize: '14px', marginBottom: '16px' }}>
                You have unsaved work. Are you sure you want to close?
              </p>
              <div style={{
                backgroundColor: theme.bg.surface,
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                color: theme.text.secondary
              }}>
                {selectedAudio && <div>🎵 Audio selected</div>}
                {clips.length > 0 && <div>🎬 {clips.length} clips</div>}
                {words.length > 0 && <div>💬 {words.length} words timed</div>}
              </div>
              <div style={{
                ...styles.lyricsActions,
                ...(isMobile ? { flexDirection: 'column', gap: '8px' } : {})
              }}>
                <button
                  style={{
                    ...styles.cancelButton,
                    ...(isMobile ? { width: '100%', padding: '14px' } : {})
                  }}
                  onClick={() => setShowCloseConfirm(false)}
                >
                  Keep Editing
                </button>
                <button
                  style={{
                    ...styles.confirmButton,
                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                    ...(isMobile ? { width: '100%', padding: '14px' } : {})
                  }}
                  onClick={handleConfirmClose}
                >
                  Close Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Preset name prompt modal */}
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
                    onSavePreset({ name: presetPromptValue.trim(), settings: { ...textStyle, cropMode } });
                    toast.success?.(`Preset "${presetPromptValue.trim()}" saved!`);
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
                    onSavePreset({ name: presetPromptValue.trim(), settings: { ...textStyle, cropMode } });
                    toast.success?.(`Preset "${presetPromptValue.trim()}" saved!`);
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

const getStyles = (theme) => ({
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px'
  },
  modal: {
    width: '100%',
    maxWidth: '1400px',
    maxHeight: '95vh',
    height: '95vh',
    backgroundColor: theme.bg.input,
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
    borderBottom: `1px solid ${theme.bg.surface}`
  },
  title: {
    fontSize: '16px',
    fontWeight: '600',
    color: theme.text.primary,
    margin: 0
  },
  studioButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.text.primary,
    cursor: 'pointer',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: '600',
    transition: 'background-color 0.2s'
  },
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.text.secondary,
    cursor: 'pointer',
    borderRadius: '6px'
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  // ── Left sidebar styles (matching SlideshowEditor) ──
  leftPanel: {
    width: '256px',
    backgroundColor: theme.bg.input,
    borderRight: `1px solid ${theme.border.subtle}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0
  },
  sourceDropdown: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: theme.bg.page,
    border: `1px solid ${theme.border.subtle}`,
    borderRadius: '8px',
    color: theme.text.primary,
    fontSize: '13px',
    outline: 'none',
    cursor: 'pointer'
  },
  bankTabs: {
    display: 'flex',
    borderBottom: `1px solid ${theme.border.subtle}`
  },
  bankTab: {
    flex: 1,
    padding: '12px 4px',
    border: 'none',
    borderBottom: '2px solid transparent',
    backgroundColor: 'transparent',
    color: theme.text.muted,
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s ease'
  },
  bankTabActiveTeal: {
    flex: 1,
    padding: '12px 4px',
    border: 'none',
    borderBottom: '2px solid #14b8a6',
    backgroundColor: 'rgba(20,184,166,0.1)',
    color: '#5eead4',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center'
  },
  bankTabActiveGreen: {
    flex: 1,
    padding: '12px 4px',
    border: 'none',
    borderBottom: '2px solid #22c55e',
    backgroundColor: 'rgba(34,197,94,0.1)',
    color: '#86efac',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center'
  },
  bankTabActivePurple: {
    flex: 1,
    padding: '12px 4px',
    border: 'none',
    borderBottom: '2px solid #a78bfa',
    backgroundColor: 'rgba(167,139,250,0.1)',
    color: '#c4b5fd',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center'
  },
  bankTabActivePink: {
    flex: 1,
    padding: '12px 4px',
    border: 'none',
    borderBottom: '2px solid #ec4899',
    backgroundColor: 'rgba(236,72,153,0.1)',
    color: '#f9a8d4',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center'
  },
  bankContent: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '12px'
  },
  sidebarClipGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px'
  },
  sidebarClip: {
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    border: '2px solid transparent',
    transition: 'border-color 0.15s ease'
  },
  textBankInput: {
    flex: 1,
    padding: '6px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.bg.page,
    color: theme.text.primary,
    fontSize: '12px',
    outline: 'none'
  },
  textBankItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: '6px',
    backgroundColor: theme.hover.bg,
    marginBottom: '4px',
    color: theme.text.secondary
  },
  previewSection: {
    width: '320px',
    padding: '20px',
    borderRight: `1px solid ${theme.bg.surface}`,
    display: 'flex',
    flexDirection: 'column'
  },
  previewContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
    overflow: 'hidden',
    padding: '16px 24px 8px',
    backgroundColor: theme.bg.page
  },
  preview: {
    position: 'relative',
    aspectRatio: '9/16',
    backgroundColor: '#000',
    borderRadius: '12px',
    overflow: 'hidden',
    flex: 1,
    minHeight: 0,
    width: 'auto',
    maxWidth: '100%',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
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
    backgroundColor: theme.bg.page
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
    borderBottom: `1px dashed ${theme.text.muted}`
  },
  safeZoneBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '15%',
    borderTop: `1px dashed ${theme.text.muted}`
  },
  progressBarContainer: {
    position: 'relative',
    width: '100%',
    maxWidth: '400px',
    height: '4px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '2px',
    marginTop: '10px',
    cursor: 'pointer'
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: theme.accent.primary,
    borderRadius: '3px',
    transition: 'width 0.1s linear'
  },
  progressHandle: {
    position: 'absolute',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: '12px',
    height: '12px',
    backgroundColor: theme.text.primary,
    borderRadius: '50%',
    boxShadow: `0 2px 4px ${theme.overlay.light}`
  },
  playbackControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    marginTop: '6px',
    paddingBottom: '4px'
  },
  playButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: '50%',
    color: theme.text.primary,
    cursor: 'pointer',
    transition: 'background-color 0.15s'
  },
  muteButton: {
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
  timeDisplay: {
    flex: 1,
    fontSize: '12px',
    color: theme.text.secondary,
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
    color: theme.text.muted,
    cursor: 'pointer'
  },
  presetSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px'
  },
  presetLabel: {
    fontSize: '13px',
    color: theme.text.secondary
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
  makePresetButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '10px',
    backgroundColor: 'transparent',
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.secondary,
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
    backgroundColor: theme.bg.surface,
    border: 'none',
    borderRadius: '8px',
    color: theme.text.primary,
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
    color: theme.text.muted,
    cursor: 'pointer',
    fontSize: '13px'
  },
  tabActive: {
    padding: '8px 16px',
    backgroundColor: theme.bg.surface,
    border: 'none',
    borderRadius: '6px',
    color: theme.text.primary,
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
    backgroundColor: theme.bg.surface,
    borderRadius: '6px',
    overflow: 'hidden'
  },
  sizeButton: {
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '13px',
    borderRight: `1px solid ${theme.bg.elevated}`
  },
  fontSelect: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.primary,
    fontSize: '13px',
    outline: 'none'
  },
  optionButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.secondary,
    cursor: 'pointer',
    fontSize: '13px'
  },
  optionButtonActive: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: theme.accent.primary,
    border: 'none',
    borderRadius: '6px',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '13px'
  },
  controlLabel: {
    fontSize: '13px',
    color: theme.text.secondary,
    marginRight: '8px'
  },
  select: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.primary,
    fontSize: '13px',
    outline: 'none'
  },
  displayMode: {
    padding: '8px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.secondary,
    cursor: 'pointer',
    fontSize: '12px'
  },
  displayModeActive: {
    padding: '8px 12px',
    backgroundColor: theme.accent.primary,
    border: 'none',
    borderRadius: '6px',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '12px'
  },
  caseButton: {
    padding: '8px 16px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.secondary,
    cursor: 'pointer',
    fontSize: '12px'
  },
  caseButtonActive: {
    padding: '8px 16px',
    backgroundColor: theme.accent.primary,
    border: 'none',
    borderRadius: '6px',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '12px'
  },
  textOverlaysSection: {
    marginTop: '20px'
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: '600',
    color: theme.text.muted,
    margin: 0,
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  textOverlaysList: {
    backgroundColor: theme.bg.page,
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
    color: theme.text.muted
  },
  textContent: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: theme.accent.primary,
    borderRadius: '4px',
    color: theme.text.primary,
    fontSize: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  noText: {
    fontSize: '13px',
    color: theme.text.muted,
    margin: 0
  },
  lyricsButtonRow: {
    display: 'flex',
    gap: '8px'
  },
  editLyricsButton: {
    flex: 1,
    padding: '10px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.primary,
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
    color: theme.accent.primary,
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
    color: theme.text.secondary
  },
  colorInput: {
    width: '40px',
    height: '40px',
    padding: 0,
    border: `2px solid ${theme.bg.elevated}`,
    borderRadius: '8px',
    cursor: 'pointer',
    backgroundColor: 'transparent'
  },
  availableClipsSection: {
    borderTop: `1px solid ${theme.bg.surface}`,
    paddingTop: '16px',
    marginBottom: '16px'
  },
  addAllButton: {
    padding: '6px 12px',
    backgroundColor: theme.accent.primary,
    border: 'none',
    borderRadius: '6px',
    color: theme.text.primary,
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
    backgroundColor: theme.bg.page,
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
    backgroundColor: theme.bg.surface
  },
  availableClipName: {
    fontSize: '10px',
    color: theme.text.secondary,
    textAlign: 'center',
    maxWidth: '70px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  noAvailableClips: {
    textAlign: 'center',
    padding: '20px',
    color: theme.text.muted,
    fontSize: '12px'
  },
  beatsInfo: {
    fontSize: '12px',
    color: theme.text.secondary,
    padding: '4px 8px',
    backgroundColor: theme.bg.surface,
    borderRadius: '4px'
  },
  clipsSection: {
    borderTop: `1px solid ${theme.border.subtle}`,
    padding: '8px 12px 4px'
  },
  clipsSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '6px'
  },
  clipsFilter: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  clipsFilterLabel: {
    fontSize: '12px',
    color: theme.text.muted
  },
  clipsFilterSelect: {
    padding: '6px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '4px',
    color: theme.text.primary,
    fontSize: '12px',
    outline: 'none'
  },
  clipsTimeline: {
    backgroundColor: theme.bg.page,
    borderRadius: '6px',
    padding: '8px',
    marginBottom: '6px',
    overflowX: 'auto',
    userSelect: 'none',
    WebkitUserSelect: 'none'
  },
  noClips: {
    textAlign: 'center',
    padding: '20px',
    color: theme.text.muted,
    fontSize: '13px'
  },
  clipsRow: {
    display: 'flex',
    gap: '8px'
  },
  clipItem: {
    position: 'relative',
    height: '48px',
    backgroundColor: theme.bg.surface,
    borderRadius: '4px',
    overflow: 'hidden',
    cursor: 'pointer',
    border: '2px solid transparent',
    flexShrink: 0
  },
  clipItemSelected: {
    border: `2px solid ${theme.accent.primary}`
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
    backgroundColor: theme.overlay.heavy,
    borderRadius: '4px',
    fontSize: '10px',
    color: theme.text.primary
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
    gap: '6px',
    marginBottom: '6px',
    flexWrap: 'wrap'
  },
  clipAction: {
    padding: '4px 10px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '4px',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '11px'
  },
  clipActionDanger: {
    padding: '4px 10px',
    backgroundColor: '#7f1d1d',
    border: '1px solid #991b1b',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '11px'
  },
  scaleControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginLeft: 'auto',
    fontSize: '12px',
    color: theme.text.secondary
  },
  scaleSlider: {
    width: '80px',
    accentColor: theme.accent.primary
  },
  cutActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  cutHint: {
    fontSize: '11px',
    color: theme.text.muted
  },
  cutButtons: {
    display: 'flex',
    gap: '8px'
  },
  cutButton: {
    padding: '4px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '4px',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '11px'
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderTop: `1px solid ${theme.bg.surface}`
  },
  footerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  resetButton: {
    padding: '10px 16px',
    backgroundColor: 'transparent',
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.secondary,
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
    color: theme.text.muted,
    padding: '4px 8px',
    backgroundColor: theme.bg.surface,
    borderRadius: '4px'
  },
  batchButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    background: `linear-gradient(135deg, ${theme.accent.primary}, ${theme.accent.muted})`,
    border: 'none',
    borderRadius: '6px',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    marginRight: '8px'
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: theme.bg.surface,
    border: 'none',
    borderRadius: '6px',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '13px'
  },
  confirmButton: {
    padding: '10px 20px',
    backgroundColor: theme.accent.primary,
    border: 'none',
    borderRadius: '6px',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500'
  },
  lyricsOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10
  },
  lyricsModal: {
    width: '400px',
    backgroundColor: theme.bg.input,
    borderRadius: '12px',
    padding: '20px'
  },
  lyricsTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: theme.text.primary,
    margin: '0 0 16px 0'
  },
  lyricsTextarea: {
    width: '100%',
    height: '200px',
    padding: '12px',
    backgroundColor: theme.bg.page,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '8px',
    color: theme.text.primary,
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
    color: theme.text.secondary
  },
  syncButton: {
    padding: '8px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    color: theme.text.primary,
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
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    color: theme.text.primary
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: `3px solid ${theme.bg.elevated}`,
    borderTopColor: theme.accent.primary,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  }
});

export default VideoEditorModal;
