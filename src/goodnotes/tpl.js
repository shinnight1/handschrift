// TPL-Speicherabbild (Troy Hanson, "tpl\0"), in dem GoodNotes die Punkte eines
// Strichs ablegt. Wir schreiben nur das Kugelschreiber-Format.

import { ByteWriter } from './bytes.js';

const BALLPOINT_FORMAT = 'vuA(v)A(S(uu))A(S(uuuu))vA(f)';

// points: [[x, y], ...] in GoodNotes-Einheiten, width ebenso.
// Aufbau: Version, Breite, Stift-unten-Flags, Startpunkt, dann je zwei Punkte
// pro Tupel. Floats stehen als IEEE-754-Bitmuster in den u32-Feldern.
function encodeBallpoint(width, points) {
  const body = new ByteWriter(64 + points.length * 8);
  body.u16(2);
  body.f32(width);
  const rest = points.slice(1);
  if (rest.length % 2 === 1) rest.push(rest[rest.length - 1]);
  const quads = rest.length / 2;
  body.u32(quads + 1);
  body.u16(0);
  for (let i = 0; i < quads; i++) body.u16(1);
  body.u32(1);
  body.f32(points[0][0]);
  body.f32(points[0][1]);
  body.u32(quads);
  for (let i = 0; i < rest.length; i += 2) {
    body.f32(rest[i][0]); body.f32(rest[i][1]);
    body.f32(rest[i + 1][0]); body.f32(rest[i + 1][1]);
  }
  body.u16(1);
  body.u32(0);

  const bodyBytes = body.result();
  const out = new ByteWriter(16 + BALLPOINT_FORMAT.length + bodyBytes.length);
  out.ascii('tpl');
  out.u8(0);
  out.u32(8 + BALLPOINT_FORMAT.length + 1 + bodyBytes.length);
  out.ascii(BALLPOINT_FORMAT);
  out.u8(0);
  out.bytes(bodyBytes);
  return out.result();
}

// Allgemeiner Decoder für die Formatzeichen, die GoodNotes-Striche benutzen.
function decodeTpl(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(buf[0], buf[1], buf[2]) !== 'tpl') throw new Error('kein TPL');
  const size = view.getUint32(4, true);
  if (size !== buf.length) throw new Error(`TPL-Größe ${size} ≠ ${buf.length}`);
  let p = 8;
  let format = '';
  while (buf[p] !== 0) format += String.fromCharCode(buf[p++]);
  p++;

  // Format in einen Baum zerlegen.
  let i = 0;
  function parseSeq(end) {
    const items = [];
    while (i < format.length && format[i] !== end) {
      const c = format[i++];
      if (c === 'A' || c === 'S') {
        if (format[i++] !== '(') throw new Error('TPL-Format: "(" erwartet');
        items.push({ kind: c, items: parseSeq(')') });
        i++;
      } else {
        items.push({ kind: c });
      }
    }
    return items;
  }
  const tree = parseSeq(undefined);

  function read(node) {
    switch (node.kind) {
      case 'v': { const v = view.getUint16(p, true); p += 2; return v; }
      case 'j': { const v = view.getInt16(p, true); p += 2; return v; }
      case 'u': { const v = view.getFloat32(p, true); p += 4; return v; } // als float gelesen
      case 'i': { const v = view.getInt32(p, true); p += 4; return v; }
      case 'f': { const v = view.getFloat64(p, true); p += 8; return v; }
      case 'c': { const v = view.getInt8(p); p += 1; return v; }
      case 'S': return node.items.map(read);
      case 'A': {
        const n = view.getUint32(p, true);
        p += 4;
        const out = [];
        for (let k = 0; k < n; k++) {
          out.push(node.items.length === 1 ? read(node.items[0]) : node.items.map(read));
        }
        return out;
      }
      default: throw new Error(`TPL-Formatzeichen ${node.kind} nicht unterstützt`);
    }
  }
  const values = tree.map(read);
  if (p !== buf.length) throw new Error(`TPL: ${buf.length - p} Bytes übrig`);
  return { format, values };
}

function ballpointFromTpl(buf) {
  const { format, values } = decodeTpl(buf);
  if (format !== BALLPOINT_FORMAT) throw new Error(`unerwartetes Format ${format}`);
  const width = values[1];
  const start = values[3][0];
  const points = [[start[0], start[1]]];
  for (const q of values[4]) points.push([q[0], q[1]], [q[2], q[3]]);
  return { width, flags: values[2], points };
}

export { BALLPOINT_FORMAT, encodeBallpoint, decodeTpl, ballpointFromTpl };
