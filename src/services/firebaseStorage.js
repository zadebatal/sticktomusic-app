/**
 * Firebase Storage Service
 * Handles persistent file uploads to Firebase Storage
 */

import { initializeApp, getApps } from 'firebase/app';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDIw9xCnMVpDHW36vyxsNtwvmOfVlIHa0Y",
  authDomain: "sticktomusic-c8b23.firebaseapp.com",
  projectId: "sticktomusic-c8b23",
  storageBucket: "sticktomusic-c8b23.firebasestorage.app",
  messagingSenderId: "621559911733",
  appId: "1:621559911733:web:4fe5066433967245ada87c"
};

// Initialize Firebase only if not already initialized
let firebaseApp;
if (getApps().length === 0) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}

const storage = getStorage(firebaseApp);

/**
 * Upload a file to Firebase Storage
 * @param {File} file - The file to upload
 * @param {string} folder - The folder path (e.g., 'videos', 'audio')
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<{url: string, path: string}>}
 */
export async function uploadFile(file, folder = 'uploads', onProgress = null) {
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${folder}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, path);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file);

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

export default {
  uploadFile,
  deleteFile,
  getMediaDuration,
  generateThumbnail
};
