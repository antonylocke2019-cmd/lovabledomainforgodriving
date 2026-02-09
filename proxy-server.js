import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = process.env.PORT || 3001;
const LOVABLE_URL = process.env.LOVABLE_URL;

if (!LOVABLE_URL) {
  console.error('LOVABLE_URL required');
  process.exit(1);
}

// Use the CUSTOM DOMAIN as the host, not the lovable.app domain
// CloudFront (Lovable's CDN) accepts godrivingapp.com but blocks
// direct requests to pdf-peek-project.lovable.app from non-browser sources
const PROXY_HOST = 'godrivingapp.com';

// Endpoint for the app to detect the original hostname/subdomain
app.get('/api/hostname', (req, res) => {
  const originalHost = req.headers.host || '';
  res.json({
    hostname: originalHost,
    subdomain: extractSubdomain(originalHost)
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', proxy: LOVABLE_URL, timestamp: new Date().toISOString() });
});

// Proxy all other requests to Lovable
app.use('/', createProxyMiddleware({
  target: LOVABLE_URL,
  changeOrigin: true,
  ws: true,
  secure: true,
  onProxyReq: (proxyReq, req) => {
    const originalHost = req.headers.host || '';

    // Set Host to godrivingapp.com - CloudFront recognizes this
    // as a valid custom domain and serves the app
    proxyReq.setHeader('Host', PROXY_HOST);

    // Preserve original hostname for subdomain detection
    proxyReq.setHeader('X-Original-Host', originalHost);
    proxyReq.setHeader('X-Forwarded-Host', originalHost);
    proxyReq.setHeader('X-Forwarded-Proto', 'https');

    // Remove headers that might trigger CloudFront blocking
    proxyReq.removeHeader('x-forwarded-for');

    console.log(`[PROXY] ${originalHost}${req.url} -> ${PROXY_HOST}${req.url}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    const originalHost = req.headers.host || '';

    // Rewrite any redirect Location headers to stay on the subdomain
    if (proxyRes.headers.location) {
      const originalLocation = proxyRes.headers.location;
      let newLocation = originalLocation;

      // If Lovable redirects to godrivingapp.com, rewrite to original subdomain
      if (originalHost.includes('.godrivingapp.com')) {
        newLocation = newLocation.replace(
          /https?:\/\/godrivingapp\.com/g,
          `https://${originalHost}`
        );
      }

      // Also catch lovable.app redirects
      newLocation = newLocation.replace(
        /https?:\/\/pdf-peek-project\.lovable\.app/g,
        `https://${originalHost}`
      );

      if (newLocation !== originalLocation) {
        proxyRes.headers.location = newLocation;
        console.log(`[REDIRECT REWRITE] ${originalLocation} -> ${newLocation}`);
      }
    }
  },
  onError: (err, req, res) => {
    console.error(`[PROXY ERROR] ${req.headers.host}${req.url}:`, err.message);
    res.status(502).json({
      error: 'Proxy error',
      message: 'Unable to reach the application server',
      host: req.headers.host,
      url: req.url
    });
  }
}));

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
  console.log(`Proxy running on ${PORT} -> ${LOVABLE_URL}`);
  console.log(`Host header set to: ${PROXY_HOST}`);
  console.log(`Hostname API available at /api/hostname`);
});
