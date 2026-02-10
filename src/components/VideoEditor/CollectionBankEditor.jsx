import React, { useState, useCallback, useEffect } from 'react';
import {
  getCollectionCaptionBank,
  getCollectionHashtagBank,
  updateCollectionCaptionBank,
  updateCollectionHashtagBank,
  saveCollectionToFirestore
} from '../../services/libraryService';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * CollectionBankEditor - Edit caption and hashtag banks for a collection
 * Used in StudioHome "Captions/Hashtags" tab and ScheduleQueue sidebar
 */
const CollectionBankEditor = ({
  collection,
  artistId,
  db = null,
  onBankChange,
  compact = false // When true, uses smaller layout for sidebar
}) => {
  const { theme } = useTheme();
  const [captionBank, setCaptionBank] = useState(() => getCollectionCaptionBank(collection));
  const [hashtagBank, setHashtagBank] = useState(() => getCollectionHashtagBank(collection));

  const styles = getStyles(theme);

  // Sync when collection changes
  useEffect(() => {
    setCaptionBank(getCollectionCaptionBank(collection));
    setHashtagBank(getCollectionHashtagBank(collection));
  }, [collection?.id, collection?.captionBank, collection?.hashtagBank]);

  // Save and notify parent
  const saveCaptionBank = useCallback((updated) => {
    setCaptionBank(updated);
    updateCollectionCaptionBank(artistId, collection.id, updated);
    // Sync to Firestore
    if (db && artistId && collection) {
      saveCollectionToFirestore(db, artistId, { ...collection, captionBank: updated });
    }
    onBankChange?.();
  }, [artistId, db, collection, onBankChange]);

  const saveHashtagBank = useCallback((updated) => {
    setHashtagBank(updated);
    updateCollectionHashtagBank(artistId, collection.id, updated);
    // Sync to Firestore
    if (db && artistId && collection) {
      saveCollectionToFirestore(db, artistId, { ...collection, hashtagBank: updated });
    }
    onBankChange?.();
  }, [artistId, db, collection, onBankChange]);

  // Caption handlers
  const addCaptionAlways = useCallback((text) => {
    const updated = { ...captionBank, always: [...captionBank.always, text] };
    saveCaptionBank(updated);
  }, [captionBank, saveCaptionBank]);

  const removeCaptionAlways = useCallback((index) => {
    const updated = { ...captionBank, always: captionBank.always.filter((_, i) => i !== index) };
    saveCaptionBank(updated);
  }, [captionBank, saveCaptionBank]);

  const addCaptionPool = useCallback((text) => {
    const updated = { ...captionBank, pool: [...captionBank.pool, text] };
    saveCaptionBank(updated);
  }, [captionBank, saveCaptionBank]);

  const removeCaptionPool = useCallback((index) => {
    const updated = { ...captionBank, pool: captionBank.pool.filter((_, i) => i !== index) };
    saveCaptionBank(updated);
  }, [captionBank, saveCaptionBank]);

  // Hashtag handlers
  const addHashtagAlways = useCallback((text) => {
    const tag = text.startsWith('#') ? text : '#' + text;
    const updated = { ...hashtagBank, always: [...hashtagBank.always, tag] };
    saveHashtagBank(updated);
  }, [hashtagBank, saveHashtagBank]);

  const removeHashtagAlways = useCallback((index) => {
    const updated = { ...hashtagBank, always: hashtagBank.always.filter((_, i) => i !== index) };
    saveHashtagBank(updated);
  }, [hashtagBank, saveHashtagBank]);

  const addHashtagPool = useCallback((text) => {
    const tag = text.startsWith('#') ? text : '#' + text;
    const updated = { ...hashtagBank, pool: [...hashtagBank.pool, tag] };
    saveHashtagBank(updated);
  }, [hashtagBank, saveHashtagBank]);

  const removeHashtagPool = useCallback((index) => {
    const updated = { ...hashtagBank, pool: hashtagBank.pool.filter((_, i) => i !== index) };
    saveHashtagBank(updated);
  }, [hashtagBank, saveHashtagBank]);

  if (!collection) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>Select a collection to manage its caption and hashtag banks.</p>
      </div>
    );
  }

  return (
    <div style={compact ? styles.containerCompact : styles.container}>
      {!compact && (
        <div style={styles.header}>
          <h3 style={styles.title}>Captions & Hashtags</h3>
          <p style={styles.subtitle}>
            Banks for <strong>{collection.name}</strong> — used when scheduling posts from this collection
          </p>
        </div>
      )}

      <div style={compact ? styles.sectionsCompact : styles.sections}>
        {/* HASHTAGS */}
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Hashtags</h4>

          {/* Always Include */}
          <div style={styles.bankGroup}>
            <label style={styles.bankLabel}>Always Include</label>
            <div style={styles.tagList}>
              {hashtagBank.always.map((tag, i) => (
                <span key={i} style={styles.tagAlways}>
                  {tag}
                  <button onClick={() => removeHashtagAlways(i)} style={styles.tagRemoveAlways}>×</button>
                </span>
              ))}
              {hashtagBank.always.length === 0 && (
                <span style={styles.emptyHint}>None yet</span>
              )}
            </div>
            <input
              type="text"
              placeholder="Add always-use hashtag..."
              style={styles.input}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  addHashtagAlways(e.target.value.trim());
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Pool */}
          <div style={styles.bankGroup}>
            <label style={styles.bankLabel}>Random Pool <span style={styles.bankHint}>(3-5 selected per post)</span></label>
            <div style={styles.tagList}>
              {hashtagBank.pool.map((tag, i) => (
                <span key={i} style={styles.tagPool}>
                  {tag}
                  <button onClick={() => removeHashtagPool(i)} style={styles.tagRemovePool}>×</button>
                </span>
              ))}
              {hashtagBank.pool.length === 0 && (
                <span style={styles.emptyHint}>None yet</span>
              )}
            </div>
            <input
              type="text"
              placeholder="Add to pool..."
              style={styles.input}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  addHashtagPool(e.target.value.trim());
                  e.target.value = '';
                }
              }}
            />
          </div>
        </div>

        {/* CAPTIONS */}
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Captions</h4>

          {/* Always Include */}
          <div style={styles.bankGroup}>
            <label style={styles.bankLabel}>Always Include</label>
            <div style={styles.tagList}>
              {captionBank.always.map((cap, i) => (
                <span key={i} style={styles.tagAlways}>
                  {cap}
                  <button onClick={() => removeCaptionAlways(i)} style={styles.tagRemoveAlways}>×</button>
                </span>
              ))}
              {captionBank.always.length === 0 && (
                <span style={styles.emptyHint}>None yet</span>
              )}
            </div>
            <input
              type="text"
              placeholder="Add always-use caption..."
              style={styles.input}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  addCaptionAlways(e.target.value.trim());
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Pool */}
          <div style={styles.bankGroup}>
            <label style={styles.bankLabel}>Random Pool <span style={styles.bankHint}>(1 selected per post)</span></label>
            <div style={styles.tagList}>
              {captionBank.pool.map((cap, i) => (
                <span key={i} style={styles.tagPool}>
                  {cap}
                  <button onClick={() => removeCaptionPool(i)} style={styles.tagRemovePool}>×</button>
                </span>
              ))}
              {captionBank.pool.length === 0 && (
                <span style={styles.emptyHint}>None yet</span>
              )}
            </div>
            <input
              type="text"
              placeholder="Add to pool..."
              style={styles.input}
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
    </div>
  );
};

