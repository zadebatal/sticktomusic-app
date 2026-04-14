/**
 * ClipperNicheContent — Clip bank display for clipper niches
 * Shows saved clipper sessions from niche, exported clips by bank, create button, audio picker
 */

import {
  FeatherChevronDown,
  FeatherChevronRight,
  FeatherDatabase,
  FeatherDownloadCloud,
  FeatherPlay,
  FeatherScissors,
  FeatherUpload,
  FeatherX,
} from '@subframe/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteClipperSession,
  getBankColor,
  getPipelineBankLabel,
  removeFromCollection,
  updateLibraryItemAsync,
} from '../../services/libraryService';
import { Badge } from '../../ui/components/Badge';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import log from '../../utils/logger';

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
  projectMedia = [],
  onMakeVideo,
  onUpload,
  onImport,
}) => {
  const activeFormat =
    niche?.formats?.find((f) => f.id === niche.activeFormatId) || niche?.formats?.[0];
  const [collapsedBanks, setCollapsedBanks] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [renamingClipId, setRenamingClipId] = useState(null);

  // Clipper sessions stored on the niche (replaces draft-based sessions)
  const clipperSessions = useMemo(
    () =>
      (niche?.clipperSessions || []).sort((a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || ''),
      ),
    [niche?.clipperSessions],
  );

  // Exported clips from niche media bank (first-class library items)
  const exportedClips = useMemo(() => {
    if (!niche) return [];
    return library.filter((item) => (niche.mediaIds || []).includes(item.id) && item.isClipperClip);
  }, [niche, library]);

  // Group exported clips by bankIndex
  const { bankIndices, clipsByBank, totalClips } = useMemo(() => {
    const bankSet = new Set();
    const clipMap = {};

    for (const clip of exportedClips) {
      const bankIdx = typeof clip.bankIndex === 'number' ? clip.bankIndex : 0;
      bankSet.add(bankIdx);
      if (!clipMap[bankIdx]) clipMap[bankIdx] = [];
      clipMap[bankIdx].push(clip);
    }

    return {
      bankIndices: Array.from(bankSet).sort((a, b) => a - b),
      clipsByBank: clipMap,
      totalClips: exportedClips.length,
    };
  }, [exportedClips]);

  const toggleBank = useCallback((bankIdx) => {
    setCollapsedBanks((prev) => ({ ...prev, [bankIdx]: !prev[bankIdx] }));
  }, []);

  // Niche videos (from bank)
  const nicheVideos = useMemo(() => {
    if (!niche) return [];
    return library.filter(
      (item) => (niche.mediaIds || []).includes(item.id) && item.type === 'video',
    );
  }, [niche, library]);

  // Prefetch source videos so they're in browser cache when Clipper opens
  useEffect(() => {
    if (nicheVideos.length === 0) return;
    const controller = new AbortController();
    const url = nicheVideos[0]?.url || nicheVideos[0]?.cloudUrl;
    if (!url || url.startsWith('blob:')) return;
    fetch(url, { mode: 'cors', signal: controller.signal })
      .then((r) => r.blob())
      .then((blob) =>
        log.info(`[ClipperNiche] Prefetched video: ${(blob.size / 1024 / 1024).toFixed(1)}MB`),
      )
      .catch(() => {}); // ignore abort/network errors
    return () => controller.abort();
  }, [nicheVideos]);

  // Project pool videos NOT in this niche
  const [poolExpanded, setPoolExpanded] = useState(false);
  const poolOnlyVideos = useMemo(() => {
    if (!niche || !projectMedia.length) return [];
    const nicheIds = new Set(niche.mediaIds || []);
    return projectMedia.filter((m) => !nicheIds.has(m.id) && m.type === 'video');
  }, [niche, projectMedia]);

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
            <Button
              variant="brand-primary"
              size="large"
              icon={<FeatherUpload />}
              onClick={onUpload}
            >
              Upload Video
            </Button>
            <Button
              variant="neutral-secondary"
              size="large"
              icon={<FeatherDownloadCloud />}
              onClick={onImport}
            >
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
              <Button
                variant="brand-tertiary"
                size="small"
                icon={<FeatherUpload />}
                onClick={onUpload}
              >
                Upload
              </Button>
              <Button
                variant="neutral-tertiary"
                size="small"
                icon={<FeatherDownloadCloud />}
                onClick={onImport}
              >
                Import
              </Button>
              <Button
                variant="brand-primary"
                size="small"
                icon={<FeatherScissors />}
                onClick={() =>
                  onMakeVideo && onMakeVideo(activeFormat, niche.id, null, null, nicheVideos)
                }
              >
                Create Clipper
              </Button>
            </div>
          </div>
          <div
            className="w-full overflow-y-auto rounded-lg border border-solid border-neutral-200 bg-[#111118] p-2"
            style={{ maxHeight: 280 }}
          >
            <div className="grid w-full grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
              {nicheVideos.map((v) => (
                <div
                  key={v.id}
                  className="relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group"
                  onClick={() => setPreviewUrl(v.url)}
                >
                  {v.thumbnailUrl || v.thumbnail ? (
                    <img
                      src={v.thumbnailUrl || v.thumbnail}
                      alt={v.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FeatherPlay className="text-neutral-600" style={{ width: 16, height: 16 }} />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 border border-white/20">
                      <FeatherPlay className="text-white" style={{ width: 8, height: 8 }} />
                    </div>
                  </div>
                  <button
                    className="absolute top-0.5 right-0.5 z-[4] flex h-4 w-4 items-center justify-center rounded-full bg-black/70 border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/90"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromCollection(artistId, niche.id, [v.id], db);
                    }}
                    title="Remove from niche"
                  >
                    <FeatherX className="text-white" style={{ width: 8, height: 8 }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Clip Banks */}
      {totalClips > 0 && (
        <div className="flex w-full flex-col gap-4 px-12 pb-6">
          <div className="flex items-center gap-2">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Clip Banks</span>
            <Badge variant="neutral">
              {totalClips} clip{totalClips !== 1 ? 's' : ''}
            </Badge>
          </div>

          {bankIndices.map((bankIdx) => {
            const clips = clipsByBank[bankIdx] || [];
            if (clips.length === 0) return null;
            const color = getBankColor(bankIdx);
            const bankLabel = getPipelineBankLabel(niche, bankIdx);
            const isCollapsed = collapsedBanks[bankIdx];

            return (
              <div
                key={bankIdx}
                className="flex flex-col rounded-lg border border-neutral-200 overflow-hidden"
              >
                {/* Bank header */}
                <div
                  className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-neutral-100/30 transition-colors"
                  style={{ backgroundColor: color.bg, borderBottom: `1px solid ${color.border}` }}
                  onClick={() => toggleBank(bankIdx)}
                >
                  {isCollapsed ? (
                    <FeatherChevronRight
                      className="text-neutral-400 flex-none"
                      style={{ width: 16, height: 16 }}
                    />
                  ) : (
                    <FeatherChevronDown
                      className="text-neutral-400 flex-none"
                      style={{ width: 16, height: 16 }}
                    />
                  )}
                  <div
                    className="w-3 h-3 rounded-full flex-none"
                    style={{ backgroundColor: color.primary }}
                  />
                  <span className="text-body-bold font-body-bold text-white flex-1">
                    {bankLabel}
                  </span>
                  <Badge variant="neutral">{clips.length}</Badge>
                </div>

                {/* Clips in bank */}
                {!isCollapsed && (
                  <div className="flex flex-col">
                    {clips.map((clip, i) => (
                      <div
                        key={clip.id || i}
                        className="flex items-center gap-3 px-4 py-2.5 border-t border-neutral-200/50 hover:bg-neutral-100/20 transition-colors"
                      >
                        {/* Play button */}
                        {clip.url ? (
                          <button
                            className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 hover:bg-neutral-200 transition-colors flex-none"
                            onClick={() => setPreviewUrl(previewUrl === clip.url ? null : clip.url)}
                          >
                            <FeatherPlay className="text-white" style={{ width: 14, height: 14 }} />
                          </button>
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-50 flex-none">
                            <FeatherScissors
                              className="text-neutral-600"
                              style={{ width: 14, height: 14 }}
                            />
                          </div>
                        )}

                        {/* Clip info */}
                        <div className="flex flex-col gap-0 flex-1 min-w-0">
                          {renamingClipId === clip.id ? (
                            <input
                              autoFocus
                              className="bg-transparent text-sm text-white outline-none w-full border-b border-indigo-500 pb-0.5"
                              defaultValue={clip.name}
                              onBlur={(e) => {
                                const newName = e.target.value.trim();
                                if (newName && newName !== clip.name) {
                                  updateLibraryItemAsync(db, artistId, clip.id, { name: newName });
                                }
                                setRenamingClipId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.target.blur();
                                if (e.key === 'Escape') setRenamingClipId(null);
                              }}
                            />
                          ) : (
                            <span
                              className="text-sm text-white truncate cursor-pointer hover:text-indigo-300 transition-colors"
                              onDoubleClick={() => setRenamingClipId(clip.id)}
                              title="Double-click to rename"
                            >
                              {clip.name}
                            </span>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-neutral-500">
                              {formatTimePrecise(clip.sourceStart)} →{' '}
                              {formatTimePrecise(clip.sourceEnd)}
                            </span>
                            <Badge variant="neutral">{formatTime(clip.duration)}</Badge>
                          </div>
                        </div>

                        {/* Source */}
                        {clip.sourceVideoName && (
                          <span
                            className="text-[10px] text-neutral-600 truncate max-w-[100px]"
                            title={clip.sourceVideoName}
                          >
                            {clip.sourceVideoName}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-2xl max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <video
              src={previewUrl}
              controls
              autoPlay
              className="max-w-full max-h-[80vh] rounded-lg"
            />
            <button
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/80 flex items-center justify-center hover:bg-black transition-colors"
              onClick={() => setPreviewUrl(null)}
            >
              <FeatherX className="text-white" style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      )}

      {/* Sessions (re-open clipper sessions) */}
      {clipperSessions.length > 0 && (
        <div className="flex w-full flex-col gap-4 px-12 pb-6">
          <div className="flex items-center gap-2">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Sessions</span>
            <Badge variant="neutral">{clipperSessions.length}</Badge>
          </div>
          <div className="grid w-full grid-cols-4 gap-3">
            {clipperSessions.map((session) => {
              const clipCount = (session.clips || []).length;
              const exportedCount = (session.clips || []).filter(
                (c) => c.exported || c.exportedMediaId,
              ).length;
              return (
                <div
                  key={session.id}
                  className="relative group flex flex-col items-start gap-2 rounded-lg border border-neutral-200 bg-[#1a1a1aff] overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors"
                  onClick={() =>
                    onMakeVideo && onMakeVideo(activeFormat, niche.id, session, null, nicheVideos)
                  }
                >
                  <button
                    className="absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/90"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteClipperSession(artistId, niche.id, session.id, db);
                    }}
                    title="Delete session"
                  >
                    <FeatherX className="text-white" style={{ width: 10, height: 10 }} />
                  </button>
                  <div className="w-full aspect-video bg-[#171717] flex items-center justify-center">
                    <FeatherScissors
                      className="text-neutral-700"
                      style={{ width: 24, height: 24 }}
                    />
                  </div>
                  <div className="flex w-full flex-col gap-0.5 px-3 pb-3">
                    <span className="text-caption font-caption text-neutral-300 truncate">
                      {session.name || 'Untitled'}
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      {clipCount} clip{clipCount !== 1 ? 's' : ''}
                      {exportedCount > 0 && (
                        <>
                          {' '}
                          · <span className="text-green-500">{exportedCount} exported</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* From Project Pool — videos in project but not in this niche */}
      {poolOnlyVideos.length > 0 && (
        <div className="flex w-full flex-col gap-3 border-t border-neutral-200 px-12 py-4">
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
            <Badge variant="neutral">{poolOnlyVideos.length}</Badge>
          </button>
          {poolExpanded && (
            <div
              className="w-full overflow-y-auto rounded-lg border border-solid border-neutral-200 bg-[#111118] p-2"
              style={{ maxHeight: 280 }}
            >
              <div className="grid w-full grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
                {poolOnlyVideos.map((v) => (
                  <div
                    key={v.id}
                    className="relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group"
                    onClick={() => setPreviewUrl(v.url)}
                  >
                    {v.thumbnailUrl || v.thumbnail ? (
                      <img
                        src={v.thumbnailUrl || v.thumbnail}
                        alt={v.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <FeatherPlay
                          className="text-neutral-600"
                          style={{ width: 16, height: 16 }}
                        />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 border border-white/20">
                        <FeatherPlay className="text-white" style={{ width: 8, height: 8 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClipperNicheContent;
