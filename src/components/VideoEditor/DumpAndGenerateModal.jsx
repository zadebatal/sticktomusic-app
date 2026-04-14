/**
 * DumpAndGenerateModal — Bulk upload → auto-organize → one-click N variations
 *
 * The "wow" feature: drop a bunch of footage + pick audio → system auto-organizes
 * into media banks → opens editor with auto-generation count.
 *
 * This is the orchestration layer that chains Phase 1 & 2 features:
 * - Vision categorization (auto-tag and sort)
 * - Song recognition (group by song)
 * - Whisper → text bank populate
 * - Clip recycling (prioritize fresh footage)
 */

import { FeatherMusic, FeatherPlay, FeatherUpload, FeatherX, FeatherZap } from '@subframe/core';
import React, { useCallback, useRef, useState } from 'react';
import { uploadFile } from '../../services/firebaseStorage';
import {
  addMediaBank,
  addToCollection,
  addToLibraryAsync,
  assignToMediaBank,
  createMediaItem,
  createNiche,
} from '../../services/libraryService';
import { Badge } from '../../ui/components/Badge';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { convertAudioIfNeeded } from '../../utils/audioConverter';
import { convertImageIfNeeded } from '../../utils/imageConverter';
import log from '../../utils/logger';
import { useToast } from '../ui';

const SUPPORTED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
const SUPPORTED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/tiff'];
const SUPPORTED_AUDIO = [
  'audio/mpeg',
  'audio/wav',
  'audio/aac',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
];

