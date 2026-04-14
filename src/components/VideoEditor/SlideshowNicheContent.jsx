/**
 * SlideshowNicheContent — Banks, text entries, preview & generate panel for a slideshow niche.
 * Extracted from PipelineWorkspace center+right panels.
 */

import {
  FeatherCheck,
  FeatherChevronDown,
  FeatherChevronRight,
  FeatherDatabase,
  FeatherEdit2,
  FeatherImage,
  FeatherMic,
  FeatherMusic,
  FeatherPlay,
  FeatherPlus,
  FeatherScissors,
  FeatherSquare,
  FeatherTrash2,
  FeatherType,
  FeatherX,
  FeatherZap,
} from '@subframe/core';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLyricAnalyzer } from '../../hooks/useLyricAnalyzer';
import { uploadFile } from '../../services/firebaseStorage';
import {
  addToCollectionAsync,
  addToLibraryAsync,
  addToProjectPool,
  addToTextBank,
  assignToBank,
  getBankColor,
  getPipelineBankLabel,
  getTextBankStyle,
  getTextBankText,
  MEDIA_TYPES,
  migrateCollectionBanks,
  removeFromBank,
  removeFromTextBank,
  updateLibraryItemAsync,
  updateNicheAudioId,
  updateTextBankEntry,
} from '../../services/libraryService';
import { Badge } from '../../ui/components/Badge';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { IconWithBackground } from '../../ui/components/IconWithBackground';
import { useToast } from '../ui';
import AudioClipSelector from './AudioClipSelector';
import LyricDistributor from './shared/LyricDistributor';

// Bank header colors keyed by label
const BANK_HEADER_COLORS = {
  Hook: '#4f46e5',
  Lyrics: '#059669',
  Text: '#d97706',
  Image: '#4f46e5',
};
const getBankHeaderColor = (label, index) =>
  BANK_HEADER_COLORS[label] || getBankColor(index).primary;

const getBankIcon = (label) => {
  if (label.toLowerCase().includes('hook')) return <FeatherZap />;
  if (label.toLowerCase().includes('lyric')) return <FeatherMusic />;
  if (label.toLowerCase() === 'text') return <FeatherType />;
  return <FeatherImage />;
};

const getBankBadgeVariant = (label) => {
  if (label.toLowerCase().includes('hook')) return 'brand';
  if (label.toLowerCase().includes('lyric')) return 'success';
  if (label.toLowerCase() === 'text') return 'warning';
  return 'brand';
};

const getBankIconVariant = (label) => {
  if (label.toLowerCase().includes('hook')) return 'brand';
  if (label.toLowerCase().includes('lyric')) return 'success';
  if (label.toLowerCase() === 'text') return 'warning';
  return 'brand';
};

const getTextIconColor = (label) => {
  if (label.toLowerCase().includes('hook')) return '#818cf8';
  if (label.toLowerCase().includes('lyric')) return '#34d399';
  if (label.toLowerCase().includes('vibe')) return '#fbbf24';
  return '#818cf8';
};

