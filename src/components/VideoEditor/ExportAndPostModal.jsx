import React, { useState, useCallback } from 'react';
import { renderVideo, exportAsPreview } from '../../services/videoExportService';
import { uploadVideo } from '../../services/firebaseStorage';

/**
 * ExportAndPostModal - Modal for exporting and posting videos
 * Renders the video, uploads to Firebase, and provides posting options
 */
const ExportAndPostModal = ({
  video,
  videos = [],
  category,
  onClose,
  onSchedulePost // Function to call Late API: (videoUrl, caption) => Promise
}) => {
  const [stage, setStage] = useState('options'); // options, rendering, uploading, ready, posting, done
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [caption, setCaption] = useState(video?.textOverlay || '');

  // Check if video was already exported (has a cloud URL)
  const alreadyExported = video?.postedUrl || video?.cloudUrl;

  // Check if video has valid clip URLs (not null/stripped by storage)
  const hasValidClips = () => {
    const clips = video?.clips || [];
    const selectedClips = video?.selectedClips || [];
    const allClips = [...clips, ...selectedClips];
    return allClips.some(clip => clip?.url && typeof clip.url === 'string' && clip.url.length > 0);
  };

  // Export only (download locally)
  const handleExportOnly = useCallback(async () => {
    // Check for valid clips first
    if (!hasValidClips()) {
      setError('This video was saved as a draft and its clip data has expired. Please re-create the video from the Video Editor and use "Save & Post" to export.');
      return;
    }

    setStage('rendering');
    setProgress(0);
    setError(null);

    try {
      const blob = await renderVideo(video, setProgress);

      // Download the file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video_${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStage('done');
    } catch (err) {
      console.error('Export error:', err);
      setError(err.message || 'Failed to export video');
      setStage('options');
    }
  }, [video]);

  // Export and upload to Firebase
  const handleExportAndUpload = useCallback(async () => {
    // Check for valid clips first
    if (!hasValidClips()) {
      setError('This video was saved as a draft and its clip data has expired. Please re-create the video from the Video Editor and use "Save & Post" to export.');
      return;
    }

    setStage('rendering');
    setProgress(0);
    setError(null);

    try {
      // Step 1: Render video
      const blob = await renderVideo(video, (p) => setProgress(p * 0.5)); // 0-50% for rendering

      // Step 2: Upload to Firebase
      setStage('uploading');
      const url = await uploadVideo(blob, `video_${video.id}`, (p) => {
        setProgress(50 + p * 0.5); // 50-100% for uploading
      });

      setVideoUrl(url);
      setStage('ready');
    } catch (err) {
      console.error('Export/upload error:', err);
      setError(err.message || 'Failed to export or upload video');
      setStage('options');
    }
  }, [video]);

  // Schedule post via Late API
  const handleSchedulePost = useCallback(async () => {
    if (!videoUrl || !onSchedulePost) return;

    setStage('posting');
    setError(null);

    try {
      await onSchedulePost(videoUrl, caption);
      setStage('done');
    } catch (err) {
      console.error('Posting error:', err);
      setError(err.message || 'Failed to schedule post');
      setStage('ready');
    }
  }, [videoUrl, caption, onSchedulePost]);

  // Copy URL to clipboard
  const handleCopyUrl = useCallback(() => {
    if (videoUrl) {
      navigator.clipboard.writeText(videoUrl);
    }
  }, [videoUrl]);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>
            {stage === 'options' && 'Export Video'}
            {stage === 'rendering' && 'Rendering Video...'}
            {stage === 'uploading' && 'Uploading to Cloud...'}
            {stage === 'ready' && 'Ready to Post'}
            {stage === 'posting' && 'Scheduling Post...'}
            {stage === 'done' && 'Done!'}
          </h2>
          <button style={styles.closeButton} onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div style={styles.body}>
          {/* Options Stage - Already Exported */}
          {stage === 'options' && alreadyExported && (
            <>
              <div style={styles.successIcon}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <p style={styles.successText}>This video was already exported!</p>
              <div style={styles.urlSection}>
                <input type="text" value={alreadyExported} readOnly style={styles.urlInput} />
                <button style={styles.copyButton} onClick={() => navigator.clipboard.writeText(alreadyExported)}>
                  Copy
                </button>
              </div>
              {onSchedulePost && (
                <button style={styles.primaryButton} onClick={() => onSchedulePost({ videoUrl: alreadyExported, video, category })}>
                  📤 Schedule Post via Late
                </button>
              )}
              <button style={styles.doneButton} onClick={onClose}>Done</button>
            </>
          )}

          {/* Options Stage - Not Yet Exported */}
          {stage === 'options' && !alreadyExported && (
            <>
              {/* Preview */}
              <div style={styles.previewSection}>
                {video?.thumbnail ? (
                  <img src={video.thumbnail} alt="Preview" style={styles.previewImage} />
                ) : (
                  <div style={styles.previewPlaceholder}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="M10 9l5 3-5 3V9z"/>
                    </svg>
                  </div>
                )}
              </div>

              {/* Video Info */}
              <div style={styles.infoSection}>
                <div style={styles.infoRow}>
                  <span style={styles.infoLabel}>Duration:</span>
                  <span style={styles.infoValue}>{video?.duration?.toFixed(1) || 0}s</span>
                </div>
                <div style={styles.infoRow}>
                  <span style={styles.infoLabel}>Clips:</span>
                  <span style={styles.infoValue}>{video?.clips?.length || 0}</span>
                </div>
                {video?.bpm && (
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>BPM:</span>
                    <span style={styles.infoValue}>{Math.round(video.bpm)}</span>
                  </div>
                )}
              </div>

              {/* Export Options */}
              <div style={styles.optionsSection}>
                <button style={styles.primaryButton} onClick={handleExportAndUpload}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Export & Upload to Cloud
                </button>
                <p style={styles.optionDesc}>
                  Render video and upload to cloud storage for posting
                </p>

                <button style={styles.secondaryButton} onClick={handleExportOnly}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download Only
                </button>
                <p style={styles.optionDesc}>
                  Download video file to your computer
                </p>
              </div>
            </>
          )}

          {/* Rendering/Uploading Stage */}
          {(stage === 'rendering' || stage === 'uploading' || stage === 'posting') && (
            <div style={styles.progressSection}>
              <div style={styles.progressCircle}>
                <svg viewBox="0 0 100 100" style={styles.progressSvg}>
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="#1f1f2e"
                    strokeWidth="8"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="#7c3aed"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${progress * 2.83} 283`}
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <span style={styles.progressText}>{progress}%</span>
              </div>
              <p style={styles.progressLabel}>
                {stage === 'rendering' && 'Rendering video frames...'}
                {stage === 'uploading' && 'Uploading to cloud storage...'}
                {stage === 'posting' && 'Scheduling post...'}
              </p>
            </div>
          )}

          {/* Ready Stage */}
          {stage === 'ready' && (
            <>
              <div style={styles.successIcon}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>

              <p style={styles.successText}>Video uploaded successfully!</p>

              {/* URL Display */}
              <div style={styles.urlSection}>
                <input
                  type="text"
                  value={videoUrl}
                  readOnly
                  style={styles.urlInput}
                />
                <button style={styles.copyButton} onClick={handleCopyUrl}>
                  Copy
                </button>
              </div>

              {/* Caption Editor */}
              <div style={styles.captionSection}>
                <label style={styles.captionLabel}>Caption:</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Add a caption for your post..."
                  style={styles.captionInput}
                />
              </div>

              {/* Post Actions */}
              <div style={styles.postActions}>
                <p style={styles.helpText}>
                  Copy this URL and paste it in the posting module to schedule your post
                </p>
                <button style={styles.doneButton} onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          )}

          {/* Done Stage */}
          {stage === 'done' && (
            <>
              <div style={styles.successIcon}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <h3 style={styles.doneTitle}>Success!</h3>
              <p style={styles.doneText}>Your video has been processed.</p>
              <button style={styles.doneButton} onClick={onClose}>
                Close
              </button>
            </>
          )}

          {/* Error Display */}
          {error && (
            <div style={styles.errorBox}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
    padding: '20px'
  },
  modal: {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: '#111118',
    borderRadius: '12px',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #1f1f2e'
  },
  title: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
    margin: 0
  },
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '6px'
  },
  body: {
    padding: '20px'
  },
  previewSection: {
    aspectRatio: '9/16',
    maxHeight: '200px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px',
    overflow: 'hidden',
    marginBottom: '16px'
  },
  previewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  previewPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  infoSection: {
    display: 'flex',
    gap: '16px',
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: '#0a0a0f',
    borderRadius: '8px'
  },
  infoRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  infoLabel: {
    fontSize: '11px',
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  infoValue: {
    fontSize: '14px',
    color: '#fff',
    fontWeight: '600'
  },
  optionsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  primaryButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '14px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600'
  },
  secondaryButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '14px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    marginTop: '8px'
  },
  optionDesc: {
    fontSize: '12px',
    color: '#6b7280',
    margin: '4px 0 12px 0',
    textAlign: 'center'
  },
  progressSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 0'
  },
  progressCircle: {
    position: 'relative',
    width: '120px',
    height: '120px'
  },
  progressSvg: {
    width: '100%',
    height: '100%'
  },
  progressText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '24px',
    fontWeight: '700',
    color: '#fff'
  },
  progressLabel: {
    marginTop: '16px',
    fontSize: '14px',
    color: '#9ca3af'
  },
  successIcon: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '16px'
  },
  successText: {
    fontSize: '14px',
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: '20px'
  },
  urlSection: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px'
  },
  urlInput: {
    flex: 1,
    padding: '10px 12px',
    backgroundColor: '#0a0a0f',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    outline: 'none'
  },
  copyButton: {
    padding: '10px 16px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px'
  },
  captionSection: {
    marginBottom: '20px'
  },
  captionLabel: {
    display: 'block',
    fontSize: '13px',
    color: '#9ca3af',
    marginBottom: '8px'
  },
  captionInput: {
    width: '100%',
    minHeight: '80px',
    padding: '12px',
    backgroundColor: '#0a0a0f',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    resize: 'vertical',
    outline: 'none'
  },
  postActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  postButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '14px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600'
  },
  doneButton: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  doneTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    margin: '0 0 8px 0'
  },
  doneText: {
    fontSize: '14px',
    color: '#9ca3af',
    textAlign: 'center',
    margin: '0 0 24px 0'
  },
  helpText: {
    fontSize: '13px',
    color: '#6b7280',
    textAlign: 'center',
    margin: '0 0 16px 0',
    lineHeight: '1.5'
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    border: '1px solid #dc2626',
    borderRadius: '8px',
    color: '#ef4444',
    fontSize: '13px',
    marginTop: '16px'
  }
};

export default ExportAndPostModal;
