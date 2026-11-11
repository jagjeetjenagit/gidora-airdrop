'use strict';
/**
 * Lightweight persistence layer.
 *
 * Production: replace with the indexer/database that reads the on-chain
 * ClaimRecord / ReferralRecord accounts (Contract spec §9). The on-chain state
 * stays authoritative; this layer only powers display & queries.
 *
 * Demo mode: seeds clearly-labelled illustrative data so the client can review
 * every UI state without a deployed program.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { base58Encode } = require('./solana');
const curve = require('./curve');
const config = require('../config/campaign');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

const DEMO_CLAIM_OFFSET = 1_284_516; // illustrative sample claims already "made"

let state = { claims: {}, referrals: {}, codes: {} };
let saveTimer = null;

function load() {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch { /* first run */ }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(state));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) { console.error('store save failed:', e.message); }
  }, 150);
}

const hash = (s) => crypto.createHash('sha256').update(s).digest();

function referralCodeFor(wallet) {
  const code = base58Encode(hash('gdr-ref:' + wallet).subarray(0, 6));
  if (!state.codes[code]) { state.codes[code] = wallet; save(); }
  return code;
}

function walletForCode(code) {
  return typeof code === 'string' ? state.codes[code] || null : null;
}

// ---------- claims ----------
function realClaimCount() { return Object.keys(state.claims).length; }

function claimCount() {
  return (config.DEMO_MODE ? DEMO_CLAIM_OFFSET : 0) + realClaimCount();
}

function getClaim(wallet) { return state.claims[wallet] || null; }

function recordClaim(wallet, { round, demo }) {
  if (state.claims[wallet]) return { error: 'already_claimed', claim: state.claims[wallet] };
  const index = claimCount() + 1; // atomic within this single-threaded process
  if (index > curve.N) return { error: 'campaign_complete' };
  const amount = +curve.allocationAt(index).toFixed(6);
  const claim = {
    wallet, index, amount, round, demo: !!demo,
    at: new Date().toISOString(),
    signature: demo ? null : undefined, // real tx signature comes from the program
  };
  state.claims[wallet] = claim;

  const ref = state.referrals[wallet];
  if (ref && ref.status === 'pending') { ref.status = 'verified'; ref.verifiedAt = claim.at; }
  save();
  return { claim };
}

// ---------- referrals ----------
function bindReferral(referee, code) {
  const referrer = walletForCode(code);
  if (!referrer) return { error: 'unknown_code' };
  if (referrer === referee) return { error: 'self_referral' };
  if (state.referrals[referee]) return { error: 'already_attributed', referral: state.referrals[referee] };
  if (state.claims[referee]) return { error: 'claimed_before_referral' }; // first-touch, before qualifying event
  state.referrals[referee] = { referrer, status: 'pending', at: new Date().toISOString() };
  save();
  return { referral: state.referrals[referee] };
}

function referralStats(wallet) {
  const rows = Object.entries(state.referrals).filter(([, r]) => r.referrer === wallet);
  const count = (s) => rows.filter(([, r]) => r.status === s).length;
  return {
    verified: count('verified'),
    pending: count('pending'),
    underReview: count('review'),
    recent: rows
      .sort((a, b) => (b[1].at > a[1].at ? 1 : -1))
      .slice(0, 10)
      .map(([referee, r]) => ({ referee, status: r.status, at: r.at })),
  };
}

// ---------- leaderboard ----------
let demoBoard = null;
function demoLeaderboard() {
  if (demoBoard) return demoBoard;
  const rows = [];
  for (let i = 0; i < 240; i++) {
    const h = hash('demo-wallet-' + i);
    const wallet = base58Encode(h);
    // long-tail distribution, deterministic
    const r = h.readUInt32BE(0) / 0xffffffff;
    const verified = Math.max(1, Math.floor(1800 * Math.pow(r, 6) + 40 * r));
    rows.push({ wallet, verified, status: h[5] % 13 === 0 ? 'review' : 'verified', sample: true });
  }
  demoBoard = rows;
  return rows;
}

function leaderboard() {
  const map = new Map();
  if (config.DEMO_MODE) for (const r of demoLeaderboard()) map.set(r.wallet, { ...r });
  for (const [, ref] of Object.entries(state.referrals)) {
    if (ref.status !== 'verified') continue;
    const row = map.get(ref.referrer) || { wallet: ref.referrer, verified: 0, status: 'verified', sample: false };
    row.verified += 1;
    row.sample = false;
    map.set(ref.referrer, row);
  }
  const rows = [...map.values()]
    .filter((r) => r.verified > 0)
    .sort((a, b) => b.verified - a.verified || (a.wallet < b.wallet ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function _reset() { state = { claims: {}, referrals: {}, codes: {} }; demoBoard = null; }

load();

module.exports = {
  DEMO_CLAIM_OFFSET,
  claimCount, realClaimCount, getClaim, recordClaim,
  referralCodeFor, walletForCode, bindReferral, referralStats,
  leaderboard, _reset,
};
