/**
 * NicheRouteModal — Smart routing for ripped montage content.
 *
 * When ripped content contains both video clips and photos, this modal
 * lets the user choose which niche each type goes to. Auto-matches
 * content types to compatible niches in the current project.
 *
 * Niche compatibility:
 * - Photos → slideshow niches (7 Slide, etc.) + photo_montage niches
 * - Video clips → montage, multi_clip, solo_clip, clipper niches
 */
import React, { useState, useMemo } from 'react';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { IconButton } from '../../ui/components/IconButton';
import { FeatherX, FeatherFilm, FeatherImage } from '@subframe/core';

// Formats that accept video clips
const VIDEO_FORMATS = new Set(['montage', 'multi_clip', 'solo_clip', 'clipper']);
// Formats that accept photos
const PHOTO_FORMATS = new Set(['photo_montage']);
// Slideshow niches also accept photos (determined by type === 'slideshow')

const NicheRouteModal = ({
  videoClips = [],
  photos = [],
  projectNiches = [], // Array of { id, name, formats: [{ id, type }] } — all niches in the project
  activeNicheId = null,
  onRoute, // (videoNicheId, photoNicheId) => void
  onClose,
}) => {
  // Find compatible niches for each content type
  const videoNiches = useMemo(
    () =>
      projectNiches.filter(
        (n) =>
          n.formats?.some((f) => VIDEO_FORMATS.has(f.id)) ||
          n.formats?.some((f) => f.type === 'video' && VIDEO_FORMATS.has(f.id)),
      ),
    [projectNiches],
  );

  const photoNiches = useMemo(
    () =>
      projectNiches.filter((n) =>
        n.formats?.some((f) => PHOTO_FORMATS.has(f.id) || f.type === 'slideshow'),
      ),
    [projectNiches],
  );

  // Default selections — active niche if compatible, otherwise first match
  const [selectedVideoNiche, setSelectedVideoNiche] = useState(() => {
    const active = videoNiches.find((n) => n.id === activeNicheId);
    return active?.id || videoNiches[0]?.id || null;
  });

  const [selectedPhotoNiche, setSelectedPhotoNiche] = useState(() => {
    const active = photoNiches.find((n) => n.id === activeNicheId);
    return active?.id || photoNiches[0]?.id || null;
  });

  const handleRoute = () => {
    onRoute(
      videoClips.length > 0 ? selectedVideoNiche : null,
      photos.length > 0 ? selectedPhotoNiche : null,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative z-10 flex w-full max-w-lg flex-col rounded-xl border border-neutral-200 bg-[#111111] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <span className="text-body-bold font-body-bold text-[#ffffffff]">
            Route Ripped Content
          </span>
          <IconButton icon={<FeatherX />} size="small" onClick={onClose} />
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 px-5 py-5">
          <span className="text-caption font-caption text-neutral-400">
            Found {videoClips.length + photos.length} unique clips. Choose where each type goes.
          </span>

          {/* Video clips routing */}
          {videoClips.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <FeatherFilm className="text-green-400" style={{ width: 16, height: 16 }} />
                <span className="text-body-bold font-body-bold text-[#ffffffff]">
                  {videoClips.length} Video Clip{videoClips.length !== 1 ? 's' : ''}
                </span>
              </div>
              {videoNiches.length > 0 ? (
                <select
                  value={selectedVideoNiche || ''}
                  onChange={(e) => setSelectedVideoNiche(e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 bg-[#1a1a1aff] px-3 py-2.5 text-body font-body text-[#ffffffff] outline-none"
                >
                  {videoNiches.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2">
                  <span className="text-caption font-caption text-amber-300">
                    No video niches in this project. Video clips will be added to the library only.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Photos routing */}
          {photos.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <FeatherImage className="text-indigo-400" style={{ width: 16, height: 16 }} />
                <span className="text-body-bold font-body-bold text-[#ffffffff]">
                  {photos.length} Photo{photos.length !== 1 ? 's' : ''}
                </span>
              </div>
              {photoNiches.length > 0 ? (
                <select
                  value={selectedPhotoNiche || ''}
                  onChange={(e) => setSelectedPhotoNiche(e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 bg-[#1a1a1aff] px-3 py-2.5 text-body font-body text-[#ffffffff] outline-none"
                >
                  {photoNiches.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2">
                  <span className="text-caption font-caption text-amber-300">
                    No slideshow or photo montage niches in this project. Photos will be added to
                    the library only.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            All clips will also be added to the project media pool and library.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-200 px-5 py-4">
          <Button variant="neutral-secondary" size="medium" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand-primary" size="medium" onClick={handleRoute}>
            Import All
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NicheRouteModal;
