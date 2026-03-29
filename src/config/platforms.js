/**
 * Centralized Platform Configuration
 *
 * Single source of truth for all platform metadata, styling, and URL generation.
 * Used across App.jsx, PagesTab, ArtistDashboard, SchedulingPage, scheduledPostsService, etc.
 */

export const PLATFORMS = {
  tiktok: {
    key: 'tiktok',
    label: 'TT',
    fullName: 'TikTok',
    bgColor: 'bg-pink-500/20',
    textColor: 'text-pink-400',
    hoverBg: 'hover:bg-pink-500/30',
    icon: '♪',
    emoji: '🎵',
    hexColor: '#00f2ea',
    urlPattern: (username) => `https://www.tiktok.com/@${username}`,
    weight: 1.0,
  },
  instagram: {
    key: 'instagram',
    label: 'IG',
    fullName: 'Instagram',
    bgColor: 'bg-purple-500/20',
    textColor: 'text-purple-400',
    hoverBg: 'hover:bg-purple-500/30',
    icon: '◐',
    emoji: '📸',
    hexColor: '#c13584',
    urlPattern: (username) => `https://www.instagram.com/${username}`,
    weight: 0.85,
  },
  facebook: {
    key: 'facebook',
    label: 'FB',
    fullName: 'Facebook',
    bgColor: 'bg-blue-500/20',
    textColor: 'text-blue-400',
    hoverBg: 'hover:bg-blue-500/30',
    icon: 'f',
    emoji: '📘',
    hexColor: '#1877f2',
    urlPattern: (username) => `https://www.facebook.com/${username}`,
    weight: 0.7,
  },
  youtube: {
    key: 'youtube',
    label: 'YT',
    fullName: 'YouTube',
    bgColor: 'bg-red-500/20',
    textColor: 'text-red-400',
    hoverBg: 'hover:bg-red-500/30',
    icon: '▶',
    emoji: '▶️',
    hexColor: '#ff0000',
    urlPattern: (username) => `https://www.youtube.com/@${username}`,
    weight: 0.9,
  },
};

export const ALL_PLATFORMS = Object.keys(PLATFORMS);

// Frozen enum for scheduledPostsService compatibility
export const PLATFORM_KEYS = Object.freeze({
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  FACEBOOK: 'facebook',
});

export const PLATFORM_LABELS = Object.freeze(
  Object.fromEntries(ALL_PLATFORMS.map((k) => [k, PLATFORMS[k].fullName])),
);

export const PLATFORM_COLORS = Object.freeze(
  Object.fromEntries(ALL_PLATFORMS.map((k) => [k, PLATFORMS[k].hexColor])),
);

// Legacy compat: PLATFORM_META shape used by PagesTab/ArtistDashboard
export const PLATFORM_META = Object.freeze(
  Object.fromEntries(
    ALL_PLATFORMS.map((k) => [
      k,
      {
        label: PLATFORMS[k].fullName,
        icon: PLATFORMS[k].emoji,
        color: PLATFORMS[k].hexColor,
      },
    ]),
  ),
);

/**
 * Get platform config with normalization (handles 'tik_tok', 'TikTok', etc.)
 */
export const getPlatformConfig = (platform) => {
  const normalized = (platform || '').toLowerCase().replace('_', '').replace(' ', '');
  const key =
    normalized === 'tiktok'
      ? 'tiktok'
      : normalized === 'instagram'
        ? 'instagram'
        : normalized === 'facebook'
          ? 'facebook'
          : normalized === 'youtube'
            ? 'youtube'
            : null;
  return PLATFORMS[key] || PLATFORMS.tiktok;
};

/**
 * Get profile URL for a platform + username
 */
export const getProfileUrl = (platform, username) => {
  const config = getPlatformConfig(platform);
  const cleanUsername = (username || '').replace('@', '');
  return config.urlPattern(cleanUsername);
};

// Alias for backward compat
export const getPlatformUrl = getProfileUrl;

export const getPlatformKeys = () => ALL_PLATFORMS;

/**
 * Format follower count (1500 → "1.5K", 2000000 → "2.0M")
 */
export const formatFollowers = (count) => {
  if (count == null || count === 0) return '—';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toLocaleString();
};
