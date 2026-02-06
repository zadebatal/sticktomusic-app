/**
 * CollectionPicker - Compact collection selector for editor views
 * Allows selecting which collection to pull media from
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  getCollections,
  getCollectionMedia,
  COLLECTION_TYPES,
  MEDIA_TYPES
} from '../../services/libraryService';

const CollectionPicker = ({
  artistId,
  value = null, // Current collection ID
  onChange,
  mediaType = null, // Filter to specific type
  showMediaCount = true,
  isMobile = false,
  style = {}
}) => {
  const [collections, setCollections] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [mediaCount, setMediaCount] = useState({});
  const dropdownRef = useRef(null);

  // Load collections
  useEffect(() => {
    if (artistId) {
      const allCollections = getCollections(artistId);
      setCollections(allCollections);

      // Count media per collection
      if (showMediaCount) {
        const counts = {};
        allCollections.forEach(col => {
          const media = getCollectionMedia(artistId, col.id);
          counts[col.id] = mediaType
            ? media.filter(m => m.type === mediaType).length
            : media.length;
        });
        setMediaCount(counts);
      }
    }
  }, [artistId, mediaType, showMediaCount]);

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
  const selectedCollection = value
    ? collections.find(c => c.id === value)
    : null;

  // Group collections by type
  const smartCollections = collections.filter(c => c.type === COLLECTION_TYPES.SMART);
  const userCollections = collections.filter(c => c.type !== COLLECTION_TYPES.SMART);

  const styles = {
    container: {
      position: 'relative',
      display: 'inline-block',
      ...style
    },
    button: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      borderRadius: '8px',
      color: '#ffffff',
      fontSize: '14px',
      cursor: 'pointer',
      minWidth: '160px',
      transition: 'all 0.2s'
    },
    buttonOpen: {
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99, 102, 241, 0.1)'
    },
    buttonIcon: {
      fontSize: '16px'
    },
    buttonText: {
      flex: 1,
      textAlign: 'left',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    buttonArrow: {
      fontSize: '10px',
      color: 'rgba(255, 255, 255, 0.5)',
      transition: 'transform 0.2s'
    },
    dropdown: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: '4px',
      backgroundColor: '#1a1a1a',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
      zIndex: 1000,
      maxHeight: '300px',
      overflowY: 'auto',
      minWidth: isMobile ? '200px' : '220px'
    },
    section: {
      padding: '8px 0'
    },
    sectionTitle: {
      padding: '4px 12px',
      fontSize: '11px',
      fontWeight: '600',
      color: 'rgba(255, 255, 255, 0.4)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    },
    sectionDivider: {
      height: '1px',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      margin: '4px 0'
    },
    item: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 12px',
      cursor: 'pointer',
      transition: 'background-color 0.15s'
    },
    itemSelected: {
      backgroundColor: 'rgba(99, 102, 241, 0.15)'
    },
    itemIcon: {
      fontSize: '16px',
      width: '20px',
      textAlign: 'center'
    },
    itemName: {
      flex: 1,
      fontSize: '14px',
      color: '#ffffff'
    },
    itemCount: {
      fontSize: '12px',
      color: 'rgba(255, 255, 255, 0.4)',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      padding: '2px 6px',
      borderRadius: '4px'
    }
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
          ...(isOpen ? styles.buttonOpen : {})
        }}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }}
      >
        <span style={styles.buttonIcon}>
          {selectedCollection?.icon || '📚'}
        </span>
        <span style={styles.buttonText}>
          {selectedCollection?.name || 'All Media'}
        </span>
        <span style={{
          ...styles.buttonArrow,
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
        }}>
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
                ...(!value ? styles.itemSelected : {})
              }}
              onClick={() => handleSelect(null)}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = !value ? 'rgba(99, 102, 241, 0.15)' : 'transparent'}
            >
              <span style={styles.itemIcon}>📚</span>
              <span style={styles.itemName}>All Media</span>
            </div>
          </div>

          <div style={styles.sectionDivider} />

          {/* Smart Collections */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Smart</div>
            {smartCollections.map(collection => (
              <div
                key={collection.id}
                style={{
                  ...styles.item,
                  ...(value === collection.id ? styles.itemSelected : {})
                }}
                onClick={() => handleSelect(collection.id)}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = value === collection.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent'}
              >
                <span style={styles.itemIcon}>{collection.icon}</span>
                <span style={styles.itemName}>{collection.name}</span>
                {showMediaCount && (
                  <span style={styles.itemCount}>{mediaCount[collection.id] || 0}</span>
                )}
              </div>
            ))}
          </div>

          {userCollections.length > 0 && (
            <>
              <div style={styles.sectionDivider} />

              {/* User Collections */}
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Collections</div>
                {userCollections.map(collection => (
                  <div
                    key={collection.id}
                    style={{
                      ...styles.item,
                      ...(value === collection.id ? styles.itemSelected : {})
                    }}
                    onClick={() => handleSelect(collection.id)}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = value === collection.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent'}
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
        </div>
      )}
    </div>
  );
};

export default CollectionPicker;
