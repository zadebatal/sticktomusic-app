import { useEffect, useCallback, useRef } from 'react';

/**
 * useUnsavedChanges — guards against accidental loss of editor work.
 *
 * - Registers a `beforeunload` handler when `hasUnsavedChanges` is true
 *   (prevents browser close / refresh without confirmation).
 * - Returns `confirmLeave()` for in-app navigation (Back button, ESC, etc.)
 *   which shows a native confirm dialog when there are unsaved changes.
 *
 * Usage:
 *   const { confirmLeave } = useUnsavedChanges(hasUnsavedChanges);
 *   // In your back/close handler:
 *   if (!confirmLeave()) return; // user cancelled
 *   onClose();
 */
const useUnsavedChanges = (hasUnsavedChanges) => {
  // Keep a ref so the beforeunload handler always reads the latest value
  const dirtyRef = useRef(hasUnsavedChanges);
  dirtyRef.current = hasUnsavedChanges;

  // Register / unregister beforeunload
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // In-app navigation guard (Back button, ESC, etc.)
  const confirmLeave = useCallback(() => {
    if (!dirtyRef.current) return true;
    return window.confirm('You have unsaved changes. Are you sure you want to leave?');
  }, []);

  return { confirmLeave };
};

export default useUnsavedChanges;
