/**
 * PipelineWorkspace — 3-panel layout for pipeline content management
 * Left: Media Pool | Center: Labeled Slide Banks | Right: Preview + Generate
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  getLibrary,
  getCollections,
  getUserCollections,
  getCreatedContent,
  getPipelineById,
  getPipelineBankLabel,
  getPipelineAssetCounts,
  migrateCollectionBanks,
  assignToBank,
  removeFromBank,
  addToTextBank,
  removeFromTextBank,
  saveCollections,
  saveCollectionToFirestore,
  subscribeToCollections,
  subscribeToLibrary,
  subscribeToCreatedContent,
  addToCollectionAsync,
  getTextBankText,
  getTextBankStyle,
  getBankColor,
  MEDIA_TYPES,
} from '../../services/libraryService';
import { uploadFile } from '../../services/firebaseStorage';
import { convertImageIfNeeded } from '../../utils/imageConverter';
import { convertAudioIfNeeded } from '../../utils/audioConverter';
import { runPool } from '../../utils/uploadPool';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { TextField } from '../../ui/components/TextField';
import {
  FeatherUpload, FeatherCloud, FeatherPlus, FeatherX,
  FeatherType, FeatherPlay, FeatherRefreshCw, FeatherArrowRight,
  FeatherCalendar, FeatherArrowLeft, FeatherImage, FeatherMusic
} from '@subframe/core';
import { useToast } from '../ui';

// Bank header colors keyed by label
const BANK_HEADER_COLORS = {
  Hook: '#4f46e5',
  Lyrics: '#059669',
  Vibes: '#d97706',
  CTA: '#e11d48',
  Image: '#4f46e5',
};
const getBankHeaderColor = (label, index) =>
  BANK_HEADER_COLORS[label] || getBankColor(index).primary;

const PipelineWorkspace = ({
  db,
  artistId,
  pipelineId,
  onBack,
  onOpenEditor,
  onViewDrafts,
  onSchedule,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();

  // Data
  const [collections, setCollections] = useState([]);
  const [library, setLibrary] = useState([]);
  const [createdContent, setCreatedContent] = useState({ videos: [], slideshows: [] });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Text input per bank
  const [textInputs, setTextInputs] = useState({});

  // Preview
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [generateCount, setGenerateCount] = useState(10);

  // Drag state
  const [draggingMediaId, setDraggingMediaId] = useState(null);
  const [dragOverBank, setDragOverBank] = useState(null);

  // Load data
  useEffect(() => {
    if (!artistId) return;
    setCollections(getCollections(artistId));
    setLibrary(getLibrary(artistId));
    setCreatedContent(getCreatedContent(artistId));

    const unsubs = [];
    if (db) {
      unsubs.push(subscribeToCollections(db, artistId, setCollections));
      unsubs.push(subscribeToLibrary(db, artistId, setLibrary));
      unsubs.push(subscribeToCreatedContent(db, artistId, setCreatedContent));
    }
    return () => unsubs.forEach(u => u && u());
  }, [db, artistId]);

  // Current pipeline
  const pipeline = useMemo(() => {
    const p = collections.find(c => c.id === pipelineId && c.isPipeline);
    return p ? migrateCollectionBanks(p) : null;
  }, [collections, pipelineId]);

  const activeFormat = pipeline?.formats?.find(f => f.id === pipeline.activeFormatId) || pipeline?.formats?.[0];
  const slideCount = activeFormat?.slideCount || pipeline?.banks?.length || 2;

  // Pipeline media (images + audio in this pipeline's mediaIds)
  const pipelineMedia = useMemo(() => {
    if (!pipeline) return [];
    return library.filter(item => (pipeline.mediaIds || []).includes(item.id));
  }, [pipeline, library]);

  const pipelineImages = useMemo(() => pipelineMedia.filter(m => m.type === 'image'), [pipelineMedia]);
  const pipelineAudio = useMemo(() => pipelineMedia.filter(m => m.type === 'audio'), [pipelineMedia]);

  // Which bank an image is assigned to (first match)
  const getImageBankIndex = useCallback((mediaId) => {
    if (!pipeline?.banks) return -1;
    for (let i = 0; i < pipeline.banks.length; i++) {
      if (pipeline.banks[i]?.includes(mediaId)) return i;
    }
    return -1;
  }, [pipeline]);

  // Drafts for this pipeline
  const pipelineDrafts = useMemo(() =>
    (createdContent.slideshows || []).filter(s => s.collectionId === pipelineId && !s.isTemplate),
    [createdContent, pipelineId]
  );

  // Upload handler (images)
  const fileInputRef = useRef(null);
  const handleUpload = async (files) => {
    if (!files?.length || !artistId) return;
    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length });

    const processOne = async (rawFile) => {
      let file = rawFile;
      if (rawFile.type?.startsWith('image')) file = await convertImageIfNeeded(rawFile);
      else if (rawFile.type?.startsWith('audio')) file = await convertAudioIfNeeded(rawFile);

      const isAudio = file.type?.startsWith('audio');
      const folder = isAudio ? 'audio' : 'images';
      const { url, path } = await uploadFile(file, folder);

      // Thumbnail for images
      let thumbnailUrl = null;
      if (!isAudio) {
        try {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          await new Promise(r => { img.onload = r; });
          const maxS = 50;
          const scale = Math.min(1, maxS / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.2));
          if (blob) {
            const tf = new File([blob], `thumb_${file.name}`, { type: 'image/jpeg' });
            const tr = await uploadFile(tf, 'thumbnails');
            thumbnailUrl = tr.url;
          }
        } catch (e) { /* skip thumb */ }
      }

      const item = {
        type: isAudio ? MEDIA_TYPES.AUDIO : MEDIA_TYPES.IMAGE,
        name: file.name,
        url,
        thumbnailUrl,
        storagePath: path,
        collectionIds: [pipelineId],
        metadata: { fileSize: file.size, mimeType: file.type },
      };

      // Add to library + collection
      await addToCollectionAsync(db, artistId, pipelineId, null, item);
      return item;
    };

    try {
      await runPool(Array.from(files), processOne, 5, (done, total) => {
        setUploadProgress({ current: done, total });
      });
      toastSuccess(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
    } catch (err) {
      toastError('Upload failed');
    }
    setIsUploading(false);
    setUploadProgress(null);
  };

  // Drag & drop to assign to bank
  const handleDrop = useCallback((bankIndex, e) => {
    e.preventDefault();
    setDragOverBank(null);
    if (draggingMediaId) {
      assignToBank(artistId, pipelineId, draggingMediaId, bankIndex);
      if (db && pipeline) saveCollectionToFirestore(db, artistId, { ...pipeline, updatedAt: new Date().toISOString() });
      setDraggingMediaId(null);
    }
  }, [draggingMediaId, artistId, pipelineId, db, pipeline]);

  // Add text to bank
  const handleAddText = useCallback((bankIdx) => {
    const text = (textInputs[bankIdx] || '').trim();
    if (!text) return;
    addToTextBank(artistId, pipelineId, bankIdx, text);
    if (db && pipeline) saveCollectionToFirestore(db, artistId, { ...getUserCollections(artistId).find(c => c.id === pipelineId) });
    setTextInputs(prev => ({ ...prev, [bankIdx]: '' }));
  }, [textInputs, artistId, pipelineId, db, pipeline]);

  // Remove text from bank
  const handleRemoveText = useCallback((bankIdx, entryIdx) => {
    removeFromTextBank(artistId, pipelineId, bankIdx, entryIdx);
    if (db) {
      const updated = getUserCollections(artistId).find(c => c.id === pipelineId);
      if (updated) saveCollectionToFirestore(db, artistId, updated);
    }
  }, [artistId, pipelineId, db]);

  // Random preview image from banks
  const getPreviewImage = useCallback((slideIdx) => {
    if (!pipeline?.banks?.[slideIdx]?.length) return null;
    const ids = pipeline.banks[slideIdx];
    const randId = ids[Math.floor(Math.random() * ids.length)];
    const item = library.find(m => m.id === randId);
    return item?.url || item?.thumbnailUrl || null;
  }, [pipeline, library]);

  // Random preview text
  const getPreviewText = useCallback((slideIdx) => {
    const texts = pipeline?.textBanks?.[slideIdx] || [];
    if (!texts.length) return null;
    const entry = texts[Math.floor(Math.random() * texts.length)];
    return getTextBankText(entry);
  }, [pipeline]);

  const [previewKey, setPreviewKey] = useState(0);

  if (!pipeline) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-neutral-400">Pipeline not found</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-black">
      {/* Left — Media Pool */}
      <div className="flex w-60 flex-none flex-col border-r border-neutral-800 bg-black overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <IconButton variant="neutral-tertiary" size="small" icon={<FeatherArrowLeft />} onClick={onBack} />
            <span className="text-sm font-semibold text-white">Media Pool</span>
          </div>
          <Badge variant="neutral">{pipelineImages.length + pipelineAudio.length}</Badge>
        </div>

        {/* Upload buttons */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
          <Button
            className="h-auto flex-1"
            variant="neutral-secondary"
            size="small"
            icon={<FeatherUpload />}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,audio/*"
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
        </div>

        {/* Upload progress */}
        {isUploading && uploadProgress && (
          <div className="px-4 py-2 border-b border-neutral-800">
            <div className="h-1 w-full bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
              />
            </div>
            <span className="text-xs text-neutral-400 mt-1">{uploadProgress.current}/{uploadProgress.total}</span>
          </div>
        )}

        {/* Media grid */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            {pipelineImages.map(item => {
              const bankIdx = getImageBankIndex(item.id);
              const bankColor = bankIdx >= 0 ? getBankColor(bankIdx) : null;
              return (
                <div
                  key={item.id}
                  className="relative aspect-square cursor-grab"
                  draggable
                  onDragStart={() => setDraggingMediaId(item.id)}
                  onDragEnd={() => setDraggingMediaId(null)}
                >
                  <img
                    className="w-full h-full rounded-md border border-neutral-800 object-cover hover:border-neutral-600 transition"
                    src={item.thumbnailUrl || item.url}
                    alt={item.name}
                    loading="lazy"
                  />
                  {bankColor && (
                    <div
                      className="absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: bankColor.primary }}
                    />
                  )}
                </div>
              );
            })}
            {pipelineAudio.map(item => (
              <div key={item.id} className="relative aspect-square flex items-center justify-center rounded-md border border-neutral-800 bg-neutral-900">
                <FeatherMusic className="text-neutral-400" style={{ width: 16, height: 16 }} />
                <span className="absolute bottom-1 left-1 right-1 text-[9px] text-neutral-500 truncate">{item.name}</span>
              </div>
            ))}
          </div>
          {pipelineMedia.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8">
              <FeatherImage className="text-neutral-600" style={{ width: 24, height: 24 }} />
              <span className="text-xs text-neutral-500">Upload media to get started</span>
            </div>
          )}
        </div>
      </div>

      {/* Center — Slide Banks */}
      <div className="flex flex-1 flex-col overflow-hidden bg-black">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-lg font-semibold text-white">
              {pipeline.name} — {activeFormat?.name || 'Format'}
            </span>
            <Badge variant="brand">{slideCount}-Slide Format</Badge>
          </div>
        </div>

        {/* Bank columns */}
        <div className="flex flex-1 gap-6 px-6 py-6 overflow-x-auto">
          {Array.from({ length: slideCount }).map((_, bankIdx) => {
            const label = getPipelineBankLabel(pipeline, bankIdx);
            const headerColor = getBankHeaderColor(label, bankIdx);
            const bankImages = (pipeline.banks?.[bankIdx] || [])
              .map(id => library.find(m => m.id === id))
              .filter(Boolean);
            const textEntries = pipeline.textBanks?.[bankIdx] || [];
            const isDragOver = dragOverBank === bankIdx;

            return (
              <div key={bankIdx} className="flex min-w-[192px] max-w-[240px] flex-col gap-3 flex-shrink-0">
                {/* Column header */}
                <div
                  className="flex items-center justify-between rounded-t-lg px-4 py-3"
                  style={{ backgroundColor: headerColor }}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: `${headerColor}88`, filter: 'brightness(1.5)' }} />
                    <span className="text-sm font-semibold text-white">{label}</span>
                  </div>
                  <Badge variant="brand">{bankImages.length}</Badge>
                </div>

                {/* Images section */}
                <div
                  className={`flex flex-col gap-3 rounded-b-lg border bg-[#1a1a1a] px-4 py-4 transition-colors ${
                    isDragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-neutral-800'
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOverBank(bankIdx); }}
                  onDragLeave={() => setDragOverBank(null)}
                  onDrop={e => handleDrop(bankIdx, e)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Images</span>
                    <span className="text-xs text-neutral-400">{bankImages.length} assigned</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {bankImages.map(item => (
                      <img
                        key={item.id}
                        className="h-14 w-14 rounded-sm object-cover"
                        style={{ borderBottom: `2px solid ${headerColor}` }}
                        src={item.thumbnailUrl || item.url}
                        alt={item.name}
                        loading="lazy"
                      />
                    ))}
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-sm border-2 border-dashed border-neutral-700 cursor-pointer hover:border-neutral-500"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FeatherPlus className="text-neutral-500" style={{ width: 16, height: 16 }} />
                    </div>
                  </div>
                </div>

                {/* Text bank section */}
                <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-[#1a1a1a] px-4 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">{label} Lines</span>
                    <IconButton
                      variant="brand-tertiary"
                      size="small"
                      icon={<FeatherPlus />}
                      onClick={() => handleAddText(bankIdx)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    {textEntries.map((entry, entryIdx) => {
                      const text = getTextBankText(entry);
                      const style = getTextBankStyle(entry);
                      return (
                        <div key={entryIdx} className="flex items-center gap-2 rounded-md bg-black px-3 py-2">
                          <FeatherType style={{ width: 12, height: 12, color: style?.color || `${headerColor}88`, flexShrink: 0 }} />
                          <span className="flex-1 text-sm text-white truncate">{text}</span>
                          <IconButton
                            variant="neutral-tertiary"
                            size="small"
                            icon={<FeatherX />}
                            onClick={() => handleRemoveText(bankIdx, entryIdx)}
                          />
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-black px-3 py-2">
                      <input
                        className="flex-1 bg-transparent text-sm text-white outline-none placeholder-neutral-500"
                        placeholder={`Add ${label.toLowerCase()} line...`}
                        value={textInputs[bankIdx] || ''}
                        onChange={e => setTextInputs(prev => ({ ...prev, [bankIdx]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddText(bankIdx); }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right — Preview + Generate */}
      <div className="flex w-72 flex-none flex-col border-l border-neutral-800 bg-black overflow-y-auto">
        {/* Preview header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <span className="text-sm font-semibold text-white">Preview</span>
          <IconButton
            variant="neutral-tertiary"
            size="small"
            icon={<FeatherRefreshCw />}
            onClick={() => { setPreviewKey(k => k + 1); setPreviewSlideIdx(0); }}
          />
        </div>

        {/* Preview card */}
        <div className="flex flex-col items-center gap-3 px-4 py-4">
          <div className="flex w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-neutral-700 bg-black relative aspect-[9/16]">
            {getPreviewImage(previewSlideIdx) ? (
              <img
                key={previewKey}
                className="w-full h-full object-cover absolute"
                src={getPreviewImage(previewSlideIdx)}
                alt="Preview"
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FeatherImage className="text-neutral-600" style={{ width: 24, height: 24 }} />
                <span className="text-xs text-neutral-500">No images yet</span>
              </div>
            )}
            {getPreviewText(previewSlideIdx) && (
              <div className="flex flex-col items-center justify-center px-6 relative z-10">
                <span className="text-lg font-semibold text-white text-center drop-shadow-lg">
                  {getPreviewText(previewSlideIdx)}
                </span>
              </div>
            )}
          </div>
          {/* Slide dots */}
          <div className="flex items-center gap-2">
            {Array.from({ length: slideCount }).map((_, i) => (
              <div
                key={i}
                className="h-2 w-2 rounded-full cursor-pointer"
                style={{
                  backgroundColor: getBankHeaderColor(
                    getPipelineBankLabel(pipeline, i), i
                  ),
                  opacity: previewSlideIdx === i ? 1 : 0.3,
                }}
                onClick={() => setPreviewSlideIdx(i)}
              />
            ))}
          </div>
          <span className="text-xs text-neutral-400">
            Slide {previewSlideIdx + 1} of {slideCount}
          </span>
        </div>

        {/* Generate section */}
        <div className="flex flex-col gap-3 border-t border-neutral-800 px-4 py-4">
          <span className="text-sm font-semibold text-white">Generate</span>
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">Count</span>
            <input
              type="number"
              min={1}
              max={50}
              value={generateCount}
              onChange={e => setGenerateCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-14 rounded-md border border-neutral-800 bg-[#1a1a1a] px-2 py-1 text-center text-sm text-white outline-none"
            />
          </div>
          <Button
            className="h-auto w-full"
            variant="brand-primary"
            size="medium"
            icon={<FeatherPlay />}
            onClick={() => onOpenEditor && onOpenEditor(pipeline, generateCount)}
          >
            Generate {generateCount}
          </Button>
        </div>

        {/* Drafts section */}
        <div className="flex flex-col gap-3 border-t border-neutral-800 px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Drafts</span>
            <Badge variant="neutral">{pipelineDrafts.length}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {pipelineDrafts.slice(0, 4).map((draft, i) => {
              const thumb = draft.slides?.[0]?.backgroundImage || draft.slides?.[0]?.thumbnailUrl;
              return (
                <div
                  key={draft.id || i}
                  className="aspect-[9/16] rounded-md border border-neutral-800 bg-neutral-900 overflow-hidden cursor-pointer hover:border-neutral-600"
                  onClick={() => onOpenEditor && onOpenEditor(pipeline, null, draft)}
                >
                  {thumb ? (
                    <img className="w-full h-full object-cover" src={thumb} alt="" loading="lazy" />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full">
                      <FeatherImage className="text-neutral-700" style={{ width: 16, height: 16 }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {pipelineDrafts.length > 4 && (
            <Button
              className="h-auto w-full"
              variant="neutral-secondary"
              size="small"
              iconRight={<FeatherArrowRight />}
              onClick={() => onViewDrafts && onViewDrafts(pipeline)}
            >
              View All Drafts
            </Button>
          )}
        </div>

        {/* Schedule button */}
        {pipelineDrafts.length > 0 && (
          <div className="flex items-center justify-center border-t border-neutral-800 px-4 py-4">
            <Button
              variant="brand-primary"
              size="medium"
              icon={<FeatherCalendar />}
              onClick={() => onSchedule && onSchedule(pipeline)}
            >
              Send to Schedule
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineWorkspace;
