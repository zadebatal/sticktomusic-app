import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { VIDEO_STATUS } from '../../utils/status';
import {
  getBankNames,
  generatePostContent,
  isValidBankName
} from '../../utils/captionGenerator';

/**
 * PostingModule - Batch schedule posts from a category
 *
 * Features:
 * - Bank selection for caption/hashtag generation
 * - Editable captions and hashtags per video
 * - Account selection (TikTok/Instagram)
 * - Schedule date/time picker
 * - Batch scheduling to Late.co
 *
 * @see docs/DOMAIN_INVARIANTS.md
 */
const PostingModule = ({
  category,
  videos = [],
  accounts = [],
  lateAccountIds = {},
  onSchedulePost,
  onRenderVideo,
  onClose
}) => {
  // Bank selection — ensure it matches a valid CONTENT_BANKS key
  const [selectedBank, setSelectedBank] = useState(() => {
    const bankNames = getBankNames();
    // Try exact match with category name first
    if (category?.name && bankNames.includes(category.name)) return category.name;
    // Try case-insensitive match
    if (category?.name) {
      const lower = category.name.toLowerCase();
      const match = bankNames.find(b => b.toLowerCase() === lower);
      if (match) return match;
    }
    return bankNames[0];
  });

  // Posts data - each video gets its own editable content
  const [posts, setPosts] = useState([]);

  // Scheduling
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [intervalMinutes, setIntervalMinutes] = useState(60);

  // Account selection
  const [selectedHandle, setSelectedHandle] = useState('');
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });

  // UI state
  const [isScheduling, setIsScheduling] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState({ current: 0, total: 0, videoName: '' });
  const [error, setError] = useState(null);
  const [successCount, setSuccessCount] = useState(0);

  // Get unique handles from accounts
  const availableHandles = useMemo(() => {
    const handles = new Set();
    accounts.forEach(acc => handles.add(acc.handle));
    return Array.from(handles);
  }, [accounts]);

  // Check if a video is rendered (has cloud URL)
  const isVideoRendered = useCallback((video) => {
    return !!(video.export?.cloudUrl || video.postedUrl || video.cloudUrl);
  }, []);

  // Count videos that need rendering
  const videosNeedingRender = useMemo(() => {
    return videos.filter(v => !isVideoRendered(v));
  }, [videos, isVideoRendered]);

  // Initialize posts when videos or bank changes (include ALL videos, not just rendered)
  useEffect(() => {
    if (videos.length === 0) return;

    const newPosts = videos.map((video, index) => {
      const content = generatePostContent(selectedBank, {
        platform: platforms.instagram ? 'instagram' : 'tiktok'
      });

      return {
        id: video.id,
        videoId: video.id,
        video: video, // Keep reference to full video for rendering
        videoUrl: video.export?.cloudUrl || video.postedUrl || video.cloudUrl || null,
        needsRender: !isVideoRendered(video),
        thumbnail: video.thumbnail || video.export?.thumbnailUrl || video.slides?.[0]?.thumbnail || null,
        title: video.title || video.name || `Video ${index + 1}`,
        caption: content.caption || '',
        hashtags: content.hashtags || [],
        hashtagString: content.hashtagString || '',
        isEditing: false
      };
    });

    console.log('[PostingModule] Initialized', newPosts.length, 'posts with bank:', selectedBank,
      'sample caption:', newPosts[0]?.caption, 'sample hashtags:', newPosts[0]?.hashtagString);
    setPosts(newPosts);
  }, [videos, selectedBank, platforms.instagram, isVideoRendered]);

  // Initialize date to today
  useEffect(() => {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    setScheduleDate(dateStr);
  }, []);

  // Update caption for a specific post
  const handleCaptionChange = useCallback((postId, newCaption) => {
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, caption: newCaption } : p
    ));
  }, []);

  // Update hashtags for a specific post
  const handleHashtagsChange = useCallback((postId, newHashtagString) => {
    const hashtags = newHashtagString
      .split(/[\s,]+/)
      .filter(h => h.startsWith('#') || h.length > 0)
      .map(h => h.startsWith('#') ? h : `#${h}`);

    setPosts(prev => prev.map(p =>
      p.id === postId
        ? { ...p, hashtags, hashtagString: hashtags.join(' ') }
        : p
    ));
  }, []);

  // Toggle editing mode for a post
  const toggleEditing = useCallback((postId) => {
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, isEditing: !p.isEditing } : p
    ));
  }, []);

  // Randomize single post content
  const randomizePost = useCallback((postId) => {
    const content = generatePostContent(selectedBank, {
      platform: platforms.instagram ? 'instagram' : 'tiktok'
    });

    setPosts(prev => prev.map(p =>
      p.id === postId
        ? {
            ...p,
            caption: content.caption,
            hashtags: content.hashtags,
            hashtagString: content.hashtagString
          }
        : p
    ));
  }, [selectedBank, platforms.instagram]);

  // Randomize all posts
  const randomizeAll = useCallback(() => {
    setPosts(prev => prev.map(p => {
      const content = generatePostContent(selectedBank, {
        platform: platforms.instagram ? 'instagram' : 'tiktok'
      });
      return {
        ...p,
        caption: content.caption,
        hashtags: content.hashtags,
        hashtagString: content.hashtagString
      };
    }));
  }, [selectedBank, platforms.instagram]);

  // Remove a post from the batch
  const removePost = useCallback((postId) => {
    setPosts(prev => prev.filter(p => p.id !== postId));
  }, []);

  // Schedule all posts (rendering drafts first if needed)
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

    // First, render any videos that need rendering
    const postsNeedingRender = posts.filter(p => p.needsRender);
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
          videoName: post.title
        });

        try {
          // Render the video and get the cloudUrl
          const cloudUrl = await onRenderVideo(post.video);

          // Update the post with the new cloudUrl
          updatedPosts = updatedPosts.map(p =>
            p.id === post.id
              ? { ...p, videoUrl: cloudUrl, needsRender: false }
              : p
          );
        } catch (err) {
          console.error('Render error:', err);
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

      // Calculate scheduled time for this post
      const baseDate = new Date(`${scheduleDate}T${scheduleTime}`);
      const scheduledFor = new Date(baseDate.getTime() + (i * intervalMinutes * 60 * 1000));

      // Build full caption
      const fullCaption = `${post.caption}\n\n${post.hashtagString}`.trim();

      // Build platforms array
      const platformsArray = [];
      if (platforms.tiktok && accountMapping.tiktok) {
        platformsArray.push({
          platform: 'tiktok',
          accountId: accountMapping.tiktok
        });
      }
      if (platforms.instagram && accountMapping.instagram) {
        platformsArray.push({
          platform: 'instagram',
          accountId: accountMapping.instagram
        });
      }

      if (platformsArray.length === 0) {
        errors.push(`${post.title}: No platforms selected`);
        failed++;
        continue;
      }

      try {
        await onSchedulePost({
          platforms: platformsArray,
          caption: fullCaption,
          videoUrl: post.videoUrl,
          scheduledFor: scheduledFor.toISOString()
        });
        scheduled++;
        setSuccessCount(scheduled);
      } catch (err) {
        console.error('Schedule error:', err);
        errors.push(`${post.title}: ${err.message}`);
        failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    setIsScheduling(false);

    if (failed > 0) {
      setError(`${scheduled} scheduled, ${failed} failed: ${errors.slice(0, 3).join('; ')}`);
    } else {
      // Success - could close or show success message
      alert(`Successfully scheduled ${scheduled} posts!`);
      onClose?.();
    }
  }, [posts, selectedHandle, scheduleDate, scheduleTime, intervalMinutes, platforms, lateAccountIds, onSchedulePost, onClose]);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Schedule Posts</h2>
            <p style={styles.subtitle}>
              {category?.name} • {posts.length} video{posts.length !== 1 ? 's' : ''}
              {videosNeedingRender.length > 0 && (
                <span style={{ color: '#f59e0b' }}>
                  {' '}({videosNeedingRender.length} will be rendered)
                </span>
              )}
            </p>
          </div>
          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>

        {/* Rendering Progress */}
        {isRendering && (
          <div style={styles.renderingBar}>
            <div style={styles.renderingText}>
              🎬 Rendering {renderProgress.current}/{renderProgress.total}: {renderProgress.videoName}
            </div>
            <div style={styles.progressBarContainer}>
              <div
                style={{
                  ...styles.progressBar,
                  width: `${(renderProgress.current / renderProgress.total) * 100}%`
                }}
              />
            </div>
          </div>
        )}

        {/* Controls Bar */}
        <div style={styles.controlsBar}>
          {/* Bank Selector */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>Content Bank</label>
            <select
              value={selectedBank}
              onChange={(e) => setSelectedBank(e.target.value)}
              style={styles.select}
            >
              {getBankNames().map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          {/* Account Handle Selector */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>Account</label>
            <select
              value={selectedHandle}
              onChange={(e) => setSelectedHandle(e.target.value)}
              style={styles.select}
            >
              <option value="">Select account...</option>
              {availableHandles.map(handle => (
                <option key={handle} value={handle}>{handle}</option>
              ))}
            </select>
          </div>

          {/* Platform Toggles */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>Platforms</label>
            <div style={styles.platformToggles}>
              <label style={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={platforms.tiktok}
                  onChange={(e) => setPlatforms(p => ({ ...p, tiktok: e.target.checked }))}
                />
                TikTok
              </label>
              <label style={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={platforms.instagram}
                  onChange={(e) => setPlatforms(p => ({ ...p, instagram: e.target.checked }))}
                />
                Instagram
              </label>
            </div>
          </div>

          {/* Randomize All Button */}
          <button style={styles.randomizeAllBtn} onClick={randomizeAll}>
            🎲 Randomize All
          </button>
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
            <label style={styles.label}>Interval</label>
            <select
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              style={styles.select}
            >
              <option value={30}>30 min apart</option>
              <option value={60}>1 hour apart</option>
              <option value={120}>2 hours apart</option>
              <option value={180}>3 hours apart</option>
              <option value={360}>6 hours apart</option>
              <option value={720}>12 hours apart</option>
              <option value={1440}>24 hours apart</option>
            </select>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div style={styles.errorBar}>
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} style={styles.errorDismiss}>×</button>
          </div>
        )}

        {/* Posts List */}
        <div style={styles.postsList}>
          {posts.length === 0 ? (
            <div style={styles.emptyState}>
              <p>No videos ready for posting.</p>
              <p style={styles.emptyHint}>Export videos from the Content Library first.</p>
            </div>
          ) : (
            posts.map((post, index) => (
              <PostCard
                key={post.id}
                post={post}
                index={index}
                scheduleDate={scheduleDate}
                scheduleTime={scheduleTime}
                intervalMinutes={intervalMinutes}
                onCaptionChange={handleCaptionChange}
                onHashtagsChange={handleHashtagsChange}
                onToggleEdit={toggleEditing}
                onRandomize={randomizePost}
                onRemove={removePost}
              />
            ))
          )}
        </div>

        {/* Footer Actions */}
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            style={styles.scheduleBtn}
            onClick={handleScheduleAll}
            disabled={isScheduling || posts.length === 0 || !selectedHandle}
          >
            {isScheduling
              ? `Scheduling... (${successCount}/${posts.length})`
              : `Schedule ${posts.length} Post${posts.length !== 1 ? 's' : ''}`
            }
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * PostCard - Individual post item with editable fields
 * Click on caption/hashtags to edit directly
 */
const PostCard = ({
  post,
  index,
  scheduleDate,
  scheduleTime,
  intervalMinutes,
  onCaptionChange,
  onHashtagsChange,
  onToggleEdit,
  onRandomize,
  onRemove
}) => {
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [generatedThumb, setGeneratedThumb] = useState(null);
  const captionInputRef = React.useRef(null);
  const hashtagInputRef = React.useRef(null);

  // Generate thumbnail from video URL if none exists
  React.useEffect(() => {
    if (post.thumbnail || generatedThumb) return;
    const videoSrc = post.videoUrl || post.video?.export?.cloudUrl || post.video?.url || post.video?.localUrl;
    if (!videoSrc) return;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.src = videoSrc;
    video.onloadeddata = () => { video.currentTime = 0.5; };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 284; // 9:16 aspect
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setGeneratedThumb(canvas.toDataURL('image/jpeg', 0.7));
      } catch (e) { /* CORS or other issue — leave placeholder */ }
    };
    video.onerror = () => {};
  }, [post.thumbnail, post.videoUrl, post.video, generatedThumb]);

  const thumbSrc = post.thumbnail || generatedThumb;

  // Calculate this post's scheduled time
  const scheduledTime = useMemo(() => {
    if (!scheduleDate || !scheduleTime) return null;
    const baseDate = new Date(`${scheduleDate}T${scheduleTime}`);
    const scheduled = new Date(baseDate.getTime() + (index * intervalMinutes * 60 * 1000));
    return scheduled.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }, [scheduleDate, scheduleTime, index, intervalMinutes]);

  // Auto-focus input when editing starts
  React.useEffect(() => {
    if (post.isEditing && captionInputRef.current) {
      captionInputRef.current.focus();
    }
  }, [post.isEditing]);

  // Handle keyboard shortcuts in inputs
  const handleInputKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onToggleEdit(post.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onToggleEdit(post.id);
    }
  };

  // Handle remove with confirmation
  const handleRemove = () => {
    if (showRemoveConfirm) {
      onRemove(post.id);
      setShowRemoveConfirm(false);
    } else {
      setShowRemoveConfirm(true);
      // Auto-reset after 3 seconds
      setTimeout(() => setShowRemoveConfirm(false), 3000);
    }
  };

  return (
    <div style={styles.postCard}>
      {/* Thumbnail */}
      <div style={styles.postThumbnail}>
        {thumbSrc ? (
          <img src={thumbSrc} alt={post.title} style={styles.thumbnailImg} />
        ) : (
          <div style={styles.thumbnailPlaceholder}>📹</div>
        )}
        <span style={styles.postNumber}>#{index + 1}</span>
      </div>

      {/* Content */}
      <div style={styles.postContent}>
        <div style={styles.postHeader}>
          <span style={styles.postTitle}>{post.title}</span>
          <span style={styles.postTime}>{scheduledTime || 'No date set'}</span>
        </div>

        {/* Caption - Click to edit */}
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
                transition: 'border-color 0.2s'
              }}
              onClick={() => onToggleEdit(post.id)}
              onMouseEnter={(e) => e.target.style.borderBottomColor = '#52525b'}
              onMouseLeave={(e) => e.target.style.borderBottomColor = 'transparent'}
              title="Click to edit"
            >
              {post.caption || '(click to add caption)'}
            </p>
          )}
        </div>

        {/* Hashtags - Click to edit */}
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
                transition: 'border-color 0.2s'
              }}
              onClick={() => onToggleEdit(post.id)}
              onMouseEnter={(e) => e.target.style.borderBottomColor = '#52525b'}
              onMouseLeave={(e) => e.target.style.borderBottomColor = 'transparent'}
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
        >
          {post.isEditing ? '✓' : '✏️'}
        </button>
        <button
          style={styles.actionBtn}
          onClick={() => onRandomize(post.id)}
          title="Randomize"
        >
          🎲
        </button>
        <button
          style={{
            ...styles.actionBtnDanger,
            backgroundColor: showRemoveConfirm ? '#dc2626' : undefined,
            color: showRemoveConfirm ? '#fff' : undefined
          }}
          onClick={handleRemove}
          title={showRemoveConfirm ? 'Click again to confirm' : 'Remove'}
        >
          {showRemoveConfirm ? '?' : '✕'}
        </button>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px'
  },
  modal: {
    backgroundColor: '#18181b',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '900px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '20px 24px',
    borderBottom: '1px solid #27272a'
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '600',
    color: '#fff'
  },
  subtitle: {
    margin: '4px 0 0 0',
    fontSize: '14px',
    color: '#71717a'
  },
  renderingBar: {
    backgroundColor: '#1f1f23',
    padding: '12px 24px',
    borderBottom: '1px solid #27272a'
  },
  renderingText: {
    fontSize: '14px',
    color: '#f59e0b',
    marginBottom: '8px'
  },
  progressBarContainer: {
    height: '4px',
    backgroundColor: '#27272a',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#f59e0b',
    transition: 'width 0.3s ease'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#71717a',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px'
  },
  controlsBar: {
    display: 'flex',
    gap: '16px',
    padding: '16px 24px',
    borderBottom: '1px solid #27272a',
    flexWrap: 'wrap',
    alignItems: 'flex-end'
  },
  scheduleBar: {
    display: 'flex',
    gap: '16px',
    padding: '12px 24px',
    borderBottom: '1px solid #27272a',
    backgroundColor: '#0f0f11',
    flexWrap: 'wrap',
    alignItems: 'flex-end'
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  label: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  select: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#27272a',
    color: '#fff',
    fontSize: '14px',
    minWidth: '150px',
    cursor: 'pointer'
  },
  dateInput: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#27272a',
    color: '#fff',
    fontSize: '14px'
  },
  timeInput: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: '#27272a',
    color: '#fff',
    fontSize: '14px'
  },
  platformToggles: {
    display: 'flex',
    gap: '12px'
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    color: '#e4e4e7',
    cursor: 'pointer'
  },
  randomizeAllBtn: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#7c3aed',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    marginLeft: 'auto'
  },
  errorBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 24px',
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    fontSize: '14px'
  },
  errorDismiss: {
    background: 'none',
    border: 'none',
    color: '#fecaca',
    fontSize: '18px',
    cursor: 'pointer'
  },
  postsList: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px'
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px 24px',
    color: '#71717a'
  },
  emptyHint: {
    fontSize: '14px',
    marginTop: '8px',
    color: '#52525b'
  },
  postCard: {
    display: 'flex',
    gap: '16px',
    padding: '16px',
    backgroundColor: '#27272a',
    borderRadius: '12px',
    marginBottom: '12px'
  },
  postThumbnail: {
    position: 'relative',
    width: '80px',
    height: '120px',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: '#18181b',
    flexShrink: 0
  },
  thumbnailImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px'
  },
  postNumber: {
    position: 'absolute',
    top: '4px',
    left: '4px',
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: '#fff',
    fontSize: '11px',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  postContent: {
    flex: 1,
    minWidth: 0
  },
  postHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  postTitle: {
    fontWeight: '600',
    color: '#fff',
    fontSize: '14px'
  },
  postTime: {
    fontSize: '12px',
    color: '#a1a1aa'
  },
  fieldGroup: {
    marginBottom: '8px'
  },
  fieldLabel: {
    fontSize: '11px',
    color: '#71717a',
    marginBottom: '2px',
    display: 'block'
  },
  captionText: {
    margin: 0,
    fontSize: '14px',
    color: '#e4e4e7'
  },
  captionInput: {
    width: '100%',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #3f3f46',
    backgroundColor: '#18181b',
    color: '#fff',
    fontSize: '14px'
  },
  hashtagText: {
    margin: 0,
    fontSize: '13px',
    color: '#a78bfa',
    wordBreak: 'break-all'
  },
  hashtagInput: {
    width: '100%',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #3f3f46',
    backgroundColor: '#18181b',
    color: '#a78bfa',
    fontSize: '13px'
  },
  postActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  actionBtn: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#3f3f46',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer'
  },
  actionBtnDanger: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    fontSize: '14px',
    cursor: 'pointer'
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 24px',
    borderTop: '1px solid #27272a'
  },
  cancelBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: '1px solid #3f3f46',
    backgroundColor: 'transparent',
    color: '#a1a1aa',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  scheduleBtn: {
    padding: '10px 24px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#22c55e',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default PostingModule;
