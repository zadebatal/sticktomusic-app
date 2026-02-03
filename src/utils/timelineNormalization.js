/**
 * timelineNormalization.js
 *
 * SINGLE SOURCE OF TRUTH for time coordinate normalization.
 *
 * INVARIANT: All time-based data in the app (words, beats, clips) must be stored
 * in LOCAL time (0 to trimmedDuration), never GLOBAL time (full audio file time).
 *
 * This utility normalizes data at the point of entry into the system.
 * All downstream consumers can assume data is already in LOCAL time.
 *
 * Coordinate Systems:
 * - GLOBAL TIME: Offset from start of full audio file (0 = file start)
 * - LOCAL TIME: Offset from trim start point (0 = trim start, normalized)
 *
 * Usage:
 *   import { normalizeWordsToTrimRange } from '../utils/timelineNormalization';
 *   const localWords = normalizeWordsToTrimRange(globalWords, trimStart, trimEnd);
 */

/**
 * Normalize an array of words to the trim range
 * Filters out words outside the range and adjusts timestamps to LOCAL time
 *
 * @param {Array} words - Array of word objects with startTime (in GLOBAL seconds or ms)
 * @param {number} trimStart - Trim start time in seconds (GLOBAL)
 * @param {number} trimEnd - Trim end time in seconds (GLOBAL), or null/undefined for no trim
 * @param {Object} options - Options
 * @param {boolean} options.inputInMs - If true, word timestamps are in milliseconds (AssemblyAI format)
 * @param {boolean} options.preservePartial - If true, include words that partially overlap the range
 * @returns {Array} - Words with LOCAL timestamps (0 = trimStart)
 */
export function normalizeWordsToTrimRange(words, trimStart = 0, trimEnd = null, options = {}) {
  if (!words || !Array.isArray(words) || words.length === 0) {
    return [];
  }

  const { inputInMs = false, preservePartial = false } = options;
  const msMultiplier = inputInMs ? 1000 : 1;

  // Safety: ensure trim boundaries are valid numbers
  const safeTrimStart = typeof trimStart === 'number' && !isNaN(trimStart) ? trimStart : 0;
  const safeTrimEnd = typeof trimEnd === 'number' && !isNaN(trimEnd) ? trimEnd : null;

  // Convert trim boundaries to the same unit as input
  const trimStartUnit = safeTrimStart * msMultiplier;
  const trimEndUnit = safeTrimEnd ? safeTrimEnd * msMultiplier : Infinity;

  return words
    .filter(word => {
      const wordStart = word.start ?? word.startTime ?? 0;
      const wordEnd = word.end ?? (wordStart + (word.duration || 0.5) * msMultiplier);

      if (preservePartial) {
        // Include if any part of the word overlaps the range
        return wordEnd > trimStartUnit && wordStart < trimEndUnit;
      } else {
        // Include only if word starts within the range
        return wordStart >= trimStartUnit && wordStart < trimEndUnit;
      }
    })
    .map((word, index) => {
      const wordStart = word.start ?? word.startTime ?? 0;
      const wordEnd = word.end ?? (wordStart + (word.duration || 0.5) * msMultiplier);

      // Convert to LOCAL time in seconds
      const localStartTime = (wordStart - trimStartUnit) / msMultiplier;
      const duration = (wordEnd - wordStart) / msMultiplier;

      return {
        id: word.id || `word_${Date.now()}_${index}`,
        text: word.text || word.word || '',
        startTime: localStartTime,
        duration: duration,
        confidence: word.confidence,
        // Preserve any additional properties
        ...(word.speaker && { speaker: word.speaker }),
      };
    });
}

/**
 * Normalize an array of beat timestamps to the trim range
 * Filters out beats outside the range and adjusts timestamps to LOCAL time
 *
 * @param {Array<number>} beats - Array of beat times in GLOBAL seconds
 * @param {number} trimStart - Trim start time in seconds (GLOBAL)
 * @param {number} trimEnd - Trim end time in seconds (GLOBAL), or null/undefined for no trim
 * @returns {Array<number>} - Beat times in LOCAL seconds (0 = trimStart)
 */
