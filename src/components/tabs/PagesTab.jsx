import React, { useMemo, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * PagesTab — Connected social media accounts grouped by handle.
 * Shows all Late-managed accounts grouped by handle with expandable details.
 */

const PLATFORM_META = {
  tiktok: { label: 'TikTok', icon: '🎵', color: '#ff2d55' },
  instagram: { label: 'Instagram', icon: '📸', color: '#c13584' },
  youtube: { label: 'YouTube', icon: '▶️', color: '#ff0000' },
  facebook: { label: 'Facebook', icon: '📘', color: '#1877f2' },
};

const PagesTab = ({ latePages = [], lateAccountIds = {}, loadingLatePages, onLoadLatePages, onConfigureLate }) => {
  const { theme } = useTheme();
  const t = theme.tw;
  const [expandedHandles, setExpandedHandles] = useState({});

  // Build flat list of accounts from lateAccountIds mapping
  const accounts = useMemo(() => {
    const list = [];
    Object.entries(lateAccountIds).forEach(([handle, platforms]) => {
      Object.entries(platforms).forEach(([platform, accountId]) => {
        if (!accountId) return;
        // Try to find matching latePage for follower data
        const latePage = latePages.find(p =>
          p.id === accountId || p.accountId === accountId
        );
        list.push({
          id: accountId,
          handle,
          platform,
          followers: latePage?.followers || latePage?.followerCount || null,
          status: latePage ? 'connected' : 'linked',
          profilePic: latePage?.profilePicUrl || null,
        });
      });
    });
    return list;
  }, [lateAccountIds, latePages]);

  // Group accounts by handle
  const groupedByHandle = useMemo(() => {
    const groups = {};
    accounts.forEach(acc => {
      if (!groups[acc.handle]) {
        groups[acc.handle] = [];
      }
      groups[acc.handle].push(acc);
    });
    return groups;
  }, [accounts]);

  // Calculate aggregate stats per handle
  const handleStats = useMemo(() => {
    const stats = {};
    Object.entries(groupedByHandle).forEach(([handle, accs]) => {
      const totalFollowers = accs.reduce((sum, acc) => {
        return sum + (acc.followers || 0);
      }, 0);
      const allConnected = accs.every(acc => acc.status === 'connected');
      const profilePic = accs.find(acc => acc.profilePic)?.profilePic || null;

      stats[handle] = {
        totalFollowers,
        status: allConnected ? 'connected' : 'partial',
        profilePic,
        platforms: accs.map(acc => acc.platform),
      };
    });
    return stats;
  }, [groupedByHandle]);

  const toggleExpanded = (handle) => {
    setExpandedHandles(prev => ({
      ...prev,
      [handle]: !prev[handle],
    }));
  };

  const formatFollowers = (count) => {
    if (count == null) return '—';
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toLocaleString();
  };

  return (
    <div className={`flex-1 overflow-auto p-6 ${t.bgPage}`}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className={`text-2xl font-bold ${t.textPrimary}`}>Connected Pages</h1>
            <p className={`text-sm ${t.textSecondary} mt-1`}>
              {Object.keys(groupedByHandle).length} handle{Object.keys(groupedByHandle).length !== 1 ? 's' : ''} with {accounts.length} account{accounts.length !== 1 ? 's' : ''} connected
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onLoadLatePages}
              disabled={loadingLatePages}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${t.btnSecondary} disabled:opacity-50`}
            >
              {loadingLatePages ? 'Syncing...' : '↻ Sync'}
            </button>
            <button
              onClick={onConfigureLate}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${t.btnPrimary}`}
            >
              + Connect Account
            </button>
          </div>
        </div>

        {/* Grouped Accounts */}
        {accounts.length === 0 ? (
          <div className={`text-center py-20 rounded-2xl border ${t.cardBorder} ${t.cardBg}`}>
            <div className="text-4xl mb-4">📱</div>
            <h3 className={`text-lg font-semibold mb-2 ${t.textPrimary}`}>No accounts connected</h3>
            <p className={`text-sm ${t.textSecondary} mb-6 max-w-sm mx-auto`}>
              Connect your TikTok, Instagram, YouTube, or Facebook accounts to start scheduling content.
            </p>
            <button onClick={onConfigureLate} className={`px-6 py-3 rounded-xl text-sm font-semibold transition ${t.btnPrimary}`}>
              Connect Your First Account
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedByHandle).map(([handle, accs]) => {
              const isExpanded = expandedHandles[handle] || false;
              const stats = handleStats[handle];
              const profilePic = stats.profilePic;
              const primaryMeta = PLATFORM_META[accs[0]?.platform] || { label: 'Unknown', icon: '🔗', color: '#888' };

              return (
                <div key={handle}>
                  {/* Handle Card (Collapsible Header) */}
                  <div
                    onClick={() => toggleExpanded(handle)}
                    className={`cursor-pointer rounded-lg border ${t.cardBorder} overflow-hidden transition hover:${t.hoverBg}`}
                    style={{ backgroundColor: theme.bg.page }}
                  >
                    <div className="px-6 py-4 flex items-center justify-between gap-4">
                      {/* Left: Avatar, Handle, Platforms */}
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        {/* Profile Picture / Avatar */}
                        {profilePic ? (
                          <img src={profilePic} alt={handle} className="w-12 h-12 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: primaryMeta.color + '22', color: primaryMeta.color }}>
                            <span className="text-lg">{primaryMeta.icon}</span>
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          {/* Handle name */}
                          <h3 className={`font-bold text-base ${t.textPrimary}`}>@{handle}</h3>

                          {/* Platform badges */}
                          <div className="flex gap-1.5 mt-1.5 flex-wrap">
                            {accs.map((acc) => {
                              const meta = PLATFORM_META[acc.platform] || { label: acc.platform, icon: '🔗', color: '#888' };
                              return (
                                <span
                                  key={acc.platform}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-white"
                                  style={{ backgroundColor: meta.color }}
                                  title={meta.label}
                                >
                                  <span>{meta.icon}</span>
                                  <span>{meta.label}</span>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Right: Followers, Status, Actions */}
                      <div className="flex items-center gap-6 shrink-0">
                        {/* Total followers */}
                        <div className="text-right">
                          <div className={`text-lg font-semibold ${t.textPrimary}`}>
                            {formatFollowers(stats.totalFollowers)}
                          </div>
                          <div className={`text-xs ${t.textSecondary}`}>followers</div>
                        </div>

                        {/* Status */}
                        <span className={`inline-block px-3 py-1.5 rounded-full text-xs font-semibold ${
                          stats.status === 'connected'
                            ? 'bg-green-500/15 text-green-400'
                            : 'bg-yellow-500/15 text-yellow-400'
                        }`}>
                          {stats.status === 'connected' ? 'All Connected' : 'Partial'}
                        </span>

                        {/* Expand/Collapse Toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(handle);
                          }}
                          className={`p-2 rounded-lg transition ${t.hoverBg}`}
                          title={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          <span className={`text-xl transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            ▼
                          </span>
                        </button>

                        {/* Add Platform Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onConfigureLate(handle);
                          }}
                          className={`p-2 rounded-lg font-bold text-lg transition ${t.hoverBg}`}
                          title="Add another platform to this handle"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className={`mt-2 rounded-lg border ${t.cardBorder} overflow-hidden`}>
                      <div className={`px-6 py-1 text-xs font-semibold uppercase tracking-wider ${t.textMuted} ${t.bgSurface} border-b ${t.borderSubtle}`}>
                        Platform Details
                      </div>
                      {accs.map((acc) => {
                        const meta = PLATFORM_META[acc.platform] || { label: acc.platform, icon: '🔗', color: '#888' };
                        return (
                          <div
                            key={`${acc.handle}-${acc.platform}`}
                            className={`px-6 py-3 border-b ${t.borderSubtle} flex items-center justify-between last:border-b-0`}
                            style={{ backgroundColor: theme.bg.page }}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-lg">{meta.icon}</span>
                              <span className={`text-sm ${t.textSecondary}`}>{meta.label}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className={`text-sm ${t.textSecondary}`}>
                                {formatFollowers(acc.followers)}
                              </span>
                              <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                                acc.status === 'connected'
                                  ? 'bg-green-500/15 text-green-400'
                                  : 'bg-yellow-500/15 text-yellow-400'
                              }`}>
                                {acc.status === 'connected' ? 'Connected' : 'Linked'}
                              </span>
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
        )}
      </div>
    </div>
  );
};

export default PagesTab;
