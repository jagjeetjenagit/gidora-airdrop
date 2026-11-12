/* GIDORA · Vesting & Withdrawals (Step 2, separate from the one-time claim)
   Master spec: 25% sent at claim, 75% locked. The locked part vests linearly
   over 90 days from ONE global start (campaign finalization). Withdraw the
   vested, not-yet-withdrawn balance as often as you like.
   Math mirrors src/lib/schedule.js (the on-chain program stays authoritative). */
(function () {
  'use strict';
  const { api, wallet, fmt, esc, icon, toast, modal, DEMO } = window.GDR;
  const $ = (sel, root = document) => root.querySelector(sel);

  const UNIT = 1e6;
  let st = { connected: false, claim: null, campaign: null };
  let busy = false;
  let simDay = null; // demo: last simulated day

  const g = (base, d = 4) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(base / UNIT);
  const pad = (n) => String(n).padStart(2, '0');
  function dhms(ms) {
    ms = Math.max(0, ms);
    const d = Math.floor(ms / 864e5); ms -= d * 864e5;
    const h = Math.floor(ms / 36e5); ms -= h * 36e5;
    const m = Math.floor(ms / 6e4); const s = Math.floor((ms - m * 6e4) / 1000);
    return `<b>${pad(d)}d</b><b>${pad(h)}h</b><b>${pad(m)}m</b><b>${pad(s)}s</b>`;
  }

  // live vesting math (same formula as the program / schedule.js)
  function live() {
    const c = st.claim, V = st.campaign.vesting;
    const L = c.lockedBase, W = c.withdrawnBase;
    const start = V.startTs, dur = V.durationDays * 86400;
    if (start == null || Date.now() < start) return { status: 'pending', vested: 0, available: 0, withdrawn: W, locked: L, remaining: L, percent: 0, start, end: null };
    const el = Math.min(dur, Math.floor((Date.now() - start) / 1000));
    const vested = el >= dur ? L : Math.floor((L * el) / dur);
    return { status: el >= dur ? 'complete' : 'vesting', vested, available: Math.max(0, vested - W), withdrawn: W, locked: L, remaining: L - vested, percent: (el / dur) * 100, day: Math.min(V.durationDays, Math.floor(el / 86400)), start, end: start + dur * 1000 };
  }

  function render() {
    const el = $('[data-vesting]');
    if (!el || !st.connected || !st.campaign) return;
    const V = st.campaign.vesting;
    const c = st.claim;
    const v = c ? live() : null;
    const pill = !c ? '<span class="vs-pill r">● Not claimed</span>'
      : v.status === 'pending' ? '<span class="vs-pill y">● Awaiting campaign finalization</span>'
        : v.status === 'vesting' ? `<span class="vs-pill g">● Vesting · Day ${v.day} of ${V.durationDays}</span>`
          : '<span class="vs-pill g">● Fully vested</span>';
    const L = c ? c.lockedBase : 0;
    const vestedPct = c && L ? (v.vested / L) * 100 : 0;
    const wdPct = c && L ? (v.withdrawn / L) * 100 : 0;

    el.className = 'fx-panel fx-vesting';
    el.innerHTML = `
      <div class="vs-head">
        <div><span class="vs-step">Step 2</span><h3>Vesting &amp; Withdrawals</h3></div>
        ${pill}
      </div>
      <p class="vs-sub">Your one-time airdrop claim sends <b>${V.immediatePct}%</b> to your wallet immediately. The other <b>${V.lockedPct}%</b> is locked and unlocks linearly over <b>${V.durationDays} days</b>, starting at one global time for everyone.</p>

      <div class="vs-grid">
        <div class="vs-cell"><span>Total allocation</span><b>${c ? g(c.amountBase) : '—'} <small>GDR</small></b></div>
        <div class="vs-cell"><span>Received at claim (${V.immediatePct}%)</span><b class="g">${c ? g(c.immediateBase) : '—'} <small>GDR</small></b></div>
        <div class="vs-cell"><span>Locked (${V.lockedPct}%)</span><b>${c ? g(L) : '—'} <small>GDR</small></b></div>
        <div class="vs-cell"><span>Vested so far</span><b data-vs="vested">${c ? g(v.vested, 6) : '—'}</b></div>
        <div class="vs-cell"><span>Previously withdrawn</span><b>${c ? g(v.withdrawn, 6) : '—'}</b></div>
        <div class="vs-cell hi"><span>Available to withdraw</span><b class="g" data-vs="avail">${c ? g(v.available, 6) : '—'}</b></div>
      </div>

      <div class="vs-bar" title="Vested ${vestedPct.toFixed(2)}% · withdrawn ${wdPct.toFixed(2)}%">
        <span class="v" data-vs="bar" style="width:${vestedPct}%"></span><span class="w" style="width:${wdPct}%"></span>
      </div>
      <div class="vs-legend"><span><i class="w"></i>Withdrawn</span><span><i class="v"></i>Vested</span><span><i class="l"></i>Still locked <b data-vs="remaining">${c ? g(v.remaining) : '—'}</b></span></div>

      <div class="vs-clock" data-vs-clock></div>

      <button class="fx-btn-black fx-btn-green vs-withdraw" data-withdraw ${!c || !v.available || busy ? 'disabled' : ''}>
        ${busy ? '<span class="spinner"></span> Processing…' : !c ? 'Claim first' : v.status === 'pending' ? `${icon('lock')} Locked until vesting starts` : v.available ? `Withdraw <span data-vs="btn">${g(v.available, 6)}</span> GDR` : 'Nothing to withdraw yet'}
      </button>

      <h4 class="vs-h4">Withdrawal history</h4>
      <table class="fx-table vs-table">
        <thead><tr><th>Date</th><th class="num">Amount</th><th class="num">Total withdrawn</th><th class="num">Transaction</th></tr></thead>
        <tbody>${c && c.withdrawals.length ? c.withdrawals.map((w) => `<tr>
          <td>${fmt.date(w.at)} <span class="muted xsmall">${fmt.time(w.at)}</span></td>
          <td class="num g">+${g(w.amountBase, 6)}</td>
          <td class="num">${g(w.cumulativeBase, 6)}</td>
          <td class="num mono" title="${esc(w.signature)}">${esc(fmt.short(w.signature))}${w.demo ? ' <span class="muted xsmall">demo</span>' : ''}</td>
        </tr>`).join('') : `<tr><td colspan="4" class="c muted" style="padding:18px 6px">No withdrawals yet.</td></tr>`}</tbody>
      </table>

      ${DEMO ? `<div class="vs-demo">
        <span>Demo · simulate global vesting:</span>
        ${[['null', 'Not finalized'], [0, 'Day 0'], [1, 'Day 1'], [30, 'Day 30'], [60, 'Day 60'], [90, 'Day 90']].map(([d, l]) => `<button data-vs-day="${d}" class="${(d === 'null' ? V.startTs == null : V.startTs != null && simDay === d) ? 'on' : ''}">${l}</button>`).join('')}
      </div>` : ''}
      <div class="fx-foot-bar">${esc(V.trigger)}${V.triggerConfirmed ? '' : ' (Trigger pending final confirmation.)'} Amounts in GDR base units (${V.decimals} decimals${V.decimalsConfirmed ? '' : ', assumed'}).</div>`;

    const b = $('[data-withdraw]', el);
    if (b && c && v.available) b.addEventListener('click', confirmWithdraw);
    el.querySelectorAll('[data-vs-day]').forEach((x) => x.addEventListener('click', () => simulate(x.dataset.vsDay === 'null' ? null : Number(x.dataset.vsDay))));
    if (!c) {
      el.classList.add('fx-locked');
      el.insertAdjacentHTML('beforeend', `<div class="fx-lock"><div class="lk">${icon('lock')}</div><p>Claim GDR to start your vesting</p><button class="fx-btn-black" data-lk>Claim</button></div>`);
      $('[data-lk]', el).addEventListener('click', () => window.GDRClaim && window.GDRClaim.confirm());
    }
    tick();
  }

  // per-second refresh of the live numbers + global countdown
  let lastStatus = null;
  function tick() {
    const el = $('[data-vesting]');
    if (!el || !st.claim || !st.campaign) {
      const clk = el && $('[data-vs-clock]', el);
      if (clk && st.campaign) clk.innerHTML = pendingClock();
      return;
    }
    const v = live();
    if (lastStatus && lastStatus !== v.status) { lastStatus = v.status; render(); return; }
    lastStatus = v.status;
    const set = (k, val) => { const n = $(`[data-vs="${k}"]`, el); if (n) n.textContent = val; };
    set('vested', g(v.vested, 6));
    set('avail', g(v.available, 6));
    set('btn', g(v.available, 6));
    set('remaining', g(v.remaining));
    const bar = $('[data-vs="bar"]', el);
    if (bar) bar.style.width = `${st.claim.lockedBase ? (v.vested / st.claim.lockedBase) * 100 : 0}%`;
    const btn = $('[data-withdraw]', el);
    if (btn && btn.disabled && v.available > 0 && !busy && v.status !== 'pending') render();
    const clk = $('[data-vs-clock]', el);
    if (!clk) return;
    if (v.status === 'pending') clk.innerHTML = pendingClock();
    else if (v.status === 'vesting') clk.innerHTML = `<div class="vs-clock-row"><span>Global vesting countdown · fully unlocked in</span><div class="fx-countdown">${dhms(v.end - Date.now())}</div></div><div class="muted xsmall">Started ${fmt.date(new Date(v.start).toISOString())} ${fmt.time(new Date(v.start).toISOString())}${st.campaign.vesting.simulated ? ' (demo simulation)' : ''} · ends ${fmt.date(new Date(v.end).toISOString())}</div>`;
    else clk.innerHTML = `<div class="vs-clock-row"><span class="g">✓ Vesting complete. All locked GDR is unlocked.</span></div>`;
  }
  function pendingClock() {
    const s = st.campaign.stats;
    const pct = (s.distributed / st.campaign.curve.budget) * 100;
    return `<div class="vs-clock-row"><span>Global vesting countdown starts when the campaign is finalized</span><span class="mono">${pct.toFixed(2)}% distributed</span></div>
      <div class="fx-bar vs-camp"><span style="width:${pct}%"></span></div>
      <div class="muted xsmall">${fmt.int(s.distributed)} / ${fmt.int(st.campaign.curve.budget)} GDR distributed. The 90-day timer is global, so nobody starts an individual timer at claim.</div>`;
  }
  setInterval(tick, 1000);

  // ------------------------------------------------------------ withdraw
  function confirmWithdraw() {
    const v = live();
    if (!v.available) return;
    const d = modal.open(`
      <div class="modal-head"><h3 id="app-modal-title">Withdraw vested GDR</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="claim-amount-box mt-2">
        <div class="claim-amount-label">Available now</div>
        <div class="claim-amount" style="color:var(--green)">${g(v.available, 6)}<small>GDR</small></div>
        <div class="muted xsmall mt-2">Vesting withdrawal · not an airdrop claim</div>
      </div>
      <dl class="kv">
        <dt>Beneficiary</dt><dd class="mono">${esc(fmt.short(wallet.address))}</dd>
        <dt>Vested so far</dt><dd>${g(v.vested, 6)} GDR</dd>
        <dt>Already withdrawn</dt><dd>${g(v.withdrawn, 6)} GDR</dd>
        <dt>Still locked after this</dt><dd>${g(v.remaining, 6)} GDR</dd>
        <dt>Network fee</dt><dd>~0.000005 SOL</dd>
      </dl>
      <p class="muted xsmall">Only the vested, not-yet-withdrawn balance is sent. You can withdraw again any time as more unlocks.</p>
      <div class="claim-actions mt-3" style="grid-template-columns:1fr 1.4fr">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="btn-wd">Withdraw</button>
      </div>`);
    $('#btn-wd', d).addEventListener('click', submitWithdraw);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function submitWithdraw() {
    busy = true; render();
    const d = modal.open(`
      <div class="modal-head"><h3 id="app-modal-title">Processing withdrawal</h3></div>
      <p class="muted small">Keep this window open.${DEMO ? ' Demo: no real transaction is sent.' : ''}</p>
      <ol class="fx-paysteps">
        <li data-st="1"><span class="s"></span>Approve withdraw_vested in your wallet</li>
        <li data-st="2"><span class="s"></span>Program verifies beneficiary and vested balance</li>
        <li data-st="3"><span class="s"></span>Transferring GDR to your wallet</li>
      </ol>`);
    const step = (n, s) => { const li = d.querySelector(`[data-st="${n}"]`); if (li) li.className = s; };
    try {
      step(1, 'run'); await wait(DEMO ? 1000 : 0); step(1, 'done');
      step(2, 'run'); await wait(DEMO ? 800 : 0); step(2, 'done');
      step(3, 'run');
      const out = await api('/vesting/withdraw', { method: 'POST', auth: true });
      await wait(DEMO ? 500 : 0); step(3, 'done');
      st.claim = out.claim;
      busy = false;
      d.innerHTML = `<div class="fx-success">
          <div class="big">✓</div>
          <h3>Withdrawal confirmed</h3>
          <p class="muted small"><b class="g">${g(out.withdrawal.amountBase, 6)} GDR</b> sent to your wallet.<br>Total withdrawn: ${g(out.withdrawal.cumulativeBase, 6)} GDR</p>
          <p class="mono xsmall muted">Tx ${esc(fmt.short(out.withdrawal.signature))}${DEMO ? ' (demo)' : ''}</p>
          <button class="btn btn-primary btn-block mt-2" data-close>Done</button>
        </div>`;
      $('[data-close]', d).addEventListener('click', () => modal.close());
      toast(`Withdrew ${g(out.withdrawal.amountBase, 4)} GDR`, 'ok');
      document.dispatchEvent(new CustomEvent('gdr:refresh'));
      render();
    } catch (e) {
      busy = false; render();
      d.innerHTML = `<div class="fx-success">
          <div class="big" style="background:var(--red-soft);color:var(--red)">!</div>
          <h3>Withdrawal not completed</h3>
          <p class="muted small">${esc(e.message || 'Something went wrong.')}</p>
          <button class="btn btn-ghost btn-block mt-2" data-close>Close</button>
        </div>`;
      $('[data-close]', d).addEventListener('click', () => modal.close());
    }
  }

  async function simulate(day) {
    try {
      const out = await api('/demo/vesting', { method: 'POST', body: { day } });
      st.campaign = { ...st.campaign, vesting: out.vesting };
      simDay = day;
      lastStatus = null;
      toast(day === null ? 'Demo: campaign not finalized yet' : `Demo: global vesting started ${day} day${day === 1 ? '' : 's'} ago`, 'info', 2600);
      document.dispatchEvent(new CustomEvent('gdr:refresh'));
      render();
    } catch (e) { toast(e.message, 'err'); }
  }

  document.addEventListener('gdr:campaign', (e) => { if (st.campaign) { st.campaign = e.detail; } });
  document.addEventListener('gdr:dash', (e) => {
    st = { connected: e.detail.connected, claim: e.detail.claim || null, campaign: e.detail.campaign || st.campaign };
    lastStatus = null;
    render();
  });
})();
