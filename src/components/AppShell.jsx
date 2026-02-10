import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ThemeSwitcher from './ThemeSwitcher';
import useIsMobile from '../hooks/useIsMobile';

/**
 * AppShell — Post-login wrapper with top navigation tabs (desktop)
 * and bottom tab bar (mobile).
 * Tabs vary by userRole: conductor, operator, artist, collaborator.
 */

const TABS_BY_ROLE = {
  conductor: [
    { id: 'pages', label: 'Pages', icon: '📱' },
    { id: 'studio', label: 'Studio', icon: '🎬' },
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'artists', label: 'Artists', icon: '🎵' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ],
  operator: [
    { id: 'pages', label: 'Pages', icon: '📱' },
    { id: 'studio', label: 'Studio', icon: '🎬' },
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'artists', label: 'Artists', icon: '🎵' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ],
  artist: [
    { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { id: 'studio', label: 'Studio', icon: '🎬' },
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ],
  collaborator: [
    { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { id: 'studio', label: 'Studio', icon: '🎬' },
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ],
};

const AppShell = ({ activeTab, setActiveTab, user, onLogout, children, userRole = 'operator' }) => {
  const { theme } = useTheme();
  const t = theme.tw;
  const { isMobile } = useIsMobile();

  const tabs = TABS_BY_ROLE[userRole] || TABS_BY_ROLE.operator;

  return (
    <div className={`min-h-screen flex flex-col ${t.bgPage} ${t.textPrimary} font-sans`}>
      {/* TOP NAV — hidden on mobile */}
      {!isMobile && (
        <header
          className={`shrink-0 border-b ${t.border}`}
          style={{ backgroundColor: theme.bg.surface }}
        >
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            {/* Logo */}
            <span className={`text-base font-bold tracking-tight ${t.textPrimary} shrink-0`}>
              StickToMusic
            </span>

            {/* Tab Nav */}
            <nav className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                    activeTab === tab.id ? t.tabActive : t.tabInactive
                  }`}
                >
                  <span className="hidden sm:inline mr-1.5">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>

            {/* Profile */}
            <div className="flex items-center gap-3 shrink-0">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <div className={`w-7 h-7 rounded-full ${t.bgElevated} flex items-center justify-center text-xs font-semibold ${t.textSecondary}`}>
                  {(user?.name || user?.email || '?')[0].toUpperCase()}
                </div>
              )}
              <button
                onClick={onLogout}
                className={`text-xs ${t.textMuted} ${t.hoverText} transition hidden sm:block`}
              >
                Log out
              </button>
            </div>
          </div>
        </header>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col overflow-hidden" style={isMobile ? { paddingBottom: 64 } : undefined}>
        {children}
      </main>

      {/* MOBILE BOTTOM TAB BAR */}
      {isMobile && (
        <nav
          style={{
            position: 'fixed',
            left: 0, right: 0, bottom: 0,
            zIndex: 900,
            backgroundColor: theme.bg.surface,
            borderTop: `1px solid ${theme.bg.elevated || 'rgba(255,255,255,0.1)'}`,
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            height: 64,
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  padding: '6px 0',
                  border: 'none',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  minHeight: 44,
                  position: 'relative',
                }}
              >
                <span style={{ fontSize: 20, lineHeight: 1 }}>{tab.icon}</span>
                <span style={{
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? (theme.accent?.primary || '#818cf8') : (theme.text?.secondary || 'rgba(255,255,255,0.5)'),
                  transition: 'color 0.15s',
                }}>
                  {tab.label}
                </span>
                {isActive && (
                  <div style={{
                    position: 'absolute',
                    top: 0, left: '25%', right: '25%',
                    height: 2,
                    borderRadius: 1,
                    backgroundColor: theme.accent?.primary || '#818cf8',
                  }} />
                )}
              </button>
            );
          })}
        </nav>
      )}

      {/* THEME SWITCHER */}
      <ThemeSwitcher />
    </div>
  );
};

export default AppShell;
