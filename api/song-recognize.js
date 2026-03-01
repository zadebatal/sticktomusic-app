/**
 * Vercel Serverless Function - Song Recognition Proxy
 *
 * Proxies audio to AudD API for song recognition so the API key
 * never reaches the browser. Same auth pattern as api/transcribe.js.
 *
 * Environment: AUDD_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const ALLOWED_ORIGINS = [
  'https://sticktomusic.com',
  'https://www.sticktomusic.com',
  'https://sticktomusic-app.vercel.app'
];

const isVercelPreview = (origin) => {
  if (!origin) return false;
  return /^https:\/\/sticktomusic-app(-[a-z0-9]+)*\.vercel\.app$/i.test(origin);
};

const isLocalhostOrigin = (origin) => {
  if (!origin) return false;
  return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
};

// Initialize Firebase Admin (only once)
let db = null;
if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    db = getFirestore();
  } catch (error) {
    console.error('Firebase Admin init error:', error.message);
  }
} else {
  db = getFirestore();
}

async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header', status: 401 };
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    return { user: decodedToken };
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return { error: 'Invalid or expired token', status: 401 };
  }
}

async function isAllowedUser(userEmail) {
  if (!db || !userEmail) return false;
  try {
    const userDoc = await db.collection('allowedUsers').doc(userEmail).get();
    return userDoc.exists;
  } catch (error) {
    console.error('Error checking user role:', error.message);
    return false;
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin) || isLocalhostOrigin(origin) || isVercelPreview(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // Verify authentication
  const authResult = await verifyAuth(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  const hasAccess = await isAllowedUser(authResult.user.email);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Not an authorized user' });
  }

  const auddKey = process.env.AUDD_API_KEY;
  if (!auddKey) {
    return res.status(500).json({ error: 'AudD API key not configured on server' });
  }

  try {
    // Collect the raw body (audio file from client)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB — only need ~15s snippet
    const chunks = [];
    let totalSize = 0;
    for await (const chunk of req) {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE) {
        return res.status(413).json({ error: 'File too large. Send a short audio snippet (max 5 MB).' });
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Build multipart form for AudD
    const boundary = '----AudDBoundary' + Date.now();
    const parts = [];

    // api_token field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="api_token"\r\n\r\n` +
      `${auddKey}\r\n`
    );

    // return field (get Spotify metadata)
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="return"\r\n\r\n` +
      `spotify\r\n`
    );

    // file field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="snippet.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n`
    );

    const header = Buffer.from(parts.join(''));
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const multipartBody = Buffer.concat([header, body, footer]);

    const auddResponse = await fetch('https://api.audd.io/', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!auddResponse.ok) {
      return res.status(auddResponse.status).json({
        error: `AudD API error: ${auddResponse.status}`
      });
    }

    const data = await auddResponse.json();

    if (data.status === 'error') {
      return res.status(400).json({
        error: data.error?.error_message || 'AudD recognition failed'
      });
    }

    // Return normalized result
    if (data.result) {
      return res.status(200).json({
        found: true,
        artist: data.result.artist || '',
        title: data.result.title || '',
        album: data.result.album || '',
        releaseDate: data.result.release_date || '',
      });
    }

    return res.status(200).json({ found: false });
  } catch (error) {
    console.error('Song recognition proxy error:', error.message);
    return res.status(500).json({ error: 'Song recognition failed: ' + error.message });
  }
}
