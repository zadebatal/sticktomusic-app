/**
 * CrossPollinationDrawer — Right-side drawer showing other projects' banks for importing media/text.
 * Tree: Project → Niche → Bank (images + text).
 * User selects items and imports them to a target bank in the current wizard project.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  getProjectBankTree,
  assignToBank,
  addToTextBank,
  addToProjectPool,
  addToCollectionAsync,
  getCollections,
  updateNicheCaptionBank,
  updateNicheHashtagBank,
} from '../../../services/libraryService';
import { Button } from '../../../ui/components/Button';
import { IconButton } from '../../../ui/components/IconButton';
import { Badge } from '../../../ui/components/Badge';
import {
  FeatherX, FeatherChevronDown, FeatherChevronRight, FeatherCheck,
  FeatherImage, FeatherType, FeatherHash, FeatherMessageSquare,
  FeatherDownloadCloud,
} from '@subframe/core';
import { useToast } from '../../ui';

const CrossPollinationDrawer = ({
  db,
  artistId,
  projectId,
  targetNicheId,
  targetFormat,
  onClose,
  onImported,
}) => {
  const { success: toastSuccess } = useToast();

  const bankTree = useMemo(() => getProjectBankTree(artistId, projectId), [artistId, projectId]);

  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedNiches, setExpandedNiches] = useState({});
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [selectedTexts, setSelectedTexts] = useState([]); // [{ nicheId, bankIdx, text }]
  const [selectedCaptions, setSelectedCaptions] = useState([]); // [{ nicheId, text }]
  const [selectedHashtags, setSelectedHashtags] = useState([]); // [{ nicheId, text }]
  const [targetBankIdx, setTargetBankIdx] = useState(0);

  const toggleProject = (id) => setExpandedProjects(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleNiche = (id) => setExpandedNiches(prev => ({ ...prev, [id]: !prev[id] }));

  const toggleImage = (id) => {
    setSelectedImages(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleText = (nicheId, bankIdx, text) => {
    setSelectedTexts(prev => {
      const exists = prev.find(t => t.nicheId === nicheId && t.bankIdx === bankIdx && t.text === text);
      if (exists) return prev.filter(t => t !== exists);
      return [...prev, { nicheId, bankIdx, text }];
    });
  };

  const toggleCaption = (nicheId, text) => {
    setSelectedCaptions(prev => {
      const exists = prev.find(c => c.nicheId === nicheId && c.text === text);
      if (exists) return prev.filter(c => c !== exists);
      return [...prev, { nicheId, text }];
    });
  };

  const toggleHashtag = (nicheId, text) => {
    setSelectedHashtags(prev => {
      const exists = prev.find(h => h.nicheId === nicheId && h.text === text);
      if (exists) return prev.filter(h => h !== exists);
      return [...prev, { nicheId, text }];
    });
  };

  const totalSelected = selectedImages.size + selectedTexts.length + selectedCaptions.length + selectedHashtags.length;

  const slideCount = targetFormat?.slideCount || 0;

  const handleImport = useCallback(async () => {
    if (totalSelected === 0) return;

    // Import images
    if (selectedImages.size > 0) {
      const imageIds = [...selectedImages];
      addToProjectPool(artistId, projectId, imageIds, db);
      imageIds.forEach(id => {
        assignToBank(artistId, targetNicheId, id, targetBankIdx, db);
      });
    }

    // Import text entries
    for (const { text } of selectedTexts) {
      addToTextBank(artistId, targetNicheId, targetBankIdx, text, db);
    }

    // Import captions
    if (selectedCaptions.length > 0) {
      const niche = getCollections(artistId).find(c => c.id === targetNicheId);
      const rawCap = niche?.captionBank;
      const current = Array.isArray(rawCap) ? rawCap : [...(rawCap?.always || []), ...(rawCap?.pool || [])];
      updateNicheCaptionBank(artistId, targetNicheId, [...current, ...selectedCaptions.map(c => c.text)], db);
    }

    // Import hashtags
    if (selectedHashtags.length > 0) {
      const niche = getCollections(artistId).find(c => c.id === targetNicheId);
      const rawHash = niche?.hashtagBank;
      const current = Array.isArray(rawHash) ? rawHash : [...(rawHash?.always || []), ...(rawHash?.pool || [])];
      updateNicheHashtagBank(artistId, targetNicheId, [...current, ...selectedHashtags.map(h => h.text)], db);
    }

    toastSuccess(`Imported ${totalSelected} item${totalSelected !== 1 ? 's' : ''}`);
    setSelectedImages(new Set());
    setSelectedTexts([]);
    setSelectedCaptions([]);
    setSelectedHashtags([]);
    onImported?.();
  }, [artistId, projectId, targetNicheId, targetBankIdx, db, selectedImages, selectedTexts, selectedCaptions, selectedHashtags, totalSelected, toastSuccess, onImported]);

  if (bankTree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full px-4 py-8">
        <FeatherDownloadCloud className="text-neutral-600" style={{ width: 32, height: 32 }} />
        <span className="text-body font-body text-neutral-400 text-center">No other projects with banks to import from</span>
        <Button variant="neutral-secondary" size="small" onClick={onClose}>Close</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-solid border-neutral-200 px-4 py-3 flex-none">
        <span className="text-body-bold font-body-bold text-[#ffffffff]">Import from Projects</span>
        <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />} aria-label="Close" onClick={onClose} />
      </div>

      {/* Target bank selector (for slideshow niches) */}
      {slideCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-solid border-neutral-200 flex-none">
          <span className="text-caption font-caption text-neutral-400">Import images to:</span>
          <select
            className="bg-neutral-50 border border-neutral-200 rounded text-caption text-white px-2 py-1 outline-none"
            value={targetBankIdx}
            onChange={e => setTargetBankIdx(Number(e.target.value))}
          >
            {Array.from({ length: slideCount }).map((_, i) => (
              <option key={i} value={i}>
                {targetFormat?.slideLabels?.[i] || `Slide ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {bankTree.map(({ project, niches }) => (
          <div key={project.id} className="mb-2">
            {/* Project node */}
            <div
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-neutral-100/50 transition-colors"
              onClick={() => toggleProject(project.id)}
            >
              {expandedProjects[project.id] ? (
                <FeatherChevronDown className="text-neutral-400 flex-none" style={{ width: 14, height: 14 }} />
              ) : (
                <FeatherChevronRight className="text-neutral-400 flex-none" style={{ width: 14, height: 14 }} />
              )}
              <div className="h-4 w-4 rounded-full flex-none" style={{ backgroundColor: project.color || '#6366f1' }} />
              <span className="text-caption-bold font-caption-bold text-[#ffffffff] truncate">{project.name}</span>
            </div>

            {expandedProjects[project.id] && (
              <div className="ml-4">
                {niches.map(({ niche, format, banks, captions, hashtags }) => {
                  const hasContent = banks.some(b => b.images.length > 0 || b.textEntries.length > 0) || captions.length > 0 || hashtags.length > 0;
                  if (!hasContent) return null;
                  return (
                    <div key={niche.id} className="mb-1">
                      {/* Niche node */}
                      <div
                        className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-neutral-100/50 transition-colors"
                        onClick={() => toggleNiche(niche.id)}
                      >
                        {expandedNiches[niche.id] ? (
                          <FeatherChevronDown className="text-neutral-500 flex-none" style={{ width: 12, height: 12 }} />
                        ) : (
                          <FeatherChevronRight className="text-neutral-500 flex-none" style={{ width: 12, height: 12 }} />
                        )}
                        <span className="text-caption font-caption text-neutral-300 truncate">{niche.name}</span>
                      </div>

                      {expandedNiches[niche.id] && (
                        <div className="ml-4 flex flex-col gap-2 py-1">
                          {/* Image banks */}
                          {banks.map((bank, bankIdx) => {
                            if (bank.images.length === 0 && bank.textEntries.length === 0) return null;
                            return (
                              <div key={bankIdx} className="flex flex-col gap-1">
                                <span className="text-[11px] text-neutral-500 font-semibold px-1">{bank.label}</span>
                                {/* Images */}
                                {bank.images.length > 0 && (
                                  <div className="grid grid-cols-3 gap-1 px-1">
                                    {bank.images.slice(0, 9).map(img => {
                                      const isSelected = selectedImages.has(img.id);
                                      return (
                                        <div
                                          key={img.id}
                                          className={`relative aspect-square rounded-sm cursor-pointer overflow-hidden border ${
                                            isSelected ? 'border-indigo-500' : 'border-transparent hover:border-neutral-600'
                                          }`}
                                          onClick={() => toggleImage(img.id)}
                                        >
                                          <img src={img.thumbnailUrl || img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                                          {isSelected && (
                                            <div className="absolute inset-0 bg-indigo-500/30 flex items-center justify-center">
                                              <FeatherCheck className="text-white" style={{ width: 14, height: 14 }} />
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {/* Text entries */}
                                {bank.textEntries.length > 0 && (
                                  <div className="flex flex-col gap-0.5 px-1">
                                    {bank.textEntries.map((text, ti) => {
                                      const isSelected = selectedTexts.some(t => t.nicheId === niche.id && t.bankIdx === bankIdx && t.text === text);
                                      return (
                                        <div
                                          key={ti}
                                          className={`flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer transition-colors ${
                                            isSelected ? 'bg-indigo-500/20' : 'hover:bg-neutral-100/50'
                                          }`}
                                          onClick={() => toggleText(niche.id, bankIdx, text)}
                                        >
                                          <FeatherType className="text-neutral-500 flex-none" style={{ width: 10, height: 10 }} />
                                          <span className="text-[11px] text-neutral-300 truncate">{text}</span>
                                          {isSelected && <FeatherCheck className="text-indigo-400 flex-none ml-auto" style={{ width: 10, height: 10 }} />}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Captions */}
                          {captions.length > 0 && (
                            <div className="flex flex-col gap-0.5 px-1">
                              <span className="text-[11px] text-neutral-500 font-semibold flex items-center gap-1">
                                <FeatherMessageSquare style={{ width: 10, height: 10 }} /> Captions
                              </span>
                              {captions.map((cap, ci) => {
                                const isSelected = selectedCaptions.some(c => c.nicheId === niche.id && c.text === cap);
                                return (
                                  <div
                                    key={ci}
                                    className={`flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer transition-colors ${
                                      isSelected ? 'bg-indigo-500/20' : 'hover:bg-neutral-100/50'
                                    }`}
                                    onClick={() => toggleCaption(niche.id, cap)}
                                  >
                                    <span className="text-[11px] text-neutral-300 truncate">{cap}</span>
                                    {isSelected && <FeatherCheck className="text-indigo-400 flex-none ml-auto" style={{ width: 10, height: 10 }} />}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Hashtags */}
                          {hashtags.length > 0 && (
                            <div className="flex flex-wrap gap-1 px-1">
                              <span className="text-[11px] text-neutral-500 font-semibold flex items-center gap-1 w-full">
                                <FeatherHash style={{ width: 10, height: 10 }} /> Hashtags
                              </span>
                              {hashtags.map((tag, hi) => {
                                const isSelected = selectedHashtags.some(h => h.nicheId === niche.id && h.text === tag);
                                return (
                                  <div
                                    key={hi}
                                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 cursor-pointer text-[11px] transition-colors ${
                                      isSelected
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                        : 'bg-neutral-100/50 text-neutral-400 border border-transparent hover:border-neutral-200'
                                    }`}
                                    onClick={() => toggleHashtag(niche.id, tag)}
                                  >
                                    {tag}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Import footer */}
      {totalSelected > 0 && (
        <div className="flex items-center gap-2 border-t border-solid border-neutral-200 px-4 py-3 flex-none">
          <Button variant="brand-primary" size="small" className="flex-1" onClick={handleImport}>
            Import {totalSelected} item{totalSelected !== 1 ? 's' : ''}
          </Button>
          <Button
            variant="neutral-tertiary"
            size="small"
            onClick={() => {
              setSelectedImages(new Set());
              setSelectedTexts([]);
              setSelectedCaptions([]);
              setSelectedHashtags([]);
            }}
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  );
};

export default CrossPollinationDrawer;
