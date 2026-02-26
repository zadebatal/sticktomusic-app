/**
 * WordOverlay — Word-by-word text animation overlay for preview components.
 * Three display modes: word (one at a time), line (grouped), full (all visible, active highlighted).
 */
import React, { useMemo } from 'react';

const WordOverlay = ({ words = [], currentTime = 0, textStyle = {}, displayMode = 'word' }) => {
  if (!words.length) return null;

  const {
    fontFamily = 'Inter, sans-serif',
    fontSize = 48,
    fontWeight = '600',
    color = '#ffffff',
    textCase = 'default',
    outline = true,
    outlineColor = '#000000',
  } = textStyle;

  const scaledSize = Math.round(fontSize * 0.35);
  const textTransform = textCase === 'upper' ? 'uppercase' : textCase === 'lower' ? 'lowercase' : 'none';
  const textShadow = outline
    ? `0 0 4px ${outlineColor}, 1px 1px 2px ${outlineColor}, -1px -1px 2px ${outlineColor}`
    : 'none';

  const baseStyle = {
    fontFamily,
    fontWeight,
    color,
    textAlign: 'center',
    textTransform,
    textShadow,
    lineHeight: 1.3,
  };

  // Find active word index
  const activeIdx = useMemo(() => {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (currentTime >= w.startTime && currentTime < w.startTime + w.duration) return i;
    }
    return -1;
  }, [words, currentTime]);

  // Group words into lines (~8 words or punctuation split)
  const lines = useMemo(() => {
    const result = [];
    let current = [];
    for (let i = 0; i < words.length; i++) {
      current.push({ ...words[i], globalIdx: i });
      const endsWithPunct = /[.!?,;:]$/.test(words[i].text);
      if (current.length >= 8 || endsWithPunct) {
        result.push(current);
        current = [];
      }
    }
    if (current.length > 0) result.push(current);
    return result;
  }, [words]);

  // Find active line index
  const activeLineIdx = useMemo(() => {
    if (activeIdx < 0) return -1;
    return lines.findIndex(line => line.some(w => w.globalIdx === activeIdx));
  }, [activeIdx, lines]);

  if (displayMode === 'word') {
    // Show one word at a time
    if (activeIdx < 0) return null;
    const word = words[activeIdx];
    return (
      <div className="absolute inset-0 flex items-center justify-center z-[5] pointer-events-none px-4">
        <span
          style={{
            ...baseStyle,
            fontSize: scaledSize * 1.2,
            transition: 'opacity 0.1s, transform 0.1s',
            opacity: 1,
            transform: 'scale(1.05)',
          }}
        >
          {word.text}
        </span>
      </div>
    );
  }

  if (displayMode === 'line') {
    // Show current line, highlight active word
    if (activeLineIdx < 0) return null;
    const line = lines[activeLineIdx];
    return (
      <div className="absolute inset-0 flex items-end justify-center z-[5] pointer-events-none px-4 pb-8">
        <div style={{ ...baseStyle, fontSize: scaledSize, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 5px' }}>
          {line.map((w) => (
            <span
              key={w.globalIdx}
              style={{
                opacity: w.globalIdx === activeIdx ? 1 : 0.5,
                transform: w.globalIdx === activeIdx ? 'scale(1.08)' : 'scale(1)',
                transition: 'opacity 0.1s, transform 0.1s',
                display: 'inline-block',
              }}
            >
              {w.text}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (displayMode === 'full') {
    // Show all words, highlight active
    return (
      <div className="absolute inset-0 flex items-end justify-center z-[5] pointer-events-none px-3 pb-6 overflow-hidden">
        <div style={{ ...baseStyle, fontSize: scaledSize * 0.85, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '2px 4px', maxHeight: '40%' }}>
          {words.map((w, i) => (
            <span
              key={i}
              style={{
                opacity: i === activeIdx ? 1 : 0.35,
                transform: i === activeIdx ? 'scale(1.1)' : 'scale(1)',
                transition: 'opacity 0.1s, transform 0.1s',
                display: 'inline-block',
              }}
            >
              {w.text}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return null;
};

export default WordOverlay;
