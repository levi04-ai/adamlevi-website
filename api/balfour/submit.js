// POST /api/balfour/submit { token, name, time, laps, char, kart, diff } -> { rank }
// Checks: signed one-time token from start.js, the race time fits the real elapsed time, lap times add up and are
// physically possible on this track, sane name/candidate, and a per-IP rate limit. Only then is the score stored.
const { redis, readToken, ip, cors, ready, BOARD } = require('./_lib');

const CHARS = ['bibi', 'yaniv', 'feiglin', 'eisenkot', 'golan'];
const KARTS = ['red', 'blue', 'orange', 'yellow', 'limo'];
const LAPS = 2, MIN_LAP = 26, MAX_TIME = 600;   // the best autopilot lap is ~38 s; 26 s leaves room for great drivers
const NAME_OK = /^[\p{L}\p{N} ._'-]{2,16}$/u;

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'method' });
  if (!ready()) return res.status(503).json({ error:'offline' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const tok = readToken(b.token); if (!tok) return res.status(400).json({ error:'token' });
    const time = Number(b.time), laps = Array.isArray(b.laps) ? b.laps.map(Number) : [];
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    if (!NAME_OK.test(name)) return res.status(400).json({ error:'name' });
    if (!CHARS.includes(b.char) || !KARTS.includes(b.kart) || ![0, 1, 2].includes(Number(b.diff))) return res.status(400).json({ error:'pick' });
    if (!(time >= LAPS*MIN_LAP && time <= MAX_TIME)) return res.status(400).json({ error:'time' });
    if (laps.length !== LAPS || laps.some(l => !(l >= MIN_LAP && l <= MAX_TIME)) || Math.abs(laps.reduce((a, c) => a + c, 0) - time) > 0.6) return res.status(400).json({ error:'laps' });
    // the race cannot have taken longer than the real time since it started (fly-in and countdown add ~4 s)
    const elapsed = (Date.now() - tok.iat)/1000;
    if (elapsed < time + 3 || elapsed > 3600) return res.status(400).json({ error:'clock' });
    // every token counts once
    const fresh = await redis('SET', 'balfour:used:' + tok.n, '1', 'NX', 'EX', 7200);
    if (fresh !== 'OK') return res.status(400).json({ error:'used' });
    const rl = 'balfour:rl:submit:' + ip(req), n = await redis('INCR', rl);
    if (n === 1) await redis('EXPIRE', rl, 3600);
    if (n > 30) return res.status(429).json({ error:'slow down' });
    const entry = JSON.stringify({ name, char:b.char, kart:b.kart, diff:Number(b.diff), d:new Date().toISOString().slice(0, 10), n:tok.n });
    await redis('ZADD', BOARD, time.toFixed(2), entry);
    await redis('ZREMRANGEBYRANK', BOARD, 200, -1);   // keep the best 200
    const rank = await redis('ZRANK', BOARD, entry);
    res.status(200).json({ rank:rank == null ? null : rank + 1 });
  } catch(e){ res.status(500).json({ error:'server' }); }
};
