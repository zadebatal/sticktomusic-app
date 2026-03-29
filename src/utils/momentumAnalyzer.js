/**
 * momentumAnalyzer.js — Pure audio analysis for momentum-based smart cuts.
 *
 * Pipeline (4 stages, each a pure exported function):
 *   1. computeEnergyCurve  — RMS energy in 20ms windows, 10ms hop
 *   2. detectSegments      — Smooth energy → verse (LOW) / chorus (HIGH) segments
 *   3. detectOnsets         — Half-wave rectified energy diff → transient peaks
 *   4. generateCutPoints   — Preset-specific cut placement (Hype / Chill / Story)
 *
 * Stages 1-3 run once (~200ms for 30s audio). Stage 4 is instant (<1ms).
 *
 * No React, no external deps. Uses Web Audio API decode (same pattern as waveformGenerator.js).
 */

import log from './logger';

// ─── Stage 1: Energy Curve ────────────────────────────────────────────────────

/**
 * Compute RMS energy in 20ms windows with 10ms hop.
 * @param {Float32Array} channelData — raw PCM samples
 * @param {number} sampleRate
 * @returns {{ time: number, energy: number }[]} — normalized 0-1
 */
export function computeEnergyCurve(channelData, sampleRate) {
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms
  const hopSize = Math.floor(sampleRate * 0.01); // 10ms
  const frames = [];

  for (let i = 0; i + windowSize <= channelData.length; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = channelData[i + j];
      sum += s * s;
    }
    frames.push({
      time: i / sampleRate,
      energy: Math.sqrt(sum / windowSize),
    });
  }

  // Normalize to 0-1
  const maxEnergy = frames.reduce((m, f) => Math.max(m, f.energy), 0);
  if (maxEnergy > 0) {
    for (const f of frames) f.energy = f.energy / maxEnergy;
  }

  return frames;
}

// ─── Stage 2: Segment Detection ──────────────────────────────────────────────

/**
 * Smooth energy curve and threshold at median to detect HIGH/LOW segments.
 * @param {{ time: number, energy: number }[]} energyCurve
 * @returns {{ start: number, end: number, avgEnergy: number, isHigh: boolean }[]}
 */
