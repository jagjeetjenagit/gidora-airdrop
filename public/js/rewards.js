/* Rewards & Referrals page */
(function () {
  'use strict';
  const { api, wallet, fmt, esc, icon, copy, share, LS } = window.GDR;
  const root = document.getElementById('rewards-root');

  const statusBadge = {
    verified: `<span class="badge badge-ok">${icon('check')} Verified</span>`,
    pending: `<span class="badge badge-info">${icon('clock')} Pending verification</span>`,
    review: `<span class="badge badge-warn">${icon('alert')} Under review</span>`,
  };

  function disconnected() {
    root.innerHTML = `<div class="card empty-state">
      <div class="state-icon gold">${icon('link')}</div>
      <h2 class="h4">Connect your wallet to see your rewards</h2>
      <p>Your referral link, verified referrals and reward status are tied to your wallet.</p>
      <button class="btn btn-primary btn-lg" data-action="connect">${icon('wallet')} Connect Wallet</button>
    </div>`;
  }

  async function load() {
    if (wallet.status === 'connecting') {
      root.innerHTML = `<div class="card empty-state"><div class="state-icon gold"><span class="spinner"></span></div><p>Waiting for your wallet…</p></div>`;
      return;
    }
    if (wallet.status !== 'connected') return disconnected();

    root.innerHTML = `<div class="card"><div class="skeleton" style="height:120px"></div></div>`;
    let me;
    try { me = await api('/referrals/me', { auth: true }); }
    catch (e) {
      if (wallet.status !== 'connected') return disconnected();
      root.innerHTML = `<div class="card empty-state"><p>${esc(e.message)}</p><button class="btn btn-ghost" id="rw-retry">Retry</button></div>`;
      document.getElementById('rw-retry').addEventListener('click', load);
      return;
    }

    const link = `${location.origin}/?ref=${me.code}`;
    const pendingRef = LS.get('gdr_ref');

    root.innerHTML = `
    <div class="dash-grid">
      <div class="card">
        <div class="claim-top"><h2 class="claim-title">Your referral link</h2>${me.rank ? `<a class="badge badge-ok" href="/leaderboard">${icon('trophy')} Rank #${fmt.int(me.rank)}</a>` : '<span class="badge badge-muted">Not ranked yet</span>'}</div>
        <div class="ref-link"><code>${esc(link)}</code>
          <button class="btn btn-primary btn-sm" id="rw-copy">${icon('copy')} Copy</button>
          <button class="icon-btn" id="rw-share" aria-label="Share referral link">${icon('share')}</button>
        </div>
        <p class="muted xsmall mt-2">Referral code: <span class="mono">${esc(me.code)}</span>. A referral counts only after the referred wallet completes a verified claim.</p>
        <div class="ref-stats">
          <div class="ref-stat"><b class="gold">${fmt.int(me.verified)}</b><span>Verified</span></div>
          <div class="ref-stat"><b>${fmt.int(me.pending)}</b><span>Pending</span></div>
          <div class="ref-stat"><b>${fmt.int(me.underReview)}</b><span>Under review</span></div>
        </div>
      </div>

      <div class="card">
        <h2 class="claim-title">Your claim</h2>
        ${me.claim ? `
          <div class="claim-amount-box mt-3"><div class="claim-amount-label">Claimed</div><div class="claim-amount">${fmt.gdr(me.claim.amount)}<small>GDR</small></div></div>
          <dl class="kv"><dt>Claim number</dt><dd>#${fmt.int(me.claim.index)}</dd><dt>Round</dt><dd>Round ${me.claim.round}</dd><dt>Date</dt><dd>${fmt.date(me.claim.at)}</dd></dl>`
        : `<div class="state-body mt-3"><div class="state-icon gold">${icon('gift')}</div><p>You haven't claimed GDR yet.</p><a class="btn btn-primary" href="/#claim">Go to Claim</a></div>`}
      </div>

      <div class="card">
        <h2 class="claim-title">Reward status</h2>
        <ul class="list-plain mt-2">
          <li class="reward-row"><div><div class="strong">Direct referral reward</div><div class="muted xsmall">${me.rewards.ratePercent}% of an eligible fee · one level only</div></div><span class="badge badge-warn">Proposed / subject to final terms</span></li>
          <li class="reward-row"><div><div class="strong">Rewards accrued</div><div class="muted xsmall">Shown once the fee base and asset are final</div></div><span class="muted">—</span></li>
          <li class="reward-row"><div><div class="strong">Rewards paid</div><div class="muted xsmall">With on-chain transaction links</div></div><span class="muted">—</span></li>
          <li class="reward-row"><div><div class="strong">KOL Pool</div><div class="muted xsmall">Provisional · calculated after Round 8, verification &amp; funding</div></div><span class="badge badge-muted">Accumulating</span></li>
        </ul>
      </div>

      <div class="card">
        <h2 class="claim-title">Recent referrals</h2>
        ${me.recent.length ? `<ul class="list-plain mt-2">${me.recent.map((r) => `
          <li class="reward-row"><div><div class="mono strong">${esc(r.referee)}</div><div class="muted xsmall">${fmt.date(r.at)}</div></div>${statusBadge[r.status] || ''}</li>`).join('')}</ul>`
        : `<div class="state-body mt-3"><div class="state-icon info">${icon('users')}</div><p>No referrals yet. Share your link. Referrals show here as soon as someone uses it.</p></div>`}
      </div>

      <div class="card full">
        <h2 class="claim-title">Were you referred by someone?</h2>
        <p class="muted small">If a friend sent you a link, you can add their code before you claim. This can't be changed later.</p>
        <form id="rw-bind" class="calc-row" style="max-width:520px">
          <input class="input" name="code" placeholder="Referral code" value="${esc(pendingRef || '')}" maxlength="16" autocomplete="off" spellcheck="false" ${me.claim ? 'disabled' : ''}>
          <button class="btn btn-ghost" ${me.claim ? 'disabled' : ''}>Apply code</button>
        </form>
        ${me.claim ? '<p class="muted xsmall">Referral codes can only be applied before claiming.</p>' : ''}
      </div>
    </div>`;

    document.getElementById('rw-copy').addEventListener('click', () => copy(link, 'Referral link copied'));
    document.getElementById('rw-share').addEventListener('click', () => share(link, 'Claim your $GDR on GIDORA. Limited like Bitcoin, claimable by everyone.'));
    document.getElementById('rw-bind').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim();
      if (!code) return;
      try {
        await api('/referral/bind', { method: 'POST', auth: true, body: { code } });
        LS.del('gdr_ref');
        window.GDR.toast('Referral code applied', 'ok');
      } catch (err) { window.GDR.toast(err.message, 'err'); }
    });
  }

  document.addEventListener('wallet:change', load);
  load();
})();
