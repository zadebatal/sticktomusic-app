import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  POST_STATUS,
  PLATFORM_LABELS,
  PLATFORM_COLORS,
  updateScheduledPost,
  deleteScheduledPost,
  subscribeToScheduledPosts,
  reorderPosts,
  addManyScheduledPosts,
} from '../../services/scheduledPostsService';
import { getTemplates, generateFromTemplate } from '../../services/contentTemplateService';
import { getLinkGroups, expandLinkedAccounts } from '../../utils/pageLinkGroups';

import { useToast, ConfirmDialog } from '../ui';
import {
  getCreatedContent,
  getCollections,
  getCollectionHashtagBank,
  getCollectionCaptionBank,
  getLibrary,
  getProjects,
  getProjectNiches,
} from '../../services/libraryService';
import { renderVideo } from '../../services/videoExportService';
import {
  exportSlideshowAsImages,
  generateSlideThumbnail,
} from '../../services/slideshowExportService';
import { uploadFile, uploadFileWithQuota } from '../../services/firebaseStorage';
import { startPolling } from '../../services/postStatusPolling';
import { getAuth } from 'firebase/auth';
import log from '../../utils/logger';
import { useTheme } from '../../contexts/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { IconButton } from '../../ui/components/IconButton';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { Loader } from '../../ui/components/Loader';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import {
  FeatherPlus,
  FeatherShuffle,
  FeatherPause,
  FeatherPlay,
  FeatherList,
  FeatherCalendar,
  FeatherChevronDown,
  FeatherTrash2,
  FeatherX,
  FeatherUser,
  FeatherGripVertical,
  FeatherEdit,
  FeatherEdit2,
  FeatherSend,
  FeatherRotateCcw,
  FeatherLock,
  FeatherUnlock,
  FeatherChevronUp,
  FeatherChevronLeft,
  FeatherChevronRight,
  FeatherMusic,
  FeatherUploadCloud,
  FeatherRefreshCw,
} from '@subframe/core';
import UploadFinishedMediaModal from './UploadFinishedMediaModal';
import * as SubframeCore from '@subframe/core';

/**
 * SchedulingPage — Batch-First Command Center
 *
 * Primary workflow: select many posts → assign account + platforms → set cadence → schedule all.
 * Everything visible at once. Bulk bar auto-appears when posts are selected.
 * Three-tier hashtag system: always-on (from templates) + campaign (batch) + per-post.
 */
