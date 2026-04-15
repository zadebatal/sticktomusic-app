import { useCallback, useState } from 'react';
import log from '../utils/logger';
import { normalizeBeatsToTrimRange } from '../utils/timelineNormalization';

/**
 * Custom hook for beat detection using Essentia.js (WASM-powered).
 *
 * Uses BeatTrackerMultiFeature for professional-grade beat TRACKING — returns
 * actual beat positions from the audio, not generated ticks from BPM+offset.
 * This handles tempo variations, syncopation, and complex rhythms.
 *
 * IMPORTANT: Returns beats in GLOBAL time (full audio file timeline).
 * Use getLocalBeats() or normalizeBeatsToTrimRange() for trimmed audio.
 */

// Skip full audio decode for files larger than this (prevents browser tab freeze)
const MAX_BEAT_DETECT_SIZE = 50 * 1024 * 1024; // 50MB

// Lazy singleton — Essentia WASM is ~2MB, only load once
let essentiaInstance = null;
let essentiaLoadPromise = null;

async function getEssentia() {
  if (essentiaInstance) return essentiaInstance;
  if (essentiaLoadPromise) return essentiaLoadPromise;

  essentiaLoadPromise = (async () => {
    const [{ default: Essentia }, { default: EssentiaWASM }] = await Promise.all([
      import('essentia.js/dist/essentia.js-core.es.js'),
      import('essentia.js/dist/essentia-wasm.web.js'),
    ]);
    // Tell Emscripten where to find the .wasm file (served from public/)
    const wasm = await EssentiaWASM({
      locateFile: (path) => {
        if (path.endsWith('.wasm')) return '/essentia-wasm.web.wasm';
        return path;
      },
    });
    essentiaInstance = new Essentia(wasm);
    log(`[BeatDetection] Essentia.js loaded (v${essentiaInstance.version})`);
    return essentiaInstance;
  })();

  return essentiaLoadPromise;
}

