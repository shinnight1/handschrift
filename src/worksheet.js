// Arbeitsblatt ausfüllen: ein PDF oder Foto als Seite, darauf Felder, in die je ein Text in
// Handschrift kommt. Hier die Teile ohne Browser: gedruckte Linien finden, ein Feld aus einem
// Tipp auf eine Linie, Felder ordnen, alle Felder setzen, eingefügte Antworten verteilen.
// Datei laden, Felder ziehen und Speichern im Browser: sheet.js.
//
// Eine Seite: {width, height (Punkte), jpeg (Bild der Seite), rules und columns (gedruckte
// Linien, detectLines)}.
// Ein Feld: {id, page, x, y, w, h (Punkte, oben links), text}.

import { MM } from './pdf.js';
import { layoutBox } from './layout.js';

// Papierweiß eines Graustufenbilds: der Median, denn auf einem Blatt ist mehr als die Hälfte
// leer. Bei Fotos ist das Weiß grauer, Schwellen wandern damit mit.
function paperWhite(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= gray.length / 2) return v;
  }
  return 255;
}

/**
 * Schräglage eines fotografierten oder gescannten Blatts in Grad (positiv: Zeilen fallen nach
 * rechts ab, im Uhrzeigersinn gedreht). Gesucht wird der Winkel, bei dem die dunklen Pixel,
 * waagerecht aufsummiert, die schärfsten Spitzen bilden: Dann liegen Zeilen und Linien
 * waagerecht. Die Spitze ist schmal (bei 800 Pixeln Breite etwa 0,15°), deshalb grob in
 * Zehntelgrad bis ±5°, dann fein in Fünfzigsteln.
 * @param {Uint8Array|Uint8ClampedArray} gray  zeilenweise, 0 schwarz … 255 weiß
 */
function estimateSkew(gray, width, height) {
  const thr = paperWhite(gray) * 0.75;
  const xs = [];
  const ys = [];
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 400000))); // höchstens ~400 000 Pixel ansehen
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (gray[y * width + x] < thr) { xs.push(x); ys.push(y); }
    }
  }
  if (xs.length < 200) return 0;
  // Fächer so hoch wie der Abstand der angesehenen Zeilen, sonst bekäme 0° künstlich die
  // schärfsten Spitzen (jede zweite Zeile leer, die anderen doppelt voll)
  const bins = new Float64Array(Math.ceil((height + width) / step) + 2);
  const score = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180);
    bins.fill(0);
    const off = (width * Math.abs(t)) / step + 1;
    for (let i = 0; i < xs.length; i++) bins[Math.round((ys[i] - xs[i] * t) / step + off)]++;
    let sum = 0;
    for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
    return sum;
  };
  const best = (from, to, by) => {
    let angle = 0;
    let top = -1;
    for (let d = from; d <= to + 1e-9; d += by) {
      const v = score(d);
      if (v > top) { top = v; angle = d; }
    }
    return angle;
  };
  const coarse = best(-5, 5, 0.1);
  const fine = best(coarse - 0.1, coarse + 0.1, 0.02);
  return Math.abs(fine) < 0.1 ? 0 : Math.round(fine * 100) / 100;
}

