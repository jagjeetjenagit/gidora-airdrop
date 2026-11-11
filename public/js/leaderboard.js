/* Airdrop Leaderboard page */
(function () {
  'use strict';
  const { api, wallet, fmt, esc, icon, identicon, copy, DEMO } = window.GDR;
  const $ = (id) => document.getElementById(id);

  let page = 1;
  let q = (new URLSearchParams(location.search).get('q') || '').trim().slice(0, 64);
  let tab = 'global';
  let data = null;
  const SIZE = 20;

  const statusBadge = (s) => s === 'review'
    ? `<span class="badge badge-warn">${icon('clock')} Under review</span>`
    : `<span class="badge badge-ok">${icon('check')} Verified</span>`;
  const rewardBadge = () => '<span class="badge badge-muted">Pending final terms</span>';
  const rankEl = (r) => `<span class="rank ${r <= 3 ? 'r' + r : ''}">${r}</span>`;

  async function load() {
    const body = $('lb-body');
    body.innerHTML = Array.from({ length: 6 }, () => `<tr><td colspan="5"><div class="skeleton" style="height:22px"></div></td></tr>`).join('');
    $('lb-cards').innerHTML = '';
    try {
      const params = new URLSearchParams({ page, size: SIZE });
      if (q) params.set('q', q);
      if (wallet.address) params.set('wallet', wallet.address);
      data = await api(`/leaderboard?${params}`);

      if (tab === 'me' && data.me && !q) {
        const target = Math.ceil(data.me.rank / SIZE);
        if (target !== page) { page = target; return load(); }
      }
      render();
    } catch (e) {
      body.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>${esc(e.message)}</p><button class="btn btn-ghost btn-sm" id="lb-retry">Retry</button></div></td></tr>`;
      $('lb-retry')?.addEventListener('click', load);
      $('lb-updated').innerHTML = `<span class="badge badge-warn">${icon('alert')} Data update delayed</span>`;
    }
  }

  function render() {
    const { summary, rows, me } = data;
    $('lb-participants').textContent = fmt.int(summary.participants);
    $('lb-verified').textContent = fmt.int(summary.verifiedReferrals);
    $('lb-period').textContent = summary.period;
    $('lb-updated').textContent = `Last updated ${fmt.time(data.updatedAt)}${DEMO ? ' · Illustrative sample data' : ''}`;

    renderMe(me);

    if (tab === 'me' && wallet.status !== 'connected') {
      const msg = `<div class="empty-state"><h3>See your rank</h3><p>Connect your wallet to find your position on the leaderboard.</p><button class="btn btn-primary" data-action="connect">${icon('wallet')} Connect Wallet</button></div>`;
      $('lb-body').innerHTML = `<tr><td colspan="5">${msg}</td></tr>`;
      $('lb-cards').innerHTML = msg;
      $('lb-pager').innerHTML = '';
      return;
    }
    if (tab === 'me' && !me) {
      const msg = `<div class="empty-state"><h3>No rank yet</h3><p>You'll appear here once someone you referred completes a verified claim.</p><a class="btn btn-primary" href="${window.GDR.base}rewards/">${icon('link')} Get your referral link</a></div>`;
      $('lb-body').innerHTML = `<tr><td colspan="5">${msg}</td></tr>`;
      $('lb-cards').innerHTML = msg;
      $('lb-pager').innerHTML = '';
      return;
    }

    if (!rows.length) {
      const msg = `<div class="empty-state"><h3>No results</h3><p>${q ? 'No wallet matches that search.' : 'No verified referrals yet. Rankings appear after the first verified referral.'}</p></div>`;
      $('lb-body').innerHTML = `<tr><td colspan="5">${msg}</td></tr>`;
      $('lb-cards').innerHTML = msg;
    } else {
      $('lb-body').innerHTML = rows.map((r) => {
        const isMe = wallet.address && r.wallet === wallet.address;
        return `<tr class="${isMe ? 'is-me' : ''}">
          <td>${rankEl(r.rank)}</td>
          <td><div class="wallet-cell">${identicon(r.wallet)}<span title="${esc(r.wallet)}">${esc(r.display)}</span>${isMe ? '<span class="badge badge-ok">You</span>' : ''}<button class="icon-btn" style="width:28px;height:28px" data-copy="${esc(r.wallet)}" aria-label="Copy address">${icon('copy', 'i i-inline')}</button></div></td>
          <td class="num"><strong>${fmt.int(r.verified)}</strong></td>
          <td>${statusBadge(r.status)}</td>
          <td>${rewardBadge()}</td>
        </tr>`;
      }).join('');
      $('lb-cards').innerHTML = rows.map((r) => {
        const isMe = wallet.address && r.wallet === wallet.address;
        return `<div class="lb-row-card ${isMe ? 'is-me' : ''}">
          ${rankEl(r.rank)}
          <div class="wallet-cell">${identicon(r.wallet, 24)}<span>${esc(r.display)}</span>${isMe ? '<span class="badge badge-ok">You</span>' : ''}</div>
          <div class="count">${fmt.int(r.verified)}<div class="muted xsmall" style="font-family:var(--font);font-weight:500">referrals</div></div>
          <div class="meta">${statusBadge(r.status)}</div>
        </div>`;
      }).join('');
    }
    document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, 'Address copied')));
    renderPager();
  }

  function renderMe(me) {
    const el = $('my-rank');
    if (wallet.status !== 'connected') { el.innerHTML = ''; return; }
    if (!me) {
      el.innerHTML = `<div class="my-rank-num">—</div>
        <div class="grow"><div class="strong">Your rank</div><div class="muted small">No verified referrals yet. Share your link to get on the board.</div></div>
        <a class="btn btn-primary btn-sm" href="${window.GDR.base}rewards/">${icon('link')} Get referral link</a>`;
      return;
    }
    const nextTier = [100, 200, 50000].find((t) => t > me.verified);
    el.innerHTML = `<div class="my-rank-num">#${fmt.int(me.rank)}</div>
      <div class="grow"><div class="strong">Your rank · ${fmt.int(me.verified)} verified referrals</div>
      <div class="muted small">${nextTier ? `${fmt.int(nextTier - me.verified)} more to reach the ${fmt.int(nextTier)}-referral example milestone (subject to final tier schedule).` : 'You have passed all published example milestones.'}</div></div>
      <a class="btn btn-ghost btn-sm" href="${window.GDR.base}rewards/">${icon('link')} Referral link</a>`;
  }

  function renderPager() {
    const el = $('lb-pager');
    if (data.pages <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = `<button class="btn btn-ghost btn-sm" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Prev</button>
      <span>Page ${page} of ${data.pages}</span>
      <button class="btn btn-ghost btn-sm" data-p="${page + 1}" ${page >= data.pages ? 'disabled' : ''}>Next</button>`;
    el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
      page = Number(b.dataset.p); load();
      document.querySelector('.lb-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  // tabs
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
    if (tab === 'global') page = 1;
    load();
  }));

  // search (debounced)
  let t;
  $('lb-search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { q = e.target.value.trim(); page = 1; load(); }, 250);
  });

  if (q) $('lb-search').value = q;
  document.addEventListener('wallet:change', () => { if (wallet.status !== 'connecting') load(); });
  load();
  setInterval(() => { if (document.visibilityState === 'visible' && !q) load(); }, 60_000);
})();
