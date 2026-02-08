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
 * SchedulingPage — Complete scheduling and queue management system
 *
 * Features:
 *   - List and calendar view modes
 *   - Draggable queue ladder (left panel)
 *   - Preview panel (center)
 *   - Edit details panel (right) with hashtag bank
 *   - Add from drafts with duplicate detection
 *   - Bulk scheduling with preset intervals
 *   - Pause/resume queue functionality
 *   - Status flow: Draft → Scheduled → Posting → Posted/Failed
 *   - Calendar view with drag-between-days support
 *   - Real-time Firestore subscription
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
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // UI state
  const [showBulkSchedule, setShowBulkSchedule] = useState(false);
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
  const [dragFromDay, setDragFromDay] = useState(null);

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

  useEffect(() => {
    setBulkDate(new Date().toISOString().split('T')[0]);
  }, []);

  useEffect(() => {
    if (!selectedPostId && posts.length > 0) {
      setSelectedPostId(posts[0].id);
    }
  }, [posts, selectedPostId]);

  // ── Drag & Drop Handlers ──
  const handleDragStart = useCallback((e, postId) => {
    setDraggedId(postId);
    e.dataTransfer.effectAllowed = 'move';
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

  // ── Add from drafts handler ──
  const handleAddFromDrafts = useCallback(async (selectedItems) => {
    try {
      const itemsToAdd = selectedItems.map(item => ({
        contentId: item.id,
        contentType: item.type,
        contentName: item.name,
        thumbnail: item.thumbnail || null,
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
            style={s.headerBtn}
            onClick={() => setShowAddModal(true)}
            title="Add from drafts"
          >
            <span style={{ marginRight: '6px' }}>+</span>Add from Drafts
          </button>
          <button
            style={{
              ...s.headerBtn,
              backgroundColor: bulkScheduleMode ? '#6366f1' : 'transparent'
            }}
            onClick={() => setBulkScheduleMode(!bulkScheduleMode)}
            title="Toggle bulk schedule mode"
          >
            Bulk Schedule
          </button>
          <button
            style={s.viewToggleBtn}
            onClick={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
            title={viewMode === 'list' ? 'Switch to calendar' : 'Switch to list'}
          >
            {viewMode === 'list' ? '📅' : '📋'}
          </button>
          <button
            style={{
              ...s.headerBtn,
              backgroundColor: queuePaused ? '#f59e0b' : 'transparent',
              borderColor: queuePaused ? '#f59e0b' : '#6366f1'
            }}
            onClick={() => setQueuePaused(!queuePaused)}
            title={queuePaused ? 'Resume queue' : 'Pause queue'}
          >
            {queuePaused ? '▶' : '⏸'}
          </button>
        </div>
      </div>

      {/* Pause Banner */}
      {queuePaused && (
        <div style={s.pauseBanner}>
          ⏸ Queue paused — no posts will be published
        </div>
      )}

      {/* Bulk Schedule Bar */}
      {bulkScheduleMode && (
        <div style={s.bulkBar}>
          <div style={s.bulkRow}>
            <div style={s.bulkPresets}>
              {[
                { label: '1/day', fn: () => { setBulkFixedInterval(1440); setBulkIntervalType('fixed'); } },
                { label: '2/day', fn: () => { setBulkFixedInterval(720); setBulkIntervalType('fixed'); } },
                { label: '4/day', fn: () => { setBulkFixedInterval(360); setBulkIntervalType('fixed'); } },
                { label: 'Every 2hr', fn: () => { setBulkFixedInterval(120); setBulkIntervalType('fixed'); } },
                { label: 'Every 6hr', fn: () => { setBulkFixedInterval(360); setBulkIntervalType('fixed'); } }
              ].map(preset => (
                <button key={preset.label} style={s.presetBtn} onClick={preset.fn}>
                  {preset.label}
                </button>
              ))}
              <button style={s.presetBtn} onClick={() => setBulkIntervalType(bulkIntervalType === 'fixed' ? 'random' : 'fixed')}>
                {bulkIntervalType === 'fixed' ? 'Custom' : 'Custom (Random)'}
              </button>
            </div>
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
            {bulkIntervalType === 'fixed' ? (
              <div style={s.controlGroup}>
                <label style={s.label}>Every (min)</label>
                <input
                  type="number"
                  value={bulkFixedInterval}
                  onChange={(e) => setBulkFixedInterval(Number(e.target.value))}
                  style={s.numberInput}
                />
              </div>
            ) : (
              <>
                <div style={s.controlGroup}>
                  <label style={s.label}>Min (min)</label>
                  <input
                    type="number"
                    value={bulkRandomMin}
                    onChange={(e) => setBulkRandomMin(Number(e.target.value))}
                    style={s.numberInput}
                  />
                </div>
                <div style={s.controlGroup}>
                  <label style={s.label}>Max (min)</label>
                  <input
                    type="number"
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
          { key: POST_STATUS.POSTING, label: 'Posting' },
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

      {/* Main Content Area */}
      <div style={s.panelsContainer}>
        {viewMode === 'list' ? (
          <>
            {/* Left Panel: Queue Ladder */}
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
                        ? 'No posts yet. Add content from drafts.'
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
                      isPaused={queuePaused}
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

            {/* Center Panel: Preview */}
            <div style={s.centerPanel}>
              {selectedPost ? (
                <PreviewPanel
                  post={selectedPost}
                  onEditDraft={onEditDraft}
                  onUpdate={(updates) => handleUpdatePost(selectedPost.id, updates)}
                />
              ) : (
                <div style={s.noSelection}>
                  <p style={{ color: '#71717a', fontSize: '14px' }}>
                    Select a post from the queue to preview
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Calendar View */
          <CalendarView
            posts={filteredPosts}
            selectedPostId={selectedPostId}
            onSelectPost={setSelectedPostId}
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

        {/* Right Panel: Edit Details */}
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
      } catch (err) {
        log.error('Failed to load content:', err);
      }
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
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }
    setSelectedItems(newSet);
  };

  const handleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(item => item.id)));
    }
  };

  const handleAdd = () => {
    const itemsToAdd = items.filter(item => selectedItems.has(item.id));
    onAdd(itemsToAdd);
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <h2 style={s.modalTitle}>Add from Drafts</h2>
          <button style={s.modalCloseBtn} onClick={onClose}>×</button>
        </div>

        {/* Tabs */}
        <div style={s.modalTabs}>
          {['all', 'videos', 'slideshows'].map(tab => (
            <button
              key={tab}
              style={{
                ...s.modalTab,
                ...(selectedTab === tab ? s.modalTabActive : {})
              }}
              onClick={() => {
                setSelectedTab(tab);
                setSelectedItems(new Set());
              }}
            >
              {tab === 'all' ? 'All' : tab === 'videos' ? 'Videos' : 'Slideshows'}
            </button>
          ))}
        </div>

        {/* Content Grid */}
        {loadingContent ? (
          <div style={s.modalLoading}>
            <div style={s.spinner} />
            <p style={{ color: '#71717a', marginTop: '16px' }}>Loading content...</p>
          </div>
        ) : (
          <>
            <div style={s.modalItemsContainer}>
              {items.length === 0 ? (
                <div style={s.modalEmpty}>
                  <p style={{ color: '#71717a' }}>No content available</p>
                </div>
              ) : (
                <div style={s.modalGrid}>
                  {items.map(item => {
                    const isDuplicate = existingContentIds.has(item.id);
                    const isSelected = selectedItems.has(item.id);
                    return (
                      <div
                        key={item.id}
                        style={{
                          ...s.modalCard,
                          ...(isSelected ? s.modalCardSelected : {}),
                          opacity: isDuplicate ? 0.7 : 1
                        }}
                        onClick={() => handleSelectItem(item.id)}
                      >
                        <div style={s.modalCardThumb}>
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" style={s.modalCardThumbImg} />
                          ) : (
                            <span style={{ fontSize: '32px' }}>
                              {item.type === 'slideshow' ? '🖼️' : '🎥'}
                            </span>
                          )}
                          {isDuplicate && (
                            <div style={s.duplicateBadge}>Already queued</div>
                          )}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectItem(item.id)}
                            style={s.modalCardCheckbox}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div style={s.modalCardContent}>
                          <p style={s.modalCardName}>{item.name}</p>
                          <span style={s.modalCardType}>
                            {item.type === 'slideshow' ? 'Slideshow' : 'Video'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={s.modalFooter}>
              <div style={s.modalFooterLeft}>
                <button style={s.modalFooterBtn} onClick={handleSelectAll}>
                  {selectedItems.size === items.length ? 'Clear' : 'Select All'}
                </button>
              </div>
              <div style={s.modalFooterRight}>
                <button style={{ ...s.modalFooterBtn, backgroundColor: '#27272a' }} onClick={onClose}>
                  Cancel
                </button>
                <button
                  style={{
                    ...s.modalFooterBtn,
                    backgroundColor: '#6366f1',
                    color: '#fff',
                    opacity: selectedItems.size === 0 ? 0.5 : 1,
                    cursor: selectedItems.size === 0 ? 'default' : 'pointer'
                  }}
                  onClick={handleAdd}
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
// QueueCard — Left panel item (draggable)
// ═══════════════════════════════════════════════════

const QueueCard = ({
  post, index, isSelected, isDragging, isDragOver, isPaused,
  onSelect, onDragStart, onDragOver, onDrop, onDragEnd, onDelete
}) => {
  const statusColor = {
    [POST_STATUS.DRAFT]: '#71717a',
    [POST_STATUS.SCHEDULED]: '#6366f1',
    [POST_STATUS.POSTING]: '#f59e0b',
    [POST_STATUS.POSTED]: '#10b981',
    [POST_STATUS.FAILED]: '#ef4444'
  }[post.status] || '#71717a';

  const typeIcon = post.contentType === 'slideshow' ? '🖼️' : '🎥';
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
        cursor: isDragging ? 'grabbing' : 'grab',
        position: 'relative'
      }}
    >
      {isPaused && post.status === POST_STATUS.SCHEDULED && (
        <div style={s.pauseOverlay}>⏸</div>
      )}

      <div style={s.queueCardHandle}>
        <span style={{ color: '#52525b', fontSize: '14px' }}>{'\u2630'}</span>
        <span style={s.queueNumber}>#{index + 1}</span>
      </div>

      <div style={s.queueThumb}>
        {post.thumbnail ? (
          <img src={post.thumbnail} alt="" style={s.queueThumbImg} />
        ) : (
          <span style={{ fontSize: '18px' }}>{typeIcon}</span>
        )}
      </div>

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

const PreviewPanel = ({ post, onEditDraft, onUpdate }) => {
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
            Edit in Studio
          </button>
        )}
      </div>

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
              {isPlaying ? '⏸' : '▶'}
            </button>
          </div>
        ) : post.thumbnail ? (
          <img src={post.thumbnail} alt={post.contentName} style={s.previewImage} />
        ) : (
          <div style={s.previewPlaceholder}>
            <span style={{ fontSize: '48px' }}>
              {post.contentType === 'slideshow' ? '🖼️' : '🎥'}
            </span>
            <p style={{ color: '#71717a', marginTop: '12px', fontSize: '14px' }}>
              No preview available
            </p>
          </div>
        )}
      </div>

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

        {/* Status action buttons */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          {post.status === POST_STATUS.DRAFT && post.scheduledTime && (
            <button
              style={{ ...s.statusActionBtn, backgroundColor: '#312e81', color: '#a5b4fc', borderColor: '#6366f1' }}
              onClick={() => onUpdate({ status: POST_STATUS.SCHEDULED })}
            >
              Schedule
            </button>
          )}
          {post.status === POST_STATUS.SCHEDULED && (
            <>
              <button
                style={{ ...s.statusActionBtn, backgroundColor: '#064e3b', color: '#6ee7b7', borderColor: '#10b981' }}
                onClick={() => onUpdate({ status: POST_STATUS.POSTING })}
              >
                Publish Now
              </button>
              <button
                style={{ ...s.statusActionBtn, backgroundColor: '#27272a', color: '#a1a1aa', borderColor: '#3f3f46' }}
                onClick={() => onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null })}
              >
                Revert to Draft
              </button>
            </>
          )}
          {post.status === POST_STATUS.FAILED && (
            <button
              style={{ ...s.statusActionBtn, backgroundColor: '#78350f', color: '#fbbf24', borderColor: '#f59e0b' }}
              onClick={() => onUpdate({ status: POST_STATUS.SCHEDULED })}
            >
              Retry
            </button>
          )}
          {(post.status === POST_STATUS.POSTING || post.status === POST_STATUS.FAILED) && (
            <button
              style={{ ...s.statusActionBtn, backgroundColor: '#27272a', color: '#a1a1aa', borderColor: '#3f3f46' }}
              onClick={() => onUpdate({ status: POST_STATUS.DRAFT, scheduledTime: null })}
            >
              Revert to Draft
            </button>
          )}
        </div>

        {/* Post results (if posted/failed) */}
        {post.postResults && Object.keys(post.postResults).length > 0 && (
          <div style={{ marginTop: '12px' }}>
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
// EditPanel — Right panel (caption, hashtags, platforms, time)
// ═══════════════════════════════════════════════════

const EditPanel = ({
  post, accounts, lateAccountIds,
  onUpdate, onTogglePlatform, onSetPlatformAccount,
  onSchedulePost, onRenderVideo
}) => {
  const [caption, setCaption] = useState(post.caption || '');
  const [hashtags, setHashtags] = useState((post.hashtags || []).join(' '));
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [hashtagBank, setHashtagBank] = useState([]);
  const [showSaveHashtagSet, setShowSaveHashtagSet] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  // Load hashtag bank from localStorage
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

  const handleApplyHashtagSet = (set) => {
    setHashtags(set.tags.join(' '));
    onUpdate({ hashtags: set.tags });
  };

  const handleSaveHashtagSet = () => {
    if (!newSetName.trim()) return;
    const tags = hashtags.split(/[\s,]+/).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`);
    const newSet = { id: Date.now().toString(), name: newSetName, tags };
    const updated = [...hashtagBank, newSet];
    const artistId = post.id?.split('/')[0] || 'default';
    const key = `stm_hashtag_bank_${artistId}`;
    localStorage.setItem(key, JSON.stringify(updated));
    setHashtagBank(updated);
    setNewSetName('');
    setShowSaveHashtagSet(false);
  };

  const handleDeleteHashtagSet = (setId) => {
    const updated = hashtagBank.filter(s => s.id !== setId);
    const artistId = post.id?.split('/')[0] || 'default';
    const key = `stm_hashtag_bank_${artistId}`;
    localStorage.setItem(key, JSON.stringify(updated));
    setHashtagBank(updated);
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

        {/* Hashtag Bank */}
        {hashtagBank.length > 0 && (
          <div style={s.editSection}>
            <label style={s.label}>Hashtag Sets</label>
            <div style={s.hashtagBank}>
              {hashtagBank.map(set => (
                <div key={set.id} style={s.hashtagSet}>
                  <button
                    style={s.hashtagSetPill}
                    onClick={() => handleApplyHashtagSet(set)}
                    title={`Apply: ${set.tags.join(' ')}`}
                  >
                    {set.name} ({set.tags.length})
                  </button>
                  <button
                    style={s.hashtagSetDelete}
                    onClick={() => handleDeleteHashtagSet(set.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save current hashtags as set */}
        <div style={s.editSection}>
          {!showSaveHashtagSet ? (
            <button
              style={s.saveHashtagBtn}
              onClick={() => setShowSaveHashtagSet(true)}
            >
              Save Current as Set
            </button>
          ) : (
            <div style={s.saveHashtagForm}>
              <input
                type="text"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="Set name (e.g., 'Gaming')"
                style={s.textInput}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                  style={{ ...s.saveHashtagBtn, flex: 1 }}
                  onClick={handleSaveHashtagSet}
                >
                  Save
                </button>
                <button
                  style={{ ...s.saveHashtagBtn, backgroundColor: '#27272a', color: '#a1a1aa', flex: 1 }}
                  onClick={() => setShowSaveHashtagSet(false)}
                >
                  Cancel
                </button>
              </div>
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

        {/* Post Results */}
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
// CalendarView — Month calendar with drag support
// ═══════════════════════════════════════════════════

const CalendarView = ({ posts, selectedPostId, onSelectPost, calendarDate, onChangeMonth, onDragPost }) => {
  const [draggedPostId, setDraggedPostId] = useState(null);
  const [dragFromDate, setDragFromDate] = useState(null);

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days = [];
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }

  const postsPerDay = {};
  posts.forEach(post => {
    if (post.scheduledTime) {
      const dateKey = new Date(post.scheduledTime).toDateString();
      if (!postsPerDay[dateKey]) postsPerDay[dateKey] = [];
      postsPerDay[dateKey].push(post);
    }
  });

  const today = new Date().toDateString();

  const handleDragPostStart = (e, postId, date) => {
    e.stopPropagation();
    setDraggedPostId(postId);
    setDragFromDate(date);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragPostOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropPost = (e, toDate) => {
    e.preventDefault();
    if (draggedPostId && dragFromDate) {
      onDragPost(draggedPostId, dragFromDate, toDate);
    }
    setDraggedPostId(null);
    setDragFromDate(null);
  };

  return (
    <div style={s.calendarView}>
      <div style={s.calendarHeader}>
        <div style={s.calendarNav}>
          <button style={s.calendarNavBtn} onClick={() => onChangeMonth(new Date(year, month - 1))}>
            &#8249;
          </button>
          <span style={s.calendarTitle}>
            {firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button style={s.calendarNavBtn} onClick={() => onChangeMonth(new Date(year, month + 1))}>
            &#8250;
          </button>
          <button style={s.calendarTodayBtn} onClick={() => onChangeMonth(new Date())}>
            Today
          </button>
        </div>
      </div>

      <div style={s.calendarGrid}>
        {/* Day headers */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} style={s.calendarDayHeader}>
            {day}
          </div>
        ))}

        {/* Day cells */}
        {days.map((date, idx) => {
          const dateKey = date?.toDateString();
          const dayPosts = dateKey ? (postsPerDay[dateKey] || []) : [];
          const isToday = dateKey === today;

          return (
            <div
              key={idx}
              style={{
                ...s.calendarCell,
                ...(isToday ? s.calendarCellToday : {})
              }}
              onDragOver={date ? handleDragPostOver : null}
              onDrop={date ? (e) => handleDropPost(e, date) : null}
            >
              {date && (
                <>
                  <div style={s.calendarCellDate}>{date.getDate()}</div>
                  <div style={s.calendarCellPosts}>
                    {dayPosts.map(post => (
                      <div
                        key={post.id}
                        draggable
                        onDragStart={(e) => handleDragPostStart(e, post.id, date)}
                        onClick={() => onSelectPost(post.id)}
                        style={{
                          ...s.calendarPostChip,
                          backgroundColor: {
                            [POST_STATUS.DRAFT]: '#71717a',
                            [POST_STATUS.SCHEDULED]: '#6366f1',
                            [POST_STATUS.POSTING]: '#f59e0b',
                            [POST_STATUS.POSTED]: '#10b981',
                            [POST_STATUS.FAILED]: '#ef4444'
                          }[post.status] || '#71717a',
                          ...(selectedPostId === post.id ? s.calendarPostChipSelected : {}),
                          opacity: draggedPostId === post.id ? 0.5 : 1
                        }}
                        title={post.contentName}
                      >
                        {post.contentName.substring(0, 10)}
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
    gap: '8px'
  },
  headerBtn: {
    padding: '8px 14px',
    borderRadius: '8px',
    border: '1px solid #6366f1',
    backgroundColor: 'transparent',
    color: '#a5b4fc',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  viewToggleBtn: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: 'transparent',
    color: '#a1a1aa',
    fontSize: '16px',
    cursor: 'pointer'
  },

  // Pause banner
  pauseBanner: {
    padding: '10px 24px',
    backgroundColor: '#78350f',
    color: '#fbbf24',
    fontSize: '13px',
    fontWeight: '500',
    borderBottom: '1px solid #27272a'
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
  bulkPresets: {
    display: 'flex',
    gap: '6px'
  },
  presetBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #3f3f46',
    backgroundColor: '#27272a',
    color: '#a1a1aa',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer'
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
    backgroundColor: '#18181b',
    overflowX: 'auto'
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
    gap: '6px',
    whiteSpace: 'nowrap'
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
  pauseOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    fontSize: '18px',
    borderRadius: '10px'
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
  hashtagBank: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  hashtagSet: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  hashtagSetPill: {
    flex: 1,
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid #6366f1',
    backgroundColor: '#312e81',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    textAlign: 'left'
  },
  hashtagSetDelete: {
    background: 'none',
    border: 'none',
    color: '#71717a',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '2px 6px'
  },
  saveHashtagBtn: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #6366f1',
    backgroundColor: '#312e81',
    color: '#a5b4fc',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  saveHashtagForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
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

  // Status action buttons (Preview panel)
  statusActionBtn: {
    padding: '6px 16px',
    borderRadius: '8px',
    border: '1px solid',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'opacity 0.15s'
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
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: '#18181b',
    borderRadius: '12px',
    border: '1px solid #27272a',
    width: '90%',
    maxWidth: '800px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #27272a'
  },
  modalTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff'
  },
  modalCloseBtn: {
    background: 'none',
    border: 'none',
    color: '#71717a',
    fontSize: '24px',
    cursor: 'pointer'
  },
  modalTabs: {
    display: 'flex',
    gap: '4px',
    padding: '12px 20px',
    borderBottom: '1px solid #27272a',
    backgroundColor: '#111114'
  },
  modalTab: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#71717a',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  modalTabActive: {
    backgroundColor: '#27272a',
    color: '#fff'
  },
  modalLoading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px'
  },
  modalItemsContainer: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  modalEmpty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px'
  },
  modalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '12px',
    padding: '16px 20px',
    overflow: 'auto'
  },
  modalCard: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '10px',
    border: '1px solid #27272a',
    backgroundColor: '#1a1a1e',
    cursor: 'pointer',
    transition: 'all 0.15s',
    position: 'relative'
  },
  modalCardSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#1e1e2e'
  },
  modalCardThumb: {
    width: '100%',
    height: '120px',
    backgroundColor: '#27272a',
    borderRadius: '8px 8px 0 0',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  modalCardThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  modalCardContent: {
    padding: '8px 10px',
    flex: 1
  },
  modalCardName: {
    margin: 0,
    fontSize: '12px',
    fontWeight: '500',
    color: '#e4e4e7',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  modalCardType: {
    fontSize: '10px',
    color: '#71717a',
    marginTop: '4px',
    display: 'block'
  },
  modalCardCheckbox: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '18px',
    height: '18px',
    cursor: 'pointer'
  },
  duplicateBadge: {
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    backgroundColor: '#f59e0b',
    color: '#000',
    fontSize: '9px',
    fontWeight: '600',
    padding: '2px 4px',
    textAlign: 'center'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderTop: '1px solid #27272a',
    backgroundColor: '#111114'
  },
  modalFooterLeft: {
    display: 'flex',
    gap: '8px'
  },
  modalFooterRight: {
    display: 'flex',
    gap: '8px'
  },
  modalFooterBtn: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: '1px solid #3f3f46',
    backgroundColor: '#27272a',
    color: '#a1a1aa',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer'
  },

  // Calendar
  calendarView: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: '#0d0d11'
  },
  calendarHeader: {
    padding: '16px 24px',
    borderBottom: '1px solid #27272a',
    backgroundColor: '#18181b'
  },
  calendarNav: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  calendarNavBtn: {
    background: 'none',
    border: '1px solid #3f3f46',
    color: '#a1a1aa',
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px'
  },
  calendarTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
    minWidth: '160px',
    textAlign: 'center'
  },
  calendarTodayBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #6366f1',
    backgroundColor: 'transparent',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  calendarGrid: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '1px',
    padding: '12px',
    backgroundColor: '#27272a',
    overflow: 'auto'
  },
  calendarDayHeader: {
    padding: '12px 8px',
    backgroundColor: '#18181b',
    color: '#71717a',
    fontSize: '12px',
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase'
  },
  calendarCell: {
    backgroundColor: '#111114',
    padding: '8px',
    minHeight: '100px',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid #27272a'
  },
  calendarCellToday: {
    borderColor: '#6366f1',
    borderWidth: '2px'
  },
  calendarCellDate: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#a1a1aa',
    marginBottom: '4px'
  },
  calendarCellPosts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
    minWidth: 0
  },
  calendarPostChip: {
    padding: '3px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: '500',
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    draggable: true
  },
  calendarPostChipSelected: {
    boxShadow: '0 0 0 2px #6366f1'
  }
};

export default SchedulingPage;
