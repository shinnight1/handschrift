// Prüft die Teile ohne Browser: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL_CHARS, CELL_GROUPS, FIRST_PASS, BASE_CELLS, EXTRA_PASSES, isCustomChar } from '../src/charset.js';
import { round4 } from '../src/geometry.js';
import { glyphTable, parseProfile, createProfile } from '../src/profile.js';
import { serialize, deserialize, fingerprint, mergeProfiles, syncProfile } from '../src/sync.js';
import { layoutText, FORMATS } from '../src/layout.js';
import { pagesToGoodNotes, pagesToPdf, INKS, inkRgb, inkHex, isCustomInk } from '../src/render.js';
import { PRESETS, presetById, loadFonts, presetProfile } from '../src/presets.js';
import { lang, tr, EN } from '../src/i18n.js';
import { readStoredZip } from '../src/goodnotes/zip.js';
import { appleLz4Compress, appleLz4Decompress } from '../src/goodnotes/lz4.js';
import { encodeBallpoint, ballpointFromTpl } from '../src/goodnotes/tpl.js';
import { decodeRecords, decodeMessage, first, ProtoWriter } from '../src/goodnotes/proto.js';
import { ATTACHMENT_UUID, BUILTIN_PAPER } from '../src/goodnotes/writer.js';
import { TEMPLATE_FILES } from '../src/goodnotes/template-data.js';
import { handoffLink, readHandoff, packCells, unpackCells } from '../src/handoff.js';
import { encodeStrokes, decodeStrokes } from '../src/store.js';
import { readFileSync, readdirSync } from 'node:fs';
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

test('Protobuf: Ereignisse der Vorlage lassen sich byte-genau neu schreiben', () => {
  const events = new Uint8Array(Buffer.from(TEMPLATE_FILES['index.events.pb'], 'base64'));
  for (const rec of decodeRecords(events)) {
    assert.deepEqual(new ProtoWriter().fields(decodeMessage(rec)).result(), rec);
  }
});

test('.goodnotes-Datei: Papier aus unserem PDF, nicht Goodnotes\' eingebautes Punktraster', () => {
  const latin1 = (b) => new TextDecoder('latin1').decode(b);
  const str = (fields, n) => (first(fields, n) ? new TextDecoder().decode(first(fields, n)) : undefined);
  const layout = setText(fakeCells(), 'Liniert soll liniert bleiben');
  const attachments = new Set();
  for (const format of ['standard', 'a4']) {
    for (const paper of ['lined', 'grid', 'blank']) {
      const [file] = pagesToGoodNotes(layout.pages, { format, paper, ink: INKS.blau.rgb, layout });
      const entries = readStoredZip(file);
      const name = [...entries.keys()].find((n) => n.startsWith('attachments/'));
      const id = name.slice('attachments/'.length);
      const bg = entries.get(name);
      attachments.add(id);
      assert.notEqual(id, ATTACHMENT_UUID, 'eigene Anhang-UUID');
      assert.ok(entries.has(`search/${id}`));
      // Nirgends mehr die alte UUID oder der Name der eingebauten Vorlage
      for (const [entry, bytes] of entries) {
        if (entry.startsWith('attachments/') || entry === 'thumbnail.jpg') continue;
        assert.ok(!latin1(bytes).includes(ATTACHMENT_UUID), `${entry}: alte Anhang-UUID`);
        assert.ok(!latin1(bytes).includes(BUILTIN_PAPER), `${entry}: Name des Punktpapiers`);
      }
      assert.ok(latin1(entries.get('index.attachments.pb')).includes(`attachments/${id}`));
      assert.ok(latin1(entries.get('index.search.pb')).includes(`search/${id}`));
      // Ereignisse: Anhang mit echter Größe, Seitenpapier zeigt auf unseren Anhang
      const events = decodeRecords(entries.get('index.events.pb')).map(decodeMessage);
      const inner = (n) => events.filter((r) => first(r, n)).map((r) => decodeMessage(first(r, n)));
      const added = inner(6).find((m) => str(m, 1) === id);
      assert.equal(first(added, 5), BigInt(bg.length));
      const papers = inner(2).filter((m) => str(m, 4) === id);
      assert.equal(papers.length, 1);
      assert.equal(first(papers[0], 9), undefined);
      // Unser PDF trägt das gewählte Papier: Linien nur bei liniert und kariert
      const lines = (latin1(bg).match(/ l S/g) ?? []).length;
      if (paper === 'blank') assert.equal(lines, 0);
      else assert.ok(lines > 10, `${format}/${paper}: ${lines} Linien`);
    }
  }
  assert.equal(attachments.size, 6, 'jede Datei eine neue Anhang-UUID');
});

