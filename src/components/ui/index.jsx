import React, { useEffect, useCallback, useState, useRef, createContext, useContext } from 'react';
import log from '../../utils/logger';
import useIsMobile from '../../hooks/useIsMobile';

/**
 * Shared UI Components for StickToMusic
 * P0 Standards: Loading, Error, Empty States, Confirm Dialog, Status Pills, Toast
 */

// ============================================
// FOCUS TRAP HOOK (BUG-030)
// ============================================

/**
 * useFocusTrap - Traps Tab/Shift+Tab focus within a container ref.
 * Attach the returned ref to the modal's root element.
 *
 * Usage:
 *   const trapRef = useFocusTrap(isOpen);
 *   return <div ref={trapRef}>...modal content...</div>;
 */
export const useFocusTrap = (active = true) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

    // Auto-focus first focusable element (or the container itself)
    const firstFocusable = container.querySelector(FOCUSABLE);
    if (firstFocusable) {
      firstFocusable.focus();
    } else {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;

      const focusableEls = Array.from(container.querySelectorAll(FOCUSABLE));
      if (focusableEls.length === 0) return;

      const first = focusableEls[0];
      const last = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [active]);

  return containerRef;
};

// ============================================
// TOAST SYSTEM
// ============================================
const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback for components outside provider
    return {
      toast: () => log.warn('Toast provider not found'),
      success: () => log.warn('Toast provider not found'),
      error: () => log.warn('Toast provider not found'),
      info: () => log.warn('Toast provider not found'),
    };
  }
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const timeoutRefs = useRef(new Map()); // M-21: track timeouts for cleanup

  // M-21: Clean up all timeouts on unmount
  useEffect(() => {
    const refs = timeoutRefs.current;
    return () => {
      refs.forEach(timeoutId => clearTimeout(timeoutId));
      refs.clear();
    };
  }, []);

  const addToast = useCallback((message, type = 'success', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => {
      // Max 3 toasts
      const updated = [...prev, { id, message, type }].slice(-3);
      return updated;
    });
    const timeoutId = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timeoutRefs.current.delete(id);
    }, duration);
    timeoutRefs.current.set(id, timeoutId);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const value = {
    toasts,
    toast: addToast,
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    info: (msg) => addToast(msg, 'info'),
    removeToast,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toasts toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

export const Toasts = ({ toasts = [], onRemove }) => {
  const { isMobile } = useIsMobile();
  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: isMobile ? 80 : 16,
      right: 16,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      pointerEvents: 'none',
      ...(isMobile ? { left: 16 } : {}),
    }}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`pointer-events-auto px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up min-w-[200px] max-w-[400px] ${
            toast.type === 'success' ? 'bg-green-600 text-white' :
            toast.type === 'error' ? 'bg-red-600 text-white' :
            toast.type === 'info' ? 'bg-blue-600 text-white' :
            'bg-zinc-800 text-white'
          }`}
          style={isMobile ? { maxWidth: '100%' } : undefined}
        >
          <span className="flex-shrink-0">
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span className="text-sm flex-1">{toast.message}</span>
          {onRemove && (
            <button
              onClick={() => onRemove(toast.id)}
              style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              className="ml-2 opacity-70 hover:opacity-100 flex-shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

// ============================================
// LOADING SPINNER
// ============================================
export const LoadingSpinner = ({ size = 'md', message = 'Loading...' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className={`${sizeClasses[size]} border-2 border-zinc-700 border-t-purple-500 rounded-full animate-spin`} />
      <p className="text-sm text-zinc-400">{message}</p>
    </div>
  );
};

// ============================================
// EMPTY STATE
// ============================================
export const EmptyState = ({
  icon = '📭',
  title = 'Nothing here yet',
  description = 'Get started by creating your first item.',
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction
}) => (
  <div className="bg-zinc-900/50 border border-zinc-800 border-dashed rounded-xl p-12 text-center">
    <div className="text-4xl mb-4">{icon}</div>
    <h3 className="text-lg font-semibold text-zinc-200 mb-2">{title}</h3>
    <p className="text-sm text-zinc-500 mb-6 max-w-md mx-auto">{description}</p>
    <div className="flex gap-3 justify-center">
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition"
        >
          {actionLabel}
        </button>
      )}
      {secondaryActionLabel && onSecondaryAction && (
        <button
          onClick={onSecondaryAction}
          className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-lg transition"
        >
          {secondaryActionLabel}
        </button>
      )}
    </div>
  </div>
);

