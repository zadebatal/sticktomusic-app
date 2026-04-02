import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import UpdateBanner from './UpdateBanner';

import useIsMobile from '../hooks/useIsMobile';
import { Avatar } from '../ui/components/Avatar';
import { Badge } from '../ui/components/Badge';
import { DropdownMenu } from '../ui/components/DropdownMenu';
import {
  FeatherLayout,
  FeatherVideo,
  FeatherCalendar,
  FeatherBarChart,
  FeatherUsers,
  FeatherSettings,
  FeatherHome,
  FeatherChevronDown,
  FeatherMoreVertical,
  FeatherUser,
  FeatherLogOut,
  FeatherPlus,
} from '@subframe/core';
import * as SubframeCore from '@subframe/core';

/**
 * AppShell — Post-login wrapper with left sidebar (desktop)
 * and bottom tab bar (mobile).
 * Tabs vary by userRole: conductor, operator, artist, collaborator.
 */

const TABS_BY_ROLE = {
  conductor: [
    { id: 'pages', label: 'Pages', Icon: FeatherLayout },
    { id: 'studio', label: 'Studio', Icon: FeatherVideo },
    { id: 'schedule', label: 'Schedule', Icon: FeatherCalendar },
    { id: 'analytics', label: 'Analytics', Icon: FeatherBarChart },
    { id: 'artists', label: 'Artists', Icon: FeatherUsers },
    { id: 'settings', label: 'Settings', Icon: FeatherSettings },
  ],
  operator: [
    { id: 'pages', label: 'Pages', Icon: FeatherLayout },
    { id: 'studio', label: 'Studio', Icon: FeatherVideo },
    { id: 'schedule', label: 'Schedule', Icon: FeatherCalendar },
    { id: 'analytics', label: 'Analytics', Icon: FeatherBarChart },
    { id: 'artists', label: 'Artists', Icon: FeatherUsers },
    { id: 'settings', label: 'Settings', Icon: FeatherSettings },
  ],
  artist: [
    { id: 'dashboard', label: 'Dashboard', Icon: FeatherHome },
    { id: 'studio', label: 'Studio', Icon: FeatherVideo },
    { id: 'schedule', label: 'Schedule', Icon: FeatherCalendar },
    { id: 'analytics', label: 'Analytics', Icon: FeatherBarChart },
    { id: 'settings', label: 'Settings', Icon: FeatherSettings },
  ],
  collaborator: [
    { id: 'dashboard', label: 'Dashboard', Icon: FeatherHome },
    { id: 'studio', label: 'Studio', Icon: FeatherVideo },
    { id: 'schedule', label: 'Schedule', Icon: FeatherCalendar },
    { id: 'analytics', label: 'Analytics', Icon: FeatherBarChart },
    { id: 'settings', label: 'Settings', Icon: FeatherSettings },
  ],
};

