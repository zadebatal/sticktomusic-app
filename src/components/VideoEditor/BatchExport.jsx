import React, { useState } from 'react';
import { rerollAllClips } from './AutoRemixEngine';

/**
 * Batch Export - Generate multiple variations and export them all
 */
const BatchExport = ({
  project,
  contentBank,
  onGenerateVariation,
  onExportAll,
  onClose
}) => {
  const [variations, setVariations] = useState([
    { id: 1, name: `${project?.name || 'Video'}_v1`, clips: project?.clips || [], selected: true }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);

  // Add new variation
  const addVariation = async () => {
    if (!contentBank?.clips?.length) {
      alert('Need a content bank with clips to generate variations');
      return;
    }

    setIsGenerating(true);

    // Generate new clips by rerolling all
    const newClips = rerollAllClips(project?.clips || [], contentBank);

    const newVariation = {
      id: Date.now(),
      name: `${project?.name || 'Video'}_v${variations.length + 1}`,
      clips: newClips,
      selected: true
    };

    setVariations([...variations, newVariation]);
    setIsGenerating(false);
  };

  // Generate multiple variations at once
  const generateMultiple = async (count) => {
    if (!contentBank?.clips?.length) {
      alert('Need a content bank with clips to generate variations');
      return;
    }

    setIsGenerating(true);

    const newVariations = [];
    for (let i = 0; i < count; i++) {
      const newClips = rerollAllClips(
        variations[0]?.clips || project?.clips || [],
        contentBank
      );

      newVariations.push({
        id: Date.now() + i,
        name: `${project?.name || 'Video'}_v${variations.length + i + 1}`,
        clips: newClips,
        selected: true
      });

      // Small delay to ensure unique IDs
      await new Promise(r => setTimeout(r, 50));
    }

    setVariations([...variations, ...newVariations]);
    setIsGenerating(false);
  };

  // Toggle variation selection
  const toggleVariation = (id) => {
    setVariations(variations.map(v =>
      v.id === id ? { ...v, selected: !v.selected } : v
    ));
  };

  // Rename variation
  const renameVariation = (id, name) => {
    setVariations(variations.map(v =>
      v.id === id ? { ...v, name } : v
    ));
  };

  // Delete variation
  const deleteVariation = (id) => {
    if (variations.length === 1) {
      alert('Must keep at least one variation');
      return;
    }
    setVariations(variations.filter(v => v.id !== id));
  };

  // Export selected variations
  const exportSelected = async () => {
    const selected = variations.filter(v => v.selected);
    if (selected.length === 0) {
      alert('Select at least one variation to export');
      return;
    }

    setIsExporting(true);
    setExportProgress({ current: 0, total: selected.length });

    for (let i = 0; i < selected.length; i++) {
      const variation = selected[i];
      setExportProgress({ current: i + 1, total: selected.length, name: variation.name });

      // Call export handler for each variation
      await onExportAll?.({
        ...project,
        name: variation.name,
        clips: variation.clips
      });

      // Small delay between exports
      await new Promise(r => setTimeout(r, 500));
    }

    setIsExporting(false);
    setExportProgress(null);
    alert(`Exported ${selected.length} video(s) successfully!`);
  };

  const selectedCount = variations.filter(v => v.selected).length;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Batch Export</h2>
          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>

        <div style={styles.content}>
          {/* Quick Generate Buttons */}
          <div style={styles.quickGenerate}>
            <span style={styles.quickGenerateLabel}>Quick Generate:</span>
            <button
              style={styles.quickButton}
              onClick={() => generateMultiple(3)}
              disabled={isGenerating}
            >
              +3 Variations
            </button>
            <button
              style={styles.quickButton}
              onClick={() => generateMultiple(5)}
              disabled={isGenerating}
            >
              +5 Variations
            </button>
            <button
              style={styles.quickButton}
              onClick={() => generateMultiple(10)}
              disabled={isGenerating}
            >
              +10 Variations
            </button>
          </div>

          {/* Variations List */}
          <div style={styles.variationsList}>
            {variations.map((variation, index) => (
              <div
                key={variation.id}
                style={{
                  ...styles.variationCard,
                  ...(variation.selected ? styles.variationCardSelected : {})
                }}
              >
                <div style={styles.variationCheckbox}>
                  <input
                    type="checkbox"
                    checked={variation.selected}
                    onChange={() => toggleVariation(variation.id)}
                    style={styles.checkbox}
                  />
                </div>

                <div style={styles.variationPreview}>
                  {/* Show first clip thumbnail */}
                  {variation.clips[0]?.thumbnail ? (
                    <img
                      src={variation.clips[0].thumbnail}
                      alt=""
                      style={styles.previewImg}
                    />
                  ) : (
                    <div style={styles.previewPlaceholder}>🎬</div>
                  )}
                  <span style={styles.clipCount}>{variation.clips.length} clips</span>
                </div>

                <div style={styles.variationInfo}>
                  <input
                    type="text"
                    value={variation.name}
                    onChange={(e) => renameVariation(variation.id, e.target.value)}
                    style={styles.variationNameInput}
                  />
                  <span style={styles.variationMeta}>
                    {index === 0 ? 'Original' : `Variation ${index}`}
                  </span>
                </div>

                <div style={styles.variationActions}>
                  {index > 0 && (
                    <button
                      style={styles.deleteButton}
                      onClick={() => deleteVariation(variation.id)}
                      title="Delete variation"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add Variation Button */}
          <button
            style={styles.addButton}
            onClick={addVariation}
            disabled={isGenerating}
          >
            {isGenerating ? '⏳ Generating...' : '+ Add Variation'}
          </button>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <div style={styles.footerInfo}>
            <span style={styles.selectedCount}>
              {selectedCount} selected
            </span>
          </div>

          {exportProgress ? (
            <div style={styles.exportProgress}>
              <div style={styles.progressBar}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${(exportProgress.current / exportProgress.total) * 100}%`
                  }}
                />
              </div>
              <span style={styles.progressText}>
                Exporting {exportProgress.current}/{exportProgress.total}: {exportProgress.name}
              </span>
            </div>
          ) : (
            <button
              style={styles.exportButton}
              onClick={exportSelected}
              disabled={selectedCount === 0 || isExporting}
            >
              🚀 Export {selectedCount} Video{selectedCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    width: '90%',
    maxWidth: '700px',
    maxHeight: '80vh',
    backgroundColor: '#1e293b',
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
    borderBottom: '1px solid #334155'
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: 'white'
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
    color: '#94a3b8',
    fontSize: '24px',
    cursor: 'pointer'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '20px'
  },
  quickGenerate: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: '#0f172a',
    borderRadius: '8px'
  },
  quickGenerateLabel: {
    fontSize: '13px',
    color: '#94a3b8'
  },
  quickButton: {
    padding: '8px 16px',
    backgroundColor: '#334155',
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },
  variationsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '16px'
  },
  variationCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    border: '2px solid transparent',
    transition: 'border-color 0.2s'
  },
  variationCardSelected: {
    borderColor: '#7c3aed'
  },
  variationCheckbox: {
    flexShrink: 0
  },
  checkbox: {
    width: '20px',
    height: '20px',
    cursor: 'pointer'
  },
  variationPreview: {
    position: 'relative',
    width: '80px',
    height: '45px',
    backgroundColor: '#1e293b',
    borderRadius: '4px',
    overflow: 'hidden',
    flexShrink: 0
  },
  previewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  previewPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px'
  },
  clipCount: {
    position: 'absolute',
    bottom: '2px',
    right: '2px',
    padding: '2px 4px',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: '2px',
    fontSize: '9px',
    color: 'white'
  },
  variationInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  variationNameInput: {
    padding: '6px 10px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '4px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '500'
  },
  variationMeta: {
    fontSize: '12px',
    color: '#64748b'
  },
  variationActions: {
    flexShrink: 0
  },
  deleteButton: {
    padding: '6px 10px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    opacity: 0.6,
    transition: 'opacity 0.2s'
  },
  addButton: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#334155',
    border: '2px dashed #475569',
    borderRadius: '8px',
    color: '#94a3b8',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderTop: '1px solid #334155',
    backgroundColor: '#0f172a'
  },
  footerInfo: {},
  selectedCount: {
    fontSize: '14px',
    color: '#94a3b8'
  },
  exportProgress: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
    flex: 1,
    marginLeft: '20px'
  },
  progressBar: {
    width: '200px',
    height: '8px',
    backgroundColor: '#334155',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7c3aed',
    transition: 'width 0.3s'
  },
  progressText: {
    fontSize: '12px',
    color: '#94a3b8'
  },
  exportButton: {
    padding: '12px 32px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s'
  }
};

export default BatchExport;
