// Steuerung der Seite: Schritt 1 (Kästchen ausfüllen) und Schritt 2 (Text setzen, speichern).

import { CELL_CHARS, FIRST_PASS } from './charset.js';
import { DrawingGrid } from './draw.js';
import { ProfileStore } from './store.js';
import { parseProfile, glyphTable, filledCount, createProfile } from './profile.js';
import { layoutText, FORMATS } from './layout.js';
import { drawPage, pagesToPdf, pagesToGoodNotes, INKS } from './render.js';
import { PAGE_FORMATS } from './goodnotes/writer.js';
import { fromBase64 } from './goodnotes/bytes.js';
import { isTouch, saveFile, saveFiles, readFileText } from './save.js';
import { handoffLink, readHandoff } from './handoff.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'handschrift.settings.v1';
const TEXT_KEY = 'handschrift.text.v1';
const EXAMPLE_TEXT = `Liebe Oma,

vielen Dank für das schöne Paket! Die Plätzchen waren schon am ersten Abend weg. Ich hoffe, euch geht es gut und der Garten übersteht den Herbst.

Bis bald und ganz liebe Grüße
Lena`;

const store = new ProfileStore({
  onStatus: (state) => {
    const el = $('sync-status');
    el.dataset.state = state;
    el.textContent = { saved: 'Im Browser gespeichert', error: 'Nicht gespeichert: Speicher gesperrt' }[state] ?? '';
  },
});

// ---------- Hilfen ----------

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* egal */ }
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Dateiname aus den ersten Wörtern, nur ASCII: manche Browser verwerfen
// Download-Namen mit Sonderzeichen und nennen die Datei dann "download".
function fileBase() {
  const words = $('text').value.trim().split(/\s+/).slice(0, 3).join(' ')
    .replace(/[äöüÄÖÜß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' })[c])
    .normalize('NFD').replace(/[^A-Za-z0-9 _-]/g, '').trim();
  return words ? `Handschrift - ${words}` : 'Handschrift';
}

// ---------- Schritt 1: Kästchen ----------

const grid = new DrawingGrid($('grid'), {
  getCell: (i) => store.getCell(i),
  setCell: (i, strokes) => store.setCell(i, strokes),
});

function applyGridColors() {
  grid.setColors({ guide: cssVar('--guide'), base: cssVar('--guide-strong'), ink: cssVar('--fg') });
}

function layoutGrid() {
  const width = $('grid').clientWidth || window.innerWidth - 64;
  // So viele Reihen, wie unter der Werkzeugleiste ohne Scrollen sichtbar sind.
  const top = $('grid').getBoundingClientRect().top + window.scrollY;
  const height = Math.max(260, window.innerHeight - top - 16);
  grid.layout(width, height);
}

function updateProgress() {
  const n = filledCount(store.profile);
  const total = CELL_CHARS.length;
  $('count').textContent = n;
  $('total').textContent = total;
  $('bar-fill').style.width = `${(100 * n) / total}%`;
  $('bar-tick').style.left = `${(100 * FIRST_PASS.length) / total}%`;
  const basis = FIRST_PASS.filter((_, i) => store.getCell(i)).length;
  $('pass-label').textContent = basis === FIRST_PASS.length ? 'Alle Zeichen ✓' : `Basis ${basis}/${FIRST_PASS.length}`;
  $('undo').disabled = grid.undoStack.length === 0;
}

function updatePageInfo() {
  const last = Math.min(CELL_CHARS.length, grid.first + grid.perPage);
  $('page-info').textContent = `${grid.first + 1}–${last}`;
  $('prev').disabled = grid.page === 0;
  $('next').disabled = grid.page >= grid.pageCount - 1;
}

$('grid').addEventListener('pagechange', updatePageInfo);
$('grid').addEventListener('change', () => { updateProgress(); scheduleCompose(); });
$('grid').addEventListener('pendetected', () => { $('pen-chip').hidden = false; });
$('prev').addEventListener('click', () => grid.goTo(grid.page - 1));
$('next').addEventListener('click', () => grid.goTo(grid.page + 1));
$('undo').addEventListener('click', () => { if (!grid.undo()) toast('Nichts rückgängig zu machen'); });

$('export-profile').addEventListener('click', async () => {
  const json = JSON.stringify({ ...createProfile(), cells: store.profile.cells });
  try {
    await saveFile('Handschrift-Profil.json', new TextEncoder().encode(json));
    toast('Gesichert');
  } catch (e) {
    if (e?.code !== 'declined') toast(e?.message ?? 'Sichern fehlgeschlagen');
  }
});

$('import-profile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const profile = parseProfile(await readFileText(file));
    store.replaceAll(profile);
    grid.undoStack = [];
    grid.goToFirstEmpty();
    updateProgress();
    scheduleCompose();
    toast(`${filledCount(profile)} Felder geladen`);
  } catch (err) {
    toast(err.message || 'Datei nicht lesbar');
  }
});

