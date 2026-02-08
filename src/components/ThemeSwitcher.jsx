import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const ThemeSwitcher = () => {
  const { themeId, setTheme, themes } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const themeOptions = [
    { id: 'dark', label: 'Dark', preview: '#18181b', ring: '#6366f1' },
    { id: 'bright', label: 'Bright', preview: '#f4f4f5', ring: '#4f46e5' },
  ];

  return (
    <div style={{
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px'
    }}>
      {/* Expanded options */}
      {isOpen && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '6px',
          padding: '10px', borderRadius: '12px',
          backgroundColor: themes[themeId]?.bg.elevated || '#27272a',
          border: `1px solid ${themes[themeId]?.border.default || '#27272a'}`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.15s ease'
        }}>
          {themeOptions.map(opt => (
            <button
              key={opt.id}
              onClick={() => { setTheme(opt.id); setIsOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 12px', borderRadius: '8px', border: 'none',
                backgroundColor: themeId === opt.id ? (themes[themeId]?.accent.muted || '#312e81') : 'transparent',
                color: themes[themeId]?.text.primary || '#fff',
                cursor: 'pointer', fontSize: '12px', fontWeight: '500',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                transition: 'background-color 0.15s'
              }}
            >
              <span style={{
                width: '16px', height: '16px', borderRadius: '50%',
                backgroundColor: opt.preview,
                border: themeId === opt.id ? `2px solid ${opt.ring}` : '2px solid transparent',
                flexShrink: 0
              }} />
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '36px', height: '36px', borderRadius: '50%',
          border: `2px solid ${themes[themeId]?.border.default || '#27272a'}`,
          backgroundColor: themes[themeId]?.bg.elevated || '#27272a',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          transition: 'transform 0.15s, box-shadow 0.15s',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)'
        }}
        title="Switch theme"
      >
        <span style={{
          width: '14px', height: '14px', borderRadius: '50%',
          background: themeId === 'bright'
            ? 'linear-gradient(135deg, #f4f4f5, #4f46e5)'
            : 'linear-gradient(135deg, #18181b, #6366f1)'
        }} />
      </button>
    </div>
  );
};

export default ThemeSwitcher;
