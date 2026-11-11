# GIDORA (GDR) Phase 1: Claim Airdrop Website

> *Limited like Bitcoin, Claimable by Everyone.*

Node.js website for **Phase 1** of GIDORA: the eight-round GDR claim airdrop, the Airdrop Referral Leaderboard and the Rewards & Referrals dashboard. Phase 2 (pre-sale) and Phase 3 (exchange product) are out of scope.

Built from the client documents (PRD v1.0, Claim Airdrop & Leaderboards UI/UX Spec v1.0, Airdrop/Referral/KOL Smart Contract Spec v1.0). The visual direction comes from the Figma reference (black canvas, graphite cards, GDR gold), cleaned up for clarity, accessibility and compliance with the specs.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000  (auto-reload)
npm test           # curve maths + API tests
npm start          # production
```

Requires Node.js 22+.

## Hosting on GitHub Pages (static preview)

GitHub Pages serves static files only, so it can't run the Node server. For Pages, `npm run build:static` renders every page to HTML in `dist/`. In that build, `public/js/static-api.js` runs the same API rules **inside the browser** (demo mode, saved to localStorage). The campaign config and curve parameters are generated from `src/` at build time, so no values are copied by hand.

**Deploying is automatic:** `.github/workflows/pages.yml` runs the tests, builds and publishes on every push to `main`. The base path (`/<repo>/`) is detected automatically.

One-time setup: **repo → Settings → Pages → Build and deployment → Source: GitHub Actions**.

To preview the Pages build locally:

```bash
BASE_PATH=/gidora-airdrop/ npm run build:static
BASE_PATH=/gidora-airdrop/ npm run preview:static   # http://localhost:4000/gidora-airdrop/
```

Limits of the Pages build: data is per browser, so referrals between different visitors aren't shared, and it is always a preview. For the live campaign, run the Node server (or the on-chain indexer) on a host such as Render, Railway or a VPS.

## Pages

| Route | Purpose |
|---|---|
| `/` | **Claim Airdrop**: hero, live claim card (all states), campaign progress, 8-round timeline, allocation curve and calculator, how it works, referral, KOL pool, FAQ |
| `/leaderboard` | **Airdrop Leaderboard**: summary, Global / My Rank tabs, search, pagination, mobile cards, methodology |
| `/rewards` | **Rewards & Referrals**: referral link (copy/share), verified/pending/under-review counts, claim receipt, reward status, apply referral code |

### Claim-card states
Disconnected → connecting → checking → eligible → confirm modal → pending (wallet approval → confirming) → claimed. Also handled: under review, not eligible (insufficient SOL), round inactive, not live yet, failed (retry), service unavailable and stale data.

## Architecture

```
server.js                 Express app (helmet CSP, compression, EJS views)
src/config/campaign.js    ← ALL campaign values live here (rounds, fees, dates, referral, KOL)
src/lib/curve.js          Progressive allocation curve A(n)
src/lib/solana.js         base58, address validation, ed25519 signature verification
src/lib/store.js          JSON persistence + demo seed (swap for the on-chain indexer)
src/routes/api.js         REST API
views/                    EJS templates (head/footer partials + 3 pages)
public/css/styles.css     Design system (tokens, components, responsive)
public/js/app.js          Wallet connect (Phantom/Solflare/Backpack), session, toasts, modals
public/js/{claim,leaderboard,rewards}.js   Page logic
test/                     node:test suites
```

No front-end framework or build step. The wallet adapters use injected providers directly.

### Wallet verification
Connecting a wallet asks the user to **sign a free message** that includes a server nonce. No transaction is sent. The server verifies the ed25519 signature with Node's `crypto` and issues a short-lived HMAC session token. Claim and referral write endpoints require that token.

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/campaign` | Rounds (fees hidden until confirmed), live stats, curve meta, referral & KOL config |
| GET | `/api/curve` | Downsampled curve points |
| GET | `/api/allocation/:position` | Allocation estimate for a position |
| GET | `/api/session/nonce?wallet=` | Message to sign |
| POST | `/api/session` | `{wallet, signature}` → `{token}` |
| GET | `/api/eligibility/:wallet` | eligible / claimed / review / not_eligible / round_inactive / unavailable |
| POST | `/api/claim` 🔒 | Demo mode only. Production claims go through the audited Solana program |
| POST | `/api/referral/bind` 🔒 | First-touch attribution; rejects self-referral and post-claim binding |
| GET | `/api/referrals/me` 🔒 | Code, counts, rank, claim, reward status |
| GET | `/api/leaderboard?page=&size=&q=&wallet=` | Ranked verified referrals |

