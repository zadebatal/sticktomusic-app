// Auto-Remix Engine - The magic behind one-click content generation

/**
 * Generate clips automatically based on beats and content bank
 */
export const generateClipsFromBeats = (beats, contentBank, options = {}) => {
  const {
    beatsPerCut = 2,
    duration = 30,
    avoidRecent = true,
    recentClipIds = []
  } = options;

  if (!beats.length || !contentBank?.clips?.length) {
    return [];
  }

  const clips = [];
  const usedClipIds = new Set(recentClipIds);
  const availableClips = contentBank.clips.filter(c => !c.neverUse);

  // Group beats into segments based on beatsPerCut
  let currentBeatIndex = 0;
  let clipStartTime = 0;

  while (clipStartTime < duration && currentBeatIndex < beats.length) {
    const startBeat = beats[currentBeatIndex];
    const endBeatIndex = Math.min(currentBeatIndex + beatsPerCut, beats.length - 1);
    const endBeat = beats[endBeatIndex] || duration;

    const clipDuration = endBeat - startBeat;

    // Select a random clip, preferring unused ones
    let selectedClip = selectRandomClip(availableClips, usedClipIds, avoidRecent);

    if (selectedClip) {
      usedClipIds.add(selectedClip.id);

      clips.push({
        id: `clip_${Date.now()}_${clips.length}`,
        sourceClipId: selectedClip.id,
        source: selectedClip.url,
        thumbnail: selectedClip.thumbnail,
        startTime: startBeat,
        duration: clipDuration,
        sourceStartTime: 0, // Start from beginning of source clip
        locked: false,
        bankId: contentBank.id
      });
    }

    currentBeatIndex = endBeatIndex;
    clipStartTime = endBeat;
  }

  return clips;
};

/**
 * Select a random clip, preferring unused ones
 */
const selectRandomClip = (clips, usedIds, avoidRecent) => {
  if (!clips.length) return null;

  // First try to get unused clips
  const unusedClips = clips.filter(c => !usedIds.has(c.id));

  if (unusedClips.length > 0 && avoidRecent) {
    return unusedClips[Math.floor(Math.random() * unusedClips.length)];
  }

  // Fall back to any clip
  return clips[Math.floor(Math.random() * clips.length)];
};

/**
 * Reroll a single clip - swap it with a different random clip
 */
export const rerollSingleClip = (clips, clipIndex, contentBank, options = {}) => {
  const { avoidCurrent = true } = options;

  if (!contentBank?.clips?.length || clipIndex < 0 || clipIndex >= clips.length) {
    return clips;
  }

  const currentClip = clips[clipIndex];
  if (currentClip.locked) {
    return clips; // Don't reroll locked clips
  }

  const availableClips = contentBank.clips.filter(c => {
    if (c.neverUse) return false;
    if (avoidCurrent && c.id === currentClip.sourceClipId) return false;
    return true;
  });

  if (!availableClips.length) return clips;

  const newSourceClip = availableClips[Math.floor(Math.random() * availableClips.length)];

  const newClips = [...clips];
  newClips[clipIndex] = {
    ...currentClip,
    sourceClipId: newSourceClip.id,
    source: newSourceClip.url,
    thumbnail: newSourceClip.thumbnail
  };

  return newClips;
};

/**
 * Reroll all unlocked clips
 */
export const rerollAllClips = (clips, contentBank, options = {}) => {
  if (!contentBank?.clips?.length) return clips;

  const usedClipIds = new Set();

  return clips.map((clip, index) => {
    if (clip.locked) {
      usedClipIds.add(clip.sourceClipId);
      return clip;
    }

    const availableClips = contentBank.clips.filter(c => {
      if (c.neverUse) return false;
      if (usedClipIds.has(c.id)) return false;
      return true;
    });

    if (!availableClips.length) {
      // Fall back to any non-neverUse clip
      const fallbackClips = contentBank.clips.filter(c => !c.neverUse);
      if (!fallbackClips.length) return clip;
      const newSource = fallbackClips[Math.floor(Math.random() * fallbackClips.length)];
      usedClipIds.add(newSource.id);
      return {
        ...clip,
        sourceClipId: newSource.id,
        source: newSource.url,
        thumbnail: newSource.thumbnail
      };
    }

    const newSourceClip = availableClips[Math.floor(Math.random() * availableClips.length)];
    usedClipIds.add(newSourceClip.id);

    return {
      ...clip,
      sourceClipId: newSourceClip.id,
      source: newSourceClip.url,
      thumbnail: newSourceClip.thumbnail
    };
  });
};

/**
 * Shuffle clip order (keep same clips, different arrangement)
 */
