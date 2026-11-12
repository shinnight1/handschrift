// Textsatz: Text → Seiten mit Strichen in PDF-Punkten (Ursprung oben links).
// Jedes Zeichen bekommt eine Variante und kleine Schwankungen in Größe, Lage
// und Neigung, damit kein Wort wie gestempelt aussieht.
// layoutText() füllt ganze Seiten, layoutBox() ein Feld auf einem Arbeitsblatt
// (worksheet.js); beide nutzen denselben Setzer.

import { MM } from './pdf.js';
import { measureXHeight } from './profile.js';
import { densify } from './geometry.js';
import { rng } from './random.js';

// Ränder in mm. A5 und A3 sind A4 mal 1/√2 bzw. √2; die Ränder wachsen nicht ganz mit,
// so wie man auch auf A3 keine 3 cm Rand lässt.
const FORMATS = {
  a3: { width: 841.89, height: 1190.55, margins: { top: 28, right: 20, bottom: 20, left: 28 } },
  a4: { width: 595.28, height: 841.89, margins: { top: 22, right: 15, bottom: 15, left: 22 } },
  a5: { width: 419.53, height: 595.28, margins: { top: 16, right: 11, bottom: 11, left: 16 } },
  // Seitengröße der geprüften GoodNotes-Vorlage (ca. 160 × 208 mm).
  standard: { width: 455.04, height: 588.45, margins: { top: 15, right: 10, bottom: 10, left: 14 } },
};

const DEFAULTS = {
  xHeightMm: 3.2,
  lineSpacingMm: 9,
  letterSpacing: 0.18, // Abstand zwischen Buchstaben, Anteil der x-Höhe
  minGap: 0.02, // kleinster Abstand; fertige Handschriften setzen nach Vorschub und dürfen enger
  wordSpacing: 0.9, // Wortabstand, Anteil der x-Höhe
  natural: 0.5, // 0 = gleichmäßig, 1 = sehr unruhig
  penWidthMm: 0.35,
  seed: 1,
};

// Platz, den eine Zeile über und unter der Grundlinie braucht, als Vielfaches der x-Höhe.
// Die Schreibkästchen lassen 2,2 und 1,25 (charset.js); geschrieben wird meist knapper, und
// eine einzelne lange Ober- oder Unterlänge darf etwas aus dem Feld ragen.
const ASCENT = 2.0;
const DESCENT = 0.8;

