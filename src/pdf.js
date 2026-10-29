// Minimaler PDF-Writer: Vektorpfade und Helvetica-Text, Ursprung oben links.
// Reicht für Vorlage, Ausgabe-PDF und den Seitenhintergrund der GoodNotes-Datei.

import { ByteWriter } from './goodnotes/bytes.js';

const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };

const WIN_ANSI_EXTRA = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94,
  '•': 0x95, '–': 0x96, '—': 0x97,
};

function encodeText(str) {
  let out = '';
  for (const ch of str) {
    let code = WIN_ANSI_EXTRA[ch] ?? ch.codePointAt(0);
    if (code > 0xff) code = 0x3f; // "?"
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += '\\' + String.fromCharCode(code);
    else if (code < 0x20 || code > 0x7e) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  }
  return out;
}

const num = (v) => {
  const s = (Math.round(v * 100) / 100).toString();
  return s === '-0' ? '0' : s;
};

// Ungefähre Breite für zentrierten Text (Helvetica, Mittelwert pro Zeichen).
const textWidth = (str, size) => [...str].length * size * 0.52;

class PdfPage {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.ops = [];
  }

  y(v) { return this.height - v; }

  strokeColor(r, g, b) { this.ops.push(`${num(r)} ${num(g)} ${num(b)} RG`); return this; }
  fillColor(r, g, b) { this.ops.push(`${num(r)} ${num(g)} ${num(b)} rg`); return this; }
  lineWidth(w) { this.ops.push(`${num(w)} w`); return this; }
  round() { this.ops.push('1 J 1 j'); return this; }
  dash(on, off) { this.ops.push(on ? `[${num(on)} ${num(off)}] 0 d` : '[] 0 d'); return this; }

  line(x1, y1, x2, y2) {
    this.ops.push(`${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S`);
    return this;
  }

  rect(x, y, w, h, mode = 'S') {
    this.ops.push(`${num(x)} ${num(this.y(y + h))} ${num(w)} ${num(h)} re ${mode}`);
    return this;
  }

  // points: [[x, y], ...]
  polyline(points) {
    if (points.length === 0) return this;
    const parts = [`${num(points[0][0])} ${num(this.y(points[0][1]))} m`];
    if (points.length === 1) parts.push(`${num(points[0][0] + 0.01)} ${num(this.y(points[0][1]))} l`);
    for (let i = 1; i < points.length; i++) parts.push(`${num(points[i][0])} ${num(this.y(points[i][1]))} l`);
    parts.push('S');
    this.ops.push(parts.join(' '));
    return this;
  }

  // Glatter Pfad durch die Punkte: Mittelpunkte als Kurvenenden, Punkte als Kontrollpunkte.
  smoothPath(points) {
    if (points.length < 3) return this.polyline(points);
    const p = (x, y) => `${num(x)} ${num(this.y(y))}`;
    const parts = [`${p(points[0][0], points[0][1])} m`];
    let prev = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      const c = points[i];
      const mx = (c[0] + points[i + 1][0]) / 2;
      const my = (c[1] + points[i + 1][1]) / 2;
      // quadratische Kurve als kubische schreiben
      const c1x = prev[0] + (2 / 3) * (c[0] - prev[0]);
      const c1y = prev[1] + (2 / 3) * (c[1] - prev[1]);
      const c2x = mx + (2 / 3) * (c[0] - mx);
      const c2y = my + (2 / 3) * (c[1] - my);
      parts.push(`${p(c1x, c1y)} ${p(c2x, c2y)} ${p(mx, my)} c`);
      prev = [mx, my];
    }
    const last = points[points.length - 1];
    parts.push(`${p(last[0], last[1])} l S`);
    this.ops.push(parts.join(' '));
    return this;
  }

  circle(cx, cy, r, mode = 'f') {
    const k = 0.5523 * r;
    const y = this.y(cy);
    this.ops.push(
      `${num(cx + r)} ${num(y)} m ` +
      `${num(cx + r)} ${num(y + k)} ${num(cx + k)} ${num(y + r)} ${num(cx)} ${num(y + r)} c ` +
      `${num(cx - k)} ${num(y + r)} ${num(cx - r)} ${num(y + k)} ${num(cx - r)} ${num(y)} c ` +
      `${num(cx - r)} ${num(y - k)} ${num(cx - k)} ${num(y - r)} ${num(cx)} ${num(y - r)} c ` +
      `${num(cx + k)} ${num(y - r)} ${num(cx + r)} ${num(y - k)} ${num(cx + r)} ${num(y)} c ${mode}`,
    );
    return this;
  }

  // x, y = linke Grundlinie
  text(x, y, size, str, bold = false) {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(this.y(y))} Td (${encodeText(str)}) Tj ET`);
    return this;
  }

  textCentered(cx, y, size, str, bold = false) {
    return this.text(cx - textWidth(str, size) / 2, y, size, str, bold);
  }
}

class PdfDoc {
  constructor() { this.pages = []; }

  addPage(width = A4.width, height = A4.height) {
    const page = new PdfPage(width, height);
    this.pages.push(page);
    return page;
  }

  toBytes() {
    const objects = []; // Index = Objektnummer - 1
    const add = (body) => { objects.push(body); return objects.length; };
    const catalogId = add(null);
    const pagesId = add(null);
    const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds = [];
    for (const page of this.pages) {
      const content = page.ops.join('\n');
      const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      pageIds.push(add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ));
    }
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    const w = new ByteWriter(1 << 16);
    w.ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(w.length);
      w.ascii(`${i + 1} 0 obj\n${body}\nendobj\n`);
    });
    const xref = w.length;
    w.ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (const off of offsets) w.ascii(`${String(off).padStart(10, '0')} 00000 n \n`);
    w.ascii(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return w.result();
  }
}

export { MM, A4, textWidth, PdfPage, PdfDoc };
