/**
 * SlideshowNicheContent — Banks, text entries, preview & generate panel for a slideshow niche.
 * Extracted from PipelineWorkspace center+right panels.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  getPipelineBankLabel,
  migrateCollectionBanks,
  assignToBank,
  removeFromBank,
  addToTextBank,
  removeFromTextBank,
  getUserCollections,
  saveCollections,
  saveCollectionToFirestore,
  getTextBankText,
  getTextBankStyle,
  getBankColor,
  updateNicheCaptionBank,
  updateNicheHashtagBank,
  moveNicheBankEntry,
} from '../../services/libraryService';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { IconWithBackground } from '../../ui/components/IconWithBackground';
import {
  FeatherPlus, FeatherX, FeatherType, FeatherPlay, FeatherRefreshCw,
  FeatherArrowRight, FeatherImage, FeatherMusic, FeatherZap,
  FeatherDatabase, FeatherLayers, FeatherHash, FeatherMessageSquare,
  FeatherTrash2,
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
  selectedAudio,
  draggingMediaIds,
  onOpenEditor,
  onViewDrafts,
  allNiches = [],
  onUploadToBank,
  onImportToBank,
}) => {
  const [textInputs, setTextInputs] = useState({});
  const [dragOverBank, setDragOverBank] = useState(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [generateCount, setGenerateCount] = useState(10);
  const [previewKey, setPreviewKey] = useState(0);
  const [lyricsText, setLyricsText] = useState('');
  const [newCaption, setNewCaption] = useState('');
  const [newHashtag, setNewHashtag] = useState('');

  const pipeline = useMemo(() => niche ? migrateCollectionBanks(niche) : null, [niche]);

  const activeFormat = pipeline?.formats?.find(f => f.id === pipeline.activeFormatId) || pipeline?.formats?.[0];
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
      draggingMediaIds.forEach(id => assignToBank(artistId, niche.id, id, bankIndex));
      if (db && pipeline) saveCollectionToFirestore(db, artistId, { ...pipeline, updatedAt: new Date().toISOString() });
    }
  }, [draggingMediaIds, artistId, niche, db, pipeline]);

  // Add text to bank
  const handleAddText = useCallback((bankIdx) => {
    const text = (textInputs[bankIdx] || '').trim();
    if (!text || !niche) return;
    addToTextBank(artistId, niche.id, bankIdx, text);
    if (db) {
      const updated = getUserCollections(artistId).find(c => c.id === niche.id);
      if (updated) saveCollectionToFirestore(db, artistId, updated);
    }
    setTextInputs(prev => ({ ...prev, [bankIdx]: '' }));
  }, [textInputs, artistId, niche, db]);

  // Remove text from bank
  const handleRemoveText = useCallback((bankIdx, entryIdx) => {
    if (!niche) return;
    removeFromTextBank(artistId, niche.id, bankIdx, entryIdx);
    if (db) {
      const updated = getUserCollections(artistId).find(c => c.id === niche.id);
      if (updated) saveCollectionToFirestore(db, artistId, updated);
    }
  }, [artistId, niche, db]);

  // Random preview image
  const getPreviewImage = useCallback((slideIdx) => {
    if (!pipeline?.banks?.[slideIdx]?.length) return null;
    const ids = pipeline.banks[slideIdx];
    const randId = ids[Math.floor(Math.random() * ids.length)];
    const item = library.find(m => m.id === randId);
    return item?.url || item?.thumbnailUrl || null;
  }, [pipeline, library]);

  // Random preview text
  const getPreviewText = useCallback((slideIdx) => {
    const texts = pipeline?.textBanks?.[slideIdx] || [];
    if (!texts.length) return null;
    const entry = texts[Math.floor(Math.random() * texts.length)];
    return getTextBankText(entry);
  }, [pipeline]);

  // Load lyrics from banks
  const handleLoadFromBanks = useCallback(() => {
    if (!pipeline?.textBanks) return;
    const allTexts = pipeline.textBanks
      .flatMap(bank => (bank || []).map(entry => getTextBankText(entry)))
      .filter(Boolean);
    if (allTexts.length === 0) return;
    setLyricsText(allTexts.join('\n'));
  }, [pipeline]);

  // Caption bank helpers
  const captions = niche?.captionBank || [];
  const hashtags = niche?.hashtagBank || [];
  const otherNiches = allNiches.filter(n => n.id !== niche?.id);

  const handleAddCaption = useCallback(() => {
    const text = newCaption.trim();
    if (!text || !niche) return;
    const updated = [...captions, text];
    updateNicheCaptionBank(artistId, niche.id, updated);
    if (db) {
      const col = getUserCollections(artistId).find(c => c.id === niche.id);
      if (col) saveCollectionToFirestore(db, artistId, col);
    }
    setNewCaption('');
  }, [newCaption, captions, artistId, niche, db]);

  const handleRemoveCaption = useCallback((idx) => {
    if (!niche) return;
    const updated = captions.filter((_, i) => i !== idx);
    updateNicheCaptionBank(artistId, niche.id, updated);
    if (db) {
      const col = getUserCollections(artistId).find(c => c.id === niche.id);
      if (col) saveCollectionToFirestore(db, artistId, col);
    }
  }, [captions, artistId, niche, db]);

  const handleMoveCaption = useCallback((entry, toNicheId) => {
    if (!niche) return;
    moveNicheBankEntry(artistId, niche.id, toNicheId, entry, 'caption');
    if (db) {
      const cols = getUserCollections(artistId);
      const from = cols.find(c => c.id === niche.id);
      const to = cols.find(c => c.id === toNicheId);
      if (from) saveCollectionToFirestore(db, artistId, from);
      if (to) saveCollectionToFirestore(db, artistId, to);
    }
  }, [artistId, niche, db]);

  const handleAddHashtag = useCallback(() => {
    let text = newHashtag.trim();
    if (!text || !niche) return;
    // Auto-normalize: add # if missing
    if (!text.startsWith('#')) text = '#' + text;
    if (hashtags.includes(text)) return;
    const updated = [...hashtags, text];
    updateNicheHashtagBank(artistId, niche.id, updated);
    if (db) {
      const col = getUserCollections(artistId).find(c => c.id === niche.id);
      if (col) saveCollectionToFirestore(db, artistId, col);
    }
    setNewHashtag('');
  }, [newHashtag, hashtags, artistId, niche, db]);

  const handleRemoveHashtag = useCallback((idx) => {
    if (!niche) return;
    const updated = hashtags.filter((_, i) => i !== idx);
    updateNicheHashtagBank(artistId, niche.id, updated);
    if (db) {
      const col = getUserCollections(artistId).find(c => c.id === niche.id);
      if (col) saveCollectionToFirestore(db, artistId, col);
    }
  }, [hashtags, artistId, niche, db]);

  const handleMoveHashtag = useCallback((entry, toNicheId) => {
    if (!niche) return;
    moveNicheBankEntry(artistId, niche.id, toNicheId, entry, 'hashtag');
    if (db) {
      const cols = getUserCollections(artistId);
      const from = cols.find(c => c.id === niche.id);
      const to = cols.find(c => c.id === toNicheId);
      if (from) saveCollectionToFirestore(db, artistId, from);
      if (to) saveCollectionToFirestore(db, artistId, to);
    }
  }, [artistId, niche, db]);

  const handleCopyAllHashtags = useCallback(() => {
    if (!hashtags.length) return;
    navigator.clipboard.writeText(hashtags.join(' '));
  }, [hashtags]);

  if (!pipeline) return null;

  return (
    <div className="flex items-stretch overflow-hidden flex-1 self-stretch">
      {/* Center — Slide Banks */}
      <div className="flex grow shrink-0 basis-0 items-stretch self-stretch overflow-x-auto gap-3 px-4 py-4">
        {Array.from({ length: slideCount }).map((_, bankIdx) => {
          const label = getPipelineBankLabel(pipeline, bankIdx);
          const headerColor = getBankHeaderColor(label, bankIdx);
          const bankImages = (pipeline.banks?.[bankIdx] || [])
            .map(id => library.find(m => m.id === id))
            .filter(Boolean);
          const textEntries = pipeline.textBanks?.[bankIdx] || [];
          const isDragOver = dragOverBank === bankIdx;

          return (
            <div key={bankIdx} className="flex flex-col gap-2 flex-1 min-w-[150px]">
              {/* Column header */}
              <div
                className="flex w-full flex-none items-center justify-between rounded-t-lg px-3 py-2"
                style={{ backgroundColor: headerColor }}
              >
                <div className="flex items-center gap-2">
                  <IconWithBackground variant={getBankIconVariant(label)} size="small" icon={getBankIcon(label)} square />
                  <span className="text-caption-bold font-caption-bold text-[#ffffffff]">{label}</span>
                </div>
                <Badge variant={getBankBadgeVariant(label)}>{bankImages.length}</Badge>
              </div>

              {/* Images section — capped height, scrolls internally */}
              <div
                className={`flex w-full flex-col items-start gap-2 rounded-b-lg border bg-[#1a1a1aff] px-3 py-3 overflow-hidden transition-colors ${
                  isDragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-solid border-neutral-800'
                }`}
                style={{ height: '45%', minHeight: '120px' }}
                onDragOver={e => { e.preventDefault(); setDragOverBank(bankIdx); }}
                onDragLeave={() => setDragOverBank(null)}
                onDrop={e => handleDrop(bankIdx, e)}
              >
                <div className="flex w-full flex-none items-center justify-between">
                  <span className="text-caption font-caption text-neutral-400">Images</span>
                  <div className="flex items-center gap-1">
                    <span className="text-caption font-caption text-neutral-400 mr-1">{bankImages.length}</span>
                    <button
                      className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                      onClick={() => onImportToBank?.(bankIdx)}
                    >Import</button>
                    <button
                      className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                      onClick={() => onUploadToBank?.(bankIdx)}
                    >Upload</button>
                  </div>
                </div>
                <div className="w-full flex-1 min-h-0 overflow-y-auto">
                  <div className="w-full items-start gap-1.5 grid grid-cols-3">
                    {bankImages.map(item => (
                      <img
                        key={item.id}
                        className="flex-none rounded-sm border-b-2 border-solid aspect-square object-cover w-full"
                        style={{ borderBottomColor: headerColor }}
                        src={item.thumbnailUrl || item.url}
                        alt={item.name}
                        loading="lazy"
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
                  <span className="text-caption font-caption text-neutral-400">{label} Lines</span>
                  <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add text" onClick={() => handleAddText(bankIdx)} />
                </div>
                <div className="flex w-full flex-col items-start gap-1.5 flex-1 min-h-0 overflow-y-auto">
                  {textEntries.map((entry, entryIdx) => {
                    const text = getTextBankText(entry);
                    const style = getTextBankStyle(entry);
                    return (
                      <div key={entryIdx} className="flex w-full items-center gap-2 rounded-md bg-black px-2 py-1.5 flex-none">
                        <FeatherType className="text-caption font-caption flex-none" style={{ color: style?.color || getTextIconColor(label), width: 12, height: 12 }} />
                        <span className="grow text-caption font-caption text-[#ffffffff] truncate">{text}</span>
                        <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />} aria-label="Remove text" onClick={() => handleRemoveText(bankIdx, entryIdx)} />
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
      </div>

      {/* Right — Preview + Generate */}
      <div className="flex w-72 flex-none flex-col items-start self-stretch border-l border-solid border-neutral-800 bg-black overflow-y-auto">
        {/* Preview header */}
        <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 px-4 py-3">
          <span className="text-body-bold font-body-bold text-[#ffffffff]">Preview</span>
          <IconButton variant="neutral-tertiary" size="small" icon={<FeatherRefreshCw />} aria-label="Refresh preview"
            onClick={() => { setPreviewKey(k => k + 1); setPreviewSlideIdx(0); }} />
        </div>

        {/* Preview card */}
        <div className="flex w-full flex-col items-center gap-3 px-4 py-4">
          <div className="flex w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-solid border-neutral-700 bg-black relative aspect-[9/16]">
            {getPreviewImage(previewSlideIdx) ? (
              <img key={previewKey} className="w-full grow shrink-0 basis-0 object-cover absolute" src={getPreviewImage(previewSlideIdx)} alt="Preview" />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FeatherImage className="text-neutral-600" style={{ width: 24, height: 24 }} />
                <span className="text-caption font-caption text-neutral-500">No images yet</span>
              </div>
            )}
            {getPreviewText(previewSlideIdx) && (
              <div className="flex flex-col items-center justify-center px-6 relative z-10">
                <span className="text-heading-2 font-heading-2 text-[#ffffffff] text-center drop-shadow-lg">
                  {getPreviewText(previewSlideIdx)}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {Array.from({ length: slideCount }).map((_, i) => (
              <div
                key={i}
                className="flex h-2 w-2 flex-none items-start rounded-full cursor-pointer"
                style={{
                  backgroundColor: getBankHeaderColor(getPipelineBankLabel(pipeline, i), i),
                  opacity: previewSlideIdx === i ? 1 : 0.3,
                }}
                onClick={() => setPreviewSlideIdx(i)}
              />
            ))}
          </div>
          <span className="text-caption font-caption text-neutral-400">Slide {previewSlideIdx + 1} of {slideCount}</span>
        </div>

        {/* Generate section */}
        <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-4 py-4">
          <span className="text-body-bold font-body-bold text-[#ffffffff]">Create</span>
          <div className="flex w-full items-center justify-between">
            <span className="text-caption font-caption text-neutral-400">Count</span>
            <input
              type="number" min={1} max={50} value={generateCount}
              onChange={e => setGenerateCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-14 rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-2 py-1 text-center text-body font-body text-white outline-none"
            />
          </div>
          <div className="flex w-full items-center justify-between">
            <span className="text-caption font-caption text-neutral-400">Audio</span>
            <div className="flex items-center gap-1.5">
              <FeatherMusic className="text-caption font-caption text-neutral-400" />
              <span className="text-caption font-caption text-[#ffffffff]">{selectedAudio?.name || 'None selected'}</span>
            </div>
          </div>
          <Button className="h-auto w-full flex-none" variant="brand-primary" size="medium" icon={<FeatherPlay />}
            onClick={() => onOpenEditor && onOpenEditor(pipeline, generateCount)}>
            Create {generateCount}
          </Button>
        </div>

        {/* View Drafts row */}
        <div className="flex w-full items-center justify-between border-t border-solid border-neutral-800 px-4 py-3">
          <span className="text-caption font-caption text-neutral-400">{nicheDrafts.length} draft{nicheDrafts.length !== 1 ? 's' : ''} created</span>
          <Button className="h-auto w-auto flex-none" variant="neutral-tertiary" size="small" iconRight={<FeatherArrowRight />}
            onClick={() => onViewDrafts && onViewDrafts(pipeline)}>
            View Drafts
          </Button>
        </div>

        {/* Captions & Hashtags */}
        <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-4 py-3">
          {/* Captions */}
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <FeatherMessageSquare className="text-neutral-400" style={{ width: 12, height: 12 }} />
              <span className="text-caption-bold font-caption-bold text-neutral-300">Captions</span>
              <Badge variant="neutral">{captions.length}</Badge>
            </div>
            {captions.length > 0 && (
              <div className="flex flex-col gap-1.5 max-h-[120px] overflow-y-auto">
                {captions.map((cap, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-md bg-black px-2.5 py-1.5 group">
                    <span
                      className="grow text-caption font-caption text-neutral-300 cursor-pointer hover:text-white line-clamp-2"
                      title="Click to copy"
                      onClick={() => navigator.clipboard.writeText(cap)}
                    >{cap}</span>
                    <div className="flex items-center gap-1 flex-none opacity-0 group-hover:opacity-100 transition-opacity">
                      {otherNiches.length > 0 && (
                        <select
                          className="bg-neutral-800 text-caption text-neutral-300 border-none rounded px-1 py-0.5 cursor-pointer outline-none"
                          value=""
                          onChange={e => { if (e.target.value) handleMoveCaption(cap, e.target.value); }}
                        >
                          <option value="" disabled>Move to...</option>
                          {otherNiches.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                        </select>
                      )}
                      <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0" onClick={() => handleRemoveCaption(idx)}>
                        <FeatherTrash2 style={{ width: 12, height: 12 }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex w-full gap-2">
              <textarea
                className="flex-1 min-h-[32px] max-h-[64px] rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500 resize-none"
                placeholder="Add caption..."
                value={newCaption}
                onChange={e => setNewCaption(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddCaption(); } }}
                rows={1}
              />
              <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add caption" onClick={handleAddCaption} />
            </div>
          </div>

          {/* Hashtags */}
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <FeatherHash className="text-neutral-400" style={{ width: 12, height: 12 }} />
              <span className="text-caption-bold font-caption-bold text-neutral-300">Hashtags</span>
              <Badge variant="neutral">{hashtags.length}</Badge>
              {hashtags.length > 0 && (
                <button className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-auto" onClick={handleCopyAllHashtags}>
                  Copy All
                </button>
              )}
            </div>
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
                {hashtags.map((tag, idx) => (
                  <div key={idx} className="flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-0.5 group">
                    <span className="text-caption font-caption text-indigo-300">{tag}</span>
                    <button className="text-indigo-400 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveHashtag(idx)}>
                      <FeatherX style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex w-full gap-2">
              <input
                className="flex-1 rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
                placeholder="#hashtag"
                value={newHashtag}
                onChange={e => setNewHashtag(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddHashtag(); }}
              />
              <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add hashtag" onClick={handleAddHashtag} />
            </div>
          </div>
        </div>

        {/* Lyrics section */}
        <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-4 py-3">
          <div className="flex w-full items-center justify-between">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Lyrics</span>
            <Badge variant="neutral">
              {(pipeline.textBanks || []).reduce((sum, bank) => sum + (bank?.length || 0), 0)} saved
            </Badge>
          </div>
          <textarea
            className="flex h-20 w-full flex-none items-start rounded-md border border-solid border-neutral-800 bg-black px-3 py-2 text-body font-body text-white outline-none placeholder-neutral-500 resize-none"
            placeholder="Paste lyrics..." value={lyricsText} onChange={e => setLyricsText(e.target.value)}
          />
          <Button className="h-auto w-full flex-none" variant="neutral-secondary" size="small" icon={<FeatherDatabase />} onClick={handleLoadFromBanks}>
            Load from Bank
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SlideshowNicheContent;
