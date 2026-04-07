/**
 * ensurePublicUrl — Ensures a media URL is publicly accessible for external services (Late.co).
 * If the URL is local-only (localhost or file://), uploads to Firebase Storage first.
 *
 * @param {string} url - The media URL (may be local or remote)
 * @param {Object} db - Firestore instance
 * @param {string} artistId - Artist ID for storage quota
 * @param {string} [mediaType='video'] - 'video' | 'image' | 'audio'
 * @param {Function} [onProgress] - Optional progress callback ('Uploading...' etc.)
 * @param {Object} [user] - User object for quota enforcement (userData + email)
 * @returns {Promise<string>} - A publicly accessible URL
 */
import log from './logger';

export default async function ensurePublicUrl(
  url,
  db,
  artistId,
  mediaType = 'video',
  onProgress,
  user = null,
) {
  if (!url) throw new Error('No URL provided');

  // Already a public URL (Firebase Storage, CDN, etc.)
  if (
    url.startsWith('https://firebasestorage.googleapis.com') ||
    url.startsWith('https://storage.googleapis.com') ||
    (url.startsWith('https://') && !url.includes('localhost'))
  ) {
    return url;
  }

  // Local URL — needs upload
  log.info('[ensurePublicUrl] Local URL detected, uploading...', url.slice(0, 60));
  if (onProgress) onProgress('Uploading media...');

  // Fetch the local file as a blob
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch local file: ${response.status}`);
  const blob = await response.blob();

  // Determine filename from URL
  const urlPath = new URL(url).pathname;
  const filename = decodeURIComponent(urlPath.split('/').pop()) || `upload_${Date.now()}.mp4`;

  const file = new File([blob], filename, { type: blob.type || `${mediaType}/mp4` });

  // Map mediaType → storage folder name (uploadFileWithQuota expects folder, not type)
  const folder =
    mediaType === 'video'
      ? 'videos'
      : mediaType === 'audio'
        ? 'audio'
        : mediaType === 'image'
          ? 'images'
          : 'uploads';

  // Upload to Firebase Storage with quota enforcement
  const { uploadFileWithQuota } = await import('../services/firebaseStorage');
  const quotaCtx = { userData: user, userEmail: user?.email };
  const { url: publicUrl } = await uploadFileWithQuota(file, folder, null, {}, quotaCtx);

  log.info('[ensurePublicUrl] Uploaded successfully:', publicUrl.slice(0, 80));
  if (onProgress) onProgress('Upload complete');

  return publicUrl;
}
