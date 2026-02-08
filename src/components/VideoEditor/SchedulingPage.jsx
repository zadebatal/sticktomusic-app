import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  POST_STATUS, PLATFORMS, PLATFORM_LABELS, PLATFORM_COLORS,
  createScheduledPost, updateScheduledPost, deleteScheduledPost,
  getScheduledPosts, subscribeToScheduledPosts, reorderPosts,
  addManyScheduledPosts, assignScheduleTimes, assignRandomScheduleTimes
} from '../../services/scheduledPostsService';
import { useToast, ConfirmDialog } from '../ui';
import { getCreatedContent } from '../../services/libraryService';
import log from '../../utils/logger';

/**
 * SchedulingPage — Command Center
 *
 * Dense, single-view scheduling interface. Every post and every setting
 * visible at a glance. Drafts are for viewing content — this is for deploying it.
 *
 * Layout:
 *   - Sticky header with back, add, bulk schedule controls
 *   - Status filter tabs
 *   - Scrollable post rows with inline controls (platform toggles, date/time, caption)
 *   - Expandable detail drawer per row (hashtags, hashtag bank, post results)
 *   - Calendar toggle for rhythm visualization
 */
const SchedulingPage = ({
  db,
  artistId,
  accounts = [],
  lateAccountIds = {},
  onEditDraft,
  onSchedulePost,
  onBack,
  onRenderVideo
}) => {
  const { success: toastSuccess, error: toastError } = useToast();

  // ── State ──
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedPostId, setExpandedPostId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // UI state
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'calendar'
  const [bulkScheduleMode, setBulkScheduleMode] = useState(false);
  const [queuePaused, setQueuePaused] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });

  // Bulk schedule state
  const [bulkDate, setBulkDate] = useState('');
  const [bulkTime, setBulkTime] = useState('14:00');
  const [bulkIntervalType, setBulkIntervalType] = useState('fixed');
  const [bulkFixedInterval, setBulkFixedInterval] = useState(60);
  const [bulkRandomMin, setBulkRandomMin] = useState(30);
  const [bulkRandomMax, setBulkRandomMax] = useState(120);

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

  useEffect(() => {
    setBulkDate(new Date().toISOString().split('T')[0]);
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

  // ── CRUD Handlers ──
  const handleUpdatePost = useCallback(async (postId, updates) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...updates } : p));
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
        if (expandedPostId === postId) setExpandedPostId(null);
        setConfirmDialog({ isOpen: false });
        toastSuccess('Post removed');
      }
    });
  }, [posts, db, artistId, expandedPostId, toastSuccess]);

  // ── Bulk Scheduling ──
  const handleBulkSchedule = useCallback(async () => {
    if (!bulkDate) return;
    const startTime = new Date(`${bulkDate}T${bulkTime}`);
    const drafts = posts.filter(p => p.status === POST_STATUS.DRAFT);
    if (drafts.length === 0) { toastError('No draft posts to schedule'); return; }
    let scheduled;
    if (bulkIntervalType === 'fixed') {
      scheduled = assignScheduleTimes(drafts, startTime, bulkFixedInterval);
    } else {
      scheduled = assignRandomScheduleTimes(drafts, startTime, bulkRandomMin, bulkRandomMax);
    }
    for (const post of scheduled) {
      await updateScheduledPost(db, artistId, post.id, {
        scheduledTime: post.scheduledTime,
        status: post.status
      });
    }
    toastSuccess(`Scheduled ${scheduled.length} posts`);
    setBulkScheduleMode(false);
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

  // ── Add from drafts handler ──
  const handleAddFromDrafts = useCallback(async (selectedItems) => {
    try {
      const itemsToAdd = selectedItems.map(item => ({
        contentId: item.id,
        contentType: item.type,
        contentName: item.name || item.title || (item.type === 'slideshow' ? 'Untitled Slideshow' : 'Untitled Video'),
        thumbnail: item.thumbnail || item.slides?.[0]?.backgroundImage || item.slides?.[0]?.imageUrl || null,
        cloudUrl: item.cloudUrl || null,
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
      <div style={s.header}>
        <div style={s.headerLeft}>
          <button style={s.backBtn} onClick={onBack} title="Back to Studio">
            <span style={{ fontSize: '18px' }}>&#8592;</span>
          </button>
          <div>
            <h1 style={s.pageTitle}>Schedule</h1>
            <p style={s.subtitle}>
              {posts.length} post{posts.length !== 1 ? 's' : ''} &middot; {draftCount} draft{draftCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div style={s.headerActions}>
          <button style={s.actionBtn} onClick={() => setShowAddModal(true)}>
            <span style={{ marginRight: '4px', fontSize: '14px' }}>+</span> Add from Drafts
          </button>
          <button
            style={{ ...s.actionBtn, ...(bulkScheduleMode ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
            onClick={() => setBulkScheduleMode(!bulkScheduleMode)}
          >
            Bulk Schedule
          </button>
          <button
            style={s.iconBtn}
            onClick={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
            title={viewMode === 'list' ? 'Calendar view' : 'List view'}
          >
            {viewMode === 'list' ? '📅' : '📋'}
          </button>
          <button
            style={{ ...s.iconBtn, ...(queuePaused ? { backgroundColor: '#78350f', borderColor: '#f59e0b', color: '#fbbf24' } : {}) }}
            onClick={() => setQueuePaused(!queuePaused)}
            title={queuePaused ? 'Resume' : 'Pause'}
          >
            {queuePaused ? '▶' : '⏸'}
          </button>
        </div>
      </div>

      {/* Pause Banner */}
      {queuePaused && (
        <div style={s.pauseBanner}>⏸ Queue paused — no posts will be published automatically</div>
      )}

      {/* ═══ BULK SCHEDULE BAR ═══ */}
      {bulkScheduleMode && (
        <div style={s.bulkBar}>
          <div style={s.bulkRow}>
            <div style={s.bulkPresets}>
              {[
                { label: '1/day', interval: 1440 },
                { label: '2/day', interval: 720 },
                { label: '4/day', interval: 360 },
                { label: 'Every 2hr', interval: 120 },
                { label: 'Every 6hr', interval: 360 }
              ].map(p => (
                <button
                  key={p.label}
                  style={{ ...s.presetChip, ...(bulkIntervalType === 'fixed' && bulkFixedInterval === p.interval ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
                  onClick={() => { setBulkFixedInterval(p.interval); setBulkIntervalType('fixed'); }}
                >
                  {p.label}
                </button>
              ))}
              <button
                style={{ ...s.presetChip, ...(bulkIntervalType === 'random' ? { backgroundColor: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
                onClick={() => setBulkIntervalType(bulkIntervalType === 'fixed' ? 'random' : 'fixed')}
              >
                Random
              </button>
            </div>
            <div style={s.bulkInputs}>
              <div style={s.miniField}>
                <label style={s.miniLabel}>Date</label>
                <input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} style={s.miniInput} />
              </div>
              <div style={s.miniField}>
                <label style={s.miniLabel}>Time</label>
                <input type="time" value={bulkTime} onChange={(e) => setBulkTime(e.target.value)} style={s.miniInput} />
              </div>
              {bulkIntervalType === 'fixed' ? (
                <div style={s.miniField}>
                  <label style={s.miniLabel}>Every (min)</label>
                  <input type="number" value={bulkFixedInterval} onChange={(e) => setBulkFixedInterval(Number(e.target.value))} style={{ ...s.miniInput, width: '80px' }} />
                </div>
              ) : (
                <>
                  <div style={s.miniField}>
                    <label style={s.miniLabel}>Min (min)</label>
                    <input type="number" value={bulkRandomMin} onChange={(e) => setBulkRandomMin(Number(e.target.value))} style={{ ...s.miniInput, width: '70px' }} />
                  </div>
                  <div style={s.miniField}>
                    <label style={s.miniLabel}>Max (min)</label>
                    <input type="number" value={bulkRandomMax} onChange={(e) => setBulkRandomMax(Number(e.target.value))} style={{ ...s.miniInput, width: '70px' }} />
                  </div>
                </>
              )}
              <button style={s.applyBtn} onClick={handleBulkSchedule}>
                Apply to {draftCount} Draft{draftCount !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ STATUS FILTER TABS ═══ */}
      <div style={s.filterBar}>
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

      {/* ═══ MAIN CONTENT ═══ */}
      <div style={s.content}>
        {viewMode === 'list' ? (
          /* ── Command Center List ── */
          <div style={s.listContainer}>
            {/* Column Headers */}
            <div style={s.listHeader}>
              <div style={{ width: '28px' }} />
              <div style={{ width: '44px' }} />
              <div style={{ flex: 1.2, minWidth: 0 }}>Content</div>
              <div style={{ width: '280px' }}>Platforms</div>
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
                    isDragging={draggedId === post.id}
                    isDragOver={dragOverId === post.id}
                    isPaused={queuePaused}
                    accounts={accounts}
                    lateAccountIds={lateAccountIds}
                    onToggleExpand={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)}
                    onUpdate={(updates) => handleUpdatePost(post.id, updates)}
                    onTogglePlatform={(platform) => togglePlatform(post.id, platform)}
                    onSetPlatformAccount={(platform, accountId, handle) => setPlatformAccount(post.id, platform, accountId, handle)}
                    onDelete={() => handleDeletePost(post.id)}
                    onEditDraft={onEditDraft}
                    onDragStart={(e) => handleDragStart(e, post.id)}
                    onDragOver={(e) => handleDragOver(e, post.id)}
                    onDrop={(e) => handleDrop(e, post.id)}
                    onDragEnd={handleDragEnd}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          /* ── Calendar View ── */
          <CalendarView
            posts={filteredPosts}
            expandedPostId={expandedPostId}
            onSelectPost={(id) => setExpandedPostId(expandedPostId === id ? null : id)}
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
// PostRow — Dense inline row with all scheduling controls visible
// ═══════════════════════════════════════════════════

const PostRow = ({
  post, index, isExpanded, isDragging, isDragOver, isPaused,
  accounts, lateAccountIds,
  onToggleExpand, onUpdate, onTogglePlatform, onSetPlatformAccount,
  onDelete, onEditDraft,
  onDragStart, onDragOver, onDrop, onDragEnd
}) => {
  const [caption, setCaption] = useState(post.caption || '');
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');

  // Sync local state when post changes
  useEffect(() => {
    setCaption(post.caption || '');
    if (post.scheduledTime) {
      const d = new Date(post.scheduledTime);
      setSchedDate(d.toISOString().split('T')[0]);
      setSchedTime(d.toTimeString().substring(0, 5));
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
      onUpdate({ scheduledTime: new Date(`${d}T${t}`).toISOString(), status: POST_STATUS.SCHEDULED });
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
    [POST_STATUS.DRAFT]: '#27272a',
    [POST_STATUS.SCHEDULED]: '#312e81',
    [POST_STATUS.POSTING]: '#78350f',
    [POST_STATUS.POSTED]: '#064e3b',
    [POST_STATUS.FAILED]: '#7f1d1d'
  }[post.status] || '#27272a';

  const allPlatforms = Object.values(PLATFORMS);
  const selectedPlatforms = post.platforms || {};
  const previewImage = post.thumbnail || post.editorState?.thumbnail || post.editorState?.slides?.[0]?.backgroundImage || null;

  return (
    <div style={{ borderBottom: '1px solid #1e1e22' }}>
      {/* ── Main Row ── */}
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        style={{
          ...s.row,
          ...(isDragOver ? { borderColor: '#a5b4fc', backgroundColor: '#1e1e30' } : {}),
          opacity: isDragging ? 0.4 : 1,
          position: 'relative'
        }}
      >
        {isPaused && post.status === POST_STATUS.SCHEDULED && (
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: '0', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '14px', opacity: 0.5 }}>⏸</span>
          </div>
        )}

        {/* Drag Handle + Number */}
        <div style={s.dragHandle}>
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

        {/* Content Name */}
        <div style={{ flex: 1.2, minWidth: 0, cursor: 'pointer' }} onClick={onToggleExpand}>
          <div style={s.contentName}>{post.contentName}</div>
          <div style={{ fontSize: '10px', color: '#52525b', marginTop: '1px' }}>
            {post.contentType === 'slideshow' ? 'Slideshow' : 'Video'}
          </div>
        </div>

        {/* Platform Toggles — inline */}
        <div style={{ width: '280px', display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          {allPlatforms.map(platform => {
            const isActive = !!selectedPlatforms[platform];
            const color = PLATFORM_COLORS[platform];
            return (
              <button
                key={platform}
                onClick={() => onTogglePlatform(platform)}
                style={{
                  padding: '3px 10px',
                  borderRadius: '6px',
                  border: '1px solid',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  backgroundColor: isActive ? color + '22' : '#1a1a1e',
                  borderColor: isActive ? color : '#2a2a2e',
                  color: isActive ? color : '#52525b',
                  transition: 'all 0.12s'
                }}
              >
                {PLATFORM_LABELS[platform]}
              </button>
            );
          })}
        </div>

        {/* Schedule Date/Time — inline */}
        <div style={{ width: '190px', display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            type="date"
            value={schedDate}
            onChange={(e) => { setSchedDate(e.target.value); handleScheduleChange(e.target.value, null); }}
            style={s.inlineDate}
          />
          <input
            type="time"
            value={schedTime}
            onChange={(e) => { setSchedTime(e.target.value); handleScheduleChange(null, e.target.value); }}
            style={s.inlineTime}
          />
        </div>

        {/* Caption preview — inline */}
        <div style={{ width: '200px' }}>
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={handleCaptionBlur}
            placeholder="Caption..."
            style={s.inlineCaption}
          />
        </div>

        {/* Status */}
        <div style={{ width: '80px', textAlign: 'center' }}>
          <span style={{ ...s.statusPill, backgroundColor: statusBg, color: statusColor }}>
            {post.status}
          </span>
        </div>

        {/* Actions */}
        <div style={{ width: '60px', display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
          <button style={s.rowIconBtn} onClick={onToggleExpand} title="Expand details">
            <span style={{ fontSize: '12px', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▼</span>
          </button>
          <button style={{ ...s.rowIconBtn, color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Remove">
            ×
          </button>
        </div>
      </div>

      {/* ── Expanded Detail Drawer ── */}
      {isExpanded && (
        <ExpandedDrawer
          post={post}
          accounts={accounts}
          lateAccountIds={lateAccountIds}
          onUpdate={onUpdate}
          onTogglePlatform={onTogglePlatform}
          onSetPlatformAccount={onSetPlatformAccount}
          onEditDraft={onEditDraft}
        />
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════
// ExpandedDrawer — Full details for a post (hashtags, bank, results, actions)
// ═══════════════════════════════════════════════════

const ExpandedDrawer = ({ post, accounts, lateAccountIds, onUpdate, onTogglePlatform, onSetPlatformAccount, onEditDraft }) => {
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

  return (
    <div style={s.drawer}>
      <div style={s.drawerGrid}>
        {/* Left: Preview + Actions */}
        <div style={s.drawerLeft}>
          {/* Small preview */}
          <div style={s.drawerPreview}>
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
          {/* Status Actions */}
          <div style={s.drawerActions}>
            {post.editorState && onEditDraft && (
              <button style={s.drawerBtn} onClick={() => onEditDraft(post)}>Edit in Studio</button>
            )}
            {post.status === POST_STATUS.DRAFT && post.scheduledTime && (
              <button style={{ ...s.drawerBtn, backgroundColor: '#312e81', color: '#a5b4fc', borderColor: '#6366f1' }} onClick={() => onUpdate({ status: POST_STATUS.SCHEDULED })}>
                Confirm Schedule
              </button>
            )}
            {post.status === POST_STATUS.SCHEDULED && (
              <>
                <button style={{ ...s.drawerBtn, backgroundColor: '#064e3b', color: '#6ee7b7', borderColor: '#10b981' }} onClick={() => onUpdate({ status: POST_STATUS.POSTING })}>
                  Publish Now
                </button>
                <button style={s.drawerBtn} onClick={() => onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null })}>
                  Revert to Draft
                </button>
              </>
            )}
            {post.status === POST_STATUS.FAILED && (
              <button style={{ ...s.drawerBtn, backgroundColor: '#78350f', color: '#fbbf24', borderColor: '#f59e0b' }} onClick={() => onUpdate({ status: POST_STATUS.SCHEDULED })}>
                Retry
              </button>
            )}
            {(post.status === POST_STATUS.POSTING || post.status === POST_STATUS.FAILED) && (
              <button style={s.drawerBtn} onClick={() => onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null })}>
                Revert to Draft
              </button>
            )}
          </div>
        </div>

        {/* Center: Hashtags + Bank */}
        <div style={s.drawerCenter}>
          <label style={s.drawerLabel}>Hashtags</label>
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            onBlur={handleHashtagsBlur}
            placeholder="#tag1 #tag2 #tag3"
            style={s.drawerInput}
          />
          {post.hashtags && post.hashtags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
              {post.hashtags.map((tag, i) => (
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
                    <button
                      style={s.hashtagSetBtn}
                      onClick={() => handleApplySet(set)}
                      title={set.tags.join(' ')}
                    >
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
        </div>

        {/* Right: Account Selection + Results */}
        <div style={s.drawerRight}>
          {/* Per-platform account selector */}
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

          {/* Post Results */}
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
// AddFromDraftsModal — Modal to add content from library
// ═══════════════════════════════════════════════════

const AddFromDraftsModal = ({ artistId, existingContentIds, onAdd, onClose }) => {
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
// CalendarView — Month calendar with drag support
// ═══════════════════════════════════════════════════

const CalendarView = ({ posts, expandedPostId, onSelectPost, calendarDate, onChangeMonth, onDragPost }) => {
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

  const postsPerDay = {};
  posts.forEach(post => {
    if (post.scheduledTime) {
      const dateKey = new Date(post.scheduledTime).toDateString();
      if (!postsPerDay[dateKey]) postsPerDay[dateKey] = [];
      postsPerDay[dateKey].push(post);
    }
  });

  const today = new Date().toDateString();

  return (
    <div style={s.calView}>
      <div style={s.calHeader}>
        <button style={s.calNavBtn} onClick={() => onChangeMonth(new Date(year, month - 1))}>&#8249;</button>
        <span style={s.calTitle}>{firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button style={s.calNavBtn} onClick={() => onChangeMonth(new Date(year, month + 1))}>&#8250;</button>
        <button style={{ ...s.drawerBtn, marginLeft: '8px', padding: '4px 10px' }} onClick={() => onChangeMonth(new Date())}>Today</button>
      </div>
      <div style={s.calGrid}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} style={s.calDayHeader}>{d}</div>
        ))}
        {days.map((date, idx) => {
          const dateKey = date?.toDateString();
          const dayPosts = dateKey ? (postsPerDay[dateKey] || []) : [];
          const isToday = dateKey === today;
          return (
            <div
              key={idx}
              style={{ ...s.calCell, ...(isToday ? { borderColor: '#6366f1', borderWidth: '2px' } : {}) }}
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
                          padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '500', color: '#fff', cursor: 'pointer',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          backgroundColor: { [POST_STATUS.DRAFT]: '#71717a', [POST_STATUS.SCHEDULED]: '#6366f1', [POST_STATUS.POSTING]: '#f59e0b', [POST_STATUS.POSTED]: '#10b981', [POST_STATUS.FAILED]: '#ef4444' }[post.status] || '#71717a',
                          ...(expandedPostId === post.id ? { boxShadow: '0 0 0 2px #6366f1' } : {}),
                          opacity: draggedPostId === post.id ? 0.5 : 1
                        }}
                        title={`${post.contentName} — ${new Date(post.scheduledTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                      >
                        {post.contentName.substring(0, 12)}
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
// Styles — Optimized for command center density
// ═══════════════════════════════════════════════════

const s = {
  // Page
  page: { display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0a0a0f', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  loadingState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' },
  spinner: { width: '32px', height: '32px', border: '3px solid #27272a', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' },

  // Header
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #27272a', backgroundColor: '#18181b', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  backBtn: { background: 'none', border: '1px solid #3f3f46', color: '#a1a1aa', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  pageTitle: { margin: 0, fontSize: '18px', fontWeight: '600', color: '#fff' },
  subtitle: { margin: '1px 0 0 0', fontSize: '12px', color: '#71717a' },
  headerActions: { display: 'flex', gap: '6px' },
  actionBtn: { padding: '6px 14px', borderRadius: '8px', border: '1px solid #6366f1', backgroundColor: 'transparent', color: '#a5b4fc', fontSize: '12px', fontWeight: '500', cursor: 'pointer', whiteSpace: 'nowrap' },
  iconBtn: { padding: '6px 10px', borderRadius: '8px', border: '1px solid #3f3f46', backgroundColor: 'transparent', color: '#a1a1aa', fontSize: '14px', cursor: 'pointer' },

  // Pause banner
  pauseBanner: { padding: '8px 20px', backgroundColor: '#78350f', color: '#fbbf24', fontSize: '12px', fontWeight: '500', borderBottom: '1px solid #27272a', flexShrink: 0 },

  // Bulk bar
  bulkBar: { padding: '12px 20px', backgroundColor: '#0f0f13', borderBottom: '1px solid #27272a', flexShrink: 0 },
  bulkRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' },
  bulkPresets: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  bulkInputs: { display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' },
  presetChip: { padding: '5px 10px', borderRadius: '6px', border: '1px solid #3f3f46', backgroundColor: '#27272a', color: '#a1a1aa', fontSize: '11px', fontWeight: '600', cursor: 'pointer' },
  miniField: { display: 'flex', flexDirection: 'column', gap: '2px' },
  miniLabel: { fontSize: '9px', fontWeight: '600', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px' },
  miniInput: { padding: '5px 8px', borderRadius: '6px', border: '1px solid #3f3f46', backgroundColor: '#1a1a1e', color: '#fff', fontSize: '12px' },
  applyBtn: { padding: '6px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#6366f1', color: '#fff', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' },

  // Filter bar
  filterBar: { display: 'flex', gap: '3px', padding: '8px 20px', borderBottom: '1px solid #27272a', backgroundColor: '#111114', overflowX: 'auto', flexShrink: 0 },
  filterTab: { padding: '5px 12px', borderRadius: '6px', border: 'none', backgroundColor: 'transparent', color: '#71717a', fontSize: '12px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' },
  filterTabActive: { backgroundColor: '#27272a', color: '#fff' },
  badge: { backgroundColor: '#3f3f46', color: '#a1a1aa', fontSize: '10px', padding: '1px 5px', borderRadius: '8px' },

  // Content area
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },

  // List
  listContainer: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  listHeader: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderBottom: '1px solid #1e1e22', backgroundColor: '#111114', fontSize: '10px', fontWeight: '600', color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 },
  listScroll: { flex: 1, overflowY: 'auto' },
  emptyState: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 20px' },

  // Row
  row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 20px', backgroundColor: '#0a0a0f', transition: 'background-color 0.1s', border: '1px solid transparent', cursor: 'default' },
  dragHandle: { width: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', flexShrink: 0 },
  thumb: { width: '44px', height: '56px', borderRadius: '6px', overflow: 'hidden', backgroundColor: '#1a1a1e', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  contentName: { fontSize: '13px', fontWeight: '500', color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  // Inline controls
  inlineDate: { width: '105px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #2a2a2e', backgroundColor: '#111114', color: '#a1a1aa', fontSize: '11px' },
  inlineTime: { width: '80px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #2a2a2e', backgroundColor: '#111114', color: '#a1a1aa', fontSize: '11px' },
  inlineCaption: { width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #2a2a2e', backgroundColor: '#111114', color: '#d4d4d8', fontSize: '11px', fontFamily: 'inherit' },

  // Status pill
  statusPill: { fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '10px', textTransform: 'capitalize', display: 'inline-block' },
  rowIconBtn: { background: 'none', border: 'none', color: '#52525b', fontSize: '14px', cursor: 'pointer', padding: '4px', borderRadius: '4px' },

  // Expanded drawer
  drawer: { backgroundColor: '#111114', borderTop: '1px solid #1e1e22', padding: '16px 20px 16px 100px' },
  drawerGrid: { display: 'grid', gridTemplateColumns: '180px 1fr 240px', gap: '20px' },
  drawerLeft: { display: 'flex', flexDirection: 'column', gap: '10px' },
  drawerPreview: { width: '180px', height: '140px', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#0a0a0f' },
  drawerVideo: { width: '100%', height: '100%', objectFit: 'contain' },
  drawerImg: { width: '100%', height: '100%', objectFit: 'cover' },
  drawerActions: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  drawerBtn: { padding: '5px 12px', borderRadius: '6px', border: '1px solid #3f3f46', backgroundColor: '#27272a', color: '#a1a1aa', fontSize: '11px', fontWeight: '500', cursor: 'pointer' },
  drawerCenter: { flex: 1, minWidth: 0 },
  drawerRight: { width: '240px' },
  drawerLabel: { fontSize: '10px', fontWeight: '600', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', display: 'block' },
  drawerInput: { width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #3f3f46', backgroundColor: '#1a1a1e', color: '#fff', fontSize: '13px', fontFamily: 'inherit' },
  hashtagPill: { fontSize: '11px', color: '#a78bfa', backgroundColor: '#2e1065', padding: '2px 8px', borderRadius: '10px' },
  hashtagSetBtn: { padding: '3px 8px', borderRadius: '5px', border: '1px solid #6366f1', backgroundColor: '#312e81', color: '#a5b4fc', fontSize: '11px', fontWeight: '500', cursor: 'pointer' },
  linkBtn: { background: 'none', border: 'none', color: '#6366f1', fontSize: '11px', cursor: 'pointer', padding: '2px 0' },
  accountSelect: { flex: 1, padding: '4px 8px', borderRadius: '5px', border: '1px solid #3f3f46', backgroundColor: '#1a1a1e', color: '#e4e4e7', fontSize: '11px', cursor: 'pointer' },
  resultRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', backgroundColor: '#1a1a1e', borderRadius: '6px', marginBottom: '4px' },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#18181b', borderRadius: '12px', border: '1px solid #27272a', width: '90%', maxWidth: '700px', maxHeight: '75vh', display: 'flex', flexDirection: 'column' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #27272a' },
  modalTitle: { margin: 0, fontSize: '16px', fontWeight: '600', color: '#fff' },
  modalClose: { background: 'none', border: 'none', color: '#71717a', fontSize: '22px', cursor: 'pointer' },
  modalTabs: { display: 'flex', gap: '3px', padding: '8px 20px', borderBottom: '1px solid #27272a', backgroundColor: '#111114' },
  modalLoading: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px' },
  modalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px', padding: '14px 20px', overflow: 'auto', flex: 1 },
  modalCard: { display: 'flex', flexDirection: 'column', borderRadius: '8px', border: '1px solid #27272a', backgroundColor: '#1a1a1e', cursor: 'pointer', transition: 'all 0.1s', position: 'relative' },
  modalCardThumb: { width: '100%', height: '100px', backgroundColor: '#27272a', borderRadius: '7px 7px 0 0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dupBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#f59e0b', color: '#000', fontSize: '9px', fontWeight: '600', padding: '2px 0', textAlign: 'center' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderTop: '1px solid #27272a', backgroundColor: '#111114' },

  // Calendar
  calView: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  calHeader: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 20px', borderBottom: '1px solid #27272a', backgroundColor: '#18181b' },
  calNavBtn: { background: 'none', border: '1px solid #3f3f46', color: '#a1a1aa', width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer', fontSize: '16px' },
  calTitle: { fontSize: '15px', fontWeight: '600', color: '#fff', minWidth: '150px', textAlign: 'center' },
  calGrid: { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', padding: '8px', backgroundColor: '#27272a', overflow: 'auto' },
  calDayHeader: { padding: '8px 6px', backgroundColor: '#18181b', color: '#71717a', fontSize: '11px', fontWeight: '600', textAlign: 'center', textTransform: 'uppercase' },
  calCell: { backgroundColor: '#111114', padding: '6px', minHeight: '90px', display: 'flex', flexDirection: 'column', border: '1px solid #27272a' },
  calCellDate: { fontSize: '11px', fontWeight: '600', color: '#a1a1aa', marginBottom: '3px' }
};

export default SchedulingPage;
