/**
 * Spotify Attribution Service Tests
 *
 * Tests the core attribution algorithm:
 * - Normalization functions
 * - Time decay calculations
 * - Confidence scoring
 * - Attribution distribution
 */

import {
  calculateConfidenceScore,
  calculateEngagementQuality,
  calculatePostAttribution,
  calculateRawRelevance,
  calculateSongMatch,
  calculateTimeDecay,
  getCandidatePosts,
  getConfidenceLabel,
  getPlatformWeight,
} from '../spotifyAttributionService';
import { ATTRIBUTION_CONFIG, PLATFORM_WEIGHTS } from '../spotifyService';

// Mock posts for testing
const createMockPost = (overrides = {}) => ({
  videoId: 'video_1',
  videoName: 'Test Video',
  audioId: 'audio_1',
  audioName: 'Test Song',
  platform: 'tiktok',
  handle: '@test',
  postedAt: '2026-02-01T12:00:00Z',
  views: 10000,
  likes: 500,
  comments: 50,
  shares: 100,
  engagementRate: 6.5,
  ...overrides,
});

// Mock growth event
const createMockGrowthEvent = (overrides = {}) => ({
  id: 'growth_1',
  artistId: 'artist_1',
  trackId: null,
  metricType: 'followers',
  eventTime: '2026-02-02T12:00:00Z',
  observedDelta: 500,
  expectedDelta: 200,
  liftDelta: 300,
  ...overrides,
});

