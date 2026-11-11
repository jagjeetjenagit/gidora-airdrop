/*
 * GIDORA: in-browser API for the static (GitHub Pages) preview build.
 *
 * GitHub Pages can't run the Node server, so this file implements the same
 * endpoints and rules as src/routes/api.js in demo mode, persisting to
 * localStorage. Data is per-browser and illustrative only.
 * Campaign config + curve parameters are injected by scripts/build-static.js
 * as window.GDR_STATIC_CONFIG so values are never duplicated by hand.
 */
(function () {
  'use strict';
  const CFG = window.GDR_STATIC_CONFIG;
  if (!CFG) return;

  // ------------------------------------------------------------ curve (same model as src/lib/curve.js)
  const { N, MAX, MIN, BUDGET, K } = CFG.curve;
  const SPAN = MAX - MIN;
  const allocationAt = (n) => MIN + SPAN * Math.pow(1 - (n - 1) / (N - 1), K);
  function distributedAfter(m) {
    if (m <= 0) return 0;
    if (m >= N) return BUDGET;
    const xm = (m - 1) / (N - 1);
    return (N - 1) * (MIN * xm + (SPAN / (K + 1)) * (1 - Math.pow(1 - xm, K + 1))) + (MAX + allocationAt(m)) / 2;
  }

  // ------------------------------------------------------------ helpers
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const B58MAP = Object.fromEntries([...B58].map((c, i) => [c, BigInt(i)]));
  function b58encode(bytes) {
    let n = 0n; for (const b of bytes) n = (n << 8n) + BigInt(b);
    let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
    return out;
  }
  function b58decode(str) {
    let n = 0n;
    for (const ch of str) { const v = B58MAP[ch]; if (v === undefined) throw new Error('bad'); n = n * 58n + v; }
    const out = []; while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
    for (const ch of str) { if (ch === '1') out.unshift(0); else break; }
    return new Uint8Array(out);
  }
  function hash32(str) { // FNV-1a
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function bytesFrom(seed, len) { // deterministic xorshift bytes
    let x = hash32(seed) || 1; const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 0xff; }
    return out;
  }
  const isValidAddress = (a) => { try { return typeof a === 'string' && a.length >= 32 && a.length <= 44 && b58decode(a).length === 32; } catch { return false; } };
  const DEMO_RE = /^Demo[1-9A-HJ-NP-Za-km-z]{8,40}$/;
  const isDemoWallet = (w) => typeof w === 'string' && DEMO_RE.test(w);
  const validWallet = (w) => isValidAddress(w) || isDemoWallet(w);
  const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
  const ok = (data) => ({ status: 200, data });
  const fail = (status, error, message) => ({ status, data: { error, message } });

  // ------------------------------------------------------------ store
  const KEY = 'gdr_static_state_v1';
  let st;
  try { st = JSON.parse(localStorage.getItem(KEY)); } catch { st = null; }
  st = st || { claims: {}, referrals: {}, codes: {} };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage unavailable */ } };

  const claimCount = () => CFG.demoClaimOffset + Object.keys(st.claims).length;
  const activeRound = () => CFG.rounds.find((r) => r.status === 'active') || null;
  function codeFor(wallet) {
    const code = b58encode(bytesFrom('gdr-ref:' + wallet, 6));
    if (!st.codes[code]) { st.codes[code] = wallet; save(); }
    return code;
  }
  function bindReferral(referee, code) {
    const referrer = st.codes[code];
    if (!referrer) return { error: 'unknown_code' };
    if (referrer === referee) return { error: 'self_referral' };
    if (st.referrals[referee]) return { error: 'already_attributed' };
    if (st.claims[referee]) return { error: 'claimed_before_referral' };
    st.referrals[referee] = { referrer, status: 'pending', at: new Date().toISOString() };
    save();
    return { referral: st.referrals[referee] };
  }

  let demoBoard = null;
  function leaderboard() {
    if (!demoBoard) {
      demoBoard = [];
      for (let i = 0; i < 240; i++) {
        const b = bytesFrom('demo-wallet-' + i, 32);
        const r = ((b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0) / 0xffffffff;
        demoBoard.push({ wallet: b58encode(b), verified: Math.max(1, Math.floor(1800 * Math.pow(r, 6) + 40 * r)), status: b[5] % 13 === 0 ? 'review' : 'verified', sample: true });
      }
    }
    const map = new Map(demoBoard.map((r) => [r.wallet, { ...r }]));
    for (const ref of Object.values(st.referrals)) {
      if (ref.status !== 'verified') continue;
      const row = map.get(ref.referrer) || { wallet: ref.referrer, verified: 0, status: 'verified', sample: false };
      row.verified += 1; row.sample = false; map.set(ref.referrer, row);
    }
    const rows = [...map.values()].sort((a, b) => b.verified - a.verified || (a.wallet < b.wallet ? -1 : 1));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }

  function demoEligibility(wallet) {
    if (isDemoWallet(wallet)) return { status: 'eligible' };
    const b = hash32('elig:' + wallet) % 20;
    if (b === 0) return { status: 'review', reason: 'This wallet is under standard anti-abuse review. Reviews usually complete within 24 hours.' };
    if (b === 1) return { status: 'not_eligible', reason: 'insufficient_sol', message: 'Your wallet needs a small SOL balance to pay Solana network fees.' };
    return { status: 'eligible' };
  }

  function stats() {
    const count = claimCount(), d = distributedAfter(count);
    return {
      claimCount: count, distributed: +d.toFixed(2), remaining: +(BUDGET - d).toFixed(2),
      percentDistributed: +((d / BUDGET) * 100).toFixed(4), nextPosition: count + 1,
      nextAllocation: count < N ? +allocationAt(count + 1).toFixed(6) : 0, updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------ sessions
  const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const issueToken = (w) => `${b64u(JSON.stringify({ w, exp: Date.now() + 2 * 3600e3 }))}.static`;
  function walletFromAuth(h) {
    try {
      const { w, exp } = JSON.parse(unb64u(String(h || '').replace(/^Bearer\s+/i, '').split('.')[0]));
      return Date.now() < exp ? w : null;
    } catch { return null; }
  }
  const nonces = {};
  async function verifyEd25519(address, message, sigB58) {
    try {
      const key = await crypto.subtle.importKey('raw', b58decode(address), { name: 'Ed25519' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'Ed25519' }, key, b58decode(sigB58), new TextEncoder().encode(message));
    } catch {
      return null; // browser lacks Ed25519 in WebCrypto; preview accepts the wallet's signature
    }
  }

  // ------------------------------------------------------------ router
  async function request(method, path, body, authHeader) {
    const url = new URL(path, 'https://x');
    const p = url.pathname, q = url.searchParams;
    const authed = () => walletFromAuth(authHeader);
    let m;

    if (method === 'GET' && p === '/campaign') {
      return ok({
        demo: true, brand: CFG.brand, network: CFG.network, token: CFG.token,
        rounds: CFG.rounds, activeRound: activeRound() ? activeRound().id : null, stats: stats(),
        curve: CFG.curveMeta, referral: CFG.referral, kolPool: CFG.kolPool,
      });
    }
    if (method === 'GET' && (m = p.match(/^\/allocation\/(\d+)$/))) {
      const n = Number(m[1]);
      if (n < 1 || n > N) return fail(400, 'invalid_position', 'Invalid position.');
      return ok({ position: n, allocation: +allocationAt(n).toFixed(6), estimate: true });
    }
    if (method === 'GET' && p === '/session/nonce') {
      const wallet = q.get('wallet');
      if (!validWallet(wallet)) return fail(400, 'invalid_wallet', 'That does not look like a valid Solana address.');
      const nonce = b58encode(crypto.getRandomValues(new Uint8Array(16)));
      const message = ['GIDORA wants you to verify ownership of this wallet.', '', `Wallet: ${wallet}`, `Nonce: ${nonce}`, `Issued: ${new Date().toISOString()}`, '', 'Signing this message is free. It does not send a transaction or move any assets.'].join('\n');
      nonces[wallet] = message;
      return ok({ message });
    }
    if (method === 'POST' && p === '/session') {
      const { wallet, signature } = body || {};
      if (!validWallet(wallet)) return fail(400, 'invalid_wallet', 'Invalid wallet address.');
      if (!isDemoWallet(wallet)) {
        if (!nonces[wallet]) return fail(400, 'nonce_expired', 'Verification request expired. Please try again.');
        if ((await verifyEd25519(wallet, nonces[wallet], signature)) === false) return fail(401, 'bad_signature', 'Signature could not be verified.');
        delete nonces[wallet];
      }
      return ok({ token: issueToken(wallet), wallet });
    }
    if (method === 'GET' && (m = p.match(/^\/eligibility\/(.+)$/))) {
      const wallet = decodeURIComponent(m[1]);
      if (!validWallet(wallet)) return fail(400, 'invalid_wallet', 'Invalid wallet address.');
      if (st.claims[wallet]) return ok({ status: 'claimed', claim: st.claims[wallet] });
      const round = activeRound();
      if (!round) return ok({ status: 'round_inactive', message: 'No claim round is open right now.' });
      const e = demoEligibility(wallet), s = stats();
      return ok({ ...e, round, estimate: e.status === 'eligible' ? { position: s.nextPosition, allocation: s.nextAllocation, final: false, note: 'Estimated. Your final allocation is set by the claim position assigned when your transaction confirms.' } : null });
    }
    if (method === 'POST' && p === '/claim') {
      const wallet = authed();
      if (!wallet) return fail(401, 'unauthorized', 'Please connect and verify your wallet.');
      const round = activeRound();
      if (!round) return fail(409, 'round_inactive', 'No claim round is active.');
      if (st.claims[wallet]) return fail(409, 'already_claimed', 'This wallet has already claimed.');
      const e = demoEligibility(wallet);
      if (e.status !== 'eligible') return fail(403, e.status, e.message || e.reason);
      if (body && body.ref) bindReferral(wallet, String(body.ref).slice(0, 32));
      const index = claimCount() + 1;
      const claim = { wallet, index, amount: +allocationAt(index).toFixed(6), round: round.id, demo: true, at: new Date().toISOString(), signature: null };
      st.claims[wallet] = claim;
      const ref = st.referrals[wallet];
      if (ref && ref.status === 'pending') { ref.status = 'verified'; ref.verifiedAt = claim.at; }
      save();
      return ok({ claim, demo: true });
    }
    if (method === 'POST' && p === '/referral/bind') {
      const wallet = authed();
      if (!wallet) return fail(401, 'unauthorized', 'Please connect and verify your wallet.');
      const out = bindReferral(wallet, String((body && body.code) || '').slice(0, 32));
      const msgs = { unknown_code: 'That referral code was not found.', self_referral: 'You cannot use your own referral link.', already_attributed: 'This wallet is already linked to a referrer.', claimed_before_referral: 'Referral links must be used before claiming.' };
      return out.error ? fail(409, out.error, msgs[out.error]) : ok(out);
    }
    if (method === 'GET' && p === '/referrals/me') {
      const wallet = authed();
      if (!wallet) return fail(401, 'unauthorized', 'Please connect and verify your wallet.');
      const rows = Object.entries(st.referrals).filter(([, r]) => r.referrer === wallet);
      const c = (s) => rows.filter(([, r]) => r.status === s).length;
      const me = leaderboard().find((r) => r.wallet === wallet);
      return ok({
        wallet, code: codeFor(wallet), verified: c('verified'), pending: c('pending'), underReview: c('review'),
        recent: rows.slice(-10).reverse().map(([referee, r]) => ({ referee: short(referee), status: r.status, at: r.at })),
        rank: me ? me.rank : null,
        rewards: { ratePercent: CFG.referral.ratePercent, confirmed: CFG.referral.confirmed, accrued: null, paid: null, asset: null },
        claim: st.claims[wallet] || null,
      });
    }
    if (method === 'GET' && p === '/leaderboard') {
      const page = Math.max(1, parseInt(q.get('page'), 10) || 1);
      const size = Math.min(50, Math.max(5, parseInt(q.get('size'), 10) || 20));
      const term = (q.get('q') || '').trim().toLowerCase();
      const wallet = q.get('wallet') || '';
      const all = leaderboard();
      const filtered = term ? all.filter((r) => r.wallet.toLowerCase().includes(term)) : all;
      const toRow = (r) => ({ rank: r.rank, wallet: r.wallet, display: short(r.wallet), verified: r.verified, status: r.status, sample: r.sample });
      const me = wallet ? all.find((r) => r.wallet === wallet) : null;
      return ok({
        demo: true, page, size, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / size)),
        rows: filtered.slice((page - 1) * size, page * size).map(toRow), me: me ? toRow(me) : null,
        summary: { participants: all.length, verifiedReferrals: all.reduce((a, r) => a + r.verified, 0), period: activeRound() ? activeRound().name : 'Pre-launch' },
        updatedAt: new Date().toISOString(),
      });
    }
    return fail(404, 'not_found', 'Not found');
  }

  window.GDRStaticApi = { request };
})();
