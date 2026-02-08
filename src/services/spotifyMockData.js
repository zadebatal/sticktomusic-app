/**
 * Spotify Mock Data Generator
 *
 * Generates realistic mock data for Spotify growth attribution
 * Use this to populate the dashboard with demo data before real API integration
 *
 * Usage:
 *   import { seedSpotifyMockData } from './spotifyMockData';
 *   seedSpotifyMockData('artist_123');
 */

import {
  saveSpotifyData,
  saveSnapshots,
  saveAttribution,
  saveSpotifyConfig
} from './spotifyService';
import { saveAnalytics } from './analyticsService';
import log from '../utils/logger';

/**
 * Generate realistic follower growth with some variation
 */
const generateFollowerGrowth = (startFollowers, days, dailyGrowthRate = 0.005) => {
  const snapshots = [];
  let followers = startFollowers;

  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    // Add daily variation (±50%)
    const variation = 0.5 + Math.random();
    const dailyGrowth = Math.floor(followers * dailyGrowthRate * variation);

    // Occasionally add growth spikes (5% chance)
    const spike = Math.random() < 0.05 ? Math.floor(followers * 0.02) : 0;

    followers += dailyGrowth + spike;

    // Create 4 snapshots per day (every 6 hours)
    for (let h = 0; h < 24; h += 6) {
      const snapDate = new Date(date);
      snapDate.setHours(h, 0, 0, 0);

      snapshots.push({
        id: `artist_snap_${snapDate.getTime()}`,
        artistId: 'demo',
        capturedAt: snapDate.toISOString(),
        followers: followers + Math.floor(Math.random() * dailyGrowth / 4),
        popularity: 45 + Math.floor(Math.random() * 20),
        monthlyListeners: followers * 3 + Math.floor(Math.random() * 10000)
      });
    }
  }

  return snapshots;
};

/**
 * Generate track popularity snapshots
 */
const generateTrackSnapshots = (trackId, days, basePopularity = 40) => {
  const snapshots = [];
  let popularity = basePopularity;

  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    // Popularity varies ±5 points
    popularity = Math.max(0, Math.min(100, popularity + Math.floor(Math.random() * 10) - 5));

    // Occasional popularity spike
    if (Math.random() < 0.08) {
      popularity = Math.min(100, popularity + 5 + Math.floor(Math.random() * 10));
    }

    for (let h = 0; h < 24; h += 6) {
      const snapDate = new Date(date);
      snapDate.setHours(h, 0, 0, 0);

      snapshots.push({
        id: `track_snap_${trackId}_${snapDate.getTime()}`,
        trackId,
        capturedAt: snapDate.toISOString(),
        popularity: popularity + Math.floor(Math.random() * 3) - 1
      });
    }
  }

  return snapshots;
};

/**
 * Generate mock content posts
 */
const generateMockPosts = () => {
  const platforms = ['tiktok', 'tiktok', 'tiktok', 'instagram', 'youtube'];
  const categories = ['fashion', 'lifestyle', 'edm', 'runway', 'fitness'];
  const handles = ['@mainaccount', '@altaccount', '@brandaccount'];
  const songs = [
    { id: 'audio_droptop', name: 'Pertinence - DROP TOP BEATER' },
    { id: 'audio_stay', name: 'STAY 4.2.2' },
    { id: 'audio_audit', name: 'AUDIT lastverse' },
    { id: 'audio_midnight', name: 'Midnight Drive' },
    { id: 'audio_summer', name: 'Summer Nights' }
  ];

  const posts = {};
  const now = new Date();

  // Generate 20 posts over the last 30 days
  for (let i = 1; i <= 20; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const postDate = new Date(now);
    postDate.setDate(postDate.getDate() - daysAgo);
    postDate.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), 0, 0);

    const platform = platforms[Math.floor(Math.random() * platforms.length)];
    const song = songs[Math.floor(Math.random() * songs.length)];
    const category = categories[Math.floor(Math.random() * categories.length)];

    // Higher views for TikTok, vary by recency
    const baseViews = platform === 'tiktok' ? 50000 : 20000;
    const views = Math.floor(baseViews * (0.5 + Math.random()) * (1 + (30 - daysAgo) / 30));

    const engagementRate = 4 + Math.random() * 8;
    const likes = Math.floor(views * (engagementRate / 100) * 0.8);
    const comments = Math.floor(views * (engagementRate / 100) * 0.1);
    const shares = Math.floor(views * (engagementRate / 100) * 0.1);

    posts[`video_${i}`] = {
      videoId: `video_${i}`,
      videoName: `${category.charAt(0).toUpperCase() + category.slice(1)} Vibes #${i}`,
      audioId: song.id,
      audioName: song.name,
      categoryId: `cat_${category}`,
      categoryName: category.charAt(0).toUpperCase() + category.slice(1),
      handle: handles[Math.floor(Math.random() * handles.length)],
      platform,
      views,
      likes,
      comments,
      shares,
      engagementRate: parseFloat(engagementRate.toFixed(1)),
      postedAt: postDate.toISOString(),
      latePostId: `late_${i}`,
      updatedAt: new Date().toISOString()
    };
  }

  return posts;
};

