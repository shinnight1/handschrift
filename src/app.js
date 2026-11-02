// Steuerung der Seite: Schritt 1 (Kästchen ausfüllen) und Schritt 2 (Text setzen, speichern).

import { CELL_CHARS, CELL_GROUPS, FIRST_PASS, BASE_CELLS, EXTRA_PASSES, isCustomChar } from './charset.js';
import { DrawingGrid } from './draw.js';
import { ProfileStore } from './store.js';
import { parseProfile, glyphTable, filledCount, createProfile } from './profile.js';
import { layoutText, FORMATS } from './layout.js';
import { drawPage, pagesToPdf, pagesToGoodNotes, INKS, inkRgb, inkHex, isCustomInk } from './render.js';
import { PAGE_FORMATS } from './goodnotes/writer.js';
import { fromBase64 } from './goodnotes/bytes.js';
import { isTouch, saveFile, saveFiles, readFileText } from './save.js';
import { handoffLink, readHandoff } from './handoff.js';
import { createCloud } from './cloud.js';
import { PRESETS, presetById, loadFonts, presetProfile } from './presets.js';
import { lang, tr } from './i18n.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'handschrift.settings.v1';
const TEXT_KEY = 'handschrift.text.v1';
const TIPS_KEY = 'handschrift.tips.v1';
const EXTRA_KEY = 'handschrift.extra.v1';
const INKS_KEY = 'handschrift.inks.v1';
const EXAMPLE_TEXT = lang === 'en' ? `Dear Grandma,

thank you so much for the lovely parcel! The cookies were gone on the very first evening. I hope you are both well and the garden makes it through the autumn.

See you soon and lots of love
Lena` : `Liebe Oma,

vielen Dank für das schöne Paket! Die Plätzchen waren schon am ersten Abend weg. Ich hoffe, euch geht es gut und der Garten übersteht den Herbst.

Bis bald und ganz liebe Grüße
Lena`;

// Adressen der beiden Schritte; die englische Seite hat eigene Namen dafür.
const HASH = lang === 'en' ? { schreiben: 'write', setzen: 'compose' } : { schreiben: 'schreiben', setzen: 'setzen' };
const VIEW_OF = { schreiben: 'schreiben', setzen: 'setzen', write: 'schreiben', compose: 'setzen' };

// Auf Englisch braucht niemand Umlaute: diese Kästchen sind dort freiwillig und erscheinen
// nur, wenn sie schon beschrieben sind (oder über „Fehlt“).
const OPTIONAL = new Set(lang === 'en' ? [...'äöüßÄÖÜ'] : []);
const REQUIRED = FIRST_PASS.map((_, i) => i).filter((i) => !OPTIONAL.has(FIRST_PASS[i]));

// Status unten zeigt cloud.js: Browser und, wenn angemeldet, Google Drive.
const store = new ProfileStore({ onStatus: (state) => cloud.localStatus(state) });

// ---------- Hilfen ----------

// action: {label, run} zeigt einen Knopf in der Meldung (z. B. Rückgängig) und lässt sie länger stehen.
let toastTimer = null;
function toast(message, action = null) {
  const el = $('toast');
  el.replaceChildren(message);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-quiet';
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { el.hidden = true; action.run(); });
    el.append(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 8000 : 2600);
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
  const name = tr('Handschrift');
  return words ? `${name} - ${words}` : name;
}

// ---------- Schritt 1: Kästchen ----------

const grid = new DrawingGrid($('grid'), {
  getCell: (key) => store.getCell(key),
  setCell: (key, strokes) => store.setCell(key, strokes),
});

// Ganze Handschrift austauschen (Datei, Link, Löschen, Google Drive). Die bisherige
// lässt sich ein paar Sekunden lang zurückholen. false, solange gerade ein Strich läuft.
function replaceProfile(profile, message) {
  if (grid.active) return false;
  const before = store.profile;
  store.replaceAll(profile);
  grid.undoStack = [];
  resetSlots();
  updateProgress();
  updatePageInfo();
  ownChanged();
  cloud.changed();
  const undo = filledCount(before) ? { label: tr('Rückgängig'), run: () => replaceProfile(before, tr('Zurückgeholt')) } : null;
  if (message) toast(message, undo);
  return true;
}

