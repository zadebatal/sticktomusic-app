/**
 * PipelineListView — Pipeline listing with stat cards, format pills, status indicators
 * Replaces StudioHome as default Studio landing when pipelines exist
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getCollections,
  getUserCollections,
  getLibrary,
  getCreatedContent,
  getPipelines,
  getPipelineStatus,
  getPipelineAssetCounts,
  getPipelineBankLabel,
  duplicatePipeline,
  migrateCollectionBanks,
  saveCollections,
  saveCollectionToFirestore,
  deleteCollectionFromFirestore,
  subscribeToCollections,
  subscribeToLibrary,
  subscribeToCreatedContent,
  MEDIA_TYPES,
} from '../../services/libraryService';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import {
  FeatherPlus, FeatherZap, FeatherEdit, FeatherMoreVertical,
  FeatherCopy, FeatherTrash, FeatherImage, FeatherMusic,
  FeatherType, FeatherFile, FeatherUpload, FeatherVideo
} from '@subframe/core';
import * as SubframeCore from '@subframe/core';
import { useToast, ConfirmDialog } from '../ui';
import CreatePipelineModal from './CreatePipelineModal';
import { createNewCollectionAsync } from '../../services/libraryService';

const PipelineListView = ({
  db,
  artistId,
  latePages = [],
  onOpenPipeline,
  onQuickGenerate,
  onViewContent,
  onMakeSlideshow,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();

  // Data state
  const [collections, setCollections] = useState([]);
  const [library, setLibrary] = useState([]);
  const [createdContent, setCreatedContent] = useState({ videos: [], slideshows: [] });

  // UI state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Load data + subscribe
  useEffect(() => {
    if (!artistId) return;
    setCollections(getCollections(artistId));
    setLibrary(getLibrary(artistId));
    setCreatedContent(getCreatedContent(artistId));

    const unsubs = [];
    if (db) {
      unsubs.push(subscribeToCollections(db, artistId, setCollections));
      unsubs.push(subscribeToLibrary(db, artistId, setLibrary));
      unsubs.push(subscribeToCreatedContent(db, artistId, setCreatedContent));
    }
    return () => unsubs.forEach(u => u && u());
  }, [db, artistId]);

  // Derive pipelines from collections
  const pipelines = useMemo(
    () => collections.filter(c => c.isPipeline === true),
    [collections]
  );

  // Stat totals
  const totalDrafts = useMemo(() => {
    let count = 0;
    pipelines.forEach(p => {
      const drafts = (createdContent.slideshows || []).filter(
        s => s.collectionId === p.id && !s.isTemplate
      );
      count += drafts.length;
    });
    return count;
  }, [pipelines, createdContent]);

  const totalAssets = useMemo(() => {
    let count = 0;
    pipelines.forEach(p => {
      const counts = getPipelineAssetCounts(p, library);
      count += counts.images + counts.audio + counts.text;
    });
    return count;
  }, [pipelines, library]);

  // Create pipeline
  const handleCreatePipeline = useCallback(async (pipelineData) => {
    try {
      await createNewCollectionAsync(db, artistId, pipelineData);
      setShowCreateModal(false);
      setEditingPipeline(null);
      toastSuccess('Pipeline created');
    } catch (err) {
      toastError('Failed to create pipeline');
    }
  }, [db, artistId, toastSuccess, toastError]);

  // Update pipeline (edit mode)
  const handleUpdatePipeline = useCallback(async (pipelineData) => {
    const cols = getUserCollections(artistId);
    const idx = cols.findIndex(c => c.id === pipelineData.id);
    if (idx === -1) return;
    cols[idx] = { ...cols[idx], ...pipelineData, updatedAt: new Date().toISOString() };
    saveCollections(artistId, cols);
    if (db) await saveCollectionToFirestore(db, artistId, cols[idx]);
    setEditingPipeline(null);
    toastSuccess('Pipeline updated');
  }, [db, artistId, toastSuccess]);

  // Duplicate
  const handleDuplicate = useCallback(async (pipelineId) => {
    const dup = duplicatePipeline(artistId, pipelineId);
    if (dup && db) await saveCollectionToFirestore(db, artistId, dup);
    toastSuccess('Pipeline duplicated');
  }, [db, artistId, toastSuccess]);

  // Delete
  const handleDelete = useCallback(async (pipelineId) => {
    const cols = getUserCollections(artistId);
    const filtered = cols.filter(c => c.id !== pipelineId);
    saveCollections(artistId, filtered);
    if (db) await deleteCollectionFromFirestore(db, artistId, pipelineId);
    setConfirmDelete(null);
    toastSuccess('Pipeline deleted');
  }, [db, artistId, toastSuccess]);

  // Get initials for avatar
  const getInitials = (name) => {
    const words = (name || '').split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return (name || 'P').substring(0, 2).toUpperCase();
  };

  // Draft count per pipeline
  const getDraftCount = (pipelineId) =>
    (createdContent.slideshows || []).filter(s => s.collectionId === pipelineId && !s.isTemplate).length;

  return (
    <div className="flex w-full flex-col items-start px-12 py-10">
      {/* Header */}
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-2xl font-semibold text-white">Studio</span>
          <span className="text-sm text-neutral-400">Your content pipelines</span>
        </div>
        <div className="flex items-center gap-3">
          {onViewContent && (
            <Button variant="neutral-secondary" size="medium" onClick={() => onViewContent({ type: 'slideshows' })}>
              View Drafts
            </Button>
          )}
          <Button
            variant="brand-primary"
            size="large"
            icon={<FeatherPlus />}
            onClick={() => setShowCreateModal(true)}
          >
            New Pipeline
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="flex w-full items-center gap-6 mt-6">
        <div className="flex flex-1 flex-col gap-2 rounded-lg border border-neutral-800 bg-[#1a1a1a] px-5 py-4">
          <span className="text-2xl font-semibold text-white">{pipelines.length}</span>
          <span className="text-xs text-neutral-400">Pipelines</span>
        </div>
        <div className="flex flex-1 flex-col gap-2 rounded-lg border border-neutral-800 bg-[#1a1a1a] px-5 py-4">
          <span className="text-2xl font-semibold text-white">{totalDrafts}</span>
          <span className="text-xs text-neutral-400">Drafts Ready</span>
        </div>
        <div className="flex flex-1 flex-col gap-2 rounded-lg border border-neutral-800 bg-[#1a1a1a] px-5 py-4">
          <span className="text-2xl font-semibold text-white">{totalAssets}</span>
          <span className="text-xs text-neutral-400">Total Assets</span>
        </div>
      </div>

      {/* Section header */}
      <div className="flex w-full items-center justify-between mt-8">
        <span className="text-lg font-semibold text-white">All Pipelines</span>
        <Badge variant="neutral">{pipelines.length} Pipeline{pipelines.length !== 1 ? 's' : ''}</Badge>
      </div>

      {/* Pipeline rows */}
      <div className="flex w-full flex-col gap-4 mt-6">
        {pipelines.length === 0 && (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-neutral-700 bg-[#1a1a1a] px-8 py-12">
            <span className="text-base text-neutral-400">No pipelines yet</span>
            <Button
              variant="brand-primary"
              icon={<FeatherPlus />}
              onClick={() => setShowCreateModal(true)}
            >
              Create Your First Pipeline
            </Button>
          </div>
        )}

        {pipelines.map(pipeline => {
          const migrated = migrateCollectionBanks(pipeline);
          const status = getPipelineStatus(migrated, library);
          const counts = getPipelineAssetCounts(migrated, library);
          const draftCount = getDraftCount(pipeline.id);
          const activeFormat = (pipeline.formats || [])[0];

          return (
            <div
              key={pipeline.id}
              className="flex w-full items-center gap-4 rounded-lg border border-neutral-800 bg-[#1a1a1a] px-6 py-5 cursor-pointer hover:border-neutral-600 transition-colors"
              onClick={() => onOpenPipeline(pipeline.id)}
            >
              {/* Avatar */}
              <div
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
                style={{ backgroundColor: pipeline.pipelineColor || '#6366f1' }}
              >
                <span className="text-sm font-bold text-white">{getInitials(pipeline.name)}</span>
              </div>

              {/* Name + linked page */}
              <div className="flex flex-1 min-w-0 flex-col gap-1">
                <span className="text-base font-semibold text-white truncate">{pipeline.name}</span>
                {pipeline.linkedPage && (
                  <span className="text-xs text-neutral-400">
                    @{pipeline.linkedPage.handle} · {pipeline.linkedPage.platform}
                  </span>
                )}
              </div>

              {/* Format pills */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {activeFormat && (
                  <div className="flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1">
                    <span className="text-xs text-neutral-400">
                      {activeFormat.slideCount}-Slide: {activeFormat.name}
                    </span>
                  </div>
                )}
              </div>

              {/* Asset counts */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="flex items-center gap-1">
                  <FeatherImage className="text-neutral-400" style={{ width: 14, height: 14 }} />
                  <span className="text-xs text-neutral-400">{counts.images}</span>
                </div>
                <div className="flex items-center gap-1">
                  <FeatherMusic className="text-neutral-400" style={{ width: 14, height: 14 }} />
                  <span className="text-xs text-neutral-400">{counts.audio}</span>
                </div>
                <div className="flex items-center gap-1">
                  <FeatherType className="text-neutral-400" style={{ width: 14, height: 14 }} />
                  <span className="text-xs text-neutral-400">{counts.text}</span>
                </div>
                {draftCount > 0 && (
                  <div className="flex items-center gap-1">
                    <FeatherFile className="text-indigo-400" style={{ width: 14, height: 14 }} />
                    <span className="text-xs text-indigo-400">{draftCount}</span>
                  </div>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: status.ready ? '#22c55e' : '#f59e0b' }}
                />
                <span
                  className="text-xs"
                  style={{ color: status.ready ? '#22c55e' : '#f59e0b' }}
                >
                  {status.label}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                {status.ready ? (
                  <Button
                    variant="brand-primary"
                    size="small"
                    icon={<FeatherZap />}
                    onClick={() => onQuickGenerate && onQuickGenerate(pipeline)}
                  >
                    Quick Generate
                  </Button>
                ) : (
                  <Button
                    variant="neutral-secondary"
                    size="small"
                    icon={<FeatherUpload />}
                    onClick={() => onOpenPipeline(pipeline.id)}
                  >
                    Add Media
                  </Button>
                )}
                <IconButton
                  variant="neutral-tertiary"
                  size="small"
                  icon={<FeatherEdit />}
                  onClick={() => setEditingPipeline(pipeline)}
                />
                <SubframeCore.DropdownMenu.Root>
                  <SubframeCore.DropdownMenu.Trigger asChild>
                    <IconButton
                      variant="neutral-tertiary"
                      size="small"
                      icon={<FeatherMoreVertical />}
                    />
                  </SubframeCore.DropdownMenu.Trigger>
                  <SubframeCore.DropdownMenu.Portal>
                    <SubframeCore.DropdownMenu.Content side="bottom" align="end" sideOffset={4} asChild>
                      <DropdownMenu>
                        <DropdownMenu.DropdownItem icon={<FeatherEdit />} onClick={() => setEditingPipeline(pipeline)}>
                          Edit
                        </DropdownMenu.DropdownItem>
                        <DropdownMenu.DropdownItem icon={<FeatherCopy />} onClick={() => handleDuplicate(pipeline.id)}>
                          Duplicate
                        </DropdownMenu.DropdownItem>
                        <DropdownMenu.DropdownDivider />
                        <DropdownMenu.DropdownItem icon={<FeatherTrash />} onClick={() => setConfirmDelete(pipeline)}>
                          Delete
                        </DropdownMenu.DropdownItem>
                      </DropdownMenu>
                    </SubframeCore.DropdownMenu.Content>
                  </SubframeCore.DropdownMenu.Portal>
                </SubframeCore.DropdownMenu.Root>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create/Edit modal */}
      {(showCreateModal || editingPipeline) && (
        <CreatePipelineModal
          latePages={latePages}
          existingPipeline={editingPipeline}
          onClose={() => { setShowCreateModal(false); setEditingPipeline(null); }}
          onSave={editingPipeline ? handleUpdatePipeline : handleCreatePipeline}
        />
      )}

      {/* Confirm delete */}
      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="Delete Pipeline"
        message={`Delete "${confirmDelete?.name}"? This will remove the pipeline but keep all media in your library.`}
        variant="destructive"
        confirmText="Delete"
        onConfirm={() => handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};

export default PipelineListView;
