// POST /api/balfour/start -> { token }: issued when a race starts; submit.js only accepts a time that fits
// inside the real time elapsed since this token was signed.
const { makeToken, redis, ip, cors, ready } = require('./_lib');

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'method' });
  if (!ready()) return res.status(503).json({ error:'offline' });
  try {
    const n = await redis('INCR', 'balfour:rl:start:' + ip(req));
    if (n === 1) await redis('EXPIRE', 'balfour:rl:start:' + ip(req), 3600);
    if (n > 120) return res.status(429).json({ error:'slow down' });
    res.status(200).json({ token:makeToken() });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
