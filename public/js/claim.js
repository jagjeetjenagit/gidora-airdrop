/* Claim Airdrop page */
(function () {
  'use strict';
  const { api, wallet, fmt, esc, icon, toast, modal, copy, share, LS, DEMO } = window.GDR;

  let campaign = null;
  let elig = null;
  let state = 'loading';
  let lastError = null;
  let stale = false;

  const $ = (id) => document.getElementById(id);
  const card = $('claim-card');

  // ---------------------------------------------------------------- curve math (mirrors server model)
  const curve = {
    k: 25.316, N: 10_000_000, MAX: 21, MIN: 0.21,
    at(n) { const x = (n - 1) / (this.N - 1); return this.MIN + (this.MAX - this.MIN) * Math.pow(1 - x, this.k); },
  };

  // ---------------------------------------------------------------- campaign
  async function loadCampaign() {
    try {
      campaign = await api('/campaign');
      stale = false;
      curve.k = campaign.curve.k;
      renderCampaign();
    } catch (e) {
      stale = true;
      if (!campaign) {
        lastError = e;
        setState('error');
      }
      const upd = $('stats-updated');
      if (upd) upd.innerHTML = `<span class="badge badge-warn">${icon('alert')} Data may be out of date</span>`;
    }
  }

  function renderCampaign() {
    const s = campaign.stats;
    const active = campaign.rounds.find((r) => r.status === 'active');

    const pill = $('round-pill');
    pill.classList.toggle('is-live', !!active);
    pill.querySelector('span:last-child').textContent = active ? `${active.name} · Claims open` : 'Claims not open yet';

    // counter digits
    const str = fmt.int(s.claimCount);
    $('claim-counter').innerHTML = [...str].map((c) => (c === ',' ? '<span class="sep" aria-hidden="true">,</span>' : `<span class="digit" aria-hidden="true">${c}</span>`)).join('');
    $('claim-counter').setAttribute('aria-label', `${str} wallets claimed`);

    // progress
    const pct = Math.max(0.4, s.percentDistributed);
    $('progress-fill').style.width = `${Math.min(100, pct)}%`;
    const bar = $('progress-bar');
    bar.setAttribute('aria-valuenow', s.percentDistributed.toFixed(2));
    bar.setAttribute('aria-valuetext', `${s.percentDistributed.toFixed(2)}% distributed`);
    $('s-distributed').textContent = fmt.int(s.distributed);
    $('s-remaining').textContent = fmt.int(s.remaining);
    $('s-claims').textContent = fmt.int(s.claimCount);
    $('s-next').textContent = fmt.gdr(s.nextAllocation);
    $('stats-updated').textContent = `${s.percentDistributed.toFixed(2)}% distributed · updated ${fmt.time(s.updatedAt)}`;

    renderRounds();
    renderChart();
    $('curve-formula').textContent = `${campaign.curve.formula}, k ≈ ${campaign.curve.k.toFixed(2)}`;
    updateCalc();
    if (state === 'loading') onWallet();
    else if (state === 'disconnected') render();
  }

  function renderRounds() {
    const labels = { active: 'Active', completed: 'Completed', upcoming: 'Upcoming' };
    const badge = { active: 'badge-ok', completed: 'badge-muted', upcoming: 'badge-info' };
    $('rounds-list').innerHTML = campaign.rounds.map((r) => {
      const dates = r.startsAt ? `${fmt.date(r.startsAt)}${r.endsAt ? ' – ' + fmt.date(r.endsAt) : ''}` : 'Dates TBA';
      const fee = r.fee ? `Fee ${r.fee.amount} ${esc(r.fee.currency)}` : 'Fee TBA';
      return `<li class="round ${r.status}" ${r.status === 'active' ? 'aria-current="step"' : ''}>
        <div class="round-num"><span>Round</span>${r.id}</div>
        <span class="badge ${badge[r.status]}">${r.status === 'active' ? '<span class="dot"></span>' : ''}${labels[r.status]}</span>
        <div class="round-meta">${dates}<br>${fee}</div>
      </li>`;
    }).join('');
  }

  // ---------------------------------------------------------------- chart
  function renderChart() {
    const el = $('curve-chart');
    const W = 640, H = 400, P = { l: 44, r: 16, t: 16, b: 34 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const x = (n) => P.l + ((n - 1) / (curve.N - 1)) * iw;
    const y = (v) => P.t + ih - (v / 22) * ih;
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const t = Math.pow(i / 200, 1.8);
      const n = Math.round(1 + t * (curve.N - 1));
      pts.push([x(n), y(curve.at(n))]);
    }
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const area = `${line}L${x(curve.N)},${y(0)}L${x(1)},${y(0)}Z`;
    const yTicks = [0, 5, 10, 15, 20];
    const xTicks = [1, 2_500_000, 5_000_000, 7_500_000, 10_000_000];
    const cur = Math.min(curve.N, campaign.stats.nextPosition);
    const cx = x(cur), cy = y(curve.at(cur));
    // claimed region
    const claimedPts = pts.filter((p) => p[0] <= cx);
    const claimedArea = claimedPts.length > 1
      ? `${claimedPts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}L${cx},${cy}L${cx},${y(0)}L${x(1)},${y(0)}Z` : '';

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <defs>
        <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5b70a" stop-opacity=".35"/><stop offset="1" stop-color="#f5b70a" stop-opacity="0"/></linearGradient>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#f5b70a" stroke-opacity=".25" stroke-width="2"/></pattern>
      </defs>
      <g class="grid">${yTicks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
      <g class="axis">
        ${yTicks.map((v) => `<text x="${P.l - 10}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
        ${xTicks.map((n, i) => `<text x="${x(n)}" y="${H - 10}" text-anchor="${i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}">${n === 1 ? '#1' : fmt.compact(n)}</text>`).join('')}
      </g>
      <path d="${area}" fill="url(#ga)"/>
      ${claimedArea ? `<path d="${claimedArea}" fill="url(#hatch)"/>` : ''}
      <path d="${line}" fill="none" stroke="#f5b70a" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      <line x1="${cx}" x2="${cx}" y1="${P.t}" y2="${y(0)}" stroke="#fff" stroke-opacity=".5" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="#fff" stroke="#07080a" stroke-width="2"/>
      <g id="hover" style="display:none"><line id="hl" stroke="#f5b70a" stroke-opacity=".6" vector-effect="non-scaling-stroke"/><circle id="hc" r="5" fill="#f5b70a"/><rect id="hr" rx="6" fill="#22252b" stroke="#353943"/><text id="ht" class="chart-tip"></text></g>
    </svg>`;
    // label for current position (HTML for crisp text)
    const svg = el.querySelector('svg');
    const label = `Now: #${fmt.int(cur)} → ${fmt.gdr(curve.at(cur))} GDR`;
    svg.insertAdjacentHTML('beforeend', `<text x="${Math.min(cx + 10, W - 190)}" y="${Math.max(cy - 12, 30)}" class="chart-tip">${label}</text>`);

    // hover
    const hover = svg.querySelector('#hover');
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      if (px < P.l || px > W - P.r) { hover.style.display = 'none'; return; }
      const n = Math.max(1, Math.round(1 + ((px - P.l) / iw) * (curve.N - 1)));
      const v = curve.at(n), hy = y(v);
      hover.style.display = '';
      const hl = svg.querySelector('#hl'); hl.setAttribute('x1', px); hl.setAttribute('x2', px); hl.setAttribute('y1', P.t); hl.setAttribute('y2', y(0));
      const hc = svg.querySelector('#hc'); hc.setAttribute('cx', px); hc.setAttribute('cy', hy);
      const ht = svg.querySelector('#ht'); ht.textContent = `#${fmt.int(n)} · ${fmt.gdr(v)} GDR`;
      const tx = Math.min(px + 10, W - 170), ty = Math.max(hy - 14, 26);
      ht.setAttribute('x', tx + 8); ht.setAttribute('y', ty);
      const hr = svg.querySelector('#hr'); hr.setAttribute('x', tx); hr.setAttribute('y', ty - 16); hr.setAttribute('width', 160); hr.setAttribute('height', 24);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', () => { hover.style.display = 'none'; });
  }

  // ---------------------------------------------------------------- calculator
  const posIn = $('calc-pos'), posRange = $('calc-range');
  function updateCalc(src) {
    let n = parseInt((src || posIn).value, 10);
    if (!Number.isFinite(n)) { $('calc-out').textContent = '—'; return; }
    n = Math.min(curve.N, Math.max(1, n));
    if (src !== posIn) posIn.value = n;
    if (src !== posRange) posRange.value = n;
    $('calc-out').textContent = fmt.gdr(curve.at(n));
  }
  posIn.addEventListener('input', () => updateCalc(posIn));
  posIn.addEventListener('blur', () => { const n = Math.min(curve.N, Math.max(1, parseInt(posIn.value, 10) || 1)); posIn.value = n; updateCalc(posIn); });
  posRange.addEventListener('input', () => updateCalc(posRange));

  // ---------------------------------------------------------------- claim card
  function setState(s) { state = s; render(); }

  const activeRound = () => campaign && campaign.rounds.find((r) => r.status === 'active');

  function header(title, badgeHtml = '') {
    return `<div class="claim-top"><h2 class="claim-title">${title}</h2>${badgeHtml}</div>`;
  }

  function stateBlock(kind, iconId, title, text, actions = '') {
    return `${header('GDR Claim')}
      <div class="state-body">
        <div class="state-icon ${kind}">${icon(iconId)}</div>
        <h3>${title}</h3>
        <p>${text}</p>
      </div>
      <div class="claim-actions">${actions}</div>`;
  }

  function render() {
    const s = campaign && campaign.stats;
    const r = activeRound();
    const roundBadge = r ? `<span class="badge badge-ok"><span class="dot"></span>${esc(r.name)} live</span>` : '<span class="badge badge-muted">Not open</span>';
    let html = '';

    switch (state) {
      case 'loading':
        return;

      case 'disconnected':
        html = `${header('GDR Claim', roundBadge)}
          <div class="claim-amount-box">
            <div class="claim-amount-label">Next claim receives</div>
            <div class="claim-amount">${s ? fmt.gdr(s.nextAllocation) : '—'}<small>GDR</small></div>
            <div class="muted xsmall mt-2">Estimate for claim #${s ? fmt.int(s.nextPosition) : '—'}. Earlier claims receive more.</div>
          </div>
          <dl class="kv">
            <dt>Network</dt><dd>Solana</dd>
            <dt>Claims per wallet</dt><dd>1</dd>
            <dt>Remaining allocation</dt><dd>${s ? fmt.int(s.remaining) : '—'} GDR</dd>
          </dl>
          <div class="claim-actions">
            <button class="btn btn-primary btn-lg btn-block" data-action="connect">${icon('wallet')} Connect Wallet to Check Eligibility</button>
            <p class="muted xsmall center" style="margin:0">Connecting doesn't transfer assets or approve any transaction.</p>
          </div>`;
        break;

      case 'connecting':
        html = stateBlock('gold', 'wallet', 'Waiting for your wallet…', 'Approve the connection, then sign the free verification message in your wallet. No transaction is sent.', `<button class="btn btn-ghost btn-block" disabled><span class="spinner"></span> Connecting</button>`);
        break;

      case 'checking':
        html = `${header('GDR Claim', roundBadge)}
          <div class="state-body">
            <div class="state-icon gold"><span class="spinner"></span></div>
            <h3>Checking eligibility</h3>
            <p>Reviewing claim status and campaign rules for <span class="mono">${esc(fmt.short(wallet.address))}</span>…</p>
          </div>`;
        break;

      case 'eligible': {
        const est = elig.estimate;
        const fee = r && r.fee ? `${r.fee.amount} ${esc(r.fee.currency)}` : 'To be announced';
        html = `${header('GDR Claim', '<span class="badge badge-ok">' + icon('check') + ' Eligible</span>')}
          <div class="claim-amount-box">
            <div class="claim-amount-label">Your estimated allocation</div>
            <div class="claim-amount">${fmt.gdr(est.allocation)}<small>GDR</small></div>
            <div class="muted xsmall mt-2">Estimated · claim position #${fmt.int(est.position)}</div>
          </div>
          <dl class="kv">
            <dt>Wallet</dt><dd class="mono">${esc(fmt.short(wallet.address))}</dd>
            <dt>Round</dt><dd>${esc(r ? r.name : '—')}</dd>
            <dt>Claim fee</dt><dd>${fee}</dd>
            <dt>Network fee</dt><dd>~0.000005 SOL</dd>
          </dl>
          <div class="claim-actions">
            <button class="btn btn-primary btn-lg btn-block" id="btn-claim">${icon('gift')} Claim GDR</button>
            <p class="muted xsmall center" style="margin:0">${esc(est.note)}</p>
          </div>`;
        break;
      }

      case 'pending':
        html = `${header('GDR Claim', '<span class="badge badge-warn">' + icon('clock') + ' Pending</span>')}
          <div class="state-body">
            <div class="state-icon gold"><span class="spinner"></span></div>
            <h3 id="pending-title">Approve in your wallet</h3>
            <p id="pending-text">Check the amount in your wallet, then approve the transaction.</p>
          </div>`;
        break;

      case 'claimed': {
        const c = elig.claim;
        html = `${header('GDR Claim', '<span class="badge badge-ok">' + icon('check-circle') + ' Claimed</span>')}
          <div class="claim-amount-box">
            <div class="claim-amount-label">You claimed</div>
            <div class="claim-amount">${fmt.gdr(c.amount)}<small>GDR</small></div>
          </div>
          <dl class="kv">
            <dt>Claim number</dt><dd>#${fmt.int(c.index)}</dd>
            <dt>Round</dt><dd>Round ${c.round}</dd>
            <dt>Date</dt><dd>${fmt.date(c.at)}</dd>
            <dt>Transaction</dt><dd>${c.signature
              ? `<a href="${campaign.network.explorer}/tx/${encodeURIComponent(c.signature)}" target="_blank" rel="noopener">${esc(fmt.short(c.signature))} ${icon('external', 'i-inline')}</a>`
              : '<span class="badge badge-info">Simulated (demo)</span>'}</dd>
          </dl>
          <div class="claim-actions">
            <button class="btn btn-primary btn-block" id="btn-share-ref">${icon('share')} Share your referral link</button>
            <a class="btn btn-ghost btn-block" href="/rewards">View rewards &amp; referrals ${icon('arrow')}</a>
          </div>`;
        break;
      }

      case 'review':
        html = stateBlock('warn', 'clock', 'Under review', esc(elig.reason || 'This wallet is being reviewed.'),
          `<button class="btn btn-ghost btn-block" id="btn-recheck">Check again</button><a class="btn btn-dark btn-block" href="#faq">Read the FAQ</a>`);
        break;

      case 'not_eligible':
        html = elig.reason === 'insufficient_sol'
          ? stateBlock('warn', 'solana', 'Add SOL for network fees', 'You need a small SOL balance to pay Solana network fees. This is not a GDR purchase. Add SOL to this wallet, then check again.',
            `<button class="btn btn-primary btn-block" id="btn-recheck">I've added SOL. Check again</button><a class="btn btn-dark btn-block" href="#faq">Why do I need SOL?</a>`)
          : stateBlock('err', 'alert', 'Not eligible', esc(elig.message || 'This wallet does not meet the campaign rules.'),
            `<a class="btn btn-ghost btn-block" href="#faq">Read the FAQ</a>`);
        break;

      case 'round_inactive':
        html = stateBlock('info', 'clock', 'No round is open right now', esc(elig.message), `<a class="btn btn-ghost btn-block" href="#rounds">View round timeline</a>`);
        break;

      case 'unavailable':
        html = stateBlock('info', 'shield', 'Claims open soon', esc(elig.message), `<a class="btn btn-ghost btn-block" href="#how-it-works">How the airdrop works</a>`);
        break;

      case 'failed':
        html = stateBlock('err', 'alert', 'Claim not completed', `${esc(lastError ? lastError.message : 'The transaction failed.')} You haven't been charged for a failed claim.`,
          `<button class="btn btn-primary btn-block" id="btn-retry">Try again</button>`);
        break;

      case 'error':
      default:
        html = stateBlock('err', 'alert', 'Can\'t reach the campaign service', 'The network or data service is unavailable. Your wallet and funds are not affected.',
          `<button class="btn btn-ghost btn-block" id="btn-retry-load">Retry</button>`);
    }

    if (stale && state !== 'error') html += `<div class="note note-warn mt-2">${icon('alert')}<p class="xsmall">Live data is delayed. Figures may be out of date.</p></div>`;
    card.innerHTML = html;
    bindCard();
  }

  function bindCard() {
    $('btn-claim')?.addEventListener('click', confirmClaim);
    $('btn-recheck')?.addEventListener('click', checkEligibility);
    $('btn-retry')?.addEventListener('click', checkEligibility);
    $('btn-retry-load')?.addEventListener('click', () => { setState('loading'); loadCampaign(); });
    $('btn-share-ref')?.addEventListener('click', shareRef);
  }

  // ---------------------------------------------------------------- flows
  async function checkEligibility() {
    if (wallet.status !== 'connected') return setState('disconnected');
    setState('checking');
    try {
      elig = await api(`/eligibility/${encodeURIComponent(wallet.address)}`);
      const map = { eligible: 'eligible', claimed: 'claimed', review: 'review', not_eligible: 'not_eligible', round_inactive: 'round_inactive', unavailable: 'unavailable' };
      setState(map[elig.status] || 'error');
      if (elig.status === 'claimed') renderHomeRef();
    } catch (e) {
      lastError = e; setState('error');
    }
  }

  function confirmClaim() {
    const r = activeRound();
    const est = elig.estimate;
    const fee = r && r.fee ? `${r.fee.amount} ${esc(r.fee.currency)}` : 'To be announced';
    const ref = LS.get('gdr_ref');
    const d = modal.open(`
      <div class="modal-head"><h3 id="app-modal-title">Confirm your claim</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <p class="muted small">Check these details. You'll approve the transaction in your wallet next.</p>
      <div class="claim-amount-box mt-2">
        <div class="claim-amount-label">Estimated allocation</div>
        <div class="claim-amount">${fmt.gdr(est.allocation)}<small>GDR</small></div>
      </div>
      <dl class="kv">
        <dt>Wallet</dt><dd class="mono">${esc(fmt.short(wallet.address))}</dd>
        <dt>Network</dt><dd>Solana</dd>
        <dt>Round</dt><dd>${esc(r ? r.name : '—')}</dd>
        <dt>Estimated network fee</dt><dd>~0.000005 SOL</dd>
        <dt>Claim fee</dt><dd>${fee}</dd>
        ${ref ? `<dt>Referred by</dt><dd class="mono">${esc(ref)}</dd>` : ''}
      </dl>
      <div class="note note-warn">${icon('info')}<p class="xsmall">Your final amount depends on the claim position assigned when your transaction confirms. If others confirm first, the amount may be slightly lower.</p></div>
      <div class="claim-actions mt-3" style="grid-template-columns:1fr 1fr">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="btn-confirm">Confirm &amp; approve</button>
      </div>`);
    d.querySelector('#btn-confirm').addEventListener('click', () => { modal.close(); submitClaim(); });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function submitClaim() {
    setState('pending');
    try {
      if (DEMO) await wait(900); // simulates wallet approval
      const t = $('pending-title'), p = $('pending-text');
      if (t) t.textContent = 'Confirming on Solana';
      if (p) p.textContent = 'Usually takes a few seconds. Please keep this page open.';
      if (DEMO) await wait(900);
      const ref = LS.get('gdr_ref');
      const out = await api('/claim', { method: 'POST', auth: true, body: { ref } });
      LS.del('gdr_ref');
      elig = { status: 'claimed', claim: out.claim };
      setState('claimed');
      toast(`Claimed ${fmt.gdr(out.claim.amount)} GDR`, 'ok');
      loadCampaign();
      renderHomeRef();
    } catch (e) {
      if (e.code === 'already_claimed') return checkEligibility();
      lastError = e; setState('failed');
    }
  }

  async function shareRef() {
    try {
      const me = await api('/referrals/me', { auth: true });
      const link = `${location.origin}/?ref=${me.code}`;
      share(link, 'I just claimed $GDR on GIDORA. Limited like Bitcoin, claimable by everyone.');
    } catch (e) { toast(e.message, 'err'); }
  }

  // ---------------------------------------------------------------- home referral card
  async function renderHomeRef() {
    const el = $('home-ref-card');
    if (!el) return;
    if (wallet.status !== 'connected') {
      el.innerHTML = `<div class="state-body">
        <div class="state-icon gold">${icon('link')}</div>
        <h3>Get your referral link</h3>
        <p>Connect your wallet to create your personal link and track verified referrals.</p>
      </div>
      <button class="btn btn-primary btn-block mt-2" data-action="connect">${icon('wallet')} Connect Wallet</button>`;
      return;
    }
    try {
      const me = await api('/referrals/me', { auth: true });
      const link = `${location.origin}/?ref=${me.code}`;
      el.innerHTML = `<div class="claim-top"><h3 class="claim-title">Your referral link</h3>${me.rank ? `<span class="badge badge-ok">Rank #${fmt.int(me.rank)}</span>` : ''}</div>
        <div class="ref-link"><code>${esc(link)}</code>
          <button class="btn btn-ghost btn-sm" data-copy="${esc(link)}">${icon('copy')} Copy</button>
          <button class="icon-btn" data-share="${esc(link)}" aria-label="Share">${icon('share')}</button>
        </div>
        <div class="ref-stats">
          <div class="ref-stat"><b>${fmt.int(me.verified)}</b><span>Verified</span></div>
          <div class="ref-stat"><b>${fmt.int(me.pending)}</b><span>Pending</span></div>
          <div class="ref-stat"><b>${fmt.int(me.underReview)}</b><span>Under review</span></div>
        </div>
        <a href="/rewards" class="btn btn-ghost btn-block mt-3">Open rewards dashboard ${icon('arrow')}</a>`;
      el.querySelector('[data-copy]').addEventListener('click', (e) => copy(e.currentTarget.dataset.copy, 'Referral link copied'));
      el.querySelector('[data-share]').addEventListener('click', (e) => share(e.currentTarget.dataset.share, 'Claim your $GDR on GIDORA. Limited like Bitcoin, claimable by everyone.'));
    } catch { /* handled by toast in api */ }
  }

  // ---------------------------------------------------------------- wire up
  function onWallet() {
    if (!campaign) return;
    if (wallet.status === 'connecting') setState('connecting');
    else if (wallet.status === 'connected') checkEligibility();
    else { elig = null; setState('disconnected'); }
    renderHomeRef();
  }
  document.addEventListener('wallet:change', onWallet);

  loadCampaign();
  setInterval(() => { if (document.visibilityState === 'visible') loadCampaign(); }, 30_000);
})();
