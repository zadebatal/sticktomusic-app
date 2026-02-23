/**
 * ClipperEditor — Split a source video into multiple clips using FFmpeg stream-copy
 *
 * Features:
 * - Mark in/out to define clip segments
 * - Organize clips into named buckets (accessible in niches)
 * - rAF-based smooth playhead (60fps DOM updates)
 * - Keyboard shortcuts (Space, I, O, arrows)
 * - FFmpeg stream-copy extraction (no re-encoding)
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useToast } from '../ui';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlay, FeatherPause, FeatherScissors, FeatherTrash2,
  FeatherPlus, FeatherDownload, FeatherUpload, FeatherX,
  FeatherSkipBack, FeatherSkipForward, FeatherVolume2, FeatherVolumeX,
  FeatherChevronDown, FeatherChevronRight,
} from '@subframe/core';
import EditorShell from './shared/EditorShell';
import EditorTopBar from './shared/EditorTopBar';
import EditorFooter from './shared/EditorFooter';
import useIsMobile from '../../hooks/useIsMobile';
import { uploadFile } from '../../services/firebaseStorage';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// ── FFmpeg singleton ──
let ffmpegInstance = null;
let ffmpegLoadPromise = null;

const loadFFmpeg = async () => {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;
  ffmpegLoadPromise = (async () => {
    try {
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    } catch (error) {
      console.error('[Clipper] Failed to load FFmpeg:', error);
      ffmpegLoadPromise = null;
      throw error;
    }
  })();
  return ffmpegLoadPromise;
};

// ── Formatting ──
const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatTimePrecise = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
};

// ── Bucket colors (rotating palette) ──
const BUCKET_COLORS = [
  { bg: 'rgba(99,102,241,0.2)', border: 'rgba(99,102,241,0.4)', active: 'rgba(99,102,241,0.45)', activeBorder: '#818cf8', dot: '#6366f1' },
  { bg: 'rgba(34,197,94,0.2)', border: 'rgba(34,197,94,0.4)', active: 'rgba(34,197,94,0.45)', activeBorder: '#22c55e', dot: '#22c55e' },
  { bg: 'rgba(168,85,247,0.2)', border: 'rgba(168,85,247,0.4)', active: 'rgba(168,85,247,0.45)', activeBorder: '#a855f7', dot: '#a855f7' },
  { bg: 'rgba(244,63,94,0.2)', border: 'rgba(244,63,94,0.4)', active: 'rgba(244,63,94,0.45)', activeBorder: '#f43f5e', dot: '#f43f5e' },
  { bg: 'rgba(245,158,11,0.2)', border: 'rgba(245,158,11,0.4)', active: 'rgba(245,158,11,0.45)', activeBorder: '#f59e0b', dot: '#f59e0b' },
  { bg: 'rgba(6,182,212,0.2)', border: 'rgba(6,182,212,0.4)', active: 'rgba(6,182,212,0.45)', activeBorder: '#06b6d4', dot: '#06b6d4' },
];
const getBucketColor = (index) => BUCKET_COLORS[index % BUCKET_COLORS.length];

// ── Component ──
const ClipperEditor = ({
  category,
  existingVideo = null,
  onSave,
  onClose,
  artistId = null,
  db = null,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { isMobile } = useIsMobile();

  // ── State ──
  const [sourceUrl, setSourceUrl] = useState(null);
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceName, setSourceName] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoName, setVideoName] = useState(existingVideo?.name || 'Untitled Clip');
  const [clips, setClips] = useState([]);
  const [markIn, setMarkIn] = useState(null);
  const [activeClipIdx, setActiveClipIdx] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedCount, setExportedCount] = useState(0);

  // Bucket state
  const [buckets, setBuckets] = useState(['Bucket 1']);
  const [activeBucket, setActiveBucketRaw] = useState('Bucket 1');
  const [collapsedBuckets, setCollapsedBuckets] = useState({});

  // ── Refs ──
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const trackAreaRef = useRef(null);
  const playheadRef = useRef(null);
  const pendingRegionRef = useRef(null);
  const markInRef = useRef(null);
  const activeBucketRef = useRef('Bucket 1');
  const rafRef = useRef(null);

  // Keep refs in sync with state
  const setActiveBucket = useCallback((val) => {
    activeBucketRef.current = val;
    setActiveBucketRaw(val);
  }, []);

  // ── Load existing data ──
  useEffect(() => {
    if (existingVideo?.editorMode === 'clipper') {
      if (existingVideo.clips) setClips(existingVideo.clips);
      if (existingVideo.buckets?.length) {
        setBuckets(existingVideo.buckets);
        setActiveBucket(existingVideo.buckets[0]);
      }
      if (existingVideo.sourceUrl) setSourceUrl(existingVideo.sourceUrl);
      if (existingVideo.sourceName) setSourceName(existingVideo.sourceName);
    } else if (existingVideo?.clips) {
      setClips(existingVideo.clips);
      setSourceUrl(existingVideo.sourceUrl);
      setSourceName(existingVideo.sourceName || '');
    } else if (category?.videos?.length > 0) {
      const firstVideo = category.videos[0];
      setSourceUrl(firstVideo.url || firstVideo.cloudUrl);
      setSourceName(firstVideo.name || firstVideo.originalName || 'Source');
    }
  }, [existingVideo, category, setActiveBucket]);

  // ── Time display update (throttled via timeupdate ~4x/sec for the badge) ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => {
      setDuration(video.duration);
      // Position playhead at 0 on load
      if (playheadRef.current) playheadRef.current.style.left = '0%';
    };
    const onEnded = () => setIsPlaying(false);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('ended', onEnded);
    };
  }, [sourceUrl]);

  // ── Smooth playhead via rAF (60fps DOM updates, no React re-renders per frame) ──
  useEffect(() => {
    if (!isPlaying) return;
    const video = videoRef.current;
    if (!video) return;
    const tick = () => {
      const t = video.currentTime;
      const d = video.duration;
      if (d > 0) {
        if (playheadRef.current) {
          playheadRef.current.style.left = `${(t / d) * 100}%`;
        }
        const mi = markInRef.current;
        if (pendingRegionRef.current) {
          if (mi !== null) {
            const lo = Math.min(mi, t);
            const hi = Math.max(mi, t);
            pendingRegionRef.current.style.left = `${(lo / d) * 100}%`;
            pendingRegionRef.current.style.width = `${((hi - lo) / d) * 100}%`;
            pendingRegionRef.current.style.display = '';
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying]);

  // ── Playback controls ──
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  // seekTo reads video.duration directly (no stale closure) and updates DOM immediately
  const seekTo = useCallback((time) => {
    const video = videoRef.current;
    if (!video) return;
    const d = video.duration;
    if (!d || d <= 0) return;
    const clamped = Math.max(0, Math.min(time, d));
    video.currentTime = clamped;
    setCurrentTime(clamped);
    // Direct DOM update for instant playhead feedback (critical when paused)
    if (playheadRef.current) {
      playheadRef.current.style.left = `${(clamped / d) * 100}%`;
    }
    // Update pending region
    const mi = markInRef.current;
    if (pendingRegionRef.current) {
      if (mi !== null) {
        const lo = Math.min(mi, clamped);
        const hi = Math.max(mi, clamped);
        pendingRegionRef.current.style.left = `${(lo / d) * 100}%`;
        pendingRegionRef.current.style.width = `${((hi - lo) / d) * 100}%`;
        pendingRegionRef.current.style.display = '';
      } else {
        pendingRegionRef.current.style.display = 'none';
      }
    }
  }, []);

  // ── Source file selection ──
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('video/')) return;
    if (sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
    setSourceFile(file);
    setSourceUrl(URL.createObjectURL(file));
    setSourceName(file.name.replace(/\.[^/.]+$/, ''));
    setClips([]);
    markInRef.current = null;
    setMarkIn(null);
    e.target.value = '';
  }, [sourceUrl]);

  // ── Mark in/out (reads video.currentTime directly for frame-accurate timing) ──
  const handleMarkIn = useCallback(() => {
    const time = videoRef.current?.currentTime ?? 0;
    markInRef.current = time;
    setMarkIn(time);
  }, []);

  const handleMarkOut = useCallback(() => {
    const mi = markInRef.current;
    if (mi === null) return;
    const time = videoRef.current?.currentTime ?? 0;
    const start = Math.min(mi, time);
    const end = Math.max(mi, time);
    if (end - start < 0.1) return;
    setClips(prev => {
      const newClip = {
        id: `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        start,
        end,
        duration: end - start,
        name: `Clip ${prev.length + 1}`,
        bucket: activeBucketRef.current,
      };
      return [...prev, newClip].sort((a, b) => a.start - b.start);
    });
    markInRef.current = null;
    setMarkIn(null);
    if (pendingRegionRef.current) pendingRegionRef.current.style.display = 'none';
    toastSuccess(`Clip: ${formatTimePrecise(start)} → ${formatTimePrecise(end)}`);
  }, [toastSuccess]);

  const handleQuickSplit = useCallback(() => {
    if (markInRef.current !== null) {
      handleMarkOut();
    } else {
      handleMarkIn();
    }
  }, [handleMarkIn, handleMarkOut]);

  const clearMarkIn = useCallback(() => {
    markInRef.current = null;
    setMarkIn(null);
    if (pendingRegionRef.current) pendingRegionRef.current.style.display = 'none';
  }, []);

  // ── Clip management ──
  const removeClip = useCallback((idx) => {
    setClips(prev => prev.filter((_, i) => i !== idx));
    setActiveClipIdx(prev => {
      if (prev === null) return null;
      if (prev === idx) return null;
      if (prev > idx) return prev - 1;
      return prev;
    });
  }, []);

  const renameClip = useCallback((idx, name) => {
    setClips(prev => prev.map((c, i) => i === idx ? { ...c, name } : c));
  }, []);

  const jumpToClip = useCallback((clip) => {
    seekTo(clip.start);
  }, [seekTo]);

  const moveClipToBucket = useCallback((clipIdx, bucketName) => {
    setClips(prev => prev.map((c, i) => i === clipIdx ? { ...c, bucket: bucketName } : c));
  }, []);

  // ── Bucket management ──
  const addBucket = useCallback(() => {
    const n = buckets.length + 1;
    setBuckets(prev => [...prev, `Bucket ${n}`]);
  }, [buckets.length]);

  const removeBucket = useCallback((bucketName) => {
    if (buckets.length <= 1) return;
    const fallback = buckets.find(b => b !== bucketName) || buckets[0];
    setBuckets(prev => prev.filter(b => b !== bucketName));
    setClips(prev => prev.map(c => c.bucket === bucketName ? { ...c, bucket: fallback } : c));
    if (activeBucket === bucketName) setActiveBucket(fallback);
  }, [buckets, activeBucket, setActiveBucket]);

  const renameBucket = useCallback((oldName, newName) => {
    if (!newName.trim()) return;
    setBuckets(prev => prev.map(b => b === oldName ? newName : b));
    setClips(prev => prev.map(c => c.bucket === oldName ? { ...c, bucket: newName } : c));
    if (activeBucket === oldName) setActiveBucket(newName);
  }, [activeBucket, setActiveBucket]);

  const toggleBucketCollapse = useCallback((bucketName) => {
    setCollapsedBuckets(prev => ({ ...prev, [bucketName]: !prev[bucketName] }));
  }, []);

  // ── Track click-to-seek (uses trackAreaRef for correct position math) ──
  const handleTrackClick = useCallback((e) => {
    const rect = trackAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const d = videoRef.current?.duration;
    if (!d || d <= 0) return;
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(pct * d);
  }, [seekTo]);

  // ── Save (clip marks + buckets, no FFmpeg) ──
  const handleSave = useCallback(() => {
    if (!onSave) return;
    onSave({
      name: videoName,
      editorMode: 'clipper',
      sourceUrl: sourceUrl?.startsWith('blob:') ? null : sourceUrl,
      sourceName,
      clips: clips.map(c => ({
        id: c.id, name: c.name, start: c.start, end: c.end,
        duration: c.duration, bucket: c.bucket,
        ...(c.cloudUrl ? { cloudUrl: c.cloudUrl } : {}),
      })),
      buckets,
      thumbnail: null,
    });
    toastSuccess('Clip session saved');
  }, [videoName, sourceUrl, sourceName, clips, buckets, onSave, toastSuccess]);

  // ── Export clips using FFmpeg stream-copy ──
  const handleExport = useCallback(async () => {
    if (clips.length === 0) return;
    setExporting(true);
    setExportProgress(0);
    setExportedCount(0);

    try {
      const ffmpeg = await loadFFmpeg();
      let sourceData;
      if (sourceFile) {
        sourceData = await fetchFile(sourceFile);
      } else if (sourceUrl) {
        sourceData = await fetchFile(sourceUrl);
      } else {
        throw new Error('No source video');
      }

      const ext = sourceFile?.name?.split('.').pop() || 'mp4';
      const inputName = `source.${ext}`;
      await ffmpeg.writeFile(inputName, sourceData);

      const results = [];
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const outputName = `clip_${i}.${ext}`;
        const clipDuration = clip.end - clip.start;

        // -ss before -i for fast keyframe seek, -t for duration
        await ffmpeg.exec([
          '-ss', clip.start.toFixed(3),
          '-i', inputName,
          '-t', clipDuration.toFixed(3),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          outputName,
        ]);

        const data = await ffmpeg.readFile(outputName);
        const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4';
        const blob = new Blob([data.buffer], { type: mimeType });
        await ffmpeg.deleteFile(outputName);

        const { url: cloudUrl } = await uploadFile(blob, 'clips', () => {});
        results.push({ ...clip, cloudUrl });
        setExportedCount(i + 1);
        setExportProgress(Math.round(((i + 1) / clips.length) * 100));
      }

      await ffmpeg.deleteFile(inputName);

      // Update clips with cloudUrls
      setClips(prev => prev.map(c => {
        const result = results.find(r => r.id === c.id);
        return result ? { ...c, cloudUrl: result.cloudUrl } : c;
      }));

      // Save full session with exported URLs
      if (onSave) {
        onSave({
          name: videoName,
          editorMode: 'clipper',
          sourceUrl: sourceUrl?.startsWith('blob:') ? null : sourceUrl,
          sourceName,
          clips: results.map(r => ({
            id: r.id, name: r.name, start: r.start, end: r.end,
            duration: r.duration, bucket: r.bucket, cloudUrl: r.cloudUrl,
          })),
          buckets,
          thumbnail: results[0]?.cloudUrl || null,
        });
      }

      toastSuccess(`Exported ${results.length} clip${results.length !== 1 ? 's' : ''}`);
      setExporting(false);
    } catch (err) {
      console.error('[Clipper] Export failed:', err);
      toastError(`Export failed: ${err.message}`);
      setExporting(false);
    }
  }, [clips, sourceFile, sourceUrl, sourceName, videoName, buckets, onSave, toastSuccess, toastError]);

  // ── Keyboard shortcuts (reads video.currentTime directly for accuracy) ──
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          handleMarkIn();
          break;
        case 'o':
        case 'O':
          e.preventDefault();
          if (markInRef.current !== null) handleMarkOut();
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          const t = videoRef.current?.currentTime ?? 0;
          seekTo(t - (e.shiftKey ? 5 : 1));
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const t = videoRef.current?.currentTime ?? 0;
          seekTo(t + (e.shiftKey ? 5 : 1));
          break;
        }
        default: break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, handleMarkIn, handleMarkOut, seekTo]);

  // ── Computed ──
  const hasSource = !!sourceUrl;

  const clipsByBucket = useMemo(() => {
    const map = {};
    for (const b of buckets) map[b] = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const bucket = c.bucket || buckets[0];
      if (!map[bucket]) map[bucket] = [];
      map[bucket].push({ ...c, _idx: i });
    }
    return map;
  }, [clips, buckets]);

  // ── Render ──
  return (
    <EditorShell onBackdropClick={onClose} isMobile={isMobile}>
      <EditorTopBar
        title={videoName}
        onTitleChange={setVideoName}
        placeholder="Untitled Clip"
        onBack={onClose}
        isMobile={isMobile}
        onSave={handleSave}
        onExport={handleExport}
        exportDisabled={clips.length === 0 || exporting}
        exportLoading={exporting}
        exportLabel={exporting ? `Exporting ${exportedCount}/${clips.length}...` : `Export ${clips.length || 0}`}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel: Video + Timeline ── */}
        <div className={`flex flex-col flex-1 min-w-0 bg-black ${isMobile ? '' : 'border-r border-neutral-800'}`}>
          {!hasSource ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-neutral-800/50 border border-neutral-700">
                <FeatherScissors className="text-neutral-500" style={{ width: 32, height: 32 }} />
              </div>
              <span className="text-heading-3 font-heading-3 text-white">Select a source video</span>
              <span className="text-body font-body text-neutral-400 text-center max-w-sm">
                Choose a video to split into multiple clips using stream-copy (instant, no quality loss)
              </span>
              <div className="flex items-center gap-3">
                <Button variant="brand-primary" size="medium" icon={<FeatherUpload />} onClick={() => fileInputRef.current?.click()}>
                  Upload Video
                </Button>
                {category?.videos?.length > 0 && (
                  <Button variant="neutral-secondary" size="medium" onClick={() => {
                    const v = category.videos[0];
                    setSourceUrl(v.url || v.cloudUrl);
                    setSourceName(v.name || v.originalName || 'Source');
                  }}>
                    Use Collection Video
                  </Button>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
            </div>
          ) : (
            <>
              {/* Video player */}
              <div className="flex flex-1 items-center justify-center bg-black min-h-0 p-4">
                <video
                  ref={videoRef}
                  src={sourceUrl}
                  className="max-w-full max-h-full rounded-lg"
                  onClick={togglePlay}
                  playsInline
                />
              </div>

              {/* Timeline section */}
              <div className="flex flex-col gap-2 px-4 pb-3 border-t border-neutral-800 pt-3">
                {/* Header row */}
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-heading-3 font-heading-3 text-white">Timeline</span>
                    <Badge variant="neutral">{formatTimePrecise(currentTime)} / {formatTime(duration)}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Target bucket for new clips */}
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getBucketColor(buckets.indexOf(activeBucket)).dot }} />
                      <select
                        className="bg-neutral-800 text-caption font-caption text-neutral-300 border border-neutral-700 rounded px-2 py-1 cursor-pointer outline-none"
                        value={activeBucket}
                        onChange={e => setActiveBucket(e.target.value)}
                      >
                        {buckets.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    {markIn !== null && (
                      <Badge variant="success">IN: {formatTimePrecise(markIn)}</Badge>
                    )}
                    {markIn !== null && (
                      <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />} aria-label="Clear mark" onClick={clearMarkIn} />
                    )}
                    <Button
                      variant={markIn !== null ? 'brand-primary' : 'neutral-secondary'}
                      size="small"
                      icon={<FeatherScissors />}
                      onClick={handleQuickSplit}
                    >
                      {markIn !== null ? 'Mark Out (O)' : 'Mark In (I)'}
                    </Button>
                  </div>
                </div>

                {/* Multi-track timeline — labels separate from track area */}
                <div className="flex items-start gap-2">
                  {/* Labels column */}
                  <div className="flex flex-col gap-1 w-14 shrink-0">
                    <div className="h-10 flex items-center justify-end pr-1">
                      <span className="text-caption font-caption text-neutral-500">Clips</span>
                    </div>
                    <div className="h-7 flex items-center justify-end pr-1">
                      <span className="text-caption font-caption text-neutral-500">Source</span>
                    </div>
                  </div>

                  {/* Track area — playhead + clips positioned within this container */}
                  <div
                    ref={trackAreaRef}
                    className="flex-1 relative flex flex-col gap-1"
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={(e) => {
                      if (e.target === e.currentTarget || e.target.dataset.seekable === 'true') {
                        handleTrackClick(e);
                      }
                    }}
                  >
                    {/* Clips track */}
                    <div className="h-10 rounded-md border border-neutral-800 bg-neutral-900/40 relative overflow-hidden" data-seekable="true">
                      {clips.map((clip, i) => {
                        const startPct = duration > 0 ? (clip.start / duration) * 100 : 0;
                        const widthPct = duration > 0 ? ((clip.end - clip.start) / duration) * 100 : 0;
                        const isActive = activeClipIdx === i;
                        const bucketIdx = buckets.indexOf(clip.bucket);
                        const color = getBucketColor(bucketIdx >= 0 ? bucketIdx : 0);
                        return (
                          <div
                            key={clip.id}
                            style={{
                              position: 'absolute',
                              left: `${startPct}%`,
                              width: `${Math.max(widthPct, 0.5)}%`,
                              top: '2px',
                              bottom: '2px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              backgroundColor: isActive ? color.active : color.bg,
                              border: `2px solid ${isActive ? color.activeBorder : color.border}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden',
                              zIndex: isActive ? 10 : 5,
                              boxShadow: isActive ? `0 0 8px ${color.border}` : 'none',
                            }}
                            onClick={(e) => { e.stopPropagation(); setActiveClipIdx(i); jumpToClip(clip); }}
                          >
                            <span style={{
                              fontSize: '10px', fontWeight: 600, color: '#fff',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                            }}>
                              {clip.name}
                            </span>
                          </div>
                        );
                      })}

                      {/* Mark-in pending region (rAF-updated via ref) */}
                      <div
                        ref={pendingRegionRef}
                        style={{
                          position: 'absolute', left: '0%', width: '0%', top: 0, bottom: 0,
                          backgroundColor: 'rgba(34, 197, 94, 0.15)',
                          borderLeft: '2px solid #22c55e',
                          borderRight: '2px solid rgba(34, 197, 94, 0.5)',
                          zIndex: 3, pointerEvents: 'none', display: 'none',
                        }}
                      />

                      {/* Mark-in line (static position) */}
                      {markIn !== null && duration > 0 && (
                        <div style={{
                          position: 'absolute', left: `${(markIn / duration) * 100}%`,
                          top: 0, bottom: 0, width: '2px', backgroundColor: '#22c55e',
                          zIndex: 15, pointerEvents: 'none',
                        }} />
                      )}

                      {/* Empty hint */}
                      {clips.length === 0 && markIn === null && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <span className="text-[10px] text-neutral-600">Press I to mark in, O to mark out</span>
                        </div>
                      )}
                    </div>

                    {/* Source track */}
                    <div className="h-7 rounded-md border border-neutral-800 bg-neutral-900/30 relative overflow-hidden" data-seekable="true">
                      <div
                        style={{
                          position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
                          background: 'linear-gradient(90deg, rgba(99,102,241,0.06) 0%, rgba(99,102,241,0.02) 100%)',
                        }}
                        data-seekable="true"
                      />
                      <span style={{
                        position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                        fontSize: '10px', color: 'rgba(255,255,255,0.35)', pointerEvents: 'none',
                      }}>
                        {sourceName || 'No source'}
                      </span>
                    </div>

                    {/* Playhead (rAF-positioned via ref — no CSS transition) */}
                    {duration > 0 && (
                      <div
                        ref={playheadRef}
                        style={{
                          position: 'absolute', left: '0%', top: 0, bottom: 0,
                          width: '2px', backgroundColor: '#ef4444',
                          zIndex: 20, pointerEvents: 'auto', cursor: 'ew-resize',
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          document.body.style.userSelect = 'none';
                          const wasPlaying = isPlaying;
                          if (isPlaying) { videoRef.current?.pause(); setIsPlaying(false); }
                          const handleDragMove = (moveE) => {
                            const rect = trackAreaRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            const d = videoRef.current?.duration;
                            if (!d || d <= 0) return;
                            const pct = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width));
                            seekTo(pct * d);
                          };
                          const handleDragEnd = () => {
                            document.body.style.userSelect = '';
                            window.removeEventListener('mousemove', handleDragMove);
                            window.removeEventListener('mouseup', handleDragEnd);
                            if (wasPlaying) { videoRef.current?.play(); setIsPlaying(true); }
                          };
                          window.addEventListener('mousemove', handleDragMove);
                          window.addEventListener('mouseup', handleDragEnd);
                        }}
                      >
                        <div style={{ position: 'absolute', left: '-6px', right: '-6px', top: 0, bottom: 0, cursor: 'ew-resize' }} />
                        <div style={{
                          position: 'absolute', top: '-2px', left: '50%', transform: 'translateX(-50%)',
                          width: '10px', height: '10px', backgroundColor: '#ef4444', borderRadius: '2px',
                          clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
                        }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Playback controls */}
                <div className="flex w-full items-center justify-center gap-3">
                  <IconButton variant="neutral-tertiary" size="small" icon={<FeatherSkipBack />} aria-label="Skip to start" onClick={() => seekTo(0)} />
                  <IconButton variant="neutral-secondary" size="medium" icon={isPlaying ? <FeatherPause /> : <FeatherPlay />} aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} />
                  <IconButton variant="neutral-tertiary" size="small" icon={<FeatherSkipForward />} aria-label="Skip to end" onClick={() => seekTo(duration)} />
                  <IconButton variant="neutral-tertiary" size="small" icon={isMuted ? <FeatherVolumeX /> : <FeatherVolume2 />} aria-label={isMuted ? 'Unmute' : 'Mute'} onClick={toggleMute} />
                </div>

                {/* Keyboard hints */}
                <div className="flex items-center justify-center gap-3 text-[10px] text-neutral-600">
                  <span>Space: Play/Pause</span>
                  <span>I: Mark In</span>
                  <span>O: Mark Out</span>
                  <span>Arrow: Seek 1s</span>
                  <span>Shift+Arrow: 5s</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Right panel: Clip list with buckets ── */}
        {!isMobile && (
          <div className="flex flex-col w-[300px] bg-[#0a0a0f] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="text-body-bold font-body-bold text-white">Clips</span>
                <Badge variant="neutral">{clips.length}</Badge>
              </div>
              {hasSource && (
                <Button variant="neutral-secondary" size="small" icon={<FeatherUpload />} onClick={() => fileInputRef.current?.click()}>
                  Change Source
                </Button>
              )}
            </div>

            {/* Source info */}
            {hasSource && (
              <div className="flex items-center gap-2 px-4 py-2 bg-neutral-900/50 border-b border-neutral-800">
                <FeatherPlay className="text-neutral-500 flex-none" style={{ width: 12, height: 12 }} />
                <span className="text-caption font-caption text-neutral-400 truncate">{sourceName}</span>
                <span className="text-caption font-caption text-neutral-600 flex-none">{formatTime(duration)}</span>
              </div>
            )}

            {/* Clip list — grouped by bucket */}
            {clips.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-4 gap-2">
                <FeatherScissors className="text-neutral-700" style={{ width: 24, height: 24 }} />
                <span className="text-caption font-caption text-neutral-500 text-center">
                  {hasSource ? 'Use I/O keys or the Mark In/Out button to define clip segments' : 'Select a source video first'}
                </span>
              </div>
            ) : (
              <div className="flex flex-col flex-1">
                {buckets.map((bucketName, bIdx) => {
                  const bucketClips = clipsByBucket[bucketName] || [];
                  const color = getBucketColor(bIdx);
                  const isCollapsed = collapsedBuckets[bucketName];
                  return (
                    <div key={bucketName} className="flex flex-col">
                      {/* Bucket header */}
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-800/50 border-b border-neutral-800/50"
                        onClick={() => toggleBucketCollapse(bucketName)}
                      >
                        {isCollapsed
                          ? <FeatherChevronRight className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
                          : <FeatherChevronDown className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
                        }
                        <div className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: color.dot }} />
                        <input
                          className="bg-transparent text-caption-bold font-caption-bold text-neutral-300 outline-none flex-1 min-w-0"
                          value={bucketName}
                          onChange={(e) => renameBucket(bucketName, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Badge variant="neutral">{bucketClips.length}</Badge>
                        {buckets.length > 1 && (
                          <IconButton
                            variant="neutral-tertiary" size="small"
                            icon={<FeatherTrash2 />}
                            aria-label="Delete bucket"
                            onClick={(e) => { e.stopPropagation(); removeBucket(bucketName); }}
                          />
                        )}
                      </div>

                      {/* Clips in this bucket */}
                      {!isCollapsed && (
                        <div className="flex flex-col gap-1 p-2">
                          {bucketClips.map((clip) => {
                            const isActive = activeClipIdx === clip._idx;
                            return (
                              <div
                                key={clip.id}
                                className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                                  isActive
                                    ? 'border border-solid'
                                    : 'bg-neutral-800/40 border border-transparent hover:bg-neutral-800/70'
                                }`}
                                style={isActive ? { backgroundColor: color.active, borderColor: color.activeBorder } : {}}
                                onClick={() => { setActiveClipIdx(clip._idx); jumpToClip(clip); }}
                              >
                                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                  <input
                                    className="bg-transparent text-sm text-white outline-none w-full truncate"
                                    value={clip.name}
                                    onChange={(e) => renameClip(clip._idx, e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-neutral-500">
                                      {formatTimePrecise(clip.start)} → {formatTimePrecise(clip.end)}
                                    </span>
                                    <Badge variant="neutral">{formatTime(clip.duration)}</Badge>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  {buckets.length > 1 && (
                                    <select
                                      className="bg-neutral-800 text-[10px] text-neutral-400 border border-neutral-700 rounded px-1 py-0.5 cursor-pointer outline-none w-14"
                                      value={clip.bucket}
                                      onChange={(e) => { e.stopPropagation(); moveClipToBucket(clip._idx, e.target.value); }}
                                      onClick={(e) => e.stopPropagation()}
                                      title="Move to bucket"
                                    >
                                      {buckets.map(b => <option key={b} value={b}>{b}</option>)}
                                    </select>
                                  )}
                                  <IconButton
                                    variant="neutral-tertiary" size="small"
                                    icon={<FeatherTrash2 />}
                                    aria-label="Remove clip"
                                    onClick={(e) => { e.stopPropagation(); removeClip(clip._idx); }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add bucket button */}
                <div className="px-3 py-2">
                  <Button variant="neutral-tertiary" size="small" icon={<FeatherPlus />} onClick={addBucket}>
                    Add Bucket
                  </Button>
                </div>
              </div>
            )}

            {/* Export section */}
            {clips.length > 0 && (
              <div className="flex flex-col gap-2 mt-auto p-4 border-t border-neutral-800">
                {exporting && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-caption text-neutral-400">Exporting {exportedCount}/{clips.length}...</span>
                      <span className="text-caption font-caption text-neutral-500">{exportProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-neutral-800">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${exportProgress}%` }} />
                    </div>
                  </div>
                )}
                <Button
                  variant="brand-primary" size="medium"
                  icon={exporting ? undefined : <FeatherDownload />}
                  disabled={exporting} loading={exporting}
                  onClick={handleExport}
                >
                  {exporting
                    ? `Exporting ${exportedCount}/${clips.length}...`
                    : `Export ${clips.length} Clip${clips.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            )}

            {/* Hidden file input */}
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
          </div>
        )}
      </div>

      {/* Mobile clip list */}
      {isMobile && hasSource && clips.length > 0 && (
        <div className="flex flex-col gap-1 px-3 py-2 border-t border-neutral-800 bg-[#0a0a0f] max-h-[200px] overflow-y-auto">
          {clips.map((clip, i) => (
            <div key={clip.id} className="flex items-center gap-2 rounded-lg px-3 py-2 bg-neutral-800/50">
              <div className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: getBucketColor(buckets.indexOf(clip.bucket)).dot }} />
              <span className="text-sm text-white flex-1 truncate">{clip.name}</span>
              <span className="text-[11px] text-neutral-500">{formatTimePrecise(clip.start)}→{formatTimePrecise(clip.end)}</span>
              <IconButton variant="neutral-tertiary" size="small" icon={<FeatherTrash2 />} aria-label="Remove" onClick={() => removeClip(i)} />
            </div>
          ))}
          {/* Mobile export button */}
          <Button
            variant="brand-primary" size="medium"
            icon={<FeatherDownload />}
            disabled={exporting} loading={exporting}
            onClick={handleExport}
          >
            Export {clips.length} Clip{clips.length !== 1 ? 's' : ''}
          </Button>
        </div>
      )}

      <EditorFooter onCancel={onClose} onSaveAll={handleSave} saveLabel="Save" />
    </EditorShell>
  );
};

export default ClipperEditor;
