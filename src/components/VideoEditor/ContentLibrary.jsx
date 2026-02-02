import React, { useState, useMemo } from 'react';
import ExportAndPostModal from './ExportAndPostModal';

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
  onSchedulePost
}) => {
  const [filter, setFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [selectedVideoIds, setSelectedVideoIds] = useState(new Set());
  const [exportingVideo, setExportingVideo] = useState(null);

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
          <button style={styles.secondaryButton} onClick={() => onMakeVideo()}>Make up to 10 at once</button>
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
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={styles.statusFilter}>
          <option value="all">All statuses</option>
          <option value="draft">Drafts</option>
          <option value="approved">Approved</option>
        </select>
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
                onDelete={() => onDeleteVideo(video.id)}
                onApprove={() => onApproveVideo(video.id)}
                onPost={() => setExportingVideo(video)}
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
            <button style={styles.batchBtnPost} onClick={() => setExportingVideo(selectedVideos[0])}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
              Post {selectedVideos.length} video{selectedVideos.length > 1 ? 's' : ''}
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
    </div>
  );
};

const VideoCard = ({ video, isSelected, onToggleSelect, onEdit, onDelete, onApprove, onPost }) => {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      style={{...styles.videoCard, ...(isSelected ? styles.videoCardSelected : {})}}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div style={styles.videoCheckbox}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} style={styles.checkbox} />
      </div>

      <div style={styles.videoThumb}>
        {video.thumbnail ? (
          <img src={video.thumbnail} alt="" style={styles.videoThumbImg} />
        ) : (
          <div style={styles.videoThumbPlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
            </svg>
          </div>
        )}

        {video.textOverlay && <div style={styles.textOverlay}>{video.textOverlay}</div>}

        {showActions && (
          <div style={styles.videoActions}>
            <button style={styles.actionBtn} onClick={onEdit}>Edit</button>
            <button style={styles.actionBtnPost} onClick={onPost}>Post</button>
            <button style={styles.actionBtnDel} onClick={onDelete}>✕</button>
          </div>
        )}
      </div>

      <div style={{...styles.statusBadge, ...(video.status === 'approved' ? styles.statusApproved : styles.statusDraft)}}>
        {video.status === 'approved' ? 'Approved' : 'Draft'}
      </div>
    </div>
  );
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
  dateFilter: { padding: '6px 12px', backgroundColor: 'transparent', border: 'none', borderRadius: '6px', color: '#9ca3af', cursor: 'pointer', fontSize: '13px' },
  dateFilterActive: { padding: '6px 12px', backgroundColor: '#1f1f2e', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px' },
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
  batchBtnPost: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#fff', border: 'none', borderRadius: '6px', color: '#7c3aed', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
  footer: { display: 'flex', justifyContent: 'center', gap: '16px', padding: '16px 24px', borderTop: '1px solid #1f1f2e' },
  footerButton: { padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #2d2d3d', borderRadius: '8px', color: '#9ca3af', cursor: 'pointer', fontSize: '13px' }
};

export default ContentLibrary;
