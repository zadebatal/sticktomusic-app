/**
 * SpotifyComponents - Spotify Growth Attribution UI
 *
 * Components:
 * - SpotifyMomentumCard - Shows follower/track momentum with score
 * - GrowthDriversCard - Top posts likely driving Spotify growth
 * - TimelineOverlayChart - Content posts + Spotify growth curve
 * - ConfidenceBadge - Attribution confidence indicator
 * - SpotifyTab - Full Spotify analytics tab content
 * - SpotifySetupCard - Configuration for Spotify Artist ID
 *
 * IMPORTANT: Attribution is probabilistic, NOT causation.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getStoredAnalytics } from '../../services/analyticsService';
import { Button } from '../../ui/components/Button';
import {
  getSpotifyOverview,
  getSpotifyTimeline,
  syncSpotifyData,
  getSpotifyConfig,
  saveSpotifyConfig,
  calculateMomentumScore
} from '../../services/spotifyService';
import {
  computeAttribution,
  getTopGrowthDrivers,
  getVideoAttributionSummary,
  getSongAttributionSummary
} from '../../services/spotifyAttributionService';

// ============================================
// CONFIDENCE BADGE
// ============================================

export const ConfidenceBadge = ({ level, score }) => {
  const colors = {
    High: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
    Medium: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
    Low: { bg: 'rgba(107, 114, 128, 0.15)', text: '#9ca3af', border: 'rgba(107, 114, 128, 0.3)' },
    None: { bg: 'rgba(55, 65, 81, 0.15)', text: '#6b7280', border: 'rgba(55, 65, 81, 0.3)' }
  };

  const color = colors[level] || colors.None;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        backgroundColor: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: '600',
        color: color.text
      }}
      title={`Confidence Score: ${score || 0}/100`}
    >
      {level}
      {score !== undefined && <span style={{ opacity: 0.7 }}>({score})</span>}
    </span>
  );
};

// ============================================
// SPOTIFY MOMENTUM CARD
// ============================================

export const SpotifyMomentumCard = ({ artistId }) => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = () => {
      try {
        const overview = getSpotifyOverview(artistId);
        setData(overview);
      } catch (error) {
        console.error('Error loading Spotify momentum:', error);
      }
      setIsLoading(false);
    };
    loadData();
  }, [artistId]);

  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num?.toString() || '0';
  };

  const formatDelta = (num) => {
    if (!num) return '0';
    const sign = num >= 0 ? '+' : '';
    return sign + formatNumber(num);
  };

  if (isLoading) {
    return (
      <div style={styles.momentumCard}>
        <div style={styles.loadingPlaceholder}>Loading Spotify data...</div>
      </div>
    );
  }

  if (!data || !data.artist) {
    return (
      <div style={styles.momentumCard}>
        <div style={styles.cardHeader}>
          <span style={styles.spotifyIcon}>🎧</span>
          <span style={styles.cardTitleText}>Spotify Momentum</span>
        </div>
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>No Spotify data configured</p>
          <p style={styles.emptySubtext}>Connect Spotify in the Spotify tab to track momentum</p>
        </div>
      </div>
    );
  }

  const momentum = data.momentum || { overall: 0, components: {} };
  const followers = data.followers || {};

  // Momentum score color
  const getMomentumColor = (score) => {
    if (score >= 70) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div style={styles.momentumCard}>
      <div style={styles.cardHeader}>
        <span style={styles.spotifyIcon}>🎧</span>
        <span style={styles.cardTitleText}>Spotify Momentum</span>
      </div>

      <div style={styles.momentumGrid}>
        {/* Followers Delta */}
        <div style={styles.momentumStat}>
          <div style={styles.momentumStatLabel}>Followers</div>
          <div style={styles.momentumStatValue}>{formatNumber(followers.current)}</div>
          <div style={styles.momentumDeltas}>
            <span style={{
              ...styles.deltaChip,
              color: followers.delta24h >= 0 ? '#10b981' : '#ef4444'
            }}>
              24h: {formatDelta(followers.delta24h)}
            </span>
            <span style={{
              ...styles.deltaChip,
              color: followers.delta7d >= 0 ? '#10b981' : '#ef4444'
            }}>
              7d: {formatDelta(followers.delta7d)}
            </span>
          </div>
        </div>

        {/* Track Momentum */}
        <div style={styles.momentumStat}>
          <div style={styles.momentumStatLabel}>Track Momentum</div>
          <div style={styles.momentumStatValue}>
            {data.tracks && data.tracks.length > 0
              ? formatDelta(Math.round(data.tracks.reduce((sum, t) => sum + t.delta, 0) / data.tracks.length))
              : '—'
            }
          </div>
          <div style={styles.momentumSubtext}>
            avg popularity Δ (24h)
          </div>
        </div>

        {/* Momentum Score */}
        <div style={styles.momentumScoreContainer}>
          <div style={styles.momentumStatLabel}>Momentum Score</div>
          <div
            style={{
              ...styles.momentumScore,
              color: getMomentumColor(momentum.overall)
            }}
          >
            {momentum.overall}
          </div>
          <div style={styles.momentumScoreBar}>
            <div
              style={{
                ...styles.momentumScoreFill,
                width: `${momentum.overall}%`,
                backgroundColor: getMomentumColor(momentum.overall)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// GROWTH DRIVERS CARD
// ============================================

export const GrowthDriversCard = ({ artistId }) => {
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDrivers = () => {
      try {
        // Compute attribution if needed
        computeAttribution(artistId);
        const topDrivers = getTopGrowthDrivers(artistId, 5);
        setDrivers(topDrivers);
      } catch (error) {
        console.error('Error loading growth drivers:', error);
      }
      setIsLoading(false);
    };
    loadDrivers();
  }, [artistId]);

  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num?.toString() || '0';
  };

  const getPlatformIcon = (platform) => {
    const icons = {
      tiktok: '📱',
      instagram: '📸',
      youtube: '▶️',
      twitter: '🐦',
      facebook: '👤'
    };
    return icons[platform?.toLowerCase()] || '📱';
  };

  if (isLoading) {
    return (
      <div style={styles.growthDriversCard}>
        <div style={styles.loadingPlaceholder}>Calculating attribution...</div>
      </div>
    );
  }

  return (
    <div style={styles.growthDriversCard}>
      <div style={styles.cardHeader}>
        <span style={styles.cardTitleText}>🚀 Likely Growth Drivers</span>
        <span
          style={styles.infoTooltip}
          title="Attribution is probabilistic based on timing, engagement, and song match. Not causation."
        >
          ℹ️
        </span>
      </div>

      {drivers.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>No significant growth events detected</p>
          <p style={styles.emptySubtext}>Keep posting content to track Spotify impact</p>
        </div>
      ) : (
        <div style={styles.driversList}>
          {drivers.map((driver, i) => (
            <div key={driver.id || i} style={styles.driverRow}>
              <div style={styles.driverRank}>{i + 1}</div>
              <span style={styles.driverPlatform}>
                {getPlatformIcon(driver.platform)}
              </span>
              <div style={styles.driverInfo}>
                <span style={styles.driverName}>
                  {driver.name || driver.videoName || 'Unknown Post'}
                </span>
                <span style={styles.driverMeta}>
                  {driver.audioName ? `🎵 ${driver.audioName.slice(0, 20)}...` : 'No song linked'}
                </span>
              </div>
              <div style={styles.driverStats}>
                <span style={styles.driverContribution}>
                  {driver.totalContributionPct?.toFixed(1) || 0}%
                </span>
                <ConfidenceBadge
                  level={driver.avgConfidenceLabel || 'Low'}
                  score={driver.avgConfidence}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.attributionDisclaimer}>
        ⚠️ Attribution shows correlation, not proven causation
      </div>
    </div>
  );
};

// ============================================
// TIMELINE OVERLAY CHART
// ============================================

export const TimelineOverlayChart = ({ artistId, days = 30 }) => {
  const [timelineData, setTimelineData] = useState([]);
  const [contentPosts, setContentPosts] = useState([]);
  const [hoveredPoint, setHoveredPoint] = useState(null);

  useEffect(() => {
    const loadData = () => {
      try {
        const timeline = getSpotifyTimeline(artistId, days);
        setTimelineData(timeline);

        // Get content posts from per-artist analytics
        const analytics = getStoredAnalytics(artistId);
        const videos = Object.values(analytics.videos || {});
        setContentPosts(videos.filter(v => v.postedAt));
      } catch (error) {
        console.error('Error loading timeline:', error);
      }
    };
    loadData();
  }, [artistId, days]);

  if (timelineData.length === 0) {
    return (
      <div style={styles.timelineCard}>
        <h3 style={styles.cardTitle}>📈 Content × Spotify Timeline</h3>
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>Not enough data for timeline</p>
          <p style={styles.emptySubtext}>Sync Spotify data to see the correlation chart</p>
        </div>
      </div>
    );
  }

  // Calculate bounds for chart
  const followers = timelineData.map(d => d.followers || 0);
  const minFollowers = Math.min(...followers);
  const maxFollowers = Math.max(...followers);
  const range = maxFollowers - minFollowers || 1;

  // Find posts that fall within the timeline
  const timelineStart = new Date(timelineData[0]?.date);
  const timelineEnd = new Date(timelineData[timelineData.length - 1]?.date);

  const postsInRange = contentPosts.filter(post => {
    const postDate = new Date(post.postedAt);
    return postDate >= timelineStart && postDate <= timelineEnd;
  });

  // Calculate x position for a date
  const getXPosition = (dateStr) => {
    const date = new Date(dateStr);
    const totalDays = (timelineEnd - timelineStart) / (1000 * 60 * 60 * 24);
    const dayOffset = (date - timelineStart) / (1000 * 60 * 60 * 24);
    return (dayOffset / totalDays) * 100;
  };

  return (
    <div style={styles.timelineCard}>
      <h3 style={styles.cardTitle}>📈 Content × Spotify Timeline</h3>

      <div style={styles.timelineContainer}>
        {/* Y-axis labels */}
        <div style={styles.yAxisLabels}>
          <span>{(maxFollowers / 1000).toFixed(1)}K</span>
          <span>{((maxFollowers + minFollowers) / 2 / 1000).toFixed(1)}K</span>
          <span>{(minFollowers / 1000).toFixed(1)}K</span>
        </div>

        {/* Chart area */}
        <div style={styles.chartArea}>
          {/* Grid lines */}
          <div style={styles.gridLines}>
            {[0, 25, 50, 75, 100].map(pct => (
              <div key={pct} style={{ ...styles.gridLine, bottom: `${pct}%` }} />
            ))}
          </div>

          {/* Followers line */}
          <svg style={styles.lineSvg} viewBox={`0 0 100 100`} preserveAspectRatio="none">
            <path
              d={timelineData.map((d, i) => {
                const x = (i / (timelineData.length - 1)) * 100;
                const y = 100 - ((d.followers - minFollowers) / range) * 100;
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Content post markers */}
          {postsInRange.map((post, i) => {
            const xPos = getXPosition(post.postedAt);
            return (
              <div
                key={post.videoId || i}
                style={{
                  ...styles.postMarker,
                  left: `${xPos}%`
                }}
                onMouseEnter={() => setHoveredPoint(post)}
                onMouseLeave={() => setHoveredPoint(null)}
                title={`${post.videoName || 'Post'} - ${new Date(post.postedAt).toLocaleDateString()}`}
              >
                <div style={styles.postMarkerDot} />
                <div style={styles.postMarkerLine} />
              </div>
            );
          })}

          {/* Hover tooltip */}
          {hoveredPoint && (
            <div style={styles.chartTooltip}>
              <strong>{hoveredPoint.videoName || 'Post'}</strong>
              <br />
              <span style={{ color: '#6b7280' }}>
                {new Date(hoveredPoint.postedAt).toLocaleDateString()}
              </span>
              <br />
              <span>👁️ {hoveredPoint.views?.toLocaleString() || 0} views</span>
              <br />
              <span>🎵 {hoveredPoint.audioName?.slice(0, 25) || 'No song'}</span>
            </div>
          )}
        </div>
      </div>

      {/* X-axis labels */}
      <div style={styles.xAxisLabels}>
        {timelineData.filter((_, i) => i % Math.ceil(timelineData.length / 5) === 0).map((d, i) => (
          <span key={i}>{d.date?.slice(5) || ''}</span>
        ))}
      </div>

      {/* Legend */}
      <div style={styles.timelineLegend}>
        <span style={styles.legendItem}>
          <span style={{ ...styles.legendDot, backgroundColor: '#10b981' }} />
          Followers
        </span>
        <span style={styles.legendItem}>
          <span style={{ ...styles.legendDot, backgroundColor: '#8b5cf6' }} />
          Content Posts ({postsInRange.length})
        </span>
      </div>
    </div>
  );
};

// ============================================
// SPOTIFY SETUP CARD
// ============================================

export const SpotifySetupCard = ({ artistId, onConfigured }) => {
  const [spotifyArtistId, setSpotifyArtistId] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Load existing config
    const config = getSpotifyConfig(artistId);
    if (config?.spotifyArtistId) {
      setSpotifyArtistId(config.spotifyArtistId);
    }
  }, [artistId]);

  const handleValidate = async () => {
    if (!spotifyArtistId.trim()) return;

    setIsValidating(true);
    setValidationResult(null);

    try {
      // Call the validation endpoint
      const token = await getFirebaseToken();
      const params = new URLSearchParams({ action: 'validateArtist', spotifyArtistId: spotifyArtistId.trim() });
      const response = await fetch(
        `/api/spotify?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const result = await response.json();
      setValidationResult(result);
    } catch (error) {
      setValidationResult({ valid: false, error: error.message });
    }

    setIsValidating(false);
  };

  const handleSave = async () => {
    if (!validationResult?.valid) return;

    setIsSaving(true);
    try {
      const config = {
        spotifyArtistId: spotifyArtistId.trim(),
        artistName: validationResult.artist.name,
        configuredAt: new Date().toISOString()
      };

      saveSpotifyConfig(artistId, config);

      if (onConfigured) {
        onConfigured(config);
      }
    } catch (error) {
      console.error('Error saving Spotify config:', error);
    }
    setIsSaving(false);
  };

  return (
    <div style={styles.setupCard}>
      <div style={styles.cardHeader}>
        <span style={styles.spotifyIcon}>🎧</span>
        <span style={styles.cardTitleText}>Connect Spotify Artist</span>
      </div>

      <p style={styles.setupDescription}>
        Link your Spotify Artist ID to track follower growth and momentum.
        Find your Artist ID in your Spotify for Artists dashboard or artist URL.
      </p>

      <div style={styles.setupInputRow}>
        <input
          type="text"
          value={spotifyArtistId}
          onChange={(e) => setSpotifyArtistId(e.target.value)}
          placeholder="e.g., 0OdUWJ0sBjDrqHygGUXeCF"
          style={styles.setupInput}
        />
        <Button variant="neutral-secondary" onClick={handleValidate} disabled={isValidating || !spotifyArtistId.trim()} loading={isValidating}>
          {isValidating ? 'Checking...' : 'Validate'}
        </Button>
      </div>

      {validationResult && (
        <div style={{
          ...styles.validationResult,
          backgroundColor: validationResult.valid
            ? 'rgba(16, 185, 129, 0.1)'
            : 'rgba(239, 68, 68, 0.1)',
          borderColor: validationResult.valid
            ? 'rgba(16, 185, 129, 0.3)'
            : 'rgba(239, 68, 68, 0.3)'
        }}>
          {validationResult.valid ? (
            <>
              <div style={styles.validatedArtist}>
                {validationResult.artist.images?.[0] && /^https?:\/\//.test(validationResult.artist.images[0].url) && (
                  <img
                    src={validationResult.artist.images[0].url}
                    alt=""
                    style={styles.artistImage}
                  />
                )}
                <div>
                  <strong>{validationResult.artist.name}</strong>
                  <br />
                  <span style={{ color: '#6b7280', fontSize: '12px' }}>
                    {validationResult.artist.followers?.toLocaleString()} followers
                    {' • '}
                    Popularity: {validationResult.artist.popularity}
                  </span>
                </div>
              </div>
              <Button variant="brand-primary" onClick={handleSave} disabled={isSaving} loading={isSaving}>
                {isSaving ? 'Saving...' : 'Save & Connect'}
              </Button>
            </>
          ) : (
            <span style={{ color: '#ef4444' }}>
              ❌ {validationResult.error || 'Invalid Artist ID'}
            </span>
          )}
        </div>
      )}

      <div style={styles.helpText}>
        <strong>How to find your Spotify Artist ID:</strong>
        <ol style={styles.helpList}>
          <li>Go to your artist page on Spotify</li>
          <li>Copy the URL (e.g., spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF)</li>
          <li>The ID is the code after /artist/</li>
        </ol>
      </div>
    </div>
  );
};

// Helper to get Firebase token
const getFirebaseToken = async () => {
  const { getAuth } = await import('firebase/auth');
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
};

// ============================================
// SPOTIFY TAB
// ============================================

export const SpotifyTab = ({ artistId }) => {
  const [isConfigured, setIsConfigured] = useState(false);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState(null);
  const [videoAttributions, setVideoAttributions] = useState([]);
  const [songAttributions, setSongAttributions] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  useEffect(() => {
    const loadConfig = () => {
      const stored = getSpotifyConfig(artistId);
      if (stored?.spotifyArtistId) {
        setIsConfigured(true);
        setConfig(stored);
        loadData();
      }
    };
    loadConfig();
  }, [artistId]);

  const loadData = () => {
    try {
      const overviewData = getSpotifyOverview(artistId);
      setOverview(overviewData);
      setLastSync(overviewData.lastUpdated);

      // Load attribution data
      computeAttribution(artistId);
      const videoAttrs = getVideoAttributionSummary(artistId);
      const songAttrs = getSongAttributionSummary(artistId);
      setVideoAttributions(videoAttrs);
      setSongAttributions(songAttrs);
    } catch (error) {
      console.error('Error loading Spotify data:', error);
    }
  };

  const handleSync = async () => {
    if (!config) return;

    setIsSyncing(true);
    try {
      await syncSpotifyData(artistId, config);
      loadData();
    } catch (error) {
      console.error('Error syncing Spotify data:', error);
    }
    setIsSyncing(false);
  };

  const handleConfigured = (newConfig) => {
    setConfig(newConfig);
    setIsConfigured(true);
  };

  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num?.toString() || '0';
  };

  if (!isConfigured) {
    return (
      <div style={styles.spotifyTab}>
        <SpotifySetupCard artistId={artistId} onConfigured={handleConfigured} />
      </div>
    );
  }

  return (
    <div style={styles.spotifyTab}>
      {/* Header with sync button */}
      <div style={styles.spotifyHeader}>
        <div>
          <h2 style={styles.spotifyTitle}>
            🎧 {config?.artistName || 'Spotify Analytics'}
          </h2>
          <span style={styles.lastSyncText}>
            Last synced: {lastSync ? new Date(lastSync).toLocaleString() : 'Never'}
          </span>
        </div>
        <Button variant="neutral-secondary" onClick={handleSync} disabled={isSyncing} loading={isSyncing}>
          {isSyncing ? 'Syncing...' : 'Sync Spotify Data'}
        </Button>
      </div>

      {/* Overview Stats */}
      <div style={styles.spotifyStatsGrid}>
        <div style={styles.spotifyStat}>
          <div style={styles.spotifyStatIcon}>👥</div>
          <div style={styles.spotifyStatValue}>
            {formatNumber(overview?.followers?.current || 0)}
          </div>
          <div style={styles.spotifyStatLabel}>Followers</div>
          <div style={{
            ...styles.spotifyStatDelta,
            color: (overview?.followers?.delta7d || 0) >= 0 ? '#10b981' : '#ef4444'
          }}>
            {(overview?.followers?.delta7d || 0) >= 0 ? '+' : ''}
            {formatNumber(overview?.followers?.delta7d || 0)} (7d)
          </div>
        </div>

        <div style={styles.spotifyStat}>
          <div style={styles.spotifyStatIcon}>🎯</div>
          <div style={styles.spotifyStatValue}>
            {overview?.momentum?.overall || 0}
          </div>
          <div style={styles.spotifyStatLabel}>Momentum Score</div>
          <div style={styles.spotifyStatDelta}>
            0-100 scale
          </div>
        </div>

        <div style={styles.spotifyStat}>
          <div style={styles.spotifyStatIcon}>🎵</div>
          <div style={styles.spotifyStatValue}>
            {overview?.tracks?.length || 0}
          </div>
          <div style={styles.spotifyStatLabel}>Tracked Tracks</div>
          <div style={styles.spotifyStatDelta}>
            with momentum data
          </div>
        </div>

        <div style={styles.spotifyStat}>
          <div style={styles.spotifyStatIcon}>📈</div>
          <div style={styles.spotifyStatValue}>
            {overview?.growthEvents?.length || 0}
          </div>
          <div style={styles.spotifyStatLabel}>Growth Events</div>
          <div style={styles.spotifyStatDelta}>
            detected this period
          </div>
        </div>
      </div>

      {/* Timeline Chart */}
      <TimelineOverlayChart artistId={artistId} days={30} />

      {/* Growth Drivers */}
      <GrowthDriversCard artistId={artistId} />

      {/* Attribution by Track */}
      {songAttributions.length > 0 && (
        <div style={styles.attributionSection}>
          <h3 style={styles.sectionTitle}>🎵 Song Attribution Summary</h3>
          <div style={styles.songAttributionGrid}>
            {songAttributions.slice(0, 6).map((song, i) => (
              <div key={song.audioId || i} style={styles.songAttrCard}>
                <div style={styles.songAttrHeader}>
                  <span style={styles.songAttrRank}>#{i + 1}</span>
                  <span style={styles.songAttrMomentum}>
                    {song.momentumScore !== null ? `${song.momentumScore} momentum` : '—'}
                  </span>
                </div>
                <h4 style={styles.songAttrName}>{song.audioName}</h4>
                <div style={styles.songAttrStats}>
                  <span>{formatNumber(song.totalViews)} views</span>
                  <span>•</span>
                  <span>{song.videoCount} videos</span>
                </div>
                <div style={styles.songAttrLift}>
                  Attributed Lift: <strong>+{song.totalAttributedLift.toFixed(1)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attribution by Video */}
      {videoAttributions.length > 0 && (
        <div style={styles.attributionSection}>
          <h3 style={styles.sectionTitle}>🎬 Video Attribution</h3>
          <div style={styles.attrTable}>
            <div style={styles.attrTableHeader}>
              <span style={{ ...styles.attrTableCell, flex: 2 }}>Video</span>
              <span style={styles.attrTableCell}>Song</span>
              <span style={styles.attrTableCell}>Platform</span>
              <span style={styles.attrTableCell}>Spotify Lift</span>
              <span style={styles.attrTableCell}>Contribution</span>
              <span style={styles.attrTableCell}>Confidence</span>
              <span style={styles.attrTableCell}>Time to Impact</span>
            </div>
            {videoAttributions.slice(0, 10).map((video, i) => (
              <div key={video.videoId || i} style={styles.attrTableRow}>
                <span style={{ ...styles.attrTableCell, flex: 2, fontWeight: '500' }}>
                  {video.videoName}
                </span>
                <span style={styles.attrTableCell}>
                  {video.audioName?.slice(0, 15) || '—'}...
                </span>
                <span style={styles.attrTableCell}>
                  {video.platform}
                </span>
                <span style={{
                  ...styles.attrTableCell,
                  color: video.spotifyLift7d > 0 ? '#10b981' : '#6b7280'
                }}>
                  {video.spotifyLift7d > 0 ? '+' : ''}{video.spotifyLift7d.toFixed(1)}
                </span>
                <span style={styles.attrTableCell}>
                  {video.contributionPct.toFixed(1)}%
                </span>
                <span style={styles.attrTableCell}>
                  <ConfidenceBadge
                    level={video.confidenceLabel}
                    score={video.confidenceScore}
                  />
                </span>
                <span style={styles.attrTableCell}>
                  {video.timeToImpact ? `${video.timeToImpact}h` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div style={styles.fullDisclaimer}>
        <strong>⚠️ Attribution Methodology</strong>
        <p>
          Attribution scores are calculated using engagement quality, timing correlation,
          song matching, and platform weights. Results show probabilistic correlation,
          not proven causation. Confidence levels (High/Medium/Low) reflect the strength
          of the correlation signal. Use these insights directionally, not as absolute metrics.
        </p>
      </div>
    </div>
  );
};

// ============================================
// STYLES
// ============================================

const styles = {
  // Momentum Card
  momentumCard: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '20px'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px'
  },
  spotifyIcon: {
    fontSize: '20px'
  },
  cardTitleText: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff'
  },
  infoTooltip: {
    marginLeft: 'auto',
    cursor: 'help',
    opacity: 0.6
  },
  momentumGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px'
  },
  momentumStat: {
    textAlign: 'center'
  },
  momentumStatLabel: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '4px'
  },
  momentumStatValue: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#fff',
    marginBottom: '4px'
  },
  momentumDeltas: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center'
  },
  deltaChip: {
    fontSize: '11px',
    fontWeight: '600'
  },
  momentumSubtext: {
    fontSize: '11px',
    color: '#6b7280'
  },
  momentumScoreContainer: {
    textAlign: 'center'
  },
  momentumScore: {
    fontSize: '36px',
    fontWeight: '700',
    marginBottom: '8px'
  },
  momentumScoreBar: {
    height: '6px',
    backgroundColor: '#1f1f2e',
    borderRadius: '3px',
    overflow: 'hidden'
  },
  momentumScoreFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s'
  },

  // Growth Drivers Card
  growthDriversCard: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '20px'
  },
  driversList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  driverRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px'
  },
  driverRank: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: '#1f1f2e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '600',
    color: '#9ca3af'
  },
  driverPlatform: {
    fontSize: '18px'
  },
  driverInfo: {
    flex: 1,
    minWidth: 0
  },
  driverName: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '500',
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  driverMeta: {
    fontSize: '11px',
    color: '#6b7280'
  },
  driverStats: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  driverContribution: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#10b981'
  },
  attributionDisclaimer: {
    marginTop: '12px',
    padding: '8px 12px',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: '6px',
    fontSize: '11px',
    color: '#f59e0b',
    textAlign: 'center'
  },

  // Timeline Chart
  timelineCard: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '24px'
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 16px 0'
  },
  timelineContainer: {
    display: 'flex',
    height: '200px',
    position: 'relative'
  },
  yAxisLabels: {
    width: '50px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#6b7280',
    paddingRight: '8px',
    textAlign: 'right'
  },
  chartArea: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  gridLines: {
    position: 'absolute',
    inset: 0
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '1px',
    backgroundColor: '#1f1f2e'
  },
  lineSvg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%'
  },
  postMarker: {
    position: 'absolute',
    bottom: 0,
    transform: 'translateX(-50%)',
    cursor: 'pointer',
    zIndex: 10
  },
  postMarkerDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#8b5cf6',
    border: '2px solid #111118'
  },
  postMarkerLine: {
    width: '2px',
    height: '100%',
    backgroundColor: 'rgba(139, 92, 246, 0.3)',
    position: 'absolute',
    bottom: '8px',
    left: '50%',
    transform: 'translateX(-50%)'
  },
  chartTooltip: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '12px',
    color: '#fff',
    zIndex: 20,
    maxWidth: '200px'
  },
  xAxisLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '8px',
    marginLeft: '50px',
    fontSize: '10px',
    color: '#6b7280'
  },
  timelineLegend: {
    display: 'flex',
    gap: '20px',
    justifyContent: 'center',
    marginTop: '12px'
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#9ca3af'
  },
  legendDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },

  // Setup Card
  setupCard: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '600px'
  },
  setupDescription: {
    fontSize: '14px',
    color: '#9ca3af',
    marginBottom: '20px',
    lineHeight: '1.5'
  },
  setupInputRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px'
  },
  setupInput: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: '#0a0a0f',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none'
  },
  validationResult: {
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid',
    marginBottom: '16px'
  },
  validatedArtist: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px'
  },
  artistImage: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    objectFit: 'cover'
  },
  helpText: {
    marginTop: '20px',
    padding: '16px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#9ca3af'
  },
  helpList: {
    marginLeft: '20px',
    marginTop: '8px',
    lineHeight: '1.8'
  },

  // Spotify Tab
  spotifyTab: {
    padding: '16px 0'
  },
  spotifyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  spotifyTitle: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#fff',
    margin: 0
  },
  lastSyncText: {
    fontSize: '12px',
    color: '#6b7280'
  },
  spotifyStatsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
    marginBottom: '24px'
  },
  spotifyStat: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'center'
  },
  spotifyStatIcon: {
    fontSize: '24px',
    marginBottom: '8px'
  },
  spotifyStatValue: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#fff',
    marginBottom: '4px'
  },
  spotifyStatLabel: {
    fontSize: '13px',
    color: '#6b7280',
    marginBottom: '4px'
  },
  spotifyStatDelta: {
    fontSize: '12px',
    color: '#9ca3af'
  },

  // Attribution Section
  attributionSection: {
    marginTop: '24px'
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
    marginBottom: '16px'
  },
  songAttributionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px'
  },
  songAttrCard: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '16px'
  },
  songAttrHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px'
  },
  songAttrRank: {
    fontSize: '12px',
    color: '#6b7280',
    fontWeight: '600'
  },
  songAttrMomentum: {
    fontSize: '11px',
    color: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    padding: '2px 8px',
    borderRadius: '4px'
  },
  songAttrName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 8px 0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songAttrStats: {
    display: 'flex',
    gap: '8px',
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '12px'
  },
  songAttrLift: {
    fontSize: '13px',
    color: '#10b981',
    padding: '8px 12px',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: '6px',
    textAlign: 'center'
  },

  // Attribution Table
  attrTable: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    overflow: 'hidden'
  },
  attrTableHeader: {
    display: 'flex',
    padding: '12px 16px',
    borderBottom: '1px solid #1f1f2e',
    fontSize: '11px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  attrTableRow: {
    display: 'flex',
    padding: '12px 16px',
    borderBottom: '1px solid #1f1f2e',
    fontSize: '13px',
    color: '#e5e7eb',
    alignItems: 'center'
  },
  attrTableCell: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  // Full Disclaimer
  fullDisclaimer: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.2)',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#f59e0b'
  },

  // Empty & Loading States
  loadingPlaceholder: {
    padding: '32px',
    textAlign: 'center',
    color: '#6b7280'
  },
  emptyState: {
    padding: '24px',
    textAlign: 'center'
  },
  emptyText: {
    fontSize: '14px',
    color: '#9ca3af',
    margin: '0 0 4px 0'
  },
  emptySubtext: {
    fontSize: '12px',
    color: '#6b7280',
    margin: 0
  }
};

export default {
  ConfidenceBadge,
  SpotifyMomentumCard,
  GrowthDriversCard,
  TimelineOverlayChart,
  SpotifySetupCard,
  SpotifyTab
};
