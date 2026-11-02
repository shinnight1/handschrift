// Macht aus Einstrich-SVG-Schriften (npm-Paket hersheytext, Ordner svg_fonts) die fertigen
// Handschriften in src/presets-data.js. Jede Schrift wird so skaliert, dass ihre x-Höhe der
// eines Kästchens entspricht (Hilfslinien in charset.js). Danach sind die Glyphen Striche wie
// selbst geschriebene: radierbar in GoodNotes, gesetzt von layout.js.
// node tools/build-presets.mjs <Ordner mit den SVG-Schriften>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUIDES, CELL_CHARS, isCustomChar } from '../src/charset.js';
import { simplify } from '../src/geometry.js';

// Reihenfolge = Reihenfolge in der App. Die Ids stehen in Einstellungen und Links: nicht ändern.
// compress: Ober- und Unterlängen (alles außerhalb des x-Höhen-Bands) weich stauchen. Die
// Schreibschriften haben fast zweieinhalbfache Oberlängen; bei normalem Zeilenabstand
// würden sich die Zeilen berühren.
const SOURCES = [
  { id: 'cursive', file: 'HersheyScript1.svg', compress: 0.55 },
  { id: 'elegant', file: 'EMSAllure.svg', compress: 0.75 },
  { id: 'quill', file: 'EMSFelix.svg', compress: 1 },
  { id: 'print', file: 'EMSTech.svg', compress: 1 },
  { id: 'playful', file: 'EMSElfin.svg', compress: 1 },
];

const dir = process.argv[2];
if (!dir) { console.error('Ordner mit den SVG-Schriften fehlt (hersheytext/svg_fonts)'); process.exit(1); }

const X_HEIGHT = GUIDES.baseline - GUIDES.xline; // x-Höhe eines Kästchens in Glyphen-Einheiten
const UNIT = 1000; // gespeichert in Tausendsteln der Kästchenhöhe, als ganze Zahlen
const EPS = 0.0015; // Vereinfachung wie beim Erfassen (draw.js)

const entity = (u) => u
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));

// SVG-Pfad → Striche (Punktfolgen in Font-Einheiten, y nach oben). Kurven werden in kurze
// Geraden zerlegt; jedes M (oder Z) beginnt einen neuen Strich.
function pathStrokes(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const strokes = [];
  let i = 0;
  let cmd = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl = null; // für S/T: gespiegelter Kontrollpunkt
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const line = (nx, ny) => { strokes.at(-1).push([nx, ny]); x = nx; y = ny; };
  const curve = (pts) => {
    // Bézier beliebigen Grades durch de Casteljau, Schritte nach Länge des Kontrollpolygons
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    const n = Math.max(2, Math.min(32, Math.ceil(len / 12)));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      let p = pts.map((q) => q.slice());
      while (p.length > 1) p = p.slice(1).map((q, k) => [p[k][0] + (q[0] - p[k][0]) * t, p[k][1] + (q[1] - p[k][1]) * t]);
      strokes.at(-1).push(p[0]);
    }
    x = pts.at(-1)[0];
    y = pts.at(-1)[1];
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = num() + ox, ny = num() + oy;
        strokes.push([[nx, ny]]);
        x = sx = nx; y = sy = ny;
        cmd = rel ? 'l' : 'L'; // weitere Zahlenpaare nach M sind Linien
        lastCtrl = null;
        break;
      }
      case 'L': line(num() + ox, num() + oy); lastCtrl = null; break;
      case 'H': line(num() + ox, y); lastCtrl = null; break;
      case 'V': line(x, num() + oy); lastCtrl = null; break;
      case 'C': {
        const c1 = [num() + ox, num() + oy], c2 = [num() + ox, num() + oy], p = [num() + ox, num() + oy];
        curve([[x, y], c1, c2, p]);
        lastCtrl = c2;
        break;
      }
      case 'S': {
        const c1 = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const c2 = [num() + ox, num() + oy], p = [num() + ox, num() + oy];
        curve([[x, y], c1, c2, p]);
        lastCtrl = c2;
        break;
      }
      case 'Q': {
        const c = [num() + ox, num() + oy], p = [num() + ox, num() + oy];
        curve([[x, y], c, p]);
        lastCtrl = c;
        break;
      }
      case 'T': {
        const c = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const p = [num() + ox, num() + oy];
        curve([[x, y], c, p]);
        lastCtrl = c;
        break;
      }
      case 'Z':
        if (strokes.length) line(sx, sy);
        lastCtrl = null;
        break;
      default:
        throw new Error(`Pfadbefehl ${cmd} wird nicht unterstützt`);
    }
  }
  return strokes.filter((s) => s.length > 0);
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

// Weiche Stauchung: Abstand e über der x-Linie bzw. unter der Grundlinie wird zu
// f·e + (1−f)·a·(1−e^(−e/a)). Steigung 1 an der Kante (kein Knick in Bögen), weit draußen f.
function squeeze(y, f) {
  if (f === 1) return y;
  const a = 0.25 * X_HEIGHT;
  const soft = (e) => f * e + (1 - f) * a * (1 - Math.exp(-e / a));
  if (y < -X_HEIGHT) return -X_HEIGHT - soft(-X_HEIGHT - y);
  if (y > 0) return soft(y);
  return y;
}

