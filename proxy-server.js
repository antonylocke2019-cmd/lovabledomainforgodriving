import express from 'express';
import fetch from 'node-fetch';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = process.env.PORT || 3001;
const LOVABLE_URL = process.env.LOVABLE_URL || 'https://godrivingapp.com';

let cachedHTML = null;
let cacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function fetchMainHTML() {
  const now = Date.now();
  if (cachedHTML && (now - cacheTime) < CACHE_DURATION) {
    return cachedHTML;
  }

  try {
    console.log('[FETCH] Getting fresh HTML from godrivingapp.com...');
    const response = await fetch('https://godrivingapp.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow'
    });

    if (response.ok) {
      cachedHTML = await response.text();
      cacheTime = now;
      console.log('[FETCH] HTML cached successfully');
    } else {
      console.error(`[FETCH] Failed: ${response.status}`);
    }
  } catch (err) {
    console.error('[FETCH] Error:', err.message);
  }

  return cachedHTML;
}

fetchMainHTML();

// Hostname detection API
app.get('/api/hostname', (req, res) => {
  const originalHost = req.headers.host || '';
  res.json({
    hostname: originalHost,
    subdomain: extractSubdomain(originalHost)
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    cached: !!cachedHTML,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// PROXY ROUTES - Must be BEFORE the catch-all
// ============================================

// Lovable OAuth routes (Google/Apple sign-in)
app.use('/~oauth', createProxyMiddleware({
  target: 'https://godrivingapp.com',
  changeOrigin: true,
  secure: true,
  followRedirects: false,
  onProxyReq: (proxyReq, req) => {
    proxyReq.setHeader('Host', 'godrivingapp.com');
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    proxyReq.setHeader('Referer', 'https://godrivingapp.com/');
    console.log(`[OAUTH] ${req.method} ${req.url}`);
  },
  onProxyRes: (proxyRes, req) => {
    const originalHost = req.headers.host || '';
    // Rewrite OAuth redirect URLs to stay on subdomain
    if (proxyRes.headers.location) {
      const originalLocation = proxyRes.headers.location;
      let newLocation = originalLocation;

      // Keep Google OAuth redirects as-is (they go to Google)
      // But rewrite any godrivingapp.com callbacks to subdomain
      if (originalHost.includes('.godrivingapp.com') && 
          !newLocation.includes('accounts.google.com') &&
          !newLocation.includes('appleid.apple.com')) {
        newLocation = newLocation.replace(
          /https?:\/\/godrivingapp\.com/g,
          `https://${originalHost}`
        );
      }

      if (newLocation !== originalLocation) {
        proxyRes.headers.location = newLocation;
        console.log(`[OAUTH REDIRECT] ${originalLocation} -> ${newLocation}`);
      }
    }
  }
}));

// Lovable internal API routes
app.use('/~api', createProxyMiddleware({
  target: 'https://godrivingapp.com',
  changeOrigin: true,
  secure: true,
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('Host', 'godrivingapp.com');
  }
}));

// Analytics script
app.use('/~flock.js', createProxyMiddleware({
  target: 'https://godrivingapp.com',
  changeOrigin: true,
  secure: true,
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('Host', 'godrivingapp.com');
  }
}));

// Static assets (JS, CSS, images)
app.use('/assets', createProxyMiddleware({
  target: 'https://godrivingapp.com',
  changeOrigin: true,
  secure: true,
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('Host', 'godrivingapp.com');
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    proxyReq.setHeader('Referer', 'https://godrivingapp.com/');
  }
}));

// Supabase/REST API calls
app.use('/rest', createProxyMiddleware({
  target: 'https://godrivingapp.com',
  changeOrigin: true,
  secure: true,
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('Host', 'godrivingapp.com');
  }
}));

// Auth callback routes
app.use('/auth', createProxyMiddleware({
  target: 'https://godrivingapp.com',
  changeOrigin: true,
  secure: true,
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('Host', 'godrivingapp.com');
  },
  onProxyRes: (proxyRes, req) => {
    const originalHost = req.headers.host || '';
    if (proxyRes.headers.location) {
      const originalLocation = proxyRes.headers.location;
      let newLocation = originalLocation;
      if (originalHost.includes('.godrivingapp.com')) {
        newLocation = newLocation.replace(
          /https?:\/\/godrivingapp\.com/g,
          `https://${originalHost}`
        );
      }
      if (newLocation !== originalLocation) {
        proxyRes.headers.location = newLocation;
        console.log(`[AUTH REDIRECT] ${originalLocation} -> ${newLocation}`);
      }
    }
  }
}));

// Favicon
app.get('/favicon.png', async (req, res) => {
  try {
    const response = await fetch('https://godrivingapp.com/favicon.png');
    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(404).send('Not found');
  }
});

// ============================================
// CATCH-ALL: Serve cached HTML for all pages
// ============================================
app.get('*', async (req, res) => {
  const host = req.headers.host || '';
  const subdomain = extractSubdomain(host);

  console.log(`[PAGE] ${host}${req.url} (subdomain: ${subdomain})`);

  const html = await fetchMainHTML();

  if (!html) {
    return res.status(503).send('Service temporarily unavailable. Please try again.');
  }

  const injectedHTML = html.replace(
    '</head>',
    `<meta name="x-subdomain" content="${subdomain || ''}" />
    <meta name="x-original-host" content="${host}" />
    <script>window.__SUBDOMAIN__="${subdomain || ''}";window.__ORIGINAL_HOST__="${host}";</script>
    </head>`
  );

  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'no-cache');
  res.send(injectedHTML);
});

function extractSubdomain(hostname) {
  if (!hostname) return null;
  const host = hostname.split(':')[0];
  const match = host.match(/^([^.]+)\.godrivingapp\.com$/);
  if (match && match[1] !== 'www') {
    return match[1];
  }
  return null;
}

app.listen(PORT, () => {
  console.log(`Proxy running on ${PORT}`);
  console.log(`Serving app from: godrivingapp.com`);
  console.log(`OAuth proxy: /~oauth -> godrivingapp.com`);
  console.log(`Hostname API: /api/hostname`);
});
