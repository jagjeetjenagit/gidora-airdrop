'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const curve = require('../src/lib/curve');

test('endpoints match spec (21 → 0.21 GDR)', () => {
  assert.equal(curve.allocationAt(1), 21);
  assert.ok(Math.abs(curve.allocationAt(curve.N) - 0.21) < 1e-12);
});

test('curve is non-increasing and sums to the 10M budget', () => {
  let sum = 0;
  let prev = Infinity;
  for (let n = 1; n <= curve.N; n++) {
    const a = curve.allocationAt(n);
    assert.ok(a <= prev, `increase at ${n}`);
    prev = a;
    sum += a;
  }
  assert.ok(Math.abs(sum - curve.BUDGET) < 1, `sum was ${sum}`);
});

test('distributedAfter tracks the exact running sum', () => {
  let sum = 0;
  const checkpoints = new Set([1, 10, 1000, 123_456, 2_000_000]);
  for (let n = 1; n <= 2_000_000; n++) {
    sum += curve.allocationAt(n);
    if (checkpoints.has(n)) assert.ok(Math.abs(curve.distributedAfter(n) - sum) < 0.01, `at ${n}`);
  }
  assert.equal(curve.distributedAfter(0), 0);
  assert.equal(curve.distributedAfter(curve.N), curve.BUDGET);
});

test('rejects out-of-range positions', () => {
  assert.throws(() => curve.allocationAt(0), RangeError);
  assert.throws(() => curve.allocationAt(curve.N + 1), RangeError);
  assert.throws(() => curve.allocationAt(1.5), RangeError);
});
