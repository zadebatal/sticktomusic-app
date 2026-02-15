import React, { useState } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useTheme } from '../../contexts/ThemeContext';
import { shouldShowPaymentUI } from '../../services/subscriptionService';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { TextField } from '../../ui/components/TextField';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { FeatherMoon, FeatherSun, FeatherLogOut, FeatherAlertTriangle } from '@subframe/core';

/**
 * SettingsTab — Profile, team management, theme picker, logout.
 */

const SettingsTab = ({ user, onLogout, db, artistId }) => {
  const { themeId, setTheme } = useTheme();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState(null); // 'sending' | 'success' | 'error'
  const [inviteMessage, setInviteMessage] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelMessage, setCancelMessage] = useState('');

  const canCancel = shouldShowPaymentUI(user) && user?.subscriptionId && user?.subscriptionStatus === 'active';

  const handleCancelSubscription = async () => {
    if (!window.confirm('Are you sure you want to cancel your subscription? Your access will continue until the end of the billing period.')) return;
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
      if (data.success) {
        setCancelMessage(data.message || 'Subscription cancelled.');
      } else {
        setCancelMessage(data.error || 'Failed to cancel.');
      }
    } catch (err) {
      setCancelMessage('Failed to cancel subscription.');
    }
    setCancelLoading(false);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !db) return;

    setInviteStatus('sending');
    setInviteMessage('');

    try {
      // Check if user already exists
      const userRef = doc(db, 'allowedUsers', email);
      const existing = await getDoc(userRef);
      if (existing.exists()) {
        setInviteStatus('error');
        setInviteMessage('This email is already an allowed user.');
        return;
      }

      // Create operator record in allowedUsers
      await setDoc(userRef, {
        email,
        name: email.split('@')[0],
        role: 'operator',
        status: 'active',
        createdAt: new Date().toISOString(),
        invitedBy: user?.email || 'unknown'
      });

      setInviteEmail('');
      setInviteStatus('success');
      setInviteMessage(`Invited ${email} as operator.`);
      setTimeout(() => { setInviteStatus(null); setInviteMessage(''); }, 4000);
    } catch (err) {
      console.error('[Settings] Invite failed:', err);
      setInviteStatus('error');
      setInviteMessage('Failed to send invite. Please try again.');
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-black px-12 py-8">
      <div className="flex max-w-2xl flex-col items-start gap-8">
        <span className="text-heading-1 font-heading-1 text-[#ffffffff]">Settings</span>

        {/* ═══ PROFILE ═══ */}
        <div className="flex w-full flex-col items-start gap-4 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-6">
          <span className="text-caption-bold font-caption-bold uppercase tracking-widest text-neutral-400">Profile</span>
          <div className="flex items-center gap-4">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-xl font-semibold text-white">
                {(user?.name || user?.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div className="flex flex-col items-start gap-1">
              <span className="text-body-bold font-body-bold text-[#ffffffff]">{user?.name || 'User'}</span>
              <span className="text-caption font-caption text-neutral-400">{user?.email || ''}</span>
              {user?.role && <Badge variant="neutral" className="capitalize">{user.role}</Badge>}
            </div>
          </div>
        </div>

        {/* ═══ TEAM ═══ */}
        <div className="flex w-full flex-col items-start gap-4 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-6">
          <span className="text-caption-bold font-caption-bold uppercase tracking-widest text-neutral-400">Team</span>
          <span className="text-body font-body text-neutral-400">
            Invite operators who can access your studio, scheduler, and analytics.
          </span>
          <div className="flex w-full items-center gap-2">
            <TextField className="grow shrink-0 basis-0" variant="filled" label="" helpText="">
              <TextField.Input
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </TextField>
            <Button
              variant="brand-primary"
              size="medium"
              disabled={inviteStatus === 'sending'}
              onClick={handleInvite}
            >
              {inviteStatus === 'sending' ? 'Inviting...' : 'Invite'}
            </Button>
          </div>
          {inviteMessage && (
            <span className={`text-caption font-caption ${inviteStatus === 'success' ? 'text-success-600' : 'text-error-600'}`}>
              {inviteMessage}
            </span>
          )}
          {!inviteMessage && (
            <span className="text-caption font-caption italic text-neutral-500">
              Invite someone to get started.
            </span>
          )}
        </div>

        {/* ═══ APPEARANCE ═══ */}
        <div className="flex w-full flex-col items-start gap-4 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-6">
          <span className="text-caption-bold font-caption-bold uppercase tracking-widest text-neutral-400">Appearance</span>
          <div className="flex w-full items-center justify-between">
            <span className="text-body font-body text-neutral-400">Theme</span>
            <ToggleGroup value={themeId} onValueChange={(v) => v && setTheme(v)}>
              <ToggleGroup.Item icon={<FeatherMoon />} value="dark">Dark</ToggleGroup.Item>
              <ToggleGroup.Item icon={<FeatherSun />} value="bright">Bright</ToggleGroup.Item>
            </ToggleGroup>
          </div>
        </div>

        {/* ═══ SUBSCRIPTION (cancel) ═══ */}
        {canCancel && (
          <div className="flex w-full flex-col items-start gap-4 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] p-6">
            <span className="text-caption-bold font-caption-bold uppercase tracking-widest text-neutral-400">Subscription</span>
            <span className="text-body font-body text-neutral-400">
              Your subscription is active. Cancelling will take effect at the end of your current billing period.
            </span>
            {cancelMessage && (
              <span className={`text-caption font-caption ${cancelMessage.includes('Failed') ? 'text-error-600' : 'text-success-600'}`}>
                {cancelMessage}
              </span>
            )}
            <Button
              variant="destructive-secondary"
              size="medium"
              disabled={cancelLoading}
              onClick={handleCancelSubscription}
            >
              {cancelLoading ? 'Cancelling...' : 'Cancel Subscription'}
            </Button>
          </div>
        )}

        {/* ═══ LOGOUT ═══ */}
        <div className="flex w-full flex-col items-start gap-4 rounded-lg border border-solid border-error-600 bg-[#1a1a1aff] p-6">
          <div className="flex items-center gap-2">
            <FeatherAlertTriangle className="text-error-600" />
            <span className="text-caption-bold font-caption-bold uppercase tracking-widest text-error-600">Danger Zone</span>
          </div>
          <Button
            variant="destructive-primary"
            size="medium"
            icon={<FeatherLogOut />}
            onClick={onLogout}
          >
            Log Out
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;
