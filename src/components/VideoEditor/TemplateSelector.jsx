import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { LYRIC_TEMPLATES, getAllTemplates, DISPLAY_MODES } from './LyricTemplates';
import { PROJECT_TEMPLATES, getTemplatesForArtist } from './ProjectTemplates';

/**
 * Template Selector - Choose project templates and lyric styles
 */
const TemplateSelector = ({
  mode = 'project', // 'project' or 'lyric'
  selectedTemplate,
  selectedArtist,
  onSelectTemplate,
  onClose
}) => {
  const { theme } = useTheme();
  const s = getStyles(theme);
  const templates = mode === 'project'
    ? (selectedArtist ? getTemplatesForArtist(selectedArtist.id) : Object.values(PROJECT_TEMPLATES))
    : getAllTemplates();

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <h2 style={s.title}>
            {mode === 'project' ? 'Choose Template' : 'Choose Lyric Style'}
          </h2>
          <button style={s.closeButton} onClick={onClose}>×</button>
        </div>

        <div style={s.content}>
          {mode === 'project' && selectedArtist && (
            <div style={s.artistSection}>
              <h3 style={s.sectionTitle}>
                Templates for {selectedArtist.name}
              </h3>
              <div style={s.templateGrid}>
                {templates
                  .filter(t => t.artistId === selectedArtist.id)
                  .map(template => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      isSelected={selectedTemplate?.id === template.id}
                      onClick={() => onSelectTemplate(template)}
                      mode={mode}
                    />
                  ))
                }
              </div>
            </div>
          )}

          <div style={s.genericSection}>
            <h3 style={s.sectionTitle}>
              {mode === 'project' ? 'Generic Templates' : 'Lyric Styles'}
            </h3>
            <div style={s.templateGrid}>
              {(mode === 'project'
                ? templates.filter(t => !t.artistId)
                : templates
              ).map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isSelected={selectedTemplate?.id === template.id}
                  onClick={() => onSelectTemplate(template)}
                  mode={mode}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Individual Template Card
 */
const TemplateCard = ({ template, isSelected, onClick, mode }) => {
  const { theme } = useTheme();
  const s = getStyles(theme);
  const textStyle = mode === 'project' ? template.textStyle : template.textStyle;

  return (
    <div
      style={{
        ...s.card,
        ...(isSelected ? s.cardSelected : {})
      }}
      onClick={onClick}
    >
      {/* Preview */}
      <div style={s.preview}>
        <div
          style={{
            ...s.previewText,
            fontFamily: textStyle?.fontFamily || 'sans-serif',
            fontSize: '18px',
            fontWeight: textStyle?.fontWeight || '400',
            color: textStyle?.color || '#ffffff',
            textTransform: textStyle?.textCase === 'upper' ? 'uppercase' :
                          textStyle?.textCase === 'lower' ? 'lowercase' : 'none',
            letterSpacing: textStyle?.letterSpacing || '0',
            textShadow: textStyle?.outline
              ? `0 0 ${textStyle?.outlineWidth || 2}px ${textStyle?.outlineColor || '#000'}`
              : 'none'
          }}
        >
          Sample Text
        </div>
      </div>

      {/* Info */}
      <div style={s.cardInfo}>
        <div style={s.cardHeader}>
          {template.icon && <span style={s.cardIcon}>{template.icon}</span>}
          <span style={s.cardName}>
            {mode === 'project' ? template.categoryName : template.name}
          </span>
        </div>
        <p style={s.cardDescription}>{template.description}</p>

        {mode === 'project' && template.settings && (
          <div style={s.cardMeta}>
            <span>Cut: {template.settings.beatsPerCut} beats</span>
            <span>•</span>
            <span>{template.settings.aspectRatio}</span>
          </div>
        )}
      </div>

      {isSelected && (
        <div style={s.selectedBadge}>✓</div>
      )}
    </div>
  );
};

/**
 * Display Mode Selector - For switching between word/line/karaoke display
 */
export const DisplayModeSelector = ({ selectedMode, onChange }) => {
  const { theme } = useTheme();
  const s = getStyles(theme);
  return (
    <div style={s.displayModeContainer}>
      <span style={s.displayModeLabel}>Display:</span>
      <div style={s.displayModeButtons}>
        {Object.values(DISPLAY_MODES).map(mode => (
          <button
            key={mode.id}
            style={{
              ...s.displayModeButton,
              ...(selectedMode === mode.id ? s.displayModeButtonActive : {})
            }}
            onClick={() => onChange(mode.id)}
            title={mode.description}
          >
            {mode.name}
          </button>
        ))}
      </div>
    </div>
  );
};

const getStyles = (theme) => ({
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    width: '90%',
    maxWidth: '800px',
    maxHeight: '80vh',
    backgroundColor: theme.bg.surface,
    borderRadius: '12px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: `1px solid ${theme.border.default}`
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: theme.text.primary
  },
  closeButton: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: theme.text.secondary,
    fontSize: '24px',
    cursor: 'pointer'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '20px'
  },
  artistSection: {
    marginBottom: '24px'
  },
  genericSection: {},
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '14px',
    fontWeight: '600',
    color: theme.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  templateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px'
  },
  card: {
    position: 'relative',
    backgroundColor: theme.bg.page,
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'pointer',
    border: '2px solid transparent',
    transition: 'all 0.2s'
  },
  cardSelected: {
    borderColor: theme.accent.primary,
    boxShadow: `0 0 0 2px ${theme.accent.muted}`
  },
  preview: {
    height: '80px',
    backgroundColor: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px'
  },
  previewText: {
    textAlign: 'center'
  },
  cardInfo: {
    padding: '12px'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px'
  },
  cardIcon: {
    fontSize: '16px'
  },
  cardName: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.text.primary
  },
  cardDescription: {
    margin: 0,
    fontSize: '12px',
    color: theme.text.secondary,
    lineHeight: '1.4'
  },
  cardMeta: {
    marginTop: '8px',
    display: 'flex',
    gap: '8px',
    fontSize: '11px',
    color: theme.text.muted
  },
  selectedBadge: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '24px',
    height: '24px',
    backgroundColor: theme.accent.primary,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '14px',
    fontWeight: 'bold'
  },
  displayModeContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  displayModeLabel: {
    fontSize: '12px',
    color: theme.text.secondary
  },
  displayModeButtons: {
    display: 'flex',
    gap: '4px'
  },
  displayModeButton: {
    padding: '4px 8px',
    backgroundColor: theme.bg.elevated,
    border: 'none',
    borderRadius: '4px',
    color: theme.text.secondary,
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  displayModeButtonActive: {
    backgroundColor: theme.accent.primary,
    color: 'white'
  }
});

export default TemplateSelector;
