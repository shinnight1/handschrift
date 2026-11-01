// Handschrift für die Startseite: einzelne Wörter (scribble) und kleine Zettel mit Papier
// (card). Beides schreibt sich einmal, sobald es ins Bild kommt.

import { Hand, measure } from './film.js';

const NS = 'http://www.w3.org/2000/svg';
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const INK = '#1e3a9b';

const el = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
};

// Schreibt hand beim ersten Sichtbarwerden von target; Dauer nach Länge des Textes.
function writeOnView(target, hand, em, { delay = 0, threshold = 0.6 } = {}) {
  if (still) { hand.draw(1); return; }
  hand.draw(0);
  const ms = Math.min(3600, Math.max(700, (hand.total / em) * 95));
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    setTimeout(() => {
      const start = performance.now();
      const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
      const tick = (now) => {
        const p = Math.min(1, (now - start) / ms);
        hand.draw(ease(p));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
  }, { threshold });
  io.observe(target);
}

// Zeilenumbruch nach Wörtern für eine Breite
export function wrapText(text, em, width) {
  return text.split('\n').map((para) => {
    const lines = [];
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, em) > width) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
    return lines.join('\n');
  }).join('\n');
}

/**
 * Wort oder Zeilen in Handschrift, ohne Papier; viewBox liegt eng um den Text.
 * Höhe per CSS setzen (z. B. 1.1em), die Breite folgt dem Seitenverhältnis.
 */
export function scribble(svg, text, { em = 100, width = 5, color = 'currentColor', lineGap = em * 1.15, seed = 3, delay = 0 } = {}) {
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => measure(l, em)));
  const pad = em * 0.12;
  const top = em * 0.86;
  const height = top + em * 0.34 + (lines.length - 1) * lineGap;
  svg.setAttribute('viewBox', `${-pad} ${-top} ${w + 2 * pad} ${height}`);
  // Seitenverhältnis für CSS: Inline-SVG mit nur einer festen Seite fällt sonst zusammen
  svg.style.setProperty('--ar', ((w + 2 * pad) / height).toFixed(4));
  const hand = new Hand(el('g', {}, svg), text, { x: 0, y: 0, em, color, width, lineGap, seed, jitter: 0.6, gap: 0.3 });
  writeOnView(svg, hand, em, { delay });
}

// Papiersorten der Zettel: Zeilenabstand, erste Grundlinie, linker Rand
const PAPER = {
  lined: { gap: 46, first: 92, left: 66, em: 40 },
  grid: { gap: 44, first: 96, left: 34, em: 38 },
  index: { gap: 44, first: 104, left: 30, em: 38 },
  sticky: { gap: 54, first: 104, left: 30, em: 50 },
};

/** Zettel mit Papier und handgeschriebenem Text (viewBox 400 × 300). */
export function card(svg, text, kind = 'lined', { delay = 0, seed = 5 } = {}) {
  const W = 400;
  const H = 300;
  const p = PAPER[kind];
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const fill = { lined: 'var(--paper)', grid: '#f7f6f1', index: '#fbfaf6', sticky: 'var(--sticky)' }[kind];
  el('rect', { width: W, height: H, rx: kind === 'sticky' ? 2 : 6, fill }, svg);
  if (kind === 'lined') {
    for (let y = p.first; y < H; y += p.gap) el('line', { x1: 0, x2: W, y1: y, y2: y, stroke: 'var(--rule)', 'stroke-width': 1.2 }, svg);
    el('line', { x1: 48, x2: 48, y1: 0, y2: H, stroke: 'var(--margin)', 'stroke-width': 1.4 }, svg);
  } else if (kind === 'grid') {
    for (let y = p.first % 22; y < H; y += 22) el('line', { x1: 0, x2: W, y1: y, y2: y, stroke: '#c9d3e6', 'stroke-width': 0.9 }, svg);
    for (let x = 12; x < W; x += 22) el('line', { x1: x, x2: x, y1: 0, y2: H, stroke: '#c9d3e6', 'stroke-width': 0.9 }, svg);
  } else if (kind === 'index') {
    el('line', { x1: 0, x2: W, y1: 56, y2: 56, stroke: 'var(--margin)', 'stroke-width': 1.6 }, svg);
    for (let y = p.first; y < H; y += p.gap) el('line', { x1: 0, x2: W, y1: y, y2: y, stroke: 'var(--rule)', 'stroke-width': 1.1 }, svg);
  }
  const wrapped = wrapText(text, p.em, W - p.left - 26);
  const hand = new Hand(el('g', {}, svg), wrapped, { x: p.left, y: p.first, em: p.em, color: INK, width: 2.3, lineGap: p.gap, seed, jitter: 0.9, gap: 0.3 });
  writeOnView(svg, hand, p.em, { delay, threshold: 0.5 });
}
