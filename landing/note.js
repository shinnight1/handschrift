// Notizzettel im Hero: Buchstaben selbst schreiben. Ohne Eingabe fragt er nach einem e,
// dem häufigsten Buchstaben; wer etwas tippt (am besten den Namen), schreibt dessen
// Buchstaben nacheinander. Jeder fertige Buchstabe ersetzt sofort den der Vorlage auf
// dem Blatt (sheet.js) und wandert beim Weg in die App als Kästchen mit, wenn dort
// noch keins steht. Gleiche Hilfslinien wie die Schreibkästchen der App.

import { GUIDES, CELL_CHARS } from '../src/charset.js';
import { simplify, smooth, round4 } from '../src/geometry.js';
import { encodeStrokes } from '../src/store.js';
import { GLYPHS } from './hand-font.js';

const PROFILE_KEY = 'handschrift.profile.v1';
const FONT_XHEIGHT = 440; // x-Höhe der Vorlage in Font-Einheiten (1000 je em)
const INK = '#1e3a9b';
const PAUSE = 900; // so lange nach dem letzten Strich, dann ist der Buchstabe fertig

export function note(canvas, { onGlyph, clear, title, count, label }) {
  const ctx = canvas.getContext('2d');
  let strokes = []; // aktueller Buchstabe, in CSS-Pixeln
  let active = null;
  let dpr = 1;
  let timer = 0;
  let want = ['e']; // Buchstaben, nach denen gefragt wird
  let current = 'e';
  const written = new Map(); // Zeichen → Striche in CSS-Pixeln und Kästchenhöhe

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
      ctx.strokeStyle = `rgba(80, 70, 30, ${alpha})`;
      ctx.lineWidth = dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.beginPath();
      ctx.moveTo(0, Math.round(f * h) + 0.5);
      ctx.lineTo(w, Math.round(f * h) + 0.5);
      ctx.stroke();
    };
    line(GUIDES.ascender, 0.16, [2, 5]);
    line(GUIDES.xline, 0.22, [6, 5]);
    line(GUIDES.baseline, 0.45, []);
    ctx.setLineDash([]);
    if (!strokes.length && !active && current) {
      // Vorlage blass, in der Größe, die das Zeichen haben soll (wie in der App)
      const tall = /[A-ZÄÖÜ0-9]/.test(current);
      const size = tall ? (GUIDES.baseline - GUIDES.ascender) / 0.7 : (GUIDES.baseline - GUIDES.xline) / 0.52;
      ctx.fillStyle = 'rgba(80, 70, 30, 0.14)';
      ctx.font = `400 ${size * h}px "IBM Plex Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(current, w / 2, GUIDES.baseline * h);
    }
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2 * dpr, h * 0.024);
    for (const s of active ? [...strokes, active.points] : strokes) {
      ctx.beginPath();
      s.forEach(([x, y], k) => (k ? ctx.lineTo(x * dpr, y * dpr) : ctx.moveTo(x * dpr, y * dpr)));
      if (s.length === 1) ctx.lineTo(s[0][0] * dpr + 0.5, s[0][1] * dpr);
      ctx.stroke();
    }
  }

  function show() {
    const left = want.filter((c) => !written.has(c));
    const all = want.length > 1;
    title.textContent = current ? `Schreib ein ${current}` : 'Fertig';
    count.textContent = all ? `${want.length - left.length + (current ? 1 : 0)}/${want.length}` : '';
    count.hidden = !all || !current;
    clear.hidden = !strokes.length;
    label.hidden = written.size === 0;
    label.textContent = !current && all ? 'Alles in deiner Schrift.' : written.size === 1 && !all ? 'Steckt jetzt in jedem Wort.' : 'Schon auf dem Blatt.';
    paint();
  }

  // Striche als Zeichen der Vorlage: Font-Einheiten, Grundlinie bei 0, y nach unten
  function glyph(lines, h) {
    const k = FONT_XHEIGHT / ((GUIDES.baseline - GUIDES.xline) * h);
    const xs = lines.flat().map(([x]) => x);
    const minX = Math.min(...xs);
    const width = (Math.max(...xs) - minX) * k;
    const out = lines.map((s) => s.flatMap(([x, y]) => [Math.round((x - minX) * k + 30), Math.round((y - GUIDES.baseline * h) * k)]));
    return [Math.round(width + 90), out];
  }

  // Buchstabe fertig: aufs Blatt, merken, nächsten anfragen
  function commit() {
    if (!strokes.length || !current) return;
    const h = canvas.clientHeight;
    written.set(current, { strokes, h });
    onGlyph(current, glyph(strokes, h));
    strokes = [];
    current = want.find((c) => !written.has(c)) ?? null;
    show();
  }

  /** Neue Eingabe: nach ihren Buchstaben fragen (ohne Eingabe wieder nach dem e). */
  function ask(text) {
    const letters = [...new Set([...text].filter((c) => /\p{L}/u.test(c) && GLYPHS[c]?.[1].length))];
    want = letters.length ? letters : ['e'];
    if (!strokes.length) current = want.find((c) => !written.has(c)) ?? null;
    show();
  }

  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (active || !current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* Zeiger schon weg */ }
    clearTimeout(timer);
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
    show();
    // Kurz warten: viele Buchstaben haben mehrere Striche
    clearTimeout(timer);
    timer = setTimeout(commit, PAUSE);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  clear.addEventListener('click', () => { clearTimeout(timer); strokes = []; show(); });

  // Auf dem Weg in die App: geschriebene Buchstaben als Kästchen speichern, wo noch keins ist
  function carry() {
    if (!written.size) return;
    try {
      const data = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{"cells":{},"custom":{}}');
      data.cells ??= {};
      for (const [ch, { strokes: lines, h }] of written) {
        const index = CELL_CHARS.indexOf(ch);
        if (index < 0 || data.cells[index]) continue;
        const cell = lines
          .map((s) => simplify(smooth(s.map(([x, y]) => [x / h, y / h - GUIDES.baseline])), 0.002).map(([x, y]) => [round4(x), round4(y)]))
          .filter((s) => s.length);
        data.cells[index] = encodeStrokes(cell);
      }
      localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
    } catch { /* Speicher gesperrt: dann eben nicht */ }
  }
  for (const a of document.querySelectorAll('a[href^="app/"]')) a.addEventListener('click', carry);

  new ResizeObserver(resize).observe(canvas);
  document.fonts.ready.then(paint);
  show();
  return { ask };
}
