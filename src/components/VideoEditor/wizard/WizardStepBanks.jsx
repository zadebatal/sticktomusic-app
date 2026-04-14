/**
 * WizardStepBanks — Step 3: Per-niche bank population (images, text, captions, hashtags).
 * Each slideshow niche shows slide bank columns (images + text) plus caption & hashtag banks.
 * Video niches show media upload grid + text banks.
 */

import {
  FeatherCamera,
  FeatherCheck,
  FeatherChevronDown,
  FeatherChevronUp,
  FeatherDownloadCloud,
  FeatherEdit2,
  FeatherFilm,
  FeatherImage,
  FeatherLayers,
  FeatherMusic,
  FeatherPlay,
  FeatherPlus,
  FeatherScissors,
  FeatherType,
  FeatherUpload,
  FeatherUploadCloud,
  FeatherX,
  FeatherZap,
} from '@subframe/core';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadFile } from '../../../services/firebaseStorage';
import {
  addToCollectionAsync,
  addToLibraryAsync,
  addToProjectPool,
  addToTextBank,
  assignToBank,
  getBankColor,
  getCollections,
  getLibrary,
  getPipelineBankLabel,
  getTextBankStyle,
  getTextBankText,
  MEDIA_TYPES,
  removeFromTextBank,
  subscribeToCollections,
  subscribeToLibrary,
  updateTextBankEntry,
} from '../../../services/libraryService';
import { THUMB_MAX_SIZE, THUMB_QUALITY, THUMB_VERSION } from '../../../services/thumbnailService';
import { Badge } from '../../../ui/components/Badge';
import { Button } from '../../../ui/components/Button';
import { IconButton } from '../../../ui/components/IconButton';
import { convertAudioIfNeeded } from '../../../utils/audioConverter';
import { convertImageIfNeeded } from '../../../utils/imageConverter';
import log from '../../../utils/logger';
import { runPool } from '../../../utils/uploadPool';
import { useToast } from '../../ui';
import CloudImportButton from '../CloudImportButton';
import WebImportModal from '../WebImportModal';
import CrossPollinationDrawer from './CrossPollinationDrawer';

// Bank header colors keyed by label
const BANK_HEADER_COLORS = {
  Hook: '#4f46e5',
  Lyrics: '#059669',
  Text: '#d97706',
  Image: '#4f46e5',
};
const getBankHeaderColor = (label, index) =>
  BANK_HEADER_COLORS[label] || getBankColor(index).primary;

const getBankIcon = (label) => {
  if (label.toLowerCase().includes('hook')) return <FeatherZap />;
  if (label.toLowerCase().includes('lyric')) return <FeatherMusic />;
  if (label.toLowerCase() === 'text') return <FeatherType />;
  return <FeatherImage />;
};

const getTextIconColor = (label) => {
  if (label.toLowerCase().includes('hook')) return '#818cf8';
  if (label.toLowerCase().includes('lyric')) return '#34d399';
  return '#fbbf24';
};

const FORMAT_ICONS = {
  montage: FeatherFilm,
  solo_clip: FeatherPlay,
  multi_clip: FeatherLayers,
  photo_montage: FeatherCamera,
  finished_media: FeatherUploadCloud,
  clipper: FeatherScissors,
};

const VIDEO_FORMAT_COLORS = {
  montage: '#6366f1',
  solo_clip: '#22c55e',
  multi_clip: '#f59e0b',
  photo_montage: '#a855f7',
  finished_media: '#06b6d4',
  clipper: '#f43f5e',
};

