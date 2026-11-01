// Prüft die Teile ohne Browser: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL_CHARS, FIRST_PASS, BASE_CELLS, EXTRA_PASSES, isCustomChar } from '../src/charset.js';
import { round4 } from '../src/geometry.js';
import { glyphTable, parseProfile, createProfile } from '../src/profile.js';
import { serialize, deserialize, fingerprint, mergeProfiles, syncProfile } from '../src/sync.js';
import { layoutText, FORMATS } from '../src/layout.js';
import { pagesToGoodNotes, pagesToPdf, INKS } from '../src/render.js';
import { readStoredZip } from '../src/goodnotes/zip.js';
import { appleLz4Compress, appleLz4Decompress } from '../src/goodnotes/lz4.js';
import { encodeBallpoint, ballpointFromTpl } from '../src/goodnotes/tpl.js';
import { decodeRecords } from '../src/goodnotes/proto.js';
import { handoffLink, readHandoff, packCells, unpackCells } from '../src/handoff.js';
import { encodeStrokes, decodeStrokes } from '../src/store.js';
import { readFileSync } from 'node:fs';
import { moduleList } from '../tools/version.mjs';

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

test('Zusatz-Durchgänge hängen hinten an, die alten Kästchen behalten ihre Nummer', () => {
  assert.equal(BASE_CELLS, 196);
  assert.equal(CELL_CHARS.length, BASE_CELLS + EXTRA_PASSES * FIRST_PASS.length);
  assert.deepEqual(CELL_CHARS.slice(0, FIRST_PASS.length), FIRST_PASS);
  assert.deepEqual(CELL_CHARS.slice(BASE_CELLS, BASE_CELLS + FIRST_PASS.length), FIRST_PASS);
  // Mehr Kästchen je Zeichen = mehr Varianten beim Setzen.
  assert.equal(glyphTable({ cells: fakeCells() }).get('b').length, 3 + EXTRA_PASSES);
});

test('Eigene Zeichen: schließen die Lücke und reisen mit Datei und Link', async () => {
  assert.ok(isCustomChar('*') && isCustomChar('§') && isCustomChar('#'));
  assert.ok(!isCustomChar('a') && !isCustomChar(' ') && !isCustomChar('\uFE0F') && !isCustomChar('ab'));
  const cells = fakeCells(FIRST_PASS.length);
  const custom = { '*': fakeCells(1)[0], ':;|': fakeCells(1)[0] };
  assert.deepEqual(setText(cells, 'a * b').missing, ['*']);
  assert.deepEqual(layoutText('a * b', glyphTable({ cells, custom }), { format: FORMATS.a4 }).missing, []);

  const profile = parseProfile(JSON.stringify({ app: 'handschrift', version: 1, cells, custom }));
  assert.deepEqual(profile.custom, { '*': custom['*'] }, 'nur gültige eigene Zeichen');

  const link = await handoffLink({ cells, custom: profile.custom, text: 'a*', settings: SETTINGS }, 'https://example.org/');
  const back = await readHandoff(link.slice(link.indexOf('#')));
  assert.deepEqual(back.custom, profile.custom);
  const old = await handoffLink({ cells, text: 'a', settings: SETTINGS }, 'https://example.org/');
  assert.deepEqual((await readHandoff(old.slice(old.indexOf('#')))).custom, {}, 'Links ohne eigene Zeichen (Artifact) gehen weiter');
});

// Kopie in Google Drive, nur im Speicher.
function fakeRemote(text = null) {
  return {
    text,
    writes: 0,
    async read() { return this.text; },
    async write(t) { this.text = t; this.writes++; },
  };
}
const pick = (cells, keys) => Object.fromEntries(keys.map((k) => [k, cells[k]]));
const prof = (cells, custom = {}) => ({ ...createProfile(), cells, custom });

