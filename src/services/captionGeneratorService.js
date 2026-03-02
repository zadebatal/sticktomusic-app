/**
 * Caption Generator Service
 *
 * Calls /api/caption-generator which uses Claude Haiku to generate
 * social media captions and hashtags for music promotion.
 */

import { getAuth } from 'firebase/auth';

const API_URL = '/api/caption-generator';

/**
 * Generate captions and hashtags for a music project/niche.
 *
 * @param {Object} params
 * @param {string} params.projectName - Project/song name
 * @param {string} [params.nicheName] - Active niche name
 * @param {string} [params.context] - User-provided context (genre, mood, description)
 * @param {string[]} [params.platforms] - Target platforms
 * @param {string[]} [params.existingCaptions] - Already-saved captions to avoid duplicates
 * @param {string[]} [params.existingHashtags] - Already-saved hashtags
 * @param {number} [params.captionCount=5] - Number of captions to generate
 * @param {Function} [onProgress] - Optional progress callback
 * @returns {Promise<{ captions: string[], hashtags: string[], confidence: number }>}
 */
export async function generateCaptions(params, onProgress) {
  if (!params.projectName && !params.nicheName && !params.context) {
    throw new Error('Provide at least a project name, niche name, or context');
  }

  onProgress?.('Generating captions...');

  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not authenticated. Please sign in first.');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Caption generation failed: ${response.status}`);
  }

  const data = await response.json();
  onProgress?.(`Generated ${data.captions?.length || 0} captions, ${data.hashtags?.length || 0} hashtags`);
  return data;
}