// ============================================
// CONFIRM DIALOG
// ============================================
export const ConfirmDialog = ({
  isOpen,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary', // 'primary' | 'destructive'
  onConfirm,
  onCancel,
  isLoading = false
}) => {
  // BUG-030: Focus trap for modal accessibility
  const trapRef = useFocusTrap(isOpen);

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel?.();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onCancel]);

  // Prevent background scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const confirmButtonClasses = confirmVariant === 'destructive'
    ? 'bg-red-600 hover:bg-red-500 text-white'
    : 'bg-purple-600 hover:bg-purple-500 text-white';

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel?.()}
    >
      <div ref={trapRef} className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-zinc-400 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-lg transition disabled:opacity-50"
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition disabled:opacity-50 flex items-center gap-2 ${confirmButtonClasses}`}
          >
            {isLoading && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// STATUS PILL
// ============================================
export const StatusPill = ({ status, size = 'sm' }) => {
  const statusConfig = {
    // Neutral
    draft: { bg: 'bg-zinc-700', text: 'text-zinc-300', label: 'Draft' },
    pending: { bg: 'bg-zinc-700', text: 'text-zinc-300', label: 'Pending' },
    unknown: { bg: 'bg-zinc-700', text: 'text-zinc-300', label: 'Unknown' },
    // Positive
    scheduled: { bg: 'bg-green-900/50', text: 'text-green-400', label: 'Scheduled' },
    active: { bg: 'bg-green-900/50', text: 'text-green-400', label: 'Active' },
    approved: { bg: 'bg-green-900/50', text: 'text-green-400', label: 'Approved' },
    posted: { bg: 'bg-green-900/50', text: 'text-green-400', label: 'Posted' },
    published: { bg: 'bg-green-900/50', text: 'text-green-400', label: 'Posted' }, // Late uses "published"
    completed: { bg: 'bg-green-900/50', text: 'text-green-400', label: 'Completed' },
    // Warning
    'needs-attention': { bg: 'bg-yellow-900/50', text: 'text-yellow-400', label: 'Needs Attention' },
    warning: { bg: 'bg-yellow-900/50', text: 'text-yellow-400', label: 'Warning' },
    review: { bg: 'bg-yellow-900/50', text: 'text-yellow-400', label: 'In Review' },
    // Negative
    failed: { bg: 'bg-red-900/50', text: 'text-red-400', label: 'Failed' },
    error: { bg: 'bg-red-900/50', text: 'text-red-400', label: 'Error' },
    rejected: { bg: 'bg-red-900/50', text: 'text-red-400', label: 'Rejected' },
    declined: { bg: 'bg-red-900/50', text: 'text-red-400', label: 'Declined' },
  };

  const config = statusConfig[status?.toLowerCase()] || {
    bg: 'bg-zinc-700',
    text: 'text-zinc-300',
    label: status || 'Unknown'
  };

  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-xs'
    : 'px-3 py-1 text-sm';

  return (
    <span className={`${config.bg} ${config.text} ${sizeClasses} rounded-full font-medium inline-flex items-center`}>
      {config.label}
    </span>
  );
};

// ============================================
// CARD
// ============================================
export const Card = ({ children, className = '', padding = 'p-6' }) => (
  <div className={`bg-zinc-900 border border-zinc-800 rounded-xl ${padding} ${className}`}>
    {children}
  </div>
);

// ============================================
// SKELETON LOADER
// ============================================
export const Skeleton = ({ className = '', variant = 'text' }) => {
  const variants = {
    text: 'h-4 w-full',
    title: 'h-6 w-3/4',
    avatar: 'h-10 w-10 rounded-full',
    thumbnail: 'h-24 w-24 rounded-lg',
    card: 'h-32 w-full rounded-xl',
  };

  return (
    <div className={`bg-zinc-800 animate-pulse rounded ${variants[variant]} ${className}`} />
  );
};

