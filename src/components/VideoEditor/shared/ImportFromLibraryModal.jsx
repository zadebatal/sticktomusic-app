/**
 * ImportFromLibraryModal — Browse and import media from All Media or other niches.
 * Multi-select grid with source dropdown.
 *
 * @param {Object} db - Firestore instance
 * @param {string} artistId - Current artist ID
 * @param {string} nicheId - Target niche to import into
 * @param {Array} library - Full artist library
 * @param {Array} collections - All collections (for niche picker)
 * @param {Function} onImport - (selectedIds: string[]) => void
 * @param {Function} onClose - Close callback
 */
import React, { useState, useMemo } from 'react';
import { Button } from '../../../ui/components/Button';
import { Badge } from '../../../ui/components/Badge';
import { FeatherX, FeatherCheck, FeatherFilm, FeatherImage, FeatherMusic } from '@subframe/core';

const ImportFromLibraryModal = ({
  artistId,
  nicheId,
  library = [],
  collections = [],
  onImport,
  onClose,
}) => {
  const [selected, setSelected] = useState(new Set());
  const [source, setSource] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Source options: All Media + each niche in the same project
  const sourceOptions = useMemo(() => {
    const niches = collections.filter((c) => c.isPipeline && c.id !== nicheId);
    return [
      { id: 'all', label: 'All Media' },
      ...niches.map((n) => ({ id: n.id, label: n.name || 'Niche' })),
    ];
  }, [collections, nicheId]);

  // Filter library by source
  const filteredMedia = useMemo(() => {
    let items = library;
    if (source !== 'all') {
      const col = collections.find((c) => c.id === source);
      if (col?.mediaIds) {
        const mediaIdSet = new Set(col.mediaIds);
        items = items.filter((i) => mediaIdSet.has(i.id));
      }
    }
    // Exclude items already in this niche
    const niche = collections.find((c) => c.id === nicheId);
    if (niche?.mediaIds) {
      const existingIds = new Set(niche.mediaIds);
      items = items.filter((i) => !existingIds.has(i.id));
    }
    // Type filter
    if (typeFilter !== 'all') {
      items = items.filter((i) => i.type === typeFilter);
    }
    return items;
  }, [library, source, collections, nicheId, typeFilter]);

  const toggleItem = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = () => {
    if (selected.size === 0) return;
    onImport([...selected]);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="bg-neutral-50 rounded-xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <h3 className="text-base font-semibold text-white">Import Media</h3>
          <div className="flex items-center gap-3">
            {selected.size > 0 && <Badge variant="success">{selected.size} selected</Badge>}
            <button
              className="h-7 w-7 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center border-none cursor-pointer transition-colors"
              onClick={onClose}
            >
              <FeatherX className="text-white" style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-200">
          <select
            className="px-2 py-1.5 bg-black border border-neutral-200 rounded text-white text-[12px] outline-none cursor-pointer"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {sourceOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="px-2 py-1.5 bg-black border border-neutral-200 rounded text-white text-[12px] outline-none cursor-pointer"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All Types</option>
            <option value="video">Videos</option>
            <option value="image">Images</option>
            <option value="audio">Audio</option>
          </select>
          <span className="text-[11px] text-neutral-400">{filteredMedia.length} available</span>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredMedia.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500">
              <span className="text-sm">No media to import</span>
              <span className="text-xs mt-1">
                All media is already in this niche or library is empty
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-1.5">
              {filteredMedia.map((item) => {
                const isSelected = selected.has(item.id);
                const TypeIcon =
                  item.type === 'video'
                    ? FeatherFilm
                    : item.type === 'audio'
                      ? FeatherMusic
                      : FeatherImage;
                return (
                  <div
                    key={item.id}
                    className={`relative aspect-square rounded overflow-hidden bg-[#171717] cursor-pointer group border-2 ${
                      isSelected ? 'border-indigo-500' : 'border-transparent'
                    }`}
                    onClick={() => toggleItem(item.id)}
                  >
                    {item.thumbnailUrl || item.thumbnail ? (
                      <img
                        src={item.thumbnailUrl || item.thumbnail}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <TypeIcon className="text-neutral-600" style={{ width: 16, height: 16 }} />
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-indigo-500/30 flex items-center justify-center">
                        <FeatherCheck className="text-white" style={{ width: 16, height: 16 }} />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/60 pointer-events-none">
                      <span className="text-[8px] text-neutral-300 truncate block">
                        {item.name || 'Untitled'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-200">
          <Button variant="neutral-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand-primary" disabled={selected.size === 0} onClick={handleImport}>
            Import {selected.size > 0 ? `${selected.size} items` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ImportFromLibraryModal;
