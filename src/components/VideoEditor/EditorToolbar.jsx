import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * EditorToolbar — Shared bottom toolbar for all video editors.
 * Replicates SlideshowEditor's 7-button toolbar as a reusable component.
 *
 * Each button shows/hides based on whether its callback prop is provided.
 */
const EditorToolbar = ({
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onReroll = null,
  rerollDisabled = false,
  onAddText = null,
  onDelete = null,
  audioTracks = [],
  onSelectAudio,
  onUploadAudio,
  lyrics = [],
  onSelectLyric,
  onAddNewLyrics
}) => {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  // Dropdown state
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [showLyricPicker, setShowLyricPicker] = useState(false);

  // Click-outside dismiss
  const audioRef = useRef(null);
  const lyricRef = useRef(null);

  useEffect(() => {
    if (!showAudioPicker && !showLyricPicker) return;
    const handleClick = (e) => {
      if (showAudioPicker && audioRef.current && !audioRef.current.contains(e.target)) {
        setShowAudioPicker(false);
      }
      if (showLyricPicker && lyricRef.current && !lyricRef.current.contains(e.target)) {
        setShowLyricPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAudioPicker, showLyricPicker]);

  return (
    <div style={styles.toolbar}>
      {/* Undo */}
      <button
        style={{ ...styles.greenButton, opacity: canUndo ? 1 : 0.35, pointerEvents: canUndo ? 'auto' : 'none' }}
        onClick={onUndo}
        title="Undo (⌘Z)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H3"/>
          <path d="M7 6l-4 4 4 4"/>
        </svg>
        Undo
      </button>

      {/* Redo */}
      <button
        style={{ ...styles.greenButton, opacity: canRedo ? 1 : 0.35, pointerEvents: canRedo ? 'auto' : 'none' }}
        onClick={onRedo}
        title="Redo (⌘⇧Z)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 10H11a5 5 0 00-5 5v0a5 5 0 005 5h10"/>
          <path d="M17 6l4 4-4 4"/>
        </svg>
        Redo
      </button>

      {/* Reroll */}
      {onReroll && (
        <button
          style={{ ...styles.greenButton, opacity: rerollDisabled ? 0.35 : 1, pointerEvents: rerollDisabled ? 'none' : 'auto' }}
          onClick={onReroll}
          disabled={rerollDisabled}
          title="Replace with random clip from bank"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6"/>
            <path d="M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/>
            <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/>
          </svg>
          Reroll
        </button>
      )}

      {/* Add Text */}
      {onAddText && (
        <button style={styles.addTextButton} onClick={onAddText} title="Add text overlay">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add Text
        </button>
      )}

      {/* Delete */}
      {onDelete && (
        <button
          onClick={onDelete}
          style={styles.deleteButton}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'; }}
          title="Delete"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete
        </button>
      )}

      {/* Audio dropdown */}
      {onSelectAudio && (
        <div style={{ position: 'relative' }} ref={audioRef}>
          <button
            style={styles.audioButton}
            onClick={() => { setShowAudioPicker(!showAudioPicker); setShowLyricPicker(false); }}
            title="Add audio"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            Audio
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {showAudioPicker && (
            <div style={styles.audioPickerDropdown}>
              <div style={styles.audioPickerHeader}>Select Audio</div>
              {audioTracks.length > 0 ? (
                <div style={styles.audioPickerList}>
                  {audioTracks.map(audio => (
                    <button
                      key={audio.id}
                      style={styles.audioPickerItem}
                      onClick={() => { onSelectAudio(audio); setShowAudioPicker(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                      </svg>
                      <span style={styles.audioPickerItemName}>{audio.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={styles.audioPickerEmpty}>No audio in library</div>
              )}
              <div style={styles.audioPickerDivider} />
              {onUploadAudio && (
                <button
                  style={styles.audioPickerUpload}
                  onClick={() => { onUploadAudio(); setShowAudioPicker(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Upload New Audio
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lyrics dropdown */}
      {onSelectLyric && (
        <div style={{ position: 'relative' }} ref={lyricRef}>
          <button
            style={styles.lyricButton}
            onClick={() => { setShowLyricPicker(!showLyricPicker); setShowAudioPicker(false); }}
            title="Add lyrics"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <path d="M14 2v6h6"/>
            </svg>
            Lyrics
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {showLyricPicker && (
            <div style={styles.lyricBankDropdown}>
              <div style={styles.lyricBankDropdownHeader}>SELECT LYRICS</div>
              <div style={styles.lyricBankDropdownList}>
                {lyrics.length === 0 ? (
                  <div style={styles.lyricBankDropdownEmpty}>No lyrics in bank yet</div>
                ) : (
                  lyrics.map((lyric) => (
                    <div
                      key={lyric.id}
                      style={styles.lyricBankDropdownItem}
                      onClick={() => { onSelectLyric(lyric); setShowLyricPicker(false); }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.3)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)'; }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.6 }}>
                        <path d="M9 18V5l12-2v13"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                      </svg>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lyric.title || lyric.content?.slice(0, 30) || 'Untitled'}
                      </span>
                    </div>
                  ))
                )}
              </div>
              {onAddNewLyrics && (
                <div
                  style={styles.lyricBankDropdownAddNew}
                  onClick={() => { onAddNewLyrics(); setShowLyricPicker(false); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  <span>Add New Lyrics</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const getStyles = (theme) => ({
  toolbar: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '4px 12px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0
  },
  greenButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    border: '1px solid rgba(16, 185, 129, 0.5)',
    borderRadius: '6px',
    color: '#6ee7b7',
    cursor: 'pointer',
    fontSize: '11px'
  },
  addTextButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: `${theme.accent.primary}26`,
    border: `1px solid ${theme.accent.primary}66`,
    borderRadius: '6px',
    color: theme.accent.hover,
    cursor: 'pointer',
    fontSize: '11px'
  },
  deleteButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    background: 'rgba(239, 68, 68, 0.1)',
    color: '#f87171',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all 0.15s'
  },
  audioButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'rgba(251, 146, 60, 0.2)',
    border: '1px solid rgba(251, 146, 60, 0.5)',
    borderRadius: '6px',
    color: '#fdba74',
    cursor: 'pointer',
    fontSize: '11px'
  },
  audioPickerDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginBottom: '8px',
    width: '220px',
    backgroundColor: theme.bg.elevated,
    border: `1px solid ${theme.border.default}`,
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    overflow: 'hidden'
  },
  audioPickerHeader: {
    padding: '10px 12px',
    fontSize: '11px',
    fontWeight: '600',
    color: theme.text.secondary,
    textTransform: 'uppercase',
    borderBottom: `1px solid ${theme.border.default}`
  },
  audioPickerList: {
    maxHeight: '150px',
    overflowY: 'auto'
  },
  audioPickerItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left',
    transition: 'background-color 0.15s'
  },
  audioPickerItemName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  audioPickerEmpty: {
    padding: '16px 12px',
    fontSize: '12px',
    color: theme.text.muted,
    textAlign: 'center'
  },
  audioPickerDivider: {
    height: '1px',
    backgroundColor: theme.border.default,
    margin: '4px 0'
  },
  audioPickerUpload: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#fdba74',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left',
    transition: 'background-color 0.15s'
  },
  lyricButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    border: '1px solid rgba(139, 92, 246, 0.5)',
    borderRadius: '6px',
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: '11px'
  },
  lyricBankDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: '0',
    marginBottom: '8px',
    minWidth: '220px',
    maxHeight: '300px',
    backgroundColor: 'rgba(30, 27, 46, 0.98)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: '12px',
    boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)',
    zIndex: 1000,
    overflow: 'hidden'
  },
  lyricBankDropdownHeader: {
    padding: '10px 14px',
    fontSize: '11px',
    fontWeight: '600',
    color: 'rgba(196, 181, 253, 0.6)',
    letterSpacing: '0.5px',
    borderBottom: '1px solid rgba(139, 92, 246, 0.2)'
  },
  lyricBankDropdownList: {
    maxHeight: '200px',
    overflowY: 'auto'
  },
  lyricBankDropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#e9d5ff',
    cursor: 'pointer',
    background: 'rgba(139, 92, 246, 0.1)',
    borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
    transition: 'background 0.15s'
  },
  lyricBankDropdownEmpty: {
    padding: '16px 14px',
    fontSize: '12px',
    color: 'rgba(196, 181, 253, 0.5)',
    textAlign: 'center',
    fontStyle: 'italic'
  },
  lyricBankDropdownAddNew: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 14px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#6ee7b7',
    cursor: 'pointer',
    borderTop: '1px solid rgba(139, 92, 246, 0.2)',
    transition: 'background 0.15s'
  }
});

export default EditorToolbar;
