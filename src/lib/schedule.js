'use strict';
/**
 * Round schedule, claim split and vesting math.
 *
 * Master spec (Airdrop Claim & Vesting):
 *   - 8 rounds with fixed GDR caps (100k, 100k, 200k, 400k, 200k, 2M, 3M, 4M = 10M).
 *     A round is active while cumulative GDR distributed is inside its cap window.
 *   - Each claim: Immediate = floor(A × 25%), Locked = A − Immediate (base units).
 *   - Locked GDR vests linearly over 90 days from ONE global start timestamp,
 *     set when the campaign is finalized: Vested = floor(L × elapsed / D).
 *   - Withdrawable = Vested − previously withdrawn. Unlimited withdrawals.
 *
 * This file is also serialised into the static (GitHub Pages) build, so it
 * must stay dependency-free. The on-chain program remains authoritative; this
 * mirrors its math for display and the demo.
 */

const DAY = 86_400_000;
const DECIMALS = 6; // GDR mint decimals: assumption until the mint is published
const UNIT = 10 ** DECIMALS;

const toBase = (gdr) => Math.floor(gdr * UNIT + 1e-6);
const fromBase = (b) => b / UNIT;

/** Smallest claim count m such that distributedAfter(m) >= gdr. */
function claimsToReach(gdr, distributedAfter, N) {
  let lo = 0, hi = N;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if (distributedAfter(m) >= gdr) hi = m; else lo = m + 1;
  }
  return lo;
}

/**
 * Round state from cumulative distribution (cap-driven).
 * ctx = { claimCount, distributedAfter, N }
 * In demo mode, round open/close times are projected from the simulated claim rate.
 */
function scheduleRounds(rounds, now, demo, ctx) {
  const out = rounds.map((r) => ({ ...r }));
  const capped = ctx && out.every((r) => r.capGdr > 0);

  if (capped) {
    const distributed = ctx.distributedAfter(ctx.claimCount);
    const realClaims = demo ? ctx.claimCount - demoClaims(now, demo) : 0;
    let cum = 0;
    for (const r of out) {
      r.cumStart = cum;
      cum += r.capGdr;
      r.cumEnd = cum;
      r.claimedGdr = Math.max(0, Math.min(r.capGdr, distributed - r.cumStart));
      r.progress = r.claimedGdr / r.capGdr;
      r.status = distributed >= r.cumEnd ? 'completed' : distributed >= r.cumStart ? 'active' : 'upcoming';
      if (demo && !(r.startsAt && r.endsAt)) {
        const at = (gdr) => {
          const c = claimsToReach(gdr, ctx.distributedAfter, ctx.N);
          return new Date(Date.parse(demo.epoch) + (c - demo.baseClaims - realClaims) * demo.msPerClaim).toISOString();
        };
        r.startsAt = at(r.cumStart);
        r.endsAt = at(r.cumEnd);
        r.projected = true; // demo projection: rounds close when their GDR cap is reached
      }
    }
    return out;
  }

  // fallback: approved calendar dates
  for (const r of out) {
    if (r.startsAt && r.endsAt) {
      const s = Date.parse(r.startsAt), e = Date.parse(r.endsAt);
      r.status = now < s ? 'upcoming' : now >= e ? 'completed' : 'active';
    }
  }
  return out;
}

/** Simulated claims made since the demo epoch. */
function demoClaims(now, demo) {
  if (!demo) return 0;
  return demo.baseClaims + Math.max(0, Math.floor((now - Date.parse(demo.epoch)) / demo.msPerClaim));
}

/** 25% immediate / 75% locked, in integer base units (no units lost or created). */
function splitClaim(amountBase, immediatePct = 25) {
  const immediate = Math.floor((amountBase * immediatePct) / 100);
  return { immediate, locked: amountBase - immediate };
}

/** Global linear vesting state for one beneficiary (all values in base units). */
function vestingState(lockedBase, withdrawnBase, startMs, now, durationDays) {
  const durSec = durationDays * 86_400;
  if (startMs == null || now < startMs) {
    return { status: 'pending', startTs: startMs, endTs: startMs == null ? null : startMs + durSec * 1000, elapsedSec: 0, durationSec: durSec, percent: 0, vested: 0, withdrawn: withdrawnBase, available: 0, locked: lockedBase, remainingLocked: lockedBase };
  }
  const elapsedSec = Math.min(durSec, Math.floor((now - startMs) / 1000));
  const vested = elapsedSec >= durSec ? lockedBase : Math.floor((lockedBase * elapsedSec) / durSec);
  return {
    status: elapsedSec >= durSec ? 'complete' : 'vesting',
    startTs: startMs,
    endTs: startMs + durSec * 1000,
    elapsedSec, durationSec: durSec,
    percent: (elapsedSec / durSec) * 100,
    vested,
    withdrawn: withdrawnBase,
    available: Math.max(0, vested - withdrawnBase),
    locked: lockedBase,
    remainingLocked: lockedBase - vested,
  };
}

/** Bring older claim records up to the 25/75 model. */
function normalizeClaim(c, immediatePct = 25) {
  if (!c) return c;
  if (c.amountBase == null) c.amountBase = toBase(c.amount);
  if (c.immediateBase == null || c.lockedBase == null) {
    const s = splitClaim(c.amountBase, immediatePct);
    c.immediateBase = s.immediate; c.lockedBase = s.locked;
  }
  if (c.withdrawnBase == null) c.withdrawnBase = 0;
  if (!Array.isArray(c.withdrawals)) c.withdrawals = [];
  return c;
}

/** Claim record + live vesting view (what the API returns). */
function claimView(c, vestingStartMs, now, durationDays) {
  if (!c) return null;
  return { ...c, vesting: vestingState(c.lockedBase, c.withdrawnBase, vestingStartMs, now, durationDays) };
}

module.exports = {
  DAY, DECIMALS, UNIT, toBase, fromBase,
  scheduleRounds, demoClaims, claimsToReach,
  splitClaim, vestingState, normalizeClaim, claimView,
};
