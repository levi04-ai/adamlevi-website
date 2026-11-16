// POST /api/toss/start -> { token }: a signed, single-use token. submit.js only accepts a score when enough real
// time has passed since the token was signed (the game asks for one when the page opens and after every submit).
const { makeToken, allow, cors, ready } = require('./_lib');

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'method' });
  if (!ready()) return res.status(503).json({ error:'offline' });
  try {
    if (!await allow('start', req, 120)) return res.status(429).json({ error:'slow down' });
    res.status(200).json({ token:makeToken() });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