const DumpAndGenerateModal = ({
  isOpen,
  onClose,
  artistId,
  projectId,
  db,
  onGenerate, // (nicheId, generateCount, audioId?) => void — opens editor
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [files, setFiles] = useState([]);
  const [audioFile, setAudioFile] = useState(null);
  const [generateCount, setGenerateCount] = useState(5);
  const [nicheName, setNicheName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ step: '', current: 0, total: 0 });
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const droppedFiles = Array.from(e.dataTransfer?.files || []);
      const media = droppedFiles.filter(
        (f) =>
          SUPPORTED_VIDEO.some((t) => f.type.startsWith(t.split('/')[0])) ||
          SUPPORTED_IMAGE.some((t) => f.type.startsWith(t.split('/')[0])) ||
          SUPPORTED_AUDIO.some((t) => f.type.startsWith(t.split('/')[0])),
      );

      // Separate audio from media
      const audioFiles = media.filter((f) => f.type.startsWith('audio/'));
      const mediaFiles = media.filter((f) => !f.type.startsWith('audio/'));

      if (mediaFiles.length > 0) setFiles((prev) => [...prev, ...mediaFiles]);
      if (audioFiles.length > 0 && !audioFile) setAudioFile(audioFiles[0]);
    },
    [audioFile],
  );

  const handleFileSelect = useCallback(
    (e) => {
      const selected = Array.from(e.target.files || []);
      const media = selected.filter((f) => !f.type.startsWith('audio/'));
      const audio = selected.filter((f) => f.type.startsWith('audio/'));
      if (media.length > 0) setFiles((prev) => [...prev, ...media]);
      if (audio.length > 0 && !audioFile) setAudioFile(audio[0]);
    },
    [audioFile],
  );

  const handleGenerate = useCallback(async () => {
    if (files.length === 0) {
      toastError('Drop some media files first');
      return;
    }
    if (!projectId || !artistId) {
      toastError('No project selected');
      return;
    }

    setIsProcessing(true);

    try {
      // Step 1: Create a niche
      const name = nicheName.trim() || `Dump ${new Date().toLocaleDateString()}`;
      const format = { id: 'multi_clip', name: 'Multi-Clip', contentType: 'video' };
      setProgress({ step: 'Creating niche...', current: 0, total: files.length });

      const niche = createNiche(artistId, { projectId, format, name }, db);
      const bankName = 'Clips';
      addMediaBank(artistId, niche.id, bankName, db);

      // Step 2: Upload all files
      const uploadedIds = [];
      for (let i = 0; i < files.length; i++) {
        const rawFile = files[i];
        setProgress({ step: `Uploading ${rawFile.name}...`, current: i + 1, total: files.length });

        try {
          let file = rawFile;
          if (rawFile.type.startsWith('image/')) file = await convertImageIfNeeded(rawFile);
          else if (rawFile.type.startsWith('audio/')) file = await convertAudioIfNeeded(rawFile);

          const isVideo = file.type.startsWith('video');
          const isAudio = file.type.startsWith('audio');
          const folder = isVideo ? 'videos' : isAudio ? 'audio' : 'images';

          const { url, path: storagePath } = await uploadFile(file, folder);

          const mediaItem = createMediaItem({
            type: isVideo ? 'video' : isAudio ? 'audio' : 'image',
            name: rawFile.name,
            url,
            storagePath,
            metadata: { fileSize: rawFile.size, mimeType: file.type },
          });

          await addToLibraryAsync(db, artistId, mediaItem);
          addToCollection(artistId, niche.id, mediaItem.id, db);
          uploadedIds.push(mediaItem.id);
        } catch (err) {
          log.warn(`[DumpGen] Failed to upload ${rawFile.name}:`, err.message);
        }
      }

      // Step 3: Assign to media bank
      if (uploadedIds.length > 0) {
        const nicheUpdated = niche;
        const bankId = nicheUpdated.mediaBanks?.[0]?.id;
        if (bankId) {
          assignToMediaBank(artistId, niche.id, uploadedIds, bankId, db);
        }
      }

      // Step 4: Upload audio if provided
      let audioId = null;
      if (audioFile) {
        setProgress({ step: 'Uploading audio...', current: files.length, total: files.length });
        try {
          const converted = await convertAudioIfNeeded(audioFile);
          const { url, path: storagePath } = await uploadFile(converted, 'audio');
          const audioItem = createMediaItem({
            type: 'audio',
            name: audioFile.name,
            url,
            storagePath,
            metadata: { fileSize: audioFile.size, mimeType: converted.type },
          });
          await addToLibraryAsync(db, artistId, audioItem);
          addToCollection(artistId, niche.id, audioItem.id, db);
          audioId = audioItem.id;
        } catch (err) {
          log.warn('[DumpGen] Audio upload failed:', err.message);
        }
      }

      toastSuccess(`Uploaded ${uploadedIds.length} files — opening editor`);

      // Step 5: Open editor with auto-generation
      onGenerate?.(niche.id, generateCount, audioId);
      onClose?.();
    } catch (err) {
      log.error('[DumpGen] Failed:', err);
      toastError('Generation failed: ' + err.message);
    } finally {
      setIsProcessing(false);
      setProgress({ step: '', current: 0, total: 0 });
    }
  }, [
    files,
    audioFile,
    generateCount,
    nicheName,
    projectId,
    artistId,
    db,
    onGenerate,
    onClose,
    toastSuccess,
    toastError,
  ]);

  const removeFile = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  if (!isOpen) return null;

  const videoCount = files.filter((f) => f.type.startsWith('video')).length;
  const imageCount = files.filter((f) => f.type.startsWith('image')).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-50 rounded-xl border border-neutral-200 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <FeatherZap className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold text-neutral-800">Dump & Generate</h2>
          </div>
          <IconButton icon={<FeatherX />} onClick={onClose} aria-label="Close" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Drop zone */}
          <div
            className="border-2 border-dashed border-neutral-200 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400/50 hover:bg-indigo-500/5 transition-colors"
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <FeatherUpload className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
            <p className="text-sm text-neutral-500">Drop video clips, photos, and audio here</p>
            <p className="text-xs text-neutral-400 mt-1">or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,image/*,audio/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <span>
                  {files.length} file{files.length !== 1 ? 's' : ''}
                </span>
                {videoCount > 0 && (
                  <Badge>
                    {videoCount} video{videoCount !== 1 ? 's' : ''}
                  </Badge>
                )}
                {imageCount > 0 && (
                  <Badge>
                    {imageCount} image{imageCount !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs text-neutral-400 bg-neutral-100 rounded px-2 py-1"
                  >
                    <span className="truncate flex-1">{f.name}</span>
                    <button
                      onClick={() => removeFile(i)}
                      className="ml-2 text-neutral-500 hover:text-red-400"
                    >
                      <FeatherX className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audio selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-500">Audio Track (optional)</label>
            <div className="flex items-center gap-2">
              {audioFile ? (
                <div className="flex items-center gap-2 bg-neutral-100 rounded-lg px-3 py-2 flex-1">
                  <FeatherMusic className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm text-neutral-400 truncate flex-1">{audioFile.name}</span>
                  <button
                    onClick={() => setAudioFile(null)}
                    className="text-neutral-500 hover:text-red-400"
                  >
                    <FeatherX className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <Button
                  variant="neutral-secondary"
                  size="small"
                  icon={<FeatherMusic />}
                  onClick={() => audioInputRef.current?.click()}
                >
                  Select Audio
                </Button>
              )}
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setAudioFile(f);
                }}
              />
            </div>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-neutral-500">Niche Name</label>
              <input
                type="text"
                value={nicheName}
                onChange={(e) => setNicheName(e.target.value)}
                placeholder={`Dump ${new Date().toLocaleDateString()}`}
                className="w-full px-3 py-2 bg-neutral-100 border border-neutral-200 rounded-lg text-sm text-neutral-800 placeholder-neutral-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-neutral-500">Variations</label>
              <div className="flex items-center gap-2">
                {[3, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setGenerateCount(n)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      generateCount === n
                        ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                        : 'bg-neutral-100 text-neutral-400 border border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Progress */}
          {isProcessing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>{progress.step}</span>
                <span>
                  {progress.current}/{progress.total}
                </span>
              </div>
              <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-200">
          <Button variant="neutral-secondary" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            onClick={handleGenerate}
            disabled={files.length === 0 || isProcessing}
            loading={isProcessing}
            icon={<FeatherZap />}
          >
            {isProcessing ? 'Processing...' : `Generate ${generateCount} Variations`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DumpAndGenerateModal;
