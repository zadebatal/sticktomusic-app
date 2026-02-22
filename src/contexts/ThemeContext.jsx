import React, { createContext, useContext, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════
// Theme Definitions
// ═══════════════════════════════════════════════════

const THEMES = {
  dark: {
    id: 'dark',
    name: 'Dark',
    // Inline style values (for VideoStudio, SchedulingPage, etc.)
    bg: { page: '#09090b', surface: '#18181b', elevated: '#27272a', input: '#1a1a1e' },
    text: { primary: '#f4f4f5', secondary: '#a1a1aa', muted: '#71717a' },
    accent: { primary: '#6366f1', hover: '#818cf8', muted: '#312e81' },
    border: { default: '#27272a', subtle: '#1e1e22' },
    state: { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' },
    overlay: { light: 'rgba(0,0,0,0.4)', heavy: 'rgba(0,0,0,0.7)' },
    hover: { bg: 'rgba(255,255,255,0.05)' },
    shadow: '0 4px 20px rgba(0,0,0,0.3)',
    // Tailwind class strings (for LandingPage, AppShell, tabs)
    tw: {
      bgPage: 'bg-zinc-950', bgSurface: 'bg-zinc-900', bgElevated: 'bg-zinc-800', bgInput: 'bg-zinc-900',
      textPrimary: 'text-zinc-100', textSecondary: 'text-zinc-400', textMuted: 'text-zinc-600',
      accentText: 'text-indigo-400', accentBg: 'bg-indigo-600', accentBgHover: 'hover:bg-indigo-700',
      border: 'border-zinc-800', borderSubtle: 'border-zinc-900',
      hoverBg: 'hover:bg-zinc-800', hoverText: 'hover:text-white',
      tabActive: 'bg-white text-black', tabInactive: 'text-zinc-400 hover:text-white hover:bg-zinc-900',
      cardBg: 'bg-zinc-900/50', cardBorder: 'border-zinc-800',
      inputBorder: 'border-zinc-700', inputFocus: 'focus:border-indigo-500',
      btnPrimary: 'bg-white text-black hover:bg-zinc-200',
      btnSecondary: 'border border-zinc-600 text-zinc-100 hover:bg-zinc-900',
      btnDanger: 'bg-red-600 text-white hover:bg-red-700',
    }
  }
};

// ═══════════════════════════════════════════════════
// Context & Provider
// ═══════════════════════════════════════════════════

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const themeId = 'dark';
  const theme = THEMES.dark;

  // No-op — locked to dark theme
  const setTheme = useCallback(() => {}, []);

  // Apply theme to document body for base styling
  useEffect(() => {
    document.body.style.backgroundColor = theme.bg.page;
    document.body.style.color = theme.text.primary;
    document.body.style.transition = 'background-color 0.3s ease, color 0.3s ease';
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, themeId, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};

export { THEMES };
export default ThemeContext;
