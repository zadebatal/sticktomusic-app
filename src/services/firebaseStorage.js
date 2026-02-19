/**
 * Firebase Storage Service
 * Handles persistent file uploads to Firebase Storage
 */

import { initializeApp, getApps } from 'firebase/app';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFirestore } from 'firebase/firestore';
import log from '../utils/logger';

// Firebase configuration - loaded from environment variables
// IMPORTANT: Never hardcode credentials. Set these in Vercel environment variables.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// Validate required config in development
if (process.env.NODE_ENV === 'development') {
  const required = ['apiKey', 'authDomain', 'projectId'];
  const missing = required.filter(key => !firebaseConfig[key]);
  if (missing.length > 0) {
    console.error('❌ Missing Firebase config:', missing.join(', '));
    console.error('Set REACT_APP_FIREBASE_* environment variables in .env.local');
  }
}

// File upload constraints
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aiff', 'audio/x-aiff', 'audio/x-m4a', 'audio/aac', 'audio/flac'];
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB max

// Initialize Firebase only if not already initialized
let firebaseApp;
if (getApps().length === 0) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}

const storage = getStorage(firebaseApp);
const db = getFirestore(firebaseApp);

// Export for use in other services
export { firebaseApp, db };

/**
 * Upload a file to Firebase Storage
 * @param {File} file - The file to upload
 * @param {string} folder - The folder path (e.g., 'videos', 'audio')
 * @param {function} onProgress - Progress callback (0-100)
 * @param {object} options - Additional options (e.g., { onCancel: callback })
 * @returns {Promise<{url: string, path: string}>}
 */
export async function uploadFile(file, folder = 'uploads', onProgress = null, options = {}) {
  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  // Validate file type based on folder
  const allowedTypes = {
    videos: ALLOWED_VIDEO_TYPES,
    thumbnails: ALLOWED_IMAGE_TYPES,
    images: ALLOWED_IMAGE_TYPES,
    audio: ALLOWED_AUDIO_TYPES,
    uploads: [...ALLOWED_VIDEO_TYPES, ...ALLOWED_IMAGE_TYPES, ...ALLOWED_AUDIO_TYPES]
  };

  const allowed = allowedTypes[folder] || allowedTypes.uploads;
  // Strip codec suffix (e.g. "video/mp4;codecs=avc1" → "video/mp4") for validation
  const baseType = file.type.split(';')[0].trim();
  if (!allowed.includes(baseType)) {
    throw new Error(`Invalid file type: ${file.type}. Allowed: ${allowed.join(', ')}`);
  }

  // Validate file content (magic numbers) for images
  if (file.type.startsWith('image/')) {
    const header = await file.slice(0, 4).arrayBuffer();
    const bytes = new Uint8Array(header);
    const isValidImage =
      (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) || // JPEG
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) || // PNG
      (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) || // GIF
      (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46); // WEBP (RIFF)
    if (!isValidImage) {
      throw new Error('Invalid image file - file content does not match declared type');
    }
  }

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${folder}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, path);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file);

    // Expose cancel capability to caller
    if (options.onCancel) {
      options.onCancel(() => {
        log('Cancelling upload for:', file.name);
        uploadTask.cancel();
      });
    }

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        if (onProgress) onProgress(progress);
      },
      (error) => {
        console.error('Upload error:', error);
        reject(error);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({ url, path });
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

/**
 * Delete a file from Firebase Storage
 * @param {string} path - The storage path of the file
 */
export async function deleteFile(path) {
  try {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
    return { success: true };
  } catch (error) {
    console.error('Delete error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get file duration for video/audio
 * @param {string} url - The file URL
 * @param {string} type - 'video' or 'audio'
 * @returns {Promise<number>} Duration in seconds
 */
export function getMediaDuration(url, type = 'video') {
  return new Promise((resolve) => {
    const element = document.createElement(type);
    element.preload = 'metadata';

    element.onloadedmetadata = () => {
      resolve(element.duration || 0);
      element.remove();
    };

    element.onerror = () => {
      console.warn('Could not load media metadata:', url);
      resolve(0);
      element.remove();
    };

    // Timeout fallback
    setTimeout(() => {
      if (!element.duration) {
        resolve(0);
        element.remove();
      }
    }, 5000);

    element.src = url;
  });
}

/**
 * Generate video thumbnail
 * @param {string} videoUrl - The video URL
 * @param {number} time - Time in seconds to capture
 * @returns {Promise<string>} Data URL of thumbnail
 */
export function generateThumbnail(videoUrl, time = 1) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(time, video.duration || 1);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        resolve(thumbnail);
      } catch (error) {
        console.warn('Thumbnail generation failed:', error);
        resolve(null);
      }
      video.remove();
    };

    video.onerror = () => {
      console.warn('Could not load video for thumbnail');
      resolve(null);
      video.remove();
    };

    // Timeout fallback
    setTimeout(() => {
      resolve(null);
      video.remove();
    }, 10000);

    video.src = videoUrl;
  });
}

/**
 * Upload a video blob to Firebase Storage (legacy API for compatibility)
 * @param {Blob} videoBlob - The video blob to upload
 * @param {string} fileName - The file name
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<string>} - Download URL
 */
export async function uploadVideo(videoBlob, fileName, onProgress = () => {}) {
  // Convert blob to file-like object for uploadFile
  const file = new File([videoBlob], fileName, { type: videoBlob.type || 'video/webm' });
  const result = await uploadFile(file, 'videos', onProgress);
  return result.url;
}

/**
 * Upload a thumbnail image to Firebase Storage (legacy API for compatibility)
 * @param {string} dataUrl - Base64 data URL of the thumbnail
 * @param {string} fileName - File name
 * @returns {Promise<string>} - Download URL
 */
export async function uploadThumbnail(dataUrl, fileName) {
  // Convert data URL to blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const file = new File([blob], fileName, { type: 'image/jpeg' });
  const result = await uploadFile(file, 'thumbnails', null);
  return result.url;
}

export default {
  uploadFile,
  uploadVideo,
  uploadThumbnail,
  deleteFile,
  getMediaDuration,
  generateThumbnail
};
