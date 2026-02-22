/**
 * VideoNicheContent — "Create [Format]" button + draft grid for video niches
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlay, FeatherImage, FeatherFilm, FeatherLayers, FeatherCamera,
  FeatherHash, FeatherMessageSquare, FeatherPlus, FeatherX,
  FeatherTrash2,
} from '@subframe/core';
import {
  updateNicheCaptionBank,
  updateNicheHashtagBank,
  moveNicheBankEntry,
  getUserCollections,
  saveCollectionToFirestore,
} from '../../services/libraryService';

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
  createdContent,
  onMakeVideo,
  allNiches = [],
}) => {
  const activeFormat = niche?.formats?.find(f => f.id === niche.activeFormatId) || niche?.formats?.[0];
  const IconComponent = FORMAT_ICONS[activeFormat?.id] || FeatherPlay;
  const [newCaption, setNewCaption] = useState('');
  const [newHashtag, setNewHashtag] = useState('');

  // Drafts for this niche
  const nicheDrafts = useMemo(() =>
    (createdContent?.videos || []).filter(v => v.collectionId === niche?.id),
    [createdContent, niche?.id]
  );

  const captions = niche?.captionBank || [];
  const hashtags = niche?.hashtagBank || [];
  const otherNiches = (allNiches || []).filter(n => n.id !== niche?.id);

  const syncToFirestore = useCallback((nicheId) => {
    if (!db || !artistId) return;
    const col = getUserCollections(artistId).find(c => c.id === nicheId);
    if (col) saveCollectionToFirestore(db, artistId, col);
  }, [db, artistId]);

  const handleAddCaption = useCallback(() => {
    const text = newCaption.trim();
    if (!text || !niche) return;
    updateNicheCaptionBank(artistId, niche.id, [...captions, text]);
    syncToFirestore(niche.id);
    setNewCaption('');
  }, [newCaption, captions, artistId, niche, syncToFirestore]);

  const handleRemoveCaption = useCallback((idx) => {
    if (!niche) return;
    updateNicheCaptionBank(artistId, niche.id, captions.filter((_, i) => i !== idx));
    syncToFirestore(niche.id);
  }, [captions, artistId, niche, syncToFirestore]);

  const handleMoveCaption = useCallback((entry, toNicheId) => {
    if (!niche) return;
    moveNicheBankEntry(artistId, niche.id, toNicheId, entry, 'caption');
    syncToFirestore(niche.id);
    syncToFirestore(toNicheId);
  }, [artistId, niche, syncToFirestore]);

  const handleAddHashtag = useCallback(() => {
    let text = newHashtag.trim();
    if (!text || !niche) return;
    if (!text.startsWith('#')) text = '#' + text;
    if (hashtags.includes(text)) return;
    updateNicheHashtagBank(artistId, niche.id, [...hashtags, text]);
    syncToFirestore(niche.id);
    setNewHashtag('');
  }, [newHashtag, hashtags, artistId, niche, syncToFirestore]);

  const handleRemoveHashtag = useCallback((idx) => {
    if (!niche) return;
    updateNicheHashtagBank(artistId, niche.id, hashtags.filter((_, i) => i !== idx));
    syncToFirestore(niche.id);
  }, [hashtags, artistId, niche, syncToFirestore]);

  const handleMoveHashtag = useCallback((entry, toNicheId) => {
    if (!niche) return;
    moveNicheBankEntry(artistId, niche.id, toNicheId, entry, 'hashtag');
    syncToFirestore(niche.id);
    syncToFirestore(toNicheId);
  }, [artistId, niche, syncToFirestore]);

  const handleCopyAllHashtags = useCallback(() => {
    if (!hashtags.length) return;
    navigator.clipboard.writeText(hashtags.join(' '));
  }, [hashtags]);

  if (!niche || !activeFormat) return null;

  return (
    <div className="flex flex-1 flex-col items-center self-stretch overflow-y-auto">
      {/* Create button area */}
      <div className="flex w-full flex-col items-center gap-6 px-12 py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/30">
            <IconComponent className="text-indigo-400" style={{ width: 28, height: 28 }} />
          </div>
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{activeFormat.name}</span>
          {activeFormat.description && (
            <span className="text-body font-body text-neutral-400 text-center max-w-sm">{activeFormat.description}</span>
          )}
        </div>
        <Button variant="brand-primary" size="large" icon={<FeatherPlay />}
          onClick={() => onMakeVideo && onMakeVideo(activeFormat, niche.id)}>
          Create {activeFormat.name}
        </Button>
      </div>

      {/* Draft grid */}
      {nicheDrafts.length > 0 && (
        <div className="flex w-full flex-col gap-4 px-12 pb-6">
          <div className="flex items-center gap-2">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Drafts</span>
            <Badge variant="neutral">{nicheDrafts.length}</Badge>
          </div>
          <div className="grid w-full grid-cols-4 gap-3">
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

      {/* Captions & Hashtags */}
      <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-12 py-4">
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
                <div key={idx} className="flex items-start gap-2 rounded-md bg-[#1a1a1aff] border border-solid border-neutral-800 px-3 py-1.5 group">
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
            <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add" onClick={handleAddCaption} />
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
            <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add" onClick={handleAddHashtag} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoNicheContent;
