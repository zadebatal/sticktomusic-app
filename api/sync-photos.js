/**
 * Sync Firebase Auth photoURLs to allowedUsers Firestore docs.
 * Called once by conductor to backfill profile pictures.
 *
 * GET /api/sync-photos
 * Requires: Firebase Auth token (conductor only)
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (shared with other API routes)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const CONDUCTOR_EMAILS = (process.env.REACT_APP_CONDUCTOR_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

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

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin) || isLocalhostOrigin(origin) || isVercelPreview(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Firebase Auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token);
    const email = decoded.email?.toLowerCase();

    // Conductor-only
    if (!CONDUCTOR_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Conductor access required' });
    }

    const db = getFirestore();
    const auth = getAuth();

    // List all Firebase Auth users (up to 1000)
    const listResult = await auth.listUsers(1000);
    let synced = 0;
    const results = [];

    for (const authUser of listResult.users) {
      if (!authUser.photoURL || !authUser.email) continue;

      const userEmail = authUser.email.toLowerCase();
      const docRef = db.collection('allowedUsers').doc(userEmail);
      const docSnap = await docRef.get();

      if (docSnap.exists) {
        const data = docSnap.data();
        if (data.photoURL !== authUser.photoURL) {
          await docRef.update({ photoURL: authUser.photoURL });
          synced++;
          results.push({ email: userEmail, action: 'synced' });
        } else {
          results.push({ email: userEmail, action: 'already_current' });
        }
      }
    }

    return res.status(200).json({
      success: true,
      synced,
      total: listResult.users.length,
      results,
    });
  } catch (error) {
    console.error('[sync-photos] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
