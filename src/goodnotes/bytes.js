// Kleine Helfer für Binärdaten. Läuft im Browser und in Node.

class ByteWriter {
  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
    this.length = 0;
  }

  ensure(extra) {
    if (this.length + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v) { this.ensure(1); this.buf[this.length++] = v & 0xff; }
  u16(v) { this.ensure(2); this.view.setUint16(this.length, v, true); this.length += 2; }
  u32(v) { this.ensure(4); this.view.setUint32(this.length, v >>> 0, true); this.length += 4; }
  f32(v) { this.ensure(4); this.view.setFloat32(this.length, v, true); this.length += 4; }
  f64(v) { this.ensure(8); this.view.setFloat64(this.length, v, true); this.length += 8; }

  bytes(arr) {
    this.ensure(arr.length);
    this.buf.set(arr, this.length);
    this.length += arr.length;
  }

  ascii(str) {
    this.ensure(str.length);
    for (let i = 0; i < str.length; i++) this.buf[this.length++] = str.charCodeAt(i);
  }

  result() { return this.buf.slice(0, this.length); }
}

const utf8 = (s) => new TextEncoder().encode(s);
const fromUtf8 = (b) => new TextDecoder().decode(b);

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function fromBase64(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toUpperCase();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function randomU32() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

export { ByteWriter, utf8, fromUtf8, concat, fromBase64, uuid, randomU32 };
