// Schreibkästchen im Browser: Apple Pencil, Finger oder Maus. Jedes Kästchen
// ist ein Canvas mit Hilfslinien; Striche werden in Glyphen-Koordinaten
// gespeichert (Einheit = Kästchenhöhe, y = 0 auf der Grundlinie).

import { CELL_CHARS, BOX_ASPECT, GUIDES, fromTop, toGlyphY } from './charset.js';
import { simplify, smooth, round4 } from './geometry.js';

const SIMPLIFY_EPS = 0.002;

class DrawingGrid {
  /**
   * @param {HTMLElement} root
   * @param {object} hooks  getCell(i) → strokes | undefined, setCell(i, strokes|null)
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.first = 0;
    this.perPage = 12;
    this.cells = new Map(); // Index → {canvas, ctx, el}
    this.penSeen = false;
    this.active = null; // {pointerId, index, points}
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

  get pageCount() { return Math.ceil(CELL_CHARS.length / this.perPage); }
  get page() { return Math.floor(this.first / this.perPage); }

  goTo(page) {
    const p = Math.max(0, Math.min(this.pageCount - 1, page));
    this.first = p * this.perPage;
    this.render();
  }

  // Springt zur Seite mit dem ersten leeren Kästchen.
  goToFirstEmpty() {
    const i = CELL_CHARS.findIndex((_, k) => !this.hooks.getCell(k));
    this.goTo(Math.floor((i < 0 ? 0 : i) / this.perPage));
  }

  render() {
    this.root.style.setProperty('--cols', this.cols ?? 4);
    this.root.replaceChildren();
    this.cells.clear();
    const last = Math.min(CELL_CHARS.length, this.first + this.perPage);
    for (let i = this.first; i < last; i++) {
      const el = document.createElement('div');
      el.className = 'cell';
      const head = document.createElement('div');
      head.className = 'cell-head';
      const label = document.createElement('span');
      label.className = 'cell-char';
      label.textContent = CELL_CHARS[i];
      const num = document.createElement('span');
      num.className = 'cell-num';
      num.textContent = String(i + 1);
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'cell-clear';
      clear.setAttribute('aria-label', `Kästchen ${i + 1} (${CELL_CHARS[i]}) leeren`);
      clear.title = 'Feld leeren';
      clear.textContent = '×';
      clear.addEventListener('click', () => this.clearCell(i));
      head.append(label, num, clear);
      const canvas = document.createElement('canvas');
      canvas.className = 'cell-canvas';
      canvas.setAttribute('aria-label', `Schreibfeld für ${CELL_CHARS[i]}`);
      el.append(head, canvas);
      this.root.append(el);
      this.cells.set(i, { el, canvas, ctx: canvas.getContext('2d') });
      this.bind(canvas, i);
    }
    requestAnimationFrame(() => {
      for (const i of this.cells.keys()) this.paint(i);
      this.markNext();
    });
    this.root.dispatchEvent(new CustomEvent('pagechange'));
  }

  // Das erste leere Kästchen der Seite hervorheben: dort geht es weiter.
  markNext() {
    let found = false;
    for (const [i, cell] of this.cells) {
      const next = !found && !this.hooks.getCell(i)?.length;
      if (next) found = true;
      cell.el.classList.toggle('next', next);
    }
  }

  // Alle Kästchen der Seite ausgefüllt?
  get pageDone() {
    return [...this.cells.keys()].every((i) => this.hooks.getCell(i)?.length);
  }

  changed() {
    this.markNext();
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

  paint(i) {
    const cell = this.cells.get(i);
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

    const strokes = this.hooks.getCell(i) ?? [];
    // Leeres Feld: das Zeichen blass als Vorlage, in der Größe, die es haben soll.
    // Großbuchstaben und Ziffern reichen bis zur oberen Linie, der Rest bis zur gestrichelten.
    if (!strokes.length && this.active?.index !== i && this.colors.ghost) {
      const ch = CELL_CHARS[i];
      const tall = /[A-ZÄÖÜ0-9]/.test(ch);
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
    if (this.active?.index === i) this.strokePath(ctx, this.active.points, h);
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

  bind(canvas, index) {
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
      this.active = { pointerId: e.pointerId, index, points: [toGlyph(e)] };
      this.paint(index);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active || this.active.pointerId !== e.pointerId) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) this.active.points.push(toGlyph(ev));
      this.paint(index);
    });
    const finish = (e) => {
      if (!this.active || this.active.pointerId !== e.pointerId) return;
      const { points } = this.active;
      this.active = null;
      const clean = simplify(smooth(points), SIMPLIFY_EPS).map(([x, y]) => [round4(x), round4(y)]);
      const strokes = [...(this.hooks.getCell(index) ?? []), clean];
      this.hooks.setCell(index, strokes);
      this.undoStack.push({ index, before: strokes.slice(0, -1) });
      this.paint(index);
      this.changed();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }

  clearCell(index) {
    const before = this.hooks.getCell(index);
    if (!before?.length) return;
    this.undoStack.push({ index, before });
    this.hooks.setCell(index, null);
    this.paint(index);
    this.changed();
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return false;
    this.hooks.setCell(step.index, step.before.length ? step.before : null);
    if (!this.cells.has(step.index)) this.goTo(Math.floor(step.index / this.perPage));
    else this.paint(step.index);
    this.changed();
    return true;
  }
}

export { DrawingGrid };
