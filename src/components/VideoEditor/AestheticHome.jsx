import React, { useState, useRef, useEffect } from 'react';
import useIsMobile from '../../hooks/useIsMobile';
import { useTheme } from '../../contexts/ThemeContext';
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
  // Studio mode (lifted to VideoStudio for breadcrumb)
  studioMode,
  onSetStudioMode,
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
  onEditSlideshow,
  onDeleteSlideshow,
  onMakeVideo
}) => {
  // Use the lifted studioMode setter
  const setStudioMode = onSetStudioMode || (() => {});
  const { theme } = useTheme();
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [pendingAudio, setPendingAudio] = useState(null);
  const [editingAudio, setEditingAudio] = useState(null);

  // Mobile responsive state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isMobile } = useIsMobile();

  // Auto-close sidebar when resizing to desktop
  useEffect(() => {
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  // File input refs
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const imageAInputRef = useRef(null);
  const imageBInputRef = useRef(null);

  // Lyrics prompt modal state (replaces window.prompt)
  const [showLyricsPrompt, setShowLyricsPrompt] = useState(false);
  const [lyricsPromptValue, setLyricsPromptValue] = useState('');

  // Delete confirmation dialogs
  const [deleteVideoConfirm, setDeleteVideoConfirm] = useState({ isOpen: false, videoId: null, videoName: '' });
  const [deleteAudioConfirm, setDeleteAudioConfirm] = useState({ isOpen: false, audioId: null, audioName: '' });
  const [deleteImageConfirm, setDeleteImageConfirm] = useState({ isOpen: false, imageId: null, imageName: '', bank: 'A' });
  const [deleteSlideshowConfirm, setDeleteSlideshowConfirm] = useState({ isOpen: false, slideshowId: null, slideshowName: '' });

  // Note: Library views now use onViewContent to navigate to full content library page

  const handleCreateCategory = () => {
    const trimmed = newCategoryName.trim();
    if (trimmed && trimmed.length <= 50) {
      onCreateCategory({
        name: trimmed,
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
    if (clipData.trimmedFile) {
      // Audio was actually trimmed to a new file — upload the trimmed copy (no trim metadata needed)
      onUploadAudio([clipData.trimmedFile], null, clipData.trimmedName);
      setPendingAudio(null);
    } else if (pendingAudio) {
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

  const styles = getStyles(theme);

  return (
    <div style={styles.container}>
      {/* Mobile sidebar toggle button */}
      {isMobile && !mobileSidebarOpen && (
        <button
          onClick={() => setMobileSidebarOpen(true)}
          style={styles.mobileSidebarToggle}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span style={{ marginLeft: '8px', fontSize: '13px' }}>Categories</span>
        </button>
      )}

      {/* Mobile sidebar overlay */}
      {isMobile && mobileSidebarOpen && (
        <div
          style={styles.mobileSidebarOverlay}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Categories */}
      <aside style={{
        ...styles.sidebar,
        ...(isMobile ? styles.sidebarMobile : {}),
        ...(isMobile && !mobileSidebarOpen ? styles.sidebarMobileHidden : {}),
        ...(isMobile && mobileSidebarOpen ? styles.sidebarMobileOpen : {})
      }}>
        {/* Mobile close button */}
        {isMobile && (
          <button
            onClick={() => setMobileSidebarOpen(false)}
            style={styles.mobileSidebarClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
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
                onClick={() => { onSelectCategory(category); setStudioMode(null); setMobileSidebarOpen(false); }}
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
      <main style={{
        ...styles.main,
        ...(isMobile ? { padding: '16px' } : {})
      }}>
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
              <div style={{
                ...styles.modeSelection,
                ...(isMobile ? { paddingTop: '20px' } : {})
              }}>
                <h2 style={styles.modeTitle}>What do you want to create?</h2>

                <div style={{
                  ...styles.modeCards,
                  ...(isMobile ? { flexDirection: 'column', alignItems: 'center', gap: '16px' } : {})
                }}>
                  {/* Videos Mode Card */}
                  <div style={styles.modeCard}>
                    <button style={styles.modeCardMain} onClick={() => setStudioMode('videos')}>
                      <div style={styles.modeCardIcon}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="2" y="4" width="20" height="16" rx="2"/>
                          <path d="M10 9l5 3-5 3V9z" fill="currentColor"/>
                        </svg>
                      </div>
                      <h3 style={styles.modeCardTitle}>VIDEOS</h3>
                      <p style={styles.modeCardCount}>{videoCount} created</p>
                    </button>
                    {videoCount > 0 && (
                      <button
                        style={styles.modeCardViewBtn}
                        onClick={(e) => { e.stopPropagation(); onViewContent?.(); }}
                      >
                        📁 View Library
                      </button>
                    )}
                  </div>

                  {/* Slideshows Mode Card */}
                  <div style={styles.modeCard}>
                    <button style={styles.modeCardMain} onClick={() => setStudioMode('slideshows')}>
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
                    {slideshowCount > 0 && (
                      <button
                        style={styles.modeCardViewBtn}
                        onClick={(e) => { e.stopPropagation(); onViewContent?.({ type: 'slideshows' }); }}
                      >
                        📁 View Library
                      </button>
                    )}
                  </div>
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
                <div style={{
                  ...styles.banksAndActions,
                  ...(isMobile ? { flexDirection: 'column', gap: '24px', padding: '16px' } : {})
                }}>
                  {/* Banks Column */}
                  <div style={styles.banksColumn}>
                    <h3 style={styles.columnTitle}>BANKS</h3>

                    {/* Clips Bank */}
                    <div style={{
                      ...styles.bankItem,
                      ...(isMobile ? { padding: '14px', flexWrap: 'wrap', gap: '10px' } : {})
                    }}>
                      <div style={styles.bankHeader}>
                        <span style={{...styles.bankIcon, color: '#14b8a6'}}>🎬</span>
                        <span style={styles.bankName}>Clips ({selectedCategory.videos?.length || 0})</span>
                      </div>
                      <label
                        htmlFor="video-bank-input"
                        style={{
                          ...styles.bankAddButton,
                          borderColor: '#14b8a6',
                          color: '#14b8a6',
                          cursor: 'pointer',
                          ...(isMobile ? { padding: '10px 16px', fontSize: '14px', minHeight: '44px' } : {})
                        }}
                      >
                        <svg width={isMobile ? 16 : 12} height={isMobile ? 16 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </label>
                      <input id="video-bank-input" ref={videoInputRef} type="file" accept="video/*" multiple onChange={handleVideoUpload} style={{ display: 'none' }} />
                    </div>

                    {/* Audio Bank */}
                    <div style={{
                      ...styles.bankItem,
                      ...(isMobile ? { padding: '14px', flexWrap: 'wrap', gap: '10px' } : {})
                    }}>
                      <div style={styles.bankHeader}>
                        <span style={{...styles.bankIcon, color: '#22c55e'}}>🎵</span>
                        <span style={styles.bankName}>Audio ({selectedCategory.audio?.length || 0})</span>
                      </div>
                      <label
                        htmlFor="audio-bank-input"
                        style={{
                          ...styles.bankAddButton,
                          borderColor: '#22c55e',
                          color: '#22c55e',
                          cursor: 'pointer',
                          ...(isMobile ? { padding: '10px 16px', fontSize: '14px', minHeight: '44px' } : {})
                        }}
                      >
                        <svg width={isMobile ? 16 : 12} height={isMobile ? 16 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </label>
                      <input id="audio-bank-input" ref={audioInputRef} type="file" accept="audio/*,.m4a,.wav,.aif,.aiff" onChange={handleAudioUpload} style={{ display: 'none' }} />
                    </div>

                    {/* Lyrics Bank */}
                    <div style={{
                      ...styles.bankItem,
                      ...(isMobile ? { padding: '14px', flexWrap: 'wrap', gap: '10px' } : {})
                    }}>
                      <div style={styles.bankHeader}>
                        <span style={styles.bankIcon}>📝</span>
                        <span style={styles.bankName}>Lyrics ({(selectedCategory.lyrics || []).length})</span>
                      </div>
                      <button
                        style={{
                          ...styles.bankAddButton,
                          borderColor: '#a855f7',
                          color: '#a855f7',
                          ...(isMobile ? { padding: '10px 16px', fontSize: '14px', minHeight: '44px' } : {})
                        }}
                        onClick={() => {
                          setLyricsPromptValue('');
                          setShowLyricsPrompt(true);
                        }}
                      >
                        <svg width={isMobile ? 16 : 12} height={isMobile ? 16 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Actions Column */}
                  <div style={styles.actionsColumn}>
                    <h3 style={styles.columnTitle}>ACTIONS</h3>

                    <button
                      style={{
                        ...styles.actionButton,
                        ...(isMobile ? { padding: '16px', fontSize: '15px' } : {})
                      }}
                      onClick={onMakeVideo || onCreateContent}
                      disabled={selectedCategory.videos?.length === 0 && selectedCategory.audio?.length === 0}
                    >
                      <span style={styles.actionIcon}>✏️</span>
                      Make a Video
                    </button>

                    <button
                      style={{
                        ...styles.actionButtonPurple,
                        ...(isMobile ? { padding: '16px', fontSize: '15px' } : {})
                      }}
                      onClick={onShowBatchPipeline}
                      disabled={selectedCategory.videos?.length === 0 || selectedCategory.audio?.length === 0}
                      title="Generate up to 10 videos at once"
                    >
                      <span style={styles.actionIcon}>📦</span>
                      Make 10 at once
                    </button>

                    <button
                      style={{
                        ...styles.actionButtonGreen,
                        ...(isMobile ? { padding: '16px', fontSize: '15px' } : {})
                      }}
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
                        <label htmlFor="video-bank-input" style={{...styles.emptyState, cursor: 'pointer'}}>
                          <span>Tap to add video clips</span>
                        </label>
                      ) : (
                        (selectedCategory.videos || []).map(video => (
                          <VideoCard
                            key={video.id}
                            video={video}
                            isMobile={isMobile}
                            onDelete={() => setDeleteVideoConfirm({ isOpen: true, videoId: video.id, videoName: video.name || 'this video' })}
                            onRename={(newName) => onRenameBankVideo?.(video.id, newName)}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  {/* Audio Bank Grid - matches Slideshow styling */}
                  <div style={styles.expandedBank}>
                    <h4 style={{...styles.expandedBankTitle, color: '#22c55e'}}>🎵 Audio Bank</h4>
                    <div style={styles.audioGrid}>
                      {(selectedCategory.audio || []).length === 0 ? (
                        <label htmlFor="audio-bank-input" style={{...styles.emptyState, borderColor: '#22c55e', cursor: 'pointer'}}>
                          <span style={{color: '#22c55e'}}>Tap to add audio</span>
                        </label>
                      ) : (
                        (selectedCategory.audio || []).map(audio => (
                          <div key={audio.id} style={styles.audioCard}>
                            <div style={styles.audioCardIcon}>🎵</div>
                            <div style={styles.audioCardInfo}>
                              <div style={styles.audioCardName}>{audio.name}</div>
                              <div style={styles.audioCardDuration}>
                                {audio.duration ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}` : '--:--'}
                              </div>
                            </div>
                            <button
                              style={styles.audioDeleteBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteAudioConfirm({ isOpen: true, audioId: audio.id, audioName: audio.name || 'this audio' });
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                              </svg>
                            </button>
                          </div>
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
                <div style={{
                  ...styles.banksAndActions,
                  ...(isMobile ? { flexDirection: 'column', gap: '24px', padding: '16px' } : {})
                }}>
                  {/* Banks Column */}
                  <div style={styles.banksColumn}>
                    <h3 style={styles.columnTitle}>BANKS</h3>

                    {/* Image A Bank */}
                    <div style={{
                      ...styles.bankItem,
                      ...(isMobile ? { padding: '14px', flexWrap: 'wrap', gap: '10px' } : {})
                    }}>
                      <div style={styles.bankHeader}>
                        <span style={{...styles.bankIcon, color: '#14b8a6'}}>🖼️</span>
                        <span style={styles.bankName}>Image A ({(selectedCategory.imagesA || []).length})</span>
                      </div>
                      <label
                        htmlFor="image-a-bank-input"
                        style={{
                          ...styles.bankAddButton,
                          borderColor: '#14b8a6',
                          color: '#14b8a6',
                          cursor: 'pointer',
                          ...(isMobile ? { padding: '10px 16px', fontSize: '14px', minHeight: '44px' } : {})
                        }}
                      >
                        <svg width={isMobile ? 16 : 12} height={isMobile ? 16 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </label>
                      <input id="image-a-bank-input" ref={imageAInputRef} type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple onChange={(e) => handleImageUpload(e, 'A')} style={{ display: 'none' }} />
                    </div>

                    {/* Image B Bank */}
                    <div style={{
                      ...styles.bankItem,
                      ...(isMobile ? { padding: '14px', flexWrap: 'wrap', gap: '10px' } : {})
                    }}>
                      <div style={styles.bankHeader}>
                        <span style={{...styles.bankIcon, color: '#f59e0b'}}>🖼️</span>
                        <span style={styles.bankName}>Image B ({(selectedCategory.imagesB || []).length})</span>
                      </div>
                      <label
                        htmlFor="image-b-bank-input"
                        style={{
                          ...styles.bankAddButton,
                          borderColor: '#f59e0b',
                          color: '#f59e0b',
                          cursor: 'pointer',
                          ...(isMobile ? { padding: '10px 16px', fontSize: '14px', minHeight: '44px' } : {})
                        }}
                      >
                        <svg width={isMobile ? 16 : 12} height={isMobile ? 16 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </label>
                      <input id="image-b-bank-input" ref={imageBInputRef} type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple onChange={(e) => handleImageUpload(e, 'B')} style={{ display: 'none' }} />
                    </div>

                    {/* Audio Bank (for slideshows) */}
                    <div style={{
                      ...styles.bankItem,
                      ...(isMobile ? { padding: '14px', flexWrap: 'wrap', gap: '10px' } : {})
                    }}>
                      <div style={styles.bankHeader}>
                        <span style={{...styles.bankIcon, color: '#22c55e'}}>🎵</span>
                        <span style={styles.bankName}>Audio ({(selectedCategory.audio || []).length})</span>
                      </div>
                      <label
                        htmlFor="audio-bank-input"
                        style={{
                          ...styles.bankAddButton,
                          borderColor: '#22c55e',
                          color: '#22c55e',
                          cursor: 'pointer',
                          ...(isMobile ? { padding: '10px 16px', fontSize: '14px', minHeight: '44px' } : {})
                        }}
                      >
                        <svg width={isMobile ? 16 : 12} height={isMobile ? 16 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </label>
                    </div>

                    {/* Lyrics Bank */}
                    <div style={{
                      ...styles.bankItem,
                      ...(isMobile ? { padding: '14px', flexWrap: 'wrap', gap: '10px' } : {})
                    }}>
                      <div style={styles.bankHeader}>
                        <span style={styles.bankIcon}>📝</span>
                        <span style={styles.bankName}>Lyrics ({(selectedCategory.lyrics || []).length})</span>
                      </div>
                      <button
                        style={{
                          ...styles.bankAddButton,
                          borderColor: '#a855f7',
                          color: '#a855f7',
                          ...(isMobile ? { padding: '10px 16px', fontSize: '14px', minHeight: '44px' } : {})
                        }}
                        onClick={() => {
                          setLyricsPromptValue('');
                          setShowLyricsPrompt(true);
                        }}
                      >
                        <svg width={isMobile ? 16 : 12} height={isMobile ? 16 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Actions Column */}
                  <div style={styles.actionsColumn}>
                    <h3 style={styles.columnTitle}>ACTIONS</h3>

                    <button
                      style={{
                        ...styles.actionButton,
                        ...(isMobile ? { padding: '16px', fontSize: '15px' } : {})
                      }}
                      onClick={() => onMakeSlideshow?.()}
                      disabled={(selectedCategory.imagesA || []).length === 0 && (selectedCategory.imagesB || []).length === 0}
                    >
                      <span style={styles.actionIcon}>✏️</span>
                      Make a Slideshow
                    </button>

                    <button
                      style={{
                        ...styles.actionButtonPurple,
                        ...(isMobile ? { padding: '16px', fontSize: '15px' } : {})
                      }}
                      onClick={() => {
                        onMakeSlideshow?.({ batch: true });
                        // Auto-navigate to slideshow library after batch creation
                        setTimeout(() => onViewContent?.({ type: 'slideshows' }), 100);
                      }}
                      disabled={(selectedCategory.imagesA || []).length === 0 || (selectedCategory.imagesB || []).length === 0}
                      title="Generate 10 slideshows randomly pulling from A/B banks"
                    >
                      <span style={styles.actionIcon}>📦</span>
                      Make 10 at once
                    </button>

                    <button
                      style={{
                        ...styles.actionButtonGreen,
                        ...(isMobile ? { padding: '16px', fontSize: '15px' } : {})
                      }}
                      title="View created slideshows"
                      onClick={() => onViewContent?.({ type: 'slideshows' })}
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
                        <label htmlFor="image-a-bank-input" style={{...styles.emptyState, borderColor: '#14b8a6', cursor: 'pointer'}}>
                          <span style={{color: '#14b8a6'}}>Tap to add Image A</span>
                        </label>
                      ) : (
                        (selectedCategory.imagesA || []).map(image => (
                          <ImageCard
                            key={image.id}
                            image={image}
                            isMobile={isMobile}
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
                        <label htmlFor="image-b-bank-input" style={{...styles.emptyState, borderColor: '#f59e0b', cursor: 'pointer'}}>
                          <span style={{color: '#f59e0b'}}>Tap to add Image B</span>
                        </label>
                      ) : (
                        (selectedCategory.imagesB || []).map(image => (
                          <ImageCard
                            key={image.id}
                            image={image}
                            isMobile={isMobile}
                            onDelete={() => setDeleteImageConfirm({ isOpen: true, imageId: image.id, imageName: image.name, bank: 'B' })}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  {/* Audio Bank Grid */}
                  <div style={styles.expandedBank}>
                    <h4 style={{...styles.expandedBankTitle, color: '#22c55e'}}>🎵 Audio Bank</h4>
                    <div style={styles.audioGrid}>
                      {(selectedCategory.audio || []).length === 0 ? (
                        <label htmlFor="audio-bank-input" style={{...styles.emptyState, borderColor: '#22c55e', cursor: 'pointer'}}>
                          <span style={{color: '#22c55e'}}>Tap to add audio</span>
                        </label>
                      ) : (
                        (selectedCategory.audio || []).map(audio => (
                          <div key={audio.id} style={styles.audioCard}>
                            <div style={styles.audioCardIcon}>🎵</div>
                            <div style={styles.audioCardInfo}>
                              <div style={styles.audioCardName}>{audio.name}</div>
                              <div style={styles.audioCardDuration}>
                                {audio.clipDuration ? `${Math.floor(audio.clipDuration / 60)}:${String(Math.floor(audio.clipDuration % 60)).padStart(2, '0')}` : '--:--'}
                              </div>
                            </div>
                            <button
                              style={styles.audioDeleteBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteAudioConfirm({ isOpen: true, audioId: audio.id, audioName: audio.name });
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                              </svg>
                            </button>
                          </div>
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

      <ConfirmDialog
        isOpen={deleteSlideshowConfirm.isOpen}
        title="Delete slideshow?"
        message={`This will permanently delete "${deleteSlideshowConfirm.slideshowName}".`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => { onDeleteSlideshow?.(deleteSlideshowConfirm.slideshowId); setDeleteSlideshowConfirm({ isOpen: false, slideshowId: null, slideshowName: '' }); }}
        onCancel={() => setDeleteSlideshowConfirm({ isOpen: false, slideshowId: null, slideshowName: '' })}
      />

      {/* Lyrics Prompt Modal (replaces window.prompt) */}
      {showLyricsPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: theme.overlay.heavy, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowLyricsPrompt(false)}>
          <div style={{ background: theme.bg.input, borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ color: theme.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Add Lyrics</div>
            <textarea
              autoFocus
              value={lyricsPromptValue}
              onChange={e => setLyricsPromptValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setShowLyricsPrompt(false); }}
              placeholder="Enter lyrics to add to bank..."
              style={{ width: '100%', minHeight: 100, background: theme.bg.page, border: `1px solid ${theme.bg.elevated}`, borderRadius: 8, padding: 12, color: theme.text.primary, fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setShowLyricsPrompt(false)}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${theme.bg.elevated}`, background: 'transparent', color: theme.text.secondary, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => {
                const text = lyricsPromptValue;
                if (text?.trim()) {
                  onAddLyrics?.({ title: text.split('\n')[0].slice(0, 30) || 'New Lyrics', content: text.trim() });
                }
                setShowLyricsPrompt(false);
              }}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: theme.accent.primary, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// ============================================
// Sub-components
// ============================================

const VideoCard = ({ video, onDelete, onRename, isMobile = false }) => {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(video.name || '');
  const actionsVisible = isMobile || showActions;

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
      {actionsVisible && !isEditing && (
        <div style={styles.videoActionBtns}>
          <button style={{...styles.renameVideoBtn, ...(isMobile ? { minWidth: 44, minHeight: 44 } : {})}} onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} title="Rename">✎</button>
          <button style={{...styles.deleteVideoBtn, ...(isMobile ? { minWidth: 44, minHeight: 44 } : {})}} onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">✕</button>
        </div>
      )}
    </div>
  );
};

const AudioItem = ({ audio, onEdit, onDelete, onRename }) => {
  const { theme } = useTheme();
  const styles = getStyles(theme);
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
          <button style={{...styles.audioActionBtn, color: theme.state.error}} onClick={onDelete} title="Delete">✕</button>
        </div>
      )}
    </div>
  );
};

const ImageCard = ({ image, onDelete, isMobile = false }) => {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const [showActions, setShowActions] = useState(false);
  const actionsVisible = isMobile || showActions;

  return (
    <div style={styles.imageCard} onMouseEnter={() => setShowActions(true)} onMouseLeave={() => setShowActions(false)}>
      <img src={image.url || image.localUrl} alt={image.name} style={styles.imageThumb} />
      {actionsVisible && (
        <button style={{...styles.imageDeleteBtn, ...(isMobile ? { minWidth: 44, minHeight: 44 } : {})}} onClick={onDelete} title="Delete">✕</button>
      )}
    </div>
  );
};

// ============================================
// Styles
// ============================================

const getStyles = (theme) => ({
  container: { display: 'flex', height: '100%', backgroundColor: theme.bg.page, position: 'relative' },

  // Mobile sidebar toggle button
  mobileSidebarToggle: {
    position: 'fixed',
    bottom: '20px',
    left: '20px',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: theme.accent.primary,
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)'
  },

  // Mobile sidebar overlay (dark backdrop)
  mobileSidebarOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: theme.overlay.heavy,
    zIndex: 199
  },

  // Mobile sidebar close button
  mobileSidebarClose: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.border.subtle,
    border: 'none',
    borderRadius: '8px',
    color: theme.text.secondary,
    cursor: 'pointer'
  },

  // Sidebar
  sidebar: { width: '220px', borderRight: `1px solid ${theme.bg.surface}`, padding: '16px', overflowY: 'auto', flexShrink: 0 },

  // Mobile sidebar styles
  sidebarMobile: {
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    width: '280px',
    maxWidth: '85vw',
    zIndex: 200,
    backgroundColor: theme.bg.page,
    transition: 'transform 0.3s ease',
    boxShadow: '4px 0 24px rgba(0, 0, 0, 0.5)'
  },
  sidebarMobileHidden: {
    transform: 'translateX(-100%)'
  },
  sidebarMobileOpen: {
    transform: 'translateX(0)'
  },
  sidebarSection: { marginBottom: '20px' },
  sidebarHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  sidebarTitle: { fontSize: '12px', fontWeight: '600', color: theme.text.secondary, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 },
  categoryCount: { fontSize: '11px', color: theme.text.muted, backgroundColor: theme.bg.surface, padding: '2px 6px', borderRadius: '10px' },
  categoryList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  categoryItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', backgroundColor: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', color: theme.text.primary, transition: 'background-color 0.2s' },
  categoryItemActive: { backgroundColor: theme.bg.surface },
  categoryThumb: { width: '32px', height: '32px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 },
  categoryThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  categoryThumbPlaceholder: { width: '100%', height: '100%', backgroundColor: theme.bg.elevated, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '600' },
  categoryName: { fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  addCategoryButton: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: 'transparent', border: `1px dashed ${theme.border.default}`, borderRadius: '8px', cursor: 'pointer', color: theme.text.muted, fontSize: '13px', marginTop: '8px' },
  newCategoryForm: { padding: '12px', backgroundColor: theme.bg.surface, borderRadius: '8px' },
  newCategoryInput: { width: '100%', padding: '8px', backgroundColor: theme.bg.page, border: `1px solid ${theme.border.default}`, borderRadius: '6px', color: theme.text.primary, fontSize: '13px', marginBottom: '8px' },
  newCategoryActions: { display: 'flex', gap: '8px' },
  newCategoryCancel: { flex: 1, padding: '6px', backgroundColor: 'transparent', border: `1px solid ${theme.border.default}`, borderRadius: '6px', color: theme.text.secondary, cursor: 'pointer', fontSize: '12px' },
  newCategoryCreate: { flex: 1, padding: '6px', backgroundColor: theme.accent.primary, border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '12px' },

  // Main content
  main: { flex: 1, overflow: 'auto', padding: '24px' },

  // Category Header
  categoryHeader: { marginBottom: '24px' },
  backButton: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', backgroundColor: 'transparent', border: `1px solid ${theme.border.default}`, borderRadius: '6px', color: theme.text.secondary, cursor: 'pointer', fontSize: '13px', marginBottom: '16px' },
  categoryInfo: { display: 'flex', alignItems: 'center', gap: '16px' },
  categoryIcon: { width: '48px', height: '48px', backgroundColor: theme.bg.surface, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '600' },
  categoryTitle: { fontSize: '24px', fontWeight: '700', color: theme.text.primary, margin: 0 },
  modeBadge: { fontSize: '16px', fontWeight: '500', color: theme.text.secondary },
  categoryDescription: { fontSize: '14px', color: theme.text.muted, margin: '4px 0 0 0' },

  // Mode Selection
  modeSelection: { textAlign: 'center', paddingTop: '40px' },
  modeTitle: { fontSize: '20px', fontWeight: '600', color: theme.text.primary, marginBottom: '32px' },
  modeCards: { display: 'flex', justifyContent: 'center', gap: '24px', marginBottom: '48px' },
  modeCard: { width: '200px', backgroundColor: theme.bg.input, border: `2px solid ${theme.bg.surface}`, borderRadius: '16px', transition: 'all 0.2s', textAlign: 'center', overflow: 'hidden' },
  modeCardMain: { width: '100%', padding: '32px 24px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'center' },
  modeCardIcon: { color: theme.text.secondary, marginBottom: '16px' },
  modeCardTitle: { fontSize: '18px', fontWeight: '700', color: theme.text.primary, margin: '0 0 8px 0' },
  modeCardCount: { fontSize: '14px', color: theme.text.muted, margin: 0 },
  modeCardViewBtn: { width: '100%', padding: '12px', backgroundColor: theme.bg.surface, border: 'none', borderTop: `1px solid ${theme.bg.elevated}`, color: theme.text.secondary, fontSize: '13px', cursor: 'pointer', transition: 'background-color 0.2s' },
  sharedSection: { borderTop: `1px solid ${theme.bg.surface}`, paddingTop: '24px', maxWidth: '500px', margin: '0 auto' },
  sharedLyricBankHeader: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  sharedLabel: { fontSize: '14px', color: theme.text.secondary },
  sharedNote: { fontSize: '12px', color: theme.text.muted, fontStyle: 'italic' },

  // Mode View (Banks + Actions layout)
  modeView: {},
  banksAndActions: { display: 'flex', gap: '40px', marginBottom: '32px', padding: '24px', backgroundColor: theme.bg.input, borderRadius: '12px', border: `1px solid ${theme.bg.surface}` },
  banksColumn: { flex: 1 },
  actionsColumn: { flex: 1 },
  columnTitle: { fontSize: '11px', fontWeight: '600', color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' },
  bankItem: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: theme.bg.page, borderRadius: '8px', marginBottom: '8px' },
  bankHeader: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1 },
  bankIcon: { fontSize: '16px' },
  bankName: { fontSize: '14px', color: theme.text.primary },
  bankAddButton: { padding: '4px 10px', backgroundColor: 'transparent', border: `1px solid ${theme.border.default}`, borderRadius: '4px', color: theme.text.secondary, cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' },
  actionButton: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '14px 16px', backgroundColor: theme.bg.surface, border: 'none', borderRadius: '8px', color: theme.text.primary, cursor: 'pointer', fontSize: '14px', fontWeight: '500', marginBottom: '10px' },
  actionButtonGreen: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '14px 16px', backgroundColor: '#065f46', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500', marginBottom: '10px' },
  actionButtonPurple: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '14px 16px', backgroundColor: '#5b21b6', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500', marginBottom: '10px' },
  actionIcon: { fontSize: '16px' },

  // Expanded Banks
  expandedBanks: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' },
  expandedBank: { backgroundColor: theme.bg.input, borderRadius: '12px', padding: '16px', border: `1px solid ${theme.bg.surface}` },
  expandedBankTitle: { fontSize: '14px', fontWeight: '600', color: theme.text.secondary, marginBottom: '12px' },
  assetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px' },
  imageGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' },
  audioGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
  audioCard: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', backgroundColor: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: '8px' },
  audioCardIcon: { fontSize: '20px' },
  audioCardInfo: { flex: 1, minWidth: 0 },
  audioCardName: { fontSize: '13px', fontWeight: '500', color: theme.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  audioCardDuration: { fontSize: '11px', color: '#86efac' },
  audioDeleteBtn: { padding: '6px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '4px', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  audioList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  emptyState: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', border: `2px dashed ${theme.border.default}`, borderRadius: '8px', cursor: 'pointer', color: theme.text.muted, fontSize: '13px' },
  emptyStateSmall: { padding: '16px', border: `1px dashed ${theme.border.default}`, borderRadius: '6px', textAlign: 'center', cursor: 'pointer', color: theme.text.muted, fontSize: '12px' },

  // Video Card
  videoCard: { position: 'relative', borderRadius: '8px', overflow: 'hidden', backgroundColor: theme.bg.surface, cursor: 'pointer' },
  videoThumb: { aspectRatio: '16/9', backgroundColor: theme.bg.page },
  videoThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  videoThumbVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  videoNameContainer: { padding: '8px', backgroundColor: theme.bg.surface },
  videoName: { fontSize: '11px', color: theme.text.secondary, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  videoNameInput: { width: '100%', padding: '2px 4px', backgroundColor: theme.bg.page, border: `1px solid ${theme.accent.primary}`, borderRadius: '4px', color: theme.text.primary, fontSize: '11px' },
  videoDuration: { position: 'absolute', bottom: '32px', right: '6px', padding: '2px 6px', backgroundColor: theme.overlay.heavy, borderRadius: '4px', fontSize: '10px', color: '#fff' },
  videoActionBtns: { position: 'absolute', top: '6px', right: '6px', display: 'flex', gap: '4px' },
  renameVideoBtn: { padding: '4px 6px', backgroundColor: theme.overlay.heavy, border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },
  deleteVideoBtn: { padding: '4px 6px', backgroundColor: 'rgba(239,68,68,0.8)', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },

  // Audio Item
  audioItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', backgroundColor: theme.bg.surface, borderRadius: '8px', color: theme.text.secondary },
  audioItemClip: { borderLeft: `3px solid ${theme.accent.primary}` },
  clipIcon: { fontSize: '14px' },
  audioInfo: { flex: 1, minWidth: 0 },
  audioName: { display: 'block', fontSize: '13px', color: theme.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' },
  audioNameInput: { width: '100%', padding: '2px 4px', backgroundColor: theme.bg.page, border: `1px solid ${theme.accent.primary}`, borderRadius: '4px', color: theme.text.primary, fontSize: '12px' },
  audioDuration: { fontSize: '11px', color: theme.text.muted },
  audioActions: { display: 'flex', gap: '4px' },
  audioActionBtn: { padding: '4px 6px', backgroundColor: theme.bg.page, border: 'none', borderRadius: '4px', color: theme.text.secondary, cursor: 'pointer', fontSize: '12px' },

  // Image Card
  imageCard: { position: 'relative', borderRadius: '6px', overflow: 'hidden', aspectRatio: '1', backgroundColor: theme.bg.surface },
  imageThumb: { width: '100%', height: '100%', objectFit: 'cover' },
  imageDeleteBtn: { position: 'absolute', top: '4px', right: '4px', padding: '4px 6px', backgroundColor: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '10px' },

  // Category Cards Grid
  categoriesGrid: { textAlign: 'center', paddingTop: '60px' },
  gridTitle: { fontSize: '24px', fontWeight: '600', color: theme.text.primary, marginBottom: '8px' },
  gridSubtitle: { fontSize: '14px', color: theme.text.muted, marginBottom: '40px' },
  categoryCards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', maxWidth: '800px', margin: '0 auto' },
  categoryCard: { padding: '20px', backgroundColor: theme.bg.input, border: `1px solid ${theme.bg.surface}`, borderRadius: '12px', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.2s' },
  categoryCardThumb: { width: '100%', aspectRatio: '16/9', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px', backgroundColor: theme.bg.surface },
  categoryCardThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  categoryCardThumbPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: '600', color: theme.text.muted },
  categoryCardInfo: {},
  categoryCardName: { fontSize: '16px', fontWeight: '600', color: theme.text.primary, margin: '0 0 4px 0' },
  categoryCardMeta: { fontSize: '12px', color: theme.text.muted, margin: 0 },
  addCategoryCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '40px 20px', backgroundColor: 'transparent', border: `2px dashed ${theme.border.default}`, borderRadius: '12px', cursor: 'pointer', color: theme.text.muted, fontSize: '14px' },

  // Slideshow Library Modal
  slideshowLibraryOverlay: { position: 'fixed', inset: 0, backgroundColor: theme.overlay.heavy, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
  slideshowLibraryModal: { width: '100%', maxWidth: '900px', maxHeight: '80vh', backgroundColor: theme.bg.page, borderRadius: '16px', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  slideshowLibraryHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: `1px solid ${theme.bg.surface}` },
  slideshowLibraryTitle: { fontSize: '20px', fontWeight: '600', color: theme.text.primary, margin: 0 },
  slideshowLibraryClose: { padding: '8px 12px', backgroundColor: 'transparent', border: `1px solid ${theme.border.default}`, borderRadius: '6px', color: theme.text.secondary, cursor: 'pointer', fontSize: '16px' },
  slideshowLibraryContent: { flex: 1, overflow: 'auto', padding: '24px' },
  slideshowLibraryEmpty: { textAlign: 'center', padding: '60px 20px', color: theme.text.secondary },
  slideshowLibraryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  slideshowCard: { backgroundColor: theme.bg.input, borderRadius: '12px', overflow: 'hidden', border: `1px solid ${theme.bg.surface}` },
  slideshowCardPreview: { position: 'relative', aspectRatio: '9/16', backgroundColor: theme.bg.page, maxHeight: '180px' },
  videoLibraryPreview: { position: 'relative', aspectRatio: '16/9', backgroundColor: theme.bg.page, maxHeight: '120px' },
  slideshowCardImg: { width: '100%', height: '100%', objectFit: 'cover' },
  slideshowCardPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', color: theme.text.muted },
  slideshowCardBadge: { position: 'absolute', bottom: '8px', right: '8px', padding: '4px 8px', backgroundColor: theme.overlay.heavy, borderRadius: '4px', fontSize: '11px', color: '#fff' },
  slideshowCardInfo: { padding: '12px' },
  slideshowCardName: { fontSize: '14px', fontWeight: '500', color: theme.text.primary, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  slideshowCardStatus: { fontSize: '12px', color: theme.text.muted },
  slideshowCardActions: { display: 'flex', gap: '8px', padding: '0 12px 12px 12px' },
  slideshowCardEditBtn: { flex: 1, padding: '8px 12px', backgroundColor: theme.state.info, border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '500' },
  slideshowCardDeleteBtn: { padding: '8px 12px', backgroundColor: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', cursor: 'pointer', fontSize: '13px' }
});

export default AestheticHome;
// Force rebuild Thu Feb  5 08:59:53 UTC 2026
