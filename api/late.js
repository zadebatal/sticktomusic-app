/**
 * Vercel Serverless Function for Late API
 * This keeps the Late API key secure on the server side
 *
 * Environment variable required: LATE_API_KEY
 */

const LATE_API_BASE = 'https://getlate.dev/api/v1';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const LATE_API_KEY = process.env.LATE_API_KEY;

  if (!LATE_API_KEY) {
    return res.status(500).json({ error: 'Late API key not configured' });
  }

  const { action, postId, page = 1, ...body } = req.method === 'GET'
    ? req.query
    : { ...req.query, ...req.body };

  try {
    let response;

    switch (action) {
      case 'accounts':
        // GET /accounts - Fetch all connected accounts
        response = await fetch(`${LATE_API_BASE}/accounts`, {
          headers: { 'Authorization': `Bearer ${LATE_API_KEY}` }
        });
        break;

      case 'posts':
        if (req.method === 'GET') {
          // GET /posts - Fetch scheduled posts
          response = await fetch(`${LATE_API_BASE}/posts?page=${page}&limit=50`, {
            headers: { 'Authorization': `Bearer ${LATE_API_KEY}` }
          });
        } else if (req.method === 'POST') {
          // POST /posts - Create new scheduled post
          response = await fetch(`${LATE_API_BASE}/posts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LATE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          });
        }
        break;

      case 'delete':
        if (!postId) {
          return res.status(400).json({ error: 'postId required for delete' });
        }
        // DELETE /posts/:id - Delete a scheduled post
        response = await fetch(`${LATE_API_BASE}/posts/${postId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${LATE_API_KEY}` }
        });
        break;

      default:
        return res.status(400).json({ error: 'Invalid action. Use: accounts, posts, or delete' });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: errorData.error || errorData.message || `Late API error: ${response.status}`
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('Late API proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}