// Linien einer Richtung im Pixelraster: Abschnitte einer Zeile, die dunkel sind, während es
// k Pixel darüber und darunter hell bleibt; Abschnitte benachbarter Zeilen sind eine Linie.
// dark: 1 = dunkel, zeilenweise. minLen in Pixeln; cover: wie viel eines Fensters dunkel sein
// muss; gaps: wie viele schlechte Fenster hintereinander eine Linie nicht unterbrechen.
// Liefert {y0, y1, x0, x1} in Pixeln und count(y, a, b), die Zahl dunkler Pixel in Zeile y
// zwischen a (einschließlich) und b.
function scanLines(dark, width, height, mm, { minLen, cover, gaps }) {
  const W1 = width + 1;
  const pre = new Uint16Array(W1 * height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const row = y * width;
    const o = y * W1;
    for (let x = 0; x < width; x++) {
      sum += dark[row + x];
      pre[o + x + 1] = sum;
    }
  }
  const count = (y, a, b) => pre[y * W1 + b] - pre[y * W1 + a];

  const win = Math.max(3, Math.round(1.5 * mm)); // Fenster von 1,5 mm
  const k = Math.max(2, Math.round(0.8 * mm)); // so weit daneben muss es hell sein
  const k2 = Math.round(1.5 * k);
  const groups = [];
  let open = [];
  for (let y = k2; y < height - k2; y++) {
    const segs = [];
    let start = -1;
    let end = -1;
    let misses = 0;
    for (let a = 0; a < width; a += win) {
      const b = Math.min(width, a + win);
      const n = b - a;
      let good = false;
      if (count(y, a, b) >= cover * n) {
        const above = Math.max(count(y - k, a, b), count(y - k - 1, a, b), count(y - k2, a, b));
        const below = Math.max(count(y + k, a, b), count(y + k + 1, a, b), count(y + k2, a, b));
        good = above <= 0.1 * n && below <= 0.1 * n;
      }
      if (good) {
        if (start < 0) start = a;
        end = b;
        misses = 0;
      } else if (start >= 0 && ++misses > gaps) {
        if (end - start >= minLen) segs.push([start, end]);
        start = -1;
        misses = 0;
      }
    }
    if (start >= 0 && end - start >= minLen) segs.push([start, end]);
    // Fenstergrenzen auf das erste und letzte dunkle Pixel der Zeile kürzen
    const row = y * width;
    for (const seg of segs) {
      while (seg[0] < seg[1] - 1 && !dark[row + seg[0]]) seg[0]++;
      while (seg[1] > seg[0] + 1 && !dark[row + seg[1] - 1]) seg[1]--;
    }

    // Ein Abschnitt, der mehrere offene Linien berührt, verbindet sie (Stücke einer leicht
    // schrägen oder unterbrochenen Linie in Nachbarzeilen).
    open = open.filter((g) => !g.gone && g.y1 >= y - 2);
    for (const [a, b] of segs) {
      const hits = open.filter((o) => !o.gone && Math.min(o.x1, b) - Math.max(o.x0, a) > 0.5 * Math.min(o.x1 - o.x0, b - a));
      if (!hits.length) {
        const fresh = { y0: y, y1: y, x0: a, x1: b };
        groups.push(fresh);
        open.push(fresh);
        continue;
      }
      const g = hits[0];
      for (const o of hits.slice(1)) {
        Object.assign(g, { y0: Math.min(g.y0, o.y0), x0: Math.min(g.x0, o.x0), x1: Math.max(g.x1, o.x1) });
        o.gone = true;
      }
      g.y1 = y;
      g.x0 = Math.min(g.x0, a);
      g.x1 = Math.max(g.x1, b);
    }
  }
  // Dicker als eine Linie: Balken oder Rahmen, keine Linie zum Schreiben
  return { groups: groups.filter((g) => !g.gone && g.y1 - g.y0 <= 1.2 * mm), count };
}

/**
 * Gedruckte Linien im Graustufenbild einer Seite. Waagerecht: Antwortlinien, Lücken (____),
 * gepunktete Linien, Tabellenränder. Senkrecht: Tabellenränder, damit ein Tipp in eine Zelle
 * genau die Zelle trifft. Text fällt heraus: Eine Linie ist dünn, knapp daneben ist das Blatt
 * hell; bei Buchstaben ist es dort dunkel, und sie sind kürzer.
 * @param {Uint8Array|Uint8ClampedArray} gray  Helligkeit je Pixel (0 schwarz … 255 weiß), zeilenweise
 * @param {number} width
 * @param {number} height
 * @param {number} scale  Pixel pro Punkt
 * @param {{level?: number}} [o]  dunkel ist, was dunkler ist als level mal Papierweiß (Fotos nach dem
 *   Ausgleich vertragen eine höhere Schwelle für blasse Punktlinien)
 * @returns {{rules: {y: number, t: number, x0: number, x1: number, free: number}[], columns: {x: number, t: number, y0: number, y1: number}[]}}
 *   in Punkten. rules: y Oberkante, t Dicke, free freier Platz darüber (bis zum nächsten
 *   Gedruckten, höchstens 25 mm). columns: x linke Kante, t Dicke.
 */