export const shuffleClipOrder = (clips) => {
  const lockedClips = clips.map((clip, index) => ({ clip, index, locked: clip.locked }));
  const unlockedIndices = lockedClips.filter(c => !c.locked).map(c => c.index);
  const unlockedClips = unlockedIndices.map(i => clips[i]);

  // Fisher-Yates shuffle on unlocked clips
  for (let i = unlockedClips.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unlockedClips[i], unlockedClips[j]] = [unlockedClips[j], unlockedClips[i]];
  }

  // Rebuild array with locked clips in place
  const result = [...clips];
  let unlockedIndex = 0;
  unlockedIndices.forEach(originalIndex => {
    const originalTiming = clips[originalIndex];
    result[originalIndex] = {
      ...unlockedClips[unlockedIndex],
      startTime: originalTiming.startTime,
      duration: originalTiming.duration
    };
    unlockedIndex++;
  });

  return result;
};

/**
 * Toggle lock on a clip
 */
export const toggleClipLock = (clips, clipIndex) => {
  if (clipIndex < 0 || clipIndex >= clips.length) return clips;

  const newClips = [...clips];
  newClips[clipIndex] = {
    ...newClips[clipIndex],
    locked: !newClips[clipIndex].locked
  };
  return newClips;
};

/**
 * Generate word timings from beats
 */
export const generateWordTimingsFromBeats = (words, beats, options = {}) => {
  const { wordsPerBeat = 1, startOffset = 0 } = options;

  if (!words.length || !beats.length) return [];

  const timedWords = [];
  let wordIndex = 0;
  let beatIndex = 0;

  while (wordIndex < words.length && beatIndex < beats.length) {
    const beatTime = beats[beatIndex] + startOffset;
    const nextBeatTime = beats[beatIndex + 1] || beatTime + 0.5;
    const wordDuration = (nextBeatTime - beatTime) / wordsPerBeat;

    for (let i = 0; i < wordsPerBeat && wordIndex < words.length; i++) {
      timedWords.push({
        id: `word_${Date.now()}_${wordIndex}`,
        text: words[wordIndex],
        startTime: beatTime + (i * wordDuration),
        duration: wordDuration * 0.9, // Slight gap between words
        index: wordIndex
      });
      wordIndex++;
    }
    beatIndex++;
  }

  // Handle remaining words if we run out of beats
  const lastBeatTime = beats[beats.length - 1] || 0;
  const avgBeatInterval = beats.length > 1
    ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1)
    : 0.5;

  while (wordIndex < words.length) {
    const startTime = lastBeatTime + ((wordIndex - timedWords.length + 1) * avgBeatInterval / wordsPerBeat);
    timedWords.push({
      id: `word_${Date.now()}_${wordIndex}`,
      text: words[wordIndex],
      startTime,
      duration: avgBeatInterval / wordsPerBeat * 0.9,
      index: wordIndex
    });
    wordIndex++;
  }

  return timedWords;
};

/**
 * Cut clips by word timings (one clip per word)
 */
export const cutClipsByWords = (words, contentBank, options = {}) => {
  if (!words.length || !contentBank?.clips?.length) return [];

  const availableClips = contentBank.clips.filter(c => !c.neverUse);
  const usedClipIds = new Set();

  return words.map((word, index) => {
    let selectedClip = selectRandomClip(availableClips, usedClipIds, true);
    if (selectedClip) {
      usedClipIds.add(selectedClip.id);
    } else {
      selectedClip = availableClips[0]; // Fallback
    }

    return {
      id: `clip_${Date.now()}_${index}`,
      sourceClipId: selectedClip?.id,
      source: selectedClip?.url,
      thumbnail: selectedClip?.thumbnail,
      startTime: word.startTime,
      duration: word.duration,
      sourceStartTime: 0,
      locked: false,
      bankId: contentBank.id,
      wordId: word.id
    };
  });
};

/**
 * Parse lyrics text into words array
 */
export const parseLyrics = (lyricsText) => {
  if (!lyricsText) return [];

  // Split by whitespace, filter empty strings
  return lyricsText
    .split(/\s+/)
    .filter(word => word.trim().length > 0)
    .map(word => word.trim());
};

/**
 * Parse lyrics into lines (for full line display mode)
 */
export const parseLyricsIntoLines = (lyricsText) => {
  if (!lyricsText) return [];

  return lyricsText
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.trim());
};

/**
 * Generate a complete auto-remix project
 */
export const generateAutoRemix = (options) => {
  const {
    beats,
    lyrics,
    contentBank,
    template,
    duration = 30
  } = options;

  const words = parseLyrics(lyrics);
  const timedWords = generateWordTimingsFromBeats(words, beats, {
    wordsPerBeat: 1,
    startOffset: 0
  });

  const clips = template?.settings?.cutStyle === 'word'
    ? cutClipsByWords(timedWords, contentBank)
    : generateClipsFromBeats(beats, contentBank, {
        beatsPerCut: template?.settings?.beatsPerCut || 2,
        duration
      });

  return {
    clips,
    words: timedWords,
    textStyle: template?.textStyle || {},
    displayMode: template?.displayMode || 'word'
  };
};

export default {
  generateClipsFromBeats,
  rerollSingleClip,
  rerollAllClips,
  shuffleClipOrder,
  toggleClipLock,
  generateWordTimingsFromBeats,
  cutClipsByWords,
  parseLyrics,
  parseLyricsIntoLines,
  generateAutoRemix
};
