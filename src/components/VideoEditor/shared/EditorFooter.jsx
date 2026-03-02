import React from 'react';
import { Button } from '../../../ui/components/Button';

/**
 * EditorFooter — shared footer bar for all video editors.
 * Auto-saved timestamp on left, Cancel + Save All on right.
 */
const EditorFooter = ({
  lastSaved = null,
  onCancel,
  onSaveAll,
  isSavingAll = false,
  saveAllCount = 0,
  saveLabel
}) => (
  <div className="flex items-center justify-between px-6 py-3 border-t border-neutral-200">
    <div className="flex items-center gap-3">
      {lastSaved && (
        <span className="text-[11px] text-green-400 flex items-center gap-1">
          ✓ Auto-saved {lastSaved.toLocaleTimeString()}
        </span>
      )}
    </div>
    <div className="flex items-center gap-3">
      <Button variant="neutral-secondary" size="medium" onClick={onCancel}>Cancel</Button>
      {saveAllCount > 1 ? (
        <Button variant="brand-primary" size="medium" onClick={onSaveAll} disabled={isSavingAll}>
          {isSavingAll ? 'Saving...' : `Save All (${saveAllCount})`}
        </Button>
      ) : (
        <Button variant="brand-primary" size="medium" onClick={onSaveAll} disabled={isSavingAll}>
          {isSavingAll ? 'Saving...' : (saveLabel || 'Save')}
        </Button>
      )}
    </div>
  </div>
);

export default EditorFooter;
