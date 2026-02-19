import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useTheme, THEMES } from '../../contexts/ThemeContext';
import { useToast } from '../ui';
import { Button } from '../../ui/components/Button';
import { getTierForSets, shouldShowPaymentUI, computeSocialSetsUsed } from '../../services/subscriptionService';

/**
 * ArtistSettingsTab — Trimmed settings for artist/collaborator roles.
 * Profile, theme, subscription info, collaborator management, logout.
 */
const ArtistSettingsTab = ({
  user,
  onLogout,
  db,
  artistId,
  latePages = [],
  socialSetsAllowed = 0,
}) => {
  const { theme, themeId, setTheme } = useTheme();
  const { toastInfo } = useToast();
  const t = theme.tw;

  const socialSetsUsed = computeSocialSetsUsed(latePages.filter(p => p.artistId === artistId));
  const tierInfo = getTierForSets(socialSetsAllowed);
  const showPayment = shouldShowPaymentUI(user);
  const isCollaborator = user?.role === 'collaborator';

  // Cancel subscription state
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelMessage, setCancelMessage] = useState('');
  const canCancel = showPayment && user?.subscriptionId && user?.subscriptionStatus === 'active';

  const handleCancelSubscription = async () => {
    if (!window.confirm('Are you sure you want to cancel? Access continues until the end of the billing period.')) return;
    setCancelLoading(true);
    setCancelMessage('');
    try {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      setCancelMessage(data.success ? (data.message || 'Subscription cancelled.') : (data.error || 'Failed to cancel.'));
    } catch (err) {
      setCancelMessage('Failed to cancel subscription.');
    }
    setCancelLoading(false);
  };

  // Collaborator management state
  const [collaborators, setCollaborators] = useState([]);
  const [collabEmail, setCollabEmail] = useState('');
  const [collabStatus, setCollabStatus] = useState(null);
  const [collabMessage, setCollabMessage] = useState('');

  // Load collaborators for this artist
  useEffect(() => {
    if (!db || !artistId || isCollaborator) return;
    const loadCollaborators = async () => {
      try {
        const q = query(
          collection(db, 'allowedUsers'),
          where('linkedArtistId', '==', artistId),
          where('role', '==', 'collaborator')
        );
        const snapshot = await getDocs(q);
        setCollaborators(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error loading collaborators:', err);
      }
    };
    loadCollaborators();
  }, [db, artistId, isCollaborator]);

  const handleInviteCollaborator = async (e) => {
    e.preventDefault();
    const email = collabEmail.trim().toLowerCase();
    if (!email || !db || !artistId) return;

    setCollabStatus('sending');
    setCollabMessage('');

    try {
      const userRef = doc(db, 'allowedUsers', email);
      const existing = await getDocs(query(collection(db, 'allowedUsers'), where('email', '==', email)));
      if (!existing.empty) {
        setCollabStatus('error');
        setCollabMessage('This email is already registered.');
        return;
      }

      await setDoc(userRef, {
        email,
        name: email.split('@')[0],
        role: 'collaborator',
        linkedArtistId: artistId,
        status: 'active',
        createdAt: new Date().toISOString(),
        invitedBy: user?.email || 'unknown',
      });

      setCollaborators(prev => [...prev, { id: email, email, name: email.split('@')[0], role: 'collaborator' }]);
      setCollabEmail('');
      setCollabStatus('success');
      setCollabMessage(`Invited ${email} as collaborator.`);
      setTimeout(() => { setCollabStatus(null); setCollabMessage(''); }, 4000);
    } catch (err) {
      console.error('Error inviting collaborator:', err);
      setCollabStatus('error');
      setCollabMessage('Failed to invite. Please try again.');
    }
  };

  const handleRemoveCollaborator = async (email) => {
    if (!db || !email) return;
    try {
      await deleteDoc(doc(db, 'allowedUsers', email));
      setCollaborators(prev => prev.filter(c => c.id !== email));
    } catch (err) {
      console.error('Error removing collaborator:', err);
    }
  };

  const themeOptions = [
    { id: 'dark', name: 'Dark', desc: 'Deep purple accents on dark zinc', preview: ['#09090b', '#18181b', '#6366f1'] },
    { id: 'bright', name: 'Bright', desc: 'Clean light theme with indigo accents', preview: ['#ffffff', '#f4f4f5', '#4f46e5'] },
  ];

  return (
    <div className={`flex-1 overflow-auto p-6 ${t.bgPage}`}>
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className={`text-2xl font-bold ${t.textPrimary}`}>Settings</h1>

        {/* PROFILE */}
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
              <p className={`text-xs ${t.textMuted} mt-0.5 capitalize`}>{user?.role || ''}</p>
            </div>
          </div>
        </section>

        {/* SUBSCRIPTION (not for collaborators) */}
        {!isCollaborator && (
          <section className={`p-6 rounded-2xl border ${t.cardBorder} ${t.cardBg}`}>
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-4`}>Subscription</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className={`text-sm ${t.textSecondary}`}>Plan</span>
                <span className={`text-sm font-semibold ${t.textPrimary}`}>{tierInfo.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className={`text-sm ${t.textSecondary}`}>Social Sets</span>
                <span className={`text-sm font-semibold ${t.textPrimary}`}>{socialSetsUsed} / {socialSetsAllowed || '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className={`text-sm ${t.textSecondary}`}>Price</span>
                <span className={`text-sm font-semibold ${t.textPrimary}`}>{tierInfo.price}</span>
              </div>
              {/* Usage bar */}
              {socialSetsAllowed > 0 && (
                <div className="h-2 rounded-full overflow-hidden mt-2" style={{ backgroundColor: theme.bg.elevated }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((socialSetsUsed / socialSetsAllowed) * 100, 100)}%`,
                      backgroundColor: theme.accent.primary,
                    }}
                  />
                </div>
              )}
              {showPayment && (
                <div className="flex gap-2 mt-3">
                  <Button variant="brand-primary" onClick={() => toastInfo('Contact your operator to upgrade your plan')}>Upgrade Plan</Button>
                  {canCancel && (
                    <Button variant="destructive-secondary" onClick={handleCancelSubscription} disabled={cancelLoading} loading={cancelLoading}>
                      {cancelLoading ? 'Cancelling...' : 'Cancel'}
                    </Button>
                  )}
                </div>
              )}
              {cancelMessage && (
                <p className={`text-sm mt-2 ${cancelMessage.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                  {cancelMessage}
                </p>
              )}
            </div>
          </section>
        )}

        {/* COLLABORATORS (only for artists and operators, not collaborators themselves) */}
        {!isCollaborator && (
          <section className={`p-6 rounded-2xl border ${t.cardBorder} ${t.cardBg}`}>
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${t.textMuted} mb-4`}>Collaborators</h2>
            <p className={`text-sm ${t.textSecondary} mb-4`}>
              Invite people to view your dashboard and schedule (read-only).
            </p>
            <form onSubmit={handleInviteCollaborator} className="flex gap-2 mb-4">
              <input
                type="email"
                placeholder="Collaborator email"
                value={collabEmail}
                onChange={(e) => setCollabEmail(e.target.value)}
                className={`flex-1 px-4 py-2.5 rounded-xl border ${t.inputBorder} ${t.inputFocus} outline-none text-sm transition`}
                style={{ backgroundColor: theme.bg.input, color: theme.text.primary }}
              />
              <Button type="submit" variant="brand-primary" disabled={collabStatus === 'sending'} loading={collabStatus === 'sending'}>
                {collabStatus === 'sending' ? 'Inviting...' : 'Invite'}
              </Button>
            </form>
            {collabMessage && (
              <div className={`text-sm mb-3 ${collabStatus === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                {collabMessage}
              </div>
            )}
            {collaborators.length > 0 ? (
              <div className="space-y-2">
                {collaborators.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className={`text-sm ${t.textPrimary}`}>{c.name || c.email}</p>
                      <p className={`text-xs ${t.textMuted}`}>{c.email}</p>
                    </div>
                    <Button variant="destructive-secondary" size="small" onClick={() => handleRemoveCollaborator(c.id)}>Remove</Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`text-sm ${t.textMuted} italic`}>No collaborators yet.</p>
            )}
          </section>
        )}

        {/* THEME */}
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

        {/* LOGOUT */}
        <section className={`p-6 rounded-2xl border border-red-500/20 ${t.cardBg}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-red-400 mb-3">Danger Zone</h2>
          <Button variant="destructive-primary" onClick={onLogout}>Log Out</Button>
        </section>
      </div>
    </div>
  );
};

export default ArtistSettingsTab;
