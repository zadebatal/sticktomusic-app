import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * useEditorHistory — Shared undo/redo hook for video editors.
 * Mirrors SlideshowEditor's history mechanism (historyRef array, debounced snapshots).
 *
 * @param {Object} opts
 * @param {Function} opts.getSnapshot  — returns a JSON-serializable snapshot of current state
 * @param {Function} opts.restoreSnapshot — receives a deep-cloned snapshot to restore
 * @param {Array}    opts.deps         — dependency array that triggers a debounced snapshot push
 * @param {Array}    [opts.guardDeps]  — when any guardDep is truthy, skip auto-push (e.g. dragging)
 * @param {boolean}  [opts.isEditingText] — suppress keyboard shortcuts during text editing
 */
export default function useEditorHistory({ getSnapshot, restoreSnapshot, deps, guardDeps = [], isEditingText = false }) {
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const historyTimerRef = useRef(null);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = useCallback(() => {
    if (isUndoRedoRef.current) return;
    const snapshot = getSnapshot();
    if (!snapshot) return;
    const history = historyRef.current;
    const idx = historyIndexRef.current;
    historyRef.current = history.slice(0, idx + 1);
    historyRef.current.push(JSON.parse(JSON.stringify(snapshot)));
    if (historyRef.current.length > 50) {
      historyRef.current = historyRef.current.slice(-50);
    }
    historyIndexRef.current = historyRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, [getSnapshot]);

  // Debounced auto-push on deps change (use a stringified key to avoid spread in deps array)
  const guardDepsRef = useRef(guardDeps);
  guardDepsRef.current = guardDeps;
  // Create a stable key from deps for triggering the effect
  const depsKey = deps.map(d => (typeof d === 'object' ? JSON.stringify(d) : String(d))).join('|');

  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    // Skip during guard conditions (drag ops, etc.)
    if (guardDepsRef.current.some(Boolean)) return;

    clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      pushHistory();
    }, 500);
    return () => clearTimeout(historyTimerRef.current);
  }, [depsKey, pushHistory]);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current -= 1;
    const prevState = JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current]));
    restoreSnapshot(prevState);
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }, [restoreSnapshot]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current += 1;
    const nextState = JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current]));
    restoreSnapshot(nextState);
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, [restoreSnapshot]);

  // Keyboard shortcuts: Cmd+Z / Cmd+Shift+Z
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isEditingText) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, isEditingText]);

  // Reset history (e.g. when switching video variations)
  const resetHistory = useCallback(() => {
    historyRef.current = [];
    historyIndexRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return { canUndo, canRedo, handleUndo, handleRedo, resetHistory };
}
