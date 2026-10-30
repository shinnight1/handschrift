// Steuerung der Seite: Schritt 1 (Kästchen ausfüllen) und Schritt 2 (Text setzen, speichern).

import { CELL_CHARS, CELL_GROUPS, FIRST_PASS, BASE_CELLS, EXTRA_PASSES, isCustomChar } from './charset.js';
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
const TIPS_KEY = 'handschrift.tips.v1';
const EXTRA_KEY = 'handschrift.extra.v1';
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
  getCell: (key) => store.getCell(key),
  setCell: (key, strokes) => store.setCell(key, strokes),
});

// Kästchen in Schreibreihenfolge: die feste Liste, dann eigene Zeichen (über „Fehlt“
// dazugekommen), dann, wenn eingeschaltet, die Zusatz-Durchgänge.
let extrasOn = false;
let customChars = []; // eigene Zeichen mit Kästchen, auch gerade geleerte

const hasExtraCells = () => Object.keys(store.profile.cells).some((k) => Number(k) >= BASE_CELLS);

function buildSlots() {
  const fixed = (from, to) => CELL_CHARS.slice(from, to).map((char, k) => ({ key: from + k, char, group: CELL_GROUPS[from + k] }));
  return [
    ...fixed(0, BASE_CELLS),
    ...customChars.map((char) => ({ key: char, char, group: 'Eigene Zeichen' })),
    ...(extrasOn ? fixed(BASE_CELLS, CELL_CHARS.length) : []),
  ];
}

// Nach Laden, Löschen oder Mitnehmen-Link: Kästchen neu aus dem Profil.
function resetSlots() {
  customChars = Object.keys(store.profile.custom);
  extrasOn = readJson(EXTRA_KEY) === true || hasExtraCells();
  grid.setSlots(buildSlots());
}

function applyGridColors() {
  grid.setColors({ guide: cssVar('--guide'), base: cssVar('--guide-strong'), ink: cssVar('--ink'), ghost: cssVar('--ghost') });
}

function layoutGrid() {
  const width = $('grid').clientWidth || window.innerWidth - 64;
  // So viele Reihen, wie unter der Werkzeugleiste ohne Scrollen sichtbar sind.
  const top = $('grid').getBoundingClientRect().top + window.scrollY;
  const height = Math.max(260, window.innerHeight - top - 16);
  grid.layout(width, height);
}

// Zwei Phasen: erst jedes Zeichen einmal (Basis), dann freiwillige Varianten.
// Eigene Zeichen zählen nicht mit, die Zusatz-Durchgänge nur, wenn eingeschaltet.
function updateProgress() {
  const total = extrasOn ? CELL_CHARS.length : BASE_CELLS;
  const n = Object.keys(store.profile.cells).filter((k) => Number(k) < total).length;
  const basisTotal = FIRST_PASS.length;
  const basis = FIRST_PASS.filter((_, i) => store.getCell(i)).length;
  const basisDone = basis === basisTotal;
  $('pass-label').textContent = basisDone ? 'Varianten, freiwillig' : 'Basis';
  $('count').textContent = basisDone ? n - basis : basis;
  $('total').textContent = basisDone ? total - basisTotal : basisTotal;
  $('bar-fill').style.width = `${(100 * n) / total}%`;
  $('bar-tick').style.left = `${(100 * basisTotal) / total}%`;
  $('phase-hint').textContent = n === total
    ? 'Alles ausgefüllt.'
    : basisDone
      ? 'Alle Zeichen da. Varianten sind freiwillig.'
      : `Jedes Zeichen einmal. Noch ${basisTotal - basis}.`;
  $('to-compose').classList.toggle('btn-primary', basisDone);
  // Ausblenden nur, solange in den Zusatz-Durchgängen noch nichts steht.
  $('more-passes').hidden = !basisDone || (extrasOn && hasExtraCells());
  $('more-passes').textContent = extrasOn ? 'Zusatz-Durchgänge ausblenden' : `+ ${EXTRA_PASSES} Durchgänge für mehr Abwechslung`;
  $('undo').disabled = grid.undoStack.length === 0;
  $('clear-area').hidden = filledCount(store.profile) === 0; // Nichts da, nichts zu löschen
  updateTips(n);
}

