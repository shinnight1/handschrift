// "Jeder Buchstabe ein Regler": der Schriftzug Siebwrite in Handschrift, jeder Buchstabe
// ein Spielzeug für eine Einstellung der App (Varianten, Schwankung, Papier, Strichstärke,
// Radieren, Größe, Tinte, eigene Schrift). Klicken, ziehen, wischen. Angeregt von der
// Startseite von Ink & Switch, wo jeder Buchstabe des Namens eine eigene Zeichnung ist.

import { GLYPHS } from './hand-font.js';

const NS = 'http://www.w3.org/2000/svg';
const SCALE = 1.25;
const VB = { x: -400, y: -1000, w: 800, h: 1150 };
const XLINE = -440 * SCALE; // x-Höhe der Vorlage
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const de = (v, digits) => v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Wie src/render.js, als CSS-Farbe
const INKS = [
  ['Kuli-Blau', 'rgb(20, 51, 148)'],
  ['Tinte', 'rgb(13, 31, 97)'],
  ['Schwarz', 'rgb(26, 26, 31)'],
  ['Bleistift', 'rgb(84, 84, 92)'],
];

const el = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Striche eines Zeichens in Kachel-Einheiten, waagerecht mittig, Grundlinie bei y = 0.
// jitter verbiegt jeden Strich ein wenig wie bei einer neuen Variante, size skaliert ab Grundlinie.
function strokes(ch, { seed = 1, jitter = 0, size = 1 } = {}) {
  const [adv, list] = GLYPHS[ch];
  const r = rng(seed);
  const k = SCALE * size;
  return list.map((st) => {
    const rot = (r() - 0.5) * 0.14 * jitter;
    const sc = 1 + (r() - 0.5) * 0.12 * jitter;
    const ph = r() * 6.28;
    const amp = 10 * jitter;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const pts = [];
    for (let i = 0; i < st.length; i += 2) {
      const x = (st[i] - adv / 2) * sc + Math.sin(i * 0.7 + ph) * amp;
      const y = st[i + 1] * sc + Math.cos(i * 0.9 + ph) * amp;
      pts.push([(x * cos - y * sin) * k, (x * sin + y * cos) * k]);
    }
    return pts;
  });
}

const pathD = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + (pts.length === 1 ? 'l0.1 0' : '');

function draw(g, list) {
  g.replaceChildren();
  return list.map((pts) => el('path', { d: pathD(pts) }, g));
}

// Schreibt die Striche nacheinander neu (Strichlänge als Fortschritt)
function write(paths, ms = 650) {
  if (still || !paths.length) return;
  const lens = paths.map((p) => Math.max(1, p.getTotalLength()));
  const total = lens.reduce((a, b) => a + b, 0);
  paths.forEach((p, i) => { p.style.strokeDasharray = `${lens[i]} ${lens[i] + 1}`; p.style.strokeDashoffset = lens[i]; });
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms) * total;
    let acc = 0;
    paths.forEach((p, i) => { p.style.strokeDashoffset = lens[i] * (1 - Math.min(1, Math.max(0, (t - acc) / lens[i]))); acc += lens[i]; });
    if (t < total) requestAnimationFrame(tick);
    else paths.forEach((p) => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; });
  };
  requestAnimationFrame(tick);
}

