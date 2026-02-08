import React, { useState, useMemo, useCallback } from 'react';
import ExportAndPostModal from './ExportAndPostModal';
import ScheduleQueue from './ScheduleQueue';
import { StatusPill, ConfirmDialog, EmptyState as SharedEmptyState, useToast } from '../ui';
import { VIDEO_STATUS } from '../../utils/status';
import { renderVideo } from '../../services/videoExportService';
import { uploadFile } from '../../services/firebaseStorage';
import { exportSlideshowAsImages } from '../../services/slideshowExportService';
import { createScheduledPost, POST_STATUS } from '../../services/scheduledPostsService';
import log from '../../utils/logger';

/**
 * ContentLibrary - Shows all videos or slideshows created within a category
 * With batch selection and posting capabilities
 */
const ContentLibrary = ({
  category,
  contentType = 'videos', // 'videos' or 'slideshows'
  onBack,
  // Video-specific props
  onMakeVideo,
  onEditVideo,
  onDeleteVideo,
  onApproveVideo,
  onSchedulePost,
  onUpdateVideo,  // New: update a video after rendering
  // Slideshow-specific props
  onMakeSlideshow,
  onEditSlideshow,
  onDeleteSlideshow,
  // Shared
  onShowBatchPipeline, // Open the main batch create workflow
  onViewScheduling, // Navigate to scheduling page
  db = null, // Firestore instance for creating scheduled posts
  // Posting module props
  accounts = [],
  lateAccountIds = {},
  artistId = null
}) => {
  // BUG-034: Toast notifications instead of alert()
  const { success: toastSuccess, error: toastError } = useToast();

  const isSlideshow = contentType === 'slideshows';
  const [filter, setFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [selectedVideoIds, setSelectedVideoIds] = useState(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [exportingVideo, setExportingVideo] = useState(null);
  const [previewingVideo, setPreviewingVideo] = useState(null);
  const [previewingSlideshow, setPreviewingSlideshow] = useState(null);

  // Rendering state
  const [renderingVideoId, setRenderingVideoId] = useState(null);
  const [renderProgress, setRenderProgress] = useState(0);

  // Handle rendering a video recipe into a real video
  // Returns the cloudUrl when called from PostingModule
  const handleRenderVideo = useCallback(async (video) => {
    if (renderingVideoId) throw new Error('Already rendering another video');

    setRenderingVideoId(video.id);
    setRenderProgress(0);

    try {
      log('[ContentLibrary] Rendering video:', video.id);

      // Render the video
      const blob = await renderVideo(video, (progress) => {
        setRenderProgress(progress);
      });

      log('[ContentLibrary] Video rendered, size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

      // Upload to Firebase - use correct extension based on blob type
      setRenderProgress(95);
      const isMP4 = blob.type === 'video/mp4';
      const extension = isMP4 ? 'mp4' : 'webm';
      const { url: cloudUrl } = await uploadFile(
        new File([blob], `${video.id}.${extension}`, { type: blob.type }),
        'videos'
      );

      log('[ContentLibrary] Video uploaded:', cloudUrl);

      // Update the video with the cloudUrl
      if (onUpdateVideo) {
        onUpdateVideo(video.id, {
          cloudUrl,
          isRendered: true,
          status: VIDEO_STATUS.COMPLETED,
          updatedAt: new Date().toISOString()
        });
      }

      setRenderProgress(100);
      return cloudUrl; // Return URL for PostingModule
    } catch (err) {
      console.error('[ContentLibrary] Render failed:', err);
      throw err; // Re-throw for PostingModule to handle
    } finally {
      setRenderingVideoId(null);
      setRenderProgress(0);
    }
  }, [renderingVideoId, onUpdateVideo]);

  // UI-30: Confirm dialog for delete (supports single and bulk delete)
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, videoId: null, isBulk: false });

  // Schedule Queue state (replaces PostingModule + SlideshowPostingModal)
  const [showScheduleQueue, setShowScheduleQueue] = useState(false);

  // Legacy: postingSlideshow kept for single-slideshow post button
  const [postingSlideshow, setPostingSlideshow] = useState(null);

  // Get content array based on type
  const items = isSlideshow
    ? (category?.slideshows || [])
    : (category?.createdVideos || []);

  // For backwards compatibility, also alias as videos for video-specific logic
  const videos = isSlideshow ? [] : items;

  const selectedItems = useMemo(() =>
    items.filter(v => selectedVideoIds.has(v.id)),
    [items, selectedVideoIds]
  );

  // Backwards compat alias
  const selectedVideos = isSlideshow ? [] : selectedItems;

  const toggleItemSelection = (itemId) => {
    setSelectedVideoIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const allSelected = filteredItems.every(v => selectedVideoIds.has(v.id));
    if (allSelected) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(filteredItems.map(v => v.id)));
    }
  };

  const clearSelection = () => setSelectedVideoIds(new Set());

  const filteredItems = items.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    if (dateRange !== 'all') {
      const created = new Date(item.createdAt);
      const now = new Date();
      const diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
      if (dateRange === 'today' && diffDays > 0) return false;
      if (dateRange === 'week' && diffDays > 7) return false;
      if (dateRange === 'month' && diffDays > 30) return false;
    }
    return true;
  });

  // Card-level click-to-select with shift-click range support
  const handleCardSelect = useCallback((itemId, index, event) => {
    if (event.shiftKey && lastSelectedIndex !== null) {
      // Shift-click: select range
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIds = filteredItems.slice(start, end + 1).map(item => item.id);
      setSelectedVideoIds(prev => {
        const newSet = new Set(prev);
        rangeIds.forEach(id => newSet.add(id));
        return newSet;
      });
    } else {
      // Single click: toggle
      toggleItemSelection(itemId);
      setLastSelectedIndex(index);
    }
  }, [lastSelectedIndex, filteredItems, toggleItemSelection]);

  // Backwards compat alias
  const filteredVideos = isSlideshow ? [] : filteredItems;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button style={styles.backButton} onClick={() => { setPreviewingVideo(null); setPreviewingSlideshow(null); onBack?.(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div style={styles.titleSection}>
            <div style={styles.categoryIcon}>{category?.name?.charAt(0).toUpperCase()}</div>
            <div>
              <h1 style={styles.title}>{category?.name}</h1>
              <p style={styles.subtitle}>
                {isSlideshow ? 'Draft and approve slideshows' : 'Draft and approve videos'}
              </p>
            </div>
          </div>
        </div>
        <div style={styles.headerActions}>
          <button
            style={styles.primaryButton}
            onClick={() => isSlideshow ? onMakeSlideshow?.() : onMakeVideo?.()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {isSlideshow ? 'Make a slideshow' : 'Make a video'}
          </button>
          <button style={styles.secondaryButton} onClick={onShowBatchPipeline}>
            Make up to 10 at once
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <div style={styles.filterGroup}>
          {['all', 'today', 'week', 'month'].map(range => (
            <button
              key={range}
              style={dateRange === range ? styles.dateFilterActive : styles.dateFilter}
              onClick={() => setDateRange(range)}
            >
              {range === 'all' ? 'All time' : range === 'today' ? 'Today' : range === 'week' ? 'This week' : 'This month'}
            </button>
          ))}
        </div>
        <div style={styles.filterRight}>
          {filteredItems.length > 0 && (
            <label style={styles.selectAllLabel}>
              <input
                type="checkbox"
                checked={filteredItems.length > 0 && filteredItems.every(v => selectedVideoIds.has(v.id))}
                onChange={toggleSelectAll}
                style={styles.checkbox}
              />
              Select All ({filteredItems.length})
            </label>
          )}
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={styles.statusFilter}>
            <option value="all">All statuses</option>
            <option value="draft">Drafts</option>
            <option value="completed">Completed</option>
            <option value="approved">Approved</option>
          </select>
        </div>
      </div>

      {/* Content Grid */}
      <div style={styles.contentArea}>
        {filteredItems.length === 0 ? (
          <div style={styles.emptyState}>
            {isSlideshow ? (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                <rect x="2" y="6" width="6" height="12" rx="1"/>
                <rect x="9" y="6" width="6" height="12" rx="1"/>
                <rect x="16" y="6" width="6" height="12" rx="1"/>
              </svg>
            ) : (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
              </svg>
            )}
            <h3 style={styles.emptyTitle}>
              {isSlideshow ? 'No slideshows yet' : 'No videos yet'}
            </h3>
            <p style={styles.emptyText}>
              {isSlideshow ? 'Create your first slideshow to get started' : 'Create your first video to get started'}
            </p>
            <button
              style={styles.emptyButton}
              onClick={() => isSlideshow ? onMakeSlideshow?.() : onMakeVideo?.()}
            >
              {isSlideshow ? 'Make a slideshow' : 'Make a video'}
            </button>
          </div>
        ) : (
          <div style={styles.grid}>
            {filteredItems.map((item, index) => (
              isSlideshow ? (
                <div key={item.id} onClick={(e) => handleCardSelect(item.id, index, e)} style={{ cursor: 'pointer' }}>
                  <SlideshowCard
                    slideshow={item}
                    isSelected={selectedVideoIds.has(item.id)}
                    onToggleSelect={() => toggleItemSelection(item.id)}
                    onPreview={() => setPreviewingSlideshow(item)}
                    onEdit={() => onEditSlideshow?.(item)}
                    onDelete={() => setDeleteConfirm({ isOpen: true, videoId: item.id })}
                    onPost={async () => {
                      if (onViewScheduling && db && artistId) {
                        // Create a scheduled post and navigate to scheduling page
                        try {
                          await createScheduledPost(db, artistId, {
                            contentId: item.id,
                            contentType: 'slideshow',
                            contentName: item.name || item.title || 'Untitled Slideshow',
                            thumbnail: item.thumbnail || item.slides?.[0]?.backgroundImage || item.slides?.[0]?.imageUrl || null,
                            cloudUrl: null,
                            editorState: item,
                            status: POST_STATUS.DRAFT
                          });
                          toastSuccess('Added to schedule queue');
                        } catch (err) {
                          console.error('[ContentLibrary] Failed to create scheduled post:', err);
                        }
                        onViewScheduling();
                      } else if (onViewScheduling) {
                        onViewScheduling();
                      } else {
                        setPostingSlideshow(item);
                        setShowScheduleQueue(true);
                      }
                    }}
                  />
                </div>
              ) : (
                <div key={item.id} onClick={(e) => handleCardSelect(item.id, index, e)} style={{ cursor: 'pointer' }}>
                  <VideoCard
                    video={item}
                    isSelected={selectedVideoIds.has(item.id)}
                    onToggleSelect={() => toggleItemSelection(item.id)}
                    onEdit={() => onEditVideo(item)}
                    onDelete={() => setDeleteConfirm({ isOpen: true, videoId: item.id })}
                    onApprove={() => onApproveVideo(item.id)}
                    onPost={async () => {
                      if (onViewScheduling && db && artistId) {
                        // Create a scheduled post and navigate to scheduling page
                        try {
                          await createScheduledPost(db, artistId, {
                            contentId: item.id,
                            contentType: 'video',
                            contentName: item.name || item.title || 'Untitled Video',
                            thumbnail: item.thumbnail || null,
                            cloudUrl: item.cloudUrl || null,
                            editorState: item,
                            status: POST_STATUS.DRAFT
                          });
                          toastSuccess('Added to schedule queue');
                        } catch (err) {
                          console.error('[ContentLibrary] Failed to create scheduled post:', err);
                        }
                        onViewScheduling();
                      } else {
                        setExportingVideo(item);
                      }
                    }}
                    onRender={() => handleRenderVideo(item)}
                    onPreview={() => setPreviewingVideo(item)}
                    isRendering={renderingVideoId === item.id}
                    renderProgress={renderingVideoId === item.id ? renderProgress : 0}
                  />
                </div>
              )
            ))}
          </div>
        )}
      </div>

      {/* Batch Action Bar */}
      {selectedItems.length > 0 && (
        <div style={styles.batchBar}>
          <div style={styles.batchLeft}>
            <input type="checkbox" checked={filteredItems.every(v => selectedVideoIds.has(v.id))} onChange={toggleSelectAll} style={styles.checkbox} />
            <span style={styles.batchText}>{selectedItems.length} selected</span>
          </div>
          <div style={styles.batchRight}>
            <button style={styles.batchBtnClear} onClick={clearSelection}>Clear</button>
            <button
              style={styles.batchBtnDelete}
              onClick={() => setDeleteConfirm({ isOpen: true, videoId: null, isBulk: true })}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Delete {selectedItems.length}
            </button>
            {!isSlideshow && (
              <button style={styles.batchBtnExport} onClick={() => setExportingVideo(selectedItems[0])}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Export
              </button>
            )}
            <button style={styles.batchBtnPost} onClick={async () => {
              if (onViewScheduling && db && artistId) {
                // Create scheduled posts for ALL selected items
                try {
                  const postsToCreate = selectedItems.map(item => ({
                    contentId: item.id,
                    contentType: isSlideshow ? 'slideshow' : 'video',
                    contentName: item.name || item.title || (isSlideshow ? 'Untitled Slideshow' : 'Untitled Video'),
                    thumbnail: item.thumbnail || (isSlideshow ? (item.slides?.[0]?.backgroundImage || item.slides?.[0]?.imageUrl) : null) || null,
                    cloudUrl: item.cloudUrl || null,
                    editorState: item,
                    status: POST_STATUS.DRAFT
                  }));
                  const { addManyScheduledPosts } = await import('../../services/scheduledPostsService');
                  await addManyScheduledPosts(db, artistId, postsToCreate);
                  toastSuccess(`Added ${postsToCreate.length} item(s) to schedule queue`);
                  clearSelection();
                } catch (err) {
                  console.error('[ContentLibrary] Batch schedule failed:', err);
                  toastError('Failed to add items to queue');
                }
                onViewScheduling();
              } else if (onViewScheduling) {
                onViewScheduling();
              } else {
                setShowScheduleQueue(true); // Fallback to modal
              }
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Schedule {selectedItems.length} {isSlideshow ? 'Carousel' : 'Post'}{selectedItems.length > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Footer — removed dead "Edit category" and "Upload your own videos" buttons (C-10)
         Category editing is available in the sidebar; uploads via the header upload buttons. */}

      {/* Export/Post Modal */}
      {exportingVideo && (
        <ExportAndPostModal
          video={exportingVideo}
          videos={selectedVideos.length > 0 ? selectedVideos : [exportingVideo]}
          category={category}
          onClose={() => { setExportingVideo(null); clearSelection(); }}
          onSchedulePost={onSchedulePost}
        />
      )}

      {/* UI-30: Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title={deleteConfirm.isBulk
          ? `Delete ${selectedItems.length} ${isSlideshow ? 'slideshows' : 'videos'}?`
          : `Delete ${isSlideshow ? 'slideshow' : 'video'}?`
        }
        message={deleteConfirm.isBulk
          ? `This will permanently remove ${selectedItems.length} ${isSlideshow ? 'slideshow' : 'video'}${selectedItems.length > 1 ? 's' : ''} from the library. This action cannot be undone.`
          : `This will permanently remove this ${isSlideshow ? 'slideshow' : 'video'} from the library. This action cannot be undone.`
        }
        confirmLabel={deleteConfirm.isBulk ? `Delete ${selectedItems.length}` : "Delete"}
        confirmVariant="destructive"
        onConfirm={() => {
          if (deleteConfirm.isBulk) {
            // Bulk delete all selected items
            selectedItems.forEach(item => {
              if (isSlideshow) {
                onDeleteSlideshow?.(item.id);
              } else {
                onDeleteVideo?.(item.id);
              }
            });
            clearSelection();
          } else {
            if (isSlideshow) {
              onDeleteSlideshow?.(deleteConfirm.videoId);
            } else {
              onDeleteVideo?.(deleteConfirm.videoId);
            }
          }
          setDeleteConfirm({ isOpen: false, videoId: null, isBulk: false });
        }}
        onCancel={() => setDeleteConfirm({ isOpen: false, videoId: null, isBulk: false })}
      />

      {/* Schedule Queue — unified scheduling for videos and slideshows */}
      {showScheduleQueue && (
        <ScheduleQueue
          contentItems={postingSlideshow ? [postingSlideshow] : selectedItems}
          contentType={isSlideshow ? 'slideshows' : 'videos'}
          artistId={artistId}
          category={category}
          onSchedulePost={onSchedulePost}
          onRenderVideo={handleRenderVideo}
          onClose={() => {
            setShowScheduleQueue(false);
            setPostingSlideshow(null);
            clearSelection();
          }}
          accounts={accounts}
          lateAccountIds={lateAccountIds}
        />
      )}

      {/* Slideshow Preview Modal — scrollable slide gallery */}
      {previewingSlideshow && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column'
        }} onClick={() => setPreviewingSlideshow(null)}>
          <div style={{
            position: 'relative', maxWidth: '90vw', maxHeight: '85vh',
            width: 'fit-content', minWidth: '320px',
            backgroundColor: '#1a1a2e', borderRadius: 16, overflow: 'hidden',
            boxShadow: '0 25px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column'
          }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
              <div>
                <div style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>
                  {previewingSlideshow.name || 'Untitled Slideshow'}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 }}>
                  {previewingSlideshow.slides?.length || 0} slides · {previewingSlideshow.status || 'draft'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button onClick={() => { setPreviewingSlideshow(null); onEditSlideshow?.(previewingSlideshow); }} style={{
                  padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.5)',
                  background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', fontSize: 13, cursor: 'pointer', fontWeight: 500
                }}>Edit</button>
                <button onClick={() => setPreviewingSlideshow(null)} style={{
                  background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white',
                  borderRadius: '50%', width: 32, height: 32, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
                }}>×</button>
              </div>
            </div>
            {/* Slides */}
            <div style={{
              padding: '16px', overflowY: 'auto', display: 'flex',
              flexWrap: 'wrap', gap: '12px', justifyContent: 'center',
              maxHeight: 'calc(85vh - 80px)'
            }}>
              {(previewingSlideshow.slides || []).map((slide, i) => (
                <div key={slide.id || i} style={{
                  width: '180px', flexShrink: 0,
                  aspectRatio: '9/16', borderRadius: 10, overflow: 'hidden',
                  backgroundColor: '#000', position: 'relative',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  {(slide.backgroundImage || slide.thumbnail) ? (
                    <img src={slide.backgroundImage || slide.thumbnail} alt={`Slide ${i + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563' }}>
                      Empty
                    </div>
                  )}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '4px 8px', background: 'rgba(0,0,0,0.6)',
                    color: '#fff', fontSize: 11, textAlign: 'center'
                  }}>Slide {i + 1}</div>
                  {/* Show text overlays */}
                  {(slide.textOverlays || []).map((overlay, oi) => (
                    <div key={oi} style={{
                      position: 'absolute', left: `${overlay.position?.x || 50}%`,
                      top: `${overlay.position?.y || 50}%`, transform: 'translate(-50%,-50%)',
                      color: overlay.style?.color || '#fff',
                      fontSize: `${Math.max(8, (overlay.style?.fontSize || 24) * 0.2)}px`,
                      fontWeight: overlay.style?.fontWeight || '700',
                      textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                      pointerEvents: 'none', maxWidth: '90%', wordBreak: 'break-word'
                    }}>{overlay.text}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Video Preview Modal - Always 9:16 portrait */}
      {previewingVideo && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setPreviewingVideo(null)}>
          <div style={{
            position: 'relative',
            width: 'min(320px, 80vh * 9 / 16)',
            maxHeight: '85vh',
            aspectRatio: '9 / 16',
            backgroundColor: '#000', borderRadius: 16, overflow: 'hidden',
            boxShadow: '0 25px 60px rgba(0,0,0,0.5)'
          }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setPreviewingVideo(null)} style={{
              position: 'absolute', top: 10, right: 10, zIndex: 10,
              background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white',
              borderRadius: '50%', width: 32, height: 32, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              backdropFilter: 'blur(4px)'
            }}>×</button>
            {previewingVideo.cloudUrl ? (
              <video
                src={previewingVideo.cloudUrl}
                controls
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
              />
            ) : previewingVideo.clips?.length > 0 ? (
              <video
                src={previewingVideo.clips[0].url || previewingVideo.clips[0].localUrl}
                controls
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
              />
            ) : (
              <div style={{ padding: 40, color: '#888', textAlign: 'center' }}>
                No preview available - video needs to be rendered first
              </div>
            )}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '24px 16px 16px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.8))'
            }}>
              <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                {previewingVideo.name || previewingVideo.textOverlay || 'Untitled Video'}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 }}>
                {previewingVideo.status} · {previewingVideo.clips?.length || 0} clips
                {previewingVideo.cloudUrl && ' · Rendered'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const VideoCard = ({ video, isSelected, onToggleSelect, onEdit, onDelete, onApprove, onPost, onRender, isRendering, renderProgress, onPreview }) => {
  const [showActions, setShowActions] = useState(false);

  // UI-34: Prevent action buttons from triggering selection
  const handleActionClick = (e, action) => {
    e.stopPropagation();
    action();
  };

  const needsRendering = video.isRendered === false;

  return (
    <div
      style={{...styles.videoCard, ...(isSelected ? styles.videoCardSelected : {})}}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div style={styles.videoCheckbox} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} style={styles.checkbox} />
      </div>

      <div style={styles.videoThumb} onClick={() => !isRendering && onPreview?.(video)}>
        {video.thumbnail ? (
          <img src={video.thumbnail} alt="" style={styles.videoThumbImg} />
        ) : video.cloudUrl ? (
          <video
            src={video.cloudUrl}
            style={styles.videoThumbImg}
            muted
            playsInline
            preload="metadata"
          />
        ) : video.clips?.[0]?.url ? (
          // For unrendered recipes, show first clip as preview
          <video
            src={video.clips[0].url}
            style={styles.videoThumbImg}
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <div style={styles.videoThumbPlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
            </svg>
          </div>
        )}

        {video.textOverlay && <div style={styles.textOverlay}>{video.textOverlay}</div>}

        {/* "Needs Rendering" badge */}
        {needsRendering && !isRendering && (
          <div style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(251, 191, 36, 0.9)',
            color: '#78350f',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: '600'
          }}>
            ⚡ Recipe
          </div>
        )}

        {/* Rendering progress */}
        {isRendering && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white'
          }}>
            <div style={{ fontSize: '12px', marginBottom: '8px' }}>Rendering...</div>
            <div style={{
              width: '80%',
              height: '4px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '2px'
            }}>
              <div style={{
                width: `${renderProgress}%`,
                height: '100%',
                background: '#8b5cf6',
                borderRadius: '2px',
                transition: 'width 0.3s'
              }} />
            </div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>{renderProgress}%</div>
          </div>
        )}

        {showActions && !isRendering && (
          <div style={styles.videoActions}>
            <button style={styles.actionBtn} onClick={(e) => handleActionClick(e, onEdit)}>Edit</button>
            {needsRendering ? (
              <button
                style={{...styles.actionBtnPost, background: '#f59e0b'}}
                onClick={(e) => handleActionClick(e, onRender)}
              >
                🎬 Export
              </button>
            ) : (
              <>
                {video.cloudUrl && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const a = document.createElement('a');
                      a.href = video.cloudUrl;
                      a.download = `${video.name || video.textOverlay || 'video'}_${video.id}.mp4`;
                      a.target = '_blank';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    style={{
                      padding: '4px 8px', fontSize: 11, borderRadius: 4,
                      border: '1px solid #4ade80', color: '#4ade80',
                      background: 'transparent', cursor: 'pointer'
                    }}
                    title="Download rendered video"
                  >
                    Download
                  </button>
                )}
                <button style={styles.actionBtnPost} onClick={(e) => handleActionClick(e, onPost)}>Post</button>
              </>
            )}
            <button style={styles.actionBtnDel} onClick={(e) => handleActionClick(e, onDelete)}>✕</button>
          </div>
        )}
      </div>

      {/* UI-31: Use StatusPill instead of custom badge */}
      <div style={styles.statusBadgeContainer}>
        <StatusPill status={video.status || VIDEO_STATUS.DRAFT} />
      </div>
    </div>
  );
};

const SlideshowCard = ({ slideshow, isSelected, onToggleSelect, onPreview, onEdit, onDelete, onPost }) => {
  const [showActions, setShowActions] = useState(false);

  const handleActionClick = (e, action) => {
    e.stopPropagation();
    action();
  };

  const slides = slideshow.slides || [];
  const slideCount = slides.length;

  // Check if slideshow has been exported (has carousel images)
  const isExported = slideshow.exportedImages?.length > 0 || slideshow.status === 'rendered';

  // Get thumbnail for a slide
  const getSlideThumb = (slide) =>
    slide?.imageA?.url || slide?.imageA?.localUrl || slide?.thumbnail || slide?.backgroundImage;

  // Get primary text overlay for a slide (first overlay with non-empty text)
  const getSlideText = (slide) => {
    if (!slide?.textOverlays?.length) return null;
    const overlay = slide.textOverlays.find(o => o.text);
    return overlay || null;
  };

  // Render a mini slide thumbnail with text overlay
  const renderMiniSlide = (slide, idx) => {
    const thumb = getSlideThumb(slide);
    const visibleOverlays = (slide?.textOverlays || []).filter(o => o.text);
    return (
      <div key={idx} style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '9/16',
        backgroundColor: '#0a0a0f',
        borderRadius: idx === 0 ? '10px 0 0 0' : idx === slideCount - 1 ? '0 10px 0 0' : '0',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1a1a2e, #16213e)' }}>
            <span style={{ color: '#4b5563', fontSize: '10px' }}>{idx + 1}</span>
          </div>
        )}
        {/* Text overlays rendered exactly as in editor */}
        {visibleOverlays.map((overlay, oi) => (
          <div key={oi} style={{
            position: 'absolute',
            left: `${overlay.position?.x || 50}%`,
            top: `${overlay.position?.y || 50}%`,
            transform: 'translate(-50%, -50%)',
            color: overlay.style?.color || '#fff',
            fontSize: `${Math.max(8, (overlay.style?.fontSize || 36) * 0.22)}px`,
            fontWeight: overlay.style?.fontWeight || '600',
            fontFamily: overlay.style?.fontFamily || 'Inter, sans-serif',
            textAlign: overlay.style?.textAlign || 'center',
            textShadow: overlay.style?.outline
              ? `0 0 3px ${overlay.style?.outlineColor || 'rgba(0,0,0,0.5)'}`
              : '0 1px 3px rgba(0,0,0,0.9)',
            pointerEvents: 'none',
            maxWidth: '90%',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            wordBreak: 'break-word',
            lineHeight: '1.2',
            padding: '1px 2px',
          }}>
            {overlay.text}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      style={{...styles.videoCard, ...(isSelected ? styles.videoCardSelected : {})}}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div style={styles.videoCheckbox} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} style={styles.checkbox} />
      </div>

      <div style={styles.videoThumb} onClick={() => onPreview?.()}>
        {slideCount > 0 ? (
          <div style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            gap: '1px',
            backgroundColor: '#0a0a0f',
          }}>
            {/* Show up to 4 slides as filmstrip, with overflow indicator */}
            {slides.slice(0, 4).map((slide, idx) => (
              <div key={idx} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {renderMiniSlide(slide, idx)}
              </div>
            ))}
            {slideCount > 4 && (
              <div style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
                borderRadius: '0 10px 0 0',
              }}>
                <span style={{ color: '#9ca3af', fontSize: '11px', fontWeight: '600' }}>+{slideCount - 4}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={styles.videoThumbPlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <rect x="2" y="6" width="6" height="12" rx="1"/>
              <rect x="9" y="6" width="6" height="12" rx="1"/>
              <rect x="16" y="6" width="6" height="12" rx="1"/>
            </svg>
          </div>
        )}

        {/* Carousel badge - bottom left */}
        <div style={{
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(124, 58, 237, 0.85)',
          color: '#fff',
          padding: '3px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: '600',
          backdropFilter: 'blur(4px)',
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="2" y="6" width="6" height="12" rx="1"/>
            <rect x="9" y="6" width="6" height="12" rx="1"/>
            <rect x="16" y="6" width="6" height="12" rx="1"/>
          </svg>
          {slideCount} slides
        </div>

        {/* Status badge - exported or draft */}
        {isExported ? (
          <div style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(34, 197, 94, 0.9)',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: '600'
          }}>
            ✓ Ready
          </div>
        ) : (
          <div style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(251, 191, 36, 0.9)',
            color: '#78350f',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: '600'
          }}>
            Draft
          </div>
        )}

        {showActions && (
          <div style={styles.videoActions}>
            <button style={styles.actionBtn} onClick={(e) => handleActionClick(e, onEdit)}>Edit</button>
            <button style={styles.actionBtnPost} onClick={(e) => handleActionClick(e, onPost)}>Post</button>
            <button style={styles.actionBtnDel} onClick={(e) => handleActionClick(e, onDelete)}>✕</button>
          </div>
        )}
      </div>

      {/* Name + Status */}
      <div style={styles.statusBadgeContainer}>
        {slideshow.name && (
          <div style={{
            padding: '4px 12px 0',
            fontSize: '11px',
            fontWeight: '500',
            color: '#d1d5db',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {slideshow.name}
          </div>
        )}
        <StatusPill status={slideshow.status || VIDEO_STATUS.DRAFT} />
      </div>
    </div>
  );
};

/**
 * SlideshowPostingModal - Modal for scheduling carousel posts
 */
const SlideshowPostingModal = ({ slideshows, lateAccountIds, onSchedulePost, onClose }) => {
  const [selectedHandle, setSelectedHandle] = useState('');
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [platforms, setPlatforms] = useState({ tiktok: true, instagram: true });
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('#carousel #slideshow #fyp');
  const [isScheduling, setIsScheduling] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  const availableHandles = Object.keys(lateAccountIds);

  const handleSchedule = async () => {
    if (!selectedHandle) {
      toastError('Please select an account');
      return;
    }

    const accountMapping = lateAccountIds[selectedHandle];
    if (!accountMapping) {
      toastError(`No account mapping found for ${selectedHandle}`);
      return;
    }

    setIsScheduling(true);
    log('[Schedule] Starting carousel scheduling...');
    log('[Schedule] Selected handle:', selectedHandle);
    log('[Schedule] Account mapping:', accountMapping);
    log('[Schedule] Platforms:', platforms);
    log('[Schedule] Slideshows to schedule:', slideshows.length);

    try {
      // Schedule each slideshow as a carousel post
      let scheduled = 0;

      // Helper: export slides at a given aspect ratio
      const exportAtRatio = async (slideshow, ratio, label) => {
        setExportProgress(`Exporting for ${label}...`);
        const exportData = { ...slideshow, aspectRatio: ratio };
        return await exportSlideshowAsImages(exportData, (pct) => {
          setExportProgress(`Exporting for ${label} (${pct}%)`);
        });
      };

      for (let si = 0; si < slideshows.length; si++) {
        const slideshow = slideshows[si];
        const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
        const fullCaption = `${caption}\n\n${hashtags}`.trim();
        log(`[Schedule] Processing slideshow ${si + 1}/${slideshows.length}:`, slideshow.id);

        if (!onSchedulePost) {
          console.error('[Schedule] onSchedulePost is not defined!');
          toastError('Scheduling not available. Please try again.');
          break;
        }

        // Schedule for each selected platform separately (different aspect ratios)
        // Instagram = 4:5 (1080x1350), TikTok = 9:16 (1080x1920)
        const platformJobs = [];
        if (platforms.instagram && accountMapping.instagram) {
          platformJobs.push({ platform: 'instagram', accountId: accountMapping.instagram, ratio: '4:5', label: 'Instagram' });
        }
        if (platforms.tiktok && accountMapping.tiktok) {
          platformJobs.push({ platform: 'tiktok', accountId: accountMapping.tiktok, ratio: '9:16', label: 'TikTok' });
        }

        if (!platformJobs.length) {
          console.warn('[Schedule] No account IDs for selected platforms on', selectedHandle);
          continue;
        }

        // Export all needed ratios in parallel
        setExportProgress('Exporting slides...');
        const slideshowRatio = slideshow.aspectRatio || '9:16';
        const neededRatios = [...new Set(platformJobs.map(j => j.ratio))];
        const imagesByRatio = {};

        const exportPromises = neededRatios.map(async (ratio) => {
          if (slideshowRatio === ratio && slideshow.exportedImages?.length) {
            log(`[Schedule] Using cached export for ${ratio}`);
            imagesByRatio[ratio] = slideshow.exportedImages;
          } else {
            const label = platformJobs.find(j => j.ratio === ratio)?.label || ratio;
            log(`[Schedule] Exporting at ${ratio} for ${label}`);
            imagesByRatio[ratio] = await exportAtRatio(slideshow, ratio, label);
          }
        });
        await Promise.all(exportPromises);

        // Send all Late API calls in parallel
        setExportProgress('Scheduling...');
        const schedulePromises = platformJobs.map(async (job) => {
          const images = imagesByRatio[job.ratio];
          if (!images?.length) {
            console.warn(`[Schedule] No images for ${job.label}, skipping`);
            return null;
          }
          log(`[Schedule] Sending to Late for ${job.label}:`, images.length, 'images');
          try {
            const result = await onSchedulePost({
              type: 'carousel',
              platforms: [{
                platform: job.platform,
                accountId: job.accountId,
                customContent: fullCaption,
                scheduledFor
              }],
              caption: fullCaption,
              images,
              scheduledFor,
            });
            log(`[Schedule] ${job.label} result:`, result);
            if (result?.success === false) {
              toastError(`Failed to schedule for ${job.label}: ${result.error || 'Unknown error'}`);
              return null;
            }
            return result;
          } catch (err) {
            console.error(`[Schedule] ${job.label} error:`, err);
            toastError(`Error scheduling for ${job.label}: ${err.message}`);
            return null;
          }
        });

        const results = await Promise.all(schedulePromises);
        scheduled += results.filter(Boolean).length;
      }

      log('[Schedule] Done. Scheduled:', scheduled);
      setExportProgress('');
      if (scheduled > 0) {
        toastSuccess(`Scheduled ${scheduled} carousel post${scheduled > 1 ? 's' : ''}!`);
        onClose();
      } else {
        toastError('No carousels were scheduled. Check that your account has the correct platform IDs configured.');
      }
    } catch (err) {
      console.error('[SlideshowPostingModal] Schedule failed:', err);
      toastError(`Failed to schedule: ${err.message}`);
    } finally {
      setIsScheduling(false);
    }
  };

  // Total slides across all slideshows (will be exported to Firebase before posting)
  const totalSlides = slideshows.reduce((sum, s) => sum + (s.slides?.length || 0), 0);
  const allExported = slideshows.every(s => s.exportedImages?.length > 0);

  return (
    <div style={slideshowPostingStyles.overlay}>
      <div style={slideshowPostingStyles.modal}>
        <div style={slideshowPostingStyles.header}>
          <h3 style={slideshowPostingStyles.title}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Schedule Carousel{slideshows.length > 1 ? 's' : ''}
          </h3>
          <button style={slideshowPostingStyles.closeBtn} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Preview */}
        <div style={slideshowPostingStyles.preview}>
          <div style={slideshowPostingStyles.previewImages}>
            {slideshows.slice(0, 3).map((slideshow, i) => {
              const previewUrl = slideshow.exportedImages?.[0]?.url
                || slideshow.slides?.[0]?.imageA?.url
                || slideshow.slides?.[0]?.imageA?.localUrl
                || slideshow.slides?.[0]?.thumbnail
                || slideshow.slides?.[0]?.backgroundImage;
              return previewUrl ? (
                <img
                  key={i}
                  src={previewUrl}
                  alt={`Slideshow ${i + 1}`}
                  style={slideshowPostingStyles.previewImg}
                />
              ) : null;
            })}
            {slideshows.length > 3 && (
              <div style={slideshowPostingStyles.previewMore}>+{slideshows.length - 3}</div>
            )}
          </div>
          <span style={slideshowPostingStyles.previewText}>
            {slideshows.length} carousel{slideshows.length > 1 ? 's' : ''} • {totalSlides} slide{totalSlides !== 1 ? 's' : ''}
            {!allExported && ' (will auto-export)'}
          </span>
        </div>

        {/* Account Selection */}
        <div style={slideshowPostingStyles.field}>
          <label style={slideshowPostingStyles.label}>Account</label>
          <select
            value={selectedHandle}
            onChange={(e) => setSelectedHandle(e.target.value)}
            style={slideshowPostingStyles.select}
          >
            <option value="">Select account...</option>
            {availableHandles.map(handle => (
              <option key={handle} value={handle}>{handle}</option>
            ))}
          </select>
        </div>

        {/* Date & Time */}
        <div style={slideshowPostingStyles.row}>
          <div style={slideshowPostingStyles.field}>
            <label style={slideshowPostingStyles.label}>Date</label>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              style={slideshowPostingStyles.input}
            />
          </div>
          <div style={slideshowPostingStyles.field}>
            <label style={slideshowPostingStyles.label}>Time</label>
            <input
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              style={slideshowPostingStyles.input}
            />
          </div>
        </div>

        {/* Platforms */}
        <div style={slideshowPostingStyles.field}>
          <label style={slideshowPostingStyles.label}>Platforms</label>
          <div style={slideshowPostingStyles.checkboxRow}>
            <label style={slideshowPostingStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={platforms.instagram}
                onChange={(e) => setPlatforms(p => ({ ...p, instagram: e.target.checked }))}
              />
              Instagram
            </label>
            <label style={slideshowPostingStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={platforms.tiktok}
                onChange={(e) => setPlatforms(p => ({ ...p, tiktok: e.target.checked }))}
              />
              TikTok
            </label>
          </div>
        </div>

        {/* Caption */}
        <div style={slideshowPostingStyles.field}>
          <label style={slideshowPostingStyles.label}>Caption</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            style={slideshowPostingStyles.textarea}
            placeholder="Write a caption..."
            rows={2}
          />
        </div>

        {/* Hashtags */}
        <div style={slideshowPostingStyles.field}>
          <label style={slideshowPostingStyles.label}>Hashtags</label>
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            style={slideshowPostingStyles.hashtagInput}
            placeholder="#hashtag1 #hashtag2..."
          />
        </div>

        {/* Actions */}
        <div style={slideshowPostingStyles.actions}>
          <button style={slideshowPostingStyles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            style={slideshowPostingStyles.scheduleBtn}
            onClick={handleSchedule}
            disabled={isScheduling || !selectedHandle}
          >
            {isScheduling ? (exportProgress || 'Scheduling...') : `Schedule ${slideshows.length} Carousel${slideshows.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};

const slideshowPostingStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    backgroundColor: '#1a1a2e',
    borderRadius: '16px',
    padding: '24px',
    maxWidth: '480px',
    width: '90%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '20px'
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff'
  },
  closeBtn: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '8px'
  },
  preview: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '20px'
  },
  previewImages: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px'
  },
  previewImg: {
    width: '60px',
    height: '80px',
    objectFit: 'cover',
    borderRadius: '8px'
  },
  previewMore: {
    width: '60px',
    height: '80px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    color: '#9ca3af'
  },
  previewText: {
    fontSize: '13px',
    color: '#9ca3af'
  },
  field: {
    marginBottom: '16px'
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px'
  },
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: '500',
    color: '#9ca3af',
    textTransform: 'uppercase',
    marginBottom: '6px'
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer'
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    boxSizing: 'border-box'
  },
  checkboxRow: {
    display: 'flex',
    gap: '16px'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#e4e4e7',
    cursor: 'pointer'
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    resize: 'none',
    boxSizing: 'border-box'
  },
  hashtagInput: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#a78bfa',
    fontSize: '14px',
    boxSizing: 'border-box'
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginTop: '20px'
  },
  cancelBtn: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '8px',
    color: '#9ca3af',
    fontSize: '14px',
    cursor: 'pointer'
  },
  scheduleBtn: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#22c55e',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  }
};

const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #1f1f2e' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '16px' },
  backButton: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', backgroundColor: '#1f1f2e', border: 'none', borderRadius: '8px', color: '#9ca3af', cursor: 'pointer' },
  titleSection: { display: 'flex', alignItems: 'center', gap: '12px' },
  categoryIcon: { width: '40px', height: '40px', backgroundColor: '#2d2d3d', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '600', color: '#9ca3af' },
  title: { fontSize: '18px', fontWeight: '600', color: '#fff', margin: 0 },
  subtitle: { fontSize: '13px', color: '#6b7280', margin: 0 },
  headerActions: { display: 'flex', alignItems: 'center', gap: '8px' },
  primaryButton: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '500' },
  secondaryButton: { padding: '10px 16px', backgroundColor: '#1f1f2e', border: '1px solid #2d2d3d', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px' },
  filters: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderBottom: '1px solid #1f1f2e' },
  filterGroup: { display: 'flex', alignItems: 'center', gap: '4px' },
  filterRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  dateFilter: { padding: '6px 12px', backgroundColor: 'transparent', border: 'none', borderRadius: '6px', color: '#9ca3af', cursor: 'pointer', fontSize: '13px' },
  dateFilterActive: { padding: '6px 12px', backgroundColor: '#1f1f2e', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px' },
  selectAllLabel: { display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' },
  statusFilter: { padding: '8px 12px', backgroundColor: '#1f1f2e', border: '1px solid #2d2d3d', borderRadius: '6px', color: '#fff', fontSize: '13px', cursor: 'pointer' },
  contentArea: { flex: 1, overflow: 'auto', padding: '24px' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' },
  emptyTitle: { fontSize: '18px', fontWeight: '600', color: '#fff', margin: '16px 0 8px 0' },
  emptyText: { fontSize: '14px', color: '#6b7280', margin: '0 0 24px 0' },
  emptyButton: { padding: '12px 24px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  videoCard: { position: 'relative', backgroundColor: '#111118', borderRadius: '12px', overflow: 'hidden', border: '2px solid transparent' },
  videoCardSelected: { border: '2px solid #7c3aed', boxShadow: '0 0 0 2px rgba(124, 58, 237, 0.3)' },
  videoCheckbox: { position: 'absolute', top: '12px', left: '12px', zIndex: 10 },
  checkbox: { width: '18px', height: '18px', accentColor: '#7c3aed', cursor: 'pointer' },
  videoThumb: { position: 'relative', aspectRatio: '9/16', backgroundColor: '#0a0a0f' },
  videoThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  videoThumbPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  textOverlay: { position: 'absolute', bottom: '40%', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: '4px', color: '#fff', fontSize: '12px', fontWeight: '500' },
  videoActions: { position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px' },
  actionBtn: { padding: '6px 10px', backgroundColor: '#1f1f2e', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: '500' },
  actionBtnPost: { padding: '6px 12px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: '600' },
  actionBtnDel: { padding: '6px 10px', backgroundColor: '#dc2626', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '11px' },
  statusBadge: { padding: '10px 12px', fontSize: '12px', fontWeight: '500', textAlign: 'center' },
  statusDraft: { backgroundColor: '#1f1f2e', color: '#9ca3af' },
  statusApproved: { backgroundColor: '#065f46', color: '#34d399' },
  batchBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', backgroundColor: '#7c3aed', margin: '0 24px 16px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(124, 58, 237, 0.5)' },
  batchLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  batchText: { color: '#fff', fontSize: '14px', fontWeight: '500' },
  batchRight: { display: 'flex', alignItems: 'center', gap: '8px' },
  batchBtnClear: { padding: '8px 16px', backgroundColor: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px' },
  batchBtnDelete: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', backgroundColor: '#dc2626', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '500' },
  batchBtnExport: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', backgroundColor: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '500' },
  batchBtnPost: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#fff', border: 'none', borderRadius: '6px', color: '#7c3aed', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
  footer: { display: 'flex', justifyContent: 'center', gap: '16px', padding: '16px 24px', borderTop: '1px solid #1f1f2e' },
  footerButton: { padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #2d2d3d', borderRadius: '8px', color: '#9ca3af', cursor: 'pointer', fontSize: '13px' },
  // UI-31: Container for StatusPill at bottom of video card
  statusBadgeContainer: { padding: '10px 12px', backgroundColor: '#1f1f2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }
};

export default ContentLibrary;
