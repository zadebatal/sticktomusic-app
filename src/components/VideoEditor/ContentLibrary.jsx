import React, { useState, useMemo, useCallback } from 'react';
import ExportAndPostModal from './ExportAndPostModal';
import PostingModule from './PostingModule';
import { StatusPill, ConfirmDialog, EmptyState as SharedEmptyState } from '../ui';
import { VIDEO_STATUS } from '../../utils/status';
import { renderVideo } from '../../services/videoExportService';
import { uploadFile } from '../../services/firebaseStorage';

/**
 * ContentLibrary - Shows all videos created with a category
 * With batch selection and posting capabilities
 */
const ContentLibrary = ({
  category,
  onBack,
  onMakeVideo,
  onEditVideo,
  onDeleteVideo,
  onApproveVideo,
  onSchedulePost,
  onUpdateVideo,  // New: update a video after rendering
  // Posting module props
  accounts = [],
  lateAccountIds = {}
}) => {
  const [filter, setFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [selectedVideoIds, setSelectedVideoIds] = useState(new Set());
  const [exportingVideo, setExportingVideo] = useState(null);

  // Rendering state
  const [renderingVideoId, setRenderingVideoId] = useState(null);
  const [renderProgress, setRenderProgress] = useState(0);

  // Handle rendering a video recipe into a real video
  const handleRenderVideo = useCallback(async (video) => {
    if (renderingVideoId) return; // Already rendering

    setRenderingVideoId(video.id);
    setRenderProgress(0);

    try {
      console.log('[ContentLibrary] Rendering video:', video.id);

      // Render the video
      const blob = await renderVideo(video, (progress) => {
        setRenderProgress(progress);
      });

      console.log('[ContentLibrary] Video rendered, size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

      // Upload to Firebase
      setRenderProgress(95);
      const { url: cloudUrl } = await uploadFile(
        new File([blob], `${video.id}.webm`, { type: 'video/webm' }),
        'videos'
      );

      console.log('[ContentLibrary] Video uploaded:', cloudUrl);

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
    } catch (err) {
      console.error('[ContentLibrary] Render failed:', err);
      alert(`Render failed: ${err.message}`);
    } finally {
      setRenderingVideoId(null);
      setRenderProgress(0);
    }
  }, [renderingVideoId, onUpdateVideo]);

  // UI-30: Confirm dialog for delete (supports single and bulk delete)
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, videoId: null, isBulk: false });

  // Batch Create Modal state
  const [showBatchModal, setShowBatchModal] = useState(false);

  // Posting Module state
  const [showPostingModule, setShowPostingModule] = useState(false);

  const videos = category?.createdVideos || [];

  const selectedVideos = useMemo(() =>
    videos.filter(v => selectedVideoIds.has(v.id)),
    [videos, selectedVideoIds]
  );

  const toggleVideoSelection = (videoId) => {
    setSelectedVideoIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(videoId)) {
        newSet.delete(videoId);
      } else {
        newSet.add(videoId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const allSelected = filteredVideos.every(v => selectedVideoIds.has(v.id));
    if (allSelected) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(filteredVideos.map(v => v.id)));
    }
  };

  const clearSelection = () => setSelectedVideoIds(new Set());

  const filteredVideos = videos.filter(video => {
    if (filter !== 'all' && video.status !== filter) return false;
    if (dateRange !== 'all') {
      const created = new Date(video.createdAt);
      const now = new Date();
      const diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
      if (dateRange === 'today' && diffDays > 0) return false;
      if (dateRange === 'week' && diffDays > 7) return false;
      if (dateRange === 'month' && diffDays > 30) return false;
    }
    return true;
  });

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button style={styles.backButton} onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div style={styles.titleSection}>
            <div style={styles.categoryIcon}>{category?.name?.charAt(0).toUpperCase()}</div>
            <div>
              <h1 style={styles.title}>{category?.name}</h1>
              <p style={styles.subtitle}>Draft and approve videos</p>
            </div>
          </div>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.primaryButton} onClick={() => onMakeVideo()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Make a video
          </button>
          <button style={styles.secondaryButton} onClick={() => setShowBatchModal(true)}>Make up to 10 at once</button>
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
          {filteredVideos.length > 0 && (
            <label style={styles.selectAllLabel}>
              <input
                type="checkbox"
                checked={filteredVideos.length > 0 && filteredVideos.every(v => selectedVideoIds.has(v.id))}
                onChange={toggleSelectAll}
                style={styles.checkbox}
              />
              Select All ({filteredVideos.length})
            </label>
          )}
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={styles.statusFilter}>
            <option value="all">All statuses</option>
            <option value="draft">Drafts</option>
            <option value="approved">Approved</option>
          </select>
        </div>
      </div>

      {/* Content Grid */}
      <div style={styles.contentArea}>
        {filteredVideos.length === 0 ? (
          <div style={styles.emptyState}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
            </svg>
            <h3 style={styles.emptyTitle}>No videos yet</h3>
            <p style={styles.emptyText}>Create your first video to get started</p>
            <button style={styles.emptyButton} onClick={() => onMakeVideo()}>Make a video</button>
          </div>
        ) : (
          <div style={styles.grid}>
            {filteredVideos.map(video => (
              <VideoCard
                key={video.id}
                video={video}
                isSelected={selectedVideoIds.has(video.id)}
                onToggleSelect={() => toggleVideoSelection(video.id)}
                onEdit={() => onEditVideo(video)}
                onDelete={() => setDeleteConfirm({ isOpen: true, videoId: video.id })}
                onApprove={() => onApproveVideo(video.id)}
                onPost={() => setExportingVideo(video)}
                onRender={() => handleRenderVideo(video)}
                isRendering={renderingVideoId === video.id}
                renderProgress={renderingVideoId === video.id ? renderProgress : 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Batch Action Bar */}
      {selectedVideos.length > 0 && (
        <div style={styles.batchBar}>
          <div style={styles.batchLeft}>
            <input type="checkbox" checked={filteredVideos.every(v => selectedVideoIds.has(v.id))} onChange={toggleSelectAll} style={styles.checkbox} />
            <span style={styles.batchText}>{selectedVideos.length} selected</span>
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
              Delete {selectedVideos.length}
            </button>
            <button style={styles.batchBtnExport} onClick={() => setExportingVideo(selectedVideos[0])}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Export
            </button>
            <button style={styles.batchBtnPost} onClick={() => setShowPostingModule(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Schedule {selectedVideos.length} Post{selectedVideos.length > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={styles.footer}>
        <button style={styles.footerButton}>Edit category</button>
        <button style={styles.footerButton}>Upload your own videos</button>
      </div>

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
        title={deleteConfirm.isBulk ? `Delete ${selectedVideos.length} videos?` : "Delete video?"}
        message={deleteConfirm.isBulk
          ? `This will permanently remove ${selectedVideos.length} video${selectedVideos.length > 1 ? 's' : ''} from the library. This action cannot be undone.`
          : "This will permanently remove this video from the library. This action cannot be undone."
        }
        confirmLabel={deleteConfirm.isBulk ? `Delete ${selectedVideos.length}` : "Delete"}
        confirmVariant="destructive"
        onConfirm={() => {
          if (deleteConfirm.isBulk) {
            // Bulk delete all selected videos
            selectedVideos.forEach(video => onDeleteVideo(video.id));
            clearSelection();
          } else {
            onDeleteVideo(deleteConfirm.videoId);
          }
          setDeleteConfirm({ isOpen: false, videoId: null, isBulk: false });
        }}
        onCancel={() => setDeleteConfirm({ isOpen: false, videoId: null, isBulk: false })}
      />

      {/* Batch Create Modal */}
      {showBatchModal && (
        <BatchCreateModal
          category={category}
          onClose={() => setShowBatchModal(false)}
          onCreateDrafts={(drafts) => {
            // Add drafts to category.createdVideos
            drafts.forEach(draft => {
              if (onMakeVideo) {
                // Pass draft as existingVideo to open in editor
                onMakeVideo(draft);
              }
            });
            setShowBatchModal(false);
          }}
        />
      )}

      {/* Posting Module */}
      {showPostingModule && (
        <PostingModule
          category={category}
          videos={selectedVideos.length > 0 ? selectedVideos : videos}
          accounts={accounts}
          lateAccountIds={lateAccountIds}
          onSchedulePost={onSchedulePost}
          onClose={() => {
            setShowPostingModule(false);
            clearSelection();
          }}
        />
      )}
    </div>
  );
};

const VideoCard = ({ video, isSelected, onToggleSelect, onEdit, onDelete, onApprove, onPost, onRender, isRendering, renderProgress }) => {
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

      <div style={styles.videoThumb}>
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
              <button style={styles.actionBtnPost} onClick={(e) => handleActionClick(e, onPost)}>Post</button>
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

/**
 * BatchCreateModal - Generate multiple draft videos at once
 */
const BatchCreateModal = ({ category, onClose, onCreateDrafts }) => {
  const [quantity, setQuantity] = useState(3);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedClips, setSelectedClips] = useState(new Set());
  const [clipStrategy, setClipStrategy] = useState('random');
  const [namePrefix, setNamePrefix] = useState(`BATCH_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`);
  const [isGenerating, setIsGenerating] = useState(false);

  const audioBank = category?.audio || [];
  const videoBank = category?.videos || [];

  const canGenerate = selectedAudio && selectedClips.size > 0 && quantity >= 2 && quantity <= 10;

  const toggleClip = (clipId) => {
    setSelectedClips(prev => {
      const newSet = new Set(prev);
      if (newSet.has(clipId)) newSet.delete(clipId);
      else newSet.add(clipId);
      return newSet;
    });
  };

  const selectAllClips = () => {
    if (selectedClips.size === videoBank.length) {
      setSelectedClips(new Set());
    } else {
      setSelectedClips(new Set(videoBank.map((_, i) => i)));
    }
  };

  const handleGenerate = () => {
    setIsGenerating(true);

    const selectedClipsList = videoBank.filter((_, i) => selectedClips.has(i));
    const drafts = [];

    for (let i = 0; i < quantity; i++) {
      // Pick clips based on strategy
      let draftClips;
      if (clipStrategy === 'random' && selectedClipsList.length >= 1) {
        // Random unique selection
        const shuffled = [...selectedClipsList].sort(() => Math.random() - 0.5);
        draftClips = shuffled.slice(0, Math.min(3, shuffled.length)); // Max 3 clips per video
      } else {
        // Sequential with wrapping
        const startIdx = i % selectedClipsList.length;
        draftClips = [selectedClipsList[startIdx]];
      }

      const draft = {
        id: `draft_${Date.now()}_${i}`,
        createdAt: new Date().toISOString(),
        title: `${namePrefix}_${(i + 1).toString().padStart(2, '0')}`,
        status: VIDEO_STATUS.DRAFT,
        category: category?.name,
        audio: selectedAudio,
        clips: draftClips.map(c => ({
          url: c.url,
          name: c.name || 'Clip',
          thumbnailUrl: c.thumbnailUrl || c.url
        })),
        textStyle: {
          fontSize: 48,
          fontFamily: 'Inter, sans-serif',
          fontWeight: '600',
          color: '#ffffff',
          outline: true,
          outlineColor: '#000000'
        },
        lyrics: '',
        words: [],
        thumbnail: draftClips[0]?.thumbnailUrl || null,
        export: { cloudUrl: null, thumbnailUrl: null }
      };

      drafts.push(draft);
    }

    // Save to category's createdVideos (through parent)
    setTimeout(() => {
      setIsGenerating(false);
      onCreateDrafts(drafts);
    }, 500);
  };

  // ESC to close
  React.useEffect(() => {
    const handleEsc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // Prevent background scroll
  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div
      style={batchStyles.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={batchStyles.modal}>
        <div style={batchStyles.header}>
          <h2 style={batchStyles.title}>Batch Create Drafts</h2>
          <button style={batchStyles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={batchStyles.body}>
          {/* Audio Selection */}
          <div style={batchStyles.section}>
            <label style={batchStyles.label}>Audio Track *</label>
            {audioBank.length === 0 ? (
              <p style={batchStyles.emptyHint}>No audio in this category. Add audio first.</p>
            ) : (
              <select
                style={batchStyles.select}
                value={selectedAudio?.url || ''}
                onChange={(e) => {
                  const audio = audioBank.find(a => a.url === e.target.value);
                  setSelectedAudio(audio);
                }}
              >
                <option value="">Select audio...</option>
                {audioBank.map((audio, i) => (
                  <option key={i} value={audio.url}>{audio.name || `Audio ${i + 1}`}</option>
                ))}
              </select>
            )}
          </div>

          {/* Clip Selection */}
          <div style={batchStyles.section}>
            <div style={batchStyles.labelRow}>
              <label style={batchStyles.label}>Video Clips * ({selectedClips.size} selected)</label>
              <button style={batchStyles.selectAllBtn} onClick={selectAllClips}>
                {selectedClips.size === videoBank.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            {videoBank.length === 0 ? (
              <p style={batchStyles.emptyHint}>No clips in this category. Add video clips first.</p>
            ) : (
              <div style={batchStyles.clipGrid}>
                {videoBank.map((clip, i) => (
                  <div
                    key={i}
                    style={{
                      ...batchStyles.clipItem,
                      ...(selectedClips.has(i) ? batchStyles.clipItemSelected : {})
                    }}
                    onClick={() => toggleClip(i)}
                  >
                    <div style={batchStyles.clipThumb}>
                      {clip.thumbnailUrl ? (
                        <img src={clip.thumbnailUrl} alt="" style={batchStyles.clipThumbImg} />
                      ) : (
                        <div style={batchStyles.clipThumbPlaceholder}>🎬</div>
                      )}
                    </div>
                    <span style={batchStyles.clipName}>{clip.name || `Clip ${i + 1}`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quantity & Strategy */}
          <div style={batchStyles.row}>
            <div style={batchStyles.halfSection}>
              <label style={batchStyles.label}>Quantity (2-10)</label>
              <input
                type="number"
                min="2"
                max="10"
                value={quantity}
                onChange={(e) => setQuantity(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                style={batchStyles.input}
              />
            </div>
            <div style={batchStyles.halfSection}>
              <label style={batchStyles.label}>Clip Selection</label>
              <select
                value={clipStrategy}
                onChange={(e) => setClipStrategy(e.target.value)}
                style={batchStyles.select}
              >
                <option value="random">Random unique</option>
                <option value="sequential">Sequential</option>
              </select>
            </div>
          </div>

          {/* Naming */}
          <div style={batchStyles.section}>
            <label style={batchStyles.label}>Name Prefix</label>
            <input
              type="text"
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              style={batchStyles.input}
              placeholder="BATCH_20260202"
            />
          </div>
        </div>

        <div style={batchStyles.footer}>
          {!canGenerate && (
            <p style={batchStyles.hint}>
              {!selectedAudio ? 'Select an audio track' :
               selectedClips.size === 0 ? 'Select at least one clip' :
               'Set quantity between 2-10'}
            </p>
          )}
          <div style={batchStyles.footerActions}>
            <button style={batchStyles.cancelBtn} onClick={onClose}>Cancel</button>
            <button
              style={{
                ...batchStyles.generateBtn,
                ...(canGenerate ? {} : batchStyles.generateBtnDisabled)
              }}
              disabled={!canGenerate || isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? 'Generating...' : `Generate ${quantity} Drafts`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const batchStyles = {
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' },
  modal: { backgroundColor: '#111118', borderRadius: '16px', width: '100%', maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #1f1f2e' },
  title: { fontSize: '18px', fontWeight: '600', color: '#fff', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: '#9ca3af', fontSize: '20px', cursor: 'pointer', padding: '4px 8px' },
  body: { flex: 1, overflow: 'auto', padding: '24px' },
  section: { marginBottom: '20px' },
  labelRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  label: { display: 'block', fontSize: '13px', fontWeight: '500', color: '#9ca3af', marginBottom: '8px' },
  select: { width: '100%', padding: '10px 12px', backgroundColor: '#1f1f2e', border: '1px solid #2d2d3d', borderRadius: '8px', color: '#fff', fontSize: '14px' },
  input: { width: '100%', padding: '10px 12px', backgroundColor: '#1f1f2e', border: '1px solid #2d2d3d', borderRadius: '8px', color: '#fff', fontSize: '14px', boxSizing: 'border-box' },
  row: { display: 'flex', gap: '16px', marginBottom: '20px' },
  halfSection: { flex: 1 },
  clipGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', maxHeight: '200px', overflow: 'auto' },
  clipItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px', backgroundColor: '#1f1f2e', borderRadius: '8px', cursor: 'pointer', border: '2px solid transparent' },
  clipItemSelected: { border: '2px solid #7c3aed', backgroundColor: '#2d2d3d' },
  clipThumb: { width: '60px', height: '80px', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px' },
  clipThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  clipThumbPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0f', fontSize: '20px' },
  clipName: { fontSize: '10px', color: '#9ca3af', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' },
  selectAllBtn: { fontSize: '12px', color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer' },
  emptyHint: { fontSize: '13px', color: '#6b7280', fontStyle: 'italic' },
  footer: { padding: '16px 24px', borderTop: '1px solid #1f1f2e' },
  hint: { fontSize: '12px', color: '#9ca3af', marginBottom: '12px' },
  footerActions: { display: 'flex', justifyContent: 'flex-end', gap: '12px' },
  cancelBtn: { padding: '10px 20px', backgroundColor: '#1f1f2e', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px' },
  generateBtn: { padding: '10px 24px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
  generateBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' }
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
