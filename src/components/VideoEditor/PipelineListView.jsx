/**
 * StudioHome — Page-centric studio landing
 * Shows connected accounts/pages as cards. Click a page → pick format → workspace.
 * Unlinked legacy collections shown below for migration.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getCollections,
  getUserCollections,
  getLibrary,
  getCreatedContent,
  getUnlinkedCollections,
  getPageWorkspaces,
  getOrCreatePageWorkspace,
  getWorkspaceStatus,
  getPipelineAssetCounts,
  linkCollectionToPage,
  migrateCollectionBanks,
  saveCollections,
  saveCollectionToFirestore,
  deleteCollectionFromFirestore,
  subscribeToCollections,
  subscribeToLibrary,
  subscribeToCreatedContent,
  FORMAT_TEMPLATES,
} from '../../services/libraryService';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import {
  FeatherPlus, FeatherZap, FeatherEdit, FeatherMoreVertical,
  FeatherTrash, FeatherImage, FeatherMusic,
  FeatherType, FeatherFile, FeatherUpload, FeatherArrowRight,
  FeatherLink, FeatherLayers, FeatherChevronDown, FeatherChevronUp,
  FeatherFilm, FeatherPlay, FeatherCamera
} from '@subframe/core';
import * as SubframeCore from '@subframe/core';
import { useToast, ConfirmDialog } from '../ui';
import CreatePipelineModal from './CreatePipelineModal';

// Platform icon colors
const PLATFORM_COLORS = {
  instagram: '#E1306C',
  tiktok: '#000000',
  youtube: '#FF0000',
  twitter: '#1DA1F2',
  facebook: '#1877F2',
  x: '#000000',
};

const getPlatformColor = (platform) => PLATFORM_COLORS[platform?.toLowerCase()] || '#6366f1';

// Group latePages by unique handle (some handles have multiple platforms)
const groupPagesByHandle = (pages) => {
  const map = {};
  pages.forEach(p => {
    const key = p.handle?.replace('@', '') || p.id;
    if (!map[key]) {
      map[key] = { handle: p.handle, pages: [], platforms: [] };
    }
    map[key].pages.push(p);
    if (!map[key].platforms.includes(p.platform)) {
      map[key].platforms.push(p.platform);
    }
  });
  return Object.values(map);
};

const PipelineListView = ({
  db,
  artistId,
  latePages = [],
  manualAccounts = [],
  onOpenWorkspace,
  onOpenVideoEditor,
  onViewContent,
  editingPipelineId,
  onClearEditing,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();

  // Data state
  const [collections, setCollections] = useState([]);
  const [library, setLibrary] = useState([]);
  const [createdContent, setCreatedContent] = useState({ videos: [], slideshows: [] });

  // UI state
  const [formatPickerPage, setFormatPickerPage] = useState(null); // page object when format picker is open
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [linkingCollection, setLinkingCollection] = useState(null); // collection being assigned to a page
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState(null);

  // Auto-open edit modal when editingPipelineId comes in from parent
  useEffect(() => {
    if (editingPipelineId && collections.length > 0) {
      const pipeline = collections.find(c => c.id === editingPipelineId);
      if (pipeline) {
        setEditingPipeline(pipeline);
        setShowCreateModal(true);
      }
      onClearEditing?.();
    }
  }, [editingPipelineId, collections, onClearEditing]);

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

  // Connected pages for this artist
  const artistPages = useMemo(() => latePages.filter(p => p.artistId === artistId), [latePages, artistId]);

  // Merge Late pages + manual accounts into a unified list
  const allAccounts = useMemo(() => {
    const accounts = [...artistPages];
    // Add manual accounts that aren't covered by Late
    (manualAccounts || []).forEach(ma => {
      const handle = ma.handle?.replace('@', '');
      const alreadyCovered = artistPages.some(lp =>
        lp.handle?.replace('@', '') === handle
      );
      if (!alreadyCovered) {
        (ma.platforms || []).forEach(plat => {
          accounts.push({
            id: `manual-${ma.handle}-${plat}`,
            handle: ma.handle?.startsWith('@') ? ma.handle : `@${ma.handle}`,
            platform: plat,
            artist: '',
            artistId,
            status: 'active',
            isManual: true,
          });
        });
      }
    });
    return accounts;
  }, [artistPages, manualAccounts, artistId]);

  // Group accounts by handle
  const handleGroups = useMemo(() => groupPagesByHandle(allAccounts), [allAccounts]);

  // Unlinked collections (legacy, not assigned to any page)
  const unlinkedCollections = useMemo(
    () => collections.filter(c => !c.pageId && c.type !== 'smart'),
    [collections]
  );

  // Workspaces per page (for showing format pills on page cards)
  const workspacesByPage = useMemo(() => {
    const map = {};
    collections.filter(c => c.pageId).forEach(c => {
      if (!map[c.pageId]) map[c.pageId] = [];
      map[c.pageId].push(c);
    });
    return map;
  }, [collections]);

  // Stats
  const totalDrafts = useMemo(() => {
    return (createdContent.slideshows || []).filter(s => !s.isTemplate).length +
           (createdContent.videos || []).length;
  }, [createdContent]);

  // Handle format selection → open or create workspace
  const handleSelectFormat = useCallback(async (page, format) => {
    try {
      const workspace = getOrCreatePageWorkspace(artistId, page, format);
      if (db) await saveCollectionToFirestore(db, artistId, workspace);
      setFormatPickerPage(null);
      onOpenWorkspace(workspace.id);
    } catch (err) {
      toastError('Failed to create workspace');
    }
  }, [artistId, db, onOpenWorkspace, toastError]);

  // Handle linking a legacy collection to a page
  const handleLinkCollection = useCallback(async (collection, page, format) => {
    try {
      const linked = linkCollectionToPage(artistId, collection.id, page, format);
      if (linked && db) await saveCollectionToFirestore(db, artistId, linked);
      setLinkingCollection(null);
      toastSuccess(`Linked "${collection.name}" to ${page.handle}`);
    } catch (err) {
      toastError('Failed to link collection');
    }
  }, [artistId, db, toastSuccess, toastError]);

  // Delete
  const handleDelete = useCallback(async (collectionId) => {
    const cols = getUserCollections(artistId);
    const filtered = cols.filter(c => c.id !== collectionId);
    saveCollections(artistId, filtered);
    if (db) await deleteCollectionFromFirestore(db, artistId, collectionId);
    setConfirmDelete(null);
    toastSuccess('Collection deleted');
  }, [db, artistId, toastSuccess]);

  // Save pipeline from CreatePipelineModal
  const handleSavePipeline = useCallback(async (pipeline) => {
    try {
      // Add to collections
      const cols = getUserCollections(artistId);
      const existing = cols.findIndex(c => c.id === pipeline.id);
      if (existing >= 0) {
        cols[existing] = { ...cols[existing], ...pipeline };
      } else {
        cols.push(pipeline);
      }
      saveCollections(artistId, cols);
      if (db) await saveCollectionToFirestore(db, artistId, pipeline);
      setShowCreateModal(false);
      const isEditing = existing >= 0;
      toastSuccess(`Pipeline "${pipeline.name}" ${isEditing ? 'updated' : 'created'}`);

      // Route based on format type — video formats open video editor, slideshows open workspace
      const activeFormat = pipeline.formats?.find(f => f.id === pipeline.activeFormatId) || pipeline.formats?.[0];
      if (activeFormat?.type === 'video' && !isEditing) {
        onOpenVideoEditor?.(activeFormat);
      } else {
        onOpenWorkspace(pipeline.id);
      }
    } catch (err) {
      toastError('Failed to create pipeline');
    }
  }, [artistId, db, onOpenWorkspace, onOpenVideoEditor, toastSuccess, toastError]);

  // Draft count for a workspace
  const getDraftCount = (workspaceId) =>
    (createdContent.slideshows || []).filter(s => s.collectionId === workspaceId && !s.isTemplate).length;

  // Workspace count (pipeline collections)
  const workspaceCount = useMemo(() =>
    collections.filter(c => c.pageId || c.isPipeline).length,
    [collections]
  );

  // Slideshow-only format templates for the picker
  const slideshowFormats = FORMAT_TEMPLATES.filter(f => f.type === 'slideshow');
  const videoFormats = FORMAT_TEMPLATES.filter(f => f.type === 'video');

  return (
    <div className="flex w-full flex-col items-start bg-black px-12 py-10 overflow-y-auto" style={{ maxHeight: '100%' }}>
      {/* Header */}
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col items-start gap-2">
          <span className="text-heading-1 font-heading-1 text-[#ffffffff]">Studio</span>
          <span className="text-body font-body text-neutral-400">
            {allAccounts.length} connected account{allAccounts.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {onViewContent && (
            <Button variant="neutral-secondary" size="medium" icon={<FeatherLayers />} onClick={() => onViewContent({ type: 'slideshows' })}>
              View Drafts
            </Button>
          )}
          <Button variant="brand-primary" size="medium" icon={<FeatherPlus />} onClick={() => setShowCreateModal(true)}>
            New Pipeline
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="flex w-full items-center gap-4 mt-6">
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{allAccounts.length}</span>
          <span className="text-caption font-caption text-neutral-400">Accounts</span>
        </div>
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{workspaceCount}</span>
          <span className="text-caption font-caption text-neutral-400">Workspaces</span>
        </div>
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{totalDrafts}</span>
          <span className="text-caption font-caption text-neutral-400">Drafts</span>
        </div>
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{library.length}</span>
          <span className="text-caption font-caption text-neutral-400">Media</span>
        </div>
      </div>

      {/* ═══ YOUR PAGES ═══ */}
      <div className="flex w-full items-center justify-between mt-8">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Your Pages</span>
        <Badge variant="neutral">{handleGroups.length} Page{handleGroups.length !== 1 ? 's' : ''}</Badge>
      </div>

      <div className="grid w-full grid-cols-2 gap-4 mt-4">
        {handleGroups.length === 0 && (
          <div className="col-span-2 flex flex-col items-center gap-4 rounded-lg border border-dashed border-neutral-700 bg-[#1a1a1aff] px-8 py-12">
            <FeatherLink className="text-neutral-500" style={{ width: 32, height: 32 }} />
            <span className="text-body-bold font-body-bold text-neutral-300">No connected accounts yet</span>
            <span className="text-caption font-caption text-neutral-500 text-center max-w-sm">
              Connect your social media accounts in the Pages tab, or create a standalone pipeline to start building content.
            </span>
            <Button variant="brand-secondary" size="medium" icon={<FeatherPlus />} onClick={() => setShowCreateModal(true)}>
              Create Pipeline
            </Button>
          </div>
        )}

        {handleGroups.map(group => {
          const primaryPage = group.pages[0];
          const pageWorkspaces = group.pages.flatMap(p => workspacesByPage[p.id] || []);
          const totalPageDrafts = pageWorkspaces.reduce((sum, ws) => sum + getDraftCount(ws.id), 0);

          return (
            <div
              key={primaryPage.handle}
              className="flex flex-col items-start gap-4 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-5 cursor-pointer hover:border-neutral-600 transition-colors"
              onClick={() => setFormatPickerPage(primaryPage)}
            >
              {/* Page identity */}
              <div className="flex w-full items-center gap-3">
                {primaryPage.profileImage ? (
                  <img
                    src={primaryPage.profileImage}
                    alt=""
                    className="h-10 w-10 flex-none rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
                    style={{ backgroundColor: getPlatformColor(primaryPage.platform) }}
                  >
                    <span className="text-body-bold font-body-bold text-[#ffffffff]">
                      {(primaryPage.handle || '?').replace('@', '')[0]?.toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex grow flex-col items-start gap-0.5">
                  <span className="text-heading-3 font-heading-3 text-[#ffffffff]">{primaryPage.handle}</span>
                  <div className="flex items-center gap-1.5">
                    {group.platforms.map(plat => (
                      <Badge key={plat} variant="neutral" className="capitalize">{plat}</Badge>
                    ))}
                    {primaryPage.isManual && <Badge variant="neutral">Manual</Badge>}
                  </div>
                </div>
                <FeatherArrowRight className="text-neutral-500 flex-none" style={{ width: 20, height: 20 }} />
              </div>

              {/* Active workspaces / format pills */}
              {pageWorkspaces.length > 0 && (
                <div className="flex w-full flex-wrap items-center gap-2">
                  {pageWorkspaces.map(ws => {
                    const fmt = ws.formats?.[0];
                    const status = getWorkspaceStatus(ws, library);
                    return (
                      <div
                        key={ws.id}
                        className="flex items-center gap-1.5 rounded-full border border-solid border-neutral-700 bg-neutral-900 px-2.5 py-1 cursor-pointer hover:border-neutral-500 transition-colors"
                        onClick={(e) => { e.stopPropagation(); onOpenWorkspace(ws.id); }}
                      >
                        <div
                          className="h-1.5 w-1.5 rounded-full flex-none"
                          style={{ backgroundColor: status.ready ? '#22c55e' : '#f59e0b' }}
                        />
                        <span className="text-caption font-caption text-neutral-300">
                          {fmt?.name || 'Workspace'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Stats row */}
              <div className="flex w-full items-center justify-between">
                <span className="text-caption font-caption text-neutral-400">
                  {pageWorkspaces.length} format{pageWorkspaces.length !== 1 ? 's' : ''} set up
                </span>
                {totalPageDrafts > 0 && (
                  <Badge variant="brand">{totalPageDrafts} draft{totalPageDrafts !== 1 ? 's' : ''}</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ RECENT DRAFTS ═══ */}
      {totalDrafts > 0 && (
        <div className="flex w-full flex-col gap-4 mt-8">
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Recent Drafts</span>
              <Badge variant="neutral">{totalDrafts}</Badge>
            </div>
            {onViewContent && (
              <Button variant="neutral-tertiary" size="small" iconRight={<FeatherArrowRight />} onClick={() => onViewContent({ type: 'slideshows' })}>
                View All
              </Button>
            )}
          </div>
          <div className="grid w-full grid-cols-4 gap-3">
            {(createdContent.slideshows || [])
              .filter(s => !s.isTemplate)
              .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
              .slice(0, 4)
              .map(draft => {
                const firstSlideUrl = draft.slides?.[0]?.url || draft.slides?.[0]?.thumbnailUrl;
                const workspace = collections.find(c => c.id === draft.collectionId);
                return (
                  <div
                    key={draft.id}
                    className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors"
                    onClick={() => {
                      if (workspace) onOpenWorkspace(workspace.id);
                      else onViewContent?.({ type: 'slideshows' });
                    }}
                  >
                    {firstSlideUrl ? (
                      <div className="w-full aspect-[9/16] bg-neutral-900">
                        <img src={firstSlideUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    ) : (
                      <div className="w-full aspect-[9/16] bg-neutral-900 flex items-center justify-center">
                        <FeatherImage className="text-neutral-700" style={{ width: 24, height: 24 }} />
                      </div>
                    )}
                    <div className="flex w-full flex-col gap-0.5 px-3 pb-3">
                      <span className="text-caption font-caption text-neutral-300 truncate">
                        {draft.slides?.length || 0} slide{(draft.slides?.length || 0) !== 1 ? 's' : ''}
                      </span>
                      {workspace && (
                        <span className="text-caption font-caption text-neutral-500 truncate">
                          {workspace.name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Quick start guide — show when user has pages but no workspaces */}
      {handleGroups.length > 0 && workspaceCount === 0 && (
        <div className="flex w-full items-start gap-4 mt-6 rounded-lg border border-solid border-indigo-500/30 bg-indigo-500/5 px-6 py-5">
          <FeatherZap className="text-indigo-400 flex-shrink-0 mt-0.5" style={{ width: 20, height: 20 }} />
          <div className="flex flex-col gap-2">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Get Started</span>
            <span className="text-body font-body text-neutral-300">
              Click a page card above to choose a content format and create your first workspace.
              Each workspace organizes your slide banks, media, and drafts for a specific post style.
            </span>
          </div>
        </div>
      )}

      {/* ═══ EXISTING COLLECTIONS (unlinked) ═══ */}
      {unlinkedCollections.length > 0 && (
        <>
          <div
            className="flex w-full items-center justify-between mt-10 cursor-pointer"
            onClick={() => setShowUnlinked(!showUnlinked)}
          >
            <div className="flex items-center gap-2">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Existing Collections</span>
              <Badge variant="neutral">{unlinkedCollections.length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-caption font-caption text-neutral-400">Assign to a page to migrate</span>
              {showUnlinked
                ? <FeatherChevronUp className="text-neutral-400" style={{ width: 16, height: 16 }} />
                : <FeatherChevronDown className="text-neutral-400" style={{ width: 16, height: 16 }} />
              }
            </div>
          </div>

          {showUnlinked && (
            <div className="flex w-full flex-col gap-3 mt-4">
              {unlinkedCollections.map(col => {
                const migrated = migrateCollectionBanks(col);
                const bankCount = (migrated.banks || []).filter(b => b?.length > 0).length;
                const textCount = (migrated.textBanks || []).reduce((sum, b) => sum + (b?.length || 0), 0);
                const mediaCount = (col.mediaIds || []).length;
                const draftCount = getDraftCount(col.id);

                return (
                  <div
                    key={col.id}
                    data-testid={`collection-card-${col.name.replace(/\s+/g, '-').toLowerCase()}`}
                    className="flex w-full items-center gap-4 rounded-lg border border-dashed border-neutral-700 bg-[#1a1a1aff] px-5 py-4 cursor-pointer hover:border-neutral-500 transition-colors"
                    onClick={() => onOpenWorkspace(col.id)}
                  >
                    {/* Name */}
                    <div className="flex grow flex-col items-start gap-0.5">
                      <span className="text-body-bold font-body-bold text-[#ffffffff]">{col.name}</span>
                      <span className="text-caption font-caption text-neutral-500">
                        {bankCount} bank{bankCount !== 1 ? 's' : ''} · {mediaCount} media · {textCount} text · {draftCount} draft{draftCount !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <Button
                        variant="brand-secondary"
                        size="small"
                        icon={<FeatherLink />}
                        onClick={() => setLinkingCollection(col)}
                      >
                        Assign to Page
                      </Button>
                      <button
                        data-testid={`open-workspace-${col.id}`}
                        className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 transition-colors"
                        onClick={() => onOpenWorkspace(col.id)}
                      >
                        Open
                      </button>
                      <IconButton
                        variant="neutral-tertiary"
                        size="small"
                        icon={<FeatherTrash />}
                        onClick={() => setConfirmDelete(col)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══ FORMAT PICKER MODAL ═══ */}
      {formatPickerPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setFormatPickerPage(null)}>
          <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-[#111111] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex flex-col gap-1">
                <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Create Content</span>
                <span className="text-body font-body text-neutral-400">
                  Choose a format for {formatPickerPage.handle}
                </span>
              </div>
              <IconButton
                variant="neutral-tertiary"
                size="medium"
                icon={<SubframeCore.FeatherX />}
                onClick={() => setFormatPickerPage(null)}
              />
            </div>

            {/* Slideshow formats */}
            <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Slideshows</span>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {slideshowFormats.map(fmt => {
                // Check if workspace already exists for this page+format
                const existing = (workspacesByPage[formatPickerPage.id] || []).find(ws => ws.formatId === fmt.id);
                return (
                  <div
                    key={fmt.id}
                    className={`flex flex-col items-start gap-3 rounded-lg border border-solid px-4 py-4 cursor-pointer transition-colors ${
                      existing ? 'border-brand-600 bg-brand-600/5' : 'border-neutral-800 bg-[#1a1a1aff] hover:border-neutral-600'
                    }`}
                    onClick={() => handleSelectFormat(formatPickerPage, fmt)}
                  >
                    {/* Slide preview blocks */}
                    <div className="flex items-center gap-1">
                      {fmt.slideLabels.map((label, i) => (
                        <div
                          key={i}
                          className="h-8 rounded"
                          style={{
                            width: `${Math.max(24, 80 / fmt.slideCount)}px`,
                            backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5] + '33',
                            border: `1px solid ${['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5]}55`,
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-body-bold font-body-bold text-[#ffffffff]">{fmt.name}</span>
                      <span className="text-caption font-caption text-neutral-400">
                        {fmt.slideCount} slide{fmt.slideCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {existing && (
                      <Badge variant="brand" className="mt-auto">Active workspace</Badge>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Video formats */}
            <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">Videos</span>
            <div className="grid grid-cols-2 gap-3">
              {videoFormats.map(fmt => {
                const IconComponent = fmt.id === 'montage' ? FeatherFilm
                  : fmt.id === 'solo_clip' ? FeatherPlay
                  : fmt.id === 'multi_clip' ? FeatherLayers
                  : fmt.id === 'photo_montage' ? FeatherCamera
                  : FeatherImage;
                return (
                  <div
                    key={fmt.id}
                    className="flex flex-col items-center gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-4 py-4 cursor-pointer hover:border-neutral-600 transition-colors"
                    onClick={() => {
                      setFormatPickerPage(null);
                      onOpenVideoEditor?.(fmt);
                    }}
                  >
                    <IconComponent className="text-neutral-400" style={{ width: 24, height: 24 }} />
                    <span className="text-body-bold font-body-bold text-[#ffffffff]">{fmt.name}</span>
                    {fmt.description && (
                      <span className="text-caption font-caption text-neutral-400 text-center">{fmt.description}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ LINK COLLECTION MODAL ═══ */}
      {linkingCollection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setLinkingCollection(null)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-[#111111] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">
                Assign "{linkingCollection.name}"
              </span>
              <IconButton
                variant="neutral-tertiary"
                size="medium"
                icon={<SubframeCore.FeatherX />}
                onClick={() => setLinkingCollection(null)}
              />
            </div>
            <span className="text-body font-body text-neutral-400 mb-4 block">
              Choose a page and format to assign this collection to. All media and banks will be preserved.
            </span>

            {/* Page list */}
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {allAccounts.map(page => (
                <div key={page.id} className="flex flex-col gap-2">
                  <span className="text-body-bold font-body-bold text-[#ffffffff] mt-2">
                    {page.handle} · {page.platform}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {slideshowFormats.map(fmt => (
                      <Button
                        key={`${page.id}-${fmt.id}`}
                        variant="neutral-secondary"
                        size="small"
                        onClick={() => handleLinkCollection(linkingCollection, page, fmt)}
                      >
                        {fmt.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              {allAccounts.length === 0 && (
                <span className="text-body font-body text-neutral-500 py-4 text-center">
                  No connected accounts. Connect accounts in the Pages tab first.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="Delete Collection"
        message={`Delete "${confirmDelete?.name}"? This will remove the collection but keep all media in your library.`}
        variant="destructive"
        confirmText="Delete"
        onConfirm={() => handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Create/Edit Pipeline Modal */}
      {showCreateModal && (
        <CreatePipelineModal
          onClose={() => { setShowCreateModal(false); setEditingPipeline(null); }}
          onSave={(pipeline) => {
            handleSavePipeline(pipeline);
            setEditingPipeline(null);
          }}
          latePages={allAccounts}
          existingPipeline={editingPipeline}
        />
      )}
    </div>
  );
};

export default PipelineListView;
