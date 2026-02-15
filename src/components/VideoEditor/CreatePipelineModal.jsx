import React, { useState, useMemo } from 'react';
import { FORMAT_TEMPLATES, PIPELINE_COLORS, createPipeline } from '../../services/libraryService';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { TextField } from '../../ui/components/TextField';
import {
  FeatherCheck, FeatherX, FeatherPlus,
  FeatherImage, FeatherFileText, FeatherArrowRight,
  FeatherChevronDown
} from '@subframe/core';
import * as SubframeCore from '@subframe/core';
import { DropdownMenu } from '../../ui/components/DropdownMenu';

// Colors for the format preview blocks
const SLIDE_COLORS = {
  Hook: '#6366f1',
  Lyrics: '#10b981',
  Vibes: '#f59e0b',
  CTA: '#f43f5e',
  Image: '#6366f1',
  'Slide 1': '#6366f1',
  'Slide 2': '#10b981',
  'Slide 3': '#a855f7',
};

const getSlideColor = (label) => SLIDE_COLORS[label] || '#6366f1';

const CreatePipelineModal = ({
  onClose,
  onSave,
  latePages = [],
  existingPipeline = null,
}) => {
  const isEditing = !!existingPipeline;
  const [name, setName] = useState(existingPipeline?.name || '');
  const [description, setDescription] = useState(existingPipeline?.description || '');
  const [linkedPage, setLinkedPage] = useState(existingPipeline?.linkedPage || null);
  const [selectedFormatId, setSelectedFormatId] = useState(
    existingPipeline?.formats?.[0]?.id || FORMAT_TEMPLATES[1].id
  );

  // Unique pages for dropdown
  const uniquePages = useMemo(() => {
    const seen = new Set();
    return latePages.filter(p => {
      const key = `${p.handle}_${p.platform}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [latePages]);

  const selectedFormat = FORMAT_TEMPLATES.find(f => f.id === selectedFormatId) || FORMAT_TEMPLATES[1];

  const handleSave = () => {
    if (!name.trim()) return;
    const pipeline = createPipeline({
      name: name.trim(),
      linkedPage,
      formats: [selectedFormat],
      activeFormatId: selectedFormat.id,
      description: description.trim(),
      color: existingPipeline?.pipelineColor || PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
    });
    // If editing, preserve original ID and data
    if (existingPipeline) {
      pipeline.id = existingPipeline.id;
      pipeline.mediaIds = existingPipeline.mediaIds || [];
      pipeline.banks = existingPipeline.banks || pipeline.banks;
      pipeline.textBanks = existingPipeline.textBanks || pipeline.textBanks;
      pipeline.captionBank = existingPipeline.captionBank || pipeline.captionBank;
      pipeline.hashtagBank = existingPipeline.hashtagBank || pipeline.hashtagBank;
      pipeline.createdAt = existingPipeline.createdAt;
      pipeline.pipelineColor = existingPipeline.pipelineColor || pipeline.pipelineColor;
    }
    onSave(pipeline);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="flex h-[90vh] w-[90vw] max-w-[1200px] flex-col bg-[#0a0a0a] rounded-xl border border-neutral-800 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Content */}
        <div className="flex flex-1 overflow-auto">
          {/* Left panel — Pipeline info */}
          <div className="flex w-96 flex-none flex-col gap-6 px-12 py-12 overflow-y-auto">
            <div className="flex flex-col gap-2">
              <span className="text-2xl font-semibold text-white">
                {isEditing ? 'Edit Pipeline' : 'Create Pipeline'}
              </span>
              <span className="text-sm text-neutral-400">
                Set up a content pipeline for your social media
              </span>
            </div>

            {/* Info card */}
            <div className="flex flex-col gap-6 rounded-lg border border-neutral-800 bg-[#171717] px-6 py-6">
              <div className="flex flex-col gap-2">
                <span className="text-base font-semibold text-white">Pipeline Info</span>
                <span className="text-xs text-neutral-400">Basic details about your content pipeline</span>
              </div>
              <TextField className="h-auto w-full" variant="filled" label="Pipeline Name">
                <TextField.Input
                  placeholder="Enter pipeline name..."
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </TextField>

              {/* Linked page dropdown */}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-white">Social Media Page</span>
                <SubframeCore.DropdownMenu.Root>
                  <SubframeCore.DropdownMenu.Trigger asChild>
                    <Button
                      className="h-10 w-full"
                      variant="neutral-secondary"
                      iconRight={<FeatherChevronDown />}
                    >
                      {linkedPage ? `@${linkedPage.handle} · ${linkedPage.platform}` : 'Select a page...'}
                    </Button>
                  </SubframeCore.DropdownMenu.Trigger>
                  <SubframeCore.DropdownMenu.Portal>
                    <SubframeCore.DropdownMenu.Content side="bottom" align="start" sideOffset={4} asChild>
                      <DropdownMenu>
                        {uniquePages.map(p => (
                          <DropdownMenu.DropdownItem
                            key={`${p.handle}_${p.platform}`}
                            onClick={() => setLinkedPage({ handle: p.handle, platform: p.platform, accountId: p.lateAccountId })}
                          >
                            @{p.handle} · {p.platform}
                          </DropdownMenu.DropdownItem>
                        ))}
                        {uniquePages.length === 0 && (
                          <DropdownMenu.DropdownItem disabled>No pages connected</DropdownMenu.DropdownItem>
                        )}
                      </DropdownMenu>
                    </SubframeCore.DropdownMenu.Content>
                  </SubframeCore.DropdownMenu.Portal>
                </SubframeCore.DropdownMenu.Root>
              </div>

              <TextField className="h-auto w-full" variant="filled" label="Description / Niche (Optional)">
                <TextField.Input
                  placeholder="e.g., Hip-hop artist vibes..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </TextField>
            </div>

            {/* Format preview */}
            <div className="flex flex-col gap-4 rounded-lg border border-neutral-800 bg-[#171717] px-6 py-6">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-white">Selected Format</span>
                <span className="text-xs text-neutral-400">Preview of your pipeline workspace</span>
              </div>
              <div className="flex gap-2">
                {selectedFormat.slideLabels.map((label, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-2 rounded-md border border-neutral-800 bg-[#0a0a0a] px-3 py-3">
                    <div
                      className="flex h-16 w-full items-center justify-center rounded-md"
                      style={{ backgroundColor: getSlideColor(label) }}
                    >
                      {label === 'Lyrics' || label === 'CTA' ? (
                        <FeatherFileText className="text-black" style={{ width: 20, height: 20 }} />
                      ) : (
                        <FeatherImage className="text-black" style={{ width: 20, height: 20 }} />
                      )}
                    </div>
                    <span className="text-xs text-neutral-400">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right panel — Format grid */}
          <div className="flex flex-1 flex-col gap-6 px-12 py-12 overflow-y-auto">
            <div className="flex flex-col gap-2">
              <span className="text-2xl font-semibold text-white">Choose Post Format</span>
              <span className="text-sm text-neutral-400">Select a template that matches your content style</span>
            </div>
            <div className="grid grid-cols-2 gap-6">
              {FORMAT_TEMPLATES.map(fmt => {
                const isSelected = selectedFormatId === fmt.id;
                return (
                  <div
                    key={fmt.id}
                    className={`flex flex-col gap-4 rounded-lg px-6 py-6 cursor-pointer transition-colors relative ${
                      isSelected
                        ? 'border-2 border-[#6366f1] bg-[#171717]'
                        : 'border border-neutral-800 bg-[#171717] hover:border-neutral-400'
                    }`}
                    onClick={() => setSelectedFormatId(fmt.id)}
                  >
                    {isSelected && (
                      <div className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-[#6366f1]">
                        <FeatherCheck className="text-black" style={{ width: 14, height: 14 }} />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-base font-semibold text-white">{fmt.name}</span>
                      <Badge variant={isSelected ? 'brand' : 'neutral'}>{fmt.slideCount} slide{fmt.slideCount !== 1 ? 's' : ''}</Badge>
                    </div>
                    <div className="flex items-center justify-center gap-2 px-2 py-4">
                      {fmt.slideLabels.map((label, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <FeatherArrowRight className="text-neutral-400" style={{ width: 14, height: 14 }} />}
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className="flex items-center justify-center rounded-md"
                              style={{
                                backgroundColor: isSelected ? getSlideColor(label) : undefined,
                                borderColor: isSelected ? getSlideColor(label) : '#525252',
                                borderWidth: 2,
                                borderStyle: 'solid',
                                width: fmt.slideCount <= 3 ? 64 : 48,
                                height: fmt.slideCount <= 3 ? 80 : 64,
                                background: isSelected ? getSlideColor(label) : '#262626',
                              }}
                            >
                              {label === 'Lyrics' || label === 'CTA' ? (
                                <FeatherFileText style={{ width: 14, height: 14, color: isSelected ? getSlideColor(label) : '#9ca3af' }} />
                              ) : (
                                <FeatherImage style={{ width: 14, height: 14, color: isSelected ? getSlideColor(label) : '#9ca3af' }} />
                              )}
                            </div>
                            {fmt.slideCount <= 3 && (
                              <span className="text-xs text-neutral-400">{label}</span>
                            )}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    <span className="text-sm text-neutral-400">
                      {fmt.id === 'single' && 'One image with optional text overlay'}
                      {fmt.id === 'hook_lyrics' && 'Slide 1: Hook/Cover image · Slide 2: Song lyrics text'}
                      {fmt.id === 'carousel' && 'Multi-image storytelling sequence'}
                      {fmt.id === 'hook_vibes_lyrics' && 'Hook → 3 Vibe images → Lyrics'}
                    </span>
                  </div>
                );
              })}

              {/* Custom format card */}
              <div className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-neutral-800 bg-[#171717] px-6 py-6 hover:border-neutral-400 cursor-pointer opacity-50">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-800">
                  <FeatherPlus className="text-neutral-400" style={{ width: 24, height: 24 }} />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-base font-semibold text-white">Custom Format</span>
                  <span className="text-sm text-neutral-400 text-center">Coming soon</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-800 bg-[#171717] px-12 py-6">
          <Button variant="neutral-secondary" size="large" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="large"
            icon={<FeatherCheck />}
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {isEditing ? 'Save Changes' : 'Create Pipeline'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreatePipelineModal;
