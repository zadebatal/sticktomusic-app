// Project templates for quick setup per artist/category
import { LYRIC_TEMPLATES } from './LyricTemplates';

export const PROJECT_TEMPLATES = {
  // BOON's templates
  'boon-fashionRunway': {
    id: 'boon-fashionRunway',
    artistId: 'boon',
    artistName: 'Boon',
    categoryId: 'fashionRunway',
    categoryName: 'Fashion Runway',
    icon: '👗',
    description: 'High fashion editorial clips with elegant typography',
    settings: {
      aspectRatio: '9:16',
      defaultDuration: 30,
      cutStyle: 'beat', // beat, word, manual
      beatsPerCut: 2, // Cut every N beats
      lyricTemplate: 'fashionRunway',
      autoGenerate: true
    },
    contentBank: 'boon-fashion', // ID of the content bank to use
    textStyle: LYRIC_TEMPLATES.fashionRunway.textStyle,
    displayMode: LYRIC_TEMPLATES.fashionRunway.displayMode
  },

  'boon-edm': {
    id: 'boon-edm',
    artistId: 'boon',
    artistName: 'Boon',
    categoryId: 'edm',
    categoryName: 'EDM',
    icon: '🎧',
    description: 'High energy EDM visuals with bold text',
    settings: {
      aspectRatio: '9:16',
      defaultDuration: 30,
      cutStyle: 'beat',
      beatsPerCut: 1, // Faster cuts for EDM
      lyricTemplate: 'edm',
      autoGenerate: true
    },
    contentBank: 'boon-edm',
    textStyle: LYRIC_TEMPLATES.edm.textStyle,
    displayMode: LYRIC_TEMPLATES.edm.displayMode
  },

  // Generic templates for new artists
  'generic-aesthetic': {
    id: 'generic-aesthetic',
    artistId: null,
    artistName: 'Any Artist',
    categoryId: 'aesthetic',
    categoryName: 'Aesthetic',
    icon: '✨',
    description: 'Soft, dreamy aesthetic content',
    settings: {
      aspectRatio: '9:16',
      defaultDuration: 30,
      cutStyle: 'beat',
      beatsPerCut: 4,
      lyricTemplate: 'aesthetic',
      autoGenerate: true
    },
    contentBank: null,
    textStyle: LYRIC_TEMPLATES.aesthetic.textStyle,
    displayMode: LYRIC_TEMPLATES.aesthetic.displayMode
  },

  'generic-street': {
    id: 'generic-street',
    artistId: null,
    artistName: 'Any Artist',
    categoryId: 'street',
    categoryName: 'Street / Urban',
    icon: '🔥',
    description: 'Urban street style content',
    settings: {
      aspectRatio: '9:16',
      defaultDuration: 30,
      cutStyle: 'beat',
      beatsPerCut: 2,
      lyricTemplate: 'street',
      autoGenerate: true
    },
    contentBank: null,
    textStyle: LYRIC_TEMPLATES.street.textStyle,
    displayMode: LYRIC_TEMPLATES.street.displayMode
  },

  'generic-minimal': {
    id: 'generic-minimal',
    artistId: null,
    artistName: 'Any Artist',
    categoryId: 'minimal',
    categoryName: 'Minimal',
    icon: '⚪',
    description: 'Clean, simple, works with anything',
    settings: {
      aspectRatio: '9:16',
      defaultDuration: 30,
      cutStyle: 'beat',
      beatsPerCut: 2,
      lyricTemplate: 'minimal',
      autoGenerate: true
    },
    contentBank: null,
    textStyle: LYRIC_TEMPLATES.minimal.textStyle,
    displayMode: LYRIC_TEMPLATES.minimal.displayMode
  }
};

// Get templates for a specific artist
export const getTemplatesForArtist = (artistId) => {
  return Object.values(PROJECT_TEMPLATES).filter(
    t => t.artistId === artistId || t.artistId === null
  );
};

// Get all artist-specific templates
export const getArtistTemplates = () => {
  return Object.values(PROJECT_TEMPLATES).filter(t => t.artistId !== null);
};

// Get all generic templates
export const getGenericTemplates = () => {
  return Object.values(PROJECT_TEMPLATES).filter(t => t.artistId === null);
};

// Get template by ID
export const getProjectTemplate = (templateId) => {
  return PROJECT_TEMPLATES[templateId] || null;
};

// Create a new project from template
export const createProjectFromTemplate = (templateId, overrides = {}) => {
  const template = PROJECT_TEMPLATES[templateId];
  if (!template) return null;

  return {
    id: `project_${Date.now()}`,
    name: `${template.artistName} - ${template.categoryName} - Untitled`,
    createdAt: new Date().toISOString(),
    template: templateId,
    artistId: template.artistId,
    categoryId: template.categoryId,
    settings: { ...template.settings, ...overrides.settings },
    textStyle: { ...template.textStyle, ...overrides.textStyle },
    displayMode: overrides.displayMode || template.displayMode,
    contentBank: overrides.contentBank || template.contentBank,
    clips: [],
    words: [],
    audioFile: null,
    videoFile: null,
    status: 'draft',
    ...overrides
  };
};

export default PROJECT_TEMPLATES;
