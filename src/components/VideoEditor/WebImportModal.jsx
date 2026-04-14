/**
 * WebImportModal — Import media from web URLs (YouTube, TikTok, Pinterest, Instagram, Twitter/X).
 *
 * 4 states: Input → Analyzing → Preview → Importing
 * Preview shows a browsable selection grid for profiles/playlists/galleries.
 * Uses webImportService for all backend communication.
 */

import { FeatherAlertCircle, FeatherDownload, FeatherLink, FeatherX } from '@subframe/core';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getBankColor, getBankLabel } from '../../services/libraryService';
import {
  analyzeUrl,
  detectPlatform,
  downloadLocally,
  getLocalVideoInfo,
  isLocalDownloadAvailable,
  isLocalRipAvailable,
  isUrlSupported,
  pollUntilComplete,
  ripLocally,
  startDownload,
  startRip,
} from '../../services/webImportService';
import { Badge } from '../../ui/components/Badge';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import log from '../../utils/logger';

const STATES = {
  INPUT: 'input',
  ANALYZING: 'analyzing',
  PREVIEW: 'preview',
  IMPORTING: 'importing',
};

const PLATFORM_COLORS = {
  YouTube: '#ff0000',
  TikTok: '#000000',
  Pinterest: '#e60023',
  Instagram: '#e1306c',
  'Twitter/X': '#1da1f2',
};

