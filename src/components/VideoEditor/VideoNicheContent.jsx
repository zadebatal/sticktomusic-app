/**
 * VideoNicheContent — "Create [Format]" button + draft grid for video niches
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import VideoPreviewLightbox from './shared/VideoPreviewLightbox';
import MediaStatusBadge from '../ui/MediaStatusBadge';
import ImportFromLibraryModal from './shared/ImportFromLibraryModal';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlay,
  FeatherSquare,
  FeatherImage,
  FeatherFilm,
  FeatherLayers,
  FeatherCamera,
  FeatherPlus,
  FeatherX,
  FeatherEdit2,
  FeatherCheck,
  FeatherType,
  FeatherUpload,
  FeatherDownloadCloud,
  FeatherScissors,
  FeatherLink,
  FeatherMusic,
  FeatherChevronDown,
  FeatherChevronRight,
  FeatherMic,
  FeatherTrash2,
} from '@subframe/core';
import {
  updateNicheAudioId,
  updateNicheMediaOrder,
  updateMediaTrimPoints,
  addToVideoTextBank,
  removeFromVideoTextBank,
  addToLibraryAsync,
  addToCollectionAsync,
  getUserCollections,
  addToProjectPool,
  migrateToMediaBanks,
  addMediaBank,
  removeMediaBank,
  renameMediaBank,
  removeFromMediaBank,
  moveMediaBetweenBanks,
  assignToMediaBank,
  getBankColor,
  MAX_MEDIA_BANKS,
  updateLibraryItemAsync,
} from '../../services/libraryService';
import { getLyrics } from '../../services/libraryService';
import useMediaMultiSelect from './shared/useMediaMultiSelect';
import useDragReorder from './shared/useDragReorder';
import QuickTrimPopover from './shared/QuickTrimPopover';
import LyricBankSection from './shared/LyricBankSection';
import AudioClipSelector from './AudioClipSelector';
import WordTimeline from './WordTimeline';
import { useLyricAnalyzer } from '../../hooks/useLyricAnalyzer';
import { useToast, ConfirmDialog } from '../ui';
import { isSearchAvailable, searchMedia } from '../../services/mediaSearchService';
import { uploadLocalItemToCloud } from '../../services/localMediaService';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { bucketByDuration } from './shared/editorConstants';

const FORMAT_ICONS = {
  montage: FeatherFilm,
  solo_clip: FeatherPlay,
  multi_clip: FeatherLayers,
  photo_montage: FeatherCamera,
};

const VideoNicheContent = ({
  db,
  user = null,
  artistId,
  artistName = '',
  niche,
  library = [],
  collections = [],
  createdContent,
  projectAudio = [],
  onMakeVideo,
  onUpload,
  onUploadAudio,
  onImport,
  onImportAudio,
  onWebImport,
  onWebImportAudio,
  onUploadToMediaBank,
  onImportToMediaBank,
  onWebImportToMediaBank,
  selectedMediaBankIds: externalSelectedBankIds,
  onSelectedMediaBankIdsChange,
  onSelectedClipIdsChange,
  onRefreshCollections,
  onAddLyrics,
  onUpdateLyrics,
  onDeleteLyrics,
  onRemoveAudio,
}) => {
  const activeFormat =
    niche?.formats?.find((f) => f.id === niche.activeFormatId) || niche?.formats?.[0];
  const IconComponent = FORMAT_ICONS[activeFormat?.id] || FeatherPlay;
  const [textBankInput1, setTextBankInput1] = useState('');
  const [textBankInput2, setTextBankInput2] = useState('');
  const [lightboxItem, setLightboxItem] = useState(null);
  const [trimItemId, setTrimItemId] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);

  // Media banks state
  const [newBankName, setNewBankName] = useState('');
  const [showNewBankInput, setShowNewBankInput] = useState(false);
  const [renamingBankId, setRenamingBankId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  // Use external state if provided (lifted to parent), otherwise internal
  const selectedBankIds = externalSelectedBankIds !== undefined ? externalSelectedBankIds : null;
  const setSelectedBankIds = onSelectedMediaBankIdsChange || (() => {});

  // Multi-select state for bank media (selection scoped to one bank at a time)
  const [bankSelectedIds, setBankSelectedIds] = useState(new Set());
  const [selectionBankId, setSelectionBankId] = useState(null);
  const [bankRubberBand, setBankRubberBand] = useState(null);
  const bankDragStartRef = useRef(null);
  const bankDragPriorRef = useRef(new Set());
  const bankGridRefs = useRef({});

  // Broken thumbnails: tracks items whose thumbnailUrl 404s. Same mitigation as
  // AllMediaContent — when an <img> errors out we add the ID here so the next
  // render falls through to the Film/Image icon placeholder. The underlying
  // problem is local-first orphan items (Firestore metadata referencing files
  // that only existed on a since-deleted device) — see 94n session notes.
  const [brokenThumbs, setBrokenThumbs] = useState(() => new Set());
  const markThumbBroken = useCallback((id) => {
    setBrokenThumbs((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Audio preview playback
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const audioPreviewRef = useRef(null);
  const { success: toastSuccess, error: toastError } = useToast();

  const handlePlayAudio = useCallback(
    (e, audio) => {
      e.stopPropagation();
      const el = audioPreviewRef.current;
      if (!el) return;
      if (playingAudioId === audio.id) {
        el.pause();
        el.currentTime = 0;
        setPlayingAudioId(null);
      } else {
        // Pick the best available URL — skip blob: URLs (stale after reload)
        const validUrl = (u) => u && !u.startsWith('blob:');
        const src = validUrl(audio.url)
          ? audio.url
          : validUrl(audio.localUrl)
            ? audio.localUrl
            : null;
        if (!src) {
          toastError('This track has no valid URL — please re-upload it');
          return;
        }
        el.src = src;
        el.play().catch(() => {
          toastError('Could not play this track — the file may need to be re-uploaded');
          setPlayingAudioId(null);
        });
        setPlayingAudioId(audio.id);
      }
    },
    [playingAudioId, toastError],
  );

  // Audio rename
  const [renamingAudioId, setRenamingAudioId] = useState(null);
  const [renameAudioValue, setRenameAudioValue] = useState('');

  const handleStartRenameAudio = useCallback((e, audio) => {
    e.stopPropagation();
    setRenamingAudioId(audio.id);
    setRenameAudioValue(audio.name?.replace(/\.[^.]+$/, '') || '');
  }, []);

  const handleSaveRenameAudio = useCallback(async () => {
    if (!renamingAudioId || !renameAudioValue.trim()) {
      setRenamingAudioId(null);
      return;
    }
    const audio = projectAudio.find((a) => a.id === renamingAudioId);
    const ext = audio?.name?.match(/\.[^.]+$/)?.[0] || '';
    await updateLibraryItemAsync(db, artistId, renamingAudioId, {
      name: renameAudioValue.trim() + ext,
    });
    toastSuccess('Audio renamed');
    setRenamingAudioId(null);
  }, [renamingAudioId, renameAudioValue, projectAudio, db, artistId, toastSuccess]);

  // Trim specific audio track
  const [trimAudioTarget, setTrimAudioTarget] = useState(null);

  const handleOpenAudioTrimmer = useCallback((e, audio) => {
    e.stopPropagation();
    setTrimAudioTarget(audio);
    setShowAudioTrimmer(true);
  }, []);

  // Lyric bank state — scoped to this niche
  const [lyricsBank, setLyricsBank] = useState([]);
  useEffect(() => {
    if (!artistId) return;
    const allLyrics = getLyrics(artistId);
    const nicheId = niche?.id;
    if (nicheId) {
      setLyricsBank(allLyrics.filter((l) => l.collectionIds?.includes(nicheId)));
    } else {
      setLyricsBank(allLyrics);
    }
  }, [artistId, niche?.id]);

  // Audio tools
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [transcribedWords, setTranscribedWords] = useState([]);
  const [transcribedDuration, setTranscribedDuration] = useState(30);
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [pendingTranscription, setPendingTranscription] = useState(null);
  const { analyze: analyzeAudio, isAnalyzing, progress: analyzeProgress } = useLyricAnalyzer();
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });

  // Bank search state
  const [bankSearch, setBankSearch] = useState('');
  const [bankSearchMode, setBankSearchMode] = useState('name'); // 'name' | 'visual'
  const [bankSemanticResults, setBankSemanticResults] = useState(null);
  const [isBankSearching, setIsBankSearching] = useState(false);
  const [showBankDurationBuckets, setShowBankDurationBuckets] = useState(false);
  // Active bank tab — 'all' means show union of all banks, otherwise the specific bank id
  const [activeBankId, setActiveBankId] = useState('all');

  // Debounced semantic search for bank media
  useEffect(() => {
    if (bankSearchMode !== 'visual' || !bankSearch.trim()) {
      setBankSemanticResults(null);
      setIsBankSearching(false);
      return;
    }
    setIsBankSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchMedia(artistId, bankSearch, {
        collectionIds: niche?.id ? [niche.id] : undefined,
      });
      setBankSemanticResults(results);
      setIsBankSearching(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [bankSearchMode, bankSearch, artistId, niche?.id]);

  // Helper: filter bank media by search query
  const filterBankMedia = useCallback(
    (items) => {
      if (!bankSearch.trim()) return items;
      if (bankSearchMode === 'visual' && bankSemanticResults) {
        const matchIds = new Set(bankSemanticResults.map((r) => r.mediaId));
        return items.filter((m) => matchIds.has(m.id));
      }
      const q = bankSearch.toLowerCase();
      return items.filter((m) => (m.name || '').toLowerCase().includes(q));
    },
    [bankSearch, bankSearchMode, bankSemanticResults],
  );

  // WordTimeline playback state
  const wordTimelineAudioRef = useRef(null);
  const [wtCurrentTime, setWtCurrentTime] = useState(0);
  const [wtIsPlaying, setWtIsPlaying] = useState(false);
  const wtAnimRef = useRef(null);

  // Drafts for this niche
  const nicheDrafts = useMemo(
    () => (createdContent?.videos || []).filter((v) => v.collectionId === niche?.id),
    [createdContent, niche?.id],
  );

  // Per-niche audio: audio items in this niche's mediaIds
  const nicheAudio = useMemo(() => {
    const nicheMediaIds = niche?.mediaIds || [];
    return library.filter((m) => m.type === 'audio' && nicheMediaIds.includes(m.id));
  }, [niche?.mediaIds, library]);

  // Combined audio: niche audio first, then project audio (for import/selection)
  const allAvailableAudio = useMemo(() => {
    const nicheIds = new Set(nicheAudio.map((a) => a.id));
    const otherAudio = projectAudio.filter((a) => !nicheIds.has(a.id));
    return [...nicheAudio, ...otherAudio];
  }, [nicheAudio, projectAudio]);

  // Per-niche audio selection
  const selectedAudio = useMemo(
    () => allAvailableAudio.find((a) => a.id === niche?.audioId) || nicheAudio[0] || null,
    [allAvailableAudio, nicheAudio, niche?.audioId],
  );

  const handleSelectAudio = useCallback(
    (audioId) => {
      if (!niche) return;
      updateNicheAudioId(artistId, niche.id, audioId, db);
    },
    [artistId, niche, db],
  );

  // Text banks (videoTextBank1 / videoTextBank2)
  const textBank1 = niche?.videoTextBank1 || [];
  const textBank2 = niche?.videoTextBank2 || [];

  const handleAddTextBank = useCallback(
    (bankNum, text, setter) => {
      if (!text.trim() || !niche) return;
      addToVideoTextBank(artistId, niche.id, bankNum, text.trim(), db);
      setter('');
    },
    [artistId, niche, db],
  );

  const handleRemoveTextBank = useCallback(
    (bankNum, idx) => {
      if (!niche) return;
      removeFromVideoTextBank(artistId, niche.id, bankNum, idx, db);
    },
    [artistId, niche, db],
  );

  // Post-process Whisper words for singing:
  // 1. Enforce minimum duration (sung words are never < 0.15s)
  // 2. Legato fill — extend each word to the next word's start (fills held-note gaps)
  // 3. Energy-based refinement runs async after initial display
  const postProcessWords = useCallback((words, totalDuration) => {
    if (!words?.length) return words;
    const MIN_DURATION = 0.15;
    const sorted = [...words].sort((a, b) => a.startTime - b.startTime);
    return sorted.map((word, i) => {
      let dur = Math.max(word.duration, MIN_DURATION);
      if (i < sorted.length - 1) {
        const nextStart = sorted[i + 1].startTime;
        const gap = nextStart - (word.startTime + dur);
        if (gap > 0) {
          // Extend to fill gap (singer was holding the note)
          dur = nextStart - word.startTime;
        }
      } else {
        // Last word: extend to end of audio or cap at 4s
        dur = Math.min(totalDuration - word.startTime, Math.max(dur, 4));
      }
      return { ...word, duration: dur };
    });
  }, []);

  // Energy-based word boundary refinement — trims word endings at actual silence
  const refineWordsWithEnergy = useCallback(async (words, audioSrc, totalDuration) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const resp = await fetch(audioSrc, { mode: 'cors' });
      const arrayBuf = await resp.arrayBuffer();
      const buffer = await audioCtx.decodeAudioData(arrayBuf);
      await audioCtx.close();

      const rawData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;

      // Compute RMS energy in small windows (20ms)
      const windowSize = Math.floor(sampleRate * 0.02);
      const getRMS = (startSec, endSec) => {
        const s = Math.floor(startSec * sampleRate);
        const e = Math.min(Math.floor(endSec * sampleRate), rawData.length);
        if (e <= s) return 0;
        let sum = 0;
        for (let i = s; i < e; i++) sum += rawData[i] * rawData[i];
        return Math.sqrt(sum / (e - s));
      };

      // For each word, find where energy drops below threshold after word midpoint
      const sorted = [...words].sort((a, b) => a.startTime - b.startTime);
      const refined = sorted.map((word, i) => {
        const wordEnd = word.startTime + word.duration;
        const nextStart = i < sorted.length - 1 ? sorted[i + 1].startTime : totalDuration;

        // Only refine if word extends past its Whisper end into a gap
        if (wordEnd <= word.startTime + 0.3) return word;

        // Scan backwards from word end to find where energy actually drops
        // Use 10% of peak energy within the word as silence threshold
        const peakRMS = getRMS(word.startTime, Math.min(word.startTime + 0.5, wordEnd));
        const threshold = peakRMS * 0.08;

        // Scan forward from 60% through the word to find silence
        const scanStart = word.startTime + word.duration * 0.6;
        const scanEnd = Math.min(nextStart, word.startTime + word.duration);
        const step = 0.02;

        let silenceStart = scanEnd;
        for (let t = scanStart; t < scanEnd; t += step) {
          const rms = getRMS(t, t + step);
          if (rms < threshold) {
            // Found silence — but require 60ms+ of consecutive silence
            let silenceLen = step;
            let tt = t + step;
            while (tt < scanEnd && getRMS(tt, tt + step) < threshold) {
              silenceLen += step;
              tt += step;
            }
            if (silenceLen >= 0.06) {
              silenceStart = t + 0.02; // Small buffer past silence start
              break;
            }
          }
        }

        const newDuration = Math.max(0.15, silenceStart - word.startTime);
        return { ...word, duration: newDuration };
      });

      return refined;
    } catch (e) {
      // Energy analysis failed — return words as-is (legato-processed)
      return words;
    }
  }, []);

  // Auto-transcribe — runs directly, opens WordTimeline with results
  const handleAutoTranscribe = useCallback(async () => {
    if (!selectedAudio) return;
    const audioSrc = selectedAudio.localUrl || selectedAudio.url;
    if (!audioSrc || audioSrc.startsWith('blob:')) {
      toastError('Audio URL not available for transcription');
      return;
    }
    try {
      const result = await analyzeAudio(audioSrc);
      if (!result?.words?.length) {
        toastError('No words transcribed');
        return;
      }
      const dur = result.duration || 30;
      const legatoWords = postProcessWords(result.words, dur);
      setTranscribedWords(legatoWords);
      setTranscribedDuration(dur);
      setWtCurrentTime(0);
      setWtIsPlaying(false);
      // Set audio source for WordTimeline playback
      if (wordTimelineAudioRef.current) {
        wordTimelineAudioRef.current.src = audioSrc;
        wordTimelineAudioRef.current.currentTime = 0;
      }
      setShowWordTimeline(true);
      toastSuccess(
        `Transcribed ${result.words.length} word${result.words.length !== 1 ? 's' : ''}`,
      );
      // Async energy-based refinement — updates WordTimeline in place
      refineWordsWithEnergy(legatoWords, audioSrc, dur).then((refined) => {
        setTranscribedWords(refined);
      });
    } catch (err) {
      if (err.message === 'API_KEY_REQUIRED') {
        toastError('OpenAI API key required — set it in Settings');
      } else {
        toastError(`Transcription failed: ${err.message}`);
      }
    }
  }, [selectedAudio, analyzeAudio, toastSuccess, toastError]);

  // Per-track transcribe — select audio then transcribe via WordTimeline
  const handleTranscribeTrack = useCallback(
    async (audio) => {
      if (niche) updateNicheAudioId(artistId, niche.id, audio.id, db);
      const validUrl = (u) => u && !u.startsWith('blob:');
      const src = validUrl(audio.url)
        ? audio.url
        : validUrl(audio.localUrl)
          ? audio.localUrl
          : null;
      if (!src) {
        toastError('Audio URL not available for transcription');
        return;
      }
      try {
        const result = await analyzeAudio(src);
        if (!result?.words?.length) {
          toastError('No words transcribed');
          return;
        }
        const dur = result.duration || audio.duration || 30;
        const legatoWords = postProcessWords(result.words, dur);
        setTranscribedWords(legatoWords);
        setTranscribedDuration(dur);
        setWtCurrentTime(0);
        setWtIsPlaying(false);
        if (wordTimelineAudioRef.current) {
          wordTimelineAudioRef.current.src = src;
          wordTimelineAudioRef.current.currentTime = 0;
        }
        setShowWordTimeline(true);
        toastSuccess(
          `Transcribed ${result.words.length} word${result.words.length !== 1 ? 's' : ''}`,
        );
        refineWordsWithEnergy(legatoWords, src, dur).then((refined) => {
          setTranscribedWords(refined);
        });
      } catch (err) {
        if (err.message === 'API_KEY_REQUIRED') {
          toastError('OpenAI API key required — set it in Settings');
        } else {
          toastError(`Transcription failed: ${err.message}`);
        }
      }
    },
    [
      artistId,
      niche,
      db,
      analyzeAudio,
      postProcessWords,
      refineWordsWithEnergy,
      toastSuccess,
      toastError,
    ],
  );

  // Pick audio then auto-transcribe for "Add Lyrics"
  const handlePickAudioAndTranscribe = useCallback(
    async (audio) => {
      setShowAudioPicker(false);
      if (!audio) return;
      const validUrl = (u) => u && !u.startsWith('blob:');
      const src = validUrl(audio.url)
        ? audio.url
        : validUrl(audio.localUrl)
          ? audio.localUrl
          : null;
      if (!src) {
        toastError('Audio has no valid URL — please re-upload');
        return;
      }
      // Select this audio as the niche audio
      if (niche) updateNicheAudioId(artistId, niche.id, audio.id, db);
      try {
        const result = await analyzeAudio(src);
        if (result?.words?.length > 0) {
          const dur = result.duration || audio.duration || audio.endTime || 60;
          const legatoWords = postProcessWords(result.words, dur);
          setTranscribedWords(legatoWords);
          setTranscribedDuration(dur);
          setWtCurrentTime(0);
          setWtIsPlaying(false);
          if (wordTimelineAudioRef.current) {
            wordTimelineAudioRef.current.src = src;
            wordTimelineAudioRef.current.currentTime = 0;
          }
          setShowWordTimeline(true);
          toastSuccess(
            `Transcribed ${result.words.length} word${result.words.length !== 1 ? 's' : ''}`,
          );
          refineWordsWithEnergy(legatoWords, src, dur).then((refined) => {
            setTranscribedWords(refined);
          });
        } else {
          toastError('No words transcribed');
        }
      } catch (err) {
        if (err.message === 'API_KEY_REQUIRED') {
          toastError('OpenAI API key required — set it in Settings');
        } else {
          toastError(`Transcription failed: ${err.message}`);
        }
      }
    },
    [
      artistId,
      niche,
      db,
      analyzeAudio,
      postProcessWords,
      refineWordsWithEnergy,
      toastSuccess,
      toastError,
    ],
  );

  // WordTimeline playback controls
  const handleWtPlayPause = useCallback(() => {
    const audio = wordTimelineAudioRef.current;
    if (!audio) return;
    if (wtIsPlaying) {
      audio.pause();
      cancelAnimationFrame(wtAnimRef.current);
      setWtIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      const tick = () => {
        setWtCurrentTime(audio.currentTime);
        wtAnimRef.current = requestAnimationFrame(tick);
      };
      wtAnimRef.current = requestAnimationFrame(tick);
      setWtIsPlaying(true);
    }
  }, [wtIsPlaying]);

  const handleWtSeek = useCallback((time) => {
    const audio = wordTimelineAudioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setWtCurrentTime(time);
  }, []);

  // Stop WordTimeline playback on close or audio end
  const handleWtClose = useCallback(() => {
    const audio = wordTimelineAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    cancelAnimationFrame(wtAnimRef.current);
    setWtIsPlaying(false);
    setShowWordTimeline(false);
  }, []);

  // WordTimeline "Add to Bank" — saves transcribed words to Lyric Bank with full timing
  // WordTimeline passes { title, content, words } from its save prompt
  const handleWtAddToBank = useCallback(
    (lyricData) => {
      const words = lyricData?.words || transcribedWords;
      if (!words?.length) return;
      const lyricEntry = {
        id: `lyric_${Date.now()}`,
        title: lyricData?.title || selectedAudio?.name || 'Untitled',
        words,
        content: lyricData?.content || words.map((w) => w.text).join(' '),
        audioName: selectedAudio?.name || 'Unknown',
        createdAt: new Date().toISOString(),
      };
      if (onAddLyrics) {
        onAddLyrics(lyricEntry);
      }
      setLyricsBank((prev) => [...prev, lyricEntry]);
      setShowWordTimeline(false);
      cancelAnimationFrame(wtAnimRef.current);
      setWtIsPlaying(false);
      toastSuccess('Saved to Lyric Bank');
    },
    [transcribedWords, selectedAudio, onAddLyrics, toastSuccess],
  );

  const handleAssignToBank = useCallback(
    (bankNum) => {
      if (!pendingTranscription || !niche) return;
      pendingTranscription.forEach((text) =>
        addToVideoTextBank(artistId, niche.id, bankNum, text, db),
      );
      setPendingTranscription(null);
      setShowBankPicker(false);
    },
    [pendingTranscription, artistId, niche, db],
  );

  // Migrate niche to mediaBanks format
  const migratedNiche = useMemo(() => (niche ? migrateToMediaBanks(niche) : niche), [niche]);
  const mediaBanks = migratedNiche?.mediaBanks || [];

  // All niche media (images + videos) for the grid
  const nicheMedia = useMemo(() => {
    if (!niche) return [];
    return library.filter(
      (item) => (niche.mediaIds || []).includes(item.id) && item.type !== 'audio',
    );
  }, [niche, library]);

  // Initialize selectedBankIds to all banks when banks change
  useEffect(() => {
    if (mediaBanks.length > 0 && selectedBankIds === null) {
      setSelectedBankIds(new Set(mediaBanks.map((b) => b.id)));
    }
  }, [mediaBanks, selectedBankIds]);

  // Notify parent whenever clip selection changes (so the parent's Create button can use it)
  useEffect(() => {
    if (!onSelectedClipIdsChange) return;
    onSelectedClipIdsChange(bankSelectedIds.size > 0 ? [...bankSelectedIds] : null);
  }, [bankSelectedIds, onSelectedClipIdsChange]);

  // Multi-select callbacks (must be after mediaBanks is defined)
  const handleBankItemClick = useCallback(
    (itemId, bankId, e) => {
      if (selectionBankId !== bankId) {
        setSelectionBankId(bankId);
        setBankSelectedIds(new Set([itemId]));
        return;
      }
      setBankSelectedIds((prev) => {
        const next = new Set(prev);
        if (e?.shiftKey && prev.size > 0) {
          const bankObj = mediaBanks.find((b) => b.id === bankId);
          const ids = (bankObj?.mediaIds || []).filter((id) =>
            library.some((l) => l.id === id && l.type !== 'audio'),
          );
          const lastSelected = [...prev].pop();
          const startIdx = ids.indexOf(lastSelected);
          const endIdx = ids.indexOf(itemId);
          if (startIdx >= 0 && endIdx >= 0) {
            const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            for (let i = lo; i <= hi; i++) next.add(ids[i]);
          }
        } else if (e?.metaKey || e?.ctrlKey) {
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
        } else {
          if (next.size === 1 && next.has(itemId)) return new Set();
          return new Set([itemId]);
        }
        return next;
      });
    },
    [selectionBankId, mediaBanks, library],
  );

  const clearBankSelection = useCallback(() => {
    setBankSelectedIds(new Set());
    setSelectionBankId(null);
  }, []);

  const handleBankGridMouseDown = useCallback(
    (e, bankId) => {
      if (e.button !== 0) return;
      const gridEl = bankGridRefs.current[bankId];
      if (!gridEl) return;
      if (e.target.closest('button')) return;
      const mediaEl = e.target.closest('[data-media-id]');
      // If clicking a media item with Cmd/Ctrl/Shift, let onClick handle it (don't start rubber-band)
      if (mediaEl && (e.metaKey || e.ctrlKey || e.shiftKey)) return;
      // If clicking an already-selected item, don't start rubber-band (allow drag)
      if (
        mediaEl &&
        bankSelectedIds.has(mediaEl.getAttribute('data-media-id')) &&
        selectionBankId === bankId
      )
        return;
      // If clicking on a media item without modifier, let onClick handle selection (but still prep rubber-band)
      if (mediaEl) return;
      e.preventDefault();
      const rect = gridEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top + gridEl.scrollTop;
      bankDragStartRef.current = { x, y, bankId };
      bankDragPriorRef.current =
        e.shiftKey && selectionBankId === bankId ? new Set(bankSelectedIds) : new Set();
      setSelectionBankId(bankId);
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) setBankSelectedIds(new Set());
    },
    [bankSelectedIds, selectionBankId],
  );

  const handleBankGridMouseMove = useCallback((e) => {
    if (!bankDragStartRef.current) return;
    const { bankId } = bankDragStartRef.current;
    const gridEl = bankGridRefs.current[bankId];
    if (!gridEl) return;
    const rect = gridEl.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top + gridEl.scrollTop;
    const startX = bankDragStartRef.current.x;
    const startY = bankDragStartRef.current.y;
    if (Math.abs(curX - startX) < 4 && Math.abs(curY - startY) < 4) return;
    const scrollTop = gridEl.scrollTop;
    setBankRubberBand({
      bankId,
      left: Math.min(startX, curX),
      top: Math.min(startY, curY) - scrollTop,
      width: Math.abs(curX - startX),
      height: Math.abs(curY - startY),
    });
    const minX = Math.min(startX, curX);
    const maxX = Math.max(startX, curX);
    const minY = Math.min(startY, curY);
    const maxY = Math.max(startY, curY);
    const els = gridEl.querySelectorAll('[data-media-id]');
    const next = new Set(bankDragPriorRef.current);
    els.forEach((el) => {
      const elLeft = el.offsetLeft;
      const elTop = el.offsetTop;
      const elRight = elLeft + el.offsetWidth;
      const elBottom = elTop + el.offsetHeight;
      if (elRight >= minX && elLeft <= maxX && elBottom >= minY && elTop <= maxY) {
        next.add(el.getAttribute('data-media-id'));
      }
    });
    setBankSelectedIds(next);
  }, []);

  const handleBankGridMouseUp = useCallback(() => {
    bankDragStartRef.current = null;
    setBankRubberBand(null);
  }, []);

  const handleMoveToBank = useCallback(
    (toBankId) => {
      if (!niche || !selectionBankId || bankSelectedIds.size === 0) return;
      const ids = [...bankSelectedIds];
      // From "__all__" pseudo-bank: just add to dest, don't remove from anywhere
      if (selectionBankId === '__all__') {
        assignToMediaBank(artistId, niche.id, ids, toBankId, db);
      } else {
        moveMediaBetweenBanks(artistId, niche.id, ids, selectionBankId, toBankId, db);
      }
      clearBankSelection();
      onRefreshCollections?.();
    },
    [
      niche,
      artistId,
      selectionBankId,
      bankSelectedIds,
      db,
      clearBankSelection,
      onRefreshCollections,
    ],
  );

  // Per-item upload to cloud
  const handleUploadItemToCloud = useCallback(
    async (item) => {
      if (!item || (item.url && item.syncStatus !== 'local')) return;
      const quotaCtx = { userData: user, userEmail: user?.email };
      const result = await uploadLocalItemToCloud(db, artistId, artistName, item, quotaCtx);
      if (result) {
        toastSuccess(`Uploaded "${item.name}" to cloud`);
        onRefreshCollections?.();
      } else {
        toastError(`Could not upload "${item.name}"`);
      }
    },
    [db, user, artistId, artistName, toastSuccess, toastError, onRefreshCollections],
  );

  // Bulk upload selected to cloud
  const handleBulkUploadToCloud = useCallback(async () => {
    if (!bankSelectedIds || bankSelectedIds.size === 0) return;
    const items = library.filter(
      (m) => bankSelectedIds.has(m.id) && (!m.url || m.syncStatus === 'local'),
    );
    if (items.length === 0) {
      toastSuccess('Selected items are already in the cloud');
      return;
    }
    const quotaCtx = { userData: user, userEmail: user?.email };
    let ok = 0;
    let failed = 0;
    for (const item of items) {
      const r = await uploadLocalItemToCloud(db, artistId, artistName, item, quotaCtx);
      if (r) ok++;
      else failed++;
    }
    if (failed === 0) toastSuccess(`Uploaded ${ok} item${ok !== 1 ? 's' : ''}`);
    else toastError(`Uploaded ${ok}, failed ${failed}`);
    onRefreshCollections?.();
  }, [
    bankSelectedIds,
    library,
    db,
    user,
    artistId,
    artistName,
    toastSuccess,
    toastError,
    onRefreshCollections,
  ]);

  // "Move to New Bank…" — inline input prompt, then create + move in one step
  const [newBankInputOpen, setNewBankInputOpen] = useState(false);
  const [newBankInputValue, setNewBankInputValue] = useState('');
  const handleMoveToNewBank = useCallback(() => {
    if (!niche || !selectionBankId || bankSelectedIds.size === 0) return;
    const name = newBankInputValue.trim();
    if (!name) return;
    const movedIds = [...bankSelectedIds];
    const fromBank = selectionBankId;
    const newBank = addMediaBank(artistId, niche.id, name, db);
    if (!newBank) {
      toastError('Could not create bank (limit reached?)');
      return;
    }
    if (fromBank === '__all__') {
      // Just assign to the new bank without removing from anywhere
      assignToMediaBank(artistId, niche.id, movedIds, newBank.id, db);
    } else {
      moveMediaBetweenBanks(artistId, niche.id, movedIds, fromBank, newBank.id, db);
    }
    setNewBankInputOpen(false);
    setNewBankInputValue('');
    clearBankSelection();
    onRefreshCollections?.();
    toastSuccess(`Moved ${movedIds.length} to "${name}"`);
  }, [
    niche,
    artistId,
    selectionBankId,
    bankSelectedIds,
    newBankInputValue,
    db,
    clearBankSelection,
    onRefreshCollections,
    toastError,
    toastSuccess,
  ]);

  const handleDeleteSelected = useCallback(() => {
    if (!niche || !selectionBankId || bankSelectedIds.size === 0) return;
    setConfirmDialog({
      isOpen: true,
      title: 'Remove from Bank',
      message: `Remove ${bankSelectedIds.size} item${bankSelectedIds.size !== 1 ? 's' : ''} from this bank?`,
      confirmLabel: 'Remove',
      onConfirm: () => {
        removeFromMediaBank(artistId, niche.id, [...bankSelectedIds], selectionBankId, db, true);
        clearBankSelection();
        onRefreshCollections?.();
        setConfirmDialog({ isOpen: false });
      },
    });
  }, [
    niche,
    artistId,
    selectionBankId,
    bankSelectedIds,
    db,
    clearBankSelection,
    onRefreshCollections,
  ]);

  // Bank selection toggle
  const toggleBankSelection = useCallback(
    (bankId) => {
      setSelectedBankIds((prev) => {
        const next = new Set(prev || mediaBanks.map((b) => b.id));
        if (next.has(bankId)) next.delete(bankId);
        else next.add(bankId);
        return next;
      });
    },
    [mediaBanks],
  );

  // Add new media bank handler
  const [bankNameError, setBankNameError] = useState('');
  const handleAddMediaBank = useCallback(() => {
    if (!newBankName.trim()) {
      setBankNameError('Bank name is required');
      return;
    }
    if (!niche) return;
    setBankNameError('');
    addMediaBank(artistId, niche.id, newBankName.trim(), db);
    setNewBankName('');
    setShowNewBankInput(false);
    onRefreshCollections?.();
  }, [newBankName, artistId, niche, db, onRefreshCollections]);

  // Rename media bank handler
  const handleRenameMediaBank = useCallback(() => {
    if (!renameValue.trim() || !niche || !renamingBankId) return;
    renameMediaBank(artistId, niche.id, renamingBankId, renameValue.trim(), db);
    setRenamingBankId(null);
    setRenameValue('');
    onRefreshCollections?.();
  }, [renameValue, artistId, niche, renamingBankId, db, onRefreshCollections]);

  // Delete media bank handler
  const handleDeleteMediaBank = useCallback(
    (bankId, bankName) => {
      if (!niche) return;
      setConfirmDialog({
        isOpen: true,
        title: 'Delete Bank',
        message: `Delete bank "${bankName || 'Untitled'}"? Media will be unlinked from this bank.`,
        confirmLabel: 'Delete',
        onConfirm: () => {
          removeMediaBank(artistId, niche.id, bankId, db);
          setSelectedBankIds((prev) => {
            if (!prev) return prev;
            const next = new Set(prev);
            next.delete(bankId);
            return next;
          });
          onRefreshCollections?.();
          setConfirmDialog({ isOpen: false });
        },
      });
    },
    [artistId, niche, db, onRefreshCollections],
  );

  // Remove item from bank + niche entirely in one atomic write
  const handleRemoveFromBank = useCallback(
    (mediaId, bankId) => {
      if (!niche) return;
      removeFromMediaBank(artistId, niche.id, [mediaId], bankId, db, true);
      onRefreshCollections?.();
    },
    [artistId, niche, db, onRefreshCollections],
  );

  // Filtered onMakeVideo — passes selected bank IDs + selected clip IDs
  const handleMakeVideoFiltered = useCallback(
    (format, nicheId, existingDraft) => {
      if (!onMakeVideo) return;
      const bankIds = selectedBankIds && selectedBankIds.size > 0 ? [...selectedBankIds] : null;
      const clipIds = bankSelectedIds && bankSelectedIds.size > 0 ? [...bankSelectedIds] : null;
      onMakeVideo(format, nicheId, existingDraft, bankIds, clipIds);
    },
    [onMakeVideo, selectedBankIds, bankSelectedIds],
  );

  // Drag-to-reorder media
  const handleMediaReorder = useCallback(
    (reordered) => {
      if (!niche) return;
      const orderedIds = reordered.map((m) => m.id);
      updateNicheMediaOrder(artistId, niche.id, orderedIds, db);
    },
    [artistId, niche, db],
  );
  const { makeDragProps, dragOverIndex, isDragging } = useDragReorder(
    nicheMedia,
    handleMediaReorder,
  );

  // Quick trim handlers — destructive trim if local file exists
  const handleTrimSave = useCallback(
    async (trimStart, trimEnd) => {
      if (!niche || !trimItemId) return;
      const item = nicheMedia.find((m) => m.id === trimItemId);
      const localPath = item?.localPath || item?.metadata?.localPath;

      // Destructive trim via FFmpeg if Electron + local file
      if (window.electronAPI?.trimVideoDestructive && localPath) {
        try {
          const mediaFolder = await window.electronAPI.getMediaFolder();
          const fullPath = `${mediaFolder}/${localPath}`;
          const exists = await window.electronAPI.checkFileExists(localPath);
          if (exists) {
            const result = await window.electronAPI.trimVideoDestructive(
              fullPath,
              trimStart,
              trimEnd,
            );
            if (result.success) {
              // Update media item duration in library
              const { updateLibraryItemAsync } = await import('../../services/libraryService');
              if (updateLibraryItemAsync) {
                await updateLibraryItemAsync(db, artistId, trimItemId, {
                  duration: result.newDuration,
                  'metadata.trimStart': null,
                  'metadata.trimEnd': null,
                });
              }
              // Regenerate thumbnail
              const thumbPath = fullPath.replace(/\.[^.]+$/, '_thumb.jpg');
              await window.electronAPI.generateLocalThumbnail(fullPath, thumbPath);
              toastSuccess(`Trimmed to ${result.newDuration.toFixed(1)}s`);
            }
          }
        } catch (err) {
          toastError(`Trim failed: ${err.message}`);
        }
      } else {
        // Fallback: save trim metadata only (web or no local file)
        updateMediaTrimPoints(artistId, niche.id, trimItemId, trimStart, trimEnd, db);
      }
      setTrimItemId(null);
    },
    [artistId, niche, trimItemId, nicheMedia, db, toastSuccess, toastError],
  );

  const trimItem = useMemo(
    () => nicheMedia.find((m) => m.id === trimItemId),
    [nicheMedia, trimItemId],
  );
  const trimData = niche?.trimData || {};

  // Handle "Trim & Use" from AudioClipSelector — upload trimmed file, add to library, select as niche audio
  const handleAudioTrimAndUse = useCallback(
    async (trimResult) => {
      setShowAudioTrimmer(false);
      if (!trimResult?.trimmedFile || !niche) return;

      const { trimmedFile, trimmedName, duration: trimDuration } = trimResult;

      try {
        // Create a local blob URL for immediate use
        const localUrl = URL.createObjectURL(trimmedFile);

        // Upload to Firebase Storage
        const { uploadFile } = await import('../../services/firebaseStorage');
        const { url: storageUrl } = await uploadFile(trimmedFile, 'audio');

        // Add to library
        const mediaItem = {
          type: 'audio',
          name: trimmedName || trimmedFile.name,
          url: storageUrl,
          localUrl: storageUrl,
          duration: trimDuration,
          isTrimmed: true,
          originalName: trimAudioTarget?.name || selectedAudio?.name,
          createdAt: new Date().toISOString(),
        };
        const savedItem = await addToLibraryAsync(db, artistId, mediaItem);

        // Add to niche collection + project pool
        await addToCollectionAsync(db, artistId, niche.id, savedItem.id);
        if (niche.projectId) {
          addToProjectPool(artistId, niche.projectId, [savedItem.id], db);
        }

        // Select as niche audio
        updateNicheAudioId(artistId, niche.id, savedItem.id, db);

        URL.revokeObjectURL(localUrl);
        toastSuccess(`Trimmed audio "${trimmedName}" is now active`);
      } catch (err) {
        toastError(`Failed to use trimmed audio: ${err.message}`);
      }
    },
    [niche, artistId, db, selectedAudio, toastSuccess, toastError],
  );

  // Single tile renderer — used by both flat grid and duration-bucketed grid
  const renderBankTile = (item, idx, bank) => {
    const isItemSelected = selectionBankId === bank.id && bankSelectedIds.has(item.id);
    return (
      <div
        key={item.id}
        data-media-id={item.id}
        className="relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group"
        style={isItemSelected ? { outline: '2px solid #60a5fa', outlineOffset: -1 } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          handleBankItemClick(item.id, bank.id, e);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setLightboxItem(item);
        }}
      >
        {item.type === 'video' ? (
          <>
            {item.thumbnailUrl && !brokenThumbs.has(item.id) ? (
              <img
                src={item.thumbnailUrl}
                alt={item.name}
                className="w-full h-full object-cover"
                loading="lazy"
                draggable={false}
                onError={() => markThumbBroken(item.id)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FeatherFilm className="text-neutral-600" style={{ width: 16, height: 16 }} />
              </div>
            )}
            <div className="absolute inset-0 z-[3] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black/70 border border-white/30">
                <FeatherPlay className="text-white" style={{ width: 8, height: 8 }} />
              </div>
            </div>
            <button
              className="absolute bottom-0.5 right-0.5 z-[4] flex h-4 w-4 items-center justify-center rounded bg-black/70 border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                setTrimItemId(item.id);
              }}
              title="Quick trim"
            >
              <FeatherScissors className="text-white" style={{ width: 9, height: 9 }} />
            </button>
            {trimData[item.id] && (
              <div className="absolute bottom-0.5 left-0.5 z-[3] rounded bg-green-500/80 px-0.5 py-px">
                <span className="text-[7px] font-mono text-white">trimmed</span>
              </div>
            )}
            <MediaStatusBadge syncStatus={item.syncStatus} />
          </>
        ) : !brokenThumbs.has(item.id) ? (
          <img
            src={item.thumbnailUrl || item.url}
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable={false}
            onError={() => markThumbBroken(item.id)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FeatherImage className="text-neutral-600" style={{ width: 16, height: 16 }} />
          </div>
        )}
        <div className="absolute top-0.5 left-0.5 z-[3] rounded bg-black/60 px-1 py-px">
          <span className="text-[9px] font-mono text-white/70">{idx + 1}</span>
        </div>
        {isItemSelected && (
          <div className="absolute top-0.5 right-0.5 z-[5] flex h-4 w-4 items-center justify-center rounded-full bg-blue-500">
            <FeatherCheck className="text-white" style={{ width: 9, height: 9 }} />
          </div>
        )}
        {!isItemSelected && (
          <button
            className="absolute top-0.5 right-0.5 z-[4] flex h-4 w-4 items-center justify-center rounded-full bg-black/70 border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/90"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveFromBank(item.id, bank.id);
            }}
            title="Remove from bank"
          >
            <FeatherX className="text-white" style={{ width: 8, height: 8 }} />
          </button>
        )}
        {/* Upload to Cloud — only for local items */}
        {(!item.url || item.syncStatus === 'local') && (
          <button
            className="absolute top-0.5 left-0.5 z-[4] flex h-4 w-4 items-center justify-center rounded-full bg-blue-600/80 border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500"
            style={{ marginLeft: 14 }}
            onClick={(e) => {
              e.stopPropagation();
              handleUploadItemToCloud(item);
            }}
            title="Upload to cloud"
          >
            <FeatherUpload className="text-white" style={{ width: 8, height: 8 }} />
          </button>
        )}
      </div>
    );
  };

  if (!niche || !activeFormat) return null;

  return (
    <div className="flex items-stretch overflow-hidden flex-1 self-stretch">
      {/* Left/center — scrollable content */}
      <div className="flex grow basis-0 min-h-0 flex-col items-center self-stretch overflow-y-auto">
        {/* Media Banks */}
        <div className="flex w-full flex-col gap-3 px-8 py-6">
          {/* Bank search bar */}
          {mediaBanks.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-3 py-1.5">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-neutral-500 flex-none"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="w-full bg-transparent text-body font-body text-white placeholder-neutral-500 outline-none"
                placeholder="Search clips..."
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
              />
              {bankSearch && (
                <button
                  className="text-neutral-500 hover:text-white flex-none bg-transparent border-none cursor-pointer"
                  onClick={() => setBankSearch('')}
                >
                  <FeatherX style={{ width: 14, height: 14 }} />
                </button>
              )}
              {isSearchAvailable() && (
                <ToggleGroup
                  value={bankSearchMode}
                  onValueChange={(v) => v && setBankSearchMode(v)}
                >
                  <ToggleGroup.Item icon={null} value="name">
                    Name
                  </ToggleGroup.Item>
                  <ToggleGroup.Item icon={null} value="visual">
                    Visual
                  </ToggleGroup.Item>
                </ToggleGroup>
              )}
              {isBankSearching && (
                <span className="text-caption font-caption text-neutral-500 flex-none">
                  Searching...
                </span>
              )}
              {bankSearchMode === 'visual' &&
                bankSemanticResults &&
                !isBankSearching &&
                bankSearch.trim() && (
                  <Badge variant="brand">
                    {bankSemanticResults.length} match{bankSemanticResults.length !== 1 ? 'es' : ''}
                  </Badge>
                )}
              <button
                className={`text-caption font-caption rounded px-2 py-0.5 border border-solid cursor-pointer transition-colors flex-none ${
                  showBankDurationBuckets
                    ? 'border-indigo-400 text-indigo-300 bg-indigo-500/10'
                    : 'border-neutral-200 text-neutral-400 bg-transparent hover:text-white'
                }`}
                onClick={() => setShowBankDurationBuckets((v) => !v)}
                title="Group by clip duration"
              >
                By Duration
              </button>
            </div>
          )}
          {mediaBanks.length === 0 ? (
            /* Empty state — no banks yet */
            <div className="flex w-full flex-col items-center gap-5 py-8">
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/30">
                  <IconComponent className="text-indigo-400" style={{ width: 28, height: 28 }} />
                </div>
                <span className="text-heading-2 font-heading-2 text-[#ffffffff]">
                  {activeFormat.name}
                </span>
                <span className="text-body font-body text-neutral-400 text-center max-w-sm">
                  No media banks yet — add one to organize your content
                </span>
              </div>
              <Button
                variant="brand-primary"
                size="large"
                icon={<FeatherPlus />}
                onClick={() => setShowNewBankInput(true)}
              >
                Add Bank
              </Button>
            </div>
          ) : (
            <>
              {(() => {
                // Resolve the active bank context
                const activeBank =
                  activeBankId === 'all'
                    ? null
                    : mediaBanks.find((b) => b.id === activeBankId) || null;
                const activeBankIdx = activeBank
                  ? mediaBanks.findIndex((b) => b.id === activeBank.id)
                  : -1;
                const activeColor = activeBank
                  ? getBankColor(activeBankIdx)
                  : { primary: '#6366f1', light: '#a5b4fc', border: '#6366f180', bg: '#6366f110' };

                // Compute media for the active scope
                const allBankMediaIds = new Set();
                mediaBanks.forEach((b) =>
                  (b.mediaIds || []).forEach((id) => allBankMediaIds.add(id)),
                );
                const scopedMediaIds =
                  activeBankId === 'all' ? allBankMediaIds : new Set(activeBank?.mediaIds || []);
                const activeBankMediaAll = library.filter(
                  (item) => scopedMediaIds.has(item.id) && item.type !== 'audio',
                );
                const activeBankMedia = filterBankMedia(activeBankMediaAll);
                const activeBankIsRenaming = activeBank && renamingBankId === activeBank.id;
                // Pseudo-bank object for renderBankTile when in 'all' mode
                const tileBank = activeBank || { id: '__all__' };

                return (
                  <>
                    {/* === Tab pill bar === */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* All Media pill */}
                      <button
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-caption-bold font-caption-bold border border-solid cursor-pointer transition-colors ${
                          activeBankId === 'all'
                            ? 'bg-indigo-500/15 border-indigo-400 text-indigo-200'
                            : 'bg-transparent border-neutral-200 text-neutral-400 hover:text-white'
                        }`}
                        onClick={() => setActiveBankId('all')}
                      >
                        All Media
                        <Badge variant="neutral">{allBankMediaIds.size}</Badge>
                      </button>
                      {mediaBanks.map((bank, bankIdx) => {
                        const color = getBankColor(bankIdx);
                        const isActive = activeBankId === bank.id;
                        const isIncluded = selectedBankIds === null || selectedBankIds.has(bank.id);
                        const count = (bank.mediaIds || []).length;
                        return (
                          <div
                            key={bank.id}
                            className="flex items-center rounded-full border border-solid"
                            style={{
                              borderColor: isActive ? color.primary : color.border,
                              backgroundColor: isActive ? color.bg : 'transparent',
                            }}
                          >
                            {/* Inclusion checkbox */}
                            <button
                              className="flex items-center justify-center w-5 h-5 ml-1 rounded-full cursor-pointer transition-colors border-none bg-transparent"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleBankSelection(bank.id);
                              }}
                              title={isIncluded ? 'Exclude from editor' : 'Include in editor'}
                            >
                              <div
                                className="h-2.5 w-2.5 rounded-full"
                                style={{
                                  backgroundColor: isIncluded ? color.primary : 'transparent',
                                  border: `1.5px solid ${color.primary}`,
                                }}
                              />
                            </button>
                            <button
                              className="flex items-center gap-1.5 px-2 py-1 text-caption-bold font-caption-bold bg-transparent border-none cursor-pointer"
                              style={{ color: isActive ? color.light : color.light + 'cc' }}
                              onClick={() => setActiveBankId(bank.id)}
                            >
                              {bank.name}
                              <Badge variant="neutral">{count}</Badge>
                            </button>
                          </div>
                        );
                      })}
                      {/* Add Bank pill */}
                      {mediaBanks.length < MAX_MEDIA_BANKS &&
                        (showNewBankInput ? (
                          <div className="flex items-center gap-1">
                            <input
                              className={`rounded-full border border-solid ${bankNameError ? 'border-red-500' : 'border-neutral-200'} bg-black px-3 py-1 text-caption font-caption text-white outline-none placeholder-neutral-500 w-32`}
                              placeholder="Bank name..."
                              value={newBankName}
                              onChange={(e) => {
                                setNewBankName(e.target.value);
                                if (bankNameError) setBankNameError('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddMediaBank();
                                if (e.key === 'Escape') {
                                  setShowNewBankInput(false);
                                  setNewBankName('');
                                  setBankNameError('');
                                }
                              }}
                              autoFocus
                            />
                            <Button
                              variant="brand-primary"
                              size="small"
                              onClick={handleAddMediaBank}
                              disabled={!newBankName.trim()}
                            >
                              Add
                            </Button>
                            <Button
                              variant="neutral-tertiary"
                              size="small"
                              onClick={() => {
                                setShowNewBankInput(false);
                                setNewBankName('');
                                setBankNameError('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <button
                            className="flex items-center gap-1 rounded-full px-3 py-1 text-caption-bold font-caption-bold border border-dashed border-neutral-200 text-neutral-400 hover:text-white hover:border-white cursor-pointer transition-colors bg-transparent"
                            onClick={() => setShowNewBankInput(true)}
                            title="Create a new bank"
                          >
                            <FeatherPlus style={{ width: 12, height: 12 }} /> Add Bank
                          </button>
                        ))}
                    </div>

                    {/* === Active bank actions row === */}
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      {activeBank ? (
                        <>
                          {activeBankIsRenaming ? (
                            <input
                              className="rounded-md border border-solid border-neutral-200 bg-black px-2 py-0.5 text-caption-bold font-caption-bold text-white outline-none"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameMediaBank();
                                if (e.key === 'Escape') setRenamingBankId(null);
                              }}
                              onBlur={handleRenameMediaBank}
                              autoFocus
                            />
                          ) : (
                            <span
                              className="text-caption-bold font-caption-bold"
                              style={{ color: activeColor.light }}
                            >
                              {activeBank.name}
                            </span>
                          )}
                          <Badge variant="neutral">
                            {bankSearch.trim() &&
                            activeBankMedia.length !== activeBankMediaAll.length
                              ? `${activeBankMedia.length}/${activeBankMediaAll.length}`
                              : activeBankMedia.length}
                          </Badge>
                          <div className="flex-1" />
                          <button
                            className="text-caption font-caption hover:text-white bg-transparent border-none cursor-pointer px-2 py-0.5 rounded transition-colors"
                            style={{ color: activeColor.light }}
                            onClick={() => onUploadToMediaBank?.(activeBank.id)}
                          >
                            Upload
                          </button>
                          <button
                            className="text-caption font-caption hover:text-white bg-transparent border-none cursor-pointer px-2 py-0.5 rounded transition-colors"
                            style={{ color: activeColor.light }}
                            onClick={() => onImportToMediaBank?.(activeBank.id)}
                          >
                            Import
                          </button>
                          <button
                            className="text-caption font-caption hover:text-indigo-400 bg-transparent border-none cursor-pointer px-2 py-0.5 rounded transition-colors text-indigo-300"
                            onClick={() => setShowImportModal(true)}
                          >
                            Library
                          </button>
                          <button
                            className="text-caption font-caption hover:text-white bg-transparent border-none cursor-pointer px-2 py-0.5 rounded transition-colors"
                            style={{ color: activeColor.light }}
                            onClick={() => onWebImportToMediaBank?.(activeBank.id)}
                          >
                            Web
                          </button>
                          {!activeBankIsRenaming && (
                            <IconButton
                              variant="neutral-tertiary"
                              size="small"
                              icon={<FeatherEdit2 />}
                              aria-label="Rename bank"
                              onClick={() => {
                                setRenamingBankId(activeBank.id);
                                setRenameValue(activeBank.name);
                              }}
                            />
                          )}
                          {mediaBanks.length > 1 && (
                            <IconButton
                              variant="neutral-tertiary"
                              size="small"
                              icon={<FeatherX />}
                              aria-label="Delete bank"
                              onClick={() => {
                                handleDeleteMediaBank(activeBank.id, activeBank.name);
                                setActiveBankId('all');
                              }}
                            />
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-caption-bold font-caption-bold text-indigo-200">
                            All Media
                          </span>
                          <Badge variant="neutral">
                            {bankSearch.trim() &&
                            activeBankMedia.length !== activeBankMediaAll.length
                              ? `${activeBankMedia.length}/${activeBankMediaAll.length}`
                              : activeBankMedia.length}
                          </Badge>
                          <span className="text-caption font-caption text-neutral-500">
                            Union of all banks · double-click to preview · click to select
                          </span>
                        </>
                      )}
                    </div>

                    {/* Selection action bar — shown when items are selected */}
                    {bankSelectedIds.size > 0 && (
                      <div className="flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-1.5 flex-wrap">
                        <span className="text-caption-bold font-caption-bold text-white">
                          {bankSelectedIds.size} selected
                        </span>
                        <div className="flex-1" />
                        {mediaBanks.length > 1 &&
                          mediaBanks
                            .filter((b) => b.id !== selectionBankId)
                            .map((targetBank) => {
                              const tColor = getBankColor(mediaBanks.indexOf(targetBank));
                              return (
                                <button
                                  key={targetBank.id}
                                  className="flex items-center gap-1 rounded px-2 py-0.5 text-caption font-caption bg-transparent border border-solid cursor-pointer hover:brightness-125 transition-colors"
                                  style={{ borderColor: tColor.primary, color: tColor.light }}
                                  onClick={() => handleMoveToBank(targetBank.id)}
                                >
                                  <div
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: tColor.primary }}
                                  />
                                  Move to {targetBank.name}
                                </button>
                              );
                            })}
                        {/* Move to New Bank — inline input */}
                        {mediaBanks.length < MAX_MEDIA_BANKS &&
                          (newBankInputOpen ? (
                            <div className="flex items-center gap-1">
                              <input
                                className="rounded border border-solid border-neutral-200 bg-black px-2 py-0.5 text-caption font-caption text-white outline-none w-28"
                                placeholder="New bank name…"
                                value={newBankInputValue}
                                onChange={(e) => setNewBankInputValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleMoveToNewBank();
                                  if (e.key === 'Escape') {
                                    setNewBankInputOpen(false);
                                    setNewBankInputValue('');
                                  }
                                }}
                                autoFocus
                              />
                              <button
                                className="text-caption font-caption text-emerald-400 bg-transparent border border-solid border-emerald-500/50 cursor-pointer rounded px-2 py-0.5 hover:bg-emerald-500/10"
                                onClick={handleMoveToNewBank}
                                disabled={!newBankInputValue.trim()}
                              >
                                Create & Move
                              </button>
                              <button
                                className="text-caption font-caption text-neutral-400 bg-transparent border-none cursor-pointer"
                                onClick={() => {
                                  setNewBankInputOpen(false);
                                  setNewBankInputValue('');
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              className="flex items-center gap-1 rounded px-2 py-0.5 text-caption font-caption bg-transparent border border-dashed border-emerald-500/50 text-emerald-400 cursor-pointer hover:bg-emerald-500/10 transition-colors"
                              onClick={() => setNewBankInputOpen(true)}
                              title="Create a new bank and move selected clips into it"
                            >
                              <FeatherPlus style={{ width: 10, height: 10 }} /> New Bank
                            </button>
                          ))}
                        <button
                          className="flex items-center gap-1 rounded px-2 py-0.5 text-caption font-caption bg-transparent border border-solid border-blue-500/50 text-blue-300 cursor-pointer hover:bg-blue-500/10 transition-colors"
                          onClick={handleBulkUploadToCloud}
                          title="Upload selected local clips to the cloud"
                        >
                          <FeatherUpload style={{ width: 10, height: 10 }} /> Upload to Cloud
                        </button>
                        <button
                          className="flex items-center gap-1 rounded px-2 py-0.5 text-caption font-caption bg-transparent border border-solid border-red-500/50 text-red-400 cursor-pointer hover:bg-red-500/10 transition-colors"
                          onClick={handleDeleteSelected}
                        >
                          <FeatherX style={{ width: 10, height: 10 }} /> Remove
                        </button>
                        <button
                          className="text-caption font-caption text-neutral-400 bg-transparent border-none cursor-pointer hover:text-white"
                          onClick={clearBankSelection}
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    {/* Active grid — drives off activeBankId */}
                    {activeBankMedia.length > 0 ? (
                      <div
                        className="relative w-full overflow-y-auto rounded-lg border border-solid p-3 select-none"
                        style={{
                          maxHeight: 480,
                          borderColor: activeColor.border,
                          backgroundColor: activeColor.bg,
                        }}
                        ref={(el) => {
                          bankGridRefs.current[tileBank.id] = el;
                        }}
                        onMouseDown={(e) => handleBankGridMouseDown(e, tileBank.id)}
                        onMouseMove={handleBankGridMouseMove}
                        onMouseUp={handleBankGridMouseUp}
                        onMouseLeave={handleBankGridMouseUp}
                      >
                        {/* Rubber-band overlay */}
                        {bankRubberBand && bankRubberBand.bankId === tileBank.id && (
                          <div
                            className="absolute z-10 rounded border border-solid border-blue-400/60 bg-blue-400/15 pointer-events-none"
                            style={{
                              left: bankRubberBand.left,
                              top: bankRubberBand.top,
                              width: bankRubberBand.width,
                              height: bankRubberBand.height,
                            }}
                          />
                        )}
                        {showBankDurationBuckets ? (
                          (() => {
                            const { buckets, unknown } = bucketByDuration(activeBankMedia);
                            return (
                              <div className="flex w-full flex-col gap-3">
                                {buckets.map(
                                  (b) =>
                                    b.items.length > 0 && (
                                      <div key={b.key} className="flex w-full flex-col gap-1">
                                        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                                          {b.label} · {b.items.length}
                                        </span>
                                        <div className="grid w-full grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
                                          {b.items.map((item, idx) =>
                                            renderBankTile(item, idx, tileBank),
                                          )}
                                        </div>
                                      </div>
                                    ),
                                )}
                                {unknown.length > 0 && (
                                  <div className="flex w-full flex-col gap-1">
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                                      Unknown · {unknown.length}
                                    </span>
                                    <div className="grid w-full grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
                                      {unknown.map((item, idx) =>
                                        renderBankTile(item, idx, tileBank),
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <div className="grid w-full grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
                            {activeBankMedia.map((item, idx) =>
                              renderBankTile(item, idx, tileBank),
                            )}
                            {activeBank && (
                              <div
                                className="flex flex-col items-center justify-center aspect-square rounded border border-dashed cursor-pointer hover:bg-opacity-10 transition-colors"
                                style={{ borderColor: activeColor.border }}
                                onClick={() => onUploadToMediaBank?.(activeBank.id)}
                                title="Upload to this bank"
                              >
                                <FeatherPlus
                                  style={{ width: 12, height: 12, color: activeColor.primary }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : bankSearch.trim() && activeBankMediaAll.length > 0 ? (
                      <div
                        className="flex items-center justify-center rounded-lg border border-dashed py-4"
                        style={{ borderColor: activeColor.border }}
                      >
                        <span className="text-caption font-caption text-neutral-500">
                          No matches for &ldquo;{bankSearch}&rdquo;
                        </span>
                      </div>
                    ) : (
                      <div
                        className="flex items-center justify-center rounded-lg border-2 border-dashed py-6 cursor-pointer transition-colors"
                        style={{ borderColor: activeColor.border }}
                        onClick={() => activeBank && onUploadToMediaBank?.(activeBank.id)}
                      >
                        <span className="text-caption font-caption text-neutral-500">
                          {activeBank
                            ? 'Drop media here or click to upload'
                            : 'No media yet — switch to a bank to add some'}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>

        {/* Text Banks */}
        <div className="flex w-full gap-4 px-8 pb-4">
          {/* Bank A — Indigo */}
          <div className="flex flex-1 min-w-0 flex-col gap-2 rounded-lg border border-solid border-indigo-500/30 bg-indigo-500/5 p-3 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-indigo-500 flex-none" />
              <span className="text-caption-bold font-caption-bold text-indigo-300">
                Text Bank A
              </span>
              <Badge variant="brand">{textBank1.length}</Badge>
            </div>
            {textBank1.length > 0 && (
              <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
                {textBank1.map((text, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-md px-2 py-1 min-w-0 group bg-black/40 hover:bg-black/60 transition-colors"
                  >
                    <FeatherType
                      className="text-indigo-400 flex-none"
                      style={{ width: 10, height: 10 }}
                    />
                    <span className="grow text-caption font-caption text-neutral-300 truncate">
                      {text}
                    </span>
                    <button
                      className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleRemoveTextBank(1, idx)}
                    >
                      <FeatherX style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded-md border border-solid border-neutral-200 bg-neutral-0 px-2 py-1 text-caption font-caption text-white outline-none placeholder-neutral-500"
                placeholder="Add text..."
                value={textBankInput1}
                onChange={(e) => setTextBankInput1(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTextBank(1, textBankInput1, setTextBankInput1);
                }}
              />
              <IconButton
                variant="brand-tertiary"
                size="small"
                icon={<FeatherPlus />}
                aria-label="Add"
                onClick={() => handleAddTextBank(1, textBankInput1, setTextBankInput1)}
              />
            </div>
          </div>

          {/* Bank B — Amber */}
          <div className="flex flex-1 min-w-0 flex-col gap-2 rounded-lg border border-solid border-amber-500/30 bg-amber-500/5 p-3 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500 flex-none" />
              <span className="text-caption-bold font-caption-bold text-amber-300">
                Text Bank B
              </span>
              <Badge variant="warning">{textBank2.length}</Badge>
            </div>
            {textBank2.length > 0 && (
              <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
                {textBank2.map((text, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-md px-2 py-1 min-w-0 group bg-black/40 hover:bg-black/60 transition-colors"
                  >
                    <FeatherType
                      className="text-amber-400 flex-none"
                      style={{ width: 10, height: 10 }}
                    />
                    <span className="grow text-caption font-caption text-neutral-300 truncate">
                      {text}
                    </span>
                    <button
                      className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleRemoveTextBank(2, idx)}
                    >
                      <FeatherX style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded-md border border-solid border-neutral-200 bg-neutral-0 px-2 py-1 text-caption font-caption text-white outline-none placeholder-neutral-500"
                placeholder="Add text..."
                value={textBankInput2}
                onChange={(e) => setTextBankInput2(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTextBank(2, textBankInput2, setTextBankInput2);
                }}
              />
              <IconButton
                variant="brand-tertiary"
                size="small"
                icon={<FeatherPlus />}
                aria-label="Add"
                onClick={() => handleAddTextBank(2, textBankInput2, setTextBankInput2)}
              />
            </div>
          </div>
        </div>

        {/* Lyric Bank */}
        <div
          className="flex w-full flex-col gap-2 rounded-lg border border-solid border-green-500/30 bg-green-500/5 p-3 mx-8 mb-4"
          style={{ maxWidth: 'calc(100% - 64px)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <FeatherMusic className="text-green-400 flex-none" style={{ width: 14, height: 14 }} />
            <span className="text-caption-bold font-caption-bold text-green-300">Lyric Bank</span>
            <Badge variant="success">{lyricsBank.length}</Badge>
          </div>
          <LyricBankSection
            lyrics={lyricsBank}
            hasAudio={allAvailableAudio.length > 0}
            isTranscribing={isAnalyzing}
            onAddNew={() => {
              if (allAvailableAudio.length === 0) {
                toastError('Upload audio first');
                return;
              }
              if (allAvailableAudio.length === 1) {
                // Only one audio — pick it automatically
                handlePickAudioAndTranscribe(allAvailableAudio[0]);
              } else {
                // Multiple audio — show picker
                setShowAudioPicker(true);
              }
            }}
            onApplyLyric={(lyric) => {
              if (lyric.words?.length > 0) {
                setTranscribedWords(lyric.words);
                setTranscribedDuration(lyric.words[lyric.words.length - 1]?.end || 30);
                setShowWordTimeline(true);
              } else if (lyric.content) {
                const plainWords = lyric.content
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((text, i) => ({
                    text,
                    start: i * 0.5,
                    end: (i + 1) * 0.5,
                  }));
                setTranscribedWords(plainWords);
                setTranscribedDuration(plainWords.length * 0.5);
                setShowWordTimeline(true);
              } else {
                toastError('This lyric has no content to edit');
              }
            }}
            onDeleteLyric={(lyricId) => {
              if (onDeleteLyrics) onDeleteLyrics(lyricId);
              setLyricsBank((prev) => prev.filter((l) => l.id !== lyricId));
            }}
          />
        </div>

        {/* Audio Bank — per-niche audio with import from other niches */}
        <div
          className="flex w-full flex-col gap-2 rounded-lg border border-solid border-neutral-200 bg-[#1a1a1aff] px-4 py-3 mx-8 mb-4"
          style={{ maxWidth: 'calc(100% - 64px)', maxHeight: 260 }}
        >
          <div className="flex w-full flex-none items-center justify-between">
            <div className="flex items-center gap-2">
              <FeatherMusic className="text-neutral-400" style={{ width: 14, height: 14 }} />
              <span className="text-caption-bold font-caption-bold text-[#ffffffff]">Audio</span>
              <Badge variant="neutral">{nicheAudio.length}</Badge>
              {projectAudio.length > nicheAudio.length && (
                <span className="text-[10px] text-neutral-500">
                  {projectAudio.length - nicheAudio.length} in project
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                onClick={() => onImportAudio?.()}
              >
                Import
              </button>
              <button
                className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                onClick={() => onUploadAudio?.()}
              >
                Upload
              </button>
              <button
                className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                onClick={() => onWebImportAudio?.()}
              >
                Web
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              {nicheAudio.length === 0 && projectAudio.length === 0 ? (
                <div className="flex items-center justify-center rounded-md border-2 border-dashed border-neutral-200 py-3">
                  <span className="text-caption font-caption text-neutral-500">
                    No audio uploaded
                  </span>
                </div>
              ) : (
                <>
                  {/* Niche audio (primary) */}
                  {nicheAudio.map((audio) => {
                    const isActive = niche?.audioId === audio.id;
                    const isPlaying = playingAudioId === audio.id;
                    const isRenaming = renamingAudioId === audio.id;
                    const dur = audio.duration
                      ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}`
                      : '';
                    return (
                      <div
                        key={audio.id}
                        className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors flex-none ${
                          isActive
                            ? 'bg-indigo-500/15 border border-indigo-500 ring-1 ring-indigo-500'
                            : 'bg-black border border-transparent hover:border-neutral-200'
                        }`}
                        onClick={() => handleSelectAudio(audio.id)}
                      >
                        <button
                          className="flex-none flex items-center justify-center w-5 h-5 rounded-full bg-neutral-100 hover:bg-neutral-200 border-none cursor-pointer transition-colors"
                          onClick={(e) => handlePlayAudio(e, audio)}
                          title={isPlaying ? 'Stop' : 'Preview'}
                        >
                          {isPlaying ? (
                            <FeatherSquare
                              className="text-indigo-400"
                              style={{ width: 8, height: 8 }}
                            />
                          ) : (
                            <FeatherPlay
                              className={isActive ? 'text-indigo-400' : 'text-neutral-400'}
                              style={{ width: 8, height: 8 }}
                            />
                          )}
                        </button>
                        {isRenaming ? (
                          <input
                            autoFocus
                            className="text-caption font-caption text-white truncate flex-1 bg-neutral-100 rounded px-1 py-0.5 outline-none border border-indigo-500"
                            value={renameAudioValue}
                            onChange={(e) => setRenameAudioValue(e.target.value)}
                            onBlur={handleSaveRenameAudio}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRenameAudio();
                              if (e.key === 'Escape') setRenamingAudioId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="text-caption font-caption text-white truncate flex-1">
                            {audio.name}
                          </span>
                        )}
                        <span className="text-[10px] text-neutral-400 flex-none">{dur}</span>
                        {!isRenaming && (
                          <div className="flex-none flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              className="flex items-center justify-center w-5 h-5 bg-transparent border-none cursor-pointer rounded hover:bg-indigo-500/20 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTranscribeTrack(audio);
                              }}
                              title="Transcribe to text banks"
                            >
                              <FeatherMic
                                className="text-indigo-400"
                                style={{ width: 10, height: 10 }}
                              />
                            </button>
                            <button
                              className="flex items-center justify-center w-5 h-5 bg-transparent border-none cursor-pointer rounded hover:bg-amber-500/20 transition-colors"
                              onClick={(e) => handleOpenAudioTrimmer(e, audio)}
                              title="Trim & save new"
                            >
                              <FeatherScissors
                                className="text-amber-400"
                                style={{ width: 10, height: 10 }}
                              />
                            </button>
                            <button
                              className="flex items-center justify-center w-5 h-5 bg-transparent border-none cursor-pointer rounded hover:bg-neutral-200/20 transition-colors"
                              onClick={(e) => handleStartRenameAudio(e, audio)}
                              title="Rename"
                            >
                              <FeatherEdit2
                                className="text-neutral-400"
                                style={{ width: 10, height: 10 }}
                              />
                            </button>
                            <button
                              className="flex items-center justify-center w-5 h-5 bg-transparent border-none cursor-pointer rounded hover:bg-red-500/20 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveAudio?.(audio.id);
                              }}
                              title="Remove from project"
                            >
                              <FeatherTrash2
                                className="text-red-400"
                                style={{ width: 10, height: 10 }}
                              />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Project audio not in this niche (available to import) */}
                  {projectAudio.filter((a) => !nicheAudio.some((na) => na.id === a.id)).length >
                    0 && (
                    <>
                      <div className="flex items-center gap-2 pt-1.5">
                        <div className="flex-1 h-px bg-neutral-200" />
                        <span className="text-[10px] text-neutral-500 flex-none">from project</span>
                        <div className="flex-1 h-px bg-neutral-200" />
                      </div>
                      {projectAudio
                        .filter((a) => !nicheAudio.some((na) => na.id === a.id))
                        .map((audio) => {
                          const isActive = niche?.audioId === audio.id;
                          const isPlaying = playingAudioId === audio.id;
                          const dur = audio.duration
                            ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}`
                            : '';
                          return (
                            <div
                              key={audio.id}
                              className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors flex-none ${
                                isActive
                                  ? 'bg-indigo-500/15 border border-indigo-500 ring-1 ring-indigo-500'
                                  : 'bg-black/50 border border-transparent hover:border-neutral-200 opacity-70 hover:opacity-100'
                              }`}
                              onClick={() => handleSelectAudio(audio.id)}
                            >
                              <button
                                className="flex-none flex items-center justify-center w-5 h-5 rounded-full bg-neutral-100 hover:bg-neutral-200 border-none cursor-pointer transition-colors"
                                onClick={(e) => handlePlayAudio(e, audio)}
                                title={isPlaying ? 'Stop' : 'Preview'}
                              >
                                {isPlaying ? (
                                  <FeatherSquare
                                    className="text-indigo-400"
                                    style={{ width: 8, height: 8 }}
                                  />
                                ) : (
                                  <FeatherPlay
                                    className="text-neutral-400"
                                    style={{ width: 8, height: 8 }}
                                  />
                                )}
                              </button>
                              <span className="text-caption font-caption text-white truncate flex-1">
                                {audio.name}
                              </span>
                              <span className="text-[10px] text-neutral-400 flex-none">{dur}</span>
                              <div className="flex-none flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  className="flex items-center justify-center w-5 h-5 bg-transparent border-none cursor-pointer rounded hover:bg-indigo-500/20 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTranscribeTrack(audio);
                                  }}
                                  title="Transcribe"
                                >
                                  <FeatherMic
                                    className="text-indigo-400"
                                    style={{ width: 10, height: 10 }}
                                  />
                                </button>
                                <button
                                  className="flex items-center justify-center w-5 h-5 bg-transparent border-none cursor-pointer rounded hover:bg-amber-500/20 transition-colors"
                                  onClick={(e) => handleOpenAudioTrimmer(e, audio)}
                                  title="Trim"
                                >
                                  <FeatherScissors
                                    className="text-amber-400"
                                    style={{ width: 10, height: 10 }}
                                  />
                                </button>
                                <button
                                  className="flex items-center justify-center w-5 h-5 bg-transparent border-none cursor-pointer rounded hover:bg-neutral-200/20 transition-colors"
                                  onClick={(e) => handleStartRenameAudio(e, audio)}
                                  title="Rename"
                                >
                                  <FeatherEdit2
                                    className="text-neutral-400"
                                    style={{ width: 10, height: 10 }}
                                  />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <audio
          ref={audioPreviewRef}
          preload="none"
          style={{ display: 'none' }}
          onEnded={() => setPlayingAudioId(null)}
        />

        {/* Draft grid */}
        {nicheDrafts.length > 0 && (
          <div className="flex w-full flex-col gap-4 px-8 pb-6">
            <div className="flex items-center gap-2">
              <span className="text-body-bold font-body-bold text-[#ffffffff]">Drafts</span>
              <Badge variant="neutral">{nicheDrafts.length}</Badge>
            </div>
            <div className="grid w-full grid-cols-2 sm:grid-cols-3 gap-3">
              {nicheDrafts
                .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
                .map((draft) => (
                  <div
                    key={draft.id}
                    className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-[#1a1a1aff] overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors"
                    onClick={() => handleMakeVideoFiltered(activeFormat, niche.id, draft)}
                  >
                    {draft.thumbnail ? (
                      <div className="w-full aspect-video bg-[#171717]">
                        <img
                          src={draft.thumbnail}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="w-full aspect-video bg-[#171717] flex items-center justify-center">
                        <FeatherImage
                          className="text-neutral-700"
                          style={{ width: 24, height: 24 }}
                        />
                      </div>
                    )}
                    <div className="flex w-full flex-col gap-0.5 px-3 pb-3">
                      <span className="text-caption font-caption text-neutral-300 truncate">
                        {draft.name || 'Untitled'}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Audio Picker for Add Lyrics */}
      {showAudioPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setShowAudioPicker(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-neutral-200 bg-[#111111] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">
                Choose a Song to Transcribe
              </span>
              <IconButton
                variant="neutral-tertiary"
                size="medium"
                icon={<FeatherX />}
                aria-label="Close"
                onClick={() => setShowAudioPicker(false)}
              />
            </div>
            <div className="px-6 py-4 flex flex-col gap-2 max-h-[400px] overflow-y-auto">
              {allAvailableAudio.map((audio) => {
                const dur = audio.duration
                  ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}`
                  : '';
                return (
                  <button
                    key={audio.id}
                    className="flex w-full items-center gap-3 rounded-lg px-4 py-3 bg-neutral-50 hover:bg-neutral-100 border border-transparent hover:border-indigo-500 cursor-pointer transition-colors text-left"
                    onClick={() => handlePickAudioAndTranscribe(audio)}
                  >
                    <FeatherMusic
                      className="text-indigo-400 flex-none"
                      style={{ width: 16, height: 16 }}
                    />
                    <span className="text-body font-body text-white truncate flex-1">
                      {audio.name}
                    </span>
                    {dur && (
                      <span className="text-caption font-caption text-neutral-400 flex-none">
                        {dur}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Audio Trimmer Modal */}
      {showAudioTrimmer && (trimAudioTarget || selectedAudio) && (
        <AudioClipSelector
          audioUrl={
            (trimAudioTarget || selectedAudio).localUrl || (trimAudioTarget || selectedAudio).url
          }
          audioName={(trimAudioTarget || selectedAudio).name || 'Audio'}
          onSave={handleAudioTrimAndUse}
          onCancel={() => {
            setShowAudioTrimmer(false);
            setTrimAudioTarget(null);
          }}
          db={db}
          artistId={artistId}
        />
      )}

      {/* WordTimeline audio element */}
      <audio
        ref={wordTimelineAudioRef}
        preload="none"
        style={{ display: 'none' }}
        onEnded={() => {
          cancelAnimationFrame(wtAnimRef.current);
          setWtIsPlaying(false);
        }}
      />

      {/* Word Timeline — after transcription */}
      {showWordTimeline && (
        <WordTimeline
          words={transcribedWords}
          setWords={setTranscribedWords}
          duration={transcribedDuration}
          currentTime={wtCurrentTime}
          onSeek={handleWtSeek}
          isPlaying={wtIsPlaying}
          onPlayPause={handleWtPlayPause}
          onClose={handleWtClose}
          audioRef={wordTimelineAudioRef}
          onAddToBank={handleWtAddToBank}
          onSaveToBank={
            onUpdateLyrics
              ? (lyricId, wordsToSave) => {
                  onUpdateLyrics(lyricId, { words: wordsToSave });
                  setLyricsBank((prev) =>
                    prev.map((l) => (l.id === lyricId ? { ...l, words: wordsToSave } : l)),
                  );
                  toastSuccess('Lyric timings saved');
                }
              : undefined
          }
        />
      )}

      {/* Bank Picker Modal — after transcription */}
      {showBankPicker && pendingTranscription && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setShowBankPicker(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-neutral-200 bg-[#111111] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">
                Add to Text Bank
              </span>
              <IconButton
                variant="neutral-tertiary"
                size="medium"
                icon={<FeatherX />}
                aria-label="Close"
                onClick={() => setShowBankPicker(false)}
              />
            </div>
            <div className="px-6 py-4">
              <span className="text-caption font-caption text-neutral-400 mb-3 block">
                {pendingTranscription.length} line{pendingTranscription.length !== 1 ? 's' : ''}{' '}
                transcribed
              </span>
              <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto mb-4 rounded-lg border border-neutral-200 bg-black p-3">
                {pendingTranscription.slice(0, 5).map((line, idx) => (
                  <span key={idx} className="text-caption font-caption text-neutral-300 truncate">
                    {line}
                  </span>
                ))}
                {pendingTranscription.length > 5 && (
                  <span className="text-caption font-caption text-neutral-500">
                    ...and {pendingTranscription.length - 5} more
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button
                  className="flex-1"
                  variant="brand-primary"
                  size="medium"
                  onClick={() => handleAssignToBank(1)}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 flex-none" />
                    Text Bank A
                  </span>
                </Button>
                <Button
                  className="flex-1"
                  variant="neutral-secondary"
                  size="medium"
                  onClick={() => handleAssignToBank(2)}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500 flex-none" />
                    Text Bank B
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Trim Popover */}
      {trimItemId && trimItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setTrimItemId(null)}
        >
          <QuickTrimPopover
            item={trimItem}
            initialTrimStart={trimData[trimItemId]?.trimStart || 0}
            initialTrimEnd={trimData[trimItemId]?.trimEnd || trimItem.duration}
            onSave={handleTrimSave}
            onClose={() => setTrimItemId(null)}
          />
        </div>
      )}

      {/* Fullscreen lightbox */}
      <VideoPreviewLightbox
        item={lightboxItem}
        onClose={() => setLightboxItem(null)}
        onTrim={(item) => {
          setLightboxItem(null);
          setTrimItemId(item.id);
        }}
        onPrev={(() => {
          if (!lightboxItem) return undefined;
          const idx = nicheMedia.findIndex((m) => m.id === lightboxItem.id);
          return idx > 0 ? () => setLightboxItem(nicheMedia[idx - 1]) : undefined;
        })()}
        onNext={(() => {
          if (!lightboxItem) return undefined;
          const idx = nicheMedia.findIndex((m) => m.id === lightboxItem.id);
          return idx >= 0 && idx < nicheMedia.length - 1
            ? () => setLightboxItem(nicheMedia[idx + 1])
            : undefined;
        })()}
      />

      {/* Import from Library */}
      {showImportModal && (
        <ImportFromLibraryModal
          artistId={artistId}
          nicheId={niche?.id}
          library={library}
          collections={collections}
          onImport={async (selectedIds) => {
            for (const mediaId of selectedIds) {
              await addToCollectionAsync(db, artistId, niche.id, mediaId);
            }
            onRefreshCollections?.();
            toastSuccess(`Imported ${selectedIds.length} items`);
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        confirmVariant="destructive"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ isOpen: false })}
      />
    </div>
  );
};

export default VideoNicheContent;
