import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../ui';
import { getLateProfiles, createLateProfile, getConnectUrl } from '../../services/lateService';
import useIsMobile from '../../hooks/useIsMobile';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';

import {
  PLATFORM_META,
  ALL_PLATFORMS,
  getProfileUrl,
  formatFollowers,
} from '../../utils/platformUtils';
import log from '../../utils/logger';

/**
 * PagesTab — Artist-centric social media account management.
 * Shows each visible artist with their connected pages (from Late API).
 * Artists without Late configured see a CTA to connect.
 * Supports in-app Late OAuth for connecting new platforms.
 * Supports manual account entry with per-platform passwords.
 */

/**
 * Auto-detect platform from a pasted URL.
 * Returns { platform, handle } or null if not a recognized social URL.
 */
const detectPlatformFromUrl = (input) => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  // TikTok
  const tiktokMatch = lower.match(/tiktok\.com\/@?([a-z0-9_.]+)/i);
  if (tiktokMatch) return { platform: 'tiktok', handle: `@${tiktokMatch[1]}` };

  // Instagram
  const igMatch = lower.match(/instagram\.com\/([a-z0-9_.]+)/i);
  if (igMatch && !['p', 'reel', 'reels', 'stories', 'explore'].includes(igMatch[1])) {
    return { platform: 'instagram', handle: `@${igMatch[1]}` };
  }

  // Facebook
  const fbMatch = lower.match(/(?:facebook|fb)\.com\/([a-z0-9_.]+)/i);
  if (fbMatch && !['watch', 'groups', 'events', 'marketplace'].includes(fbMatch[1])) {
    return { platform: 'facebook', handle: `@${fbMatch[1]}` };
  }

  // Twitter / X
  const twMatch = lower.match(/(?:twitter|x)\.com\/([a-z0-9_]+)/i);
  if (twMatch && !['home', 'search', 'explore', 'settings'].includes(twMatch[1])) {
    return { platform: 'twitter', handle: `@${twMatch[1]}` };
  }

  // YouTube
  const ytMatch = lower.match(/youtube\.com\/@?([a-z0-9_.]+)/i);
  if (ytMatch && !['watch', 'channel', 'playlist', 'feed', 'results'].includes(ytMatch[1])) {
    return { platform: 'youtube', handle: `@${ytMatch[1]}` };
  }

  return null;
};

// ═══════════════════════════════════════════════════════════
// BulkAccountEntry — Modal for adding multiple accounts at once
// ═══════════════════════════════════════════════════════════

const EMPTY_ROW = () => ({
  handle: '',
  platforms: { tiktok: false, instagram: false, youtube: false, facebook: false },
  passwords: { tiktok: '', instagram: '', youtube: '', facebook: '' },
});