export function detectSegments(energyCurve) {
  if (energyCurve.length < 2) {
    return [{ start: 0, end: energyCurve[0]?.time || 0, avgEnergy: 0.5, isHigh: false }];
  }

  // Smooth with 500ms window (50 frames at 10ms hop)
  const smoothWindow = 50;
  const smoothed = [];
  for (let i = 0; i < energyCurve.length; i++) {
    const lo = Math.max(0, i - Math.floor(smoothWindow / 2));
    const hi = Math.min(energyCurve.length, i + Math.ceil(smoothWindow / 2));
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += energyCurve[j].energy;
    smoothed.push(hi - lo > 0 ? sum / (hi - lo) : 0);
  }

  // Threshold at median
  const sorted = [...smoothed].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Build runs of HIGH/LOW
  const segments = [];
  let segStart = 0;
  let segHigh = smoothed[0] >= median;
  let segEnergySum = smoothed[0];
  let segCount = 1;

  for (let i = 1; i < smoothed.length; i++) {
    const isHigh = smoothed[i] >= median;
    if (isHigh !== segHigh) {
      segments.push({
        start: energyCurve[segStart].time,
        end: energyCurve[i].time,
        avgEnergy: segEnergySum / segCount,
        isHigh: segHigh,
      });
      segStart = i;
      segHigh = isHigh;
      segEnergySum = 0;
      segCount = 0;
    }
    segEnergySum += smoothed[i];
    segCount++;
  }

  // Final segment
  segments.push({
    start: energyCurve[segStart].time,
    end: energyCurve[energyCurve.length - 1].time,
    avgEnergy: segEnergySum / segCount,
    isHigh: segHigh,
  });

  // Merge tiny segments (<0.3s) into neighbors
  const merged = [];
  for (const seg of segments) {
    if (merged.length > 0 && seg.end - seg.start < 0.3) {
      merged[merged.length - 1].end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.length > 0 ? merged : segments;
}

// ─── Stage 3: Onset Detection ────────────────────────────────────────────────

/**
 * Half-wave rectified energy difference + adaptive threshold + peak picking.
 * @param {{ time: number, energy: number }[]} energyCurve
 * @returns {{ time: number, strength: number }[]}
 */
export function detectOnsets(energyCurve) {
  if (energyCurve.length < 3) return [];

  // Compute energy difference (half-wave rectified)
  const diff = [];
  for (let i = 1; i < energyCurve.length; i++) {
    const d = energyCurve[i].energy - energyCurve[i - 1].energy;
    diff.push(Math.max(0, d)); // half-wave rectify: only positive changes
  }

  // Adaptive threshold: running mean of diff * 1.5
  const threshWindow = 30; // ~300ms
  const onsets = [];

  for (let i = 1; i < diff.length - 1; i++) {
    // Local mean
    const lo = Math.max(0, i - threshWindow);
    const hi = Math.min(diff.length, i + threshWindow);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += diff[j];
    const localMean = hi - lo > 0 ? sum / (hi - lo) : 0;
    const threshold = localMean * 1.5 + 0.01; // +0.01 for silence rejection

    // Peak picking: local maximum above threshold
    if (diff[i] > threshold && diff[i] >= diff[i - 1] && diff[i] >= diff[i + 1]) {
      onsets.push({
        time: energyCurve[i + 1].time, // +1 because diff is offset by 1
        strength: diff[i],
      });
    }
  }

  // Normalize strengths to 0-1
  const maxStr = onsets.reduce((m, o) => Math.max(m, o.strength), 0);
  if (maxStr > 0) {
    for (const o of onsets) o.strength = o.strength / maxStr;
  }

  return onsets;
}

// ─── Stage 4: Cut Point Generation ───────────────────────────────────────────

/**
 * Generate cut points based on preset.
 * @param {{ time: number, energy: number }[]} energyCurve
 * @param {{ time: number, strength: number }[]} onsets
 * @param {{ start: number, end: number, avgEnergy: number, isHigh: boolean }[]} segments
 * @param {'hype'|'chill'|'story'} preset
 * @param {number} duration — total duration in seconds
 * @returns {number[]} — sorted timestamps
 */
export function generateCutPoints(energyCurve, onsets, segments, preset, duration) {
  if (duration <= 0) return [0];

  switch (preset) {
    case 'hype':
      return generateHypeCuts(onsets, segments, duration);
    case 'chill':
      return generateChillCuts(onsets, segments, duration);
    case 'story':
      return generateStoryCuts(onsets, segments, duration);
    default:
      return generateStoryCuts(onsets, segments, duration);
  }
}

function generateHypeCuts(onsets, segments, duration) {
  const MIN_INTERVAL = 0.25;
  const points = new Set();

  // Include top 70% of onsets
  const sorted = [...onsets].sort((a, b) => b.strength - a.strength);
  const cutoff = Math.ceil(sorted.length * 0.7);
  for (let i = 0; i < cutoff; i++) {
    points.add(sorted[i].time);
  }

  // In high-energy segments, fill gaps >0.5s
  for (const seg of segments) {
    if (!seg.isHigh) continue;
    const segPoints = [...points]
      .filter((t) => t >= seg.start && t <= seg.end)
      .sort((a, b) => a - b);
    let prev = seg.start;
    for (const t of segPoints) {
      if (t - prev > 0.5) {
        // Fill gap
        const count = Math.floor((t - prev) / 0.4);
        for (let j = 1; j < count; j++) {
          points.add(prev + j * ((t - prev) / count));
        }
      }
      prev = t;
    }
    if (seg.end - prev > 0.5) {
      const count = Math.floor((seg.end - prev) / 0.4);
      for (let j = 1; j < count; j++) {
        points.add(prev + j * ((seg.end - prev) / count));
      }
    }
  }

  // Build-up effect: last 2s of LOW→HIGH transitions
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].isHigh && !segments[i - 1].isHigh) {
      const transTime = segments[i].start;
      const buildStart = Math.max(transTime - 2, segments[i - 1].start);
      // Accelerating cuts: start at 0.5s interval, narrow to 0.2s
      let t = buildStart;
      let interval = 0.5;
      while (t < transTime) {
        points.add(t);
        t += interval;
        interval = Math.max(0.2, interval * 0.7);
      }
    }
  }

  return dedupeAndSort(points, MIN_INTERVAL, duration);
}

