import express from 'express';
   import { createProxyMiddleware } from 'http-proxy-middleware';

   const app = express();
   const PORT = process.env.PORT || 3001;
   const LOVABLE_URL = process.env.LOVABLE_URL;

   if (!LOVABLE_URL) {
     console.error('LOVABLE_URL environment variable is required');
     process.exit(1);
   }

   console.log(`🔄 Starting proxy server...`);
   console.log(`Target: ${LOVABLE_URL}`);

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
     console.log(`✅ Proxy running on port ${PORT}`);
     console.log(`📡 Forwarding to: ${LOVABLE_URL}`);
   });
```
   - Click **"Commit new file"**

4. **Third file - Create `.gitignore`:**
   - Click **"Add file"** → **"Create new file"**
   - Name the file: `.gitignore`
   - Paste this:
```
   node_modules/
   .env
   *.log
