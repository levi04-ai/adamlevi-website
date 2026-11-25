// POST /api/smash/rush { token, pid, name, ko, t }
//   -> { rushRank, ko, rushPlayers, rushTop:[10 rows], rushAround:[rows near the player] }     row = { rank, name, ko, t, me? }
// RUSH HOUR board (smash:rush:v1): one row per player (pid) = the player's best run in KOs, only ever raised (ZADD GT).
// Same security as submit.js: the signed single-use token from start.js (<= 12 h old, ask for a fresh one when a rush run starts),
// pid format, name rules + profanity filter, CORS, per-IP rate limits (40 rush submits / hour, 30 new rush players / day).
// Sanity: ko an integer 1..2000, t (seconds survived) a number 10..3600 (floored), ko / t <= 3, t <= real seconds since the token + 5.
const { redis, pipe, readToken, allow, cors, ready, cleanName, body, P, RUSH, RUSHMETA, rushRows, rushAround,
  RUSH_MAX_KO, RUSH_MIN_SEC, RUSH_MAX_SEC, RUSH_MAX_KO_PER_SEC, MAX_PLAYERS, TOKEN_MAX_AGE, FIGHT_SLACK, PID_OK } = require('./_lib');

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

    const ko = b.ko, t = typeof b.t === 'number' && Number.isFinite(b.t) ? Math.floor(b.t) : NaN;
    if (typeof ko !== 'number' || !Number.isInteger(ko) || ko < 1 || ko > RUSH_MAX_KO) return res.status(400).json({ error:'ko' });
    if (!(t >= RUSH_MIN_SEC && t <= RUSH_MAX_SEC)) return res.status(400).json({ error:'time' });
    if (ko / t > RUSH_MAX_KO_PER_SEC) return res.status(400).json({ error:'ko' });

    if (!await allow('rush', req, 40)) return res.status(429).json({ error:'slow down' });
    // the survived time must fit in the real time since the token
    if (elapsed < t - FIGHT_SLACK) return res.status(400).json({ error:'clock', wait:Math.ceil(t - FIGHT_SLACK - elapsed) });

    const [oldKo, oldMeta] = await pipe([['ZSCORE', RUSH, pid], ['HGET', RUSHMETA, pid]]);
    let old = {}; try { old = JSON.parse(oldMeta) || {}; } catch(e){}
    if (oldKo == null && !await allow('rushnew', req, 30, 86400)) return res.status(429).json({ error:'slow down' });

    // every token counts once (shared with submit.js)
    const fresh = await redis('SET', P + 'used:' + tok.n, '1', 'NX', 'EX', TOKEN_MAX_AGE + 600);
    if (fresh !== 'OK') return res.status(400).json({ error:'used' });

    const before = oldKo == null ? 0 : Number(oldKo);
    await redis('ZADD', RUSH, 'GT', ko, pid);                 // GT: adds new players, never lowers an existing best
    const meta = ko >= before ? { name, ko, t, d:new Date().toISOString().slice(0, 10) } : { ...old, name };
    await redis('HSET', RUSHMETA, pid, JSON.stringify(meta));

    let rushPlayers = await redis('ZCARD', RUSH);
    if (rushPlayers > MAX_PLAYERS){                           // trim the lowest runs (and their names)
      const out = await redis('ZRANGE', RUSH, 0, rushPlayers - MAX_PLAYERS - 1);
      if (out && out.length){ await redis('ZREM', RUSH, ...out); await redis('HDEL', RUSHMETA, ...out); rushPlayers -= out.length; }
    }
    const [rank0, best] = await pipe([['ZREVRANK', RUSH, pid], ['ZSCORE', RUSH, pid]]);
    const [rushTop, near] = await Promise.all([rushRows(0, 9, pid), rank0 == null ? [] : rushAround(rank0, pid)]);
    res.status(200).json({ rushRank:rank0 == null ? null : rank0 + 1, ko:best == null ? ko : Number(best), rushPlayers, rushTop, rushAround:near });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
