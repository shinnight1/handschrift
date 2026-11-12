// Arbeitsblatt im Browser: Datei öffnen (PDF über PDF.js, Fotos und Scans direkt), jede Seite
// als JPEG mit ihren gedruckten Linien (worksheet.js), Speichern im Browser (IndexedDB), und
// die Felder über der Vorschau: antippen, aufziehen, verschieben, Größe ändern, Text tippen.
// Nichts davon verlässt das Gerät.

import { MM } from './pdf.js';
import { estimateSkew, detectLines, fieldAt, orderFields } from './worksheet.js';
import { tr } from './i18n.js';

// PDF.js (Mozilla, Apache 2.0) liegt fest versioniert unter vendor/ und lädt erst, wenn
// jemand ein PDF öffnet. Die Legacy-Fassung läuft auch auf älteren iPads.
const PDFJS = new URL('../vendor/pdfjs-6.4.299/', import.meta.url).href;
const MAX_PAGES = 20;
// Pixel je Seite: größere Canvas bringen ältere iPads ins Straucheln, und bei vielen Seiten
// zählt der Speicher für alle zusammen
const maxPixels = (pages) => (pages > 4 ? 4e6 : 6e6);
const MAX_DPI = 220;
const ANALYSIS_DPI = 150; // für die Linienerkennung reicht weniger
const MIN_W = 6 * MM;
const MIN_H = 4 * MM;

// ---------- Datei → Seiten ----------

let pdfjs = null;
function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = import(`${PDFJS}pdf.min.js`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
      return lib;
    });
    pdfjs.catch(() => { pdfjs = null; });
  }
  return pdfjs;
}

const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr('Das Blatt ist zu groß für diesen Browser.')))), type, quality);
});

// Graustufen-Kopie eines Canvas in der Größe w × h.
function grayOf(canvas, w, h) {
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  small.width = small.height = 0;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return gray;
}

// Schief fotografiertes oder gescanntes Blatt gerade drehen (estimateSkew), damit Linien
// waagerecht liegen: für die Erkennung und fürs Ergebnis.
function straighten(canvas, width) {
  const k = Math.min(1, 100 / 72 / (canvas.width / width)); // 100 dpi reichen
  const w = Math.max(1, Math.round(canvas.width * k));
  const h = Math.max(1, Math.round(canvas.height * k));
  const angle = estimateSkew(grayOf(canvas, w, h), w, h);
  if (!angle) return canvas;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((-angle * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  canvas.width = canvas.height = 0;
  return out;
}

// Seite aus einem fertig gemalten Canvas: gerade gerückt, als JPEG zum Speichern und
// Ausgeben, dazu die gedruckten Linien, gesucht auf einer kleineren Graustufen-Kopie. Fotos
// sind schon ausgeglichen (flatten), dort darf die Erkennung blassere Punkte mitnehmen.
async function canvasToPage(source, width, height, { photo = false } = {}) {
  const canvas = straighten(source, width);
  const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer());
  const scale = Math.min(ANALYSIS_DPI / 72, canvas.width / width);
  const aw = Math.max(1, Math.round(width * scale));
  const ah = Math.max(1, Math.round(height * scale));
  const { rules, columns } = detectLines(grayOf(canvas, aw, ah), aw, ah, aw / width, { level: photo ? 0.86 : 0.8 });
  canvas.width = canvas.height = 0;
  return { width, height, jpeg, rules, columns };
}

async function pdfToPages(bytes, onProgress) {
  let lib;
  try {
    lib = await loadPdfjs();
  } catch {
    throw new Error(tr('Der PDF-Leser ließ sich nicht laden. Ist das Netz da?'));
  }
  const task = lib.getDocument({ data: bytes, wasmUrl: `${PDFJS}wasm/`, isEvalSupported: false, enableXfa: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    task.destroy();
    throw new Error(e?.name === 'PasswordException' ? tr('Das PDF ist mit einem Passwort geschützt.') : tr('Das PDF ließ sich nicht öffnen.'));
  }
  try {
    const count = Math.min(doc.numPages, MAX_PAGES);
    const pages = [];
    for (let i = 1; i <= count; i++) {
      onProgress?.(i, count);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 }); // in Punkten, mit Drehung
      const scale = Math.min(MAX_DPI / 72, Math.sqrt(maxPixels(count) / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport }).promise;
      pages.push(await canvasToPage(canvas, base.width, base.height));
      page.cleanup();
      canvas.width = canvas.height = 0; // Speicher gleich frei (iOS)
    }
    return { pages, skipped: doc.numPages - count };
  } finally {
    task.destroy(); // beendet auch den Worker
  }
}