## Allocation curve (important finding)

The spec fixes three constraints: **A(1) = 21 GDR**, **A(10,000,000) = 0.21 GDR**, and **ΣA(n) = 10,000,000 GDR**.

A simple exponential decay between 21 and 0.21 would hand out about **45M GDR**, which is 4.5× the budget. This build uses a power-decay curve that meets all three constraints:

```
A(n) = 0.21 + 20.79 × (1 − (n−1)/(N−1))^k,   k ≈ 25.316
```

The tests check it exhaustively over all 10M positions: the sum comes to 10,000,000.003 GDR and the curve never increases. The site labels it **illustrative**. The tokenomics owner still has to approve the final formula, and the on-chain program must implement it with integer maths.

## Demo mode (MVP) vs. live

`DEMO_MODE=true` (the default) is the **clickable MVP**. Everything works end to end, and everything is simulated:
- **Every wallet button connects.** If Phantom, Solflare or Backpack is installed it is used for real (with a signed-message check). Otherwise a simulated wallet of that type connects. Claims always succeed and are marked *Simulated (demo)*.
- **Live feel:** a rolling 8-round demo calendar (14-day rounds) drives the countdown, the claim counter grows every 3 s, and there are 24h deltas (green ▲ / red ▼) and a live-claims ticker. All of it is generated by `src/lib/schedule.js`, which the static build also reuses.
- **"Demo states" button** (bottom-left of the Claim page) previews every claim-card state: under review, insufficient SOL, not eligible, failed, round closed, service down, and more.
- A top banner says the whole build is a simulated MVP.

`DEMO_MODE=false` turns all of this off. Rounds then follow `startsAt`/`endsAt` from `src/config/campaign.js`, and `/api/claim` returns 501 until the on-chain program is connected.

## Going live checklist

These are product decisions the specs list as open. Set them in `src/config/campaign.js` or `.env`:

- [ ] Official **logo** export: replace `public/img/logo.svg` and `favicon.svg`. The current mark is redrawn from the Figma reference (three-headed triskelion), because the Figma render was too low-resolution to copy exactly
- [ ] Final **curve formula** (update `src/lib/curve.js` to match the program)
- [ ] **Round dates** (`startsAt`/`endsAt`) and **claim fees**. Set `fee.confirmed: true` to display them
- [ ] **Minimum SOL balance** rule
- [ ] **Referral** fee base, asset and payout timing. Then set `referral.confirmed: true`
- [ ] **KOL pool** full tier schedule and funding status
- [ ] `GDR_MINT`, `CLAIM_PROGRAM_ID`, `SESSION_SECRET`, social/support links
- [ ] Replace `src/lib/store.js` with the indexer that reads on-chain `ClaimRecord` / `ReferralRecord` accounts
- [ ] Wire the claim button to the program instruction (build tx → `signAndSendTransaction` → show the real signature and explorer link)

## Compliance guardrails built in
- No USD "worth" or market-price figures for GDR.
- Rounds are shown as access windows on one continuous curve, never as reward jumps.
- Unconfirmed fees, dates, referral terms and KOL amounts show as *To be announced* or *Proposed / subject to final terms*.
- SOL network fees are never described as a GDR purchase.
- Referral counts are verified counts only. Clicks don't count.
- Status is never shown by colour alone; every status has a text label and an icon.
