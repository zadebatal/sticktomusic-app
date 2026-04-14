/**
 * Vercel Serverless Function: Late.co Webhook Handler
 * URL: https://sticktomusic.com/api/webhooks/late
 *
 * Receives webhook notifications from Late.co when posts are published.
 * Updates scheduledPosts status from SCHEDULED → POSTED.
 *
 * Expected webhook payload:
 * {
 *   "event": "post.published",
 *   "post_id": "late_post_id",
 *   "published_at": "2024-02-14T15:30:00Z",
 *   "platforms": {
 *     "instagram": { "success": true, "url": "https://...", "error": null },
 *     "tiktok": { "success": false, "url": null, "error": "Rate limited" }
 *   }
 * }
 */

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

/**
 * Find post by Late post ID across all artists
 */
async function findPostByLateId(latePostId) {
  try {
    // Query all artists' scheduledPosts for this latePostId
    const artistsSnapshot = await db.collection('artists').get();

    for (const artistDoc of artistsSnapshot.docs) {
      const artistId = artistDoc.id;
      const postsSnapshot = await db
        .collection('artists')
        .doc(artistId)
        .collection('scheduledPosts')
        .where('latePostId', '==', latePostId)
        .limit(1)
        .get();

      if (!postsSnapshot.empty) {
        const postDoc = postsSnapshot.docs[0];
        return {
          artistId,
          postId: postDoc.id,
          post: postDoc.data()
        };
      }
    }

    return null;
  } catch (error) {
    console.error('[Late Webhook] Error finding post:', error);
    return null;
  }
}

/**
 * Update post status to POSTED
 */
async function markPostPublished(artistId, postId, publishedAt, platformResults) {
  try {
    const postRef = db
      .collection('artists')
      .doc(artistId)
      .collection('scheduledPosts')
      .doc(postId);

    const allSucceeded = Object.values(platformResults || {}).every(r => r.success);
    const status = allSucceeded ? 'posted' : 'failed';

    await postRef.update({
      status,
      postedAt: publishedAt || new Date().toISOString(),
      postResults: platformResults || {},
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: new Date()
    });

    console.log(`[Late Webhook] Updated post ${postId} to status: ${status}`);
    return true;
  } catch (error) {
    console.error('[Late Webhook] Error updating post:', error);
    return false;
  }
}

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook secret (shared secret passed as query param or header)
  const webhookSecret = process.env.LATE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Late Webhook] LATE_WEBHOOK_SECRET not configured — rejecting all requests');
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  const providedSecret = req.query.secret || req.headers['x-webhook-secret'];
  if (providedSecret !== webhookSecret) {
    console.warn('[Late Webhook] Invalid or missing webhook secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { event, post_id, published_at, platforms } = req.body;

    console.log('[Late Webhook] Received event:', event, 'for post:', post_id);

    // Validate payload
    if (!event || !post_id) {
      console.warn('[Late Webhook] Invalid payload:', req.body);
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Handle post.published event
    if (event === 'post.published' || event === 'post.live') {
      // Find the post in our database
      const result = await findPostByLateId(post_id);

      if (!result) {
        console.warn('[Late Webhook] Post not found for Late ID:', post_id);
        return res.status(404).json({ error: 'Post not found' });
      }

      // Update post status to POSTED
      const updated = await markPostPublished(
        result.artistId,
        result.postId,
        published_at,
        platforms
      );

      if (updated) {
        return res.status(200).json({
          success: true,
          message: 'Post status updated',
          postId: result.postId
        });
      } else {
        return res.status(500).json({ error: 'Failed to update post' });
      }
    }

    // Handle post.failed event
    if (event === 'post.failed') {
      const result = await findPostByLateId(post_id);

      if (result) {
        const postRef = db
          .collection('artists')
          .doc(result.artistId)
          .collection('scheduledPosts')
          .doc(result.postId);

        await postRef.update({
          status: 'failed',
          postResults: platforms || {},
          updatedAt: new Date().toISOString()
        });
      }

      return res.status(200).json({ success: true });
    }

    // Unknown event type
    console.log('[Late Webhook] Unknown event type:', event);
    return res.status(200).json({ success: true, message: 'Event ignored' });

  } catch (error) {
    console.error('[Late Webhook] Handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
