/**
 * WizardStepNiches — Step 2: Multi-select niche formats
 */

import {
  FeatherCamera,
  FeatherCheck,
  FeatherFilm,
  FeatherImage,
  FeatherLayers,
  FeatherPlay,
  FeatherScissors,
  FeatherUploadCloud,
} from '@subframe/core';
import React, { useMemo } from 'react';
import { FORMAT_TEMPLATES } from '../../../services/libraryService';
import { Badge } from '../../../ui/components/Badge';
import { Button } from '../../../ui/components/Button';

const FORMAT_ICONS = {
  montage: FeatherFilm,
  solo_clip: FeatherPlay,
  multi_clip: FeatherLayers,
  photo_montage: FeatherCamera,
  finished_media: FeatherUploadCloud,
  clipper: FeatherScissors,
};

const VIDEO_FORMAT_COLORS = {
  montage: '#6366f1',
  solo_clip: '#22c55e',
  multi_clip: '#f59e0b',
  photo_montage: '#a855f7',
  finished_media: '#06b6d4',
  clipper: '#f43f5e',
};

const WizardStepNiches = ({ selectedFormats, setSelectedFormats, onNext, onBack }) => {
  const slideshowFormats = useMemo(
    () => FORMAT_TEMPLATES.filter((f) => f.type === 'slideshow'),
    [],
  );
  const videoFormats = useMemo(() => FORMAT_TEMPLATES.filter((f) => f.type === 'video'), []);

  const toggleFormat = (fmt) => {
    setSelectedFormats((prev) => {
      const exists = prev.find((f) => f.id === fmt.id);
      if (exists) return prev.filter((f) => f.id !== fmt.id);
      return [...prev, fmt];
    });
  };

  const isSelected = (fmt) => selectedFormats.some((f) => f.id === fmt.id);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Choose your niches</span>
        <span className="text-body font-body text-neutral-400">
          Select the content formats for this project
          {selectedFormats.length > 0 && (
            <Badge variant="brand" className="ml-2">
              {selectedFormats.length} selected
            </Badge>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-4 w-full">
        <span className="text-body-bold font-body-bold text-neutral-300">Slideshows</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {slideshowFormats.map((fmt) => {
            const selected = isSelected(fmt);
            return (
              <div
                key={fmt.id}
                className={`flex flex-col items-start gap-3 rounded-lg border border-solid px-4 py-4 cursor-pointer transition-colors ${
                  selected
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-neutral-200 bg-[#1a1a1aff] hover:border-neutral-600'
                }`}
                onClick={() => toggleFormat(fmt)}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-1">
                    {fmt.slideLabels.map((label, i) => (
                      <div
                        key={i}
                        className="h-8 rounded"
                        style={{
                          width: `${Math.max(24, 80 / fmt.slideCount)}px`,
                          backgroundColor:
                            ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5] + '33',
                          border: `1px solid ${['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5]}55`,
                        }}
                      />
                    ))}
                  </div>
                  {selected && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500">
                      <FeatherCheck style={{ width: 12, height: 12, color: '#fff' }} />
                    </div>
                  )}
                </div>
                <span className="text-body-bold font-body-bold text-[#ffffffff]">{fmt.name}</span>
                <span className="text-caption font-caption text-neutral-400">
                  {fmt.slideCount} slide{fmt.slideCount !== 1 ? 's' : ''}
                </span>
              </div>
            );
          })}
        </div>

        <span className="text-body-bold font-body-bold text-neutral-300 mt-2">Videos</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {videoFormats.map((fmt) => {
            const IconComp = FORMAT_ICONS[fmt.id] || FeatherImage;
            const color = VIDEO_FORMAT_COLORS[fmt.id] || '#6366f1';
            const selected = isSelected(fmt);
            return (
              <div
                key={fmt.id}
                className={`flex flex-col items-start gap-3 rounded-lg border border-solid px-4 py-4 cursor-pointer transition-colors ${
                  selected
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-neutral-200 bg-[#1a1a1aff] hover:border-neutral-600'
                }`}
                onClick={() => toggleFormat(fmt)}
              >
                <div className="flex w-full items-center justify-between">
                  <div
                    className="flex items-center justify-center rounded-md"
                    style={{
                      width: 36,
                      height: 36,
                      backgroundColor: color + '22',
                      border: `1px solid ${color}44`,
                    }}
                  >
                    <IconComp style={{ width: 18, height: 18, color }} />
                  </div>
                  {selected && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500">
                      <FeatherCheck style={{ width: 12, height: 12, color: '#fff' }} />
                    </div>
                  )}
                </div>
                <span className="text-body-bold font-body-bold text-[#ffffffff]">{fmt.name}</span>
                {fmt.description && (
                  <span className="text-caption font-caption text-neutral-400">
                    {fmt.description}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 w-full">
        <Button variant="neutral-secondary" size="medium" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="brand-primary"
          size="medium"
          className="flex-1"
          disabled={selectedFormats.length === 0}
          onClick={onNext}
        >
          Next ({selectedFormats.length} niche{selectedFormats.length !== 1 ? 's' : ''})
        </Button>
      </div>
    </div>
  );
};

export default WizardStepNiches;
