import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  POST_STATUS, PLATFORMS, PLATFORM_LABELS, PLATFORM_COLORS,
  createScheduledPost, updateScheduledPost, deleteScheduledPost,
  getScheduledPosts, subscribeToScheduledPosts, reorderPosts,
  addManyScheduledPosts
} from '../../services/scheduledPostsService';
import { getTemplates, generateFromTemplate } from '../../services/contentTemplateService';
import CaptionHashtagBank from './CaptionHashtagBank';
import { useToast, ConfirmDialog } from '../ui';
import { getCreatedContent, getCollections } from '../../services/libraryService';
import { renderVideo } from '../../services/videoExportService';
import { uploadFile } from '../../services/firebaseStorage';
import log from '../../utils/logger';
import { useTheme } from '../../contexts/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';

/**
 * SchedulingPage — Batch-First Command Center
 *
 * Primary workflow: select many posts → assign account + platforms → set cadence → schedule all.
 * Everything visible at once. Bulk bar auto-appears when posts are selected.
 * Three-tier hashtag system: always-on (from templates) + campaign (batch) + per-post.
 */
const SchedulingPage = ({
  db,
  artistId,
  accounts = [],
  lateAccountIds = {},
  onEditDraft,
  onSchedulePost,
  onDeleteLatePost,
  onBack,
  readOnly = false,
  visibleArtists = [],
  onArtistChange
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const { isMobile } = useIsMobile();
  const s = getS(theme);

  // ── Core State ──
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedPostId, setExpandedPostId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // Render state
  const [renderingPostId, setRenderingPostId] = useState(null);
  const [renderProgress, setRenderProgress] = useState(0);

  // UI state
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [queuePaused, setQueuePaused] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const [showCaptionBank, setShowCaptionBank] = useState(false);

  // ── BATCH SELECT STATE (new — batch-first) ──
  const [selectedPostIds, setSelectedPostIds] = useState(new Set());

  // ── Batch schedule controls ──
  const [batchAccount, setBatchAccount] = useState('');
  const [batchPlatforms, setBatchPlatforms] = useState({}); // { tiktok: true, instagram: true, ... }
  const [batchStartDate, setBatchStartDate] = useState('');
  const [batchStartTime, setBatchStartTime] = useState('14:00');
  const [postsPerDay, setPostsPerDay] = useState(2);
  const [spacingMode, setSpacingMode] = useState('even'); // 'even' | 'fixed' | 'random'
  const [spacingMinutes, setSpacingMinutes] = useState(120); // used when spacingMode === 'fixed'
  const [batchRandomMin, setBatchRandomMin] = useState(30);
  const [batchRandomMax, setBatchRandomMax] = useState(120);

  // ── Always-on hashtags from templates ──
  const [alwaysOnHashtags, setAlwaysOnHashtags] = useState([]);
  const [alwaysOnCaption, setAlwaysOnCaption] = useState('');

  // ── Templates (for caption bank apply) ──
  const [templates, setTemplates] = useState({});

  // Calendar state
  const [calendarDate, setCalendarDate] = useState(new Date());

  // ── Derived ──
  const filteredPosts = useMemo(() => {
    if (statusFilter === 'all') return posts;
    return posts.filter(p => p.status === statusFilter);
  }, [posts, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { all: posts.length };
    Object.values(POST_STATUS).forEach(s => {
      counts[s] = posts.filter(p => p.status === s).length;
    });
    return counts;
  }, [posts]);

  const draftCount = useMemo(() => posts.filter(p => p.status === POST_STATUS.DRAFT).length, [posts]);
  const selectedCount = selectedPostIds.size;
  const hasSelection = selectedCount > 0;

  // Available handles for account picker
  const availableHandles = useMemo(() => {
    const handles = new Set();
    accounts.forEach(acc => handles.add(acc.handle));
    return Array.from(handles);
  }, [accounts]);

  // Enriched handles with platform context for dropdown labels
  const enrichedHandles = useMemo(() => {
    return availableHandles.map(handle => {
      const mapping = lateAccountIds[handle] || {};
      const platforms = Object.keys(mapping).filter(p => mapping[p]);
      const platformNames = platforms.map(p => PLATFORM_LABELS[p] || p).join(', ');
      return {
        handle,
        platforms,
        label: platformNames ? `@${handle} (${platformNames})` : `@${handle}`
      };
    });
  }, [availableHandles, lateAccountIds]);

  // Linked platforms for the currently selected batch account
  const linkedPlatforms = useMemo(() => {
    if (!batchAccount) return [];
    const mapping = lateAccountIds[batchAccount] || {};
    return Object.keys(mapping).filter(p => mapping[p]);
  }, [batchAccount, lateAccountIds]);

  // Auto-enable all linked platforms when account changes
  useEffect(() => {
    if (!batchAccount) { setBatchPlatforms({}); return; }
    const mapping = lateAccountIds[batchAccount] || {};
    const enabled = {};
    Object.keys(mapping).forEach(p => { if (mapping[p]) enabled[p] = true; });
    setBatchPlatforms(enabled);
  }, [batchAccount, lateAccountIds]);

  // ── Live preview: compute projected schedule times for selected posts ──
  const previewTimes = useMemo(() => {
    if (!batchStartDate || selectedCount === 0) return {};
    const selectedPosts = posts.filter(p => selectedPostIds.has(p.id));
    if (selectedPosts.length === 0) return {};
    const startTime = new Date(`${batchStartDate}T${batchStartTime}`);
    if (isNaN(startTime.getTime())) return {};

    const WAKING_MINUTES = 960;
    const effectiveSpacing = spacingMode === 'even'
      ? Math.floor(WAKING_MINUTES / Math.max(postsPerDay, 1))
      : spacingMinutes;
    const startHour = startTime.getHours();
    const startMin = startTime.getMinutes();

    const map = {};
    if (spacingMode === 'random') {
      // For random, show approximate mid-range preview
      const midJitter = (batchRandomMin + batchRandomMax) / 2;
      let curTime = new Date(startTime);
      let postsThisDay = 0;
      let dayOffset = 0;
      for (const post of selectedPosts) {
        if (postsThisDay >= postsPerDay) {
          dayOffset++;
          curTime = new Date(startTime);
          curTime.setDate(curTime.getDate() + dayOffset);
          curTime.setHours(startHour, startMin, 0, 0);
          postsThisDay = 0;
        }
        map[post.id] = new Date(curTime).toISOString();
        postsThisDay++;
        if (postsThisDay < postsPerDay) {
          curTime = new Date(curTime.getTime() + midJitter * 60000);
        }
      }
    } else {
      selectedPosts.forEach((post, i) => {
        const dayIndex = Math.floor(i / postsPerDay);
        const slotInDay = i % postsPerDay;
        const postTime = new Date(startTime);
        postTime.setDate(postTime.getDate() + dayIndex);
        postTime.setHours(startHour, startMin, 0, 0);
        postTime.setMinutes(postTime.getMinutes() + slotInDay * effectiveSpacing);
        map[post.id] = postTime.toISOString();
      });
    }
    return map;
  }, [batchStartDate, batchStartTime, postsPerDay, spacingMode, spacingMinutes, batchRandomMin, batchRandomMax, selectedPostIds, selectedCount, posts]);

  // ── Load & Subscribe (with ghost draft detection) ──
  useEffect(() => {
    if (!db || !artistId) return;
    setLoading(true);

    // Get current drafts to detect ghosts
    let draftIds = new Set();
    try {
      const content = getCreatedContent(artistId);
      (content.videos || []).forEach(v => draftIds.add(v.id));
      (content.slideshows || []).forEach(s => draftIds.add(s.id));
    } catch (e) { /* no local content yet */ }

    const unsubscribe = subscribeToScheduledPosts(db, artistId, (newPosts) => {
      // Tag posts whose source draft no longer exists
      const tagged = newPosts.map(p => ({
        ...p,
        _isGhost: p.contentId ? !draftIds.has(p.contentId) : false
      }));
      setPosts(tagged);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, artistId]);

  useEffect(() => {
    setBatchStartDate(new Date().toISOString().split('T')[0]);
  }, []);

  // Load always-on hashtags/captions from content templates (reusable)
  const loadAlwaysOnFromTemplates = useCallback(async () => {
    if (!db || !artistId) return;
    try {
      const tmpl = await getTemplates(db, artistId);
      if (tmpl) {
        setTemplates(tmpl);
        const allAlways = new Set();
        let firstCaption = '';
        Object.values(tmpl).forEach(t => {
          if (t?.hashtags?.always) t.hashtags.always.forEach(h => allAlways.add(h));
          if (!firstCaption && t?.captions?.always?.length > 0) firstCaption = t.captions.always[0];
        });
        setAlwaysOnHashtags(Array.from(allAlways));
        setAlwaysOnCaption(firstCaption);
      }
    } catch (err) {
      log.error('Failed to load templates for always-on hashtags:', err);
    }
  }, [db, artistId]);

  useEffect(() => { loadAlwaysOnFromTemplates(); }, [loadAlwaysOnFromTemplates]);


  // ── Selection Handlers ──
  const togglePostSelection = useCallback((postId) => {
    setSelectedPostIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId); else next.add(postId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedPostIds(new Set(filteredPosts.map(p => p.id)));
  }, [filteredPosts]);

  const selectDraftsOnly = useCallback(() => {
    setSelectedPostIds(new Set(posts.filter(p => p.status === POST_STATUS.DRAFT).map(p => p.id)));
  }, [posts]);

  const clearSelection = useCallback(() => {
    setSelectedPostIds(new Set());
  }, []);

  // ── Drag & Drop Handlers ──
  const handleDragStart = useCallback((e, postId) => {
    setDraggedId(postId);
    e.dataTransfer.effectAllowed = 'move';
    if (e.target) setTimeout(() => { e.target.style.opacity = '0.4'; }, 0);
  }, []);

  const handleDragOver = useCallback((e, postId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (postId !== dragOverId) setDragOverId(postId);
  }, [dragOverId]);

  const handleDrop = useCallback(async (e, targetId) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    // Prevent dragging locked posts or dropping onto locked positions
    const draggedPost = posts.find(p => p.id === draggedId);
    if (draggedPost?.locked) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    setPosts(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(p => p.id === draggedId);
      const toIdx = arr.findIndex(p => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr.map((p, i) => ({ ...p, queuePosition: i }));
    });
    const arr = [...posts];
    const fromIdx = arr.findIndex(p => p.id === draggedId);
    const toIdx = arr.findIndex(p => p.id === targetId);
    if (fromIdx !== -1 && toIdx !== -1) {
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      const newOrder = arr.map((p, i) => ({ id: p.id, queuePosition: i }));
      await reorderPosts(db, artistId, newOrder);
    }
    setDraggedId(null);
    setDragOverId(null);
  }, [draggedId, posts, db, artistId]);

  const handleDragEnd = useCallback((e) => {
    if (e.target) e.target.style.opacity = '1';
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  // ── Shuffle / Randomize Order (locked posts stay in place) ──
  const handleRandomizeOrder = useCallback(async () => {
    const locked = posts.filter(p => p.locked);
    const unlocked = posts.filter(p => !p.locked);

    // Collect existing scheduled times from unlocked posts (sorted chronologically)
    const existingTimes = unlocked
      .filter(p => p.scheduledTime)
      .map(p => p.scheduledTime)
      .sort((a, b) => new Date(a) - new Date(b));

    // Shuffle only unlocked posts
    for (let i = unlocked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unlocked[i], unlocked[j]] = [unlocked[j], unlocked[i]];
    }

    // Rebuild the full list: locked posts stay at their original indices
    const result = new Array(posts.length);
    const lockedPositions = new Set();
    posts.forEach((p, i) => { if (p.locked) { result[i] = p; lockedPositions.add(i); } });
    let ui = 0;
    for (let i = 0; i < result.length; i++) {
      if (!lockedPositions.has(i)) { result[i] = unlocked[ui++]; }
    }

    // Redistribute scheduled times: assign sorted times to unlocked posts in new order
    let timeIdx = 0;
    const timeUpdates = [];
    for (let i = 0; i < result.length; i++) {
      if (!lockedPositions.has(i) && result[i].scheduledTime && timeIdx < existingTimes.length) {
        const newTime = existingTimes[timeIdx++];
        if (newTime !== result[i].scheduledTime) {
          timeUpdates.push({ id: result[i].id, scheduledTime: newTime });
          result[i] = { ...result[i], scheduledTime: newTime };
        }
      }
    }

    setPosts(result.map((p, i) => ({ ...p, queuePosition: i })));
    const newOrder = result.map((p, i) => ({ id: p.id, queuePosition: i }));
    await reorderPosts(db, artistId, newOrder);

    // Persist redistributed times to Firestore
    for (const update of timeUpdates) {
      await updateScheduledPost(db, artistId, update.id, { scheduledTime: update.scheduledTime });
    }

    toastSuccess(locked.length > 0 ? `Shuffled (${locked.length} locked)` : 'Queue randomized');
  }, [posts, db, artistId, toastSuccess]);

  // ── CRUD Handlers ──
  const handleUpdatePost = useCallback(async (postId, updates) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...updates } : p));
    await updateScheduledPost(db, artistId, postId, updates);
  }, [db, artistId]);

  // ── Apply caption bank category to drafts ──
  const handleApplyCategory = useCallback(async (categoryKey) => {
    if (!categoryKey || !templates[categoryKey]) {
      toastError('No category selected');
      return;
    }
    let updated = 0;
    for (const post of posts) {
      if (post.status !== POST_STATUS.DRAFT) continue;
      const platform = post.platforms ? Object.keys(post.platforms).find(p => post.platforms[p]) || 'tiktok' : 'tiktok';
      const generated = generateFromTemplate(templates[categoryKey], platform);

      const updates = {};
      if (!post.caption && generated.caption) updates.caption = generated.caption;
      if (generated.hashtags) {
        const existing = Array.isArray(post.hashtags) ? post.hashtags : (post.hashtags || '').split(/\s+/).filter(Boolean);
        const newTags = generated.hashtags.split(/\s+/).filter(Boolean);
        const merged = [...new Set([...existing, ...newTags])];
        const currentStr = Array.isArray(post.hashtags) ? post.hashtags.join(' ') : (post.hashtags || '');
        if (merged.join(' ') !== currentStr) updates.hashtags = merged.join(' ');
      }
      if (Object.keys(updates).length > 0) {
        await handleUpdatePost(post.id, updates);
        updated++;
      }
    }
    if (updated > 0) toastSuccess(`Applied "${categoryKey}" to ${updated} draft${updated !== 1 ? 's' : ''}`);
    else toastSuccess('All drafts already have content — nothing to fill');
  }, [templates, posts, handleUpdatePost, toastSuccess, toastError]);

  const handleDeletePost = useCallback((postId) => {
    const post = posts.find(p => p.id === postId);
    const isPostedOrScheduled = post?.status === POST_STATUS.POSTED || post?.status === POST_STATUS.SCHEDULED;
    const hasLateId = !!post?.latePostId;

    setConfirmDialog({
      isOpen: true,
      title: 'Remove Post',
      message: hasLateId && isPostedOrScheduled
        ? `Remove "${post?.contentName || 'this post'}" from the queue AND from Late.co?`
        : `Remove "${post?.contentName || 'this post'}" from the queue?`,
      variant: 'destructive',
      onConfirm: async () => {
        // Delete from Late first (if applicable)
        if (hasLateId && onDeleteLatePost) {
          try {
            await onDeleteLatePost(post.latePostId);
          } catch (err) {
            log('[Schedule] Late delete failed (continuing local delete):', err);
          }
        }
        await deleteScheduledPost(db, artistId, postId);
        if (expandedPostId === postId) setExpandedPostId(null);
        setSelectedPostIds(prev => { const next = new Set(prev); next.delete(postId); return next; });
        setConfirmDialog({ isOpen: false });
        toastSuccess('Post removed');
      }
    });
  }, [posts, db, artistId, expandedPostId, onDeleteLatePost, toastSuccess]);

  // ── Delete Selected Posts ──
  const handleDeleteSelected = useCallback(() => {
    if (selectedCount === 0) return;
    const selectedList = posts.filter(p => selectedPostIds.has(p.id));
    const lateCount = selectedList.filter(p => p.latePostId && (p.status === POST_STATUS.POSTED || p.status === POST_STATUS.SCHEDULED)).length;

    setConfirmDialog({
      isOpen: true,
      title: 'Delete Selected Posts',
      message: lateCount > 0
        ? `Permanently remove ${selectedCount} post${selectedCount !== 1 ? 's' : ''} from the queue? (${lateCount} will also be removed from Late.co)`
        : `Permanently remove ${selectedCount} post${selectedCount !== 1 ? 's' : ''} from the queue?`,
      variant: 'destructive',
      onConfirm: async () => {
        const ids = [...selectedPostIds];
        for (const id of ids) {
          const post = posts.find(p => p.id === id);
          // Delete from Late if applicable
          if (post?.latePostId && onDeleteLatePost) {
            try {
              await onDeleteLatePost(post.latePostId);
            } catch (err) {
              log('[Schedule] Late delete failed for', id, '(continuing):', err);
            }
          }
          await deleteScheduledPost(db, artistId, id);
        }
        setSelectedPostIds(new Set());
        if (expandedPostId && ids.includes(expandedPostId)) setExpandedPostId(null);
        setConfirmDialog({ isOpen: false });
        toastSuccess(`Removed ${ids.length} post${ids.length !== 1 ? 's' : ''}`);
      }
    });
  }, [selectedPostIds, selectedCount, posts, db, artistId, expandedPostId, onDeleteLatePost, toastSuccess]);

  // ── Auto-render a video post if it has no cloudUrl ──
  const autoRenderPost = useCallback(async (post) => {
    const editorState = post.editorState;
    if (!editorState?.clips?.length) {
      throw new Error('No video clips to render');
    }

    setRenderingPostId(post.id);
    setRenderProgress(0);
    try {
      log('[Schedule] Auto-rendering video for post:', post.id);
      const blob = await renderVideo(editorState, (progress) => {
        setRenderProgress(progress);
      });

      log('[Schedule] Rendered, uploading...', (blob.size / 1024 / 1024).toFixed(2), 'MB');
      setRenderProgress(95);
      const isMP4 = blob.type === 'video/mp4';
      const ext = isMP4 ? 'mp4' : 'webm';
      const { url: cloudUrl } = await uploadFile(
        new File([blob], `${post.contentId || post.id}.${ext}`, { type: blob.type }),
        'videos'
      );

      log('[Schedule] Upload complete:', cloudUrl);
      await handleUpdatePost(post.id, { cloudUrl });
      setRenderProgress(100);
      return cloudUrl;
    } finally {
      setRenderingPostId(null);
      setRenderProgress(0);
    }
  }, [handleUpdatePost]);

  // ── Publish / push a post to Late.co (auto-renders if needed) ──
  // postOverride: optional post object with latest data (used by batch schedule to avoid stale state)
  const handlePublishPost = useCallback(async (postId, postOverride = null) => {
    const post = postOverride || posts.find(p => p.id === postId);
    if (!post) return;
    if (!onSchedulePost) {
      toastError('Scheduling not available. Late API not connected.');
      return;
    }

    const platformEntries = Object.entries(post.platforms || {})
      .filter(([, v]) => v?.accountId)
      .map(([platform, v]) => ({ platform, accountId: v.accountId }));

    if (platformEntries.length === 0) {
      toastError('No platform accounts assigned. Select accounts before publishing.');
      return;
    }

    const isSlideshow = post.contentType === 'slideshow';
    let videoUrl = post.cloudUrl || post.editorState?.cloudUrl;
    // Prefer exported images (rendered at correct aspect ratio with text overlays) over raw backgrounds
    const slideshowImages = isSlideshow
      ? (post.editorState?.exportedImages || (post.editorState?.slides || []).map(s => ({ url: s.backgroundImage || s.imageUrl }))).filter(s => s.url)
      : null;

    if (!isSlideshow && !videoUrl) {
      if (!post.editorState?.clips?.length) {
        toastError('No video data to render. Edit the draft first.');
        await handleUpdatePost(postId, { status: POST_STATUS.FAILED, errorMessage: 'No video clips to render' });
        return;
      }
      try {
        toastSuccess('Rendering video before publishing...');
        await handleUpdatePost(postId, { status: POST_STATUS.POSTING });
        videoUrl = await autoRenderPost(post);
      } catch (err) {
        log('[Schedule] Auto-render failed:', err);
        await handleUpdatePost(postId, { status: POST_STATUS.FAILED, errorMessage: `Render failed: ${err.message}` });
        toastError(`Render failed: ${err.message}`);
        return;
      }
    } else {
      await handleUpdatePost(postId, { status: POST_STATUS.POSTING });
    }

    const postHashtags = Array.isArray(post.hashtags) ? post.hashtags : (post.hashtags || '').split(/\s+/).filter(Boolean);
    const allHashtags = [...postHashtags, ...(alwaysOnHashtags || [])];
    const caption = [post.caption || '', allHashtags.join(' ')].filter(Boolean).join('\n\n');

    try {
      const result = await onSchedulePost({
        videoUrl,
        caption,
        platforms: platformEntries,
        scheduledFor: post.scheduledTime || new Date().toISOString(),
        ...(isSlideshow ? { type: 'carousel', images: slideshowImages } : {})
      });

      if (result?.success === false) {
        await handleUpdatePost(postId, { status: POST_STATUS.FAILED, errorMessage: result.error || 'Unknown error' });
        toastError(`Failed to publish: ${result.error || 'Unknown error'}`);
      } else {
        // Build postResults from Late API response
        const latePost = result?.post || {};
        const latePostId = latePost._id || latePost.id || null;
        const platformResults = {};
        platformEntries.forEach(({ platform }) => {
          platformResults[platform] = {
            postId: latePostId,
            url: latePost.url || latePost.permalink || null,
            error: null
          };
        });

        await handleUpdatePost(postId, {
          status: POST_STATUS.POSTED,
          postedAt: new Date().toISOString(),
          latePostId,
          postResults: platformResults
        });
        toastSuccess('Published successfully!');
      }
    } catch (err) {
      log('[Schedule] Publish error:', err);
      await handleUpdatePost(postId, { status: POST_STATUS.FAILED, errorMessage: err.message });
      toastError(`Publish failed: ${err.message}`);
    }
  }, [posts, onSchedulePost, alwaysOnHashtags, handleUpdatePost, autoRenderPost, toastSuccess, toastError]);

  // ── Batch Schedule Selected ──
  const handleBatchScheduleSelected = useCallback(async () => {
    if (!batchStartDate || selectedCount === 0) return;

    const selectedPosts = posts.filter(p => selectedPostIds.has(p.id));
    const startTime = new Date(`${batchStartDate}T${batchStartTime}`);

    // ── Compute staggered times using postsPerDay + spacing ──
    const WAKING_MINUTES = 960; // 16 hours (6am–10pm spread)
    const effectiveSpacing = spacingMode === 'even'
      ? Math.floor(WAKING_MINUTES / Math.max(postsPerDay, 1))
      : spacingMinutes;

    const startHour = startTime.getHours();
    const startMin = startTime.getMinutes();

    let scheduled;
    if (spacingMode === 'random') {
      // Random spacing within each day, respecting postsPerDay limit
      scheduled = [];
      let curTime = new Date(startTime);
      let postsThisDay = 0;
      let dayOffset = 0;
      for (const post of selectedPosts) {
        if (postsThisDay >= postsPerDay) {
          dayOffset++;
          curTime = new Date(startTime);
          curTime.setDate(curTime.getDate() + dayOffset);
          curTime.setHours(startHour, startMin, 0, 0);
          postsThisDay = 0;
        }
        scheduled.push({ ...post, scheduledTime: new Date(curTime) });
        postsThisDay++;
        if (postsThisDay < postsPerDay) {
          const jitter = batchRandomMin + Math.random() * (batchRandomMax - batchRandomMin);
          curTime = new Date(curTime.getTime() + jitter * 60000);
        }
      }
    } else {
      // Fixed or even spacing — deterministic
      scheduled = selectedPosts.map((post, i) => {
        const dayIndex = Math.floor(i / postsPerDay);
        const slotInDay = i % postsPerDay;
        const postTime = new Date(startTime);
        postTime.setDate(postTime.getDate() + dayIndex);
        postTime.setHours(startHour, startMin, 0, 0);
        postTime.setMinutes(postTime.getMinutes() + slotInDay * effectiveSpacing);
        return { ...post, scheduledTime: postTime };
      });
    }

    // Build account/platform assignments from batchAccount + batchPlatforms
    let platformUpdate = {};
    if (batchAccount) {
      const mapping = lateAccountIds[batchAccount];
      if (mapping) {
        Object.entries(mapping).forEach(([platform, accountId]) => {
          if (accountId && batchPlatforms[platform]) {
            platformUpdate[platform] = { accountId, handle: batchAccount };
          }
        });
      }
    }

    // Apply to each selected post
    for (const post of scheduled) {
      const updates = {
        scheduledTime: post.scheduledTime instanceof Date
          ? post.scheduledTime.toISOString()
          : post.scheduledTime,
        status: POST_STATUS.SCHEDULED
      };

      // Merge hashtags: always-on + existing per-post
      const existingPost = posts.find(p => p.id === post.id);
      const perPostTags = existingPost?.hashtags || [];
      const mergedTags = [...new Set([...alwaysOnHashtags, ...perPostTags])];
      if (mergedTags.length > 0) updates.hashtags = mergedTags;

      // Apply batch account platforms
      if (Object.keys(platformUpdate).length > 0) {
        updates.platforms = { ...(existingPost?.platforms || {}), ...platformUpdate };
      }

      await updateScheduledPost(db, artistId, post.id, updates);
    }

    toastSuccess(`Scheduled ${scheduled.length} post${scheduled.length !== 1 ? 's' : ''}. Rendering & pushing to Late...`);
    setSelectedPostIds(new Set());

    // Auto-render and push each scheduled post to Late in sequence
    // Pass updated post data directly to avoid stale React state
    if (onSchedulePost) {
      for (const post of scheduled) {
        try {
          const existingPost = posts.find(p => p.id === post.id);
          const updatedPost = {
            ...existingPost,
            scheduledTime: post.scheduledTime instanceof Date ? post.scheduledTime.toISOString() : post.scheduledTime,
            status: POST_STATUS.SCHEDULED,
            ...(Object.keys(platformUpdate).length > 0 ? { platforms: { ...(existingPost?.platforms || {}), ...platformUpdate } } : {})
          };
          await handlePublishPost(post.id, updatedPost);
        } catch (err) {
          log('[Schedule] Failed to push post', post.id, 'to Late:', err.message);
        }
      }
    }
  }, [batchStartDate, batchStartTime, postsPerDay, spacingMode, spacingMinutes, batchRandomMin, batchRandomMax,
    selectedPostIds, selectedCount, posts, db, artistId, batchAccount, batchPlatforms, lateAccountIds,
    alwaysOnHashtags, toastSuccess, onSchedulePost, handlePublishPost]);

  // ── Platform Toggle ──
  const togglePlatform = useCallback((postId, platform) => {
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const platforms = { ...(post.platforms || {}) };
    if (platforms[platform]) {
      delete platforms[platform];
    } else {
      platforms[platform] = { accountId: null, handle: '' };
    }
    handleUpdatePost(postId, { platforms });
  }, [posts, handleUpdatePost]);

  const setPlatformAccount = useCallback((postId, platform, accountId, handle) => {
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const platforms = { ...(post.platforms || {}) };
    platforms[platform] = { accountId, handle };
    handleUpdatePost(postId, { platforms });
  }, [posts, handleUpdatePost]);


  // ── Bulk Publish Selected ──
  const handleBulkPublish = useCallback(async () => {
    const publishable = posts.filter(p =>
      selectedPostIds.has(p.id) && (p.status === POST_STATUS.SCHEDULED || p.status === POST_STATUS.FAILED)
    );
    if (publishable.length === 0) {
      toastError('No scheduled posts selected. Schedule posts before publishing.');
      return;
    }
    if (!onSchedulePost) {
      toastError('Late API not connected. Cannot publish.');
      return;
    }

    let succeeded = 0;
    let failed = 0;

    for (const post of publishable) {
      const platformEntries = Object.entries(post.platforms || {})
        .filter(([, v]) => v?.accountId)
        .map(([platform, v]) => ({ platform, accountId: v.accountId }));

      if (platformEntries.length === 0) {
        await handleUpdatePost(post.id, { status: POST_STATUS.FAILED, errorMessage: 'No platform accounts assigned' });
        failed++;
        continue;
      }

      const isSlideshow = post.contentType === 'slideshow';
      let videoUrl = post.cloudUrl || post.editorState?.cloudUrl;
      // Prefer exported images (rendered at correct aspect ratio with text overlays) over raw backgrounds
      const slideshowImages = isSlideshow
        ? (post.editorState?.exportedImages || (post.editorState?.slides || []).map(s => ({ url: s.backgroundImage || s.imageUrl }))).filter(s => s.url)
        : null;

      // Auto-render if no cloudUrl
      if (!isSlideshow && !videoUrl) {
        if (!post.editorState?.clips?.length) {
          await handleUpdatePost(post.id, { status: POST_STATUS.FAILED, errorMessage: 'No video clips to render' });
          failed++;
          continue;
        }
        try {
          await handleUpdatePost(post.id, { status: POST_STATUS.POSTING });
          videoUrl = await autoRenderPost(post);
        } catch (err) {
          await handleUpdatePost(post.id, { status: POST_STATUS.FAILED, errorMessage: `Render failed: ${err.message}` });
          failed++;
          continue;
        }
      } else {
        await handleUpdatePost(post.id, { status: POST_STATUS.POSTING });
      }

      const batchPostHashtags = Array.isArray(post.hashtags) ? post.hashtags : (post.hashtags || '').split(/\s+/).filter(Boolean);
      const allHashtags = [...batchPostHashtags, ...(alwaysOnHashtags || [])];
      const caption = [post.caption || '', allHashtags.join(' ')].filter(Boolean).join('\n\n');

      try {
        const result = await onSchedulePost({
          videoUrl,
          caption,
          platforms: platformEntries,
          scheduledFor: post.scheduledTime || new Date().toISOString(),
          ...(isSlideshow ? { type: 'carousel', images: slideshowImages } : {})
        });

        if (result?.success === false) {
          await handleUpdatePost(post.id, { status: POST_STATUS.FAILED, errorMessage: result.error || 'Unknown error' });
          failed++;
        } else {
          // Build postResults from Late API response
          const latePost = result?.post || {};
          const latePostId = latePost._id || latePost.id || null;
          const platformResults = {};
          platformEntries.forEach(({ platform }) => {
            platformResults[platform] = {
              postId: latePostId,
              url: latePost.url || latePost.permalink || null,
              error: null
            };
          });

          await handleUpdatePost(post.id, {
            status: POST_STATUS.POSTED,
            postedAt: new Date().toISOString(),
            latePostId,
            postResults: platformResults
          });
          succeeded++;
        }
      } catch (err) {
        log('[Schedule] Bulk publish error for', post.id, ':', err);
        await handleUpdatePost(post.id, { status: POST_STATUS.FAILED, errorMessage: err.message });
        failed++;
      }
    }

    if (succeeded > 0 && failed === 0) {
      toastSuccess(`Published ${succeeded} post${succeeded !== 1 ? 's' : ''}!`);
    } else if (succeeded > 0 && failed > 0) {
      toastSuccess(`Published ${succeeded}, failed ${failed}`);
    } else {
      toastError(`All ${failed} post${failed !== 1 ? 's' : ''} failed to publish.`);
    }
    setSelectedPostIds(new Set());
  }, [posts, selectedPostIds, onSchedulePost, alwaysOnHashtags, handleUpdatePost, autoRenderPost, toastSuccess, toastError]);

  // Count publishable posts in selection
  const publishableCount = useMemo(() => {
    return posts.filter(p =>
      selectedPostIds.has(p.id) && (p.status === POST_STATUS.SCHEDULED || p.status === POST_STATUS.FAILED)
    ).length;
  }, [posts, selectedPostIds]);

  // ── Add from drafts handler ──
  const handleAddFromDrafts = useCallback(async (selectedItems) => {
    try {
      // Resolve collection names: check collectionId, then match source media against collections
      const cols = getCollections(artistId).filter(c => c.type !== 'smart');
      const resolveCollectionName = (item) => {
        if (item.collectionName) return item.collectionName;
        if (item.collectionId) {
          const col = cols.find(c => c.id === item.collectionId);
          return col?.name || item.collectionId;
        }
        // Gather source media IDs from clips (sourceId), slides, and audio
        const sourceIds = new Set();
        (item.clips || []).forEach(c => { if (c.sourceId) sourceIds.add(c.sourceId); });
        (item.slides || []).forEach(s => { if (s.mediaId) sourceIds.add(s.mediaId); if (s.id) sourceIds.add(s.id); });
        if (item.audio?.id) sourceIds.add(item.audio.id);
        if (sourceIds.size > 0) {
          const parent = cols.find(c => (c.mediaIds || []).some(mid => sourceIds.has(mid)));
          if (parent) return parent.name;
        }
        return null;
      };

      const itemsToAdd = selectedItems.map(item => ({
        contentId: item.id,
        contentType: item.type,
        contentName: item.name || item.title || (item.type === 'slideshow' ? 'Untitled Slideshow' : 'Untitled Video'),
        thumbnail: item.thumbnail || item.slides?.[0]?.backgroundImage || item.slides?.[0]?.imageUrl || null,
        cloudUrl: item.cloudUrl || null,
        collectionName: resolveCollectionName(item),
        editorState: item
      }));
      await addManyScheduledPosts(db, artistId, itemsToAdd);
      toastSuccess(`Added ${itemsToAdd.length} item(s) to queue`);
      setShowAddModal(false);
    } catch (err) {
      log.error('Failed to add items:', err);
      toastError('Failed to add items to queue');
    }
  }, [db, artistId, toastSuccess, toastError]);

  // ── Render ──
  if (loading) {
    return (
      <div style={s.page}>
        <div style={s.loadingState}>
          <div style={s.spinner} />
          <p style={{ color: '#71717a', marginTop: '16px' }}>Loading queue...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* ═══ HEADER ═══ */}
      <div style={{ ...s.header, ...(isMobile ? { flexDirection: 'column', alignItems: 'flex-start', gap: '8px' } : {}) }}>
        <div style={s.headerLeft}>
          <button style={s.backBtn} onClick={onBack} title="Back to Studio">
            <span style={{ fontSize: '18px' }}>&#8592;</span>
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h1 style={s.pageTitle}>Schedule</h1>
              {visibleArtists.length > 1 && onArtistChange && (
                <select
                  value={artistId}
                  onChange={(e) => onArtistChange(e.target.value)}
                  style={{
                    backgroundColor: theme.bg.input, color: theme.text.primary,
                    border: `1px solid ${theme.border.default}`, borderRadius: '6px',
                    padding: '4px 8px', fontSize: '13px', cursor: 'pointer', outline: 'none',
                    maxWidth: '180px'
                  }}
                >
                  {visibleArtists.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
            <p style={s.subtitle}>
              {posts.length} post{posts.length !== 1 ? 's' : ''} &middot; {draftCount} draft{draftCount !== 1 ? 's' : ''}
              {hasSelection && <span style={{ color: '#a5b4fc' }}> &middot; {selectedCount} selected</span>}
            </p>
          </div>
        </div>
        <div style={{ ...s.headerActions, ...(isMobile ? { flexWrap: 'wrap', width: '100%' } : {}) }}>
          {/* Selection helpers */}
          <button style={s.actionBtnSm} onClick={selectAllVisible} title="Select all visible posts">
            Select All
          </button>
          <button style={s.actionBtnSm} onClick={selectDraftsOnly} title="Select only draft posts">
            Drafts Only
          </button>
          {hasSelection && (
            <>
              <button style={{ ...s.actionBtnSm, color: '#f87171', borderColor: '#7f1d1d' }} onClick={handleDeleteSelected}>
                Delete ({selectedCount})
              </button>
              <button style={{ ...s.actionBtnSm, color: theme.text.secondary, borderColor: theme.border.default }} onClick={clearSelection}>
                Deselect
              </button>
            </>
          )}
        </div>
      </div>

      {/* Pause Banner */}
      {queuePaused && (
        <div style={s.pauseBanner}>⏸ Queue paused — no posts will be published automatically</div>
      )}

      {/* ═══ BATCH BAR — Always visible when posts are selected ═══ */}
      {hasSelection && (
        <div style={s.bulkBar}>
          {/* Row 1: Account + Platforms + Cadence */}
          <div style={{ ...s.bulkRow, ...(isMobile ? { flexDirection: 'column', gap: '10px' } : {}) }}>
            <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
              <label style={s.miniLabel}>Account</label>
              <select
                value={batchAccount}
                onChange={(e) => setBatchAccount(e.target.value)}
                style={s.bulkSelect}
              >
                <option value="">Choose account...</option>
                {enrichedHandles.map(({ handle, label }) => (
                  <option key={handle} value={handle}>{label}</option>
                ))}
              </select>
            </div>

            {/* Platform Toggles — shows linked platforms for selected account */}
            {batchAccount && linkedPlatforms.length > 0 && (
              <>
                <div style={{ width: '1px', height: '32px', backgroundColor: theme.border.default, display: isMobile ? 'none' : 'block' }} />
                <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
                  <label style={s.miniLabel}>Platforms</label>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {linkedPlatforms.map(platform => {
                      const isOn = !!batchPlatforms[platform];
                      const color = PLATFORM_COLORS[platform];
                      return (
                        <button
                          key={platform}
                          onClick={() => setBatchPlatforms(prev => ({ ...prev, [platform]: !prev[platform] }))}
                          style={{
                            padding: '3px 10px', borderRadius: '6px', border: '1px solid', fontSize: '11px', fontWeight: '600', cursor: 'pointer',
                            backgroundColor: isOn ? color + '22' : theme.bg.input, borderColor: isOn ? color : theme.border.default,
                            color: isOn ? color : '#52525b', transition: 'all 0.12s'
                          }}
                        >
                          {PLATFORM_LABELS[platform]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <div style={{ width: '1px', height: '32px', backgroundColor: theme.border.default, display: isMobile ? 'none' : 'block' }} />

            <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
              <label style={s.miniLabel}>Per Day</label>
              <div style={s.bulkPresets}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    style={{ ...s.presetChip, ...(postsPerDay === n ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
                    onClick={() => setPostsPerDay(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ width: '1px', height: '32px', backgroundColor: theme.border.default, display: isMobile ? 'none' : 'block' }} />

            <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
              <label style={s.miniLabel}>Spacing</label>
              <div style={s.bulkPresets}>
                <button
                  style={{ ...s.presetChip, ...(spacingMode === 'even' ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
                  onClick={() => setSpacingMode('even')}
                >
                  Even
                </button>
                {[
                  { label: '2hr', min: 120 },
                  { label: '3hr', min: 180 },
                  { label: '4hr', min: 240 },
                  { label: '6hr', min: 360 }
                ].map(p => (
                  <button
                    key={p.label}
                    style={{ ...s.presetChip, ...(spacingMode === 'fixed' && spacingMinutes === p.min ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
                    onClick={() => { setSpacingMinutes(p.min); setSpacingMode('fixed'); }}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  style={{ ...s.presetChip, ...(spacingMode === 'random' ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
                  onClick={() => setSpacingMode(spacingMode === 'random' ? 'even' : 'random')}
                >
                  Rand
                </button>
              </div>
            </div>

            <div style={{ width: '1px', height: '32px', backgroundColor: theme.border.default, display: isMobile ? 'none' : 'block' }} />

            <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
              <label style={s.miniLabel}>Start</label>
              <div style={{ display: 'flex', gap: '4px' }}>
                <input type="date" value={batchStartDate} onChange={(e) => setBatchStartDate(e.target.value)} style={s.miniInput} />
                <input type="time" value={batchStartTime} onChange={(e) => setBatchStartTime(e.target.value)} style={s.miniInput} />
              </div>
            </div>

            {spacingMode === 'random' && (
              <>
                <div style={{ width: '1px', height: '32px', backgroundColor: theme.border.default, display: isMobile ? 'none' : 'block' }} />
                <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
                  <label style={s.miniLabel}>Random Range (min)</label>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input type="number" value={batchRandomMin} onChange={(e) => setBatchRandomMin(Number(e.target.value))} style={{ ...s.miniInput, width: '60px' }} />
                    <span style={{ color: '#52525b', fontSize: '11px' }}>to</span>
                    <input type="number" value={batchRandomMax} onChange={(e) => setBatchRandomMax(Number(e.target.value))} style={{ ...s.miniInput, width: '60px' }} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Schedule + Publish buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', gap: '8px' }}>
            <button style={s.applyBtn} onClick={handleBatchScheduleSelected}>
              Schedule {selectedCount} Post{selectedCount !== 1 ? 's' : ''}
            </button>
            {publishableCount > 0 && (
              <button
                style={{ ...s.applyBtn, backgroundColor: '#059669', borderColor: '#10b981' }}
                onClick={handleBulkPublish}
              >
                Publish {publishableCount} Now
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ STATUS FILTER TABS ═══ */}
      <div style={{ ...s.filterBar, ...(isMobile ? { overflowX: 'auto', whiteSpace: 'nowrap', WebkitOverflowScrolling: 'touch', flexWrap: 'nowrap' } : {}) }}>
        {[
          { key: 'all', label: 'All' },
          { key: POST_STATUS.DRAFT, label: 'Drafts' },
          { key: POST_STATUS.SCHEDULED, label: 'Scheduled' },
          { key: POST_STATUS.POSTING, label: 'Posting' },
          { key: POST_STATUS.POSTED, label: 'Posted' },
          { key: POST_STATUS.FAILED, label: 'Failed' }
        ].map(tab => (
          <button
            key={tab.key}
            style={{ ...s.filterTab, ...(statusFilter === tab.key ? s.filterTabActive : {}) }}
            onClick={() => setStatusFilter(tab.key)}
          >
            {tab.label}
            {statusCounts[tab.key] > 0 && (
              <span style={s.badge}>{statusCounts[tab.key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ TOOLBAR — between filters and list ═══ */}
      <div style={{ ...s.toolbarRow, ...(isMobile ? { flexDirection: 'column', gap: '8px', alignItems: 'stretch' } : {}) }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', ...(isMobile ? { flexWrap: 'wrap' } : {}) }}>
          {!readOnly && (
            <>
              <button style={s.toolbarBtn} onClick={() => setShowAddModal(true)}>
                <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span> Add Drafts
              </button>
              <button style={s.toolbarBtn} onClick={handleRandomizeOrder}>
                <span style={{ fontSize: '14px', lineHeight: 1 }}>🔀</span> Shuffle
              </button>
              <button
                style={{ ...s.toolbarBtn, ...(queuePaused ? { backgroundColor: '#78350f', borderColor: '#f59e0b', color: '#fbbf24' } : {}) }}
                onClick={() => setQueuePaused(!queuePaused)}
              >
                <span style={{ fontSize: '14px', lineHeight: 1 }}>{queuePaused ? '▶' : '⏸'}</span> {queuePaused ? 'Resume' : 'Pause'}
              </button>
              <button
                style={{ ...s.toolbarBtn, ...(showCaptionBank ? { backgroundColor: '#312e81', borderColor: '#6366f1', color: '#a5b4fc' } : {}) }}
                onClick={() => setShowCaptionBank(!showCaptionBank)}
              >
                <span style={{ fontSize: '14px', lineHeight: 1 }}>#</span> Caption Bank
              </button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center', backgroundColor: theme.bg.surface, borderRadius: '8px', padding: '3px', border: `1px solid ${theme.border.default}` }}>
          <button
            style={{ ...s.viewToggleBtn, ...(viewMode === 'list' ? s.viewToggleBtnActive : {}) }}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
          <button
            style={{ ...s.viewToggleBtn, ...(viewMode === 'calendar' ? s.viewToggleBtnActive : {}) }}
            onClick={() => setViewMode('calendar')}
          >
            Calendar
          </button>
        </div>
      </div>

      {/* ═══ CAPTION/HASHTAG BANK PANEL ═══ */}
      {showCaptionBank && (
        <div style={{ borderBottom: `1px solid ${theme.border.default}`, maxHeight: '350px', overflow: 'hidden' }}>
          <CaptionHashtagBank
            db={db}
            artistId={artistId}
            compact={true}
            onBankChange={() => { loadAlwaysOnFromTemplates(); }}
            draftCount={posts.filter(p => p.status === POST_STATUS.DRAFT).length}
            onApplyToDrafts={handleApplyCategory}
          />
        </div>
      )}


      {/* ═══ MAIN CONTENT ═══ */}
      <div style={s.content}>
        {viewMode === 'list' ? (
          <div style={s.listContainer}>
            {/* Column Headers */}
            <div style={{ ...s.listHeader, ...(isMobile ? { display: 'none' } : {}) }}>
              <div style={{ width: '24px' }}>
                <input
                  type="checkbox"
                  checked={filteredPosts.length > 0 && filteredPosts.every(p => selectedPostIds.has(p.id))}
                  onChange={() => {
                    if (filteredPosts.every(p => selectedPostIds.has(p.id))) clearSelection();
                    else selectAllVisible();
                  }}
                  style={{ cursor: 'pointer', width: '14px', height: '14px' }}
                  title="Select all"
                />
              </div>
              <div style={{ width: '28px' }} />
              <div style={{ width: '44px' }} />
              <div style={{ flex: 1.2, minWidth: 0 }}>Content</div>
              <div style={{ width: '190px' }}>Schedule</div>
              <div style={{ width: '200px' }}>Caption</div>
              <div style={{ width: '80px', textAlign: 'center' }}>Status</div>
              <div style={{ width: '60px' }} />
            </div>

            {/* Post Rows */}
            <div style={s.listScroll}>
              {filteredPosts.length === 0 ? (
                <div style={s.emptyState}>
                  <p style={{ color: '#71717a', fontSize: '14px' }}>
                    {posts.length === 0 ? 'No posts yet. Add content from drafts to start scheduling.' : 'No posts match this filter.'}
                  </p>
                </div>
              ) : (
                filteredPosts.map((post, index) => (
                  <PostRow
                    key={post.id}
                    post={post}
                    index={index}
                    isExpanded={expandedPostId === post.id}
                    isSelected={selectedPostIds.has(post.id)}
                    isDragging={draggedId === post.id}
                    isDragOver={dragOverId === post.id}
                    isPaused={queuePaused}
                    accounts={accounts}
                    lateAccountIds={lateAccountIds}
                    alwaysOnHashtags={alwaysOnHashtags}
                    alwaysOnCaption={alwaysOnCaption}
                    onToggleSelect={() => togglePostSelection(post.id)}
                    onToggleExpand={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)}
                    onUpdate={(updates) => handleUpdatePost(post.id, updates)}
                    onTogglePlatform={(platform) => togglePlatform(post.id, platform)}
                    onSetPlatformAccount={(platform, accountId, handle) => setPlatformAccount(post.id, platform, accountId, handle)}
                    onDelete={() => handleDeletePost(post.id)}
                    onEditDraft={onEditDraft}
                    onPublish={() => handlePublishPost(post.id)}
                    onDragStart={(e) => handleDragStart(e, post.id)}
                    onDragOver={(e) => handleDragOver(e, post.id)}
                    onDrop={(e) => handleDrop(e, post.id)}
                    onDragEnd={handleDragEnd}
                    previewTime={previewTimes[post.id] || null}
                    readOnly={readOnly}
                    isMobile={isMobile}
                    isRendering={renderingPostId === post.id}
                    renderProgress={renderingPostId === post.id ? renderProgress : 0}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <CalendarView
            posts={filteredPosts}
            expandedPostId={expandedPostId}
            onSelectPost={(id) => setExpandedPostId(expandedPostId === id ? null : id)}
            isMobile={isMobile}
            calendarDate={calendarDate}
            onChangeMonth={setCalendarDate}
            onDragPost={(postId, fromDate, toDate) => {
              const post = posts.find(p => p.id === postId);
              if (post && post.scheduledTime) {
                const oldTime = new Date(post.scheduledTime);
                const timeOfDay = oldTime.getHours() * 60 + oldTime.getMinutes();
                const newDateTime = new Date(toDate);
                newDateTime.setHours(Math.floor(timeOfDay / 60), timeOfDay % 60, 0, 0);
                handleUpdatePost(postId, { scheduledTime: newDateTime.toISOString() });
              }
            }}
          />
        )}
      </div>

      {/* Add from Drafts Modal */}
      {showAddModal && (
        <AddFromDraftsModal
          artistId={artistId}
          existingContentIds={new Set(posts.map(p => p.contentId))}
          onAdd={handleAddFromDrafts}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ isOpen: false })}
      />
    </div>
  );
};

// ═══════════════════════════════════════════════════
// PostRow — Dense inline row with checkbox + all scheduling controls
// ═══════════════════════════════════════════════════

const PostRow = ({
  post, index, isExpanded, isSelected, isDragging, isDragOver, isPaused,
  accounts, lateAccountIds, alwaysOnHashtags, alwaysOnCaption,
  onToggleSelect, onToggleExpand, onUpdate, onTogglePlatform, onSetPlatformAccount,
  onDelete, onEditDraft, onPublish,
  onDragStart, onDragOver, onDrop, onDragEnd,
  previewTime,
  readOnly = false,
  isMobile = false,
  isRendering = false,
  renderProgress = 0
}) => {
  const { theme } = useTheme();
  const s = getS(theme);
  const [caption, setCaption] = useState(post.caption || '');
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');

  useEffect(() => {
    setCaption(post.caption || '');
    if (post.scheduledTime) {
      // Handle both Firestore Timestamp objects and ISO strings
      const raw = post.scheduledTime;
      const d = new Date(raw?.toDate ? raw.toDate() : raw);
      if (!isNaN(d.getTime())) {
        setSchedDate(d.toISOString().split('T')[0]);
        setSchedTime(d.toTimeString().substring(0, 5));
      } else {
        setSchedDate('');
        setSchedTime('');
      }
    } else {
      setSchedDate('');
      setSchedTime('');
    }
  }, [post.id, post.caption, post.scheduledTime]);

  const handleCaptionBlur = () => {
    if (caption !== (post.caption || '')) onUpdate({ caption });
  };

  const handleScheduleChange = (newDate, newTime) => {
    const d = newDate || schedDate;
    const t = newTime || schedTime;
    if (d && t) {
      onUpdate({ scheduledTime: new Date(`${d}T${t}`).toISOString() });
    }
  };

  const statusColor = {
    [POST_STATUS.DRAFT]: '#71717a',
    [POST_STATUS.SCHEDULED]: '#6366f1',
    [POST_STATUS.POSTING]: '#f59e0b',
    [POST_STATUS.POSTED]: '#10b981',
    [POST_STATUS.FAILED]: '#ef4444'
  }[post.status] || '#71717a';

  const statusBg = {
    [POST_STATUS.DRAFT]: theme?.border?.default || '#27272a',
    [POST_STATUS.SCHEDULED]: '#312e81',
    [POST_STATUS.POSTING]: '#78350f',
    [POST_STATUS.POSTED]: '#064e3b',
    [POST_STATUS.FAILED]: '#7f1d1d'
  }[post.status] || (theme?.border?.default || '#27272a');

  const previewImage = post.thumbnail || post.editorState?.thumbnail || post.editorState?.slides?.[0]?.backgroundImage || null;

  return (
    <div style={{ borderBottom: '1px solid #1e1e22' }}>
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        style={{
          ...s.row,
          ...(isDragOver ? { borderColor: '#a5b4fc', backgroundColor: '#1e1e30' } : {}),
          ...(isSelected ? { backgroundColor: '#12122a' } : {}),
          opacity: isDragging ? 0.4 : 1,
          position: 'relative',
          ...(isMobile ? { flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '12px 16px', flexWrap: 'wrap' } : {})
        }}
      >
        {isPaused && post.status === POST_STATUS.SCHEDULED && (
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: '0', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '14px', opacity: 0.5 }}>⏸</span>
          </div>
        )}

        {isRendering && (
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(99,102,241,0.1)', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.7)', padding: '4px 12px', borderRadius: '6px' }}>
              <div style={{ width: '80px', height: '4px', backgroundColor: '#27272a', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${renderProgress}%`, height: '100%', backgroundColor: '#6366f1', borderRadius: '2px', transition: 'width 0.3s' }} />
              </div>
              <span style={{ color: '#a5b4fc', fontSize: '11px', fontWeight: 600 }}>
                {renderProgress < 95 ? `Rendering ${Math.round(renderProgress)}%` : 'Uploading...'}
              </span>
            </div>
          </div>
        )}

        {/* Checkbox */}
        <div style={{ width: isMobile ? '44px' : '24px', minHeight: isMobile ? '44px' : 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            style={{ cursor: 'pointer', width: isMobile ? '20px' : '14px', height: isMobile ? '20px' : '14px', accentColor: '#6366f1' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Drag Handle + Number */}
        <div style={{ ...s.dragHandle, ...(isMobile ? { display: 'none' } : {}) }}>
          <span style={{ color: '#52525b', fontSize: '12px', cursor: 'grab' }}>{'\u2630'}</span>
          <span style={{ color: '#3f3f46', fontSize: '10px', fontWeight: '600' }}>#{index + 1}</span>
        </div>

        {/* Thumbnail */}
        <div style={s.thumb} onClick={onToggleExpand}>
          {previewImage ? (
            <img src={previewImage} alt="" style={s.thumbImg} />
          ) : (
            <span style={{ fontSize: '16px' }}>{post.contentType === 'slideshow' ? '🖼️' : '🎥'}</span>
          )}
        </div>

        {/* Content Name + Audio + Collection */}
        <div style={{ flex: 1.2, minWidth: 0, cursor: 'pointer' }} onClick={onToggleExpand}>
          <div style={s.contentName}>{post.contentName}</div>
          <div style={{ fontSize: '10px', color: '#52525b', marginTop: '1px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{post.contentType === 'slideshow' ? 'Slideshow' : 'Video'}</span>
            {post.collectionName && (
              <span style={{ color: '#14b8a6', fontSize: '9px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.2)' }} title={`From: ${post.collectionName}`}>
                {post.collectionName}
              </span>
            )}
            {post._isGhost && (
              <span style={{ color: '#f59e0b', fontSize: '9px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }} title="Original draft was deleted">
                orphan
              </span>
            )}
            {post.editorState?.audio && (
              <span style={{ color: '#6366f1', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={post.editorState.audio.name || post.editorState.audio.title || 'Audio'}>
                {post.editorState.audio.name || post.editorState.audio.title || 'Audio'}
              </span>
            )}
          </div>
        </div>

        {/* Schedule Date/Time — mobile stacks below, desktop inline */}
        {isMobile ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '32px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={schedDate} onChange={(e) => { setSchedDate(e.target.value); handleScheduleChange(e.target.value, null); }} style={{ ...s.inlineDate, flex: 1, minWidth: '120px' }} />
              <input type="time" value={schedTime} onChange={(e) => { setSchedTime(e.target.value); handleScheduleChange(null, e.target.value); }} style={{ ...s.inlineTime, flex: 1, minWidth: '90px' }} />
            </div>
            {previewTime && !post.scheduledTime && (() => {
              const pt = new Date(previewTime);
              return (
                <div style={{ fontSize: '10px', color: '#818cf8', fontStyle: 'italic', paddingLeft: '2px' }}>
                  {pt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {pt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              );
            })()}
            <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={handleCaptionBlur} placeholder="Caption..." style={{ ...s.inlineCaption, width: '100%' }} />
          </div>
        ) : (
          <>
            {/* Schedule Date/Time */}
            <div style={{ width: '190px', display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input type="date" value={schedDate} onChange={(e) => { setSchedDate(e.target.value); handleScheduleChange(e.target.value, null); }} style={s.inlineDate} />
                <input type="time" value={schedTime} onChange={(e) => { setSchedTime(e.target.value); handleScheduleChange(null, e.target.value); }} style={s.inlineTime} />
              </div>
              {previewTime && !post.scheduledTime && (() => {
                const pt = new Date(previewTime);
                return (
                  <div style={{ fontSize: '10px', color: '#818cf8', fontStyle: 'italic', paddingLeft: '2px' }}>
                    {pt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {pt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </div>
                );
              })()}
            </div>

            {/* Caption */}
            <div style={{ width: '200px', flexShrink: 0 }}>
              <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={handleCaptionBlur} placeholder="Caption..." style={s.inlineCaption} />
            </div>
          </>
        )}

        {/* Status */}
        <div style={{ width: isMobile ? 'auto' : '80px', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ ...s.statusPill, backgroundColor: statusBg, color: statusColor }}>{post.status}</span>
        </div>

        {/* Actions */}
        <div style={{ width: isMobile ? 'auto' : '60px', display: 'flex', gap: '4px', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button
            style={{ ...s.rowIconBtn, color: post.locked ? '#f59e0b' : '#52525b', fontSize: '13px', ...(isMobile ? { minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}) }}
            onClick={(e) => { e.stopPropagation(); onUpdate({ locked: !post.locked }); }}
            title={post.locked ? 'Unlock position' : 'Lock position (prevents reorder)'}
          >
            {post.locked ? '🔒' : '🔓'}
          </button>
          <button style={{ ...s.rowIconBtn, ...(isMobile ? { minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}) }} onClick={onToggleExpand} title="Expand details">
            <span style={{ fontSize: '12px', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▼</span>
          </button>
          {!readOnly && <button style={{ ...s.rowIconBtn, color: '#ef4444', ...(isMobile ? { minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}) }} onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Remove">x</button>}
        </div>
      </div>

      {/* Expanded Detail Drawer */}
      {isExpanded && (
        <ExpandedDrawer
          post={post}
          accounts={accounts}
          lateAccountIds={lateAccountIds}
          alwaysOnHashtags={alwaysOnHashtags}
          alwaysOnCaption={alwaysOnCaption}
          onUpdate={readOnly ? () => {} : onUpdate}
          onTogglePlatform={readOnly ? () => {} : onTogglePlatform}
          onSetPlatformAccount={readOnly ? () => {} : onSetPlatformAccount}
          onEditDraft={readOnly ? null : onEditDraft}
          onPublish={readOnly ? null : onPublish}
          readOnly={readOnly}
          isMobile={isMobile}
        />
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════
// ExpandedDrawer — Full details with tiered hashtags
// ═══════════════════════════════════════════════════

const ExpandedDrawer = ({ post, accounts, lateAccountIds, alwaysOnHashtags = [], alwaysOnCaption = '', onUpdate, onTogglePlatform, onSetPlatformAccount, onEditDraft, onPublish, readOnly = false, isMobile = false }) => {
  const { theme } = useTheme();
  const s = getS(theme);
  const [hashtags, setHashtags] = useState((post.hashtags || []).join(' '));
  const [hashtagBank, setHashtagBank] = useState([]);
  const [showSaveSet, setShowSaveSet] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  useEffect(() => {
    setHashtags((post.hashtags || []).join(' '));
  }, [post.id, post.hashtags]);

  useEffect(() => {
    const key = `stm_hashtag_bank_${post.id?.split('/')[0] || 'default'}`;
    const saved = localStorage.getItem(key);
    if (saved) { try { setHashtagBank(JSON.parse(saved)); } catch { setHashtagBank([]); } }
  }, [post]);

  const handleHashtagsBlur = () => {
    const tags = hashtags.split(/[\s,]+/).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`);
    if (tags.join(' ') !== (post.hashtags || []).join(' ')) onUpdate({ hashtags: tags });
  };

  const handleApplySet = (set) => { setHashtags(set.tags.join(' ')); onUpdate({ hashtags: set.tags }); };

  const handleSaveSet = () => {
    if (!newSetName.trim()) return;
    const tags = hashtags.split(/[\s,]+/).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`);
    const newSet = { id: Date.now().toString(), name: newSetName, tags };
    const updated = [...hashtagBank, newSet];
    localStorage.setItem(`stm_hashtag_bank_${post.id?.split('/')[0] || 'default'}`, JSON.stringify(updated));
    setHashtagBank(updated);
    setNewSetName('');
    setShowSaveSet(false);
  };

  const handleDeleteSet = (setId) => {
    const updated = hashtagBank.filter(s => s.id !== setId);
    localStorage.setItem(`stm_hashtag_bank_${post.id?.split('/')[0] || 'default'}`, JSON.stringify(updated));
    setHashtagBank(updated);
  };

  const availableHandles = useMemo(() => {
    const handles = new Set();
    accounts.forEach(acc => handles.add(acc.handle));
    return Array.from(handles);
  }, [accounts]);

  const selectedPlatforms = post.platforms || {};
  const previewImage = post.thumbnail || post.editorState?.thumbnail || post.editorState?.slides?.[0]?.backgroundImage || post.editorState?.slides?.[0]?.imageUrl || post.editorState?.clips?.[0]?.thumbnail || null;

  // Separate per-post tags from always-on tags
  const perPostTags = (post.hashtags || []).filter(t => !alwaysOnHashtags.includes(t));

  return (
    <div style={{ ...s.drawer, ...(isMobile ? { padding: '12px 16px' } : {}) }}>
      <div style={{ ...s.drawerGrid, ...(isMobile ? { gridTemplateColumns: '1fr', gap: '16px' } : {}) }}>
        {/* Left: Preview + Actions */}
        <div style={s.drawerLeft}>
          <div style={{ ...s.drawerPreview, ...(isMobile ? { width: '100%', height: '180px' } : {}) }}>
            {post.cloudUrl || post.editorState?.cloudUrl ? (
              <video src={post.cloudUrl || post.editorState?.cloudUrl} style={s.drawerVideo} controls muted playsInline />
            ) : previewImage ? (
              <img src={previewImage} alt="" style={s.drawerImg} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span style={{ fontSize: '32px' }}>{post.contentType === 'slideshow' ? '🖼️' : '🎥'}</span>
              </div>
            )}
          </div>
          <div style={s.drawerActions}>
            {!readOnly && post.editorState && onEditDraft && (
              <button style={s.drawerBtn} onClick={() => onEditDraft(post)}>Edit in Studio</button>
            )}
            {!readOnly && post.status === POST_STATUS.DRAFT && post.scheduledTime && (
              <button style={{ ...s.drawerBtn, backgroundColor: '#312e81', color: '#a5b4fc', borderColor: '#6366f1' }} onClick={onPublish}>
                Confirm & Push to Late
              </button>
            )}
            {!readOnly && post.status === POST_STATUS.SCHEDULED && (
              <>
                <button style={{ ...s.drawerBtn, backgroundColor: '#064e3b', color: '#6ee7b7', borderColor: '#10b981' }} onClick={onPublish}>
                  Publish Now
                </button>
                <button style={s.drawerBtn} onClick={() => onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null })}>
                  Revert to Draft
                </button>
              </>
            )}
            {!readOnly && post.status === POST_STATUS.FAILED && (
              <button style={{ ...s.drawerBtn, backgroundColor: '#78350f', color: '#fbbf24', borderColor: '#f59e0b' }} onClick={onPublish}>
                Retry
              </button>
            )}
            {!readOnly && (post.status === POST_STATUS.POSTING || post.status === POST_STATUS.FAILED) && (
              <button style={s.drawerBtn} onClick={() => onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null })}>
                Revert to Draft
              </button>
            )}
          </div>
        </div>

        {/* Center: Tiered Hashtags */}
        <div style={s.drawerCenter}>
          <label style={s.drawerLabel}>Hashtags</label>

          {/* Always-on tier (gray, locked) */}
          {alwaysOnHashtags.length > 0 && (
            <div style={{ marginBottom: '6px' }}>
              <span style={{ fontSize: '9px', color: '#52525b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Always-on (from templates)</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                {alwaysOnHashtags.map((tag, i) => (
                  <span key={i} style={s.alwaysOnPill}>{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Per-post tier (editable) */}
          <span style={{ fontSize: '9px', color: '#52525b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Per-post tags</span>
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            onBlur={handleHashtagsBlur}
            placeholder="#tag1 #tag2 #tag3"
            style={{ ...s.drawerInput, marginTop: '3px' }}
          />
          {perPostTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
              {perPostTags.map((tag, i) => (
                <span key={i} style={s.hashtagPill}>{tag}</span>
              ))}
            </div>
          )}

          {/* Hashtag Bank */}
          {hashtagBank.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <label style={s.drawerLabel}>Saved Sets</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {hashtagBank.map(set => (
                  <div key={set.id} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <button style={s.hashtagSetBtn} onClick={() => handleApplySet(set)} title={set.tags.join(' ')}>
                      {set.name} ({set.tags.length})
                    </button>
                    <button style={{ background: 'none', border: 'none', color: '#52525b', fontSize: '14px', cursor: 'pointer', padding: '0 2px' }} onClick={() => handleDeleteSet(set.id)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: '8px' }}>
            {!showSaveSet ? (
              <button style={s.linkBtn} onClick={() => setShowSaveSet(true)}>Save Current as Set</button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="text" value={newSetName} onChange={(e) => setNewSetName(e.target.value)} placeholder="Set name..." style={{ ...s.drawerInput, flex: 1 }} />
                <button style={{ ...s.drawerBtn, padding: '4px 12px' }} onClick={handleSaveSet}>Save</button>
                <button style={{ ...s.drawerBtn, padding: '4px 8px' }} onClick={() => setShowSaveSet(false)}>×</button>
              </div>
            )}
          </div>

          {/* Always-on caption from templates */}
          {alwaysOnCaption && (
            <div style={{ marginTop: '10px' }}>
              <label style={s.drawerLabel}>Always-on Caption</label>
              <div style={{ padding: '6px 8px', borderRadius: '6px', backgroundColor: theme.bg.input, border: `1px solid ${theme.border.default}`, fontSize: '11px', color: theme.text.secondary, fontStyle: 'italic' }}>
                {alwaysOnCaption}
              </div>
            </div>
          )}
        </div>

        {/* Right: Account Selection + Results */}
        <div style={{ ...s.drawerRight, ...(isMobile ? { width: '100%' } : {}) }}>
          {Object.keys(selectedPlatforms).length > 0 && (
            <div>
              <label style={s.drawerLabel}>Accounts</label>
              {Object.keys(selectedPlatforms).map(platform => (
                <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: PLATFORM_COLORS[platform], fontWeight: '600', width: '70px' }}>{PLATFORM_LABELS[platform]}</span>
                  <select
                    value={selectedPlatforms[platform]?.accountId || ''}
                    onChange={(e) => {
                      const handle = e.target.selectedOptions?.[0]?.dataset?.handle || '';
                      onSetPlatformAccount(platform, e.target.value, handle);
                    }}
                    style={s.accountSelect}
                  >
                    <option value="">Auto</option>
                    {availableHandles.map(handle => {
                      const mapping = lateAccountIds[handle];
                      const accountId = mapping?.[platform];
                      if (!accountId) return null;
                      return <option key={handle} value={accountId} data-handle={handle}>@{handle}</option>;
                    })}
                  </select>
                </div>
              ))}
            </div>
          )}

          {post.postResults && Object.keys(post.postResults).length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <label style={s.drawerLabel}>Results</label>
              {Object.entries(post.postResults).map(([platform, result]) => (
                <div key={platform} style={s.resultRow}>
                  <span style={{ color: PLATFORM_COLORS[platform] || '#fff', fontSize: '12px', fontWeight: '600' }}>
                    {PLATFORM_LABELS[platform] || platform}
                  </span>
                  {result.error ? (
                    <span style={{ color: '#ef4444', fontSize: '11px' }}>{result.error}</span>
                  ) : (
                    <span style={{ color: '#10b981', fontSize: '11px' }}>
                      Posted {result.url && <a href={result.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1', textDecoration: 'underline' }}>View</a>}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════
// AddFromDraftsModal
// ═══════════════════════════════════════════════════

const AddFromDraftsModal = ({ artistId, existingContentIds, onAdd, onClose }) => {
  const { theme } = useTheme();
  const s = getS(theme);
  const [content, setContent] = useState({ videos: [], slideshows: [] });
  const [selectedTab, setSelectedTab] = useState('all');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [loadingContent, setLoadingContent] = useState(true);

  useEffect(() => {
    const loadContent = async () => {
      try {
        const data = await getCreatedContent(artistId);
        setContent(data || { videos: [], slideshows: [] });
      } catch (err) { log.error('Failed to load content:', err); }
      setLoadingContent(false);
    };
    loadContent();
  }, [artistId]);

  const allItems = [
    ...content.videos.map(v => ({ ...v, type: 'video' })),
    ...content.slideshows.map(s => ({ ...s, type: 'slideshow' }))
  ];

  const tabItems = {
    all: allItems,
    videos: content.videos.map(v => ({ ...v, type: 'video' })),
    slideshows: content.slideshows.map(s => ({ ...s, type: 'slideshow' }))
  };

  const items = tabItems[selectedTab] || [];

  const handleSelectItem = (itemId) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(itemId)) newSet.delete(itemId); else newSet.add(itemId);
    setSelectedItems(newSet);
  };

  const handleSelectAll = () => {
    if (selectedItems.size === items.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(items.map(item => item.id)));
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <h2 style={s.modalTitle}>Add from Drafts</h2>
          <button style={s.modalClose} onClick={onClose}>×</button>
        </div>
        <div style={s.modalTabs}>
          {['all', 'videos', 'slideshows'].map(tab => (
            <button
              key={tab}
              style={{ ...s.filterTab, ...(selectedTab === tab ? s.filterTabActive : {}) }}
              onClick={() => { setSelectedTab(tab); setSelectedItems(new Set()); }}
            >
              {tab === 'all' ? 'All' : tab === 'videos' ? 'Videos' : 'Slideshows'}
            </button>
          ))}
        </div>
        {loadingContent ? (
          <div style={s.modalLoading}><div style={s.spinner} /><p style={{ color: '#71717a', marginTop: '16px' }}>Loading...</p></div>
        ) : (
          <>
            <div style={s.modalGrid}>
              {items.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: '#71717a', gridColumn: '1 / -1' }}>No content available</div>
              ) : items.map(item => {
                const isDuplicate = existingContentIds.has(item.id);
                const isSelected = selectedItems.has(item.id);
                return (
                  <div
                    key={item.id}
                    style={{ ...s.modalCard, ...(isSelected ? { borderColor: '#6366f1', backgroundColor: '#1e1e2e' } : {}), opacity: isDuplicate ? 0.6 : 1 }}
                    onClick={() => handleSelectItem(item.id)}
                  >
                    <div style={s.modalCardThumb}>
                      {item.thumbnail ? <img src={item.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
                        <span style={{ fontSize: '24px' }}>{item.type === 'slideshow' ? '🖼️' : '🎥'}</span>}
                      {isDuplicate && <div style={s.dupBadge}>Already queued</div>}
                      <input type="checkbox" checked={isSelected} onChange={() => handleSelectItem(item.id)} style={{ position: 'absolute', top: '6px', right: '6px', width: '16px', height: '16px' }} onClick={(e) => e.stopPropagation()} />
                    </div>
                    <div style={{ padding: '6px 8px' }}>
                      <p style={{ margin: 0, fontSize: '11px', fontWeight: '500', color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
                      {(item.collectionName || item.collectionId) && (
                        <p style={{ margin: '2px 0 0', fontSize: '9px', color: '#14b8a6' }}>{item.collectionName || item.collectionId}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={s.modalFooter}>
              <button style={s.drawerBtn} onClick={handleSelectAll}>
                {selectedItems.size === items.length ? 'Clear' : 'Select All'}
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={s.drawerBtn} onClick={onClose}>Cancel</button>
                <button
                  style={{ ...s.applyBtn, opacity: selectedItems.size === 0 ? 0.5 : 1 }}
                  onClick={() => onAdd(items.filter(i => selectedItems.has(i.id)))}
                  disabled={selectedItems.size === 0}
                >
                  Add {selectedItems.size > 0 ? `(${selectedItems.size})` : ''} to Queue
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════
// CalendarView
// ═══════════════════════════════════════════════════

const CalendarView = ({ posts, expandedPostId, onSelectPost, calendarDate, onChangeMonth, onDragPost, isMobile = false }) => {
  const { theme } = useTheme();
  const s = getS(theme);
  const [draggedPostId, setDraggedPostId] = useState(null);
  const [dragFromDate, setDragFromDate] = useState(null);

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days = [];
  for (let i = 0; i < startingDayOfWeek; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));

  const postsByDate = {};
  posts.forEach(post => {
    if (post.scheduledTime) {
      const dateKey = new Date(post.scheduledTime).toDateString();
      if (!postsByDate[dateKey]) postsByDate[dateKey] = [];
      postsByDate[dateKey].push(post);
    }
  });

  const today = new Date().toDateString();

  return (
    <div style={s.calView}>
      <div style={s.calHeader}>
        <button style={{ ...s.calNavBtn, ...(isMobile ? { width: '44px', height: '44px', fontSize: '20px' } : {}) }} onClick={() => onChangeMonth(new Date(year, month - 1))}>&#8249;</button>
        <span style={s.calTitle}>{firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button style={{ ...s.calNavBtn, ...(isMobile ? { width: '44px', height: '44px', fontSize: '20px' } : {}) }} onClick={() => onChangeMonth(new Date(year, month + 1))}>&#8250;</button>
        <button style={{ ...s.drawerBtn, marginLeft: '8px', padding: isMobile ? '8px 14px' : '4px 10px', minHeight: isMobile ? '44px' : 'auto' }} onClick={() => onChangeMonth(new Date())}>Today</button>
      </div>
      <div style={{ ...s.calGrid, ...(isMobile ? { padding: '4px' } : {}) }}>
        {(isMobile ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((d, i) => (
          <div key={`${d}-${i}`} style={s.calDayHeader}>{d}</div>
        ))}
        {days.map((date, idx) => {
          const dateKey = date?.toDateString();
          const dayPosts = dateKey ? (postsByDate[dateKey] || []) : [];
          const isToday = dateKey === today;
          return (
            <div
              key={idx}
              style={{ ...s.calCell, ...(isToday ? { borderColor: '#6366f1', borderWidth: '2px' } : {}), ...(isMobile ? { minHeight: '60px', padding: '3px' } : {}) }}
              onDragOver={date ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : null}
              onDrop={date ? (e) => { e.preventDefault(); if (draggedPostId && dragFromDate) onDragPost(draggedPostId, dragFromDate, date); setDraggedPostId(null); setDragFromDate(null); } : null}
            >
              {date && (
                <>
                  <div style={s.calCellDate}>{date.getDate()}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                    {dayPosts.map(post => (
                      <div
                        key={post.id}
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); setDraggedPostId(post.id); setDragFromDate(date); e.dataTransfer.effectAllowed = 'move'; }}
                        onClick={() => onSelectPost(post.id)}
                        style={{
                          padding: isMobile ? '1px 3px' : '2px 6px', borderRadius: isMobile ? '3px' : '4px', fontSize: isMobile ? '8px' : '10px', fontWeight: '500', color: '#fff', cursor: 'pointer',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          backgroundColor: { [POST_STATUS.DRAFT]: '#71717a', [POST_STATUS.SCHEDULED]: '#6366f1', [POST_STATUS.POSTING]: '#f59e0b', [POST_STATUS.POSTED]: '#10b981', [POST_STATUS.FAILED]: '#ef4444' }[post.status] || '#71717a',
                          ...(expandedPostId === post.id ? { boxShadow: '0 0 0 2px #6366f1' } : {}),
                          opacity: draggedPostId === post.id ? 0.5 : 1
                        }}
                        title={`${post.contentName} — ${new Date(post.scheduledTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                      >
                        {post.contentName.substring(0, isMobile ? 6 : 12)}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════

const getS = (theme) => ({
  page: { display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: theme.bg.page, color: theme.text.primary, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  loadingState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' },
  spinner: { width: '32px', height: '32px', border: `3px solid ${theme.border.default}`, borderTop: `3px solid ${theme.accent.primary}`, borderRadius: '50%', animation: 'spin 1s linear infinite' },

  // Header
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface, flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  backBtn: { background: 'none', border: `1px solid ${theme.border.default}`, color: theme.text.secondary, width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  pageTitle: { margin: 0, fontSize: '18px', fontWeight: '600', color: theme.text.primary },
  subtitle: { margin: '1px 0 0 0', fontSize: '12px', color: theme.text.muted },
  headerActions: { display: 'flex', gap: '6px', alignItems: 'center' },
  actionBtn: { padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.accent.primary}`, backgroundColor: 'transparent', color: theme.accent.hover, fontSize: '12px', fontWeight: '500', cursor: 'pointer', whiteSpace: 'nowrap' },
  actionBtnSm: { padding: '4px 10px', borderRadius: '6px', border: `1px solid ${theme.border.default}`, backgroundColor: 'transparent', color: theme.text.secondary, fontSize: '11px', fontWeight: '500', cursor: 'pointer', whiteSpace: 'nowrap' },
  iconBtn: { padding: '6px 10px', borderRadius: '8px', border: `1px solid ${theme.border.default}`, backgroundColor: 'transparent', color: theme.text.secondary, fontSize: '14px', cursor: 'pointer' },

  // Pause banner
  pauseBanner: { padding: '8px 20px', backgroundColor: '#78350f', color: '#fbbf24', fontSize: '12px', fontWeight: '500', borderBottom: `1px solid ${theme.border.default}`, flexShrink: 0 },

  // Bulk bar (batch-first)
  bulkBar: { padding: '12px 20px', backgroundColor: theme.bg.page, borderBottom: `2px solid ${theme.accent.primary}`, flexShrink: 0 },
  bulkRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' },
  bulkSection: { display: 'flex', flexDirection: 'column', gap: '4px' },
  bulkSelect: { padding: '5px 10px', borderRadius: '6px', border: `1px solid ${theme.accent.primary}`, backgroundColor: theme.bg.input, color: theme.accent.hover, fontSize: '12px', fontWeight: '500', cursor: 'pointer', minWidth: '150px' },
  assignBtn: { padding: '5px 10px', borderRadius: '6px', border: `1px solid ${theme.accent.primary}`, backgroundColor: theme.accent.muted, color: theme.accent.hover, fontSize: '11px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' },
  bulkPresets: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  presetChip: { padding: '5px 10px', borderRadius: '6px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.elevated, color: theme.text.secondary, fontSize: '11px', fontWeight: '600', cursor: 'pointer' },
  miniLabel: { fontSize: '9px', fontWeight: '600', color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' },
  miniInput: { padding: '5px 8px', borderRadius: '6px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.input, color: theme.text.primary, fontSize: '12px' },
  applyBtn: { padding: '6px 16px', borderRadius: '8px', border: 'none', backgroundColor: theme.accent.primary, color: theme.text.primary, fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' },

  // Filter bar
  filterBar: { display: 'flex', gap: '3px', padding: '8px 20px', borderBottom: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface, overflowX: 'auto', flexShrink: 0 },
  filterTab: { padding: '5px 12px', borderRadius: '6px', border: 'none', backgroundColor: 'transparent', color: theme.text.muted, fontSize: '12px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' },
  filterTabActive: { backgroundColor: theme.bg.elevated, color: theme.text.primary },
  badge: { backgroundColor: theme.border.default, color: theme.text.secondary, fontSize: '10px', padding: '1px 5px', borderRadius: '8px' },

  // Toolbar (between filters and list)
  toolbarRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 20px', borderBottom: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface, flexShrink: 0 },
  toolbarBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px', border: `1px solid ${theme.border.default}`, backgroundColor: 'transparent', color: theme.text.primary, fontSize: '13px', fontWeight: '500', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.12s' },
  viewToggleBtn: { padding: '5px 14px', borderRadius: '6px', border: 'none', backgroundColor: 'transparent', color: theme.text.muted, fontSize: '12px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.12s' },
  viewToggleBtnActive: { backgroundColor: theme.bg.elevated, color: theme.text.primary },

  // Content area
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },

  // List
  listContainer: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  listHeader: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderBottom: `1px solid ${theme.border.subtle}`, backgroundColor: theme.bg.surface, fontSize: '10px', fontWeight: '600', color: theme.text.secondary, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 },
  listScroll: { flex: 1, overflowY: 'auto' },
  emptyState: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 20px' },

  // Row
  row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 20px', backgroundColor: theme.bg.page, transition: 'background-color 0.1s', border: '1px solid transparent', cursor: 'default' },
  dragHandle: { width: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', flexShrink: 0 },
  thumb: { width: '44px', height: '56px', borderRadius: '6px', overflow: 'hidden', backgroundColor: theme.bg.input, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  contentName: { fontSize: '13px', fontWeight: '500', color: theme.bg.elevated, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  // Inline controls
  inlineDate: { width: '105px', padding: '4px 6px', borderRadius: '6px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface, color: theme.text.secondary, fontSize: '11px' },
  inlineTime: { width: '80px', padding: '4px 6px', borderRadius: '6px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface, color: theme.text.secondary, fontSize: '11px' },
  inlineCaption: { width: '100%', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface, color: theme.text.primary, fontSize: '11px', fontFamily: 'inherit' },

  // Status pill
  statusPill: { fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '10px', textTransform: 'capitalize', display: 'inline-block' },
  rowIconBtn: { background: 'none', border: 'none', color: '#52525b', fontSize: '14px', cursor: 'pointer', padding: '4px', borderRadius: '4px' },

  // Expanded drawer
  drawer: { backgroundColor: theme.bg.surface, borderTop: `1px solid ${theme.border.subtle}`, padding: '16px 20px 16px 100px' },
  drawerGrid: { display: 'grid', gridTemplateColumns: '180px 1fr 240px', gap: '20px' },
  drawerLeft: { display: 'flex', flexDirection: 'column', gap: '10px' },
  drawerPreview: { width: '180px', height: '140px', borderRadius: '8px', overflow: 'hidden', backgroundColor: theme.bg.page },
  drawerVideo: { width: '100%', height: '100%', objectFit: 'contain' },
  drawerImg: { width: '100%', height: '100%', objectFit: 'cover' },
  drawerActions: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  drawerBtn: { padding: '5px 12px', borderRadius: '6px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.elevated, color: theme.text.secondary, fontSize: '11px', fontWeight: '500', cursor: 'pointer' },
  drawerCenter: { flex: 1, minWidth: 0 },
  drawerRight: { width: '240px' },
  drawerLabel: { fontSize: '10px', fontWeight: '600', color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', display: 'block' },
  drawerInput: { width: '100%', padding: '6px 10px', borderRadius: '6px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.input, color: theme.text.primary, fontSize: '13px', fontFamily: 'inherit' },

  // Hashtag pills — tiered
  alwaysOnPill: { fontSize: '10px', color: theme.text.secondary, backgroundColor: theme.bg.elevated, padding: '2px 7px', borderRadius: '10px', border: `1px solid ${theme.border.default}` },
  hashtagPill: { fontSize: '11px', color: theme.accent.hover, backgroundColor: theme.accent.muted, padding: '2px 8px', borderRadius: '10px' },
  hashtagSetBtn: { padding: '3px 8px', borderRadius: '5px', border: `1px solid ${theme.accent.primary}`, backgroundColor: theme.accent.muted, color: theme.accent.hover, fontSize: '11px', fontWeight: '500', cursor: 'pointer' },
  linkBtn: { background: 'none', border: 'none', color: theme.accent.primary, fontSize: '11px', cursor: 'pointer', padding: '2px 0' },
  accountSelect: { flex: 1, padding: '4px 8px', borderRadius: '5px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.input, color: theme.bg.elevated, fontSize: '11px', cursor: 'pointer' },
  resultRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', backgroundColor: theme.bg.input, borderRadius: '6px', marginBottom: '4px' },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: theme.bg.surface, borderRadius: '12px', border: `1px solid ${theme.border.default}`, width: '90%', maxWidth: '700px', maxHeight: '75vh', display: 'flex', flexDirection: 'column' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${theme.border.default}` },
  modalTitle: { margin: 0, fontSize: '16px', fontWeight: '600', color: theme.text.primary },
  modalClose: { background: 'none', border: 'none', color: theme.text.muted, fontSize: '22px', cursor: 'pointer' },
  modalTabs: { display: 'flex', gap: '3px', padding: '8px 20px', borderBottom: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface },
  modalLoading: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px' },
  modalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px', padding: '14px 20px', overflow: 'auto', flex: 1 },
  modalCard: { display: 'flex', flexDirection: 'column', borderRadius: '8px', border: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.input, cursor: 'pointer', transition: 'all 0.1s', position: 'relative' },
  modalCardThumb: { width: '100%', height: '100px', backgroundColor: theme.bg.elevated, borderRadius: '7px 7px 0 0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dupBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#f59e0b', color: '#000', fontSize: '9px', fontWeight: '600', padding: '2px 0', textAlign: 'center' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderTop: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface },

  // Calendar
  calView: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  calHeader: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 20px', borderBottom: `1px solid ${theme.border.default}`, backgroundColor: theme.bg.surface },
  calNavBtn: { background: 'none', border: `1px solid ${theme.border.default}`, color: theme.text.secondary, width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  calTitle: { fontSize: '15px', fontWeight: '600', color: theme.text.primary, minWidth: '150px', textAlign: 'center' },
  calGrid: { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', padding: '8px', backgroundColor: theme.border.default, overflow: 'auto' },
  calDayHeader: { padding: '8px 6px', backgroundColor: theme.bg.surface, color: theme.text.muted, fontSize: '11px', fontWeight: '600', textAlign: 'center', textTransform: 'uppercase' },
  calCell: { backgroundColor: theme.bg.surface, padding: '6px', minHeight: '90px', display: 'flex', flexDirection: 'column', border: `1px solid ${theme.border.default}` },
  calCellDate: { fontSize: '11px', fontWeight: '600', color: theme.text.secondary, marginBottom: '3px' }
});

export default SchedulingPage;