const cloud = createCloud({
  getProfile: () => store.profile,
  applyProfile: (profile, action) => {
    const had = filledCount(store.profile);
    return replaceProfile(profile, action === 'merge'
      ? tr('{n} Kästchen von deinen anderen Geräten dazu', { n: filledCount(profile) - had })
      : had ? tr('Neuer Stand von einem anderen Gerät') : tr('Handschrift geladen'));
  },
  toast,
  onChange: () => updateProgress(),
});

// Kästchen in Schreibreihenfolge: die feste Liste, dann eigene Zeichen (über „Fehlt“
// dazugekommen), dann, wenn eingeschaltet, die Zusatz-Durchgänge.
let extrasOn = false;
let customChars = []; // eigene Zeichen mit Kästchen, auch gerade geleerte
let shownOptional = new Set(); // freiwillige Kästchen (Umlaute auf Englisch), die trotzdem dastehen

const hasExtraCells = () => Object.keys(store.profile.cells).some((k) => Number(k) >= BASE_CELLS);
const showsCell = (i) => !OPTIONAL.has(CELL_CHARS[i]) || shownOptional.has(i) || Boolean(store.getCell(i));

function buildSlots() {
  const fixed = (from, to) => CELL_CHARS.slice(from, to)
    .map((char, k) => ({ key: from + k, char, group: CELL_GROUPS[from + k] }))
    .filter(({ key }) => showsCell(key));
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
const basisCount = () => REQUIRED.filter((i) => store.getCell(i)).length;

function updateProgress() {
  const fixed = grid.slots.filter((s) => typeof s.key === 'number');
  const total = fixed.length;
  const n = fixed.filter((s) => store.getCell(s.key)).length;
  const basisTotal = REQUIRED.length;
  const basis = basisCount();
  const basisDone = basis === basisTotal;
  const extraDone = n - fixed.filter((s) => s.key < FIRST_PASS.length && store.getCell(s.key)).length;
  $('pass-label').textContent = basisDone ? tr('Varianten, freiwillig') : tr('Basis');
  $('count').textContent = basisDone ? extraDone : basis;
  $('total').textContent = basisDone ? total - fixed.filter((s) => s.key < FIRST_PASS.length).length : basisTotal;
  $('bar-fill').style.width = `${(100 * n) / total}%`;
  $('bar-tick').style.left = `${(100 * basisTotal) / total}%`;
  $('phase-hint').textContent = n === total
    ? tr('Alles ausgefüllt.')
    : basisDone
      ? tr('Alle Zeichen da. Varianten sind freiwillig.')
      : tr('Jedes Zeichen einmal. Noch {n}.', { n: basisTotal - basis });
  $('to-compose').classList.toggle('btn-primary', basisDone);
  // Ausblenden nur, solange in den Zusatz-Durchgängen noch nichts steht.
  $('more-passes').hidden = !basisDone || (extrasOn && hasExtraCells());
  $('more-passes').textContent = extrasOn ? tr('Zusatz-Durchgänge ausblenden') : tr('+ {n} Durchgänge für mehr Abwechslung', { n: EXTRA_PASSES });
  $('undo').disabled = grid.undoStack.length === 0;
  $('clear-area').hidden = filledCount(store.profile) === 0; // Nichts da, nichts zu löschen
  updateTips(n);
}

// Überschrift einer Kästchen-Gruppe in der Sprache der Seite (charset.js hat sie auf Deutsch).
function groupLabel(group) {
  const m = /^Zusatz (\d+)\/(\d+)$/.exec(group ?? '');
  return m ? tr('Zusatz {a}/{b}', { a: m[1], b: m[2] }) : tr(group ?? '');
}

function updatePageInfo() {
  const last = Math.min(grid.slots.length, grid.first + grid.perPage) - 1;
  const groups = [...new Set([grid.slots[grid.first]?.group, grid.slots[last]?.group])];
  $('page-group').textContent = groups.map(groupLabel).join(', ');
  $('page-info').textContent = tr('Seite {a} von {b}', { a: grid.page + 1, b: grid.pageCount });
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
$('grid').addEventListener('change', () => { updateProgress(); updatePageInfo(); ownChanged(); cloud.changed(); });
$('grid').addEventListener('pendetected', () => { $('pen-chip').hidden = false; });
$('prev').addEventListener('click', () => grid.goTo(grid.page - 1));
$('next').addEventListener('click', () => grid.goTo(grid.page + 1));
$('undo').addEventListener('click', () => { if (!grid.undo()) toast(tr('Nichts rückgängig zu machen')); });
$('more-passes').addEventListener('click', () => {
  extrasOn = !extrasOn;
  writeJson(EXTRA_KEY, extrasOn);
  grid.setSlots(buildSlots());
  if (extrasOn) {
    grid.goToKey(BASE_CELLS);
    toast(tr('Noch fünfmal alles, freiwillig'));
  }
  updateProgress();
  updatePageInfo();
});
// Wer gerade eben selbst geschrieben hat, will beim Setzen die eigene Schrift sehen.
$('to-compose').addEventListener('click', () => {
  if (filledCount(store.profile) && settings.hand !== 'own') chooseHand('own');
});

// Tasten: Strg/Cmd+Z macht rückgängig, Pfeile blättern. Nicht beim Tippen im Textfeld.
document.addEventListener('keydown', (e) => {
  if ($('view-schreiben').hidden || e.target.closest('input, textarea, [contenteditable]')) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (!grid.undo()) toast(tr('Nichts rückgängig zu machen'));
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    grid.goTo(grid.page + (e.key === 'ArrowRight' ? 1 : -1));
  }
});

$('export-profile').addEventListener('click', async () => {
  const json = JSON.stringify({ ...createProfile(), cells: store.profile.cells, custom: store.profile.custom });
  try {
    await saveFile(`${tr('Handschrift-Profil')}.json`, new TextEncoder().encode(json));
    toast(tr('Gesichert'));
  } catch (e) {
    if (e?.code !== 'declined') toast(e?.message ?? tr('Sichern fehlgeschlagen'));
  }
});

$('import-profile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const profile = parseProfile(await readFileText(file));
    replaceProfile(profile, tr('{n} Felder geladen', { n: filledCount(profile) }));
    grid.goToFirstEmpty();
  } catch (err) {
    toast(err.message || tr('Datei nicht lesbar'));
  }
});