/** Natural sort for niche display — slideshows first sorted by slide count, then videos */
const naturalSortFormats = (formats) => {
  return [...formats].sort((a, b) => {
    // Slideshows first
    if (a.type === 'slideshow' && b.type !== 'slideshow') return -1;
    if (a.type !== 'slideshow' && b.type === 'slideshow') return 1;
    // Within same type, natural sort by name
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
};

const WizardStepBanks = ({
  db,
  artistId,
  projectId,
  nicheMap,
  selectedFormats,
  onComplete,
  onBack,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();

  const [collections, setCollections] = useState(() => (artistId ? getCollections(artistId) : []));
  const [library, setLibrary] = useState(() => (artistId ? getLibrary(artistId) : []));
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [textInputs, setTextInputs] = useState({}); // { `${nicheId}_${bankIdx}`: string }
  const [editingText, setEditingText] = useState(null); // { nicheId, bankIdx, entryIdx, text }
  const [dragOverTarget, setDragOverTarget] = useState(null); // `${nicheId}_${bankIdx}` or `${nicheId}_media`
  const [expandedNiches, setExpandedNiches] = useState(() => {
    const expanded = {};
    selectedFormats.forEach((fmt) => {
      expanded[fmt.id] = true;
    });
    return expanded;
  });
  const [showCrossPollinationFor, setShowCrossPollinationFor] = useState(null);
  const [showWebImport, setShowWebImport] = useState(null); // nicheId when open

  const fileInputRef = useRef(null);
  const pendingUploadNicheRef = useRef(null);
  const pendingUploadBankRef = useRef(null);
  const pendingUploadTypeRef = useRef('image'); // 'image' | 'video' | 'all'
  const handleUploadRef = useRef(null);

  // Subscribe to live data
  useEffect(() => {
    if (!artistId) return;
    setCollections(getCollections(artistId));
    setLibrary(getLibrary(artistId));
    const unsubs = [];
    if (db) {
      unsubs.push(subscribeToCollections(db, artistId, setCollections));
      unsubs.push(subscribeToLibrary(db, artistId, setLibrary));
    }
    return () => unsubs.forEach((u) => u && u());
  }, [db, artistId]);

  // Sort formats naturally
  const sortedFormats = useMemo(() => naturalSortFormats(selectedFormats), [selectedFormats]);

  // Get niche data
  const getNiche = useCallback(
    (fmtId) => {
      const nicheId = nicheMap[fmtId];
      return collections.find((c) => c.id === nicheId) || null;
    },
    [collections, nicheMap],
  );

  // Upload handler — supports images AND video files
  const handleUpload = useCallback(
    async (files) => {
      const nicheId = pendingUploadNicheRef.current;
      const bankIdx = pendingUploadBankRef.current;
      if (!files?.length || !nicheId) {
        toastError('No files selected');
        return;
      }

      setIsUploading(true);
      setUploadProgress({ current: 0, total: files.length });

      const processOne = async (rawFile) => {
        let file = rawFile;
        const isVideo = rawFile.type?.startsWith('video');
        const isAudio = rawFile.type?.startsWith('audio');

        if (rawFile.type?.startsWith('image')) file = await convertImageIfNeeded(rawFile);
        else if (isAudio) file = await convertAudioIfNeeded(rawFile);

        const folder = isVideo ? 'videos' : isAudio ? 'audio' : 'images';
        const { url, path } = await uploadFile(file, folder);

        let thumbnailUrl = null;
        if (!isVideo && !isAudio) {
          try {
            const img = new Image();
            img.src = URL.createObjectURL(file);
            await new Promise((r) => {
              img.onload = r;
            });
            const scale = Math.min(
              1,
              THUMB_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight),
            );
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', THUMB_QUALITY));
            if (blob) {
              const tf = new File([blob], `thumb_${file.name}`, { type: 'image/jpeg' });
              const tr = await uploadFile(tf, 'thumbnails');
              thumbnailUrl = tr.url;
            }
            URL.revokeObjectURL(img.src);
          } catch (e) {
            /* skip thumb */
          }
        }

        const mediaType = isVideo
          ? MEDIA_TYPES.VIDEO
          : isAudio
            ? MEDIA_TYPES.AUDIO
            : MEDIA_TYPES.IMAGE;
        const item = {
          type: mediaType,
          name: file.name,
          url,
          thumbnailUrl,
          thumbVersion: thumbnailUrl ? THUMB_VERSION : undefined,
          storagePath: path,
          collectionIds: [nicheId],
          metadata: { fileSize: file.size, mimeType: file.type },
        };

        const savedItem = await addToLibraryAsync(db, artistId, item);
        await addToCollectionAsync(db, artistId, nicheId, savedItem.id);
        addToProjectPool(artistId, projectId, [savedItem.id], db);
        return savedItem;
      };

      try {
        const { results, errors } = await runPool(Array.from(files), processOne, {
          concurrency: 5,
          onProgress: (done, total) => setUploadProgress({ current: done, total }),
        });
        const uploadedItems = results.filter(Boolean);
        if (uploadedItems.length > 0) {
          if (bankIdx != null) {
            uploadedItems.forEach((item) => assignToBank(artistId, nicheId, item.id, bankIdx, db));
          }
          setLibrary(getLibrary(artistId));
          setCollections(getCollections(artistId));
          toastSuccess(
            `${uploadedItems.length} file${uploadedItems.length > 1 ? 's' : ''} uploaded`,
          );
        } else if (errors.length > 0) {
          toastError(`Upload failed: ${errors[0].error?.message || 'unknown error'}`);
        }
      } catch (err) {
        toastError(`Upload error: ${err.message}`);
      }
      setIsUploading(false);
      setUploadProgress(null);
      pendingUploadNicheRef.current = null;
      pendingUploadBankRef.current = null;
    },
    [db, artistId, projectId, toastSuccess, toastError],
  );

  handleUploadRef.current = handleUpload;

  const setFileInputRef = useCallback((el) => {
    fileInputRef.current = el;
    if (el && !el._hasNativeListener) {
      el._hasNativeListener = true;
      el.addEventListener('change', () => {
        if (el.files?.length && handleUploadRef.current) {
          handleUploadRef.current(el.files);
        }
      });
    }
  }, []);

  const triggerUpload = useCallback((nicheId, bankIdx, acceptType = 'image') => {
    pendingUploadNicheRef.current = nicheId;
    pendingUploadBankRef.current = bankIdx;
    pendingUploadTypeRef.current = acceptType;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      const acceptMap = {
        image: 'image/*,.heic,.heif,.tif,.tiff,.dng',
        video: 'video/*',
        all: 'image/*,video/*,audio/*,.heic,.heif,.tif,.tiff,.dng',
      };
      fileInputRef.current.accept = acceptMap[acceptType] || acceptMap.all;
      fileInputRef.current.click();
    }
  }, []);

  // Drag & drop from Finder
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e, nicheId, bankIdx) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    const droppedFiles = Array.from(e.dataTransfer?.files || []);
    if (droppedFiles.length === 0) return;
    pendingUploadNicheRef.current = nicheId;
    pendingUploadBankRef.current = bankIdx ?? null;
    handleUploadRef.current?.(droppedFiles);
  }, []);

  const handleDragEnter = useCallback((targetKey) => {
    setDragOverTarget(targetKey);
  }, []);

  const handleDragLeave = useCallback((e) => {
    // Only clear if leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverTarget(null);
    }
  }, []);

  // Text bank handlers
  const handleAddText = useCallback(
    (nicheId, bankIdx) => {
      const key = `${nicheId}_${bankIdx}`;
      const text = (textInputs[key] || '').trim();
      if (!text) return;
      addToTextBank(artistId, nicheId, bankIdx, text, db);
      setTextInputs((prev) => ({ ...prev, [key]: '' }));
      setCollections(getCollections(artistId));
    },
    [artistId, db, textInputs],
  );

  const handleRemoveText = useCallback(
    (nicheId, bankIdx, entryIdx) => {
      removeFromTextBank(artistId, nicheId, bankIdx, entryIdx, db);
      setCollections(getCollections(artistId));
    },
    [artistId, db],
  );

  // Edit text entry inline
  const handleStartEditText = useCallback((nicheId, bankIdx, entryIdx, currentText) => {
    setEditingText({ nicheId, bankIdx, entryIdx, text: currentText });
  }, []);

  const handleSaveEditText = useCallback(() => {
    if (!editingText) return;
    const { nicheId, bankIdx, entryIdx, text } = editingText;
    if (text.trim()) {
      updateTextBankEntry(artistId, nicheId, bankIdx, entryIdx, text.trim(), db);
      setCollections(getCollections(artistId));
    }
    setEditingText(null);
  }, [editingText, artistId, db]);

  const handleCancelEditText = useCallback(() => {
    setEditingText(null);
  }, []);

  // Web import completion handler
  const handleWebImportComplete = useCallback(
    async (files, bankIdx) => {
      const nicheId = showWebImport;
      log(
        `[WizardBanks] Web import complete: ${files?.length || 0} files, nicheId=${nicheId}, bankIdx=${bankIdx}`,
      );
      if (!nicheId || !files?.length) {
        log.warn(`[WizardBanks] Import skipped — nicheId=${nicheId}, files=${files?.length}`);
        setShowWebImport(null);
        return;
      }

      let imported = 0;
      for (const file of files) {
        try {
          const item = {
            type: file.type || 'video',
            name: file.name,
            url: file.url || file.localUrl,
            thumbnailUrl: file.thumbnailUrl || null,
            storagePath: file.storagePath || null,
            localPath: file.path || null,
            collectionIds: [nicheId],
            metadata: { fileSize: file.size, source: 'web-import' },
          };
          const savedItem = await addToLibraryAsync(db, artistId, item);
          await addToCollectionAsync(db, artistId, nicheId, savedItem.id);
          addToProjectPool(artistId, projectId, [savedItem.id], db);
          if (bankIdx != null) {
            assignToBank(artistId, nicheId, savedItem.id, bankIdx, db);
          }
          imported++;
        } catch (err) {
          log.warn(`[WizardBanks] Web import item failed: ${err.message}`);
        }
      }

      if (imported > 0) {
        setLibrary(getLibrary(artistId));
        setCollections(getCollections(artistId));
        toastSuccess(`${imported} file${imported > 1 ? 's' : ''} imported from web`);
      }
      setShowWebImport(null);
    },
    [showWebImport, db, artistId, projectId, toastSuccess],
  );

  // Cloud import completion handler
  const handleCloudImportComplete = useCallback(
    async (imported, nicheId) => {
      if (!imported?.length || !nicheId) return;
      for (const file of imported) {
        try {
          const item = {
            type: file.type || 'image',
            name: file.name,
            url: file.url || file.localUrl,
            collectionIds: [nicheId],
            metadata: { source: file.source || 'cloud-import' },
          };
          const savedItem = await addToLibraryAsync(db, artistId, item);
          await addToCollectionAsync(db, artistId, nicheId, savedItem.id);
          addToProjectPool(artistId, projectId, [savedItem.id], db);
        } catch (err) {
          log.warn(`[WizardBanks] Cloud import item failed: ${err.message}`);
        }
      }
      setLibrary(getLibrary(artistId));
      setCollections(getCollections(artistId));
      toastSuccess(`${imported.length} file${imported.length > 1 ? 's' : ''} imported`);
    },
    [db, artistId, projectId, toastSuccess],
  );

  const toggleNicheExpanded = useCallback((fmtId) => {
    setExpandedNiches((prev) => ({ ...prev, [fmtId]: !prev[fmtId] }));
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Populate your banks</span>
        <span className="text-body font-body text-neutral-400">
          Add media, text lines, captions and hashtags to each niche — or skip and do it later
        </span>
      </div>

      {/* Upload progress */}
      {isUploading && uploadProgress && (
        <div className="flex items-center gap-3 w-full max-w-4xl rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
          <FeatherUpload
            className="text-indigo-400 animate-pulse"
            style={{ width: 16, height: 16 }}
          />
          <span className="text-caption font-caption text-indigo-300">
            Uploading {uploadProgress.current}/{uploadProgress.total}...
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{
                width: `${uploadProgress.total > 0 ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={setFileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.heic,.heif,.tif,.tiff,.dng"
        className="hidden"
      />

      {/* Per-niche sections — NATURAL SORTED */}
      <div className="flex flex-col gap-4 w-full max-w-4xl">
        {sortedFormats.map((fmt) => {
          const nicheId = nicheMap[fmt.id];
          const niche = getNiche(fmt.id);
          const isSlideshow = fmt.type === 'slideshow';
          const slideCount = fmt.slideCount || 0;
          const isExpanded = expandedNiches[fmt.id];
          const IconComp = FORMAT_ICONS[fmt.id] || FeatherImage;
          const fmtColor = VIDEO_FORMAT_COLORS[fmt.id] || '#6366f1';

          // Get niche media for video formats
          const nicheMediaIds = niche?.mediaIds || [];
          const nicheMedia = nicheMediaIds
            .map((id) => library.find((m) => m.id === id))
            .filter(Boolean);
          const nicheVideos = nicheMedia.filter((m) => m.type === 'video');
          const nicheImages = nicheMedia.filter((m) => m.type === 'image');
          const nicheAudio = nicheMedia.filter((m) => m.type === 'audio');

          return (
            <div
              key={fmt.id}
              className="flex flex-col rounded-lg border border-solid border-neutral-200 bg-[#111111] overflow-hidden"
            >
              {/* Section header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-neutral-50/50 transition-colors"
                onClick={() => toggleNicheExpanded(fmt.id)}
              >
                <div className="flex items-center gap-3">
                  {isSlideshow ? (
                    <div className="flex items-center gap-1">
                      {fmt.slideLabels.map((label, i) => (
                        <div
                          key={i}
                          className="h-6 w-4 rounded"
                          style={{
                            backgroundColor:
                              ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5] + '33',
                            border: `1px solid ${['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#f43f5e'][i % 5]}55`,
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className="flex items-center justify-center rounded-md"
                      style={{
                        width: 28,
                        height: 28,
                        backgroundColor: fmtColor + '22',
                        border: `1px solid ${fmtColor}44`,
                      }}
                    >
                      <IconComp style={{ width: 14, height: 14, color: fmtColor }} />
                    </div>
                  )}
                  <span className="text-body-bold font-body-bold text-[#ffffffff]">{fmt.name}</span>
                  <Badge variant="neutral">
                    {isSlideshow
                      ? `${slideCount} slide${slideCount !== 1 ? 's' : ''}`
                      : fmt.description || 'Video'}
                  </Badge>
                  {!isSlideshow && nicheMediaIds.length > 0 && (
                    <Badge variant="brand">
                      {nicheMediaIds.length} file{nicheMediaIds.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                {isExpanded ? (
                  <FeatherChevronUp
                    className="text-neutral-400"
                    style={{ width: 16, height: 16 }}
                  />
                ) : (
                  <FeatherChevronDown
                    className="text-neutral-400"
                    style={{ width: 16, height: 16 }}
                  />
                )}
              </div>

              {isExpanded && (
                <div className="flex flex-col gap-4 px-4 pb-4">
                  {/* Slide banks (slideshow only) */}
                  {isSlideshow && slideCount > 0 && (
                    <div className="flex gap-3 overflow-x-auto">
                      {Array.from({ length: slideCount }).map((_, bankIdx) => {
                        const label = niche
                          ? getPipelineBankLabel(niche, bankIdx)
                          : fmt.slideLabels[bankIdx] || `Slide ${bankIdx + 1}`;
                        const headerColor = getBankHeaderColor(label, bankIdx);
                        const bankImages = (niche?.banks?.[bankIdx] || [])
                          .map((id) => library.find((m) => m.id === id))
                          .filter(Boolean);
                        const textEntries = niche?.textBanks?.[bankIdx] || [];
                        const textKey = `${nicheId}_${bankIdx}`;
                        const dropKey = `${nicheId}_${bankIdx}`;

                        return (
                          <div key={bankIdx} className="flex flex-col gap-2 flex-1 min-w-[160px]">
                            {/* Column header */}
                            <div
                              className="flex w-full items-center justify-between rounded-t-lg px-3 py-2"
                              style={{ backgroundColor: headerColor }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-caption-bold font-caption-bold text-[#ffffffff]">
                                  {label}
                                </span>
                              </div>
                              <Badge variant="neutral">{bankImages.length}</Badge>
                            </div>

                            {/* Images section — with drag & drop */}
                            <div
                              className={`flex w-full flex-col items-start gap-2 rounded-b-lg border border-solid px-3 py-3 min-h-[120px] transition-colors ${
                                dragOverTarget === dropKey
                                  ? 'border-indigo-500 bg-indigo-500/10'
                                  : 'border-neutral-200 bg-[#1a1a1aff]'
                              }`}
                              onDragOver={handleDragOver}
                              onDrop={(e) => handleDrop(e, nicheId, bankIdx)}
                              onDragEnter={() => handleDragEnter(dropKey)}
                              onDragLeave={handleDragLeave}
                            >
                              <div className="flex w-full items-center justify-between">
                                <span className="text-caption font-caption text-neutral-400">
                                  Images
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                                    onClick={() => triggerUpload(nicheId, bankIdx, 'image')}
                                    disabled={isUploading}
                                  >
                                    Upload
                                  </button>
                                  <button
                                    className="text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer px-1 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                                    onClick={() => setShowWebImport(nicheId)}
                                  >
                                    Web
                                  </button>
                                </div>
                              </div>
                              <div className="w-full items-start gap-1.5 grid grid-cols-3">
                                {bankImages.map((item) => (
                                  <img
                                    key={item.id}
                                    className="flex-none rounded-sm border-b-2 border-solid aspect-square object-cover w-full"
                                    style={{ borderBottomColor: headerColor }}
                                    src={item.thumbnailUrl || item.url}
                                    alt={item.name}
                                    loading="lazy"
                                  />
                                ))}
                                <div
                                  className="flex flex-col items-center justify-center rounded-sm border-2 border-dashed border-neutral-200 aspect-square cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/5 transition-colors"
                                  onClick={() => triggerUpload(nicheId, bankIdx, 'image')}
                                  title="Upload images"
                                >
                                  <FeatherPlus
                                    className="text-neutral-500"
                                    style={{ width: 12, height: 12 }}
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Text bank section */}
                            <div className="flex w-full flex-col items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-[#1a1a1aff] px-3 py-3 min-h-[100px]">
                              <div className="flex w-full items-center justify-between">
                                <span className="text-caption font-caption text-neutral-400">
                                  {label} Lines
                                </span>
                              </div>
                              <div className="flex w-full flex-col items-start gap-1.5 max-h-32 overflow-y-auto">
                                {textEntries.map((entry, entryIdx) => {
                                  const text = getTextBankText(entry);
                                  const style = getTextBankStyle(entry);
                                  const isEditing =
                                    editingText?.nicheId === nicheId &&
                                    editingText?.bankIdx === bankIdx &&
                                    editingText?.entryIdx === entryIdx;
                                  return (
                                    <div
                                      key={entryIdx}
                                      className="flex w-full items-center gap-2 rounded-md bg-black px-2 py-1.5 flex-none"
                                    >
                                      <FeatherType
                                        className="flex-none"
                                        style={{
                                          color: style?.color || getTextIconColor(label),
                                          width: 12,
                                          height: 12,
                                        }}
                                      />
                                      {isEditing ? (
                                        <input
                                          className="grow bg-transparent text-caption font-caption text-white outline-none border-b border-indigo-500"
                                          value={editingText.text}
                                          autoFocus
                                          onChange={(e) =>
                                            setEditingText((prev) => ({
                                              ...prev,
                                              text: e.target.value,
                                            }))
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveEditText();
                                            if (e.key === 'Escape') handleCancelEditText();
                                          }}
                                          onBlur={handleSaveEditText}
                                        />
                                      ) : (
                                        <span
                                          className="grow text-caption font-caption text-[#ffffffff] truncate cursor-pointer hover:text-indigo-300"
                                          onClick={() =>
                                            handleStartEditText(nicheId, bankIdx, entryIdx, text)
                                          }
                                          title="Click to edit"
                                        >
                                          {text}
                                        </span>
                                      )}
                                      {!isEditing && (
                                        <>
                                          <IconButton
                                            variant="neutral-tertiary"
                                            size="small"
                                            icon={<FeatherEdit2 />}
                                            aria-label="Edit text"
                                            onClick={() =>
                                              handleStartEditText(nicheId, bankIdx, entryIdx, text)
                                            }
                                          />
                                          <IconButton
                                            variant="neutral-tertiary"
                                            size="small"
                                            icon={<FeatherX />}
                                            aria-label="Remove text"
                                            onClick={() =>
                                              handleRemoveText(nicheId, bankIdx, entryIdx)
                                            }
                                          />
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex w-full items-center gap-2 rounded-md border border-solid border-neutral-200 bg-black px-2 py-1.5">
                                <input
                                  className="grow bg-transparent text-caption font-caption text-white outline-none placeholder-neutral-500"
                                  placeholder={`Add ${label.toLowerCase()} line...`}
                                  value={textInputs[textKey] || ''}
                                  onChange={(e) =>
                                    setTextInputs((prev) => ({
                                      ...prev,
                                      [textKey]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleAddText(nicheId, bankIdx);
                                  }}
                                  onBlur={() => {
                                    if ((textInputs[textKey] || '').trim())
                                      handleAddText(nicheId, bankIdx);
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Video niche media section */}
                  {!isSlideshow && (
                    <div className="flex flex-col gap-3">
                      {/* Upload area with drag & drop */}
                      <div
                        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-6 cursor-pointer transition-colors ${
                          dragOverTarget === `${nicheId}_media`
                            ? 'border-indigo-500 bg-indigo-500/10'
                            : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50/50'
                        }`}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, nicheId, null)}
                        onDragEnter={() => handleDragEnter(`${nicheId}_media`)}
                        onDragLeave={handleDragLeave}
                        onClick={() => triggerUpload(nicheId, null, 'all')}
                      >
                        <FeatherUpload
                          className="text-neutral-400 mb-2"
                          style={{ width: 20, height: 20 }}
                        />
                        <span className="text-caption font-caption text-neutral-400">
                          Drop videos, images, or audio here — or click to browse
                        </span>
                        {(nicheVideos.length > 0 ||
                          nicheImages.length > 0 ||
                          nicheAudio.length > 0) && (
                          <div className="flex items-center gap-2 mt-2">
                            {nicheVideos.length > 0 && (
                              <Badge variant="brand">
                                {nicheVideos.length} video{nicheVideos.length !== 1 ? 's' : ''}
                              </Badge>
                            )}
                            {nicheImages.length > 0 && (
                              <Badge variant="brand">
                                {nicheImages.length} image{nicheImages.length !== 1 ? 's' : ''}
                              </Badge>
                            )}
                            {nicheAudio.length > 0 && (
                              <Badge variant="brand">{nicheAudio.length} audio</Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Media grid — show uploaded items */}
                      {nicheMedia.length > 0 && (
                        <div className="grid grid-cols-6 gap-2">
                          {nicheMedia
                            .filter((m) => m.type !== 'audio')
                            .map((item) => (
                              <div
                                key={item.id}
                                className="relative aspect-square rounded-md overflow-hidden border border-neutral-200 bg-[#1a1a1aff]"
                              >
                                {item.type === 'video' ? (
                                  <div className="flex items-center justify-center h-full bg-neutral-100">
                                    <FeatherPlay
                                      className="text-neutral-400"
                                      style={{ width: 16, height: 16 }}
                                    />
                                  </div>
                                ) : (
                                  <img
                                    src={item.thumbnailUrl || item.url}
                                    alt={item.name}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                )}
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                                  <span className="text-[9px] text-neutral-300 truncate block">
                                    {item.name}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Audio items for video niches */}
                      {nicheAudio.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-caption font-caption text-neutral-400">Audio</span>
                          {nicheAudio.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 rounded-md bg-black px-3 py-2"
                            >
                              <FeatherMusic
                                className="text-indigo-400 flex-none"
                                style={{ width: 14, height: 14 }}
                              />
                              <span className="text-caption font-caption text-neutral-300 truncate">
                                {item.name}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Import sources */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="neutral-tertiary"
                      size="small"
                      icon={<FeatherDownloadCloud />}
                      onClick={() =>
                        setShowCrossPollinationFor(
                          showCrossPollinationFor === fmt.id ? null : fmt.id,
                        )
                      }
                    >
                      From Projects
                    </Button>
                    <Button
                      variant="neutral-tertiary"
                      size="small"
                      onClick={() => setShowWebImport(nicheId)}
                    >
                      From Web
                    </Button>
                    <CloudImportButton
                      artistId={artistId}
                      onImportMedia={(imported) => handleCloudImportComplete(imported, nicheId)}
                      mediaType={isSlideshow ? 'image' : 'all'}
                      db={db}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-3 w-full max-w-4xl sticky bottom-0 bg-black py-4">
        <Button variant="neutral-secondary" size="medium" onClick={onBack}>
          Back
        </Button>
        <Button variant="brand-primary" size="medium" className="flex-1" onClick={onComplete}>
          Create Project
        </Button>
      </div>

      {/* Web import modal */}
      {showWebImport && (
        <WebImportModal
          artistId={artistId}
          onComplete={handleWebImportComplete}
          onClose={() => setShowWebImport(null)}
        />
      )}

      {/* Cross-pollination drawer */}
      {showCrossPollinationFor && nicheMap[showCrossPollinationFor] && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setShowCrossPollinationFor(null)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-80 h-full bg-[#111111] border-l border-solid border-neutral-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <CrossPollinationDrawer
              db={db}
              artistId={artistId}
              projectId={projectId}
              targetNicheId={nicheMap[showCrossPollinationFor]}
              targetFormat={selectedFormats.find((f) => f.id === showCrossPollinationFor)}
              onClose={() => setShowCrossPollinationFor(null)}
              onImported={() => setCollections(getCollections(artistId))}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default WizardStepBanks;
