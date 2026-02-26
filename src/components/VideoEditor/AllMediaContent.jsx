/**
 * AllMediaContent — Full-width tab content replacing the old sidebar.
 * Shows project media grid (images + audio) with search, scope toggle, upload/import.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import {
  FeatherUpload, FeatherDownloadCloud, FeatherImage, FeatherMusic,
  FeatherPlay, FeatherCheck, FeatherX, FeatherSearch,
} from '@subframe/core';
import { getBankColor, MEDIA_TYPES } from '../../services/libraryService';
import useMediaMultiSelect from './shared/useMediaMultiSelect';

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

  // Scoped media
  const nicheMedia = useMemo(() => {
    if (!activeNiche) return [];
    return library.filter(item => (activeNiche.mediaIds || []).includes(item.id));
  }, [activeNiche, library]);

  const scopedMedia = mediaScope === 'niche' ? nicheMedia : projectMedia;
  const scopedImages = useMemo(() => scopedMedia.filter(m => m.type === 'image'), [scopedMedia]);

  const filteredImages = useMemo(() => {
    if (!mediaSearch.trim()) return scopedImages;
    const q = mediaSearch.toLowerCase();
    return scopedImages.filter(m => (m.name || '').toLowerCase().includes(q));
  }, [scopedImages, mediaSearch]);

  const {
    selectedIds, isDragSelecting, rubberBand, gridRef, gridMouseHandlers,
    toggleSelect, selectAll, clearSelection,
  } = useMediaMultiSelect(filteredImages);

  const projectAudio = useMemo(() => projectMedia.filter(m => m.type === 'audio'), [projectMedia]);

  // Bank assignment check
  const getImageBankIndex = useCallback((mediaId) => {
    if (!activeNiche?.banks) return -1;
    for (let i = 0; i < activeNiche.banks.length; i++) {
      if (activeNiche.banks[i]?.includes(mediaId)) return i;
    }
    return -1;
  }, [activeNiche]);

  return (
    <div className="flex flex-1 flex-col items-start self-stretch overflow-y-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between px-6 py-4 border-b border-solid border-neutral-800">
        <div className="flex items-center gap-3">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">All Media</span>
          <Badge variant="neutral">{scopedImages.length} images</Badge>
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
      <div className="flex w-full items-center gap-4 px-6 py-3 border-b border-solid border-neutral-800">
        <div className="flex items-center gap-2 flex-1 rounded-md border border-solid border-neutral-800 bg-black px-3 py-1.5">
          <FeatherSearch className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
          <input
            className="w-full bg-transparent text-body font-body text-white placeholder-neutral-500 outline-none"
            placeholder="Search images..."
            value={mediaSearch}
            onChange={e => setMediaSearch(e.target.value)}
          />
          {mediaSearch && (
            <button className="text-neutral-500 hover:text-white flex-none" onClick={() => setMediaSearch('')}>
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
        <div className="w-full px-6 py-2 border-b border-solid border-neutral-800">
          <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
          </div>
          <span className="text-caption font-caption text-neutral-400 mt-1">{uploadProgress.current}/{uploadProgress.total}</span>
        </div>
      )}

      {/* Select All bar */}
      {filteredImages.length > 0 && (
        <div className="flex w-full items-center justify-between px-6 py-1.5 border-b border-solid border-neutral-800">
          <button
            className="text-caption font-caption text-indigo-400 hover:text-indigo-300"
            onClick={selectAll}
          >
            {selectedIds.size === filteredImages.length ? 'Deselect All' : 'Select All'}
          </button>
          {selectedIds.size > 0 && (
            <span className="text-caption font-caption text-neutral-400">{selectedIds.size} selected</span>
          )}
        </div>
      )}

      {/* Image grid */}
      <div
        className="flex w-full grow flex-col items-start px-6 py-4 overflow-y-auto relative"
        ref={gridRef}
        {...gridMouseHandlers}
        style={{ userSelect: isDragSelecting ? 'none' : undefined }}
      >
        {rubberBand && (
          <div
            className="absolute pointer-events-none border border-indigo-400 bg-indigo-500/20 z-10 rounded-sm"
            style={{ left: rubberBand.left, top: rubberBand.top, width: rubberBand.width, height: rubberBand.height }}
          />
        )}
        <div className="w-full gap-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
          {filteredImages.map(item => {
            const bankIdx = getImageBankIndex(item.id);
            const bankColor = bankIdx >= 0 ? getBankColor(bankIdx) : null;
            const isSelected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                data-media-id={item.id}
                className="relative aspect-square"
                onClick={(e) => {
                  if (isDragSelecting) return;
                  e.stopPropagation();
                  toggleSelect(item.id, e);
                }}
              >
                <img
                  className={`w-full h-full rounded object-cover border-2 transition ${
                    isSelected ? 'border-indigo-500' : 'border-neutral-800 hover:border-neutral-600'
                  }`}
                  src={item.thumbnailUrl || item.url}
                  alt={item.name}
                  loading="lazy"
                  draggable={false}
                  style={{ pointerEvents: isDragSelecting ? 'none' : undefined }}
                />
                {isSelected && (
                  <div className="absolute top-1 left-1 h-5 w-5 rounded-full bg-indigo-500 flex items-center justify-center">
                    <FeatherCheck className="text-white" style={{ width: 12, height: 12 }} />
                  </div>
                )}
                {bankColor && !isSelected && (
                  <div className="h-2 w-2 rounded-full absolute bottom-1 right-1"
                    style={{ backgroundColor: bankColor.primary }} />
                )}
              </div>
            );
          })}
        </div>

        {filteredImages.length === 0 && scopedImages.length > 0 && mediaSearch && (
          <div className="flex w-full items-center justify-center py-8">
            <span className="text-body font-body text-neutral-500">No matches for "{mediaSearch}"</span>
          </div>
        )}

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
      </div>

      {/* Audio section */}
      {projectAudio.length > 0 && (
        <div className="flex w-full flex-col gap-2 border-t border-solid border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <FeatherMusic className="text-indigo-400" style={{ width: 14, height: 14 }} />
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Audio</span>
            <Badge variant="neutral">{projectAudio.length}</Badge>
          </div>
          <div className="flex flex-col gap-1">
            {projectAudio.map(audio => (
              <div key={audio.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#262626] transition-colors">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-500/10 flex-none">
                  <FeatherPlay className="text-indigo-400" style={{ width: 12, height: 12 }} />
                </div>
                <span className="text-body font-body text-[#ffffffff] truncate flex-1">{audio.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AllMediaContent;
