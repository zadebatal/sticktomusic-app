/**
 * firebaseStorage.js
 * Firebase Storage service for uploading rendered videos
 */

import { initializeApp, getApps } from 'firebase/app';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

// Firebase configuration - uses environment variables for security
// Create a .env.local file with these values for local development
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyDIw9xCnMVpDHW36vyxsNtwvmOfVlIHa0Y",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "sticktomusic-c8b23.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "sticktomusic-c8b23",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "sticktomusic-c8b23.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "621559911733",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:621559911733:web:4fe5066433967245ada87c"
};

// Initialize Firebase (reuse if already initialized)
const getFirebaseApp = () => {
  if (getApps().length > 0) {
    return getApps()[0];
  }
  return initializeApp(firebaseConfig);
};

const storage = getStorage(getFirebaseApp());

/**
 * Upload a video blob to Firebase Storage
 *
 * @param {Blob} videoBlob - The video file as a Blob
 * @param {string} fileName - Name for the file (without extension)
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<string>} - Public URL of the uploaded video
 */
export const uploadVideo = async (videoBlob, fileName, onProgress = () => {}) => {
  // Generate unique filename
  const timestamp = Date.now();
  const extension = videoBlob.type.includes('webm') ? 'webm' : 'mp4';
  const fullFileName = `videos/${fileName}_${timestamp}.${extension}`;

  const storageRef = ref(storage, fullFileName);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, videoBlob, {
      contentType: videoBlob.type
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = Math.round(
          (snapshot.bytesTransferred / snapshot.totalBytes) * 100
        );
        onProgress(progress);
      },
      (error) => {
        console.error('Upload error:', error);
        reject(error);
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadURL);
        } catch (error) {
          reject(error);
        }
      }
    );
  });
};

/**
 * Upload a thumbnail image to Firebase Storage
 *
 * @param {string} dataUrl - Base64 data URL of the image
 * @param {string} fileName - Name for the file (without extension)
 * @returns {Promise<string>} - Public URL of the uploaded thumbnail
 */
export const uploadThumbnail = async (dataUrl, fileName) => {
  // Convert data URL to Blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  const timestamp = Date.now();
  const fullFileName = `thumbnails/${fileName}_${timestamp}.jpg`;

  const storageRef = ref(storage, fullFileName);

  await uploadBytesResumable(storageRef, blob, {
    contentType: 'image/jpeg'
  });

  return getDownloadURL(storageRef);
};

/**
 * Upload multiple files to Firebase Storage
 *
 * @param {Array} files - Array of { blob, name, type } objects
 * @param {Function} onProgress - Progress callback (fileIndex, progress)
 * @returns {Promise<Array>} - Array of { name, url } objects
 */
export const uploadMultiple = async (files, onProgress = () => {}) => {
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const url = await uploadVideo(file.blob, file.name, (progress) => {
      onProgress(i, progress);
    });
    results.push({ name: file.name, url });
  }

  return results;
};

export default {
  uploadVideo,
  uploadThumbnail,
  uploadMultiple
};
