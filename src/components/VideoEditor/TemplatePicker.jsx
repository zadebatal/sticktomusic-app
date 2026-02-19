import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * TemplatePicker - First screen when opening the video editor
 * Lets the user choose between different editor modes (Montage, Solo Clip, etc.)
 * Designed to be extensible — add new templates to the TEMPLATES array.
 */

const TEMPLATES = [
  {
    id: 'montage',
    name: 'Montage',
    description: 'Combine clips on a timeline, cut to beat',
    features: ['Multiple clips on timeline', 'Beat-synced cuts', 'Word-timed text overlays'],
    icon: 'montage'
  },
  {
    id: 'solo-clip',
    name: 'Solo Clip',
    description: 'One clip per video — design once, generate many',
    features: ['Full-duration clip', 'Draggable text overlays', 'Batch generate from text banks'],
    icon: 'solo-clip'
  },
  {
    id: 'multi-clip',
    name: 'Multi-Clip',
    description: 'Multiple clips on a timeline — full duration, batch generate',
    features: ['Multi-clip timeline', 'Per-clip or full-video text scoping', 'Randomized generation'],
    icon: 'multi-clip'
  },
  {
    id: 'photo-montage',
    name: 'Photo Montage',
    description: 'Turn photos into a fast-paced video with transitions',
    features: ['Upload or pull from banks', 'Ken Burns pan/zoom effects', 'Beat-synced photo timing'],
    icon: 'photo-montage'
  }
];

const MontageIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Film strip / multi-clip */}
    <rect x="4" y="8" width="40" height="32" rx="3" />
    <line x1="16" y1="8" x2="16" y2="40" strokeDasharray="3 2" />
    <line x1="28" y1="8" x2="28" y2="40" strokeDasharray="3 2" />
    {/* Play triangles in each section */}
    <polygon points="8,20 13,24 8,28" fill="currentColor" stroke="none" opacity="0.5" />
    <polygon points="20,20 25,24 20,28" fill="currentColor" stroke="none" opacity="0.5" />
    <polygon points="32,20 37,24 32,28" fill="currentColor" stroke="none" opacity="0.5" />
    {/* Beat marks at bottom */}
    <line x1="8" y1="36" x2="8" y2="38" strokeWidth="2" opacity="0.4" />
    <line x1="14" y1="36" x2="14" y2="38" strokeWidth="2" opacity="0.4" />
    <line x1="20" y1="36" x2="20" y2="38" strokeWidth="2" opacity="0.4" />
    <line x1="26" y1="36" x2="26" y2="38" strokeWidth="2" opacity="0.4" />
    <line x1="32" y1="36" x2="32" y2="38" strokeWidth="2" opacity="0.4" />
    <line x1="38" y1="36" x2="38" y2="38" strokeWidth="2" opacity="0.4" />
  </svg>
);

const SoloClipIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Single clip frame */}
    <rect x="8" y="6" width="32" height="36" rx="3" />
    {/* Play triangle */}
    <polygon points="18,18 30,24 18,30" fill="currentColor" stroke="none" opacity="0.3" />
    {/* Text overlay indicator */}
    <rect x="12" y="32" width="24" height="6" rx="2" fill="currentColor" opacity="0.15" stroke="none" />
    <line x1="15" y1="35" x2="33" y2="35" strokeWidth="1.5" opacity="0.6" />
    {/* Copy/generate arrows */}
    <path d="M42 16 l4 0 l0 28 l-28 0 l0 -4" strokeDasharray="3 2" opacity="0.3" />
  </svg>
);

const MultiClipIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Stacked clip frames */}
    <rect x="6" y="6" width="26" height="32" rx="3" />
    <rect x="16" y="10" width="26" height="32" rx="3" />
    {/* Play triangle */}
    <polygon points="24,22 34,28 24,34" fill="currentColor" stroke="none" opacity="0.3" />
    {/* Text overlay bar */}
    <rect x="20" y="36" width="18" height="4" rx="1.5" fill="currentColor" opacity="0.15" stroke="none" />
    <line x1="22" y1="38" x2="36" y2="38" strokeWidth="1.5" opacity="0.6" />
  </svg>
);

const PhotoMontageIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Stacked photo frames */}
    <rect x="6" y="10" width="24" height="18" rx="2" />
    <rect x="14" y="16" width="24" height="18" rx="2" />
    {/* Mountains/landscape in front photo */}
    <path d="M16 30 l6 -8 l4 5 l3 -3 l7 6" strokeWidth="1.5" fill="currentColor" opacity="0.15" />
    {/* Sun */}
    <circle cx="33" cy="21" r="3" fill="currentColor" opacity="0.2" stroke="none" />
    {/* Play indicator */}
    <polygon points="20,40 28,44 20,48" fill="currentColor" stroke="none" opacity="0.4" />
    {/* Speed lines */}
    <line x1="30" y1="40" x2="38" y2="40" strokeWidth="2" opacity="0.3" />
    <line x1="32" y1="44" x2="42" y2="44" strokeWidth="2" opacity="0.3" />
  </svg>
);

const ICON_MAP = {
  'montage': MontageIcon,
  'solo-clip': SoloClipIcon,
  'multi-clip': MultiClipIcon,
  'photo-montage': PhotoMontageIcon
};

const TemplatePicker = ({ onSelect, onClose, clipCount = 0 }) => {
  const [hoveredId, setHoveredId] = useState(null);
  const { theme } = useTheme();
  const styles = getStyles(theme);

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Choose a video style</h2>
            <p style={styles.subtitle}>
              {clipCount > 0 ? `${clipCount} clip${clipCount !== 1 ? 's' : ''} selected` : 'Select how to edit your clips'}
            </p>
          </div>
          <button onClick={onClose} style={styles.closeButton}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Template Cards */}
        <div style={styles.cardGrid}>
          {TEMPLATES.map(template => {
            const IconComponent = ICON_MAP[template.icon] || MontageIcon;
            const isHovered = hoveredId === template.id;

            return (
              <div
                key={template.id}
                style={{
                  ...styles.card,
                  ...(isHovered ? styles.cardHover : {})
                }}
                onClick={() => onSelect(template.id)}
                onMouseEnter={() => setHoveredId(template.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div style={{
                  ...styles.iconContainer,
                  ...(isHovered ? styles.iconContainerHover : {})
                }}>
                  <IconComponent />
                </div>

                <h3 style={styles.cardTitle}>{template.name}</h3>
                <p style={styles.cardDescription}>{template.description}</p>

                <div style={styles.featureList}>
                  {template.features.map((feature, i) => (
                    <div key={i} style={styles.featureItem}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <div style={{
                  ...styles.selectButton,
                  ...(isHovered ? styles.selectButtonHover : {})
                }}>
                  Select {template.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const getStyles = (theme) => ({
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px'
  },
  container: {
    backgroundColor: theme.bg.input,
    borderRadius: '16px',
    border: `1px solid ${theme.border.subtle}`,
    padding: '32px',
    maxWidth: '960px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px'
  },
  title: {
    margin: 0,
    fontSize: '22px',
    fontWeight: '600',
    color: theme.text.primary,
    letterSpacing: '-0.01em'
  },
  subtitle: {
    margin: '6px 0 0 0',
    fontSize: '13px',
    color: theme.text.secondary
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: theme.text.muted,
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s'
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px'
  },
  card: {
    backgroundColor: theme.hover.bg,
    border: `1px solid ${theme.border.subtle}`,
    borderRadius: '12px',
    padding: '24px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center'
  },
  cardHover: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderColor: 'rgba(99, 102, 241, 0.3)',
    transform: 'translateY(-2px)'
  },
  iconContainer: {
    width: '80px',
    height: '80px',
    borderRadius: '16px',
    backgroundColor: theme.hover.bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
    color: theme.text.secondary,
    transition: 'all 0.2s ease'
  },
  iconContainerHover: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    color: theme.accent.hover
  },
  cardTitle: {
    margin: '0 0 6px 0',
    fontSize: '17px',
    fontWeight: '600',
    color: theme.text.primary
  },
  cardDescription: {
    margin: '0 0 16px 0',
    fontSize: '13px',
    color: theme.text.secondary,
    lineHeight: '1.4'
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '20px',
    width: '100%'
  },
  featureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: theme.text.primary,
    justifyContent: 'flex-start',
    paddingLeft: '20px'
  },
  selectButton: {
    marginTop: 'auto',
    padding: '10px 24px',
    borderRadius: '8px',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    color: theme.accent.hover,
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.2s ease',
    border: '1px solid rgba(99, 102, 241, 0.2)'
  },
  selectButtonHover: {
    backgroundColor: theme.accent.primary,
    color: theme.text.primary,
    borderColor: theme.accent.primary
  }
});

export default TemplatePicker;
