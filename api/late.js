/**
 * Vercel Serverless Function for Late API
 * This keeps the Late API key secure on the server side
 *
 * Environment variable required: LATE_API_KEY (fallback/default key)
 *
 * SECURITY:
 * - CORS restricted to allowed origins only
 * - Firebase Auth token verification required
 * - Per-artist Late API keys stored securely in Firestore (artistSecrets collection)
 * - Keys are NEVER sent to the client
 * - Rate limiting recommended (add via Vercel Edge Config)
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const LATE_API_BASE = 'https://getlate.dev/api/v1';

/**
 * Fetch with timeout and retry logic for resilient network calls
 */
const fetchWithRetry = async (url, options, maxRetries = 2) => {
  for (let i = 0; i <= maxRetries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      // Retry on 5xx errors (unless it's the last attempt)
      if (res.status >= 500 && i < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); // exponential backoff
        continue;
      }

      return res;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        if (i === maxRetries) {
          throw new Error('Request timeout');
        }
        continue;
      }
      if (i === maxRetries) throw error;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
};

/**
 * Sanitize user input text (remove HTML tags, limit length)
 */
const sanitizeText = (str) => {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').slice(0, 2200);
};

// Allowed origins - restrict CORS to your domains only
const ALLOWED_ORIGINS = [
  'https://sticktomusic.com',
  'https://www.sticktomusic.com',
  'https://sticktomusic-app.vercel.app'
];

// Also allow Vercel preview deployments
const isVercelPreview = (origin) => {
  if (!origin) return false;
  // Strict match: only allow <hash>-sticktomusic-<hash>.vercel.app or sticktomusic-app*.vercel.app
  return /^https:\/\/[a-z0-9-]*sticktomusic[a-z0-9-]*\.vercel\.app$/i.test(origin);
};

// Check if origin is localhost (any port) for development
const isLocalhostOrigin = (origin) => {
  if (!origin) return false;
  return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
};

// Initialize Firebase Admin lazily (env vars may not be available at module load in vercel dev)
let db = null;
function ensureFirebaseAdmin() {
  if (db) return db;
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  db = getFirestore();
  return db;
}

/**
 * Get Late API key for a specific artist
 * Global LATE_API_KEY only used for the artist specified in LATE_API_KEY_ARTIST_ID
 */
async function getArtistLateKey(artistId) {
  console.log('getArtistLateKey called with artistId:', artistId);
  console.log('db initialized:', !!db);
  console.log('Global LATE_API_KEY exists:', !!process.env.LATE_API_KEY);
  console.log('LATE_API_KEY_ARTIST_ID:', process.env.LATE_API_KEY_ARTIST_ID);

  // Check artist-specific key in Firestore first
  if (artistId && db) {
    try {
      const secretDoc = await db.collection('artistSecrets').doc(artistId).get();
      console.log('artistSecrets doc exists:', secretDoc.exists);
      if (secretDoc.exists && secretDoc.data().lateApiKey) {
        console.log('Using artist-specific key from Firestore');
        return secretDoc.data().lateApiKey;
      }
    } catch (error) {
      console.error('Error fetching artist Late key:', error.message);
    }
  }

  // Only use global key if this artist is the designated global key artist
  const globalKeyArtistId = process.env.LATE_API_KEY_ARTIST_ID;
  if (process.env.LATE_API_KEY && globalKeyArtistId && artistId === globalKeyArtistId) {
    console.log('Using global key for designated artist:', globalKeyArtistId);
    return process.env.LATE_API_KEY;
  }

  // No key found for this artist
  console.log('No Late key found for artist:', artistId);
  return null;
}

/**
 * Check if an artist has Late configured (either specific key or is the global key artist)
 */
function isArtistLateConfigured(artistId, hasArtistKey) {
  if (hasArtistKey) return true;
  const globalKeyArtistId = process.env.LATE_API_KEY_ARTIST_ID;
  return process.env.LATE_API_KEY && globalKeyArtistId && artistId === globalKeyArtistId;
}

