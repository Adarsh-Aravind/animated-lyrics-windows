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

// ---------- water: the cover behind a window with a slow sheet of water running down it ----------
const WATER_VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const WATER_FS = `#version 300 es
precision highp float;
uniform sampler2D uA, uB;      // previous / current image
uniform vec2 uSA, uSB;          // cover-fit scale for each
uniform float uMix, uTime, uPulse;
uniform vec2 uRes;
out vec4 o;

vec2 g2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(g2(i), f), dot(g2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(g2(i + vec2(0, 1)), f - vec2(0, 1)), dot(g2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
}
// thickness of the water film at p (x across, y downward), everything sliding slowly down the glass
float film(vec2 p, float t) {
  vec2 q = p;
  q.x += 0.22 * noise(vec2(p.x * 1.1 + 4.0, p.y * 0.45 - t * 0.018));        // sheets meander sideways
  float a = noise(vec2(q.x * 2.0, q.y * 0.5 - t * 0.028));                    // broad sheets
  float b = noise(vec2(q.x * 4.6 + 3.1, q.y * 1.05 - t * 0.045)) * 0.5;       // ridges inside them
  float c = noise(vec2(q.x * 10.0 + 7.7, q.y * 2.2 - t * 0.07)) * 0.18;       // fine ripples
  float sheet = smoothstep(-0.08, 0.1, a + b * 0.6);                         // soft leading edges
  return sheet * (0.6 + b + c);
}
// soft-focus sample: a small disc of taps so a busy cover becomes a calm wash of its colours
vec3 cover(sampler2D s, vec2 sc, vec2 uv, float asp) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996, r = sqrt((float(i) + 0.5) / 12.0) * 0.014;
    acc += texture(s, 0.5 + (uv + vec2(cos(a) / asp, sin(a)) * r - 0.5) * sc).rgb;
  }
  return acc / 12.0;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y, t = uTime;
  vec2 p = vec2((uv.x - 0.5) * asp, 1.0 - uv.y);
  float e = 0.004;
  float h = film(p, t);
  vec2 grad = vec2(film(p + vec2(e, 0.0), t) - h, film(p + vec2(0.0, e), t) - h) / e;
  // refraction through the film, plus a slight lens zoom where it is thick
  vec2 off = grad * 0.0065;
  vec2 tuv = uv + vec2(off.x / asp, -off.y);
  tuv = 0.5 + (tuv - 0.5) * (1.0 - h * 0.025);
  // a slow drift so the picture never feels frozen
  float z = 0.93 - 0.015 * sin(t * 0.045);
  tuv = 0.5 + (tuv - 0.5) * z + vec2(sin(t * 0.031), cos(t * 0.027)) * 0.008;

  vec3 col = mix(cover(uA, uSA, tuv, asp), cover(uB, uSB, tuv, asp), uMix);
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 0.82);   // a little less colour
  col *= 0.28 + 0.04 * uPulse;   // kept dim so the lyrics sit clearly on top

  // light catching the water: a soft sheen on the slopes, a brighter glint along the edges
  vec3 n = normalize(vec3(-grad * 0.35, 1.0));
  vec3 L = normalize(vec3(-0.35, 0.55, 1.0));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  float edge = clamp(length(grad) * 0.06, 0.0, 1.0);
  vec3 tint = mix(vec3(1.0), col * 2.2, 0.5);
  col += tint * (spec * 0.2 + edge * edge * 0.1);
  col *= 1.0 - edge * 0.16;           // thin dark meniscus line
  o = vec4(col, 1.0);
}`;

export class WaterBG {
  constructor(canvas) {
    this.c = canvas;
    this.gl = null;
    this.ok = true;
    this.mix = 1;
    this.art = null;
    this.palette = null;
    this.want = null; // picture waiting for GL to start
  }
  init() {
    const gl = this.c.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) { this.ok = false; return; }
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, WATER_VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, WATER_FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {};
      for (const n of ['uA', 'uB', 'uSA', 'uSB', 'uMix', 'uTime', 'uPulse', 'uRes']) this.u[n] = gl.getUniformLocation(prog, n);
      gl.uniform1i(this.u.uA, 0); gl.uniform1i(this.u.uB, 1);
      this.gl = gl;
      this.texA = { tex: this.makeTex(), w: 1, h: 1 };
      this.texB = { tex: this.makeTex(), w: 1, h: 1 };
      if (this.want) { const w = this.want; this.want = null; this.upload(w, true); }
    } catch (err) {
      console.warn('water background unavailable', err);
      this.ok = false;
    }
  }
  makeTex() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 8, 14, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  /** No cover: paint a soft picture from the palette so there is still something behind the glass. */
  paletteImage(pal) {
    const c = document.createElement('canvas');
    c.width = c.height = 480;
    const g = c.getContext('2d');
    g.fillStyle = css(pal.deep[0]); g.fillRect(0, 0, 480, 480);
    for (const [x, y, i] of [[0.25, 0.3, 0], [0.75, 0.35, 1], [0.35, 0.78, 2], [0.8, 0.8, 3], [0.55, 0.55, 0]]) {
      const grd = g.createRadialGradient(x * 480, y * 480, 0, x * 480, y * 480, 260);
      grd.addColorStop(0, css(pal.glow[i], 0.85)); grd.addColorStop(1, css(pal.glow[i], 0));
      g.fillStyle = grd; g.fillRect(0, 0, 480, 480);
    }
    return c;
  }
  upload(src, instant = false) {
    const gl = this.gl;
    if (!gl) { this.want = src; return; }
    // the current picture becomes "previous" and the new one fades in over it
    [this.texA, this.texB] = [this.texB, this.texA];
    gl.bindTexture(gl.TEXTURE_2D, this.texB.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.texB.w = src.naturalWidth || src.width; this.texB.h = src.naturalHeight || src.height;
    this.mix = instant ? 1 : 0;
  }
  async setArt(url) {
    this.art = url || null;
    if (!url) { if (this.palette) this.upload(this.paletteImage(this.palette)); return; }
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { return; }
    if (this.art === url) this.upload(img);
  }
  setPalette(pal) {
    this.palette = pal;
    if (!this.art) this.upload(this.paletteImage(pal));
  }
  fit(tx, W, H) {
    const ca = W / H, ia = tx.w / tx.h;
    return ca > ia ? [1, ia / ca] : [ca / ia, 1];
  }
  draw(t, pulse = 0) {
    if (!this.ok) return;
    if (!this.gl) { this.init(); if (!this.gl) return; }
    const gl = this.gl, c = this.c;
    const k = Math.min(1, 1500 / Math.max(1, c.clientWidth));
    const W = Math.max(2, Math.round(c.clientWidth * k)), H = Math.max(2, Math.round(c.clientHeight * k));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    gl.viewport(0, 0, W, H);
    this.mix = Math.min(1, this.mix + 0.012);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texA.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texB.tex);
    gl.uniform2f(this.u.uSA, ...this.fit(this.texA, W, H));
    gl.uniform2f(this.u.uSB, ...this.fit(this.texB, W, H));
    gl.uniform1f(this.u.uMix, this.mix);
    gl.uniform1f(this.u.uTime, t);
    gl.uniform1f(this.u.uPulse, pulse);
    gl.uniform2f(this.u.uRes, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
