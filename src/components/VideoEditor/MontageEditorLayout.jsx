import React, { useState, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../ui/components/Button';

/**
 * MontageEditorLayout — NLE-style multi-panel layout for montage editor (Wave 3)
 *
 * Replaces tab-based layout with all panels visible simultaneously:
 *   Top-left:  Video preview with playback controls
 *   Top-right: Stacked content panels (Library, Lyrics, Style) — each collapsible
 *   Bottom:    Full-width multi-track timeline
 *
 * Each panel has a collapse toggle and remembers its state.
 */
const MontageEditorLayout = ({
  // Content to render in each slot
  previewContent,
  libraryContent,
  lyricsContent,
  styleContent,
  timelineContent,
  // Optional header content
  headerContent,
  // Layout config
  initialPanelStates = { library: true, lyrics: true, style: false }
}) => {
  const { theme } = useTheme();
  // Panel collapse states
  const [panels, setPanels] = useState(initialPanelStates);

  const togglePanel = useCallback((name) => {
    setPanels(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const expandAll = useCallback(() => {
    setPanels({ library: true, lyrics: true, style: true });
  }, []);

  const collapseAll = useCallback(() => {
    setPanels({ library: false, lyrics: false, style: false });
  }, []);

  const openCount = Object.values(panels).filter(Boolean).length;

  const layoutStyles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: theme.bg.page,
      color: theme.text.primary,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden'
    },
    header: {
      flexShrink: 0
    },
    mainArea: {
      display: 'flex',
      flex: 1,
      overflow: 'hidden',
      minHeight: 0
    },
    previewColumn: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderRight: `1px solid ${theme.bg.elevated}`
    },
    panelsColumn: {
      width: '380px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      backgroundColor: theme.bg.input
    },
    panelControls: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      borderBottom: `1px solid ${theme.border.subtle}`,
      backgroundColor: theme.bg.surface,
      flexShrink: 0
    },
    panelControlsLabel: {
      fontSize: '11px',
      fontWeight: '600',
      color: theme.text.muted,
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    },
    panelControlsBtns: {
      display: 'flex',
      gap: '6px'
    },
    panelsScroll: {
      flex: 1,
      overflowY: 'auto',
      padding: '4px'
    },
    timelineArea: {
      height: '200px',
      flexShrink: 0,
      borderTop: `2px solid ${theme.bg.elevated}`,
      backgroundColor: theme.bg.page,
      overflow: 'hidden'
    }
  };

  return (
    <div style={layoutStyles.container}>
      {/* Header */}
      {headerContent && (
        <div style={layoutStyles.header}>
          {headerContent}
        </div>
      )}

      {/* Main Area: Preview (left) + Panels (right) */}
      <div style={layoutStyles.mainArea}>
        {/* Left: Video Preview */}
        <div style={layoutStyles.previewColumn}>
          {previewContent}
        </div>

        {/* Right: Stacked Panels */}
        <div style={layoutStyles.panelsColumn}>
          {/* Panel controls bar */}
          <div style={layoutStyles.panelControls}>
            <span style={layoutStyles.panelControlsLabel}>Panels</span>
            <div style={layoutStyles.panelControlsBtns}>
              <Button variant="neutral-tertiary" size="small" onClick={expandAll}>Expand All</Button>
              <Button variant="neutral-tertiary" size="small" onClick={collapseAll}>Collapse All</Button>
            </div>
          </div>

          {/* Scrollable panels stack */}
          <div style={layoutStyles.panelsScroll}>
            {/* Library Panel */}
            <CollapsiblePanel
              title="Library"
              icon={'\uD83D\uDCCE'}
              isOpen={panels.library}
              onToggle={() => togglePanel('library')}
              accentColor="#6366f1"
            >
              {libraryContent}
            </CollapsiblePanel>

            {/* Lyrics Panel */}
            <CollapsiblePanel
              title="Lyrics"
              icon={'\uD83D\uDCDD'}
              isOpen={panels.lyrics}
              onToggle={() => togglePanel('lyrics')}
              accentColor="#a78bfa"
            >
              {lyricsContent}
            </CollapsiblePanel>

            {/* Style Panel */}
            <CollapsiblePanel
              title="Style"
              icon={'\uD83C\uDFA8'}
              isOpen={panels.style}
              onToggle={() => togglePanel('style')}
              accentColor="#f59e0b"
            >
              {styleContent}
            </CollapsiblePanel>
          </div>
        </div>
      </div>

      {/* Bottom: Full-width Timeline */}
      <div style={layoutStyles.timelineArea}>
        {timelineContent}
      </div>
    </div>
  );
};

/**
 * CollapsiblePanel — Individual panel with header toggle
 */
const CollapsiblePanel = ({ title, icon, isOpen, onToggle, accentColor, children }) => {
  const { theme } = useTheme();

  const panelStyles = {
    container: {
      marginBottom: '4px',
      borderRadius: '8px',
      backgroundColor: theme.bg.input,
      overflow: 'hidden',
      borderLeft: `3px solid ${isOpen ? accentColor : theme.bg.elevated}`,
      transition: 'border-left-color 0.2s'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      padding: '10px 12px',
      border: 'none',
      backgroundColor: 'transparent',
      cursor: 'pointer',
      textAlign: 'left'
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    icon: {
      fontSize: '14px'
    },
    title: {
      fontSize: '13px',
      fontWeight: '600',
      color: isOpen ? theme.text.primary : theme.text.muted,
      transition: 'color 0.15s'
    },
    chevron: {
      fontSize: '10px',
      color: theme.text.muted,
      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s ease'
    },
    content: {
      padding: '0 12px 12px 12px',
      maxHeight: '300px',
      overflowY: 'auto'
    }
  };

  return (
    <div style={panelStyles.container}>
      {/* Panel Header (always visible) */}
      <button
        style={panelStyles.header}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div style={panelStyles.headerLeft}>
          <span style={panelStyles.icon}>{icon}</span>
          <span style={panelStyles.title}>
            {title}
          </span>
        </div>
        <span style={panelStyles.chevron}>
          {'\u25BC'}
        </span>
      </button>

      {/* Panel Content (collapsible) */}
      {isOpen && (
        <div style={panelStyles.content}>
          {children}
        </div>
      )}
    </div>
  );
};

export default MontageEditorLayout;
