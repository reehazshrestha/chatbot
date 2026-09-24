// Vercel serverless function: model list passthrough.
'use strict';

const https = require('https');

const UPSTREAM = process.env.UPSTREAM || 'https://gemini-web2api-one.vercel.app';

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  await new Promise((resolve) => {
    const upstreamReq = https.request(
      UPSTREAM + '/v1/models',
      { method: 'GET', headers: { Accept: 'application/json' }, timeout: 30000 },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, {
          'Content-Type': upstreamRes.headers['content-type'] || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        upstreamRes.pipe(res);
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

    upstreamReq.end();
  });
};
