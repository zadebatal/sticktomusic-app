import React from 'react';

/**
 * WordPreview — renders the current word centered on the video preview.
 * Extracted from VideoEditorModal for reuse across all editors.
 *
 * @param {Object} props
 * @param {{ text: string }} props.currentWord - The word currently active at playhead
 * @param {Object} props.textStyle - Global text style (fontSize, fontFamily, color, outline, etc.)
 */
const WordPreview = ({ currentWord, textStyle }) => {
  if (!currentWord) return null;

  const scaledFontSize = Math.round((textStyle.fontSize || 48) * 0.35);
  const wordTextTransform =
    textStyle.textCase === 'upper'
      ? 'uppercase'
      : textStyle.textCase === 'lower'
        ? 'lowercase'
        : 'none';
  const wordTextShadow = textStyle.outline
    ? `0 0 4px ${textStyle.outlineColor || '#000'}, 1px 1px 2px ${textStyle.outlineColor || '#000'}, -1px -1px 2px ${textStyle.outlineColor || '#000'}`
    : 'none';

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '80%',
        textAlign: textStyle.textAlign || 'center',
        pointerEvents: 'none',
        zIndex: 7,
      }}
    >
      <span
        style={{
          fontSize: scaledFontSize,
          fontFamily: textStyle.fontFamily || 'sans-serif',
          fontWeight: textStyle.fontWeight || '600',
          color: textStyle.color || '#ffffff',
          textTransform: wordTextTransform,
          textShadow: wordTextShadow,
          WebkitTextStroke: textStyle.textStroke || 'unset',
          userSelect: 'none',
        }}
      >
        {currentWord.text}
      </span>
    </div>
  );
};

export default WordPreview;