function updatePageInfo() {
  const last = Math.min(grid.slots.length, grid.first + grid.perPage) - 1;
  const groups = [...new Set([grid.slots[grid.first]?.group, grid.slots[last]?.group])];
  $('page-group').textContent = groups.join(', ');
  $('page-info').textContent = `Seite ${grid.page + 1} von ${grid.pageCount}`;
  $('prev').disabled = grid.page === 0;
  $('next').disabled = grid.page >= grid.pageCount - 1;
  // Seite voll: der Pfeil nach rechts wird zur Hauptaktion.
  $('next').classList.toggle('nudge', !$('next').disabled && grid.pageDone);
}

// Kurze Anleitung, bis sie weggeklickt wird oder die ersten Felder sitzen.
function updateTips(filled) {
  const was = $('tips').hidden;
  $('tips').hidden = readJson(TIPS_KEY) === 'closed' || filled >= 6;
  if (was !== $('tips').hidden && !$('view-schreiben').hidden) layoutGrid();
}
$('tips-close').addEventListener('click', () => { writeJson(TIPS_KEY, 'closed'); updateTips(0); });

$('grid').addEventListener('pagechange', updatePageInfo);
$('grid').addEventListener('change', () => { updateProgress(); updatePageInfo(); scheduleCompose(); });
$('grid').addEventListener('pendetected', () => { $('pen-chip').hidden = false; });
$('prev').addEventListener('click', () => grid.goTo(grid.page - 1));
$('next').addEventListener('click', () => grid.goTo(grid.page + 1));
$('undo').addEventListener('click', () => { if (!grid.undo()) toast('Nichts rückgängig zu machen'); });
$('more-passes').addEventListener('click', () => {
  extrasOn = !extrasOn;
  writeJson(EXTRA_KEY, extrasOn);
  grid.setSlots(buildSlots());
  if (extrasOn) {
    grid.goToKey(BASE_CELLS);
    toast('Noch fünfmal alles, freiwillig');
  }
  updateProgress();
  updatePageInfo();
});

// Tasten: Strg/Cmd+Z macht rückgängig, Pfeile blättern. Nicht beim Tippen im Textfeld.
document.addEventListener('keydown', (e) => {
  if ($('view-schreiben').hidden || e.target.closest('input, textarea, [contenteditable]')) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (!grid.undo()) toast('Nichts rückgängig zu machen');
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    grid.goTo(grid.page + (e.key === 'ArrowRight' ? 1 : -1));
  }
});

