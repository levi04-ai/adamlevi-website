// GET /api/balfour/top -> { top: [{ name, char, kart, diff, d, time }] } (best 20 times)
const { redis, cors, ready, BOARD } = require('./_lib');

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!ready()) return res.status(503).json({ error:'offline' });
  try {
    const r = await redis('ZRANGE', BOARD, 0, 19, 'WITHSCORES');
    const top = [];
    for (let i=0;i<r.length;i+=2){ try { const e = JSON.parse(r[i]); delete e.n; top.push({ ...e, time:Number(r[i+1]) }); } catch(err){} }
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(200).json({ top });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
