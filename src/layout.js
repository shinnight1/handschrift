// Textsatz: Text → Seiten mit Strichen in PDF-Punkten (Ursprung oben links).
// Jedes Zeichen bekommt eine Variante und kleine Schwankungen in Größe, Lage
// und Neigung, damit kein Wort wie gestempelt aussieht.

import { MM } from './pdf.js';
import { measureXHeight } from './profile.js';
import { densify } from './geometry.js';
import { rng } from './random.js';

const FORMATS = {
  a4: { width: 595.28, height: 841.89, margins: { top: 22, right: 15, bottom: 15, left: 22 } },
  // Seitengröße der geprüften GoodNotes-Vorlage (ca. 160 × 208 mm).
  standard: { width: 455.04, height: 588.45, margins: { top: 15, right: 10, bottom: 10, left: 14 } },
};

const DEFAULTS = {
  xHeightMm: 3.2,
  lineSpacingMm: 9,
  letterSpacing: 0.18, // Abstand zwischen Buchstaben, Anteil der x-Höhe
  wordSpacing: 0.9, // Wortabstand, Anteil der x-Höhe
  natural: 0.5, // 0 = gleichmäßig, 1 = sehr unruhig
  penWidthMm: 0.35,
  seed: 1,
};

const SUBSTITUTES = {
  '“': '"', '”': '"', '„': '"', '‟': '"', '«': '"', '»': '"', '″': '"',
  '‘': "'", '’': "'", '‚': "'", '‹': "'", '›': "'", '`': "'", '´': "'", '′': "'",
  '–': '-', '—': '-', '‐': '-', '‑': '-', '−': '-',
  '…': '...', 'ß': 'ss', 'ẞ': 'SS', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ä': 'ae', 'ö': 'oe', 'ü': 'ue',
  '×': 'x', ' ': ' ',
};

// Liefert eine Folge von {variants, scale} für ein Zeichen, oder null.
function resolve(char, table, depth = 0) {
  if (table.has(char)) return [{ variants: table.get(char), scale: 1 }];
  if (depth > 1) return null;
  const sub = SUBSTITUTES[char];
  if (sub) {
    const parts = [...sub].map((c) => resolve(c, table, depth + 1));
    if (parts.every(Boolean)) return parts.flat();
  }
  const plain = char.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (plain !== char && plain.length === 1 && table.has(plain)) return [{ variants: table.get(plain), scale: 1 }];
  const lower = char.toLowerCase();
  const upper = char.toUpperCase();
  if (lower !== char && table.has(lower)) return [{ variants: table.get(lower), scale: 1.3 }];
  if (upper !== char && table.has(upper)) return [{ variants: table.get(upper), scale: 0.75 }];
  return null;
}

/**
 * @param {string} text
 * @param {Map} table  aus glyphTable()
 * @param {object} options  DEFAULTS plus `format` (Objekt aus FORMATS)
 * @returns {{pages: Array, missing: string[], lineHeight: number, top: number}}
 */
