/**
 * Post Status Polling Service
 *
 * Polls Late.co API to check if SCHEDULED posts have actually gone live.
 * Used as fallback when webhooks aren't available.
 *
 * Runs:
 * - On SchedulingPage mount
 * - Every 5 minutes while page is active
 * - Checks posts that are SCHEDULED but past their scheduledTime
 */

import { getAuth } from 'firebase/auth';
import log from '../utils/logger';
import { updateScheduledPost } from './scheduledPostsService';

/**
 * Check a single post's status with Late.co API
 * @param {string} latePostId - Late.co post ID
 * @param {string} artistId - Artist ID (required by API)
 * @returns {Object|null} { status: 'live'|'scheduled'|'failed', publishedAt, platforms }
 */
async function checkLatePostStatus(latePostId, artistId) {
  try {
    const token = await getAuth().currentUser?.getIdToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(
      `/api/late?action=getPost&postId=${latePostId}&artistId=${artistId}`,
      { headers },
    );
    if (!response.ok) {
      log.warn('[StatusPolling] Failed to fetch post from Late.co:', latePostId);
      return null;
    }

    const data = await response.json();
    if (!data.success || !data.post) return null;

    const post = data.post;

    // Late.co post statuses: 'scheduled', 'published', 'failed', 'processing'
    if (post.status === 'published' || post.status === 'live') {
      return {
        status: 'live',
        publishedAt: post.published_at || post.publishedAt || new Date().toISOString(),
        platforms: post.platforms || {},
      };
    }

    if (post.status === 'failed') {
      return {
        status: 'failed',
        platforms: post.platforms || {},
        error: post.error || 'Unknown error',
      };
    }

    return { status: 'scheduled' };
  } catch (error) {
    log.error('[StatusPolling] Error checking Late post:', latePostId, error);
    return null;
  }
}

/**
 * Poll overdue SCHEDULED posts and update status if they're live
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Array} posts - All scheduled posts
 * @param {Function} [onStatusChange] - Callback when a post status changes: ({ type: 'posted'|'failed', contentName, thumbnail, publishedAt, errorMessage })
 * @returns {number} Number of posts updated
 */
export async function pollOverduePosts(db, artistId, posts, onStatusChange) {
  const now = new Date();
  let updatedCount = 0;

  // Find SCHEDULED posts past their scheduled time (overdue by at least 5 min)
  const overduePosts = posts.filter((p) => {
    if (p.status !== 'scheduled') return false;
    if (!p.scheduledTime || !p.latePostId) return false;

    const scheduledTime = new Date(p.scheduledTime);
    const minutesOverdue = (now - scheduledTime) / (60 * 1000);

    // Only check posts that are 1+ minutes overdue (give Late.co time to process)
    return minutesOverdue >= 1;
  });

  if (overduePosts.length === 0) {
    log('[StatusPolling] No overdue posts to check');
    return 0;
  }

  log(`[StatusPolling] Checking ${overduePosts.length} overdue posts...`);

  // Check each post in parallel (max 5 concurrent)
  const chunks = [];
  for (let i = 0; i < overduePosts.length; i += 5) {
    chunks.push(overduePosts.slice(i, i + 5));
  }

  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map((post) => checkLatePostStatus(post.latePostId, artistId)),
    );
    const results = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));

    for (let i = 0; i < chunk.length; i++) {
      const post = chunk[i];
      const result = results[i];

      if (!result) continue;

      if (result.status === 'live') {
        // Update to POSTED
        await updateScheduledPost(db, artistId, post.id, {
          status: 'posted',
          postedAt: result.publishedAt,
          postResults: result.platforms || post.postResults || {},
        });
        log(`[StatusPolling] ✓ Updated ${post.contentName} to POSTED`);
        updatedCount++;
        if (onStatusChange) {
          onStatusChange({
            type: 'posted',
            contentName: post.contentName,
            thumbnail: post.thumbnail,
            publishedAt: result.publishedAt,
          });
        }
      } else if (result.status === 'failed') {
        // Update to FAILED
        await updateScheduledPost(db, artistId, post.id, {
          status: 'failed',
          errorMessage: result.error || 'Post failed on Late.co',
          postResults: result.platforms || {},
        });
        log(`[StatusPolling] ✗ Updated ${post.contentName} to FAILED`);
        updatedCount++;
        if (onStatusChange) {
          onStatusChange({
            type: 'failed',
            contentName: post.contentName,
            errorMessage: result.error || 'Post failed on Late.co',
          });
        }
      }
      // If still 'scheduled', leave as-is (Late.co hasn't posted yet)
    }
  }

  if (updatedCount > 0) {
    log(`[StatusPolling] Updated ${updatedCount} posts`);
  }

  return updatedCount;
}

/**
 * Start periodic polling (every 5 minutes)
 * @param {Object} db
 * @param {string} artistId
 * @param {Function} getPosts - Function that returns current posts array
 * @param {Function} [onStatusChange] - Callback when a post transitions to posted/failed
 * @returns {Function} Cleanup function to stop polling
 */
export function startPolling(db, artistId, getPosts, onStatusChange) {
  let intervalId = null;

  const poll = async () => {
    try {
      const posts = getPosts();
      await pollOverduePosts(db, artistId, posts, onStatusChange);
    } catch (error) {
      log.error('[StatusPolling] Poll error:', error);
    }
  };

  // Run immediately on start
  poll();

  // Then every 2 minutes
  intervalId = setInterval(poll, 2 * 60 * 1000);

  // Return cleanup function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
      log('[StatusPolling] Stopped');
    }
  };
}

export default {
  pollOverduePosts,
  startPolling,
  checkLatePostStatus,
};
