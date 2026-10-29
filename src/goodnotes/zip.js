// ZIP mit unkomprimierten Einträgen (GoodNotes akzeptiert das) und ein
// Leser für genau solche Archive, damit Tests die eigene Ausgabe prüfen können.

import { ByteWriter, utf8, fromUtf8 } from './bytes.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class ZipWriter {
  constructor() {
    this.body = new ByteWriter(1 << 16);
    this.entries = [];
  }

  add(name, content) {
    const nameBytes = utf8(name);
    const crc = crc32(content);
    const offset = this.body.length;
    const h = this.body;
    h.u32(0x04034b50);
    h.u16(20);
    h.u16(0x0800); // UTF-8-Namen
    h.u16(0); // gespeichert, nicht komprimiert
    h.u16(0); h.u16(0); // Zeit, Datum
    h.u32(crc);
    h.u32(content.length);
    h.u32(content.length);
    h.u16(nameBytes.length);
    h.u16(0);
    h.bytes(nameBytes);
    h.bytes(content);
    this.entries.push({ nameBytes, crc, size: content.length, offset });
  }

  finish() {
    const w = this.body;
    const centralStart = w.length;
    for (const e of this.entries) {
      w.u32(0x02014b50);
      w.u16(20); w.u16(20);
      w.u16(0x0800);
      w.u16(0);
      w.u16(0); w.u16(0);
      w.u32(e.crc);
      w.u32(e.size); w.u32(e.size);
      w.u16(e.nameBytes.length);
      w.u16(0); w.u16(0); w.u16(0);
      w.u16(0);
      w.u32(0);
      w.u32(e.offset);
      w.bytes(e.nameBytes);
    }
    const centralSize = w.length - centralStart;
    w.u32(0x06054b50);
    w.u16(0); w.u16(0);
    w.u16(this.entries.length); w.u16(this.entries.length);
    w.u32(centralSize);
    w.u32(centralStart);
    w.u16(0);
    return w.result();
  }
}

// Liest unkomprimierte ZIP-Einträge über das zentrale Verzeichnis.
function readStoredZip(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: Ende des Verzeichnisses fehlt');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP: kaputtes Verzeichnis');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = fromUtf8(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (method !== 0) throw new Error(`ZIP: ${name} ist komprimiert`);
    const lnameLen = view.getUint16(offset + 26, true);
    const lextraLen = view.getUint16(offset + 28, true);
    const start = offset + 30 + lnameLen + lextraLen;
    const data = buf.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`ZIP: CRC von ${name} stimmt nicht`);
    files.set(name, data);
  }
  return files;
}

export { crc32, ZipWriter, readStoredZip };
