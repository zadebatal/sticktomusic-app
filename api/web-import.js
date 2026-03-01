/**
 * Vercel Serverless Function — Web Import Proxy
 *
 * Proxies requests to the Railway backend (stm-media-importer) so the
 * backend URL and API key never reach the browser.
 *
 * Query params:
 *   ?action=analyze  — forward to POST /api/analyze
 *   ?action=download — forward to POST /api/download
 *   ?action=status&jobId=xxx — forward to GET /api/status/<jobId>
 *
 * Environment: WEB_IMPORT_BACKEND_URL, WEB_IMPORT_API_KEY,
 *              FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Allowed origins (shared across API routes)
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

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin) || isLocalhostOrigin(origin) || isVercelPreview(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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

  const backendUrl = process.env.WEB_IMPORT_BACKEND_URL;
  const apiKey = process.env.WEB_IMPORT_API_KEY;

  if (!backendUrl) {
    return res.status(500).json({ error: 'Web import backend not configured' });
  }

  const { action, jobId } = req.query;

  try {
    if (action === 'analyze') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const resp = await fetch(`${backendUrl}/api/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      return res.status(resp.status).json(data);
    }

    if (action === 'download') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const resp = await fetch(`${backendUrl}/api/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      return res.status(resp.status).json(data);
    }

    if (action === 'status') {
      if (!jobId) return res.status(400).json({ error: 'jobId is required' });
      const resp = await fetch(`${backendUrl}/api/status/${jobId}`, {
        headers: apiKey ? { 'X-API-Key': apiKey } : {},
      });
      const data = await resp.json();
      return res.status(resp.status).json(data);
    }

    return res.status(400).json({ error: 'Invalid action. Use: analyze, download, status' });
  } catch (error) {
    console.error('Web import proxy error:', error.message);
    return res.status(500).json({ error: 'Web import proxy error: ' + error.message });
  }
}
