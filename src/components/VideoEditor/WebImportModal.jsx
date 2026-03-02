/**
 * WebImportModal — Import media from web URLs (YouTube, TikTok, Pinterest, Instagram, Twitter/X).
 *
 * 4 states: Input → Analyzing → Preview → Importing
 * Uses webImportService for all backend communication.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '../../ui/components/Button';
import { Badge } from '../../ui/components/Badge';
import { FeatherX, FeatherLink, FeatherDownload, FeatherAlertCircle } from '@subframe/core';
import { IconButton } from '../../ui/components/IconButton';
import {
  detectPlatform,
  isUrlSupported,
  analyzeUrl,
  startDownload,
  pollUntilComplete,
} from '../../services/webImportService';
import { getBankColor, getBankLabel } from '../../services/libraryService';
import log from '../../utils/logger';

const STATES = { INPUT: 'input', ANALYZING: 'analyzing', PREVIEW: 'preview', IMPORTING: 'importing' };

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
  mediaType = 'all', // 'image' | 'video' | 'all'
  audioOnly = false,
}) => {
  const [state, setState] = useState(STATES.INPUT);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [selectedBank, setSelectedBank] = useState(defaultBankIndex);
  const [maxItems, setMaxItems] = useState(30);
  const [importProgress, setImportProgress] = useState({ status: '', progress: 0 });
  const inputRef = useRef(null);
  const abortRef = useRef(false);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Detect platform as user types
  const platform = detectPlatform(url);

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
      const data = await analyzeUrl(trimmed);
      setMetadata(data);
      if (data.itemCount < 0) setMaxItems(50); // unknown count (e.g. Pinterest search)
      setState(STATES.PREVIEW);
    } catch (err) {
      log.error('Analyze error:', err);
      setError(err.message);
      setState(STATES.INPUT);
    }
  }, [url]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleAnalyze();
  }, [handleAnalyze]);

  const handleImport = useCallback(async () => {
    abortRef.current = false;
    setState(STATES.IMPORTING);
    setImportProgress({ status: 'Starting download...', progress: 0 });

    try {
      const { jobId } = await startDownload(url.trim(), artistId, metadata?.type === 'gallery' ? maxItems : undefined, audioOnly);

      const files = await pollUntilComplete(jobId, (status) => {
        if (abortRef.current) return;
        const statusText = {
          pending: 'Waiting to start...',
          downloading: audioOnly ? 'Extracting audio...' : 'Downloading media...',
          uploading: `Uploading to storage... ${status.progress}%`,
          complete: 'Complete!',
        }[status.status] || status.status;
        setImportProgress({ status: statusText, progress: status.progress || 0 });
      });

      if (!abortRef.current) {
        onComplete?.(files, selectedBank);
      }
    } catch (err) {
      log.error('Import error:', err);
      setError(err.message);
      setState(STATES.PREVIEW);
    }
  }, [url, artistId, selectedBank, onComplete]);

  const handleClose = useCallback(() => {
    abortRef.current = true;
    onClose?.();
  }, [onClose]);

  // Paste handler — auto-analyze if pasting a URL
  const handlePaste = useCallback((e) => {
    const pasted = e.clipboardData?.getData('text') || '';
    if (isUrlSupported(pasted.trim())) {
      // Let the paste complete, then auto-analyze
      setTimeout(() => {
        setUrl(pasted.trim());
        setError(null);
        setState(STATES.ANALYZING);
        analyzeUrl(pasted.trim())
          .then(data => { setMetadata(data); setState(STATES.PREVIEW); })
          .catch(err => { setError(err.message); setState(STATES.INPUT); });
      }, 0);
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal */}
      <div
        className="relative z-10 flex w-full max-w-lg flex-col rounded-xl border border-neutral-200 bg-[#111111] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <FeatherLink className="text-neutral-400" style={{ width: 18, height: 18 }} />
            <span className="text-body-bold font-body-bold text-[#ffffffff]">{audioOnly ? 'Import Audio from URL' : 'Import from Web'}</span>
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
                    onChange={e => { setUrl(e.target.value); setError(null); }}
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
                    <span className="text-caption font-caption text-neutral-400">{platform.name}</span>
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2.5">
                  <FeatherAlertCircle className="mt-0.5 flex-none text-red-400" style={{ width: 14, height: 14 }} />
                  <span className="text-caption font-caption text-red-300">{error}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-caption font-caption text-neutral-500">Supported:</span>
                {['YouTube', 'TikTok', 'Pinterest', 'Instagram', 'Twitter/X'].map(name => (
                  <Badge key={name} variant="neutral">{name}</Badge>
                ))}
              </div>
            </>
          )}

          {/* STATE: ANALYZING */}
          {state === STATES.ANALYZING && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              <span className="text-body font-body text-neutral-300">Analyzing URL...</span>
              {platform && (
                <Badge>{platform.name}</Badge>
              )}
            </div>
          )}

          {/* STATE: PREVIEW */}
          {state === STATES.PREVIEW && metadata && (
            <>
              {/* Media preview */}
              <div className="flex items-start gap-4 rounded-lg border border-neutral-200 bg-[#1a1a1aff] p-4">
                {metadata.thumbnail ? (
                  <img
                    src={metadata.thumbnail}
                    alt={metadata.title}
                    className="h-20 w-28 flex-none rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-28 flex-none items-center justify-center rounded-md bg-neutral-100">
                    <FeatherLink className="text-neutral-500" style={{ width: 24, height: 24 }} />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-1.5">
                  <span className="text-body-bold font-body-bold text-[#ffffffff] line-clamp-2">
                    {metadata.title}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge
                      style={PLATFORM_COLORS[metadata.platform] ? {
                        backgroundColor: PLATFORM_COLORS[metadata.platform] + '22',
                        color: PLATFORM_COLORS[metadata.platform],
                        borderColor: PLATFORM_COLORS[metadata.platform] + '44',
                      } : undefined}
                    >
                      {metadata.platform}
                    </Badge>
                    <span className="text-caption font-caption text-neutral-400">
                      {metadata.type === 'video' ? '1 video' : metadata.itemCount < 0 ? 'images' : `${metadata.itemCount}${metadata.itemCount >= 100 ? '+' : ''} image${metadata.itemCount !== 1 ? 's' : ''}`}
                    </span>
                    {metadata.duration && (
                      <span className="text-caption font-caption text-neutral-500">
                        {Math.floor(metadata.duration / 60)}:{String(Math.floor(metadata.duration % 60)).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Audio note */}
              {audioOnly && (
                <div className="flex items-center gap-2 rounded-lg border border-indigo-900/40 bg-indigo-950/20 px-3 py-2">
                  <span className="text-caption font-caption text-indigo-300">Audio will be extracted as MP3 from this video</span>
                </div>
              )}

              {/* Bank selector */}
              {!audioOnly && bankCount > 1 && (
                <div className="flex flex-col gap-2">
                  <label className="text-caption font-caption text-neutral-400">Add to slide bank</label>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: bankCount }, (_, i) => {
                      const color = getBankColor(i);
                      const label = getBankLabel(i);
                      const isSelected = selectedBank === i;
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedBank(i)}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-caption font-caption transition-colors cursor-pointer ${
                            isSelected
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

              {/* Download cap — for galleries with many or unknown items */}
              {metadata.type === 'gallery' && (metadata.itemCount > 10 || metadata.itemCount < 0) && (
                <div className="flex flex-col gap-2">
                  <label className="text-caption font-caption text-neutral-400">How many to import?</label>
                  <div className="flex flex-wrap gap-2">
                    {(metadata.itemCount < 0 ? [50, 100, 150] : [10, 30, 50, 100]).map(cap => (
                      <button
                        key={cap}
                        onClick={() => setMaxItems(cap)}
                        className={`rounded-lg border px-3 py-2 text-caption font-caption transition-colors cursor-pointer ${
                          maxItems === cap
                            ? 'border-indigo-500 bg-indigo-500/10 text-[#ffffffff]'
                            : 'border-neutral-200 bg-transparent text-neutral-400 hover:border-neutral-600'
                        }`}
                      >
                        {cap} images
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2.5">
                  <FeatherAlertCircle className="mt-0.5 flex-none text-red-400" style={{ width: 14, height: 14 }} />
                  <span className="text-caption font-caption text-red-300">{error}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button variant="neutral-secondary" size="medium" onClick={() => { setState(STATES.INPUT); setMetadata(null); setError(null); }}>
                  Back
                </Button>
                <Button variant="brand-primary" size="medium" icon={<FeatherDownload />} onClick={handleImport} disabled={metadata.type !== 'video' && metadata.itemCount === 0}>
                  {audioOnly ? 'Extract Audio' : `Import ${metadata.type === 'video' ? 'Video' : `${metadata.itemCount < 0 || metadata.itemCount > 10 ? maxItems : metadata.itemCount} Images`}`}
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
                      style={{ width: `${importProgress.progress}%`, transition: 'width 0.3s ease' }}
                    />
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