$('export-profile').addEventListener('click', async () => {
  const json = JSON.stringify({ ...createProfile(), cells: store.profile.cells, custom: store.profile.custom });
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
    resetSlots();
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
  return handoffLink({ cells: store.profile.cells, custom: store.profile.custom, text: $('text').value, settings });
}

function resetClearArea() {
  const area = $('clear-area');
  area.replaceChildren();
  const btn = document.createElement('button');
  btn.className = 'btn btn-text btn-danger';
  btn.type = 'button';
  btn.id = 'clear-all';
  btn.textContent = 'Alles löschen';
  btn.addEventListener('click', askClear);
  area.append(btn);
}

function askClear() {
  const area = $('clear-area');
  area.replaceChildren();
  const q = document.createElement('span');
  q.className = 'mono';
  q.textContent = 'Alle Felder löschen?';
  const yes = document.createElement('button');
  yes.className = 'btn btn-danger';
  yes.type = 'button';
  yes.textContent = 'Löschen';
  yes.addEventListener('click', () => {
    store.replaceAll(createProfile());
    grid.undoStack = [];
    resetSlots();
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

// Wert neben dem Regler und silberne Füllung der Spur bis zum Griff.
function showRange(key) {
  const input = $(key);
  const v = Number(input.value);
  $(`${key}-out`).textContent = RANGE_FORMAT[key](v);
  input.style.setProperty('--fill', `${(100 * (v - input.min)) / (input.max - input.min)}%`);
}

function syncControls() {
  for (const key of Object.keys(RANGE_FORMAT)) {
    $(key).value = settings[key];
    showRange(key);
  }
  for (const name of ['format', 'paper', 'ink']) {
    const input = document.querySelector(`input[name="${name}"][value="${settings[name]}"]`);
    if (input) input.checked = true;
  }
  $('ink-name').textContent = INKS[settings.ink].label;
}

function readControls() {
  for (const key of Object.keys(RANGE_FORMAT)) {
    settings[key] = Number($(key).value);
    showRange(key);
  }
  for (const name of ['format', 'paper', 'ink']) {
    const input = document.querySelector(`input[name="${name}"]:checked`);
    if (input) settings[name] = input.value;
  }
  $('ink-name').textContent = INKS[settings.ink].label;
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
  $('missing-chars').textContent = missing.length
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
  const parts = [isTouch() ? 'Im Teilen-Menü GoodNotes wählen.' : 'Lädt die .goodnotes-Datei herunter.'];
  if (currentLayout?.pages.length > 1) parts.push('Eine Datei pro Seite.');
  if (!PAGE_FORMATS[settings.format].tested) parts.push('A4 ist Beta.');
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
  clearedText = null; // Wer schon Neues tippt oder einfügt, soll es nicht überschrieben bekommen
  updateTextClear();
  scheduleCompose();
});

// Text auf einen Tipp leeren, etwa bevor man den nächsten einfügt. Danach holt derselbe
// Knopf ein paar Sekunden lang den alten Text zurück.
let clearedText = null;
let clearedTimer = null;
function setText(value) {
  $('text').value = value;
  writeJson(TEXT_KEY, value);
  scheduleCompose();
}
function updateTextClear() {
  $('text-clear').hidden = clearedText === null && !$('text').value;
  $('text-clear').textContent = clearedText === null ? 'Leeren' : 'Zurückholen';
}
$('text-clear').addEventListener('click', () => {
  clearTimeout(clearedTimer);
  if (clearedText === null) {
    clearedText = $('text').value;
    setText('');
    $('text').focus(); // gleich bereit zum Einfügen
    clearedTimer = setTimeout(() => { clearedText = null; updateTextClear(); }, 8000);
  } else {
    setText(clearedText);
    clearedText = null;
  }
  updateTextClear();
});
document.querySelector('.settings').addEventListener('input', () => { readControls(); scheduleCompose(); });
$('reshuffle').addEventListener('click', () => {
  settings.seed = (settings.seed % 100000) + 1 + Math.floor(Math.random() * 1000);
  writeJson(SETTINGS_KEY, settings);
  scheduleCompose();
});
$('page-prev').addEventListener('click', () => { sheetPage = Math.max(0, sheetPage - 1); renderSheet(); });
$('page-next').addEventListener('click', () => { sheetPage = Math.min((currentLayout?.pages.length ?? 1) - 1, sheetPage + 1); renderSheet(); });
// „Fehlt: *“ antippen: gleich zum Schreiben, dorthin, wo das Zeichen hingehört. Zeichen der
// festen Liste haben ihr Kästchen schon, alle anderen bekommen eins unter „Eigene Zeichen“.
$('missing').addEventListener('click', () => {
  const targets = [];
  for (const char of currentLayout?.missing ?? []) {
    if (CELL_CHARS.includes(char)) targets.push(CELL_CHARS.indexOf(char));
    else if (isCustomChar(char)) {
      if (!customChars.includes(char)) customChars.push(char);
      targets.push(char);
    }
  }
  if (!targets.length) { toast('Dieses Zeichen lässt sich nicht schreiben'); return; }
  grid.setSlots(buildSlots());
  location.hash = '#schreiben';
  showView();
  grid.goToKey(targets[0]);
  // Auf schmalen Bildschirmen liegt das Kästchen sonst unten unter der Meldung.
  setTimeout(() => $('grid').querySelector('.cell.next')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  toast('Hier schreiben, dann zurück zum Setzen');
});
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
    store.replaceAll({ ...createProfile(), cells: data.cells, custom: data.custom });
    grid.undoStack = [];
    resetSlots();
    Object.assign(settings, cleanSettings(data.settings));
    writeJson(SETTINGS_KEY, settings);
    $('text').value = data.text;
    writeJson(TEXT_KEY, data.text);
    updateTextClear();
    syncControls();
    showView();
    updateProgress();
    showResult('ok', `Handschrift übernommen (${filledCount(store.profile)} Felder). Sie ersetzt die bisherige auf diesem Gerät.`);
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
updateTextClear();
renderInks();
syncControls();
applyGridColors();
document.fonts.ready.then(applyGridColors); // Vorlagen-Zeichen erst mit geladener Schrift richtig
resetSlots();
grid.goToFirstEmpty();
showView();
updateProgress();
receiveHandoff();
document.documentElement.dataset.ready = '1'; // sonst zeigt die Seite nach kurzer Zeit „Neu laden“