const WebImportModal = ({
  onClose,
  onComplete,
  defaultBankIndex = 0,
  bankCount = 1,
  artistId,
  outputDir = null, // local disk path for downloaded files (Electron)
  mediaType = 'all', // 'image' | 'video' | 'all'
  audioOnly = false,
}) => {
  const [state, setState] = useState(STATES.INPUT);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [selectedBank, setSelectedBank] = useState(defaultBankIndex);
  const [maxItems, setMaxItems] = useState(30);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [ripMode, setRipMode] = useState(false);
  const [importProgress, setImportProgress] = useState({ status: '', progress: 0 });
  const inputRef = useRef(null);
  const abortRef = useRef(false);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Auto-select all items when metadata arrives with items
  useEffect(() => {
    if (metadata?.items?.length > 0) {
      setSelectedItems(new Set(metadata.items.map((item) => item.id)));
    }
  }, [metadata]);

  // Detect platform as user types
  const platform = detectPlatform(url);

  // Whether we have a browsable items grid
  const hasItems = metadata?.items?.length > 0;
  const isMultiItem = metadata?.type === 'playlist' || metadata?.type === 'gallery';
  const isVideo = metadata?.type === 'video' || metadata?.type === 'playlist';

  const handleAnalyze = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isUrlSupported(trimmed)) {
      setError('Unsupported URL. Supported: YouTube, TikTok, Pinterest, Instagram, Twitter/X');
      return;
    }

    setError(null);
    setState(STATES.ANALYZING);

    try {
      let data;
      // Desktop app: try local yt-dlp first for single videos (instant analysis)
      const canLocal = await isLocalDownloadAvailable();
      if (canLocal && !trimmed.match(/pinterest\.com|instagram\.com/i)) {
        try {
          data = await getLocalVideoInfo(trimmed);
          data._useLocal = true; // flag for import handler
        } catch {
          // Local failed, fall back to Railway
          data = await analyzeUrl(trimmed);
        }
      } else {
        data = await analyzeUrl(trimmed);
      }
      setMetadata(data);
      if (data.type === 'playlist') setMaxItems(10);
      else if (data.itemCount < 0) setMaxItems(50);
      setState(STATES.PREVIEW);
    } catch (err) {
      log.error('Analyze error:', err);
      setError(err.message);
      setState(STATES.INPUT);
    }
  }, [url]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') handleAnalyze();
    },
    [handleAnalyze],
  );

  const handleImport = useCallback(async () => {
    abortRef.current = false;
    setState(STATES.IMPORTING);
    setImportProgress({ status: 'Starting...', progress: 0 });

    try {
      // ── LOCAL PATHS (Desktop app — everything stays on disk) ──
      const canLocalRip = await isLocalRipAvailable();
      const canLocalDl = await isLocalDownloadAvailable();

      // LOCAL: Single video download (no rip, no profile items)
      if (canLocalDl && !ripMode && !hasItems) {
        setImportProgress({ status: 'Downloading to your drive...', progress: 0 });
        const files = await downloadLocally(url.trim(), { audioOnly, outputDir }, (prog) => {
          if (abortRef.current) return;
          setImportProgress({
            status: `Downloading... ${Math.round(prog.percent)}%`,
            progress: prog.percent,
          });
        });
        if (!abortRef.current) onComplete?.(files, selectedBank);
        return;
      }

      // LOCAL: Multiple videos from profile (download each via yt-dlp)
      if (canLocalDl && hasItems && selectedItems.size > 0 && !ripMode) {
        const selectedUrls = metadata.items
          .filter((item) => selectedItems.has(item.id))
          .map((item) => item.url)
          .filter(Boolean);

        const allFiles = [];
        for (let i = 0; i < selectedUrls.length; i++) {
          if (abortRef.current) break;
          setImportProgress({
            status: `Downloading ${i + 1} of ${selectedUrls.length} to your drive...`,
            progress: (i / selectedUrls.length) * 100,
          });
          try {
            const files = await downloadLocally(
              selectedUrls[i],
              { audioOnly, outputDir },
              (prog) => {
                if (abortRef.current) return;
                setImportProgress({
                  status: `Downloading ${i + 1} of ${selectedUrls.length}... ${Math.round(prog.percent)}%`,
                  progress: ((i + prog.percent / 100) / selectedUrls.length) * 100,
                });
              },
            );
            allFiles.push(...files);
          } catch (err) {
            log.warn(`[WebImport] Local download ${i + 1} failed: ${err.message}`);
          }
        }
        if (!abortRef.current) onComplete?.(allFiles, selectedBank);
        return;
      }

      // LOCAL: Rip mode — download + scene detect + split (all on disk via FFmpeg)
      if (canLocalRip && ripMode && hasItems && selectedItems.size > 0) {
        const selectedUrls = metadata.items
          .filter((item) => selectedItems.has(item.id))
          .map((item) => item.url)
          .filter(Boolean);

        setImportProgress({ status: 'Starting local rip...', progress: 0 });
        const clips = await ripLocally(selectedUrls, outputDir, { sceneThreshold: 0.5 }, (prog) => {
          if (abortRef.current) return;
          setImportProgress({
            status: prog.message || prog.phase || 'Processing...',
            progress: prog.percent || 0,
            stats: prog.totalClips ? { clips: prog.totalClips } : null,
          });
        });
        if (!abortRef.current) onComplete?.(clips, selectedBank);
        return;
      }

      // ── CLOUD FALLBACK (Railway — for web-only or when local tools unavailable) ──
      let selectedUrls = null;
      if (hasItems && selectedItems.size > 0) {
        selectedUrls = metadata.items
          .filter((item) => selectedItems.has(item.id))
          .map((item) => item.url)
          .filter(Boolean);
      }

      let jobId;
      if (ripMode && selectedUrls?.length > 0) {
        const result = await startRip(artistId, selectedUrls);
        jobId = result.jobId;
      } else {
        const result = await startDownload(
          url.trim(),
          artistId,
          !hasItems && isMultiItem ? maxItems : undefined,
          audioOnly,
          metadata?.type === 'playlist',
          selectedUrls,
        );
        jobId = result.jobId;
      }

      const files = await pollUntilComplete(jobId, (status) => {
        if (abortRef.current) return;
        const statusText = ripMode
          ? status.phase ||
            {
              pending: 'Waiting...',
              downloading: 'Downloading...',
              processing: 'Splitting clips...',
              uploading: `Uploading... ${status.progress}%`,
              complete: 'Complete!',
            }[status.status] ||
            status.status
          : {
              pending: 'Waiting...',
              downloading: 'Downloading...',
              uploading: `Uploading... ${status.progress}%`,
              complete: 'Complete!',
            }[status.status] || status.status;
        setImportProgress({
          status: statusText,
          progress: status.progress || 0,
          stats: status.stats || null,
        });
      });

      if (!abortRef.current) onComplete?.(files, selectedBank);
    } catch (err) {
      log.error('Import error:', err);
      setError(err.message);
      setState(STATES.PREVIEW);
    }
  }, [
    url,
    artistId,
    selectedBank,
    maxItems,
    audioOnly,
    metadata,
    hasItems,
    isMultiItem,
    selectedItems,
    ripMode,
    onComplete,
    outputDir,
  ]);

  const handleClose = useCallback(() => {
    abortRef.current = true;
    onClose?.();
  }, [onClose]);

  // Paste handler — auto-analyze if pasting a URL
  const handlePaste = useCallback((e) => {
    const pasted = e.clipboardData?.getData('text') || '';
    if (isUrlSupported(pasted.trim())) {
      setTimeout(() => {
        setUrl(pasted.trim());
        setError(null);
        setState(STATES.ANALYZING);
        analyzeUrl(pasted.trim())
          .then((data) => {
            setMetadata(data);
            setState(STATES.PREVIEW);
          })
          .catch((err) => {
            setError(err.message);
            setState(STATES.INPUT);
          });
      }, 0);
    }
  }, []);

  const toggleItem = useCallback((id) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (metadata?.items) setSelectedItems(new Set(metadata.items.map((i) => i.id)));
  }, [metadata]);

  const deselectAll = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  // Import button label
  const importLabel = (() => {
    if (audioOnly) return 'Extract Audio';
    if (ripMode && hasItems) return `Rip ${selectedItems.size} Montages`;
    if (metadata?.type === 'video') return 'Import Video';
    if (hasItems) {
      const count = selectedItems.size;
      const mediaWord = isVideo ? 'Video' : 'Image';
      return `Import ${count} ${mediaWord}${count !== 1 ? 's' : ''}`;
    }
    if (metadata?.type === 'playlist') return `Import ${maxItems} Videos`;
    if (isMultiItem) {
      const count =
        metadata.itemCount < 0 || metadata.itemCount > 10 ? maxItems : metadata.itemCount;
      return `Import ${count} Images`;
    }
    return 'Import';
  })();

  // Widen modal when showing selection grid
  const modalMaxWidth = state === STATES.PREVIEW && hasItems ? 'max-w-2xl' : 'max-w-lg';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal */}
      <div
        className={`relative z-10 flex w-full ${modalMaxWidth} flex-col rounded-xl border border-neutral-200 bg-[#111111] shadow-2xl transition-all`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <FeatherLink className="text-neutral-400" style={{ width: 18, height: 18 }} />
            <span className="text-body-bold font-body-bold text-[#ffffffff]">
              {audioOnly ? 'Import Audio from URL' : 'Import from Web'}
            </span>
          </div>
          <IconButton icon={<FeatherX />} size="small" onClick={handleClose} />
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-5">
          {/* STATE: INPUT */}
          {state === STATES.INPUT && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-caption font-caption text-neutral-400">Paste a URL</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="https://youtube.com/watch?v=..."
                    className="flex-1 rounded-lg border border-neutral-200 bg-[#1a1a1aff] px-3 py-2.5 text-body font-body text-[#ffffffff] placeholder-neutral-500 outline-none focus:border-indigo-500 transition-colors"
                  />
                  <Button
                    variant="brand-primary"
                    size="medium"
                    onClick={handleAnalyze}
                    disabled={!url.trim()}
                  >
                    Analyze
                  </Button>
                </div>
                {platform && (
                  <div className="flex items-center gap-1.5">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: PLATFORM_COLORS[platform.name] || '#6366f1' }}
                    />
                    <span className="text-caption font-caption text-neutral-400">
                      {platform.name}
                    </span>
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2.5">
                  <FeatherAlertCircle
                    className="mt-0.5 flex-none text-red-400"
                    style={{ width: 14, height: 14 }}
                  />
                  <span className="text-caption font-caption text-red-300">{error}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-caption font-caption text-neutral-500">Supported:</span>
                {['YouTube', 'TikTok', 'Pinterest', 'Instagram', 'Twitter/X'].map((name) => (
                  <Badge key={name} variant="neutral">
                    {name}
                  </Badge>
                ))}
              </div>
            </>
          )}

          {/* STATE: ANALYZING */}
          {state === STATES.ANALYZING && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              <span className="text-body font-body text-neutral-300">Analyzing URL...</span>
              {platform && <Badge>{platform.name}</Badge>}
            </div>
          )}

          {/* STATE: PREVIEW */}
          {state === STATES.PREVIEW && metadata && (
            <>
              {/* Media preview header */}
              <div className="flex items-start gap-4 rounded-lg border border-neutral-200 bg-[#1a1a1aff] p-4">
                {metadata.thumbnail ? (
                  <img
                    src={metadata.thumbnail}
                    alt={metadata.title}
                    className="h-16 w-24 flex-none rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-24 flex-none items-center justify-center rounded-md bg-neutral-100">
                    <FeatherLink className="text-neutral-500" style={{ width: 24, height: 24 }} />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-1.5">
                  <span className="text-body-bold font-body-bold text-[#ffffffff] line-clamp-2">
                    {metadata.title}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge
                      style={
                        PLATFORM_COLORS[metadata.platform]
                          ? {
                              backgroundColor: PLATFORM_COLORS[metadata.platform] + '22',
                              color: PLATFORM_COLORS[metadata.platform],
                              borderColor: PLATFORM_COLORS[metadata.platform] + '44',
                            }
                          : undefined
                      }
                    >
                      {metadata.platform}
                    </Badge>
                    <span className="text-caption font-caption text-neutral-400">
                      {metadata.type === 'video'
                        ? '1 video'
                        : metadata.type === 'playlist'
                          ? `${metadata.itemCount} video${metadata.itemCount !== 1 ? 's' : ''}`
                          : `${metadata.itemCount} image${metadata.itemCount !== 1 ? 's' : ''}`}
                    </span>
                    {metadata.duration && (
                      <span className="text-caption font-caption text-neutral-500">
                        {Math.floor(metadata.duration / 60)}:
                        {String(Math.floor(metadata.duration % 60)).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Audio note */}
              {audioOnly && (
                <div className="flex items-center gap-2 rounded-lg border border-indigo-900/40 bg-indigo-950/20 px-3 py-2">
                  <span className="text-caption font-caption text-indigo-300">
                    Audio will be extracted as MP3 from this video
                  </span>
                </div>
              )}

              {/* Selection grid — shown when items are available */}
              {hasItems && !audioOnly && (
                <>
                  {/* Select controls */}
                  <div className="flex items-center justify-between">
                    <span className="text-caption font-caption text-neutral-400">
                      {selectedItems.size} of {metadata.items.length} selected
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={selectAll}
                        className="text-caption font-caption text-indigo-400 hover:text-indigo-300 cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-neutral-600">|</span>
                      <button
                        onClick={deselectAll}
                        className="text-caption font-caption text-neutral-400 hover:text-neutral-300 cursor-pointer"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  {/* Thumbnail grid */}
                  <div
                    className={`grid gap-2 overflow-y-auto pr-1 ${isVideo ? 'grid-cols-3' : 'grid-cols-4'}`}
                    style={{ maxHeight: '320px' }}
                  >
                    {metadata.items.map((item) => {
                      const isSelected = selectedItems.has(item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => toggleItem(item.id)}
                          className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                            isSelected
                              ? 'border-indigo-500 ring-1 ring-indigo-500/40'
                              : 'border-transparent hover:border-neutral-600'
                          }`}
                        >
                          {/* Thumbnail */}
                          <div
                            className={`bg-neutral-100 ${isVideo ? 'aspect-video' : 'aspect-square'}`}
                          >
                            {item.thumbnail ? (
                              <img
                                src={item.thumbnail}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-600 text-lg">
                                {isVideo ? '🎬' : '🖼'}
                              </div>
                            )}
                          </div>

                          {/* Checkbox */}
                          <div
                            className={`absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold ${
                              isSelected
                                ? 'bg-indigo-500 text-white'
                                : 'bg-black/50 border border-white/30 text-transparent'
                            }`}
                          >
                            ✓
                          </div>

                          {/* Duration badge (videos only) */}
                          {item.duration && (
                            <div className="absolute bottom-8 right-1 bg-black/70 text-white text-[10px] px-1 py-0.5 rounded">
                              {Math.floor(item.duration / 60)}:
                              {String(Math.floor(item.duration % 60)).padStart(2, '0')}
                            </div>
                          )}

                          {/* Title */}
                          <div className="px-1.5 py-1">
                            <span className="text-[11px] text-neutral-400 line-clamp-1">
                              {item.title}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Rip Montages toggle — shown when importing multiple videos */}
              {hasItems && !audioOnly && isVideo && selectedItems.size > 1 && (
                <div
                  className="flex items-center justify-between rounded-lg border border-neutral-200 bg-[#1a1a1aff] px-4 py-3 cursor-pointer"
                  onClick={() => setRipMode(!ripMode)}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-caption-bold font-caption-bold text-[#ffffffff]">
                      Rip Montages
                    </span>
                    <span className="text-[11px] text-neutral-500">
                      Split videos into individual clips, remove duplicates, classify photos vs
                      video
                    </span>
                  </div>
                  <div
                    className={`w-10 h-5 rounded-full transition-colors flex items-center ${
                      ripMode ? 'bg-indigo-500 justify-end' : 'bg-neutral-200 justify-start'
                    }`}
                  >
                    <div className="w-4 h-4 rounded-full bg-white mx-0.5" />
                  </div>
                </div>
              )}

              {/* Fallback: count picker for items without metadata */}
              {!hasItems &&
                isMultiItem &&
                !audioOnly &&
                (metadata.itemCount > 10 || metadata.itemCount < 0) && (
                  <div className="flex flex-col gap-2">
                    <label className="text-caption font-caption text-neutral-400">
                      How many to import?
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(metadata.type === 'playlist'
                        ? [5, 10, 20, 50]
                        : metadata.itemCount < 0
                          ? [50, 100, 150]
                          : [10, 30, 50, 100]
                      ).map((cap) => (
                        <button
                          key={cap}
                          onClick={() => setMaxItems(cap)}
                          className={`rounded-lg border px-3 py-2 text-caption font-caption transition-colors cursor-pointer ${
                            maxItems === cap
                              ? 'border-indigo-500 bg-indigo-500/10 text-[#ffffffff]'
                              : 'border-neutral-200 bg-transparent text-neutral-400 hover:border-neutral-600'
                          }`}
                        >
                          {cap} {metadata.type === 'playlist' ? 'videos' : 'images'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {/* Bank selector */}
              {!audioOnly && bankCount > 1 && (
                <div className="flex flex-col gap-2">
                  <label className="text-caption font-caption text-neutral-400">
                    Add to slide bank
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: bankCount }, (_, i) => {
                      const color = getBankColor(i);
                      const label = getBankLabel(i);
                      const isSel = selectedBank === i;
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedBank(i)}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-caption font-caption transition-colors cursor-pointer ${
                            isSel
                              ? 'border-indigo-500 bg-indigo-500/10 text-[#ffffffff]'
                              : 'border-neutral-200 bg-transparent text-neutral-400 hover:border-neutral-600'
                          }`}
                        >
                          <div
                            className="h-2.5 w-2.5 rounded-full flex-none"
                            style={{ backgroundColor: color }}
                          />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2.5">
                  <FeatherAlertCircle
                    className="mt-0.5 flex-none text-red-400"
                    style={{ width: 14, height: 14 }}
                  />
                  <span className="text-caption font-caption text-red-300">{error}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="neutral-secondary"
                  size="medium"
                  onClick={() => {
                    setState(STATES.INPUT);
                    setMetadata(null);
                    setError(null);
                    setSelectedItems(new Set());
                  }}
                >
                  Back
                </Button>
                <Button
                  variant="brand-primary"
                  size="medium"
                  icon={<FeatherDownload />}
                  onClick={handleImport}
                  disabled={
                    hasItems
                      ? selectedItems.size === 0
                      : metadata.type !== 'video' && metadata.itemCount === 0
                  }
                >
                  {importLabel}
                </Button>
              </div>
            </>
          )}

          {/* STATE: IMPORTING */}
          {state === STATES.IMPORTING && (
            <div className="flex flex-col items-center gap-5 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-body-bold font-body-bold text-[#ffffffff]">
                  {importProgress.status}
                </span>
                {importProgress.progress > 0 && (
                  <div className="w-48 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{
                        width: `${importProgress.progress}%`,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                )}
                {importProgress.stats && (
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                    <span className="text-[11px] text-neutral-500">
                      {importProgress.stats.totalClips} clips found
                    </span>
                    <span className="text-[11px] text-neutral-500">·</span>
                    <span className="text-[11px] text-green-400">
                      {importProgress.stats.uniqueVideos} videos
                    </span>
                    <span className="text-[11px] text-indigo-400">
                      {importProgress.stats.uniquePhotos} photos
                    </span>
                    {importProgress.stats.duplicatesRemoved > 0 && (
                      <span className="text-[11px] text-neutral-500">
                        ({importProgress.stats.duplicatesRemoved} dupes removed)
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Button variant="neutral-tertiary" size="small" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WebImportModal;
