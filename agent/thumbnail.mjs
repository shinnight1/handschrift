// Vorschaubild einer .goodnotes-Datei ohne Browser. In der App malt ein Canvas die Seite
// und speichert sie als JPEG (app.js, thumbnail()); KI-Agenten laufen in Node, ohne Canvas.
// Deshalb hier: Seite rastern wie drawPage() in render.js (weißes Blatt, Papierlinien, runde
// Striche, Kantenglättung) und als Baseline-JPEG speichern, Qualität 80 wie toDataURL(…, 0.8).
// Huffman- und Quantisierungstabellen aus Anhang K der JPEG-Norm, Farben ohne Unterabtastung.

import { paperLines, PAPER_LINE } from '../src/render.js';

const WIDTH = 360; // wie in der App

// ---------- Rastern ----------

/**
 * Seite als RGB-Bild (Werte 0–1).
 * @returns {{width: number, height: number, rgb: Float32Array}}
 */
function rasterPage(page, { paper = 'blank', ink = [0, 0, 0], layout }, width = WIDTH) {
  const k = width / page.width; // Pixel pro Punkt
  const height = Math.round(page.height * k);
  const rgb = new Float32Array(width * height * 3).fill(1);
  const cover = new Float32Array(width * height);

  // Deckung einer Strecke mit runden Enden (Radius r in Pixeln), je Pixel das Maximum.
  function segment(x0, y0, x1, y1, r) {
    const thin = Math.min(1, 2 * r); // dünner als ein Pixel: blasser statt breiter
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
    const xb = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + r + 1));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
    const yb = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + r + 1));
    for (let y = ya; y <= yb; y++) {
      const py = y + 0.5;
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5;
        const t = len2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
        const ex = px - (x0 + t * dx);
        const ey = py - (y0 + t * dy);
        const c = Math.min(1, Math.max(0, r + 0.5 - Math.sqrt(ex * ex + ey * ey))) * thin;
        const i = y * width + x;
        if (c > cover[i]) cover[i] = c;
      }
    }
  }

  // Gesammelte Deckung in einer Farbe auftragen und zurücksetzen.
  function paint(color, box) {
    const [xa, ya, xb, yb] = box.map((v, n) => Math.max(0, Math.min(n % 2 ? height - 1 : width - 1, Math.floor(v))));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const i = y * width + x;
        const a = cover[i];
        if (!a) continue;
        cover[i] = 0;
        for (let ch = 0; ch < 3; ch++) rgb[i * 3 + ch] += (color[ch] - rgb[i * 3 + ch]) * a;
      }
    }
  }

  const lines = paperLines(page, paper, layout);
  if (lines.length) {
    const r = (Math.max(0.4, 0.6 / k) * k) / 2;
    for (const [x1, y1, x2, y2] of lines) segment(x1 * k, y1 * k, x2 * k, y2 * k, r);
    paint(PAPER_LINE, [0, 0, width, height]);
  }

  for (const st of page.strokes) {
    if (!st.points.length) continue;
    const r = (st.width * k) / 2;
    const pts = st.points.length === 1 ? [st.points[0], [st.points[0][0] + 0.01, st.points[0][1]]] : st.points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      segment(x0 * k, y0 * k, x1 * k, y1 * k, r);
    }
    for (const [x, y] of pts) {
      minX = Math.min(minX, x * k); maxX = Math.max(maxX, x * k);
      minY = Math.min(minY, y * k); maxY = Math.max(maxY, y * k);
    }
    paint(ink, [minX - r - 2, minY - r - 2, maxX + r + 2, maxY + r + 2]);
  }
  return { width, height, rgb };
}

// ---------- JPEG ----------

// Reihenfolge der Koeffizienten im Zickzack: ZIGZAG[i] = Index im 8×8-Block (zeilenweise).
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

// Quantisierung für Helligkeit und Farbe, zeilenweise (Anhang K.1).
const Q_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const Q_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...Array(32).fill(99),
];

// Huffman-Tabellen (Anhang K.3): Anzahl Codes je Länge 1–16, dann die Symbole.
const DC_LUMA = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const DC_CHROMA = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const AC_LUMA = {
  bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  vals: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
};
const AC_CHROMA = {
  bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  vals: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
};

// Kanonische Codes aus Längen und Symbolen (Anhang C).
function huffman({ bits, vals }) {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) {
      code[vals[k]] = c++;
      size[vals[k++]] = len;
    }
    c <<= 1;
  }
  return { code, size };
}

