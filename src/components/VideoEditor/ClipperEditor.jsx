/**
 * ClipperEditor — Split a source video into multiple clips using FFmpeg stream-copy
 *
 * Features:
 * - Mark in/out to define clip segments
 * - Organize clips into banks (mapped to niche slide banks)
 * - rAF-based smooth playhead (60fps DOM updates)
 * - Keyboard shortcuts (Space, I, O, arrows)
 * - FFmpeg stream-copy extraction (no re-encoding)
 * - Session persistence (markers saved to niche, not as drafts)
 * - Export to niche banks (assignToBank)
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import log from '../../utils/logger';
import { useToast } from '../ui';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import {
  FeatherPlay, FeatherPause, FeatherScissors, FeatherTrash2,
  FeatherPlus, FeatherDownload, FeatherUpload, FeatherX,
  FeatherSkipBack, FeatherSkipForward, FeatherVolume2, FeatherVolumeX,
  FeatherChevronDown, FeatherChevronRight, FeatherCheck, FeatherZap,
  FeatherLoader, FeatherZoomIn, FeatherZoomOut,
} from '@subframe/core';
import EditorShell from './shared/EditorShell';
import EditorTopBar from './shared/EditorTopBar';
import EditorFooter from './shared/EditorFooter';
import useIsMobile from '../../hooks/useIsMobile';
import useUnsavedChanges from './shared/useUnsavedChanges';
import usePixelTimeline from './shared/usePixelTimeline';
import useTimelineZoom from '../../hooks/useTimelineZoom';
import useWaveform from '../../hooks/useWaveform';
import { uploadFile } from '../../services/firebaseStorage';
import { addToLibraryAsync, addToCollection, addToProjectPool, getBankColor } from '../../services/libraryService';
import { transcribeAudio } from '../../services/whisperService';
import { analyzeSongStructure } from '../../services/structureAnalysisService';
import { extractAudioSnippet } from '../../utils/audioSnippet';
import { recognizeSong, fetchSyncedLyrics } from '../../services/lyricsLookupService';
// ── FFmpeg singleton (lazy-loaded) ──
let ffmpegInstance = null;
let ffmpegLoadPromise = null;

const loadFFmpeg = async () => {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;
  ffmpegLoadPromise = (async () => {
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ff = new FFmpeg();
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ff.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
      ffmpegInstance = ff;
      return ff;
    } catch (error) {
      log.error('[Clipper] Failed to load FFmpeg:', error);
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

// ── Component ──
const ClipperEditor = ({
  category,
  existingVideo = null,
  existingSession = null,
  onSaveSession,
  onClose,
  artistId = null,
  db = null,
  sourceVideos = [],
  nicheId = null,
  projectId = null,
  nicheBankLabels = null,
  projectNiches = [],
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { isMobile } = useIsMobile();

  // ── State ──
  const [sourceUrl, setSourceUrl] = useState(null);
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceThumbnail, setSourceThumbnail] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoName, setVideoName] = useState(existingSession?.name || existingVideo?.name || 'Untitled Clip');
  const [clips, setClips] = useState([]);
  const [markIn, setMarkIn] = useState(null);
  const [activeClipIdx, setActiveClipIdx] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedCount, setExportedCount] = useState(0);

  // Bank state (replaces buckets)
  const [bankLabels, setBankLabels] = useState(() =>
    existingSession?.bankLabels || nicheBankLabels || ['Bucket 1']
  );
  const [activeBankIndex, setActiveBankIndexRaw] = useState(0);
  const [collapsedBanks, setCollapsedBanks] = useState({});

  // Export destinations: Set of selected targets (multi-select)
  const [exportDestinations, setExportDestinations] = useState(() => new Set(['current-niche']));
  const [destPickerOpen, setDestPickerOpen] = useState(false);

  const toggleDestination = useCallback((value) => {
    setExportDestinations(prev => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
        // Must have at least one destination
        if (next.size === 0) return prev;
      } else {
        // 'library-only' is exclusive — clear others when selected
        if (value === 'library-only') return new Set(['library-only']);
        // Selecting anything else removes 'library-only'
        next.delete('library-only');
        next.add(value);
      }
      return next;
    });
  }, []);

  const destSummary = useMemo(() => {
    const dests = exportDestinations;
    if (dests.has('library-only')) return 'All Media Only';
    const parts = [];
    if (dests.has('current-niche')) parts.push(category?.name || 'Current Niche');
    if (dests.has('project-pool')) parts.push('Project Pool');
    for (const d of dests) {
      if (d !== 'current-niche' && d !== 'project-pool') {
        const niche = projectNiches.find(n => n.id === d);
        if (niche) parts.push(niche.name);
      }
    }
    return parts.length > 0 ? parts.join(', ') : 'Select destination';
  }, [exportDestinations, category?.name, projectNiches]);

  // Timeline upgrade state
  const [timelineScale, setTimelineScale] = useState(1);
  const [clipResize, setClipResize] = useState({ active: false, clipIndex: -1, edge: null, startX: 0, startStart: 0, startEnd: 0 });
  const [cutLineDrag, setCutLineDrag] = useState(null);
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const [renamingClipId, setRenamingClipId] = useState(null);

  // Auto-detect state
  const [detecting, setDetecting] = useState(false);
  const [detectProgress, setDetectProgress] = useState('');
  const [detectedSections, setDetectedSections] = useState(null);
  const [selectedSections, setSelectedSections] = useState({});

  // ── Refs ──
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const playheadRef = useRef(null);
  const pendingRegionRef = useRef(null);
  const markInRef = useRef(null);
  const activeBankIndexRef = useRef(0);
  const rafRef = useRef(null);
  const wasPlayingRef = useRef(false);
  const timelineRef = useRef(null);
  const pxPerSecRef = useRef(40);
  // Stable session ID: set from existingSession on mount, persists across saves
  const sessionIdRef = useRef(existingSession?.id || null);

  // Keep refs in sync with state
  const setActiveBankIndex = useCallback((val) => {
    activeBankIndexRef.current = val;
    setActiveBankIndexRaw(val);
  }, []);

  // Merge source candidates: explicit sourceVideos prop (from niche) + category.videos fallback
  const availableSourceVideos = useMemo(() => {
    const fromProp = (sourceVideos || []).map(v => ({
      id: v.id,
      url: v.url || v.cloudUrl,
      name: v.name || v.originalName || 'Video',
      thumbnailUrl: v.thumbnailUrl || v.thumbnail || null,
      duration: v.duration || 0,
    })).filter(v => v.url);
    if (fromProp.length > 0) return fromProp;
    // Fallback to category.videos (pipelineCategory)
    return (category?.videos || []).map(v => ({
      id: v.id,
      url: v.url || v.cloudUrl,
      name: v.name || v.originalName || 'Video',
      thumbnailUrl: v.thumbnailUrl || v.thumbnail || null,
      duration: v.duration || 0,
    })).filter(v => v.url);
  }, [sourceVideos, category?.videos]);

  // ── Load existing data ──
  useEffect(() => {
    if (existingSession) {
      // Restore from clipper session
      if (existingSession.clips) {
        setClips(existingSession.clips.map(c => ({
          ...c,
          bankIndex: typeof c.bankIndex === 'number' ? c.bankIndex : 0,
        })));
      }
      if (existingSession.bankLabels?.length) {
        setBankLabels(existingSession.bankLabels);
      }
      if (existingSession.sourceVideoUrl) setSourceUrl(existingSession.sourceVideoUrl);
      if (existingSession.sourceVideoName) setSourceName(existingSession.sourceVideoName);
      if (existingSession.name) setVideoName(existingSession.name);
    } else if (existingVideo?.editorMode === 'clipper') {
      // Backward compat: old draft-based sessions with bucket strings
      if (existingVideo.clips) {
        const oldBuckets = existingVideo.buckets || ['Bucket 1'];
        setClips(existingVideo.clips.map(c => ({
          ...c,
          bankIndex: typeof c.bankIndex === 'number' ? c.bankIndex : Math.max(0, oldBuckets.indexOf(c.bucket || oldBuckets[0])),
        })));
        setBankLabels(oldBuckets);
      }
      if (existingVideo.sourceUrl) setSourceUrl(existingVideo.sourceUrl);
      if (existingVideo.sourceName) setSourceName(existingVideo.sourceName);
    } else if (existingVideo?.clips) {
      setClips(existingVideo.clips.map(c => ({ ...c, bankIndex: typeof c.bankIndex === 'number' ? c.bankIndex : 0 })));
      setSourceUrl(existingVideo.sourceUrl);
      setSourceName(existingVideo.sourceName || '');
    } else if (availableSourceVideos.length > 0) {
      const firstVideo = availableSourceVideos[0];
      setSourceUrl(firstVideo.url);
      setSourceName(firstVideo.name);
    }
  }, [existingSession, existingVideo, availableSourceVideos]);

  // Derive thumbnail + stored duration from available source videos whenever sourceUrl changes
  const durationRef = useRef(duration);
  durationRef.current = duration;
  useEffect(() => {
    if (!sourceUrl) { setSourceThumbnail(null); return; }
    const match = availableSourceVideos.find(v => v.url === sourceUrl);
    setSourceThumbnail(match?.thumbnailUrl || null);
    // Use stored duration immediately so timeline is interactive before video loads
    if (match?.duration > 0 && durationRef.current === 0) {
      setDuration(match.duration);
    }
  }, [sourceUrl, availableSourceVideos]);

  // ── Time display update (throttled via timeupdate ~4x/sec for the badge) ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoReady(false);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => {
      setDuration(video.duration);
      setVideoReady(true);
      // Position playhead at 0 on load
      if (playheadRef.current) playheadRef.current.style.left = '0px';
    };
    const onEnded = () => setIsPlaying(false);
    const onError = () => {
      log.error('Clipper video load error:', video.error?.message || 'unknown', sourceUrl);
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    // If metadata already loaded (race condition), read duration now
    if (video.readyState >= 1 && video.duration) {
      setDuration(video.duration);
      setVideoReady(true);
    }
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
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
        const ppx = pxPerSecRef.current;
        if (playheadRef.current) {
          playheadRef.current.style.left = `${t * ppx}px`;
        }
        const mi = markInRef.current;
        if (pendingRegionRef.current) {
          if (mi !== null) {
            const lo = Math.min(mi, t);
            const hi = Math.max(mi, t);
            pendingRegionRef.current.style.left = `${lo * ppx}px`;
            pendingRegionRef.current.style.width = `${(hi - lo) * ppx}px`;
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
  // Guard against "play() interrupted by pause()" race condition.
  // Always use safePlay/safePause instead of calling video.play()/pause() directly.
  const playPromiseRef = useRef(null);
  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const p = video.play();
    playPromiseRef.current = p;
    if (p) p.catch(() => { playPromiseRef.current = null; setIsPlaying(false); });
    setIsPlaying(true);
  }, []);
  const safePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const pending = playPromiseRef.current;
    if (pending) {
      pending.then(() => { video.pause(); }).catch(() => {});
      playPromiseRef.current = null;
    } else {
      video.pause();
    }
    setIsPlaying(false);
  }, []);
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) safePlay();
    else safePause();
  }, [safePlay, safePause]);

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
    const ppx = pxPerSecRef.current;
    if (playheadRef.current) {
      playheadRef.current.style.left = `${clamped * ppx}px`;
    }
    // Update pending region
    const mi = markInRef.current;
    if (pendingRegionRef.current) {
      if (mi !== null) {
        const lo = Math.min(mi, clamped);
        const hi = Math.max(mi, clamped);
        pendingRegionRef.current.style.left = `${lo * ppx}px`;
        pendingRegionRef.current.style.width = `${(hi - lo) * ppx}px`;
        pendingRegionRef.current.style.display = '';
      } else {
        pendingRegionRef.current.style.display = 'none';
      }
    }
  }, []);

  // ── Pixel timeline + zoom + waveform hooks ──
  const { pxPerSec, timelinePx, rulerTicks, handleRulerMouseDown, downsample } = usePixelTimeline({
    timelineScale, timelineDuration: duration, timelineRef,
    handleSeek: seekTo, isPlaying, setIsPlaying, setPlayheadDragging, wasPlayingRef,
  });
  pxPerSecRef.current = pxPerSec;
  useTimelineZoom(timelineRef, { zoom: timelineScale, setZoom: setTimelineScale, minZoom: 0.3, maxZoom: 3, basePixelsPerSecond: 40 });
  const sourceWaveformClips = useMemo(() =>
    sourceUrl && duration > 0 ? [{ id: 'source', url: sourceUrl, duration, file: sourceFile || undefined }] : [],
    [sourceUrl, duration, sourceFile]
  );
  const { clipWaveforms, clipWaveformsLoading } = useWaveform({
    selectedAudio: null,
    clips: sourceWaveformClips,
    getClipUrl: () => sourceUrl,
  });

  // ── Clip edge resize handler ──
  useEffect(() => {
    if (!clipResize.active) return;
    const handleResizeMove = (e) => {
      const deltaX = e.clientX - clipResize.startX;
      const deltaSec = deltaX / pxPerSecRef.current;
      setClips(prev => {
        const updated = [...prev];
        const clip = updated[clipResize.clipIndex];
        if (!clip) return prev;
        if (clipResize.edge === 'left') {
          let newStart = clipResize.startStart + deltaSec;
          newStart = Math.max(0, newStart);
          const prevClip = updated[clipResize.clipIndex - 1];
          if (prevClip) newStart = Math.max(prevClip.end, newStart);
          if (clip.end - newStart < 0.5) newStart = clip.end - 0.5;
          updated[clipResize.clipIndex] = { ...clip, start: newStart, duration: clip.end - newStart };
        } else {
          let newEnd = clipResize.startEnd + deltaSec;
          newEnd = Math.min(duration, newEnd);
          const nextClip = updated[clipResize.clipIndex + 1];
          if (nextClip) newEnd = Math.min(nextClip.start, newEnd);
          if (newEnd - clip.start < 0.5) newEnd = clip.start + 0.5;
          updated[clipResize.clipIndex] = { ...clip, end: newEnd, duration: newEnd - clip.start };
        }
        return updated;
      });
    };
    const handleResizeEnd = () => {
      setClipResize({ active: false, clipIndex: -1, edge: null, startX: 0, startStart: 0, startEnd: 0 });
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'ew-resize';
    document.addEventListener('pointermove', handleResizeMove);
    document.addEventListener('pointerup', handleResizeEnd);
    document.addEventListener('pointercancel', handleResizeEnd);
    return () => {
      document.removeEventListener('pointermove', handleResizeMove);
      document.removeEventListener('pointerup', handleResizeEnd);
      document.removeEventListener('pointercancel', handleResizeEnd);
      document.body.style.cursor = '';
    };
  }, [clipResize, duration]);

  // ── Cut line drag handler ──
  useEffect(() => {
    if (!cutLineDrag?.active) return;
    const { clipIndex, startX, origPrevEnd } = cutLineDrag;
    const handleCutLineMove = (e) => {
      const deltaX = e.clientX - startX;
      const deltaSec = deltaX / pxPerSecRef.current;
      setClips(prev => {
        const updated = [...prev];
        const prevClip = updated[clipIndex];
        const nextClip = updated[clipIndex + 1];
        if (!prevClip || !nextClip) return prev;
        let newBoundary = origPrevEnd + deltaSec;
        newBoundary = Math.max(prevClip.start + 0.5, newBoundary);
        newBoundary = Math.min(nextClip.end - 0.5, newBoundary);
        updated[clipIndex] = { ...prevClip, end: newBoundary, duration: newBoundary - prevClip.start };
        updated[clipIndex + 1] = { ...nextClip, start: newBoundary, duration: nextClip.end - newBoundary };
        return updated;
      });
    };
    const handleCutLineEnd = () => {
      setCutLineDrag(null);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('pointermove', handleCutLineMove);
    document.addEventListener('pointerup', handleCutLineEnd);
    document.addEventListener('pointercancel', handleCutLineEnd);
    return () => {
      document.removeEventListener('pointermove', handleCutLineMove);
      document.removeEventListener('pointerup', handleCutLineEnd);
      document.removeEventListener('pointercancel', handleCutLineEnd);
      document.body.style.cursor = '';
    };
  }, [cutLineDrag]);

  // ── Ruler drag (playhead scrub via ruler) ──
  useEffect(() => {
    if (!playheadDragging) return;
    const handleMove = (e) => {
      const container = timelineRef.current;
      if (!container) return;
      const d = videoRef.current?.duration;
      if (!d || d <= 0) return;
      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left + container.scrollLeft;
      seekTo(Math.max(0, Math.min(d, clickX / pxPerSecRef.current)));
    };
    const handleUp = () => {
      setPlayheadDragging(false);
      if (wasPlayingRef.current) { safePlay(); }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [playheadDragging, seekTo]);

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
        bankIndex: activeBankIndexRef.current,
        exported: false,
        exportedMediaId: null,
        exportedUrl: null,
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

  const moveClipToBank = useCallback((clipIdx, newBankIndex) => {
    setClips(prev => prev.map((c, i) => i === clipIdx ? { ...c, bankIndex: newBankIndex } : c));
  }, []);

  // ── Bank management ──
  const addBank = useCallback(() => {
    if (bankLabels.length >= 10) return;
    setBankLabels(prev => [...prev, `Bucket ${prev.length + 1}`]);
  }, [bankLabels.length]);

  const removeBank = useCallback((bankIdx) => {
    if (bankLabels.length <= 1) return;
    setBankLabels(prev => prev.filter((_, i) => i !== bankIdx));
    // Re-index clips: clips in removed bank go to bank 0, clips above shift down
    setClips(prev => prev.map(c => {
      if (c.bankIndex === bankIdx) return { ...c, bankIndex: 0 };
      if (c.bankIndex > bankIdx) return { ...c, bankIndex: c.bankIndex - 1 };
      return c;
    }));
    if (activeBankIndex === bankIdx) setActiveBankIndex(0);
    else if (activeBankIndex > bankIdx) setActiveBankIndex(activeBankIndex - 1);
  }, [bankLabels.length, activeBankIndex, setActiveBankIndex]);

  const renameBank = useCallback((bankIdx, newName) => {
    if (!newName.trim()) return;
    setBankLabels(prev => prev.map((b, i) => i === bankIdx ? newName : b));
  }, []);

  const toggleBankCollapse = useCallback((bankIdx) => {
    setCollapsedBanks(prev => ({ ...prev, [bankIdx]: !prev[bankIdx] }));
  }, []);

  // ── Track click-to-seek (pixel-based using timelineRef) ──
  const handleTrackClick = useCallback((e) => {
    const container = timelineRef.current;
    if (!container) return;
    const d = videoRef.current?.duration;
    if (!d || d <= 0) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left + container.scrollLeft;
    seekTo(Math.max(0, Math.min(d, clickX / pxPerSecRef.current)));
    // Deselect active clip when clicking empty space on the timeline
    setActiveClipIdx(null);
  }, [seekTo]);

  // ── Build session data from current state ──
  const buildSessionData = useCallback(() => {
    // Use stable ref so all saves (manual + auto) share the same session ID
    if (!sessionIdRef.current) {
      sessionIdRef.current = `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }
    return {
      id: sessionIdRef.current,
      name: videoName,
      sourceVideoUrl: sourceUrl?.startsWith('blob:') ? null : sourceUrl,
      sourceVideoName: sourceName,
      bankLabels,
      clips: clips.map(c => ({
        id: c.id, name: c.name, start: c.start, end: c.end,
        duration: c.duration, bankIndex: c.bankIndex,
        exported: !!c.exportedMediaId,
        exportedMediaId: c.exportedMediaId || null,
        exportedUrl: c.exportedUrl || null,
      })),
      createdAt: existingSession?.createdAt || new Date().toISOString(),
    };
  }, [existingSession?.createdAt, videoName, sourceUrl, sourceName, bankLabels, clips]);

  // ── Save session (markers only, instant) ──
  const handleSaveSession = useCallback(() => {
    if (!onSaveSession) return;
    const sessionData = buildSessionData();
    onSaveSession(sessionData);
    setSavedClean(true);
    savedClipsSnapshotRef.current = clips.map(c => ({ id: c.id, start: c.start, end: c.end, bankIndex: c.bankIndex }));
    toastSuccess('Session saved');
  }, [onSaveSession, buildSessionData, clips, toastSuccess]);

  // ── Auto-detect song sections ──
  const handleAutoDetect = useCallback(async () => {
    if (!sourceUrl && !sourceFile) {
      toastError('No source video loaded');
      return;
    }
    setDetecting(true);
    setDetectProgress('Extracting audio...');
    setDetectedSections(null);
    setSelectedSections({});
    try {
      // 1. Extract audio (cap at 600s, mono 16kHz to stay under Whisper 25MB limit)
      const audioSource = sourceFile || sourceUrl;
      const capDuration = Math.min(duration || 600, 600);
      const audioFile = await extractAudioSnippet(audioSource, 0, capDuration, { mono: true, targetSampleRate: 16000 });

      // 2. Transcribe via Whisper
      setDetectProgress('Transcribing lyrics...');
      const transcription = await transcribeAudio(audioFile, 'team', (msg) => setDetectProgress(msg));

      // 3. Check for enough words
      if (!transcription.words || transcription.words.length < 5) {
        toastError('No lyrics detected — auto-detect works best with songs that have vocals');
        setDetecting(false);
        setDetectProgress('');
        return;
      }

      // 4. Try to identify the song and fetch published lyrics for better section labels
      let publishedLyrics = null;
      try {
        setDetectProgress('Identifying song...');
        const recognition = await recognizeSong(audioSource);
        if (recognition?.found && recognition.artist && recognition.title) {
          setDetectProgress(`Found: ${recognition.artist} — ${recognition.title}. Fetching lyrics...`);
          const lyricsResult = await fetchSyncedLyrics(recognition.artist, recognition.title);
          if (lyricsResult?.plainLyrics) {
            publishedLyrics = lyricsResult.plainLyrics;
          }
        }
      } catch (e) {
        // Non-fatal — continue without published lyrics
        log.warn('Song recognition/lyrics lookup failed:', e.message);
      }

      // 5. Analyze structure via Claude (with published lyrics if available)
      setDetectProgress(publishedLyrics ? 'Analyzing with published lyrics...' : 'Analyzing song structure...');
      const result = await analyzeSongStructure(transcription, capDuration, (msg) => setDetectProgress(msg), publishedLyrics);

      if (!result.sections || result.sections.length === 0) {
        toastError('Could not identify song sections');
        setDetecting(false);
        setDetectProgress('');
        return;
      }

      // 5. Pre-select all sections
      const selMap = {};
      result.sections.forEach((_, i) => { selMap[i] = true; });
      setDetectedSections(result.sections);
      setSelectedSections(selMap);
      toastSuccess(`Found ${result.sections.length} sections`);
    } catch (err) {
      log.error('Auto-detect failed:', err);
      toastError('Auto-detect failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDetecting(false);
      setDetectProgress('');
    }
  }, [sourceUrl, sourceFile, duration, toastSuccess, toastError]);

  const handleAddDetectedClips = useCallback(() => {
    if (!detectedSections) return;
    const newClips = [];
    detectedSections.forEach((section, i) => {
      if (!selectedSections[i]) return;
      newClips.push({
        id: `clip_${Date.now()}_${i}`,
        name: section.name,
        start: section.startTime,
        end: section.endTime,
        duration: section.endTime - section.startTime,
        bankIndex: activeBankIndexRef.current,
        exportedMediaId: null,
      });
    });
    if (newClips.length === 0) return;
    setClips(prev => {
      const merged = [...prev, ...newClips].sort((a, b) => a.start - b.start);
      return merged;
    });
    toastSuccess(`Added ${newClips.length} clips`);
    setDetectedSections(null);
    setSelectedSections({});
  }, [detectedSections, selectedSections, toastSuccess]);

  const toggleSectionSelect = useCallback((idx) => {
    setSelectedSections(prev => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  const selectedSectionCount = useMemo(() =>
    Object.values(selectedSections).filter(Boolean).length
  , [selectedSections]);

  // ── Export clips to banks (replaces handleExport) ──
  const handleExportToBanks = useCallback(async () => {
    // Use the selection-aware list: if a clip is selected, only that one; otherwise all unexported
    const toExport = activeClipIdx !== null && activeClipIdx >= 0 && activeClipIdx < clips.length
      ? (clips[activeClipIdx] && !clips[activeClipIdx].exportedMediaId ? [clips[activeClipIdx]] : [])
      : clips.filter(c => !c.exportedMediaId);
    if (toExport.length === 0) {
      toastSuccess('All clips already exported');
      return;
    }
    setExporting(true);
    setExportProgress(0);
    setExportedCount(0);

    // Granular progress: each clip has 4 weighted phases (total 100 per clip)
    // Loading source=10%, FFmpeg cut=15%, Upload video=55%, Thumbnail+save=20%
    const total = toExport.length;
    const updateProgress = (clipIdx, phase) => {
      // phase: 0=loading, 1=cutting, 2=uploading(0-100), 3=thumbnail+save, 4=done
      let clipPct;
      if (typeof phase === 'object') {
        // Upload progress: { upload: 0-100 }
        clipPct = 25 + (phase.upload * 0.55);
      } else {
        clipPct = phase === 0 ? 0 : phase === 1 ? 10 : phase === 2 ? 25 : phase === 3 ? 80 : 100;
      }
      const overall = Math.round(((clipIdx + clipPct / 100) / total) * 100);
      setExportProgress(Math.min(overall, 99));
    };

    const results = [];
    try {
      updateProgress(0, 0);
      const ffmpeg = await loadFFmpeg();
      const { fetchFile } = await import('@ffmpeg/util');
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

      for (let i = 0; i < toExport.length; i++) {
        const clip = toExport[i];
        const outputName = `clip_${i}.${ext}`;
        const clipDuration = clip.end - clip.start;

        try {
          // Phase 1: FFmpeg stream-copy extract
          updateProgress(i, 1);
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
          blob.name = `${clip.name || `clip_${i + 1}`}.${ext}`;
          await ffmpeg.deleteFile(outputName);

          // Phase 2: Upload video (main bottleneck — wire progress callback)
          updateProgress(i, 2);
          const { url: cloudUrl } = await uploadFile(blob, 'clips', (pct) => {
            updateProgress(i, { upload: pct });
          });

          // Phase 3: Generate thumbnail + save to library
          updateProgress(i, 3);
          let thumbUrl = cloudUrl;
          try {
            const vidEl = document.createElement('video');
            vidEl.muted = true;
            vidEl.playsInline = true;
            const blobUrl = URL.createObjectURL(blob);
            vidEl.src = blobUrl;
            await new Promise((res, rej) => { vidEl.onloadeddata = res; vidEl.onerror = rej; });
            vidEl.currentTime = 0.1;
            await new Promise(res => { vidEl.onseeked = res; });
            const canvas = document.createElement('canvas');
            canvas.width = vidEl.videoWidth;
            canvas.height = vidEl.videoHeight;
            canvas.getContext('2d').drawImage(vidEl, 0, 0);
            const thumbBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.7));
            thumbBlob.name = `thumb_${clip.name || `clip_${i + 1}`}.jpg`;
            URL.revokeObjectURL(blobUrl);
            const { url: uploadedThumbUrl } = await uploadFile(thumbBlob, 'thumbnails', null);
            thumbUrl = uploadedThumbUrl;
          } catch (thumbErr) {
            log.warn('[Clipper] Failed to generate thumbnail, using video URL:', thumbErr.message);
          }

          // Create a library media item for each exported clip
          const mediaId = `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const mediaItem = {
            id: mediaId,
            type: 'video',
            name: clip.name || `Clip ${i + 1}`,
            url: cloudUrl,
            thumbnailUrl: thumbUrl,
            duration: clip.duration,
            sourceVideoName: sourceName,
            sourceStart: clip.start,
            sourceEnd: clip.end,
            bankIndex: clip.bankIndex,
            isClipperClip: true,
            createdAt: new Date().toISOString(),
          };
          await addToLibraryAsync(db, artistId, mediaItem);

          // Route to all selected destinations
          if (!exportDestinations.has('library-only')) {
            const addedToPool = new Set();
            for (const dest of exportDestinations) {
              if (dest === 'project-pool') {
                if (projectId && !addedToPool.has('pool')) {
                  addToProjectPool(artistId, projectId, [mediaId], db);
                  addedToPool.add('pool');
                }
              } else {
                const targetNicheId = dest === 'current-niche' ? nicheId : dest;
                if (targetNicheId) {
                  addToCollection(artistId, targetNicheId, [mediaId], db);
                }
                if (projectId && !addedToPool.has('pool')) {
                  addToProjectPool(artistId, projectId, [mediaId], db);
                  addedToPool.add('pool');
                }
              }
            }
          }

          results.push({ clipId: clip.id, cloudUrl, mediaId });
        } catch (clipErr) {
          log.error(`[Clipper] Failed to export clip ${clip.name}:`, clipErr);
        }

        setExportedCount(i + 1);
        updateProgress(i, 4);
      }

      await ffmpeg.deleteFile(inputName);
    } catch (err) {
      log.error('[Clipper] Export failed:', err);
      toastError(`Export failed: ${err.message}`);
    } finally {
      // Update clips with exported info (partial success supported)
      if (results.length > 0) {
        setClips(prev => prev.map(c => {
          const result = results.find(r => r.clipId === c.id);
          return result ? { ...c, exportedMediaId: result.mediaId, exportedUrl: result.cloudUrl } : c;
        }));
      }
      setExporting(false);

      // Auto-save session after export (use setTimeout to read updated clips state)
      if (onSaveSession) {
        const exportResults = results;
        setTimeout(() => {
          const sessionData = buildSessionData();
          // Merge export results into the clip data
          sessionData.clips = sessionData.clips.map(c => {
            const result = exportResults.find(r => r.clipId === c.id);
            return result ? { ...c, exported: true, exportedMediaId: result.mediaId, exportedUrl: result.cloudUrl } : c;
          });
          onSaveSession(sessionData);
        }, 0);
      }

      if (results.length > 0) {
        toastSuccess(`Exported ${results.length} clip${results.length !== 1 ? 's' : ''} to banks`);
      }
    }
  }, [clips, activeClipIdx, sourceFile, sourceUrl, sourceName, videoName, bankLabels, buildSessionData, onSaveSession, toastSuccess, toastError, artistId, db, nicheId, projectId, exportDestinations]);

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

  const clipsByBank = useMemo(() => {
    const map = {};
    for (let bIdx = 0; bIdx < bankLabels.length; bIdx++) map[bIdx] = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const bankIdx = typeof c.bankIndex === 'number' ? c.bankIndex : 0;
      if (!map[bankIdx]) map[bankIdx] = [];
      map[bankIdx].push({ ...c, _idx: i });
    }
    return map;
  }, [clips, bankLabels]);

  // Selection-aware export: if a clip is selected, export only that one; otherwise all unexported
  const clipsToExport = useMemo(() => {
    if (activeClipIdx !== null && activeClipIdx >= 0 && activeClipIdx < clips.length) {
      const selected = clips[activeClipIdx];
      return selected && !selected.exportedMediaId ? [selected] : [];
    }
    return clips.filter(c => !c.exportedMediaId);
  }, [clips, activeClipIdx]);
  const unexportedCount = clipsToExport.length;

  // ── Unsaved changes guard (beforeunload + back button) ──
  const [savedClean, setSavedClean] = useState(false);
  const savedClipsSnapshotRef = useRef(null);
  // Compare current clips to last saved snapshot to detect new edits after save
  const hasNewEditsAfterSave = useMemo(() => {
    if (!savedClean || !savedClipsSnapshotRef.current) return false;
    const snapshot = savedClipsSnapshotRef.current;
    if (snapshot.length !== clips.length) return true;
    return snapshot.some((sc, i) => {
      const c = clips[i];
      return !c || sc.id !== c.id || sc.start !== c.start || sc.end !== c.end || sc.bankIndex !== c.bankIndex;
    });
  }, [savedClean, clips]);
  const hasUnsavedWork = (clips.length > 0 || !!sourceUrl) && (!savedClean || hasNewEditsAfterSave);
  const { confirmLeave } = useUnsavedChanges(hasUnsavedWork);

  const handleCloseRequest = useCallback(() => {
    if (!confirmLeave()) return;
    onClose();
  }, [confirmLeave, onClose]);

  // ── Render ──
  return (
    <EditorShell onBackdropClick={handleCloseRequest} isMobile={isMobile}>
      <EditorTopBar
        title={videoName}
        onTitleChange={setVideoName}
        placeholder="Untitled Clip"
        onBack={handleCloseRequest}
        isMobile={isMobile}
        onSave={handleSaveSession}
        saveLabel="Save Session"
        onExport={handleExportToBanks}
        exportDisabled={unexportedCount === 0 || exporting}
        exportLoading={exporting}
        exportLabel={exporting ? `Exporting… ${exportProgress}%` : `Export ${unexportedCount} to Banks`}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel: Video + Timeline ── */}
        <div className={`flex flex-col flex-1 min-w-0 bg-black ${isMobile ? '' : 'border-r border-neutral-200'}`}>
          {!hasSource ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-neutral-100/50 border border-neutral-200">
                <FeatherScissors className="text-neutral-500" style={{ width: 32, height: 32 }} />
              </div>
              <span className="text-heading-3 font-heading-3 text-white">Select a source video</span>
              <span className="text-body font-body text-neutral-400 text-center max-w-sm">
                Choose a video to split into multiple clips using stream-copy (instant, no quality loss)
              </span>

              {/* Niche source video selector grid */}
              {availableSourceVideos.length > 0 && (
                <div className="flex flex-col gap-2 w-full max-w-lg">
                  <span className="text-caption-bold font-caption-bold text-neutral-400">Source Videos</span>
                  <div className="grid grid-cols-3 gap-2">
                    {availableSourceVideos.map(v => (
                      <div
                        key={v.id}
                        className="relative group rounded-lg overflow-hidden bg-neutral-100 aspect-video cursor-pointer border border-neutral-200 hover:border-indigo-500/50 transition-colors"
                        onClick={() => {
                          setSourceUrl(v.url);
                          setSourceName(v.name);
                          setClips([]);
                          markInRef.current = null;
                          setMarkIn(null);
                        }}
                      >
                        {v.thumbnailUrl ? (
                          <img src={v.thumbnailUrl} alt={v.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <FeatherPlay className="text-neutral-500" style={{ width: 24, height: 24 }} />
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 px-2 py-1">
                          <span className="text-[11px] text-neutral-300 line-clamp-1">{v.name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button variant="brand-primary" size="medium" icon={<FeatherUpload />} onClick={() => fileInputRef.current?.click()}>
                  Upload Video
                </Button>
              </div>
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
            </div>
          ) : (
            <>
              {/* Video player */}
              <div className="flex flex-1 items-center justify-center bg-black min-h-0 p-4 relative">
                {!videoReady && sourceThumbnail && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <img src={sourceThumbnail} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/60 rounded-full px-3 py-1">
                      <div className="h-3 w-3 animate-spin rounded-full border border-white/60 border-t-transparent" />
                      <span className="text-[11px] text-white/70">Loading video...</span>
                    </div>
                  </div>
                )}
                {!videoReady && !sourceThumbnail && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                    <span className="text-caption font-caption text-neutral-400">Loading video...</span>
                  </div>
                )}
                <video
                  ref={videoRef}
                  src={sourceUrl}
                  crossOrigin="anonymous"
                  preload="auto"
                  className={`max-w-full max-h-full rounded-lg ${!videoReady ? 'opacity-0' : 'opacity-100'}`}
                  onClick={togglePlay}
                  playsInline
                />
              </div>

              {/* Timeline section */}
              <div className="flex flex-col gap-2 px-4 pb-3 border-t border-neutral-200 pt-3">
                {/* Header row */}
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-heading-3 font-heading-3 text-white">Timeline</span>
                    <Badge variant="neutral">{formatTimePrecise(currentTime)} / {formatTime(duration)}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Target bank for new clips */}
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getBankColor(activeBankIndex).primary }} />
                      <select
                        className="bg-neutral-100 text-caption font-caption text-neutral-300 border border-neutral-200 rounded px-2 py-1 cursor-pointer outline-none"
                        value={activeBankIndex}
                        onChange={e => setActiveBankIndex(Number(e.target.value))}
                      >
                        {bankLabels.map((label, i) => <option key={i} value={i}>{label}</option>)}
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
                    {/* Zoom slider */}
                    <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-neutral-200">
                      <FeatherZoomOut style={{ width: 12, height: 12, color: '#737373' }} />
                      <input
                        type="range"
                        min="0.3"
                        max="3"
                        step="0.05"
                        value={timelineScale}
                        onChange={e => setTimelineScale(parseFloat(e.target.value))}
                        style={{ width: '80px', height: '4px', accentColor: '#6366f1', cursor: 'pointer' }}
                        title={`Zoom: ${Math.round(timelineScale * 100)}%`}
                      />
                      <FeatherZoomIn style={{ width: 12, height: 12, color: '#737373' }} />
                    </div>
                  </div>
                </div>

                {/* Multi-track timeline — pixel-based with zoom */}
                <div className="flex items-start">
                  {/* Labels column */}
                  <div className="flex flex-col shrink-0 w-14">
                    <div className="h-6 flex items-center justify-end pr-2">
                      <span className="text-[10px] text-neutral-600">Time</span>
                    </div>
                    <div className="h-10 flex items-center justify-end pr-2">
                      <span className="text-caption font-caption text-neutral-500">Clips</span>
                    </div>
                    <div className="h-7 flex items-center justify-end pr-2">
                      <span className="text-caption font-caption text-neutral-500">Source</span>
                    </div>
                    <div className="h-8 flex items-center justify-end pr-2">
                      <span className="text-caption font-caption text-neutral-500">Audio</span>
                    </div>
                  </div>

                  {/* Scrollable timeline */}
                  <div
                    ref={timelineRef}
                    className="flex-1 overflow-x-auto relative"
                    style={{ userSelect: 'none' }}
                  >
                    <div style={{ width: `${Math.max(timelinePx, 1)}px`, position: 'relative', minWidth: '100%' }}>
                      {/* Ruler track */}
                      <div
                        className="h-6 relative border-b border-neutral-200/50"
                        onMouseDown={handleRulerMouseDown}
                        style={{ cursor: 'pointer' }}
                      >
                        {rulerTicks.map((tick, i) => (
                          <div key={i} style={{
                            position: 'absolute', left: `${tick.time * pxPerSec}px`,
                            top: tick.isLabel ? 0 : '50%', bottom: 0,
                            width: '1px', backgroundColor: tick.isLabel ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
                          }}>
                            {tick.isLabel && (
                              <span style={{
                                position: 'absolute', left: '4px', top: '0px',
                                fontSize: '9px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap',
                              }}>
                                {formatTime(tick.time)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Clips track */}
                      <div
                        className="h-10 relative border-b border-neutral-200/30"
                        onClick={(e) => { if (e.target === e.currentTarget) handleTrackClick(e); }}
                      >
                        {clips.map((clip, i) => {
                          const leftPx = clip.start * pxPerSec;
                          const widthPx = (clip.end - clip.start) * pxPerSec;
                          const isActive = activeClipIdx === i;
                          const bankIdx = typeof clip.bankIndex === 'number' ? clip.bankIndex : 0;
                          const bankColor = getBankColor(bankIdx);
                          const isExported = !!clip.exportedMediaId;
                          const isRenaming = renamingClipId === clip.id;
                          return (
                            <div
                              key={clip.id}
                              style={{
                                position: 'absolute',
                                left: `${leftPx}px`,
                                width: `${Math.max(widthPx, 8)}px`,
                                top: '2px',
                                bottom: '2px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                backgroundColor: isActive ? `${bankColor.primary}66` : `${bankColor.primary}33`,
                                border: `2px solid ${isActive ? bankColor.primary : `${bankColor.primary}66`}`,
                                display: 'flex',
                                alignItems: 'center',
                                overflow: 'hidden',
                                zIndex: isActive ? 10 : 5,
                                boxShadow: isActive ? `0 0 8px ${bankColor.primary}66` : 'none',
                              }}
                              onClick={(e) => { e.stopPropagation(); setActiveClipIdx(i); jumpToClip(clip); }}
                              onDoubleClick={(e) => { e.stopPropagation(); setRenamingClipId(clip.id); }}
                            >
                              {/* Left resize handle */}
                              <div
                                style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize', zIndex: 2 }}
                                onPointerDown={(e) => {
                                  e.stopPropagation(); e.preventDefault();
                                  setClipResize({ active: true, clipIndex: i, edge: 'left', startX: e.clientX, startStart: clip.start, startEnd: clip.end });
                                }}
                              />
                              {/* Clip content */}
                              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '2px', padding: '0 8px' }}>
                                {isExported && (
                                  <FeatherCheck style={{ width: 8, height: 8, color: '#22c55e', flexShrink: 0 }} />
                                )}
                                {isRenaming ? (
                                  <input
                                    autoFocus
                                    className="bg-transparent text-[10px] font-semibold text-white outline-none w-full"
                                    value={clip.name}
                                    onChange={(e2) => renameClip(i, e2.target.value)}
                                    onBlur={() => setRenamingClipId(null)}
                                    onKeyDown={(e2) => { if (e2.key === 'Enter' || e2.key === 'Escape') setRenamingClipId(null); }}
                                    onClick={(e2) => e2.stopPropagation()}
                                  />
                                ) : (
                                  <span style={{
                                    fontSize: '10px', fontWeight: 600, color: '#fff',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                                  }}>
                                    {clip.name}
                                  </span>
                                )}
                              </div>
                              {/* Right resize handle */}
                              <div
                                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize', zIndex: 2 }}
                                onPointerDown={(e) => {
                                  e.stopPropagation(); e.preventDefault();
                                  setClipResize({ active: true, clipIndex: i, edge: 'right', startX: e.clientX, startStart: clip.start, startEnd: clip.end });
                                }}
                              />
                            </div>
                          );
                        })}

                        {/* Mark-in pending region (rAF-updated via ref) */}
                        <div
                          ref={pendingRegionRef}
                          style={{
                            position: 'absolute', left: '0px', width: '0px', top: 0, bottom: 0,
                            backgroundColor: 'rgba(34, 197, 94, 0.15)',
                            borderLeft: '2px solid #22c55e',
                            borderRight: '2px solid rgba(34, 197, 94, 0.5)',
                            zIndex: 3, pointerEvents: 'none', display: 'none',
                          }}
                        />

                        {/* Mark-in line (static position) */}
                        {markIn !== null && duration > 0 && (
                          <div style={{
                            position: 'absolute', left: `${markIn * pxPerSec}px`,
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
                      <div
                        className="h-7 relative border-b border-neutral-200/30"
                        onClick={(e) => { if (e.target === e.currentTarget) handleTrackClick(e); }}
                      >
                        <div style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: `${duration * pxPerSec}px`,
                          background: 'linear-gradient(90deg, rgba(99,102,241,0.06) 0%, rgba(99,102,241,0.02) 100%)',
                          borderRadius: '4px',
                        }} />
                        <span style={{
                          position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                          fontSize: '10px', color: 'rgba(255,255,255,0.35)', pointerEvents: 'none',
                        }}>
                          {sourceName || 'No source'}
                        </span>
                      </div>

                      {/* Audio waveform track */}
                      <div
                        className="h-8 relative"
                        onClick={(e) => { if (e.target === e.currentTarget) handleTrackClick(e); }}
                      >
                        {(() => {
                          const wfData = clipWaveforms?.source || [];
                          if (wfData.length === 0) {
                            return (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none gap-1.5">
                                {clipWaveformsLoading ? (
                                  <>
                                    <div className="h-3 w-3 animate-spin rounded-full border border-indigo-500 border-t-transparent" />
                                    <span className="text-[10px] text-indigo-400">Loading waveform...</span>
                                  </>
                                ) : (
                                  <span className="text-[10px] text-neutral-600">No audio</span>
                                )}
                              </div>
                            );
                          }
                          const audioPx = duration * pxPerSec;
                          const maxBars = Math.max(50, Math.round(audioPx / 3));
                          const bars = downsample(wfData, maxBars);
                          return (
                            <div style={{ width: `${audioPx}px`, height: '100%', display: 'flex', alignItems: 'flex-end', padding: '0 1px 2px' }}>
                              {bars.map((val, j) => (
                                <div
                                  key={j}
                                  style={{
                                    flex: 1,
                                    minWidth: '1px',
                                    height: `${Math.max(1, val * 24)}px`,
                                    backgroundColor: 'rgba(99,102,241,0.5)',
                                    borderRadius: '1px',
                                    pointerEvents: 'none',
                                  }}
                                />
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Cut lines — between adjacent clips (within 1s gap) */}
                      {clips.length > 1 && clips.map((clip, i) => {
                        if (i >= clips.length - 1) return null;
                        const next = clips[i + 1];
                        const gap = next.start - clip.end;
                        if (gap < -0.5 || gap > 1.0) return null; // skip if overlapping >0.5s or gap >1s
                        const boundary = gap <= 0 ? clip.end : (clip.end + next.start) / 2; // midpoint for small gaps
                        return (
                          <div key={`cut-${i}`}>
                            <div style={{
                              position: 'absolute', top: '24px', bottom: 0,
                              left: `${boundary * pxPerSec}px`, width: '2px',
                              backgroundColor: 'rgba(255,255,255,0.5)',
                              zIndex: 12, pointerEvents: 'none',
                            }} />
                            <div
                              style={{
                                position: 'absolute', top: '24px', bottom: 0,
                                left: `${boundary * pxPerSec - 6}px`, width: '12px',
                                cursor: 'col-resize', zIndex: 13,
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation(); e.preventDefault();
                                setCutLineDrag({
                                  active: true, clipIndex: i, startX: e.clientX,
                                  origPrevEnd: clip.end,
                                });
                              }}
                            />
                          </div>
                        );
                      })}

                      {/* Playhead (rAF-positioned via ref — pixel-based) */}
                      {duration > 0 && (
                        <div
                          ref={playheadRef}
                          style={{
                            position: 'absolute', left: '0px', top: 0, bottom: 0,
                            width: '2px', backgroundColor: '#ef4444',
                            zIndex: 20, pointerEvents: 'auto', cursor: 'ew-resize',
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            document.body.style.userSelect = 'none';
                            const wasPlaying = isPlaying;
                            if (isPlaying) { safePause(); }
                            const handleDragMove = (moveE) => {
                              const container = timelineRef.current;
                              if (!container) return;
                              const d = videoRef.current?.duration;
                              if (!d || d <= 0) return;
                              const rect = container.getBoundingClientRect();
                              const clickX = moveE.clientX - rect.left + container.scrollLeft;
                              seekTo(Math.max(0, Math.min(d, clickX / pxPerSecRef.current)));
                            };
                            const handleDragEnd = () => {
                              document.body.style.userSelect = '';
                              window.removeEventListener('mousemove', handleDragMove);
                              window.removeEventListener('mouseup', handleDragEnd);
                              window.removeEventListener('pointercancel', handleDragEnd);
                              if (wasPlaying) { safePlay(); }
                            };
                            window.addEventListener('mousemove', handleDragMove);
                            window.addEventListener('mouseup', handleDragEnd);
                            window.addEventListener('pointercancel', handleDragEnd);
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

        {/* ── Right panel: Clip list with banks ── */}
        {!isMobile && (
          <div className="flex flex-col w-[300px] bg-[#0a0a0f] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
              <div className="flex items-center gap-2">
                <span className="text-body-bold font-body-bold text-white">Clips</span>
                <Badge variant="neutral">{clips.length}</Badge>
                {hasSource && clips.length > 0 && (
                  <IconButton
                    variant="neutral-tertiary" size="small"
                    icon={<FeatherZap />}
                    aria-label="Auto-detect sections"
                    onClick={handleAutoDetect}
                    disabled={detecting}
                  />
                )}
              </div>
              {hasSource && (
                <Button variant="neutral-secondary" size="small" icon={<FeatherUpload />} onClick={() => fileInputRef.current?.click()}>
                  Change Source
                </Button>
              )}
            </div>

            {/* Source info + niche video switcher */}
            {hasSource && (
              <div className="flex flex-col border-b border-neutral-200">
                <div className="flex items-center gap-2 px-4 py-2 bg-neutral-50/50">
                  <FeatherPlay className="text-neutral-500 flex-none" style={{ width: 12, height: 12 }} />
                  <span className="text-caption font-caption text-neutral-400 truncate">{sourceName}</span>
                  <span className="text-caption font-caption text-neutral-600 flex-none">{formatTime(duration)}</span>
                </div>
                {availableSourceVideos.length > 1 && (
                  <div className="flex gap-1 px-3 py-2 overflow-x-auto">
                    {availableSourceVideos.map(v => {
                      const isActive = sourceUrl === v.url;
                      return (
                        <div
                          key={v.id}
                          className={`relative flex-none w-14 h-10 rounded overflow-hidden cursor-pointer border transition-colors ${
                            isActive ? 'border-indigo-500' : 'border-neutral-200 hover:border-neutral-500'
                          }`}
                          title={v.name}
                          onClick={() => {
                            if (isActive) return;
                            setSourceUrl(v.url);
                            setSourceName(v.name);
                            setClips([]);
                            markInRef.current = null;
                            setMarkIn(null);
                          }}
                        >
                          {v.thumbnailUrl ? (
                            <img src={v.thumbnailUrl} alt={v.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-neutral-100">
                              <FeatherPlay className="text-neutral-600" style={{ width: 10, height: 10 }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Clip list — grouped by bank */}
            {/* Auto-detect loading state */}
            {detecting && (
              <div className="flex flex-col items-center justify-center px-4 py-6 gap-3">
                <FeatherLoader className="text-indigo-400 animate-spin" style={{ width: 24, height: 24 }} />
                <span className="text-caption font-caption text-neutral-400 text-center">{detectProgress || 'Detecting...'}</span>
              </div>
            )}

            {/* Detected sections panel */}
            {!detecting && detectedSections && detectedSections.length > 0 && (
              <div className="flex flex-col border-b border-neutral-200">
                <div className="flex items-center justify-between px-3 py-2 bg-indigo-500/10">
                  <span className="text-caption-bold font-caption-bold text-indigo-400">Detected Sections</span>
                  <div className="flex items-center gap-1">
                    <button
                      className="text-[10px] text-neutral-400 hover:text-white px-1"
                      onClick={() => {
                        const allSelected = selectedSectionCount === detectedSections.length;
                        const next = {};
                        if (!allSelected) detectedSections.forEach((_, i) => { next[i] = true; });
                        setSelectedSections(next);
                      }}
                    >
                      {selectedSectionCount === detectedSections.length ? 'Deselect All' : 'Select All'}
                    </button>
                    <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />} aria-label="Dismiss" onClick={() => { setDetectedSections(null); setSelectedSections({}); }} />
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 px-2 py-2 max-h-[240px] overflow-y-auto">
                  {detectedSections.map((section, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                        selectedSections[i] ? 'bg-indigo-500/15' : 'hover:bg-neutral-100/50'
                      }`}
                      onClick={() => toggleSectionSelect(i)}
                    >
                      <div className={`w-4 h-4 rounded border flex-none flex items-center justify-center ${
                        selectedSections[i] ? 'bg-indigo-500 border-indigo-500' : 'border-neutral-300'
                      }`}>
                        {selectedSections[i] && <FeatherCheck className="text-white" style={{ width: 10, height: 10 }} />}
                      </div>
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white font-medium truncate">{section.name}</span>
                          <Badge variant="neutral">{section.type}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-neutral-500">
                            {formatTime(section.startTime)} → {formatTime(section.endTime)}
                          </span>
                          {section.lyricSnippet && (
                            <span className="text-[10px] text-neutral-600 truncate italic">"{section.lyricSnippet}"</span>
                          )}
                        </div>
                      </div>
                      <IconButton
                        variant="neutral-tertiary" size="small"
                        icon={<FeatherPlay />}
                        aria-label="Seek to section"
                        onClick={(e) => { e.stopPropagation(); seekTo(section.startTime); }}
                      />
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 border-t border-neutral-200/50">
                  <Button
                    variant="brand-primary" size="small"
                    icon={<FeatherPlus />}
                    disabled={selectedSectionCount === 0}
                    onClick={handleAddDetectedClips}
                  >
                    {selectedSectionCount > 0 ? `Add ${selectedSectionCount} as Clips` : 'Select sections'}
                  </Button>
                </div>
              </div>
            )}

            {clips.length === 0 && !detecting ? (
              <div className="flex flex-1 flex-col items-center justify-center px-4 gap-3">
                <FeatherScissors className="text-neutral-700" style={{ width: 24, height: 24 }} />
                <span className="text-caption font-caption text-neutral-500 text-center">
                  {hasSource ? 'Use I/O keys or the Mark In/Out button to define clip segments' : 'Select a source video first'}
                </span>
                {hasSource && !detectedSections && (
                  <Button
                    variant="neutral-secondary" size="small"
                    icon={<FeatherZap />}
                    onClick={handleAutoDetect}
                  >
                    Auto-Detect Sections
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col flex-1">
                {bankLabels.map((bankLabel, bIdx) => {
                  const bankClips = clipsByBank[bIdx] || [];
                  const bankColor = getBankColor(bIdx);
                  const isCollapsed = collapsedBanks[bIdx];
                  return (
                    <div key={bIdx} className="flex flex-col">
                      {/* Bank header */}
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-100/50 border-b border-neutral-200/50"
                        onClick={() => toggleBankCollapse(bIdx)}
                      >
                        {isCollapsed
                          ? <FeatherChevronRight className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
                          : <FeatherChevronDown className="text-neutral-500 flex-none" style={{ width: 14, height: 14 }} />
                        }
                        <div className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: bankColor.primary }} />
                        <input
                          className="bg-transparent text-caption-bold font-caption-bold text-neutral-300 outline-none flex-1 min-w-0"
                          value={bankLabel}
                          onChange={(e) => renameBank(bIdx, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Badge variant="neutral">{bankClips.length}</Badge>
                        {bankLabels.length > 1 && (
                          <IconButton
                            variant="neutral-tertiary" size="small"
                            icon={<FeatherTrash2 />}
                            aria-label="Delete bank"
                            onClick={(e) => { e.stopPropagation(); removeBank(bIdx); }}
                          />
                        )}
                      </div>

                      {/* Clips in this bank */}
                      {!isCollapsed && (
                        <div className="flex flex-col gap-1 p-2">
                          {bankClips.map((clip) => {
                            const isActive = activeClipIdx === clip._idx;
                            const isExported = !!clip.exportedMediaId;
                            return (
                              <div
                                key={clip.id}
                                className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                                  isActive
                                    ? 'border border-solid'
                                    : 'bg-neutral-100/40 border border-transparent hover:bg-neutral-100/70'
                                }`}
                                style={isActive ? { backgroundColor: `${bankColor.primary}66`, borderColor: bankColor.primary } : {}}
                                onClick={() => { setActiveClipIdx(clip._idx); jumpToClip(clip); }}
                              >
                                {/* Exported indicator */}
                                {isExported && (
                                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 flex-none">
                                    <FeatherCheck className="text-green-400" style={{ width: 10, height: 10 }} />
                                  </div>
                                )}
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
                                    <Badge variant="neutral">{formatTimePrecise(clip.duration)}</Badge>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  {bankLabels.length > 1 && (
                                    <select
                                      className="bg-neutral-100 text-[10px] text-neutral-400 border border-neutral-200 rounded px-1 py-0.5 cursor-pointer outline-none w-14"
                                      value={clip.bankIndex}
                                      onChange={(e) => { e.stopPropagation(); moveClipToBank(clip._idx, Number(e.target.value)); }}
                                      onClick={(e) => e.stopPropagation()}
                                      title="Move to bank"
                                    >
                                      {bankLabels.map((bl, bi) => <option key={bi} value={bi}>{bl}</option>)}
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

                {/* Add bank button */}
                {bankLabels.length < 10 && (
                  <div className="px-3 py-2">
                    <Button variant="neutral-tertiary" size="small" icon={<FeatherPlus />} onClick={addBank}>
                      Add Bank
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Export section */}
            {clips.length > 0 && (
              <div className="flex flex-col gap-2 mt-auto p-4 border-t border-neutral-200">
                {exporting && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-caption text-neutral-400">Exporting {exportedCount}/{unexportedCount}...</span>
                      <span className="text-caption font-caption text-neutral-500">{exportProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-neutral-100">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${exportProgress}%` }} />
                    </div>
                  </div>
                )}
                {/* Destination picker (multi-select) */}
                <div className="relative">
                  <span className="text-caption font-caption text-neutral-500 mb-1 block">Destinations</span>
                  <button
                    className="flex w-full items-center gap-2 rounded-md border border-solid border-neutral-200 bg-[#1a1a1aff] px-3 py-2 hover:bg-[#262626] transition text-left"
                    onClick={() => setDestPickerOpen(!destPickerOpen)}
                  >
                    <span className="text-caption font-caption text-white truncate grow">
                      {destSummary}
                    </span>
                    <FeatherChevronDown
                      className="text-neutral-400 flex-none transition-transform"
                      style={{ width: 14, height: 14, transform: destPickerOpen ? 'rotate(180deg)' : 'none' }}
                    />
                  </button>
                  {destPickerOpen && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 flex flex-col gap-0.5 px-2 py-2 bg-[#111111] border border-neutral-200 rounded-lg max-h-48 overflow-y-auto shadow-xl z-20">
                      {[
                        { value: 'current-niche', label: `Current Niche${category?.name ? ` — ${category.name}` : ''}` },
                        { value: 'project-pool', label: 'Project Pool' },
                        { value: 'library-only', label: 'All Media Only' },
                        ...projectNiches.filter(n => n.id !== nicheId).map(n => ({ value: n.id, label: n.name })),
                      ].map(opt => {
                        const isSelected = exportDestinations.has(opt.value);
                        return (
                          <button
                            key={opt.value}
                            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                              isSelected ? 'bg-indigo-500/15' : 'hover:bg-neutral-100'
                            }`}
                            onClick={() => toggleDestination(opt.value)}
                          >
                            <div className={`w-3.5 h-3.5 rounded border flex-none flex items-center justify-center ${
                              isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-neutral-300'
                            }`}>
                              {isSelected && <FeatherCheck className="text-white" style={{ width: 8, height: 8 }} />}
                            </div>
                            <span className="text-caption font-caption text-white truncate grow">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <Button
                  variant="brand-primary" size="medium"
                  icon={exporting ? undefined : <FeatherDownload />}
                  disabled={unexportedCount === 0 || exporting} loading={exporting}
                  onClick={handleExportToBanks}
                >
                  {exporting
                    ? `Exporting… ${exportProgress}%`
                    : unexportedCount > 0
                      ? `Export ${unexportedCount} → ${destSummary}`
                      : 'All Exported'}
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
        <div className="flex flex-col gap-1 px-3 py-2 border-t border-neutral-200 bg-[#0a0a0f] max-h-[200px] overflow-y-auto">
          {clips.map((clip, i) => {
            const isExported = !!clip.exportedMediaId;
            return (
              <div key={clip.id} className="flex items-center gap-2 rounded-lg px-3 py-2 bg-neutral-100/50">
                <div className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: getBankColor(typeof clip.bankIndex === 'number' ? clip.bankIndex : 0).primary }} />
                {isExported && <FeatherCheck className="text-green-400 flex-none" style={{ width: 10, height: 10 }} />}
                <span className="text-sm text-white flex-1 truncate">{clip.name}</span>
                <span className="text-[11px] text-neutral-500">{formatTimePrecise(clip.start)}→{formatTimePrecise(clip.end)}</span>
                <IconButton variant="neutral-tertiary" size="small" icon={<FeatherTrash2 />} aria-label="Remove" onClick={() => removeClip(i)} />
              </div>
            );
          })}
          {/* Mobile export button */}
          <Button
            variant="brand-primary" size="medium"
            icon={<FeatherDownload />}
            disabled={unexportedCount === 0 || exporting} loading={exporting}
            onClick={handleExportToBanks}
          >
            {unexportedCount > 0 ? `Export ${unexportedCount} → ${destSummary}` : 'All Exported'}
          </Button>
        </div>
      )}

      <EditorFooter onCancel={onClose} onSaveAll={handleSaveSession} saveLabel="Save Session" />
    </EditorShell>
  );
};

export default ClipperEditor;
