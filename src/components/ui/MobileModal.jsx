import React, { useEffect, useRef } from 'react';
import useIsMobile from '../../hooks/useIsMobile';

/**
 * MobileModal — Responsive modal wrapper.
 * Desktop: centered card with backdrop (same as current modals).
 * Mobile: full-screen with safe-area insets for notch/home indicator.
 *
 * Props:
 *   open      — boolean
 *   onClose   — callback to close
 *   title     — optional header title
 *   children  — modal content
 *   maxWidth  — desktop max width (default 640px)
 */
const MobileModal = ({ open, onClose, title, children, maxWidth = 640 }) => {
  const { isMobile } = useIsMobile();
  const contentRef = useRef(null);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  // Mobile: full-screen
  if (isMobile) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: '#111118',
        display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#fff', margin: 0 }}>
            {title || ''}
          </h2>
          <button
            onClick={onClose}
            style={{
              width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.6)', fontSize: 22, cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div ref={contentRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {children}
        </div>
      </div>
    );
  }

  // Desktop: centered card
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        ref={contentRef}
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.1)',
          maxWidth,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)',
            flexShrink: 0,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#fff', margin: 0 }}>
              {title}
            </h2>
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'transparent', border: 'none',
                color: 'rgba(255,255,255,0.5)', fontSize: 18, cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default MobileModal;
