// Shared helpers for the Race to Balfour leaderboard (Vercel functions + Upstash Redis REST).
// The browser never talks to the database: every score goes through submit.js, which checks a signed
// race token issued by start.js, the wall-clock time since that token, lap times and limits.
const crypto = require('crypto');

const RURL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const SECRET = process.env.BALFOUR_SECRET || RTOK || '';
const BOARD = 'balfour:board:v3';   // v3 = the 1.5 km track (2 laps)

const ready = () => !!(RURL && RTOK && SECRET);

async function redis(...cmd){
  const r = await fetch(RURL, { method:'POST', headers:{ Authorization:'Bearer ' + RTOK, 'Content-Type':'application/json' }, body:JSON.stringify(cmd) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
}

const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const sign = payload => b64u(crypto.createHmac('sha256', SECRET).update(payload).digest());

function makeToken(){
  const payload = b64u(JSON.stringify({ iat:Date.now(), n:crypto.randomBytes(9).toString('hex') }));
  return payload + '.' + sign(payload);
}
function readToken(tok){
  if (typeof tok !== 'string' || tok.length > 300) return null;
  const [payload, sig] = tok.split('.'); if (!payload || !sig) return null;
  const want = sign(payload);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); } catch(e){ return null; }
}

const ip = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

function cors(req, res){
  // only the game's own pages may call these
  const o = req.headers.origin || '';
  if (/^https:\/\/(www\.)?adamlevi\.net$/.test(o)) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = { redis, makeToken, readToken, ip, cors, ready, BOARD };