function detectLines(gray, width, height, scale, { level = 0.8 } = {}) {
  const mm = MM * scale;
  const thr = paperWhite(gray) * level;
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < dark.length; i++) dark[i] = gray[i] < thr ? 1 : 0;

  // Waagerecht auch Punkt- und Strichlinien: wenig Deckung, Lücken bis 3 mm. Eine Pixelzeile
  // dazugenommen, damit leicht schräge Linien (Foto, Scan) nicht in Stücke zerfallen. Kurze
  // Stücke zählen erst einmal mit; die Mindestlänge von 8 mm gilt nach dem Verbinden.
  const thick = dark.slice();
  for (let i = 0; i < thick.length - width; i++) thick[i] |= dark[i + width];
  const across = scanLines(thick, width, height, mm, { minLen: 3 * mm, cover: 0.15, gaps: 2 });
  const ink = (y0, y1, a, b) => {
    let n = 0;
    for (let y = Math.max(0, y0); y < y1; y++) n += across.count(y, a, b);
    return n;
  };
  // In Pixeln; + 1: die mitgenommene Pixelzeile (thick) liegt über der Linie. fill: wie viel der
  // Linie dunkel ist (durchgezogen fast alles, gepunktet etwa ein Drittel).
  const found = across.groups.map((g) => ({
    y0: g.y0 + 1, y1: g.y1, x0: g.x0, x1: g.x1,
    fill: ink(g.y0, g.y1 + 1, g.x0, g.x1) / ((g.y1 + 1 - g.y0) * (g.x1 - g.x0)),
  })).sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
  // Stücke derselben Linie wieder verbinden: bei kleiner Lücke immer; Punktlinien, die im Foto
  // zerfallen sind, auch über größere Lücken, wenn darüber nichts gedruckt ist. Zwei Lücken in
  // einer Zeile („Name: ____ Datum: ____“) trennt die Beschriftung dazwischen.
  const dotted = (r) => r.fill < 0.7;
  for (let i = 0; i < found.length; i++) {
    const r = found[i];
    for (let j = i + 1; j < found.length && found[j].y0 - r.y0 <= 0.6 * mm; j++) {
      const o = found[j];
      const [a, b] = o.x0 >= r.x1 ? [r.x1, o.x0] : [o.x1, r.x0];
      const gap = b - a;
      const empty = () => ink(r.y0 - Math.round(3 * mm), r.y0 - 1, a, b) <= 0.01 * gap * 3 * mm;
      if (gap > 6 * mm && !(gap <= 30 * mm && dotted(r) && dotted(o) && empty())) continue;
      const len = (q) => q.x1 - q.x0;
      Object.assign(r, {
        fill: (r.fill * len(r) + o.fill * len(o)) / (len(r) + len(o)),
        y1: Math.max(r.y1, o.y1), x0: Math.min(r.x0, o.x0), x1: Math.max(r.x1, o.x1),
      });
      found.splice(j, 1);
      j = i; // die längere Linie erreicht vielleicht weitere Stücke
    }
  }
  const rules = found.filter((g) => g.x1 - g.x0 >= 8 * mm).map((g) => {
    // Freier Platz darüber: bis zur ersten Zeile mit etwas Gedrucktem über der Linie.
    const a = Math.min(g.x1 - 1, g.x0 + Math.round(mm));
    const b = Math.max(a + 1, g.x1 - Math.round(mm));
    const limit = Math.max(0, g.y0 - Math.round(25 * mm));
    let y = g.y0 - 3;
    while (y > limit && across.count(y, a, b) < Math.max(1, 0.02 * (b - a))) y--;
    return { y: g.y0 / scale, t: (g.y1 + 1 - g.y0) / scale, x0: g.x0 / scale, x1: g.x1 / scale, free: (g.y0 - 1 - y) / scale };
  }).sort((p, q) => p.y - q.y || p.x0 - q.x0);

  // Senkrechte Linien: dasselbe auf dem gedrehten Bild.
  const turned = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) turned[x * height + y] = dark[y * width + x];
  }
  // Senkrecht nur durchgezogene Linien, sonst sähen Buchstaben untereinander wie eine aus
  const down = scanLines(turned, height, width, mm, { minLen: 8 * mm, cover: 0.25, gaps: 1 });
  const columns = down.groups.map((g) => ({ x: g.y0 / scale, t: (g.y1 + 1 - g.y0) / scale, y0: g.x0 / scale, y1: g.x1 / scale }))
    .sort((p, q) => p.x - q.x || p.y0 - q.y0);
  return { rules, columns };
}

