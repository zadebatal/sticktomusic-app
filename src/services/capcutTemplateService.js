/**
 * CapCut Template Service
 * Parses CapCut project files and extracts lyric templates
 * Applies templates to user lyrics or AI-transcribed text
 *
 * IMPORTANT: All timestamps produced by this service are in LOCAL time.
 * When applying templates, provide startTime in LOCAL coordinates (0 = trim start).
 * When processing transcribed words, ensure they are already normalized to LOCAL time.
 */

import log from '../utils/logger';

/**
 * Parse a CapCut draft_info.json file and extract template data
 * @param {Object} draftData - Parsed JSON from draft_info.json
 * @returns {Object} Extracted template
 */
export function parseCapCutProject(draftData) {
  const template = {
    name: "CapCut Template",
    source: "capcut",
    animation: {},
    textStyle: {},
    wordTiming: {},
    lyrics: []
  };

  try {
    const materials = draftData.materials || {};

    // 1. Extract text style from first text material
    const texts = materials.texts || [];
    if (texts.length > 0) {
      const content = texts[0].content;
      if (content) {
        const contentData = typeof content === 'string' ? JSON.parse(content) : content;
        if (contentData.styles && contentData.styles[0]) {
          const style = contentData.styles[0];

          // Font info
          const font = style.font || {};
          const fontPath = font.path || '';
          const fontName = fontPath.split('/').pop()?.replace(/\.(ttf|otf)$/i, '') || 'Inter';

          // Color (RGB 0-1 to hex)
          const fill = style.fill?.content?.solid?.color || [1, 1, 1];
          const colorHex = '#' + fill.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

          // Shadow
          const shadows = style.shadows || [];
          const hasShadow = shadows.length > 0 && (shadows[0].distance > 0 || shadows[0].feather > 0);

          template.textStyle = {
            fontFamily: fontName,
            fontSize: style.size || 18,
            color: colorHex,
            fontWeight: style.bold ? '700' : '400',
            italic: style.italic || false,
            outline: hasShadow,
            outlineColor: '#000000',
            textCase: 'default'
          };
        }
      }
    }

    // 2. Extract animation info
    const materialAnims = materials.material_animations || [];
    if (materialAnims.length > 0) {
      const animData = materialAnims[0].animations?.[0] || {};
      template.animation = {
        id: animData.resource_id || '',
        name: (animData.category_name || 'Caption').trim(),
        type: animData.type || 'caption',
        duration: (animData.duration || 0) / 1000000 // microseconds to seconds
      };
    }

    // 3. Extract word-level timing from text_templates
    const textTemplates = materials.text_templates || [];
    for (const tt of textTemplates) {
      const wordInfo = tt.current_word_info;
      if (wordInfo && wordInfo.text) {
        const line = {
          text: wordInfo.text,
          startTime: (wordInfo.start_time || 0) / 1000, // ms to seconds
          endTime: (wordInfo.end_time || 0) / 1000,
          words: []
        };

        for (const word of (wordInfo.words || [])) {
          if (word.text && word.text.trim()) {
            line.words.push({
              text: word.text,
              startTime: (word.start_time || 0) / 1000,
              endTime: (word.end_time || 0) / 1000,
              duration: ((word.end_time || 0) - (word.start_time || 0)) / 1000
            });
          }
        }

        if (line.words.length > 0) {
          template.lyrics.push(line);
        }
      }
    }

    // 4. Calculate timing pattern
    if (template.lyrics.length > 0) {
      const allDurations = template.lyrics.flatMap(line =>
        line.words.map(w => w.duration)
      ).filter(d => d > 0);

      const avgDuration = allDurations.length > 0
        ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
        : 0.5;

      template.wordTiming = {
        averageWordDuration: Math.round(avgDuration * 1000) / 1000,
        totalWords: allDurations.length,
        pattern: "lyric_sync"
      };
    }

    return template;
  } catch (error) {
    log.error('Error parsing CapCut project:', error);
    throw new Error(`Failed to parse CapCut project: ${error.message}`);
  }
}

