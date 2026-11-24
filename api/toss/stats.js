// GET /api/toss/stats -> aggregates only (never names or player ids):
// { players, byLevel:{"0":n..}, byStars:{ avg, max, buckets:{"0":n,"1-10":n,...} }, byDate:{"YYYY-MM-DD":n}, generated }
const { redis, cors, ready, PLAYERS, LEVELS } = require('./_lib');

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error:'method' });
  if (!ready()) return res.status(503).json({ error:'offline' });
  try {
    const flat = await redis('HGETALL', PLAYERS) || [];   // [pid, json, pid, json, ...]
    const byLevel = {}, byDate = {}, buckets = { '0':0, '1-10':0, '11-20':0, '21-33':0, '34+':0 };
    let players = 0, bad = 0, starSum = 0, starMax = 0;
    for (let i = 1; i < flat.length; i += 2){
      let p; try { p = JSON.parse(flat[i]); } catch(e){ p = null; }
      if (!p || typeof p !== 'object'){ bad++; continue; }
      players++;
      const lv = Math.max(0, Math.floor(Number(p.lv) || 0)); byLevel[lv] = (byLevel[lv] || 0) + 1;
      const st = Math.max(0, Math.floor(Number(p.stars) || 0)); starSum += st; if (st > starMax) starMax = st;
      buckets[st === 0 ? '0' : st <= 10 ? '1-10' : st <= 20 ? '11-20' : st <= 33 ? '21-33' : '34+']++;
      const d = typeof p.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.d) ? p.d : 'unknown'; byDate[d] = (byDate[d] || 0) + 1;
    }
    for (let l = 0; l <= LEVELS; l++) if (!(l in byLevel)) byLevel[l] = 0;
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ players, byLevel, byStars:{ avg: players ? Math.round(starSum / players * 100) / 100 : 0, max:starMax, buckets },
      byDate:Object.fromEntries(Object.entries(byDate).sort()), skipped:bad, generated:new Date().toISOString() });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