test('Abgleich: beim ersten Anmelden bleibt alles, was schon auf dem Gerät ist', async () => {
  const all = fakeCells(10);
  const other = fakeCells(10);
  // Leere Kopie: das Gerät wird hochgeladen, lokal ändert sich nichts.
  const empty = fakeRemote();
  const first = await syncProfile({ local: prof(pick(all, [0, 1, 2])), base: null, remote: empty });
  assert.equal(first.action, 'upload');
  assert.equal(first.profile, null);
  assert.deepEqual(deserialize(empty.text).cells, pick(all, [0, 1, 2]));

  // Kopie mit anderem a (0) und zusätzlichem b (1): das a des Geräts bleibt, b kommt dazu.
  const remote = fakeRemote(serialize(prof({ 0: other[0], 1: other[1] }, { '*': other[5] })));
  const res = await syncProfile({ local: prof({ 0: all[0], 4: all[4] }), base: null, remote });
  assert.equal(res.action, 'merge');
  assert.deepEqual(res.profile.cells, { 0: all[0], 1: other[1], 4: all[4] });
  assert.deepEqual(res.profile.custom, { '*': other[5] });
  assert.deepEqual(deserialize(remote.text).cells, res.profile.cells, 'Kopie hat danach dasselbe');
  assert.equal(res.base, fingerprint(res.profile));

  // Neues Gerät ohne Handschrift (oder Safari hat aufgeräumt): alles aus der Kopie.
  const restore = await syncProfile({ local: prof({}), base: null, remote });
  assert.equal(restore.action, 'download');
  assert.deepEqual(restore.profile.cells, res.profile.cells);
});

test('Abgleich danach: nur die geänderte Seite zählt', async () => {
  const c = fakeCells(10);
  const start = prof(pick(c, [0, 1, 2]));
  const remote = fakeRemote(serialize(start));
  const base = fingerprint(start);

  const same = await syncProfile({ local: start, base, remote });
  assert.equal(same.action, 'same');
  assert.equal(remote.writes, 0);

  // Hier weitergeschrieben: hochladen.
  const more = prof(pick(c, [0, 1, 2, 3]));
  const up = await syncProfile({ local: more, base, remote });
  assert.equal(up.action, 'upload');
  assert.deepEqual(deserialize(remote.text).cells, more.cells);

  // Auf dem anderen Gerät gelöscht, hier unverändert: Löschen kommt an.
  const cleared = fakeRemote(serialize(prof({})));
  const down = await syncProfile({ local: more, base: up.base, remote: cleared });
  assert.equal(down.action, 'download');
  assert.deepEqual(down.profile.cells, {});

  // Beide geändert: zusammenlegen, dieses Gerät gewinnt.
  const theirs = fakeRemote(serialize(prof({ ...pick(c, [0, 1, 2, 3]), 1: c[9], 5: c[5] })));
  const mine = prof({ ...pick(c, [0, 1, 2, 3]), 1: c[8], 6: c[6] });
  const both = await syncProfile({ local: mine, base: up.base, remote: theirs });
  assert.equal(both.action, 'merge');
  assert.deepEqual(both.profile.cells, { ...pick(c, [0, 2, 3, 5, 6]), 1: c[8] });
});

test('Kopie: gleicher Inhalt gibt gleichen Text, fremde Dateien werden abgelehnt', () => {
  const c = fakeCells(5);
  const a = prof({ 3: c[3], 0: c[0], 12: c[1] }, { '§': c[2], '*': c[4] });
  const b = prof({ 0: c[0], 12: c[1], 3: c[3] }, { '*': c[4], '§': c[2] });
  assert.equal(serialize(a), serialize(b));
  assert.equal(fingerprint(a), fingerprint(b));
  assert.deepEqual(deserialize(serialize(a)).cells, b.cells);
  assert.notEqual(fingerprint(a), fingerprint(prof({ 0: c[0] })));
  assert.deepEqual(mergeProfiles(prof({ 0: c[0] }), prof({ 0: c[1], 1: c[1] })).cells, { 0: c[0], 1: c[1] });
  assert.throws(() => deserialize('{"app":"anders"}'), /nicht lesbar/);
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

test('Jedes Modul hat in beiden Seiten dieselbe Versionsnummer (sonst mischt der Browser-Cache alt und neu)', async () => {
  const files = await moduleList();
  for (const [page, prefix] of [['index.html', './'], ['app/index.html', '../']]) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
    const versions = new Set([...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
    assert.equal(versions.size, 1, `${page}: eine Version überall (node tools/version.mjs)`);
    const expected = files.map((f) => prefix + f.split('\\').join('/')); // Windows liefert Pfade mit "\"
    assert.deepEqual(Object.keys(map).sort(), expected.sort(), `${page}: alle Module in der Import Map`);
  }
});
