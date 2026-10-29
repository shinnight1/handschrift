// Prüft die Teile ohne Browser: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL_CHARS, FIRST_PASS } from '../src/charset.js';
import { round4 } from '../src/geometry.js';
import { glyphTable, parseProfile } from '../src/profile.js';
import { layoutText, FORMATS } from '../src/layout.js';
import { pagesToGoodNotes, pagesToPdf, INKS } from '../src/render.js';
import { readStoredZip } from '../src/goodnotes/zip.js';
import { appleLz4Compress, appleLz4Decompress } from '../src/goodnotes/lz4.js';
import { encodeBallpoint, ballpointFromTpl } from '../src/goodnotes/tpl.js';
import { decodeRecords } from '../src/goodnotes/proto.js';
import { handoffLink, readHandoff, packCells, unpackCells } from '../src/handoff.js';
import { encodeStrokes, decodeStrokes } from '../src/store.js';

// Erfundene Handschrift: jedes Kästchen 1–3 krumme Striche mit 4 Nachkommastellen.
function fakeCells(count = CELL_CHARS.length) {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const cells = {};
  for (let i = 0; i < count; i++) {
    const strokes = [];
    for (let s = 0, n = 1 + Math.floor(rnd() * 3); s < n; s++) {
      const pts = [];
      let x = 0.1 + rnd() * 0.1;
      let y = -0.02 - rnd() * 0.2;
      for (let k = 0; k < 12; k++) {
        x += 0.02 + rnd() * 0.01;
        y += (rnd() - 0.5) * 0.04;
        pts.push([round4(x), round4(Math.min(0, y))]);
      }
      strokes.push(pts);
    }
    cells[i] = strokes;
  }
  return cells;
}

const SETTINGS = { format: 'standard', paper: 'lined', ink: 'blau', size: 3.2, lines: 9, letters: 0.18, words: 0.9, natural: 0.5, pen: 0.35, seed: 5 };

function setText(cells, text, format = 'standard') {
  return layoutText(text, glyphTable({ cells }), { format: FORMATS[format], seed: 5 });
}

test('Mitnehmen-Link bringt Striche, Text und Einstellungen unverändert zurück', async () => {
  const cells = fakeCells();
  const text = 'Grüße „aus“ Beesten – 100 € & mehr!\nZweite Zeile.';
  const link = await handoffLink({ cells, text, settings: SETTINGS }, 'https://example.org/handschrift/');
  assert.match(link, /^https:\/\/example\.org\/handschrift\/#gn1=[A-Za-z0-9_-]+$/);
  const back = await readHandoff(link.slice(link.indexOf('#')));
  assert.deepEqual(back.cells, cells);
  assert.equal(back.text, text);
  assert.deepEqual(back.settings, SETTINGS);
});

test('Kaputte oder fremde Links werden erkannt', async () => {
  assert.equal(await readHandoff('#setzen'), null);
  assert.equal(await readHandoff('#gn1='), null);
  await assert.rejects(readHandoff('#gn1=AAAA'), /beschädigt/);
  assert.deepEqual(unpackCells('999:1,1;x:2,2'), {});
  assert.deepEqual(unpackCells(packCells({})), {});
});

test('Profil übersteht Speichern und Profildatei', () => {
  const cells = fakeCells(20);
  for (const strokes of Object.values(cells)) assert.deepEqual(decodeStrokes(encodeStrokes(strokes)), strokes);
  const profile = parseProfile(JSON.stringify({ app: 'handschrift', version: 1, cells }));
  assert.deepEqual(profile.cells, cells);
  assert.throws(() => parseProfile('{"app":"anders","cells":{}}'), /keine Handschrift-Profildatei/);
});

test('Satz bricht um, verteilt auf Seiten und meldet fehlende Zeichen', () => {
  const cells = fakeCells(FIRST_PASS.length);
  const layout = setText(cells, 'Hallo Welt '.repeat(400) + '§');
  assert.ok(layout.pages.length > 1, 'mehrere Seiten');
  assert.deepEqual(layout.missing, ['§']);
  for (const page of layout.pages) {
    for (const st of page.strokes) {
      for (const [x, y] of st.points) {
        assert.ok(x >= 0 && x <= page.width && y >= 0 && y <= page.height, 'Punkt liegt auf der Seite');
      }
    }
  }
});

test('LZ4 und Kugelschreiber-TPL kommen unverändert zurück', () => {
  const data = new TextEncoder().encode('Handschrift '.repeat(9000));
  assert.deepEqual(appleLz4Decompress(appleLz4Compress(data)).data, data);
  const points = [[1, 2], [3.5, 4.25], [5, 6], [7, 8.5], [9, 10]];
  const back = ballpointFromTpl(encodeBallpoint(1.5, points));
  assert.equal(back.width, 1.5);
  assert.deepEqual(back.points.slice(0, points.length), points);
});

test('.goodnotes-Datei: vollständiges ZIP mit einem Strich-Paar pro Strich', () => {
  const cells = fakeCells();
  for (const format of ['standard', 'a4']) {
    const layout = setText(cells, 'Liebe Oma, vielen Dank!', format);
    const [file] = pagesToGoodNotes(layout.pages, { format, paper: 'grid', ink: INKS.blau.rgb, layout });
    const entries = readStoredZip(file);
    for (const name of ['schema.pb', 'index.events.pb', 'index.notes.pb', 'index.attachments.pb', 'document.info.pb']) {
      assert.ok(entries.has(name), name);
    }
    const notes = [...entries.keys()].find((n) => n.startsWith('notes/'));
    // Je Strich ein Kopf- und ein Inhaltsdatensatz.
    assert.equal(decodeRecords(entries.get(notes)).length, layout.pages[0].strokes.length * 2);
    const bg = entries.get([...entries.keys()].find((n) => n.startsWith('attachments/')));
    assert.equal(new TextDecoder().decode(bg.subarray(0, 5)), '%PDF-');
  }
});

test('PDF hat eine Seite pro gesetzter Seite', () => {
  const layout = setText(fakeCells(), 'Wort '.repeat(900));
  const pdf = new TextDecoder('latin1').decode(pagesToPdf(layout.pages, { paper: 'lined', ink: INKS.schwarz.rgb, layout }));
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.includes(`/Count ${layout.pages.length}`));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
});
