/**
 * Analytics Service - Late API Integration + localStorage
 *
 * Handles:
 * - Fetching analytics from Late.co API
 * - Storing analytics snapshots in localStorage
 * - Aggregating data by video, song, category, and account
 * - Time-series data for charts
 */

const STORAGE_KEY_PREFIX = 'stm_analytics_';
const LAST_SYNC_KEY_PREFIX = 'stm_analytics_last_sync_';
const LEGACY_STORAGE_KEY = 'stm_analytics';
const LEGACY_LAST_SYNC_KEY = 'stm_analytics_last_sync';
const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

const getStorageKey = (artistId) => `${STORAGE_KEY_PREFIX}${artistId}`;
const getLastSyncKey = (artistId) => `${LAST_SYNC_KEY_PREFIX}${artistId}`;

const EMPTY_ANALYTICS = { videos: {}, snapshots: [], lastUpdated: null };

/**
 * Migrate global analytics to per-artist key (one-time, idempotent)
 */
const migrateIfNeeded = (artistId) => {
  const perArtistKey = getStorageKey(artistId);
  if (localStorage.getItem(perArtistKey)) return; // already migrated

  const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacyData) {
    localStorage.setItem(perArtistKey, legacyData);
    const legacySync = localStorage.getItem(LEGACY_LAST_SYNC_KEY);
    if (legacySync) localStorage.setItem(getLastSyncKey(artistId), legacySync);
    // Don't remove legacy keys yet — other artists may still need migration
    console.log('[Analytics] Migrated global data to artist:', artistId);
  }
};

/**
 * Get stored analytics data from localStorage (per-artist)
 * @param {string} artistId
 */
export const getStoredAnalytics = (artistId) => {
  if (!artistId) return EMPTY_ANALYTICS;
  migrateIfNeeded(artistId);
  try {
    const data = localStorage.getItem(getStorageKey(artistId));
    return data ? JSON.parse(data) : EMPTY_ANALYTICS;
  } catch (error) {
    console.error('Error reading analytics from localStorage:', error);
    return EMPTY_ANALYTICS;
  }
};

/**
 * Save analytics data to localStorage (per-artist)
 * @param {string} artistId
 */
export const saveAnalytics = (artistId, data) => {
  if (!artistId) return;
  try {
    localStorage.setItem(getStorageKey(artistId), JSON.stringify({
      ...data,
      lastUpdated: new Date().toISOString()
    }));
    localStorage.setItem(getLastSyncKey(artistId), new Date().toISOString());
  } catch (error) {
    console.error('Error saving analytics to localStorage:', error);
  }
};

/**
 * Check if sync is needed (hourly, per-artist)
 * @param {string} artistId
 */
export const needsSync = (artistId) => {
  if (!artistId) return false;
  const lastSync = localStorage.getItem(getLastSyncKey(artistId));
  if (!lastSync) return true;

  const lastSyncTime = new Date(lastSync).getTime();
  const now = Date.now();
  return (now - lastSyncTime) >= SYNC_INTERVAL;
};

/**
 * Fetch analytics from Late API for a specific post
 * @param {string} latePostId - Late.co post ID
 * @param {string} accessToken - Late API access token
 */