/**
 * Check if user has access to an artist (operator assigned or conductor)
 */
async function canUserAccessArtist(userEmail, artistId) {
  if (!db || !artistId) return false; // Deny access when artistId or db is missing

  try {
    const userDoc = await db.collection('allowedUsers').doc(userEmail).get();
    if (!userDoc.exists) return false;

    const userData = userDoc.data();
    // Conductors can access all artists
    if (userData.role === 'conductor') return true;
    // Operators: check ownerOperatorId on the artist doc (primary) or legacy assignedArtistIds
    if (userData.role === 'operator') {
      // Primary check: artist's ownerOperatorId matches this operator's doc ID
      const artistDoc = await db.collection('artists').doc(artistId).get();
      if (artistDoc.exists && artistDoc.data().ownerOperatorId === userDoc.id) return true;
      // Legacy fallback: check assignedArtistIds on the user record
      const assignedArtists = userData.assignedArtistIds || [];
      return assignedArtists.includes(artistId);
    }
    // Artists can access their own data
    if (userData.role === 'artist' && userData.artistId === artistId) return true;
    // Collaborators can access their linked artist
    if (userData.role === 'collaborator' && userData.linkedArtistId === artistId) return true;
    return false;
  } catch (error) {
    console.error('Error checking artist access:', error.message);
    return false;
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
  // CORS - restrict to allowed origins (allow any localhost port in dev)
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin) || isLocalhostOrigin(origin) || isVercelPreview(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Initialize Firebase Admin lazily
  try {
    ensureFirebaseAdmin();
  } catch (error) {
    console.error('Firebase Admin init error:', error.message);
    return res.status(500).json({ error: `Firebase init failed: ${error.message}` });
  }

  // Verify authentication
  const authResult = await verifyAuth(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  // Log authenticated user (for audit trail)
  const userEmail = authResult.user.email;
  console.log(`Late API request from: ${userEmail}`);

  const { action, postId, page = 1, artistId, lateApiKey, ...body } = req.method === 'GET'
    ? req.query
    : { ...req.query, ...req.body };

  try {
    let response;

    switch (action) {
      // ============================================
      // KEY MANAGEMENT (Server-side secure storage)
      // ============================================

      case 'setKey':
        // POST - Save Late API key for an artist (operators only)
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'POST required for setKey' });
        }
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }
        if (!lateApiKey) {
          return res.status(400).json({ error: 'lateApiKey required' });
        }

        // Check if user has access to this artist
        const canSetKey = await canUserAccessArtist(userEmail, artistId);
        if (!canSetKey) {
          return res.status(403).json({ error: 'No access to this artist' });
        }

        // Save the key securely in artistSecrets collection
        await db.collection('artistSecrets').doc(artistId).set({
          lateApiKey: lateApiKey,
          updatedBy: userEmail,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        console.log(`Late API key set for artist ${artistId} by ${userEmail}`);
        return res.status(200).json({ success: true, message: 'Late API key saved securely' });

      case 'removeKey':
        // DELETE - Remove Late API key for an artist
        if (req.method !== 'DELETE') {
          return res.status(405).json({ error: 'DELETE required for removeKey' });
        }
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }

        const canRemoveKey = await canUserAccessArtist(userEmail, artistId);
        if (!canRemoveKey) {
          return res.status(403).json({ error: 'No access to this artist' });
        }

        await db.collection('artistSecrets').doc(artistId).delete();
        console.log(`Late API key removed for artist ${artistId} by ${userEmail}`);
        return res.status(200).json({ success: true, message: 'Late API key removed' });

      case 'keyStatus':
        // GET - Check if Late API key is configured for an artist (without exposing the key)
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }

        const canCheckKey = await canUserAccessArtist(userEmail, artistId);
        if (!canCheckKey) {
          return res.status(403).json({ error: 'No access to this artist' });
        }

        // Check artist-specific key in Firestore
        const secretDoc = await db.collection('artistSecrets').doc(artistId).get();
        const hasArtistKey = secretDoc.exists && !!secretDoc.data()?.lateApiKey;

        // Check if this artist is the designated global key artist
        const globalKeyArtistId = process.env.LATE_API_KEY_ARTIST_ID;
        const isGlobalKeyArtist = process.env.LATE_API_KEY && globalKeyArtistId && artistId === globalKeyArtistId;

        return res.status(200).json({
          configured: hasArtistKey || isGlobalKeyArtist,
          hasArtistSpecificKey: hasArtistKey,
          isGlobalKeyArtist: isGlobalKeyArtist,
          updatedAt: secretDoc.exists ? secretDoc.data()?.updatedAt : null
        });

      // ============================================
      // LATE API PROXY (uses per-artist keys)
      // All proxy actions require artist access check
      // ============================================

      case 'accounts':
        // GET /accounts - Fetch all connected accounts for this artist's Late account
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }
        const canAccessAccounts = await canUserAccessArtist(userEmail, artistId);
        if (!canAccessAccounts) {
          return res.status(403).json({ error: 'No access to this artist' });
        }

        const accountsKey = await getArtistLateKey(artistId);
        if (!accountsKey) {
          return res.status(400).json({ error: 'No Late API key configured for this artist' });
        }

        response = await fetchWithRetry(`${LATE_API_BASE}/accounts`, {
          headers: { 'Authorization': `Bearer ${accountsKey}` }
        });
        break;

      case 'posts':
        console.log('Posts action - artistId:', artistId);
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }
        const canAccessPosts = await canUserAccessArtist(userEmail, artistId);
        if (!canAccessPosts) {
          return res.status(403).json({ error: 'No access to this artist' });
        }

        const postsKey = await getArtistLateKey(artistId);
        console.log('Got Late key:', postsKey ? 'yes' : 'no');
        if (!postsKey) {
          return res.status(400).json({ error: 'No Late API key configured for this artist' });
        }

        if (req.method === 'GET') {
          // GET /posts - Fetch scheduled posts
          const postsUrl = `${LATE_API_BASE}/posts?page=${page}&limit=50`;
          console.log('Fetching:', postsUrl);
          response = await fetchWithRetry(postsUrl, {
            headers: { 'Authorization': `Bearer ${postsKey}` }
          });
          console.log('Late API response status:', response.status);
        } else if (req.method === 'POST') {
          // POST /posts - Create new scheduled post (sanitize input)
          const sanitizedBody = {
            ...body,
            caption: sanitizeText(body.caption),
            hashtags: (body.hashtags || []).map(sanitizeText)
          };
          response = await fetchWithRetry(`${LATE_API_BASE}/posts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${postsKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(sanitizedBody)
          });
        }
        break;

      case 'getPost':
        // GET /posts/:postId - Fetch a single post by ID (for status polling)
        if (!postId) {
          return res.status(400).json({ error: 'postId required for getPost' });
        }
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }
        const canGetPost = await canUserAccessArtist(userEmail, artistId);
        if (!canGetPost) {
          return res.status(403).json({ error: 'No access to this artist' });
        }

        const getPostKey = await getArtistLateKey(artistId);
        if (!getPostKey) {
          return res.status(400).json({ error: 'No Late API key configured for this artist' });
        }

        response = await fetchWithRetry(`${LATE_API_BASE}/posts/${postId}`, {
          headers: { 'Authorization': `Bearer ${getPostKey}` }
        });
        break;

      case 'updatePost':
        // PUT/PATCH /posts/:postId - Update a scheduled post's time
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'POST required for updatePost' });
        }
        if (!postId) {
          return res.status(400).json({ error: 'postId required for updatePost' });
        }
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }
        const canUpdatePost = await canUserAccessArtist(userEmail, artistId);
        if (!canUpdatePost) {
          return res.status(403).json({ error: 'No access to this artist' });
        }

        const updatePostKey = await getArtistLateKey(artistId);
        if (!updatePostKey) {
          return res.status(400).json({ error: 'No Late API key configured for this artist' });
        }

        // Update post on Late.co (PATCH method)
        response = await fetchWithRetry(`${LATE_API_BASE}/posts/${postId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${updatePostKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            scheduled_for: body.scheduledFor || body.scheduled_for
          })
        });
        break;

      case 'delete':
        if (!postId) {
          return res.status(400).json({ error: 'postId required for delete' });
        }
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }
        const canDelete = await canUserAccessArtist(userEmail, artistId);
        if (!canDelete) {
          return res.status(403).json({ error: 'No access to this artist' });
        }

        const deleteKey = await getArtistLateKey(artistId);
        if (!deleteKey) {
          return res.status(400).json({ error: 'No Late API key configured for this artist' });
        }

        // DELETE /posts/:id - Delete a scheduled post
        response = await fetchWithRetry(`${LATE_API_BASE}/posts/${postId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${deleteKey}` }
        });
        break;

      // ============================================
      // LATE OAUTH CONNECT (profile + account linking)
      // ============================================

      case 'profiles': {
        // GET /profiles - List Late profiles for this artist
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }
        const canListProfiles = await canUserAccessArtist(userEmail, artistId);
        if (!canListProfiles) {
          return res.status(403).json({ error: 'No access to this artist' });
        }
        const profilesKey = await getArtistLateKey(artistId);
        if (!profilesKey) {
          return res.status(400).json({ error: 'No Late API key configured for this artist' });
        }
        response = await fetchWithRetry(`${LATE_API_BASE}/profiles`, {
          headers: { 'Authorization': `Bearer ${profilesKey}` }
        });
        break;
      }

      case 'createProfile': {
        // POST /profiles - Create a Late profile for this artist
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'POST required for createProfile' });
        }
        if (!artistId) {
          return res.status(400).json({ error: 'artistId required' });
        }
        const canCreateProfile = await canUserAccessArtist(userEmail, artistId);
        if (!canCreateProfile) {
          return res.status(403).json({ error: 'No access to this artist' });
        }
        const createProfileKey = await getArtistLateKey(artistId);
        if (!createProfileKey) {
          return res.status(400).json({ error: 'No Late API key configured for this artist' });
        }
        response = await fetchWithRetry(`${LATE_API_BASE}/profiles`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${createProfileKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: sanitizeText(body.name || 'Default'),
            description: sanitizeText(body.description || '')
          })
        });
        break;
      }

      case 'connectUrl': {
        // GET - Generate OAuth connect URL for a platform
        const { platform: connectPlatform, profileId, redirectUrl } = req.query;
        if (!artistId || !connectPlatform || !profileId) {
          return res.status(400).json({ error: 'artistId, platform, and profileId required' });
        }
        const canConnect = await canUserAccessArtist(userEmail, artistId);
        if (!canConnect) {
          return res.status(403).json({ error: 'No access to this artist' });
        }
        const connectKey = await getArtistLateKey(artistId);
        if (!connectKey) {
          return res.status(400).json({ error: 'No Late API key configured for this artist' });
        }
        const connectParams = new URLSearchParams({ profileId });
        if (redirectUrl) connectParams.set('redirect_url', redirectUrl);
        response = await fetchWithRetry(`${LATE_API_BASE}/connect/${connectPlatform}?${connectParams}`, {
          headers: { 'Authorization': `Bearer ${connectKey}` }
        });
        break;
      }

      default:
        return res.status(400).json({ error: 'Invalid action. Use: accounts, posts, getPost, updatePost, delete, setKey, removeKey, keyStatus, profiles, createProfile, connectUrl' });
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
    console.error('Error stack:', error.stack);

    // Categorize error for better client-side messaging
    const isNetworkError = error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'ENOTFOUND'
      || error.message?.includes('fetch failed') || error.type === 'system';
    const isTimeoutError = error.name === 'AbortError' || error.message?.includes('timeout');

    if (isNetworkError) {
      return res.status(502).json({
        error: 'Unable to reach Late.co — the service may be temporarily down'
      });
    }
    if (isTimeoutError) {
      return res.status(504).json({
        error: 'Late.co request timed out — please try again'
      });
    }

    return res.status(500).json({
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
