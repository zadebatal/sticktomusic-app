/**
 * Spotify Attribution Service
 *
 * Implements the Growth Attribution Algorithm:
 * - Correlates content posts with Spotify growth events
 * - Calculates contribution percentages
 * - Assigns confidence scores
 *
 * IMPORTANT: This is probabilistic attribution, NOT causation.
 * All results should be presented as "Likely contributed to growth"
 */

import {
  getStoredSnapshots,
  getStoredAttribution,
  saveAttribution,
  detectGrowthEvents,
  PLATFORM_WEIGHTS,
  ATTRIBUTION_CONFIG,
} from './spotifyService';
import { getStoredAnalytics } from './analyticsService';

// ============================================
// NORMALIZATION HELPERS
// ============================================

/**
 * Min-max normalization to 0-1 range
 */
const normalize = (value, min, max) => {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
};

/**
 * Get normalization bounds from an array of values
 */
const getBounds = (values) => {
  if (!values || values.length === 0) return { min: 0, max: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
};

// ============================================
// FEATURE CALCULATIONS
// ============================================

/**
 * Calculate engagement quality score for a post
 * Weighted combination of views, engagement rate, shares, comments
 */
export const calculateEngagementQuality = (post, allPosts) => {
  const viewsBounds = getBounds(allPosts.map((p) => p.views || 0));
  const engagementBounds = getBounds(allPosts.map((p) => p.engagementRate || 0));
  const sharesBounds = getBounds(allPosts.map((p) => p.shares || p.likes || 0));
  const commentsBounds = getBounds(allPosts.map((p) => p.comments || 0));

  const viewsScore = normalize(post.views || 0, viewsBounds.min, viewsBounds.max);
  const engagementScore = normalize(
    post.engagementRate || 0,
    engagementBounds.min,
    engagementBounds.max,
  );
  const sharesScore = normalize(post.shares || post.likes || 0, sharesBounds.min, sharesBounds.max);
  const commentsScore = normalize(post.comments || 0, commentsBounds.min, commentsBounds.max);

  // Weighted formula from spec
  return 0.4 * viewsScore + 0.25 * engagementScore + 0.2 * sharesScore + 0.15 * commentsScore;
};

/**
 * Calculate time decay factor
 * Exponential decay with configurable half-life
 */
export const calculateTimeDecay = (postedAt, eventTime) => {
  const postedDate = new Date(postedAt);
  const eventDate = new Date(eventTime);
  const hoursBetween = (eventDate - postedDate) / (1000 * 60 * 60);

  if (hoursBetween < 0) return 0; // Post is after event
  if (hoursBetween > ATTRIBUTION_CONFIG.lookbackWindow) return 0;

  return Math.exp(-hoursBetween / ATTRIBUTION_CONFIG.timeDecayHalfLife);
};

/**
 * Calculate song match score
 * 1.0 = exact track match
 * 0.65 = same artist, different track
 * 0.35 = no track mapping
 */
export const calculateSongMatch = (post, growthEvent, trackMapping) => {
  if (!growthEvent.trackId) {
    // Follower growth event - any post can contribute
    return post.audioId ? 0.65 : 0.35;
  }

  // Track-specific growth event
  const postSpotifyTrackId = trackMapping[post.audioId];

  if (postSpotifyTrackId === growthEvent.trackId) {
    return 1.0; // Exact match
  } else if (post.audioId) {
    return 0.65; // Same artist, different track
  }

  return 0.35; // No track mapping
};

/**
 * Get platform weight for a post
 */
export const getPlatformWeight = (platform) => {
  const normalized = (platform || '').toLowerCase();
  return PLATFORM_WEIGHTS[normalized] || PLATFORM_WEIGHTS.other;
};

// ============================================
// ATTRIBUTION CALCULATION
// ============================================

/**
 * Calculate raw relevance score for a post relative to a growth event
 */
export const calculateRawRelevance = (post, growthEvent, allPosts, trackMapping) => {
  const engagementQuality = calculateEngagementQuality(post, allPosts);
  const timeDecay = calculateTimeDecay(post.postedAt, growthEvent.eventTime);
  const songMatch = calculateSongMatch(post, growthEvent, trackMapping);
  const platformWeight = getPlatformWeight(post.platform);

  // If time decay is 0, post is outside window
  if (timeDecay === 0) return 0;

  return engagementQuality * timeDecay * songMatch * platformWeight;
};

/**
 * Calculate confidence score for an attribution
 */
export const calculateConfidenceScore = (
  attributedLift,
  engagementQuality,
  timeDecay,
  songMatch,
  candidateCount,
  flags = {},
) => {
  // Get normalization bounds for lift
  const liftBounds = { min: 0, max: Math.max(attributedLift * 2, 100) };
  const normalizedLift = normalize(attributedLift, liftBounds.min, liftBounds.max);

  // Base confidence calculation
  let confidence =
    100 * (0.45 * normalizedLift + 0.25 * engagementQuality + 0.2 * timeDecay + 0.1 * songMatch);

  // Apply penalties
  if (candidateCount > 3) {
    confidence *= ATTRIBUTION_CONFIG.multiPostPenalty;
  }
  if (flags.releaseDay) {
    confidence *= ATTRIBUTION_CONFIG.releaseDayPenalty;
  }
  if (flags.paidCampaign) {
    confidence *= ATTRIBUTION_CONFIG.paidCampaignPenalty;
  }

  return Math.round(Math.min(100, Math.max(0, confidence)));
};

/**
 * Get confidence label from score
 */
export const getConfidenceLabel = (score) => {
  if (score >= ATTRIBUTION_CONFIG.minConfidenceForHigh) return 'High';
  if (score >= ATTRIBUTION_CONFIG.minConfidenceForMedium) return 'Medium';
  return 'Low';
};

/**
 * Get candidate posts for a growth event (within lookback window)
 */
export const getCandidatePosts = (posts, growthEvent) => {
  const eventTime = new Date(growthEvent.eventTime);
  const windowStart = new Date(
    eventTime.getTime() - ATTRIBUTION_CONFIG.lookbackWindow * 60 * 60 * 1000,
  );

  return posts.filter((post) => {
    const postedTime = new Date(post.postedAt);
    return postedTime >= windowStart && postedTime <= eventTime;
  });
};

/**
 * Calculate attribution for all posts relative to a growth event
 */
export const calculatePostAttribution = (growthEvent, allPosts, trackMapping, flags = {}) => {
  // Get candidate posts within the lookback window
  const candidates = getCandidatePosts(allPosts, growthEvent);

  if (candidates.length === 0) {
    return [];
  }

  // Calculate raw relevance for each candidate
  const relevances = candidates.map((post) => ({
    post,
    rawRelevance: calculateRawRelevance(post, growthEvent, candidates, trackMapping),
    engagementQuality: calculateEngagementQuality(post, candidates),
    timeDecay: calculateTimeDecay(post.postedAt, growthEvent.eventTime),
    songMatch: calculateSongMatch(post, growthEvent, trackMapping),
    platformWeight: getPlatformWeight(post.platform),
  }));

  // Filter out posts with zero relevance
  const validRelevances = relevances.filter((r) => r.rawRelevance > 0);

  if (validRelevances.length === 0) {
    return [];
  }

  // Calculate total relevance for normalization
  const totalRelevance = validRelevances.reduce((sum, r) => sum + r.rawRelevance, 0);

  // Calculate attributions
  return validRelevances
    .map((r) => {
      const contributionPct = (r.rawRelevance / totalRelevance) * 100;
      const attributedLift = growthEvent.liftDelta * (r.rawRelevance / totalRelevance);

      const confidenceScore = calculateConfidenceScore(
        attributedLift,
        r.engagementQuality,
        r.timeDecay,
        r.songMatch,
        candidates.length,
        flags,
      );

      return {
        id: `attr_${growthEvent.id}_${r.post.videoId || r.post.id}`,
        growthEventId: growthEvent.id,
        postId: r.post.videoId || r.post.id,
        post: {
          id: r.post.videoId || r.post.id,
          name: r.post.videoName || r.post.name,
          platform: r.post.platform,
          handle: r.post.handle,
          audioId: r.post.audioId,
          audioName: r.post.audioName,
          postedAt: r.post.postedAt,
          views: r.post.views,
          likes: r.post.likes,
          engagementRate: r.post.engagementRate,
        },
        relevanceScore: r.rawRelevance,
        contributionPct: Math.round(contributionPct * 10) / 10,
        attributedLift: Math.round(attributedLift * 100) / 100,
        confidenceScore,
        confidenceLabel: getConfidenceLabel(confidenceScore),
        components: {
          engagementQuality: Math.round(r.engagementQuality * 100) / 100,
          timeDecay: Math.round(r.timeDecay * 100) / 100,
          songMatch: r.songMatch,
          platformWeight: r.platformWeight,
        },
        timeToImpact: Math.round(
          (new Date(growthEvent.eventTime) - new Date(r.post.postedAt)) / (1000 * 60 * 60),
        ),
      };
    })
    .sort((a, b) => b.contributionPct - a.contributionPct);
};

// ============================================
// MAIN ATTRIBUTION COMPUTATION
// ============================================

/**
 * Compute all attributions for an artist
 * Processes growth events and maps to content posts
 */
export const computeAttribution = (artistId, options = {}) => {
  const { trackMapping = {}, flags = {} } = options;

  // Get content posts from analytics service
  const analytics = getStoredAnalytics(artistId);
  const allPosts = Object.values(analytics.videos || {});

  if (allPosts.length === 0) {
    return { growthEvents: [], postAttributions: [] };
  }

  // Detect growth events
  const growthEvents = detectGrowthEvents(artistId);

  if (growthEvents.length === 0) {
    // No growth events detected, save empty attribution
    const result = { growthEvents: [], postAttributions: [] };
    saveAttribution(artistId, result);
    return result;
  }

  // Calculate attributions for each growth event
  const allAttributions = [];

  for (const event of growthEvents) {
    const eventFlags = {
      ...flags,
      releaseDay: checkReleaseDay(event, trackMapping),
      paidCampaign: false, // Would need external flag
    };

    const attributions = calculatePostAttribution(event, allPosts, trackMapping, eventFlags);
    allAttributions.push(...attributions);
  }

  // Save and return results
  const result = {
    growthEvents,
    postAttributions: allAttributions,
  };

  saveAttribution(artistId, result);
  return result;
};

/**
 * Check if a growth event occurred on a track's release day
 */
const checkReleaseDay = (growthEvent, trackMapping) => {
  // This would need release date data from Spotify
  // For now, return false
  return false;
};

// ============================================
// AGGREGATION QUERIES
// ============================================

/**
 * Get top growth drivers (posts with highest attributed lift)
 */
export const getTopGrowthDrivers = (artistId, limit = 5) => {
  const attribution = getStoredAttribution(artistId);

  if (!attribution.postAttributions || attribution.postAttributions.length === 0) {
    return [];
  }

  // Group by post and sum attributed lift
  const postLiftMap = {};

  for (const attr of attribution.postAttributions) {
    const postId = attr.postId;
    if (!postLiftMap[postId]) {
      postLiftMap[postId] = {
        ...attr.post,
        totalAttributedLift: 0,
        totalContributionPct: 0,
        attributions: [],
        avgConfidence: 0,
      };
    }
    postLiftMap[postId].totalAttributedLift += attr.attributedLift;
    postLiftMap[postId].totalContributionPct += attr.contributionPct;
    postLiftMap[postId].attributions.push(attr);
  }

  // Calculate average confidence and sort
  const posts = Object.values(postLiftMap).map((post) => ({
    ...post,
    avgConfidence: Math.round(
      post.attributions.reduce((sum, a) => sum + a.confidenceScore, 0) / post.attributions.length,
    ),
    avgConfidenceLabel: getConfidenceLabel(
      post.attributions.reduce((sum, a) => sum + a.confidenceScore, 0) / post.attributions.length,
    ),
  }));

  return posts.sort((a, b) => b.totalAttributedLift - a.totalAttributedLift).slice(0, limit);
};

/**
 * Get attribution data for a specific song/track
 */
export const getSongAttribution = (artistId, spotifyTrackId) => {
  const attribution = getStoredAttribution(artistId);

  // Filter growth events for this track
  const trackEvents = attribution.growthEvents.filter((e) => e.trackId === spotifyTrackId);

  // Filter attributions for this track's events
  const trackEventIds = new Set(trackEvents.map((e) => e.id));
  const trackAttributions = attribution.postAttributions.filter((a) =>
    trackEventIds.has(a.growthEventId),
  );

  // Calculate total lift
  const totalLift = trackEvents.reduce((sum, e) => sum + e.liftDelta, 0);
  const attributedLift = trackAttributions.reduce((sum, a) => sum + a.attributedLift, 0);

  // Get contributing videos
  const contributingVideos = [];
  const videoMap = {};

  for (const attr of trackAttributions) {
    if (!videoMap[attr.postId]) {
      videoMap[attr.postId] = {
        ...attr.post,
        totalContributionPct: 0,
        totalAttributedLift: 0,
        confidenceScore: attr.confidenceScore,
        confidenceLabel: attr.confidenceLabel,
      };
    }
    videoMap[attr.postId].totalContributionPct += attr.contributionPct;
    videoMap[attr.postId].totalAttributedLift += attr.attributedLift;
  }

  return {
    spotifyTrackId,
    growthEvents: trackEvents,
    totalLift,
    attributedLift,
    contributingVideos: Object.values(videoMap).sort(
      (a, b) => b.totalContributionPct - a.totalContributionPct,
    ),
    attributionCount: trackAttributions.length,
  };
};

/**
 * Get attribution data for a specific video/post
 */
export const getVideoAttribution = (artistId, videoId) => {
  const attribution = getStoredAttribution(artistId);

  // Get all attributions for this video
  const videoAttributions = attribution.postAttributions.filter((a) => a.postId === videoId);

  if (videoAttributions.length === 0) {
    return null;
  }

  // Get related growth events
  const eventIds = new Set(videoAttributions.map((a) => a.growthEventId));
  const relatedEvents = attribution.growthEvents.filter((e) => eventIds.has(e.id));

  // Calculate totals
  const totalContributionPct = videoAttributions.reduce((sum, a) => sum + a.contributionPct, 0);
  const totalAttributedLift = videoAttributions.reduce((sum, a) => sum + a.attributedLift, 0);
  const avgConfidence =
    videoAttributions.reduce((sum, a) => sum + a.confidenceScore, 0) / videoAttributions.length;

  // Calculate average time to impact
  const avgTimeToImpact =
    videoAttributions.reduce((sum, a) => sum + a.timeToImpact, 0) / videoAttributions.length;

  return {
    videoId,
    post: videoAttributions[0].post,
    attributions: videoAttributions,
    relatedGrowthEvents: relatedEvents,
    totalContributionPct: Math.round(totalContributionPct * 10) / 10,
    totalAttributedLift: Math.round(totalAttributedLift * 100) / 100,
    avgConfidence: Math.round(avgConfidence),
    avgConfidenceLabel: getConfidenceLabel(avgConfidence),
    avgTimeToImpact: Math.round(avgTimeToImpact),
  };
};

/**
 * Get attribution summary for all videos (for table display)
 */
export const getVideoAttributionSummary = (artistId) => {
  const attribution = getStoredAttribution(artistId);
  const analytics = getStoredAnalytics(artistId);
  const videos = Object.values(analytics.videos || {});

  return videos
    .map((video) => {
      const videoAttrs = attribution.postAttributions.filter(
        (a) => a.postId === (video.videoId || video.id),
      );

      if (videoAttrs.length === 0) {
        return {
          ...video,
          spotifyLift7d: 0,
          contributionPct: 0,
          confidenceScore: 0,
          confidenceLabel: 'None',
          timeToImpact: null,
        };
      }

      const totalLift = videoAttrs.reduce((sum, a) => sum + a.attributedLift, 0);
      const totalContribution = videoAttrs.reduce((sum, a) => sum + a.contributionPct, 0);
      const avgConfidence =
        videoAttrs.reduce((sum, a) => sum + a.confidenceScore, 0) / videoAttrs.length;
      const avgTimeToImpact =
        videoAttrs.reduce((sum, a) => sum + a.timeToImpact, 0) / videoAttrs.length;

      return {
        ...video,
        spotifyLift7d: Math.round(totalLift * 100) / 100,
        contributionPct: Math.round(totalContribution * 10) / 10,
        confidenceScore: Math.round(avgConfidence),
        confidenceLabel: getConfidenceLabel(avgConfidence),
        timeToImpact: Math.round(avgTimeToImpact),
      };
    })
    .sort((a, b) => b.spotifyLift7d - a.spotifyLift7d);
};

/**
 * Get song attribution summary (for Songs tab)
 */
export const getSongAttributionSummary = (artistId, trackMapping = {}) => {
  const attribution = getStoredAttribution(artistId);
  const analytics = getStoredAnalytics(artistId);

  // Get song performance from analytics
  const songMap = {};

  for (const video of Object.values(analytics.videos || {})) {
    if (!video.audioId) continue;

    if (!songMap[video.audioId]) {
      songMap[video.audioId] = {
        audioId: video.audioId,
        audioName: video.audioName || 'Unknown Song',
        spotifyTrackId: trackMapping[video.audioId] || null,
        videos: [],
        totalViews: 0,
        totalLikes: 0,
        totalAttributedLift: 0,
        contributingVideos: [],
      };
    }

    songMap[video.audioId].videos.push(video);
    songMap[video.audioId].totalViews += video.views || 0;
    songMap[video.audioId].totalLikes += video.likes || 0;

    // Find attributions for this video
    const videoAttrs = attribution.postAttributions.filter(
      (a) => a.postId === (video.videoId || video.id),
    );

    if (videoAttrs.length > 0) {
      const lift = videoAttrs.reduce((sum, a) => sum + a.attributedLift, 0);
      songMap[video.audioId].totalAttributedLift += lift;
      songMap[video.audioId].contributingVideos.push({
        ...video,
        attributedLift: lift,
      });
    }
  }

  return Object.values(songMap)
    .map((song) => ({
      ...song,
      videoCount: song.videos.length,
      momentumScore: song.spotifyTrackId
        ? getTrackMomentumScore(artistId, song.spotifyTrackId)
        : null,
      avgAttributedLift: song.videos.length > 0 ? song.totalAttributedLift / song.videos.length : 0,
    }))
    .sort((a, b) => b.totalAttributedLift - a.totalAttributedLift);
};

/**
 * Get momentum score for a specific track
 */
const getTrackMomentumScore = (artistId, spotifyTrackId) => {
  const snapshots = getStoredSnapshots(artistId);
  const trackSnapshots = snapshots.trackSnapshots[spotifyTrackId];

  if (!trackSnapshots || trackSnapshots.length < 2) {
    return null;
  }

  // Get 24h delta
  const sorted = [...trackSnapshots].sort(
    (a, b) => new Date(a.capturedAt) - new Date(b.capturedAt),
  );

  const current = sorted[sorted.length - 1];
  const dayAgo = sorted.find((s) => {
    const diff = new Date(current.capturedAt) - new Date(s.capturedAt);
    return diff >= 20 * 60 * 60 * 1000; // At least 20 hours ago
  });

  if (!dayAgo) return null;

  const delta = (current.popularity || 0) - (dayAgo.popularity || 0);

  // Convert to momentum score (0-100)
  // +10 popularity = 100 momentum, -10 = 0
  return Math.min(100, Math.max(0, 50 + delta * 5));
};

export default {
  calculateEngagementQuality,
  calculateTimeDecay,
  calculateSongMatch,
  getPlatformWeight,
  calculateRawRelevance,
  calculateConfidenceScore,
  getConfidenceLabel,
  getCandidatePosts,
  calculatePostAttribution,
  computeAttribution,
  getTopGrowthDrivers,
  getSongAttribution,
  getVideoAttribution,
  getVideoAttributionSummary,
  getSongAttributionSummary,
};
