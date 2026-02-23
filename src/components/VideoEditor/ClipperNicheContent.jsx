/**
 * ClipperNicheContent — Clip bucket display for clipper niches
 * Shows saved clip buckets from clipper sessions, create button, captions/hashtags
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlay, FeatherScissors, FeatherChevronDown, FeatherChevronRight,
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

const BUCKET_COLORS = [
  { dot: '#6366f1', bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.25)' },
  { dot: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.25)' },
  { dot: '#a855f7', bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.25)' },
  { dot: '#f43f5e', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.25)' },
  { dot: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  { dot: '#06b6d4', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.25)' },
];
const getBucketColor = (index) => BUCKET_COLORS[index % BUCKET_COLORS.length];

const formatTimePrecise = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
};

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const ClipperNicheContent = ({
  db,
  artistId,
  niche,
  createdContent,
  onMakeVideo,
  allNiches = [],
}) => {
  const activeFormat = niche?.formats?.find(f => f.id === niche.activeFormatId) || niche?.formats?.[0];
  const [collapsedBuckets, setCollapsedBuckets] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [newCaption, setNewCaption] = useState('');
  const [newHashtag, setNewHashtag] = useState('');

  // All clipper drafts for this niche
  const clipperDrafts = useMemo(() =>
    (createdContent?.videos || []).filter(v =>
      v.collectionId === niche?.id && v.editorMode === 'clipper'
    ),
    [createdContent, niche?.id]
  );

  // Collect all buckets and clips across all drafts
  const { allBuckets, clipsByBucket, totalClips } = useMemo(() => {
    const bucketSet = new Set();
    const clipMap = {};
    let total = 0;

    for (const draft of clipperDrafts) {
      (draft.buckets || []).forEach(b => bucketSet.add(b));
      (draft.clips || []).forEach(clip => {
        const bucket = clip.bucket || 'Bucket 1';
        bucketSet.add(bucket);
        if (!clipMap[bucket]) clipMap[bucket] = [];
        clipMap[bucket].push({
          ...clip,
          draftId: draft.id,
          draftName: draft.name,
          sourceName: draft.sourceName,
        });
        total++;
      });
    }

    return { allBuckets: Array.from(bucketSet), clipsByBucket: clipMap, totalClips: total };
  }, [clipperDrafts]);

  const toggleBucket = useCallback((name) => {
    setCollapsedBuckets(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  // Captions & Hashtags
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
      {/* Create button */}
      <div className="flex w-full flex-col items-center gap-6 px-12 py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/30">
            <FeatherScissors className="text-rose-400" style={{ width: 28, height: 28 }} />
          </div>
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Clipper</span>
          <span className="text-body font-body text-neutral-400 text-center max-w-sm">
            Split a video into multiple clips
          </span>
        </div>
        <Button variant="brand-primary" size="large" icon={<FeatherScissors />}
          onClick={() => onMakeVideo && onMakeVideo(activeFormat, niche.id)}>
          Create Clipper
        </Button>
      </div>

      {/* Clip Buckets */}
      {totalClips > 0 && (
        <div className="flex w-full flex-col gap-4 px-12 pb-6">
          <div className="flex items-center gap-2">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Clip Buckets</span>
            <Badge variant="neutral">{totalClips} clip{totalClips !== 1 ? 's' : ''}</Badge>
          </div>

          {allBuckets.map((bucketName, bIdx) => {
            const clips = clipsByBucket[bucketName] || [];
            if (clips.length === 0) return null;
            const color = getBucketColor(bIdx);
            const isCollapsed = collapsedBuckets[bucketName];

            return (
              <div key={bucketName} className="flex flex-col rounded-lg border border-neutral-800 overflow-hidden">
                {/* Bucket header */}
                <div
                  className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-neutral-800/30 transition-colors"
                  style={{ backgroundColor: color.bg, borderBottom: `1px solid ${color.border}` }}
                  onClick={() => toggleBucket(bucketName)}
                >
                  {isCollapsed
                    ? <FeatherChevronRight className="text-neutral-400 flex-none" style={{ width: 16, height: 16 }} />
                    : <FeatherChevronDown className="text-neutral-400 flex-none" style={{ width: 16, height: 16 }} />
                  }
                  <div className="w-3 h-3 rounded-full flex-none" style={{ backgroundColor: color.dot }} />
                  <span className="text-body-bold font-body-bold text-white flex-1">{bucketName}</span>
                  <Badge variant="neutral">{clips.length}</Badge>
                </div>

                {/* Clips in bucket */}
                {!isCollapsed && (
                  <div className="flex flex-col">
                    {clips.map((clip, i) => (
                      <div
                        key={clip.id || `${clip.draftId}_${i}`}
                        className="flex items-center gap-3 px-4 py-2.5 border-t border-neutral-800/50 hover:bg-neutral-800/20 transition-colors"
                      >
                        {/* Play button */}
                        {clip.cloudUrl ? (
                          <button
                            className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-800 hover:bg-neutral-700 transition-colors flex-none"
                            onClick={() => setPreviewUrl(previewUrl === clip.cloudUrl ? null : clip.cloudUrl)}
                          >
                            <FeatherPlay className="text-white" style={{ width: 14, height: 14 }} />
                          </button>
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-900 flex-none">
                            <FeatherScissors className="text-neutral-600" style={{ width: 14, height: 14 }} />
                          </div>
                        )}

                        {/* Clip info */}
                        <div className="flex flex-col gap-0 flex-1 min-w-0">
                          <span className="text-sm text-white truncate">{clip.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-neutral-500">
                              {formatTimePrecise(clip.start)} → {formatTimePrecise(clip.end)}
                            </span>
                            <Badge variant="neutral">{formatTime(clip.duration)}</Badge>
                            {clip.cloudUrl && <Badge variant="success">Exported</Badge>}
                          </div>
                        </div>

                        {/* Source */}
                        {clip.sourceName && (
                          <span className="text-[10px] text-neutral-600 truncate max-w-[100px]" title={clip.sourceName}>
                            {clip.sourceName}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Video preview overlay */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreviewUrl(null)}>
          <div className="relative max-w-2xl max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <video src={previewUrl} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />
            <button
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/80 flex items-center justify-center hover:bg-black transition-colors"
              onClick={() => setPreviewUrl(null)}
            >
              <FeatherX className="text-white" style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      )}

      {/* Sessions (re-open clipper drafts) */}
      {clipperDrafts.length > 0 && (
        <div className="flex w-full flex-col gap-4 px-12 pb-6">
          <div className="flex items-center gap-2">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Sessions</span>
            <Badge variant="neutral">{clipperDrafts.length}</Badge>
          </div>
          <div className="grid w-full grid-cols-4 gap-3">
            {clipperDrafts
              .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
              .map(draft => (
                <div
                  key={draft.id}
                  className="flex flex-col items-start gap-2 rounded-lg border border-neutral-800 bg-[#1a1a1aff] overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors"
                  onClick={() => onMakeVideo && onMakeVideo(activeFormat, niche.id, draft)}
                >
                  <div className="w-full aspect-video bg-[#171717] flex items-center justify-center">
                    <FeatherScissors className="text-neutral-700" style={{ width: 24, height: 24 }} />
                  </div>
                  <div className="flex w-full flex-col gap-0.5 px-3 pb-3">
                    <span className="text-caption font-caption text-neutral-300 truncate">{draft.name || 'Untitled'}</span>
                    <span className="text-[10px] text-neutral-500">
                      {(draft.clips || []).length} clips · {(draft.buckets || []).length} bucket{(draft.buckets || []).length !== 1 ? 's' : ''}
                    </span>
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
                <div key={idx} className="flex items-start gap-2 rounded-md bg-[#1a1a1aff] border border-neutral-800 px-3 py-1.5 group">
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
              className="flex-1 min-h-[32px] max-h-[64px] rounded-md border border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500 resize-none"
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
              <button className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-auto"
                onClick={handleCopyAllHashtags}>Copy All</button>
            )}
          </div>
          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
              {hashtags.map((tag, idx) => (
                <div key={idx} className="flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-0.5 group">
                  <span className="text-caption font-caption text-indigo-300">{tag}</span>
                  <button className="text-indigo-400 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRemoveHashtag(idx)}>
                    <FeatherX style={{ width: 10, height: 10 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex w-full gap-2">
            <input
              className="flex-1 rounded-md border border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
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

export default ClipperNicheContent;
