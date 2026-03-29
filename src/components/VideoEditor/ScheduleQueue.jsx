import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  generateFromCollectionBanks,
  generatePostContent,
  getBankNames,
} from '../../utils/captionGenerator';
import { getCollectionsAsync } from '../../services/libraryService';
import CollectionBankEditor from './CollectionBankEditor';
import { useToast, useFocusTrap } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import log from '../../utils/logger';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { FeatherX, FeatherShuffle, FeatherDatabase } from '@subframe/core';

/**
 * ScheduleQueue - Unified scheduling module for videos and slideshows
 *
 * Replaces both PostingModule (for videos) and SlideshowPostingModal (for carousels).
 * Features:
 * - Drag & drop reordering
 * - Shuffle with Fisher-Yates algorithm
 * - Fixed and random interval scheduling
 * - Inline caption/hashtag editing with "Edited" badges
 * - Collection bank sidebar for batch updates
 * - Support for mixed video/slideshow queues
 *
 * @see docs/DOMAIN_INVARIANTS.md
 */
const ScheduleQueue = ({
  contentItems = [],
  contentType = 'videos',
  artistId = null,
  category = null,
  onSchedulePost,
  onRenderVideo,
  onClose,
  accounts = [],
  lateAccountIds = {},
  db = null,
}) => {
  const { success: toastSuccess } = useToast();
  const { theme } = useTheme();
  // BUG-030: Focus trap for modal accessibility
  const trapRef = useFocusTrap(true);

  const styles = useMemo(() => getStyles(theme), [theme]);

  // Posts state
  const [posts, setPosts] = useState([]);
  const [draggedPostId, setDraggedPostId] = useState(null);

  // Account & platforms
  const [selectedHandle, setSelectedHandle] = useState('');
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });

  // Scheduling
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [intervalType, setIntervalType] = useState('fixed');
  const [fixedInterval, setFixedInterval] = useState(60);
  const [randomMin, setRandomMin] = useState(30);
  const [randomMax, setRandomMax] = useState(120);

  // UI state
  const [isScheduling, setIsScheduling] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState({ current: 0, total: 0, videoName: '' });
  const [error, setError] = useState(null);
  const [successCount, setSuccessCount] = useState(0);

  // Bank editor sidebar
  const [showBankEditor, setShowBankEditor] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState(null);

  // Collections
  const [collections, setCollections] = useState([]);

  // Get unique handles from accounts
  const availableHandles = useMemo(() => {
    const handles = new Set();
    accounts.forEach((acc) => handles.add(acc.handle));
    return Array.from(handles);
  }, [accounts]);

  // Collections with posts in queue
  const collectionsInQueue = useMemo(() => {
    const collectionIds = new Set(posts.map((p) => p.collectionId).filter(Boolean));
    return collections.filter((c) => collectionIds.has(c.id));
  }, [posts, collections]);

  // Initialize date to today on mount
  useEffect(() => {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    setScheduleDate(dateStr);
  }, []);

  // Load collections on mount
  useEffect(() => {
    if (!artistId) return;

    const loadCollections = async () => {
      try {
        const result = await getCollectionsAsync(db, artistId);
        setCollections(result || []);
      } catch (err) {
        log.error('[ScheduleQueue] Failed to load collections:', err);
      }
    };

    loadCollections();
  }, [artistId, db]);

  // Initialize posts from contentItems
  useEffect(() => {
    if (contentItems.length === 0) return;

    const newPosts = contentItems.map((item, index) => {
      // Find collection info if available
      const collection = item.collectionId
        ? collections.find((c) => c.id === item.collectionId)
        : null;

      // Generate caption and hashtags
      let caption = '';
      let hashtags = [];
      let hashtagString = '';

      if (collection?.captionBank && collection?.hashtagBank) {
        const content = generateFromCollectionBanks(
          collection.captionBank,
          collection.hashtagBank,
          {
            platform: platforms.instagram ? 'instagram' : 'tiktok',
          },
        );
        caption = content.caption;
        hashtags = content.hashtags;
        hashtagString = content.hashtagString;
      } else if (category?.name) {
        const content = generatePostContent(category.name, {
          platform: platforms.instagram ? 'instagram' : 'tiktok',
        });
        caption = content.caption;
        hashtags = content.hashtags;
        hashtagString = content.hashtagString;
      } else {
        const content = generatePostContent(getBankNames()[0], {
          platform: platforms.instagram ? 'instagram' : 'tiktok',
        });
        caption = content.caption;
        hashtags = content.hashtags;
        hashtagString = content.hashtagString;
      }

      // Determine if video needs rendering
      const needsRender = !!(
        item.type === 'video' &&
        !item.export?.cloudUrl &&
        !item.postedUrl &&
        !item.cloudUrl
      );

      // Get thumbnail
      let thumbnail = item.thumbnail;
      if (!thumbnail && item.type === 'video') {
        thumbnail = item.export?.thumbnailUrl || item.slides?.[0]?.thumbnail;
      } else if (!thumbnail && item.type === 'slideshow') {
        thumbnail = item.slides?.[0]?.imageUrl || item.slides?.[0]?.imageA?.url;
      }

      return {
        id: item.id,
        type: item.type || (item.slides ? 'slideshow' : 'video'),
        collectionId: item.collectionId,
        collectionName: collection?.name || item.collectionName || 'Uncategorized',
        title: item.title || item.name || `Item ${index + 1}`,
        thumbnail,
        caption,
        hashtags,
        hashtagString,
        isEditing: false,
        isManuallyEdited: false,
        // Video-specific
        videoUrl: item.export?.cloudUrl || item.postedUrl || item.cloudUrl || null,
        needsRender,
        videoRef: item, // Keep reference to original item
        // Slideshow-specific
        slides: item.slides || [],
        exportedImages: item.exportedImages || null,
        order: index,
      };
    });

    log('[ScheduleQueue] Initialized', newPosts.length, 'posts');
    setPosts(newPosts);
  }, [contentItems, collections, category, platforms.instagram]);

  // Drag handlers
  const handleDragStart = useCallback((postId) => {
    setDraggedPostId(postId);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (targetPostId) => {
      if (!draggedPostId || draggedPostId === targetPostId) {
        setDraggedPostId(null);
        return;
      }

      setPosts((prev) => {
        const draggedIndex = prev.findIndex((p) => p.id === draggedPostId);
        const targetIndex = prev.findIndex((p) => p.id === targetPostId);

        if (draggedIndex === -1 || targetIndex === -1) return prev;

        const newPosts = [...prev];
        const [draggedPost] = newPosts.splice(draggedIndex, 1);
        newPosts.splice(targetIndex, 0, draggedPost);

        return newPosts.map((p, idx) => ({ ...p, order: idx }));
      });

      setDraggedPostId(null);
    },
    [draggedPostId],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedPostId(null);
  }, []);

  // Fisher-Yates shuffle
  const handleShuffle = useCallback(() => {
    setPosts((prev) => {
      const shuffled = [...prev];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.map((p, idx) => ({ ...p, order: idx }));
    });
  }, []);

  // Edit handlers
  const handleCaptionChange = useCallback((postId, newCaption) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, caption: newCaption, isManuallyEdited: true } : p,
      ),
    );
  }, []);

  const handleHashtagsChange = useCallback((postId, newHashtagString) => {
    const hashtags = newHashtagString
      .split(/[\s,]+/)
      .filter((h) => h.startsWith('#') || h.length > 0)
      .map((h) => (h.startsWith('#') ? h : `#${h}`));

    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, hashtags, hashtagString: hashtags.join(' '), isManuallyEdited: true }
          : p,
      ),
    );
  }, []);

  const toggleEditing = useCallback((postId) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, isEditing: !p.isEditing } : p)));
  }, []);

  const randomizePost = useCallback(
    (postId) => {
      // Don't randomize manually edited posts
      const post = posts.find((p) => p.id === postId);
      if (post?.isManuallyEdited) return;

      const content = generatePostContent(getBankNames()[0], {
        platform: platforms.instagram ? 'instagram' : 'tiktok',
      });

      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                caption: content.caption,
                hashtags: content.hashtags,
                hashtagString: content.hashtagString,
              }
            : p,
        ),
      );
    },
    [posts, platforms.instagram],
  );

  const removePost = useCallback((postId) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId).map((p, idx) => ({ ...p, order: idx })));
  }, []);

  // Schedule all posts
  const handleScheduleAll = useCallback(async () => {
    if (!selectedHandle) {
      setError('Please select an account handle');
      return;
    }

    if (!scheduleDate) {
      setError('Please select a schedule date');
      return;
    }

    if (posts.length === 0) {
      setError('No posts to schedule');
      return;
    }

    const accountMapping = lateAccountIds[selectedHandle];
    if (!accountMapping) {
      setError(`No Late.co account mapping found for ${selectedHandle}`);
      return;
    }

    // Render videos that need it
    const postsNeedingRender = posts.filter((p) => p.needsRender);
    let updatedPosts = [...posts];

    if (postsNeedingRender.length > 0) {
      if (!onRenderVideo) {
        setError('Cannot render videos - render function not available');
        return;
      }

      setIsRendering(true);
      setRenderProgress({ current: 0, total: postsNeedingRender.length, videoName: '' });

      for (let i = 0; i < postsNeedingRender.length; i++) {
        const post = postsNeedingRender[i];
        setRenderProgress({
          current: i + 1,
          total: postsNeedingRender.length,
          videoName: post.title,
        });

        try {
          const cloudUrl = await onRenderVideo(post.videoRef);
          updatedPosts = updatedPosts.map((p) =>
            p.id === post.id ? { ...p, videoUrl: cloudUrl, needsRender: false } : p,
          );
        } catch (err) {
          log.error('Render error:', err);
          setError(`Failed to render "${post.title}": ${err.message}`);
          setIsRendering(false);
          return;
        }
      }

      setIsRendering(false);
      setPosts(updatedPosts);
    }

    setIsScheduling(true);
    setError(null);
    setSuccessCount(0);

    let scheduled = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < updatedPosts.length; i++) {
      const post = updatedPosts[i];

      // Calculate scheduled time
      let scheduledFor;
      if (intervalType === 'fixed') {
        const baseDate = new Date(`${scheduleDate}T${scheduleTime}`);
        scheduledFor = new Date(baseDate.getTime() + i * fixedInterval * 60 * 1000);
      } else {
        // Random interval
        const baseDate = new Date(`${scheduleDate}T${scheduleTime}`);
        let totalMinutes = 0;
        for (let j = 0; j <= i; j++) {
          totalMinutes += Math.floor(Math.random() * (randomMax - randomMin + 1)) + randomMin;
        }
        scheduledFor = new Date(baseDate.getTime() + totalMinutes * 60 * 1000);
      }

      // Full caption
      const fullCaption = `${post.caption}\n\n${post.hashtagString}`.trim();

      // Platforms array
      const platformsArray = [];
      if (platforms.tiktok && accountMapping.tiktok) {
        platformsArray.push({
          platform: 'tiktok',
          accountId: accountMapping.tiktok,
        });
      }
      if (platforms.instagram && accountMapping.instagram) {
        platformsArray.push({
          platform: 'instagram',
          accountId: accountMapping.instagram,
        });
      }

      if (platformsArray.length === 0) {
        errors.push(`${post.title}: No platforms selected`);
        failed++;
        continue;
      }

      try {
        // Different payloads for video vs slideshow
        if (post.type === 'slideshow') {
          const images = post.exportedImages
            ? post.exportedImages.map((img) => ({ url: img.url || img }))
            : post.slides.map((s) => ({ url: s.imageUrl || s.imageA?.url }));

          await onSchedulePost({
            type: 'carousel',
            platforms: platformsArray,
            caption: fullCaption,
            images,
            scheduledFor: scheduledFor.toISOString(),
          });
        } else {
          // Video
          await onSchedulePost({
            platforms: platformsArray,
            caption: fullCaption,
            videoUrl: post.videoUrl,
            scheduledFor: scheduledFor.toISOString(),
          });
        }

        scheduled++;
        setSuccessCount(scheduled);
      } catch (err) {
        log.error('Schedule error:', err);
        errors.push(`${post.title}: ${err.message}`);
        failed++;
      }

      // Rate limiting delay
      await new Promise((r) => setTimeout(r, 200));
    }

    setIsScheduling(false);

    if (failed > 0) {
      setError(`${scheduled} scheduled, ${failed} failed: ${errors.slice(0, 3).join('; ')}`);
    } else {
      toastSuccess(`Successfully scheduled ${scheduled} posts!`);
      onClose?.();
    }
  }, [
    posts,
    selectedHandle,
    scheduleDate,
    scheduleTime,
    intervalType,
    fixedInterval,
    randomMin,
    randomMax,
    platforms,
    lateAccountIds,
    onSchedulePost,
    onClose,
    onRenderVideo,
  ]);

  return (
    <div style={styles.overlay}>
      <div ref={trapRef} style={styles.modal} role="dialog" aria-modal="true">
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Schedule Posts</h2>
            <p style={styles.subtitle}>
              {posts.length} item{posts.length !== 1 ? 's' : ''}
              {contentType === 'mixed' && ' (videos & slideshows)'}
            </p>
          </div>
          <IconButton size="medium" icon={<FeatherX />} onClick={onClose} aria-label="Close" />
        </div>

        {/* Rendering Progress */}
        {isRendering && (
          <div style={styles.renderingBar}>
            <div style={styles.renderingText}>
              🎬 Rendering {renderProgress.current}/{renderProgress.total}:{' '}
              {renderProgress.videoName}
            </div>
            <div style={styles.progressBarContainer}>
              <div
                style={{
                  ...styles.progressBar,
                  width: `${(renderProgress.current / renderProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Main Body */}
        <div style={styles.bodyContainer}>
          {/* Main Content */}
          <div style={styles.mainContent}>
            {/* Controls Bar */}
            <div style={styles.controlsBar}>
              <div style={styles.controlGroup}>
                <label style={styles.label}>Account</label>
                <select
                  value={selectedHandle}
                  onChange={(e) => setSelectedHandle(e.target.value)}
                  style={styles.select}
                >
                  <option value="">Select account...</option>
                  {availableHandles.map((handle) => (
                    <option key={handle} value={handle}>
                      {handle}
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.controlGroup}>
                <label style={styles.label}>Platforms</label>
                <div style={styles.platformToggles}>
                  <label style={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={platforms.tiktok}
                      onChange={(e) => setPlatforms((p) => ({ ...p, tiktok: e.target.checked }))}
                    />
                    TikTok
                  </label>
                  <label style={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={platforms.instagram}
                      onChange={(e) => setPlatforms((p) => ({ ...p, instagram: e.target.checked }))}
                    />
                    Instagram
                  </label>
                </div>
              </div>

              <Button
                variant="neutral-secondary"
                size="small"
                icon={<FeatherShuffle />}
                onClick={handleShuffle}
              >
                Shuffle
              </Button>

              <Button
                variant="neutral-secondary"
                size="small"
                icon={showBankEditor ? <FeatherX /> : <FeatherDatabase />}
                onClick={() => setShowBankEditor(!showBankEditor)}
              >
                Banks
              </Button>
            </div>

            {/* Schedule Settings */}
            <div style={styles.scheduleBar}>
              <div style={styles.controlGroup}>
                <label style={styles.label}>Start Date</label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  style={styles.dateInput}
                />
              </div>

              <div style={styles.controlGroup}>
                <label style={styles.label}>Start Time</label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  style={styles.timeInput}
                />
              </div>

              <div style={styles.controlGroup}>
                <label style={styles.label}>Interval Type</label>
                <select
                  value={intervalType}
                  onChange={(e) => setIntervalType(e.target.value)}
                  style={styles.select}
                >
                  <option value="fixed">Fixed Interval</option>
                  <option value="random">Random Interval</option>
                </select>
              </div>

              {intervalType === 'fixed' ? (
                <div style={styles.controlGroup}>
                  <label style={styles.label}>Interval</label>
                  <select
                    value={fixedInterval}
                    onChange={(e) => setFixedInterval(Number(e.target.value))}
                    style={styles.select}
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
                  <div style={styles.controlGroup}>
                    <label style={styles.label}>Min (min)</label>
                    <input
                      type="number"
                      min="1"
                      value={randomMin}
                      onChange={(e) => setRandomMin(Number(e.target.value))}
                      style={styles.numberInput}
                    />
                  </div>
                  <div style={styles.controlGroup}>
                    <label style={styles.label}>Max (min)</label>
                    <input
                      type="number"
                      min="1"
                      value={randomMax}
                      onChange={(e) => setRandomMax(Number(e.target.value))}
                      style={styles.numberInput}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Error Display */}
            {error && (
              <div style={styles.errorBar}>
                <span>⚠️ {error}</span>
                <IconButton
                  size="small"
                  icon={<FeatherX />}
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                />
              </div>
            )}

            {/* Posts List */}
            <div style={styles.postsList}>
              {posts.length === 0 ? (
                <div style={styles.emptyState}>
                  <p>No posts ready for scheduling.</p>
                  <p style={styles.emptyHint}>Add videos or slideshows to get started.</p>
                </div>
              ) : (
                posts.map((post, index) => (
                  <ScheduleQueueCard
                    key={post.id}
                    post={post}
                    index={index}
                    theme={theme}
                    scheduleDate={scheduleDate}
                    scheduleTime={scheduleTime}
                    intervalType={intervalType}
                    fixedInterval={fixedInterval}
                    randomMin={randomMin}
                    randomMax={randomMax}
                    isDragging={draggedPostId === post.id}
                    onDragStart={() => handleDragStart(post.id)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(post.id)}
                    onDragEnd={handleDragEnd}
                    onCaptionChange={handleCaptionChange}
                    onHashtagsChange={handleHashtagsChange}
                    onToggleEdit={toggleEditing}
                    onRandomize={randomizePost}
                    onRemove={removePost}
                  />
                ))
              )}
            </div>
          </div>

          {/* Bank Sidebar */}
          {showBankEditor && (
            <div style={styles.sidebar}>
              <div style={styles.sidebarHeader}>
                <h3 style={styles.sidebarTitle}>Collection Banks</h3>
                <IconButton
                  size="small"
                  icon={<FeatherX />}
                  onClick={() => setShowBankEditor(false)}
                  aria-label="Close bank editor"
                />
              </div>

              <div style={styles.sidebarContent}>
                {collectionsInQueue.length === 0 ? (
                  <p style={styles.sidebarEmpty}>No collections in queue</p>
                ) : (
                  collectionsInQueue.map((collection) => (
                    <button
                      key={collection.id}
                      style={{
                        ...styles.collectionBtn,
                        backgroundColor:
                          editingCollectionId === collection.id
                            ? theme.accent.primary
                            : theme.bg.elevated,
                      }}
                      onClick={() =>
                        setEditingCollectionId(
                          editingCollectionId === collection.id ? null : collection.id,
                        )
                      }
                    >
                      {collection.name}
                    </button>
                  ))
                )}
              </div>

              {editingCollectionId && (
                <div style={styles.sidebarEditor}>
                  <CollectionBankEditor
                    collectionId={editingCollectionId}
                    db={db}
                    artistId={artistId}
                    compact={true}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <Button variant="neutral-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            onClick={handleScheduleAll}
            disabled={isScheduling || posts.length === 0 || !selectedHandle}
            loading={isScheduling}
          >
            {isScheduling
              ? `Scheduling... (${successCount}/${posts.length})`
              : `Schedule ${posts.length} Post${posts.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * ScheduleQueueCard - Individual post card with drag support
 */
const ScheduleQueueCard = ({
  post,
  index,
  theme,
  scheduleDate,
  scheduleTime,
  intervalType,
  fixedInterval,
  randomMin,
  randomMax,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onCaptionChange,
  onHashtagsChange,
  onToggleEdit,
  onRandomize,
  onRemove,
}) => {
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [generatedThumb, setGeneratedThumb] = useState(null);
  const captionInputRef = React.useRef(null);
  const hashtagInputRef = React.useRef(null);

  const styles = useMemo(() => getStyles(theme), [theme]);

  // Generate thumbnail for videos
  React.useEffect(() => {
    if (post.thumbnail || generatedThumb || post.type !== 'video') return;

    const videoSrc = post.videoUrl || post.videoRef?.export?.cloudUrl;
    if (!videoSrc) return;

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.src = videoSrc;
    video.onloadeddata = () => {
      video.currentTime = 0.5;
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 284;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setGeneratedThumb(canvas.toDataURL('image/jpeg', 0.7));
      } catch (e) {
        /* CORS or other issue */
      }
    };
    video.onerror = () => {};
  }, [post.thumbnail, post.videoUrl, post.videoRef, generatedThumb, post.type]);

  const thumbSrc = post.thumbnail || generatedThumb;

  // Calculate scheduled time
  const scheduledTime = useMemo(() => {
    if (!scheduleDate || !scheduleTime) return null;

    let scheduledFor;
    if (intervalType === 'fixed') {
      const baseDate = new Date(`${scheduleDate}T${scheduleTime}`);
      scheduledFor = new Date(baseDate.getTime() + index * fixedInterval * 60 * 1000);
    } else {
      const baseDate = new Date(`${scheduleDate}T${scheduleTime}`);
      let totalMinutes = 0;
      for (let j = 0; j <= index; j++) {
        totalMinutes += Math.floor(Math.random() * (randomMax - randomMin + 1)) + randomMin;
      }
      scheduledFor = new Date(baseDate.getTime() + totalMinutes * 60 * 1000);
    }

    return scheduledFor.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [scheduleDate, scheduleTime, index, intervalType, fixedInterval, randomMin, randomMax]);

  React.useEffect(() => {
    if (post.isEditing && captionInputRef.current) {
      captionInputRef.current.focus();
    }
  }, [post.isEditing]);

  const handleInputKeyDown = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      onToggleEdit(post.id);
    }
  };

  const handleRemove = () => {
    if (showRemoveConfirm) {
      onRemove(post.id);
      setShowRemoveConfirm(false);
    } else {
      setShowRemoveConfirm(true);
      setTimeout(() => setShowRemoveConfirm(false), 3000);
    }
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        ...styles.postCard,
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      {/* Thumbnail */}
      <div style={styles.postThumbnail}>
        {thumbSrc ? (
          <img src={thumbSrc} alt={post.title} style={styles.thumbnailImg} />
        ) : (
          <div style={styles.thumbnailPlaceholder}>{post.type === 'slideshow' ? '🎞️' : '📹'}</div>
        )}
        <span style={styles.postNumber}>#{index + 1}</span>
      </div>

      {/* Content */}
      <div style={styles.postContent}>
        <div style={styles.postHeader}>
          <div>
            <span style={styles.postTitle}>{post.title}</span>
            {post.needsRender && <span style={styles.badge}>Needs Render</span>}
            {post.isManuallyEdited && <span style={styles.badgeEdited}>Edited</span>}
          </div>
          <span style={styles.postTime}>{scheduledTime || 'No date set'}</span>
        </div>

        {/* Caption */}
        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Caption</label>
          {post.isEditing ? (
            <input
              ref={captionInputRef}
              type="text"
              value={post.caption}
              onChange={(e) => onCaptionChange(post.id, e.target.value)}
              onKeyDown={handleInputKeyDown}
              style={styles.captionInput}
              placeholder="Enter caption..."
            />
          ) : (
            <p
              style={{
                ...styles.captionText,
                cursor: 'pointer',
                borderBottom: '1px dashed transparent',
                transition: 'border-color 0.2s',
              }}
              onClick={() => onToggleEdit(post.id)}
              onMouseEnter={(e) => (e.target.style.borderBottomColor = theme.text.muted)}
              onMouseLeave={(e) => (e.target.style.borderBottomColor = 'transparent')}
              title="Click to edit"
            >
              {post.caption || '(click to add caption)'}
            </p>
          )}
        </div>

        {/* Hashtags */}
        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Hashtags</label>
          {post.isEditing ? (
            <input
              ref={hashtagInputRef}
              type="text"
              value={post.hashtagString}
              onChange={(e) => onHashtagsChange(post.id, e.target.value)}
              onKeyDown={handleInputKeyDown}
              style={styles.hashtagInput}
              placeholder="#hashtag1 #hashtag2..."
            />
          ) : (
            <p
              style={{
                ...styles.hashtagText,
                cursor: 'pointer',
                borderBottom: '1px dashed transparent',
                transition: 'border-color 0.2s',
              }}
              onClick={() => onToggleEdit(post.id)}
              onMouseEnter={(e) => (e.target.style.borderBottomColor = theme.text.muted)}
              onMouseLeave={(e) => (e.target.style.borderBottomColor = 'transparent')}
              title="Click to edit"
            >
              {post.hashtagString || '(click to add hashtags)'}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={styles.postActions}>
        <button
          style={styles.actionBtn}
          onClick={() => onToggleEdit(post.id)}
          title={post.isEditing ? 'Done editing (Enter)' : 'Edit'}
          aria-label={post.isEditing ? 'Done editing' : 'Edit'}
        >
          {post.isEditing ? '✓' : '✏️'}
        </button>
        <button
          style={{
            ...styles.actionBtn,
            opacity: post.isManuallyEdited ? 0.5 : 1,
          }}
          onClick={() => onRandomize(post.id)}
          disabled={post.isManuallyEdited}
          title={post.isManuallyEdited ? 'Cannot randomize edited posts' : 'Randomize'}
          aria-label={post.isManuallyEdited ? 'Cannot randomize edited posts' : 'Randomize'}
        >
          🎲
        </button>
        <button
          style={{
            ...styles.actionBtnDanger,
            backgroundColor: showRemoveConfirm ? '#dc2626' : undefined,
            color: showRemoveConfirm ? '#fff' : undefined,
          }}
          onClick={handleRemove}
          title={showRemoveConfirm ? 'Click again to confirm' : 'Remove'}
          aria-label={showRemoveConfirm ? 'Click again to confirm' : 'Remove'}
        >
          {showRemoveConfirm ? '?' : '✕'}
        </button>
      </div>
    </div>
  );
};

// Themed styles factory
const getStyles = (theme) => ({
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px',
  },
  modal: {
    backgroundColor: theme.bg.surface,
    borderRadius: '16px',
    width: '100%',
    maxWidth: '1200px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '20px 24px',
    borderBottom: `1px solid ${theme.bg.elevated}`,
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '600',
    color: theme.text.primary,
  },
  subtitle: {
    margin: '4px 0 0 0',
    fontSize: '14px',
    color: theme.text.muted,
  },
  renderingBar: {
    backgroundColor: theme.bg.surface,
    padding: '12px 24px',
    borderBottom: `1px solid ${theme.bg.elevated}`,
  },
  renderingText: {
    fontSize: '14px',
    color: '#f59e0b',
    marginBottom: '8px',
  },
  progressBarContainer: {
    height: '4px',
    backgroundColor: theme.bg.elevated,
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#f59e0b',
    transition: 'width 0.3s ease',
  },
  bodyContainer: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  controlsBar: {
    display: 'flex',
    gap: '16px',
    padding: '16px 24px',
    borderBottom: `1px solid ${theme.bg.elevated}`,
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  scheduleBar: {
    display: 'flex',
    gap: '16px',
    padding: '12px 24px',
    borderBottom: `1px solid ${theme.bg.elevated}`,
    backgroundColor: theme.bg.page,
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '12px',
    fontWeight: '500',
    color: theme.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  select: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.elevated,
    color: theme.text.primary,
    fontSize: '14px',
    minWidth: '150px',
    cursor: 'pointer',
  },
  dateInput: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.elevated,
    color: theme.text.primary,
    fontSize: '14px',
  },
  timeInput: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.elevated,
    color: theme.text.primary,
    fontSize: '14px',
  },
  numberInput: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.elevated,
    color: theme.text.primary,
    fontSize: '14px',
    width: '100px',
  },
  platformToggles: {
    display: 'flex',
    gap: '12px',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    color: theme.text.primary,
    cursor: 'pointer',
  },
  errorBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 24px',
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    fontSize: '14px',
  },
  postsList: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px 24px',
    color: theme.text.muted,
  },
  emptyHint: {
    fontSize: '14px',
    marginTop: '8px',
    color: theme.text.muted,
  },
  postCard: {
    display: 'flex',
    gap: '16px',
    padding: '16px',
    backgroundColor: theme.bg.elevated,
    borderRadius: '12px',
    marginBottom: '12px',
    transition: 'opacity 0.2s',
  },
  postThumbnail: {
    position: 'relative',
    width: '80px',
    height: '120px',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: theme.bg.surface,
    flexShrink: 0,
  },
  thumbnailImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
  },
  postNumber: {
    position: 'absolute',
    top: '4px',
    left: '4px',
    backgroundColor: theme.overlay.heavy,
    color: theme.text.primary,
    fontSize: '11px',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  postContent: {
    flex: 1,
    minWidth: 0,
  },
  postHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
    gap: '12px',
  },
  postTitle: {
    fontWeight: '600',
    color: theme.text.primary,
    fontSize: '14px',
  },
  badge: {
    display: 'inline-block',
    marginLeft: '8px',
    backgroundColor: '#f59e0b',
    color: theme.bg.surface,
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '4px',
    fontWeight: '600',
  },
  badgeEdited: {
    display: 'inline-block',
    marginLeft: '4px',
    backgroundColor: '#a78bfa',
    color: theme.bg.surface,
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '4px',
    fontWeight: '600',
  },
  postTime: {
    fontSize: '12px',
    color: theme.text.secondary,
    whiteSpace: 'nowrap',
  },
  fieldGroup: {
    marginBottom: '8px',
  },
  fieldLabel: {
    fontSize: '11px',
    color: theme.text.muted,
    marginBottom: '2px',
    display: 'block',
  },
  captionText: {
    margin: 0,
    fontSize: '14px',
    color: theme.text.primary,
  },
  captionInput: {
    width: '100%',
    padding: '6px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
    color: theme.text.primary,
    fontSize: '14px',
  },
  hashtagText: {
    margin: 0,
    fontSize: '13px',
    color: '#a78bfa',
    wordBreak: 'break-all',
  },
  hashtagInput: {
    width: '100%',
    padding: '6px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: theme.bg.surface,
    color: '#a78bfa',
    fontSize: '13px',
  },
  postActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  actionBtn: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: theme.bg.elevated,
    color: theme.text.primary,
    fontSize: '14px',
    cursor: 'pointer',
  },
  actionBtnDanger: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    fontSize: '14px',
    cursor: 'pointer',
  },
  sidebar: {
    width: '300px',
    borderLeft: `1px solid ${theme.bg.elevated}`,
    backgroundColor: theme.bg.surface,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sidebarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: `1px solid ${theme.bg.elevated}`,
  },
  sidebarTitle: {
    margin: 0,
    fontSize: '14px',
    fontWeight: '600',
    color: theme.text.primary,
  },
  sidebarContent: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sidebarEmpty: {
    fontSize: '13px',
    color: theme.text.muted,
    textAlign: 'center',
    padding: '24px 16px',
  },
  collectionBtn: {
    padding: '10px 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: theme.bg.elevated,
    color: theme.text.primary,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    textAlign: 'left',
  },
  sidebarEditor: {
    borderTop: `1px solid ${theme.bg.elevated}`,
    maxHeight: '50%',
    overflowY: 'auto',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 24px',
    borderTop: `1px solid ${theme.bg.elevated}`,
  },
});

export default ScheduleQueue;
