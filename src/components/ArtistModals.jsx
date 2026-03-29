import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import {
  createArtist,
  updateArtist,
  deleteArtist,
  setLastArtistId,
} from '../services/artistService';
import log from '../utils/logger';

// Conductor emails — same logic as App.jsx
const CONDUCTOR_EMAILS = (process.env.REACT_APP_CONDUCTOR_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const ADD_ARTIST_FORM_INITIAL = {
  name: '',
  tier: 'Scale',
  cdTier: 'CD Lite',
  assignedOperatorId: '',
  artistEmail: '',
  socialSetsForArtist: 5,
  error: null,
  isLoading: false,
};

/**
 * ArtistModals — extracted from App.jsx
 *
 * Owns all 4 artist management modals (Add, Delete, Reassign, Edit)
 * and their handlers. Parent triggers modals via ref methods:
 *   ref.current.openAdd()
 *   ref.current.openEdit(artist)
 *   ref.current.openDelete(artist)
 *   ref.current.openReassign(artist)
 */
const ArtistModals = forwardRef(function ArtistModals(
  {
    db,
    user,
    firestoreArtists,
    currentArtistId,
    setCurrentArtistId,
    allowedUsers,
    showToast,
    isConductor,
    currentUserRecord,
  },
  ref,
) {
  // --- Modal states ---
  const [showAddArtistModal, setShowAddArtistModal] = useState(false);
  const [addArtistForm, setAddArtistForm] = useState(ADD_ARTIST_FORM_INITIAL);
  const [deleteArtistConfirm, setDeleteArtistConfirm] = useState({
    show: false,
    artist: null,
    isDeleting: false,
  });
  const [reassignArtist, setReassignArtist] = useState({ show: false, artist: null });
  const [editArtistModal, setEditArtistModal] = useState({
    show: false,
    artist: null,
    activeSince: '',
    isSaving: false,
  });

  // --- Expose open methods to parent via ref ---
  useImperativeHandle(ref, () => ({
    openAdd: () => {
      setAddArtistForm(ADD_ARTIST_FORM_INITIAL);
      setShowAddArtistModal(true);
    },
    openEdit: (artist) => {
      setEditArtistModal({
        show: true,
        artist,
        activeSince: artist.activeSince || 'Feb 2026',
        isSaving: false,
      });
    },
    openDelete: (artist) => {
      setDeleteArtistConfirm({ show: true, artist, isDeleting: false });
    },
    openReassign: (artist) => {
      setReassignArtist({ show: true, artist });
    },
  }));

  // --- Handlers ---

  const handleAddArtist = async (e) => {
    e.preventDefault();
    if (!addArtistForm.name.trim()) {
      setAddArtistForm((prev) => ({ ...prev, error: 'Artist name is required' }));
      return;
    }

    setAddArtistForm((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // For operators, auto-assign to themselves if no operator selected
      // For conductors, use the selected operator (or none)
      const assignToOperatorId = isConductor(user)
        ? addArtistForm.assignedOperatorId || null
        : currentUserRecord?.id || null; // Operators auto-assign to themselves

      const newArtist = await createArtist(db, {
        name: addArtistForm.name.trim(),
        tier: addArtistForm.tier,
        cdTier: addArtistForm.cdTier,
        ownerOperatorId: assignToOperatorId,
      });

      log('Created new artist:', newArtist);

      // Auto-assign artist to the operator (either selected or self)
      if (assignToOperatorId) {
        const operatorUser = allowedUsers.find((u) => u.id === assignToOperatorId);
        if (operatorUser && operatorUser.email) {
          // Use email as doc ID — matches Firestore security rules (allowedUsers/{email})
          const operatorRef = doc(db, 'allowedUsers', operatorUser.email.toLowerCase());
          const currentAssigned = operatorUser.assignedArtistIds || [];
          await updateDoc(operatorRef, {
            assignedArtistIds: [...currentAssigned, newArtist.id],
          });
          log('Assigned artist to operator:', operatorUser.email);
        }
      }

      // If artist email provided, create allowedUsers record so the artist can log in
      if (addArtistForm.artistEmail?.trim()) {
        const artistEmail = addArtistForm.artistEmail.trim().toLowerCase();
        try {
          await setDoc(doc(db, 'allowedUsers', artistEmail), {
            email: artistEmail,
            name: addArtistForm.name.trim(),
            role: 'artist',
            artistId: newArtist.id,
            socialSetsAllocated: addArtistForm.socialSetsForArtist || 5,
            socialSetsAllowed: addArtistForm.socialSetsForArtist || 5,
            status: 'active',
            ownerOperatorId: assignToOperatorId,
            onboardingComplete: false,
            createdAt: new Date().toISOString(),
            invitedBy: user?.email || 'unknown',
          });
          log('Created allowedUsers record for artist:', artistEmail);
        } catch (err) {
          log.warn('Could not create allowedUsers record:', err);
        }
      }

      // Select the new artist
      setCurrentArtistId(newArtist.id);
      setLastArtistId(newArtist.id);

      // Close modal and reset form
      setShowAddArtistModal(false);
      setAddArtistForm({
        name: '',
        assignedOperatorId: '',
        artistEmail: '',
        socialSetsForArtist: 5,
        error: null,
        isLoading: false,
      });
    } catch (error) {
      log.error('Failed to create artist:', error);
      setAddArtistForm((prev) => ({
        ...prev,
        error: error.message || 'Failed to create artist',
        isLoading: false,
      }));
    }
  };

  const handleDeleteArtist = async () => {
    const artist = deleteArtistConfirm.artist;
    if (!artist) return;
    setDeleteArtistConfirm((prev) => ({ ...prev, isDeleting: true }));
    try {
      await deleteArtist(db, artist.id);
      // If we just deleted the currently selected artist, switch to another
      if (currentArtistId === artist.id) {
        const remaining = firestoreArtists.filter((a) => a.id !== artist.id);
        if (remaining.length > 0) {
          setCurrentArtistId(remaining[0].id);
          setLastArtistId(remaining[0].id);
        } else {
          setCurrentArtistId(null);
          setLastArtistId(null);
        }
      }
      // Also remove from any operator's assignedArtistIds
      for (const u of allowedUsers) {
        if (u.assignedArtistIds?.includes(artist.id)) {
          const operatorRef = doc(db, 'allowedUsers', u.email.toLowerCase());
          await updateDoc(operatorRef, {
            assignedArtistIds: u.assignedArtistIds.filter((id) => id !== artist.id),
          });
        }
      }
      log('Deleted artist:', artist.id, artist.name);
    } catch (error) {
      log.error('Failed to delete artist:', error);
      showToast('Failed to delete artist: ' + error.message, 'error');
    }
    setDeleteArtistConfirm({ show: false, artist: null, isDeleting: false });
  };

  const handleReassignArtist = async (artistId, newOwnerId) => {
    try {
      await updateArtist(db, artistId, { ownerOperatorId: newOwnerId || null });
      // Update assignedArtistIds for old and new operators
      const artist = firestoreArtists.find((a) => a.id === artistId);
      // Remove from old operator's assignedArtistIds
      if (artist?.ownerOperatorId) {
        const oldOwner = allowedUsers.find((u) => u.id === artist.ownerOperatorId);
        if (oldOwner?.email && oldOwner.assignedArtistIds?.includes(artistId)) {
          const oldRef = doc(db, 'allowedUsers', oldOwner.email.toLowerCase());
          await updateDoc(oldRef, {
            assignedArtistIds: oldOwner.assignedArtistIds.filter((id) => id !== artistId),
          });
        }
      }
      // Add to new operator's assignedArtistIds
      if (newOwnerId) {
        const newOwner = allowedUsers.find((u) => u.id === newOwnerId);
        if (newOwner?.email) {
          const newRef = doc(db, 'allowedUsers', newOwner.email.toLowerCase());
          const currentAssigned = newOwner.assignedArtistIds || [];
          if (!currentAssigned.includes(artistId)) {
            await updateDoc(newRef, {
              assignedArtistIds: [...currentAssigned, artistId],
            });
          }
        }
      }
      log('Reassigned artist:', artistId, '-> owner:', newOwnerId);
    } catch (error) {
      log.error('Failed to reassign artist:', error);
      showToast('Failed to reassign: ' + error.message, 'error');
    }
    setReassignArtist({ show: false, artist: null });
  };

  const handleSaveArtistEdit = async () => {
    if (!editArtistModal.artist) return;
    setEditArtistModal((prev) => ({ ...prev, isSaving: true }));
    try {
      await updateArtist(db, editArtistModal.artist.id, {
        activeSince: editArtistModal.activeSince,
      });
      log('Updated artist details:', editArtistModal.artist.id);
    } catch (error) {
      log.error('Failed to update artist:', error);
      showToast('Failed to save: ' + error.message, 'error');
    }
    setEditArtistModal({ show: false, artist: null, activeSince: '', isSaving: false });
  };

  // --- Render ---

  return (
    <>
      {/* ADD ARTIST MODAL */}
      {showAddArtistModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
          onClick={() => setShowAddArtistModal(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold">Add New Artist</h2>
              <button
                onClick={() => setShowAddArtistModal(false)}
                className="text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddArtist} className="p-6 space-y-4">
              {addArtistForm.error && (
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {addArtistForm.error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Artist Name</label>
                <input
                  type="text"
                  value={addArtistForm.name}
                  onChange={(e) =>
                    setAddArtistForm((prev) => ({ ...prev, name: e.target.value, error: null }))
                  }
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                  placeholder="Artist name"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Tier</label>
                <select
                  value={addArtistForm.tier}
                  onChange={(e) => setAddArtistForm((prev) => ({ ...prev, tier: e.target.value }))}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                >
                  <option value="Scale">Scale</option>
                  <option value="Growth">Growth</option>
                  <option value="Starter">Starter</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">
                  Artist Email (optional)
                </label>
                <input
                  type="email"
                  value={addArtistForm.artistEmail}
                  onChange={(e) =>
                    setAddArtistForm((prev) => ({ ...prev, artistEmail: e.target.value }))
                  }
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                  placeholder="artist@email.com"
                />
                <p className="text-xs text-zinc-500 mt-1">
                  If provided, the artist can sign in and see their dashboard
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">
                  Social Sets for this artist
                </label>
                <select
                  value={addArtistForm.socialSetsForArtist}
                  onChange={(e) =>
                    setAddArtistForm((prev) => ({
                      ...prev,
                      socialSetsForArtist: parseInt(e.target.value),
                    }))
                  }
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                >
                  <option value={5}>5 Social Sets (Starter)</option>
                  <option value={10}>10 Social Sets (Growth)</option>
                  <option value={25}>25 Social Sets (Scale)</option>
                  <option value={50}>50 Social Sets (Sensation)</option>
                </select>
                <p className="text-xs text-zinc-500 mt-1">
                  Each Social Set = 4 platform slots (FB + TikTok + Twitter + IG)
                </p>
              </div>
              {/* Only show operator assignment for conductors - operators auto-assign to themselves */}
              {isConductor(user) ? (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    Assign to Operator
                  </label>
                  <select
                    value={addArtistForm.assignedOperatorId}
                    onChange={(e) =>
                      setAddArtistForm((prev) => ({
                        ...prev,
                        assignedOperatorId: e.target.value,
                      }))
                    }
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500"
                  >
                    {allowedUsers
                      .filter((u) => u.role === 'operator' && u.status === 'active')
                      .map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.name} ({op.email})
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-zinc-500 mt-1">
                    Select which operator can manage this artist
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-violet-500/10 border border-violet-500/30 rounded-xl">
                  <p className="text-sm text-violet-400">
                    This artist will be assigned to your account
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddArtistModal(false)}
                  className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addArtistForm.isLoading}
                  className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-semibold hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {addArtistForm.isLoading ? (
                    <>
                      <span className="animate-spin">&#x27F3;</span>
                      Creating...
                    </>
                  ) : (
                    'Create Artist'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE ARTIST CONFIRMATION MODAL */}
      {deleteArtistConfirm.show && deleteArtistConfirm.artist && (
        <div
          className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
          onClick={() => setDeleteArtistConfirm({ show: false, artist: null, isDeleting: false })}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-red-400">Delete Artist</h2>
              <button
                onClick={() =>
                  setDeleteArtistConfirm({ show: false, artist: null, isDeleting: false })
                }
                className="text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-zinc-300">
                Are you sure you want to delete <strong>{deleteArtistConfirm.artist.name}</strong>?
              </p>
              <p className="text-sm text-zinc-500">
                This will permanently remove this artist for all users. Any content, pages, and data
                associated with this artist will be lost.
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() =>
                    setDeleteArtistConfirm({ show: false, artist: null, isDeleting: false })
                  }
                  className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteArtist}
                  disabled={deleteArtistConfirm.isDeleting}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition disabled:opacity-50"
                >
                  {deleteArtistConfirm.isDeleting ? 'Deleting...' : 'Delete Forever'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REASSIGN ARTIST MODAL */}
      {reassignArtist.show && reassignArtist.artist && (
        <div
          className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
          onClick={() => setReassignArtist({ show: false, artist: null })}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold">Reassign Artist</h2>
              <button
                onClick={() => setReassignArtist({ show: false, artist: null })}
                className="text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-zinc-300">
                Move <strong>{reassignArtist.artist.name}</strong> to a different operator:
              </p>
              <div className="space-y-2">
                {/* Unassigned option */}
                <button
                  onClick={() => handleReassignArtist(reassignArtist.artist.id, null)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition hover:border-zinc-600 ${
                    !reassignArtist.artist.ownerOperatorId
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-zinc-800 bg-zinc-800/50'
                  }`}
                >
                  <span className="text-sm font-medium">Unassigned</span>
                  <span className="text-xs text-zinc-500 ml-2">No operator</span>
                </button>
                {/* Conductor + Operators */}
                {allowedUsers
                  .filter(
                    (u) =>
                      u.role === 'operator' || CONDUCTOR_EMAILS.includes(u.email?.toLowerCase()),
                  )
                  .map((op) => {
                    const isCond = CONDUCTOR_EMAILS.includes(op.email?.toLowerCase());
                    const isCurrentOwner = reassignArtist.artist.ownerOperatorId === op.id;
                    return (
                      <button
                        key={op.id}
                        onClick={() => handleReassignArtist(reassignArtist.artist.id, op.id)}
                        className={`w-full text-left px-4 py-3 rounded-xl border transition hover:border-zinc-600 ${
                          isCurrentOwner
                            ? 'border-violet-500 bg-violet-500/10'
                            : 'border-zinc-800 bg-zinc-800/50'
                        }`}
                      >
                        <span className="text-sm font-medium">{op.name || op.email}</span>
                        <span
                          className={`text-xs ml-2 ${isCond ? 'text-amber-400' : 'text-zinc-500'}`}
                        >
                          {isCond ? 'Conductor' : 'Operator'}
                        </span>
                        {isCurrentOwner && (
                          <span className="text-xs text-violet-400 ml-2">(current)</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT ARTIST MODAL */}
      {editArtistModal.show && editArtistModal.artist && (
        <div
          className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
          onClick={() =>
            setEditArtistModal({ show: false, artist: null, activeSince: '', isSaving: false })
          }
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold">Edit Artist</h2>
              <button
                onClick={() =>
                  setEditArtistModal({
                    show: false,
                    artist: null,
                    activeSince: '',
                    isSaving: false,
                  })
                }
                className="text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-zinc-400 text-sm">
                Editing <strong className="text-white">{editArtistModal.artist.name}</strong>
              </p>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Active Since
                </label>
                <input
                  type="text"
                  value={editArtistModal.activeSince}
                  onChange={(e) =>
                    setEditArtistModal((prev) => ({ ...prev, activeSince: e.target.value }))
                  }
                  placeholder="e.g. Nov 2024"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                />
                <p className="text-xs text-zinc-600 mt-1">
                  Format: Mon YYYY (e.g. Nov 2024, Feb 2026)
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() =>
                    setEditArtistModal({
                      show: false,
                      artist: null,
                      activeSince: '',
                      isSaving: false,
                    })
                  }
                  className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveArtistEdit}
                  disabled={editArtistModal.isSaving}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition text-sm font-medium disabled:opacity-50"
                >
                  {editArtistModal.isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default ArtistModals;
