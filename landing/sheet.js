// Blatt im Hero: Was man tippt, schreibt ein Füller sofort von Hand aufs Papier.
// Solange niemand tippt, schreibt es Beispiele. Ein selbst geschriebenes Zeichen
// (Notizzettel, note.js) ersetzt das der Vorlage.

import { Hand, measure } from './film.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 700;
const LEFT = 150; // rechts vom roten Rand
const RIGHT = 940;
const FIRST = 178; // erste Grundlinie
const GAP = 58; // Zeilenabstand
const LINES = 9;
const EM = 74;
const SPEED = 1700; // Einheiten pro Sekunde
const INK = '#1e3a9b';

const EXAMPLES = [
  'Bio: Die Mitochondrien sind die Kraftwerke der Zelle.',
  'Liebe Oma, danke für das Paket! Die Plätzchen waren am ersten Abend weg.',
  'Vokabeln: la mer = das Meer, le ciel = der Himmel',
];

// Zeichen, die die Vorlage nicht hat, auf ähnliche abbilden
const plain = (text) => text
  .replace(/ß/g, 'ss').replace(/[„“”«»]/g, '"').replace(/[‚‘’´`]/g, "'").replace(/[–—]/g, '-')
  .replace(/…/g, '...').replace(/\s+/g, ' ');

const el = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
};

// Zeilenumbruch nach Wörtern; zu viele Zeilen werden abgeschnitten.
function wrap(text, glyphs) {
  const lines = [];
  let line = '';
  for (const word of plain(text).trim().split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, EM, glyphs) > RIGHT - LEFT) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, LINES).join('\n');
}

function paper(svg) {
  el('rect', { width: W, height: H, rx: 10, fill: 'var(--paper)' }, svg);
  el('rect', { width: W, height: H, rx: 10, fill: 'url(#sheet-light)' }, svg);
  for (let k = 0; k < LINES + 1; k++) el('line', { x1: 0, x2: W, y1: FIRST + k * GAP, y2: FIRST + k * GAP, stroke: 'var(--rule)', 'stroke-width': 1.4 }, svg);
  el('line', { x1: 118, x2: 118, y1: 0, y2: H, stroke: 'var(--margin)', 'stroke-width': 1.6 }, svg);
  for (const y of [150, 350, 550]) el('circle', { cx: 52, cy: y, r: 15, fill: 'var(--night)' }, svg);
}

// Füller, Spitze bei (0, 0)
function pen(svg) {
  const g = el('g', { class: 'sheet-pen', visibility: 'hidden' }, svg);
  const tilt = el('g', { transform: 'rotate(32)' }, g);
  el('ellipse', { cx: 30, cy: -6, rx: 26, ry: 7, fill: '#000', opacity: 0.12, transform: 'rotate(-32)' }, tilt);
  el('path', { d: 'M0 0 L-7 -30 Q-8 -40 -6 -46 L6 -46 Q8 -40 7 -30 Z', fill: 'url(#sheet-nib)' }, tilt);
  el('path', { d: 'M0 -2 L0 -30', stroke: '#2b2f38', 'stroke-width': 1.2 }, tilt);
  el('circle', { cx: 0, cy: -31, r: 2, fill: '#2b2f38' }, tilt);
  el('rect', { x: -9, y: -84, width: 18, height: 40, rx: 4, fill: '#12193a' }, tilt);
  el('rect', { x: -11, y: -250, width: 22, height: 170, rx: 9, fill: 'url(#sheet-barrel)' }, tilt);
  el('rect', { x: -11, y: -132, width: 22, height: 6, fill: '#c9b48a' }, tilt);
  return g;
}

export function sheet(root, input) {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sheet-svg', role: 'img', 'aria-label': 'Blatt Papier, auf dem der getippte Text in Handschrift erscheint' }, root);
  svg.innerHTML = `<defs>
    <radialGradient id="sheet-light" cx="0.15" cy="0" r="1.1"><stop offset="0" stop-color="#fffaf0" stop-opacity="0.7"/><stop offset="1" stop-color="#d8cdb6" stop-opacity="0.25"/></radialGradient>
    <linearGradient id="sheet-nib" x1="0" x2="1"><stop offset="0" stop-color="#9aa0aa"/><stop offset="0.5" stop-color="#eef0f3"/><stop offset="1" stop-color="#a3a9b3"/></linearGradient>
    <linearGradient id="sheet-barrel" x1="0" x2="1"><stop offset="0" stop-color="#0e1530"/><stop offset="0.35" stop-color="#2a3a7a"/><stop offset="1" stop-color="#0b1026"/></linearGradient>
  </defs>`;
  paper(svg);
  const ink = el('g', {}, svg);
  const nib = pen(svg);

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glyphs = {};
  let hand = null;
  let shown = '';
  let raf = 0;
  let auto = true;
  let example = 0;
  let timer = 0;

  // Neues Blatt für text, noch ohne Tinte
  function build(text) {
    cancelAnimationFrame(raf);
    ink.replaceChildren();
    nib.setAttribute('visibility', 'hidden');
    shown = wrap(text, glyphs);
    hand = shown.replace(/\s/g, '')
      ? new Hand(ink, shown, { x: LEFT, y: FIRST, em: EM, color: INK, width: 3.1, lineGap: GAP, seed: 11, jitter: 0.9, gap: 0.35, glyphs })
      : null;
  }

  // Schreibt ab dem Anteil from bis zum Ende, der Füller folgt der Spitze
  function animate(from = 0, done) {
    if (!hand || still) { hand?.draw(1); done?.(); return; }
    const start = performance.now();
    const length = hand.total * (1 - from);
    const ms = Math.min(6500, (length / SPEED) * 1000);
    const tick = (now) => {
      const p = ms ? Math.min(1, (now - start) / ms) : 1;
      const at = hand.draw(from + (1 - from) * p);
      if (p < 1) {
        nib.setAttribute('visibility', 'visible');
        nib.setAttribute('transform', `translate(${at.x.toFixed(1)} ${(at.y - (at.down ? 0 : 6)).toFixed(1)})`);
        raf = requestAnimationFrame(tick);
      } else {
        nib.setAttribute('visibility', 'hidden');
        done?.();
      }
    };
    raf = requestAnimationFrame(tick);
  }

  // Anteil der Gesamtlänge, den die ersten n Zeichen (ohne Leerzeichen) ausmachen
  function share(n) {
    if (!hand || !n) return 0;
    let acc = 0;
    for (const [i, p] of hand.paths.entries()) {
      if (hand.glyphs.indexOf(p.glyph) >= n) break;
      acc += p.len + (i ? hand.gap : 0);
    }
    return Math.min(1, acc / hand.total);
  }

  // Beispiele, solange niemand tippt
  function playExample() {
    if (!auto) return;
    build(EXAMPLES[example]);
    animate(0, () => {
      if (!auto) return;
      example = (example + 1) % EXAMPLES.length;
      timer = setTimeout(playExample, 2600);
    });
  }

  let typed = 0;
  input.addEventListener('input', () => {
    auto = false;
    clearTimeout(timer);
    clearTimeout(typed);
    typed = setTimeout(() => {
      // Nur angehängt: nur das Neue schreiben, der Rest steht schon da
      const before = shown;
      build(input.value);
      const kept = shown.startsWith(before) ? before.replace(/\s/g, '').length : 0;
      animate(share(kept));
    }, 140);
  });

  // Start, sobald das Blatt zu sehen ist
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    timer = setTimeout(playExample, 500);
  }, { threshold: 0.3 });
  io.observe(svg);

  return {
    // Selbst geschriebenes Zeichen übernehmen und den Text damit neu schreiben
    setGlyph(ch, glyph) {
      glyphs[ch] = glyph;
      clearTimeout(timer);
      if (auto) playExample();
      else { build(input.value); animate(0); }
    },
  };
}
