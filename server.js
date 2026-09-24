// Apple UI Design System – Verified: 8pt Grid, SF Pro Typography, Material-Depth, Natural Spring Motion
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const UPSTREAM = process.env.UPSTREAM || 'https://gemini-web2api-one.vercel.app';
const IMAGE_BASE = process.env.IMAGE_API || 'https://image.pollinations.ai/prompt'; // keyless text→image

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function pipeUpstream(req, res, method, upstreamPath, body, isChat) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': isChat ? 'text/event-stream' : 'application/json',
  };
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  // Optional user-supplied key (upstream currently needs none)
  if (req.headers['x-api-key']) headers['Authorization'] = 'Bearer ' + req.headers['x-api-key'];

  const upstreamReq = https.request(
    UPSTREAM + upstreamPath,
    { method, headers, timeout: 120000 },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, {
        'Content-Type': upstreamRes.headers['content-type'] || (isChat ? 'text/event-stream' : 'application/json'),
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      upstreamRes.pipe(res); // streams SSE chunks straight through
    }
  );

  upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('upstream timeout')));
  upstreamReq.on('error', (e) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: { message: 'Upstream error: ' + e.message } });
    } else {
      res.end();
    }
  });

  if (body) upstreamReq.write(body);
  upstreamReq.end();
}

// Image generation via Pollinations (free, no API key).
// GET /api/image?prompt=...&width=...&height=... → JSON { url } with a seeded,
// deterministic Pollinations URL the browser can load directly.
function pollinationsUrl(prompt, width, height) {
  const seed = Math.floor(Math.random() * 1e9);
  const qs = 'width=' + width + '&height=' + height + '&seed=' + seed + '&nologo=true';
  return IMAGE_BASE + '/' + encodeURIComponent(prompt) + '?' + qs;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (pathname === '/healthz') return send(res, 200, 'ok');

  // Model list passthrough
  if (pathname === '/api/models' && req.method === 'GET') {
    return pipeUpstream(req, res, 'GET', '/v1/models', null, false);
  }

  // Chat completions streaming proxy
  if (pathname === '/api/chat' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => pipeUpstream(req, res, 'POST', '/v1/chat/completions', Buffer.concat(chunks).toString('utf8'), true));
    req.on('error', () => sendJson(res, 400, { error: { message: 'Bad request body' } }));
    return;
  }

  // Image generation (Pollinations — free, keyless)
  if (pathname === '/api/image' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let prompt = '';
      let width = 1024;
      let height = 1024;
      try {
        const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        prompt = String(j.prompt || '').trim();
        width = Math.min(Math.max(parseInt(j.width, 10) || 1024, 256), 2048);
        height = Math.min(Math.max(parseInt(j.height, 10) || 1024, 256), 2048);
      } catch {}
      if (!prompt) return sendJson(res, 400, { error: { message: 'Missing prompt' } });
      sendJson(res, 200, { url: pollinationsUrl(prompt, width, height) });
    });
    req.on('error', () => sendJson(res, 400, { error: { message: 'Bad request body' } }));
    return;
  }

  // Static files from the repo root (same layout as the Vercel deployment)
  let rel = pathname === '/' ? '/index.html' : pathname;
  const publicRoot = __dirname;
  const filePath = path.join(publicRoot, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
  if (!filePath.startsWith(publicRoot)) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not Found');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  BEN is running');
  console.log('  ➜  http://localhost:' + PORT);
  console.log('  ➜  Upstream API: ' + UPSTREAM);
  console.log('');
});