export function normalizeBeatsToTrimRange(beats, trimStart = 0, trimEnd = null) {
  if (!beats || !Array.isArray(beats) || beats.length === 0) {
    return [];
  }

  // Safety: ensure trim boundaries are valid numbers
  const safeTrimStart = typeof trimStart === 'number' && !isNaN(trimStart) ? trimStart : 0;
  const safeTrimEnd = typeof trimEnd === 'number' && !isNaN(trimEnd) ? trimEnd : null;
  const effectiveTrimEnd = safeTrimEnd ?? Infinity;

  return beats
    .filter(beatTime => typeof beatTime === 'number' && !isNaN(beatTime) && beatTime >= safeTrimStart && beatTime < effectiveTrimEnd)
    .map(beatTime => beatTime - safeTrimStart);
}

/**
 * Normalize an array of clips to the trim range
 * Adjusts startTime to LOCAL time (assumes clips are already created for the trim range)
 *
 * @param {Array} clips - Array of clip objects with startTime, duration
 * @param {number} trimStart - Trim start time in seconds (GLOBAL)
 * @returns {Array} - Clips with LOCAL timestamps
 */
export function normalizeClipsToTrimRange(clips, trimStart = 0) {
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    return [];
  }

  return clips.map((clip, index) => ({
    ...clip,
    id: clip.id || `clip_${Date.now()}_${index}`,
    startTime: (clip.startTime || 0) - trimStart,
  }));
}

/**
 * Validate that all timestamps in the data are within the expected LOCAL range
 * Use this in development to catch normalization bugs
 *
 * @param {Object} data - Object containing words, beats, clips arrays
 * @param {number} trimmedDuration - Expected max duration (LOCAL range is 0 to trimmedDuration)
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function validateLocalTimeData(data, trimmedDuration) {
  const errors = [];
  const tolerance = 0.1; // Allow 100ms tolerance for edge cases

  // Validate words
  if (data.words && Array.isArray(data.words)) {
    data.words.forEach((word, i) => {
      if (word.startTime < -tolerance) {
        errors.push(`Word[${i}] "${word.text}" has negative startTime: ${word.startTime}`);
      }
      if (word.startTime > trimmedDuration + tolerance) {
        errors.push(`Word[${i}] "${word.text}" startTime ${word.startTime} exceeds trimmedDuration ${trimmedDuration}`);
      }
    });
  }

  // Validate beats
  if (data.beats && Array.isArray(data.beats)) {
    data.beats.forEach((beat, i) => {
      if (beat < -tolerance) {
        errors.push(`Beat[${i}] has negative time: ${beat}`);
      }
      if (beat > trimmedDuration + tolerance) {
        errors.push(`Beat[${i}] time ${beat} exceeds trimmedDuration ${trimmedDuration}`);
      }
    });
  }

  // Validate clips
  if (data.clips && Array.isArray(data.clips)) {
    data.clips.forEach((clip, i) => {
      if (clip.startTime < -tolerance) {
        errors.push(`Clip[${i}] has negative startTime: ${clip.startTime}`);
      }
      if (clip.startTime > trimmedDuration + tolerance) {
        errors.push(`Clip[${i}] startTime ${clip.startTime} exceeds trimmedDuration ${trimmedDuration}`);
      }
    });
  }

  if (errors.length > 0 && process.env.NODE_ENV === 'development') {
    console.warn('[TimelineNormalization] Validation errors:', errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get trim boundaries from an audio object
 * Returns consistent format regardless of how trim data is stored
 *
 * @param {Object} audio - Audio object that may have trim data
 * @param {number} fallbackDuration - Duration to use if no trim/duration info
 * @returns {Object} - { trimStart, trimEnd, trimmedDuration, isTrimmed }
 */
export function getTrimBoundaries(audio, fallbackDuration = 30) {
  if (!audio) {
    return {
      trimStart: 0,
      trimEnd: fallbackDuration,
      trimmedDuration: fallbackDuration,
      isTrimmed: false
    };
  }

  const trimStart = audio.startTime || 0;
  const trimEnd = audio.endTime || audio.duration || fallbackDuration;
  const trimmedDuration = trimEnd - trimStart;
  const isTrimmed = trimStart > 0 || (audio.endTime && audio.endTime < audio.duration);

  return {
    trimStart,
    trimEnd,
    trimmedDuration,
    isTrimmed
  };
}

