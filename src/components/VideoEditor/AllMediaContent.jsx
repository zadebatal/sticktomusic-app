/**
 * AllMediaContent — Full-width tab content replacing the old sidebar.
 * Shows project media grid (images + videos + audio) with search, scope toggle, upload/import.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import {
  FeatherUpload, FeatherDownloadCloud, FeatherImage, FeatherMusic,
  FeatherPlay, FeatherX, FeatherSearch, FeatherFilm,
} from '@subframe/core';
import { MEDIA_TYPES } from '../../services/libraryService';

const AllMediaContent = ({
  projectMedia,
  library,
  activeNicheId,
  activeNiche,
  onUpload,
  onImport,
  isUploading,
  uploadProgress,
}) => {
  const [mediaScope, setMediaScope] = useState('all');
  const [mediaSearch, setMediaSearch] = useState('');
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);

  // Scoped media
  const nicheMedia = useMemo(() => {
    if (!activeNiche) return [];
    return library.filter(item => (activeNiche.mediaIds || []).includes(item.id));
  }, [activeNiche, library]);

  const scopedMedia = mediaScope === 'niche' ? nicheMedia : projectMedia;
  const scopedImages = useMemo(() => scopedMedia.filter(m => m.type === 'image'), [scopedMedia]);
  const scopedVideos = useMemo(() => scopedMedia.filter(m => m.type === 'video'), [scopedMedia]);

  const filteredImages = useMemo(() => {
    if (!mediaSearch.trim()) return scopedImages;
    const q = mediaSearch.toLowerCase();
    return scopedImages.filter(m => (m.name || '').toLowerCase().includes(q));
  }, [scopedImages, mediaSearch]);

  const filteredVideos = useMemo(() => {
    if (!mediaSearch.trim()) return scopedVideos;
    const q = mediaSearch.toLowerCase();
    return scopedVideos.filter(m => (m.name || '').toLowerCase().includes(q));
  }, [scopedVideos, mediaSearch]);

  const projectAudio = useMemo(() => projectMedia.filter(m => m.type === 'audio'), [projectMedia]);

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-1 flex-col items-start self-stretch overflow-y-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between px-8 py-4 border-b border-solid border-neutral-800">
        <div className="flex items-center gap-3">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">All Media</span>
          <Badge variant="neutral">{scopedImages.length} images</Badge>
          <Badge variant="neutral">{scopedVideos.length} videos</Badge>
          <Badge variant="neutral">{projectAudio.length} audio</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="neutral-secondary" size="small" icon={<FeatherUpload />} onClick={onUpload}>
            Upload
          </Button>
          <Button variant="neutral-secondary" size="small" icon={<FeatherDownloadCloud />} onClick={onImport}>
            Import
          </Button>
        </div>
      </div>

      {/* Search + scope */}
      <div className="flex w-full items-center gap-4 px-8 py-3">
        <div className="flex items-center gap-2 flex-1 rounded-md border border-solid border-neutral-800 bg-black px-3 py-1.5">
          <FeatherSearch className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
          <input
            className="w-full bg-transparent text-body font-body text-white placeholder-neutral-500 outline-none"
            placeholder="Search media..."
            value={mediaSearch}
            onChange={e => setMediaSearch(e.target.value)}
          />
          {mediaSearch && (
            <button className="text-neutral-500 hover:text-white flex-none bg-transparent border-none cursor-pointer" onClick={() => setMediaSearch('')}>
              <FeatherX style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>
        {activeNicheId && (
          <ToggleGroup value={mediaScope} onValueChange={(v) => v && setMediaScope(v)}>
            <ToggleGroup.Item icon={null} value="all">All Media</ToggleGroup.Item>
            <ToggleGroup.Item icon={null} value="niche">This Niche</ToggleGroup.Item>
          </ToggleGroup>
        )}
      </div>

      {/* Upload progress */}
      {isUploading && uploadProgress && (
        <div className="w-full px-8 py-2">
          <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
          </div>
          <span className="text-caption font-caption text-neutral-400 mt-1">{uploadProgress.current}/{uploadProgress.total}</span>
        </div>
      )}

      {/* Images section */}
      {filteredImages.length > 0 && (
        <div className="flex w-full flex-col gap-3 px-8 py-4">
          <div className="flex items-center gap-2">
            <FeatherImage className="text-indigo-400" style={{ width: 14, height: 14 }} />
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Images</span>
            <Badge variant="neutral">{filteredImages.length}</Badge>
          </div>
          <div className="w-full overflow-y-auto rounded-lg border border-solid border-neutral-800 bg-[#111118] p-2" style={{ maxHeight: 280 }}>
            <div className="grid w-full grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
              {filteredImages.map(item => (
                <div
                  key={item.id}
                  className="relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group"
                >
                  <img
                    src={item.thumbnailUrl || item.url}
                    alt={item.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Videos section */}
      {filteredVideos.length > 0 && (
        <div className="flex w-full flex-col gap-3 px-8 py-4">
          <div className="flex items-center gap-2">
            <FeatherFilm className="text-indigo-400" style={{ width: 14, height: 14 }} />
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Videos</span>
            <Badge variant="neutral">{filteredVideos.length}</Badge>
          </div>
          <div className="w-full overflow-y-auto rounded-lg border border-solid border-neutral-800 bg-[#111118] p-2" style={{ maxHeight: 280 }}>
            <div className="grid w-full grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
              {filteredVideos.map(item => (
                <div
                  key={item.id}
                  className="relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group"
                  onClick={() => setVideoPreviewUrl(item.url)}
                >
                  {item.thumbnailUrl || item.thumbnail ? (
                    <img src={item.thumbnailUrl || item.thumbnail} alt={item.name} className="w-full h-full object-cover" loading="lazy" draggable={false} />
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
                  {item.duration && (
                    <div className="absolute top-0.5 right-0.5 bg-black/70 rounded px-1 py-px">
                      <span className="text-[8px] text-neutral-300 font-mono">{formatDuration(item.duration)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Audio section */}
      {projectAudio.length > 0 && (
        <div className="flex w-full flex-col gap-2 px-8 py-4">
          <div className="flex items-center gap-2">
            <FeatherMusic className="text-indigo-400" style={{ width: 14, height: 14 }} />
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Audio</span>
            <Badge variant="neutral">{projectAudio.length}</Badge>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-solid border-neutral-800 bg-[#111118] overflow-hidden">
            {projectAudio.map(audio => (
              <div key={audio.id} className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-800/30 transition-colors">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-500/10 flex-none">
                  <FeatherPlay className="text-indigo-400" style={{ width: 11, height: 11 }} />
                </div>
                <span className="text-caption font-caption text-[#ffffffff] truncate flex-1">{audio.name}</span>
                {audio.duration && (
                  <span className="text-[11px] text-neutral-500 tabular-nums flex-none">{formatDuration(audio.duration)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No search results */}
      {filteredImages.length === 0 && filteredVideos.length === 0 && (scopedImages.length > 0 || scopedVideos.length > 0) && mediaSearch && (
        <div className="flex w-full items-center justify-center py-8">
          <span className="text-body font-body text-neutral-500">No matches for "{mediaSearch}"</span>
        </div>
      )}

      {/* Empty state */}
      {scopedMedia.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center w-full">
          <FeatherImage className="w-12 h-12 text-zinc-600" />
          <h3 className="text-lg font-semibold text-white">No media in pool</h3>
          <p className="text-sm text-zinc-400 max-w-xs">
            Upload images and audio to start creating
          </p>
          <Button variant="brand-primary" size="medium" icon={<FeatherUpload />} onClick={onUpload}>
            Upload Media
          </Button>
        </div>
      )}

      {/* Video preview lightbox */}
      {videoPreviewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setVideoPreviewUrl(null)}>
          <div className="relative max-w-2xl max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <video src={videoPreviewUrl} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />
            <button
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/80 flex items-center justify-center hover:bg-black transition-colors border-none cursor-pointer"
              onClick={() => setVideoPreviewUrl(null)}
            >
              <FeatherX className="text-white" style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllMediaContent;
