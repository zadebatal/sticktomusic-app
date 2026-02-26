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
  FeatherX, FeatherUpload, FeatherDownloadCloud,
  FeatherMusic, FeatherCheck,
} from '@subframe/core';
import {
  updateNicheAudioId,
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
  library = [],
  createdContent,
  projectAudio = [],
  onMakeVideo,
  onUpload,
  onImport,
}) => {
  const activeFormat = niche?.formats?.find(f => f.id === niche.activeFormatId) || niche?.formats?.[0];
  const [collapsedBuckets, setCollapsedBuckets] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);

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

  // Per-niche audio selection
  const selectedAudio = useMemo(
    () => projectAudio.find(a => a.id === niche?.audioId) || projectAudio[0] || null,
    [projectAudio, niche?.audioId]
  );

  const handleSelectAudio = useCallback((audioId) => {
    if (!niche) return;
    updateNicheAudioId(artistId, niche.id, audioId, db);
    setAudioPickerOpen(false);
  }, [artistId, niche, db]);

  // Niche videos (from bank)
  const nicheVideos = useMemo(() => {
    if (!niche) return [];
    return library.filter(item => (niche.mediaIds || []).includes(item.id) && item.type === 'video');
  }, [niche, library]);

  if (!niche || !activeFormat) return null;

  return (
    <div className="flex flex-1 flex-col items-center self-stretch overflow-y-auto">
      {/* Hero — Create / Upload / Import */}
      {nicheVideos.length === 0 ? (
        <div className="flex w-full flex-col items-center gap-6 px-12 py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/30">
              <FeatherScissors className="text-rose-400" style={{ width: 28, height: 28 }} />
            </div>
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Clipper</span>
            <span className="text-body font-body text-neutral-400 text-center max-w-sm">
              Add a source video to split into multiple clips
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="brand-primary" size="large" icon={<FeatherUpload />} onClick={onUpload}>
              Upload Video
            </Button>
            <Button variant="neutral-secondary" size="large" icon={<FeatherDownloadCloud />} onClick={onImport}>
              Import from Library
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-3 px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-body-bold font-body-bold text-[#ffffffff]">Source Videos</span>
              <Badge variant="neutral">{nicheVideos.length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="brand-tertiary" size="small" icon={<FeatherUpload />} onClick={onUpload}>Upload</Button>
              <Button variant="neutral-tertiary" size="small" icon={<FeatherDownloadCloud />} onClick={onImport}>Import</Button>
              <Button variant="brand-primary" size="small" icon={<FeatherScissors />}
                onClick={() => onMakeVideo && onMakeVideo(activeFormat, niche.id, null, null, nicheVideos)}>
                Create Clipper
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {nicheVideos.map(v => (
              <div key={v.id} className="relative group rounded-lg overflow-hidden bg-neutral-800 aspect-video cursor-pointer border border-neutral-700 hover:border-indigo-500/50 transition-colors"
                onClick={() => setPreviewUrl(v.url)}>
                {v.thumbnailUrl || v.thumbnail ? (
                  <img src={v.thumbnailUrl || v.thumbnail} alt={v.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FeatherPlay className="text-neutral-500" style={{ width: 24, height: 24 }} />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 px-2 py-1">
                  <span className="text-[11px] text-neutral-300 line-clamp-1">{v.name || 'Video'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  onClick={() => onMakeVideo && onMakeVideo(activeFormat, niche.id, draft, null, nicheVideos)}
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

      {/* Audio picker */}
      <div className="flex w-full flex-col gap-2 border-t border-solid border-neutral-800 px-12 py-4">
        <span className="text-caption-bold font-caption-bold text-neutral-300">Audio</span>
        <div className="relative max-w-sm">
          <button
            className="flex w-full items-center gap-2 rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-3 py-2 hover:bg-[#262626] transition"
            onClick={() => setAudioPickerOpen(!audioPickerOpen)}
          >
            <FeatherMusic className="text-indigo-400 flex-none" style={{ width: 14, height: 14 }} />
            <span className="text-caption font-caption text-[#ffffffff] truncate grow text-left">
              {selectedAudio?.name || 'No audio'}
            </span>
            <FeatherChevronDown
              className="text-neutral-400 flex-none transition-transform"
              style={{ width: 14, height: 14, transform: audioPickerOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          {audioPickerOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 flex flex-col gap-0.5 px-2 py-2 bg-[#111111] border border-neutral-700 rounded-lg max-h-48 overflow-y-auto shadow-xl z-20">
              {projectAudio.length === 0 && (
                <span className="text-caption font-caption text-neutral-500 px-2 py-1">No audio uploaded</span>
              )}
              {projectAudio.map(audio => {
                const isActive = selectedAudio?.id === audio.id;
                return (
                  <button
                    key={audio.id}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                      isActive ? 'bg-indigo-600' : 'hover:bg-neutral-800'
                    }`}
                    onClick={() => handleSelectAudio(audio.id)}
                  >
                    <FeatherPlay className="text-neutral-300 flex-none" style={{ width: 10, height: 10 }} />
                    <span className="text-caption font-caption text-[#ffffffff] truncate grow">{audio.name}</span>
                    {isActive && <FeatherCheck className="text-indigo-300 flex-none" style={{ width: 12, height: 12 }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default ClipperNicheContent;
