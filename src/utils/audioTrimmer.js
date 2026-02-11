import { Mp3Encoder } from '@breezystack/lamejs';

/**
 * Audio Trimmer Utility
 * Extracts a section of audio using the Web Audio API and returns it as a new File.
 * The trimmed audio is encoded as MP3 for smaller file sizes.
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

  onProgress?.('Encoding MP3...');

  // Encode as MP3
  const mp3Blob = encodeMP3(trimmedBuffer);

  // Clean up
  await audioContext.close();

  // Create a File from the blob
  const fileName = `${outputName}.mp3`;
  return new File([mp3Blob], fileName, { type: 'audio/mpeg' });
}

/**
 * Encode an AudioBuffer as MP3 using lamejs
 * @param {AudioBuffer} buffer - The audio buffer to encode
 * @returns {Blob} - MP3-encoded blob
 */
function encodeMP3(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const kbps = 128; // Bitrate: 128kbps provides good quality-to-size ratio

  // Initialize the encoder
  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps);

  // Prepare channel data
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }

  // Convert Float32 samples (-1.0 to 1.0) to Int16 (-32768 to 32767) for lamejs
  const toInt16 = (floatData, offset, length) => {
    const int16 = new Int16Array(length);
    for (let j = 0; j < length; j++) {
      const s = Math.max(-1, Math.min(1, floatData[offset + j]));
      int16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  };

  // Encode in chunks (process samples in batches for efficiency)
  const mp3Data = [];
  const chunkSize = 4096;

  for (let i = 0; i < buffer.length; i += chunkSize) {
    const sampleChunkSize = Math.min(chunkSize, buffer.length - i);

    if (numChannels === 1) {
      // Mono
      const encoded = encoder.encodeBuffer(toInt16(channelData[0], i, sampleChunkSize));
      if (encoded.length > 0) {
        mp3Data.push(encoded);
      }
    } else if (numChannels === 2) {
      // Stereo
      const left = toInt16(channelData[0], i, sampleChunkSize);
      const right = toInt16(channelData[1], i, sampleChunkSize);
      const encoded = encoder.encodeBuffer(left, right);
      if (encoded.length > 0) {
        mp3Data.push(encoded);
      }
    } else {
      // Multi-channel: downmix to stereo, then convert to Int16
      const leftFloat = new Float32Array(sampleChunkSize);
      const rightFloat = new Float32Array(sampleChunkSize);

      for (let j = 0; j < sampleChunkSize; j++) {
        let leftSample = 0;
        let rightSample = 0;

        for (let ch = 0; ch < numChannels; ch++) {
          const sample = channelData[ch][i + j];
          if (ch % 2 === 0) {
            leftSample += sample / (numChannels / 2);
          } else {
            rightSample += sample / (numChannels / 2);
          }
        }

        leftFloat[j] = leftSample;
        rightFloat[j] = rightSample;
      }

      const left = toInt16(leftFloat, 0, sampleChunkSize);
      const right = toInt16(rightFloat, 0, sampleChunkSize);
      const encoded = encoder.encodeBuffer(left, right);
      if (encoded.length > 0) {
        mp3Data.push(encoded);
      }
    }
  }

  // Finalize the encoding
  const finalFrame = encoder.flush();
  if (finalFrame.length > 0) {
    mp3Data.push(finalFrame);
  }

  return new Blob(mp3Data, { type: 'audio/mpeg' });
}
