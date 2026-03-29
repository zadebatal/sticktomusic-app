import React from 'react';

/**
 * EditorShell — shared overlay + container wrapper for all video editors.
 * Provides the fixed overlay backdrop and fullscreen inner container.
 */
const EditorShell = ({ children, onBackdropClick, isMobile }) => (
  <div
    className={`fixed inset-0 bg-black/80 flex items-center justify-center z-[1000] ${isMobile ? 'p-0' : 'p-5'}`}
    onClick={(e) => e.target === e.currentTarget && onBackdropClick?.()}
    role="dialog"
    aria-modal="true"
  >
    <div
      className="w-full h-screen bg-black flex flex-col overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  </div>
);

export default EditorShell;
