/**
 * VideoNicheContent — "Create [Format]" button + draft grid for video niches
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlay, FeatherSquare, FeatherImage, FeatherFilm, FeatherLayers, FeatherCamera,
  FeatherPlus, FeatherX,
  FeatherType,
  FeatherUpload, FeatherDownloadCloud, FeatherScissors, FeatherLink,
  FeatherMusic,
  FeatherChevronDown, FeatherChevronRight,
} from '@subframe/core';
import {
  updateNicheAudioId,
  updateNicheMediaOrder,
  updateMediaTrimPoints,
  addToVideoTextBank,
  removeFromVideoTextBank,
  addToLibraryAsync,
  addToCollectionAsync,
  addToProjectPool,
  removeFromCollection,
} from '../../services/libraryService';
import useDragReorder from './shared/useDragReorder';
import QuickTrimPopover from './shared/QuickTrimPopover';
import AudioClipSelector from './AudioClipSelector';
import WordTimeline from './WordTimeline';
import { useLyricAnalyzer } from '../../hooks/useLyricAnalyzer';
import { useToast } from '../ui';

const FORMAT_ICONS = {
  montage: FeatherFilm,
  solo_clip: FeatherPlay,
  multi_clip: FeatherLayers,
  photo_montage: FeatherCamera,
};

const VideoNicheContent = ({
  db,
  artistId,
  niche,
  library = [],
  createdContent,
  projectAudio = [],
  onMakeVideo,
  onUpload,
  onUploadAudio,
  onImport,
  onImportAudio,
  onWebImport,
  onWebImportAudio,
}) => {
  const activeFormat = niche?.formats?.find(f => f.id === niche.activeFormatId) || niche?.formats?.[0];
  const IconComponent = FORMAT_ICONS[activeFormat?.id] || FeatherPlay;
  const [textBankInput1, setTextBankInput1] = useState('');
  const [textBankInput2, setTextBankInput2] = useState('');
  const [lightboxItem, setLightboxItem] = useState(null);
  const [trimItemId, setTrimItemId] = useState(null);

  // Audio preview playback
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const audioPreviewRef = useRef(null);
  const { success: toastSuccess, error: toastError } = useToast();

  const handlePlayAudio = useCallback((e, audio) => {
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
      const src = validUrl(audio.url) ? audio.url : validUrl(audio.localUrl) ? audio.localUrl : null;
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
  }, [playingAudioId, toastError]);

  // Audio tools
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [showWordTimeline, setShowWordTimeline] = useState(false);
  const [transcribedWords, setTranscribedWords] = useState([]);
  const [transcribedDuration, setTranscribedDuration] = useState(30);
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [pendingTranscription, setPendingTranscription] = useState(null);
  const { analyze: analyzeAudio, isAnalyzing, progress: analyzeProgress } = useLyricAnalyzer();

  // WordTimeline playback state
  const wordTimelineAudioRef = useRef(null);
  const [wtCurrentTime, setWtCurrentTime] = useState(0);
  const [wtIsPlaying, setWtIsPlaying] = useState(false);
  const wtAnimRef = useRef(null);

  // Drafts for this niche
  const nicheDrafts = useMemo(() =>
    (createdContent?.videos || []).filter(v => v.collectionId === niche?.id),
    [createdContent, niche?.id]
  );

  // Per-niche audio selection
  const selectedAudio = useMemo(
    () => projectAudio.find(a => a.id === niche?.audioId) || projectAudio[0] || null,
    [projectAudio, niche?.audioId]
  );

  const handleSelectAudio = useCallback((audioId) => {
    if (!niche) return;
    updateNicheAudioId(artistId, niche.id, audioId, db);
  }, [artistId, niche, db]);

  // Text banks (videoTextBank1 / videoTextBank2)
  const textBank1 = niche?.videoTextBank1 || [];
  const textBank2 = niche?.videoTextBank2 || [];

  const handleAddTextBank = useCallback((bankNum, text, setter) => {
    if (!text.trim() || !niche) return;
    addToVideoTextBank(artistId, niche.id, bankNum, text.trim(), db);
    setter('');
  }, [artistId, niche, db]);

  const handleRemoveTextBank = useCallback((bankNum, idx) => {
    if (!niche) return;
    removeFromVideoTextBank(artistId, niche.id, bankNum, idx, db);
  }, [artistId, niche, db]);

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
      if (!result?.words?.length) { toastError('No words transcribed'); return; }
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
      toastSuccess(`Transcribed ${result.words.length} word${result.words.length !== 1 ? 's' : ''}`);
      // Async energy-based refinement — updates WordTimeline in place
      refineWordsWithEnergy(legatoWords, audioSrc, dur).then(refined => {
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
    if (audio) { audio.pause(); audio.currentTime = 0; }
    cancelAnimationFrame(wtAnimRef.current);
    setWtIsPlaying(false);
    setShowWordTimeline(false);
  }, []);

  // WordTimeline "Add to Bank" — collects all words as lines, opens bank picker
  const handleWtAddToBank = useCallback((lyricId, wordsToSave) => {
    const allText = (wordsToSave || transcribedWords).map(w => w.text).join(' ');
    const lines = allText.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    setPendingTranscription(lines.length > 0 ? lines : [allText]);
    setShowWordTimeline(false);
    setShowBankPicker(true);
  }, [transcribedWords]);

  const handleAssignToBank = useCallback((bankNum) => {
    if (!pendingTranscription || !niche) return;
    pendingTranscription.forEach(text => addToVideoTextBank(artistId, niche.id, bankNum, text, db));
    setPendingTranscription(null);
    setShowBankPicker(false);
  }, [pendingTranscription, artistId, niche, db]);

  // All niche media (images + videos) for the grid
  const nicheMedia = useMemo(() => {
    if (!niche) return [];
    return library.filter(item => (niche.mediaIds || []).includes(item.id) && item.type !== 'audio');
  }, [niche, library]);

  // Drag-to-reorder media
  const handleMediaReorder = useCallback((reordered) => {
    if (!niche) return;
    const orderedIds = reordered.map(m => m.id);
    updateNicheMediaOrder(artistId, niche.id, orderedIds, db);
  }, [artistId, niche, db]);
  const { makeDragProps, dragOverIndex, isDragging } = useDragReorder(nicheMedia, handleMediaReorder);

  // Quick trim handlers
  const handleTrimSave = useCallback((trimStart, trimEnd) => {
    if (!niche || !trimItemId) return;
    updateMediaTrimPoints(artistId, niche.id, trimItemId, trimStart, trimEnd, db);
    setTrimItemId(null);
  }, [artistId, niche, trimItemId, db]);

  const trimItem = useMemo(() => nicheMedia.find(m => m.id === trimItemId), [nicheMedia, trimItemId]);
  const trimData = niche?.trimData || {};

  // Handle "Trim & Use" from AudioClipSelector — upload trimmed file, add to library, select as niche audio
  const handleAudioTrimAndUse = useCallback(async (trimResult) => {
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
        originalName: selectedAudio?.name,
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
  }, [niche, artistId, db, selectedAudio, toastSuccess, toastError]);

  if (!niche || !activeFormat) return null;

  return (
    <div className="flex items-stretch overflow-hidden flex-1 self-stretch">
      {/* Left/center — scrollable content */}
      <div className="flex grow basis-0 min-h-0 flex-col items-center self-stretch overflow-y-auto">
        {/* Media section */}
        {nicheMedia.length === 0 ? (
          /* Empty state — hero with upload/import */
          <div className="flex w-full flex-col items-center gap-5 px-8 py-8">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/30">
                <IconComponent className="text-indigo-400" style={{ width: 28, height: 28 }} />
              </div>
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{activeFormat.name}</span>
              {activeFormat.description && (
                <span className="text-body font-body text-neutral-400 text-center max-w-sm">{activeFormat.description}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="brand-primary" size="large" icon={<FeatherUpload />} onClick={onUpload}>
                Upload Media
              </Button>
              <Button variant="neutral-secondary" size="large" icon={<FeatherDownloadCloud />} onClick={onImport}>
                Import from Library
              </Button>
              <Button variant="neutral-secondary" size="large" icon={<FeatherLink />} onClick={onWebImport}>
                Import from Web
              </Button>
            </div>
          </div>
        ) : (
          /* Media grid — images & videos in scrollable area */
          <div className="flex w-full flex-col gap-3 px-8 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-body-bold font-body-bold text-[#ffffffff]">Media</span>
                <Badge variant="neutral">{nicheMedia.length}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="brand-tertiary" size="small" icon={<FeatherUpload />} onClick={onUpload}>Upload</Button>
                <Button variant="neutral-tertiary" size="small" icon={<FeatherDownloadCloud />} onClick={onImport}>Import</Button>
                <Button variant="neutral-tertiary" size="small" icon={<FeatherLink />} onClick={onWebImport}>Web</Button>
              </div>
            </div>
            <div className="w-full overflow-y-auto rounded-lg border border-solid border-neutral-800 bg-[#111118] p-2" style={{ maxHeight: 280 }}>
              <div className="grid w-full grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
                {nicheMedia.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group ${
                      dragOverIndex === idx ? 'ring-2 ring-indigo-500' : ''
                    }`}
                    onClick={() => setLightboxItem(item)}
                    {...makeDragProps(idx)}
                  >
                    {item.type === 'video' ? (
                      <>
                        {item.thumbnailUrl ? (
                          <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" loading="lazy" draggable={false} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <FeatherFilm className="text-neutral-600" style={{ width: 16, height: 16 }} />
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 border border-white/20">
                            <FeatherPlay className="text-white" style={{ width: 8, height: 8 }} />
                          </div>
                        </div>
                        {/* Scissors for quick trim */}
                        <button
                          className="absolute bottom-0.5 right-0.5 z-[4] flex h-4 w-4 items-center justify-center rounded bg-black/70 border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); setTrimItemId(item.id); }}
                          title="Quick trim"
                        >
                          <FeatherScissors className="text-white" style={{ width: 9, height: 9 }} />
                        </button>
                        {/* Trim indicator */}
                        {trimData[item.id] && (
                          <div className="absolute bottom-0.5 left-0.5 z-[3] rounded bg-green-500/80 px-0.5 py-px">
                            <span className="text-[7px] font-mono text-white">trimmed</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <img
                        src={item.thumbnailUrl || item.url}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    )}
                    {/* Order badge */}
                    <div className="absolute top-0.5 left-0.5 z-[3] rounded bg-black/60 px-1 py-px">
                      <span className="text-[9px] font-mono text-white/70">{idx + 1}</span>
                    </div>
                    {/* Delete button */}
                    <button
                      className="absolute top-0.5 right-0.5 z-[4] flex h-4 w-4 items-center justify-center rounded-full bg-black/70 border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/90"
                      onClick={(e) => { e.stopPropagation(); removeFromCollection(artistId, niche.id, [item.id], db); }}
                      title="Remove from niche"
                    >
                      <FeatherX className="text-white" style={{ width: 8, height: 8 }} />
                    </button>
                  </div>
                ))}
                {/* Upload placeholder tile */}
                <div
                  className="flex flex-col items-center justify-center aspect-square rounded border border-dashed border-neutral-700 cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/5 transition-colors"
                  onClick={onUpload}
                  title="Upload media"
                >
                  <FeatherPlus className="text-neutral-500" style={{ width: 12, height: 12 }} />
                </div>
              </div>
            </div>
          </div>
        )}


        {/* Text Banks */}
        <div className="flex w-full gap-4 px-8 pb-4">
          {/* Bank A — Indigo */}
          <div className="flex flex-1 min-w-0 flex-col gap-2 rounded-lg border border-solid border-indigo-500/30 bg-indigo-500/5 p-3 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-indigo-500 flex-none" />
              <span className="text-caption-bold font-caption-bold text-indigo-300">Text Bank A</span>
              <Badge variant="brand">{textBank1.length}</Badge>
            </div>
            {textBank1.length > 0 && (
              <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
                {textBank1.map((text, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-md px-2 py-1 min-w-0 group bg-black/40 hover:bg-black/60 transition-colors"
                  >
                    <FeatherType className="text-indigo-400 flex-none" style={{ width: 10, height: 10 }} />
                    <span className="grow text-caption font-caption text-neutral-300 truncate">{text}</span>
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
                className="flex-1 rounded-md border border-solid border-neutral-800 bg-black px-2 py-1 text-caption font-caption text-white outline-none placeholder-neutral-500"
                placeholder="Add text..."
                value={textBankInput1}
                onChange={e => setTextBankInput1(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTextBank(1, textBankInput1, setTextBankInput1); }}
              />
              <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add"
                onClick={() => handleAddTextBank(1, textBankInput1, setTextBankInput1)} />
            </div>
          </div>

          {/* Bank B — Amber */}
          <div className="flex flex-1 min-w-0 flex-col gap-2 rounded-lg border border-solid border-amber-500/30 bg-amber-500/5 p-3 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500 flex-none" />
              <span className="text-caption-bold font-caption-bold text-amber-300">Text Bank B</span>
              <Badge variant="warning">{textBank2.length}</Badge>
            </div>
            {textBank2.length > 0 && (
              <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
                {textBank2.map((text, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-md px-2 py-1 min-w-0 group bg-black/40 hover:bg-black/60 transition-colors"
                  >
                    <FeatherType className="text-amber-400 flex-none" style={{ width: 10, height: 10 }} />
                    <span className="grow text-caption font-caption text-neutral-300 truncate">{text}</span>
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
                className="flex-1 rounded-md border border-solid border-neutral-800 bg-black px-2 py-1 text-caption font-caption text-white outline-none placeholder-neutral-500"
                placeholder="Add text..."
                value={textBankInput2}
                onChange={e => setTextBankInput2(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTextBank(2, textBankInput2, setTextBankInput2); }}
              />
              <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add"
                onClick={() => handleAddTextBank(2, textBankInput2, setTextBankInput2)} />
            </div>
          </div>
        </div>

        {/* Audio Bank — vertical list like text banks */}
        <div className="flex w-full flex-col gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-4 py-3 mx-8 mb-4" style={{ maxWidth: 'calc(100% - 64px)', maxHeight: 200 }}>
          <div className="flex w-full flex-none items-center justify-between">
            <div className="flex items-center gap-2">
              <FeatherMusic className="text-neutral-400" style={{ width: 14, height: 14 }} />
              <span className="text-caption-bold font-caption-bold text-[#ffffffff]">Audio</span>
              <Badge variant="neutral">{projectAudio.length}</Badge>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                onClick={() => onImportAudio?.()}
              >Import</button>
              <button
                className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                onClick={() => onUploadAudio?.()}
              >Upload</button>
              <button
                className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                onClick={() => onWebImportAudio?.()}
              >Web</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              {projectAudio.length === 0 ? (
                <div className="flex items-center justify-center rounded-md border-2 border-dashed border-neutral-700 py-3">
                  <span className="text-caption font-caption text-neutral-500">No audio uploaded</span>
                </div>
              ) : (
                projectAudio.map(audio => {
                  const isActive = niche?.audioId === audio.id;
                  const isPlaying = playingAudioId === audio.id;
                  const dur = audio.duration ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}` : '';
                  return (
                    <div
                      key={audio.id}
                      className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors flex-none ${
                        isActive ? 'bg-indigo-500/15 border border-indigo-500 ring-1 ring-indigo-500' : 'bg-black border border-transparent hover:border-neutral-700'
                      }`}
                      onClick={() => handleSelectAudio(audio.id)}
                    >
                      <button
                        className="flex-none flex items-center justify-center w-5 h-5 rounded-full bg-neutral-800 hover:bg-neutral-700 border-none cursor-pointer transition-colors"
                        onClick={(e) => handlePlayAudio(e, audio)}
                        title={isPlaying ? 'Stop' : 'Preview'}
                      >
                        {isPlaying
                          ? <FeatherSquare className="text-indigo-400" style={{ width: 8, height: 8 }} />
                          : <FeatherPlay className={isActive ? 'text-indigo-400' : 'text-neutral-400'} style={{ width: 8, height: 8 }} />
                        }
                      </button>
                      <span className="text-caption font-caption text-white truncate flex-1">{audio.name}</span>
                      <span className="text-[10px] text-neutral-500 flex-none">{dur}</span>
                      <button
                        className="flex-none opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 bg-transparent border-none cursor-pointer transition-opacity"
                        onClick={(e) => { e.stopPropagation(); /* remove handled by parent */ }}
                        title="Remove"
                      >
                        <FeatherX className="text-neutral-500 hover:text-red-400" style={{ width: 10, height: 10 }} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <audio ref={audioPreviewRef} preload="none" style={{ display: 'none' }} onEnded={() => setPlayingAudioId(null)} />

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
                .map(draft => (
                  <div
                    key={draft.id}
                    className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors"
                    onClick={() => onMakeVideo && onMakeVideo(activeFormat, niche.id, draft)}
                  >
                    {draft.thumbnail ? (
                      <div className="w-full aspect-video bg-[#171717]">
                        <img src={draft.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    ) : (
                      <div className="w-full aspect-video bg-[#171717] flex items-center justify-center">
                        <FeatherImage className="text-neutral-700" style={{ width: 24, height: 24 }} />
                      </div>
                    )}
                    <div className="flex w-full flex-col gap-0.5 px-3 pb-3">
                      <span className="text-caption font-caption text-neutral-300 truncate">{draft.name || 'Untitled'}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

      </div>

      {/* Audio Trimmer Modal */}
      {showAudioTrimmer && selectedAudio && (
        <AudioClipSelector
          audioUrl={selectedAudio.localUrl || selectedAudio.url}
          audioName={selectedAudio.name || 'Audio'}
          onSave={handleAudioTrimAndUse}
          onCancel={() => setShowAudioTrimmer(false)}
          db={db}
          artistId={artistId}
        />
      )}

      {/* WordTimeline audio element */}
      <audio
        ref={wordTimelineAudioRef}
        preload="none"
        style={{ display: 'none' }}
        onEnded={() => { cancelAnimationFrame(wtAnimRef.current); setWtIsPlaying(false); }}
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
        />
      )}

      {/* Bank Picker Modal — after transcription */}
      {showBankPicker && pendingTranscription && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setShowBankPicker(false)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-[#111111] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Add to Text Bank</span>
              <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} aria-label="Close" onClick={() => setShowBankPicker(false)} />
            </div>
            <div className="px-6 py-4">
              <span className="text-caption font-caption text-neutral-400 mb-3 block">
                {pendingTranscription.length} line{pendingTranscription.length !== 1 ? 's' : ''} transcribed
              </span>
              <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto mb-4 rounded-lg border border-neutral-800 bg-black p-3">
                {pendingTranscription.slice(0, 5).map((line, idx) => (
                  <span key={idx} className="text-caption font-caption text-neutral-300 truncate">{line}</span>
                ))}
                {pendingTranscription.length > 5 && (
                  <span className="text-caption font-caption text-neutral-500">...and {pendingTranscription.length - 5} more</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setTrimItemId(null)}>
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
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxItem(null)}
        >
          <button
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 border-none cursor-pointer z-10 transition-colors"
            onClick={() => setLightboxItem(null)}
            aria-label="Close preview"
          >
            <FeatherX className="text-white" style={{ width: 20, height: 20 }} />
          </button>
          <div className="flex flex-col items-center gap-3 max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {lightboxItem.type === 'video' ? (
              <video
                className="max-w-[90vw] max-h-[85vh] rounded-lg"
                src={lightboxItem.url}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <img
                className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain"
                src={lightboxItem.url}
                alt={lightboxItem.name}
              />
            )}
            <span className="text-caption font-caption text-neutral-400 truncate max-w-[60vw]">{lightboxItem.name}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoNicheContent;
