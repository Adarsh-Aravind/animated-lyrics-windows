// Landing screen: glass menus, player status, hero preview, style gallery with live previews, playback dock.

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>';

const APP_NAMES = [
  ['spotify', 'Spotify'], ['applemusic', 'Apple Music'], ['itunes', 'iTunes'], ['msedge', 'Microsoft Edge'], ['chrome', 'Google Chrome'],
  ['firefox', 'Firefox'], ['opera', 'Opera'], ['brave', 'Brave'], ['tidal', 'TIDAL'], ['deezer', 'Deezer'], ['amazon', 'Amazon Music'],
  ['foobar', 'foobar2000'], ['vlc', 'VLC'], ['zune', 'Media Player'], ['youtube', 'YouTube Music'], ['internet', 'Your browser'],
];
// player logos (shown to say which app the lyrics are following)
const SPOTIFY_SVG = '<svg viewBox="0 0 24 24" class="lg"><circle cx="12" cy="12" r="12" fill="#1ED760"/>'
  + '<path d="M5.9 9.2c4-1.2 8.7-.9 12.2 1.2M6.5 12.5c3.4-1 7.2-.7 10.2 1.1M7.2 15.6c2.7-.7 5.6-.5 7.9.9" fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round"/></svg>';
const APPLE_SVG = '<svg viewBox="0 0 24 24" class="lg"><path d="M15.8 5.3 9.9 6.6c-.4.1-.7.4-.7.8v7.3a2.4 2.4 0 1 0 1.5 2.2V9.9l4.6-1v4.3a2.4 2.4 0 1 0 1.5 2.2V6c0-.5-.5-.8-1-.7z" fill="#fff" stroke="none"/></svg>';
export function playerKey(id) {
  const s = (id || '').toLowerCase();
  if (s.includes('spotify')) return 'spotify';
  if (s.includes('applemusic') || s.includes('apple') || s.includes('itunes')) return 'apple';
  return 'other';
}
export function logo(id, name) {
  const k = playerKey(id);
  if (k === 'spotify') return `<span class="logo spotify">${SPOTIFY_SVG}</span>`;
  if (k === 'apple') return `<span class="logo apple">${APPLE_SVG}</span>`;
  const initial = ((name || appName(id)).match(/[A-Za-z]/) || ['♪'])[0];
  return `<span class="logo other">${initial}</span>`;
}

export function appName(id) {
  if (!id) return '';
  const s = id.toLowerCase();
  for (const [k, v] of APP_NAMES) if (s.includes(k)) return v;
  return id.split(/[!\\]/).pop().replace(/\.exe$/i, '');
}

