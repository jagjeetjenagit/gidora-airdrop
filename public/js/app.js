/* GIDORA — shared front-end core (wallet, API, UI helpers). No dependencies. */
(function () {
  'use strict';

  // ------------------------------------------------------------ preloader
  (function preloader() {
    const el = document.getElementById('preloader');
    if (!el) return;
    let seen = false;
    try { seen = sessionStorage.getItem('gdr_pl') === '1'; sessionStorage.setItem('gdr_pl', '1'); } catch { /* storage unavailable */ }
    if (seen) { el.classList.add('quick'); }
    const start = performance.now();
    const minMs = seen ? 250 : 1400; // full intro once per session, quick after
    const hide = () => {
      const wait = Math.max(0, minMs - (performance.now() - start));
      setTimeout(() => { el.classList.add('done'); setTimeout(() => el.remove(), 600); }, wait);
    };
    if (document.readyState === 'complete') hide(); else window.addEventListener('load', hide, { once: true });
    setTimeout(hide, 4000); // never block on slow assets
  })();

  const DEMO = document.body.dataset.demo === 'true';
  const BASE = document.body.dataset.base || '/';
  const STATIC = document.body.dataset.static === 'true' && !!window.GDRStaticApi;
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
  };

  // ------------------------------------------------------------ format
  const nf = (d = 0) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt = {
    int: (n) => nf(0).format(n),
    gdr(n) {
      if (n == null || isNaN(n)) return '—';
      if (n >= 1000) return nf(0).format(n);
      if (n >= 10) return nf(2).format(n);
      return nf(4).format(n);
    },
    compact: (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n),
    short: (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || ''),
    time: (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }),
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  // ------------------------------------------------------------ base58
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58encode(bytes) {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) + BigInt(b);
    let out = '';
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
    return out;
  }

  // ------------------------------------------------------------ API
  async function api(path, { method = 'GET', body, auth = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (auth && wallet.session) headers.Authorization = `Bearer ${wallet.session.token}`;
    let res;
    try {
      if (STATIC) {
        // GitHub Pages build: the API runs in the browser (demo mode)
        const r = await window.GDRStaticApi.request(method, path, body, headers.Authorization);
        res = { ok: r.status < 400, status: r.status, json: async () => r.data };
      } else {
        res = await fetch(`${BASE}api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      }
    } catch {
      const e = new Error('Network unavailable. Check your connection and try again.');
      e.code = 'network'; throw e;
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const e = new Error((data && data.message) || `Request failed (${res.status})`);
      e.code = (data && data.error) || res.status; e.status = res.status;
      if (res.status === 401 && auth) wallet.disconnect(true);
      throw e;
    }
    return data;
  }

  // ------------------------------------------------------------ toasts
  function toast(msg, type = 'info', ms = 4200) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'err' ? 'alert' : 'status');
    el.innerHTML = `${icon(type === 'ok' ? 'check-circle' : type === 'err' ? 'alert' : 'info')}<div>${esc(msg)}</div>`;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
  }

  // ------------------------------------------------------------ modal
  const modal = {
    el: () => document.getElementById('app-modal'),
    open(html) {
      const d = this.el();
      d.innerHTML = html;
      d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.close()));
      if (!d.open) d.showModal();
      return d;
    },
    close() { const d = this.el(); if (d && d.open) d.close(); },
  };
  document.addEventListener('click', (e) => {
    const d = e.target.closest('dialog');
    if (e.target.tagName === 'DIALOG' && d) d.close(); // backdrop click
  });

  // ------------------------------------------------------------ identicon
  let idSeq = 0;
  function identicon(addr, size = 28) {
    let h = 0;
    for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
    const a = h % 360, b = (a + 40 + (h >> 8) % 80) % 360, gid = `idg${++idSeq}`;
    const cells = [];
    for (let i = 0; i < 9; i++) if ((h >> i) & 1) cells.push(`<rect x="${(i % 3) * 8 + 2}" y="${Math.floor(i / 3) * 8 + 2}" width="8" height="8" fill="rgba(255,255,255,.25)"/>`);
    return `<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 70% 55%)"/><stop offset="1" stop-color="hsl(${b} 70% 35%)"/></linearGradient></defs><rect width="28" height="28" rx="8" fill="url(#${gid})"/>${cells.join('')}</svg>`;
  }

  // ------------------------------------------------------------ wallet
  const PROVIDERS = [
    { id: 'phantom', name: 'Phantom', color: '#ab9ff2', get: () => window.phantom?.solana?.isPhantom ? window.phantom.solana : (window.solana?.isPhantom ? window.solana : null), url: 'https://phantom.app/' },
    { id: 'solflare', name: 'Solflare', color: '#fc7227', get: () => window.solflare?.isSolflare ? window.solflare : null, url: 'https://solflare.com/' },
    { id: 'backpack', name: 'Backpack', color: '#e33e3f', get: () => window.backpack?.isBackpack ? window.backpack : (window.backpack || null), url: 'https://backpack.app/' },
  ];

  const wallet = {
    address: null,
    session: null,
    providerId: null,
    status: 'disconnected', // disconnected | connecting | connected
    isDemo: false,

    restore() {
      const s = LS.get('gdr_session');
      if (!s || !s.token || !s.wallet) return;
      try {
        const { exp } = JSON.parse(atob(s.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
        if (Date.now() > exp - 60_000) { LS.del('gdr_session'); return; }
      } catch { LS.del('gdr_session'); return; }
      Object.assign(this, { address: s.wallet, session: s, providerId: s.provider, status: 'connected', isDemo: !!s.demo });
      const p = PROVIDERS.find((x) => x.id === s.provider);
      const prov = p && p.get();
      if (prov && prov.on) prov.on('accountChanged', () => this.disconnect());
    },

    emit() { document.dispatchEvent(new CustomEvent('wallet:change', { detail: this })); renderSlot(); },

    openPicker() {
      const dlg = document.getElementById('wallet-modal');
      const list = document.getElementById('wallet-list');
      list.innerHTML = PROVIDERS.map((p) => {
        const found = !!p.get();
        const tag = found ? '<span class="badge badge-ok">Detected</span>'
          : DEMO ? '<span class="badge badge-gold">Demo</span>'
          : `<span class="badge badge-muted">Install ${icon('external')}</span>`;
        return `<button class="wallet-opt" data-wallet="${p.id}" data-found="${found}">
          <span class="w-logo" style="background:${p.color}1f;color:${p.color}">${p.name[0]}</span>
          <span class="w-name">${p.name}${!found && DEMO ? '<br><span class="muted xsmall" style="font-weight:400">Simulated connection for the MVP preview</span>' : ''}</span>
          ${tag}
        </button>`;
      }).join('');
      list.querySelectorAll('[data-wallet]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.wallet;
        const found = b.dataset.found === 'true';
        if (!found && !DEMO) { window.open(PROVIDERS.find((p) => p.id === id).url, '_blank', 'noopener'); return; }
        dlg.close();
        this.connect(id, !found);
      }));
      dlg.querySelector('[data-close]').onclick = () => dlg.close();
      dlg.showModal();
    },

    async connect(id, simulated = false) {
      this.status = 'connecting'; this.providerId = id; this.emit();
      try {
        let address, signature, demo = false;
        if (simulated || id === 'demo') {
          // MVP demo: a stable, realistic-looking address per wallet type
          const key = `gdr_sim_${id}`;
          address = LS.get(key);
          if (!address) { address = b58encode(crypto.getRandomValues(new Uint8Array(32))); LS.set(key, address); }
          demo = true;
          await new Promise((r) => setTimeout(r, 650));
        } else {
          const prov = PROVIDERS.find((p) => p.id === id).get();
          if (!prov) throw new Error('Wallet not found. Please install it and refresh.');
          const r = await prov.connect();
          const pk = (r && r.publicKey) || prov.publicKey;
          if (!pk) throw new Error('Wallet did not return an address.');
          address = pk.toString();

          const { message } = await api(`/session/nonce?wallet=${encodeURIComponent(address)}`);
          const encoded = new TextEncoder().encode(message);
          const signed = await prov.signMessage(encoded, 'utf8');
          const sigBytes = signed && signed.signature ? signed.signature : signed;
          signature = b58encode(new Uint8Array(sigBytes));
          if (prov.on) prov.on('accountChanged', () => this.disconnect());
        }
        const s = await api('/session', { method: 'POST', body: { wallet: address, signature, demo } });
        this.session = { token: s.token, wallet: address, provider: id, demo };
        LS.set('gdr_session', this.session);
        Object.assign(this, { address, status: 'connected', isDemo: demo });
        this.emit();
        const name = (PROVIDERS.find((p) => p.id === id) || { name: 'Wallet' }).name;
        toast(demo ? `${name} connected (demo)` : `${name} connected and verified`, 'ok');
      } catch (e) {
        this.status = 'disconnected'; this.address = null; this.session = null;
        this.emit();
        const rejected = e && (e.code === 4001 || /reject|cancel|denied/i.test(e.message || ''));
        toast(rejected ? 'Request cancelled in wallet.' : (e.message || 'Could not connect wallet.'), rejected ? 'info' : 'err');
      }
    },

    async disconnect(silent) {
      const p = PROVIDERS.find((x) => x.id === this.providerId);
      try { const prov = p && p.get(); if (prov && prov.disconnect) await prov.disconnect(); } catch { /* ignore */ }
      Object.assign(this, { address: null, session: null, providerId: null, status: 'disconnected', isDemo: false });
      LS.del('gdr_session');
      this.emit();
      if (silent === true) toast('Session expired. Please reconnect your wallet.', 'info');
    },
  };

  function renderSlot() {
    document.querySelectorAll('[data-wallet-slot]').forEach((slot) => {
      if (wallet.status === 'connected') {
        slot.innerHTML = `<div class="wallet-chip" title="${esc(wallet.address)}">
          ${identicon(wallet.address, 20)}
          <span class="addr">${esc(fmt.short(wallet.address))}</span>
          ${wallet.isDemo ? '<span class="badge badge-gold">Demo</span>' : ''}
          <button class="icon-btn" data-action="disconnect" aria-label="Disconnect wallet" title="Disconnect">${icon('logout')}</button>
        </div>`;
      } else if (wallet.status === 'connecting') {
        slot.innerHTML = `<button class="btn btn-primary btn-sm" disabled><span class="spinner" aria-hidden="true"></span><span>Connecting…</span></button>`;
      } else {
        slot.innerHTML = `<button class="btn btn-primary btn-sm" data-action="connect">${icon('wallet')}<span>Connect Wallet</span></button>`;
      }
    });
    document.querySelectorAll('[data-cta-label]').forEach((el) => {
      el.textContent = wallet.status === 'connected' ? 'Go to your claim' : 'Connect Wallet';
    });
  }

  // ------------------------------------------------------------ copy/share
  async function copy(text, label = 'Copied to clipboard') {
    try { await navigator.clipboard.writeText(text); toast(label, 'ok', 2400); return true; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* noop */ }
      ta.remove(); toast(ok ? label : 'Copy failed. Please copy manually.', ok ? 'ok' : 'err'); return ok;
    }
  }
  async function share(url, text) {
    if (navigator.share) {
      try { await navigator.share({ title: 'GIDORA — Claim GDR', text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') { toast('Share cancelled', 'info', 2000); return; } }
    }
    const x = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(x, '_blank', 'noopener');
  }

  // ------------------------------------------------------------ referral capture
  (function captureRef() {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[1-9A-HJ-NP-Za-km-z]{4,16}$/.test(ref)) {
      LS.set('gdr_ref', ref);
      const url = new URL(location.href); url.searchParams.delete('ref');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  })();

  // ------------------------------------------------------------ global events
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'connect') { e.preventDefault(); wallet.openPicker(); }
    if (act === 'disconnect') { e.preventDefault(); wallet.disconnect(); toast('Wallet disconnected', 'info', 2200); }
    if (act === 'connect-or-scroll' && wallet.status !== 'connected') { e.preventDefault(); wallet.openPicker(); }
    if (act === 'menu') {
      const nav = document.getElementById('main-nav');
      const open = nav.classList.toggle('open');
      a.setAttribute('aria-expanded', String(open));
      a.querySelector('use').setAttribute('href', open ? '#i-x' : '#i-menu');
    }
  });
  document.getElementById('main-nav')?.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      e.currentTarget.classList.remove('open');
      const t = document.querySelector('.menu-toggle'); t?.setAttribute('aria-expanded', 'false'); t?.querySelector('use')?.setAttribute('href', '#i-menu');
    }
  });

  // ------------------------------------------------------------ live claims ticker
  const ago = (iso) => {
    const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
  };
  async function loadTicker() {
    const track = document.getElementById('ticker-track');
    if (!track) return;
    try {
      const { items } = await api('/activity?limit=14');
      if (!items.length) { document.getElementById('ticker').hidden = true; return; }
      const html = items.map((c) => `<span class="tick"><span class="w">${esc(c.wallet)}</span> claimed <span class="amt">+${fmt.gdr(c.amount)} GDR</span> <span class="ago">#${fmt.int(c.index)} · ${ago(c.at)}</span></span>`).join('');
      track.innerHTML = html + html; // duplicated for a seamless loop
    } catch { /* ticker is non-critical */ }
  }

  wallet.restore();
  renderSlot();
  loadTicker();
  setInterval(() => { if (document.visibilityState === 'visible') loadTicker(); }, 15_000);

  window.GDR = { DEMO, base: BASE, isStatic: STATIC, api, wallet, fmt, esc, icon, toast, modal, copy, share, identicon, LS };
})();
