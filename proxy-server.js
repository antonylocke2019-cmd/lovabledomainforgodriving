import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = process.env.PORT || 3001;
const LOVABLE_URL = process.env.LOVABLE_URL;

if (!LOVABLE_URL) {
  console.error('LOVABLE_URL required');
  process.exit(1);
}

app.use('/', createProxyMiddleware({
  target: LOVABLE_URL,
  changeOrigin: true,
  ws: true,
  secure: true,
  headers: {
    'X-Forwarded-Proto': 'https'
  },
  onProxyReq: (proxyReq, req) => {
    proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
  }
}));

app.listen(PORT, () => {
  console.log(`Proxy running on ${PORT} -> ${LOVABLE_URL}`);
});
