/**
 * MediaStatusBadge — Small icon badge showing local/cloud/both status.
 * Positioned absolutely in bottom-left of parent (parent must be relative).
 *
 * @param {string} syncStatus - 'cloud' | 'local' | 'synced' | 'offline'
 */
import React from 'react';

const CONFIGS = {
  cloud: { icon: '☁️', title: 'Uploaded only', bg: 'bg-blue-600/80' },
  local: { icon: '💾', title: 'Local only', bg: 'bg-green-600/80' },
  synced: { icon: '✓', title: 'Local + Uploaded', bg: 'bg-emerald-600/80' },
  offline: { icon: '⚠', title: 'Offline', bg: 'bg-amber-600/80' },
};

const MediaStatusBadge = ({ syncStatus }) => {
  const config = CONFIGS[syncStatus];
  if (!config) return null;

  return (
    <div
      className={`absolute bottom-0.5 left-0.5 z-[2] flex items-center justify-center h-3.5 w-3.5 rounded-sm ${config.bg} pointer-events-none`}
      title={config.title}
    >
      <span className="text-[7px] leading-none">{config.icon}</span>
    </div>
  );
};

export default MediaStatusBadge;
