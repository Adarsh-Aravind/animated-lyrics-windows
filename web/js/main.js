import { buildTimeline, Cursor, LEAD, hash } from './engine.js';
import { STYLES } from './styles.js';
import { GradientBG, EdgeLight, swapLayer, paletteFromImage, fallbackPalette, applyPaletteVars } from './visuals.js';

const $ = (s) => document.querySelector(s);
const FORCE_DEMO = new URLSearchParams(location.search).has('demo');

// ───────── settings ─────────
const DEFAULTS = { style: 'glide', backdrop: 'gradient', light: 'glow', color: 'album', font: 'default', size: 1, intensity: 0.8, info: true, auto: false, welcomed: false };
const OPTIONS = {
  backdrop: [['gradient', 'Gradient'], ['blur', 'Blurred cover'], ['cover', 'Album cover'], ['black', 'Black']],
  light: [['glow', 'Glow'], ['flow', 'Flow'], ['sides', 'Side lights'], ['off', 'Off']],
  color: [['album', 'Match album'], ['white', 'White']],
  font: [['default', 'Style default'], ['Inter', 'Sans'], ['Nunito', 'Rounded'], ['"Instrument Serif"', 'Serif'], ['Anton', 'Condensed'], ['"JetBrains Mono"', 'Mono']],
};
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('al-settings') || '{}')); } catch {}
let offsets = {}; // per-song sync nudges (seconds), remembered between runs
try { offsets = JSON.parse(localStorage.getItem('al-offsets') || '{}'); } catch {}
let applyingRemote = false;
// Settings live on the local server too, so every screen's window stays in step.
function pushSettings() {
  if (applyingRemote || !window.__ws || window.__ws.readyState !== 1) return;
  window.__ws.send(JSON.stringify({ type: 'settings', data: { ...settings, offsets } }));
}
const save = () => { try { localStorage.setItem('al-settings', JSON.stringify(settings)); } catch {} pushSettings(); };
const saveOffsets = () => { try { localStorage.setItem('al-offsets', JSON.stringify(offsets)); } catch {} pushSettings(); };
const SCREEN = new URLSearchParams(location.search).get('screen'); // set on the extra-screen windows

function adoptRemote(data) {
  if (!data || !Object.keys(data).length) return false;
  applyingRemote = true;
  try {
    const { offsets: o, ...rest } = data;
    if (o) offsets = o;
    const styleChanged = rest.style && rest.style !== settings.style;
    Object.assign(settings, rest);
    try { localStorage.setItem('al-settings', JSON.stringify(settings)); localStorage.setItem('al-offsets', JSON.stringify(offsets)); } catch {}
    applySettings();
    if (styleChanged || !style) setStyle(settings.style);
  } finally { applyingRemote = false; }
  return true;
}

// ───────── app state ─────────
const app = {
  edge: new EdgeLight($('#edge')),
  bg: new GradientBG($('#bg-gradient')),
  trackTitle: '',
  palette: fallbackPalette('preview!', true),
};
const cursor = new Cursor();
let style = null;
let track = null;       // {id, title, artist, art, duration}
let lyrics = null;      // server lyrics payload
let timeline = [];
let clock = { pos: 0, stamp: 0, playing: false };
let demo = false;

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
  track: { id: 'demo', title: 'Preview', artist: 'Play a song in Spotify, YouTube or any player', art: null, duration: 46 },
  lyrics: { status: 'synced', lines: DEMO_LINES.map(([t, text]) => ({ t, text, words: text.split(' ').filter(Boolean).map((w) => ({ w, t: null })) })) },
};
let demoStart = 0;
function startDemo() {
  demo = true; demoStart = Date.now() / 1000;
  setTrack(DEMO.track); setLyrics({ ...DEMO.lyrics, id: 'demo' });
  clock = { pos: 0, stamp: demoStart, playing: true };
}

