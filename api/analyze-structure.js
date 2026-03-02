/**
 * Vercel Serverless Function - Song Structure Analysis
 *
 * Receives a Whisper transcript (words + timestamps) and uses Claude Haiku
 * to identify song sections (verse, chorus, bridge, etc.) with time ranges.
 *
 * Environment: ANTHROPIC_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Allowed origins (shared with transcribe.js)
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

const SYSTEM_PROMPT = `You are a music structure analyst. Given song lyrics with word-level timestamps, identify the song sections (verse, chorus, bridge, pre-chorus, intro, outro, hook, etc.).

Rules:
- Each section must have a name, type, startTime, endTime, and a short lyricSnippet (first few words)
- Types must be one of: intro, verse, pre-chorus, chorus, bridge, hook, outro, interlude, ad-lib
- Times are in seconds (decimal)
- Sections must not overlap
- Sections should cover the full lyric range
- If lyrics repeat, that's likely a chorus
- Return valid JSON only, no markdown fences`;

function buildUserPrompt(transcript, words, totalDuration) {
  const wordList = words.map(w =>
    `[${w.startTime.toFixed(2)}s] ${w.text}`
  ).join('\n');

  return `Analyze this song's structure. Total duration: ${totalDuration.toFixed(1)}s

Full lyrics: "${transcript}"

Word timestamps:
${wordList}

Return JSON in this exact format:
{"sections":[{"name":"Verse 1","type":"verse","startTime":0.0,"endTime":30.5,"lyricSnippet":"first few words"},{"name":"Chorus","type":"chorus","startTime":30.5,"endTime":55.2,"lyricSnippet":"first few words"}],"confidence":0.85}`;
}

async function callClaude(transcript, words, totalDuration, apiKey) {
  const userPrompt = buildUserPrompt(transcript, words, totalDuration);

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
    const { transcript, words, totalDuration } = req.body;

    if (!transcript || !words || !Array.isArray(words)) {
      return res.status(400).json({ error: 'Missing transcript or words array' });
    }

    // Skip Claude call if too few words (instrumental)
    if (words.length < 5) {
      return res.status(200).json({ sections: [], confidence: 0 });
    }

    // Call Claude — retry once on bad JSON
    let result;
    try {
      result = await callClaude(transcript, words, totalDuration || 0, anthropicKey);
    } catch (parseError) {
      // Retry with stricter prompt
      try {
        result = await callClaude(transcript, words, totalDuration || 0, anthropicKey);
      } catch (retryError) {
        return res.status(500).json({ error: 'Failed to parse song structure: ' + retryError.message });
      }
    }

    // Validate structure
    if (!result.sections || !Array.isArray(result.sections)) {
      return res.status(500).json({ error: 'Invalid response structure from Claude' });
    }

    // Sanitize sections
    const sections = result.sections.map(s => ({
      name: String(s.name || 'Section'),
      type: String(s.type || 'verse'),
      startTime: Number(s.startTime) || 0,
      endTime: Number(s.endTime) || 0,
      lyricSnippet: String(s.lyricSnippet || '').slice(0, 80),
    })).filter(s => s.endTime > s.startTime);

    return res.status(200).json({
      sections,
      confidence: Number(result.confidence) || 0.5,
    });
  } catch (error) {
    console.error('Structure analysis error:', error.message);
    return res.status(500).json({ error: 'Structure analysis failed: ' + error.message });
  }
}
