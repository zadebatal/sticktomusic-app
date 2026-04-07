/**
 * Page Link Groups — localStorage-persisted groups of linked social handles.
 * When scheduling, selecting any handle in a group posts to all linked handles.
 */

const LINK_GROUPS_KEY = 'stm_page_link_groups';

export function getLinkGroups() {
  try {
    return JSON.parse(localStorage.getItem(LINK_GROUPS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveLinkGroups(groups) {
  try {
    localStorage.setItem(LINK_GROUPS_KEY, JSON.stringify(groups));
  } catch {}
}

/**
 * Get all handles linked to a given handle for a given artist.
 * Returns array of { artistId, handle } including the input handle.
 */
export function getLinkedHandles(artistId, normalizedHandle) {
  const groups = getLinkGroups();
  for (const members of Object.values(groups)) {
    if (members.some((m) => m.artistId === artistId && m.handle === normalizedHandle)) {
      return members;
    }
  }
  return [{ artistId, handle: normalizedHandle }];
}

/**
 * Expand a handle selection into all linked account IDs for scheduling.
 * @param {string} handle - The selected handle (without @)
 * @param {string} artistId - Current artist
 * @param {Object} lateAccountIds - Mapping of handle → { platform → accountId }
 * @returns {{ platforms: string[], accountIds: { platform, accountId }[] }}
 */
export function expandLinkedAccounts(handle, artistId, lateAccountIds) {
  const linked = getLinkedHandles(artistId, handle.replace(/^@/, '').toLowerCase());
  const allPlatforms = [];
  const allAccountIds = [];

  for (const member of linked) {
    const handleKey = member.handle.startsWith('@') ? member.handle : `@${member.handle}`;
    // Try both with and without @ prefix
    const mapping = lateAccountIds[handleKey] || lateAccountIds[member.handle] || {};
    for (const [platform, accountId] of Object.entries(mapping)) {
      if (accountId && !allAccountIds.some((a) => a.accountId === accountId)) {
        allPlatforms.push(platform);
        allAccountIds.push({ platform, accountId, handle: member.handle });
      }
    }
  }

  return { platforms: [...new Set(allPlatforms)], accountIds: allAccountIds };
}
