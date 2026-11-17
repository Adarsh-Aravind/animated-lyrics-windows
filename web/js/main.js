import { buildTimeline, Cursor, LEAD } from './engine.js';
import { STYLES } from './styles.js';
import { GradientBG, EdgeLight, swapLayer, paletteFromImage, fallbackPalette, applyPaletteVars } from './visuals.js';
import { initHome } from './home.js';

const $ = (s) => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const FORCE_DEMO = Q.has('demo');
const SCREEN = Q.get('screen');      // extra-monitor windows
const PREVIEW = Q.get('preview');    // a style rendered inside a landing-page card
const HERO = Q.has('hero');          // the big preview on the landing page

// ───────── settings ─────────
const DEFAULTS = { style: 'glide', backdrop: 'gradient', light: 'flow', color: 'album', font: 'default', size: 1, intensity: 0.85, info: true, auto: false, favs: [] };
export const OPTIONS = {
  backdrop: [['gradient', 'Gradient'], ['blur', 'Blurred cover'], ['cover', 'Album cover'], ['black', 'Black']],
  light: [['flow', 'Flow'], ['glow', 'Glow'], ['sides', 'Side lights'], ['off', 'Off']],
  color: [['album', 'Album colours'], ['white', 'White']],
  font: [['default', 'Style default'], ['Inter', 'Sans'], ['Nunito', 'Rounded'], ['"Instrument Serif"', 'Serif'], ['Anton', 'Condensed'], ['"JetBrains Mono"', 'Mono']],
};
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('al-settings') || '{}')); } catch {}
if (!Array.isArray(settings.favs)) settings.favs = [];
if (PREVIEW) Object.assign(settings, { style: PREVIEW, backdrop: HERO ? settings.backdrop : 'gradient', light: HERO ? settings.light : 'off', info: false });

let offsets = {}; // per-song sync nudges (seconds), remembered between runs
try { offsets = JSON.parse(localStorage.getItem('al-offsets') || '{}'); } catch {}
let applyingRemote = false;
let home = null;

// Settings also live on the local server, so every screen's window stays in step.
function pushSettings() {
  if (PREVIEW || applyingRemote || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'settings', data: { ...settings, offsets } }));
}
function save() {
  if (PREVIEW) return;
  try { localStorage.setItem('al-settings', JSON.stringify(settings)); } catch {}
  pushSettings();
  home?.refresh();
}
function saveOffsets() {
  try { localStorage.setItem('al-offsets', JSON.stringify(offsets)); } catch {}
  pushSettings();
  home?.refresh();
}
function adoptRemote(data) {
  if (!data || !Object.keys(data).length) return false;
  applyingRemote = true;
  try {
    const { offsets: o, ...rest } = data;
    if (o) offsets = o;
    const styleChanged = rest.style && rest.style !== settings.style;
    Object.assign(settings, rest);
    if (!Array.isArray(settings.favs)) settings.favs = [];
    try { localStorage.setItem('al-settings', JSON.stringify(settings)); localStorage.setItem('al-offsets', JSON.stringify(offsets)); } catch {}
    applySettings();
    if (styleChanged || !style) setStyle(settings.style);
  } finally { applyingRemote = false; }
  home?.refresh();
  return true;
}

// ───────── app state ─────────
const app = {
  edge: new EdgeLight($('#edge')),
  bg: new GradientBG($('#bg-gradient')),
  trackTitle: '', trackArtist: '', trackArt: null,
  palette: fallbackPalette('preview!', true),
};
const cursor = new Cursor();
let style = null;
let track = null;       // {id, title, artist, art, duration, app}
let lyrics = null;      // server lyrics payload
let timeline = [];
let clock = { pos: 0, stamp: 0, playing: false };
let demo = false;
let screenCount = 1;
let players = [];      // every open media app: {app, playing, active}
let paused = false;     // previews pause when scrolled out of view

function now() {
  const t = clock.pos + (clock.playing ? Date.now() / 1000 - clock.stamp : 0);
  return t + LEAD + (track ? offsets[track.id] || 0 : 0);
}

