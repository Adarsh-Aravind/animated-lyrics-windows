// Album palette, animated gradient backdrop, cover layers and edge lighting.
import { hash } from './engine.js';

// ---------- color helpers ----------
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}
const css = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`);

function tune([h, s, l], minS, lightness) {
  return hslToRgb(h, Math.max(minS, Math.min(1, s * 1.15)), lightness);
}

/** Keep the cover's own hue and saturation; only move lightness so it can glow. Greys stay grey/white. */
function faithful([h, s, l], lo, hi, satBoost = 1.1) {
  const sat = s < 0.12 ? s : Math.min(1, s * satBoost);
  return hslToRgb(h, sat, Math.min(hi, Math.max(lo, l)));
}

export function fallbackPalette(seed = 'animated lyrics', colourful = false) {
  if (!colourful) return makePalette([[0, 0, 0.9], [0, 0, 0.75], [0, 0, 0.85], [0, 0, 0.7]], true); // no cover: soft white
  const h = hash(seed) * 360;
  return makePalette([[h, 0.8, 0.5], [h + 50, 0.75, 0.5], [h - 60, 0.8, 0.5], [h + 160, 0.7, 0.5]]);
}

function makePalette(hsls, real = false) {
  if (real) {
    const glow = hsls.map((c) => faithful(c, 0.5, 0.78));
    const deep = hsls.map((c) => faithful(c, 0.14, 0.24, 1));
    const lead = hsls[0];
    const accent = faithful(lead, 0.66, 0.8);
    const soft = faithful([lead[0], lead[1] * 0.6, lead[2]], 0.88, 0.92);
    return { glow, deep, accent, soft };
  }
  const glow = hsls.map((c) => tune(c, 0.55, 0.58));
  const deep = hsls.map((c) => tune(c, 0.45, 0.22));
  const accent = tune(hsls[0], 0.6, 0.72);
  const soft = tune(hsls[0], 0.35, 0.88);
  return { glow, deep, accent, soft };
}

/** Real colours from the cover only: never invents hues. */
export async function paletteFromImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data;

  // bucket pixels by colour (4 bits per channel) and average each bucket
  const buckets = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    const key = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4);
    const k = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    k.n++; k.r += r; k.g += gg; k.b += b;
    buckets.set(key, k);
  }
  const total = N * N;
  const cands = [...buckets.values()].map((k) => {
    const rgb = [k.r / k.n, k.g / k.n, k.b / k.n];
    const [h, s, l] = rgbToHsl(...rgb);
    // big areas win; colourful areas get a boost so a red logo beats a grey wall,
    // but they must still cover a real part of the cover (no single stray pixels)
    const vivid = s * (1 - Math.abs(l - 0.5) * 1.6);
    return { rgb, h, s, l, n: k.n, score: k.n * (0.35 + Math.max(0, vivid) * 2.2) };
  }).filter((c) => c.n / total > 0.004 && c.l > 0.07);

  const dist = (a, b) => {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
  };
  cands.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const c of cands) {
    if (chosen.every((x) => dist(x.rgb, c.rgb) > 120)) chosen.push(c);
    if (chosen.length === 4) break;
  }
  if (!chosen.length) chosen.push({ h: 0, s: 0, l: 0.85 }); // all-black cover → white light

  // order: most colourful first so it leads the lighting; repeat real colours if we found fewer than 4
  chosen.sort((a, b) => b.s * (1 - Math.abs(b.l - 0.5)) - a.s * (1 - Math.abs(a.l - 0.5)));
  const hsls = chosen.map((c) => [c.h, c.s, c.l]);
  while (hsls.length < 4) hsls.push(hsls[hsls.length % chosen.length]);
  return makePalette(hsls, true);
}

export function applyPaletteVars(pal, colorMode) {
  const r = document.documentElement.style;
  pal.glow.forEach((c, i) => r.setProperty(`--c${i + 1}`, css(c)));
  pal.deep.forEach((c, i) => r.setProperty(`--d${i + 1}`, css(c)));
  if (colorMode === 'white') {
    r.setProperty('--hi', '#ffffff');
    r.setProperty('--accent', '#ffffff');
    r.setProperty('--glow', 'rgba(255,255,255,.55)');
  } else {
    r.setProperty('--hi', css(pal.soft));
    r.setProperty('--accent', css(pal.accent));
    r.setProperty('--glow', css(pal.glow[0], 0.75));
  }
}

// ---------- animated mesh gradient ----------
export class GradientBG {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    canvas.width = 192; canvas.height = 108;
    this.cur = null; this.target = null; this.mix = 1;
  }
  setPalette(pal) {
    const cols = [...pal.glow, ...pal.deep.slice(0, 2)];
    this.from = this.current() || cols;
    this.target = cols; this.mix = 0;
  }
  current() {
    if (!this.target) return null;
    if (this.mix >= 1 || !this.from) return this.target;
    return this.target.map((c, i) => c.map((v, k) => Math.round(this.from[i][k] + (v - this.from[i][k]) * this.mix)));
  }
  draw(t, pulse) {
    if (!this.target) return;
    this.mix = Math.min(1, this.mix + 0.012);
    const cols = this.current();
    const { g } = this, W = 192, H = 108;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = css((cols[4] || [10, 10, 20]).map((v) => Math.round(v * 0.45)));
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const sp = 0.07 + i * 0.023;
      const x = W * (0.5 + 0.42 * Math.sin(t * sp + i * 2.1));
      const y = H * (0.5 + 0.40 * Math.cos(t * sp * 1.3 + i * 1.7));
      const r = W * (0.36 + 0.08 * Math.sin(t * 0.21 + i) + 0.05 * pulse);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, css(cols[i % cols.length], i < 4 ? 0.34 : 0.5));
      grd.addColorStop(1, css(cols[i % cols.length], 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }
  }
}

// ---------- cover layers (blurred backdrop + centre art), crossfaded ----------
export function swapLayer(container, cls, url) {
  const old = [...container.querySelectorAll(`.${cls}`)];
  if (url) {
    const layer = document.createElement('div');
    layer.className = cls;
    layer.style.backgroundImage = `url("${url}")`;
    container.appendChild(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('in')));
  }
  old.forEach((o) => { o.classList.remove('in'); setTimeout(() => o.remove(), 1600); });
}

// ---------- edge lighting ----------
export class EdgeLight {
  constructor(root) {
    this.root = root;
    this.pulse = 0;
    this.pulseEl = null;
  }
  setMode(mode) {
    this.root.className = mode === 'off' ? '' : `edge-${mode}`;
    this.root.innerHTML = '';
    if (mode === 'off') return;
    const add = (c) => { const d = document.createElement('div'); d.className = c; this.root.appendChild(d); return d; };
    if (mode === 'glow') { add('base'); this.pulseEl = add('pulse'); }
    if (mode === 'flow') {
      // two comets racing around the border: a soft glow layer + a crisp line layer, same rotation
      for (const kind of ['aura', 'glow', 'line']) {
        const band = add(`band ${kind}`);
        const spin = document.createElement('div');
        spin.className = 'spin';
        band.appendChild(spin);
      }
      this.pulseEl = add('pulse');
    }
    if (mode === 'sides') { add('side left'); add('side right'); this.pulseEl = add('pulse'); }
  }
  hit(strength = 1) { this.pulse = Math.min(1, Math.max(this.pulse, strength)); }
  tick(dt) {
    this.pulse *= Math.exp(-dt * 3.2);
    if (this.pulseEl) this.pulseEl.style.opacity = (this.pulse * 0.9).toFixed(3);
  }
}