export const fetchLateAnalytics = async (latePostId, accessToken) => {
  try {
    const response = await fetch(`https://api.late.co/v1/posts/${latePostId}/analytics`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Late API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching Late analytics:', error);
    return null;
  }
};

/**
 * Fetch all posts from Late API
 * @param {string} accessToken - Late API access token
 */
export const fetchLatePosts = async (accessToken) => {
  try {
    const response = await fetch('https://api.late.co/v1/posts', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Late API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching Late posts:', error);
    return [];
  }
};

/**
 * Sync analytics from Late API
 * @param {string} artistId - Artist ID for scoped storage
 * @param {Array} videos - Array of video objects from the app (with latePostId, audioId, categoryId)
 * @param {string} accessToken - Late API access token
 */
export const syncAnalytics = async (artistId, videos, accessToken) => {
  const stored = getStoredAnalytics(artistId);
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // Fetch analytics for each video that has a latePostId
  const videosWithLate = videos.filter(v => v.latePostId);

  for (const video of videosWithLate) {
    try {
      const analytics = await fetchLateAnalytics(video.latePostId, accessToken);

      if (analytics) {
        stored.videos[video.id] = {
          videoId: video.id,
          videoName: video.name,
          audioId: video.audioId,
          audioName: video.audioName,
          categoryId: video.categoryId,
          categoryName: video.categoryName,
          handle: video.handle,
          platform: video.platform,
          latePostId: video.latePostId,
          postedAt: video.postedAt,
          // Analytics metrics
          views: analytics.views || analytics.video_views || 0,
          likes: analytics.likes || 0,
          comments: analytics.comments || 0,
          shares: analytics.shares || 0,
          reach: analytics.reach || 0,
          impressions: analytics.impressions || 0,
          engagementRate: analytics.engagement_rate || 0,
          updatedAt: now
        };
      }
    } catch (error) {
      console.error(`Error syncing analytics for video ${video.id}:`, error);
    }
  }

  // Create a daily snapshot for time-series
  const existingSnapshotIndex = stored.snapshots.findIndex(s => s.date === today);
  const totalStats = calculateTotalStats(stored.videos);

  const snapshot = {
    date: today,
    ...totalStats,
    videoCount: Object.keys(stored.videos).length
  };

  if (existingSnapshotIndex >= 0) {
    stored.snapshots[existingSnapshotIndex] = snapshot;
  } else {
    stored.snapshots.push(snapshot);
    // Keep only last 90 days of snapshots
    if (stored.snapshots.length > 90) {
      stored.snapshots = stored.snapshots.slice(-90);
    }
  }

  saveAnalytics(artistId, stored);
  return stored;
};

/**
 * Calculate total stats from all videos
 */
export const calculateTotalStats = (videos) => {
  const videoList = Object.values(videos);
  return {
    totalViews: videoList.reduce((sum, v) => sum + (v.views || 0), 0),
    totalLikes: videoList.reduce((sum, v) => sum + (v.likes || 0), 0),
    totalComments: videoList.reduce((sum, v) => sum + (v.comments || 0), 0),
    totalShares: videoList.reduce((sum, v) => sum + (v.shares || 0), 0),
    avgEngagement: videoList.length > 0
      ? videoList.reduce((sum, v) => sum + (v.engagementRate || 0), 0) / videoList.length
      : 0
  };
};

/**
 * Get top performing videos
 * @param {string} artistId
 * @param {number} limit - Number of videos to return
 * @param {string} sortBy - Sort metric ('views', 'likes', 'engagement')
 */
export const getTopVideos = (artistId, limit = 10, sortBy = 'views') => {
  const stored = getStoredAnalytics(artistId);
  const videos = Object.values(stored.videos);

  return videos
    .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0))
    .slice(0, limit);
};

/**
 * Get song performance aggregation
 * Groups all videos by audioId and aggregates their stats
 * @param {string} artistId
 */
export const getSongPerformance = (artistId) => {
  const stored = getStoredAnalytics(artistId);
  const videos = Object.values(stored.videos);

  // Group by audioId
  const songMap = {};

  for (const video of videos) {
    if (!video.audioId) continue;

    if (!songMap[video.audioId]) {
      songMap[video.audioId] = {
        audioId: video.audioId,
        audioName: video.audioName || 'Unknown Song',
        videos: [],
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        avgEngagement: 0
      };
    }

    songMap[video.audioId].videos.push(video);
    songMap[video.audioId].totalViews += video.views || 0;
    songMap[video.audioId].totalLikes += video.likes || 0;
    songMap[video.audioId].totalComments += video.comments || 0;
    songMap[video.audioId].totalShares += video.shares || 0;
  }

  // Calculate averages and find top video for each song
  const songs = Object.values(songMap).map(song => {
    const videoCount = song.videos.length;
    return {
      ...song,
      videoCount,
      avgViewsPerVideo: videoCount > 0 ? Math.round(song.totalViews / videoCount) : 0,
      avgEngagement: videoCount > 0
        ? song.videos.reduce((sum, v) => sum + (v.engagementRate || 0), 0) / videoCount
        : 0,
      topVideo: song.videos.sort((a, b) => (b.views || 0) - (a.views || 0))[0] || null
    };
  });

  // Sort by total views
  return songs.sort((a, b) => b.totalViews - a.totalViews);
};

/**
 * Get category performance aggregation
 * @param {string} artistId
 */