export const useBeatDetection = () => {
  const [beats, setBeats] = useState([]);
  const [bpm, setBpm] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Analyze audio file or URL for beats using Essentia.js BeatTrackerMultiFeature.
   * Returns actual beat positions from the audio — not generated from BPM.
   * @param {File|Blob|string} audioSource - File object, Blob, or URL string
   */
  const analyzeAudio = useCallback(async (audioSource) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // Create audio context and decode
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      let arrayBuffer;

      if (audioSource instanceof File || audioSource instanceof Blob) {
        if (audioSource.size > MAX_BEAT_DETECT_SIZE) {
          log.warn(
            `[BeatDetection] File too large (${(audioSource.size / 1024 / 1024).toFixed(0)}MB), using fallback BPM`,
          );
          await audioContext.close();
          const fallbackBpm = 120;
          const fallbackBeats = generateBeatTimestamps(fallbackBpm, 0, 60);
          setBpm(fallbackBpm);
          setBeats(fallbackBeats);
          setIsAnalyzing(false);
          return { bpm: fallbackBpm, beats: fallbackBeats, isFallback: true };
        }
        log('[BeatDetection] Analyzing from file/blob');
        arrayBuffer = await audioSource.arrayBuffer();
      } else if (typeof audioSource === 'string') {
        if (audioSource.startsWith('blob:')) {
          log.warn('[BeatDetection] Rejected stale blob URL');
          setIsAnalyzing(false);
          return;
        }
        log('[BeatDetection] Fetching from URL:', audioSource.substring(0, 50) + '...');
        try {
          // Check size with HEAD before full download
          try {
            const headResp = await fetch(audioSource, { method: 'HEAD', mode: 'cors' });
            const contentLength = parseInt(headResp.headers.get('content-length') || '0', 10);
            if (contentLength > MAX_BEAT_DETECT_SIZE) {
              log.warn(
                `[BeatDetection] URL too large (${(contentLength / 1024 / 1024).toFixed(0)}MB), using fallback BPM`,
              );
              await audioContext.close();
              const fallbackBpm = 120;
              const fallbackBeats = generateBeatTimestamps(fallbackBpm, 0, 60);
              setBpm(fallbackBpm);
              setBeats(fallbackBeats);
              setIsAnalyzing(false);
              return { bpm: fallbackBpm, beats: fallbackBeats, isFallback: true };
            }
          } catch {
            /* HEAD failed, continue with fetch */
          }
          const response = await fetch(audioSource, { mode: 'cors' });
          if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
          arrayBuffer = await response.arrayBuffer();
        } catch (fetchError) {
          log.warn('Direct fetch failed, using fallback:', fetchError.message);
          await audioContext.close();
          const fallbackBpm = 120;
          const fallbackBeats = generateBeatTimestamps(fallbackBpm, 0, 60);
          setBpm(fallbackBpm);
          setBeats(fallbackBeats);
          setIsAnalyzing(false);
          return { bpm: fallbackBpm, beats: fallbackBeats, isFallback: true };
        }
      } else {
        throw new Error('Invalid audio source - must be File, Blob, or URL string');
      }

      // Decode audio
      log('[BeatDetection] Decoding audio...');
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const duration = audioBuffer.duration;

      // Get Essentia instance (lazy load WASM on first use)
      log('[BeatDetection] Loading Essentia.js...');
      const essentia = await getEssentia();

      // Convert AudioBuffer to mono Float32Array → Essentia VectorFloat
      const monoSignal = essentia.audioBufferToMonoSignal(audioBuffer);
      const signal = essentia.arrayToVector(monoSignal);

      // Run BeatTrackerMultiFeature — 5 detection functions for best accuracy
      log('[BeatDetection] Running BeatTrackerMultiFeature...');
      let result;
      try {
        result = essentia.BeatTrackerMultiFeature(signal);
      } catch (multiErr) {
        log.warn('[BeatDetection] MultiFeature failed, trying Degara:', multiErr.message);
        try {
          result = essentia.BeatTrackerDegara(signal);
        } catch (degaraErr) {
          log.warn('[BeatDetection] Degara also failed:', degaraErr.message);
          await audioContext.close();
          const fallbackResult = detectBeatsBasic(audioBuffer);
          setBpm(fallbackResult.bpm);
          setBeats(fallbackResult.beats);
          return fallbackResult;
        }
      }

      // Extract beat timestamps from Essentia result
      const ticks = essentia.vectorToArray(result.ticks);
      const beatTimestamps = Array.from(ticks)
        .filter((t) => t >= 0 && t <= duration)
        .map((t) => parseFloat(t.toFixed(3)));

      // Ensure beats start at 0 (fill gap before first detected beat)
      if (beatTimestamps.length > 0 && beatTimestamps[0] > 0.05) {
        beatTimestamps.unshift(0);
      }

      // Estimate BPM from median beat interval
      let detectedBpm = 120;
      if (beatTimestamps.length >= 3) {
        const intervals = [];
        for (let i = 1; i < beatTimestamps.length; i++) {
          intervals.push(beatTimestamps[i] - beatTimestamps[i - 1]);
        }
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        if (medianInterval > 0) {
          detectedBpm = Math.round(60 / medianInterval);
          // Keep BPM in reasonable range
          while (detectedBpm < 60) detectedBpm *= 2;
          while (detectedBpm > 200) detectedBpm /= 2;
        }
      }

      // Also try Essentia's confidence if available
      const confidence = result.confidence ?? null;

      setBpm(detectedBpm);
      setBeats(beatTimestamps);
      await audioContext.close();

      log(
        `[BeatDetection] Complete: ${detectedBpm} BPM, ${beatTimestamps.length} beats` +
          (confidence !== null ? `, confidence: ${confidence.toFixed(2)}` : ''),
      );

      return { bpm: detectedBpm, beats: beatTimestamps, confidence };
    } catch (err) {
      log.error('[BeatDetection] Error:', err);
      setError(err.message);

      // Set default values so UI doesn't break
      const fallbackBpm = 120;
      const fallbackBeats = generateBeatTimestamps(fallbackBpm, 0, 60);
      setBpm(fallbackBpm);
      setBeats(fallbackBeats);

      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  /**
   * Generate beats from a known BPM (manual entry)
   */
  const generateBeatsFromBPM = useCallback((bpmValue, offset = 0, duration = 60) => {
    const beatTimestamps = generateBeatTimestamps(bpmValue, offset, duration);
    setBpm(bpmValue);
    setBeats(beatTimestamps);
    return beatTimestamps;
  }, []);

  /**
   * Clear beat data
   */
  const clearBeats = useCallback(() => {
    setBeats([]);
    setBpm(null);
    setError(null);
  }, []);

  /**
   * Get beats normalized to LOCAL time for a trim range
   */
  const getLocalBeats = useCallback(
    (trimStart, trimEnd) => {
      return normalizeBeatsToTrimRange(beats, trimStart, trimEnd);
    },
    [beats],
  );

  return {
    beats, // GLOBAL time — actual beat positions from audio
    bpm,
    isAnalyzing,
    error,
    analyzeAudio,
    generateBeatsFromBPM,
    clearBeats,
    getLocalBeats,
  };
};

/**
 * Generate evenly-spaced beat timestamps from BPM and offset.
 * Used for manual BPM entry and as ultimate fallback.
 */
function generateBeatTimestamps(bpm, offset = 0, duration = 60) {
  const beatInterval = 60 / bpm;
  const beats = [];
  for (let time = offset; time < duration; time += beatInterval) {
    if (time >= 0) beats.push(parseFloat(time.toFixed(3)));
  }
  // Always start at 0
  if (beats.length === 0 || beats[0] > 0.01) beats.unshift(0);
  return beats;
}

/**
 * Basic fallback beat detection using onset detection.
 * Used when Essentia.js fails completely.
 */
function detectBeatsBasic(audioBuffer) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  const windowSize = Math.floor(sampleRate * 0.02);
  const hopSize = Math.floor(windowSize / 2);

  const energies = [];
  for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      energy += channelData[i + j] * channelData[i + j];
    }
    energies.push(energy / windowSize);
  }

  const maxEnergy = Math.max(...energies);
  if (maxEnergy === 0) {
    return { bpm: 120, beats: generateBeatTimestamps(120, 0, duration) };
  }

  const normalizedEnergies = energies.map((e) => e / maxEnergy);
  const onsets = [];
  const threshold = 0.15;
  const minTimeBetweenOnsets = 0.15;

  for (let i = 1; i < normalizedEnergies.length; i++) {
    const diff = normalizedEnergies[i] - normalizedEnergies[i - 1];
    if (diff > threshold) {
      const time = (i * hopSize) / sampleRate;
      if (onsets.length === 0 || time - onsets[onsets.length - 1] >= minTimeBetweenOnsets) {
        onsets.push(parseFloat(time.toFixed(3)));
      }
    }
  }

  let bpm = 120;
  if (onsets.length >= 4) {
    const intervals = [];
    for (let i = 1; i < Math.min(onsets.length, 50); i++) {
      intervals.push(onsets[i] - onsets[i - 1]);
    }
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    if (medianInterval > 0) {
      bpm = Math.round(60 / medianInterval);
      while (bpm < 60) bpm *= 2;
      while (bpm > 180) bpm /= 2;
    }
  }

  const firstBeat = onsets.length > 0 ? onsets[0] % (60 / bpm) : 0;
  const beats = generateBeatTimestamps(bpm, firstBeat, duration);
  return { bpm, beats };
}

export default useBeatDetection;