// Mitnehmen: Link mit Handschrift, Text und Einstellungen für ein anderes Gerät.
// Der Link liegt schon bereit (scheduleOutput), damit Teilen-Menü bzw.
// Zwischenablage noch als Folge des Tippens gelten.
let shareLink = null;
$('share-profile').addEventListener('click', async () => {
  if (!filledCount(store.profile)) { toast('Noch nichts geschrieben'); return; }
  try {
    const url = shareLink ?? await currentShareLink();
    if (isTouch() && navigator.share) {
      await navigator.share({ title: 'Meine Handschrift', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link kopiert: auf dem anderen Gerät öffnen');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Link ging nicht, „Sichern“ geht immer');
  }
});

function currentShareLink() {
  return handoffLink({ cells: store.profile.cells, text: $('text').value, settings });
}

function resetClearArea() {
  const area = $('clear-area');
  area.replaceChildren();
  const btn = document.createElement('button');
  btn.className = 'btn btn-text btn-danger';
  btn.type = 'button';
  btn.id = 'clear-all';
  btn.textContent = 'Löschen';
  btn.addEventListener('click', askClear);
  area.append(btn);
}

function askClear() {
  const area = $('clear-area');
  area.replaceChildren();
  const q = document.createElement('span');
  q.className = 'mono';
  q.textContent = 'Alles löschen?';
  const yes = document.createElement('button');
  yes.className = 'btn btn-danger';
  yes.type = 'button';
  yes.textContent = 'Löschen';
  yes.addEventListener('click', () => {
    store.replaceAll(createProfile());
    grid.undoStack = [];
    grid.goTo(0);
    updateProgress();
    scheduleCompose();
    resetClearArea();
    toast('Gelöscht');
  });
  const no = document.createElement('button');
  no.className = 'btn btn-text';
  no.type = 'button';
  no.textContent = 'Abbrechen';
  no.addEventListener('click', resetClearArea);
  area.append(q, yes, no);
  no.focus();
}
$('clear-all').addEventListener('click', askClear);

// ---------- Schritt 2: Setzen ----------

const DEFAULT_SETTINGS = {
  format: 'a4', paper: 'lined', ink: 'blau', size: 3.2, lines: 9, letters: 0.18, words: 0.9, natural: 0.5, pen: 0.35, seed: 1,
};
const settings = { ...DEFAULT_SETTINGS, ...cleanSettings(readJson(SETTINGS_KEY)) };
let currentLayout = null;
let sheetPage = 0;
let prepared = null; // fertige .goodnotes-Dateien zum aktuellen Satz

function renderInks() {
  const wrap = $('inks');
  wrap.replaceChildren();
  for (const [key, ink] of Object.entries(INKS)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'ink';
    input.id = `ink-${key}`;
    input.value = key;
    input.checked = settings.ink === key;
    const dot = document.createElement('span');
    dot.className = 'swatch';
    dot.style.background = `rgb(${ink.rgb.map((v) => Math.round(v * 255)).join(' ')})`;
    const name = document.createElement('span');
    name.className = 'sr-only';
    name.textContent = ink.label;
    label.title = ink.label;
    label.append(input, dot, name);
    wrap.append(label);
  }
}

const RANGE_FORMAT = {
  size: (v) => `${v.toFixed(1)} mm`,
  lines: (v) => `${v.toFixed(1)} mm`,
  letters: (v) => `${Math.round(v * 100)} %`,
  words: (v) => `${Math.round(v * 100)} %`,
  natural: (v) => `${Math.round(v * 100)} %`,
  pen: (v) => `${v.toFixed(2)} mm`,
};

function syncControls() {
  for (const key of Object.keys(RANGE_FORMAT)) {
    $(key).value = settings[key];
    $(`${key}-out`).textContent = RANGE_FORMAT[key](Number(settings[key]));
  }
  for (const name of ['format', 'paper', 'ink']) {
    const input = document.querySelector(`input[name="${name}"][value="${settings[name]}"]`);
    if (input) input.checked = true;
  }
}

function readControls() {
  for (const key of Object.keys(RANGE_FORMAT)) {
    settings[key] = Number($(key).value);
    $(`${key}-out`).textContent = RANGE_FORMAT[key](settings[key]);
  }
  for (const name of ['format', 'paper', 'ink']) {
    const input = document.querySelector(`input[name="${name}"]:checked`);
    if (input) settings[name] = input.value;
  }
  writeJson(SETTINGS_KEY, settings);
}

// Nur bekannte Einstellungen mit passendem Typ übernehmen (aus Speicher oder Link).
function cleanSettings(s) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = s?.[k];
    if (typeof v === typeof def && (typeof def !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  if (!INKS[out.ink]) delete out.ink;
  if (!FORMATS[out.format] || !PAGE_FORMATS[out.format]) delete out.format;
  if (!['lined', 'grid', 'blank'].includes(out.paper)) delete out.paper;
  return out;
}

let composeQueued = false;
function scheduleCompose() {
  if (composeQueued) return;
  composeQueued = true;
  requestAnimationFrame(() => { composeQueued = false; compose(); });
}

function compose() {
  const table = glyphTable(store.profile);
  const empty = table.size === 0;
  $('compose-empty').hidden = !empty;
  $('compose').hidden = empty;
  if (empty) { currentLayout = null; shareLink = null; return; }

  currentLayout = layoutText($('text').value, table, {
    format: FORMATS[settings.format],
    xHeightMm: settings.size,
    lineSpacingMm: settings.lines,
    letterSpacing: settings.letters,
    wordSpacing: settings.words,
    natural: settings.natural,
    penWidthMm: settings.pen,
    seed: settings.seed,
  });
  sheetPage = Math.min(sheetPage, currentLayout.pages.length - 1);
  renderSheet();

  const missing = currentLayout.missing;
  $('missing').hidden = missing.length === 0;
  $('missing').textContent = missing.length
    ? `Fehlt: ${missing.join(' ')}`
    : '';
  updateGoodNotesNote();
  scheduleOutput();
}

function renderSheet() {
  if (!currentLayout) return;
  const pages = currentLayout.pages;
  const page = pages[sheetPage];
  const canvas = $('preview');
  const cssWidth = canvas.parentElement.clientWidth || 600;
  const dpr = window.devicePixelRatio || 1;
  const pxPerPt = (cssWidth * dpr) / page.width;
  canvas.width = Math.round(page.width * pxPerPt);
  canvas.height = Math.round(page.height * pxPerPt);
  drawPage(canvas.getContext('2d'), page, pxPerPt, {
    paper: settings.paper, ink: INKS[settings.ink].rgb, layout: currentLayout,
  });
  $('sheet-info').textContent = `${sheetPage + 1}/${pages.length}`;
  $('page-prev').disabled = sheetPage === 0;
  $('page-next').disabled = sheetPage >= pages.length - 1;
}

// Ein Satz unter den Knöpfen: wie die Datei in GoodNotes kommt.
function updateGoodNotesNote() {
  const parts = [isTouch()
    ? 'Im Teilen-Menü GoodNotes wählen.'
    : 'Lädt die .goodnotes-Datei herunter. Dann in GoodNotes öffnen oder aufs iPad schicken.'];
  if (currentLayout?.pages.length > 1) parts.push('Jede Seite wird eine eigene Datei.');
  if (!PAGE_FORMATS[settings.format].tested) parts.push('A4 in GoodNotes ist Beta.');
  $('goodnotes-note').textContent = parts.join(' ');
}

function thumbnail(page) {
  const canvas = document.createElement('canvas');
  const pxPerPt = 360 / page.width;
  canvas.width = 360;
  canvas.height = Math.round(page.height * pxPerPt);
  drawPage(canvas.getContext('2d'), page, pxPerPt, {
    paper: settings.paper, ink: INKS[settings.ink].rgb, layout: currentLayout,
  });
  return fromBase64(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
}

function buildGoodNotes() {
  const files = pagesToGoodNotes(currentLayout.pages, {
    format: settings.format, paper: settings.paper, ink: INKS[settings.ink].rgb, layout: currentLayout, thumbnail,
  });
  const base = fileBase();
  const names = files.map((_, i) => (files.length > 1 ? `${base} (Seite ${i + 1}).goodnotes` : `${base}.goodnotes`));
  return { layout: currentLayout, files, names };
}

async function exportGoodNotes() {
  if (!currentLayout) return;
  // Vorbereitete Dateien nehmen: das Teilen-Menü muss kurz nach dem Tippen aufgehen.
  const { files, names } = prepared?.layout === currentLayout ? prepared : buildGoodNotes();
  try {
    await saveFiles(files.map((bytes, i) => ({ name: names[i], bytes })));
    $('goodnotes-result').hidden = true;
    toast(files.length > 1 ? `${files.length} Dateien gespeichert` : 'Gespeichert');
  } catch (e) {
    if (e?.code !== 'declined') toast(e?.message ?? 'Speichern fehlgeschlagen');
  }
}

async function exportPdf() {
  if (!currentLayout) return;
  const pdf = pagesToPdf(currentLayout.pages, { paper: settings.paper, ink: INKS[settings.ink].rgb, layout: currentLayout });
  try {
    await saveFile(`${fileBase()}.pdf`, pdf);
    toast('PDF gespeichert');
  } catch (e) {
    if (e?.code !== 'declined') toast(e?.message ?? 'Speichern fehlgeschlagen');
  }
}

// Kurz nach jeder Änderung: Mitnehmen-Link erneuern und, solange "Setzen"
// offen ist, die .goodnotes-Dateien vorbereiten. Beim Schreiben bleibt das
// aus, sonst ruckelt der Stift.
let outputTimer = null;
let outputToken = 0;
function scheduleOutput() {
  clearTimeout(outputTimer);
  outputTimer = setTimeout(async () => {
    if (!currentLayout) return;
    if (!$('view-setzen').hidden) prepared = buildGoodNotes();
    const token = ++outputToken;
    try {
      const link = await currentShareLink();
      if (token === outputToken) shareLink = link;
    } catch {
      shareLink = null;
    }
  }, 300);
}

$('text').addEventListener('input', () => {
  writeJson(TEXT_KEY, $('text').value);
  scheduleCompose();
});
document.querySelector('.settings').addEventListener('input', () => { readControls(); scheduleCompose(); });
$('reshuffle').addEventListener('click', () => {
  settings.seed = (settings.seed % 100000) + 1 + Math.floor(Math.random() * 1000);
  writeJson(SETTINGS_KEY, settings);
  scheduleCompose();
});
$('page-prev').addEventListener('click', () => { sheetPage = Math.max(0, sheetPage - 1); renderSheet(); });
$('page-next').addEventListener('click', () => { sheetPage = Math.min((currentLayout?.pages.length ?? 1) - 1, sheetPage + 1); renderSheet(); });
$('save-goodnotes').addEventListener('click', exportGoodNotes);
$('save-pdf').addEventListener('click', exportPdf);

// ---------- Ankommender Link ----------

function showResult(state, message) {
  const el = $('goodnotes-result');
  el.dataset.state = state;
  el.textContent = message;
  el.hidden = false;
}

// Kommt die Seite über einen Mitnehmen-Link (von hier oder aus dem
// claude.ai-Artifact), Profil, Text und Einstellungen übernehmen.
async function receiveHandoff() {
  const hash = location.hash;
  if (!hash.startsWith('#gn')) return;
  // Den langen Link aus Adresszeile und Verlauf nehmen.
  history.replaceState(null, '', `${location.pathname}${location.search}#setzen`);
  try {
    const data = await readHandoff(hash);
    if (!data) throw new Error('Der Link ist unvollständig. Am besten neu erzeugen und ganz kopieren.');
    store.replaceAll({ ...createProfile(), cells: data.cells });
    grid.undoStack = [];
    Object.assign(settings, cleanSettings(data.settings));
    writeJson(SETTINGS_KEY, settings);
    $('text').value = data.text;
    writeJson(TEXT_KEY, data.text);
    syncControls();
    showView();
    updateProgress();
    showResult('ok', `Deine Handschrift ist da (${filledCount(store.profile)} Felder) und ersetzt die bisherige auf diesem Gerät. Tipp auf „Als GoodNotes importieren“.`);
  } catch (e) {
    showView();
    showResult('error', e?.message || 'Der Link ließ sich nicht lesen.');
  }
}

// ---------- Ansichten ----------

function showView() {
  let view = location.hash.slice(1);
  if (view.startsWith('gn')) view = 'setzen';
  if (view !== 'schreiben' && view !== 'setzen') view = filledCount(store.profile) >= FIRST_PASS.length ? 'setzen' : 'schreiben';
  $('view-schreiben').hidden = view !== 'schreiben';
  $('view-setzen').hidden = view !== 'setzen';
  for (const a of document.querySelectorAll('.step')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (view === 'schreiben') { layoutGrid(); grid.render(); }
  else scheduleCompose();
}

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#gn')) receiveHandoff();
  else showView();
});
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!$('view-schreiben').hidden) layoutGrid();
    else renderSheet();
  }, 120);
});

// ---------- Start ----------

$('text').value = readJson(TEXT_KEY) ?? EXAMPLE_TEXT;
renderInks();
syncControls();
applyGridColors();
grid.goToFirstEmpty();
showView();
updateProgress();
receiveHandoff();