// ───────── track / lyrics handling ─────────
async function setTrack(t) {
  track = t;
  app.trackTitle = t.title;
  lyrics = null; timeline = []; cursor.set([]);
  style?.setTimeline([]);
  $('#ui-title').textContent = t.title || 'Nothing playing';
  $('#ui-sub').textContent = t.artist || '';
  $('#info-title').textContent = t.title;
  $('#info-artist').textContent = t.artist;
  $('#info').classList.toggle('has', !!t.title && t.id !== 'demo');
  $('#info-art').style.backgroundImage = t.art ? `url("${t.art}")` : '';
  swapLayer($('#bg-art'), 'art', t.art);
  swapLayer($('#center-art'), 'art', t.art);
  // demo gets a colourful preview palette; a real song without a cover gets soft white, never random colours
  let pal = t.id === 'demo' ? fallbackPalette('preview!', true) : fallbackPalette();
  if (t.art) { try { pal = await paletteFromImage(t.art); } catch {} }
  if (track !== t) return;
  app.palette = pal;
  applyPaletteVars(pal, settings.color);
  app.bg.setPalette(pal);
  updateMessage();
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
  if (demo) b = 'PREVIEW · play a song to start';
  else if (lyrics?.status === 'plain') b = 'Lyrics not time-synced · rough timing';
  else if (lyrics?.status === 'synced' && !lyrics.wordSynced) b = '';
  badge.textContent = b;
  badge.classList.toggle('show', !!b);
}

// ───────── websocket ─────────
let ws;
function connect() {
  ws = window.__ws = new WebSocket(`ws://${location.host}/ws${SCREEN ? `?screen=${SCREEN}` : ''}`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'hello') {
      $('#screens-row').hidden = !(m.screens > 1);
      // first ever run: seed the server with this window's settings
      if (!adoptRemote(m.settings)) pushSettings();
      return;
    }
    if (m.type === 'settings') { adoptRemote(m.data); return; }
    if (FORCE_DEMO) { if (!demo) startDemo(); return; }
    if (m.type === 'idle') { if (!demo) startDemo(); return; }
    if (m.type === 'track') {
      if (demo || !track || track.id !== m.id || track.art !== m.art) {
        const same = track && track.id === m.id && !demo;
        demo = false;
        if (same) { track.art = m.art; setTrack({ ...track, art: m.art }).then(() => lyrics && setLyrics(lyrics)); }
        else {
          if (settings.auto && track && track.id !== 'demo') surprise(true);
          setTrack({ id: m.id, title: m.title, artist: m.artist, art: m.art, duration: m.duration });
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
      if (m.playing !== clock.playing || Math.abs(actual - predicted) > 0.12) clock = next;
      $('#btn-play').innerHTML = m.playing ? '&#x23F8;' : '&#x25B6;';
    }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

// ───────── style switching ─────────
function setStyle(id) {
  const S = STYLES.find((s) => s.id === id) || STYLES[0];
  settings.style = S.id; save();
  style?.destroy();
  const root = $('#lyrics');
  root.className = `style-${S.id}`;
  root.innerHTML = '';
  style = new S(root, app);
  style.setTimeline(timeline);
  $('#style-hint').textContent = `${S.label} — ${S.hint}`;
  renderChips();
}
function cycle(key, list, dir = 1) {
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
  $('#opt-size').value = settings.size;
  $('#opt-intensity').value = settings.intensity;
  $('#opt-info').checked = !!settings.info;
  $('#opt-auto').checked = !!settings.auto;
  $('#opt-screens').checked = !!settings.allScreens;
  save(); renderChips();
  requestAnimationFrame(() => style?.relayout());
}

function renderChips() {
  const mk = (sel, items, key, onPick) => {
    const box = $(sel);
    box.innerHTML = '';
    for (const [val, label, title] of items) {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (title) btn.title = title;
      btn.classList.toggle('sel', settings[key] === val);
      btn.onclick = () => onPick(val);
      box.appendChild(btn);
    }
  };
  mk('#opt-style', STYLES.map((S) => [S.id, S.label, S.hint]), 'style', setStyle);
  for (const key of ['backdrop', 'light', 'color', 'font']) mk(`#opt-${key}`, OPTIONS[key], key, (v) => { settings[key] = v; applySettings(); });
  const off = track ? offsets[track.id] || 0 : 0;
  $('#off-val').textContent = off === 0 ? 'in sync' : `${off < 0 ? 'later' : 'sooner'} by ${Math.abs(off).toFixed(2).replace(/0$/, '')}s`;
  $('#off-val').title = off ? 'Click to reset' : '';
}

function nudge(d) {
  if (!track) return;
  offsets[track.id] = Math.round(((offsets[track.id] || 0) + d) * 100) / 100;
  if (offsets[track.id] === 0) delete offsets[track.id];
  saveOffsets();
  renderChips();
}

function surprise(stylesOnly = false) {
  const pick = (arr, not) => { const c = arr.filter((x) => x !== not); return c[Math.floor(Math.random() * c.length)]; };
  if (!stylesOnly) {
    settings.backdrop = pick(['gradient', 'gradient', 'blur', 'cover'], settings.backdrop);
    settings.light = pick(['glow', 'flow', 'sides'], settings.light);
    applySettings();
  }
  setStyle(pick(STYLES.map((s) => s.id), settings.style));
}

function showWelcome(show) {
  $('#welcome').hidden = !show;
  if (!show) { settings.welcomed = true; save(); }
}

// ───────── UI wiring ─────────
$('#opt-size').oninput = (e) => { settings.size = +e.target.value; applySettings(); };
$('#opt-intensity').oninput = (e) => { settings.intensity = +e.target.value; applySettings(); };
$('#opt-info').onchange = (e) => { settings.info = e.target.checked; applySettings(); };
$('#off-minus').onclick = () => nudge(-0.25); // lyrics too early → show them later
$('#off-plus').onclick = () => nudge(0.25);   // lyrics too late → show them sooner
$('#off-val').onclick = () => { if (track && offsets[track.id]) { delete offsets[track.id]; saveOffsets(); renderChips(); } };
$('#btn-surprise').onclick = () => surprise();
$('#opt-auto').onchange = (e) => { settings.auto = e.target.checked; save(); };
$('#opt-screens').onchange = (e) => {
  settings.allScreens = e.target.checked; save();
  send({ type: 'screens', action: e.target.checked ? 'all' : 'one' });
};
$('#welcome-ok').onclick = () => showWelcome(false);
$('#btn-help').onclick = () => showWelcome(true);
document.querySelectorAll('[data-ctl]').forEach((b) => (b.onclick = () => send({ type: 'control', action: b.dataset.ctl })));
const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));
$('#btn-full').onclick = toggleFull;

let uiTimer;
function pokeUI() {
  document.body.classList.add('ui-on');
  document.body.classList.remove('hide-cursor');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    if (!$('#ui').matches(':hover')) { document.body.classList.remove('ui-on'); document.body.classList.add('hide-cursor'); }
    else pokeUI();
  }, 2600);
}
addEventListener('mousemove', pokeUI);
addEventListener('mousedown', pokeUI);
addEventListener('dblclick', (e) => { if (!e.target.closest('#ui')) toggleFull(); });
addEventListener('resize', () => style?.relayout());
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  const ids = STYLES.map((s) => [s.id]);
  if (k === 'arrowright') { const i = ids.findIndex((x) => x[0] === settings.style); setStyle(ids[(i + 1) % ids.length][0]); }
  else if (k === 'arrowleft') { const i = ids.findIndex((x) => x[0] === settings.style); setStyle(ids[(i - 1 + ids.length) % ids.length][0]); }
  else if (k === 'b') cycle('backdrop', OPTIONS.backdrop);
  else if (k === 'l') cycle('light', OPTIONS.light);
  else if (k === 'c') cycle('color', OPTIONS.color);
  else if (k === 'i') { settings.info = !settings.info; applySettings(); }
  else if (k === 'f') toggleFull();
  else if (k === '[') nudge(-0.25);
  else if (k === ']') nudge(0.25);
  else if (k === 's') surprise();
  else if (k === 'enter' && !$('#welcome').hidden) showWelcome(false);
  else if (k === ' ') { e.preventDefault(); send({ type: 'control', action: 'toggle' }); }
  else if (k === 'escape') document.body.classList.remove('ui-on');
  else return;
  pokeUI();
});

