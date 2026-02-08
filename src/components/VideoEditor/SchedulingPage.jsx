import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  POST_STATUS, PLATFORMS, PLATFORM_LABELS, PLATFORM_COLORS,
  createScheduledPost, updateScheduledPost, deleteScheduledPost,
  getScheduledPosts, subscribeToScheduledPosts, reorderPosts,
  addManyScheduledPosts, assignScheduleTimes, assignRandomScheduleTimes
} from '../../services/scheduledPostsService';
import { useToast, ConfirmDialog } from '../ui';
import log from '../../utils/logger';

/**
 * SchedulingPage — Full-page 3-panel scheduling management view (Wave 2B)
 *
 * Layout:
 *   Left panel   — Draggable post queue / ladder
 *   Center panel — Selected post preview (video player, thumbnail, metadata)
 *   Right panel  — Edit panel (caption, hashtags, platforms, schedule time)
 *
 * Features:
 *   - Drag-to-reorder queue with Firestore persistence
 *   - Multi-platform support (Instagram, TikTok, YouTube, Facebook, Twitter/X)
 *   - Multiple accounts per platform
 *   - Bulk scheduling (fixed or random intervals)
 *   - "Edit Draft" returns to appropriate editor with full state
 *   - Visual badges for content type, status, platform chips
 *   - Real-time Firestore subscription
 */
