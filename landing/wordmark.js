// Schriftzug „Siebwrite“ in Handschrift über dem Bodenraster, wie am Ende des Films.
// Schreibt sich einmal, sobald er ins Bild kommt.

import { Hand, measure } from './film.js';

const NS = 'http://www.w3.org/2000/svg';
const EM = 250;
const DURATION = 2.4; // Sekunden

export async function wordmark(svg) {
  await document.fonts.ready;
  const width = measure('Siebwrite', EM);
  // Grundlinie bei y = 0; die Buchstaben reichen bis etwa 0,8 em darüber
  svg.setAttribute('viewBox', `-30 ${-EM * 0.92} ${width + 60} ${EM * 1.02}`);
  // Schmal wird der Schriftzug stark verkleinert: dann dickerer Strich, damit er nicht zerfasert
  const g = document.createElementNS(NS, 'g');
  svg.append(g);
  const name = new Hand(g, 'Siebwrite', { x: 0, y: 0, em: EM, color: 'currentColor', width: innerWidth < 600 ? 6.5 : 4.2, seed: 9, jitter: 0.5, gap: 0.25 });

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { name.draw(1); return; }
  name.draw(0);
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
  const io = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / (DURATION * 1000));
      name.draw(ease(p));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { threshold: 0.6 });
  io.observe(svg);
}