// Quantisierungstabelle für eine Qualität 1–100, Formel der IJG-Bibliothek (libjpeg).
function scaled(table, quality) {
  const s = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  return table.map((q) => Math.max(1, Math.min(255, Math.floor((q * s + 50) / 100))));
}

// cos-Tabelle der 8×8-DCT: COS[u * 8 + x] = c(u)/2 · cos((2x+1)uπ/16)
const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) {
  for (let x = 0; x < 8; x++) COS[u * 8 + x] = (u ? 0.5 : 0.5 / Math.SQRT2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
}

function fdct(block, out) {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * block[y * 8 + x];
      tmp[y * 8 + u] = s;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * tmp[y * 8 + u];
      out[v * 8 + u] = s;
    }
  }
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.n = 0;
  }

  put(value, len) {
    this.acc = (this.acc << len) | (value & ((1 << len) - 1));
    this.n += len;
    while (this.n >= 8) {
      const b = (this.acc >>> (this.n - 8)) & 0xff;
      this.bytes.push(b);
      if (b === 0xff) this.bytes.push(0); // Byte-Stopfen: 0xFF im Datenstrom
      this.n -= 8;
    }
    this.acc &= (1 << this.n) - 1;
  }

  finish() {
    if (this.n) this.put(0xff, 8 - this.n); // mit Einsen auffüllen
    return this.bytes;
  }
}

const bitLength = (v) => (v ? 32 - Math.clz32(Math.abs(v)) : 0);

/**
 * Baseline-JPEG aus einem RGB-Bild (Werte 0–1).
 * @returns {Uint8Array}
 */
function encodeJpeg({ width, height, rgb }, quality = 80) {
  const qt = [scaled(Q_LUMA, quality), scaled(Q_CHROMA, quality)];
  const dc = [huffman(DC_LUMA), huffman(DC_CHROMA)];
  const ac = [huffman(AC_LUMA), huffman(AC_CHROMA)];
  const bits = new BitWriter();
  const pred = [0, 0, 0];
  const block = new Float64Array(64);
  const coef = new Float64Array(64);

  const sample = (x, y, comp) => {
    const i = (Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 3; // Rand wiederholen
    const r = rgb[i] * 255;
    const g = rgb[i + 1] * 255;
    const b = rgb[i + 2] * 255;
    if (comp === 0) return 0.299 * r + 0.587 * g + 0.114 * b;
    if (comp === 1) return -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    return 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  };

  const emit = (table, symbol) => bits.put(table.code[symbol], table.size[symbol]);

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let comp = 0; comp < 3; comp++) {
        const t = comp ? 1 : 0;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) block[y * 8 + x] = sample(bx + x, by + y, comp) - 128;
        }
        fdct(block, coef);
        const q = new Int32Array(64);
        for (let i = 0; i < 64; i++) q[i] = Math.round(coef[ZIGZAG[i]] / qt[t][ZIGZAG[i]]);

        const diff = q[0] - pred[comp];
        pred[comp] = q[0];
        const dn = bitLength(diff);
        emit(dc[t], dn);
        if (dn) bits.put(diff < 0 ? diff + (1 << dn) - 1 : diff, dn);

        let run = 0;
        for (let i = 1; i < 64; i++) {
          const v = q[i];
          if (!v) { run++; continue; }
          while (run > 15) { emit(ac[t], 0xf0); run -= 16; }
          const n = bitLength(v);
          emit(ac[t], (run << 4) | n);
          bits.put(v < 0 ? v + (1 << n) - 1 : v, n);
          run = 0;
        }
        if (run) emit(ac[t], 0x00);
      }
    }
  }
  const data = bits.finish();

  const out = [0xff, 0xd8];
  const segment = (marker, payload) => out.push(0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload);
  segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // JFIF 1.1
  segment(0xdb, [0, ...ZIGZAG.map((i) => qt[0][i]), 1, ...ZIGZAG.map((i) => qt[1][i])]);
  segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  segment(0xc4, [
    0x00, ...DC_LUMA.bits, ...DC_LUMA.vals, 0x10, ...AC_LUMA.bits, ...AC_LUMA.vals,
    0x01, ...DC_CHROMA.bits, ...DC_CHROMA.vals, 0x11, ...AC_CHROMA.bits, ...AC_CHROMA.vals,
  ]);
  segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  for (const b of data) out.push(b);
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}

/** JPEG-Vorschau einer gesetzten Seite, wie sie die App in die .goodnotes-Datei legt. */
function thumbnailJpeg(page, options) {
  return encodeJpeg(rasterPage(page, options));
}

export { rasterPage, encodeJpeg, thumbnailJpeg, DC_LUMA, DC_CHROMA, AC_LUMA, AC_CHROMA };
