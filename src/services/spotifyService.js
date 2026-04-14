/**
 * Spotify Service - Spotify Data Ingestion + Attribution
 *
 * Handles:
 * - Fetching Spotify data via Spot On Track API proxy
 * - Storing snapshots in localStorage (per-artist namespaced)
 * - Computing growth events and attribution
 * - Momentum scoring
 */

import { getAuth } from 'firebase/auth';
import log from '../utils/logger';

// Storage keys (artist-namespaced)
const getStorageKey = (artistId) => `stm_spotify_${artistId}`;
const getSnapshotsKey = (artistId) => `stm_spotify_snapshots_${artistId}`;
const getAttributionKey = (artistId) => `stm_spotify_attribution_${artistId}`;

// Platform weights for attribution
export const PLATFORM_WEIGHTS = {
  tiktok: 1.0,
  instagram: 0.85,
  youtube: 0.8,
  twitter: 0.7,
  facebook: 0.7,
  other: 0.65,
};

// Attribution configuration
export const ATTRIBUTION_CONFIG = {
  timeDecayHalfLife: 36, // hours
  lookbackWindow: 96, // hours (4 days)
  minConfidenceForHigh: 70,
  minConfidenceForMedium: 45,
  multiPostPenalty: 0.85,
  releaseDayPenalty: 0.85,
  paidCampaignPenalty: 0.9,
  outlierZThreshold: 2.5,
  baselineDays: 14,
  baselineExcludeDays: 2,
};

/**
 * Get Firebase auth token
 */
const getFirebaseToken = async () => {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
};

/**
 * Proxy request to Spotify API (via our serverless function)
 */
