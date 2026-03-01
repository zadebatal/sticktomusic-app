/**
 * PhotoMontagePreview — Ken Burns CSS animation with crossfade transitions.
 * Supports beat-sync, speed control, and per-photo random Ken Burns presets.
 */
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import usePreviewPlayback from '../usePreviewPlayback';
import { useBeatDetection } from '../../../../hooks/useBeatDetection';
import { FeatherRefreshCw } from '@subframe/core';
import PreviewTransport from './PreviewTransport';
import DraggableTextOverlay from './DraggableTextOverlay';
import BeatSelector from '../../BeatSelector';
import MomentumSelector from '../../MomentumSelector';

const ASPECT_CSS = { '9:16': '9/16', '16:9': '16/9', '1:1': '1/1', '4:5': '4/5' };

const PhotoMontagePreview = ({
  images = [],
  audioUrl,
  textStyle = {},
  textPosition = 'center',
  transition = 'fade',
  beatSync = false,
  speed = 1,
  textBankA = [],
  textBankB = [],
  aspectRatio = '9:16',
  displayMode = 'cover',
  onCutByWord,
  onCutsApplied,
  selectedTextA,
  selectedTextB,
  onTextPositionsChange,
  onTextAChange,
  onTextBChange,
}) => {
  const [playlist, setPlaylist] = useState(() => [...images]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState(-1);
  const [transProgress, setTransProgress] = useState(0);
  const lastAdvanceRef = useRef(0);
  const [showBeatSelector, setShowBeatSelector] = useState(false);
  const [showMomentumSelector, setShowMomentumSelector] = useState(false);
  const [previewTextA, setPreviewTextA] = useState(() => textBankA[0] || '');
  const [previewTextB, setPreviewTextB] = useState(() => textBankB[0] || '');
  const [textSelected, setTextSelected] = useState(false);

  // Timeline = full audio/30s duration; speed = seconds each photo is shown
  const totalDuration = 30;
  const photoDuration = speed;

  const containerRef = useRef(null);
  const { beats, analyzeAudio } = useBeatDetection();
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

  // Report position changes to parent
  useEffect(() => { onTextPositionsChange?.(textPosA, textPosB); }, [textPosA, textPosB, onTextPositionsChange]);

  // Analyze audio for beat sync
  const analyzedUrlRef = useRef(null);
  useEffect(() => {
    if (beatSync && audioUrl && audioUrl !== analyzedUrlRef.current) {
      analyzedUrlRef.current = audioUrl;
      analyzeAudio(audioUrl).catch(() => {});
    }
  }, [beatSync, audioUrl, analyzeAudio]);


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

  // Expanded timeline: photos repeated to fill duration (for scrolling filmstrip)
  const timelineItems = useMemo(() => {
    if (!playlist.length || photoDuration <= 0) return playlist;
    const count = Math.ceil(totalDuration / photoDuration);
    if (count <= playlist.length) return playlist;
    const items = [];
    for (let i = 0; i < count; i++) {
      const src = playlist[i % playlist.length];
      items.push({ ...src, id: `${src.id || 'p'}_t${i}` });
    }
    return items;
  }, [playlist, photoDuration, totalDuration]);

  // Absolute index into the expanded timeline (for filmstrip active cell)
  const displayTimelineIdx = useMemo(() => {
    if (!timelineItems.length) return 0;
    if (beatSync && beats.length > 0) {
      let beatIdx = -1;
      for (let i = beats.length - 1; i >= 0; i--) {
        if (currentTime >= beats[i]) { beatIdx = i; break; }
      }
      return beatIdx >= 0 ? Math.min(beatIdx, timelineItems.length - 1) : 0;
    }
    return photoDuration > 0 ? Math.min(Math.floor(currentTime / photoDuration), timelineItems.length - 1) : 0;
  }, [currentTime, timelineItems.length, photoDuration, beatSync, beats]);

  // Display index into the original playlist (for rendering the preview image)
  const displayIdx = useMemo(() => {
    if (!playlist.length) return 0;
    return timelineItems.length > 0 ? displayTimelineIdx % playlist.length : 0;
  }, [displayTimelineIdx, playlist.length, timelineItems.length]);

  // Refs for transition tracking (avoid stale closure issues in displayIdx effect)
  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  // Track transitions (crossfade) when displayIdx changes during playback
  useEffect(() => {
    if (displayIdx !== activeIdxRef.current) {
      if (isPlayingRef.current) {
        setPrevIdx(activeIdxRef.current);
        setTransProgress(0);
      } else {
        setPrevIdx(-1); // No crossfade when scrubbing
      }
      setActiveIdx(displayIdx);
      lastAdvanceRef.current = currentTimeRef.current;
    }
  }, [displayIdx]);

  // Crossfade transition progress
  useEffect(() => {
    if (prevIdx < 0 || transition === 'cut') return;
    const elapsed = currentTime - lastAdvanceRef.current;
    const dur = 0.3;
    if (elapsed < dur) {
      setTransProgress(elapsed / dur);
    } else if (transProgress < 1) {
      setTransProgress(1);
      setPrevIdx(-1);
    }
  }, [currentTime, prevIdx, transition, transProgress]);

  // Sync playlist when images change
  useEffect(() => {
    setPlaylist([...images]);
    setActiveIdx(0);
    setPrevIdx(-1);
    lastAdvanceRef.current = 0;
  }, [images]);


  // Cut by beat — open BeatSelector modal (same as full editors)
  const handleCutByBeat = useCallback(() => {
    if (!beats.length && audioUrl) {
      analyzeAudio(audioUrl).catch(() => {});
      return;
    }
    if (beats.length > 0) {
      setShowBeatSelector(true);
    }
  }, [beats, audioUrl, analyzeAudio]);

  // BeatSelector apply — rebuild playlist with one photo per selected beat
  const handleBeatSelectionApply = useCallback((selectedBeatTimes) => {
    if (selectedBeatTimes.length > 0 && images.length > 0) {
      const filled = [];
      for (let i = 0; i < selectedBeatTimes.length; i++) {
        filled.push(images[i % images.length]);
      }
      setPlaylist(filled);
      setActiveIdx(0);
      lastAdvanceRef.current = 0;
      onCutsApplied?.(selectedBeatTimes);
    }
    setShowBeatSelector(false);
  }, [images, onCutsApplied]);

  // Cut by word — delegate to parent's transcription flow
  const handleCutByWord = useCallback(() => {
    if (onCutByWord) {
      onCutByWord();
      return;
    }
    // Fallback: inline text timing
    const allWords = [...textBankA, ...textBankB].filter(Boolean);
    if (!allWords.length) return;
    setTextTimingA({ start: 0, end: totalDuration });
    setTextTimingB({ start: 0, end: totalDuration });
  }, [onCutByWord, textBankA, textBankB, totalDuration]);

  // BPM label for transport
  const bpmLabel = useMemo(() => {
    if (!beats.length) return audioUrl ? 'Analyzing...' : null;
    const estimatedBpm = beats.length > 1
      ? Math.round(60 / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1)))
      : null;
    return estimatedBpm ? `${estimatedBpm} BPM (${beats.length} beats)` : `${beats.length} beats`;
  }, [beats, audioUrl]);

  // Reroll — always randomize both media AND text
  const handleReroll = useCallback(() => {
    // Reroll media
    if (images.length >= 2) {
      setPlaylist(prev => {
        const playheadIdx = prev.length > 0 ? Math.min(Math.floor(progress * prev.length), prev.length - 1) : 0;
        if (playheadIdx < 0) return prev;
        const next = prev.slice(0, images.length);
        const current = next[playheadIdx];
        const candidates = images.filter(img => (img.id || img.url) !== (current?.id || current?.url));
        if (candidates.length === 0) return prev;
        next[playheadIdx] = candidates[Math.floor(Math.random() * candidates.length)];
        return next;
      });
    }
    // Reroll text
    if (textBankA.length > 0) setPreviewTextA(pickText(textBankA));
    if (textBankB.length > 0) setPreviewTextB(pickText(textBankB));
  }, [images, progress, pickText, textBankA, textBankB]);

  // Jump to photo from timeline cell (idx is into the expanded timeline)
  const handleCellClick = useCallback((idx) => {
    const photoIdx = playlist.length > 0 ? idx % playlist.length : 0;
    setActiveIdx(photoIdx);
    lastAdvanceRef.current = currentTime;
    setPreviewTextA(pickText(textBankA));
    setPreviewTextB(pickText(textBankB));
  }, [currentTime, pickText, textBankA, textBankB]);

  // Cycle text on photo advance
  useEffect(() => {
    if (textBankA.length > 0) setPreviewTextA(textBankA[activeIdx % textBankA.length]);
    if (textBankB.length > 0) setPreviewTextB(textBankB[activeIdx % textBankB.length]);
  }, [activeIdx, textBankA, textBankB]);

  const textA = previewTextA;
  const textB = previewTextB;

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

  const isGallery = displayMode === 'gallery';

  // Ref-based image switching: all photos pre-rendered, toggle visibility via DOM
  const layersRef = useRef(null);
  const prevDisplayIdxRef = useRef(-1);
  useEffect(() => {
    const container = layersRef.current;
    if (!container) return;
    const children = container.children;
    const prev = prevDisplayIdxRef.current;
    if (prev >= 0 && prev < children.length) {
      children[prev].style.opacity = '0';
      children[prev].style.zIndex = '0';
    }
    if (displayIdx >= 0 && displayIdx < children.length) {
      children[displayIdx].style.opacity = '1';
      children[displayIdx].style.zIndex = '2';
    }
    prevDisplayIdxRef.current = displayIdx;
  }, [displayIdx]);

  return (
    <div className="flex w-full flex-col gap-0">
      {/* Visual area */}
      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden rounded-xl border border-solid border-neutral-700 ${isGallery ? 'bg-[#f5f5f5]' : 'bg-[#0a0a0f]'}`}
        style={{ aspectRatio: ASPECT_CSS[aspectRatio] || '9/16' }}
        onClick={() => setTextSelected(false)}
      >
        {/* Pre-rendered photo stack — all loaded, visibility toggled via ref */}
        <div ref={layersRef} className="absolute inset-0">
          {playlist.map((img, i) => (
            <div
              key={img.id || i}
              className={`absolute inset-0 ${isGallery ? 'flex items-center justify-center' : 'overflow-hidden'}`}
              style={{
                opacity: i === 0 ? 1 : 0,
                zIndex: i === 0 ? 2 : 0,
                backgroundColor: isGallery ? '#f5f5f5' : 'transparent',
              }}
            >
              <img
                src={img.url || img.thumbnailUrl}
                alt=""
                className={isGallery
                  ? 'max-w-[80%] max-h-[85%] object-contain rounded-sm'
                  : 'w-full h-full object-cover'
                }
                style={isGallery ? { boxShadow: '0 4px 20px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1)' } : undefined}
                draggable={false}
              />
            </div>
          ))}
        </div>

        {/* Independent text overlays — Bank A (indigo) */}
        {showA && (
          <DraggableTextOverlay
            text={textA}
            textStyle={textStyle}
            color="#6366f1"
            position={textPosA}
            onPositionChange={setTextPosA}
            isSelected={textSelected === 'A'}
            onSelect={() => setTextSelected('A')}
            onTextChange={(newText) => { setPreviewTextA(newText); onTextAChange?.(newText); }}
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
            onTextChange={(newText) => { setPreviewTextB(newText); onTextBChange?.(newText); }}
            containerRef={containerRef}
            isSelected={textSelected === 'B'}
            onSelect={() => setTextSelected('B')}
          />
        )}

        {/* Reroll — overlaid at bottom center of preview */}
        {images.length > 0 && (
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
        items={timelineItems}
        activeIdx={displayTimelineIdx}
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
          bpm={beats.length > 1 ? Math.round(60 / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1))) : 120}
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

export default PhotoMontagePreview;
