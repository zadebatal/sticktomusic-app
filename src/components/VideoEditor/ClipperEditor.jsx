/**
 * ClipperEditor — Split a source video into multiple clips using FFmpeg stream-copy
 *
 * Simple 2-panel layout:
 *   Left: Video preview with playback controls + clip markers on timeline
 *   Right: Clip list (defined segments) + export controls
 *
 * Uses FFmpeg `-c copy` for instant extraction (no re-encoding).
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useToast } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlay, FeatherPause, FeatherScissors, FeatherTrash2,
  FeatherPlus, FeatherDownload, FeatherUpload, FeatherX,
  FeatherSkipBack, FeatherSkipForward, FeatherVolume2, FeatherVolumeX,
  FeatherCheckCircle,
} from '@subframe/core';
import EditorShell from './shared/EditorShell';
import EditorTopBar from './shared/EditorTopBar';
import EditorFooter from './shared/EditorFooter';
import useIsMobile from '../../hooks/useIsMobile';
import { uploadFile } from '../../services/firebaseStorage';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// ── FFmpeg singleton (shared with videoExportService) ──
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

  // Video state
  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const fileInputRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceName, setSourceName] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoName, setVideoName] = useState(existingVideo?.name || 'Untitled Clip');

  // Clip segments
  const [clips, setClips] = useState([]);
  const [markIn, setMarkIn] = useState(null); // Pending in-point
  const [activeClipIdx, setActiveClipIdx] = useState(null);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedCount, setExportedCount] = useState(0);

  // Load existing video source from category
  useEffect(() => {
    if (existingVideo?.clips) {
      setClips(existingVideo.clips);
      setSourceUrl(existingVideo.sourceUrl);
      setSourceName(existingVideo.sourceName || '');
    } else if (category?.videos?.length > 0) {
      const firstVideo = category.videos[0];
      setSourceUrl(firstVideo.url || firstVideo.cloudUrl);
      setSourceName(firstVideo.name || firstVideo.originalName || 'Source');
    }
  }, [existingVideo, category]);

  // Playback tracking
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => setDuration(video.duration);
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

  const seekTo = useCallback((time) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(time, duration));
    setCurrentTime(video.currentTime);
  }, [duration]);

  // ── Source file selection ──
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('video/')) return;
    if (sourceUrl && sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
    setSourceFile(file);
    setSourceUrl(URL.createObjectURL(file));
    setSourceName(file.name.replace(/\.[^/.]+$/, ''));
    setClips([]);
    setMarkIn(null);
    e.target.value = '';
  }, [sourceUrl]);

  // ── Mark in/out ──
  const handleMarkIn = useCallback(() => {
    setMarkIn(currentTime);
  }, [currentTime]);

  const handleMarkOut = useCallback(() => {
    if (markIn === null) return;
    const start = Math.min(markIn, currentTime);
    const end = Math.max(markIn, currentTime);
    if (end - start < 0.1) return; // Too short

    const newClip = {
      id: `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      start,
      end,
      duration: end - start,
      name: `Clip ${clips.length + 1}`,
    };
    setClips(prev => [...prev, newClip].sort((a, b) => a.start - b.start));
    setMarkIn(null);
    toastSuccess(`Clip marked: ${formatTime(start)} → ${formatTime(end)}`);
  }, [markIn, currentTime, clips.length, toastSuccess]);

  const handleQuickSplit = useCallback(() => {
    // If mark-in is set, mark-out at current time. Otherwise, set mark-in.
    if (markIn !== null) {
      handleMarkOut();
    } else {
      handleMarkIn();
    }
  }, [markIn, handleMarkIn, handleMarkOut]);

  const removeClip = useCallback((idx) => {
    setClips(prev => prev.filter((_, i) => i !== idx));
    if (activeClipIdx === idx) setActiveClipIdx(null);
  }, [activeClipIdx]);

  const renameClip = useCallback((idx, name) => {
    setClips(prev => prev.map((c, i) => i === idx ? { ...c, name } : c));
  }, []);

  // Jump to clip
  const jumpToClip = useCallback((clip) => {
    seekTo(clip.start);
  }, [seekTo]);

  // ── Timeline click ──
  const handleTimelineClick = useCallback((e) => {
    if (!duration || !timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    seekTo(pct * duration);
  }, [duration, seekTo]);

  // ── Export clips using FFmpeg stream-copy ──
  const handleExport = useCallback(async () => {
    if (clips.length === 0) return;
    setExporting(true);
    setExportProgress(0);
    setExportedCount(0);

    try {
      const ffmpeg = await loadFFmpeg();

      // Get source data
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

        // Stream-copy: instant, no re-encoding
        await ffmpeg.exec([
          '-i', inputName,
          '-ss', clip.start.toFixed(3),
          '-to', clip.end.toFixed(3),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          outputName,
        ]);

        const data = await ffmpeg.readFile(outputName);
        const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4';
        const blob = new Blob([data.buffer], { type: mimeType });
        await ffmpeg.deleteFile(outputName);

        // Upload to Firebase Storage
        const { url: cloudUrl } = await uploadFile(blob, 'clips', () => {});

        results.push({
          ...clip,
          cloudUrl,
          blob,
        });

        setExportedCount(i + 1);
        setExportProgress(Math.round(((i + 1) / clips.length) * 100));
      }

      await ffmpeg.deleteFile(inputName);

      // Save each clip as a separate draft via onSave
      for (const result of results) {
        if (onSave) {
          onSave({
            name: result.name,
            editorMode: 'clipper',
            cloudUrl: result.cloudUrl,
            sourceUrl: sourceUrl?.startsWith('blob:') ? null : sourceUrl,
            sourceName,
            clip: { start: result.start, end: result.end, duration: result.duration },
            clips, // Full clip list for re-editing
          });
        }
      }

      toastSuccess(`Exported ${results.length} clip${results.length !== 1 ? 's' : ''}`);
      setExporting(false);
    } catch (err) {
      console.error('[Clipper] Export failed:', err);
      toastError(`Export failed: ${err.message}`);
      setExporting(false);
    }
  }, [clips, sourceFile, sourceUrl, sourceName, onSave, toastSuccess, toastError]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'i':
          e.preventDefault();
          handleMarkIn();
          break;
        case 'o':
          e.preventDefault();
          if (markIn !== null) handleMarkOut();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekTo(currentTime - (e.shiftKey ? 5 : 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekTo(currentTime + (e.shiftKey ? 5 : 1));
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, handleMarkIn, handleMarkOut, markIn, seekTo, currentTime]);

  // ── Render ──
  const hasSource = !!sourceUrl;

  return (
    <EditorShell onBackdropClick={onClose} isMobile={isMobile}>
      <EditorTopBar
        title={videoName}
        onTitleChange={setVideoName}
        placeholder="Untitled Clip"
        onClose={onClose}
        isMobile={isMobile}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel: Video preview ── */}
        <div className={`flex flex-col flex-1 min-w-0 bg-black ${isMobile ? '' : 'border-r border-neutral-800'}`}>
          {!hasSource ? (
            /* Empty state — pick source video */
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-neutral-800/50 border border-neutral-700">
                <FeatherScissors className="text-neutral-500" style={{ width: 32, height: 32 }} />
              </div>
              <span className="text-heading-3 font-heading-3 text-white">Select a source video</span>
              <span className="text-body font-body text-neutral-400 text-center max-w-sm">
                Choose a video to split into multiple clips using stream-copy (instant, no quality loss)
              </span>
              <div className="flex items-center gap-3">
                <Button
                  variant="brand-primary" size="medium"
                  icon={<FeatherUpload />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload Video
                </Button>
                {category?.videos?.length > 0 && (
                  <Button
                    variant="neutral-secondary" size="medium"
                    onClick={() => {
                      const v = category.videos[0];
                      setSourceUrl(v.url || v.cloudUrl);
                      setSourceName(v.name || v.originalName || 'Source');
                    }}
                  >
                    Use Collection Video
                  </Button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            <>
              {/* Video */}
              <div className="flex flex-1 items-center justify-center bg-black min-h-0 p-4">
                <video
                  ref={videoRef}
                  src={sourceUrl}
                  className="max-w-full max-h-full rounded-lg"
                  onClick={togglePlay}
                  playsInline
                />
              </div>

              {/* Timeline */}
              <div className="flex flex-col gap-2 px-4 pb-3">
                {/* Time display */}
                <div className="flex items-center justify-between">
                  <span className="text-caption font-caption text-neutral-400">
                    {formatTimePrecise(currentTime)}
                  </span>
                  <span className="text-caption font-caption text-neutral-500">
                    {formatTime(duration)}
                  </span>
                </div>

                {/* Timeline bar */}
                <div
                  ref={timelineRef}
                  className="relative h-10 rounded-lg bg-neutral-800 cursor-pointer overflow-hidden"
                  onClick={handleTimelineClick}
                >
                  {/* Clip regions */}
                  {clips.map((clip, i) => (
                    <div
                      key={clip.id}
                      className={`absolute top-0 h-full rounded transition-colors ${
                        activeClipIdx === i ? 'bg-indigo-500/40 border border-indigo-400' : 'bg-indigo-500/20 border border-indigo-500/30'
                      }`}
                      style={{
                        left: `${(clip.start / duration) * 100}%`,
                        width: `${((clip.end - clip.start) / duration) * 100}%`,
                      }}
                      onClick={(e) => { e.stopPropagation(); setActiveClipIdx(i); jumpToClip(clip); }}
                    />
                  ))}

                  {/* Mark-in indicator */}
                  {markIn !== null && (
                    <div
                      className="absolute top-0 h-full border-l-2 border-dashed border-green-400"
                      style={{ left: `${(markIn / duration) * 100}%` }}
                    >
                      <div className="absolute -top-0.5 -left-1 w-2 h-2 rounded-full bg-green-400" />
                    </div>
                  )}

                  {/* Pending region (mark-in to current) */}
                  {markIn !== null && (
                    <div
                      className="absolute top-0 h-full bg-green-500/15"
                      style={{
                        left: `${(Math.min(markIn, currentTime) / duration) * 100}%`,
                        width: `${(Math.abs(currentTime - markIn) / duration) * 100}%`,
                      }}
                    />
                  )}

                  {/* Playhead */}
                  <div
                    className="absolute top-0 h-full w-0.5 bg-white z-10"
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                  />
                </div>

                {/* Controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <IconButton
                      variant="neutral-tertiary" size="small"
                      icon={<FeatherSkipBack />}
                      aria-label="Back 5s"
                      onClick={() => seekTo(currentTime - 5)}
                    />
                    <IconButton
                      variant="neutral-tertiary" size="medium"
                      icon={isPlaying ? <FeatherPause /> : <FeatherPlay />}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                      onClick={togglePlay}
                    />
                    <IconButton
                      variant="neutral-tertiary" size="small"
                      icon={<FeatherSkipForward />}
                      aria-label="Forward 5s"
                      onClick={() => seekTo(currentTime + 5)}
                    />
                    <IconButton
                      variant="neutral-tertiary" size="small"
                      icon={isMuted ? <FeatherVolumeX /> : <FeatherVolume2 />}
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                      onClick={toggleMute}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {markIn !== null && (
                      <Badge variant="success">IN: {formatTimePrecise(markIn)}</Badge>
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

                {/* Keyboard hint */}
                <div className="flex items-center gap-3 text-[10px] text-neutral-600">
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

        {/* ── Right panel: Clip list ── */}
        {!isMobile && (
          <div className="flex flex-col w-[300px] bg-[#0a0a0f] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="text-body-bold font-body-bold text-white">Clips</span>
                <Badge variant="neutral">{clips.length}</Badge>
              </div>
              {hasSource && (
                <Button
                  variant="neutral-secondary" size="small"
                  icon={<FeatherUpload />}
                  onClick={() => fileInputRef.current?.click()}
                >
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

            {/* Clip list */}
            {clips.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-4 gap-2">
                <FeatherScissors className="text-neutral-700" style={{ width: 24, height: 24 }} />
                <span className="text-caption font-caption text-neutral-500 text-center">
                  {hasSource ? 'Use I/O keys or the Mark In/Out button to define clip segments' : 'Select a source video first'}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1 p-2">
                {clips.map((clip, i) => (
                  <div
                    key={clip.id}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                      activeClipIdx === i
                        ? 'bg-indigo-500/15 border border-indigo-500/30'
                        : 'bg-neutral-800/50 border border-transparent hover:bg-neutral-800'
                    }`}
                    onClick={() => { setActiveClipIdx(i); jumpToClip(clip); }}
                  >
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <input
                        className="bg-transparent text-sm text-white outline-none w-full truncate"
                        value={clip.name}
                        onChange={(e) => renameClip(i, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-neutral-500">
                          {formatTimePrecise(clip.start)} → {formatTimePrecise(clip.end)}
                        </span>
                        <Badge variant="neutral">{formatTime(clip.duration)}</Badge>
                      </div>
                    </div>
                    <IconButton
                      variant="neutral-tertiary" size="small"
                      icon={<FeatherTrash2 />}
                      aria-label="Remove clip"
                      onClick={(e) => { e.stopPropagation(); removeClip(i); }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Export section */}
            {clips.length > 0 && (
              <div className="flex flex-col gap-2 mt-auto p-4 border-t border-neutral-800">
                {exporting && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-caption text-neutral-400">
                        Exporting {exportedCount}/{clips.length}...
                      </span>
                      <span className="text-caption font-caption text-neutral-500">{exportProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-neutral-800">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${exportProgress}%` }}
                      />
                    </div>
                  </div>
                )}
                <Button
                  variant="brand-primary" size="medium"
                  icon={exporting ? undefined : <FeatherDownload />}
                  disabled={exporting}
                  loading={exporting}
                  onClick={handleExport}
                >
                  {exporting
                    ? `Exporting ${exportedCount}/${clips.length}...`
                    : `Export ${clips.length} Clip${clips.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            )}

            {/* Hidden file input for changing source */}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        )}
      </div>

      {/* Mobile clip list (bottom sheet style) */}
      {isMobile && hasSource && clips.length > 0 && (
        <div className="flex flex-col gap-1 px-3 py-2 border-t border-neutral-800 bg-[#0a0a0f] max-h-[200px] overflow-y-auto">
          {clips.map((clip, i) => (
            <div
              key={clip.id}
              className="flex items-center gap-2 rounded-lg px-3 py-2 bg-neutral-800/50"
            >
              <span className="text-sm text-white flex-1 truncate">{clip.name}</span>
              <span className="text-[11px] text-neutral-500">
                {formatTimePrecise(clip.start)}→{formatTimePrecise(clip.end)}
              </span>
              <IconButton
                variant="neutral-tertiary" size="small"
                icon={<FeatherTrash2 />}
                aria-label="Remove"
                onClick={() => removeClip(i)}
              />
            </div>
          ))}
        </div>
      )}

      <EditorFooter isMobile={isMobile}>
        <div className="flex items-center gap-3">
          {isMobile && hasSource && (
            <Button
              variant="brand-primary" size="medium"
              icon={<FeatherDownload />}
              disabled={clips.length === 0 || exporting}
              loading={exporting}
              onClick={handleExport}
            >
              Export {clips.length}
            </Button>
          )}
        </div>
      </EditorFooter>
    </EditorShell>
  );
};

export default ClipperEditor;
