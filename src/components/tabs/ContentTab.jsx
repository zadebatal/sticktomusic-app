import React from 'react';
import { toast as sonnerToast } from 'sonner';
import { getPlatformConfig, getPlatformKeys } from '../../config/platforms';
import { getCategoryNames } from '../../services/contentTemplateService';
import lateApi from '../../services/lateApiService';
import useArtistStore from '../../stores/useArtistStore';
import useContentStore from '../../stores/useContentStore';
import useUIStore from '../../stores/useUIStore';
import log from '../../utils/logger';
import { EmptyState as SharedEmptyState } from '../ui';

export default function ContentTab({
  user = null,
  contentQueue,
  visibleArtists,
  artistLateConnected,
  checkingLateStatus,
  derivedLateAccountIds,
  generatePostContent,
  handleBulkDelete,
  fetchLateAccounts,
  exportToCSV,
  contentBanks,
  selectedPosts,
  bulkDeleting,
  dayDetailDrawer,
  setDayDetailDrawer,
  deleteConfirmModal,
  setDeleteConfirmModal,
  getPostAccount,
  getUniqueAccounts,
  getPostUrls,
}) {
  // Zustand store state
  const contentArtist = useContentStore((s) => s.contentArtist);
  const setContentArtist = useContentStore((s) => s.setContentArtist);
  const contentStatus = useContentStore((s) => s.contentStatus);
  const setContentStatus = useContentStore((s) => s.setContentStatus);
  const contentSortOrder = useContentStore((s) => s.contentSortOrder);
  const setContentSortOrder = useContentStore((s) => s.setContentSortOrder);
  const latePosts = useContentStore((s) => s.latePosts);
  const setLatePosts = useContentStore((s) => s.setLatePosts);
  const latePages = useContentStore((s) => s.latePages);
  const batchForm = useContentStore((s) => s.batchForm);
  const setBatchForm = useContentStore((s) => s.setBatchForm);
  const generatedSchedule = useContentStore((s) => s.generatedSchedule);
  const setGeneratedSchedule = useContentStore((s) => s.setGeneratedSchedule);
  const syncing = useContentStore((s) => s.syncing);
  const setSyncing = useContentStore((s) => s.setSyncing);
  const syncStatus = useContentStore((s) => s.syncStatus);
  const setSyncStatus = useContentStore((s) => s.setSyncStatus);
  const isExporting = useContentStore((s) => s.isExporting);
  const contentView = useContentStore((s) => s.contentView);
  const setContentView = useContentStore((s) => s.setContentView);
  const postSearch = useContentStore((s) => s.postSearch);
  const setPostSearch = useContentStore((s) => s.setPostSearch);
  const postPlatformFilter = useContentStore((s) => s.postPlatformFilter);
  const setPostPlatformFilter = useContentStore((s) => s.setPostPlatformFilter);
  const postAccountFilter = useContentStore((s) => s.postAccountFilter);
  const setPostAccountFilter = useContentStore((s) => s.setPostAccountFilter);
  const calendarMonth = useContentStore((s) => s.calendarMonth);
  const setCalendarMonth = useContentStore((s) => s.setCalendarMonth);
  const deletingPostId = useContentStore((s) => s.deletingPostId);
  const setDeletingPostId = useContentStore((s) => s.setDeletingPostId);
  const lastSynced = useContentStore((s) => s.lastSynced);
  const setLastSynced = useContentStore((s) => s.setLastSynced);

  const showScheduleModal = useUIStore((s) => s.showScheduleModal);
  const setShowScheduleModal = useUIStore((s) => s.setShowScheduleModal);
  const showLateAccounts = useUIStore((s) => s.showLateAccounts);
  const setShowLateAccounts = useUIStore((s) => s.setShowLateAccounts);
  const setShowLateConnectModal = useUIStore((s) => s.setShowLateConnectModal);
  const setOperatorTab = useUIStore((s) => s.setOperatorTab);

  const currentArtistId = useArtistStore((s) => s.currentArtistId);
  const firestoreArtists = useArtistStore((s) => s.firestoreArtists);

  const groupPosts = (posts) => {
    const grouped = {};
    posts.forEach((post) => {
      const key = `${post.page}-${post.scheduledFor}`;
      if (!grouped[key]) {
        grouped[key] = { ...post, platforms: [post.platform] };
      } else {
        grouped[key].platforms.push(post.platform);
      }
    });
    const sorted = Object.values(grouped).sort((a, b) =>
      a.scheduledFor.localeCompare(b.scheduledFor),
    );
    return contentSortOrder === 'newest' ? sorted.reverse() : sorted;
  };

  const allPosts = groupPosts(
    contentQueue.filter(
      (c) =>
        (contentStatus === 'all' || c.status === contentStatus) &&
        (contentArtist === 'all' || c.artist === contentArtist),
    ),
  );

  const todayStr = new Date().toISOString().split('T')[0];
  const todayPostsCount =
    contentQueue.filter((c) => c.scheduledFor.startsWith(todayStr)).length / 2;

  // Get unique accounts and categories for selected artist (from Late API)
  const artistPages = latePages.filter((p) => p.artist === batchForm.artist);
  const uniqueAccounts = artistPages.reduce((acc, p) => {
    const existing = acc.find((a) => a.handle === p.handle);
    if (!existing) {
      acc.push({ handle: p.handle, niche: p.niche, postTime: p.postTime });
    }
    return acc;
  }, []);
  const categories = [...new Set(artistPages.map((p) => p.niche))];

  // Filter accounts by selected category (must pick specific category)
  const filteredAccounts = uniqueAccounts.filter((a) => a.niche === batchForm.category);

  // Calculate required videos with 30/70 split
  const totalSlots = filteredAccounts.length * batchForm.numDays;
  const artistSlotsNeeded = Math.ceil(totalSlots * 0.3); // 30% artist music
  const adjacentSlotsNeeded = totalSlots - artistSlotsNeeded; // 70% adjacent music

  // Parse provided videos (split by newlines, commas, or detect URLs)
  const parseUrls = (text) => {
    return text
      .trim()
      .split(/[\n\r,]+/)
      .map((url) => url.trim())
      .filter((url) => url.startsWith('http'));
  };
  const artistVideosList = parseUrls(batchForm.artistVideos);
  const adjacentVideosList = parseUrls(batchForm.adjacentVideos);

  // Generate schedule preview - mixing artist and adjacent videos
  const generateSchedule = () => {
    const totalVideos = artistVideosList.length + adjacentVideosList.length;
    if (totalVideos === 0 || !batchForm.weekStart) return [];

    const schedule = [];
    const startDate = new Date(batchForm.weekStart);

    // Create a pool of videos tagged by type
    const artistPool = [...artistVideosList].map((url, i) => ({
      url,
      type: 'artist',
      num: i + 1,
    }));
    const adjacentPool = [...adjacentVideosList].map((url, i) => ({
      url,
      type: 'adjacent',
      num: i + 1,
    }));

    // For each day
    for (let dayOffset = 0; dayOffset < batchForm.numDays; dayOffset++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + dayOffset);
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDate.getDay()];

      // Each account gets a video - distribute to maintain ~30% artist ratio
      filteredAccounts.forEach((account, accountIndex) => {
        // Determine if this slot should be artist or adjacent
        // Spread artist videos evenly: roughly every 3rd post is artist music
        const slotIndex = dayOffset * filteredAccounts.length + accountIndex;
        const shouldBeArtist = slotIndex % 3 === 0 && artistPool.length > 0;

        let video;
        if (shouldBeArtist && artistPool.length > 0) {
          video = artistPool.shift();
        } else if (adjacentPool.length > 0) {
          video = adjacentPool.shift();
        } else if (artistPool.length > 0) {
          video = artistPool.shift();
        }

        if (video) {
          // Generate content from banks for this category
          const content = generatePostContent(account.niche, 'tiktok');

          schedule.push({
            date: dateStr,
            dayName,
            handle: account.handle,
            niche: account.niche,
            time: account.postTime,
            videoUrl: video.url,
            videoNum: video.num,
            videoType: video.type,
            caption: content.caption,
            hashtags: content.hashtags,
            platforms: ['tiktok', 'instagram'],
          });
        }
      });
    }

    return schedule.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  };

  const handleGeneratePreview = () => {
    const totalVideos = artistVideosList.length + adjacentVideosList.length;

    // If we have fewer videos than slots, confirm with user
    if (totalVideos < totalSlots && totalVideos > 0) {
      const proceed = window.confirm(
        `You've uploaded ${totalVideos} video(s) but have ${totalSlots} slots.\n\n` +
          `Only ${totalVideos} post(s) will be scheduled.\n\n` +
          `Continue anyway?`,
      );
      if (!proceed) return;
    }

    const schedule = generateSchedule();
    setGeneratedSchedule(schedule);
    setBatchForm((prev) => ({ ...prev, step: 2 }));
  };

  const handleScheduleSubmit = async () => {
    setSyncing(true);
    setSyncStatus('Scheduling posts...');

    // BUG-008: Capture artist ID at schedule start to prevent cross-artist scheduling
    const schedulingArtistId = currentArtistId;

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const post of generatedSchedule) {
      // BUG-008: Abort if artist changed during scheduling
      if (currentArtistId !== schedulingArtistId) {
        errors.push('Artist changed during scheduling — aborting remaining posts');
        failCount += generatedSchedule.length - successCount - failCount;
        break;
      }
      const scheduledFor = `${post.date}T${post.time}:00`;
      const fullCaption = `${post.caption} ${post.hashtags}`;

      // Get account IDs from latePages (dynamically loaded from Late API)
      const handlePages = latePages.filter((p) => p.handle === post.handle);
      if (handlePages.length === 0) {
        // Fallback to derived account mapping
        const legacyAccountIds = derivedLateAccountIds[post.handle];
        if (!legacyAccountIds) {
          log.error(`No Late account mapping for ${post.handle}`);
          failCount++;
          errors.push(`${post.handle}: No account mapping found`);
          continue;
        }
        // Use legacy mapping
        const platformsPayload = post.platforms
          .filter((p) => legacyAccountIds[p])
          .map((p) => ({ platform: p, accountId: legacyAccountIds[p] }));

        if (platformsPayload.length === 0) {
          failCount++;
          errors.push(`${post.handle}: No platform accounts found`);
          continue;
        }

        const result = await lateApi.schedulePost({
          platforms: platformsPayload,
          caption: fullCaption,
          videoUrl: post.videoUrl,
          scheduledFor,
          artistId: schedulingArtistId,
          user,
        });

        if (result.success) {
          successCount += platformsPayload.length;
        } else {
          failCount += platformsPayload.length;
          errors.push(`${post.handle}: ${result.error}`);
        }
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Build platforms array from latePages (preferred method)
      const platformsPayload = post.platforms
        .map((p) => {
          const pageForPlatform = handlePages.find((hp) => hp.platform === p);
          return pageForPlatform
            ? {
                platform: p,
                accountId: pageForPlatform.lateAccountId,
              }
            : null;
        })
        .filter(Boolean);

      if (platformsPayload.length === 0) {
        failCount++;
        errors.push(`${post.handle}: No platform accounts found`);
        continue;
      }

      log('Scheduling post:', {
        handle: post.handle,
        platforms: platformsPayload,
        caption: fullCaption,
        videoUrl: post.videoUrl,
        scheduledFor,
      });

      // Schedule via Late API - both platforms in one call
      const result = await lateApi.schedulePost({
        platforms: platformsPayload,
        caption: fullCaption,
        videoUrl: post.videoUrl,
        scheduledFor,
        artistId: schedulingArtistId,
        user,
      });

      if (result.success) {
        successCount += platformsPayload.length; // Count each platform
      } else {
        failCount += platformsPayload.length;
        errors.push(`${post.handle}: ${result.error}`);
      }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 200));
    }

    setSyncing(false);

    const artistCount = generatedSchedule.filter((p) => p.videoType === 'artist').length;
    const adjacentCount = generatedSchedule.filter((p) => p.videoType === 'adjacent').length;

    const postWord = (n) => (n === 1 ? 'post' : 'posts');

    if (failCount > 0) {
      setSyncStatus(`Warning: ${successCount} scheduled, ${failCount} failed`);
      log.error('Scheduling errors:', errors);
    } else {
      setSyncStatus(
        `Done: ${successCount} ${postWord(successCount)} scheduled! (${artistCount} artist / ${adjacentCount} adjacent)`,
      );
    }

    setTimeout(() => setSyncStatus(null), 5000);
    setShowScheduleModal(false);
    setBatchForm({
      artist: 'Boon',
      category: 'Fashion',
      artistVideos: '',
      adjacentVideos: '',
      weekStart: '',
      numDays: 7,
      step: 1,
    });
    setGeneratedSchedule([]);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus('Syncing...');
    const result = await lateApi.fetchScheduledPosts(1, currentArtistId);
    setSyncing(false);
    if (result.success) {
      const posts = Array.isArray(result.posts) ? result.posts : [];
      // Log full post structure to understand what Late returns
      if (posts.length > 0) {
        log('Sample Late post structure:', JSON.stringify(posts[0], null, 2));
        log('All post keys:', Object.keys(posts[0]));
        // Log platform structure specifically
        if (posts[0].platforms?.length > 0) {
          log('Platform entry:', JSON.stringify(posts[0].platforms[0], null, 2));
        }
      }
      setLatePosts(posts);
      setLastSynced(new Date());
      const postWord = posts.length === 1 ? 'post' : 'posts';
      setSyncStatus(`Done: Synced ${posts.length} ${postWord}`);
      sonnerToast.success(`Synced ${posts.length} ${postWord}`);
    } else {
      setSyncStatus(`Error: ${result.error}`);
      sonnerToast.error(`Sync failed: ${result.error}`);
    }
    setTimeout(() => setSyncStatus(null), 3000);
  };

  const confirmDeletePost = (postId, caption) => {
    setDeleteConfirmModal({
      show: true,
      postId,
      caption: caption || 'this post',
    });
  };

  const handleDeletePost = async (postId) => {
    setDeleteConfirmModal({ show: false, postId: null, caption: '' });
    setDeletingPostId(postId);
    const result = await lateApi.deletePost(postId, currentArtistId);
    setDeletingPostId(null);
    if (result.success) {
      setLatePosts((prev) => prev.filter((p) => p._id !== postId));
      sonnerToast.success('Post deleted successfully');
    } else {
      sonnerToast.error(`Failed to delete: ${result.error}`);
    }
  };

  // Get current artist name for display
  const currentArtist = firestoreArtists.find((a) => a.id === currentArtistId);
  const artistName = currentArtist?.name || 'this artist';

  return (
    <div>
      {/* Page Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Schedule</h1>
          <p className="text-sm text-zinc-500">
            {artistLateConnected
              ? `${latePosts.length} scheduled post${latePosts.length !== 1 ? 's' : ''}`
              : `Late not connected for ${artistName}`}
          </p>
        </div>
        <div className="flex gap-3">
          {artistLateConnected ? (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition"
              >
                + Batch Schedule
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowLateConnectModal(true)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-500 transition"
            >
              Enable Sync
            </button>
          )}
        </div>
      </div>

      {/* Sync Not Enabled Banner */}
      {!artistLateConnected && !checkingLateStatus && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center mb-6">
          <div className="text-4xl mb-4">&#128279;</div>
          <h3 className="text-xl font-semibold mb-2">Enable Sync for {artistName}</h3>
          <p className="text-zinc-400 mb-6 max-w-md mx-auto">
            To schedule and manage posts for {artistName}, enable sync by connecting their posting
            account.
          </p>
          <button
            onClick={() => setShowLateConnectModal(true)}
            className="px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 transition"
          >
            Enable Sync
          </button>
        </div>
      )}

      {checkingLateStatus && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center mb-6">
          <div className="animate-spin text-4xl mb-4">&#9203;</div>
          <p className="text-zinc-400">Checking sync status...</p>
        </div>
      )}

      {/* Batch Schedule Modal */}
      {showScheduleModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
          onClick={() => {
            setShowScheduleModal(false);
            setBatchForm((prev) => ({ ...prev, step: 1 }));
            setGeneratedSchedule([]);
          }}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-bold">Batch Schedule</h2>
                <p className="text-sm text-zinc-500 mt-1">
                  {batchForm.step === 1 ? 'Step 1: Setup' : 'Step 2: Preview & Confirm'}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowScheduleModal(false);
                  setBatchForm((prev) => ({ ...prev, step: 1 }));
                  setGeneratedSchedule([]);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition"
              >
                &#10005;
              </button>
            </div>

            {batchForm.step === 1 ? (
              <>
                <div className="p-6 space-y-5 overflow-y-auto flex-1">
                  {/* Artist & Category Row */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-2">Artist</label>
                      <select
                        value={batchForm.artist}
                        onChange={(e) =>
                          setBatchForm((prev) => ({
                            ...prev,
                            artist: e.target.value,
                          }))
                        }
                        className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-zinc-500"
                      >
                        {visibleArtists.map((a) => (
                          <option key={a.id} value={a.name}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-2">
                        Aesthetic Category
                      </label>
                      <select
                        value={batchForm.category}
                        onChange={(e) =>
                          setBatchForm((prev) => ({
                            ...prev,
                            category: e.target.value,
                          }))
                        }
                        className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-zinc-500"
                      >
                        {getCategoryNames(contentBanks).map((cat) => {
                          const count = uniqueAccounts.filter((a) => a.niche === cat).length;
                          return (
                            <option key={cat} value={cat}>
                              {cat} ({count} accounts)
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-2">Days</label>
                      <select
                        value={batchForm.numDays}
                        onChange={(e) =>
                          setBatchForm((prev) => ({
                            ...prev,
                            numDays: parseInt(e.target.value),
                          }))
                        }
                        className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-zinc-500"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 14].map((d) => (
                          <option key={d} value={d}>
                            {d} day{d > 1 ? 's' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Selected Accounts Preview */}
                  <div className="bg-zinc-800/50 rounded-xl p-4">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
                      {batchForm.category} Accounts ({filteredAccounts.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {filteredAccounts.map((acc) => (
                        <span
                          key={acc.handle}
                          className="px-3 py-1.5 bg-zinc-800 rounded-lg text-sm"
                        >
                          {acc.handle} <span className="text-zinc-500">@ {acc.postTime}</span>
                        </span>
                      ))}
                      {filteredAccounts.length === 0 && (
                        <span className="text-zinc-500 text-sm">No accounts in this category</span>
                      )}
                    </div>
                  </div>

                  {/* Start Date */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={batchForm.weekStart}
                      onChange={(e) =>
                        setBatchForm((prev) => ({
                          ...prev,
                          weekStart: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  {/* Videos Required - 30/70 Split */}
                  <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-zinc-300">Videos Needed</p>
                      <p className="text-2xl font-bold text-white">{totalSlots}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                        <p className="text-emerald-400 font-medium">
                          {artistSlotsNeeded} Artist Videos
                        </p>
                        <p className="text-xs text-zinc-500">~30% {batchForm.artist}'s music</p>
                      </div>
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <p className="text-blue-400 font-medium">
                          {adjacentSlotsNeeded} Adjacent Videos
                        </p>
                        <p className="text-xs text-zinc-500">~70% similar artists</p>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-500 mt-3">
                      {filteredAccounts.length} accounts &times; {batchForm.numDays} days ={' '}
                      {totalSlots} unique videos
                    </p>
                  </div>

                  {/* Two-Column Video Input */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Artist Videos */}
                    <div>
                      <label className="block text-sm font-medium text-emerald-400 mb-2">
                        {batchForm.artist}'s Music ({artistSlotsNeeded} needed)
                      </label>
                      <textarea
                        value={batchForm.artistVideos}
                        onChange={(e) =>
                          setBatchForm((prev) => ({
                            ...prev,
                            artistVideos: e.target.value,
                          }))
                        }
                        placeholder={`Paste ${artistSlotsNeeded} Google Drive links...\n\nhttps://drive.google.com/...\nhttps://drive.google.com/...`}
                        rows={5}
                        className="w-full px-4 py-3 bg-zinc-800 border border-emerald-500/30 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 font-mono text-xs resize-none"
                      />
                      {(() => {
                        const provided = artistVideosList.length;
                        const isEnough = provided >= artistSlotsNeeded;
                        return (
                          provided > 0 && (
                            <p
                              className={`text-xs mt-2 ${isEnough ? 'text-emerald-400' : 'text-red-400'}`}
                            >
                              {provided} of {artistSlotsNeeded}{' '}
                              {isEnough
                                ? '\u2713'
                                : `\u2014 need ${artistSlotsNeeded - provided} more`}
                            </p>
                          )
                        );
                      })()}
                    </div>

                    {/* Adjacent Videos */}
                    <div>
                      <label className="block text-sm font-medium text-blue-400 mb-2">
                        Adjacent Artists ({adjacentSlotsNeeded} needed)
                      </label>
                      <textarea
                        value={batchForm.adjacentVideos}
                        onChange={(e) =>
                          setBatchForm((prev) => ({
                            ...prev,
                            adjacentVideos: e.target.value,
                          }))
                        }
                        placeholder={`Paste ${adjacentSlotsNeeded} Google Drive links...\n\nhttps://drive.google.com/...\nhttps://drive.google.com/...`}
                        rows={5}
                        className="w-full px-4 py-3 bg-zinc-800 border border-blue-500/30 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50 font-mono text-xs resize-none"
                      />
                      {(() => {
                        const provided = adjacentVideosList.length;
                        const isEnough = provided >= adjacentSlotsNeeded;
                        return (
                          provided > 0 && (
                            <p
                              className={`text-xs mt-2 ${isEnough ? 'text-blue-400' : 'text-red-400'}`}
                            >
                              {provided} of {adjacentSlotsNeeded}{' '}
                              {isEnough
                                ? '\u2713'
                                : `\u2014 need ${adjacentSlotsNeeded - provided} more`}
                            </p>
                          )
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="p-6 border-t border-zinc-800 shrink-0">
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-zinc-500">
                      {artistVideosList.length + adjacentVideosList.length} of {totalSlots} videos
                      provided
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowScheduleModal(false)}
                        className="px-4 py-2 text-zinc-400 hover:text-white transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleGeneratePreview}
                        disabled={
                          !batchForm.weekStart ||
                          filteredAccounts.length === 0 ||
                          artistVideosList.length + adjacentVideosList.length === 0
                        }
                        className="px-6 py-2 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Preview Schedule &rarr;
                      </button>
                    </div>
                  </div>
                  {/* Helper text for disabled state */}
                  {(!batchForm.weekStart ||
                    filteredAccounts.length === 0 ||
                    artistVideosList.length + adjacentVideosList.length === 0) && (
                    <p className="text-xs text-zinc-500 mt-2 text-right">
                      {!batchForm.weekStart
                        ? 'Select a start date'
                        : filteredAccounts.length === 0
                          ? 'No accounts for selected category'
                          : 'Add video URLs above'}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Step 2: Preview */}
                <div className="p-6 overflow-y-auto flex-1">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm text-zinc-400">
                      {generatedSchedule.length} {generatedSchedule.length === 1 ? 'post' : 'posts'}{' '}
                      to {[...new Set(generatedSchedule.map((p) => p.handle))].length}{' '}
                      {[...new Set(generatedSchedule.map((p) => p.handle))].length === 1
                        ? 'account'
                        : 'accounts'}
                    </p>
                    <button
                      onClick={() => setBatchForm((prev) => ({ ...prev, step: 1 }))}
                      className="text-sm text-zinc-500 hover:text-white"
                    >
                      &larr; Back to Edit
                    </button>
                  </div>

                  {/* Stats Summary */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold">{generatedSchedule.length}</p>
                      <p className="text-xs text-zinc-500">Total Posts</p>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-emerald-400">
                        {generatedSchedule.filter((p) => p.videoType === 'artist').length}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Artist Music (
                        {Math.round(
                          (generatedSchedule.filter((p) => p.videoType === 'artist').length /
                            generatedSchedule.length) *
                            100,
                        )}
                        %)
                      </p>
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-blue-400">
                        {generatedSchedule.filter((p) => p.videoType === 'adjacent').length}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Adjacent Artists (
                        {Math.round(
                          (generatedSchedule.filter((p) => p.videoType === 'adjacent').length /
                            generatedSchedule.length) *
                            100,
                        )}
                        %)
                      </p>
                    </div>
                  </div>

                  {/* Schedule Grid */}
                  <div className="bg-zinc-800/50 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm min-w-[500px]">
                      <thead>
                        <tr className="border-b border-zinc-700">
                          <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">
                            Day
                          </th>
                          <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">
                            Account
                          </th>
                          <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">
                            Time
                          </th>
                          <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">
                            Type
                          </th>
                          <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">
                            Caption
                          </th>
                          <th className="text-left p-2 sm:p-3 text-zinc-500 font-medium text-xs sm:text-sm">
                            Video
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {generatedSchedule.slice(0, 21).map((post, i) => (
                          <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                            <td className="p-3 text-zinc-400">
                              {post.dayName} {post.date.slice(5)}
                            </td>
                            <td className="p-3 font-mono text-sm">{post.handle}</td>
                            <td className="p-3 text-zinc-400">{post.time}</td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  post.videoType === 'artist'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-blue-500/20 text-blue-400'
                                }`}
                              >
                                {post.videoType === 'artist' ? '\uD83C\uDFB5' : '\uD83C\uDFB6'}
                              </span>
                            </td>
                            <td
                              className="p-3 text-zinc-400 text-xs max-w-[150px] truncate"
                              title={`${post.caption} ${post.hashtags}`}
                            >
                              {post.caption}
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-1 bg-zinc-700 rounded text-xs">
                                {post.videoType === 'artist' ? 'A' : 'Adj'}-{post.videoNum}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {generatedSchedule.length > 21 && (
                      <p className="text-center py-3 text-sm text-zinc-500">
                        + {generatedSchedule.length - 21} more posts...
                      </p>
                    )}
                  </div>

                  {/* Sample Post Preview */}
                  {generatedSchedule.length > 0 && (
                    <div className="mt-4 bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4">
                      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
                        Sample Post Content
                      </p>
                      <p className="text-sm text-white mb-1">{generatedSchedule[0].caption}</p>
                      <p className="text-xs text-zinc-500 font-mono">
                        {generatedSchedule[0].hashtags}
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-6 border-t border-zinc-800 flex justify-between items-center shrink-0">
                  <p className="text-sm text-zinc-500">Each post goes to both TikTok & Instagram</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setBatchForm((prev) => ({ ...prev, step: 1 }))}
                      className="px-4 py-2 text-zinc-400 hover:text-white transition"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleScheduleSubmit}
                      className="px-6 py-2 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition"
                    >
                      Schedule {generatedSchedule.length * 2}{' '}
                      {generatedSchedule.length * 2 === 1 ? 'Post' : 'Posts'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
              Artist
            </label>
            <div className="flex gap-1">
              <button
                onClick={() => setContentArtist('all')}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${contentArtist === 'all' ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}
              >
                All
              </button>
              {visibleArtists.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setContentArtist(a.name)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition ${contentArtist === a.name ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
              Status
            </label>
            <div className="flex gap-1">
              {['all', 'scheduled', 'posted'].map((s) => (
                <button
                  key={s}
                  onClick={() => setContentStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition ${contentStatus === s ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
              Sort
            </label>
            <div className="flex gap-1">
              <button
                onClick={() => setContentSortOrder('newest')}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${contentSortOrder === 'newest' ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}
              >
                Newest
              </button>
              <button
                onClick={() => setContentSortOrder('oldest')}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${contentSortOrder === 'oldest' ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-500 hover:bg-zinc-800'}`}
              >
                Oldest
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedPosts.size > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition flex items-center gap-2"
            >
              {bulkDeleting ? (
                <>
                  <span className="animate-spin">&#10227;</span>
                  Deleting...
                </>
              ) : (
                <>&#128465; Delete {selectedPosts.size} selected</>
              )}
            </button>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              syncing
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            } disabled:cursor-not-allowed`}
          >
            {syncing ? (
              <>
                <span className="animate-spin">&#8635;</span>
                Syncing...
              </>
            ) : (
              <>&#8635; Sync</>
            )}
          </button>
          <button
            onClick={() => setShowScheduleModal(true)}
            className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition"
          >
            + Schedule Post
          </button>
          <button
            onClick={fetchLateAccounts}
            disabled={syncing}
            className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50"
          >
            View Accounts
          </button>
          <button
            onClick={exportToCSV}
            disabled={latePosts.length === 0 || isExporting}
            className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            {isExporting ? (
              <>
                <span className="animate-spin">&#10227;</span>
                Exporting...
              </>
            ) : (
              '\u2193 Export CSV'
            )}
          </button>
        </div>
      </div>

      {/* Connected Accounts Modal */}
      {showLateAccounts && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setShowLateAccounts(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold">Connected Accounts</h2>
              <button
                onClick={() => setShowLateAccounts(false)}
                className="text-zinc-500 hover:text-white"
              >
                &#10005;
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {Object.keys(derivedLateAccountIds).length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-zinc-400 mb-2">No accounts connected yet</p>
                  <button
                    onClick={() => {
                      setShowLateAccounts(false);
                      setOperatorTab('pages');
                    }}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    Go to Pages
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-zinc-500 mb-4">
                    {latePages.length} account
                    {latePages.length !== 1 ? 's' : ''} synced:
                  </p>
                  <div className="space-y-3">
                    {Object.entries(derivedLateAccountIds).map(([handle, ids]) => (
                      <div key={handle} className="bg-zinc-800 rounded-lg p-4">
                        <p className="font-medium text-white mb-2">{handle}</p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {Object.entries(ids).map(([platform, accountId]) => (
                            <div key={platform} className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded ${
                                  platform === 'tiktok'
                                    ? 'bg-pink-500/20 text-pink-400'
                                    : platform === 'instagram'
                                      ? 'bg-purple-500/20 text-purple-400'
                                      : platform === 'youtube'
                                        ? 'bg-red-500/20 text-red-400'
                                        : platform === 'facebook'
                                          ? 'bg-blue-500/20 text-blue-400'
                                          : 'bg-zinc-500/20 text-zinc-400'
                                }`}
                              >
                                {platform}
                              </span>
                              <code className="text-zinc-400 truncate max-w-[120px]">
                                {accountId}
                              </code>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-zinc-700">
                    <p className="text-xs text-zinc-500">
                      Total: {latePages.length} platform connection
                      {latePages.length !== 1 ? 's' : ''} across{' '}
                      {Object.keys(derivedLateAccountIds).length} handle
                      {Object.keys(derivedLateAccountIds).length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync Status */}
      {syncStatus && (
        <div className="mb-4 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm">
          {syncStatus}
        </div>
      )}

      {/* View Toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">View:</span>
          <div className="flex bg-zinc-800 rounded-lg p-1">
            <button
              onClick={() => setContentView('list')}
              className={`px-3 py-1.5 rounded-md text-sm transition ${contentView === 'list' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              List
            </button>
            <button
              onClick={() => setContentView('calendar')}
              className={`px-3 py-1.5 rounded-md text-sm transition ${contentView === 'calendar' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              Timeline
            </button>
            <button
              onClick={() => setContentView('month')}
              className={`px-3 py-1.5 rounded-md text-sm transition ${contentView === 'month' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              Month
            </button>
          </div>
          {latePosts.length === 0 && (
            <span className="text-xs text-zinc-500 ml-2">Click "Sync" to load posts</span>
          )}
        </div>
        {contentView === 'month' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCalendarMonth(new Date())}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition text-sm"
            >
              Today
            </button>
            <button
              onClick={() =>
                setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1))
              }
              className="px-3 py-1.5 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition"
            >
              &larr;
            </button>
            <span className="text-sm font-medium w-32 text-center">
              {calendarMonth.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <button
              onClick={() =>
                setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1))
              }
              className="px-3 py-1.5 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition"
            >
              &rarr;
            </button>
          </div>
        )}
      </div>

      {/* Search and Filter Bar */}
      {latePosts.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              value={postSearch}
              onChange={(e) => setPostSearch(e.target.value)}
              placeholder="Search posts by caption..."
              className="w-full px-4 py-2 pl-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
              &#128269;
            </span>
          </div>
          <div className="flex bg-zinc-800 rounded-lg p-1 flex-wrap">
            <button
              onClick={() => setPostPlatformFilter('all')}
              className={`px-3 py-1.5 rounded-md text-sm transition ${postPlatformFilter === 'all' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              All
            </button>
            {getPlatformKeys().map((platform) => {
              const config = getPlatformConfig(platform);
              return (
                <button
                  key={platform}
                  onClick={() => setPostPlatformFilter(platform)}
                  className={`px-3 py-1.5 rounded-md text-sm transition ${postPlatformFilter === platform ? `${config.bgColor} ${config.textColor}` : 'text-zinc-400 hover:text-white'}`}
                >
                  {config.fullName}
                </button>
              );
            })}
          </div>
          {/* Account Filter Dropdown */}
          <select
            value={postAccountFilter}
            onChange={(e) => setPostAccountFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
          >
            <option value="all">All Accounts</option>
            {getUniqueAccounts(latePosts).map((account) => (
              <option key={account} value={account}>
                @{account}
              </option>
            ))}
          </select>
          {(postSearch ||
            postPlatformFilter !== 'all' ||
            contentStatus !== 'all' ||
            postAccountFilter !== 'all') && (
            <button
              onClick={() => {
                setPostSearch('');
                setPostPlatformFilter('all');
                setContentStatus('all');
                setPostAccountFilter('all');
              }}
              className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Stats Cards - with filtered data */}
      {(() => {
        // Apply the same filtering to stats
        const filteredStatsData = latePosts.filter((post) => {
          if (postSearch && !(post.content || '').toLowerCase().includes(postSearch.toLowerCase()))
            return false;
          if (postPlatformFilter !== 'all') {
            const platforms = (post.platforms || []).map((p) => p.platform || p);
            if (!platforms.includes(postPlatformFilter)) return false;
          }
          if (contentStatus !== 'all') {
            const postStatus = post.status === 'published' ? 'posted' : post.status;
            if (postStatus !== contentStatus) return false;
          }
          if (postAccountFilter !== 'all') {
            if (getPostAccount(post) !== postAccountFilter) return false;
          }
          return true;
        });
        const hasFilters =
          postSearch ||
          postPlatformFilter !== 'all' ||
          contentStatus !== 'all' ||
          postAccountFilter !== 'all';
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-zinc-500 text-xs mb-1">
                {hasFilters ? 'Filtered Posts' : 'Synced Posts'}
              </p>
              <p className="text-2xl font-bold text-purple-400">
                {filteredStatsData.length}
                {hasFilters && (
                  <span className="text-sm text-zinc-500 ml-1">/ {latePosts.length}</span>
                )}
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-zinc-500 text-xs mb-1">Scheduled</p>
              <p className="text-2xl font-bold">
                {filteredStatsData.filter((p) => p.status === 'scheduled').length}
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-zinc-500 text-xs mb-1">Posted</p>
              <p className="text-2xl font-bold text-green-400">
                {
                  filteredStatsData.filter((p) => p.status === 'posted' || p.status === 'published')
                    .length
                }
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-zinc-500 text-xs mb-1">Schedule Status</p>
              <p className="text-sm font-medium text-green-400">&#9679; Connected</p>
              {lastSynced && (
                <p className="text-xs text-zinc-500 mt-1">
                  Synced{' '}
                  {lastSynced.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Loading State */}
      {syncing && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden animate-pulse"
            >
              <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-800/50">
                <div className="h-6 bg-zinc-700 rounded w-32"></div>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-4">
                  <div className="h-4 bg-zinc-800 rounded w-16"></div>
                  <div className="h-4 bg-zinc-800 rounded w-48"></div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="h-4 bg-zinc-800 rounded w-16"></div>
                  <div className="h-4 bg-zinc-800 rounded w-64"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Calendar View */}
      {!syncing &&
        contentView === 'calendar' &&
        (() => {
          // Filter posts first
          const filteredLatePosts = latePosts.filter((post) => {
            // Search filter
            if (
              postSearch &&
              !(post.content || '').toLowerCase().includes(postSearch.toLowerCase())
            ) {
              return false;
            }
            // Platform filter
            if (postPlatformFilter !== 'all') {
              const platforms = (post.platforms || []).map((p) => p.platform || p);
              if (!platforms.includes(postPlatformFilter)) return false;
            }
            // Status filter - map 'published' to 'posted' for UI
            if (contentStatus !== 'all') {
              const postStatus = post.status === 'published' ? 'posted' : post.status;
              if (postStatus !== contentStatus) return false;
            }
            // Account filter
            if (postAccountFilter !== 'all') {
              if (getPostAccount(post) !== postAccountFilter) return false;
            }
            return true;
          });

          // Group posts by date
          const postsByDate = filteredLatePosts.reduce((acc, post) => {
            const date = post.scheduledFor ? post.scheduledFor.split('T')[0] : 'Unknown';
            if (!acc[date]) acc[date] = [];
            acc[date].push(post);
            return acc;
          }, {});

          const sortedDates = Object.keys(postsByDate).sort((a, b) =>
            contentSortOrder === 'newest' ? b.localeCompare(a) : a.localeCompare(b),
          );

          return (
            <div className="space-y-4">
              {sortedDates.length === 0 ? (
                <SharedEmptyState
                  icon="\uD83D\uDCC5"
                  title="No posts scheduled"
                  description={
                    postSearch || postPlatformFilter !== 'all'
                      ? 'No posts match your filters. Try adjusting your search.'
                      : 'Sync your posts to see your scheduled content timeline.'
                  }
                  actionLabel={!postSearch && postPlatformFilter === 'all' ? 'Sync' : undefined}
                  onAction={!postSearch && postPlatformFilter === 'all' ? handleSync : undefined}
                />
              ) : (
                sortedDates.map((date) => {
                  const datePosts = postsByDate[date];
                  const dateObj = new Date(date + 'T12:00:00');
                  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
                    dateObj.getDay()
                  ];
                  const monthDay = dateObj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  });

                  return (
                    <div
                      key={date}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-800/50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="text-center">
                            <p className="text-xs text-zinc-500 uppercase">{dayName}</p>
                            <p className="text-lg font-bold">{monthDay}</p>
                          </div>
                          <span className="text-sm text-zinc-500">
                            {datePosts.length} post
                            {datePosts.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-zinc-800/50">
                        {datePosts.map((post) => (
                          <div
                            key={post._id}
                            className="p-4 flex items-center justify-between hover:bg-zinc-800/30 transition"
                          >
                            <div className="flex items-center gap-4">
                              <div className="text-sm text-zinc-400 w-16">
                                {post.scheduledFor
                                  ? new Date(post.scheduledFor).toLocaleTimeString('en-US', {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                    })
                                  : '-'}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  {(post.platforms || []).map((p) => {
                                    const platformKey = p.platform || p;
                                    const config = getPlatformConfig(platformKey);
                                    return (
                                      <span
                                        key={platformKey}
                                        className={`px-2 py-0.5 rounded text-xs ${config.bgColor} ${config.textColor}`}
                                      >
                                        {config.fullName}
                                      </span>
                                    );
                                  })}
                                </div>
                                <p className="text-sm text-zinc-300 mt-1 max-w-md truncate">
                                  {post.content || 'No caption'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {getPostUrls(post).map((pu, idx) => {
                                const config = getPlatformConfig(pu.platform);
                                return (
                                  <a
                                    key={idx}
                                    href={pu.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`px-2 py-1 rounded text-xs font-medium transition ${config.bgColor} ${config.textColor} ${config.hoverBg}`}
                                  >
                                    &#8599;
                                  </a>
                                );
                              })}
                              <button
                                onClick={() =>
                                  confirmDeletePost(post._id, post.content?.substring(0, 50))
                                }
                                disabled={deletingPostId === post._id}
                                className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded-lg transition disabled:opacity-50"
                              >
                                {deletingPostId === post._id ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

      {/* Month View */}
      {!syncing &&
        contentView === 'month' &&
        (() => {
          // Filter posts first
          const filteredLatePosts = latePosts.filter((post) => {
            // Search filter
            if (
              postSearch &&
              !(post.content || '').toLowerCase().includes(postSearch.toLowerCase())
            ) {
              return false;
            }
            // Platform filter
            if (postPlatformFilter !== 'all') {
              const platforms = (post.platforms || []).map((p) => p.platform || p);
              if (!platforms.includes(postPlatformFilter)) return false;
            }
            // Status filter - map 'published' to 'posted' for UI
            if (contentStatus !== 'all') {
              const postStatus = post.status === 'published' ? 'posted' : post.status;
              if (postStatus !== contentStatus) return false;
            }
            // Account filter
            if (postAccountFilter !== 'all') {
              if (getPostAccount(post) !== postAccountFilter) return false;
            }
            return true;
          });

          // Get calendar grid for the month
          const year = calendarMonth.getFullYear();
          const month = calendarMonth.getMonth();
          const firstDay = new Date(year, month, 1);
          const lastDay = new Date(year, month + 1, 0);
          const startPadding = firstDay.getDay();
          const totalDays = lastDay.getDate();

          // Group posts by date
          const postsByDate = filteredLatePosts.reduce((acc, post) => {
            if (!post.scheduledFor) return acc;
            const date = post.scheduledFor.split('T')[0];
            if (!acc[date]) acc[date] = [];
            acc[date].push(post);
            return acc;
          }, {});

          // Generate calendar grid
          const days = [];
          for (let i = 0; i < startPadding; i++) {
            days.push(null);
          }
          for (let d = 1; d <= totalDays; d++) {
            days.push(d);
          }

          return (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-zinc-800">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div
                    key={day}
                    className="p-3 text-center text-sm font-medium text-zinc-500 border-r border-zinc-800 last:border-r-0"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7">
                {days.map((day, i) => {
                  if (day === null) {
                    return (
                      <div
                        key={`empty-${i}`}
                        className="min-h-[120px] bg-zinc-950/50 border-r border-b border-zinc-800"
                      />
                    );
                  }

                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayPosts = postsByDate[dateStr] || [];
                  const isToday = new Date().toISOString().split('T')[0] === dateStr;

                  // UI-14: Check if this day is in the current week
                  const today = new Date();
                  const startOfWeek = new Date(today);
                  startOfWeek.setDate(today.getDate() - today.getDay());
                  const endOfWeek = new Date(startOfWeek);
                  endOfWeek.setDate(startOfWeek.getDate() + 6);
                  const dayDate = new Date(year, month, day);
                  const isCurrentWeek = dayDate >= startOfWeek && dayDate <= endOfWeek;

                  return (
                    <div
                      key={day}
                      onClick={() =>
                        dayPosts.length > 0 &&
                        setDayDetailDrawer({
                          isOpen: true,
                          date: dateStr,
                          posts: dayPosts,
                        })
                      }
                      className={`min-h-[120px] p-2 border-r border-b border-zinc-800 last:border-r-0 transition-colors ${
                        isToday ? 'bg-purple-900/20' : isCurrentWeek ? 'bg-zinc-800/30' : ''
                      } ${dayPosts.length > 0 ? 'cursor-pointer hover:bg-zinc-800/50' : ''}`}
                    >
                      <div
                        className={`text-sm font-medium mb-2 ${isToday ? 'text-purple-400' : 'text-zinc-400'}`}
                      >
                        {day}
                        {dayPosts.length > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs">
                            {dayPosts.length}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 max-h-[80px] overflow-y-auto">
                        {dayPosts.slice(0, 3).map((post, idx) => {
                          const time = post.scheduledFor
                            ? new Date(post.scheduledFor).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                              })
                            : '';
                          const platforms = (post.platforms || []).map((p) => p.platform || p);
                          return (
                            <div
                              key={post._id || idx}
                              className="text-xs p-1.5 bg-zinc-800 rounded truncate hover:bg-zinc-700 cursor-pointer transition"
                              title={post.content}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDayDetailDrawer({
                                  isOpen: true,
                                  date: dateStr,
                                  posts: dayPosts,
                                });
                              }}
                            >
                              <span className="text-zinc-500">{time}</span>{' '}
                              {platforms.includes('tiktok') && (
                                <span className="text-pink-400">TT</span>
                              )}
                              {platforms.includes('instagram') && (
                                <span className="text-purple-400 ml-1">IG</span>
                              )}
                            </div>
                          );
                        })}
                        {dayPosts.length > 3 && (
                          <div className="text-xs text-zinc-500 text-center">
                            +{dayPosts.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

      {/* List View */}
      {!syncing && contentView === 'list' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">
                  Date & Time
                </th>
                <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">
                  Platforms
                </th>
                <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">
                  Caption
                </th>
                <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">
                  Status
                </th>
                <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">
                  View
                </th>
                <th className="text-left p-3 sm:p-4 text-xs sm:text-sm font-medium text-zinc-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filteredPosts = latePosts
                  .filter((post) => {
                    // Search filter
                    if (
                      postSearch &&
                      !(post.content || '').toLowerCase().includes(postSearch.toLowerCase())
                    ) {
                      return false;
                    }
                    // Platform filter
                    if (postPlatformFilter !== 'all') {
                      const platforms = (post.platforms || []).map((p) => p.platform || p);
                      if (!platforms.includes(postPlatformFilter)) return false;
                    }
                    // Status filter - map 'published' to 'posted' for UI
                    if (contentStatus !== 'all') {
                      const postStatus = post.status === 'published' ? 'posted' : post.status;
                      if (postStatus !== contentStatus) return false;
                    }
                    // Account filter
                    if (postAccountFilter !== 'all') {
                      if (getPostAccount(post) !== postAccountFilter) return false;
                    }
                    return true;
                  })
                  .sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));

                return filteredPosts.length > 0 ? (
                  filteredPosts.map((post) => (
                    <tr
                      key={post._id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition"
                    >
                      <td className="p-4 text-sm text-zinc-400">
                        {post.scheduledFor
                          ? new Date(post.scheduledFor).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })
                          : '-'}
                      </td>
                      <td className="p-4">
                        <div className="flex gap-1">
                          {(post.platforms || []).map((p, i) => {
                            const platformKey = p.platform || p;
                            const config = getPlatformConfig(platformKey);
                            return (
                              <span
                                key={i}
                                className={`px-2 py-0.5 rounded text-xs ${config.bgColor} ${config.textColor}`}
                              >
                                {config.label}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="p-4 text-sm max-w-[200px] truncate">
                        {post.content || 'No caption'}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            post.status === 'scheduled'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : post.status === 'posted'
                                ? 'bg-green-500/20 text-green-400'
                                : post.status === 'failed'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-zinc-500/20 text-zinc-400'
                          }`}
                        >
                          {post.status || 'unknown'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex gap-2 flex-wrap">
                          {getPostUrls(post).length > 0 ? (
                            getPostUrls(post).map((pu, idx) => {
                              const config = getPlatformConfig(pu.platform);
                              return (
                                <a
                                  key={idx}
                                  href={pu.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`px-2 py-1 rounded text-xs font-medium transition ${config.bgColor} ${config.textColor} ${config.hoverBg}`}
                                >
                                  View {pu.label}
                                </a>
                              );
                            })
                          ) : (
                            <span className="text-xs text-zinc-600">&mdash;</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <button
                          onClick={() =>
                            confirmDeletePost(post._id, post.content?.substring(0, 50))
                          }
                          disabled={deletingPostId === post._id}
                          className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded-lg transition disabled:opacity-50"
                        >
                          {deletingPostId === post._id ? '...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="p-8">
                      <SharedEmptyState
                        icon="\uD83D\uDCCB"
                        title="No posts found"
                        description={
                          postSearch || postPlatformFilter !== 'all'
                            ? 'No posts match your current filters. Try adjusting your search.'
                            : 'Sync your posts to see your scheduled content.'
                        }
                        actionLabel={
                          !postSearch && postPlatformFilter === 'all' ? 'Sync' : undefined
                        }
                        onAction={
                          !postSearch && postPlatformFilter === 'all' ? handleSync : undefined
                        }
                      />
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
