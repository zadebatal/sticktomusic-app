/**
 * ProjectLanding — Grid of project cards with stats, "Continue" recent drafts, "+ New Project"
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  getCollections,
  getLibrary,
  getCreatedContent,
  deleteCreatedSlideshowAsync,
  softDeleteCreatedVideoAsync,
  getProjects,
  getProjectStats,
  getProjectNiches,
  createProject,
  getUserCollections,
  saveCollections,
  saveCollectionToFirestore,
  deleteCollectionAsync,
  markCollectionPendingDeletion,
  clearPendingDeletion,
  subscribeToCollections,
  subscribeToLibrary,
  subscribeToCreatedContent,
  PIPELINE_COLORS,
} from '../../services/libraryService';
import { subscribeToScheduledPosts, createScheduledPost, PLATFORM_LABELS, PLATFORM_COLORS } from '../../services/scheduledPostsService';
import { pollOverduePosts } from '../../services/postStatusPolling';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { TextField } from '../../ui/components/TextField';
import {
  FeatherPlus, FeatherArrowRight, FeatherImage, FeatherLayers,
  FeatherX, FeatherChevronDown, FeatherZap, FeatherMoreVertical,
  FeatherEdit2, FeatherTrash2, FeatherSend, FeatherClock, FeatherMusic,
  FeatherUploadCloud, FeatherCheck,
} from '@subframe/core';
import UploadFinishedMediaModal from './UploadFinishedMediaModal';
import * as SubframeCore from '@subframe/core';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import { useToast, ConfirmDialog } from '../ui';
import useIsMobile from '../../hooks/useIsMobile';
import log from '../../utils/logger';

/** Format a scheduledTime ISO string as relative/short time */
function formatRelativeTime(isoString) {
  const target = new Date(isoString);
  const now = new Date();
  const diffMs = target - now;
  if (diffMs < 0) return 'overdue';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `in ${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) {
    return `tomorrow ${target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return target.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const ProjectLanding = ({
  db,
  artistId,
  latePages = [],
  manualAccounts = [],
  onOpenProject,
  onStartWizard,
  onViewContent,
  onOpenVideoEditor,
  onViewAllMedia,
  onEditSlideshow,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { isMobile } = useIsMobile();

  const [collections, setCollections] = useState(() => artistId ? getCollections(artistId) : []);
  const [library, setLibrary] = useState(() => artistId ? getLibrary(artistId) : []);
  const [createdContent, setCreatedContent] = useState(() => artistId ? getCreatedContent(artistId) : { videos: [], slideshows: [] });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPage, setNewProjectPage] = useState(null);
  const [previewingDraft, setPreviewingDraft] = useState(null);
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [showQuickSchedule, setShowQuickSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const [isCreating, setIsCreating] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState(new Set());

  // Subscribe to data
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
      unsubs.push(subscribeToScheduledPosts(db, artistId, setScheduledPosts));
    }
    return () => unsubs.forEach(u => u && u());
  }, [db, artistId]);

  // One-time poll: check if any overdue scheduled posts have already gone live on Late.co
  const pollRanRef = useRef(false);
  useEffect(() => {
    if (pollRanRef.current || !db || !artistId || scheduledPosts.length === 0) return;
    const overdue = scheduledPosts.filter(p =>
      p.status === 'scheduled' && p.scheduledTime && p.latePostId &&
      (new Date() - new Date(p.scheduledTime)) > 5 * 60 * 1000
    );
    if (overdue.length === 0) return;
    pollRanRef.current = true;
    pollOverduePosts(db, artistId, scheduledPosts, (event) => {
      if (event.type === 'posted') toastSuccess(`"${event.contentName}" just went live!`);
      if (event.type === 'failed') toastError(`"${event.contentName}" failed to post`);
    });
  }, [db, artistId, scheduledPosts, toastSuccess, toastError]);

  // All accounts (Late + manual)
  const allAccounts = useMemo(() => {
    const accounts = [...(latePages.filter(p => p.artistId === artistId))];
    (manualAccounts || []).forEach(ma => {
      const handle = ma.handle?.replace('@', '');
      const alreadyCovered = accounts.some(lp => lp.handle?.replace('@', '') === handle);
      if (!alreadyCovered) {
        (ma.platforms || []).forEach(plat => {
          accounts.push({
            id: `manual-${ma.handle}-${plat}`,
            handle: ma.handle?.startsWith('@') ? ma.handle : `@${ma.handle}`,
            platform: plat,
            artistId,
            isManual: true,
          });
        });
      }
    });
    return accounts;
  }, [latePages, manualAccounts, artistId]);

  // Unique pages for dropdown
  const uniquePages = useMemo(() => {
    const seen = new Set();
    return allAccounts.filter(p => {
      const key = `${p.handle}_${p.platform}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [allAccounts]);

  // Projects
  const projects = useMemo(() => {
    return collections.filter(c => c.isProjectRoot === true);
  }, [collections]);

  // Multi-select helpers
  const toggleProjectSelect = useCallback((id) => {
    setSelectedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const hasSelection = selectedProjectIds.size > 0;

  // Stats per project
  const projectStats = useMemo(() => {
    const stats = {};
    projects.forEach(p => {
      stats[p.id] = getProjectStats(artistId, p.id);
    });
    return stats;
  }, [projects, artistId, collections, createdContent]);

  // Total drafts
  const totalDrafts = useMemo(() => {
    return (createdContent.slideshows || []).filter(s => !s.isTemplate).length +
           (createdContent.videos || []).length;
  }, [createdContent]);

  // Upcoming scheduled posts (next 4)
  const upcomingPosts = useMemo(() => {
    return scheduledPosts
      .filter(p => p.status === 'scheduled' && p.scheduledTime)
      .sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''))
      .slice(0, 4);
  }, [scheduledPosts]);

  // Escape-to-close preview modal
  useEffect(() => {
    if (!previewingDraft) return;
    const handler = (e) => { if (e.key === 'Escape') setPreviewingDraft(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewingDraft]);

  // Single-project auto-open (skip if user already visited a project this session)
  useEffect(() => {
    const skipKey = `stm_skip_auto_open_${artistId}`;
    if (projects.length === 1 && onOpenProject && !sessionStorage.getItem(skipKey)) {
      sessionStorage.setItem(skipKey, '1');
      onOpenProject(projects[0].id);
    }
  }, [projects.length, artistId, onOpenProject]);

  // Create project
  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    setIsCreating(true);
    try {
      // Clear deletion flag so migration doesn't block future auto-creation
      localStorage.removeItem(`stm_projects_deleted_${artistId}`);
      const project = createProject(artistId, {
        name: newProjectName.trim(),
        linkedPage: newProjectPage,
        color: PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
      }, db);
      setShowCreateForm(false);
      setNewProjectName('');
      setNewProjectPage(null);
      toastSuccess(`Project "${project.name}" created`);
      onOpenProject(project.id);
    } catch (err) {
      toastError('Failed to create project');
    }
    setIsCreating(false);
  }, [artistId, db, newProjectName, newProjectPage, onOpenProject, toastSuccess, toastError]);

  // Rename project
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const handleRenameProject = useCallback(async (projectId) => {
    if (!renameValue.trim()) return;
    const cols = getUserCollections(artistId);
    const idx = cols.findIndex(c => c.id === projectId);
    if (idx === -1) return;
    cols[idx].name = renameValue.trim();
    cols[idx].updatedAt = new Date().toISOString();
    saveCollections(artistId, cols);
    if (db) await saveCollectionToFirestore(db, artistId, cols[idx]);
    setRenamingProjectId(null);
    setRenameValue('');
    toastSuccess('Project renamed');
  }, [artistId, db, renameValue, toastSuccess]);

  // Core delete logic (no toast — used by both single delete and batch)
  const deleteProjectCore = useCallback(async (projectId) => {
    const cols = getUserCollections(artistId);
    const project = cols.find(c => c.id === projectId);
    if (!project) return;

    // Mark as pending deletion FIRST to prevent subscription race condition
    markCollectionPendingDeletion(projectId);

    const niches = cols.filter(c => c.projectId === projectId);

    // Mark niches as pending deletion too
    for (const n of niches) markCollectionPendingDeletion(n.id);

    try {
      // Cascade-delete all drafts in project niches
      const content = getCreatedContent(artistId);
      for (const n of niches) {
        const nicheDrafts = [...(content.slideshows || []), ...(content.videos || [])].filter(d => d.collectionId === n.id);
        for (const draft of nicheDrafts) {
          if (draft.slides) {
            await deleteCreatedSlideshowAsync(db, artistId, draft.id).catch(log.error);
          } else {
            await softDeleteCreatedVideoAsync(db, artistId, draft.id).catch(log.error);
          }
        }
      }

      // Delete niches themselves
      for (const n of niches) {
        await deleteCollectionAsync(db, artistId, n.id);
      }

      // Mark that user has explicitly deleted projects (prevents migration re-creation)
      const remaining = cols.filter(c => c.id !== projectId && c.isProjectRoot);
      if (remaining.length === 0) {
        localStorage.setItem(`stm_projects_deleted_${artistId}`, Date.now().toString());
      }

      // Delete project root via libraryService (handles both localStorage + Firestore)
      await deleteCollectionAsync(db, artistId, projectId);

      // DO NOT clearPendingDeletion here — the Firestore subscription may not
      // have received the delete yet. If we clear the pending flag too early,
      // the subscription's safety guard re-adds the collection from the stale
      // Firestore snapshot. The pending IDs live in memory and are naturally
      // cleared on page refresh, by which time Firestore has caught up.
    } catch (err) {
      log.error('[ProjectLanding] Delete project failed:', err);
      // Clear pending markers on error so items reappear
      clearPendingDeletion(projectId);
      for (const n of niches) clearPendingDeletion(n.id);
      throw err;
    }
  }, [artistId, db]);

  // Single delete (from dropdown menu)
  const handleDeleteProject = useCallback(async (projectId) => {
    try {
      await deleteProjectCore(projectId);
      toastSuccess('Project deleted');
    } catch (err) {
      toastError(`Failed to delete project: ${err.message}`);
    }
  }, [deleteProjectCore, toastSuccess, toastError]);

  // Ref to avoid stale closure in confirm dialog callback
  const selectedProjectIdsRef = useRef(selectedProjectIds);
  selectedProjectIdsRef.current = selectedProjectIds;

  // Batch delete selected projects
  const handleBatchDelete = useCallback(async () => {
    const ids = [...selectedProjectIdsRef.current];
    if (ids.length === 0) {
      log.error('[ProjectLanding] Batch delete called with empty selection');
      return;
    }
    log.info('[ProjectLanding] Batch deleting', ids.length, 'projects');
    setIsBatchDeleting(true);
    let deleted = 0;
    let lastError = null;
    for (const id of ids) {
      try {
        await deleteProjectCore(id);
        deleted++;
      } catch (err) {
        lastError = err;
        log.error('[ProjectLanding] Batch delete failed for', id, err);
      }
    }
    setSelectedProjectIds(new Set());
    setIsBatchDeleting(false);
    // Force UI refresh from localStorage (subscriptions may lag behind)
    setCollections(getCollections(artistId));
    setCreatedContent(getCreatedContent(artistId));
    if (deleted > 0) toastSuccess(`Deleted ${deleted} project${deleted !== 1 ? 's' : ''}`);
    if (lastError) toastError(`${ids.length - deleted} project(s) failed to delete`);
  }, [deleteProjectCore, toastSuccess, toastError, artistId]);

  // Quick-schedule a draft
  const handleQuickSchedule = useCallback(async () => {
    if (!previewingDraft || !scheduleDate || !scheduleTime || !db) return;
    setIsScheduling(true);
    const scheduledTime = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
    try {
      await createScheduledPost(db, artistId, {
        contentId: previewingDraft.id,
        contentType: 'slideshow',
        contentName: previewingDraft.name || 'Untitled',
        thumbnail: previewingDraft.slides?.[0]?.backgroundImage || previewingDraft.slides?.[0]?.imageA?.url || previewingDraft.thumbnail || null,
        editorState: { slides: previewingDraft.slides, audioKey: previewingDraft.audioKey },
        scheduledTime,
        status: 'scheduled',
      });
      toastSuccess(`Scheduled for ${new Date(scheduledTime).toLocaleString()}`);
      setShowQuickSchedule(false);
      setScheduleDate('');
      setScheduleTime('14:00');
      setPreviewingDraft(null);
    } catch (err) {
      toastError('Failed to schedule');
    }
    setIsScheduling(false);
  }, [previewingDraft, scheduleDate, scheduleTime, db, artistId, toastSuccess, toastError]);

  return (
    <div className="flex w-full flex-col items-start bg-black px-4 md:px-12 py-8 overflow-y-auto" style={{ maxHeight: '100%' }}>
      {/* Header */}
      <div className="flex w-full items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div className="flex flex-col items-start gap-2">
          <span className="text-heading-1 font-heading-1 text-white">Studio</span>
          <span className="text-body font-body text-neutral-400">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {onViewContent && (
            <Button variant="neutral-secondary" size="medium" icon={<FeatherLayers />} onClick={() => onViewContent({ type: 'slideshows' })}>
              View Drafts
            </Button>
          )}
          <Button variant="neutral-secondary" size="medium" icon={<FeatherUploadCloud />} onClick={() => setShowUploadModal(true)}>
            Upload Media
          </Button>
          <Button variant="brand-primary" size="medium" icon={<FeatherPlus />} onClick={() => onStartWizard ? onStartWizard() : setShowCreateForm(true)}>
            New Project
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="flex w-full items-center gap-4 mt-6">
        <div
          className="flex grow shrink-0 basis-0 flex-col items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-5 py-4 cursor-pointer hover:border-neutral-600 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none"
          tabIndex={0}
          role="button"
          onClick={() => onViewContent?.({ type: 'slideshows' })}
        >
          <span className="text-heading-2 font-heading-2 text-white">{totalDrafts}</span>
          <span className="text-caption font-caption text-neutral-400">Drafts</span>
        </div>
        <div
          className="flex grow shrink-0 basis-0 flex-col items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-5 py-4 cursor-pointer hover:border-neutral-600 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none"
          tabIndex={0}
          role="button"
          onClick={() => onViewAllMedia?.()}
        >
          <span className="text-heading-2 font-heading-2 text-white">{library.length}</span>
          <span className="text-caption font-caption text-neutral-400">All Media</span>
        </div>
      </div>

      {/* Project Cards */}
      <div className="flex w-full items-center justify-between mt-8">
        <span className="text-heading-2 font-heading-2 text-white">Your Projects</span>
      </div>

      <div className="grid w-full grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {projects.length === 0 && !showCreateForm && (
          <div className="col-span-1 sm:col-span-2 flex flex-col items-center justify-center gap-3 py-16 text-center">
            <FeatherLayers className="w-12 h-12 text-zinc-600" />
            <h3 className="text-lg font-semibold text-white">No projects yet</h3>
            <p className="text-sm text-zinc-400 max-w-xs">
              Create a project to organize your content and start producing
            </p>
            <Button variant="brand-secondary" size="medium" icon={<FeatherPlus />} onClick={() => setShowCreateForm(true)}>
              New Project
            </Button>
          </div>
        )}

        {projects.map(project => {
          const stats = projectStats[project.id] || { nicheCount: 0, draftCount: 0, mediaCount: 0 };
          const isRenaming = renamingProjectId === project.id;
          const isSelected = selectedProjectIds.has(project.id);
          return (
            <div
              key={project.id}
              className={`relative flex flex-col items-start gap-4 rounded-lg border border-solid px-6 py-5 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/40 bg-indigo-500/10' : 'border-neutral-200 bg-neutral-50 hover:border-neutral-600'}`}
              tabIndex={0}
              role="button"
              onClick={() => !isRenaming && onOpenProject(project.id)}
            >
              <div className="flex w-full items-center gap-3">
                {/* Checkbox */}
                <button
                  className={`flex h-5 w-5 flex-none items-center justify-center rounded border transition-colors ${isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-neutral-300 bg-transparent hover:border-neutral-400'}`}
                  aria-label={`Select ${project.name}`}
                  onClick={(e) => { e.stopPropagation(); toggleProjectSelect(project.id); }}
                >
                  {isSelected && <FeatherCheck style={{ width: 12, height: 12, color: '#fff' }} />}
                </button>
                <div
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
                  style={{ backgroundColor: project.projectColor || '#6366f1' }}
                >
                  <span className="text-body-bold font-body-bold text-white">
                    {(project.name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map(w => (w.replace(/[^a-zA-Z0-9]/g, '')[0] || w[0])).join('').toUpperCase()}
                  </span>
                </div>
                <div className="flex grow flex-col items-start gap-0.5">
                  {isRenaming ? (
                    <input
                      className="bg-transparent text-heading-3 font-heading-3 text-white outline-none border-b border-indigo-500 w-full"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenameProject(project.id); if (e.key === 'Escape') setRenamingProjectId(null); }}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="text-heading-3 font-heading-3 text-white">{project.name}</span>
                  )}
                  {project.linkedPage && (
                    <span className="text-caption font-caption text-neutral-400">
                      @{project.linkedPage.handle} · {project.linkedPage.platform}
                    </span>
                  )}
                </div>
                <SubframeCore.DropdownMenu.Root>
                  <SubframeCore.DropdownMenu.Trigger asChild>
                    <IconButton
                      variant="neutral-tertiary" size="small"
                      icon={<FeatherMoreVertical />} aria-label="Project options"
                      onClick={e => e.stopPropagation()}
                    />
                  </SubframeCore.DropdownMenu.Trigger>
                  <SubframeCore.DropdownMenu.Content side="bottom" align="end" sideOffset={4} asChild>
                    <DropdownMenu>
                      <DropdownMenu.DropdownItem icon={<FeatherEdit2 />} onClick={(e) => {
                        e.stopPropagation();
                        setRenamingProjectId(project.id);
                        setRenameValue(project.name);
                      }}>
                        Rename
                      </DropdownMenu.DropdownItem>
                      <DropdownMenu.DropdownItem icon={<FeatherTrash2 />} onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDialog({
                          isOpen: true,
                          title: 'Delete Project',
                          message: `Delete "${project.name}"? Media will be kept.`,
                          confirmLabel: 'Delete',
                          onConfirm: () => { setConfirmDialog({ isOpen: false }); handleDeleteProject(project.id); },
                        });
                      }}>
                        Delete
                      </DropdownMenu.DropdownItem>
                    </DropdownMenu>
                  </SubframeCore.DropdownMenu.Content>
                </SubframeCore.DropdownMenu.Root>
              </div>

              <div className="flex w-full items-center gap-3 flex-wrap">
                {(stats.nicheFormats || []).length > 0 ? (
                  stats.nicheFormats.map((fmt, i) => (
                    <Badge key={i} variant="neutral">{fmt}</Badge>
                  ))
                ) : (
                  <Badge variant="neutral">No niches</Badge>
                )}
                <Badge variant="neutral">{stats.mediaCount} media</Badge>
                {stats.draftCount > 0 && (
                  <Badge variant="brand">{stats.draftCount} draft{stats.draftCount !== 1 ? 's' : ''}</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Batch action bar */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-3 shadow-2xl">
          <span className="text-sm font-medium text-white">{selectedProjectIds.size} selected</span>
          <Button variant="neutral-secondary" size="small" onClick={() => {
            if (selectedProjectIds.size === projects.length) setSelectedProjectIds(new Set());
            else setSelectedProjectIds(new Set(projects.map(p => p.id)));
          }}>
            {selectedProjectIds.size === projects.length ? 'Deselect All' : 'Select All'}
          </Button>
          <Button variant="neutral-secondary" size="small" onClick={() => setSelectedProjectIds(new Set())}>
            Deselect
          </Button>
          <Button
            variant="destructive-primary"
            size="small"
            icon={<FeatherTrash2 />}
            loading={isBatchDeleting}
            disabled={isBatchDeleting}
            onClick={() => {
              const count = selectedProjectIds.size;
              setConfirmDialog({
                isOpen: true,
                title: 'Delete Projects',
                message: `Delete ${count} project${count !== 1 ? 's' : ''}? Media will be kept.`,
                confirmLabel: `Delete ${count}`,
                onConfirm: () => { setConfirmDialog({ isOpen: false }); handleBatchDelete(); },
              });
            }}
          >
            Delete
          </Button>
        </div>
      )}

      {/* Upcoming Scheduled Posts */}
      {upcomingPosts.length > 0 && (
        <div className="flex w-full flex-col gap-4 mt-8">
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-heading-2 font-heading-2 text-white">Upcoming</span>
              <Badge variant="brand">{upcomingPosts.length}</Badge>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {upcomingPosts.map(post => {
              const platformEntries = post.platforms || {};
              const platforms = Object.keys(platformEntries);
              // Extract account handle from first platform entry
              const firstPlatformData = platformEntries[platforms[0]];
              const accountHandle = firstPlatformData?.handle || null;
              const slides = post.editorState?.slides || [];
              const firstSlide = slides[0];
              const rawPostUrl = firstSlide?.backgroundImage || firstSlide?.imageA?.url || firstSlide?.url || post.thumbnail;
              const firstSlideUrl = rawPostUrl && !rawPostUrl.startsWith('blob:') ? rawPostUrl : null;
              return (
                <div
                  key={post.id}
                  className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors"
                  onClick={() => setPreviewingDraft({
                    ...post,
                    name: post.contentName,
                    slides,
                    _isScheduledPost: true,
                  })}
                >
                  {firstSlideUrl ? (
                    <div className="w-full aspect-[9/16] bg-neutral-100 relative overflow-hidden" style={{ containerType: 'inline-size' }}>
                      <img src={firstSlideUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={e => { e.target.style.display = 'none'; }} />
                      {(firstSlide?.textOverlays || []).map((overlay, oi) => (
                        <div
                          key={oi}
                          className="absolute text-center pointer-events-none"
                          style={{
                            left: `${overlay.position?.x || 50}%`,
                            top: `${overlay.position?.y || 50}%`,
                            transform: 'translate(-50%, -50%)',
                            width: `${overlay.position?.width || 80}%`,
                            fontSize: `${(overlay.style?.fontSize || 48) / 1080 * 100}cqw`,
                            fontFamily: overlay.style?.fontFamily || 'Inter, sans-serif',
                            fontWeight: overlay.style?.fontWeight || '600',
                            color: overlay.style?.color || '#fff',
                            textTransform: overlay.style?.textTransform || 'none',
                            WebkitTextStroke: overlay.style?.textStroke || undefined,
                            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                            lineHeight: 1.2,
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {overlay.text}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="w-full aspect-[9/16] bg-neutral-100 flex items-center justify-center">
                      <FeatherImage className="text-neutral-700" style={{ width: 24, height: 24 }} />
                    </div>
                  )}
                  <div className="flex w-full flex-col gap-1.5 px-3 pb-3">
                    <span className="text-caption-bold font-caption-bold text-neutral-200 truncate">
                      {post.contentName || 'Untitled'}
                    </span>
                    {accountHandle && (
                      <span className="text-[11px] text-neutral-500 truncate">
                        {accountHandle.startsWith('@') ? accountHandle : `@${accountHandle}`}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 text-neutral-400">
                      <FeatherClock style={{ width: 12, height: 12 }} />
                      <span className="text-[11px]">{formatRelativeTime(post.scheduledTime)}</span>
                    </div>
                    {post.editorState?.audio?.name && (
                      <div className="flex items-center gap-1 truncate">
                        <FeatherMusic style={{ width: 11, height: 11, color: '#6366f1', flexShrink: 0 }} />
                        <span className="text-[11px] text-[#6366f1] truncate">{post.editorState.audio.name.replace(' Audio Extracted', '').replace('.mp3', '')}</span>
                      </div>
                    )}
                    {platforms.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {platforms.map(p => (
                          <span
                            key={p}
                            className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: (PLATFORM_COLORS[p] || '#666') + '22', color: PLATFORM_COLORS[p] || '#999' }}
                          >
                            {PLATFORM_LABELS[p] || p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Drafts */}
      {totalDrafts > 0 && (
        <div className="flex w-full flex-col gap-4 mt-8">
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-heading-2 font-heading-2 text-white">Recent Drafts</span>
              <Badge variant="neutral">{totalDrafts}</Badge>
            </div>
            {onViewContent && (
              <Button variant="neutral-tertiary" size="small" iconRight={<FeatherArrowRight />} onClick={() => onViewContent({ type: 'slideshows' })}>
                View All
              </Button>
            )}
          </div>
          <div className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              ...(createdContent.slideshows || []).filter(s => !s.isTemplate).map(s => ({ ...s, _draftType: 'slideshow' })),
              ...(createdContent.videos || []).map(v => ({ ...v, _draftType: 'video' })),
            ]
              .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
              .slice(0, 4)
              .map(draft => {
                const isVideo = draft._draftType === 'video';
                const rawUrl = isVideo
                  ? (draft.thumbnail || draft.clips?.[0]?.thumbnail)
                  : (draft.slides?.[0]?.backgroundImage || draft.slides?.[0]?.imageA?.url || draft.slides?.[0]?.url || draft.thumbnail);
                const firstSlideUrl = rawUrl && !rawUrl.startsWith('blob:') ? rawUrl : null;
                return (
                  <div
                    key={draft.id}
                    className="group relative flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors"
                    onClick={() => setPreviewingDraft(draft)}
                  >
                    {/* Delete button */}
                    <button
                      className="absolute top-1.5 right-1.5 z-10 p-1 rounded bg-black/60 text-neutral-400 hover:text-red-400 hover:bg-black/80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      aria-label="Delete draft"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDialog({
                          isOpen: true,
                          title: 'Delete Draft',
                          message: 'Delete this draft?',
                          confirmLabel: 'Delete',
                          onConfirm: () => {
                            setConfirmDialog({ isOpen: false });
                            const deleteFn = isVideo
                              ? softDeleteCreatedVideoAsync(db, artistId, draft.id)
                              : deleteCreatedSlideshowAsync(db, artistId, draft.id);
                            deleteFn.then(() => {
                              toastSuccess('Draft deleted');
                            }).catch(err => {
                              log.error('Delete draft error:', err);
                              toastError('Failed to delete draft');
                            });
                          },
                        });
                      }}
                    >
                      <FeatherTrash2 style={{ width: 14, height: 14 }} />
                    </button>
                    {firstSlideUrl ? (
                      <div className="w-full aspect-[9/16] bg-neutral-100 relative overflow-hidden" style={{ containerType: 'inline-size' }}>
                        <img src={firstSlideUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={e => { e.target.style.display = 'none'; }} />
                        {!isVideo && (draft.slides?.[0]?.textOverlays || []).map((overlay, oi) => (
                          <div
                            key={oi}
                            className="absolute text-center pointer-events-none"
                            style={{
                              left: `${overlay.position?.x || 50}%`,
                              top: `${overlay.position?.y || 50}%`,
                              transform: 'translate(-50%, -50%)',
                              width: `${overlay.position?.width || 80}%`,
                              fontSize: `${(overlay.style?.fontSize || 48) / 1080 * 100}cqw`,
                              fontFamily: overlay.style?.fontFamily || 'Inter, sans-serif',
                              fontWeight: overlay.style?.fontWeight || '600',
                              color: overlay.style?.color || '#fff',
                              textTransform: overlay.style?.textTransform || 'none',
                              WebkitTextStroke: overlay.style?.textStroke || undefined,
                              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                              lineHeight: 1.2,
                              overflow: 'hidden',
                              wordBreak: 'break-word',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {overlay.text}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="w-full aspect-[9/16] bg-neutral-100 flex items-center justify-center">
                        <FeatherImage className="text-neutral-700" style={{ width: 24, height: 24 }} />
                      </div>
                    )}
                    <div className="flex w-full flex-col gap-0.5 px-3 pb-3">
                      <span className="text-caption font-caption text-neutral-300 truncate">
                        {isVideo
                          ? `${draft.clips?.length || 0} clip${(draft.clips?.length || 0) !== 1 ? 's' : ''}`
                          : `${draft.slides?.length || 0} slide${(draft.slides?.length || 0) !== 1 ? 's' : ''}`
                        }
                      </span>
                      {draft.audio?.name && (
                        <div className="flex items-center gap-1 truncate">
                          <FeatherMusic style={{ width: 11, height: 11, color: '#6366f1', flexShrink: 0 }} />
                          <span className="text-[11px] text-[#6366f1] truncate">{draft.audio.name.replace(' Audio Extracted', '').replace('.mp3', '')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Slideshow Preview Modal */}
      {previewingDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85" onClick={() => setPreviewingDraft(null)}>
          <div className="relative flex flex-col rounded-2xl bg-neutral-50 overflow-hidden" style={{ maxWidth: '90vw', maxHeight: '85vh', minWidth: 320 }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-solid border-neutral-200 px-5 py-4">
              <div className="flex flex-col">
                <span className="text-body-bold font-body-bold text-white">
                  {previewingDraft.name || 'Untitled Slideshow'}
                </span>
                <span className="text-caption font-caption text-neutral-400">
                  {previewingDraft.slides?.length || 0} slide{(previewingDraft.slides?.length || 0) !== 1 ? 's' : ''}
                </span>
                {previewingDraft.audio?.name && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <FeatherMusic style={{ width: 12, height: 12, color: '#6366f1' }} />
                    <span className="text-[12px] text-[#6366f1] truncate max-w-[200px]" title={previewingDraft.audio.name}>
                      {previewingDraft.audio.name.replace(' Audio Extracted', '').replace('.mp3', '')}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!previewingDraft._isScheduledPost && db && (
                  <Button variant="neutral-secondary" size="small" icon={<FeatherClock />} onClick={() => setShowQuickSchedule(v => !v)}>
                    Schedule
                  </Button>
                )}
                {onEditSlideshow && !previewingDraft._isScheduledPost && (
                  <Button variant="brand-secondary" size="small" icon={<FeatherEdit2 />} onClick={() => { setPreviewingDraft(null); onEditSlideshow(previewingDraft); }}>
                    Edit
                  </Button>
                )}
                <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />} aria-label="Close preview" onClick={() => setPreviewingDraft(null)} />
              </div>
            </div>
            {/* Inline quick-schedule form */}
            {showQuickSchedule && (
              <div className="flex items-center gap-3 border-b border-solid border-neutral-200 px-5 py-3 bg-neutral-50">
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="rounded bg-neutral-100 border border-neutral-200 text-white text-sm px-2 py-1.5 outline-none focus:border-indigo-500"
                />
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={e => setScheduleTime(e.target.value)}
                  className="rounded bg-neutral-100 border border-neutral-200 text-white text-sm px-2 py-1.5 outline-none focus:border-indigo-500"
                />
                <Button variant="brand-primary" size="small" icon={<FeatherSend />} disabled={!scheduleDate || isScheduling} loading={isScheduling} onClick={handleQuickSchedule}>
                  {isScheduling ? 'Scheduling...' : 'Confirm'}
                </Button>
              </div>
            )}
            {/* Slides */}
            <div className="flex flex-wrap justify-center gap-3 p-4 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 72px)' }}>
              {(previewingDraft.slides || []).map((slide, i) => (
                <div key={slide.id || i} className="relative overflow-hidden rounded-lg border border-solid border-neutral-200" style={{ width: 180, aspectRatio: '9/16', backgroundColor: '#0a0a0f', containerType: 'inline-size' }}>
                  {(slide.backgroundImage || slide.thumbnail || slide.imageA?.url) ? (
                    <img src={slide.backgroundImage || slide.thumbnail || slide.imageA?.url} alt={`Slide ${i + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex w-full h-full items-center justify-center">
                      <FeatherImage className="text-neutral-700" style={{ width: 24, height: 24 }} />
                    </div>
                  )}
                  {/* Text overlays */}
                  {(slide.textOverlays || []).map((overlay, oi) => (
                    <div key={oi} className="absolute text-center pointer-events-none" style={{
                      left: `${overlay.position?.x || 50}%`,
                      top: `${overlay.position?.y || 50}%`,
                      transform: 'translate(-50%, -50%)',
                      width: `${overlay.position?.width || 80}%`,
                      fontSize: `${(overlay.style?.fontSize || 48) / 1080 * 100}cqw`,
                      fontFamily: overlay.style?.fontFamily || 'Inter, sans-serif',
                      fontWeight: overlay.style?.fontWeight || '700',
                      color: overlay.style?.color || '#fff',
                      textTransform: overlay.style?.textTransform || 'none',
                      WebkitTextStroke: overlay.style?.textStroke || undefined,
                      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                      overflow: 'hidden', wordBreak: 'break-word', whiteSpace: 'pre-wrap', lineHeight: 1.2,
                    }}>
                      {overlay.text}
                    </div>
                  ))}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-center">
                    <span className="text-[11px] text-white">Slide {i + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Project Inline Modal */}
      {showUploadModal && (
        <UploadFinishedMediaModal
          db={db}
          artistId={artistId}
          onClose={() => setShowUploadModal(false)}
          onComplete={(count) => toastSuccess(`Uploaded ${count} file${count !== 1 ? 's' : ''} to queue`)}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        confirmVariant="destructive"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ isOpen: false })}
      />

      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setShowCreateForm(false)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-neutral-50 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <span className="text-heading-2 font-heading-2 text-white">New Project</span>
              <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} aria-label="Close" onClick={() => setShowCreateForm(false)} />
            </div>

            <div className="flex flex-col gap-4">
              <TextField className="h-auto w-full" variant="filled" label="Project Name">
                <TextField.Input
                  placeholder="e.g., Summer Campaign 2026"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); }}
                  autoFocus={!isMobile}
                />
              </TextField>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-white">Linked Page (Optional)</span>
                <SubframeCore.DropdownMenu.Root>
                  <SubframeCore.DropdownMenu.Trigger asChild>
                    <Button className="h-10 w-full" variant="neutral-secondary" iconRight={<FeatherChevronDown />}>
                      {newProjectPage ? `@${newProjectPage.handle} · ${newProjectPage.platform}` : 'No page linked'}
                    </Button>
                  </SubframeCore.DropdownMenu.Trigger>
                  <SubframeCore.DropdownMenu.Content side="bottom" align="start" sideOffset={4} asChild>
                    <DropdownMenu>
                      <DropdownMenu.DropdownItem onClick={() => setNewProjectPage(null)}>
                        No page linked
                      </DropdownMenu.DropdownItem>
                      {uniquePages.map(p => (
                        <DropdownMenu.DropdownItem
                          key={`${p.handle}_${p.platform}`}
                          onClick={() => setNewProjectPage({ handle: p.handle, platform: p.platform, accountId: p.lateAccountId })}
                        >
                          @{p.handle} · {p.platform}
                        </DropdownMenu.DropdownItem>
                      ))}
                    </DropdownMenu>
                  </SubframeCore.DropdownMenu.Content>
                </SubframeCore.DropdownMenu.Root>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button variant="neutral-secondary" size="medium" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              <Button variant="brand-primary" size="medium" disabled={!newProjectName.trim() || isCreating} loading={isCreating} onClick={handleCreateProject}>
                {isCreating ? 'Creating...' : 'Create Project'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectLanding;
