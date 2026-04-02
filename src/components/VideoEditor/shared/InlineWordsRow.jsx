import React from 'react';

/**
 * InlineWordsRow — renders word blocks on the timeline, absolute-positioned by timing.
 * Extracted from VideoEditorModal for reuse across all editors.
 *
 * @param {Object} props
 * @param {Array} props.words - Array of { id, text, startTime, duration, start, end }
 * @param {number} props.pxPerSec - Pixels per second for timeline scaling
 * @param {string|null} props.selectedWordId - Currently selected word ID
 * @param {Function} props.onWordClick - Callback: (wordId, startTime) => void
 */
const InlineWordsRow = ({ words, pxPerSec, selectedWordId, onWordClick }) => {
  if (!words || words.length === 0) return null;

  return (
    <div
      style={{
        height: '28px',
        position: 'relative',
        minWidth: '100%',
        borderBottom: '1px solid #222',
      }}
    >
      {words.map((word, wi) => {
        const wDur = word.duration ?? ((word.end ?? 0) - (word.start ?? 0) || 0.5);
        const wWidth = Math.max(4, wDur * pxPerSec);
        const wStart = word.startTime ?? word.start ?? 0;
        const wordId = word.id || `w_${wi}`;
        const isSelected = selectedWordId === wordId;
        return (
          <div
            key={wordId}
            style={{
              position: 'absolute',
              left: `${wStart * pxPerSec}px`,
              width: `${wWidth}px`,
              height: '100%',
              backgroundColor: isSelected ? 'rgba(99,102,241,0.25)' : 'rgba(16,185,129,0.15)',
              border: isSelected ? '2px solid #a5b4fc' : '1px solid rgba(0,0,0,0.3)',
              boxShadow: isSelected
                ? '0 0 0 1px rgba(129, 140, 248, 0.6), 0 0 8px rgba(99, 102, 241, 0.4)'
                : 'none',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: isSelected ? 5 : 1,
              borderRadius: '3px',
              boxSizing: 'border-box',
            }}
            title={word.text}
            onClick={(e) => {
              e.stopPropagation();
              onWordClick(wordId, wStart);
            }}
          >
            <span
              style={{
                fontSize: '9px',
                color: isSelected ? '#c7d2fe' : '#a1a1aa',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                userSelect: 'none',
                padding: '0 2px',
                fontWeight: isSelected ? 600 : 400,
              }}
            >
              {word.text}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default InlineWordsRow;
