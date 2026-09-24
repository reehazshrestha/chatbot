// Vercel serverless function: streaming chat proxy.
// Mirrors the local server.js behavior (SSE passthrough to the upstream API).
'use strict';

const https = require('https');

const UPSTREAM = process.env.UPSTREAM || 'https://gemini-web2api-one.vercel.app';

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
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
      { method: 'POST', headers, timeout: 120000 },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, {
          'Content-Type': upstreamRes.headers['content-type'] || 'text/event-stream',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });
        upstreamRes.pipe(res); // stream SSE chunks straight through
        upstreamRes.on('end', resolve);
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
};
