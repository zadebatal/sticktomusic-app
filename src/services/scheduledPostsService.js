/**
 * Scheduled Posts Service — Firestore-backed scheduling queue (Wave 2)
 *
 * Persists scheduled posts to Firestore at:
 *   artists/{artistId}/scheduledPosts/{postId}
 *
 * Supports:
 * - Multi-platform scheduling (Instagram, TikTok, YouTube, Facebook, Twitter/X)
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
  FACEBOOK: 'facebook',
  TWITTER: 'twitter'
});

export const PLATFORM_LABELS = Object.freeze({
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  twitter: 'X (Twitter)'
});

export const PLATFORM_COLORS = Object.freeze({
  instagram: '#E1306C',
  tiktok: '#00f2ea',
  youtube: '#FF0000',
  facebook: '#1877F2',
  twitter: '#1DA1F2'
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

    // Platform selections: { instagram: { accountId, handle }, ... }
    platforms: data.platforms || {},

    // Schedule
    scheduledTime: data.scheduledTime || null,
    caption: data.caption || '',
    hashtags: data.hashtags || [],

    // Status
    status: data.status || POST_STATUS.DRAFT,
    queuePosition: data.queuePosition ?? 0,

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
  } catch (error) {
    console.error('[ScheduledPosts] Create failed:', error);
    // Save to localStorage as fallback
    saveLocalPost(artistId, post);
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
  } catch (error) {
    console.error('[ScheduledPosts] Update failed:', error);
    updateLocalPost(artistId, postId, patch);
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
    console.error('[ScheduledPosts] Delete failed:', error);
    removeLocalPost(artistId, postId);
    return false;
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
    console.error('[ScheduledPosts] Load failed, using local:', error);
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
    console.error('[ScheduledPosts] Subscription error:', error);
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
    return true;
  } catch (error) {
    console.error('[ScheduledPosts] Reorder failed:', error);
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
      status: data.status || POST_STATUS.DRAFT,
      queuePosition: maxPosition,
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
  } catch (error) {
    console.error('[ScheduledPosts] Batch create failed:', error);
    results.forEach(p => saveLocalPost(artistId, p));
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
    scheduledTime: new Date(start.getTime() + index * intervalMinutes * 60 * 1000).toISOString(),
    status: POST_STATUS.SCHEDULED
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
      scheduledTime: current.toISOString(),
      status: POST_STATUS.SCHEDULED
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
    console.error('[ScheduledPosts] Local save failed:', error);
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
    console.error('[ScheduledPosts] Local update failed:', error);
  }
}

function removeLocalPost(artistId, postId) {
  try {
    const posts = getLocalPosts(artistId).filter(p => p.id !== postId);
    localStorage.setItem(STORAGE_KEY(artistId), JSON.stringify(posts));
  } catch (error) {
    console.error('[ScheduledPosts] Local delete failed:', error);
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
