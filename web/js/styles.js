// Lyric styles. Each style owns the DOM inside `root` and gets update(t, state) every frame.
// state = { idx, line, rest, next }   (rest = instrumental gap info or null)
import { el, wordP, clamp, hash, ease } from './engine.js';

class Base {
  constructor(root, app) { this.root = root; this.app = app; this.lines = []; this.idx = -2; }
  setTimeline(lines) { this.lines = lines; this.idx = -2; this.reset(); }
  reset() {}
  relayout() {}
  destroy() { this.root.innerHTML = ''; }
  /** active line for styles that clear the screen during instrumental breaks */
  lineIdx(s) { return s.rest ? -1 : s.idx; }
}

// ───────────────────────── Glide: scrolling list, karaoke fill ─────────────────────────
class Glide extends Base {
  static id = 'glide'; static label = 'Glide'; static hint = 'Smooth scrolling lines, words fill as they are sung';
  constructor(root, app) {
    super(root, app);
    this.list = el('div', 'gl-list');
    root.appendChild(this.list);
  }
  reset() {
    this.list.innerHTML = '';
    this.rows = this.lines.map((l) => {
      const row = el('div', 'gl-line');
      const ws = l.words.map((w) => {
        const s = el('span', 'gl-word', w.text);
        row.append(s, ' ');
        return s;
      });
      this.list.appendChild(row);
      return { row, ws, p: ws.map(() => -1) };
    });
    if (!this.lines.length) this.list.style.transform = '';
  }
  relayout() { this.layout(this.idx, true); }
  layout(idx, instant) {
    this.idx = idx;
    const focus = Math.max(0, idx);
    this.rows.forEach((r, i) => {
      const d = i - focus;
      r.row.style.setProperty('--d', Math.min(Math.abs(d), 5));
      r.row.classList.toggle('active', i === idx);
      r.row.classList.toggle('past', d < 0);
      if (i !== idx) r.ws.forEach((s, k) => { const v = d < 0 ? 1 : 0; if (r.p[k] !== v) { r.p[k] = v; s.style.setProperty('--p', v); s.classList.toggle('on', v > 0); } });
    });
    const r = this.rows[focus];
    if (!r) return;
    const y = r.row.offsetTop + r.row.offsetHeight / 2;
    if (instant) this.list.style.transition = 'none';
    this.list.style.transform = `translateY(${this.root.clientHeight * 0.46 - y}px)`;
    if (instant) { void this.list.offsetHeight; this.list.style.transition = ''; }
  }
  update(t, s) {
    if (s.idx !== this.idx) this.layout(s.idx);
    this.root.classList.toggle('resting', !!s.rest);
    const r = this.rows[s.idx];
    if (!r) return;
    s.line.words.forEach((w, k) => {
      const p = Math.round(wordP(w, t) * 100) / 100;
      if (p !== r.p[k]) {
        r.p[k] = p;
        r.ws[k].style.setProperty('--p', p);
        r.ws[k].classList.toggle('on', p > 0 && p < 1);
      }
    });
  }
}

