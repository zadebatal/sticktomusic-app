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
import useIsMobile from '../../hooks/useIsMobile';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { Loader } from '../../ui/components/Loader';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import {
  FeatherRefreshCw, FeatherArrowLeft, FeatherTrendingUp,
  FeatherBarChart, FeatherBarChart2, FeatherMusic, FeatherFilm, FeatherHeadphones,
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
  const [hasRealData, setHasRealData] = useState(true);

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
    if (!capturedArtistId) {
      setIsLoading(false);
      return;
    }
    const stored = getStoredAnalytics(capturedArtistId);

    // If no data, show empty state instead of mock data
    if (Object.keys(stored.videos).length === 0) {
      setHasRealData(false);
      setAnalytics(stored);
      setTotalStats(null);
      setTopVideos([]);
      setSongPerformance([]);
      setCategoryPerformance([]);
      setAccountPerformance([]);
      setTimeSeriesData([]);
    } else {
      setHasRealData(true);
      setAnalytics(stored);
      setTotalStats(calculateTotalStats(stored.videos));
      setTopVideos(getTopVideos(capturedArtistId, 10));
      setSongPerformance(getSongPerformance(capturedArtistId));
      setCategoryPerformance(getCategoryPerformance(capturedArtistId));
      setAccountPerformance(getAccountPerformance(capturedArtistId));
      setTimeSeriesData(getTimeSeriesData(capturedArtistId, chartPeriod, 30));
    }

    // Load Spotify attribution data — verify artistId hasn't changed
    try {
      if (capturedArtistId && capturedArtistId === currentArtistId) {
        computeAttribution(capturedArtistId);
        setVideoAttributions(getVideoAttributionSummary(capturedArtistId));
        setSongAttributions(getSongAttributionSummary(capturedArtistId));
      }
    } catch (error) {
      log.error('Error loading attribution data:', error);
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
    if (currentArtistId) setTimeSeriesData(getTimeSeriesData(currentArtistId, chartPeriod, 30));
  }, [chartPeriod, currentArtistId]);

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
      log.error('Error syncing with Late:', error);
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
    const songData = getSongAnalytics(currentArtistId, selectedSong);
    return (
      <div className={`px-12 py-8 bg-black min-h-screen text-white ${isMobile ? '!px-4' : ''}`}>
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
          <div className="max-w-[900px]">
            <div className="flex items-center gap-4 mb-6">
              <div className="text-5xl">🎵</div>
              <div>
                <h2 className="text-2xl font-bold m-0">{songData.audioName}</h2>
                <p className="text-sm text-neutral-400 mt-1 m-0">
                  {songData.videoCount} videos using this song
                </p>
              </div>
            </div>

            {/* Song Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
            <div className="mt-8">
              <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">Performance by Category</h3>
              <div className="flex flex-col gap-2">
                {songData.categoryBreakdown.map(cat => (
                  <div key={cat.categoryId} className="flex items-center px-4 py-3 bg-[#171717] rounded-lg">
                    <span className="flex-1 font-medium text-white">{cat.categoryName}</span>
                    <span className="w-[100px] text-neutral-400 text-[13px]">{cat.videoCount} videos</span>
                    <span className="w-[100px] text-right text-[#10b981] font-medium">{formatNumber(cat.totalViews)} views</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Videos Using This Song */}
            <div className="mt-8">
              <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">Videos Using This Song</h3>
              <div className="flex flex-col overflow-x-auto">
                <div className="flex p-3 border-b border-neutral-800 text-[12px] font-semibold uppercase text-neutral-400">
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Video</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Category</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Handle</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Views</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Engagement</span>
                </div>
                {songData.videos.sort((a, b) => b.views - a.views).map(video => (
                  <div key={video.videoId} className="flex items-center p-3 border-b border-neutral-800 text-[13px] hover:bg-[#1a1a1aff] transition-colors">
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{video.videoName}</span>
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{video.categoryName}</span>
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{video.handle}</span>
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{formatNumber(video.views)}</span>
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{formatPercent(video.engagementRate)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center p-12 text-neutral-500">No data available for this song</div>
        )}
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={`px-12 py-8 bg-black min-h-screen text-white ${isMobile ? '!px-4' : ''}`}>
        <div className="flex flex-col items-center justify-center h-[400px] text-neutral-400">
          <Loader size="large" />
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
    <div className={`px-12 py-8 bg-black min-h-screen text-white ${isMobile ? '!px-4' : ''}`}>
      {/* Header */}
      <div className={`flex w-full items-center justify-between border-b border-solid border-neutral-800 pb-6 mb-6 ${isMobile ? 'flex-col items-start gap-3' : ''}`}>
        <div className="flex items-center gap-4">
          <span className={`text-heading-1 font-heading-1 text-[#ffffffff] ${isMobile ? 'text-[22px]' : ''}`}>Analytics</span>

          {/* Artist Selector - only show if multiple artists */}
          {artists.length > 1 && (
            <SubframeCore.DropdownMenu.Root>
              <SubframeCore.DropdownMenu.Trigger asChild>
                <div className="flex items-center gap-2 rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-3 py-2 cursor-pointer hover:bg-[#262626]">
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

      {/* Empty state — no analytics data */}
      {!hasRealData && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <FeatherBarChart2 className="w-12 h-12 text-zinc-600" />
          <h3 className="text-lg font-semibold text-white">No analytics data yet</h3>
          <p className="text-sm text-zinc-400 max-w-xs">
            Schedule and post content to start tracking performance
          </p>
        </div>
      )}

      {/* Overview Tab */}
      {hasRealData && activeTab === 'overview' && (
        <>
          {/* Spotify Growth Section - New Row */}
          <div className={`grid gap-6 mb-6 ${isMobile ? 'grid-cols-1 !gap-4' : 'grid-cols-2'}`}>
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
          <div className={`grid gap-6 mb-6 ${isMobile ? 'grid-cols-1 !gap-4' : 'grid-cols-[1.5fr_1fr]'}`}>
            {/* Left Column */}
            <div className="flex flex-col gap-6">
              {/* Performance Chart */}
              <div className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-heading-2 font-heading-2 text-[#ffffffff]">📈 Performance Over Time</h3>
                  <ToggleGroup value={chartPeriod} onValueChange={(v) => v && setChartPeriod(v)}>
                    <ToggleGroup.Item value="daily">Daily</ToggleGroup.Item>
                    <ToggleGroup.Item value="weekly">Weekly</ToggleGroup.Item>
                  </ToggleGroup>
                </div>
                <div className="h-[200px] flex flex-col">
                  {/* Simple bar chart visualization */}
                  <div className="flex-1 flex items-end gap-2 pb-6">
                    {timeSeriesData.slice(-14).map((data, i) => {
                      const maxViews = Math.max(...timeSeriesData.slice(-14).map(d => d.totalViews || 0));
                      const height = maxViews > 0 ? ((data.totalViews || 0) / maxViews) * 100 : 0;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center h-full justify-end">
                          <div
                            className="w-full bg-brand-600 rounded-t min-h-[4px] transition-all duration-300"
                            style={{ height: `${height}%` }}
                            title={`${data.date}: ${formatNumber(data.totalViews)} views`}
                          />
                          <span className="text-[10px] text-neutral-500 mt-1">
                            {data.date?.slice(5) || ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-4 justify-center">
                    <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="w-2 h-2 rounded-full bg-brand-600" /> Views
                    </span>
                  </div>
                </div>
              </div>

              {/* Category Performance */}
              <div className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5">
                <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">📁 Category Performance</h3>
                <div className="flex flex-col gap-3">
                  {categoryPerformance.map((cat, i) => {
                    const maxViews = categoryPerformance[0]?.totalViews || 1;
                    const width = (cat.totalViews / maxViews) * 100;
                    return (
                      <div key={cat.categoryId} className="flex items-center gap-3">
                        <span className="w-[100px] text-[13px] text-white whitespace-nowrap overflow-hidden text-ellipsis">{cat.categoryName}</span>
                        <div className="flex-1 h-2 bg-neutral-800 rounded overflow-hidden">
                          <div
                            className="h-full rounded transition-all duration-300"
                            style={{
                              width: `${width}%`,
                              backgroundColor: ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'][i % 5]
                            }}
                          />
                        </div>
                        <span className="w-[60px] text-right text-[13px] text-neutral-500">{formatNumber(cat.totalViews)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="flex flex-col gap-6">
              {/* Top Songs */}
              <div className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5">
                <h3 className="text-heading-2 font-heading-2 text-[#ffffffff] mb-4">🎵 Top Performing Songs</h3>
                <div className="flex flex-col gap-2">
                  {songPerformance.slice(0, 5).map((song, i) => (
                    <div
                      key={song.audioId}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-pointer border-b border-neutral-800 hover:bg-[#1a1a1aff] transition-colors"
                      onClick={() => setSelectedSong(song.audioId)}
                    >
                      <span className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-semibold text-neutral-500">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-white whitespace-nowrap overflow-hidden text-ellipsis">{song.audioName}</span>
                        <span className="text-[11px] text-neutral-400">
                          Used in {song.videoCount} videos
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="block text-sm font-semibold text-[#10b981]">{formatNumber(song.totalViews)}</span>
                        <span className="text-[10px] text-neutral-400">views</span>
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
                <div className="flex flex-col gap-3">
                  {accountPerformance.slice(0, 4).map((acc, i) => {
                    const maxViews = accountPerformance[0]?.totalViews || 1;
                    const width = (acc.totalViews / maxViews) * 100;
                    return (
                      <div key={`${acc.handle}_${acc.platform}`} className="flex items-center gap-3">
                        <div className="w-[120px]">
                          <span className="block text-[13px] font-medium text-white">{acc.handle}</span>
                          <span className="text-[11px] text-neutral-400 capitalize">{acc.platform}</span>
                        </div>
                        <div className="flex-1 h-2 bg-neutral-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-cyan-500 rounded"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <span className="w-[60px] text-right text-[13px] text-neutral-500">{formatNumber(acc.totalViews)}</span>
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
            <div className="flex flex-col overflow-x-auto">
              <div className="flex p-3 border-b border-neutral-800 text-[12px] font-semibold uppercase text-neutral-400 min-w-[600px]">
                <span className="flex-[2] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Video</span>
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Song</span>
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Category</span>
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Views</span>
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Likes</span>
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Engagement</span>
              </div>
              {topVideos.slice(0, 8).map((video, i) => (
                <div key={video.videoId} className="flex items-center p-3 border-b border-neutral-800 text-[13px] text-white hover:bg-[#1a1a1aff] transition-colors min-w-[600px]">
                  <span className="flex-[2] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-neutral-800 text-[11px] mr-2 text-neutral-500">{i + 1}</span>
                    {video.videoName}
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    <span
                      className="text-brand-600 cursor-pointer"
                      onClick={() => setSelectedSong(video.audioId)}
                    >
                      🎵 {video.audioName?.slice(0, 20)}...
                    </span>
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{video.categoryName}</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{formatNumber(video.views)}</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{formatNumber(video.likes)}</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{formatPercent(video.engagementRate)}</span>
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
      {hasRealData && activeTab === 'songs' && (
        <div className="py-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {songPerformance.map((song, i) => {
              // Find Spotify attribution data for this song
              const songAttr = songAttributions.find(s => s.audioId === song.audioId) || {};
              return (
                <div
                  key={song.audioId}
                  className="rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-5 cursor-pointer hover:border-neutral-700 transition-colors"
                  onClick={() => setSelectedSong(song.audioId)}
                >
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs text-neutral-400 font-semibold">#{i + 1}</span>
                    {songAttr.momentumScore !== null && songAttr.momentumScore !== undefined && (
                      <span className="text-[10px] text-[#10b981] bg-[rgba(16,185,129,0.15)] px-1.5 py-0.5 rounded font-semibold">
                        🎧 {songAttr.momentumScore}
                      </span>
                    )}
                    <span className="text-2xl">🎵</span>
                  </div>
                  <h4 className="text-[15px] font-semibold text-white m-0 mb-1 whitespace-nowrap overflow-hidden text-ellipsis">{song.audioName}</h4>
                  <p className="text-xs text-neutral-400 m-0 mb-4">{song.videoCount} videos</p>
                  <div className="flex gap-4 mb-3">
                    <div className="flex-1 text-center">
                      <span className="block text-lg font-semibold text-white">{formatNumber(song.totalViews)}</span>
                      <span className="text-[11px] text-neutral-400">views</span>
                    </div>
                    <div className="flex-1 text-center">
                      <span className="block text-lg font-semibold text-white">{formatNumber(song.totalLikes)}</span>
                      <span className="text-[11px] text-neutral-400">likes</span>
                    </div>
                    <div className="flex-1 text-center">
                      <span className="block text-lg font-semibold text-white">{formatPercent(song.avgEngagement)}</span>
                      <span className="text-[11px] text-neutral-400">eng.</span>
                    </div>
                  </div>
                  <div className="text-xs text-[#10b981] text-center p-2 bg-[rgba(16,185,129,0.1)] rounded-md">
                    Avg {formatNumber(song.avgViewsPerVideo)} views/video
                  </div>
                  {/* Spotify Attribution Lift */}
                  {(songAttr.totalAttributedLift || 0) > 0 && (
                    <div className="flex justify-between items-center mt-2 px-3 py-2 bg-[rgba(99,102,241,0.09)] rounded-md">
                      <span className="text-[11px] text-indigo-400">Spotify Lift (7d)</span>
                      <span className="text-sm font-semibold text-indigo-400">+{songAttr.totalAttributedLift.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Videos Tab - Enhanced with Spotify Attribution */}
      {hasRealData && activeTab === 'videos' && (
        <div className="py-4">
          <div className="flex flex-col overflow-x-auto">
            <div className="flex p-3 border-b border-neutral-800 text-[12px] font-semibold uppercase text-neutral-400 min-w-[900px]">
              <span className="w-[40px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">#</span>
              <span className="flex-[2] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Video</span>
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Song</span>
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Platform</span>
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Views</span>
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Engagement</span>
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Spotify Lift</span>
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Contribution</span>
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Confidence</span>
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Time to Impact</span>
            </div>
            {(videoAttributions.length > 0 ? videoAttributions : topVideos).map((video, i) => {
              // Find attribution data for this video
              const attr = videoAttributions.find(v => v.videoId === video.videoId) || video;
              return (
                <div key={video.videoId} className="flex items-center p-3 border-b border-neutral-800 text-[13px] text-white hover:bg-[#1a1a1aff] transition-colors min-w-[900px]">
                  <span className="w-[40px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{i + 1}</span>
                  <span className="flex-[2] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                    {video.videoName}
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    <span
                      className="text-brand-600 cursor-pointer"
                      onClick={() => setSelectedSong(video.audioId)}
                    >
                      {video.audioName?.slice(0, 12) || '—'}...
                    </span>
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{video.platform || '—'}</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{formatNumber(video.views)}</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{formatPercent(video.engagementRate)}</span>
                  <span className={`flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${(attr.spotifyLift7d || 0) > 0 ? 'text-[#10b981]' : 'text-neutral-400'}`}>
                    {(attr.spotifyLift7d || 0) > 0 ? '+' : ''}{(attr.spotifyLift7d || 0).toFixed(1)}
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {(attr.contributionPct || 0).toFixed(1)}%
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    <ConfidenceBadge
                      level={attr.confidenceLabel || 'None'}
                      score={attr.confidenceScore}
                    />
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {attr.timeToImpact ? `${attr.timeToImpact}h` : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Attribution methodology note */}
          <div className="mt-4 px-4 py-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-xs text-indigo-300 leading-relaxed">
            💡 <strong>Spotify Lift</strong> shows attributed growth points.
            <strong> Contribution %</strong> shows this video's share of total attributed lift.
            <strong> Time to Impact</strong> shows hours between post and detected growth event.
            <em> Attribution is probabilistic, not proven causation.</em>
          </div>
        </div>
      )}

      {/* Spotify Tab */}
      {hasRealData && activeTab === 'spotify' && (
        <SpotifyTab artistId={currentArtistId} />
      )}
    </div>
  );
};

export default AnalyticsDashboard;
