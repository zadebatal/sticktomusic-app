// Vercel Serverless Function: Stripe Webhook Handler
// Place this file in your project's /api folder
// URL will be: https://sticktomusic.com/api/stripe-webhook

import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

export const config = {
  api: {
    bodyParser: false, // Stripe requires raw body for signature verification
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const customerEmail = session.customer_details?.email || session.customer_email;
    const customerName = session.customer_details?.name || 'New User';

    if (customerEmail) {
      try {
        // Look up the application to get full artist data
        const applicationQuery = await db
          .collection('applications')
          .where('email', '==', customerEmail.toLowerCase())
          .where('status', '==', 'pending_payment')
          .get();

        let applicationData = null;
        let applicationDoc = null;

        if (!applicationQuery.empty) {
          applicationDoc = applicationQuery.docs[0];
          applicationData = applicationDoc.data();
          console.log(`📋 Found application for: ${customerEmail}`);
        }

        // Check if user already exists in allowedUsers
        const existingUser = await db
          .collection('allowedUsers')
          .where('email', '==', customerEmail.toLowerCase())
          .get();

        // Build the artist profile with all application data
        const artistProfile = {
          email: customerEmail.toLowerCase(),
          name: applicationData?.name || customerName,
          role: 'artist',
          artistId: (applicationData?.name || customerName).toLowerCase().replace(/\s+/g, '-'),
          status: 'active',
          stripeSessionId: session.id,
          stripeCustomerId: session.customer,
          amountPaid: session.amount_total,
        };

        // Add all application data to the profile if available
        if (applicationData) {
          artistProfile.genre = applicationData.genre || '';
          artistProfile.vibes = applicationData.vibes || [];
          artistProfile.phone = applicationData.phone || '';
          artistProfile.managerContact = applicationData.managerContact || '';
          artistProfile.spotify = applicationData.spotify || '';
          artistProfile.instagram = applicationData.instagram || '';
          artistProfile.tiktok = applicationData.tiktok || '';
          artistProfile.youtube = applicationData.youtube || '';
          artistProfile.tier = applicationData.tier || '';
          artistProfile.projectType = applicationData.projectType || '';
          artistProfile.projectDescription = applicationData.projectDescription || '';
          artistProfile.releaseDate = applicationData.releaseDate || '';
          artistProfile.aestheticWords = applicationData.aestheticWords || '';
          artistProfile.adjacentArtists = applicationData.adjacentArtists || '';
          artistProfile.ageRanges = applicationData.ageRanges || [];
          artistProfile.idealListener = applicationData.idealListener || '';
          artistProfile.contentTypes = applicationData.contentTypes || [];
          artistProfile.cdTier = applicationData.cdTier || '';
          artistProfile.duration = applicationData.duration || '';
          artistProfile.referral = applicationData.referral || '';
          artistProfile.applicationId = applicationDoc.id;
        }

        if (existingUser.empty) {
          // Add new user to allowedUsers with full profile
          artistProfile.createdAt = new Date().toISOString();
          await db.collection('allowedUsers').add(artistProfile);
          console.log(`✅ Added new user with full profile: ${customerEmail}`);
        } else {
          // Update existing user status to active
          const userDoc = existingUser.docs[0];
          artistProfile.updatedAt = new Date().toISOString();
          await userDoc.ref.update(artistProfile);
          console.log(`✅ Updated existing user: ${customerEmail}`);
        }

        // Update the application status to approved
        if (applicationDoc) {
          await applicationDoc.ref.update({
            status: 'approved',
            approvedAt: new Date().toISOString(),
            stripeSessionId: session.id,
          });
          console.log(`✅ Updated application status to approved`);
        }
      } catch (error) {
        console.error('Error adding user to Firestore:', error);
        return res.status(500).json({ error: 'Failed to add user' });
      }
    }
  }

  // Handle payment_intent.succeeded (alternative event)
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log(`💰 Payment succeeded: ${paymentIntent.id}`);
  }

  res.status(200).json({ received: true });
}