function buildFont({ id, file, compress }) {
  const svg = readFileSync(join(dir, file), 'utf8');
  const fontTag = svg.match(/<font\b[^>]*>/)?.[0] ?? '';
  const fallbackAdv = Number(attrsOf(fontTag)['horiz-adv-x'] ?? 500);
  const name = attrsOf(svg.match(/<font-face\b[^>]*>/)?.[0] ?? '')['font-family'] ?? file;
  const raw = new Map();
  for (const [tag] of svg.matchAll(/<glyph\b[^>]*>/g)) {
    const a = attrsOf(tag);
    if (a.unicode == null || !a.d) continue;
    const ch = entity(a.unicode);
    if ([...ch].length !== 1) continue;
    raw.set(ch, { adv: Number(a['horiz-adv-x'] ?? fallbackAdv), strokes: pathStrokes(a.d) });
  }

  // x-Höhe der Schrift: Oberkante der Kleinbuchstaben ohne Oberlänge
  const tops = [...'acemnorsuvwxz'].filter((c) => raw.has(c)).map((c) => Math.max(...raw.get(c).strokes.flat().map(([, y]) => y)));
  const k = X_HEIGHT / median(tops);

  // In Glyphen-Einheiten: x ab Ursprung, y nach unten, Ober- und Unterlängen gestaucht
  const scaled = new Map();
  for (const [ch, { adv, strokes }] of raw) {
    if (!CELL_CHARS.includes(ch) && !isCustomChar(ch)) continue;
    const s = strokes.map((st) => st.map(([fx, fy]) => [fx * k, squeeze(-fy * k, compress)]));
    const xs = s.flat().map(([x]) => x);
    scaled.set(ch, { adv: adv * k, strokes: s, minX: Math.min(...xs), maxX: Math.max(...xs) });
  }
  // Ränder links und rechts höchstens so breit wie bei den Kleinbuchstaben üblich (plus etwas
  // Luft). Ziffern und Satzzeichen haben in manchen Schriften Tabellenbreite und stünden sonst
  // weit auseinander.
  const lower = [...'abcdefghijklmnopqrstuvwxyz'].map((c) => scaled.get(c)).filter(Boolean);
  const maxLeft = Math.max(0, median(lower.map((g) => g.minX))) + 0.1 * X_HEIGHT;
  const maxRight = Math.max(0, median(lower.map((g) => g.adv - g.maxX))) + 0.1 * X_HEIGHT;
  for (const g of scaled.values()) {
    const cut = Math.max(0, g.minX - maxLeft);
    if (cut) g.strokes = g.strokes.map((st) => st.map(([x, y]) => [x - cut, y]));
    g.adv = Math.min(g.adv - cut, g.maxX - cut + maxRight);
  }

  const glyphs = {};
  let points = 0;
  for (const [ch, { adv, strokes }] of scaled) {
    const out = strokes
      .map((s) => simplify(s, EPS))
      .map((s) => s.map(([gx, gy]) => [Math.round(gx * UNIT), Math.round(gy * UNIT)]))
      // doppelte Punkte hintereinander weg, Punkte (i, Umlaut) bleiben als ein Punkt
      .map((s) => s.filter((p, j) => j === 0 || p[0] !== s[j - 1][0] || p[1] !== s[j - 1][1]));
    if (!out.length) continue;
    points += out.reduce((n, s) => n + s.length, 0);
    // Kompakt: Vorschub, dann je Strich erster Punkt absolut, danach Schritte;
    // Punkte mit Leerzeichen, Striche mit "|"
    const path = out.map((s) => s.map(([gx, gy], j) => (j ? `${gx - s[j - 1][0]},${gy - s[j - 1][1]}` : `${gx},${gy}`)).join(' ')).join('|');
    glyphs[ch] = `${Math.round(adv * UNIT)};${path}`;
  }
  const missing = [...new Set(CELL_CHARS)].filter((c) => !glyphs[c]);
  if (missing.length) throw new Error(`${file}: es fehlen ${missing.join(' ')}`);
  console.log(`${id.padEnd(8)} ${name}: ${Object.keys(glyphs).length} Zeichen, ${points} Punkte`);
  return { id, name, glyphs };
}

const fonts = SOURCES.map(buildFont);
const body = fonts.map((f) => `  ${f.id}: ${JSON.stringify(f.glyphs)},`).join('\n');
const out = `// Erzeugt von tools/build-presets.mjs. Nicht von Hand ändern.
// Fertige Handschriften aus Einstrich-Schriften, verändert (skaliert, vereinfacht, teils gestaucht).
// Quellen und Lizenzen: THIRD_PARTY_NOTICES.md. Die EMS-Schriften (Sheldon B. Michaels, SVG von
// Windell H. Oskay) stehen unter der SIL Open Font License 1.1 (licenses/OFL-1.1.txt), ebenso
// diese veränderten Daten. Hershey Script: The Hershey Fonts were originally created by Dr.
// A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the Font
// data in this distribution was originally created by James Hurt, Cognition, Inc.
${fonts.map((f) => `//   ${f.id}: ${f.name}`).join('\n')}
// Zeichen → "Vorschub;Striche" in Tausendsteln der Kästchenhöhe (y = 0 auf der Grundlinie,
// nach unten positiv). Je Strich der erste Punkt absolut, danach Schritte; Punkte mit " ",
// Striche mit "|". Der Vorschub reicht vom Ursprung (x = 0) bis zum nächsten Zeichen.
export const FONTS = {
${body}
};
`;
const target = fileURLToPath(new URL('../src/presets-data.js', import.meta.url));
writeFileSync(target, out);
console.log(`${(out.length / 1024).toFixed(1)} KB → ${target}`);