/**
 * Generate mock growth events
 */
const generateGrowthEvents = (artistId) => {
  const events = [];
  const now = new Date();

  // Generate 3-5 growth events in the last 2 weeks
  const numEvents = 3 + Math.floor(Math.random() * 3);

  for (let i = 0; i < numEvents; i++) {
    const daysAgo = Math.floor(Math.random() * 14);
    const eventDate = new Date(now);
    eventDate.setDate(eventDate.getDate() - daysAgo);

    const isTrackEvent = Math.random() > 0.5;
    const observedDelta = 100 + Math.floor(Math.random() * 400);
    const expectedDelta = 50 + Math.floor(Math.random() * 100);

    events.push({
      id: `growth_${Date.now()}_${i}`,
      artistId,
      trackId: isTrackEvent ? `spotify_track_${1 + Math.floor(Math.random() * 3)}` : null,
      metricType: isTrackEvent ? 'track_popularity' : 'followers',
      eventTime: eventDate.toISOString(),
      observedDelta,
      expectedDelta,
      liftDelta: Math.max(0, observedDelta - expectedDelta),
      stdDev: 30 + Math.floor(Math.random() * 20)
    });
  }

  return events.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));
};

/**
 * Generate mock post attributions
 */
const generatePostAttributions = (growthEvents, posts) => {
  const attributions = [];
  const postList = Object.values(posts);

  for (const event of growthEvents) {
    // Get posts within 96h before event
    const eventTime = new Date(event.eventTime);
    const windowStart = new Date(eventTime.getTime() - 96 * 60 * 60 * 1000);

    const candidatePosts = postList.filter(p => {
      const postTime = new Date(p.postedAt);
      return postTime >= windowStart && postTime <= eventTime;
    });

    if (candidatePosts.length === 0) continue;

    // Calculate relevance scores
    let totalRelevance = 0;
    const postRelevances = candidatePosts.map(post => {
      const hoursBetween = (eventTime - new Date(post.postedAt)) / (1000 * 60 * 60);
      const timeDecay = Math.exp(-hoursBetween / 36);
      const platformWeight = post.platform === 'tiktok' ? 1.0 : 0.8;
      const engagementQuality = Math.min(1, post.engagementRate / 10);

      const relevance = timeDecay * platformWeight * engagementQuality * (0.5 + Math.random() * 0.5);
      totalRelevance += relevance;

      return { post, relevance, timeDecay, engagementQuality };
    });

    // Create attributions
    for (const { post, relevance, timeDecay, engagementQuality } of postRelevances) {
      const contributionPct = (relevance / totalRelevance) * 100;
      const attributedLift = event.liftDelta * (relevance / totalRelevance);
      const hoursBetween = Math.round((eventTime - new Date(post.postedAt)) / (1000 * 60 * 60));

      // Calculate confidence
      let confidence = 100 * (0.45 * (attributedLift / event.liftDelta) + 0.25 * engagementQuality + 0.20 * timeDecay + 0.10);
      if (candidatePosts.length > 3) confidence *= 0.85;
      confidence = Math.min(100, Math.max(0, confidence));

      const confidenceLabel = confidence >= 70 ? 'High' : confidence >= 45 ? 'Medium' : 'Low';

      attributions.push({
        id: `attr_${event.id}_${post.videoId}`,
        growthEventId: event.id,
        postId: post.videoId,
        post: {
          id: post.videoId,
          name: post.videoName,
          platform: post.platform,
          handle: post.handle,
          audioId: post.audioId,
          audioName: post.audioName,
          postedAt: post.postedAt,
          views: post.views,
          likes: post.likes,
          engagementRate: post.engagementRate
        },
        relevanceScore: relevance,
        contributionPct: parseFloat(contributionPct.toFixed(1)),
        attributedLift: parseFloat(attributedLift.toFixed(2)),
        confidenceScore: Math.round(confidence),
        confidenceLabel,
        components: {
          engagementQuality: parseFloat(engagementQuality.toFixed(2)),
          timeDecay: parseFloat(timeDecay.toFixed(2)),
          songMatch: Math.random() > 0.5 ? 1.0 : 0.65,
          platformWeight: post.platform === 'tiktok' ? 1.0 : 0.8
        },
        timeToImpact: hoursBetween
      });
    }
  }

  return attributions.sort((a, b) => b.contributionPct - a.contributionPct);
};

