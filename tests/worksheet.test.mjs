// Prüft Formate, Linierungen und das Ausfüllen von Arbeitsblättern ohne Browser:
// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { FIRST_PASS } from '../src/charset.js';
import { glyphTable } from '../src/profile.js';
import { layoutText, layoutBox, FORMATS } from '../src/layout.js';
import { pagesToPdf, pagesToGoodNotes, paperLines, RULINGS, INKS } from '../src/render.js';
import { MM, jpegInfo } from '../src/pdf.js';
import { PAGE_FORMATS, UNITS_PER_POINT } from '../src/goodnotes/writer.js';
import { readStoredZip } from '../src/goodnotes/zip.js';
import { decodeRecords } from '../src/goodnotes/proto.js';
import { ProtoWriter } from '../src/goodnotes/proto.js';
import { DEFAULT_SETTINGS, pickSettings, cleanSettings, lineSpacing, layoutOptions } from '../src/compose.js';
import { loadFonts, presetProfile, presetById } from '../src/presets.js';
import {
  estimateSkew, detectLines, rulesInBox, cellAt, fieldAt, orderFields, layoutSheet, splitAnswers,
} from '../src/worksheet.js';
import { encodeJpeg } from '../agent/thumbnail.mjs';

const latin1 = (b) => new TextDecoder('latin1').decode(b);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} statt ${b} (±${tol})`);

// Einfache eigene Handschrift: jedes Zeichen ein Strich von der Grundlinie bis zur x-Höhe.
const OWN = glyphTable({ cells: Object.fromEntries(FIRST_PASS.map((_, i) => [i, [[[0.05, 0], [0.12, -0.2], [0.2, 0]]]])) });

let printTable = null;
async function print() {
  printTable ??= glyphTable(presetProfile('print', await loadFonts()), { snap: 0 });
  return printTable;
}

// ---------- Formate und Papier ----------

test('A3 und A5: richtige Größe in Satz, PDF und GoodNotes-Datei', () => {
  near(FORMATS.a3.width / MM, 297, 0.05, 'A3 Breite');
  near(FORMATS.a3.height / MM, 420, 0.05, 'A3 Höhe');
  near(FORMATS.a5.width / MM, 148, 0.05, 'A5 Breite');
  near(FORMATS.a5.height / MM, 210, 0.05, 'A5 Höhe');
  for (const format of ['a3', 'a4', 'a5', 'standard']) {
    assert.deepEqual([PAGE_FORMATS[format].width, PAGE_FORMATS[format].height], [FORMATS[format].width, FORMATS[format].height], format);
  }
  const words = 'Wort '.repeat(2000);
  const pages = (format) => layoutText(words, OWN, { format: FORMATS[format] }).pages.length;
  assert.ok(pages('a5') > pages('a4') && pages('a4') > pages('a3'), 'kleineres Blatt, mehr Seiten');

  for (const format of ['a3', 'a5']) {
    const layout = layoutText('Hallo', OWN, { format: FORMATS[format] });
    const pdf = latin1(pagesToPdf(layout.pages, { paper: 'blank', layout }));
    assert.match(pdf, new RegExp(`MediaBox \\[0 0 ${FORMATS[format].width} ${FORMATS[format].height}\\]`));
    const [file] = pagesToGoodNotes(layout.pages, { paper: 'lined', layout });
    const events = readStoredZip(file).get('index.events.pb');
    // Seitengröße im Ereignisprotokoll, wie GoodNotes sie schreibt (fixed32, eigene Einheiten)
    const size = new ProtoWriter().fixed32f(1, FORMATS[format].width * UNITS_PER_POINT).fixed32f(2, FORMATS[format].height * UNITS_PER_POINT).result();
    assert.ok(Buffer.from(events).includes(Buffer.from(size)), `${format}: Seitengröße in index.events.pb`);
  }
});

test('Liniert breit und schmal: fester Linienabstand, Schrift sitzt auf den Linien', () => {
  assert.deepEqual(RULINGS, { lined: 8.7, narrow: 6.35 });
  assert.equal(lineSpacing({ ...DEFAULT_SETTINGS, paper: 'narrow' }), 6.35);
  assert.equal(lineSpacing({ ...DEFAULT_SETTINGS, paper: 'lined' }), 8.7);
  assert.equal(lineSpacing({ ...DEFAULT_SETTINGS, paper: 'grid', lines: 11 }), 11, 'kariert und leer: eigener Abstand');
  for (const paper of ['lined', 'narrow']) {
    const settings = { ...DEFAULT_SETTINGS, paper };
    const layout = layoutText('eins\nzwei\ndrei', OWN, layoutOptions(settings, null));
    const lines = paperLines(layout.pages[0], paper, layout).map(([, y]) => y);
    near((lines[1] - lines[0]) / MM, RULINGS[paper], 1e-9, `${paper}: Linienabstand`);
    // Unterkante jeder Textzeile liegt auf einer Linie
    const bottoms = [...new Set(layout.pages[0].strokes.map((s) => Math.round(Math.max(...s.points.map(([, y]) => y)))))];
    for (const b of bottoms) assert.ok(lines.some((y) => Math.abs(y - b) < 1.5), `${paper}: Zeile bei ${b} auf einer Linie`);
  }
  const narrowPdf = latin1(pagesToPdf(layoutText('x', OWN, layoutOptions({ ...DEFAULT_SETTINGS, paper: 'narrow' }, null)).pages,
    { paper: 'narrow', layout: layoutText('x', OWN, layoutOptions({ ...DEFAULT_SETTINGS, paper: 'narrow' }, null)) }));
  const widePdf = latin1(pagesToPdf(layoutText('x', OWN, layoutOptions(DEFAULT_SETTINGS, null)).pages,
    { paper: 'lined', layout: layoutText('x', OWN, layoutOptions(DEFAULT_SETTINGS, null)) }));
  assert.ok((narrowPdf.match(/ l S/g) ?? []).length > (widePdf.match(/ l S/g) ?? []).length, 'schmal hat mehr Linien');
});

test('Einstellungen: neue Werte und Namen aus Links und von Agenten', () => {
  assert.deepEqual(pickSettings({ paper: 'Liniert-Schmal', format: 'A5' }).settings, { paper: 'narrow', format: 'a5' });
  assert.deepEqual(pickSettings({ paper: 'breit', format: 'din-a3' }).settings, { paper: 'lined', format: 'a3' });
  assert.deepEqual(pickSettings({ paper: 'wide-ruled' }).settings, { paper: 'lined' });
  assert.deepEqual(pickSettings({ paper: 'narrow-ruled' }).settings, { paper: 'narrow' });
  assert.deepEqual(pickSettings({ format: 'b5', paper: 'gepunktet' }).invalid, ['paper', 'format']);
  assert.deepEqual(cleanSettings({ paper: 'narrow', format: 'a3' }), { paper: 'narrow', format: 'a3' });
});

// ---------- Arbeitsblatt: Linien finden ----------

// Synthetisches Blatt in Graustufen, 150 dpi, mit Antwortlinien, Punktlinie, Lückentext,
// Tabelle, Textabsatz und dickem Balken.
function worksheetRaster({ angle = 0 } = {}) {
  const scale = 150 / 72;
  const W = Math.round(595.28 * scale);
  const H = Math.round(841.89 * scale);
  const gray = new Uint8Array(W * H).fill(250);
  const px = (mm) => mm * MM * scale;
  const tilt = Math.tan((angle * Math.PI) / 180);
  const rect = (x0, y0, w, h, v = 20) => {
    const xa = Math.round(px(x0));
    const xb = Math.round(px(x0 + w));
    for (let x = xa; x < xb; x++) {
      const dy = (x - W / 2) * tilt;
      const ya = Math.round(px(y0) + dy);
      const yb = Math.max(ya + 1, Math.round(px(y0 + h) + dy));
      for (let y = ya; y < yb; y++) gray[y * W + x] = v;
    }
  };
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const text = (x0, baseline, x1) => {
    for (let x = x0; x < x1;) {
      for (let i = 0, n = 2 + Math.floor(rnd() * 6); i < n && x < x1; i++, x += 1.6) {
        const tall = rnd() < 0.3;
        rect(x, baseline - (tall ? 3 : 2), 0.3, tall ? 3 : 2);
        rect(x, baseline - 2, 1.2, 0.3);
        rect(x, baseline - 0.3, 1.2, 0.3);
        rect(x + 0.9, baseline - 2, 0.3, 2);
      }
      x += 2.2;
    }
  };
  text(20, 60, 190);
  text(20, 66, 150);
  for (const y of [80, 89, 98]) rect(20, y, 170, 0.3);
  for (let x = 20; x < 120; x += 1.2) rect(x, 120, 0.4, 0.4);
  text(20, 140, 70);
  rect(72, 139.9, 35, 0.25, 40);
  text(110, 140, 160);
  for (const y of [160, 170, 180]) rect(20, y, 170, 0.35);
  for (const x of [20, 80, 190]) rect(x, 160, 0.35, 20.35);
  text(22, 167, 70);
  rect(20, 200, 170, 6, 30);
  return { gray, W, H, scale };
}

test('Arbeitsblatt: Antwortlinien, Punktlinie, Lücke und Tabelle werden gefunden, Text und Balken nicht', () => {
  const { gray, W, H, scale } = worksheetRaster();
  const { rules, columns } = detectLines(gray, W, H, scale);
  const mm = (v) => v / MM;
  const at = (y) => rules.filter((r) => Math.abs(mm(r.y) - y) < 0.6);
  for (const y of [80, 89, 98]) {
    assert.equal(at(y).length, 1, `Antwortlinie ${y} mm`);
    near(mm(at(y)[0].x0), 20, 0.6, 'Linie beginnt');
    near(mm(at(y)[0].x1), 190, 0.6, 'Linie endet');
  }
  near(mm(at(120)[0].x1), 120, 1.5, 'Punktlinie ganz');
  near(mm(at(139.9)[0].x0), 72, 0.8, 'Lücke beginnt nach dem Text, nicht darin');
  near(mm(at(139.9)[0].x1), 107, 0.8, 'Lücke endet vor dem Text');
  assert.ok(at(139.9)[0].free > 15 * MM, 'über der Lücke ist Platz');
  for (const y of [160, 170, 180]) assert.equal(at(y).length, 1, `Tabellenrand ${y} mm`);
  assert.ok(at(170)[0].free < 5 * MM, 'in der Zelle darüber steht Text');
  assert.deepEqual(columns.map((c) => Math.round(mm(c.x))), [20, 80, 190], 'senkrechte Tabellenränder');
  for (const y of [58, 60, 64, 66, 167, 200, 203, 206]) assert.equal(at(y).length, 0, `bei ${y} mm keine Linie (Text oder Balken)`);
  assert.equal(rules.length, 8, "3 Antwortlinien, Punktlinie, Lücke, 3 Tabellenränder");
});

test('Arbeitsblatt: schiefes Foto wird erkannt und gerade gerückt', () => {
  for (const angle of [0, 0.7, -1.6, 3]) {
    const { gray, W, H } = worksheetRaster({ angle });
    near(estimateSkew(gray, W, H), angle, 0.08, `${angle}°`);
  }
});

test('Arbeitsblatt: Tipp auf Linie, Lücke oder Zelle ergibt das passende Feld', () => {
  const { gray, W, H, scale } = worksheetRaster();
  const page = { width: 595.28, height: 841.89, ...detectLines(gray, W, H, scale) };
  const tap = (x, y) => {
    const f = fieldAt(page, x * MM, y * MM);
    return { x: f.x / MM, y: f.y / MM, w: f.w / MM, h: f.h / MM, snapped: f.snapped, rules: rulesInBox(page.rules, f).map((r) => Math.round(r.y / MM)) };
  };
  // Drei Antwortlinien: ein Feld über alle, egal welche angetippt wird
  for (const y of [77, 87, 95]) {
    const f = tap(60, y);
    assert.deepEqual(f.rules, [80, 89, 98], `Tipp bei ${y} mm`);
    near(f.x, 20, 0.6, 'links bündig mit den Linien');
    near(f.w, 170, 1.2, 'so breit wie die Linien');
  }
  // Lücke im Text: nur die Lücke, mit Platz darüber
  const gap = tap(85, 137);
  assert.deepEqual(gap.rules, [140]);
  near(gap.x, 72, 0.8, 'Lücke');
  assert.ok(gap.w < 37 && gap.h >= 5, 'schmal wie die Lücke, Platz zum Schreiben');
  // Tabellenzelle: genau die Zelle, ohne ihre Ränder (Text steht dann mittig darin)
  const cell = tap(120, 176);
  assert.deepEqual(cell.rules, []);
  assert.ok(cell.x > 80 && cell.x < 82 && cell.x + cell.w < 190 && cell.x + cell.w > 187, `Zelle waagerecht: ${cell.x}–${cell.x + cell.w}`);
  assert.ok(cell.y > 170 && cell.y + cell.h < 180, `Zelle senkrecht: ${cell.y}–${cell.y + cell.h}`);
  assert.equal(cellAt(page, 60 * MM, 85 * MM), null, 'Antwortlinien sind keine Tabelle');
  // Nichts in der Nähe: Feld für eine Zeile
  const free = tap(100, 300);
  assert.equal(free.snapped, false);
  near(free.h, 10, 0.01, 'freies Feld');
});

// ---------- Arbeitsblatt: Text in Felder setzen ----------

test('Feld mit Linien: Text steht auf den Linien, zu viel Text wird kleiner und meldet Überlauf', async () => {
  const table = await print();
  const rules = [80, 89, 98].map((y) => ({ y: y * MM, x0: 20 * MM, x1: 190 * MM }));
  const box = { x: 20 * MM, y: 72 * MM, w: 170 * MM, h: 27 * MM, rules };
  const o = { letterSpacing: 0.18 + presetById('print').spacing, minGap: -0.06 };
  const bottoms = (strokes) => strokes.map((s) => Math.max(...s.points.map(([, y]) => y)) / MM);

  const short = layoutBox('Zellwand und Kern', table, box, o); // ohne Unterlängen
  assert.equal(short.lines, 1);
  assert.equal(short.overflow, false);
  assert.equal(short.xHeightMm, 3.2, 'volle Größe');
  const low = bottoms(short.strokes).filter((b) => b > 78);
  assert.ok(low.every((b) => b < 80.6), 'auf der ersten Linie, nicht darunter');

  const long = layoutBox('Eine Zelle ist die kleinste Einheit des Lebens. '.repeat(3), table, box, o);
  assert.equal(long.lines, 3);
  assert.equal(long.overflow, false);
  const xs = long.strokes.flatMap((s) => s.points.map(([x]) => x / MM));
  assert.ok(Math.min(...xs) >= 20 && Math.max(...xs) <= 190, 'bleibt zwischen Anfang und Ende der Linien');

  const tooMuch = layoutBox('Viel zu viel Text für drei Linien. '.repeat(12), table, box, o);
  assert.equal(tooMuch.overflow, true);
  assert.equal(tooMuch.xHeightMm, 1.5, 'bis zur kleinsten Schrift verkleinert');
});

test('Feld ohne Linien: Tabellenzelle mittig, großes Feld von oben, Schrift passt sich an', async () => {
  const table = await print();
  const cell = { x: 81 * MM, y: 171 * MM, w: 107 * MM, h: 7.3 * MM };
  const r = layoutBox('steuert die Zelle', table, cell, {});
  assert.equal(r.overflow, false);
  assert.ok(r.xHeightMm < 3.2 && r.xHeightMm > 1.9, `kleiner für eine 7,3-mm-Zelle: ${r.xHeightMm}`);
  const ys = r.strokes.flatMap((s) => s.points.map(([, y]) => y / MM));
  assert.ok(Math.min(...ys) >= 171 && Math.max(...ys) <= 178.3, 'ganz in der Zelle');
  near((Math.min(...ys) + Math.max(...ys)) / 2, 171 + 7.3 / 2, 1.2, 'etwa mittig');

  const big = layoutBox('Oben', table, { x: 20 * MM, y: 200 * MM, w: 120 * MM, h: 60 * MM }, {});
  const top = Math.min(...big.strokes.flatMap((s) => s.points.map(([, y]) => y / MM)));
  assert.ok(top < 205, `großes Feld: Text beginnt oben (${top})`);
});

test('Ganzes Arbeitsblatt: Felder auf ihren Seiten, Bild darunter, fehlende Zeichen gesammelt', () => {
  const jpeg = encodeJpeg({ width: 16, height: 22, rgb: new Float32Array(16 * 22 * 3).fill(1) });
  const pages = [
    { width: 595.28, height: 841.89, jpeg, rules: [{ y: 80 * MM, t: 0.3 * MM, x0: 20 * MM, x1: 190 * MM, free: 10 * MM }] },
    { width: 841.89, height: 595.28, jpeg, rules: [] },
  ];
  const fields = [
    { id: 'a', page: 0, x: 20 * MM, y: 72 * MM, w: 170 * MM, h: 9 * MM, text: 'Hallo' },
    { id: 'b', page: 1, x: 20 * MM, y: 20 * MM, w: 60 * MM, h: 10 * MM, text: 'Welt →' },
    { id: 'c', page: 1, x: 20 * MM, y: 40 * MM, w: 60 * MM, h: 10 * MM, text: '   ' },
  ];
  const res = layoutSheet(pages, fields, OWN, { seed: 3 });
  assert.equal(res.pages.length, 2);
  assert.equal(res.pages[1].width, 841.89, 'Querformat bleibt');
  assert.ok(res.pages[0].strokes.length && res.pages[1].strokes.length);
  assert.equal(res.pages[0].image.jpeg, jpeg);
  assert.deepEqual(res.missing, ['→']);
  assert.deepEqual([...res.fields.keys()], ['a', 'b'], 'leere Felder werden übersprungen');
  // Gleiches Feld, gleiche Handschrift; anderer Startwert, andere
  const again = layoutSheet(pages, fields, OWN, { seed: 3 });
  assert.deepEqual(again.pages[0].strokes, res.pages[0].strokes);

  // PDF: Blatt als Bild unter der Handschrift, Seiten in ihrer Größe
  const pdf = latin1(pagesToPdf(res.pages, { paper: 'blank', ink: INKS.blau.rgb, layout: res }));
  assert.equal((pdf.match(/\/Subtype \/Image/g) ?? []).length, 1, 'gleiches Bild nur einmal eingebettet');
  assert.match(pdf, /\/Filter \/DCTDecode/);
  assert.match(pdf, /\/XObject << \/Im1 \d+ 0 R >>/);
  assert.match(pdf, /MediaBox \[0 0 841.89 595.28\]/);
  assert.deepEqual(jpegInfo(jpeg), { width: 16, height: 22, components: 3 });

  // GoodNotes: eine Datei je Seite, Hintergrund-PDF mit dem Blatt, Striche wie sonst
  const files = pagesToGoodNotes(res.pages, { paper: 'blank', ink: INKS.blau.rgb, layout: res });
  assert.equal(files.length, 2);
  const entries = readStoredZip(files[1]);
  const bg = entries.get([...entries.keys()].find((n) => n.startsWith('attachments/')));
  assert.match(latin1(bg), /\/DCTDecode/);
  assert.match(latin1(bg), /MediaBox \[0 0 841.89 595.28\]/);
  const notes = [...entries.keys()].find((n) => n.startsWith('notes/'));
  assert.equal(decodeRecords(entries.get(notes)).length, res.pages[1].strokes.length * 2);
});

test('Felder: Lesereihenfolge und Antworten auf einmal verteilen', () => {
  const f = (id, page, y, x = 20) => ({ id, page, x: x * MM, y: y * MM, w: 50 * MM, h: 10 * MM });
  const order = orderFields([f('c', 1, 10), f('b', 0, 100), f('a2', 0, 20, 120), f('a1', 0, 21)]).map((x) => x.id);
  assert.deepEqual(order, ['a1', 'a2', 'b', 'c'], 'Seite, dann oben nach unten, auf einer Höhe von links');

  assert.deepEqual(splitAnswers('Hier die Antworten:\n1. Zelle\n2. Wand\n3) Kern', 3), ['Zelle', 'Wand', 'Kern']);
  assert.deepEqual(splitAnswers('2. zweite\n1. erste', 3), ['erste', 'zweite'], 'Nummern bestimmen das Feld');
  assert.deepEqual(splitAnswers('a) Erstens\nb) Zweitens\nmit zwei Zeilen', 2), ['Erstens', 'Zweitens\nmit zwei Zeilen']);
  assert.deepEqual(splitAnswers('- eins\n- zwei', 5), ['eins', 'zwei'], 'Spiegelstriche der Reihe nach');
  assert.deepEqual(splitAnswers('Absatz eins\nnoch eins\n\nAbsatz zwei', 2), ['Absatz eins\nnoch eins', 'Absatz zwei']);
  assert.deepEqual(splitAnswers('Zeile eins\nZeile zwei\nZeile drei', 2), ['Zeile eins', 'Zeile zwei']);
  assert.deepEqual(splitAnswers('1. a\n2. b', 1), ['1. a\n2. b'], 'ein Feld bekommt alles');
  const sparse = splitAnswers('1. a\n7. g', 3);
  assert.equal(sparse[0], 'a');
  assert.equal(sparse.length, 1, 'Nummer ohne Feld fällt weg');
  assert.deepEqual(splitAnswers('   ', 3), []);
});
