import React, { useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * PagesTab — Connected social media accounts table.
 * Shows all Late-managed accounts with platform, handle, followers, and status.
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

  return (
    <div className={`flex-1 overflow-auto p-6 ${t.bgPage}`}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className={`text-2xl font-bold ${t.textPrimary}`}>Connected Pages</h1>
            <p className={`text-sm ${t.textSecondary} mt-1`}>
              {accounts.length} account{accounts.length !== 1 ? 's' : ''} connected across {new Set(accounts.map(a => a.platform)).size} platform{new Set(accounts.map(a => a.platform)).size !== 1 ? 's' : ''}
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

        {/* Accounts Table */}
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
          <div className={`rounded-2xl border ${t.cardBorder} overflow-hidden`}>
            {/* Table header */}
            <div className={`grid grid-cols-[1fr_140px_120px_100px] gap-4 px-6 py-3 text-xs font-semibold uppercase tracking-wider ${t.textMuted} ${t.bgSurface} border-b ${t.borderSubtle}`}>
              <span>Account</span>
              <span>Platform</span>
              <span>Followers</span>
              <span className="text-right">Status</span>
            </div>

            {/* Rows */}
            {accounts.map((acc) => {
              const meta = PLATFORM_META[acc.platform] || { label: acc.platform, icon: '🔗', color: '#888' };
              return (
                <div
                  key={`${acc.handle}-${acc.platform}`}
                  className={`grid grid-cols-[1fr_140px_120px_100px] gap-4 px-6 py-4 items-center border-b ${t.borderSubtle} ${t.hoverBg} transition`}
                  style={{ backgroundColor: theme.bg.page }}
                >
                  {/* Account */}
                  <div className="flex items-center gap-3 min-w-0">
                    {acc.profilePic ? (
                      <img src={acc.profilePic} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color + '22', color: meta.color }}>
                        <span className="text-sm">{meta.icon}</span>
                      </div>
                    )}
                    <span className={`font-medium text-sm truncate ${t.textPrimary}`}>@{acc.handle}</span>
                  </div>

                  {/* Platform */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{meta.icon}</span>
                    <span className={`text-sm ${t.textSecondary}`}>{meta.label}</span>
                  </div>

                  {/* Followers */}
                  <span className={`text-sm ${t.textSecondary}`}>
                    {acc.followers != null
                      ? acc.followers >= 1000
                        ? `${(acc.followers / 1000).toFixed(1)}K`
                        : acc.followers.toLocaleString()
                      : '—'
                    }
                  </span>

                  {/* Status */}
                  <div className="text-right">
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
    </div>
  );
};

export default PagesTab;
