import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import WordTimeline from './WordTimeline';
import BeatSelector from './BeatSelector';
import LyricBank from './LyricBank';
import TemplatePicker from './TemplatePicker';
import SoloClipEditor from './SoloClipEditor';
import MultiClipEditor from './MultiClipEditor';
import AudioClipSelector from './AudioClipSelector';
import CloudImportButton from './CloudImportButton';
import useEditorHistory from '../../hooks/useEditorHistory';
import useWaveform from '../../hooks/useWaveform';
import { saveApiKey, loadApiKey } from '../../services/storageService';
import { ErrorPanel, EmptyState as SharedEmptyState, useToast } from '../ui';
import {
  incrementUseCount, getLibrary, getCollections, getLyrics,
  subscribeToLibrary, subscribeToCollections, addToTextBank, MEDIA_TYPES
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
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { TextField } from '../../ui/components/TextField';
import { Badge } from '../../ui/components/Badge';
import { FeatherArrowLeft, FeatherX, FeatherPlay, FeatherPause, FeatherVolume2, FeatherVolumeX, FeatherMaximize2, FeatherPlus, FeatherTrash2, FeatherScissors, FeatherRefreshCw, FeatherChevronDown, FeatherChevronUp, FeatherZoomIn, FeatherZoomOut, FeatherStar, FeatherSave, FeatherDownload, FeatherRotateCcw, FeatherRotateCw, FeatherMusic, FeatherUpload, FeatherDatabase, FeatherMic } from '@subframe/core';

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

  // Theme (kept for dynamic values in waveform tracks)
  const { theme } = useTheme();

  // Mobile responsive detection
  const { isMobile } = useIsMobile();
  const [mobilePreviewExpanded, setMobilePreviewExpanded] = useState(false);

  // ── Multi-video state (template + generated variations) ──
  // DEFAULT_TEXT_STYLE defined outside component for stable reference
  const [allVideos, setAllVideos] = useState([{
    id: 'template',
    name: existingVideo?.name || 'Template',
    clips: existingVideo?.clips || [],
    audio: existingVideo?.audio || null,
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
  const [isSavingAll, setIsSavingAll] = useState(false);

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

  // ── Right Sidebar: collapsible sections ──
  const [videoName, setVideoName] = useState(existingVideo?.name || 'Untitled Video');
  const [openSections, setOpenSections] = useState({
    audio: true, clips: true, lyrics: false, textStyle: false
  });
  const toggleSection = useCallback((key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const renderCollapsibleSection = (key, title, content) => (
    <div className="w-full border-t border-neutral-800">
      <button
        onClick={() => toggleSection(key)}
        className="w-full flex items-center justify-between px-4 py-3 bg-transparent border-none text-white text-heading-3 font-heading-3 cursor-pointer"
      >
        <span>{title}</span>
        <FeatherChevronDown className={`w-4 h-4 text-neutral-500 flex-shrink-0 transition-transform duration-150 ${openSections[key] ? 'rotate-180' : ''}`} />
      </button>
      {openSections[key] && (
        <div className="px-4 pb-4">
          {content}
        </div>
      )}
    </div>
  );

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

      if (selectedAudio.file instanceof File || selectedAudio.file instanceof Blob) {
        audioSource = selectedAudio.file;
        log('[VideoEditorModal] Using file object for beat detection');
      } else if (localUrl && !isBlobUrl) {
        audioSource = localUrl;
        log('[VideoEditorModal] Using localUrl for beat detection');
      } else if (selectedAudio.url) {
        audioSource = selectedAudio.url;
        log('[VideoEditorModal] Using cloud URL for beat detection');
      }

      if (audioSource) {
        analyzeAudio(audioSource).catch(err => {
          console.error('Beat analysis failed:', err);
        });
      }

      // Create audio element for playback - use cloud URL if blob expired
      if (audioRef.current) {
        const playbackUrl = isBlobUrl ? selectedAudio.url : (localUrl || selectedAudio.url);
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
        audioRef.current.onloadedmetadata = onLoadedMetadata;
        audioRef.current.src = playbackUrl;
        audioRef.current.load();

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
        const bankText = textBank1[g % textBank1.length];
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
    if (isSavingAll) return;
    setIsSavingAll(true);
    let savedCount = 0;
    try {
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
          setIsSavingAll(false);
          return;
        }
        savedCount++;
      }
      clearAutoSave();
      toast.success(`Saved ${savedCount} video${savedCount !== 1 ? 's' : ''}`);
      onClose?.();
    } finally {
      setIsSavingAll(false);
    }
  }, [allVideos, existingVideo, bpm, onSave, clearAutoSave, toast, onClose, isSavingAll]);

  // Get current visible text
  const currentText = words.find(w =>
    currentTime >= w.startTime && currentTime < w.startTime + (w.duration || 0.5)
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

  // ── Montage mode (existing editor) ──
  return (
    <div
      className={`fixed inset-0 bg-black/80 flex items-center justify-center z-[1000] ${isMobile ? 'p-0' : 'p-5'}`}
      onClick={(e) => e.target === e.currentTarget && handleCloseRequest()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-editor-title"
    >
      <div className="w-full h-screen bg-black flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* ═══ TOP BAR ═══ */}
        <div className="flex w-full items-center justify-between border-b border-neutral-800 bg-black px-6 py-4">
          <div className="flex items-center gap-4">
            <IconButton
              variant="neutral-tertiary"
              size="medium"
              icon={<FeatherArrowLeft />}
              onClick={handleCloseRequest}
            />
            {!isMobile && (
              <TextField className="w-80" variant="filled" label="" helpText="">
                <TextField.Input
                  placeholder="Untitled Video"
                  value={videoName}
                  onChange={(e) => setVideoName(e.target.value)}
                />
              </TextField>
            )}
          </div>
          <div className="flex items-center gap-3">
            <IconButton
              variant="neutral-tertiary"
              size="medium"
              icon={<FeatherRotateCcw />}
              disabled={!canUndo}
              onClick={handleUndo}
              title="Undo (⌘Z)"
            />
            <IconButton
              variant="neutral-tertiary"
              size="medium"
              icon={<FeatherRotateCw />}
              disabled={!canRedo}
              onClick={handleRedo}
              title="Redo (⌘⇧Z)"
            />
            <Button
              variant="neutral-secondary"
              size="medium"
              icon={<FeatherSave />}
              onClick={handleSave}
            >
              Save
            </Button>
            <Button
              variant="brand-primary"
              size="medium"
              icon={<FeatherDownload />}
              onClick={handleSave}
            >
              Export
            </Button>
          </div>
        </div>

        {/* ═══ MAIN CONTENT ═══ */}
        <div className="flex grow shrink-0 basis-0 self-stretch overflow-hidden">

          {/* LEFT: Preview + Controls */}
          <div className="flex grow shrink-0 basis-0 flex-col items-center bg-black overflow-hidden">
            <div className="flex w-full max-w-[448px] grow flex-col items-center gap-4 py-6 px-4 overflow-auto">
              {/* Video Preview */}
              <div className="flex items-center justify-center rounded-lg bg-[#1a1a1aff] border border-neutral-800 relative overflow-hidden" style={{ aspectRatio: '9/16', height: '50vh' }}>
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
                        width: '100%', height: '100%', objectFit: 'cover',
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
                      onLoadStart={() => { if (activeVideoRef.current === 'A') { setVideoLoading(true); setVideoError(null); } }}
                      onCanPlay={() => { if (activeVideoRef.current === 'A') setVideoLoading(false); }}
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
                        width: '100%', height: '100%', objectFit: 'cover',
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
                      onLoadStart={() => { if (activeVideoRef.current === 'B') { setVideoLoading(true); setVideoError(null); } }}
                      onCanPlay={() => { if (activeVideoRef.current === 'B') setVideoLoading(false); }}
                      onError={(e) => {
                        console.error('Video B load error:', e);
                        if (activeVideoRef.current === 'B') {
                          setVideoError('Unable to load video. This may be due to CORS restrictions.');
                          setVideoLoading(false);
                        }
                      }}
                    />
                    {videoLoading && !videoError && (
                      <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-[#0a0a0aff]">
                        <div style={{ width: 32, height: 32, border: '3px solid #333', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        <p style={{ color: theme.text.secondary, marginTop: 8, fontSize: 12 }}>Loading video...</p>
                      </div>
                    )}
                    {videoError && (
                      <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-[#0a0a0aff]">
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
                  <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-[#0a0a0aff]">
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
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', maxWidth: '90%',
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
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-0 left-0 right-0 h-[15%] border-b border-dashed border-neutral-500" />
                  <div className="absolute bottom-0 left-0 right-0 h-[15%] border-t border-dashed border-neutral-500" />
                </div>
              </div>


              {/* Reroll */}
              {clips.length > 0 && (
                <Button variant="neutral-tertiary" size="medium" icon={<FeatherRefreshCw />} onClick={handleReroll}>
                  Re-roll
                </Button>
              )}

              {/* Generation Controls */}
              <div className="flex items-center gap-2">
                <Button variant="brand-primary" size="medium" icon={<FeatherPlus />}
                  onClick={executeGeneration} disabled={isGenerating || clips.length === 0}
                >
                  {isGenerating ? 'Remixing...' : 'Remix'}
                </Button>
                <input
                  type="number" min={1} max={50} value={generateCount}
                  onChange={(e) => setGenerateCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="w-16 px-2 py-1.5 rounded-md border border-neutral-700 bg-[#1a1a1aff] text-[#ffffffff] text-[12px] text-center outline-none"
                />
              </div>

            </div>

            {/* ═══ TIMELINE ═══ */}
            <div className="flex w-full flex-col items-start border-t border-neutral-800 bg-[#1a1a1aff] px-6 py-4 flex-shrink-0">
              {/* Timeline header — title + cut actions left, BPM + zoom right */}
              <div className="flex w-full items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Timeline ({clips.length} clips)</span>
                  <Button variant="neutral-secondary" size="small" onClick={handleCutByWord}>Cut by word</Button>
                  <Button variant="neutral-secondary" size="small" onClick={handleCutByBeat}>Cut by beat</Button>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">
                    {isAnalyzing ? 'Analyzing beats...' : bpm ? `${Math.round(bpm)} BPM (${filteredBeats.length} beats)` : 'No beats detected'}
                  </Badge>
                  <IconButton variant="neutral-tertiary" size="small" icon={<FeatherZoomOut />} onClick={() => setTimelineScale(s => Math.max(0.5, s - 0.1))} />
                  <IconButton variant="neutral-tertiary" size="small" icon={<FeatherZoomIn />} onClick={() => setTimelineScale(s => Math.min(2, s + 0.1))} />
                </div>
              </div>

              {/* Draft Variation Tabs */}
              {allVideos.length > 0 && (
                <div className="flex w-full gap-1.5 overflow-x-auto mb-3 pb-1">
                  {allVideos.map((video, idx) => (
                    <button
                      key={video.id}
                      onClick={() => switchToVideo(idx)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] whitespace-nowrap flex-shrink-0 cursor-pointer transition-colors ${
                        idx === activeVideoIndex
                          ? 'border-brand-600 bg-brand-600/15 text-brand-600 font-semibold'
                          : 'border-neutral-700 bg-[#1a1a1aff] text-neutral-400 hover:border-neutral-600'
                      }`}
                    >
                      {video.isTemplate ? 'Template' : (
                        <>
                          #{idx}
                          <span onClick={(e) => { e.stopPropagation(); handleDeleteVideo(idx); }} className="ml-0.5 opacity-50 hover:opacity-100 cursor-pointer text-[10px]">x</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex w-full flex-col gap-2">
                {/* Clips Track */}
                <div className="flex w-full items-center gap-3">
                  <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Clips</span>
                  <div className="flex-1 min-h-[48px] rounded-md border border-neutral-800 bg-black overflow-hidden relative" ref={timelineRef} onPointerDown={handleTimelineMarqueeDown}>
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
                  <div className="text-center py-5 text-neutral-500 text-[13px]">
                    <p>Click clips above to add, or use Cut by beat</p>
                  </div>
                ) : (
                  <div className="flex gap-2">
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
                          position: 'relative', height: '48px', backgroundColor: '#8b5cf6',
                          borderRadius: '6px', overflow: 'hidden', flexShrink: 0,
                          width: `${clipWidth}px`,
                          minWidth: '50px',
                          display: 'flex',
                          flexDirection: 'row',
                          border: selectedClips.includes(index) ? '2px solid #6366f1' : '2px solid transparent',
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
                            onPointerDown={(e) => handleClipResizeStart(e, index)}
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
                  </div>
                </div>

                {/* Audio Track (External) */}
                {selectedAudio && selectedAudio.url && !selectedAudio.isSourceAudio && waveformData.length > 0 && (
                  <div className="flex w-full items-center gap-3">
                    <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Audio</span>
                    <div className="flex-1 rounded-md border border-neutral-800 bg-black overflow-hidden">
                {(() => {
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
                          style={{ width: '36px', height: '3px', accentColor: '#22c55e', cursor: 'pointer' }}
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
                              backgroundColor: 'rgba(34, 197, 94, 0.08)',
                              border: '1px solid rgba(34, 197, 94, 0.2)'
                            }}>
                              {slicedData.map((amplitude, i) => (
                                <div key={i} style={{
                                  flex: 1, minWidth: '1px', backgroundColor: 'rgba(34, 197, 94, 0.5)',
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
                    </div>
                  </div>
                )}

                {/* Source Audio Track */}
                {Object.keys(clipWaveforms).length > 0 && (
                  <div className="flex w-full items-center gap-3">
                    <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Source</span>
                    <div className="flex-1 rounded-md border border-neutral-800 bg-black overflow-hidden">
                {(() => {
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
                            style={{ width: '36px', height: '3px', accentColor: '#f59e0b', cursor: 'pointer' }}
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
                              backgroundColor: (hasExternal && sourceVideoMuted) ? 'rgba(245, 158, 11, 0.04)' : 'rgba(245, 158, 11, 0.08)',
                              border: `1px solid rgba(245, 158, 11, ${(hasExternal && sourceVideoMuted) ? '0.1' : '0.2'})`
                            }}>
                              {data.map((amplitude, i) => (
                                <div key={i} style={{
                                  flex: 1, minWidth: '1px', backgroundColor: 'rgba(245, 158, 11, 0.4)',
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
                  </div>
                )}
              </div>

              {/* Clip Actions */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Button variant="neutral-secondary" size="small" onClick={handleCombine} title="Combine selected clips or clip at playhead with next">Combine</Button>
                <Button variant="neutral-secondary" size="small" onClick={handleBreak} title="Split clip at playhead position">Break</Button>
                <Button variant="neutral-secondary" size="small" icon={<FeatherRefreshCw />} onClick={handleReroll} title="Replace clip(s) with random from bank">Reroll</Button>
                <Button variant="neutral-secondary" size="small" onClick={handleRearrange}>Rearrange</Button>
                <Button variant="destructive-tertiary" size="small" icon={<FeatherTrash2 />} onClick={handleRemoveClips} title="Delete selected clip(s) or clip at playhead">Remove</Button>
              </div>

              {/* Selection info */}
              {selectedClips.length > 1 && (
                <div className="flex items-center gap-2 px-2 py-1 text-[12px] text-brand-600">
                  <span>{selectedClips.length} clips selected</span>
                  <Button variant="neutral-tertiary" size="small" onClick={() => setSelectedClips([])}>Clear</Button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Sidebar */}
          {!isMobile && (
            <div className="flex w-96 flex-none flex-col items-start self-stretch border-l border-neutral-800 bg-[#1a1a1aff] overflow-auto">
              <div className="flex w-full flex-col items-start">
                {renderCollapsibleSection('audio', 'Audio', (
                  <div className="flex flex-col gap-3">
                    {/* Audio section — populated in Batch 2 */}
                    {selectedAudio ? (
                      <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-black px-3 py-2">
                        <FeatherMusic className="text-neutral-400" style={{ width: 16, height: 16 }} />
                        <span className="text-body font-body text-[#ffffffff] truncate flex-1">{selectedAudio.name}</span>
                        {selectedAudio.isTrimmed && <Badge variant="neutral">Trimmed</Badge>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-black px-3 py-2">
                        <FeatherMusic className="text-neutral-500" style={{ width: 16, height: 16 }} />
                        <span className="text-body font-body text-neutral-500">No audio selected</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {selectedAudio && (
                        <>
                          <Button variant="neutral-secondary" size="small" icon={<FeatherScissors />} onClick={() => { setAudioToTrim(selectedAudio); setShowAudioTrimmer(true); }}>Trim</Button>
                          <Button variant="destructive-tertiary" size="small" icon={<FeatherTrash2 />} onClick={() => {
                            if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
                            setSelectedAudio(null); setIsPlaying(false); setCurrentTime(0); setDuration(0); setSourceVideoMuted(false);
                          }}>Remove</Button>
                        </>
                      )}
                    </div>
                    <Button className="w-full" variant="neutral-secondary" size="small" icon={<FeatherUpload />} onClick={() => audioFileInputRef.current?.click()}>
                      {selectedAudio ? 'Change Audio' : 'Upload Audio'}
                    </Button>
                    {/* Library audio list */}
                    {libraryAudio.length > 0 && (
                      <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
                        <span className="text-caption font-caption text-neutral-400">Library Audio</span>
                        {libraryAudio.map(audio => (
                          <div
                            key={audio.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-neutral-800 text-[12px] text-[#ffffffff]"
                            onClick={() => { setAudioToTrim(audio); setShowAudioTrimmer(true); }}
                          >
                            <FeatherMusic className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                            <span className="truncate">{audio.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {renderCollapsibleSection('clips', 'Clips', (
                  <div className="flex flex-col gap-3">
                    {/* Collection dropdown */}
                    <select
                      value={selectedCollection}
                      onChange={(e) => setSelectedCollection(e.target.value)}
                      className="w-full px-3 py-2 bg-black border border-neutral-800 rounded-md text-[#ffffffff] text-[13px] outline-none cursor-pointer"
                    >
                      <option value="category">Selected Clips</option>
                      <option value="all">All Videos (Library)</option>
                      {sidebarCollections.map(col => (
                        <option key={col.id} value={col.id}>{col.name}</option>
                      ))}
                    </select>
                    {/* Clip count + actions */}
                    <div className="flex justify-between items-center">
                      <span className="text-caption font-caption text-neutral-400">{visibleVideos.length} clips</span>
                      <div className="flex gap-1.5 items-center">
                        <CloudImportButton artistId={artistId} db={db} mediaType="video" compact onImportMedia={(files) => {
                          const newVids = files.map((f, i) => ({ id: `import_${Date.now()}_${i}`, name: f.name, url: f.url, localUrl: f.localUrl, type: 'video' }));
                          setLibraryVideos(prev => [...prev, ...newVids]);
                        }} />
                        <Button variant="neutral-tertiary" size="small" onClick={() => {
                          const newClips = visibleVideos.map((v, i) => ({
                            id: `clip_${Date.now()}_${i}`, sourceId: v.id, url: v.url || v.localUrl,
                            localUrl: v.localUrl || v.url, thumbnail: v.thumbnailUrl || v.thumbnail,
                            startTime: i * 2, duration: 2, locked: false
                          }));
                          setClips(newClips);
                        }}>Add All</Button>
                      </div>
                    </div>
                    {/* Clip grid */}
                    {visibleVideos.length === 0 ? (
                      <div className="py-4 text-center text-neutral-500 text-[13px]">No videos in this collection</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {visibleVideos.map((video, i) => {
                          const isInTimeline = clips.some(clip => clip.sourceId === video.id);
                          return (
                            <div
                              key={video.id || i}
                              className={`cursor-pointer p-1 rounded-md border-2 transition-colors relative ${isInTimeline ? 'border-green-500/40' : 'border-transparent'}`}
                              onClick={() => {
                                setClips(prev => [...prev, {
                                  id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                  sourceId: video.id, url: video.url || video.localUrl,
                                  localUrl: video.localUrl || video.url, thumbnail: video.thumbnailUrl || video.thumbnail,
                                  startTime: prev.length * 2, duration: 2, locked: false
                                }]);
                                if (video.id && category?.artistId) incrementUseCount(category.artistId, video.id);
                              }}
                            >
                              {isInTimeline && (
                                <div className="absolute top-1 right-1 z-[2] w-[18px] h-[18px] rounded-full bg-green-500 flex items-center justify-center text-[11px] text-white font-bold shadow-sm">✓</div>
                              )}
                              <div className="w-full aspect-video rounded overflow-hidden bg-[#0a0a0aff]">
                                {(video.thumbnailUrl || video.thumbnail) ? (
                                  <img src={video.thumbnailUrl || video.thumbnail} alt={video.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-xl">🎬</div>
                                )}
                              </div>
                              <div className="text-[10px] text-neutral-400 overflow-hidden text-ellipsis whitespace-nowrap mt-1">
                                {(video.name || video.metadata?.originalName || 'Clip').substring(0, 20)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Text Banks */}
                    {(() => {
                      const { textBank1, textBank2 } = getTextBanks();
                      return (
                        <div className="flex flex-col gap-3 pt-3 border-t border-neutral-800">
                          <div>
                            <div className="text-body-bold font-body-bold text-teal-400 mb-2">Text Bank A</div>
                            <div className="flex gap-1.5 mb-2">
                              <input value={newTextA} onChange={(e) => setNewTextA(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && newTextA.trim()) { handleAddToTextBank(1, newTextA); setNewTextA(''); } }}
                                placeholder="Add text..." className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-800 bg-black text-[#ffffffff] text-[12px] outline-none" />
                              <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} onClick={() => { if (newTextA.trim()) { handleAddToTextBank(1, newTextA); setNewTextA(''); } }} />
                            </div>
                            {textBank1.map((text, idx) => (
                              <div key={idx} className="flex items-center px-2 py-1.5 rounded-md bg-neutral-800/50 mb-1 text-neutral-300">
                                <span className="flex-1 text-[12px]">{text}</span>
                              </div>
                            ))}
                            {textBank1.length === 0 && <div className="text-[11px] text-neutral-500">No text added yet</div>}
                          </div>
                          <div>
                            <div className="text-body-bold font-body-bold text-amber-400 mb-2">Text Bank B</div>
                            <div className="flex gap-1.5 mb-2">
                              <input value={newTextB} onChange={(e) => setNewTextB(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && newTextB.trim()) { handleAddToTextBank(2, newTextB); setNewTextB(''); } }}
                                placeholder="Add text..." className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-800 bg-black text-[#ffffffff] text-[12px] outline-none" />
                              <IconButton variant="brand-primary" size="small" icon={<FeatherPlus />} onClick={() => { if (newTextB.trim()) { handleAddToTextBank(2, newTextB); setNewTextB(''); } }} />
                            </div>
                            {textBank2.map((text, idx) => (
                              <div key={idx} className="flex items-center px-2 py-1.5 rounded-md bg-neutral-800/50 mb-1 text-neutral-300">
                                <span className="flex-1 text-[12px]">{text}</span>
                              </div>
                            ))}
                            {textBank2.length === 0 && <div className="text-[11px] text-neutral-500">No text added yet</div>}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}

                {renderCollapsibleSection('lyrics', 'Lyrics', (
                  <div className="flex flex-col gap-3">
                    <textarea
                      className="w-full rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-white placeholder-neutral-500 resize-y outline-none focus:border-brand-600"
                      style={{ minHeight: 80 }}
                      placeholder="Enter or paste lyrics here..."
                      value={lyrics}
                      onChange={(e) => setLyrics(e.target.value)}
                      rows={4}
                    />
                    <div className="flex w-full items-center gap-2">
                      <Button className="grow" variant="neutral-secondary" size="small" icon={<FeatherDatabase />}
                        onClick={() => setShowLyricBankPicker(!showLyricBankPicker)}
                        disabled={(category?.lyrics?.length || 0) === 0}
                      >
                        Load from Bank ({category?.lyrics?.length || 0})
                      </Button>
                      <Button className="grow" variant="neutral-secondary" size="small" icon={<FeatherMic />}
                        onClick={handleAITranscribe}
                        disabled={isTranscribing || !selectedAudio}
                      >
                        {isTranscribing ? 'Transcribing...' : 'AI Transcribe'}
                      </Button>
                    </div>
                    {/* Lyric Bank Dropdown */}
                    {showLyricBankPicker && (category?.lyrics?.length || 0) > 0 && (
                      <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-h-[200px] overflow-y-auto shadow-lg">
                        {category.lyrics.map(lyric => (
                          <div key={lyric.id} className="w-full px-3 py-2.5 border-b border-neutral-800 text-[#ffffffff] text-left cursor-pointer text-[13px] hover:bg-neutral-800"
                            onClick={() => {
                              const content = lyric.content || '';
                              let newWords;
                              if (lyric.words?.length > 0) { newWords = lyric.words; }
                              else {
                                const lyricWords = content.split(/\s+/).filter(w => w.trim().length > 0);
                                newWords = lyricWords.map((text, i) => ({ id: `word_${Date.now()}_${i}`, text, startTime: i * 0.5, duration: 0.5 }));
                              }
                              setLyrics(content); setWords(newWords); setLoadedBankLyricId(lyric.id); setShowLyricBankPicker(false);
                            }}
                          >
                            <div className="font-medium mb-0.5">{lyric.title}</div>
                            <div className="text-[11px] text-neutral-400 truncate">{lyric.content?.substring(0, 50)}...</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="neutral-secondary" size="small" onClick={() => setShowLyricsEditor(true)}>Quick Edit</Button>
                      <Button variant="neutral-secondary" size="small" onClick={() => setShowWordTimeline(true)}>Word Timeline</Button>
                    </div>
                    {lyrics && (
                      <Button className="w-full" variant="neutral-tertiary" size="small" icon={<FeatherX />} onClick={() => setLyrics('')}>Clear</Button>
                    )}
                    {transcriptionError && (
                      <div className="p-3 bg-red-950 border border-red-600 rounded-lg">
                        <p className="text-red-300 text-[12px] mb-2">{transcriptionError}</p>
                        <Button variant="destructive-primary" size="small" onClick={() => { setTranscriptionError(null); handleAITranscribe(); }}>Retry</Button>
                      </div>
                    )}
                    {!selectedAudio && !isTranscribing && (
                      <p className="text-neutral-500 text-[11px]">Select audio to enable AI transcription</p>
                    )}
                    {/* Full LyricBank component */}
                    <div className="border-t border-neutral-800 pt-3">
                      <LyricBank
                        lyrics={category?.lyrics || []}
                        onAddLyrics={onAddLyrics}
                        onUpdateLyrics={onUpdateLyrics}
                        onDeleteLyrics={onDeleteLyrics}
                        onSelectText={(selectedText) => { setLyrics(selectedText); toast.success('Lyrics loaded!'); }}
                        compact={false}
                        showAddForm={true}
                      />
                    </div>
                  </div>
                ))}

                {renderCollapsibleSection('textStyle', 'Text Style', (
                  <div className="flex flex-col gap-3">
                    {/* Font Controls */}
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <Button variant="neutral-secondary" size="small" onClick={() => setTextStyle(s => ({ ...s, fontSize: Math.max(24, s.fontSize - 4) }))}>A-</Button>
                        <Button variant="neutral-secondary" size="small" onClick={() => setTextStyle(s => ({ ...s, fontSize: Math.min(120, s.fontSize + 4) }))}>A+</Button>
                      </div>
                      <select value={textStyle.fontFamily} onChange={(e) => setTextStyle(s => ({ ...s, fontFamily: e.target.value }))}
                        className="flex-1 px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-[#ffffffff] text-[12px] outline-none">
                        <option value="Inter, sans-serif">Sans</option>
                        <option value="'Playfair Display', serif">Serif</option>
                        <option value="'Space Grotesk', sans-serif">Grotesk</option>
                        <option value="monospace">Mono</option>
                      </select>
                    </div>
                    {/* Outline */}
                    <ToggleGroup value={textStyle.outline ? 'outline' : 'none'} onValueChange={(v) => setTextStyle(s => ({ ...s, outline: v === 'outline' }))}>
                      <ToggleGroup.Item value="none">No outline</ToggleGroup.Item>
                      <ToggleGroup.Item value="outline">Outline</ToggleGroup.Item>
                    </ToggleGroup>
                    {/* Colors */}
                    <div className="flex w-full items-center gap-2">
                      <div className="flex grow flex-col items-start gap-1">
                        <span className="text-caption font-caption text-neutral-400">Text Color</span>
                        <label className="flex h-10 w-full items-center gap-2 rounded-md border border-neutral-800 bg-black px-3 cursor-pointer">
                          <input type="color" value={textStyle.color} onChange={(e) => setTextStyle(s => ({ ...s, color: e.target.value }))} className="w-6 h-6 rounded-md border-0 p-0 cursor-pointer" />
                          <span className="text-caption font-caption text-neutral-400">{textStyle.color}</span>
                        </label>
                      </div>
                      {textStyle.outline && (
                        <div className="flex grow flex-col items-start gap-1">
                          <span className="text-caption font-caption text-neutral-400">Outline</span>
                          <label className="flex h-10 w-full items-center gap-2 rounded-md border border-neutral-800 bg-black px-3 cursor-pointer">
                            <input type="color" value={textStyle.outlineColor} onChange={(e) => setTextStyle(s => ({ ...s, outlineColor: e.target.value }))} className="w-6 h-6 rounded-md border-0 p-0 cursor-pointer" />
                            <span className="text-caption font-caption text-neutral-400">{textStyle.outlineColor}</span>
                          </label>
                        </div>
                      )}
                    </div>
                    {/* Display Mode */}
                    <div className="flex flex-col gap-1">
                      <span className="text-caption font-caption text-neutral-400">Display Mode</span>
                      <ToggleGroup value={textStyle.displayMode} onValueChange={(v) => setTextStyle(s => ({ ...s, displayMode: v }))}>
                        <ToggleGroup.Item value="word">By word</ToggleGroup.Item>
                        <ToggleGroup.Item value="buildLine">Build line</ToggleGroup.Item>
                        <ToggleGroup.Item value="justify">Justify</ToggleGroup.Item>
                      </ToggleGroup>
                    </div>
                    {/* Case */}
                    <div className="flex flex-col gap-1">
                      <span className="text-caption font-caption text-neutral-400">Case</span>
                      <ToggleGroup value={textStyle.textCase} onValueChange={(v) => setTextStyle(s => ({ ...s, textCase: v }))}>
                        <ToggleGroup.Item value="default">Default</ToggleGroup.Item>
                        <ToggleGroup.Item value="lower">lower</ToggleGroup.Item>
                        <ToggleGroup.Item value="upper">UPPER</ToggleGroup.Item>
                      </ToggleGroup>
                    </div>
                    {/* Crop Mode */}
                    <div className="flex items-center gap-2">
                      <span className="text-caption font-caption text-neutral-400">Crop</span>
                      <select value={cropMode} onChange={(e) => setCropMode(e.target.value)} className="flex-1 px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-[#ffffffff] text-[12px] outline-none">
                        <option value="9:16">9:16 (Full)</option>
                        <option value="4:3">4:3 (Crop)</option>
                        <option value="1:1">1:1 (Crop)</option>
                      </select>
                    </div>
                    {/* Preset selector */}
                    {presets.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-caption font-caption text-neutral-400">Apply Preset</span>
                        <select value={selectedPreset?.id || ''} onChange={(e) => { const preset = presets.find(p => p.id === e.target.value); if (preset) handleApplyPreset(preset); }}
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-[#ffffffff] text-[13px] outline-none">
                          <option value="">Choose a preset...</option>
                          {presets.map(preset => (<option key={preset.id} value={preset.id}>{preset.name}</option>))}
                        </select>
                      </div>
                    )}
                    {/* Text Overlays info */}
                    <div className="border-t border-neutral-800 pt-3">
                      <span className="text-body-bold font-body-bold text-[#ffffffff] mb-2 block">Text Overlays</span>
                      {words.length > 0 ? (
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-neutral-800/50 text-[12px]">
                          <span className="text-neutral-400">Center</span>
                          <span className="flex-1 text-[#ffffffff] truncate">{words.slice(0, 5).map(w => w.text).join(' ')}{words.length > 5 ? '...' : ''}</span>
                          <Badge variant="neutral">{words.length} words</Badge>
                        </div>
                      ) : (
                        <p className="text-[12px] text-neutral-500">No lyrics added yet</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Hidden audio file input */}
        <input
          ref={audioFileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={handleAudioUpload}
        />

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-neutral-800">
          <div className="flex items-center gap-3">
            {lastSaved && (
              <span className="text-[11px] text-green-400 flex items-center gap-1">
                ✓ Auto-saved {lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="neutral-secondary" size="medium" onClick={onClose}>Cancel</Button>
            <Button variant="brand-primary" size="medium" onClick={handleSaveAllAndClose} disabled={isSavingAll}>{isSavingAll ? 'Saving...' : `Save All (${allVideos.length})`}</Button>
          </div>
        </div>

        {/* Lyrics Editor Modal */}
        {showLyricsEditor && (
          <div
            className="absolute inset-0 bg-black/80 flex items-center justify-center z-10"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setShowLyricsEditor(false); } }}
          >
            <div className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[400px]'}`}>
              <h3 className="text-[16px] font-semibold text-[#ffffffff] mb-4">Edit Lyrics</h3>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Enter your lyrics here, one word or line per row..."
                className={`w-full h-[200px] p-3 bg-[#0a0a0a] border border-neutral-700 rounded-lg text-white text-sm resize-none outline-none mb-4 ${isMobile ? 'min-h-[150px] text-base' : ''}`}
                autoFocus={!isMobile}
              />
              <div className={`flex items-center gap-2 mb-4 text-[13px] text-neutral-400 ${isMobile ? 'flex-col items-stretch' : ''}`}>
                <span>Sync method:</span>
                <div className={`flex gap-2 ${isMobile ? 'w-full' : ''}`}>
                  <Button variant="neutral-secondary" size="small" className={isMobile ? 'flex-1' : ''} onClick={() => handleSyncLyrics('beat')}>Sync to beats</Button>
                  <Button variant="neutral-secondary" size="small" className={isMobile ? 'flex-1' : ''} onClick={() => handleSyncLyrics('even')}>Spread evenly</Button>
                </div>
              </div>
              <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
                <Button variant="neutral-secondary" size="small" className={isMobile ? 'w-full' : ''} onClick={() => setShowLyricsEditor(false)}>Cancel</Button>
                <Button variant="brand-primary" size="small" className={isMobile ? 'w-full' : ''} onClick={() => setShowLyricsEditor(false)}>Done</Button>
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
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[400px]'}`}>
              <h3 className="text-[16px] font-semibold text-white mb-4">🔑 OpenAI API Key</h3>
              <p style={{ color: theme.text.secondary }} className="text-sm mb-4">
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
                className={`w-full rounded-lg mb-4 outline-none ${isMobile ? 'p-3.5 text-base' : 'p-3 text-sm'}`}
                style={{ background: theme.bg.surface, border: `1px solid ${theme.bg.elevated}`, color: theme.text.primary }}
              />
              <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
                <Button variant="neutral-secondary" size="small" className={isMobile ? 'w-full' : ''} onClick={() => { setShowApiKeyModal(false); setApiKeyInput(''); }}>
                  Cancel
                </Button>
                <Button variant="brand-primary" size="small" className={isMobile ? 'w-full' : ''} onClick={handleSaveApiKey} disabled={!apiKeyInput.trim()}>
                  Save & Transcribe
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Analyzing Overlay */}
        {isAnalyzing && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-4 text-[#ffffffff]">
            <div className="w-10 h-10 border-[3px] border-[#333] border-t-[#6366f1] rounded-full animate-spin" />
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
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[400px]'}`}>
              <h3 className="text-[16px] font-semibold text-white mb-4">📝 Recover Unsaved Work?</h3>
              <p style={{ color: theme.text.secondary }} className="text-sm mb-4">
                We found an auto-saved draft from{' '}
                <strong style={{ color: theme.text.primary }}>
                  {recoveryData.savedAt ? new Date(recoveryData.savedAt).toLocaleString() : 'recently'}
                </strong>
              </p>
              <div className="p-3 rounded-lg mb-4 text-[13px]" style={{ backgroundColor: theme.bg.surface, color: theme.text.secondary }}>
                <div>🎵 Audio: {recoveryData.audio?.name || 'None'}</div>
                <div>🎬 Clips: {recoveryData.clips?.length || 0}</div>
                <div>💬 Words: {recoveryData.words?.length || 0}</div>
              </div>
              <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
                <Button variant="neutral-secondary" size="small" className={isMobile ? 'w-full' : ''} onClick={handleDiscardDraft}>
                  Start Fresh
                </Button>
                <Button variant="brand-primary" size="small" className={isMobile ? 'w-full' : ''} onClick={handleRestoreDraft}>
                  Restore Draft
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Save Lyrics to Song Prompt */}
        {showSaveLyricsPrompt && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[400px]'}`}>
              <h3 className="text-[16px] font-semibold text-white mb-4">💾 Save Lyrics to Song?</h3>
              <p style={{ color: theme.text.secondary }} className="text-sm mb-4">
                You've created timed lyrics for <strong style={{ color: theme.text.primary }}>{selectedAudio?.name || 'this song'}</strong>.
                Save them to the song so they're automatically available next time you use it?
              </p>
              <div className="p-3 rounded-lg mb-4 text-[13px]" style={{ backgroundColor: theme.bg.surface, color: theme.text.secondary }}>
                <div>🎤 {words.length} words with timing data</div>
                <div className="mt-1 text-xs" style={{ color: theme.text.muted }}>
                  "{words.slice(0, 5).map(w => w.text).join(' ')}{words.length > 5 ? '...' : ''}"
                </div>
              </div>
              <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
                <Button variant="neutral-secondary" size="small" className={isMobile ? 'w-full' : ''} onClick={() => handleLyricsPromptResponse(false)}>
                  No, Just This Video
                </Button>
                <Button variant="brand-primary" size="small" className={isMobile ? 'w-full' : ''} onClick={() => handleLyricsPromptResponse(true)}>
                  Yes, Save to Song
                </Button>
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
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className={`bg-[#1a1a1a] rounded-xl p-5 ${isMobile ? 'w-[95%] max-w-[95%] max-h-[90vh] overflow-auto' : 'w-[380px]'}`}>
              <h3 className="text-[16px] font-semibold text-white mb-4">Close Editor?</h3>
              <p style={{ color: theme.text.secondary }} className="text-sm mb-4">
                You have unsaved work. Are you sure you want to close?
              </p>
              <div className="p-3 rounded-lg mb-4 text-[13px]" style={{ backgroundColor: theme.bg.surface, color: theme.text.secondary }}>
                {selectedAudio && <div>🎵 Audio selected</div>}
                {clips.length > 0 && <div>🎬 {clips.length} clips</div>}
                {words.length > 0 && <div>💬 {words.length} words timed</div>}
              </div>
              <div className={`flex justify-end gap-2 ${isMobile ? 'flex-col' : ''}`}>
                <Button variant="neutral-secondary" size="small" className={isMobile ? 'w-full' : ''} onClick={() => setShowCloseConfirm(false)}>
                  Keep Editing
                </Button>
                <Button variant="destructive-primary" size="small" className={isMobile ? 'w-full' : ''} onClick={handleConfirmClose}>
                  Close Anyway
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Preset name prompt modal */}
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
                    onSavePreset({ name: presetPromptValue.trim(), settings: { ...textStyle, cropMode } });
                    toast.success?.(`Preset "${presetPromptValue.trim()}" saved!`);
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
                    onSavePreset({ name: presetPromptValue.trim(), settings: { ...textStyle, cropMode } });
                    toast.success?.(`Preset "${presetPromptValue.trim()}" saved!`);
                  }
                  setShowPresetPrompt(false);
                }}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// getStyles deleted — all styles now use Tailwind/Subframe classes
// Remaining export below

export default VideoEditorModal;
