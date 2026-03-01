/**
 * SlideshowNicheContent — Banks, text entries, preview & generate panel for a slideshow niche.
 * Extracted from PipelineWorkspace center+right panels.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  getPipelineBankLabel,
  migrateCollectionBanks,
  assignToBank,
  removeFromBank,
  addToTextBank,
  removeFromTextBank,
  getTextBankText,
  getTextBankStyle,
  getBankColor,
  updateNicheAudioId,
} from '../../services/libraryService';
import TemplateConfigurator from './shared/TemplateConfigurator';
import DraggableTextOverlay from './shared/previews/DraggableTextOverlay';
import LyricDistributor from './shared/LyricDistributor';
import AudioClipSelector from './AudioClipSelector';
import { useLyricAnalyzer } from '../../hooks/useLyricAnalyzer';
import { useToast } from '../ui';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { IconWithBackground } from '../../ui/components/IconWithBackground';
import {
  FeatherPlus, FeatherX, FeatherType, FeatherPlay, FeatherSquare,
  FeatherImage, FeatherMusic, FeatherZap, FeatherTrash2,
  FeatherRefreshCw,
  FeatherChevronDown, FeatherChevronRight, FeatherDatabase,
} from '@subframe/core';

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
  createdContent,
  projectAudio = [],
  projectMedia = [],
  draggingMediaIds,
  onOpenEditor,
  onViewDrafts,
  onUploadToBank,
  onImportToBank,
  onWebImportToBank,
  onUploadAudio,
  onImportAudio,
  onRemoveAudio,
}) => {
  const [textInputs, setTextInputs] = useState({});
  const [dragOverBank, setDragOverBank] = useState(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [previewPicks, setPreviewPicks] = useState({}); // { [bankIdx]: imageId }
  const [generateCount, setGenerateCount] = useState(10);
  const previewContainerRef = useRef(null);
  const [textPositions, setTextPositions] = useState({});
  const [textOverrides, setTextOverrides] = useState({}); // { [bankIdx]: editedText } — preview-only, doesn't modify bank
  const [selectedTextIdx, setSelectedTextIdx] = useState({}); // { [bankIdx]: entryIdx | null } — which text entry is selected for preview
  const [liveSettings, setLiveSettings] = useState(null);
  const [lightboxItem, setLightboxItem] = useState(null);
  const [poolExpanded, setPoolExpanded] = useState(false);

  // Reset preview state when switching niches
  const nicheIdRef = useRef(niche?.id);
  useEffect(() => {
    if (niche?.id !== nicheIdRef.current) {
      nicheIdRef.current = niche?.id;
      setPreviewSlideIdx(0);
      setPreviewPicks({});
      setTextPositions({});
      setTextOverrides({});
      setSelectedTextIdx({});
    }
  }, [niche?.id]);

  // Project pool media NOT in this niche
  const poolOnlyMedia = useMemo(() => {
    if (!niche || !projectMedia.length) return [];
    const nicheIds = new Set(niche.mediaIds || []);
    return projectMedia.filter(m => !nicheIds.has(m.id) && m.type === 'image');
  }, [niche, projectMedia]);

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

  // Audio tools / transcription
  const [showAudioTrimmer, setShowAudioTrimmer] = useState(false);
  const [showLyricDistributor, setShowLyricDistributor] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [pendingTranscription, setPendingTranscription] = useState(null);
  const { analyze: analyzeAudio, isAnalyzing, progress: analyzeProgress } = useLyricAnalyzer();

  const pipeline = useMemo(() => niche ? migrateCollectionBanks(niche) : null, [niche]);

  const activeFormat = pipeline?.formats?.find(f => f.id === pipeline.activeFormatId) || pipeline?.formats?.[0];

  // Per-niche audio selection
  const selectedAudio = useMemo(
    () => projectAudio.find(a => a.id === niche?.audioId) || projectAudio[0] || null,
    [projectAudio, niche?.audioId]
  );
  const audioUrl = useMemo(() => selectedAudio?.localUrl || selectedAudio?.url || null, [selectedAudio]);

  const slideCount = activeFormat?.slideCount || pipeline?.banks?.length || 2;

  // Drafts for this niche
  const nicheDrafts = useMemo(() =>
    (createdContent?.slideshows || []).filter(s => s.collectionId === niche?.id && !s.isTemplate),
    [createdContent, niche?.id]
  );

  // Drag & drop to bank
  const handleDrop = useCallback((bankIndex, e) => {
    e.preventDefault();
    setDragOverBank(null);
    if (draggingMediaIds?.length > 0 && niche) {
      draggingMediaIds.forEach(id => assignToBank(artistId, niche.id, id, bankIndex, db));
    }
  }, [draggingMediaIds, artistId, niche, db]);

  // Add text to bank
  const handleAddText = useCallback((bankIdx) => {
    const text = (textInputs[bankIdx] || '').trim();
    if (!text || !niche) return;
    addToTextBank(artistId, niche.id, bankIdx, text, db);
    setTextInputs(prev => ({ ...prev, [bankIdx]: '' }));
  }, [textInputs, artistId, niche, db]);

  // Remove text from bank
  const handleRemoveText = useCallback((bankIdx, entryIdx) => {
    if (!niche) return;
    removeFromTextBank(artistId, niche.id, bankIdx, entryIdx, db);
  }, [artistId, niche, db]);

  // Pick one random image ID from a bank (stable until reroll)
  const pickOneFromBank = useCallback((bankIdx) => {
    const ids = pipeline?.banks?.[bankIdx] || [];
    if (ids.length === 0) return null;
    return ids[Math.floor(Math.random() * ids.length)];
  }, [pipeline]);

  // Ensure picks exist for a given bank (lazy init)
  const ensurePicks = useCallback((bankIdx) => {
    setPreviewPicks(prev => {
      if (prev[bankIdx] !== undefined) return prev;
      return { ...prev, [bankIdx]: pickOneFromBank(bankIdx) };
    });
  }, [pickOneFromBank]);

  // Generate picks when slide changes
  useEffect(() => {
    ensurePicks(previewSlideIdx);
  }, [previewSlideIdx, ensurePicks]);

  // Reroll the currently visible image
  const handleRerollPreview = useCallback(() => {
    // Reroll image
    const ids = pipeline?.banks?.[previewSlideIdx] || [];
    if (ids.length >= 2) {
      setPreviewPicks(prev => {
        const currentPick = prev[previewSlideIdx];
        const candidates = ids.filter(id => id !== currentPick);
        const newPick = candidates[Math.floor(Math.random() * candidates.length)];
        return { ...prev, [previewSlideIdx]: newPick };
      });
    }
    // Reroll text
    const texts = pipeline?.textBanks?.[previewSlideIdx] || [];
    if (texts.length > 0) {
      const currentIdx = selectedTextIdx[previewSlideIdx];
      const candidateIdxs = texts.map((_, i) => i).filter(i => i !== currentIdx);
      const pool = candidateIdxs.length > 0 ? candidateIdxs : texts.map((_, i) => i);
      const newIdx = pool[Math.floor(Math.random() * pool.length)];
      setSelectedTextIdx(prev => ({ ...prev, [previewSlideIdx]: newIdx }));
      setTextOverrides(prev => { const next = { ...prev }; delete next[previewSlideIdx]; return next; });
    }
  }, [pipeline, previewSlideIdx, selectedTextIdx]);

  // Get the current preview image URL
  const currentPreviewUrl = useMemo(() => {
    const pickedId = previewPicks[previewSlideIdx];
    if (!pickedId) return null;
    const item = library.find(m => m.id === pickedId);
    return item?.url || item?.thumbnailUrl || null;
  }, [previewPicks, previewSlideIdx, library]);

  // Check if current bank has images
  const currentBankHasImages = useMemo(() => {
    return (pipeline?.banks?.[previewSlideIdx] || []).length > 0;
  }, [pipeline, previewSlideIdx]);

  // Audio selection
  const handleSelectAudio = useCallback((audioId) => {
    if (!niche) return;
    updateNicheAudioId(artistId, niche.id, audioId, db);
  }, [artistId, niche, db]);

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
      if (!result?.words?.length) { toastError('No words transcribed'); return; }
      const fullText = result.words.map(w => w.text).join(' ');
      const lined = fullText.replace(/([.!?])\s+/g, '$1\n').trim();
      setTranscribedText(lined);
      setShowLyricDistributor(true);
      toastSuccess(`Transcribed ${result.words.length} word${result.words.length !== 1 ? 's' : ''}`);
    } catch (err) {
      if (err.message === 'API_KEY_REQUIRED') {
        toastError('OpenAI API key required — set it in Settings');
      } else {
        toastError(`Transcription failed: ${err.message}`);
      }
    }
  }, [selectedAudio, analyzeAudio, toastSuccess, toastError]);

  // Assign transcribed lines to a specific slide bank
  const handleAssignToBank = useCallback((bankIdx) => {
    if (!pendingTranscription || !niche) return;
    pendingTranscription.forEach(text => addToTextBank(artistId, niche.id, bankIdx, text, db));
    setPendingTranscription(null);
    setShowBankPicker(false);
  }, [pendingTranscription, artistId, niche, db]);

  // Auto-distribute transcribed lines across slide banks
  const handleAutoDistribute = useCallback(() => {
    if (!pendingTranscription || !niche) return;
    pendingTranscription.forEach((text, i) => {
      const bankIdx = i % slideCount;
      addToTextBank(artistId, niche.id, bankIdx, text, db);
    });
    setPendingTranscription(null);
    setShowBankPicker(false);
  }, [pendingTranscription, artistId, niche, slideCount, db]);

  // LyricDistributor confirm — add transcribed lines to slide text banks
  const handleLyricDistributorConfirm = useCallback((assignmentMap) => {
    if (!niche) return;
    Object.entries(assignmentMap).forEach(([bankIdx, lines]) => {
      lines.forEach(text => addToTextBank(artistId, niche.id, parseInt(bankIdx), text, db));
    });
    setShowLyricDistributor(false);
    toastSuccess('Lyrics distributed');
  }, [artistId, niche, db, toastSuccess]);

  if (!pipeline) return null;

  return (
    <div className="flex items-stretch overflow-hidden flex-1 self-stretch">
      {/* Center — Slide Banks + Audio */}
      <div className="flex grow shrink-0 basis-0 flex-col self-stretch overflow-hidden">
        <div className={slideCount > 5
          ? 'grid grid-cols-4 gap-3 flex-1 min-h-0 overflow-y-auto px-4 py-4 pr-1'
          : 'flex items-stretch flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-4 py-4 pr-1 gap-3'
        }>
        {Array.from({ length: slideCount }).map((_, bankIdx) => {
          const label = getPipelineBankLabel(pipeline, bankIdx);
          const headerColor = getBankHeaderColor(label, bankIdx);
          const bankImages = (pipeline.banks?.[bankIdx] || [])
            .map(id => library.find(m => m.id === id))
            .filter(Boolean);
          const textEntries = pipeline.textBanks?.[bankIdx] || [];
          const isDragOver = dragOverBank === bankIdx;

          return (
            <div key={bankIdx} className="flex flex-col gap-2 flex-1 overflow-hidden min-w-[150px]">
              {/* Column header */}
              <div
                className="flex w-full flex-none items-center justify-between rounded-t-lg px-3 py-2"
                style={{ backgroundColor: headerColor }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <IconWithBackground variant={getBankIconVariant(label)} size="small" icon={getBankIcon(label)} square />
                  <span className="text-caption-bold font-caption-bold text-[#ffffffff] truncate">{label}</span>
                </div>
                <Badge variant={getBankBadgeVariant(label)}>{bankImages.length}</Badge>
              </div>

              {/* Images section — capped height, scrolls internally */}
              <div
                className={`flex w-full flex-col items-start gap-2 rounded-b-lg border bg-[#1a1a1aff] overflow-hidden transition-colors px-3 py-3 ${
                  isDragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-solid border-neutral-800'
                }`}
                style={{ height: '45%', minHeight: '120px' }}
                onDragOver={e => { e.preventDefault(); setDragOverBank(bankIdx); }}
                onDragLeave={() => setDragOverBank(null)}
                onDrop={e => handleDrop(bankIdx, e)}
              >
                <div className="flex w-full flex-none items-center justify-between">
                  <span className="text-caption font-caption text-neutral-400">Images{bankImages.length > 0 ? ` ${bankImages.length}` : ''}</span>
                  <div className="flex items-center gap-1">
                    <button
                      className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                      onClick={() => onImportToBank?.(bankIdx)}
                    >Import</button>
                    <button
                      className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                      onClick={() => onUploadToBank?.(bankIdx)}
                    >Upload</button>
                    <button
                      className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                      onClick={() => onWebImportToBank?.(bankIdx)}
                    >Web</button>
                  </div>
                </div>
                <div className="w-full flex-1 min-h-0 overflow-y-auto">
                  <div className="w-full items-start gap-1.5 grid grid-cols-3">
                    {bankImages.map(item => (
                      <img
                        key={item.id}
                        className="flex-none rounded-sm border-b-2 border-solid aspect-square object-cover w-full cursor-pointer hover:opacity-80 transition-opacity"
                        style={{ borderBottomColor: headerColor }}
                        src={item.thumbnailUrl || item.url}
                        alt={item.name}
                        loading="lazy"
                        onClick={() => setLightboxItem(item)}
                      />
                    ))}
                    <div
                      className="flex flex-col items-center justify-center rounded-sm border-2 border-dashed border-neutral-700 aspect-square cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/5 transition-colors"
                      onClick={() => onUploadToBank?.(bankIdx)}
                      title="Upload images to this bank"
                    >
                      <FeatherPlus className="text-neutral-500" style={{ width: 12, height: 12 }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Text bank section — fixed uniform height */}
              <div
                className="flex w-full flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-3 py-3"
                style={{ height: '45%', minHeight: '140px' }}
              >
                <div className="flex w-full flex-none items-center justify-between">
                  <span className="text-caption font-caption text-neutral-400 truncate">{`${label} Lines`}</span>
                  <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add text" onClick={() => handleAddText(bankIdx)} />
                </div>
                <div className="flex w-full flex-col items-start gap-1.5 flex-1 min-h-0 overflow-y-auto">
                  {textEntries.map((entry, entryIdx) => {
                    const text = getTextBankText(entry);
                    const style = getTextBankStyle(entry);
                    return (
                      <div
                        key={entryIdx}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 flex-none cursor-pointer transition-colors ${
                          selectedTextIdx[bankIdx] === entryIdx
                            ? 'bg-indigo-500/30 ring-1 ring-indigo-500'
                            : 'bg-black hover:bg-black/60'
                        }`}
                        onClick={() => {
                          setSelectedTextIdx(prev => ({
                            ...prev,
                            [bankIdx]: prev[bankIdx] === entryIdx ? null : entryIdx,
                          }));
                          setPreviewSlideIdx(bankIdx);
                        }}
                      >
                        <FeatherType className="text-caption font-caption flex-none" style={{ color: style?.color || getTextIconColor(label), width: 12, height: 12 }} />
                        <span className="grow text-caption font-caption text-[#ffffffff] truncate">{text}</span>
                        <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />} aria-label="Remove text" onClick={(e) => { e.stopPropagation(); handleRemoveText(bankIdx, entryIdx); if (selectedTextIdx[bankIdx] === entryIdx) setSelectedTextIdx(prev => ({ ...prev, [bankIdx]: null })); }} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex w-full flex-none items-center gap-2 rounded-md border border-solid border-neutral-800 bg-black px-2 py-1.5">
                  <input
                    className="grow bg-transparent text-caption font-caption text-white outline-none placeholder-neutral-500"
                    placeholder={`Add ${label.toLowerCase()} line...`}
                    value={textInputs[bankIdx] || ''}
                    onChange={e => setTextInputs(prev => ({ ...prev, [bankIdx]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddText(bankIdx); }}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {/* Audio Bank — same column pattern as slide banks */}
        <div className="flex flex-col gap-2 flex-1 overflow-hidden min-w-[150px]">
          {/* Column header */}
          <div className="flex w-full flex-none items-center justify-between rounded-t-lg px-3 py-2" style={{ backgroundColor: '#292524' }}>
            <div className="flex items-center gap-2">
              <IconWithBackground variant="brand" size="small" icon={<FeatherMusic />} square />
              <span className="text-caption-bold font-caption-bold text-[#ffffffff]">Audio</span>
            </div>
            <Badge variant="neutral">{projectAudio.length}</Badge>
          </div>

          {/* Audio items — vertical scroll, fills remaining height */}
          <div className="flex w-full flex-col items-start gap-2 rounded-b-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-3 py-3 flex-1 min-h-0 overflow-hidden">
            <div className="flex w-full flex-none items-center justify-between">
              <span className="text-caption font-caption text-neutral-400">Tracks</span>
              <div className="flex items-center gap-1">
                <span className="text-caption font-caption text-neutral-400 mr-1">{projectAudio.length}</span>
                <button
                  className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                  onClick={() => onImportAudio?.()}
                >Import</button>
                <button
                  className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                  onClick={() => onUploadAudio?.()}
                >Upload</button>
              </div>
            </div>
            <div className="w-full flex-1 min-h-0 overflow-y-auto">
              <div className="flex flex-col gap-1.5">
                {projectAudio.map(audio => {
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
                        onClick={(e) => { e.stopPropagation(); onRemoveAudio?.(audio.id); }}
                        title="Remove from project"
                      >
                        <FeatherTrash2 className="text-neutral-500 hover:text-red-400" style={{ width: 10, height: 10 }} />
                      </button>
                    </div>
                  );
                })}
                <div
                  className="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-neutral-700 py-3 cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/5 transition-colors"
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
          <div className="flex flex-col gap-2 px-4 py-3 border-t border-neutral-800">
            <button
              className="flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 w-full text-left"
              onClick={() => setPoolExpanded(prev => !prev)}
            >
              {poolExpanded
                ? <FeatherChevronDown className="text-neutral-400 flex-none" style={{ width: 14, height: 14 }} />
                : <FeatherChevronRight className="text-neutral-400 flex-none" style={{ width: 14, height: 14 }} />
              }
              <FeatherDatabase className="text-neutral-400 flex-none" style={{ width: 14, height: 14 }} />
              <span className="text-caption-bold font-caption-bold text-neutral-300">From Project Pool</span>
              <Badge variant="neutral">{poolOnlyMedia.length}</Badge>
            </button>
            {poolExpanded && (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {poolOnlyMedia.slice(0, 24).map(item => (
                  <img
                    key={item.id}
                    className="rounded-sm aspect-square object-cover w-full cursor-pointer border border-neutral-800 hover:border-neutral-600 transition-colors"
                    src={item.thumbnailUrl || item.url}
                    alt={item.name}
                    loading="lazy"
                    onClick={() => setLightboxItem(item)}
                  />
                ))}
                {poolOnlyMedia.length > 24 && (
                  <div className="flex items-center justify-center aspect-square rounded-sm bg-neutral-800">
                    <span className="text-[10px] text-neutral-400">+{poolOnlyMedia.length - 24}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Hidden audio element for preview playback */}
        <audio ref={audioPreviewRef} preload="none" style={{ display: 'none' }} onEnded={() => setPlayingAudioId(null)} />

      </div>

      {/* Right — Template Configurator + Banks */}
      <div className="flex w-96 flex-none flex-col items-start self-stretch border-l border-solid border-neutral-800 bg-black overflow-y-auto">
        {/* Template Configurator (inline — we render its pieces directly so captions/hashtags/lyrics stay below) */}
        <TemplateConfigurator
          niche={niche}
          activeFormat={activeFormat}
          artistId={artistId}
          db={db}
          onSettingsChange={setLiveSettings}
          previewContent={
            currentPreviewUrl ? (
              <>
              <div ref={previewContainerRef} className="relative w-full overflow-hidden rounded-xl border border-solid border-neutral-700 bg-[#0a0a0f]" style={{ aspectRatio: '9/16' }}>
                <img className="absolute inset-0 w-full h-full object-cover" src={currentPreviewUrl} alt="Preview" />
                {/* Draggable text overlay — only for current slide, editable via double-click */}
                {(() => {
                  const texts = pipeline?.textBanks?.[previewSlideIdx] || [];
                  if (!texts.length) return null;
                  const selIdx = selectedTextIdx[previewSlideIdx];
                  const entry = selIdx != null && texts[selIdx] ? texts[selIdx] : texts[0];
                  const bankText = getTextBankText(entry);
                  if (!bankText) return null;
                  const displayText = textOverrides[previewSlideIdx] ?? bankText;
                  const bankLabel = getPipelineBankLabel(pipeline, previewSlideIdx);
                  const color = getBankHeaderColor(bankLabel, previewSlideIdx);
                  const pos = textPositions[previewSlideIdx] || { x: 50, y: 50, width: 80 };
                  return (
                    <>
                      <DraggableTextOverlay
                        key={previewSlideIdx}
                        text={displayText}
                        textStyle={{ ...(liveSettings?.textStyle || {}), ...(getTextBankStyle(entry) || {}) }}
                        color={color}
                        position={pos}
                        onPositionChange={(newPos) => setTextPositions(prev => ({ ...prev, [previewSlideIdx]: newPos }))}
                        onTextChange={(newText) => setTextOverrides(prev => ({ ...prev, [previewSlideIdx]: newText }))}
                        containerRef={previewContainerRef}
                      />
                    </>
                  );
                })()}
                {/* Slide dots */}
                <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2 z-10">
                  {Array.from({ length: slideCount }).map((_, i) => (
                    <div
                      key={i}
                      className="flex h-2 w-2 flex-none rounded-full cursor-pointer"
                      style={{
                        backgroundColor: getBankHeaderColor(getPipelineBankLabel(pipeline, i), i),
                        opacity: previewSlideIdx === i ? 1 : 0.3,
                      }}
                      onClick={(e) => { e.stopPropagation(); setPreviewSlideIdx(i); }}
                    />
                  ))}
                </div>
              </div>
              {/* Controls below preview */}
              <div className="flex items-center justify-center gap-3 mt-2">
                {(pipeline?.banks?.[previewSlideIdx] || []).length >= 2 && (
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 cursor-pointer transition-colors"
                    onClick={handleRerollPreview}
                  >
                    <FeatherRefreshCw className="text-neutral-300" style={{ width: 12, height: 12 }} />
                    <span className="text-caption font-caption text-neutral-300">Reroll</span>
                  </button>
                )}
              </div>
            </> ) : currentBankHasImages ? (
              <div className="flex flex-col items-center gap-2">
                <FeatherImage className="text-neutral-600" style={{ width: 24, height: 24 }} />
                <span className="text-caption font-caption text-neutral-500">Loading preview...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FeatherImage className="text-neutral-600" style={{ width: 24, height: 24 }} />
                <span className="text-caption font-caption text-neutral-500">No images yet</span>
              </div>
            )
          }
          createCount={generateCount}
          onCreateCountChange={setGenerateCount}
          onCreateClick={(templateSettings) => {
            if (!onOpenEditor) return;
            // Package the niche preview state into an existingDraft for the editor
            const timestamp = Date.now();
            const slides = Array.from({ length: slideCount }).map((_, bankIdx) => {
              // Ensure every slide has an image pick (lazily picks weren't generated for unvisited slides)
              let pickedId = previewPicks[bankIdx];
              if (!pickedId) {
                const bankIds = pipeline?.banks?.[bankIdx] || [];
                if (bankIds.length > 0) pickedId = bankIds[Math.floor(Math.random() * bankIds.length)];
              }
              const item = pickedId ? library.find(m => m.id === pickedId) : null;
              const imgUrl = item?.url || item?.thumbnailUrl || null;
              // Build text overlays from selected (or first) text bank entry + any overrides
              const texts = pipeline?.textBanks?.[bankIdx] || [];
              const textOverlayList = [];
              if (texts.length > 0) {
                const selIdx = selectedTextIdx[bankIdx];
                const entry = selIdx != null && texts[selIdx] ? texts[selIdx] : texts[0];
                const bankText = getTextBankText(entry);
                const displayText = textOverrides[bankIdx] ?? bankText;
                if (displayText) {
                  const pos = textPositions[bankIdx] || { x: 50, y: 50, width: 80 };
                  // Merge template text style as base, then overlay bank entry style
                  const baseStyle = templateSettings?.textStyle || liveSettings?.textStyle || {};
                  const entryStyle = getTextBankStyle(entry) || {};
                  textOverlayList.push({
                    id: `text_${timestamp}_${bankIdx}_0`,
                    text: displayText,
                    style: {
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 48,
                      fontWeight: '600',
                      color: '#ffffff',
                      textAlign: 'center',
                      outline: true,
                      outlineColor: '#000000',
                      ...baseStyle,
                      ...entryStyle,
                    },
                    position: pos,
                  });
                }
              }
              return {
                id: `slide_${timestamp}_${bankIdx}`,
                index: bankIdx,
                backgroundImage: imgUrl,
                thumbnail: imgUrl,
                sourceBank: `image${bankIdx}`,
                sourceImageId: pickedId || null,
                textOverlays: textOverlayList,
                duration: 3,
                imageTransform: { scale: 1, offsetX: 0, offsetY: 0 },
              };
            });
            const existingDraft = {
              id: `slideshow_niche_${timestamp}`,
              name: pipeline?.name ? `${pipeline.name} #1` : 'Slideshow #1',
              slides,
              audio: selectedAudio ? { ...selectedAudio } : null,
              aspectRatio: templateSettings?.aspectRatio || '9:16',
              isTemplate: true,
              _nicheGenerateCount: generateCount,
            };
            onOpenEditor(pipeline, generateCount, existingDraft, templateSettings);
          }}
          createLabel={`Create ${generateCount}`}
          selectedAudio={selectedAudio}
          projectAudio={projectAudio}
          onSelectAudio={handleSelectAudio}
          onUploadAudio={onUploadAudio}
          onTrimAudio={() => setShowAudioTrimmer(true)}
          onAutoTranscribe={handleAutoTranscribe}
          isTranscribing={isAnalyzing}
          draftCount={nicheDrafts.length}
          onViewDrafts={() => onViewDrafts && onViewDrafts(pipeline)}
        />

      </div>

      {/* Audio Trimmer Modal */}
      {showAudioTrimmer && selectedAudio && (
        <AudioClipSelector
          audioUrl={selectedAudio.localUrl || selectedAudio.url}
          audioName={selectedAudio.name || 'Audio'}
          onSave={() => setShowAudioTrimmer(false)}
          onCancel={() => setShowAudioTrimmer(false)}
          db={db}
          artistId={artistId}
        />
      )}

      {/* Lyric Distributor — after transcription (slideshow-specific) */}
      {showLyricDistributor && (
        <LyricDistributor
          text={transcribedText}
          slideLabels={Array.from({ length: slideCount }).map((_, i) => getPipelineBankLabel(pipeline, i))}
          slideCount={slideCount}
          onConfirm={handleLyricDistributorConfirm}
          onClose={() => setShowLyricDistributor(false)}
        />
      )}

      {/* Bank Picker Modal — assign transcribed lines to slide banks */}
      {showBankPicker && pendingTranscription && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setShowBankPicker(false)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-[#111111] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Add to Slide Bank</span>
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
              {/* Auto-distribute button */}
              <Button className="w-full mb-3" variant="brand-primary" size="medium" onClick={handleAutoDistribute}>
                Auto-distribute across {slideCount} slides
              </Button>
              {/* Per-slide bank buttons */}
              <span className="text-caption font-caption text-neutral-500 mb-2 block">Or add all to one slide:</span>
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
                        <span className="h-2.5 w-2.5 rounded-full flex-none" style={{ backgroundColor: color }} />
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
            <img
              className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain"
              src={lightboxItem.url || lightboxItem.thumbnailUrl}
              alt={lightboxItem.name}
            />
            <span className="text-caption font-caption text-neutral-400 truncate max-w-[60vw]">{lightboxItem.name}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SlideshowNicheContent;
