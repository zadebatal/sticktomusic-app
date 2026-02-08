import React, { useState } from 'react';
import { useTheme, THEMES } from '../../contexts/ThemeContext';

/**
 * SettingsTab — Profile, team management, theme picker, logout.
 */

const SettingsTab = ({ user, onLogout, db, artistId }) => {
  const { theme, themeId, setTheme } = useTheme();
  const t = theme.tw;
  const [inviteEmail, setInviteEmail] = useState('');

  const handleInvite = (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    // TODO: Write to Firestore allowedUsers collection
    console.log('[Settings] Invite operator:', inviteEmail, 'for artist:', artistId);
    setInviteEmail('');
  };

  const themeOptions = [
    { id: 'dark', name: 'Dark', desc: 'Deep purple accents on dark zinc', preview: ['#09090b', '#18181b', '#6366f1'] },
    { id: 'bright', name: 'Bright', desc: 'Clean light theme with indigo accents', preview: ['#ffffff', '#f4f4f5', '#4f46e5'] },
  ];

  return (
    <div className={`flex-1 overflow-auto p-6 ${t.bgPage}`}>
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className={`text-2xl font-bold ${t.textPrimary}`}>Settings</h1>

        {/* ═══ PROFILE ═══ */}
        <section className={`p-6 rounded-2xl border ${t.cardBorder} ${t.cardBg}`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-4`}>Profile</h2>
          <div className="flex items-center gap-4">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <div className={`w-14 h-14 rounded-full ${t.bgElevated} flex items-center justify-center text-xl font-semibold ${t.textSecondary}`}>
                {(user?.name || user?.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className={`font-semibold ${t.textPrimary}`}>{user?.name || 'User'}</p>
              <p className={`text-sm ${t.textSecondary}`}>{user?.email || ''}</p>
              {user?.role && <p className={`text-xs ${t.textMuted} mt-0.5 capitalize`}>{user.role}</p>}
            </div>
          </div>
        </section>

        {/* ═══ TEAM ═══ */}
        <section className={`p-6 rounded-2xl border ${t.cardBorder} ${t.cardBg}`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-4`}>Team</h2>
          <p className={`text-sm ${t.textSecondary} mb-4`}>
            Invite operators who can access your studio, scheduler, and analytics.
          </p>
          <form onSubmit={handleInvite} className="flex gap-2 mb-4">
            <input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className={`flex-1 px-4 py-2.5 rounded-xl border ${t.inputBorder} ${t.inputFocus} outline-none text-sm transition`}
              style={{ backgroundColor: theme.bg.input, color: theme.text.primary }}
            />
            <button type="submit" className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition ${t.btnPrimary} shrink-0`}>
              Invite
            </button>
          </form>
          <div className={`text-sm ${t.textMuted} italic`}>
            No team members yet. Invite someone to get started.
          </div>
        </section>

        {/* ═══ THEME ═══ */}
        <section className={`p-6 rounded-2xl border ${t.cardBorder} ${t.cardBg}`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-4`}>Theme</h2>
          <div className="grid grid-cols-2 gap-3">
            {themeOptions.map(opt => (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id)}
                className={`p-4 rounded-xl border text-left transition ${
                  themeId === opt.id
                    ? 'border-indigo-500 ring-1 ring-indigo-500/50'
                    : `${t.cardBorder} ${t.hoverBg}`
                }`}
                style={{ backgroundColor: themeId === opt.id ? theme.accent.muted : theme.bg.elevated }}
              >
                {/* Color preview */}
                <div className="flex gap-1 mb-3">
                  {opt.preview.map((color, i) => (
                    <div key={i} className="w-5 h-5 rounded-full border border-white/10" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <p className={`text-sm font-semibold ${t.textPrimary}`}>{opt.name}</p>
                <p className={`text-xs ${t.textMuted} mt-0.5`}>{opt.desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* ═══ LOGOUT ═══ */}
        <section className={`p-6 rounded-2xl border border-red-500/20 ${t.cardBg}`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wider text-red-400 mb-3`}>Danger Zone</h2>
          <button onClick={onLogout} className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition ${t.btnDanger}`}>
            Log Out
          </button>
        </section>
      </div>
    </div>
  );
};

export default SettingsTab;
