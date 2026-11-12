// Satz-Einstellungen, die App und Agenten-Werkzeug (agent/) teilen: Standardwerte,
// Prüfung von außen kommender Einstellungen, Optionen für layoutText(), Dateiname.
// Hier und nicht in app.js, damit eine Datei von einem KI-Agenten genauso aussieht
// wie eine aus der App.

import { FORMATS } from './layout.js';
import { INKS, PAPERS, RULINGS, isCustomInk } from './render.js';
import { PAGE_FORMATS } from './goodnotes/writer.js';
import { presetById } from './presets.js';

// hand: 'own' = eigene Handschrift, sonst die Id einer fertigen (presets.js).
// ink: Name aus INKS oder eine eigene Farbe als "#rrggbb".
// format: a3, a4, a5 oder standard (GoodNotes' eigene Seitengröße).
// paper: lined (liniert breit), narrow (liniert schmal), grid, blank. Bei liniertem Papier
// gibt das Papier den Zeilenabstand vor; lines gilt für kariert und leer.
const DEFAULT_SETTINGS = {
  format: 'a4', paper: 'lined', ink: 'blau', size: 3.2, lines: 9, letters: 0.18, words: 0.9, natural: 0.5, pen: 0.35, seed: 1, hand: 'own',
};

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
  if (!PAPERS[out.paper]) delete out.paper;
  if (out.hand !== 'own' && !presetById(out.hand)) delete out.hand;
  return out;
}

// Andere Namen, die Menschen und KI-Agenten für dieselben Werte benutzen.
const ALIASES = {
  paper: {
    liniert: 'lined', ruled: 'lined', breit: 'lined', wide: 'lined', 'liniert-breit': 'lined', 'wide-ruled': 'lined', 'ruled-wide': 'lined',
    schmal: 'narrow', eng: 'narrow', 'liniert-schmal': 'narrow', 'narrow-ruled': 'narrow', 'ruled-narrow': 'narrow',
    kariert: 'grid', squared: 'grid', karo: 'grid', blanko: 'blank', plain: 'blank', leer: 'blank',
  },
  ink: {
    black: 'schwarz', blue: 'blau', ballpoint: 'blau', kuli: 'blau', 'kuli-blau': 'blau',
    darkblue: 'dunkelblau', navy: 'dunkelblau', ink: 'dunkelblau', tinte: 'dunkelblau',
    pencil: 'grau', bleistift: 'grau', gray: 'grau', grey: 'grau',
  },
  format: { goodnotes: 'standard', 'din-a3': 'a3', 'din-a4': 'a4', 'din-a5': 'a5', dina3: 'a3', dina4: 'a4', dina5: 'a5' },
  hand: { mine: 'own', meine: 'own', eigene: 'own' },
};

/**
 * Wählbare Einstellungen aus Text-Werten, wie sie in Links und Werkzeug-Aufrufen ankommen:
 * hand, paper, ink, format. Leere Werte zählen als nicht angegeben.
 * @returns {{settings: object, invalid: string[]}} invalid: Namen mit unbrauchbarem Wert
 */
function pickSettings(input = {}) {
  const settings = {};
  const invalid = [];
  for (const key of ['hand', 'paper', 'ink', 'format']) {
    const raw = input[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    let v = String(raw).trim().toLowerCase();
    v = ALIASES[key][v] ?? v;
    if (key === 'ink' && /^[0-9a-f]{6}$/.test(v)) v = `#${v}`;
    const clean = cleanSettings({ [key]: v });
    if (key in clean) settings[key] = clean[key];
    else invalid.push(key);
  }
  return { settings, invalid };
}

// Zeilenabstand: bei liniertem Papier der Linienabstand, sonst der eingestellte.
const lineSpacing = (settings) => RULINGS[settings.paper] ?? settings.lines;

// Satz-Optionen; fertige Handschriften setzen nach ihren Vorschüben (presets.js).
function layoutOptions(settings, preset, overrides = {}) {
  return {
    format: FORMATS[settings.format],
    xHeightMm: settings.size,
    lineSpacingMm: lineSpacing(settings),
    letterSpacing: settings.letters + (preset?.spacing ?? 0),
    minGap: preset ? -0.06 : 0.02,
    wordSpacing: settings.words,
    natural: settings.natural,
    penWidthMm: settings.pen,
    seed: settings.seed,
    ...overrides,
  };
}

// Dateiname aus den ersten Wörtern, nur ASCII: manche Browser verwerfen
// Download-Namen mit Sonderzeichen und nennen die Datei dann "download".
function fileBase(text, name) {
  const words = String(text).trim().split(/\s+/).slice(0, 3).join(' ')
    .replace(/[äöüÄÖÜß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' })[c])
    .normalize('NFD').replace(/[^A-Za-z0-9 _-]/g, '').trim();
  return words ? `${name} - ${words}` : name;
}

export { DEFAULT_SETTINGS, cleanSettings, pickSettings, lineSpacing, layoutOptions, fileBase };