function layoutText(text, table, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const format = o.format ?? FORMATS.a4;
  const r = rng(o.seed);
  const n = Math.max(0, Math.min(1, o.natural));

  const xh = measureXHeight(table);
  const xhPt = o.xHeightMm * MM;
  const s = xhPt / xh; // Punkte pro Glyphen-Einheit
  const penPt = o.penWidthMm * MM;
  const lineH = o.lineSpacingMm * MM;
  const left = format.margins.left * MM;
  const right = format.width - format.margins.right * MM;
  const top = format.margins.top * MM;
  const bottom = format.height - format.margins.bottom * MM;
  const maxWidth = right - left;

  const missing = new Set();
  const lastVariant = new Map();
  const dense = new Map();
  const denseStrokes = (v) => {
    if (!dense.has(v)) dense.set(v, v.strokes.map((st) => densify(st, 0.5 / s)));
    return dense.get(v);
  };

  function instance(char) {
    const seq = resolve(char, table);
    if (!seq) { missing.add(char); return []; }
    return seq.map(({ variants, scale }) => {
      const last = lastVariant.get(variants);
      const pool = variants.length > 1 ? variants.filter((v) => v !== last) : variants;
      const variant = r.pick(pool);
      lastVariant.set(variants, variant);
      const f = scale * (1 + n * 0.05 * r.gauss());
      return {
        variant,
        f,
        rot: (n * 2.2 * r.gauss() * Math.PI) / 180,
        dy: n * 0.05 * xhPt * r.gauss(),
        width: (variant.maxX - variant.minX) * s * f,
        gap: xhPt * Math.max(0.02, o.letterSpacing + n * 0.05 * r.gauss()),
      };
    });
  }

  const wordWidth = (glyphs) => glyphs.reduce((sum, g, i) => sum + g.width + (i ? glyphs[i - 1].gap : 0), 0);

  // Absätze → Zeilen aus Wörtern (greedy Umbruch, überlange Wörter werden geteilt).
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    const words = paragraph.split(/ +/).filter(Boolean).map((w) => [...w].flatMap(instance)).filter((g) => g.length);
    let line = [];
    let used = 0;
    const spaceW = () => xhPt * Math.max(0.3, o.wordSpacing + n * 0.12 * r.gauss());
    for (let word of words) {
      let w = wordWidth(word);
      while (w > maxWidth) {
        let k = 1;
        while (k < word.length && wordWidth(word.slice(0, k + 1)) <= maxWidth) k++;
        if (line.length) { lines.push(line); line = []; used = 0; }
        lines.push([{ glyphs: word.slice(0, k), space: 0 }]);
        word = word.slice(k);
        w = wordWidth(word);
      }
      if (!word.length) continue;
      const space = line.length ? spaceW() : 0;
      if (line.length && used + space + w > maxWidth) {
        lines.push(line);
        line = [];
        used = 0;
      }
      line.push({ glyphs: word, space: line.length ? space : 0 });
      used += (line.length > 1 ? space : 0) + w;
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();

  // Zeilen auf Seiten setzen.
  const linesPerPage = Math.max(1, Math.floor((bottom - top) / lineH));
  const pages = [];
  lines.forEach((line, i) => {
    const pageIndex = Math.floor(i / linesPerPage);
    if (!pages[pageIndex]) pages[pageIndex] = { width: format.width, height: format.height, strokes: [] };
    const page = pages[pageIndex];
    const baseline = top + ((i % linesPerPage) + 1) * lineH;

    const phase = r.range(0, Math.PI * 2);
    const wavelength = r.range(70, 150) * MM;
    const amp = n * 0.1 * xhPt;
    const slope = n * 0.005 * r.gauss();
    const wander = (x) => amp * Math.sin((2 * Math.PI * x) / wavelength + phase) + slope * x;

    let x = left + Math.abs(n * 0.6 * MM * r.gauss());
    for (const word of line) {
      x += word.space;
      word.glyphs.forEach((g, gi) => {
        if (gi) x += word.glyphs[gi - 1].gap;
        const { variant, f, rot } = g;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const cx = g.width / 2;
        const by = baseline + wander(x - left) + g.dy;
        for (const st of denseStrokes(variant)) {
          page.strokes.push({
            width: penPt,
            points: st.map(([u, v]) => {
              const lx = (u - variant.minX) * s * f - cx;
              const ly = (v + variant.shift) * s * f;
              return [x + cx + lx * cos - ly * sin, by + lx * sin + ly * cos];
            }),
          });
        }
        x += g.width;
      });
    }
  });
  if (!pages.length) pages.push({ width: format.width, height: format.height, strokes: [] });

  return { pages, missing: [...missing], lineHeight: lineH, top, linesPerPage };
}

export { FORMATS, DEFAULTS, layoutText };