function generateChillCuts(onsets, segments, duration) {
  const MIN_INTERVAL = 1.5;
  const points = new Set();

  // Only top 20% strongest onsets
  const sorted = [...onsets].sort((a, b) => b.strength - a.strength);
  const cutoff = Math.ceil(sorted.length * 0.2);
  for (let i = 0; i < cutoff; i++) {
    points.add(sorted[i].time);
  }

  // In quiet sections, use 3s minimum interval (double the base)
  // Fill gaps >4s with evenly spaced points
  const allPoints = [...points].sort((a, b) => a - b);
  let prev = 0;
  const toAdd = [];
  for (const t of allPoints) {
    if (t - prev > 4) {
      const interval = getSegmentInterval(prev, segments) ? 2.5 : 3;
      const count = Math.floor((t - prev) / interval);
      for (let j = 1; j <= count; j++) {
        toAdd.push(prev + j * ((t - prev) / (count + 1)));
      }
    }
    prev = t;
  }
  // Fill gap at the end
  if (duration - prev > 4) {
    const interval = 3;
    const count = Math.floor((duration - prev) / interval);
    for (let j = 1; j <= count; j++) {
      toAdd.push(prev + j * ((duration - prev) / (count + 1)));
    }
  }
  for (const t of toAdd) points.add(t);

  return dedupeAndSort(points, MIN_INTERVAL, duration);
}

function generateStoryCuts(onsets, segments, duration) {
  const MIN_INTERVAL = 0.5;
  const points = new Set();

  // Hard cut at every segment boundary
  for (const seg of segments) {
    points.add(seg.start);
  }

  // HIGH segments: onset-driven (dense cuts)
  for (const seg of segments) {
    if (seg.isHigh) {
      for (const o of onsets) {
        if (o.time >= seg.start && o.time <= seg.end) {
          points.add(o.time);
        }
      }
    }
  }

  // LOW segments: fixed 2.5s intervals (steady pacing)
  for (const seg of segments) {
    if (!seg.isHigh) {
      const segDur = seg.end - seg.start;
      const count = Math.max(1, Math.floor(segDur / 2.5));
      const interval = segDur / count;
      for (let j = 0; j < count; j++) {
        points.add(seg.start + j * interval);
      }
    }
  }

  // DROP points: energy jumps >2x → hold 0.3s before for dramatic effect
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].isHigh && segments[i].avgEnergy > segments[i - 1].avgEnergy * 2) {
      const dropTime = segments[i].start;
      // Remove any cut in the 0.3s before the drop
      for (const p of points) {
        if (p > dropTime - 0.3 && p < dropTime) points.delete(p);
      }
      points.add(dropTime);
    }
  }

  return dedupeAndSort(points, MIN_INTERVAL, duration);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a time falls in a high-energy segment */
function getSegmentInterval(time, segments) {
  for (const seg of segments) {
    if (time >= seg.start && time <= seg.end) return seg.isHigh;
  }
  return false;
}

