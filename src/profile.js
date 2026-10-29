// Handschrift-Profil: die gezeichneten Striche je Kästchen, plus abgeleitete
// Glyphen-Tabelle mit Maßen.

import { CELL_CHARS, SITS_ON_BASELINE, X_HEIGHT_CHARS, GUIDES } from './charset.js';

const PROFILE_VERSION = 1;

function createProfile() {
  return { version: PROFILE_VERSION, app: 'handschrift', created: new Date().toISOString(), cells: {} };
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
    if (!Number.isInteger(index) || index < 0 || index >= CELL_CHARS.length || !Array.isArray(strokes)) continue;
    const clean = strokes
      .filter((s) => Array.isArray(s))
      .map((s) => s.filter((p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)).map(([x, y]) => [x, y]))
      .filter((s) => s.length > 0);
    if (clean.length) cells[index] = clean;
  }
  return { ...createProfile(), created: data.created ?? null, cells };
}

const filledCount = (profile) => Object.keys(profile.cells).length;

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