export const getCategoryPerformance = (artistId) => {
  const stored = getStoredAnalytics(artistId);
  const videos = Object.values(stored.videos);

  // Group by categoryId
  const categoryMap = {};

  for (const video of videos) {
    if (!video.categoryId) continue;

    if (!categoryMap[video.categoryId]) {
      categoryMap[video.categoryId] = {
        categoryId: video.categoryId,
        categoryName: video.categoryName || 'Unknown Category',
        videos: [],
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        avgEngagement: 0
      };
    }

    categoryMap[video.categoryId].videos.push(video);
    categoryMap[video.categoryId].totalViews += video.views || 0;
    categoryMap[video.categoryId].totalLikes += video.likes || 0;
    categoryMap[video.categoryId].totalComments += video.comments || 0;
  }

  // Calculate averages
  const categories = Object.values(categoryMap).map(cat => ({
    ...cat,
    videoCount: cat.videos.length,
    avgEngagement: cat.videos.length > 0
      ? cat.videos.reduce((sum, v) => sum + (v.engagementRate || 0), 0) / cat.videos.length
      : 0
  }));

  return categories.sort((a, b) => b.totalViews - a.totalViews);
};

/**
 * Get account/handle performance aggregation
 * @param {string} artistId
 */
export const getAccountPerformance = (artistId) => {
  const stored = getStoredAnalytics(artistId);
  const videos = Object.values(stored.videos);

  // Group by handle
  const accountMap = {};

  for (const video of videos) {
    if (!video.handle) continue;

    const key = `${video.handle}_${video.platform}`;

    if (!accountMap[key]) {
      accountMap[key] = {
        handle: video.handle,
        platform: video.platform,
        videos: [],
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        avgEngagement: 0
      };
    }

    accountMap[key].videos.push(video);
    accountMap[key].totalViews += video.views || 0;
    accountMap[key].totalLikes += video.likes || 0;
    accountMap[key].totalComments += video.comments || 0;
  }

  // Calculate averages
  const accounts = Object.values(accountMap).map(acc => ({
    ...acc,
    videoCount: acc.videos.length,
    avgEngagement: acc.videos.length > 0
      ? acc.videos.reduce((sum, v) => sum + (v.engagementRate || 0), 0) / acc.videos.length
      : 0
  }));

  return accounts.sort((a, b) => b.totalViews - a.totalViews);
};

/**
 * Get time series data for charts
 * @param {string} artistId
 * @param {string} period - 'daily', 'weekly', 'monthly'
 * @param {number} days - Number of days to include
 */
export const getTimeSeriesData = (artistId, period = 'daily', days = 30) => {
  const stored = getStoredAnalytics(artistId);
  const snapshots = stored.snapshots || [];

  // Get snapshots from the last N days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  const recentSnapshots = snapshots
    .filter(s => s.date >= cutoffStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (period === 'weekly') {
    // Aggregate by week
    const weekMap = {};
    for (const snapshot of recentSnapshots) {
      const date = new Date(snapshot.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weekMap[weekKey]) {
        weekMap[weekKey] = { ...snapshot, date: weekKey, count: 1 };
      } else {
        weekMap[weekKey].totalViews += snapshot.totalViews || 0;
        weekMap[weekKey].totalLikes += snapshot.totalLikes || 0;
        weekMap[weekKey].count++;
      }
    }
    return Object.values(weekMap);
  }

  return recentSnapshots;
};

/**
 * Get analytics for a specific song
 * @param {string} artistId
 * @param {string} audioId - Audio/song ID
 */
export const getSongAnalytics = (artistId, audioId) => {
  const stored = getStoredAnalytics(artistId);
  const videos = Object.values(stored.videos).filter(v => v.audioId === audioId);

  if (videos.length === 0) return null;

  const songName = videos[0].audioName || 'Unknown Song';

  return {
    audioId,
    audioName: songName,
    videos,
    totalViews: videos.reduce((sum, v) => sum + (v.views || 0), 0),
    totalLikes: videos.reduce((sum, v) => sum + (v.likes || 0), 0),
    totalComments: videos.reduce((sum, v) => sum + (v.comments || 0), 0),
    totalShares: videos.reduce((sum, v) => sum + (v.shares || 0), 0),
    videoCount: videos.length,
    avgViewsPerVideo: Math.round(videos.reduce((sum, v) => sum + (v.views || 0), 0) / videos.length),
    avgEngagement: videos.reduce((sum, v) => sum + (v.engagementRate || 0), 0) / videos.length,
    // Group by category
    categoryBreakdown: getCategoryBreakdownForSong(videos),
    // Performance timeline (using video posted dates)
    timeline: videos
      .filter(v => v.postedAt)
      .sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt))
      .map(v => ({
        date: v.postedAt.split('T')[0],
        views: v.views,
        videoName: v.videoName
      }))
  };
};

/**
 * Get category breakdown for a song's videos
 */
