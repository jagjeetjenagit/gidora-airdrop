'use strict';
/**
 * Round schedule + demo activity model.
 *
 * - When rounds have approved dates, status is derived from the clock.
 * - In DEMO mode without dates, a rolling 8-round demo schedule is generated
 *   so the countdown always shows a live round.
 * - In DEMO mode the claim counter grows at a steady simulated rate so the
 *   site feels live. Every figure is labelled as sample data in the UI.
 *
 * This file is also serialised into the static (GitHub Pages) build, so it
 * must stay dependency-free.
 */

const DAY = 86_400_000;

function scheduleRounds(rounds, now, demo) {
  const out = rounds.map((r) => ({ ...r }));
  const hasDates = out.every((r) => r.startsAt && r.endsAt);

  if (!hasDates && demo) {
    const len = demo.roundDays * DAY;
    const cycle = len * out.length;
    const base = Date.parse(demo.scheduleStart);
    const k = Math.max(0, Math.floor((now - base) / cycle));
    const start = base + k * cycle;
    out.forEach((r, i) => {
      r.startsAt = new Date(start + i * len).toISOString();
      r.endsAt = new Date(start + (i + 1) * len).toISOString();
      r.demoSchedule = true;
    });
  }

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

module.exports = { scheduleRounds, demoClaims, DAY };