// ───────── frame loop ─────────
let lastFrame = performance.now(), lastWord = null;
function frame(ts) {
  const dt = Math.min(0.1, (ts - lastFrame) / 1000);
  lastFrame = ts;
  let t = now();
  if (demo && t > DEMO.track.duration) { demoStart = Date.now() / 1000; clock = { pos: 0, stamp: demoStart, playing: true }; t = now(); }

  const s = cursor.at(t);
  style?.update(t, s);

  // interlude dots
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
  if (settings.backdrop === 'gradient') app.bg.draw(ts / 1000, app.edge.pulse);

  const dur = track?.duration;
  $('#progress div').style.width = dur ? `${Math.min(100, ((t - LEAD) / dur) * 100)}%` : '0';
  requestAnimationFrame(frame);
}

window.__lyricsDebug = () => ({ t: now(), clock, track: track && track.title, line: cursor.at(now()).line?.text });

// ───────── boot ─────────
applySettings();
setStyle(settings.style);
if (location.protocol.startsWith('http') && location.host) connect(); else startDemo();
setTimeout(() => { if (!track) startDemo(); }, 1500);
requestAnimationFrame(frame);
pokeUI();
if (!settings.welcomed && !FORCE_DEMO && !SCREEN) setTimeout(() => { if (!settings.welcomed) showWelcome(true); }, 600);
