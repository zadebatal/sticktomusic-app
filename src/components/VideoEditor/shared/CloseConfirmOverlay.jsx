import React from 'react';
import { Button } from '../../../ui/components/Button';
import { useTheme } from '../../../contexts/ThemeContext';

/**
 * CloseConfirmOverlay — Shown when user tries to close an editor with unsaved work.
 * Used by PhotoMontageEditor, SoloClipEditor, MultiClipEditor, SlideshowEditor.
 */
const CloseConfirmOverlay = ({ onKeepEditing, onClose }) => {
  const theme = useTheme();
  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[100]">
      <div className="bg-[#171717] rounded-xl p-6 max-w-[360px] w-full border border-neutral-200">
        <h3 className="text-[16px] font-semibold mb-2" style={{ color: theme.text.primary }}>Close editor?</h3>
        <p className="text-[13px] mb-4" style={{ color: theme.text.secondary }}>
          You have unsaved work. Are you sure you want to close?
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="neutral-secondary" size="small" onClick={onKeepEditing}>Keep Editing</Button>
          <Button variant="destructive-primary" size="small" onClick={onClose}>Close Anyway</Button>
        </div>
      </div>
    </div>
  );
};

export default CloseConfirmOverlay;
