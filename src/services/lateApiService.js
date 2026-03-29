import { getFirebaseToken } from '../config/firebase';
import log from '../utils/logger';

const LATE_API_PROXY = '/api/late';

const lateApi = {
  async fetchAccounts(artistId = null) {
    try {
      const token = await getFirebaseToken();
      const url = artistId
        ? `${LATE_API_PROXY}?action=accounts&artistId=${artistId}`
        : `${LATE_API_PROXY}?action=accounts`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      const data = await response.json();
      const accounts = data.accounts || data.data || (Array.isArray(data) ? data : []);
      return { success: true, accounts };
    } catch (error) {
      log.warn('[Late] fetchAccounts:', error.message);
      return { success: false, error: error.message };
    }
  },

  async schedulePost({
    platforms,
    caption,
    videoUrl,
    scheduledFor,
    artistId = null,
    type = 'video',
    images = null,
    audioUrl = null,
  }) {
    try {
      const token = await getFirebaseToken();
      if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
        throw new Error('No platforms selected for posting. Please select TikTok or Instagram.');
      }
      if (type !== 'carousel' && !videoUrl) {
        throw new Error(
          'No video URL provided. The video must be rendered/exported before posting.',
        );
      }
      if (type === 'carousel' && (!images || images.length === 0)) {
        throw new Error('No carousel images provided');
      }
      if (!scheduledFor) {
        throw new Error('No schedule time provided');
      }

      const mediaItems =
        type === 'carousel'
          ? images.map((img) => ({ type: 'image', url: img.url }))
          : [{ type: 'video', url: videoUrl }];

      const hasTikTok = platforms.some((p) => p.platform === 'tiktok');
      const isCarousel = type === 'carousel';
      const payload = {
        content: caption || '',
        mediaItems,
        platforms: platforms.map((p) => ({
          platform: p.platform,
          accountId: p.accountId,
        })),
        scheduledFor,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
      };

      if (hasTikTok) {
        payload.tiktokSettings = {
          privacyLevel: 'PUBLIC_TO_EVERYONE',
          allowComment: true,
          contentPreviewConfirmed: true,
          expressConsentGiven: true,
          ...(isCarousel
            ? {
                draft: true,
                mediaType: 'photo',
                photoCoverIndex: 0,
                autoAddMusic: true,
              }
            : { allowDuet: true, allowStitch: true }),
        };
      }

      log('Sending to Late:', JSON.stringify(payload, null, 2));

      const url = artistId
        ? `${LATE_API_PROXY}?action=posts&artistId=${artistId}`
        : `${LATE_API_PROXY}?action=posts`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Failed: ${response.status}`);
      }
      return { success: true, post: await response.json() };
    } catch (error) {
      log.warn('[Late] schedulePost:', error.message);
      return { success: false, error: error.message };
    }
  },

  async fetchScheduledPosts(page = 1, artistId = null) {
    try {
      const token = await getFirebaseToken();
      let allPosts = [];
      let currentPage = page;
      let hasMore = true;

      while (hasMore) {
        const url = artistId
          ? `${LATE_API_PROXY}?action=posts&page=${currentPage}&artistId=${artistId}`
          : `${LATE_API_PROXY}?action=posts&page=${currentPage}`;
        log('Fetching Late posts from:', url);
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        log('Late API response status:', response.status);
        if (!response.ok) throw new Error(`Failed: ${response.status}`);
        const data = await response.json();
        log('Late API raw response:', JSON.stringify(data, null, 2));
        const posts = data.posts || data.data || data || [];
        log('Extracted posts count:', posts.length);

        if (Array.isArray(posts) && posts.length > 0) {
          allPosts = [...allPosts, ...posts];
          currentPage++;
          if (posts.length < 50) hasMore = false;
        } else {
          hasMore = false;
        }

        if (currentPage > 20) hasMore = false;
      }

      return { success: true, posts: allPosts };
    } catch (error) {
      log.warn('[Late] fetchScheduledPosts:', error.message);
      return { success: false, error: error.message };
    }
  },

  async deletePost(postId, artistId = null) {
    try {
      const token = await getFirebaseToken();
      const url = artistId
        ? `${LATE_API_PROXY}?action=delete&postId=${postId}&artistId=${artistId}`
        : `${LATE_API_PROXY}?action=delete&postId=${postId}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed: ${response.status}`);
      }
      return { success: true };
    } catch (error) {
      log.warn('[Late] deletePost:', error.message);
      return { success: false, error: error.message };
    }
  },
};

export default lateApi;
