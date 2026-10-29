// Der Film auf der Startseite: warum Einfügen in GoodNotes schlecht ist und was Siebwrite anders macht.
// Kein Video, sondern eine SVG-Szene, die für jede Zeit t eindeutig gezeichnet wird (render(t)).
// Dadurch gehen Spulen, Pause und Schleife ohne Zustand, und alles bleibt gestochen scharf.

import { GLYPHS } from './hand-font.js';

const NS = 'http://www.w3.org/2000/svg';
export const DURATION = 37;
export const CHAPTERS = [{ at: 0, label: 'Problem' }, { at: 18.4, label: 'Lösung' }];
export const POSTER = 27.95;

// ---------- Zeit und Bewegung ----------

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const span = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = {
  out: (p) => 1 - (1 - p) ** 3,
  inOut: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  expo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  inExpo: (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
  back: (p) => { const c = 1.7; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; },
};
// Sichtbarkeit zwischen a und b mit weichem Ein- und Ausblenden
const shown = (t, a, b, fin = 0.45, fout = 0.35) => Math.min(ease.out(span(t, a, a + fin)), 1 - ease.inOut(span(t, b - fout, b)));
// Kurzer Ausschlag: schnell hin, langsamer zurück (Tastendruck)
const press = (t, at) => (t < at ? 0 : t < at + 0.07 ? (t - at) / 0.07 : 1 - ease.out(span(t, at + 0.2, at + 0.42)));

// Weg durch Stützpunkte [t, x, y], zwischen zwei Punkten weich beschleunigt
function along(t, keys) {
  if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
  for (let i = 1; i < keys.length; i++) {
    const [t1, x1, y1] = keys[i];
    if (t <= t1) {
      const [t0, x0, y0] = keys[i - 1];
      const p = ease.inOut(span(t, t0, t1));
      return { x: lerp(x0, x1, p), y: lerp(y0, y1, p) };
    }
  }
  const k = keys.at(-1);
  return { x: k[1], y: k[2] };
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- SVG-Bausteine ----------

function el(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}
// Attribut nur schreiben, wenn es sich ändert: spart pro Bild Hunderte DOM-Zugriffe
function set(node, name, value) {
  const v = typeof value === 'number' ? String(Math.round(value * 100) / 100) : value;
  node.__v ??= {};
  if (node.__v[name] !== v) { node.__v[name] = v; node.setAttribute(name, v); }
}
const move = (node, x, y, s = 1, r = 0) => set(node, 'transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})${s !== 1 ? ` scale(${s.toFixed(4)})` : ''}${r ? ` rotate(${r.toFixed(2)})` : ''}`);
const fade = (node, o) => { set(node, 'opacity', clamp(o)); set(node, 'visibility', o <= 0.001 ? 'hidden' : 'visible'); };

// Breite eines Textes in der Handschrift, ohne Zittern
export function measure(text, em) {
  let w = 0;
  for (const ch of text) w += (GLYPHS[ch] ?? GLYPHS[' '])[0] * em / 1000;
  return w;
}

// Ein Text in Handschrift als einzelne Striche, die sich nacheinander schreiben lassen.
// Jedes Zeichen bekommt ein wenig eigene Neigung, Größe und Höhe, wie bei echter Schrift.
class Hand {
  constructor(parent, text, { x, y, em, color, width = 2.4, seed = 7, jitter = 1, lineGap = 46, gap = 0.4 }) {
    this.group = el('g', { fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, parent);
    this.paths = [];
    this.glyphs = [];
    const r = rng(seed);
    let word = 0;
    text.split('\n').forEach((line, li) => {
      let cx = x;
      const base = y + li * lineGap;
      for (const ch of line) {
        const [adv, strokes] = GLYPHS[ch] ?? GLYPHS[' '];
        if (ch === ' ') { word++; cx += adv * em / 1000; continue; }
        const s = (em / 1000) * (1 + (r() - 0.5) * 0.07 * jitter);
        const rot = (r() - 0.5) * 0.06 * jitter;
        const dy = (r() - 0.5) * em * 0.035 * jitter;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const glyph = { x0: cx, x1: cx + adv * em / 1000, cx: cx + adv * em / 2000, word, line: li, alpha: 1, paths: [] };
        for (const st of strokes) {
          const pts = [];
          for (let i = 0; i < st.length; i += 2) {
            const gx = st[i], gy = st[i + 1];
            pts.push((gx * cos - gy * sin) * s + cx, (gx * sin + gy * cos) * s + base + dy);
          }
          let len = 0;
          for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
          len = Math.max(len, 0.5);
          let d = `M${pts[0].toFixed(1)} ${pts[1].toFixed(1)}`;
          for (let i = 2; i < pts.length; i += 2) d += `L${pts[i].toFixed(1)} ${pts[i + 1].toFixed(1)}`;
          if (pts.length === 2) d += `l0.1 0`;
          const node = el('path', { d, 'stroke-dasharray': `${len.toFixed(1)} ${(len + 2).toFixed(1)}`, 'stroke-dashoffset': len.toFixed(1), visibility: 'hidden' }, this.group);
          const path = { node, pts, len, glyph };
          glyph.paths.push(path);
          this.paths.push(path);
        }
        this.glyphs.push(glyph);
        cx += adv * em / 1000;
      }
      word++;
    });
    // Stiftweg zwischen zwei Strichen zählt mit, damit das Tempo natürlich wirkt
    this.gap = em * gap;
    this.total = this.paths.reduce((sum, p, i) => sum + p.len + (i ? this.gap : 0), 0);
  }

  // Wörter in Schreibreihenfolge (Index über alle Zeilen)
  word(i) {
    const g = this.glyphs.filter((gl) => gl.word === i);
    return { x0: g[0].x0, x1: g.at(-1).x1, glyphs: g };
  }

  // Schreibt bis zum Anteil p und liefert, wo die Stiftspitze steht und ob sie aufliegt
  draw(p) {
    const target = p * this.total;
    let acc = 0;
    let pen = null;
    this.paths.forEach((path, i) => {
      const start = acc + (i ? this.gap : 0);
      const f = clamp((target - start) / path.len);
      if (!pen) {
        if (target < start && i) {
          const prev = this.paths[i - 1].pts;
          const q = clamp((target - acc) / this.gap);
          pen = { x: lerp(prev.at(-2), path.pts[0], q), y: lerp(prev.at(-1), path.pts[1], q), down: false };
        } else if (target <= start) {
          pen = { x: path.pts[0], y: path.pts[1], down: false };
        } else if (f < 1) {
          pen = { ...pointAt(path.pts, f * path.len), down: true };
        }
      }
      set(path.node, 'stroke-dashoffset', (path.len * (1 - f)).toFixed(1));
      const a = f > 0 ? path.glyph.alpha : 0;
      set(path.node, 'visibility', a > 0.01 ? 'visible' : 'hidden');
      set(path.node, 'opacity', a);
      acc = start + path.len;
    });
    if (!pen) { const last = this.paths.at(-1).pts; pen = { x: last.at(-2), y: last.at(-1), down: false }; }
    pen.active = p > 0 && p < 1;
    return pen;
  }
}

function pointAt(pts, dist) {
  for (let i = 2; i < pts.length; i += 2) {
    const seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (dist <= seg || i === pts.length - 2) {
      const q = seg ? clamp(dist / seg) : 0;
      return { x: lerp(pts[i - 2], pts[i], q), y: lerp(pts[i - 1], pts[i + 1], q) };
    }
    dist -= seg;
  }
  return { x: pts[0], y: pts[1] };
}

// ---------- Szene ----------

// iPad und Seite (Koordinaten im 1600×900-Bild)
const PAD = { x: 880, y: 50, w: 640, h: 800 };
const SCR = { x: PAD.x + 24, y: PAD.y + 24, w: PAD.w - 48, h: PAD.h - 48 };
const LINE = (k) => 214 + 46 * k;
const PX = SCR.x + 46;
const PAGE_W = SCR.w - 92;
const INK = '#16338f';
const SILVER = '#eef0f3';
const MUTED = '#80858e';

function build(svg) {
  const defs = el('defs', {}, svg);
  defs.innerHTML = `
    <radialGradient id="f-sky" cx="0.22" cy="-0.1" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="0.07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="f-lamp" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="f-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3c42"/><stop offset="0.45" stop-color="#1b1c20"/><stop offset="1" stop-color="#2b2d32"/></linearGradient>
    <linearGradient id="f-edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.08"/><stop offset="1" stop-color="#fff" stop-opacity="0.18"/></linearGradient>
    <linearGradient id="f-key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#222327"/><stop offset="1" stop-color="#151619"/></linearGradient>
    <linearGradient id="f-pen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b9bdc4"/><stop offset="0.45" stop-color="#f4f5f7"/><stop offset="1" stop-color="#c3c7cd"/></linearGradient>
    <linearGradient id="f-wipe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="f-trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.06"/></linearGradient>
    <filter id="f-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="f-shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="22"/></filter>
    <clipPath id="f-screen"><rect x="${SCR.x}" y="${SCR.y}" width="${SCR.w}" height="${SCR.h}" rx="30"/></clipPath>`;

  el('rect', { width: 1600, height: 900, fill: '#0c0d0f' }, svg);
  el('rect', { width: 1600, height: 900, fill: 'url(#f-sky)' }, svg);
  el('circle', { cx: 1200, cy: 450, r: 620, fill: 'url(#f-lamp)' }, svg);

  // ----- iPad (folgt der Kamera) -----
  const cam = el('g', {}, svg);
  el('rect', { x: PAD.x + 30, y: PAD.y + 60, width: PAD.w - 60, height: PAD.h - 30, rx: 60, fill: '#000', opacity: 0.7, filter: 'url(#f-shadow)' }, cam);
  el('rect', { x: PAD.x, y: PAD.y, width: PAD.w, height: PAD.h, rx: 54, fill: 'url(#f-metal)' }, cam);
  el('rect', { x: PAD.x + 0.75, y: PAD.y + 0.75, width: PAD.w - 1.5, height: PAD.h - 1.5, rx: 53, fill: 'none', stroke: 'url(#f-edge)', 'stroke-width': 1.5 }, cam);
  el('rect', { x: PAD.x + 10, y: PAD.y + 10, width: PAD.w - 20, height: PAD.h - 20, rx: 44, fill: '#060607' }, cam);
  el('circle', { cx: PAD.x + PAD.w / 2, cy: PAD.y + 17, r: 3, fill: '#1c1d21' }, cam);

  const screen = el('g', { 'clip-path': 'url(#f-screen)' }, cam);
  el('rect', { x: SCR.x, y: SCR.y, width: SCR.w, height: SCR.h, fill: '#fdfdfc' }, screen);
  for (let k = 0; k < 13; k++) el('line', { x1: SCR.x, x2: SCR.x + SCR.w, y1: LINE(k) + 0.5, y2: LINE(k) + 0.5, stroke: '#cdd7ea', 'stroke-width': 1 }, screen);
  el('line', { x1: SCR.x + 30, x2: SCR.x + 30, y1: SCR.y + 58, y2: SCR.y + SCR.h, stroke: '#efc9cc', 'stroke-width': 1 }, screen);

  // Werkzeugleiste: Stift, Radierer, Lasso, Text
  el('rect', { x: SCR.x, y: SCR.y, width: SCR.w, height: 58, fill: '#f3f3f5' }, screen);
  el('line', { x1: SCR.x, x2: SCR.x + SCR.w, y1: SCR.y + 58.5, y2: SCR.y + 58.5, stroke: '#e2e2e7' }, screen);
  const TOOL_X = [1104, 1168, 1232, 1296];
  const toolHi = el('rect', { x: -22, y: SCR.y + 9, width: 44, height: 40, rx: 11, fill: '#e3e5eb' }, screen);
  const icons = el('g', { fill: 'none', stroke: '#5d626b', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, screen);
  const ty = SCR.y + 29;
  el('path', { d: `M${TOOL_X[0] - 8} ${ty + 9} l3 -9 l11 -11 l6 6 l-11 11 z M${TOOL_X[0] + 3} ${ty - 6} l6 6` }, icons);
  el('path', { d: `M${TOOL_X[1] - 10} ${ty + 4} l9 -11 l9 7 l-8 10 h-7 z M${TOOL_X[1] - 4} ${ty + 10} h12` }, icons);
  el('path', { d: `M${TOOL_X[2] + 7} ${ty + 4} c8 -6 4 -15 -7 -15 c-11 0 -14 9 -6 14 c3 2 7 2 9 1 M${TOOL_X[2] - 3} ${ty + 4} c-2 4 0 8 3 7` }, icons);
  el('path', { d: `M${TOOL_X[3] - 8} ${ty - 9} h16 M${TOOL_X[3]} ${ty - 9} v19` }, icons);
  const TOOLS = [[0, 0], [5.05, 3], [9.55, 1], [14.6, 0], [28.5, 1], [29.65, 0]];

  // Inhalt der Seite
  const page = el('g', {}, screen);
  const heading = new Hand(page, 'Biologie', { x: PX, y: LINE(0), em: 70, color: INK, width: 2.8, seed: 3 });
  const topic = new Hand(page, 'Zellatmung', { x: PX, y: LINE(2), em: 46, color: INK, width: 2.4, seed: 11 });
  const topicW = measure('Zellatmung', 46);
  const underline = el('path', { d: `M${PX - 2} ${LINE(2) + 9} C${PX + topicW * 0.4} ${LINE(2) + 12} ${PX + topicW * 0.7} ${LINE(2) + 6} ${PX + topicW + 8} ${LINE(2) + 8}`, fill: 'none', stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1 2', 'stroke-dashoffset': 1 }, page);

  // Eingefügter Text: Textfeld mit Systemschrift
  const SENT = ['Mitochondrien sind die Kraftwerke', 'der Zelle.'];
  const box = el('g', {}, page);
  const boxInner = el('g', {}, box);
  const typed = SENT.map((s, i) => el('text', { x: PX, y: LINE(4) + i * 46 - 2, 'font-family': '"Helvetica Neue", Helvetica, Arial, sans-serif', 'font-size': 25, fill: '#1d1d1f' }, boxInner));
  typed.forEach((n, i) => { n.textContent = SENT[i]; });
  const boxW = 420;
  const sel = el('g', {}, boxInner);
  el('rect', { x: PX - 12, y: LINE(4) - 30, width: boxW, height: 92, fill: 'none', stroke: '#8f96a3', 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }, sel);
  for (const [hx, hy] of [[PX - 12, LINE(4) - 30], [PX - 12 + boxW, LINE(4) - 30], [PX - 12, LINE(4) + 62], [PX - 12 + boxW, LINE(4) + 62]]) {
    el('circle', { cx: hx, cy: hy, r: 5.5, fill: '#fff', stroke: '#8f96a3', 'stroke-width': 1.4 }, sel);
  }
  const boxCx = PX - 12 + boxW / 2, boxCy = LINE(4) + 16;

  // Abschreiben von Hand: mühsam, wird nie fertig
  const copy = new Hand(page, 'Mitochondrien', { x: PX, y: LINE(7), em: 44, color: INK, width: 2.4, seed: 5 });

  // Ergebnis aus Siebwrite: gleiche Stelle, echte Striche
  const bodyEm = Math.min(44, PAGE_W / measure('Mitochondrien sind die Energiequellen', 1));
  const result = new Hand(page, `${SENT[0]}\n${SENT[1]}`, { x: PX, y: LINE(4), em: bodyEm, color: INK, width: 2.3, seed: 21 });
  const kraft = result.word(3);
  const fix = new Hand(page, 'Energiequellen', { x: kraft.x0, y: LINE(4), em: bodyEm, color: INK, width: 2.3, seed: 33 });

  const dim = el('rect', { x: SCR.x, y: SCR.y, width: SCR.w, height: SCR.h, fill: '#0c0d0f', opacity: 0 }, screen);

  // Stift (Spitze im Ursprung) und Radierer
  const pen = el('g', {}, cam);
  const penShadow = el('g', { opacity: 0.22, filter: 'url(#f-soft)' }, pen);
  el('path', { d: 'M0 0 L-7 -26 L-7 -230 Q0 -240 7 -230 L7 -26 Z', fill: '#000' }, penShadow);
  const penBody = el('g', {}, pen);
  el('path', { d: 'M0 0 L-6.5 -24 L6.5 -24 Z', fill: '#c9ccd2' }, penBody);
  el('path', { d: 'M0 0 L-2.2 -8 L2.2 -8 Z', fill: '#3a3d44' }, penBody);
  el('path', { d: 'M-7 -24 L-7 -226 Q0 -236 7 -226 L7 -24 Z', fill: 'url(#f-pen)', stroke: 'rgba(0,0,0,0.18)', 'stroke-width': 0.8 }, penBody);
  el('line', { x1: -7, x2: 7, y1: -170, y2: -170, stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 1 }, penBody);

  const eraser = el('g', {}, cam);
  el('circle', { r: 17, fill: 'rgba(120,126,138,0.10)', stroke: '#9aa0aa', 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, eraser);
  const eraserBody = el('g', {}, eraser);
  el('rect', { x: -15, y: -58, width: 30, height: 56, rx: 8, fill: '#000', opacity: 0.2, filter: 'url(#f-soft)', transform: 'translate(8 6)' }, eraserBody);
  el('rect', { x: -15, y: -58, width: 30, height: 56, rx: 8, fill: '#f1f2f4', stroke: '#b9bdc4', 'stroke-width': 1 }, eraserBody);
  el('rect', { x: -15, y: -58, width: 30, height: 20, rx: 8, fill: '#8e939c' }, eraserBody);
  const nope = el('g', { stroke: '#e5484d', 'stroke-width': 3, 'stroke-linecap': 'round' }, cam);
  el('path', { d: 'M-8 -8 L8 8 M8 -8 L-8 8' }, nope);

  // ----- Vordergrund ohne Kamera: Titel, Tasten, Stoppuhr, Raster, Textfeld, Schluss -----
  const hud = el('g', {}, svg);

  function caption(kicker, title, a, b) {
    const g = el('g', {}, hud);
    const k = kicker ? el('text', { x: 110, y: 150, 'font-family': '"IBM Plex Mono", monospace', 'font-size': 17, 'letter-spacing': 3.4, fill: MUTED }, g) : null;
    if (k) k.textContent = kicker.toUpperCase();
    const line = el('g', {}, g);
    const words = title.split(' ').map((w) => {
      const n = el('text', { 'font-family': 'Newsreader, Georgia, serif', 'font-size': 60, fill: SILVER, 'letter-spacing': -1 }, line);
      n.textContent = w;
      return n;
    });
    let x = 110;
    const space = 15;
    const placed = words.map((n) => { const at = x; x += n.getComputedTextLength() + space; return at; });
    const id = `f-clip-${a}`.replace('.', '-');
    el('clipPath', { id }, defs).append(el('rect', { x: 0, y: 160, width: 900, height: 96 }));
    set(line, 'clip-path', `url(#${id})`);
    return (t) => {
      const out = ease.inOut(span(t, b - 0.4, b));
      fade(g, t > a - 0.01 && t < b ? 1 : 0);
      if (k) { const p = ease.expo(span(t, a, a + 0.8)); fade(k, p * (1 - out)); move(k, (1 - p) * -12, 0); }
      words.forEach((n, i) => {
        const p = ease.expo(span(t, a + 0.12 + i * 0.07, a + 0.95 + i * 0.07));
        move(n, placed[i], 232 + (1 - p) * 70 - out * 18);
        set(n, 'opacity', p * (1 - out));
      });
    };
  }
  const captions = [
    caption('01 — Problem', 'Notizen in GoodNotes.', 0.45, 3.95),
    caption('01 — Problem', 'Eingefügt wirkt fremd.', 4.15, 9.3),
    caption('01 — Problem', 'Radieren? Geht nicht.', 9.5, 14.4),
    caption('01 — Problem', 'Abschreiben? Dauert.', 14.6, 18.35),
    caption('02 — Siebwrite', 'Einmal dein Alphabet.', 19.0, 23.4),
    caption('02 — Siebwrite', 'Tippen. Deine Schrift.', 23.6, 28.3),
    caption('02 — Siebwrite', 'Echte Striche. Radierbar.', 28.45, 31.45),
  ];

  // ⌘ und V
  const keys = ['⌘', 'V'].map((label, i) => {
    const g = el('g', {}, hud);
    const base = el('rect', { x: 0, y: 10, width: 128, height: 128, rx: 22, fill: '#050506' }, g);
    const top = el('g', {}, g);
    el('rect', { x: 0, y: 0, width: 128, height: 128, rx: 22, fill: 'url(#f-key)', stroke: 'rgba(255,255,255,0.16)', 'stroke-width': 1.2 }, top);
    el('line', { x1: 18, x2: 110, y1: 1.2, y2: 1.2, stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 1 }, top);
    const txt = el('text', { x: 64, y: 84, 'text-anchor': 'middle', 'font-family': '"IBM Plex Sans", sans-serif', 'font-size': 58, 'font-weight': 500, fill: SILVER }, top);
    txt.textContent = label;
    return { g, base, top, x: 120 + i * 152, at: i ? 5.0 : 4.86 };
  });

  // Beschriftungen mit Haarlinie ins iPad
  const notes = [['Handschrift', LINE(2) - 12, 6.0], ['Tippschrift', LINE(4) - 8, 6.45]].map(([label, py, at]) => {
    const g = el('g', {}, hud);
    const ln = el('path', { fill: 'none', stroke: 'rgba(238,240,243,0.55)', 'stroke-width': 1.2, pathLength: 1, 'stroke-dasharray': '1 2' }, g);
    const dot = el('circle', { r: 3.5, fill: SILVER }, g);
    const txt = el('text', { 'text-anchor': 'end', 'font-family': '"IBM Plex Mono", monospace', 'font-size': 16, 'letter-spacing': 2.6, fill: SILVER }, g);
    txt.textContent = label.toUpperCase();
    return { g, ln, dot, txt, py, at };
  });

  // Stoppuhr
  const watch = el('g', {}, hud);
  el('rect', { x: -12, y: -134, width: 24, height: 16, rx: 4, fill: '#2a2c31', stroke: 'rgba(255,255,255,0.18)' }, watch);
  el('circle', { r: 112, fill: '#111215', stroke: 'rgba(255,255,255,0.16)', 'stroke-width': 1.5 }, watch);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, long = i % 5 === 0;
    el('line', { x1: Math.sin(a) * (long ? 88 : 95), y1: -Math.cos(a) * (long ? 88 : 95), x2: Math.sin(a) * 101, y2: -Math.cos(a) * 101, stroke: long ? 'rgba(238,240,243,0.7)' : 'rgba(238,240,243,0.25)', 'stroke-width': long ? 2 : 1 }, watch);
  }
  const sweep = el('path', { fill: 'none', stroke: 'rgba(238,240,243,0.18)', 'stroke-width': 10 }, watch);
  const hand = el('line', { x1: 0, y1: 16, x2: 0, y2: -92, stroke: SILVER, 'stroke-width': 2.5, 'stroke-linecap': 'round' }, watch);
  el('circle', { r: 6, fill: SILVER }, watch);
  const digits = el('text', { y: 205, 'text-anchor': 'middle', 'font-family': 'Newsreader, Georgia, serif', 'font-size': 64, fill: SILVER, 'font-variant-numeric': 'tabular-nums' }, watch);

  // Alphabet-Raster wie in der App
  const grid = el('g', {}, hud);
  const CELL = { w: 64, h: 60, gap: 8 };
  const cells = [...'abcdefghijklmnopqrstuvwxyzäöüß'].map((ch, i) => {
    const cx = 110 + (i % 10) * (CELL.w + CELL.gap), cy = 330 + Math.floor(i / 10) * (CELL.h + CELL.gap);
    const g = el('g', {}, grid);
    const rect = el('rect', { x: cx, y: cy, width: CELL.w, height: CELL.h, rx: 7, fill: '#131417', stroke: 'rgba(255,255,255,0.08)' }, g);
    el('line', { x1: cx + 6, x2: cx + CELL.w - 6, y1: cy + CELL.h * 0.46, y2: cy + CELL.h * 0.46, stroke: 'rgba(220,224,230,0.16)', 'stroke-dasharray': '4 3' }, g);
    el('line', { x1: cx + 6, x2: cx + CELL.w - 6, y1: cy + CELL.h * 0.7, y2: cy + CELL.h * 0.7, stroke: 'rgba(220,224,230,0.4)' }, g);
    const em = (CELL.h * 0.3) / 0.45;
    const glyph = new Hand(g, ch, { x: cx + (CELL.w - measure(ch, em)) / 2, y: cy + CELL.h * 0.7, em, color: SILVER, width: 1.8, seed: 40 + i, jitter: 0.4 });
    return { g, rect, glyph, i };
  });
  const countLabel = el('text', { x: 110, y: 572, 'font-family': '"IBM Plex Mono", monospace', 'font-size': 15, 'letter-spacing': 3, fill: MUTED }, grid);
  countLabel.textContent = 'BASIS';
  const count = el('text', { x: 110, y: 640, 'font-family': 'Newsreader, Georgia, serif', 'font-size': 64, fill: SILVER }, grid);
  const countBar = el('rect', { x: 110, y: 662, height: 3, width: 0, fill: SILVER }, grid);
  el('rect', { x: 110, y: 662, height: 3, width: 712, fill: 'rgba(255,255,255,0.08)' }, grid);

  // Textfeld
  const field = el('g', {}, hud);
  el('rect', { x: 110, y: 340, width: 690, height: 176, rx: 10, fill: '#08090a', stroke: 'rgba(255,255,255,0.1)' }, field);
  el('line', { x1: 120, x2: 790, y1: 340.6, y2: 340.6, stroke: 'rgba(255,255,255,0.05)' }, field);
  const fieldLabel = el('text', { x: 134, y: 378, 'font-family': '"IBM Plex Mono", monospace', 'font-size': 14, 'letter-spacing': 3, fill: MUTED }, field);
  fieldLabel.textContent = 'TEXT';
  const lines = SENT.map((_, i) => el('text', { x: 134, y: 432 + i * 44, 'font-family': '"IBM Plex Sans", sans-serif', 'font-size': 29, fill: SILVER }, field));
  const caret = el('rect', { width: 2, height: 32, fill: SILVER }, field);
  const flow = el('path', { fill: 'none', stroke: 'rgba(238,240,243,0.6)', 'stroke-width': 1.4, pathLength: 1, 'stroke-dasharray': '1 2' }, hud);
  const flowDot = el('circle', { r: 4, fill: SILVER }, hud);

  // Schluss: Name in Handschrift über dem Horizon Grid
  const end = el('g', {}, hud);
  const floor = el('g', { stroke: '#d6dae0', fill: 'none' }, end);
  const HZ = 650;
  const rays = [];
  for (let i = -12; i <= 12; i++) rays.push(el('line', { x1: 800, y1: HZ, x2: 800 + i * 150, y2: 900, 'stroke-width': 1, pathLength: 1, 'stroke-dasharray': '1 2' }, floor));
  const rungs = Array.from({ length: 18 }, () => el('line', { x1: 0, x2: 1600, 'stroke-width': 1 }, floor));
  const horizon = el('line', { x1: 200, x2: 1400, y1: HZ + 0.5, y2: HZ + 0.5, stroke: 'rgba(238,240,243,0.5)' }, end);
  const nameEm = 250;
  const name = new Hand(end, 'Siebwrite', { x: 800 - measure('Siebwrite', nameEm) / 2, y: 470, em: nameEm, color: SILVER, width: 4.2, seed: 9, jitter: 0.5, gap: 0.25 });
  const url = el('text', { x: 800, y: 566, 'text-anchor': 'middle', 'font-family': '"IBM Plex Mono", monospace', 'font-size': 26, 'letter-spacing': 6, fill: MUTED }, end);
  url.textContent = 'SIEBWRITE.DE';

  // Blenden
  const wipe = el('g', {}, svg);
  const trail = el('rect', { y: 0, height: 900, width: 260, fill: 'url(#f-trail)' }, wipe);
  const beam = el('rect', { y: 0, height: 900, width: 2, fill: 'url(#f-wipe)' }, wipe);
  const black = el('rect', { width: 1600, height: 900, fill: '#000' }, svg);

  // ---------- render(t) ----------
  return function render(t) {
    // Kamera aufs iPad: Auftritt, leichtes Atmen, Nähe beim Einfügen, Abgang am Ende
    const enter = ease.expo(span(t, 0.1, 1.6));
    let s = 0.955 + 0.045 * enter;
    s += 0.06 * ease.inOut(span(t, 4.0, 5.0)) - 0.06 * ease.inOut(span(t, 14.3, 15.2));
    s -= 0.035 * ease.inOut(span(t, 18.5, 19.4)) - 0.065 * ease.inOut(span(t, 24.9, 25.7));
    const dx = 1100 * ease.inExpo(span(t, 31.45, 32.4));
    const dy = 90 * (1 - enter) + Math.sin(t * 0.7) * 2.5;
    const ox = 1200, oy = 430;
    set(cam, 'transform', `translate(${(ox + dx).toFixed(2)} ${(oy + dy).toFixed(2)}) scale(${s.toFixed(4)}) translate(${-ox} ${-oy})`);
    fade(cam, enter * (1 - span(t, 31.9, 32.4)));
    const toStage = (x, y) => ({ x: (x - ox) * s + ox + dx, y: (y - oy) * s + oy + dy });

    // Werkzeug
    let ti = 0;
    while (ti + 1 < TOOLS.length && TOOLS[ti + 1][0] <= t) ti++;
    const prevTool = TOOLS[Math.max(0, ti - 1)][1];
    const hx = lerp(TOOL_X[prevTool], TOOL_X[TOOLS[ti][1]], ease.out(span(t, TOOLS[ti][0], TOOLS[ti][0] + 0.3)));
    set(toolHi, 'x', hx - 22);

    // Seite: Überschrift, Thema, Unterstrich
    let tip = null;
    const write = (h, p, live = true) => { const st = h.draw(p); if (st.active && live) tip = st; };
    const gone = 1 - ease.inOut(span(t, 18.7, 19.3)) + ease.inOut(span(t, 36.8, 37));
    for (const h of [heading, topic]) set(h.group, 'opacity', 1);
    write(heading, ease.inOut(span(t, 0.9, 2.05)));
    write(topic, ease.inOut(span(t, 2.15, 3.15)));
    set(underline, 'stroke-dashoffset', 1 - ease.inOut(span(t, 3.2, 3.55)));
    if (t > 3.2 && t < 3.55) tip = { ...toward(underline, span(t, 3.2, 3.55)), down: true, active: true };

    // Eingefügter Text: springt auf, Auswahl verschwindet, wackelt beim Radieren, geht in Teil 2
    const pop = span(t, 5.08, 5.5);
    const boxS = 0.9 + 0.1 * ease.back(pop);
    const er1 = along(t, [[9.75, 1480, 300], [10.2, PX - 4, LINE(4) - 8], [11.0, PX + 380, LINE(4) - 8], [11.15, PX + 380, LINE(5) - 8], [11.9, PX + 40, LINE(5) - 8], [12.45, 1480, 560]]);
    const touching = t > 10.15 && t < 11.95 ? 1 : 0;
    const shake = touching * Math.sin(t * 70) * 4;
    set(box, 'transform', `translate(${(boxCx + shake).toFixed(2)} ${boxCy}) scale(${boxS.toFixed(4)}) translate(${-boxCx} ${-boxCy})`);
    fade(box, ease.out(pop) * gone);
    fade(sel, 1 - ease.inOut(span(t, 6.0, 6.4)));

    write(copy, 0.62 * ease.inOut(span(t, 15.1, 18.2)), t < 18.25);
    set(copy.group, 'opacity', gone);

    // Teil 2: Ergebnis schreiben, „Kraftwerke“ radieren, „Energiequellen“ schreiben
    const er2 = along(t, [[28.55, 1480, 300], [28.85, kraft.x0 - 6, LINE(4) - 10], [29.45, kraft.x1 + 10, LINE(4) - 10], [29.75, 1480, 280]]);
    for (const g of kraft.glyphs) g.alpha = 1 - clamp((t > 28.8 && t < 36.9 ? er2.x - g.cx + 10 : -1) / 16);
    if (t > 29.5 && t < 36.9) for (const g of kraft.glyphs) g.alpha = 0;
    write(result, ease.inOut(span(t, 25.45, 27.95)));
    write(fix, ease.inOut(span(t, 29.75, 30.95)));
    set(result.group, 'opacity', 1 - span(t, 36.6, 37));
    set(fix.group, 'opacity', 1 - span(t, 36.6, 37));
    fade(dim, 0.62 * (ease.inOut(span(t, 18.6, 19.3)) - ease.inOut(span(t, 24.9, 25.5))));

    // Stift folgt der Spitze, hebt zwischen den Strichen leicht ab
    if (tip) {
      const lift = tip.down ? 0 : 7;
      move(pen, tip.x, tip.y - lift, 1, 148);
      move(penShadow, -8 - lift, -10 - lift);
      fade(pen, 1);
    } else fade(pen, 0);

    // Radierer
    const er = t < 20 ? er1 : er2;
    const erOn = t < 20 ? shown(t, 9.75, 12.45, 0.2, 0.2) : shown(t, 28.55, 29.75, 0.2, 0.2);
    move(eraser, er.x, er.y);
    move(eraserBody, 0, 0, 1.3, 28);
    fade(eraser, erOn);
    move(nope, er.x - 36, er.y - 46, 0.9 + 0.25 * Math.abs(Math.sin(t * 9)));
    fade(nope, touching);

    // Vordergrund
    captions.forEach((c) => c(t));

    keys.forEach((k, i) => {
      const inP = ease.back(span(t, 4.3 + i * 0.08, 4.95 + i * 0.08));
      const outP = ease.inOut(span(t, 8.9, 9.25));
      const d = press(t, k.at) * 8;
      move(k.g, k.x, 470 + (1 - inP) * 40 + outP * 20);
      fade(k.g, clamp(inP) * (1 - outP));
      move(k.top, 0, d);
      set(k.base, 'y', 10 - d * 0.8);
    });

    notes.forEach((n) => {
      const p = ease.inOut(span(t, n.at, n.at + 0.5));
      const o = 1 - ease.inOut(span(t, 8.9, 9.3));
      const target = toStage(PX - 8, n.py);
      const sx = 860, sy = target.y;
      set(n.ln, 'd', `M${sx} ${sy.toFixed(1)} L${target.x.toFixed(1)} ${target.y.toFixed(1)}`);
      set(n.ln, 'stroke-dashoffset', 1 - p);
      move(n.dot, target.x, target.y, ease.back(span(t, n.at + 0.4, n.at + 0.7)));
      move(n.txt, sx - 14, sy + 5);
      set(n.txt, 'opacity', ease.out(span(t, n.at + 0.25, n.at + 0.7)));
      fade(n.g, t > n.at && t < 9.3 ? o : 0);
    });

    const wIn = ease.back(span(t, 14.75, 15.35));
    move(watch, 300, 520 + (1 - wIn) * 30, 0.92 + 0.08 * clamp(wIn));
    fade(watch, clamp(wIn) * (1 - ease.inOut(span(t, 18.0, 18.35))));
    const secs = Math.floor(462 * ease.inOut(span(t, 15.1, 18.2)));
    const ang = (secs % 60) * 6;
    set(hand, 'transform', `rotate(${ang})`);
    const a1 = (ang * Math.PI) / 180;
    set(sweep, 'd', secs ? `M0 -78 A78 78 0 ${ang > 180 ? 1 : 0} 1 ${(Math.sin(a1) * 78).toFixed(1)} ${(-Math.cos(a1) * 78).toFixed(1)}` : '');
    set(digits, 'data-s', secs);
    if (digits.textContent !== fmt(secs)) digits.textContent = fmt(secs);

    const gOut = ease.inOut(span(t, 23.2, 23.6));
    fade(grid, shown(t, 19.0, 23.6, 0.3, 0.4));
    move(grid, 0, -gOut * 16);
    for (const c of cells) {
      const ap = ease.out(span(t, 19.05 + c.i * 0.022, 19.45 + c.i * 0.022));
      move(c.g, 0, (1 - ap) * 14);
      set(c.g, 'opacity', ap);
      const wp = span(t, 19.45 + c.i * 0.105, 19.9 + c.i * 0.105);
      c.glyph.draw(wp);
      set(c.rect, 'stroke', wp >= 1 ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.08)');
    }
    const n87 = Math.round(87 * ease.inOut(span(t, 19.45, 22.95)));
    const ct = `${n87}/87`;
    if (count.textContent !== ct) count.textContent = ct;
    set(countBar, 'width', (712 * n87) / 87);

    const fIn = ease.expo(span(t, 23.55, 24.3));
    fade(field, fIn * (1 - ease.inOut(span(t, 27.9, 28.3))));
    move(field, 0, (1 - fIn) * 24);
    const typedN = Math.floor((SENT[0].length + SENT[1].length) * span(t, 23.85, 25.0));
    const l0 = SENT[0].slice(0, typedN), l1 = SENT[1].slice(0, Math.max(0, typedN - SENT[0].length));
    if (lines[0].textContent !== l0) lines[0].textContent = l0;
    if (lines[1].textContent !== l1) lines[1].textContent = l1;
    const onSecond = typedN > SENT[0].length;
    const caretLine = lines[onSecond ? 1 : 0];
    const caretX = 134 + (caretLine.textContent ? caretLine.getComputedTextLength() : 0) + 3;
    set(caret, 'x', caretX);
    set(caret, 'y', (onSecond ? 476 : 432) - 25);
    set(caret, 'opacity', t < 25.0 || Math.floor(t * 2.4) % 2 ? 1 : 0);

    const from = { x: 800, y: 428 }, to = toStage(PX - 10, LINE(4) - 10);
    set(flow, 'd', `M${from.x} ${from.y} C${from.x + 70} ${from.y} ${to.x - 80} ${to.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`);
    const fl = ease.inOut(span(t, 25.05, 25.5));
    set(flow, 'stroke-dashoffset', 1 - fl);
    fade(flow, shown(t, 25.0, 26.7, 0.1, 0.5));
    const dotAt = flow.getTotalLength ? fl : 0;
    if (dotAt > 0 && dotAt < 1) {
      const pt = flow.getPointAtLength(flow.getTotalLength() * dotAt);
      move(flowDot, pt.x, pt.y);
      fade(flowDot, 1);
    } else fade(flowDot, 0);

    // Schluss
    const endOn = shown(t, 31.9, 37, 0.4, 0.01);
    fade(end, endOn);
    const rayP = ease.out(span(t, 32.0, 33.1));
    rays.forEach((r, i) => { set(r, 'stroke-dashoffset', 1 - rayP); set(r, 'opacity', 0.22 * (1 - Math.abs(i - 12) / 14)); });
    const phase = (t * 0.3) % 1;
    rungs.forEach((r, k) => {
      const z = k + 1 - phase;
      const y = HZ + (900 - HZ) / z;
      const near = (y - HZ) / (900 - HZ);
      set(r, 'y1', y); set(r, 'y2', y);
      set(r, 'opacity', 0.26 * near * near * span(t, 32.4, 33.2));
    });
    set(horizon, 'opacity', 0.6 * ease.out(span(t, 32.0, 32.8)));
    name.draw(ease.inOut(span(t, 32.25, 34.0)));
    const uP = ease.expo(span(t, 34.0, 34.8));
    set(url, 'opacity', uP);
    move(url, 0, (1 - uP) * 14);

    // Blenden: silberne Linie wischt in Teil 2 und zum Schluss
    const wp = Math.max(span(t, 18.35, 19.15), 0) && t < 19.2 ? span(t, 18.35, 19.15) : span(t, 31.45, 32.25);
    const wOn = (t > 18.35 && t < 19.15) || (t > 31.45 && t < 32.25);
    const wx = lerp(-40, 1640, ease.inOut(wp));
    set(beam, 'x', wx);
    set(trail, 'x', wx - 260);
    fade(wipe, wOn ? Math.sin(Math.PI * wp) : 0);

    fade(black, 1 - ease.out(span(t, 0, 0.7)) + ease.inOut(span(t, 36.3, 37)));
  };
}

// Punkt auf dem Unterstrich (pathLength 1)
function toward(path, p) {
  const len = path.getTotalLength();
  const pt = path.getPointAtLength(len * p);
  return { x: pt.x, y: pt.y };
}

const fmt = (secs) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

// ---------- Player ----------

export async function film(root) {
  await document.fonts.ready;
  const svg = root.querySelector('.stage-svg');
  const render = build(svg);
  const grain = root.querySelector('.grain');
  const bigPlay = root.querySelector('.big-play');
  const btn = root.querySelector('.ctl-play');
  const track = root.querySelector('.ctl-track');
  const fill = root.querySelector('.ctl-fill');
  const time = root.querySelector('.ctl-time');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let t = still ? POSTER : 0;
  let playing = false;
  let userPaused = still;
  let visible = false;
  let last = 0;
  let raf = 0;
  let frame = 0;

  const label = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function paint() {
    render(t);
    const p = t / DURATION;
    fill.style.transform = `scaleX(${p})`;
    track.style.setProperty('--p', p);
    track.setAttribute('aria-valuenow', Math.round(t));
    track.setAttribute('aria-valuetext', label(t));
    time.textContent = label(t);
    root.classList.toggle('is-playing', playing);
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
    bigPlay.hidden = playing || (t > 0.05 && !still && !userPaused);
    if (playing && ++frame % 2 === 0) grain.style.backgroundPosition = `${(Math.random() * 160) | 0}px ${(Math.random() * 160) | 0}px`;
  }

  function tick(now) {
    t += Math.min(now - last, 100) / 1000;
    last = now;
    if (t >= DURATION) t -= DURATION;
    paint();
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    playing = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
    paint();
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    paint();
  }
  function seek(s) {
    t = clamp(s, 0, DURATION - 0.001);
    paint();
  }
  const toggle = () => { if (playing) { userPaused = true; pause(); } else { userPaused = false; play(); } };

  btn.addEventListener('click', toggle);
  bigPlay.addEventListener('click', () => { userPaused = false; play(); });
  root.querySelector('.stage').addEventListener('click', (e) => { if (!e.target.closest('.big-play')) toggle(); });

  const fromPointer = (e) => {
    const r = track.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * DURATION);
  };
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture?.(e.pointerId);
    fromPointer(e);
    const moveH = (ev) => fromPointer(ev);
    const up = () => { track.removeEventListener('pointermove', moveH); track.removeEventListener('pointerup', up); };
    track.addEventListener('pointermove', moveH);
    track.addEventListener('pointerup', up);
  });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { seek(t + 3); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { seek(t - 3); e.preventDefault(); }
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'k') && !e.target.closest('button')) { toggle(); e.preventDefault(); }
  });
  for (const b of root.querySelectorAll('[data-chapter]')) b.addEventListener('click', () => { seek(Number(b.dataset.chapter)); if (!playing) { userPaused = false; play(); } });

  // Läuft nur, solange er zu sehen ist; wer selbst pausiert, behält die Pause
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !userPaused && !document.hidden) play();
    else if (!visible) pause();
  }, { threshold: 0.35 }).observe(root);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (visible && !userPaused) play();
  });

  paint();
  root.classList.add('is-ready');
  const api = { play, pause, seek, get time() { return t; } };
  root.film = api;
  return api;
}
