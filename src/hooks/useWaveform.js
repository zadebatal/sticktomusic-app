import { useState, useEffect, useRef } from 'react';
import {
  generateWaveformDataWithDuration,
  generateWaveformForClip,
  generateWaveformData,
  clearWaveformCache,
} from '../utils/waveformGenerator';

/**
 * Shared hook for waveform generation across all video editors.
 *
 * Generates BOTH:
 *   - waveformData: waveform for external/added audio (purple track)
 *   - clipWaveforms: per-clip waveforms from source video audio (blue track)
 *
 * Both are generated independently so both can display simultaneously.
 *
 * Clips can include a `file` (Blob) property to avoid re-fetching from URL.
 *
 * @param {Object} options
 * @param {Object|null} options.selectedAudio — the selected audio object (or null)
 * @param {Array} options.clips — array of clip objects (or single-element array for Solo)
 * @param {Function} options.getClipUrl — (clip) => string URL for the clip's video source
 * @returns {{ waveformData: number[], clipWaveforms: Object, clipWaveformsLoading: boolean, waveformSource: string }}
 */
export default function useWaveform({ selectedAudio, clips = [], getClipUrl }) {
  const [waveformData, setWaveformData] = useState([]);
  const [waveformDuration, setWaveformDuration] = useState(0); // Authoritative duration from AudioBuffer
  const [clipWaveforms, setClipWaveforms] = useState({});
  const [clipWaveformsLoading, setClipWaveformsLoading] = useState(false);
  const [waveformSource, setWaveformSource] = useState('none');
  const mountedRef = useRef(true);

  // Cleanup cache on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearWaveformCache();
    };
  }, []);

  // External audio waveform (skip for source video audio — that's handled by clipWaveforms)
  useEffect(() => {
    const hasAudio =
      (selectedAudio?.url || selectedAudio?.localUrl || selectedAudio?.file instanceof Blob) &&
      !selectedAudio?.isSourceAudio;
    if (!hasAudio) {
      setWaveformData([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const source =
        selectedAudio.file instanceof Blob
          ? selectedAudio.file
          : selectedAudio.localUrl && !selectedAudio.localUrl.startsWith('blob:')
            ? selectedAudio.localUrl
            : selectedAudio.url;
      if (!source) {
        setWaveformData([]);
        setWaveformDuration(0);
        return;
      }
      const { data, duration } = await generateWaveformDataWithDuration(source, 400);
      if (!cancelled && mountedRef.current) {
        setWaveformData(data);
        if (duration > 0) setWaveformDuration(duration);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAudio]);

  // Source video waveforms — always generated regardless of external audio
  useEffect(() => {
    if (!clips || clips.length === 0) {
      setClipWaveforms({});
      setClipWaveformsLoading(false);
      return;
    }

    let cancelled = false;
    setClipWaveformsLoading(true);

    // Defer waveform generation so it doesn't block initial page render.
    // decodeAudioData is CPU-heavy and can freeze the main thread.
    const delayId = setTimeout(() => {
      if (cancelled) return;
      (async () => {
        const results = {};
        for (const clip of clips) {
          if (cancelled) return;
          // Prefer local file (Blob) to avoid re-downloading from remote URL
          const source =
            clip.file instanceof Blob
              ? clip.file
              : getClipUrl
                ? getClipUrl(clip)
                : clip?.url || clip?.localUrl;
          if (!source) continue;
          const key = clip.id || clip.sourceId || (typeof source === 'string' ? source : 'blob');
          const clipDur = clip.duration || 0;
          let data;
          if (source instanceof Blob) {
            data = await generateWaveformData(source, 400);
          } else {
            data =
              clipDur > 0
                ? await generateWaveformForClip(source, clipDur, 400)
                : await generateWaveformData(source, 400);
          }
          if (data.length > 0) {
            results[key] = data;
          }
          // Yield to main thread between clips to prevent UI freeze
          await new Promise((r) => setTimeout(r, 0));
        }
        if (!cancelled && mountedRef.current) {
          setClipWaveforms(results);
          setClipWaveformsLoading(false);
        }
      })();
    }, 1500); // Wait 1.5s for page to become interactive first

    return () => {
      cancelled = true;
      clearTimeout(delayId);
    };
  }, [clips, getClipUrl]);

  // Derive waveformSource from current state
  useEffect(() => {
    const hasAudio = waveformData.length > 0;
    const hasClips = Object.keys(clipWaveforms).length > 0;
    if (hasAudio && hasClips) setWaveformSource('both');
    else if (hasAudio) setWaveformSource('audio');
    else if (hasClips) setWaveformSource('video');
    else setWaveformSource('none');
  }, [waveformData, clipWaveforms]);

  return { waveformData, waveformDuration, clipWaveforms, clipWaveformsLoading, waveformSource };
}
