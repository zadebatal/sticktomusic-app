// Vercel Serverless Function: Cancel Subscription
// URL: https://sticktomusic.com/api/cancel-subscription
//
// POST with Firebase auth token — cancels the user's Stripe subscription

import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  try {
    // Verify Firebase auth
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const token = authHeader.split('Bearer ')[1];
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email?.toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'No email in token' });
    }

    // Get user's allowedUsers record
    const userDoc = await db.collection('allowedUsers').doc(email).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();

    // Don't allow exempt users to cancel (they don't have subscriptions)
    if (userData.paymentExempt) {
      return res.status(400).json({ error: 'Exempt users cannot cancel' });
    }

    if (!userData.subscriptionId) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    // Cancel the Stripe subscription at period end
    const subscription = await stripe.subscriptions.update(userData.subscriptionId, {
      cancel_at_period_end: true,
    });

    // Update Firestore
    await db.collection('allowedUsers').doc(email).update({
      subscriptionStatus: 'cancelling',
      cancelledAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: 'Subscription will be cancelled at the end of the current billing period.',
      cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel subscription' });
  }
}
