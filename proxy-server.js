import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = process.env.PORT || 3001;
const LOVABLE_URL = process.env.LOVABLE_URL;

if (!LOVABLE_URL) {
  console.error('LOVABLE_URL required');
  process.exit(1);
}

const PROXY_HOST = 'godrivingapp.com';

app.get('/api/hostname', (req, res) => {
  const originalHost = req.headers.host || '';
  res.json({
    hostname: originalHost,
    subdomain: extractSubdomain(originalHost)
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', proxy: LOVABLE_URL, timestamp: new Date().toISOString() });
});

app.use('/', createProxyMiddleware({
  target: LOVABLE_URL,
  changeOrigin: true,
  ws: true,
  secure: true,
  onProxyReq: (proxyReq, req) => {
    const originalHost = req.headers.host || '';
    proxyReq.setHeader('Host', PROXY_HOST);
    proxyReq.setHeader('X-Original-Host', originalHost);
    proxyReq.setHeader('X-Forwarded-Host', originalHost);
    proxyReq.setHeader('X-Forwarded-Proto', 'https');
    proxyReq.removeHeader('x-forwarded-for');
    console.log(`[PROXY] ${originalHost}${req.url} -> ${PROXY_HOST}${req.url}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    const originalHost = req.headers.host || '';
    if (proxyRes.headers.location) {
      const originalLocation = proxyRes.headers.location;
      let newLocation = originalLocation;
      if (originalHost.includes('.godrivingapp.com')) {
        newLocation = newLocation.replace(/https?:\/\/godrivingapp\.com/g, `https://${originalHost}`);
      }
      newLocation = newLocation.replace(/https?:\/\/pdf-peek-project\.lovable\.app/g, `https://${originalHost}`);
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
