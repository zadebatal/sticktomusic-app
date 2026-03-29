/**
 * smartDurationMatcher.js — Beat-aware clip selection for target duration
 *
 * Selects clips to fill an exact duration, using beat markers as natural
 * cut points and preferring clips with lowest usage count (clip recycling).
 */

/**
 * Select clips to fill a target duration, aligning cuts to beat positions.
 *
 * Strategy:
 * 1. Sort clips by useCount ascending (freshest first)
 * 2. Greedily pick clips until target duration is met
 * 3. Snap clip boundaries to nearest beat for natural transitions
 *
 * @param {Array<{ id: string, duration: number, useCount?: number }>} clips - Available clips
 * @param {number} targetDuration - Target total duration in seconds
 * @param {number[]} [beats] - Beat timestamps in seconds (optional, for snapping)
 * @returns {{ selectedClips: Array<{ id: string, startTime: number, endTime: number, duration: number }>, totalDuration: number }}
 */
export function selectClipsForDuration(clips, targetDuration, beats = []) {
  if (!clips?.length || !targetDuration || targetDuration <= 0) {
    return { selectedClips: [], totalDuration: 0 };
  }

  // Sort by useCount ascending (unused first), then by creation order
  const sorted = [...clips]
    .filter((c) => c.duration > 0)
    .sort((a, b) => (a.useCount || 0) - (b.useCount || 0));

  if (sorted.length === 0) return { selectedClips: [], totalDuration: 0 };

  const sortedBeats = [...beats].sort((a, b) => a - b);
  const selected = [];
  let remaining = targetDuration;
  let clipIndex = 0;

  while (remaining > 0.5 && clipIndex < sorted.length) {
    const clip = sorted[clipIndex];
    clipIndex++;

    // Use full clip or trim to remaining duration
    let useDuration = Math.min(clip.duration, remaining);

    // Snap to nearest beat if beats are available
    if (sortedBeats.length > 0) {
      const currentPosition = targetDuration - remaining;
      const endPosition = currentPosition + useDuration;
      const nearestBeat = findNearestBeat(sortedBeats, endPosition);

      // Only snap if the beat is within 0.5s of our target end
      if (nearestBeat !== null && Math.abs(nearestBeat - endPosition) < 0.5) {
        useDuration = nearestBeat - currentPosition;
        if (useDuration <= 0) continue;
      }
    }

    selected.push({
      id: clip.id,
      startTime: 0,
      endTime: useDuration,
      duration: useDuration,
    });

    remaining -= useDuration;
  }

  // If we still have remaining time and we have clips, loop from the start
  if (remaining > 0.5 && sorted.length > 0) {
    let loopIdx = 0;
    while (remaining > 0.5) {
      const clip = sorted[loopIdx % sorted.length];
      const useDuration = Math.min(clip.duration, remaining);

      selected.push({
        id: clip.id,
        startTime: 0,
        endTime: useDuration,
        duration: useDuration,
      });

      remaining -= useDuration;
      loopIdx++;

      // Safety: don't infinite loop if all clips are 0-duration
      if (loopIdx > sorted.length * 3) break;
    }
  }

  const totalDuration = selected.reduce((sum, c) => sum + c.duration, 0);
  return { selectedClips: selected, totalDuration };
}

/**
 * Find the nearest beat to a given time position.
 * @param {number[]} sortedBeats - Sorted array of beat timestamps
 * @param {number} time - Target time
 * @returns {number|null} Nearest beat time, or null if no beats
 */
function findNearestBeat(sortedBeats, time) {
  if (sortedBeats.length === 0) return null;

  // Binary search for closest beat
  let lo = 0,
    hi = sortedBeats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedBeats[mid] < time) lo = mid + 1;
    else hi = mid;
  }

  // Check both neighbors
  const candidates = [sortedBeats[lo]];
  if (lo > 0) candidates.push(sortedBeats[lo - 1]);

  return candidates.reduce((best, beat) =>
    Math.abs(beat - time) < Math.abs(best - time) ? beat : best,
  );
}
