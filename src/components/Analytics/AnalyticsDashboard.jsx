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
import log from '../../utils/logger';
import { useTheme } from '../../contexts/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import {
  FeatherRefreshCw, FeatherArrowLeft, FeatherTrendingUp,
  FeatherBarChart, FeatherMusic, FeatherFilm, FeatherHeadphones,
  FeatherUser, FeatherChevronDown, FeatherEye, FeatherHeart,
  FeatherMessageCircle
} from '@subframe/core';
import * as SubframeCore from '@subframe/core';

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
  latePosts = [],
  lateConnected = false
}) => {
  // Mobile responsive detection
  const { isMobile } = useIsMobile();

  // Theme support
  const { theme } = useTheme();
  const styles = getStyles(theme);

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
    const capturedArtistId = currentArtistId;
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

    // Load Spotify attribution data — verify artistId hasn't changed
    try {
      if (capturedArtistId && capturedArtistId === currentArtistId) {
        computeAttribution(capturedArtistId);
        setVideoAttributions(getVideoAttributionSummary(capturedArtistId));
        setSongAttributions(getSongAttributionSummary(capturedArtistId));
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
        log('📊 Analytics sync result:', result);
        if (result.success) {
          log(`📊 Synced ${result.posts?.length || 0} posts from Late`);
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
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="neutral-tertiary"
            size="medium"
            icon={<FeatherArrowLeft />}
            onClick={() => setSelectedSong(null)}
          >
            Back to Dashboard
          </Button>
          <span className="text-heading-1 font-heading-1 text-[#ffffffff]">Song Analytics</span>
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
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
                <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{formatNumber(songData.totalViews)}</span>
                <span className="text-caption font-caption text-neutral-400">Total Views</span>
              </div>
              <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
                <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{formatNumber(songData.totalLikes)}</span>
                <span className="text-caption font-caption text-neutral-400">Total Likes</span>
              </div>
              <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
                <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{formatNumber(songData.avgViewsPerVideo)}</span>
                <span className="text-caption font-caption text-neutral-400">Avg Views/Video</span>
              </div>
              <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
                <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{formatPercent(songData.avgEngagement)}</span>
                <span className="text-caption font-caption text-neutral-400">Avg Engagement</span>
              </div>
            </div>

            {/* Category Breakdown */}
            <div style={styles.section}>
              <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">Performance by Category</h3>
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
              <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">Videos Using This Song</h3>
              <div style={styles.videoTable}>
                <div className="flex p-3 border-b border-neutral-800 text-[12px] font-semibold uppercase" style={{ color: theme.text.secondary }}>
                  <span style={styles.videoTableCell}>Video</span>
                  <span style={styles.videoTableCell}>Category</span>
                  <span style={styles.videoTableCell}>Handle</span>
                  <span style={styles.videoTableCell}>Views</span>
                  <span style={styles.videoTableCell}>Engagement</span>
                </div>
                {songData.videos.sort((a, b) => b.views - a.views).map(video => (
                  <div key={video.videoId} className="flex items-center p-3 border-b border-neutral-800 text-[13px] hover:bg-[#1a1a1aff] transition-colors">
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

  // Gate: require Late connection
  if (!lateConnected) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-8">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-12 text-center max-w-[420px]">
          <FeatherBarChart className="text-neutral-400" style={{ width: 48, height: 48 }} />
          <span className="text-heading-3 font-heading-3 text-[#ffffffff]">
            Connect Late to View Analytics
          </span>
          <span className="text-body font-body text-neutral-400 leading-relaxed">
            Analytics require a Late.co connection. Contact your operator to get set up.
          </span>
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
      <div className={`flex w-full items-center justify-between border-b border-solid border-neutral-800 pb-6 mb-6 ${isMobile ? 'flex-col items-start gap-3' : ''}`}>
        <div className="flex items-center gap-4">
          <span className={`text-heading-1 font-heading-1 text-[#ffffffff] ${isMobile ? 'text-[22px]' : ''}`}>Analytics</span>

          {/* Artist Selector - only show if multiple artists */}
          {artists.length > 1 && (
            <SubframeCore.DropdownMenu.Root>
              <SubframeCore.DropdownMenu.Trigger asChild>
                <div className="flex items-center gap-2 rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-3 py-2 cursor-pointer hover:bg-neutral-900">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white text-xs font-semibold">
                    {(currentArtistName || '?')[0].toUpperCase()}
                  </div>
                  <span className="text-body-bold font-body-bold text-[#ffffffff]">{currentArtistName}</span>
                  <FeatherChevronDown className="text-neutral-400" style={{ width: 14, height: 14 }} />
                </div>
              </SubframeCore.DropdownMenu.Trigger>
              <SubframeCore.DropdownMenu.Portal>
                <SubframeCore.DropdownMenu.Content side="bottom" align="start" sideOffset={4} asChild>
                  <DropdownMenu>
                    {artists.map(artist => (
                      <DropdownMenu.DropdownItem
                        key={artist.id}
                        icon={<FeatherUser />}
                        onClick={() => handleArtistChange(artist.id)}
                      >
                        {artist.name}
                      </DropdownMenu.DropdownItem>
                    ))}
                  </DropdownMenu>
                </SubframeCore.DropdownMenu.Content>
              </SubframeCore.DropdownMenu.Portal>
            </SubframeCore.DropdownMenu.Root>
          )}

          {/* Single artist indicator */}
          {artists.length === 1 && (
            <Badge variant="brand">{artists[0]?.name}</Badge>
          )}

          <span className="text-caption font-caption text-neutral-500">
            Last updated: {formatDate(lastUpdated)}
          </span>
        </div>
        <Button
          variant="neutral-secondary"
          size="medium"
          icon={<FeatherRefreshCw />}
          disabled={isSyncing}
          onClick={handleSync}
        >
          {isSyncing ? 'Syncing...' : 'Refresh'}
        </Button>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 mb-6">
        <ToggleGroup value={activeTab} onValueChange={(v) => v && setActiveTab(v)}>
          <ToggleGroup.Item icon={<FeatherTrendingUp />} value="overview">Overview</ToggleGroup.Item>
          <ToggleGroup.Item icon={<FeatherMusic />} value="songs">Songs</ToggleGroup.Item>
          <ToggleGroup.Item icon={<FeatherFilm />} value="videos">Videos</ToggleGroup.Item>
          <ToggleGroup.Item icon={<FeatherHeadphones />} value="spotify">Spotify</ToggleGroup.Item>
        </ToggleGroup>
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
          <div className={`grid gap-4 mb-6 ${isMobile ? 'grid-cols-2 gap-3' : 'grid-cols-4'}`}>
            <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
              <FeatherEye className="text-neutral-400" style={{ width: 20, height: 20 }} />
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{formatNumber(totalStats?.totalViews)}</span>
              <span className="text-caption font-caption text-neutral-400">Total Views</span>
              <span className="text-caption font-caption text-[#22c55e]">+12% this week</span>
            </div>
            <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
              <FeatherHeart className="text-neutral-400" style={{ width: 20, height: 20 }} />
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{formatNumber(totalStats?.totalLikes)}</span>
              <span className="text-caption font-caption text-neutral-400">Total Likes</span>
              <span className="text-caption font-caption text-[#22c55e]">+8% this week</span>
            </div>
            <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
              <FeatherMessageCircle className="text-neutral-400" style={{ width: 20, height: 20 }} />
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{formatNumber(totalStats?.totalComments)}</span>
              <span className="text-caption font-caption text-neutral-400">Total Comments</span>
              <span className="text-caption font-caption text-[#22c55e]">+3% this week</span>
            </div>
            <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-5 py-4">
              <FeatherTrendingUp className="text-neutral-400" style={{ width: 20, height: 20 }} />
              <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{formatPercent(totalStats?.avgEngagement)}</span>
              <span className="text-caption font-caption text-neutral-400">Avg Engagement</span>
              <span className="text-caption font-caption text-[#22c55e]">+0.5% this week</span>
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
              <div className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5">
                <div style={styles.chartHeader}>
                  <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">📈 Performance Over Time</h3>
                  <ToggleGroup value={chartPeriod} onValueChange={(v) => v && setChartPeriod(v)}>
                    <ToggleGroup.Item value="daily">Daily</ToggleGroup.Item>
                    <ToggleGroup.Item value="weekly">Weekly</ToggleGroup.Item>
                  </ToggleGroup>
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
              <div className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5">
                <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">📁 Category Performance</h3>
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
              <div className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5">
                <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">🎵 Top Performing Songs</h3>
                <div style={styles.songList}>
                  {songPerformance.slice(0, 5).map((song, i) => (
                    <div
                      key={song.audioId}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-pointer border-b border-neutral-800 hover:bg-[#1a1a1aff] transition-colors"
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
                <Button
                  variant="neutral-tertiary"
                  size="medium"
                  className="w-full mt-3"
                  onClick={() => setActiveTab('songs')}
                >
                  View All Songs
                </Button>
              </div>

              {/* Account Comparison */}
              <div className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5">
                <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">👤 Account Performance</h3>
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
          <div className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5">
            <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">🔥 Top Performing Videos</h3>
            <div style={styles.videoTable}>
              <div className="flex p-3 border-b border-neutral-800 text-[12px] font-semibold uppercase" style={{ color: theme.text.secondary }}>
                <span style={{ ...styles.videoTableCell, flex: 2 }}>Video</span>
                <span style={styles.videoTableCell}>Song</span>
                <span style={styles.videoTableCell}>Category</span>
                <span style={styles.videoTableCell}>Views</span>
                <span style={styles.videoTableCell}>Likes</span>
                <span style={styles.videoTableCell}>Engagement</span>
              </div>
              {topVideos.slice(0, 8).map((video, i) => (
                <div key={video.videoId} className="flex items-center p-3 border-b border-neutral-800 text-[13px] hover:bg-[#1a1a1aff] transition-colors" style={{ color: theme.text.primary }}>
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
            <Button
              variant="neutral-tertiary"
              size="medium"
              className="w-full mt-3"
              onClick={() => setActiveTab('videos')}
            >
              View All Videos
            </Button>
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
                  className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5 cursor-pointer hover:border-neutral-700 transition-colors"
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
            <div className="flex p-3 border-b border-neutral-800 text-[12px] font-semibold uppercase" style={{ color: theme.text.secondary }}>
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
                <div key={video.videoId} className="flex items-center p-3 border-b border-neutral-800 text-[13px] hover:bg-[#1a1a1aff] transition-colors" style={{ color: theme.text.primary }}>
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
                    color: (attr.spotifyLift7d || 0) > 0 ? '#10b981' : theme.text.secondary
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
const getStyles = (theme) => ({
  container: {
    padding: '24px',
    backgroundColor: theme.bg.page,
    minHeight: '100vh',
    color: theme.text.primary
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
    backgroundColor: `${theme.accent.primary}15`,
    border: `1px solid ${theme.accent.muted}`,
    borderRadius: '8px',
    fontSize: '12px',
    color: theme.accent.hover,
    lineHeight: '1.6'
  },
  // Legacy styles removed — migrated to Tailwind classes in Session 51-52
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
  // card, cardTitle, chartCard — migrated to Tailwind
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  // periodSelector, periodButton, periodButtonActive — migrated to ToggleGroup
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
    backgroundColor: theme.accent.primary,
    borderRadius: '4px 4px 0 0',
    minHeight: '4px',
    transition: 'height 0.3s'
  },
  chartBarLabel: {
    fontSize: '10px',
    color: theme.text.secondary,
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
    color: theme.text.muted
  },
  legendDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: theme.accent.primary
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
    color: theme.text.primary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  categoryPerfBarContainer: {
    flex: 1,
    height: '8px',
    backgroundColor: theme.bg.elevated,
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
    color: theme.text.muted
  },
  songList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  // songRow — migrated to Tailwind
  songRank: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: theme.bg.elevated,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '600',
    color: theme.text.muted
  },
  songInfo: {
    flex: 1,
    minWidth: 0
  },
  songName: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '500',
    color: theme.text.primary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songMeta: {
    fontSize: '11px',
    color: theme.text.secondary
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
    color: theme.text.secondary
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
    color: theme.text.primary
  },
  accountPlatform: {
    fontSize: '11px',
    color: theme.text.secondary,
    textTransform: 'capitalize'
  },
  accountBarContainer: {
    flex: 1,
    height: '8px',
    backgroundColor: theme.bg.elevated,
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
    color: theme.text.muted
  },
  // viewAllButton — migrated to Subframe Button
  videoTable: {
    display: 'flex',
    flexDirection: 'column'
  },
  // videoTableHeader, videoTableRow — migrated to Tailwind
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
    backgroundColor: theme.bg.elevated,
    fontSize: '11px',
    marginRight: '8px',
    color: theme.text.muted
  },
  songLink: {
    color: theme.accent.primary,
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
  // songCard — migrated to Tailwind
  songCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  songCardRank: {
    fontSize: '12px',
    color: theme.text.secondary,
    fontWeight: '600'
  },
  songCardIcon: {
    fontSize: '24px'
  },
  songCardName: {
    fontSize: '15px',
    fontWeight: '600',
    color: theme.text.primary,
    margin: '0 0 4px 0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songCardMeta: {
    fontSize: '12px',
    color: theme.text.secondary,
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
    color: theme.text.primary
  },
  songCardStatLabel: {
    fontSize: '11px',
    color: theme.text.secondary
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
    backgroundColor: `${theme.accent.primary}18`,
    borderRadius: '6px'
  },
  attrLiftLabel: {
    fontSize: '11px',
    color: theme.accent.hover
  },
  attrLiftValue: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.accent.hover
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
  // sectionTitle — migrated to Tailwind
  categoryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  categoryRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: theme.bg.surface,
    borderRadius: '8px'
  },
  categoryName: {
    flex: 1,
    fontWeight: '500',
    color: theme.text.primary
  },
  categoryVideos: {
    width: '100px',
    color: theme.text.secondary,
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
    color: theme.text.secondary
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: `3px solid ${theme.border.default}`,
    borderTopColor: theme.accent.primary,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '16px'
  },
  miniSpinner: {
    width: '14px',
    height: '14px',
    border: `2px solid ${theme.border.default}`,
    borderTopColor: theme.text.primary,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px',
    color: theme.text.muted
  }
});

// Add keyframes for spinner
if (typeof document !== 'undefined' && !document.getElementById('analytics-dashboard-styles')) {
  const style = document.createElement('style');
  style.id = 'analytics-dashboard-styles';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

export default AnalyticsDashboard;
