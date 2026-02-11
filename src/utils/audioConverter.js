/**
 * audioConverter — Client-side audio-to-MP3 conversion
 *
 * Converts .wav, .m4a, .aif/.aiff, .ogg, .flac, .aac files to MP3 at upload time.
 * MP3 is universally supported by browsers and much smaller than WAV/AIFF.
 *
 * Uses Web Audio API for decoding + lamejs for MP3 encoding (already in project).
 */
// eslint-disable-next-line no-undef
const lamejs = require('lamejs');

const AUDIO_EXTENSIONS = ['.wav', '.m4a', '.aif', '.aiff', '.ogg', '.flac', '.aac', '.wma'];

/**
 * Check if a file is an audio file (any format).
 */
export const isAudioFile = (file) => {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('audio/')) return true;
  const name = (file.name || '').toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => name.endsWith(ext)) || name.endsWith('.mp3');
};

/**
 * Check if a file is a non-MP3 audio file that needs conversion.
 */
export const needsAudioConversion = (file) => {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type === 'audio/mpeg' || type === 'audio/mp3') return false;
  if (type.startsWith('audio/')) return true;
  const name = (file.name || '').toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => name.endsWith(ext));
};

/**
 * Encode an AudioBuffer as MP3 using lamejs.
 */
function encodeMP3(buffer) {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const kbps = 192;

  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);

  const channelData = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }

  const mp3Data = [];
  const chunkSize = 4096;

  for (let i = 0; i < buffer.length; i += chunkSize) {
    const sampleChunkSize = Math.min(chunkSize, buffer.length - i);

    // Convert float32 samples to int16
    const toInt16 = (floatData, offset, length) => {
      const int16 = new Int16Array(length);
      for (let j = 0; j < length; j++) {
        const s = Math.max(-1, Math.min(1, floatData[offset + j]));
        int16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return int16;
    };

    let encoded;
    if (numChannels === 1) {
      encoded = encoder.encodeBuffer(toInt16(channelData[0], i, sampleChunkSize));
    } else {
      const left = toInt16(channelData[0], i, sampleChunkSize);
      const right = channelData.length > 1
        ? toInt16(channelData[1], i, sampleChunkSize)
        : left;
      encoded = encoder.encodeBuffer(left, right);
    }
    if (encoded.length > 0) mp3Data.push(encoded);
  }

  const finalFrame = encoder.flush();
  if (finalFrame.length > 0) mp3Data.push(finalFrame);

  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

/**
 * Convert a non-MP3 audio file to MP3 using Web Audio API + lamejs.
 * @param {File} file — audio input file
 * @returns {Promise<File>} — MP3 file
 */
export const convertAudioToMp3 = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const mp3Blob = encodeMP3(audioBuffer);
    const newName = file.name.replace(/\.[^.]+$/, '.mp3');
    return new File([mp3Blob], newName, { type: 'audio/mpeg' });
  } finally {
    await audioContext.close();
  }
};

/**
 * Convert audio to MP3 if needed. MP3 files pass through unchanged.
 * @param {File} file — input file
 * @returns {Promise<File>} — MP3 file, or original if already MP3
 */
export const convertAudioIfNeeded = async (file) => {
  if (!needsAudioConversion(file)) return file;
  return convertAudioToMp3(file);
};
