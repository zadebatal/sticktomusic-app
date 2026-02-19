/**
 * OnboardingModal - First-time template selection
 * Shows when user first enters the studio to help them set up their organization
 */

import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { STARTER_TEMPLATES, completeOnboarding, skipOnboarding } from '../../services/libraryService';
import { Button } from '../../ui/components/Button';

const OnboardingModal = ({ artistId, onComplete, isMobile }) => {
  const { theme } = useTheme();
  // Default to Music Artist template since this is an app for musicians
  const [selectedTemplate, setSelectedTemplate] = useState(STARTER_TEMPLATES.MUSIC_ARTIST);
  const [isAnimating, setIsAnimating] = useState(false);

  const templates = Object.values(STARTER_TEMPLATES);

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
  };

  const handleConfirm = () => {
    if (!selectedTemplate) return;

    setIsAnimating(true);

    // Complete onboarding with selected template
    completeOnboarding(artistId, selectedTemplate.id);

    setTimeout(() => {
      onComplete(selectedTemplate);
    }, 300);
  };

  const handleSkip = () => {
    setIsAnimating(true);
    skipOnboarding(artistId);

    setTimeout(() => {
      onComplete(null);
    }, 300);
  };

  const styles = {
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
      zIndex: 10000,
      padding: isMobile ? '16px' : '32px',
      opacity: isAnimating ? 0 : 1,
      transition: 'opacity 0.3s ease'
    },
    modal: {
      backgroundColor: theme.bg.input,
      borderRadius: '16px',
      maxWidth: '800px',
      width: '100%',
      maxHeight: '90vh',
      overflow: 'auto',
      border: `1px solid ${theme.border.subtle}`
    },
    header: {
      padding: isMobile ? '24px 20px 16px' : '32px 32px 24px',
      borderBottom: `1px solid ${theme.border.subtle}`,
      textAlign: 'center'
    },
    welcomeIcon: {
      fontSize: '48px',
      marginBottom: '16px'
    },
    title: {
      fontSize: isMobile ? '24px' : '28px',
      fontWeight: '600',
      color: theme.text.primary,
      margin: '0 0 8px 0'
    },
    subtitle: {
      fontSize: isMobile ? '14px' : '16px',
      color: theme.text.secondary,
      margin: 0,
      lineHeight: 1.5
    },
    content: {
      padding: isMobile ? '20px' : '32px'
    },
    sectionTitle: {
      fontSize: '14px',
      fontWeight: '600',
      color: theme.text.secondary,
      textTransform: 'uppercase',
      letterSpacing: '1px',
      marginBottom: '16px'
    },
    templatesGrid: {
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
      gap: '12px'
    },
    templateCard: {
      padding: '20px',
      backgroundColor: theme.hover.bg,
      borderRadius: '12px',
      border: '2px solid transparent',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      textAlign: 'left'
    },
    templateCardSelected: {
      backgroundColor: 'rgba(99, 102, 241, 0.15)',
      borderColor: theme.accent.primary
    },
    templateCardHover: {
      backgroundColor: theme.border.subtle
    },
    templateIcon: {
      fontSize: '32px',
      marginBottom: '12px'
    },
    templateName: {
      fontSize: '18px',
      fontWeight: '600',
      color: theme.text.primary,
      marginBottom: '4px'
    },
    templateDescription: {
      fontSize: '14px',
      color: theme.text.secondary,
      marginBottom: '12px'
    },
    templateCollections: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px'
    },
    collectionTag: {
      fontSize: '12px',
      padding: '4px 8px',
      backgroundColor: theme.border.subtle,
      borderRadius: '4px',
      color: theme.text.secondary
    },
    footer: {
      padding: isMobile ? '20px' : '24px 32px',
      borderTop: `1px solid ${theme.border.subtle}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '16px',
      flexDirection: isMobile ? 'column' : 'row'
    },
    previewSection: {
      marginTop: '24px',
      padding: '20px',
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
      borderRadius: '12px',
      border: '1px solid rgba(99, 102, 241, 0.2)'
    },
    previewTitle: {
      fontSize: '14px',
      fontWeight: '600',
      color: theme.accent.primary,
      marginBottom: '12px'
    },
    previewList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    },
    previewItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      color: theme.text.primary
    },
    previewIcon: {
      fontSize: '16px'
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={styles.welcomeIcon}>🎬</div>
          <h1 style={styles.title}>Welcome to Your Studio</h1>
          <p style={styles.subtitle}>
            Choose a template to get started with pre-organized collections,
            or start fresh and create your own system.
          </p>
        </div>

        <div style={styles.content}>
          <div style={styles.sectionTitle}>Choose Your Template</div>

          <div style={styles.templatesGrid}>
            {templates.map((template) => (
              <div
                key={template.id}
                style={{
                  ...styles.templateCard,
                  ...(selectedTemplate?.id === template.id ? styles.templateCardSelected : {})
                }}
                onClick={() => handleSelectTemplate(template)}
                onMouseEnter={(e) => {
                  if (selectedTemplate?.id !== template.id) {
                    e.currentTarget.style.backgroundColor = theme.border.subtle;
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedTemplate?.id !== template.id) {
                    e.currentTarget.style.backgroundColor = theme.hover.bg;
                  }
                }}
              >
                <div style={styles.templateIcon}>{template.icon}</div>
                <div style={styles.templateName}>{template.name}</div>
                <div style={styles.templateDescription}>{template.description}</div>

                {template.collections.length > 0 && (
                  <div style={styles.templateCollections}>
                    {template.collections.slice(0, 4).map((col, idx) => (
                      <span key={idx} style={styles.collectionTag}>
                        {col.name}
                      </span>
                    ))}
                    {template.collections.length > 4 && (
                      <span style={styles.collectionTag}>
                        +{template.collections.length - 4} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {selectedTemplate && selectedTemplate.collections.length > 0 && (
            <div style={styles.previewSection}>
              <div style={styles.previewTitle}>
                Collections that will be created:
              </div>
              <div style={styles.previewList}>
                {selectedTemplate.collections.map((col, idx) => (
                  <div key={idx} style={styles.previewItem}>
                    <span style={styles.previewIcon}>📁</span>
                    <strong>{col.name}</strong>
                    <span style={{ color: theme.text.secondary }}>— {col.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <Button variant="neutral-secondary" onClick={handleSkip}>Skip for now</Button>
          <Button variant="brand-primary" onClick={handleConfirm} disabled={!selectedTemplate}>
            {selectedTemplate?.id === 'template_custom'
              ? 'Start Fresh'
              : selectedTemplate
                ? `Use ${selectedTemplate.name} Template`
                : 'Select a Template'
            }
          </Button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