// Fotos wie ein Scan: Schatten, ungleiches Licht und graues Papier ausgleichen. Für jeden
// Bildblock wird das Papierweiß geschätzt (die hellsten Pixel: 90. Perzentil), zwischen den
// Blöcken weich verlaufen, und jedes Pixel so aufgehellt, dass dort Papier weiß wird. Große
// dunkle Flächen (Bilder auf dem Blatt) werden höchstens um gut ein Drittel aufgehellt.
function flatten(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lum = (i) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  const B = Math.max(16, Math.round(Math.min(w, h) / 32));
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const bg = new Float32Array(bw * bh);
  const hist = new Uint32Array(64);
  const all = new Uint32Array(256);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      let n = 0;
      for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 2) {
        for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 2) {
          const v = lum((y * w + x) * 4);
          hist[v >> 2]++;
          all[v]++;
          n++;
        }
      }
      let acc = 0;
      let v = 63;
      while (v > 0 && (acc += hist[v]) < n * 0.1) v--;
      bg[by * bw + bx] = v * 4 + 2;
    }
  }
  // Papierweiß des ganzen Blatts (Median); weiß genug und gleichmäßig: nichts zu tun
  const total = all.reduce((a, b) => a + b, 0);
  let acc = 0;
  let white = 255;
  for (let v = 0; v < 256; v++) if ((acc += all[v]) >= total / 2) { white = v; break; }
  if (white < 90) return;
  let low = 255;
  for (let i = 0; i < bg.length; i++) bg[i] = Math.max(bg[i], white * 0.7), low = Math.min(low, bg[i]);
  if (low >= 242) return;
  const at = (bx, by) => bg[Math.min(bh - 1, Math.max(0, by)) * bw + Math.min(bw - 1, Math.max(0, bx))];
  for (let y = 0; y < h; y++) {
    const fy = y / B - 0.5;
    const by = Math.floor(fy);
    const ty = fy - by;
    for (let x = 0; x < w; x++) {
      const fx = x / B - 0.5;
      const bx = Math.floor(fx);
      const tx = fx - bx;
      const b = (at(bx, by) * (1 - tx) + at(bx + 1, by) * tx) * (1 - ty) + (at(bx, by + 1) * (1 - tx) + at(bx + 1, by + 1) * tx) * ty;
      const f = 250 / b;
      const i = (y * w + x) * 4;
      d[i] = Math.min(255, d[i] * f);
      d[i + 1] = Math.min(255, d[i + 1] * f);
      d[i + 2] = Math.min(255, d[i + 2] * f);
    }
  }
  ctx.putImageData(img, 0, 0);
}

