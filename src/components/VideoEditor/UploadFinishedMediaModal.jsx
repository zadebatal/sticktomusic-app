/**
 * UploadFinishedMediaModal — Upload finished videos/images directly to the scheduling queue
 */
import React, { useState, useRef, useCallback } from 'react';
import { uploadFile, generateThumbnail } from '../../services/firebaseStorage';
import { createScheduledPost } from '../../services/scheduledPostsService';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherX, FeatherUploadCloud, FeatherTrash2, FeatherImage, FeatherFilm,
} from '@subframe/core';

const MAX_CONCURRENT = 3;

const UploadFinishedMediaModal = ({ db, artistId, onClose, onComplete }) => {
  const [files, setFiles] = useState([]); // { file, name, type, localPreview, progress, status, error }
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const addFiles = useCallback((newFiles) => {
    const entries = Array.from(newFiles)
      .filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'))
      .map(f => ({
        file: f,
        name: f.name.replace(/\.[^/.]+$/, ''), // strip extension for display
        type: f.type.startsWith('video/') ? 'video' : 'image',
        localPreview: URL.createObjectURL(f),
        progress: 0,
        status: 'pending', // pending | uploading | done | error
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

  const handleUploadAll = useCallback(async () => {
    if (files.length === 0 || !db || !artistId) return;
    setUploading(true);

    const hashtagsArray = hashtags
      .split(/[,\s]+/)
      .map(h => h.replace(/^#/, '').trim())
      .filter(Boolean);

    // Simple semaphore for concurrent uploads
    let idx = 0;
    const total = files.length;
    let completed = 0;

    const processNext = async () => {
      while (idx < total) {
        const currentIdx = idx++;
        const entry = files[currentIdx];
        if (!entry) continue;

        // Mark uploading
        setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, status: 'uploading' } : f));

        try {
          // Upload to Firebase Storage
          const { url: cloudUrl } = await uploadFile(entry.file, 'finished-media', (pct) => {
            setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, progress: Math.round(pct) } : f));
          });

          // Generate thumbnail for videos, use cloudUrl for images
          let thumbnail = cloudUrl;
          if (entry.type === 'video') {
            const thumb = await generateThumbnail(cloudUrl, 1);
            if (thumb) thumbnail = thumb;
          }

          // Create scheduled post
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
            collectionName: null,
            mediaType: entry.type,
          });

          setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, status: 'done', progress: 100 } : f));
          completed++;
        } catch (err) {
          console.error('Upload failed:', entry.file.name, err);
          setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, status: 'error', error: err.message } : f));
          completed++;
        }
      }
    };

    // Launch concurrent workers
    const workers = [];
    for (let w = 0; w < Math.min(MAX_CONCURRENT, total); w++) {
      workers.push(processNext());
    }
    await Promise.all(workers);

    setUploading(false);
    if (onComplete) onComplete(completed);
    onClose();
  }, [files, db, artistId, caption, hashtags, onComplete, onClose]);

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-[#111111] p-6 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Upload Finished Media</span>
          <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} aria-label="Close" onClick={onClose} />
        </div>

        {/* Drop zone */}
        {!uploading && (
          <div
            className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-neutral-700 bg-[#0a0a0f] px-6 py-8 cursor-pointer hover:border-neutral-500 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
          >
            <FeatherUploadCloud className="text-neutral-500" style={{ width: 32, height: 32 }} />
            <span className="text-body font-body text-neutral-400">Drop files here or click to browse</span>
            <span className="text-caption font-caption text-neutral-600">Videos and images accepted</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,image/*"
              className="hidden"
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="flex flex-col gap-2 mt-4 overflow-y-auto max-h-[300px]">
            {files.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1a] px-3 py-2">
                {/* Preview */}
                <div className="w-10 h-10 flex-none rounded bg-[#0a0a0f] overflow-hidden flex items-center justify-center">
                  {entry.type === 'image' ? (
                    <img src={entry.localPreview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <FeatherFilm className="text-neutral-500" style={{ width: 18, height: 18 }} />
                  )}
                </div>

                {/* Name + meta */}
                <div className="flex grow flex-col gap-0.5 min-w-0">
                  {!uploading ? (
                    <input
                      className="bg-transparent text-sm text-white outline-none w-full truncate"
                      value={entry.name}
                      onChange={e => updateFileName(i, e.target.value)}
                    />
                  ) : (
                    <span className="text-sm text-white truncate">{entry.name}</span>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{entry.type === 'video' ? 'Video' : 'Image'}</Badge>
                    <span className="text-[11px] text-neutral-500">{formatSize(entry.file.size)}</span>
                  </div>
                  {/* Progress bar */}
                  {entry.status === 'uploading' && (
                    <div className="w-full h-1 rounded-full bg-neutral-800 mt-1">
                      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${entry.progress}%` }} />
                    </div>
                  )}
                  {entry.status === 'done' && (
                    <span className="text-[11px] text-green-500">Uploaded</span>
                  )}
                  {entry.status === 'error' && (
                    <span className="text-[11px] text-red-500">{entry.error || 'Failed'}</span>
                  )}
                </div>

                {/* Remove button */}
                {!uploading && (
                  <IconButton variant="neutral-tertiary" size="small" icon={<FeatherTrash2 />} aria-label="Remove" onClick={() => removeFile(i)} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Caption + hashtags */}
        {files.length > 0 && !uploading && (
          <div className="flex flex-col gap-3 mt-4 border-t border-solid border-neutral-800 pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-caption-bold font-caption-bold text-neutral-300">Caption (optional)</span>
              <textarea
                className="w-full rounded-lg border border-neutral-700 bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none resize-none focus:border-neutral-500"
                rows={2}
                placeholder="Caption for all uploads..."
                value={caption}
                onChange={e => setCaption(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-caption-bold font-caption-bold text-neutral-300">Hashtags (optional)</span>
              <input
                className="w-full rounded-lg border border-neutral-700 bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                placeholder="#music #viral #newrelease"
                value={hashtags}
                onChange={e => setHashtags(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 mt-4">
          {!uploading && (
            <Button variant="neutral-secondary" size="medium" onClick={onClose}>Cancel</Button>
          )}
          <Button
            variant="brand-primary"
            size="medium"
            icon={<FeatherUploadCloud />}
            disabled={files.length === 0 || uploading}
            loading={uploading}
            onClick={handleUploadAll}
          >
            {uploading
              ? `Uploading ${files.filter(f => f.status === 'done').length}/${files.length}...`
              : `Upload & Add to Queue (${files.length})`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UploadFinishedMediaModal;