function toSvg(svg, e) {
  const p = svg.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
const frac = (x, lo, hi) => Math.min(1, Math.max(0, (x - lo) / (hi - lo)));

// Eine Kachel: Buchstabe, Name der Einstellung, Wert
function tile(grid, { ch, name, value, paper = false, touch = 'pan-y', hint }) {
  const fig = document.createElement('figure');
  fig.className = paper ? 'toy toy-paper' : 'toy';
  const svg = el('svg', { viewBox: `${VB.x} ${VB.y} ${VB.w} ${VB.h}`, role: 'img', 'aria-label': `${ch}: ${name}. ${hint}` }, fig);
  svg.style.touchAction = touch;
  const back = el('g', { class: 'toy-back' }, svg);
  const g = el('g', { class: 'toy-ink', fill: 'none', stroke: 'currentColor', 'stroke-width': 30, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
  const cap = document.createElement('figcaption');
  const label = document.createElement('span');
  const out = document.createElement('b');
  label.textContent = name;
  out.textContent = value;
  cap.append(label, out);
  fig.append(cap);
  fig.title = hint;
  grid.append(fig);
  return { svg, back, g, label, out };
}

// Klick oder Enter/Leertaste
function onTap(svg, fn) {
  svg.tabIndex = 0;
  svg.addEventListener('click', fn);
  svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
}

// Ziehen: fn(x, y) in Kachel-Einheiten, solange gedrückt
function onDrag(svg, fn, { start, end } = {}) {
  let id = null;
  svg.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    try { svg.setPointerCapture(id); } catch { /* egal */ }
    const p = toSvg(svg, e);
    start?.(p.x, p.y);
    fn(p.x, p.y);
  });
  svg.addEventListener('pointermove', (e) => { if (e.pointerId === id) { const p = toSvg(svg, e); fn(p.x, p.y); } });
  const stop = (e) => { if (e.pointerId === id) { id = null; end?.(); } };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
}

/** Baut die neun Kacheln in grid. onGlyph(ch, glyph): selbst geschriebenes e für das Blatt im Hero. */
export function playground(grid, { onGlyph } = {}) {
  // S: jede Variante anders
  {
    const t = tile(grid, { ch: 'S', name: 'Varianten', value: '#1', hint: 'Klicken: neue Variante' });
    let seed = 1;
    draw(t.g, strokes('S', { seed, jitter: 1 }));
    onTap(t.svg, () => {
      seed++;
      write(draw(t.g, strokes('S', { seed, jitter: 1.6 })), 520);
      t.out.textContent = `#${seed}`;
    });
  }

  // i: den Punkt wegziehen, er federt zurück
  {
    const t = tile(grid, { ch: 'i', name: 'i-Punkt', value: '0', touch: 'none', hint: 'Den Punkt wegziehen' });
    const [stem, dot] = strokes('i', { jitter: 0.3, seed: 2 });
    el('path', { d: pathD(stem) }, t.g);
    const dg = el('g', {}, t.g);
    el('path', { d: pathD(dot) }, dg);
    const home = dot.reduce((a, [x, y]) => [a[0] + x / dot.length, a[1] + y / dot.length], [0, 0]);
    let off = [0, 0];
    let flicks = 0;
    let raf = 0;
    const place = () => dg.setAttribute('transform', `translate(${off[0].toFixed(1)} ${off[1].toFixed(1)})`);
    onDrag(t.svg, (x, y) => { off = [x - home[0], y - home[1]]; place(); }, {
      start: () => cancelAnimationFrame(raf),
      end: () => {
        t.out.textContent = String(++flicks);
        const from = [...off];
        const begin = performance.now();
        const spring = (now) => {
          const s = (now - begin) / 1000;
          const f = Math.exp(-s * 5) * Math.cos(s * 16);
          off = [from[0] * f, from[1] * f];
          place();
          if (s < 1.4 && !still) raf = requestAnimationFrame(spring);
          else { off = [0, 0]; place(); }
        };
        raf = requestAnimationFrame(spring);
      },
    });
  }

  // e: Schwankung aufziehen
  {
    const t = tile(grid, { ch: 'e', name: 'Schwankung', value: '25 %', hint: 'Waagerecht ziehen: mehr oder weniger Schwankung' });
    t.svg.style.cursor = 'ew-resize';
    const set = (n) => { draw(t.g, strokes('e', { seed: 5, jitter: n * 3 })); t.out.textContent = `${Math.round(n * 100)} %`; };
    set(0.25);
    onDrag(t.svg, (x) => set(frac(x, VB.x + 80, VB.x + VB.w - 80)));
  }

  // b: Papier wechseln
  {
    const papers = ['Liniert', 'Kariert', 'Leer'];
    const t = tile(grid, { ch: 'b', name: 'Papier', value: papers[0], paper: true, hint: 'Klicken: anderes Papier' });
    let i = 0;
    const paper = () => {
      t.back.replaceChildren();
      const line = (x1, y1, x2, y2) => el('line', { x1, y1, x2, y2, stroke: 'var(--rule)', 'stroke-width': 6 }, t.back);
      if (papers[i] === 'Liniert') for (let y = 0; y > VB.y; y -= 600) line(VB.x, y, VB.x + VB.w, y);
      if (papers[i] === 'Kariert') {
        for (let y = 150 - 150 * 8; y < VB.y + VB.h; y += 150) line(VB.x, y, VB.x + VB.w, y);
        for (let x = -375; x < VB.x + VB.w; x += 150) line(x, VB.y, x, VB.y + VB.h);
      }
      t.out.textContent = papers[i];
    };
    paper();
    draw(t.g, strokes('b', { seed: 3, jitter: 0.4 }));
    onTap(t.svg, () => { i = (i + 1) % papers.length; paper(); });
  }

  // w: Strichstärke
  {
    const t = tile(grid, { ch: 'w', name: 'Strich', value: '0,35 mm', hint: 'Waagerecht ziehen: dünner oder dicker' });
    t.svg.style.cursor = 'ew-resize';
    draw(t.g, strokes('w', { seed: 4, jitter: 0.4 }));
    const set = (mm) => { t.g.setAttribute('stroke-width', (mm * 90).toFixed(1)); t.out.textContent = `${de(mm, 2)} mm`; };
    set(0.35);
    onDrag(t.svg, (x) => set(0.15 + 0.75 * frac(x, VB.x + 80, VB.x + VB.w - 80)));
  }

  // r: wegradieren, kommt nach einer Pause zurück
  {
    const t = tile(grid, { ch: 'r', name: 'Radierbar', value: '0 weg', hint: 'Drüberwischen: radieren' });
    t.svg.style.cursor = 'cell';
    const segs = [];
    for (const pts of strokes('r', { seed: 6, jitter: 0.4 })) {
      for (let k = 1; k < pts.length; k++) {
        segs.push({ node: el('path', { d: pathD([pts[k - 1], pts[k]]) }, t.g), a: pts[k - 1], b: pts[k], gone: false });
      }
    }
    let back = 0;
    const rub = (x, y) => {
      let n = 0;
      for (const s of segs) {
        if (!s.gone && [s.a, s.b, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]].some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 90 ** 2)) {
          s.gone = true;
          s.node.classList.add('erased');
        }
        if (s.gone) n++;
      }
      t.out.textContent = `${n} weg`;
      clearTimeout(back);
      back = setTimeout(() => { for (const s of segs) { s.gone = false; s.node.classList.remove('erased'); } t.out.textContent = '0 weg'; }, 1800);
    };
    onDrag(t.svg, rub);
    t.svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) { const p = toSvg(t.svg, e); rub(p.x, p.y); } });
  }

  // i: Größe
  {
    const t = tile(grid, { ch: 'i', name: 'Größe', value: '3,2 mm', touch: 'none', hint: 'Senkrecht ziehen: größer oder kleiner' });
    t.svg.style.cursor = 'ns-resize';
    const set = (mm) => { draw(t.g, strokes('i', { seed: 7, jitter: 0.3, size: mm / 3.2 })); t.out.textContent = `${de(mm, 1)} mm`; };
    set(3.2);
    onDrag(t.svg, (x, y) => set(2 + 4 * (1 - frac(y, VB.y + 60, -40))));
  }

  // t: Tinte
  {
    const t = tile(grid, { ch: 't', name: 'Tinte', value: INKS[0][0], paper: true, hint: 'Klicken: andere Farbe' });
    let i = 0;
    const set = (animate) => {
      t.g.setAttribute('stroke', INKS[i][1]);
      const paths = draw(t.g, strokes('t', { seed: 8, jitter: 0.4 }));
      if (animate) write(paths, 450);
      t.out.textContent = INKS[i][0];
    };
    set(false);
    onTap(t.svg, () => { i = (i + 1) % INKS.length; set(true); });
  }

  // e: selbst schreiben, landet auch auf dem Blatt oben
  {
    const t = tile(grid, { ch: 'e', name: 'Deins', value: 'schreib', touch: 'none', hint: 'Selbst ein e schreiben' });
    t.svg.style.cursor = 'crosshair';
    el('line', { x1: VB.x, x2: VB.x + VB.w, y1: 0, y2: 0, stroke: 'currentColor', 'stroke-width': 5, opacity: 0.35 }, t.back);
    el('line', { x1: VB.x, x2: VB.x + VB.w, y1: XLINE, y2: XLINE, stroke: 'currentColor', 'stroke-width': 4, opacity: 0.22, 'stroke-dasharray': '40 30' }, t.back);
    const ghost = el('g', { opacity: 0.18 }, t.g);
    for (const pts of strokes('e', { seed: 9 })) el('path', { d: pathD(pts) }, ghost);
    const mine = el('g', {}, t.g);
    let lines = [];
    let cur = null;
    let timer = 0;
    onDrag(t.svg, (x, y) => {
      cur.push([x, y]);
      cur.node.setAttribute('d', pathD(cur));
    }, {
      start: () => {
        clearTimeout(timer);
        if (!lines.length) mine.replaceChildren();
        ghost.setAttribute('opacity', 0);
        cur = [];
        cur.node = el('path', {}, mine);
      },
      end: () => {
        if (cur.length) lines.push(cur);
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!lines.length) return;
          // Als Zeichen der Vorlage: Font-Einheiten, linker Rand bei 30
          const minX = Math.min(...lines.flat().map(([x]) => x));
          const maxX = Math.max(...lines.flat().map(([x]) => x));
          const glyph = [Math.round((maxX - minX) / SCALE + 90), lines.map((s) => s.flatMap(([x, y]) => [Math.round((x - minX) / SCALE + 30), Math.round(y / SCALE)]))];
          onGlyph?.('e', glyph);
          t.out.textContent = 'dein e';
          lines = [];
        }, 900);
      },
    });
  }
}
