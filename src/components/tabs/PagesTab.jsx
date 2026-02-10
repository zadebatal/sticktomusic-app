import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../ui';
import { getLateProfiles, createLateProfile, getConnectUrl } from '../../services/lateService';
import useIsMobile from '../../hooks/useIsMobile';

import { PLATFORM_META, ALL_PLATFORMS, getProfileUrl, formatFollowers } from '../../utils/platformUtils';

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

const BulkAccountEntry = ({ artistId, artistName, latePages, isLateConfigured, onSave, onClose, isMobile }) => {
  const { theme } = useTheme();
  const t = theme.tw;

  const [rows, setRows] = useState([EMPTY_ROW()]);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState(null); // array of { handle, platform, status }
  const [showPasswords, setShowPasswords] = useState({});

  const addRow = () => setRows(prev => [...prev, EMPTY_ROW()]);

  const removeRow = (index) => {
    setRows(prev => prev.length <= 1 ? [EMPTY_ROW()] : prev.filter((_, i) => i !== index));
  };

  const updateHandle = (index, value) => {
    const detected = detectPlatformFromUrl(value);
    setRows(prev => prev.map((row, i) => {
      if (i !== index) return row;
      if (detected) {
        return {
          ...row,
          handle: detected.handle,
          platforms: { ...row.platforms, [detected.platform]: true },
        };
      }
      return { ...row, handle: value };
    }));
  };

  const togglePlatform = (index, platform) => {
    setRows(prev => prev.map((row, i) => {
      if (i !== index) return row;
      return { ...row, platforms: { ...row.platforms, [platform]: !row.platforms[platform] } };
    }));
  };

  const updatePassword = (index, platform, value) => {
    setRows(prev => prev.map((row, i) => {
      if (i !== index) return row;
      return { ...row, passwords: { ...row.passwords, [platform]: value } };
    }));
  };

  const togglePasswordVisibility = (key) => {
    setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getSelectedPlatforms = (row) => ALL_PLATFORMS.filter(p => row.platforms[p]);

  const validRows = rows.filter(r => r.handle.trim() && getSelectedPlatforms(r).length > 0);

  const handleSave = async () => {
    if (!validRows.length) return;
    setSaving(true);

    // Expand rows into individual account entries
    const accounts = [];
    validRows.forEach(row => {
      const handle = row.handle.trim().startsWith('@') ? row.handle.trim() : `@${row.handle.trim()}`;
      getSelectedPlatforms(row).forEach(platform => {
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
    const match = latePages.find(p =>
      p.artistId === artistId &&
      p.handle?.replace(/^@/, '').toLowerCase() === normalizedHandle &&
      p.platform === platform
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div
        className={`w-full overflow-auto ${isMobile ? '' : `max-w-3xl max-h-[85vh] rounded-2xl`} border ${t.cardBorder}`}
        style={{
          backgroundColor: theme.bg.page,
          ...(isMobile ? { position: 'fixed', inset: 0, borderRadius: 0, maxHeight: '100vh' } : {}),
        }}
      >
        {/* Header */}
        <div
          className={`px-6 py-4 border-b ${t.borderSubtle} flex items-center justify-between sticky top-0 z-10`}
          style={{
            backgroundColor: theme.bg.page,
            ...(isMobile ? { paddingTop: 'max(16px, env(safe-area-inset-top))' } : {}),
          }}
        >
          <div>
            <h2 className={`text-lg font-bold ${t.textPrimary}`}>Add Accounts for {artistName}</h2>
            <p className={`text-xs ${t.textSecondary} mt-0.5`}>
              Enter handles, pick platforms, add passwords. Paste URLs to auto-detect.
            </p>
          </div>
          <button
            onClick={onClose}
            className={`text-2xl leading-none ${t.textMuted} hover:${t.textPrimary} transition`}
            style={isMobile ? { minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}}
          >&times;</button>
        </div>

        {!results ? (
          <>
            {/* Entry rows */}
            <div className="px-6 py-4 space-y-5">
              {rows.map((row, rowIdx) => {
                const selected = getSelectedPlatforms(row);
                return (
                  <div key={rowIdx} className={`p-4 rounded-xl border ${t.cardBorder}`} style={{ backgroundColor: theme.bg.elevated }}>
                    {/* Row header: handle + remove */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className={`text-xs font-semibold ${t.textMuted} w-6`}>#{rowIdx + 1}</span>
                      <input
                        type="text"
                        value={row.handle}
                        onChange={(e) => updateHandle(rowIdx, e.target.value)}
                        placeholder="@handle or paste URL"
                        className={`flex-1 px-3 py-2 rounded-lg border ${t.inputBorder} outline-none text-sm transition`}
                        style={{ backgroundColor: theme.bg.input, color: theme.text.primary, ...(isMobile ? { minHeight: 44 } : {}) }}
                        {...(isMobile ? { inputMode: 'url' } : {})}
                      />
                      <button
                        onClick={() => removeRow(rowIdx)}
                        className={`text-lg ${t.textMuted} hover:text-red-400 transition`}
                        style={isMobile ? { minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}}
                        title="Remove row"
                      >&times;</button>
                    </div>

                    {/* Platform toggles */}
                    <div className={`flex gap-2 flex-wrap ${isMobile ? 'ml-0 mt-2' : 'ml-9'} mb-2`}>
                      {ALL_PLATFORMS.map(platform => {
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
                                : { borderColor: meta.color + '66', color: meta.color }
                              ),
                              ...(isMobile
                                ? { minHeight: '44px', padding: '10px 16px' }
                                : { padding: '6px 12px' }
                              ),
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
                        {selected.map(platform => {
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
                                  className={`w-full px-3 py-1.5 pr-9 rounded-lg border ${t.inputBorder} outline-none text-xs transition`}
                                  style={{ backgroundColor: theme.bg.input, color: theme.text.primary }}
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
              className={`px-6 py-4 border-t ${t.borderSubtle} flex items-center justify-between sticky bottom-0`}
              style={{
                backgroundColor: theme.bg.page,
                ...(isMobile ? { paddingBottom: 'max(16px, env(safe-area-inset-bottom))', flexWrap: 'wrap', gap: 12 } : {}),
              }}
            >
              <button
                onClick={addRow}
                className={`text-sm font-medium ${t.textSecondary} hover:${t.textPrimary} transition`}
                style={isMobile ? { minHeight: 44, padding: '10px 16px' } : {}}
              >
                + Add Another
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${t.btnSecondary}`}
                  style={isMobile ? { minHeight: 44 } : {}}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || validRows.length === 0}
                  className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${t.btnPrimary} disabled:opacity-50`}
                  style={isMobile ? { minHeight: 44 } : {}}
                >
                  {saving ? 'Saving...' : `Done (${validRows.length} handle${validRows.length !== 1 ? 's' : ''})`}
                </button>
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
                  const meta = PLATFORM_META[r.platform] || { label: r.platform, icon: '🔗', color: '#888' };
                  const status = getAccountStatus(r.handle, r.platform);
                  const sl = statusLabels[status];
                  return (
                    <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${t.cardBorder}`} style={{ backgroundColor: theme.bg.elevated }}>
                      <span className="text-sm">{meta.icon}</span>
                      <span className={`text-sm font-medium ${t.textPrimary} flex-1`}>{r.handle}</span>
                      <span className="text-xs font-medium" style={{ color: meta.color }}>{meta.label}</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${sl.className}`}>{sl.text}</span>
                    </div>
                  );
                })}
              </div>
              {results.some(r => getAccountStatus(r.handle, r.platform) === 'pending') && (
                <p className={`text-xs ${t.textMuted} mt-4`}>
                  Accounts marked "Needs OAuth" require you to connect them via Late's OAuth flow. Use the "Connect" button next to each account. If connection fails, double-check the password.
                </p>
              )}
              {results.some(r => getAccountStatus(r.handle, r.platform) === 'waiting') && (
                <p className={`text-xs ${t.textMuted} mt-2`}>
                  Accounts marked "Waiting for Late" will auto-connect once you set up the Late API key for this artist.
                </p>
              )}
            </div>
            <div
              className={`px-6 py-4 border-t ${t.borderSubtle} flex justify-end sticky bottom-0`}
              style={{
                backgroundColor: theme.bg.page,
                ...(isMobile ? { paddingBottom: 'max(16px, env(safe-area-inset-bottom))' } : {}),
              }}
            >
              <button
                onClick={onClose}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${t.btnPrimary}`}
                style={isMobile ? { minHeight: 44, width: '100%' } : {}}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// ManualAccountsSection — Display saved manual accounts per artist
// ═══════════════════════════════════════════════════════════

const ManualAccountsSection = ({ accounts, artistId, latePages, isLateConfigured, onRemove, onConnectPlatform, connectingPlatform, isMobile }) => {
  const { theme } = useTheme();
  const t = theme.tw;
  const [showPasswords, setShowPasswords] = useState({});

  if (!accounts || accounts.length === 0) return null;

  // Group manual accounts by handle
  const grouped = {};
  accounts.forEach((acc, idx) => {
    if (!grouped[acc.handle]) grouped[acc.handle] = [];
    grouped[acc.handle].push({ ...acc, _idx: idx });
  });

  const isConnectedInLate = (handle, platform) => {
    const normalized = handle.replace(/^@/, '').toLowerCase();
    return latePages.some(p =>
      p.artistId === artistId &&
      p.handle?.replace(/^@/, '').toLowerCase() === normalized &&
      p.platform === platform
    );
  };

  const togglePw = (key) => setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className={`border-t ${t.borderSubtle}`}>
      <div className={`px-6 py-2.5 flex items-center justify-between`} style={{ backgroundColor: theme.bg.surface }}>
        <span className={`text-xs font-semibold uppercase tracking-wider ${t.textMuted}`}>Manual Accounts</span>
      </div>
      {Object.entries(grouped).map(([handle, entries]) => (
        <div key={handle} className={`px-6 py-3 border-t ${t.borderSubtle}`} style={{ backgroundColor: theme.bg.page }}>
          <div className={`text-sm font-semibold ${t.textPrimary} mb-2`}>{handle}</div>
          <div className={`${isMobile ? 'space-y-3' : 'space-y-1.5'} ${isMobile ? 'ml-0' : 'ml-2'}`}>
            {entries.map((acc) => {
              const meta = PLATFORM_META[acc.platform] || { label: acc.platform, icon: '🔗', color: '#888' };
              const connected = isConnectedInLate(acc.handle, acc.platform);
              const pwKey = `manual-${acc._idx}`;
              const pwVisible = showPasswords[pwKey];
              return isMobile ? (
                /* Mobile: stacked card layout */
                <div
                  key={`${acc.platform}-${acc._idx}`}
                  className={`p-3 rounded-xl border ${t.cardBorder}`}
                  style={{ backgroundColor: theme.bg.elevated }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{meta.icon}</span>
                      <span className="text-xs font-medium" style={{ color: meta.color }}>{meta.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {connected ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-400">Connected</span>
                      ) : isLateConfigured ? (
                        <button
                          onClick={() => onConnectPlatform(artistId, acc.platform)}
                          disabled={!!connectingPlatform}
                          className="px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 transition disabled:opacity-40"
                          style={{ minHeight: 44, minWidth: 44 }}
                        >
                          {connectingPlatform?.artistId === artistId && connectingPlatform?.platform === acc.platform
                            ? 'Connecting...' : 'Connect'}
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-500/15 text-zinc-400">Waiting for Late</span>
                      )}
                      <button
                        onClick={() => onRemove(artistId, acc._idx)}
                        className={`text-xs ${t.textMuted} hover:text-red-400 transition`}
                        style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                  {acc.password && (
                    <div className={`text-xs ${t.textMuted} font-mono flex items-center gap-1`}>
                      {pwVisible ? acc.password : '••••••••'}
                      <button
                        onClick={() => togglePw(pwKey)}
                        className={`text-xs ${t.textMuted} hover:${t.textSecondary}`}
                        style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title={pwVisible ? 'Hide' : 'Show'}
                      >
                        {pwVisible ? '🙈' : '👁'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Desktop: inline row layout */
                <div key={`${acc.platform}-${acc._idx}`} className={`flex items-center gap-2 py-1.5`}>
                  <span className="text-sm">{meta.icon}</span>
                  <span className="text-xs font-medium w-16 shrink-0" style={{ color: meta.color }}>{meta.label}</span>
                  {/* Password */}
                  {acc.password && (
                    <span className={`text-xs ${t.textMuted} font-mono flex items-center gap-1`}>
                      {pwVisible ? acc.password : '••••••••'}
                      <button onClick={() => togglePw(pwKey)} className={`text-xs ${t.textMuted} hover:${t.textSecondary}`} title={pwVisible ? 'Hide' : 'Show'}>
                        {pwVisible ? '🙈' : '👁'}
                      </button>
                    </span>
                  )}
                  <div className="flex-1" />
                  {/* Status badge */}
                  {connected ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-400">Connected</span>
                  ) : isLateConfigured ? (
                    <button
                      onClick={() => onConnectPlatform(artistId, acc.platform)}
                      disabled={!!connectingPlatform}
                      className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 transition disabled:opacity-40"
                    >
                      {connectingPlatform?.artistId === artistId && connectingPlatform?.platform === acc.platform
                        ? 'Connecting...' : 'Connect'}
                    </button>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-500/15 text-zinc-400">Waiting for Late</span>
                  )}
                  {/* Remove */}
                  <button
                    onClick={() => onRemove(artistId, acc._idx)}
                    className={`text-xs ${t.textMuted} hover:text-red-400 transition ml-1`}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
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

  // Social Set usage
  const socialSetsUsed = useMemo(() => {
    const handles = new Set(latePages.map(p => p.handle).filter(Boolean));
    return handles.size;
  }, [latePages]);

  const isAtLimit = socialSetsAllowed > 0 && socialSetsUsed >= socialSetsAllowed && !(user?.paymentExempt || user?.role === 'conductor');
  const [connectingPlatform, setConnectingPlatform] = useState(null); // { artistId, platform }
  const oauthPendingRef = useRef(false);

  // Group latePages by artistId, then by handle
  const pagesByArtist = useMemo(() => {
    const grouped = {};
    latePages.forEach(page => {
      if (!grouped[page.artistId]) grouped[page.artistId] = {};
      if (!grouped[page.artistId][page.handle]) grouped[page.artistId][page.handle] = [];
      grouped[page.artistId][page.handle].push(page);
    });
    return grouped;
  }, [latePages]);

  // Set of unconfigured artist IDs for quick lookup
  const unconfiguredIds = useMemo(() =>
    new Set(unconfiguredLateArtists.map(a => a.id)),
    [unconfiguredLateArtists]
  );

  // Set of artist IDs that have pages loaded (confirmed configured)
  const configuredIds = useMemo(() =>
    new Set(latePages.map(p => p.artistId)),
    [latePages]
  );

  // Total stats
  const totalAccounts = latePages.length;
  const totalHandles = useMemo(() => {
    const handles = new Set(latePages.map(p => `${p.artistId}:${p.handle}`));
    return handles.size;
  }, [latePages]);

  const toggleArtist = (artistId) => {
    setExpandedArtists(prev => ({ ...prev, [artistId]: !prev[artistId] }));
  };

  const toggleHandle = (key) => {
    setExpandedHandles(prev => ({ ...prev, [key]: !prev[key] }));
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
      console.error('Failed to start connect flow:', error);
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
  const handleBulkSave = useCallback(async (artistId, accounts) => {
    let result;
    if (onAddManualAccounts) {
      result = await onAddManualAccounts(artistId, accounts);
    } else {
      result = accounts.map(a => ({ ...a, status: 'saved' }));
    }

    // Auto-trigger OAuth for newly saved accounts if Late is configured
    const isLateConfigured = !unconfiguredIds.has(artistId);
    if (isLateConfigured) {
      const savedAccounts = result.filter(r => r.status === 'saved');
      const uniquePlatforms = [...new Set(savedAccounts.map(a => a.platform))];
      if (uniquePlatforms.length > 0) {
        toastSuccess(`Now connect ${uniquePlatforms.join(', ')} via OAuth...`);
        // Auto-trigger first platform's OAuth
        handleConnectPlatform(artistId, uniquePlatforms[0]);
      }
    }
    return result;
  }, [onAddManualAccounts, unconfiguredIds, handleConnectPlatform, toastSuccess]);

  // Find the artist for bulk entry modal
  const bulkEntryArtist = bulkEntryArtistId ? visibleArtists.find(a => a.id === bulkEntryArtistId) : null;

  return (
    <div className={`flex-1 overflow-auto ${isMobile ? 'p-3' : 'p-6'} ${t.bgPage}`}>
      <div className={isMobile ? '' : 'max-w-5xl mx-auto'}>
        {/* Header */}
        <div className={`flex items-center justify-between ${isMobile ? 'mb-5' : 'mb-8'}`}>
          <div>
            <h1 className={`${isMobile ? 'text-xl' : 'text-2xl'} font-bold ${t.textPrimary}`}>Your Pages</h1>
            <p className={`text-sm ${t.textSecondary} mt-1`}>
              {visibleArtists.length} artist{visibleArtists.length !== 1 ? 's' : ''} · {totalHandles} handle{totalHandles !== 1 ? 's' : ''} · {totalAccounts} account{totalAccounts !== 1 ? 's' : ''}
              {socialSetsAllowed > 0 && (
                <span className={`ml-2 ${isAtLimit ? 'text-amber-400' : ''}`}>
                  · {socialSetsUsed}/{socialSetsAllowed} Social Sets
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onLoadLatePages}
            disabled={loadingLatePages}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${t.btnSecondary} disabled:opacity-50`}
            style={isMobile ? { minHeight: 44, minWidth: 44 } : {}}
          >
            {loadingLatePages ? 'Syncing...' : '↻ Sync All'}
          </button>
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
            {visibleArtists.map(artist => {
              const artistPages = pagesByArtist[artist.id] || {};
              const handleEntries = Object.entries(artistPages);
              const hasPages = handleEntries.length > 0;
              const isUnconfigured = unconfiguredIds.has(artist.id) || (!hasPages && !configuredIds.has(artist.id));
              const isLateConfigured = !isUnconfigured || configuredIds.has(artist.id);
              const expanded = isArtistExpanded(artist.id);
              const manualAccounts = manualAccountsByArtist[artist.id] || [];
              const hasManualAccounts = manualAccounts.length > 0;

              // Count total followers for this artist
              const artistFollowers = handleEntries.reduce((sum, [, pages]) =>
                sum + pages.reduce((s, p) => s + (p.followers || 0), 0), 0
              );

              return (
                <div key={artist.id} className={`rounded-xl border ${t.cardBorder} overflow-hidden`}>
                  {/* Artist Header */}
                  <div
                    onClick={() => toggleArtist(artist.id)}
                    className={`cursor-pointer ${isMobile ? 'px-4 py-3' : 'px-6 py-4'} flex items-center justify-between ${t.cardBg}`}
                    style={isMobile ? { minHeight: 56 } : {}}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
                        style={{ backgroundColor: theme.accent?.primary ? theme.accent.primary + '22' : '#6366f122', color: theme.accent?.primary || '#6366f1' }}>
                        {artist.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className={`font-bold ${isMobile ? 'text-base' : 'text-lg'} ${t.textPrimary} truncate`}>{artist.name}</h2>
                        <p className={`text-xs ${t.textSecondary}`}>
                          {hasPages
                            ? `${handleEntries.length} handle${handleEntries.length !== 1 ? 's' : ''} · ${formatFollowers(artistFollowers)} followers`
                            : hasManualAccounts
                              ? `${manualAccounts.length} manual account${manualAccounts.length !== 1 ? 's' : ''}`
                              : isUnconfigured
                                ? 'Late not connected'
                                : 'No pages found'
                          }
                        </p>
                      </div>
                    </div>
                    <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-3'} shrink-0 flex-wrap justify-end`}>
                      {/* Add Accounts button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setBulkEntryArtistId(artist.id); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${t.btnSecondary} hover:opacity-80`}
                        style={isMobile ? { minHeight: 44 } : {}}
                      >
                        + Add Accounts
                      </button>
                      {!isMobile && isUnconfigured && !hasManualAccounts && (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-400">
                          Setup Required
                        </span>
                      )}
                      {!isMobile && hasManualAccounts && !hasPages && (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400">
                          Manual
                        </span>
                      )}
                      {!isMobile && hasPages && (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-400">
                          Connected
                        </span>
                      )}
                      <span className={`text-lg transition-transform duration-200 ${expanded ? '' : '-rotate-90'} ${t.textSecondary}`}>
                        ▼
                      </span>
                    </div>
                  </div>

                  {/* Artist Content (expanded) */}
                  {expanded && (
                    <div className={`border-t ${t.borderSubtle}`}>
                      {/* Unconfigured + no manual accounts — show connect CTA */}
                      {isUnconfigured && !hasPages && !hasManualAccounts && (
                        <div className="px-6 py-8 text-center">
                          <div className="text-3xl mb-3">🔗</div>
                          <h3 className={`font-semibold mb-2 ${t.textPrimary}`}>
                            Connect Late for {artist.name}
                          </h3>
                          <p className={`text-sm ${t.textSecondary} mb-5 max-w-md mx-auto`}>
                            Add a Late.co API key to manage {artist.name}'s social media pages, or add accounts manually.
                          </p>
                          <div className={`flex gap-3 justify-center ${isMobile ? 'flex-col items-stretch px-4' : ''}`}>
                            <button
                              onClick={(e) => { e.stopPropagation(); onConfigureLate(artist.id); }}
                              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${t.btnPrimary}`}
                              style={isMobile ? { minHeight: 44 } : {}}
                            >
                              Connect Late API Key
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setBulkEntryArtistId(artist.id); }}
                              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${t.btnSecondary}`}
                              style={isMobile ? { minHeight: 44 } : {}}
                            >
                              Add Accounts Manually
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Has pages — show handles */}
                      {hasPages && (
                        <div className="divide-y" style={{ borderColor: theme.bg.surface }}>
                          {handleEntries.map(([handle, pages]) => {
                            const handleKey = `${artist.id}:${handle}`;
                            const isHandleExpanded = expandedHandles[handleKey] || false;
                            const totalHandleFollowers = pages.reduce((s, p) => s + (p.followers || 0), 0);
                            const profilePic = pages.find(p => p.profileImage)?.profileImage;
                            const primaryMeta = PLATFORM_META[pages[0]?.platform] || { label: 'Unknown', icon: '🔗', color: '#888' };
                            const connectedPlatforms = pages.map(p => p.platform);
                            const missingPlatforms = ALL_PLATFORMS.filter(p => !connectedPlatforms.includes(p));

                            return (
                              <div key={handleKey}>
                                {/* Handle Row */}
                                <div
                                  onClick={() => toggleHandle(handleKey)}
                                  className="cursor-pointer px-6 py-3 flex items-center justify-between gap-4 hover:opacity-80 transition"
                                  style={{ backgroundColor: theme.bg.page }}
                                >
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    {profilePic ? (
                                      <img src={profilePic} alt={handle} className="w-9 h-9 rounded-full object-cover shrink-0" />
                                    ) : (
                                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                                        style={{ backgroundColor: primaryMeta.color + '22', color: primaryMeta.color }}>
                                        <span className="text-sm">{primaryMeta.icon}</span>
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <span className={`font-semibold text-sm ${t.textPrimary}`}>{handle}</span>
                                      <div className="flex gap-1.5 mt-1 flex-wrap">
                                        {pages.map(page => {
                                          const meta = PLATFORM_META[page.platform] || { label: page.platform, icon: '🔗', color: '#888' };
                                          const profileUrl = getProfileUrl(page.platform, page.handle);
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
                                                ...(isMobile ? { minHeight: 32, padding: '6px 10px' } : {}),
                                              }}
                                              title={`Open ${meta.label} profile`}
                                            >
                                              <span>{meta.icon}</span>
                                              <span>{meta.label}</span>
                                            </a>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4 shrink-0">
                                    <div className="text-right">
                                      <span className={`text-sm font-semibold ${t.textPrimary}`}>{formatFollowers(totalHandleFollowers)}</span>
                                      <span className={`text-xs ${t.textSecondary} ml-1`}>followers</span>
                                    </div>
                                    <span className={`text-sm transition-transform duration-200 ${isHandleExpanded ? '' : '-rotate-90'} ${t.textSecondary}`}>▼</span>
                                  </div>
                                </div>

                                {/* Handle Expanded — platform details + add platform */}
                                {isHandleExpanded && (
                                  <div className={`${t.bgSurface} border-t ${t.borderSubtle}`}>
                                    {pages.map(page => {
                                      const meta = PLATFORM_META[page.platform] || { label: page.platform, icon: '🔗', color: '#888' };
                                      return (
                                        <div key={`${page.handle}-${page.platform}`}
                                          className={`px-8 py-2.5 flex items-center justify-between border-b ${t.borderSubtle} last:border-b-0`}>
                                          <a
                                            href={getProfileUrl(page.platform, page.handle)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-3 no-underline hover:underline"
                                            title={`Open ${meta.label} profile`}
                                          >
                                            <span className="text-base">{meta.icon}</span>
                                            <span className="text-sm" style={{ color: meta.color }}>{meta.label}</span>
                                          </a>
                                          <div className="flex items-center gap-4">
                                            <span className={`text-sm ${t.textSecondary}`}>{formatFollowers(page.followers)}</span>
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                              page.status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'
                                            }`}>
                                              {page.status === 'active' ? 'Active' : 'Inactive'}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {/* Add missing platforms */}
                                    {missingPlatforms.length > 0 && (
                                      <div className={`${isMobile ? 'px-4' : 'px-8'} py-3 border-t ${t.borderSubtle}`}>
                                        <p className={`text-xs ${t.textMuted} mb-2`}>Add platform:</p>
                                        <div className="flex gap-2 flex-wrap">
                                          {missingPlatforms.map(platform => {
                                            const meta = PLATFORM_META[platform];
                                            const isConnecting = connectingPlatform?.artistId === artist.id && connectingPlatform?.platform === platform;
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
                                                    : { padding: '6px 12px' }
                                                  ),
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
                                )}
                              </div>
                            );
                          })}

                          {/* Add New Page button for configured artists */}
                          <div className={`${isMobile ? 'px-4' : 'px-6'} py-3`} style={{ backgroundColor: theme.bg.page }}>
                            <p className={`text-xs ${t.textMuted} mb-2`}>Connect a new account:</p>
                            <div className="flex gap-2 flex-wrap">
                              {ALL_PLATFORMS.map(platform => {
                                const meta = PLATFORM_META[platform];
                                const isConnecting = connectingPlatform?.artistId === artist.id && connectingPlatform?.platform === platform;
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
                                        : { padding: '6px 12px' }
                                      ),
                                    }}
                                  >
                                    <span>{meta.icon}</span>
                                    {isConnecting ? 'Connecting...' : `+ ${meta.label}`}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Manual accounts section (shown for all artists that have them) */}
                      {hasManualAccounts && (
                        <ManualAccountsSection
                          accounts={manualAccounts}
                          artistId={artist.id}
                          latePages={latePages}
                          isLateConfigured={isLateConfigured}
                          onRemove={onRemoveManualAccount}
                          onConnectPlatform={handleConnectPlatform}
                          connectingPlatform={connectingPlatform}
                          isMobile={isMobile}
                        />
                      )}

                      {/* Configured but no pages yet and no manual accounts */}
                      {!isUnconfigured && !hasPages && !hasManualAccounts && (
                        <div className="px-6 py-8 text-center">
                          <div className="text-3xl mb-3">📱</div>
                          <h3 className={`font-semibold mb-2 ${t.textPrimary}`}>
                            No pages connected yet
                          </h3>
                          <p className={`text-sm ${t.textSecondary} mb-5 max-w-md mx-auto`}>
                            {artist.name}'s Late account is set up. Connect social media accounts to start scheduling.
                          </p>
                          <div className={`flex gap-2 justify-center flex-wrap ${isMobile ? 'flex-col items-stretch px-4' : ''}`}>
                            {ALL_PLATFORMS.map(platform => {
                              const meta = PLATFORM_META[platform];
                              const isConnecting = connectingPlatform?.artistId === artist.id && connectingPlatform?.platform === platform;
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

                      {/* Unconfigured + has manual accounts — show Late CTA + manual accounts */}
                      {isUnconfigured && !hasPages && hasManualAccounts && (
                        <div className={`${isMobile ? 'px-4' : 'px-6'} py-4 text-center`}>
                          <p className={`text-sm ${t.textSecondary} mb-3`}>
                            Connect Late to enable scheduling for {artist.name}'s accounts.
                          </p>
                          <button
                            onClick={(e) => { e.stopPropagation(); onConfigureLate(artist.id); }}
                            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${t.btnPrimary}`}
                            style={isMobile ? { minHeight: 44, width: '100%' } : {}}
                          >
                            Connect Late API Key
                          </button>
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
          isLateConfigured={!unconfiguredIds.has(bulkEntryArtist.id) || configuredIds.has(bulkEntryArtist.id)}
          onSave={handleBulkSave}
          onClose={() => setBulkEntryArtistId(null)}
          isMobile={isMobile}
        />
      )}
    </div>
  );
};

export default PagesTab;