const BulkAccountEntry = ({
  artistId,
  artistName,
  latePages,
  isLateConfigured,
  onSave,
  onClose,
  isMobile,
}) => {
  const { theme } = useTheme();
  const t = theme.tw;

  const [rows, setRows] = useState([EMPTY_ROW()]);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState(null); // array of { handle, platform, status }
  const [showPasswords, setShowPasswords] = useState({});

  const addRow = () => setRows((prev) => [...prev, EMPTY_ROW()]);

  const removeRow = (index) => {
    setRows((prev) => (prev.length <= 1 ? [EMPTY_ROW()] : prev.filter((_, i) => i !== index)));
  };

  const updateHandle = (index, value) => {
    const detected = detectPlatformFromUrl(value);
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (detected) {
          return {
            ...row,
            handle: detected.handle,
            platforms: { ...row.platforms, [detected.platform]: true },
          };
        }
        return { ...row, handle: value };
      }),
    );
  };

  const togglePlatform = (index, platform) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return { ...row, platforms: { ...row.platforms, [platform]: !row.platforms[platform] } };
      }),
    );
  };

  const updatePassword = (index, platform, value) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return { ...row, passwords: { ...row.passwords, [platform]: value } };
      }),
    );
  };

  const togglePasswordVisibility = (key) => {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getSelectedPlatforms = (row) => ALL_PLATFORMS.filter((p) => row.platforms[p]);

  const validRows = rows.filter((r) => r.handle.trim() && getSelectedPlatforms(r).length > 0);

  const handleSave = async () => {
    if (!validRows.length) return;
    setSaving(true);

    // Expand rows into individual account entries
    const accounts = [];
    validRows.forEach((row) => {
      const handle = row.handle.trim().startsWith('@')
        ? row.handle.trim()
        : `@${row.handle.trim()}`;
      getSelectedPlatforms(row).forEach((platform) => {
        accounts.push({
          handle,
          platform,
          password: row.passwords[platform] || '',
        });
      });
    });

    const result = await onSave(artistId, accounts);
    setResults(result);
    setSaving(false);
  };

  // Check if a manual account matches a connected Late account
  const getAccountStatus = (handle, platform) => {
    const normalizedHandle = handle.replace(/^@/, '').toLowerCase();
    const match = latePages.find(
      (p) =>
        p.artistId === artistId &&
        p.handle?.replace(/^@/, '').toLowerCase() === normalizedHandle &&
        p.platform === platform,
    );
    if (match) return 'connected';
    if (isLateConfigured) return 'pending';
    return 'waiting';
  };

  const statusLabels = {
    connected: { text: 'Connected', className: 'bg-green-500/15 text-green-400' },
    pending: { text: 'Needs OAuth', className: 'bg-yellow-500/15 text-yellow-400' },
    waiting: { text: 'Waiting for Late', className: 'bg-zinc-500/15 text-zinc-400' },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div
        className={`w-full overflow-auto ${t.bgPage} border ${t.cardBorder} ${isMobile ? 'fixed inset-0 rounded-none max-h-screen' : 'max-w-3xl max-h-[85vh] rounded-2xl'}`}
      >
        {/* Header */}
        <div
          className={`px-6 py-4 border-b ${t.borderSubtle} flex items-center justify-between sticky top-0 z-10 ${t.bgPage} ${isMobile ? 'pt-[max(16px,env(safe-area-inset-top))]' : ''}`}
        >
          <div>
            <h2 className={`text-lg font-bold ${t.textPrimary}`}>Add Accounts for {artistName}</h2>
            <p className={`text-xs ${t.textSecondary} mt-0.5`}>
              Enter handles, pick platforms, add passwords. Paste URLs to auto-detect.
            </p>
          </div>
          <button
            onClick={onClose}
            className={`text-2xl leading-none ${t.textMuted} hover:${t.textPrimary} transition ${isMobile ? 'min-w-[44px] min-h-[44px] flex items-center justify-center' : ''}`}
          >
            &times;
          </button>
        </div>

        {!results ? (
          <>
            {/* Entry rows */}
            <div className="px-6 py-4 space-y-5">
              {rows.map((row, rowIdx) => {
                const selected = getSelectedPlatforms(row);
                return (
                  <div
                    key={rowIdx}
                    className={`p-4 rounded-xl border ${t.cardBorder} ${t.bgElevated}`}
                  >
                    {/* Row header: handle + remove */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className={`text-xs font-semibold ${t.textMuted} w-6`}>
                        #{rowIdx + 1}
                      </span>
                      <input
                        type="text"
                        value={row.handle}
                        onChange={(e) => updateHandle(rowIdx, e.target.value)}
                        placeholder="@handle or paste URL"
                        className={`flex-1 px-3 py-2 rounded-lg border ${t.inputBorder} outline-none text-sm transition ${t.bgInput} ${t.textPrimary} ${isMobile ? 'min-h-[44px]' : ''}`}
                        {...(isMobile ? { inputMode: 'url' } : {})}
                      />
                      <button
                        onClick={() => removeRow(rowIdx)}
                        className={`text-lg ${t.textMuted} hover:text-red-400 transition ${isMobile ? 'min-w-[44px] min-h-[44px] flex items-center justify-center' : ''}`}
                        title="Remove row"
                      >
                        &times;
                      </button>
                    </div>

                    {/* Platform toggles */}
                    <div className={`flex gap-2 flex-wrap ${isMobile ? 'ml-0 mt-2' : 'ml-9'} mb-2`}>
                      {ALL_PLATFORMS.map((platform) => {
                        const meta = PLATFORM_META[platform];
                        const isSelected = row.platforms[platform];
                        return (
                          <button
                            key={platform}
                            onClick={() => togglePlatform(rowIdx, platform)}
                            className={`inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border transition ${
                              isSelected
                                ? 'text-white border-transparent'
                                : 'border-dashed opacity-60 hover:opacity-100'
                            }`}
                            style={{
                              ...(isSelected
                                ? { backgroundColor: meta.color, borderColor: meta.color }
                                : { borderColor: meta.color + '66', color: meta.color }),
                              ...(isMobile
                                ? { minHeight: '44px', padding: '10px 16px' }
                                : { padding: '6px 12px' }),
                            }}
                          >
                            <span>{meta.icon}</span>
                            <span>{meta.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Per-platform password fields */}
                    {selected.length > 0 && (
                      <div className="ml-9 mt-3 space-y-2">
                        {selected.map((platform) => {
                          const meta = PLATFORM_META[platform];
                          const pwKey = `${rowIdx}-${platform}`;
                          const isVisible = showPasswords[pwKey];
                          return (
                            <div key={platform} className="flex items-center gap-2">
                              <span className="text-xs w-20 shrink-0" style={{ color: meta.color }}>
                                {meta.icon} {meta.label}
                              </span>
                              <div className="relative flex-1">
                                <input
                                  type={isVisible ? 'text' : 'password'}
                                  value={row.passwords[platform]}
                                  onChange={(e) => updatePassword(rowIdx, platform, e.target.value)}
                                  placeholder="Password"
                                  className={`w-full px-3 py-1.5 pr-9 rounded-lg border ${t.inputBorder} outline-none text-xs transition ${t.bgInput} ${t.textPrimary}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => togglePasswordVisibility(pwKey)}
                                  className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs ${t.textMuted}`}
                                  title={isVisible ? 'Hide' : 'Show'}
                                >
                                  {isVisible ? '🙈' : '👁'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer: add row + done */}
            <div
              className={`px-6 py-4 border-t ${t.borderSubtle} flex items-center justify-between sticky bottom-0 ${t.bgPage} ${isMobile ? 'pb-[max(16px,env(safe-area-inset-bottom))] flex-wrap gap-3' : ''}`}
            >
              <Button variant="neutral-tertiary" size="small" onClick={addRow}>
                + Add Another
              </Button>
              <div className="flex gap-3">
                <Button variant="neutral-secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="brand-primary"
                  onClick={handleSave}
                  disabled={saving || validRows.length === 0}
                  loading={saving}
                >
                  {saving
                    ? 'Saving...'
                    : `Done (${validRows.length} handle${validRows.length !== 1 ? 's' : ''})`}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Results display */}
            <div className="px-6 py-4">
              <p className={`text-sm font-semibold ${t.textPrimary} mb-4`}>
                Added {results.length} account{results.length !== 1 ? 's' : ''}
              </p>
              <div className="space-y-2">
                {results.map((r, i) => {
                  const meta = PLATFORM_META[r.platform] || {
                    label: r.platform,
                    icon: '🔗',
                    color: '#888',
                  };
                  const status = getAccountStatus(r.handle, r.platform);
                  const sl = statusLabels[status];
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${t.cardBorder} ${t.bgElevated}`}
                    >
                      <span className="text-sm">{meta.icon}</span>
                      <span className={`text-sm font-medium ${t.textPrimary} flex-1`}>
                        {r.handle}
                      </span>
                      <span className="text-xs font-medium" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${sl.className}`}
                      >
                        {sl.text}
                      </span>
                    </div>
                  );
                })}
              </div>
              {results.some((r) => getAccountStatus(r.handle, r.platform) === 'pending') && (
                <p className={`text-xs ${t.textMuted} mt-4`}>
                  Accounts marked "Needs OAuth" require you to connect them via Late's OAuth flow.
                  Use the "Connect" button next to each account. If connection fails, double-check
                  the password.
                </p>
              )}
              {results.some((r) => getAccountStatus(r.handle, r.platform) === 'waiting') && (
                <p className={`text-xs ${t.textMuted} mt-2`}>
                  Accounts marked "Waiting for Late" will auto-connect once you set up the Late API
                  key for this artist.
                </p>
              )}
            </div>
            <div
              className={`px-6 py-4 border-t ${t.borderSubtle} flex justify-end sticky bottom-0 ${t.bgPage} ${isMobile ? 'pb-[max(16px,env(safe-area-inset-bottom))]' : ''}`}
            >
              <Button variant="brand-primary" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// PagesTab — Main component
// ═══════════════════════════════════════════════════════════

const PagesTab = ({
  latePages = [],
  visibleArtists = [],
  unconfiguredLateArtists = [],
  loadingLatePages,
  onLoadLatePages,
  onConfigureLate,
  user,
  socialSetsAllowed = 0,
  // Manual accounts
  manualAccountsByArtist = {},
  onAddManualAccounts,
  onRemoveManualAccount,
}) => {
  const { theme } = useTheme();
  const { success: toastSuccess, error: toastError } = useToast();
  const { isMobile } = useIsMobile();
  const t = theme.tw;
  const [expandedArtists, setExpandedArtists] = useState({});
  const [expandedHandles, setExpandedHandles] = useState({});
  const [bulkEntryArtistId, setBulkEntryArtistId] = useState(null);
  const [showPasswords, setShowPasswords] = useState({});
  const togglePw = (key) => setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }));

  // Social Set usage
  const socialSetsUsed = useMemo(() => {
    const handles = new Set(latePages.map((p) => p.handle).filter(Boolean));
    return handles.size;
  }, [latePages]);

  const isAtLimit =
    socialSetsAllowed > 0 &&
    socialSetsUsed >= socialSetsAllowed &&
    !(user?.paymentExempt || user?.role === 'conductor');
  const [connectingPlatform, setConnectingPlatform] = useState(null); // { artistId, platform }
  const oauthPendingRef = useRef(false);

  // Group latePages + manual accounts by artistId, then by normalized handle
  const mergedPagesByArtist = useMemo(() => {
    const merged = {};
    // Add Late pages
    latePages.forEach((page) => {
      const aid = page.artistId;
      if (!merged[aid]) merged[aid] = {};
      const norm = page.handle?.replace(/^@/, '').toLowerCase() || '';
      if (!merged[aid][norm])
        merged[aid][norm] = { displayHandle: page.handle, pages: [], manualEntries: [] };
      merged[aid][norm].pages.push(page);
      merged[aid][norm].displayHandle = page.handle; // prefer Late casing
    });
    // Add manual accounts
    Object.entries(manualAccountsByArtist).forEach(([artistId, accounts]) => {
      if (!accounts?.length) return;
      if (!merged[artistId]) merged[artistId] = {};
      accounts.forEach((acc, idx) => {
        const norm = acc.handle?.replace(/^@/, '').toLowerCase() || '';
        if (!merged[artistId][norm])
          merged[artistId][norm] = { displayHandle: acc.handle, pages: [], manualEntries: [] };
        const group = merged[artistId][norm];
        // Only add manual entry if Late doesn't already cover this handle+platform
        const alreadyCovered = group.pages.some((p) => p.platform === acc.platform);
        if (!alreadyCovered) {
          group.manualEntries.push({ ...acc, _idx: idx });
        }
      });
    });
    return merged;
  }, [latePages, manualAccountsByArtist]);

  // Set of unconfigured artist IDs for quick lookup
  const unconfiguredIds = useMemo(
    () => new Set(unconfiguredLateArtists.map((a) => a.id)),
    [unconfiguredLateArtists],
  );

  // Set of artist IDs that have pages loaded (confirmed configured)
  const configuredIds = useMemo(() => new Set(latePages.map((p) => p.artistId)), [latePages]);

  // Total stats (Late + manual-only)
  const totalAccounts = useMemo(() => {
    let count = latePages.length;
    Object.values(mergedPagesByArtist).forEach((handles) => {
      Object.values(handles).forEach((group) => {
        count += group.manualEntries.length;
      });
    });
    return count;
  }, [latePages.length, mergedPagesByArtist]);

  const totalHandles = useMemo(() => {
    let count = 0;
    Object.values(mergedPagesByArtist).forEach((handles) => {
      count += Object.keys(handles).length;
    });
    return count;
  }, [mergedPagesByArtist]);

  const toggleArtist = (artistId) => {
    setExpandedArtists((prev) => ({ ...prev, [artistId]: !prev[artistId] }));
  };

  const toggleHandle = (key) => {
    setExpandedHandles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Late OAuth connect flow: get or create profile, then redirect to Late OAuth
  const handleConnectPlatform = useCallback(async (artistId, platform) => {
    setConnectingPlatform({ artistId, platform });
    try {
      // Get existing profiles for this artist
      let profiles = [];
      try {
        const result = await getLateProfiles(artistId);
        profiles = result.profiles || [];
      } catch {
        // No profiles yet
      }

      // Use first profile or create one
      let profileId;
      if (profiles.length > 0) {
        profileId = profiles[0]._id;
      } else {
        const created = await createLateProfile(artistId, 'Default');
        profileId = created.profile?._id;
      }

      if (!profileId) {
        throw new Error('Could not create or find a Late profile');
      }

      // Get the OAuth connect URL
      const redirectUrl = window.location.origin + '/operator/pages';
      const { authUrl } = await getConnectUrl(artistId, platform, profileId, redirectUrl);

      if (authUrl) {
        // Open Late OAuth in new tab — set pending flag for auto-refresh on return
        oauthPendingRef.current = true;
        window.open(authUrl, '_blank', 'noopener,noreferrer');
      } else {
        throw new Error('No auth URL returned from Late');
      }
    } catch (error) {
      log.error('Failed to start connect flow:', error);
      toastError(`Failed to connect ${platform}: ${error.message}`);
    } finally {
      setConnectingPlatform(null);
    }
  }, []);

  // Auto-refresh Late accounts when returning from OAuth tab
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

  // Default all artists to expanded
  const isArtistExpanded = (artistId) => expandedArtists[artistId] !== false;

  // Bulk entry save handler — auto-triggers OAuth for newly saved accounts if Late is configured
  const handleBulkSave = useCallback(
    async (artistId, accounts) => {
      let result;
      if (onAddManualAccounts) {
        result = await onAddManualAccounts(artistId, accounts);
      } else {
        result = accounts.map((a) => ({ ...a, status: 'saved' }));
      }

      // Auto-trigger OAuth for newly saved accounts if Late is configured
      const isLateConfigured = !unconfiguredIds.has(artistId);
      if (isLateConfigured) {
        const savedAccounts = result.filter((r) => r.status === 'saved');
        const uniquePlatforms = [...new Set(savedAccounts.map((a) => a.platform))];
        if (uniquePlatforms.length > 0) {
          toastSuccess(`Now connect ${uniquePlatforms.join(', ')} via OAuth...`);
          // Auto-trigger first platform's OAuth
          handleConnectPlatform(artistId, uniquePlatforms[0]);
        }
      }
      return result;
    },
    [onAddManualAccounts, unconfiguredIds, handleConnectPlatform, toastSuccess],
  );

  // Find the artist for bulk entry modal
  const bulkEntryArtist = bulkEntryArtistId
    ? visibleArtists.find((a) => a.id === bulkEntryArtistId)
    : null;

  return (
    <div className={`flex-1 overflow-auto ${isMobile ? 'p-3' : 'px-12 py-8'} ${t.bgPage}`}>
      <div className="w-full">
        {/* Header */}
        <div className={`flex items-center justify-between ${isMobile ? 'mb-5' : 'mb-8'}`}>
          <div>
            <h1 className={`${isMobile ? 'text-xl' : 'text-2xl'} font-bold ${t.textPrimary}`}>
              Your Pages
            </h1>
            <p className={`text-sm ${t.textSecondary} mt-1`}>
              {visibleArtists.length} artist{visibleArtists.length !== 1 ? 's' : ''} ·{' '}
              {totalHandles} handle{totalHandles !== 1 ? 's' : ''} · {totalAccounts} account
              {totalAccounts !== 1 ? 's' : ''}
              {socialSetsAllowed > 0 && (
                <span className={`ml-2 ${isAtLimit ? 'text-amber-400' : ''}`}>
                  · {socialSetsUsed}/{socialSetsAllowed} Social Sets
                </span>
              )}
            </p>
          </div>
          <Button
            variant="neutral-secondary"
            size="small"
            onClick={onLoadLatePages}
            disabled={loadingLatePages}
            loading={loadingLatePages}
          >
            {loadingLatePages ? 'Syncing...' : '↻ Sync All'}
          </Button>
        </div>

        {/* No artists at all */}
        {visibleArtists.length === 0 ? (
          <div className={`text-center py-20 rounded-2xl border ${t.cardBorder} ${t.cardBg}`}>
            <div className="text-4xl mb-4">🎤</div>
            <h3 className={`text-lg font-semibold mb-2 ${t.textPrimary}`}>No artists assigned</h3>
            <p className={`text-sm ${t.textSecondary} max-w-sm mx-auto`}>
              Contact your administrator to get artists assigned to your account.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {visibleArtists.map((artist) => {
              const artistMerged = mergedPagesByArtist[artist.id] || {};
              const handleEntries = Object.entries(artistMerged);
              const hasPages = handleEntries.some(([, g]) => g.pages.length > 0);
              const hasAnyEntries = handleEntries.length > 0;
              const isUnconfigured =
                unconfiguredIds.has(artist.id) || (!hasPages && !configuredIds.has(artist.id));
              const isLateConfigured = !isUnconfigured || configuredIds.has(artist.id);
              const expanded = isArtistExpanded(artist.id);

              // Count total followers for this artist (Late only)
              const artistFollowers = handleEntries.reduce(
                (sum, [, group]) => sum + group.pages.reduce((s, p) => s + (p.followers || 0), 0),
                0,
              );

              // Artist profile picture: from artist doc, linked user, or first Late page
              const artistPhoto =
                artist.photoURL ||
                handleEntries.flatMap(([, g]) => g.pages).find((p) => p.profileImage)
                  ?.profileImage ||
                null;

              // All platforms already connected (Late or manual) across all handles for this artist
              const allConnectedPlatforms = new Set();
              handleEntries.forEach(([, group]) => {
                group.pages.forEach((p) => allConnectedPlatforms.add(p.platform));
                group.manualEntries.forEach((e) => allConnectedPlatforms.add(e.platform));
              });
              const artistMissingPlatforms = ALL_PLATFORMS.filter(
                (p) => !allConnectedPlatforms.has(p),
              );

              return (
                <div
                  key={artist.id}
                  className={`rounded-xl border ${t.cardBorder} overflow-hidden`}
                >
                  {/* Artist Header */}
                  <div
                    onClick={() => toggleArtist(artist.id)}
                    className={`cursor-pointer ${isMobile ? 'px-4 py-3 min-h-[56px]' : 'px-6 py-4'} flex items-center justify-between ${t.cardBg}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {artistPhoto ? (
                        <img
                          src={artistPhoto}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shrink-0 bg-indigo-500/15 text-indigo-500">
                          {artist.name?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h2
                          className={`font-bold ${isMobile ? 'text-base' : 'text-lg'} ${t.textPrimary} truncate`}
                        >
                          {artist.name}
                        </h2>
                        <p className={`text-xs ${t.textSecondary}`}>
                          {hasAnyEntries
                            ? `${handleEntries.length} handle${handleEntries.length !== 1 ? 's' : ''}${artistFollowers > 0 ? ` · ${formatFollowers(artistFollowers)} followers` : ''}`
                            : isUnconfigured
                              ? 'Late not connected'
                              : 'No pages found'}
                        </p>
                      </div>
                    </div>
                    <div
                      className={`flex items-center ${isMobile ? 'gap-2' : 'gap-3'} shrink-0 flex-wrap justify-end`}
                    >
                      {/* Add Accounts button */}
                      <Button
                        variant="neutral-secondary"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBulkEntryArtistId(artist.id);
                        }}
                      >
                        + Add Accounts
                      </Button>
                      {!isMobile && isUnconfigured && !hasAnyEntries && (
                        <Badge variant="warning">Setup Required</Badge>
                      )}
                      {!isMobile && hasAnyEntries && !hasPages && (
                        <Badge variant="neutral">Manual</Badge>
                      )}
                      {!isMobile && hasPages && <Badge variant="success">Connected</Badge>}
                      <span
                        className={`text-lg transition-transform duration-200 ${expanded ? '' : '-rotate-90'} ${t.textSecondary}`}
                      >
                        ▼
                      </span>
                    </div>
                  </div>

                  {/* Artist Content (expanded) */}
                  {expanded && (
                    <div className={`border-t ${t.borderSubtle}`}>
                      {/* Unconfigured + no entries at all — show connect CTA */}
                      {isUnconfigured && !hasAnyEntries && (
                        <div className="px-6 py-8 text-center">
                          <div className="text-3xl mb-3">🔗</div>
                          <h3 className={`font-semibold mb-2 ${t.textPrimary}`}>
                            Connect Late for {artist.name}
                          </h3>
                          <p className={`text-sm ${t.textSecondary} mb-5 max-w-md mx-auto`}>
                            Add a Late.co API key to manage {artist.name}'s social media pages, or
                            add accounts manually.
                          </p>
                          <div
                            className={`flex gap-3 justify-center ${isMobile ? 'flex-col items-stretch px-4' : ''}`}
                          >
                            <Button
                              variant="brand-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                onConfigureLate(artist.id);
                              }}
                            >
                              Connect Late API Key
                            </Button>
                            <Button
                              variant="neutral-secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                setBulkEntryArtistId(artist.id);
                              }}
                            >
                              Add Accounts Manually
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Has entries — unified handle list */}
                      {hasAnyEntries && (
                        <>
                          {/* Inline Late banner if unconfigured */}
                          {isUnconfigured && (
                            <div
                              className={`${isMobile ? 'px-4' : 'px-6'} py-3 flex items-center justify-between gap-3 bg-indigo-500/[0.07]`}
                            >
                              <p className={`text-sm ${t.textSecondary}`}>
                                Connect Late to enable scheduling for {artist.name}'s accounts.
                              </p>
                              <Button
                                variant="brand-primary"
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onConfigureLate(artist.id);
                                }}
                              >
                                Connect Late
                              </Button>
                            </div>
                          )}

                          <div className={`divide-y ${t.borderSubtle}`}>
                            {handleEntries.map(([normalizedHandle, group]) => {
                              const { displayHandle, pages, manualEntries } = group;
                              const handleKey = `${artist.id}:${normalizedHandle}`;
                              const isHandleExpanded = expandedHandles[handleKey] || false;
                              const totalHandleFollowers = pages.reduce(
                                (s, p) => s + (p.followers || 0),
                                0,
                              );
                              const profilePic = pages.find((p) => p.profileImage)?.profileImage;
                              const firstPlatform =
                                pages[0]?.platform || manualEntries[0]?.platform;
                              const primaryMeta = PLATFORM_META[firstPlatform] || {
                                label: 'Unknown',
                                icon: '🔗',
                                color: '#888',
                              };
                              const latePlatforms = pages.map((p) => p.platform);
                              const manualPlatforms = manualEntries.map((e) => e.platform);
                              const coveredPlatforms = [
                                ...new Set([...latePlatforms, ...manualPlatforms]),
                              ];
                              const missingPlatforms = ALL_PLATFORMS.filter(
                                (p) => !coveredPlatforms.includes(p),
                              );

                              return (
                                <div key={handleKey}>
                                  {/* Handle Row */}
                                  <div
                                    onClick={() => toggleHandle(handleKey)}
                                    className={`cursor-pointer px-6 py-3 flex items-center justify-between gap-4 hover:opacity-80 transition ${t.bgPage}`}
                                  >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                      {profilePic ? (
                                        <img
                                          src={profilePic}
                                          alt={displayHandle}
                                          className="w-9 h-9 rounded-full object-cover shrink-0"
                                          referrerPolicy="no-referrer"
                                        />
                                      ) : (
                                        <div
                                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                                          style={{
                                            backgroundColor: primaryMeta.color + '22',
                                            color: primaryMeta.color,
                                          }}
                                        >
                                          <span className="text-sm">{primaryMeta.icon}</span>
                                        </div>
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <span className={`font-semibold text-sm ${t.textPrimary}`}>
                                          {displayHandle}
                                        </span>
                                        <div className="flex gap-1.5 mt-1 flex-wrap">
                                          {/* Late platform badges (solid) */}
                                          {pages.map((page) => {
                                            const meta = PLATFORM_META[page.platform] || {
                                              label: page.platform,
                                              icon: '🔗',
                                              color: '#888',
                                            };
                                            const profileUrl = getProfileUrl(
                                              page.platform,
                                              page.handle,
                                            );
                                            return (
                                              <a
                                                key={page.platform}
                                                href={profileUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white no-underline hover:brightness-110 transition"
                                                style={{
                                                  backgroundColor: meta.color,
                                                  ...(isMobile
                                                    ? { minHeight: 32, padding: '6px 10px' }
                                                    : {}),
                                                }}
                                                title={`Open ${meta.label} profile`}
                                              >
                                                <span>{meta.icon}</span>
                                                <span>{meta.label}</span>
                                              </a>
                                            );
                                          })}
                                          {/* Manual-only platform badges (dashed border) */}
                                          {manualEntries.map((entry) => {
                                            const meta = PLATFORM_META[entry.platform] || {
                                              label: entry.platform,
                                              icon: '🔗',
                                              color: '#888',
                                            };
                                            return (
                                              <span
                                                key={`manual-${entry.platform}`}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-dashed"
                                                style={{
                                                  borderColor: meta.color,
                                                  color: meta.color,
                                                  ...(isMobile
                                                    ? { minHeight: 32, padding: '6px 10px' }
                                                    : {}),
                                                }}
                                              >
                                                <span>{meta.icon}</span>
                                                <span>{meta.label}</span>
                                              </span>
                                            );
                                          })}
                                          {/* Missing platform connect buttons (inline) — opens bulk entry modal */}
                                          {missingPlatforms.map((platform) => {
                                            const meta = PLATFORM_META[platform];
                                            return (
                                              <button
                                                key={`add-${platform}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setBulkEntryArtistId(artist.id);
                                                }}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-dashed opacity-40 hover:opacity-80 transition"
                                                style={{
                                                  borderColor: meta.color + '66',
                                                  color: meta.color,
                                                  ...(isMobile
                                                    ? { minHeight: 32, padding: '6px 10px' }
                                                    : {}),
                                                }}
                                                title={`Add ${meta.label}`}
                                              >
                                                <span>{meta.icon}</span>
                                                <span>+</span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                      {totalHandleFollowers > 0 && (
                                        <div className="text-right">
                                          <span
                                            className={`text-sm font-semibold ${t.textPrimary}`}
                                          >
                                            {formatFollowers(totalHandleFollowers)}
                                          </span>
                                          <span className={`text-xs ${t.textSecondary} ml-1`}>
                                            followers
                                          </span>
                                        </div>
                                      )}
                                      <span
                                        className={`text-sm transition-transform duration-200 ${isHandleExpanded ? '' : '-rotate-90'} ${t.textSecondary}`}
                                      >
                                        ▼
                                      </span>
                                    </div>
                                  </div>

                                  {/* Handle Expanded — platform details */}
                                  {isHandleExpanded && (
                                    <div className={`${t.bgSurface} border-t ${t.borderSubtle}`}>
                                      {/* Late platform rows */}
                                      {pages.map((page) => {
                                        const meta = PLATFORM_META[page.platform] || {
                                          label: page.platform,
                                          icon: '🔗',
                                          color: '#888',
                                        };
                                        return (
                                          <div
                                            key={`${page.handle}-${page.platform}`}
                                            className={`px-8 py-2.5 flex items-center justify-between border-b ${t.borderSubtle} last:border-b-0`}
                                          >
                                            <a
                                              href={getProfileUrl(page.platform, page.handle)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center gap-3 no-underline hover:underline"
                                              title={`Open ${meta.label} profile`}
                                            >
                                              <span className="text-base">{meta.icon}</span>
                                              <span
                                                className="text-sm"
                                                style={{ color: meta.color }}
                                              >
                                                {meta.label}
                                              </span>
                                            </a>
                                            <div className="flex items-center gap-4">
                                              <span className={`text-sm ${t.textSecondary}`}>
                                                {formatFollowers(page.followers)}
                                              </span>
                                              <Badge
                                                variant={
                                                  page.status === 'active' ? 'success' : 'warning'
                                                }
                                              >
                                                {page.status === 'active' ? 'Active' : 'Inactive'}
                                              </Badge>
                                            </div>
                                          </div>
                                        );
                                      })}

                                      {/* Manual-only platform rows */}
                                      {manualEntries.map((entry) => {
                                        const meta = PLATFORM_META[entry.platform] || {
                                          label: entry.platform,
                                          icon: '🔗',
                                          color: '#888',
                                        };
                                        const pwKey = `manual-${entry._idx}`;
                                        const pwVisible = showPasswords[pwKey];
                                        return (
                                          <div
                                            key={`manual-${entry.platform}-${entry._idx}`}
                                            className={`px-8 py-2.5 flex items-center justify-between border-b ${t.borderSubtle} last:border-b-0`}
                                          >
                                            <div className="flex items-center gap-3">
                                              <span className="text-base">{meta.icon}</span>
                                              <span
                                                className="text-sm"
                                                style={{ color: meta.color }}
                                              >
                                                {meta.label}
                                              </span>
                                              {entry.password && (
                                                <span
                                                  className={`text-xs ${t.textMuted} font-mono flex items-center gap-1 ml-2`}
                                                >
                                                  {pwVisible ? entry.password : '••••••••'}
                                                  <button
                                                    onClick={() => togglePw(pwKey)}
                                                    className={`text-xs ${t.textMuted}`}
                                                    title={pwVisible ? 'Hide' : 'Show'}
                                                  >
                                                    {pwVisible ? '🙈' : '👁'}
                                                  </button>
                                                </span>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-3">
                                              <Badge variant="neutral">Manual</Badge>
                                              {isLateConfigured && (
                                                <button
                                                  onClick={() =>
                                                    handleConnectPlatform(artist.id, entry.platform)
                                                  }
                                                  disabled={!!connectingPlatform}
                                                  className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 transition disabled:opacity-40"
                                                >
                                                  {connectingPlatform?.artistId === artist.id &&
                                                  connectingPlatform?.platform === entry.platform
                                                    ? 'Connecting...'
                                                    : 'Connect'}
                                                </button>
                                              )}
                                              <button
                                                onClick={() =>
                                                  onRemoveManualAccount(artist.id, entry._idx)
                                                }
                                                className={`text-xs ${t.textMuted} hover:text-red-400 transition`}
                                                title="Remove"
                                              >
                                                &times;
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}

                                      {/* Add missing platforms for this handle */}
                                      {missingPlatforms.length > 0 && isLateConfigured && (
                                        <div
                                          className={`${isMobile ? 'px-4' : 'px-8'} py-3 border-t ${t.borderSubtle}`}
                                        >
                                          <p className={`text-xs ${t.textMuted} mb-2`}>
                                            Connect another platform:
                                          </p>
                                          <div className="flex gap-2 flex-wrap">
                                            {missingPlatforms.map((platform) => {
                                              const meta = PLATFORM_META[platform];
                                              const isConnecting =
                                                connectingPlatform?.artistId === artist.id &&
                                                connectingPlatform?.platform === platform;
                                              return (
                                                <button
                                                  key={platform}
                                                  onClick={() =>
                                                    handleConnectPlatform(artist.id, platform)
                                                  }
                                                  disabled={!!connectingPlatform}
                                                  className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border border-dashed transition hover:opacity-80 disabled:opacity-40"
                                                  style={{
                                                    borderColor: meta.color + '66',
                                                    color: meta.color,
                                                    ...(isMobile
                                                      ? { minHeight: '44px', padding: '10px 16px' }
                                                      : { padding: '6px 12px' }),
                                                  }}
                                                >
                                                  <span>{meta.icon}</span>
                                                  {isConnecting
                                                    ? 'Connecting...'
                                                    : `+ ${meta.label}`}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* Connect a new account — only show platforms not already connected */}
                            {isLateConfigured && artistMissingPlatforms.length > 0 && (
                              <div className={`${isMobile ? 'px-4' : 'px-6'} py-3 ${t.bgPage}`}>
                                <p className={`text-xs ${t.textMuted} mb-2`}>
                                  Connect another platform:
                                </p>
                                <div className="flex gap-2 flex-wrap">
                                  {artistMissingPlatforms.map((platform) => {
                                    const meta = PLATFORM_META[platform];
                                    const isConnecting =
                                      connectingPlatform?.artistId === artist.id &&
                                      connectingPlatform?.platform === platform;
                                    return (
                                      <button
                                        key={platform}
                                        onClick={() => handleConnectPlatform(artist.id, platform)}
                                        disabled={!!connectingPlatform}
                                        className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border border-dashed transition hover:opacity-80 disabled:opacity-40"
                                        style={{
                                          borderColor: meta.color + '66',
                                          color: meta.color,
                                          ...(isMobile
                                            ? { minHeight: '44px', padding: '10px 16px' }
                                            : { padding: '6px 12px' }),
                                        }}
                                      >
                                        <span>{meta.icon}</span>
                                        {isConnecting ? 'Connecting...' : `+ ${meta.label}`}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {/* Configured but no entries at all */}
                      {!isUnconfigured && !hasAnyEntries && (
                        <div className="px-6 py-8 text-center">
                          <div className="text-3xl mb-3">📱</div>
                          <h3 className={`font-semibold mb-2 ${t.textPrimary}`}>
                            No pages connected yet
                          </h3>
                          <p className={`text-sm ${t.textSecondary} mb-5 max-w-md mx-auto`}>
                            {artist.name}'s Late account is set up. Connect social media accounts to
                            start scheduling.
                          </p>
                          <div
                            className={`flex gap-2 justify-center flex-wrap ${isMobile ? 'flex-col items-stretch px-4' : ''}`}
                          >
                            {ALL_PLATFORMS.map((platform) => {
                              const meta = PLATFORM_META[platform];
                              const isConnecting =
                                connectingPlatform?.artistId === artist.id &&
                                connectingPlatform?.platform === platform;
                              return (
                                <button
                                  key={platform}
                                  onClick={() => handleConnectPlatform(artist.id, platform)}
                                  disabled={!!connectingPlatform}
                                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
                                  style={{
                                    backgroundColor: meta.color,
                                    ...(isMobile ? { minHeight: 44 } : {}),
                                  }}
                                >
                                  <span>{meta.icon}</span>
                                  {isConnecting ? 'Connecting...' : `Connect ${meta.label}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk Account Entry Modal */}
      {bulkEntryArtist && (
        <BulkAccountEntry
          artistId={bulkEntryArtist.id}
          artistName={bulkEntryArtist.name}
          latePages={latePages}
          isLateConfigured={
            !unconfiguredIds.has(bulkEntryArtist.id) || configuredIds.has(bulkEntryArtist.id)
          }
          onSave={handleBulkSave}
          onClose={() => setBulkEntryArtistId(null)}
          isMobile={isMobile}
        />
      )}
    </div>
  );
};

export default PagesTab;
