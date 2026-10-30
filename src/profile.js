// Handschrift-Profil: die gezeichneten Striche je Kästchen, plus abgeleitete
// Glyphen-Tabelle mit Maßen. Zeichen außerhalb der festen Liste (z. B. "*")
// liegen unter `custom`, mit dem Zeichen selbst als Schlüssel.

import { CELL_CHARS, SITS_ON_BASELINE, X_HEIGHT_CHARS, GUIDES, isCustomChar } from './charset.js';

const PROFILE_VERSION = 1;

function createProfile() {
  return { version: PROFILE_VERSION, app: 'handschrift', created: new Date().toISOString(), cells: {}, custom: {} };
}

function cleanStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  return strokes
    .filter((s) => Array.isArray(s))
    .map((s) => s.filter((p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)).map(([x, y]) => [x, y]))
    .filter((s) => s.length > 0);
}

// Prüft eine geladene Profil-Datei und gibt ein sauberes Profil zurück.
function parseProfile(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.app !== 'handschrift' || typeof data.cells !== 'object') {
    throw new Error('Das ist keine Handschrift-Profildatei.');
  }
  if (data.version > PROFILE_VERSION) throw new Error('Die Profildatei ist von einer neueren Version.');
  const cells = {};
  for (const [key, strokes] of Object.entries(data.cells)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= CELL_CHARS.length) continue;
    const clean = cleanStrokes(strokes);
    if (clean.length) cells[index] = clean;
  }
  const custom = {};
  for (const [char, strokes] of Object.entries(data.custom ?? {})) {
    const clean = isCustomChar(char) ? cleanStrokes(strokes) : [];
    if (clean.length) custom[char] = clean;
  }
  return { ...createProfile(), created: data.created ?? null, cells, custom };
}

const filledCount = (profile) => Object.keys(profile.cells).length + Object.keys(profile.custom ?? {}).length;

function bbox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Zeichen → Liste von Varianten {strokes, minX, maxX, minY, maxY, shift}.
// shift verschiebt die Glyphe senkrecht, damit sie auf der Grundlinie sitzt.
function glyphTable(profile, { snap = 0.8 } = {}) {
  const table = new Map();
  for (const [key, strokes] of Object.entries(profile.cells)) {
    if (!strokes.length) continue;
    const char = CELL_CHARS[Number(key)];
    const box = bbox(strokes);
    const shift = SITS_ON_BASELINE.has(char) ? -box.maxY * snap : 0;
    const variant = { char, cell: Number(key), strokes, ...box, shift };
    if (!table.has(char)) table.set(char, []);
    table.get(char).push(variant);
  }
  // Eigene Zeichen stehen so, wie sie im Kästchen geschrieben wurden.
  for (const [char, strokes] of Object.entries(profile.custom ?? {})) {
    if (strokes.length) table.set(char, [{ char, cell: char, strokes, ...bbox(strokes), shift: 0 }]);
  }
  return table;
}

// Gemessene x-Höhe in Glyphen-Einheiten (Höhe über der Grundlinie nach dem Ausrichten).
function measureXHeight(table) {
  const heights = [];
  for (const [char, variants] of table) {
    if (!X_HEIGHT_CHARS.has(char)) continue;
    for (const v of variants) heights.push(-(v.minY + v.shift));
  }
  const m = median(heights.filter((h) => h > 0.02));
  return m ?? GUIDES.baseline - GUIDES.xline;
}

export { PROFILE_VERSION, createProfile, parseProfile, filledCount, glyphTable, measureXHeight };
