import React, { useState, useMemo } from 'react';

/**
 * BeatSelector - Select which beats to cut on
 * Shows beats organized by measure with tap-to-select
 */
const BeatSelector = ({
  beats = [],
  bpm = 120,
  duration = 30,
  onApply,
  onCancel
}) => {
  const [selectedBeats, setSelectedBeats] = useState(new Set());

  // Organize beats into measures (assuming 4/4 time)
  const beatsPerMeasure = 4;
  const measures = useMemo(() => {
    if (!beats.length) return [];

    const measuresArray = [];
    let currentMeasure = [];
    let measureIndex = 1;

    beats.forEach((beatTime, i) => {
      const beatInMeasure = (i % beatsPerMeasure) + 1;

      currentMeasure.push({
        time: beatTime,
        index: i,
        beatNumber: beatInMeasure
      });

      if (currentMeasure.length === beatsPerMeasure || i === beats.length - 1) {
        measuresArray.push({
          number: measureIndex,
          beats: [...currentMeasure]
        });
        currentMeasure = [];
        measureIndex++;
      }
    });

    return measuresArray;
  }, [beats, bpm]);

  // Toggle beat selection
  const toggleBeat = (beatIndex) => {
    setSelectedBeats(prev => {
      const newSet = new Set(prev);
      if (newSet.has(beatIndex)) {
        newSet.delete(beatIndex);
      } else {
        newSet.add(beatIndex);
      }
      return newSet;
    });
  };

  // Preset selections
  const applyPreset = (preset) => {
    const newSelection = new Set();

    beats.forEach((_, i) => {
      const beatInMeasure = (i % beatsPerMeasure) + 1;

      switch (preset) {
        case 'all':
          newSelection.add(i);
          break;
        case 'none':
          break;
        case 'downbeats':
          if (beatInMeasure === 1) newSelection.add(i);
          break;
        case '1and3':
          if (beatInMeasure === 1 || beatInMeasure === 3) newSelection.add(i);
          break;
        case '2and4':
          if (beatInMeasure === 2 || beatInMeasure === 4) newSelection.add(i);
          break;
        case 'every2':
          if (i % 2 === 0) newSelection.add(i);
          break;
        case 'every4':
          if (i % 4 === 0) newSelection.add(i);
          break;
        default:
          break;
      }
    });

    setSelectedBeats(newSelection);
  };

  // Get selected beat times
  const getSelectedBeatTimes = () => {
    return Array.from(selectedBeats)
      .sort((a, b) => a - b)
      .map(i => beats[i]);
  };

  const formatTime = (seconds) => {
    return `${seconds.toFixed(1)}s`;
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerIcon}>🎵</div>
          <div>
            <h2 style={styles.title}>Add cuts on beats ({selectedBeats.size} selected)</h2>
            <p style={styles.subtitle}>
              Tap beats to add cut points, or use a preset to select multiple beats at once.
            </p>
          </div>
          <button style={styles.closeButton} onClick={onCancel}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Presets */}
        <div style={styles.presets}>
          <button
            style={selectedBeats.size === 0 ? styles.presetActive : styles.preset}
            onClick={() => applyPreset('none')}
          >
            None
          </button>
          <button style={styles.preset} onClick={() => applyPreset('downbeats')}>
            Downbeats only
          </button>
          <button style={styles.preset} onClick={() => applyPreset('1and3')}>
            Beats 1 & 3
          </button>
          <button style={styles.preset} onClick={() => applyPreset('2and4')}>
            Beats 2 & 4
          </button>
          <button style={styles.preset} onClick={() => applyPreset('every2')}>
            Every 2nd
          </button>
          <button style={styles.preset} onClick={() => applyPreset('all')}>
            All beats
          </button>
        </div>

        {/* Beats Grid */}
        <div style={styles.beatsContainer}>
          {measures.length === 0 ? (
            <div style={styles.noBeats}>
              <p>No beats detected yet. Make sure audio is loaded.</p>
            </div>
          ) : (
            measures.map(measure => (
              <div key={measure.number} style={styles.measure}>
                <div style={styles.measureLabel}>Measure {measure.number}</div>
                <div style={styles.measureBeats}>
                  {measure.beats.map(beat => (
                    <button
                      key={beat.index}
                      style={{
                        ...styles.beat,
                        ...(selectedBeats.has(beat.index) ? styles.beatSelected : {})
                      }}
                      onClick={() => toggleBeat(beat.index)}
                    >
                      <span style={styles.beatNumber}>{beat.beatNumber}</span>
                      <span style={styles.beatTime}>{formatTime(beat.time)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <span style={styles.beatCount}>
            {beats.length} beats within duration
          </span>
          <div style={styles.footerActions}>
            <button style={styles.cancelButton} onClick={onCancel}>
              Cancel
            </button>
            <button
              style={styles.applyButton}
              onClick={() => onApply(getSelectedBeatTimes())}
              disabled={selectedBeats.size === 0}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Apply {selectedBeats.size} cuts
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '20px'
  },
  modal: {
    width: '100%',
    maxWidth: '600px',
    maxHeight: '80vh',
    backgroundColor: '#fff',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '20px 20px 16px',
    borderBottom: '1px solid #e5e7eb'
  },
  headerIcon: {
    fontSize: '24px'
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111',
    margin: '0 0 4px 0'
  },
  subtitle: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0,
    maxWidth: '400px'
  },
  closeButton: {
    marginLeft: 'auto',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    color: '#6b7280',
    cursor: 'pointer'
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '16px 20px',
    borderBottom: '1px solid #e5e7eb'
  },
  preset: {
    padding: '8px 16px',
    backgroundColor: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '20px',
    color: '#374151',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  presetActive: {
    padding: '8px 16px',
    backgroundColor: '#111',
    border: '1px solid #111',
    borderRadius: '20px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  beatsContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 20px'
  },
  noBeats: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280'
  },
  measure: {
    marginBottom: '16px'
  },
  measureLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  measureBeats: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  beat: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    backgroundColor: '#f9fafb',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    minWidth: '80px'
  },
  beatSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
    color: '#fff'
  },
  beatNumber: {
    fontSize: '16px',
    fontWeight: '700'
  },
  beatTime: {
    fontSize: '12px',
    opacity: 0.7
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderTop: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb'
  },
  beatCount: {
    fontSize: '13px',
    color: '#6b7280'
  },
  footerActions: {
    display: 'flex',
    gap: '8px'
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    color: '#374151',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  applyButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: '#111',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  }
};

export default BeatSelector;
