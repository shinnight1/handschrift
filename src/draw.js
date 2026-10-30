// Schreibkästchen im Browser: Apple Pencil, Finger oder Maus. Jedes Kästchen
// ist ein Canvas mit Hilfslinien; Striche werden in Glyphen-Koordinaten
// gespeichert (Einheit = Kästchenhöhe, y = 0 auf der Grundlinie).
// Welche Kästchen es gibt, sagt setSlots(): je Platz ein Schlüssel für den
// Speicher und das Zeichen, das hineingehört.

import { BOX_ASPECT, GUIDES, fromTop, toGlyphY } from './charset.js';
import { simplify, smooth, round4 } from './geometry.js';

const SIMPLIFY_EPS = 0.002;

class DrawingGrid {
  /**
   * @param {HTMLElement} root
   * @param {object} hooks  getCell(key) → strokes | undefined, setCell(key, strokes|null)
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.first = 0;
    this.perPage = 12;
    this.slots = []; // [{key, char}] in Schreibreihenfolge
    this.focus = null; // Kästchen, zu dem goToKey gesprungen ist: wird als nächstes markiert
    this.cells = new Map(); // Schlüssel → {canvas, ctx, el, char}
    this.penSeen = false;
    this.active = null; // {pointerId, key, points}
    this.undoStack = [];
    this.colors = { guide: '#c9d6ee', base: '#9fb2d8', ink: '#1f2a44' };
  }

  setColors(colors) {
    this.colors = colors;
    for (const i of this.cells.keys()) this.paint(i);
  }

  // Wie viele Kästchen auf eine Seite passen, aus der verfügbaren Breite.
  // Die Zahlen folgen style.css: 12px Abstand, 8px Innenrand, 1px Rand, 22px Kopf, 6px Lücke.
  layout(width, height) {
    const cols = Math.max(3, Math.min(8, Math.floor(width / 150)));
    const cellW = (width - (cols - 1) * 12) / cols;
    const rowH = (cellW - 18) / BOX_ASPECT + 46 + 12;
    const rows = Math.max(2, Math.min(5, Math.floor(height / rowH)));
    const perPage = cols * rows;
    if (perPage !== this.perPage || cols !== this.cols) {
      this.cols = cols;
      this.perPage = perPage;
      this.first = Math.floor(this.first / perPage) * perPage;
      this.render();
    }
  }

  setSlots(slots) {
    this.slots = slots;
    this.first = Math.min(this.first, Math.max(0, this.pageCount - 1) * this.perPage);
    this.render();
  }

  get pageCount() { return Math.max(1, Math.ceil(this.slots.length / this.perPage)); }
  get page() { return Math.floor(this.first / this.perPage); }

  goTo(page) {
    const p = Math.max(0, Math.min(this.pageCount - 1, page));
    this.first = p * this.perPage;
    this.focus = null;
    this.render();
  }

  // Springt zur Seite mit dem ersten leeren Kästchen.
  goToFirstEmpty() {
    const p = this.slots.findIndex(({ key }) => !this.hooks.getCell(key));
    this.goTo(Math.floor((p < 0 ? 0 : p) / this.perPage));
  }

  // Springt zur Seite eines Kästchens. false, wenn es das Kästchen gerade nicht gibt.
  goToKey(key) {
    const p = this.slots.findIndex((s) => s.key === key);
    if (p < 0) return false;
    this.goTo(Math.floor(p / this.perPage));
    this.focus = key;
    return true;
  }

  render() {
    this.root.style.setProperty('--cols', this.cols ?? 4);
    this.root.replaceChildren();
    this.cells.clear();
    const last = Math.min(this.slots.length, this.first + this.perPage);
    for (let p = this.first; p < last; p++) {
      const { key, char } = this.slots[p];
      const el = document.createElement('div');
      el.className = 'cell';
      const head = document.createElement('div');
      head.className = 'cell-head';
      const label = document.createElement('span');
      label.className = 'cell-char';
      label.textContent = char;
      const num = document.createElement('span');
      num.className = 'cell-num';
      num.textContent = String(p + 1);
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'cell-clear';
      clear.setAttribute('aria-label', `Kästchen ${p + 1} (${char}) leeren`);
      clear.title = 'Feld leeren';
      clear.textContent = '×';
      clear.addEventListener('click', () => this.clearCell(key));
      head.append(label, num, clear);
      const canvas = document.createElement('canvas');
      canvas.className = 'cell-canvas';
      canvas.setAttribute('aria-label', `Schreibfeld für ${char}`);
      el.append(head, canvas);
      this.root.append(el);
      this.cells.set(key, { el, canvas, ctx: canvas.getContext('2d'), char });
      this.bind(canvas, key);
    }
    requestAnimationFrame(() => {
      for (const i of this.cells.keys()) this.paint(i);
      this.markNext();
    });
    this.root.dispatchEvent(new CustomEvent('pagechange'));
  }

  // Das erste leere Kästchen der Seite hervorheben: dort geht es weiter.
  // Nach einem Sprung (goToKey) wird ab dem angesprungenen Kästchen gesucht.
  markNext() {
    const keys = [...this.cells.keys()];
    const from = Math.max(0, keys.indexOf(this.focus));
    const empty = (k) => !this.hooks.getCell(k)?.length;
    const next = keys.slice(from).find(empty) ?? keys.find(empty);
    for (const [k, cell] of this.cells) cell.el.classList.toggle('next', k === next);
  }

  // Alle Kästchen der Seite ausgefüllt?
  get pageDone() {
    return [...this.cells.keys()].every((i) => this.hooks.getCell(i)?.length);
  }

  // Die Markierung wandert erst nach einer kurzen Pause weiter: Bei i, j, ä oder ! setzt man ab
  // und schreibt im selben Feld weiter, da soll nichts springen.
  changed() {
    clearTimeout(this.nextTimer);
    this.nextTimer = setTimeout(() => this.markNext(), 1200);
    this.root.dispatchEvent(new CustomEvent('change'));
  }

  size(cell) {
    const rect = cell.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (cell.canvas.width !== w || cell.canvas.height !== h) {
      cell.canvas.width = w;
      cell.canvas.height = h;
    }
    return { w, h, dpr };
  }

  paint(key) {
    const cell = this.cells.get(key);
    if (!cell) return;
    const { w, h, dpr } = this.size(cell);
    const ctx = cell.ctx;
    ctx.clearRect(0, 0, w, h);
    const line = (f, color, width, dash) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.beginPath();
      ctx.moveTo(6 * dpr, f * h);
      ctx.lineTo(w - 6 * dpr, f * h);
      ctx.stroke();
    };
    line(GUIDES.ascender, this.colors.guide, 1, [1, 4]);
    line(GUIDES.xline, this.colors.guide, 1, [5, 4]);
    line(GUIDES.baseline, this.colors.base, 1.5, []);
    ctx.setLineDash([]);

    const strokes = this.hooks.getCell(key) ?? [];
    // Leeres Feld: das Zeichen blass als Vorlage, in der Größe, die es haben soll.
    // Großbuchstaben, Ziffern und eigene Zeichen (meist Symbole wie # oder §) reichen bis zur
    // oberen Linie, der Rest bis zur gestrichelten.
    if (!strokes.length && this.active?.key !== key && this.colors.ghost) {
      const ch = cell.char;
      const tall = /[A-ZÄÖÜ0-9]/.test(ch) || (typeof key === 'string' && !/\p{Ll}/u.test(ch));
      const size = tall ? (GUIDES.baseline - GUIDES.ascender) / 0.7 : (GUIDES.baseline - GUIDES.xline) / 0.52;
      ctx.fillStyle = this.colors.ghost;
      ctx.font = `400 ${size * h}px "IBM Plex Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(ch, w / 2, GUIDES.baseline * h);
    }
    ctx.strokeStyle = this.colors.ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5 * dpr, h * 0.022);
    for (const s of strokes) this.strokePath(ctx, s, h);
    if (this.active?.key === key) this.strokePath(ctx, this.active.points, h);
    cell.el.classList.toggle('filled', strokes.length > 0);
  }

  strokePath(ctx, points, h) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0] * h, fromTop(points[0][1]) * h);
    if (points.length === 1) ctx.lineTo(points[0][0] * h + 0.5, fromTop(points[0][1]) * h);
    for (let k = 1; k < points.length; k++) ctx.lineTo(points[k][0] * h, fromTop(points[k][1]) * h);
    ctx.stroke();
  }

  bind(canvas, key) {
    const toGlyph = (e) => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.height, toGlyphY((e.clientY - r.top) / r.height)];
    };
    const ignore = (e) => {
      if (e.pointerType === 'pen' && !this.penSeen) {
        this.penSeen = true;
        this.root.dispatchEvent(new CustomEvent('pendetected'));
      }
      // Nach dem ersten Stift-Ereignis zeichnet die Hand nicht mehr mit.
      return this.penSeen && e.pointerType === 'touch';
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (ignore(e) || this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      // Weiterschreiben im selben Feld hält die Markierung fest, ein neues Feld zieht sie sofort nach
      clearTimeout(this.nextTimer);
      if (!this.hooks.getCell(key)?.length) this.markNext();
      this.active = { pointerId: e.pointerId, key, points: [toGlyph(e)] };
      this.paint(key);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active || this.active.pointerId !== e.pointerId) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) this.active.points.push(toGlyph(ev));
      this.paint(key);
    });
    const finish = (e) => {
      if (!this.active || this.active.pointerId !== e.pointerId) return;
      const { points } = this.active;
      this.active = null;
      const clean = simplify(smooth(points), SIMPLIFY_EPS).map(([x, y]) => [round4(x), round4(y)]);
      const strokes = [...(this.hooks.getCell(key) ?? []), clean];
      this.hooks.setCell(key, strokes);
      this.undoStack.push({ key, before: strokes.slice(0, -1) });
      this.paint(key);
      this.changed();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }

  clearCell(key) {
    const before = this.hooks.getCell(key);
    if (!before?.length) return;
    this.undoStack.push({ key, before });
    this.hooks.setCell(key, null);
    this.paint(key);
    this.changed();
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return false;
    this.hooks.setCell(step.key, step.before.length ? step.before : null);
    if (!this.cells.has(step.key)) this.goToKey(step.key);
    else this.paint(step.key);
    this.changed();
    return true;
  }
}

export { DrawingGrid };
