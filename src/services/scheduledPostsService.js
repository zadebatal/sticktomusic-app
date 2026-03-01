/**
 * Scheduled Posts Service — Firestore-backed scheduling queue (Wave 2)
 *
 * Persists scheduled posts to Firestore at:
 *   artists/{artistId}/scheduledPosts/{postId}
 *
 * Supports:
 * - Multi-platform scheduling (Instagram, TikTok, YouTube, Facebook)
 * - Multiple accounts per platform
 * - Drag-to-reorder queue positions
 * - Draft ↔ Scheduled ↔ Posted status tracking
 * - Full editor state for re-editing drafts
 */

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, writeBatch, onSnapshot
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import log from '../utils/logger';

// ── Constants ──

export const POST_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  POSTING: 'posting',
  POSTED: 'posted',
  FAILED: 'failed'
});

export const PLATFORMS = Object.freeze({
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  FACEBOOK: 'facebook'
});

export const PLATFORM_LABELS = Object.freeze({
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook'
});

export const PLATFORM_COLORS = Object.freeze({
  instagram: '#E1306C',
  tiktok: '#00f2ea',
  youtube: '#FF0000',
  facebook: '#1877F2'
});

// ── Helpers ──

function getCollectionRef(db, artistId) {
  return collection(db, 'artists', artistId, 'scheduledPosts');
}

function getDocRef(db, artistId, postId) {
  return doc(db, 'artists', artistId, 'scheduledPosts', postId);
}

