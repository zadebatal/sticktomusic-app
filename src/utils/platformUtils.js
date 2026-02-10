/**
 * Platform metadata + URL generation — shared across PagesTab, ArtistDashboard, etc.
 */

export const PLATFORM_META = {
  tiktok: { label: 'TikTok', icon: '🎵', color: '#ff2d55' },
  instagram: { label: 'Instagram', icon: '📸', color: '#c13584' },
  youtube: { label: 'YouTube', icon: '▶️', color: '#ff0000' },
  facebook: { label: 'Facebook', icon: '📘', color: '#1877f2' },
};

export const ALL_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook'];

export const getProfileUrl = (platform, handle) => {
  const clean = handle.replace(/^@/, '');
  switch (platform) {
    case 'tiktok': return `https://www.tiktok.com/@${clean}`;
    case 'instagram': return `https://www.instagram.com/${clean}/`;
    case 'youtube': return `https://www.youtube.com/@${clean}`;
    case 'facebook': return `https://www.facebook.com/${clean}`;
    default: return null;
  }
};

export const formatFollowers = (count) => {
  if (count == null || count === 0) return '—';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toLocaleString();
};
