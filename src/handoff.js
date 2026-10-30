// Mitnehmen-Link: Profil, Text und Einstellungen reisen komprimiert im Teil
// nach "#" zu einem anderen Gerät. Den Teil schickt der Browser nie an den
// Server. Das Handschrift-Artifact auf claude.ai erzeugt dieselben Links
// (Format v1), deshalb muss das Format zu ihm passen. Eigene Zeichen stehen
// im zusätzlichen Feld "u", das ältere Leser übergehen.

import { CELL_CHARS, isCustomChar } from './charset.js';
import { utf8, fromUtf8, fromBase64 } from './goodnotes/bytes.js';

const Q = 10000; // Koordinaten in Zehntausendsteln, so genau wie gespeichert
const canCompress = typeof CompressionStream === 'function';

// "dx,dy dx,dy|…" — ganze Zahlen, je Punkt der Abstand zum vorigen.
function packStrokes(strokes) {
  return strokes.map((st) => {
    let px = 0;
    let py = 0;
    return st.map(([x, y]) => {
      const X = Math.round(x * Q);
      const Y = Math.round(y * Q);
      const r = `${X - px},${Y - py}`;
      px = X;
      py = Y;
      return r;
    }).join(' ');
  }).join('|');
}

function unpackStrokes(text) {
  if (typeof text !== 'string') return [];
  return text.split('|').map((st) => {
    let x = 0;
    let y = 0;
    return st.split(' ').map((p) => {
      const [dx, dy] = p.split(',').map(Number);
      x += dx;
      y += dy;
      return [x / Q, y / Q];
    }).filter((p) => p.every(Number.isFinite));
  }).filter((st) => st.length);
}

// "index:Striche;index:…"
function packCells(cells) {
  return Object.entries(cells).map(([k, strokes]) => `${k}:${packStrokes(strokes)}`).join(';');
}

function unpackCells(text) {
  const cells = {};
  if (typeof text !== 'string' || !text) return cells;
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    const k = Number(part.slice(0, i));
    if (!Number.isInteger(k) || k < 0 || k >= CELL_CHARS.length) continue;
    const strokes = unpackStrokes(part.slice(i + 1));
    if (strokes.length) cells[k] = strokes;
  }
  return cells;
}

// Eigene Zeichen als Objekt { Zeichen: Striche }: so stört kein ":" oder ";" im Zeichen.
function packCustom(custom = {}) {
  return Object.fromEntries(Object.entries(custom).map(([c, strokes]) => [c, packStrokes(strokes)]));
}

function unpackCustom(data) {
  const custom = {};
  if (!data || typeof data !== 'object') return custom;
  for (const [c, text] of Object.entries(data)) {
    const strokes = isCustomChar(c) ? unpackStrokes(text) : [];
    if (strokes.length) custom[c] = strokes;
  }
  return custom;
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/**
 * Link auf diese Seite mit allem, was ein anderes Gerät zum Setzen braucht.
 * @param {string} [base]  Adresse der Seite; im Browser die aktuelle.
 */
async function handoffLink({ cells, custom, text, settings }, base = new URL('./', location.href).href) {
  const data = { v: 1, c: packCells(cells), t: text, s: settings };
  if (custom && Object.keys(custom).length) data.u = packCustom(custom);
  const raw = utf8(JSON.stringify(data));
  const packed = canCompress ? await pipe(raw, new CompressionStream('deflate-raw')) : raw;
  return `${base}#gn${canCompress ? 1 : 0}=${toBase64Url(packed)}`;
}

// Liest "#gn1=…" (komprimiert) oder "#gn0=…". null, wenn der Teil fehlt.
async function readHandoff(hash) {
  const m = /^#gn([01])=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  if (m[1] === '1' && typeof DecompressionStream !== 'function') {
    throw new Error('Dieser Browser kann den Link nicht entpacken. Ein aktueller Browser hilft.');
  }
  let data;
  try {
    let bytes = fromBase64Url(m[2]);
    if (m[1] === '1') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    data = JSON.parse(fromUtf8(bytes));
  } catch {
    throw new Error('Der Link ist beschädigt. Am besten neu erzeugen und ganz kopieren.');
  }
  if (data?.v !== 1) throw new Error('Dieser Link ist von einer anderen Version.');
  return {
    cells: unpackCells(data.c),
    custom: unpackCustom(data.u),
    text: typeof data.t === 'string' ? data.t : '',
    settings: data.s && typeof data.s === 'object' ? data.s : {},
  };
}

export { packCells, unpackCells, handoffLink, readHandoff };
