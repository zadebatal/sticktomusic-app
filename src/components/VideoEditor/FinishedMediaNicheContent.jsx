/**
 * FinishedMediaNicheContent — Upload finished videos/images, view uploads, caption/hashtag banks
 */

import {
  FeatherCheck,
  FeatherChevronDown,
  FeatherFilm,
  FeatherImage,
  FeatherMusic,
  FeatherPlay,
  FeatherPlus,
  FeatherTrash2,
  FeatherUploadCloud,
  FeatherX,
} from '@subframe/core';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { updateNicheAudioId } from '../../services/libraryService';
import { subscribeToScheduledPosts } from '../../services/scheduledPostsService';
import { Badge } from '../../ui/components/Badge';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { useToast } from '../ui';
import useFileUploader from './shared/useFileUploader';

const FinishedMediaNicheContent = ({ db, user = null, artistId, niche, projectAudio = [] }) => {
  const { success: toastSuccess } = useToast();
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [previewPost, setPreviewPost] = useState(null);
  const fileInputRef = useRef(null);

  const {
    files,
    uploading,
    addFiles,
    removeFile,
    updateFileName,
    handleDrop,
    uploadAll,
    clearFiles,
    formatSize,
  } = useFileUploader({ db, artistId, nicheId: niche?.id, nicheName: niche?.name, user });

  // Audio picker
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const selectedAudio = useMemo(
    () => projectAudio.find((a) => a.id === niche?.audioId) || projectAudio[0] || null,
    [projectAudio, niche?.audioId],
  );

  // Subscribe to scheduled posts to show uploads from this niche
  useEffect(() => {
    if (!db || !artistId) return;
    return subscribeToScheduledPosts(db, artistId, setScheduledPosts);
  }, [db, artistId]);

  // Filter to uploads from this niche
  const nicheUploads = useMemo(
    () =>
      scheduledPosts
        .filter((p) => p.contentType === 'upload' && p.nicheId === niche?.id)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [scheduledPosts, niche?.id],
  );

  // Escape-to-close preview lightbox
  useEffect(() => {
    if (!previewPost) return;
    const handler = (e) => {
      if (e.key === 'Escape') setPreviewPost(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewPost]);

  // Click-outside to close audio picker
  const audioPickerRef = useRef(null);
  useEffect(() => {
    if (!audioPickerOpen) return;
    const handler = (e) => {
      if (audioPickerRef.current && !audioPickerRef.current.contains(e.target)) {
        setAudioPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [audioPickerOpen]);

  const handleSelectAudio = useCallback(
    (audioId) => {
      if (!niche) return;
      updateNicheAudioId(artistId, niche.id, audioId, db);
      setAudioPickerOpen(false);
    },
    [artistId, niche, db],
  );

  const handleUploadAll = useCallback(async () => {
    if (files.length === 0 || !niche) return;
    const completed = await uploadAll({ caption, hashtags });
    if (completed > 0) {
      toastSuccess(`Uploaded ${completed} file${completed !== 1 ? 's' : ''} to queue`);
      clearFiles();
      setCaption('');
      setHashtags('');
    }
  }, [files, niche, caption, hashtags, uploadAll, clearFiles, toastSuccess]);

  if (!niche) return null;

  return (
    <div className="flex flex-1 flex-col items-center self-stretch overflow-y-auto">
      {/* Upload area */}
      <div className="flex w-full flex-col items-center gap-4 px-4 sm:px-12 py-6 sm:py-8">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30">
            <FeatherUploadCloud className="text-cyan-400" style={{ width: 28, height: 28 }} />
          </div>
          <span className="text-heading-2 font-heading-2 text-white">Finished Media</span>
          <span className="text-body font-body text-neutral-400 text-center max-w-sm">
            Upload ready-to-post videos and images directly to your scheduling queue
          </span>
        </div>

        {/* Drop zone */}
        <div
          className={`flex w-full max-w-md flex-col items-center gap-3 rounded-lg border-2 border-dashed border-neutral-200 bg-[#0a0a0f] px-6 py-6 cursor-pointer hover:border-neutral-500 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDrop={(e) => {
            if (!uploading) handleDrop(e);
            else e.preventDefault();
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          <FeatherUploadCloud className="text-neutral-500" style={{ width: 28, height: 28 }} />
          <span className="text-body font-body text-neutral-400">
            Drop files here or click to browse
          </span>
          <span className="text-caption font-caption text-neutral-600">
            Videos and images accepted
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,image/*"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {/* Staged files */}
        {files.length > 0 && (
          <div className="flex w-full max-w-md flex-col gap-2">
            {files.map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-solid border-neutral-200 bg-[#1a1a1a] px-3 py-2"
              >
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
                      onChange={(e) => updateFileName(i, e.target.value)}
                    />
                  ) : (
                    <span className="text-sm text-white truncate">{entry.name}</span>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{entry.type === 'video' ? 'Video' : 'Image'}</Badge>
                    <span className="text-[11px] text-neutral-500">
                      {formatSize(entry.file.size)}
                    </span>
                  </div>
                  {entry.status === 'uploading' && (
                    <div className="w-full h-1 rounded-full bg-neutral-100 mt-1">
                      <div
                        className="h-full rounded-full bg-cyan-500 transition-all"
                        style={{ width: `${entry.progress}%` }}
                      />
                    </div>
                  )}
                  {entry.status === 'done' && (
                    <span className="text-[11px] text-green-500">Uploaded</span>
                  )}
                  {entry.status === 'error' && (
                    <span className="text-[11px] text-red-500">{entry.error || 'Failed'}</span>
                  )}
                </div>
                {!uploading && (
                  <IconButton
                    variant="neutral-tertiary"
                    size="small"
                    icon={<FeatherTrash2 />}
                    aria-label="Remove"
                    onClick={() => removeFile(i)}
                  />
                )}
              </div>
            ))}

            {/* Optional caption/hashtags for this batch */}
            {!uploading && (
              <div className="flex flex-col gap-2 mt-2">
                <input
                  className="w-full rounded-lg border border-neutral-200 bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                  placeholder="Caption (optional)..."
                  aria-label="Caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
                <input
                  className="w-full rounded-lg border border-neutral-200 bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                  placeholder="#hashtags (optional)"
                  aria-label="Hashtags"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
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
                ? `Uploading ${files.filter((f) => f.status === 'done').length}/${files.length}...`
                : `Upload & Add to Queue (${files.length})`}
            </Button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {nicheUploads.length === 0 && files.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-4 sm:px-12">
          <FeatherUploadCloud className="w-12 h-12 text-neutral-500" />
          <h3 className="text-body-bold font-body-bold text-white">No uploads yet</h3>
          <p className="text-caption font-caption text-neutral-400">
            Upload finished videos or images using the area above
          </p>
        </div>
      )}

      {/* Uploaded posts grid */}
      {nicheUploads.length > 0 && (
        <div className="flex w-full flex-col gap-4 px-4 sm:px-12 pb-6">
          <div className="flex items-center gap-2">
            <span className="text-body-bold font-body-bold text-white">Uploads</span>
            <Badge variant="neutral">{nicheUploads.length}</Badge>
          </div>
          <div className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {nicheUploads.map((post) => (
              <div
                key={post.id}
                className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors"
                onClick={() => setPreviewPost(post)}
              >
                {post.thumbnail ? (
                  <div className="w-full aspect-video bg-neutral-100">
                    {post.mediaType === 'video' ? (
                      <video
                        src={post.cloudUrl}
                        className="w-full h-full object-cover"
                        muted
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={post.thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>
                ) : (
                  <div className="w-full aspect-video bg-neutral-100 flex items-center justify-center">
                    <FeatherImage className="text-neutral-700" style={{ width: 24, height: 24 }} />
                  </div>
                )}
                <div className="flex w-full items-center gap-2 px-3 pb-3">
                  <span className="text-caption font-caption text-neutral-300 truncate flex-1">
                    {post.contentName || 'Untitled'}
                  </span>
                  <Badge
                    variant={
                      post.status === 'scheduled'
                        ? 'brand'
                        : post.status === 'posted'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {post.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview lightbox */}
      {previewPost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
          onClick={() => setPreviewPost(null)}
        >
          <div
            className="relative max-w-3xl max-h-[85vh] w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <IconButton
              className="absolute -top-10 right-0"
              variant="neutral-tertiary"
              size="medium"
              icon={<FeatherX />}
              aria-label="Close preview"
              onClick={() => setPreviewPost(null)}
            />
            {previewPost.mediaType === 'video' ? (
              <video
                src={previewPost.cloudUrl}
                className="w-full max-h-[80vh] rounded-lg"
                controls
                autoPlay
              />
            ) : (
              <img
                src={previewPost.cloudUrl || previewPost.thumbnail}
                alt={previewPost.contentName}
                className="w-full max-h-[80vh] rounded-lg object-contain"
              />
            )}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-body font-body text-white">
                {previewPost.contentName || 'Untitled'}
              </span>
              <Badge
                variant={
                  previewPost.status === 'scheduled'
                    ? 'brand'
                    : previewPost.status === 'posted'
                      ? 'success'
                      : 'neutral'
                }
              >
                {previewPost.status}
              </Badge>
            </div>
          </div>
        </div>
      )}

      {/* Audio picker */}
      <div className="flex w-full flex-col gap-2 border-t border-solid border-neutral-200 px-4 sm:px-12 py-4">
        <span className="text-caption-bold font-caption-bold text-neutral-300">Audio</span>
        <div className="relative max-w-sm" ref={audioPickerRef}>
          <button
            className="flex w-full items-center gap-2 rounded-md border border-solid border-neutral-200 bg-neutral-50 px-3 py-2 hover:bg-[#262626] transition"
            onClick={() => setAudioPickerOpen(!audioPickerOpen)}
          >
            <FeatherMusic className="text-indigo-400 flex-none" style={{ width: 14, height: 14 }} />
            <span className="text-caption font-caption text-white truncate grow text-left">
              {selectedAudio?.name || 'No audio'}
            </span>
            <FeatherChevronDown
              className="text-neutral-400 flex-none transition-transform"
              style={{
                width: 14,
                height: 14,
                transform: audioPickerOpen ? 'rotate(180deg)' : 'none',
              }}
            />
          </button>
          {audioPickerOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 flex flex-col gap-0.5 px-2 py-2 bg-[#111111] border border-neutral-200 rounded-lg max-h-48 overflow-y-auto shadow-xl z-20">
              {projectAudio.length === 0 && (
                <span className="text-caption font-caption text-neutral-500 px-2 py-1">
                  No audio uploaded
                </span>
              )}
              {projectAudio.map((audio) => {
                const isActive = selectedAudio?.id === audio.id;
                return (
                  <button
                    key={audio.id}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                      isActive ? 'bg-indigo-600' : 'hover:bg-neutral-100'
                    }`}
                    onClick={() => handleSelectAudio(audio.id)}
                  >
                    <FeatherPlay
                      className="text-neutral-300 flex-none"
                      style={{ width: 10, height: 10 }}
                    />
                    <span className="text-caption font-caption text-white truncate grow">
                      {audio.name}
                    </span>
                    {isActive && (
                      <FeatherCheck
                        className="text-indigo-300 flex-none"
                        style={{ width: 12, height: 12 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FinishedMediaNicheContent;
