/**
 * SoloClipPreview — Single video with word-by-word text animation.
 * Plays video (muted if external audio), syncs word overlay to audio timeline.
 */
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import usePreviewPlayback from '../usePreviewPlayback';
import WordOverlay from './WordOverlay';
import PreviewTransport from './PreviewTransport';
import DraggableTextOverlay from './DraggableTextOverlay';

const ASPECT_CSS = { '9:16': '9/16', '16:9': '16/9', '1:1': '1/1', '4:5': '4/5' };

const SoloClipPreview = ({
  video,
  allVideos = [],
  audioUrl,
  words = [],
  textStyle = {},
  textPosition = 'center',
  textDisplayMode = 'word',
  textBankA = [],
  textBankB = [],
  aspectRatio = '9:16',
}) => {
  // If allVideos provided, support cycling through them
  const videoPool = useMemo(() => {
    if (allVideos.length > 0) return allVideos;
    return video ? [video] : [];
  }, [allVideos, video]);

  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const activeVideo = videoPool[activeVideoIdx] || video;

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const { audioRef, currentTime, isPlaying, progress, toggle, seek } = usePreviewPlayback({
    audioUrl,
    duration: activeVideo?.duration || 30,
  });
  const totalDuration = activeVideo?.duration || 30;

  // Independent position state per text overlay
  const textPosY = textPosition === 'top' ? 15 : textPosition === 'bottom' ? 85 : 50;
  const [textPosA, setTextPosA] = useState({ x: 50, y: Math.max(textPosY - 10, 10), width: 80 });
  const [textPosB, setTextPosB] = useState({ x: 50, y: Math.min(textPosY + 10, 90), width: 80 });

  // Text timing — start/end in seconds
  const [textTimingA, setTextTimingA] = useState({ start: 0, end: totalDuration });
  const [textTimingB, setTextTimingB] = useState({ start: 0, end: totalDuration });

  // Sync video playback with audio
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isPlaying) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [isPlaying]);

  // Sync video time on seek
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || isPlaying) return;
    if (Math.abs(vid.currentTime - currentTime) > 0.5) {
      vid.currentTime = currentTime;
    }
  }, [currentTime, isPlaying]);

  // Reroll — cycle to next video in pool
  const handleReroll = useCallback(() => {
    if (videoPool.length < 2) return;
    setActiveVideoIdx(prev => {
      let next;
      do { next = Math.floor(Math.random() * videoPool.length); } while (next === prev && videoPool.length > 1);
      return next;
    });
  }, [videoPool.length]);

  const textA = textBankA.length > 0 ? textBankA[0] : '';
  const textB = textBankB.length > 0 ? textBankB[0] : '';

  // Text track timing change
  const handleTextTrackChange = useCallback((trackId, changes) => {
    if (trackId === 'textA') setTextTimingA(prev => ({ ...prev, ...changes }));
    if (trackId === 'textB') setTextTimingB(prev => ({ ...prev, ...changes }));
  }, []);

  // Build text tracks for transport
  const textTracks = useMemo(() => {
    if (words.length > 0) return []; // Word overlay handles its own display
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
  }, [words.length, textA, textB, textTimingA, textTimingB]);

  // Is text visible at current time?
  const showA = textA && currentTime >= textTimingA.start && currentTime <= textTimingA.end;
  const showB = textB && currentTime >= textTimingB.start && currentTime <= textTimingB.end;

  if (!activeVideo) return null;

  const hasWords = words.length > 0;

  return (
    <div className="flex w-full flex-col gap-0">
      {/* Visual area */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-solid border-neutral-700 bg-[#0a0a0f]"
        style={{ aspectRatio: ASPECT_CSS[aspectRatio] || '9/16' }}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          src={activeVideo.url}
          muted={!!audioUrl}
          loop
          playsInline
          preload="auto"
        />

        {/* Word overlay — synced to audio */}
        {hasWords && (
          <WordOverlay
            words={words}
            currentTime={currentTime}
            textStyle={textStyle}
            displayMode={textDisplayMode}
          />
        )}

        {/* Independent text overlays from banks (when no word overlay) — Bank A (indigo) */}
        {!hasWords && showA && (
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
        {!hasWords && showB && (
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
        onReroll={videoPool.length > 1 ? handleReroll : null}
        showReroll={videoPool.length > 1}
        progress={progress}
        items={videoPool}
        activeIdx={videoPool.length > 0 ? Math.min(Math.floor(progress * videoPool.length), videoPool.length - 1) : 0}
        onCellClick={(idx) => setActiveVideoIdx(idx)}
        onScrub={seek}
        showPlayhead={true}
        totalDuration={totalDuration}
        textTracks={textTracks}
        onTextTrackChange={handleTextTrackChange}
      />
    </div>
  );
};

export default SoloClipPreview;