const SchedulingPage = ({
  db,
  artistId,
  accounts = [],           // Late.co connected accounts
  lateAccountIds = {},      // { handle: { tiktok: id, instagram: id, ... } }
  onEditDraft,              // (post) => navigate to editor with editorState
  onSchedulePost,           // (payload) => send to Late.co
  onBack,                   // () => navigate back
  onRenderVideo             // (videoRef) => render and return cloudUrl
}) => {
  const { success: toastSuccess, error: toastError } = useToast();

  // ── State ──

  // Posts from Firestore
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selected post
  const [selectedPostId, setSelectedPostId] = useState(null);

  // Drag state
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // Bulk scheduling
  const [bulkDate, setBulkDate] = useState('');
  const [bulkTime, setBulkTime] = useState('14:00');
  const [bulkIntervalType, setBulkIntervalType] = useState('fixed');
  const [bulkFixedInterval, setBulkFixedInterval] = useState(60);
  const [bulkRandomMin, setBulkRandomMin] = useState(30);
  const [bulkRandomMax, setBulkRandomMax] = useState(120);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');

  // UI
  const [showBulkSchedule, setShowBulkSchedule] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const [isPublishing, setIsPublishing] = useState(false);

  // ── Derived ──

  const selectedPost = useMemo(
    () => posts.find(p => p.id === selectedPostId) || null,
    [posts, selectedPostId]
  );

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

  // ── Load & Subscribe ──

  useEffect(() => {
    if (!db || !artistId) return;

    setLoading(true);
    const unsubscribe = subscribeToScheduledPosts(db, artistId, (newPosts) => {
      setPosts(newPosts);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, artistId]);

  // Initialize bulk date to today
  useEffect(() => {
    setBulkDate(new Date().toISOString().split('T')[0]);
  }, []);

  // Auto-select first post if none selected
  useEffect(() => {
    if (!selectedPostId && posts.length > 0) {
      setSelectedPostId(posts[0].id);
    }
  }, [posts, selectedPostId]);

  // ── Drag & Drop Handlers ──

  const handleDragStart = useCallback((e, postId) => {
    setDraggedId(postId);
    e.dataTransfer.effectAllowed = 'move';
    // Make ghost slightly transparent
    if (e.target) {
      setTimeout(() => { e.target.style.opacity = '0.4'; }, 0);
    }
  }, []);

  const handleDragOver = useCallback((e, postId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (postId !== dragOverId) {
      setDragOverId(postId);
    }
  }, [dragOverId]);

  const handleDrop = useCallback(async (e, targetId) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    // Reorder locally first for instant feedback
    setPosts(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(p => p.id === draggedId);
      const toIdx = arr.findIndex(p => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;

      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr.map((p, i) => ({ ...p, queuePosition: i }));
    });

    // Persist to Firestore
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

  // ── CRUD Handlers ──

  const handleUpdatePost = useCallback(async (postId, updates) => {
    // Optimistic update
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, ...updates } : p
    ));
    await updateScheduledPost(db, artistId, postId, updates);
  }, [db, artistId]);

  const handleDeletePost = useCallback((postId) => {
    const post = posts.find(p => p.id === postId);
    setConfirmDialog({
      isOpen: true,
      title: 'Remove Post',
      message: `Remove "${post?.contentName || 'this post'}" from the queue?`,
      variant: 'destructive',
      onConfirm: async () => {
        await deleteScheduledPost(db, artistId, postId);
        if (selectedPostId === postId) {
          setSelectedPostId(null);
        }
        setConfirmDialog({ isOpen: false });
        toastSuccess('Post removed');
      }
    });
  }, [posts, db, artistId, selectedPostId, toastSuccess]);

  // ── Bulk Scheduling ──

  const handleBulkSchedule = useCallback(async () => {
    if (!bulkDate) return;

    const startTime = new Date(`${bulkDate}T${bulkTime}`);
    const drafts = posts.filter(p => p.status === POST_STATUS.DRAFT);

    if (drafts.length === 0) {
      toastError('No draft posts to schedule');
      return;
    }

    let scheduled;
    if (bulkIntervalType === 'fixed') {
      scheduled = assignScheduleTimes(drafts, startTime, bulkFixedInterval);
    } else {
      scheduled = assignRandomScheduleTimes(drafts, startTime, bulkRandomMin, bulkRandomMax);
    }

    // Update each in Firestore
    for (const post of scheduled) {
      await updateScheduledPost(db, artistId, post.id, {
        scheduledTime: post.scheduledTime,
        status: post.status
      });
    }

    toastSuccess(`Scheduled ${scheduled.length} posts`);
    setShowBulkSchedule(false);
  }, [bulkDate, bulkTime, bulkIntervalType, bulkFixedInterval, bulkRandomMin, bulkRandomMax, posts, db, artistId, toastSuccess, toastError]);

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

  // ── Render ──

  if (loading) {
    return (
      <div style={s.pageContainer}>
        <div style={s.loadingState}>
          <div style={s.spinner} />
          <p style={{ color: '#71717a', marginTop: '16px' }}>Loading scheduled posts...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.pageContainer}>
      {/* Page Header */}
      <div style={s.pageHeader}>
        <div style={s.headerLeft}>
          <button style={s.backBtn} onClick={onBack} title="Back to Studio">
            <span style={{ fontSize: '18px' }}>&#8592;</span>
          </button>
          <div>
            <h1 style={s.pageTitle}>Scheduled Posts</h1>
            <p style={s.pageSubtitle}>
              {posts.length} post{posts.length !== 1 ? 's' : ''} in queue
            </p>
          </div>
        </div>
        <div style={s.headerActions}>
          <button
            style={s.bulkBtn}
            onClick={() => setShowBulkSchedule(!showBulkSchedule)}
          >
            {showBulkSchedule ? 'Hide Bulk Schedule' : 'Bulk Schedule'}
          </button>
        </div>
      </div>

      {/* Bulk Schedule Bar */}
      {showBulkSchedule && (
        <div style={s.bulkBar}>
          <div style={s.bulkRow}>
            <div style={s.controlGroup}>
              <label style={s.label}>Start Date</label>
              <input
                type="date"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                style={s.dateInput}
              />
            </div>
            <div style={s.controlGroup}>
              <label style={s.label}>Start Time</label>
              <input
                type="time"
                value={bulkTime}
                onChange={(e) => setBulkTime(e.target.value)}
                style={s.timeInput}
              />
            </div>
            <div style={s.controlGroup}>
              <label style={s.label}>Interval</label>
              <select
                value={bulkIntervalType}
                onChange={(e) => setBulkIntervalType(e.target.value)}
                style={s.select}
              >
                <option value="fixed">Fixed</option>
                <option value="random">Random</option>
              </select>
            </div>
            {bulkIntervalType === 'fixed' ? (
              <div style={s.controlGroup}>
                <label style={s.label}>Every</label>
                <select
                  value={bulkFixedInterval}
                  onChange={(e) => setBulkFixedInterval(Number(e.target.value))}
                  style={s.select}
                >
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                  <option value={360}>6 hours</option>
                  <option value={720}>12 hours</option>
                  <option value={1440}>24 hours</option>
                </select>
              </div>
            ) : (
              <>
                <div style={s.controlGroup}>
                  <label style={s.label}>Min (min)</label>
                  <input
                    type="number"
                    min="1"
                    value={bulkRandomMin}
                    onChange={(e) => setBulkRandomMin(Number(e.target.value))}
                    style={s.numberInput}
                  />
                </div>
                <div style={s.controlGroup}>
                  <label style={s.label}>Max (min)</label>
                  <input
                    type="number"
                    min="1"
                    value={bulkRandomMax}
                    onChange={(e) => setBulkRandomMax(Number(e.target.value))}
                    style={s.numberInput}
                  />
                </div>
              </>
            )}
            <button style={s.applyBulkBtn} onClick={handleBulkSchedule}>
              Apply to {posts.filter(p => p.status === POST_STATUS.DRAFT).length} Drafts
            </button>
          </div>
        </div>
      )}

      {/* Status Filter Tabs */}
      <div style={s.filterBar}>
        {[
          { key: 'all', label: 'All' },
          { key: POST_STATUS.DRAFT, label: 'Drafts' },
          { key: POST_STATUS.SCHEDULED, label: 'Scheduled' },
          { key: POST_STATUS.POSTED, label: 'Posted' },
          { key: POST_STATUS.FAILED, label: 'Failed' }
        ].map(tab => (
          <button
            key={tab.key}
            style={{
              ...s.filterTab,
              ...(statusFilter === tab.key ? s.filterTabActive : {})
            }}
            onClick={() => setStatusFilter(tab.key)}
          >
            {tab.label}
            {statusCounts[tab.key] > 0 && (
              <span style={s.filterCount}>{statusCounts[tab.key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* 3-Panel Layout */}
      <div style={s.panelsContainer}>
        {/* ── Left Panel: Queue Ladder ── */}
        <div style={s.leftPanel}>
          <div style={s.panelHeader}>
            <span style={s.panelTitle}>Queue</span>
            <span style={s.panelCount}>{filteredPosts.length}</span>
          </div>
          <div style={s.queueList}>
            {filteredPosts.length === 0 ? (
              <div style={s.emptyQueue}>
                <p style={{ color: '#71717a', fontSize: '14px', textAlign: 'center' }}>
                  {posts.length === 0
                    ? 'No posts yet. Add content from the editor.'
                    : 'No posts match this filter.'
                  }
                </p>
              </div>
            ) : (
              filteredPosts.map((post, index) => (
                <QueueCard
                  key={post.id}
                  post={post}
                  index={index}
                  isSelected={selectedPostId === post.id}
                  isDragging={draggedId === post.id}
                  isDragOver={dragOverId === post.id}
                  onSelect={() => setSelectedPostId(post.id)}
                  onDragStart={(e) => handleDragStart(e, post.id)}
                  onDragOver={(e) => handleDragOver(e, post.id)}
                  onDrop={(e) => handleDrop(e, post.id)}
                  onDragEnd={handleDragEnd}
                  onDelete={() => handleDeletePost(post.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Center Panel: Preview ── */}
        <div style={s.centerPanel}>
          {selectedPost ? (
            <PreviewPanel
              post={selectedPost}
              onEditDraft={onEditDraft}
            />
          ) : (
            <div style={s.noSelection}>
              <p style={{ color: '#71717a', fontSize: '14px' }}>
                Select a post from the queue to preview
              </p>
            </div>
          )}
        </div>

        {/* ── Right Panel: Edit Details ── */}
        <div style={s.rightPanel}>
          {selectedPost ? (
            <EditPanel
              post={selectedPost}
              accounts={accounts}
              lateAccountIds={lateAccountIds}
              onUpdate={(updates) => handleUpdatePost(selectedPost.id, updates)}
              onTogglePlatform={(platform) => togglePlatform(selectedPost.id, platform)}
              onSetPlatformAccount={(platform, accountId, handle) =>
                setPlatformAccount(selectedPost.id, platform, accountId, handle)
              }
              onSchedulePost={onSchedulePost}
              onRenderVideo={onRenderVideo}
            />
          ) : (
            <div style={s.noSelection}>
              <p style={{ color: '#71717a', fontSize: '14px' }}>
                Select a post to edit details
              </p>
            </div>
          )}
        </div>
      </div>

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
// QueueCard — Left panel item (draggable)
// ═══════════════════════════════════════════════════

const QueueCard = ({
  post, index, isSelected, isDragging, isDragOver,
  onSelect, onDragStart, onDragOver, onDrop, onDragEnd, onDelete
}) => {
  const statusColor = {
    [POST_STATUS.DRAFT]: '#71717a',
    [POST_STATUS.SCHEDULED]: '#6366f1',
    [POST_STATUS.POSTING]: '#f59e0b',
    [POST_STATUS.POSTED]: '#10b981',
    [POST_STATUS.FAILED]: '#ef4444'
  }[post.status] || '#71717a';

  const typeIcon = post.contentType === 'slideshow' ? '\uD83C\uDFDE\uFE0F' : '\uD83C\uDFA5';

  const platformChips = Object.keys(post.platforms || {});

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      style={{
        ...s.queueCard,
        ...(isSelected ? s.queueCardSelected : {}),
        ...(isDragOver ? s.queueCardDragOver : {}),
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
    >
      {/* Drag handle + number */}
      <div style={s.queueCardHandle}>
        <span style={{ color: '#52525b', fontSize: '14px' }}>{'\u2630'}</span>
        <span style={s.queueNumber}>#{index + 1}</span>
      </div>

      {/* Thumbnail */}
      <div style={s.queueThumb}>
        {post.thumbnail ? (
          <img src={post.thumbnail} alt="" style={s.queueThumbImg} />
        ) : (
          <span style={{ fontSize: '18px' }}>{typeIcon}</span>
        )}
      </div>

      {/* Info */}
      <div style={s.queueInfo}>
        <div style={s.queueName}>{post.contentName}</div>
        <div style={s.queueMeta}>
          <span style={{ ...s.statusDot, backgroundColor: statusColor }} />
          <span style={{ color: statusColor, fontSize: '11px', textTransform: 'capitalize' }}>
            {post.status}
          </span>
          {post.scheduledTime && (
            <span style={s.queueTime}>
              {new Date(post.scheduledTime).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
              })}
            </span>
          )}
        </div>
        {/* Platform chips */}
        {platformChips.length > 0 && (
          <div style={s.chipRow}>
            {platformChips.map(p => (
              <span
                key={p}
                style={{ ...s.platformChip, backgroundColor: PLATFORM_COLORS[p] + '33', color: PLATFORM_COLORS[p] }}
              >
                {PLATFORM_LABELS[p]?.charAt(0) || p.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Delete button */}
      <button
        style={s.queueDeleteBtn}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Remove from queue"
      >
        &times;
      </button>
    </div>
  );
};

// ═══════════════════════════════════════════════════
// PreviewPanel — Center panel (video/slideshow preview)
// ═══════════════════════════════════════════════════

const PreviewPanel = ({ post, onEditDraft }) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const canPlay = !!(post.cloudUrl);

  return (
    <div style={s.previewContainer}>
      <div style={s.panelHeader}>
        <span style={s.panelTitle}>Preview</span>
        {post.editorState && onEditDraft && (
          <button
            style={s.editDraftBtn}
            onClick={() => onEditDraft(post)}
            title="Re-open in editor with saved state"
          >
            Edit Draft
          </button>
        )}
      </div>

      {/* Preview Area */}
      <div style={s.previewArea}>
        {canPlay ? (
          <div style={s.videoWrapper}>
            <video
              ref={videoRef}
              src={post.cloudUrl}
              style={s.previewVideo}
              onEnded={() => setIsPlaying(false)}
              playsInline
              muted
            />
            <button style={s.playOverlay} onClick={handlePlayPause}>
              {isPlaying ? '\u23F8' : '\u25B6'}
            </button>
          </div>
        ) : post.thumbnail ? (
          <img src={post.thumbnail} alt={post.contentName} style={s.previewImage} />
        ) : (
          <div style={s.previewPlaceholder}>
            <span style={{ fontSize: '48px' }}>
              {post.contentType === 'slideshow' ? '\uD83C\uDFDE\uFE0F' : '\uD83C\uDFA5'}
            </span>
            <p style={{ color: '#71717a', marginTop: '12px', fontSize: '14px' }}>
              No preview available
            </p>
          </div>
        )}
      </div>

      {/* Post metadata */}
      <div style={s.previewMeta}>
        <div style={s.metaRow}>
          <span style={s.metaLabel}>Name</span>
          <span style={s.metaValue}>{post.contentName}</span>
        </div>
        <div style={s.metaRow}>
          <span style={s.metaLabel}>Type</span>
          <span style={s.metaValue}>{post.contentType === 'slideshow' ? 'Slideshow' : 'Video'}</span>
        </div>
        <div style={s.metaRow}>
          <span style={s.metaLabel}>Status</span>
          <span style={{
            ...s.statusPill,
            backgroundColor: {
              [POST_STATUS.DRAFT]: '#27272a',
              [POST_STATUS.SCHEDULED]: '#312e81',
              [POST_STATUS.POSTING]: '#78350f',
              [POST_STATUS.POSTED]: '#064e3b',
              [POST_STATUS.FAILED]: '#7f1d1d'
            }[post.status] || '#27272a',
            color: {
              [POST_STATUS.DRAFT]: '#a1a1aa',
              [POST_STATUS.SCHEDULED]: '#a5b4fc',
              [POST_STATUS.POSTING]: '#fbbf24',
              [POST_STATUS.POSTED]: '#6ee7b7',
              [POST_STATUS.FAILED]: '#fca5a5'
            }[post.status] || '#a1a1aa'
          }}>
            {post.status}
          </span>
        </div>
        {post.scheduledTime && (
          <div style={s.metaRow}>
            <span style={s.metaLabel}>Scheduled</span>
            <span style={s.metaValue}>
              {new Date(post.scheduledTime).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit'
              })}
            </span>
          </div>
        )}
        {post.createdAt && (
          <div style={s.metaRow}>
            <span style={s.metaLabel}>Created</span>
            <span style={s.metaValue}>
              {new Date(post.createdAt).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════
// EditPanel — Right panel (caption, hashtags, platforms, time)
// ═══════════════════════════════════════════════════

const EditPanel = ({
  post, accounts, lateAccountIds,
  onUpdate, onTogglePlatform, onSetPlatformAccount,
  onSchedulePost, onRenderVideo
}) => {
  // Local edit state (syncs back on blur)
  const [caption, setCaption] = useState(post.caption || '');
  const [hashtags, setHashtags] = useState((post.hashtags || []).join(' '));
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');

  // Sync when post changes
  useEffect(() => {
    setCaption(post.caption || '');
    setHashtags((post.hashtags || []).join(' '));
    if (post.scheduledTime) {
      const d = new Date(post.scheduledTime);
      setSchedDate(d.toISOString().split('T')[0]);
      setSchedTime(d.toTimeString().substring(0, 5));
    } else {
      setSchedDate('');
      setSchedTime('');
    }
  }, [post.id, post.caption, post.hashtags, post.scheduledTime]);

  const handleCaptionBlur = () => {
    if (caption !== (post.caption || '')) {
      onUpdate({ caption });
    }
  };

  const handleHashtagsBlur = () => {
    const tags = hashtags.split(/[\s,]+/).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`);
    if (tags.join(' ') !== (post.hashtags || []).join(' ')) {
      onUpdate({ hashtags: tags });
    }
  };

  const handleScheduleTimeChange = (newDate, newTime) => {
    const d = newDate || schedDate;
    const t = newTime || schedTime;
    if (d && t) {
      const scheduledTime = new Date(`${d}T${t}`).toISOString();
      onUpdate({ scheduledTime, status: POST_STATUS.SCHEDULED });
    }
  };

  const handleMarkDraft = () => {
    onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null });
  };

  // Available handles from accounts
  const availableHandles = useMemo(() => {
    const handles = new Set();
    accounts.forEach(acc => handles.add(acc.handle));
    return Array.from(handles);
  }, [accounts]);

  const allPlatforms = Object.values(PLATFORMS);
  const selectedPlatforms = post.platforms || {};

  return (
    <div style={s.editContainer}>
      <div style={s.panelHeader}>
        <span style={s.panelTitle}>Details</span>
      </div>

      <div style={s.editScroll}>
        {/* Caption */}
        <div style={s.editSection}>
          <label style={s.label}>Caption</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={handleCaptionBlur}
            style={s.textarea}
            rows={4}
            placeholder="Write a caption..."
          />
        </div>

        {/* Hashtags */}
        <div style={s.editSection}>
          <label style={s.label}>Hashtags</label>
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            onBlur={handleHashtagsBlur}
            style={s.textInput}
            placeholder="#tag1 #tag2 #tag3"
          />
          {post.hashtags && post.hashtags.length > 0 && (
            <div style={s.hashtagPreview}>
              {post.hashtags.map((tag, i) => (
                <span key={i} style={s.hashtagPill}>{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* Schedule Time */}
        <div style={s.editSection}>
          <label style={s.label}>Schedule Time</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="date"
              value={schedDate}
              onChange={(e) => {
                setSchedDate(e.target.value);
                handleScheduleTimeChange(e.target.value, null);
              }}
              style={{ ...s.dateInput, flex: 1 }}
            />
            <input
              type="time"
              value={schedTime}
              onChange={(e) => {
                setSchedTime(e.target.value);
                handleScheduleTimeChange(null, e.target.value);
              }}
              style={{ ...s.timeInput, flex: 1 }}
            />
          </div>
          {post.status === POST_STATUS.SCHEDULED && (
            <button style={s.linkBtn} onClick={handleMarkDraft}>
              Revert to Draft
            </button>
          )}
        </div>

        {/* Platforms */}
        <div style={s.editSection}>
          <label style={s.label}>Platforms</label>
          <div style={s.platformGrid}>
            {allPlatforms.map(platform => {
              const isActive = !!selectedPlatforms[platform];
              const color = PLATFORM_COLORS[platform];

              return (
                <div key={platform} style={s.platformItem}>
                  <button
                    style={{
                      ...s.platformToggle,
                      backgroundColor: isActive ? color + '22' : '#27272a',
                      borderColor: isActive ? color : '#3f3f46',
                      color: isActive ? color : '#71717a'
                    }}
                    onClick={() => onTogglePlatform(platform)}
                  >
                    {PLATFORM_LABELS[platform]}
                  </button>

                  {/* Account dropdown when active */}
                  {isActive && (
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
                        return (
                          <option key={handle} value={accountId} data-handle={handle}>
                            @{handle}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Post Results (if posted/failed) */}
        {post.postResults && Object.keys(post.postResults).length > 0 && (
          <div style={s.editSection}>
            <label style={s.label}>Post Results</label>
            {Object.entries(post.postResults).map(([platform, result]) => (
              <div key={platform} style={s.resultRow}>
                <span style={{ color: PLATFORM_COLORS[platform] || '#fff', fontSize: '13px' }}>
                  {PLATFORM_LABELS[platform] || platform}
                </span>
                {result.error ? (
                  <span style={{ color: '#ef4444', fontSize: '12px' }}>{result.error}</span>
                ) : (
                  <span style={{ color: '#10b981', fontSize: '12px' }}>
                    Posted {result.url && (
                      <a href={result.url} target="_blank" rel="noopener noreferrer"
                        style={{ color: '#6366f1', textDecoration: 'underline' }}>
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
  );
};

// ═══════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════

const s = {
  // Page layout
  pageContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#0a0a0f',
    color: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #27272a',
    borderTop: '3px solid #6366f1',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },

  // Header
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: '1px solid #27272a',
    backgroundColor: '#18181b'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  backBtn: {
    background: 'none',
    border: '1px solid #3f3f46',
    color: '#a1a1aa',
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  pageTitle: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '600',
    color: '#fff'
  },
  pageSubtitle: {
    margin: '2px 0 0 0',
    fontSize: '13px',
    color: '#71717a'
  },
  headerActions: {
    display: 'flex',
    gap: '12px'
  },
  bulkBtn: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid #6366f1',
    backgroundColor: 'transparent',
    color: '#a5b4fc',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },

  // Bulk schedule bar
  bulkBar: {
    padding: '16px 24px',
    backgroundColor: '#0f0f13',
    borderBottom: '1px solid #27272a'
  },
  bulkRow: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    alignItems: 'flex-end'
  },
  applyBulkBtn: {
    padding: '8px 20px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#6366f1',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },

  // Filter bar
  filterBar: {
    display: 'flex',
    gap: '4px',
    padding: '12px 24px',
    borderBottom: '1px solid #27272a',
    backgroundColor: '#18181b'
  },
  filterTab: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#71717a',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  filterTabActive: {
    backgroundColor: '#27272a',
    color: '#fff'
  },
  filterCount: {
    backgroundColor: '#3f3f46',
    color: '#a1a1aa',
    fontSize: '11px',
    padding: '1px 6px',
    borderRadius: '10px'
  },

  // 3-panel layout
  panelsContainer: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },

  // Left panel
  leftPanel: {
    width: '300px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid #27272a',
    backgroundColor: '#111114'
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #1e1e22'
  },
  panelTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  panelCount: {
    fontSize: '12px',
    color: '#52525b',
    backgroundColor: '#27272a',
    padding: '2px 8px',
    borderRadius: '10px'
  },
  queueList: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px'
  },
  emptyQueue: {
    padding: '32px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },

  // Queue card
  queueCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: '10px',
    backgroundColor: '#1a1a1e',
    marginBottom: '6px',
    transition: 'background-color 0.15s, opacity 0.2s',
    border: '1px solid transparent'
  },
  queueCardSelected: {
    backgroundColor: '#1e1e2e',
    borderColor: '#6366f1'
  },
  queueCardDragOver: {
    borderColor: '#a5b4fc',
    backgroundColor: '#1e1e30'
  },
  queueCardHandle: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    width: '20px',
    flexShrink: 0
  },
  queueNumber: {
    fontSize: '10px',
    color: '#52525b',
    fontWeight: '600'
  },
  queueThumb: {
    width: '40px',
    height: '56px',
    borderRadius: '6px',
    overflow: 'hidden',
    backgroundColor: '#27272a',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  queueThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  queueInfo: {
    flex: 1,
    minWidth: 0
  },
  queueName: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#e4e4e7',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  queueMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '3px'
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0
  },
  queueTime: {
    fontSize: '11px',
    color: '#52525b',
    marginLeft: '4px'
  },
  chipRow: {
    display: 'flex',
    gap: '3px',
    marginTop: '4px',
    flexWrap: 'wrap'
  },
  platformChip: {
    fontSize: '9px',
    fontWeight: '700',
    padding: '1px 5px',
    borderRadius: '4px',
    textTransform: 'uppercase'
  },
  queueDeleteBtn: {
    background: 'none',
    border: 'none',
    color: '#52525b',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '4px',
    flexShrink: 0
  },

  // Center panel
  centerPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: '#0d0d11'
  },
  noSelection: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%'
  },
  previewContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%'
  },
  editDraftBtn: {
    padding: '5px 12px',
    borderRadius: '6px',
    border: '1px solid #6366f1',
    backgroundColor: 'transparent',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  previewArea: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    overflow: 'hidden'
  },
  videoWrapper: {
    position: 'relative',
    width: '270px',
    height: '480px',
    borderRadius: '12px',
    overflow: 'hidden',
    backgroundColor: '#000'
  },
  previewVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  playOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.3)',
    border: 'none',
    color: '#fff',
    fontSize: '48px',
    cursor: 'pointer'
  },
  previewImage: {
    maxWidth: '270px',
    maxHeight: '480px',
    borderRadius: '12px',
    objectFit: 'contain'
  },
  previewPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  previewMeta: {
    padding: '16px',
    borderTop: '1px solid #1e1e22',
    backgroundColor: '#111114'
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: '1px solid #1a1a1e'
  },
  metaLabel: {
    fontSize: '12px',
    color: '#71717a',
    fontWeight: '500'
  },
  metaValue: {
    fontSize: '13px',
    color: '#e4e4e7'
  },
  statusPill: {
    fontSize: '11px',
    fontWeight: '600',
    padding: '2px 10px',
    borderRadius: '12px',
    textTransform: 'capitalize'
  },

  // Right panel
  rightPanel: {
    width: '340px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid #27272a',
    backgroundColor: '#111114'
  },
  editContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%'
  },
  editScroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px'
  },
  editSection: {
    marginBottom: '20px'
  },

  // Form elements
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  label: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '6px',
    display: 'block'
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#1a1a1e',
    color: '#fff',
    fontSize: '14px',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: '1.5'
  },
  textInput: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#1a1a1e',
    color: '#fff',
    fontSize: '14px'
  },
  dateInput: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#1a1a1e',
    color: '#fff',
    fontSize: '14px'
  },
  timeInput: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#1a1a1e',
    color: '#fff',
    fontSize: '14px'
  },
  select: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#27272a',
    color: '#fff',
    fontSize: '14px',
    minWidth: '120px',
    cursor: 'pointer'
  },
  numberInput: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#27272a',
    color: '#fff',
    fontSize: '14px',
    width: '90px'
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#6366f1',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '4px 0',
    marginTop: '6px'
  },
  hashtagPreview: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginTop: '8px'
  },
  hashtagPill: {
    fontSize: '12px',
    color: '#a78bfa',
    backgroundColor: '#2e1065',
    padding: '2px 8px',
    borderRadius: '12px'
  },

  // Platform grid
  platformGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  platformItem: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  platformToggle: {
    padding: '6px 14px',
    borderRadius: '8px',
    border: '1px solid',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    minWidth: '100px',
    textAlign: 'center',
    transition: 'all 0.15s'
  },
  accountSelect: {
    flex: 1,
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #3f3f46',
    backgroundColor: '#1a1a1e',
    color: '#e4e4e7',
    fontSize: '12px',
    cursor: 'pointer'
  },

  // Post results
  resultRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: '#1a1a1e',
    borderRadius: '8px',
    marginBottom: '6px'
  }
};

export default SchedulingPage;
