/**
 * TextBankPanel - Shared editable text bank component
 * Used in LibraryBrowser and StudioHome for managing text banks
 */
import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { getTextBankText, getTextBankStyle } from '../../services/libraryService';

const TextBankPanel = ({ bankNum, label, color, texts, onAdd, onRemove, onUpdate, onDelete }) => {
  const { theme } = useTheme();
  const [newText, setNewText] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');

  return (
    <div style={{
      flex: '1 1 auto', display: 'flex', flexDirection: 'column',
      borderRadius: '10px', border: `1px solid ${theme.border.subtle}`,
      minHeight: '140px', maxHeight: '320px'
    }}>
      <div style={{
        padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${theme.border.subtle}`, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            width: '18px', height: '18px', borderRadius: '4px',
            backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', fontWeight: 700, color: '#000'
          }}>{bankNum}</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color }}>{label}</span>
          <span style={{ fontSize: '11px', color: theme.text.muted }}>{texts.length}</span>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            style={{
              padding: '4px 8px', fontSize: '11px',
              backgroundColor: 'transparent', border: `1px solid ${theme.border.subtle}`,
              borderRadius: '4px', color: theme.text.muted, cursor: 'pointer',
              transition: 'all 0.2s', display: 'flex', alignItems: 'center'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)';
              e.currentTarget.style.color = '#fca5a5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = theme.border.subtle;
              e.currentTarget.style.color = theme.text.muted;
            }}
            title={`Delete ${label}`}
          >✕</button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {texts.length === 0 ? (
          <div style={{ padding: '12px', textAlign: 'center', color: theme.text.muted, fontSize: '11px' }}>
            No text lines yet. Add some below.
          </div>
        ) : texts.map((entry, i) => {
          const displayText = getTextBankText(entry);
          const entryStyle = getTextBankStyle(entry);
          return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px',
            borderRadius: '6px', marginBottom: '4px',
            backgroundColor: theme.hover.bg,
            fontSize: '12px', color: theme.text.secondary
          }}>
            {editingIndex === i ? (
              <input
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const updated = [...texts];
                    updated[i] = entryStyle ? { text: editText, style: entryStyle } : editText;
                    onUpdate(updated);
                    setEditingIndex(null);
                  }
                  if (e.key === 'Escape') setEditingIndex(null);
                }}
                onBlur={() => {
                  const updated = [...texts];
                  updated[i] = entryStyle ? { text: editText, style: entryStyle } : editText;
                  onUpdate(updated);
                  setEditingIndex(null);
                }}
                autoFocus
                style={{
                  flex: 1, background: theme.bg.page, border: `1px solid ${theme.accent.primary}66`,
                  borderRadius: '4px', padding: '2px 6px', color: theme.text.primary, fontSize: '12px'
                }}
              />
            ) : (
              <span
                style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={() => { setEditingIndex(i); setEditText(displayText); }}
                title="Click to edit"
              >
                {entryStyle && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: entryStyle.color || color, flexShrink: 0 }} />}
                {displayText}
              </span>
            )}
            <button
              onClick={() => onRemove(i)}
              style={{
                background: 'none', border: 'none', color: theme.text.muted,
                cursor: 'pointer', fontSize: '16px', padding: '4px 8px', flexShrink: 0, minWidth: '32px', minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              title="Remove"
            >×</button>
          </div>
          );
        })}
      </div>
      {/* Add new text input */}
      <div style={{
        padding: '8px', borderTop: `1px solid ${theme.border.subtle}`,
        display: 'flex', gap: '6px', flexShrink: 0
      }}>
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newText.trim()) {
              onAdd(newText.trim());
              setNewText('');
            }
          }}
          placeholder={`Add ${label.toLowerCase()} line...`}
          style={{
            flex: 1, padding: '6px 10px', borderRadius: '6px',
            border: `1px solid ${theme.border.subtle}`, backgroundColor: theme.bg.page,
            color: theme.text.primary, fontSize: '12px'
          }}
        />
        <button
          onClick={() => { if (newText.trim()) { onAdd(newText.trim()); setNewText(''); } }}
          disabled={!newText.trim()}
          style={{
            padding: '6px 12px', borderRadius: '6px', border: 'none',
            backgroundColor: newText.trim() ? `${theme.accent.primary}4d` : theme.hover.bg,
            color: newText.trim() ? theme.accent.hover : theme.text.muted,
            fontSize: '12px', cursor: newText.trim() ? 'pointer' : 'default'
          }}
        >+</button>
      </div>
    </div>
  );
};

export default TextBankPanel;
