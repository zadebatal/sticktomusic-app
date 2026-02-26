/**
 * usePreviewPlayback — Shared playback hook for format-specific preview components.
 * Manages audio element, rAF loop, play/pause/seek, currentTime, and progress.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const usePreviewPlayback = ({ audioUrl, duration = 30 }) => {
  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const timerStartRef = useRef(null);
  const timerOffsetRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const effectiveDuration = duration || 30;
  const progress = effectiveDuration > 0 ? Math.min(currentTime / effectiveDuration, 1) : 0;

  // rAF tick — reads from audio element or performance timer
  const tick = useCallback(() => {
    if (audioUrl && audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    } else if (timerStartRef.current !== null) {
      const elapsed = (performance.now() - timerStartRef.current) / 1000 + timerOffsetRef.current;
      if (elapsed >= effectiveDuration) {
        setCurrentTime(effectiveDuration);
        setIsPlaying(false);
        timerStartRef.current = null;
        return; // Don't schedule next frame
      }
      setCurrentTime(elapsed);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [audioUrl, effectiveDuration]);

  const play = useCallback(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.play().catch(() => {});
    } else {
      timerStartRef.current = performance.now();
      // Resume from where we left off
      timerOffsetRef.current = currentTime >= effectiveDuration ? 0 : currentTime;
      if (currentTime >= effectiveDuration) setCurrentTime(0);
    }
    setIsPlaying(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [audioUrl, currentTime, effectiveDuration, tick]);

  const pause = useCallback(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.pause();
    }
    if (timerStartRef.current !== null) {
      timerOffsetRef.current += (performance.now() - timerStartRef.current) / 1000;
      timerStartRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
  }, [audioUrl]);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const seek = useCallback((time) => {
    const clamped = Math.max(0, Math.min(time, effectiveDuration));
    setCurrentTime(clamped);
    if (audioUrl && audioRef.current) {
      audioRef.current.currentTime = clamped;
    } else {
      timerOffsetRef.current = clamped;
      if (timerStartRef.current !== null) {
        timerStartRef.current = performance.now();
      }
    }
  }, [audioUrl, effectiveDuration]);

  // Set audio src when audioUrl changes
  useEffect(() => {
    if (audioRef.current && audioUrl) {
      audioRef.current.src = audioUrl;
      audioRef.current.currentTime = 0;
    }
    setCurrentTime(0);
    timerOffsetRef.current = 0;
    timerStartRef.current = null;
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }, [audioUrl]);

  // Handle audio ended
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  return {
    audioRef,
    currentTime,
    isPlaying,
    progress,
    play,
    pause,
    toggle,
    seek,
  };
};

export default usePreviewPlayback;
