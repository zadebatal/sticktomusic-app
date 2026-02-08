import React, { useState, useCallback } from 'react';

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

  return (
    <div style={layout.container}>
      {/* Header */}
      {headerContent && (
        <div style={layout.header}>
          {headerContent}
        </div>
      )}

      {/* Main Area: Preview (left) + Panels (right) */}
      <div style={layout.mainArea}>
        {/* Left: Video Preview */}
        <div style={layout.previewColumn}>
          {previewContent}
        </div>

        {/* Right: Stacked Panels */}
        <div style={layout.panelsColumn}>
          {/* Panel controls bar */}
          <div style={layout.panelControls}>
            <span style={layout.panelControlsLabel}>Panels</span>
            <div style={layout.panelControlsBtns}>
              <button
                style={layout.panelControlBtn}
                onClick={expandAll}
                title="Expand all panels"
              >
                Expand All
              </button>
              <button
                style={layout.panelControlBtn}
                onClick={collapseAll}
                title="Collapse all panels"
              >
                Collapse All
              </button>
            </div>
          </div>

          {/* Scrollable panels stack */}
          <div style={layout.panelsScroll}>
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
      <div style={layout.timelineArea}>
        {timelineContent}
      </div>
    </div>
  );
};

/**
 * CollapsiblePanel — Individual panel with header toggle
 */
const CollapsiblePanel = ({ title, icon, isOpen, onToggle, accentColor, children }) => {
  return (
    <div style={{
      ...panel.container,
      borderLeftColor: isOpen ? accentColor : '#27272a'
    }}>
      {/* Panel Header (always visible) */}
      <button
        style={panel.header}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div style={panel.headerLeft}>
          <span style={panel.icon}>{icon}</span>
          <span style={{
            ...panel.title,
            color: isOpen ? '#fff' : '#71717a'
          }}>
            {title}
          </span>
        </div>
        <span style={{
          ...panel.chevron,
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
        }}>
          {'\u25BC'}
        </span>
      </button>

      {/* Panel Content (collapsible) */}
      {isOpen && (
        <div style={panel.content}>
          {children}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════
// Layout Styles
// ═══════════════════════════════════════════════════

const layout = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#0a0a0f',
    color: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    overflow: 'hidden'
  },
  header: {
    flexShrink: 0
  },

  // Main area: preview + panels side by side
  mainArea: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0
  },

  // Left column: video preview
  previewColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRight: '1px solid #27272a'
  },

  // Right column: stacked panels
  panelsColumn: {
    width: '380px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: '#111114'
  },
  panelControls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #1e1e22',
    backgroundColor: '#18181b',
    flexShrink: 0
  },
  panelControlsLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#52525b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  panelControlsBtns: {
    display: 'flex',
    gap: '6px'
  },
  panelControlBtn: {
    padding: '3px 8px',
    borderRadius: '4px',
    border: '1px solid #3f3f46',
    backgroundColor: 'transparent',
    color: '#71717a',
    fontSize: '10px',
    cursor: 'pointer'
  },
  panelsScroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px'
  },

  // Bottom: timeline
  timelineArea: {
    height: '200px',
    flexShrink: 0,
    borderTop: '2px solid #27272a',
    backgroundColor: '#0f0f13',
    overflow: 'hidden'
  }
};

const panel = {
  container: {
    marginBottom: '4px',
    borderRadius: '8px',
    backgroundColor: '#1a1a1e',
    overflow: 'hidden',
    borderLeft: '3px solid #27272a',
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
    transition: 'color 0.15s'
  },
  chevron: {
    fontSize: '10px',
    color: '#52525b',
    transition: 'transform 0.2s ease'
  },
  content: {
    padding: '0 12px 12px 12px',
    maxHeight: '300px',
    overflowY: 'auto'
  }
};

export default MontageEditorLayout;
