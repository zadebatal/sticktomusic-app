import React, { useState, useMemo, useRef } from 'react';

const AudioSelectionModal = ({
  libraryAudio = [],
  collections = [],
  selectedAudioId = null,
  onSelect,
  onUpload,
  onClose,
  currentCollectionId = null
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCollection, setFilterCollection] = useState('all');
  const [playingId, setPlayingId] = useState(null);
  const audioRefs = useRef({});

  // Filter audio by search and collection
  const filteredAudio = useMemo(() => {
    try {
      let filtered = Array.isArray(libraryAudio) ? libraryAudio : [];

      // Collection filter
      if (filterCollection !== 'all') {
        const collection = Array.isArray(collections) ? collections.find(c => c.id === filterCollection) : null;
        if (collection && Array.isArray(collection.audio)) {
          const collectionAudioIds = new Set(collection.audio);
          filtered = filtered.filter(a => a && collectionAudioIds.has(a.id));
        }
      }

      // Search filter
      if (searchQuery && searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(a => a && a.name && a.name.toLowerCase().includes(query));
      }

      return filtered;
    } catch (error) {
      console.error('[AudioSelectionModal] Filter error:', error);
      return [];
    }
  }, [libraryAudio, searchQuery, filterCollection, collections]);

  const handlePreview = (audio, e) => {
    e.stopPropagation();

    // Stop currently playing audio
    if (playingId && audioRefs.current[playingId]) {
      audioRefs.current[playingId].pause();
      audioRefs.current[playingId].currentTime = 0;
    }

    if (playingId === audio.id) {
      // Toggling off
      setPlayingId(null);
    } else {
      // Play new audio
      const audioElement = audioRefs.current[audio.id];
      if (audioElement) {
        audioElement.play();
        setPlayingId(audio.id);
      }
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            <h2 style={styles.title}>Select Audio</h2>
          </div>
          <button style={styles.closeButton} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Search and Filters */}
        <div style={styles.controls}>
          <div style={styles.searchBar}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Search audio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
              autoFocus
            />
          </div>

          {collections.length > 0 && (
            <select
              value={filterCollection}
              onChange={(e) => setFilterCollection(e.target.value)}
              style={styles.collectionFilter}
            >
              <option value="all">All Audio ({libraryAudio.length})</option>
              {collections.map(col => (
                <option key={col.id} value={col.id}>
                  {col.name} ({col.audio?.length || 0})
                </option>
              ))}
            </select>
          )}

          <button style={styles.uploadButton} onClick={onUpload}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Upload Audio
          </button>
        </div>

        {/* Audio Grid */}
        <div style={styles.audioGrid}>
          {filteredAudio.length === 0 ? (
            <div style={styles.emptyState}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5" style={{ marginBottom: '12px' }}>
                <path d="M9 18V5l12-2v13"/>
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="16" r="3"/>
              </svg>
              <p style={styles.emptyText}>
                {searchQuery ? `No audio found for "${searchQuery}"` : 'No audio tracks yet'}
              </p>
              <p style={styles.emptySubtext}>
                {searchQuery ? 'Try a different search term' : 'Upload audio to get started'}
              </p>
            </div>
          ) : (
            filteredAudio.map(audio => (
              <div
                key={audio.id}
                style={{
                  ...styles.audioCard,
                  ...(selectedAudioId === audio.id ? styles.audioCardSelected : {})
                }}
                onClick={() => onSelect(audio)}
              >
                {/* Hidden audio element for preview */}
                <audio
                  ref={(el) => { if (el) audioRefs.current[audio.id] = el; }}
                  src={audio.url || audio.localUrl}
                  onEnded={() => setPlayingId(null)}
                />

                {/* Audio Icon */}
                <div style={styles.audioIcon}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                  </svg>
                </div>

                {/* Audio Info */}
                <div style={styles.audioInfo}>
                  <div style={styles.audioName}>{audio.name}</div>
                  <div style={styles.audioDuration}>
                    {formatDuration(audio.duration)}
                    {audio.isTrimmed && <span style={styles.trimmedBadge}>Trimmed</span>}
                  </div>
                </div>

                {/* Actions */}
                <div style={styles.audioActions}>
                  <button
                    style={{
                      ...styles.previewButton,
                      ...(playingId === audio.id ? styles.previewButtonPlaying : {})
                    }}
                    onClick={(e) => handlePreview(audio, e)}
                    title={playingId === audio.id ? 'Stop' : 'Preview'}
                  >
                    {playingId === audio.id ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16"/>
                        <rect x="14" y="4" width="4" height="16"/>
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    )}
                  </button>

                  {selectedAudioId === audio.id && (
                    <div style={styles.selectedBadge}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Stats */}
        <div style={styles.footer}>
          <span style={styles.footerText}>
            {filteredAudio.length} {filteredAudio.length === 1 ? 'track' : 'tracks'}
            {searchQuery && ` • filtered from ${libraryAudio.length} total`}
          </span>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px'
  },
  modal: {
    backgroundColor: '#1a1a2e',
    borderRadius: '16px',
    maxWidth: '900px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)',
    overflow: 'hidden'
  },
  header: {
    padding: '20px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff'
  },
  closeButton: {
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    border: 'none',
    background: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s'
  },
  controls: {
    padding: '16px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap'
  },
  searchBar: {
    flex: 1,
    minWidth: '200px',
    position: 'relative'
  },
  searchInput: {
    width: '100%',
    height: '40px',
    paddingLeft: '40px',
    paddingRight: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(255, 255, 255, 0.05)',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    transition: 'all 0.15s'
  },
  collectionFilter: {
    height: '40px',
    padding: '0 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(255, 255, 255, 0.05)',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer',
    outline: 'none'
  },
  uploadButton: {
    height: '40px',
    padding: '0 16px',
    borderRadius: '8px',
    border: 'none',
    background: '#6366f1',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.15s'
  },
  audioGrid: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
    alignContent: 'start'
  },
  audioCard: {
    padding: '16px',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(255, 255, 255, 0.03)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  audioCardSelected: {
    border: '1px solid #6366f1',
    background: 'rgba(99, 102, 241, 0.15)'
  },
  audioIcon: {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    background: 'rgba(167, 139, 250, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#a78bfa',
    flexShrink: 0
  },
  audioInfo: {
    flex: 1,
    minWidth: 0
  },
  audioName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#fff',
    marginBottom: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  audioDuration: {
    fontSize: '12px',
    color: '#9ca3af',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  trimmedBadge: {
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'rgba(251, 146, 60, 0.2)',
    color: '#fb923c',
    fontSize: '10px',
    fontWeight: '600'
  },
  audioActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  previewButton: {
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    background: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s'
  },
  previewButtonPlaying: {
    background: '#6366f1',
    color: '#fff',
    borderColor: '#6366f1'
  },
  selectedBadge: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#6366f1',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyState: {
    gridColumn: '1 / -1',
    padding: '60px 20px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  emptyText: {
    margin: '0 0 8px',
    fontSize: '16px',
    fontWeight: '500',
    color: '#9ca3af'
  },
  emptySubtext: {
    margin: 0,
    fontSize: '14px',
    color: '#6b7280'
  },
  footer: {
    padding: '12px 24px',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    background: 'rgba(0, 0, 0, 0.2)'
  },
  footerText: {
    fontSize: '12px',
    color: '#9ca3af'
  }
};

export default AudioSelectionModal;
