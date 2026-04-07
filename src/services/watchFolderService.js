/**
 * watchFolderService.js — Auto-import from Google Drive/Dropbox
 *
 * Polls cloud folders for new files since last sync timestamp.
 * Downloads new files -> uploads to Firebase Storage -> adds to niche media banks.
 */

import {
  listFiles as driveListFiles,
  downloadFile as driveDownloadFile,
  isAuthenticated as isDriveAuth,
} from './googleDriveService';
import {
  listFiles as dbxListFiles,
  downloadFile as dbxDownloadFile,
  isAuthenticated as isDbxAuth,
  detectMediaType as dbxDetectMediaType,
} from './dropboxService';
import { uploadFile, uploadFileWithQuota } from './firebaseStorage';
import {
  createMediaItem,
  addToLibraryAsync,
  addToCollection,
  assignToMediaBank,
} from './libraryService';
import { isElectronApp, saveMediaLocally, getLocalMediaUrl } from './localMediaService';
import log from '../utils/logger';

// ── Constants ──

const SUPPORTED_MIME_PREFIXES = ['video/', 'image/', 'audio/'];

/**
 * Infer MIME type from a file name extension.
 * Used as a fallback when the cloud provider doesn't return a mimeType (e.g. Dropbox).
 * @param {string} name
 * @returns {string|null}
 */
function mimeFromName(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = {
    // Video
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    // Image
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    heic: 'image/heic',
  };
  return map[ext] || null;
}

/**
 * Determine the media type bucket (video | image | audio) from a MIME type string.
 * @param {string} mimeType
 * @returns {'video'|'image'|'audio'|null}
 */
function mediaTypeFromMime(mimeType) {
  if (!mimeType) return null;
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

/**
 * Check whether a MIME type is a supported media type.
 * @param {string} mimeType
 * @returns {boolean}
 */
function isSupportedMedia(mimeType) {
  return SUPPORTED_MIME_PREFIXES.some((prefix) => mimeType?.startsWith(prefix));
}

/**
 * Determine the Firebase Storage folder for a given media type.
 * @param {'video'|'image'|'audio'} type
 * @returns {string}
 */
function storageFolderForType(type) {
  if (type === 'video') return 'videos';
  if (type === 'audio') return 'audio';
  return 'images';
}

// ── Public API ──

/**
 * Get files from a cloud folder that are newer than lastSyncAt.
 *
 * Google Drive: uses `listFiles(folderId)` which returns
 *   `{ files: [{ id, name, mimeType, modifiedTime, ... }], nextPageToken }`
 *
 * Dropbox: uses `listFiles(path)` which returns
 *   `{ entries: [{ id, name, path, isFolder, modifiedAt, ... }], cursor, hasMore }`
 *
 * Both are normalized to a common shape.
 *
 * @param {'google_drive' | 'dropbox'} provider
 * @param {string} folderId — Drive folder ID or Dropbox path
 * @param {string|null} lastSyncAt — ISO8601 timestamp of last sync
 * @returns {Promise<Array<{ id: string, name: string, mimeType: string, modifiedTime: string, path?: string }>>}
 */
export async function getNewFiles(provider, folderId, lastSyncAt) {
  const cutoff = lastSyncAt ? new Date(lastSyncAt).getTime() : 0;
  let allFiles = [];

  if (provider === 'google_drive') {
    // Paginate through all results
    let pageToken = undefined;
    do {
      const result = await driveListFiles(folderId, { pageSize: 100, pageToken });
      const files = (result.files || [])
        .filter((f) => !f.mimeType?.startsWith('application/vnd.google-apps.')) // skip Google Docs/Sheets/etc.
        .map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
        }));
      allFiles.push(...files);
      pageToken = result.nextPageToken;
    } while (pageToken);
  } else if (provider === 'dropbox') {
    // Paginate through all results
    let cursor = undefined;
    let hasMore = true;
    while (hasMore) {
      const result = await dbxListFiles(folderId, { limit: 100, cursor });
      const entries = (result.entries || [])
        .filter((e) => !e.isFolder)
        .map((e) => ({
          id: e.id,
          name: e.name,
          path: e.path,
          mimeType: mimeFromName(e.name),
          modifiedTime: e.modifiedAt,
        }));
      allFiles.push(...entries);
      cursor = result.cursor;
      hasMore = result.hasMore && !!cursor;
    }
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  // Filter to only files newer than lastSyncAt
  if (cutoff > 0) {
    allFiles = allFiles.filter((f) => {
      const modTime = f.modifiedTime ? new Date(f.modifiedTime).getTime() : 0;
      return modTime > cutoff;
    });
  }

  // Filter to supported media types only
  allFiles = allFiles.filter((f) => isSupportedMedia(f.mimeType));

  log(
    `[WatchFolder] Found ${allFiles.length} new files from ${provider} (since ${lastSyncAt || 'beginning'})`,
  );
  return allFiles;
}

/**
 * Download a file from cloud provider and return as Blob.
 *
 * Google Drive: `downloadFile(fileId)` -> Blob
 * Dropbox: `downloadFile(path)` -> Blob  (uses file path, not ID)
 *
 * @param {'google_drive' | 'dropbox'} provider
 * @param {string} fileIdOrPath — Drive file ID or Dropbox file path
 * @returns {Promise<Blob>}
 */
