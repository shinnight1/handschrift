// Vorschaubild für Links (og.png, 1200 × 630): links „Siebwrite“ von Hand, rechts ein Blatt
// mit dem Satz der Startseite in derselben Handschrift. Ohne Abhängigkeiten: zeichnet in einen
// eigenen Puffer (doppelt so groß, dann gemittelt gegen Treppen) und schreibt das PNG selbst.
// node tools/build-og-image.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { GLYPHS } from '../landing/hand-font.js';

const W = 1200;
const H = 630;
const S = 2; // Überabtastung
const BW = W * S;
const BH = H * S;
const buf = new Float32Array(BW * BH * 3);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const NIGHT = hex('#0c1222');
const PAPER = hex('#f6f1e6');
const RULE = hex('#bccbe8');
const MARGIN = hex('#e39a90');
const INK = hex('#1e3a9b');
const BRIGHT = hex('#f7f3ea');
const LIGHT = hex('#a8bbff');

function blend(i, c, a) {
  for (let k = 0; k < 3; k++) buf[i + k] += (c[k] - buf[i + k]) * a;
}

// Hintergrund: Blauschwarz, warme Lampe oben links, Tintenschimmer rechts
for (let y = 0; y < BH; y++) {
  for (let x = 0; x < BW; x++) {
    const i = (y * BW + x) * 3;
    const u = x / BW;
    const v = y / BH;
    buf.set(NIGHT, i);
    const lamp = Math.max(0, 1 - Math.hypot((u - 0.05) / 0.6, (v + 0.1) / 0.8));
    blend(i, [255, 204, 150], 0.2 * lamp * lamp);
    const pool = Math.max(0, 1 - Math.hypot((u - 1.02) / 0.5, (v - 0.55) / 0.7));
    blend(i, [46, 78, 190], 0.3 * pool * pool);
  }
}

// Blatt: gedrehtes Rechteck in Seitenkoordinaten (Pixel des fertigen Bilds)
const SHEET = { x: 610, y: 95, w: 540, h: 430, rot: (-2 * Math.PI) / 180 };
const cos = Math.cos(SHEET.rot);
const sin = Math.sin(SHEET.rot);
const cx = SHEET.x + SHEET.w / 2;
const cy = SHEET.y + SHEET.h / 2;
// Bildpunkt (Puffer) → Blattkoordinaten
const toSheet = (px, py) => {
  const dx = px / S - cx;
  const dy = py / S - cy;
  return [dx * cos + dy * sin + SHEET.w / 2, -dx * sin + dy * cos + SHEET.h / 2];
};
// Blattkoordinaten → Puffer
const fromSheet = (sx, sy) => {
  const dx = sx - SHEET.w / 2;
  const dy = sy - SHEET.h / 2;
  return [(cx + dx * cos - dy * sin) * S, (cy + dx * sin + dy * cos) * S];
};

const FIRST = 120;
const GAP = 56;
for (let y = 0; y < BH; y++) {
  for (let x = 0; x < BW; x++) {
    const [sx, sy] = toSheet(x, y);
    const i = (y * BW + x) * 3;
    // weicher Schatten unter dem Blatt, nach unten versetzt
    const ox = Math.max(0, -sx, sx - SHEET.w);
    const oy = Math.max(0, -(sy - 14), sy - 14 - SHEET.h);
    const d = Math.hypot(ox, oy);
    if (d < 46) blend(i, [0, 0, 0], 0.5 * (1 - d / 46) ** 2);
    if (sx < 0 || sy < 0 || sx > SHEET.w || sy > SHEET.h) continue;
    buf.set(PAPER, i);
    blend(i, [255, 250, 240], 0.5 * Math.max(0, 1 - Math.hypot(sx / SHEET.w, sy / SHEET.h)));
    for (let ry = FIRST; ry < SHEET.h; ry += GAP) if (Math.abs(sy - ry) < 0.9) blend(i, RULE, 1);
    if (Math.abs(sx - 62) < 0.9) blend(i, MARGIN, 1);
    for (const hy of [110, 215, 320]) if (Math.hypot(sx - 28, sy - hy) < 9) buf.set(NIGHT, i);
  }
}

// Dicke Linie mit runden Enden (Abstand zum Segment), im Puffer
function line(ax, ay, bx, by, width, color) {
  const r = (width * S) / 2;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
  const maxX = Math.min(BW - 1, Math.ceil(Math.max(ax, bx) + r + 1));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
  const maxY = Math.min(BH - 1, Math.ceil(Math.max(ay, by) + r + 1));
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (d < r + 0.5) blend((y * BW + x) * 3, color, Math.min(1, r + 0.5 - d));
    }
  }
}

// Text in der Handschrift: map(x, y) bildet Font-Einheiten auf den Puffer ab
function hand(text, { x, y, em, width, color, lineGap = em * 1.2, map = (px, py) => [px * S, py * S], seed = 7 }) {
  let a = seed;
  const rnd = () => ((a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32);
  text.split('\n').forEach((row, li) => {
    let pen = x;
    for (const ch of row) {
      const [adv, strokes] = GLYPHS[ch] ?? GLYPHS[' '];
      const s = (em / 1000) * (1 + (rnd() - 0.5) * 0.06);
      const rot = (rnd() - 0.5) * 0.05;
      const c = Math.cos(rot);
      const n = Math.sin(rot);
      for (const st of strokes) {
        const pts = [];
        for (let k = 0; k < st.length; k += 2) pts.push(map(pen + (st[k] * c - st[k + 1] * n) * s, y + li * lineGap + (st[k] * n + st[k + 1] * c) * s));
        if (pts.length === 1) pts.push([pts[0][0] + 0.5, pts[0][1]]);
        for (let k = 1; k < pts.length; k++) line(...pts[k - 1], ...pts[k], width, color);
      }
      pen += (adv * em) / 1000;
    }
  });
}

hand('Siebwrite', { x: 60, y: 290, em: 172, width: 5.2, color: BRIGHT, seed: 9 });
hand('Einmal schreiben,\ndann nur noch tippen.', { x: 68, y: 392, em: 46, width: 2.4, color: LIGHT, lineGap: 58, seed: 3 });
hand('siebwrite.de', { x: 68, y: 556, em: 38, width: 2.1, color: [143, 155, 182], seed: 5 });
hand('Tippen, und es steht\nin deiner Handschrift\nda.', { x: 84, y: FIRST, em: 55, width: 2.5, color: INK, lineGap: GAP, map: fromSheet, seed: 11 });

// Auf Bildgröße mitteln, als RGB-PNG schreiben
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) sum += buf[((y * S + j) * BW + x * S + i) * 3 + k];
      raw[y * (W * 3 + 1) + 1 + x * 3 + k] = Math.max(0, Math.min(255, Math.round(sum / (S * S))));
    }
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // Bit je Kanal
ihdr[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = new URL('../og.png', import.meta.url);
writeFileSync(out, png);
console.log(`og.png: ${W} × ${H}, ${Math.round(png.length / 1024)} KB`);
