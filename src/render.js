// Ausgabe der gesetzten Seiten: Vorschau auf Canvas, PDF und .goodnotes.

import { PdfDoc, MM } from './pdf.js';
import { writeGoodNotes } from './goodnotes/writer.js';

const INKS = {
  schwarz: { label: 'Schwarz', rgb: [0.1, 0.1, 0.12] },
  blau: { label: 'Kuli-Blau', rgb: [0.08, 0.2, 0.58] },
  dunkelblau: { label: 'Tinte', rgb: [0.05, 0.12, 0.38] },
  grau: { label: 'Bleistift', rgb: [0.33, 0.33, 0.36] },
};

const PAPERS = { blank: 'Blanko', lined: 'Liniert', grid: 'Kariert' };

const PAPER_LINE = [0.72, 0.8, 0.9];
const GRID_STEP = 5 * MM;

// Linien des Papiers. Liniert: die Grundlinien der Schrift, über die ganze Seite.
function paperLines(page, paper, layout) {
  const lines = [];
  if (paper === 'lined') {
    for (let y = layout.top + layout.lineHeight; y < page.height - 4 * MM; y += layout.lineHeight) {
      lines.push([0, y, page.width, y]);
    }
  } else if (paper === 'grid') {
    for (let y = GRID_STEP; y < page.height; y += GRID_STEP) lines.push([0, y, page.width, y]);
    for (let x = GRID_STEP; x < page.width; x += GRID_STEP) lines.push([x, 0, x, page.height]);
  }
  return lines;
}

const css = ([r, g, b]) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

// Zeichnet eine Seite; pxPerPt = Pixel pro PDF-Punkt.
function drawPage(ctx, page, pxPerPt, { paper = 'blank', ink = INKS.schwarz.rgb, layout }) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width * pxPerPt, page.height * pxPerPt);
  ctx.scale(pxPerPt, pxPerPt);
  ctx.strokeStyle = css(PAPER_LINE);
  ctx.lineWidth = Math.max(0.4, 0.6 / pxPerPt);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of paperLines(page, paper, layout)) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.strokeStyle = css(ink);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const st of page.strokes) {
    ctx.lineWidth = st.width;
    ctx.beginPath();
    ctx.moveTo(st.points[0][0], st.points[0][1]);
    if (st.points.length === 1) ctx.lineTo(st.points[0][0] + 0.01, st.points[0][1]);
    for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i][0], st.points[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

function addPaper(pdfPage, page, paper, layout) {
  const lines = paperLines(page, paper, layout);
  if (!lines.length) return;
  pdfPage.strokeColor(...PAPER_LINE).lineWidth(0.5);
  for (const l of lines) pdfPage.line(...l);
}

function pagesToPdf(pages, { paper = 'blank', ink = INKS.schwarz.rgb, layout }) {
  const doc = new PdfDoc();
  for (const page of pages) {
    const p = doc.addPage(page.width, page.height);
    addPaper(p, page, paper, layout);
    p.strokeColor(...ink).round();
    let width = null;
    for (const st of page.strokes) {
      if (st.width !== width) { p.lineWidth(st.width); width = st.width; }
      p.polyline(st.points);
    }
  }
  return doc.toBytes();
}

// Ein .goodnotes-Dokument pro Seite. thumbnail(page) darf ein JPEG liefern.
function pagesToGoodNotes(pages, { format, paper = 'blank', ink = INKS.schwarz.rgb, layout, thumbnail }) {
  return pages.map((page) => {
    const bg = new PdfDoc();
    addPaper(bg.addPage(page.width, page.height), page, paper, layout);
    return writeGoodNotes({
      strokes: page.strokes,
      format,
      background: bg.toBytes(),
      thumbnail: thumbnail?.(page),
      color: [...ink, 1],
    });
  });
}

export { INKS, PAPERS, drawPage, pagesToPdf, pagesToGoodNotes };
