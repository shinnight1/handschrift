// Probierfeld auf der Startseite: ein Schreibkästchen wie in der App, nur ohne Speichern.

import { GUIDES } from '../src/charset.js';

export function tryPad(canvas, clear) {
  const ctx = canvas.getContext('2d');
  let strokes = [];
  let active = null;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    paint();
  }

  function paint() {
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    const line = (f, alpha, dash) => {
      ctx.strokeStyle = `rgba(220, 224, 230, ${alpha})`;
      ctx.lineWidth = dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.beginPath();
      ctx.moveTo(0, Math.round(f * h) + 0.5);
      ctx.lineTo(w, Math.round(f * h) + 0.5);
      ctx.stroke();
    };
    line(GUIDES.ascender, 0.12, [2, 5]);
    line(GUIDES.xline, 0.16, [6, 5]);
    line(GUIDES.baseline, 0.42, []);
    ctx.setLineDash([]);

    if (!strokes.length && !active) {
      ctx.fillStyle = 'rgba(220, 224, 230, 0.10)';
      ctx.font = `400 ${h * 0.44}px "IBM Plex Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('a', w / 2, GUIDES.baseline * h);
    }

    ctx.strokeStyle = '#eef0f3';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2 * dpr, h * 0.022);
    for (const s of active ? [...strokes, active.points] : strokes) {
      ctx.beginPath();
      s.forEach(([x, y], k) => (k ? ctx.lineTo(x * dpr, y * dpr) : ctx.moveTo(x * dpr, y * dpr)));
      if (s.length === 1) ctx.lineTo(s[0][0] * dpr + 0.5, s[0][1] * dpr);
      ctx.stroke();
    }
    clear.hidden = !strokes.length;
  }

  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* Zeiger schon weg */ }
    active = { id: e.pointerId, points: [at(e)] };
    paint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (active?.id !== e.pointerId) return;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) active.points.push(at(ev));
    paint();
  });
  const end = (e) => {
    if (active?.id !== e.pointerId) return;
    strokes.push(active.points);
    active = null;
    paint();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  clear.addEventListener('click', () => { strokes = []; paint(); });

  new ResizeObserver(resize).observe(canvas);
  document.fonts.ready.then(paint);
}