const AppShell = ({
  activeTab,
  setActiveTab,
  user,
  onLogout,
  children,
  userRole = 'operator',
  visibleArtists = [],
  currentArtistId,
  onArtistChange,
  isLoading = false,
}) => {
  const { theme } = useTheme();
  const { isMobile } = useIsMobile();

  const tabs = TABS_BY_ROLE[userRole] || TABS_BY_ROLE.operator;
  const currentArtist = visibleArtists.find((a) => a.id === currentArtistId);

  // Role display name
  const getRoleBadge = () => {
    if (userRole === 'conductor') return 'Conductor';
    if (userRole === 'operator') return 'Operator';
    if (userRole === 'artist') return 'Artist';
    return 'Collaborator';
  };

  return (
    <div className="flex h-screen w-full items-start bg-black">
      {/* LEFT SIDEBAR — desktop only */}
      {!isMobile && (
        <div className="flex w-64 flex-none flex-col items-start self-stretch border-r border-solid border-neutral-200 bg-black">
          {/* Logo + Artist Selector */}
          <div className="flex w-full flex-col items-start gap-6 px-6 py-6">
            <span className="text-heading-2 font-heading-2 text-white">StickToMusic</span>

            {/* Artist selector — dropdown for multiple, static for single */}
            {visibleArtists.length > 1 ? (
              <div className="flex w-full flex-col items-start gap-2">
                <span className="text-caption font-caption text-neutral-500 uppercase tracking-wider">
                  Artist
                </span>
                <SubframeCore.DropdownMenu.Root>
                  <SubframeCore.DropdownMenu.Trigger asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Switch artist, current: ${currentArtist?.name || 'none'}`}
                      className="flex w-full items-center gap-3 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-3 py-2.5 cursor-pointer hover:bg-neutral-100"
                    >
                      <Avatar
                        size="small"
                        image={currentArtist?.photoURL || undefined}
                        className="bg-brand-600 flex-none"
                      >
                        {(currentArtist?.name || '?')[0].toUpperCase()}
                      </Avatar>
                      <span className="text-body-bold font-body-bold text-white truncate grow">
                        {currentArtist?.name || 'Select Artist'}
                      </span>
                      <FeatherChevronDown
                        className="text-neutral-400 flex-none"
                        style={{ width: 16, height: 16 }}
                      />
                    </div>
                  </SubframeCore.DropdownMenu.Trigger>
                  <SubframeCore.DropdownMenu.Portal>
                    <SubframeCore.DropdownMenu.Content
                      side="bottom"
                      align="start"
                      sideOffset={4}
                      asChild
                    >
                      <DropdownMenu>
                        {visibleArtists.map((artist) => (
                          <DropdownMenu.DropdownItem
                            key={artist.id}
                            icon={
                              artist.photoURL ? (
                                <img
                                  src={artist.photoURL}
                                  alt=""
                                  className="w-5 h-5 rounded-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <span className="flex w-5 h-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                                  {(artist.name || '?')[0].toUpperCase()}
                                </span>
                              )
                            }
                            onClick={() => onArtistChange && onArtistChange(artist.id)}
                          >
                            {artist.name}
                          </DropdownMenu.DropdownItem>
                        ))}
                      </DropdownMenu>
                    </SubframeCore.DropdownMenu.Content>
                  </SubframeCore.DropdownMenu.Portal>
                </SubframeCore.DropdownMenu.Root>
              </div>
            ) : visibleArtists.length === 1 ? (
              <div className="flex w-full flex-col items-start gap-2">
                <span className="text-caption font-caption text-neutral-500 uppercase tracking-wider">
                  Artist
                </span>
                <div className="flex w-full items-center gap-3 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-3 py-2.5">
                  <Avatar
                    size="small"
                    image={currentArtist?.photoURL || undefined}
                    className="bg-brand-600 flex-none"
                  >
                    {(currentArtist?.name || '?')[0].toUpperCase()}
                  </Avatar>
                  <span className="text-body-bold font-body-bold text-white truncate grow">
                    {currentArtist?.name || 'Artist'}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Nav Items */}
          <div className="flex w-full grow shrink-0 basis-0 flex-col items-start gap-1 px-3">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.Icon;
              return (
                <button
                  type="button"
                  key={tab.id}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none border-none bg-transparent ${
                    isActive ? 'bg-neutral-100' : 'hover:bg-neutral-100'
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon
                    className={`text-body font-body ${isActive ? 'text-white' : 'text-neutral-400'}`}
                  />
                  <span
                    className={`${isActive ? 'text-body-bold font-body-bold text-white' : 'text-body font-body text-neutral-400'}`}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* User Footer */}
          <div className="flex w-full flex-col items-start border-t border-solid border-neutral-200 px-6 py-4">
            <SubframeCore.DropdownMenu.Root>
              <SubframeCore.DropdownMenu.Trigger asChild>
                <div className="flex w-full items-center gap-3 cursor-pointer">
                  <Avatar size="small" image={user?.photoURL || undefined} className="flex-none">
                    {(user?.name || user?.email || '?')[0].toUpperCase()}
                  </Avatar>
                  <div className="flex grow shrink-0 basis-0 flex-col items-start overflow-hidden">
                    <span className="text-body-bold font-body-bold text-white truncate w-full">
                      {user?.name || user?.email || 'User'}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="neutral">{getRoleBadge()}</Badge>
                    </div>
                  </div>
                  <FeatherMoreVertical
                    className="text-neutral-400 flex-none"
                    style={{ width: 16, height: 16 }}
                  />
                </div>
              </SubframeCore.DropdownMenu.Trigger>
              <SubframeCore.DropdownMenu.Portal>
                <SubframeCore.DropdownMenu.Content side="top" align="end" sideOffset={4} asChild>
                  <DropdownMenu>
                    <DropdownMenu.DropdownItem
                      icon={<FeatherSettings />}
                      onClick={() => setActiveTab('settings')}
                    >
                      Settings
                    </DropdownMenu.DropdownItem>
                    <DropdownMenu.DropdownDivider />
                    <DropdownMenu.DropdownItem
                      icon={<FeatherLogOut />}
                      onClick={() => {
                        if (window.confirm('Log out of your account?')) onLogout();
                      }}
                    >
                      Log out
                    </DropdownMenu.DropdownItem>
                  </DropdownMenu>
                </SubframeCore.DropdownMenu.Content>
              </SubframeCore.DropdownMenu.Portal>
            </SubframeCore.DropdownMenu.Root>
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div
        className="flex grow shrink-0 basis-0 flex-col items-start self-stretch bg-black overflow-auto"
        style={
          isMobile ? { paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' } : undefined
        }
      >
        {isLoading && <div className="h-0.5 w-full flex-none bg-indigo-500 animate-pulse" />}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="flex grow flex-col w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* MOBILE BOTTOM TAB BAR */}
      {isMobile && (
        <nav
          className="fixed inset-x-0 bottom-0 z-[900] bg-black border-t border-neutral-200 flex justify-around items-center h-16"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.Icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 border-none bg-transparent cursor-pointer min-h-11 relative"
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-400' : 'text-neutral-500'}`} />
                <span
                  className={`text-[10px] ${isActive ? 'font-semibold text-indigo-400' : 'font-normal text-neutral-500'} transition-colors`}
                >
                  {tab.label}
                </span>
                {isActive && (
                  <div className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-full bg-indigo-400" />
                )}
              </button>
            );
          })}
        </nav>
      )}
      <UpdateBanner />
    </div>
  );
};

export default AppShell;
