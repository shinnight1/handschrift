// Macht aus einer Einstrich-SVG-Schrift (EMS-Fonts aus dem npm-Paket hersheytext) das Modul
// landing/hand-font.js für den Film auf der Startseite: pro Zeichen Vorschub und Striche.
// node tools/build-hand-font.mjs <EMSFelix.svg>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('Pfad zur SVG-Schrift fehlt'); process.exit(1); }
const svg = readFileSync(src, 'utf8');
const fallback = Number(svg.match(/<font[^>]*horiz-adv-x="([\d.]+)"/)[1]);

const entity = (u) => u
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const WANT = new Set([...'abcdefghijklmnopqrstuvwxyzäöüßABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789 .,:;!?-\'"()/&+=%@']);
const glyphs = {};
for (const [, attrs] of svg.matchAll(/<glyph ([^>]*)\/>/g)) {
  const u = attrs.match(/unicode="([^"]*)"/)?.[1];
  if (u == null) continue;
  const ch = entity(u);
  if (!WANT.has(ch)) continue;
  const adv = Math.round(Number(attrs.match(/horiz-adv-x="([\d.]+)"/)?.[1] ?? fallback));
  const d = attrs.match(/ d="([^"]*)"/)?.[1] ?? '';
  // Nur M und L: jedes M beginnt einen neuen Strich. y zeigt im Modul nach unten.
  const strokes = [];
  for (const [, cmd, nums] of d.matchAll(/([ML])\s*([-\d.\s]+)/g)) {
    const [x, y] = nums.trim().split(/\s+/).map(Number);
    if (cmd === 'M') strokes.push([]);
    strokes.at(-1).push(Math.round(x), -Math.round(y));
  }
  glyphs[ch] = [adv, strokes];
}

const missing = [...WANT].filter((c) => !glyphs[c]);
if (missing.length) console.warn('Fehlt:', missing.join(' '));

const out = `// Erzeugt von tools/build-hand-font.mjs aus EMS Felix (SIL Open Font License,
// Sheldon B. Michaels nach Felipa von Fontstage). Nicht von Hand ändern.
// Zeichen → [Vorschub, Striche]; Striche als x,y-Folgen in Font-Einheiten (1000 pro em), y nach unten.
export const GLYPHS = ${JSON.stringify(glyphs)};
`;
const target = fileURLToPath(new URL('../landing/hand-font.js', import.meta.url));
writeFileSync(target, out);
console.log(`${Object.keys(glyphs).length} Zeichen, ${(out.length / 1024).toFixed(1)} KB → ${target}`);
