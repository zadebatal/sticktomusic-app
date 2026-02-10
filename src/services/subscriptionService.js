/**
 * subscriptionService.js — Social Set counting, tier helpers, limit checks.
 *
 * Social Set = 1 bundle of 4 platform slots (Facebook, TikTok, Twitter, Instagram)
 * Pricing: $500/5 sets (Starter), $1,000/10 sets (Growth), $2,500/25 sets (Scale), $5,000/50 sets (Sensation)
 */

/**
 * Compute Social Sets used from connected Late pages.
 * Groups by unique handle — each unique handle = 1 Social Set.
 */
export function computeSocialSetsUsed(latePages) {
  if (!Array.isArray(latePages) || latePages.length === 0) return 0;
  const handles = new Set(latePages.map(p => p.handle).filter(Boolean));
  return handles.size;
}

/**
 * Check if user can connect more accounts.
 * Exempt users (conductor, paymentExempt) always return true.
 */
export function canAddSocialSet(user, socialSetsAllowed, socialSetsUsed) {
  if (!user) return false;
  if (user.role === 'conductor') return true;
  if (user.paymentExempt) return true;
  return socialSetsUsed < (socialSetsAllowed || 0);
}

/**
 * Check if user should see upgrade/payment CTAs.
 */
export function shouldShowPaymentUI(user) {
  if (!user) return false;
  if (user.role === 'conductor') return false;
  if (user.role === 'collaborator') return false;
  if (user.paymentExempt) return false;
  return true;
}

/**
 * Get tier info from sets count (for artists).
 */
export function getTierForSets(sets) {
  if (sets >= 50) return { name: 'Sensation', price: '$5,000/mo', sets: 50 };
  if (sets >= 25) return { name: 'Scale', price: '$2,500/mo', sets: 25 };
  if (sets >= 10) return { name: 'Growth', price: '$1,000/mo', sets: 10 };
  return { name: 'Starter', price: '$500/mo', sets: 5 };
}

/**
 * All available tiers for pricing display.
 */
export const TIERS = [
  { name: 'Starter', sets: 5, price: 500, priceLabel: '$500/mo' },
  { name: 'Growth', sets: 10, price: 1000, priceLabel: '$1,000/mo' },
  { name: 'Scale', sets: 25, price: 2500, priceLabel: '$2,500/mo' },
  { name: 'Sensation', sets: 50, price: 5000, priceLabel: '$5,000/mo' },
];

/**
 * Calculate operator pricing (per artist x sets).
 */
export function calculateOperatorPrice(numArtists, setsPerArtist) {
  const totalSets = numArtists * setsPerArtist;
  // Each set is $100/mo
  return totalSets * 100;
}
