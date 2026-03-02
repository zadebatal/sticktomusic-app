import React, { useEffect, useRef } from 'react';
import { IconButton } from '../../../ui/components/IconButton';
import { FeatherX } from '@subframe/core';

const SHORTCUT_CATEGORIES = [
  {
    title: 'Playback',
    shortcuts: [
      { keys: ['Space'], description: 'Play / Pause' },
      { keys: ['\u2190'], description: 'Back 1 second' },
      { keys: ['\u2192'], description: 'Forward 1 second' },
      { keys: ['Shift', '\u2190'], description: 'Back 5 seconds' },
      { keys: ['Shift', '\u2192'], description: 'Forward 5 seconds' },
    ],
  },
  {
    title: 'Editing (Clipper)',
    shortcuts: [
      { keys: ['I'], description: 'Mark In point' },
      { keys: ['O'], description: 'Mark Out point' },
      { keys: ['Enter'], description: 'Create clip from selection' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['\u2318/Ctrl', 'Z'], description: 'Undo' },
      { keys: ['\u2318/Ctrl', 'Shift', 'Z'], description: 'Redo' },
      { keys: ['\u2318/Ctrl', 'S'], description: 'Save' },
      { keys: ['Esc'], description: 'Close / Back' },
    ],
  },
];

const KeyBadge = ({ children }) => (
  <span className="inline-flex items-center justify-center rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono text-neutral-200 border border-zinc-700 min-w-[24px]">
    {children}
  </span>
);

const KeyboardShortcutsOverlay = ({ open, onClose }) => {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-xl bg-[#111118] border border-neutral-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold text-white">Keyboard Shortcuts</h2>
          <IconButton
            variant="neutral-tertiary"
            size="small"
            icon={<FeatherX />}
            aria-label="Close"
            onClick={onClose}
          />
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-5">
          {SHORTCUT_CATEGORIES.map((category) => (
            <div key={category.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                {category.title}
              </h3>
              <div className="space-y-1.5">
                {category.shortcuts.map((shortcut, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm text-neutral-300">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-1 ml-4 shrink-0">
                      {shortcut.keys.map((key, ki) => (
                        <React.Fragment key={ki}>
                          {ki > 0 && (
                            <span className="text-xs text-neutral-500 mx-0.5">+</span>
                          )}
                          <KeyBadge>{key}</KeyBadge>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsOverlay;
