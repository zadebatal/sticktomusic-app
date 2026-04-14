/**
 * CollectionPicker - Compact collection selector for editor views
 * Allows selecting which collection to pull media from
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import {
  COLLECTION_TYPES,
  getCollectionMedia,
  getCollectionsAsync,
  MEDIA_TYPES,
} from '../../services/libraryService';
import log from '../../utils/logger';

const CollectionPicker = ({
  artistId,
  db = null,
  value = null, // Current collection ID
  onChange,
  mediaType = null, // Filter to specific type
  showMediaCount = true,
  isMobile = false,
  style = {},
  // Live data props — when provided, these override localStorage reads
  liveCollections = null,
  liveLibrary = null,
}) => {
  const { theme } = useTheme();
  const [localCollections, setLocalCollections] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [mediaCount, setMediaCount] = useState({});
  const dropdownRef = useRef(null);

  // Use live props if available, otherwise fall back to localStorage
  const collections = liveCollections || localCollections;

  // Load collections (only used when liveCollections not provided)
  useEffect(() => {
    if (liveCollections) return; // Skip read when live data is passed
    if (artistId) {
      getCollectionsAsync(db, artistId)
        .then((allCollections) => {
          setLocalCollections(allCollections);
        })
        .catch((err) => log.error('[CollectionPicker] Failed to load collections:', err));
    }
  }, [artistId, db, liveCollections]);

  // Compute media counts — uses live data if available, filtered by mediaType
  useEffect(() => {
    if (!showMediaCount || collections.length === 0) return;
    const counts = {};
    collections.forEach((col) => {
      if (liveLibrary) {
        // Count from live library, filtered by mediaType when set
        const colMediaIds = col.mediaIds || [];
        if (mediaType && colMediaIds.length > 0) {
          counts[col.id] = liveLibrary.filter(
            (m) => colMediaIds.includes(m.id) && m.type === mediaType,
          ).length;
        } else {
          counts[col.id] = colMediaIds.length;
        }
      } else {
        // Fallback: read from localStorage
        const media = getCollectionMedia(artistId, col.id);
        counts[col.id] = mediaType
          ? media.filter((m) => m.type === mediaType).length
          : media.length;
      }
    });
    setMediaCount(counts);
  }, [collections, liveLibrary, artistId, mediaType, showMediaCount]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get selected collection
  const selectedCollection = value ? collections.find((c) => c.id === value) : null;

  // Group collections by type
  const smartCollections = collections.filter((c) => c.type === COLLECTION_TYPES.SMART);
  const userCollections = collections.filter((c) => c.type !== COLLECTION_TYPES.SMART);

  const styles = {
    container: {
      position: 'relative',
      display: 'inline-block',
      ...style,
    },
    button: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      backgroundColor: theme.hover.bg,
      border: `1px solid ${theme.border.subtle}`,
      borderRadius: '8px',
      color: theme.text.primary,
      fontSize: '14px',
      cursor: 'pointer',
      minWidth: '160px',
      transition: 'all 0.2s',
    },
    buttonOpen: {
      borderColor: theme.accent.primary,
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
    },
    buttonIcon: {
      fontSize: '16px',
    },
    buttonText: {
      flex: 1,
      textAlign: 'left',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    buttonArrow: {
      fontSize: '10px',
      color: theme.text.secondary,
      transition: 'transform 0.2s',
    },
    dropdown: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: '4px',
      backgroundColor: theme.bg.input,
      border: `1px solid ${theme.border.subtle}`,
      borderRadius: '8px',
      boxShadow: theme.shadow,
      zIndex: 1000,
      maxHeight: '300px',
      overflowY: 'auto',
      minWidth: isMobile ? '200px' : '220px',
    },
    section: {
      padding: '8px 0',
    },
    sectionTitle: {
      padding: '4px 12px',
      fontSize: '11px',
      fontWeight: '600',
      color: theme.text.muted,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    sectionDivider: {
      height: '1px',
      backgroundColor: theme.border.subtle,
      margin: '4px 0',
    },
    item: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 12px',
      cursor: 'pointer',
      transition: 'background-color 0.15s',
    },
    itemSelected: {
      backgroundColor: 'rgba(99, 102, 241, 0.15)',
    },
    itemIcon: {
      fontSize: '16px',
      width: '20px',
      textAlign: 'center',
    },
    itemName: {
      flex: 1,
      fontSize: '14px',
      color: theme.text.primary,
    },
    itemCount: {
      fontSize: '12px',
      color: theme.text.muted,
      backgroundColor: theme.hover.bg,
      padding: '2px 6px',
      borderRadius: '4px',
    },
  };

  const handleSelect = (collectionId) => {
    onChange(collectionId);
    setIsOpen(false);
  };

  return (
    <div style={styles.container} ref={dropdownRef}>
      <button
        style={{
          ...styles.button,
          ...(isOpen ? styles.buttonOpen : {}),
        }}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.borderColor = theme.text.muted;
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.borderColor = theme.border.subtle;
        }}
      >
        <span style={styles.buttonIcon}>{selectedCollection?.icon || '📚'}</span>
        <span style={styles.buttonText}>{selectedCollection?.name || 'All Media'}</span>
        <span
          style={{
            ...styles.buttonArrow,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div style={styles.dropdown}>
          {/* All Media option */}
          <div style={styles.section}>
            <div
              style={{
                ...styles.item,
                ...(!value ? styles.itemSelected : {}),
              }}
              onClick={() => handleSelect(null)}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hover.bg)}
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = !value
                  ? 'rgba(99, 102, 241, 0.15)'
                  : 'transparent')
              }
            >
              <span style={styles.itemIcon}>📚</span>
              <span style={styles.itemName}>All Media</span>
            </div>
          </div>

          {userCollections.length > 0 && (
            <>
              <div style={styles.sectionDivider} />

              {/* User Collections — shown first */}
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Collections</div>
                {userCollections.map((collection) => (
                  <div
                    key={collection.id}
                    style={{
                      ...styles.item,
                      ...(value === collection.id ? styles.itemSelected : {}),
                    }}
                    onClick={() => handleSelect(collection.id)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hover.bg)}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        value === collection.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent')
                    }
                  >
                    <span style={styles.itemIcon}>📁</span>
                    <span style={styles.itemName}>{collection.name}</span>
                    {showMediaCount && (
                      <span style={styles.itemCount}>{mediaCount[collection.id] || 0}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={styles.sectionDivider} />

          {/* Smart Collections — shown after user collections */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Smart</div>
            {smartCollections.map((collection) => (
              <div
                key={collection.id}
                style={{
                  ...styles.item,
                  ...(value === collection.id ? styles.itemSelected : {}),
                }}
                onClick={() => handleSelect(collection.id)}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hover.bg)}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    value === collection.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent')
                }
              >
                <span style={styles.itemIcon}>{collection.icon}</span>
                <span style={styles.itemName}>{collection.name}</span>
                {showMediaCount && (
                  <span style={styles.itemCount}>{mediaCount[collection.id] || 0}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionPicker;
