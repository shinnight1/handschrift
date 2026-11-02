// Fertige Handschriften: fünf Einstrich-Schriften (presets-data.js), aufbereitet wie eine
// selbst geschriebene Handschrift. Jedes Zeichen bekommt so viele Varianten, wie es in der
// eigenen Handschrift Kästchen hat (2–4), jede ein wenig anders verzogen, damit kein Wort
// gestempelt aussieht. Ergebnis ist ein Profil {cells, custom} wie in profile.js: Satz,
// Vorschau, PDF und .goodnotes behandeln es wie die eigene Schrift, also radierbar.

import { CELL_CHARS, BASE_CELLS } from './charset.js';
import { rng } from './random.js';
import { round4 } from './geometry.js';

// Reihenfolge wie in der App. Die Schriften setzen nach ihren eigenen Vorschüben; spacing
// gleicht den Buchstabenabstand der Einstellungen aus (Standard 18 % der x-Höhe), damit die
// Schreibschriften beim Standardwert verbunden bleiben. warp: wie stark Varianten abweichen.
const PRESETS = [
  { id: 'cursive', spacing: -0.18, warp: 0.7 },
  { id: 'elegant', spacing: -0.18, warp: 0.7 },
  { id: 'quill', spacing: -0.13, warp: 0.9 },
  { id: 'print', spacing: -0.12, warp: 1 },
  { id: 'playful', spacing: -0.12, warp: 0.9 },
];
const presetById = (id) => PRESETS.find((p) => p.id === id) ?? null;

let fontsPromise = null;
const loadFonts = () => (fontsPromise ??= import('./presets-data.js').then((m) => m.FONTS));

// "Vorschub;Striche" → {adv, strokes} in Glyphen-Einheiten (Format: tools/build-presets.mjs)
function decode(text) {
  const [adv, path] = text.split(';');
  const strokes = path.split('|').map((s) => {
    let x = 0;
    let y = 0;
    return s.split(' ').map((p, j) => {
      const [a, b] = p.split(',').map(Number);
      x = j ? x + a : a;
      y = j ? y + b : b;
      return [x / 1000, y / 1000];
    });
  });
  return { adv: Number(adv) / 1000, strokes };
}

// Eine Variante: leicht andere Breite, Höhe und Neigung, dazu eine weiche Verformung, die
// Bögen ein wenig weiter oder enger macht. Gleicher Startwert, gleiche Variante.
function vary({ adv, strokes }, seed, amount) {
  const r = rng(seed);
  const sx = 1 + 0.04 * amount * r.gauss();
  const sy = 1 + 0.035 * amount * r.gauss();
  const slant = 0.06 * amount * r.gauss();
  const waves = Array.from({ length: 2 }, () => ({
    ax: 0.005 * amount * r.gauss(), ay: 0.005 * amount * r.gauss(),
    fx: r.range(9, 20), fy: r.range(9, 20), px: r.range(0, 2 * Math.PI), py: r.range(0, 2 * Math.PI),
  }));
  return {
    adv: round4(adv * sx),
    strokes: strokes.map((s) => s.map(([x, y]) => {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        dx += w.ax * Math.sin(w.fy * y + w.px);
        dy += w.ay * Math.sin(w.fx * x + w.py);
      }
      return [round4(x * sx - slant * y + dx), round4(y * sy + dy)];
    })),
  };
}

// „§“ fehlt allen fünf Vorlagen. Es ist aus zwei übereinandergesetzten S entstanden; so wird
// es auch hier gebaut: das große S auf x-Höhe verkleinert (das kleine hat in Schreibschriften
// Anschlussstriche), einmal angehoben, einmal abgesenkt, in der Mitte überlappend.
function section(S, s) {
  const top = (g) => -Math.min(...g.strokes.flat().map(([, y]) => y));
  const k = top(s) / top(S);
  const h = top(s);
  const shifted = (dy) => S.strokes.map((st) => st.map(([x, y]) => [round4(x * k), round4(y * k + dy)]));
  return { adv: round4(S.adv * k), strokes: [...shifted(-0.62 * h), ...shifted(0.3 * h)] };
}

const cache = new Map();

// Profil einer fertigen Handschrift. Die Kästchen 0 … BASE_CELLS-1 bekommen das Zeichen ihrer
// Stelle, das erste Vorkommen unverändert, jedes weitere als Variante. Zeichen außerhalb der
// festen Liste (é, ñ, $, # …) stehen unter custom. advance: Vorschub je Kästchen bzw. Zeichen,
// glyphTable() setzt danach statt nach dem Umriss der Striche.
function presetProfile(id, fonts) {
  if (cache.has(id)) return cache.get(id);
  const preset = presetById(id);
  const glyphs = fonts?.[id];
  if (!preset || !glyphs) return null;
  const base = new Map();
  const get = (ch) => {
    if (!base.has(ch)) base.set(ch, glyphs[ch] ? decode(glyphs[ch]) : null);
    return base.get(ch);
  };
  const profile = { cells: {}, custom: {}, advance: { cells: {}, custom: {} } };
  const seen = new Map();
  for (let i = 0; i < BASE_CELLS; i++) {
    const ch = CELL_CHARS[i];
    const glyph = get(ch);
    if (!glyph) continue;
    const n = seen.get(ch) ?? 0;
    seen.set(ch, n + 1);
    const g = n ? vary(glyph, (PRESETS.indexOf(preset) + 1) * 7919 + i * 104729, preset.warp) : glyph;
    profile.cells[i] = g.strokes;
    profile.advance.cells[i] = g.adv;
  }
  for (const ch of Object.keys(glyphs)) {
    if (CELL_CHARS.includes(ch)) continue;
    const g = get(ch);
    profile.custom[ch] = g.strokes;
    profile.advance.custom[ch] = g.adv;
  }
  if (!profile.custom['§'] && get('S') && get('s')) {
    const g = section(get('S'), get('s'));
    profile.custom['§'] = g.strokes;
    profile.advance.custom['§'] = g.adv;
  }
  cache.set(id, profile);
  return profile;
}

export { PRESETS, presetById, loadFonts, presetProfile, vary };
