// Speichert das Profil im Browser (localStorage). Zwischen Geräten wandert es
// als Profildatei (Sichern/Laden) oder als Mitnehmen-Link (handoff.js).

import { createProfile } from './profile.js';

const LOCAL_KEY = 'handschrift.profile.v1';

// Kompakt als Text: Punkte "x,y" mit Leerzeichen, Striche mit "|" getrennt.
function encodeStrokes(strokes) {
  return strokes.map((s) => s.map(([x, y]) => `${x},${y}`).join(' ')).join('|');
}

function decodeStrokes(text) {
  if (!text) return [];
  return text.split('|').map((s) => s.split(' ').map((p) => p.split(',').map(Number)))
    .map((s) => s.filter((p) => p.length === 2 && p.every(Number.isFinite)))
    .filter((s) => s.length);
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const profile = createProfile();
    for (const [k, v] of Object.entries(data.cells ?? {})) {
      const strokes = decodeStrokes(v);
      if (strokes.length) profile.cells[k] = strokes;
    }
    return profile;
  } catch {
    return null;
  }
}

class ProfileStore {
  /** @param {object} hooks  onStatus('saved' | 'error') nach jedem Speichern */
  constructor({ onStatus } = {}) {
    this.profile = readLocal() ?? createProfile();
    this.onStatus = onStatus ?? (() => {});
  }

  getCell(i) { return this.profile.cells[i]; }

  setCell(i, strokes) {
    if (strokes?.length) this.profile.cells[i] = strokes;
    else delete this.profile.cells[i];
    this.save();
  }

  replaceAll(profile) {
    this.profile = { ...createProfile(), cells: { ...profile.cells } };
    this.save();
  }

  save() {
    try {
      const cells = {};
      for (const [k, v] of Object.entries(this.profile.cells)) cells[k] = encodeStrokes(v);
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ cells }));
      this.onStatus('saved');
    } catch {
      // Speicher voll oder gesperrt (privates Fenster): dann hilft nur Sichern.
      this.onStatus('error');
    }
  }
}

export { encodeStrokes, decodeStrokes, ProfileStore };
