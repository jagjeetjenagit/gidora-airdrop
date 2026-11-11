'use strict';
/**
 * Static build for GitHub Pages.
 *
 *   BASE_PATH=/repo-name/ npm run build:static   →  dist/
 *
 * Renders the EJS pages to HTML, copies public/ and injects the campaign
 * config + curve parameters for the in-browser demo API (public/js/static-api.js).
 * The static build always runs in demo (preview) mode.
 */
process.env.DEMO_MODE = 'true';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const config = require('../src/config/campaign');
const curve = require('../src/lib/curve');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
let base = process.env.BASE_PATH || '/';
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base += '/';

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });

const locals = {
  base,
  isStatic: true,
  campaign: config,
  site: { brand: config.brand, demo: true, links: config.links, year: new Date().getFullYear() },
};
const pages = [
  { out: 'index.html', view: 'index', nav: 'claim', title: 'Claim Your GDR' },
  { out: 'leaderboard/index.html', view: 'leaderboard', nav: 'leaderboard', title: 'Airdrop Leaderboard' },
  { out: 'rewards/index.html', view: 'rewards', nav: 'rewards', title: 'Rewards & Referrals' },
  { out: '404.html', view: '404', nav: '', title: 'Page not found' },
];

(async () => {
  for (const p of pages) {
    const html = await ejs.renderFile(path.join(ROOT, 'views', `${p.view}.ejs`), { ...locals, nav: p.nav, title: p.title }, { async: false });
    const file = path.join(OUT, p.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  }

  const publicRound = (r) => ({ id: r.id, name: r.name, status: r.status, startsAt: r.startsAt, endsAt: r.endsAt, fee: r.fee.confirmed ? { amount: r.fee.amount, currency: r.fee.currency } : null, proposedFeeUsd: r.fee.amount });
  const staticConfig = {
    brand: config.brand,
    network: { name: config.network.name, cluster: config.network.cluster, explorer: config.network.explorer },
    token: config.token,
    rounds: config.rounds.map(publicRound), // statuses/dates are computed in-browser by GDRSchedule
    referral: { ratePercent: config.referral.ratePercent, confirmed: config.referral.confirmed, levels: config.referral.levels },
    kolPool: config.kolPool,
    demo: config.demo,
    estPriceUsd: config.token.estPriceUsd,
    curve: { N: curve.N, MAX: curve.MAX, MIN: curve.MIN, BUDGET: curve.BUDGET, K: curve.K },
    curveMeta: { ...curve.meta, first: curve.MAX, last: curve.MIN, positions: curve.N, budget: curve.BUDGET },
  };
  // schedule.js is shared verbatim with the browser so demo logic never drifts
  const scheduleSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'schedule.js'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'js', 'static-config.js'),
    `window.GDR_STATIC_CONFIG = ${JSON.stringify(staticConfig)};\n` +
    `window.GDRSchedule = (function () { var module = { exports: {} };\n${scheduleSrc}\nreturn module.exports; })();\n`);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  console.log(`Static site built → dist/  (base path: ${base})`);
})().catch((e) => { console.error(e); process.exit(1); });
