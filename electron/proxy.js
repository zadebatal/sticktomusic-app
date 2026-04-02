/**
 * Local API proxy — forwards /api/* requests to the live Vercel deployment.
 * Uses manual fetch-based proxying to avoid http-proxy-middleware issues
 * with Vercel's SPA routing and custom domains.
 */

const express = require('express');

const VERCEL_TARGET = 'https://sticktomusic.com';
const PORT = 3001;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Manual proxy for all /api/* requests
app.all('/api/*', async (req, res) => {
  const targetUrl = `${VERCEL_TARGET}${req.originalUrl}`;

  try {
    // Build headers — forward auth but override origin for CORS
    const headers = {
      'Origin': 'https://sticktomusic.com',
      'Referer': 'https://sticktomusic.com/',
      'Accept': 'application/json',
    };
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }

    const fetchOptions = {
      method: req.method,
      headers,
    };

    // Include body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Forward CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();

    res.status(response.status);
    if (contentType.includes('json')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.send(body);
  } catch (err) {
    console.error(`[proxy] Error proxying ${req.method} ${req.originalUrl}:`, err.message);
    res.status(502).json({ error: 'Proxy error: ' + err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', target: VERCEL_TARGET });
});

app.listen(PORT, () => {
  console.log(`[proxy] API proxy running on http://localhost:${PORT}`);
  console.log(`[proxy] Forwarding /api/* → ${VERCEL_TARGET}/api/*`);
});
