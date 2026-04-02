import React, { useState, useEffect, useCallback } from 'react';
import {
  isElectronApp,
  getMediaFolder,
  selectMediaFolder,
  isDriveConnected,
  getDiskUsage,
  relocateOfflineFiles,
  openInFinder,
} from '../../services/localMediaService';
import { formatBytes } from '../../services/syncService';
import SyncModal from '../SyncModal';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { shouldShowPaymentUI } from '../../services/subscriptionService';
import { useToast, ConfirmDialog } from '../ui';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { TextField } from '../../ui/components/TextField';
import {
  FeatherLogOut,
  FeatherAlertTriangle,
  FeatherCloud,
  FeatherUsers,
  FeatherUser,
  FeatherCreditCard,
  FeatherMail,
  FeatherCheck,
  FeatherCamera,
  FeatherEdit2,
  FeatherTrash2,
  FeatherHardDrive,
} from '@subframe/core';
import { formatStorageSize } from '../../services/storageQuotaService';
import ProfilePictureUpload from '../ProfilePictureUpload';
import log from '../../utils/logger';
import {
  initGoogleDrive,
  authenticate as driveAuth,
  disconnect as driveDisconnect,
  getDriveSettings,
  saveDriveSettings,
} from '../../services/googleDriveService';
import {
  initDropbox,
  authenticate as dbxAuth,
  disconnect as dbxDisconnect,
  getDropboxSettings,
  saveDropboxSettings,
} from '../../services/dropboxService';

/**
 * SettingsTab — Profile, team management, theme picker, logout.
 */

const DRIVE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const DRIVE_API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;
const DROPBOX_APP_KEY = process.env.REACT_APP_DROPBOX_APP_KEY;