const getCategoryBreakdownForSong = (videos) => {
  const catMap = {};
  for (const video of videos) {
    const catId = video.categoryId || 'uncategorized';
    if (!catMap[catId]) {
      catMap[catId] = {
        categoryId: catId,
        categoryName: video.categoryName || 'Uncategorized',
        videoCount: 0,
        totalViews: 0
      };
    }
    catMap[catId].videoCount++;
    catMap[catId].totalViews += video.views || 0;
  }
  return Object.values(catMap).sort((a, b) => b.totalViews - a.totalViews);
};

/**
 * Clear all analytics data for an artist
 * @param {string} artistId
 */
export const clearAnalytics = (artistId) => {
  if (!artistId) return;
  localStorage.removeItem(getStorageKey(artistId));
  localStorage.removeItem(getLastSyncKey(artistId));
};

/**
 * Add mock data for testing (remove in production)
 * @param {string} artistId
 */
export const addMockData = (artistId) => {
  const mockVideos = {
    'video_1': {
      videoId: 'video_1',
      videoName: 'Summer Vibes',
      audioId: 'audio_droptop',
      audioName: 'Pertinence - DROP TOP BEATER',
      categoryId: 'cat_fashion',
      categoryName: 'Fashion',
      handle: '@mainaccount',
      platform: 'tiktok',
      views: 125000,
      likes: 8500,
      comments: 420,
      shares: 890,
      engagementRate: 8.2,
      postedAt: '2026-01-15T14:00:00Z'
    },
    'video_2': {
      videoId: 'video_2',
      videoName: 'Runway Walk',
      audioId: 'audio_stay',
      audioName: 'STAY 4.2.2',
      categoryId: 'cat_runway',
      categoryName: 'Runway',
      handle: '@mainaccount',
      platform: 'tiktok',
      views: 98000,
      likes: 6200,
      comments: 310,
      shares: 520,
      engagementRate: 7.8,
      postedAt: '2026-01-20T16:00:00Z'
    },
    'video_3': {
      videoId: 'video_3',
      videoName: 'EDM Festival',
      audioId: 'audio_droptop',
      audioName: 'Pertinence - DROP TOP BEATER',
      categoryId: 'cat_edm',
      categoryName: 'EDM',
      handle: '@altaccount',
      platform: 'instagram',
      views: 87000,
      likes: 7100,
      comments: 280,
      shares: 610,
      engagementRate: 9.1,
      postedAt: '2026-01-25T18:00:00Z'
    },
    'video_4': {
      videoId: 'video_4',
      videoName: 'Night Drive',
      audioId: 'audio_droptop',
      audioName: 'Pertinence - DROP TOP BEATER',
      categoryId: 'cat_fashion',
      categoryName: 'Fashion',
      handle: '@mainaccount',
      platform: 'tiktok',
      views: 65000,
      likes: 4800,
      comments: 190,
      shares: 340,
      engagementRate: 8.5,
      postedAt: '2026-01-28T20:00:00Z'
    },
    'video_5': {
      videoId: 'video_5',
      videoName: 'Beach Day',
      audioId: 'audio_audit',
      audioName: 'AUDIT lastverse',
      categoryId: 'cat_lifestyle',
      categoryName: 'Lifestyle',
      handle: '@altaccount',
      platform: 'tiktok',
      views: 54000,
      likes: 3900,
      comments: 150,
      shares: 280,
      engagementRate: 7.4,
      postedAt: '2026-02-01T12:00:00Z'
    }
  };

  // Generate mock snapshots for the last 30 days
  const snapshots = [];
  const baseViews = 300000;
  const baseLikes = 25000;

  for (let i = 30; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    // Add some variation
    const variation = Math.sin(i / 5) * 0.2 + 1;
    const growth = 1 + (30 - i) * 0.02;

    snapshots.push({
      date: dateStr,
      totalViews: Math.round(baseViews * variation * growth),
      totalLikes: Math.round(baseLikes * variation * growth),
      totalComments: Math.round(1200 * variation * growth),
      totalShares: Math.round(2500 * variation * growth),
      avgEngagement: 7.5 + Math.sin(i / 3) * 1.5,
      videoCount: 5
    });
  }

  saveAnalytics(artistId, { videos: mockVideos, snapshots });
  return { videos: mockVideos, snapshots };
};

export default {
  getStoredAnalytics,
  saveAnalytics,
  needsSync,
  syncAnalytics,
  calculateTotalStats,
  getTopVideos,
  getSongPerformance,
  getCategoryPerformance,
  getAccountPerformance,
  getTimeSeriesData,
  getSongAnalytics,
  clearAnalytics,
  addMockData
};
