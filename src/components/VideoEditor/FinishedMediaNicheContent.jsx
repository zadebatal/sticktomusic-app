/**
 * FinishedMediaNicheContent — Upload finished videos/images, view uploads, caption/hashtag banks
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { uploadFile, generateThumbnail } from '../../services/firebaseStorage';
import { createScheduledPost, subscribeToScheduledPosts } from '../../services/scheduledPostsService';
import {
  updateNicheCaptionBank,
  updateNicheHashtagBank,
  moveNicheBankEntry,
  getUserCollections,
  saveCollectionToFirestore,
} from '../../services/libraryService';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherUploadCloud, FeatherTrash2, FeatherImage, FeatherFilm,
  FeatherHash, FeatherMessageSquare, FeatherPlus, FeatherX, FeatherCheck,
} from '@subframe/core';
import { useToast } from '../ui';

const MAX_CONCURRENT = 3;

const FinishedMediaNicheContent = ({ db, artistId, niche, allNiches = [] }) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [files, setFiles] = useState([]);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [uploading, setUploading] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const fileInputRef = useRef(null);

  // Caption/hashtag state
  const [newCaption, setNewCaption] = useState('');
  const [newHashtag, setNewHashtag] = useState('');

  // Subscribe to scheduled posts to show uploads from this niche
  useEffect(() => {
    if (!db || !artistId) return;
    return subscribeToScheduledPosts(db, artistId, setScheduledPosts);
  }, [db, artistId]);

  // Filter to uploads from this niche
  const nicheUploads = useMemo(() =>
    scheduledPosts
      .filter(p => p.contentType === 'upload' && p.nicheId === niche?.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [scheduledPosts, niche?.id]
  );

  const captions = niche?.captionBank || [];
  const hashtagBank = niche?.hashtagBank || [];
  const otherNiches = (allNiches || []).filter(n => n.id !== niche?.id);

  const syncToFirestore = useCallback((nicheId) => {
    if (!db || !artistId) return;
    const col = getUserCollections(artistId).find(c => c.id === nicheId);
    if (col) saveCollectionToFirestore(db, artistId, col);
  }, [db, artistId]);

  // Caption handlers
  const handleAddCaption = useCallback(() => {
    const text = newCaption.trim();
    if (!text || !niche) return;
    updateNicheCaptionBank(artistId, niche.id, [...captions, text]);
    syncToFirestore(niche.id);
    setNewCaption('');
  }, [newCaption, captions, artistId, niche, syncToFirestore]);

  const handleRemoveCaption = useCallback((idx) => {
    if (!niche) return;
    updateNicheCaptionBank(artistId, niche.id, captions.filter((_, i) => i !== idx));
    syncToFirestore(niche.id);
  }, [captions, artistId, niche, syncToFirestore]);

  const handleMoveCaption = useCallback((entry, toNicheId) => {
    if (!niche) return;
    moveNicheBankEntry(artistId, niche.id, toNicheId, entry, 'caption');
    syncToFirestore(niche.id);
    syncToFirestore(toNicheId);
  }, [artistId, niche, syncToFirestore]);

  // Hashtag handlers
  const handleAddHashtag = useCallback(() => {
    let text = newHashtag.trim();
    if (!text || !niche) return;
    if (!text.startsWith('#')) text = '#' + text;
    if (hashtagBank.includes(text)) return;
    updateNicheHashtagBank(artistId, niche.id, [...hashtagBank, text]);
    syncToFirestore(niche.id);
    setNewHashtag('');
  }, [newHashtag, hashtagBank, artistId, niche, syncToFirestore]);

  const handleRemoveHashtag = useCallback((idx) => {
    if (!niche) return;
    updateNicheHashtagBank(artistId, niche.id, hashtagBank.filter((_, i) => i !== idx));
    syncToFirestore(niche.id);
  }, [hashtagBank, artistId, niche, syncToFirestore]);

  const handleMoveHashtag = useCallback((entry, toNicheId) => {
    if (!niche) return;
    moveNicheBankEntry(artistId, niche.id, toNicheId, entry, 'hashtag');
    syncToFirestore(niche.id);
    syncToFirestore(toNicheId);
  }, [artistId, niche, syncToFirestore]);

  const handleCopyAllHashtags = useCallback(() => {
    if (!hashtagBank.length) return;
    navigator.clipboard.writeText(hashtagBank.join(' '));
  }, [hashtagBank]);

  // File handling
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

  const handleUploadAll = useCallback(async () => {
    if (files.length === 0 || !db || !artistId || !niche) return;
    setUploading(true);

    const hashtagsArray = hashtags
      .split(/[,\s]+/)
      .map(h => h.replace(/^#/, '').trim())
      .filter(Boolean);

    let idx = 0;
    const total = files.length;
    let completed = 0;

    const processNext = async () => {
      while (idx < total) {
        const currentIdx = idx++;
        const entry = files[currentIdx];
        if (!entry) continue;

        setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, status: 'uploading' } : f));

        try {
          const { url: cloudUrl } = await uploadFile(entry.file, 'finished-media', (pct) => {
            setFiles(prev => prev.map((f, i) => i === currentIdx ? { ...f, progress: Math.round(pct) } : f));
          });

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
            collectionName: niche.name,
            nicheId: niche.id,
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

    const workers = [];
    for (let w = 0; w < Math.min(MAX_CONCURRENT, total); w++) {
      workers.push(processNext());
    }
    await Promise.all(workers);

    setUploading(false);
    toastSuccess(`Uploaded ${completed} file${completed !== 1 ? 's' : ''} to queue`);
    setFiles([]);
    setCaption('');
    setHashtags('');
  }, [files, db, artistId, niche, caption, hashtags, toastSuccess]);

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!niche) return null;

  return (
    <div className="flex flex-1 flex-col items-center self-stretch overflow-y-auto">
      {/* Upload area */}
      <div className="flex w-full flex-col items-center gap-4 px-12 py-8">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30">
            <FeatherUploadCloud className="text-cyan-400" style={{ width: 28, height: 28 }} />
          </div>
          <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Finished Media</span>
          <span className="text-body font-body text-neutral-400 text-center max-w-sm">
            Upload ready-to-post videos and images directly to your scheduling queue
          </span>
        </div>

        {/* Drop zone */}
        <div
          className="flex w-full max-w-md flex-col items-center gap-3 rounded-lg border-2 border-dashed border-neutral-700 bg-[#0a0a0f] px-6 py-6 cursor-pointer hover:border-neutral-500 transition-colors"
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
        >
          <FeatherUploadCloud className="text-neutral-500" style={{ width: 28, height: 28 }} />
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

        {/* Staged files */}
        {files.length > 0 && (
          <div className="flex w-full max-w-md flex-col gap-2">
            {files.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1a] px-3 py-2">
                <div className="w-10 h-10 flex-none rounded bg-[#0a0a0f] overflow-hidden flex items-center justify-center">
                  {entry.type === 'image' ? (
                    <img src={entry.localPreview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <FeatherFilm className="text-neutral-500" style={{ width: 18, height: 18 }} />
                  )}
                </div>
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
                  {entry.status === 'uploading' && (
                    <div className="w-full h-1 rounded-full bg-neutral-800 mt-1">
                      <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${entry.progress}%` }} />
                    </div>
                  )}
                  {entry.status === 'done' && <span className="text-[11px] text-green-500">Uploaded</span>}
                  {entry.status === 'error' && <span className="text-[11px] text-red-500">{entry.error || 'Failed'}</span>}
                </div>
                {!uploading && (
                  <IconButton variant="neutral-tertiary" size="small" icon={<FeatherTrash2 />} aria-label="Remove" onClick={() => removeFile(i)} />
                )}
              </div>
            ))}

            {/* Optional caption/hashtags for this batch */}
            {!uploading && (
              <div className="flex flex-col gap-2 mt-2">
                <input
                  className="w-full rounded-lg border border-neutral-700 bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                  placeholder="Caption (optional)..."
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                />
                <input
                  className="w-full rounded-lg border border-neutral-700 bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                  placeholder="#hashtags (optional)"
                  value={hashtags}
                  onChange={e => setHashtags(e.target.value)}
                />
              </div>
            )}

            <Button
              className="mt-2"
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
        )}
      </div>

      {/* Uploaded posts grid */}
      {nicheUploads.length > 0 && (
        <div className="flex w-full flex-col gap-4 px-12 pb-6">
          <div className="flex items-center gap-2">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Uploads</span>
            <Badge variant="neutral">{nicheUploads.length}</Badge>
          </div>
          <div className="grid w-full grid-cols-4 gap-3">
            {nicheUploads.map(post => (
              <div
                key={post.id}
                className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] overflow-hidden"
              >
                {post.thumbnail ? (
                  <div className="w-full aspect-video bg-[#171717]">
                    {post.mediaType === 'video' ? (
                      <video src={post.cloudUrl} className="w-full h-full object-cover" muted preload="metadata" />
                    ) : (
                      <img src={post.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )}
                  </div>
                ) : (
                  <div className="w-full aspect-video bg-[#171717] flex items-center justify-center">
                    <FeatherImage className="text-neutral-700" style={{ width: 24, height: 24 }} />
                  </div>
                )}
                <div className="flex w-full items-center gap-2 px-3 pb-3">
                  <span className="text-caption font-caption text-neutral-300 truncate flex-1">{post.contentName || 'Untitled'}</span>
                  <Badge variant={post.status === 'scheduled' ? 'brand' : post.status === 'posted' ? 'success' : 'neutral'}>
                    {post.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Captions & Hashtags */}
      <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-12 py-4">
        {/* Captions */}
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center gap-2">
            <FeatherMessageSquare className="text-neutral-400" style={{ width: 12, height: 12 }} />
            <span className="text-caption-bold font-caption-bold text-neutral-300">Captions</span>
            <Badge variant="neutral">{captions.length}</Badge>
          </div>
          {captions.length > 0 && (
            <div className="flex flex-col gap-1.5 max-h-[120px] overflow-y-auto">
              {captions.map((cap, idx) => (
                <div key={idx} className="flex items-start gap-2 rounded-md bg-[#1a1a1aff] border border-solid border-neutral-800 px-3 py-1.5 group">
                  <span
                    className="grow text-caption font-caption text-neutral-300 cursor-pointer hover:text-white line-clamp-2"
                    title="Click to copy"
                    onClick={() => navigator.clipboard.writeText(cap)}
                  >{cap}</span>
                  <div className="flex items-center gap-1 flex-none opacity-0 group-hover:opacity-100 transition-opacity">
                    {otherNiches.length > 0 && (
                      <select
                        className="bg-neutral-800 text-caption text-neutral-300 border-none rounded px-1 py-0.5 cursor-pointer outline-none"
                        value=""
                        onChange={e => { if (e.target.value) handleMoveCaption(cap, e.target.value); }}
                      >
                        <option value="" disabled>Move to...</option>
                        {otherNiches.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    )}
                    <button className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0" onClick={() => handleRemoveCaption(idx)}>
                      <FeatherTrash2 style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex w-full gap-2">
            <textarea
              className="flex-1 min-h-[32px] max-h-[64px] rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500 resize-none"
              placeholder="Add caption..."
              value={newCaption}
              onChange={e => setNewCaption(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddCaption(); } }}
              rows={1}
            />
            <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add" onClick={handleAddCaption} />
          </div>
        </div>

        {/* Hashtags */}
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center gap-2">
            <FeatherHash className="text-neutral-400" style={{ width: 12, height: 12 }} />
            <span className="text-caption-bold font-caption-bold text-neutral-300">Hashtags</span>
            <Badge variant="neutral">{hashtagBank.length}</Badge>
            {hashtagBank.length > 0 && (
              <button className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-auto" onClick={handleCopyAllHashtags}>
                Copy All
              </button>
            )}
          </div>
          {hashtagBank.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
              {hashtagBank.map((tag, idx) => (
                <div key={idx} className="flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-0.5 group">
                  <span className="text-caption font-caption text-indigo-300">{tag}</span>
                  <button className="text-indigo-400 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveHashtag(idx)}>
                    <FeatherX style={{ width: 10, height: 10 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex w-full gap-2">
            <input
              className="flex-1 rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
              placeholder="#hashtag"
              value={newHashtag}
              onChange={e => setNewHashtag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddHashtag(); }}
            />
            <IconButton variant="brand-tertiary" size="small" icon={<FeatherPlus />} aria-label="Add" onClick={handleAddHashtag} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinishedMediaNicheContent;
