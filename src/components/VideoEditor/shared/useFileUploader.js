/**
 * useFileUploader — Shared hook for uploading finished media files
 * Used by UploadFinishedMediaModal and FinishedMediaNicheContent
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { uploadFileWithQuota, generateThumbnail } from '../../../services/firebaseStorage';
import { createScheduledPost } from '../../../services/scheduledPostsService';
import log from '../../../utils/logger';

const MAX_CONCURRENT = 3;

export default function useFileUploader({ db, artistId, nicheId = null, nicheName = null, user = null }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const mountedRef = useRef(true);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setFiles(prev => {
        prev.forEach(f => { if (f.localPreview) URL.revokeObjectURL(f.localPreview); });
        return [];
      });
    };
  }, []);

  const addFiles = useCallback((newFiles) => {
    const entries = Array.from(newFiles)
      .filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'))
      .map(f => ({
        file: f,
        name: f.name.replace(/\.[^/.]+$/, ''),
        type: f.type.startsWith('video/') ? 'video' : 'image',
        localPreview: URL.createObjectURL(f),
        progress: 0,
        status: 'pending',
        error: null,
      }));
    setFiles(prev => [...prev, ...entries]);
  }, []);

  const removeFile = useCallback((idx) => {
    setFiles(prev => {
      const removed = prev[idx];
      if (removed?.localPreview) URL.revokeObjectURL(removed.localPreview);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const updateFileName = useCallback((idx, newName) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, name: newName } : f));
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    if (uploading) return;
    addFiles(e.dataTransfer.files);
  }, [addFiles, uploading]);

  const uploadAll = useCallback(async ({ caption = '', hashtags = '' } = {}) => {
    if (files.length === 0 || !db || !artistId) return 0;
    setUploading(true);

    const hashtagsArray = hashtags
      .split(/[,\s]+/)
      .map(h => h.replace(/^#/, '').trim())
      .filter(Boolean);

    // Snapshot files at call time to avoid stale closure
    const snapshot = [...files];
    let idx = 0;
    const total = snapshot.length;
    let completed = 0;

    const processNext = async () => {
      while (idx < total) {
        const currentIdx = idx++;
        const entry = snapshot[currentIdx];
        if (!entry) continue;

        if (!mountedRef.current) return;
        setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, status: 'uploading' } : f));

        try {
          const quotaCtx = { userData: user, userEmail: user?.email };
          const { url: cloudUrl } = await uploadFileWithQuota(entry.file, 'finished-media', (pct) => {
            if (!mountedRef.current) return;
            setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, progress: Math.round(pct) } : f));
          }, {}, quotaCtx);

          let thumbnail = cloudUrl;
          if (entry.type === 'video') {
            const thumb = await generateThumbnail(cloudUrl, 1);
            if (thumb) thumbnail = thumb;
          }

          await createScheduledPost(db, artistId, {
            contentId: null,
            contentType: 'upload',
            contentName: entry.name,
            thumbnail,
            cloudUrl,
            audioUrl: null,
            platforms: {},
            scheduledTime: null,
            caption: caption || '',
            hashtags: hashtagsArray,
            status: 'draft',
            editorState: null,
            collectionName: nicheName || null,
            nicheId: nicheId || null,
            mediaType: entry.type,
          });

          if (mountedRef.current) {
            setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, status: 'done', progress: 100 } : f));
          }
          completed++;
        } catch (err) {
          log.error('Upload failed:', entry.file.name, err);
          if (mountedRef.current) {
            setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, status: 'error', error: err.message } : f));
          }
          completed++;
        }
      }
    };

    const workers = [];
    for (let w = 0; w < Math.min(MAX_CONCURRENT, total); w++) {
      workers.push(processNext());
    }
    await Promise.all(workers);

    if (mountedRef.current) setUploading(false);
    return completed;
  }, [files, db, artistId, nicheId, nicheName, user]);

  const clearFiles = useCallback(() => {
    setFiles(prev => {
      prev.forEach(f => { if (f.localPreview) URL.revokeObjectURL(f.localPreview); });
      return [];
    });
  }, []);

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return {
    files,
    uploading,
    addFiles,
    removeFile,
    updateFileName,
    handleDrop,
    uploadAll,
    clearFiles,
    formatSize,
  };
}
