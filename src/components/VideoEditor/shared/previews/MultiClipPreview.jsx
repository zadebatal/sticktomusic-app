/**
 * MultiClipPreview — Sequential clip playback with transitions.
 * Each clip gets equal time, transitions: cut, fade, slide, zoom.
 */
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import usePreviewPlayback from '../usePreviewPlayback';
import PreviewTransport from './PreviewTransport';
import DraggableTextOverlay from './DraggableTextOverlay';

const ASPECT_CSS = { '9:16': '9/16', '16:9': '16/9', '1:1': '1/1', '4:5': '4/5' };
const TRANSITION_DURATION = 0.3;

const MultiClipPreview = ({
  media = [],
  audioUrl,
  textBankA = [],
  textBankB = [],
  textStyle = {},
  textPosition = 'center',
  transition = 'cut',
  aspectRatio = '9:16',
}) => {
  const [playlist, setPlaylist] = useState(() => [...media]);

  // Sync playlist when media changes
  useEffect(() => { setPlaylist([...media]); }, [media]);

  const totalDuration = useMemo(() => {
    const sum = playlist.reduce((acc, m) => acc + (m.duration || 0), 0);
    return sum > 0 ? sum : Math.max(playlist.length * 3, 10);
  }, [playlist]);

  const containerRef = useRef(null);
  const { audioRef, currentTime, isPlaying, progress, toggle, seek } = usePreviewPlayback({
    audioUrl,
    duration: totalDuration,
  });
  // Independent position state per text overlay
  const textPosY = textPosition === 'top' ? 15 : textPosition === 'bottom' ? 85 : 50;
  const [textPosA, setTextPosA] = useState({ x: 50, y: Math.max(textPosY - 10, 10), width: 80 });
  const [textPosB, setTextPosB] = useState({ x: 50, y: Math.min(textPosY + 10, 90), width: 80 });

  // Text timing — start/end in seconds
  const [textTimingA, setTextTimingA] = useState({ start: 0, end: totalDuration });
  const [textTimingB, setTextTimingB] = useState({ start: 0, end: totalDuration });

  // Compute segment boundaries
  const segments = useMemo(() => {
    if (!playlist.length) return [];
    const hasDurations = playlist.some(m => m.duration > 0);
    if (hasDurations) {
      let t = 0;
      return playlist.map(m => {
        const dur = m.duration || (totalDuration / playlist.length);
        const seg = { start: t, end: t + dur, item: m };
        t += dur;
        return seg;
      });
    }
    const segDur = totalDuration / playlist.length;
    return playlist.map((m, i) => ({
      start: i * segDur,
      end: (i + 1) * segDur,
      item: m,
    }));
  }, [playlist, totalDuration]);

  // Find active segment
  const activeSegIdx = useMemo(() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (currentTime >= segments[i].start) return i;
    }
    return 0;
  }, [currentTime, segments]);

  const nextSegIdx = (activeSegIdx + 1) % segments.length;
  const seg = segments[activeSegIdx];
  const nextSeg = segments[nextSegIdx];

  // Transition progress
  const transProgress = useMemo(() => {
    if (!seg || transition === 'cut') return 0;
    const timeLeft = seg.end - currentTime;
    if (timeLeft > TRANSITION_DURATION) return 0;
    return 1 - (timeLeft / TRANSITION_DURATION);
  }, [seg, currentTime, transition]);

  // Text per segment
  const textA = textBankA.length > 0 ? textBankA[activeSegIdx % textBankA.length] : '';
  const textB = textBankB.length > 0 ? textBankB[activeSegIdx % textBankB.length] : '';

  const videoRefs = useRef({});

  // Sync active video
  useEffect(() => {
    if (!seg?.item || seg.item.type !== 'video') return;
    const vid = videoRefs.current[seg.item.id];
    if (vid && isPlaying) {
      const localTime = (currentTime - seg.start) + (seg.item.trimStart || 0);
      if (Math.abs(vid.currentTime - localTime) > 1) vid.currentTime = localTime;
      vid.play().catch(() => {});
    }
  }, [activeSegIdx, isPlaying, seg, currentTime]);

  // Pause all videos when not playing
  useEffect(() => {
    if (!isPlaying) {
      Object.values(videoRefs.current).forEach(vid => { if (vid) vid.pause(); });
    }
  }, [isPlaying]);

  // Reroll — swap the clip under the playhead
  const handleReroll = useCallback(() => {
    if (media.length < 2) return;
    setPlaylist(prev => {
      const playheadIdx = prev.length > 0 ? Math.min(Math.floor(progress * prev.length), prev.length - 1) : 0;
      if (playheadIdx < 0) return prev;
      const next = prev.slice(0, media.length);
      const current = next[playheadIdx];
      const candidates = media.filter(m => m.id !== current?.id);
      if (candidates.length === 0) return prev;
      next[playheadIdx] = candidates[Math.floor(Math.random() * candidates.length)];
      return next;
    });
  }, [media, progress]);

  // Jump to segment from timeline cell
  const handleCellClick = useCallback((idx) => {
    if (segments[idx]) seek(segments[idx].start);
  }, [segments, seek]);

  // Text track timing change
  const handleTextTrackChange = useCallback((trackId, changes) => {
    if (trackId === 'textA') setTextTimingA(prev => ({ ...prev, ...changes }));
    if (trackId === 'textB') setTextTimingB(prev => ({ ...prev, ...changes }));
  }, []);

  // Build text tracks for transport
  const textTracks = useMemo(() => {
    const tracks = [];
    if (textA) {
      const label = textA.length > 20 ? textA.slice(0, 20) + '...' : textA;
      tracks.push({ id: 'textA', label, color: '#6366f1', start: textTimingA.start, end: textTimingA.end });
    }
    if (textB) {
      const label = textB.length > 20 ? textB.slice(0, 20) + '...' : textB;
      tracks.push({ id: 'textB', label, color: '#f59e0b', start: textTimingB.start, end: textTimingB.end });
    }
    return tracks;
  }, [textA, textB, textTimingA, textTimingB]);

  // Is text visible at current time?
  const showA = textA && currentTime >= textTimingA.start && currentTime <= textTimingA.end;
  const showB = textB && currentTime >= textTimingB.start && currentTime <= textTimingB.end;

  if (!playlist.length) return null;

  const renderMedia = (item, style = {}) => (
    <div className="absolute inset-0" style={style}>
      {item.type === 'video' ? (
        <video
          ref={el => { if (el) videoRefs.current[item.id] = el; }}
          className="w-full h-full object-cover"
          src={item.url}
          muted
          loop
          playsInline
          preload="auto"
        />
      ) : (
        <img src={item.thumbnailUrl || item.url} alt="" className="w-full h-full object-cover" loading="lazy" />
      )}
    </div>
  );

  const getTransitionStyles = () => {
    if (transition === 'cut' || transProgress === 0) {
      return { current: { opacity: 1 }, next: { opacity: 0 } };
    }
    const t = transProgress;
    switch (transition) {
      case 'fade':
        return { current: { opacity: 1 - t }, next: { opacity: t } };
      case 'slide':
        return {
          current: { opacity: 1, transform: `translateX(${-t * 100}%)` },
          next: { opacity: 1, transform: `translateX(${(1 - t) * 100}%)` },
        };
      case 'zoom':
        return {
          current: { opacity: 1 - t, transform: `scale(${1 + t * 0.2})` },
          next: { opacity: t, transform: `scale(${1.2 - t * 0.2})` },
        };
      default:
        return { current: { opacity: 1 }, next: { opacity: 0 } };
    }
  };

  const styles = getTransitionStyles();

  return (
    <div className="flex w-full flex-col gap-0">
      {/* Visual area */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-solid border-neutral-700 bg-[#0a0a0f]"
        style={{ aspectRatio: ASPECT_CSS[aspectRatio] || '9/16' }}
      >
        {seg && renderMedia(seg.item, styles.current)}
        {transProgress > 0 && nextSeg && renderMedia(nextSeg.item, styles.next)}

        {/* Independent text overlays — Bank A (indigo) */}
        {showA && (
          <DraggableTextOverlay
            text={textA}
            textStyle={textStyle}
            color="#6366f1"
            position={textPosA}
            onPositionChange={setTextPosA}
            containerRef={containerRef}
          />
        )}

        {/* Independent text overlays — Bank B (amber) */}
        {showB && (
          <DraggableTextOverlay
            text={textB}
            textStyle={textStyle}
            color="#f59e0b"
            position={textPosB}
            onPositionChange={setTextPosB}
            containerRef={containerRef}
          />
        )}

        <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
      </div>

      {/* Transport below preview */}
      <PreviewTransport
        isPlaying={isPlaying}
        onToggle={toggle}
        onReroll={handleReroll}
        progress={progress}
        items={playlist}
        activeIdx={playlist.length > 0 ? Math.min(Math.floor(progress * playlist.length), playlist.length - 1) : 0}
        onCellClick={handleCellClick}
        onScrub={seek}
        showPlayhead={true}
        totalDuration={totalDuration}
        textTracks={textTracks}
        onTextTrackChange={handleTextTrackChange}
      />
    </div>
  );
};

export default MultiClipPreview;
