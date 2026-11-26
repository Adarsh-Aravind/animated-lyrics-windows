// Lyric timing: turns LRC lines into lines + per-word start/end times.

export const LEAD = 0.12; // light words slightly early; feels in sync

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const ease = (p) => 1 - Math.pow(1 - p, 3);

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function weight(word) {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length;
  return 1.2 + letters * 0.9 + (/[,.;!?]$/.test(word) ? 1.4 : 0);
}

function emphasis(word, i, n) {
  const bare = word.replace(/[^\p{L}\p{N}']/gu, '');
  let e = 0;
  if (bare.length >= 6) e = 1;
  if (i === n - 1 && bare.length >= 3) e = Math.max(e, 1);
  if (/!$/.test(word) || (bare.length > 1 && bare === bare.toUpperCase() && /\p{L}/u.test(bare))) e = 2;
  if (e === 0 && hash(word + i) > 0.86 && bare.length >= 4) e = 1;
  return e;
}

/** lyrics: {status, lines:[{t, text, words:[{w, t}]}]}  → [{start, end, sungEnd, text, words:[{text,start,end,emph}]}] */
export function buildTimeline(lyrics, duration) {
  let raw = (lyrics && lyrics.lines) || [];
  if (!raw.length) return [];

  if (lyrics.status === 'plain') {
    // No timestamps: spread lines across the song as a best effort.
    const d = duration || raw.length * 4;
    const a = d * 0.06, b = d * 0.94;
    raw = raw.map((l, i) => ({ ...l, t: a + ((b - a) * i) / raw.length }));
  }

  const out = [];
  let blank = false; // an empty lyric line usually marks the start of a new section
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!r.text || !r.text.trim()) { blank = true; continue; }
    let next = null;
    for (let j = i + 1; j < raw.length; j++) {
      if (raw[j].t > r.t + 0.01) { next = raw[j].t; break; }
    }
    const start = r.t;
    const end = next ?? (duration ? Math.max(start + 2, Math.min(duration, start + 8)) : start + 6);
    const avail = end - start;
    const ws = r.words.length ? r.words : r.text.split(/\s+/).map((w) => ({ w, t: null }));
    const n = ws.length;

    // anchors: known word times; estimate the rest by word weight.
    const anchors = [{ i: 0, t: ws[0].t ?? start }];
    ws.forEach((w, k) => { if (k > 0 && w.t != null && w.t > anchors[anchors.length - 1].t) anchors.push({ i: k, t: w.t }); });
    const last = anchors[anchors.length - 1];
    const tailWords = n - last.i;
    let sungEnd;
    if (anchors.length > 1) sungEnd = Math.min(end - 0.05, last.t + tailWords * 0.42 + 0.25);
    else sungEnd = start + Math.min(avail * 0.9, n * 0.48 + 0.8);
    sungEnd = Math.max(sungEnd, last.t + 0.2);
    anchors.push({ i: n, t: sungEnd });

    const words = new Array(n);
    for (let a = 0; a < anchors.length - 1; a++) {
      const A = anchors[a], B = anchors[a + 1];
      const span = Math.max(0.05, B.t - A.t);
      let total = 0;
      for (let k = A.i; k < B.i; k++) total += weight(ws[k].w);
      let acc = A.t;
      for (let k = A.i; k < B.i; k++) {
        const d = (span * weight(ws[k].w)) / (total || 1);
        words[k] = { text: ws[k].w, start: acc, end: acc + d, emph: emphasis(ws[k].w, k, n), i: k };
        acc += d;
      }
    }
    const prev = out[out.length - 1];
    const brk = !prev || blank || start - prev.sungEnd > 2.2;
    blank = false;
    out.push({ start, end, sungEnd, text: r.text, words, index: out.length, brk });
  }
  // Collapse duplicated timestamps / keep ordering sane.
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.max(out[i].start + 0.3, Math.min(out[i].end, out[i + 1].start));
  return out;
}

export class Cursor {
  constructor() { this.lines = []; this.idx = -1; }
  set(lines) { this.lines = lines; this.idx = -1; }

  /** Where are we at time t? */
  at(t) {
    const L = this.lines;
    if (!L.length) return { idx: -1, line: null, rest: null };
    let lo = 0, hi = L.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (L[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    let rest = null;
    const next = L[idx + 1];
    if (idx === -1) {
      if (L[0].start > 3) rest = { start: 0, end: L[0].start, p: clamp(t / L[0].start) };
    } else {
      const cur = L[idx];
      const gapStart = cur.sungEnd + 1.6;
      const gapEnd = next ? next.start : Infinity;
      if (t > gapStart && gapEnd - cur.sungEnd > 6) {
        rest = { start: gapStart, end: gapEnd, p: next ? clamp((t - gapStart) / (gapEnd - gapStart)) : 0, outro: !next };
      }
    }
    this.idx = idx;
    return { idx, line: idx >= 0 ? L[idx] : null, rest, next: next || null };
  }
}

export const wordP = (w, t) => clamp((t - w.start) / Math.max(0.05, w.end - w.start));

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