export async function downloadCloudFile(provider, fileIdOrPath) {
  if (provider === 'google_drive') {
    return driveDownloadFile(fileIdOrPath);
  }
  if (provider === 'dropbox') {
    return dbxDownloadFile(fileIdOrPath);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Import new files from a watch folder config into a niche.
 *
 * Flow per file:
 *   1. Download blob from cloud provider
 *   2. Upload to Firebase Storage
 *   3. Create media item + add to library via addToLibraryAsync
 *   4. Add media to the niche collection (addToCollection)
 *   5. If targetBankId provided, assign to that media bank (assignToMediaBank)
 *
 * Errors on individual files are caught and collected — the sync continues.
 *
 * @param {Object} watchConfig — { provider, folderId, lastSyncAt }
 * @param {string} artistId
 * @param {string} nicheId — target niche collection ID
 * @param {string} [targetBankId] — specific media bank to add to (optional)
 * @param {Object} [db] — Firestore instance
 * @param {Function} [onProgress] — (completed, total, fileName) callback
 * @returns {Promise<{ imported: number, lastSyncAt: string, errors: string[] }>}
 */
export async function syncWatchFolder(
  watchConfig,
  artistId,
  nicheId,
  targetBankId,
  db,
  onProgress,
  artistName = '',
  user = null,
) {
  const { provider, folderId, lastSyncAt } = watchConfig;
  const errors = [];
  let imported = 0;

  // 1. Get new files since lastSyncAt
  let newFiles;
  try {
    newFiles = await getNewFiles(provider, folderId, lastSyncAt);
  } catch (err) {
    log.error('[WatchFolder] Failed to list files:', err);
    return { imported: 0, lastSyncAt: lastSyncAt || null, errors: [err.message] };
  }

  if (newFiles.length === 0) {
    log('[WatchFolder] No new files to import');
    return { imported: 0, lastSyncAt: new Date().toISOString(), errors: [] };
  }

  const total = newFiles.length;
  log(`[WatchFolder] Starting import of ${total} files into niche ${nicheId}`);

  // 2. Process each file
  for (let i = 0; i < newFiles.length; i++) {
    const file = newFiles[i];
    const fileLabel = `${file.name} (${i + 1}/${total})`;

    try {
      // a. Download blob from cloud
      const downloadId = provider === 'dropbox' ? file.path : file.id;
      const blob = await downloadCloudFile(provider, downloadId);

      // Create a File object from the blob (Firebase Storage expects File-like objects)
      const mimeType = file.mimeType || mimeFromName(file.name) || 'application/octet-stream';
      const fileObj = new File([blob], file.name, { type: mimeType });

      // b. Upload to Firebase Storage
      const mediaType = mediaTypeFromMime(mimeType);
      if (!mediaType) {
        errors.push(`${file.name}: unsupported media type (${mimeType})`);
        continue;
      }

      // c. Save the file: local-first if Electron + artistName, else cloud
      let url;
      let storagePath;
      let localPath = null;
      let localUrl = null;
      let syncStatus = 'cloud';
      if (isElectronApp() && artistName) {
        localPath = await saveMediaLocally(fileObj, artistName, mediaType, file.name);
        if (localPath) {
          localUrl = await getLocalMediaUrl(artistName, mediaType, file.name);
          syncStatus = 'local';
        }
      }
      if (!localPath) {
        const folder = storageFolderForType(mediaType);
        const quotaCtx = { userData: user, userEmail: user?.email };
        const uploadResult = await uploadFileWithQuota(fileObj, folder, null, {}, quotaCtx);
        url = uploadResult.url;
        storagePath = uploadResult.path;
      }

      // d. Create media item and add to library
      const mediaItem = createMediaItem({
        type: mediaType,
        name: file.name,
        ...(url ? { url } : {}),
        ...(storagePath ? { storagePath } : {}),
        ...(localPath ? { localPath } : {}),
        ...(localUrl ? { localUrl } : {}),
        syncStatus,
        metadata: {
          mimeType,
          fileSize: blob.size,
          importedFrom: provider,
          cloudFileId: file.id,
          importedAt: new Date().toISOString(),
        },
      });

      await addToLibraryAsync(db, artistId, mediaItem);

      // e. Add to niche collection
      addToCollection(artistId, nicheId, [mediaItem.id], db);

      // f. If targetBankId, assign to media bank
      if (targetBankId) {
        assignToMediaBank(artistId, nicheId, [mediaItem.id], targetBankId, db);
      }

      imported++;
      log(`[WatchFolder] Imported: ${fileLabel}`);
    } catch (err) {
      log.error(`[WatchFolder] Failed to import ${fileLabel}:`, err);
      errors.push(`${file.name}: ${err.message}`);
    }

    // Report progress
    if (onProgress) {
      try {
        onProgress(i + 1, total, file.name);
      } catch {
        // Don't let progress callback errors stop the sync
      }
    }
  }

  const newSyncAt = new Date().toISOString();
  log(`[WatchFolder] Sync complete: ${imported}/${total} imported, ${errors.length} errors`);

  return {
    imported,
    lastSyncAt: newSyncAt,
    errors,
  };
}

/**
 * Check if a provider is currently authenticated.
 * @param {'google_drive' | 'dropbox'} provider
 * @returns {boolean}
 */
export function isProviderAuthenticated(provider) {
  if (provider === 'google_drive') return isDriveAuth();
  if (provider === 'dropbox') return isDbxAuth();
  return false;
}

export default {
  getNewFiles,
  downloadCloudFile,
  syncWatchFolder,
  isProviderAuthenticated,
};