const SchedulingPage = ({
  db,
  user = null,
  artistId,
  accounts = [],
  lateAccountIds = {},
  onEditDraft,
  onSchedulePost,
  onDeleteLatePost,
  onBack,
  readOnly = false,
  visibleArtists = [],
  onArtistChange,
  initialStatusFilter = null,
}) => {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const { theme } = useTheme();
  const { isMobile } = useIsMobile();
  const s = getS(theme);

  // ── Core State ──
  const [posts, setPosts] = useState([]);
  const postsRef = useRef(posts);
  postsRef.current = posts;
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
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter || 'all');
  // Sync initialStatusFilter when navigating from dashboard
  useEffect(() => {
    if (initialStatusFilter) setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);
  // Reset all batch/selection state when artist changes
  useEffect(() => {
    setSelectedPostIds(new Set());
    setBatchAccount('');
    setBatchStartDate('');
    setBatchStartTime('14:00');
    setPostsPerDay(2);
    setStatusFilter(initialStatusFilter || 'all');
    setExpandedPostId(null);
    setPreviewingPost(null);
  }, [artistId]); // Only reset on artist change, not when initialStatusFilter changes
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const [previewingPost, setPreviewingPost] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // ── BATCH SELECT STATE (new — batch-first) ──
  const [selectedPostIds, setSelectedPostIds] = useState(new Set());

  // ── Batch schedule controls ──
  const [batchAccount, setBatchAccount] = useState('');
  const [batchPlatforms, setBatchPlatforms] = useState({}); // { tiktok: true, instagram: true, ... }
  const [batchStartDate, setBatchStartDate] = useState('');
  // Mirror text used by the date input — kept separate so partial typing
  // doesn't fight with the controlled ISO state. Commits to batchStartDate
  // on blur or Enter via commitBatchStartDate() (BUG #2 fix).
  const [batchStartDateInput, setBatchStartDateInput] = useState('');
  const [batchStartTime, setBatchStartTime] = useState('14:00');
  // Mirror text used by the time input — same pattern as the date mirror
  // above. Native <input type="time"> mangles typed input on macOS Safari
  // and Chrome (typing "5:55 PM" produces "02:05 PM" because of segmented
  // input parsing), so we use a free-form text input that commits via
  // parseTimeText() on blur or Enter.
  const [batchStartTimeInput, setBatchStartTimeInput] = useState('14:00');
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
    return posts.filter((p) => p.status === statusFilter);
  }, [posts, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { all: posts.length };
    Object.values(POST_STATUS).forEach((s) => {
      counts[s] = posts.filter((p) => p.status === s).length;
    });
    return counts;
  }, [posts]);

  const draftCount = useMemo(
    () => posts.filter((p) => p.status === POST_STATUS.DRAFT).length,
    [posts],
  );
  const selectedCount = selectedPostIds.size;
  const hasSelection = selectedCount > 0;

  // Mirror batchStartDate → batchStartDateInput when external state changes
  useEffect(() => {
    setBatchStartDateInput(batchStartDate);
  }, [batchStartDate]);

  // Parse free-form date text (MM/DD/YYYY, M/D/YYYY, or ISO YYYY-MM-DD) and
  // commit to the controlled batchStartDate state. Reverts to last good value
  // if the input is unparseable. Called on blur or Enter (BUG #2 fix).
  const commitBatchStartDate = useCallback(() => {
    const text = (batchStartDateInput || '').trim();
    if (!text) {
      setBatchStartDate('');
      return;
    }
    // ISO YYYY-MM-DD (browser picker output)
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const d = new Date(text);
      if (!isNaN(d.getTime())) {
        setBatchStartDate(text);
        return;
      }
    }
    // MM/DD/YYYY or M/D/YYYY (typed)
    const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const mm = mdy[1].padStart(2, '0');
      const dd = mdy[2].padStart(2, '0');
      const yyyy = mdy[3];
      const isoStr = `${yyyy}-${mm}-${dd}`;
      const d = new Date(isoStr);
      if (!isNaN(d.getTime())) {
        setBatchStartDate(isoStr);
        setBatchStartDateInput(isoStr);
        return;
      }
    }
    // Unparseable — revert to last good value
    setBatchStartDateInput(batchStartDate || '');
  }, [batchStartDateInput, batchStartDate]);

  // Mirror batchStartTime → batchStartTimeInput when external state changes
  useEffect(() => {
    setBatchStartTimeInput(batchStartTime);
  }, [batchStartTime]);

  // Parse free-form time text into HH:MM 24-hour format. Accepts:
  //   "5:55 PM" / "5:55pm" / "05:55 PM" → "17:55"
  //   "5:55"  (24h, no suffix)         → "05:55"
  //   "17:55"                          → "17:55"
  //   "555" / "1755"                   → "05:55" / "17:55"
  // Returns null on unparseable input. Used by both batch and per-row time
  // inputs (BUG-A fix).
  const parseTimeText = (raw) => {
    const text = (raw || '').trim();
    if (!text) return '';
    // Strip surrounding whitespace and uppercase the AM/PM bit
    const normalized = text.toUpperCase().replace(/\s+/g, ' ');
    // 24-hour ISO HH:MM directly
    const iso24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (iso24) {
      const hh = parseInt(iso24[1], 10);
      const mm = parseInt(iso24[2], 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    // 12-hour with AM/PM: "5:55 PM" / "5:55PM" / "05:55 AM"
    const ampm = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (ampm) {
      let hh = parseInt(ampm[1], 10);
      const mm = parseInt(ampm[2], 10);
      const suffix = ampm[3];
      if (hh >= 1 && hh <= 12 && mm >= 0 && mm <= 59) {
        if (suffix === 'PM' && hh !== 12) hh += 12;
        if (suffix === 'AM' && hh === 12) hh = 0;
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    // Bare digits: "555" → 5:55, "1755" → 17:55, "1230" → 12:30
    const digits = normalized.replace(/\D/g, '');
    if (digits.length === 3 || digits.length === 4) {
      const hh = parseInt(digits.slice(0, digits.length - 2), 10);
      const mm = parseInt(digits.slice(-2), 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    return null;
  };

  const commitBatchStartTime = useCallback(() => {
    const parsed = parseTimeText(batchStartTimeInput);
    if (parsed === null) {
      // Unparseable — revert
      setBatchStartTimeInput(batchStartTime || '14:00');
      return;
    }
    setBatchStartTime(parsed);
    setBatchStartTimeInput(parsed);
  }, [batchStartTimeInput, batchStartTime]);

  // Available handles for account picker — scoped to current artist (BUG-B).
  // Without this filter, the dropdown listed every connected handle across
  // every artist in the workspace; picking a non-current-artist account got
  // a Late.co rejection ("One or more accounts do not belong to this user")
  // because each artist has its own Late API key. We filter twice for
  // safety: by artistId if the field is present (Late accounts), AND by
  // dropping any handles that don't appear in the current artist's
  // lateAccountIds map (manual accounts).
  const availableHandles = useMemo(() => {
    const handles = new Set();
    const validHandlesInMap = new Set(Object.keys(lateAccountIds || {}));
    accounts.forEach((acc) => {
      if (acc.artistId && artistId && acc.artistId !== artistId) return;
      if (validHandlesInMap.size > 0 && !validHandlesInMap.has(acc.handle)) return;
      handles.add(acc.handle);
    });
    return Array.from(handles);
  }, [accounts, artistId, lateAccountIds]);

  // Linked-handle clusters for the dropdown. When the user has linked two
  // handles via the Pages tab (e.g. @your.daily.dose.of.pain.7 + @pain7),
  // they should appear as ONE dropdown entry that, when selected, posts
  // to all platforms across all linked siblings. The cluster's "primary"
  // is the alphabetically-first handle for determinism.
  const handleClusters = useMemo(() => {
    if (availableHandles.length === 0) return [];
    const groups = getLinkGroups();
    // Index linkGroupId per handle
    const handleToGroup = new Map();
    Object.entries(groups).forEach(([gid, members]) => {
      members.forEach((m) => {
        if (m.artistId === artistId) {
          handleToGroup.set(m.handle.replace(/^@/, '').toLowerCase(), gid);
        }
      });
    });
    // Bucket the visible handles into clusters by linkGroupId. Solo handles
    // get a unique synthetic clusterKey so they each render as their own row.
    const clustersByKey = new Map();
    for (const h of availableHandles) {
      const norm = h.replace(/^@/, '').toLowerCase();
      const gid = handleToGroup.get(norm);
      const clusterKey = gid ? `link:${gid}` : `solo:${h}`;
      const bucket = clustersByKey.get(clusterKey) || {
        clusterKey,
        linkGroupId: gid || null,
        members: [],
      };
      bucket.members.push(h);
      clustersByKey.set(clusterKey, bucket);
    }
    // Materialize each cluster: pick a primary, collect all platforms from
    // all members, build a label.
    return Array.from(clustersByKey.values()).map((cluster) => {
      const sortedMembers = [...cluster.members].sort();
      const primary = sortedMembers[0];
      const allPlatforms = new Set();
      const platformByHandle = {};
      sortedMembers.forEach((h) => {
        const mapping = lateAccountIds[h] || {};
        const enabled = Object.keys(mapping).filter((p) => mapping[p]);
        platformByHandle[h] = enabled;
        enabled.forEach((p) => allPlatforms.add(p));
      });
      const platformList = Array.from(allPlatforms);
      const platformNames = platformList.map((p) => PLATFORM_LABELS[p] || p).join(', ');
      const linkedSuffix = sortedMembers.length > 1 ? ` + ${sortedMembers.length - 1} linked` : '';
      const label = platformNames
        ? `@${primary}${linkedSuffix} (${platformNames})`
        : `@${primary}${linkedSuffix}`;
      return {
        clusterKey: cluster.clusterKey,
        primary,
        members: sortedMembers,
        platforms: platformList,
        platformByHandle,
        label,
        isLinked: sortedMembers.length > 1,
      };
    });
  }, [availableHandles, artistId, lateAccountIds]);

  // Enriched handles for the dropdown — one entry per cluster, primary
  // handle as the value (so existing batchAccount string state stays
  // backward-compatible). Selecting a primary expands to all linked
  // siblings via expandLinkedAccounts at the post-build step.
  const enrichedHandles = useMemo(
    () =>
      handleClusters.map((c) => ({
        handle: c.primary,
        platforms: c.platforms,
        label: c.label,
      })),
    [handleClusters],
  );

  // Find the cluster the currently-selected batchAccount belongs to.
  const activeCluster = useMemo(
    () => handleClusters.find((c) => c.members.includes(batchAccount)) || null,
    [handleClusters, batchAccount],
  );

  // All platforms across the active cluster's linked members.
  const linkedPlatforms = useMemo(() => activeCluster?.platforms || [], [activeCluster]);

  // Auto-enable all linked platforms when account changes (now spans the
  // entire cluster, not just the primary handle).
  useEffect(() => {
    if (!batchAccount || !activeCluster) {
      setBatchPlatforms({});
      return;
    }
    const enabled = {};
    activeCluster.platforms.forEach((p) => {
      enabled[p] = true;
    });
    setBatchPlatforms(enabled);
  }, [batchAccount, activeCluster]);

  // ── Live preview: compute projected schedule times for selected posts ──
  const previewTimes = useMemo(() => {
    if (!batchStartDate || selectedCount === 0) return {};
    const selectedPosts = posts.filter((p) => selectedPostIds.has(p.id));
    if (selectedPosts.length === 0) return {};
    const startTime = new Date(`${batchStartDate}T${batchStartTime}`);
    if (isNaN(startTime.getTime())) return {};

    const WAKING_MINUTES = 960;
    const effectiveSpacing =
      spacingMode === 'even'
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
  }, [
    batchStartDate,
    batchStartTime,
    postsPerDay,
    spacingMode,
    spacingMinutes,
    batchRandomMin,
    batchRandomMax,
    selectedPostIds,
    selectedCount,
    posts,
  ]);

  // ── Load & Subscribe (with ghost draft detection) ──
  useEffect(() => {
    if (!db || !artistId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Build media library lookup maps for thumbnail repair
    const libraryItems = getLibrary(artistId);
    const idToItem = new Map();
    const urlToThumb = new Map();
    libraryItems.forEach((item) => {
      if (item.id) idToItem.set(item.id, item);
      if (item.url) urlToThumb.set(item.url, item.thumbnailUrl || item.url);
    });

    const unsubscribe = subscribeToScheduledPosts(db, artistId, (newPosts) => {
      // Recalculate draft IDs on every update (not just once at init)
      // so orphan detection stays fresh after draft deletions
      let draftIds = new Set();
      let contentMap = new Map();
      try {
        const content = getCreatedContent(artistId);
        (content.videos || []).forEach((v) => {
          draftIds.add(v.id);
          contentMap.set(v.id, v);
        });
        (content.slideshows || []).forEach((s) => {
          draftIds.add(s.id);
          contentMap.set(s.id, s);
        });
      } catch (e) {
        /* no local content yet */
      }

      const now = new Date();
      // Tag posts whose source draft no longer exists + detect overdue posts
      const tagged = newPosts.map((p) => {
        const isGhost = p.contentId ? !draftIds.has(p.contentId) : false;
        // Mark scheduled posts with past dates as "missed" for display
        let computedStatus = p.status;
        if (p.status === POST_STATUS.SCHEDULED && p.scheduledTime) {
          const scheduledDate = new Date(p.scheduledTime);
          const minutesOverdue = (now - scheduledDate) / (60 * 1000);
          if (minutesOverdue > 30 && !p.latePostId) {
            computedStatus = 'missed';
          }
        }

        // Repair missing thumbnails by looking up source media in library
        let repairedThumb = null;
        if (!getPostThumb(p)) {
          const source = p.contentId ? contentMap.get(p.contentId) : null;
          const es = source || p.editorState;
          if (es) {
            // 1. Try sourceImageId on slides → match to library item
            const slides = es.slides || [];
            for (const slide of slides) {
              if (slide.sourceImageId && idToItem.has(slide.sourceImageId)) {
                const libItem = idToItem.get(slide.sourceImageId);
                repairedThumb = libItem.thumbnailUrl || libItem.url;
                break;
              }
              const bg = slide.backgroundImage || slide.thumbnail || slide.imageA?.url;
              if (bg && !bg.startsWith('blob:')) {
                repairedThumb = bg;
                break;
              }
            }
            // 2. Try video clips → match clip source to library
            if (!repairedThumb) {
              for (const clip of es.clips || []) {
                if (clip.sourceMediaId && idToItem.has(clip.sourceMediaId)) {
                  const libItem = idToItem.get(clip.sourceMediaId);
                  repairedThumb = libItem.thumbnailUrl || libItem.url;
                  break;
                }
                if (clip.id && idToItem.has(clip.id)) {
                  const libItem = idToItem.get(clip.id);
                  repairedThumb = libItem.thumbnailUrl || libItem.url;
                  break;
                }
                const url = clip.thumbnailUrl || clip.thumbnail || clip.url;
                if (url && !url.startsWith('blob:')) {
                  repairedThumb = url;
                  break;
                }
              }
            }
            // 3. Try montage photos
            if (!repairedThumb) {
              for (const photo of es.montagePhotos || []) {
                if (photo.id && idToItem.has(photo.id)) {
                  const libItem = idToItem.get(photo.id);
                  repairedThumb = libItem.thumbnailUrl || libItem.url;
                  break;
                }
                const url = photo.thumbnailUrl || photo.url;
                if (url && !url.startsWith('blob:')) {
                  repairedThumb = url;
                  break;
                }
              }
            }
          }
        }

        return {
          ...p,
          _isGhost: isGhost,
          _computedStatus: computedStatus,
          _repairedThumb: repairedThumb,
        };
      });
      setPosts(tagged);
      setLoading(false);
    });

    // Start polling for overdue SCHEDULED posts (checks if they're actually live on Late.co)
    // Use ref to avoid re-creating subscription when posts change
    const stopPolling = startPolling(
      db,
      artistId,
      () => postsRef.current,
      (event) => {
        if (event.type === 'posted') toastSuccess(`"${event.contentName}" just went live!`);
        if (event.type === 'failed') toastError(`"${event.contentName}" failed to post`);
      },
    );

    return () => {
      unsubscribe();
      stopPolling();
    };
  }, [db, artistId]);

  // ── Backfill latePostId from Late.co for posts missing it ──
  // Runs once per artist (re-runs on artist switch)
  const backfillRanRef = useRef(false);
  const backfillArtistRef = useRef(artistId);
  if (backfillArtistRef.current !== artistId) {
    backfillRanRef.current = false;
    backfillArtistRef.current = artistId;
  }
  useEffect(() => {
    if (backfillRanRef.current || loading || posts.length === 0 || !artistId) return;
    // Only run if some scheduled posts are missing latePostId
    const scheduled = posts.filter((p) => p.status === 'scheduled' || p.status === 'partial');
    const missing = scheduled.filter((p) => !p.latePostId);
    if (missing.length === 0) {
      backfillRanRef.current = true;
      return;
    }
    backfillRanRef.current = true;

    (async () => {
      try {
        log('[Schedule] Backfill: found', missing.length, 'scheduled posts without latePostId');
        const token = await getAuth().currentUser?.getIdToken();
        if (!token) return;

        // Fetch all posts from Late.co
        let allLatePosts = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const resp = await fetch(`/api/late?action=posts&page=${page}&artistId=${artistId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!resp.ok) break;
          const data = await resp.json();
          const latePosts = data.posts || data.data || [];
          if (Array.isArray(latePosts) && latePosts.length > 0) {
            allLatePosts = [...allLatePosts, ...latePosts];
            page++;
            if (latePosts.length < 50) hasMore = false;
          } else {
            hasMore = false;
          }
          if (page > 10) hasMore = false;
        }

        if (allLatePosts.length === 0) {
          log('[Schedule] Backfill: no Late posts found');
          return;
        }
        log('[Schedule] Backfill: fetched', allLatePosts.length, 'Late posts');

        // Log first Late post structure for debugging
        if (allLatePosts[0]) {
          log('[Schedule] Late post sample keys:', Object.keys(allLatePosts[0]).join(', '));
          log('[Schedule] Late post sample:', JSON.stringify(allLatePosts[0]).substring(0, 500));
        }

        // Match by scheduledTime (within 2 min tolerance) + content similarity
        let matched = 0;
        let posted = 0;
        for (const localPost of missing) {
          const localTime = localPost.scheduledTime
            ? new Date(localPost.scheduledTime).getTime()
            : 0;
          const localCaption = (localPost.caption || '').toLowerCase().trim();

          const match = allLatePosts.find((lp) => {
            const lateId = lp._id || lp.id;
            // Skip already-matched Late posts
            if (!lateId) return false;

            // Match by time (within 2 minutes)
            const lateTime = lp.scheduledFor ? new Date(lp.scheduledFor).getTime() : 0;
            const timeDiff = Math.abs(localTime - lateTime);
            if (timeDiff > 120000) return false;

            // Match by content if available
            const lateContent = (lp.content || '').toLowerCase().trim();
            if (localCaption && lateContent) {
              return lateContent.includes(localCaption.substring(0, 20));
            }
            // If no caption to compare, time match is enough
            return true;
          });

          if (match) {
            const latePostId = match._id || match.id;
            const lateStatus = (match.status || '').toLowerCase();
            const updates = { latePostId };
            // If Late.co shows the post as published/live, update our status too
            if (lateStatus === 'published' || lateStatus === 'live') {
              updates.status = 'posted';
              updates.postedAt =
                match.published_at || match.publishedAt || new Date().toISOString();
              log('[Schedule] Backfill matched + POSTED:', localPost.id, '→', latePostId);
            } else if (lateStatus === 'failed') {
              updates.status = 'failed';
              updates.errorMessage = match.error || 'Post failed on Late.co';
              log('[Schedule] Backfill matched + FAILED:', localPost.id, '→', latePostId);
            } else {
              log(
                '[Schedule] Backfill matched:',
                localPost.id,
                '→',
                latePostId,
                '(status:',
                lateStatus,
                ')',
              );
            }
            await updateScheduledPost(db, artistId, localPost.id, updates);
            matched++;
            if (updates.status === 'posted') posted++;
            // Remove from pool so it's not matched again
            const idx = allLatePosts.indexOf(match);
            if (idx >= 0) allLatePosts.splice(idx, 1);
          }
        }

        if (matched > 0) {
          log('[Schedule] Backfill complete:', matched, 'linked,', posted, 'marked posted');
          if (posted > 0) {
            toastSuccess(`${posted} post${posted !== 1 ? 's' : ''} already went live on Late.co`);
          } else {
            toastSuccess(`Linked ${matched} post${matched !== 1 ? 's' : ''} to Late.co`);
          }
        } else {
          log('[Schedule] Backfill: no matches found');
        }
      } catch (err) {
        log.warn('[Schedule] Backfill error:', err);
      }
    })();
  }, [posts, loading, artistId, db, toastSuccess]);

  // ── Manual sync with Late.co — fetch all Late posts, match + update status ──
  const [syncing, setSyncing] = useState(false);
  const handleSyncWithLate = useCallback(async () => {
    if (!db || !artistId || syncing) return;
    setSyncing(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) {
        toastError('Not authenticated');
        setSyncing(false);
        return;
      }

      // Fetch all Late posts (paginated)
      let allLatePosts = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const resp = await fetch(`/api/late?action=posts&page=${page}&artistId=${artistId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          log.warn('[Sync] Late API returned', resp.status);
          break;
        }
        const data = await resp.json();
        const latePosts = data.posts || data.data || [];
        if (Array.isArray(latePosts) && latePosts.length > 0) {
          allLatePosts = [...allLatePosts, ...latePosts];
          page++;
          if (latePosts.length < 50) hasMore = false;
        } else {
          hasMore = false;
        }
        if (page > 10) hasMore = false;
      }

      log('[Sync] Fetched', allLatePosts.length, 'Late posts');
      if (allLatePosts.length > 0) {
        log('[Sync] Sample Late post:', JSON.stringify(allLatePosts[0]).substring(0, 500));
      }

      if (allLatePosts.length === 0) {
        toastError('No posts found on Late.co');
        setSyncing(false);
        return;
      }

      // Match local scheduled posts to Late posts
      const scheduled = postsRef.current.filter((p) => p.status === 'scheduled');
      let linked = 0;
      let posted = 0;
      let failed = 0;

      for (const localPost of scheduled) {
        const localTime = localPost.scheduledTime ? new Date(localPost.scheduledTime).getTime() : 0;
        const localCaption = (localPost.caption || '').toLowerCase().trim();

        const match = allLatePosts.find((lp) => {
          const lateId = lp._id || lp.id;
          if (!lateId) return false;
          // Match by time (within 5 min tolerance)
          const lateTime = lp.scheduledFor ? new Date(lp.scheduledFor).getTime() : 0;
          if (Math.abs(localTime - lateTime) > 5 * 60 * 1000) return false;
          // Match by caption if available
          const lateContent = (lp.content || '').toLowerCase().trim();
          if (localCaption && lateContent) {
            return lateContent.includes(localCaption.substring(0, 20));
          }
          return true;
        });

        if (match) {
          const latePostId = match._id || match.id;
          const lateStatus = (match.status || '').toLowerCase();
          const updates = { latePostId };

          if (lateStatus === 'published' || lateStatus === 'live') {
            updates.status = 'posted';
            updates.postedAt = match.published_at || match.publishedAt || new Date().toISOString();
            posted++;
          } else if (lateStatus === 'failed') {
            updates.status = 'failed';
            updates.errorMessage = match.error || 'Post failed on Late.co';
            failed++;
          }
          await updateScheduledPost(db, artistId, localPost.id, updates);
          linked++;
          // Remove from pool
          const idx = allLatePosts.indexOf(match);
          if (idx >= 0) allLatePosts.splice(idx, 1);
        }
      }

      const parts = [];
      if (posted > 0) parts.push(`${posted} posted`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (linked > posted + failed) parts.push(`${linked - posted - failed} linked`);
      if (parts.length > 0) {
        toastSuccess(`Synced with Late: ${parts.join(', ')}`);
      } else {
        toastError(
          `No matches found (${scheduled.length} scheduled, ${allLatePosts.length + linked} on Late)`,
        );
      }
      log('[Sync] Done:', linked, 'linked,', posted, 'posted,', failed, 'failed');
    } catch (err) {
      log.error('[Sync] Error:', err);
      toastError('Sync failed: ' + (err.message || 'Unknown error'));
    }
    setSyncing(false);
  }, [db, artistId, syncing, toastSuccess, toastError]);

  useEffect(() => {
    const now = new Date();
    setBatchStartDate(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    );
  }, []);

  // Per-niche hashtag/caption bank map: keyed by both collection ID and name
  const nicheBankMap = useMemo(() => {
    const map = {};
    const cols = getCollections(artistId);
    cols.forEach((c) => {
      const hb = getCollectionHashtagBank(c);
      const cb = getCollectionCaptionBank(c);
      const hashtags = [...(hb.always || []), ...(hb.pool || [])];
      // Also handle flat array format (Session 65 migration)
      const flatHashtags = Array.isArray(c.hashtagBank) ? c.hashtagBank : [];
      const flatCaptions = Array.isArray(c.captionBank) ? c.captionBank : [];
      const allHashtags = hashtags.length > 0 ? hashtags : flatHashtags;
      const captions = [...(cb.always || []), ...(cb.pool || []), ...flatCaptions];
      const rawBank = c.hashtagBank || {};
      const platformOnly = (!Array.isArray(rawBank) && rawBank.platformOnly) || {};
      const platformExclude = (!Array.isArray(rawBank) && rawBank.platformExclude) || {};
      const alwaysH = Array.isArray(c.hashtagBank) ? c.hashtagBank : hb.always || [];
      const poolH = Array.isArray(c.hashtagBank) ? [] : hb.pool || [];
      const entry = {
        hashtags: allHashtags,
        caption: captions[0] || '',
        captions,
        alwaysHashtags: alwaysH,
        poolHashtags: poolH,
        platformOnly,
        platformExclude,
      };
      if (allHashtags.length > 0 || captions.length > 0 || Object.keys(platformOnly).length > 0) {
        if (c.id) map[c.id] = entry;
        if (c.name) map[c.name] = entry;
      }
    });
    return map;
  }, [artistId]);

  // Helper: get hashtags/caption for a post based on its collection (try ID first, then name)
  const getPostBank = useCallback(
    (post) => {
      if (post?.collectionId && nicheBankMap[post.collectionId]) {
        return nicheBankMap[post.collectionId];
      }
      if (post?.collectionName && nicheBankMap[post.collectionName]) {
        return nicheBankMap[post.collectionName];
      }
      // No niche match — return empty (don't merge all templates together)
      return { hashtags: [], caption: '', platformOnly: {}, platformExclude: {} };
    },
    [nicheBankMap],
  );

  // Load always-on hashtags/captions from content templates (global fallback)
  const loadAlwaysOnFromTemplates = useCallback(async () => {
    if (!db || !artistId) return;
    try {
      const tmpl = await getTemplates(db, artistId);
      if (tmpl) {
        setTemplates(tmpl);
        const allAlways = new Set();
        let firstCaption = '';
        Object.values(tmpl).forEach((t) => {
          if (t?.hashtags?.always) t.hashtags.always.forEach((h) => allAlways.add(h));
          if (!firstCaption && t?.captions?.always?.length > 0) firstCaption = t.captions.always[0];
        });
        setAlwaysOnHashtags(Array.from(allAlways));
        setAlwaysOnCaption(firstCaption);
      }
    } catch (err) {
      log.error('Failed to load templates for always-on hashtags:', err);
    }
  }, [db, artistId]);

  useEffect(() => {
    loadAlwaysOnFromTemplates();
  }, [loadAlwaysOnFromTemplates]);

  // ── Selection Handlers ──
  const togglePostSelection = useCallback((postId) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedPostIds(new Set(filteredPosts.map((p) => p.id)));
  }, [filteredPosts]);

  const selectDraftsOnly = useCallback(() => {
    setSelectedPostIds(
      new Set(posts.filter((p) => p.status === POST_STATUS.DRAFT).map((p) => p.id)),
    );
  }, [posts]);

  const clearSelection = useCallback(() => {
    setSelectedPostIds(new Set());
  }, []);

  // ── Drag & Drop Handlers ──
  const handleDragStart = useCallback((e, postId) => {
    setDraggedId(postId);
    e.dataTransfer.effectAllowed = 'move';
    if (e.target)
      setTimeout(() => {
        e.target.style.opacity = '0.4';
      }, 0);
  }, []);

  const handleDragOver = useCallback(
    (e, postId) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (postId !== dragOverId) setDragOverId(postId);
    },
    [dragOverId],
  );

  const handleDrop = useCallback(
    async (e, targetId) => {
      e.preventDefault();
      if (!draggedId || draggedId === targetId) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }
      // Prevent dragging locked posts or dropping onto locked positions
      const draggedPost = posts.find((p) => p.id === draggedId);
      if (draggedPost?.locked) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }
      setPosts((prev) => {
        const arr = [...prev];
        const fromIdx = arr.findIndex((p) => p.id === draggedId);
        const toIdx = arr.findIndex((p) => p.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
        return arr.map((p, i) => ({ ...p, queuePosition: i }));
      });
      const arr = [...posts];
      const fromIdx = arr.findIndex((p) => p.id === draggedId);
      const toIdx = arr.findIndex((p) => p.id === targetId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
        const newOrder = arr.map((p, i) => ({ id: p.id, queuePosition: i }));
        await reorderPosts(db, artistId, newOrder);
      }
      setDraggedId(null);
      setDragOverId(null);
    },
    [draggedId, posts, db, artistId],
  );

  const handleDragEnd = useCallback((e) => {
    if (e.target) e.target.style.opacity = '1';
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  // ── Shuffle / Randomize Order (locked posts stay in place) ──
  const handleRandomizeOrder = useCallback(async () => {
    const locked = posts.filter((p) => p.locked);
    const unlocked = posts.filter((p) => !p.locked);

    // Split unlocked posts into past (keep in place) and future (shuffle)
    const now = new Date();
    const pastUnlocked = unlocked.filter((p) => p.scheduledTime && new Date(p.scheduledTime) < now);
    const futureUnlocked = unlocked.filter(
      (p) => !p.scheduledTime || new Date(p.scheduledTime) >= now,
    );

    // Calculate spacing from existing future times, then re-space from next upcoming slot
    const futureTimes = futureUnlocked
      .filter((p) => p.scheduledTime)
      .map((p) => new Date(p.scheduledTime).getTime())
      .sort((a, b) => a - b);

    // Determine spacing interval: average gap between consecutive future posts, default 30 min
    let spacingMs = 30 * 60 * 1000; // 30 minutes default
    if (futureTimes.length >= 2) {
      const totalSpan = futureTimes[futureTimes.length - 1] - futureTimes[0];
      spacingMs = Math.max(totalSpan / (futureTimes.length - 1), 5 * 60 * 1000); // min 5 min
    }

    // Starting point: the earliest future time (next upcoming slot)
    const startTime = futureTimes.length > 0 ? futureTimes[0] : now.getTime() + spacingMs;

    // Shuffle only future unlocked posts
    for (let i = futureUnlocked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [futureUnlocked[i], futureUnlocked[j]] = [futureUnlocked[j], futureUnlocked[i]];
    }

    // Rebuild the full list: locked + past-unlocked stay at original indices, future-unlocked get shuffled
    const result = new Array(posts.length);
    const fixedPositions = new Set();
    posts.forEach((p, i) => {
      if (p.locked || pastUnlocked.some((pp) => pp.id === p.id)) {
        result[i] = p;
        fixedPositions.add(i);
      }
    });
    let fi = 0;
    for (let i = 0; i < result.length; i++) {
      if (!fixedPositions.has(i)) {
        result[i] = futureUnlocked[fi++];
      }
    }

    // Re-space future posts from next upcoming slot with consistent spacing
    let slotIndex = 0;
    const timeUpdates = [];
    for (let i = 0; i < result.length; i++) {
      if (!fixedPositions.has(i) && result[i].scheduledTime) {
        const newTime = new Date(startTime + slotIndex * spacingMs).toISOString();
        slotIndex++;
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

    // Sync time changes to Late.co
    const lateUpdates = timeUpdates.filter((u) => {
      const post = result.find((p) => p.id === u.id);
      return post?.latePostId && post?.status !== 'posted' && post?.status !== 'draft';
    });

    if (lateUpdates.length > 0) {
      try {
        const token = await getAuth().currentUser?.getIdToken();
        let synced = 0;
        for (const update of lateUpdates) {
          const post = result.find((p) => p.id === update.id);
          try {
            const resp = await fetch('/api/late', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                action: 'updatePost',
                postId: post.latePostId,
                artistId,
                scheduledFor: update.scheduledTime,
              }),
            });
            if (resp.ok) synced++;
            else log.warn('[Schedule] Late sync failed:', resp.status);
          } catch (syncErr) {
            log.warn('[Schedule] Late sync error:', syncErr.message);
          }
        }
        if (synced > 0)
          toastSuccess(`Shuffled + synced ${synced} post${synced !== 1 ? 's' : ''} to Late.co`);
        else toastSuccess('Queue shuffled (Late sync failed)');
      } catch (outerErr) {
        log.error('[Schedule] Late sync error:', outerErr);
        toastSuccess('Queue shuffled');
      }
    } else {
      const msg = locked.length > 0 ? `Queue shuffled (${locked.length} locked)` : 'Queue shuffled';
      toastSuccess(msg);
    }
  }, [posts, db, artistId, toastSuccess]);

  // ── CRUD Handlers ──
  const handleUpdatePost = useCallback(
    async (postId, updates) => {
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...updates } : p)));
      await updateScheduledPost(db, artistId, postId, updates);

      // Sync changes to Late.co if post is on Late (has latePostId and isn't posted/draft)
      const post = posts.find((p) => p.id === postId);
      const hasLateSync = post?.latePostId && post?.status !== 'posted' && post?.status !== 'draft';
      if (
        hasLateSync &&
        (updates.scheduledTime || updates.caption !== undefined || updates.hashtags !== undefined)
      ) {
        try {
          const lateUpdates = {};
          if (updates.scheduledTime) lateUpdates.scheduledFor = updates.scheduledTime;
          if (updates.caption !== undefined || updates.hashtags !== undefined) {
            // Rebuild full caption with hashtags for Late.co
            const newCaption = updates.caption !== undefined ? updates.caption : post.caption || '';
            const newHashtags =
              updates.hashtags !== undefined ? updates.hashtags : post.hashtags || [];
            const hashtagStr = Array.isArray(newHashtags) ? newHashtags.join(' ') : newHashtags;
            lateUpdates.content = [newCaption, hashtagStr].filter(Boolean).join('\n\n');
          }

          const response = await fetch('/api/late', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${await getAuth().currentUser?.getIdToken()}`,
            },
            body: JSON.stringify({
              action: 'updatePost',
              postId: post.latePostId,
              artistId,
              ...lateUpdates,
            }),
          });

          if (response.ok) {
            const what = updates.scheduledTime ? 'Time' : 'Caption';
            toastSuccess(`${what} updated on Late.co`);
          } else {
            log.warn('[Schedule] Failed to sync to Late.co:', await response.text());
          }
        } catch (error) {
          log.error('[Schedule] Error syncing to Late.co:', error);
        }
      }
    },
    [db, artistId, posts, toastSuccess],
  );

  // ── Apply caption bank category to drafts (respects selection) ──
  const handleApplyCategory = useCallback(
    async (categoryKey) => {
      if (!categoryKey || !templates[categoryKey]) {
        toastError('No category selected');
        return;
      }
      const hasSelection = selectedPostIds.size > 0;
      let updated = 0;
      for (const post of posts) {
        if (post.status !== POST_STATUS.DRAFT) continue;
        if (hasSelection && !selectedPostIds.has(post.id)) continue;
        const platform = post.platforms
          ? Object.keys(post.platforms).find((p) => post.platforms[p]) || 'tiktok'
          : 'tiktok';
        const generated = generateFromTemplate(templates[categoryKey], platform);

        const updates = {};
        if (!post.caption && generated.caption) updates.caption = generated.caption;
        if (generated.hashtags) {
          const existing = Array.isArray(post.hashtags)
            ? post.hashtags
            : (post.hashtags || '').split(/\s+/).filter(Boolean);
          const newTags = generated.hashtags.split(/\s+/).filter(Boolean);
          const merged = [...new Set([...existing, ...newTags])];
          const currentArr = Array.isArray(post.hashtags)
            ? post.hashtags
            : (post.hashtags || '').split(/\s+/).filter(Boolean);
          if (merged.join(' ') !== currentArr.join(' ')) updates.hashtags = merged;
        }
        if (Object.keys(updates).length > 0) {
          await handleUpdatePost(post.id, updates);
          updated++;
        }
      }
      if (updated > 0)
        toastSuccess(`Applied "${categoryKey}" to ${updated} draft${updated !== 1 ? 's' : ''}`);
      else toastSuccess('All drafts already have content — nothing to fill');
    },
    [templates, posts, selectedPostIds, handleUpdatePost, toastSuccess, toastError],
  );

  const handleDeletePost = useCallback(
    (postId) => {
      const post = posts.find((p) => p.id === postId);
      const hasLateId = !!post?.latePostId;

      setConfirmDialog({
        isOpen: true,
        title: 'Remove Post',
        message: hasLateId
          ? `Remove "${post?.contentName || 'this post'}" from the queue AND from Late.co?`
          : `Remove "${post?.contentName || 'this post'}" from the queue?`,
        confirmVariant: 'destructive',
        onConfirm: async () => {
          // Delete from Late first (if applicable)
          if (hasLateId && onDeleteLatePost) {
            try {
              log('[Schedule] Deleting Late post:', post.latePostId);
              const result = await onDeleteLatePost(post.latePostId);
              if (result?.success === false) {
                log('[Schedule] Late delete returned failure:', result.error);
                toastError(`Late.co delete may have failed: ${result.error || 'unknown error'}`);
              } else {
                log('[Schedule] Late post deleted successfully');
              }
            } catch (err) {
              log('[Schedule] Late delete threw error (continuing local delete):', err);
              toastError(`Late.co delete failed: ${err.message}`);
            }
          }
          await deleteScheduledPost(db, artistId, postId);
          if (expandedPostId === postId) setExpandedPostId(null);
          setSelectedPostIds((prev) => {
            const next = new Set(prev);
            next.delete(postId);
            return next;
          });
          setConfirmDialog({ isOpen: false });
          toastSuccess('Post removed' + (hasLateId ? ' (and from Late.co)' : ''));
        },
      });
    },
    [posts, db, artistId, expandedPostId, onDeleteLatePost, toastSuccess],
  );

  // ── Delete Selected Posts ──
  const handleDeleteSelected = useCallback(() => {
    if (selectedCount === 0) return;
    const selectedList = posts.filter((p) => selectedPostIds.has(p.id));
    const lateCount = selectedList.filter((p) => p.latePostId).length;

    setConfirmDialog({
      isOpen: true,
      title: 'Delete Selected Posts',
      message:
        lateCount > 0
          ? `Permanently remove ${selectedCount} post${selectedCount !== 1 ? 's' : ''} from the queue? (${lateCount} will also be removed from Late.co)`
          : `Permanently remove ${selectedCount} post${selectedCount !== 1 ? 's' : ''} from the queue?`,
      confirmVariant: 'destructive',
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
        const ids = [...selectedPostIds];
        let lateDeleted = 0;
        for (const id of ids) {
          const post = posts.find((p) => p.id === id);
          // Delete from Late if applicable
          if (post?.latePostId && onDeleteLatePost) {
            try {
              log('[Schedule] Deleting Late post:', post.latePostId);
              const result = await onDeleteLatePost(post.latePostId);
              if (result?.success !== false) lateDeleted++;
            } catch (err) {
              log('[Schedule] Late delete failed for', id, '(continuing):', err);
            }
          }
          await deleteScheduledPost(db, artistId, id);
        }
        setSelectedPostIds(new Set());
        if (expandedPostId && ids.includes(expandedPostId)) setExpandedPostId(null);
        setConfirmDialog({ isOpen: false });
        const lateMsg = lateDeleted > 0 ? ` (${lateDeleted} removed from Late.co)` : '';
        toastSuccess(`Removed ${ids.length} post${ids.length !== 1 ? 's' : ''}${lateMsg}`);
      },
    });
  }, [
    selectedPostIds,
    selectedCount,
    posts,
    db,
    artistId,
    expandedPostId,
    onDeleteLatePost,
    toastSuccess,
  ]);

  // ── Auto-render a video post if it has no cloudUrl ──
  const autoRenderPost = useCallback(
    async (post) => {
      const editorState = post.editorState;
      if (!editorState?.clips?.length) {
        throw new Error('No video clips to render');
      }

      // Pre-flight: count clips whose source URL is a stale `blob:` reference.
      // `videoExportService` will silently filter these (intentional — they
      // can't be re-fetched cross-session), but the user needs to know the
      // rendered output will be missing material. This was a silent
      // data-loss UX trap before — see QA-94 #8.
      const isStaleBlob = (u) => typeof u === 'string' && u.startsWith('blob:');
      const blobClipCount = editorState.clips.filter(
        (c) => isStaleBlob(c.url) && !c.localUrl && !c.localPath,
      ).length;
      if (blobClipCount === editorState.clips.length) {
        throw new Error(
          `All ${blobClipCount} clip(s) reference stale blob URLs that can no longer be loaded — re-import the source media before rendering.`,
        );
      }
      if (blobClipCount > 0) {
        toastError(
          `${blobClipCount} clip${blobClipCount === 1 ? '' : 's'} will be skipped — source no longer accessible. Re-import to include them.`,
        );
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
        const isMP4 = blob.type.includes('mp4');
        const ext = isMP4 ? 'mp4' : 'webm';
        const uploadType = isMP4 ? 'video/mp4' : 'video/webm';
        // Quota-enforced upload — bypassing this lets users blow past their plan.
        const quotaCtx = { userData: user, userEmail: user?.email };
        const { url: cloudUrl } = await uploadFileWithQuota(
          new File([blob], `${post.contentId || post.id}.${ext}`, { type: uploadType }),
          'videos',
          null,
          {},
          quotaCtx,
        );

        log('[Schedule] Upload complete:', cloudUrl);
        await handleUpdatePost(post.id, { cloudUrl });
        setRenderProgress(100);
        return cloudUrl;
      } finally {
        setRenderingPostId(null);
        setRenderProgress(0);
      }
    },
    [handleUpdatePost, user, toastError],
  );

  // ── Publish / push a post to Late.co (auto-renders if needed) ──
  // postOverride: optional post object with latest data (used by batch schedule to avoid stale state)
  const handlePublishPost = useCallback(
    async (postId, postOverride = null) => {
      const post = postOverride || posts.find((p) => p.id === postId);
      if (!post) return;
      if (!onSchedulePost) {
        toastError('Scheduling not available. Late API not connected.');
        return;
      }

      // If re-publishing a fully scheduled post (not partial), delete old Late post first
      // Late.co doesn't support media updates, so we must delete + recreate
      // For partial posts, keep the old Late post (some platforms succeeded) and only retry failed ones
      const isPartialRetry =
        post.postResults && (post.status === 'partial' || post.status === POST_STATUS.FAILED);
      if (post.latePostId && onDeleteLatePost && !isPartialRetry) {
        try {
          await onDeleteLatePost(post.latePostId);
          log('[Schedule] Deleted old Late post before re-publish:', post.latePostId);
        } catch (err) {
          log('[Schedule] Failed to delete old Late post (continuing with new publish):', err);
        }
      }

      let platformEntries = Object.entries(post.platforms || {})
        .filter(([, v]) => v?.accountId)
        .map(([platform, v]) => ({ platform, accountId: v.accountId }));

      // For partial/failed retries, only publish to platforms that failed
      // (successful platforms already have the content — Late.co rejects duplicates)
      if (post.postResults && (post.status === 'partial' || post.status === POST_STATUS.FAILED)) {
        const failedPlatforms = Object.entries(post.postResults)
          .filter(([, v]) => v.error)
          .map(([p]) => p);
        if (failedPlatforms.length > 0) {
          platformEntries = platformEntries.filter((e) => failedPlatforms.includes(e.platform));
        }
      }

      if (platformEntries.length === 0) {
        toastError('No platform accounts assigned. Select accounts before publishing.');
        return;
      }

      const isSlideshow = post.contentType === 'slideshow';
      let videoUrl = post.cloudUrl || post.editorState?.cloudUrl;

      if (!isSlideshow && !videoUrl) {
        if (!post.editorState?.clips?.length) {
          toastError('No video data to render. Edit the draft first.');
          await handleUpdatePost(postId, {
            status: POST_STATUS.FAILED,
            errorMessage: 'No video clips to render',
          });
          return;
        }
        try {
          toastSuccess('Rendering video before publishing...');
          await handleUpdatePost(postId, { status: POST_STATUS.POSTING });
          videoUrl = await autoRenderPost(post);
        } catch (err) {
          log('[Schedule] Auto-render failed:', err);
          await handleUpdatePost(postId, {
            status: POST_STATUS.FAILED,
            errorMessage: `Render failed: ${err.message}`,
          });
          toastError(`Render failed: ${err.message}`);
          return;
        }
      } else {
        await handleUpdatePost(postId, { status: POST_STATUS.POSTING });
      }

      const postHashtags = Array.isArray(post.hashtags)
        ? post.hashtags
        : (post.hashtags || '').split(/\s+/).filter(Boolean);

      // Build per-platform caption strings (merge base hashtags + platform-specific, filter excludes)
      const bank = getPostBank(post);
      const buildPlatformCaption = (platform) => {
        const platformTags = post.platformHashtags?.[platform] || [];
        const excluded = new Set(bank.platformExclude?.[platform] || []);
        const mergedHashtags = [...postHashtags, ...platformTags].filter((t) => !excluded.has(t));
        // Deduplicate
        const unique = [...new Set(mergedHashtags)];
        return [post.caption || '', unique.join(' ')].filter(Boolean).join('\n\n');
      };

      // Default caption (no platform filtering)
      const caption = [post.caption || '', postHashtags.join(' ')].filter(Boolean).join('\n\n');

      try {
        if (isSlideshow) {
          // Slideshows go to TikTok only as draft — filter to TikTok platform
          const tiktokEntry = platformEntries.find((e) => e.platform === 'tiktok');
          if (!tiktokEntry) {
            await handleUpdatePost(postId, {
              status: POST_STATUS.FAILED,
              errorMessage: 'Slideshows can only be posted to TikTok as draft',
            });
            toastError('Slideshows can only be posted to TikTok as draft');
            return;
          }

          const slides = post.editorState?.slides || [];
          const slideshowName = post.editorState?.name || post.name || 'slideshow';
          const existingRatio = post.editorState?.aspectRatio || '9:16';
          const existingImages = post.editorState?.exportedImages;
          const platformResults = {};
          let lastLatePostId = null;
          let anyFailed = false;

          // Only TikTok — always 9:16
          const entry = tiktokEntry;
          {
            let images;
            if (existingImages?.length && existingRatio === '9:16') {
              images = existingImages;
            } else if (slides.some((s) => s.backgroundImage || s.imageUrl)) {
              log(`[Schedule] Re-exporting slideshow at 9:16 for TikTok`);
              images = await exportSlideshowAsImages(
                { slides, aspectRatio: '9:16', name: slideshowName },
                () => {},
              );
            } else {
              platformResults.tiktok = { postId: null, url: null, error: 'No slide images' };
              anyFailed = true;
            }

            if (images) {
              // Skip stale blob: URLs — they're unresolvable on the next page load
              // and would silently make scheduled audio disappear hours later.
              const candidateAudioUrl =
                post.audioUrl ||
                post.editorState?.audio?.url ||
                post.editorState?.audio?.localUrl ||
                null;
              const audioUrl =
                candidateAudioUrl && !candidateAudioUrl.startsWith('blob:')
                  ? candidateAudioUrl
                  : null;
              if (candidateAudioUrl && candidateAudioUrl.startsWith('blob:')) {
                log.warn('[Schedule] Dropping stale blob audio URL for post:', post.id);
              }
              const result = await onSchedulePost({
                caption: buildPlatformCaption(entry.platform),
                platforms: [entry],
                scheduledFor: post.scheduledTime || new Date().toISOString(),
                type: 'carousel',
                images,
                audioUrl,
              });

              if (result?.success === false) {
                platformResults[entry.platform] = { postId: null, url: null, error: result.error };
                anyFailed = true;
              } else {
                log('[Schedule] Late create response:', JSON.stringify(result?.post));
                const latePost = result?.post?.post || result?.post?.data || result?.post || {};
                lastLatePostId = latePost._id || latePost.id || null;
                log('[Schedule] Extracted latePostId:', lastLatePostId);
                platformResults[entry.platform] = {
                  postId: lastLatePostId,
                  url: latePost.url || latePost.permalink || null,
                  error: null,
                };
              }
            }
          }

          if (anyFailed && !lastLatePostId) {
            const errors = Object.entries(platformResults)
              .filter(([, v]) => v.error)
              .map(([p, v]) => `${p}: ${v.error}`)
              .join('; ');
            await handleUpdatePost(postId, { status: POST_STATUS.FAILED, errorMessage: errors });
            toastError(`Failed to publish: ${errors}`);
          } else {
            await handleUpdatePost(postId, {
              status: POST_STATUS.SCHEDULED,
              latePostId: lastLatePostId,
              postResults: platformResults,
            });
            toastSuccess(
              anyFailed ? 'Partially scheduled (some platforms failed)' : 'Scheduled successfully!',
            );
          }
        } else {
          // Video post — single API call for all platforms
          const result = await onSchedulePost({
            videoUrl,
            caption,
            platforms: platformEntries,
            scheduledFor: post.scheduledTime || new Date().toISOString(),
          });

          if (result?.success === false) {
            await handleUpdatePost(postId, {
              status: POST_STATUS.FAILED,
              errorMessage: result.error || 'Unknown error',
            });
            toastError(`Failed to publish: ${result.error || 'Unknown error'}`);
          } else {
            log('[Schedule] Late create response:', JSON.stringify(result?.post));
            const latePost = result?.post?.post || result?.post?.data || result?.post || {};
            const latePostId = latePost._id || latePost.id || null;
            log('[Schedule] Extracted latePostId:', latePostId);
            const platformResults = {};
            platformEntries.forEach(({ platform }) => {
              platformResults[platform] = {
                postId: latePostId,
                url: latePost.url || latePost.permalink || null,
                error: null,
              };
            });

            await handleUpdatePost(postId, {
              status: POST_STATUS.SCHEDULED,
              latePostId,
              postResults: platformResults,
            });
            toastSuccess('Scheduled successfully!');
          }
        }
      } catch (err) {
        log('[Schedule] Publish error:', err);
        await handleUpdatePost(postId, { status: POST_STATUS.FAILED, errorMessage: err.message });
        toastError(`Publish failed: ${err.message}`);
      }
    },
    [
      posts,
      onSchedulePost,
      onDeleteLatePost,
      alwaysOnHashtags,
      handleUpdatePost,
      autoRenderPost,
      toastSuccess,
      toastError,
    ],
  );

  // ── Batch Schedule Selected ──
  const handleBatchScheduleSelected = useCallback(async () => {
    if (!batchStartDate || selectedCount === 0) return;

    const selectedPosts = posts.filter((p) => selectedPostIds.has(p.id));
    let startTime = new Date(`${batchStartDate}T${batchStartTime}`);

    // If start time is in the past, bump to now + 5 minutes
    const now = new Date();
    if (startTime < now) {
      startTime = new Date(now.getTime() + 5 * 60 * 1000);
    }

    // ── Compute staggered times using postsPerDay + spacing ──
    const WAKING_MINUTES = 960; // 16 hours (6am–10pm spread)
    const effectiveSpacing =
      spacingMode === 'even'
        ? Math.floor(WAKING_MINUTES / Math.max(postsPerDay, 1))
        : spacingMinutes;

    const startHour = startTime.getHours();
    const startMin = startTime.getMinutes();

    // ── Conflict Detection: Check for existing posts on target dates ──
    const existingPostsOnDate = posts.filter((p) => {
      if (!p.scheduledTime || selectedPostIds.has(p.id)) return false;
      const pTime = new Date(p.scheduledTime);
      const pDate = pTime.toDateString();
      const startDate = startTime.toDateString();
      // Check if post is on the same day as start date (accounting for multi-day batches)
      const maxDays = Math.ceil(selectedCount / postsPerDay);
      for (let d = 0; d < maxDays; d++) {
        const checkDate = new Date(startTime);
        checkDate.setDate(checkDate.getDate() + d);
        if (pDate === checkDate.toDateString()) return true;
      }
      return false;
    });

    if (existingPostsOnDate.length > 0) {
      // Find latest scheduled time to suggest safe start
      const latestExisting = existingPostsOnDate.reduce((latest, p) => {
        const t = new Date(p.scheduledTime);
        return t > latest ? t : latest;
      }, new Date(startTime));

      // Add 30min buffer after last existing post
      const suggestedStart = new Date(latestExisting.getTime() + 30 * 60 * 1000);

      // Check if current start time would conflict
      const wouldConflict = existingPostsOnDate.some((p) => {
        const pTime = new Date(p.scheduledTime);
        const timeDiff = Math.abs(pTime - startTime) / 60000; // minutes
        return timeDiff < 15; // Within 15 minutes = conflict
      });

      if (wouldConflict) {
        toastError(
          `${existingPostsOnDate.length} posts already scheduled on these dates. Auto-adjusted start time to ${suggestedStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to avoid conflicts.`,
        );
        startTime = suggestedStart;
      } else {
        toastInfo(
          `${existingPostsOnDate.length} posts already scheduled on these dates. Times will be interspersed.`,
        );
      }
    }

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

    // Build account/platform assignments from batchAccount + batchPlatforms.
    // expandLinkedAccounts walks the user's link groups so picking one
    // handle posts to all linked siblings (e.g. picking the IG-linked
    // handle also fires the linked TT/YT handles).
    let platformUpdate = {};
    if (batchAccount) {
      const expanded = expandLinkedAccounts(batchAccount, artistId, lateAccountIds);
      expanded.accountIds.forEach(({ platform, accountId, handle }) => {
        if (accountId && batchPlatforms[platform]) {
          platformUpdate[platform] = { accountId, handle };
        }
      });
    }

    // Apply to each selected post
    for (const post of scheduled) {
      const existingPost = posts.find((p) => p.id === post.id);
      const wasFailed = existingPost?.status === POST_STATUS.FAILED;
      const updates = {
        scheduledTime:
          post.scheduledTime instanceof Date
            ? post.scheduledTime.toISOString()
            : post.scheduledTime,
        status: POST_STATUS.SCHEDULED,
      };

      // BUG-D: clear failure state when re-scheduling a failed post so the
      // row UI updates cleanly and the retry uses the new account.
      if (wasFailed) {
        updates.errorMessage = null;
        updates.postResults = null;
      }

      // Don't auto-merge always-on hashtags - preserve user's explicit hashtag choices
      const perPostTags = toHashtagArray(existingPost?.hashtags);
      if (perPostTags.length > 0) updates.hashtags = perPostTags;

      // Apply batch account platforms
      if (Object.keys(platformUpdate).length > 0) {
        updates.platforms = { ...(existingPost?.platforms || {}), ...platformUpdate };
      }

      await updateScheduledPost(db, artistId, post.id, updates);
    }

    toastSuccess(
      `Scheduled ${scheduled.length} post${scheduled.length !== 1 ? 's' : ''}. Rendering & pushing to Late...`,
    );
    setSelectedPostIds(new Set());

    // Auto-render and push each scheduled post to Late in sequence
    // Pass updated post data directly to avoid stale React state
    if (onSchedulePost) {
      for (const post of scheduled) {
        try {
          const existingPost = posts.find((p) => p.id === post.id);
          const updatedPost = {
            ...existingPost,
            scheduledTime:
              post.scheduledTime instanceof Date
                ? post.scheduledTime.toISOString()
                : post.scheduledTime,
            status: POST_STATUS.SCHEDULED,
            ...(Object.keys(platformUpdate).length > 0
              ? { platforms: { ...(existingPost?.platforms || {}), ...platformUpdate } }
              : {}),
          };
          await handlePublishPost(post.id, updatedPost);
        } catch (err) {
          log('[Schedule] Failed to push post', post.id, 'to Late:', err.message);
        }
      }
    }
  }, [
    batchStartDate,
    batchStartTime,
    postsPerDay,
    spacingMode,
    spacingMinutes,
    batchRandomMin,
    batchRandomMax,
    selectedPostIds,
    selectedCount,
    posts,
    db,
    artistId,
    batchAccount,
    batchPlatforms,
    lateAccountIds,
    alwaysOnHashtags,
    toastSuccess,
    onSchedulePost,
    handlePublishPost,
  ]);

  // ── Auto-Schedule Ready Content ──
  // BUG-C: accept any draft that has been rendered (cloudUrl/exportUrl set
  // OR explicit status==='ready'). The "Ready" badge on draft cards means
  // "video has been exported to a playable file" — which is exactly what
  // scheduling needs. Requiring a separate explicit Ready promotion was
  // confusing and blocked the most common flow (Save in editor → Schedule).
  const isContentReady = (item) =>
    item &&
    !item.deleted &&
    !item.deletedAt &&
    (item.status === 'ready' ||
      !!item.cloudUrl ||
      !!item.url ||
      !!item.exportUrl ||
      !!item.rendered);

  const handleAutoScheduleReady = useCallback(async () => {
    if (!db || !artistId) return;
    const content = getCreatedContent(artistId);
    const readyItems = [
      ...(content.videos || []).filter(isContentReady).map((v) => ({ ...v, type: 'video' })),
      ...(content.slideshows || [])
        .filter((s) => isContentReady(s) && !s.isTemplate)
        .map((s) => ({ ...s, type: 'slideshow' })),
    ];
    if (readyItems.length === 0) {
      toastInfo('No ready content to schedule');
      return;
    }

    // Create scheduled posts from ready content
    const newPosts = readyItems.map((draft) => ({
      contentId: draft.id,
      contentType: draft.type || 'video',
      contentName: draft.name || draft.title || 'Untitled',
      thumbnail: draft.thumbnail || null,
      cloudUrl: draft.cloudUrl || null,
      collectionId: draft.collectionId || null,
      editorState: draft,
      status: POST_STATUS.DRAFT,
    }));

    try {
      const created = await addManyScheduledPosts(db, artistId, newPosts);
      // Select all newly created posts for batch scheduling
      const newIds = new Set(created.map((p) => p.id));
      setSelectedPostIds(newIds);
      toastSuccess(
        `Added ${created.length} ready item${created.length !== 1 ? 's' : ''} to queue — set cadence and schedule`,
      );
    } catch (err) {
      log.error('[Schedule] Auto-schedule failed:', err);
      toastError('Failed to add ready content: ' + err.message);
    }
  }, [db, artistId, toastSuccess, toastError, toastInfo]);

  // ── Platform Toggle ──
  const togglePlatform = useCallback(
    (postId, platform) => {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      const platforms = { ...(post.platforms || {}) };
      if (platforms[platform]) {
        delete platforms[platform];
      } else {
        platforms[platform] = { accountId: null, handle: '' };
      }
      handleUpdatePost(postId, { platforms });
    },
    [posts, handleUpdatePost],
  );

  const setPlatformAccount = useCallback(
    (postId, platform, accountId, handle) => {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      const platforms = { ...(post.platforms || {}) };
      platforms[platform] = { accountId, handle };
      handleUpdatePost(postId, { platforms });
    },
    [posts, handleUpdatePost],
  );

  // ── Bulk Publish Selected ──
  const handleBulkPublish = useCallback(async () => {
    const publishable = posts.filter(
      (p) =>
        selectedPostIds.has(p.id) &&
        (p.status === POST_STATUS.SCHEDULED || p.status === POST_STATUS.FAILED),
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

    // BUG-D: build platform overrides from the batch account selector so
    // retrying a failed post with a freshly-picked account actually uses
    // it. Without this, a post that originally failed with the wrong
    // account would keep retrying with the same wrong account because
    // post.platforms still held the stale entries.
    //
    // Uses expandLinkedAccounts so picking one handle fans out to all
    // linked siblings — same logic as the schedule path.
    const batchPlatformOverride = {};
    if (batchAccount) {
      const expanded = expandLinkedAccounts(batchAccount, artistId, lateAccountIds);
      expanded.accountIds.forEach(({ platform, accountId, handle }) => {
        if (accountId && batchPlatforms[platform]) {
          batchPlatformOverride[platform] = { accountId, handle };
        }
      });
    }
    const hasBatchOverride = Object.keys(batchPlatformOverride).length > 0;

    for (const post of publishable) {
      // Apply batch override on top of existing platforms when present.
      // For failed posts, this is the recovery path: user picks a new
      // account, clicks Publish Now, and the new account replaces the
      // bad one.
      const effectivePlatforms = hasBatchOverride
        ? { ...(post.platforms || {}), ...batchPlatformOverride }
        : post.platforms || {};

      // Persist the effective platforms + clear any prior failure state
      // so the row UI updates cleanly on retry.
      if (hasBatchOverride || post.status === POST_STATUS.FAILED) {
        await handleUpdatePost(post.id, {
          platforms: effectivePlatforms,
          errorMessage: null,
          postResults: null,
        });
      }

      const platformEntries = Object.entries(effectivePlatforms)
        .filter(([, v]) => v?.accountId)
        .map(([platform, v]) => ({ platform, accountId: v.accountId }));

      if (platformEntries.length === 0) {
        await handleUpdatePost(post.id, {
          status: POST_STATUS.FAILED,
          errorMessage: 'No platform accounts assigned — pick an account from the bar above',
        });
        failed++;
        continue;
      }

      // Use the freshly-overridden post for downstream logic
      post.platforms = effectivePlatforms;

      const isSlideshow = post.contentType === 'slideshow';
      let videoUrl = post.cloudUrl || post.editorState?.cloudUrl;

      // Auto-render if no cloudUrl
      if (!isSlideshow && !videoUrl) {
        if (!post.editorState?.clips?.length) {
          await handleUpdatePost(post.id, {
            status: POST_STATUS.FAILED,
            errorMessage: 'No video clips to render',
          });
          failed++;
          continue;
        }
        try {
          await handleUpdatePost(post.id, { status: POST_STATUS.POSTING });
          videoUrl = await autoRenderPost(post);
        } catch (err) {
          await handleUpdatePost(post.id, {
            status: POST_STATUS.FAILED,
            errorMessage: `Render failed: ${err.message}`,
          });
          failed++;
          continue;
        }
      } else {
        await handleUpdatePost(post.id, { status: POST_STATUS.POSTING });
      }

      // Don't auto-merge always-on hashtags - let users control hashtags explicitly per post
      const batchPostHashtags = Array.isArray(post.hashtags)
        ? post.hashtags
        : (post.hashtags || '').split(/\s+/).filter(Boolean);
      const caption = [post.caption || '', batchPostHashtags.join(' ')]
        .filter(Boolean)
        .join('\n\n');

      try {
        if (isSlideshow) {
          // Export at correct aspect ratio per platform
          const slides = post.editorState?.slides || [];
          const slideshowName = post.editorState?.name || post.name || 'slideshow';
          const existingRatio = post.editorState?.aspectRatio || '9:16';
          const existingImages = post.editorState?.exportedImages;
          const platformResults = {};
          let lastLatePostId = null;
          let postFailed = false;

          for (const entry of platformEntries) {
            const targetRatio = entry.platform === 'instagram' ? '4:5' : '9:16';
            let images;

            if (existingImages?.length && existingRatio === targetRatio) {
              images = existingImages;
            } else if (slides.some((s) => s.backgroundImage || s.imageUrl)) {
              log(`[Schedule] Bulk: re-exporting at ${targetRatio} for ${entry.platform}`);
              images = await exportSlideshowAsImages(
                { slides, aspectRatio: targetRatio, name: slideshowName },
                () => {},
              );
            } else {
              platformResults[entry.platform] = {
                postId: null,
                url: null,
                error: 'No slide images',
              };
              postFailed = true;
              continue;
            }

            // Skip stale blob: URLs — see candidateAudioUrl above for rationale.
            const candidateBulkAudio =
              post.audioUrl ||
              post.editorState?.audio?.url ||
              post.editorState?.audio?.localUrl ||
              null;
            const bulkAudioUrl =
              candidateBulkAudio && !candidateBulkAudio.startsWith('blob:')
                ? candidateBulkAudio
                : null;
            if (candidateBulkAudio && candidateBulkAudio.startsWith('blob:')) {
              log.warn('[Schedule] Bulk: dropping stale blob audio for post:', post.id);
            }
            const result = await onSchedulePost({
              caption,
              platforms: [entry],
              scheduledFor: post.scheduledTime || new Date().toISOString(),
              type: 'carousel',
              images,
              audioUrl: bulkAudioUrl,
            });

            if (result?.success === false) {
              platformResults[entry.platform] = { postId: null, url: null, error: result.error };
              postFailed = true;
            } else {
              const latePost = result?.post?.post || result?.post?.data || result?.post || {};
              lastLatePostId = latePost._id || latePost.id || null;
              platformResults[entry.platform] = {
                postId: lastLatePostId,
                url: latePost.url || latePost.permalink || null,
                error: null,
              };
            }
          }

          if (postFailed && !lastLatePostId) {
            const errors = Object.entries(platformResults)
              .filter(([, v]) => v.error)
              .map(([p, v]) => `${p}: ${v.error}`)
              .join('; ');
            await handleUpdatePost(post.id, { status: POST_STATUS.FAILED, errorMessage: errors });
            failed++;
          } else {
            await handleUpdatePost(post.id, {
              status: POST_STATUS.POSTED,
              postedAt: new Date().toISOString(),
              latePostId: lastLatePostId,
              postResults: platformResults,
            });
            succeeded++;
          }
        } else {
          // Video post — single API call
          const result = await onSchedulePost({
            videoUrl,
            caption,
            platforms: platformEntries,
            scheduledFor: post.scheduledTime || new Date().toISOString(),
          });

          if (result?.success === false) {
            await handleUpdatePost(post.id, {
              status: POST_STATUS.FAILED,
              errorMessage: result.error || 'Unknown error',
            });
            failed++;
          } else {
            const latePost = result?.post?.post || result?.post?.data || result?.post || {};
            const latePostId = latePost._id || latePost.id || null;
            const platformResults = {};
            platformEntries.forEach(({ platform }) => {
              platformResults[platform] = {
                postId: latePostId,
                url: latePost.url || latePost.permalink || null,
                error: null,
              };
            });

            await handleUpdatePost(post.id, {
              status: POST_STATUS.POSTED,
              postedAt: new Date().toISOString(),
              latePostId,
              postResults: platformResults,
            });
            succeeded++;
          }
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
  }, [
    posts,
    selectedPostIds,
    onSchedulePost,
    alwaysOnHashtags,
    handleUpdatePost,
    autoRenderPost,
    toastSuccess,
    toastError,
  ]);

  // Count publishable posts in selection
  const publishableCount = useMemo(() => {
    return posts.filter(
      (p) =>
        selectedPostIds.has(p.id) &&
        (p.status === POST_STATUS.SCHEDULED || p.status === POST_STATUS.FAILED),
    ).length;
  }, [posts, selectedPostIds]);

  const revertableCount = useMemo(() => {
    return posts.filter(
      (p) =>
        selectedPostIds.has(p.id) &&
        p.status !== POST_STATUS.DRAFT &&
        p.status !== POST_STATUS.POSTED,
    ).length;
  }, [posts, selectedPostIds]);

  const handleBulkRevertToDraft = useCallback(async () => {
    const revertable = posts.filter(
      (p) =>
        selectedPostIds.has(p.id) &&
        p.status !== POST_STATUS.DRAFT &&
        p.status !== POST_STATUS.POSTED,
    );
    if (revertable.length === 0) return;

    for (const post of revertable) {
      await handleUpdatePost(post.id, { status: POST_STATUS.DRAFT, scheduledTime: null });
    }
    toastSuccess(
      `Reverted ${revertable.length} post${revertable.length !== 1 ? 's' : ''} to draft`,
    );
    clearSelection();
  }, [posts, selectedPostIds, handleUpdatePost, toastSuccess, clearSelection]);

  // ── Add from drafts handler ──
  const handleAddFromDrafts = useCallback(
    async (selectedItems) => {
      try {
        // Resolve collection names: check collectionId, then match source media against collections
        const cols = getCollections(artistId).filter((c) => c.type !== 'smart');
        const resolveCollectionName = (item) => {
          if (item.collectionName) return item.collectionName;
          if (item.collectionId) {
            const col = cols.find((c) => c.id === item.collectionId);
            return col?.name || item.collectionId;
          }
          // Gather source media IDs from clips (sourceId), slides, and audio
          const sourceIds = new Set();
          (item.clips || []).forEach((c) => {
            if (c.sourceId) sourceIds.add(c.sourceId);
          });
          (item.slides || []).forEach((s) => {
            if (s.mediaId) sourceIds.add(s.mediaId);
            if (s.id) sourceIds.add(s.id);
          });
          if (item.audio?.id) sourceIds.add(item.audio.id);
          if (sourceIds.size > 0) {
            // Prefer project niches (isPipeline) over general library collections
            const niches = cols.filter((c) => c.isPipeline);
            const nicheMatch = niches.find((c) =>
              (c.mediaIds || []).some((mid) => sourceIds.has(mid)),
            );
            if (nicheMatch) return nicheMatch.name;
            // Fall back to project roots
            const projects = cols.filter((c) => c.isProjectRoot);
            const projectMatch = projects.find((c) =>
              (c.mediaIds || []).some((mid) => sourceIds.has(mid)),
            );
            if (projectMatch) return projectMatch.name;
            // Last resort: any collection (but skip default library categories)
            const parent = cols.find(
              (c) =>
                !c.isPipeline &&
                !c.isProjectRoot &&
                (c.mediaIds || []).some((mid) => sourceIds.has(mid)),
            );
            if (parent) return parent.name;
          }
          return null;
        };

        const itemsToAdd = await Promise.all(
          selectedItems.map(async (item) => {
            // Generate thumbnail with text overlays for slideshows
            let thumbnail =
              item.thumbnail ||
              item.slides?.[0]?.backgroundImage ||
              item.slides?.[0]?.imageUrl ||
              null;
            if (item.type === 'slideshow' && item.slides?.length > 0) {
              try {
                thumbnail = await generateSlideThumbnail(
                  item.slides[0],
                  item.aspectRatio || '9:16',
                );
              } catch (e) {
                /* fall back to raw image */
              }
            }
            return {
              contentId: item.id,
              contentType: item.type,
              contentName:
                item.name ||
                item.title ||
                (item.type === 'slideshow' ? 'Untitled Slideshow' : 'Untitled Video'),
              thumbnail,
              cloudUrl: item.cloudUrl || null,
              collectionName: resolveCollectionName(item),
              editorState: item,
            };
          }),
        );
        await addManyScheduledPosts(db, artistId, itemsToAdd);
        toastSuccess(`Added ${itemsToAdd.length} item(s) to queue`);
        setShowAddModal(false);
      } catch (err) {
        log.error('Failed to add items:', err);
        toastError('Failed to add items to queue');
      }
    },
    [db, artistId, toastSuccess, toastError],
  );

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
    <div className="flex h-full w-full items-stretch bg-black overflow-hidden">
      <div style={{ ...s.page, flex: '1 1 0%', minWidth: 0 }}>
        {/* ═══ HEADER ═══ */}
        <div
          className="flex w-full flex-col items-start border-b border-solid border-neutral-200 bg-black px-12 py-8"
          style={isMobile ? { padding: '12px 16px' } : undefined}
        >
          <div
            className="flex w-full items-center justify-between"
            style={
              isMobile
                ? { flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }
                : undefined
            }
          >
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-start gap-1">
                <span className="text-heading-1 font-heading-1 text-[#ffffffff]">Schedule</span>
                <span className="text-body font-body text-neutral-400">
                  {posts.length} post{posts.length !== 1 ? 's' : ''} · {draftCount} draft
                  {draftCount !== 1 ? 's' : ''}
                  {hasSelection && (
                    <span className="text-brand-600"> · {selectedCount} selected</span>
                  )}
                </span>
              </div>
              {visibleArtists.length > 1 && onArtistChange && (
                <SubframeCore.DropdownMenu.Root>
                  <SubframeCore.DropdownMenu.Trigger asChild>
                    <div className="flex items-center gap-3 rounded-md border border-solid border-neutral-200 bg-[#1a1a1aff] px-3 py-2 cursor-pointer hover:bg-[#262626]">
                      {visibleArtists.find((a) => a.id === artistId)?.photoURL ? (
                        <img
                          src={visibleArtists.find((a) => a.id === artistId)?.photoURL}
                          alt=""
                          className="h-6 w-6 flex-none rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand-600 text-white text-xs font-semibold">
                          {(visibleArtists.find((a) => a.id === artistId)?.name ||
                            '?')[0].toUpperCase()}
                        </div>
                      )}
                      <span className="text-body font-body text-[#ffffffff]">
                        {visibleArtists.find((a) => a.id === artistId)?.name || 'Select Artist'}
                      </span>
                      <FeatherChevronDown className="text-body font-body text-neutral-400" />
                    </div>
                  </SubframeCore.DropdownMenu.Trigger>
                  <SubframeCore.DropdownMenu.Portal>
                    <SubframeCore.DropdownMenu.Content
                      side="bottom"
                      align="start"
                      sideOffset={4}
                      asChild
                    >
                      <DropdownMenu>
                        {visibleArtists.map((a) => (
                          <DropdownMenu.DropdownItem
                            key={a.id}
                            icon={
                              a.photoURL ? (
                                <img
                                  src={a.photoURL}
                                  alt=""
                                  className="w-5 h-5 rounded-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <FeatherUser />
                              )
                            }
                            onClick={() => onArtistChange(a.id)}
                          >
                            {a.name}
                          </DropdownMenu.DropdownItem>
                        ))}
                      </DropdownMenu>
                    </SubframeCore.DropdownMenu.Content>
                  </SubframeCore.DropdownMenu.Portal>
                </SubframeCore.DropdownMenu.Root>
              )}
            </div>
            <div
              className="flex items-center gap-3"
              style={isMobile ? { flexWrap: 'wrap', width: '100%' } : undefined}
            >
              {!readOnly && (
                <>
                  <IconButton
                    variant="neutral-tertiary"
                    size="medium"
                    icon={<FeatherPlus />}
                    aria-label="Add to queue"
                    onClick={() => setShowAddModal(true)}
                  />
                  <IconButton
                    variant="neutral-tertiary"
                    size="medium"
                    icon={<FeatherUploadCloud />}
                    aria-label="Upload finished media"
                    onClick={() => setShowUploadModal(true)}
                  />
                  <IconButton
                    variant="neutral-tertiary"
                    size="medium"
                    icon={<FeatherRotateCcw />}
                    aria-label="Sync with Late"
                    loading={syncing}
                    onClick={handleSyncWithLate}
                  />
                  <IconButton
                    variant="neutral-tertiary"
                    size="medium"
                    icon={<FeatherShuffle />}
                    aria-label="Randomize order"
                    onClick={handleRandomizeOrder}
                  />
                  <IconButton
                    variant="neutral-tertiary"
                    size="medium"
                    icon={queuePaused ? <FeatherPlay /> : <FeatherPause />}
                    aria-label={queuePaused ? 'Resume queue' : 'Pause queue'}
                    onClick={() => setQueuePaused(!queuePaused)}
                  />
                </>
              )}
              <div className="flex h-8 w-px flex-none flex-col items-start bg-neutral-100" />
              {/* Note: Radix ToggleGroup may emit aria-checked on non-checkbox roles (axe "aria-allowed-attr").
                This is a known Radix UI library issue — cannot fix without patching Radix internals. */}
              <ToggleGroup value={viewMode} onValueChange={(v) => v && setViewMode(v)}>
                <ToggleGroup.Item
                  className="h-8 w-auto flex-none"
                  icon={<FeatherList />}
                  value="list"
                  aria-label="List view"
                />
                <ToggleGroup.Item
                  className="h-8 w-auto flex-none"
                  icon={<FeatherCalendar />}
                  value="calendar"
                  aria-label="Calendar view"
                />
              </ToggleGroup>
            </div>
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
            <div
              style={{
                ...s.bulkRow,
                ...(isMobile ? { flexDirection: 'column', gap: '10px' } : {}),
              }}
            >
              <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
                <label style={s.miniLabel}>Account</label>
                <select
                  value={batchAccount}
                  onChange={(e) => setBatchAccount(e.target.value)}
                  style={s.bulkSelect}
                >
                  <option value="">Choose account...</option>
                  {enrichedHandles.map(({ handle, label }) => (
                    <option key={handle} value={handle}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Platform Toggles — shows linked platforms for selected account */}
              {batchAccount && linkedPlatforms.length > 0 && (
                <>
                  <div
                    style={{
                      width: '1px',
                      height: '32px',
                      backgroundColor: theme.border.default,
                      display: isMobile ? 'none' : 'block',
                    }}
                  />
                  <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
                    <label style={s.miniLabel}>Platforms</label>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {linkedPlatforms.map((platform) => {
                        const isOn = !!batchPlatforms[platform];
                        const color = PLATFORM_COLORS[platform];
                        return (
                          <button
                            key={platform}
                            onClick={() =>
                              setBatchPlatforms((prev) => ({
                                ...prev,
                                [platform]: !prev[platform],
                              }))
                            }
                            style={{
                              padding: '3px 10px',
                              borderRadius: '6px',
                              borderWidth: '1px',
                              borderStyle: 'solid',
                              borderColor: isOn ? color : theme.border.default,
                              fontSize: '11px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              backgroundColor: isOn ? color + '22' : theme.bg.input,
                              color: isOn ? color : '#52525b',
                              transition: 'all 0.12s',
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

              <div
                style={{
                  width: '1px',
                  height: '32px',
                  backgroundColor: theme.border.default,
                  display: isMobile ? 'none' : 'block',
                }}
              />

              <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
                <label style={s.miniLabel}>Per Day</label>
                <div style={s.bulkPresets}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      style={{
                        ...s.presetChip,
                        ...(postsPerDay === n
                          ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' }
                          : {}),
                      }}
                      onClick={() => setPostsPerDay(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  width: '1px',
                  height: '32px',
                  backgroundColor: theme.border.default,
                  display: isMobile ? 'none' : 'block',
                }}
              />

              <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
                <label style={s.miniLabel}>Spacing</label>
                <div style={s.bulkPresets}>
                  <button
                    style={{
                      ...s.presetChip,
                      ...(spacingMode === 'even'
                        ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' }
                        : {}),
                    }}
                    onClick={() => setSpacingMode('even')}
                  >
                    Even
                  </button>
                  {[
                    { label: '2hr', min: 120 },
                    { label: '3hr', min: 180 },
                    { label: '4hr', min: 240 },
                    { label: '6hr', min: 360 },
                  ].map((p) => (
                    <button
                      key={p.label}
                      style={{
                        ...s.presetChip,
                        ...(spacingMode === 'fixed' && spacingMinutes === p.min
                          ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' }
                          : {}),
                      }}
                      onClick={() => {
                        setSpacingMinutes(p.min);
                        setSpacingMode('fixed');
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    style={{
                      ...s.presetChip,
                      ...(spacingMode === 'random'
                        ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' }
                        : {}),
                    }}
                    onClick={() => setSpacingMode(spacingMode === 'random' ? 'even' : 'random')}
                  >
                    Rand
                  </button>
                </div>
              </div>

              <div
                style={{
                  width: '1px',
                  height: '32px',
                  backgroundColor: theme.border.default,
                  display: isMobile ? 'none' : 'block',
                }}
              />

              <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
                <label style={s.miniLabel}>Batch Start Date & Time</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {/* Free-form text input — accepts MM/DD/YYYY or YYYY-MM-DD,
                      parses on blur or Enter via commitBatchStartDate. Avoids
                      the native <input type="date"> typing-segment bug where
                      typed digits would overflow into "10202"-style garbage
                      while React's controlled value fought the browser. */}
                  <input
                    type="text"
                    value={batchStartDateInput}
                    onChange={(e) => setBatchStartDateInput(e.target.value)}
                    onBlur={commitBatchStartDate}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitBatchStartDate();
                        e.target.blur();
                      }
                    }}
                    placeholder="MM/DD/YYYY"
                    style={s.miniInput}
                    aria-label="Batch start date"
                  />
                  {/* Free-form time input — accepts 5:55 PM, 17:55, 555, etc.
                      Avoids the native <input type="time"> segmented-input
                      typing bug where 5:55 PM became 02:05 PM (BUG-A). */}
                  <input
                    type="text"
                    value={batchStartTimeInput}
                    onChange={(e) => setBatchStartTimeInput(e.target.value)}
                    onBlur={commitBatchStartTime}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitBatchStartTime();
                        e.target.blur();
                      }
                    }}
                    placeholder="HH:MM"
                    style={{ ...s.miniInput, cursor: 'text' }}
                    aria-label="Batch start time"
                  />
                </div>
              </div>

              {spacingMode === 'random' && (
                <>
                  <div
                    style={{
                      width: '1px',
                      height: '32px',
                      backgroundColor: theme.border.default,
                      display: isMobile ? 'none' : 'block',
                    }}
                  />
                  <div style={{ ...s.bulkSection, ...(isMobile ? { width: '100%' } : {}) }}>
                    <label style={s.miniLabel}>Random Range (min)</label>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input
                        type="number"
                        value={batchRandomMin}
                        onChange={(e) => setBatchRandomMin(Number(e.target.value))}
                        style={{ ...s.miniInput, width: '60px' }}
                        aria-label="Random spacing minimum minutes"
                      />
                      <span style={{ color: '#52525b', fontSize: '11px' }}>to</span>
                      <input
                        type="number"
                        value={batchRandomMax}
                        onChange={(e) => setBatchRandomMax(Number(e.target.value))}
                        style={{ ...s.miniInput, width: '60px' }}
                        aria-label="Random spacing maximum minutes"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Schedule + Publish buttons */}
            <div className="flex justify-end mt-2.5 gap-2">
              <Button variant="brand-primary" size="small" onClick={handleBatchScheduleSelected}>
                Schedule {selectedCount} Post{selectedCount !== 1 ? 's' : ''}
              </Button>
              {publishableCount > 0 && (
                <Button variant="brand-primary" size="small" onClick={handleBulkPublish}>
                  Publish {publishableCount} Now
                </Button>
              )}
              {revertableCount > 0 && (
                <Button variant="neutral-secondary" size="small" onClick={handleBulkRevertToDraft}>
                  Revert {revertableCount} to Draft
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ═══ FILTER + TOOLBAR ═══ */}
        <div
          className="flex w-full flex-col items-start gap-6 px-12 py-6"
          style={isMobile ? { padding: '8px 16px', gap: '12px' } : undefined}
        >
          <div className="flex w-full flex-wrap items-center gap-1">
            {[
              { key: 'all', label: 'All' },
              { key: POST_STATUS.SCHEDULED, label: 'Scheduled' },
              { key: POST_STATUS.POSTING, label: 'Posting' },
              { key: POST_STATUS.POSTED, label: 'Posted' },
              { key: POST_STATUS.FAILED, label: 'Failed' },
            ].map((tab) => {
              const isActive = statusFilter === tab.key;
              const count = statusCounts[tab.key] || 0;
              return (
                <button
                  key={tab.key}
                  className={
                    isActive
                      ? 'bg-[#2a2a2aff] text-[#ffffffff] rounded-lg px-3 py-1.5 text-body font-body border-none cursor-pointer flex items-center gap-1.5 transition-colors'
                      : 'text-neutral-400 hover:text-neutral-200 rounded-lg px-3 py-1.5 text-body font-body bg-transparent border-none cursor-pointer flex items-center gap-1.5 transition-colors'
                  }
                  onClick={() => setStatusFilter(tab.key)}
                >
                  {tab.label}
                  {count > 0 && <Badge variant={isActive ? 'brand' : 'neutral'}>{count}</Badge>}
                </button>
              );
            })}
            {/* Sync with Late.co — check status of all scheduled posts */}
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body font-body bg-transparent border-none cursor-pointer text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSyncWithLate}
              disabled={syncing}
              title="Check Late.co for status updates on scheduled posts"
            >
              <FeatherRefreshCw
                className={syncing ? 'animate-spin' : ''}
                style={{ width: 14, height: 14 }}
              />
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body font-body bg-transparent border-none cursor-pointer text-indigo-400 hover:text-indigo-300 transition-colors"
              onClick={handleAutoScheduleReady}
              title="Import ready content into the schedule queue"
            >
              <FeatherPlus style={{ width: 14, height: 14 }} />
              Auto-Schedule Ready
            </button>
          </div>
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={
                    filteredPosts.length > 0 &&
                    filteredPosts.every((p) => selectedPostIds.has(p.id))
                  }
                  onChange={() => {
                    if (filteredPosts.every((p) => selectedPostIds.has(p.id))) clearSelection();
                    else selectAllVisible();
                  }}
                  className="w-4 h-4 cursor-pointer"
                  aria-label="Select all posts"
                />
                <span className="text-body font-body text-neutral-400">Select All</span>
              </div>
              <div className="flex h-4 w-px flex-none flex-col items-start bg-neutral-100" />
              <Button variant="neutral-tertiary" size="small" onClick={selectDraftsOnly}>
                Drafts Only
              </Button>
              {hasSelection && (
                <>
                  <Button
                    variant="destructive-secondary"
                    size="small"
                    icon={<FeatherTrash2 />}
                    onClick={handleDeleteSelected}
                  >
                    Delete ({selectedCount})
                  </Button>
                  <Button variant="neutral-tertiary" size="small" onClick={clearSelection}>
                    Deselect
                  </Button>
                </>
              )}
            </div>
            <span className="text-caption font-caption text-neutral-400">
              {filteredPosts.length} item{filteredPosts.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* ═══ BULK CAPTION/HASHTAG PANEL ═══ */}
        {hasSelection && (
          <BulkCaptionPanel
            artistId={artistId}
            posts={posts}
            selectedPostIds={selectedPostIds}
            onUpdatePost={handleUpdatePost}
            toastSuccess={toastSuccess}
            readOnly={readOnly}
            theme={theme}
          />
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
                    checked={
                      filteredPosts.length > 0 &&
                      filteredPosts.every((p) => selectedPostIds.has(p.id))
                    }
                    onChange={() => {
                      if (filteredPosts.every((p) => selectedPostIds.has(p.id))) clearSelection();
                      else selectAllVisible();
                    }}
                    style={{ cursor: 'pointer', width: '14px', height: '14px' }}
                    title="Select all"
                    aria-label="Select all posts"
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
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <FeatherCalendar className="w-12 h-12 text-zinc-600" />
                    <h3 className="text-lg font-semibold text-white">No scheduled posts</h3>
                    <p className="text-sm text-zinc-400 max-w-xs">
                      {posts.length === 0
                        ? 'Create content in the Studio, then schedule it here'
                        : 'No posts match this filter'}
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
                      alwaysOnHashtags={
                        getPostBank(post).alwaysHashtags || getPostBank(post).hashtags
                      }
                      poolHashtags={getPostBank(post).poolHashtags || []}
                      alwaysOnCaption={getPostBank(post).caption}
                      captionPool={getPostBank(post).captions || []}
                      onToggleSelect={() => togglePostSelection(post.id)}
                      onToggleExpand={() =>
                        setExpandedPostId(expandedPostId === post.id ? null : post.id)
                      }
                      onUpdate={(updates) => handleUpdatePost(post.id, updates)}
                      onTogglePlatform={(platform) => togglePlatform(post.id, platform)}
                      onSetPlatformAccount={(platform, accountId, handle) =>
                        setPlatformAccount(post.id, platform, accountId, handle)
                      }
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
              onEditPost={(post) => setPreviewingPost(post)}
              isMobile={isMobile}
              calendarDate={calendarDate}
              onChangeMonth={setCalendarDate}
              onDragPost={(postId, fromDate, toDate) => {
                const post = posts.find((p) => p.id === postId);
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
            existingContentIds={new Set(posts.map((p) => p.contentId))}
            onAdd={handleAddFromDrafts}
            onClose={() => setShowAddModal(false)}
          />
        )}

        {showUploadModal && (
          <UploadFinishedMediaModal
            db={db}
            artistId={artistId}
            onClose={() => setShowUploadModal(false)}
            onComplete={(count) =>
              toastSuccess(`Uploaded ${count} file${count !== 1 ? 's' : ''} to queue`)
            }
          />
        )}

        {/* Confirm Dialog */}
        {/* Post Preview Modal */}
        {previewingPost &&
          (() => {
            const es = previewingPost.editorState;
            const isSlideshow =
              previewingPost.contentType === 'slideshow' && es?.slides?.length > 0;
            return (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 10000,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.85)',
                }}
                onClick={() => setPreviewingPost(null)}
              >
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    maxWidth: '90vw',
                    maxHeight: '85vh',
                    minWidth: 320,
                    borderRadius: 16,
                    backgroundColor: theme.bg.input,
                    overflow: 'hidden',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '16px 20px',
                      borderBottom: `1px solid ${theme.border.subtle}`,
                    }}
                  >
                    <div>
                      <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600 }}>
                        {previewingPost.contentName || 'Untitled'}
                      </div>
                      <div style={{ color: theme.text.muted, fontSize: 12, marginTop: 2 }}>
                        {isSlideshow
                          ? `${es.slides.length} slides`
                          : previewingPost.contentType || 'draft'}
                        {previewingPost.scheduledTime &&
                          ` · ${new Date(previewingPost.scheduledTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                      </div>
                      {(es?.audio?.name || previewingPost.audioName) && (
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}
                        >
                          <FeatherMusic style={{ width: 12, height: 12, color: '#6366f1' }} />
                          <span
                            style={{
                              color: '#6366f1',
                              fontSize: 12,
                              maxWidth: 200,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={es?.audio?.name || previewingPost.audioName}
                          >
                            {(es?.audio?.name || previewingPost.audioName)
                              .replace(' Audio Extracted', '')
                              .replace('.mp3', '')}
                          </span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      {!readOnly && es && onEditDraft && (
                        <Button
                          variant="brand-secondary"
                          size="small"
                          icon={<FeatherEdit2 />}
                          onClick={() => {
                            setPreviewingPost(null);
                            onEditDraft(previewingPost);
                          }}
                        >
                          Edit
                        </Button>
                      )}
                      <IconButton
                        size="small"
                        icon={<FeatherX />}
                        aria-label="Close preview"
                        onClick={() => setPreviewingPost(null)}
                      />
                    </div>
                  </div>
                  {/* Content */}
                  <div
                    style={{
                      padding: 16,
                      overflowY: 'auto',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      justifyContent: 'center',
                      maxHeight: 'calc(85vh - 72px)',
                    }}
                  >
                    {isSlideshow
                      ? es.slides.map((slide, i) => (
                          <div
                            key={slide.id || i}
                            style={{
                              width: 180,
                              aspectRatio: '9/16',
                              borderRadius: 10,
                              overflow: 'hidden',
                              backgroundColor: theme.bg.page,
                              position: 'relative',
                              border: `1px solid ${theme.border.subtle}`,
                            }}
                          >
                            {slide.backgroundImage || slide.thumbnail || slide.imageA?.url ? (
                              <img
                                src={slide.backgroundImage || slide.thumbnail || slide.imageA?.url}
                                alt={`Slide ${i + 1}`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: theme.text.muted,
                                }}
                              >
                                Empty
                              </div>
                            )}
                            {(slide.textOverlays || []).map((overlay, oi) => (
                              <div
                                key={oi}
                                style={{
                                  position: 'absolute',
                                  left: `${overlay.position?.x || 50}%`,
                                  top: `${overlay.position?.y || 50}%`,
                                  transform: 'translate(-50%, -50%)',
                                  color: overlay.style?.color || '#fff',
                                  fontSize: `${Math.max(8, (overlay.style?.fontSize || 24) * 0.2)}px`,
                                  fontWeight: overlay.style?.fontWeight || '700',
                                  textAlign: 'center',
                                  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                                  pointerEvents: 'none',
                                  maxWidth: '90%',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {overlay.text}
                              </div>
                            ))}
                            <div
                              style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                padding: '4px 8px',
                                background: 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                fontSize: 11,
                                textAlign: 'center',
                              }}
                            >
                              Slide {i + 1}
                            </div>
                          </div>
                        ))
                      : (() => {
                          const thumb = getPostThumb(previewingPost);
                          return thumb ? (
                            <div
                              style={{
                                width: 240,
                                aspectRatio: '9/16',
                                borderRadius: 10,
                                overflow: 'hidden',
                                backgroundColor: theme.bg.page,
                                border: `1px solid ${theme.border.subtle}`,
                              }}
                            >
                              <img
                                src={thumb}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            </div>
                          ) : (
                            <div
                              style={{ padding: 40, color: theme.text.muted, textAlign: 'center' }}
                            >
                              No preview available
                            </div>
                          );
                        })()}
                  </div>
                </div>
              </div>
            );
          })()}

        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmVariant={confirmDialog.confirmVariant}
          isLoading={confirmDialog.isLoading}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog({ isOpen: false })}
        />
      </div>
      {/* end main column */}
    </div>
  );
};

// ═══════════════════════════════════════════════════
// PostRow — Dense inline row with checkbox + all scheduling controls
// ═══════════════════════════════════════════════════

const PostRow = ({
  post,
  index,
  isExpanded,
  isSelected,
  isDragging,
  isDragOver,
  isPaused,
  accounts,
  lateAccountIds,
  alwaysOnHashtags,
  alwaysOnCaption,
  onToggleSelect,
  onToggleExpand,
  onUpdate,
  onTogglePlatform,
  onSetPlatformAccount,
  onDelete,
  onEditDraft,
  onPublish,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  previewTime,
  readOnly = false,
  isMobile = false,
  isRendering = false,
  renderProgress = 0,
}) => {
  const { theme } = useTheme();
  const s = getS(theme);
  const [caption, setCaption] = useState(post.caption || '');
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  // Free-form mirror inputs (BUG-A): users type into these directly,
  // commit on blur via parsePostRowDate/parsePostRowTime. Avoids the
  // native <input type="date|time"> segmented-input typing bug.
  const [schedDateInput, setSchedDateInput] = useState('');
  const [schedTimeInput, setSchedTimeInput] = useState('');

  useEffect(() => {
    setCaption(post.caption || '');
    if (post.scheduledTime) {
      // Handle both Firestore Timestamp objects and ISO strings
      const raw = post.scheduledTime;
      const d = new Date(raw?.toDate ? raw.toDate() : raw);
      if (!isNaN(d.getTime())) {
        // Use local date parts (toISOString() uses UTC which shifts the day in US timezones)
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        setSchedDate(`${yyyy}-${mm}-${dd}`);
        setSchedDateInput(`${yyyy}-${mm}-${dd}`);
        setSchedTime(d.toTimeString().substring(0, 5));
        setSchedTimeInput(d.toTimeString().substring(0, 5));
      } else {
        setSchedDate('');
        setSchedDateInput('');
        setSchedTime('');
        setSchedTimeInput('');
      }
    } else {
      setSchedDate('');
      setSchedDateInput('');
      setSchedTime('');
      setSchedTimeInput('');
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

  // Parse free-form date text in the per-row input. Mirrors the batch
  // date parser; accepts MM/DD/YYYY or ISO YYYY-MM-DD. (BUG-A.)
  const parseRowDate = (raw) => {
    const text = (raw || '').trim();
    if (!text) return '';
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso && !isNaN(new Date(text).getTime())) return text;
    const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const isoStr = `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
      if (!isNaN(new Date(isoStr).getTime())) return isoStr;
    }
    return null;
  };

  // Parse free-form time text in the per-row input. Mirrors the batch
  // time parser. (BUG-A.)
  const parseRowTime = (raw) => {
    const text = (raw || '').trim();
    if (!text) return '';
    const normalized = text.toUpperCase().replace(/\s+/g, ' ');
    const iso24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (iso24) {
      const hh = parseInt(iso24[1], 10);
      const mm = parseInt(iso24[2], 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    const ampm = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (ampm) {
      let hh = parseInt(ampm[1], 10);
      const mm = parseInt(ampm[2], 10);
      const suffix = ampm[3];
      if (hh >= 1 && hh <= 12 && mm >= 0 && mm <= 59) {
        if (suffix === 'PM' && hh !== 12) hh += 12;
        if (suffix === 'AM' && hh === 12) hh = 0;
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    const digits = normalized.replace(/\D/g, '');
    if (digits.length === 3 || digits.length === 4) {
      const hh = parseInt(digits.slice(0, digits.length - 2), 10);
      const mm = parseInt(digits.slice(-2), 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    return null;
  };

  const commitSchedDate = () => {
    const parsed = parseRowDate(schedDateInput);
    if (parsed === null) {
      setSchedDateInput(schedDate || '');
      return;
    }
    setSchedDate(parsed);
    setSchedDateInput(parsed);
    handleScheduleChange(parsed, null);
  };

  const commitSchedTime = () => {
    const parsed = parseRowTime(schedTimeInput);
    if (parsed === null) {
      setSchedTimeInput(schedTime || '');
      return;
    }
    setSchedTime(parsed);
    setSchedTimeInput(parsed);
    handleScheduleChange(null, parsed);
  };

  const statusColor =
    {
      [POST_STATUS.DRAFT]: '#71717a',
      [POST_STATUS.SCHEDULED]: '#6366f1',
      [POST_STATUS.POSTING]: '#f59e0b',
      [POST_STATUS.POSTED]: '#10b981',
      [POST_STATUS.FAILED]: '#ef4444',
    }[post.status] || '#71717a';

  const statusBg =
    {
      [POST_STATUS.DRAFT]: theme?.border?.default || '#27272a',
      [POST_STATUS.SCHEDULED]: '#312e81',
      [POST_STATUS.POSTING]: '#78350f',
      [POST_STATUS.POSTED]: '#064e3b',
      [POST_STATUS.FAILED]: '#7f1d1d',
    }[post.status] ||
    theme?.border?.default ||
    '#27272a';

  const previewImage =
    post.editorState?.exportedImages?.[0]?.url ||
    post.thumbnail ||
    post.editorState?.thumbnail ||
    post.editorState?.slides?.[0]?.backgroundImage ||
    post.editorState?.slides?.[0]?.thumbnail ||
    post.editorState?.slides?.[0]?.imageA?.url ||
    post.editorState?.clips?.[0]?.thumbnailUrl ||
    post.editorState?.clips?.[0]?.thumbnail ||
    post.editorState?.montagePhotos?.[0]?.thumbnailUrl ||
    post.editorState?.montagePhotos?.[0]?.url ||
    post._repairedThumb ||
    null;

  return (
    <div className="rounded-lg border border-solid border-neutral-200 mb-1 mx-2 overflow-hidden">
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className="hover:bg-[#1a1a1aff] transition-colors"
        style={{
          ...s.row,
          ...(isDragOver ? { borderColor: '#a5b4fc', backgroundColor: '#1e1e30' } : {}),
          ...(isSelected ? { backgroundColor: '#12122a' } : {}),
          opacity: isDragging ? 0.4 : 1,
          position: 'relative',
          ...(isMobile
            ? {
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '12px 16px',
                flexWrap: 'wrap',
              }
            : {}),
        }}
      >
        {isPaused && post.status === POST_STATUS.SCHEDULED && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(245,158,11,0.08)',
              borderRadius: '0',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: '14px', opacity: 0.5 }}>⏸</span>
          </div>
        )}

        {isRendering && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(99,102,241,0.1)',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(0,0,0,0.7)',
                padding: '4px 12px',
                borderRadius: '6px',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '4px',
                  backgroundColor: '#27272a',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${renderProgress}%`,
                    height: '100%',
                    backgroundColor: '#6366f1',
                    borderRadius: '2px',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <span style={{ color: '#a5b4fc', fontSize: '11px', fontWeight: 600 }}>
                {renderProgress < 95 ? `Rendering ${Math.round(renderProgress)}%` : 'Uploading...'}
              </span>
            </div>
          </div>
        )}

        {/* Checkbox */}
        <div
          style={{
            width: isMobile ? '44px' : '24px',
            minHeight: isMobile ? '44px' : 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            style={{
              cursor: 'pointer',
              width: isMobile ? '20px' : '14px',
              height: isMobile ? '20px' : '14px',
              accentColor: '#6366f1',
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select post ${post.name || post.contentName || ''}`}
          />
        </div>

        {/* Drag Handle + Number */}
        <div style={{ ...s.dragHandle, ...(isMobile ? { display: 'none' } : {}) }}>
          <FeatherGripVertical
            className="text-neutral-600"
            style={{ width: '14px', height: '14px', cursor: 'grab' }}
          />
          <span style={{ color: '#3f3f46', fontSize: '10px', fontWeight: '600' }}>
            #{index + 1}
          </span>
        </div>

        {/* Thumbnail */}
        <div style={s.thumb} onClick={onToggleExpand}>
          {previewImage ? (
            <img src={previewImage} alt="" style={s.thumbImg} />
          ) : (
            <span style={{ fontSize: '16px' }}>
              {post.contentType === 'upload'
                ? post.mediaType === 'image'
                  ? '📷'
                  : '📤'
                : post.contentType === 'slideshow'
                  ? '🖼️'
                  : '🎥'}
            </span>
          )}
        </div>

        {/* Content Name + Audio + Collection */}
        <div style={{ flex: 1.2, minWidth: 0, cursor: 'pointer' }} onClick={onToggleExpand}>
          <div style={s.contentName}>{post.contentName}</div>
          <div
            style={{
              fontSize: '10px',
              color: '#52525b',
              marginTop: '1px',
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>
              {post.contentType === 'upload'
                ? post.mediaType === 'image'
                  ? 'Image'
                  : 'Video'
                : post.contentType === 'slideshow'
                  ? 'Slideshow'
                  : 'Video'}
            </span>
            {post.contentType === 'upload' && (
              <span
                style={{
                  color: '#8b5cf6',
                  fontSize: '9px',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(139,92,246,0.12)',
                  border: '1px solid rgba(139,92,246,0.2)',
                }}
              >
                Uploaded
              </span>
            )}
            {post.collectionName && (
              <span
                style={{
                  color: '#14b8a6',
                  fontSize: '9px',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(20,184,166,0.12)',
                  border: '1px solid rgba(20,184,166,0.2)',
                }}
                title={`From: ${post.collectionName}`}
              >
                {post.collectionName}
              </span>
            )}
            {post._isGhost && (
              <span
                style={{
                  color: '#f59e0b',
                  fontSize: '9px',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(245,158,11,0.12)',
                  border: '1px solid rgba(245,158,11,0.25)',
                }}
                title="Original draft was deleted"
              >
                orphan
              </span>
            )}
            {post.editorState?.audio && (
              <span
                style={{
                  color: '#6366f1',
                  maxWidth: '120px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={post.editorState.audio.name || post.editorState.audio.title || 'Audio'}
              >
                {post.editorState.audio.name || post.editorState.audio.title || 'Audio'}
              </span>
            )}
          </div>
        </div>

        {/* Schedule Date/Time — mobile stacks below, desktop inline */}
        {isMobile ? (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              paddingLeft: '32px',
            }}
          >
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={schedDateInput}
                onChange={(e) => setSchedDateInput(e.target.value)}
                onBlur={commitSchedDate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitSchedDate();
                    e.target.blur();
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder="YYYY-MM-DD"
                style={{ ...s.inlineDate, flex: 1, minWidth: '120px' }}
                aria-label="Schedule date"
              />
              <input
                type="text"
                value={schedTimeInput}
                onChange={(e) => setSchedTimeInput(e.target.value)}
                onBlur={commitSchedTime}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitSchedTime();
                    e.target.blur();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                placeholder="HH:MM"
                style={{ ...s.inlineTime, flex: 1, minWidth: '90px', cursor: 'text' }}
                aria-label="Schedule time"
              />
            </div>
            {previewTime &&
              !post.scheduledTime &&
              (() => {
                const pt = new Date(previewTime);
                return (
                  <div
                    style={{
                      fontSize: '10px',
                      color: '#818cf8',
                      fontStyle: 'italic',
                      paddingLeft: '2px',
                    }}
                  >
                    {pt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                    {pt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </div>
                );
              })()}
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={handleCaptionBlur}
              placeholder="Caption..."
              style={{ ...s.inlineCaption, width: '100%' }}
            />
          </div>
        ) : (
          <>
            {/* Schedule Date/Time */}
            <div
              style={{
                width: '190px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={schedDateInput}
                  onChange={(e) => setSchedDateInput(e.target.value)}
                  onBlur={commitSchedDate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitSchedDate();
                      e.target.blur();
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder="YYYY-MM-DD"
                  style={s.inlineDate}
                  aria-label="Schedule date"
                />
                <input
                  type="text"
                  value={schedTimeInput}
                  onChange={(e) => setSchedTimeInput(e.target.value)}
                  onBlur={commitSchedTime}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitSchedTime();
                      e.target.blur();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                  placeholder="HH:MM"
                  style={{ ...s.inlineTime, cursor: 'text' }}
                  aria-label="Schedule time"
                />
              </div>
              {previewTime &&
                !post.scheduledTime &&
                (() => {
                  const pt = new Date(previewTime);
                  return (
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#818cf8',
                        fontStyle: 'italic',
                        paddingLeft: '2px',
                      }}
                    >
                      {pt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                      {pt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  );
                })()}
            </div>

            {/* Caption */}
            <div style={{ width: '200px', flexShrink: 0 }}>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onBlur={handleCaptionBlur}
                placeholder="Caption..."
                style={s.inlineCaption}
              />
            </div>
          </>
        )}

        {/* Status */}
        <div style={{ width: isMobile ? 'auto' : '80px', textAlign: 'center', flexShrink: 0 }}>
          <Badge
            variant={
              post._computedStatus === 'missed'
                ? 'error'
                : post.status === POST_STATUS.SCHEDULED
                  ? 'brand'
                  : post.status === POST_STATUS.POSTED
                    ? 'success'
                    : post.status === POST_STATUS.FAILED
                      ? 'error'
                      : post.status === POST_STATUS.POSTING
                        ? 'warning'
                        : 'neutral'
            }
          >
            {post._computedStatus === 'missed' ? 'missed' : post.status}
          </Badge>
        </div>

        {/* Actions */}
        <div
          style={{
            width: isMobile ? 'auto' : '80px',
            display: 'flex',
            gap: '2px',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}
        >
          <IconButton
            variant="neutral-tertiary"
            size="small"
            icon={post.locked ? <FeatherLock className="text-warning-500" /> : <FeatherUnlock />}
            aria-label={post.locked ? 'Unlock post' : 'Lock post'}
            title={post.locked ? 'Unlock post (allow editing)' : 'Lock post (prevent changes)'}
            onClick={(e) => {
              e.stopPropagation();
              onUpdate({ locked: !post.locked });
            }}
          />
          <IconButton
            variant="neutral-tertiary"
            size="small"
            icon={isExpanded ? <FeatherChevronUp /> : <FeatherChevronDown />}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            onClick={onToggleExpand}
          />
          {!readOnly && (
            <IconButton
              variant="destructive-tertiary"
              size="small"
              icon={<FeatherTrash2 />}
              aria-label="Delete post"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            />
          )}
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
// BulkCaptionPanel — Studio bank browser for applying captions & hashtags
// ═══════════════════════════════════════════════════
const BulkCaptionPanel = ({
  artistId,
  posts,
  selectedPostIds,
  onUpdatePost,
  toastSuccess,
  readOnly,
  theme,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeSource, setActiveSource] = useState(null); // null = auto-select first, or project/niche ID

  const selectedPosts = useMemo(
    () => posts.filter((p) => selectedPostIds.has(p.id)),
    [posts, selectedPostIds],
  );

  // Load all projects and their niches — this IS the Studio bank data
  const bankSources = useMemo(() => {
    if (!artistId) return [];
    const projects = getProjects(artistId);
    const sources = [];
    for (const proj of projects) {
      const projCB = getCollectionCaptionBank(proj);
      const projHB = getCollectionHashtagBank(proj);
      const projCaptions = Array.isArray(projCB)
        ? { always: projCB, pool: [] }
        : { always: projCB.always || [], pool: projCB.pool || [] };
      const projHashtags = Array.isArray(projHB)
        ? { always: projHB, pool: [] }
        : { always: projHB.always || [], pool: projHB.pool || [] };
      const hasProjData =
        projCaptions.always.length +
          projCaptions.pool.length +
          projHashtags.always.length +
          projHashtags.pool.length >
        0;
      if (hasProjData) {
        sources.push({
          id: proj.id,
          name: proj.name,
          type: 'project',
          captions: projCaptions,
          hashtags: projHashtags,
        });
      }
      const niches = getProjectNiches(artistId, proj.id);
      for (const niche of niches) {
        const nicheCB = getCollectionCaptionBank(niche);
        const nicheHB = getCollectionHashtagBank(niche);
        const nicheCaptions = Array.isArray(nicheCB)
          ? { always: nicheCB, pool: [] }
          : { always: nicheCB.always || [], pool: nicheCB.pool || [] };
        const nicheHashtags = Array.isArray(nicheHB)
          ? { always: nicheHB, pool: [] }
          : { always: nicheHB.always || [], pool: nicheHB.pool || [] };
        const hasNicheData =
          nicheCaptions.always.length +
            nicheCaptions.pool.length +
            nicheHashtags.always.length +
            nicheHashtags.pool.length >
          0;
        if (hasNicheData) {
          sources.push({
            id: niche.id,
            name: `${proj.name} → ${niche.name}`,
            type: 'niche',
            captions: nicheCaptions,
            hashtags: nicheHashtags,
          });
        }
      }
    }
    return sources;
  }, [artistId]);

  const active = activeSource
    ? bankSources.find((s) => s.id === activeSource)
    : bankSources[0] || null;

  const handleApplyCaption = useCallback(
    async (captionText) => {
      if (readOnly || !captionText.trim()) return;
      let count = 0;
      for (const post of selectedPosts) {
        await onUpdatePost(post.id, { caption: captionText.trim() });
        count++;
      }
      toastSuccess(`Caption applied to ${count} post${count !== 1 ? 's' : ''}`);
    },
    [selectedPosts, onUpdatePost, toastSuccess, readOnly],
  );

  const handleAddHashtags = useCallback(
    async (tags) => {
      if (readOnly || tags.length === 0) return;
      let count = 0;
      for (const post of selectedPosts) {
        const existing = Array.isArray(post.hashtags)
          ? post.hashtags
          : (post.hashtags || '').split(/\s+/).filter(Boolean);
        const merged = [...new Set([...existing, ...tags])];
        await onUpdatePost(post.id, { hashtags: merged });
        count++;
      }
      toastSuccess(`Hashtags applied to ${count} post${count !== 1 ? 's' : ''}`);
    },
    [selectedPosts, onUpdatePost, toastSuccess, readOnly],
  );

  const handleSetHashtags = useCallback(
    async (tags) => {
      if (readOnly) return;
      let count = 0;
      for (const post of selectedPosts) {
        await onUpdatePost(post.id, { hashtags: [...tags] });
        count++;
      }
      toastSuccess(`Hashtags set on ${count} post${count !== 1 ? 's' : ''}`);
    },
    [selectedPosts, onUpdatePost, toastSuccess, readOnly],
  );

  return (
    <div
      style={{
        borderBottom: `1px solid ${theme.border.default}`,
        backgroundColor: theme.bg.surface,
      }}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          padding: '10px 24px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: theme.text.primary,
        }}
      >
        <FeatherEdit2 style={{ width: 14, height: 14, color: '#6366f1' }} />
        <span style={{ fontSize: '13px', fontWeight: '600' }}>Captions & Hashtags</span>
        <Badge variant="neutral">{selectedPostIds.size} selected</Badge>
        {bankSources.length > 0 && (
          <span style={{ fontSize: '11px', color: '#6366f1', fontWeight: '500' }}>
            {bankSources.length} bank{bankSources.length !== 1 ? 's' : ''}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: theme.text.secondary }}>
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {isExpanded && (
        <div style={{ padding: '0 24px 16px' }}>
          {bankSources.length === 0 ? (
            <div
              style={{ fontSize: '12px', color: '#52525b', fontStyle: 'italic', padding: '8px 0' }}
            >
              No banks set up yet — add captions & hashtags in Studio → Captions & Hashtags
            </div>
          ) : (
            <>
              {/* Source tabs */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {bankSources.map((src) => (
                  <button
                    key={src.id}
                    onClick={() => setActiveSource(src.id)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: '600',
                      backgroundColor:
                        active?.id === src.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                      color: active?.id === src.id ? '#a5b4fc' : '#71717a',
                    }}
                  >
                    {src.name}
                  </button>
                ))}
              </div>

              {active && (
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                  {/* Captions */}
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginBottom: '6px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          color: '#52525b',
                        }}
                      >
                        Captions
                      </span>
                      <span style={{ fontSize: '10px', color: '#52525b' }}>
                        ({active.captions.always.length + active.captions.pool.length})
                      </span>
                    </div>

                    {active.captions.always.length > 0 && (
                      <div style={{ marginBottom: '6px' }}>
                        <span
                          style={{
                            fontSize: '9px',
                            color: '#22c55e',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          Always On
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                            marginTop: '3px',
                            maxHeight: '120px',
                            overflowY: 'auto',
                          }}
                        >
                          {active.captions.always.map((cap, i) => (
                            <div
                              key={i}
                              onClick={() => handleApplyCaption(cap)}
                              style={{
                                padding: '5px 8px',
                                borderRadius: '5px',
                                cursor: 'pointer',
                                lineHeight: '1.4',
                                fontSize: '11px',
                                backgroundColor: 'rgba(34,197,94,0.05)',
                                border: '1px solid rgba(34,197,94,0.2)',
                                color: '#86efac',
                              }}
                              title="Click to apply to selected posts"
                            >
                              {cap.length > 120 ? cap.slice(0, 120) + '...' : cap}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {active.captions.pool.length > 0 && (
                      <div>
                        <span
                          style={{
                            fontSize: '9px',
                            color: '#52525b',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          Pool
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                            marginTop: '3px',
                            maxHeight: '120px',
                            overflowY: 'auto',
                          }}
                        >
                          {active.captions.pool.map((cap, i) => (
                            <div
                              key={i}
                              onClick={() => handleApplyCaption(cap)}
                              style={{
                                padding: '5px 8px',
                                borderRadius: '5px',
                                cursor: 'pointer',
                                lineHeight: '1.4',
                                fontSize: '11px',
                                backgroundColor: theme.bg.input,
                                border: `1px solid ${theme.border.default}`,
                                color: theme.text.secondary,
                              }}
                              title="Click to apply to selected posts"
                            >
                              {cap.length > 120 ? cap.slice(0, 120) + '...' : cap}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {active.captions.always.length === 0 && active.captions.pool.length === 0 && (
                      <div style={{ fontSize: '11px', color: '#52525b', fontStyle: 'italic' }}>
                        No captions in this bank
                      </div>
                    )}
                  </div>

                  {/* Hashtags */}
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginBottom: '6px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          color: '#52525b',
                        }}
                      >
                        Hashtags
                      </span>
                      <span style={{ fontSize: '10px', color: '#52525b' }}>
                        ({active.hashtags.always.length + active.hashtags.pool.length})
                      </span>
                    </div>

                    {active.hashtags.always.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginBottom: '4px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '9px',
                              color: '#22c55e',
                              fontWeight: '600',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            Always On
                          </span>
                          <button
                            onClick={() => handleSetHashtags(active.hashtags.always)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '10px',
                              color: '#6366f1',
                              fontWeight: '600',
                            }}
                          >
                            Apply All to Selected
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {active.hashtags.always.map((tag, i) => (
                            <span
                              key={i}
                              onClick={() => handleAddHashtags([tag])}
                              style={{
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '10px',
                                fontWeight: '500',
                                cursor: 'pointer',
                                backgroundColor: 'rgba(34,197,94,0.1)',
                                border: '1px solid rgba(34,197,94,0.3)',
                                color: '#4ade80',
                              }}
                              title="Click to add to selected posts"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {active.hashtags.pool.length > 0 && (
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginBottom: '4px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '9px',
                              color: '#52525b',
                              fontWeight: '600',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            Pool
                          </span>
                          <button
                            onClick={() => handleAddHashtags(active.hashtags.pool)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '10px',
                              color: '#6366f1',
                              fontWeight: '600',
                            }}
                          >
                            Add All to Selected
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {active.hashtags.pool.map((tag, i) => (
                            <span
                              key={i}
                              onClick={() => handleAddHashtags([tag])}
                              style={{
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '10px',
                                fontWeight: '500',
                                cursor: 'pointer',
                                backgroundColor: 'rgba(63,63,70,0.3)',
                                border: '1px solid #3f3f46',
                                color: '#a1a1aa',
                              }}
                              title="Click to add to selected posts"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {active.hashtags.always.length === 0 && active.hashtags.pool.length === 0 && (
                      <div style={{ fontSize: '11px', color: '#52525b', fontStyle: 'italic' }}>
                        No hashtags in this bank
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════
// ExpandedDrawer — Full details with tiered hashtags
// ═══════════════════════════════════════════════════

// Normalize hashtags to array — handles both string and array formats
const toHashtagArray = (h) => (Array.isArray(h) ? h : (h || '').split(/\s+/).filter(Boolean));

const ExpandedDrawer = ({
  post,
  accounts,
  lateAccountIds,
  alwaysOnHashtags = [],
  poolHashtags = [],
  alwaysOnCaption = '',
  captionPool = [],
  onUpdate,
  onTogglePlatform,
  onSetPlatformAccount,
  onEditDraft,
  onPublish,
  readOnly = false,
  isMobile = false,
}) => {
  const { theme } = useTheme();
  const s = getS(theme);
  const [hashtags, setHashtags] = useState(toHashtagArray(post.hashtags).join(' '));
  const [caption, setCaption] = useState(post.caption || '');
  const [hashtagBank, setHashtagBank] = useState([]);
  const [showSaveSet, setShowSaveSet] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  useEffect(() => {
    setHashtags(toHashtagArray(post.hashtags).join(' '));
    setCaption(post.caption || '');
  }, [post.id, post.hashtags, post.caption]);

  useEffect(() => {
    const key = `stm_hashtag_bank_${post.id?.split('/')[0] || 'default'}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        setHashtagBank(JSON.parse(saved));
      } catch {
        setHashtagBank([]);
      }
    }
  }, [post]);

  const handleHashtagsBlur = () => {
    const tags = hashtags
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((h) => (h.startsWith('#') ? h : `#${h}`));
    if (tags.join(' ') !== toHashtagArray(post.hashtags).join(' ')) onUpdate({ hashtags: tags });
  };

  const handleCaptionBlur = () => {
    if (caption !== (post.caption || '')) onUpdate({ caption });
  };

  const handleApplySet = (set) => {
    setHashtags(set.tags.join(' '));
    onUpdate({ hashtags: set.tags });
  };

  const handleSaveSet = () => {
    if (!newSetName.trim()) return;
    const tags = hashtags
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((h) => (h.startsWith('#') ? h : `#${h}`));
    const newSet = { id: Date.now().toString(), name: newSetName, tags };
    const updated = [...hashtagBank, newSet];
    localStorage.setItem(
      `stm_hashtag_bank_${post.id?.split('/')[0] || 'default'}`,
      JSON.stringify(updated),
    );
    setHashtagBank(updated);
    setNewSetName('');
    setShowSaveSet(false);
  };

  const handleDeleteSet = (setId) => {
    const updated = hashtagBank.filter((s) => s.id !== setId);
    localStorage.setItem(
      `stm_hashtag_bank_${post.id?.split('/')[0] || 'default'}`,
      JSON.stringify(updated),
    );
    setHashtagBank(updated);
  };

  // Scope handles to the current artist (BUG-B). lateAccountIds is the
  // per-artist account map; if a handle isn't in there it belongs to a
  // different artist and Late.co will reject the post.
  const availableHandles = useMemo(() => {
    const handles = new Set();
    const validHandlesInMap = new Set(Object.keys(lateAccountIds || {}));
    accounts.forEach((acc) => {
      if (validHandlesInMap.size > 0 && !validHandlesInMap.has(acc.handle)) return;
      handles.add(acc.handle);
    });
    return Array.from(handles);
  }, [accounts, lateAccountIds]);

  const selectedPlatforms = post.platforms || {};
  const previewImage =
    post.editorState?.exportedImages?.[0]?.url ||
    post.thumbnail ||
    post.editorState?.thumbnail ||
    post.editorState?.slides?.[0]?.backgroundImage ||
    post.editorState?.slides?.[0]?.thumbnail ||
    post.editorState?.slides?.[0]?.imageA?.url ||
    post.editorState?.slides?.[0]?.imageUrl ||
    post.editorState?.clips?.[0]?.thumbnailUrl ||
    post.editorState?.clips?.[0]?.thumbnail ||
    post.editorState?.montagePhotos?.[0]?.thumbnailUrl ||
    post.editorState?.montagePhotos?.[0]?.url ||
    post._repairedThumb ||
    null;

  // Separate per-post tags from always-on tags
  const perPostTags = toHashtagArray(post.hashtags).filter((t) => !alwaysOnHashtags.includes(t));

  return (
    <div style={{ ...s.drawer, ...(isMobile ? { padding: '12px 16px' } : {}) }}>
      <div
        style={{
          ...s.drawerGrid,
          ...(isMobile ? { gridTemplateColumns: '1fr', gap: '16px' } : {}),
        }}
      >
        {/* Left: Preview + Actions */}
        <div style={s.drawerLeft}>
          <div
            style={{ ...s.drawerPreview, ...(isMobile ? { width: '100%', height: '180px' } : {}) }}
          >
            {post.cloudUrl || post.editorState?.cloudUrl ? (
              <video
                src={post.cloudUrl || post.editorState?.cloudUrl}
                style={s.drawerVideo}
                controls
                muted
                playsInline
              />
            ) : previewImage ? (
              <img src={previewImage} alt="" style={s.drawerImg} />
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                <span style={{ fontSize: '32px' }}>
                  {post.contentType === 'upload'
                    ? post.mediaType === 'image'
                      ? '📷'
                      : '📤'
                    : post.contentType === 'slideshow'
                      ? '🖼️'
                      : '🎥'}
                </span>
              </div>
            )}
          </div>
          <div style={s.drawerActions}>
            {!readOnly && post.editorState && onEditDraft && (
              <Button
                variant="neutral-secondary"
                size="small"
                icon={<FeatherEdit />}
                onClick={() => onEditDraft(post)}
              >
                Edit in Studio
              </Button>
            )}
            {!readOnly && post.status === POST_STATUS.DRAFT && post.scheduledTime && (
              <Button
                variant="brand-secondary"
                size="small"
                icon={<FeatherSend />}
                onClick={onPublish}
              >
                Confirm & Push to Late
              </Button>
            )}
            {!readOnly && post.status === POST_STATUS.SCHEDULED && (
              <>
                <Button
                  variant="brand-primary"
                  size="small"
                  icon={<FeatherSend />}
                  onClick={onPublish}
                >
                  Publish Now
                </Button>
                <Button
                  variant="neutral-secondary"
                  size="small"
                  icon={<FeatherRotateCcw />}
                  onClick={() => onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null })}
                >
                  Revert to Draft
                </Button>
              </>
            )}
            {!readOnly && post.status === POST_STATUS.FAILED && (
              <Button
                variant="neutral-secondary"
                size="small"
                icon={<FeatherRotateCcw />}
                onClick={onPublish}
              >
                Retry
              </Button>
            )}
            {!readOnly &&
              (post.status === POST_STATUS.POSTING || post.status === POST_STATUS.FAILED) && (
                <Button
                  variant="neutral-secondary"
                  size="small"
                  icon={<FeatherRotateCcw />}
                  onClick={() => onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null })}
                >
                  Revert to Draft
                </Button>
              )}
          </div>
        </div>

        {/* Center: Caption + Tiered Hashtags */}
        <div style={s.drawerCenter}>
          <label style={s.drawerLabel}>Caption</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={handleCaptionBlur}
            placeholder="Write your caption..."
            rows={4}
            readOnly={readOnly}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '6px',
              border: `1px solid ${theme.border.default}`,
              backgroundColor: theme.bg.input,
              color: theme.text.primary,
              fontSize: '12px',
              fontFamily: 'inherit',
              resize: 'vertical',
              lineHeight: '1.5',
            }}
            aria-label="Post caption"
          />
          {alwaysOnCaption && (
            <div style={{ marginTop: '6px' }}>
              <span
                style={{
                  fontSize: '9px',
                  color: '#52525b',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Always-on (from bank)
              </span>
              <div
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  backgroundColor: theme.bg.surface,
                  border: `1px solid ${theme.border.default}`,
                  fontSize: '11px',
                  color: theme.text.secondary,
                  fontStyle: 'italic',
                  marginTop: '3px',
                }}
              >
                {alwaysOnCaption}
              </div>
            </div>
          )}
          {captionPool.length > 1 && (
            <div style={{ marginTop: '6px' }}>
              <span
                style={{
                  fontSize: '9px',
                  color: '#52525b',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Caption options (click to use)
              </span>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  marginTop: '3px',
                  maxHeight: '120px',
                  overflowY: 'auto',
                }}
              >
                {captionPool.map((cap, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      if (!readOnly) {
                        setCaption(cap);
                        onUpdate({ caption: cap });
                      }
                    }}
                    style={{
                      padding: '5px 8px',
                      borderRadius: '5px',
                      backgroundColor: caption === cap ? 'rgba(99,102,241,0.15)' : theme.bg.input,
                      border: `1px solid ${caption === cap ? '#6366f1' : theme.border.default}`,
                      fontSize: '11px',
                      color: caption === cap ? '#a5b4fc' : theme.text.secondary,
                      cursor: readOnly ? 'default' : 'pointer',
                      lineHeight: '1.4',
                    }}
                  >
                    {cap.length > 120 ? cap.slice(0, 120) + '...' : cap}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: '12px' }} />
          <label style={s.drawerLabel}>Hashtags</label>

          {/* Always-on tier (gray, locked) */}
          {alwaysOnHashtags.length > 0 && (
            <div style={{ marginBottom: '6px' }}>
              <span
                style={{
                  fontSize: '9px',
                  color: '#52525b',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Always-on (from templates)
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                {alwaysOnHashtags.map((tag, i) => (
                  <span key={i} style={s.alwaysOnPill}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pool hashtags (click to add) */}
          {poolHashtags.length > 0 && (
            <div style={{ marginBottom: '6px' }}>
              <span
                style={{
                  fontSize: '9px',
                  color: '#52525b',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Pool (click to add)
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                {poolHashtags.map((tag, i) => {
                  const currentTags = toHashtagArray(post.hashtags);
                  const isActive = currentTags.includes(tag);
                  return (
                    <span
                      key={i}
                      onClick={() => {
                        if (readOnly) return;
                        if (isActive) {
                          const updated = currentTags.filter((t) => t !== tag);
                          setHashtags(updated.join(' '));
                          onUpdate({ hashtags: updated });
                        } else {
                          const updated = [...currentTags, tag];
                          setHashtags(updated.join(' '));
                          onUpdate({ hashtags: updated });
                        }
                      }}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '10px',
                        fontWeight: '500',
                        cursor: readOnly ? 'default' : 'pointer',
                        backgroundColor: isActive ? 'rgba(99,102,241,0.2)' : 'rgba(63,63,70,0.3)',
                        border: `1px solid ${isActive ? '#6366f1' : '#3f3f46'}`,
                        color: isActive ? '#a5b4fc' : '#71717a',
                      }}
                    >
                      {tag}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-post tier (editable) */}
          <span
            style={{
              fontSize: '9px',
              color: '#52525b',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Per-post tags
          </span>
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            onBlur={handleHashtagsBlur}
            placeholder="#tag1 #tag2 #tag3"
            style={{ ...s.drawerInput, marginTop: '3px' }}
            aria-label="Per-post hashtags"
          />
          {perPostTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
              {perPostTags.map((tag, i) => (
                <span key={i} style={s.hashtagPill}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Hashtag Bank */}
          {hashtagBank.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <label style={s.drawerLabel}>Saved Sets</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {hashtagBank.map((set) => (
                  <div key={set.id} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <button
                      style={s.hashtagSetBtn}
                      onClick={() => handleApplySet(set)}
                      title={set.tags.join(' ')}
                    >
                      {set.name} ({set.tags.length})
                    </button>
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#52525b',
                        fontSize: '14px',
                        cursor: 'pointer',
                        padding: '0 2px',
                      }}
                      onClick={() => handleDeleteSet(set.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: '8px' }}>
            {!showSaveSet ? (
              <button style={s.linkBtn} onClick={() => setShowSaveSet(true)}>
                Save Current as Set
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={newSetName}
                  onChange={(e) => setNewSetName(e.target.value)}
                  placeholder="Set name..."
                  style={{ ...s.drawerInput, flex: 1 }}
                  aria-label="Hashtag set name"
                />
                <button style={{ ...s.drawerBtn, padding: '4px 12px' }} onClick={handleSaveSet}>
                  Save
                </button>
                <button
                  style={{ ...s.drawerBtn, padding: '4px 8px' }}
                  onClick={() => setShowSaveSet(false)}
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {/* Per-Platform Hashtags */}
          {Object.keys(selectedPlatforms).length > 0 && (
            <div style={{ marginTop: '14px' }}>
              <span
                style={{
                  fontSize: '9px',
                  color: '#52525b',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Platform-Specific Tags
              </span>
              {Object.keys(selectedPlatforms).map((platform) => {
                const platTags = (post.platformHashtags?.[platform] || []).join(' ');
                return (
                  <div
                    key={platform}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        color: PLATFORM_COLORS[platform],
                        fontWeight: '600',
                        width: '70px',
                        flexShrink: 0,
                      }}
                    >
                      {PLATFORM_LABELS[platform]}
                    </span>
                    <input
                      type="text"
                      defaultValue={platTags}
                      onBlur={(e) => {
                        const tags = e.target.value
                          .split(/[\s,]+/)
                          .filter(Boolean)
                          .map((h) => (h.startsWith('#') ? h : `#${h}`));
                        const updated = { ...(post.platformHashtags || {}), [platform]: tags };
                        onUpdate({ platformHashtags: updated });
                      }}
                      placeholder={`#${platform} tags...`}
                      style={s.drawerInput}
                      aria-label={`${PLATFORM_LABELS[platform]} hashtags`}
                      readOnly={readOnly}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Account Selection + Results */}
        <div style={{ ...s.drawerRight, ...(isMobile ? { width: '100%' } : {}) }}>
          {Object.keys(selectedPlatforms).length > 0 && (
            <div>
              <label style={s.drawerLabel}>Accounts</label>
              {Object.keys(selectedPlatforms).map((platform) => (
                <div
                  key={platform}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      color: PLATFORM_COLORS[platform],
                      fontWeight: '600',
                      width: '70px',
                    }}
                  >
                    {PLATFORM_LABELS[platform]}
                  </span>
                  <select
                    value={selectedPlatforms[platform]?.accountId || ''}
                    onChange={(e) => {
                      const handle = e.target.selectedOptions?.[0]?.dataset?.handle || '';
                      onSetPlatformAccount(platform, e.target.value, handle);
                    }}
                    style={s.accountSelect}
                  >
                    <option value="">Auto</option>
                    {availableHandles.map((handle) => {
                      const mapping = lateAccountIds[handle];
                      const accountId = mapping?.[platform];
                      if (!accountId) return null;
                      return (
                        <option key={handle} value={accountId} data-handle={handle}>
                          @{handle}
                        </option>
                      );
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
                  <span
                    style={{
                      color: PLATFORM_COLORS[platform] || '#fff',
                      fontSize: '12px',
                      fontWeight: '600',
                    }}
                  >
                    {PLATFORM_LABELS[platform] || platform}
                  </span>
                  {result.error ? (
                    <span style={{ color: '#ef4444', fontSize: '11px' }}>{result.error}</span>
                  ) : (
                    <span style={{ color: '#10b981', fontSize: '11px' }}>
                      Posted{' '}
                      {result.url && (
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#6366f1', textDecoration: 'underline' }}
                        >
                          View
                        </a>
                      )}
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
      } catch (err) {
        log.error('Failed to load content:', err);
      }
      setLoadingContent(false);
    };
    loadContent();
  }, [artistId]);

  // BUG-C: accept any draft that has been rendered (status==='ready' OR
  // has a usable URL/exportUrl/cloudUrl). Same logic as
  // handleAutoScheduleReady — see that function for the reasoning.
  const isItemReady = (item) =>
    item &&
    !item.deleted &&
    !item.deletedAt &&
    (item.status === 'ready' ||
      !!item.cloudUrl ||
      !!item.url ||
      !!item.exportUrl ||
      !!item.rendered);
  const readyVideos = (content.videos || [])
    .filter(isItemReady)
    .map((v) => ({ ...v, type: 'video' }));
  const readySlideshows = (content.slideshows || [])
    .filter((s) => isItemReady(s) && !s.isTemplate)
    .map((s) => ({ ...s, type: 'slideshow' }));
  const allItems = [...readyVideos, ...readySlideshows];

  const tabItems = {
    all: allItems,
    videos: readyVideos,
    slideshows: readySlideshows,
  };

  const items = tabItems[selectedTab] || [];

  const handleSelectItem = (itemId) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(itemId)) newSet.delete(itemId);
    else newSet.add(itemId);
    setSelectedItems(newSet);
  };

  const handleSelectAll = () => {
    if (selectedItems.size === items.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(items.map((item) => item.id)));
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <h2 style={s.modalTitle}>Add from Ready Content</h2>
          <IconButton size="small" icon={<FeatherX />} aria-label="Close" onClick={onClose} />
        </div>
        <div style={{ padding: '8px 16px', borderBottom: `1px solid ${theme.bg.elevated}` }}>
          <ToggleGroup
            value={selectedTab}
            onValueChange={(val) => {
              if (val) {
                setSelectedTab(val);
                setSelectedItems(new Set());
              }
            }}
          >
            <ToggleGroup.Item value="all" aria-label="Show all ready content">
              All
            </ToggleGroup.Item>
            <ToggleGroup.Item value="videos" aria-label="Show ready videos">
              Videos
            </ToggleGroup.Item>
            <ToggleGroup.Item value="slideshows" aria-label="Show ready slideshows">
              Slideshows
            </ToggleGroup.Item>
          </ToggleGroup>
        </div>
        {loadingContent ? (
          <div style={s.modalLoading}>
            <Loader size="large" />
            <p style={{ color: '#71717a', marginTop: '16px' }}>Loading...</p>
          </div>
        ) : (
          <>
            <div style={s.modalGrid}>
              {items.length === 0 ? (
                <div
                  style={{
                    padding: '60px 20px',
                    textAlign: 'center',
                    color: '#71717a',
                    gridColumn: '1 / -1',
                  }}
                >
                  No ready content available. Mark drafts as "Ready" in the content library first.
                </div>
              ) : (
                items.map((item) => {
                  const isDuplicate = existingContentIds.has(item.id);
                  const isSelected = selectedItems.has(item.id);
                  return (
                    <div
                      key={item.id}
                      style={{
                        ...s.modalCard,
                        ...(isSelected
                          ? { borderColor: '#6366f1', backgroundColor: '#1e1e2e' }
                          : {}),
                        opacity: isDuplicate ? 0.6 : 1,
                      }}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <div style={s.modalCardThumb}>
                        {item.thumbnail ? (
                          <img
                            src={item.thumbnail}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span style={{ fontSize: '24px' }}>
                            {item.type === 'slideshow' ? '🖼️' : '🎥'}
                          </span>
                        )}
                        {isDuplicate && <div style={s.dupBadge}>Already queued</div>}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectItem(item.id)}
                          style={{
                            position: 'absolute',
                            top: '6px',
                            right: '6px',
                            width: '16px',
                            height: '16px',
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${item.name || 'draft'}`}
                        />
                      </div>
                      <div style={{ padding: '6px 8px' }}>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '11px',
                            fontWeight: '500',
                            color: '#e4e4e7',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.name}
                        </p>
                        {(item.collectionName || item.collectionId) && (
                          <p style={{ margin: '2px 0 0', fontSize: '9px', color: '#14b8a6' }}>
                            {item.collectionName || item.collectionId}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={s.modalFooter}>
              <Button variant="neutral-tertiary" size="small" onClick={handleSelectAll}>
                {selectedItems.size === items.length ? 'Clear' : 'Select All'}
              </Button>
              <div className="flex gap-2">
                <Button variant="neutral-secondary" size="small" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="brand-primary"
                  size="small"
                  onClick={() => onAdd(items.filter((i) => selectedItems.has(i.id)))}
                  disabled={selectedItems.size === 0}
                >
                  Add {selectedItems.size > 0 ? `(${selectedItems.size})` : ''} to Queue
                </Button>
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

const STATUS_COLORS = {
  [POST_STATUS.DRAFT]: '#71717a',
  [POST_STATUS.SCHEDULED]: '#6366f1',
  [POST_STATUS.POSTING]: '#f59e0b',
  [POST_STATUS.POSTED]: '#10b981',
  [POST_STATUS.FAILED]: '#ef4444',
};

const getPostThumb = (post) => {
  if (post.thumbnail && !post.thumbnail.startsWith('blob:')) return post.thumbnail;
  if (post._repairedThumb) return post._repairedThumb;
  const es = post.editorState;
  if (!es) return null;
  // Slideshow: try first slide's background image or thumbnail
  const slide = es.slides?.[0];
  if (slide) {
    const url = slide.backgroundImage || slide.thumbnail || slide.imageA?.url || slide.imageUrl;
    if (url && !url.startsWith('blob:')) return url;
  }
  // Video: try thumbnail or first clip
  if (es.thumbnailUrl) return es.thumbnailUrl;
  if (es.thumbnail && !es.thumbnail.startsWith('blob:')) return es.thumbnail;
  const clip = es.clips?.[0];
  if (clip) {
    const url = clip.thumbnailUrl || clip.thumbnail || clip.url;
    if (url && !url.startsWith('blob:')) return url;
  }
  // PhotoMontage: try first montage photo
  const photo = es.montagePhotos?.[0];
  if (photo) {
    const url = photo.thumbnailUrl || photo.url;
    if (url && !url.startsWith('blob:')) return url;
  }
  return null;
};

const CalendarView = ({
  posts,
  expandedPostId,
  onSelectPost,
  onEditPost,
  calendarDate,
  onChangeMonth,
  onDragPost,
  isMobile = false,
}) => {
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
  posts.forEach((post) => {
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
        <IconButton
          size={isMobile ? 'medium' : 'small'}
          onClick={() => onChangeMonth(new Date(year, month - 1))}
          icon={<FeatherChevronLeft />}
          aria-label="Previous month"
        />
        <span style={s.calTitle}>
          {firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <IconButton
          size={isMobile ? 'medium' : 'small'}
          onClick={() => onChangeMonth(new Date(year, month + 1))}
          icon={<FeatherChevronRight />}
          aria-label="Next month"
        />
        <Button
          variant="neutral-tertiary"
          size="small"
          className="ml-2"
          onClick={() => onChangeMonth(new Date())}
        >
          Today
        </Button>
      </div>
      <div style={{ ...s.calGrid, ...(isMobile ? { padding: '4px' } : {}) }}>
        {(isMobile
          ? ['S', 'M', 'T', 'W', 'T', 'F', 'S']
          : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        ).map((d, i) => (
          <div key={`${d}-${i}`} style={s.calDayHeader}>
            {d}
          </div>
        ))}
        {days.map((date, idx) => {
          const dateKey = date?.toDateString();
          const dayPosts = dateKey ? postsByDate[dateKey] || [] : [];
          const isToday = dateKey === today;
          return (
            <div
              key={idx}
              style={{
                ...s.calCell,
                ...(isToday ? { border: '2px solid #6366f1' } : {}),
                ...(isMobile ? { minHeight: '60px', padding: '3px' } : {}),
              }}
              onDragOver={
                date
                  ? (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }
                  : null
              }
              onDrop={
                date
                  ? (e) => {
                      e.preventDefault();
                      if (draggedPostId && dragFromDate)
                        onDragPost(draggedPostId, dragFromDate, date);
                      setDraggedPostId(null);
                      setDragFromDate(null);
                    }
                  : null
              }
            >
              {date && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <div style={s.calCellDate}>{date.getDate()}</div>
                    {dayPosts.length > 0 && (
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: '700',
                          color: '#fff',
                          backgroundColor: '#6366f1',
                          borderRadius: '8px',
                          padding: '1px 5px',
                          lineHeight: '14px',
                        }}
                      >
                        {dayPosts.length}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                      flex: 1,
                      maxHeight: isMobile ? '80px' : '150px',
                      overflowY: dayPosts.length > 4 ? 'auto' : 'hidden',
                    }}
                  >
                    {dayPosts.map((post) => {
                      const statusColor = STATUS_COLORS[post.status] || '#71717a';
                      const timeStr = new Date(post.scheduledTime).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      });
                      if (isMobile) {
                        return (
                          <div
                            key={post.id}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              setDraggedPostId(post.id);
                              setDragFromDate(date);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onClick={() => onSelectPost(post.id)}
                            style={{
                              padding: '1px 3px',
                              borderRadius: '3px',
                              fontSize: '8px',
                              fontWeight: '500',
                              color: '#fff',
                              cursor: 'pointer',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              backgroundColor: statusColor,
                              ...(expandedPostId === post.id
                                ? { boxShadow: '0 0 0 2px #6366f1' }
                                : {}),
                              opacity: draggedPostId === post.id ? 0.5 : 1,
                            }}
                            title={`${post.contentName} — ${timeStr}`}
                          >
                            {post.contentName.substring(0, 6)}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={post.id}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            setDraggedPostId(post.id);
                            setDragFromDate(date);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onClick={() => (onEditPost ? onEditPost(post) : onSelectPost(post.id))}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 5px',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            backgroundColor: theme.bg.input,
                            border: `1px solid ${theme.border.default}`,
                            ...(expandedPostId === post.id
                              ? { boxShadow: '0 0 0 2px #6366f1' }
                              : {}),
                            opacity: draggedPostId === post.id ? 0.5 : 1,
                          }}
                          title={`${post.contentName} — ${timeStr}`}
                        >
                          {(() => {
                            const thumb = getPostThumb(post);
                            return thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                style={{
                                  width: '36px',
                                  height: '26px',
                                  borderRadius: '3px',
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: '36px',
                                  height: '26px',
                                  borderRadius: '3px',
                                  backgroundColor: statusColor,
                                  flexShrink: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <span style={{ fontSize: '8px', color: '#fff', fontWeight: '600' }}>
                                  {(post.contentName || '?')[0]}
                                </span>
                              </div>
                            );
                          })()}
                          <div
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '1px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: '500',
                                color: theme.text.primary,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {post.contentName}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '9px', color: theme.text.muted }}>
                                {timeStr}
                              </span>
                              <span
                                style={{
                                  width: '5px',
                                  height: '5px',
                                  borderRadius: '50%',
                                  backgroundColor: statusColor,
                                  flexShrink: 0,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: theme.bg.page,
    color: theme.text.primary,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  spinner: {
    width: '32px',
    height: '32px',
    borderWidth: '3px',
    borderStyle: 'solid',
    borderTopColor: theme.accent.primary,
    borderRightColor: theme.border.default,
    borderBottomColor: theme.border.default,
    borderLeftColor: theme.border.default,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },

  // Header
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderBottom: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  backBtn: {
    background: 'none',
    border: `1px solid ${theme.border.default}`,
    color: theme.text.secondary,
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: { margin: 0, fontSize: '18px', fontWeight: '600', color: theme.text.primary },
  subtitle: { margin: '1px 0 0 0', fontSize: '12px', color: theme.text.muted },
  headerActions: { display: 'flex', gap: '6px', alignItems: 'center' },
  actionBtn: {
    padding: '6px 14px',
    borderRadius: '8px',
    border: `1px solid ${theme.accent.primary}`,
    backgroundColor: 'transparent',
    color: theme.accent.hover,
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  actionBtnSm: {
    padding: '4px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: 'transparent',
    color: theme.text.secondary,
    fontSize: '11px',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  iconBtn: {
    padding: '6px 10px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: 'transparent',
    color: theme.text.secondary,
    fontSize: '14px',
    cursor: 'pointer',
  },

  // Pause banner
  pauseBanner: {
    padding: '8px 20px',
    backgroundColor: '#78350f',
    color: '#fbbf24',
    fontSize: '12px',
    fontWeight: '500',
    borderBottom: `1px solid ${theme.border.default}`,
    flexShrink: 0,
  },

  // Bulk bar (batch-first)
  bulkBar: {
    padding: '12px 20px',
    backgroundColor: theme.bg.page,
    borderBottom: `2px solid ${theme.accent.primary}`,
    flexShrink: 0,
  },
  bulkRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' },
  bulkSection: { display: 'flex', flexDirection: 'column', gap: '4px' },
  bulkSelect: {
    padding: '5px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.accent.primary}`,
    backgroundColor: theme.bg.input,
    color: theme.accent.hover,
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    minWidth: '150px',
  },
  assignBtn: {
    padding: '5px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.accent.primary}`,
    backgroundColor: theme.accent.muted,
    color: theme.accent.hover,
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  bulkPresets: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  presetChip: {
    padding: '5px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.elevated,
    color: theme.text.secondary,
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  miniLabel: {
    fontSize: '9px',
    fontWeight: '600',
    color: theme.text.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  miniInput: {
    padding: '5px 8px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.input,
    color: theme.text.primary,
    fontSize: '12px',
  },
  applyBtn: {
    padding: '6px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: theme.accent.primary,
    color: theme.text.primary,
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  // Filter bar
  filterBar: {
    display: 'flex',
    gap: '3px',
    padding: '8px 20px',
    borderBottom: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
    overflowX: 'auto',
    flexShrink: 0,
  },
  filterTab: {
    padding: '5px 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: theme.text.muted,
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    whiteSpace: 'nowrap',
  },
  filterTabActive: { backgroundColor: theme.bg.elevated, color: theme.text.primary },
  badge: {
    backgroundColor: theme.border.default,
    color: theme.text.secondary,
    fontSize: '10px',
    padding: '1px 5px',
    borderRadius: '8px',
  },

  // Toolbar (between filters and list)
  toolbarRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 20px',
    borderBottom: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
    flexShrink: 0,
  },
  toolbarBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: 'transparent',
    color: theme.text.primary,
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.12s',
  },
  viewToggleBtn: {
    padding: '5px 14px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: theme.text.muted,
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.12s',
  },
  viewToggleBtnActive: { backgroundColor: theme.bg.elevated, color: theme.text.primary },

  // Content area
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 },

  // List
  listContainer: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 20px',
    borderBottom: `1px solid ${theme.border.subtle}`,
    backgroundColor: theme.bg.surface,
    fontSize: '10px',
    fontWeight: '600',
    color: theme.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  listScroll: { flex: 1, overflowY: 'auto', scrollbarGutter: 'stable' },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
  },

  // Row
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 20px',
    backgroundColor: theme.bg.page,
    transition: 'background-color 0.1s',
    border: '1px solid transparent',
    cursor: 'default',
  },
  dragHandle: {
    width: '28px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1px',
    flexShrink: 0,
  },
  thumb: {
    width: '44px',
    height: '56px',
    borderRadius: '6px',
    overflow: 'hidden',
    backgroundColor: theme.bg.input,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  contentName: {
    fontSize: '13px',
    fontWeight: '500',
    color: theme.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Inline controls
  inlineDate: {
    width: '105px',
    padding: '4px 6px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
    color: theme.text.secondary,
    fontSize: '11px',
  },
  inlineTime: {
    width: '80px',
    padding: '4px 6px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
    color: theme.text.secondary,
    fontSize: '11px',
  },
  inlineCaption: {
    width: '100%',
    padding: '4px 8px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
    color: theme.text.primary,
    fontSize: '11px',
    fontFamily: 'inherit',
  },

  // Status pill
  statusPill: {
    fontSize: '10px',
    fontWeight: '600',
    padding: '2px 8px',
    borderRadius: '10px',
    textTransform: 'capitalize',
    display: 'inline-block',
  },
  rowIconBtn: {
    background: 'none',
    border: 'none',
    color: '#52525b',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
  },

  // Expanded drawer
  drawer: {
    backgroundColor: theme.bg.surface,
    borderTop: `1px solid ${theme.border.subtle}`,
    padding: '16px 20px 16px 100px',
  },
  drawerGrid: { display: 'grid', gridTemplateColumns: '180px 1fr 240px', gap: '20px' },
  drawerLeft: { display: 'flex', flexDirection: 'column', gap: '10px' },
  drawerPreview: {
    width: '180px',
    height: '140px',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: theme.bg.page,
  },
  drawerVideo: { width: '100%', height: '100%', objectFit: 'contain' },
  drawerImg: { width: '100%', height: '100%', objectFit: 'cover' },
  drawerActions: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  drawerBtn: {
    padding: '5px 12px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.elevated,
    color: theme.text.secondary,
    fontSize: '11px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  drawerCenter: { flex: 1, minWidth: 0 },
  drawerRight: { width: '240px' },
  drawerLabel: {
    fontSize: '10px',
    fontWeight: '600',
    color: theme.text.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
    display: 'block',
  },
  drawerInput: {
    width: '100%',
    padding: '6px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.input,
    color: theme.text.primary,
    fontSize: '13px',
    fontFamily: 'inherit',
  },

  // Hashtag pills — tiered
  alwaysOnPill: {
    fontSize: '10px',
    color: theme.text.secondary,
    backgroundColor: theme.bg.elevated,
    padding: '2px 7px',
    borderRadius: '10px',
    border: `1px solid ${theme.border.default}`,
  },
  hashtagPill: {
    fontSize: '11px',
    color: theme.accent.hover,
    backgroundColor: theme.accent.muted,
    padding: '2px 8px',
    borderRadius: '10px',
  },
  hashtagSetBtn: {
    padding: '3px 8px',
    borderRadius: '5px',
    border: `1px solid ${theme.accent.primary}`,
    backgroundColor: theme.accent.muted,
    color: theme.accent.hover,
    fontSize: '11px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: theme.accent.primary,
    fontSize: '11px',
    cursor: 'pointer',
    padding: '2px 0',
  },
  accountSelect: {
    flex: 1,
    padding: '4px 8px',
    borderRadius: '5px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.input,
    color: theme.text.primary,
    fontSize: '11px',
    cursor: 'pointer',
  },
  resultRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    backgroundColor: theme.bg.input,
    borderRadius: '6px',
    marginBottom: '4px',
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: theme.bg.surface,
    borderRadius: '12px',
    border: `1px solid ${theme.border.default}`,
    width: '90%',
    maxWidth: '700px',
    maxHeight: '75vh',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 20px',
    borderBottom: `1px solid ${theme.border.default}`,
  },
  modalTitle: { margin: 0, fontSize: '16px', fontWeight: '600', color: theme.text.primary },
  modalClose: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    fontSize: '22px',
    cursor: 'pointer',
  },
  modalTabs: {
    display: 'flex',
    gap: '3px',
    padding: '8px 20px',
    borderBottom: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
  },
  modalLoading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
  },
  modalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: '10px',
    padding: '14px 20px',
    overflow: 'auto',
    flex: 1,
  },
  modalCard: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '8px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.input,
    cursor: 'pointer',
    transition: 'all 0.1s',
    position: 'relative',
  },
  modalCardThumb: {
    width: '100%',
    height: '100px',
    backgroundColor: theme.bg.elevated,
    borderRadius: '7px 7px 0 0',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dupBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#f59e0b',
    color: '#000',
    fontSize: '9px',
    fontWeight: '600',
    padding: '2px 0',
    textAlign: 'center',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 20px',
    borderTop: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
  },

  // Calendar
  calView: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  calHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 20px',
    borderBottom: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
  },
  calNavBtn: {
    background: 'none',
    border: `1px solid ${theme.border.default}`,
    color: theme.text.secondary,
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calTitle: {
    fontSize: '15px',
    fontWeight: '600',
    color: theme.text.primary,
    minWidth: '150px',
    textAlign: 'center',
  },
  calGrid: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '1px',
    padding: '8px',
    backgroundColor: theme.border.default,
    overflow: 'auto',
  },
  calDayHeader: {
    padding: '8px 6px',
    backgroundColor: theme.bg.surface,
    color: theme.text.muted,
    fontSize: '11px',
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  calCell: {
    backgroundColor: theme.bg.surface,
    padding: '6px',
    minHeight: '180px',
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${theme.border.default}`,
    overflow: 'hidden',
  },
  calCellDate: { fontSize: '11px', fontWeight: '600', color: theme.text.secondary },
});

export default SchedulingPage;
