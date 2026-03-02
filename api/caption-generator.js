/**
 * Vercel Serverless Function - AI Caption & Hashtag Generator
 *
 * Receives song/project context and uses Claude Haiku to generate
 * social media captions and hashtags optimized for music promotion.
 *
 * Environment: ANTHROPIC_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Allowed origins (shared with other API routes)
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

const SYSTEM_PROMPT = `You are a social media copywriter specializing in music promotion. You write captions and hashtags for musicians posting content on TikTok, Instagram Reels, YouTube Shorts, and Facebook.

## Caption style:
- Short, punchy, engaging — like a real artist would post
- Mix of: hype captions, storytelling, emotional hooks, call-to-action, relatable quotes
- Vary the tone: some casual, some poetic, some provocative, some funny
- Never generic or corporate — sound authentic and human
- Include relevant emojis sparingly (1-3 per caption max)
- Each caption should work standalone as a social media post caption
- Keep captions under 200 characters each (short-form video captions)

## Hashtag style:
- Mix of high-reach (broad) and niche-specific tags
- Include genre-specific, mood-specific, and discovery tags
- Always include music-related discovery tags (#newmusic, #unsigned, etc.)
- Platform-aware: TikTok favors trending/sound tags, Instagram favors niche community tags
- No spaces in hashtags, lowercase preferred
- 15-25 hashtags total

## Output format:
Return valid JSON only, no markdown fences:
{
  "captions": ["caption1", "caption2", ...],
  "hashtags": ["#tag1", "#tag2", ...],
  "confidence": 0.85
}`;

function buildUserPrompt({ projectName, nicheName, context, platforms, existingCaptions, existingHashtags, captionCount }) {
  let prompt = `Generate ${captionCount || 5} unique social media captions and 15-25 relevant hashtags for a music artist.\n\n`;

  if (projectName) prompt += `Song/Project: "${projectName}"\n`;
  if (nicheName && nicheName !== projectName) prompt += `Content niche: "${nicheName}"\n`;
  if (context) prompt += `Artist context: ${context}\n`;
  if (platforms?.length > 0) prompt += `Target platforms: ${platforms.join(', ')}\n`;

  if (existingCaptions?.length > 0) {
    prompt += `\nExisting captions (do NOT duplicate these, generate NEW ones):\n${existingCaptions.slice(0, 10).map(c => `- "${c}"`).join('\n')}\n`;
  }

  if (existingHashtags?.length > 0) {
    prompt += `\nExisting hashtags (you may include some of these if relevant, but add NEW ones too):\n${existingHashtags.join(' ')}\n`;
  }

  prompt += `\nGenerate fresh, engaging captions and hashtags. Return JSON only.`;
  return prompt;
}

async function callClaude(params, apiKey) {
  const userPrompt = buildUserPrompt(params);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  // Parse JSON from response (strip markdown fences if present)
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.status(500).json({ error: 'Anthropic API key not configured on server' });
  }

  try {
    const { projectName, nicheName, context, platforms, existingCaptions, existingHashtags, captionCount } = req.body;

    if (!projectName && !nicheName && !context) {
      return res.status(400).json({ error: 'Provide at least a project name, niche name, or context' });
    }

    // Call Claude — retry once on bad JSON
    let result;
    try {
      result = await callClaude(req.body, anthropicKey);
    } catch (parseError) {
      try {
        result = await callClaude(req.body, anthropicKey);
      } catch (retryError) {
        return res.status(500).json({ error: 'Failed to generate captions: ' + retryError.message });
      }
    }

    // Validate structure
    if (!result.captions || !Array.isArray(result.captions)) {
      return res.status(500).json({ error: 'Invalid response structure from Claude' });
    }

    // Sanitize
    const captions = result.captions
      .map(c => String(c || '').trim())
      .filter(c => c.length > 0)
      .slice(0, 20);

    const hashtags = (result.hashtags || [])
      .map(h => {
        const tag = String(h || '').trim();
        return tag.startsWith('#') ? tag : `#${tag}`;
      })
      .filter(h => h.length > 1)
      .slice(0, 30);

    return res.status(200).json({
      captions,
      hashtags,
      confidence: Number(result.confidence) || 0.5,
    });
  } catch (error) {
    console.error('Caption generation error:', error.message);
    return res.status(500).json({ error: 'Caption generation failed: ' + error.message });
  }
}
