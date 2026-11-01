// Abgleich der Handschrift mit einer Kopie woanders (Google Drive, siehe drive.js).
// Ohne Zeitstempel: verglichen wird der Inhalt. `base` ist der Fingerabdruck des
// Stands beim letzten Abgleich auf diesem Gerät; daran sieht man, welche Seite
// sich seitdem geändert hat.
//
// Grundsatz: Was auf diesem Gerät liegt, geht beim ersten Abgleich nie verloren.
// Liegt in der Kopie schon etwas, füllt es nur leere Kästchen auf.

import { createProfile, parseProfile } from './profile.js';
import { encodeStrokes, decodeStrokes } from './store.js';

const byNumber = (a, b) => Number(a) - Number(b);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Immer gleich aufgebauter Text zu einem Profil: gleiche Striche, gleicher Text.
function serialize(profile) {
  const cells = {};
  for (const k of Object.keys(profile.cells).sort(byNumber)) cells[k] = encodeStrokes(profile.cells[k]);
  const custom = {};
  for (const c of Object.keys(profile.custom ?? {}).sort(byText)) custom[c] = encodeStrokes(profile.custom[c]);
  return JSON.stringify({ app: 'handschrift', v: 1, cells, custom });
}

// Liest den Text der Kopie. Wirft bei fremden oder kaputten Dateien.
function deserialize(text) {
  const data = JSON.parse(text);
  if (data?.app !== 'handschrift' || data.v !== 1) throw new Error('Die Kopie in Google Drive ist nicht lesbar.');
  const decode = (obj) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, decodeStrokes(v)]));
  return parseProfile({ app: 'handschrift', version: 1, cells: decode(data.cells), custom: decode(data.custom) });
}

// cyrb53: kurzer Fingerabdruck, reicht zum Erkennen von Änderungen.
function fingerprint(profile) {
  const text = serialize(profile);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const isEmpty = (profile) => !Object.keys(profile.cells).length && !Object.keys(profile.custom ?? {}).length;

// Beide zusammen; bei Kästchen, die auf beiden Seiten beschrieben sind, gewinnt `keep`.
function mergeProfiles(keep, fill) {
  return {
    ...createProfile(),
    cells: { ...fill.cells, ...keep.cells },
    custom: { ...fill.custom, ...keep.custom },
  };
}

/**
 * Ein Abgleich.
 * @param {object} o
 * @param {object} o.local   Profil auf diesem Gerät
 * @param {string|null} o.base  Fingerabdruck beim letzten Abgleich, null = noch nie
 * @param {{read: () => Promise<string|null>, write: (text: string) => Promise<void>}} o.remote
 * @returns {Promise<{profile: object|null, base: string, action: string}>}
 *   profile: neues Profil für dieses Gerät oder null, wenn es bleibt, wie es ist.
 *   action: 'same' | 'upload' | 'download' | 'merge'
 */
async function syncProfile({ local, base, remote }) {
  const text = await remote.read();
  const theirs = text === null ? null : deserialize(text);
  const mine = fingerprint(local);

  if (!theirs) {
    // Noch keine Kopie: anlegen, sobald es etwas zu sichern gibt.
    if (isEmpty(local)) return { profile: null, base: mine, action: 'same' };
    await remote.write(serialize(local));
    return { profile: null, base: mine, action: 'upload' };
  }

  const their = fingerprint(theirs);
  if (their === mine) return { profile: null, base: mine, action: 'same' };
  // Nur die Kopie hat sich geändert (auch: alles gelöscht auf dem anderen Gerät).
  if (base !== null && mine === base) return { profile: theirs, base: their, action: 'download' };
  // Nur dieses Gerät hat sich geändert.
  if (base !== null && their === base) {
    await remote.write(serialize(local));
    return { profile: null, base: mine, action: 'upload' };
  }
  // Erster Abgleich auf diesem Gerät oder beide Seiten geändert: zusammenlegen,
  // dieses Gerät gewinnt bei Kästchen, die auf beiden Seiten beschrieben sind.
  const merged = mergeProfiles(local, theirs);
  const both = fingerprint(merged);
  if (both !== their) await remote.write(serialize(merged));
  if (both === mine) return { profile: null, base: both, action: 'upload' };
  return { profile: merged, base: both, action: isEmpty(local) ? 'download' : 'merge' };
}

export { serialize, deserialize, fingerprint, mergeProfiles, syncProfile };