// Mitnehmen: Link mit Handschrift, Text und Einstellungen für ein anderes Gerät.
// Der Link liegt schon bereit (scheduleOutput), damit Teilen-Menü bzw.
// Zwischenablage noch als Folge des Tippens gelten.
let shareLink = null;
$('share-profile').addEventListener('click', async () => {
  if (!filledCount(store.profile)) { toast(tr('Noch nichts geschrieben')); return; }
  try {
    const url = shareLink ?? await currentShareLink();
    if (isTouch() && navigator.share) {
      await navigator.share({ title: tr('Meine Handschrift'), url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast(tr('Link kopiert: auf dem anderen Gerät öffnen'));
  } catch (e) {
    if (e?.name !== 'AbortError') toast(tr('Link ging nicht, „Sichern“ geht immer'));
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
  btn.textContent = tr('Alles löschen');
  btn.addEventListener('click', askClear);
  area.append(btn);
}

function askClear() {
  const area = $('clear-area');
  area.replaceChildren();
  const q = document.createElement('span');
  q.className = 'mono';
  q.textContent = tr('Alle Felder löschen?');
  const yes = document.createElement('button');
  yes.className = 'btn btn-danger';
  yes.type = 'button';
  yes.textContent = tr('Löschen');
  yes.addEventListener('click', () => {
    replaceProfile(createProfile(), tr('Gelöscht'));
    grid.goTo(0);
    resetClearArea();
  });
  const no = document.createElement('button');
  no.className = 'btn btn-text';
  no.type = 'button';
  no.textContent = tr('Abbrechen');
  no.addEventListener('click', resetClearArea);
  area.append(q, yes, no);
  no.focus();
}
$('clear-all').addEventListener('click', askClear);

// ---------- Schritt 2: Setzen ----------

// hand: 'own' = eigene Handschrift, sonst die Id einer fertigen (presets.js).
// ink: Name aus INKS oder eine eigene Farbe als "#rrggbb".
const DEFAULT_SETTINGS = {
  format: 'a4', paper: 'lined', ink: 'blau', size: 3.2, lines: 9, letters: 0.18, words: 0.9, natural: 0.5, pen: 0.35, seed: 1, hand: 'own',
};
const settings = { ...DEFAULT_SETTINGS, ...cleanSettings(readJson(SETTINGS_KEY)) };
let currentLayout = null;
let sheetPage = 0;
let prepared = null; // fertige .goodnotes-Dateien zum aktuellen Satz

// ----- Handschrift: eigene oder fertige -----

let presetFonts = null; // Daten der fertigen Handschriften, erst bei Bedarf geladen
let fontsFailed = false;
const presetTables = new Map();
let ownTable = null; // zwischengespeichert, bis sich an der eigenen Schrift etwas ändert

function needFonts() {
  if (presetFonts || fontsFailed) return;
  loadFonts().then((fonts) => {
    presetFonts = fonts;
    renderHands();
    scheduleCompose();
  }).catch(() => {
    fontsFailed = true;
    if (settings.hand !== 'own') chooseHand('own');
    toast(tr('Fertige Handschriften ließen sich nicht laden. Ist das Netz da?'));
  });
}

function ownChanged() {
  ownTable = null;
  renderOwnSample();
  scheduleCompose();
}

// Glyphen-Tabelle der gewählten Handschrift; null, solange die fertigen noch laden.
function activeTable() {
  const preset = presetById(settings.hand);
  if (!preset) return { table: (ownTable ??= glyphTable(store.profile)), preset: null };
  if (!presetFonts) { needFonts(); return null; }
  if (!presetTables.has(preset.id)) presetTables.set(preset.id, glyphTable(presetProfile(preset.id, presetFonts), { snap: 0 }));
  return { table: presetTables.get(preset.id), preset };
}

// Satz-Einstellungen; fertige Handschriften setzen nach ihren Vorschüben (presets.js).
function layoutOptions(preset, overrides = {}) {
  return {
    format: FORMATS[settings.format],
    xHeightMm: settings.size,
    lineSpacingMm: settings.lines,
    letterSpacing: settings.letters + (preset?.spacing ?? 0),
    minGap: preset ? -0.06 : 0.02,
    wordSpacing: settings.words,
    natural: settings.natural,
    penWidthMm: settings.pen,
    seed: settings.seed,
    ...overrides,
  };
}

const presetName = (id) => tr({ cursive: 'Schreibschrift', elegant: 'Elegant', quill: 'Feder', print: 'Druckschrift', playful: 'Verspielt' }[id]);

// Ein Wort in einer Handschrift als SVG-Pfad (für die Auswahl). Nutzt denselben Satz wie die Seite.
function drawSample(svg, table, word, preset) {
  const layout = layoutText(word, table, layoutOptions(preset, {
    format: { width: 4000, height: 400, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
    xHeightMm: 3, lineSpacingMm: 30, natural: 0.25, penWidthMm: 0.45, seed: 7, letterSpacing: 0.18 + (preset?.spacing ?? 0),
  }));
  const strokes = layout.pages[0].strokes;
  if (!strokes.length) { svg.replaceChildren(); return false; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let d = '';
  for (const st of strokes) {
    st.points.forEach(([x, y], i) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    if (st.points.length === 1) d += 'l0.1 0';
  }
  const pad = 3;
  svg.setAttribute('viewBox', `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(maxX - minX + 2 * pad).toFixed(1)} ${(maxY - minY + 2 * pad).toFixed(1)}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.3');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.replaceChildren(path);
  return true;
}

// Auswahl: „Meine“ und die fünf fertigen, jede mit ihrem Namen in der eigenen Schrift.
function renderHands() {
  const wrap = $('hands');
  if (!wrap.children.length) {
    for (const id of ['own', ...PRESETS.map((p) => p.id)]) {
      const label = document.createElement('label');
      label.className = id === 'own' ? 'hand hand-own' : 'hand';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'hand';
      input.value = id;
      const sample = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sample.setAttribute('class', 'hand-sample');
      sample.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'hand-name';
      name.textContent = id === 'own' ? tr('Meine') : presetName(id);
      label.append(input, sample, name);
      wrap.append(label);
    }
  }
  for (const input of wrap.querySelectorAll('input')) input.checked = input.value === settings.hand;
  if (presetFonts) {
    for (const preset of PRESETS) {
      const svg = wrap.querySelector(`input[value="${preset.id}"] ~ .hand-sample`);
      if (!svg.childNodes.length) {
        const table = glyphTable(presetProfile(preset.id, presetFonts), { snap: 0 });
        drawSample(svg, table, presetName(preset.id), preset);
        svg.closest('label').classList.add('has-sample');
      }
    }
  }
  renderOwnSample();
}

// „Meine“ zeigt die eigene Schrift, sobald es dafür genug Zeichen gibt.
function renderOwnSample() {
  const label = $('hands').querySelector('.hand-own');
  if (!label) return;
  const table = ownTable ??= glyphTable(store.profile);
  const word = tr('Meine');
  const ok = [...word].every((c) => table.has(c) || table.has(c.toLowerCase()) || table.has(c.toUpperCase()));
  const drawn = ok && drawSample(label.querySelector('.hand-sample'), table, word, null);
  if (!drawn) label.querySelector('.hand-sample').replaceChildren();
  label.classList.toggle('has-sample', Boolean(drawn));
  label.title = drawn ? '' : tr('Noch nicht geschrieben');
}

function chooseHand(id) {
  settings.hand = presetById(id) ? id : 'own';
  writeJson(SETTINGS_KEY, settings);
  for (const input of $('hands').querySelectorAll('input')) input.checked = input.value === settings.hand;
  if (settings.hand !== 'own') needFonts();
  scheduleCompose();
}

$('hands').addEventListener('change', (e) => { if (e.target.name === 'hand') chooseHand(e.target.value); });
$('empty-preset').addEventListener('click', () => chooseHand(PRESETS[0].id));

// ----- Farben: vier feste, eigene über „+“ -----

// Zuletzt gewählte eigene Farben, neueste zuerst.
const MAX_CUSTOM_INKS = 6;
let customInks = (readJson(INKS_KEY) ?? []).filter(isCustomInk).slice(0, MAX_CUSTOM_INKS);

function inkLabel(ink) {
  return isCustomInk(ink) ? `${tr('Eigene Farbe')} ${ink.toUpperCase()}` : tr(INKS[ink]?.label ?? '');
}

function swatchLabel(value, label, color) {
  const wrap = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'ink';
  input.value = value;
  input.checked = settings.ink === value;
  const dot = document.createElement('span');
  dot.className = 'swatch';
  dot.style.background = color;
  const name = document.createElement('span');
  name.className = 'sr-only';
  name.textContent = label;
  wrap.title = label;
  wrap.append(input, dot, name);
  return wrap;
}

function renderInks() {
  const wrap = $('inks');
  wrap.replaceChildren();
  for (const [key, ink] of Object.entries(INKS)) wrap.append(swatchLabel(key, tr(ink.label), inkHex(key)));
  // Eigene Farben; eine aus einem Link, die hier noch nicht gespeichert ist, steht vorn dazu.
  const mine = isCustomInk(settings.ink) && !customInks.includes(settings.ink) ? [settings.ink, ...customInks] : customInks;
  for (const hex of mine) wrap.append(swatchLabel(hex, inkLabel(hex), hex));
  // „+“: das Farbfeld des Browsers liegt unsichtbar über dem Knopf, ein Tipp öffnet es direkt
  const add = document.createElement('label');
  add.className = 'swatch-add';
  add.title = tr('Eigene Farbe wählen');
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.id = 'ink-picker';
  picker.value = inkHex(settings.ink);
  picker.setAttribute('aria-label', tr('Eigene Farbe wählen'));
  const plus = document.createElement('span');
  plus.className = 'swatch swatch-plus';
  plus.setAttribute('aria-hidden', 'true');
  add.append(picker, plus);
  wrap.append(add);

  // Beim Ziehen im Farbfeld gleich in der Vorschau zeigen, beim Schließen als Farbe merken
  picker.addEventListener('input', (e) => {
    e.stopPropagation(); // sonst liest readControls() die alte Farbe aus den Knöpfen
    setInk(picker.value.toLowerCase());
    for (const input of wrap.querySelectorAll('input[name="ink"]')) input.checked = false;
    add.classList.add('is-picking');
    plus.style.setProperty('--pick', picker.value);
  });
  picker.addEventListener('change', (e) => {
    e.stopPropagation();
    const hex = picker.value.toLowerCase();
    customInks = [hex, ...customInks.filter((c) => c !== hex)].slice(0, MAX_CUSTOM_INKS);
    writeJson(INKS_KEY, customInks);
    setInk(hex);
    renderInks();
    wrap.querySelector(`input[name="ink"][value="${hex}"]`)?.focus({ preventScroll: true });
  });
}

function setInk(ink) {
  settings.ink = ink;
  $('ink-name').textContent = inkLabel(ink);
  writeJson(SETTINGS_KEY, settings);
  scheduleCompose();
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
  for (const name of ['format', 'paper']) {
    const input = document.querySelector(`input[name="${name}"][value="${settings[name]}"]`);
    if (input) input.checked = true;
  }
  renderInks();
  renderHands();
  $('ink-name').textContent = inkLabel(settings.ink);
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
  $('ink-name').textContent = inkLabel(settings.ink);
  writeJson(SETTINGS_KEY, settings);
}

// Nur bekannte Einstellungen mit passendem Typ übernehmen (aus Speicher oder Link).
function cleanSettings(s) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = s?.[k];
    if (typeof v === typeof def && (typeof def !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  if (!INKS[out.ink] && !isCustomInk(out.ink)) delete out.ink;
  if (typeof out.ink === 'string') out.ink = out.ink.toLowerCase();
  if (!FORMATS[out.format] || !PAGE_FORMATS[out.format]) delete out.format;
  if (!['lined', 'grid', 'blank'].includes(out.paper)) delete out.paper;
  if (out.hand !== 'own' && !presetById(out.hand)) delete out.hand;
  return out;
}

let composeQueued = false;
function scheduleCompose() {
  if (composeQueued) return;
  composeQueued = true;
  requestAnimationFrame(() => { composeQueued = false; compose(); });
}

function compose() {
  const active = activeTable();
  if (!active) return; // fertige Handschrift lädt noch; danach kommt compose() wieder
  const { table, preset } = active;
  const empty = table.size === 0;
  $('compose-empty').hidden = !empty;
  $('compose').hidden = empty;
  if (empty) { currentLayout = null; shareLink = null; return; }

  currentLayout = layoutText($('text').value, table, layoutOptions(preset));
  sheetPage = Math.min(sheetPage, currentLayout.pages.length - 1);
  renderSheet();

  // Fehlende Zeichen lassen sich nur in der eigenen Handschrift nachschreiben.
  const missing = currentLayout.missing;
  $('missing').hidden = missing.length === 0;
  $('missing-chars').textContent = missing.length ? tr('Fehlt: {chars}', { chars: missing.join(' ') }) : '';
  $('missing').classList.toggle('is-static', Boolean(preset));
  $('missing').title = preset ? tr('Diese Handschrift hat das Zeichen nicht') : tr('Fehlende Zeichen jetzt schreiben');
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
    paper: settings.paper, ink: inkRgb(settings.ink), layout: currentLayout,
  });
  $('sheet-info').textContent = `${sheetPage + 1}/${pages.length}`;
  $('page-prev').disabled = sheetPage === 0;
  $('page-next').disabled = sheetPage >= pages.length - 1;
}

// Ein Satz unter den Knöpfen: wie die Datei in GoodNotes kommt.
function updateGoodNotesNote() {
  const parts = [isTouch() ? tr('Im Teilen-Menü GoodNotes wählen.') : tr('Lädt die .goodnotes-Datei herunter.')];
  if (currentLayout?.pages.length > 1) parts.push(tr('Eine Datei pro Seite.'));
  if (!PAGE_FORMATS[settings.format].tested) parts.push(tr('A4 ist Beta.'));
  $('goodnotes-note').textContent = parts.join(' ');
}

function thumbnail(page) {
  const canvas = document.createElement('canvas');
  const pxPerPt = 360 / page.width;
  canvas.width = 360;
  canvas.height = Math.round(page.height * pxPerPt);
  drawPage(canvas.getContext('2d'), page, pxPerPt, {
    paper: settings.paper, ink: inkRgb(settings.ink), layout: currentLayout,
  });
  return fromBase64(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
}

function buildGoodNotes() {
  const files = pagesToGoodNotes(currentLayout.pages, {
    format: settings.format, paper: settings.paper, ink: inkRgb(settings.ink), layout: currentLayout, thumbnail,
  });
  const base = fileBase();
  const names = files.map((_, i) => (files.length > 1 ? `${base} (${tr('Seite')} ${i + 1}).goodnotes` : `${base}.goodnotes`));
  return { layout: currentLayout, files, names };
}

async function exportGoodNotes() {
  if (!currentLayout) return;
  // Vorbereitete Dateien nehmen: das Teilen-Menü muss kurz nach dem Tippen aufgehen.
  const { files, names } = prepared?.layout === currentLayout ? prepared : buildGoodNotes();
  try {
    await saveFiles(files.map((bytes, i) => ({ name: names[i], bytes })));
    $('goodnotes-result').hidden = true;
    toast(files.length > 1 ? tr('{n} Dateien gespeichert', { n: files.length }) : tr('Gespeichert'));
  } catch (e) {
    if (e?.code !== 'declined') toast(e?.message ?? tr('Speichern fehlgeschlagen'));
  }
}

async function exportPdf() {
  if (!currentLayout) return;
  const pdf = pagesToPdf(currentLayout.pages, { paper: settings.paper, ink: inkRgb(settings.ink), layout: currentLayout });
  try {
    await saveFile(`${fileBase()}.pdf`, pdf);
    toast(tr('PDF gespeichert'));
  } catch (e) {
    if (e?.code !== 'declined') toast(e?.message ?? tr('Speichern fehlgeschlagen'));
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
  $('text-clear').textContent = clearedText === null ? tr('Leeren') : tr('Zurückholen');
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
  if (presetById(settings.hand)) { toast(tr('Diese Handschrift hat das Zeichen nicht')); return; }
  const targets = [];
  for (const char of currentLayout?.missing ?? []) {
    if (CELL_CHARS.includes(char)) {
      const i = CELL_CHARS.indexOf(char);
      shownOptional.add(i); // auch ein freiwilliges Kästchen (Umlaut auf Englisch) bekommt Platz
      targets.push(i);
    } else if (isCustomChar(char)) {
      if (!customChars.includes(char)) customChars.push(char);
      targets.push(char);
    }
  }
  if (!targets.length) { toast(tr('Dieses Zeichen lässt sich nicht schreiben')); return; }
  grid.setSlots(buildSlots());
  location.hash = `#${HASH.schreiben}`;
  showView();
  grid.goToKey(targets[0]);
  // Auf schmalen Bildschirmen liegt das Kästchen sonst unten unter der Meldung.
  setTimeout(() => $('grid').querySelector('.cell.next')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  toast(tr('Hier schreiben, dann zurück zum Setzen'));
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
  history.replaceState(null, '', `${location.pathname}${location.search}#${HASH.setzen}`);
  try {
    const data = await readHandoff(hash);
    if (!data) throw new Error(tr('Der Link ist unvollständig. Am besten neu erzeugen und ganz kopieren.'));
    const had = filledCount(store.profile) > 0;
    replaceProfile({ ...createProfile(), cells: data.cells, custom: data.custom }, had ? tr('Bisherige Handschrift ersetzt') : null);
    Object.assign(settings, cleanSettings(data.settings));
    writeJson(SETTINGS_KEY, settings);
    $('text').value = data.text;
    writeJson(TEXT_KEY, data.text);
    updateTextClear();
    syncControls();
    if (settings.hand !== 'own') needFonts();
    showView();
    updateProgress();
    showResult('ok', tr('Handschrift übernommen ({n} Felder). Sie ersetzt die bisherige auf diesem Gerät.', { n: filledCount(store.profile) }));
  } catch (e) {
    showView();
    showResult('error', e?.message || tr('Der Link ließ sich nicht lesen.'));
  }
}

// ---------- Ansichten ----------

function showView() {
  let view = VIEW_OF[location.hash.slice(1)] ?? location.hash.slice(1);
  if (view.startsWith('gn')) view = 'setzen';
  if (view !== 'schreiben' && view !== 'setzen') view = basisCount() >= REQUIRED.length ? 'setzen' : 'schreiben';
  $('view-schreiben').hidden = view !== 'schreiben';
  $('view-setzen').hidden = view !== 'setzen';
  for (const a of document.querySelectorAll('.step')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (view === 'schreiben') { layoutGrid(); grid.render(); }
  else { needFonts(); scheduleCompose(); }
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

// ?hand=cursive (z. B. von der Startseite): gleich mit einer fertigen Handschrift setzen.
const wanted = new URLSearchParams(location.search).get('hand');
if (wanted) {
  if (presetById(wanted) || wanted === 'own') {
    settings.hand = wanted;
    writeJson(SETTINGS_KEY, settings);
  }
  history.replaceState(null, '', `${location.pathname}${location.hash || `#${HASH.setzen}`}`);
}

$('text').value = readJson(TEXT_KEY) ?? EXAMPLE_TEXT;
updateTextClear();
syncControls();
applyGridColors();
document.fonts.ready.then(applyGridColors); // Vorlagen-Zeichen erst mit geladener Schrift richtig
resetSlots();
grid.goToFirstEmpty();
showView();
updateProgress();
updatePageInfo();
cloud.start();
receiveHandoff();
if (settings.hand !== 'own') needFonts();
document.documentElement.dataset.ready = '1'; // sonst zeigt die Seite nach kurzer Zeit „Neu laden“
