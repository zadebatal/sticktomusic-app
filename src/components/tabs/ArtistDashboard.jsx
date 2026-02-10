import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../ui';
import { getTierForSets, computeSocialSetsUsed, shouldShowPaymentUI } from '../../services/subscriptionService';

/**
 * ArtistDashboard — Home tab for artist and collaborator roles.
 * Shows welcome, stats, Social Sets usage, upcoming posts, and operator contact.
 */
const ArtistDashboard = ({
  user,
  artistId,
  scheduledPosts = [],
  latePages = [],
  socialSetsAllowed = 0,
}) => {
  const { theme } = useTheme();
  const { toastInfo } = useToast();
  const t = theme.tw;

  // latePages is pre-filtered to this artist's pages by parent
  const socialSetsUsed = computeSocialSetsUsed(latePages);
  const tierInfo = getTierForSets(socialSetsAllowed);
  const showPayment = shouldShowPaymentUI(user);

  // Upcoming posts (next 10, sorted by date)
  const upcomingPosts = scheduledPosts
    .filter(p => p.status === 'SCHEDULED' || p.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduledFor || a.scheduledDate) - new Date(b.scheduledFor || b.scheduledDate))
    .slice(0, 10);

  // Connected platforms for this artist (already filtered)
  const artistPages = latePages;

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
            <p className={`text-sm ${t.textMuted} mb-1`}>Platforms</p>
            <p className={`text-2xl font-bold ${t.textPrimary}`}>{artistPages.length}</p>
            <p className={`text-xs ${t.textMuted} mt-1`}>connected accounts</p>
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
          {/* Your Social Sets */}
          <div className={`p-5 rounded-xl border ${t.cardBorder} ${t.cardBg}`}>
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-4`}>Connected Accounts</h2>
            {artistPages.length > 0 ? (
              <div className="space-y-3">
                {artistPages.map(page => (
                  <div key={page.id} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold`}
                      style={{ backgroundColor: theme.bg.elevated, color: theme.text.secondary }}>
                      {page.platform?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${t.textPrimary} truncate`}>{page.handle}</p>
                      <p className={`text-xs ${t.textMuted} capitalize`}>{page.platform}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      page.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400'
                    }`}>
                      {page.status}
                    </span>
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
                  const dateStr = post.scheduledFor || post.scheduledDate;
                  const date = dateStr ? new Date(dateStr) : null;
                  return (
                    <div key={post.id || i} className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono`}
                        style={{ backgroundColor: theme.bg.elevated, color: theme.text.secondary }}>
                        {date ? `${date.getMonth() + 1}/${date.getDate()}` : '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${t.textPrimary} truncate`}>
                          {post.caption || post.content || 'Untitled post'}
                        </p>
                        <p className={`text-xs ${t.textMuted}`}>
                          {date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          {post.platforms?.map(p => p.platform || p).join(', ')}
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
