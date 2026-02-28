/**
 * MultiClipPreview — Sequential clip playback with transitions.
 * Each clip gets equal time, transitions: cut, fade, slide, zoom.
 */
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import usePreviewPlayback from '../usePreviewPlayback';
import { useBeatDetection } from '../../../../hooks/useBeatDetection';
import PreviewTransport from './PreviewTransport';
import DraggableTextOverlay from './DraggableTextOverlay';
import BeatSelector from '../../BeatSelector';
import MomentumSelector from '../../MomentumSelector';
import { FeatherRefreshCw } from '@subframe/core';

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
  onCutByWord,
  onCutsApplied,
  selectedTextA,
  selectedTextB,
  onTextPositionsChange,
}) => {
  const [playlist, setPlaylist] = useState(() => [...media]);
  const [showMomentumSelector, setShowMomentumSelector] = useState(false);
  const [showBeatSelector, setShowBeatSelector] = useState(false);
  const [previewTextA, setPreviewTextA] = useState(() => textBankA[0] || '');
  const [previewTextB, setPreviewTextB] = useState(() => textBankB[0] || '');

  // Sync playlist when media changes
  useEffect(() => { setPlaylist([...media]); }, [media]);

  const totalDuration = useMemo(() => {
    const sum = playlist.reduce((acc, m) => acc + (m.duration || 0), 0);
    return sum > 0 ? sum : Math.max(playlist.length * 3, 10);
  }, [playlist]);

  const containerRef = useRef(null);
  const { beats, bpm, analyzeAudio } = useBeatDetection();
  const { audioRef, currentTime, isPlaying, progress, toggle, seek } = usePreviewPlayback({
    audioUrl,
    duration: totalDuration,
  });

  // Analyze audio for beats when audioUrl changes
  const analyzedUrlRef = useRef(null);
  useEffect(() => {
    if (audioUrl && audioUrl !== analyzedUrlRef.current) {
      analyzedUrlRef.current = audioUrl;
      analyzeAudio(audioUrl).catch(() => {});
    }
  }, [audioUrl, analyzeAudio]);

  // Pick random text from bank
  const pickText = useCallback((bank) => {
    if (!bank || bank.length === 0) return '';
    return bank[Math.floor(Math.random() * bank.length)];
  }, []);

  // Auto-show text when banks change from empty→non-empty
  useEffect(() => {
    if (textBankA.length > 0 && !previewTextA) setPreviewTextA(textBankA[0]);
  }, [textBankA, previewTextA]);
  useEffect(() => {
    if (textBankB.length > 0 && !previewTextB) setPreviewTextB(textBankB[0]);
  }, [textBankB, previewTextB]);

  // Sync text from parent click (overrides internal state)
  useEffect(() => {
    if (selectedTextA !== undefined) setPreviewTextA(selectedTextA || '');
  }, [selectedTextA]);
  useEffect(() => {
    if (selectedTextB !== undefined) setPreviewTextB(selectedTextB || '');
  }, [selectedTextB]);

  // Independent position state per text overlay
  const textPosY = textPosition === 'top' ? 15 : textPosition === 'bottom' ? 85 : 50;
  const [textPosA, setTextPosA] = useState({ x: 50, y: Math.max(textPosY - 10, 10), width: 80 });
  const [textPosB, setTextPosB] = useState({ x: 50, y: Math.min(textPosY + 10, 90), width: 80 });

  // Text timing — start/end in seconds
  const [textTimingA, setTextTimingA] = useState({ start: 0, end: totalDuration });
  const [textTimingB, setTextTimingB] = useState({ start: 0, end: totalDuration });

  // Report position changes to parent
  useEffect(() => { onTextPositionsChange?.(textPosA, textPosB); }, [textPosA, textPosB, onTextPositionsChange]);

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

  // Cycle text on segment advance
  useEffect(() => {
    if (textBankA.length > 0) setPreviewTextA(textBankA[activeSegIdx % textBankA.length]);
    if (textBankB.length > 0) setPreviewTextB(textBankB[activeSegIdx % textBankB.length]);
  }, [activeSegIdx, textBankA, textBankB]);

  const textA = previewTextA;
  const textB = previewTextB;

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

  // Reroll — swap the clip under the playhead + randomize text
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
    setPreviewTextA(pickText(textBankA));
    setPreviewTextB(pickText(textBankB));
  }, [media, progress, pickText, textBankA, textBankB]);

  // Jump to segment from timeline cell
  const handleCellClick = useCallback((idx) => {
    if (segments[idx]) seek(segments[idx].start);
    setPreviewTextA(pickText(textBankA));
    setPreviewTextB(pickText(textBankB));
  }, [segments, seek, pickText, textBankA, textBankB]);

  // Beat/Momentum apply — rebuild playlist from cut points
  const handleBeatSelectionApply = useCallback((selectedBeatTimes) => {
    if (selectedBeatTimes.length > 0 && media.length > 0) {
      const filled = [];
      for (let i = 0; i < selectedBeatTimes.length; i++) {
        filled.push(media[i % media.length]);
      }
      setPlaylist(filled);
      onCutsApplied?.(selectedBeatTimes);
    }
    setShowBeatSelector(false);
  }, [media, onCutsApplied]);

  // Cut by beat — open BeatSelector modal
  const handleCutByBeat = useCallback(() => {
    if (!beats.length && audioUrl) {
      analyzeAudio(audioUrl).catch(() => {});
      return;
    }
    if (beats.length > 0) {
      setShowBeatSelector(true);
    }
  }, [beats, audioUrl, analyzeAudio]);

  // Cut by word — delegate to parent's transcription flow
  const handleCutByWord = useCallback(() => {
    if (onCutByWord) {
      onCutByWord();
      return;
    }
    const allWords = [...textBankA, ...textBankB].filter(Boolean);
    if (!allWords.length) return;
    setTextTimingA({ start: 0, end: totalDuration });
    setTextTimingB({ start: 0, end: totalDuration });
  }, [onCutByWord, textBankA, textBankB, totalDuration]);

  // BPM label
  const bpmLabel = useMemo(() => {
    if (!beats.length) return audioUrl ? 'Analyzing...' : null;
    return bpm ? `${Math.round(bpm)} BPM (${beats.length} beats)` : `${beats.length} beats`;
  }, [beats, bpm, audioUrl]);

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

        {/* Reroll — overlaid at bottom center of preview */}
        {media.length > 0 && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center z-10">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-black/60 hover:bg-black/80 border border-white/20 cursor-pointer transition-colors backdrop-blur-sm"
              onClick={handleReroll}
            >
              <FeatherRefreshCw className="text-white/80" style={{ width: 12, height: 12 }} />
              <span className="text-caption font-caption text-white/80">Reroll</span>
            </button>
          </div>
        )}

        <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
      </div>

      {/* Transport below preview */}
      <PreviewTransport
        isPlaying={isPlaying}
        onToggle={toggle}
        showReroll={false}
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

      {/* Controls below transport */}
      <div className="flex items-center justify-center gap-3 mt-1">
        {audioUrl && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 cursor-pointer transition-colors"
            onClick={handleCutByBeat}
          >
            <span className="text-caption font-caption text-neutral-300">Cut by beat</span>
          </button>
        )}
        {audioUrl && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-900/50 hover:bg-indigo-800/50 border border-indigo-700/50 cursor-pointer transition-colors"
            onClick={() => setShowMomentumSelector(true)}
          >
            <span className="text-caption font-caption text-indigo-300">Cut to music</span>
          </button>
        )}
        {(textBankA.length > 0 || textBankB.length > 0 || onCutByWord) && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 cursor-pointer transition-colors"
            onClick={handleCutByWord}
          >
            <span className="text-caption font-caption text-neutral-300">Cut by word</span>
          </button>
        )}
        {bpmLabel && (
          <span className="text-[10px] text-neutral-500 tabular-nums">{bpmLabel}</span>
        )}
      </div>

      {/* BeatSelector modal */}
      {showBeatSelector && (
        <BeatSelector
          beats={beats}
          bpm={bpm}
          duration={totalDuration}
          onApply={handleBeatSelectionApply}
          onCancel={() => setShowBeatSelector(false)}
        />
      )}

      {/* MomentumSelector modal */}
      {showMomentumSelector && (
        <MomentumSelector
          audioSource={audioUrl}
          duration={totalDuration}
          onApply={(cutPoints) => {
            handleBeatSelectionApply(cutPoints);
            setShowMomentumSelector(false);
          }}
          onCancel={() => setShowMomentumSelector(false)}
        />
      )}
    </div>
  );
};

export default MultiClipPreview;
