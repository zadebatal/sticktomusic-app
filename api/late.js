/**
 * Vercel Serverless Function for Late API
 * This keeps the Late API key secure on the server side
 *
 * Environment variable required: LATE_API_KEY
 *
 * SECURITY:
 * - CORS restricted to allowed origins only
 * - Firebase Auth token verification required
 * - Rate limiting recommended (add via Vercel Edge Config)
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const LATE_API_BASE = 'https://getlate.dev/api/v1';

// Allowed origins - restrict CORS to your domains only
const ALLOWED_ORIGINS = [
  'https://sticktomusic.com',
  'https://www.sticktomusic.com',
  'https://sticktomusic-app.vercel.app',
  // Add localhost for development
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
].filter(Boolean);

// Initialize Firebase Admin (only once)
if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  } catch (error) {
    console.error('Firebase Admin init error:', error.message);
  }
}

/**
 * Verify Firebase ID token from Authorization header
 */
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

export default async function handler(req, res) {
  // CORS - restrict to allowed origins
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify authentication
  const authResult = await verifyAuth(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  // Log authenticated user (for audit trail)
  console.log(`Late API request from: ${authResult.user.email}`);

  const LATE_API_KEY = process.env.LATE_API_KEY;

  if (!LATE_API_KEY) {
    return res.status(500).json({ error: 'Late API key not configured' });
  }

  const { action, postId, page = 1, ...body } = req.method === 'GET'
    ? req.query
    : { ...req.query, ...req.body };

  try {
    let response;

    switch (action) {
      case 'accounts':
        // GET /accounts - Fetch all connected accounts
        response = await fetch(`${LATE_API_BASE}/accounts`, {
          headers: { 'Authorization': `Bearer ${LATE_API_KEY}` }
        });
        break;

      case 'posts':
        if (req.method === 'GET') {
          // GET /posts - Fetch scheduled posts
          response = await fetch(`${LATE_API_BASE}/posts?page=${page}&limit=50`, {
            headers: { 'Authorization': `Bearer ${LATE_API_KEY}` }
          });
        } else if (req.method === 'POST') {
          // POST /posts - Create new scheduled post
          response = await fetch(`${LATE_API_BASE}/posts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LATE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          });
        }
        break;

      case 'delete':
        if (!postId) {
          return res.status(400).json({ error: 'postId required for delete' });
        }
        // DELETE /posts/:id - Delete a scheduled post
        response = await fetch(`${LATE_API_BASE}/posts/${postId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${LATE_API_KEY}` }
        });
        break;

      default:
        return res.status(400).json({ error: 'Invalid action. Use: accounts, posts, or delete' });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: errorData.error || errorData.message || `Late API error: ${response.status}`
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('Late API proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}