const proxyRequest = async (action, artistId, params = {}) => {
  const token = await getFirebaseToken();
  const queryParams = new URLSearchParams({
    action,
    artistId,
    ...params,
  });

  const response = await fetch(`/api/spotify?${queryParams}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json();
};

// ============================================
// SPOTIFY DATA STORAGE
// ============================================

/**
 * Get stored Spotify data from localStorage
 */
export const getStoredSpotifyData = (artistId) => {
  try {
    const data = localStorage.getItem(getStorageKey(artistId));
    return data
      ? JSON.parse(data)
      : {
          artist: null,
          tracks: {},
          lastUpdated: null,
        };
  } catch (error) {
    log.error('Error reading Spotify data:', error);
    return { artist: null, tracks: {}, lastUpdated: null };
  }
};

/**
 * Save Spotify data to localStorage
 */
export const saveSpotifyData = (artistId, data) => {
  try {
    localStorage.setItem(
      getStorageKey(artistId),
      JSON.stringify({
        ...data,
        lastUpdated: new Date().toISOString(),
      }),
    );
  } catch (error) {
    log.error('Error saving Spotify data:', error);
  }
};

/**
 * Get stored snapshots from localStorage
 */
export const getStoredSnapshots = (artistId) => {
  try {
    const data = localStorage.getItem(getSnapshotsKey(artistId));
    return data
      ? JSON.parse(data)
      : {
          artistSnapshots: [],
          trackSnapshots: {},
          lastUpdated: null,
        };
  } catch (error) {
    log.error('Error reading snapshots:', error);
    return { artistSnapshots: [], trackSnapshots: {}, lastUpdated: null };
  }
};

/**
 * Save snapshots to localStorage
 */
export const saveSnapshots = (artistId, data) => {
  try {
    localStorage.setItem(
      getSnapshotsKey(artistId),
      JSON.stringify({
        ...data,
        lastUpdated: new Date().toISOString(),
      }),
    );
  } catch (error) {
    log.error('Error saving snapshots:', error);
  }
};

/**
 * Get stored attribution data from localStorage
 */
export const getStoredAttribution = (artistId) => {
  try {
    const data = localStorage.getItem(getAttributionKey(artistId));
    return data
      ? JSON.parse(data)
      : {
          growthEvents: [],
          postAttributions: [],
          lastComputed: null,
        };
  } catch (error) {
    log.error('Error reading attribution:', error);
    return { growthEvents: [], postAttributions: [], lastComputed: null };
  }
};

/**
 * Save attribution data to localStorage
 */
export const saveAttribution = (artistId, data) => {
  try {
    localStorage.setItem(
      getAttributionKey(artistId),
      JSON.stringify({
        ...data,
        lastComputed: new Date().toISOString(),
      }),
    );
  } catch (error) {
    log.error('Error saving attribution:', error);
  }
};

// ============================================
// SPOTIFY DATA FETCHING
// ============================================

/**
 * Fetch artist data from Spotify via proxy
 */
export const fetchSpotifyArtist = async (artistId, spotifyArtistId) => {
  return proxyRequest('getArtist', artistId, { spotifyArtistId });
};

/**
 * Fetch track data from Spotify via proxy
 */
export const fetchSpotifyTrack = async (artistId, spotifyTrackId) => {
  return proxyRequest('getTrack', artistId, { spotifyTrackId });
};

/**
 * Fetch multiple tracks by ISRC codes via proxy
 */
export const fetchTracksByISRC = async (artistId, isrcCodes) => {
  return proxyRequest('getTracksByISRC', artistId, {
    isrcCodes: isrcCodes.join(','),
  });
};

/**
 * Sync Spotify data - creates new snapshot
 */
export const syncSpotifyData = async (artistId, spotifyConfig) => {
  if (!spotifyConfig?.spotifyArtistId) {
    throw new Error('Spotify Artist ID not configured');
  }

  const now = new Date().toISOString();
  const stored = getStoredSpotifyData(artistId);
  const snapshots = getStoredSnapshots(artistId);

  // Fetch current artist data
  const artistData = await fetchSpotifyArtist(artistId, spotifyConfig.spotifyArtistId);

  // Create artist snapshot
  const artistSnapshot = {
    id: `artist_${Date.now()}`,
    artistId,
    capturedAt: now,
    followers: artistData.followers?.total || 0,
    popularity: artistData.popularity || 0,
    monthlyListeners: artistData.monthlyListeners || null, // May not be available
  };

  snapshots.artistSnapshots.push(artistSnapshot);

  // Keep only last 90 days of artist snapshots (4 per day max = 360 snapshots)
  if (snapshots.artistSnapshots.length > 360) {
    snapshots.artistSnapshots = snapshots.artistSnapshots.slice(-360);
  }

  // Fetch and snapshot each configured track
  if (spotifyConfig.tracks && spotifyConfig.tracks.length > 0) {
    for (const track of spotifyConfig.tracks) {
      try {
        const trackData = await fetchSpotifyTrack(artistId, track.spotifyTrackId);

        if (!snapshots.trackSnapshots[track.spotifyTrackId]) {
          snapshots.trackSnapshots[track.spotifyTrackId] = [];
        }

        const trackSnapshot = {
          id: `track_${Date.now()}_${track.spotifyTrackId}`,
          trackId: track.spotifyTrackId,
          capturedAt: now,
          popularity: trackData.popularity || 0,
          // Note: Actual stream counts require Spot On Track API
          // Spotify Web API only gives popularity score (0-100)
        };

        snapshots.trackSnapshots[track.spotifyTrackId].push(trackSnapshot);

        // Keep only last 360 snapshots per track
        if (snapshots.trackSnapshots[track.spotifyTrackId].length > 360) {
          snapshots.trackSnapshots[track.spotifyTrackId] =
            snapshots.trackSnapshots[track.spotifyTrackId].slice(-360);
        }

        // Update stored track data
        stored.tracks[track.spotifyTrackId] = {
          ...track,
          ...trackData,
          lastUpdated: now,
        };
      } catch (error) {
        log.error(`Error syncing track ${track.spotifyTrackId}:`, error);
      }
    }
  }

  // Update stored artist data
  stored.artist = {
    ...stored.artist,
    ...artistData,
    spotifyArtistId: spotifyConfig.spotifyArtistId,
    lastUpdated: now,
  };

  saveSpotifyData(artistId, stored);
  saveSnapshots(artistId, snapshots);

  return { stored, snapshots, artistSnapshot };
};

// ============================================
// DELTA CALCULATIONS
// ============================================

/**
 * Calculate deltas for a metric over a time period
 */
export const calculateDelta = (snapshots, metric, hoursBack = 24) => {
  if (!snapshots || snapshots.length < 2) return null;

  const now = new Date();
  const cutoff = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

  // Sort by capture time
  const sorted = [...snapshots].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));

  // Find snapshot closest to cutoff time
  const pastSnapshot = sorted.reduce((closest, s) => {
    const snapTime = new Date(s.capturedAt);
    if (snapTime > cutoff) return closest;
    if (!closest) return s;
    const closestTime = new Date(closest.capturedAt);
    return Math.abs(snapTime - cutoff) < Math.abs(closestTime - cutoff) ? s : closest;
  }, null);

  const currentSnapshot = sorted[sorted.length - 1];

  if (!pastSnapshot || !currentSnapshot) return null;

  const currentValue = currentSnapshot[metric] || 0;
  const pastValue = pastSnapshot[metric] || 0;
  const delta = currentValue - pastValue;
  const percentChange = pastValue > 0 ? (delta / pastValue) * 100 : 0;

  return {
    current: currentValue,
    past: pastValue,
    delta,
    percentChange,
    hoursBack,
    fromTime: pastSnapshot.capturedAt,
    toTime: currentSnapshot.capturedAt,
  };
};

/**
 * Calculate baseline expected delta using rolling mean
 * Excludes outliers (z > 2.5) and recent 48 hours
 */
export const calculateBaselineDelta = (snapshots, metric) => {
  const config = ATTRIBUTION_CONFIG;

  if (!snapshots || snapshots.length < config.baselineDays) {
    return { expected: 0, stdDev: 0, hasBaseline: false };
  }

  const now = new Date();
  const excludeCutoff = new Date(now.getTime() - config.baselineExcludeDays * 24 * 60 * 60 * 1000);
  const baselineCutoff = new Date(now.getTime() - config.baselineDays * 24 * 60 * 60 * 1000);

  // Get daily deltas, excluding recent data
  const dailyDeltas = [];
  const sorted = [...snapshots].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));

  for (let i = 1; i < sorted.length; i++) {
    const snapTime = new Date(sorted[i].capturedAt);
    if (snapTime < baselineCutoff) continue;
    if (snapTime > excludeCutoff) continue;

    const prevSnapTime = new Date(sorted[i - 1].capturedAt);
    const hoursDiff = (snapTime - prevSnapTime) / (1000 * 60 * 60);

    // Normalize to 24-hour delta
    if (hoursDiff > 0 && hoursDiff <= 48) {
      const delta = (sorted[i][metric] || 0) - (sorted[i - 1][metric] || 0);
      const normalizedDelta = delta * (24 / hoursDiff);
      dailyDeltas.push(normalizedDelta);
    }
  }

  if (dailyDeltas.length < 3) {
    return { expected: 0, stdDev: 0, hasBaseline: false };
  }

  // Calculate mean and std dev
  const mean = dailyDeltas.reduce((a, b) => a + b, 0) / dailyDeltas.length;
  const variance = dailyDeltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / dailyDeltas.length;
  const stdDev = Math.sqrt(variance);

  // Remove outliers (z > 2.5)
  const filteredDeltas = dailyDeltas.filter((d) => {
    const z = stdDev > 0 ? Math.abs((d - mean) / stdDev) : 0;
    return z <= config.outlierZThreshold;
  });

  // Recalculate without outliers
  const filteredMean =
    filteredDeltas.length > 0
      ? filteredDeltas.reduce((a, b) => a + b, 0) / filteredDeltas.length
      : mean;
  const filteredVariance =
    filteredDeltas.length > 1
      ? filteredDeltas.reduce((sum, d) => sum + (d - filteredMean) ** 2, 0) / filteredDeltas.length
      : variance;
  const filteredStdDev = Math.sqrt(filteredVariance);

  return {
    expected: filteredMean,
    stdDev: filteredStdDev,
    hasBaseline: true,
    sampleSize: filteredDeltas.length,
  };
};

// ============================================
// GROWTH EVENT DETECTION
// ============================================

/**
 * Detect growth events where observed delta exceeds expected
 */
export const detectGrowthEvents = (artistId) => {
  const snapshots = getStoredSnapshots(artistId);
  const events = [];

  // Check artist followers
  const followerBaseline = calculateBaselineDelta(snapshots.artistSnapshots, 'followers');
  const followerDelta = calculateDelta(snapshots.artistSnapshots, 'followers', 24);

  if (followerBaseline.hasBaseline && followerDelta) {
    const threshold = followerBaseline.expected + followerBaseline.stdDev;
    if (followerDelta.delta > threshold) {
      events.push({
        id: `growth_followers_${Date.now()}`,
        artistId,
        trackId: null,
        metricType: 'followers',
        eventTime: followerDelta.toTime,
        observedDelta: followerDelta.delta,
        expectedDelta: followerBaseline.expected,
        liftDelta: Math.max(0, followerDelta.delta - followerBaseline.expected),
        stdDev: followerBaseline.stdDev,
      });
    }
  }

  // Check each track's popularity
  for (const [trackId, trackSnapshots] of Object.entries(snapshots.trackSnapshots)) {
    const trackBaseline = calculateBaselineDelta(trackSnapshots, 'popularity');
    const trackDelta = calculateDelta(trackSnapshots, 'popularity', 24);

    if (trackBaseline.hasBaseline && trackDelta) {
      const threshold = trackBaseline.expected + trackBaseline.stdDev;
      if (trackDelta.delta > threshold) {
        events.push({
          id: `growth_track_${trackId}_${Date.now()}`,
          artistId,
          trackId,
          metricType: 'track_popularity',
          eventTime: trackDelta.toTime,
          observedDelta: trackDelta.delta,
          expectedDelta: trackBaseline.expected,
          liftDelta: Math.max(0, trackDelta.delta - trackBaseline.expected),
          stdDev: trackBaseline.stdDev,
        });
      }
    }
  }

  return events;
};

// ============================================
// MOMENTUM SCORING
// ============================================

/**
 * Calculate Spotify Momentum Score (0-100)
 * Combines follower growth, track popularity changes, and trends
 */
export const calculateMomentumScore = (artistId) => {
  const snapshots = getStoredSnapshots(artistId);

  // Follower momentum (24h and 7d)
  const followerDelta24h = calculateDelta(snapshots.artistSnapshots, 'followers', 24);
  const followerDelta7d = calculateDelta(snapshots.artistSnapshots, 'followers', 168);

  // Track popularity momentum (average across all tracks)
  const trackPopularities = [];
  for (const [, trackSnapshots] of Object.entries(snapshots.trackSnapshots)) {
    const delta24h = calculateDelta(trackSnapshots, 'popularity', 24);
    if (delta24h) {
      trackPopularities.push(delta24h);
    }
  }

  // Calculate component scores
  let followerScore = 50; // Base score
  if (followerDelta24h) {
    // Normalize: +1000 followers/day = 100, -1000 = 0
    followerScore = Math.min(100, Math.max(0, 50 + followerDelta24h.delta / 20));
  }

  let trackScore = 50;
  if (trackPopularities.length > 0) {
    const avgDelta =
      trackPopularities.reduce((sum, t) => sum + t.delta, 0) / trackPopularities.length;
    // Normalize: +10 popularity points/day = 100, -10 = 0
    trackScore = Math.min(100, Math.max(0, 50 + avgDelta * 5));
  }

  let trendScore = 50;
  if (followerDelta7d && followerDelta24h) {
    // Compare 24h rate to 7d average rate
    const dailyRate7d = followerDelta7d.delta / 7;
    const accelerating = followerDelta24h.delta > dailyRate7d;
    trendScore = accelerating ? 70 : 30;
  }

  // Weighted combination
  const momentumScore = Math.round(followerScore * 0.35 + trackScore * 0.4 + trendScore * 0.25);

  return {
    overall: momentumScore,
    components: {
      followerScore,
      trackScore,
      trendScore,
    },
    deltas: {
      followers24h: followerDelta24h,
      followers7d: followerDelta7d,
      avgTrackPopularity24h:
        trackPopularities.length > 0
          ? trackPopularities.reduce((sum, t) => sum + t.delta, 0) / trackPopularities.length
          : 0,
    },
  };
};

// ============================================
// OVERVIEW DATA
// ============================================

/**
 * Get Spotify overview data for the analytics dashboard
 */
export const getSpotifyOverview = (artistId) => {
  const stored = getStoredSpotifyData(artistId);
  const snapshots = getStoredSnapshots(artistId);
  const attribution = getStoredAttribution(artistId);
  const momentum = calculateMomentumScore(artistId);

  // Get latest deltas
  const followerDelta24h = calculateDelta(snapshots.artistSnapshots, 'followers', 24);
  const followerDelta7d = calculateDelta(snapshots.artistSnapshots, 'followers', 168);

  // Get track momentum (average)
  const trackMomentum = [];
  for (const [trackId, trackSnapshots] of Object.entries(snapshots.trackSnapshots)) {
    const delta = calculateDelta(trackSnapshots, 'popularity', 24);
    if (delta) {
      const trackInfo = stored.tracks[trackId];
      trackMomentum.push({
        trackId,
        name: trackInfo?.name || 'Unknown Track',
        delta: delta.delta,
        percentChange: delta.percentChange,
        current: delta.current,
      });
    }
  }

  return {
    artist: stored.artist,
    followers: {
      current: followerDelta24h?.current || stored.artist?.followers?.total || 0,
      delta24h: followerDelta24h?.delta || 0,
      delta7d: followerDelta7d?.delta || 0,
      percentChange24h: followerDelta24h?.percentChange || 0,
      percentChange7d: followerDelta7d?.percentChange || 0,
    },
    tracks: trackMomentum.sort((a, b) => b.delta - a.delta),
    momentum,
    growthEvents: attribution.growthEvents || [],
    lastUpdated: stored.lastUpdated,
  };
};

/**
 * Get timeline data for Spotify chart overlay
 */
export const getSpotifyTimeline = (artistId, days = 30) => {
  const snapshots = getStoredSnapshots(artistId);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Get daily follower data
  const dailyData = {};

  for (const snapshot of snapshots.artistSnapshots) {
    const date = snapshot.capturedAt.split('T')[0];
    if (new Date(date) < cutoff) continue;

    if (!dailyData[date]) {
      dailyData[date] = {
        date,
        followers: snapshot.followers,
        popularity: snapshot.popularity,
        trackPopularities: {},
      };
    } else {
      // Take latest snapshot for the day
      dailyData[date].followers = snapshot.followers;
      dailyData[date].popularity = snapshot.popularity;
    }
  }

  // Add track data
  for (const [trackId, trackSnapshots] of Object.entries(snapshots.trackSnapshots)) {
    for (const snapshot of trackSnapshots) {
      const date = snapshot.capturedAt.split('T')[0];
      if (!dailyData[date]) continue;
      dailyData[date].trackPopularities[trackId] = snapshot.popularity;
    }
  }

  return Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date));
};

// ============================================
// CONFIGURATION
// ============================================

/**
 * Save Spotify configuration for an artist
 */
export const saveSpotifyConfig = (artistId, config) => {
  const stored = getStoredSpotifyData(artistId);
  stored.config = config;
  saveSpotifyData(artistId, stored);
};

/**
 * Get Spotify configuration for an artist
 */
export const getSpotifyConfig = (artistId) => {
  const stored = getStoredSpotifyData(artistId);
  return stored.config || null;
};

/**
 * Clear all Spotify data for an artist
 */
export const clearSpotifyData = (artistId) => {
  localStorage.removeItem(getStorageKey(artistId));
  localStorage.removeItem(getSnapshotsKey(artistId));
  localStorage.removeItem(getAttributionKey(artistId));
};

export default {
  getStoredSpotifyData,
  saveSpotifyData,
  getStoredSnapshots,
  saveSnapshots,
  getStoredAttribution,
  saveAttribution,
  fetchSpotifyArtist,
  fetchSpotifyTrack,
  fetchTracksByISRC,
  syncSpotifyData,
  calculateDelta,
  calculateBaselineDelta,
  detectGrowthEvents,
  calculateMomentumScore,
  getSpotifyOverview,
  getSpotifyTimeline,
  saveSpotifyConfig,
  getSpotifyConfig,
  clearSpotifyData,
  PLATFORM_WEIGHTS,
  ATTRIBUTION_CONFIG,
};
