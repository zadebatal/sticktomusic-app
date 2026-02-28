/**
 * MontagePreview — Beat-synced clip cycling preview for montage niches.
 * Cuts between clips on detected beats (or every 0.5s without audio).
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
const MAX_PRELOADED = 10;

const MontagePreview = ({
  media = [],
  audioUrl,
  textBankA = [],
  textBankB = [],
  textStyle = {},
  textPosition = 'center',
  aspectRatio = '9:16',
  onCutByWord,
  onCutsApplied,
  selectedTextA,
  selectedTextB,
  onTextPositionsChange,
  onTextAChange,
  onTextBChange,
}) => {
  const [playlist, setPlaylist] = useState(() => [...media]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [previewTextA, setPreviewTextA] = useState(() => textBankA[0] || '');
  const [previewTextB, setPreviewTextB] = useState(() => textBankB[0] || '');
  const lastBeatIdxRef = useRef(-1);
  const videoRefsMap = useRef({});
  const [showBeatSelector, setShowBeatSelector] = useState(false);
  const [showMomentumSelector, setShowMomentumSelector] = useState(false);

  const { beats, bpm, analyzeAudio } = useBeatDetection();
  const { audioRef, currentTime, isPlaying, progress, toggle, seek } = usePreviewPlayback({
    audioUrl,
    duration: 30,
  });
  const containerRef = useRef(null);

  // Independent position state per text overlay
  const textPosY = textPosition === 'top' ? 15 : textPosition === 'bottom' ? 85 : 50;
  const [textPosA, setTextPosA] = useState({ x: 50, y: Math.max(textPosY - 10, 10), width: 80 });
  const [textPosB, setTextPosB] = useState({ x: 50, y: Math.min(textPosY + 10, 90), width: 80 });

  // Text timing — start/end in seconds
  const [textTimingA, setTextTimingA] = useState({ start: 0, end: 30 });
  const [textTimingB, setTextTimingB] = useState({ start: 0, end: 30 });

  // Report position changes to parent
  useEffect(() => { onTextPositionsChange?.(textPosA, textPosB); }, [textPosA, textPosB, onTextPositionsChange]);

  // Analyze audio for beats when audioUrl changes
  const analyzedUrlRef = useRef(null);
  useEffect(() => {
    if (audioUrl && audioUrl !== analyzedUrlRef.current) {
      analyzedUrlRef.current = audioUrl;
      analyzeAudio(audioUrl).catch(() => {});
    }
  }, [audioUrl, analyzeAudio]);

  // Play/pause ALL video elements when isPlaying changes
  useEffect(() => {
    const refs = videoRefsMap.current;
    Object.values(refs).forEach(vid => {
      if (!vid) return;
      if (isPlaying) {
        vid.play().catch(() => {});
      } else {
        vid.pause();
      }
    });
  }, [isPlaying]);

  // Pick random text on each cut
  const pickText = useCallback((bank) => {
    if (!bank.length) return '';
    return bank[Math.floor(Math.random() * bank.length)];
  }, []);

  // Beat-sync: advance on beat crossings
  useEffect(() => {
    if (!isPlaying || !playlist.length) return;

    if (beats.length > 0) {
      let beatIdx = -1;
      for (let i = beats.length - 1; i >= 0; i--) {
        if (currentTime >= beats[i]) { beatIdx = i; break; }
      }
      if (beatIdx !== lastBeatIdxRef.current && beatIdx >= 0) {
        lastBeatIdxRef.current = beatIdx;
        setActiveIdx(prev => (prev + 1) % playlist.length);
        setPreviewTextA(pickText(textBankA));
        setPreviewTextB(pickText(textBankB));
      }
    } else {
      const intervalIdx = Math.floor(currentTime / 0.5);
      if (intervalIdx !== lastBeatIdxRef.current) {
        lastBeatIdxRef.current = intervalIdx;
        setActiveIdx(prev => (prev + 1) % playlist.length);
        setPreviewTextA(pickText(textBankA));
        setPreviewTextB(pickText(textBankB));
      }
    }
  }, [currentTime, isPlaying, beats, playlist.length, textBankA, textBankB, pickText]);

  // Sync playlist when media changes
  useEffect(() => {
    setPlaylist([...media]);
    setActiveIdx(0);
    lastBeatIdxRef.current = -1;
  }, [media]);

  // Show text immediately when banks change (don't wait for play)
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

  // BeatSelector apply — rebuild playlist with one clip per selected beat
  const handleBeatSelectionApply = useCallback((selectedBeatTimes) => {
    if (selectedBeatTimes.length > 0 && media.length > 0) {
      const filled = [];
      for (let i = 0; i < selectedBeatTimes.length; i++) {
        filled.push(media[i % media.length]);
      }
      setPlaylist(filled);
      setActiveIdx(0);
      lastBeatIdxRef.current = -1;
      onCutsApplied?.(selectedBeatTimes);
    }
    setShowBeatSelector(false);
  }, [media, onCutsApplied]);

  // Cut by word — delegate to parent's transcription flow
  const handleCutByWord = useCallback(() => {
    if (onCutByWord) {
      onCutByWord();
      return;
    }
    // Fallback: inline text timing
    const allWords = [...textBankA, ...textBankB].filter(Boolean);
    if (!allWords.length) return;
    setTextTimingA({ start: 0, end: 30 });
    setTextTimingB({ start: 0, end: 30 });
  }, [onCutByWord, textBankA, textBankB]);

  // BPM label
  const bpmLabel = useMemo(() => {
    if (!beats.length) return audioUrl ? 'Analyzing...' : null;
    return bpm ? `${Math.round(bpm)} BPM (${beats.length} beats)` : `${beats.length} beats`;
  }, [beats, bpm, audioUrl]);

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
    setPreviewTextA(pickText(textBankA));
    setPreviewTextB(pickText(textBankB));
  }, [media, progress, pickText, textBankA, textBankB]);

  const handleCellClick = useCallback((idx) => {
    setActiveIdx(idx);
    setPreviewTextA(pickText(textBankA));
    setPreviewTextB(pickText(textBankB));
  }, [pickText, textBankA, textBankB]);

  // Text track timing change
  const handleTextTrackChange = useCallback((trackId, changes) => {
    if (trackId === 'textA') setTextTimingA(prev => ({ ...prev, ...changes }));
    if (trackId === 'textB') setTextTimingB(prev => ({ ...prev, ...changes }));
  }, []);

  // Build text tracks for transport
  const textTracks = useMemo(() => {
    const tracks = [];
    if (previewTextA) {
      const label = previewTextA.length > 20 ? previewTextA.slice(0, 20) + '...' : previewTextA;
      tracks.push({ id: 'textA', label, color: '#6366f1', start: textTimingA.start, end: textTimingA.end });
    }
    if (previewTextB) {
      const label = previewTextB.length > 20 ? previewTextB.slice(0, 20) + '...' : previewTextB;
      tracks.push({ id: 'textB', label, color: '#f59e0b', start: textTimingB.start, end: textTimingB.end });
    }
    return tracks;
  }, [previewTextA, previewTextB, textTimingA, textTimingB]);

  // Is text visible at current time?
  const showA = previewTextA && currentTime >= textTimingA.start && currentTime <= textTimingA.end;
  const showB = previewTextB && currentTime >= textTimingB.start && currentTime <= textTimingB.end;

  const preloaded = useMemo(() => playlist.slice(0, MAX_PRELOADED), [playlist]);

  if (!playlist.length) return null;

  return (
    <div className="flex w-full flex-col gap-0">
      {/* Visual area */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-solid border-neutral-700 bg-[#0a0a0f]"
        style={{ aspectRatio: ASPECT_CSS[aspectRatio] || '9/16' }}
      >
        {/* Media layers */}
        {preloaded.map((item, i) => {
          const isActive = i === activeIdx % preloaded.length;
          return (
            <div
              key={item.id}
              className="absolute inset-0"
              style={{ opacity: isActive ? 1 : 0, transition: 'opacity 0.05s' }}
            >
              {item.type === 'video' ? (
                <video
                  ref={el => { videoRefsMap.current[item.id] = el; }}
                  className="w-full h-full object-cover"
                  src={item.url}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img src={item.thumbnailUrl || item.url} alt="" className="w-full h-full object-cover" loading="lazy" />
              )}
            </div>
          );
        })}

        {/* Poster overlay when paused */}
        {!isPlaying && preloaded[activeIdx % preloaded.length] && (() => {
          const cur = preloaded[activeIdx % preloaded.length];
          const src = cur.thumbnailUrl || (cur.type !== 'video' ? cur.url : null);
          return src ? (
            <div className="absolute inset-0 z-[1]">
              <img src={src} alt="" className="w-full h-full object-cover" />
            </div>
          ) : null;
        })()}

        {/* Independent text overlays — Bank A (indigo) */}
        {showA && (
          <DraggableTextOverlay
            text={previewTextA}
            textStyle={textStyle}
            color="#6366f1"
            position={textPosA}
            onPositionChange={setTextPosA}
            onTextChange={(newText) => { setPreviewTextA(newText); onTextAChange?.(newText); }}
            containerRef={containerRef}
          />
        )}

        {/* Independent text overlays — Bank B (amber) */}
        {showB && (
          <DraggableTextOverlay
            text={previewTextB}
            textStyle={textStyle}
            color="#f59e0b"
            position={textPosB}
            onPositionChange={setTextPosB}
            onTextChange={(newText) => { setPreviewTextB(newText); onTextBChange?.(newText); }}
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
        totalDuration={30}
        textTracks={textTracks}
        onTextTrackChange={handleTextTrackChange}
      />

      {/* Cut by beat/word + BPM — below transport */}
      {(audioUrl || textBankA.length > 0 || textBankB.length > 0) && (
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
      )}

      {/* BeatSelector modal */}
      {showBeatSelector && (
        <BeatSelector
          beats={beats}
          bpm={bpm}
          duration={30}
          onApply={handleBeatSelectionApply}
          onCancel={() => setShowBeatSelector(false)}
        />
      )}

      {/* MomentumSelector modal */}
      {showMomentumSelector && (
        <MomentumSelector
          audioSource={audioUrl}
          duration={30}
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

export default MontagePreview;
