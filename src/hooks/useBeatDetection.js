import { useState, useCallback } from 'react';

/**
 * Custom hook for beat detection in audio files.
 * Uses a simplified algorithm based on onset detection.
 * For production, consider using libraries like:
 * - music-tempo (npm install music-tempo)
 * - web-audio-beat-detector (npm install web-audio-beat-detector)
 */
export const useBeatDetection = () => {
  const [beats, setBeats] = useState([]);
  const [bpm, setBpm] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Analyze audio file for beats
   */
  const analyzeAudio = useCallback(async (audioFile) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // Create audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Read file as array buffer
      const arrayBuffer = await audioFile.arrayBuffer();

      // Decode audio data
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Get audio data (mono - use first channel or mix down)
      let channelData;
      if (audioBuffer.numberOfChannels === 1) {
        channelData = audioBuffer.getChannelData(0);
      } else {
        // Mix stereo to mono
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.getChannelData(1);
        channelData = new Float32Array(left.length);
        for (let i = 0; i < left.length; i++) {
          channelData[i] = (left[i] + right[i]) / 2;
        }
      }

      const sampleRate = audioBuffer.sampleRate;
      const duration = audioBuffer.duration;

      // Detect beats using onset detection
      const result = detectBeats(channelData, sampleRate, duration);

      setBpm(result.bpm);
      setBeats(result.beats);

      // Close audio context
      await audioContext.close();

      return result;

    } catch (err) {
      console.error('Beat detection error:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  /**
   * Generate beats from a known BPM
   */
  const generateBeatsFromBPM = useCallback((bpmValue, offset = 0, duration = 60) => {
    const beatInterval = 60 / bpmValue;
    const generatedBeats = [];

    for (let time = offset; time < duration; time += beatInterval) {
      generatedBeats.push(parseFloat(time.toFixed(3)));
    }

    setBpm(bpmValue);
    setBeats(generatedBeats);

    return generatedBeats;
  }, []);

  /**
   * Clear beat data
   */
  const clearBeats = useCallback(() => {
    setBeats([]);
    setBpm(null);
    setError(null);
  }, []);

  return {
    beats,
    bpm,
    isAnalyzing,
    error,
    analyzeAudio,
    generateBeatsFromBPM,
    clearBeats
  };
};

/**
 * Simple beat detection algorithm using onset detection
 * For better results, use a dedicated library like music-tempo
 */
function detectBeats(audioData, sampleRate, duration) {
  // Parameters
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms windows
  const hopSize = Math.floor(windowSize / 2);

  // Calculate energy for each window
  const energies = [];
  for (let i = 0; i < audioData.length - windowSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      energy += audioData[i + j] * audioData[i + j];
    }
    energies.push(energy / windowSize);
  }

  // Normalize energies
  const maxEnergy = Math.max(...energies);
  const normalizedEnergies = energies.map(e => e / maxEnergy);

  // Detect onsets (sudden increases in energy)
  const onsets = [];
  const threshold = 0.15;
  const minTimeBetweenOnsets = 0.15; // Minimum 150ms between beats

  for (let i = 1; i < normalizedEnergies.length; i++) {
    const diff = normalizedEnergies[i] - normalizedEnergies[i - 1];
    if (diff > threshold) {
      const time = (i * hopSize) / sampleRate;

      // Check minimum time between beats
      if (onsets.length === 0 || time - onsets[onsets.length - 1] >= minTimeBetweenOnsets) {
        onsets.push(parseFloat(time.toFixed(3)));
      }
    }
  }

  // Estimate BPM from onset intervals
  let bpm = 120; // Default BPM
  if (onsets.length >= 4) {
    const intervals = [];
    for (let i = 1; i < Math.min(onsets.length, 50); i++) {
      intervals.push(onsets[i] - onsets[i - 1]);
    }

    // Sort intervals and find the most common one
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];

    // Convert interval to BPM
    if (medianInterval > 0) {
      bpm = Math.round(60 / medianInterval);

      // Constrain BPM to reasonable range
      while (bpm < 60) bpm *= 2;
      while (bpm > 180) bpm /= 2;
    }
  }

  // Regenerate beat grid based on detected BPM
  const beatInterval = 60 / bpm;
  const beats = [];

  // Find first beat offset
  const firstBeat = onsets.length > 0 ? onsets[0] % beatInterval : 0;

  for (let time = firstBeat; time < duration; time += beatInterval) {
    beats.push(parseFloat(time.toFixed(3)));
  }

  return { bpm, beats };
}

export default useBeatDetection;
