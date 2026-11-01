// "Radier ruhig": Links eingefügter Text (lässt sich nicht radieren), rechts dieselben
// Zeilen in Handschrift. Wer mit Maus oder Finger darüberwischt, radiert ganze Striche
// weg wie der Strich-Radierer in GoodNotes. Auf dem Handy waagerecht wischen, senkrecht scrollt.

import { Hand } from './film.js';

const NS = 'http://www.w3.org/2000/svg';
const LINES = ['Zellatmung:', 'Glucose + Sauerstoff', 'wird zu Energie.'];
const W = 620;
const H = 400;
const FIRST = 124; // erste Grundlinie
const GAP = 72;
const LEFT = 76;
const R = 26; // Radius des Radierers in SVG-Einheiten

const el = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
};

// Liniertes Blatt mit rotem Rand, Grundlinien genau unter den Zeilen
function paper(svg) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  el('rect', { width: W, height: H, rx: 8, fill: 'var(--paper)' }, svg);
  for (let y = FIRST; y < H; y += GAP) el('line', { x1: 0, x2: W, y1: y, y2: y, stroke: 'var(--rule)', 'stroke-width': 1.3 }, svg);
  el('line', { x1: 52, x2: 52, y1: 0, y2: H, stroke: 'var(--margin)', 'stroke-width': 1.5 }, svg);
}

export function eraser(root) {
  const typed = root.querySelector('.erase-typed');
  const svg = root.querySelector('.erase-hand');
  const restore = root.querySelector('.erase-restore');
  const status = root.querySelector('.erase-status');

  // Links: so sieht eingefügter Text aus
  paper(typed);
  LINES.forEach((line, i) => {
    el('text', { x: LEFT, y: FIRST + i * GAP - 6, fill: '#1b1d22', 'font-family': 'Arial, Helvetica, sans-serif', 'font-size': 31 }, typed).textContent = line;
  });

  // Rechts: dieselben Zeilen in Handschrift
  paper(svg);
  const ink = el('g', {}, svg);
  const rubber = el('g', { class: 'erase-rubber', visibility: 'hidden' }, svg);
  el('rect', { x: -R, y: -R * 0.62, width: R * 2, height: R * 1.24, rx: 7, fill: '#f2b8b0' }, rubber);
  el('rect', { x: -R, y: -R * 0.62, width: R * 0.75, height: R * 1.24, rx: 7, fill: '#3b56b8' }, rubber);

  let hand = null;
  let gone = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function write(animated) {
    ink.replaceChildren();
    gone = 0;
    restore.hidden = true;
    status.textContent = 'Wisch über die Handschrift.';
    hand = new Hand(ink, LINES.join('\n'), { x: LEFT, y: FIRST, em: 64, color: '#1e3a9b', width: 2.9, lineGap: GAP, seed: 4, jitter: 0.9, gap: 0.3 });
    if (still || !animated) { hand.draw(animated ? 1 : 0); return; }
    const start = performance.now();
    const ms = Math.min(4200, hand.total / 2.4);
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      hand.draw(p);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const toSvg = (e) => {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };

  // Ganze Striche, die der Radierer berührt, verschwinden
  function rub(x, y) {
    for (const path of hand?.paths ?? []) {
      if (path.erased) continue;
      const { pts } = path;
      for (let i = 0; i < pts.length; i += 2) {
        if ((pts[i] - x) ** 2 + (pts[i + 1] - y) ** 2 < R * R) {
          path.erased = true;
          path.node.classList.add('erased');
          gone++;
          break;
        }
      }
    }
    if (gone) {
      restore.hidden = false;
      status.textContent = gone >= hand.paths.length ? 'Alles weg. Genau wie in GoodNotes.' : `${gone} ${gone === 1 ? 'Strich' : 'Striche'} wegradiert.`;
    }
  }

  let down = false;
  svg.addEventListener('pointerdown', (e) => {
    down = true;
    const p = toSvg(e);
    rub(p.x, p.y);
  });
  svg.addEventListener('pointermove', (e) => {
    const p = toSvg(e);
    rubber.setAttribute('visibility', 'visible');
    rubber.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(-18)`);
    // Maus radiert schon beim Drüberfahren, Finger und Stift nur beim Wischen
    if (down || e.pointerType === 'mouse') rub(p.x, p.y);
  });
  const up = () => { down = false; };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('pointerleave', () => { up(); rubber.setAttribute('visibility', 'hidden'); });

  // Eingefügter Text: nichts passiert, nur ein kurzes Rütteln
  let nope = 0;
  const shake = () => {
    if (typed.classList.contains('nope')) return;
    typed.classList.add('nope');
    clearTimeout(nope);
    nope = setTimeout(() => typed.classList.remove('nope'), 1400);
  };
  typed.addEventListener('pointerdown', shake);
  typed.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) shake(); });

  restore.addEventListener('click', () => write(true));

  write(false);
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    write(true);
  }, { threshold: 0.4 });
  io.observe(svg);
}
