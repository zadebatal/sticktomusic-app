import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { useToast } from '../ui';
import { getTierForSets, computeSocialSetsUsed, shouldShowPaymentUI } from '../../services/subscriptionService';
import { PLATFORM_META, getProfileUrl, formatFollowers } from '../../utils/platformUtils';
import { subscribeToScheduledPosts, POST_STATUS, PLATFORM_COLORS } from '../../services/scheduledPostsService';
import { subscribeToCreatedContent } from '../../services/libraryService';
import { getLateProfiles, createLateProfile, getConnectUrl } from '../../services/lateService';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { IconButton } from '../../ui/components/IconButton';
import { IconWithBackground } from '../../ui/components/IconWithBackground';
import {
  FeatherEye, FeatherHeart, FeatherCalendar, FeatherTrendingUp,
  FeatherVideo, FeatherPlay, FeatherEdit2, FeatherLayers, FeatherSend,
  FeatherMusic, FeatherCamera
} from '@subframe/core';

/** Returns a human-readable relative time string (e.g. "2 days ago") */
const getTimeAgo = (date) => {
  if (!date) return '';
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * ArtistDashboard — Home tab for artist and collaborator roles.
 * Shows welcome, stats, recent content, upcoming posts, connected accounts, and operator contact.
 */
const ArtistDashboard = ({
  user,
  artistId,
  latePages = [],
  socialSetsAllowed = 0,
  handleGroups: handleGroupsProp = [],
  onHandleGroupsChange,
  db = null,
  manualAccountsByArtist = {},
  onAddManualAccounts,
  onRemoveManualAccount,
  onLoadLatePages,
  onNavigate,
}) => {
  const { toastInfo, toastError, toastSuccess } = useToast();

  // latePages is pre-filtered to this artist's pages by parent
  const socialSetsUsed = computeSocialSetsUsed(latePages);
  const tierInfo = getTierForSets(socialSetsAllowed);
  const showPayment = shouldShowPaymentUI(user);

  // Local scheduler subscription
  const [localPosts, setLocalPosts] = useState([]);
  useEffect(() => {
    if (!db || !artistId) return;
    const unsub = subscribeToScheduledPosts(db, artistId, setLocalPosts);
    return unsub;
  }, [db, artistId]);

  // Created content subscription (for Recent Content section + stats)
  const [createdContent, setCreatedContent] = useState({ videos: [], slideshows: [] });
  useEffect(() => {
    if (!db || !artistId) return;
    const unsub = subscribeToCreatedContent(db, artistId, setCreatedContent);
    return unsub;
  }, [db, artistId]);

  // All content items sorted by createdAt descending
  const recentContent = useMemo(() => {
    const all = [
      ...(createdContent.videos || []).map(v => ({ ...v, _type: 'video' })),
      ...(createdContent.slideshows || []).map(s => ({ ...s, _type: 'slideshow' })),
    ];
    all.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db2 - da;
    });
    return all;
  }, [createdContent]);

  const totalContentCount = recentContent.length;

  // Upcoming posts (next 10, sorted by date) — from local scheduler
  const upcomingPosts = localPosts
    .filter(p => p.status === POST_STATUS.SCHEDULED)
    .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))
    .slice(0, 10);

  // Recently posted (last 10, reverse chronological)
  const postedPosts = localPosts
    .filter(p => p.status === POST_STATUS.POSTED)
    .sort((a, b) => new Date(b.postedAt || b.scheduledTime) - new Date(a.postedAt || a.scheduledTime))
    .slice(0, 10);

  // Connected platforms for this artist (already filtered)
  const artistPages = latePages;

  // Manual accounts for this artist
  const manualAccounts = manualAccountsByArtist?.[artistId] || [];

  // Per-group "add platform" picker state (null or group index)
  const [addingPlatformFor, setAddingPlatformFor] = useState(null);

  // Add new handle form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newHandle, setNewHandle] = useState('');
  const [newPlatform, setNewPlatform] = useState('tiktok');

  const ALL_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook'];

  // Late OAuth connect flow
  const oauthPendingRef = useRef(false);
  const [connectingPlatform, setConnectingPlatform] = useState(null);

  const handleConnectPlatform = useCallback(async (platform) => {
    if (!artistId) return;
    setConnectingPlatform(platform);
    try {
      // Get or create Late profile for this artist
      let profiles = [];
      try {
        const result = await getLateProfiles(artistId);
        profiles = result.profiles || [];
      } catch { /* No profiles yet */ }

      let profileId;
      if (profiles.length > 0) {
        profileId = profiles[0]._id;
      } else {
        const created = await createLateProfile(artistId, 'Default');
        profileId = created.profile?._id;
      }

      if (!profileId) throw new Error('Could not create or find a Late profile');

      // Get OAuth URL and open in new tab
      const redirectUrl = window.location.origin + '/artist/dashboard';
      const { authUrl } = await getConnectUrl(artistId, platform, profileId, redirectUrl);

      if (authUrl) {
        oauthPendingRef.current = true;
        window.open(authUrl, '_blank', 'noopener,noreferrer');
        toastSuccess(`Connecting ${platform} — complete auth in the new tab`);
      } else {
        throw new Error('No auth URL returned from Late');
      }
    } catch (error) {
      console.error('Failed to start connect flow:', error);
      toastError(`Failed to connect ${platform}: ${error.message}`);
    } finally {
      setConnectingPlatform(null);
      setAddingPlatformFor(null);
    }
  }, [artistId, toastSuccess, toastError]);

  // Auto-refresh Late pages when returning from OAuth tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && oauthPendingRef.current) {
        oauthPendingRef.current = false;
        onLoadLatePages?.();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [onLoadLatePages]);

  // Merge edit mode + state
  const [editMode, setEditMode] = useState(false);
  const [checkedGroups, setCheckedGroups] = useState(new Set());
  const [dragOverGroup, setDragOverGroup] = useState(null);
  const [handleGroups, setHandleGroups] = useState(handleGroupsProp);

  // Persist handleGroups to Firestore
  const saveHandleGroups = useCallback(async (newGroups) => {
    setHandleGroups(newGroups);
    onHandleGroupsChange?.(newGroups);
    if (db && artistId) {
      try {
        await updateDoc(doc(db, 'artists', artistId), { handleGroups: newGroups });
      } catch (err) {
        console.error('Failed to save handleGroups:', err);
      }
    }
  }, [db, artistId, onHandleGroupsChange]);

  // Group pages by handle (respecting handleGroups merges)
  const groupedAccounts = useMemo(() => {
    // Build a map: handle → group display name
    const handleToGroup = {};
    (handleGroups || []).forEach(g => {
      (g.handles || []).forEach(h => {
        handleToGroup[h.toLowerCase()] = g.displayName || g.handles[0];
      });
    });

    // Merge Late pages + manual accounts
    const allPages = [
      ...artistPages,
      ...manualAccounts.map(a => ({
        handle: a.handle,
        platform: a.platform,
        name: a.handle,
        status: 'manual',
        isManual: true,
      }))
    ];

    const groups = {};
    allPages.forEach(page => {
      const handle = page.handle || page.name || 'unknown';
      const groupKey = handleToGroup[handle.toLowerCase()] || handle;
      if (!groups[groupKey]) {
        groups[groupKey] = { displayName: groupKey, pages: [], totalFollowers: 0, profilePic: null, handles: new Set() };
      }
      groups[groupKey].pages.push(page);
      groups[groupKey].handles.add(handle);
      groups[groupKey].totalFollowers += (page.followers || page.follower_count || 0);
      if (!groups[groupKey].profilePic && page.profilePicture) {
        groups[groupKey].profilePic = page.profilePicture;
      }
    });
    // Convert handle sets to arrays
    return Object.values(groups).map(g => ({ ...g, handles: [...g.handles] }));
  }, [artistPages, manualAccounts, handleGroups]);

  // Merge checked groups
  const handleMergeSelected = useCallback(() => {
    if (checkedGroups.size < 2) return;
    const indices = [...checkedGroups];
    const mergedHandles = [];
    indices.forEach(i => {
      groupedAccounts[i]?.handles?.forEach(h => mergedHandles.push(h));
    });
    const displayName = groupedAccounts[indices[0]]?.displayName || mergedHandles[0];
    // Remove old groups that contain any of these handles, add new merged group
    const newGroups = (handleGroups || []).filter(g =>
      !g.handles.some(h => mergedHandles.map(m => m.toLowerCase()).includes(h.toLowerCase()))
    );
    newGroups.push({ handles: mergedHandles, displayName });
    saveHandleGroups(newGroups);
    setCheckedGroups(new Set());
  }, [checkedGroups, groupedAccounts, handleGroups, saveHandleGroups]);

  // Split a merged group
  const handleSplit = useCallback((groupIndex) => {
    const group = groupedAccounts[groupIndex];
    if (!group || group.handles.length <= 1) return;
    // Remove any handleGroup that contains these handles
    const newGroups = (handleGroups || []).filter(g =>
      !g.handles.some(h => group.handles.map(m => m.toLowerCase()).includes(h.toLowerCase()))
    );
    saveHandleGroups(newGroups);
  }, [groupedAccounts, handleGroups, saveHandleGroups]);

  // Drag-to-merge
  const handleDragMerge = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    const fromGroup = groupedAccounts[fromIndex];
    const toGroup = groupedAccounts[toIndex];
    if (!fromGroup || !toGroup) return;
    const mergedHandles = [...new Set([...toGroup.handles, ...fromGroup.handles])];
    const displayName = toGroup.displayName;
    const newGroups = (handleGroups || []).filter(g =>
      !g.handles.some(h => mergedHandles.map(m => m.toLowerCase()).includes(h.toLowerCase()))
    );
    newGroups.push({ handles: mergedHandles, displayName });
    saveHandleGroups(newGroups);
    setDragOverGroup(null);
  }, [groupedAccounts, handleGroups, saveHandleGroups]);

  return (
    <div className="flex w-full flex-col items-start gap-8 px-12 py-12">
      {/* Welcome */}
      <div className="flex w-full flex-col items-start gap-2">
        <span className="text-heading-1 font-heading-1 text-[#ffffffff]">
          Welcome back, {user?.name || 'Artist'}
        </span>
        <span className="text-body font-body text-neutral-400">
          Here's what's happening with your content
        </span>
      </div>

      {/* Stat Cards — 3 cols: Total Content, Scheduled, Posted */}
      <div className="w-full items-start gap-6 grid grid-cols-3 mobile:grid mobile:grid-cols-1">
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 rounded-xl border border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600">
            <FeatherLayers className="text-[#ffffffff]" />
          </div>
          <div className="flex w-full flex-col items-start gap-1">
            <span className="text-caption font-caption text-neutral-400">Total Content</span>
            <span className="text-heading-1 font-heading-1 text-[#ffffffff]">{totalContentCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-caption font-caption text-neutral-400">
              {createdContent.videos?.length || 0} videos, {createdContent.slideshows?.length || 0} slideshows
            </span>
          </div>
        </div>
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 rounded-xl border border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600">
            <FeatherCalendar className="text-[#ffffffff]" />
          </div>
          <div className="flex w-full flex-col items-start gap-1">
            <span className="text-caption font-caption text-neutral-400">Scheduled</span>
            <span className="text-heading-1 font-heading-1 text-[#ffffffff]">{upcomingPosts.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-caption font-caption text-neutral-400">
              {upcomingPosts.length > 0 ? `Next: ${new Date(upcomingPosts[0].scheduledTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'No upcoming posts'}
            </span>
          </div>
        </div>
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 rounded-xl border border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600">
            <FeatherSend className="text-[#ffffffff]" />
          </div>
          <div className="flex w-full flex-col items-start gap-1">
            <span className="text-caption font-caption text-neutral-400">Posted</span>
            <span className="text-heading-1 font-heading-1 text-[#ffffffff]">{postedPosts.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-caption font-caption text-neutral-400">
              {postedPosts.length > 0 ? `Last: ${new Date(postedPosts[0].postedAt || postedPosts[0].scheduledTime).toLocaleString([], { month: 'short', day: 'numeric' })}` : 'No posts yet'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Action Cards */}
      <div className="w-full items-start gap-6 grid grid-cols-2">
        <div className="flex grow shrink-0 basis-0 flex-col items-center gap-6 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-8 py-8">
          <IconWithBackground variant="neutral" size="x-large" icon={<FeatherVideo />} />
          <div className="flex w-full flex-col items-center gap-2">
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Go to Studio</span>
            <span className="text-body font-body text-neutral-400 text-center">Create new videos and content for your channels</span>
          </div>
          <Button className="h-10 w-full flex-none" variant="neutral-primary" size="large" icon={<FeatherPlay />} onClick={() => onNavigate?.('studio')}>
            Open Studio
          </Button>
        </div>
        <div className="flex grow shrink-0 basis-0 flex-col items-center gap-6 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-8 py-8">
          <IconWithBackground variant="neutral" size="x-large" icon={<FeatherCalendar />} />
          <div className="flex w-full flex-col items-center gap-2">
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">View Schedule</span>
            <span className="text-body font-body text-neutral-400 text-center">Manage your scheduled posts across all platforms</span>
          </div>
          <Button className="h-10 w-full flex-none" variant="neutral-primary" size="large" icon={<FeatherCalendar />} onClick={() => onNavigate?.('schedule')}>
            View Calendar
          </Button>
        </div>
      </div>

      {/* Recent Content — 4-column grid */}
      {recentContent.length > 0 && (
        <div className="flex w-full flex-col items-start gap-4">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">
            Recent Content
          </span>
          <div className="w-full items-start gap-4 grid grid-cols-4 mobile:grid mobile:grid-cols-2">
            {recentContent.slice(0, 4).map((item, i) => {
              const isSlideshow = item._type === 'slideshow';
              const thumb = isSlideshow
                ? (item.slides?.[0]?.backgroundImage || item.slides?.[0]?.imageUrl || item.slides?.[0]?.thumbnail || null)
                : (item.thumbnail || item.thumbnailUrl || item.clips?.[0]?.thumbnail || item.clips?.[0]?.thumbnailUrl || null);
              const status = (item.status || 'draft').toLowerCase();
              const badgeVariant = status === 'posted' ? 'success' : status === 'scheduled' ? 'brand' : 'neutral';
              const badgeLabel = status === 'posted' ? 'Posted' : status === 'scheduled' ? 'Scheduled' : 'Draft';
              const timeAgo = item.createdAt ? getTimeAgo(new Date(item.createdAt)) : '';
              return (
                <div key={item.id || i} className="flex grow shrink-0 basis-0 flex-col items-start gap-3 overflow-hidden rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff]">
                  {thumb ? (
                    <img className="h-32 w-full flex-none object-cover" src={thumb} alt="" loading="lazy" />
                  ) : (
                    <div className="flex h-32 w-full flex-none items-center justify-center bg-neutral-900">
                      {isSlideshow ? (
                        <FeatherCamera className="text-neutral-600" style={{ width: 32, height: 32 }} />
                      ) : (
                        <FeatherVideo className="text-neutral-600" style={{ width: 32, height: 32 }} />
                      )}
                    </div>
                  )}
                  <div className="flex w-full flex-col items-start gap-2 px-4 pb-4">
                    <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                    <span className="text-body-bold font-body-bold text-[#ffffffff] truncate w-full">
                      {item.name || item.title || (isSlideshow ? 'Untitled Slideshow' : 'Untitled Video')}
                    </span>
                    <div className="flex items-center gap-2">
                      {isSlideshow ? (
                        <FeatherCamera className="text-caption font-caption text-brand-600" />
                      ) : (
                        <FeatherPlay className="text-caption font-caption text-brand-600" />
                      )}
                      {item.audio && <FeatherMusic className="text-caption font-caption text-brand-600" />}
                      <span className="text-caption font-caption text-neutral-400">{timeAgo}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Social Sets Usage Bar */}
      {socialSetsAllowed > 0 && (
        <div className="flex w-full flex-col items-start gap-3 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-5">
          <div className="flex w-full items-center justify-between">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Social Set Usage</span>
            <span className="text-caption font-caption text-neutral-400">
              {socialSetsUsed} of {socialSetsAllowed} used
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full overflow-hidden bg-neutral-800">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min((socialSetsUsed / socialSetsAllowed) * 100, 100)}%`,
                backgroundColor: socialSetsUsed >= socialSetsAllowed ? '#ef4444' : '#6366f1',
              }}
            />
          </div>
          {showPayment && socialSetsUsed >= socialSetsAllowed && (
            <span className="text-caption font-caption text-amber-400">
              You've used all your Social Sets. Upgrade to connect more accounts.
            </span>
          )}
        </div>
      )}

      {/* Connected Accounts + Upcoming Posts — 2 col */}
      <div className="w-full items-start gap-6 grid grid-cols-1 lg:grid-cols-2">
        {/* Connected Accounts */}
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-5">
          <div className="flex w-full items-center justify-between">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Connected Accounts</span>
            <div className="flex items-center gap-2">
              {onAddManualAccounts && (
                <Button size="small" variant="neutral-secondary" onClick={() => setShowAddForm(!showAddForm)}>
                  {showAddForm ? 'Cancel' : '+ New Handle'}
                </Button>
              )}
              {groupedAccounts.length > 1 && (
                <Button size="small" variant={editMode ? 'brand-secondary' : 'neutral-tertiary'} onClick={() => { setEditMode(!editMode); setCheckedGroups(new Set()); }}>
                  {editMode ? 'Done' : 'Edit'}
                </Button>
              )}
            </div>
          </div>
          {/* Inline Add Account Form */}
          {showAddForm && (
            <div className="flex w-full gap-2 items-center flex-wrap">
              <input
                type="text"
                placeholder="@handle"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                className="text-caption font-caption flex-1 min-w-[120px] rounded-md border border-solid border-neutral-800 bg-black px-3 py-1.5 text-[#ffffffff] outline-none"
              />
              <select
                value={newPlatform}
                onChange={(e) => setNewPlatform(e.target.value)}
                className="text-caption font-caption rounded-md border border-solid border-neutral-800 bg-black px-3 py-1.5 text-[#ffffffff] outline-none"
              >
                <option value="tiktok">TikTok</option>
                <option value="instagram">Instagram</option>
                <option value="youtube">YouTube</option>
                <option value="facebook">Facebook</option>
              </select>
              <Button size="small" variant="brand-primary" onClick={async () => {
                if (!newHandle.trim()) return;
                await onAddManualAccounts?.(artistId, [{ handle: newHandle.trim(), platform: newPlatform }]);
                setNewHandle('');
                setShowAddForm(false);
              }}>
                Save
              </Button>
            </div>
          )}
          {/* Merge actions */}
          {editMode && checkedGroups.size >= 2 && (
            <div className="flex gap-2">
              <Button size="small" variant="brand-secondary" onClick={handleMergeSelected}>
                Merge {checkedGroups.size} Selected
              </Button>
              <Button size="small" variant="neutral-tertiary" onClick={() => setCheckedGroups(new Set())}>
                Clear
              </Button>
            </div>
          )}
          {groupedAccounts.length > 0 ? (
            <div className="flex w-full flex-col items-start gap-3">
              {groupedAccounts.map((group, gi) => (
                <div
                  key={gi}
                  className={`flex w-full items-center gap-3 ${editMode ? 'rounded-md px-2 py-2' : ''}`}
                  draggable={editMode}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(gi)); }}
                  onDragOver={(e) => { if (editMode) { e.preventDefault(); setDragOverGroup(gi); } }}
                  onDragLeave={() => setDragOverGroup(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                    if (!isNaN(fromIdx)) handleDragMerge(fromIdx, gi);
                  }}
                  style={{
                    border: dragOverGroup === gi ? '2px dashed #6366f1' : editMode ? '1px solid #2a2a2a' : undefined,
                    cursor: editMode ? 'grab' : undefined,
                    transition: 'border 0.15s'
                  }}
                >
                  {/* Checkbox in edit mode */}
                  {editMode && (
                    <input
                      type="checkbox"
                      checked={checkedGroups.has(gi)}
                      onChange={() => {
                        setCheckedGroups(prev => {
                          const next = new Set(prev);
                          if (next.has(gi)) next.delete(gi); else next.add(gi);
                          return next;
                        });
                      }}
                      className="w-4 h-4 flex-shrink-0"
                    />
                  )}
                  {/* Avatar */}
                  {group.profilePic ? (
                    <img src={group.profilePic} alt="" className="w-9 h-9 rounded-full object-cover flex-none" />
                  ) : (
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-neutral-800 text-caption font-caption text-neutral-400 font-bold">
                      {group.displayName?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  {/* Handle + platform pills */}
                  <div className="flex grow shrink-0 basis-0 flex-col items-start gap-1 min-w-0">
                    <span className="text-body-bold font-body-bold text-[#ffffffff] truncate w-full">
                      {group.displayName}
                      {group.handles.length > 1 && (
                        <span className="text-caption font-caption text-neutral-500 ml-1">(+{group.handles.length - 1})</span>
                      )}
                    </span>
                    <div className="flex gap-1.5 flex-wrap items-center">
                      {group.pages.map((page, pi) => {
                        const meta = PLATFORM_META[page.platform] || { icon: '🌐', color: '#888', label: page.platform };
                        const url = getProfileUrl(page.platform, page.handle);
                        return (
                          <a
                            key={pi}
                            href={url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={url ? undefined : (e) => e.preventDefault()}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition hover:opacity-80"
                            style={{
                              backgroundColor: `${meta.color}20`,
                              color: meta.color,
                              textDecoration: 'none',
                              cursor: url ? 'pointer' : 'default'
                            }}
                            title={`${meta.label}: ${page.handle}`}
                          >
                            <span>{meta.icon}</span>
                            <span>{meta.label}</span>
                          </a>
                        );
                      })}
                      {/* Add platform "+" button — triggers Late OAuth */}
                      {(() => {
                        const connectedPlatforms = group.pages.map(p => p.platform);
                        const available = ALL_PLATFORMS.filter(p => !connectedPlatforms.includes(p));
                        if (available.length === 0) return null;
                        return addingPlatformFor === gi ? (
                          <div className="flex gap-1 items-center">
                            {available.map(platform => {
                              const meta = PLATFORM_META[platform] || { icon: '🌐', color: '#888', label: platform };
                              const isConnecting = connectingPlatform === platform;
                              return (
                                <button
                                  key={platform}
                                  disabled={isConnecting}
                                  onClick={() => handleConnectPlatform(platform)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition hover:opacity-80"
                                  style={{
                                    backgroundColor: `${meta.color}15`,
                                    color: meta.color,
                                    border: `1px dashed ${meta.color}60`,
                                    cursor: isConnecting ? 'wait' : 'pointer',
                                    opacity: isConnecting ? 0.5 : 1,
                                  }}
                                  title={`Connect ${meta.label} via Late`}
                                >
                                  <span>{meta.icon}</span>
                                  <span>{isConnecting ? '...' : meta.label}</span>
                                </button>
                              );
                            })}
                            <button
                              onClick={() => setAddingPlatformFor(null)}
                              className="text-caption font-caption text-neutral-500 ml-1 bg-transparent border-none cursor-pointer"
                            >
                              &times;
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAddingPlatformFor(gi)}
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold transition hover:opacity-80 bg-brand-600/15 text-brand-600 cursor-pointer"
                            style={{ border: '1px dashed rgba(99,102,241,0.4)' }}
                            title="Add platform"
                          >
                            +
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                  {/* Followers + status + split */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {group.totalFollowers > 0 && (
                      <span className="text-body-bold font-body-bold text-[#ffffffff]">{formatFollowers(group.totalFollowers)}</span>
                    )}
                    <Badge variant={group.pages.every(p => p.status === 'active') ? 'success' : 'neutral'}>
                      {group.pages.every(p => p.status === 'active') ? 'active' : 'mixed'}
                    </Badge>
                    {editMode && group.handles.length > 1 && (
                      <Button size="small" variant="destructive-secondary" onClick={() => handleSplit(gi)}>
                        Split
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-body font-body text-neutral-500 italic">No accounts connected yet.</span>
          )}
        </div>

        {/* Upcoming Posts */}
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff]">
          <div className="flex w-full items-center justify-between px-6 pt-5">
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Upcoming Posts</span>
          </div>
          {upcomingPosts.length > 0 ? (
            <div className="flex w-full flex-col items-start">
              {upcomingPosts.slice(0, 5).map((post, i) => {
                const date = post.scheduledTime ? new Date(post.scheduledTime) : null;
                const platformNames = Object.keys(post.platforms || {});
                const postThumb = post.thumbnailUrl || post.mediaUrl || null;
                return (
                  <div key={post.id || i} className={`flex w-full items-center gap-4 px-6 py-4 ${i < Math.min(upcomingPosts.length, 5) - 1 ? 'border-b border-solid border-neutral-800' : ''}`}>
                    {postThumb ? (
                      <img className="h-16 w-16 flex-none rounded-md object-cover" src={postThumb} alt="" loading="lazy" />
                    ) : (
                      <div className="flex h-16 w-16 flex-none items-center justify-center rounded-md bg-neutral-800">
                        <FeatherCalendar className="text-neutral-500" />
                      </div>
                    )}
                    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2">
                      <span className="text-body-bold font-body-bold text-[#ffffffff] truncate w-full">
                        {post.contentName || post.caption || 'Untitled post'}
                      </span>
                      <div className="flex items-center gap-2">
                        {platformNames.map(p => {
                          const meta = PLATFORM_META[p];
                          return meta ? (
                            <span key={p} className="text-caption font-caption text-brand-600">{meta.icon}</span>
                          ) : null;
                        })}
                        <span className="text-caption font-caption text-neutral-400">
                          {date ? date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                    </div>
                    <IconButton size="small" icon={<FeatherEdit2 />} onClick={() => onNavigate?.('schedule')} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-6 pb-5">
              <span className="text-body font-body text-neutral-500 italic">No upcoming posts.</span>
            </div>
          )}
          {upcomingPosts.length > 5 && (
            <div className="flex w-full items-center justify-center px-6 pb-4">
              <span className="text-caption font-caption text-neutral-400">
                +{upcomingPosts.length - 5} more scheduled
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Recently Posted */}
      <div className="flex w-full flex-col items-start gap-4">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">
          Recently Posted{postedPosts.length > 0 && ` (${postedPosts.length})`}
        </span>
        <div className="flex w-full flex-col items-start rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff]">
          {postedPosts.length > 0 ? (
            postedPosts.slice(0, 5).map((post, i) => {
              const date = (post.postedAt || post.scheduledTime) ? new Date(post.postedAt || post.scheduledTime) : null;
              const results = post.postResults || {};
              return (
                <div key={post.id || i} className={`flex w-full items-center gap-4 px-6 py-4 ${i < Math.min(postedPosts.length, 5) - 1 ? 'border-b border-solid border-neutral-800' : ''}`}>
                  <div className="flex h-12 w-12 flex-none items-center justify-center rounded-md bg-neutral-800 text-caption font-caption text-neutral-400 font-mono">
                    {date ? `${date.getMonth() + 1}/${date.getDate()}` : '—'}
                  </div>
                  <div className="flex grow shrink-0 basis-0 flex-col items-start gap-1">
                    <span className="text-body-bold font-body-bold text-[#ffffffff] truncate w-full">
                      {post.contentName || post.caption || 'Untitled post'}
                    </span>
                    <div className="flex gap-1.5 flex-wrap">
                      {Object.entries(results).map(([platform, result]) => (
                        result?.url ? (
                          <a
                            key={platform}
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 hover:opacity-80 transition"
                            style={{
                              backgroundColor: `${PLATFORM_COLORS[platform] || '#888'}20`,
                              color: PLATFORM_COLORS[platform] || '#888',
                              textDecoration: 'none'
                            }}
                          >
                            {platform} ↗
                          </a>
                        ) : (
                          <span
                            key={platform}
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: `${PLATFORM_COLORS[platform] || '#888'}20`,
                              color: PLATFORM_COLORS[platform] || '#888'
                            }}
                          >
                            {platform}
                          </span>
                        )
                      ))}
                      {Object.keys(results).length === 0 && (
                        <span className="text-caption font-caption text-neutral-400">
                          {date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-6 py-5">
              <span className="text-body font-body text-neutral-500 italic">No posts published yet.</span>
            </div>
          )}
          {postedPosts.length > 5 && (
            <div className="flex w-full items-center justify-center px-6 pb-4 border-t border-solid border-neutral-800">
              <span className="text-caption font-caption text-neutral-400 pt-3">
                +{postedPosts.length - 5} more posted
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Operator Contact Card */}
      {user?.ownerOperatorId && (
        <div className="flex w-full flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-5">
          <span className="text-body-bold font-body-bold text-[#ffffffff]">Your Operator</span>
          <span className="text-body font-body text-neutral-400">
            Contact your operator for content uploads, schedule changes, or account management.
          </span>
        </div>
      )}

      {/* Upgrade CTA */}
      {showPayment && (
        <div className="flex w-full flex-col items-center gap-4 rounded-lg border border-solid border-brand-600/30 bg-[#1a1a1aff] px-8 py-8">
          <span className="text-body font-body text-neutral-400 text-center">
            Need more Social Sets? Upgrade your plan to connect more accounts.
          </span>
          <Button variant="brand-primary" size="large" onClick={() => toastInfo('Contact your operator to upgrade your plan')}>
            Upgrade Plan
          </Button>
        </div>
      )}
    </div>
  );
};

export default ArtistDashboard;
