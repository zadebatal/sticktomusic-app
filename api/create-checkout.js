// Vercel Serverless Function: Application Submission + Conductor Notification
// URL: https://sticktomusic.com/api/create-checkout
//
// Flow: User applies → Conductor gets email → Conductor approves/denies → If approved, charge via Stripe

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (only once)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

// Simple email sender using a generic SMTP or webhook
// For now, we'll use a Firestore trigger approach: write to a 'mail' collection
// that a Cloud Function or extension (like Firebase Trigger Email) picks up.
// Alternatively, this sends via a simple fetch to an email API.
async function sendNotificationEmail(to, subject, body) {
  // Write to Firestore 'mail' collection for Firebase Trigger Email extension
  // Or use any email API (SendGrid, Resend, etc.)
  try {
    await db.collection('mail').add({
      to,
      message: { subject, html: body },
      createdAt: new Date().toISOString(),
    });
    console.log(`📧 Queued email to ${to}: ${subject}`);
  } catch (err) {
    console.error('Failed to queue email:', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, name, tier, sets, role } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Create application record in Firestore
    const application = {
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      tier: tier || 'starter',
      sets: parseInt(sets) || 5,
      role: role || 'artist',
      status: 'pending_review', // Conductor must approve before charging
      submittedAt: new Date().toISOString(),
    };

    // Check for existing pending application
    const existing = await db.collection('applications')
      .where('email', '==', normalizedEmail)
      .where('status', '==', 'pending_review')
      .get();

    if (!existing.empty) {
      return res.json({
        success: true,
        message: 'Your application is already under review. We\'ll be in touch soon!',
        alreadyPending: true,
      });
    }

    const docRef = await db.collection('applications').add(application);

    // Notify conductor (Zade) via email
    const conductorEmail = process.env.CONDUCTOR_NOTIFICATION_EMAIL || 'zadebatal@gmail.com';
    const approveUrl = `${req.headers.origin || 'https://sticktomusic.com'}/operator/artists`;

    await sendNotificationEmail(
      conductorEmail,
      `New StickToMusic Application: ${application.name}`,
      `
        <h2>New Application</h2>
        <p><strong>Name:</strong> ${application.name}</p>
        <p><strong>Email:</strong> ${application.email}</p>
        <p><strong>Role:</strong> ${application.role}</p>
        <p><strong>Tier:</strong> ${application.tier} (${application.sets} Social Sets)</p>
        <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
        <br/>
        <p>Log in to <a href="${approveUrl}">your dashboard</a> to approve or deny this application.</p>
        <p>Application ID: ${docRef.id}</p>
      `
    );

    res.json({
      success: true,
      message: 'Application submitted! We\'ll review and get back to you shortly.',
      applicationId: docRef.id,
    });
  } catch (error) {
    console.error('Application submission error:', error);
    res.status(500).json({ error: error.message || 'Failed to submit application' });
  }
}
