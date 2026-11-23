// POST /api/smash/submit { token, pid, name, score, t, ko }
//   -> { rank, score, players, top:[10 rows], around:[rows near the player] }      row = { rank, name, score, me? }
// Only a FULL run (boss down) is submitted. Ranking = the player's best run score. One row per player (pid), only ever raised.
// Checks: signed single-use token from start.js (<= 12 h old), pid format, name (2-14 letters in any language / digits / space . _ -, TtB profanity filter),
// score an integer 1..20000, >= 45 s of real time since the token and <= 100 points per real second,
// reported fight time 25 s .. (real time + 5 s), KO count sane, per-IP rate limits (40 submits / hour, 30 new players / day).
const { redis, pipe, readToken, allow, cors, ready, cleanName, rows, around, body, P,
  BOARD, PLAYERS, MAX_PLAYERS, TOKEN_MAX_AGE, MAX_SCORE, MIN_RUN_SEC, MAX_PTS_PER_SEC, MIN_FIGHT_SEC, FIGHT_SLACK, MAX_FIGHT_SEC, MAX_KO, PID_OK } = require('./_lib');

const int = v => typeof v === 'number' && Number.isInteger(v);

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

    const score = b.score, t = b.t, ko = b.ko;
    if (!int(score) || score < 1 || score > MAX_SCORE) return res.status(400).json({ error:'score' });
    if (!int(t) || t < MIN_FIGHT_SEC || t > MAX_FIGHT_SEC) return res.status(400).json({ error:'time' });
    if (!int(ko) || ko < 1 || ko > MAX_KO) return res.status(400).json({ error:'ko' });

    if (!await allow('submit', req, 40)) return res.status(429).json({ error:'slow down' });

    // real time: a whole run since the token, enough seconds for the points, and the reported fight time must fit in it
    // (2 s for a mere rename / a lower score re-sent, like TtB)
    const [oldScore, oldMeta] = await pipe([['ZSCORE', BOARD, pid], ['HGET', PLAYERS, pid]]);
    let old = {}; try { old = JSON.parse(oldMeta) || {}; } catch(e){}
    const before = oldScore == null ? 0 : Number(oldScore);
    const need = score > before ? Math.max(MIN_RUN_SEC, Math.ceil(score / MAX_PTS_PER_SEC), t - FIGHT_SLACK) : 2;
    if (elapsed < need) return res.status(400).json({ error:'clock', wait:Math.ceil(need - elapsed) });
    // at most 30 brand-new board rows per IP per day (a script cannot flood the board with fresh player ids;
    // an office sharing one IP still fits)
    if (oldScore == null && !await allow('new', req, 30, 86400)) return res.status(429).json({ error:'slow down' });

    // every token counts once
    const fresh = await redis('SET', P + 'used:' + tok.n, '1', 'NX', 'EX', TOKEN_MAX_AGE + 600);
    if (fresh !== 'OK') return res.status(400).json({ error:'used' });

    await redis('ZADD', BOARD, 'GT', score, pid);            // GT: adds new players, never lowers an existing score
    const meta = score >= before ? { name, t, ko, d:new Date().toISOString().slice(0, 10) }
                                 : { ...old, name };         // lower score re-sent (e.g. another device): only the name changes
    await redis('HSET', PLAYERS, pid, JSON.stringify(meta));

    let players = await redis('ZCARD', BOARD);
    if (players > MAX_PLAYERS){                              // trim the lowest scores (and their names)
      const out = await redis('ZRANGE', BOARD, 0, players - MAX_PLAYERS - 1);
      if (out && out.length){ await redis('ZREM', BOARD, ...out); await redis('HDEL', PLAYERS, ...out); players -= out.length; }
    }
    const [rank0, best] = await pipe([['ZREVRANK', BOARD, pid], ['ZSCORE', BOARD, pid]]);
    if (rank0 == null) return res.status(200).json({ rank:null, score, players, top:await rows(0, 9, pid), around:[] });
    const [top, near] = await Promise.all([rows(0, 9, pid), around(rank0, pid)]);
    res.status(200).json({ rank:rank0 + 1, score:Number(best), players, top, around:near });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
