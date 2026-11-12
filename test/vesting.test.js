'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/lib/schedule');
const curve = require('../src/lib/curve');
const config = require('../src/config/campaign');

const DAY = 86_400_000;

test('round caps sum to the 10M claim allocation', () => {
  const caps = config.rounds.map((r) => r.capGdr);
  assert.deepStrictEqual(caps, [100_000, 100_000, 200_000, 400_000, 200_000, 2_000_000, 3_000_000, 4_000_000]);
  assert.strictEqual(caps.reduce((a, b) => a + b, 0), 10_000_000);
});

test('25/75 split never loses or creates base units', () => {
  for (const a of [21_000_000, 15_000_000, 210_000, 1, 3, 16_166_043, 999_999]) {
    const { immediate, locked } = S.splitClaim(a, 25);
    assert.strictEqual(immediate + locked, a);
    assert.strictEqual(immediate, Math.floor(a / 4));
  }
  assert.deepStrictEqual(S.splitClaim(21_000_000), { immediate: 5_250_000, locked: 15_750_000 });
});

test('vesting is linear over 90 days from one global start (spec table)', () => {
  const L = 15_750_000, t0 = Date.UTC(2027, 0, 1);
  assert.strictEqual(S.vestingState(L, 0, null, t0, 90).status, 'pending');
  assert.strictEqual(S.vestingState(L, 0, t0, t0 - 1000, 90).available, 0); // locked before start
  assert.strictEqual(S.vestingState(L, 0, t0, t0 + DAY, 90).vested, 175_000);
  assert.strictEqual(S.vestingState(L, 0, t0, t0 + 30 * DAY, 90).vested, 5_250_000);
  assert.strictEqual(S.vestingState(L, 0, t0, t0 + 60 * DAY, 90).vested, 10_500_000);
  const end = S.vestingState(L, 0, t0, t0 + 90 * DAY, 90);
  assert.strictEqual(end.vested, L);
  assert.strictEqual(end.status, 'complete');
  assert.strictEqual(S.vestingState(L, 0, t0, t0 + 400 * DAY, 90).vested, L);
});

test('withdrawable = vested − previously withdrawn; never negative', () => {
  const L = 12_124_500, t0 = 0;
  const v30 = S.vestingState(L, 0, t0, 30 * DAY, 90);
  const v60 = S.vestingState(L, v30.available, t0, 60 * DAY, 90);
  assert.strictEqual(v60.available, v60.vested - v30.available);
  assert.strictEqual(S.vestingState(L, L, t0, 10 * DAY, 90).available, 0);
  // repeated withdrawals add up to exactly the locked amount by day 90
  let withdrawn = 0;
  for (const d of [1, 7, 33, 61, 89, 90]) withdrawn += S.vestingState(L, withdrawn, t0, d * DAY, 90).available;
  assert.strictEqual(withdrawn, L);
});

test('rounds are cap-driven from cumulative distribution', () => {
  const at = (count) => S.scheduleRounds(config.rounds, Date.now(), null, { claimCount: count, distributedAfter: curve.distributedAfter, N: curve.N });
  assert.strictEqual(at(0)[0].status, 'active');
  const mid = at(S.claimsToReach(150_000, curve.distributedAfter, curve.N));
  assert.deepStrictEqual(mid.map((r) => r.status).slice(0, 3), ['completed', 'active', 'upcoming']);
  assert.strictEqual(at(curve.N).every((r) => r.status === 'completed'), true);
});