async function imageToPages(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error(tr('Das Bild ließ sich nicht öffnen. PDF, JPG oder PNG gehen.'));
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    // Seitengröße: lange Seite wie A4 (297 mm), die kurze im Verhältnis des Bilds
    const long = 841.89;
    const [width, height] = w >= h ? [long, (long * h) / w] : [(long * w) / h, long];
    const k = Math.min(1, Math.sqrt(maxPixels(1) / (w * h)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; // durchsichtige PNGs auf Weiß
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    flatten(ctx, canvas.width, canvas.height);
    const page = await canvasToPage(canvas, width, height, { photo: true });
    canvas.width = canvas.height = 0;
    return { pages: [page], skipped: 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * Arbeitsblatt aus einer Datei (PDF oder Bild).
 * @returns {Promise<{sheet: {id: string, name: string, pages: Array}, skipped: number}>}
 */
async function openSheetFile(file, onProgress) {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const isPdf = String.fromCharCode(...head) === '%PDF-' || /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  const { pages, skipped } = isPdf
    ? await pdfToPages(new Uint8Array(await file.arrayBuffer()), onProgress)
    : await imageToPages(file);
  if (!pages.length) throw new Error(tr('Das PDF hat keine Seiten.'));
  const name = file.name.replace(/\.[^.]+$/, '') || tr('Arbeitsblatt');
  return { sheet: { id: newId(), name, pages }, skipped };
}

// ---------- Speichern im Browser ----------

// Das Blatt (Bilder, einige MB) liegt in IndexedDB, die Felder (klein, ändern sich bei jedem
// Tastendruck) im localStorage. Geht beides nicht (privates Fenster), bleibt es bis zum Neuladen.
const DB_NAME = 'siebwrite';
const STORE = 'sheet';
const FIELDS_KEY = 'handschrift.sheet.v1';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function storeSheet(sheet) {
  try {
    if (sheet) await idb('readwrite', (s) => s.put(sheet, 'current'));
    else await idb('readwrite', (s) => s.delete('current'));
    return true;
  } catch {
    return false;
  }
}

async function restoreSheet() {
  try {
    const sheet = await idb('readonly', (s) => s.get('current'));
    if (!sheet?.pages?.length) return null;
    return sheet;
  } catch {
    return null;
  }
}

// Felder nur prüfen und runden; was nicht passt, fällt weg.
function cleanFields(list, sheet) {
  if (!Array.isArray(list) || !sheet) return [];
  const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN);
  return list.map((f) => ({
    id: typeof f?.id === 'string' ? f.id : newId(),
    page: Number.isInteger(f?.page) ? f.page : -1,
    x: num(f?.x), y: num(f?.y), w: num(f?.w), h: num(f?.h),
    text: typeof f?.text === 'string' ? f.text : '',
  })).filter((f) => sheet.pages[f.page] && [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0);
}

function storeFields(sheet, fields) {
  try {
    if (sheet) localStorage.setItem(FIELDS_KEY, JSON.stringify({ id: sheet.id, fields: cleanFields(fields, sheet) }));
    else localStorage.removeItem(FIELDS_KEY);
  } catch { /* egal */ }
}

function restoreFields(sheet) {
  try {
    const data = JSON.parse(localStorage.getItem(FIELDS_KEY) ?? 'null');
    return data?.id === sheet?.id ? cleanFields(data.fields, sheet) : [];
  } catch {
    return [];
  }
}

// Bild einer Seite für die Vorschau (und das Vorschaubild der GoodNotes-Datei). Die Adresse
// bleibt gültig, bis das Blatt wechselt (dropImage): Safari wirft dekodierte Bilder bei
// Speichermangel weg und lädt sie dann neu von dort.
async function pageImage(page) {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([page.jpeg], { type: 'image/jpeg' }));
  try {
    await img.decode();
  } catch (e) {
    dropImage(img);
    throw e;
  }
  return img;
}

function dropImage(img) {
  if (img?.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
}

// ---------- Felder über der Vorschau ----------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class SheetEditor {
  /**
   * @param {object} o
   * @param {HTMLElement} o.layer  liegt genau über dem Vorschau-Canvas
   * @param {HTMLElement} o.list   Liste der Felder im Bedienfeld
   * @param {(kind: 'text'|'shape') => void} o.onChange  Text oder Lage eines Felds geändert
   * @param {(page: number) => void} o.onPage  ein Feld auf einer anderen Seite wurde gewählt
   * @param {(field: object, index: number) => void} o.onRemove  Feld gelöscht (für Rückgängig)
   */
  constructor({ layer, list, onChange, onPage, onRemove }) {
    this.layer = layer;
    this.list = list;
    this.onChange = onChange;
    this.onPage = onPage;
    this.onRemove = onRemove;
    this.sheet = null;
    this.fields = [];
    this.page = 0;
    this.selected = null;
    this.results = new Map();
    this.boxes = new Map(); // Id → Element über der Vorschau
    this.items = new Map(); // Id → Eintrag in der Liste
    this.gesture = null;

    // Eingabe direkt am gewählten Feld; bleibt bestehen, damit der Fokus beim Neuzeichnen hält.
    this.editor = document.createElement('div');
    this.editor.className = 'sedit';
    this.editor.hidden = true;
    this.editorText = document.createElement('textarea');
    this.editorText.rows = 2;
    this.editorText.spellcheck = true;
    this.editorText.addEventListener('input', () => this.setText(this.selected, this.editorText.value, this.editorText));
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn btn-quiet btn-mini sedit-done';
    done.textContent = tr('Fertig');
    done.addEventListener('click', () => this.select(null));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-text btn-danger btn-mini';
    del.textContent = tr('Feld löschen');
    del.addEventListener('click', () => this.remove(this.selected));
    const bar = document.createElement('div');
    bar.className = 'sedit-bar';
    bar.append(del, done);
    this.editor.append(this.editorText, bar);
    this.layer.append(this.editor);

    this.band = document.createElement('div');
    this.band.className = 'sbox is-band';
    this.band.hidden = true;
    this.layer.append(this.band);

    this.bind();
  }

  setSheet(sheet, fields) {
    this.sheet = sheet;
    this.fields = fields;
    this.page = 0;
    this.selected = null;
    this.results = new Map();
    for (const el of this.boxes.values()) el.remove();
    this.boxes.clear();
    this.items.clear();
    this.list.replaceChildren();
    this.render();
  }

  setPage(page) {
    if (page === this.page) return;
    this.page = page;
    if (this.field(this.selected)?.page !== page) this.selected = null;
    this.render();
  }

  setResults(results) {
    this.results = results;
    for (const [id, el] of this.boxes) el.classList.toggle('is-over', Boolean(results.get(id)?.overflow));
    for (const [id, li] of this.items) li.classList.toggle('is-over', Boolean(results.get(id)?.overflow));
  }

  field(id) { return this.fields.find((f) => f.id === id) ?? null; }

  get pageSize() { return this.sheet?.pages[this.page] ?? null; }

  // Punkte pro CSS-Pixel der Vorschau
  get unit() { return this.pageSize.width / Math.max(1, this.layer.clientWidth); }

  point(e) {
    const r = this.layer.getBoundingClientRect();
    const u = this.pageSize.width / Math.max(1, r.width);
    return [(e.clientX - r.left) * u, (e.clientY - r.top) * u];
  }

  // ----- Ändern -----

  add(box) {
    const page = this.pageSize;
    const w = clamp(box.w, MIN_W, page.width);
    const h = clamp(box.h, MIN_H, page.height);
    const f = {
      id: newId(), page: this.page, text: '',
      x: clamp(box.x, 0, page.width - w), y: clamp(box.y, 0, page.height - h), w, h,
    };
    this.fields.push(f);
    this.selected = f.id;
    this.render();
    this.onChange('shape');
    this.focusEditor();
    return f;
  }

  remove(id) {
    const i = this.fields.findIndex((f) => f.id === id);
    if (i < 0) return;
    const [f] = this.fields.splice(i, 1);
    if (this.selected === id) this.selected = null;
    this.render();
    this.onChange('shape');
    this.onRemove?.(f, i);
  }

  restore(f, index) {
    this.fields.splice(Math.min(index, this.fields.length), 0, f);
    if (f.page !== this.page) this.onPage(f.page);
    this.select(f.id);
    this.onChange('shape');
  }

  setText(id, text, from = null) {
    const f = this.field(id);
    if (!f || f.text === text) return;
    f.text = text;
    // Die andere Eingabe zum selben Feld nachziehen, ohne der tippenden den Fokus zu nehmen
    if (from !== this.editorText && this.selected === id) this.editorText.value = text;
    const area = this.items.get(id)?.querySelector('textarea');
    if (area && area !== from) area.value = text;
    this.items.get(id)?.classList.toggle('is-empty', !text.trim());
    this.onChange('text');
  }

  // Antworten aus splitAnswers(): Index = Feld in Lesereihenfolge
  fill(answers) {
    let n = 0;
    orderFields(this.fields).forEach((f, i) => {
      if (typeof answers[i] !== 'string') return;
      f.text = answers[i];
      n++;
    });
    this.render();
    if (this.selected) this.editorText.value = this.field(this.selected)?.text ?? '';
    for (const [id, li] of this.items) li.querySelector('textarea').value = this.field(id)?.text ?? '';
    this.onChange('text');
    return n;
  }

  select(id, { focus = false } = {}) {
    const f = this.field(id);
    this.selected = f ? f.id : null;
    if (f && f.page !== this.page) {
      this.onPage(f.page); // zeichnet neu
    } else {
      this.render();
    }
    if (f && focus) this.focusEditor();
  }

  focusEditor() {
    requestAnimationFrame(() => {
      if (this.editor.hidden) return;
      this.editorText.focus({ preventScroll: true });
      this.editor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // ----- Zeichnen -----

  render() {
    if (!this.sheet) {
      for (const el of this.boxes.values()) el.remove();
      this.boxes.clear();
      this.editor.hidden = true;
      this.renderList();
      return;
    }
    const page = this.pageSize;
    const order = orderFields(this.fields);
    const number = new Map(order.map((f, i) => [f.id, i + 1]));
    const pct = (v, of) => `${((100 * v) / of).toFixed(3)}%`;
    const shown = new Set();
    for (const f of this.fields) {
      if (f.page !== this.page) continue;
      shown.add(f.id);
      let el = this.boxes.get(f.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'sbox';
        el.dataset.id = f.id;
        const num = document.createElement('span');
        num.className = 'sbox-num';
        el.append(num);
        for (const h of ['nw', 'ne', 'sw', 'se']) {
          const handle = document.createElement('span');
          handle.className = `sbox-h sbox-${h}`;
          handle.dataset.h = h;
          el.append(handle);
        }
        this.layer.insertBefore(el, this.band);
        this.boxes.set(f.id, el);
      }
      Object.assign(el.style, { left: pct(f.x, page.width), top: pct(f.y, page.height), width: pct(f.w, page.width), height: pct(f.h, page.height) });
      el.querySelector('.sbox-num').textContent = number.get(f.id);
      el.classList.toggle('is-selected', f.id === this.selected);
      el.classList.toggle('is-empty', !f.text.trim());
      el.classList.toggle('is-over', Boolean(this.results.get(f.id)?.overflow));
    }
    for (const [id, el] of this.boxes) {
      if (!shown.has(id)) { el.remove(); this.boxes.delete(id); }
    }
    this.placeEditor(number);
    this.renderList(order, number);
  }

  // Eingabe unter dem gewählten Feld, oder darüber, wenn unten kein Platz ist.
  placeEditor(number) {
    const f = this.field(this.selected);
    if (!f || f.page !== this.page) { this.editor.hidden = true; return; }
    const page = this.pageSize;
    const frameW = this.layer.clientWidth || 1;
    const k = frameW / page.width;
    const width = Math.min(frameW - 8, Math.max(220, f.w * k));
    const left = clamp(f.x * k, 4, frameW - width - 4);
    const below = (f.y + f.h) * k + 8;
    const frameH = this.layer.clientHeight || 1;
    this.editor.hidden = false;
    this.editor.style.width = `${width}px`;
    this.editor.style.left = `${left}px`;
    const h = this.editor.offsetHeight || 96;
    const top = below + h <= frameH - 4 ? below : Math.max(4, f.y * k - h - 8);
    this.editor.style.top = `${top}px`;
    this.editorText.placeholder = tr('Text für Feld {n}', { n: number.get(f.id) });
    this.editorText.setAttribute('aria-label', tr('Text für Feld {n}', { n: number.get(f.id) }));
    if (document.activeElement !== this.editorText) this.editorText.value = f.text;
  }

  renderList(order = orderFields(this.fields), number = new Map(order.map((f, i) => [f.id, i + 1]))) {
    const keep = new Set(order.map((f) => f.id));
    for (const [id, li] of this.items) {
      if (!keep.has(id)) { li.remove(); this.items.delete(id); }
    }
    const pages = this.sheet?.pages.length ?? 0;
    order.forEach((f, i) => {
      let li = this.items.get(f.id);
      if (!li) {
        li = document.createElement('li');
        li.className = 'sfield';
        const num = document.createElement('button');
        num.type = 'button';
        num.className = 'sfield-num';
        num.addEventListener('click', () => this.select(f.id, { focus: true }));
        const area = document.createElement('textarea');
        area.rows = 1;
        area.spellcheck = true;
        area.addEventListener('input', () => this.setText(f.id, area.value, area));
        area.addEventListener('focus', () => { if (this.selected !== f.id) this.select(f.id); });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-icon btn-quiet sfield-del';
        del.textContent = '×';
        del.addEventListener('click', () => this.remove(f.id));
        li.append(num, area, del);
        this.items.set(f.id, li);
      }
      const n = number.get(f.id);
      const num = li.querySelector('.sfield-num');
      num.textContent = n;
      num.title = pages > 1 ? tr('Feld {n}, Seite {p}', { n, p: f.page + 1 }) : tr('Feld {n}', { n });
      const area = li.querySelector('textarea');
      area.placeholder = tr('Text für Feld {n}', { n });
      area.setAttribute('aria-label', tr('Text für Feld {n}', { n }));
      if (document.activeElement !== area) area.value = f.text;
      li.querySelector('.sfield-del').setAttribute('aria-label', tr('Feld {n} löschen', { n }));
      li.classList.toggle('is-selected', f.id === this.selected);
      li.classList.toggle('is-empty', !f.text.trim());
      li.classList.toggle('is-over', Boolean(this.results.get(f.id)?.overflow));
      if (this.list.children[i] !== li) this.list.insertBefore(li, this.list.children[i] ?? null);
    });
  }

  // ----- Zeiger -----

  bind() {
    const layer = this.layer;
    // Apple Pencil soll aufziehen statt die Seite zu verschieben; Finger scrollen weiter.
    const stylus = (e) => {
      if ([...e.changedTouches].some((t) => t.touchType === 'stylus') && !e.target.closest('.sedit')) e.preventDefault();
    };
    layer.addEventListener('touchstart', stylus, { passive: false });
    layer.addEventListener('touchmove', stylus, { passive: false });

    layer.addEventListener('pointerdown', (e) => {
      if (!this.sheet || (e.pointerType === 'mouse' && e.button !== 0) || this.gesture) return;
      if (e.target.closest('.sedit')) return;
      const boxEl = e.target.closest('.sbox:not(.is-band)');
      const [x, y] = this.point(e);
      if (boxEl) {
        const f = this.field(boxEl.dataset.id);
        if (!f) return;
        e.preventDefault();
        layer.setPointerCapture(e.pointerId);
        const was = this.selected === f.id;
        if (!was) this.select(f.id);
        this.gesture = { kind: e.target.dataset.h ?? 'move', id: e.pointerId, field: f, start: [x, y], from: { ...f }, moved: false, was, touch: e.pointerType === 'touch' };
        return;
      }
      if (e.pointerType === 'touch') {
        // Finger: Scrollen bleibt möglich, ein Tipp zählt erst beim Loslassen
        this.gesture = { kind: 'tap', id: e.pointerId, start: [x, y], client: [e.clientX, e.clientY], time: e.timeStamp };
        return;
      }
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      this.gesture = { kind: 'draw', id: e.pointerId, start: [x, y], now: [x, y] };
    });

    layer.addEventListener('pointermove', (e) => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId || g.kind === 'tap') return;
      e.preventDefault();
      const [x, y] = this.point(e);
      const page = this.pageSize;
      if (g.kind === 'draw') {
        g.now = [x, y];
        const r = this.rect(g.start, g.now);
        this.band.hidden = false;
        Object.assign(this.band.style, {
          left: `${(100 * r.x) / page.width}%`, top: `${(100 * r.y) / page.height}%`,
          width: `${(100 * r.w) / page.width}%`, height: `${(100 * r.h) / page.height}%`,
        });
        return;
      }
      const dx = x - g.start[0];
      const dy = y - g.start[1];
      if (!g.moved && Math.hypot(dx, dy) < 4 * this.unit) return; // kleines Zittern beim Antippen
      g.moved = true;
      const f = g.field;
      const o = g.from;
      if (g.kind === 'move') {
        f.x = clamp(o.x + dx, 0, page.width - o.w);
        f.y = clamp(o.y + dy, 0, page.height - o.h);
      } else {
        let x0 = o.x;
        let y0 = o.y;
        let x1 = o.x + o.w;
        let y1 = o.y + o.h;
        if (g.kind.includes('w')) x0 = clamp(o.x + dx, 0, x1 - MIN_W);
        if (g.kind.includes('e')) x1 = clamp(o.x + o.w + dx, x0 + MIN_W, page.width);
        if (g.kind.includes('n')) y0 = clamp(o.y + dy, 0, y1 - MIN_H);
        if (g.kind.includes('s')) y1 = clamp(o.y + o.h + dy, y0 + MIN_H, page.height);
        Object.assign(f, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
      this.render();
      this.onChange('shape');
    });

    const finish = (e, cancelled) => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      this.gesture = null;
      this.band.hidden = true;
      if (cancelled) return;
      if (g.kind === 'tap') {
        const moved = Math.hypot(e.clientX - g.client[0], e.clientY - g.client[1]);
        if (moved < 10 && e.timeStamp - g.time < 700) this.tap(...g.start);
      } else if (g.kind === 'draw') {
        const r = this.rect(g.start, this.point(e));
        if (r.w >= MIN_W && r.h >= MIN_H) this.add(r);
        else this.tap(...g.start);
      } else if (!g.moved && (g.was || !g.touch)) {
        // Feld angeklickt oder gewähltes Feld noch einmal angetippt: gleich zum Text. Ein erster
        // Fingertipp wählt nur, damit nicht bei jedem Verschieben die Tastatur aufspringt.
        this.focusEditor();
      }
    };
    layer.addEventListener('pointerup', (e) => finish(e, false));
    layer.addEventListener('pointercancel', (e) => finish(e, true));

    // Tasten: Esc wählt ab, Entf löscht das gewählte Feld (nicht beim Tippen)
    document.addEventListener('keydown', (e) => {
      if (!this.sheet || !this.selected || this.layer.closest('[hidden]')) return;
      if (e.key === 'Escape') {
        this.select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest('input, textarea, [contenteditable]')) {
        e.preventDefault();
        this.remove(this.selected);
      }
    });
  }

  rect([x0, y0], [x1, y1]) {
    const page = this.pageSize;
    const ax = clamp(Math.min(x0, x1), 0, page.width);
    const ay = clamp(Math.min(y0, y1), 0, page.height);
    return { x: ax, y: ay, w: clamp(Math.max(x0, x1), 0, page.width) - ax, h: clamp(Math.max(y0, y1), 0, page.height) - ay };
  }

  // Tipp aufs Blatt: ist ein Feld gewählt, nur abwählen; sonst ein Feld an dieser Stelle,
  // eingepasst in Linie, Lücke oder Tabellenzelle (fieldAt).
  tap(x, y) {
    if (this.selected) { this.select(null); return; }
    this.add(fieldAt(this.pageSize, x, y));
  }
}

export { SheetEditor, openSheetFile, storeSheet, restoreSheet, storeFields, restoreFields, pageImage, dropImage, MAX_PAGES };