// ── Media Library Section (Electron desktop only) ──
const MediaLibrarySection = ({ db, firestoreArtists }) => {
  const [folder, setFolder] = useState(null);
  const [connected, setConnected] = useState(false);
  const [diskUsage, setDiskUsage] = useState(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [relocating, setRelocating] = useState(false);
  const [relocateResult, setRelocateResult] = useState(null);
  const [autoImport, setAutoImport] = useState(false);

  useEffect(() => {
    getMediaFolder().then(setFolder);
    isDriveConnected().then(setConnected);
    getDiskUsage().then(setDiskUsage);
    // Poll drive status every 10 seconds, disk usage every 30 seconds
    const driveInterval = setInterval(() => isDriveConnected().then(setConnected), 10000);
    const diskInterval = setInterval(() => getDiskUsage().then(setDiskUsage), 30000);
    return () => {
      clearInterval(driveInterval);
      clearInterval(diskInterval);
    };
  }, []);

  const handleSelectFolder = async () => {
    const selected = await selectMediaFolder();
    if (selected) {
      setFolder(selected);
      setConnected(true);
      getDiskUsage().then(setDiskUsage);
    }
  };

  const handleRelocate = async () => {
    setRelocating(true);
    setRelocateResult(null);
    try {
      // Pass empty array to trigger a full drive scan
      const result = await relocateOfflineFiles([]);
      setRelocateResult(result);
    } catch {
      setRelocateResult({ error: true });
    } finally {
      setRelocating(false);
    }
  };

  const diskPercent = diskUsage ? (diskUsage.used / (diskUsage.used + diskUsage.free)) * 100 : 0;

  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-6">
      <div className="flex w-full items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600/20">
          <span style={{ fontSize: 18 }}>💾</span>
        </div>
        <span className="text-body-bold font-body-bold text-white">Media Library</span>
        <div style={{ marginLeft: 'auto' }}>
          {connected ? (
            <span className="text-caption font-caption text-green-400">Connected ●</span>
          ) : folder ? (
            <span className="text-caption font-caption text-amber-400">Disconnected</span>
          ) : null}
        </div>
      </div>

      {folder ? (
        <>
          {/* Folder path */}
          <div className="flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-4 py-3">
            <span className="text-caption font-caption text-neutral-400">Folder</span>
            <span
              className="text-caption font-caption text-neutral-300 max-w-[280px] truncate"
              title={folder}
            >
              {folder}
            </span>
          </div>

          {/* Drive space indicator */}
          {diskUsage && (
            <div className="flex w-full flex-col gap-2">
              <span className="text-caption font-caption text-neutral-400">
                Used: {formatBytes(diskUsage.used)} · Free: {formatBytes(diskUsage.free)}
              </span>
              <div
                style={{
                  width: '100%',
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(diskPercent, 100)}%`,
                    height: '100%',
                    borderRadius: 3,
                    backgroundColor:
                      diskPercent > 90 ? '#ef4444' : diskPercent > 70 ? '#f59e0b' : '#22c55e',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Action buttons row 1 */}
          <div className="flex w-full items-center gap-2">
            <Button variant="neutral-secondary" size="small" onClick={() => openInFinder(folder)}>
              Open in Finder
            </Button>
            <Button variant="neutral-secondary" size="small" onClick={handleSelectFolder}>
              Change Folder
            </Button>
          </div>

          {/* Action buttons row 2 */}
          <div className="flex w-full items-center gap-2">
            <Button variant="neutral-secondary" size="small" onClick={() => setShowSyncModal(true)}>
              Sync from STM Server
            </Button>
            <Button
              variant="neutral-secondary"
              size="small"
              onClick={handleRelocate}
              disabled={relocating}
            >
              {relocating ? 'Scanning drive...' : 'Relocate Media'}
            </Button>
          </div>

          {/* Relocate result */}
          {relocateResult && !relocateResult.error && (
            <span className="text-caption font-caption text-neutral-400">
              Found {relocateResult.found} of {relocateResult.total} files
            </span>
          )}
          {relocateResult?.error && (
            <span className="text-caption font-caption text-red-400">
              Relocate scan failed. Check drive connection.
            </span>
          )}

          {/* Auto-import toggle */}
          <div className="flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-4 py-3">
            <span className="text-caption font-caption text-neutral-300">
              Auto-import new files
            </span>
            <button
              onClick={() => setAutoImport(!autoImport)}
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                backgroundColor: autoImport ? '#6366f1' : 'rgba(255,255,255,0.12)',
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background-color 0.2s ease',
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  backgroundColor: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: autoImport ? 18 : 2,
                  transition: 'left 0.2s ease',
                }}
              />
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-caption font-caption text-neutral-400">
            Select a folder on your drive to store media files locally. This can be an external SSD,
            hard drive, or any folder on your computer.
          </span>
          <Button variant="brand-primary" size="medium" onClick={handleSelectFolder}>
            Select Media Folder
          </Button>
        </>
      )}

      {/* Sync Modal */}
      {showSyncModal && (
        <SyncModal
          db={db}
          artists={firestoreArtists || []}
          onClose={() => setShowSyncModal(false)}
        />
      )}
    </div>
  );
};

const SettingsTab = ({
  user,
  onLogout,
  db,
  artistId,
  onPhotoUpdated,
  allUsers = [],
  firestoreArtists = [],
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState(null); // 'sending' | 'success' | 'error'
  const [inviteMessage, setInviteMessage] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelMessage, setCancelMessage] = useState('');
  const [showPfpUpload, setShowPfpUpload] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });

  // Conductor user management state
  const [inviteRole, setInviteRole] = useState('operator');
  const [editingUser, setEditingUser] = useState(null); // email of user being role-edited
  const [editRole, setEditRole] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null); // email of user pending delete
  const [loadingAction, setLoadingAction] = useState(null); // email of user action in progress

  // Cloud storage state
  const [driveSettings, setDriveSettings] = useState(null);
  const [dropboxSettings, setDropboxSettings] = useState(null);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [dropboxConnecting, setDropboxConnecting] = useState(false);

  // Load cloud settings on mount
  useEffect(() => {
    if (!db || !artistId) return;
    getDriveSettings(db, artistId)
      .then(setDriveSettings)
      .catch(() => {});
    getDropboxSettings(db, artistId)
      .then(setDropboxSettings)
      .catch(() => {});
  }, [db, artistId]);

  const handleConnectDrive = useCallback(async () => {
    if (!DRIVE_CLIENT_ID || !DRIVE_API_KEY) {
      toastError('Google Drive not configured. Missing API keys.');
      return;
    }
    setDriveConnecting(true);
    try {
      await initGoogleDrive(DRIVE_CLIENT_ID, DRIVE_API_KEY);
      await driveAuth();
      const settings = { connected: true, connectedAt: new Date().toISOString() };
      await saveDriveSettings(db, artistId, settings);
      setDriveSettings((prev) => ({ ...prev, ...settings }));
      toastSuccess('Google Drive connected');
    } catch (err) {
      toastError('Drive connection failed: ' + (err?.message || String(err)));
    }
    setDriveConnecting(false);
  }, [db, artistId, toastSuccess, toastError]);

  const handleDisconnectDrive = useCallback(async () => {
    driveDisconnect();
    const settings = { connected: false };
    await saveDriveSettings(db, artistId, settings);
    setDriveSettings((prev) => ({ ...prev, ...settings }));
    toastSuccess('Google Drive disconnected');
  }, [db, artistId, toastSuccess]);

  const handleConnectDropbox = useCallback(async () => {
    if (!DROPBOX_APP_KEY) {
      toastError('Dropbox not configured. Missing app key.');
      return;
    }
    setDropboxConnecting(true);
    try {
      initDropbox(DROPBOX_APP_KEY);
      await dbxAuth();
      const settings = { connected: true, connectedAt: new Date().toISOString() };
      await saveDropboxSettings(db, artistId, settings);
      setDropboxSettings((prev) => ({ ...prev, ...settings }));
      toastSuccess('Dropbox connected');
    } catch (err) {
      toastError('Dropbox connection failed: ' + (err?.message || String(err)));
    }
    setDropboxConnecting(false);
  }, [db, artistId, toastSuccess, toastError]);

  const handleDisconnectDropbox = useCallback(async () => {
    dbxDisconnect();
    const settings = { connected: false };
    await saveDropboxSettings(db, artistId, settings);
    setDropboxSettings((prev) => ({ ...prev, ...settings }));
    toastSuccess('Dropbox disconnected');
  }, [db, artistId, toastSuccess]);

  const canCancel =
    shouldShowPaymentUI(user) && user?.subscriptionId && user?.subscriptionStatus === 'active';

  const handleCancelSubscription = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Cancel Subscription',
      message:
        'Are you sure you want to cancel your subscription? Your access will continue until the end of the billing period.',
      confirmLabel: 'Cancel Subscription',
      onConfirm: async () => {
        setConfirmDialog({ isOpen: false });
        setCancelLoading(true);
        setCancelMessage('');
        try {
          const auth = getAuth();
          const token = await auth.currentUser?.getIdToken();
          const response = await fetch('/api/cancel-subscription', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
      },
    });
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

      const role = user?.role === 'conductor' ? inviteRole : 'collaborator';
      await setDoc(userRef, {
        email,
        name: email.split('@')[0],
        role,
        status: 'active',
        createdAt: new Date().toISOString(),
        invitedBy: user?.email || 'unknown',
      });

      setInviteEmail('');
      setInviteStatus('success');
      setInviteMessage(`Invited ${email} as ${role}.`);
      setTimeout(() => {
        setInviteStatus(null);
        setInviteMessage('');
      }, 4000);
    } catch (err) {
      log.error('[Settings] Invite failed:', err);
      setInviteStatus('error');
      setInviteMessage('Failed to send invite. Please try again.');
    }
  };

  // Conductor user management handlers
  const isConductor = user?.role === 'conductor';

  const handleRoleChange = async (email, newRole) => {
    setLoadingAction(email);
    try {
      await updateDoc(doc(db, 'allowedUsers', email), { role: newRole });
      toastSuccess(`Updated ${email} to ${newRole}`);
      setEditingUser(null);
    } catch (err) {
      toastError('Failed to update role: ' + (err?.message || String(err)));
    }
    setLoadingAction(null);
  };

  const handleToggleStatus = async (email, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    const doToggle = async () => {
      try {
        await updateDoc(doc(db, 'allowedUsers', email), { status: newStatus });
        toastSuccess(`${email} is now ${newStatus}`);
      } catch (err) {
        toastError('Failed to update status');
      }
    };
    if (newStatus === 'inactive') {
      setConfirmDialog({
        isOpen: true,
        title: 'Deactivate User',
        message: `Deactivate ${email}? They will lose access until reactivated.`,
        confirmLabel: 'Deactivate',
        onConfirm: () => {
          setConfirmDialog({ isOpen: false });
          doToggle();
        },
      });
    } else {
      doToggle();
    }
  };

  const handleDeleteUser = async (email) => {
    try {
      await deleteDoc(doc(db, 'allowedUsers', email));
      toastSuccess(`Removed ${email}`);
      setDeleteConfirm(null);
    } catch (err) {
      toastError('Failed to remove user');
    }
  };

  const getLinkedArtistName = (u) => {
    if (!u?.linkedArtistId) return null;
    const artist = firestoreArtists.find((a) => a.id === u.linkedArtistId);
    return artist?.name || u.linkedArtistId;
  };

  const initials = (user?.name || user?.email || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex-1 overflow-auto bg-black px-4 md:px-12 py-8">
      <span className="text-heading-1 font-heading-1 text-white">Settings</span>

      {/* ═══ PROFILE HERO ═══ */}
      <div
        className="mt-6 flex w-full items-center gap-6 rounded-xl border border-solid border-neutral-200 p-6"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' }}
      >
        <div
          className="relative cursor-pointer"
          tabIndex={0}
          role="button"
          aria-label="Change profile picture"
          onClick={() => setShowPfpUpload(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowPfpUpload(true);
            }
          }}
        >
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              className="h-20 w-20 rounded-full object-cover ring-2 ring-white/20"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-white ring-2 ring-white/20">
              {initials}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 ring-2 ring-black cursor-pointer hover:bg-brand-500 transition-colors">
            <FeatherCamera style={{ width: 14, height: 14, color: '#fff' }} />
          </div>
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-heading-2 font-heading-2 text-white">{user?.name || 'User'}</span>
          <span className="text-body font-body text-neutral-300">{user?.email || ''}</span>
          <div className="flex items-center gap-2 mt-1">
            {user?.role && (
              <Badge variant="brand" className="capitalize">
                {user.role}
              </Badge>
            )}
            <Badge variant="success">Active</Badge>
          </div>
        </div>
      </div>

      {/* ═══ TWO-COLUMN GRID ═══ */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ── TEAM ── */}
        {isConductor ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-6 col-span-2">
            <div className="flex w-full items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600/20">
                <FeatherUsers style={{ width: 18, height: 18, color: '#818cf8' }} />
              </div>
              <span className="text-body-bold font-body-bold text-white">User Management</span>
              <Badge variant="brand">{allUsers.length} users</Badge>
            </div>

            {/* Invite row */}
            <div className="flex w-full items-center gap-2">
              <TextField className="grow shrink-0 basis-0" variant="filled" label="" helpText="">
                <TextField.Input
                  type="email"
                  placeholder="Email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </TextField>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/50"
              >
                <option value="operator">Operator</option>
                <option value="artist">Artist</option>
                <option value="collaborator">Collaborator</option>
              </select>
              <Button
                variant="brand-primary"
                size="medium"
                icon={<FeatherMail />}
                disabled={inviteStatus === 'sending'}
                onClick={handleInvite}
              >
                {inviteStatus === 'sending' ? 'Sending...' : 'Invite'}
              </Button>
            </div>
            {inviteMessage && (
              <span
                className={`text-caption font-caption ${inviteStatus === 'success' ? 'text-success-600' : 'text-error-600'}`}
              >
                {inviteMessage}
              </span>
            )}

            {/* User list table */}
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-400">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Email</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Artist</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map((u) => {
                    const isMe = u.email?.toLowerCase() === user?.email?.toLowerCase();
                    const linkedName = getLinkedArtistName(u);
                    return (
                      <tr key={u.email || u.id} className="border-b border-neutral-200/50">
                        <td className="py-3 pr-4 text-white">
                          {u.name || u.email?.split('@')[0] || '—'}
                        </td>
                        <td className="py-3 pr-4 text-neutral-400">{u.email || '—'}</td>
                        <td className="py-3 pr-4">
                          {editingUser === u.email ? (
                            <div className="flex items-center gap-1">
                              <select
                                value={editRole}
                                onChange={(e) => setEditRole(e.target.value)}
                                autoFocus
                                className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm text-white outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                              >
                                <option value="conductor">Conductor</option>
                                <option value="operator">Operator</option>
                                <option value="artist">Artist</option>
                                <option value="collaborator">Collaborator</option>
                              </select>
                              <Button
                                variant="brand-primary"
                                size="small"
                                disabled={loadingAction === u.email || editRole === u.role}
                                onClick={() => handleRoleChange(u.email, editRole)}
                              >
                                Save
                              </Button>
                              <Button
                                variant="neutral-tertiary"
                                size="small"
                                onClick={() => setEditingUser(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Badge
                              variant={u.role === 'conductor' ? 'brand' : 'neutral'}
                              className="capitalize"
                            >
                              {u.role || 'operator'}
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-neutral-400">{linkedName || '—'}</td>
                        <td className="py-3 pr-4">
                          {isMe ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <button
                              onClick={() => handleToggleStatus(u.email, u.status || 'active')}
                              className="cursor-pointer"
                            >
                              <Badge
                                variant={
                                  (u.status || 'active') === 'active' ? 'success' : 'neutral'
                                }
                              >
                                {(u.status || 'active') === 'active' ? 'Active' : 'Inactive'}
                              </Badge>
                            </button>
                          )}
                        </td>
                        <td className="py-3">
                          {isMe ? (
                            <span className="text-neutral-600 text-xs">You</span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setEditingUser(u.email);
                                  setEditRole(u.role || 'operator');
                                }}
                                className="p-1.5 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
                                title="Edit role"
                              >
                                <FeatherEdit2 style={{ width: 14, height: 14 }} />
                              </button>
                              {deleteConfirm === u.email ? (
                                <div className="flex items-center gap-1 ml-1">
                                  <Button
                                    variant="destructive-primary"
                                    size="small"
                                    onClick={() => handleDeleteUser(u.email)}
                                  >
                                    Confirm
                                  </Button>
                                  <Button
                                    variant="neutral-secondary"
                                    size="small"
                                    onClick={() => setDeleteConfirm(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(u.email)}
                                  className="p-1.5 rounded hover:bg-red-500/20 text-neutral-400 hover:text-red-400 transition-colors"
                                  title="Remove user"
                                >
                                  <FeatherTrash2 style={{ width: 14, height: 14 }} />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : user?.role !== 'collaborator' ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-6">
            <div className="flex w-full items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600/20">
                <FeatherUsers style={{ width: 18, height: 18, color: '#818cf8' }} />
              </div>
              <span className="text-body-bold font-body-bold text-white">Team</span>
            </div>
            <span className="text-caption font-caption text-neutral-400">
              Invite collaborators who can help create content for your artist.
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
                icon={<FeatherMail />}
                disabled={inviteStatus === 'sending'}
                onClick={handleInvite}
              >
                {inviteStatus === 'sending' ? 'Sending...' : 'Invite'}
              </Button>
            </div>
            {inviteMessage && (
              <span
                className={`text-caption font-caption ${inviteStatus === 'success' ? 'text-success-600' : 'text-error-600'}`}
              >
                {inviteMessage}
              </span>
            )}
          </div>
        ) : null}

        {/* ── CLOUD STORAGE ── */}
        <div className="flex flex-col items-start gap-4 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-6">
          <div className="flex w-full items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-600/20">
              <FeatherCloud style={{ width: 18, height: 18, color: '#06b6d4' }} />
            </div>
            <span className="text-body-bold font-body-bold text-white">Cloud Storage</span>
          </div>
          <span className="text-caption font-caption text-neutral-400">
            Connect cloud storage to import and export media directly from your studio.
          </span>

          {/* Google Drive row */}
          <div className="flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-4 py-3">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 24 24" style={{ width: 20, height: 20 }}>
                <path d="M7.71 3.5L1.15 15l3.43 5.95L11.14 9.45z" fill="#0066DA" />
                <path d="M22.85 15H15.71l-3.43 5.95h10.14z" fill="#00AC47" />
                <path d="M7.71 3.5h7.14L22.85 15l-3.43-5.95z" fill="#EA4335" />
                <path d="M7.71 3.5L1.15 15h7.14l3.43-5.95z" fill="#00832D" opacity="0.5" />
                <path d="M14.85 3.5L22.85 15h-7.14z" fill="#2684FC" opacity="0.5" />
                <path d="M8.29 15l3.43 5.95L15.15 15z" fill="#FFBA00" opacity="0.5" />
              </svg>
              <span className="text-body font-body text-white">Google Drive</span>
              <Badge variant={driveSettings?.connected ? 'success' : 'neutral'}>
                {driveSettings?.connected ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
            {driveSettings?.connected ? (
              <Button variant="neutral-secondary" size="small" onClick={handleDisconnectDrive}>
                Disconnect
              </Button>
            ) : (
              <Button
                variant="brand-secondary"
                size="small"
                disabled={driveConnecting}
                onClick={handleConnectDrive}
              >
                {driveConnecting ? 'Connecting...' : 'Connect'}
              </Button>
            )}
          </div>

          {/* Dropbox row */}
          <div className="flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-4 py-3">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 24 24" style={{ width: 20, height: 20 }}>
                <path d="M6 2l6 3.75L6 9.5 0 5.75z" fill="#0061FF" />
                <path d="M18 2l6 3.75-6 3.75-6-3.75z" fill="#0061FF" />
                <path d="M0 13.25L6 9.5l6 3.75-6 3.75z" fill="#0061FF" />
                <path d="M18 9.5l6 3.75-6 3.75-6-3.75z" fill="#0061FF" />
                <path d="M6 17.75l6-3.75 6 3.75-6 3.75z" fill="#0061FF" />
              </svg>
              <span className="text-body font-body text-white">Dropbox</span>
              <Badge variant={dropboxSettings?.connected ? 'success' : 'neutral'}>
                {dropboxSettings?.connected ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
            {dropboxSettings?.connected ? (
              <Button variant="neutral-secondary" size="small" onClick={handleDisconnectDropbox}>
                Disconnect
              </Button>
            ) : (
              <Button
                variant="brand-secondary"
                size="small"
                disabled={dropboxConnecting}
                onClick={handleConnectDropbox}
              >
                {dropboxConnecting ? 'Connecting...' : 'Connect'}
              </Button>
            )}
          </div>
        </div>

        {/* ── STORAGE USAGE ── */}
        <div className="flex flex-col items-start gap-4 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-6">
          <div className="flex w-full items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/20">
              <FeatherHardDrive style={{ width: 18, height: 18, color: '#8b5cf6' }} />
            </div>
            <span className="text-body-bold font-body-bold text-white">Storage</span>
            {user?.storageQuotaBytes != null &&
              user.storageUsedBytes / user.storageQuotaBytes >= 0.8 && (
                <Badge variant="warning">Running low</Badge>
              )}
          </div>

          {(() => {
            const used = user?.storageUsedBytes || 0;
            const quota = user?.storageQuotaBytes;
            const isUnlimited = quota === null || quota === undefined;
            const pct = isUnlimited ? 0 : Math.min(100, (used / quota) * 100);

            return (
              <>
                <span className="text-caption font-caption text-neutral-400">
                  {isUnlimited
                    ? `${formatStorageSize(used)} used (Unlimited)`
                    : `${formatStorageSize(used)} / ${formatStorageSize(quota)} used`}
                </span>

                {!isUnlimited && (
                  <div className="w-full h-2 rounded-full bg-neutral-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: pct >= 90 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#8b5cf6',
                      }}
                    />
                  </div>
                )}

                {!isUnlimited && (
                  <Button variant="neutral-secondary" size="small" disabled>
                    Upgrade Storage (Coming Soon)
                  </Button>
                )}
              </>
            );
          })()}
        </div>

        {/* ── MEDIA LIBRARY (Electron only) ── */}
        {isElectronApp() && <MediaLibrarySection db={db} firestoreArtists={firestoreArtists} />}

        {/* ── SUBSCRIPTION / ACCOUNT ── */}
        <div className="flex flex-col items-start gap-4 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-6">
          <div className="flex w-full items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600/20">
              <FeatherCreditCard style={{ width: 18, height: 18, color: '#f59e0b' }} />
            </div>
            <span className="text-body-bold font-body-bold text-white">Account</span>
          </div>

          {canCancel ? (
            <>
              <span className="text-caption font-caption text-neutral-400">
                Your subscription is active. Cancelling will take effect at the end of your billing
                period.
              </span>
              {cancelMessage && (
                <span
                  className={`text-caption font-caption ${cancelMessage.includes('Failed') ? 'text-error-600' : 'text-success-600'}`}
                >
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
            </>
          ) : (
            <>
              <span className="text-caption font-caption text-neutral-400">
                Manage your account and billing.
              </span>
              <div className="flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-4 py-3">
                <span className="text-body font-body text-neutral-300">Status</span>
                <Badge variant="success">{user?.paymentExempt ? 'Exempt' : 'Active'}</Badge>
              </div>
            </>
          )}

          <div className="w-full border-t border-neutral-200 mt-auto" />
          <Button
            variant="destructive-secondary"
            size="medium"
            icon={<FeatherLogOut />}
            onClick={() => setShowLogoutConfirm(true)}
          >
            Log Out
          </Button>
        </div>
      </div>

      {showPfpUpload && (
        <ProfilePictureUpload
          db={db}
          onSave={(url) => onPhotoUpdated?.(url)}
          onClose={() => setShowPfpUpload(false)}
        />
      )}

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="Log Out"
        message="Log out of your account?"
        confirmLabel="Log Out"
        confirmVariant="destructive"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        confirmVariant="destructive"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ isOpen: false })}
      />
    </div>
  );
};

export default SettingsTab;
