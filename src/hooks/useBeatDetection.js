import { useState, useCallback } from 'react';
import { guess } from 'web-audio-beat-detector';
import { normalizeBeatsToTrimRange } from '../utils/timelineNormalization';
import log from '../utils/logger';

/**
 * Custom hook for beat detection in audio files.
 * Uses web-audio-beat-detector for professional-grade BPM detection.
 *
 * IMPORTANT: This hook returns beats in GLOBAL time (full audio file timeline).
 * If you have trimmed audio, use getLocalBeats() or normalizeBeatsToTrimRange()
 * to convert to LOCAL time before using in UI or clip creation.
 *
 * @example
 * const { beats, bpm, getLocalBeats } = useBeatDetection();
 * // For full audio:
 * const allBeats = beats; // GLOBAL time
 * // For trimmed audio:
 * const localBeats = getLocalBeats(trimStart, trimEnd); // LOCAL time
 */
export const useBeatDetection = () => {
  const [beats, setBeats] = useState([]);
  const [bpm, setBpm] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Analyze audio file or URL for beats
   * @param {File|Blob|string} audioSource - File object, Blob, or URL string
   */
  const analyzeAudio = useCallback(async (audioSource) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // Create audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Get array buffer - handle both File objects and URLs
      let arrayBuffer;

      if (audioSource instanceof File || audioSource instanceof Blob) {
        // Direct file/blob - most reliable, no CORS issues
        log('Beat detection: Analyzing from file/blob');
        arrayBuffer = await audioSource.arrayBuffer();
      } else if (typeof audioSource === 'string') {
        // Reject stale blob URLs early
        if (audioSource.startsWith('blob:')) {
          log.warn('[BeatDetection] Rejected stale blob URL');
          setIsAnalyzing(false);
          return;
        }
        // It's a URL - try to fetch the audio data
        log('Beat detection: Fetching from URL:', audioSource.substring(0, 50) + '...');

        try {
          const response = await fetch(audioSource, { mode: 'cors' });
          if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.status}`);
          }
          arrayBuffer = await response.arrayBuffer();
        } catch (fetchError) {
          // CORS error or network issue - try loading via audio element
          log.warn('Direct fetch failed, trying audio element method:', fetchError.message);

          // Create an audio element to load the audio
          const audio = new Audio();
          audio.crossOrigin = 'anonymous';
          audio.src = audioSource;

          // Wait for it to load
          await new Promise((resolve, reject) => {
            audio.oncanplaythrough = resolve;
            audio.onerror = () => reject(new Error('Failed to load audio via element'));
            setTimeout(() => reject(new Error('Audio load timeout')), 15000);
          });

          // Use MediaElementSourceNode to get the audio data
          // This approach doesn't give us raw ArrayBuffer, so fall back to basic detection
          log.warn('Could not get raw audio data due to CORS. Using fallback BPM estimation.');

          // Estimate based on common music tempos (this is a fallback)
          const fallbackBpm = 120;
          const duration = audio.duration || 60;

          setBpm(fallbackBpm);
          setBeats(generateBeatTimestamps(fallbackBpm, 0, duration));
          setIsAnalyzing(false);

          return { bpm: fallbackBpm, beats: generateBeatTimestamps(fallbackBpm, 0, duration), isFallback: true };
        }
      } else {
        throw new Error('Invalid audio source - must be File, Blob, or URL string');
      }

      // Decode audio data
      log('Beat detection: Decoding audio data...');
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const duration = audioBuffer.duration;

      // Use web-audio-beat-detector for professional BPM detection
      log('Beat detection: Running BPM analysis...');

      try {
        const result = await guess(audioBuffer);

        log('Beat detection result:', result);

        const detectedBpm = Math.round(result.bpm || result.tempo);
        const offset = result.offset || 0;

        // Generate beat timestamps from BPM and offset
        const beatTimestamps = generateBeatTimestamps(detectedBpm, offset, duration);

        setBpm(detectedBpm);
        setBeats(beatTimestamps);

        // Close audio context
        await audioContext.close();

        log(`Beat detection complete: ${detectedBpm} BPM, ${beatTimestamps.length} beats`);

        return { bpm: detectedBpm, beats: beatTimestamps, offset };

      } catch (detectError) {
        log.warn('Professional beat detection failed, using fallback:', detectError.message);

        // Fallback to basic onset detection
        const fallbackResult = detectBeatsBasic(audioBuffer);

        setBpm(fallbackResult.bpm);
        setBeats(fallbackResult.beats);

        await audioContext.close();

        return fallbackResult;
      }

    } catch (err) {
      log.error('Beat detection error:', err);
      setError(err.message);

      // Set default values so UI doesn't break
      setBpm(120);
      setBeats(generateBeatTimestamps(120, 0, 60));

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
   * Use this when working with trimmed audio
   *
   * @param {number} trimStart - Start of trim range in GLOBAL seconds
   * @param {number} trimEnd - End of trim range in GLOBAL seconds
   * @returns {Array<number>} - Beats in LOCAL time (0 = trimStart)
   */
  const getLocalBeats = useCallback((trimStart, trimEnd) => {
    return normalizeBeatsToTrimRange(beats, trimStart, trimEnd);
  }, [beats]);

  return {
    beats,        // GLOBAL time - use for full audio only
    bpm,
    isAnalyzing,
    error,
    analyzeAudio,
    generateBeatsFromBPM,
    clearBeats,
    getLocalBeats // LOCAL time - use for trimmed audio
  };
};

/**
 * Generate beat timestamps from BPM and offset
 */
function generateBeatTimestamps(bpm, offset = 0, duration = 60) {
  const beatInterval = 60 / bpm;
  const beats = [];

  // Start from offset, generate beats until duration
  for (let time = offset; time < duration; time += beatInterval) {
    if (time >= 0) {
      beats.push(parseFloat(time.toFixed(3)));
    }
  }

  return beats;
}

/**
 * Basic fallback beat detection using onset detection
 * Used when the professional library fails
 */
function detectBeatsBasic(audioBuffer) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  // Parameters
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms windows
  const hopSize = Math.floor(windowSize / 2);

  // Calculate energy for each window
  const energies = [];
  for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      energy += channelData[i + j] * channelData[i + j];
    }
    energies.push(energy / windowSize);
  }

  // Normalize energies
  const maxEnergy = Math.max(...energies);
  if (maxEnergy === 0) {
    return { bpm: 120, beats: generateBeatTimestamps(120, 0, duration) };
  }

  const normalizedEnergies = energies.map(e => e / maxEnergy);

  // Detect onsets (sudden increases in energy)
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

  // Estimate BPM from onset intervals
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
