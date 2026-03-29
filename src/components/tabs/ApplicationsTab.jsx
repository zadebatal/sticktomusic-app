import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { EmptyState as SharedEmptyState } from '../ui';

export default function ApplicationsTab({
  applications,
  applicationFilter,
  setApplicationFilter,
  onApprove,
  onDeny,
  onMarkPaymentComplete,
  onShareIntakeLink,
  showToast,
}) {
  const { theme } = useTheme();
  const t = theme.tw;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className={`text-sm ${t.textSecondary}`}>
            {applications.filter((a) => a.status === 'pending').length} pending review
          </p>
        </div>
        <div className="flex gap-2">
          {['all', 'pending', 'approved', 'declined'].map((filter) => (
            <button
              key={filter}
              onClick={() => setApplicationFilter && setApplicationFilter(filter)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                (!applicationFilter || applicationFilter === 'all') && filter === 'all'
                  ? 'bg-white text-black'
                  : applicationFilter === filter
                    ? 'bg-white text-black'
                    : `${t.textSecondary} ${t.hoverText} ${t.hoverBg}`
              }`}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {applications.length === 0 ? (
        <SharedEmptyState
          icon="📋"
          title="No applications yet"
          description="Applications will appear here when artists submit the intake form."
          actionLabel="Share Intake Form"
          onAction={() => {
            navigator.clipboard.writeText(window.location.origin + '?page=intake');
            showToast('Intake form link copied!', 'success');
          }}
        />
      ) : (
        (() => {
          const filteredApps = applications.filter(
            (app) =>
              !applicationFilter || applicationFilter === 'all' || app.status === applicationFilter,
          );
          return filteredApps.length === 0 ? (
            <SharedEmptyState
              icon="🔍"
              title={`No ${applicationFilter} applications`}
              description="Try changing your filter to see more applications."
              actionLabel="Show All"
              onAction={() => setApplicationFilter('all')}
            />
          ) : (
            <div className="space-y-4">
              {filteredApps.map((app) => (
                <div
                  key={app.id}
                  className={`${t.bgSurface} border rounded-xl overflow-hidden ${
                    app.status === 'approved'
                      ? 'border-green-500/30'
                      : app.status === 'declined'
                        ? 'border-red-500/30'
                        : t.border
                  }`}
                >
                  <div className="p-6">
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold">{app.name}</h3>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              app.status === 'approved'
                                ? 'bg-green-500/20 text-green-400'
                                : app.status === 'declined' || app.status === 'denied'
                                  ? 'bg-red-500/20 text-red-400'
                                  : app.status === 'pending_payment'
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : 'bg-yellow-500/20 text-yellow-400'
                            }`}
                          >
                            {app.status === 'pending_payment'
                              ? 'Awaiting Payment'
                              : app.status === 'pending_review'
                                ? 'Pending Review'
                                : app.status}
                          </span>
                        </div>
                        <p className={`${t.textSecondary} text-sm mb-3`}>{app.email}</p>
                        <div className="flex flex-wrap gap-2 mb-3">
                          <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs">
                            {app.tier}
                          </span>
                          {app.genre && (
                            <span
                              className={`px-2 py-1 ${t.bgElevated} ${t.textSecondary} rounded text-xs`}
                            >
                              {app.genre}
                            </span>
                          )}
                          {app.vibes &&
                            app.vibes.slice(0, 3).map((vibe, i) => (
                              <span
                                key={i}
                                className={`px-2 py-1 ${t.bgElevated} ${t.textMuted} rounded text-xs`}
                              >
                                {vibe}
                              </span>
                            ))}
                        </div>
                        <div className={`text-xs ${t.textMuted}`}>
                          Submitted {app.submitted}
                          {app.spotify && <span className="ml-3">• Has Spotify</span>}
                          {app.adjacentArtists && (
                            <span className="ml-3">• Provided adjacent artists</span>
                          )}
                        </div>
                      </div>
                      {(app.status === 'pending' || app.status === 'pending_review') && (
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => onApprove(app)}
                            className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30 transition"
                          >
                            ✓ Approve
                          </button>
                          <button
                            onClick={() => onDeny(app)}
                            className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition"
                          >
                            ✕ Deny
                          </button>
                        </div>
                      )}
                      {app.status === 'pending_payment' && (
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => onMarkPaymentComplete(app)}
                            className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 transition"
                          >
                            💳 Mark as Paid
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(app.paymentLink || '');
                              showToast('Payment link copied!', 'success');
                            }}
                            className={`px-4 py-2 ${t.bgElevated} ${t.textSecondary} rounded-lg text-sm font-medium ${t.hoverBg} transition`}
                          >
                            📋 Copy Link
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Expandable details */}
                    {app.projectDescription && (
                      <details className={`mt-4 pt-4 border-t ${t.border}`}>
                        <summary
                          className={`text-sm ${t.textSecondary} cursor-pointer ${t.hoverText}`}
                        >
                          View full application details
                        </summary>
                        <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
                          {app.projectType && (
                            <div>
                              <span className={t.textSecondary}>Project Type:</span>
                              <span className={`ml-2 ${t.textPrimary}`}>{app.projectType}</span>
                            </div>
                          )}
                          {app.cdTier && (
                            <div>
                              <span className={t.textSecondary}>Creative Direction:</span>
                              <span className={`ml-2 ${t.textPrimary}`}>{app.cdTier}</span>
                            </div>
                          )}
                          {app.duration && (
                            <div>
                              <span className={t.textSecondary}>Duration:</span>
                              <span className={`ml-2 ${t.textPrimary}`}>{app.duration}</span>
                            </div>
                          )}
                          {app.aestheticWords && (
                            <div className="md:col-span-2">
                              <span className={t.textSecondary}>Aesthetic:</span>
                              <span className={`ml-2 ${t.textPrimary}`}>{app.aestheticWords}</span>
                            </div>
                          )}
                          {app.adjacentArtists && (
                            <div className="md:col-span-2">
                              <span className={t.textSecondary}>Adjacent Artists:</span>
                              <span className={`ml-2 ${t.textPrimary}`}>{app.adjacentArtists}</span>
                            </div>
                          )}
                          {app.idealListener && (
                            <div className="md:col-span-2">
                              <span className={t.textSecondary}>Ideal Listener:</span>
                              <span className={`ml-2 ${t.textPrimary}`}>{app.idealListener}</span>
                            </div>
                          )}
                          {app.projectDescription && (
                            <div className="md:col-span-2">
                              <span className={t.textSecondary}>Project Description:</span>
                              <p className={`mt-1 ${t.textPrimary}`}>{app.projectDescription}</p>
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}
