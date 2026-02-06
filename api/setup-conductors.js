/**
 * ONE-TIME MIGRATION: Re-key allowedUsers documents to use email as document ID.
 *
 * The Firestore security rules look up users by document ID (allowedUsers/{email}),
 * but existing documents were created with auto-generated IDs via addDoc().
 * This migrates them so the rules can find them.
 *
 * DELETE THIS FILE after running it once successfully.
 *
 * Usage: GET /api/setup-conductors?secret=FIREBASE_PROJECT_ID
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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

export default async function handler(req, res) {
  const { secret } = req.query;
  if (secret !== process.env.FIREBASE_PROJECT_ID) {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  if (!db) {
    return res.status(500).json({ error: 'Firebase Admin not initialized' });
  }

  const results = [];

  try {
    // Read ALL existing allowedUsers documents
    const snapshot = await db.collection('allowedUsers').get();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const email = data.email?.toLowerCase();

      if (!email) {
        results.push({ id: doc.id, status: 'skipped - no email field' });
        continue;
      }

      // If the document ID is already the email, skip
      if (doc.id === email) {
        results.push({ email, status: 'already correct ID' });
        continue;
      }

      // Create new document with email as ID
      const emailDocRef = db.collection('allowedUsers').doc(email);
      const existingEmailDoc = await emailDocRef.get();

      if (existingEmailDoc.exists) {
        // Merge: keep existing email-keyed doc but update with any newer fields
        results.push({ email, oldId: doc.id, status: 'email-keyed doc already exists, skipping' });
      } else {
        // Copy data to new email-keyed document
        await emailDocRef.set({
          ...data,
          email: email, // normalize to lowercase
          migratedFrom: doc.id,
          migratedAt: FieldValue.serverTimestamp()
        });
        results.push({ email, oldId: doc.id, status: 'migrated to email-keyed doc' });
      }
    }

    return res.status(200).json({
      message: 'Migration complete',
      totalDocs: snapshot.size,
      results,
      note: 'DELETE api/setup-conductors.js now!'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
