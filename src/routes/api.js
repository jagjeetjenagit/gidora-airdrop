'use strict';
const express = require('express');
const crypto = require('crypto');
const config = require('../config/campaign');
const curve = require('../lib/curve');
const store = require('../lib/store');
const { isValidAddress, verifySignature, shortAddress } = require('../lib/solana');

const router = express.Router();
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const DEMO_WALLET_PREFIX = 'Demo';

// ---------------------------------------------------------------- helpers
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = req.ip + req.baseUrl + req.path;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' });
    next();
  };
}

const fail = (res, status, error, message) => res.status(status).json({ error, message });

const DEMO_WALLET_RE = /^Demo[1-9A-HJ-NP-Za-km-z]{8,40}$/;
function isDemoWallet(w) { return config.DEMO_MODE && typeof w === 'string' && DEMO_WALLET_RE.test(w); }

function validWallet(w) { return isValidAddress(w) || isDemoWallet(w); }

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function issueToken(wallet) {
  const exp = Date.now() + SESSION_TTL_MS;
  const body = Buffer.from(JSON.stringify({ w: wallet, exp })).toString('base64url');
  return `${body}.${sign(body)}`;
}

function auth(req, res, next) {
  const raw = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [body, sig] = raw.split('.');
  if (!body || !sig) return fail(res, 401, 'unauthorized', 'Please connect and verify your wallet.');
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return fail(res, 401, 'unauthorized', 'Session invalid. Please reconnect your wallet.');
  }
  try {
    const { w, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() > exp) return fail(res, 401, 'session_expired', 'Session expired. Please reconnect your wallet.');
    req.wallet = w;
    next();
  } catch {
    return fail(res, 401, 'unauthorized', 'Session invalid.');
  }
}

function activeRound() { return config.rounds.find((r) => r.status === 'active') || null; }

function publicRound(r) {
  return {
    id: r.id, name: r.name, status: r.status,
    startsAt: r.startsAt, endsAt: r.endsAt,
    fee: r.fee.confirmed ? { amount: r.fee.amount, currency: r.fee.currency } : null,
  };
}

function stats() {
  const count = store.claimCount();
  const distributed = curve.distributedAfter(count);
  return {
    claimCount: count,
    distributed: +distributed.toFixed(2),
    remaining: +(curve.BUDGET - distributed).toFixed(2),
    percentDistributed: +((distributed / curve.BUDGET) * 100).toFixed(4),
    nextPosition: count + 1,
    nextAllocation: count < curve.N ? +curve.allocationAt(count + 1).toFixed(6) : 0,
    updatedAt: new Date().toISOString(),
  };
}

// demo-only deterministic eligibility, so every UI state can be reviewed
function demoEligibility(wallet) {
  if (isDemoWallet(wallet)) return { status: 'eligible' };
  const b = crypto.createHash('sha256').update('elig:' + wallet).digest()[0] % 20;
  if (b === 0) return { status: 'review', reason: 'This wallet is under standard anti-abuse review. Reviews usually complete within 24 hours.' };
  if (b === 1) return { status: 'not_eligible', reason: 'insufficient_sol', message: 'Your wallet needs a small SOL balance to pay Solana network fees.' };
  return { status: 'eligible' };
}

// ---------------------------------------------------------------- routes
router.use(rateLimit({ windowMs: 60_000, max: 240 }));

router.get('/health', (req, res) => res.json({ ok: true, demo: config.DEMO_MODE }));

router.get('/campaign', (req, res) => {
  res.json({
    demo: config.DEMO_MODE,
    brand: config.brand,
    network: { name: config.network.name, cluster: config.network.cluster, explorer: config.network.explorer },
    token: config.token,
    rounds: config.rounds.map(publicRound),
    activeRound: activeRound() ? activeRound().id : null,
    stats: stats(),
    curve: { ...curve.meta, first: curve.MAX, last: curve.MIN, positions: curve.N, budget: curve.BUDGET },
    referral: { ratePercent: config.referral.ratePercent, confirmed: config.referral.confirmed, levels: config.referral.levels },
    kolPool: config.kolPool,
  });
});

router.get('/curve', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ points: curve.samplePoints(140), meta: curve.meta });
});

router.get('/allocation/:position', (req, res) => {
  const n = Number(req.params.position);
  if (!Number.isInteger(n) || n < 1 || n > curve.N) return fail(res, 400, 'invalid_position', `Position must be 1–${curve.N.toLocaleString('en-US')}.`);
  res.json({ position: n, allocation: +curve.allocationAt(n).toFixed(6), estimate: true });
});

// --- wallet session (proves wallet ownership by signing a message; no transaction, no fee)
const nonces = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of nonces) if (v.exp < now) nonces.delete(k); }, 60_000).unref();

router.get('/session/nonce', rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const { wallet } = req.query;
  if (!validWallet(wallet)) return fail(res, 400, 'invalid_wallet', 'That does not look like a valid Solana address.');
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = [
    'GIDORA wants you to verify ownership of this wallet.',
    '',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
    '',
    'Signing this message is free. It does not send a transaction or move any assets.',
  ].join('\n');
  nonces.set(wallet, { message, exp: Date.now() + NONCE_TTL_MS });
  res.json({ message });
});

