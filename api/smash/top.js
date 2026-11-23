// GET /api/smash/top?pid=...  -> { top:[10 rows { rank, name, score, me? }], players, me:{ rank, score, name } | null, around:[rows] }
// Without a pid the answer is the same for everybody and is cached for a few seconds at the edge.
const { pipe, allow, cors, ready, rows, around, BOARD, PID_OK } = require('./_lib');

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error:'method' });
  if (!ready()) return res.status(503).json({ error:'offline' });
  try {
    let pid = req.query && req.query.pid;
    if (pid === undefined){ try { pid = new URL(req.url, 'http://x').searchParams.get('pid'); } catch(e){} }
    pid = typeof pid === 'string' && PID_OK.test(pid) ? pid : null;
    if (pid && !await allow('top', req, 600)) return res.status(429).json({ error:'slow down' });
    const cmds = [['ZCARD', BOARD]]; if (pid) cmds.push(['ZREVRANK', BOARD, pid], ['ZSCORE', BOARD, pid]);
    const [players, rank0, score] = await pipe(cmds);
    const top = await rows(0, 9, pid);
    let me = null, near = [];
    if (pid && rank0 != null){
      near = await around(rank0, pid);
      const mine = near.find(r => r.me) || {};
      me = { rank:rank0 + 1, score:Number(score), name:mine.name };
    }
    if (!pid) res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(200).json({ top, players:players || 0, me, around:near });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
