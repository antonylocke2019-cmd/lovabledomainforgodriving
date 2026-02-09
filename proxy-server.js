import express from 'express';
import fetch from 'node-fetch';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = process.env.PORT || 3001;
const LOVABLE_URL = process.env.LOVABLE_URL || 'https://godrivingapp.com';

// ============================================
// HTML CACHE - Auto-refreshes every 60 seconds
// ============================================
let cachedHTML = null;
let cacheTime = 0;
const CACHE_DURATION = 60 * 1000; // 60 seconds (short cache for faster updates)

async function fetchMainHTML() {
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
      const newHTML = await response.text();
      // Only update if content actually changed
      if (newHTML !== cachedHTML) {
        console.log('[FETCH] HTML updated - new version detected');
      }
      cachedHTML = newHTML;
      cacheTime = Date.now();
      console.log('[FETCH] HTML cached successfully');
    } else {
      console.error(`[FETCH] Failed: ${response.status}`);
    }
  } catch (err) {
    console.error('[FETCH] Error:', err.message);
  }

  return cachedHTML;
}

async function getHTML() {
  const now = Date.now();
  if (!cachedHTML || (now - cacheTime) > CACHE_DURATION) {
    await fetchMainHTML();
  }
  return cachedHTML;
}

// Pre-fetch on startup
fetchMainHTML();

// Auto-refresh cache every 60 seconds in the background
setInterval(() => {
  fetchMainHTML();
}, CACHE_DURATION);

// ============================================
// API ENDPOINTS
// ============================================

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
    cacheAge: cachedHTML ? Math.round((Date.now() - cacheTime) / 1000) + 's' : 'none',
    timestamp: new Date().toISOString()
  });
});

// Manual cache clear - can be called by Lovable webhook or manually
app.get('/api/cache-clear', async (req, res) => {
  console.log('[CACHE] Manual cache clear requested');
  cachedHTML = null;
  cacheTime = 0;
  await fetchMainHTML();
  res.json({
    status: 'cache cleared and refreshed',
    timestamp: new Date().toISOString()
  });
});

// Webhook endpoint for Lovable deploy notifications
app.post('/api/webhook/deploy', express.json(), async (req, res) => {
  console.log('[WEBHOOK] Deploy notification received, clearing cache...');
  cachedHTML = null;
  cacheTime = 0;
  await fetchMainHTML();
  console.log('[WEBHOOK] Cache refreshed with new deployment');
  res.json({ status: 'cache refreshed' });
});

// ============================================
// PROXY ROUTES - Must be BEFORE the catch-all
// ============================================

// Helper: create a standard proxy to godrivingapp.com
function createGoDrivingProxy(pathName, extraOptions = {}) {
  return createProxyMiddleware({
    target: 'https://godrivingapp.com',
    changeOrigin: true,
    secure: true,
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader('Host', 'godrivingapp.com');
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      proxyReq.setHeader('Referer', 'https://godrivingapp.com/');
      if (pathName) {
        console.log(`[PROXY:${pathName}] ${req.method} ${req.url}`);
      }
    },
    ...extraOptions
  });
}

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
    if (proxyRes.headers.location) {
      const originalLocation = proxyRes.headers.location;
      let newLocation = originalLocation;

      // Keep Google/Apple OAuth redirects as-is (they go to external providers)
      // But rewrite any godrivingapp.com callbacks to stay on subdomain
      if (originalHost.includes('.godrivingapp.com') &&
          !newLocation.includes('accounts.google.com') &&
          !newLocation.includes('appleid.apple.com') &&
          !newLocation.includes('oauth.lovable.app')) {
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
app.use('/~api', createGoDrivingProxy('~api'));

// Analytics script
app.use('/~flock.js', createGoDrivingProxy('flock'));

// Static assets (JS, CSS, images, fonts)
app.use('/assets', createGoDrivingProxy('assets'));

// Supabase/REST API calls
app.use('/rest', createGoDrivingProxy('rest'));

// Auth callback routes
app.use('/auth', createProxyMiddleware({
  target: 'https://godrivingapp.com',
  changeOrigin: true,
  secure: true,
  onProxyReq: (proxyReq, req) => {
    proxyReq.setHeader('Host', 'godrivingapp.com');
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    console.log(`[AUTH] ${req.method} ${req.url}`);
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
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(404).send('Not found');
  }
});

// ============================================
// CATCH-ALL: Serve cached HTML for all pages
// Works for ANY subdomain automatically
// ============================================
app.get('*', async (req, res) => {
  const host = req.headers.host || '';
  const subdomain = extractSubdomain(host);

  console.log(`[PAGE] ${host}${req.url} (subdomain: ${subdomain || 'none'})`);

  const html = await getHTML();

  if (!html) {
    return res.status(503).send(`
      <html>
        <head><title>Loading...</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Service is starting up...</h1>
          <p>Please refresh in a few seconds.</p>
          <script>setTimeout(() => location.reload(), 3000);</script>
        </body>
      </html>
    `);
  }

  // Inject subdomain info into the HTML
  // This works for ANY school subdomain automatically
  const injectedHTML = html.replace(
    '</head>',
    `<meta name="x-subdomain" content="${subdomain || ''}" />
    <meta name="x-original-host" content="${host}" />
    <script>
      window.__SUBDOMAIN__ = "${subdomain || ''}";
      window.__ORIGINAL_HOST__ = "${host}";
      window.__IS_SUBDOMAIN__ = ${!!subdomain};
    </script>
    </head>`
  );

  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(injectedHTML);
});

// ============================================
// HELPERS
// ============================================
function extractSubdomain(hostname) {
  if (!hostname) return null;
  const host = hostname.split(':')[0];
  // Match ANY subdomain: {anything}.godrivingapp.com
  const match = host.match(/^([^.]+)\.godrivingapp\.com$/);
  if (match && match[1] !== 'www') {
    return match[1];
  }
  return null;
}

app.listen(PORT, () => {
  console.log('========================================');
  console.log(`  GoDriving Subdomain Proxy`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Source: godrivingapp.com`);
  console.log(`  Cache: ${CACHE_DURATION / 1000}s auto-refresh`);
  console.log(`  Endpoints:`);
  console.log(`    /api/hostname    - Subdomain detection`);
  console.log(`    /api/health      - Health check`);
  console.log(`    /api/cache-clear - Force cache refresh`);
  console.log(`    /api/webhook/deploy - Deploy webhook`);
  console.log('========================================');
});
