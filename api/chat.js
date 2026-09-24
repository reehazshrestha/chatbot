// Vercel serverless function: streaming chat proxy (SSE passthrough).
// Mirrors the local server.js behavior.
'use strict';

const https = require('https');

const UPSTREAM = process.env.UPSTREAM || 'https://gemini-web2api-one.vercel.app';

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

    // Buffer the request body with events — the most portable pattern across
    // Vercel runtimes (async-iteration on req is not reliable everywhere).
    const chunks = await new Promise((resolve, reject) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => resolve(parts));
      req.on('error', reject);
    });
    const body = Buffer.concat(chunks).toString('utf8');

    await new Promise((resolve) => {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (body) headers['Content-Length'] = Buffer.byteLength(body);
      // Optional user-supplied key (upstream currently needs none)
      const userKey = req.headers['x-api-key'];
      if (userKey) headers['Authorization'] = 'Bearer ' + userKey;

      const upstreamReq = https.request(
        UPSTREAM + '/v1/chat/completions',
        { method: 'POST', headers, timeout: 55000 },
        (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 502;
          res.setHeader('Content-Type', upstreamRes.headers['content-type'] || 'text/event-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Accel-Buffering', 'no');
          upstreamRes.pipe(res); // stream SSE chunks straight through; pipe ends res
          upstreamRes.on('error', resolve);
        }
      );

      upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('upstream timeout')));
      upstreamReq.on('error', (e) => {
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { message: 'Upstream error: ' + e.message } }));
        } else {
          res.end();
        }
        resolve();
      });

      if (body) upstreamReq.write(body);
      upstreamReq.end();
    });
  } catch (e) {
    // Never let an exception escape — Vercel turns that into a bare
    // 500 FUNCTION_INVOCATION_FAILED page.
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { message: 'Proxy error: ' + (e && e.message) } }));
    } else {
      res.end();
    }
  }
};
