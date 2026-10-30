// Welche Zeichen erfasst werden, wie oft, und wie ein Schreibkästchen aussieht.

const LOWER = [...'abcdefghijklmnopqrstuvwxyzäöüß'];
const UPPER = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'];
const DIGITS = [...'0123456789'];
const PUNCT = [...'.,!?:;-\'"()/&+=%€@'];
// Häufigste Kleinbuchstaben im Deutschen bekommen eine vierte Variante.
const FREQUENT = [...'enisratdhu'];

// Reihenfolge der Kästchen: in Durchgängen statt "aaa bbb", damit die
// Varianten eines Buchstabens nicht direkt nacheinander geschrieben werden.
// Nach dem ersten Durchgang ist jedes Zeichen einmal da.
const FIRST_PASS = [...LOWER, ...UPPER, ...DIGITS, ...PUNCT];
const BASE_CHARS = [
  ...FIRST_PASS,
  ...LOWER, ...UPPER,
  ...LOWER, ...DIGITS,
  ...FREQUENT,
];
const BASE_CELLS = BASE_CHARS.length;

// Freiwillige Zusatz-Durchgänge: noch fünfmal alles, für mehr Abwechslung beim Setzen.
// Sie hängen hinten an, damit die Nummern der übrigen Kästchen gleich bleiben
// (Profildateien, Mitnehmen-Links, Artifact).
const EXTRA_PASSES = 5;
const CELL_CHARS = [...BASE_CHARS, ...Array.from({ length: EXTRA_PASSES }, () => FIRST_PASS).flat()];

// Überschrift je Kästchen, parallel zu CELL_CHARS: sagt beim Blättern, wo man gerade ist.
const tag = (chars, group) => chars.map(() => group);
const CELL_GROUPS = [
  ...tag(LOWER, 'Kleinbuchstaben'), ...tag(UPPER, 'Großbuchstaben'), ...tag(DIGITS, 'Ziffern'), ...tag(PUNCT, 'Satzzeichen'),
  ...tag([...LOWER, ...UPPER], '2. Variante'),
  ...tag([...LOWER, ...DIGITS], '3. Variante'),
  ...tag(FREQUENT, '4. Variante'),
  ...Array.from({ length: EXTRA_PASSES }, (_, p) => tag(FIRST_PASS, `Zusatz ${p + 1}/${EXTRA_PASSES}`)).flat(),
];

// Zeichen außerhalb der Liste, die man selbst nachschreiben kann ("Fehlt: *"):
// ein einzelnes sichtbares Zeichen, das nicht schon ein eigenes Kästchen hat.
const isCustomChar = (c) => typeof c === 'string' && /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(c) && !CELL_CHARS.includes(c);

// Zeichen, deren Unterkante auf der Grundlinie liegt. Bei ihnen wird die
// geschriebene Unterkante leicht auf die Grundlinie gezogen.
const SITS_ON_BASELINE = new Set([
  ...'abcdehiklmnorstuvwxzäöüß', ...UPPER, ...DIGITS, ...'.!?%&€@',
]);

// Zeichen ohne Ober- und Unterlänge: daraus wird die x-Höhe gemessen.
const X_HEIGHT_CHARS = new Set([...'acemnorsuvwxz']);

// ---- Schreibkästchen ----
// Glyphen-Koordinaten: Einheit = Kästchenhöhe, x ab linkem Kästchenrand,
// y = 0 auf der Grundlinie, nach unten positiv.

const BOX_ASPECT = 1.15; // Breite / Höhe
// Hilfslinien als Anteil der Kästchenhöhe, von oben gemessen.
const GUIDES = { ascender: 0.18, xline: 0.46, baseline: 0.7 };

const fromTop = (glyphY) => glyphY + GUIDES.baseline;
const toGlyphY = (fractionFromTop) => fractionFromTop - GUIDES.baseline;

export { LOWER, UPPER, DIGITS, PUNCT, FREQUENT, FIRST_PASS, BASE_CELLS, EXTRA_PASSES, CELL_CHARS, CELL_GROUPS, isCustomChar, SITS_ON_BASELINE, X_HEIGHT_CHARS, BOX_ASPECT, GUIDES, fromTop, toGlyphY };
