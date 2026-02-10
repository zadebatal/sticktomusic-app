import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

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
  },
  bright: {
    id: 'bright',
    name: 'Bright',
    bg: { page: '#ffffff', surface: '#f4f4f5', elevated: '#e4e4e7', input: '#ffffff' },
    text: { primary: '#18181b', secondary: '#52525b', muted: '#a1a1aa' },
    accent: { primary: '#4f46e5', hover: '#6366f1', muted: '#e0e7ff' },
    border: { default: '#d4d4d8', subtle: '#e4e4e7' },
    state: { success: '#16a34a', error: '#dc2626', warning: '#d97706', info: '#2563eb' },
    overlay: { light: 'rgba(0,0,0,0.3)', heavy: 'rgba(0,0,0,0.5)' },
    hover: { bg: 'rgba(0,0,0,0.04)' },
    shadow: '0 4px 20px rgba(0,0,0,0.15)',
    tw: {
      bgPage: 'bg-white', bgSurface: 'bg-gray-100', bgElevated: 'bg-gray-200', bgInput: 'bg-white',
      textPrimary: 'text-gray-900', textSecondary: 'text-gray-600', textMuted: 'text-gray-400',
      accentText: 'text-indigo-600', accentBg: 'bg-indigo-600', accentBgHover: 'hover:bg-indigo-700',
      border: 'border-gray-300', borderSubtle: 'border-gray-200',
      hoverBg: 'hover:bg-gray-100', hoverText: 'hover:text-gray-900',
      tabActive: 'bg-gray-900 text-white', tabInactive: 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
      cardBg: 'bg-gray-50', cardBorder: 'border-gray-200',
      inputBorder: 'border-gray-300', inputFocus: 'focus:border-indigo-500',
      btnPrimary: 'bg-gray-900 text-white hover:bg-gray-800',
      btnSecondary: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
      btnDanger: 'bg-red-600 text-white hover:bg-red-700',
    }
  }
};

// ═══════════════════════════════════════════════════
// Context & Provider
// ═══════════════════════════════════════════════════

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [themeId, setThemeId] = useState(() => {
    try { return localStorage.getItem('stm_theme') || 'dark'; }
    catch { return 'dark'; }
  });

  const theme = THEMES[themeId] || THEMES.dark;

  const setTheme = useCallback((id) => {
    if (THEMES[id]) {
      setThemeId(id);
      try { localStorage.setItem('stm_theme', id); } catch {}
      // Dispatch event so components outside ThemeProvider (e.g. App.jsx) can react
      window.dispatchEvent(new CustomEvent('stm-theme-change', { detail: id }));
    }
  }, []);

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
