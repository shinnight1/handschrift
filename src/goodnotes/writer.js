// Schreibt ein .goodnotes-Dokument mit bearbeitbaren Kugelschreiber-Strichen.
//
// Das Format ist nicht dokumentiert. Der Aufbau folgt InkLift (MIT), dessen
// Writer mit Goodnotes 7.1.18 für Mac geprüft wurde: eine Ein-Seiten-Vorlage
// (Indizes, Ereignisprotokoll, Hintergrund-PDF), ersetzt werden der Strich-Stream
// der Seite, der Suchindex, das Vorschaubild und der Hintergrund (eigenes PDF,
// eigene Anhang-UUID, ohne Verweis auf Goodnotes' Punktpapier).
// Kurzfassung des Formats: README.md, Abschnitt "Das .goodnotes-Format".

import { ZipWriter } from './zip.js';
import { ProtoWriter, varintBytes, decodeMessage, decodeRecords, first } from './proto.js';
import { appleLz4Compress } from './lz4.js';
import { encodeBallpoint } from './tpl.js';
import { concat, fromBase64, fromUtf8, uuid, randomU32 } from './bytes.js';
import { TEMPLATE_FILES } from './template-data.js';

// GoodNotes-Einheiten pro PDF-Punkt (834.24 Einheiten für eine 455.04-pt-Seite).
const UNITS_PER_POINT = 132 / 72;

const PAGE_FORMATS = {
  // Seitengröße der geprüften Vorlage.
  standard: { width: 455.04, height: 588.45, label: 'GoodNotes-Standard', tested: true },
  // Gleiche Vorlage, Seitengröße im Ereignisprotokoll auf A4 umgeschrieben. Ungetestet.
  a4: { width: 595.28, height: 841.89, label: 'A4', tested: false },
};

const PAGE_UUID = '47C42002-8FC8-521C-80C0-A3C6E11DA9C1';
// UUID des Hintergrund-PDFs in der Vorlage; jede Datei bekommt eine eigene (eventsWithOwnPaper).
const ATTACHMENT_UUID = 'F8C077F2-68CA-5AFC-B1D1-EFEA5ED4D254';
// Name der Goodnotes-eigenen Papiervorlage, auf der das Vorlagenheft angelegt war: Punktraster, weiß.
const BUILTIN_PAPER = 'CC365888-75C9-5DBF-B1D4-A7E8E0AD3B7F_standard_1_2 - White';
// Undurchsichtige Konstanten aus Dateien, die GoodNotes 7.1 geschrieben hat.
const DEVICE_TAG = 1184897455800006800n;
const APP_TAG = 5381;
const BALLPOINT = 24;

const template = (name) => fromBase64(TEMPLATE_FILES[name]);

// Feld 1 und 2 als fixed32: so steht die Seitengröße im Ereignisprotokoll.
function sizePair(widthPt, heightPt) {
  return new ProtoWriter()
    .fixed32f(1, widthPt * UNITS_PER_POINT)
    .fixed32f(2, heightPt * UNITS_PER_POINT)
    .result();
}

// Ersetzt die Seitengröße im "Seite hinzugefügt"-Ereignis.
function eventsWithPageSize(events, widthPt, heightPt) {
  const std = PAGE_FORMATS.standard;
  const needle = sizePair(std.width, std.height);
  const replacement = sizePair(widthPt, heightPt);
  const out = events.slice();
  let found = 0;
  outer: for (let i = 0; i <= out.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (out[i + k] !== needle[k]) continue outer;
    out.set(replacement, i);
    found++;
  }
  if (found !== 1) throw new Error(`Seitengröße ${found}-mal statt einmal gefunden`);
  return out;
}

// Ersetzt jede Stelle von `from` durch `to` (gleich lang, ASCII), z. B. eine UUID.
function replaceAscii(buf, from, to) {
  if (from.length !== to.length) throw new Error('Ersatz muss gleich lang sein');
  const out = buf.slice();
  outer: for (let i = 0; i <= out.length - from.length; i++) {
    for (let k = 0; k < from.length; k++) if (out[i + k] !== from.charCodeAt(k)) continue outer;
    for (let k = 0; k < to.length; k++) out[i + k] = to.charCodeAt(k);
  }
  return out;
}

const text = (fields, n) => {
  const v = first(fields, n);
  return v instanceof Uint8Array ? fromUtf8(v) : undefined;
};

// Ändert genau ein Ereignis: dessen Nachricht in Feld `kind`, auf die match() passt.
function rewriteEvent(events, kind, match, edit) {
  let found = 0;
  const records = decodeRecords(events).map((rec) => {
    const top = decodeMessage(rec);
    const i = top.findIndex((f) => f.field === kind && f.wire === 2);
    if (i < 0) return rec;
    const inner = decodeMessage(top[i].value);
    if (!match(inner)) return rec;
    found++;
    top[i] = { ...top[i], value: new ProtoWriter().fields(edit(inner)).result() };
    return new ProtoWriter().fields(top).result();
  });
  if (found !== 1) throw new Error(`Ereignis ${kind} ${found}-mal statt einmal gefunden`);
  return concat(records.map((r) => concat([varintBytes(r.length), r])));
}

