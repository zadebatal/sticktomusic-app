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
  addToLibraryAsync,
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
import { IconWithBackground } from '../../ui/components/IconWithBackground';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import {
  FeatherUpload, FeatherCloud, FeatherPlus, FeatherX,
  FeatherType, FeatherPlay, FeatherRefreshCw, FeatherArrowRight,
  FeatherArrowLeft, FeatherImage, FeatherMusic,
  FeatherCheck, FeatherLayers, FeatherZap,
  FeatherDatabase, FeatherMoreVertical, FeatherEdit, FeatherTrash2, FeatherSettings
} from '@subframe/core';
import * as SubframeCore from '@subframe/core';
import { useToast } from '../ui';
import { ConfirmDialog } from '../ui';

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
  onEditPipeline,
  onDeletePipeline,
  latePages = [],
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Data — initialize from localStorage to avoid flash of "Pipeline not found"
  const [collections, setCollections] = useState(() => artistId ? getCollections(artistId) : []);
  const [library, setLibrary] = useState(() => artistId ? getLibrary(artistId) : []);
  const [createdContent, setCreatedContent] = useState(() => artistId ? getCreatedContent(artistId) : { videos: [], slideshows: [] });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Text input per bank
  const [textInputs, setTextInputs] = useState({});

  // Import from library modal
  const [showImportModal, setShowImportModal] = useState(false);

  // Media pool filter
  const [mediaFilter, setMediaFilter] = useState('all'); // 'all' | 'unassigned' | 'audio'

  // Selected audio for generation
  const [selectedAudioId, setSelectedAudioId] = useState(null);

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
      unsubs.push(subscribeToCollections(db, artistId, (cols) => {
        setCollections(cols);
        setHasLoadedOnce(true);
      }));
      unsubs.push(subscribeToLibrary(db, artistId, setLibrary));
      unsubs.push(subscribeToCreatedContent(db, artistId, setCreatedContent));
    } else {
      setHasLoadedOnce(true);
    }
    return () => unsubs.forEach(u => u && u());
  }, [db, artistId]);

  // Current pipeline (accept both pipelines and legacy collections)
  const pipeline = useMemo(() => {
    const p = collections.find(c => c.id === pipelineId);
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

  // Filtered images based on media pool filter
  const filteredImages = useMemo(() => {
    if (mediaFilter === 'audio') return [];
    if (mediaFilter === 'unassigned') {
      return pipelineImages.filter(img => {
        if (!pipeline?.banks) return true;
        return !pipeline.banks.some(bank => bank?.includes(img.id));
      });
    }
    return pipelineImages;
  }, [pipelineImages, mediaFilter, pipeline]);

  // Selected audio item
  const selectedAudio = useMemo(
    () => pipelineAudio.find(a => a.id === selectedAudioId) || pipelineAudio[0] || null,
    [pipelineAudio, selectedAudioId]
  );

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
  const handleUploadRef = useRef(null);

  const handleUpload = async (files) => {
    if (!files?.length) { toastError('No files selected'); return; }
    if (!artistId) { toastError('No artist selected'); return; }
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

      // Step 1: Add to library (creates Firestore doc, triggers subscription)
      const savedItem = await addToLibraryAsync(db, artistId, item);
      // Step 2: Link to collection by ID
      await addToCollectionAsync(db, artistId, pipelineId, savedItem.id);
      return savedItem;
    };

    try {
      const { results, errors } = await runPool(Array.from(files), processOne, {
        concurrency: 5,
        onProgress: (done, total) => setUploadProgress({ current: done, total }),
      });
      // Directly update state with uploaded items (don't rely on subscription timing)
      const uploadedItems = results.filter(Boolean);
      if (errors.length > 0) {
        console.error('[PipelineWorkspace] Upload errors:', errors.map(e => e.error?.message));
      }
      if (uploadedItems.length > 0) {
        setLibrary(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const newItems = uploadedItems.filter(i => !existingIds.has(i.id));
          return newItems.length > 0 ? [...prev, ...newItems] : prev;
        });
        setCollections(getCollections(artistId));
        toastSuccess(`${uploadedItems.length} item${uploadedItems.length > 1 ? 's' : ''} uploaded to Media Pool`);
      } else if (errors.length > 0) {
        toastError(`Upload failed: ${errors[0].error?.message || 'unknown error'}`);
      } else {
        toastError('No files were processed');
      }
    } catch (err) {
      toastError(`Upload error: ${err.message}`);
    }
    setIsUploading(false);
    setUploadProgress(null);
  };

  // Keep handleUploadRef current so callback ref always calls latest version
  handleUploadRef.current = handleUpload;

  // Callback ref for file input — attaches native listener when element mounts
  // (useEffect([]) runs too early — input is inside conditional render)
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

  // Expose upload function on window for browser automation (e.g. OpenClaw)
  useEffect(() => {
    window.__pipelineUpload = (fileList) => {
      if (handleUploadRef.current) handleUploadRef.current(fileList);
    };
    return () => { delete window.__pipelineUpload; };
  }, []);

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

  // Lyrics textarea state
  const [lyricsText, setLyricsText] = useState('');

  // Library media NOT already in this pipeline (for import modal)
  const availableLibraryMedia = useMemo(() => {
    if (!pipeline) return [];
    const pipelineMediaIds = new Set(pipeline.mediaIds || []);
    return library.filter(item => !pipelineMediaIds.has(item.id));
  }, [library, pipeline]);

  // Import items from library into this pipeline
  const handleImportFromLibrary = useCallback((selectedIds) => {
    if (!selectedIds.length || !pipeline) return;
    const cols = getUserCollections(artistId);
    const idx = cols.findIndex(c => c.id === pipelineId);
    if (idx === -1) return;
    const existingIds = new Set(cols[idx].mediaIds || []);
    const newIds = selectedIds.filter(id => !existingIds.has(id));
    cols[idx] = { ...cols[idx], mediaIds: [...(cols[idx].mediaIds || []), ...newIds], updatedAt: new Date().toISOString() };
    saveCollections(artistId, cols);
    if (db) saveCollectionToFirestore(db, artistId, cols[idx]);
    setShowImportModal(false);
    toastSuccess(`Imported ${newIds.length} item${newIds.length !== 1 ? 's' : ''}`);
  }, [pipeline, artistId, pipelineId, db, toastSuccess]);

  // Load lyrics from text banks into textarea
  const handleLoadFromBanks = useCallback(() => {
    if (!pipeline?.textBanks) return;
    const allTexts = pipeline.textBanks
      .flatMap((bank, i) => (bank || []).map(entry => getTextBankText(entry)))
      .filter(Boolean);
    if (allTexts.length === 0) {
      toastError('No text entries in banks yet');
      return;
    }
    setLyricsText(allTexts.join('\n'));
    toastSuccess(`Loaded ${allTexts.length} text entries`);
  }, [pipeline, toastSuccess, toastError]);

  if (!pipeline) {
    return (
      <div className="flex h-full w-full items-center justify-center" data-testid="workspace-loading">
        <span className="text-neutral-400">
          {hasLoadedOnce ? 'Pipeline not found' : 'Loading workspace...'}
        </span>
      </div>
    );
  }

  // Get bank icon based on label
  const getBankIcon = (label) => {
    if (label.toLowerCase().includes('hook')) return <FeatherZap />;
    if (label.toLowerCase().includes('lyric')) return <FeatherMusic />;
    if (label.toLowerCase().includes('vibe')) return <FeatherImage />;
    return <FeatherZap />;
  };

  // Get bank badge variant based on label
  const getBankBadgeVariant = (label) => {
    if (label.toLowerCase().includes('hook')) return 'brand';
    if (label.toLowerCase().includes('lyric')) return 'success';
    if (label.toLowerCase().includes('vibe')) return 'warning';
    return 'brand';
  };

  // Get bank icon variant
  const getBankIconVariant = (label) => {
    if (label.toLowerCase().includes('hook')) return 'brand';
    if (label.toLowerCase().includes('lyric')) return 'success';
    if (label.toLowerCase().includes('vibe')) return 'warning';
    return 'brand';
  };

  // Text icon color based on label
  const getTextIconColor = (label) => {
    if (label.toLowerCase().includes('hook')) return '#818cf8';
    if (label.toLowerCase().includes('lyric')) return '#34d399';
    if (label.toLowerCase().includes('vibe')) return '#fbbf24';
    return '#818cf8';
  };

  return (
    <div className="flex h-full w-full flex-col items-start bg-black" data-testid="pipeline-workspace">
      {/* Top header bar */}
      <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 bg-black px-6 py-4">
        <div className="flex items-center gap-4">
          <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherArrowLeft />} onClick={onBack} />
          <div
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
            style={{ backgroundColor: pipeline.pipelineColor || '#4f46e5' }}
          >
            <span className="text-caption-bold font-caption-bold text-[#ffffffff]">
              {((pipeline.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || 'P').toUpperCase()}
            </span>
          </div>
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">{pipeline.name}</span>
            {pipeline.linkedPage && (
              <span className="text-caption font-caption text-neutral-400">
                @{pipeline.linkedPage.handle} · {pipeline.linkedPage.platform}
              </span>
            )}
          </div>
        </div>

        {/* Center — Format ToggleGroup */}
        {(pipeline.formats || []).length > 1 && (
          <ToggleGroup value={pipeline.activeFormatId || ''} onValueChange={(value) => {
            if (!value) return;
            const cols = getUserCollections(artistId);
            const idx = cols.findIndex(c => c.id === pipelineId);
            if (idx !== -1) {
              cols[idx] = { ...cols[idx], activeFormatId: value, updatedAt: new Date().toISOString() };
              saveCollections(artistId, cols);
              if (db) saveCollectionToFirestore(db, artistId, cols[idx]);
            }
          }}>
            {(pipeline.formats || []).map(fmt => (
              <ToggleGroup.Item key={fmt.id} icon={null} value={fmt.id}>
                {fmt.slideCount}-Slide: {fmt.name}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup>
        )}

        {/* Right — Actions + counts */}
        <div className="flex items-center gap-3">
          <Badge variant="brand" icon={<FeatherImage />}>{pipelineImages.length + pipelineAudio.length} Assets</Badge>
          <Badge variant="neutral" icon={<FeatherLayers />}>{pipelineDrafts.length} Draft{pipelineDrafts.length !== 1 ? 's' : ''}</Badge>
          {onSchedule && (
            <Button variant="neutral-secondary" size="small" onClick={onSchedule}>
              Schedule
            </Button>
          )}
          <SubframeCore.DropdownMenu.Root>
            <SubframeCore.DropdownMenu.Trigger asChild>
              <IconButton variant="neutral-tertiary" size="small" icon={<FeatherMoreVertical />} />
            </SubframeCore.DropdownMenu.Trigger>
            <SubframeCore.DropdownMenu.Portal>
              <SubframeCore.DropdownMenu.Content side="bottom" align="end" sideOffset={4} asChild>
                <DropdownMenu>
                  <DropdownMenu.DropdownItem icon={<FeatherEdit />} onClick={() => onEditPipeline?.(pipeline)}>
                    Edit Pipeline
                  </DropdownMenu.DropdownItem>
                  <DropdownMenu.DropdownItem icon={<FeatherTrash2 />} onClick={() => setShowDeleteConfirm(true)}>
                    Delete Pipeline
                  </DropdownMenu.DropdownItem>
                </DropdownMenu>
              </SubframeCore.DropdownMenu.Content>
            </SubframeCore.DropdownMenu.Portal>
          </SubframeCore.DropdownMenu.Root>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex items-start overflow-hidden flex-1 self-stretch">
        {/* Left — Media Pool */}
        <div className="flex w-64 flex-none flex-col items-start self-stretch border-r border-solid border-neutral-800 bg-black">
          <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 px-4 py-3">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Media Pool</span>
            <Badge variant="neutral">{pipelineImages.length + pipelineAudio.length}</Badge>
          </div>

          {/* Upload + Import buttons */}
          <div className="flex w-full flex-col gap-2 border-b border-solid border-neutral-800 px-4 py-2">
            <div className="flex w-full items-center gap-2">
            <Button
              className="h-auto grow shrink-0 basis-0"
              variant="neutral-secondary"
              size="small"
              icon={<FeatherUpload />}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload
            </Button>
            <Button
              className="h-auto grow shrink-0 basis-0"
              variant="neutral-secondary"
              size="small"
              icon={<FeatherCloud />}
              onClick={() => setShowImportModal(true)}
            >
              Import
            </Button>
            <input
              ref={setFileInputRef}
              type="file"
              multiple
              accept="image/*,audio/*"
              data-testid="media-upload-input"
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
              onChange={e => handleUpload(e.target.files)}
            />
            </div>
            <button
              data-testid="test-upload-btn"
              className="w-full rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
              onClick={() => {
                toastSuccess('Upload handler reachable!');
                // Create a tiny test PNG (1x1 pixel)
                const canvas = document.createElement('canvas');
                canvas.width = 1; canvas.height = 1;
                canvas.getContext('2d').fillRect(0, 0, 1, 1);
                canvas.toBlob((blob) => {
                  if (blob) {
                    const testFile = new File([blob], 'test-upload.png', { type: 'image/png' });
                    handleUpload([testFile]);
                  } else {
                    toastError('Failed to create test file');
                  }
                }, 'image/png');
              }}
            >
              Test Upload (1px image)
            </button>
          </div>

          {/* Filter tabs */}
          <div className="flex w-full items-center gap-4 px-4 py-2">
            {['all', 'unassigned', 'audio'].map(filter => (
              <div
                key={filter}
                className={`flex items-center gap-1 pb-1 cursor-pointer ${mediaFilter === filter ? 'border-b-2 border-solid border-[#6366f1ff]' : ''}`}
                onClick={() => setMediaFilter(filter)}
              >
                <span className={`text-caption font-caption ${mediaFilter === filter ? 'text-[#ffffffff]' : 'text-neutral-400'}`}>
                  {filter === 'all' ? 'All' : filter === 'unassigned' ? 'Unassigned' : 'Audio'}
                </span>
              </div>
            ))}
          </div>

          {/* Upload progress */}
          {isUploading && uploadProgress && (
            <div className="w-full px-4 py-2 border-b border-solid border-neutral-800">
              <div className="h-1 w-full bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500"
                  style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                />
              </div>
              <span className="text-caption font-caption text-neutral-400 mt-1">{uploadProgress.current}/{uploadProgress.total}</span>
            </div>
          )}

          {/* Image grid */}
          <div className="flex w-full grow shrink-0 basis-0 flex-col items-start gap-3 px-3 py-3 overflow-y-auto">
            {mediaFilter !== 'audio' && (
              <div className="w-full items-start gap-2 grid grid-cols-2">
                {filteredImages.map(item => {
                  const bankIdx = getImageBankIndex(item.id);
                  const bankColor = bankIdx >= 0 ? getBankColor(bankIdx) : null;
                  return (
                    <div
                      key={item.id}
                      className="flex items-start relative aspect-square"
                      draggable
                      onDragStart={() => setDraggingMediaId(item.id)}
                      onDragEnd={() => setDraggingMediaId(null)}
                    >
                      <img
                        className="flex-none self-stretch rounded-md border border-solid border-neutral-800 object-cover hover:border-neutral-600 hover:ring-1 hover:ring-indigo-500/50 transition cursor-grab"
                        src={item.thumbnailUrl || item.url}
                        alt={item.name}
                        loading="lazy"
                      />
                      {bankColor && (
                        <div
                          className="flex h-2 w-2 flex-none items-start rounded-full absolute bottom-1.5 right-1.5"
                          style={{ backgroundColor: bankColor.primary }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {filteredImages.length > 0 && mediaFilter !== 'audio' && (
              <div className="flex w-full items-center justify-center">
                <span className="text-caption font-caption text-neutral-400">
                  Drag images to slide banks →
                </span>
              </div>
            )}

            {pipelineMedia.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-8 w-full">
                <FeatherUpload className="text-neutral-500" style={{ width: 28, height: 28 }} />
                <span className="text-body-bold font-body-bold text-neutral-400">No media yet</span>
                <span className="text-caption font-caption text-neutral-500 text-center px-2">
                  Upload images and audio, or import from your library
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <Button variant="brand-secondary" size="small" icon={<FeatherUpload />} onClick={() => fileInputRef.current?.click()}>
                    Upload
                  </Button>
                  <Button variant="neutral-secondary" size="small" icon={<FeatherCloud />} onClick={() => setShowImportModal(true)}>
                    Import
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Audio section at bottom */}
          {pipelineAudio.length > 0 && (
            <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-4 py-3">
              <div className="flex w-full items-center justify-between">
                <span className="text-body-bold font-body-bold text-[#ffffffff]">Audio</span>
                <Badge variant="neutral">{pipelineAudio.length}</Badge>
              </div>
              <div className="flex w-full flex-col items-start gap-1.5">
                {pipelineAudio.map(audio => {
                  const isSelected = selectedAudio?.id === audio.id;
                  return (
                    <div
                      key={audio.id}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 cursor-pointer ${
                        isSelected ? 'border border-solid border-[#4f46e5ff] bg-[#4f46e5ff]' : 'bg-[#1a1a1aff]'
                      }`}
                      onClick={() => setSelectedAudioId(audio.id)}
                    >
                      <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-neutral-100">
                        <FeatherPlay className="text-caption font-caption text-black" />
                      </div>
                      <div className="flex grow shrink-0 basis-0 flex-col items-start">
                        <span className="w-full whitespace-nowrap text-caption-bold font-caption-bold text-[#ffffffff] truncate">
                          {audio.name}
                        </span>
                        <span className="text-caption font-caption text-neutral-400">
                          {audio.metadata?.duration ? `${Math.floor(audio.metadata.duration / 60)}:${String(Math.round(audio.metadata.duration % 60)).padStart(2, '0')}` : ''}
                        </span>
                      </div>
                      {isSelected && <FeatherCheck className="text-body font-body text-[#6366f1ff]" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Center — Slide Banks */}
        <div className="flex grow shrink-0 basis-0 items-start gap-6 self-stretch px-6 py-6 overflow-x-auto overflow-y-auto">
          {Array.from({ length: slideCount }).map((_, bankIdx) => {
            const label = getPipelineBankLabel(pipeline, bankIdx);
            const headerColor = getBankHeaderColor(label, bankIdx);
            const bankImages = (pipeline.banks?.[bankIdx] || [])
              .map(id => library.find(m => m.id === id))
              .filter(Boolean);
            const textEntries = pipeline.textBanks?.[bankIdx] || [];
            const isDragOver = dragOverBank === bankIdx;

            return (
              <div key={bankIdx} className={`flex flex-col items-start gap-3 flex-1 ${slideCount >= 5 ? 'min-w-[220px]' : slideCount >= 4 ? 'min-w-[248px]' : 'min-w-[288px]'}`}>
                {/* Column header with IconWithBackground */}
                <div
                  className="flex w-full items-center justify-between rounded-t-lg px-4 py-3"
                  style={{ backgroundColor: headerColor }}
                >
                  <div className="flex items-center gap-2">
                    <IconWithBackground
                      variant={getBankIconVariant(label)}
                      size="small"
                      icon={getBankIcon(label)}
                      square
                    />
                    <span className="text-body-bold font-body-bold text-[#ffffffff]">
                      Slide {bankIdx + 1}: {label}
                    </span>
                  </div>
                  <Badge variant={getBankBadgeVariant(label)}>{bankImages.length}</Badge>
                </div>

                {/* Images section — 3-col grid */}
                <div
                  className={`flex w-full flex-col items-start gap-3 rounded-b-lg border bg-[#1a1a1aff] px-4 py-4 transition-colors ${
                    isDragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-solid border-neutral-800'
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOverBank(bankIdx); }}
                  onDragLeave={() => setDragOverBank(null)}
                  onDrop={e => handleDrop(bankIdx, e)}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-caption font-caption text-neutral-400">Images</span>
                    <span className="text-caption font-caption text-neutral-400">{bankImages.length} assigned</span>
                  </div>
                  <div className="w-full items-start gap-2 grid grid-cols-3">
                    {bankImages.map(item => (
                      <img
                        key={item.id}
                        className="flex-none rounded-sm border-b-2 border-solid aspect-square object-cover"
                        style={{ borderBottomColor: headerColor }}
                        src={item.thumbnailUrl || item.url}
                        alt={item.name}
                        loading="lazy"
                      />
                    ))}
                    <div
                      className="flex grow shrink-0 basis-0 flex-col items-center justify-center rounded-sm border-2 border-dashed border-neutral-700 aspect-square cursor-pointer hover:border-neutral-500"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FeatherPlus className="text-body font-body text-neutral-500" />
                      <span className="text-caption font-caption text-neutral-500">Drop here</span>
                    </div>
                  </div>
                </div>

                {/* Text bank section */}
                <div className="flex w-full flex-col items-start gap-3 rounded-lg border border-solid border-neutral-800 bg-[#1a1a1aff] px-4 py-4">
                  <div className="flex w-full items-center justify-between">
                    <span className="text-caption font-caption text-neutral-400">{label} Lines</span>
                    <IconButton
                      variant="brand-tertiary"
                      size="small"
                      icon={<FeatherPlus />}
                      onClick={() => handleAddText(bankIdx)}
                    />
                  </div>
                  <div className="flex w-full flex-col items-start gap-2">
                    {textEntries.map((entry, entryIdx) => {
                      const text = getTextBankText(entry);
                      const style = getTextBankStyle(entry);
                      return (
                        <div key={entryIdx} className="flex w-full items-center gap-2 rounded-md bg-black px-3 py-2">
                          <FeatherType className="text-caption font-caption" style={{ color: style?.color || getTextIconColor(label) }} />
                          <span className="grow shrink-0 basis-0 text-body font-body text-[#ffffffff] truncate">{text}</span>
                          <IconButton
                            variant="neutral-tertiary"
                            size="small"
                            icon={<FeatherX />}
                            onClick={() => handleRemoveText(bankIdx, entryIdx)}
                          />
                        </div>
                      );
                    })}
                    <div className="flex w-full items-center gap-2 rounded-md border border-solid border-neutral-800 bg-black px-3 py-2">
                      <input
                        className="grow shrink-0 basis-0 bg-transparent text-body font-body text-white outline-none placeholder-neutral-500"
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

        {/* Right — Preview + Generate */}
        <div className="flex w-72 flex-none flex-col items-start self-stretch border-l border-solid border-neutral-800 bg-black overflow-y-auto">
          {/* Preview header */}
          <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 px-4 py-3">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Preview</span>
            <IconButton
              variant="neutral-tertiary"
              size="small"
              icon={<FeatherRefreshCw />}
              onClick={() => { setPreviewKey(k => k + 1); setPreviewSlideIdx(0); }}
            />
          </div>

          {/* Preview card */}
          <div className="flex w-full flex-col items-center gap-3 px-4 py-4">
            <div className="flex w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-solid border-neutral-700 bg-black relative aspect-[9/16]">
              {getPreviewImage(previewSlideIdx) ? (
                <img
                  key={previewKey}
                  className="w-full grow shrink-0 basis-0 object-cover absolute"
                  src={getPreviewImage(previewSlideIdx)}
                  alt="Preview"
                />
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <FeatherImage className="text-neutral-600" style={{ width: 24, height: 24 }} />
                  <span className="text-caption font-caption text-neutral-500">No images yet</span>
                </div>
              )}
              {getPreviewText(previewSlideIdx) && (
                <div className="flex flex-col items-center justify-center px-6 relative z-10">
                  <span className="text-heading-2 font-heading-2 text-[#ffffffff] text-center drop-shadow-lg">
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
                  className="flex h-2 w-2 flex-none items-start rounded-full cursor-pointer"
                  style={{
                    backgroundColor: getBankHeaderColor(getPipelineBankLabel(pipeline, i), i),
                    opacity: previewSlideIdx === i ? 1 : 0.3,
                  }}
                  onClick={() => setPreviewSlideIdx(i)}
                />
              ))}
            </div>
            <span className="text-caption font-caption text-neutral-400">
              Slide {previewSlideIdx + 1} of {slideCount}
            </span>
          </div>

          {/* Generate section */}
          <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-4 py-4">
            <span className="text-body-bold font-body-bold text-[#ffffffff]">Generate</span>
            <div className="flex w-full items-center justify-between">
              <span className="text-caption font-caption text-neutral-400">Count</span>
              <input
                type="number"
                min={1}
                max={50}
                value={generateCount}
                onChange={e => setGenerateCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-14 rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-2 py-1 text-center text-body font-body text-white outline-none"
              />
            </div>
            {/* Audio display */}
            <div className="flex w-full items-center justify-between">
              <span className="text-caption font-caption text-neutral-400">Audio</span>
              <div className="flex items-center gap-1.5">
                <FeatherMusic className="text-caption font-caption text-neutral-400" />
                <span className="text-caption font-caption text-[#ffffffff]">
                  {selectedAudio?.name || 'None selected'}
                </span>
              </div>
            </div>
            <Button
              className="h-auto w-full flex-none"
              variant="brand-primary"
              size="medium"
              icon={<FeatherPlay />}
              onClick={() => onOpenEditor && onOpenEditor(pipeline, generateCount)}
            >
              Generate {generateCount}
            </Button>
          </div>

          {/* View Drafts row */}
          <div className="flex w-full items-center justify-between border-t border-solid border-neutral-800 px-4 py-3">
            <span className="text-caption font-caption text-neutral-400">
              {pipelineDrafts.length} draft{pipelineDrafts.length !== 1 ? 's' : ''} created
            </span>
            <Button
              className="h-auto w-auto flex-none"
              variant="neutral-tertiary"
              size="small"
              iconRight={<FeatherArrowRight />}
              onClick={() => onViewDrafts && onViewDrafts(pipeline)}
            >
              View Drafts
            </Button>
          </div>

          {/* Lyrics section */}
          <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-4 py-3">
            <div className="flex w-full items-center justify-between">
              <span className="text-body-bold font-body-bold text-[#ffffffff]">Lyrics</span>
              <Badge variant="neutral">
                {(pipeline.textBanks || []).reduce((sum, bank) => sum + (bank?.length || 0), 0)} saved
              </Badge>
            </div>
            <textarea
              className="flex h-20 w-full flex-none items-start rounded-md border border-solid border-neutral-800 bg-black px-3 py-2 text-body font-body text-white outline-none placeholder-neutral-500 resize-none"
              placeholder="Paste lyrics..."
              value={lyricsText}
              onChange={e => setLyricsText(e.target.value)}
            />
            <Button
              className="h-auto w-full flex-none"
              variant="neutral-secondary"
              size="small"
              icon={<FeatherDatabase />}
              onClick={handleLoadFromBanks}
            >
              Load from Bank
            </Button>
          </div>
        </div>
      </div>

      {/* Import from Library Modal */}
      {showImportModal && (
        <ImportFromLibraryModal
          items={availableLibraryMedia}
          onImport={handleImportFromLibrary}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Delete Pipeline Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={`Delete "${pipeline?.name}"?`}
        message={`This will permanently delete this pipeline and all its bank assignments. ${pipelineDrafts.length} draft(s) created from this pipeline will NOT be deleted.`}
        confirmLabel="Delete Pipeline"
        confirmVariant="destructive"
        onConfirm={() => {
          setShowDeleteConfirm(false);
          onDeletePipeline?.(pipelineId);
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
};

// Mini modal for importing media from artist's library into this pipeline
const ImportFromLibraryModal = ({ items, onImport, onClose }) => {
  const [selected, setSelected] = useState(new Set());

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  };

  const images = items.filter(i => i.type === 'image');
  const audio = items.filter(i => i.type === 'audio');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-[#111111] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Import from Library</span>
            <span className="text-caption font-caption text-neutral-400">
              {items.length} item{items.length !== 1 ? 's' : ''} available
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="neutral-tertiary" size="small" onClick={selectAll}>
              {selected.size === items.length ? 'Deselect All' : 'Select All'}
            </Button>
            <IconButton variant="neutral-tertiary" size="medium" icon={<FeatherX />} onClick={onClose} />
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <FeatherImage className="text-neutral-500" style={{ width: 32, height: 32 }} />
              <span className="text-body font-body text-neutral-400">No additional media in your library</span>
              <span className="text-caption font-caption text-neutral-500">Upload media to your library first</span>
            </div>
          ) : (
            <>
              {/* Images grid */}
              {images.length > 0 && (
                <>
                  <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">
                    Images ({images.length})
                  </span>
                  <div className="grid grid-cols-5 gap-2 mb-6">
                    {images.map(item => (
                      <div
                        key={item.id}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                          selected.has(item.id) ? 'border-indigo-500' : 'border-transparent hover:border-neutral-600'
                        }`}
                        onClick={() => toggle(item.id)}
                      >
                        <img
                          src={item.thumbnailUrl || item.url}
                          alt={item.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        {selected.has(item.id) && (
                          <div className="absolute inset-0 bg-indigo-500/30 flex items-center justify-center">
                            <FeatherCheck className="text-white" style={{ width: 20, height: 20 }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Audio list */}
              {audio.length > 0 && (
                <>
                  <span className="text-body-bold font-body-bold text-neutral-300 mb-3 block">
                    Audio ({audio.length})
                  </span>
                  <div className="flex flex-col gap-1">
                    {audio.map(item => (
                      <div
                        key={item.id}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                          selected.has(item.id) ? 'bg-indigo-500/20 border border-indigo-500' : 'hover:bg-neutral-900 border border-transparent'
                        }`}
                        onClick={() => toggle(item.id)}
                      >
                        <FeatherMusic className="text-neutral-400 flex-shrink-0" style={{ width: 16, height: 16 }} />
                        <span className="text-body font-body text-[#ffffffff] truncate flex-1">{item.name}</span>
                        {selected.has(item.id) && <FeatherCheck className="text-indigo-400 flex-shrink-0" style={{ width: 16, height: 16 }} />}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-800 px-6 py-4">
          <Button variant="neutral-secondary" size="medium" onClick={onClose}>Cancel</Button>
          <Button
            variant="brand-primary"
            size="medium"
            disabled={selected.size === 0}
            onClick={() => onImport(Array.from(selected))}
          >
            Import {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PipelineWorkspace;
