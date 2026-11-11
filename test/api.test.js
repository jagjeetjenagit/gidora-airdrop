'use strict';
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEMO_MODE = 'true';
process.env.DATA_DIR = path.join(os.tmpdir(), `gdr-test-${process.pid}`);

const app = require('../server');
const store = require('../src/lib/store');
const { base58Encode, verifySignature, isValidAddress } = require('../src/lib/solana');

let server, base;
test.before(async () => {
  store._reset();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const j = async (p, opts = {}) => {
  const res = await fetch(base + p, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'jwk' }).x;
  return { address: base58Encode(Buffer.from(raw, 'base64url')), privateKey };
}

async function login(kp) {
  const { body: { message } } = await j(`/api/session/nonce?wallet=${kp.address}`);
  const sig = crypto.sign(null, Buffer.from(message), kp.privateKey);
  const { status, body } = await j('/api/session', { method: 'POST', body: { wallet: kp.address, signature: base58Encode(sig) } });
  assert.equal(status, 200);
  return body.token;
}

test('pages render', async () => {
  for (const p of ['/', '/leaderboard', '/rewards']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.match(await res.text(), /GIDORA/);
  }
  assert.equal((await fetch(base + '/nope')).status, 404);
});

test('campaign hides unconfirmed fees', async () => {
  const { body } = await j('/api/campaign');
  assert.equal(body.rounds.length, 8);
  assert.ok(body.rounds.every((r) => r.fee === null));
  assert.equal(body.curve.first, 21);
});

test('signature verification', () => {
  const kp = keypair();
  assert.ok(isValidAddress(kp.address));
  const sig = base58Encode(crypto.sign(null, Buffer.from('hi'), kp.privateKey));
  assert.ok(verifySignature(kp.address, 'hi', sig));
  assert.ok(!verifySignature(kp.address, 'bye', sig));
});

test('session rejects a forged signature', async () => {
  const a = keypair(); const b = keypair();
  const { body: { message } } = await j(`/api/session/nonce?wallet=${a.address}`);
  const sig = base58Encode(crypto.sign(null, Buffer.from(message), b.privateKey));
  const res = await j('/api/session', { method: 'POST', body: { wallet: a.address, signature: sig } });
  assert.equal(res.status, 401);
});

test('claim requires auth and only succeeds once', async () => {
  assert.equal((await j('/api/claim', { method: 'POST', body: {} })).status, 401);
  const demo = 'DemoAbCdEfGhJkLmNoPqRsTuVwXyZ12345';
  const { body: { token } } = await j('/api/session', { method: 'POST', body: { wallet: demo } });
  const auth = { authorization: `Bearer ${token}` };
  const first = await j('/api/claim', { method: 'POST', headers: auth, body: {} });
  assert.equal(first.status, 200);
  assert.ok(first.body.claim.amount > 0.21 && first.body.claim.amount < 21);
  const second = await j('/api/claim', { method: 'POST', headers: auth, body: {} });
  assert.equal(second.status, 409);
  const elig = await j(`/api/eligibility/${demo}`);
  assert.equal(elig.body.status, 'claimed');
});

test('referral: self-referral rejected, valid referral verifies on claim and ranks', async () => {
  const referrer = keypair();
  const t1 = await login(referrer);
  const me = await j('/api/referrals/me', { headers: { authorization: `Bearer ${t1}` } });
  const code = me.body.code;

  const self = await j('/api/referral/bind', { method: 'POST', headers: { authorization: `Bearer ${t1}` }, body: { code } });
  assert.equal(self.body.error, 'self_referral');

  const demo = 'DemoReferee111111111111111111111';
  const { body: { token } } = await j('/api/session', { method: 'POST', body: { wallet: demo } });
  const claim = await j('/api/claim', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { ref: code } });
  assert.equal(claim.status, 200);

  const after = await j('/api/referrals/me', { headers: { authorization: `Bearer ${t1}` } });
  assert.equal(after.body.verified, 1);
  assert.ok(after.body.rank >= 1);
  const lb = await j(`/api/leaderboard?wallet=${referrer.address}`);
  assert.equal(lb.body.me.verified, 1);
});

test('input validation', async () => {
  assert.equal((await j('/api/eligibility/not-a-wallet')).status, 400);
  assert.equal((await j('/api/allocation/0')).status, 400);
  assert.equal((await j('/api/allocation/1')).body.allocation, 21);
});
