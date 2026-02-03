import React, { useState, useRef } from 'react';
import AudioClipSelector from './AudioClipSelector';

/**
 * AestheticHome - Landing page showing categories and their assets
 * Similar to Flowstage's Aesthetic overview page
 */
const AestheticHome = ({
  artists = [],
  selectedArtist,
  onSelectArtist,
  categories = [],
  selectedCategory,
  onSelectCategory,
  onCreateCategory,
  onUploadVideos,
  onUploadAudio,
  onCreateContent
}) => {
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [pendingAudio, setPendingAudio] = useState(null); // Audio waiting for clip selection
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);

  const handleCreateCategory = () => {
    if (newCategoryName.trim()) {
      onCreateCategory({
        name: newCategoryName.trim(),
        description: newCategoryDesc.trim()
      });
      setNewCategoryName('');
      setNewCategoryDesc('');
      setIsCreatingCategory(false);
    }
  };

  const handleVideoUpload = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      onUploadVideos(files);
    }
    e.target.value = '';
  };

  const handleAudioUpload = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      // Show clip selector for the first file
      const file = files[0];
      const url = URL.createObjectURL(file);
      setPendingAudio({
        file,
        url,
        name: file.name
      });
    }
    e.target.value = '';
  };

  // Handle clip selection save
  const handleClipSave = (clipData) => {
    if (pendingAudio) {
      // Pass audio with clip data to parent
      onUploadAudio([pendingAudio.file], {
        startTime: clipData.startTime,
        endTime: clipData.endTime,
        clipDuration: clipData.duration
      });
      setPendingAudio(null);
    }
  };

  // Handle clip selection cancel
  const handleClipCancel = () => {
    if (pendingAudio?.url) {
      URL.revokeObjectURL(pendingAudio.url);
    }
    setPendingAudio(null);
  };

  return (
    <div style={styles.container}>
      {/* Sidebar - Categories */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarSection}>
          <div style={styles.sidebarHeader}>
            <h3 style={styles.sidebarTitle}>Categories</h3>
            <span style={styles.categoryCount}>{categories.length}</span>
          </div>

          <div style={styles.categoryList}>
            {categories.map(category => (
              <button
                key={category.id}
                style={{
                  ...styles.categoryItem,
                  ...(selectedCategory?.id === category.id ? styles.categoryItemActive : {})
                }}
                onClick={() => onSelectCategory(category)}
              >
                <div style={styles.categoryThumb}>
                  {category.thumbnail ? (
                    <img src={category.thumbnail} alt="" style={styles.categoryThumbImg} />
                  ) : (
                    <div style={styles.categoryThumbPlaceholder}>
                      {category.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <span style={styles.categoryName}>{category.name}</span>
              </button>
            ))}

            {isCreatingCategory ? (
              <div style={styles.newCategoryForm}>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Category name"
                  style={styles.newCategoryInput}
                  autoFocus
                />
                <div style={styles.newCategoryActions}>
                  <button
                    onClick={() => setIsCreatingCategory(false)}
                    style={styles.newCategoryCancel}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateCategory}
                    style={styles.newCategoryCreate}
                    disabled={!newCategoryName.trim()}
                  >
                    Create
                  </button>
                </div>
              </div>
            ) : (
              <button
                style={styles.addCategoryButton}
                onClick={() => setIsCreatingCategory(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Category
              </button>
            )}
          </div>
        </div>

        <div style={styles.sidebarDivider} />

        {/* UI-23: Fixed sidebar links with proper states */}
        <div style={styles.sidebarSection}>
          <div style={styles.sidebarLinkDisabled} title="Select a category to view all videos">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
            </svg>
            <span>All Videos</span>
            <span style={styles.comingSoon}>Soon</span>
          </div>
          <div style={styles.sidebarLinkDisabled} title="Presets are available in the video editor">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
            <span>Presets</span>
            <span style={styles.comingSoon}>Soon</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main style={styles.main}>
        {selectedCategory ? (
          <>
            {/* Category Header */}
            <div style={styles.categoryHeader}>
              <button
                style={styles.backButton}
                onClick={() => onSelectCategory(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Back to Categories
              </button>

              <div style={styles.categoryInfo}>
                <div style={styles.categoryIcon}>
                  {selectedCategory.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h1 style={styles.categoryTitle}>{selectedCategory.name}</h1>
                  <p style={styles.categoryDescription}>
                    {selectedCategory.description || 'No description'}
                  </p>
                </div>
              </div>
            </div>

            {/* Assets Grid */}
            <div style={styles.assetsContainer}>
              {/* Videos Section */}
              <div style={styles.assetSection}>
                <div style={styles.assetHeader}>
                  <div style={styles.assetTitleRow}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="M10 9l5 3-5 3V9z" fill="currentColor"/>
                    </svg>
                    <h2 style={styles.assetTitle}>Videos</h2>
                    <span style={styles.assetCount}>({selectedCategory.videos.length})</span>
                  </div>
                  <button
                    style={styles.addButton}
                    onClick={() => videoInputRef.current?.click()}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add
                  </button>
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={handleVideoUpload}
                    style={{ display: 'none' }}
                  />
                </div>

                <div style={styles.assetGrid}>
                  {selectedCategory.videos.length === 0 ? (
                    <div
                      style={styles.emptyState}
                      onClick={() => videoInputRef.current?.click()}
                    >
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                        <rect x="2" y="4" width="20" height="16" rx="2"/>
                        <path d="M10 9l5 3-5 3V9z"/>
                      </svg>
                      <span>Click to add videos</span>
                    </div>
                  ) : (
                    selectedCategory.videos.map(video => (
                      <div key={video.id} style={styles.videoCard}>
                        <div style={styles.videoThumb}>
                          {video.thumbnail ? (
                            <img src={video.thumbnail} alt="" style={styles.videoThumbImg} />
                          ) : (
                            <video
                              src={video.url}
                              style={styles.videoThumbVideo}
                              muted
                              playsInline
                              onMouseEnter={(e) => {
                                const playPromise = e.target.play();
                                if (playPromise) playPromise.catch(() => {});
                              }}
                              onMouseLeave={(e) => {
                                if (!e.target.paused) e.target.pause();
                                e.target.currentTime = 0;
                              }}
                            />
                          )}
                        </div>
                        <span style={styles.videoDuration}>
                          {video.duration ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, '0')}` : '0:00'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Audio Section */}
              <div style={styles.assetSection}>
                <div style={styles.assetHeader}>
                  <div style={styles.assetTitleRow}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18V5l12-2v13"/>
                      <circle cx="6" cy="18" r="3"/>
                      <circle cx="18" cy="16" r="3"/>
                    </svg>
                    <h2 style={styles.assetTitle}>Audio</h2>
                    <span style={styles.assetCount}>({selectedCategory.audio.length})</span>
                  </div>
                  <button
                    style={styles.uploadButton}
                    onClick={() => audioInputRef.current?.click()}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Upload
                  </button>
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={handleAudioUpload}
                    style={{ display: 'none' }}
                  />
                </div>

                <div style={styles.audioList}>
                  {selectedCategory.audio.length === 0 ? (
                    <div
                      style={styles.emptyStateSmall}
                      onClick={() => audioInputRef.current?.click()}
                    >
                      <span>No audio yet. Click to upload.</span>
                    </div>
                  ) : (
                    selectedCategory.audio.map(audio => (
                      <div key={audio.id} style={styles.audioItem}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                          <path d="M15.54 8.46a5 5 0 010 7.07"/>
                        </svg>
                        <div style={styles.audioInfo}>
                          <span style={styles.audioName}>{audio.name}</span>
                          <span style={styles.audioDuration}>
                            {audio.duration ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}` : '--:--'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Create Button */}
            <div style={styles.createButtonContainer}>
              <button
                style={styles.createButton}
                onClick={onCreateContent}
                disabled={selectedCategory.videos.length === 0 && selectedCategory.audio.length === 0}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                Create using this category
              </button>
            </div>
          </>
        ) : (
          /* No Category Selected - Show Grid */
          <div style={styles.categoriesGrid}>
            <h2 style={styles.gridTitle}>Select a Category</h2>
            <p style={styles.gridSubtitle}>Choose a category to view assets and create content</p>

            <div style={styles.categoryCards}>
              {categories.map(category => (
                <button
                  key={category.id}
                  style={styles.categoryCard}
                  onClick={() => onSelectCategory(category)}
                >
                  <div style={styles.categoryCardThumb}>
                    {category.thumbnail ? (
                      <img src={category.thumbnail} alt="" style={styles.categoryCardThumbImg} />
                    ) : (
                      <div style={styles.categoryCardThumbPlaceholder}>
                        {category.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div style={styles.categoryCardInfo}>
                    <h3 style={styles.categoryCardName}>{category.name}</h3>
                    <p style={styles.categoryCardMeta}>
                      {category.videos.length} videos · {category.audio.length} audio
                    </p>
                  </div>
                </button>
              ))}

              <button
                style={styles.addCategoryCard}
                onClick={() => setIsCreatingCategory(true)}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>New Category</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Audio Clip Selector Modal */}
      {pendingAudio && (
        <AudioClipSelector
          audioFile={pendingAudio.file}
          audioUrl={pendingAudio.url}
          onSave={handleClipSave}
          onCancel={handleClipCancel}
        />
      )}
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    height: '100%',
    overflow: 'hidden'
  },
  sidebar: {
    width: '220px',
    backgroundColor: '#111118',
    borderRight: '1px solid #1f1f2e',
    padding: '16px 0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto'
  },
  sidebarSection: {
    padding: '0 12px'
  },
  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 8px',
    marginBottom: '8px'
  },
  sidebarTitle: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    margin: 0
  },
  categoryCount: {
    fontSize: '11px',
    color: '#6b7280',
    backgroundColor: '#1f1f2e',
    padding: '2px 6px',
    borderRadius: '10px'
  },
  categoryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  categoryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: '#d1d5db',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    fontSize: '13px'
  },
  categoryItemActive: {
    backgroundColor: '#1f1f2e',
    color: '#fff'
  },
  categoryThumb: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    overflow: 'hidden',
    flexShrink: 0
  },
  categoryThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  categoryThumbPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2d2d3d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '600',
    color: '#9ca3af'
  },
  categoryName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  addCategoryButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    backgroundColor: 'transparent',
    border: '1px dashed #2d2d3d',
    borderRadius: '6px',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '13px',
    marginTop: '8px'
  },
  newCategoryForm: {
    padding: '8px',
    backgroundColor: '#1f1f2e',
    borderRadius: '6px',
    marginTop: '8px'
  },
  newCategoryInput: {
    width: '100%',
    padding: '8px',
    backgroundColor: '#0a0a0f',
    border: '1px solid #2d2d3d',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '13px',
    outline: 'none',
    marginBottom: '8px'
  },
  newCategoryActions: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end'
  },
  newCategoryCancel: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '12px'
  },
  newCategoryCreate: {
    padding: '6px 12px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  sidebarDivider: {
    height: '1px',
    backgroundColor: '#1f1f2e',
    margin: '16px 12px'
  },
  sidebarLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    fontSize: '13px'
  },
  // UI-23: Disabled sidebar link styles
  sidebarLinkDisabled: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px',
    backgroundColor: 'transparent',
    borderRadius: '6px',
    color: '#4b5563',
    cursor: 'not-allowed',
    textAlign: 'left',
    width: '100%',
    fontSize: '13px'
  },
  comingSoon: {
    marginLeft: 'auto',
    fontSize: '10px',
    padding: '2px 6px',
    backgroundColor: '#1f1f2e',
    borderRadius: '4px',
    color: '#6b7280'
  },
  main: {
    flex: 1,
    overflow: 'auto',
    padding: '24px'
  },
  categoryHeader: {
    marginBottom: '24px'
  },
  backButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px',
    marginBottom: '16px'
  },
  categoryInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  categoryIcon: {
    width: '56px',
    height: '56px',
    backgroundColor: '#1f1f2e',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: '600',
    color: '#9ca3af'
  },
  categoryTitle: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#fff',
    margin: 0
  },
  categoryDescription: {
    fontSize: '14px',
    color: '#9ca3af',
    margin: '4px 0 0 0'
  },
  assetsContainer: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: '24px'
  },
  assetSection: {
    backgroundColor: '#111118',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #1f1f2e'
  },
  assetHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  assetTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  assetTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#fff',
    margin: 0
  },
  assetCount: {
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
  uploadButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500'
  },
  assetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
    gap: '8px'
  },
  emptyState: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    border: '2px dashed #2d2d3d',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '13px'
  },
  emptyStateSmall: {
    padding: '20px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    border: '2px dashed #2d2d3d',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'center'
  },
  videoCard: {
    position: 'relative',
    aspectRatio: '9/16',
    backgroundColor: '#0a0a0f',
    borderRadius: '6px',
    overflow: 'hidden'
  },
  videoThumb: {
    width: '100%',
    height: '100%'
  },
  videoThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  videoThumbVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  videoDuration: {
    position: 'absolute',
    bottom: '6px',
    right: '6px',
    padding: '2px 6px',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: '4px',
    fontSize: '10px',
    color: '#fff'
  },
  audioList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  audioItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    backgroundColor: '#0a0a0f',
    borderRadius: '6px'
  },
  audioInfo: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  audioName: {
    fontSize: '13px',
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  audioDuration: {
    fontSize: '12px',
    color: '#6b7280'
  },
  createButtonContainer: {
    marginTop: '24px',
    display: 'flex',
    justifyContent: 'center'
  },
  createButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 28px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  categoriesGrid: {
    maxWidth: '800px',
    margin: '0 auto',
    textAlign: 'center'
  },
  gridTitle: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 8px 0'
  },
  gridSubtitle: {
    fontSize: '14px',
    color: '#9ca3af',
    margin: '0 0 32px 0'
  },
  categoryCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px'
  },
  categoryCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '24px',
    backgroundColor: '#111118',
    border: '1px solid #1f1f2e',
    borderRadius: '12px',
    cursor: 'pointer',
    textAlign: 'center'
  },
  categoryCardThumb: {
    width: '64px',
    height: '64px',
    borderRadius: '12px',
    overflow: 'hidden',
    marginBottom: '12px'
  },
  categoryCardThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  categoryCardThumbPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2d2d3d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: '600',
    color: '#9ca3af'
  },
  categoryCardInfo: {
    width: '100%'
  },
  categoryCardName: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 4px 0'
  },
  categoryCardMeta: {
    fontSize: '12px',
    color: '#6b7280',
    margin: 0
  },
  addCategoryCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '24px',
    backgroundColor: 'transparent',
    border: '2px dashed #2d2d3d',
    borderRadius: '12px',
    cursor: 'pointer',
    color: '#6b7280',
    fontSize: '13px'
  }
};

export default AestheticHome;
