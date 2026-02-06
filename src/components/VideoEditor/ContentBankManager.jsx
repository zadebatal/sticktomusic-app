import React, { useState, useRef, useCallback } from 'react';
import { useToast, ConfirmDialog } from '../ui';

/**
 * Content Bank Manager - Manages artist-specific content libraries
 */
const ContentBankManager = ({
  artists = [],
  banks = [],
  selectedArtist,
  selectedBank,
  onSelectArtist,
  onSelectBank,
  onCreateBank,
  onUploadClips,
  onDeleteClip,
  onToggleNeverUse,
  onSelectClipForPreview
}) => {
  const { error: toastError } = useToast();
  const [deleteClipConfirm, setDeleteClipConfirm] = useState({ isOpen: false, clipId: null });
  const [isCreating, setIsCreating] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInputRef = useRef(null);

  // Get banks for selected artist
  const artistBanks = selectedArtist
    ? banks.filter(b => b.artistId === selectedArtist.id)
    : [];

  // Get clips for selected bank
  const bankClips = selectedBank?.clips || [];

  // Handle file drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);

    if (!selectedBank) {
      toastError('Please select a content bank first');
      return;
    }

    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('video/')
    );

    if (files.length > 0) {
      handleUpload(files);
    }
  }, [selectedBank]);

  // Handle file selection
  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      handleUpload(files);
    }
  }, []);

  // Process upload
  const handleUpload = async (files) => {
    setUploadProgress({ current: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress({ current: i + 1, total: files.length, fileName: file.name });

      // Create object URL and thumbnail
      const url = URL.createObjectURL(file);
      const thumbnail = await generateThumbnail(file);

      onUploadClips?.([{
        id: `clip_${Date.now()}_${i}`,
        name: file.name,
        url,
        thumbnail,
        file,
        neverUse: false,
        createdAt: new Date().toISOString()
      }]);

      // Small delay between uploads
      await new Promise(r => setTimeout(r, 100));
    }

    setUploadProgress(null);
  };

  // Generate video thumbnail
  const generateThumbnail = (file) => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      video.src = URL.createObjectURL(file);
      video.muted = true;

      video.onloadeddata = () => {
        video.currentTime = 0.5; // Get frame at 0.5s
      };

      video.onseeked = () => {
        canvas.width = 160;
        canvas.height = 90;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
        URL.revokeObjectURL(video.src);
      };

      video.onerror = () => {
        resolve(null);
      };
    });
  };

  // Create new bank
  const handleCreateBank = () => {
    if (!newBankName.trim() || !selectedArtist) return;

    onCreateBank?.({
      id: `bank_${Date.now()}`,
      name: newBankName.trim(),
      artistId: selectedArtist.id,
      clips: [],
      createdAt: new Date().toISOString()
    });

    setNewBankName('');
    setIsCreating(false);
  };

  return (
    <div style={styles.container}>
      {/* Artist Selector */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Artist</h3>
        <div style={styles.artistGrid}>
          {artists.map(artist => (
            <button
              key={artist.id}
              style={{
                ...styles.artistButton,
                ...(selectedArtist?.id === artist.id ? styles.artistButtonActive : {})
              }}
              onClick={() => onSelectArtist?.(artist)}
            >
              <span style={styles.artistAvatar}>{artist.name[0]}</span>
              <span style={styles.artistName}>{artist.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Category/Bank Selector */}
      {selectedArtist && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>Content Banks</h3>
            <button
              style={styles.addButton}
              onClick={() => setIsCreating(true)}
            >
              + New Bank
            </button>
          </div>

          {isCreating && (
            <div style={styles.createForm}>
              <input
                type="text"
                placeholder="Bank name (e.g., Fashion Runway)"
                value={newBankName}
                onChange={(e) => setNewBankName(e.target.value)}
                style={styles.input}
                autoFocus
              />
              <div style={styles.createActions}>
                <button
                  style={styles.createButton}
                  onClick={handleCreateBank}
                  disabled={!newBankName.trim()}
                >
                  Create
                </button>
                <button
                  style={styles.cancelButton}
                  onClick={() => {
                    setIsCreating(false);
                    setNewBankName('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div style={styles.bankGrid}>
            {artistBanks.map(bank => (
              <button
                key={bank.id}
                style={{
                  ...styles.bankButton,
                  ...(selectedBank?.id === bank.id ? styles.bankButtonActive : {})
                }}
                onClick={() => onSelectBank?.(bank)}
              >
                <span style={styles.bankIcon}>📁</span>
                <span style={styles.bankName}>{bank.name}</span>
                <span style={styles.bankCount}>{bank.clips?.length || 0} clips</span>
              </button>
            ))}
            {artistBanks.length === 0 && !isCreating && (
              <p style={styles.emptyText}>No content banks yet. Create one to get started!</p>
            )}
          </div>
        </div>
      )}

      {/* Clips Grid */}
      {selectedBank && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>
              {selectedBank.name}
              <span style={styles.clipCount}>({bankClips.length} clips)</span>
            </h3>
          </div>

          {/* Upload Area */}
          <div
            style={{
              ...styles.uploadArea,
              ...(dragOver ? styles.uploadAreaDragOver : {})
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            {uploadProgress ? (
              <div style={styles.uploadProgress}>
                <div style={styles.progressBar}>
                  <div
                    style={{
                      ...styles.progressFill,
                      width: `${(uploadProgress.current / uploadProgress.total) * 100}%`
                    }}
                  />
                </div>
                <span>Uploading {uploadProgress.current}/{uploadProgress.total}: {uploadProgress.fileName}</span>
              </div>
            ) : (
              <>
                <span style={styles.uploadIcon}>📤</span>
                <span>Drop videos here or click to upload</span>
                <span style={styles.uploadHint}>Supports bulk upload</span>
              </>
            )}
          </div>

          {/* Clips Grid */}
          <div style={styles.clipsGrid}>
            {bankClips.map((clip, index) => (
              <div
                key={clip.id}
                style={{
                  ...styles.clipCard,
                  ...(clip.neverUse ? styles.clipCardDisabled : {})
                }}
                onMouseEnter={(e) => {
                  // Show preview on hover
                  const video = e.currentTarget.querySelector('video');
                  if (video) {
                    const p = video.play();
                    if (p) p.catch(() => {});
                  }
                }}
                onMouseLeave={(e) => {
                  const video = e.currentTarget.querySelector('video');
                  if (video && !video.paused) {
                    video.pause();
                    video.currentTime = 0;
                  }
                }}
              >
                <div style={styles.clipThumbnail}>
                  {clip.thumbnail ? (
                    <img src={clip.thumbnail} alt={clip.name} style={styles.thumbnailImg} />
                  ) : (
                    <div style={styles.thumbnailPlaceholder}>🎬</div>
                  )}
                  <video
                    src={clip.url}
                    muted
                    loop
                    style={styles.clipPreviewVideo}
                  />
                  {clip.neverUse && (
                    <div style={styles.neverUseOverlay}>
                      <span>🚫 Never Use</span>
                    </div>
                  )}
                </div>
                <div style={styles.clipActions}>
                  <button
                    style={styles.clipAction}
                    onClick={() => onSelectClipForPreview?.(clip)}
                    title="Preview"
                  >
                    👁️
                  </button>
                  <button
                    style={{
                      ...styles.clipAction,
                      ...(clip.neverUse ? styles.clipActionActive : {})
                    }}
                    onClick={() => onToggleNeverUse?.(clip.id)}
                    title={clip.neverUse ? 'Enable clip' : 'Never use this clip'}
                  >
                    🚫
                  </button>
                  <button
                    style={styles.clipActionDelete}
                    onClick={() => {
                      setDeleteClipConfirm({ isOpen: true, clipId: clip.id });
                    }}
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>

          {bankClips.length === 0 && (
            <p style={styles.emptyClipsText}>
              No clips in this bank yet. Upload some videos to get started!
            </p>
          )}
        </div>
      )}

      {/* H-01: Confirm dialog for clip deletion */}
      <ConfirmDialog
        isOpen={deleteClipConfirm.isOpen}
        title="Delete this clip?"
        message="This will permanently remove the clip from this bank."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => {
          onDeleteClip?.(deleteClipConfirm.clipId);
          setDeleteClipConfirm({ isOpen: false, clipId: null });
        }}
        onCancel={() => setDeleteClipConfirm({ isOpen: false, clipId: null })}
      />
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    height: '100%',
    overflow: 'auto'
  },
  section: {
    padding: '12px',
    backgroundColor: '#1e293b',
    borderRadius: '8px'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  sectionTitle: {
    margin: 0,
    fontSize: '14px',
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: '12px'
  },
  artistGrid: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  artistButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#334155',
    border: '2px solid transparent',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  artistButtonActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#a78bfa'
  },
  artistAvatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: '#475569',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 'bold',
    color: 'white'
  },
  artistName: {
    color: 'white',
    fontSize: '13px',
    fontWeight: '500'
  },
  addButton: {
    padding: '6px 12px',
    backgroundColor: '#22c55e',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  createForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '12px',
    padding: '12px',
    backgroundColor: '#0f172a',
    borderRadius: '6px'
  },
  input: {
    padding: '8px 12px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: 'white',
    fontSize: '13px'
  },
  createActions: {
    display: 'flex',
    gap: '8px'
  },
  createButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#22c55e',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600'
  },
  cancelButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#475569',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  bankGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  bankButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    backgroundColor: '#334155',
    border: '2px solid transparent',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left'
  },
  bankButtonActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#a78bfa'
  },
  bankIcon: {
    fontSize: '20px'
  },
  bankName: {
    flex: 1,
    color: 'white',
    fontSize: '14px',
    fontWeight: '500'
  },
  bankCount: {
    color: '#94a3b8',
    fontSize: '12px'
  },
  clipCount: {
    marginLeft: '8px',
    fontWeight: '400',
    color: '#94a3b8'
  },
  uploadArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '24px',
    backgroundColor: '#0f172a',
    border: '2px dashed #334155',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: '#94a3b8',
    fontSize: '14px',
    marginBottom: '16px'
  },
  uploadAreaDragOver: {
    borderColor: '#7c3aed',
    backgroundColor: '#1e1b4b'
  },
  uploadIcon: {
    fontSize: '32px'
  },
  uploadHint: {
    fontSize: '12px',
    color: '#64748b'
  },
  uploadProgress: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    width: '100%'
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: '#334155',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7c3aed',
    transition: 'width 0.3s'
  },
  clipsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '12px'
  },
  clipCard: {
    position: 'relative',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    transition: 'transform 0.2s',
    cursor: 'pointer'
  },
  clipCardDisabled: {
    opacity: 0.5
  },
  clipThumbnail: {
    position: 'relative',
    aspectRatio: '16/9',
    backgroundColor: '#1e293b'
  },
  thumbnailImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px'
  },
  clipPreviewVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0,
    transition: 'opacity 0.2s'
  },
  neverUseOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ef4444',
    fontWeight: '600',
    fontSize: '11px'
  },
  clipActions: {
    display: 'flex',
    justifyContent: 'space-around',
    padding: '6px',
    backgroundColor: '#1e293b'
  },
  clipAction: {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    opacity: 0.7,
    transition: 'opacity 0.2s'
  },
  clipActionActive: {
    opacity: 1,
    backgroundColor: '#7f1d1d'
  },
  clipActionDelete: {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    opacity: 0.7,
    transition: 'opacity 0.2s'
  },
  emptyText: {
    color: '#64748b',
    fontSize: '13px',
    textAlign: 'center',
    padding: '12px'
  },
  emptyClipsText: {
    color: '#64748b',
    fontSize: '14px',
    textAlign: 'center',
    padding: '24px'
  }
};

// Add hover effect for video preview
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  .clip-card:hover video {
    opacity: 1 !important;
  }
`;
document.head.appendChild(styleSheet);

export default ContentBankManager;