function generateId() {
  return `spost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ── CRUD Operations ──

/**
 * Create a new scheduled post
 * @param {Object} db - Firestore instance
 * @param {string} artistId
 * @param {Object} data - Post data
 * @returns {Object} Created post
 */
export async function createScheduledPost(db, artistId, data) {
  const id = data.id || generateId();
  const now = new Date().toISOString();

  const post = {
    id,
    contentId: data.contentId || null,
    contentType: data.contentType || 'video', // 'video' | 'slideshow'
    contentName: data.contentName || 'Untitled',
    thumbnail: data.thumbnail || null,
    cloudUrl: data.cloudUrl || null,
    audioUrl: data.audioUrl || null, // Audio file URL for slideshows

    // Platform selections: { instagram: { accountId, handle }, ... }
    platforms: data.platforms || {},

    // Schedule
    scheduledTime: data.scheduledTime || null,
    caption: data.caption || '',
    hashtags: data.hashtags || [],
    platformHashtags: data.platformHashtags || {}, // Per-platform hashtag overrides: { tiktok: [...], instagram: [...] }

    // Status
    status: data.status || POST_STATUS.DRAFT,
    queuePosition: data.queuePosition ?? 0,
    locked: data.locked || false, // If true, reorder/shuffle will skip this post

    // Source context
    collectionId: data.collectionId || null, // Originating collection/niche ID
    collectionName: data.collectionName || null, // Originating collection name
    nicheId: data.nicheId || null, // Originating niche ID (for finished media uploads)
    mediaType: data.mediaType || null, // 'video' | 'image' for uploaded media

    // Editor state for re-editing
    editorState: data.editorState || null,

    // Posting result
    postResults: data.postResults || {},  // { platform: { postId, url, error } }

    // Timestamps
    createdAt: now,
    updatedAt: now
  };

  try {
    await setDoc(getDocRef(db, artistId, id), {
      ...post,
      serverUpdatedAt: serverTimestamp()
    });
    log('[ScheduledPosts] Created:', id);
    // Also update local
    saveLocalPost(artistId, post);
  } catch (error) {
    log.error('[ScheduledPosts] Firestore create failed:', error);
    // Save to localStorage as fallback (mark unsynced)
    saveLocalPost(artistId, { ...post, syncedToCloud: false });
  }

  return post;
}

/**
 * Update an existing scheduled post
 */
export async function updateScheduledPost(db, artistId, postId, updates) {
  const patch = {
    ...updates,
    updatedAt: new Date().toISOString()
  };

  try {
    await updateDoc(getDocRef(db, artistId, postId), {
      ...patch,
      serverUpdatedAt: serverTimestamp()
    });
    log('[ScheduledPosts] Updated:', postId);
    // Also update local
    updateLocalPost(artistId, postId, patch);
  } catch (error) {
    if (error?.message?.includes('No document to update')) {
      log('[ScheduledPosts] Post no longer exists in Firestore:', postId);
      removeLocalPost(artistId, postId);
      return patch;
    }
    log.error('[ScheduledPosts] Firestore update failed:', error);
    // Update localStorage as fallback (mark unsynced)
    updateLocalPost(artistId, postId, { ...patch, syncedToCloud: false });
  }

  return patch;
}

/**
 * Delete a scheduled post
 */
export async function deleteScheduledPost(db, artistId, postId) {
  try {
    await deleteDoc(getDocRef(db, artistId, postId));
    log('[ScheduledPosts] Deleted:', postId);
    removeLocalPost(artistId, postId);
    return true;
  } catch (error) {
    log.error('[ScheduledPosts] Delete failed:', error);
    removeLocalPost(artistId, postId);
    return false;
  }
}

/**
 * Delete all scheduled posts that reference a given content ID (cascade delete).
 * Called when a draft is deleted from createdContent.
 */
export async function deletePostsByContentId(db, artistId, contentId) {
  try {
    const allPosts = await getScheduledPosts(db, artistId);
    const matching = allPosts.filter(p => p.contentId === contentId);
    if (matching.length === 0) return 0;

    const batch = writeBatch(db);
    matching.forEach(p => batch.delete(getDocRef(db, artistId, p.id)));
    await batch.commit();
    matching.forEach(p => removeLocalPost(artistId, p.id));
    log('[ScheduledPosts] Cascade-deleted', matching.length, 'posts for contentId:', contentId);
    return matching.length;
  } catch (error) {
    log.error('[ScheduledPosts] Cascade delete failed:', error);
    return 0;
  }
}

/**
 * Get all scheduled posts for an artist, ordered by queue position
 */
export async function getScheduledPosts(db, artistId) {
  try {
    const q = query(
      getCollectionRef(db, artistId),
      orderBy('queuePosition', 'asc')
    );
    const snapshot = await getDocs(q);
    const posts = snapshot.docs.map(d => d.data());
    log('[ScheduledPosts] Loaded', posts.length, 'posts');
    return posts;
  } catch (error) {
    log.error('[ScheduledPosts] Load failed, using local:', error);
    return getLocalPosts(artistId);
  }
}

/**
 * Subscribe to real-time changes on scheduled posts
 */
export function subscribeToScheduledPosts(db, artistId, callback) {
  const q = query(
    getCollectionRef(db, artistId),
    orderBy('queuePosition', 'asc')
  );

  return onSnapshot(q, (snapshot) => {
    const posts = snapshot.docs.map(d => d.data());
    callback(posts);
  }, (error) => {
    log.error('[ScheduledPosts] Subscription error:', error);
    callback(getLocalPosts(artistId));
  });
}

/**
 * Batch reorder posts — update queue positions
 * @param {Object} db
 * @param {string} artistId
 * @param {Array<{id: string, queuePosition: number}>} newOrder
 */
export async function reorderPosts(db, artistId, newOrder) {
  try {
    const batch = writeBatch(db);
    newOrder.forEach(({ id, queuePosition }) => {
      batch.update(getDocRef(db, artistId, id), {
        queuePosition,
        updatedAt: new Date().toISOString(),
        serverUpdatedAt: serverTimestamp()
      });
    });
    await batch.commit();
    log('[ScheduledPosts] Reordered', newOrder.length, 'posts');
    // Also update local
    newOrder.forEach(({ id, queuePosition }) => {
      updateLocalPost(artistId, id, { queuePosition });
    });
    return true;
  } catch (error) {
    log.error('[ScheduledPosts] Firestore reorder failed:', error);
    // Update localStorage as fallback
    newOrder.forEach(({ id, queuePosition }) => {
      updateLocalPost(artistId, id, { queuePosition, syncedToCloud: false });
    });
    return false;
  }
}

/**
 * Add multiple posts to the queue (batch create)
 */
export async function addManyScheduledPosts(db, artistId, posts) {
  const results = [];
  const batch = writeBatch(db);
  const now = new Date().toISOString();

  // Get current max position
  const existing = await getScheduledPosts(db, artistId);
  let maxPosition = existing.reduce((max, p) => Math.max(max, p.queuePosition || 0), 0);

  for (const data of posts) {
    maxPosition++;
    const id = data.id || generateId();
    const post = {
      id,
      contentId: data.contentId || null,
      contentType: data.contentType || 'video',
      contentName: data.contentName || 'Untitled',
      thumbnail: data.thumbnail || null,
      cloudUrl: data.cloudUrl || null,
      platforms: data.platforms || {},
      scheduledTime: data.scheduledTime || null,
      caption: data.caption || '',
      hashtags: data.hashtags || [],
      platformHashtags: data.platformHashtags || {},
      status: data.status || POST_STATUS.DRAFT,
      queuePosition: maxPosition,
      locked: data.locked || false,
      collectionId: data.collectionId || null,
      collectionName: data.collectionName || null,
      editorState: data.editorState || null,
      postResults: {},
      createdAt: now,
      updatedAt: now
    };

    batch.set(getDocRef(db, artistId, id), {
      ...post,
      serverUpdatedAt: serverTimestamp()
    });
    results.push(post);
  }

  try {
    await batch.commit();
    log('[ScheduledPosts] Batch created', results.length, 'posts');
    // Also update local
    results.forEach(p => saveLocalPost(artistId, p));
  } catch (error) {
    log.error('[ScheduledPosts] Firestore batch create failed:', error);
    // Save to localStorage as fallback (mark unsynced)
    results.forEach(p => saveLocalPost(artistId, { ...p, syncedToCloud: false }));
  }

  return results;
}

/**
 * Update post status after publishing attempt
 */
export async function markPostPublished(db, artistId, postId, platformResults) {
  const allSucceeded = Object.values(platformResults).every(r => !r.error);
  const status = allSucceeded ? POST_STATUS.POSTED : POST_STATUS.FAILED;

  return updateScheduledPost(db, artistId, postId, {
    status,
    postResults: platformResults,
    postedAt: allSucceeded ? new Date().toISOString() : null
  });
}

// ── Bulk scheduling helpers ──

/**
 * Auto-assign scheduled times to posts in queue
 * @param {Array} posts - Posts to schedule
 * @param {Date} startTime - First post time
 * @param {number} intervalMinutes - Minutes between posts
 * @returns {Array} Posts with assigned scheduledTime
 */
export function assignScheduleTimes(posts, startTime, intervalMinutes) {
  const start = new Date(startTime);
  return posts.map((post, index) => ({
    ...post,
    scheduledTime: new Date(start.getTime() + index * intervalMinutes * 60 * 1000).toISOString()
  }));
}

/**
 * Auto-assign random schedule times
 */
export function assignRandomScheduleTimes(posts, startTime, minMinutes, maxMinutes) {
  let current = new Date(startTime);
  return posts.map(post => {
    const interval = minMinutes + Math.random() * (maxMinutes - minMinutes);
    current = new Date(current.getTime() + interval * 60 * 1000);
    return {
      ...post,
      scheduledTime: current.toISOString()
    };
  });
}

// ── localStorage Fallback ──

const STORAGE_KEY = (artistId) => `stm_scheduled_posts_${artistId}`;

function getLocalPosts(artistId) {
  try {
    const data = localStorage.getItem(STORAGE_KEY(artistId));
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveLocalPost(artistId, post) {
  try {
    const posts = getLocalPosts(artistId);
    const index = posts.findIndex(p => p.id === post.id);
    if (index >= 0) {
      posts[index] = post;
    } else {
      posts.push(post);
    }
    localStorage.setItem(STORAGE_KEY(artistId), JSON.stringify(posts));
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      log.warn('[ScheduledPosts] Quota exceeded, cleaning up...');
      const keysToClean = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('stm_session_') || key?.startsWith('stm_temp_')) {
          keysToClean.push(key);
        }
      }
      keysToClean.forEach(k => localStorage.removeItem(k));
      // Retry save
      try {
        localStorage.setItem(STORAGE_KEY(artistId), JSON.stringify(posts));
      } catch (retryError) {
        log.error('[ScheduledPosts] Save failed even after cleanup:', retryError);
      }
    } else {
      log.error('[ScheduledPosts] Local save failed:', error);
    }
  }
}

function updateLocalPost(artistId, postId, updates) {
  try {
    const posts = getLocalPosts(artistId);
    const index = posts.findIndex(p => p.id === postId);
    if (index >= 0) {
      posts[index] = { ...posts[index], ...updates };
      localStorage.setItem(STORAGE_KEY(artistId), JSON.stringify(posts));
    }
  } catch (error) {
    log.error('[ScheduledPosts] Local update failed:', error);
  }
}

function removeLocalPost(artistId, postId) {
  try {
    const posts = getLocalPosts(artistId).filter(p => p.id !== postId);
    localStorage.setItem(STORAGE_KEY(artistId), JSON.stringify(posts));
  } catch (error) {
    log.error('[ScheduledPosts] Local delete failed:', error);
  }
}

export default {
  POST_STATUS,
  PLATFORMS,
  PLATFORM_LABELS,
  PLATFORM_COLORS,
  createScheduledPost,
  updateScheduledPost,
  deleteScheduledPost,
  getScheduledPosts,
  subscribeToScheduledPosts,
  reorderPosts,
  addManyScheduledPosts,
  markPostPublished,
  assignScheduleTimes,
  assignRandomScheduleTimes
};