// ───────────────────────── Pop: kinetic words, edited-video energy ─────────────────────────
const POP_IN = [
  [{ opacity: 0, transform: 'scale(2.2)', filter: 'blur(16px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }],
  [{ opacity: 0, transform: 'translateY(-0.9em) rotate(-8deg)' }, { opacity: 1, transform: 'none' }],
  [{ opacity: 0, transform: 'translateX(-1.2em) skewX(-18deg)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
  [{ opacity: 0, transform: 'translateY(0.7em) scaleY(0.3)' }, { opacity: 1, transform: 'none' }],
];
class Pop extends Base {
  static id = 'pop'; static label = 'Pop'; static hint = 'Words slam in one by one, big words hit harder';
  constructor(root, app) { super(root, app); this.stage = el('div', 'pop-stage'); root.appendChild(this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  clear() {
    if (!this.cur) return;
    const old = this.cur.box; this.cur = null;
    old.classList.add('exit');
    setTimeout(() => old.remove(), 650);
  }
  build(line) {
    const box = el('div', 'pop-line');
    const spans = line.words.map((w) => {
      const s = el('span', `pw e${w.emph}`, w.text);
      box.appendChild(s);
      return s;
    });
    this.stage.appendChild(box);
    this.cur = { box, spans, shown: spans.map(() => false), line, now: -1 };
  }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) { this.clear(); this.idx = idx; if (idx >= 0) this.build(this.lines[idx]); }
    const c = this.cur;
    if (!c) return;
    let now = -1;
    c.line.words.forEach((w, k) => {
      const on = t >= w.start;
      if (on) now = k;
      if (on && !c.shown[k]) {
        c.shown[k] = true;
        const v = Math.floor(hash(w.text + k + idx) * POP_IN.length);
        c.spans[k].animate(POP_IN[v], { duration: w.emph ? 520 : 360, easing: 'cubic-bezier(.17,1.35,.4,1)', fill: 'forwards' });
        if (w.emph >= 1 && t - w.start < 0.2) {
          this.stage.animate([{ transform: 'none' }, { transform: 'translate(-7px,5px) rotate(-.5deg)' }, { transform: 'translate(6px,-4px)' }, { transform: 'none' }], { duration: 240 });
        }
      } else if (!on && c.shown[k]) {
        c.shown[k] = false;
        c.spans[k].getAnimations().forEach((a) => a.cancel());
      }
    });
    if (now !== c.now) {
      if (c.now >= 0) c.spans[c.now].classList.remove('now');
      if (now >= 0) c.spans[now].classList.add('now');
      c.now = now;
    }
  }
}

// ───────────────────────── Stack: one huge word at a time, stacking up ─────────────────────────
const STACK_SIZES = [1, 0.46, 0.33, 0.25, 0.2];
class Stack extends Base {
  static id = 'stack'; static label = 'Stack'; static hint = 'Giant words stack on top of each other, reel style';
  constructor(root, app) { super(root, app); this.col = el('div', 'st-col'); root.appendChild(this.col); }
  reset() { this.col.innerHTML = ''; this.rows = []; this.count = 0; }
  whip() {
    this.rows.forEach((r, i) => {
      r.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-110vw) skewX(24deg)', opacity: 0 }],
        { duration: 420, delay: i * 35, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'forwards' });
      setTimeout(() => r.remove(), 480 + i * 35);
    });
    this.rows = []; this.count = 0;
  }
  push(w, k) {
    const bare = w.text.replace(/[^\p{L}\p{N}'&]/gu, '') || w.text;
    const r = el('div', `st-row e${w.emph}`, bare);
    r.dataset.len = bare.length;
    r.classList.toggle('alt', k % 3 === 2 || w.emph === 2);
    this.col.appendChild(r);
    this.rows.unshift(r);
    r.animate([{ transform: 'translateY(45%) scaleY(.15) skewX(-12deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 300, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    while (this.rows.length > STACK_SIZES.length) this.rows.pop().remove();
    this.restyle();
  }
  restyle() {
    this.rows.forEach((r, i) => {
      const f = STACK_SIZES[i];
      const len = Math.max(2, +r.dataset.len);
      r.style.fontSize = `calc(min(${18 * f}vh, ${(92 * f) / (len * 0.47)}vw) * var(--scale))`;
      r.style.opacity = [1, 0.8, 0.55, 0.35, 0.2][i];
      r.classList.toggle('newest', i === 0);
    });
  }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) { this.whip(); this.idx = idx; }
    if (idx < 0) return;
    const words = this.lines[idx].words;
    let n = 0;
    while (n < words.length && t >= words[n].start) n++;
    if (n < this.count) { this.col.innerHTML = ''; this.rows = []; this.count = 0; }
    while (this.count < n) { this.push(words[this.count], this.count); this.count++; }
  }
}

// ───────────────────────── Type: lyrics typed out like code ─────────────────────────
class Type extends Base {
  static id = 'type'; static label = 'Type'; static hint = 'Typed out in a code editor with a blinking cursor';
  constructor(root, app) {
    super(root, app);
    this.win = el('div', 'ty-win');
    const bar = el('div', 'ty-bar');
    bar.append(el('i'), el('i'), el('i'), (this.title = el('span', 'ty-title', 'lyrics.txt')));
    this.body = el('div', 'ty-body');
    this.win.append(bar, this.body);
    root.appendChild(this.win);
  }
  reset() { this.body.innerHTML = ''; this.cur = null; this.title.textContent = (this.app.trackTitle || 'lyrics').toLowerCase().replace(/[^\w]+/g, '_').slice(0, 40) + '.lrc'; }
  row(num) {
    const r = el('div', 'ty-row');
    r.append(el('span', 'ty-num', String(num).padStart(3, ' ')));
    const code = el('span', 'ty-code');
    r.appendChild(code);
    this.body.appendChild(r);
    while (this.body.children.length > 9) this.body.firstChild.remove();
    return { r, code };
  }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      if (this.cur) { this.cur.r.classList.add('done'); this.cur.cursor.remove(); }
      this.idx = idx;
      const num = idx >= 0 ? idx + 1 : (s.idx >= 0 ? s.idx + 1 : 0);
      const { r, code } = this.row(idx >= 0 ? num : '');
      const toks = (idx >= 0 ? this.lines[idx].words : []).map((w, k) => {
        const sp = el('span', `tk tk${Math.floor(hash(w.text.toLowerCase()) * 4)}${w.emph === 2 ? ' tkb' : ''}`);
        code.appendChild(sp);
        return sp;
      });
      const cursor = el('span', 'ty-cursor');
      code.appendChild(cursor);
      this.cur = { r, code, toks, cursor, shown: toks.map(() => -1) };
    }
    if (idx < 0 || !this.cur) return;
    let typing = false;
    this.lines[idx].words.forEach((w, k) => {
      const full = w.text + (k < this.cur.toks.length - 1 ? ' ' : '');
      const p = wordP(w, t);
      const n = p <= 0 ? 0 : Math.max(1, Math.ceil(clamp(p * 1.6) * full.length));
      if (p > 0 && p < 1) typing = true;
      if (n !== this.cur.shown[k]) { this.cur.shown[k] = n; this.cur.toks[k].textContent = full.slice(0, n); }
    });
    this.cur.cursor.classList.toggle('typing', typing);
  }
}

// ───────────────────────── Wave: letters bounce as they're sung ─────────────────────────
class Wave extends Base {
  static id = 'wave'; static label = 'Wave'; static hint = 'Letters hop as they are sung and ripple afterwards';
  constructor(root, app) { super(root, app); this.stage = el('div', 'wv-stage'); this.nextEl = el('div', 'wv-next'); root.append(this.stage, this.nextEl); }
  reset() { this.stage.innerHTML = ''; this.cur = null; this.nextEl.textContent = ''; }
  drop() {
    if (!this.cur) return;
    const box = this.cur.box; this.cur = null;
    box.querySelectorAll('.wc').forEach((c, i) => {
      const r = hash(i + c.textContent);
      c.animate([{ transform: c.style.transform || 'none', opacity: 1 },
        { transform: `translate(${(r - 0.5) * 120}px, ${40 + r * 50}vh) rotate(${(r - 0.5) * 140}deg)`, opacity: 0 }],
        { duration: 900 + r * 400, delay: i * 8, easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'forwards' });
    });
    setTimeout(() => box.remove(), 1500);
  }
  build(line) {
    const box = el('div', 'wv-line');
    let gi = 0;
    const words = line.words.map((w) => {
      const we = el('span', 'ww');
      const chars = [...w.text].map((ch) => { const c = el('span', 'wc', ch); c.gi = gi++; we.appendChild(c); return c; });
      box.append(we, ' ');
      return { we, chars, on: false };
    });
    this.stage.appendChild(box);
    this.cur = { box, words };
  }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      this.drop(); this.idx = idx;
      if (idx >= 0) this.build(this.lines[idx]);
      const nx = idx >= 0 ? this.lines[idx + 1] : s.next;
      this.nextEl.textContent = nx ? nx.text : '';
    }
    if (!this.cur) return;
    this.lines[idx].words.forEach((w, k) => {
      const W = this.cur.words[k];
      const p = wordP(w, t);
      const on = p > 0;
      if (on !== W.on) { W.on = on; W.we.classList.toggle('on', on); }
      const n = W.chars.length;
      W.chars.forEach((c, ci) => {
        const local = clamp(p * (n + 1.5) - ci, 0, 1.5);
        const hop = local > 0 && local < 1.5 ? Math.sin((local / 1.5) * Math.PI) : 0;
        const ripple = on ? Math.sin(t * 2.6 - c.gi * 0.42) * 0.045 : 0;
        const y = -hop * 0.28 + ripple;
        const sc = 1 + hop * 0.18;
        c.style.transform = `translateY(${y.toFixed(3)}em) scale(${sc.toFixed(3)})`;
      });
    });
  }
}

// ───────────────────────── Depth: fly through lyrics in 3D ─────────────────────────
class Depth extends Base {
  static id = 'depth'; static label = 'Depth'; static hint = 'Lines rush toward you out of the distance';
  constructor(root, app) {
    super(root, app);
    this.scene = el('div', 'dp-scene'); this.world = el('div', 'dp-world');
    this.scene.appendChild(this.world); root.appendChild(this.scene);
    this.planes = new Map();
  }
  reset() { this.world.innerHTML = ''; this.planes = new Map(); }
  plane(i) {
    let p = this.planes.get(i);
    if (p) return p;
    const L = this.lines[i];
    const box = el('div', 'dp-plane');
    const ws = L.words.map((w) => { const s = el('span', `dw e${w.emph}`, w.text); box.append(s, ' '); return s; });
    const h = hash(L.text + i);
    p = { box, ws, on: ws.map(() => false), x: ((i % 3) - 1) * 7, y: (((i * 7) % 3) - 1) * 5, rz: (h - 0.5) * 7 };
    this.world.appendChild(box);
    this.planes.set(i, p);
    return p;
  }
  update(t, s) {
    const idx = s.idx;
    this.world.style.transform = `rotateY(${Math.sin(t * 0.23) * 9}deg) rotateX(${Math.cos(t * 0.17) * 5}deg)`;
    const want = new Set();
    for (let i = Math.max(0, idx - 1); i <= idx + 2 && i < this.lines.length; i++) want.add(i);
    if (idx < 0 && this.lines.length) want.add(0);
    for (const [i, p] of this.planes) if (!want.has(i)) { p.box.remove(); this.planes.delete(i); }
    for (const i of want) {
      const L = this.lines[i];
      const p = this.plane(i);
      let z, op;
      if (t < L.start) {
        const k = L.start - t;
        z = -260 - k * 520; op = clamp(1 - k / 3.5) * 0.45;
      } else if (i === idx && !s.rest) {
        z = Math.min((t - L.start) * 22, 110); op = 1;
      } else {
        const gone = i === idx ? t - s.rest.start : t - L.end;
        z = 110 + ease(clamp(gone / 0.9)) * 1300; op = 1 - clamp(gone / 0.6);
      }
      z = Math.max(z, -2600);
      p.box.style.transform = `translate(-50%,-50%) translate3d(${p.x}vw, ${p.y}vh, ${z.toFixed(1)}px) rotateZ(${p.rz.toFixed(2)}deg)`;
      p.box.style.opacity = op.toFixed(3);
      L.words.forEach((w, k) => {
        const on = t >= w.start;
        if (on !== p.on[k]) { p.on[k] = on; p.ws[k].classList.toggle('on', on); }
      });
    }
  }
}

// ───────────────────────── Neon: words flicker on like a neon sign ─────────────────────────
class Neon extends Base {
  static id = 'neon'; static label = 'Neon'; static hint = 'Each word buzzes on like a neon tube';
  constructor(root, app) { super(root, app); this.stage = el('div', 'ne-stage'); root.appendChild(this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  off() {
    if (!this.cur) return;
    const b = this.cur.box; this.cur = null;
    b.classList.add('off');
    setTimeout(() => b.remove(), 900);
  }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      this.off(); this.idx = idx;
      if (idx >= 0) {
        const box = el('div', 'ne-line');
        box.style.setProperty('--nc', `var(--c${(idx % 4) + 1})`);
        const ws = this.lines[idx].words.map((w) => { const sp = el('span', `nw e${w.emph}`, w.text); box.append(sp, ' '); return sp; });
        this.stage.appendChild(box);
        this.cur = { box, ws, on: ws.map(() => false) };
      }
    }
    if (!this.cur) return;
    this.lines[idx].words.forEach((w, k) => {
      const on = t >= w.start;
      if (on !== this.cur.on[k]) { this.cur.on[k] = on; this.cur.ws[k].classList.toggle('lit', on); }
    });
  }
}

// ───────────────────────── Cinema: soft serif subtitles ─────────────────────────
class Cinema extends Base {
  static id = 'cinema'; static label = 'Cinema'; static hint = 'Quiet film-subtitle serif, words breathe in';
  constructor(root, app) { super(root, app); this.stage = el('div', 'ci-stage'); root.appendChild(this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      if (this.cur) { const b = this.cur.box; b.classList.add('exit'); setTimeout(() => b.remove(), 1400); this.cur = null; }
      this.idx = idx;
      if (idx >= 0) {
        const box = el('div', 'ci-line');
        const ws = this.lines[idx].words.map((w) => { const sp = el('span', 'cw', w.text); box.append(sp, ' '); return sp; });
        this.stage.appendChild(box);
        this.cur = { box, ws, on: ws.map(() => false) };
      }
    }
    if (!this.cur) return;
    this.lines[idx].words.forEach((w, k) => {
      const on = t >= w.start - 0.05;
      if (on !== this.cur.on[k]) { this.cur.on[k] = on; this.cur.ws[k].classList.toggle('on', on); }
    });
  }
}

// ───────────────────────── Spotlight: big centre line, neighbours as context ─────────────────────────
class Spotlight extends Base {
  static id = 'spot'; static label = 'Spotlight'; static hint = 'Previous / current / next, the current word glows under a moving light';
  constructor(root, app) {
    super(root, app);
    this.prev = el('div', 'sp-ctx sp-prev'); this.main = el('div', 'sp-main'); this.nxt = el('div', 'sp-ctx sp-next');
    this.beam = el('div', 'sp-beam');
    root.append(this.beam, this.prev, this.main, this.nxt);
  }
  reset() { this.main.innerHTML = ''; this.prev.textContent = this.nxt.textContent = ''; this.ws = []; }
  update(t, s) {
    const idx = s.idx;
    if (idx !== this.idx) {
      this.idx = idx;
      this.prev.textContent = idx > 0 ? this.lines[idx - 1].text : '';
      this.nxt.textContent = this.lines[idx + 1]?.text || '';
      this.main.innerHTML = '';
      this.main.animate([{ opacity: 0, transform: 'translateY(30px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.9,.3,1)' });
      this.ws = idx >= 0 ? this.lines[idx].words.map((w) => { const sp = el('span', 'sw', w.text); this.main.append(sp, ' '); return sp; }) : [];
      this.cur = -2;
    }
    this.root.classList.toggle('resting', !!s.rest);
    if (idx < 0) return;
    let cur = -1;
    this.lines[idx].words.forEach((w, k) => { if (t >= w.start) cur = k; });
    if (cur !== this.cur) {
      this.ws.forEach((sp, k) => { sp.classList.toggle('on', k <= cur); sp.classList.toggle('now', k === cur); });
      this.cur = cur;
      const sp = this.ws[cur];
      if (sp) {
        const r = sp.getBoundingClientRect(), R = this.root.getBoundingClientRect();
        this.beam.style.transform = `translate(${r.left + r.width / 2 - R.left}px, ${r.top + r.height / 2 - R.top}px)`;
      }
    }
  }
}

// ───────────────────────── Bounce: classic karaoke ball hopping word to word ─────────────────────────
class Bounce extends Base {
  static id = 'bounce'; static label = 'Bounce'; static hint = 'A glowing ball hops from word to word, karaoke style';
  constructor(root, app) {
    super(root, app);
    this.stage = el('div', 'bo-stage'); this.ball = el('div', 'bo-ball');
    root.append(this.stage, this.ball);
  }
  reset() { this.stage.innerHTML = ''; this.cur = null; this.ball.style.opacity = 0; }
  relayout() { if (this.cur) this.measure(); }
  measure() {
    const R = this.root.getBoundingClientRect();
    this.cur.pos = this.cur.ws.map((s) => { const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2 - R.left, y: r.top - R.top }; });
  }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      this.idx = idx;
      if (this.cur) { const b = this.cur.box; b.classList.add('exit'); setTimeout(() => b.remove(), 500); this.cur = null; }
      if (idx >= 0) {
        const box = el('div', 'bo-line');
        const ws = this.lines[idx].words.map((w) => { const sp = el('span', 'bw', w.text); box.append(sp, ' '); return sp; });
        this.stage.appendChild(box);
        this.cur = { box, ws, on: ws.map(() => false) };
        this.measure();
      }
    }
    if (!this.cur) { this.ball.style.opacity = 0; return; }
    const W = this.lines[idx].words, P = this.cur.pos;
    let k = -1;
    W.forEach((w, i) => {
      const on = t >= w.start;
      if (on) k = i;
      if (on !== this.cur.on[i]) {
        this.cur.on[i] = on; this.cur.ws[i].classList.toggle('on', on);
        if (on && t - w.start < 0.2) this.cur.ws[i].animate([{ transform: 'scale(1.18,.82)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
      }
    });
    let x, y, hop;
    if (k < 0) {
      const u = clamp(1 - (W[0].start - t) / 0.6);
      x = P[0].x - (1 - u) * 160; y = P[0].y; hop = Math.sin(u * Math.PI) * 60;
    } else if (k < W.length - 1) {
      const u = clamp((t - W[k].start) / Math.max(0.05, W[k + 1].start - W[k].start));
      x = P[k].x + (P[k + 1].x - P[k].x) * u;
      y = P[k].y + (P[k + 1].y - P[k].y) * u;
      hop = Math.sin(u * Math.PI) * Math.min(90, 30 + Math.abs(P[k + 1].x - P[k].x) * 0.35);
    } else { x = P[k].x; y = P[k].y; hop = 0; }
    this.ball.style.opacity = 1;
    this.ball.style.transform = `translate(${x}px, ${y - hop - 18}px)`;
  }
}

// ───────────────────────── Scatter: letters fly in from everywhere ─────────────────────────
class Scatter extends Base {
  static id = 'scatter'; static label = 'Scatter'; static hint = 'Letters fly in from all over the screen and snap into place';
  constructor(root, app) { super(root, app); this.stage = el('div', 'sc-stage'); root.appendChild(this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  away(c, seed) {
    const r1 = hash(seed + 'x'), r2 = hash(seed + 'y'), r3 = hash(seed + 'r');
    return `translate(${(r1 - 0.5) * 90}vw, ${(r2 - 0.5) * 80}vh) rotate(${(r3 - 0.5) * 360}deg) scale(${0.4 + r3 * 2})`;
  }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      if (this.cur) {
        const { box, chars } = this.cur;
        chars.forEach((c, i) => { c.classList.remove('in'); c.style.transform = this.away(c, i + 'out' + this.idx); });
        box.classList.add('exit');
        setTimeout(() => box.remove(), 900);
        this.cur = null;
      }
      this.idx = idx;
      if (idx >= 0) {
        const box = el('div', 'sc-line');
        const chars = [];
        const groups = this.lines[idx].words.map((w, wi) => {
          const we = el('span', 'sw2');
          const cs = [...w.text].map((ch, ci) => { const c = el('span', 'sc', ch); c.style.transform = this.away(c, `${idx}-${wi}-${ci}`); c.style.transitionDelay = `${ci * 22}ms`; we.appendChild(c); chars.push(c); return c; });
          box.append(we, ' ');
          return cs;
        });
        this.stage.appendChild(box);
        this.cur = { box, chars, groups, on: groups.map(() => false) };
      }
    }
    if (!this.cur) return;
    this.lines[idx].words.forEach((w, k) => {
      const on = t >= w.start - 0.15;
      if (on !== this.cur.on[k]) {
        this.cur.on[k] = on;
        this.cur.groups[k].forEach((c, ci) => { c.classList.toggle('in', on); if (!on) c.style.transform = this.away(c, `${idx}-${k}-${ci}`); else c.style.transform = ''; });
      }
    });
  }
}

// ───────────────────────── Love: hearts float up from every word ─────────────────────────
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.3 8.4 2.2 4 6.3 4c2.3 0 3.9 1.4 5.7 3.4C13.8 5.4 15.4 4 17.7 4 21.8 4 23.7 8.4 22 11.7 19.5 16.4 12 21 12 21z"/></svg>';
class Love extends Base {
  static id = 'love'; static label = 'Love'; static hint = 'Soft rounded words with little hearts floating up as they are sung';
  constructor(root, app) { super(root, app); this.fx = el('div', 'lv-fx'); this.stage = el('div', 'lv-stage'); root.append(this.fx, this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  hearts(span, n) {
    const r = span.getBoundingClientRect(), R = this.root.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const h = el('div', 'lv-heart');
      h.innerHTML = HEART;
      const size = 14 + Math.random() * 26;
      h.style.cssText = `left:${r.left - R.left + Math.random() * r.width}px; top:${r.top - R.top + r.height * 0.3}px; width:${size}px; height:${size}px; color:var(--c${1 + (i % 3)})`;
      this.fx.appendChild(h);
      const dx = (Math.random() - 0.5) * 140, dy = -(120 + Math.random() * 220);
      h.animate([{ transform: 'translate(-50%,0) scale(.2)', opacity: 0 }, { transform: `translate(calc(-50% + ${dx * 0.3}px), ${dy * 0.3}px) scale(1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(calc(-50% + ${dx}px), ${dy}px) scale(.8) rotate(${dx / 6}deg)`, opacity: 0 }],
        { duration: 1600 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => h.remove();
    }
  }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      if (this.cur) { const b = this.cur.box; b.classList.add('exit'); setTimeout(() => b.remove(), 900); this.cur = null; }
      this.idx = idx;
      if (idx >= 0) {
        const box = el('div', 'lv-line');
        const ws = this.lines[idx].words.map((w) => { const sp = el('span', `lw e${w.emph}`, w.text); box.append(sp, ' '); return sp; });
        this.stage.appendChild(box);
        this.cur = { box, ws, on: ws.map(() => false) };
      }
    }
    if (!this.cur) return;
    this.lines[idx].words.forEach((w, k) => {
      const on = t >= w.start;
      if (on !== this.cur.on[k]) {
        this.cur.on[k] = on;
        this.cur.ws[k].classList.toggle('on', on);
        if (on && t - w.start < 0.3) this.hearts(this.cur.ws[k], w.emph ? 4 : 1 + (hash(w.text + k) > 0.5));
      }
    });
  }
}

// ───────────────────────── Focus: the line is blurred, words snap into focus ─────────────────────────
class Focus extends Base {
  static id = 'focus'; static label = 'Focus'; static hint = 'Whole line sits out of focus; each word snaps sharp when sung';
  constructor(root, app) { super(root, app); this.stage = el('div', 'fo-stage'); root.appendChild(this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      if (this.cur) { const b = this.cur.box; b.classList.add('exit'); setTimeout(() => b.remove(), 1000); this.cur = null; }
      this.idx = idx;
      if (idx >= 0) {
        const box = el('div', 'fo-line');
        const ws = this.lines[idx].words.map((w) => { const sp = el('span', 'fw', w.text); box.append(sp, ' '); return sp; });
        this.stage.appendChild(box);
        box.animate([{ opacity: 0, filter: 'blur(30px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 500 });
        this.cur = { box, ws, on: ws.map(() => false) };
      }
    }
    if (!this.cur) return;
    const L = this.lines[idx];
    const z = clamp((t - L.start) / Math.max(1, L.end - L.start));
    this.cur.box.style.transform = `scale(${(1 + z * 0.07).toFixed(4)})`;
    L.words.forEach((w, k) => {
      const on = t >= w.start;
      if (on !== this.cur.on[k]) { this.cur.on[k] = on; this.cur.ws[k].classList.toggle('on', on); }
    });
  }
}

// ───────────────────────── Collage: magazine cut-out poster ─────────────────────────
const COLLAGE_LOOKS = ['cl-box', 'cl-serif', 'cl-out', 'cl-bold', 'cl-bold', 'cl-cond', 'cl-tape'];
class Collage extends Base {
  static id = 'collage'; static label = 'Collage'; static hint = 'Every word a different cut-out, slapped onto a poster';
  constructor(root, app) { super(root, app); this.stage = el('div', 'cl-stage'); root.appendChild(this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      if (this.cur) { const b = this.cur.box; b.classList.add('exit'); setTimeout(() => b.remove(), 500); this.cur = null; }
      this.idx = idx;
      if (idx >= 0) {
        const box = el('div', 'cl-line');
        const ws = this.lines[idx].words.map((w, k) => {
          const h = hash(w.text + k + idx);
          const look = w.emph === 2 ? 'cl-box' : COLLAGE_LOOKS[Math.floor(h * COLLAGE_LOOKS.length)];
          const sp = el('span', `cw2 ${look} e${w.emph}`, w.text);
          sp.style.setProperty('--rot', `${((hash(w.text + 'r' + k) - 0.5) * 12).toFixed(1)}deg`);
          sp.style.setProperty('--sz', (w.emph ? 1.35 + w.emph * 0.25 : 0.8 + h * 0.5).toFixed(2));
          box.appendChild(sp);
          return sp;
        });
        this.stage.appendChild(box);
        this.cur = { box, ws, on: ws.map(() => false) };
      }
    }
    if (!this.cur) return;
    this.lines[idx].words.forEach((w, k) => {
      const on = t >= w.start;
      if (on !== this.cur.on[k]) { this.cur.on[k] = on; this.cur.ws[k].classList.toggle('on', on); }
    });
  }
}

// ───────────────────────── Board: split-flap departure board ─────────────────────────
const FLAP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
class Board extends Base {
  static id = 'board'; static label = 'Board'; static hint = 'Letters clatter into place like an airport departure board';
  constructor(root, app) { super(root, app); this.stage = el('div', 'bd-stage'); root.appendChild(this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      if (this.cur) { const b = this.cur.box; b.classList.add('exit'); setTimeout(() => b.remove(), 500); this.cur = null; }
      this.idx = idx;
      if (idx >= 0) {
        const box = el('div', 'bd-line');
        const words = this.lines[idx].words.map((w) => {
          const we = el('span', 'bd-word');
          const tiles = [...w.text.toUpperCase()].map((ch) => { const tl = el('span', 'bd-tile', ' '); tl.final = ch; tl.shown = ' '; we.appendChild(tl); return tl; });
          box.appendChild(we);
          return tiles;
        });
        this.stage.appendChild(box);
        this.cur = { box, words };
      }
    }
    if (!this.cur) return;
    const tick = Math.floor(t * 22);
    this.lines[idx].words.forEach((w, k) => {
      this.cur.words[k].forEach((tl, ci) => {
        const settle = w.start + 0.12 + ci * 0.045;
        let ch = ' ';
        if (t >= settle) ch = tl.final;
        else if (t >= w.start - 0.05) ch = /[\p{L}\p{N}]/u.test(tl.final) ? FLAP[(tick * 7 + ci * 13 + k) % FLAP.length] : tl.final;
        if (ch !== tl.shown) {
          tl.shown = ch; tl.textContent = ch;
          tl.classList.toggle('lit', t >= settle);
          if (ch !== ' ') tl.classList.remove('flip'), void tl.offsetWidth, tl.classList.add('flip');
        }
      });
    });
  }
}

// ───────────────────────── Glitch: RGB-split digital glitches ─────────────────────────
class Glitch extends Base {
  static id = 'glitch'; static label = 'Glitch'; static hint = 'Words tear in with RGB-split digital glitches';
  constructor(root, app) { super(root, app); this.stage = el('div', 'gx-stage'); root.appendChild(this.stage); }
  reset() { this.stage.innerHTML = ''; this.cur = null; }
  update(t, s) {
    const idx = this.lineIdx(s);
    if (idx !== this.idx) {
      if (this.cur) { const b = this.cur.box; b.classList.add('exit'); setTimeout(() => b.remove(), 400); this.cur = null; }
      this.idx = idx;
      if (idx >= 0) {
        const box = el('div', 'gx-line');
        const ws = this.lines[idx].words.map((w) => { const sp = el('span', `gw e${w.emph}`, w.text); sp.dataset.t = w.text; box.append(sp, ' '); return sp; });
        this.stage.appendChild(box);
        this.cur = { box, ws, on: ws.map(() => false) };
      }
    }
    if (!this.cur) return;
    this.lines[idx].words.forEach((w, k) => {
      const on = t >= w.start;
      if (on !== this.cur.on[k]) {
        this.cur.on[k] = on; this.cur.ws[k].classList.toggle('on', on);
        if (on && w.emph && t - w.start < 0.2) this.cur.box.animate([{ transform: 'none' }, { transform: 'translateX(-8px) skewX(8deg)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 180, easing: 'steps(4)' });
      }
    });
  }
}

// ───────────────────────── Chat: the song as a two-person chat ─────────────────────────
const REACTIONS = ['❤️', '🔥', '😭', '✨', '🥹', '💯'];
const clockTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
class Chat extends Base {
  static id = 'chat'; static label = 'Chat'; static hint = 'WhatsApp-style bubbles: two people texting the song back and forth';
  constructor(root, app) {
    super(root, app);
    this.feed = el('div', 'ch-feed');
    root.appendChild(this.feed);
  }
  reset() {
    this.feed.innerHTML = '';
    this.msgs = new Map(); this.shown = -1; this.typing = null;
    // who "sends" each line: alternate, but a line ending in a comma keeps going from the same person
    // who sends each line: random runs like a real chat. Each person sends 1–3 bubbles before the
    // other replies (sometimes just one, sometimes a burst). A line that ends in a comma carries on
    // from the same person. Seeded by the song, so seeking back gives the same conversation.
    this.side = [];
    let st = Math.floor(hash((this.app.trackTitle || '') + '|' + (this.app.trackArtist || '')) * 4294967295) || 1;
    const rand = () => { // mulberry32: small seeded random number generator
      st = (st + 0x6d2b79f5) | 0;
      let x = Math.imul(st ^ (st >>> 15), 1 | st);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    let side = rand() > 0.5 ? 1 : 0, left = 0;
    this.lines.forEach((L, i) => {
      const prev = this.lines[i - 1];
      if (prev && /,\s*$/.test(prev.text)) { this.side.push(side); return; }
      if (left <= 0) {
        if (i > 0) side = 1 - side;
        const r = rand();
        left = r < 0.45 ? 1 : r < 0.8 ? 2 : 3;
      }
      this.side.push(side);
      left--;
    });
  }
  relayout() {}
  flip(mutate) {
    const kids = [...this.feed.children];
    const before = kids.map((k) => k.getBoundingClientRect().top);
    mutate();
    kids.forEach((k, i) => {
      if (!k.isConnected) return;
      const d = before[i] - k.getBoundingClientRect().top;
      if (Math.abs(d) > 1) k.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
    while (this.feed.children.length > 16) this.feed.firstChild.remove();
  }
  bubble(i, animate = true) {
    const L = this.lines[i];
    const me = this.side[i] === 1;
    const prev = this.feed.lastElementChild;
    const cont = prev && !prev.classList.contains('ch-typing') && prev.classList.contains(me ? 'me' : 'them');
    const b = el('div', `ch-msg ${me ? 'me' : 'them'}${cont ? ' cont' : ''}`);
    const txt = el('div', 'ch-text');
    const ws = L.words.map((w) => { const s = el('span', 'cw3', w.text); txt.append(s, ' '); return s; });
    const meta = el('span', 'ch-meta', clockTime());
    if (me) meta.appendChild(el('span', 'ch-ticks', '✓✓'));
    txt.appendChild(meta);
    b.appendChild(txt);
    this.flip(() => this.feed.appendChild(b));
    if (animate) b.animate([{ opacity: 0, transform: `translateY(14px) scale(.85)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,1.3,.4,1)' });
    const react = hash(L.text + i) > 0.82 ? REACTIONS[Math.floor(hash(L.text) * REACTIONS.length)] : null;
    this.msgs.set(i, { b, ws, on: ws.map(() => false), read: false, react, reacted: false });
  }
  setTyping(side) {
    if (this.typing && this.typing.side === side) return;
    this.clearTyping();
    const tb = el('div', `ch-msg ch-typing ${side === 1 ? 'me' : 'them'}`);
    tb.innerHTML = '<div class="ch-text"><i></i><i></i><i></i></div>';
    this.flip(() => this.feed.appendChild(tb));
    tb.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    this.typing = { el: tb, side };
  }
  clearTyping() {
    if (!this.typing) return;
    this.typing.el.remove();
    this.typing = null;
  }
  update(t, s) {
    const idx = s.idx;
    if (idx < this.shown) { // seeked backwards: rebuild recent history
      this.feed.innerHTML = ''; this.msgs.clear(); this.typing = null;
      for (let i = Math.max(0, idx - 7); i <= idx; i++) this.bubble(i, false);
      this.shown = idx;
    }
    while (this.shown < idx) {
      this.shown++;
      if (this.typing) this.clearTyping();
      if (idx - this.shown > 8) continue; // jumped far ahead: skip old lines
      this.bubble(this.shown);
    }
    // typing dots shortly before the next line arrives
    const nx = this.lines[idx + 1];
    if (nx && t >= nx.start - 1.3 && t < nx.start && (idx < 0 || t > this.lines[idx].sungEnd - 0.2)) this.setTyping(this.side[idx + 1]);
    else if (this.typing && (!nx || t < nx.start - 1.3)) this.clearTyping();
    // light words in the live bubble, mark read, add the odd reaction
    for (const [i, m] of this.msgs) {
      if (i < idx - 1 && m.read && (!m.react || m.reacted)) continue;
      const L = this.lines[i];
      L.words.forEach((w, k) => {
        const on = t >= w.start || i < idx;
        if (on !== m.on[k]) { m.on[k] = on; m.ws[k].classList.toggle('on', on); }
      });
      if (!m.read && t > L.sungEnd + 0.4) { m.read = true; m.b.classList.add('read'); }
      if (m.react && !m.reacted && t > L.sungEnd + 0.8) {
        m.reacted = true;
        const r = el('span', 'ch-react', m.react);
        m.b.appendChild(r);
        r.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
      }
    }
  }
}

export const STYLES = [Glide, Chat, Pop, Stack, Spotlight, Bounce, Love, Wave, Scatter, Depth, Focus, Neon, Collage, Board, Glitch, Type, Cinema];
const CATS = {
  glide: 'Classic', spot: 'Classic', bounce: 'Classic', focus: 'Classic', cinema: 'Classic',
  pop: 'Kinetic', stack: 'Kinetic', scatter: 'Kinetic', glitch: 'Kinetic', collage: 'Kinetic', wave: 'Kinetic',
  chat: 'Scenes', depth: 'Scenes', neon: 'Scenes', board: 'Scenes', type: 'Scenes', love: 'Scenes',
};
STYLES.forEach((S) => { S.cat = CATS[S.id] || 'Classic'; });