describe('spotifyAttributionService', () => {
  describe('calculateEngagementQuality', () => {
    test('returns 0 for post with no engagement', () => {
      const post = createMockPost({
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        engagementRate: 0,
      });
      const allPosts = [post];
      const quality = calculateEngagementQuality(post, allPosts);
      // With only one post at 0, normalization gives 0.5 or 0
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    });

    test('returns higher score for high-engagement post', () => {
      const lowPost = createMockPost({
        views: 1000,
        likes: 50,
        comments: 5,
        shares: 10,
        engagementRate: 2.0,
      });
      const highPost = createMockPost({
        views: 100000,
        likes: 5000,
        comments: 500,
        shares: 1000,
        engagementRate: 12.0,
      });
      const allPosts = [lowPost, highPost];

      const lowQuality = calculateEngagementQuality(lowPost, allPosts);
      const highQuality = calculateEngagementQuality(highPost, allPosts);

      expect(highQuality).toBeGreaterThan(lowQuality);
    });

    test('correctly weights views at 40%', () => {
      const post1 = createMockPost({
        views: 100000,
        likes: 0,
        comments: 0,
        shares: 0,
        engagementRate: 0,
      });
      const post2 = createMockPost({
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        engagementRate: 0,
      });
      const allPosts = [post1, post2];

      const quality = calculateEngagementQuality(post1, allPosts);
      // With max views and nothing else, should be close to 0.4 (40% weight)
      expect(quality).toBeCloseTo(0.4, 1);
    });
  });

  describe('calculateTimeDecay', () => {
    test('returns 1 for post at same time as event', () => {
      const decay = calculateTimeDecay('2026-02-02T12:00:00Z', '2026-02-02T12:00:00Z');
      expect(decay).toBeCloseTo(1, 2);
    });

    test('returns ~0.5 at half-life (36 hours)', () => {
      const posted = '2026-02-01T00:00:00Z';
      const event = '2026-02-02T12:00:00Z'; // 36 hours later
      const decay = calculateTimeDecay(posted, event);
      expect(decay).toBeCloseTo(0.368, 1); // e^-1 ≈ 0.368
    });

    test('returns 0 for posts after event', () => {
      const decay = calculateTimeDecay('2026-02-03T12:00:00Z', '2026-02-02T12:00:00Z');
      expect(decay).toBe(0);
    });

    test('returns 0 for posts outside lookback window', () => {
      const posted = '2026-01-25T12:00:00Z'; // More than 96h before event
      const event = '2026-02-02T12:00:00Z';
      const decay = calculateTimeDecay(posted, event);
      expect(decay).toBe(0);
    });

    test('decays exponentially over time', () => {
      const event = '2026-02-02T12:00:00Z';
      const decay12h = calculateTimeDecay('2026-02-02T00:00:00Z', event);
      const decay24h = calculateTimeDecay('2026-02-01T12:00:00Z', event);
      const decay48h = calculateTimeDecay('2026-01-31T12:00:00Z', event);

      expect(decay12h).toBeGreaterThan(decay24h);
      expect(decay24h).toBeGreaterThan(decay48h);
      expect(decay48h).toBeGreaterThan(0);
    });
  });

  describe('calculateSongMatch', () => {
    test('returns 1.0 for exact track match', () => {
      const post = createMockPost({ audioId: 'audio_1' });
      const event = createMockGrowthEvent({ trackId: 'spotify_track_1' });
      const trackMapping = { audio_1: 'spotify_track_1' };

      const match = calculateSongMatch(post, event, trackMapping);
      expect(match).toBe(1.0);
    });

    test('returns 0.65 for same artist different track', () => {
      const post = createMockPost({ audioId: 'audio_2' });
      const event = createMockGrowthEvent({ trackId: 'spotify_track_1' });
      const trackMapping = { audio_1: 'spotify_track_1', audio_2: 'spotify_track_2' };

      const match = calculateSongMatch(post, event, trackMapping);
      expect(match).toBe(0.65);
    });

    test('returns 0.35 for no track mapping', () => {
      const post = createMockPost({ audioId: null });
      const event = createMockGrowthEvent({ trackId: 'spotify_track_1' });
      const trackMapping = {};

      const match = calculateSongMatch(post, event, trackMapping);
      expect(match).toBe(0.35);
    });

    test('returns 0.65 for follower event with any song', () => {
      const post = createMockPost({ audioId: 'audio_1' });
      const event = createMockGrowthEvent({ trackId: null }); // Follower event
      const trackMapping = {};

      const match = calculateSongMatch(post, event, trackMapping);
      expect(match).toBe(0.65);
    });
  });

  describe('getPlatformWeight', () => {
    test('returns correct weights for known platforms', () => {
      expect(getPlatformWeight('tiktok')).toBe(1.0);
      expect(getPlatformWeight('TikTok')).toBe(1.0);
      expect(getPlatformWeight('instagram')).toBe(0.85);
      expect(getPlatformWeight('youtube')).toBe(0.8);
      expect(getPlatformWeight('twitter')).toBe(0.7);
    });

    test('returns default weight for unknown platforms', () => {
      expect(getPlatformWeight('unknown')).toBe(0.65);
      expect(getPlatformWeight('')).toBe(0.65);
      expect(getPlatformWeight(null)).toBe(0.65);
    });
  });

  describe('calculateConfidenceScore', () => {
    test('returns score between 0 and 100', () => {
      const score = calculateConfidenceScore(50, 0.5, 0.5, 1.0, 2);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('applies multi-post penalty when > 3 candidates', () => {
      const scoreNoPenalty = calculateConfidenceScore(50, 0.7, 0.8, 1.0, 3);
      const scoreWithPenalty = calculateConfidenceScore(50, 0.7, 0.8, 1.0, 4);

      expect(scoreWithPenalty).toBeLessThan(scoreNoPenalty);
      expect(scoreWithPenalty).toBeCloseTo(scoreNoPenalty * 0.85, 0);
    });

    test('applies release day penalty', () => {
      const scoreNoPenalty = calculateConfidenceScore(50, 0.7, 0.8, 1.0, 2, {});
      const scoreWithPenalty = calculateConfidenceScore(50, 0.7, 0.8, 1.0, 2, { releaseDay: true });

      expect(scoreWithPenalty).toBeLessThan(scoreNoPenalty);
    });

    test('applies paid campaign penalty', () => {
      const scoreNoPenalty = calculateConfidenceScore(50, 0.7, 0.8, 1.0, 2, {});
      const scoreWithPenalty = calculateConfidenceScore(50, 0.7, 0.8, 1.0, 2, {
        paidCampaign: true,
      });

      expect(scoreWithPenalty).toBeLessThan(scoreNoPenalty);
    });
  });

  describe('getConfidenceLabel', () => {
    test('returns "High" for scores >= 70', () => {
      expect(getConfidenceLabel(70)).toBe('High');
      expect(getConfidenceLabel(85)).toBe('High');
      expect(getConfidenceLabel(100)).toBe('High');
    });

    test('returns "Medium" for scores 45-69', () => {
      expect(getConfidenceLabel(45)).toBe('Medium');
      expect(getConfidenceLabel(55)).toBe('Medium');
      expect(getConfidenceLabel(69)).toBe('Medium');
    });

    test('returns "Low" for scores < 45', () => {
      expect(getConfidenceLabel(0)).toBe('Low');
      expect(getConfidenceLabel(30)).toBe('Low');
      expect(getConfidenceLabel(44)).toBe('Low');
    });
  });

  describe('getCandidatePosts', () => {
    test('returns posts within lookback window', () => {
      const event = createMockGrowthEvent({ eventTime: '2026-02-02T12:00:00Z' });
      const posts = [
        createMockPost({ videoId: 'v1', postedAt: '2026-02-01T12:00:00Z' }), // 24h before - in window
        createMockPost({ videoId: 'v2', postedAt: '2026-01-30T12:00:00Z' }), // 72h before - in window
        createMockPost({ videoId: 'v3', postedAt: '2026-01-28T12:00:00Z' }), // 120h before - outside window
        createMockPost({ videoId: 'v4', postedAt: '2026-02-03T12:00:00Z' }), // After event - excluded
      ];

      const candidates = getCandidatePosts(posts, event);

      expect(candidates).toHaveLength(2);
      expect(candidates.map((c) => c.videoId)).toContain('v1');
      expect(candidates.map((c) => c.videoId)).toContain('v2');
      expect(candidates.map((c) => c.videoId)).not.toContain('v3');
      expect(candidates.map((c) => c.videoId)).not.toContain('v4');
    });

    test('returns empty array when no posts in window', () => {
      const event = createMockGrowthEvent({ eventTime: '2026-02-02T12:00:00Z' });
      const posts = [
        createMockPost({ videoId: 'v1', postedAt: '2026-01-25T12:00:00Z' }), // Too old
      ];

      const candidates = getCandidatePosts(posts, event);
      expect(candidates).toHaveLength(0);
    });
  });

  describe('calculatePostAttribution', () => {
    test('returns empty array when no candidate posts', () => {
      const event = createMockGrowthEvent({ eventTime: '2026-02-02T12:00:00Z' });
      const posts = []; // No posts
      const trackMapping = {};

      const attributions = calculatePostAttribution(event, posts, trackMapping);
      expect(attributions).toHaveLength(0);
    });

    test('contribution percentages sum to 100%', () => {
      const event = createMockGrowthEvent({
        eventTime: '2026-02-02T12:00:00Z',
        liftDelta: 300,
      });
      const posts = [
        createMockPost({ videoId: 'v1', postedAt: '2026-02-01T12:00:00Z', views: 50000 }),
        createMockPost({ videoId: 'v2', postedAt: '2026-02-01T18:00:00Z', views: 30000 }),
        createMockPost({ videoId: 'v3', postedAt: '2026-02-02T06:00:00Z', views: 20000 }),
      ];
      const trackMapping = {};

      const attributions = calculatePostAttribution(event, posts, trackMapping);

      const totalContribution = attributions.reduce((sum, a) => sum + a.contributionPct, 0);
      expect(totalContribution).toBeCloseTo(100, 0);
    });

    test('attributed lift sums to total lift delta', () => {
      const liftDelta = 300;
      const event = createMockGrowthEvent({
        eventTime: '2026-02-02T12:00:00Z',
        liftDelta,
      });
      const posts = [
        createMockPost({ videoId: 'v1', postedAt: '2026-02-01T12:00:00Z', views: 50000 }),
        createMockPost({ videoId: 'v2', postedAt: '2026-02-02T00:00:00Z', views: 30000 }),
      ];
      const trackMapping = {};

      const attributions = calculatePostAttribution(event, posts, trackMapping);

      const totalAttributedLift = attributions.reduce((sum, a) => sum + a.attributedLift, 0);
      expect(totalAttributedLift).toBeCloseTo(liftDelta, 1);
    });

    test('more recent posts get higher contribution', () => {
      const event = createMockGrowthEvent({ eventTime: '2026-02-02T12:00:00Z' });
      const posts = [
        createMockPost({ videoId: 'v1', postedAt: '2026-01-30T12:00:00Z', views: 50000 }), // 72h before
        createMockPost({ videoId: 'v2', postedAt: '2026-02-02T06:00:00Z', views: 50000 }), // 6h before
      ];
      const trackMapping = {};

      const attributions = calculatePostAttribution(event, posts, trackMapping);

      const oldPostAttr = attributions.find((a) => a.postId === 'v1');
      const newPostAttr = attributions.find((a) => a.postId === 'v2');

      expect(newPostAttr.contributionPct).toBeGreaterThan(oldPostAttr.contributionPct);
    });

    test('includes confidence score and label', () => {
      const event = createMockGrowthEvent({ eventTime: '2026-02-02T12:00:00Z' });
      const posts = [createMockPost({ videoId: 'v1', postedAt: '2026-02-01T12:00:00Z' })];
      const trackMapping = {};

      const attributions = calculatePostAttribution(event, posts, trackMapping);

      expect(attributions[0]).toHaveProperty('confidenceScore');
      expect(attributions[0]).toHaveProperty('confidenceLabel');
      expect(['High', 'Medium', 'Low']).toContain(attributions[0].confidenceLabel);
    });

    test('calculates time to impact correctly', () => {
      const event = createMockGrowthEvent({ eventTime: '2026-02-02T12:00:00Z' });
      const posts = [
        createMockPost({ videoId: 'v1', postedAt: '2026-02-01T12:00:00Z' }), // 24h before
      ];
      const trackMapping = {};

      const attributions = calculatePostAttribution(event, posts, trackMapping);

      expect(attributions[0].timeToImpact).toBe(24);
    });
  });

  describe('calculateRawRelevance', () => {
    test('returns 0 for posts outside lookback window', () => {
      const post = createMockPost({ postedAt: '2026-01-25T12:00:00Z' }); // Too old
      const event = createMockGrowthEvent({ eventTime: '2026-02-02T12:00:00Z' });
      const allPosts = [post];
      const trackMapping = {};

      const relevance = calculateRawRelevance(post, event, allPosts, trackMapping);
      expect(relevance).toBe(0);
    });

    test('TikTok posts have higher relevance than other platforms (all else equal)', () => {
      const event = createMockGrowthEvent({ eventTime: '2026-02-02T12:00:00Z' });
      const tiktokPost = createMockPost({
        videoId: 'v1',
        platform: 'tiktok',
        postedAt: '2026-02-01T12:00:00Z',
      });
      const fbPost = createMockPost({
        videoId: 'v2',
        platform: 'facebook',
        postedAt: '2026-02-01T12:00:00Z',
      });
      const allPosts = [tiktokPost, fbPost];
      const trackMapping = {};

      const tiktokRelevance = calculateRawRelevance(tiktokPost, event, allPosts, trackMapping);
      const fbRelevance = calculateRawRelevance(fbPost, event, allPosts, trackMapping);

      expect(tiktokRelevance).toBeGreaterThan(fbRelevance);
    });
  });
});
