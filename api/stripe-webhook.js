// Vercel Serverless Function: Stripe Webhook Handler
// URL: https://sticktomusic.com/api/stripe-webhook

import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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

  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
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

  // Handle checkout.session.completed — user paid after approval
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata || {};
    const customerEmail = (metadata.email || session.customer_details?.email || session.customer_email || '').toLowerCase();
    const customerName = metadata.name || session.customer_details?.name || 'New User';

    if (customerEmail) {
      try {
        // Build user profile with Social Sets data
        const userProfile = {
          email: customerEmail,
          name: customerName,
          role: metadata.role || 'artist',
          status: 'active',
          socialSetsAllowed: parseInt(metadata.sets) || 5,
          tier: metadata.tier || 'starter',
          subscriptionId: session.subscription || null,
          subscriptionStatus: 'active',
          stripeCustomerId: session.customer || null,
          stripeSessionId: session.id,
          onboardingComplete: false,
          updatedAt: new Date().toISOString(),
        };

        // Check if user already exists
        const existingDoc = await db.collection('allowedUsers').doc(customerEmail).get();

        if (existingDoc.exists) {
          // Update existing record
          await db.collection('allowedUsers').doc(customerEmail).update(userProfile);
          console.log(`✅ Updated user with subscription: ${customerEmail}`);
        } else {
          // Create new record
          userProfile.createdAt = new Date().toISOString();
          await db.collection('allowedUsers').doc(customerEmail).set(userProfile);
          console.log(`✅ Created new user with subscription: ${customerEmail}`);
        }

        // Update the application status if there's an applicationId
        if (metadata.applicationId) {
          const appRef = db.collection('applications').doc(metadata.applicationId);
          const appDoc = await appRef.get();
          if (appDoc.exists) {
            await appRef.update({
              status: 'approved',
              paidAt: new Date().toISOString(),
              stripeSessionId: session.id,
            });
            console.log(`✅ Updated application to approved+paid: ${metadata.applicationId}`);
          }
        }

        // Send welcome email
        await sendNotificationEmail(
          customerEmail,
          'Welcome to StickToMusic!',
          `
            <h2>Welcome aboard, ${customerName}!</h2>
            <p>Your payment is confirmed. You now have access to ${userProfile.socialSetsAllowed} Social Sets on the ${userProfile.tier} plan.</p>
            <p>Sign in at <a href="https://sticktomusic.com">StickToMusic</a> to get started.</p>
          `
        );
      } catch (error) {
        console.error('Error processing checkout:', error);
        return res.status(500).json({ error: 'Failed to process checkout' });
      }
    }
  }

  // Handle subscription updates (upgrade/downgrade)
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const customerEmail = subscription.metadata?.email;

    if (customerEmail) {
      try {
        await db.collection('allowedUsers').doc(customerEmail.toLowerCase()).update({
          subscriptionStatus: subscription.status,
          updatedAt: new Date().toISOString(),
        });
        console.log(`✅ Updated subscription status for ${customerEmail}: ${subscription.status}`);
      } catch (err) {
        console.warn('Could not update subscription status:', err);
      }
    }
  }

  // Handle subscription cancellation
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerEmail = subscription.metadata?.email;

    if (customerEmail) {
      try {
        await db.collection('allowedUsers').doc(customerEmail.toLowerCase()).update({
          subscriptionStatus: 'cancelled',
          socialSetsAllowed: 0,
          updatedAt: new Date().toISOString(),
        });
        console.log(`✅ Cancelled subscription for ${customerEmail}`);

        await sendNotificationEmail(
          customerEmail,
          'StickToMusic Subscription Cancelled',
          `
            <p>Hi,</p>
            <p>Your StickToMusic subscription has been cancelled. Your access will remain active until the end of your current billing period.</p>
            <p>If you'd like to resubscribe, visit <a href="https://sticktomusic.com">StickToMusic</a>.</p>
          `
        );
      } catch (err) {
        console.warn('Could not process cancellation:', err);
      }
    }
  }

  // Handle payment_intent.succeeded (informational)
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log(`💰 Payment succeeded: ${paymentIntent.id}`);
  }

  // Handle invoice payment failure
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const customerEmail = invoice.customer_email;
    console.warn(`⚠️ Invoice payment failed for ${customerEmail}: ${invoice.id}`);

    if (customerEmail && db) {
      try {
        await db.collection('allowedUsers').doc(customerEmail.toLowerCase()).update({
          subscriptionStatus: 'past_due',
          updatedAt: new Date().toISOString(),
        });

        await sendNotificationEmail(
          customerEmail,
          'StickToMusic Payment Failed',
          `
            <p>Hi,</p>
            <p>We were unable to process your payment. Please update your payment method to avoid service interruption.</p>
            <p>Visit <a href="https://sticktomusic.com">StickToMusic</a> to update your billing info.</p>
          `
        );
      } catch (err) {
        console.warn('Could not process payment failure:', err);
      }
    }
  }

  // Handle charge refunded
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const customerEmail = charge.metadata?.email || charge.billing_details?.email;
    console.log(`💸 Charge refunded: ${charge.id} for ${customerEmail}`);

    if (customerEmail && db) {
      try {
        await db.collection('allowedUsers').doc(customerEmail.toLowerCase()).update({
          subscriptionStatus: 'refunded',
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('Could not process refund:', err);
      }
    }
  }

  res.status(200).json({ received: true });
}
