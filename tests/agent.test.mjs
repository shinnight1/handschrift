// Prüft den Weg für KI-Agenten (Seite /ki/): Text-Link, Erzeugung ohne Browser, Vorschaubild,
// Kommandozeile, MCP-Server und das ZIP zum Herunterladen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTextLink, textLink } from '../src/textlink.js';
import { pickSettings, cleanSettings, DEFAULT_SETTINGS } from '../src/compose.js';
import { FIRST_PASS } from '../src/charset.js';
import { readStoredZip } from '../src/goodnotes/zip.js';
import { decodeRecords } from '../src/goodnotes/proto.js';
import { makeHandwriting } from '../agent/make.mjs';
import { encodeJpeg, DC_LUMA, DC_CHROMA, AC_LUMA, AC_CHROMA } from '../agent/thumbnail.mjs';
import { buildAgentZip, ZIP_PATH } from '../tools/build-agent.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'agent/siebwrite.mjs');
const tempDir = () => mkdtempSync(join(tmpdir(), 'siebwrite-'));

// Eigene Handschrift zum Testen: jedes Zeichen des ersten Durchgangs ein Strich.
const PROFILE = JSON.stringify({
  app: 'handschrift',
  version: 1,
  cells: Object.fromEntries(FIRST_PASS.map((_, i) => [i, [[[0.1, -0.05], [0.25, -0.3], [0.4, 0]]]])),
});

// Größe aus dem SOF0-Abschnitt eines JPEGs
function jpegSize(bytes) {
  for (let i = 2; i < bytes.length - 8; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xc0) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
  }
  return null;
}

// ---------- Text-Link ----------

