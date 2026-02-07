import React, { useState, useEffect, useCallback } from 'react';
import {
  getStoredAnalytics,
  calculateTotalStats,
  getTopVideos,
  getSongPerformance,
  getCategoryPerformance,
  getAccountPerformance,
  getTimeSeriesData,
  getSongAnalytics,
  needsSync,
  addMockData
} from '../../services/analyticsService';
import {
  SpotifyMomentumCard,
  GrowthDriversCard,
  TimelineOverlayChart,
  SpotifyTab,
  ConfidenceBadge
} from './SpotifyComponents';
import {
  getVideoAttributionSummary,
  getSongAttributionSummary,
  computeAttribution
} from '../../services/spotifyAttributionService';

/**
 * AnalyticsDashboard - Main analytics view
 *
 * Features:
 * - Overview cards (total views, likes, comments, engagement)
 * - Performance over time chart
 * - Top performing songs leaderboard
 * - Category performance rollup
 * - Account comparison
 * - Top performing videos table
 * - Song detail view
 */

const AnalyticsDashboard = ({
  lateAccessToken,
  onClose,
  artistId: initialArtistId = null,
  artists = [],
  onArtistChange = null,
  onSyncLate = null,
  latePosts = []
}) => {
  // Mobile responsive detection
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Current artist (for multi-artist support)
  const [currentArtistId, setCurrentArtistId] = useState(initialArtistId);

  // Data state
  const [analytics, setAnalytics] = useState(null);
  const [totalStats, setTotalStats] = useState(null);
  const [topVideos, setTopVideos] = useState([]);
  const [songPerformance, setSongPerformance] = useState([]);
  const [categoryPerformance, setCategoryPerformance] = useState([]);
  const [accountPerformance, setAccountPerformance] = useState([]);
  const [timeSeriesData, setTimeSeriesData] = useState([]);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedSong, setSelectedSong] = useState(null);
  const [chartPeriod, setChartPeriod] = useState('daily');
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'songs' | 'videos' | 'spotify'
  const [videoAttributions, setVideoAttributions] = useState([]);
  const [songAttributions, setSongAttributions] = useState([]);

  // Handle artist change
  const handleArtistChange = (newArtistId) => {
    setCurrentArtistId(newArtistId);
    setIsLoading(true);
    if (onArtistChange) {
      onArtistChange(newArtistId);
    }
  };

  // Current artist name for display
  const currentArtistName = artists.find(a => a.id === currentArtistId)?.name || 'All Artists';

  // Load analytics data
  const loadAnalytics = useCallback(() => {
    const stored = getStoredAnalytics();

    // If no data, add mock data for demo
    if (Object.keys(stored.videos).length === 0) {
      const mockData = addMockData();
      setAnalytics(mockData);
      setTotalStats(calculateTotalStats(mockData.videos));
      setTopVideos(getTopVideos(10));
      setSongPerformance(getSongPerformance());
      setCategoryPerformance(getCategoryPerformance());
      setAccountPerformance(getAccountPerformance());
      setTimeSeriesData(getTimeSeriesData(chartPeriod, 30));
    } else {
      setAnalytics(stored);
      setTotalStats(calculateTotalStats(stored.videos));
      setTopVideos(getTopVideos(10));
      setSongPerformance(getSongPerformance());
      setCategoryPerformance(getCategoryPerformance());
      setAccountPerformance(getAccountPerformance());
      setTimeSeriesData(getTimeSeriesData(chartPeriod, 30));
    }

    // Load Spotify attribution data
    try {
      if (currentArtistId) {
        computeAttribution(currentArtistId);
        setVideoAttributions(getVideoAttributionSummary(currentArtistId));
        setSongAttributions(getSongAttributionSummary(currentArtistId));
      }
    } catch (error) {
      console.error('Error loading attribution data:', error);
    }

    setLastUpdated(stored.lastUpdated);
    setIsLoading(false);
  }, [chartPeriod, currentArtistId]);

  // Initial load
  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Update time series when period changes
  useEffect(() => {
    setTimeSeriesData(getTimeSeriesData(chartPeriod, 30));
  }, [chartPeriod]);

  // Sync with Late API
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      if (onSyncLate) {
        const result = await onSyncLate();
        console.log('📊 Analytics sync result:', result);
        if (result.success) {
          console.log(`📊 Synced ${result.posts?.length || 0} posts from Late`);
        }
      }
      // Refresh analytics data after sync
      loadAnalytics();
    } catch (error) {
      console.error('Error syncing with Late:', error);
    }
    setIsSyncing(false);
  };

  // Format numbers
  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num?.toString() || '0';
  };

  // Format percentage
  const formatPercent = (num) => {
    return `${(num || 0).toFixed(1)}%`;
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Song detail view
  if (selectedSong) {
    const songData = getSongAnalytics(selectedSong);
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button style={styles.backButton} onClick={() => setSelectedSong(null)}>
            ← Back to Dashboard
          </button>
          <h1 style={styles.title}>🎵 Song Analytics</h1>
        </div>

        {songData ? (
          <div style={styles.songDetailContainer}>
            <div style={styles.songDetailHeader}>
              <div style={styles.songDetailIcon}>🎵</div>
              <div>
                <h2 style={styles.songDetailName}>{songData.audioName}</h2>
                <p style={styles.songDetailMeta}>
                  {songData.videoCount} videos using this song
                </p>
              </div>
            </div>

            {/* Song Stats Cards */}
            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={styles.statValue}>{formatNumber(songData.totalViews)}</div>
                <div style={styles.statLabel}>Total Views</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statValue}>{formatNumber(songData.totalLikes)}</div>
                <div style={styles.statLabel}>Total Likes</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statValue}>{formatNumber(songData.avgViewsPerVideo)}</div>
                <div style={styles.statLabel}>Avg Views/Video</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statValue}>{formatPercent(songData.avgEngagement)}</div>
                <div style={styles.statLabel}>Avg Engagement</div>
              </div>
            </div>

            {/* Category Breakdown */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Performance by Category</h3>
              <div style={styles.categoryList}>
                {songData.categoryBreakdown.map(cat => (
                  <div key={cat.categoryId} style={styles.categoryRow}>
                    <span style={styles.categoryName}>{cat.categoryName}</span>
                    <span style={styles.categoryVideos}>{cat.videoCount} videos</span>
                    <span style={styles.categoryViews}>{formatNumber(cat.totalViews)} views</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Videos Using This Song */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Videos Using This Song</h3>
              <div style={styles.videoTable}>
                <div style={styles.videoTableHeader}>
                  <span style={styles.videoTableCell}>Video</span>
                  <span style={styles.videoTableCell}>Category</span>
                  <span style={styles.videoTableCell}>Handle</span>
                  <span style={styles.videoTableCell}>Views</span>
                  <span style={styles.videoTableCell}>Engagement</span>
                </div>
                {songData.videos.sort((a, b) => b.views - a.views).map(video => (
                  <div key={video.videoId} style={styles.videoTableRow}>
                    <span style={styles.videoTableCell}>{video.videoName}</span>
                    <span style={styles.videoTableCell}>{video.categoryName}</span>
                    <span style={styles.videoTableCell}>{video.handle}</span>
                    <span style={styles.videoTableCell}>{formatNumber(video.views)}</span>
                    <span style={styles.videoTableCell}>{formatPercent(video.engagementRate)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={styles.emptyState}>No data available for this song</div>
        )}
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? { padding: '16px' } : {})
    }}>
      {/* Header */}
      <div style={{
        ...styles.header,
        ...(isMobile ? { flexDirection: 'column', alignItems: 'flex-start', gap: '12px' } : {})
      }}>
        <div style={styles.headerLeft}>
          <h1 style={{
            ...styles.title,
            ...(isMobile ? { fontSize: '22px' } : {})
          }}>📊 Analytics Dashboard</h1>

          {/* Artist Selector - only show if multiple artists */}
          {artists.length > 1 && (
            <div style={styles.artistSelector}>
              <select
                value={currentArtistId || ''}
                onChange={(e) => handleArtistChange(e.target.value)}
                style={styles.artistSelect}
              >
                {artists.map(artist => (
                  <option key={artist.id} value={artist.id}>
                    {artist.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Single artist indicator */}
          {artists.length === 1 && (
            <span style={styles.singleArtistLabel}>
              {artists[0]?.name}
            </span>
          )}

          <span style={styles.lastUpdated}>
            Last updated: {formatDate(lastUpdated)}
          </span>
        </div>
        <div style={styles.headerRight}>
          <button
            style={styles.refreshButton}
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <span style={styles.miniSpinner} />
                Syncing...
              </>
            ) : (
              <>
                🔄 Refresh
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={styles.tabNav}>
        {['overview', 'songs', 'videos', 'spotify'].map(tab => (
          <button
            key={tab}
            style={{
              ...styles.tabButton,
              ...(activeTab === tab ? styles.tabButtonActive : {})
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'overview' && '📈 Overview'}
            {tab === 'songs' && '🎵 Songs'}
            {tab === 'videos' && '🎬 Videos'}
            {tab === 'spotify' && '🎧 Spotify'}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          {/* Spotify Growth Section - New Row */}
          <div style={{
            ...styles.spotifyGrowthRow,
            ...(isMobile ? { gridTemplateColumns: '1fr', gap: '16px' } : {})
          }}>
            <SpotifyMomentumCard artistId={currentArtistId} />
            <GrowthDriversCard artistId={currentArtistId} />
          </div>

          {/* Overview Stats Cards */}
          <div style={{
            ...styles.statsGrid,
            ...(isMobile ? { gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' } : {})
          }}>
            <div style={styles.statCard}>
              <div style={styles.statIcon}>👁️</div>
              <div style={styles.statValue}>{formatNumber(totalStats?.totalViews)}</div>
              <div style={styles.statLabel}>Total Views</div>
              <div style={styles.statTrend}>↑ 12% this week</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statIcon}>❤️</div>
              <div style={styles.statValue}>{formatNumber(totalStats?.totalLikes)}</div>
              <div style={styles.statLabel}>Total Likes</div>
              <div style={styles.statTrend}>↑ 8% this week</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statIcon}>💬</div>
              <div style={styles.statValue}>{formatNumber(totalStats?.totalComments)}</div>
              <div style={styles.statLabel}>Total Comments</div>
              <div style={styles.statTrend}>↑ 3% this week</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statIcon}>📈</div>
              <div style={styles.statValue}>{formatPercent(totalStats?.avgEngagement)}</div>
              <div style={styles.statLabel}>Avg Engagement</div>
              <div style={styles.statTrend}>↑ 0.5% this week</div>
            </div>
          </div>

          {/* Main Grid */}
          <div style={{
            ...styles.mainGrid,
            ...(isMobile ? { gridTemplateColumns: '1fr', gap: '16px' } : {})
          }}>
            {/* Left Column */}
            <div style={styles.leftColumn}>
              {/* Performance Chart */}
              <div style={styles.chartCard}>
                <div style={styles.chartHeader}>
                  <h3 style={styles.cardTitle}>📈 Performance Over Time</h3>
                  <div style={styles.periodSelector}>
                    {['daily', 'weekly'].map(period => (
                      <button
                        key={period}
                        style={{
                          ...styles.periodButton,
                          ...(chartPeriod === period ? styles.periodButtonActive : {})
                        }}
                        onClick={() => setChartPeriod(period)}
                      >
                        {period.charAt(0).toUpperCase() + period.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={styles.chartContainer}>
                  {/* Simple bar chart visualization */}
                  <div style={styles.chartBars}>
                    {timeSeriesData.slice(-14).map((data, i) => {
                      const maxViews = Math.max(...timeSeriesData.slice(-14).map(d => d.totalViews || 0));
                      const height = maxViews > 0 ? ((data.totalViews || 0) / maxViews) * 100 : 0;
                      return (
                        <div key={i} style={styles.chartBarContainer}>
                          <div
                            style={{
                              ...styles.chartBar,
                              height: `${height}%`
                            }}
                            title={`${data.date}: ${formatNumber(data.totalViews)} views`}
                          />
                          <span style={styles.chartBarLabel}>
                            {data.date?.slice(5) || ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={styles.chartLegend}>
                    <span style={styles.legendItem}>
                      <span style={styles.legendDot} /> Views
                    </span>
                  </div>
                </div>
              </div>

              {/* Category Performance */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>📁 Category Performance</h3>
                <div style={styles.categoryPerformance}>
                  {categoryPerformance.map((cat, i) => {
                    const maxViews = categoryPerformance[0]?.totalViews || 1;
                    const width = (cat.totalViews / maxViews) * 100;
                    return (
                      <div key={cat.categoryId} style={styles.categoryPerfRow}>
                        <span style={styles.categoryPerfName}>{cat.categoryName}</span>
                        <div style={styles.categoryPerfBarContainer}>
                          <div
                            style={{
                              ...styles.categoryPerfBar,
                              width: `${width}%`,
                              backgroundColor: ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'][i % 5]
                            }}
                          />
                        </div>
                        <span style={styles.categoryPerfValue}>{formatNumber(cat.totalViews)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div style={styles.rightColumn}>
              {/* Top Songs */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>🎵 Top Performing Songs</h3>
                <div style={styles.songList}>
                  {songPerformance.slice(0, 5).map((song, i) => (
                    <div
                      key={song.audioId}
                      style={styles.songRow}
                      onClick={() => setSelectedSong(song.audioId)}
                    >
                      <span style={styles.songRank}>{i + 1}</span>
                      <div style={styles.songInfo}>
                        <span style={styles.songName}>{song.audioName}</span>
                        <span style={styles.songMeta}>
                          Used in {song.videoCount} videos
                        </span>
                      </div>
                      <div style={styles.songStats}>
                        <span style={styles.songViews}>{formatNumber(song.totalViews)}</span>
                        <span style={styles.songTrend}>views</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  style={styles.viewAllButton}
                  onClick={() => setActiveTab('songs')}
                >
                  View All Songs →
                </button>
              </div>

              {/* Account Comparison */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>👤 Account Performance</h3>
                <div style={styles.accountList}>
                  {accountPerformance.slice(0, 4).map((acc, i) => {
                    const maxViews = accountPerformance[0]?.totalViews || 1;
                    const width = (acc.totalViews / maxViews) * 100;
                    return (
                      <div key={`${acc.handle}_${acc.platform}`} style={styles.accountRow}>
                        <div style={styles.accountInfo}>
                          <span style={styles.accountHandle}>{acc.handle}</span>
                          <span style={styles.accountPlatform}>{acc.platform}</span>
                        </div>
                        <div style={styles.accountBarContainer}>
                          <div
                            style={{
                              ...styles.accountBar,
                              width: `${width}%`
                            }}
                          />
                        </div>
                        <span style={styles.accountViews}>{formatNumber(acc.totalViews)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Spotify Timeline Overlay */}
          <TimelineOverlayChart artistId={currentArtistId} days={30} />

          {/* Top Videos Table */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>🔥 Top Performing Videos</h3>
            <div style={styles.videoTable}>
              <div style={styles.videoTableHeader}>
                <span style={{ ...styles.videoTableCell, flex: 2 }}>Video</span>
                <span style={styles.videoTableCell}>Song</span>
                <span style={styles.videoTableCell}>Category</span>
                <span style={styles.videoTableCell}>Views</span>
                <span style={styles.videoTableCell}>Likes</span>
                <span style={styles.videoTableCell}>Engagement</span>
              </div>
              {topVideos.slice(0, 8).map((video, i) => (
                <div key={video.videoId} style={styles.videoTableRow}>
                  <span style={{ ...styles.videoTableCell, flex: 2 }}>
                    <span style={styles.videoRank}>{i + 1}</span>
                    {video.videoName}
                  </span>
                  <span style={styles.videoTableCell}>
                    <span
                      style={styles.songLink}
                      onClick={() => setSelectedSong(video.audioId)}
                    >
                      🎵 {video.audioName?.slice(0, 20)}...
                    </span>
                  </span>
                  <span style={styles.videoTableCell}>{video.categoryName}</span>
                  <span style={styles.videoTableCell}>{formatNumber(video.views)}</span>
                  <span style={styles.videoTableCell}>{formatNumber(video.likes)}</span>
                  <span style={styles.videoTableCell}>{formatPercent(video.engagementRate)}</span>
                </div>
              ))}
            </div>
            <button
              style={styles.viewAllButton}
              onClick={() => setActiveTab('videos')}
            >
              View All Videos →
            </button>
          </div>
        </>
      )}

      {/* Songs Tab - Enhanced with Spotify Attribution */}
      {activeTab === 'songs' && (
        <div style={styles.songsTab}>
          <div style={styles.songsGrid}>
            {songPerformance.map((song, i) => {
              // Find Spotify attribution data for this song
              const songAttr = songAttributions.find(s => s.audioId === song.audioId) || {};
              return (
                <div
                  key={song.audioId}
                  style={styles.songCard}
                  onClick={() => setSelectedSong(song.audioId)}
                >
                  <div style={styles.songCardHeader}>
                    <span style={styles.songCardRank}>#{i + 1}</span>
                    {songAttr.momentumScore !== null && songAttr.momentumScore !== undefined && (
                      <span style={styles.songMomentumBadge}>
                        🎧 {songAttr.momentumScore}
                      </span>
                    )}
                    <span style={styles.songCardIcon}>🎵</span>
                  </div>
                  <h4 style={styles.songCardName}>{song.audioName}</h4>
                  <p style={styles.songCardMeta}>{song.videoCount} videos</p>
                  <div style={styles.songCardStats}>
                    <div style={styles.songCardStat}>
                      <span style={styles.songCardStatValue}>{formatNumber(song.totalViews)}</span>
                      <span style={styles.songCardStatLabel}>views</span>
                    </div>
                    <div style={styles.songCardStat}>
                      <span style={styles.songCardStatValue}>{formatNumber(song.totalLikes)}</span>
                      <span style={styles.songCardStatLabel}>likes</span>
                    </div>
                    <div style={styles.songCardStat}>
                      <span style={styles.songCardStatValue}>{formatPercent(song.avgEngagement)}</span>
                      <span style={styles.songCardStatLabel}>eng.</span>
                    </div>
                  </div>
                  <div style={styles.songCardAvg}>
                    Avg {formatNumber(song.avgViewsPerVideo)} views/video
                  </div>
                  {/* Spotify Attribution Lift */}
                  {(songAttr.totalAttributedLift || 0) > 0 && (
                    <div style={styles.songAttrLift}>
                      <span style={styles.attrLiftLabel}>Spotify Lift (7d)</span>
                      <span style={styles.attrLiftValue}>+{songAttr.totalAttributedLift.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Videos Tab - Enhanced with Spotify Attribution */}
      {activeTab === 'videos' && (
        <div style={styles.videosTab}>
          <div style={styles.videoTable}>
            <div style={styles.videoTableHeader}>
              <span style={{ ...styles.videoTableCell, width: '40px' }}>#</span>
              <span style={{ ...styles.videoTableCell, flex: 2 }}>Video</span>
              <span style={styles.videoTableCell}>Song</span>
              <span style={styles.videoTableCell}>Platform</span>
              <span style={styles.videoTableCell}>Views</span>
              <span style={styles.videoTableCell}>Engagement</span>
              <span style={styles.videoTableCell}>Spotify Lift</span>
              <span style={styles.videoTableCell}>Contribution</span>
              <span style={styles.videoTableCell}>Confidence</span>
              <span style={styles.videoTableCell}>Time to Impact</span>
            </div>
            {(videoAttributions.length > 0 ? videoAttributions : topVideos).map((video, i) => {
              // Find attribution data for this video
              const attr = videoAttributions.find(v => v.videoId === video.videoId) || video;
              return (
                <div key={video.videoId} style={styles.videoTableRow}>
                  <span style={{ ...styles.videoTableCell, width: '40px' }}>{i + 1}</span>
                  <span style={{ ...styles.videoTableCell, flex: 2, fontWeight: '500' }}>
                    {video.videoName}
                  </span>
                  <span style={styles.videoTableCell}>
                    <span
                      style={styles.songLink}
                      onClick={() => setSelectedSong(video.audioId)}
                    >
                      {video.audioName?.slice(0, 12) || '—'}...
                    </span>
                  </span>
                  <span style={styles.videoTableCell}>{video.platform || '—'}</span>
                  <span style={styles.videoTableCell}>{formatNumber(video.views)}</span>
                  <span style={styles.videoTableCell}>{formatPercent(video.engagementRate)}</span>
                  <span style={{
                    ...styles.videoTableCell,
                    color: (attr.spotifyLift7d || 0) > 0 ? '#10b981' : '#6b7280'
                  }}>
                    {(attr.spotifyLift7d || 0) > 0 ? '+' : ''}{(attr.spotifyLift7d || 0).toFixed(1)}
                  </span>
                  <span style={styles.videoTableCell}>
                    {(attr.contributionPct || 0).toFixed(1)}%
                  </span>
                  <span style={styles.videoTableCell}>
                    <ConfidenceBadge
                      level={attr.confidenceLabel || 'None'}
                      score={attr.confidenceScore}
                    />
                  </span>
                  <span style={styles.videoTableCell}>
                    {attr.timeToImpact ? `${attr.timeToImpact}h` : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Attribution methodology note */}
          <div style={styles.attributionNote}>
            💡 <strong>Spotify Lift</strong> shows attributed growth points.
            <strong> Contribution %</strong> shows this video's share of total attributed lift.
            <strong> Time to Impact</strong> shows hours between post and detected growth event.
            <em> Attribution is probabilistic, not proven causation.</em>
          </div>
        </div>
      )}

      {/* Spotify Tab */}
      {activeTab === 'spotify' && (
        <SpotifyTab artistId={currentArtistId} />
      )}
    </div>
  );
};

// Styles
const styles = {
  container: {
    padding: '24px',
    backgroundColor: '#0a0a0f',
    minHeight: '100vh',
    color: '#fff'
  },
  // Spotify Growth Row (Overview)
  spotifyGrowthRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
    marginBottom: '24px'
  },
  attributionNote: {
    marginTop: '16px',
    padding: '12px 16px',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#a78bfa',
    lineHeight: '1.6'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  headerRight: {
    display: 'flex',
    gap: '12px'
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    margin: 0
  },
  lastUpdated: {
    fontSize: '13px',
    color: '#6b7280'
  },
  artistSelector: {
    position: 'relative'
  },
  artistSelect: {
    appearance: 'none',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid #2a2a3e',
    borderRadius: '6px',
    padding: '6px 28px 6px 10px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    outline: 'none'
  },
  singleArtistLabel: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#a78bfa',
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    padding: '4px 12px',
    borderRadius: '6px'
  },
  refreshButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  backButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '14px',
    marginRight: '16px'
  },
  tabNav: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
    borderBottom: '1px solid #1f1f2e',
    paddingBottom: '16px'
  },
  tabButton: {
    padding: '10px 20px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  tabButtonActive: {
    backgroundColor: '#1f1f2e',
    color: '#fff'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
    marginBottom: '24px'
  },
  statCard: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'center'
  },
  statIcon: {
    fontSize: '24px',
    marginBottom: '8px'
  },
  statValue: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#fff',
    marginBottom: '4px'
  },
  statLabel: {
    fontSize: '13px',
    color: '#6b7280',
    marginBottom: '8px'
  },
  statTrend: {
    fontSize: '12px',
    color: '#10b981'
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '1.5fr 1fr',
    gap: '24px',
    marginBottom: '24px'
  },
  leftColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  rightColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  card: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '20px'
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 16px 0'
  },
  chartCard: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '20px'
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  periodSelector: {
    display: 'flex',
    gap: '4px',
    backgroundColor: '#0a0a0f',
    borderRadius: '6px',
    padding: '4px'
  },
  periodButton: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500'
  },
  periodButtonActive: {
    backgroundColor: '#1f1f2e',
    color: '#fff'
  },
  chartContainer: {
    height: '200px',
    display: 'flex',
    flexDirection: 'column'
  },
  chartBars: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
    paddingBottom: '24px'
  },
  chartBarContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end'
  },
  chartBar: {
    width: '100%',
    backgroundColor: '#8b5cf6',
    borderRadius: '4px 4px 0 0',
    minHeight: '4px',
    transition: 'height 0.3s'
  },
  chartBarLabel: {
    fontSize: '10px',
    color: '#6b7280',
    marginTop: '4px'
  },
  chartLegend: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center'
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
    borderRadius: '50%',
    backgroundColor: '#8b5cf6'
  },
  categoryPerformance: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  categoryPerfRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  categoryPerfName: {
    width: '100px',
    fontSize: '13px',
    color: '#e5e7eb',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  categoryPerfBarContainer: {
    flex: 1,
    height: '8px',
    backgroundColor: '#1f1f2e',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  categoryPerfBar: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s'
  },
  categoryPerfValue: {
    width: '60px',
    textAlign: 'right',
    fontSize: '13px',
    color: '#9ca3af'
  },
  songList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  songRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  songRank: {
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
  songInfo: {
    flex: 1,
    minWidth: 0
  },
  songName: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '500',
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songMeta: {
    fontSize: '11px',
    color: '#6b7280'
  },
  songStats: {
    textAlign: 'right'
  },
  songViews: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#10b981'
  },
  songTrend: {
    fontSize: '10px',
    color: '#6b7280'
  },
  accountList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  accountRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  accountInfo: {
    width: '120px'
  },
  accountHandle: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '500',
    color: '#fff'
  },
  accountPlatform: {
    fontSize: '11px',
    color: '#6b7280',
    textTransform: 'capitalize'
  },
  accountBarContainer: {
    flex: 1,
    height: '8px',
    backgroundColor: '#1f1f2e',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  accountBar: {
    height: '100%',
    backgroundColor: '#06b6d4',
    borderRadius: '4px'
  },
  accountViews: {
    width: '60px',
    textAlign: 'right',
    fontSize: '13px',
    color: '#9ca3af'
  },
  viewAllButton: {
    width: '100%',
    padding: '10px',
    backgroundColor: 'transparent',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px',
    marginTop: '12px',
    transition: 'all 0.2s'
  },
  videoTable: {
    display: 'flex',
    flexDirection: 'column'
  },
  videoTableHeader: {
    display: 'flex',
    padding: '12px',
    borderBottom: '1px solid #1f1f2e',
    fontSize: '12px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  videoTableRow: {
    display: 'flex',
    padding: '12px',
    borderBottom: '1px solid #1f1f2e',
    fontSize: '13px',
    color: '#e5e7eb',
    alignItems: 'center'
  },
  videoTableCell: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  videoRank: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: '#1f1f2e',
    fontSize: '11px',
    marginRight: '8px',
    color: '#9ca3af'
  },
  songLink: {
    color: '#8b5cf6',
    cursor: 'pointer',
    textDecoration: 'none'
  },
  // Songs tab
  songsTab: {
    padding: '16px 0'
  },
  songsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px'
  },
  songCard: {
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    padding: '20px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  songCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  songCardRank: {
    fontSize: '12px',
    color: '#6b7280',
    fontWeight: '600'
  },
  songCardIcon: {
    fontSize: '24px'
  },
  songCardName: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 4px 0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songCardMeta: {
    fontSize: '12px',
    color: '#6b7280',
    margin: '0 0 16px 0'
  },
  songCardStats: {
    display: 'flex',
    gap: '16px',
    marginBottom: '12px'
  },
  songCardStat: {
    flex: 1,
    textAlign: 'center'
  },
  songCardStatValue: {
    display: 'block',
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff'
  },
  songCardStatLabel: {
    fontSize: '11px',
    color: '#6b7280'
  },
  songCardAvg: {
    fontSize: '12px',
    color: '#10b981',
    textAlign: 'center',
    padding: '8px',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: '6px'
  },
  songMomentumBadge: {
    fontSize: '10px',
    color: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontWeight: '600'
  },
  songAttrLift: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '8px',
    padding: '8px 12px',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderRadius: '6px'
  },
  attrLiftLabel: {
    fontSize: '11px',
    color: '#a78bfa'
  },
  attrLiftValue: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#a78bfa'
  },
  // Videos tab
  videosTab: {
    padding: '16px 0'
  },
  // Song detail view
  songDetailContainer: {
    maxWidth: '900px'
  },
  songDetailHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px'
  },
  songDetailIcon: {
    fontSize: '48px'
  },
  songDetailName: {
    fontSize: '24px',
    fontWeight: '700',
    margin: 0
  },
  songDetailMeta: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '4px 0 0 0'
  },
  section: {
    marginTop: '32px'
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '16px'
  },
  categoryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  categoryRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#111118',
    borderRadius: '8px'
  },
  categoryName: {
    flex: 1,
    fontWeight: '500'
  },
  categoryVideos: {
    width: '100px',
    color: '#6b7280',
    fontSize: '13px'
  },
  categoryViews: {
    width: '100px',
    textAlign: 'right',
    color: '#10b981',
    fontWeight: '500'
  },
  // Loading & empty states
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '400px',
    color: '#6b7280'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #1f1f2e',
    borderTopColor: '#8b5cf6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '16px'
  },
  miniSpinner: {
    width: '14px',
    height: '14px',
    border: '2px solid #1f1f2e',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px',
    color: '#6b7280'
  }
};

// Add keyframes for spinner
if (typeof document !== 'undefined' && !document.getElementById('analytics-dashboard-styles')) {
  const style = document.createElement('style');
  style.id = 'analytics-dashboard-styles';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

export default AnalyticsDashboard;
