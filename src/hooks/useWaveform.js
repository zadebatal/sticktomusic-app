import { useState, useEffect, useRef } from 'react';
import { generateWaveformData, generateWaveformForClip, clearWaveformCache } from '../utils/waveformGenerator';

/**
 * Shared hook for waveform generation across all video editors.
 *
 * Generates BOTH:
 *   - waveformData: waveform for external/added audio (purple track)
 *   - clipWaveforms: per-clip waveforms from source video audio (blue track)
 *
 * Both are generated independently so both can display simultaneously.
 *
 * @param {Object} options
 * @param {Object|null} options.selectedAudio — the selected audio object (or null)
 * @param {Array} options.clips — array of clip objects (or single-element array for Solo)
 * @param {Function} options.getClipUrl — (clip) => string URL for the clip's video source
 * @returns {{ waveformData: number[], clipWaveforms: Object, waveformSource: string }}
 */
export default function useWaveform({ selectedAudio, clips = [], getClipUrl }) {
  const [waveformData, setWaveformData] = useState([]);
  const [clipWaveforms, setClipWaveforms] = useState({});
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

  // External audio waveform
  useEffect(() => {
    const hasAudio = selectedAudio?.url || selectedAudio?.localUrl || (selectedAudio?.file instanceof Blob);
    if (!hasAudio) {
      setWaveformData([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const source = selectedAudio.file instanceof Blob
        ? selectedAudio.file
        : (selectedAudio.localUrl && !selectedAudio.localUrl.startsWith('blob:'))
          ? selectedAudio.localUrl
          : selectedAudio.url;
      if (!source) { setWaveformData([]); return; }
      const data = await generateWaveformData(source);
      if (!cancelled && mountedRef.current) {
        setWaveformData(data);
      }
    })();
    return () => { cancelled = true; };

  }, [selectedAudio]);

  // Source video waveforms — always generated regardless of external audio
  useEffect(() => {
    if (!clips || clips.length === 0) {
      setClipWaveforms({});
      return;
    }

    let cancelled = false;
    (async () => {
      const results = {};
      for (const clip of clips) {
        if (cancelled) return;
        const url = getClipUrl ? getClipUrl(clip) : (clip?.url || clip?.localUrl);
        if (!url) continue;
        const key = clip.id || clip.sourceId || url;
        // Use clip-duration-aware waveform so same-URL clips show their own audio portion
        const clipDur = clip.duration || 0;
        const data = clipDur > 0
          ? await generateWaveformForClip(url, clipDur, 200)
          : await generateWaveformData(url, 200);
        if (data.length > 0) {
          results[key] = data;
        }
      }
      if (!cancelled && mountedRef.current) {
        setClipWaveforms(results);
      }
    })();
    return () => { cancelled = true; };

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

  return { waveformData, clipWaveforms, waveformSource };
}