/**
 * Seed all Spotify mock data for an artist
 */
export const seedSpotifyMockData = (artistId = 'demo_artist') => {
  log('🎵 Seeding Spotify mock data for artist:', artistId);

  // 1. Save Spotify config
  const config = {
    spotifyArtistId: '0OdUWJ0sBjDrqHygGUXeCF',
    artistName: 'Demo Artist',
    configuredAt: new Date().toISOString()
  };
  saveSpotifyConfig(artistId, config);

  // 2. Save artist data
  const spotifyData = {
    artist: {
      id: '0OdUWJ0sBjDrqHygGUXeCF',
      name: 'Demo Artist',
      followers: { total: 125000 },
      popularity: 62,
      genres: ['pop', 'electronic'],
      images: [{ url: 'https://via.placeholder.com/300', width: 300, height: 300 }]
    },
    tracks: {
      'spotify_track_1': {
        id: 'spotify_track_1',
        name: 'DROP TOP BEATER',
        popularity: 58,
        album: { name: 'Summer EP' }
      },
      'spotify_track_2': {
        id: 'spotify_track_2',
        name: 'STAY 4.2.2',
        popularity: 45,
        album: { name: 'Summer EP' }
      },
      'spotify_track_3': {
        id: 'spotify_track_3',
        name: 'AUDIT lastverse',
        popularity: 52,
        album: { name: 'Winter Collection' }
      }
    },
    config
  };
  saveSpotifyData(artistId, spotifyData);

  // 3. Generate and save snapshots
  const artistSnapshots = generateFollowerGrowth(120000, 30);
  const trackSnapshots = {
    'spotify_track_1': generateTrackSnapshots('spotify_track_1', 30, 55),
    'spotify_track_2': generateTrackSnapshots('spotify_track_2', 30, 42),
    'spotify_track_3': generateTrackSnapshots('spotify_track_3', 30, 50)
  };

  saveSnapshots(artistId, { artistSnapshots, trackSnapshots });

  // 4. Generate and save content posts (to analyticsService)
  const mockPosts = generateMockPosts();
  const snapshots = [];
  const now = new Date();

  // Generate daily snapshots for analytics
  for (let i = 30; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const postsUpToDate = Object.values(mockPosts).filter(p =>
      new Date(p.postedAt).toISOString().split('T')[0] <= dateStr
    );

    const totalViews = postsUpToDate.reduce((sum, p) => sum + p.views, 0);
    const totalLikes = postsUpToDate.reduce((sum, p) => sum + p.likes, 0);

    snapshots.push({
      date: dateStr,
      totalViews,
      totalLikes,
      totalComments: Math.floor(totalLikes * 0.1),
      totalShares: Math.floor(totalLikes * 0.15),
      avgEngagement: 6.5 + Math.sin(i / 5) * 1.5,
      videoCount: postsUpToDate.length
    });
  }

  saveAnalytics({ videos: mockPosts, snapshots });

  // 5. Generate and save growth events and attributions
  const growthEvents = generateGrowthEvents(artistId);
  const postAttributions = generatePostAttributions(growthEvents, mockPosts);

  saveAttribution(artistId, { growthEvents, postAttributions });

  log('✅ Mock data seeded successfully!');
  log(`   - ${artistSnapshots.length} artist snapshots`);
  log(`   - ${Object.keys(trackSnapshots).length} tracks with snapshots`);
  log(`   - ${Object.keys(mockPosts).length} content posts`);
  log(`   - ${growthEvents.length} growth events`);
  log(`   - ${postAttributions.length} post attributions`);

  return {
    artistId,
    config,
    spotifyData,
    snapshots: { artistSnapshots, trackSnapshots },
    posts: mockPosts,
    growthEvents,
    postAttributions
  };
};

/**
 * Clear all Spotify mock data
 */
export const clearSpotifyMockData = (artistId = 'demo_artist') => {
  localStorage.removeItem(`stm_spotify_${artistId}`);
  localStorage.removeItem(`stm_spotify_snapshots_${artistId}`);
  localStorage.removeItem(`stm_spotify_attribution_${artistId}`);
  localStorage.removeItem('stm_analytics');
  localStorage.removeItem('stm_analytics_last_sync');
  log('🗑️ Mock data cleared');
};

export default {
  seedSpotifyMockData,
  clearSpotifyMockData
};
