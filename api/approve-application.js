// Vercel Serverless Function: Approve or Deny Application
// URL: https://sticktomusic.com/api/approve-application
//
// POST { applicationId, action: 'approve' | 'deny' }
// If approved: creates Stripe checkout, grants access after payment
// If denied: sends denial email, marks application denied

import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
const adminAuth = getAuth();

// Verify the request is from an authenticated conductor
async function verifyConductor(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No auth token');
  }
  const token = authHeader.split('Bearer ')[1];
  const decoded = await adminAuth.verifyIdToken(token);

  const conductorEmails = (process.env.REACT_APP_CONDUCTOR_EMAILS || 'zade@sticktomusic.com,zadebatal@gmail.com')
    .split(',').map(e => e.trim().toLowerCase());

  if (!conductorEmails.includes(decoded.email?.toLowerCase())) {
    throw new Error('Not a conductor');
  }
  return decoded;
}

async function sendNotificationEmail(to, subject, body) {
  try {
    await db.collection('mail').add({
      to,
      message: { subject, html: body },
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to queue email:', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify conductor auth
    await verifyConductor(req);

    const { applicationId, action } = req.body;

    if (!applicationId || !['approve', 'deny'].includes(action)) {
      return res.status(400).json({ error: 'applicationId and action (approve/deny) required' });
    }

    const appRef = db.collection('applications').doc(applicationId);
    const appDoc = await appRef.get();

    if (!appDoc.exists) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const application = appDoc.data();

    if (action === 'deny') {
      // Mark denied and notify applicant
      await appRef.update({
        status: 'denied',
        deniedAt: new Date().toISOString(),
      });

      await sendNotificationEmail(
        application.email,
        'StickToMusic Application Update',
        `
          <h2>Application Update</h2>
          <p>Hi ${application.name},</p>
          <p>Thank you for your interest in StickToMusic. After review, we're unable to approve your application at this time.</p>
          <p>If you have questions, feel free to reply to this email.</p>
          <br/>
          <p>— The StickToMusic Team</p>
        `
      );

      return res.json({ success: true, action: 'denied' });
    }

    // APPROVE — create Stripe Checkout session to charge them
    const origin = req.headers.origin || 'https://sticktomusic.com';
    const stripePriceId = process.env.STRIPE_SOCIAL_SET_PRICE_ID;

    if (!stripePriceId) {
      // No Stripe price configured — approve without payment (manual billing)
      await appRef.update({
        status: 'approved',
        approvedAt: new Date().toISOString(),
      });

      // Create allowedUsers record
      await db.collection('allowedUsers').doc(application.email).set({
        email: application.email,
        name: application.name,
        role: application.role || 'artist',
        status: 'active',
        socialSetsAllowed: application.sets || 5,
        tier: application.tier || 'starter',
        onboardingComplete: false,
        createdAt: new Date().toISOString(),
        applicationId,
      }, { merge: true });

      // Notify applicant of approval
      await sendNotificationEmail(
        application.email,
        'Welcome to StickToMusic!',
        `
          <h2>You're In!</h2>
          <p>Hi ${application.name},</p>
          <p>Your application has been approved! You can now sign up and access your dashboard.</p>
          <p>Visit <a href="${origin}">StickToMusic</a> to get started.</p>
          <br/>
          <p>— The StickToMusic Team</p>
        `
      );

      return res.json({ success: true, action: 'approved', paymentSkipped: true });
    }

    // Create Stripe Checkout for immediate charge on approval
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: application.email,
      line_items: [{
        price: stripePriceId,
        quantity: application.sets || 5,
      }],
      success_url: `${origin}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?checkout=cancelled`,
      metadata: {
        name: application.name,
        tier: application.tier || '',
        role: application.role || 'artist',
        sets: String(application.sets || 5),
        email: application.email,
        applicationId,
      },
    });

    // Mark application as approved pending payment
    await appRef.update({
      status: 'pending_payment',
      approvedAt: new Date().toISOString(),
      stripeCheckoutUrl: session.url,
    });

    // Send payment link to the applicant
    await sendNotificationEmail(
      application.email,
      'StickToMusic Application Approved - Complete Your Setup!',
      `
        <h2>You're Approved!</h2>
        <p>Hi ${application.name},</p>
        <p>Great news — your application to StickToMusic has been approved!</p>
        <p>Click the link below to complete your payment and get started:</p>
        <p><a href="${session.url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:white;border-radius:8px;text-decoration:none;font-weight:bold;">Complete Setup — ${application.tier || 'Starter'} Plan</a></p>
        <br/>
        <p>— The StickToMusic Team</p>
      `
    );

    return res.json({
      success: true,
      action: 'approved',
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error('Application approval error:', error);
    if (error.message === 'Not a conductor' || error.message === 'No auth token') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    res.status(500).json({ error: error.message || 'Failed to process application' });
  }
}