router.post('/session', rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const { wallet, signature } = req.body || {};
  if (!validWallet(wallet)) return fail(res, 400, 'invalid_wallet', 'Invalid wallet address.');
  if (isDemoWallet(wallet)) return res.json({ token: issueToken(wallet), wallet, demo: true });
  const entry = nonces.get(wallet);
  if (!entry || entry.exp < Date.now()) return fail(res, 400, 'nonce_expired', 'Verification request expired. Please try again.');
  if (!verifySignature(wallet, entry.message, signature)) return fail(res, 401, 'bad_signature', 'Signature could not be verified.');
  nonces.delete(wallet);
  res.json({ token: issueToken(wallet), wallet });
});

// --- eligibility (public: on-chain claim status is public information)
router.get('/eligibility/:wallet', (req, res) => {
  const { wallet } = req.params;
  if (!validWallet(wallet)) return fail(res, 400, 'invalid_wallet', 'Invalid wallet address.');

  const claim = store.getClaim(wallet);
  if (claim) return res.json({ status: 'claimed', claim });

  const round = activeRound();
  if (!round) return res.json({ status: 'round_inactive', message: 'No claim round is open right now. Check the round timeline for the next window.' });

  if (!config.DEMO_MODE) {
    return res.json({ status: 'unavailable', message: 'Eligibility checks open when the audited claim program goes live.' });
  }

  const s = stats();
  const elig = demoEligibility(wallet);
  res.json({
    ...elig,
    round: publicRound(round),
    estimate: elig.status === 'eligible'
      ? { position: s.nextPosition, allocation: s.nextAllocation, final: false, note: 'Estimated. Your final allocation is set by the claim position assigned when your transaction confirms.' }
      : null,
  });
});

router.post('/claim', rateLimit({ windowMs: 60_000, max: 10 }), auth, (req, res) => {
  const wallet = req.wallet;
  if (!config.DEMO_MODE) return fail(res, 501, 'not_live', 'On-chain claiming opens after the program audit is published.');
  const round = activeRound();
  if (!round) return fail(res, 409, 'round_inactive', 'No claim round is active.');
  const elig = store.getClaim(wallet) ? { status: 'claimed' } : demoEligibility(wallet);
  if (elig.status === 'claimed') return fail(res, 409, 'already_claimed', 'This wallet has already claimed.');
  if (elig.status !== 'eligible') return fail(res, 403, elig.status, elig.message || elig.reason || 'Not eligible.');

  const { ref } = req.body || {};
  if (ref) store.bindReferral(wallet, String(ref).slice(0, 32)); // ignore errors; claim proceeds

  const out = store.recordClaim(wallet, { round: round.id, demo: true });
  if (out.error) return fail(res, 409, out.error, out.error === 'campaign_complete' ? 'The claim allocation has been fully distributed.' : 'This wallet has already claimed.');
  res.json({ claim: out.claim, demo: true });
});

// --- referrals
router.post('/referral/bind', auth, (req, res) => {
  const { code } = req.body || {};
  const out = store.bindReferral(req.wallet, String(code || '').slice(0, 32));
  if (out.error) {
    const msgs = {
      unknown_code: 'That referral code was not found.',
      self_referral: 'You cannot use your own referral link.',
      already_attributed: 'This wallet is already linked to a referrer.',
      claimed_before_referral: 'Referral links must be used before claiming.',
    };
    return fail(res, 409, out.error, msgs[out.error]);
  }
  res.json(out);
});

router.get('/referrals/me', auth, (req, res) => {
  const wallet = req.wallet;
  const code = store.referralCodeFor(wallet);
  const s = store.referralStats(wallet);
  const board = store.leaderboard();
  const me = board.find((r) => r.wallet === wallet);
  res.json({
    wallet,
    code,
    ...s,
    recent: s.recent.map((r) => ({ ...r, referee: shortAddress(r.referee) })),
    rank: me ? me.rank : null,
    rewards: {
      ratePercent: config.referral.ratePercent,
      confirmed: config.referral.confirmed,
      accrued: null, // populated by indexer once reward terms are final
      paid: null,
      asset: null,
    },
    claim: store.getClaim(wallet),
  });
});

// --- leaderboard
router.get('/leaderboard', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.min(50, Math.max(5, parseInt(req.query.size, 10) || 20));
  const q = String(req.query.q || '').trim();
  const wallet = String(req.query.wallet || '');

  const all = store.leaderboard();
  const filtered = q ? all.filter((r) => r.wallet.toLowerCase().includes(q.toLowerCase())) : all;
  const start = (page - 1) * size;
  const toRow = (r) => ({
    rank: r.rank, wallet: r.wallet, display: shortAddress(r.wallet),
    verified: r.verified, status: r.status, sample: r.sample,
  });
  const me = wallet ? all.find((r) => r.wallet === wallet) : null;
  res.json({
    demo: config.DEMO_MODE,
    page, size, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / size)),
    rows: filtered.slice(start, start + size).map(toRow),
    me: me ? toRow(me) : null,
    summary: {
      participants: all.length,
      verifiedReferrals: all.reduce((a, r) => a + r.verified, 0),
      period: activeRound() ? activeRound().name : 'Pre-launch',
    },
    updatedAt: new Date().toISOString(),
  });
});

module.exports = router;
module.exports._internals = { issueToken, DEMO_WALLET_PREFIX };