// Linien, die ein Feld trifft: in seiner Höhe (oder knapp darunter, wenn das Feld auf der Linie
// endet) und über mindestens die halbe Breite. Auf die Feldbreite gekürzt.
function rulesInBox(rules, box) {
  const out = [];
  for (const r of rules) {
    if (r.y < box.y || r.y > box.y + box.h + 1.5 * MM) continue;
    const x0 = Math.max(r.x0, box.x);
    const x1 = Math.min(r.x1, box.x + box.w);
    if (x1 - x0 < 0.5 * box.w) continue;
    out.push({ y: r.y, x0, x1 });
  }
  out.sort((a, b) => a.y - b.y);
  // Zweimal erkannte Linie (z. B. doppelt gezogen): nur einmal beschreiben
  return out.filter((r, i) => i === 0 || r.y - out[i - 1].y > 2 * MM);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Tabellenzelle um einen Punkt: je eine Linie darüber, darunter, links und rechts, die die
// Zelle ganz einfassen. null, wenn der Punkt in keiner Tabelle liegt.
function cellAt(page, x, y) {
  const rules = page.rules ?? [];
  const columns = page.columns ?? [];
  const spans = (r) => r.x0 - 1 * MM <= x && r.x1 + 1 * MM >= x;
  const above = rules.filter((r) => r.y <= y && spans(r)).pop();
  const below = rules.find((r) => r.y > y && spans(r));
  if (!above || !below || below.y - above.y < 4 * MM || below.y - above.y > 60 * MM) return null;
  // Senkrechte Linien werden an Kreuzungen erst ein Stück weiter erkannt
  const covers = (c) => c.y0 <= above.y + 3 * MM && c.y1 >= below.y - 3 * MM;
  const left = columns.filter((c) => c.x <= x && covers(c)).pop();
  const right = columns.find((c) => c.x > x && covers(c));
  if (!left || !right || right.x - left.x < 6 * MM) return null;
  // Innen, mit etwas Abstand zu den Rändern; die untere Linie bleibt außerhalb, damit der Text
  // mittig in der Zelle steht statt auf ihrem Rand.
  const x0 = left.x + left.t + 0.8 * MM;
  const y0 = above.y + above.t + 0.8 * MM;
  return { x: x0, y: y0, w: right.x - 0.8 * MM - x0, h: below.y - 1.6 * MM - y0 };
}

/**
 * Feld zu einem Tipp auf die Seite: in einer Tabelle die Zelle; auf oder über einer Linie die
 * Linie samt gleich langen, leeren Linien im gleichen Abstand darunter und darüber
 * (mehrzeilige Antwort) und Platz zum Schreiben darüber; sonst ein Feld für eine Zeile.
 * @param {{width: number, height: number, rules?: Array, columns?: Array}} page  aus detectLines
 * @returns {{x: number, y: number, w: number, h: number, snapped: boolean}}
 */
function fieldAt(page, x, y) {
  const cell = cellAt(page, x, y);
  if (cell) return { ...cell, snapped: true };
  const rules = page.rules ?? [];
  const near = rules.filter((r) => x >= r.x0 - 3 * MM && x <= r.x1 + 3 * MM && r.y >= y - 3 * MM && r.y <= y + 10 * MM);
  if (!near.length) {
    const w = Math.min(70 * MM, page.width - 4 * MM);
    const h = 10 * MM;
    return { x: clamp(x - 2 * MM, 2 * MM, page.width - w - 2 * MM), y: clamp(y - h / 2, 0, page.height - h), w, h, snapped: false };
  }
  // Am liebsten die Linie, auf die man schreiben würde: knapp unter dem Finger
  const first = near.reduce((best, r) => (Math.abs(r.y - y - 3 * MM) < Math.abs(best.y - y - 3 * MM) ? r : best));
  const similar = rules
    .filter((r) => Math.abs(r.x0 - first.x0) < 4 * MM && Math.abs(r.x1 - first.x1) < 4 * MM)
    .sort((a, b) => a.y - b.y);
  let lo = similar.indexOf(first);
  let hi = lo;
  let gap = null;
  // Nächste Linie gehört dazu: gleicher Abstand, und zwischen beiden steht nichts
  const joins = (upper, lower) => {
    const g = lower.y - upper.y;
    return g >= 4 * MM && g <= 15 * MM && (gap === null || Math.abs(g - gap) < 0.25 * gap) && lower.free >= 0.7 * (g - upper.t);
  };
  while (hi + 1 < similar.length && joins(similar[hi], similar[hi + 1])) { gap ??= similar[hi + 1].y - similar[hi].y; hi++; }
  while (lo > 0 && joins(similar[lo - 1], similar[lo])) { gap ??= similar[lo].y - similar[lo - 1].y; lo--; }
  const block = similar.slice(lo, hi + 1);
  const top = block[0];
  const room = Math.max(0, top.free - 0.6 * MM);
  const head = clamp(gap ? Math.min(0.85 * gap, room) : room, 4 * MM, 10 * MM);
  const x0 = Math.min(...block.map((r) => r.x0));
  const x1 = Math.max(...block.map((r) => r.x1));
  const y0 = Math.max(0, top.y - head);
  return { x: x0, y: y0, w: x1 - x0, h: block[block.length - 1].y + 1.2 * MM - y0, snapped: true };
}

// Lesereihenfolge: Seite, dann von oben nach unten; was etwa auf einer Höhe liegt, von links.
function orderFields(fields) {
  const mid = (f) => f.y + f.h / 2;
  return [...fields].sort((a, b) => a.page - b.page || (Math.abs(mid(a) - mid(b)) > 3 * MM ? mid(a) - mid(b) : a.x - b.x));
}

// Fester Startwert je Feld (aus seiner Id): gleiche Texte in zwei Feldern sehen verschieden
// aus, und ein Feld behält sein Aussehen, wenn andere dazukommen.
function fieldSeed(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}

/**
 * Alle Felder setzen.
 * @param {{width: number, height: number, jpeg?: Uint8Array, rules?: Array}[]} pages
 * @param {{id: string, page: number, x: number, y: number, w: number, h: number, text: string}[]} fields
 * @param {Map} table  aus glyphTable()
 * @param {object} options  wie layoutBox
 * @returns {{pages: Array, missing: string[], fields: Map<string, {overflow: boolean, xHeightMm: number}>}}
 *   pages wie bei layoutText, mit image: {jpeg} für render.js
 */
function layoutSheet(pages, fields, table, options = {}) {
  const out = pages.map((p) => ({ width: p.width, height: p.height, strokes: [], image: p.jpeg ? { jpeg: p.jpeg } : null }));
  const missing = new Set();
  const results = new Map();
  for (const f of fields) {
    const page = pages[f.page];
    if (!page || !String(f.text ?? '').trim()) continue;
    const box = { x: f.x, y: f.y, w: f.w, h: f.h, rules: rulesInBox(page.rules ?? [], f) };
    const res = layoutBox(f.text, table, box, { ...options, seed: (options.seed ?? 1) * 7919 + fieldSeed(f.id) });
    out[f.page].strokes.push(...res.strokes);
    for (const c of res.missing) missing.add(c);
    results.set(f.id, { overflow: res.overflow, xHeightMm: res.xHeightMm });
  }
  return { pages: out, missing: [...missing], fields: results };
}

/**
 * Mehrere Antworten auf einmal (etwa aus einem Chat) auf die Felder verteilen.
 * "1. … 2. …", "1) …", "a) … b) …" landen in Feld 1, 2 …; Spiegelstriche und Absätze der Reihe
 * nach; ein einzelner Absatz mit mehreren Zeilen zeilenweise, wenn es mehrere Felder gibt.
 * @param {string} text
 * @param {number} count  Zahl der Felder
 * @returns {(string|undefined)[]}  Index = Feld (in Lesereihenfolge); undefined = Feld bleibt, wie es ist
 */
function splitAnswers(text, count) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!clean || count < 1) return [];
  if (count === 1) return [clean];
  const marks = [...clean.matchAll(/^[ \t]*(?:(\d{1,2})[.):]|([a-z])\)|([-*•–]))[ \t]+/gim)];
  if (marks.length >= 2) {
    // Was vor der Liste steht („Hier die Antworten:“), fällt weg.
    const parts = marks.map((m, i) => ({
      m,
      text: clean.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : clean.length).trim(),
    }));
    const index = ({ m }) => (m[1] ? Number(m[1]) - 1 : m[2] ? m[2].toLowerCase().charCodeAt(0) - 97 : null);
    const keys = parts.map(index);
    const numbered = keys.every((k) => k !== null) && new Set(keys).size === keys.length && keys.every((k) => k >= 0);
    const out = [];
    parts.forEach((p, i) => {
      const at = numbered ? keys[i] : i;
      if (at < count) out[at] = p.text;
    });
    return out;
  }
  let parts = clean.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) parts = clean.split('\n').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, count);
}

export { estimateSkew, detectLines, rulesInBox, cellAt, fieldAt, orderFields, fieldSeed, layoutSheet, splitAnswers };
