/**
 * Spotify API Proxy - Serverless Function
 *
 * Handles:
 * - Spotify Web API requests (artist info, track info)
 * - Spot On Track API requests (streaming data)
 * - Secure credential management
 *
 * Environment Variables:
 * - SPOTIFY_CLIENT_ID: Spotify app client ID
 * - SPOTIFY_CLIENT_SECRET: Spotify app client secret
 * - SPOTONTRACK_API_KEY: Spot On Track API key (optional)
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK (only once)
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
  } catch (e) {
    console.error('Firebase Admin init error:', e.message);
  }
}
try { db = getFirestore(); } catch(e) { console.error('Firestore init error:', e); }

// Allowed origins - restrict CORS to your domains only
const ALLOWED_ORIGINS = [
  'https://sticktomusic.com',
  'https://www.sticktomusic.com',
  'https://sticktomusic-app.vercel.app'
];

// Also allow Vercel preview deployments
const isVercelPreview = (origin) => {
  if (!origin) return false;
  return origin.includes('sticktomusic') && origin.endsWith('.vercel.app');
};

// Check if origin is localhost for development
const isLocalhostOrigin = (origin) => {
  if (!origin) return false;
  return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
};

// Get CORS headers based on request origin
function getCorsHeaders(origin) {
  const allowedOrigin = (ALLOWED_ORIGINS.includes(origin) || isVercelPreview(origin) || isLocalhostOrigin(origin))
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Spotify OAuth token cache
let spotifyTokenCache = {
  token: null,
  expiresAt: 0
};

/**
 * Get Spotify access token using Client Credentials flow
 */
async function getSpotifyToken() {
  const now = Date.now();

  // Return cached token if still valid
  if (spotifyTokenCache.token && spotifyTokenCache.expiresAt > now + 60000) {
    return spotifyTokenCache.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    throw new Error(`Spotify auth failed: ${response.status}`);
  }

  const data = await response.json();

  // Cache the token
  spotifyTokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in * 1000)
  };

  return data.access_token;
}

/**
 * Verify Firebase auth token
 */
async function verifyAuthToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.split('Bearer ')[1];
  const { getAuth } = await import('firebase-admin/auth');
  const decodedToken = await getAuth().verifyIdToken(token);
  return decodedToken;
}

/**
 * Check if user is operator or above
 */
async function isUserOperator(email) {
  try {
    const userDoc = await db.collection('allowedUsers').doc(email).get();
    if (!userDoc.exists) return false;
    const data = userDoc.data();
    return ['conductor', 'operator'].includes(data.role);
  } catch {
    return false;
  }
}

/**
 * Get Spotify config for an artist
 */
async function getArtistSpotifyConfig(artistId) {
  try {
    const artistDoc = await db.collection('artists').doc(artistId).get();
    if (!artistDoc.exists) return null;
    const data = artistDoc.data();
    return data.spotifyConfig || null;
  } catch {
    return null;
  }
}

/**
 * Save Spotify config for an artist
 */
async function saveArtistSpotifyConfig(artistId, config) {
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection('artists').doc(artistId).update({
    spotifyConfig: config,
    updatedAt: FieldValue.serverTimestamp()
  });
}

// ============================================
// SPOTIFY WEB API HANDLERS
// ============================================

/**
 * Get artist info from Spotify
 */
