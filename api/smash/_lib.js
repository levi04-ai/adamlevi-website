// Shared helpers for the Office Smash high-score board (Vercel functions + Upstash Redis REST).
// A copy of the Toss the Boss leaderboard (api/toss/_lib.js) with the same security: the browser never talks to the
// database, every score goes through submit.js, which checks a signed single-use token issued by start.js, the real
// time since that token, a score cap, a points-per-second cap, the run time, and per-IP rate limits.
//
// Storage (same Redis as TtB, its own keys - nothing here ever reads or writes a toss:* key):
//   smash:board:v1    sorted set   member = player id (pid), score = the player's BEST full-run score (floor 1 -> boss down)
//   smash:players:v1  hash         pid -> JSON { name (initials), t (fight seconds of that run), ko, d (date) }
// One row per player: re-submitting only ever raises the row (ZADD GT). Player ids never leave the server.
const crypto = require('crypto');

const RURL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
// own secret if set; otherwise the same fallback as TtB. Tokens are signed with a 'smash.' prefix, so a TtB token
// can never be used here (and the other way round) even when both games share one secret.
const SECRET = process.env.SMASH_SECRET || process.env.TOSS_SECRET || RTOK || '';
const P = 'smash:';
const BOARD = P + 'board:v1', PLAYERS = P + 'players:v1';
const MAX_PLAYERS = 20000;          // everyone keeps a rank; beyond this the lowest scores are trimmed
const TOKEN_MAX_AGE = 12*3600;      // seconds

// Score sanity for one full run (5 floors, floor 1 -> boss down). Honest runs are ~1,000-5,000 points today
// (smash points + speed bonus 2.5 / s under par, main.js floorEarnings). Cap with lots of headroom.
const MAX_SCORE = 20000;
// Real time: nobody clears 5 floors + the boss faster than this (bot 'great' runs fight ~11-17 s per floor, plus the
// walk / elevator / earnings screens between floors). Counted from the token (fetched when a new run starts).
const MIN_RUN_SEC = 45;
// ...and nobody earns more than this many points per real second over a whole run (5,000 points needs >= 50 s).
const MAX_PTS_PER_SEC = 100;
// Fight time the client reports (run stats 'Time' = sum of first-hit -> clear per floor): at least this much,
// and never more than the real time since the token (+ a little slack for clocks / the end-screen delay).
const MIN_FIGHT_SEC = 25, FIGHT_SLACK = 5, MAX_FIGHT_SEC = 3600;
const MAX_KO = 500;

const ready = () => !!(RURL && RTOK && SECRET);

async function call(path, body){
  const r = await fetch(RURL + path, { method:'POST', headers:{ Authorization:'Bearer ' + RTOK, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  return r.json();
}
async function redis(...cmd){ const j = await call('', cmd); if (j.error) throw new Error(j.error); return j.result; }
// several commands in one round trip -> array of results
async function pipe(cmds){
  const j = await call('/pipeline', cmds); if (!Array.isArray(j)) throw new Error(j && j.error || 'pipeline');
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const sign = payload => b64u(crypto.createHmac('sha256', SECRET).update('smash.' + payload).digest());

function makeToken(){
  const payload = b64u(JSON.stringify({ iat:Date.now(), n:crypto.randomBytes(9).toString('hex') }));
  return payload + '.' + sign(payload);
}
function readToken(tok){
  if (typeof tok !== 'string' || tok.length > 300) return null;
  const [payload, sig] = tok.split('.'); if (!payload || !sig) return null;
  const want = sign(payload);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const t = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); return t && typeof t.iat === 'number' && typeof t.n === 'string' ? t : null; } catch(e){ return null; }
}

const ip = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'x';
// per-IP counter: true while under the limit
async function allow(kind, req, max, windowSec){
  const k = P + 'rl:' + kind + ':' + ip(req), n = await redis('INCR', k);
  if (n === 1) await redis('EXPIRE', k, windowSec || 3600);
  return n <= max;
}

// same origins as TtB: adamlevi.net, the itch.io copy (*.itch.zone / *.itch.io) and CrazyGames (*.crazygames.com,
// capacitor://*.crazygames.com = their iOS app). CORS only stops other web pages from reading the answers; it is NOT the
// anti-cheat (curl ignores it) - that is the signed token, caps, clock and rate limits in submit.js.
const ORIGIN_OK = /^(https:\/\/((www\.)?adamlevi\.net|([a-z0-9-]+\.)*itch\.(zone|io)|([a-z0-9-]+\.)*crazygames\.com)|capacitor:\/\/([a-z0-9-]+\.)*crazygames\.com)$/;
function cors(req, res){
  const o = String(req.headers.origin || '');
  if (ORIGIN_OK.test(o)) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

const PID_OK = /^[0-9a-f]{16,32}$/;
// arcade initials: 1-3 characters A-Z / 0-9 (the game's box is 3 wide and upper-cases what you type)
const INI_OK = /^[A-Z0-9]{1,3}$/;
// light filter for 3-letter rude initials, matched after folding digit look-alikes (0->O 1->I 3->E 4->A 5->S)
const BAD = ['FUK', 'FUC', 'FCK', 'FUQ', 'FKU', 'SHT', 'ASS', 'CUM', 'COK', 'KOK', 'DIK', 'DIC', 'KKK', 'NIG', 'NGR', 'FAG',
  'SEX', 'TIT', 'PUS', 'VAG', 'POO', 'PEE', 'WTF', 'HTL', 'NAZ'];
function cleanName(raw){
  const name = String(raw == null ? '' : raw).trim().toUpperCase();
  if (!INI_OK.test(name)) return null;
  const flat = name.replace(/0/g, 'O').replace(/1/g, 'I').replace(/3/g, 'E').replace(/4/g, 'A').replace(/5/g, 'S');
  if (BAD.some(w => flat.includes(w))) return null;
  return name;
}

// rows for the client: never contains a pid
function row(rank, score, meta, me){
  let m = {}; try { m = JSON.parse(meta) || {}; } catch(e){}
  const r = { rank, name:String(m.name || '???'), score:Number(score) || 0 };
  if (me) r.me = true; return r;
}
// rows [from..to] (0-based ranks, inclusive) of the board, best first
async function rows(from, to, pid){
  if (to < from) return [];
  const r = await redis('ZREVRANGE', BOARD, from, to, 'WITHSCORES'); if (!r || !r.length) return [];
  const ids = []; for (let i = 0; i < r.length; i += 2) ids.push(r[i]);
  const metas = await redis('HMGET', PLAYERS, ...ids);
  return ids.map((id, i) => row(from + i + 1, r[i*2 + 1], metas[i], id === pid));
}
// the rows right around a 0-based rank (2 above, the player, 2 below)
const around = (rank0, pid) => rows(Math.max(0, rank0 - 2), rank0 + 2, pid);

function body(req){ try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch(e){ return {}; } }

module.exports = { ORIGIN_OK, redis, pipe, makeToken, readToken, ip, allow, cors, ready, cleanName, rows, around, row, body,
  P, BOARD, PLAYERS, MAX_PLAYERS, TOKEN_MAX_AGE, MAX_SCORE, MIN_RUN_SEC, MAX_PTS_PER_SEC, MIN_FIGHT_SEC, FIGHT_SLACK, MAX_FIGHT_SEC, MAX_KO, PID_OK };
