import React, { useState, useRef } from 'react';
import AudioClipSelector from './AudioClipSelector';
import LyricBank from './LyricBank';
import { ConfirmDialog } from '../ui';

/**
 * AestheticHome - Studio home with mode selection
 *
 * Architecture:
 * 1. Category Selector → Shows category cards
 * 2. Mode Selector → VIDEOS card or SLIDESHOWS card
 * 3. Video Mode → Clips, Audio, Lyrics banks + actions
 * 4. Slideshow Mode → Image A, Image B, Lyrics banks + actions
 */
const AestheticHome = ({
  artists = [],
  selectedArtist,
  onSelectArtist,
  categories = [],
  selectedCategory,
  onSelectCategory,
  onCreateCategory,
  // Video mode banks
  onUploadVideos,
  onUploadAudio,
  onSaveAudioClip,
  onEditAudio,
  onDeleteBankVideo,
  onDeleteBankAudio,
  onRenameBankVideo,
  onRenameBankAudio,
  // Image banks (for slideshows)
  onUploadImages,
  onDeleteBankImage,
  // Lyric bank (shared)
  onAddLyrics,
  onUpdateLyrics,
  onDeleteLyrics,
  // Actions
  onCreateContent,
  onShowBatchPipeline,
  onViewContent,
  onMakeSlideshow,
  onMakeVideo
}) => {
  // Studio mode: null = mode selection, 'videos' = video mode, 'slideshows' = slideshow mode
  const [studioMode, setStudioMode] = useState(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [pendingAudio, setPendingAudio] = useState(null);
  const [editingAudio, setEditingAudio] = useState(null);

  // File input refs
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const imageAInputRef = useRef(null);
  const imageBInputRef = useRef(null);

  // Delete confirmation dialogs
  const [deleteVideoConfirm, setDeleteVideoConfirm] = useState({ isOpen: false, videoId: null, videoName: '' });
  const [deleteAudioConfirm, setDeleteAudioConfirm] = useState({ isOpen: false, audioId: null, audioName: '' });
  const [deleteImageConfirm, setDeleteImageConfirm] = useState({ isOpen: false, imageId: null, imageName: '', bank: 'A' });

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
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length > 0) {
      onUploadVideos(files);
    }
  };

  const handleAudioUpload = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      const file = files[0];
      const url = URL.createObjectURL(file);
      setPendingAudio({ file, url, name: file.name });
    }
    e.target.value = '';
  };

  const handleClipSave = (clipData) => {
    if (pendingAudio) {
      onUploadAudio([pendingAudio.file], {
        startTime: clipData.startTime,
        endTime: clipData.endTime,
        clipDuration: clipData.duration
      });
      setPendingAudio(null);
    }
  };

  const handleClipCancel = () => {
    if (pendingAudio?.url) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
  };

  const handleSaveClipToLibrary = (clipData) => {
    if (pendingAudio && onSaveAudioClip) {
      onSaveAudioClip({
        file: pendingAudio.file,
        originalUrl: pendingAudio.url,
        name: clipData.name,
        startTime: clipData.startTime,
        endTime: clipData.endTime,
        clipDuration: clipData.clipDuration
      });
    }
  };

  const handleEditAudio = (audio) => setEditingAudio(audio);

  const handleImageUpload = (e, bank) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length > 0 && onUploadImages) {
      onUploadImages(files, bank);
    }
  };

  const handleEditSave = (clipData) => {
    if (editingAudio && onEditAudio) {
      onEditAudio(editingAudio.id, {
        startTime: clipData.startTime,
        endTime: clipData.endTime,
        duration: clipData.duration || (clipData.endTime - clipData.startTime)
      });
    }
    setEditingAudio(null);
  };

  const handleEditCancel = () => setEditingAudio(null);

  // Back button handler - step back through navigation hierarchy
  const handleBack = () => {
    if (studioMode) {
      // If in video/slideshow mode, go back to mode selection (keep category selected)
      setStudioMode(null);
    } else if (selectedCategory) {
      // If in mode selection (category selected but no mode), go back to category list
      onSelectCategory(null);
    }
  };

  // Get counts for mode cards
  const videoCount = selectedCategory?.createdVideos?.length || 0;
  const slideshowCount = selectedCategory?.slideshows?.length || 0;

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
                onClick={() => { onSelectCategory(category); setStudioMode(null); }}
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
                  <button onClick={() => setIsCreatingCategory(false)} style={styles.newCategoryCancel}>Cancel</button>
                  <button onClick={handleCreateCategory} style={styles.newCategoryCreate} disabled={!newCategoryName.trim()}>Create</button>
                </div>
              </div>
            ) : (
              <button style={styles.addCategoryButton} onClick={() => setIsCreatingCategory(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Category
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main style={styles.main}>
        {selectedCategory ? (
          <>
            {/* Header with back navigation */}
            <div style={styles.categoryHeader}>
              <button style={styles.backButton} onClick={handleBack}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                {studioMode ? 'Back to Modes' : 'Back to Categories'}
              </button>

              <div style={styles.categoryInfo}>
                <div style={styles.categoryIcon}>{selectedCategory.name.charAt(0).toUpperCase()}</div>
                <div>
                  <h1 style={styles.categoryTitle}>
                    {selectedCategory.name}
                    {studioMode && <span style={styles.modeBadge}> › {studioMode === 'videos' ? 'Videos' : 'Slideshows'}</span>}
                  </h1>
                  <p style={styles.categoryDescription}>{selectedCategory.description || 'No description'}</p>
                </div>
              </div>
            </div>

            {/* Mode Selection View */}
            {!studioMode && (
              <div style={styles.modeSelection}>
                <h2 style={styles.modeTitle}>What do you want to create?</h2>

                <div style={styles.modeCards}>
                  {/* Videos Mode Card */}
                  <button style={styles.modeCard} onClick={() => setStudioMode('videos')}>
                    <div style={styles.modeCardIcon}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2" y="4" width="20" height="16" rx="2"/>
                        <path d="M10 9l5 3-5 3V9z" fill="currentColor"/>
                      </svg>
                    </div>
                    <h3 style={styles.modeCardTitle}>VIDEOS</h3>
                    <p style={styles.modeCardCount}>{videoCount} created</p>
                  </button>

                  {/* Slideshows Mode Card */}
                  <button style={styles.modeCard} onClick={() => setStudioMode('slideshows')}>
                    <div style={styles.modeCardIcon}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2" y="6" width="6" height="12" rx="1"/>
                        <rect x="9" y="6" width="6" height="12" rx="1"/>
                        <rect x="16" y="6" width="6" height="12" rx="1"/>
                      </svg>
                    </div>
                    <h3 style={styles.modeCardTitle}>SLIDESHOWS</h3>
                    <p style={styles.modeCardCount}>{slideshowCount} created</p>
                  </button>
                </div>

                {/* Shared Lyric Bank */}
                <div style={styles.sharedSection}>
                  <div style={styles.sharedLyricBankHeader}>
                    <span style={styles.sharedLabel}>📝 Lyric Bank ({(selectedCategory.lyrics || []).length} songs)</span>
                    <span style={styles.sharedNote}>— shared between modes</span>
                  </div>
                </div>
              </div>
            )}

            {/* Video Mode View */}
            {studioMode === 'videos' && (
              <div style={styles.modeView}>
                <div style={styles.banksAndActions}>
                  {/* Banks Column */}
                  <div style={styles.banksColumn}>
                    <h3 style={styles.columnTitle}>BANKS</h3>

                    {/* Clips Bank */}
                    <div style={styles.bankItem}>
                      <div style={styles.bankHeader}>
                        <span style={styles.bankIcon}>🎬</span>
                        <span style={styles.bankName}>Clips ({selectedCategory.videos?.length || 0})</span>
                      </div>
                      <button style={styles.bankAddButton} onClick={() => videoInputRef.current?.click()}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </button>
                      <input ref={videoInputRef} type="file" accept="video/*" multiple onChange={handleVideoUpload} style={{ display: 'none' }} />
                    </div>

                    {/* Audio Bank */}
                    <div style={styles.bankItem}>
                      <div style={styles.bankHeader}>
                        <span style={styles.bankIcon}>🎵</span>
                        <span style={styles.bankName}>Audio ({selectedCategory.audio?.length || 0})</span>
                      </div>
                      <button style={styles.bankAddButton} onClick={() => audioInputRef.current?.click()}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </button>
                      <input ref={audioInputRef} type="file" accept="audio/*" onChange={handleAudioUpload} style={{ display: 'none' }} />
                    </div>

                    {/* Lyrics Bank */}
                    <div style={styles.bankItem}>
                      <div style={styles.bankHeader}>
                        <span style={styles.bankIcon}>📝</span>
                        <span style={styles.bankName}>Lyrics ({(selectedCategory.lyrics || []).length})</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Column */}
                  <div style={styles.actionsColumn}>
                    <h3 style={styles.columnTitle}>ACTIONS</h3>

                    <button
                      style={styles.actionButton}
                      onClick={onMakeVideo || onCreateContent}
                      disabled={selectedCategory.videos?.length === 0 && selectedCategory.audio?.length === 0}
                    >
                      <span style={styles.actionIcon}>✏️</span>
                      Make a Video
                    </button>

                    <button
                      style={styles.actionButtonPurple}
                      onClick={onShowBatchPipeline}
                      disabled={selectedCategory.videos?.length === 0 || selectedCategory.audio?.length === 0}
                      title="Generate up to 10 videos at once"
                    >
                      <span style={styles.actionIcon}>📦</span>
                      Make 10 at once
                    </button>

                    <button
                      style={styles.actionButtonGreen}
                      onClick={onViewContent}
                      title="View created videos and drafts"
                    >
                      <span style={styles.actionIcon}>📁</span>
                      View Content ({videoCount})
                    </button>
                  </div>
                </div>

                {/* Expanded Banks */}
                <div style={styles.expandedBanks}>
                  {/* Video Clips Grid */}
                  <div style={styles.expandedBank}>
                    <h4 style={styles.expandedBankTitle}>Video Clips</h4>
                    <div style={styles.assetGrid}>
                      {(selectedCategory.videos || []).length === 0 ? (
                        <div style={styles.emptyState} onClick={() => videoInputRef.current?.click()}>
                          <span>Click to add video clips</span>
                        </div>
                      ) : (
                        (selectedCategory.videos || []).map(video => (
                          <VideoCard
                            key={video.id}
                            video={video}
                            onDelete={() => setDeleteVideoConfirm({ isOpen: true, videoId: video.id, videoName: video.name || 'this video' })}
                            onRename={(newName) => onRenameBankVideo?.(video.id, newName)}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  {/* Audio List */}
                  <div style={styles.expandedBank}>
                    <h4 style={styles.expandedBankTitle}>Audio Tracks</h4>
                    <div style={styles.audioList}>
                      {(selectedCategory.audio || []).length === 0 ? (
                        <div style={styles.emptyStateSmall} onClick={() => audioInputRef.current?.click()}>
                          <span>Click to add audio</span>
                        </div>
                      ) : (
                        (selectedCategory.audio || []).map(audio => (
                          <AudioItem
                            key={audio.id}
                            audio={audio}
                            onEdit={() => handleEditAudio(audio)}
                            onDelete={() => setDeleteAudioConfirm({ isOpen: true, audioId: audio.id, audioName: audio.name || 'this audio' })}
                            onRename={(newName) => onRenameBankAudio?.(audio.id, newName)}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  {/* Lyric Bank */}
                  <div style={styles.expandedBank}>
                    <LyricBank
                      lyrics={selectedCategory.lyrics || []}
                      onAddLyrics={onAddLyrics}
                      onUpdateLyrics={onUpdateLyrics}
                      onDeleteLyrics={onDeleteLyrics}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Slideshow Mode View */}
            {studioMode === 'slideshows' && (
              <div style={styles.modeView}>
                <div style={styles.banksAndActions}>
                  {/* Banks Column */}
                  <div style={styles.banksColumn}>
                    <h3 style={styles.columnTitle}>BANKS</h3>

                    {/* Image A Bank */}
                    <div style={styles.bankItem}>
                      <div style={styles.bankHeader}>
                        <span style={{...styles.bankIcon, color: '#14b8a6'}}>🖼️</span>
                        <span style={styles.bankName}>Image A ({(selectedCategory.imagesA || []).length})</span>
                      </div>
                      <button style={{...styles.bankAddButton, borderColor: '#14b8a6', color: '#14b8a6'}} onClick={() => imageAInputRef.current?.click()}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </button>
                      <input ref={imageAInputRef} type="file" accept="image/*" multiple onChange={(e) => handleImageUpload(e, 'A')} style={{ display: 'none' }} />
                    </div>

                    {/* Image B Bank */}
                    <div style={styles.bankItem}>
                      <div style={styles.bankHeader}>
                        <span style={{...styles.bankIcon, color: '#f59e0b'}}>🖼️</span>
                        <span style={styles.bankName}>Image B ({(selectedCategory.imagesB || []).length})</span>
                      </div>
                      <button style={{...styles.bankAddButton, borderColor: '#f59e0b', color: '#f59e0b'}} onClick={() => imageBInputRef.current?.click()}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </button>
                      <input ref={imageBInputRef} type="file" accept="image/*" multiple onChange={(e) => handleImageUpload(e, 'B')} style={{ display: 'none' }} />
                    </div>

                    {/* Lyrics Bank */}
                    <div style={styles.bankItem}>
                      <div style={styles.bankHeader}>
                        <span style={styles.bankIcon}>📝</span>
                        <span style={styles.bankName}>Lyrics ({(selectedCategory.lyrics || []).length})</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Column */}
                  <div style={styles.actionsColumn}>
                    <h3 style={styles.columnTitle}>ACTIONS</h3>

                    <button
                      style={styles.actionButton}
                      onClick={() => onMakeSlideshow?.()}
                      disabled={(selectedCategory.imagesA || []).length === 0 && (selectedCategory.imagesB || []).length === 0}
                    >
                      <span style={styles.actionIcon}>✏️</span>
                      Make a Slideshow
                    </button>

                    <button
                      style={styles.actionButtonPurple}
                      onClick={() => onMakeSlideshow?.({ batch: true })}
                      disabled={(selectedCategory.imagesA || []).length === 0 && (selectedCategory.imagesB || []).length === 0}
                      title="Generate 10 slideshows randomly pulling from A/B banks"
                    >
                      <span style={styles.actionIcon}>📦</span>
                      Make 10 at once
                    </button>

                    <button
                      style={styles.actionButtonGreen}
                      title="View created slideshows"
                    >
                      <span style={styles.actionIcon}>📁</span>
                      View Created ({slideshowCount})
                    </button>
                  </div>
                </div>

                {/* Expanded Banks */}
                <div style={styles.expandedBanks}>
                  {/* Image A Grid */}
                  <div style={styles.expandedBank}>
                    <h4 style={{...styles.expandedBankTitle, color: '#14b8a6'}}>Image A Bank</h4>
                    <div style={styles.imageGrid}>
                      {(selectedCategory.imagesA || []).length === 0 ? (
                        <div style={{...styles.emptyState, borderColor: '#14b8a6'}} onClick={() => imageAInputRef.current?.click()}>
                          <span style={{color: '#14b8a6'}}>Click to add Image A</span>
                        </div>
                      ) : (
                        (selectedCategory.imagesA || []).map(image => (
                          <ImageCard
                            key={image.id}
                            image={image}
                            onDelete={() => setDeleteImageConfirm({ isOpen: true, imageId: image.id, imageName: image.name, bank: 'A' })}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  {/* Image B Grid */}
                  <div style={styles.expandedBank}>
                    <h4 style={{...styles.expandedBankTitle, color: '#f59e0b'}}>Image B Bank</h4>
                    <div style={styles.imageGrid}>
                      {(selectedCategory.imagesB || []).length === 0 ? (
                        <div style={{...styles.emptyState, borderColor: '#f59e0b'}} onClick={() => imageBInputRef.current?.click()}>
                          <span style={{color: '#f59e0b'}}>Click to add Image B</span>
                        </div>
                      ) : (
                        (selectedCategory.imagesB || []).map(image => (
                          <ImageCard
                            key={image.id}
                            image={image}
                            onDelete={() => setDeleteImageConfirm({ isOpen: true, imageId: image.id, imageName: image.name, bank: 'B' })}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  {/* Lyric Bank */}
                  <div style={styles.expandedBank}>
                    <LyricBank
                      lyrics={selectedCategory.lyrics || []}
                      onAddLyrics={onAddLyrics}
                      onUpdateLyrics={onUpdateLyrics}
                      onDeleteLyrics={onDeleteLyrics}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* No Category Selected - Show Grid */
          <div style={styles.categoriesGrid}>
            <h2 style={styles.gridTitle}>Select a Category</h2>
            <p style={styles.gridSubtitle}>Choose a category to view assets and create content</p>

            <div style={styles.categoryCards}>
              {categories.map(category => (
                <button key={category.id} style={styles.categoryCard} onClick={() => onSelectCategory(category)}>
                  <div style={styles.categoryCardThumb}>
                    {category.thumbnail ? (
                      <img src={category.thumbnail} alt="" style={styles.categoryCardThumbImg} />
                    ) : (
                      <div style={styles.categoryCardThumbPlaceholder}>{category.name.charAt(0).toUpperCase()}</div>
                    )}
                  </div>
                  <div style={styles.categoryCardInfo}>
                    <h3 style={styles.categoryCardName}>{category.name}</h3>
                    <p style={styles.categoryCardMeta}>
                      {category.videos?.length || 0} clips · {category.audio?.length || 0} audio · {(category.imagesA?.length || 0) + (category.imagesB?.length || 0)} images
                    </p>
                  </div>
                </button>
              ))}

              <button style={styles.addCategoryCard} onClick={() => setIsCreatingCategory(true)}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>New Category</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {pendingAudio && (
        <AudioClipSelector
          audioFile={pendingAudio.file}
          audioUrl={pendingAudio.url}
          audioName={pendingAudio.name}
          onSave={handleClipSave}
          onSaveClip={onSaveAudioClip ? handleSaveClipToLibrary : null}
          onCancel={handleClipCancel}
        />
      )}

      {editingAudio && (
        <AudioClipSelector
          audioUrl={editingAudio.url}
          audioName={editingAudio.name}
          initialStart={editingAudio.startTime || 0}
          initialEnd={editingAudio.endTime || editingAudio.duration}
          onSave={handleEditSave}
          onCancel={handleEditCancel}
        />
      )}

      <ConfirmDialog
        isOpen={deleteVideoConfirm.isOpen}
        title="Delete video?"
        message={`This will permanently delete "${deleteVideoConfirm.videoName}" from your library.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => { onDeleteBankVideo?.(deleteVideoConfirm.videoId); setDeleteVideoConfirm({ isOpen: false, videoId: null, videoName: '' }); }}
        onCancel={() => setDeleteVideoConfirm({ isOpen: false, videoId: null, videoName: '' })}
      />

      <ConfirmDialog
        isOpen={deleteAudioConfirm.isOpen}
        title="Delete audio?"
        message={`This will permanently delete "${deleteAudioConfirm.audioName}" from your library.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => { onDeleteBankAudio?.(deleteAudioConfirm.audioId); setDeleteAudioConfirm({ isOpen: false, audioId: null, audioName: '' }); }}
        onCancel={() => setDeleteAudioConfirm({ isOpen: false, audioId: null, audioName: '' })}
      />

      <ConfirmDialog
        isOpen={deleteImageConfirm.isOpen}
        title="Delete image?"
        message={`This will permanently delete "${deleteImageConfirm.imageName}" from your library.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => { onDeleteBankImage?.(deleteImageConfirm.imageId, deleteImageConfirm.bank); setDeleteImageConfirm({ isOpen: false, imageId: null, imageName: '', bank: 'A' }); }}
        onCancel={() => setDeleteImageConfirm({ isOpen: false, imageId: null, imageName: '', bank: 'A' })}
      />
    </div>
  );
};

// ============================================
// Sub-components
// ============================================

const VideoCard = ({ video, onDelete, onRename }) => {
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(video.name || '');

  const handleRename = () => {
    if (editName.trim() && editName.trim() !== video.name) onRename(editName.trim());
    setIsEditing(false);
  };

  return (
    <div style={styles.videoCard} onMouseEnter={() => setShowActions(true)} onMouseLeave={() => { if (!isEditing) setShowActions(false); }}>
      <div style={styles.videoThumb}>
        {video.thumbnail ? (
          <img src={video.thumbnail} alt="" style={styles.videoThumbImg} />
        ) : (
          <video src={video.url} style={styles.videoThumbVideo} muted playsInline />
        )}
      </div>
      <div style={styles.videoNameContainer}>
        {isEditing ? (
          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={handleRename} onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsEditing(false); }} style={styles.videoNameInput} autoFocus />
        ) : (
          <span style={styles.videoName} onClick={() => setIsEditing(true)}>{video.name || 'Untitled'}</span>
        )}
      </div>
      <span style={styles.videoDuration}>{video.duration ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, '0')}` : '0:00'}</span>
      {showActions && !isEditing && (
        <div style={styles.videoActionBtns}>
          <button style={styles.renameVideoBtn} onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} title="Rename">✎</button>
          <button style={styles.deleteVideoBtn} onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">✕</button>
        </div>
      )}
    </div>
  );
};

const AudioItem = ({ audio, onEdit, onDelete, onRename }) => {
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(audio.name || '');

  const handleRename = () => {
    if (editName.trim() && editName.trim() !== audio.name) onRename(editName.trim());
    setIsEditing(false);
  };

  return (
    <div style={{...styles.audioItem, ...(audio.isClip ? styles.audioItemClip : {})}} onMouseEnter={() => setShowActions(true)} onMouseLeave={() => { if (!isEditing) setShowActions(false); }}>
      {audio.isClip ? <span style={styles.clipIcon}>✂️</span> : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/>
        </svg>
      )}
      <div style={styles.audioInfo}>
        {isEditing ? (
          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={handleRename} onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsEditing(false); }} style={styles.audioNameInput} autoFocus />
        ) : (
          <span style={styles.audioName} onClick={() => setIsEditing(true)}>{audio.name}</span>
        )}
        <span style={styles.audioDuration}>{audio.duration ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}` : '0:00'}</span>
      </div>
      {showActions && !isEditing && (
        <div style={styles.audioActions}>
          <button style={styles.audioActionBtn} onClick={onEdit} title="Edit trim">✂️</button>
          <button style={styles.audioActionBtn} onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} title="Rename">✎</button>
          <button style={{...styles.audioActionBtn, color: '#ef4444'}} onClick={onDelete} title="Delete">✕</button>
        </div>
      )}
    </div>
  );
};

const ImageCard = ({ image, onDelete }) => {
  const [showActions, setShowActions] = useState(false);

  return (
    <div style={styles.imageCard} onMouseEnter={() => setShowActions(true)} onMouseLeave={() => setShowActions(false)}>
      <img src={image.localUrl || image.url} alt={image.name} style={styles.imageThumb} />
      {showActions && (
        <button style={styles.imageDeleteBtn} onClick={onDelete} title="Delete">✕</button>
      )}
    </div>
  );
};

// ============================================
// Styles
// ============================================

const styles = {
  container: { display: 'flex', height: '100%', backgroundColor: '#0a0a0f' },

  // Sidebar
  sidebar: { width: '220px', borderRight: '1px solid #1f1f2e', padding: '16px', overflowY: 'auto' },
  sidebarSection: { marginBottom: '20px' },
  sidebarHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  sidebarTitle: { fontSize: '12px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 },
  categoryCount: { fontSize: '11px', color: '#6b7280', backgroundColor: '#1f1f2e', padding: '2px 6px', borderRadius: '10px' },
  categoryList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  categoryItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', backgroundColor: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', color: '#e5e7eb', transition: 'background-color 0.2s' },
  categoryItemActive: { backgroundColor: '#1f1f2e' },
  categoryThumb: { width: '32px', height: '32px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 },
  categoryThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  categoryThumbPlaceholder: { width: '100%', height: '100%', backgroundColor: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '600' },
  categoryName: { fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  addCategoryButton: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: 'transparent', border: '1px dashed #374151', borderRadius: '8px', cursor: 'pointer', color: '#6b7280', fontSize: '13px', marginTop: '8px' },
  newCategoryForm: { padding: '12px', backgroundColor: '#1f1f2e', borderRadius: '8px' },
  newCategoryInput: { width: '100%', padding: '8px', backgroundColor: '#0a0a0f', border: '1px solid #374151', borderRadius: '6px', color: '#fff', fontSize: '13px', marginBottom: '8px' },
  newCategoryActions: { display: 'flex', gap: '8px' },
  newCategoryCancel: { flex: 1, padding: '6px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: '6px', color: '#9ca3af', cursor: 'pointer', fontSize: '12px' },
  newCategoryCreate: { flex: 1, padding: '6px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '12px' },

  // Main content
  main: { flex: 1, overflow: 'auto', padding: '24px' },

  // Category Header
  categoryHeader: { marginBottom: '24px' },
  backButton: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: '6px', color: '#9ca3af', cursor: 'pointer', fontSize: '13px', marginBottom: '16px' },
  categoryInfo: { display: 'flex', alignItems: 'center', gap: '16px' },
  categoryIcon: { width: '48px', height: '48px', backgroundColor: '#1f1f2e', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '600' },
  categoryTitle: { fontSize: '24px', fontWeight: '700', color: '#fff', margin: 0 },
  modeBadge: { fontSize: '16px', fontWeight: '500', color: '#9ca3af' },
  categoryDescription: { fontSize: '14px', color: '#6b7280', margin: '4px 0 0 0' },

  // Mode Selection
  modeSelection: { textAlign: 'center', paddingTop: '40px' },
  modeTitle: { fontSize: '20px', fontWeight: '600', color: '#fff', marginBottom: '32px' },
  modeCards: { display: 'flex', justifyContent: 'center', gap: '24px', marginBottom: '48px' },
  modeCard: { width: '200px', padding: '32px 24px', backgroundColor: '#111118', border: '2px solid #1f1f2e', borderRadius: '16px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' },
  modeCardIcon: { color: '#9ca3af', marginBottom: '16px' },
  modeCardTitle: { fontSize: '18px', fontWeight: '700', color: '#fff', margin: '0 0 8px 0' },
  modeCardCount: { fontSize: '14px', color: '#6b7280', margin: 0 },
  sharedSection: { borderTop: '1px solid #1f1f2e', paddingTop: '24px', maxWidth: '500px', margin: '0 auto' },
  sharedLyricBankHeader: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  sharedLabel: { fontSize: '14px', color: '#9ca3af' },
  sharedNote: { fontSize: '12px', color: '#6b7280', fontStyle: 'italic' },

  // Mode View (Banks + Actions layout)
  modeView: {},
  banksAndActions: { display: 'flex', gap: '40px', marginBottom: '32px', padding: '24px', backgroundColor: '#111118', borderRadius: '12px', border: '1px solid #1f1f2e' },
  banksColumn: { flex: 1 },
  actionsColumn: { flex: 1 },
  columnTitle: { fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' },
  bankItem: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: '#0a0a0f', borderRadius: '8px', marginBottom: '8px' },
  bankHeader: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1 },
  bankIcon: { fontSize: '16px' },
  bankName: { fontSize: '14px', color: '#e5e7eb' },
  bankAddButton: { padding: '4px 10px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: '4px', color: '#9ca3af', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' },
  actionButton: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '14px 16px', backgroundColor: '#1f1f2e', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500', marginBottom: '10px' },
  actionButtonGreen: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '14px 16px', backgroundColor: '#065f46', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500', marginBottom: '10px' },
  actionButtonPurple: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '14px 16px', backgroundColor: '#5b21b6', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500', marginBottom: '10px' },
  actionIcon: { fontSize: '16px' },

  // Expanded Banks
  expandedBanks: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' },
  expandedBank: { backgroundColor: '#111118', borderRadius: '12px', padding: '16px', border: '1px solid #1f1f2e' },
  expandedBankTitle: { fontSize: '14px', fontWeight: '600', color: '#9ca3af', marginBottom: '12px' },
  assetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px' },
  imageGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' },
  audioList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  emptyState: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', border: '2px dashed #374151', borderRadius: '8px', cursor: 'pointer', color: '#6b7280', fontSize: '13px' },
  emptyStateSmall: { padding: '16px', border: '1px dashed #374151', borderRadius: '6px', textAlign: 'center', cursor: 'pointer', color: '#6b7280', fontSize: '12px' },

  // Video Card
  videoCard: { position: 'relative', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#1f1f2e', cursor: 'pointer' },
  videoThumb: { aspectRatio: '16/9', backgroundColor: '#0a0a0f' },
  videoThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  videoThumbVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  videoNameContainer: { padding: '8px', backgroundColor: '#1f1f2e' },
  videoName: { fontSize: '11px', color: '#9ca3af', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  videoNameInput: { width: '100%', padding: '2px 4px', backgroundColor: '#0a0a0f', border: '1px solid #7c3aed', borderRadius: '4px', color: '#fff', fontSize: '11px' },
  videoDuration: { position: 'absolute', bottom: '32px', right: '6px', padding: '2px 6px', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: '4px', fontSize: '10px', color: '#fff' },
  videoActionBtns: { position: 'absolute', top: '6px', right: '6px', display: 'flex', gap: '4px' },
  renameVideoBtn: { padding: '4px 6px', backgroundColor: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },
  deleteVideoBtn: { padding: '4px 6px', backgroundColor: 'rgba(239,68,68,0.8)', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },

  // Audio Item
  audioItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', backgroundColor: '#1f1f2e', borderRadius: '8px', color: '#9ca3af' },
  audioItemClip: { borderLeft: '3px solid #7c3aed' },
  clipIcon: { fontSize: '14px' },
  audioInfo: { flex: 1, minWidth: 0 },
  audioName: { display: 'block', fontSize: '13px', color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' },
  audioNameInput: { width: '100%', padding: '2px 4px', backgroundColor: '#0a0a0f', border: '1px solid #7c3aed', borderRadius: '4px', color: '#fff', fontSize: '12px' },
  audioDuration: { fontSize: '11px', color: '#6b7280' },
  audioActions: { display: 'flex', gap: '4px' },
  audioActionBtn: { padding: '4px 6px', backgroundColor: '#0a0a0f', border: 'none', borderRadius: '4px', color: '#9ca3af', cursor: 'pointer', fontSize: '12px' },

  // Image Card
  imageCard: { position: 'relative', borderRadius: '6px', overflow: 'hidden', aspectRatio: '1', backgroundColor: '#1f1f2e' },
  imageThumb: { width: '100%', height: '100%', objectFit: 'cover' },
  imageDeleteBtn: { position: 'absolute', top: '4px', right: '4px', padding: '4px 6px', backgroundColor: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '10px' },

  // Category Cards Grid
  categoriesGrid: { textAlign: 'center', paddingTop: '60px' },
  gridTitle: { fontSize: '24px', fontWeight: '600', color: '#fff', marginBottom: '8px' },
  gridSubtitle: { fontSize: '14px', color: '#6b7280', marginBottom: '40px' },
  categoryCards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', maxWidth: '800px', margin: '0 auto' },
  categoryCard: { padding: '20px', backgroundColor: '#111118', border: '1px solid #1f1f2e', borderRadius: '12px', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.2s' },
  categoryCardThumb: { width: '100%', aspectRatio: '16/9', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px', backgroundColor: '#1f1f2e' },
  categoryCardThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  categoryCardThumbPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: '600', color: '#6b7280' },
  categoryCardInfo: {},
  categoryCardName: { fontSize: '16px', fontWeight: '600', color: '#fff', margin: '0 0 4px 0' },
  categoryCardMeta: { fontSize: '12px', color: '#6b7280', margin: 0 },
  addCategoryCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '40px 20px', backgroundColor: 'transparent', border: '2px dashed #374151', borderRadius: '12px', cursor: 'pointer', color: '#6b7280', fontSize: '14px' }
};

export default AestheticHome;