// ───────── demo track (original placeholder lines) ─────────
const DEMO_LINES = [
  [3.0, 'Late night and the city lights are humming low'], [7.2, 'Every window glowing like a radio'],
  [11.4, 'I keep the volume up so I never feel alone'], [15.6, 'Every word is lighting up the long way home'],
  [26.0, 'Let the colours bleed across the screen'], [30.0, 'Turn the quiet into something in between'],
  [34.2, 'Hold the moment, let it fall in time'], [38.4, 'Every heartbeat landing on a line'], [43.5, ''],
];
const DEMO = {
  track: { id: 'demo', title: 'Preview', artist: 'Midnight Radio', art: null, duration: 46 },
  lyrics: { status: 'synced', lines: DEMO_LINES.map(([t, text]) => ({ t, text, words: text.split(' ').filter(Boolean).map((w) => ({ w, t: null })) })) },
};
function startDemo(offset = 0) {
  demo = true;
  setTrack(DEMO.track); setLyrics({ ...DEMO.lyrics, id: 'demo' });
  clock = { pos: offset, stamp: Date.now() / 1000, playing: true };
}

// ───────── track / lyrics handling ─────────
async function setTrack(t) {
  track = t;
  Object.assign(app, { trackTitle: t.title, trackArtist: t.artist, trackArt: t.art });
  lyrics = null; timeline = []; cursor.set([]);
  style?.setTimeline([]);
  $('#info-title').textContent = t.title;
  $('#info-artist').textContent = t.artist;
  $('#info').classList.toggle('has', !!t.title && t.id !== 'demo');
  $('#info-art').style.backgroundImage = t.art ? `url("${t.art}")` : '';
  swapLayer($('#bg-art'), 'art', t.art);
  swapLayer($('#center-art'), 'art', t.art);
  home?.refresh();
  // demo gets a colourful preview palette; a real song without a cover gets soft white, never random colours
  let pal = t.id === 'demo' ? fallbackPalette('preview!', true) : fallbackPalette();
  if (t.art) { try { pal = await paletteFromImage(t.art); } catch {} }
  if (track !== t) return;
  setPalette(pal);
  updateMessage();
}

function setPalette(pal) {
  app.palette = pal;
  applyPaletteVars(pal, settings.color);
  app.bg.setPalette(pal);
  home?.paletteChanged(pal);
}

function setLyrics(l) {
  if (!track || l.id !== track.id) return;
  lyrics = l;
  let src = l;
  // slowed / sped-up / nightcore edits: stretch the original song's timing to this version's length
  const ratio = l.duration && track.duration ? track.duration / l.duration : 1;
  if (/slowed|sped|speed ?up|nightcore/i.test(track.title) && Math.abs(ratio - 1) > 0.03 && ratio > 0.5 && ratio < 2) {
    const sc = (t) => (t == null ? t : t * ratio);
    src = { ...l, lines: l.lines.map((ln) => ({ ...ln, t: sc(ln.t), words: ln.words.map((w) => ({ ...w, t: sc(w.t) })) })) };
  }
  timeline = buildTimeline(src, track.duration);
  cursor.set(timeline);
  style?.setTimeline(timeline);
  updateMessage();
  home?.refresh();
}

function updateMessage() {
  const m = $('#message'), badge = $('#badge');
  let html = '';
  if (track && !demo) {
    const st = lyrics?.status;
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (!lyrics || st === 'loading') html = `<h1>${esc(track.title)}</h1><p>Finding lyrics…</p>`;
    else if (st === 'instrumental') html = `<h1>${esc(track.title)}</h1><p>Instrumental</p>`;
    else if (st === 'missing' || st === 'error' || !timeline.length) html = `<h1>${esc(track.title)}</h1><p>${esc(track.artist)}<br><br>No lyrics found for this one</p>`;
  }
  m.innerHTML = html;
  m.classList.toggle('show', !!html);
  let b = '';
  if (demo && !PREVIEW) b = 'PREVIEW · play a song to start';
  else if (lyrics?.status === 'plain') b = 'Lyrics not time-synced · rough timing';
  badge.textContent = b;
  badge.classList.toggle('show', !!b);
}