async function getSpotifyArtist(spotifyArtistId) {
  const token = await getSpotifyToken();

  const response = await fetch(`https://api.spotify.com/v1/artists/${spotifyArtistId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Artist not found on Spotify');
    }
    throw new Error(`Spotify API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get track info from Spotify
 */
async function getSpotifyTrack(spotifyTrackId) {
  const token = await getSpotifyToken();

  const response = await fetch(`https://api.spotify.com/v1/tracks/${spotifyTrackId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Track not found on Spotify');
    }
    throw new Error(`Spotify API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Search for tracks by ISRC codes
 */
async function getTracksByISRC(isrcCodes) {
  const token = await getSpotifyToken();
  const tracks = [];

  for (const isrc of isrcCodes) {
    try {
      const response = await fetch(
        `https://api.spotify.com/v1/search?q=isrc:${isrc}&type=track&limit=1`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.tracks?.items?.length > 0) {
          tracks.push({
            isrc,
            track: data.tracks.items[0]
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching track for ISRC ${isrc}:`, error);
    }
  }

  return tracks;
}

/**
 * Search for an artist on Spotify
 */
async function searchSpotifyArtist(query) {
  const token = await getSpotifyToken();

  const response = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=10`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Spotify API error: ${response.status}`);
  }

  const data = await response.json();
  return data.artists?.items || [];
}

/**
 * Get artist's top tracks
 */
async function getArtistTopTracks(spotifyArtistId, market = 'US') {
  const token = await getSpotifyToken();

  const response = await fetch(
    `https://api.spotify.com/v1/artists/${spotifyArtistId}/top-tracks?market=${market}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Spotify API error: ${response.status}`);
  }

  const data = await response.json();
  return data.tracks || [];
}

/**
 * Get artist's albums
 */
async function getArtistAlbums(spotifyArtistId, limit = 50) {
  const token = await getSpotifyToken();

  const response = await fetch(
    `https://api.spotify.com/v1/artists/${spotifyArtistId}/albums?limit=${limit}&include_groups=album,single`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Spotify API error: ${response.status}`);
  }

  const data = await response.json();
  return data.items || [];
}

// ============================================
// REQUEST HANDLER
// ============================================

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    return res.status(200).end();
  }

  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  try {
    // Verify authentication
    const decodedToken = await verifyAuthToken(req.headers.authorization);
    const userEmail = decodedToken.email;

    // Check if user is operator
    const isOperator = await isUserOperator(userEmail);
    if (!isOperator) {
      return res.status(403).json({ error: 'Unauthorized - operator access required' });
    }

    const { action, artistId } = req.query;

    if (!action) {
      return res.status(400).json({ error: 'Missing action parameter' });
    }

    // Handle different actions
    switch (action) {
      case 'getArtist': {
        const { spotifyArtistId } = req.query;
        if (!spotifyArtistId) {
          return res.status(400).json({ error: 'Missing spotifyArtistId' });
        }
        const artist = await getSpotifyArtist(spotifyArtistId);
        return res.status(200).json(artist);
      }

      case 'getTrack': {
        const { spotifyTrackId } = req.query;
        if (!spotifyTrackId) {
          return res.status(400).json({ error: 'Missing spotifyTrackId' });
        }
        const track = await getSpotifyTrack(spotifyTrackId);
        return res.status(200).json(track);
      }

      case 'getTracksByISRC': {
        const { isrcCodes } = req.query;
        if (!isrcCodes) {
          return res.status(400).json({ error: 'Missing isrcCodes' });
        }
        const codes = isrcCodes.split(',');
        const tracks = await getTracksByISRC(codes);
        return res.status(200).json(tracks);
      }

      case 'searchArtist': {
        const { query } = req.query;
        if (!query) {
          return res.status(400).json({ error: 'Missing search query' });
        }
        const artists = await searchSpotifyArtist(query);
        return res.status(200).json(artists);
      }

      case 'getTopTracks': {
        const { spotifyArtistId, market } = req.query;
        if (!spotifyArtistId) {
          return res.status(400).json({ error: 'Missing spotifyArtistId' });
        }
        const tracks = await getArtistTopTracks(spotifyArtistId, market || 'US');
        return res.status(200).json(tracks);
      }

      case 'getAlbums': {
        const { spotifyArtistId, limit } = req.query;
        if (!spotifyArtistId) {
          return res.status(400).json({ error: 'Missing spotifyArtistId' });
        }
        const albums = await getArtistAlbums(spotifyArtistId, parseInt(limit) || 50);
        return res.status(200).json(albums);
      }

      case 'getConfig': {
        if (!artistId) {
          return res.status(400).json({ error: 'Missing artistId' });
        }
        const config = await getArtistSpotifyConfig(artistId);
        return res.status(200).json({ config });
      }

      case 'saveConfig': {
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        if (!artistId) {
          return res.status(400).json({ error: 'Missing artistId' });
        }
        const config = req.body;
        await saveArtistSpotifyConfig(artistId, config);
        return res.status(200).json({ success: true });
      }

      case 'validateArtist': {
        const { spotifyArtistId } = req.query;
        if (!spotifyArtistId) {
          return res.status(400).json({ error: 'Missing spotifyArtistId' });
        }
        try {
          const artist = await getSpotifyArtist(spotifyArtistId);
          return res.status(200).json({
            valid: true,
            artist: {
              id: artist.id,
              name: artist.name,
              followers: artist.followers?.total || 0,
              popularity: artist.popularity || 0,
              images: artist.images || [],
              genres: artist.genres || []
            }
          });
        } catch (error) {
          return res.status(200).json({
            valid: false,
            error: error.message
          });
        }
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error) {
    console.error('Spotify API error:', error);

    if (error.message.includes('auth') || error.message.includes('token')) {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
}
