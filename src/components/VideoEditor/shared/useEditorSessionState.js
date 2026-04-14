import { useCallback, useEffect, useRef } from 'react';

/**
 * useEditorSessionState — Lightweight session persistence for editor UI state.
 *
 * Saves/restores:
 *   - Collapsed section state (which sidebar panels are open)
 *   - Active video index (which variation tab is selected)
 *
 * Storage key: `editor_session_{artistId}_{editorMode}_{draftId}`
 * Cleans up on save/close via returned `clearSession`.
 *
 * @param {string} artistId
 * @param {string} editorMode — 'solo-clip' | 'multi-clip' | 'photo-montage'
 * @param {string|null} draftId — existing video ID (null for new drafts)
 */
const useEditorSessionState = (artistId, editorMode, draftId) => {
  const storageKey = artistId
    ? `editor_session_${artistId}_${editorMode}_${draftId || 'new'}`
    : null;
  const saveTimerRef = useRef(null);

  // Load persisted state (returns null if none)
  const loadSession = useCallback(() => {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, [storageKey]);

  // Debounced save (500ms)
  const saveSession = useCallback(
    (data) => {
      if (!storageKey) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify({
              ...data,
              savedAt: Date.now(),
            }),
          );
        } catch {
          /* quota exceeded */
        }
      }, 500);
    },
    [storageKey],
  );

  // Clear session on close/save
  const clearSession = useCallback(() => {
    if (!storageKey) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { loadSession, saveSession, clearSession };
};

export default useEditorSessionState;
