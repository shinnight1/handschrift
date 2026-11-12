// Ausgabe der gesetzten Seiten: Vorschau auf Canvas, PDF und .goodnotes.
// Eine Seite ist {width, height, strokes}; Seiten eines Arbeitsblatts tragen dazu image:
// {jpeg} (das Blatt als Bild, worksheet.js), das unter der Handschrift liegt.

import { PdfDoc, MM } from './pdf.js';
import { writeGoodNotes } from './goodnotes/writer.js';

const INKS = {
  schwarz: { label: 'Schwarz', rgb: [0.1, 0.1, 0.12] },
  blau: { label: 'Kuli-Blau', rgb: [0.08, 0.2, 0.58] },
  dunkelblau: { label: 'Tinte', rgb: [0.05, 0.12, 0.38] },
  grau: { label: 'Bleistift', rgb: [0.33, 0.33, 0.36] },
};

// Farbe: Name aus INKS oder eine eigene als "#rrggbb" (Farbwähler „+“ in der App).
const isCustomInk = (ink) => typeof ink === 'string' && /^#[0-9a-f]{6}$/i.test(ink);

// Farbe als [r, g, b] von 0 bis 1, wie PDF und GoodNotes sie wollen.
function inkRgb(ink) {
  if (INKS[ink]) return INKS[ink].rgb;
  if (isCustomInk(ink)) return [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16) / 255);
  return INKS.schwarz.rgb;
}

const inkHex = (ink) => `#${inkRgb(ink).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

const PAPERS = { lined: 'Liniert breit', narrow: 'Liniert schmal', grid: 'Kariert', blank: 'Leer' };

// Linienabstand der linierten Papiere in mm, nach GoodNotes' „breit“ und „schmal“ liniert.
// Goodnotes nennt keine Maße; Nutzer messen schmal 6,2–6,4 mm und breit 8,5–8,8 mm. Genommen
// ist die amerikanische Linierung, die in beiden Spannen liegt (narrow ruled 1/4 Zoll, wide
// ruled 11/32 Zoll). Geschätzt, nicht an einer Goodnotes-Seite nachgemessen.
const RULINGS = { lined: 8.7, narrow: 6.35 };

const PAPER_LINE = [0.72, 0.8, 0.9];
const GRID_STEP = 5 * MM;

// Linien des Papiers. Liniert: die Grundlinien der Schrift, über die ganze Seite (der Satz
// nimmt bei liniertem Papier dessen Linienabstand als Zeilenabstand, compose.js).
function paperLines(page, paper, layout) {
  const lines = [];
  if (RULINGS[paper]) {
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

// Zeichnet eine Seite; pxPerPt = Pixel pro PDF-Punkt. background: Bild des Arbeitsblatts
// (alles, was drawImage nimmt), füllt die ganze Seite.
function drawPage(ctx, page, pxPerPt, { paper = 'blank', ink = INKS.schwarz.rgb, layout, background = null }) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width * pxPerPt, page.height * pxPerPt);
  ctx.scale(pxPerPt, pxPerPt);
  if (background) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(background, 0, 0, page.width, page.height);
  }
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

// Seitenhintergrund: das Arbeitsblatt oder die Papierlinien.
function addPaper(doc, pdfPage, page, paper, layout) {
  if (page.image) {
    pdfPage.image(doc.addImage(page.image.jpeg), 0, 0, page.width, page.height);
    return;
  }
  const lines = paperLines(page, paper, layout);
  if (!lines.length) return;
  pdfPage.strokeColor(...PAPER_LINE).lineWidth(0.5);
  for (const l of lines) pdfPage.line(...l);
}

function pagesToPdf(pages, { paper = 'blank', ink = INKS.schwarz.rgb, layout }) {
  const doc = new PdfDoc();
  for (const page of pages) {
    const p = doc.addPage(page.width, page.height);
    addPaper(doc, p, page, paper, layout);
    p.strokeColor(...ink).round();
    let width = null;
    for (const st of page.strokes) {
      if (st.width !== width) { p.lineWidth(st.width); width = st.width; }
      p.polyline(st.points);
    }
  }
  return doc.toBytes();
}

// Ein .goodnotes-Dokument pro Seite, in der Größe der Seite (A3, A4, A5, GoodNotes-Standard
// oder die des Arbeitsblatts). thumbnail(page) darf ein JPEG liefern.
function pagesToGoodNotes(pages, { paper = 'blank', ink = INKS.schwarz.rgb, layout, thumbnail }) {
  return pages.map((page) => {
    const bg = new PdfDoc();
    addPaper(bg, bg.addPage(page.width, page.height), page, paper, layout);
    return writeGoodNotes({
      strokes: page.strokes,
      format: { width: page.width, height: page.height },
      background: bg.toBytes(),
      thumbnail: thumbnail?.(page),
      color: [...ink, 1],
    });
  });
}

export { INKS, PAPERS, RULINGS, PAPER_LINE, isCustomInk, inkRgb, inkHex, paperLines, drawPage, pagesToPdf, pagesToGoodNotes };