// Das Vorlagenheft lag auf Goodnotes' eigenem Punktpapier. Solange die Seite dessen Namen
// trägt und der Anhang die UUID von damals hat, zeigt Goodnotes sein Punktraster statt
// unseres Hintergrund-PDFs (liniert, kariert, blanko). Darum: Vorlagenname raus, eigene
// UUID für den Anhang und dessen echte Größe in Bytes.
function eventsWithOwnPaper(events, attachmentUuid, attachmentSize) {
  let out = replaceAscii(events, ATTACHMENT_UUID, attachmentUuid);
  // "Anhang hinzugefügt": Feld 5 ist die Dateigröße (in der Vorlage die des Punkt-PDFs).
  out = rewriteEvent(out, 6,
    (m) => text(m, 1) === attachmentUuid && first(m, 5) !== undefined,
    (m) => m.map((f) => (f.field === 5 ? { field: 5, wire: 0, value: BigInt(attachmentSize) } : f)));
  // Papier der Seite: Anhang in Feld 4, Name der eingebauten Vorlage in Feld 9.
  out = rewriteEvent(out, 2,
    (m) => text(m, 4) === attachmentUuid && text(m, 9) === BUILTIN_PAPER,
    (m) => m.filter((f) => f.field !== 9));
  return out;
}

function strokeRecords(strokeUuid, lz4, color, counter, timestamp) {
  const clock = new ProtoWriter().varint(1, 2).varint(2, randomU32());

  const meta = new ProtoWriter()
    .string(1, strokeUuid)
    .message(2, clock)
    .string(6, uuid())
    .varint(8, DEVICE_TAG)
    .varint(9, counter)
    .varint(14, APP_TAG)
    .varint(16, BALLPOINT);

  const rgba = new ProtoWriter()
    .fixed32f(1, color[0]).fixed32f(2, color[1]).fixed32f(3, color[2]).fixed32f(4, color[3] ?? 1);
  const stampBox = new ProtoWriter().message(1, new ProtoWriter().varint(1, counter).varint(2, timestamp));

  const inner = new ProtoWriter()
    .string(1, strokeUuid)
    .bytes(2, lz4)
    .message(4, rgba)
    .bytes(6, new Uint8Array(0))
    .message(7, stampBox)
    .bytes(9, new Uint8Array(0))
    .message(15, clock)
    .bytes(20, new Uint8Array(0))
    .varint(21, BALLPOINT);

  const stroke = new ProtoWriter().message(7, inner);
  return concat([meta.record(), stroke.record()]);
}

// strokes: [{points: [[x, y], ...], width}] in PDF-Punkten auf der Zielseite, Ursprung oben links.
function noteStream(strokes, color = [0, 0, 0, 1], now = Date.now()) {
  const parts = [];
  let counter = 3653600;
  for (const s of strokes) {
    if (!s.points.length) continue;
    counter++;
    const pts = s.points.map(([x, y]) => [x * UNITS_PER_POINT, y * UNITS_PER_POINT]);
    if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1] + 0.01]);
    const width = Math.max(0.5, s.width * UNITS_PER_POINT);
    const lz4 = appleLz4Compress(encodeBallpoint(width, pts));
    parts.push(strokeRecords(uuid(), lz4, s.color ?? color, counter, now));
  }
  return concat(parts);
}

/**
 * @param {object} o
 * @param {Array} o.strokes     Striche in PDF-Punkten (siehe noteStream)
 * @param {string} o.format     Schlüssel aus PAGE_FORMATS
 * @param {Uint8Array} o.background  einseitiges PDF in genau dieser Seitengröße
 * @param {Uint8Array} [o.thumbnail] JPEG-Vorschau
 */
function writeGoodNotes({ strokes, format = 'standard', background, thumbnail, color }) {
  const page = PAGE_FORMATS[format];
  if (!page) throw new Error(`unbekanntes Seitenformat ${format}`);
  let events = template('index.events.pb');
  if (format !== 'standard') events = eventsWithPageSize(events, page.width, page.height);
  const attachment = uuid();
  events = eventsWithOwnPaper(events, attachment, background.length);
  const own = (name) => replaceAscii(template(name), ATTACHMENT_UUID, attachment);

  const zip = new ZipWriter();
  zip.add('document.info.pb', new Uint8Array(0));
  zip.add('index.search.pb', own('index.search.pb'));
  zip.add('index.notes.pb', template('index.notes.pb'));
  zip.add(`search/${PAGE_UUID}`, new Uint8Array([0x04, 0x10, 0x01, 0x1a, 0x00]));
  zip.add(`search/${attachment}`, template(`search/${ATTACHMENT_UUID}`));
  zip.add(`notes/${PAGE_UUID}`, noteStream(strokes, color));
  zip.add('index.events.pb', events);
  if (thumbnail) zip.add('thumbnail.jpg', thumbnail);
  zip.add('index.attachments.pb', own('index.attachments.pb'));
  zip.add(`attachments/${attachment}`, background);
  zip.add('schema.pb', template('schema.pb'));
  return zip.finish();
}

export {
  UNITS_PER_POINT, PAGE_FORMATS, eventsWithPageSize, eventsWithOwnPaper, noteStream, writeGoodNotes,
  PAGE_UUID, ATTACHMENT_UUID, BUILTIN_PAPER,
};
