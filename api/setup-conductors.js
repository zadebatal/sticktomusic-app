/**
 * ONE-TIME SETUP: Seed conductor accounts into allowedUsers collection.
 *
 * The Firestore security rules require users to exist in allowedUsers,
 * but only conductors can add users — creating a chicken-and-egg problem.
 * This endpoint uses the Admin SDK (which bypasses rules) to bootstrap
 * the initial conductor accounts.
 *
 * DELETE THIS FILE after running it once successfully.
 *
 * Usage: GET /api/setup-conductors?secret=YOUR_LATE_API_KEY
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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
  } catch (error) {
    console.error('Firebase Admin init error:', error.message);
  }
}
try { db = getFirestore(); } catch(e) { console.error('Firestore init error:', e); }

// Conductor emails to seed — must match REACT_APP_CONDUCTOR_EMAILS
const CONDUCTOR_EMAILS = [
  'zade@sticktomusic.com',
  'zadebatal@gmail.com'
];

export default async function handler(req, res) {
  // Simple auth: verify the Firebase project ID is correct (proves caller knows the project)
  const { secret } = req.query;
  if (secret !== process.env.FIREBASE_PROJECT_ID) {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  if (!db) {
    return res.status(500).json({ error: 'Firebase Admin not initialized' });
  }

  const results = [];

  for (const email of CONDUCTOR_EMAILS) {
    try {
      // Use email as document ID for easy lookup by security rules
      const docRef = db.collection('allowedUsers').doc(email);
      const existing = await docRef.get();

      if (existing.exists) {
        // Update role to conductor if not already
        const data = existing.data();
        if (data.role !== 'conductor') {
          await docRef.update({ role: 'conductor', updatedAt: FieldValue.serverTimestamp() });
          results.push({ email, status: 'updated to conductor' });
        } else {
          results.push({ email, status: 'already conductor' });
        }
      } else {
        // Create new conductor entry
        await docRef.set({
          email: email,
          role: 'conductor',
          name: email.split('@')[0],
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
          assignedArtistIds: []
        });
        results.push({ email, status: 'created as conductor' });
      }
    } catch (error) {
      results.push({ email, status: 'error', error: error.message });
    }
  }

  return res.status(200).json({
    message: 'Conductor setup complete',
    results,
    note: 'DELETE the api/setup-conductors.js file now!'
  });
}
