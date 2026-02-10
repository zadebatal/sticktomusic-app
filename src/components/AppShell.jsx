import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ThemeSwitcher from './ThemeSwitcher';

/**
 * AppShell — Post-login wrapper with top navigation tabs.
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
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ],
  collaborator: [
    { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ],
};

const AppShell = ({ activeTab, setActiveTab, user, onLogout, children, userRole = 'operator' }) => {
  const { theme } = useTheme();
  const t = theme.tw;

  const tabs = TABS_BY_ROLE[userRole] || TABS_BY_ROLE.operator;

  return (
    <div className={`min-h-screen flex flex-col ${t.bgPage} ${t.textPrimary} font-sans`}>
      {/* TOP NAV */}
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

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>

      {/* THEME SWITCHER */}
      <ThemeSwitcher />
    </div>
  );
};

export default AppShell;
