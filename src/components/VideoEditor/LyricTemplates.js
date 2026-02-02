// Lyric style templates for different content categories

export const LYRIC_TEMPLATES = {
  fashionRunway: {
    id: 'fashionRunway',
    name: 'Fashion Runway',
    description: 'Elegant, minimal, high fashion aesthetic',
    textStyle: {
      fontSize: 48,
      fontFamily: "'Playfair Display', serif",
      fontWeight: '300',
      color: '#ffffff',
      outline: true,
      outlineColor: 'rgba(0,0,0,0.3)',
      outlineWidth: 1,
      textCase: 'upper',
      letterSpacing: '0.2em',
      position: { x: 'center', y: 'center' },
      animation: 'fade',
      animationDuration: 300
    },
    displayMode: 'word', // word, buildLine, fullLine, karaoke
    timing: 'onBeat' // onBeat, smooth
  },

  edm: {
    id: 'edm',
    name: 'EDM / Rave',
    description: 'Bold, high energy, neon vibes',
    textStyle: {
      fontSize: 72,
      fontFamily: "'Anton', sans-serif",
      fontWeight: '400',
      color: '#00ffff',
      outline: true,
      outlineColor: '#ff00ff',
      outlineWidth: 4,
      textCase: 'upper',
      letterSpacing: '0.05em',
      position: { x: 'center', y: 'center' },
      animation: 'glitch',
      animationDuration: 100
    },
    displayMode: 'word',
    timing: 'onBeat'
  },

  aesthetic: {
    id: 'aesthetic',
    name: 'Aesthetic',
    description: 'Soft, muted, dreamy vibes',
    textStyle: {
      fontSize: 42,
      fontFamily: "'Cormorant Garamond', serif",
      fontWeight: '300',
      color: '#e8d5c4',
      outline: false,
      outlineColor: '#000000',
      outlineWidth: 0,
      textCase: 'lower',
      letterSpacing: '0.1em',
      position: { x: 'center', y: 'bottom' },
      animation: 'fadeSlide',
      animationDuration: 400
    },
    displayMode: 'buildLine',
    timing: 'smooth'
  },

  street: {
    id: 'street',
    name: 'Street / Urban',
    description: 'Bold block letters, high contrast',
    textStyle: {
      fontSize: 64,
      fontFamily: "'Oswald', sans-serif",
      fontWeight: '700',
      color: '#ffffff',
      outline: true,
      outlineColor: '#000000',
      outlineWidth: 4,
      textCase: 'upper',
      letterSpacing: '0',
      position: { x: 'center', y: 'center' },
      animation: 'bounce',
      animationDuration: 150
    },
    displayMode: 'word',
    timing: 'onBeat'
  },

  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean, simple, versatile',
    textStyle: {
      fontSize: 52,
      fontFamily: "'Inter', sans-serif",
      fontWeight: '500',
      color: '#ffffff',
      outline: true,
      outlineColor: '#000000',
      outlineWidth: 2,
      textCase: 'default',
      letterSpacing: '0',
      position: { x: 'center', y: 'center' },
      animation: 'fade',
      animationDuration: 200
    },
    displayMode: 'word',
    timing: 'onBeat'
  },

  hyperpop: {
    id: 'hyperpop',
    name: 'Hyperpop',
    description: 'Chaotic, colorful, experimental',
    textStyle: {
      fontSize: 68,
      fontFamily: "'Rubik', sans-serif",
      fontWeight: '800',
      color: '#ff3366',
      outline: true,
      outlineColor: '#00ff88',
      outlineWidth: 3,
      textCase: 'default',
      letterSpacing: '-0.02em',
      position: { x: 'random', y: 'random' },
      animation: 'shake',
      animationDuration: 50
    },
    displayMode: 'word',
    timing: 'onBeat'
  },

  cinematic: {
    id: 'cinematic',
    name: 'Cinematic',
    description: 'Movie trailer style, dramatic',
    textStyle: {
      fontSize: 56,
      fontFamily: "'Bebas Neue', sans-serif",
      fontWeight: '400',
      color: '#ffffff',
      outline: false,
      outlineColor: '#000000',
      outlineWidth: 0,
      textCase: 'upper',
      letterSpacing: '0.15em',
      position: { x: 'center', y: 'bottom' },
      animation: 'typewriter',
      animationDuration: 50
    },
    displayMode: 'buildLine',
    timing: 'smooth'
  }
};

// Animation keyframes for CSS
export const ANIMATIONS = {
  fade: {
    enter: { opacity: 0 },
    active: { opacity: 1 },
    exit: { opacity: 0 }
  },
  fadeSlide: {
    enter: { opacity: 0, transform: 'translateY(20px)' },
    active: { opacity: 1, transform: 'translateY(0)' },
    exit: { opacity: 0, transform: 'translateY(-20px)' }
  },
  bounce: {
    enter: { opacity: 0, transform: 'scale(0.5)' },
    active: { opacity: 1, transform: 'scale(1)' },
    exit: { opacity: 0, transform: 'scale(1.2)' }
  },
  glitch: {
    enter: { opacity: 0, transform: 'skewX(-20deg)' },
    active: { opacity: 1, transform: 'skewX(0)' },
    exit: { opacity: 0, transform: 'skewX(20deg)' }
  },
  shake: {
    enter: { opacity: 0 },
    active: { opacity: 1, animation: 'shake 0.1s infinite' },
    exit: { opacity: 0 }
  },
  typewriter: {
    // Handled specially in code - characters appear one by one
    enter: { opacity: 0 },
    active: { opacity: 1 },
    exit: { opacity: 0 }
  }
};

// Display mode configurations
export const DISPLAY_MODES = {
  word: {
    id: 'word',
    name: 'Word by Word',
    description: 'One word at a time, previous disappears'
  },
  buildLine: {
    id: 'buildLine',
    name: 'Build Line',
    description: 'Words stack, building each line'
  },
  fullLine: {
    id: 'fullLine',
    name: 'Full Line',
    description: 'Entire line appears at once'
  },
  karaoke: {
    id: 'karaoke',
    name: 'Karaoke',
    description: 'Words highlight as they play'
  }
};

// Get template by ID
export const getTemplate = (templateId) => {
  return LYRIC_TEMPLATES[templateId] || LYRIC_TEMPLATES.minimal;
};

// Get all templates as array
export const getAllTemplates = () => {
  return Object.values(LYRIC_TEMPLATES);
};

export default LYRIC_TEMPLATES;