const SlideshowNicheContent = ({
  db,
  artistId,
  niche,
  library,
  projectAudio = [],
  projectMedia = [],
  draggingMediaIds,
  onUploadToBank,
  onImportToBank,
  onWebImportToBank,
  onUploadAudio,
  onImportAudio,
  onWebImportAudio,
  onRemoveAudio,
}) => {
  const [textInputs, setTextInputs] = useState({});
  const [dragOverBank, setDragOverBank] = useState(null);
  const [lightboxItem, setLightboxItem] = useState(null);
  const [poolExpanded, setPoolExpanded] = useState(false);
  // Edit text bank entry — { bankIdx, entryIdx, text }
  const [editingEntry, setEditingEntry] = useState(null);
  const editTextareaRef = useRef(null);

  // Project pool media NOT in this niche
  const poolOnlyMedia = useMemo(() => {
    if (!niche || !projectMedia.length) return [];
    const nicheIds = new Set(niche.mediaIds || []);
    return projectMedia.filter((m) => !nicheIds.has(m.id) && m.type === 'image');
  }, [niche, projectMedia]);

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
    const ext = audio?.name?.match(/\.[^.]+$/)?.[0] || '.mp3';
    await updateLibraryItemAsync(db, artistId, renamingAudioId, {
      name: renameAudioValue.trim() + ext,
    });
    toastSuccess('Audio renamed');
    setRenamingAudioId(null);
  }, [renamingAudioId, renameAudioValue, projectAudio, db, artistId, toastSuccess]);

  // Audio tools / transcription
  const [trimAudioTarget, setTrimAudioTarget] = useState(null); // audio item to trim
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [showLyricDistributor, setShowLyricDistributor] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [pendingTranscription, setPendingTranscription] = useState(null);
  const { analyze: analyzeAudio, isAnalyzing, progress: analyzeProgress } = useLyricAnalyzer();

  const pipeline = useMemo(() => (niche ? migrateCollectionBanks(niche) : null), [niche]);

  // Local textBanks for instant UI updates (same pattern as localAudioId)
  const [localTextBanks, setLocalTextBanks] = useState(pipeline?.textBanks || []);
  useEffect(() => {
    if (pipeline?.textBanks) setLocalTextBanks(pipeline.textBanks);
  }, [pipeline?.textBanks]);

  const activeFormat =
    pipeline?.formats?.find((f) => f.id === pipeline.activeFormatId) || pipeline?.formats?.[0];

  // Per-niche audio selection — local state for instant UI, synced to niche prop
  const [localAudioId, setLocalAudioId] = useState(niche?.audioId ?? undefined);
  // Sync from niche prop when it changes (e.g. Firestore update)
  useEffect(() => {
    if (niche?.audioId !== undefined) setLocalAudioId(niche.audioId);
  }, [niche?.audioId]);
  const effectiveAudioId = localAudioId !== undefined ? localAudioId : niche?.audioId;
  const selectedAudio = useMemo(() => {
    if (effectiveAudioId === null) return null;
    if (effectiveAudioId) return projectAudio.find((a) => a.id === effectiveAudioId) || null;
    return projectAudio[0] || null;
  }, [projectAudio, effectiveAudioId]);
  const slideCount = activeFormat?.slideCount || pipeline?.banks?.length || 2;

  // Per-track transcribe (selects audio, then triggers auto-transcribe)
  const handleTranscribeTrack = useCallback(
    async (audio) => {
      setLocalAudioId(audio.id);
      if (niche) updateNicheAudioId(artistId, niche.id, audio.id, db);
      const audioSrc = audio.localUrl || audio.url;
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
        const fullText = result.words.map((w) => w.text).join(' ');
        const lined = fullText.replace(/([.!?])\s+/g, '$1\n').trim();
        setTranscribedText(lined);
        setShowLyricDistributor(true);
        toastSuccess(
          `Transcribed ${result.words.length} word${result.words.length !== 1 ? 's' : ''}`,
        );
      } catch (err) {
        if (err.message === 'API_KEY_REQUIRED') {
          toastError('OpenAI API key required — set it in Settings');
        } else {
          toastError(`Transcription failed: ${err.message}`);
        }
      }
    },
    [niche, artistId, db, analyzeAudio, toastSuccess, toastError],
  );

  // Open trimmer for a specific audio track
  const handleOpenTrimmer = useCallback((e, audio) => {
    e.stopPropagation();
    setTrimAudioTarget(audio);
    setShowAudioTrimmer(true);
  }, []);

  // Save trimmed clip as new audio in library + niche
  const handleSaveClip = useCallback(
    async (clipData) => {
      if (!clipData?.file) {
        toastSuccess('Clip saved (trim points only)');
        return;
      }
      try {
        const { url, path } = await uploadFile(clipData.file, 'audio');
        const item = {
          type: MEDIA_TYPES.AUDIO,
          name: clipData.name || clipData.file.name || 'Trimmed clip',
          url,
          storagePath: path,
          collectionIds: niche ? [niche.id] : [],
          metadata: { fileSize: clipData.file.size, mimeType: clipData.file.type },
          duration: clipData.clipDuration || undefined,
        };
        const savedItem = await addToLibraryAsync(db, artistId, item);
        if (niche) {
          await addToCollectionAsync(db, artistId, niche.id, savedItem.id);
          if (niche.projectId) addToProjectPool(artistId, niche.projectId, [savedItem.id], db);
        }
        toastSuccess(`Saved "${item.name}" to library`);
      } catch (err) {
        toastError(`Failed to save clip: ${err.message}`);
      }
    },
    [db, artistId, niche, toastSuccess, toastError],
  );

  // Drag & drop to bank
  const handleDrop = useCallback(
    (bankIndex, e) => {
      e.preventDefault();
      setDragOverBank(null);
      if (draggingMediaIds?.length > 0 && niche) {
        draggingMediaIds.forEach((id) => assignToBank(artistId, niche.id, id, bankIndex, db));
      }
    },
    [draggingMediaIds, artistId, niche, db],
  );

  // Add text to bank — updates local state instantly + persists
  const localAddToTextBank = useCallback(
    (bankIdx, text) => {
      if (!niche) return;
      addToTextBank(artistId, niche.id, bankIdx, text, db);
      setLocalTextBanks((prev) => {
        const copy = [...(prev || [])];
        while (copy.length <= bankIdx) copy.push([]);
        copy[bankIdx] = [...(copy[bankIdx] || []), text];
        return copy;
      });
    },
    [artistId, niche, db],
  );

  const handleAddText = useCallback(
    (bankIdx) => {
      const text = (textInputs[bankIdx] || '').trim();
      if (!text) return;
      localAddToTextBank(bankIdx, text);
      setTextInputs((prev) => ({ ...prev, [bankIdx]: '' }));
    },
    [textInputs, localAddToTextBank],
  );

  // Remove text from bank
  const handleRemoveText = useCallback(
    (bankIdx, entryIdx) => {
      if (!niche) return;
      removeFromTextBank(artistId, niche.id, bankIdx, entryIdx, db);
      setLocalTextBanks((prev) => {
        const copy = [...(prev || [])];
        if (copy[bankIdx]) {
          copy[bankIdx] = copy[bankIdx].filter((_, i) => i !== entryIdx);
        }
        return copy;
      });
    },
    [artistId, niche, db],
  );

  // Save edited text bank entry
  const handleSaveEdit = useCallback(() => {
    if (!editingEntry || !niche) return;
    const { bankIdx, entryIdx, text } = editingEntry;
    const trimmed = text.trim();
    if (!trimmed) {
      setEditingEntry(null);
      return;
    }
    updateTextBankEntry(artistId, niche.id, bankIdx, entryIdx, trimmed, db);
    setLocalTextBanks((prev) => {
      const copy = [...(prev || [])];
      if (copy[bankIdx] && copy[bankIdx][entryIdx] !== undefined) {
        const existing = copy[bankIdx][entryIdx];
        copy[bankIdx] = [...copy[bankIdx]];
        copy[bankIdx][entryIdx] =
          typeof existing === 'object' && existing?.text !== undefined
            ? { ...existing, text: trimmed }
            : trimmed;
      }
      return copy;
    });
    setEditingEntry(null);
  }, [editingEntry, artistId, niche, db]);

  // Audio selection
  const handleSelectAudio = useCallback(
    (audioId) => {
      if (!niche) return;
      setLocalAudioId(audioId);
      updateNicheAudioId(artistId, niche.id, audioId, db);
    },
    [artistId, niche, db],
  );

  // Auto-transcribe
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
      const fullText = result.words.map((w) => w.text).join(' ');
      const lined = fullText.replace(/([.!?])\s+/g, '$1\n').trim();
      setTranscribedText(lined);
      setShowLyricDistributor(true);
      toastSuccess(
        `Transcribed ${result.words.length} word${result.words.length !== 1 ? 's' : ''}`,
      );
    } catch (err) {
      if (err.message === 'API_KEY_REQUIRED') {
        toastError('OpenAI API key required — set it in Settings');
      } else {
        toastError(`Transcription failed: ${err.message}`);
      }
    }
  }, [selectedAudio, analyzeAudio, toastSuccess, toastError]);

  // Assign transcribed lines to a specific slide bank
  const handleAssignToBank = useCallback(
    (bankIdx) => {
      if (!pendingTranscription) return;
      pendingTranscription.forEach((text) => localAddToTextBank(bankIdx, text));
      setPendingTranscription(null);
      setShowBankPicker(false);
    },
    [pendingTranscription, localAddToTextBank],
  );

  // Auto-distribute transcribed lines across slide banks
  const handleAutoDistribute = useCallback(() => {
    if (!pendingTranscription) return;
    pendingTranscription.forEach((text, i) => {
      localAddToTextBank(i % slideCount, text);
    });
    setPendingTranscription(null);
    setShowBankPicker(false);
  }, [pendingTranscription, slideCount, localAddToTextBank]);

  // LyricDistributor confirm — add transcribed lines to slide text banks
  const handleLyricDistributorConfirm = useCallback(
    (assignmentMap) => {
      Object.entries(assignmentMap).forEach(([bankIdx, lines]) => {
        lines.forEach((text) => localAddToTextBank(parseInt(bankIdx), text));
      });
      setShowLyricDistributor(false);
      toastSuccess('Lyrics distributed');
    },
    [localAddToTextBank, toastSuccess],
  );

  if (!pipeline) return null;

  return (
    <div className="flex items-stretch overflow-hidden flex-1 self-stretch">
      {/* Center — Slide Banks + Audio */}
      <div className="flex grow basis-0 min-h-0 flex-col self-stretch overflow-hidden">
        <div
          className={
            slideCount > 5
              ? 'grid grid-cols-4 gap-3 flex-1 min-h-0 overflow-y-auto px-4 py-4 pr-1'
              : 'flex items-stretch flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-4 py-4 pr-1 gap-3'
          }
        >
          {Array.from({ length: slideCount }).map((_, bankIdx) => {
            const label = getPipelineBankLabel(pipeline, bankIdx);
            const headerColor = getBankHeaderColor(label, bankIdx);
            const bankImages = (pipeline.banks?.[bankIdx] || [])
              .map((id) => library.find((m) => m.id === id))
              .filter(Boolean);
            const textEntries = localTextBanks?.[bankIdx] || [];
            const isDragOver = dragOverBank === bankIdx;

            return (
              <div
                key={bankIdx}
                className="flex flex-col gap-2 flex-1 overflow-hidden min-w-[150px]"
              >
                {/* Column header — click to preview this slide */}
                <div
                  className="flex w-full flex-none items-center justify-between rounded-t-lg px-3 py-2"
                  style={{ backgroundColor: headerColor }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <IconWithBackground
                      variant={getBankIconVariant(label)}
                      size="small"
                      icon={getBankIcon(label)}
                      square
                    />
                    <span className="text-caption-bold font-caption-bold text-[#ffffffff] truncate">
                      {label}
                    </span>
                  </div>
                  <Badge variant={getBankBadgeVariant(label)}>{bankImages.length}</Badge>
                </div>

                {/* Images section — capped height, scrolls internally */}
                <div
                  className={`flex w-full flex-col items-start gap-2 rounded-b-lg border bg-[#1a1a1aff] overflow-hidden transition-colors px-3 py-3 ${
                    isDragOver
                      ? 'border-indigo-500 bg-indigo-500/5'
                      : 'border-solid border-neutral-200'
                  }`}
                  style={{ height: '45%', minHeight: '120px' }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverBank(bankIdx);
                  }}
                  onDragLeave={() => setDragOverBank(null)}
                  onDrop={(e) => handleDrop(bankIdx, e)}
                >
                  <div className="flex w-full flex-none items-center justify-between">
                    <span className="text-caption font-caption text-neutral-400">
                      Images{bankImages.length > 0 ? ` ${bankImages.length}` : ''}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors"
                        type="button"
                        onClick={() => onImportToBank?.(bankIdx)}
                      >
                        Import
                      </button>
                      <button
                        className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors"
                        type="button"
                        onClick={() => onUploadToBank?.(bankIdx)}
                      >
                        Upload
                      </button>
                      <button
                        className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors"
                        type="button"
                        onClick={() => onWebImportToBank?.(bankIdx)}
                      >
                        Web
                      </button>
                    </div>
                  </div>
                  <div className="w-full flex-1 min-h-0 overflow-y-auto">
                    <div className="w-full items-start gap-1.5 grid grid-cols-3">
                      {bankImages.map((item) => (
                        <img
                          key={item.id}
                          className="flex-none rounded-sm border-b-2 border-solid aspect-square object-cover w-full cursor-pointer hover:opacity-80 transition-opacity"
                          style={{ borderBottomColor: headerColor }}
                          src={item.thumbnailUrl || item.url}
                          alt={item.name}
                          loading="lazy"
                          tabIndex={0}
                          role="button"
                          onClick={() => setLightboxItem(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setLightboxItem(item);
                            }
                          }}
                        />
                      ))}
                      <div
                        className="flex flex-col items-center justify-center rounded-sm border-2 border-dashed border-neutral-200 aspect-square cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/5 transition-colors"
                        onClick={() => onUploadToBank?.(bankIdx)}
                        title="Upload images to this bank"
                      >
                        <FeatherPlus
                          className="text-neutral-500"
                          style={{ width: 12, height: 12 }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Text bank section — fixed uniform height */}
                <div
                  className="flex w-full flex-col items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-[#1a1a1aff] px-3 py-3"
                  style={{ height: '45%', minHeight: '140px' }}
                >
                  <div className="flex w-full flex-none items-center justify-between">
                    <span className="text-caption font-caption text-neutral-400 truncate">{`Slide ${bankIdx + 1} Text`}</span>
                    <IconButton
                      variant="brand-tertiary"
                      size="small"
                      icon={<FeatherPlus />}
                      aria-label="Add text"
                      onClick={() => handleAddText(bankIdx)}
                    />
                  </div>
                  <div className="flex w-full flex-col items-start gap-1.5 flex-1 min-h-0 overflow-y-auto">
                    {textEntries.map((entry, entryIdx) => {
                      const text = getTextBankText(entry);
                      const style = getTextBankStyle(entry);
                      return (
                        <div
                          key={entryIdx}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 flex-none bg-black hover:bg-black/60 transition-colors cursor-pointer group"
                          onClick={() => setEditingEntry({ bankIdx, entryIdx, text })}
                          title="Click to edit"
                        >
                          <FeatherType
                            className="text-caption font-caption flex-none"
                            style={{
                              color: style?.color || getTextIconColor(label),
                              width: 12,
                              height: 12,
                            }}
                          />
                          <span className="grow text-caption font-caption text-[#ffffffff] truncate">
                            {text}
                          </span>
                          <FeatherEdit2
                            className="flex-none text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ width: 12, height: 12 }}
                          />
                          <IconButton
                            variant="neutral-tertiary"
                            size="small"
                            icon={<FeatherX />}
                            aria-label="Remove text"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveText(bankIdx, entryIdx);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex w-full flex-none items-center gap-2 rounded-md border border-solid border-neutral-200 bg-black px-2 py-1.5">
                    <input
                      className="grow bg-transparent text-caption font-caption text-white outline-none placeholder-neutral-500"
                      placeholder="Add text..."
                      value={textInputs[bankIdx] || ''}
                      onChange={(e) =>
                        setTextInputs((prev) => ({ ...prev, [bankIdx]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddText(bankIdx);
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {/* Audio Bank — same column pattern as slide banks */}
          <div className="flex flex-col gap-2 flex-1 overflow-hidden min-w-[200px]">
            {/* Column header */}
            <div
              className="flex w-full flex-none items-center justify-between rounded-t-lg px-3 py-2"
              style={{ backgroundColor: '#292524' }}
            >
              <div className="flex items-center gap-2">
                <IconWithBackground variant="brand" size="small" icon={<FeatherMusic />} square />
                <span className="text-caption-bold font-caption-bold text-[#ffffffff]">Audio</span>
              </div>
              <Badge variant="neutral">{projectAudio.length}</Badge>
            </div>

            {/* Audio items — vertical scroll, fills remaining height */}
            <div className="flex w-full flex-col items-start gap-2 rounded-b-lg border border-solid border-neutral-200 bg-[#1a1a1aff] px-3 py-3 flex-1 min-h-0 overflow-hidden">
              <div className="flex w-full flex-none items-center justify-between flex-wrap gap-y-1">
                <span className="text-caption font-caption text-neutral-400">
                  Tracks{projectAudio.length > 0 ? ` ${projectAudio.length}` : ''}
                </span>
                <div className="flex items-center gap-1 flex-wrap">
                  {selectedAudio && (
                    <button
                      className="text-caption font-caption text-green-400 hover:text-green-300 bg-transparent border-none cursor-pointer px-2 py-1 rounded hover:bg-green-500/10 transition-colors"
                      type="button"
                      onClick={handleAutoTranscribe}
                      disabled={isAnalyzing}
                      title="Transcribe selected audio to text banks"
                    >
                      {isAnalyzing ? 'Transcribing...' : 'Transcribe'}
                    </button>
                  )}
                  <button
                    className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors"
                    type="button"
                    onClick={() => onImportAudio?.()}
                  >
                    Import
                  </button>
                  <button
                    className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors"
                    type="button"
                    onClick={() => onUploadAudio?.()}
                  >
                    Upload
                  </button>
                  <button
                    className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors"
                    type="button"
                    onClick={() => onWebImportAudio?.()}
                  >
                    Web
                  </button>
                </div>
              </div>
              <div className="w-full flex-1 min-h-0 overflow-y-auto">
                <div className="flex flex-col gap-1.5">
                  {projectAudio.map((audio) => {
                    const isActive = effectiveAudioId === audio.id;
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
                        onClick={() => !isRenaming && handleSelectAudio(audio.id)}
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
                            className="flex-1 bg-transparent text-caption font-caption text-white outline-none border-b border-indigo-500 min-w-0"
                            value={renameAudioValue}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameAudioValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRenameAudio();
                              if (e.key === 'Escape') setRenamingAudioId(null);
                            }}
                            onBlur={handleSaveRenameAudio}
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
                              onClick={(e) => handleOpenTrimmer(e, audio)}
                              title="Trim & save new"
                            >
                              <FeatherScissors
                                className="text-amber-400"
                                style={{ width: 10, height: 10 }}
                              />
                            </button>
                            <button
                              className="flex items-center justify-center w-5 h-5 bg-transparent border-none cursor-pointer rounded hover:bg-neutral-200 transition-colors"
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
                                className="text-neutral-500 hover:text-red-400"
                                style={{ width: 10, height: 10 }}
                              />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div
                    className="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-neutral-200 py-3 cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/5 transition-colors"
                    onClick={() => onUploadAudio?.()}
                    title="Upload audio"
                  >
                    <FeatherPlus className="text-neutral-500" style={{ width: 12, height: 12 }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* From Project Pool — media in project but not in this niche */}
        {poolOnlyMedia.length > 0 && (
          <div className="flex flex-col gap-2 px-4 py-3 border-t border-neutral-200">
            <button
              className="flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 w-full text-left"
              onClick={() => setPoolExpanded((prev) => !prev)}
            >
              {poolExpanded ? (
                <FeatherChevronDown
                  className="text-neutral-400 flex-none"
                  style={{ width: 14, height: 14 }}
                />
              ) : (
                <FeatherChevronRight
                  className="text-neutral-400 flex-none"
                  style={{ width: 14, height: 14 }}
                />
              )}
              <FeatherDatabase
                className="text-neutral-400 flex-none"
                style={{ width: 14, height: 14 }}
              />
              <span className="text-caption-bold font-caption-bold text-neutral-300">
                From Project Pool
              </span>
              <Badge variant="neutral">{poolOnlyMedia.length}</Badge>
            </button>
            {poolExpanded && (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {poolOnlyMedia.slice(0, 24).map((item) => (
                  <img
                    key={item.id}
                    className="rounded-sm aspect-square object-cover w-full cursor-pointer border border-neutral-200 hover:border-neutral-600 transition-colors"
                    src={item.thumbnailUrl || item.url}
                    alt={item.name}
                    loading="lazy"
                    onClick={() => setLightboxItem(item)}
                  />
                ))}
                {poolOnlyMedia.length > 24 && (
                  <div className="flex items-center justify-center aspect-square rounded-sm bg-neutral-100">
                    <span className="text-[10px] text-neutral-400">
                      +{poolOnlyMedia.length - 24}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Hidden audio element for preview playback */}
        <audio
          ref={audioPreviewRef}
          preload="none"
          style={{ display: 'none' }}
          onEnded={() => setPlayingAudioId(null)}
        />
      </div>

      {/* Audio Trimmer Modal */}
      {showAudioTrimmer && (trimAudioTarget || selectedAudio) && (
        <AudioClipSelector
          audioUrl={
            (trimAudioTarget || selectedAudio).localUrl || (trimAudioTarget || selectedAudio).url
          }
          audioName={(trimAudioTarget || selectedAudio).name || 'Audio'}
          onSave={(data) => {
            if (data?.file)
              handleSaveClip({
                ...data,
                name: data.clipName || (trimAudioTarget || selectedAudio).name,
              });
            setShowAudioTrimmer(false);
            setTrimAudioTarget(null);
          }}
          onSaveClip={(clipData) => {
            handleSaveClip({
              ...clipData,
              file: clipData.file,
              name: clipData.clipName || `${(trimAudioTarget || selectedAudio).name} (trim)`,
            });
          }}
          onCancel={() => {
            setShowAudioTrimmer(false);
            setTrimAudioTarget(null);
          }}
          db={db}
          artistId={artistId}
        />
      )}

      {/* Lyric Distributor — after transcription (slideshow-specific) */}
      {showLyricDistributor && (
        <LyricDistributor
          text={transcribedText}
          slideLabels={Array.from({ length: slideCount }).map((_, i) =>
            getPipelineBankLabel(pipeline, i),
          )}
          slideCount={slideCount}
          onConfirm={handleLyricDistributorConfirm}
          onClose={() => setShowLyricDistributor(false)}
        />
      )}

      {/* Bank Picker Modal — assign transcribed lines to slide banks */}
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
                Add to Slide Bank
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
              {/* Auto-distribute button */}
              <Button
                className="w-full mb-3"
                variant="brand-primary"
                size="medium"
                onClick={handleAutoDistribute}
              >
                Auto-distribute across {slideCount} slides
              </Button>
              {/* Per-slide bank buttons */}
              <span className="text-caption font-caption text-neutral-500 mb-2 block">
                Or add all to one slide:
              </span>
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: slideCount }).map((_, bankIdx) => {
                  const label = getPipelineBankLabel(pipeline, bankIdx);
                  const color = getBankHeaderColor(label, bankIdx);
                  return (
                    <Button
                      key={bankIdx}
                      className="flex-1"
                      variant="neutral-secondary"
                      size="small"
                      onClick={() => handleAssignToBank(bankIdx)}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-none"
                          style={{ backgroundColor: color }}
                        />
                        {label}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit text bank entry overlay */}
      {editingEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setEditingEntry(null)}
        >
          <div
            className="flex flex-col gap-3 w-full max-w-lg rounded-xl bg-neutral-50 border border-neutral-200 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-body-bold font-body-bold text-white">Edit Text</span>
              <IconButton
                variant="neutral-tertiary"
                size="small"
                icon={<FeatherX />}
                aria-label="Cancel"
                onClick={() => setEditingEntry(null)}
              />
            </div>
            <textarea
              ref={editTextareaRef}
              className="w-full min-h-[120px] rounded-lg border border-neutral-200 bg-neutral-0 px-3 py-2 text-body font-body text-white outline-none focus:border-indigo-500 resize-y"
              value={editingEntry.text}
              onChange={(e) => setEditingEntry((prev) => ({ ...prev, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveEdit();
                if (e.key === 'Escape') setEditingEntry(null);
              }}
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="neutral-secondary"
                size="small"
                onClick={() => setEditingEntry(null)}
              >
                Cancel
              </Button>
              <Button variant="brand-primary" size="small" onClick={handleSaveEdit}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen lightbox */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxItem(null)}
        >
          <button
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 border-none cursor-pointer z-10 transition-colors"
            onClick={() => setLightboxItem(null)}
            aria-label="Close preview"
          >
            <FeatherX className="text-white" style={{ width: 20, height: 20 }} />
          </button>
          <div
            className="flex flex-col items-center gap-3 max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain"
              src={lightboxItem.url || lightboxItem.thumbnailUrl}
              alt={lightboxItem.name}
            />
            <span className="text-caption font-caption text-neutral-400 truncate max-w-[60vw]">
              {lightboxItem.name}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SlideshowNicheContent;
