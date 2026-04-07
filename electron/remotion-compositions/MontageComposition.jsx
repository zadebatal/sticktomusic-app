/**
 * MontageComposition — Remotion composition for rendering montage videos.
 * Takes the same data shape as videoExportService's renderWithCanvas().
 * Each clip is rendered as a <Video> element in a <Sequence>.
 * Text overlays (words) are positioned as styled divs.
 */
import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Sequence,
  Video,
  Audio,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';

const FPS = 30;

// Aspect ratio dimensions (matching videoExportService)
const DIMENSIONS = {
  '9:16': { width: 1080, height: 1920 },
  '4:3': { width: 1440, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

/**
 * Single text overlay rendered with full styling
 */
const TextOverlay = ({ text, style = {}, containerWidth, containerHeight }) => {
  if (!text) return null;

  const fontSize = style.fontSize || 48;
  const fontFamily = style.fontFamily || "'TikTok Sans', sans-serif";
  const fontWeight = style.fontWeight || '400';
  const fontStyle = style.fontStyle || 'normal';
  const color = style.color || '#fff';
  const textAlign = style.textAlign || 'center';
  const textCase = style.textCase;

  const displayText = textCase === 'upper' ? text.toUpperCase() : text;

  const textShadow = [];
  if (style.outline) {
    const outlineColor = style.outlineColor || '#000';
    const outlineWidth = fontSize / 10;
    textShadow.push(
      `${outlineWidth}px 0 ${outlineColor}`,
      `-${outlineWidth}px 0 ${outlineColor}`,
      `0 ${outlineWidth}px ${outlineColor}`,
      `0 -${outlineWidth}px ${outlineColor}`,
    );
  }
  if (style.textStroke) {
    const match = style.textStroke.match(/([\d.]+)px\s+(.*)/);
    if (match) {
      const strokeWidth = parseFloat(match[1]);
      const strokeColor = match[2] || '#000';
      textShadow.push(
        `${strokeWidth}px ${strokeWidth}px 0 ${strokeColor}`,
        `-${strokeWidth}px -${strokeWidth}px 0 ${strokeColor}`,
        `${strokeWidth}px -${strokeWidth}px 0 ${strokeColor}`,
        `-${strokeWidth}px ${strokeWidth}px 0 ${strokeColor}`,
      );
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        textAlign,
        fontSize: fontSize * 0.35,
        fontFamily,
        fontWeight,
        fontStyle,
        color,
        textShadow: textShadow.length > 0 ? textShadow.join(', ') : undefined,
        padding: '0 10%',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      {displayText}
    </div>
  );
};

/**
 * Main montage composition — renders clips in sequence with text overlays
 */
export const MontageComposition = ({
  clips = [],
  audioUrl,
  audioStartTime = 0,
  words = [],
  textStyle = {},
  textOverlays = [],
  cropMode = '9:16',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;

  const dims = DIMENSIONS[cropMode] || DIMENSIONS['9:16'];

  // Find current word at this time
  const currentWord = useMemo(() => {
    return words.find((w) => currentTime >= w.start && currentTime < w.end);
  }, [words, currentTime]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Render each clip as a Sequence */}
      {clips.map((clip, i) => {
        const startFrame = Math.round((clip.startTime || 0) * fps);
        const durationFrames = Math.round((clip.duration || 1) * fps);
        const sourceOffset = clip.sourceOffset || 0;

        if (!clip.url && !clip.localUrl) return null;
        const src = clip.localUrl || clip.url;

        return (
          <Sequence
            key={clip.id || i}
            from={startFrame}
            durationInFrames={Math.min(durationFrames, durationInFrames - startFrame)}
          >
            <AbsoluteFill>
              <Video
                src={src}
                startFrom={Math.round(sourceOffset * fps)}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* Static text overlays (from text banks) */}
      {textOverlays.map((overlay, i) => {
        const startFrame = Math.round((overlay.startTime || 0) * fps);
        const endFrame = overlay.endTime
          ? Math.round(overlay.endTime * fps)
          : durationInFrames;

        return (
          <Sequence
            key={`overlay-${i}`}
            from={startFrame}
            durationInFrames={endFrame - startFrame}
          >
            <TextOverlay
              text={overlay.text}
              style={overlay.style || textStyle}
              containerWidth={dims.width}
              containerHeight={dims.height}
            />
          </Sequence>
        );
      })}

      {/* Word overlays (lyrics synced to audio) */}
      {currentWord && (
        <TextOverlay
          text={currentWord.word}
          style={textStyle}
          containerWidth={dims.width}
          containerHeight={dims.height}
        />
      )}

      {/* Audio track */}
      {audioUrl && (
        <Audio
          src={audioUrl}
          startFrom={Math.round(audioStartTime * fps)}
        />
      )}
    </AbsoluteFill>
  );
};

// Default props for Remotion composition registration
MontageComposition.defaultProps = {
  clips: [],
  words: [],
  textStyle: {},
  textOverlays: [],
  cropMode: '9:16',
};
