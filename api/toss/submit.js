// POST /api/toss/submit { token, pid, name, levels:[best score per level, 0 = not cleared], stars }
//   -> { rank, total, players, top:[10 rows], around:[rows near the player] }      row = { rank, name, total, lv, me? }
// Ranking = TOTAL = sum of the player's best score on each level. One row per player (pid), only ever raised.
// Checks: signed single-use token from start.js (<= 12 h old), pid format, clean name, <= LEVELS (16) levels cleared in order,
// every level score an integer within that level's cap, >= 6 s of real time per newly cleared level, per-IP rate limits
// (40 submits / hour, 30 new players / day).
const { redis, pipe, readToken, allow, cors, ready, cleanName, rows, around, body, checkLevels,
  BOARD, PLAYERS, MAX_PLAYERS, TOKEN_MAX_AGE, SEC_PER_LEVEL, LEVEL_CAP, LEVELS, PID_OK } = require('./_lib');

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'method' });
  if (!ready()) return res.status(503).json({ error:'offline' });
  try {
    const b = body(req);
    const tok = readToken(b.token); if (!tok) return res.status(400).json({ error:'token' });
    const elapsed = (Date.now() - tok.iat)/1000;
    if (elapsed < 0 || elapsed > TOKEN_MAX_AGE) return res.status(400).json({ error:'token' });
    const pid = String(b.pid || ''); if (!PID_OK.test(pid)) return res.status(400).json({ error:'pid' });
    const name = cleanName(b.name); if (!name) return res.status(400).json({ error:'name' });

    const chk = checkLevels(b.levels, b.stars); if (chk.error) return res.status(400).json({ error:chk.error });
    const { total, cleared, stars } = chk;

    if (!await allow('submit', req, 40)) return res.status(429).json({ error:'slow down' });

    // real time: 6 s for every level cleared since this player's last accepted submit (2 s for a mere rename)
    const [oldScore, oldMeta] = await pipe([['ZSCORE', BOARD, pid], ['HGET', PLAYERS, pid]]);
    let old = {}; try { old = JSON.parse(oldMeta) || {}; } catch(e){}
    const before = oldScore == null ? 0 : Number(oldScore);
    const need = total > before ? SEC_PER_LEVEL*Math.max(1, cleared - (Number(old.lv) || 0)) : 2;
    if (elapsed < need) return res.status(400).json({ error:'clock', wait:Math.ceil(need - elapsed) });
    // at most 30 brand-new board rows per IP per day (a script cannot flood the board with fresh player ids;
    // an office sharing one IP still fits)
    if (oldScore == null && !await allow('new', req, 30, 86400)) return res.status(429).json({ error:'slow down' });

    // every token counts once
    const fresh = await redis('SET', 'toss:used:' + tok.n, '1', 'NX', 'EX', TOKEN_MAX_AGE + 600);
    if (fresh !== 'OK') return res.status(400).json({ error:'used' });

    await redis('ZADD', BOARD, 'GT', total, pid);            // GT: adds new players, never lowers an existing total
    const meta = total >= before ? { name, lv:cleared, stars, d:new Date().toISOString().slice(0, 10) }
                                 : { ...old, name };         // lower total re-sent (e.g. another device): only the name changes
    await redis('HSET', PLAYERS, pid, JSON.stringify(meta));

    let players = await redis('ZCARD', BOARD);
    if (players > MAX_PLAYERS){                              // trim the lowest totals (and their names)
      const out = await redis('ZRANGE', BOARD, 0, players - MAX_PLAYERS - 1);
      if (out && out.length){ await redis('ZREM', BOARD, ...out); await redis('HDEL', PLAYERS, ...out); players -= out.length; }
    }
    const [rank0, score] = await pipe([['ZREVRANK', BOARD, pid], ['ZSCORE', BOARD, pid]]);
    if (rank0 == null) return res.status(200).json({ rank:null, total, players, top:await rows(0, 9, pid), around:[] });
    const [top, near] = await Promise.all([rows(0, 9, pid), around(rank0, pid)]);
    res.status(200).json({ rank:rank0 + 1, total:Number(score), players, top, around:near });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
