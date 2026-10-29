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
const CELL_CHARS = [
  ...FIRST_PASS,
  ...LOWER, ...UPPER,
  ...LOWER, ...DIGITS,
  ...FREQUENT,
];

// Überschrift je Kästchen, parallel zu CELL_CHARS: sagt beim Blättern, wo man gerade ist.
const tag = (chars, group) => chars.map(() => group);
const CELL_GROUPS = [
  ...tag(LOWER, 'Kleinbuchstaben'), ...tag(UPPER, 'Großbuchstaben'), ...tag(DIGITS, 'Ziffern'), ...tag(PUNCT, 'Satzzeichen'),
  ...tag([...LOWER, ...UPPER], '2. Variante'),
  ...tag([...LOWER, ...DIGITS], '3. Variante'),
  ...tag(FREQUENT, '4. Variante'),
];

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

export { LOWER, UPPER, DIGITS, PUNCT, FREQUENT, FIRST_PASS, CELL_CHARS, CELL_GROUPS, SITS_ON_BASELINE, X_HEIGHT_CHARS, BOX_ASPECT, GUIDES, fromTop, toGlyphY };
