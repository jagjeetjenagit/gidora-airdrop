/* GIDORA · Social connect + community feed (demo MVP)
   Unlocks once the wallet has claimed (dashboard turns green):
   1. Social Connect bar: link X and Telegram (simulated OAuth / Telegram login).
   2. Community feed: read posts from X, Telegram and GIDORA holders, and post
      your own (optionally "shared" to the linked X / Telegram accounts).
   Everything is stored in localStorage per wallet. No real network calls. */
(function () {
  'use strict';
  const { wallet, esc, icon, toast, modal, LS } = window.GDR;
  const $ = (sel, root = document) => root.querySelector(sel);

  const NET = {
    x: { name: 'X', full: 'X (Twitter)', color: '#000', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
    tg: { name: 'Telegram', full: 'Telegram', color: '#229ED9', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.78 15.27 9.6 19.3c.4 0 .57-.17.78-.38l1.88-1.8 3.9 2.86c.71.4 1.22.19 1.41-.66l2.56-12c.23-1.05-.38-1.46-1.07-1.2L4.2 11.8c-1.02.4-1 .97-.17 1.23l3.86 1.2 8.96-5.65c.42-.28.8-.12.49.15z"/></svg>' },
    gidora: { name: 'GIDORA', full: 'GIDORA', color: '#C29600', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c3 4.2 6 7.6 6 11.2A6 6 0 0 1 6 13.2C6 9.6 9 6.2 12 2z"/></svg>' },
  };

  let state = { connected: false, claimed: false, refLink: '' };
  let filter = 'all';
  let liveTimer = null;
  let posting = false;

  // ------------------------------------------------------------ storage
  const socialKey = () => `gdr_social_${wallet.address}`;
  const getSocial = () => (wallet.address && LS.get(socialKey())) || {};
  const setSocial = (v) => LS.set(socialKey(), v);
  const linked = () => { const s = getSocial(); return ['x', 'tg'].filter((k) => s[k]); };
  const myPosts = () => (LS.get('gdr_feed_posts') || []);
  const likes = () => new Set((LS.get('gdr_feed_likes') || []));

  // ------------------------------------------------------------ seeded community feed
  const SEED = [
    ['x', 'solana_sam', 'Sam | SOL maxi', 'Just claimed my $GDR. Round 1 allocation is wild, earlier claims really do get more. #GIDORA #Solana', 4, 128, 31],
    ['tg', 'cryptoneha', 'Neha', 'Claim took less than a minute with Phantom. Fee was $3, network fee basically nothing. 🔥', 9, 64, 12],
    ['gidora', 'gdr_team', 'GIDORA', 'Round 1 is live. 10,000,000 GDR for 10,000,000 wallets. Limited like Bitcoin, claimable by everyone. #GDR', 22, 912, 240],
    ['x', 'degen_dao', 'Degen DAO', 'Looking at the allocation curve: claim #1 gets 21 GDR and it decays toward 0.21. Do not sleep on the early rounds. #GIDORA', 37, 211, 58],
    ['tg', 'web3_rahul', 'Rahul', 'Got my first 3 verified referrals today. KOL tier at 100 referrals is the goal 💪', 51, 45, 6],
    ['x', 'mia_onchain', 'Mia ◎', 'Love that there is a referral leaderboard with weekly resets. Finally a fair shot for smaller accounts. #GDR', 68, 97, 19],
    ['gidora', 'gdr_team', 'GIDORA', 'Reminder: connecting your wallet never moves funds. Only approve the claim transaction you started yourself. Stay safe. 🛡️', 95, 540, 133],
    ['tg', 'alpha_hunter', 'Alpha Hunter', 'Telegram group is buzzing. Who else is pushing for the 1,000 referral tier this round? #GIDORA', 130, 38, 4],
    ['x', 'nftkaran', 'Karan', 'Claimed, linked my X, and now posting straight from the GIDORA dashboard. Smooth UX. #GDR', 190, 72, 9],
  ];
  const LIVE = [
    ['x', 'sol_whale_22', 'SOL Whale', 'Another round, another claim. $GDR community is growing fast. #GIDORA'],
    ['tg', 'anya_crypto', 'Anya', 'Just shared my referral link in 3 groups. Let’s go! 🚀'],
    ['x', 'blockbuilder', 'Block Builder', 'The countdown timer is making me nervous, claiming before the round ends. #GDR'],
    ['tg', 'vikram_eth', 'Vikram', 'Moved from ETH to SOL just for this. Claim done ✅'],
    ['x', 'lunarlabs', 'Lunar Labs', 'Fixed supply, curve-based airdrop, weekly leaderboard. Solid design. #GIDORA #Solana'],
    ['tg', 'priya_defi', 'Priya', 'Anyone else check their position on the leaderboard? Top 50 here 🏆'],
  ];
  let seedCache = null;
  function seedPosts() {
    if (seedCache) return seedCache;
    const now = Date.now();
    seedCache = SEED.map(([src, handle, name, text, minsAgo, lk, rp], i) => ({
      id: `s${i}`, src, handle, name, text, at: now - minsAgo * 60000, likes: lk, reposts: rp, replies: Math.round(lk / 9),
    }));
    return seedCache;
  }
  let livePosts = [];

  // ------------------------------------------------------------ helpers
  function ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'now';
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  }
  function richText(t) {
    return esc(t)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)([#$][A-Za-z][\w]*)/g, '$1<span class="tag">$2</span>')
      .replace(/(^|\s)(@\w+)/g, '$1<span class="mention">$2</span>');
  }
  function avatar(handle, src) {
    let h = 0;
    for (const c of handle) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const bg = src === 'gidora' ? 'linear-gradient(135deg,#CBAA00,#AE6F00)' : `linear-gradient(135deg,hsl(${h % 360} 65% 50%),hsl(${(h >> 5) % 360} 65% 32%))`;
    return `<span class="sf-av" style="background:${bg}">${src === 'gidora' ? NET.gidora.svg : esc(handle[0].toUpperCase())}</span>`;
  }
  const badge = (src) => `<span class="sf-badge ${src}" title="${NET[src].full}">${NET[src].svg}</span>`;

  // ------------------------------------------------------------ social connect bar
  function renderBar() {
    const el = $('[data-social]');
    if (!el) return;
    const s = getSocial();
    const card = (k) => {
      const n = NET[k], acct = s[k];
      return `<div class="sc-card ${acct ? 'on' : ''}">
        <span class="sc-ic ${k}">${n.svg}</span>
        <div class="sc-meta">
          <b>${n.full}</b>
          ${acct ? `<span class="sc-ok" title="Connected as @${esc(acct.handle)}">● @${esc(acct.handle)}</span>` : '<span class="sc-off">Not connected</span>'}
        </div>
        ${acct
          ? `<button class="sc-btn ghost" data-sc-off="${k}">Disconnect</button>`
          : `<button class="sc-btn" data-sc-on="${k}">Connect</button>`}
      </div>`;
    };
    const n = linked().length;
    el.className = 'fx-panel fx-social';
    el.innerHTML = `
      <div class="sc-head">
        <div>
          <h3>Social Connect</h3>
          <p>Link your socials to join the GIDORA community feed, post updates and share your referral link.</p>
        </div>
        <span class="sc-count ${n ? 'g' : ''}">${n}/2 linked</span>
      </div>
      <div class="sc-cards">${card('x')}${card('tg')}</div>`;
    el.querySelectorAll('[data-sc-on]').forEach((b) => b.addEventListener('click', () => connectFlow(b.dataset.scOn)));
    el.querySelectorAll('[data-sc-off]').forEach((b) => b.addEventListener('click', () => disconnectNet(b.dataset.scOff)));
    lockEl(el, !state.claimed, 'Claim GDR to unlock Social Connect', 'claim');
  }

  function lockEl(el, locked, msg, kind) {
    el.classList.toggle('fx-locked', locked);
    if (!locked) return;
    const btns = kind === 'claim'
      ? '<button class="fx-btn-black" data-lk="claim">Claim</button>'
      : `<div class="sc-lock-btns"><button class="sc-btn" data-lk="x">${NET.x.svg} Connect X</button><button class="sc-btn tg" data-lk="tg">${NET.tg.svg} Connect Telegram</button></div>`;
    el.insertAdjacentHTML('beforeend', `<div class="fx-lock ${kind === 'claim' ? '' : 'soft'}"><div class="lk">${icon('lock')}</div><p>${esc(msg)}</p>${btns}</div>`);
    el.querySelectorAll('[data-lk]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.lk === 'claim') { if (window.GDRClaim) window.GDRClaim.confirm(); } else connectFlow(b.dataset.lk);
    }));
  }

  // ------------------------------------------------------------ connect flows (simulated)
  function connectFlow(k) {
    if (!state.claimed) { toast('Claim GDR first to unlock Social Connect', 'info'); return; }
    const n = NET[k];
    const suggestion = ('gdr_' + (wallet.address || 'user').slice(0, 6)).toLowerCase();
    const isX = k === 'x';
    const d = modal.open(`
      <div class="modal-head"><h3 id="app-modal-title">Connect ${n.full}</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="sc-auth">
        <div class="sc-auth-logos"><span class="sc-ic gidora">${NET.gidora.svg}</span><span class="sc-dots">• • •</span><span class="sc-ic ${k}">${n.svg}</span></div>
        <p class="muted small">${isX ? 'GIDORA is requesting access to your X account.' : 'Log in with Telegram to link your account to GIDORA.'}</p>
        <ul class="sc-perms">
          <li>${icon('check-circle')} Read your public profile and username</li>
          <li>${icon('check-circle')} ${isX ? 'Post to X only when you choose to share' : 'Share to Telegram only when you choose to'}</li>
          <li>${icon('check-circle')} We never see your password${isX ? '' : ' or phone contacts'}</li>
        </ul>
        <label class="sc-label" for="sc-handle">${isX ? 'X username' : 'Telegram username'}</label>
        <div class="sc-input"><span>@</span><input id="sc-handle" autocomplete="off" spellcheck="false" maxlength="${isX ? 15 : 32}" value="${esc(suggestion)}"></div>
        <div class="sc-err" id="sc-err" hidden></div>
        <p class="muted xsmall">Demo mode: no real ${n.name} login happens.</p>
      </div>
      <div class="claim-actions mt-3" style="grid-template-columns:1fr 1.4fr">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="sc-go">${isX ? 'Authorize app' : 'Send login request'}</button>
      </div>`);
    const input = $('#sc-handle', d);
    input.focus(); input.select();
    const go = async () => {
      const handle = input.value.trim().replace(/^@/, '');
      const ok = isX ? /^[A-Za-z0-9_]{1,15}$/.test(handle) : /^[A-Za-z0-9_]{5,32}$/.test(handle);
      if (!ok) {
        const err = $('#sc-err', d);
        err.hidden = false;
        err.textContent = isX ? 'Use 1–15 letters, numbers or underscores.' : 'Use 5–32 letters, numbers or underscores.';
        return;
      }
      d.innerHTML = `<div class="sc-wait">
          <span class="sc-ic ${k} big">${n.svg}</span>
          <div class="spinner"></div>
          <b>${isX ? 'Authorizing with X…' : 'Waiting for confirmation in Telegram…'}</b>
          <p class="muted small">${isX ? 'Redirecting back to GIDORA' : `Approve the login request sent to @${esc(handle)}`}</p>
        </div>`;
      await new Promise((r) => setTimeout(r, isX ? 1100 : 1600));
      const s = getSocial();
      s[k] = { handle, at: Date.now() };
      setSocial(s);
      modal.close();
      toast(`${n.full} connected as @${handle}`, 'ok');
      renderAll();
    };
    $('#sc-go', d).addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function disconnectNet(k) {
    const s = getSocial();
    delete s[k];
    setSocial(s);
    toast(`${NET[k].full} disconnected`, 'info');
    renderAll();
  }

  // ------------------------------------------------------------ feed
  function allPosts() {
    const liked = likes();
    return [...livePosts, ...myPosts(), ...seedPosts()]
      .map((p) => ({ ...p, liked: liked.has(p.id), likesN: (p.likes || 0) + (liked.has(p.id) ? 1 : 0) }))
      .sort((a, b) => b.at - a.at);
  }

  function renderFeed() {
    const el = $('[data-feed]');
    if (!el) return;
    const s = getSocial();
    const nets = linked();
    const me = nets.length ? s[nets[0]] : null;
    const posts = allPosts().filter((p) => filter === 'all' || (filter === 'mine' ? p.wallet === wallet.address : p.src === filter));
    const draft = $('#sf-text', el) ? $('#sf-text', el).value : '';
    el.className = 'fx-panel fx-feed';
    el.innerHTML = `
      <div class="sf-head">
        <h3>Community Feed <span class="sf-live">● LIVE</span></h3>
        <div class="sf-tabs" role="tablist">
          ${[['all', 'All'], ['x', 'X'], ['tg', 'Telegram'], ['mine', 'My posts']].map(([k, l]) => `<button role="tab" aria-selected="${filter === k}" class="${filter === k ? 'on' : ''}" data-sf-tab="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="sf-grid">
        <div class="sf-compose">
          <div class="sf-me">${avatar(me ? me.handle : 'g', 'x')}<div><b>@${esc(me ? me.handle : 'you')}</b><span class="muted xsmall">Posting as a verified GDR holder</span></div></div>
          <textarea id="sf-text" maxlength="280" rows="4" placeholder="Share an update with the GIDORA community…">${esc(draft)}</textarea>
          <div class="sf-tools">
            <button class="sf-chip" data-sf-ref title="Add your referral link">${icon('copy')} Add referral link</button>
            <button class="sf-chip" data-sf-tag="#GIDORA">#GIDORA</button>
            <button class="sf-chip" data-sf-tag="$GDR">$GDR</button>
            <span class="sf-count" id="sf-count">${280 - draft.length}</span>
          </div>
          <div class="sf-share">
            <span class="muted xsmall">Also share to</span>
            ${['x', 'tg'].map((k) => `<label class="sf-tog ${s[k] ? '' : 'off'}" title="${s[k] ? `Post to @${esc(s[k].handle)}` : `Connect ${NET[k].full} first`}"><input type="checkbox" data-sf-share="${k}" ${s[k] ? 'checked' : 'disabled'}>${NET[k].svg}${NET[k].name}</label>`).join('')}
          </div>
          <button class="btn btn-primary sf-post" id="sf-post">Post</button>
          <div class="sf-trend">
            <div class="muted xsmall">Trending</div>
            ${['#GIDORA', '$GDR', '#Solana', '#Airdrop', '#Round1'].map((t) => `<button class="sf-chip" data-sf-tag="${t}">${t}</button>`).join('')}
          </div>
        </div>
        <div class="sf-list" id="sf-list">
          ${posts.length ? posts.map(postHtml).join('') : '<div class="sf-empty muted">No posts here yet. Write the first one!</div>'}
        </div>
      </div>`;
    wireFeed(el);
    if (!state.claimed) lockEl(el, true, 'Claim GDR to unlock the community feed', 'claim');
    else if (!nets.length) lockEl(el, true, 'Connect X or Telegram to view and post in the feed', 'social');
    else el.classList.remove('fx-locked');
  }

  function postHtml(p) {
    const mine = p.wallet && p.wallet === wallet.address;
    const shared = (p.sharedTo || []).map((k) => `<span class="sf-shared">${NET[k].svg} Shared to ${NET[k].name}</span>`).join('');
    return `<article class="sf-post-card ${p.fresh ? 'fresh' : ''}" data-id="${esc(p.id)}">
      ${avatar(p.handle, p.src)}
      <div class="sf-body">
        <div class="sf-who"><b>${esc(p.name)}</b>${p.src === 'gidora' ? '<span class="sf-verified" title="Official">✔</span>' : ''}<span class="muted">@${esc(p.handle)} · ${ago(p.at)}</span>${badge(p.src)}</div>
        <p>${richText(p.text)}</p>
        ${shared ? `<div class="sf-shared-row">${shared}</div>` : ''}
        <div class="sf-acts">
          <button data-sf-reply="${esc(p.handle)}" aria-label="Reply">💬 <span>${p.replies || 0}</span></button>
          <button data-sf-rp class="${p.reposted ? 'on' : ''}" aria-label="Repost">🔁 <span>${p.reposts || 0}</span></button>
          <button data-sf-like class="${p.liked ? 'on' : ''}" aria-label="Like">${p.liked ? '❤️' : '🤍'} <span>${p.likesN}</span></button>
          ${mine ? '<button data-sf-del class="del" aria-label="Delete post">🗑 Delete</button>' : ''}
        </div>
      </div>
    </article>`;
  }

  function wireFeed(el) {
    const ta = $('#sf-text', el);
    const count = $('#sf-count', el);
    const upd = () => { count.textContent = 280 - ta.value.length; count.classList.toggle('low', ta.value.length > 250); };
    ta.addEventListener('input', upd);
    const insert = (t) => { ta.value = (ta.value + (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + t + ' ').slice(0, 280); upd(); ta.focus(); };
    el.querySelectorAll('[data-sf-tab]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.sfTab; renderFeed(); }));
    el.querySelectorAll('[data-sf-tag]').forEach((b) => b.addEventListener('click', () => insert(b.dataset.sfTag)));
    $('[data-sf-ref]', el).addEventListener('click', () => state.refLink ? insert(state.refLink) : toast('Referral link not ready yet', 'info'));
    $('#sf-post', el).addEventListener('click', () => publish(el));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) publish(el); });

    el.querySelectorAll('.sf-post-card').forEach((card) => {
      const id = card.dataset.id;
      const like = $('[data-sf-like]', card);
      like.addEventListener('click', () => {
        const l = likes();
        l.has(id) ? l.delete(id) : l.add(id);
        LS.set('gdr_feed_likes', [...l]);
        renderFeed();
      });
      $('[data-sf-rp]', card).addEventListener('click', (e) => {
        const b = e.currentTarget, n = $('span', b);
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        n.textContent = Number(n.textContent) + (on ? 1 : -1);
        if (on) toast('Reposted to your feed', 'ok', 2200);
      });
      $('[data-sf-reply]', card).addEventListener('click', (e) => { ta.value = `@${e.currentTarget.dataset.sfReply} `; upd(); ta.focus(); ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      const del = $('[data-sf-del]', card);
      if (del) del.addEventListener('click', () => {
        LS.set('gdr_feed_posts', myPosts().filter((p) => p.id !== id));
        toast('Post deleted', 'info', 2200);
        renderFeed();
      });
    });
  }

  async function publish(el) {
    const ta = $('#sf-text', el);
    const text = ta.value.trim();
    if (!text) { toast('Write something first', 'info', 2200); ta.focus(); return; }
    const s = getSocial();
    const nets = linked();
    if (!nets.length) { toast('Connect X or Telegram to post', 'info'); return; }
    const sharedTo = [...el.querySelectorAll('[data-sf-share]:checked')].map((c) => c.dataset.sfShare);
    const btn = $('#sf-post', el);
    btn.disabled = true; btn.textContent = sharedTo.length ? 'Posting & sharing…' : 'Posting…';
    posting = true;
    await new Promise((r) => setTimeout(r, 700));
    posting = false;
    const acct = s[nets[0]];
    const post = {
      id: `m${Date.now()}`, wallet: wallet.address, src: sharedTo[0] || 'gidora',
      handle: acct.handle, name: acct.handle, text, at: Date.now(), likes: 0, reposts: 0, replies: 0, sharedTo,
    };
    LS.set('gdr_feed_posts', [post, ...myPosts()].slice(0, 100));
    const cur = $('#sf-text');
    if (cur) cur.value = '';
    toast(sharedTo.length ? `Posted and shared to ${sharedTo.map((k) => NET[k].name).join(' & ')} (demo)` : 'Posted to the GIDORA feed', 'ok');
    renderFeed();
    const first = $('.sf-post-card', el);
    if (first) first.classList.add('fresh');
  }

  // simulated live activity
  function startLive() {
    if (liveTimer) return;
    let i = 0;
    liveTimer = setInterval(() => {
      if (document.visibilityState !== 'visible' || !state.claimed || !linked().length) return;
      const ta = $('#sf-text');
      if (posting || (ta && document.activeElement === ta)) return; // don't re-render while typing
      const [src, handle, name, text] = LIVE[i++ % LIVE.length];
      livePosts.unshift({ id: `l${Date.now()}`, src, handle, name, text, at: Date.now(), likes: Math.floor(Math.random() * 20), reposts: Math.floor(Math.random() * 6), replies: 0, fresh: true });
      livePosts = livePosts.slice(0, 20);
      renderFeed();
      livePosts.forEach((p) => { p.fresh = false; });
    }, 14000);
  }

  // ------------------------------------------------------------ wiring
  function renderAll() { renderBar(); renderFeed(); }

  document.addEventListener('gdr:dash', (e) => {
    const prevWallet = state.wallet;
    state = { ...e.detail, wallet: wallet.address };
    if (prevWallet !== wallet.address) { filter = 'all'; livePosts = []; }
    if (!state.connected) return;
    renderAll();
    startLive();
  });
})();
