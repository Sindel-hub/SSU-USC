"use strict";
const { getRuntime } = require('../server/runtime.cjs');
module.exports = async function announcementImage(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode=405;res.setHeader('Allow','GET, HEAD');return res.end(); }
  try {
    const key = new URL(req.url, 'https://localhost').searchParams.get('id');
    const image = await getRuntime().handlers.announcementPublishedImage(key);
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!match) throw Error('Invalid image');
    res.setHeader('Content-Type',match[1]);res.statusCode=200;
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(match[2],'base64'));
  } catch { res.statusCode=404;res.end(); }
};
