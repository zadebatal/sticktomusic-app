import React, { useState, useCallback, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import {
  subscribeToTemplates,
  saveCategory,
  deleteCategory,
  getCategoryNames
} from '../../services/contentTemplateService';
import log from '../../utils/logger';

/**
 * CaptionHashtagBank - Niche-based caption and hashtag management
 *
 * Features:
 * - Categories per niche (Fashion, Music, etc.)
 * - Always-include and pool items for hashtags and captions
 * - Real-time sync with Firestore
 * - Theme support
 */
const CaptionHashtagBank = ({
  db,
  artistId,
  compact = false,
  onBankChange
}) => {
  const { theme } = useTheme();
  const [templates, setTemplates] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [loading, setLoading] = useState(true);

  // Subscribe to real-time template updates
  useEffect(() => {
    if (!db || !artistId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToTemplates(db, artistId, (updatedTemplates) => {
      setTemplates(updatedTemplates);
      const categories = getCategoryNames(updatedTemplates);
      if (categories.length > 0 && !selectedCategory) {
        setSelectedCategory(categories[0]);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [db, artistId, selectedCategory]);

  const categories = getCategoryNames(templates);
  const currentTemplate = selectedCategory ? templates[selectedCategory] : null;

  // Hashtag handlers
  const addHashtagAlways = useCallback(async (text) => {
    if (!selectedCategory || !currentTemplate) return;
    const tag = text.startsWith('#') ? text : '#' + text;

    const updated = {
      ...currentTemplate,
      hashtags: {
        ...currentTemplate.hashtags,
        always: [...(currentTemplate.hashtags?.always || []), tag]
      }
    };

    await saveCategory(db, artistId, selectedCategory, updated);
    onBankChange?.({ categoryName: selectedCategory, hashtags: updated.hashtags, captions: updated.captions });
  }, [selectedCategory, currentTemplate, db, artistId, onBankChange]);

  const removeHashtagAlways = useCallback(async (index) => {
    if (!selectedCategory || !currentTemplate) return;

    const updated = {
      ...currentTemplate,
      hashtags: {
        ...currentTemplate.hashtags,
        always: currentTemplate.hashtags.always.filter((_, i) => i !== index)
      }
    };

    await saveCategory(db, artistId, selectedCategory, updated);
    onBankChange?.({ categoryName: selectedCategory, hashtags: updated.hashtags, captions: updated.captions });
  }, [selectedCategory, currentTemplate, db, artistId, onBankChange]);

  const addHashtagPool = useCallback(async (text) => {
    if (!selectedCategory || !currentTemplate) return;
    const tag = text.startsWith('#') ? text : '#' + text;

    const updated = {
      ...currentTemplate,
      hashtags: {
        ...currentTemplate.hashtags,
        pool: [...(currentTemplate.hashtags?.pool || []), tag]
      }
    };

    await saveCategory(db, artistId, selectedCategory, updated);
    onBankChange?.({ categoryName: selectedCategory, hashtags: updated.hashtags, captions: updated.captions });
  }, [selectedCategory, currentTemplate, db, artistId, onBankChange]);

  const removeHashtagPool = useCallback(async (index) => {
    if (!selectedCategory || !currentTemplate) return;

    const updated = {
      ...currentTemplate,
      hashtags: {
        ...currentTemplate.hashtags,
        pool: currentTemplate.hashtags.pool.filter((_, i) => i !== index)
      }
    };

    await saveCategory(db, artistId, selectedCategory, updated);
    onBankChange?.({ categoryName: selectedCategory, hashtags: updated.hashtags, captions: updated.captions });
  }, [selectedCategory, currentTemplate, db, artistId, onBankChange]);

  // Caption handlers
  const addCaptionAlways = useCallback(async (text) => {
    if (!selectedCategory || !currentTemplate) return;

    const updated = {
      ...currentTemplate,
      captions: {
        ...currentTemplate.captions,
        always: [...(currentTemplate.captions?.always || []), text]
      }
    };

    await saveCategory(db, artistId, selectedCategory, updated);
    onBankChange?.({ categoryName: selectedCategory, hashtags: updated.hashtags, captions: updated.captions });
  }, [selectedCategory, currentTemplate, db, artistId, onBankChange]);

  const removeCaptionAlways = useCallback(async (index) => {
    if (!selectedCategory || !currentTemplate) return;

    const updated = {
      ...currentTemplate,
      captions: {
        ...currentTemplate.captions,
        always: currentTemplate.captions.always.filter((_, i) => i !== index)
      }
    };

    await saveCategory(db, artistId, selectedCategory, updated);
    onBankChange?.({ categoryName: selectedCategory, hashtags: updated.hashtags, captions: updated.captions });
  }, [selectedCategory, currentTemplate, db, artistId, onBankChange]);

  const addCaptionPool = useCallback(async (text) => {
    if (!selectedCategory || !currentTemplate) return;

    const updated = {
      ...currentTemplate,
      captions: {
        ...currentTemplate.captions,
        pool: [...(currentTemplate.captions?.pool || []), text]
      }
    };

    await saveCategory(db, artistId, selectedCategory, updated);
    onBankChange?.({ categoryName: selectedCategory, hashtags: updated.hashtags, captions: updated.captions });
  }, [selectedCategory, currentTemplate, db, artistId, onBankChange]);

  const removeCaptionPool = useCallback(async (index) => {
    if (!selectedCategory || !currentTemplate) return;

    const updated = {
      ...currentTemplate,
      captions: {
        ...currentTemplate.captions,
        pool: currentTemplate.captions.pool.filter((_, i) => i !== index)
      }
    };

    await saveCategory(db, artistId, selectedCategory, updated);
    onBankChange?.({ categoryName: selectedCategory, hashtags: updated.hashtags, captions: updated.captions });
  }, [selectedCategory, currentTemplate, db, artistId, onBankChange]);

  // Category handlers
  const handleAddCategory = useCallback(async () => {
    if (!newCategoryName.trim()) return;

    const categoryName = newCategoryName.trim();
    const newTemplate = {
      hashtags: { always: [], pool: [] },
      captions: { always: [], pool: [] }
    };

    await saveCategory(db, artistId, categoryName, newTemplate);
    setNewCategoryName('');
    setShowAddCategory(false);
    setSelectedCategory(categoryName);
  }, [newCategoryName, db, artistId]);

  const handleDeleteCategory = useCallback(async () => {
    if (!selectedCategory) return;
    if (!window.confirm(`Delete "${selectedCategory}" category? This cannot be undone.`)) return;

    await deleteCategory(db, artistId, selectedCategory);
    const remaining = categories.filter(c => c !== selectedCategory);
    setSelectedCategory(remaining.length > 0 ? remaining[0] : null);
  }, [selectedCategory, categories, db, artistId]);

  if (loading) {
    return (
      <div style={getStyles(theme).empty}>
        <p style={getStyles(theme).emptyText}>Loading templates...</p>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div style={getStyles(theme).empty}>
        <p style={getStyles(theme).emptyText}>No categories yet. Create one to get started!</p>
        <button
          onClick={() => setShowAddCategory(true)}
          style={getStyles(theme).addCategoryBtn}
        >
          + Add Category
        </button>
      </div>
    );
  }

  const alwaysHashtags = currentTemplate?.hashtags?.always || [];
  const poolHashtags = currentTemplate?.hashtags?.pool || [];
  const alwaysCaptions = currentTemplate?.captions?.always || [];
  const poolCaptions = currentTemplate?.captions?.pool || [];

  return (
    <div style={getStyles(theme).container}>
      {/* Header - only show if not compact */}
      {!compact && (
        <div style={getStyles(theme).header}>
          <h3 style={getStyles(theme).title}>Caption & Hashtag Bank</h3>
          <p style={getStyles(theme).subtitle}>
            Create niche-specific captions and hashtags. Always-include items auto-apply to every post.
          </p>
        </div>
      )}

      {/* Category tabs */}
      <div style={getStyles(theme).categoryTabsContainer}>
        <div style={getStyles(theme).categoryTabs}>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                ...getStyles(theme).categoryTab,
                ...(selectedCategory === cat ? getStyles(theme).categoryTabActive : getStyles(theme).categoryTabInactive)
              }}
            >
              {cat}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAddCategory(true)}
          style={getStyles(theme).addCategoryMini}
          title="Add category"
        >
          +
        </button>
      </div>

      {/* Add category modal */}
      {showAddCategory && (
        <div style={getStyles(theme).modal}>
          <div style={getStyles(theme).modalContent}>
            <h4 style={getStyles(theme).modalTitle}>New Category</h4>
            <input
              type="text"
              placeholder="Category name (e.g., Fashion, Music)"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              style={getStyles(theme).input}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCategory();
                if (e.key === 'Escape') {
                  setShowAddCategory(false);
                  setNewCategoryName('');
                }
              }}
              autoFocus
            />
            <div style={getStyles(theme).modalButtons}>
              <button
                onClick={() => {
                  setShowAddCategory(false);
                  setNewCategoryName('');
                }}
                style={getStyles(theme).modalBtnCancel}
              >
                Cancel
              </button>
              <button
                onClick={handleAddCategory}
                style={getStyles(theme).modalBtnAdd}
                disabled={!newCategoryName.trim()}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content sections */}
      {currentTemplate && selectedCategory && (
        <div style={getStyles(theme).content}>
          {/* Hashtags section */}
          <div style={getStyles(theme).section}>
            <div style={getStyles(theme).sectionHeader}>
              <h4 style={getStyles(theme).sectionTitle}>Hashtags</h4>
              {selectedCategory && (
                <button
                  onClick={handleDeleteCategory}
                  style={getStyles(theme).deleteBtn}
                  title="Delete this category"
                >
                  🗑️
                </button>
              )}
            </div>

            {/* Always Include */}
            <div style={getStyles(theme).bankGroup}>
              <label style={getStyles(theme).bankLabel}>Always Include</label>
              <div style={getStyles(theme).chipContainer}>
                {alwaysHashtags.length > 0 ? (
                  alwaysHashtags.map((tag, i) => (
                    <span key={i} style={getStyles(theme).chipAlways}>
                      {tag}
                      <button
                        onClick={() => removeHashtagAlways(i)}
                        style={getStyles(theme).chipRemoveAlways}
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span style={getStyles(theme).emptyHint}>None yet</span>
                )}
              </div>
              <input
                type="text"
                placeholder="Add always-use hashtag..."
                style={getStyles(theme).input}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    addHashtagAlways(e.target.value.trim());
                    e.target.value = '';
                  }
                }}
              />
            </div>

            {/* Pool */}
            <div style={getStyles(theme).bankGroup}>
              <label style={getStyles(theme).bankLabel}>Random Pool</label>
              <div style={getStyles(theme).chipContainer}>
                {poolHashtags.length > 0 ? (
                  poolHashtags.map((tag, i) => (
                    <span key={i} style={getStyles(theme).chipPool}>
                      {tag}
                      <button
                        onClick={() => removeHashtagPool(i)}
                        style={getStyles(theme).chipRemovePool}
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span style={getStyles(theme).emptyHint}>None yet</span>
                )}
              </div>
              <input
                type="text"
                placeholder="Add to pool..."
                style={getStyles(theme).input}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    addHashtagPool(e.target.value.trim());
                    e.target.value = '';
                  }
                }}
              />
            </div>
          </div>

          {/* Captions section */}
          <div style={getStyles(theme).section}>
            <h4 style={getStyles(theme).sectionTitle}>Captions</h4>

            {/* Always Include */}
            <div style={getStyles(theme).bankGroup}>
              <label style={getStyles(theme).bankLabel}>Always Include</label>
              <div style={getStyles(theme).itemList}>
                {alwaysCaptions.length > 0 ? (
                  alwaysCaptions.map((cap, i) => (
                    <div key={i} style={getStyles(theme).captionItemAlways}>
                      <span>{cap}</span>
                      <button
                        onClick={() => removeCaptionAlways(i)}
                        style={getStyles(theme).captionRemoveAlways}
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <span style={getStyles(theme).emptyHint}>None yet</span>
                )}
              </div>
              <input
                type="text"
                placeholder="Add always-use caption..."
                style={getStyles(theme).input}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    addCaptionAlways(e.target.value.trim());
                    e.target.value = '';
                  }
                }}
              />
            </div>

            {/* Pool */}
            <div style={getStyles(theme).bankGroup}>
              <label style={getStyles(theme).bankLabel}>Random Pool</label>
              <div style={getStyles(theme).itemList}>
                {poolCaptions.length > 0 ? (
                  poolCaptions.map((cap, i) => (
                    <div key={i} style={getStyles(theme).captionItemPool}>
                      <span>{cap}</span>
                      <button
                        onClick={() => removeCaptionPool(i)}
                        style={getStyles(theme).captionRemovePool}
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <span style={getStyles(theme).emptyHint}>None yet</span>
                )}
              </div>
              <input
                type="text"
                placeholder="Add to pool..."
                style={getStyles(theme).input}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    addCaptionPool(e.target.value.trim());
                    e.target.value = '';
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const getStyles = (theme) => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: theme.bg.surface,
    color: theme.text.primary
  },
  header: {
    padding: '16px',
    borderBottom: `1px solid ${theme.border.default}`,
    flexShrink: 0
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: theme.text.primary
  },
  subtitle: {
    margin: '6px 0 0 0',
    fontSize: '12px',
    color: theme.text.muted
  },
  categoryTabsContainer: {
    display: 'flex',
    gap: '4px',
    padding: '8px',
    borderBottom: `1px solid ${theme.border.default}`,
    flexShrink: 0,
    overflowX: 'auto'
  },
  categoryTabs: {
    display: 'flex',
    gap: '4px',
    flex: 1
  },
  categoryTab: {
    padding: '6px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 200ms ease'
  },
  categoryTabActive: {
    backgroundColor: theme.accent.primary,
    color: '#fff'
  },
  categoryTabInactive: {
    backgroundColor: theme.bg.elevated,
    color: theme.text.secondary,
    '&:hover': {
      backgroundColor: theme.border.default
    }
  },
  addCategoryMini: {
    width: '28px',
    height: '28px',
    padding: 0,
    borderRadius: '4px',
    backgroundColor: theme.border.default,
    color: theme.text.primary,
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    transition: 'all 200ms ease',
    flexShrink: 0,
    '&:hover': {
      backgroundColor: theme.accent.primary,
      color: '#fff'
    }
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: theme.bg.surface,
    borderRadius: '8px',
    padding: '20px',
    minWidth: '300px',
    border: `1px solid ${theme.border.default}`
  },
  modalTitle: {
    margin: '0 0 16px 0',
    fontSize: '16px',
    fontWeight: '600',
    color: theme.text.primary
  },
  modalButtons: {
    display: 'flex',
    gap: '8px',
    marginTop: '16px',
    justifyContent: 'flex-end'
  },
  modalBtnCancel: {
    padding: '8px 16px',
    borderRadius: '4px',
    border: `1px solid ${theme.border.default}`,
    backgroundColor: 'transparent',
    color: theme.text.primary,
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500'
  },
  modalBtnAdd: {
    padding: '8px 16px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: theme.accent.primary,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500'
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px'
  },
  section: {
    backgroundColor: theme.bg.elevated,
    borderRadius: '6px',
    padding: '12px',
    border: `1px solid ${theme.border.default}`
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  sectionTitle: {
    margin: 0,
    fontSize: '13px',
    fontWeight: '600',
    color: theme.text.primary
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    opacity: 0.6,
    transition: 'opacity 200ms ease',
    '&:hover': {
      opacity: 1
    }
  },
  bankGroup: {
    marginBottom: '14px'
  },
  bankLabel: {
    display: 'block',
    fontSize: '10px',
    fontWeight: '600',
    color: theme.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '6px'
  },
  chipContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginBottom: '6px',
    minHeight: '24px',
    alignItems: 'flex-start'
  },
  chipAlways: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 8px',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#34d399',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
    border: '1px solid rgba(52, 211, 153, 0.3)'
  },
  chipRemoveAlways: {
    background: 'none',
    border: 'none',
    color: '#059669',
    cursor: 'pointer',
    marginLeft: '4px',
    padding: '0',
    fontSize: '12px',
    lineHeight: '1'
  },
  chipPool: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 8px',
    backgroundColor: theme.bg.surface,
    color: theme.text.secondary,
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
    border: `1px solid ${theme.border.default}`
  },
  chipRemovePool: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    cursor: 'pointer',
    marginLeft: '4px',
    padding: '0',
    fontSize: '12px',
    lineHeight: '1'
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '6px',
    minHeight: '24px'
  },
  captionItemAlways: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#34d399',
    borderRadius: '4px',
    fontSize: '12px',
    border: '1px solid rgba(52, 211, 153, 0.3)',
    wordBreak: 'break-word'
  },
  captionRemoveAlways: {
    background: 'none',
    border: 'none',
    color: '#059669',
    cursor: 'pointer',
    marginLeft: '8px',
    padding: '0',
    fontSize: '14px',
    lineHeight: '1',
    flexShrink: 0
  },
  captionItemPool: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    backgroundColor: theme.bg.surface,
    color: theme.text.secondary,
    borderRadius: '4px',
    fontSize: '12px',
    border: `1px solid ${theme.border.default}`,
    wordBreak: 'break-word'
  },
  captionRemovePool: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    cursor: 'pointer',
    marginLeft: '8px',
    padding: '0',
    fontSize: '14px',
    lineHeight: '1',
    flexShrink: 0
  },
  input: {
    width: '100%',
    padding: '6px 8px',
    backgroundColor: theme.bg.input,
    border: `1px solid ${theme.border.default}`,
    borderRadius: '4px',
    color: theme.text.primary,
    fontSize: '12px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
  },
  emptyHint: {
    fontSize: '11px',
    color: theme.text.muted,
    fontStyle: 'italic'
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    textAlign: 'center',
    height: '100%'
  },
  emptyText: {
    color: theme.text.muted,
    fontSize: '13px',
    margin: '0 0 16px 0'
  },
  addCategoryBtn: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: theme.accent.primary,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 200ms ease'
  }
});

export default CaptionHashtagBank;
