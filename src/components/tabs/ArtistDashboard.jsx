import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../ui';
import { getTierForSets, computeSocialSetsUsed, shouldShowPaymentUI } from '../../services/subscriptionService';
import { PLATFORM_META, getProfileUrl, formatFollowers } from '../../utils/platformUtils';
import { subscribeToScheduledPosts, POST_STATUS, PLATFORM_COLORS } from '../../services/scheduledPostsService';

/**
 * ArtistDashboard — Home tab for artist and collaborator roles.
 * Shows welcome, stats, Social Sets usage, upcoming posts, and operator contact.
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
}) => {
  const { theme } = useTheme();
  const { toastInfo } = useToast();
  const t = theme.tw;

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
    <div className={`flex-1 overflow-auto p-6 ${t.bgPage}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Welcome */}
        <div>
          <h1 className={`text-2xl font-bold ${t.textPrimary}`}>
            Welcome back, {user?.name || 'Artist'}
          </h1>
          <p className={`${t.textSecondary} text-sm mt-1`}>
            Here's an overview of your account.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <p className={`text-sm ${t.textMuted} mb-1`}>Social Sets</p>
            <p className={`text-2xl font-bold ${t.textPrimary}`}>{socialSetsUsed}/{socialSetsAllowed || '—'}</p>
            <p className={`text-xs ${t.textMuted} mt-1`}>connected</p>
          </div>
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <p className={`text-sm ${t.textMuted} mb-1`}>Scheduled</p>
            <p className={`text-2xl font-bold ${t.textPrimary}`}>{upcomingPosts.length}</p>
            <p className={`text-xs ${t.textMuted} mt-1`}>upcoming posts</p>
          </div>
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <p className={`text-sm ${t.textMuted} mb-1`}>Posted</p>
            <p className={`text-2xl font-bold ${t.textPrimary}`}>{postedPosts.length}</p>
            <p className={`text-xs ${t.textMuted} mt-1`}>published</p>
          </div>
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <p className={`text-sm ${t.textMuted} mb-1`}>Platforms</p>
            <p className={`text-2xl font-bold ${t.textPrimary}`}>{artistPages.length + manualAccounts.length}</p>
            <p className={`text-xs ${t.textMuted} mt-1`}>accounts</p>
          </div>
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <p className={`text-sm ${t.textMuted} mb-1`}>Plan</p>
            <p className={`text-2xl font-bold ${t.textPrimary}`}>{tierInfo.name}</p>
            <p className={`text-xs ${t.textMuted} mt-1`}>{tierInfo.price}</p>
          </div>
        </div>

        {/* Social Sets Usage Bar */}
        {socialSetsAllowed > 0 && (
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <div className="flex justify-between items-center mb-2">
              <h2 className={`text-sm font-semibold ${t.textPrimary}`}>Social Set Usage</h2>
              <span className={`text-sm ${t.textSecondary}`}>
                {socialSetsUsed} of {socialSetsAllowed} used
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: theme.bg.elevated }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min((socialSetsUsed / socialSetsAllowed) * 100, 100)}%`,
                  backgroundColor: socialSetsUsed >= socialSetsAllowed ? '#ef4444' : theme.accent.primary,
                }}
              />
            </div>
            {showPayment && socialSetsUsed >= socialSetsAllowed && (
              <p className="text-sm text-amber-400 mt-2">
                You've used all your Social Sets. Upgrade to connect more accounts.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Your Social Sets — Grouped by Handle */}
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <div className="flex justify-between items-center mb-4">
              <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted}`}>Connected Accounts</h2>
              <div className="flex gap-2">
                {onAddManualAccounts && (
                  <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="text-xs px-3 py-1 rounded-lg transition"
                    style={{ backgroundColor: `${theme.accent.primary}20`, color: theme.accent.primary, border: 'none', cursor: 'pointer' }}
                  >
                    {showAddForm ? 'Cancel' : '+ New Handle'}
                  </button>
                )}
                {groupedAccounts.length > 1 && (
                  <button
                    onClick={() => { setEditMode(!editMode); setCheckedGroups(new Set()); }}
                    className={`text-xs px-3 py-1 rounded-lg transition ${editMode ? 'bg-indigo-500/20 text-indigo-400' : `${t.textMuted}`}`}
                    style={{ background: editMode ? undefined : 'none', border: 'none', cursor: 'pointer' }}
                  >
                    {editMode ? 'Done' : 'Edit'}
                  </button>
                )}
              </div>
            </div>
            {/* Inline Add Account Form */}
            {showAddForm && (
              <div className="flex gap-2 mb-3 items-center flex-wrap">
                <input
                  type="text"
                  placeholder="@handle"
                  value={newHandle}
                  onChange={(e) => setNewHandle(e.target.value)}
                  className={`text-sm px-3 py-1.5 rounded-lg border ${t.border}`}
                  style={{ backgroundColor: theme.bg.input, color: theme.text.primary, outline: 'none', flex: '1', minWidth: '120px' }}
                />
                <select
                  value={newPlatform}
                  onChange={(e) => setNewPlatform(e.target.value)}
                  className={`text-sm px-3 py-1.5 rounded-lg border ${t.border}`}
                  style={{ backgroundColor: theme.bg.input, color: theme.text.primary, outline: 'none' }}
                >
                  <option value="tiktok">TikTok</option>
                  <option value="instagram">Instagram</option>
                  <option value="youtube">YouTube</option>
                  <option value="facebook">Facebook</option>
                </select>
                <button
                  onClick={async () => {
                    if (!newHandle.trim()) return;
                    await onAddManualAccounts?.(artistId, [{ handle: newHandle.trim(), platform: newPlatform }]);
                    setNewHandle('');
                    setShowAddForm(false);
                  }}
                  className="text-xs px-4 py-1.5 rounded-lg font-medium transition"
                  style={{ backgroundColor: theme.accent.primary, color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Save
                </button>
              </div>
            )}
            {/* Merge actions */}
            {editMode && checkedGroups.size >= 2 && (
              <div className="flex gap-2 mb-3">
                <button
                  onClick={handleMergeSelected}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ backgroundColor: `${theme.accent.primary}20`, color: theme.accent.primary, border: 'none', cursor: 'pointer' }}
                >
                  Merge {checkedGroups.size} Selected
                </button>
                <button
                  onClick={() => setCheckedGroups(new Set())}
                  className={`text-xs px-3 py-1.5 rounded-lg ${t.textMuted}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Clear
                </button>
              </div>
            )}
            {groupedAccounts.length > 0 ? (
              <div className="space-y-3">
                {groupedAccounts.map((group, gi) => (
                  <div
                    key={gi}
                    className="flex items-center gap-3"
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
                      padding: editMode ? '8px' : undefined,
                      borderRadius: editMode ? '8px' : undefined,
                      border: dragOverGroup === gi ? `2px dashed ${theme.accent.primary}` : editMode ? `1px solid ${theme.bg.elevated}` : undefined,
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
                      <img src={group.profilePic} alt="" className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ backgroundColor: theme.bg.elevated, color: theme.text.secondary }}>
                        {group.displayName?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                    {/* Handle + platform pills */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${t.textPrimary} truncate`}>
                        {group.displayName}
                        {group.handles.length > 1 && (
                          <span className={`text-xs ${t.textMuted} ml-1`}>(+{group.handles.length - 1})</span>
                        )}
                      </p>
                      <div className="flex gap-1.5 mt-1 flex-wrap items-center">
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
                        {/* Add platform "+" button */}
                        {onAddManualAccounts && (() => {
                          const connectedPlatforms = group.pages.map(p => p.platform);
                          const available = ALL_PLATFORMS.filter(p => !connectedPlatforms.includes(p));
                          if (available.length === 0) return null;
                          return addingPlatformFor === gi ? (
                            <div className="flex gap-1 items-center">
                              {available.map(platform => {
                                const meta = PLATFORM_META[platform] || { icon: '🌐', color: '#888', label: platform };
                                return (
                                  <button
                                    key={platform}
                                    onClick={async () => {
                                      const handle = group.handles[0] || group.displayName;
                                      await onAddManualAccounts(artistId, [{ handle, platform }]);
                                      setAddingPlatformFor(null);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition hover:opacity-80"
                                    style={{
                                      backgroundColor: `${meta.color}15`,
                                      color: meta.color,
                                      border: `1px dashed ${meta.color}60`,
                                      cursor: 'pointer',
                                    }}
                                    title={`Add ${meta.label}`}
                                  >
                                    <span>{meta.icon}</span>
                                    <span>{meta.label}</span>
                                  </button>
                                );
                              })}
                              <button
                                onClick={() => setAddingPlatformFor(null)}
                                className={`text-xs ${t.textMuted} ml-1`}
                                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                              >
                                &times;
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAddingPlatformFor(gi)}
                              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold transition hover:opacity-80"
                              style={{
                                backgroundColor: `${theme.accent.primary}15`,
                                color: theme.accent.primary,
                                border: `1px dashed ${theme.accent.primary}60`,
                                cursor: 'pointer',
                                lineHeight: 1,
                              }}
                              title="Add platform"
                            >
                              +
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    {/* Followers + status + split */}
                    <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                      {group.totalFollowers > 0 && (
                        <p className={`text-sm font-semibold ${t.textPrimary}`}>{formatFollowers(group.totalFollowers)}</p>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        group.pages.every(p => p.status === 'active') ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {group.pages.every(p => p.status === 'active') ? 'active' : 'mixed'}
                      </span>
                      {editMode && group.handles.length > 1 && (
                        <button
                          onClick={() => handleSplit(gi)}
                          className="text-xs px-2 py-0.5 rounded-lg"
                          style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: 'none', cursor: 'pointer' }}
                        >
                          Split
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`text-sm ${t.textMuted} italic`}>No accounts connected yet.</p>
            )}
          </div>

          {/* Upcoming Posts */}
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-4`}>Upcoming Posts</h2>
            {upcomingPosts.length > 0 ? (
              <div className="space-y-3">
                {upcomingPosts.slice(0, 5).map((post, i) => {
                  const date = post.scheduledTime ? new Date(post.scheduledTime) : null;
                  const platformNames = Object.keys(post.platforms || {});
                  return (
                    <div key={post.id || i} className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono`}
                        style={{ backgroundColor: theme.bg.elevated, color: theme.text.secondary }}>
                        {date ? `${date.getMonth() + 1}/${date.getDate()}` : '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${t.textPrimary} truncate`}>
                          {post.contentName || post.caption || 'Untitled post'}
                        </p>
                        <p className={`text-xs ${t.textMuted}`}>
                          {date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          {platformNames.length > 0 && ` · ${platformNames.join(', ')}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {upcomingPosts.length > 5 && (
                  <p className={`text-xs ${t.textMuted} text-center`}>
                    +{upcomingPosts.length - 5} more scheduled
                  </p>
                )}
              </div>
            ) : (
              <p className={`text-sm ${t.textMuted} italic`}>No upcoming posts.</p>
            )}
          </div>
        </div>

        {/* Recently Posted */}
        <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-4`}>
            Recently Posted{postedPosts.length > 0 && ` (${postedPosts.length})`}
          </h2>
          {postedPosts.length > 0 ? (
            <div className="space-y-3">
              {postedPosts.slice(0, 5).map((post, i) => {
                const date = (post.postedAt || post.scheduledTime) ? new Date(post.postedAt || post.scheduledTime) : null;
                const results = post.postResults || {};
                return (
                  <div key={post.id || i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono"
                      style={{ backgroundColor: theme.bg.elevated, color: theme.text.secondary }}>
                      {date ? `${date.getMonth() + 1}/${date.getDate()}` : '—'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${t.textPrimary} truncate`}>
                        {post.contentName || post.caption || 'Untitled post'}
                      </p>
                      <div className="flex gap-1.5 mt-0.5 flex-wrap">
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
                          <span className={`text-xs ${t.textMuted}`}>
                            {date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {postedPosts.length > 5 && (
                <p className={`text-xs ${t.textMuted} text-center`}>
                  +{postedPosts.length - 5} more posted
                </p>
              )}
            </div>
          ) : (
            <p className={`text-sm ${t.textMuted} italic`}>No posts published yet.</p>
          )}
        </div>

        {/* Operator Contact Card */}
        {user?.ownerOperatorId && (
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-2`}>Your Operator</h2>
            <p className={`text-sm ${t.textSecondary}`}>
              Contact your operator for content uploads, schedule changes, or account management.
            </p>
          </div>
        )}

        {/* Upgrade CTA */}
        {showPayment && (
          <div className={`p-5 rounded-xl border border-indigo-500/30 ${t.cardBg} text-center`}>
            <p className={`text-sm ${t.textSecondary} mb-3`}>
              Need more Social Sets? Upgrade your plan to connect more accounts.
            </p>
            <button
              onClick={() => toastInfo('Contact your operator to upgrade your plan')}
              className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition ${t.btnPrimary}`}
            >
              Upgrade Plan
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArtistDashboard;
