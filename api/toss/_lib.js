// Shared helpers for the Toss the Boss leaderboard (Vercel functions + Upstash Redis REST).
// The browser never talks to the database: every score goes through submit.js, which checks a signed
// token issued by start.js, the wall-clock time since that token, per-level score caps and rate limits.
//
// Storage:
//   toss:board:v1    sorted set   member = player id (pid), score = TOTAL (sum of the player's best score on each level)
//   toss:players:v1  hash         pid -> JSON { name, lv (levels cleared), stars, d (date) }
// One row per player: re-submitting only ever raises the row (ZADD GT). Player ids never leave the server.
const crypto = require('crypto');

const RURL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const SECRET = process.env.TOSS_SECRET || RTOK || '';
const BOARD = 'toss:board:v1', PLAYERS = 'toss:players:v1';
const MAX_PLAYERS = 20000;          // everyone keeps a rank; beyond this the lowest totals are trimmed
const TOKEN_MAX_AGE = 12*3600;      // seconds
const SEC_PER_LEVEL = 6;            // nobody clears a level faster than this (aim + flight + KO + result)

// Highest score the game can pay out on each of the 10 levels, with ~15 % headroom. Computed from the game data
// (tools/toss_caps.js): 7000 headshot KO + 1000 per projectile body (each one is either a headshot bonus or an
// unused-supply bonus; sticky notes split in three) + 10 x (boss hp + 300 overkill) damage points
// + for every breakable piece: its break points + 20 x (hp + 25) damage points; x1.15, rounded up to 1000.
// The best scores found by 150 random games per level are 12-18 k, so honest players sit well below these.
// 19/11 (C39): theoretical max incl. speed bonus 2000 and first-try +25% = (raw + 2000) x 1.25; levels 2 and 10
// (28675 / 47575) were above their caps, raised to 30000 / 50000 (~5 % headroom). All other levels stay above that max.
const LEVEL_CAP = [26000, 30000, 27000, 40000, 33000, 40000, 37000, 30000, 40000, 50000, 60000];
const LEVELS = LEVEL_CAP.length;

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
const sign = payload => b64u(crypto.createHmac('sha256', SECRET).update('toss.' + payload).digest());

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
  const k = 'toss:rl:' + kind + ':' + ip(req), n = await redis('INCR', k);
  if (n === 1) await redis('EXPIRE', k, windowSec || 3600);
  return n <= max;
}

const ORIGIN_OK = /^(https:\/\/((www\.)?adamlevi\.net|([a-z0-9-]+\.)*itch\.(zone|io)|([a-z0-9-]+\.)*crazygames\.com)|capacitor:\/\/([a-z0-9-]+\.)*crazygames\.com)$/;
function cors(req, res){
  // only the game's own pages may call these: adamlevi.net and the itch.io copy (served in an iframe from *.itch.zone,
  // e.g. https://html-classic.itch.zone) and the CrazyGames copy (*.crazygames.com, e.g. https://<game>.game-files.crazygames.com;
  // capacitor://*.crazygames.com = their iOS app). CORS only stops other web pages from reading the answers; it is NOT the
  // anti-cheat (curl ignores it) - that is the signed token, caps, clock and rate limits in submit.js.
  const o = String(req.headers.origin || '');
  if (ORIGIN_OK.test(o)) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

const PID_OK = /^[0-9a-f]{16,32}$/;
// 2-14 characters: letters / digits in any language (Hebrew included), space . _ -
const NAME_OK = /^[\p{L}\p{M}\p{N} ._-]{2,14}$/u;
// light profanity filter: matched against the name with spaces/punctuation removed and common digit look-alikes folded
const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'rapist', 'nazi', 'hitler', 'porn', 'asshole',
  'זונה', 'זונות', 'שרמוט', 'כוסאמ', 'כוסעמ', 'כוסאחות', 'כוסאחת', 'מניאק', 'מזדיי', 'לזיינ', 'תזדיי', 'קוקסינל', 'היטלר', 'נאצי', 'כושי'];
const FINAL = { 'ם':'מ', 'ן':'נ', 'ץ':'צ', 'ף':'פ', 'ך':'כ' };
function cleanName(raw){
  const name = String(raw == null ? '' : raw).normalize('NFC').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  if (!NAME_OK.test(name) || !/[\p{L}\p{N}]/u.test(name)) return null;
  const flat = name.toLowerCase().replace(/[ ._-]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/\$/g, 's').replace(/[םןץףך]/g, c => FINAL[c]);
  if (BAD.some(w => flat.includes(w))) return null;
  return name;
}

// rows for the client: never contains a pid
function row(rank, total, meta, me){
  let m = {}; try { m = JSON.parse(meta) || {}; } catch(e){}
  const r = { rank, name:String(m.name || 'Anonymous'), total:Number(total) || 0, lv:Number(m.lv) || 0 };
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
  BOARD, PLAYERS, MAX_PLAYERS, TOKEN_MAX_AGE, SEC_PER_LEVEL, LEVEL_CAP, LEVELS, PID_OK };