export function initHome(api) {
  const { STYLES, OPTIONS, settings } = api;
  const frames = [];            // every preview iframe on the page
  let visible = false;

  // ───── popovers ─────
  let openPop = null;
  function closePops() {
    if (!openPop) return false;
    openPop.pop.classList.remove('open');
    openPop.btn.classList.remove('open');
    openPop = null;
    return true;
  }
  function togglePop(btn) {
    const pop = document.getElementById(btn.dataset.pop);
    if (openPop && openPop.pop === pop) return closePops();
    closePops();
    renderPops();
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth || 330;
    const left = pop.classList.contains('right-pop') ? r.right - w : r.left + r.width / 2 - w / 2;
    pop.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, left))}px`;
    pop.style.top = `${r.bottom + 10}px`;
    pop.classList.add('open'); btn.classList.add('open');
    openPop = { pop, btn };
  }
  document.querySelectorAll('[data-pop]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); togglePop(b); }));
  document.addEventListener('click', (e) => { if (openPop && !e.target.closest('.pop')) closePops(); });
  $('#home').addEventListener('scroll', closePops, { passive: true });

  function seg(box, key) {
    box.innerHTML = '';
    for (const [val, label] of OPTIONS[key]) {
      const b = el('button', settings[key] === val ? 'sel' : '', esc(label));
      if (key === 'font' && val !== 'default') b.style.fontFamily = val;
      b.onclick = () => api.set(key, val);
      box.appendChild(b);
    }
  }
  function tiles(box, key, swClass) {
    box.innerHTML = '';
    const art = api.track?.art;
    for (const [val, label] of OPTIONS[key]) {
      const b = el('button', `tile${settings[key] === val ? ' sel' : ''}`);
      const sw = el('div', `sw ${swClass(val)}`);
      if ((val === 'blur' || val === 'cover' || val === 'water') && art) sw.style.backgroundImage = `url("${art}")`;
      b.append(sw, document.createTextNode(label));
      b.onclick = () => api.set(key, val);
      box.appendChild(b);
    }
  }
  function renderPops() {
    seg($('#opt-color'), 'color');
    seg($('#opt-font'), 'font');
    tiles($('#opt-backdrop'), 'backdrop', (v) => v);
    tiles($('#opt-light'), 'light', (v) => `light-${v}`);
    $('#opt-size').value = settings.size;
    $('#opt-intensity').value = settings.intensity;
    $('#opt-info').checked = !!settings.info;
    $('#opt-screens').checked = !!settings.allScreens;
    $('#screens-note').textContent = `${api.screens} screens connected. Each extra screen gets its own full-screen lyrics, and changing a style changes them all.`;
    renderStatus();
  }
  $('#opt-size').oninput = (e) => api.set('size', +e.target.value);
  $('#opt-intensity').oninput = (e) => api.set('intensity', +e.target.value);
  $('#opt-info').onchange = (e) => api.set('info', e.target.checked);
  $('#opt-auto').onchange = (e) => api.set('auto', e.target.checked);
  $('#opt-screens').onchange = (e) => api.setScreens(e.target.checked);

  // ───── player status ─────
  $('#off-minus').onclick = () => api.nudge(-0.25);  // lyrics too early → show them later
  $('#off-plus').onclick = () => api.nudge(0.25);    // lyrics too late → show them sooner
  $('#off-reset').onclick = (e) => { e.preventDefault(); api.resetOffset(); };
  $('#btn-refetch').onclick = () => { api.send({ type: 'refetch' }); };

  function statusInfo() {
    const t = api.track, l = api.lyrics;
    if (!api.connected) return { app: 'Starting…', dot: '', label: 'Connecting', checks: [['wait', 'Connecting to the lyrics engine…']] };
    if (!t || api.demo) {
      return {
        app: 'No music playing', dot: '', label: 'Waiting for a song',
        checks: [['ok', 'Animated Lyrics is ready'], ['wait', 'Play a song in Spotify, YouTube or any music app', 'It shows up here on its own']],
      };
    }
    const name = appName(t.app) || 'Music app';
    const checks = [
      api.playing ? ['ok', `${esc(name)} is playing`] : ['warn', `${esc(name)} is paused`],
      ['ok', 'Animated Lyrics can see what’s playing'],
      ['ok', `Playing “${esc(t.title)}”`, esc(t.artist)],
    ];
    let dot = 'ok', label = 'Synced';
    const st = l?.status;
    if (!l || st === 'loading') { checks.push(['wait', 'Searching for lyrics…']); dot = 'warn'; label = 'Searching'; }
    else if (st === 'synced') checks.push(['ok', l.wordSynced ? 'Lyrics found, timed word by word' : 'Lyrics found, timed line by line']);
    else if (st === 'plain') { checks.push(['warn', 'Lyrics found, but without timing', 'The timing is a rough guess']); dot = 'warn'; label = 'Rough timing'; }
    else if (st === 'instrumental') { checks.push(['ok', 'Instrumental, no lyrics needed']); label = 'Instrumental'; }
    else { checks.push(['bad', 'No lyrics found for this song', 'Try “Search lyrics again”']); dot = 'bad'; label = 'No lyrics'; }
    if (!api.playing) label = 'Paused';
    return { app: name, dot, label, checks };
  }
  function renderStatus() {
    const s = statusInfo();
    $('#status-app').textContent = api.track && !api.demo ? `${s.app} · ${s.label}` : s.app;
    $('#status-dot').className = `dot ${s.dot}`;
    $('#st-icon').outerHTML = `<span id="st-icon">${api.track && !api.demo ? logo(api.track.app, s.app) : '<span class="logo other">♪</span>'}</span>`;

    // Spotify + Apple Music always shown (green dot = open), plus whatever else is playing
    const pls = api.players || [];
    const find = (k) => pls.filter((p) => playerKey(p.app) === k);
    const rows = [
      { k: 'spotify', id: 'Spotify', name: 'Spotify', list: find('spotify') },
      { k: 'apple', id: 'AppleMusic', name: 'Apple Music', list: find('apple') },
      ...pls.filter((p) => playerKey(p.app) === 'other').map((p) => ({ k: 'other', id: p.app, name: appName(p.app), list: [p] })),
    ];
    const stateOf = (r) => {
      if (!r.list.length) return { dot: '', text: 'Not open' };
      const active = r.list.some((p) => p.active), playing = r.list.some((p) => p.playing);
      return { dot: playing ? 'ok' : 'idle', text: active ? (playing ? 'Lyrics following this' : 'Paused · lyrics following this') : playing ? 'Playing' : 'Open, paused', active };
    };
    $('#chip-players').innerHTML = rows.filter((r) => r.k !== 'other' || stateOf(r).active)
      .map((r) => { const st = stateOf(r); return `<span class="pl${st.active ? ' active' : ''}" title="${esc(r.name)}: ${esc(st.text)}">${logo(r.id, r.name)}<i class="dot ${st.dot}"></i></span>`; }).join('');
    $('#st-players').innerHTML = rows
      .map((r) => { const st = stateOf(r); return `<div class="pr${st.active ? ' active' : ''}">${logo(r.id, r.name)}<div><b>${esc(r.name)}</b><small>${esc(st.text)}</small></div><i class="dot ${st.dot}"></i></div>`; }).join('');
    $('#st-app').textContent = s.app;
    $('#st-state').innerHTML = `<i class="dot ${s.dot}"></i>${esc(s.label)}`;
    $('#st-checks').innerHTML = s.checks.map(([k, txt, sub]) =>
      `<li><span class="ck ${k}">${{ ok: '✓', warn: '!', bad: '✕', wait: '…' }[k]}</span><div>${txt}${sub ? `<small>${sub}</small>` : ''}</div></li>`).join('');
    const off = api.offset(), real = api.track && !api.demo;
    $('#off-val').textContent = `${Math.abs(off).toFixed(2).replace(/\.?0+$/, '') || 0} s`;
    $('#off-sub').textContent = off === 0 ? 'Lyrics on their own timing' : off < 0 ? 'Showing lyrics later' : 'Showing lyrics sooner';
    $('#off-note').style.display = off ? '' : 'none';
    $('#off-minus').disabled = $('#off-plus').disabled = $('#btn-refetch').disabled = !real;
  }

  // ───── live preview frames ─────
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) { const f = e.target.querySelector('iframe'); if (f) f.style.transform = `scale(${e.contentRect.width / 1280})`; }
  });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.querySelector('iframe')?.contentWindow?.postMessage({ type: e.isIntersecting ? 'play' : 'pause' }, '*');
  }, { root: $('#home') });
  function previewSettings() {
    const { color, font, size, light, intensity, backdrop } = settings;
    return { color, font, size, light, intensity, backdrop, art: api.demo ? null : api.track?.art || null };
  }
  function feed(f) {
    try {
      f.contentWindow.postMessage({ type: 'palette', pal: api.palette }, '*');
      const ps = previewSettings();
      f.contentWindow.postMessage({ type: 'settings', settings: ps }, '*');
      f.contentWindow.postMessage({ type: 'art', url: ps.art }, '*');
    } catch {}
  }
  function makeFrame(holder, src) {
    const f = holder.querySelector('iframe') || holder.appendChild(el('iframe'));
    f.setAttribute('tabindex', '-1');
    f.dataset.src = src;
    f.addEventListener('load', () => { if (f.src !== 'about:blank') feed(f); });
    ro.observe(holder); io.observe(holder);
    frames.push(f);
    return f;
  }
  const loadFrames = () => frames.forEach((f) => { if (!f.src || f.src === 'about:blank' || !f.src.includes(f.dataset.src)) f.src = f.dataset.src; });
  const unloadFrames = () => frames.forEach((f) => { f.src = 'about:blank'; });
  let lastFeed = '';
  function feedAll(force) {
    const key = JSON.stringify(previewSettings());
    if (!force && key === lastFeed) return;
    lastFeed = key;
    frames.forEach((f) => { if (f.src && f.src !== 'about:blank') feed(f); });
  }

  // ───── hero ─────
  const heroFrame = makeFrame($('#hero-frame'), `/?preview=${settings.style}&hero=1`);
  let heroStyle = settings.style;
  $('#hero-start').onclick = () => api.enterStage();
  $('#hero-surprise').onclick = () => api.surprise();
  $('#hero-fav').onclick = () => api.toggleFav(settings.style);
  $('#hero-prev').onclick = () => api.stepStyle(-1);
  $('#hero-next').onclick = () => api.stepStyle(1);
  const dots = $('#hero-dots');
  STYLES.forEach((S) => { const d = el('i'); d.title = S.label; d.onclick = () => api.setStyle(S.id); dots.appendChild(d); });
  function renderHero() {
    const i = Math.max(0, STYLES.findIndex((s) => s.id === settings.style));
    const S = STYLES[i];
    $('#hero-cat').textContent = `${S.cat} · ${i + 1} of ${STYLES.length}`;
    $('#hero-name').textContent = S.label;
    $('#hero-hint').textContent = S.hint;
    $('#hero-fav').classList.toggle('on', settings.favs.includes(S.id));
    $('#opt-auto').checked = !!settings.auto;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    if (heroStyle !== S.id) {
      heroStyle = S.id;
      heroFrame.dataset.src = `/?preview=${S.id}&hero=1`;
      if (heroFrame.src && heroFrame.src !== 'about:blank') heroFrame.contentWindow?.postMessage({ type: 'style', id: S.id }, '*');
    }
  }

  // ───── gallery ─────
  const gallery = $('#gallery');
  const cards = new Map();
  for (const cat of ['Classic', 'Kinetic', 'Scenes']) {
    const list = STYLES.filter((S) => S.cat === cat);
    if (!list.length) continue;
    const blurb = { Classic: 'calm and readable', Kinetic: 'the words themselves move', Scenes: 'the song as a little scene' }[cat];
    gallery.appendChild(el('h2', '', `${cat}<small>${blurb}</small>`));
    const grid = gallery.appendChild(el('div', 'grid'));
    for (const S of list) {
      const card = el('button', 'card glass');
      const holder = el('div', 'frame');
      card.append(holder, el('div', 'fav', STAR), el('b', '', esc(S.label)), el('span', '', esc(S.hint)));
      makeFrame(holder, `/?preview=${S.id}`);
      card.onclick = () => { api.setStyle(S.id); $('#home').scrollTo({ top: 0, behavior: 'smooth' }); };
      card.ondblclick = () => { api.setStyle(S.id); api.enterStage(); };
      grid.appendChild(card);
      cards.set(S.id, card);
    }
  }

  // ───── dock (while lyrics are on screen) ─────
  $('#dock-home').onclick = () => api.showHome();
  $('#dock-prev').onclick = () => api.stepStyle(-1);
  $('#dock-next').onclick = () => api.stepStyle(1);
  $('#dock-surprise').onclick = () => api.surprise();
  $('#dock-play').onclick = () => api.send({ type: 'control', action: 'toggle' });
  $('#dock-full').onclick = () => api.toggleFull();
  $('#home-full').onclick = () => api.toggleFull();
  const PLAY = '<svg viewBox="0 0 24 24"><path class="f" d="M8 5v14l11-7z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24"><path class="f" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

  function refresh() {
    const S = STYLES.find((s) => s.id === settings.style) || STYLES[0];
    renderHero();
    for (const [id, card] of cards) {
      card.classList.toggle('sel', id === S.id);
      card.classList.toggle('is-fav', settings.favs.includes(id));
    }
    $('#tab-screens').hidden = !(api.screens > 1);
    $('#dock-style').textContent = S.label;
    const t = api.track;
    $('#dock-song').textContent = t && !api.demo ? `${t.title} · ${t.artist}` : 'Waiting for a song';
    $('#dock-play').innerHTML = api.playing && !api.demo ? PAUSE : PLAY;
    renderStatus();
    if (openPop) renderPops();
    if (visible) feedAll();
  }

  refresh();
  // ?pop=status (or text/bg/light) opens that menu on load: handy for screenshots
  const openOnLoad = new URLSearchParams(location.search).get('pop');
  if (openOnLoad) setTimeout(() => { const b = document.querySelector(`[data-pop="pop-${openOnLoad}"]`); if (b) togglePop(b); }, 1500);
  return {
    refresh,
    closePops,
    paletteChanged() { if (visible) feedAll(true); },
    shown() { visible = true; loadFrames(); refresh(); },
    hidden() { visible = false; closePops(); setTimeout(() => { if (!visible) unloadFrames(); }, 500); },
  };
}