// ───────── websocket ─────────
let ws = null;
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws${SCREEN ? `?screen=${SCREEN}` : ''}`);
  ws.onopen = () => home?.refresh();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'hello') {
      screenCount = m.screens || 1;
      if (!adoptRemote(m.settings)) pushSettings(); // first ever run: seed the server with this window's settings
      home?.refresh();
      return;
    }
    if (m.type === 'settings') { adoptRemote(m.data); return; }
    if (m.type === 'players') { players = m.list || []; home?.refresh(); return; }
    if (FORCE_DEMO) { if (!demo) startDemo(); return; }
    if (m.type === 'idle') { if (!demo) startDemo(); return; }
    if (m.type === 'track') {
      if (demo || !track || track.id !== m.id || track.art !== m.art) {
        const same = track && track.id === m.id && !demo;
        demo = false;
        if (same) { setTrack({ ...track, art: m.art }).then(() => lyrics && setLyrics(lyrics)); }
        else {
          if (settings.auto && track && track.id !== 'demo') surprise(true);
          setTrack({ id: m.id, title: m.title, artist: m.artist, art: m.art, duration: m.duration, app: m.app });
        }
      }
    } else if (m.type === 'lyrics') {
      setLyrics(m);
    } else if (m.type === 'state') {
      if (!track || m.id !== track.id) return;
      if (m.duration && !track.duration) { track.duration = m.duration; if (lyrics) setLyrics(lyrics); }
      const predicted = now();
      const next = { pos: m.position, stamp: m.stamp, playing: m.playing };
      const actual = next.pos + (next.playing ? Date.now() / 1000 - next.stamp : 0) + LEAD + (offsets[track.id] || 0);
      const changed = m.playing !== clock.playing;
      if (changed || Math.abs(actual - predicted) > 0.12) clock = next;
      if (changed) home?.refresh();
    }
  };
  ws.onclose = () => { home?.refresh(); setTimeout(connect, 1500); };
}
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

// ───────── styles & settings ─────────
function setStyle(id) {
  const S = STYLES.find((s) => s.id === id) || STYLES[0];
  settings.style = S.id; save();
  style?.destroy();
  const root = $('#lyrics');
  root.className = `style-${S.id}`;
  root.innerHTML = '';
  style = new S(root, app);
  style.setTimeline(timeline);
}
function stepStyle(dir) {
  const favs = settings.favs.filter((f) => STYLES.some((s) => s.id === f));
  const ids = favs.length >= 2 ? favs : STYLES.map((s) => s.id);
  const i = ids.indexOf(settings.style);
  setStyle(ids[(i + dir + ids.length) % ids.length]);
}
function cycle(key, dir = 1) {
  const list = OPTIONS[key];
  const i = list.findIndex((o) => o[0] === settings[key]);
  settings[key] = list[(i + dir + list.length) % list.length][0];
  applySettings();
}
function applySettings() {
  const b = document.body;
  b.classList.remove('bd-gradient', 'bd-blur', 'bd-cover', 'bd-black');
  b.classList.add(`bd-${settings.backdrop}`);
  b.classList.toggle('show-info', !!settings.info);
  app.edge.setMode(settings.light);
  const r = document.documentElement.style;
  r.setProperty('--scale', settings.size);
  r.setProperty('--light', settings.intensity);
  if (settings.font === 'default') r.removeProperty('--font-override'); else r.setProperty('--font-override', settings.font);
  applyPaletteVars(app.palette, settings.color);
  save();
  requestAnimationFrame(() => style?.relayout());
}
function nudge(d) {
  if (!track || demo) return;
  offsets[track.id] = Math.round(((offsets[track.id] || 0) + d) * 100) / 100;
  if (offsets[track.id] === 0) delete offsets[track.id];
  saveOffsets();
}
function resetOffset() { if (track && offsets[track.id]) { delete offsets[track.id]; saveOffsets(); } }
function surprise(stylesOnly = false) {
  const pick = (arr, not) => { const c = arr.filter((x) => x !== not); return c[Math.floor(Math.random() * c.length)]; };
  if (!stylesOnly) {
    settings.backdrop = pick(['gradient', 'gradient', 'blur', 'cover'], settings.backdrop);
    settings.light = pick(['flow', 'glow', 'sides'], settings.light);
    applySettings();
  }
  setStyle(pick(STYLES.map((s) => s.id), settings.style));
}
const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));

// ───────── landing screen ↔ lyrics stage ─────────
function enterStage() {
  document.body.classList.add('on-stage');
  home?.hidden();
  pokeUI();
}
function showHome() {
  if (SCREEN || PREVIEW) return;
  document.body.classList.remove('on-stage');
  home?.shown();
}

let uiTimer;
function pokeUI() {
  document.body.classList.add('ui-on');
  document.body.classList.remove('hide-cursor');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    if ($('#dock').matches(':hover')) return pokeUI();
    document.body.classList.remove('ui-on');
    if (document.body.classList.contains('on-stage')) document.body.classList.add('hide-cursor');
  }, 2600);
}

function wireStage() {
  addEventListener('mousemove', pokeUI);
  addEventListener('mousedown', pokeUI);
  addEventListener('dblclick', (e) => { if (document.body.classList.contains('on-stage') && !e.target.closest('#dock')) toggleFull(); });
  addEventListener('resize', () => style?.relayout());
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    const onStage = document.body.classList.contains('on-stage');
    const k = e.key.toLowerCase();
    if (k === 'arrowright') stepStyle(1);
    else if (k === 'arrowleft') stepStyle(-1);
    else if (k === 'escape' || k === 'h') { if (home?.closePops()) return; onStage ? showHome() : enterStage(); }
    else if (k === 'enter' && !onStage) enterStage();
    else if (k === 'b') cycle('backdrop');
    else if (k === 'l') cycle('light');
    else if (k === 'c') cycle('color');
    else if (k === 'i') { settings.info = !settings.info; applySettings(); }
    else if (k === 'f') toggleFull();
    else if (k === '[') nudge(-0.25);
    else if (k === ']') nudge(0.25);
    else if (k === 's') surprise();
    else if (k === ' ') { e.preventDefault(); send({ type: 'control', action: 'toggle' }); }
    else return;
    pokeUI();
  });
}

// ───────── frame loop ─────────
let lastFrame = performance.now(), lastWord = null, frameNo = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (paused) return;
  const dt = Math.min(0.1, (ts - lastFrame) / 1000);
  lastFrame = ts;
  frameNo++;
  let t = now();
  if (demo && t > DEMO.track.duration) { clock = { pos: 0, stamp: Date.now() / 1000, playing: true }; t = now(); }

  const s = cursor.at(t);
  style?.update(t, s);

  const il = $('#interlude');
  const showRest = !!s.rest && !s.rest.outro && timeline.length > 0;
  il.classList.toggle('show', showRest);
  if (showRest) il.querySelectorAll('i').forEach((d, i) => d.style.setProperty('--f', Math.max(0, Math.min(1, s.rest.p * 3 - i)).toFixed(3)));

  // pulse the edge light on each new word
  if (s.line && !s.rest) {
    let w = null;
    for (const x of s.line.words) if (t >= x.start) w = x;
    if (w && w !== lastWord && t - w.start < 0.25) app.edge.hit(w.emph === 2 ? 1 : w.emph ? 0.75 : 0.45);
    lastWord = w;
  }
  app.edge.tick(dt);
  if (settings.backdrop === 'gradient' && (!PREVIEW || frameNo % 3 === 0)) app.bg.draw(ts / 1000, app.edge.pulse);

  const dur = track?.duration;
  $('#progress div').style.width = dur ? `${Math.min(100, ((t - LEAD) / dur) * 100)}%` : '0';
}


// ───────── boot ─────────
applySettings();
setStyle(settings.style);

if (PREVIEW) {
  // live preview inside a landing-page card: demo lyrics only, controlled by the parent page
  document.body.classList.add('preview', 'on-stage');
  startDemo(2.4);
  addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'palette') setPalette(m.pal);
    else if (m.type === 'art' && m.url !== app.trackArt) {
      app.trackArt = m.url;
      swapLayer($('#bg-art'), 'art', m.url); swapLayer($('#center-art'), 'art', m.url);
    }
    else if (m.type === 'settings') {
      const keep = { style: settings.style, backdrop: HERO ? m.settings.backdrop : 'gradient', light: HERO ? m.settings.light : 'off', info: false };
      Object.assign(settings, m.settings, keep);
      applySettings();
    } else if (m.type === 'style') { setStyle(m.id); clock = { pos: 2.4, stamp: Date.now() / 1000, playing: true }; }
    else if (m.type === 'pause') paused = true;
    else if (m.type === 'play') paused = false;
  });
} else {
  const api = {
    settings, OPTIONS, STYLES,
    get track() { return track; }, get lyrics() { return lyrics; }, get demo() { return demo; },
    get playing() { return clock.playing; }, get screens() { return screenCount; }, get players() { return players; },
    get connected() { return !!ws && ws.readyState === 1; }, get palette() { return app.palette; },
    offset: () => (track ? offsets[track.id] || 0 : 0),
    set(key, val) { settings[key] = val; applySettings(); },
    setStyle, stepStyle, surprise, nudge, resetOffset, send, toggleFull, enterStage, showHome,
    setScreens(on) { settings.allScreens = on; save(); send({ type: 'screens', action: on ? 'all' : 'one' }); },
    toggleFav(id) { const f = settings.favs; const i = f.indexOf(id); i >= 0 ? f.splice(i, 1) : f.push(id); save(); },
  };
  home = initHome(api);
  wireStage();
  connect();
  setTimeout(() => { if (!track) startDemo(); }, 1500);
  if (SCREEN) { document.body.classList.add('extra-screen'); enterStage(); }
  else showHome();
}
requestAnimationFrame(frame);