const SUBSTITUTES = {
  '“': '"', '”': '"', '„': '"', '‟': '"', '«': '"', '»': '"', '″': '"',
  '‘': "'", '’': "'", '‚': "'", '‹': "'", '›': "'", '`': "'", '´': "'", '′': "'",
  '–': '-', '—': '-', '‐': '-', '‑': '-', '−': '-',
  '…': '...', 'ß': 'ss', 'ẞ': 'SS', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ä': 'ae', 'ö': 'oe', 'ü': 'ue',
  '×': 'x', ' ': ' ',
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

// Setzer für eine Schriftgröße: macht aus Text Zeilen und aus Zeilen Striche. Der Zufall läuft
// in fester Reihenfolge (erst alle Zeichen eines Absatzes, dann seine Wortabstände, dann je
// Zeile Welle und Einzug), damit gleiche Einstellungen immer dieselbe Handschrift ergeben.
function typesetter(table, o) {
  const r = rng(o.seed);
  const n = Math.max(0, Math.min(1, o.natural));
  const xh = measureXHeight(table);
  const xhPt = o.xHeightMm * MM;
  const s = xhPt / xh; // Punkte pro Glyphen-Einheit
  const penPt = o.penWidthMm * MM;

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
        gap: xhPt * Math.max(o.minGap, o.letterSpacing + n * 0.05 * r.gauss()),
      };
    });
  }

  const wordWidth = (glyphs) => glyphs.reduce((sum, g, i) => sum + g.width + (i ? glyphs[i - 1].gap : 0), 0);

  // Absätze → Zeilen aus Wörtern (greedy Umbruch, überlange Wörter werden geteilt).
  // widthFor(i): Breite, die Zeile i zur Verfügung hat.
  function breakLines(text, widthFor) {
    const lines = [];
    for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
      const words = paragraph.split(/ +/).filter(Boolean).map((w) => [...w].flatMap(instance)).filter((g) => g.length);
      let line = [];
      let used = 0;
      const spaceW = () => xhPt * Math.max(0.3, o.wordSpacing + n * 0.12 * r.gauss());
      for (let word of words) {
        let w = wordWidth(word);
        while (w > widthFor(lines.length + (line.length ? 1 : 0))) {
          if (line.length) { lines.push(line); line = []; used = 0; }
          const maxWidth = widthFor(lines.length);
          let k = 1;
          while (k < word.length && wordWidth(word.slice(0, k + 1)) <= maxWidth) k++;
          lines.push([{ glyphs: word.slice(0, k), space: 0 }]);
          word = word.slice(k);
          w = wordWidth(word);
        }
        if (!word.length) continue;
        const space = line.length ? spaceW() : 0;
        if (line.length && used + space + w > widthFor(lines.length)) {
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
    return lines;
  }

  // Eine Zeile ab left auf die Grundlinie; Striche landen in sink. Jede Zeile schwingt ein
  // wenig (Welle, leichte Schräge) und beginnt nicht ganz bündig.
  function placeLine(sink, line, left, baseline) {
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
          sink.push({
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
  }

  return { breakLines, placeLine, missing, xhPt };
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
  const t = typesetter(table, o);

  const lineH = o.lineSpacingMm * MM;
  const left = format.margins.left * MM;
  const right = format.width - format.margins.right * MM;
  const top = format.margins.top * MM;
  const bottom = format.height - format.margins.bottom * MM;
  const maxWidth = right - left;

  const lines = t.breakLines(text, () => maxWidth);

  // Zeilen auf Seiten setzen.
  const linesPerPage = Math.max(1, Math.floor((bottom - top) / lineH));
  const pages = [];
  lines.forEach((line, i) => {
    const pageIndex = Math.floor(i / linesPerPage);
    if (!pages[pageIndex]) pages[pageIndex] = { width: format.width, height: format.height, strokes: [] };
    const baseline = top + ((i % linesPerPage) + 1) * lineH;
    t.placeLine(pages[pageIndex].strokes, line, left, baseline);
  });
  if (!pages.length) pages.push({ width: format.width, height: format.height, strokes: [] });

  return { pages, missing: [...t.missing], lineHeight: lineH, top, linesPerPage };
}

const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// Linien, auf die in einem Feld geschrieben wird: nur solche mit etwas Platz darüber, sonst
// wäre es die Oberkante einer Tabellenzelle.
const MIN_HEADROOM = 1.5 * MM;
const usableRules = (box) => (box.rules ?? [])
  .filter((rule) => rule.y - box.y >= MIN_HEADROOM)
  .sort((a, b) => a.y - b.y);

// Wo die Zeilen eines Felds stehen, für eine x-Höhe (Punkte). Mit Linien: auf den Linien,
// sonst so viele Zeilen untereinander, wie ins Feld passen.
function boxGeometry(box, rules, xhPt, ratio) {
  const padX = Math.min(1.2 * MM, box.w * 0.08);
  const extent = (rule) => [Math.max(box.x, rule?.x0 ?? box.x) + padX, Math.min(box.x + box.w, rule?.x1 ?? box.x + box.w) - padX];
  if (rules.length) {
    const step = rules.length > 1 ? median(rules.slice(1).map((rule, i) => rule.y - rules[i].y)) : xhPt * ratio;
    const last = rules[rules.length - 1];
    return {
      capacity: rules.length,
      baseline: (i) => (i < rules.length ? rules[i].y : last.y + (i - rules.length + 1) * step),
      extent: (i) => extent(rules[Math.min(i, rules.length - 1)]),
    };
  }
  const padY = Math.min(0.8 * MM, box.h * 0.1);
  const step = xhPt * ratio;
  const first = box.y + padY + ASCENT * xhPt;
  const room = box.y + box.h - padY - DESCENT * xhPt - first;
  const capacity = room < 0 ? 0 : Math.floor(room / step + 1e-6) + 1;
  return {
    capacity,
    first,
    step,
    baseline: (i) => first + i * step,
    extent: () => extent(null),
  };
}

/**
 * Text in ein Feld setzen (Arbeitsblatt). Erkannte Linien im Feld werden zu Grundlinien;
 * passt der Text nicht, wird die Schrift bis auf 1,5 mm x-Höhe kleiner, danach läuft er über.
 * @param {string} text
 * @param {Map} table  aus glyphTable()
 * @param {{x: number, y: number, w: number, h: number, rules?: {y: number, x0: number, x1: number}[]}} box
 *   in Punkten; rules: gedruckte Linien im Feld (y = Oberkante der Linie)
 * @param {object} options  wie layoutText, xHeightMm ist die größte Schrift
 * @returns {{strokes: Array, missing: string[], overflow: boolean, xHeightMm: number, lines: number}}
 */
function layoutBox(text, table, box, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const ratio = Math.max(2.2, o.lineSpacingMm / o.xHeightMm);
  const rules = usableRules(box);

  // Größte Schrift, die zum Feld passt: bei mehreren Linien ihr Abstand, bei einer der
  // Platz darüber, ohne Linien die Höhe für eine Zeile.
  let cap = o.xHeightMm;
  if (rules.length > 1) cap = Math.min(cap, (median(rules.slice(1).map((rule, i) => rule.y - rules[i].y)) * 0.38) / MM);
  else if (rules.length === 1) cap = Math.min(cap, (rules[0].y - box.y) / ASCENT / MM);
  else cap = Math.min(cap, (box.h - 2 * Math.min(0.8 * MM, box.h * 0.1)) / (ASCENT + DESCENT) / MM);
  const minXh = Math.min(o.xHeightMm, 1.5);
  let xh = Math.max(minXh, cap);

  for (;;) {
    const t = typesetter(table, { ...o, xHeightMm: xh });
    const geo = boxGeometry(box, rules, xh * MM, ratio);
    const widthFor = (i) => Math.max(xh * MM, geo.extent(i)[1] - geo.extent(i)[0]);
    const lines = t.breakLines(text, widthFor);
    const used = lines.filter((line, i) => line.length || i < lines.length - 1).length;
    const fits = used <= geo.capacity;
    if (fits || xh <= minXh + 1e-9) {
      const strokes = [];
      // Niedriges Feld ohne Linien, eine Zeile: mittig hinein (Ober- bis Unterlänge), wie man in
      // eine Tabellenzelle schreibt. In großen Feldern beginnt der Text oben.
      const single = !rules.length && lines.length === 1 && geo.capacity <= 2;
      const middle = box.y + (box.h - (ASCENT + DESCENT) * xh * MM) / 2 + ASCENT * xh * MM;
      const baseline = (i) => (single ? Math.max(geo.first, middle) : geo.baseline(i));
      lines.forEach((line, i) => t.placeLine(strokes, line, geo.extent(i)[0], baseline(i)));
      return { strokes, missing: [...t.missing], overflow: !fits, xHeightMm: xh, lines: lines.length };
    }
    xh = Math.max(minXh, xh * 0.9);
  }
}

export { FORMATS, DEFAULTS, ASCENT, DESCENT, layoutText, layoutBox };