const getStyles = (theme) => ({
  container: {
    padding: '20px'
  },
  containerCompact: {
    padding: '12px'
  },
  header: {
    marginBottom: '20px'
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: theme.text.primary
  },
  subtitle: {
    margin: '6px 0 0 0',
    fontSize: '13px',
    color: theme.text.muted
  },
  sections: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px'
  },
  sectionsCompact: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  section: {
    backgroundColor: theme.bg.surface,
    borderRadius: '12px',
    padding: '16px',
    border: `1px solid ${theme.bg.elevated}`
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '14px',
    fontWeight: '600',
    color: theme.text.primary
  },
  bankGroup: {
    marginBottom: '16px'
  },
  bankLabel: {
    display: 'block',
    fontSize: '11px',
    fontWeight: '500',
    color: theme.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px'
  },
  bankHint: {
    textTransform: 'none',
    letterSpacing: '0',
    color: theme.text.muted,
    fontWeight: '400'
  },
  tagList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '8px',
    minHeight: '28px'
  },
  tagAlways: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#34d399',
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  tagRemoveAlways: {
    background: 'none',
    border: 'none',
    color: '#059669',
    cursor: 'pointer',
    marginLeft: '6px',
    padding: '0 2px',
    fontSize: '14px',
    lineHeight: '1'
  },
  tagPool: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    backgroundColor: theme.bg.elevated,
    color: theme.text.secondary,
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  tagRemovePool: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    cursor: 'pointer',
    marginLeft: '6px',
    padding: '0 2px',
    fontSize: '14px',
    lineHeight: '1'
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.border.default}`,
    borderRadius: '8px',
    color: theme.text.primary,
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box'
  },
  emptyHint: {
    fontSize: '12px',
    color: theme.text.muted,
    fontStyle: 'italic'
  },
  empty: {
    padding: '40px 20px',
    textAlign: 'center'
  },
  emptyText: {
    color: theme.text.muted,
    fontSize: '14px'
  }
});

export default CollectionBankEditor;
