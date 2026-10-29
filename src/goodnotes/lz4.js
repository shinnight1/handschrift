// Apple-LZ4-Rahmen ("bv41" ... "bv4$"), wie ihn NSData.compressed(using: .lz4)
// erzeugt. Innen steckt ein normaler LZ4-Block.

import { ByteWriter } from './bytes.js';

const MIN_MATCH = 4;
const LAST_LITERALS = 5;
const MF_LIMIT = 12;
const BLOCK_MAX = 0x10000;

function writeLength(w, n) {
  while (n >= 255) { w.u8(255); n -= 255; }
  w.u8(n);
}

function emitSequence(w, src, litStart, litLen, offset, matchLen) {
  const ml = matchLen - MIN_MATCH;
  w.u8(((litLen >= 15 ? 15 : litLen) << 4) | (ml >= 15 ? 15 : ml));
  if (litLen >= 15) writeLength(w, litLen - 15);
  w.bytes(src.subarray(litStart, litStart + litLen));
  w.u16(offset);
  if (ml >= 15) writeLength(w, ml - 15);
}

function emitLastLiterals(w, src, litStart) {
  const litLen = src.length - litStart;
  w.u8((litLen >= 15 ? 15 : litLen) << 4);
  if (litLen >= 15) writeLength(w, litLen - 15);
  w.bytes(src.subarray(litStart));
}

// Gieriger LZ4-Kompressor mit Hashtabelle. Hält die Endregeln des Formats ein:
// die letzten 5 Bytes sind Literale, kein Match beginnt in den letzten 12 Bytes.
function lz4CompressBlock(src) {
  const w = new ByteWriter(src.length + 16);
  const n = src.length;
  const table = new Int32Array(1 << 14).fill(-1);
  const read32 = (i) => (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
  const hash = (v) => (Math.imul(v, 2654435761) >>> 18) & 0x3fff;
  let anchor = 0;
  let i = 0;
  const matchLimit = n - LAST_LITERALS;
  while (i < n - MF_LIMIT) {
    const v = read32(i);
    const h = hash(v);
    const ref = table[h];
    table[h] = i;
    if (ref >= 0 && i - ref <= 0xffff && read32(ref) === v) {
      let len = MIN_MATCH;
      while (i + len < matchLimit && src[ref + len] === src[i + len]) len++;
      emitSequence(w, src, anchor, i - anchor, i - ref, len);
      i += len;
      anchor = i;
    } else {
      i++;
    }
  }
  emitLastLiterals(w, src, anchor);
  return w.result();
}

function lz4DecompressBlock(block, expectedSize, history = new Uint8Array(0)) {
  const out = new Uint8Array(history.length + expectedSize);
  out.set(history);
  let o = history.length;
  let p = 0;
  while (p < block.length) {
    const token = block[p++];
    let lit = token >> 4;
    if (lit === 15) {
      let b;
      do { b = block[p++]; lit += b; } while (b === 255);
    }
    out.set(block.subarray(p, p + lit), o);
    o += lit;
    p += lit;
    if (p >= block.length) break;
    const offset = block[p] | (block[p + 1] << 8);
    p += 2;
    if (offset === 0 || offset > o) throw new Error('LZ4: ungültiger Offset');
    let ml = token & 15;
    if (ml === 15) {
      let b;
      do { b = block[p++]; ml += b; } while (b === 255);
    }
    ml += MIN_MATCH;
    for (let k = 0; k < ml; k++, o++) out[o] = out[o - offset];
  }
  if (o !== out.length) throw new Error(`LZ4: ${o - history.length} statt ${expectedSize} Bytes`);
  return out.subarray(history.length);
}

function appleLz4Compress(data) {
  const w = new ByteWriter(data.length + 32);
  for (let start = 0; start < data.length; start += BLOCK_MAX) {
    const chunk = data.subarray(start, Math.min(data.length, start + BLOCK_MAX));
    const packed = lz4CompressBlock(chunk);
    w.ascii('bv41');
    w.u32(chunk.length);
    w.u32(packed.length);
    w.bytes(packed);
  }
  w.ascii('bv4$');
  return w.result();
}

// Liefert {data, consumed}; was nach "bv4$" kommt, gehört nicht mehr dazu.
function appleLz4Decompress(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const parts = [];
  let total = 0;
  let p = 0;
  for (;;) {
    if (p + 4 > buf.length) throw new Error('Apple-LZ4: Endmarke fehlt');
    const magic = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
    p += 4;
    if (magic === 'bv4$') break;
    const rawSize = view.getUint32(p, true);
    const storedSize = view.getUint32(p + 4, true);
    p += 8;
    const block = buf.subarray(p, p + storedSize);
    p += storedSize;
    if (magic === 'bv4-') parts.push(block);
    else if (magic === 'bv41') parts.push(lz4DecompressBlock(block, rawSize));
    else throw new Error(`Apple-LZ4: unbekannter Block ${magic}`);
    total += rawSize;
  }
  const data = new Uint8Array(total);
  let o = 0;
  for (const part of parts) { data.set(part, o); o += part.length; }
  return { data, consumed: p };
}

export { lz4CompressBlock, lz4DecompressBlock, appleLz4Compress, appleLz4Decompress };
