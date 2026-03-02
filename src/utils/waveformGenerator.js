/**
 * Shared waveform generation utility.
 * Works with both audio files and video files (extracts audio track via Web Audio API).
 * Includes URL-keyed in-memory cache to avoid re-fetching the same source.
 */

import log from './logger';

const cache = new Map();
const bufferCache = new Map(); // Cache decoded AudioBuffers by URL

/**
 * Decode an audio/video source into an AudioBuffer, with caching.
 */
async function getAudioBuffer(source) {
  const cacheKey = source instanceof Blob ? null : source;
  if (cacheKey && bufferCache.has(cacheKey)) return bufferCache.get(cacheKey);

  // Yield to main thread before heavy work
  await new Promise(r => setTimeout(r, 0));

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Safari AudioContext may start in 'suspended' state - resume on first use
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  let arrayBuffer;
  if (source instanceof Blob) {
    arrayBuffer = await source.arrayBuffer();
  } else {
    // IMPORTANT: use cache: 'no-store' to avoid getting a cached partial response
    // from the <video preload="metadata"> range request (which only fetches the first chunk).
    const resp = await fetch(source, { mode: 'cors', cache: 'no-store' });
    arrayBuffer = await resp.arrayBuffer();
  }

  // Yield before CPU-heavy decode
  await new Promise(r => setTimeout(r, 0));
  const buffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  log.info(`[Waveform] Decoded ${buffer.duration.toFixed(1)}s audio (${buffer.sampleRate}Hz, ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
  if (cacheKey) bufferCache.set(cacheKey, buffer);
  return buffer;
}

/**
 * Sample normalized amplitudes from raw PCM data.
 */
function sampleWaveform(rawData, samples) {
  const blockSize = Math.floor(rawData.length / samples);
  if (blockSize === 0) return [];
  const filteredData = [];
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(rawData[(i * blockSize) + j]);
    }
    filteredData.push(sum / blockSize);
  }
  const max = Math.max(...filteredData);
  if (max === 0) return filteredData;
  return filteredData.map(d => d / max);
}

/**
 * Generate normalized waveform amplitude data from an audio/video source.
 * @param {Blob|string} source — Blob or URL (works for both audio and video files)
 * @param {number} samples — number of amplitude samples to return
 * @returns {Promise<number[]>} — normalized amplitudes 0..1, or [] on failure
 */
export async function generateWaveformData(source, samples = 200) {
  if (!source) return [];
  if (typeof source === 'string' && source.startsWith('blob:')) {
    log.warn('[Waveform] Rejected stale blob URL:', source.slice(0, 40));
    return [];
  }
  try {
    const buffer = await getAudioBuffer(source);
    const rawData = buffer.getChannelData(0);
    return sampleWaveform(rawData, samples);
  } catch (err) {
    log.warn('Waveform generation failed:', err.message);
    return [];
  }
}

/**
 * Same as generateWaveformData but also returns the authoritative audio duration
 * from AudioBuffer (more reliable than HTML audio element or stored metadata).
 * @returns {Promise<{ data: number[], duration: number }>}
 */
export async function generateWaveformDataWithDuration(source, samples = 200) {
  if (!source) return { data: [], duration: 0 };
  if (typeof source === 'string' && source.startsWith('blob:')) {
    return { data: [], duration: 0 };
  }
  try {
    const buffer = await getAudioBuffer(source);
    const rawData = buffer.getChannelData(0);
    return { data: sampleWaveform(rawData, samples), duration: buffer.duration };
  } catch (err) {
    log.warn('Waveform generation failed:', err.message);
    return { data: [], duration: 0 };
  }
}

/**
 * Generate waveform data from a URL with in-memory caching.
 * @param {string} url — audio or video URL
 * @param {number} samples
 * @returns {Promise<number[]>}
 */
export async function generateWaveformFromUrl(url, samples = 200) {
  if (!url) return [];
  if (url.startsWith('blob:')) {
    log.warn('[Waveform] Rejected stale blob URL:', url.slice(0, 40));
    return [];
  }
  const key = `${url}::${samples}`;
  if (cache.has(key)) return cache.get(key);
  const data = await generateWaveformData(url, samples);
  if (data.length > 0) {
    cache.set(key, data);
  }
  return data;
}

/**
 * Generate waveform for a specific time range of a source (e.g. a clip's portion).
 * Extracts only [0, clipDuration] seconds of the source audio.
 * @param {string} url — source video/audio URL
 * @param {number} clipDuration — how many seconds of audio to visualize
 * @param {number} samples — number of amplitude samples
 * @returns {Promise<number[]>}
 */
export async function generateWaveformForClip(url, clipDuration, samples = 200) {
  if (!url || !clipDuration || clipDuration <= 0) return [];
  const key = `${url}::clip::${clipDuration.toFixed(2)}::${samples}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const buffer = await getAudioBuffer(url);
    const rawData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    // Extract only the first clipDuration seconds
    const endSample = Math.min(Math.floor(clipDuration * sampleRate), rawData.length);
    const sliced = rawData.slice(0, endSample);
    const data = sampleWaveform(sliced, samples);
    if (data.length > 0) cache.set(key, data);
    return data;
  } catch (err) {
    log.warn('Clip waveform generation failed:', err.message);
    return [];
  }
}

/**
 * Clear the waveform cache (call on component unmount).
 */
export function clearWaveformCache() {
  cache.clear();
  bufferCache.clear();
}
