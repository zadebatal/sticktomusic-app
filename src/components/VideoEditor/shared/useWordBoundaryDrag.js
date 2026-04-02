import { useEffect } from 'react';

/**
 * useWordBoundaryDrag — handles mouse/pointer drag for word boundary cut lines.
 * Extracted from VideoEditorModal for reuse across all editors.
 *
 * @param {Object|null} wordCutDrag - Current drag state: { active, wordIndex, boundaryType, startX, originalPos }
 * @param {number} pxPerSec - Pixels per second for timeline scaling
 * @param {Function} setWords - State setter for words array (supports updater fn)
 * @param {Function} setWordCutDrag - State setter for wordCutDrag
 */
const useWordBoundaryDrag = (wordCutDrag, pxPerSec, setWords, setWordCutDrag) => {
  useEffect(() => {
    if (!wordCutDrag?.active) return;
    const { wordIndex, startX, boundaryType, originalPos } = wordCutDrag;

    const handleWordCutMove = (e) => {
      const deltaX = e.clientX - startX;
      const deltaSec = deltaX / pxPerSec;
      const newPos = originalPos + deltaSec;

      setWords((prev) => {
        const updated = [...prev];
        if (boundaryType === 'end') {
          // Dragging the END of word[wordIndex] — only change this word's duration
          const word = updated[wordIndex];
          if (!word) return prev;
          const wStart = word.startTime ?? word.start ?? 0;
          const newDur = Math.max(0.05, newPos - wStart);
          updated[wordIndex] = { ...word, duration: newDur };
        } else {
          // Dragging the START of word[wordIndex] — only change this word's start + duration (keep end fixed)
          const word = updated[wordIndex];
          if (!word) return prev;
          const wStart = word.startTime ?? word.start ?? 0;
          const wEnd = wStart + (word.duration || 0.5);
          const clampedStart = Math.max(0, Math.min(wEnd - 0.05, newPos));
          updated[wordIndex] = {
            ...word,
            startTime: clampedStart,
            duration: wEnd - clampedStart,
          };
        }
        return updated;
      });
    };

    const handleWordCutUp = () => {
      setWordCutDrag(null);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', handleWordCutMove);
    document.addEventListener('pointermove', handleWordCutMove);
    document.addEventListener('mouseup', handleWordCutUp);
    document.addEventListener('pointerup', handleWordCutUp);
    document.addEventListener('pointercancel', handleWordCutUp);
    return () => {
      document.removeEventListener('mousemove', handleWordCutMove);
      document.removeEventListener('pointermove', handleWordCutMove);
      document.removeEventListener('mouseup', handleWordCutUp);
      document.removeEventListener('pointerup', handleWordCutUp);
      document.removeEventListener('pointercancel', handleWordCutUp);
      document.body.style.cursor = '';
    };
  }, [wordCutDrag, pxPerSec, setWords, setWordCutDrag]);
};

export default useWordBoundaryDrag;
