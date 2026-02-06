/**
 * Audio Trimmer Utility
 * Extracts a section of audio using the Web Audio API and returns it as a new File.
 * The trimmed audio is encoded as WAV for maximum compatibility.
 */

/**
 * Trim an audio source to a specific time range and return as a new File
 * @param {string|File|Blob} audioSource - URL, File, or Blob of the audio
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {string} outputName - Name for the output file (without extension)
 * @param {Function} onProgress - Optional progress callback
 * @returns {Promise<File>} - New File containing only the trimmed audio
 */
export async function trimAudioToFile(audioSource, startTime, endTime, outputName = 'trimmed_audio', onProgress) {
  onProgress?.('Loading audio...');

  // Get array buffer from source
  let arrayBuffer;
  if (audioSource instanceof File || audioSource instanceof Blob) {
    arrayBuffer = await audioSource.arrayBuffer();
  } else if (typeof audioSource === 'string') {
    const response = await fetch(audioSource);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
    const blob = await response.blob();
    arrayBuffer = await blob.arrayBuffer();
  } else {
    throw new Error('Invalid audio source');
  }

  onProgress?.('Decoding audio...');

  // Decode the audio
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;

  // Calculate sample boundaries
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.min(Math.floor(endTime * sampleRate), audioBuffer.length);
  const trimmedLength = endSample - startSample;

  if (trimmedLength <= 0) {
    throw new Error('Invalid trim range: no audio samples in the selected region');
  }

  onProgress?.('Trimming audio...');

  // Create a new buffer with just the trimmed section
  const trimmedBuffer = audioContext.createBuffer(numChannels, trimmedLength, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const targetData = trimmedBuffer.getChannelData(ch);
    for (let i = 0; i < trimmedLength; i++) {
      targetData[i] = sourceData[startSample + i];
    }
  }

  onProgress?.('Encoding WAV...');

  // Encode as WAV
  const wavBlob = encodeWAV(trimmedBuffer);

  // Clean up
  await audioContext.close();

  // Create a File from the blob
  const fileName = `${outputName}.wav`;
  return new File([wavBlob], fileName, { type: 'audio/wav' });
}

/**
 * Encode an AudioBuffer as WAV
 * @param {AudioBuffer} buffer - The audio buffer to encode
 * @returns {Blob} - WAV-encoded blob
 */
function encodeWAV(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write interleaved samples
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
