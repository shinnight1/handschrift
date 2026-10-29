// Protobuf-Wire-Format: nur das, was der GoodNotes-Writer braucht, plus ein
// schemaloser Decoder für Tests und zum Untersuchen von Dateien.

import { ByteWriter, utf8, concat } from './bytes.js';

function varintBytes(value) {
  let v = BigInt(value);
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return new Uint8Array(out);
}

class ProtoWriter {
  constructor() { this.w = new ByteWriter(); }

  key(field, wireType) { this.w.bytes(varintBytes((field << 3) | wireType)); }

  varint(field, value) {
    this.key(field, 0);
    this.w.bytes(varintBytes(value));
    return this;
  }

  bytes(field, data) {
    this.key(field, 2);
    this.w.bytes(varintBytes(data.length));
    this.w.bytes(data);
    return this;
  }

  string(field, s) { return this.bytes(field, utf8(s)); }

  message(field, inner) { return this.bytes(field, inner.result()); }

  fixed32f(field, value) {
    this.key(field, 5);
    this.w.f32(value);
    return this;
  }

  result() { return this.w.result(); }

  // Längenpräfix (varint) + Nachricht. Die Streams in .goodnotes sind Folgen davon.
  record() {
    const data = this.result();
    return concat([varintBytes(data.length), data]);
  }
}

// ---- Decoder ----

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error('varint läuft über das Ende');
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7n;
    if (shift > 70n) throw new Error('varint zu lang');
  }
}

// Liefert [{field, wire, value}] — value ist BigInt (varint), Uint8Array (len)
// oder Zahl (fixed32 als float, fixed64 als double).
function decodeMessage(buf) {
  const fields = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) throw new Error('Feldnummer 0');
    let value;
    if (wire === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      const n = Number(len);
      if (pos + n > buf.length) throw new Error('Länge über das Ende');
      value = buf.subarray(pos, pos + n);
      pos += n;
    } else if (wire === 5) {
      if (pos + 4 > buf.length) throw new Error('fixed32 über das Ende');
      value = view.getFloat32(pos, true);
      pos += 4;
    } else if (wire === 1) {
      if (pos + 8 > buf.length) throw new Error('fixed64 über das Ende');
      value = view.getFloat64(pos, true);
      pos += 8;
    } else {
      throw new Error(`Wire-Typ ${wire} nicht unterstützt`);
    }
    fields.push({ field, wire, value });
  }
  return fields;
}

function decodeRecords(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let len;
    [len, pos] = readVarint(buf, pos);
    const n = Number(len);
    out.push(buf.subarray(pos, pos + n));
    pos += n;
  }
  return out;
}

const first = (fields, n) => fields.find((f) => f.field === n)?.value;

export { varintBytes, ProtoWriter, readVarint, decodeMessage, decodeRecords, first };