test('Text-Link: Text und Einstellungen kommen unverändert an, auch Sonderzeichen', () => {
  const text = 'Liebe Oma,\n\nGrüße & Küsse: 1+1=2, 100 % #1 „gut“ 😀\r\nEnde';
  const link = textLink({ text, hand: 'print', paper: 'grid', ink: '#C2185B', format: 'standard' });
  assert.match(link, /^https:\/\/siebwrite\.de\/app\/#text=/);
  assert.ok(!link.includes('+'), 'Leerzeichen als %20, damit jeder den Link richtig liest');
  const back = readTextLink(link.slice(link.indexOf('#')));
  assert.equal(back.text, text.replace('\r\n', '\n'));
  assert.deepEqual(back.settings, { hand: 'print', paper: 'grid', ink: '#c2185b', format: 'standard' });
  assert.equal(textLink({ text: 'x', lang: 'en' }), 'https://siebwrite.de/en/app/#text=x');
});

test('Text-Link: von Hand gebaut, mit anderen Namen, und was kein Text-Link ist', () => {
  // So bauen Chatbots Links oft von Hand
  assert.equal(readTextLink('#text=Hallo+Welt%21').text, 'Hallo Welt!');
  assert.equal(readTextLink('#text=Grüße%20aus%20Köln').text, 'Grüße aus Köln');
  assert.equal(readTextLink('#text=100%25%20sicher%').text, '100% sicher%', 'kaputtes % bleibt stehen');
  assert.deepEqual(readTextLink('#text=Grüße%20&%20Küsse,%20Oma&hand=print'), { text: 'Grüße & Küsse, Oma', settings: { hand: 'print' } }, 'vergessenes & im Text');
  assert.equal(readTextLink('#text=').text, '');
  assert.deepEqual(readTextLink('#setzen&text=a&ink=blue&paper=kariert&hand=Print&format=goodnotes').settings,
    { ink: 'blau', paper: 'grid', hand: 'print', format: 'standard' });
  assert.equal(readTextLink('#text=a&ink=c2185b').settings.ink, '#c2185b');
  assert.deepEqual(readTextLink('#text=a&ink=lila&hand=comic&paper=').settings, {}, 'Unbrauchbares fällt weg');
  for (const hash of ['', '#', '#setzen', '#schreiben', '#gn1=abc', '#hand=print', 'text=a']) {
    assert.equal(readTextLink(hash), null, hash);
  }
});

test('Einstellungen: pickSettings meldet Unbrauchbares, cleanSettings wie bisher', () => {
  assert.deepEqual(pickSettings({ hand: 'own', ink: 'BLACK', paper: 'lined' }),
    { settings: { hand: 'own', ink: 'schwarz', paper: 'lined' }, invalid: [] });
  assert.deepEqual(pickSettings({ ink: 'purple', format: 'letter', paper: ' ' }).invalid, ['ink', 'format']);
  const { size, hand, ...rest } = DEFAULT_SETTINGS;
  assert.deepEqual(cleanSettings({ ...DEFAULT_SETTINGS, size: 'x', hand: 'gibtsnicht', extra: 1 }), rest);
});

// ---------- Erzeugung ohne Browser ----------

test('Agent: .goodnotes wie aus der App, mit Vorschaubild, eine Datei pro Seite', async () => {
  const r = await makeHandwriting({ text: 'Liebe Oma, vielen Dank!', hand: 'cursive' });
  assert.equal(r.files.length, 1);
  assert.equal(r.pages, 1);
  assert.deepEqual(r.missing, []);
  assert.equal(r.files[0].name, 'Handschrift - Liebe Oma vielen.goodnotes');
  assert.deepEqual(r.settings, { hand: 'cursive', paper: 'lined', ink: 'blau', format: 'a4', seed: 1 });
  const entries = readStoredZip(r.files[0].bytes);
  for (const name of ['schema.pb', 'index.events.pb', 'index.notes.pb', 'index.attachments.pb', 'document.info.pb', 'thumbnail.jpg']) {
    assert.ok(entries.has(name), name);
  }
  const notes = [...entries.keys()].find((n) => n.startsWith('notes/'));
  assert.ok(decodeRecords(entries.get(notes)).length > 20, 'Striche');
  const jpg = entries.get('thumbnail.jpg');
  assert.deepEqual([...jpg.subarray(0, 2), ...jpg.subarray(-2)], [0xff, 0xd8, 0xff, 0xd9]);
  assert.deepEqual(jpegSize(jpg), { width: 360, height: 509 }, 'A4 wie in der App: 360 px breit');

  const long = await makeHandwriting({ text: 'Wort '.repeat(400), hand: 'print', format: 'standard', lang: 'en' });
  assert.ok(long.files.length > 1);
  assert.equal(long.files.length, long.pages);
  assert.equal(long.files[1].name, 'Handwriting - Wort Wort Wort (Page 2).goodnotes');

  const pdf = await makeHandwriting({ text: 'Hallo', hand: 'print', output: 'pdf', name: 'Brief' });
  assert.equal(pdf.files[0].name, 'Brief.pdf');
  assert.equal(new TextDecoder().decode(pdf.files[0].bytes.subarray(0, 5)), '%PDF-');
});

test('Agent: eigene Handschrift aus der Profildatei, fehlende Zeichen werden gemeldet, Fehler verständlich', async () => {
  const r = await makeHandwriting({ text: 'Hallo → Welt', profile: PROFILE });
  assert.equal(r.settings.hand, 'own');
  assert.deepEqual(r.missing, ['→']);
  assert.equal((await makeHandwriting({ text: 'Hallo', profile: PROFILE, hand: 'quill' })).settings.hand, 'quill', 'genannte fertige Handschrift gewinnt');
  await assert.rejects(makeHandwriting({ text: 'x', hand: 'own' }), /Handschrift-Profil\.json/);
  await assert.rejects(makeHandwriting({ text: 'x', profile: '{"app":"anders"}' }), /not a Siebwrite handwriting file/);
  await assert.rejects(makeHandwriting({ text: 'x', profile: { app: 'handschrift', version: 1, cells: {} } }), /empty/);
  await assert.rejects(makeHandwriting({ text: '  \n' }), /empty/);
  await assert.rejects(makeHandwriting({ text: 'x', ink: 'lila', format: 'letter' }), /Unknown ink "lila".*Unknown format "letter"/);
  await assert.rejects(makeHandwriting({ text: 'x', output: 'docx' }), /goodnotes or pdf/);
});

test('Vorschaubild: JPEG mit den Standard-Tabellen der Norm', () => {
  for (const t of [DC_LUMA, DC_CHROMA, AC_LUMA, AC_CHROMA]) {
    assert.equal(t.bits.reduce((a, b) => a + b, 0), t.vals.length);
    assert.equal(new Set(t.vals).size, t.vals.length);
  }
  const jpg = encodeJpeg({ width: 13, height: 9, rgb: new Float32Array(13 * 9 * 3).fill(0.5) });
  assert.deepEqual([...jpg.subarray(0, 2), ...jpg.subarray(-2)], [0xff, 0xd8, 0xff, 0xd9]);
  assert.deepEqual(jpegSize(jpg), { width: 13, height: 9 });
});

// ---------- Kommandozeile und MCP ----------

test('Kommandozeile: speichert Dateien, gibt Links aus, meldet Fehler mit Exit-Code 1', () => {
  const dir = tempDir();
  try {
    const r = JSON.parse(execFileSync(process.execPath, [CLI, '--text', 'Hallo Welt', '--hand', 'quill', '--out', dir, '--json'], { encoding: 'utf8' }));
    assert.equal(r.ok, true);
    assert.ok(existsSync(r.files[0]) && r.files[0].startsWith(dir));
    assert.equal(execFileSync(process.execPath, [CLI, '--link', '-t', 'Hallo Welt', '--hand', 'print'], { encoding: 'utf8' }).trim(),
      'https://siebwrite.de/app/#text=Hallo%20Welt&hand=print');
    assert.match(execFileSync(process.execPath, [CLI, '--text-file', '-', '--link'], { encoding: 'utf8', input: 'Von stdin' }), /#text=Von%20stdin/);
    writeFileSync(join(dir, 'p.json'), PROFILE);
    const own = JSON.parse(execFileSync(process.execPath, [CLI, '-t', 'Hallo', '-p', join(dir, 'p.json'), '--pdf', '-o', dir, '--json'], { encoding: 'utf8' }));
    assert.equal(own.settings.hand, 'own');
    assert.match(own.files[0], /\.pdf$/);
    assert.throws(() => execFileSync(process.execPath, [CLI, '-t', 'x', '--ink', 'lila', '--json'], { encoding: 'utf8', stdio: 'pipe' }), (e) => {
      assert.equal(e.status, 1);
      assert.match(JSON.parse(e.stdout).error, /Unknown ink "lila"/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Startet den MCP-Server, schickt Nachrichten (eine pro Zeile) und sammelt die Antworten.
async function mcp(messages, env = {}) {
  const child = spawn(process.execPath, [CLI, 'mcp'], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
  child.stdin.end();
  await new Promise((res) => child.on('close', res));
  return out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('MCP-Server: Handshake, Werkzeuge, Aufrufe und Fehler nach Protokoll', async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'p.json'), PROFILE);
    const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const replies = await mcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      call(3, 'handwriting_link', { text: 'Hallo Welt', hand: 'print', lang: 'en' }),
      call(4, 'create_handwriting', { text: 'Hallo Welt', hand: 'elegant', out_dir: dir }),
      call(5, 'create_handwriting', { text: 'Hallo', out_dir: dir }),
      call(6, 'create_handwriting', { text: 'x', ink: 'lila', out_dir: dir }),
      { jsonrpc: '2.0', id: 7, method: 'ping' },
      { jsonrpc: '2.0', id: 8, method: 'resources/list' },
      call(9, 'gibtsnicht', {}),
      { jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
    ], { SIEBWRITE_PROFILE: join(dir, 'p.json') });
    const r = Object.fromEntries(replies.map((m) => [m.id, m]));
    assert.equal(replies.length, 10, 'auf Benachrichtigungen keine Antwort');
    assert.equal(r[1].result.protocolVersion, '2025-06-18');
    assert.equal(r[1].result.serverInfo.name, 'siebwrite');
    assert.ok(r[1].result.capabilities.tools);
    assert.deepEqual(r[2].result.tools.map((t) => t.name), ['create_handwriting', 'handwriting_link']);
    for (const t of r[2].result.tools) assert.deepEqual(t.inputSchema.required, ['text']);
    assert.equal(r[3].result.content[0].text, 'https://siebwrite.de/en/app/#text=Hallo%20Welt&hand=print');
    const saved = r[4].result.content[0].text.split('\n').find((l) => l.endsWith('.goodnotes'));
    assert.ok(saved.startsWith(dir) && existsSync(saved), saved);
    assert.match(r[5].result.content[0].text, /handwriting own/, 'SIEBWRITE_PROFILE gilt, wenn keine Handschrift genannt ist');
    assert.equal(r[6].result.isError, true);
    assert.match(r[6].result.content[0].text, /Unknown ink "lila"/);
    assert.deepEqual(r[7].result, {});
    assert.equal(r[8].error.code, -32601);
    assert.equal(r[9].error.code, -32602);
    assert.equal(r[10].result.protocolVersion, '2025-11-25', 'unbekannte Version: unsere neueste');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- Paket zum Herunterladen ----------

test('ZIP zum Herunterladen ist aktuell (sonst node tools/build-agent.mjs) und läuft entpackt', async () => {
  const built = await buildAgentZip();
  assert.ok(Buffer.from(built).equals(readFileSync(join(ROOT, ZIP_PATH))), `${ZIP_PATH} ist veraltet: node tools/build-agent.mjs`);
  const dir = tempDir();
  try {
    for (const [name, bytes] of readStoredZip(built)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), bytes);
    }
    const skill = readFileSync(join(dir, 'siebwrite/SKILL.md'), 'utf8');
    const [, front] = /^---\n([\s\S]*?)\n---\n/.exec(skill);
    assert.match(front, /^name: siebwrite$/m);
    const description = /^description: (.+)$/m.exec(front)[1];
    assert.ok(description.length <= 1024, 'Beschreibung eines Skills: höchstens 1024 Zeichen');
    const out = execFileSync(process.execPath, [join(dir, 'siebwrite/agent/siebwrite.mjs'), '-t', 'Aus dem ZIP', '--json', '-o', join(dir, 'out')], { encoding: 'utf8', cwd: dir });
    assert.equal(JSON.parse(out).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
