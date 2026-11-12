/* GIDORA · Claim page (Figma layout)
   Hero + dashboard on one page. Default state = Unclaimed (red) with referral
   panels locked. Connect → Claim → Pay claim fee → GDR sent → everything turns green. */
(function () {
  'use strict';
  const { api, wallet, fmt, esc, icon, toast, modal, copy, LS, DEMO } = window.GDR;
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const $ = (sel) => document.querySelector(sel);
  const BASE = window.GDR.base;

  let campaign = null;
  let me = null;          // /referrals/me (when connected)
  let claim = null;       // claim record (when claimed)
  let boardPeriod = 'all';
  let claiming = false;
  let checking = false;     // checking claim status right after connect
  let lastTiles = '';

  const connected = () => wallet.status === 'connected';
  const price = () => (campaign && campaign.token.estPriceUsd) || 22;
  const money = (n, d = 2) => '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  const usd = (gdr, d = 2) => money(gdr * price(), d);
  const refLink = () => (me ? `${location.origin}${BASE}?ref=${me.code}` : '');
  const activeRound = () => campaign && campaign.rounds.find((r) => r.status === 'active');
  const claimFee = () => { const r = activeRound(); return r ? (r.fee ? r.fee.amount : r.proposedFeeUsd) : null; };

  // ------------------------------------------------------------ campaign
  async function loadCampaign() {
    try {
      campaign = await api('/campaign');
      renderShared();
      renderClaimBox();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function renderShared() {
    const s = campaign.stats;
    $$('[data-price]').forEach((el) => { el.textContent = price(); });
    const pool = document.getElementById('h-pool');
    if (pool) pool.textContent = usd(campaign.curve.budget, 0);

    const roundsHtml = '<span class="lbl">Round</span>' + campaign.rounds.map((r) =>
      `<span class="r ${r.status === 'active' ? 'on' : r.status === 'completed' ? 'done' : ''}" title="${esc(r.name)} · ${r.status}">${r.id}</span>`).join('');
    $$('[data-rounds]').forEach((el) => { el.innerHTML = roundsHtml; });

    const digits = String(s.claimCount).padStart(6, '0');
    if (digits !== lastTiles) {
      const html = [...digits].map((c, i) => `<span class="t${lastTiles && lastTiles.length === digits.length && lastTiles[i] !== c ? ' flip' : ''}">${c}</span>`).join('');
      $$('[data-tiles]').forEach((el) => { el.innerHTML = html; el.setAttribute('aria-label', `${fmt.int(s.claimCount)} wallets claimed`); });
      lastTiles = digits;
    }
    renderKol();
    tick();
  }

  const pad = (n) => String(n).padStart(2, '0');
  function tick() {
    if (!campaign) return;
    const active = activeRound();
    const next = campaign.rounds.find((r) => r.status === 'upcoming');
    const t = active || next;
    let html = '';
    if (t && t.startsAt) {
      let ms = Math.max(0, Date.parse(active ? t.endsAt : t.startsAt) - Date.now());
      if (ms === 0) { loadCampaign(); return; }
      const d = Math.floor(ms / 864e5); ms -= d * 864e5;
      const h = Math.floor(ms / 36e5); ms -= h * 36e5;
      const m = Math.floor(ms / 6e4); const sec = Math.floor((ms - m * 6e4) / 1000);
      html = `${active ? `${esc(t.name)} ends in` : `${esc(t.name)} starts in`} <b>${pad(d)}d</b><b>${pad(h)}h</b><b>${pad(m)}m</b><b>${pad(sec)}s</b>`;
    }
    $$('[data-countdown]').forEach((el) => { el.innerHTML = html; });
  }
  setInterval(tick, 1000);

  // ------------------------------------------------------------ hero claim card
  function renderClaimBox() {
    if (!campaign) return;
    $$('[data-claimbox]').forEach(renderClaimBoxInto);
  }
  function renderClaimBoxInto(el) {
    const s = campaign.stats;
    const fee = claimFee();

    if (claim) {
      el.innerHTML = `<div class="fx-stack"><div class="fx-stack-inner">
          <h2 class="fx-free">GDR <span class="gold">Free</span> Airdrop</h2>
          <div class="fx-worth" style="color:var(--green);font-weight:600">✓ Successfully Claimed</div>
          <div class="fx-value-box">
            <div class="fx-value g">${usd(claim.amount)}</div>
            <div class="fx-value-sub">${fmt.gdr(claim.amount)} GDR received · claim #${fmt.int(claim.index)}</div>
            <button class="fx-btn-black fx-btn-green" data-goto-ref>Share referral link</button>
          </div>
        </div></div>`;
      el.querySelector('[data-goto-ref]').addEventListener('click', () => $('[data-referral]').scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }

    const btn = !connected()
      ? '<button class="fx-btn-black" data-action="connect">Connect to Claim</button>'
      : checking
        ? `<button class="fx-btn-black" disabled><span class="spinner"></span> Checking claim status…</button>`
        : `<button class="fx-btn-black" data-claim ${claiming ? 'disabled' : ''}>${claiming ? '<span class="spinner"></span> Processing…' : 'Claim $GDR'}</button>`;
    el.innerHTML = `<div class="fx-stack"><div class="fx-stack-inner">
        <h2 class="fx-free">GDR <span class="gold">Free</span> Airdrop</h2>
        <div class="fx-worth">Worth of</div>
        <div class="fx-value-box">
          <div class="fx-value gold">${usd(s.nextAllocation)}</div>
          <div class="fx-value-sub">≈ ${fmt.gdr(s.nextAllocation)} GDR · claim #${fmt.int(s.nextPosition)}</div>
          ${btn}
          ${fee != null ? `<div class="fx-fee-note">Claim fee <b>${money(fee)}</b> · ${esc(activeRound().name)}${campaign.rounds[0].fee ? '' : ' (proposed)'}</div>` : ''}
        </div>
      </div></div>`;
    const b = el.querySelector('[data-claim]');
    if (b) b.addEventListener('click', confirmClaim);
  }

  // ------------------------------------------------------------ KOL + leaderboard
  function renderKol() {
    const tiers = campaign.kolPool.demoTiers || campaign.kolPool.knownTiers;
    const html = `<h3 class="fx-panel-title">KOL Pool Referral Rewards</h3>
      <table class="fx-table fx-kol">
        <thead><tr><th>Referrals</th><th class="c">Split</th><th class="num">USDC Pool</th></tr></thead>
        <tbody>${tiers.map((t) => `<tr><td>${fmt.int(t.referrals)}+</td><td class="c">Equal share</td><td class="num gold">${fmt.int(t.poolUsdc)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="fx-foot-bar">Capped at <b class="gold">$6,900,000 USDC</b> · non-cumulative · paid after Round 8${DEMO ? ' · demo tiers' : ''}</div>`;
    $$('[data-kol]').forEach((el) => { el.innerHTML = html; });
  }

  const MEDALS = ['🥇', '🥈', '🥉'];
  async function renderBoards() {
    let data;
    try {
      const q = new URLSearchParams({ page: 1, size: 7, period: boardPeriod });
      if (wallet.address) q.set('wallet', wallet.address);
      data = await api(`/leaderboard?${q}`);
    } catch { return; }
    const tab = (k, label) => `<button data-period="${k}" class="${boardPeriod === k ? 'on' : ''}">${label}</button>`;
    const rows = data.rows.map((r) => `<tr class="${r.wallet === wallet.address ? 'me' : ''}">
        <td>${r.rank <= 3 ? `<span class="fx-medal">${MEDALS[r.rank - 1]}</span>` : `<span class="fx-rk">${r.rank}</span>`}</td>
        <td class="fx-wallet">${esc(r.display)}</td>
        <td class="num">${fmt.int(r.verified)}</td>
        <td class="num gold">${fmt.int(r.verified * 0.75)}</td>
      </tr>`).join('');
    const html = `<div class="fx-tabs">${tab('all', 'All Time')}${tab('week', 'This week')}${tab('lastweek', 'Last week')}<span class="right">${data.me ? `You: #${fmt.int(data.me.rank)}` : ''}</span></div>
      <table class="fx-table">
        <thead><tr><th>Rank</th><th>User</th><th class="num">Referrals</th><th class="num">Est. USDC</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="fx-foot-bar"><a href="${BASE}leaderboard/">View full leaderboard →</a>${DEMO ? ' · sample data' : ''}</div>`;
    $$('[data-board]').forEach((el) => {
      el.innerHTML = html;
      el.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { boardPeriod = b.dataset.period; renderBoards(); }));
    });
  }

  // ------------------------------------------------------------ lock overlay
  function lock(el, message) {
    el.classList.toggle('fx-locked', !claim);
    if (claim) return;
    const btn = '<button class="fx-btn-black" data-lock-claim>Claim</button>';
    el.insertAdjacentHTML('beforeend', `<div class="fx-lock"><div class="lk">${icon('lock')}</div><p>${esc(message)}</p>${btn}</div>`);
    const b = el.querySelector('[data-lock-claim]');
    if (b) b.addEventListener('click', confirmClaim);
  }

  // ------------------------------------------------------------ dashboard panels
  function renderProfile() {
    const el = $('[data-profile]');
    const claimed = !!claim;
    const round = activeRound();
    el.className = `fx-profile${claimed ? ' claimed' : ''}`;
    el.innerHTML = `
      <div class="fx-avatar" aria-hidden="true"></div>
      <dl class="fx-kv">
        <dt>Wallet</dt><dd>${connected() ? `<span class="mono">${esc(fmt.short(wallet.address))}</span><button class="icon-mini" data-copy-addr title="Copy address">${icon('copy')}</button>` : '<span class="muted">Not connected</span>'}</dd>
        <dt>Status</dt><dd><span class="fx-dot ${claimed ? 'g' : 'r'}"></span><span class="${claimed ? 'fx-st-g' : 'fx-st-r'}">${claimed ? 'Claimed' : 'Unclaimed'}</span></dd>
        <dt>Referral</dt><dd>${claimed && me ? `<span class="fx-pill">${esc(me.code)}</span>` : `<span class="muted">${icon('lock', 'i-inline')} Locked</span>`}</dd>
        <dt>Claim ID</dt><dd><span class="mono">${claimed ? '#' + String(claim.index).padStart(7, '0') : '—'}</span></dd>
      </dl>
      <div class="fx-pv">
        <div>
          <div class="lbl">Airdrop value</div>
          <div class="val ${claimed ? 'g' : 'r'}">${claimed ? usd(claim.amount) : '$0.00'}</div>
          <div class="sub ${claimed ? 'g' : 'r'}">${claimed ? `▲ ${fmt.gdr(claim.amount)} GDR received` : '▼ Not claimed yet'}</div>
        </div>
        <div class="foot">${round ? `${esc(round.name)} · <b>Live</b>` : ''}</div>
      </div>`;
    const c = el.querySelector('[data-copy-addr]');
    if (c) c.addEventListener('click', () => copy(wallet.address, 'Address copied'));
  }

  function renderOverview() {
    const el = $('[data-overview]');
    const v = me ? me.verified : 0, p = me ? me.pending : 0, r = me ? me.underReview : 0;
    const nextTier = [100, 200, 500, 1000].find((t) => t > v) || 1000;
    const s = campaign.stats;
    el.innerHTML = `
      <div>
        <h3>Referral Overview</h3>
        <ul class="fx-legend">
          <li><span class="fx-sq" style="background:var(--gold)"></span>Total referrals<b>${fmt.int(v + p + r)}</b></li>
          <li><span class="fx-sq" style="background:var(--green)"></span>Verified<b>${fmt.int(v)}</b></li>
          <li><span class="fx-sq" style="background:var(--red)"></span>Pending<b>${fmt.int(p + r)}</b></li>
          <li><span class="fx-sq" style="background:#3b82f6"></span>Est. USDC earned<b>${fmt.int(v * 0.75)}</b></li>
        </ul>
        <button class="fx-pillbtn" data-copy-ref>${icon('copy')} Copy referral link</button>
      </div>
      <div>
        <h3>Claim Status</h3>
        <div class="fx-lines">
          <div>Claim: <b class="${claim ? 'fx-st-g' : 'fx-st-r'}">${claim ? 'Completed' : 'Pending'}</b></div>
          <div>${claim ? 'Your position' : 'Next position'}: <b>#${fmt.int(claim ? claim.index : s.nextPosition)}</b></div>
          <div>Fee paid: <b>${claim && claim.feeUsd != null ? money(claim.feeUsd) : '—'}</b></div>
          <div class="fx-bar" title="${v}/${nextTier}"><span style="width:${Math.min(100, (v / nextTier) * 100)}%"></span></div>
          <div class="muted xsmall">${fmt.int(v)} / ${fmt.int(nextTier)} referrals to next KOL tier</div>
        </div>
        <a class="fx-pillbtn" href="${BASE}leaderboard/">${icon('trophy')} View leaderboard</a>
      </div>`;
    el.querySelector('[data-copy-ref]').addEventListener('click', () => claim && copy(refLink(), 'Referral link copied'));
    lock(el, 'Claim GDR to unlock your referral stats');
  }

  function renderReferral() {
    const el = $('[data-referral]');
    const link = refLink() || `${location.origin}${BASE}?ref=XXXXXXXX`;
    const v = me ? me.verified : 0;
    const earned = v * 0.75;
    const msg = encodeURIComponent('Claim your free $GDR airdrop on GIDORA. Limited like Bitcoin, claimable by everyone.');
    const enc = encodeURIComponent(link);
    el.innerHTML = `
      <div class="fx-ref-head"><h3>Referral Rewards</h3><span class="live">Status <b>● LIVE</b></span></div>
      <div class="fx-ref-title">100 USDC Referral Reward</div>
      <div class="fx-ref-sub">Invite friends with your link. Earn <span class="g">25% of eligible fees</span> on direct referrals and climb into the <span class="y">KOL USDC pools</span>.</div>
      <div class="fx-ref-grid">
        <div>
          <div class="fx-field-lbl">Referral link</div>
          <div class="fx-field"><code>${esc(link)}</code><button class="icon-mini" data-copy-link title="Copy link">${icon('copy')}</button></div>
          <div class="fx-field"><code>Code: ${esc(me && claim ? me.code : 'XXXXXXXX')}</code><button class="icon-mini" data-copy-code title="Copy code">${icon('copy')}</button></div>
        </div>
        <div class="fx-lcd">
          <div class="fx-lcd-box"><span class="n">${earned.toFixed(2).padStart(6, '0')}</span><span class="u">USDC</span></div>
          <div class="fx-bar"><span style="width:${Math.min(100, earned)}%"></span></div>
          <small>${earned.toFixed(2)} / 100 USDC milestone</small>
        </div>
      </div>
      <div class="fx-share">Share:
        <a href="https://t.me/share/url?url=${enc}&text=${msg}" target="_blank" rel="noopener" style="background:#229ED9" aria-label="Share on Telegram">TG</a>
        <a href="https://x.com/intent/post?text=${msg}&url=${enc}" target="_blank" rel="noopener" style="background:#111;border:1px solid #333" aria-label="Share on X">X</a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=${enc}" target="_blank" rel="noopener" style="background:#1877F2" aria-label="Share on Facebook">f</a>
        <a href="https://www.reddit.com/submit?url=${enc}&title=${msg}" target="_blank" rel="noopener" style="background:#FF4500" aria-label="Share on Reddit">r</a>
        <a href="https://wa.me/?text=${msg}%20${enc}" target="_blank" rel="noopener" style="background:#25D366" aria-label="Share on WhatsApp">W</a>
      </div>
      <div class="fx-foot-bar">Referrals count once the referred wallet completes a verified claim. Self-referrals are excluded.</div>`;
    if (claim) {
      el.querySelector('[data-copy-link]').addEventListener('click', () => copy(link, 'Referral link copied'));
      el.querySelector('[data-copy-code]').addEventListener('click', () => copy(me.code, 'Referral code copied'));
    }
    lock(el, 'Claim GDR to unlock referral rewards');
  }

  function renderSummary() {
    const el = $('[data-summary]');
    const rows = claim && me && me.recent.length ? me.recent.map((r, i) => `<tr>
        <td>${i < 3 ? `<span class="fx-medal">${MEDALS[i]}</span>` : `<span class="fx-rk">${i + 1}</span>`}</td>
        <td class="fx-wallet">${esc(r.referee)}</td>
        <td>${r.status === 'verified' ? '<span class="fx-st-g">Verified</span>' : r.status === 'review' ? '<span class="gold">Review</span>' : '<span class="fx-st-r">Pending</span>'}</td>
        <td class="num">${fmt.date(r.at)}</td>
        <td class="num gold">${r.status === 'verified' ? '0.75' : '0.00'}</td>
      </tr>`).join('')
      : `<tr><td colspan="5" class="c muted" style="padding:22px 6px">${claim ? 'No referrals yet. Share your link to get started.' : '—'}</td></tr>`;
    el.innerHTML = `<h3 class="fx-panel-title">My Active Referral Summary</h3>
      <table class="fx-table">
        <thead><tr><th>#</th><th>Wallet</th><th>Status</th><th class="num">Date</th><th class="num">USDC</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="fx-foot-bar">Rewards shown are estimates until referral terms are final.</div>`;
    lock(el, 'Claim GDR to see your referrals');
  }

  function renderSteps() {
    $('[data-steps]').innerHTML = `<h3 class="fx-panel-title">Earn USDC in 4 Simple Steps</h3>
      <ol class="fx-steps">
        <li><span><b>Claim your free GDR</b> to unlock your personal referral link.</span></li>
        <li><span><b>Share your link</b> on Telegram, X, WhatsApp or anywhere your community is.</span></li>
        <li><span><b>Friends claim GDR</b> through your link. Each verified claim counts as a referral.</span></li>
        <li><span><b>Earn USDC:</b> 25% of eligible fees plus a share of the KOL pool you qualify for.</span></li>
      </ol>
      <div class="fx-foot-bar">One level only · paid in USDC · subject to final campaign terms</div>`;
  }

  async function renderDashboard(announce = false) {
    if (connected()) {
      checking = true; renderClaimBox();
      const started = Date.now();
      try { me = await api('/referrals/me', { auth: true }); claim = me.claim || null; } catch { me = null; claim = null; }
      if (announce && DEMO) await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - started))));
      checking = false;
      if (announce) toast(claim ? `This wallet already claimed ${fmt.gdr(claim.amount)} GDR` : 'Wallet eligible. You can claim now.', claim ? 'ok' : 'info');
    } else { me = null; claim = null; checking = false; }
    if (!campaign) return;
    // Figma: homepage for guests, dedicated dashboard once connected
    document.getElementById('dashboard').classList.toggle('is-guest', !connected());
    document.getElementById('view-home').hidden = connected();
    renderProfile();
    renderOverview();
    renderReferral();
    renderSummary();
    renderSteps();
    renderClaimBox();
    document.dispatchEvent(new CustomEvent('gdr:dash', { detail: { connected: connected(), claimed: !!claim, refLink: claim ? refLink() : '' } }));
  }

  // ------------------------------------------------------------ pay & claim flow
  function confirmClaim() {
    if (claiming || claim || checking || !campaign) return;
    if (!connected()) { wallet.openPicker(); return; }
    const s = campaign.stats;
    const fee = claimFee() || 0;
    const r = activeRound();
    const d = modal.open(`
      <div class="modal-head"><h3 id="app-modal-title">Claim your GDR</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="claim-amount-box mt-2">
        <div class="claim-amount-label">You will receive</div>
        <div class="claim-amount">${fmt.gdr(s.nextAllocation)}<small>GDR</small></div>
        <div class="muted xsmall mt-2">≈ ${usd(s.nextAllocation)} at the $${price()} estimate · claim #${fmt.int(s.nextPosition)}</div>
      </div>
      <dl class="kv">
        <dt>Wallet</dt><dd class="mono">${esc(fmt.short(wallet.address))}</dd>
        <dt>Round</dt><dd>${esc(r ? r.name : '—')}</dd>
        <dt>Claim fee</dt><dd>${money(fee)}${r && !r.fee ? ' <span class="muted xsmall">(proposed)</span>' : ''}</dd>
        <dt>Network fee</dt><dd>~0.000005 SOL</dd>
      </dl>
      <div class="fx-total"><span>Total to pay</span><span>${money(fee)} + network fee</span></div>
      <div class="claim-actions mt-3" style="grid-template-columns:1fr 1.4fr">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="btn-pay">Pay ${money(fee)} &amp; Claim</button>
      </div>`);
    d.querySelector('#btn-pay').addEventListener('click', () => submitClaim(fee));
  }

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  async function submitClaim(fee) {
    claiming = true; renderClaimBox();
    const d = modal.open(`
      <div class="modal-head"><h3 id="app-modal-title">Processing your claim</h3></div>
      <p class="muted small">Keep this window open. ${DEMO ? 'Demo: no real payment is made.' : ''}</p>
      <ol class="fx-paysteps">
        <li data-st="1"><span class="s"></span>Approve ${money(fee)} payment in your wallet</li>
        <li data-st="2"><span class="s"></span>Payment confirmed on Solana</li>
        <li data-st="3"><span class="s"></span>Sending GDR to your wallet</li>
      </ol>`);
    d.querySelector('.modal-head').insertAdjacentHTML('beforeend', '');
    const step = (n, st) => { const li = d.querySelector(`[data-st="${n}"]`); if (li) li.className = st; };
    try {
      step(1, 'run'); await wait(DEMO ? 1200 : 0); step(1, 'done');
      step(2, 'run'); await wait(DEMO ? 1000 : 0); step(2, 'done');
      step(3, 'run');
      const out = await api('/claim', { method: 'POST', auth: true, body: { ref: LS.get('gdr_ref') } });
      await wait(DEMO ? 600 : 0);
      step(3, 'done');
      LS.del('gdr_ref');
      claim = out.claim;
      claiming = false;
      d.innerHTML = `<div class="fx-success">
          <div class="big">✓</div>
          <h3>Claim successful</h3>
          <p class="muted small">You received <b class="gold">${fmt.gdr(claim.amount)} GDR</b> (≈ ${usd(claim.amount)}). Your referral rewards are now unlocked.</p>
          <button class="btn btn-primary btn-block mt-2" data-close>View my dashboard</button>
        </div>`;
      d.querySelector('[data-close]').addEventListener('click', () => { modal.close(); $('#dashboard').scrollIntoView({ behavior: 'smooth' }); });
      toast(`Claimed ${fmt.gdr(claim.amount)} GDR`, 'ok');
      await loadCampaign();
      await renderDashboard();
      renderBoards();
    } catch (e) {
      claiming = false; renderClaimBox();
      d.innerHTML = `<div class="fx-success">
          <div class="big" style="background:var(--red-soft);color:var(--red)">!</div>
          <h3>Claim not completed</h3>
          <p class="muted small">${esc(e.message || 'Something went wrong.')} You have not been charged.</p>
          <button class="btn btn-ghost btn-block mt-2" data-close>Close</button>
        </div>`;
      d.querySelector('[data-close]').addEventListener('click', () => modal.close());
      if (e.code === 'already_claimed') renderDashboard();
    }
  }

  // ------------------------------------------------------------ wiring
  window.GDRClaim = { confirm: confirmClaim };
  document.addEventListener('wallet:change', () => {
    if (wallet.status === 'connecting') return;
    me = null; claim = null;
    renderBoards();
    if (connected()) window.scrollTo({ top: 0, behavior: 'smooth' });
    renderDashboard(connected());
  });

  const panel = document.getElementById('demo-panel');
  if (panel) {
    const toggle = panel.querySelector(':scope > button');
    toggle.addEventListener('click', () => { const o = panel.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(o)); });
    document.addEventListener('click', (e) => { if (!panel.contains(e.target)) panel.classList.remove('open'); });
    panel.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
      panel.classList.remove('open');
      if (b.dataset.demo === 'disconnect') { wallet.disconnect(); return; }
      if (connected()) await wallet.disconnect();
      wallet.connect('phantom', true);
    }));
  }

  (async () => {
    await loadCampaign();
    await renderDashboard();
    renderBoards();
  })();
  setInterval(() => { if (document.visibilityState === 'visible' && !claiming) loadCampaign(); }, DEMO ? 6000 : 30000);
})();
