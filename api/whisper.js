/**
 * Vercel Serverless Function for OpenAI Whisper API Key
 * Provides the shared OpenAI API key to authenticated operators
 *
 * Environment variable required: OPENAI_API_KEY
 *
 * SECURITY:
 * - CORS restricted to allowed origins only
 * - Firebase Auth token verification required
 * - Only operators and conductors can access the key
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Allowed origins - restrict CORS to your domains only
const ALLOWED_ORIGINS = [
  'https://sticktomusic.com',
  'https://www.sticktomusic.com',
  'https://sticktomusic-app.vercel.app'
];

const isVercelPreview = (origin) => {
  if (!origin) return false;
  return /^https:\/\/[a-z0-9-]*sticktomusic[a-z0-9-]*\.vercel\.app$/i.test(origin);
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

async function isOperatorOrAbove(userEmail) {
  if (!db || !userEmail) return false;
  try {
    const userDoc = await db.collection('allowedUsers').doc(userEmail).get();
    if (!userDoc.exists) return false;
    const role = userDoc.data().role;
    return role === 'conductor' || role === 'operator';
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  // Verify authentication
  const authResult = await verifyAuth(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  const userEmail = authResult.user.email;

  // Check if user is operator or conductor
  const hasAccess = await isOperatorOrAbove(userEmail);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Operators and conductors only' });
  }

  const { action } = req.query;

  switch (action) {
    case 'getKey':
      // Return the shared OpenAI API key
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return res.status(200).json({ configured: false, key: null });
      }
      return res.status(200).json({ configured: true, key: openaiKey });

    case 'status':
      // Check if OpenAI key is configured (without exposing it)
      return res.status(200).json({
        configured: !!process.env.OPENAI_API_KEY
      });

    default:
      return res.status(400).json({ error: 'Invalid action. Use: getKey, status' });
  }
}