/** Deduplicate, enforce minimum interval, clamp to [0, duration], sort */
function dedupeAndSort(pointsSet, minInterval, duration) {
  let arr = [...pointsSet].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);

  // Enforce minimum interval
  const filtered = [];
  let lastT = -Infinity;
  for (const t of arr) {
    if (t - lastT >= minInterval) {
      filtered.push(t);
      lastT = t;
    }
  }

  // Always include t=0 as first cut
  if (filtered.length === 0 || filtered[0] > 0.01) {
    filtered.unshift(0);
  }

  // Fallback: if too few cuts, add evenly spaced
  if (filtered.length < 2 && duration > 0) {
    const targetCount = Math.max(2, Math.floor(duration / 3));
    const interval = duration / targetCount;
    const fallback = [];
    for (let i = 0; i < targetCount; i++) {
      fallback.push(i * interval);
    }
    return fallback;
  }

  return filtered;
}

// ─── Auto Preset Selection ──────────────────────────────────────────────────

/**
 * Automatically select the best cut preset based on the energy profile.
 * High energy → hype, low energy → chill, mixed → story.
 *
 * @param {Array<{ time: number, energy: number }>} energyCurve — from computeEnergyCurve()
 * @returns {'hype' | 'chill' | 'story'}
 */
export function autoSelectCutPreset(energyCurve) {
  if (!energyCurve || energyCurve.length === 0) return 'story';

  const avgEnergy = energyCurve.reduce((sum, p) => sum + p.energy, 0) / energyCurve.length;
  const highCount = energyCurve.filter((p) => p.energy > 0.6).length;
  const highRatio = highCount / energyCurve.length;

  // Mostly high energy → hype
  if (avgEnergy > 0.5 && highRatio > 0.4) return 'hype';
  // Mostly low energy → chill
  if (avgEnergy < 0.25 && highRatio < 0.15) return 'chill';
  // Mixed → story (segment-aware cuts)
  return 'story';
}

// ─── Convenience Wrapper ─────────────────────────────────────────────────────

/**
 * Full analysis pipeline: decode audio → compute all stages → return results.
 * @param {string|Blob} audioSource — URL or Blob (rejects blob: URLs)
 * @param {'hype'|'chill'|'story'} preset
 * @param {{ trimStart?: number, trimEnd?: number }} options
 * @returns {Promise<{ cutPoints: number[], energyCurve: object[], segments: object[], onsets: object[], duration: number }>}
 */
export async function analyzeMomentum(
  audioSource,
  preset = 'story',
  { trimStart = 0, trimEnd } = {},
) {
  if (!audioSource) throw new Error('No audio source provided');
  if (typeof audioSource === 'string' && audioSource.startsWith('blob:')) {
    throw new Error('Blob URLs not supported — use a persistent URL');
  }

  // Decode audio via Web Audio API
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  let arrayBuffer;
  if (audioSource instanceof Blob) {
    arrayBuffer = await audioSource.arrayBuffer();
  } else {
    const resp = await fetch(audioSource, { mode: 'cors' });
    arrayBuffer = await resp.arrayBuffer();
  }

  const buffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const sampleRate = buffer.sampleRate;
  const fullChannelData = buffer.getChannelData(0);
  const fullDuration = buffer.duration;

  // Apply trim boundaries
  const startSample = Math.floor((trimStart || 0) * sampleRate);
  const endSample = trimEnd ? Math.floor(trimEnd * sampleRate) : fullChannelData.length;
  const channelData = fullChannelData.slice(startSample, endSample);
  const duration = (endSample - startSample) / sampleRate;

  log.info(`[Momentum] Analyzing ${duration.toFixed(1)}s of audio (${preset} preset)`);

  // Run pipeline stages 1-3
  const energyCurve = computeEnergyCurve(channelData, sampleRate);
  const segments = detectSegments(energyCurve);
  const onsets = detectOnsets(energyCurve);

  // Stage 4: generate cuts for the requested preset
  const cutPoints = generateCutPoints(energyCurve, onsets, segments, preset, duration);

  log.info(
    `[Momentum] ${cutPoints.length} cut points generated (${segments.length} segments, ${onsets.length} onsets)`,
  );

  return { cutPoints, energyCurve, segments, onsets, duration };
}
