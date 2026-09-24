// Vercel serverless function: image generation via Pollinations (free, keyless).
// Returns JSON { url } the browser loads directly.
'use strict';

const IMAGE_BASE = process.env.IMAGE_API || 'https://image.pollinations.ai/prompt';

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
    }

    const chunks = await new Promise((resolve, reject) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => resolve(parts));
      req.on('error', reject);
    });

    let prompt = '';
    let width = 1024;
    let height = 1024;
    try {
      const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      prompt = String(j.prompt || '').trim();
      width = Math.min(Math.max(parseInt(j.width, 10) || 1024, 256), 2048);
      height = Math.min(Math.max(parseInt(j.height, 10) || 1024, 256), 2048);
    } catch {}

    if (!prompt) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: { message: 'Missing prompt' } }));
    }

    const seed = Math.floor(Math.random() * 1e9);
    const qs = 'width=' + width + '&height=' + height + '&seed=' + seed + '&nologo=true';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ url: IMAGE_BASE + '/' + encodeURIComponent(prompt) + '?' + qs }));
  } catch (e) {
    // Never let an exception escape — Vercel turns that into a bare
    // 500 FUNCTION_INVOCATION_FAILED page.
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { message: 'Image proxy error: ' + (e && e.message) } }));
    } else {
      res.end();
    }
  }
};
