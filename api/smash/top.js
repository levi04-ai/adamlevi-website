// GET /api/smash/top?pid=...  -> { top:[10 rows { rank, name, score, me? }], players, me:{ rank, score, name } | null, around:[rows],
//                                  topTime:[10 rows { rank, name, t, me? }], timePlayers, timeRank, time,   (r73 FASTEST RUN, lowest t first)
//                                  rushTop:[10 rows { rank, name, ko, t, me? }], rushPlayers, rushRank, rushAround:[rows] }   (RUSH HOUR, most KOs first)
// Without a pid the answer is the same for everybody and is cached for a few seconds at the edge.
const { pipe, allow, cors, ready, rows, around, timeRows, rushRows, rushAround, BOARD, TIME, RUSH, PID_OK } = require('./_lib');

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
    const cmds = [['ZCARD', BOARD], ['ZCARD', TIME], ['ZCARD', RUSH]];
    if (pid) cmds.push(['ZREVRANK', BOARD, pid], ['ZSCORE', BOARD, pid], ['ZRANK', TIME, pid], ['ZSCORE', TIME, pid], ['ZREVRANK', RUSH, pid]);
    const [players, timePlayers, rushPlayers, rank0, score, tRank0, tBest, rRank0] = await pipe(cmds);
    const [top, topTime, rushTop, rushNear] = await Promise.all([rows(0, 9, pid), timeRows(0, 9, pid), rushRows(0, 9, pid),
      pid && rRank0 != null ? rushAround(rRank0, pid) : []]);
    let me = null, near = [];
    if (pid && rank0 != null){
      near = await around(rank0, pid);
      const mine = near.find(r => r.me) || {};
      me = { rank:rank0 + 1, score:Number(score), name:mine.name };
    }
    if (!pid) res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(200).json({ top, players:players || 0, me, around:near, topTime, timePlayers:timePlayers || 0,
      timeRank:pid && tRank0 != null ? tRank0 + 1 : null, time:pid && tBest != null ? Number(tBest) : null,
      rushTop, rushPlayers:rushPlayers || 0, rushRank:pid && rRank0 != null ? rRank0 + 1 : null, rushAround:rushNear });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