/**
 * Convert LOCAL time back to GLOBAL time (for audio playback)
 *
 * @param {number} localTime - Time in LOCAL coordinates
 * @param {number} trimStart - Trim start time in GLOBAL seconds
 * @returns {number} - Time in GLOBAL coordinates
 */
export function localToGlobalTime(localTime, trimStart = 0) {
  return localTime + trimStart;
}

/**
 * Convert GLOBAL time to LOCAL time
 *
 * @param {number} globalTime - Time in GLOBAL coordinates
 * @param {number} trimStart - Trim start time in GLOBAL seconds
 * @returns {number} - Time in LOCAL coordinates
 */
export function globalToLocalTime(globalTime, trimStart = 0) {
  return globalTime - trimStart;
}

/**
 * Create a hash of trim boundaries for change detection
 * Used to detect when trim changes and invalidate dependent data
 *
 * @param {number} trimStart
 * @param {number} trimEnd
 * @returns {string}
 */
export function getTrimHash(trimStart, trimEnd) {
  // Safety check to prevent crashes if values are undefined/null
  const safeStart = typeof trimStart === 'number' && !isNaN(trimStart) ? trimStart : 0;
  const safeEnd = typeof trimEnd === 'number' && !isNaN(trimEnd) ? trimEnd : 30;
  return `${safeStart.toFixed(3)}_${safeEnd.toFixed(3)}`;
}

/**
 * Assert active range (trim boundaries) are valid
 * Use this at boundaries to catch invalid trim data early
 *
 * @param {Object} activeRange - { trimStart, trimEnd, trimmedDuration }
 * @param {string} context - Where the check is happening
 * @throws {Error} In development, or logs warning in production
 */
export function assertActiveRange(activeRange, context = '') {
  const errors = [];

  if (!activeRange) {
    errors.push('activeRange is null/undefined');
  } else {
    const { trimStart, trimEnd, trimmedDuration } = activeRange;

    if (typeof trimStart !== 'number' || isNaN(trimStart)) {
      errors.push(`trimStart is invalid: ${trimStart}`);
    }
    if (typeof trimEnd !== 'number' || isNaN(trimEnd)) {
      errors.push(`trimEnd is invalid: ${trimEnd}`);
    }
    if (trimStart !== undefined && trimEnd !== undefined && trimStart >= trimEnd) {
      errors.push(`trimStart (${trimStart}) >= trimEnd (${trimEnd})`);
    }
    if (trimmedDuration !== undefined && trimmedDuration <= 0) {
      errors.push(`trimmedDuration is non-positive: ${trimmedDuration}`);
    }
  }

  if (errors.length > 0) {
    const msg = `Invalid activeRange${context ? ` in ${context}` : ''}: ${errors.join(', ')}`;
    if (process.env.NODE_ENV === 'development') {
      console.error('[TIME WINDOW VIOLATION]', msg, activeRange);
    }
    // Don't throw in production - gracefully degrade
  }

  return errors.length === 0;
}

/**
 * Clip and normalize words in one step (convenience wrapper)
 * @param {Array} words
 * @param {Object} activeRange - { trimStart, trimEnd }
 * @param {Object} options
 * @returns {Array}
 */
export function clipAndNormalizeWords(words, activeRange, options = {}) {
  if (!activeRange) return words;
  assertActiveRange(activeRange, 'clipAndNormalizeWords');
  return normalizeWordsToTrimRange(words, activeRange.trimStart, activeRange.trimEnd, options);
}

/**
 * Clip and normalize beats in one step (convenience wrapper)
 * @param {Array} beats
 * @param {Object} activeRange - { trimStart, trimEnd }
 * @returns {Array}
 */
export function clipAndNormalizeBeats(beats, activeRange) {
  if (!activeRange) return beats;
  assertActiveRange(activeRange, 'clipAndNormalizeBeats');
  return normalizeBeatsToTrimRange(beats, activeRange.trimStart, activeRange.trimEnd);
}

export default {
  normalizeWordsToTrimRange,
  normalizeBeatsToTrimRange,
  normalizeClipsToTrimRange,
  validateLocalTimeData,
  getTrimBoundaries,
  localToGlobalTime,
  globalToLocalTime,
  getTrimHash,
  assertActiveRange,
  clipAndNormalizeWords,
  clipAndNormalizeBeats,
};
