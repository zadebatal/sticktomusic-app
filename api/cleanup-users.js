/**
 * ONE-TIME: Delete old auto-generated-ID allowedUsers documents.
 * After migration, both old (random ID) and new (email ID) docs exist.
 * This deletes the old ones. DELETE THIS FILE after running.
 */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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
  } catch (e) { console.error('Init error:', e.message); }
}
try { db = getFirestore(); } catch(e) {}

export default async function handler(req, res) {
  if (req.query.secret !== process.env.FIREBASE_PROJECT_ID) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  if (!db) return res.status(500).json({ error: 'No db' });

  const snapshot = await db.collection('allowedUsers').get();
  const deleted = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const email = data.email?.toLowerCase();
    // If doc ID is NOT an email (contains no @), it's an old auto-generated ID
    if (email && !doc.id.includes('@')) {
      // Verify the email-keyed version exists before deleting
      const emailDoc = await db.collection('allowedUsers').doc(email).get();
      if (emailDoc.exists) {
        await doc.ref.delete();
        deleted.push({ oldId: doc.id, email });
      }
    }
  }

  return res.status(200).json({ message: 'Cleanup done', deleted, note: 'DELETE api/cleanup-users.js' });
}