test('PDF hat eine Seite pro gesetzter Seite', () => {
  const layout = setText(fakeCells(), 'Wort '.repeat(900));
  const pdf = new TextDecoder('latin1').decode(pagesToPdf(layout.pages, { paper: 'lined', ink: INKS.schwarz.rgb, layout }));
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.includes(`/Count ${layout.pages.length}`));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
});

test('Jedes Modul hat in allen Seiten dieselbe Versionsnummer (sonst mischt der Browser-Cache alt und neu)', async () => {
  const files = await moduleList();
  const pages = [['index.html', './'], ['app/index.html', '../'], ['datenschutz/index.html', '../'], ['impressum/index.html', '../'], ['en/index.html', '../'], ['en/app/index.html', '../../'], ['en/privacy/index.html', '../../'], ['en/legal/index.html', '../../']];
  for (const [page, prefix] of pages) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
    const versions = new Set([...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
    assert.equal(versions.size, 1, `${page}: eine Version überall (node tools/version.mjs)`);
    const expected = files.map((f) => prefix + f.split('\\').join('/')); // Windows liefert Pfade mit "\"
    assert.deepEqual(Object.keys(map).sort(), expected.sort(), `${page}: alle Module in der Import Map`);
  }
});

// ---------- Fertige Handschriften, Farben, Englisch ----------

test('Fertige Handschriften: jede hat alle Zeichen, mehrere Varianten und setzt ohne Lücken', async () => {
  const fonts = await loadFonts();
  assert.deepEqual(PRESETS.map((p) => p.id), ['cursive', 'elegant', 'quill', 'print', 'playful']);
  for (const preset of PRESETS) {
    const profile = presetProfile(preset.id, fonts);
    for (let i = 0; i < FIRST_PASS.length; i++) assert.ok(profile.cells[i]?.length, `${preset.id}: ${FIRST_PASS[i]}`);
    const table = glyphTable(profile, { snap: 0 });
    // Varianten unterscheiden sich, sonst sähe jedes e gleich aus
    const [a, b] = table.get('e');
    assert.notDeepEqual(a.strokes, b.strokes, `${preset.id}: Varianten verschieden`);
    assert.equal(table.get('e').length, 4, 'häufige Buchstaben vierfach');
    // Akzente und Zeichen außerhalb der festen Liste kommen aus der Schrift selbst
    const text = 'Liebe Oma, Grüße! Café, señor, garçon: 100 $ + 5 € (ca. 37 %) #1 * § @ & ?';
    const layout = layoutText(text, table, { format: FORMATS.a4, letterSpacing: 0.18 + preset.spacing, minGap: -0.06 });
    assert.deepEqual(layout.missing, [], `${preset.id}: nichts fehlt`);
    // Wie die eigene Schrift: echte Striche in der .goodnotes-Datei
    const [file] = pagesToGoodNotes(layout.pages, { format: 'standard', paper: 'lined', ink: inkRgb('#c2185b'), layout });
    const entries = readStoredZip(file);
    const notes = [...entries.keys()].find((n) => n.startsWith('notes/'));
    assert.equal(decodeRecords(entries.get(notes)).length, layout.pages[0].strokes.length * 2);
  }
  // Gleiche Eingabe, gleiche Handschrift (zwischengespeichert und reproduzierbar)
  assert.equal(presetProfile('quill', fonts), presetProfile('quill', fonts));
  assert.equal(presetProfile('gibtsnicht', fonts), null);
  assert.equal(presetById('print').id, 'print');
  assert.equal(presetById('own'), null);
});

test('Fertige Handschriften setzen nach Vorschub: Schreibschrift berührt sich, Druckschrift nicht', async () => {
  const fonts = await loadFonts();
  const width = (id, word) => {
    const preset = presetById(id);
    const table = glyphTable(presetProfile(id, fonts), { snap: 0 });
    const layout = layoutText(word, table, { format: FORMATS.a4, natural: 0, letterSpacing: 0.18 + preset.spacing, minGap: -0.06 });
    const xs = layout.pages[0].strokes.flatMap((s) => s.points.map(([x]) => x));
    return Math.max(...xs) - Math.min(...xs);
  };
  // Doppelt so viele Buchstaben sind etwa doppelt so breit: Abstand kommt aus der Schrift
  for (const preset of PRESETS) {
    const ratio = width(preset.id, 'mmmmmmmm') / width(preset.id, 'mmmm');
    assert.ok(ratio > 1.8 && ratio < 2.2, `${preset.id}: ${ratio.toFixed(2)}`);
  }
});

test('Eigene Farben: #rrggbb geht in Vorschau, PDF und GoodNotes, Unsinn fällt auf Schwarz', () => {
  assert.ok(isCustomInk('#C2185B') && isCustomInk('#000000'));
  assert.ok(!isCustomInk('blau') && !isCustomInk('#fff') && !isCustomInk('red') && !isCustomInk(null));
  assert.deepEqual(inkRgb('#ff8000'), [1, 128 / 255, 0]);
  assert.deepEqual(inkRgb('blau'), INKS.blau.rgb);
  assert.deepEqual(inkRgb('quatsch'), INKS.schwarz.rgb);
  assert.equal(inkHex('#c2185b'), '#c2185b');
  assert.equal(inkHex('schwarz'), '#1a1a1f');
  const layout = setText(fakeCells(FIRST_PASS.length), 'Farbe');
  const pdf = new TextDecoder('latin1').decode(pagesToPdf(layout.pages, { paper: 'blank', ink: inkRgb('#ff8000'), layout }));
  assert.match(pdf, /1 0\.50* 0 RG/, 'Strichfarbe im PDF');
});

test('Englisch: jeder übersetzbare Text hat eine Übersetzung', () => {
  assert.equal(lang, 'de', 'ohne Browser deutsch');
  assert.equal(tr('Seite {a} von {b}', { a: 2, b: 5 }), 'Seite 2 von 5');
  const keys = new Set();
  for (const dir of ['src', 'landing']) {
    for (const name of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      if (!name.endsWith('.js') || name === 'i18n.js') continue;
      const code = readFileSync(new URL(`../${dir}/${name}`, import.meta.url), 'utf8');
      for (const m of code.matchAll(/\btr\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) keys.add(m[2]);
      for (const m of code.matchAll(/\btr\(\s*\w+ === 1 \? '([^']+)' : '([^']+)'/g)) { keys.add(m[1]); keys.add(m[2]); }
    }
  }
  // Texte, die erst zur Laufzeit gewählt werden
  for (const g of CELL_GROUPS) if (!/^Zusatz /.test(g)) keys.add(g);
  for (const ink of Object.values(INKS)) keys.add(ink.label);
  for (const k of ['Schreibschrift', 'Elegant', 'Feder', 'Druckschrift', 'Verspielt', 'Eigene Zeichen']) keys.add(k);
  const missing = [...keys].filter((k) => !(k in EN));
  assert.deepEqual(missing, [], 'fehlende Übersetzungen in src/i18n.js');
  const unused = Object.keys(EN).filter((k) => !keys.has(k));
  assert.deepEqual(unused, [], 'Übersetzungen, die niemand mehr braucht');
  assert.ok(keys.size > 100, `${keys.size} Texte gefunden`);
});

test('Englische Seiten haben dieselben Elemente wie die deutschen (sonst findet app.js sie nicht)', () => {
  const ids = (page) => [...readFileSync(new URL(`../${page}`, import.meta.url), 'utf8').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids('en/app/index.html'), ids('app/index.html'));
  assert.deepEqual(ids('en/index.html'), ids('index.html'));
  for (const page of ['en/index.html', 'en/app/index.html', 'en/privacy/index.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(html, /<html lang="en">/, page);
  }
});

test('Impressum: von jeder Seite aus verlinkt, vollständig und nicht in Suchmaschinen', () => {
  const read = (page) => readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
  const links = {
    'index.html': 'href="impressum/"', 'app/index.html': 'href="../impressum/"', 'datenschutz/index.html': 'href="../impressum/"',
    'impressum/index.html': '<h1>Impressum</h1>', 'en/index.html': 'href="legal/"', 'en/app/index.html': 'href="../legal/"',
    'en/privacy/index.html': 'href="../legal/"', 'en/legal/index.html': '<h1>Legal notice</h1>',
    'goodnotes-text-in-handschrift/index.html': 'href="../impressum/"', 'handschrift-als-schriftart/index.html': 'href="../impressum/"',
    'en/goodnotes-text-to-handwriting/index.html': 'href="../legal/"', 'en/handwriting-font/index.html': 'href="../legal/"',
    'ki/index.html': 'href="../impressum/"', 'en/ai/index.html': 'href="../legal/"',
  };
  for (const [page, needle] of Object.entries(links)) assert.ok(read(page).includes(needle), `${page}: Link zum Impressum`);
  for (const page of ['impressum/index.html', 'en/legal/index.html']) {
    const html = read(page);
    assert.match(html, /Louis Siebrecht<br>Auf dem Harenkamp 62<br>49586 Neuenkirchen/, `${page}: Name und ladungsfähige Anschrift`);
    assert.match(html, /mailto:siebwrite\.kontakt@gmail\.com/, `${page}: E-Mail`);
    assert.match(html, /<meta name="robots" content="noindex">/, `${page}: nicht in Suchergebnissen`);
  }
  assert.ok(!read('sitemap.xml').includes('impressum') && !read('sitemap.xml').includes('legal'), 'Impressum nicht in der Sitemap');
});
