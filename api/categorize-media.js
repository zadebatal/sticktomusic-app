/**
 * Vercel Serverless Function - Vision-Based Media Categorization
 *
 * Receives a media thumbnail URL, sends it to Claude Vision to get
 * categorization tags (performance, b-roll, studio, crowd, etc.)
 *
 * Environment: ANTHROPIC_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
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
    return { error: 'Invalid or expired token', status: 401 };
  }
}

async function isAllowedUser(userEmail) {
  if (!db || !userEmail) return false;
  try {
    const userDoc = await db.collection('allowedUsers').doc(userEmail).get();
    return userDoc.exists;
  } catch {
    return false;
  }
}

const VALID_CATEGORIES = [
  'performance', 'b-roll', 'studio', 'crowd', 'close-up',
  'interview', 'behind-the-scenes', 'lyric-visual', 'nature',
  'urban', 'portrait', 'group', 'product', 'abstract'
];

const SYSTEM_PROMPT = `You categorize images and video thumbnails for a music content platform. Analyze the visual content and return relevant category tags.

Available categories: ${VALID_CATEGORIES.join(', ')}

Rules:
- Return 1-3 most relevant categories per image
- "performance" = artist performing (stage, mic, instrument)
- "b-roll" = supplementary footage (hands, instruments, gear, textures)
- "studio" = recording studio, booth, mixing setup
- "crowd" = audience, fans, concert crowd
- "close-up" = tight shot of face, hands, or detail
- "interview" = talking head, podcast setup
- "behind-the-scenes" = casual, candid, backstage
- "lyric-visual" = text-heavy, graphics, lyric cards
- "nature" = outdoor, landscape, natural scenery
- "urban" = city, street, buildings
- "portrait" = posed photo of person(s)
- "group" = multiple people together
- "product" = merch, album art, branded items
- "abstract" = artistic, filtered, non-literal visuals

Return JSON only: { "tags": ["category1", "category2"], "confidence": 0.85 }`;

async function categorizeWithClaude(imageUrl, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: imageUrl },
          },
          {
            type: 'text',
            text: 'Categorize this image. Return JSON only.',
          },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin) || isLocalhostOrigin(origin) || isVercelPreview(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authResult = await verifyAuth(req);
  if (authResult.error) return res.status(authResult.status).json({ error: authResult.error });

  const hasAccess = await isAllowedUser(authResult.user.email);
  if (!hasAccess) return res.status(403).json({ error: 'Not an authorized user' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

  try {
    const { imageUrl, imageUrls } = req.body;

    // Single image
    if (imageUrl) {
      const result = await categorizeWithClaude(imageUrl, anthropicKey);
      const tags = (result.tags || [])
        .map(t => String(t).toLowerCase().trim())
        .filter(t => VALID_CATEGORIES.includes(t));

      return res.status(200).json({
        tags,
        confidence: Number(result.confidence) || 0.5,
      });
    }

    // Batch (up to 10)
    if (imageUrls && Array.isArray(imageUrls)) {
      const batch = imageUrls.slice(0, 10);
      const results = await Promise.allSettled(
        batch.map(url => categorizeWithClaude(url, anthropicKey))
      );

      const categorized = results.map((r, i) => {
        if (r.status === 'fulfilled') {
          const tags = (r.value.tags || [])
            .map(t => String(t).toLowerCase().trim())
            .filter(t => VALID_CATEGORIES.includes(t));
          return { url: batch[i], tags, confidence: Number(r.value.confidence) || 0.5 };
        }
        return { url: batch[i], tags: [], confidence: 0, error: r.reason?.message };
      });

      return res.status(200).json({ results: categorized });
    }

    return res.status(400).json({ error: 'Provide imageUrl or imageUrls array' });
  } catch (error) {
    console.error('Categorization error:', error.message);
    return res.status(500).json({ error: 'Categorization failed: ' + error.message });
  }
}
