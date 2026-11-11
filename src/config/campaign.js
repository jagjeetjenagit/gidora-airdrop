'use strict';
/**
 * Campaign configuration — the single place to set approved values.
 *
 * Every value that the product owner has NOT yet approved is kept as `null`
 * or flagged `confirmed: false`. The UI renders those as "To be announced"
 * instead of inventing numbers (UI/UX spec §8, Contract spec §12).
 */

const DEMO_MODE = process.env.DEMO_MODE !== 'false';

// Proposed per-round claim fees from the working spec — NOT shown in the UI
// until `feesConfirmed` is set to true.
const PROPOSED_FEES_USD = [3, 3, 5, 5, 6, 6, 8, 8];

const rounds = PROPOSED_FEES_USD.map((fee, i) => ({
  id: i + 1,
  name: `Round ${i + 1}`,
  // 'upcoming' | 'active' | 'completed' — set by operator from approved calendar
  status: 'upcoming', // derived from dates when set (see src/lib/schedule.js)
  startsAt: null, // ISO string once approved
  endsAt: null,
  fee: { amount: fee, currency: 'USD-equivalent', confirmed: false },
}));

module.exports = {
  DEMO_MODE,
  // Demo-only simulation parameters (ignored when DEMO_MODE=false)
  demo: DEMO_MODE ? {
    scheduleStart: '2026-11-01T00:00:00Z', // rolling 8-round demo calendar
    roundDays: 14,
    epoch: '2026-11-11T12:00:00Z',
    baseClaims: 98_678, // matches the Figma counter tiles
    msPerClaim: 20000, // ~4,300 simulated claims/day
  } : null,
  brand: {
    name: 'GIDORA',
    ticker: 'GDR',
    tagline: 'Limited like Bitcoin, Claimable by Everyone.',
  },
  network: {
    name: 'Solana',
    cluster: process.env.SOLANA_CLUSTER || 'mainnet-beta',
    explorer: 'https://solscan.io',
  },
  token: {
    totalSupply: 21_000_000,
    claimAllocation: 10_000_000,
    mint: process.env.GDR_MINT || null, // publish once deployed
    programId: process.env.CLAIM_PROGRAM_ID || null,
    // Estimated reference value used for USD display (client-provided estimate, not a market price)
    estPriceUsd: Number(process.env.GDR_EST_PRICE_USD || 22),
  },
  rounds,
  minimumBalance: {
    // ~ $5 equivalent discussed; asset, oracle & enforcement TBD
    description: 'A small SOL balance is required for Solana network fees.',
    thresholdConfirmed: false,
  },
  referral: {
    ratePercent: 25,
    confirmed: false, // "Proposed / subject to final terms"
    levels: 1,
  },
  kolPool: {
    capUsdc: 6_900_000,
    funded: false,
    status: 'proposed', // proposed | accumulating | verification | finalized | funded | distribution | completed
    // Known examples only — full tier schedule pending
    knownTiers: [
      { referrals: 100, poolUsdc: 10_000 },
      { referrals: 200, poolUsdc: 20_000 },
      { referrals: 50_000, poolUsdc: 3_000_000 },
    ],
    // Demo tier schedule (known tiers + illustrative intermediate tiers summing to the 6.9M cap)
    demoTiers: [
      { referrals: 100, poolUsdc: 10_000 },
      { referrals: 200, poolUsdc: 20_000 },
      { referrals: 500, poolUsdc: 50_000 },
      { referrals: 1_000, poolUsdc: 100_000 },
      { referrals: 5_000, poolUsdc: 500_000 },
      { referrals: 10_000, poolUsdc: 1_000_000 },
      { referrals: 25_000, poolUsdc: 2_220_000 },
      { referrals: 50_000, poolUsdc: 3_000_000 },
    ],
  },
  links: {
    support: process.env.SUPPORT_URL || '#faq',
    x: process.env.X_URL || null,
    telegram: process.env.TELEGRAM_URL || null,
  },
};
