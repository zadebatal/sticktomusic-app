/**
 * SaveToLibraryButton - Extracts clip segment and saves to Library
 * Used in timeline to save specific segments for reuse
 */

import React, { useState } from 'react';
import { addToLibraryAsync, getUserCollections, addToCollectionAsync, MEDIA_TYPES } from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';
import { useTheme } from '../../contexts/ThemeContext';

const SaveToLibraryButton = ({
  artistId,
  db = null,
  clip, // { videoId, videoUrl, startTime, endTime, duration }
  onSaved,
  isMobile = false,
  style = {}
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [clipName, setClipName] = useState('');
  const { theme } = useTheme();

  const collections = getUserCollections(artistId);

  const handleSave = async () => {
    if (!clip?.videoUrl) return;

    setIsSaving(true);

    try {
      // For now, we save the reference - in a full implementation,
      // we would extract the actual segment using FFmpeg
      const mediaItem = {
        type: MEDIA_TYPES.VIDEO,
        name: clipName || `Clip from timeline`,
        url: clip.videoUrl,
        duration: clip.duration || (clip.endTime - clip.startTime),
        metadata: {
          sourceClip: true,
          originalStartTime: clip.startTime,
          originalEndTime: clip.endTime,
          extractedFrom: clip.videoId
        }
      };

      if (selectedCollectionId) {
        mediaItem.collectionIds = [selectedCollectionId];
      }

      const savedItem = await addToLibraryAsync(db, artistId, mediaItem);

      if (selectedCollectionId) {
        await addToCollectionAsync(db, artistId, selectedCollectionId, savedItem.id);
      }

      if (onSaved) {
        onSaved(savedItem);
      }

      setShowCollectionPicker(false);
      setClipName('');
      setSelectedCollectionId(null);

    } catch (error) {
      console.error('Failed to save clip to library:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const styles = {
    button: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '6px 10px',
      backgroundColor: 'rgba(99, 102, 241, 0.2)',
      border: '1px solid rgba(99, 102, 241, 0.3)',
      borderRadius: '6px',
      color: theme.accent.hover,
      fontSize: '12px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      ...style
    },
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.overlay.heavy,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    },
    modalContent: {
      backgroundColor: theme.bg.input,
      borderRadius: '12px',
      padding: '24px',
      width: '90%',
      maxWidth: '360px'
    },
    modalTitle: {
      fontSize: '18px',
      fontWeight: '600',
      color: theme.text.primary,
      marginBottom: '16px'
    },
    inputGroup: {
      marginBottom: '16px'
    },
    label: {
      display: 'block',
      fontSize: '13px',
      color: theme.text.secondary,
      marginBottom: '6px'
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      backgroundColor: theme.hover.bg,
      border: `1px solid ${theme.border.subtle}`,
      borderRadius: '8px',
      color: theme.text.primary,
      fontSize: '14px',
      outline: 'none',
      boxSizing: 'border-box'
    },
    select: {
      width: '100%',
      padding: '10px 12px',
      backgroundColor: theme.hover.bg,
      border: `1px solid ${theme.border.subtle}`,
      borderRadius: '8px',
      color: theme.text.primary,
      fontSize: '14px',
      outline: 'none',
      boxSizing: 'border-box',
      cursor: 'pointer'
    },
    buttonGroup: {
      display: 'flex',
      gap: '12px',
      marginTop: '20px'
    },
    cancelButton: {
      flex: 1,
      padding: '10px 16px',
      backgroundColor: 'transparent',
      border: `1px solid ${theme.text.muted}`,
      borderRadius: '8px',
      color: theme.text.secondary,
      fontSize: '14px',
      cursor: 'pointer'
    },
    saveButton: {
      flex: 1,
      padding: '10px 16px',
      backgroundColor: theme.accent.primary,
      border: 'none',
      borderRadius: '8px',
      color: theme.text.primary,
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer'
    },
    clipInfo: {
      padding: '12px',
      backgroundColor: theme.hover.bg,
      borderRadius: '8px',
      marginBottom: '16px'
    },
    clipInfoText: {
      fontSize: '13px',
      color: theme.text.secondary
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <button
        style={styles.button}
        onClick={() => setShowCollectionPicker(true)}
        disabled={isSaving}
        title="Save this clip to your library"
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.3)';
          e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.2)';
          e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)';
        }}
      >
        <span>💾</span>
        <span>{isMobile ? '' : 'Save'}</span>
      </button>

      {showCollectionPicker && (
        <div style={styles.modal} onClick={() => setShowCollectionPicker(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Save to Library</div>

            {/* Clip Info */}
            <div style={styles.clipInfo}>
              <div style={styles.clipInfoText}>
                📹 Clip Duration: {formatTime(clip?.duration || 0)}
              </div>
            </div>

            {/* Clip Name */}
            <div style={styles.inputGroup}>
              <label style={styles.label}>Clip Name (optional)</label>
              <input
                type="text"
                placeholder="My awesome clip"
                value={clipName}
                onChange={(e) => setClipName(e.target.value)}
                style={styles.input}
              />
            </div>

            {/* Collection Picker */}
            {collections.length > 0 && (
              <div style={styles.inputGroup}>
                <label style={styles.label}>Add to Collection (optional)</label>
                <select
                  value={selectedCollectionId || ''}
                  onChange={(e) => setSelectedCollectionId(e.target.value || null)}
                  style={styles.select}
                >
                  <option value="">No collection</option>
                  {collections.filter(c => c.type !== 'smart').map(col => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Buttons */}
            <div style={styles.buttonGroup}>
              <button
                style={styles.cancelButton}
                onClick={() => setShowCollectionPicker(false)}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.saveButton,
                  opacity: isSaving ? 0.5 : 1
                }}
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save to Library'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SaveToLibraryButton;
