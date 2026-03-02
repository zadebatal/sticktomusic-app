import React, { useState } from 'react';
import { Button } from '../../../ui/components/Button';
import { IconButton } from '../../../ui/components/IconButton';
import { TextField } from '../../../ui/components/TextField';
import { FeatherArrowLeft, FeatherRotateCcw, FeatherRotateCw, FeatherSave, FeatherDownload, FeatherHelpCircle } from '@subframe/core';
import KeyboardShortcutsOverlay from './KeyboardShortcutsOverlay';

/**
 * EditorTopBar — shared top bar for all video editors.
 * Back button, title field, undo/redo, save, export, keyboard shortcuts help.
 */
const EditorTopBar = ({
  title,
  onTitleChange,
  placeholder = 'Untitled Video',
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onSave,
  onExport,
  onBack,
  isMobile = false,
  exportDisabled = false,
  exportLoading = false,
  exportLabel = 'Export',
  saveLabel = 'Save',
  rightExtra = null
}) => {
  const [showShortcuts, setShowShortcuts] = useState(false);

  return (
    <>
      <div className="flex w-full items-center justify-between border-b border-neutral-200 bg-black px-6 py-4">
        <div className="flex items-center gap-4">
          <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherArrowLeft />} aria-label="Back" onClick={onBack} />
          {!isMobile && (
            <TextField className="w-80" variant="filled" label="" helpText="">
              <TextField.Input placeholder={placeholder} value={title} onChange={(e) => onTitleChange(e.target.value)} />
            </TextField>
          )}
        </div>
        <div className="flex items-center gap-3">
          <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherRotateCcw />} disabled={!canUndo} onClick={onUndo} title="Undo (⌘Z)" />
          <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherRotateCw />} disabled={!canRedo} onClick={onRedo} title="Redo (⌘⇧Z)" />
          {rightExtra}
          <IconButton
            variant="neutral-tertiary"
            size="medium"
            icon={<FeatherHelpCircle />}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            onClick={() => setShowShortcuts(true)}
          />
          <Button variant="neutral-secondary" size="medium" icon={<FeatherSave />} onClick={onSave}>{saveLabel}</Button>
          <Button variant="brand-primary" size="medium" icon={<FeatherDownload />} onClick={onExport} disabled={exportDisabled} loading={exportLoading}>
            {exportLabel}
          </Button>
        </div>
      </div>
      <KeyboardShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </>
  );
};

export default EditorTopBar;
