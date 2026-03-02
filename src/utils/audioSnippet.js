/**
 * Audio Snippet Utility — Extract a trimmed WAV from any audio source.
 *
 * Extracted from LyricAnalyzer.jsx for reuse across song recognition
 * and lyric analysis flows.
 */

/**
 * Convert an AudioBuffer to a WAV Blob.
 * @param {AudioBuffer} buffer
 * @returns {Blob}
 */
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, bufferLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Extract a trimmed audio snippet as a WAV File.
 *
 * @param {File|Blob|string} source - Audio file, blob, or HTTPS URL
 * @param {number} startSec - Start time in seconds
 * @param {number} endSec - End time in seconds
 * @param {Object} options - Optional settings
 * @param {boolean} options.mono - Downmix to mono (default: false)
 * @param {number} options.targetSampleRate - Resample to this rate (default: keep original)
 * @returns {Promise<File>} Trimmed WAV file
 */
export async function extractAudioSnippet(source, startSec, endSec, options = {}) {
  const { mono = false, targetSampleRate = null } = options;

  // Fetch audio data
  let arrayBuffer;
  if (source instanceof File || source instanceof Blob) {
    arrayBuffer = await source.arrayBuffer();
  } else if (typeof source === 'string') {
    if (source.startsWith('blob:')) {
      throw new Error('Blob URLs are not supported for audio extraction');
    }
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
    arrayBuffer = await response.arrayBuffer();
  } else {
    throw new Error('Invalid audio source');
  }

  // Decode audio — use target sample rate if provided (browser resamples automatically)
  const decodeRate = targetSampleRate || undefined;
  const audioContext = new (window.AudioContext || window.webkitAudioContext)(
    decodeRate ? { sampleRate: decodeRate } : undefined
  );
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Clamp to actual duration
  const actualStart = Math.max(0, Math.min(startSec, audioBuffer.duration));
  const actualEnd = Math.min(endSec, audioBuffer.duration);

  // If the audio is shorter than the requested range, use what we have
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.floor(actualStart * sampleRate);
  const endSample = Math.floor(actualEnd * sampleRate);
  const duration = Math.max(endSample - startSample, 1);
  const outChannels = mono ? 1 : audioBuffer.numberOfChannels;

  // Create trimmed buffer
  const trimmedBuffer = audioContext.createBuffer(outChannels, duration, sampleRate);

  if (mono && audioBuffer.numberOfChannels > 1) {
    // Downmix to mono by averaging all channels
    const destData = trimmedBuffer.getChannelData(0);
    const numCh = audioBuffer.numberOfChannels;
    for (let i = 0; i < duration; i++) {
      let sum = 0;
      for (let ch = 0; ch < numCh; ch++) {
        sum += audioBuffer.getChannelData(ch)[startSample + i];
      }
      destData[i] = sum / numCh;
    }
  } else {
    for (let channel = 0; channel < outChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const destData = trimmedBuffer.getChannelData(channel);
      for (let i = 0; i < duration; i++) {
        destData[i] = sourceData[startSample + i];
      }
    }
  }

  const wavBlob = audioBufferToWav(trimmedBuffer);
  audioContext.close();

  return new File([wavBlob], 'snippet.wav', { type: 'audio/wav' });
}

/**
 * Trim audio to a specific time range (for lyric analysis).
 * Same as extractAudioSnippet but with default naming.
 *
 * @param {File|Blob|string} source
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds
 * @returns {Promise<File>}
 */
export async function trimAudio(source, start, end) {
  const file = await extractAudioSnippet(source, start || 0, end || Infinity);
  return new File([file], 'trimmed-audio.wav', { type: 'audio/wav' });
}
