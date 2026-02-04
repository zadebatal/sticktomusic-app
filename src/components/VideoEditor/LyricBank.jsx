import React, { useState, useCallback, useRef, useEffect } from 'react';

/**
 * LyricBank - Full song lyrics storage with paragraph/line selection
 *
 * Features:
 * - Store multiple lyric entries (full songs)
 * - Click-drag to select multiple lines/paragraphs
 * - Use selected text as overlays in Video or Slideshow editors
 */

const LyricBank = ({
  lyrics = [],
  onAddLyrics,
  onUpdateLyrics,
  onDeleteLyrics,
  onSelectText, // Callback when text is selected for use
  compact = false, // Compact mode for sidebar display
  showAddForm = true
}) => {
  const [expandedLyricsId, setExpandedLyricsId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [selectedLines, setSelectedLines] = useState([]);
  const [dragStart, setDragStart] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // Handle adding new lyrics
  const handleAdd = useCallback(() => {
    if (!newTitle.trim() && !newContent.trim()) return;

    onAddLyrics?.({
      title: newTitle.trim() || 'Untitled',
      content: newContent.trim()
    });

    setNewTitle('');
    setNewContent('');
    setIsAdding(false);
  }, [newTitle, newContent, onAddLyrics]);

  // Handle updating lyrics
  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;

    onUpdateLyrics?.(editingId, {
      title: editTitle.trim() || 'Untitled',
      content: editContent.trim()
    });

    setEditingId(null);
    setEditTitle('');
    setEditContent('');
  }, [editingId, editTitle, editContent, onUpdateLyrics]);

  // Start editing
  const startEdit = useCallback((lyric) => {
    setEditingId(lyric.id);
    setEditTitle(lyric.title);
    setEditContent(lyric.content);
  }, []);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
  }, []);

  // Handle line selection with click-drag
  const handleLineMouseDown = useCallback((lyricsId, lineIndex) => {
    setExpandedLyricsId(lyricsId);
    setDragStart(lineIndex);
    setSelectedLines([lineIndex]);
  }, []);

  const handleLineMouseEnter = useCallback((lineIndex) => {
    if (dragStart !== null) {
      const start = Math.min(dragStart, lineIndex);
      const end = Math.max(dragStart, lineIndex);
      const newSelection = [];
      for (let i = start; i <= end; i++) {
        newSelection.push(i);
      }
      setSelectedLines(newSelection);
    }
  }, [dragStart]);

  const handleMouseUp = useCallback(() => {
    setDragStart(null);
  }, []);

  // Use selected text
  const handleUseSelected = useCallback((lyric) => {
    if (selectedLines.length === 0) return;

    const lines = lyric.content.split('\n');
    const selectedText = selectedLines
      .sort((a, b) => a - b)
      .map(i => lines[i])
      .filter(Boolean)
      .join('\n');

    onSelectText?.(selectedText);
    setSelectedLines([]);
  }, [selectedLines, onSelectText]);

  // Global mouse up listener
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  if (compact) {
    return (
      <div style={compactStyles.container}>
        <div style={compactStyles.header}>
          <span style={compactStyles.title}>📝 Lyrics</span>
          <span style={compactStyles.count}>{lyrics.length}</span>
        </div>

        {lyrics.length === 0 ? (
          <div style={compactStyles.empty}>No lyrics saved</div>
        ) : (
          <div style={compactStyles.list}>
            {lyrics.map(lyric => (
              <div
                key={lyric.id}
                style={compactStyles.item}
                onClick={() => setExpandedLyricsId(expandedLyricsId === lyric.id ? null : lyric.id)}
              >
                <span style={compactStyles.itemTitle}>{lyric.title}</span>
                <span style={compactStyles.itemPreview}>
                  {lyric.content.split('\n')[0]?.slice(0, 30)}...
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.container} onMouseUp={handleMouseUp}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <path d="M14 2v6h6"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <line x1="10" y1="9" x2="8" y2="9"/>
          </svg>
          <h3 style={styles.title}>Lyric Bank</h3>
          <span style={styles.count}>({lyrics.length})</span>
        </div>

        {showAddForm && !isAdding && (
          <button style={styles.addButton} onClick={() => setIsAdding(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Lyrics
          </button>
        )}
      </div>

      {/* Add New Lyrics Form */}
      {isAdding && (
        <div style={styles.addForm}>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Song title..."
            style={styles.titleInput}
            autoFocus
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Paste lyrics here..."
            style={styles.contentTextarea}
            rows={8}
          />
          <div style={styles.addFormActions}>
            <button style={styles.cancelButton} onClick={() => setIsAdding(false)}>
              Cancel
            </button>
            <button
              style={styles.saveButton}
              onClick={handleAdd}
              disabled={!newContent.trim()}
            >
              Save Lyrics
            </button>
          </div>
        </div>
      )}

      {/* Lyrics List */}
      <div style={styles.lyricsList}>
        {lyrics.length === 0 && !isAdding ? (
          <div style={styles.emptyState}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <path d="M14 2v6h6"/>
            </svg>
            <p>No lyrics yet</p>
            <p style={styles.emptyHint}>Add song lyrics to use in your content</p>
          </div>
        ) : (
          lyrics.map(lyric => (
            <div key={lyric.id} style={styles.lyricCard}>
              {/* Card Header */}
              <div
                style={styles.lyricHeader}
                onClick={() => setExpandedLyricsId(expandedLyricsId === lyric.id ? null : lyric.id)}
              >
                <div style={styles.lyricTitleRow}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      transform: expandedLyricsId === lyric.id ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s'
                    }}
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                  <span style={styles.lyricTitle}>{lyric.title}</span>
                </div>
                <div style={styles.lyricActions}>
                  <button
                    style={styles.actionBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(lyric);
                    }}
                    title="Edit"
                  >
                    ✏️
                  </button>
                  <button
                    style={styles.actionBtnDanger}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete these lyrics?')) {
                        onDeleteLyrics?.(lyric.id);
                      }
                    }}
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Expanded Content - Line Selection */}
              {expandedLyricsId === lyric.id && editingId !== lyric.id && (
                <div style={styles.lyricContent}>
                  <div style={styles.selectionHint}>
                    Click and drag to select lines, then click "Use Selected"
                  </div>

                  <div style={styles.linesContainer}>
                    {lyric.content.split('\n').map((line, lineIndex) => (
                      <div
                        key={lineIndex}
                        style={{
                          ...styles.lyricLine,
                          ...(selectedLines.includes(lineIndex) && expandedLyricsId === lyric.id
                            ? styles.lyricLineSelected
                            : {}),
                          ...(line.trim() === '' ? styles.lyricLineEmpty : {})
                        }}
                        onMouseDown={() => handleLineMouseDown(lyric.id, lineIndex)}
                        onMouseEnter={() => handleLineMouseEnter(lineIndex)}
                      >
                        <span style={styles.lineNumber}>{lineIndex + 1}</span>
                        <span style={styles.lineText}>{line || '\u00A0'}</span>
                      </div>
                    ))}
                  </div>

                  {selectedLines.length > 0 && onSelectText && (
                    <div style={styles.selectionActions}>
                      <span style={styles.selectionCount}>
                        {selectedLines.length} line{selectedLines.length !== 1 ? 's' : ''} selected
                      </span>
                      <button
                        style={styles.useSelectedBtn}
                        onClick={() => handleUseSelected(lyric)}
                      >
                        Use Selected
                      </button>
                      <button
                        style={styles.clearSelectionBtn}
                        onClick={() => setSelectedLines([])}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Edit Form */}
              {editingId === lyric.id && (
                <div style={styles.editForm}>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={styles.titleInput}
                    placeholder="Song title..."
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    style={styles.contentTextarea}
                    rows={10}
                  />
                  <div style={styles.editFormActions}>
                    <button style={styles.cancelButton} onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button style={styles.saveButton} onClick={handleSaveEdit}>
                      Save Changes
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// Main styles
const styles = {
  container: {
    backgroundColor: '#111118',
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid #1f1f2e',
    userSelect: 'none'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  title: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#fff',
    margin: 0
  },
  count: {
    fontSize: '13px',
    color: '#6b7280'
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500'
  },
  addForm: {
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px'
  },
  titleInput: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    marginBottom: '12px',
    outline: 'none'
  },
  contentTextarea: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'monospace',
    resize: 'vertical',
    outline: 'none',
    lineHeight: '1.6'
  },
  addFormActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '12px'
  },
  cancelButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px'
  },
  saveButton: {
    padding: '8px 16px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500'
  },
  lyricsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    color: '#6b7280',
    textAlign: 'center'
  },
  emptyHint: {
    fontSize: '12px',
    color: '#4b5563',
    marginTop: '4px'
  },
  lyricCard: {
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  lyricHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    cursor: 'pointer',
    borderBottom: '1px solid transparent'
  },
  lyricTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  lyricTitle: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#fff'
  },
  lyricActions: {
    display: 'flex',
    gap: '4px'
  },
  actionBtn: {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  actionBtnDanger: {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  lyricContent: {
    padding: '0 16px 16px 16px'
  },
  selectionHint: {
    fontSize: '11px',
    color: '#6b7280',
    marginBottom: '8px',
    fontStyle: 'italic'
  },
  linesContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: '6px',
    padding: '8px',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  lyricLine: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '4px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background-color 0.1s'
  },
  lyricLineSelected: {
    backgroundColor: 'rgba(124, 58, 237, 0.3)',
    color: '#fff'
  },
  lyricLineEmpty: {
    minHeight: '20px'
  },
  lineNumber: {
    fontSize: '10px',
    color: '#4b5563',
    width: '24px',
    textAlign: 'right',
    flexShrink: 0,
    paddingTop: '2px'
  },
  lineText: {
    fontSize: '13px',
    color: '#d1d5db',
    lineHeight: '1.5',
    wordBreak: 'break-word'
  },
  selectionActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginTop: '12px',
    padding: '8px 12px',
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    borderRadius: '6px'
  },
  selectionCount: {
    fontSize: '12px',
    color: '#a78bfa'
  },
  useSelectedBtn: {
    padding: '6px 12px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500'
  },
  clearSelectionBtn: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    border: '1px solid #4b5563',
    borderRadius: '4px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '12px'
  },
  editForm: {
    padding: '16px',
    borderTop: '1px solid #1f1f2e'
  },
  editFormActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '12px'
  }
};

// Compact styles for sidebar
const compactStyles = {
  container: {
    padding: '12px'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px'
  },
  title: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#9ca3af'
  },
  count: {
    fontSize: '11px',
    color: '#6b7280',
    backgroundColor: '#1f1f2e',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  empty: {
    fontSize: '11px',
    color: '#4b5563',
    textAlign: 'center',
    padding: '8px'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  item: {
    padding: '8px',
    backgroundColor: '#0a0a0f',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  itemTitle: {
    display: 'block',
    fontSize: '12px',
    fontWeight: '500',
    color: '#fff',
    marginBottom: '2px'
  },
  itemPreview: {
    fontSize: '10px',
    color: '#6b7280'
  }
};

export default LyricBank;
