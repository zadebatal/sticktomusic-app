import React from 'react';

const TextControls = ({ textStyle, onChange }) => {
  const handleChange = (key, value) => {
    onChange({ ...textStyle, [key]: value });
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Text Style</h3>

      {/* Font Size */}
      <div style={styles.controlGroup}>
        <label style={styles.label}>Size</label>
        <div style={styles.sizeControls}>
          <button
            onClick={() => handleChange('fontSize', Math.max(20, textStyle.fontSize - 4))}
            style={styles.sizeButton}
          >
            A-
          </button>
          <span style={styles.sizeValue}>{textStyle.fontSize}px</span>
          <button
            onClick={() => handleChange('fontSize', Math.min(120, textStyle.fontSize + 4))}
            style={styles.sizeButton}
          >
            A+
          </button>
        </div>
      </div>

      {/* Font Family */}
      <div style={styles.controlGroup}>
        <label style={styles.label}>Font</label>
        <select
          value={textStyle.fontFamily}
          onChange={(e) => handleChange('fontFamily', e.target.value)}
          style={styles.select}
        >
          <option value="sans-serif">Sans</option>
          <option value="serif">Serif</option>
          <option value="monospace">Mono</option>
          <option value="Impact, sans-serif">Impact</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Courier New', monospace">Courier</option>
        </select>
      </div>

      {/* Text Color */}
      <div style={styles.controlGroup}>
        <label style={styles.label}>Color</label>
        <div style={styles.colorControls}>
          <input
            type="color"
            value={textStyle.color}
            onChange={(e) => handleChange('color', e.target.value)}
            style={styles.colorPicker}
          />
          <div style={styles.colorPresets}>
            {['#ffffff', '#000000', '#ef4444', '#22c55e', '#3b82f6', '#f59e0b'].map(color => (
              <button
                key={color}
                onClick={() => handleChange('color', color)}
                style={{
                  ...styles.colorPreset,
                  backgroundColor: color,
                  border: textStyle.color === color ? '2px solid #7c3aed' : '2px solid transparent'
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Outline Toggle */}
      <div style={styles.controlGroup}>
        <label style={styles.label}>Outline</label>
        <div style={styles.toggleGroup}>
          <button
            onClick={() => handleChange('outline', false)}
            style={!textStyle.outline ? styles.toggleActive : styles.toggle}
          >
            No outline
          </button>
          <button
            onClick={() => handleChange('outline', true)}
            style={textStyle.outline ? styles.toggleActive : styles.toggle}
          >
            Outline
          </button>
        </div>
      </div>

      {/* Outline Color (if outline enabled) */}
      {textStyle.outline && (
        <div style={styles.controlGroup}>
          <label style={styles.label}>Outline Color</label>
          <div style={styles.colorControls}>
            <input
              type="color"
              value={textStyle.outlineColor}
              onChange={(e) => handleChange('outlineColor', e.target.value)}
              style={styles.colorPicker}
            />
            <div style={styles.colorPresets}>
              {['#000000', '#ffffff', '#1e293b', '#7c3aed'].map(color => (
                <button
                  key={color}
                  onClick={() => handleChange('outlineColor', color)}
                  style={{
                    ...styles.colorPreset,
                    backgroundColor: color,
                    border: textStyle.outlineColor === color ? '2px solid #7c3aed' : '2px solid #334155'
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Text Case */}
      <div style={styles.controlGroup}>
        <label style={styles.label}>Case</label>
        <div style={styles.toggleGroup}>
          <button
            onClick={() => handleChange('textCase', 'default')}
            style={textStyle.textCase === 'default' ? styles.toggleActive : styles.toggle}
          >
            Default
          </button>
          <button
            onClick={() => handleChange('textCase', 'lower')}
            style={textStyle.textCase === 'lower' ? styles.toggleActive : styles.toggle}
          >
            lower
          </button>
          <button
            onClick={() => handleChange('textCase', 'upper')}
            style={textStyle.textCase === 'upper' ? styles.toggleActive : styles.toggle}
          >
            UPPER
          </button>
        </div>
      </div>

      {/* Text Layout */}
      <div style={styles.controlGroup}>
        <label style={styles.label}>Layout</label>
        <div style={styles.toggleGroup}>
          <button
            onClick={() => handleChange('layout', 'word')}
            style={textStyle.layout === 'word' ? styles.toggleActive : styles.toggle}
          >
            By word
          </button>
          <button
            onClick={() => handleChange('layout', 'line')}
            style={textStyle.layout === 'line' ? styles.toggleActive : styles.toggle}
          >
            Build line
          </button>
          <button
            onClick={() => handleChange('layout', 'justify')}
            style={textStyle.layout === 'justify' ? styles.toggleActive : styles.toggle}
          >
            Justify
          </button>
        </div>
      </div>

      {/* Preview */}
      <div style={styles.preview}>
        <div
          style={{
            fontSize: Math.min(textStyle.fontSize, 32),
            fontFamily: textStyle.fontFamily,
            color: textStyle.color,
            textShadow: textStyle.outline
              ? `
                -1px -1px 0 ${textStyle.outlineColor},
                1px -1px 0 ${textStyle.outlineColor},
                -1px 1px 0 ${textStyle.outlineColor},
                1px 1px 0 ${textStyle.outlineColor}
              `
              : 'none',
            textTransform: textStyle.textCase === 'upper' ? 'uppercase' :
              textStyle.textCase === 'lower' ? 'lowercase' : 'none'
          }}
        >
          Preview Text
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    backgroundColor: '#1e293b',
    borderRadius: '8px'
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: '600',
    color: '#e2e8f0'
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  label: {
    fontSize: '12px',
    color: '#94a3b8',
    fontWeight: '500'
  },
  sizeControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  sizeButton: {
    padding: '6px 12px',
    backgroundColor: '#334155',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600'
  },
  sizeValue: {
    minWidth: '60px',
    textAlign: 'center',
    fontSize: '14px',
    color: '#e2e8f0'
  },
  select: {
    padding: '8px 12px',
    backgroundColor: '#334155',
    color: 'white',
    border: '1px solid #475569',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  colorControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  colorPicker: {
    width: '40px',
    height: '32px',
    padding: 0,
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  colorPresets: {
    display: 'flex',
    gap: '4px'
  },
  colorPreset: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    cursor: 'pointer',
    padding: 0
  },
  toggleGroup: {
    display: 'flex',
    gap: '4px'
  },
  toggle: {
    padding: '6px 12px',
    backgroundColor: '#334155',
    color: '#94a3b8',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  toggleActive: {
    padding: '6px 12px',
    backgroundColor: '#7c3aed',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  preview: {
    marginTop: '8px',
    padding: '16px',
    backgroundColor: '#0f172a',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60px'
  }
};

export default TextControls;
