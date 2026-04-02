import React from 'react';

/**
 * WordBoundaryLines — renders draggable cut lines at word start/end boundaries.
 * Extracted from VideoEditorModal for reuse across all editors.
 *
 * @param {Object} props
 * @param {Array} props.words - Array of { id, text, startTime, duration, start, end }
 * @param {number} props.pxPerSec - Pixels per second for timeline scaling
 * @param {Function} props.onStartDrag - Callback: (event, boundaryType, wordIndex) => void
 */
const WordBoundaryLines = ({ words, pxPerSec, onStartDrag }) => {
  if (!words || words.length === 0) return null;

  // Collect all unique boundary positions (word starts + word ends)
  const boundarySet = new Map(); // px -> { type, wi, draggable }
  words.forEach((word, wi) => {
    const wStart = word.startTime ?? word.start ?? 0;
    const wDur = word.duration ?? ((word.end ?? 0) - (word.start ?? 0) || 0.5);
    const startPx = Math.round(wStart * pxPerSec * 100) / 100;
    const endPx = Math.round((wStart + wDur) * pxPerSec * 100) / 100;
    // Start of each word (except first at 0)
    if (wi > 0 || wStart > 0.01) {
      if (!boundarySet.has(startPx)) {
        boundarySet.set(startPx, { type: 'start', wi, draggable: wi > 0 });
      }
    }
    // End of each word (except last)
    if (wi < words.length - 1) {
      if (!boundarySet.has(endPx)) {
        boundarySet.set(endPx, { type: 'end', wi, draggable: true });
      }
    }
  });

  return Array.from(boundarySet.entries()).map(([px, { type, wi, draggable }]) => (
    <div key={`wcut-${type}-${wi}`}>
      {/* Visible line */}
      <div
        style={{
          position: 'absolute',
          top: '24px',
          bottom: 0,
          left: `${px}px`,
          width: '2px',
          backgroundColor: 'rgba(165,180,252,0.5)',
          zIndex: 12,
          pointerEvents: 'none',
        }}
      />
      {/* Drag handle */}
      {draggable && (
        <div
          style={{
            position: 'absolute',
            top: '24px',
            bottom: 0,
            left: `${px - 6}px`,
            width: '12px',
            cursor: 'col-resize',
            zIndex: 13,
          }}
          onMouseDown={(e) => onStartDrag(e, type, wi)}
          onPointerDown={(e) => onStartDrag(e, type, wi)}
        />
      )}
    </div>
  ));
};

export default WordBoundaryLines;