/**
 * Apply a template's style to new lyrics
 * Takes user lyrics and applies the template's timing pattern and style
 *
 * @param {Object} template - Extracted CapCut template
 * @param {string} newLyrics - User's lyrics (newline separated lines)
 * @param {number} startTime - When lyrics should start (seconds)
 * @param {number} bpm - Optional BPM for beat-synced timing
 * @returns {Object} Processed lyrics with timing and style
 */
export function applyTemplateToLyrics(template, newLyrics, startTime = 0, bpm = null) {
  const lines = newLyrics.split('\n').filter(line => line.trim());
  const avgWordDuration = template.wordTiming?.averageWordDuration || 0.5;
  const lineGap = 0.3; // Gap between lines

  const result = {
    textStyle: { ...template.textStyle },
    animation: { ...template.animation },
    words: [],
    lines: []
  };

  let currentTime = startTime;

  for (const lineText of lines) {
    const words = lineText.split(/\s+/).filter(w => w.trim());
    const lineStartTime = currentTime;
    const lineWords = [];

    for (const wordText of words) {
      // Calculate word duration based on template pattern
      // Longer words get slightly more time
      const baseDuration = avgWordDuration;
      const lengthFactor = Math.min(1.5, Math.max(0.7, wordText.length / 4));
      const wordDuration = baseDuration * lengthFactor;

      const wordData = {
        text: wordText,
        startTime: currentTime,
        endTime: currentTime + wordDuration,
        duration: wordDuration
      };

      lineWords.push(wordData);
      result.words.push(wordData);
      currentTime += wordDuration;
    }

    result.lines.push({
      text: lineText,
      startTime: lineStartTime,
      endTime: currentTime,
      words: lineWords
    });

    currentTime += lineGap;
  }

  result.totalDuration = currentTime - startTime;

  return result;
}

/**
 * Apply template timing to AI-transcribed words
 * Keeps the transcription timing but applies template style
 *
 * IMPORTANT: Transcribed words should already be in LOCAL time (normalized).
 * Use normalizeWordsToTrimRange() on transcription results before calling this.
 *
 * @param {Object} template - Extracted CapCut template
 * @param {Array} transcribedWords - Words from AI transcription (already in LOCAL time, seconds)
 *                                   Expected format: [{text, startTime, duration}]
 * @returns {Object} Styled words ready for video
 */
export function applyTemplateToTranscription(template, transcribedWords) {
  return {
    textStyle: { ...template.textStyle },
    animation: { ...template.animation },
    words: transcribedWords.map(word => ({
      id: word.id || `word_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: word.text,
      startTime: word.startTime, // Already in LOCAL seconds
      duration: word.duration,
      endTime: word.startTime + word.duration
    }))
  };
}

/**
 * Get animation CSS for a template animation type
 * Maps CapCut animation IDs to CSS animations
 */
export function getAnimationCSS(animationType) {
  const animations = {
    'caption': {
      enter: 'fadeInUp 0.3s ease-out',
      exit: 'fadeOutUp 0.3s ease-in',
      keyframes: `
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeOutUp {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(-20px); }
        }
      `
    },
    'pop': {
      enter: 'popIn 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      exit: 'popOut 0.2s ease-in',
      keyframes: `
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.5); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes popOut {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.5); }
        }
      `
    },
    'typewriter': {
      enter: 'typeIn 0.1s steps(1)',
      exit: 'fadeOut 0.2s ease-in',
      keyframes: `
        @keyframes typeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `
    },
    'bounce': {
      enter: 'bounceIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      exit: 'bounceOut 0.3s ease-in',
      keyframes: `
        @keyframes bounceIn {
          0% { opacity: 0; transform: scale(0.3) translateY(50px); }
          50% { transform: scale(1.05) translateY(-10px); }
          70% { transform: scale(0.95) translateY(5px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes bounceOut {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.3) translateY(-50px); }
        }
      `
    }
  };

  return animations[animationType] || animations['caption'];
}

export default {
  parseCapCutProject,
  applyTemplateToLyrics,
  applyTemplateToTranscription,
  getAnimationCSS
};
